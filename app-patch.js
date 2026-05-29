/**
 * App.js 补丁代码
 *
 * 功能增强：
 * 1. 分享链接生成（审核分享 & 阅读分享）
 * 2. JSON 备份下载
 * 3. JSON 备份导入
 * 4. 协作模式集成
 */

(function () {
  "use strict";

  console.log("App Patch 加载中...");

  // 等待主应用加载完成
  function waitForApp() {
    return new Promise((resolve) => {
      const checkInterval = setInterval(() => {
        if (window.state && typeof collectAllSlots === "function") {
          clearInterval(checkInterval);
          resolve();
        }
      }, 100);
    });
  }

  // 初始化补丁
  waitForApp().then(() => {
    console.log("主应用已加载，开始初始化补丁功能...");
    initPatchFeatures();
  });

  /**
   * 初始化所有补丁功能
   */
  function initPatchFeatures() {
    setupShareButtons();
    setupBackupButtons();
    setupCollabIntegration();
  }

  /**
   * 设置分享按钮
   */
  function setupShareButtons() {
    const btnShareEdit = document.getElementById("btn-share-edit");
    const btnShareRead = document.getElementById("btn-share-read");

    if (btnShareEdit) {
      btnShareEdit.addEventListener("click", async () => {
        await handleShare("edit");
      });
    }

    if (btnShareRead) {
      btnShareRead.addEventListener("click", async () => {
        await handleShare("read");
      });
    }
  }

  /**
   * 处理分享功能
   */
  async function handleShare(mode) {
    try {
      // 检查 Firebase
      if (!window.firebaseDatabase) {
        alert("Firebase 未配置，请先配置 firebase-config.js");
        return;
      }

      // 检查是否有 PDF
      if (!window.state || !window.state.pages || window.state.pages.length === 0) {
        alert("请先导入 PDF 分镜");
        return;
      }

      // 生成房间 ID
      const roomId = generateRoomId();

      // 收集当前数据
      const shareData = await collectShareData();

      // 保存到 Firebase
      await saveToFirebase(roomId, shareData);

      // 生成链接
      const baseUrl = window.location.origin + window.location.pathname;
      const shareLink = `${baseUrl}?room=${roomId}&mode=${mode}`;

      // 复制到剪贴板
      await copyToClipboard(shareLink);

      // 显示提示
      const modeText = mode === "edit" ? "编辑" : "只读";
      alert(`${modeText}链接已复制到剪贴板：\n\n${shareLink}\n\n该链接可以分享给其他人实时协作查看。`);

      console.log(`${modeText}链接已生成:`, shareLink);
    } catch (error) {
      console.error("分享失败:", error);
      alert("分享失败：" + error.message);
    }
  }

  /**
   * 生成房间 ID
   */
  function generateRoomId() {
    return "room-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 9);
  }

  /**
   * 收集分享数据
   */
  async function collectShareData() {
    const data = {
      slots: collectAllSlots(),
      pdf: null,
      timestamp: Date.now(),
    };

    // 获取 PDF 的 base64
    if (window.state.lastPdfFile) {
      data.pdf = await fileToBase64(window.state.lastPdfFile);
    }

    return data;
  }

  /**
   * 收集所有 slots 数据
   */
  function collectAllSlots() {
    const slots = {};

    document.querySelectorAll("[data-slot-key]").forEach((slotEl) => {
      const key = slotEl.getAttribute("data-slot-key");
      const textarea = slotEl.querySelector(".feedback-text");
      const dropzone = slotEl.querySelector(".dropzone");

      const slotData = {
        text: textarea ? textarea.value : "",
        urls: [],
      };

      // 收集图片 URLs
      if (dropzone) {
        const images = dropzone.querySelectorAll("img");
        images.forEach((img) => {
          if (img.src) {
            slotData.urls.push(img.src);
          }
        });
      }

      slots[key] = slotData;
    });

    return slots;
  }

  /**
   * 保存到 Firebase
   */
  async function saveToFirebase(roomId, data) {
    const roomRef = firebase.database().ref(`rooms/${roomId}`);

    await roomRef.set({
      ...data,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    console.log("数据已保存到 Firebase，房间 ID:", roomId);
  }

  /**
   * 复制到剪贴板
   */
  async function copyToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      // 降级方案
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
    }
  }

  /**
   * 文件转 Base64
   */
  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  /**
   * 设置备份按钮
   */
  function setupBackupButtons() {
    const btnDownload = document.getElementById("btn-download-json");
    const btnImport = document.getElementById("btn-import-json");

    if (btnDownload) {
      btnDownload.addEventListener("click", handleDownloadJSON);
    }

    if (btnImport) {
      btnImport.addEventListener("click", handleImportJSON);
    }
  }

  /**
   * 下载 JSON 备份
   */
  async function handleDownloadJSON() {
    try {
      // 检查是否有数据
      if (!window.state || !window.state.pages || window.state.pages.length === 0) {
        alert("当前没有可下载的数据，请先导入 PDF 分镜");
        return;
      }

      // 获取 PDF 文件名
      const pdfFileName = getPDFFileName();

      // 生成文件名：PDF名称_MMDD.json
      const date = new Date();
      const monthDay = String(date.getMonth() + 1).padStart(2, "0") + String(date.getDate()).padStart(2, "0");
      const fileName = `${pdfFileName}_${monthDay}.json`;

      // 收集数据
      const backupData = {
        name: pdfFileName,
        timestamp: Date.now(),
        slots: collectAllSlots(),
        pdf: null,
      };

      // 包含 PDF 数据
      if (window.state.lastPdfFile) {
        backupData.pdf = await fileToBase64(window.state.lastPdfFile);
      }

      // 创建 Blob 并下载
      const json = JSON.stringify(backupData, null, 2);
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);

      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      console.log("JSON 备份已下载:", fileName);
      alert(`备份已下载：${fileName}`);
    } catch (error) {
      console.error("下载失败:", error);
      alert("下载失败：" + error.message);
    }
  }

  /**
   * 获取 PDF 文件名（去掉 .pdf 后缀）
   */
  function getPDFFileName() {
    if (window.state && window.state.lastPdfFile) {
      const fullName = window.state.lastPdfFile.name;
      return fullName.replace(/\.pdf$/i, "");
    }
    return "分镜审核";
  }

  /**
   * 导入 JSON 备份
   */
  function handleImportJSON() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.style.display = "none";

    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      try {
        await processImportFile(file);
      } catch (error) {
        console.error("导入失败:", error);
        alert("导入失败：" + error.message);
      }
    };

    document.body.appendChild(input);
    input.click();
    document.body.removeChild(input);
  }

  /**
   * 处理导入文件
   */
  async function processImportFile(file) {
    // 读取文件
    const text = await file.text();
    const data = JSON.parse(text);

    // 验证数据格式
    if (!data.slots || !data.pdf) {
      throw new Error("JSON 格式不正确，缺少必要的字段");
    }

    // 加载 PDF
    await loadPDFFromBase64Data(data.pdf);

    // 等待 PDF 渲染完成
    await waitForPDFRendered();

    // 恢复 slots 数据
    restoreSlots(data.slots);

    console.log("JSON 备份已导入:", data.name);
    alert(`成功导入：${data.name || "未命名"}`);
  }

  /**
   * 从 Base64 加载 PDF
   */
  async function loadPDFFromBase64Data(base64) {
    return new Promise((resolve, reject) => {
      // 将 base64 转为 Blob
      const arr = base64.split(",");
      const mime = arr[0].match(/:(.*?);/)[1];
      const bstr = atob(arr[1]);
      let n = bstr.length;
      const u8arr = new Uint8Array(n);
      while (n--) {
        u8arr[n] = bstr.charCodeAt(n);
      }
      const blob = new Blob([u8arr], { type: mime });

      // 创建 File 对象
      const file = new File([blob], "imported.pdf", { type: "application/pdf" });

      // 调用主应用的 PDF 加载逻辑
      if (typeof handlePDFFile === "function") {
        handlePDFFile(file)
          .then(resolve)
          .catch(reject);
      } else {
        // 降级：触发文件输入
        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(file);

        const input = document.getElementById("pdf-input");
        if (input) {
          input.files = dataTransfer.files;
          input.dispatchEvent(new Event("change", { bubbles: true }));
          resolve();
        } else {
          reject(new Error("无法找到 PDF 输入元素"));
        }
      }
    });
  }

  /**
   * 等待 PDF 渲染完成
   */
  function waitForPDFRendered() {
    return new Promise((resolve) => {
      const checkInterval = setInterval(() => {
        const slots = document.querySelectorAll("[data-slot-key]");
        if (slots.length > 0) {
          clearInterval(checkInterval);
          setTimeout(resolve, 500); // 额外等待确保渲染完成
        }
      }, 100);

      // 超时保护
      setTimeout(() => {
        clearInterval(checkInterval);
        resolve();
      }, 5000);
    });
  }

  /**
   * 恢复 slots 数据
   */
  function restoreSlots(slotsData) {
    Object.keys(slotsData).forEach((slotKey) => {
      const slotData = slotsData[slotKey];
      const slotEl = document.querySelector(`[data-slot-key="${slotKey}"]`);

      if (!slotEl) {
        console.warn("找不到 slot:", slotKey);
        return;
      }

      // 恢复文字
      const textarea = slotEl.querySelector(".feedback-text");
      if (textarea && slotData.text) {
        textarea.value = slotData.text;
      }

      // 恢复图片
      if (slotData.urls && slotData.urls.length > 0) {
        restoreSlotImages(slotEl, slotData.urls);
      }
    });

    console.log("Slots 数据已恢复");
  }

  /**
   * 恢复 slot 图片
   */
  function restoreSlotImages(slotEl, urls) {
    const dropzone = slotEl.querySelector(".dropzone");
    if (!dropzone) return;

    // 清空现有内容
    const hint = dropzone.querySelector(".dz-hint");
    const existingImgs = dropzone.querySelectorAll("img, .dz-thumb-strip, .dz-single-wrap");
    existingImgs.forEach(el => el.remove());

    if (urls.length === 0) return;

    // 隐藏提示
    if (hint) {
      hint.classList.add("dz-hint--hide");
    }

    dropzone.classList.add("has-image");

    if (urls.length === 1) {
      // 单图模式
      const wrap = document.createElement("div");
      wrap.className = "dz-single-wrap";
      wrap.innerHTML = `<img src="${urls[0]}" class="dz-single" alt="参考图">`;
      dropzone.appendChild(wrap);
    } else {
      // 多图模式
      dropzone.classList.add("multi");
      const inner = dropzone.querySelector(".dz-inner") || dropzone;
      const strip = document.createElement("div");
      strip.className = "dz-thumb-strip";

      urls.forEach((url, idx) => {
        const thumbWrap = document.createElement("div");
        thumbWrap.className = "dz-thumb-wrap";
        thumbWrap.innerHTML = `
          <div class="dz-thumb">
            <img src="${url}" alt="参考图 ${idx + 1}">
          </div>
        `;
        strip.appendChild(thumbWrap);
      });

      inner.appendChild(strip);

      // 添加额外标记
      if (urls.length > 1) {
        const badge = document.createElement("div");
        badge.className = "dz-extra-badge";
        badge.textContent = `+${urls.length - 1}`;
        strip.firstElementChild.appendChild(badge);
      }
    }
  }

  /**
   * 设置协作集成
   */
  function setupCollabIntegration() {
    // 监听协作模块的 PDF 加载事件
    document.addEventListener("collab-load-pdf", async (e) => {
      const { base64 } = e.detail;
      try {
        await loadPDFFromBase64Data(base64);
      } catch (error) {
        console.error("协作 PDF 加载失败:", error);
      }
    });

    // 如果当前在协作模式，监听本地图片上传
    if (window.CollabSync && window.CollabSync.isActive) {
      setupCollabImageSync();
    }
  }

  /**
   * 设置协作图片同步
   */
  function setupCollabImageSync() {
    // 使用 MutationObserver 监听 DOM 变化
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          if (node.tagName === "IMG" && node.closest(".dropzone")) {
            const dropzone = node.closest(".dropzone");
            const slotEl = dropzone.closest("[data-slot-key]");
            if (slotEl) {
              const slotKey = slotEl.getAttribute("data-slot-key");
              const urls = Array.from(dropzone.querySelectorAll("img")).map(img => img.src);

              // 触发自定义事件，让 collab-sync.js 处理
              document.dispatchEvent(new CustomEvent("image-uploaded", {
                detail: { slotKey, urls }
              }));
            }
          }
        });
      });
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  console.log("App Patch 初始化完成");

})();
