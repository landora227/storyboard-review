#!/usr/bin/env node
/**
 * 分镜审核台 · 实时协作 WebSocket 服务（Yjs）
 * - 房间名：路径第一段，例如 ws://host:2345/sb-abc?token=...&role=edit
 * - 先 POST /api/room 注册 { "id": "abc", "token": "..." }（id 须与路径 sb-<id> 一致）
 * - 最多 6 个非只读连接同时在线；role=read 仅同步、禁止向文档应用 Yjs Update
 */
"use strict";

const http = require("http");
const crypto = require("crypto");
const WebSocket = require("ws");
const Y = require("yjs");
const syncProtocol = require("y-protocols/dist/sync.cjs");
const awarenessProtocol = require("y-protocols/dist/awareness.cjs");
const encoding = require("lib0/dist/encoding.cjs");
const decoding = require("lib0/dist/decoding.cjs");
const map = require("lib0/dist/map.cjs");

const messageSync = 0;
const messageAwareness = 1;
const wsReadyStateConnecting = 0;
const wsReadyStateOpen = 1;

const gcEnabled = process.env.GC !== "false" && process.env.GC !== "0";
const MAX_EDITORS = parseInt(process.env.COLLAB_MAX_EDITORS || "6", 10);

/** @type {Map<string, string>} roomId -> token（不含 sb- 前缀） */
const roomTokens = new Map();

const SHARE_MAX_BYTES = parseInt(process.env.SHARE_MAX_BYTES || String(28 * 1024 * 1024), 10);
const SHARE_MAX_ENTRIES = parseInt(process.env.SHARE_MAX_ENTRIES || "120", 10);
const SHARE_TTL_MS = parseInt(process.env.SHARE_TTL_MS || String(7 * 24 * 3600 * 1000), 10);

/** @type {Map<string, { bundle: object, createdAt: number }>} */
const shareSnapshots = new Map();

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

/**
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 * @param {number} maxBytes
 * @param {(body: string) => void} onBody
 */
function readBody(req, res, maxBytes, onBody) {
  let body = "";
  let size = 0;
  req.on("data", (chunk) => {
    size += chunk.length;
    if (size > maxBytes) {
      setCors(res);
      res.writeHead(413, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: false, error: "payload too large" }));
      req.destroy();
      return;
    }
    body += chunk;
  });
  req.on("end", () => onBody(body));
  req.on("error", () => {
    if (!res.headersSent) {
      setCors(res);
      res.writeHead(400);
      res.end(JSON.stringify({ ok: false, error: "bad request" }));
    }
  });
}

function pruneShareSnapshots() {
  const now = Date.now();
  for (const [id, row] of shareSnapshots) {
    if (now - row.createdAt > SHARE_TTL_MS) shareSnapshots.delete(id);
  }
  while (shareSnapshots.size > SHARE_MAX_ENTRIES) {
    const oldest = shareSnapshots.keys().next().value;
    if (oldest === undefined) break;
    shareSnapshots.delete(oldest);
  }
}

/**
 * @param {unknown} bundle
 * @returns {boolean}
 */
function isValidShareBundle(bundle) {
  if (!bundle || typeof bundle !== "object") return false;
  const b = /** @type {{ v?: number; pages?: unknown }} */ (bundle);
  return b.v === 1 && Array.isArray(b.pages) && b.pages.length > 0;
}

function newShareId() {
  return crypto.randomBytes(12).toString("base64url");
}

/**
 * @param {Uint8Array} update
 * @param {any} origin
 * @param {WSSharedDoc} doc
 */
const updateHandler = (update, origin, doc) => {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, messageSync);
  syncProtocol.writeUpdate(encoder, update);
  const message = encoding.toUint8Array(encoder);
  doc.conns.forEach((_, conn) => send(doc, conn, message));
};

class WSSharedDoc extends Y.Doc {
  /**
   * @param {string} name
   */
  constructor(name) {
    super({ gc: gcEnabled });
    this.name = name;
    /** @type {Map<Object, Set<number>>} */
    this.conns = new Map();
    this.awareness = new awarenessProtocol.Awareness(this);
    this.awareness.setLocalState(null);

    const awarenessChangeHandler = ({ added, updated, removed }, conn) => {
      const changedClients = added.concat(updated, removed);
      if (conn !== null) {
        const connControlledIDs = /** @type {Set<number>} */ (this.conns.get(conn));
        if (connControlledIDs !== undefined) {
          added.forEach((clientID) => {
            connControlledIDs.add(clientID);
          });
          removed.forEach((clientID) => {
            connControlledIDs.delete(clientID);
          });
        }
      }
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, messageAwareness);
      encoding.writeVarUint8Array(encoder, awarenessProtocol.encodeAwarenessUpdate(this.awareness, changedClients));
      const buff = encoding.toUint8Array(encoder);
      this.conns.forEach((_, c) => {
        send(this, c, buff);
      });
    };
    this.awareness.on("update", awarenessChangeHandler);
    this.on("update", updateHandler);
  }
}

