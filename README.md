# 时钟 · Minimal Clock

一个**零依赖**的极简时钟 Web 应用：当前时间 / 倒计时 / 正计时三合一，支持多任务并发、每日到每年的循环提醒、好友任务共享、自定义背景取景，以及**可拖拽重排的面板布局**。后端只用 Node 原生模块（`http` / `fs` / `crypto`），没有一行第三方依赖，克隆下来就能跑。

> 打开即用：`node server.js` → http://localhost:3000

---

## ✨ 功能特性

**时间与任务**
- 三种模式：当前时间（含日期星期）、倒计时、正计时（秒表）
- 多任务并发：每个任务独立计时，互不干扰，可任意时长（天/时/分/秒）
- 循环任务：每日 / 每周 / 每月 / 每年自动滚动到下一轮，进度环同步
- 完成提醒：提示音 + Toast + 浏览器标题闪烁，切了标签页也能发现
- 今日进度条：一眼看到今天过去了多少

**协作**
- 注册 / 登录（scrypt 加盐哈希，token 鉴权）
- 好友申请（互发即成好友）、任务共享给好友，好友的进度在自己的列表里实时可见

**外观**
- 5 套主题底色（纸白 / 米沙 / 雾青 / 淡紫 / 夜黑）
- 自定义背景图：本地上传或外链，**焦点取景**式拖拽 + 缩放 + 顶部/中部/底部快捷选取
- 模糊虚化、遮罩强度、卡片浓度三档调节
- 文字颜色**按背景实际亮度自适应**，也可手动锁定深色/浅色字
- 面板可拖拽重排：捏住卡片边框即可拖动，其他面板被"挤开"，落位带果冻回弹与撕纸边缘动画

---

## 🧱 技术栈

| 层 | 选型 | 说明 |
| --- | --- | --- |
| 运行时 | Node.js ≥ 16 | 仅用 `http` / `fs` / `path` / `crypto` 原生模块 |
| 后端 | 手写 HTTP 服务 | 路由 + 静态文件 + JSON 持久化，无框架 |
| 前端 | 原生 HTML / CSS / JS | 无构建、无打包、无框架 |
| 数据 | JSON 文件（`data/`） | 首次启动自动生成目录 |
| 状态记忆 | `localStorage` | 主题、模式、背景、布局都存本地 |

---

## 📁 项目结构

```
.
├── server.js           # 后端入口：路由、鉴权、静态服务、JSON 读写
├── package.json        # 元信息 + npm start
├── LICENSE             # MIT
├── README.md
├── public/             # 前端静态资源（无任何构建步骤）
│   ├── index.html      # 页面骨架：面板、弹窗、控件
│   ├── style.css       # 主题变量、布局、拖拽/果冻/撕纸动画
│   └── app.js          # 全部前端逻辑：计时、渲染、背景、布局、API 调用
├── data/               # ⚠️ 运行期数据，含账号信息，已在 .gitignore 中排除
│   ├── users.json      # 用户（id / username / salt / hash / token）
│   ├── tasks.json      # 任务（按 owner 隔离，含共享关系）
│   └── friends.json    # 好友关系
└── scripts/            # ⚠️ 本机专用脚本（含本地绝对路径），同样不入库
    └── start-clock.bat # Windows 启动脚本
```

划分原则：**`server.js` 只管接口和文件读写，`public/` 只管界面和交互**，两边通过 `/api/*` 通信；数据与本机脚本一律与源码隔离，`git clone` 出来的仓库永远是干净的代码。

---

## 🚀 快速开始

```bash
# 1. 克隆仓库
git clone https://github.com/<你的用户名>/<仓库名>.git
cd <仓库名>

# 2. 启动（无需 npm install）
node server.js          # 或 npm start

# 3. 浏览器打开
http://localhost:3000
```

换端口：

```bash
# Linux / macOS
PORT=8080 node server.js

# Windows PowerShell
$env:PORT="8080"; node server.js
```

数据目录位置也可通过 `DATA_DIR` 覆盖：`DATA_DIR=/var/lib/clock node server.js`。

---

## 🖱 使用说明

### 三种模式

| 模式 | 行为 | 循环 |
| --- | --- | --- |
| 当前时间 | 显示时分秒、日期、星期 | — |
| 倒计时 | 设定剩余时长，到点提醒；支持"结束后自动清零重跑" | 每日/周/月/年 |
| 正计时 | 从 0 开始累加，可暂停 | 每日/周/月/年 |

计时用**服务器时间戳差值**计算（`elapsedBase + (serverNow - startedAt)`），刷新页面、换设备都不会丢进度，也不会受本地时钟偏差影响。

### 好友与共享

1. 顶栏注册一个账号（用户名 2–20 字符，密码 ≥ 4 位）
2. 好友面板输入对方用户名 → 发送申请；对方同样申请你一次即互为好友
3. 选中任务 → 共享 → 勾选好友；好友的任务会出现在你的列表里，带来源标记

### 背景美化

点顶栏「背景」打开设置面板：

