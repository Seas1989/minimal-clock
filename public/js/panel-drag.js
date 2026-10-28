/* ---------- 物理驱动：所有面板共用一条 rAF 心跳 ---------- */

import { $ } from './state.js'
import { confirmAction, toast } from './ui.js'
import { clamp } from './background.js'
import { isMobile } from './mobile-shell.js'
import { DEFAULT_LAYOUT, layout, panelEl, saveLayout, setLayout } from './layout.js'

/* 弹簧与心跳来自 public/physics.js：那个是无模块的经典脚本，在 index.html 里排在
 * type=module 前面同步执行，所以模块求值时 window.Phys 一定已经就位。
 * 这几样是下面各个函数共用的，必须放在模块顶层 —— 塞进 init() 里就成了 init 的局部量，
 * physOf / startDrag 这些函数根本看不见它们 */
const { Spring, Spring2, Ticker, Tracker, rubber } = window.Phys

const bodyPhys = new Map() // card -> { p 位移弹簧, sq 形变弹簧, rot 倾角弹簧 }
function physOf(card) {
  let b = bodyPhys.get(card)
  if (!b) {
    b = {
      // 让位弹簧：偏软带一点过冲，被挤开时会晃一下再停，而不是匀速滑过去
      p: new Spring2(0, 0, { stiffness: 260, damping: 21 }),
      // 缩放弹簧量纲是 1.0，静止阈值必须收到千分级，否则末尾“弹回原尺寸”会被当成误差直接跳掉
      sq: new Spring2(1, 1, { stiffness: 210, damping: 15, epsilon: 0.0004 }),
      rot: new Spring(0, { stiffness: 200, damping: 13, epsilon: 0.01 }),
    }
    bodyPhys.set(card, b)
  }
  return b
}

function physicsTick(dt) {
  let busy = false
  bodyPhys.forEach((b, card) => {
    if (card.classList.contains('dragging')) return // 拖起的那张由 dragTick 接管
    let moving = false
    ;[b.p.x, b.p.y, b.sq.x, b.sq.y, b.rot].forEach((s) => { if (!s.step(dt)) moving = true })
    if (!moving) {
      if (card.style.transform) { card.style.transform = ''; card.style.transformOrigin = '' }
      return
    }
    busy = true
    card.style.transformOrigin = 'center'
    card.style.transform = `translate3d(${b.p.x.value}px, ${b.p.y.value}px, 0) scale(${b.sq.x.value}, ${b.sq.y.value}) rotate(${b.rot.value}deg)`
  })
  return busy
}

// 布局跳变：把旧位置当作“相对新静置位的偏移”交给弹簧回拉 —— 面板是被撞开的，有动量
function flip(mutate) {
  const cards = [...document.querySelectorAll('#app-view .card')]
  if ($('app-view').classList.contains('hidden')) { mutate(); return }
  const first = new Map(cards.map((c) => [c, c.getBoundingClientRect()]))
  mutate()
  void document.body.offsetHeight // 强制回流，否则新旧 rect 在同一帧内拿不到重排结果
  let touched = false
  cards.forEach((c) => {
    if (c.classList.contains('dragging')) return
    const f = first.get(c)
    const l = c.getBoundingClientRect()
    const dx = f.left - l.left, dy = f.top - l.top
    const resized = l.width > 1 && (Math.abs(f.width - l.width) > 1 || Math.abs(f.height - l.height) > 1)
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5 && !resized) return
    const b = physOf(c)
    b.p.shift(dx, dy) // 保留原有速度：连续挤压会累积动量，越挤越“撞”
    if (resized) {
      b.sq.x.value = f.width / l.width
      b.sq.y.value = f.height / l.height
      b.sq.x.target = b.sq.y.target = 1
    }
    touched = true
  })
  if (touched) Ticker.add(physicsTick)
}

export function applyLayout() {
  const main = $('app-view')
  main.classList.toggle('stack', layout.mode === 'stack')
  main.classList.toggle('left', layout.mode === 'left')
  document.documentElement.style.setProperty('--side-w', `${layout.sideW}px`)
  flip(() => {
    layout.a.forEach((p) => $('col-a').appendChild(panelEl(p)))
    layout.b.forEach((p) => $('col-b').appendChild(panelEl(p)))
  })
  document.querySelectorAll('#layout-preset-group button').forEach((b) => b.classList.toggle('active', b.dataset.preset === layout.mode))
}

function readLayout() {
  layout.a = [...$('col-a').querySelectorAll('.card')].map((c) => c.dataset.panel)
  layout.b = [...$('col-b').querySelectorAll('.card')].map((c) => c.dataset.panel)
}

