# 多人实时协作 · 部署说明

静态站（GitHub Pages）只负责页面；**实时协作**需要单独部署 `collab-server`（Node + WebSocket + Yjs）。

页面地址示例：`https://landora227.github.io/storyboard-review/`  
协作服必须是 **HTTPS**（对应 **WSS**），否则浏览器会拦截连接。

---

## 一、用 Render 部署协作服（推荐，免费档）

1. 登录 [Render](https://render.com/) → **New** → **Blueprint**。
2. 连接 GitHub 仓库 `landora227/storyboard-review`。
3. 选择仓库里的 **`render.yaml`**（会自动创建服务 `storyboard-review-collab`）。
4. 部署完成后，在 Render 面板复制服务 URL，形如：  
   `https://storyboard-review-collab.onrender.com`
5. 在本仓库编辑 **`collab-config.js`**，把 `STORYBOARD_COLLAB_WS` 改成你的 URL。
6. `git add collab-config.js && git commit -m "Configure collab server URL" && git push`  
   等 GitHub Pages 更新后，站内「协作房间」会默认使用该地址。

**自测协作服**：浏览器打开 `https://你的域名/`，应看到一行 `storyboard-review collab server ok`。

> Render 免费实例一段时间无访问会休眠，首次连接可能需等待约 30 秒唤醒。

---

## 二、本地 Docker 联调

```bash
cd storyboard-review
docker compose up --build
```

- 页面：http://localhost:8080/index.html  
- 协作：`http://127.0.0.1:2345`（应用内默认）

---

## 三、使用流程

### 审核分享 / 阅读分享（短链接，快照）

1. 确保 `collab-config.js` 已填写协作服 HTTPS 地址（与协作房间共用同一服务）。  
2. 导入 PDF 后点 **审核分享** 或 **阅读分享**，会复制形如：  
   - 可编辑：`https://landora227.github.io/storyboard-review/#share-edit=id:xxxxx`  
   - 只读：`https://landora227.github.io/storyboard-review/#share-read=id:xxxxx`  
3. 对方用浏览器打开即可；**无需**再下载 JSON（除非分享服务不可用）。

### 协作房间（实时同步）

1. 主持人：导入 PDF → 点 **协作房间** → 确认协作服地址 → **创建房间**。  
2. 将弹出的 **编辑链接**（≤6 人同时改）发给同事；**阅读链接**人数不限。  
3. 同事用链接打开即可同步：分镜图、参考图、文字、布局比例。  
4. 房间数据在协作服**内存**中，全员离线后清空；重要版本请用 **审核分享** 做快照备份。

---

## 四、常见问题

| 现象 | 处理 |
|------|------|
| HTTPS 页面提示不能用 `http://` 协作地址 | 协作服也必须 HTTPS |
| 注册房间失败 | 确认 `POST /api/room` 可访问、URL 无多余斜杠 |
| 编辑链接进不去 / 口令错误 | 房间未注册或链接被改过；主持人重新开房间 |
| 提示编辑人数已满 | 同时编辑已满 6 人，或改用阅读链接 |
| 连接很慢 | Render 免费服冷启动，稍等再试 |
| 分享仍是 JSON | 协作服未部署或 `collab-config.js` 地址错误；部署后重新点分享按钮 |
| 分享链接打不开 | 快照已过期（默认 7 天）或服务重启后内存清空，需重新生成分享 |

---

## 五、自建 VPS

```bash
cd collab-server && npm install && PORT=2345 npm start
```

前面加 Nginx/Caddy 做 TLS，把 `collab-config.js` 里的地址改为 `https://你的域名`（若反代到 2345，可不写端口）。
