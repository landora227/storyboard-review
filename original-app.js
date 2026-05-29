/**
 * 分镜审核：PDF 整页展示；分镜/教研/导演三列比例可拖；参考图多图；参考图与文字列宽可拖；分镜灯箱滚轮缩放。
 */
const SLOTS_PER_PAGE = 7;
/** 超过该字数时，悬停文字区展示完整内容浮层 */
const TEXT_PREVIEW_MIN_LEN = 90;

const LS_PANE = "storyboard-pane-weights";
const LS_REF_COL = "storyboard-ref-col-px";
const LS_ROW = "storyboard-row-weights";
const LS_COLLAB_WS = "storyboard-collab-ws-base";

const state = {
  pages: /** @type {{ pageIndex: number; pageUrl: string }[]} */ ([]),
  /** @type {string | null} */
  currentArchiveId: null,
  /** @type {File | null} */
  lastPdfFile: null,
  /** @type {"work" | "library"} */
  view: "work",
  /** 归档库浏览：all | unfiled | 文件夹 id */
  libraryBrowse: /** @type {"all" | "unfiled" | string} */ ("all"),
  /** 通过 #share-edit / #share-read 或导入分享文件进入 */
  fromShare: false,
  /** 阅读分享：仅预览 */
  shareReadOnly: false,
  /** @type {Record<string, { urls: string[]; text: string }> | null} */
  pendingShareSlots: null,
  /** 最近一次从编辑区收集的槽位（离开编辑或自动保存时更新），用于从归档库返回时恢复 */
  sessionSlots: /** @type {Record<string, { urls: string[]; text: string }> | null} */ (null),
  /** 归档库表格排序：名称 / 更新时间；列头点击在正序、倒序间切换 */
  /** @type {{ key: "name" | "updated"; dir: "asc" | "desc" } | null} */
  archiveSort: null,
  /** Yjs 实时协作已连接（含主持房间） */
  collabActive: false,
  /** @type {{ destroy: () => void, ydoc?: import("yjs").Doc } | null} */
  collabSession: null,
};

const pdfJsReady = typeof pdfjsLib !== "undefined";

const els = {
  pdfInput: /** @type {HTMLInputElement | null} */ (document.getElementById("pdf-input")),
  main: document.getElementById("main"),
};

/** 最近一次点选的可编辑参考图槽（用于 Ctrl/Cmd+V 粘贴剪贴板图片） */
let activePasteDropzone = /** @type {HTMLElement | null} */ (null);

function loadPaneWeights() {
  try {
    const j = localStorage.getItem(LS_PANE);
    if (!j) return { story: 28, res: 36, dir: 36 };
    const o = JSON.parse(j);
    if (typeof o.story === "number" && typeof o.res === "number" && typeof o.dir === "number") return o;
  } catch (_) {
    /* ignore */
  }
  return { story: 28, res: 36, dir: 36 };
}

function savePaneWeights(w) {
  try {
    localStorage.setItem(LS_PANE, JSON.stringify(w));
  } catch (_) {
    /* ignore */
  }
}

function loadRefColPx() {
  try {
    const n = parseInt(localStorage.getItem(LS_REF_COL) || "", 10);
    if (n >= 72 && n <= 300) return n;
  } catch (_) {
    /* ignore */
  }
  return 128;
}

function saveRefColPx(px) {
  try {
    localStorage.setItem(LS_REF_COL, String(px));
  } catch (_) {
    /* ignore */
  }
}

/** @returns {number[]} */
function loadRowWeights() {
  try {
    const j = localStorage.getItem(LS_ROW);
    if (!j) return Array.from({ length: SLOTS_PER_PAGE }, () => 100);
    const o = JSON.parse(j);
    if (Array.isArray(o) && o.length === SLOTS_PER_PAGE && o.every((x) => typeof x === "number" && x > 0)) return o;
  } catch (_) {
    /* ignore */
  }
  return Array.from({ length: SLOTS_PER_PAGE }, () => 100);
}

/** @param {number[]} arr */
function saveRowWeights(arr) {
  try {
    localStorage.setItem(LS_ROW, JSON.stringify(arr));
  } catch (_) {
    /* ignore */
  }
}

function applyAllLayoutGlobals() {
  const w = loadPaneWeights();
  const rw = loadRowWeights();
  const px = loadRefColPx();
  const r = document.documentElement;
  r.style.setProperty("--refs-col", `${px}px`);
  for (let i = 0; i < SLOTS_PER_PAGE; i++) {
    r.style.setProperty(`--rw-${i}`, String(rw[i]));
  }
  document.querySelectorAll(".pane--story").forEach((el) => {
    /** @type {HTMLElement} */ (el).style.flex = `${w.story} 1 0`;
  });
  document.querySelectorAll(".pane-dual-outer").forEach((el) => {
    /** @type {HTMLElement} */ (el).style.flex = `${w.res + w.dir} 1 0`;
  });
  document.querySelectorAll(".dual-head__r").forEach((el) => {
    /** @type {HTMLElement} */ (el).style.flex = `${w.res} 1 0`;
  });
  document.querySelectorAll(".dual-head__d").forEach((el) => {
    /** @type {HTMLElement} */ (el).style.flex = `${w.dir} 1 0`;
  });
  document.querySelectorAll(".sync-slot--r").forEach((el) => {
    /** @type {HTMLElement} */ (el).style.flex = `${w.res} 1 0`;
  });
  document.querySelectorAll(".sync-slot--d").forEach((el) => {
    /** @type {HTMLElement} */ (el).style.flex = `${w.dir} 1 0`;
  });
  document.querySelectorAll(".sync-band").forEach((el) => {
    const s = parseInt(/** @type {HTMLElement} */ (el).dataset.slot || "0", 10);
    if (s >= 0 && s < SLOTS_PER_PAGE) {
      /** @type {HTMLElement} */ (el).style.flex = `${rw[s]} 1 0`;
    }
  });
}

/** 导入：由 index 里 label[for=pdf-input] 原生打开文件选择，避免依赖 input.click() */
els.pdfInput?.addEventListener("change", (e) => {
  const f = /** @type {HTMLInputElement} */ (e.target).files?.[0];
  if (f) void loadPdf(f);
  if (els.pdfInput) els.pdfInput.value = "";
});

/**
 * @param {Uint8Array} data
 */
async function parsePdfToPages(data) {
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  const pages = [];
  const scale = 2.35;
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const vp = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(vp.width);
    canvas.height = Math.floor(vp.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas unsupported");
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    pages.push({ pageIndex: p, pageUrl: canvas.toDataURL("image/jpeg", 0.92) });
  }
  return pages;
}

/**
 * @param {File} file
 */
async function loadPdf(file) {
  if (!pdfJsReady) {
    if (els.main && !state.pages.length) renderBoard();
    return;
  }
  state.lastPdfFile = file;
  state.currentArchiveId = null;
  state.sessionSlots = null;
  els.main.innerHTML =
    '<div class="loading"><div class="spinner"></div><span>正在解析 PDF…</span></div>';
  try {
    const data = new Uint8Array(await file.arrayBuffer());
    state.fromShare = false;
    state.shareReadOnly = false;
    document.body.classList.remove("share-readonly");
    state.pages = await parsePdfToPages(data);
    renderBoard();
    updateShareChrome();
    await persistNewArchiveFromImport(file);
  } catch (err) {
    console.error(err);
    state.pages = [];
    els.main.innerHTML =
      '<div class="empty-state">PDF 解析失败：' +
      String(/** @type {Error} */ (err).message || err) +
      "。若用 file:// 打开且控制台有跨域提示，请改用 <code style=\"color:#b8d4ff\">python3 -m http.server</code> 访问。</div>";
    updateShareChrome();
  }
}

/** 从当前 DOM 收集每个参考格与文字（键为 r-p1-s0 / d-p1-s0） */
function collectSlotPayload() {
  /** @type {Record<string, { urls: string[]; text: string }>} */
  const slots = {};
  document.querySelectorAll("[data-dropzone]").forEach((el) => {
    const id = el.getAttribute("data-dropzone");
    if (!id) return;
    const block = el.closest(".feedback-block");
    const ta = block?.querySelector("textarea.feedback-text");
    slots[id] = { urls: readUrlsFromZone(/** @type {HTMLElement} */ (el)), text: ta?.value || "" };
  });
  return slots;
}

/**
 * @param {Record<string, { urls: string[]; text: string }>} slots
 */
function applySlotPayload(slots) {
  Object.keys(slots).forEach((id) => {
    const dz = document.querySelector(`[data-dropzone="${id}"]`);
    if (!(dz instanceof HTMLElement)) return;
    const { urls, text } = slots[id];
    const block = dz.closest(".feedback-block");
    const ta = block?.querySelector("textarea.feedback-text");
    if (ta instanceof HTMLTextAreaElement) ta.value = text || "";
    if (urls && urls.length) {
      dz.dataset.refUrls = JSON.stringify(urls);
      dz.classList.add("has-image");
      refreshDropzoneVisuals(dz);
    } else {
      clearDropzone(dz);
    }
  });
}

/** @type {number} */
let autosaveTimer = 0;

/**
 * @param {Record<string, { urls: string[]; text: string }> | null} slots
 */
function cloneSlots(slots) {
  if (!slots || typeof slots !== "object") return null;
  try {
    return JSON.parse(JSON.stringify(slots));
  } catch (_) {
    return null;
  }
}

function scheduleAutosave() {
  if (state.collabActive && typeof window.__collabLayoutChanged === "function") {
    window.__collabLayoutChanged();
    return;
  }
  if (state.view !== "work" || state.shareReadOnly || !state.pages.length) return;
  if (autosaveTimer) clearTimeout(autosaveTimer);
  autosaveTimer = window.setTimeout(() => {
    autosaveTimer = 0;
    void flushAutosaveOnce();
  }, 650);
}

/** 将当前编辑区写入 sessionSlots，并在有归档 id 时写入 IndexedDB */
async function flushAutosaveOnce() {
  if (state.view !== "work" || state.shareReadOnly || !state.pages.length) return;
  const m = document.getElementById("main");
  if (!m?.querySelector("[data-dropzone]")) return;
  state.sessionSlots = collectSlotPayload();
  if (state.collabActive) return;
  if (!state.currentArchiveId || !window.ArchiveDB || state.fromShare) return;
  try {
    const row = await window.ArchiveDB.getArchive(state.currentArchiveId);
    if (!row) return;
    row.slots = state.sessionSlots;
    row.meta = { pane: loadPaneWeights(), refCol: loadRefColPx(), rows: loadRowWeights() };
    row.updatedAt = Date.now();
    await window.ArchiveDB.putArchive(row);
  } catch (e) {
    console.warn("自动保存失败", e);
  }
}

async function flushAutosaveNow() {
  if (autosaveTimer) {
    clearTimeout(autosaveTimer);
    autosaveTimer = 0;
  }
  await flushAutosaveOnce();
}

function initSessionAutosaveOnce() {
  if (window.__sessionAutosaveWired) return;
  window.__sessionAutosaveWired = true;
  document.addEventListener(
    "input",
    (e) => {
      if (!(e.target instanceof HTMLTextAreaElement)) return;
      if (!e.target.classList.contains("feedback-text")) return;
      if (state.view !== "work") return;
      scheduleAutosave();
    },
    true,
  );
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void flushAutosaveNow();
  });
}