// 撕纸边缘：多边形随机台阶，amp 控制“毛边”幅度（落位时逐帧衰减到接近整齐）
function tornPath(amp = 1.4) {
  const pts = []
  const N = 16
  const jit = () => Number((Math.random() * amp).toFixed(2))
  for (let i = 0; i <= N; i++) pts.push(`${((i / N) * 100).toFixed(1)}% ${i % 2 ? jit() : 0}%`)
  for (let i = 1; i <= N; i++) pts.push(`${i % 2 ? (100 - jit()).toFixed(2) : 100}% ${((i / N) * 100).toFixed(1)}%`)
  for (let i = N - 1; i >= 0; i--) pts.push(`${((i / N) * 100).toFixed(1)}% ${i % 2 ? (100 - jit()).toFixed(2) : 100}%`)
  for (let i = N - 1; i >= 1; i--) pts.push(`${i % 2 ? jit() : 0}% ${((i / N) * 100).toFixed(1)}%`)
  return `polygon(${pts.join(', ')})`
}

let drag = null
const ghost = document.createElement('div')
// 手机上 CSS 会强制转单栏（两栏整宽上下叠），命中判断必须跟着换轴，否则永远只能拖回第一栏
const mqNarrow = window.matchMedia('(max-width: 760px)')

function insertGhost(x, y) {
  const cols = [$('col-a'), $('col-b')]
  const stacked = $('app-view').classList.contains('stack') || mqNarrow.matches
  const rects = cols.map((c) => ({ c, r: c.getBoundingClientRect() }))
  // 单栏看 y、双栏看 x：另一种坐标在两栏里是重合的，拿它判断会一直命中第一栏
  let hit = rects.find(({ r }) => (stacked
    ? y >= r.top - 40 && y <= r.bottom + 40
    : x >= r.left - 14 && x <= r.right + 14))
  if (!hit) {
    // 拖到两栏夹缝或栏外留白：取中心最近的一栏
    hit = rects
      .map((o) => ({ c: o.c, d: Math.hypot((o.r.left + o.r.right) / 2 - x, (o.r.top + o.r.bottom) / 2 - y) }))
      .sort((p, q) => p.d - q.d)[0]
  }
  const col = hit.c
  cols.forEach((c) => c.classList.toggle('dropping', c === col)) // 亮出“要落到这一栏”
  const items = [...col.querySelectorAll('.card')].filter((it) => it !== drag.card)
  let node = null
  for (const it of items) {
    const r = it.getBoundingClientRect()
    if (y < r.top + r.height / 2) { node = it; break }
  }
  if (ghost.parentNode === col && ghost.nextElementSibling === node) return
  flip(() => col.insertBefore(ghost, node))
}

// 面板归属列（拖拽被打断时用来把卡片接回家）
function homeOf(card) {
  const p = card.dataset.panel
  if (layout.b.includes(p) && !layout.a.includes(p)) return $('col-b')
  return $('col-a')
}

function startDrag(card, e) {
  const r = card.getBoundingClientRect()
  const b = physOf(card)
  b.p.snap(0, 0)
  b.sq.snap(1, 1)
  b.rot.snap(0) // 归零让位偏移，避免与拖拽变换叠加
  drag = {
    card,
    w: r.width,
    h: r.height,
    ox: r.left,
    oy: r.top,
    sx: e.clientX,
    sy: e.clientY,
    follow: new Spring2(0, 0, { stiffness: 1050, damping: 48 }), // 很硬：几乎跟手，只留一点质量滞后
    sq: new Spring2(1, 1, { stiffness: 300, damping: 13, epsilon: 0.0004 }),
    rot: new Spring(0, { stiffness: 240, damping: 11, epsilon: 0.01 }),
    tracker: new Tracker(),
    tornAt: 0,
  }
  ghost.style.height = `${r.height}px`
  card.parentNode.insertBefore(ghost, card)
  document.body.appendChild(card) // 移到 body，避免祖先 transform 影响 fixed 定位
  card.classList.add('dragging', 'torn')
  card.style.clipPath = tornPath()
  card.style.width = `${r.width}px`
  card.style.height = `${r.height}px`
  card.style.left = `${r.left}px`
  card.style.top = `${r.top}px`
  drag.tracker.reset(e.clientX, e.clientY)
  moveDrag(e)
  Ticker.add(dragTick)
}

