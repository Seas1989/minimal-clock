const http = require('http')
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { Store } = require('./lib/store')
const { CYCLE, challengeView } = require('./lib/challenges')

const PORT = process.env.PORT || 3000
const PUBLIC_DIR = path.join(__dirname, 'public')
// 运行期数据统一放 data/，首次启动自动创建；该目录不入库
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data')
const DATA_FILE = path.join(DATA_DIR, 'tasks.json')
const USERS_FILE = path.join(DATA_DIR, 'users.json')
const FRIENDS_FILE = path.join(DATA_DIR, 'friends.json')
const CHALLENGES_FILE = path.join(DATA_DIR, 'challenges.json')
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json')

fs.mkdirSync(DATA_DIR, { recursive: true })

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
}

/* ---------- 存储 ----------
 * 内存里的数组是唯一真源（lib/store.js）：
 *   - 接口中的“取列表 -> 改 -> 落盘”全在同步代码里完成，并发请求不会互相覆盖
 *   - 落盘是原子的（.tmp + fsync + 改名），并且自动留 .bak，重启不丢账号
 * 旧写法 loadUsers()/saveUsers(x) 保留语义：load 拿到的是同一份内存引用，
 * save 只是把当前内存快照原子写回磁盘。
 */

const usersStore = new Store(USERS_FILE, {
  // 字段不全的记录（多半是早期写坏留下的）不进内存，避免登录逻辑踩空
  validate: (u) => u && u.id && u.username && u.salt && u.hash,
})
const tasksStore = new Store(DATA_FILE)
const friendsStore = new Store(FRIENDS_FILE)
// 挑战记录：成员列表与点赞必须成对存在，缺 members 的残记录直接不进内存
const challengesStore = new Store(CHALLENGES_FILE, {
  validate: (c) => c && c.id && c.owner && Array.isArray(c.members),
})
// 全局服务端设置（目前只有网易云 cookie），只存 data/ 不入库
const settingsStore = new Store(SETTINGS_FILE)

const loadUsers = () => usersStore.data
const loadTasks = () => tasksStore.data
const loadFriends = () => friendsStore.data
const loadChallenges = () => challengesStore.data
const loadSettings = () => settingsStore.data
const saveUsers = () => usersStore.save()
const saveTasks = () => tasksStore.save()
const saveFriends = () => friendsStore.save()
const saveChallenges = () => challengesStore.save()
const saveSettings = () => settingsStore.save()

// 已接受好友关系的对方用户 id
function friendIdsOf(userId, rels = loadFriends()) {
  return rels
    .filter((r) => r.status === 'accepted' && (r.a === userId || r.b === userId))
    .map((r) => (r.a === userId ? r.b : r.a))
}

/* ---------- 鉴权 ---------- */

function hashPassword(password, salt) {
  return crypto.scryptSync(String(password), salt, 64).toString('hex')
}

function makeToken() {
  return crypto.randomBytes(24).toString('hex')
}

// 根据请求头 x-token 找到当前用户，找不到返回 null
function getUser(req) {
  const token = req.headers['x-token']
  if (!token) return null
  return loadUsers().find((u) => u.token === token) || null
}

/* ---------- 工具 ---------- */

function sendJSON(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  })
  res.end(JSON.stringify(data))
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = ''
    req.on('data', (chunk) => {
      raw += chunk
      if (raw.length > 1e6) {
        reject(new Error('body too large'))
        req.destroy()
        return
      }
    })
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {})
      } catch {
        reject(new Error('invalid JSON'))
      }
    })
    req.on('error', reject)
  })
}

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
}

/* ---------- API ---------- */

