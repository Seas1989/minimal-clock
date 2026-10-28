/* ---------- lib/routes/tasks.js：任务本体 ----------
 * 任务只归 owner 所有；同任务挑战另走 /api/challenges，这里不再把别人的任务对象搬过来。
 * 计时状态存在任务记录上（elapsedBase + startedAt），前端按服务器时间推当前值，
 * 所以换设备、刷新页面都不会把正在跑的计时打断。
 */
const { CYCLE } = require('../challenges')
const { loadTasks, saveTasks, genId } = require('../db')
const { sendJSON, readBody } = require('../http')

module.exports = async function tasksRoute(req, res, seg, user) {
  const tasks = loadTasks()
  const myTasks = tasks.filter((t) => t.owner === user.id)

  // GET /api/tasks —— 只看自己的任务
  if (req.method === 'GET' && seg.length === 2) {
    return sendJSON(res, 200, myTasks)
  }

  // POST /api/tasks —— 新建任务
  if (req.method === 'POST' && seg.length === 2) {
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
    saveTasks()
    return sendJSON(res, 200, task)
  }

  // POST /api/tasks/:id/action
  if (req.method === 'POST' && seg[3] === 'action') {
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

    saveTasks()
    return sendJSON(res, 200, task)
  }

  // DELETE /api/tasks/:id
  if (req.method === 'DELETE' && seg.length === 3) {
    const idx = tasks.findIndex((t) => t.id === seg[2] && t.owner === user.id)
    if (idx === -1) return sendJSON(res, 404, { error: '任务不存在' })
    // 挑掉任务后不动挑战：成员身份与历史进度还要参与排行，前端会显示成“未绑定任务”
    tasks.splice(idx, 1)
    saveTasks()
    return sendJSON(res, 200, { ok: true })
  }

  // POST /api/tasks/:id/window  { open: true|false } —— 记录这个任务的计时窗口是否挂在主界面窗口坞上
  if (req.method === 'POST' && seg[3] === 'window') {
    const body = await readBody(req)
    const task = tasks.find((t) => t.id === seg[2] && t.owner === user.id)
    if (!task) return sendJSON(res, 404, { error: '任务不存在' })
    task.window = !!body.open
    saveTasks()
    return sendJSON(res, 200, task)
  }

  return sendJSON(res, 404, { error: 'not found' })
}