function initDropzonePasteRoutingOnce() {
  if (window.__dzPasteRouting) return;
  window.__dzPasteRouting = true;
  document.addEventListener(
    "pointerdown",
    (e) => {
      if (!(e.target instanceof Element)) return;
      const t = e.target;
      if (t.closest("textarea.feedback-text")) {
        activePasteDropzone = null;
        return;
      }
      const dz = t.closest("[data-dropzone]");
      if (!dz) activePasteDropzone = null;
    },
    true,
  );
  document.addEventListener("paste", (e) => {
    if (state.shareReadOnly || state.view !== "work") return;
    const gal = document.getElementById("ref-gallery");
    if (gal && !gal.hidden) return;
    const lb = document.getElementById("storyboard-lightbox");
    if (lb && !lb.hidden) return;
    const zone = activePasteDropzone;
    if (!zone || !document.body.contains(zone)) return;
    const cd = e.clipboardData;
    if (!cd) return;
    const imgs = [];
    for (const it of cd.items) {
      if (it.kind === "file" && it.type.startsWith("image/")) {
        const f = it.getAsFile();
        if (f) imgs.push(f);
      }
    }
    if (!imgs.length) return;
    e.preventDefault();
    const append = zone.classList.contains("has-image");
    void setZoneImages(zone, imgs, { append });
  });
}

/**
 * @param {File} file
 */
async function persistNewArchiveFromImport(file) {
  if (state.fromShare) return;
  if (!window.ArchiveDB) return;
  try {
    const meta = {
      pane: loadPaneWeights(),
      refCol: loadRefColPx(),
      rows: loadRowWeights(),
    };
    const slots = collectSlotPayload();
    const name = (file.name || "分镜").replace(/\.pdf$/i, "") || "分镜";
    const row = {
      id: window.ArchiveDB.uid("arc"),
      folderId: null,
      name,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      pdfBlob: file,
      meta,
      slots,
      reviewStatus: "pending",
    };
    await window.ArchiveDB.putArchive(row);
    state.currentArchiveId = row.id;
  } catch (e) {
    console.warn("归档保存失败", e);
  }
}

/**
 * @param {string} id
 */
async function openArchiveForEdit(id) {
  if (!pdfJsReady) {
    showEditorView();
    if (els.main) {
      els.main.innerHTML =
        '<div class="empty-state empty-state--warn"><p><strong>无法打开归档</strong>：PDF 解析库未加载。请检查网络后刷新页面。</p></div>';
    }
    return;
  }
  if (!window.ArchiveDB) return;
  state.fromShare = false;
  state.shareReadOnly = false;
  const row = await window.ArchiveDB.getArchive(id);
  if (!row || !row.pdfBlob) return;
  state.currentArchiveId = id;
  if (row.meta) {
    if (row.meta.pane) savePaneWeights(row.meta.pane);
    if (typeof row.meta.refCol === "number") saveRefColPx(row.meta.refCol);
    if (Array.isArray(row.meta.rows) && row.meta.rows.length === SLOTS_PER_PAGE) saveRowWeights(row.meta.rows);
  }
  applyAllLayoutGlobals();
  els.main.innerHTML =
    '<div class="loading"><div class="spinner"></div><span>正在打开归档…</span></div>';
  try {
    const buf = await row.pdfBlob.arrayBuffer();
    const data = new Uint8Array(buf);
    state.pages = await parsePdfToPages(data);
    state.lastPdfFile = row.pdfBlob instanceof File ? row.pdfBlob : new File([row.pdfBlob], "doc.pdf", { type: "application/pdf" });
    showEditorView();
    state.sessionSlots = row.slots && typeof row.slots === "object" ? cloneSlots(row.slots) : null;
    renderBoard();
    updateShareChrome();
  } catch (e) {
    console.error(e);
    els.main.innerHTML = '<div class="empty-state">无法打开该归档 PDF。</div>';
    updateShareChrome();
  }
}

/** Finder 风格文件夹图标（currentColor） */
function svgIconFolder() {
  return `<svg class="fld-svg fld-svg--folder" viewBox="0 0 20 20" aria-hidden="true"><path d="M3 4.5h4.2l1 2H17A1.5 1.5 0 0118.5 8v8A1.5 1.5 0 0117 17.5H3A1.5 1.5 0 011.5 16V6A1.5 1.5 0 013 4.5z" fill="currentColor" fill-opacity="0.38"/><path d="M2.5 7h15v9a1 1 0 01-1 1h-13a1 1 0 01-1-1V7z" fill="currentColor"/></svg>`;
}

function svgIconAll() {
  return `<svg class="fld-svg fld-svg--all" viewBox="0 0 20 20" aria-hidden="true"><path fill="currentColor" fill-opacity="0.85" d="M3 4h6v6H3V4zm8 0h6v6h-6V4zM3 12h6v6H3v-6zm8 0h6v6h-6v-6z"/></svg>`;
}

function svgIconInbox() {
  return `<svg class="fld-svg fld-svg--inbox" viewBox="0 0 20 20" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.4" d="M3.5 6.5h4l1.2-2h2.6l1.2 2h4v9h-13v-9z"/><path fill="currentColor" fill-opacity="0.35" d="M3.5 10h13l-2.2 4.5H5.7L3.5 10z"/></svg>`;
}

const SHARE_BUNDLE_V = 1;
/** 过长时改下载 JSON，避免浏览器截断地址栏 */
const SHARE_MAX_HASH_CHARS = 360000;

/** @typedef {"pending" | "done" | "final"} ReviewStatus */
/** @type {Record<ReviewStatus, string>} */
const REVIEW_STATUS_LABEL = {
  pending: "同步审核",
  done: "审核完成",
  final: "确认终版",
};

/** @param {unknown} s */
function normalizeReviewStatus(s) {
  if (s === "done" || s === "final") return /** @type {ReviewStatus} */ (s);
  return "pending";
}

/** @param {Uint8Array} bytes */
function bytesToBase64Url(bytes) {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    const sub = bytes.subarray(i, i + chunk);
    binary += String.fromCharCode.apply(null, Array.from(sub));
  }
  const b64 = btoa(binary);
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/u, "");
}