| 控件 | 作用 |
| --- | --- |
| 上传本地图片 | 走 `FileReader` 转 dataURL，图片不出本机 |
| 图片地址 | 粘贴任意 https 外链，回车应用 |
| 铺满 / 完整 | 对应 `cover` / `contain` 基准适配 |
| 缩放（100–400%） | 滑块或直接在小框上滚滚轮 |
| 取景位置：顶部 / 中部 / 底部 | 放大后一键只看想展示的那一段 |
| 拖动小框 | 1:1 跟手取景，双击回到正中 |
| 模糊虚化（0–30px） | 背景太抢眼时虚化一下 |
| 遮罩强度（0–80%） | 压暗背景，保证文字可读 |
| 卡片浓度（30–95%） | 卡片自身底色的不透明度 |
| 文字颜色：自动 / 深色字 / 浅色字 | 自动模式下按亮度判定，也可手动锁死 |

**实现要点**
- 取景用**焦点模型** `fx / fy ∈ [0, 1]`（等价 `background-position` 语义）：可拖行程 `over = max(0, 图片尺寸 − 视口尺寸)`，偏移 `x = −over × fx`。所以放大 400% 后依然能拖遍全图，也能精确停在顶部或底部；未放大的轴行程为 0 时自动居中，不会被"卡住"。
- 几何**只在视口坐标系算一次**，预览小框用 `transform: scale()` 做等比镜像映射，因此"小框里看到的"和"全屏实际显示的"严格一致。
- 外链图片若因 CORS 无法采样亮度，会退回中性估计并依赖遮罩/卡片浓度保证可读性。

### 面板布局（可拖拽重排）

点顶栏「布局」打开面板，或直接开拖：

- **抓边框起拖**：每张卡片四边有 10px 命中区，右上角还有点状提手，鼠标变成 `grab` 就能拖
- **挤让位**：拖动时其他面板用 FLIP（First-Last-Invert-Play）动画被"挤开"，而不是瞬间跳位；插入位置由虚线占位符指示
- **果冻质感**：拖拽中的卡片由**速度**驱动 `skewX / scale / rotate`，横向拖得快就斜着拉长，松手自动弹回，落位播放 `jelly` 关键帧回弹
- **撕纸边缘**：拖起时卡片圆角被替换为每 ~110ms 刷新一次的不规则多边形 `clip-path`，像一张被撕着移动的纸；落位后毛边逐帧收敛再恢复圆角
- **列宽挤压**：拖动两列之间的竖条，另一列被"挤窄"（220–620px）
- **模板**：经典（右栏）/ 侧栏居左 / 单栏，一键切换并带动画过渡
- **目标列高亮**：拖到哪一栏，那一栏就亮起虚线框，松手前就知道会落在哪
- **不会互相盖住**：所有面板与列都是 `flex-shrink: 0`，宁可让页面滚动也不把卡片压到比内容还矮（压扁会让溢出内容画到下一张卡片上，看起来像两个面板占了同一位置）
- **打断也能落位**：触屏被系统手势打断（`pointercancel`）、拖到一半切窗口（`blur`）都会正常落位；万一残留，下次加载会把飘在 `body` 上的卡片接回归属列并清掉内联定位
- **恢复默认**：布局弹窗内可一键重置

布局结果存 `localStorage` 的 `layoutV2`，重开浏览器保持不变；数据异常时自动回落到默认布局。

### 文字对比度自适应

背景色变深就看不清字，是这个应用以前的问题，现在这样解决：

- 把背景图缩到 24×24 采样平均亮度 `luma = 0.299R + 0.587G + 0.114B`
- 卡片内可见亮度 ≈ `卡片浓度 × 卡片基色 + (1 − 卡片浓度) × (图片亮度 × 遮罩衰减)`，据此决定卡片内文字取深色还是浅色
- 卡片外的顶栏直接用背景亮度单独定色（`--fg-out`），并加文字投影
- 主题底色为深色时卡片基色自动切换，不会出现"深图 + 半透明白卡 + 深字"
- 判断不合你意时，直接用「文字颜色」锁定深色字 / 浅色字

### 快捷键

| 键 | 功能 |
| --- | --- |
| `1` / `2` / `3` | 切换 当前时间 / 倒计时 / 正计时 |
| `空格` | 开始 / 暂停选中任务 |
| `Esc` | 关闭当前弹窗 |

---

## 🔌 API 参考

