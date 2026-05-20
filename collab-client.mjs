/**
 * 实时协作（Yjs + y-websocket）。由 index.html 以 type="module" 加载。
 */
import * as Y from "https://esm.sh/yjs@13.6.20";
import { WebsocketProvider } from "https://esm.sh/y-websocket@1.5.0?deps=yjs@13.6.20";

export const COLLAB_ROOT = "storyboard-v1";
const TX_UI = "collab-ui";

/** @param {string} httpBase */
function toWsServerUrl(httpBase) {
  const b = httpBase.trim().replace(/\/$/, "");
  if (b.startsWith("https://")) return `wss://${b.slice(8)}`;
  if (b.startsWith("http://")) return `ws://${b.slice(7)}`;
  return b;
}

/** @param {string} httpBase */
function toHttpOrigin(httpBase) {
  const b = httpBase.trim().replace(/\/$/, "");
  if (b.startsWith("ws://")) return `http://${b.slice(5)}`;
  if (b.startsWith("wss://")) return `https://${b.slice(6)}`;
  return b;
}

/**
 * @param {import('yjs').Map} m
 * @param {{ text: string, urls: string[] }} s
 */
function slotToYMap(m, s) {
  const t = new Y.Text();
  t.insert(0, s.text || "");
  m.set("t", t);
  const u = new Y.Text();
  u.insert(0, JSON.stringify(s.urls || []));
  m.set("u", u);
}

/**
 * @param {import('yjs').Doc} ydoc
 * @param {{ pages: { pageIndex: number, pageUrl: string }[], slots: Record<string, { urls: string[], text: string }>, meta: { pane: unknown, refCol: number, rows: number[] } }} snap
 */
export function primeYDoc(ydoc, snap) {
  const root = ydoc.getMap(COLLAB_ROOT);
  ydoc.transact(() => {
    const pagesArr = new Y.Array();
    for (const p of snap.pages) {
      const row = new Y.Map();
      row.set("pi", p.pageIndex);
      const src = new Y.Text();
      src.insert(0, p.pageUrl || "");
      row.set("src", src);
      pagesArr.push([row]);
    }
    root.set("pages", pagesArr);

    const metaT = new Y.Text();
    metaT.insert(0, JSON.stringify(snap.meta));
    root.set("metaJson", metaT);

    const sm = new Y.Map();
    const ids = new Set(Object.keys(snap.slots || {}));
    if (typeof document !== "undefined") {
      document.querySelectorAll("[data-dropzone]").forEach((el) => {
        const id = el.getAttribute("data-dropzone");
        if (id) ids.add(id);
      });
    }
    for (const id of ids) {
      const s = snap.slots[id] || { text: "", urls: [] };
      const cell = new Y.Map();
      slotToYMap(cell, s);
      sm.set(id, cell);
    }
    root.set("slots", sm);
  });
}

/**
 * @param {import('yjs').Doc} ydoc
 */
export function readYDocSnapshot(ydoc) {
  const root = ydoc.getMap(COLLAB_ROOT);
  /** @type {{ pageIndex: number, pageUrl: string }[]} */
  const pages = [];
  const pa = root.get("pages");
  if (pa instanceof Y.Array) {
    pa.forEach((row) => {
      if (!(row instanceof Y.Map)) return;
      const pi = row.get("pi");
      const src = row.get("src");
      const pageUrl = src instanceof Y.Text ? src.toString() : "";
      pages.push({
        pageIndex: typeof pi === "number" ? pi : Number(pi) || 0,
        pageUrl,
      });
    });
  }
  /** @type {Record<string, { urls: string[], text: string }>} */
  const slots = {};
  const sm = root.get("slots");
  if (sm instanceof Y.Map) {
    sm.forEach((cell, id) => {
      if (!(cell instanceof Y.Map)) return;
      const t = cell.get("t");
      const u = cell.get("u");
      let urls = [];
      try {
        urls = JSON.parse(u instanceof Y.Text ? u.toString() : "[]");
        if (!Array.isArray(urls)) urls = [];
      } catch (_) {
        urls = [];
      }
      slots[id] = { text: t instanceof Y.Text ? t.toString() : "", urls };
    });
  }
  let meta = null;
  const mj = root.get("metaJson");
  if (mj instanceof Y.Text) {
    try {
      meta = JSON.parse(mj.toString());
    } catch (_) {
      meta = null;
    }
  }
  return { pages, slots, meta };
}

