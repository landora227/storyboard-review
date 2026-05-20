# 把「分镜审核台」部署成可访问的网站

你手里的应用**本身就是一套网站前端**（HTML/CSS/JS）。要让别人用浏览器通过 **域名** 打开，需要两件事：

1. **静态资源**：`index.html`、`app.js`、`styles.css`、`archive-db.js`、`collab-client.mjs`、`landing.html` 等，放到任意静态托管或自己的 Nginx / OSS。
2. **（可选）实时协作**：单独部署 `collab-server`，在应用里填 `https://你的协作域名`（与页面同为 HTTPS，避免混合内容被拦截）。

这与 **分秒帧** 类产品不在同一量级：分秒帧提供账号体系、云端项目库、视频时间线批注、转码与权限等企业能力；本工具是 **PDF 分镜 + 意见表格 + 可选 Yjs 协作**，适合作为内部工具或小团队自用站点。

---

## 已实现：三种「上网」方式（任选其一）

下面假设你的 Git 仓库**根目录**是 `cursor-fqd`，应用位于子目录 **`storyboard-review/`**（与本仓库结构一致）。  
若你的仓库**根目录就是** `storyboard-review` 这一层，请看各节里的 **「单目录仓库」** 说明。

---

### 一、GitHub Pages（本仓库已带自动发布工作流）

1. 把包含 `storyboard-review` 与 `.github/workflows/deploy-github-pages.yml` 的仓库推到 GitHub（默认分支名 `main` 或 `master` 均可触发）。
2. 打开仓库 **Settings → Pages**。
3. **Build and deployment** 里，**Source** 选 **GitHub Actions**（不要选 Deploy from a branch）。
4. 在 **Actions** 里确认工作流 **Deploy storyboard-review to GitHub Pages** 跑绿。
5. 访问地址一般为：  
   `https://<你的用户名>.github.io/<仓库名>/`  
   或 `https://<你的用户名>.github.io/<仓库名>/index.html`  
   入口介绍页：`.../landing.html`

**单目录仓库**：若仓库根目录就是应用文件（没有外层的 `storyboard-review` 文件夹），请编辑  
`.github/workflows/deploy-github-pages.yml`，把 `path: storyboard-review` 改成 `path: .`。

---

### 二、Netlify

**方式 A · 连接 Git（推荐）**

1. 登录 [Netlify](https://www.netlify.com/) → Add new site → Import an existing project。
2. 选你的 Git 仓库。
3. **Base directory**（重要）：
   - 若仓库是「外层 + storyboard-review」结构：填 **`storyboard-review`**，并确保使用仓库根目录的 **`netlify.toml`**（其中 `publish = "storyboard-review"` 可与 Base directory 二选一，避免重复；通常 Base directory 设为 `storyboard-review` 时，Build 留空、Publish directory 用默认 `.` 即可）。
   - 若仓库根就是应用：Base directory **留空**，根目录用 **`storyboard-review/netlify.toml`** 的逻辑即可——把该文件复制到仓库根并设 `publish = "."`，或直接在 Netlify 里把 **Publish directory** 设为 `.`。
4. **Build command** 留空或填 `echo skip`；**Publish directory** 指向最终包含 `index.html` 的目录。
5. 部署完成后，打开 Netlify 提供的 `https://xxxx.netlify.app/` 即可使用。

**方式 B · 不上传 Git，直接拖文件夹**

1. 只把本地 **`storyboard-review` 文件夹里的内容**（含 `index.html`）打成 zip，或整个文件夹拖到 Netlify Drop。
2. 得到临时/固定子域名即可分享。

---

### 三、Vercel

1. 登录 [Vercel](https://vercel.com/) → Add New Project → 导入 Git 仓库。
2. **Root Directory** 选 **`storyboard-review`**（若仓库为单目录应用则选 `.`）。
3. **Framework Preset** 选 **Other**；**Build Command** 留空；**Output Directory** 若被要求可填 `.`。
4. 项目里已有 **`storyboard-review/vercel.json`**（安全相关响应头），无需再配构建。
5. 部署完成后使用 `https://你的项目.vercel.app/`。

---

### 四、Cloudflare Pages

1. [Cloudflare Dashboard](https://dash.cloudflare.com/) → Workers & Pages → **Create** → Pages → Connect to Git。
2. 选仓库后：**Build command** 留空；**Build output directory**：
   - 子目录结构：填 **`storyboard-review`**
   - 单目录仓库：填 **`.`**
3. 保存并部署，使用分配的 `*.pages.dev` 域名即可。

---

### 五、一条命令临时公开（演示用）

本机安装 Node 后，在 **`storyboard-review` 目录**执行：

```bash
npx --yes surge . 你的昵称.surge.sh
```

按提示登录/注册 Surge 后即可得到公网 HTTPS 地址（适合短期演示，不适合长期生产）。

---

## 方式 A：Docker 一键（本机或自己的 VPS）

在 **`storyboard-review` 目录**（与 `docker-compose.yml` 同级）执行：

```bash
docker compose up --build
```

- 分镜台页面：<http://localhost:8080/index.html>  
- 入口介绍页：<http://localhost:8080/landing.html>  
- 协作服务 HTTP/WebSocket：<http://localhost:2345>  

在应用内点击「协作房间」时，协作服务器地址填：`http://127.0.0.1:2345`（若页面与 Docker 不在同一台机器，把 `127.0.0.1` 换成服务器公网 IP 或域名，并放行端口）。

公网部署时请在前面加 **HTTPS 反向代理**（Caddy / Nginx + Let’s Encrypt），并把应用与协作地址都改为 `https://` / `wss://`。

---

## 协作服务单独上网（可选）

静态站上了 HTTPS 后，协作地址也必须是 **HTTPS/WSS**。可把 **`collab-server`** 用自带 **Dockerfile** 部署到：

- [Fly.io](https://fly.io/)、[Railway](https://railway.app/)、[Render](https://render.com/) 等支持 Docker 的平台；  
- 或自己的 VPS：`docker run -p 2345:2345 ...` 前面再挂 Nginx 做 TLS。

环境变量 `PORT`、`COLLAB_MAX_EDITORS` 等见 **`collab-server/README.md`**。

---

## 归档与数据说明

- 浏览器里的 **归档库** 仍在用户本机 **IndexedDB**，不会随静态站自动进入「云端账号」。
- 若需要「登录后云端项目库」级别的体验，需要另行开发后端与对象存储；这已经超出当前仓库范围，属于新产品规划。

---

## 本地开发（不用 Docker）

```bash
cd storyboard-review
python3 -m http.server 8080
# 另开终端
cd collab-server && npm install && npm start
```

浏览器打开 `http://127.0.0.1:8080/index.html`（不要用 `file://`，否则协作模块无法动态加载）。