所有接口前缀 `/api`，鉴权用请求头 `x-token`。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/time` | 服务器当前毫秒时间（用于校准） |
| `POST` | `/api/register` | `{username, password}` → `{token, username}` |
| `POST` | `/api/login` | 同上，登录会刷新 token |
| `GET` | `/api/me` | 校验 token，返回用户名 |
| `GET` | `/api/tasks` | 我的任务 + 共享给我的任务 |
| `POST` | `/api/tasks` | 新建 `{name, durationMs, recurrence}` |
| `PATCH` | `/api/tasks/:id` | 更新（暂停 / 继续 / 重置 / 改名） |
| `DELETE` | `/api/tasks/:id` | 删除任务 |
| `POST` | `/api/tasks/:id/share` | `{friendId}` 共享给好友 |
| `GET` | `/api/friends` | 好友列表 + 待处理申请 |
| `POST` | `/api/friends/request` | `{username}` 发起好友申请 |
| `POST` | `/api/friends/respond` | `{reqId, accept}` 处理申请 |
| `DELETE` | `/api/friends/:id` | 删除好友 |

---

## 🔒 数据与安全

- 密码用 `crypto.scryptSync(password, salt, 64)` 加盐哈希存储，明文不落盘
- token 为 `crypto.randomBytes(24)`，登录时重新生成
- 上传体积限制 1 MB，静态服务对路径做了 `normalize` + 前缀校验，防目录穿越
- 用户数上限 50（自用场景），`data/*.json` 为纯文本，**切勿提交到公开仓库**
- `.gitignore` 已排除 `data/`、`scripts/`、`*.log`、`.idea/`

---

## 🌐 部署

代码已读 `process.env.PORT`，任何支持 Node 的平台都能直接跑。

**Render / Railway / Fly.io**（推荐，免费档即可）

```
Build command : （留空，无依赖）
Start command : node server.js
```

**Vercel / Netlify**：这两个平台面向 Serverless，不支持常驻 Node 进程，本项目请改用 Render / Railway / Fly.io，或自己的 VPS。

**VPS**

```bash
npm install -g pm2
pm2 start server.js --name clock
pm2 save && pm2 startup
```

⚠️ 免费托管平台的文件系统是**易失**的，重新部署会清空 `data/`。要长期公网使用，建议挂持久化磁盘，或把存储从 JSON 换成 SQLite / 对象存储。

### Windows 开机自启（本机）

`scripts/start-clock.bat` 里写的是本机绿色版 Node 的绝对路径，因此该文件不入库。想开机静默自启，往"启动"文件夹丢一个 vbs：

```powershell
$startup = [Environment]::GetFolderPath('Startup')
$content = @"
Set ws = CreateObject("Wscript.Shell")
ws.Run "D:\时钟\scripts\start-clock.bat", 0, False
"@
Set-Content -Path (Join-Path $startup '时钟服务自动启动.vbs') -Value $content -Encoding OEM
```

取消自启：`Win + R` → `shell:startup` → 删除那个 vbs 文件。

---

## 📤 上传到 GitHub

### 1. 建仓库

GitHub → New repository → 起名（如 `minimal-clock`）→ **不要勾选** "Add a README"（本地已有，勾了会产生冲突提交）。

### 2. 首次提交并推送

```bash
cd D:\时钟

git rm -r --cached .idea data scripts   # 把已被 IDE 抢暂存的本地文件移出索引（不删文件）
git add .
git status                              # 核对：不该出现 data/、scripts/、.idea/

git commit -m "feat: 零依赖极简时钟（面板可拖拽布局 + 自定义背景取景）"
git branch -M main
git remote add origin https://github.com/<你的用户名>/minimal-clock.git
git push -u origin main
```

### 3. 认证方式（二选一）

- **Git Credential Manager**（Windows 装 Git 时自带）：`git push` 会弹浏览器登录，授权一次以后不再问。**推荐**，密码 / token 不经过命令行。
- **Fine-grained Personal Access Token**：Settings → Developer settings → Fine-grained tokens → 选中目标仓库、勾 `Contents: Read and write`。推送时用户名填 token 名、密码填 token。

> ⚠️ 不要把 token 写进 remote URL（会明文留在 `.git/config`），也不要提交任何 `data/*.json`。

### 4. 之后每次更新

```bash
git add . && git commit -m "docs: 更新说明" && git push
```

### 5. 核对仓库内容

公开仓库里应当只有：`server.js`、`package.json`、`README.md`、`LICENSE`、`.gitignore`、`public/` 三个文件。看到 `users.json` 或 `.idea/` 立即 `git rm -r --cached` 并重新推送。

---

## 🧪 开发方式

没有构建步骤，改完 `public/` 里的文件直接刷新浏览器。改了 `server.js` 需要重启进程。

```bash
node --check server.js   # 语法自检
node --check public/app.js
```

---

## 🛠 已知限制

- JSON 文件存储是**同步读写**，几十用户够用，再多就该换数据库
- 好友共享只读进度，不能协作控制同一个任务
- 背景图以 dataURL 存在浏览器本地，大图（约 >2 MB）可能超出 `localStorage` 配额，会提示改用外链
- 无 WebSocket：好友进度靠前端轮询刷新
- 布局拖拽只在桌面指针事件下测试充分，触屏可用但没有惯性甩动等手势优化

## 🔭 可扩展方向

- 存储层换成 SQLite（`node:sqlite`）或 Postgres，顺带解决部署易失问题
- 学习/专注时长统计与周视图报表
- 好友排行榜、打卡日历
- WebSocket 或 SSE 推送替代轮询
- PWA（离线 + 桌面安装）

---

## 📄 License

MIT — 随便用，注明出处即可。