/** @param {string} s */
function base64UrlToBytes(s) {
  let b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  while (b64.length % 4) b64 += "=";
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * @param {unknown} data
 * @param {boolean} readOnly
 */
function applySharePayloadToState(data, readOnly) {
  if (!data || typeof data !== "object") throw new Error("无效数据");
  const d = /** @type {{ v?: number; pages?: unknown; slots?: Record<string, { urls: string[]; text: string }>; meta?: { pane?: unknown; refCol?: number; rows?: number[] }; readOnly?: boolean }} */ (data);
  if (d.v !== SHARE_BUNDLE_V || !Array.isArray(d.pages) || !d.pages.length) throw new Error("版本或分镜数据无效");
  state.pages = /** @type {{ pageIndex: number; pageUrl: string }[]} */ (d.pages);
  state.fromShare = true;
  state.shareReadOnly = readOnly || !!d.readOnly;
  state.currentArchiveId = null;
  state.lastPdfFile = null;
  state.pendingShareSlots = d.slots && typeof d.slots === "object" ? d.slots : null;
  if (d.meta && typeof d.meta === "object") {
    const m = d.meta;
    if (m.pane && typeof m.pane === "object") savePaneWeights(/** @type {{ story: number; res: number; dir: number }} */ (m.pane));
    if (typeof m.refCol === "number") saveRefColPx(m.refCol);
    if (Array.isArray(m.rows) && m.rows.length === SLOTS_PER_PAGE) saveRowWeights(m.rows);
  }
  document.body.classList.toggle("share-readonly", state.shareReadOnly);
}

/** @param {string} b64 */
async function decodeShareBundle(b64) {
  const bytes = base64UrlToBytes(b64.trim());
  if (bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) {
    if (typeof DecompressionStream === "undefined") throw new Error("浏览器不支持解压");
    const ds = new DecompressionStream("gzip");
    const text = await new Response(new Blob([bytes]).stream().pipeThrough(ds)).text();
    return JSON.parse(text);
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

/** @param {object} obj */
async function encodeShareBundle(obj) {
  const json = JSON.stringify(obj);
  if (typeof CompressionStream !== "undefined") {
    const cs = new CompressionStream("gzip");
    const buf = new Uint8Array(await new Response(new Blob([json]).stream().pipeThrough(cs)).arrayBuffer());
    return bytesToBase64Url(buf);
  }
  return bytesToBase64Url(new TextEncoder().encode(json));
}

const COLLAB_LINK_V = 1;

/** @param {{ v: number, ws: string, room: string, token: string, role: "edit" | "read" }} obj */
async function encodeCollabLink(obj) {
  return bytesToBase64Url(new TextEncoder().encode(JSON.stringify(obj)));
}

/** @param {string} b64 */
function decodeCollabLink(b64) {
  const bytes = base64UrlToBytes(b64.trim());
  return JSON.parse(new TextDecoder().decode(bytes));
}

function collabRandomHex(n) {
  const arr = new Uint8Array(Math.ceil(n / 2));
  crypto.getRandomValues(arr);
  return Array.from(arr, (x) => x.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, n);
}

async function ensureCollabModule() {
  try {
    await import("./collab-client.mjs");
  } catch (e) {
    console.error(e);
    throw new Error("无法加载协作模块：请使用 http(s):// 打开本页（不要用 file://）。");
  }
}

function applyCollabFromY() {
  const ydoc = state.collabSession?.ydoc;
  if (!ydoc || typeof window.__collabReadYDoc !== "function") return;
  const snap = window.__collabReadYDoc(ydoc);
  if (!snap.pages?.length) return;
  const needsFull = !document.querySelector(".page-section");
  state.pages = /** @type {{ pageIndex: number; pageUrl: string }[]} */ (snap.pages);
  if (snap.meta && typeof snap.meta === "object") {
    const m = snap.meta;
    if (m.pane && typeof m.pane === "object") savePaneWeights(/** @type {{ story: number; res: number; dir: number }} */ (m.pane));
    if (typeof m.refCol === "number") saveRefColPx(m.refCol);
    if (Array.isArray(m.rows) && m.rows.length === SLOTS_PER_PAGE) saveRowWeights(m.rows);
  }
  state.sessionSlots = cloneSlots(snap.slots) || {};
  if (needsFull) {
    showEditorView();
    renderBoard();
    updateShareChrome();
    return;
  }
  applyAllLayoutGlobals();
  for (const p of snap.pages) {
    const img = document.querySelector(`section[data-page-index="${p.pageIndex}"] .pane-story-body img`);
    if (img instanceof HTMLImageElement) img.src = p.pageUrl;
  }
  applySlotPayload(snap.slots);
}

function destroyCollabSessionLocal() {
  if (state.collabSession && typeof state.collabSession.destroy === "function") {
    try {
      state.collabSession.destroy();
    } catch (_) {
      /* ignore */
    }
  }
  state.collabSession = null;
  state.collabActive = false;
  delete window.__collabGetMeta;
  delete window.__collabApplyFromY;
}

/**
 * @returns {Promise<boolean>}
 */
async function tryConsumeCollabHash() {
  const raw = location.hash.replace(/^#/, "");
  if (!raw.startsWith("collab-v1=")) return false;
  const b64 = raw.slice("collab-v1=".length);
  if (!b64) return false;
  let link;
  try {
    link = decodeCollabLink(b64);
  } catch (e) {
    console.error(e);
    return false;
  }
  if (
    !link ||
    typeof link !== "object" ||
    /** @type {{ v?: number }} */ (link).v !== COLLAB_LINK_V ||
    typeof /** @type {{ ws?: string }} */ (link).ws !== "string" ||
    typeof /** @type {{ room?: string }} */ (link).room !== "string" ||
    typeof /** @type {{ token?: string }} */ (link).token !== "string"
  ) {
    return false;
  }
  const L = /** @type {{ ws: string; room: string; token: string; role?: string }} */ (link);
  const readOnly = L.role === "read";
  if (window.location.protocol === "https:" && L.ws.startsWith("http://")) {
    if (els.main) {
      els.main.innerHTML =
        '<div class="empty-state empty-state--warn"><p><strong>无法连接协作</strong>：当前页面为 HTTPS 时，协作服务地址须为 <code>https://</code> 或 <code>wss://</code>（不能使用纯 <code>http://</code>）。</p></div>';
    }
    state.fromShare = true;
    state.shareReadOnly = true;
    state.collabActive = false;
    document.body.classList.add("share-readonly");
    return true;
  }
  try {
    await ensureCollabModule();
  } catch (e) {
    console.error(e);
    alert(String(/** @type {Error} */ (e).message || e));
    return false;
  }
  if (typeof window.__collabJoinSession !== "function") {
    alert("协作模块未就绪，请使用 http(s):// 打开本页。");
    return false;
  }
  state.fromShare = true;
  state.shareReadOnly = readOnly;
  state.collabActive = true;
  state.currentArchiveId = null;
  state.lastPdfFile = null;
  document.body.classList.toggle("share-readonly", state.shareReadOnly);
  showEditorView();
  if (els.main) els.main.innerHTML = '<div class="loading"><div class="spinner"></div><span>正在连接协作房间…</span></div>';
  window.__collabGetMeta = () => ({
    pane: loadPaneWeights(),
    refCol: loadRefColPx(),
    rows: loadRowWeights(),
  });
  window.__collabApplyFromY = applyCollabFromY;
  const sess = window.__collabJoinSession(L.ws, L.room, L.token, readOnly, {
    onSynced: () => updateShareChrome(),
  });
  state.collabSession = sess;
  return true;
}

function loadCollabWsDefault() {
  try {
    const s = localStorage.getItem(LS_COLLAB_WS);
    return s && s.trim() ? s.trim() : "http://127.0.0.1:2345";
  } catch (_) {
    return "http://127.0.0.1:2345";
  }
}

function saveCollabWsDefault(ws) {
  try {
    localStorage.setItem(LS_COLLAB_WS, ws.trim());
  } catch (_) {
    /* ignore */
  }
}

/**
 * @param {"edit" | "read"} linkRole
 */
async function buildCollabClipboardLink(wsBase, roomId, token, linkRole) {
  const payload = { v: COLLAB_LINK_V, ws: wsBase.trim(), room: roomId, token, role: linkRole };
  const b64 = await encodeCollabLink(payload);
  const base = `${location.origin}${location.pathname}${location.search || ""}`;
  return `${base}#collab-v1=${b64}`;
}

async function startCollabHostFlow() {
  if (!state.pages.length) {
    alert("请先导入 PDF 分镜后再开启协作。");
    return;
  }
  const wsDefault = loadCollabWsDefault();
  const wsIn = prompt("协作服务器 HTTP 根地址（需已运行 collab-server，含端口）\n示例：http://127.0.0.1:2345 或 https://协作域名", wsDefault);
  if (!wsIn || !wsIn.trim()) return;
  const wsBase = wsIn.trim();
  saveCollabWsDefault(wsBase);
  const roomId = "r" + collabRandomHex(12);
  const token = collabRandomHex(32);
  try {
    await ensureCollabModule();
    await window.__collabRegisterRoom(wsBase, roomId, token);
  } catch (e) {
    console.error(e);
    alert("注册协作房间失败（请确认服务已启动且可访问 POST /api/room）：\n" + String(/** @type {Error} */ (e).message || e));
    return;
  }
  window.__collabGetMeta = () => ({
    pane: loadPaneWeights(),
    refCol: loadRefColPx(),
    rows: loadRowWeights(),
  });
  window.__collabApplyFromY = applyCollabFromY;
  const slots = collectSlotPayload();
  const meta = { pane: loadPaneWeights(), refCol: loadRefColPx(), rows: loadRowWeights() };
  const sess = window.__collabHostSession(wsBase, roomId, token, { pages: state.pages, slots, meta }, {
    onSynced: () => updateShareChrome(),
  });
  state.collabSession = sess;
  state.collabActive = true;
  state.sessionSlots = cloneSlots(slots);
  try {
    const editUrl = await buildCollabClipboardLink(wsBase, roomId, token, "edit");
    const readUrl = await buildCollabClipboardLink(wsBase, roomId, token, "read");
    await navigator.clipboard.writeText(editUrl);
    prompt(
      "协作房间已开启（最多 6 人同时编辑）。已复制「编辑」链接到剪贴板。\n\n请妥善保存口令：仅持有链接者可进入房间。\n\n「阅读」链接（人数不限，仅浏览）：",
      readUrl,
    );
  } catch (_) {
    const editUrl = await buildCollabClipboardLink(wsBase, roomId, token, "edit");
    const readUrl = await buildCollabClipboardLink(wsBase, roomId, token, "read");
    prompt("协作已开启。编辑链接（≤6 人同时改）：", editUrl);
    prompt("阅读链接（人数不限）：", readUrl);
  }
  updateShareChrome();
}

function exitCollabOnly() {
  destroyCollabSessionLocal();
  updateShareChrome();
}

function buildShareObject(readOnly) {
  const slots = collectSlotPayload();
  const meta = { pane: loadPaneWeights(), refCol: loadRefColPx(), rows: loadRowWeights() };
  return { v: SHARE_BUNDLE_V, readOnly, pages: state.pages, slots, meta };
}

/**
 * @param {object} obj
 * @param {string} filename
 */
function downloadJsonFile(obj, filename) {
  const text = JSON.stringify(obj, null, 2);
  const blob = new Blob([text], { type: "application/json;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

/**
 * @param {boolean} readOnlyLink true = 阅读分享
 */
async function copyOrDownloadShare(readOnlyLink) {
  if (!state.pages.length) return;
  const obj = buildShareObject(readOnlyLink);
  const b64 = await encodeShareBundle(obj);
  const prefix = readOnlyLink ? "share-read=" : "share-edit=";
  const base = `${location.origin}${location.pathname}${location.search || ""}`;
  const full = `${base}#${prefix}${b64}`;
  if (full.length > SHARE_MAX_HASH_CHARS) {
    downloadJsonFile(obj, readOnlyLink ? "分镜阅读分享.json" : "分镜审核分享.json");
    alert(
      "内容过长，已下载分享包（.json）。\n\n如何自测：\n" +
        "1）用本地服务打开本页（不要用浏览器直接打开 json 当网页）。\n" +
        "2）点击顶部「导入分享」，选中刚下载的 json 文件。\n\n" +
        "说明：用记事本/浏览器打开 json 时，里面会有很长的 data:image… 字段，看起来像乱码，这是正常的图片编码，请始终用「导入分享」加载。",
    );
    return;
  }
  try {
    await navigator.clipboard.writeText(full);
    alert(
      readOnlyLink
        ? "已复制「阅读分享」链接。对方用浏览器打开即可（仅预览）。\n若体积过大无法放进地址栏，会改为下载 JSON，请用「导入分享」打开。\n固定短链需上线后在服务端保存分享数据并由短链跳转本页。"
        : "已复制「审核分享」链接。对方打开即可继续编辑参考图与文字。\n若体积过大无法放进地址栏，会改为下载 JSON，请用「导入分享」打开。\n固定短链需上线后在服务端保存分享数据并由短链跳转本页。",
    );
  } catch (_) {
    prompt("请手动复制以下链接：", full);
  }
}

async function tryConsumeShareHash() {
  const raw = location.hash.replace(/^#/, "");
  if (!raw) return false;
  let readOnly = null;
  let b64 = null;
  if (raw.startsWith("share-read=")) {
    readOnly = true;
    b64 = raw.slice("share-read=".length);
  } else if (raw.startsWith("share-edit=")) {
    readOnly = false;
    b64 = raw.slice("share-edit=".length);
  } else return false;
  if (!b64) return false;
  const data = await decodeShareBundle(b64);
  applySharePayloadToState(data, readOnly);
  return true;
}

/**
 * @param {string} jsonText
 */
async function importShareFromJsonText(jsonText) {
  const data = JSON.parse(jsonText);
  const ro = !!data.readOnly;
  applySharePayloadToState(data, ro);
  history.replaceState(null, "", `${location.pathname}${location.search || ""}`);
  showEditorView();
  applyAllLayoutGlobals();
  renderBoard();
  if (state.pendingShareSlots) {
    applySlotPayload(state.pendingShareSlots);
    state.sessionSlots = cloneSlots(state.pendingShareSlots);
    state.pendingShareSlots = null;
  }
  updateShareChrome();
}

function exitShareView() {
  hideTextHoverLayer();
  destroyCollabSessionLocal();
  state.fromShare = false;
  state.shareReadOnly = false;
  state.pages = [];
  state.pendingShareSlots = null;
  state.sessionSlots = null;
  document.body.classList.remove("share-readonly");
  history.replaceState(null, "", `${location.pathname}${location.search || ""}`);
  updateShareChrome();
  renderBoard();
}

function updateShareChrome() {
  const shareRow = document.getElementById("share-actions");
  const exit = document.getElementById("btn-exit-share");
  const exitCollab = document.getElementById("btn-exit-collab");
  const hint = document.getElementById("share-mode-hint");
  const pdfLab = document.querySelector(".pdf-import-label");
  const arch = document.getElementById("btn-archive-lib");
  const impLab = document.querySelector(".share-import-label");
  const impIn = document.getElementById("share-import-input");
  if (!shareRow || !exit || !hint) return;

  const inLibrary = state.view === "library";

  if (exitCollab instanceof HTMLElement) {
    const showExitCollab = state.collabActive && !state.fromShare;
    exitCollab.hidden = !showExitCollab;
    exitCollab.style.display = showExitCollab ? "" : "none";
  }

  if (state.collabActive && !state.fromShare) {
    exit.hidden = true;
    hint.hidden = false;
    hint.textContent =
      "「实时协作」已开启：多人同步编辑当前分镜与参考图。主持人已将编辑/阅读链接发出；编辑链接最多 6 人同时在线，阅读链接人数不限。可继续使用「审核分享 / 阅读分享」导出静态快照。";
    if (pdfLab instanceof HTMLElement) pdfLab.style.display = "";
    const pi = document.getElementById("pdf-input");
    if (pi) pi.style.display = "";
    if (arch instanceof HTMLElement) arch.style.display = inLibrary ? "none" : "";
    if (impLab instanceof HTMLElement) impLab.style.display = "";
    if (impIn instanceof HTMLElement) impIn.style.display = "";
    const showShare = state.view === "work" && state.pages.length > 0 && !inLibrary;
    shareRow.hidden = !showShare;
    return;
  }

  if (state.fromShare) {
    exit.hidden = false;
    hint.hidden = false;
    const collabTag = state.collabActive ? "（实时协作房间）" : "";
    hint.textContent = state.shareReadOnly
      ? collabTag + "当前为「阅读分享」：可浏览分镜、参考图与文字悬停预览、图片放大；不可编辑或上传。"
      : collabTag + "当前为「审核分享」：可继续编辑参考图与文字、使用全部预览与布局拖拽；也可再次生成分享。";
    const hideCore = state.shareReadOnly;
    if (pdfLab instanceof HTMLElement) pdfLab.style.display = hideCore ? "none" : "";
    const pi = document.getElementById("pdf-input");
    if (pi) pi.style.display = hideCore ? "none" : "";
    if (arch instanceof HTMLElement) arch.style.display = hideCore ? "none" : "";
    if (impLab instanceof HTMLElement) impLab.style.display = "";
    if (impIn instanceof HTMLElement) impIn.style.display = "";
    shareRow.hidden = !(state.pages.length > 0 && !state.shareReadOnly && !inLibrary);
  } else {
    exit.hidden = true;
    hint.hidden = true;
    if (pdfLab instanceof HTMLElement) pdfLab.style.display = "";
    const pi = document.getElementById("pdf-input");
    if (pi) pi.style.display = "";
    if (arch instanceof HTMLElement) arch.style.display = inLibrary ? "none" : "";
    if (impLab instanceof HTMLElement) impLab.style.display = "";
    if (impIn instanceof HTMLElement) impIn.style.display = "";
    const showShare = state.view === "work" && state.pages.length > 0 && !inLibrary;
    shareRow.hidden = !showShare;
  }
}

function wireShareUi() {
  document.getElementById("btn-share-edit")?.addEventListener("click", () => void copyOrDownloadShare(false));
  document.getElementById("btn-share-read")?.addEventListener("click", () => void copyOrDownloadShare(true));
  document.getElementById("btn-exit-share")?.addEventListener("click", () => exitShareView());
  document.getElementById("btn-exit-collab")?.addEventListener("click", () => exitCollabOnly());
  document.getElementById("btn-collab-host")?.addEventListener("click", () => void startCollabHostFlow());
  document.getElementById("share-import-input")?.addEventListener("change", (e) => {
    const f = /** @type {HTMLInputElement} */ (e.target).files?.[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      try {
        void importShareFromJsonText(String(r.result || ""));
      } catch (err) {
        console.error(err);
        alert("分享文件格式无效。");
      }
    };
    r.readAsText(f);
    /** @type {HTMLInputElement} */ (e.target).value = "";
  });
}

/** @type {number | undefined} */
let textHoverHideTimer;
/** @type {HTMLTextAreaElement | null} */
let textHoverActiveTa = null;
/** @type {(() => void) | null} */
let textHoverRepositionFn = null;

/** 支持 Popover 的浏览器用顶层弹层，避免 details+fixed 被误判为「点在外面」而立刻收起 */
const ARCH_STATUS_USE_POPOVER = typeof HTMLElement.prototype.showPopover === "function";

/** @param {HTMLElement} btn @param {HTMLElement} menu */
function positionArchStatusPopover(btn, menu) {
  const gap = 6;
  const margin = 8;
  menu.style.position = "fixed";
  menu.style.inset = "auto";
  menu.style.margin = "0";
  menu.style.minWidth = `${Math.max(176, Math.ceil(btn.getBoundingClientRect().width))}px`;
  void menu.offsetHeight;
  const mw = menu.offsetWidth;
  const mh = menu.offsetHeight;
  const br = btn.getBoundingClientRect();
  let left = br.right - mw;
  left = Math.max(margin, Math.min(left, window.innerWidth - mw - margin));
  let top = br.bottom + gap;
  if (top + mh > window.innerHeight - margin) top = br.top - mh - gap;
  if (top < margin) top = margin;
  menu.style.left = `${Math.round(left)}px`;
  menu.style.top = `${Math.round(top)}px`;
}

let archPopoverResizeWired = false;

function wireArchStatusPopoverResizeOnce() {
  if (archPopoverResizeWired) return;
  archPopoverResizeWired = true;
  const sync = () => {
    document.querySelectorAll(".arch-status-menu[popover]:popover-open").forEach((el) => {
      if (!(el instanceof HTMLElement)) return;
      const btn = el.previousElementSibling;
      if (btn instanceof HTMLElement) positionArchStatusPopover(btn, el);
    });
  };
  window.addEventListener("resize", sync);
  window.addEventListener("scroll", sync, true);
}

/**
 * @param {ParentNode} root
 */
function wireArchStatusPopoversIn(root) {
  if (!ARCH_STATUS_USE_POPOVER) return;
  wireArchStatusPopoverResizeOnce();
  root.querySelectorAll(".arch-status-menu[popover]").forEach((menu) => {
    if (!(menu instanceof HTMLElement) || menu.dataset.archPopWired) return;
    menu.dataset.archPopWired = "1";
    menu.addEventListener("beforetoggle", (ev) => {
      const te = /** @type {ToggleEvent} */ (ev);
      if (te.newState !== "open") return;
      document.querySelectorAll(".arch-status-menu[popover]").forEach((m) => {
        if (m === menu) return;
        if (m instanceof HTMLElement && m.matches(":popover-open")) m.hidePopover();
      });
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const btn = menu.previousElementSibling;
          if (btn instanceof HTMLElement) positionArchStatusPopover(btn, menu);
        });
      });
    });
    menu.addEventListener("toggle", (ev) => {
      const te = /** @type {ToggleEvent} */ (ev);
      if (te.newState !== "open") return;
      const btn = menu.previousElementSibling;
      if (btn instanceof HTMLElement) positionArchStatusPopover(btn, menu);
    });
  });
}

/**
 * @param {{ id: string }} a
 * @param {string} rs
 * @param {string} rsTxt 已 escape
 */
function archiveStatusControlHtml(a, rs, rsTxt) {
  const aid = escapeHtml(a.id);
  if (ARCH_STATUS_USE_POPOVER) {
    const safeId = String(a.id).replace(/[^a-zA-Z0-9_-]/g, "_");
    return `<div class="arch-status-wrap" data-aid="${aid}">
      <button type="button" class="arch-status-sum arch-status-sum--${rs}" popovertarget="arch-rs-${safeId}" popovertargetaction="toggle" id="arch-rs-btn-${safeId}">
        <span class="arch-status-dot" aria-hidden="true"></span><span class="arch-status-txt">${rsTxt}</span>
      </button>
      <ul id="arch-rs-${safeId}" class="arch-status-menu" popover="auto" role="listbox" aria-label="审核状态">
        <li><button type="button" class="arch-status-opt arch-status-opt--pending" data-status="pending"><span class="arch-status-dot" aria-hidden="true"></span><span>同步审核</span></button></li>
        <li><button type="button" class="arch-status-opt arch-status-opt--done" data-status="done"><span class="arch-status-dot" aria-hidden="true"></span><span>审核完成</span></button></li>
        <li><button type="button" class="arch-status-opt arch-status-opt--final" data-status="final"><span class="arch-status-dot" aria-hidden="true"></span><span>确认终版</span></button></li>
      </ul>
    </div>`;
  }
  return `<details class="arch-status-dd" data-aid="${aid}">
              <summary class="arch-status-sum arch-status-sum--${rs}"><span class="arch-status-dot" aria-hidden="true"></span><span class="arch-status-txt">${rsTxt}</span></summary>
                <ul class="arch-status-menu">
                  <li><button type="button" class="arch-status-opt arch-status-opt--pending" data-status="pending"><span class="arch-status-dot" aria-hidden="true"></span><span>同步审核</span></button></li>
                  <li><button type="button" class="arch-status-opt arch-status-opt--done" data-status="done"><span class="arch-status-dot" aria-hidden="true"></span><span>审核完成</span></button></li>
                  <li><button type="button" class="arch-status-opt arch-status-opt--final" data-status="final"><span class="arch-status-dot" aria-hidden="true"></span><span>确认终版</span></button></li>
                </ul>
              </details>`;
}

function hideTextHoverLayer() {
  if (textHoverHideTimer) {
    clearTimeout(textHoverHideTimer);
    textHoverHideTimer = undefined;
  }
  const layer = document.getElementById("text-hover-layer");
  if (layer) {
    layer.hidden = true;
    layer.textContent = "";
  }
  if (textHoverRepositionFn) {
    window.removeEventListener("scroll", textHoverRepositionFn, true);
    window.removeEventListener("resize", textHoverRepositionFn);
    textHoverRepositionFn = null;
  }
  textHoverActiveTa = null;
}

function initTextHoverLayerOnce() {
  const layer = document.getElementById("text-hover-layer");
  if (!layer || layer.dataset.wired) return;
  layer.dataset.wired = "1";
  layer.addEventListener("mouseenter", () => {
    if (textHoverHideTimer) clearTimeout(textHoverHideTimer);
  });
  layer.addEventListener("mouseleave", () => hideTextHoverLayer());
}

function positionTextHoverLayer(ta) {
  const layer = document.getElementById("text-hover-layer");
  if (!layer) return;
  const r = ta.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  /** 与文字框上/下边缘贴合的间距（viewport 像素） */
  const gap = 2;
  const margin = 8;
  const w = Math.min(440, Math.max(280, r.width), vw - margin * 2);
  let left = r.left;
  if (left + w > vw - margin) left = vw - margin - w;
  if (left < margin) left = margin;
  const maxHCap = Math.min(Math.floor(vh * 0.54), 440);

  const measureH = (maxH) => {
    layer.style.width = `${w}px`;
    layer.style.maxHeight = `${maxH}px`;
    layer.style.left = `${left}px`;
    layer.style.top = "-9999px";
    void layer.offsetHeight;
    return layer.getBoundingClientRect().height;
  };

  let maxH = maxHCap;
  let h = measureH(maxH);
  let top = r.bottom + gap;
  if (top + h > vh - margin) top = r.top - h - gap;
  if (top < margin) top = margin;
  if (top + h > vh - margin) {
    maxH = Math.max(96, vh - margin - top);
    h = measureH(maxH);
    top = r.bottom + gap;
    if (top + h > vh - margin) top = r.top - h - gap;
    if (top < margin) top = margin;
  }
  layer.style.maxHeight = `${maxH}px`;
  layer.style.top = `${top}px`;
}

/**
 * 文字区悬停：>90 字时在 body 固定层展示全文（置顶，不被分镜卡片遮挡）
 * @param {ParentNode} root
 */
function wireTextHoverPreviews(root) {
  initTextHoverLayerOnce();
  const layer = document.getElementById("text-hover-layer");
  if (!layer) return;

  root.querySelectorAll(".feedback-text-wrap").forEach((wrap) => {
    const ta = wrap.querySelector("textarea.feedback-text");
    if (!ta || !(ta instanceof HTMLTextAreaElement) || wrap.dataset.hoverWired) return;
    wrap.dataset.hoverWired = "1";

    function showLayer() {
      if (ta.value.length <= TEXT_PREVIEW_MIN_LEN) return;
      hideTextHoverLayer();
      layer.textContent = ta.value;
      layer.hidden = false;
      textHoverActiveTa = ta;
      positionTextHoverLayer(ta);
      textHoverRepositionFn = () => positionTextHoverLayer(ta);
      window.addEventListener("scroll", textHoverRepositionFn, true);
      window.addEventListener("resize", textHoverRepositionFn);
    }

    wrap.addEventListener("mouseenter", () => {
      requestAnimationFrame(showLayer);
    });
    wrap.addEventListener("mouseleave", (e) => {
      const rt = e.relatedTarget;
      if (rt instanceof Node && (rt === layer || layer.contains(rt))) return;
      textHoverHideTimer = window.setTimeout(() => {
        if (!layer.matches(":hover")) hideTextHoverLayer();
      }, 80);
    });
    ta.addEventListener("input", () => {
      if (!layer.hidden && textHoverActiveTa === ta) layer.textContent = ta.value;
    });
  });
}

/**
 * @param {unknown[]} archives
 * @param {{ key: "name" | "updated"; dir: "asc" | "desc" } | null} sort
 */
function applyArchiveSort(archives, sort) {
  if (!sort?.key) return archives;
  const arr = archives.slice();
  const mul = sort.dir === "desc" ? -1 : 1;
  if (sort.key === "name") {
    arr.sort((a, b) => {
      const na = String(/** @type {{ name?: string }} */ (a).name ?? "");
      const nb = String(/** @type {{ name?: string }} */ (b).name ?? "");
      return mul * na.localeCompare(nb, "zh-CN");
    });
  } else {
    arr.sort((a, b) => {
      const ta = Number(
        /** @type {{ updatedAt?: number; createdAt?: number }} */ (a).updatedAt ??
          /** @type {{ createdAt?: number }} */ (a).createdAt ??
          0,
      );
      const tb = Number(
        /** @type {{ updatedAt?: number; createdAt?: number }} */ (b).updatedAt ??
          /** @type {{ createdAt?: number }} */ (b).createdAt ??
          0,
      );
      return mul * (ta - tb);
    });
  }
  return arr;
}

/** @param {"name" | "updated"} column */
function cycleArchiveSort(column) {
  const cur = state.archiveSort;
  if (!cur || cur.key !== column) {
    state.archiveSort = { key: column, dir: "asc" };
    return;
  }
  state.archiveSort = { key: column, dir: cur.dir === "asc" ? "desc" : "asc" };
}

function showEditorView() {
  state.view = "work";
  const lib = document.getElementById("btn-archive-lib");
  const back = document.getElementById("btn-back-editor");
  if (lib) lib.style.display = "";
  if (back) back.style.display = "none";
  updateShareChrome();
}

async function showArchiveLibrary() {
  await flushAutosaveNow();

  state.view = "library";
  const lib = document.getElementById("btn-archive-lib");
  const back = document.getElementById("btn-back-editor");
  if (lib) lib.style.display = "none";
  if (back) back.style.display = "";

  if (!window.ArchiveDB || !els.main) return;
  const folders = await window.ArchiveDB.listFolders();
  const sortedFolders = [...folders].sort((a, b) => (a.sort || 0) - (b.sort || 0));

  let archives;
  if (state.libraryBrowse === "all") {
    archives = await window.ArchiveDB.listArchives(undefined);
  } else if (state.libraryBrowse === "unfiled") {
    archives = await window.ArchiveDB.listArchives(null);
  } else {
    archives = await window.ArchiveDB.listArchives(state.libraryBrowse);
  }

  const folderOpts = sortedFolders.map((f) => `<option value="${f.id}">${escapeHtml(f.name)}</option>`).join("");

  const browseLabel =
    state.libraryBrowse === "all"
      ? "全部归档"
      : state.libraryBrowse === "unfiled"
        ? "未分类"
        : escapeHtml(sortedFolders.find((x) => x.id === state.libraryBrowse)?.name || "文件夹");

  const srt = state.archiveSort;
  const thNameClass = `arch-sort-th${srt?.key === "name" ? ` arch-sort-th--on arch-sort-th--${srt.dir}` : ""}`;
  const thUpdClass = `arch-sort-th${srt?.key === "updated" ? ` arch-sort-th--on arch-sort-th--${srt.dir}` : ""}`;
  const ariaName = srt?.key === "name" ? (srt.dir === "asc" ? "ascending" : "descending") : "none";
  const ariaUpd = srt?.key === "updated" ? (srt.dir === "asc" ? "ascending" : "descending") : "none";
  const displayArchives = applyArchiveSort(archives, state.archiveSort);

  els.main.innerHTML = `
    <div class="archive-layout">
      <aside class="archive-side">
        <h3 class="archive-side-title">资料库</h3>
        <button type="button" class="btn btn-sm" id="fld-new">新建文件夹</button>
        <ul class="archive-folder-list" id="fld-list"></ul>
      </aside>
      <div class="archive-main">
        <div class="archive-toolbar">
          <span class="archive-breadcrumb" id="arch-crumb">${browseLabel}</span>
          <input type="file" id="arch-pdf-input" class="hidden-input" accept="application/pdf" title="" />
          <label for="arch-pdf-input" class="btn btn-sm btn-primary arch-pdf-label">上传 PDF</label>
          <span class="archive-muted">点击左侧文件夹筛选；点击名称进入编辑。</span>
        </div>
        <div class="archive-table-shell">
          <table class="archive-table">
            <colgroup>
              <col class="arch-col-name" />
              <col class="arch-col-upd" />
              <col class="arch-col-folder" />
              <col class="arch-col-actions" />
            </colgroup>
            <thead><tr>
              <th class="${thNameClass}" data-arch-sort="name" tabindex="0" role="columnheader" aria-sort="${ariaName}">
                <span class="arch-sort-label">名称</span><span class="arch-sort-indicator" aria-hidden="true"></span>
              </th>
              <th class="${thUpdClass}" data-arch-sort="updated" tabindex="0" role="columnheader" aria-sort="${ariaUpd}">
                <span class="arch-sort-label">更新</span><span class="arch-sort-indicator" aria-hidden="true"></span>
              </th>
              <th>文件夹</th><th>操作</th>
            </tr></thead>
            <tbody id="arch-tbody"></tbody>
          </table>
        </div>
      </div>
    </div>`;

  const fldList = document.getElementById("fld-list");
  if (fldList) {
    fldList.innerHTML = `
      <li class="fld-nav-item${state.libraryBrowse === "all" ? " is-active" : ""}" data-browse="all" role="button" tabindex="0">
        <span class="fld-nav-icon" aria-hidden="true">${svgIconAll()}</span>
        <span class="fld-nav-label">全部归档</span>
      </li>
      <li class="fld-nav-item${state.libraryBrowse === "unfiled" ? " is-active" : ""}" data-browse="unfiled" role="button" tabindex="0">
        <span class="fld-nav-icon" aria-hidden="true">${svgIconInbox()}</span>
        <span class="fld-nav-label">未分类</span>
      </li>
      ${sortedFolders
        .map(
          (f) => `
      <li class="fld-nav-item fld-nav-item--folder${state.libraryBrowse === f.id ? " is-active" : ""}" data-browse="folder" data-fid="${f.id}" role="button" tabindex="0">
        <span class="fld-nav-icon" aria-hidden="true">${svgIconFolder()}</span>
        <span class="fld-nav-label fld-nav-label--folder">${escapeHtml(f.name)}</span>
        <details class="fld-folder-menu">
          <summary class="fld-folder-menu-sum" aria-label="文件夹菜单">⋯</summary>
          <ul class="fld-folder-menu-list">
            <li><button type="button" class="fld-menu-rename" data-fid="${f.id}">重命名</button></li>
            <li><button type="button" class="fld-menu-del" data-fid="${f.id}">删除</button></li>
          </ul>
        </details>
      </li>`,
        )
        .join("")}`;
  }

  fldList?.addEventListener("click", (e) => {
    const t = /** @type {Element} */ (e.target);
    if (t.closest(".fld-folder-menu")) return;
    const row = t.closest(".fld-nav-item");
    if (!row) return;
    const br = row.getAttribute("data-browse");
    if (br === "all") state.libraryBrowse = "all";
    else if (br === "unfiled") state.libraryBrowse = "unfiled";
    else if (br === "folder") {
      const fid = row.getAttribute("data-fid");
      if (fid) state.libraryBrowse = fid;
    }
    void showArchiveLibrary();
  });

  fldList?.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const t = /** @type {Element} */ (e.target);
    const row = t.closest(".fld-nav-item");
    if (!row || t.closest("button") || t.closest(".fld-folder-menu")) return;
    e.preventDefault();
    row.click();
  });

  fldList?.querySelectorAll(".fld-menu-rename").forEach((b) => {
    b.addEventListener("click", async (ev) => {
      ev.stopPropagation();
      const det = b.closest(".fld-folder-menu");
      if (det instanceof HTMLDetailsElement) det.open = false;
      const id = b.getAttribute("data-fid");
      const f = sortedFolders.find((x) => x.id === id);
      const name = prompt("新名称", f?.name || "");
      if (!name || !id) return;
      await window.ArchiveDB.putFolder({ id, parentId: f?.parentId ?? null, name: name.trim(), sort: f?.sort });
      void showArchiveLibrary();
    });
  });
  fldList?.querySelectorAll(".fld-menu-del").forEach((b) => {
    b.addEventListener("click", async (ev) => {
      ev.stopPropagation();
      const det = b.closest(".fld-folder-menu");
      if (det instanceof HTMLDetailsElement) det.open = false;
      const id = b.getAttribute("data-fid");
      if (!id || !confirm("删除文件夹？（归档会移到未分类）")) return;
      await window.ArchiveDB.deleteFolder(id);
      if (state.libraryBrowse === id) state.libraryBrowse = "all";
      void showArchiveLibrary();
    });
  });

  const tbody = document.getElementById("arch-tbody");
  if (tbody) {
    tbody.innerHTML = displayArchives
      .map((a) => {
        const fd = sortedFolders.find((x) => x.id === a.folderId);
        const fdName = fd ? fd.name : "—";
        const t = new Date(a.updatedAt || a.createdAt).toLocaleString("zh-CN", { hour12: false });
        const rs = normalizeReviewStatus(a.reviewStatus);
        const rsTxt = escapeHtml(REVIEW_STATUS_LABEL[rs]);
        return `<tr data-aid="${a.id}">
          <td class="arch-name-cell"><button type="button" class="arch-name-btn" data-aid="${a.id}">${escapeHtml(a.name)}</button></td>
          <td>${escapeHtml(t)}</td>
          <td class="arch-folder-cell"><span class="arch-folder-txt">${escapeHtml(fdName)}</span></td>
          <td class="archive-actions">
            <div class="archive-actions__core">
              <button type="button" class="btn btn-sm arch-rename" data-aid="${a.id}">重命名</button>
              <select class="arch-move-sel" data-aid="${a.id}">
                <option value="">移动到…</option>
                <option value="__root__">未分类</option>
                ${folderOpts}
              </select>
            </div>
            <div class="archive-actions__tail">
              <button type="button" class="btn btn-sm arch-del" data-aid="${a.id}">删除</button>
              ${archiveStatusControlHtml(a, rs, rsTxt)}
            </div>
          </td></tr>`;
      })
      .join("");
  }

  els.main.querySelectorAll("[data-arch-sort]").forEach((th) => {
    th.addEventListener("click", () => {
      const col = th.getAttribute("data-arch-sort");
      if (col !== "name" && col !== "updated") return;
      cycleArchiveSort(col);
      void showArchiveLibrary();
    });
    th.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      (/** @type {HTMLElement} */ (th)).click();
    });
  });

  document.getElementById("fld-new")?.addEventListener("click", async () => {
    const name = prompt("文件夹名称");
    if (!name || !name.trim()) return;
    const row = await window.ArchiveDB.putFolder({ parentId: null, name: name.trim() });
    if (row && row.id) state.libraryBrowse = row.id;
    void showArchiveLibrary();
  });

  document.getElementById("arch-pdf-input")?.addEventListener("change", (e) => {
    const f = /** @type {HTMLInputElement} */ (e.target).files?.[0];
    if (f)
      void loadPdf(f).then(() => {
        if (state.pages.length) showEditorView();
      });
    (/** @type {HTMLInputElement} */ (e.target)).value = "";
  });

  const openById = (/** @type {string | null} */ id) => {
    if (id) void openArchiveForEdit(id);
  };

  tbody?.querySelectorAll(".arch-name-btn").forEach((b) => {
    b.addEventListener("click", () => openById(b.getAttribute("data-aid")));
  });
  tbody?.querySelectorAll(".arch-rename").forEach((b) => {
    b.addEventListener("click", async () => {
      const id = b.getAttribute("data-aid");
      if (!id) return;
      const a = await window.ArchiveDB.getArchive(id);
      if (!a) return;
      const name = prompt("归档名称", a.name || "");
      if (!name || !name.trim()) return;
      a.name = name.trim();
      a.updatedAt = Date.now();
      await window.ArchiveDB.putArchive(a);
      void showArchiveLibrary();
    });
  });
  tbody?.querySelectorAll(".arch-move-sel").forEach((sel) => {
    sel.addEventListener("change", async () => {
      const id = sel.getAttribute("data-aid");
      const v = /** @type {HTMLSelectElement} */ (sel).value;
      if (!id || !v) return;
      const a = await window.ArchiveDB.getArchive(id);
      if (!a) return;
      a.folderId = v === "__root__" ? null : v;
      a.updatedAt = Date.now();
      await window.ArchiveDB.putArchive(a);
      void showArchiveLibrary();
    });
  });
  tbody?.querySelectorAll(".arch-status-opt").forEach((opt) => {
    opt.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const status = opt.getAttribute("data-status");
      const wrap = opt.closest(".arch-status-wrap");
      const det = opt.closest(".arch-status-dd");
      const pop = opt.closest(".arch-status-menu");
      const id = wrap?.getAttribute("data-aid") ?? det?.getAttribute("data-aid");
      if (!id || (status !== "pending" && status !== "done" && status !== "final")) return;
      const a = await window.ArchiveDB.getArchive(id);
      if (!a) return;
      a.reviewStatus = status;
      a.updatedAt = Date.now();
      await window.ArchiveDB.putArchive(a);
      if (pop instanceof HTMLElement && "hidePopover" in pop) {
        /** @type {HTMLElement & { hidePopover: () => void }} */ (pop).hidePopover();
      }
      if (det instanceof HTMLDetailsElement) det.open = false;
      const sum = wrap?.querySelector(".arch-status-sum") ?? det?.querySelector(".arch-status-sum");
      if (sum) {
        const s = /** @type {ReviewStatus} */ (status);
        sum.className = `arch-status-sum arch-status-sum--${s}`;
        sum.innerHTML = `<span class="arch-status-dot" aria-hidden="true"></span><span class="arch-status-txt">${escapeHtml(REVIEW_STATUS_LABEL[s])}</span>`;
      }
    });
  });

  tbody?.querySelectorAll(".arch-del").forEach((b) => {
    b.addEventListener("click", async () => {
      const id = b.getAttribute("data-aid");
      if (!id || !confirm("确定删除该归档？")) return;
      await window.ArchiveDB.deleteArchive(id);
      void showArchiveLibrary();
    });
  });

  if (ARCH_STATUS_USE_POPOVER) wireArchStatusPopoversIn(els.main);

  updateShareChrome();
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function wireToolbarNav() {
  document.getElementById("btn-archive-lib")?.addEventListener("click", () => {
    state.libraryBrowse = "all";
    void showArchiveLibrary();
  });
  document.getElementById("btn-back-editor")?.addEventListener("click", () => {
    showEditorView();
    renderBoard();
  });
}

