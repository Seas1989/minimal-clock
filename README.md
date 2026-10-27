# 时钟 · Minimal Clock

一个**零依赖**的极简时钟 Web 应用：当前时间 / 倒计时 / 正计时三合一，支持多任务并发、**多个计时窗同屏挂开**、每日到每年的循环提醒、好友**同任务挑战**（各自打卡、按进度排行、点赞）、自定义背景取景，以及**可拖拽重排、由自写弹簧物理驱动的面板布局**。后端只用 Node 原生模块（`http` / `fs` / `crypto`），没有一行第三方依赖，克隆下来就能跑。

> 打开即用：`node server.js` → http://localhost:3000

---

## ✨ 功能特性

**时间与任务**
- 三种模式：当前时间（含日期星期）、倒计时、正计时（秒表）
- 多任务并发：每个任务独立计时，互不干扰，可任意时长（天/时/分/秒）
- **计时窗口坞**：任务点上 `▢` 就挂到主界面顶部，学英语时可以同时挂「英语」「学习」两个窗；点窗切换当前大表盘显示谁，点 `✕` 收起但**后台继续计时**
- **专注模式**：窗上的 `⤢` 把整页虚化，屏幕上只留下这一个计时
- 循环任务：每日 / 每周 / 每月 / 每年自动滚动到下一轮，进度环同步
- 完成提醒：提示音 + Toast + 浏览器标题闪烁，切了标签页也能发现
- 今日进度条：一眼看到今天过去了多少

**协作**
- 注册 / 登录（scrypt 加盐哈希，token 鉴权）
- 好友申请（互发即成好友）
- **同任务挑战**：把一个目标发给好友，各自建自己的任务打卡，排行榜按**完成进度**排序、可互相点赞；邀请制，**对方可以拒绝**

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
| 存储层 | `lib/store.js`（~130 行） | 内存真源 + 原子写 + `.bak` 自动回滚，无数据库依赖 |
| 挑战算法 | `lib/challenges.js`（~95 行） | 进度推导 / 排行 / 详情视图，纯函数，不碰 HTTP 与磁盘 |
| 前端 | 原生 HTML / CSS / JS | 无构建、无打包、无框架 |
| 动效 | `public/physics.js`（~110 行） | 自写弹簧积分引擎（半隐式欧拉），非第三方库 |
| 数据 | JSON 文件（`data/`） | 首次启动自动生成目录 |
| 状态记忆 | `localStorage` | 主题、模式、背景、布局都存本地 |

---

## 📁 项目结构

```
.
├── server.js           # 后端入口：路由、鉴权、静态服务
├── lib/
│   ├── store.js        # 存储层：内存真源 + 原子写 + 备份回滚（无第三方依赖）
│   └── challenges.js   # 同任务挑战的纯计算：进度推导、排行、详情视图
├── package.json        # 元信息 + npm start / npm test
├── LICENSE             # MIT
├── README.md
├── test/
│   ├── store.test.js   # 端到端测试：重启不丢账号、并发不覆盖、坏文件自动恢复
│   └── challenge.test.js # 挑战测试：进度/排行 + 邀请状态机 + 点赞权限 + 旧数据迁移
├── public/             # 前端静态资源（无任何构建步骤）
│   ├── index.html      # 页面骨架：面板、窗口坞、专注层、弹窗、控件
│   ├── style.css       # 主题变量、布局动画
│   ├── physics.js      # 微物理引擎：弹簧 / 全局 rAF 心跳 / 指针速度 / 橡皮筋
│   └── app.js          # 全部前端逻辑：计时、渲染、背景、拖拽布局、API 调用
├── data/               # ⚠️ 运行期数据，含账号信息，已在 .gitignore 中排除
│   ├── users.json      # 用户（id / username / salt / hash / token）
│   ├── tasks.json      # 任务（按 owner 隔离，含所属挑战与窗口开关）
│   ├── friends.json    # 好友关系
│   ├── challenges.json # 同任务挑战（成员名单、邀请、点赞）
│   └── *.bak / *.bad-* # 存储层自动维护的备份与损坏留档（同样不入库）
└── scripts/            # ⚠️ 本机专用脚本（含本地绝对路径），同样不入库
    └── start-clock.bat # Windows 启动脚本
```

