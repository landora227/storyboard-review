/**
 * 实时协作同步模块
 *
 * 功能：
 * - 基于 URL 参数（?room=xxx&mode=edit/read）自动加入房间
 * - 实时同步所有 slots 数据（参考图和文字反馈）
 * - 权限控制（edit 模式可编辑，read 模式只读）
 * - 在线用户显示
 */

(function () {
  "use strict";

  // 全局协作状态
  window.CollabSync = {
    isActive: false,
    roomId: null,
    mode: null, // 'edit' or 'read'
    unsubscribe: null,
    onlineUsers: {},
  };

  /**
   * 从 URL 解析房间参数
   */
  function parseRoomFromURL() {
    const params = new URLSearchParams(window.location.search);
    const roomId = params.get("room");
    const mode = params.get("mode"); // 'edit' or 'read'

    if (roomId && (mode === "edit" || mode === "read")) {
      return { roomId, mode };
    }
    return null;
  }

  /**
   * 初始化协作模式
   */
  function initCollab() {
    const roomInfo = parseRoomFromURL();
    if (!roomInfo) {
      console.log("未检测到房间参数，跳过协作模式初始化");
      return;
    }

    if (!window.firebaseDatabase) {
      console.error("Firebase 未初始化，无法启用协作模式");
      alert("Firebase 配置错误，请检查 firebase-config.js");
      return;
    }

    const { roomId, mode } = roomInfo;
    console.log(`正在加入房间: ${roomId}, 模式: ${mode}`);

    CollabSync.isActive = true;
    CollabSync.roomId = roomId;
    CollabSync.mode = mode;

    // 设置只读模式
    if (mode === "read") {
      document.body.classList.add("share-readonly");
      const hint = document.getElementById("share-mode-hint");
      if (hint) {
        hint.textContent = "只读模式：您正在查看分享的内容，无法编辑。";
        hint.removeAttribute("hidden");
      }
    } else {
      const hint = document.getElementById("share-mode-hint");
      if (hint) {
        hint.textContent = "协作模式：您的修改会实时同步到所有参与者。";
        hint.removeAttribute("hidden");
      }
    }

    // 监听房间数据
    listenToRoom(roomId, mode);

    // 注册用户在线状态
    registerUserPresence(roomId);

    // 如果是编辑模式，监听本地修改并同步
    if (mode === "edit") {
      setupLocalChangeSync(roomId);
    }
  }

  /**
   * 监听房间数据变化
   */
  function listenToRoom(roomId, mode) {
    const roomRef = firebase.database().ref(`rooms/${roomId}`);

    // 监听 slots 数据变化
    const slotsRef = roomRef.child("slots");

    slotsRef.on("value", (snapshot) => {
      const data = snapshot.val();
      if (data) {
        console.log("收到房间数据更新:", data);
        applyRemoteSlots(data);
      }
    });

    // 监听 PDF 数据
    const pdfRef = roomRef.child("pdf");
    pdfRef.once("value", (snapshot) => {
      const pdfData = snapshot.val();
      if (pdfData) {
        loadPDFFromBase64(pdfData);
      }
    });

    // 监听在线用户
    const usersRef = roomRef.child("users");
    usersRef.on("value", (snapshot) => {
      const users = snapshot.val() || {};
      CollabSync.onlineUsers = users;
      updateOnlineUserDisplay(users);
    });

    // 保存取消订阅函数
    CollabSync.unsubscribe = () => {
      slotsRef.off();
      usersRef.off();
    };
  }

  /**
   * 应用远程 slots 数据到本地
   */
  function applyRemoteSlots(remoteSlots) {
    // 防止循环更新
    if (window._isApplyingRemoteData) return;
    window._isApplyingRemoteData = true;

    try {
      Object.keys(remoteSlots).forEach((slotKey) => {
        const slotData = remoteSlots[slotKey];
        const slotElement = document.querySelector(`[data-slot-key="${slotKey}"]`);

        if (!slotElement) return;

        // 更新参考图
        if (slotData.urls && Array.isArray(slotData.urls)) {
          updateSlotImages(slotElement, slotData.urls);
        }

        // 更新文字反馈
        if (slotData.text !== undefined) {
          const textarea = slotElement.querySelector(".feedback-text");
          if (textarea && textarea.value !== slotData.text) {
            textarea.value = slotData.text;
          }
        }
      });
    } finally {
      window._isApplyingRemoteData = false;
    }
  }

  /**
   * 更新 slot 的图片
   */
  function updateSlotImages(slotElement, urls) {
    const dropzone = slotElement.querySelector(".dropzone");
    if (!dropzone) return;

    // 清空现有图片
    const existingImages = dropzone.querySelectorAll("img");
    existingImages.forEach(img => img.remove());

    // 如果是多图模式
    if (urls.length > 1) {
      const strip = dropzone.querySelector(".dz-thumb-strip");
      if (strip) {
        strip.innerHTML = "";
        urls.forEach((url, index) => {
          const thumb = document.createElement("div");
          thumb.className = "dz-thumb";
          thumb.innerHTML = `<img src="${url}" alt="参考图 ${index + 1}">`;
          strip.appendChild(thumb);
        });
      }
    } else if (urls.length === 1) {
      // 单图模式
      const img = document.createElement("img");
      img.src = urls[0];
      img.className = "dz-single";
      dropzone.appendChild(img);
    }
  }

  /**
   * 设置本地修改同步
   */
  function setupLocalChangeSync(roomId) {
    const roomRef = firebase.database().ref(`rooms/${roomId}/slots`);

    // 监听所有文本框变化
    document.addEventListener("input", (e) => {
      if (window._isApplyingRemoteData) return;

      const textarea = e.target;
      if (!textarea.classList.contains("feedback-text")) return;

      const slotElement = textarea.closest("[data-slot-key]");
      if (!slotElement) return;

      const slotKey = slotElement.getAttribute("data-slot-key");
      const text = textarea.value;

      // 同步到 Firebase（使用防抖）
      clearTimeout(textarea._syncTimer);
      textarea._syncTimer = setTimeout(() => {
        roomRef.child(slotKey).update({ text });
      }, 500);
    });

    // 监听图片上传（需要配合主应用的图片上传逻辑）
    document.addEventListener("image-uploaded", (e) => {
      if (window._isApplyingRemoteData) return;

      const { slotKey, urls } = e.detail;
      roomRef.child(slotKey).update({ urls });
    });
  }

  /**
   * 注册用户在线状态
   */
  function registerUserPresence(roomId) {
    const userId = generateUserId();
    const userRef = firebase.database().ref(`rooms/${roomId}/users/${userId}`);

    // 设置用户信息
    userRef.set({
      id: userId,
      joinedAt: Date.now(),
      mode: CollabSync.mode,
    });

    // 用户离线时自动删除
    userRef.onDisconnect().remove();

    // 保存用户 ID
    CollabSync.userId = userId;
  }

  /**
   * 生成用户 ID
   */
  function generateUserId() {
    return "user-" + Date.now() + "-" + Math.random().toString(36).slice(2, 9);
  }

  /**
   * 更新在线用户显示
   */
  function updateOnlineUserDisplay(users) {
    const userCount = Object.keys(users).length;
    console.log(`在线用户数: ${userCount}`);

    // 可以在界面上显示在线用户数
    const hint = document.getElementById("share-mode-hint");
    if (hint && CollabSync.mode === "edit") {
      hint.textContent = `协作模式：在线用户 ${userCount} 人，您的修改会实时同步。`;
    }
  }

  /**
   * 从 base64 加载 PDF（需要配合主应用逻辑）
   */
  function loadPDFFromBase64(base64) {
    console.log("收到 PDF 数据，准备加载...");

    // 触发自定义事件，让主应用处理 PDF 加载
    document.dispatchEvent(new CustomEvent("collab-load-pdf", {
      detail: { base64 }
    }));
  }

  /**
   * 保存当前数据到房间（供外部调用）
   */
  window.CollabSync.saveToRoom = async function (data) {
    if (!CollabSync.isActive || !CollabSync.roomId) return;

    const roomRef = firebase.database().ref(`rooms/${CollabSync.roomId}`);

    await roomRef.set({
      slots: data.slots || {},
      pdf: data.pdf || null,
      updatedAt: Date.now(),
    });

    console.log("数据已保存到房间");
  };

  /**
   * 清理协作会话
   */
  window.CollabSync.cleanup = function () {
    if (CollabSync.unsubscribe) {
      CollabSync.unsubscribe();
    }

    if (CollabSync.userId && CollabSync.roomId) {
      firebase.database()
        .ref(`rooms/${CollabSync.roomId}/users/${CollabSync.userId}`)
        .remove();
    }

    CollabSync.isActive = false;
    CollabSync.roomId = null;
    CollabSync.mode = null;
  };

  // 页面加载时自动初始化
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initCollab);
  } else {
    initCollab();
  }

  // 页面卸载时清理
  window.addEventListener("beforeunload", () => {
    CollabSync.cleanup();
  });

})();