let fldFolderMenuOutsideCloseWired = false;

/** 侧栏文件夹「⋯」菜单：点击空白处自动收起 */
function wireFldFolderMenuOutsideCloseOnce() {
  if (fldFolderMenuOutsideCloseWired) return;
  fldFolderMenuOutsideCloseWired = true;
  document.addEventListener(
    "pointerdown",
    (e) => {
      if (!(e.target instanceof Element)) return;
      if (e.target.closest(".fld-folder-menu")) return;
      document.querySelectorAll("details.fld-folder-menu[open]").forEach((el) => {
        if (el instanceof HTMLDetailsElement) el.open = false;
      });
    },
    true,
  );
}

function feedbackTextHtml(fieldName, placeholder, readOnly) {
  const ro = readOnly ? ' readonly tabindex="-1"' : "";
  return `<div class="feedback-text-wrap">
      <textarea class="feedback-text" data-field="${fieldName}" placeholder="${placeholder}" rows="3"${ro}></textarea>
    </div>`;
}

function dropzoneHtml(idSuffix, readOnly) {
  const fid = `ref-file-${idSuffix}`;
  if (readOnly) {
    return `
    <div class="dropzone dropzone--readonly" data-dropzone="${idSuffix}" tabindex="0" role="region" aria-label="参考图预览">
      <div class="dz-inner">
        <div class="dz-thumb-strip" data-dz-strip></div>
        <span class="dz-hint">仅预览</span>
      </div>
    </div>`;
  }
  return `
    <div class="dropzone" data-dropzone="${idSuffix}" tabindex="0" role="button" aria-label="图片上传：点击、拖拽或移入后粘贴，支持多图">
      <div class="dz-inner">
        <div class="dz-thumb-strip" data-dz-strip></div>
        <span class="dz-hint">图片上传</span>
      </div>
      <label for="${fid}" class="dz-add" title="添加图片">+</label>
      <button type="button" class="dz-clear" title="清除全部" aria-label="清除参考图">×</button>
    </div>
    <input type="file" id="${fid}" class="hidden-input" data-file="${idSuffix}" accept="image/*" multiple />`;
}

