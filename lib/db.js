/* ---------- lib/db.js：数据访问层 ----------
 *
 * 五个 Store 实例 + 各自的 load/save 别名，外加两块"看着像业务、其实只是取数"的逻辑：
 * 好友关系（friendIdsOf）与每人一条的音乐配置行（musicRowOf）。
 *
 * 为什么用模块单例而不是构造好再传进去：Node 的 require 缓存让这份内存真源天然全局唯一，
 * 路由模块 require 一下就拿到同一个数组引用 —— 数据只在首次访问时读盘，之后的增删改都发生
 * 在同一份内存上（并发的处理见 lib/store.js）。以前这些代码住在 server.js 顶部，
 * 现在 server.js 只管起服务与分发，取数细节集中在这里。
 *
 * DATA_DIR 可由环境变量覆盖：测试就是靠它把数据写到系统临时目录，不碰真实 data/。
 */
const fs = require('fs')
const path = require('path')
const { Store } = require('./store')
const { CYCLE } = require('./challenges')

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data')

fs.mkdirSync(DATA_DIR, { recursive: true })

/* ---------- 存储 ----------
 * 内存里的数组是唯一真源（lib/store.js）：
 *   - 接口中的“取列表 -> 改 -> 落盘”全在同步代码里完成，并发请求不会互相覆盖
 *   - 落盘是原子的（.tmp + fsync + 改名），并且自动留 .bak，重启不丢账号
 * load 拿到的是同一份内存引用，save 只是把当前内存快照原子写回磁盘。
 */

const usersStore = new Store(path.join(DATA_DIR, 'users.json'), {
  // 字段不全的记录（多半是早期写坏留下的）不进内存，避免登录逻辑踩空
  validate: (u) => u && u.id && u.username && u.salt && u.hash,
})
const tasksStore = new Store(path.join(DATA_DIR, 'tasks.json'))
const friendsStore = new Store(path.join(DATA_DIR, 'friends.json'))
// 挑战记录：成员列表与点赞必须成对存在，缺 members 的残记录直接不进内存
const challengesStore = new Store(path.join(DATA_DIR, 'challenges.json'), {
  validate: (c) => c && c.id && c.owner && Array.isArray(c.members),
})
// 全局服务端设置（目前只有音乐配置），只存 data/ 不入库
const settingsStore = new Store(path.join(DATA_DIR, 'settings.json'))

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

// 新纪录的 id：时间戳 + 随机尾，够短能直接放进 URL，自用规模下撞不上
function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
}

// 已接受好友关系的对方用户 id
function friendIdsOf(userId, rels = loadFriends()) {
  return rels
    .filter((r) => r.status === 'accepted' && (r.a === userId || r.b === userId))
    .map((r) => (r.a === userId ? r.b : r.a))
}

// id -> 用户名：接口到处要显示对方名字，但用户表不该被到处传递
const nameOf = (id) => (loadUsers().find((u) => u.id === id) || {}).username || '未知用户'

/* ---------- 音乐配置 ----------
 * 每人一条记录：{ musicU, platform, source }。platform 决定休息时走哪个只读代理，
 * MUSIC_U 只对网易云有意义（QQ 音乐这边不需要 cookie 也能拿到免费曲目的地址）。
 * 两个平台各存一半会互相覆盖，所以读写统一走 /api/music/config。
 */
const MUSIC_PLATFORMS = ['netease', 'qq']

// 给前端看的形状：永不回传 MUSIC_U 明文，只给打码指纹
const musicView = (row) => ({
  platform: row.platform,
  hasCookie: !!row.musicU,
  // 打码指纹：前 6 后 4，够用户核对自己粘的是哪一段了
  cookieMask: row.musicU ? `${row.musicU.slice(0, 6)}…${row.musicU.slice(-4)}` : '',
  source: row.source,
})

function musicRowOf(userId) {
  const list = loadSettings()
  let row = list.find((s) => s.user === userId)
  if (!row) {
    row = { user: userId, musicU: '', platform: 'netease', source: { kind: 'light', value: '', label: '' }, updatedAt: Date.now() }
    list.push(row)
    saveSettings()
  }
  // 老记录里没这些字段：按“一直在用网易云 + 内置轻音乐”补齐，别把配置读成 undefined
  if (!MUSIC_PLATFORMS.includes(row.platform)) row.platform = 'netease'
  if (!row.source || typeof row.source !== 'object') row.source = { kind: 'light', value: '', label: '' }
  return row
}

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
  const rows = [usersStore, tasksStore, friendsStore, challengesStore, settingsStore].map((s) => {
    const { name, count, notes } = s.info()
    return `${name} ${count} 条${notes.length ? '（' + notes.join('，') + '）' : ''}`
  })
  console.log('[store] 数据自检：' + rows.join(' | '))
  const moved = migrateSharesToChallenges()
  if (moved) console.log(`[migrate] 已把 ${moved} 个旧“共享任务”转成同任务挑战（被共享者视为已接受）`)
}

// 所有写盘都是同步完成的，退出时只需保证不留 .tmp 干扰下次启动
function cleanTmpFiles() {
  try {
    // 半截临时文件没有价值，主文件与 .bak 仍然完好
    fs.readdirSync(DATA_DIR)
      .filter((f) => f.endsWith('.tmp'))
      .forEach((f) => fs.rmSync(path.join(DATA_DIR, f)))
  } catch { /* 清理失败不影响退出 */ }
}

module.exports = {
  DATA_DIR,
  usersStore,
  tasksStore,
  friendsStore,
  challengesStore,
  settingsStore,
  loadUsers,
  saveUsers,
  loadTasks,
  saveTasks,
  loadFriends,
  saveFriends,
  loadChallenges,
  saveChallenges,
  loadSettings,
  saveSettings,
  genId,
  friendIdsOf,
  nameOf,
  MUSIC_PLATFORMS,
  musicView,
  musicRowOf,
  selfCheck,
  cleanTmpFiles,
}
