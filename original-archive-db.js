/**
 * IndexedDB：文件夹 + 归档（PDF Blob + 元数据与格子状态）
 */
(function () {
  const DB_NAME = "storyboard-review-archives";
  const DB_VER = 1;

  /** @type {IDBDatabase | null} */
  let dbp = null;

  function openDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VER);
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        dbp = req.result;
        resolve(dbp);
      };
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("folders")) {
          db.createObjectStore("folders", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("archives")) {
          const s = db.createObjectStore("archives", { keyPath: "id" });
          s.createIndex("byFolder", "folderId", { unique: false });
          s.createIndex("byUpdated", "updatedAt", { unique: false });
        }
      };
    });
  }

  function db() {
    if (dbp) return Promise.resolve(dbp);
    return openDb();
  }

  function uid(prefix) {
    return prefix + "-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 9);
  }

  window.ArchiveDB = {
    uid,

    /** @returns {Promise<{id:string,parentId:string|null,name:string,sort:number}[]>} */
    async listFolders() {
      const d = await db();
      return new Promise((resolve, reject) => {
        const tx = d.transaction("folders", "readonly");
        const q = tx.objectStore("folders").getAll();
        q.onsuccess = () => resolve(q.result || []);
        q.onerror = () => reject(q.error);
      });
    },

    /** @param {{id?:string,parentId:string|null,name:string,sort?:number}} f */
    async putFolder(f) {
      const d = await db();
      const row = {
        id: f.id || uid("fld"),
        parentId: f.parentId == null ? null : f.parentId,
        name: f.name,
        sort: typeof f.sort === "number" ? f.sort : Date.now(),
      };
      return new Promise((resolve, reject) => {
        const tx = d.transaction("folders", "readwrite");
        tx.objectStore("folders").put(row);
        tx.oncomplete = () => resolve(row);
        tx.onerror = () => reject(tx.error);
      });
    },

    /** @param {string} id */
    async deleteFolder(id) {
      const d = await db();
      const archives = await this.listArchives(undefined);
      for (const a of archives) {
        if (a.folderId === id) await this.putArchive({ ...a, folderId: null });
      }
      const subs = await this.listFolders();
      for (const s of subs) {
        if (s.parentId === id) await this.putFolder({ ...s, parentId: null });
      }
      return new Promise((resolve, reject) => {
        const tx = d.transaction("folders", "readwrite");
        tx.objectStore("folders").delete(id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    },

    /**
     * @param {string | null | undefined} folderId undefined=全部；null=仅未分文件夹；string=某文件夹内
     */
    async listArchives(folderId) {
      const d = await db();
      return new Promise((resolve, reject) => {
        const tx = d.transaction("archives", "readonly");
        const q = tx.objectStore("archives").getAll();
        q.onsuccess = () => {
          let rows = q.result || [];
          if (folderId === undefined) {
            /* all */
          } else if (folderId === null) {
            rows = rows.filter((r) => r.folderId == null || r.folderId === "");
          } else {
            rows = rows.filter((r) => r.folderId === folderId);
          }
          rows.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
          resolve(rows);
        };
        q.onerror = () => reject(q.error);
      });
    },

    /** @param {any} row */
    async putArchive(row) {
      const d = await db();
      return new Promise((resolve, reject) => {
        const tx = d.transaction("archives", "readwrite");
        tx.objectStore("archives").put(row);
        tx.oncomplete = () => resolve(row);
        tx.onerror = () => reject(tx.error);
      });
    },

    /** @param {string} id */
    async getArchive(id) {
      const d = await db();
      return new Promise((resolve, reject) => {
        const tx = d.transaction("archives", "readonly");
        const q = tx.objectStore("archives").get(id);
        q.onsuccess = () => resolve(q.result || null);
        q.onerror = () => reject(q.error);
      });
    },

    /** @param {string} id */
    async deleteArchive(id) {
      const d = await db();
      return new Promise((resolve, reject) => {
        const tx = d.transaction("archives", "readwrite");
        tx.objectStore("archives").delete(id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    },
  };
})();