function feedbackBlockHtml(role, idSuffix, placeholder, readOnly) {
  const cls = role === "research" ? "research" : "director";
  return `
    <div class="feedback-block ${cls}">
      <div class="feedback-grid">
        ${dropzoneHtml(idSuffix, readOnly)}
        <div class="refsplit-handle" title="拖动调整参考图与文字区宽度" aria-label="调整参考图列宽"></div>
        ${feedbackTextHtml(`${role}-text`, placeholder, readOnly)}
      </div>
    </div>`;
}

function initGlobalResizersOnce() {
  if (window.__grWired) return;
  window.__grWired = true;

  document.addEventListener("pointerdown", (e) => {
    if (state.shareReadOnly) return;
    if (!(e.target instanceof Element)) return;
    const t = /** @type {HTMLElement} */ (e.target);
    const gStory = t.closest('[data-gutter-kind="story"]');
    const gMid = t.closest('[data-gutter-kind="mid"]');
    const rowH = t.closest(".row-res-handle");
    const refH = t.closest(".refsplit-handle");

    if (gStory instanceof HTMLElement) return startStoryDrag(e, gStory);
    if (gMid instanceof HTMLElement) return startMidDrag(e, gMid);
    if (rowH instanceof HTMLElement) return startRowDrag(e, rowH);
    if (refH instanceof HTMLElement) return startRefColDrag(e, refH);
  });
}

