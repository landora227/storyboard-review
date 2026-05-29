# 分镜审核台 - 优化版

一个强大的在线分镜审核工具，支持实时协作、数据备份和分享功能。

## ✨ 新增功能

### 🔥 核心功能

1. **实时协作**
   - 基于 Firebase Realtime Database
   - 支持多人同时在线编辑
   - 实时同步所有修改

2. **分享功能**
   - **审核分享**：生成可编辑链接，团队协作
   - **阅读分享**：生成只读链接，客户查看

3. **数据备份**
   - **下载备份**：保存完整工作数据为 JSON
   - **导入备份**：一键恢复之前的工作进度

4. **界面优化**
   - 简化按钮布局
   - 删除不常用功能
   - 保留核心审核工具

## 📦 文件说明

### 🆕 新增文件

| 文件名 | 说明 | 大小 |
|--------|------|------|
| `index-optimized.html` | 优化后的主页面 | 4.8KB |
| `firebase-config.js` | Firebase 配置文件 | 1.1KB |
| `collab-sync.js` | 实时协作模块 | 8.7KB |
| `app-patch.js` | 功能补丁代码 | 14KB |
| `部署说明.md` | 详细的部署文档 | 15KB |

### 📄 原始文件（保持不变）

| 文件名 | 说明 | 大小 |
|--------|------|------|
| `original-app.js` | 原始应用逻辑 | 85KB |
| `original-styles.css` | 原始样式文件 | 46KB |
| `original-archive-db.js` | 归档数据库模块 | 4.8KB |

## 🚀 快速开始

### 1. 配置 Firebase（必需）

```bash
# 1. 访问 Firebase Console
https://console.firebase.google.com/

# 2. 创建新项目

# 3. 启用 Realtime Database

# 4. 复制配置信息到 firebase-config.js
```

详细步骤请查看 [部署说明.md](./部署说明.md)

### 2. 部署应用

#### 方式 A：本地测试
```bash
# 使用 Python 简单服务器
python -m http.server 8000

# 或使用 Node.js
npx http-server
```

#### 方式 B：GitHub Pages
```bash
# 1. 推送到 GitHub
git init
git add .
git commit -m "Initial commit"
git push origin main

# 2. 在 GitHub 仓库设置中启用 Pages
```

#### 方式 C：Netlify
```bash
# 拖拽整个文件夹到 Netlify Drop
https://app.netlify.com/drop
```

### 3. 开始使用

1. 打开 `index-optimized.html`
2. 点击"导入 PDF 分镜"
3. 开始审核和标注
4. 点击"审核分享"生成协作链接
5. 点击"下载备份"保存工作

## 📖 使用指南

### 审核分享（团队协作）

```
1. 导入 PDF
   ↓
2. 完成部分审核
   ↓
3. 点击"审核分享"
   ↓
4. 链接复制到剪贴板
   ↓
5. 分享给团队成员
   ↓
6. 所有人实时同步编辑
```

### 阅读分享（客户查看）

```
1. 完成所有审核
   ↓
2. 点击"阅读分享"
   ↓
3. 链接复制到剪贴板
   ↓
4. 分享给客户
   ↓
5. 客户只能查看，不能编辑
```

### 数据备份流程

```
1. 工作中定期点击"下载备份"
   ↓
2. 保存 JSON 文件到本地
   ↓
3. 需要恢复时点击"导入备份"
   ↓
4. 选择 JSON 文件
   ↓
5. 自动恢复所有数据
```

## 🎯 核心改动

### HTML 改动

**删除的按钮**：
- ❌ 协作房间（`btn-collab-host`）
- ❌ 退出协作（`btn-exit-collab`）
- ❌ 导入分享（`share-import-input`）
- ❌ 退出分享页（`btn-exit-share`）

**保留的按钮**：
- ✅ 导入 PDF 分镜
- ✅ 审核分享
- ✅ 阅读分享
- ✅ 归档库
- ✅ 返回编辑

**新增的按钮**：
- 🆕 下载备份
- 🆕 导入备份

### 功能增强