async function handleAPI(req, res, pathname) {
  const seg = pathname.split('/').filter(Boolean)
  const route = seg[1] // time | tasks | register | login | me

  /* ----- 用户：注册 / 登录 / 当前用户 ----- */

  if (req.method === 'POST' && route === 'register') {
    const body = await readBody(req)
    const username = String(body.username || '').trim()
    const password = String(body.password || '')
    if (username.length < 2 || username.length > 20) return sendJSON(res, 400, { error: '用户名需 2-20 个字符' })
    if (password.length < 4) return sendJSON(res, 400, { error: '密码至少 4 位' })
    const users = loadUsers()
    if (users.some((u) => u.username === username)) return sendJSON(res, 409, { error: '用户名已存在' })
    if (users.length >= 50) return sendJSON(res, 403, { error: '用户数已达上限' })

    const salt = crypto.randomBytes(16).toString('hex')
    const user = {
      id: genId(),
      username,
      salt,
      hash: hashPassword(password, salt),
      token: makeToken(),
      createdAt: Date.now(),
    }
    users.push(user)
    saveUsers(users)
    return sendJSON(res, 200, { token: user.token, username: user.username })
  }

  if (req.method === 'POST' && route === 'login') {
    const body = await readBody(req)
    const username = String(body.username || '').trim()
    const password = String(body.password || '')
    const users = loadUsers()
    const user = users.find((u) => u.username === username)
    if (!user || hashPassword(password, user.salt) !== user.hash) {
      return sendJSON(res, 401, { error: '用户名或密码错误' })
    }
    user.token = makeToken() // 登录刷新 token
    saveUsers(users)
    return sendJSON(res, 200, { token: user.token, username: user.username })
  }

  if (req.method === 'GET' && route === 'me') {
    const user = getUser(req)
    if (!user) return sendJSON(res, 401, { error: '未登录' })
    return sendJSON(res, 200, { username: user.username })
  }

  /* ----- 时间（无需登录）----- */

  if (req.method === 'GET' && route === 'time') {
    return sendJSON(res, 200, { now: Date.now() })
  }

  /* ----- 好友（均需登录，见下方鉴权）----- */

  /* ----- 以下任务接口均需登录 ----- */

  const user = getUser(req)
  if (!user) return sendJSON(res, 401, { error: '请先登录' })

  if (route === 'friends') {
    const users = loadUsers()
    const nameOf = (id) => (users.find((u) => u.id === id) || {}).username || '未知用户'
    const rels = loadFriends()

    // GET /api/friends —— 好友列表 + 待处理申请
    if (req.method === 'GET') {
      const friends = friendIdsOf(user.id, rels).map((id) => ({ id, username: nameOf(id) }))
      const incoming = rels
        .filter((r) => r.status === 'pending' && r.b === user.id)
        .map((r) => ({ reqId: r.id, username: nameOf(r.a) }))
      const outgoing = rels
        .filter((r) => r.status === 'pending' && r.a === user.id)
        .map((r) => ({ reqId: r.id, username: nameOf(r.b) }))
      return sendJSON(res, 200, { friends, incoming, outgoing })
    }

    // POST /api/friends/request  { username } —— 加好友（对方已申请则直接成为好友）
    if (req.method === 'POST' && seg[2] === 'request') {
      const body = await readBody(req)
      const target = users.find((u) => u.username === String(body.username || '').trim())
      if (!target) return sendJSON(res, 404, { error: '用户不存在' })
      if (target.id === user.id) return sendJSON(res, 400, { error: '不能添加自己' })
      const exists = rels.find(
        (r) => (r.a === user.id && r.b === target.id) || (r.a === target.id && r.b === user.id)
      )
      if (exists && exists.status === 'accepted') return sendJSON(res, 409, { error: '已经是好友了' })
      if (exists && exists.status === 'pending') {
        if (exists.b === user.id) {
          exists.status = 'accepted'
          saveFriends(rels)
          return sendJSON(res, 200, { ok: true, accepted: true })
        }
        return sendJSON(res, 409, { error: '申请已发送，等待对方同意' })
      }
      rels.push({ id: genId(), a: user.id, b: target.id, status: 'pending', createdAt: Date.now() })
      saveFriends(rels)
      return sendJSON(res, 200, { ok: true })
    }

    // POST /api/friends/respond  { reqId, accept } —— 同意 / 拒绝
    if (req.method === 'POST' && seg[2] === 'respond') {
      const body = await readBody(req)
      const rel = rels.find((r) => r.id === body.reqId && r.b === user.id && r.status === 'pending')
      if (!rel) return sendJSON(res, 404, { error: '申请不存在' })
      if (body.accept) rel.status = 'accepted'
      else rels.splice(rels.indexOf(rel), 1)
      saveFriends(rels)
      return sendJSON(res, 200, { ok: true })
    }

    // DELETE /api/friends/:friendId —— 解除好友，并撤回相互的任务共享
    if (req.method === 'DELETE' && seg.length === 3) {
      const fid = seg[2]
      const idx = rels.findIndex(
        (r) => r.status === 'accepted' && ((r.a === user.id && r.b === fid) || (r.a === fid && r.b === user.id))
      )
      if (idx === -1) return sendJSON(res, 404, { error: '好友不存在' })
      rels.splice(idx, 1)
      saveFriends(rels)
      const tasks = loadTasks()
      let changed = false
      tasks.forEach((t) => {
        if (Array.isArray(t.shareWith) && t.shareWith.includes(fid)) {
          t.shareWith = t.shareWith.filter((x) => x !== fid)
          changed = true
        }
      })
      if (changed) saveTasks(tasks)
      // 解除好友后，两人在挑战里互相的待处理邀请一并作废（已加入的历史进度保留）
      const challenges = loadChallenges()
      let chChanged = false
      challenges.forEach((c) => {
        const before = (c.invites || []).length
        c.invites = (c.invites || []).filter((i) => !((i.user === fid || i.user === user.id) && i.status === 'pending'))
        if (c.invites.length !== before) chChanged = true
      })
      if (chChanged) saveChallenges()
      return sendJSON(res, 200, { ok: true })
    }
  }

  const tasks = loadTasks()
  const users = loadUsers()
  const nameOf = (id) => (users.find((u) => u.id === id) || {}).username || '未知用户'
  const myTasks = tasks.filter((t) => t.owner === user.id)

  // GET /api/tasks —— 只看自己的任务（同任务挑战走 /api/challenges，不再把别人的任务对象搬过来）
  if (req.method === 'GET' && route === 'tasks' && seg.length === 2) {
    return sendJSON(res, 200, myTasks)
  }

  // POST /api/tasks —— 新建任务
  if (req.method === 'POST' && route === 'tasks' && seg.length === 2) {
    const body = await readBody(req)
    const name = String(body.name || '').trim() || '未命名任务'
    const type = body.type === 'stopwatch' ? 'stopwatch' : 'countdown'
    const duration = Math.max(0, Number(body.duration) || 0)
    const recurrence = CYCLE[body.recurrence] ? body.recurrence : 'none'

    const task = {
      id: genId(),
      owner: user.id,
      name,
      type,
      duration,     // 倒计时总时长（毫秒）
      recurrence,   // none | daily | weekly | monthly | yearly
      challenge: null, // 所属挑战 id（由发起/接受挑战写入）
      status: 'stopped',
      elapsedBase: 0,
      startedAt: null,
      createdAt: Date.now(),
    }
    tasks.push(task)
    saveTasks(tasks)
    return sendJSON(res, 200, task)
  }

  // POST /api/tasks/:id/action
  if (req.method === 'POST' && route === 'tasks' && seg[3] === 'action') {
    const body = await readBody(req)
    const task = tasks.find((t) => t.id === seg[2] && t.owner === user.id)
    if (!task) return sendJSON(res, 404, { error: '任务不存在' })

    const now = Date.now()
    const liveElapsed = () =>
      task.status === 'running' ? task.elapsedBase + (now - task.startedAt) : task.elapsedBase

    switch (body.action) {
      case 'start':
        task.elapsedBase = 0
        task.startedAt = now
        task.status = 'running'
        break
      case 'pause':
        if (task.status === 'running') {
          task.elapsedBase = liveElapsed()
          task.startedAt = null
          task.status = 'paused'
        }
        break
      case 'resume':
        if (task.status === 'paused') {
          task.startedAt = now
          task.status = 'running'
        }
        break
      case 'reset':
        task.elapsedBase = 0
        task.startedAt = null
        task.status = 'stopped'
        break
      case 'complete':
        task.elapsedBase = liveElapsed()
        task.startedAt = null
        task.status = 'done'
        break
      default:
        return sendJSON(res, 400, { error: '未知操作' })
    }

    saveTasks(tasks)
    return sendJSON(res, 200, task)
  }

  // DELETE /api/tasks/:id
  if (req.method === 'DELETE' && route === 'tasks' && seg.length === 3) {
    const idx = tasks.findIndex((t) => t.id === seg[2] && t.owner === user.id)
    if (idx === -1) return sendJSON(res, 404, { error: '任务不存在' })
    // 挑掉任务后不动挑战：成员身份与历史进度还要参与排行，前端会显示成“未绑定任务”
    tasks.splice(idx, 1)
    saveTasks(tasks)
    return sendJSON(res, 200, { ok: true })
  }

  // POST /api/tasks/:id/window  { open: true|false } —— 记录这个任务的计时窗口是否挂在主界面窗口坞上
  if (req.method === 'POST' && route === 'tasks' && seg[3] === 'window') {
    const body = await readBody(req)
    const task = tasks.find((t) => t.id === seg[2] && t.owner === user.id)
    if (!task) return sendJSON(res, 404, { error: '任务不存在' })
    task.window = !!body.open
    saveTasks(tasks)
    return sendJSON(res, 200, task)
  }

  /* ----- 同任务挑战：同一个目标，各自计时，按进度排行 + 点赞 ----- */

  const challenges = loadChallenges()
  const findChallenge = () => challenges.find((c) => c.id === seg[2])
  // 邀请名单：'all' = 全好友；也接受 id 数组（前端多选）；只认好友，并排除已在成员里的人
  function inviteList(body, ch) {
    const friends = friendIdsOf(user.id)
    if (!friends.length) throw new Error('还没有好友，先加好友再发起挑战')
    const picked = body.to === 'all' ? friends : Array.isArray(body.to) ? body.to.map(String) : [String(body.to)]
    const have = new Set([...(ch ? ch.members : []), ...(ch ? ch.invites || [] : []).filter((i) => i.status !== 'rejected').map((i) => i.user)])
    const targets = Array.from(new Set(picked)).filter((x) => friends.includes(x) && !have.has(x))
    if (!targets.length) throw new Error('只能邀请还没加入的好友')
    return targets
  }

  // GET /api/challenges —— 我参与的 + 待我处理的邀请
  if (req.method === 'GET' && route === 'challenges' && seg.length === 2) {
    const mine = challenges.filter(
      (c) => c.members.includes(user.id) || (c.invites || []).some((i) => i.user === user.id && i.status === 'pending')
    )
    return sendJSON(res, 200, mine.map((c) => challengeView(c, tasks, nameOf, user.id)))
  }

  // POST /api/challenges  { taskId, to: friendId | 'all', title?, duration? } —— 由我的任务发起挑战
  if (req.method === 'POST' && route === 'challenges' && seg.length === 2) {
    const body = await readBody(req)
    const src = tasks.find((t) => t.id === body.taskId && t.owner === user.id)
    if (!src) return sendJSON(res, 404, { error: '任务不存在' })
    if (src.challenge) return sendJSON(res, 409, { error: '这个任务已经在挑战里了' })
    let targets
    try {
      targets = inviteList(body, null)
    } catch (e) {
      return sendJSON(res, 400, { error: e.message })
    }
    const now = Date.now()
    const ch = {
      id: genId(),
      title: (String(body.title || '').trim() || src.name).slice(0, 30),
      type: src.type,
      // 正计时任务本身没有目标量，由发起人额外给一个“每轮目标时长”才能排行
      duration: src.type === 'stopwatch' ? Math.max(0, Number(body.duration) || 0) : src.duration,
      recurrence: CYCLE[src.recurrence] ? src.recurrence : 'none',
      owner: user.id,
      members: [user.id],
      invites: targets.map((uid) => ({ id: genId(), user: uid, status: 'pending', at: now })),
      likes: [],
      createdAt: now,
    }
    challenges.push(ch)
    src.challenge = ch.id
    saveChallenges()
    saveTasks(tasks)
    return sendJSON(res, 200, challengeView(ch, tasks, nameOf, user.id))
  }

  // GET /api/challenges/:id —— 挑战略详情（成员进度 + 点赞）
  if (req.method === 'GET' && route === 'challenges' && seg.length === 3) {
    const ch = findChallenge()
    if (!ch) return sendJSON(res, 404, { error: '挑战不存在' })
    if (!ch.members.includes(user.id) && !(ch.invites || []).some((i) => i.user === user.id)) {
      return sendJSON(res, 403, { error: '你不在这个挑战里' })
    }
    return sendJSON(res, 200, challengeView(ch, tasks, nameOf, user.id))
  }

  // POST /api/challenges/:id/respond  { accept } —— 接受 / 拒绝邀请（拒绝后不再骚扰，除非重新邀请）
  if (req.method === 'POST' && route === 'challenges' && seg[3] === 'respond') {
    const body = await readBody(req)
    const ch = findChallenge()
    if (!ch) return sendJSON(res, 404, { error: '挑战不存在' })
    const inv = (ch.invites || []).find((i) => i.user === user.id && i.status === 'pending')
    if (!inv) return sendJSON(res, 404, { error: '没有待你处理的邀请' })
    if (!body.accept) {
      inv.status = 'rejected'
      inv.at = Date.now()
      saveChallenges()
      return sendJSON(res, 200, { ok: true, accepted: false })
    }
    inv.status = 'accepted'
    if (!ch.members.includes(user.id)) ch.members.push(user.id)
    // 接受 = 给自己建一份同名任务，计时完全独立，只是同一个目标
    if (!tasks.some((t) => t.challenge === ch.id && t.owner === user.id)) {
      tasks.push({
        id: genId(),
        owner: user.id,
        name: ch.title,
        type: ch.type,
        duration: ch.duration,
        recurrence: ch.recurrence,
        challenge: ch.id,
        status: 'stopped',
        elapsedBase: 0,
        startedAt: null,
        createdAt: Date.now(),
      })
      saveTasks(tasks)
    }
    saveChallenges()
    return sendJSON(res, 200, { ok: true, accepted: true })
  }

  // POST /api/challenges/:id/invite  { to } —— 追加邀请
  if (req.method === 'POST' && route === 'challenges' && seg[3] === 'invite') {
    const body = await readBody(req)
    const ch = findChallenge()
    if (!ch) return sendJSON(res, 404, { error: '挑战不存在' })
    if (ch.owner !== user.id) return sendJSON(res, 403, { error: '只有发起人能邀请' })
    let targets
    try {
      targets = inviteList(body, ch)
    } catch (e) {
      return sendJSON(res, 400, { error: e.message })
    }
    const now = Date.now()
    // 之前拒绝过的人重新邀请：直接复用那条记录，不留一堆 rejected 垃圾
    targets.forEach((uid) => {
      const old = (ch.invites || []).find((i) => i.user === uid)
      if (old) Object.assign(old, { status: 'pending', at: now })
      else ch.invites.push({ id: genId(), user: uid, status: 'pending', at: now })
    })
    saveChallenges()
    return sendJSON(res, 200, challengeView(ch, tasks, nameOf, user.id))
  }

  // POST /api/challenges/:id/like  { user } —— 给某成员的进度点赞（再点取消）
  if (req.method === 'POST' && route === 'challenges' && seg[3] === 'like') {
    const body = await readBody(req)
    const ch = findChallenge()
    if (!ch) return sendJSON(res, 404, { error: '挑战不存在' })
    const target = String(body.user || '')
    if (!ch.members.includes(user.id)) return sendJSON(res, 403, { error: '加入后才能点赞' })
    if (!ch.members.includes(target)) return sendJSON(res, 404, { error: '对方不在挑战里' })
    if (target === user.id) return sendJSON(res, 400, { error: '不能给自己点赞' })
    ch.likes = ch.likes || []
    const i = ch.likes.findIndex((l) => l.by === user.id && l.target === target)
    if (i >= 0) ch.likes.splice(i, 1)
    else ch.likes.push({ by: user.id, target, at: Date.now() })
    saveChallenges()
    return sendJSON(res, 200, challengeView(ch, tasks, nameOf, user.id))
  }

  // POST /api/challenges/:id/leave —— 退出挑战（发起人不能退，只能关闭）
  if (req.method === 'POST' && route === 'challenges' && seg[3] === 'leave') {
    const ch = findChallenge()
    if (!ch) return sendJSON(res, 404, { error: '挑战不存在' })
    if (ch.owner === user.id) return sendJSON(res, 400, { error: '发起人请直接关闭挑战' })
    ch.members = ch.members.filter((x) => x !== user.id)
    ch.invites = (ch.invites || []).filter((i) => i.user !== user.id)
    tasks.forEach((t) => {
      if (t.challenge === ch.id && t.owner === user.id) t.challenge = null
    })
    saveChallenges()
    saveTasks(tasks)
    return sendJSON(res, 200, { ok: true })
  }

  // DELETE /api/challenges/:id —— 发起人关闭挑战，并解绑所有人的任务
  if (req.method === 'DELETE' && route === 'challenges' && seg.length === 3) {
    const idx = challenges.findIndex((c) => c.id === seg[2])
    if (idx === -1) return sendJSON(res, 404, { error: '挑战不存在' })
    if (challenges[idx].owner !== user.id) return sendJSON(res, 403, { error: '只有发起人能关闭' })
    const [gone] = challenges.splice(idx, 1)
    tasks.forEach((t) => {
      if (t.challenge === gone.id) t.challenge = null
    })
    saveChallenges()
    saveTasks(tasks)
    return sendJSON(res, 200, { ok: true })
  }

  return sendJSON(res, 404, { error: 'not found' })
}