/**
 * @param {PointerEvent} e
 * @param {HTMLElement} gutter
 */
function startStoryDrag(e, gutter) {
  if (e.button !== 0) return;
  e.preventDefault();
  document.documentElement.classList.add("layout-resizing");
  gutter.setPointerCapture(e.pointerId);
  let w = { ...loadPaneWeights() };
  const startX = e.clientX;
  const start = { ...w };
  const row = /** @type {HTMLElement} */ (gutter.closest(".page-panes"));
  const total = Math.max(400, row.getBoundingClientRect().width - 20);

  function onMove(ev) {
    const dx = ev.clientX - startX;
    const ds = (dx / total) * 100;
    let ns = start.story + ds;
    let nr = start.res - ds;
    if (ns < 18) {
      nr -= 18 - ns;
      ns = 18;
    }
    if (nr < 14) {
      ns -= 14 - nr;
      nr = 14;
    }
    w.story = ns;
    w.res = nr;
    w.dir = start.dir;
    savePaneWeights(w);
    applyAllLayoutGlobals();
  }
  function onUp() {
    document.documentElement.classList.remove("layout-resizing");
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    try {
      gutter.releasePointerCapture(e.pointerId);
    } catch (_) {
      /* ignore */
    }
    scheduleAutosave();
  }
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
}

/**
 * @param {PointerEvent} e
 * @param {HTMLElement} gutter
 */
function startMidDrag(e, gutter) {
  if (e.button !== 0) return;
  e.preventDefault();
  document.documentElement.classList.add("layout-resizing");
  gutter.setPointerCapture(e.pointerId);
  let w = { ...loadPaneWeights() };
  const startX = e.clientX;
  const start = { ...w };
  const row = /** @type {HTMLElement} */ (gutter.closest(".page-panes"));
  const total = Math.max(320, row.getBoundingClientRect().width * 0.45);

  function onMove(ev) {
    const dx = ev.clientX - startX;
    const ds = (dx / total) * 100;
    let nr = start.res + ds;
    let nd = start.dir - ds;
    if (nr < 14) {
      nd -= 14 - nr;
      nr = 14;
    }
    if (nd < 14) {
      nr -= 14 - nd;
      nd = 14;
    }
    w.res = nr;
    w.dir = nd;
    savePaneWeights(w);
    applyAllLayoutGlobals();
  }
  function onUp() {
    document.documentElement.classList.remove("layout-resizing");
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    try {
      gutter.releasePointerCapture(e.pointerId);
    } catch (_) {
      /* ignore */
    }
    scheduleAutosave();
  }
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
}

/**
 * @param {PointerEvent} e
 * @param {HTMLElement} handle
 */
function startRowDrag(e, handle) {
  if (e.button !== 0) return;
  e.preventDefault();
  document.documentElement.classList.add("layout-resizing");
  handle.setPointerCapture(e.pointerId);
  const after = parseInt(handle.dataset.after || "0", 10);
  const startRw = [...loadRowWeights()];
  const startY = e.clientY;
  const host = /** @type {HTMLElement} */ (handle.closest(".dual-body"));
  const h = Math.max(200, host?.getBoundingClientRect().height || 400);

  function onMove(ev) {
    const dy = ev.clientY - startY;
    const d = (dy / h) * 200;
    let a = startRw[after] + d;
    let b = startRw[after + 1] - d;
    if (a < 20) {
      b -= 20 - a;
      a = 20;
    }
    if (b < 20) {
      a -= 20 - b;
      b = 20;
    }
    const next = [...startRw];
    next[after] = a;
    next[after + 1] = b;
    saveRowWeights(next);
    applyAllLayoutGlobals();
  }
  function onUp() {
    document.documentElement.classList.remove("layout-resizing");
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    try {
      handle.releasePointerCapture(e.pointerId);
    } catch (_) {
      /* ignore */
    }
    scheduleAutosave();
  }
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
}

