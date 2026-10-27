/* ---------- test/challenge.test.js：同任务挑战的端到端测试 ----------
 * 跑法：node test/challenge.test.js（或 npm test 之前单独跑）
 * 覆盖四件最容易出错的事：
 *   1. 进度推导：cycles/pct 只能从任务自身累计量算出来，且不依赖每日循环
 *   2. 排行：刷完的轮数 > 当前这轮跑多远 > 总投入
 *   3. 邀请状态机：待处理能接受也能拒绝，拒绝后不再骚扰，重新邀请复用同一条记录
 *   4. 旧版 shareWith 数据能在启动时迁移成挑战
 * 全程用临时 DATA_DIR，不碰 data/ 里的真实数据。
 */
const { spawn } = require('child_process')
const http = require('http')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { memberProgress, rankMembers, challengeView, progressLabel } = require('../lib/challenges')

const PORT = 3712
const DATA = path.join(os.tmpdir(), `clock-challenge-test-${process.pid}`)
const SERVER = path.join(__dirname, '..', 'server.js')
const PASS = 'test-pass-1234'

let passed = 0
let failed = 0
function ok(cond, label) {
  if (cond) { passed++; console.log(`  OK   ${label}`) }
  else { failed++; console.log(`  FAIL ${label}`) }
}

function api(method, p, body, token) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port: PORT, path: p, method, headers: { 'Content-Type': 'application/json', ...(token ? { 'x-token': token } : {}) } },
      (res) => {
        let raw = ''
        res.on('data', (c) => (raw += c))
        res.on('end', () => {
          try { resolve({ status: res.statusCode, json: JSON.parse(raw || '{}') }) }
          catch { resolve({ status: res.statusCode, json: null }) }
        })
      }
    )
    req.on('error', reject)
    if (body) req.write(JSON.stringify(body))
    req.end()
  })
}

