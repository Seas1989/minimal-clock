/* ---------- server.js：服务入口 ----------
 * 这里只负责"起服务"这一件事：读环境变量、把 /api/* 交给 lib/api.js 分发、
 * 其余路径交给静态文件、启动自检、优雅退出。
 *
 * 往下找：
 *   lib/api.js            /api/* 的分发与"这条要不要登录"
 *   lib/routes/*.js       按域一个文件（账户 / 好友 / 任务 / 挑战 / 音乐配置 / 网易云 / QQ）
 *   lib/db.js             数据访问层（五个 JSON Store + 好友关系 + 音乐配置行）
 *   lib/http.js           收发型工具（sendJSON / readBody / 静态文件）
 *   lib/auth.js           密码散列与 token
 *   lib/music/*.js        上游音乐平台的适配层（解析 + 网络）
 *
 * PORT / DATA_DIR 都可用环境变量覆盖，测试就是靠这两个变量把服务拉到临时目录里跑。
 */
const http = require('http')
const db = require('./lib/db')
const { handleAPI } = require('./lib/api')
const { serveStatic, sendJSON } = require('./lib/http')

const PORT = process.env.PORT || 3000

const server = http.createServer((req, res) => {
  const { pathname } = new URL(req.url, `http://${req.headers.host}`)
  if (pathname.startsWith('/api/')) {
    // 路由里任何抛错（坏 JSON、请求体过大）都归到 400：那是调用方的问题，不是服务崩了
    handleAPI(req, res, pathname).catch((e) => {
      if (res.headersSent) return res.end()
      sendJSON(res, 400, { error: e.message })
    })
  } else {
    serveStatic(req, res, pathname)
  }
})

server.listen(PORT, () => {
  db.selfCheck()
  console.log(`⏳ 时钟已启动：http://localhost:${PORT}`)
  console.log(`   数据目录：${db.DATA_DIR}`)
})

// 所有写盘都是同步完成的，退出时只需保证不留 .tmp 干扰下次启动
function shutdown() {
  db.cleanTmpFiles()
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(0), 1500).unref()
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