/**
 * @param {PointerEvent} e
 * @param {HTMLElement} h
 */
function startRefColDrag(e, h) {
  if (e.button !== 0) return;
  e.preventDefault();
  document.documentElement.classList.add("layout-resizing");
  h.setPointerCapture(e.pointerId);
  const startX = e.clientX;
  const startPx = loadRefColPx();

  function onMove(ev) {
    const dx = ev.clientX - startX;
    let px = Math.round(startPx + dx);
    px = Math.max(72, Math.min(300, px));
    document.documentElement.style.setProperty("--refs-col", `${px}px`);
  }
  function onUp() {
    document.documentElement.classList.remove("layout-resizing");
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    try {
      h.releasePointerCapture(e.pointerId);
    } catch (_) {
      /* ignore */
    }
    const cur = document.documentElement.style.getPropertyValue("--refs-col");
    const n = parseInt(cur, 10);
    if (!Number.isNaN(n)) saveRefColPx(n);
    scheduleAutosave();
  }
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
}

function renderBoard() {
  hideTextHoverLayer();
  if (!state.pages.length) {
    const fileHint =
      window.location.protocol === "file:"
        ? "<p class=\"empty-hint\">当前为 <code>file://</code> 本地打开：本页已使用普通脚本（非 ES Module）以保证按钮可用。若遇异常，请用本地 HTTP 服务访问，例如 <code style=\"color:#b8d4ff\">python3 -m http.server 8080</code>。</p>"
        : "";
    if (!pdfJsReady) {
      els.main.innerHTML =
        '<div class="empty-state empty-state--warn">' +
        fileHint +
        "<p><strong>未能加载 PDF 解析库（pdf.js）</strong>，请检查网络或稍后重试。顶部「<strong>导入 PDF 分镜</strong>」仍可打开文件选择；解析需在库加载成功后才会执行。</p>" +
        "<p>也可下载 pdf.js 到本地并改 <code>index.html</code> 中的脚本地址。</p></div>";
      updateShareChrome();
      return;
    }
    els.main.innerHTML =
      '<div class="empty-state">' +
      fileHint +
      "<p>请通过顶部 <strong>导入 PDF 分镜</strong> 上传文件。拖竖线调分镜/审核与教研/导演比例；拖行缝调各行高度（全局同步）；参考图区为 <strong>16:9</strong>。使用 <strong>归档库</strong> 管理历史。</p></div>";
    updateShareChrome();
    return;
  }

  const frag = document.createDocumentFragment();

  for (const page of state.pages) {
    const pi = page.pageIndex;
    const section = document.createElement("section");
    section.className = "page-section";
    section.dataset.pageIndex = String(pi);

    const wrap = document.createElement("div");
    wrap.className = "page-layout-wrap";

    const row = document.createElement("div");
    row.className = "page-panes";

    const story = document.createElement("div");
    story.className = "pane pane--story";
    story.innerHTML = `
      <div class="pane-head pane-head--muted">整页分镜</div>
      <div class="pane-story-body frame-wrap" title="单击放大">
        <img src="${page.pageUrl}" alt="第 ${pi} 页分镜整页" draggable="false" />
      </div>`;

    const g1 = document.createElement("div");
    g1.className = "pane-gutter pane-gutter--v";
    g1.dataset.gutterKind = "story";
    g1.title = "拖动：分镜区 ⟷ 审核区";

    const dual = document.createElement("div");
    dual.className = "pane-dual-outer";

    const inner = document.createElement("div");
    inner.className = "pane-dual-inner";

    const head = document.createElement("div");
    head.className = "dual-head";
    head.innerHTML = `
      <div class="dual-head__r pane-head pane-head--research">教研反馈</div>
      <div class="dual-head-spacer" aria-hidden="true"></div>
      <div class="dual-head__d pane-head pane-head--director">导演反馈</div>`;

    const body = document.createElement("div");
    body.className = "dual-body";

    for (let s = 0; s < SLOTS_PER_PAGE; s++) {
      const band = document.createElement("div");
      band.className = "sync-band";
      band.dataset.slot = String(s);
      band.innerHTML = `
        <div class="sync-band__row">
          <div class="sync-slot sync-slot--r">${feedbackBlockHtml("research", `r-p${pi}-s${s}`, "教研文字意见…", state.shareReadOnly)}</div>
          <div class="pane-gutter pane-gutter--mid" data-gutter-kind="mid" title="拖动：教研 ⟷ 导演（全局同步）"></div>
          <div class="sync-slot sync-slot--d">${feedbackBlockHtml("director", `d-p${pi}-s${s}`, "导演文字意见…", state.shareReadOnly)}</div>
        </div>`;
      body.appendChild(band);
      if (s < SLOTS_PER_PAGE - 1) {
        const rh = document.createElement("div");
        rh.className = "row-res-handle";
        rh.dataset.after = String(s);
        rh.title = "拖动调整本行与下一行高度（教研/导演同步）";
        body.appendChild(rh);
      }
    }

    inner.appendChild(head);
    inner.appendChild(body);
    dual.appendChild(inner);

    row.appendChild(story);
    row.appendChild(g1);
    row.appendChild(dual);
    wrap.appendChild(row);

    section.innerHTML = `<h2 class="page-title">第 ${pi} 页 · 整页分镜</h2>`;
    section.appendChild(wrap);
    frag.appendChild(section);
  }

  els.main.innerHTML = "";
  els.main.appendChild(frag);
  applyAllLayoutGlobals();
  wireDropzonesIn(els.main);
  if (state.sessionSlots && Object.keys(state.sessionSlots).length > 0) {
    applySlotPayload(state.sessionSlots);
  }
  wireTextHoverPreviews(els.main);
  updateShareChrome();
}

/**
 * @param {HTMLElement} root
 */
function wireDropzonesIn(root) {
  root.querySelectorAll("[data-dropzone]").forEach((dz) => {
    const zone = /** @type {HTMLElement} */ (dz);
    const key = zone.dataset.dropzone;
    const block = zone.closest(".feedback-block");
    const fileInput = /** @type {HTMLInputElement | null} */ (
      block ? block.querySelector(`[data-file="${key}"]`) : null
    );

    if (!zone.classList.contains("dropzone--readonly")) {
      zone.addEventListener("pointerenter", () => {
        if (state.shareReadOnly) return;
        activePasteDropzone = zone;
      });
      zone.addEventListener("pointerleave", (e) => {
        if (state.shareReadOnly) return;
        if (activePasteDropzone !== zone) return;
        const rel = e.relatedTarget;
        if (rel instanceof Node && zone.contains(rel)) return;
        activePasteDropzone = null;
      });
    }

    zone.addEventListener("click", (ev) => {
      const t = /** @type {HTMLElement} */ (ev.target);
      if (t.closest(".dz-add") || t.closest(".dz-clear") || t.closest(".dz-thumb-remove")) return;
      const urls = readUrlsFromZone(zone);
      const n = urls.length;
      if (n > 1 && (t.closest(".dz-single-wrap") || t.closest("img.dz-single") || t.closest(".dz-extra-badge"))) {
        openRefGallery(urls, 0);
        return;
      }
      if (
        n === 1 &&
        zone.classList.contains("has-image") &&
        (t.closest(".dz-single-wrap") || t.closest("img.dz-single"))
      ) {
        openRefGallery(urls, 0);
        return;
      }
      if (!state.shareReadOnly) fileInput?.click();
    });

    zone.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" || ev.key === " ") {
        const urls = readUrlsFromZone(zone);
        const n = urls.length;
        if (n > 1) {
          ev.preventDefault();
          openRefGallery(urls, 0);
        } else if (n === 1 && zone.classList.contains("has-image")) {
          ev.preventDefault();
          openRefGallery(urls, 0);
        } else {
          ev.preventDefault();
          if (!state.shareReadOnly) fileInput?.click();
        }
      }
    });

    ["dragenter", "dragover"].forEach((evt) => {
      zone.addEventListener(evt, (e) => {
        if (state.shareReadOnly) return;
        e.preventDefault();
        e.stopPropagation();
        zone.classList.add("dragover");
      });
    });
    zone.addEventListener("dragleave", (e) => {
      e.preventDefault();
      zone.classList.remove("dragover");
    });
    zone.addEventListener("drop", (e) => {
      if (state.shareReadOnly) return;
      e.preventDefault();
      zone.classList.remove("dragover");
      const list = e.dataTransfer?.files;
      if (!list?.length) return;
      const imgs = Array.from(list).filter((f) => f.type.startsWith("image/"));
      if (imgs.length) void setZoneImages(zone, imgs, {});
    });

    fileInput?.addEventListener("change", () => {
      if (state.shareReadOnly) return;
      const list = fileInput.files;
      if (!list?.length) return;
      const imgs = Array.from(list).filter((f) => f.type.startsWith("image/"));
      const append = zone.dataset.appendMode === "1";
      delete zone.dataset.appendMode;
      if (imgs.length) void setZoneImages(zone, imgs, { append });
      fileInput.value = "";
    });
  });

  if (!state.shareReadOnly) {
    root.querySelectorAll(".dz-add").forEach((pick) => {
      pick.addEventListener("pointerdown", () => {
        const zone = pick.closest("[data-dropzone]");
        if (zone instanceof HTMLElement) zone.dataset.appendMode = "1";
      });
      pick.addEventListener("click", (e) => e.stopPropagation());
    });

    root.querySelectorAll(".dz-clear").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const zone = /** @type {HTMLElement} */ (btn.closest("[data-dropzone]"));
        if (!zone) return;
        clearDropzone(zone);
      });
    });
  }
}

/**
 * @param {HTMLElement} zone
 */
function readUrlsFromZone(zone) {
  try {
    const raw = zone.dataset.refUrls;
    if (raw) return JSON.parse(raw);
  } catch (_) {
    /* ignore */
  }
  return [];
}

/**
 * @param {HTMLElement} zone
 */
function clearDropzone(zone) {
  zone.classList.remove("has-image", "multi");
  delete zone.dataset.refUrls;
  delete zone.dataset.appendMode;
  const strip = zone.querySelector("[data-dz-strip]");
  if (strip) strip.innerHTML = "";
  zone.querySelectorAll("img.dz-single").forEach((n) => n.remove());
  zone.querySelectorAll(".dz-single-wrap").forEach((n) => n.remove());
  zone.style.removeProperty("--dz-thumb-px");
  zone.querySelector(".dz-hint")?.classList.remove("dz-hint--hide");
  scheduleAutosave();
  if (state.collabActive) {
    const sid = zone.getAttribute("data-dropzone");
    if (sid) window.__collabPushSlotPartial?.(sid, { urls: [] });
  }
}

/**
 * @param {HTMLElement} zone
 * @param {number} idx
 */