/** @type {Map<string, WSSharedDoc>} */
const docs = new Map();

/**
 * @param {string} docname
 * @param {boolean} [gc]
 * @return {WSSharedDoc}
 */
const getYDoc = (docname, gc = true) =>
  map.setIfUndefined(docs, docname, () => {
    const doc = new WSSharedDoc(docname);
    doc.gc = gc;
    docs.set(docname, doc);
    return doc;
  });

/**
 * @param {any} conn
 * @param {WSSharedDoc} doc
 * @param {Uint8Array} message
 */
const messageListener = (conn, doc, message) => {
  try {
    const encoder = encoding.createEncoder();
    const decoder = decoding.createDecoder(message);
    const messageType = decoding.readVarUint(decoder);
    switch (messageType) {
      case messageSync: {
        if (conn.collabReadonly) {
          const innerStart = decoding.pos(decoder);
          const innerDec = decoding.createDecoder(message.subarray(innerStart));
          const innerType = decoding.readVarUint(innerDec);
          if (innerType === syncProtocol.messageYjsUpdate) {
            return;
          }
        }
        encoding.writeVarUint(encoder, messageSync);
        syncProtocol.readSyncMessage(decoder, encoder, doc, conn);
        if (encoding.length(encoder) > 1) {
          send(doc, conn, encoding.toUint8Array(encoder));
        }
        break;
      }
      case messageAwareness: {
        awarenessProtocol.applyAwarenessUpdate(doc.awareness, decoding.readVarUint8Array(decoder), conn);
        break;
      }
      default:
        break;
    }
  } catch (err) {
    console.error(err);
    doc.emit("error", [err]);
  }
};

/**
 * @param {WSSharedDoc} doc
 * @param {any} conn
 */
const closeConn = (doc, conn) => {
  if (doc.conns.has(conn)) {
    const controlledIds = /** @type {Set<number>} */ (doc.conns.get(conn));
    doc.conns.delete(conn);
    awarenessProtocol.removeAwarenessStates(doc.awareness, Array.from(controlledIds), null);
    if (doc.conns.size === 0) {
      doc.destroy();
      docs.delete(doc.name);
    }
  }
  conn.close();
};

/**
 * @param {WSSharedDoc} doc
 * @param {any} conn
 * @param {Uint8Array} m
 */
const send = (doc, conn, m) => {
  if (conn.readyState !== wsReadyStateConnecting && conn.readyState !== wsReadyStateOpen) {
    closeConn(doc, conn);
    return;
  }
  try {
    conn.send(m, /** @param {any} err */ (err) => {
      if (err != null) closeConn(doc, conn);
    });
  } catch (e) {
    closeConn(doc, conn);
  }
};

const pingTimeout = 30000;

/**
 * @param {any} conn
 * @param {any} req
 * @param {{ docName?: string, gc?: boolean }} [opts]
 */
function setupWSConnection(conn, req, opts = {}) {
  const u = new URL(req.url || "/", "http://internal");
  const docName = opts.docName != null ? opts.docName : u.pathname.replace(/^\//, "").split("/")[0] || "default";
  const token = u.searchParams.get("token") || "";
  const role = u.searchParams.get("role") || "edit";
  const readonly = role === "read";

  const m = /^sb-(.+)$/.exec(docName);
  const roomId = m ? m[1] : null;
  if (!roomId) {
    conn.close(4000, "BAD_ROOM");
    return;
  }
  const expected = roomTokens.get(roomId);
  if (!expected || expected !== token) {
    conn.close(4001, "BAD_TOKEN");
    return;
  }

  conn.collabReadonly = readonly;

  if (!readonly) {
    const docProbe = getYDoc(docName, opts.gc !== false);
    let editors = 0;
    docProbe.conns.forEach((_, c) => {
      if (!c.collabReadonly) editors++;
    });
    if (editors >= MAX_EDITORS) {
      conn.close(4002, "EDITOR_LIMIT");
      return;
    }
  }

  const doc = getYDoc(docName, opts.gc !== false);
  conn.binaryType = "arraybuffer";
  doc.conns.set(conn, new Set());
  conn.on("message", /** @param {ArrayBuffer} message */ (message) => {
    messageListener(conn, doc, new Uint8Array(message));
  });

  let pongReceived = true;
  const pingInterval = setInterval(() => {
    if (!pongReceived) {
      if (doc.conns.has(conn)) closeConn(doc, conn);
      clearInterval(pingInterval);
    } else if (doc.conns.has(conn)) {
      pongReceived = false;
      try {
        conn.ping();
      } catch (e) {
        closeConn(doc, conn);
        clearInterval(pingInterval);
      }
    }
  }, pingTimeout);
  conn.on("close", () => {
    closeConn(doc, conn);
    clearInterval(pingInterval);
  });
  conn.on("pong", () => {
    pongReceived = true;
  });

  {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, messageSync);
    syncProtocol.writeSyncStep1(encoder, doc);
    send(doc, conn, encoding.toUint8Array(encoder));
    const awarenessStates = doc.awareness.getStates();
    if (awarenessStates.size > 0) {
      const enc2 = encoding.createEncoder();
      encoding.writeVarUint(enc2, messageAwareness);
      encoding.writeVarUint8Array(
        enc2,
        awarenessProtocol.encodeAwarenessUpdate(doc.awareness, Array.from(awarenessStates.keys())),
      );
      send(doc, conn, encoding.toUint8Array(enc2));
    }
  }
}

