/* ---------- test/store.test.js：账号存储的端到端冒烟测试 ----------
 * 跑法：node test/store.test.js（或 npm test）
 * 覆盖四件真正会让人丢账号的事：
 *   1. 服务重启后，用户名 / 密码 / token 仍然可用
 *   2. 并发注册不会互相覆盖（旧的“各自读文件再整体写回”写法会丢）
 *   3. users.json 被写坏时，能从 .bak 自动恢复，坏文件留档而不是被清空
 *   4. 落盘是原子改名，磁盘上不会留下半截主文件
 * 全程用临时 DATA_DIR，不碰 data/ 里的真实数据。
 */
const { spawn } = require('child_process')
const http = require('http')
const fs = require('fs')
const os = require('os')
const path = require('path')

const PORT = 3711
const DATA = path.join(os.tmpdir(), `clock-store-test-${process.pid}`)
const SERVER = path.join(__dirname, '..', 'server.js')
const NAME = '测试账号'
const PASS = 'test-pass-1234'

let passed = 0
let failed = 0
function ok(cond, label) {
  if (cond) {
    passed++
    console.log(`  OK   ${label}`)
  } else {
    failed++
    console.log(`  FAIL ${label}`)
  }
}

function api(method, p, body, token) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port: PORT, path: p, method, headers: { 'Content-Type': 'application/json', ...(token ? { 'x-token': token } : {}) } },
      (res) => {
        let raw = ''
        res.on('data', (c) => (raw += c))
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, json: JSON.parse(raw || '{}') })
          } catch {
            resolve({ status: res.statusCode, json: null })
          }
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
    const onData = (buf) => {
      const s = String(buf)
      lines.push(s)
      if (s.includes('时钟已启动')) resolve({ child, lines })
    }
    child.stdout.on('data', onData)
    child.stderr.on('data', onData)
    setTimeout(() => reject(new Error('启动超时：' + lines.join(''))), 8000).unref()
  })
}

const stop = (c) => new Promise((res) => { c.on('exit', res); c.kill() })
const usersFile = path.join(DATA, 'users.json')

;(async () => {
  fs.rmSync(DATA, { recursive: true, force: true })

  console.log('1) 首次启动 + 注册')
  let s = await startServer()
  let r = await api('POST', '/api/register', { username: NAME, password: PASS })
  ok(r.status === 200 && r.json.token, '注册返回 token')
  const token = r.json.token
  await stop(s.child)

  console.log('2) 重启后账号仍在')
  s = await startServer()
  let me = await api('GET', '/api/me', null, token)
  ok(me.status === 200 && me.json && me.json.username === NAME, '注册时发下的 token 重启后依然有效（浏览器免登录）')
  r = await api('POST', '/api/login', { username: NAME, password: PASS })
  ok(r.status === 200, '重启后能用原密码登录')
  ok(r.json.token && r.json.token !== token, '登录会换发新 token')
  me = await api('GET', '/api/me', null, r.json.token)
  ok(me.json && me.json.username === NAME, '新 token 可取回用户名')

  console.log('3) 并发注册不互相覆盖')
  const names = Array.from({ length: 8 }, (_, i) => `同伴${i}`)
  const rs = await Promise.all(names.map((n) => api('POST', '/api/register', { username: n, password: PASS })))
  ok(rs.every((x) => x.status === 200), '8 个并发注册全部成功')
  await stop(s.child)
  const saved = JSON.parse(fs.readFileSync(usersFile, 'utf8'))
  ok(names.every((n) => saved.some((u) => u.username === n)), `磁盘上 8 个账号都在（实际 ${saved.length} 条，含首个）`)

  console.log('4) 主文件被写坏时自动回滚到备份')
  // .bak 是“上一次替换前的主文件”，所以恢复目标就是它的条数
  const bakCount = JSON.parse(fs.readFileSync(usersFile + '.bak', 'utf8')).length
  fs.writeFileSync(usersFile, '[{"id":"x","username":"半', 'utf8') // 模拟写到一半断电
  s = await startServer()
  r = await api('POST', '/api/login', { username: NAME, password: PASS })
  ok(r.status === 200, '损坏后仍能登录（已从 .bak 恢复）')
  ok(s.lines.join('').includes('恢复'), '日志里明说了做过恢复')
  const bad = fs.readdirSync(DATA).filter((f) => f.startsWith('users.json.bad-'))
  ok(bad.length === 1, '坏文件被留档而不是删除')
  ok(fs.readFileSync(path.join(DATA, bad[0]), 'utf8').includes('半'), '留档内容就是那段残缺字节，人工还能捞')
  await stop(s.child)
  const after = JSON.parse(fs.readFileSync(usersFile, 'utf8'))
  ok(after.length === bakCount, `恢复到最近一次备份（${after.length} 条，期望 ${bakCount}）`)
  ok(after.length >= 8 && after.some((u) => u.username === NAME), '没有把数据静默清空')

  console.log('5) 目录里没有半截主文件残留')
  ok(!fs.readdirSync(DATA).some((f) => f.endsWith('.tmp')), '无 .tmp 残留')

  fs.rmSync(DATA, { recursive: true, force: true })
  console.log(`\n通过 ${passed} 项，失败 ${failed} 项`)
  process.exit(failed ? 1 : 0)
})().catch((e) => {
  console.error('测试异常：', e.message)
  process.exit(1)
})