function removeUrlAt(zone, idx) {
  if (state.shareReadOnly) return;
  const urls = readUrlsFromZone(zone);
  if (idx < 0 || idx >= urls.length) return;
  urls.splice(idx, 1);
  if (!urls.length) clearDropzone(zone);
  else {
    zone.dataset.refUrls = JSON.stringify(urls);
    refreshDropzoneVisuals(zone);
  }
  if (state.collabActive) {
    const sid = zone.getAttribute("data-dropzone");
    if (sid) window.__collabPushSlotPartial?.(sid, { urls: readUrlsFromZone(zone) });
  }
}

/**
 * @param {HTMLElement} zone
 */
function refreshDropzoneVisuals(zone) {
  const urls = readUrlsFromZone(zone);
  const strip = zone.querySelector("[data-dz-strip]");
  const hint = zone.querySelector(".dz-hint");
  const inner = zone.querySelector(".dz-inner");
  if (!strip || !inner) return;
  zone.querySelectorAll("img.dz-single").forEach((n) => n.remove());
  zone.querySelectorAll(".dz-single-wrap").forEach((n) => n.remove());
  strip.innerHTML = "";
  zone.classList.remove("multi");
  if (!urls.length) {
    clearDropzone(zone);
    return;
  }
  zone.classList.add("has-image");
  hint?.classList.add("dz-hint--hide");
  if (urls.length === 1) {
    const wrap = document.createElement("div");
    wrap.className = "dz-single-wrap";
    const img = document.createElement("img");
    img.className = "dz-single";
    img.src = urls[0];
    img.alt = "参考图";
    wrap.appendChild(img);
    if (!state.shareReadOnly) {
      const rx = document.createElement("button");
      rx.type = "button";
      rx.className = "dz-thumb-remove dz-single-remove";
      rx.title = "删除此图";
      rx.setAttribute("aria-label", "删除");
      rx.textContent = "×";
      rx.addEventListener("click", (ev) => {
        ev.stopPropagation();
        removeUrlAt(zone, 0);
      });
      wrap.appendChild(rx);
    }
    inner.insertBefore(wrap, strip);
    zone.style.removeProperty("--dz-thumb-px");
    scheduleAutosave();
    return;
  }
  /* 多张：首张缩略图 + 左下角圆角方标 +N（N = 总张数 − 1） */
  {
    const wrap = document.createElement("div");
    wrap.className = "dz-single-wrap";
    const img = document.createElement("img");
    img.className = "dz-single";
    img.src = urls[0];
    img.alt = "参考图（多张）";
    wrap.appendChild(img);
    const extra = urls.length - 1;
    const badge = document.createElement("span");
    badge.className = "dz-extra-badge";
    badge.textContent = `+${extra}`;
    badge.setAttribute("aria-label", `共 ${urls.length} 张，另有 ${extra} 张`);
    wrap.appendChild(badge);
    if (!state.shareReadOnly) {
      const rx = document.createElement("button");
      rx.type = "button";
      rx.className = "dz-thumb-remove dz-single-remove";
      rx.title = "删除首张参考图";
      rx.setAttribute("aria-label", "删除首张参考图");
      rx.textContent = "×";
      rx.addEventListener("click", (ev) => {
        ev.stopPropagation();
        removeUrlAt(zone, 0);
      });
      wrap.appendChild(rx);
    }
    inner.insertBefore(wrap, strip);
    zone.style.removeProperty("--dz-thumb-px");
    scheduleAutosave();
  }
}

/**
 * @param {HTMLElement} zone
 * @param {File[]} files
 * @param {{ append?: boolean }} [opts]
 */
async function setZoneImages(zone, files, opts) {
  if (state.shareReadOnly) return;
  const append = !!(opts && opts.append);
  const base = append ? readUrlsFromZone(zone) : [];
  const urls = [...base];
  for (const f of files) {
    urls.push(await readAsDataUrl(f));
  }
  if (!urls.length) return;
  if (!append) {
    zone.classList.remove("has-image", "multi");
    const strip = zone.querySelector("[data-dz-strip]");
    if (strip) strip.innerHTML = "";
    zone.querySelectorAll("img.dz-single").forEach((n) => n.remove());
    zone.querySelectorAll(".dz-single-wrap").forEach((n) => n.remove());
  }
  zone.dataset.refUrls = JSON.stringify(urls);
  zone.classList.add("has-image");
  refreshDropzoneVisuals(zone);
  if (state.collabActive) {
    const sid = zone.getAttribute("data-dropzone");
    if (sid) window.__collabPushSlotPartial?.(sid, { urls: readUrlsFromZone(zone) });
  }
}

/**
 * @param {File} file
 */
function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

/** @type {string[]} */
let galleryUrls = [];
let galleryIndex = 0;

function openRefGallery(urls, startIdx) {
  galleryUrls = urls;
  galleryIndex = Math.max(0, Math.min(startIdx, urls.length - 1));
  const modal = document.getElementById("ref-gallery");
  const img = /** @type {HTMLImageElement | null} */ (document.getElementById("gallery-main-img"));
  if (!modal || !img) return;
  img.src = galleryUrls[galleryIndex] || "";
  modal.hidden = false;
  document.body.classList.add("gallery-open");
}

function wireRefGallery() {
  const modal = document.getElementById("ref-gallery");
  const img = /** @type {HTMLImageElement | null} */ (document.getElementById("gallery-main-img"));
  if (!modal || !img || modal.dataset.wired) return;
  modal.dataset.wired = "1";

  const close = () => {
    modal.hidden = true;
    document.body.classList.remove("gallery-open");
    img.src = "";
  };

  function showGal() {
    img.src = galleryUrls[galleryIndex] || "";
  }

  function galPrev() {
    if (!galleryUrls.length) return;
    galleryIndex = (galleryIndex - 1 + galleryUrls.length) % galleryUrls.length;
    showGal();
  }

  function galNext() {
    if (!galleryUrls.length) return;
    galleryIndex = (galleryIndex + 1) % galleryUrls.length;
    showGal();
  }

  modal.querySelector(".gallery-backdrop")?.addEventListener("click", close);
  modal.querySelector(".gallery-close")?.addEventListener("click", close);
  document.getElementById("gal-prev")?.addEventListener("click", galPrev);
  document.getElementById("gal-next")?.addEventListener("click", galNext);

  document.addEventListener("keydown", (e) => {
    if (modal.hidden) return;
    if (e.key === "Escape") close();
    if (e.key === "ArrowLeft") galPrev();
    if (e.key === "ArrowRight") galNext();
  });
}

function wireLightbox() {
  const lb = document.getElementById("storyboard-lightbox");
  const wrap = /** @type {HTMLElement | null} */ (document.getElementById("lightbox-zoom-wrap"));
  const img = /** @type {HTMLImageElement | null} */ (document.getElementById("lightbox-img"));
  const backdrop = lb?.querySelector(".lightbox-backdrop");
  const closeBtn = lb?.querySelector(".lightbox-close");
  const zoomIn = document.getElementById("lb-zoom-in");
  const zoomOut = document.getElementById("lb-zoom-out");
  const zoomReset = document.getElementById("lb-zoom-reset");
  const zoomPct = document.getElementById("lb-zoom-pct");

  if (!lb || !wrap || !img) return;

  let scale = 1;
  let tx = 0;
  let ty = 0;
  let panning = false;
  let panStartX = 0;
  let panStartY = 0;
  let panOx = 0;
  let panOy = 0;

  function applyTransform() {
    wrap.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
    if (zoomPct) zoomPct.textContent = `${Math.round(scale * 100)}%`;
  }

  function resetView() {
    scale = 1;
    tx = 0;
    ty = 0;
    applyTransform();
  }

  function closeLightbox() {
    lb.hidden = true;
    img.src = "";
    img.removeAttribute("src");
    document.body.classList.remove("lightbox-open");
    resetView();
  }

  function openLightbox(src) {
    img.src = src;
    lb.hidden = false;
    document.body.classList.add("lightbox-open");
    if (img.complete) resetView();
    else img.onload = () => resetView();
  }

  backdrop?.addEventListener("click", closeLightbox);
  closeBtn?.addEventListener("click", closeLightbox);
  zoomIn?.addEventListener("click", (e) => {
    e.stopPropagation();
    scale = Math.min(5, scale * 1.2);
    applyTransform();
  });
  zoomOut?.addEventListener("click", (e) => {
    e.stopPropagation();
    scale = Math.max(0.2, scale / 1.2);
    applyTransform();
  });
  zoomReset?.addEventListener("click", (e) => {
    e.stopPropagation();
    resetView();
  });

  wrap.addEventListener(
    "wheel",
    (e) => {
      if (lb.hidden) return;
      e.preventDefault();
      const factor = e.deltaY > 0 ? 0.9 : 1.1;
      scale = Math.min(5, Math.max(0.2, scale * factor));
      applyTransform();
    },
    { passive: false },
  );

  wrap.addEventListener("pointerdown", (e) => {
    if (lb.hidden || scale <= 1) return;
    if (e.button !== 0) return;
    const t = /** @type {HTMLElement} */ (e.target);
    if (t.closest("button")) return;
    panning = true;
    panStartX = e.clientX;
    panStartY = e.clientY;
    panOx = tx;
    panOy = ty;
    wrap.setPointerCapture(e.pointerId);
  });

  wrap.addEventListener("pointermove", (e) => {
    if (!panning) return;
    tx = panOx + (e.clientX - panStartX);
    ty = panOy + (e.clientY - panStartY);
    applyTransform();
  });

  wrap.addEventListener("pointerup", (e) => {
    if (!panning) return;
    panning = false;
    try {
      wrap.releasePointerCapture(e.pointerId);
    } catch (_) {
      /* ignore */
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !lb.hidden) closeLightbox();
  });

  document.addEventListener("click", (e) => {
    const t = e.target;
    if (!(t instanceof HTMLImageElement)) return;
    if (!t.closest(".pane-story-body.frame-wrap")) return;
    if (t.closest(".dropzone")) return;
    e.preventDefault();
    const src = t.currentSrc || t.src;
    if (src) openLightbox(src);
  });
}

wireRefGallery();
wireLightbox();
initGlobalResizersOnce();
wireToolbarNav();
wireFldFolderMenuOutsideCloseOnce();
wireShareUi();
initSessionAutosaveOnce();
initDropzonePasteRoutingOnce();

async function bootstrapApp() {
  try {
    if (await tryConsumeCollabHash()) {
      applyAllLayoutGlobals();
      updateShareChrome();
      return;
    }
    if (await tryConsumeShareHash()) {
      showEditorView();
      applyAllLayoutGlobals();
      renderBoard();
      const shareSlots = state.pendingShareSlots;
      if (shareSlots) {
        applySlotPayload(shareSlots);
        state.sessionSlots = cloneSlots(shareSlots);
        state.pendingShareSlots = null;
      }
      updateShareChrome();
      return;
    }
  } catch (e) {
    console.error(e);
    state.fromShare = true;
    state.shareReadOnly = true;
    state.pages = [];
    if (els.main) {
      els.main.innerHTML =
        '<div class="empty-state empty-state--warn"><p><strong>无法打开分享链接</strong>（可能过长被浏览器截断，或内容损坏）。请让对方改用「下载分享文件」发送 <code>.json</code>，你使用「导入分享」打开。</p><p>点击「退出分享页」返回首页。</p></div>';
    }
    updateShareChrome();
    return;
  }
  renderBoard();
  updateShareChrome();
}

void bootstrapApp();