划分原则：**`server.js` 只管接口，`lib/store.js` 只管数据怎么存，`public/` 只管界面和交互**，两边通过 `/api/*` 通信；数据与本机脚本一律与源码隔离，`git clone` 出来的仓库永远是干净的代码。

---

## 🚀 快速开始

```bash
# 1. 克隆仓库
git clone https://github.com/Seas1989/minimal-clock.git
cd minimal-clock

# 2. 启动（无需 npm install）
node server.js          # 或 npm start

# 3. 浏览器打开
http://localhost:3000
```

可选：跑一遍端到端测试（自己拉起服务、用临时数据目录，不碰 `data/`）：

```bash
npm test                # 46 项断言：存储层 14 项（重启/并发/回滚）+ 挑战 32 项（进度/排行/邀请/点赞/迁移）
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

### 好友

1. 顶栏注册一个账号（用户名 2–20 字符，密码 ≥ 4 位）
2. 好友面板输入对方用户名 → 发送申请；对方同样申请你一次即互为好友
3. 解除好友时，两人在挑战里互相的**待处理邀请**自动作废（已加入的历史进度保留）

### 同任务挑战（以前的“共享”重做了）

旧版共享是把同一个任务对象发给好友只读看，做到的是“一起完成同一份数据”；真正的激励应当是**同一个目标各自打卡**。所以现在：

| 步骤 | 做什么 |
| --- | --- |
| 发起 | 任务上点 `↗` → 勾选好友（可多选、可全选）→ 发出邀请。倒计时自带目标量；正计时需额外给一个“每轮目标时长”（默认 30 分，5–600 可调） |
| 收到 | 挑战面板里排在最前的就是待处理申请，**接受 / 拒绝** 两个按钮都能点；拒绝后不再出现，除非对方重新邀请 |
| 接受 | 自动给自己建一份**同目标的同名任务**，计时完全独立，谁也不能改谁 |
| 排行 | 进详情（其余界面雾化）按完成进度排序：先比刷完整了几轮，再比本轮跑了多少，最后比累计时长 |
| 点赞 | 每行一个 `♥`，再点取消；不能给自己点，未加入的人不能点 |
| 收尾 | 成员可“退出挑战”（任务保留），发起人只能“关闭挑战”（解绑所有人的任务，计时数据不删） |

进度不存历史表，全部从任务自身的 `elapsedBase` 推导：`cycles = floor(累计毫秒 / 目标毫秒)`，所以刷新、换设备、离线重连后排行仍然一致。

### 多窗口与专注

- **挂窗**：任务行上点 `▢`，这任务就出现在主卡片顶部的窗口坞；再点一个就是两个窗同时跳。`window` 开关存在服务端，换设备登录也一样
- **切窗**：点某个窗 → 自动跳到对应标签页并把大表盘切给它，当前那个窗描白边
- **收窗**：`✕` 只是从屏上拿掉，**后台接着跑**，再点 `▢` 挂回来时进度一点不少
- **专注**：窗上 `⤢` → 整页 `backdrop-filter: blur()` 雾化，只留下这一个计时（大字时间 + 进度条 + 开始/暂停/重置），`Esc` 或“退出专注”回到普通界面
- **新建任务时**：窗口坞还是空的会自动挂上第一个窗，不用多一步

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

- **抓边框起拖**：每张卡片四边有 10px 命中区（触屏加宽到 22px），右上角还有点状提手，鼠标变成 `grab` 就能拖
- **弹簧跟手**：卡片不是直接贴在指针上，而是被一根“很硬的弹簧”（刚度 1050 / 阻尼 48）拖着追指针 —— 急转向时会跟不上半步再追回来，就有重量感了
- **挤让位**：拖动时其他面板的位移不是 CSS 过渡，而是把布局跳变的差量当作“初始偏移 + 保留原有速度”交给弹簧回拉，连续挤压会**累积动量**，越挤越“撞”；插入位置由虚线占位符指示
- **惯性甩出**：松手时把卡片自身速度注入落位弹簧，快抛出去会过冲一段再弹回，慢放则直接归位
- **果冻质感**：形变与倾角取“手的即时速度”驱动 `skewX / scale / rotate`，横向拖得快就斜着拉长，一停就弹回（形变弹簧的静止阈值收到千分级，否则末尾“弹回原尺寸”会被当成误差直接跳掉）
- **撕纸边缘**：拖起时圆角被替换为每 ~90ms 刷新一次的不规则多边形 `clip-path`，毛边幅度随拖拽速度涨；落位后逐帧收敛再恢复圆角
- **橡皮筋边界**：拖出可用区不会硬停，而是按 iOS 橡皮筋公式越拉越沉，能拽出去一点但脱不了缰
- **列宽挤压**：拖动两列之间的竖条，另一列被“挤窄”（220–620px）
- **模板**：经典（右栏）/ 侧栏居左 / 单栏，一键切换并带动画过渡
- **目标列高亮**：拖到哪一栏，那一栏就亮起虚线框，松手前就知道会落在哪
- **不会互相盖住**：所有面板与列都是 `flex-shrink: 0`，宁可让页面滚动也不把卡片压到比内容还矮（压扁会让溢出内容画到下一张卡片上，看起来像两个面板占了同一位置）
- **打断也能落位**：触屏被系统手势打断（`pointercancel`）、拖到一半切窗口（`blur`）都会正常落位；万一残留，下次加载会把飘在 `body` 上的卡片接回归属列并清掉内联定位
- **省电**：全部弹簧共用一条 `requestAnimationFrame` 心跳，静止后自动停摆，不空转
- **恢复默认**：布局弹窗内可一键重置

布局结果存 `localStorage` 的 `layoutV2`，重开浏览器保持不变；数据异常时自动回落到默认布局。没引入第三方物理库（GSAP / matter.js 与“零依赖、无构建”的定位冲突），`public/physics.js` 一百行写完。

### 手机端适配

手机浏览器和桌面的差别不只是“屏幕窄”，这里按真实痛点一条条处理：

| 现象 | 原因 | 做法 |
| --- | --- | --- |
| 主题色圆点看不见、切不了颜色 | 顶栏是一行不换行的 flex，窄屏上整行溢出，圆点被挤出屏幕右侧 | `header` / `.header-right` 允许换行，圆点在手机上放大到 26px |
| 浏览器地址栏和页面颜色割裂 | 没声明 `theme-color`，手机浏览器只能猜（一般猜白） | 切主题时由 JS 动态写入 `meta[name=theme-color]`；有背景图时按压暗后的亮度取深/浅 |
| 两栏被挤成牙签 | 侧栏写死 `--side-w`（220–620px），窗口 820px 时主栏只剩 440px | ≤ 1024px 时侧栏取 `clamp(220px, 32vw, var(--side-w))`，跟着视口缩但不低于 220px |
| 手机上还是左右两栏 | 桌面布局被 `localStorage` 带过来 | ≤ 760px 强制 `flex-direction: column`，列宽拖动条隐藏，模板按钮一并隐藏（此时三个模板没区别） |
| 卡片拖不动 / 一拖就滚页 | 浏览器先抢走手势去滚动 | 四边命中区与提手都加 `touch-action: none`；手指还需先走 8px 才真正抬起卡片，避免滑动起点误触 |
| 拖过去永远落在第一个面板 | 单栏下两栏都是整宽并上下叠，用 x 判断命中列必然命中第一栏 | 命中轴跟着布局走：`matchMedia('(max-width: 760px)')` 或单栏模板时改用 y 判定 |
| 拖到一半被系统手势打断，卡片飘在屏幕上 | `pointercancel` / 切窗口没收尾 | `pointercancel`、`blur` 均正常落位；加载时兜底把飘着的卡片接回归属列 |
| 底部被 iPhone 横条压住、下方一大片空白 | `100vh` 在地址栏收放时算错，且没留安全区 | `min-height` 用 `100dvh`（带回退），`padding` 叠 `env(safe-area-inset-*)`，`viewport-fit=cover` |
| 点输入框整个页面被放大 | iOS 在字号 < 16px 时聚焦自动缩放 | 手机上 `input / select` 统一 `font-size: 16px` |
| 任务列表里面套一层滚动 | 小屏里嵌套滚动难用 | 手机上取消 `max-height: 46vh`，交给整页滚动 |
| 面板/登录框看着就是一片空白 | 卡片底色是 4% 透明，在大屏上靠阴影分层，小屏上根本看不出边界 | 窄屏下给 `.card` / `.auth-card` 描一圈 `inset 0 0 0 1px var(--line)` 细边 |
| 弹窗上半部分看不见也滚不到 | `.modal` 用 `grid + place-items: center`，内容高于视口时上面被裁掉 | 改成 `flex + overflow-y: auto + margin: auto`，这是“能滚动的安全居中” |
| 点完按钮像被按着不放、提手一直粘在最后一张卡片 | 触屏没有 hover，`:hover` 态点完不消失 | `@media (hover: none)` 关掉圆点缩放与 hover 底色，提手改为常驻 50% 透明度 |

浏览器地址栏输入局域网 IP（手机和电脑同一 WiFi）即可访问，端口由 `PORT` 决定，默认 3000。

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
| `Esc` | 逐层退出：确认框 → 专注层 → 挑战详情 → 发起挑战弹窗 |

---

## 🔌 API 参考

所有接口前缀 `/api`，鉴权用请求头 `x-token`。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/time` | 服务器当前毫秒时间（用于校准） |
| `POST` | `/api/register` | `{username, password}` → `{token, username}` |
| `POST` | `/api/login` | 同上，登录会刷新 token |
| `GET` | `/api/me` | 校验 token，返回用户名 |
| `GET` | `/api/tasks` | 我的任务（挑战另走 `/api/challenges`，不再把别人的任务对象搬过来） |
| `POST` | `/api/tasks` | 新建 `{name, type, duration, recurrence}` |
| `POST` | `/api/tasks/:id/action` | `{action}` start / pause / resume / reset / complete |
| `POST` | `/api/tasks/:id/window` | `{open}` 挂上 / 收起计时窗口 |
| `DELETE` | `/api/tasks/:id` | 删除任务（挑战本身保留，该成员显示为“未绑定任务”） |
| `GET` | `/api/friends` | 好友列表 + 待处理申请 |
| `POST` | `/api/friends/request` | `{username}` 发起好友申请 |
| `POST` | `/api/friends/respond` | `{reqId, accept}` 处理申请 |
| `DELETE` | `/api/friends/:id` | 删除好友（作废互相的待处理挑战邀请） |
| `GET` | `/api/challenges` | 我参与的 + 待我处理的邀请，每项带排行后的成员进度 |
| `POST` | `/api/challenges` | `{taskId, to: friendId[] \| 'all', duration?}` 发起挑战 |
| `POST` | `/api/challenges/:id/respond` | `{accept}` 接受（自动建同目标任务）/ 拒绝 |
| `POST` | `/api/challenges/:id/invite` | `{to}` 发起人追加邀请 |
| `POST` | `/api/challenges/:id/like` | `{user}` 给成员点赞（再点取消） |
| `POST` | `/api/challenges/:id/leave` | 退出挑战（发起人请直接用关闭） |
| `DELETE` | `/api/challenges/:id` | 发起人关闭挑战，解绑所有人的任务 |

