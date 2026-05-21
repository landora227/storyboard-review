# 用 Replit 部署协作/分享后台（不用 Render、不绑信用卡）

Replit 提供一台在网上的小电脑，跑 `collab-server`。  
部署成功后，分镜台里的 **审核分享 / 阅读分享 / 协作房间** 才能生成真正的网页短链接。

---

## 你需要准备

- 一个 **GitHub 账号**（你已有 `landora227`）
- 浏览器（Chrome / Safari 均可）
- 本仓库已推到 GitHub：`landora227/storyboard-review`

---

## 第一步：注册 Replit

1. 打开 **https://replit.com/**
2. 点 **Sign up** → 选 **Continue with GitHub**（用 GitHub 登录最省事）
3. 按提示授权，进入 Replit 首页

---

## 第二步：从 GitHub 导入项目

1. 左上角 **+ Create**（创建）
2. 选 **Import from GitHub**
3. 若提示连接 GitHub，点连接并授权
4. 在仓库列表里找到 **`storyboard-review`**，点 **Import**
5. 名称可随意，例如 `storyboard-collab`
6. 等待创建完成，进入在线编辑器界面

---

## 第三步：只运行协作文件夹

导入后默认是整个仓库。在 Replit 里：

1. 看左侧文件列表，确认有文件夹 **`collab-server`**
2. 点开 **`collab-server`**，应能看到 `server.cjs`、`package.json`
3. 点上方绿色 **Run**（运行）

第一次会自动执行 `npm install` 再启动（已在 `.replit` 里写好）。

若 Run 后报错「找不到 package」：

1. 点下方 **Shell**（终端）
2. 输入下面两行（每行回车一次）：

```bash
cd collab-server
npm install && npm start
```

---

## 第四步：确认服务已启动

1. Run 成功后，右侧 **Webview** 或 **Open in new tab** 会打开一个地址
2. 页面上应看到几行英文，包含 **`collab server ok`** 和 **`POST /api/share`**
3. 浏览器地址栏类似：  
   `https://storyboard-collab.xxxx.repl.co/`  
   **复制这个地址（不要末尾斜杠也可以）**，后面要填进网站配置

若页面空白：等 30 秒再刷新；或看 **Console** 有没有红色报错。

---

## 第五步：发布成固定网址（Deploy）

仅点 Run 时，Replit 免费版一段时间不用会休眠。建议再 **Deploy** 一次：

1. 点右上角 **Deploy**（部署）或 **Publish**
2. 类型选 **Autoscale** 或 **Reserved VM**（有免费额度；界面文案可能略有不同）
3. 确认启动命令是：`npm install && npm start`，工作目录在 **`collab-server`**
   - 若 Deploy 设置里有 **Root directory**，填：`collab-server`
4. 点 **Deploy**，等几分钟
5. 复制 **Production URL**（生产环境地址），形如：  
   `https://storyboard-collab.xxxx.repl.co`

**记下这个 https 地址**，就是你的「协作/分享后台」。

---

## 第六步：写进分镜台配置并更新网页

1. 在你电脑上打开项目里的文件：  
   `storyboard-review/collab-config.js`
2. 把里面一行改成你的 Replit 地址，例如：

```javascript
window.STORYBOARD_COLLAB_WS = "https://storyboard-collab.xxxx.repl.co";
```

3. 保存后，在终端执行：

```bash
cd /Users/fengqiaodi/Documents/cursor-fqd/storyboard-review
git add collab-config.js
git commit -m "Use Replit for share and collab server"
git push
```

4. 等 2～5 分钟，打开：  
   **https://landora227.github.io/storyboard-review/**

---

## 第七步：自测「阅读分享」是否变成链接

1. 导入一份 PDF
2. 点 **阅读分享**
3. 正常应提示：**已复制「阅读分享」链接**（不再下载 json）
4. 链接里应有：`#share-read=id:一串字符`
5. 用无痕窗口打开该链接 → 只能看、不能改

再试 **审核分享** → `#share-edit=id:...` → 对方可编辑。

---

## 发给同事怎么用（阅读链接）

把复制到的整段链接发过去即可，例如：

`https://landora227.github.io/storyboard-review/#share-read=id:AbCdEf...`

对方用浏览器打开，**不用**再导入 json。

---

## 常见问题

| 现象 | 处理 |
|------|------|
| Replit 也要绑卡 | 换邮箱或稍后再试；或继续用 JSON +「导入分享」 |
| Run 后立刻停了 | 再点一次 Run；或完成 Deploy |
| 分享仍是 json | `collab-config.js` 地址错、未 push、或 Replit 未启动 |
| 链接打不开 | Replit 睡着，先打开 Replit 页点 Run，等 30 秒再点分享链接 |
| 只能导入整个大仓库 | 正常；务必在 `collab-server` 里 Run |

---

## 和 Render 的关系

- **二选一即可**，不要同时配两个地址
- `collab-config.js` 里只保留 **一个** `https://...` 地址（Replit 或 Render）