function moveDrag(e) {
  if (!drag) return
  const d = drag
  d.tracker.push(e.clientX, e.clientY)
  const area = $('app-view').getBoundingClientRect()
  let tx = e.clientX - d.sx
  let ty = e.clientY - d.sy
  // 橡皮筋：卡片中心拖出可视区后越拉越沉，能拽出去一点但不会脱缰，也不会硬停在边界
  const minTx = area.left + d.w * 0.4 - d.ox
  const maxTx = area.right - d.w * 0.4 - d.ox
  const minTy = area.top + d.h * 0.35 - d.oy
  const maxTy = area.bottom - d.h * 0.35 - d.oy
  if (tx < minTx) tx = minTx + rubber(tx - minTx, area.width * 0.6)
  else if (tx > maxTx) tx = maxTx + rubber(tx - maxTx, area.width * 0.6)
  if (ty < minTy) ty = minTy + rubber(ty - minTy, area.height * 0.6)
  else if (ty > maxTy) ty = maxTy + rubber(ty - maxTy, area.height * 0.6)
  d.follow.set(tx, ty)
  Ticker.add(dragTick) // 手停一会儿后心跳会停摆，新的移动必须重新叫醒它
  insertGhost(e.clientX, e.clientY)
}

function dragTick(dt) {
  if (!drag) return false
  const d = drag
  let moving = false
  ;[d.follow.x, d.follow.y, d.sq.x, d.sq.y, d.rot].forEach((s) => { if (!s.step(dt)) moving = true })
  // 形变与倾角取“手的即时速度”而不是弹簧速度：弹簧有滞后，跟手的那一下形变才够直接
  const pvx = d.tracker.vx
  const pvy = d.tracker.vy
  d.sq.x.target = clamp(1 + Math.abs(pvy) * 0.00003, 1, 1.06)
  d.sq.y.target = clamp(1 + Math.abs(pvx) * 0.00003, 1, 1.06)
  d.rot.target = clamp(pvx * 0.0013, -3.2, 3.2)
  const skew = clamp(pvx * 0.0026, -6, 6)
  d.card.style.transform = `translate3d(${d.follow.x.value}px, ${d.follow.y.value}px, 0) skewX(${skew}deg) scale(${d.sq.x.value}, ${d.sq.y.value}) rotate(${d.rot.value}deg)`
  const now = performance.now()
  if (now - d.tornAt > 90) {
    d.tornAt = now
    d.card.style.clipPath = tornPath(clamp(0.5 + Math.hypot(pvx, pvy) * 0.0004, 0.5, 2.2)) // 毛边幅度随速度涨
  }
  return moving
}

// 毛边逐帧收敛后再恢复圆角，避免“啪”一下弹齐
function settleTorn(card) {
  card.style.clipPath = tornPath(0.8)
  setTimeout(() => {
    card.style.clipPath = tornPath(0.3)
    setTimeout(() => {
      card.style.clipPath = ''
      card.classList.remove('torn')
    }, 110)
  }, 110)
}

function endDrag() {
  if (!drag) return
  const d = drag
  drag = null
  Ticker.remove(dragTick)
  const card = d.card
  const others = [...document.querySelectorAll('#app-view .card')]
  const before = new Map(others.map((c) => [c, c.getBoundingClientRect()]))
  const from = card.getBoundingClientRect() // 浮起中的屏幕位置（含 transform）
  const parent = ghost.parentNode || homeOf(card)
  const ref = ghost.parentNode === parent ? ghost : null
  // 无条件先清掉“浮起”状态：宁可少一段动画，也不能留下卡在 body 上带 fixed 定位的面板
  card.classList.remove('dragging')
  card.style.width = card.style.height = card.style.left = card.style.top = ''
  card.style.transform = ''
  parent.insertBefore(card, ref)
  if (ghost.parentNode) ghost.remove()
  document.querySelectorAll('.col.dropping').forEach((c) => c.classList.remove('dropping'))
  void document.body.offsetHeight
  try {
    const to = card.getBoundingClientRect()
    const b = physOf(card)
    b.p.snap(from.left - to.left, from.top - to.top) // 从当前视觉位置继续，不跳位
    b.p.set(0, 0)
    b.p.kick(d.follow.x.vel, d.follow.y.vel) // 惯性甩出：松手瞬间卡片自身的动量决定过冲幅度
    b.sq.snap(d.sq.x.value, d.sq.y.value)
    b.sq.set(1, 1)
    b.rot.snap(d.rot.value)
    b.rot.target = 0
    settleTorn(card)
    others.forEach((c) => {
      const f = before.get(c)
      const l = c.getBoundingClientRect()
      physOf(c).p.shift(f.left - l.left, f.top - l.top) // 邻居同样用弹簧接位
    })
    Ticker.add(physicsTick)
  } catch { /* 动画出错也不影响布局已复原 */ }
  readLayout()
  saveLayout()
}