---

## 🔒 数据与安全

- 密码用 `crypto.scryptSync(password, salt, 64)` 加盐哈希存储，明文不落盘
- token 为 `crypto.randomBytes(24)`，登录时重新生成
- 上传体积限制 1 MB，静态服务对路径做了 `normalize` + 前缀校验，防目录穿越
- 用户数上限 50（自用场景），`data/*.json` 为纯文本，**切勿提交到公开仓库**
- `.gitignore` 已排除 `data/`、`scripts/`、`*.log`、`.idea/`

### 为什么重启不会丢账号（`lib/store.js`）

旧写法是“每个请求自己读文件 → 改 → 整体写回”，两个真实丢数据的坑就埋在这里：

| 坑 | 旧行为 | 现在的做法 |
| --- | --- | --- |
| 并发注册 | 两个请求各自读到同一份列表，后写的把先写的盖掉 → 账号静默消失 | 内存数组是唯一真源，“取→改→写盘”全在同步代码里完成 |
| 写一半断电 | `writeFileSync` 直接盖主文件，断电就留半截 JSON | 先写 `.tmp` + `fsync`，确认落盘后再原子改名替换 |
| 主文件坏了 | `catch` 里返回 `[]` → 下次保存直接清空整个文件 | 依次试 `主文件 → .tmp → .bak`，恢复后固化；坏文件改名 `.bad-时间戳` 留档，绝不静默清空 |
| 字段不齐 | 登录后 `user.salt` 踩空 | 载入时 `validate` 剔除不完整记录并在启动日志里说明剔了几条 |

