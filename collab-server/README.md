# 分镜审核台 · 协作 WebSocket 服务

基于 **Yjs** 的文档同步，与前端 `collab-client.mjs`（`y-websocket`）配套使用。

## 安装与启动

```bash
cd collab-server
npm install
npm start
```

默认监听 `0.0.0.0:2345`。可用环境变量：

| 变量 | 说明 | 默认 |
|------|------|------|
| `HOST` | 绑定地址 | `0.0.0.0` |
| `PORT` | HTTP + WebSocket 端口 | `2345` |
| `COLLAB_MAX_EDITORS` | 同一房间最多「编辑」连接数 | `6` |
| `GC` | 设为 `false` 关闭 Yjs GC | 开启 |

**Docker**：本目录提供 `Dockerfile`，也可在上一级目录用 `docker compose up` 同时起静态站 + 协作服（见 `../DEPLOY-网站.md`）。

## HTTP API

- `POST /api/room`  
  Body（JSON）：`{ "id": "<房间 id>", "token": "<口令>" }`  
  房间 id 须为 `8–64` 位 `[a-zA-Z0-9_-]`，口令至少 16 字符。  
  前端主持人在连接 WebSocket **之前**必须先调用此接口注册口令。

- `GET /`  
  健康检查，返回纯文本说明。

## WebSocket

连接 URL 形如：

```txt
ws://<host>:<port>/sb-<房间id>?token=<口令>&role=edit
ws://<host>:<port>/sb-<房间id>?token=<口令>&role=read
```

- `role=read`：只读；服务端会丢弃来自该连接的 **Yjs Update**（仍参与同步与 Awareness）。
- 编辑连接数超过 `COLLAB_MAX_EDITORS` 时，新编辑连接会被关闭（代码 `4002`）。

## 部署注意

1. 若静态站点为 **HTTPS**，协作服务须使用 **HTTPS + WSS**（或同源反向代理），否则浏览器会拦截 `http://` / `ws://`。
2. 房间数据在**内存**中：全部用户断开后文档即销毁，请与「审核分享 / JSON 归档」配合做持久化备份。
3. 生产环境建议在反向代理后开启 TLS，并对 `POST /api/room` 增加鉴权或频率限制。
