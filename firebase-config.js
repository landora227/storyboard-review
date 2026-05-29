/**
 * Firebase 配置文件
 *
 * 使用说明：
 * 1. 访问 https://console.firebase.google.com/
 * 2. 创建新项目或选择现有项目
 * 3. 在项目设置中找到"您的应用"部分
 * 4. 选择 Web 应用，复制配置信息
 * 5. 将下方的占位符替换为您的真实配置
 * 6. 在 Firebase Console 中启用 Realtime Database
 */

// Firebase 配置（请替换为您的真实配置）
const firebaseConfig = {
  apiKey: "AIzaSyBLMzH03GhEOgK3_49ihBhy6Xde1JRRlcs",
  authDomain: "storyboard-review2.firebaseapp.com",
  databaseURL: "https://storyboard-review2-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "storyboard-review2",
  storageBucket: "storyboard-review2.firebasestorage.app",
  messagingSenderId: "1082244862350",
  appId: "1:1082244862350:web:4fb37346c7d1beaec6d4df"
};

// 初始化 Firebase
try {
  firebase.initializeApp(firebaseConfig);
  console.log("Firebase 初始化成功");
} catch (error) {
  console.error("Firebase 初始化失败:", error);
}

// 导出数据库引用
const database = firebase.database();

// 全局变量供其他模块使用
window.firebaseDatabase = database;