启动时会做一次自检，日志直接报数：

```
[store] 数据自检：users.json 3 条 | tasks.json 12 条 | friends.json 2 条 | challenges.json 1 条
```

出过事则会写明从哪个文件恢复：“`[store] 已从 users.json.bak 恢复 users.json（3 条）`”。

旧版的“共享任务”（`shareWith` 字段）会在启动时一次性转成同任务挑战，被共享过的人当作**已接受邀请**的成员，日志会报 `[migrate] 已把 N 个旧“共享任务”转成同任务挑战`。

`npm test` 把上面四条坑当作断言跑一遍（用系统临时目录做 `DATA_DIR`，不碰真实 `data/`）。

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

本仓库已上线：https://github.com/Seas1989/minimal-clock。下面步骤是给自己换机器 / 重建仓库时复现用的。

### 1. 建仓库

GitHub → New repository → 起名（如 `minimal-clock`）→ **不要勾选** "Add a README"（本地已有，勾了会产生冲突提交）。

> 踩过的坑：**fine-grained token 不能建仓**。`POST /user/repos` 只支持 classic token / OAuth，fine-grained 无论怎么加权限都是 403 `Resource not accessible by personal access token`。建仓要么走网页手动，要么用有 `Administration: Read and write` 的 classic token。

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

