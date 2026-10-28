/* ---------- 手机端外壳：整屏一页一个事（Alpine 绑状态，CDN 不通时退回原生绑定） ---------- */

import { $ } from './state.js'
import { logout } from './auth.js'
import { refresh } from './task-actions.js'
import { loadFriends } from './friends.js'
import { loadChallenges } from './challenges.js'
import { tickDisplay } from './display.js'
import { audioEl, queue, toggleListen } from './music.js'

/* 分工：Alpine 只管 view / drawer 两个状态，靠 :data-view / :data-drawer 刷到 body 上；
 * 页面长什么样全在 mobile.css 里由 body[data-view="…"] 决定。状态真源存在下面的普通变量里，
 * Alpine 只是它的绑定镜像 —— 所以 jsdelivr 不通时（离线 / 被墙）这些入口会退回原生 click，
 * 形态与功能都不缺，只少了抽屉里当前页的高亮 */
const VIEWS = { display: '时钟', tasks: '任务列表', friends: '好友', challenges: '同任务挑战' }
const mqMobile = window.matchMedia('(max-width: 760px)')
let mobView = localStorage.getItem('mView')
export let mobDrawer = false
let shellRef = null        // Alpine 组件 init 时把自己交出来
let drawerHistory = false  // 抽屉是为「返回键先收抽屉」才垫进历史栈的那一条

export const isMobile = () => mqMobile.matches

/* 切页的副作用：这页的数据立刻取一次，不等 5 秒轮询 —— 手机上不整页滚，
 * 停在过期画面上用户会以为“没内容” */
function applyView(v, persist = true) {
  mobView = VIEWS[v] ? v : 'display'
  if (persist) localStorage.setItem('mView', mobView)
  if (!shellRef) document.body.dataset.view = mobView   // Alpine 在时由 :data-view 写，两处写的是同一个属性
  if (!isMobile()) return
  if (mobView === 'tasks') void refresh()
  else if (mobView === 'friends') void loadFriends()
  else if (mobView === 'challenges') void loadChallenges()
  else tickDisplay()
}

export function setDrawer(on) {
  mobDrawer = !!on
  // 开抽屉时往历史栈垫一条，关抽屉时把它弹掉：安卓返回键 / iOS 右滑先收抽屉，而不是直接退出站点
  if (mobDrawer && !drawerHistory) { drawerHistory = true; history.pushState({ drawer: 1 }, '') }
  else if (!mobDrawer && drawerHistory) { drawerHistory = false; history.back() }
  if (shellRef) shellRef.drawer = mobDrawer
  else if (mobDrawer) document.body.dataset.drawer = 'open'
  else delete document.body.dataset.drawer
}

export function goView(v) {
  setDrawer(false)
  if (shellRef) shellRef.view = VIEWS[v] ? v : 'display'
  applyView(v)
}

/* 抽屉里的弹层入口直接 .click() 顶栏按钮：打开音乐要拉配置、打开背景要算预览尺寸，
 * 与其重写给一遍不如复用。按钮只是 display:none，照样能触发 */
function openSheet(k) {
  const b = $('btn-' + k)
  if (b) b.click()
}

/* 抽屉里的听歌按钮与退出项要跟着实际状态走，不然“开始听歌”按下去是暂停 */
export function syncDrawer() {
  const icon = $('drawer-listen-icon')
  const text = $('drawer-listen-text')
  if (icon) {
    const playing = !!queue && !audioEl().paused
    icon.textContent = playing ? '⏸' : '▶'
    text.textContent = queue ? (playing ? '暂停听歌' : '继续听歌') : '开始听歌'
  }
  const who = $('drawer-user-text')
  if (who) who.textContent = $('user-name').textContent ? `退出（${$('user-name').textContent}）` : '退出登录'
}

function syncMobile() {
  document.body.classList.toggle('mobile', isMobile())
  if (isMobile()) applyView(mobView, false)
  else setDrawer(false)   // 窗口拖宽了，抽屉这种形态就没意义了
}
/* CDN 不通时的退路：同一批 data-* 入口上原生 click。
 * handler 里先查 shellRef：Alpine 的 init 可能比这个 DOMContentLoaded 晚上一个占，
 * 两套都跑的话「听歌」会被连点两下——刚好开始又立即暂停 */
function bindShellFallback() {
  const once = (fn) => (...a) => { if (shellRef) return; fn(...a) }
  const menu = $('btn-menu')
  if (menu) menu.onclick = once(() => setDrawer(!mobDrawer))
  const close = $('btn-drawer-close')
  if (close) close.onclick = once(() => setDrawer(false))
  const brand = $('brand')
  if (brand) brand.onclick = once(() => goView('display'))
  document.querySelectorAll('#drawer [data-goto]').forEach((b) => { b.onclick = once(() => goView(b.dataset.goto)) })
  document.querySelectorAll('#drawer [data-sheet]').forEach((b) => { b.onclick = once(() => { setDrawer(false); openSheet(b.dataset.sheet) }) })
  document.querySelectorAll('#drawer [data-act]').forEach((b) => {
    b.onclick = once(() => {
      setDrawer(false)
      if (b.dataset.act === 'listen') void toggleListen()
      else if (b.dataset.act === 'logout') logout()
    })
  })
}

/* 顶层接线：DOM 事件与初始渲染。原来直接摊在 app.js 顶层，
 * 拆成模块后放进 init()，由 main.js 按原文件顺序调用，避免模块求值顺序影响这些副作用。 */
export function init() {
  if (!VIEWS[mobView]) mobView = 'display'   // 旧存档里可能是 tasks 之类不认识的值

  /* Alpine 组件：x-data="shell()"，方法里只做状态切换，具体副作用全部交给上面那批函数 */
  window.shell = function () {
    return {
      view: mobView,
      drawer: false,
      get headTitle() { return this.view === 'display' ? '时钟' : '← ' + (VIEWS[this.view] || '') },
      init() { shellRef = this; syncMobile() },
      go(v) { goView(v) },
      toggleDrawer() { setDrawer(!mobDrawer) },
      closeDrawer() { setDrawer(false) },
      sheet(k) { setDrawer(false); openSheet(k) },
      listenToggle() { setDrawer(false); void toggleListen() },
      leave() { setDrawer(false); logout() },
    }
  }

  window.addEventListener('popstate', () => {
    if (!drawerHistory) return   // 不是我们垫的那一条，不抢浏览器自己的后退
    drawerHistory = false
    mobDrawer = false
    if (shellRef) shellRef.drawer = false
    else delete document.body.dataset.drawer
  })

  /* 转屏 / 分屏 / 拖窗口都会改到这条断点，形态得跟着切。
   * iOS Safari 13 及以前只有旧的 addListener，不给它兜一层的话，横竖屏一切就卡在旧形态 */
  if (mqMobile.addEventListener) mqMobile.addEventListener('change', syncMobile)

  else if (mqMobile.addListener) mqMobile.addListener(syncMobile)

  syncMobile()

  applyView(mobView, false)

  document.addEventListener('DOMContentLoaded', () => { if (!shellRef) bindShellFallback() })

}
