/* ---------- lib/api.js：/api/* 的分发 ----------
 * 只做两件事：把路径第二段认成"哪个域"，以及"这条要不要登录"。
 * 具体接口逻辑都在 lib/routes/ 下按域一个文件，加接口不必再动这里。
 *
 * 鉴权门槛照旧：只有注册 / 登录 / me / time 四条可以匿名访问（me 自己判断 token 是否有效），
 * 其余一律先拿到 user 再进 handler —— 音乐代理那几条尤其要挡，否则这台机器就成了公开代理。
 */
const { getUser } = require('./auth')
const { sendJSON } = require('./http')
const account = require('./routes/account')
const friends = require('./routes/friends')
const tasks = require('./routes/tasks')
const challenge = require('./routes/challenge')
const music = require('./routes/music')
const netease = require('./routes/netease')
const qq = require('./routes/qq')

/* 用 Map 而不是普通对象：路径是用户可控的，`{}` 查表会被 `/api/constructor`、
 * `/api/__proto__` 这类路径命中原型上的东西，拿到一个根本不是 handler 的值再调一下。
 *
 * 不需要登录态的四条（account 里会自己按 seg[1] 分辨，并对 me 单独校验 token） */
const PUBLIC = new Map([
  ['register', account],
  ['login', account],
  ['me', account],
  ['time', account],
])

// 其余都要先有 user
const PRIVATE = new Map([
  ['friends', friends],
  ['tasks', tasks],
  ['challenges', challenge],
  ['music', music],
  ['netease', netease],
  ['qq', qq],
])

async function handleAPI(req, res, pathname) {
  const seg = pathname.split('/').filter(Boolean)
  const route = seg[1] // time | register | tasks | friends | challenges | music | netease | qq

  const pub = PUBLIC.get(route)
  if (pub) return pub(req, res, seg)

  const handler = PRIVATE.get(route)
  if (!handler) return sendJSON(res, 404, { error: 'not found' })

  const user = getUser(req)
  if (!user) return sendJSON(res, 401, { error: '请先登录' })

  return handler(req, res, seg, user)
}

module.exports = { handleAPI }