公开仓库里应当只有：`server.js`、`lib/store.js`、`test/store.test.js`、`public/` 四个文件、`package.json`、`README.md`、`LICENSE`、`.gitignore`。看到 `users.json`、`scripts/` 或 `.idea/` 立即 `git rm -r --cached` 并重新推送。

```bash
git ls-tree -r --name-only origin/main    # 一眼扫完全清单
git config --get remote.origin.url        # 确认 URL 里没有嵌 token
```

---

## 🧪 开发方式

没有构建步骤，改完 `public/` 里的文件直接刷新浏览器。改了 `server.js` 或 `lib/` 需要重启进程。

```bash
node --check server.js       # 语法自检
node --check public/app.js
npm test                     # 存储层端到端测试（临时目录，不碰 data/）
```

### 改完就推

```bash
git add -A
git commit -m "feat: ……"
git push                     # 凭据在系统凭据管理器里，命令行不出现 token
```

首次把凭据交给系统（任选其一，之后的推送都不必再带 token）：

- 直接 `git push`，Git Credential Manager 会弹浏览器授权一次；
- 或用 PAT：`printf "protocol=https\nhost=github.com\nusername=<用户名>\npassword=<token>\n\n" | git credential approve`。

> 不要把 token 写进 remote URL（会明文留在 `.git/config`），也不要给它加 `repo` 以外的写权限。

---

## 🛠 已知限制

- JSON 文件存储靠“内存真源 + 原子写盘”，几十用户够用；真要上百并发就该换数据库
- 数据只在启动时读盘，服务跑着的时候手工改 `data/*.json` 不会被发现（重启才会）
- 好友共享只读进度，不能协作控制同一个任务
- 背景图以 dataURL 存在浏览器本地，大图（约 >2 MB）可能超出 `localStorage` 配额，会提示改用外链
- 无 WebSocket：好友进度靠前端轮询刷新
- 拖拽的惯性 / 果冻手感在桌面指针事件下调过；触屏能拖、也有惯性，但未逐机型验证多指与系统手势冲突

## 🔭 可扩展方向

- 存储层换成 SQLite（Node 22+ 自带 `node:sqlite`，仍零依赖）或 Postgres，顺带解决部署易失问题
- 拖拽物理参数（刚度 / 阻尼 / 质量）暴露成设置项，支持“干脆”与“果冻”两档手感
- 学习/专注时长统计与周视图报表
- 好友排行榜、打卡日历
- WebSocket 或 SSE 推送替代轮询
- PWA（离线 + 桌面安装）

---

## 📄 License

MIT — 随便用，注明出处即可。