function startServer() {
  return new Promise((resolve, reject) => {
    const lines = []
    const child = spawn(process.execPath, [SERVER], {
      env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const onData = (buf) => { lines.push(String(buf)); if (String(buf).includes('时钟已启动')) resolve({ child, lines }) }
    child.stdout.on('data', onData)
    child.stderr.on('data', onData)
    setTimeout(() => reject(new Error('启动超时：' + lines.join(''))), 8000).unref()
  })
}
const stop = (c) => new Promise((res) => { c.on('exit', res); c.kill() })
const reg = async (name) => (await api('POST', '/api/register', { username: name, password: PASS })).json.token
// a 发起申请、b 同意，才算好友（服务端是双向状态机）
async function befriend(from, to, toName) {
  await api('POST', '/api/friends/request', { username: toName }, from)
  const inc = await api('GET', '/api/friends', null, to)
  const reqId = inc.json.incoming[0].reqId
  return api('POST', '/api/friends/respond', { reqId, accept: true }, to)
}

;(async () => {
  fs.rmSync(DATA, { recursive: true, force: true })

  console.log('1) 进度推导与排行（纯计算）')
  const ch = { id: 'c1', title: '英语 30 分钟', type: 'countdown', duration: 18e5, recurrence: 'daily', owner: 'A', members: ['A', 'B'], invites: [], likes: [{ by: 'B', target: 'A' }] }
  // 跑了 37 分钟、目标 30 分钟 => 刷完 1 轮，本轮 23.3%
  const p = memberProgress({ status: 'paused', startedAt: null, elapsedBase: 37 * 6e4 }, ch)
  ok(p.cycles === 1 && Math.round(p.pct * 100) === 23, `已完成轮数与本轮百分比（${p.cycles} 轮 / ${Math.round(p.pct * 100)}%）`)
  const T0 = 1700000000000 // 真实时间戳量级：paused 时服务端会把 startedAt 置 null
  ok(memberProgress({ status: 'running', startedAt: T0, elapsedBase: 5 * 6e4 }, ch, T0 + 25 * 6e4).ms === 30 * 6e4, 'running 时按 now 补上正在跑的这段')
  ok(memberProgress({ status: 'paused', startedAt: null, elapsedBase: 30 * 6e4 }, ch, T0 + 9e6).ms === 30 * 6e4, '暂停后进度不再跟着时间涨')
  ok(memberProgress(null, ch).missing === true, '成员没绑定任务时标记 missing 而不是崩')
  ok(memberProgress({ status: 'done', elapsedBase: 1000 }, { ...ch, duration: 0 }).pct === 1, '正计时型没有目标量，完成即 100%')
  const ranked = rankMembers([
    { cycles: 0, pct: 0.9, ms: 10 },
    { cycles: 2, pct: 0.1, ms: 20 },
    { cycles: 1, pct: 0.5, ms: 30 },
    { cycles: 1, pct: 0.5, ms: 90 },
  ])
  ok(ranked[0].cycles === 2 && ranked[1].ms === 90 && ranked[2].cycles === 1 && ranked[3].pct === 0.9, '排行先比轮数、再比本轮、最后比总时长')
  ok(progressLabel({ cycles: 3, pct: 0.5, ms: 0 }, ch).includes('3 天'), `每日循环的进度说“几天”（${progressLabel({ cycles: 3, pct: 0.5, ms: 0 }, ch)}）`)
  ok(progressLabel({ cycles: 0, pct: 0, ms: 12 * 6e4 }, { ...ch, duration: 0 }) === '累计 12 分钟', '纯计时型的进度说累计分钟')

  const view = challengeView(ch, [
    { id: 't1', owner: 'A', name: '英语', challenge: 'c1', status: 'running', elapsedBase: 0, startedAt: T0 },
  ], (id) => ({ A: '甲', B: '乙' }[id]), 'B', T0 + 6e4)
  ok(view.members[0].user === 'A' && view.members[0].ms === 6e4, '挑战详情里按当前进度排好序，且能算出对方跑了多久')
  ok(view.members[0].likes === 1 && view.members[0].likedByMe === true, '点赞数与“我点过”一起给出，前端不用再算')
  ok(view.members[1].isMe === true && view.members[1].missing === true, '我自己的行能认出来，且没绑任务时是 missing')
  ok(view.ownerName === '甲' && view.isOwner === false && view.joined === true, '发起人名、我是否发起人、我是否成员')

  console.log('2) 邀请状态机（HTTP）')
  let s = await startServer()
  const ta = await reg('甲甲')
  const tb = await reg('乙乙')
  const tc = await reg('丙丙')
  await befriend(ta, tb, '乙乙')
  await befriend(ta, tc, '丙丙')

  let task = (await api('POST', '/api/tasks', { name: '读书 30 分', type: 'countdown', duration: 18e5, recurrence: 'none' }, ta)).json
  let created = (await api('POST', '/api/challenges', { taskId: task.id, to: 'all' }, ta)).json
  ok(created.members.length === 1 && created.pending.length === 2, `发起后只有我在成员里，2 条待同意（成员 ${created.members.length}）`)
  ok((await api('POST', '/api/challenges', { taskId: task.id, to: 'all' }, ta)).status === 409, '同一个任务不能重复发起挑战')

  let listBox = (await api('GET', '/api/challenges', null, tb)).json
  ok(listBox.length === 1 && listBox[0].joined === false && listBox[0].myInvite.status === 'pending', '乙看到待处理的邀请，能判断出还没加入')
  ok((await api('GET', '/api/challenges', null, tc)).json.length === 1, '丙也看到邀请（拒绝前）')

  await api('POST', `/api/challenges/${created.id}/respond`, { accept: true }, tb)
  const bTasks = (await api('GET', '/api/tasks', null, tb)).json
  ok(bTasks.length === 1 && bTasks[0].challenge === created.id && bTasks[0].duration === 18e5, '接受邀请自动建了同目标的同名任务，计时完全独立')
  ok((await api('GET', '/api/tasks', null, ta)).json.length === 1 && (await api('GET', '/api/tasks', null, ta)).json[0].name === '读书 30 分', '甲的任务没有被乙的进度改动')

  await api('POST', `/api/challenges/${created.id}/respond`, { accept: false }, tc)
  ok((await api('GET', '/api/challenges', null, tc)).json.length === 0, '拒绝后这条申请从丙的列表里消失')
  const after = (await api('GET', '/api/challenges', null, ta)).json[0]
  ok(after.members.length === 2 && after.pending.length === 0, `甲侧成员变成 2 人、无待处理（成员 ${after.members.length}）`)

  console.log('3) 点赞与权限')
  const bUser = after.members.find((m) => m.username === '乙乙')
  let liked = (await api('POST', `/api/challenges/${created.id}/like`, { user: bUser.user }, ta)).json
  ok(liked.members.find((m) => m.user === bUser.user).likes === 1, '给成员点赞成功，返回最新视图')
  ok((await api('POST', `/api/challenges/${created.id}/like`, { user: bUser.user }, ta)).json.members.find((m) => m.user === bUser.user).likes === 0, '再点一次取消')
  ok((await api('POST', `/api/challenges/${created.id}/like`, { user: bUser.user }, tb)).status === 400, '不能给自己点赞')
  ok((await api('POST', `/api/challenges/${created.id}/like`, { user: bUser.user }, tc)).status === 403, '已退出/未加入的人不能点赞')

  console.log('4) 窗口坞开关会持久化')
  await api('POST', `/api/tasks/${task.id}/window`, { open: true }, ta)
  ok((await api('GET', '/api/tasks', null, ta)).json[0].window === true, 'window=true 落盘，重启后窗口还在')

  console.log('5) 退出、关闭与旧数据迁移')
  await api('POST', `/api/challenges/${created.id}/leave`, {}, tb)
  const left = (await api('GET', '/api/challenges', null, ta)).json
  ok(left.length === 0 || left[0].members.length === 1, '乙退出后不再参与排行')
  ok((await api('GET', '/api/tasks', null, tb)).json[0].challenge === null, '退出只解绑，乙自己的任务仍保留')
  await api('POST', `/api/challenges/${created.id}/leave`, {}, ta)
  ok((await api('POST', `/api/challenges/${created.id}/leave`, {}, ta)).status === 400, '发起人不能用“退出”，只能关闭')

  // 模拟旧版数据：把 shareWith 塞回任务文件，重启后应自动转成挑战
  await api('DELETE', `/api/challenges/${created.id}`, null, ta)
  const tasksFile = path.join(DATA, 'tasks.json')
  const raw = JSON.parse(fs.readFileSync(tasksFile, 'utf8'))
  const ids = JSON.parse(fs.readFileSync(path.join(DATA, 'users.json'), 'utf8')).map((u) => u.id)
  raw[0].shareWith = [ids[1]]
  fs.writeFileSync(tasksFile, JSON.stringify(raw), 'utf8')
  await stop(s.child)
  s = await startServer()
  const migrated = (await api('GET', '/api/challenges', null, ta)).json
  ok(migrated.length === 1 && migrated[0].members.length === 2, `旧共享已转成挑战（成员 ${migrated.length ? migrated[0].members.length : 0} 人）`)
  ok(migrated[0].members[1] === ids[1] || migrated[0].pending.length === 0, '被共享过的人当作已接受的成员')
  ok(!JSON.parse(fs.readFileSync(tasksFile, 'utf8'))[0].shareWith, '任务里的 shareWith 字段已清掉')
  ok(s.lines.join('').includes('migrate') || s.lines.join('').includes('转成'), '日志里说明了做过迁移')

  await stop(s.child)
  fs.rmSync(DATA, { recursive: true, force: true })
  console.log(`\n通过 ${passed} 项，失败 ${failed} 项`)
  process.exit(failed ? 1 : 0)
})().catch((e) => {
  console.error('测试异常：', e.message)
  process.exit(1)
})