/* ---------- 静态文件 ---------- */

function serveStatic(req, res, pathname) {
  const file = pathname === '/' ? '/index.html' : pathname
  const full = path.join(PUBLIC_DIR, path.normalize(file).replace(/^([/\\])+/, ''))
  if (!full.startsWith(PUBLIC_DIR)) {
    res.writeHead(403)
    return res.end('Forbidden')
  }
  fs.readFile(full, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
      return res.end('404 Not Found')
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(full).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    })
    res.end(data)
  })
}

/* ---------- 服务 ---------- */

/* 旧版“共享任务”是把同一个任务对象发给好友只读查看，做到的是“一起完成同一份数据”，
 * 而不是“同一个目标各自打卡”。启动时一次性把它们转成挑战：
 * 被共享过的人当作“已接受邀请”的成员，各自后面自己建任务计时。 */
function migrateSharesToChallenges() {
  const tasks = loadTasks()
  const challenges = loadChallenges()
  let moved = 0
  let dirty = false
  tasks.forEach((t) => {
    const list = Array.isArray(t.shareWith) ? t.shareWith.filter(Boolean) : []
    if (!list.length) {
      if (t.shareWith) { delete t.shareWith; dirty = true }
      return
    }
    if (t.challenge) { delete t.shareWith; dirty = true; return }
    const now = Date.now()
    const ch = {
      id: genId(),
      title: t.name,
      type: t.type,
      duration: t.type === 'stopwatch' ? 0 : t.duration,
      recurrence: CYCLE[t.recurrence] ? t.recurrence : 'none',
      owner: t.owner,
      members: Array.from(new Set([t.owner, ...list])),
      invites: list.map((uid) => ({ id: genId(), user: uid, status: 'accepted', at: now })),
      likes: [],
      createdAt: now,
      fromShare: true,
    }
    challenges.push(ch)
    t.challenge = ch.id
    delete t.shareWith
    moved++
    dirty = true
  })
  if (moved) saveChallenges()
  if (dirty) saveTasks()
  return moved
}

