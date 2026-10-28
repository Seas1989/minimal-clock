/* ---------- lib/routes/account.js：注册 / 登录 / 我是谁 / 服务器时间 ----------
 * 这四条是仅有的不需要登录态的接口（time 用来校准前端时钟，me 用来验证本地 token 还有效）。
 */
const crypto = require('crypto')
const { loadUsers, saveUsers, genId } = require('../db')
const { hashPassword, makeToken, getUser } = require('../auth')
const { sendJSON, readBody } = require('../http')

module.exports = async function accountRoute(req, res, seg) {
  /* ----- 用户：注册 / 登录 / 当前用户 ----- */

  if (req.method === 'POST' && seg[1] === 'register') {
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
    saveUsers()
    return sendJSON(res, 200, { token: user.token, username: user.username })
  }

  if (req.method === 'POST' && seg[1] === 'login') {
    const body = await readBody(req)
    const username = String(body.username || '').trim()
    const password = String(body.password || '')
    const users = loadUsers()
    const user = users.find((u) => u.username === username)
    if (!user || hashPassword(password, user.salt) !== user.hash) {
      return sendJSON(res, 401, { error: '用户名或密码错误' })
    }
    user.token = makeToken() // 登录刷新 token
    saveUsers()
    return sendJSON(res, 200, { token: user.token, username: user.username })
  }

  if (req.method === 'GET' && seg[1] === 'me') {
    const user = getUser(req)
    if (!user) return sendJSON(res, 401, { error: '未登录' })
    return sendJSON(res, 200, { username: user.username })
  }

  /* ----- 时间（无需登录）----- */

  if (req.method === 'GET' && seg[1] === 'time') {
    return sendJSON(res, 200, { now: Date.now() })
  }

  return sendJSON(res, 404, { error: 'not found' })
}