/**
 * @param {string} httpBase
 * @param {string} roomId
 * @param {string} token
 */
export async function registerRoom(httpBase, roomId, token) {
  const origin = toHttpOrigin(httpBase);
  const r = await fetch(`${origin}/api/room`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: roomId, token }),
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(t || `HTTP ${r.status}`);
  }
}

/** @type {import('yjs').Doc | null} */
let activeYDoc = null;
/** @type {(() => void) | null} */
let unobserveDeep = null;
/** @type {ReturnType<typeof setTimeout> | null} */
let metaPushTimer = null;

function debounceMetaPush() {
  if (metaPushTimer) clearTimeout(metaPushTimer);
  metaPushTimer = setTimeout(() => {
    metaPushTimer = null;
    pushMetaNow();
  }, 120);
}

function pushMetaNow() {
  const ydoc = activeYDoc;
  if (!ydoc) return;
  const fn = window.__collabGetMeta;
  if (typeof fn !== "function") return;
  const meta = fn();
  const root = ydoc.getMap(COLLAB_ROOT);
  const mj = root.get("metaJson");
  const json = JSON.stringify(meta);
  ydoc.transact(() => {
    if (mj instanceof Y.Text) {
      mj.delete(0, mj.length);
      mj.insert(0, json);
    } else {
      const t = new Y.Text();
      t.insert(0, json);
      root.set("metaJson", t);
    }
  }, TX_UI);
}

/**
 * @param {string} slotId
 * @param {{ urls?: string[], text?: string }} part
 */
export function pushSlotPartial(slotId, part) {
  const ydoc = activeYDoc;
  if (!ydoc) return;
  const root = ydoc.getMap(COLLAB_ROOT);
  const sm = root.get("slots");
  if (!(sm instanceof Y.Map)) return;
  ydoc.transact(() => {
    let cell = sm.get(slotId);
    if (!(cell instanceof Y.Map)) {
      cell = new Y.Map();
      slotToYMap(cell, { text: "", urls: [] });
      sm.set(slotId, cell);
    }
    if (part.text != null) {
      const t = cell.get("t");
      if (t instanceof Y.Text) {
        t.delete(0, t.length);
        t.insert(0, part.text);
      }
    }
    if (part.urls != null) {
      const u = cell.get("u");
      const s = JSON.stringify(part.urls);
      if (u instanceof Y.Text) {
        u.delete(0, u.length);
        u.insert(0, s);
      }
    }
  }, TX_UI);
}

/**
 * @param {import('yjs').Doc} ydoc
 * @param {boolean} readOnly
 */
export function observeDocAndNotify(ydoc, readOnly) {
  unobserveDeep?.();
  const root = ydoc.getMap(COLLAB_ROOT);
  let t = 0;
  const run = () => {
    clearTimeout(t);
    t = setTimeout(() => {
      window.__collabApplyFromY?.();
    }, readOnly ? 35 : 75);
  };
  root.observeDeep(run);
  unobserveDeep = () => {
    clearTimeout(t);
    root.unobserveDeep(run);
    unobserveDeep = null;
  };
}