// 启动自检：把几份数据的现状读一遍，有损坏时日志会直接说出“从哪个文件恢复了什么”
function selfCheck() {
  const rows = [usersStore, tasksStore, friendsStore, challengesStore].map((s) => {
    const { name, count, notes } = s.info()
    return `${name} ${count} 条${notes.length ? '（' + notes.join('，') + '）' : ''}`
  })
  console.log('[store] 数据自检：' + rows.join(' | '))
  const moved = migrateSharesToChallenges()
  if (moved) console.log(`[migrate] 已把 ${moved} 个旧“共享任务”转成同任务挑战（被共享者视为已接受）`)
}

const server = http.createServer((req, res) => {
  const { pathname } = new URL(req.url, `http://${req.headers.host}`)
  if (pathname.startsWith('/api/')) {
    handleAPI(req, res, pathname).catch((e) => sendJSON(res, 400, { error: e.message }))
  } else {
    serveStatic(req, res, pathname)
  }
})

server.listen(PORT, () => {
  selfCheck()
  console.log(`⏳ 时钟已启动：http://localhost:${PORT}`)
  console.log(`   数据目录：${DATA_DIR}`)
})

// 所有写盘都是同步完成的，退出时只需保证不留 .tmp 干扰下次启动
function shutdown() {
  try {
    // 半截临时文件没有价值，主文件与 .bak 仍然完好
    fs.readdirSync(DATA_DIR)
      .filter((f) => f.endsWith('.tmp'))
      .forEach((f) => fs.rmSync(path.join(DATA_DIR, f)))
  } catch { /* 清理失败不影响退出 */ }
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(0), 1500).unref()
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
