const http = require('http')
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const PORT = process.env.PORT || 3000
const PUBLIC_DIR = path.join(__dirname, 'public')
// 运行期数据统一放 data/，首次启动自动创建；该目录不入库
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data')
const DATA_FILE = path.join(DATA_DIR, 'tasks.json')
const USERS_FILE = path.join(DATA_DIR, 'users.json')
const FRIENDS_FILE = path.join(DATA_DIR, 'friends.json')

fs.mkdirSync(DATA_DIR, { recursive: true })

// 循环周期（毫秒）
const CYCLE = {
  daily: 864e5,
  weekly: 7 * 864e5,
  monthly: 30 * 864e5,
  yearly: 365 * 864e5,
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
}

/* ---------- 存储 ---------- */

function loadJSON(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return []
  }
}
function saveJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8')
}
const loadTasks = () => loadJSON(DATA_FILE)
const saveTasks = (t) => saveJSON(DATA_FILE, t)
const loadUsers = () => loadJSON(USERS_FILE)
const saveUsers = (u) => saveJSON(USERS_FILE, u)
const loadFriends = () => loadJSON(FRIENDS_FILE)
const saveFriends = (f) => saveJSON(FRIENDS_FILE, f)

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
      return sendJSON(res, 200, { ok: true })
    }
  }

  const tasks = loadTasks()
  const users = loadUsers()
  const nameOf = (id) => (users.find((u) => u.id === id) || {}).username || '未知用户'
  const myTasks = tasks.filter((t) => t.owner === user.id)

  // GET /api/tasks —— 我的任务 + 好友共享给我的任务（共享任务只读）
  if (req.method === 'GET' && route === 'tasks' && seg.length === 2) {
    const shared = tasks
      .filter((t) => t.owner !== user.id && Array.isArray(t.shareWith) && t.shareWith.includes(user.id))
      .map((t) => ({ ...t, shared: true, sharedBy: nameOf(t.owner) }))
    return sendJSON(res, 200, [...myTasks, ...shared])
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
      shareWith: [], // 共享给的好友 userId 列表
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

  // POST /api/tasks/:id/share  { to: friendUserId | 'all' } —— 共享任务给好友
  if (req.method === 'POST' && route === 'tasks' && seg[3] === 'share') {
    const body = await readBody(req)
    const task = tasks.find((t) => t.id === seg[2] && t.owner === user.id)
    if (!task) return sendJSON(res, 404, { error: '任务不存在' })
    const friends = friendIdsOf(user.id)
    if (!friends.length) return sendJSON(res, 400, { error: '还没有好友，先加好友再共享' })
    const targets = body.to === 'all' ? friends : [String(body.to)].filter((x) => friends.includes(x))
    if (!targets.length) return sendJSON(res, 400, { error: '只能共享给好友' })
    task.shareWith = Array.from(new Set([...(task.shareWith || []), ...targets]))
    saveTasks(tasks)
    return sendJSON(res, 200, task)
  }

  // POST /api/tasks/:id/unshare  { from: friendUserId | 'all' } —— 撤回共享
  if (req.method === 'POST' && route === 'tasks' && seg[3] === 'unshare') {
    const body = await readBody(req)
    const task = tasks.find((t) => t.id === seg[2] && t.owner === user.id)
    if (!task) return sendJSON(res, 404, { error: '任务不存在' })
    task.shareWith = body.from === 'all' ? [] : (task.shareWith || []).filter((x) => x !== String(body.from))
    saveTasks(tasks)
    return sendJSON(res, 200, task)
  }

  // DELETE /api/tasks/:id
  if (req.method === 'DELETE' && route === 'tasks' && seg.length === 3) {
    const idx = tasks.findIndex((t) => t.id === seg[2] && t.owner === user.id)
    if (idx === -1) return sendJSON(res, 404, { error: '任务不存在' })
    tasks.splice(idx, 1)
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

http.createServer((req, res) => {
  const { pathname } = new URL(req.url, `http://${req.headers.host}`)
  if (pathname.startsWith('/api/')) {
    handleAPI(req, res, pathname).catch((e) => sendJSON(res, 400, { error: e.message }))
  } else {
    serveStatic(req, res, pathname)
  }
}).listen(PORT, () => {
  console.log(`⏳ 时钟已启动：http://localhost:${PORT}`)
})