function wireTextareas(ydoc, readOnly) {
  const root = ydoc.getMap(COLLAB_ROOT);
  const cleanups = [];
  document.querySelectorAll("textarea.feedback-text").forEach((ta) => {
    if (!(ta instanceof HTMLTextAreaElement)) return;
    if (ta.dataset.collabWired === "1") return;
    const block = ta.closest(".feedback-block");
    const dz = block?.querySelector("[data-dropzone]");
    const slotId = dz?.getAttribute("data-dropzone");
    if (!slotId) return;
    const sm = root.get("slots");
    if (!(sm instanceof Y.Map)) return;
    let cell = sm.get(slotId);
    if (!(cell instanceof Y.Map)) {
      ydoc.transact(() => {
        const c = new Y.Map();
        slotToYMap(c, { text: ta.value || "", urls: readUrlsFromZoneHtml(dz) });
        sm.set(slotId, c);
      }, TX_UI);
      cell = sm.get(slotId);
    }
    if (!(cell instanceof Y.Map)) return;
    const ytext = cell.get("t");
    if (!(ytext instanceof Y.Text)) return;

    ta.dataset.collabWired = "1";

    const onY = (/** @type {any} */ e) => {
      if (e.transaction.origin === TX_UI) return;
      ta.value = ytext.toString();
    };
    ytext.observe(onY);
    ta.value = ytext.toString();

    let inputT = 0;
    const onInput = () => {
      if (readOnly) return;
      clearTimeout(inputT);
      inputT = setTimeout(() => {
        const nv = ta.value;
        ydoc.transact(() => {
          const cur = ytext.toString();
          if (cur === nv) return;
          ytext.delete(0, ytext.length);
          ytext.insert(0, nv);
        }, TX_UI);
      }, 45);
    };
    ta.addEventListener("input", onInput);
    cleanups.push(() => {
      delete ta.dataset.collabWired;
      ytext.unobserve(onY);
      ta.removeEventListener("input", onInput);
    });
  });
  return () => cleanups.forEach((fn) => fn());
}

/** @param {Element | null | undefined} dz */
function readUrlsFromZoneHtml(dz) {
  if (!(dz instanceof HTMLElement)) return [];
  try {
    const raw = dz.dataset.refUrls;
    if (raw) return JSON.parse(raw);
  } catch (_) {
    /* ignore */
  }
  return [];
}

/**
 * @param {import('yjs').Doc} ydoc
 * @param {string} httpBase
 * @param {string} roomId
 * @param {string} token
 * @param {boolean} readOnly
 * @param {{ onSynced?: () => void }} hooks
 */
function attachSession(ydoc, httpBase, roomId, token, readOnly, hooks) {
  activeYDoc = ydoc;
  const wsUrl = toWsServerUrl(httpBase);
  const room = `sb-${roomId}`;
  const role = readOnly ? "read" : "edit";
  const provider = new WebsocketProvider(wsUrl, room, ydoc, {
    params: { token, role },
    connect: true,
  });

  observeDocAndNotify(ydoc, readOnly);

  let unwireText = () => {};
  let syncedOnce = false;
  const onFirstSync = () => {
    if (syncedOnce) return;
    syncedOnce = true;
    window.__collabApplyFromY?.();
    unwireText = wireTextareas(ydoc, readOnly);
    hooks?.onSynced?.();
  };

  provider.on("sync", (/** @type {any[]} */ x) => {
    if (x && x[0] === true) onFirstSync();
  });
  if (provider.synced) onFirstSync();

  return {
    ydoc,
    provider,
    destroy() {
      unwireText();
      unobserveDeep?.();
      unobserveDeep = null;
      try {
        provider.destroy();
      } catch (_) {
        /* ignore */
      }
      activeYDoc = null;
    },
  };
}

/**
 * @param {string} httpBase
 * @param {string} roomId
 * @param {string} token
 * @param {{ pages: unknown[], slots: Record<string, { urls: string[], text: string }>, meta: object }} snap
 * @param {{ onSynced?: () => void }} hooks
 */
export function hostCollabSession(httpBase, roomId, token, snap, hooks) {
  const ydoc = new Y.Doc();
  primeYDoc(ydoc, snap);
  return attachSession(ydoc, httpBase, roomId, token, false, hooks);
}

/**
 * @param {string} httpBase
 * @param {string} roomId
 * @param {string} token
 * @param {boolean} readOnly
 * @param {{ onSynced?: () => void }} hooks
 */
export function joinCollabSession(httpBase, roomId, token, readOnly, hooks) {
  const ydoc = new Y.Doc();
  return attachSession(ydoc, httpBase, roomId, token, readOnly, hooks);
}

export function notifyLayoutChangedFromDom() {
  debounceMetaPush();
}

window.__collabPrimeYDoc = primeYDoc;
window.__collabReadYDoc = readYDocSnapshot;
window.__collabRegisterRoom = registerRoom;
window.__collabHostSession = hostCollabSession;
window.__collabJoinSession = joinCollabSession;
window.__collabPushSlotPartial = pushSlotPartial;
window.__collabLayoutChanged = notifyLayoutChangedFromDom;