// 给每张卡片装上“可抓的边框”与提手
function makeDraggable(card) {
  const zones = []
  ;['edge-t', 'edge-b', 'edge-l', 'edge-r'].forEach((cls) => {
    const d = document.createElement('div')
    d.className = `edge ${cls}`
    card.appendChild(d)
    zones.push(d)
  })
  const grip = document.createElement('div')
  grip.className = 'grip'
  card.appendChild(grip)
  zones.push(grip)
  zones.forEach((z) => {
    z.addEventListener('pointerdown', (e) => {
      if (drag || $('app-view').classList.contains('hidden')) return
      e.preventDefault()
      const x0 = e.clientX
      const y0 = e.clientY
      // 手指碰边框往往只是滑动起点，先走 8px 才抬起卡片；鼠标仍保留“按下即抓起”的跟手性
      const slop = e.pointerType === 'touch' ? 8 : 0
      const onMove = (ev) => {
        if (!drag) {
          if (slop && Math.hypot(ev.clientX - x0, ev.clientY - y0) < slop) return
          startDrag(card, e) // 仍用 pointerdown 的坐标起算，补掉这段行程才不会让卡片跳位
        }
        moveDrag(ev)
      }
      const onUp = () => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        window.removeEventListener('pointercancel', onUp)
        window.removeEventListener('blur', onUp)
        if (drag) endDrag() // 没达到阈值就松手：卡片根本没被抬起来，不必走落位动画
      }
      // 触屏被系统手势打断（pointercancel）、拖到一半切窗口（blur）都要落位，
      // 否则卡片永远停在 body 上的 fixed 状态，跟其他面板叠在一起
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
      window.addEventListener('pointercancel', onUp)
      window.addEventListener('blur', onUp)
    })
  })
}

/* 顶层接线：DOM 事件与初始渲染。原来直接摊在 app.js 顶层，
 * 拆成模块后放进 init()，由 main.js 按原文件顺序调用，避免模块求值顺序影响这些副作用。 */
export function init() {
  ghost.className = 'ghost'

  // 兜底：上一轮拖拽若被打断，卡片可能残留在 body 上并带着内联定位/尺寸
  document.querySelectorAll('body > .card').forEach((c) => {
    homeOf(c).appendChild(c)
    c.classList.remove('dragging', 'torn')
    c.style.cssText = ''
  })

  /* 手机上不装拖拽热区：整屏一页一个事，没有“重排”这回事；
   * 留着那一圈透明热区只会让“点卡片内容”变成误抓卡片（CSS 也会把 .edge/.grip 藏掉） */
  if (!isMobile()) document.querySelectorAll('#app-view .card').forEach(makeDraggable)

  applyLayout()

  // 列宽拖动：把另一列“挤窄”（窄屏下 CSS 早已把这条拖动条藏了，摸不到就等于没有，不必再加分支）
  ;(function () {
    const rz = $('col-resizer')
    let on = false, sx = 0, sw = 0
    rz.addEventListener('pointerdown', (e) => {
      on = true; sx = e.clientX; sw = layout.sideW
      rz.classList.add('on')
      rz.setPointerCapture(e.pointerId)
      e.preventDefault()
    })
    rz.addEventListener('pointermove', (e) => {
      if (!on) return
      const dx = e.clientX - sx
      layout.sideW = Math.round(clamp(layout.mode === 'left' ? sw + dx : sw - dx, 220, 620))
      document.documentElement.style.setProperty('--side-w', `${layout.sideW}px`)
    })
    const stop = () => { if (!on) return; on = false; rz.classList.remove('on'); saveLayout() }
    rz.addEventListener('pointerup', stop)
    rz.addEventListener('pointercancel', stop)

  })()

  // 布局弹窗
  $('btn-layout').onclick = () => $('layout-modal').classList.remove('hidden')

  $('btn-layout-close').onclick = () => $('layout-modal').classList.add('hidden')

  $('layout-modal').addEventListener('click', (e) => { if (e.target.id === 'layout-modal') $('layout-modal').classList.add('hidden') })

  document.querySelectorAll('#layout-preset-group button').forEach((btn) => {
    btn.onclick = () => {
      layout.mode = btn.dataset.preset
      /* 挑战略：主界面不再给它留一块，模板里也就只剩时钟 / 任务 / 好友三张卡 */
      if (layout.mode === 'stack') { layout.a = ['display']; layout.b = ['tasks', 'friends'] }
      else if (layout.mode === 'left') { layout.a = ['display']; layout.b = ['tasks', 'friends'] }
      saveLayout(); applyLayout(); toast(`已切换为${btn.textContent}布局`)
    }
  })

  $('btn-layout-reset').onclick = async () => {
    if (!await confirmAction('恢复默认布局？')) return
    setLayout({ ...DEFAULT_LAYOUT })
    saveLayout(); applyLayout(); toast('已恢复默认布局')
  }

}