| 功能 | 实现方式 | 文件 |
|------|----------|------|
| 实时协作 | Firebase Realtime Database | `collab-sync.js` |
| 分享链接 | URL 参数 + Firebase | `app-patch.js` |
| 数据备份 | JSON 序列化 | `app-patch.js` |
| 权限控制 | URL mode 参数 | `collab-sync.js` |

## 🔧 技术栈

- **前端框架**：原生 JavaScript
- **PDF 渲染**：PDF.js
- **实时数据库**：Firebase Realtime Database
- **本地存储**：IndexedDB
- **样式**：原生 CSS

## 📊 数据结构

### Firebase 房间数据

```javascript
{
  "rooms": {
    "room-xxx": {
      "createdAt": 1234567890,
      "updatedAt": 1234567890,
      "pdf": "data:application/pdf;base64,...",
      "slots": {
        "page-0-research-0": {
          "text": "导演反馈",
          "urls": ["data:image/png;base64,..."]
        }
      },
      "users": {
        "user-xxx": {
          "joinedAt": 1234567890,
          "mode": "edit"
        }
      }
    }
  }
}
```

### JSON 备份格式

```javascript
{
  "name": "第一集分镜",
  "timestamp": 1234567890,
  "pdf": "data:application/pdf;base64,...",
  "slots": {
    "page-0-research-0": {
      "text": "导演反馈",
      "urls": ["data:image/png;base64,..."]
    }
  }
}
```

## 🛠️ 故障排除

### Firebase 初始化失败
```
错误：Firebase 初始化失败
解决：检查 firebase-config.js 配置是否正确
```

### 分享链接无法访问
```
错误：找不到房间数据
解决：确认 Firebase 安全规则允许读写
```

### 实时同步不工作
```
错误：修改不同步
解决：检查网络连接，刷新页面重新加入
```

更多问题请查看 [部署说明.md - 故障排除](./部署说明.md#-故障排除)

## 📈 性能建议

### 图片优化
- 压缩图片后再上传（< 2MB）
- 使用 WebP 格式
- 限制参考图数量（< 50 张）

### PDF 优化
- 压缩 PDF 文件
- 限制页数（< 50 页）
- 使用低分辨率版本

### 网络优化
- 启用 GZIP 压缩
- 使用 CDN 加速
- 启用浏览器缓存

## 🔐 安全建议

### Firebase 安全规则

```json
{
  "rules": {
    "rooms": {
      "$roomId": {
        ".read": true,
        ".write": "data.child('updatedAt').val() > now - 86400000",
        "users": {
          "$userId": {
            ".write": "$userId === auth.uid || !data.exists()"
          }
        }
      }
    }
  }
}
```

### 数据保护
- 定期备份重要数据
- 清理过期房间
- 监控异常访问
- 限制单次上传大小

## 📝 最佳实践

### 工作流程

1. **开始新项目**
   - 导入 PDF
   - 创建初始备份

2. **团队协作**
   - 生成审核分享链接
   - 团队成员加入编辑

3. **定期保存**
   - 每完成一页下载备份
   - 重要版本单独存档

4. **完成交付**
   - 生成阅读分享链接
   - 发送给客户查看

### 命名规范

```
备份文件：项目名_月日_版本.json
示例：第一集分镜_1225_final.json

房间 ID：项目名-日期-版本
示例：episode01-1225-v2
```

## 📞 支持与文档

- 📖 [完整部署说明](./部署说明.md)
- 🔥 [Firebase 文档](https://firebase.google.com/docs)
- 📄 [PDF.js 文档](https://mozilla.github.io/pdf.js/)

## 🎉 更新日志

### v1.0.0 (2024)

**新增**：
- ✨ 实时协作功能
- ✨ 审核分享（编辑模式）
- ✨ 阅读分享（只读模式）
- ✨ JSON 备份下载
- ✨ JSON 备份导入
- ✨ 在线用户显示

**优化**：
- 🎨 简化按钮布局
- 🎨 改进错误提示
- 🎨 优化数据同步逻辑
- 🎨 删除不必要功能

## 📄 开源协议

本项目基于原始分镜审核台进行优化，请遵守原项目的协议。

---

**开始使用**：查看 [部署说明.md](./部署说明.md) 获取详细的配置和部署步骤。

**有问题？**：查看故障排除部分或联系技术支持。

**祝您使用愉快！** 🎉
