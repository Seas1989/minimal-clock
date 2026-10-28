/* ---------- lib/http.js：请求 / 响应与静态文件 ----------
 * 只做"跟 HTTP 打交道"这一件事：发 JSON、读请求体、把 public/ 里的文件吐出去。
 * 业务判断一律不在这里，方便单独看懂安全边界（体积上限、目录穿越防护）。
 */
const fs = require('fs')
const path = require('path')

const PUBLIC_DIR = process.env.PUBLIC_DIR || path.join(__dirname, '..', 'public')

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
}

function sendJSON(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  })
  res.end(JSON.stringify(data))
}

/* 请求体读成对象：超过 1 MB 直接断掉，坏 JSON 报 invalid JSON（由 api 层转成 400） */
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

// 查询串：路由里到处要读 ?q=&limit=，统一在这里造，免得各模块重复拼 URL
const query = (req) => new URL(req.url, `http://${req.headers.host}`).searchParams

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

module.exports = { PUBLIC_DIR, MIME, sendJSON, readBody, query, serveStatic }
