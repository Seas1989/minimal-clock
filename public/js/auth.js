/* ---------- 登录 / 注册 ---------- */

import { $, focusId, mode, setChallenges, setFriends, setSelectedId, setTasks, setToken, token } from './state.js'
import { refresh } from './task-actions.js'
import { loadFriends } from './friends.js'
import { loadChallenges } from './challenges.js'
import { tickDisplay } from './display.js'
import { exitFocus } from './focus.js'
import { rest, setRest } from './rest.js'
import { loadMusicCfg, musicStop, restoreQueue, setMusicCfg } from './music.js'
import { closeMusic } from './music-modal.js'
import { setMode } from './tabs.js'
import { goView, syncDrawer } from './mobile-shell.js'
import { applyLayout } from './panel-drag.js'
import { syncTime } from './heartbeat.js'

let authMode = 'login'

export function showView(loggedIn) {
  $('auth-view').classList.toggle('hidden', loggedIn)
  $('app-view').classList.toggle('hidden', !loggedIn)
  $('user-box').classList.toggle('hidden', !loggedIn)
  // 登录页没有板块可导航，顶栏那个汉堡也就用不上；退出时把手机从“好友”那一页接回时钟
  $('btn-menu').classList.toggle('hidden', !loggedIn)
  if (!loggedIn) goView('display')
  syncDrawer()
}

function setAuthMode(m) {
  authMode = m
  document.querySelectorAll('#auth-tabs .tab').forEach((x) => x.classList.toggle('active', x.dataset.auth === m))
  $('btn-auth').textContent = m === 'login' ? '登录' : '注册'
  $('auth-msg').textContent = ''
}

async function doAuth() {
  const username = $('auth-user').value.trim()
  const password = $('auth-pass').value
  if (!username || !password) return setAuthMsg('请输入用户名和密码')
  try {
    const data = await fetch(`/api/${authMode}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    }).then((r) => r.json().then((j) => ({ ok: r.ok, j })))
    if (!data.ok) return setAuthMsg(data.j.error || '操作失败')
    setToken(data.j.token)
    localStorage.setItem('token', token)
    $('auth-pass').value = ''
    enterApp(data.j.username)
  } catch (e) {
    setAuthMsg('网络错误：' + e.message)
  }
}

function setAuthMsg(msg) { $('auth-msg').textContent = msg }

export function logout() {
  setToken(null)
  localStorage.removeItem('token')
  setTasks([])
  setFriends({ friends: [], incoming: [], outgoing: [] })
  setChallenges([])
  setSelectedId(null)
  // 退出登录只收起休息层：走 endRest 会顺手替用户 resume，可 token 已经没了
  if (rest) { setRest(null); $('rest').classList.add('hidden') }
  musicStop()
  setMusicCfg(null)
  closeMusic()
  if (focusId) exitFocus()
  showView(false)
}

export async function enterApp(username) {
  showView(true)
  $('user-name').textContent = username || ''
  syncDrawer() // 抽屉里要带上刚拿到的用户名（showView 里那一次调得比这里早）
  setMode(mode, false)
  applyLayout() // 可见后重排一次，保证拖拽限位基于真实尺寸
  await syncTime()
  await Promise.all([refresh(), loadFriends(), loadChallenges()])
  loadMusicCfg() // 音乐配置不阻塞进入：拉不到只是休息时没声，不该把主界面卡住
  restoreQueue()  // 上次听的列表接回来（只接列表，不替用户自动出声）
  tickDisplay()
}

/* 顶层接线：DOM 事件与初始渲染。原来直接摊在 app.js 顶层，
 * 拆成模块后放进 init()，由 main.js 按原文件顺序调用，避免模块求值顺序影响这些副作用。 */
export function init() {
  document.querySelectorAll('#auth-tabs .tab').forEach((tab) => {
    tab.onclick = () => setAuthMode(tab.dataset.auth)
  })

  $('btn-auth').onclick = doAuth

  $('auth-pass').addEventListener('keydown', (e) => { if (e.key === 'Enter') doAuth() })

  $('btn-logout').onclick = logout

}