const host = process.env.HOST || "0.0.0.0";
const port = parseInt(process.env.PORT || "2345", 10);

const server = http.createServer((req, res) => {
  const url = req.url || "/";

  if (req.method === "OPTIONS") {
    setCors(res);
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === "POST" && url.startsWith("/api/room")) {
    readBody(req, res, 65536, (body) => {
      setCors(res);
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      try {
        const j = JSON.parse(body || "{}");
        const id = typeof j.id === "string" ? j.id : "";
        const token = typeof j.token === "string" ? j.token : "";
        if (!id || !/^[a-zA-Z0-9_-]{8,64}$/.test(id) || !token || token.length < 16) {
          res.writeHead(400);
          res.end(JSON.stringify({ ok: false, error: "invalid id or token" }));
          return;
        }
        roomTokens.set(id, token);
        res.writeHead(200);
        res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        res.writeHead(400);
        res.end(JSON.stringify({ ok: false, error: String(e) }));
      }
    });
    return;
  }

  if (req.method === "POST" && url.startsWith("/api/share")) {
    readBody(req, res, SHARE_MAX_BYTES, (body) => {
      setCors(res);
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      try {
        const j = JSON.parse(body || "{}");
        const bundle = j.bundle;
        if (!isValidShareBundle(bundle)) {
          res.writeHead(400);
          res.end(JSON.stringify({ ok: false, error: "invalid bundle" }));
          return;
        }
        pruneShareSnapshots();
        const id = newShareId();
        shareSnapshots.set(id, { bundle, createdAt: Date.now() });
        res.writeHead(200);
        res.end(JSON.stringify({ ok: true, id }));
      } catch (e) {
        res.writeHead(400);
        res.end(JSON.stringify({ ok: false, error: String(e) }));
      }
    });
    return;
  }

  const shareGet = url.match(/^\/api\/share\/([a-zA-Z0-9_-]{8,64})\/?$/);
  if (req.method === "GET" && shareGet) {
    setCors(res);
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    const row = shareSnapshots.get(shareGet[1]);
    if (!row) {
      res.writeHead(404);
      res.end(JSON.stringify({ ok: false, error: "not found" }));
      return;
    }
    if (Date.now() - row.createdAt > SHARE_TTL_MS) {
      shareSnapshots.delete(shareGet[1]);
      res.writeHead(404);
      res.end(JSON.stringify({ ok: false, error: "expired" }));
      return;
    }
    res.writeHead(200);
    res.end(JSON.stringify({ ok: true, bundle: row.bundle }));
    return;
  }

  if (req.method === "GET" && (url === "/" || url === "")) {
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(
      "storyboard-review collab server ok\n" +
        "POST /api/room { id, token }\n" +
        "POST /api/share { bundle }\n" +
        "GET  /api/share/<id>\n" +
        "WS   /sb-<id>?token=&role=edit|read\n",
    );
    return;
  }

  setCors(res);
  res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify({ ok: false, error: "not found" }));
});

const wss = new WebSocket.Server({ noServer: true });

wss.on("connection", (ws, req) => {
  setupWSConnection(ws, req);
});

server.on("upgrade", (request, socket, head) => {
  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit("connection", ws, request);
  });
});

server.listen(port, host, () => {
  console.log(`[collab] http://${host}:${port}  (POST /api/room, POST/GET /api/share)`);
  console.log(`[collab] WebSocket  ws://${host}:${port}/sb-<roomId>?token=...&role=edit|read`);
  console.log(`[collab] 最多 ${MAX_EDITORS} 名编辑；分享快照最多 ${SHARE_MAX_ENTRIES} 条 / ${SHARE_TTL_MS}ms TTL`);
});
