/* ---------- lib/auth.js：密码散列与 token ----------
 * 只三件事：把密码变成 scrypt 散列、发一个随机 token、按请求头 x-token 找回用户。
 * token 直接存在用户记录上（单机会话，够用），登录时会重新生成，
 * 所以旧 token 立刻失效 —— 前端把新 token 写回 localStorage 就行。
 */
const crypto = require('crypto')
const { loadUsers } = require('./db')

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

module.exports = { hashPassword, makeToken, getUser }
