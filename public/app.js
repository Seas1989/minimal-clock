/* ---------- 主题与文字对比度自适应 ---------- */

const THEMES = [
  { id: 'paper', bg: '#f7f7f5', dot: '#f0f0ec' },
  { id: 'sand', bg: '#f4e8dc', dot: '#e8d5c0' },
  { id: 'mist', bg: '#dce8e4', dot: '#c4d8d2' },
  { id: 'lavender', bg: '#e4e0f0', dot: '#cfc8e8' },
  { id: 'night', bg: '#16161a', dot: '#16161a' },
]

const lumaOf = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b
const hexLuma = (hex) => { const n = parseInt(hex.slice(1), 16); return lumaOf((n >> 16) & 255, (n >> 8) & 255, n & 255) }

let currentTheme = THEMES[0]
let imgLuma = null // 背景图平均亮度（0~255），跳域无法采样时为 null

function applyTheme(theme) {
  currentTheme = theme
  const root = document.documentElement.style
  root.setProperty('--bg', theme.bg)
  localStorage.setItem('theme', theme.id)
  updateContrast()
}

// 手机浏览器地址栏 / 任务切换器配色：不往 HTML 里塞静态标签，切主题时动态同步
function syncBrowserColor(hex) {
  let m = document.querySelector('meta[name="theme-color"]')
  if (!m) {
    m = document.createElement('meta')
    m.name = 'theme-color'
    document.head.appendChild(m)
  }
  m.content = hex
}

// 文字颜色不能只看主题：有背景图时要按“卡片实际可见亮度”判定
// 可见亮度 = 卡片底色×浓度 + 背景图亮度×(1-遮罩)×(1-浓度)
function updateContrast() {
  const root = document.documentElement.style
  const themeL = hexLuma(currentTheme.bg)
  const cardA = bg.card
  let cardLuma = themeL // 无图时就是主题背景
  let pageLuma = themeL

  if (bg.img) {
    const imgEff = (imgLuma == null ? 120 : imgLuma) * (1 - bg.dim * 0.92) // 经过黑色遮罩压暗
    const cardBase = themeL > 140 ? 248 : 22 // 卡片基色仍跟随主题明暗
    cardLuma = cardA * cardBase + (1 - cardA) * imgEff
    pageLuma = imgEff // 卡片外（顶栏）直接落在背景图上
    root.setProperty('--card-solid', (themeL > 140 ? 'rgba(255,255,255,' : 'rgba(20,20,24,') + cardA + ')')
  }

  // 自动：亮度低则用浅色字；手动优先
  const lightText = bg.fgMode === 'light' ? true : bg.fgMode === 'dark' ? false : cardLuma < 150

  root.setProperty('--fg', lightText ? '#f5f5f5' : '#1a1a1a')
  root.setProperty('--fg-weak', lightText ? 'rgba(245,245,245,.62)' : 'rgba(26,26,26,.55)')
  root.setProperty('--card', lightText ? 'rgba(245,245,245,.06)' : 'rgba(26,26,26,.04)')
  root.setProperty('--line', lightText ? 'rgba(245,245,245,.16)' : 'rgba(26,26,26,.1)')
  // 顶栏等卡在背景上的元素，用背景亮度单独定色，避免“深色背景 + 深色字”看不见
  root.setProperty('--fg-out', pageLuma < 150 ? 'rgba(245,245,245,.9)' : 'rgba(26,26,26,.85)')
  root.setProperty('--fg-out-weak', pageLuma < 150 ? 'rgba(245,245,245,.6)' : 'rgba(26,26,26,.55)')
  // 有背景图时页面主色就是图（压暗后的均值），否则就是主题底色
  syncBrowserColor(bg.img ? (pageLuma < 150 ? '#101014' : '#e9e9e6') : currentTheme.bg)

  document.querySelectorAll('#fg-mode-group button').forEach((b) => b.classList.toggle('active', b.dataset.fg === bg.fgMode))
}

// 采样背景图平均亮度（外链允许时），失败不阻断
function sampleImageLuma(url) {
  imgLuma = null
  if (!url) { updateContrast(); return }
  const im = new Image()
  im.crossOrigin = 'anonymous'
  im.onload = () => {
    try {
      const c = document.createElement('canvas')
      c.width = c.height = 24
      const ctx = c.getContext('2d')
      ctx.drawImage(im, 0, 0, 24, 24)
      const d = ctx.getImageData(0, 0, 24, 24).data
      let sum = 0, n = 0
      for (let i = 0; i < d.length; i += 4) { sum += lumaOf(d[i], d[i + 1], d[i + 2]); n++ }
      imgLuma = sum / n
    } catch { imgLuma = null } // 跳域 tainted canvas：退回中性估计
    updateContrast()
  }
  im.onerror = () => { imgLuma = null; updateContrast() }
  im.src = url
}

const picker = document.getElementById('theme-picker')
THEMES.forEach((t) => {
  const dot = document.createElement('button')
  dot.className = 'theme-dot'
  dot.style.background = t.dot
  dot.title = '切换主题'
  dot.onclick = () => {
    applyTheme(t)
    document.querySelectorAll('.theme-dot').forEach((d) => d.classList.remove('active'))
    dot.classList.add('active')
  }
  picker.appendChild(dot)
})
const savedTheme = THEMES.find((t) => t.id === localStorage.getItem('theme')) || THEMES[0]
picker.children[THEMES.indexOf(savedTheme)].classList.add('active')

/* ---------- 状态 ---------- */

const CYCLE = { daily: 864e5, weekly: 7 * 864e5, monthly: 30 * 864e5, yearly: 365 * 864e5 }
const REC_LABEL = { none: '', daily: '每日', weekly: '每周', monthly: '每月', yearly: '每年' }
const RING_C = 2 * Math.PI * 92 // 进度环周长

let token = localStorage.getItem('token') || null
let tasks = []
let friends = { friends: [], incoming: [], outgoing: [] }
let mode = localStorage.getItem('mode') || 'clock' // clock | countdown | stopwatch
let selectedId = null
let challenges = [] // 同任务挑战：服务端已按进度排好序的视图
let focusId = null  // 专注模式中那一个计时窗的任务 id
let offset = 0     // 服务器时间与本地的偏差：serverNow = Date.now() + offset
let titleFlash = '' // 完成提醒时临时标题
const notified = new Set() // 已提醒过完成的任务 id

const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

const $ = (id) => document.getElementById(id)
const bigTime = $('big-time')
const subTime = $('sub-time')
const taskList = $('task-list')
const ringFg = $('ring-fg')

/* ---------- 通用 UI：Toast / 确认弹窗 / 提示音 ---------- */

let toastTimer = null
function toast(msg) {
  const el = $('toast')
  el.textContent = msg
  el.classList.remove('hidden')
  el.classList.add('show')
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => {
    el.classList.remove('show')
    el.classList.add('hidden')
  }, 2600)
}

let confirmResolve = null
function confirmAction(message) {
  $('confirm-text').textContent = message
  $('confirm-modal').classList.remove('hidden')
  return new Promise((resolve) => { confirmResolve = resolve })
}
function closeConfirm(result) {
  $('confirm-modal').classList.add('hidden')
  if (confirmResolve) { confirmResolve(result); confirmResolve = null }
}
$('btn-confirm-yes').onclick = () => closeConfirm(true)
$('btn-confirm-no').onclick = () => closeConfirm(false)
$('confirm-modal').addEventListener('click', (e) => { if (e.target.id === 'confirm-modal') closeConfirm(false) })

let audioCtx = null
function beep() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)()
    if (audioCtx.state === 'suspended') audioCtx.resume()
    const t0 = audioCtx.currentTime
    ;[880, 660, 880].forEach((freq, i) => {
      const osc = audioCtx.createOscillator()
      const gain = audioCtx.createGain()
      osc.frequency.value = freq
      osc.type = 'sine'
      const start = t0 + i * 0.18
      gain.gain.setValueAtTime(0.0001, start)
      gain.gain.exponentialRampToValueAtTime(0.3, start + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.16)
      osc.connect(gain).connect(audioCtx.destination)
      osc.start(start)
      osc.stop(start + 0.18)
    })
  } catch { /* 忽略音频错误 */ }
}

function notifyComplete(task) {
  beep()
  toast(`⏰ 「${task.name}」已完成`)
  titleFlash = `⏰ ${task.name} 完成！`
  setTimeout(() => { titleFlash = '' }, 6000)
}

/* ---------- 自定义背景（可拖拽框选 / 缩放 / 适配，存 localStorage）---------- */

const lsNum = (key, def) => { const v = Number(localStorage.getItem(key)); return Number.isFinite(v) && localStorage.getItem(key) !== null ? v : def }

const bg = {
  img: localStorage.getItem('bgImage') || '',
  fit: localStorage.getItem('bgFit') || 'cover',
  zoom: lsNum('bgZoom', 100),
  fx: lsNum('bgFx', 0.5),   // 焦点：0=只看图片顶部，0.5=中部，1=底部
  fy: lsNum('bgFy', 0.5),
  blur: lsNum('bgBlur', 0), // 背景模糊像素
  dim: (lsNum('bgDim', 30)) / 100,
  card: (lsNum('bgCard', 72)) / 100,           // 卡片浓度（越浓文字越好读）
  fgMode: localStorage.getItem('bgFgMode') || 'auto', // auto | dark(深色字) | light(浅色字)
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
const nat = { w: 0, h: 0 } // 图片原始尺寸，用于几何取景计算

// fx/fy：焦点取景（背景定位语义）——0 对齐图片上/左边，1 对齐下/右边，0.5 居中。
// 放大后可通过 fy 直接选定“只看顶部 / 中部 / 底部”；几何只在视口坐标系算一次，
// 预览框用 transform scale 等比映射，小框严格镜像全屏
function imgGeom(w, h) {
  const base = (bg.fit === 'cover' ? Math.max(w / nat.w, h / nat.h) : Math.min(w / nat.w, h / nat.h)) * (bg.zoom / 100)
  const iw = nat.w * base, ih = nat.h * base
  const overX = Math.max(0, iw - w), overY = Math.max(0, ih - h) // 可裁切（可拖动）的行程
  const x = overX > 0 ? -overX * bg.fx : (w - iw) / 2
  const y = overY > 0 ? -overY * bg.fy : (h - ih) / 2
  return { iw, ih, x, y, overX, overY }
}

function placeImg(el, g) {
  if (!el) return
  el.style.width = `${g.iw}px`
  el.style.height = `${g.ih}px`
  el.style.left = `${g.x}px`
  el.style.top = `${g.y}px`
}

let previewScale = 1, previewOffX = 0, previewOffY = 0 // 预览框→视口坐标换算

let layoutQueued = false
function layoutBg() {
  if (layoutQueued) return
  layoutQueued = true
  requestAnimationFrame(() => {
    layoutQueued = false
    if (!nat.w) return
    const g = imgGeom(innerWidth, innerHeight)
    placeImg($('bg-img'), g)
    const prev = $('bg-prev')
    if (!$('bg-modal').classList.contains('hidden')) {
      const sc = prev.clientWidth / innerWidth
      const box = $('bg-prev-scale')
      previewScale = sc
      previewOffX = (prev.clientWidth - innerWidth * sc) / 2
      previewOffY = Math.min(0, (prev.clientHeight - innerHeight * sc) / 2)
      box.style.width = `${innerWidth}px`
      box.style.height = `${innerHeight}px`
      box.style.transform = `scale(${sc})`
      // 预览框比例被 clamp 偏离视口时，居中裁切多余部分
      box.style.left = `${previewOffX}px`
      box.style.top = `${previewOffY}px`
      placeImg($('bg-prev-img'), g) // 用视口坐标的同一组几何，小框严格镜像全屏
    }
  })
}

function sizePreview() {
  const box = $('bg-preview')
  box.style.height = `${clamp(Math.round(box.clientWidth * (innerHeight / innerWidth)), 100, 260)}px`
  layoutBg()
}

function saveBg() {
  localStorage.setItem('bgFit', bg.fit)
  localStorage.setItem('bgZoom', bg.zoom)
  localStorage.setItem('bgFx', bg.fx)
  localStorage.setItem('bgFy', bg.fy)
  localStorage.setItem('bgBlur', bg.blur)
  localStorage.setItem('bgDim', Math.round(bg.dim * 100))
  localStorage.setItem('bgCard', Math.round(bg.card * 100))
  localStorage.setItem('bgFgMode', bg.fgMode)
}

function loadBgImg(url) {
  nat.w = 0; nat.h = 0
  sampleImageLuma(url)
  if (!url) return renderBg()
  const im = new Image()
  im.onload = () => { nat.w = im.naturalWidth; nat.h = im.naturalHeight; renderBg() }
  im.onerror = () => { toast('图片加载失败，请检查地址或换一张'); clearBg() }
  im.src = url
}

function renderBg() {
  document.documentElement.style.setProperty('--bg-dim', bg.dim)
  document.documentElement.style.setProperty('--bg-blur', `${bg.blur}px`)
  updateContrast()
  const layer = $('bg-layer'), img = $('bg-img')
  const prev = $('bg-prev'), prevImg = $('bg-prev-img'), empty = $('bg-prev-empty')
  if (bg.img && nat.w) {
    img.src = bg.img; prevImg.src = bg.img
    layer.classList.remove('hidden')
    document.body.classList.add('has-bg')
    prev.classList.remove('hidden'); empty.classList.add('hidden')
    sizePreview()
    layoutBg()
  } else {
    img.removeAttribute('src'); prevImg.removeAttribute('src')
    layer.classList.add('hidden')
    document.body.classList.remove('has-bg')
    prev.classList.add('hidden'); empty.classList.remove('hidden')
  }
  // 同步控件
  $('bg-dim').value = Math.round(bg.dim * 100)
  $('bg-zoom').value = bg.zoom
  $('bg-blur').value = bg.blur
  $('bg-card').value = Math.round(bg.card * 100)
  document.querySelectorAll('#bg-fit-group button').forEach((b) => b.classList.toggle('active', b.dataset.fit === bg.fit))
  if (typeof markPos === 'function') markPos()
}

function setBgImage(url) {
  try {
    localStorage.setItem('bgImage', url)
  } catch {
    toast('图片过大无法保存，请换小图或使用外链地址')
    return
  }
  bg.img = url
  bg.fx = 0.5; bg.fy = 0.5; bg.zoom = 100
  saveBg()
  loadBgImg(url)
}

function clearBg() {
  localStorage.removeItem('bgImage')
  bg.img = ''
  nat.w = 0; nat.h = 0
  imgLuma = null
  renderBg()
  toast('已清除背景')
}

$('btn-bg').onclick = () => { $('bg-modal').classList.remove('hidden'); sizePreview() }
$('btn-bg-clear').onclick = clearBg
$('btn-bg-close').onclick = () => $('bg-modal').classList.add('hidden')
$('btn-bg-center').onclick = () => { bg.fx = 0.5; bg.fy = 0.5; bg.zoom = 100; saveBg(); layoutBg(); markPos() }
// 快捷取景：上 / 中 / 下（放大后直接定位到想展示的那一段）
document.querySelectorAll('#bg-pos-group button').forEach((btn) => {
  btn.onclick = () => {
    bg.fy = Number(btn.dataset.fy)
    saveBg(); layoutBg(); markPos()
  }
})
function markPos() {
  document.querySelectorAll('#bg-pos-group button').forEach((b) => b.classList.toggle('active', Math.abs(Number(b.dataset.fy) - bg.fy) < 0.02))
}
$('bg-modal').addEventListener('click', (e) => { if (e.target.id === 'bg-modal') $('bg-modal').classList.add('hidden') })

$('bg-url').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const v = e.target.value.trim()
    if (v) { setBgImage(v); e.target.value = ''; toast('背景已更新') }
  }
})

$('bg-zoom').addEventListener('input', (e) => {
  bg.zoom = Number(e.target.value)
  saveBg(); layoutBg(); markPos()
})
$('bg-dim').addEventListener('input', (e) => {
  bg.dim = Number(e.target.value) / 100
  saveBg(); document.documentElement.style.setProperty('--bg-dim', bg.dim)
})
$('bg-blur').addEventListener('input', (e) => {
  bg.blur = Number(e.target.value)
  saveBg(); document.documentElement.style.setProperty('--bg-blur', `${bg.blur}px`)
})
$('bg-card').addEventListener('input', (e) => {
  bg.card = Number(e.target.value) / 100
  saveBg(); updateContrast()
})
document.querySelectorAll('#fg-mode-group button').forEach((btn) => {
  btn.onclick = () => { bg.fgMode = btn.dataset.fg; saveBg(); updateContrast() }
})
document.querySelectorAll('#bg-fit-group button').forEach((btn) => {
  btn.onclick = () => { bg.fit = btn.dataset.fit; saveBg(); layoutBg() }
})

$('bg-file').addEventListener('change', (e) => {
  const file = e.target.files[0]
  if (!file) return
  if (!/^image\//.test(file.type)) return toast('请选择图片文件')
  const reader = new FileReader()
  reader.onload = () => { setBgImage(reader.result); toast('背景已更新') }
  reader.readAsDataURL(file)
  e.target.value = ''
})

// 预览框拖拽：按行程反算焦点，1:1 跟手；行程内自由移动，到图片上/下边缘自然停止
;(function () {
  const prev = $('bg-prev')
  let dragging = false, sx = 0, sy = 0, ofx = 0, ofy = 0
  prev.addEventListener('pointerdown', (e) => {
    if (!bg.img || !nat.w) return
    dragging = true; sx = e.clientX; sy = e.clientY; ofx = bg.fx; ofy = bg.fy
    prev.setPointerCapture(e.pointerId)
    e.preventDefault()
  })
  prev.addEventListener('pointermove', (e) => {
    if (!dragging) return
    const g = imgGeom(innerWidth, innerHeight)
    const k = previewScale || 1
    const dx = (e.clientX - sx) / k, dy = (e.clientY - sy) / k // 换算回视口像素
    if (g.overX > 0) bg.fx = clamp(ofx - dx / g.overX, 0, 1)
    if (g.overY > 0) bg.fy = clamp(ofy - dy / g.overY, 0, 1)
    saveBg(); layoutBg(); markPos()
  })
  prev.addEventListener('pointerup', () => { dragging = false })
  prev.addEventListener('pointercancel', () => { dragging = false })
  // 双击：回到居中取景
  prev.addEventListener('dblclick', () => { bg.fx = 0.5; bg.fy = 0.5; saveBg(); layoutBg(); markPos() })
  // 滚轮：以光标位置为中心缩放，光标下方的画面点保持不动
  prev.addEventListener('wheel', (e) => {
    if (!bg.img || !nat.w) return
    e.preventDefault()
    const r = prev.getBoundingClientRect()
    const k0 = previewScale || 1
    const vx = ((e.clientX - r.left) - previewOffX) / k0
    const vy = ((e.clientY - r.top) - previewOffY) / k0
    const g = imgGeom(innerWidth, innerHeight)
    const ux = (vx - g.x) / g.iw, uy = (vy - g.y) / g.ih // 光标落在图上的相对位置 0~1
    const nz = clamp(bg.zoom * (e.deltaY < 0 ? 1.12 : 1 / 1.12), 100, 400)
    bg.zoom = nz
    const g2 = imgGeom(innerWidth, innerHeight)
    // 由“图上位置不变”反解新焦点：vx = -overX * fx + ux * iw
    if (g2.overX > 0) bg.fx = clamp((ux * g2.iw - vx) / g2.overX, 0, 1)
    if (g2.overY > 0) bg.fy = clamp((uy * g2.ih - vy) / g2.overY, 0, 1)
    $('bg-zoom').value = bg.zoom
    saveBg(); layoutBg(); markPos()
  }, { passive: false })
})()

window.addEventListener('resize', () => { layoutBg(); if (!$('bg-modal').classList.contains('hidden')) sizePreview() })

// 主题初始化必须在 bg 定义之后（updateContrast 需要读背景参数）
applyTheme(savedTheme)
if (bg.img) { loadBgImg(bg.img) } else { renderBg() }

/* ---------- 工具函数 ---------- */

function pad(n) { return String(n).padStart(2, '0') }

function fmtElapsed(ms) {
  const s = Math.floor(Math.abs(ms) / 1000)
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (d > 0) return `${d}天 ${pad(h)}:${pad(m)}:${pad(sec)}`
  if (h > 0) return `${h}:${pad(m)}:${pad(sec)}`
  return `${pad(m)}:${pad(sec)}`
}

function serverNow() { return Date.now() + offset }

function liveElapsed(t) {
  return t.status === 'running' ? t.elapsedBase + (serverNow() - t.startedAt) : t.elapsedBase
}

// 返回 { text, sub, frac }：主显示文本 + 状态副标题 + 进度环比例(0~1)
function taskState(t) {
  const elapsed = liveElapsed(t)
  if (t.type === 'stopwatch') {
    return { text: fmtElapsed(elapsed), sub: statusSub(t), frac: (elapsed % 60000) / 60000 }
  }

  // 倒计时
  if (t.recurrence && t.recurrence !== 'none' && CYCLE[t.recurrence]) {
    const cycle = CYCLE[t.recurrence]
    const pos = elapsed % cycle
    const doneInCycle = pos >= t.duration
    const remain = doneInCycle ? 0 : t.duration - pos
    const nextIn = cycle - pos
    if (t.status === 'stopped') return { text: fmtElapsed(t.duration), sub: '未开始', frac: 1 }
    if (doneInCycle) return { text: '已完成', sub: `${REC_LABEL[t.recurrence]}循环 · ${fmtElapsed(nextIn)}后重新开始`, frac: 0 }
    return { text: fmtElapsed(remain), sub: `${REC_LABEL[t.recurrence]}循环进行中`, frac: remain / t.duration }
  }

  const remain = t.duration - elapsed
  if (t.status === 'done' || (remain <= 0 && t.status !== 'stopped')) return { text: '已完成', sub: '已完成', frac: 0 }
  if (t.status === 'stopped') return { text: fmtElapsed(t.duration), sub: '未开始', frac: 1 }
  return { text: fmtElapsed(Math.max(0, remain)), sub: statusSub(t), frac: Math.max(0, remain) / t.duration }
}

function statusSub(t) {
  return { running: t.type === 'countdown' ? '倒计时进行中' : '计时中', paused: '已暂停', stopped: '未开始', done: '已完成' }[t.status]
}

async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...options.headers }
  if (token) headers['x-token'] = token
  const res = await fetch(path, { ...options, headers })
  const data = await res.json().catch(() => ({}))
  if (res.status === 401) { logout(); throw new Error(data.error || '登录已失效') }
  if (!res.ok) throw new Error(data.error || '请求失败')
  return data
}

/* ---------- 登录 / 注册 ---------- */

let authMode = 'login'

function showView(loggedIn) {
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
    token = data.j.token
    localStorage.setItem('token', token)
    $('auth-pass').value = ''
    enterApp(data.j.username)
  } catch (e) {
    setAuthMsg('网络错误：' + e.message)
  }
}

function setAuthMsg(msg) { $('auth-msg').textContent = msg }

function logout() {
  token = null
  localStorage.removeItem('token')
  tasks = []
  friends = { friends: [], incoming: [], outgoing: [] }
  challenges = []
  selectedId = null
  // 退出登录只收起休息层：走 endRest 会顺手替用户 resume，可 token 已经没了
  if (rest) { rest = null; $('rest').classList.add('hidden') }
  musicStop()
  musicCfg = null
  closeMusic()
  if (focusId) exitFocus()
  showView(false)
}

async function enterApp(username) {
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

document.querySelectorAll('#auth-tabs .tab').forEach((tab) => {
  tab.onclick = () => setAuthMode(tab.dataset.auth)
})
$('btn-auth').onclick = doAuth
$('auth-pass').addEventListener('keydown', (e) => { if (e.key === 'Enter') doAuth() })
$('btn-logout').onclick = logout

/* ---------- 任务操作 ---------- */

async function refresh() {
  try {
    tasks = await api('/api/tasks')
  } catch { return }
  if (selectedId && !tasks.some((t) => t.id === selectedId)) selectedId = null
  if (focusId && !tasks.some((t) => t.id === focusId)) exitFocus()
  renderTasks()
  renderDock()
  renderTimerPanel()
  if (focusId) renderFocus()
}

async function act(id, action) {
  try {
    await api(`/api/tasks/${id}/action`, { method: 'POST', body: JSON.stringify({ action }) })
    await refresh()
    // 暂停入口有三处（控制面板 / 任务行 / 空格），询问休息只放在 act 里，一处也不会漏
    const t = tasks.find((x) => x.id === id)
    if (action === 'pause' && t && t.type === 'stopwatch' && !rest) askRest(t)
  } catch (e) { toast(e.message) }
}

async function createTask() {
  const name = $('task-name').value.trim()
  let duration = 0
  let recurrence = 'none'
  if (mode === 'countdown') {
    duration =
      (Number($('task-day').value) || 0) * 864e5 +
      (Number($('task-hour').value) || 0) * 36e5 +
      (Number($('task-min').value) || 0) * 6e4 +
      (Number($('task-sec').value) || 0) * 1e3
    recurrence = $('recurrence').value
    if (duration <= 0) return toast('请设置倒计时的时长')
  }
  try {
    const task = await api('/api/tasks', {
      method: 'POST',
      body: JSON.stringify({ name, type: mode, duration, recurrence }),
    })
    $('task-name').value = ''
    selectedId = task.id
    toast(`已创建「${task.name}」`)
    // 窗口坞还空着：新任务直接挂上去，省得用户再点一次
    if (!dockTasks().length) await setWindow(task.id, true)
    await act(task.id, 'start')
  } catch (e) { toast(e.message) }
}

async function deleteTask(id) {
  const t = tasks.find((x) => x.id === id)
  if (!await confirmAction(`确定删除任务「${t ? t.name : ''}」？`)) return
  try {
    await api(`/api/tasks/${id}`, { method: 'DELETE' })
    if (selectedId === id) selectedId = null
    toast('已删除')
    await refresh()
  } catch (e) { toast(e.message) }
}

function selectTask(id) {
  if (mode === 'clock') return
  setSelection(selectedId === id ? null : id)
}

// 换选中任务后要刷新的四处（列表高亮 / 窗口坞 / 控制面板 / 大表盘）集中在这里，
// 免得以后新增一处渲染就漏一处
function setSelection(id) {
  selectedId = id
  renderTasks()
  renderDock()
  renderTimerPanel()
  tickDisplay()
}

/* ---------- 好友 ---------- */

async function loadFriends() {
  try {
    friends = await api('/api/friends')
  } catch { return }
  renderFriends()
}

async function addFriend() {
  const username = $('friend-name').value.trim()
  if (!username) return
  try {
    const r = await api('/api/friends/request', { method: 'POST', body: JSON.stringify({ username }) })
    $('friend-name').value = ''
    toast(r.accepted ? `已与 ${username} 成为好友` : `已向 ${username} 发送申请`)
    await loadFriends()
  } catch (e) { toast(e.message) }
}

async function respondRequest(reqId, accept, name) {
  try {
    await api('/api/friends/respond', { method: 'POST', body: JSON.stringify({ reqId, accept }) })
    toast(accept ? `已与 ${name} 成为好友` : `已拒绝 ${name}`)
    await loadFriends()
  } catch (e) { toast(e.message) }
}

async function unfriend(id, name) {
  if (!await confirmAction(`解除与「${name}」的好友关系？互相之间待处理的挑战邀请会作废。`)) return
  try {
    await api(`/api/friends/${id}`, { method: 'DELETE' })
    toast('已解除好友')
    await Promise.all([loadFriends(), refresh(), loadChallenges()])
  } catch (e) { toast(e.message) }
}

function renderFriends() {
  const reqBox = $('friend-requests')
  reqBox.innerHTML = ''
  friends.incoming.forEach((r) => {
    const div = document.createElement('div')
    div.className = 'friend-item req'
    const name = document.createElement('span')
    name.textContent = `${r.username} 请求加你`
    div.appendChild(name)
    div.appendChild(miniBtn('同意', () => respondRequest(r.reqId, true, r.username)))
    div.appendChild(miniBtn('拒绝', () => respondRequest(r.reqId, false, r.username)))
    reqBox.appendChild(div)
  })
  friends.outgoing.forEach((r) => {
    const div = document.createElement('div')
    div.className = 'friend-item req'
    div.textContent = `已发送给 ${r.username}（待同意）`
    reqBox.appendChild(div)
  })

  const list = $('friend-list')
  list.innerHTML = ''
  if (!friends.friends.length && !friends.incoming.length && !friends.outgoing.length) {
    list.innerHTML = '<div class="empty-tip">还没有好友，输入用户名添加</div>'
    return
  }
  friends.friends.forEach((f) => {
    const div = document.createElement('div')
    div.className = 'friend-item'
    const name = document.createElement('span')
    name.textContent = f.username
    div.appendChild(name)
    div.appendChild(miniBtn('解除', () => unfriend(f.id, f.username)))
    list.appendChild(div)
  })
}

function miniBtn(label, onclick) {
  const b = document.createElement('button')
  b.className = 'link-btn'
  b.textContent = label
  b.onclick = onclick
  return b
}

/* ---------- 同任务挑战：同一个目标、各自打卡、按进度排行 ---------- */

let shareTaskId = null
let challengeId = null
const shareTargets = new Set()   // 发起弹窗里勾选的好友
const challengePick = new Set()  // 详情弹窗里勾选的追加邀请对象

async function loadChallenges() {
  try {
    challenges = await api('/api/challenges')
  } catch { return }
  renderChallengePanel()
  if (challengeId) renderChallengeModal() // 弹窗开着时排行也跟着动
}

const challengeOf = (id) => challenges.find((c) => c.id === id) || null

// 进度文案：有目标量就说“刷完几轮 + 本轮百分比”，纯计时型只能比累计时长
function progText(m, ch) {
  if (ch.duration > 0) {
    const unit = { daily: '天', weekly: '周', monthly: '月', yearly: '年' }[ch.recurrence] || '轮'
    return `已完成 ${m.cycles} ${unit} · 本轮 ${Math.round(m.pct * 100)}%`
  }
  return `累计 ${Math.floor(m.ms / 6e4)} 分钟`
}

const RANK_TAG = { running: '计时中', paused: '已暂停', stopped: '未开始', done: '已完成', none: '未绑定任务' }

/* 面板：待我处理的邀请排最前（能接受也能拒绝），其次是我已参与的 */
function renderChallengePanel() {
  const box = $('challenge-list')
  box.innerHTML = ''
  const invites = challenges.filter((c) => !c.joined && c.myInvite && c.myInvite.status === 'pending')
  const mine = challenges.filter((c) => c.joined)
  if (!invites.length && !mine.length) {
    box.innerHTML = '<div class="empty-tip">还没有挑战。在任务上点 ↗，把同一个目标发给好友</div>'
    return
  }
  invites.forEach((c) => box.appendChild(challengeItem(c, true)))
  if (invites.length && mine.length) box.appendChild(groupLabel('我参与的'))
  mine.forEach((c) => box.appendChild(challengeItem(c, false)))
}

function challengeItem(c, isInvite) {
  const row = document.createElement('div')
  row.className = 'friend-item' + (isInvite ? ' req' : '')
  const me = c.members.find((m) => m.isMe)
  const rank = me ? c.members.indexOf(me) + 1 : 0
  const top = document.createElement('span')
  top.textContent = isInvite
    ? `${c.ownerName} 邀你：${c.title}`
    : `${c.title} · 第 ${rank}/${c.members.length} 名 · ${me ? progText(me, c) : ''}`
  row.appendChild(top)
  row.appendChild(miniBtn('查看', () => openChallenge(c.id)))
  if (isInvite) {
    row.appendChild(miniBtn('接受', () => respondChallenge(c.id, true)))
    row.appendChild(miniBtn('拒绝', () => respondChallenge(c.id, false)))
  } else if (me && me.taskId) {
    row.appendChild(miniBtn('专注', () => enterFocus(me.taskId)))
  }
  return row
}

/* 发起：把任务作为共同目标发给好友（邀请制，对方可拒绝） */

function openShare(taskId) {
  const t = tasks.find((x) => x.id === taskId)
  if (!t) return
  shareTaskId = taskId
  shareTargets.clear()
  $('share-task-name').textContent = `把「${t.name}」当共同目标发给好友：各自计时、按进度排行，对方可以拒绝。`
  // 倒计时自带目标量；正计时没有，要由发起人补一个“每轮目标时长”才能排行
  $('share-goal-row').classList.toggle('hidden', t.type !== 'stopwatch')
  $('share-goal').value = lsNum('challengeGoal', 30)
  syncGoalText()
  renderShareModal()
  $('share-modal').classList.remove('hidden')
}

function syncGoalText() {
  $('share-goal-text').textContent = `${Number($('share-goal').value)} 分钟/轮`
}

function closeShare() {
  shareTaskId = null
  $('share-modal').classList.add('hidden')
}

// 好友 chip 只是勾选，点「发出邀请」才真发出去（避免手滑一路共享出去）
function renderShareModal() {
  const box = $('share-friends')
  box.innerHTML = ''
  if (!friends.friends.length) {
    box.innerHTML = '<div class="empty-tip">还没有好友，先在右侧添加好友</div>'
    return
  }
  friends.friends.forEach((f) => {
    const on = shareTargets.has(f.id)
    const chip = document.createElement('button')
    chip.className = 'share-chip' + (on ? ' on' : '')
    chip.textContent = on ? `✓ ${f.username}` : f.username
    chip.onclick = () => {
      if (on) shareTargets.delete(f.id)
      else shareTargets.add(f.id)
      renderShareModal()
    }
    box.appendChild(chip)
  })
  const all = document.createElement('button')
  const every = shareTargets.size === friends.friends.length
  all.className = 'share-chip' + (every ? ' on' : '')
  all.textContent = every ? '✓ 取消全选' : '全选'
  all.onclick = () => {
    shareTargets.clear()
    if (!every) friends.friends.forEach((f) => shareTargets.add(f.id))
    renderShareModal()
  }
  box.appendChild(all)
}

$('share-goal').addEventListener('input', () => {
  syncGoalText()
  localStorage.setItem('challengeGoal', $('share-goal').value)
})

$('btn-share-go').onclick = async () => {
  const t = tasks.find((x) => x.id === shareTaskId)
  if (!t) return
  if (!shareTargets.size) return toast('至少选一位好友')
  try {
    const view = await api('/api/challenges', {
      method: 'POST',
      body: JSON.stringify({ taskId: t.id, to: [...shareTargets], duration: Number($('share-goal').value) * 6e4 }),
    })
    closeShare()
    toast(`已向 ${view.pending.length} 人发出挑战邀请`)
    await Promise.all([refresh(), loadChallenges()])
    openChallenge(view.id)
  } catch (e) { toast(e.message) }
}

/* 详情：按完成进度排行 + 点赞 */

function openChallenge(id) {
  challengeId = id
  challengePick.clear()
  renderChallengeModal()
  $('challenge-modal').classList.remove('hidden')
  loadChallenges() // 打开瞬间拉一次最新进度
}

function closeChallenge() {
  challengeId = null
  $('challenge-modal').classList.add('hidden')
}

function renderChallengeModal() {
  const c = challengeOf(challengeId)
  if (!c) { closeChallenge(); return }
  $('challenge-title').textContent = c.title
  $('challenge-meta').textContent = [
    `${c.ownerName} 发起`,
    `${c.members.length} 人参与`,
    c.duration > 0
      ? `每轮目标 ${Math.round(c.duration / 6e4)} 分钟${c.recurrence !== 'none' ? ` · ${REC_LABEL[c.recurrence]}循环` : ''}`
      : '不限目标 · 比累计时长',
  ].join(' · ')

  const rank = $('challenge-rank')
  rank.innerHTML = ''
  const maxMs = Math.max(1, ...c.members.map((m) => m.ms))
  c.members.forEach((m, i) => rank.appendChild(rankRow(c, m, i, maxMs)))

  renderChallengeInvite(c)

  const leave = $('btn-challenge-leave')
  leave.classList.toggle('hidden', !c.joined)
  leave.textContent = c.isOwner ? '关闭挑战' : '退出挑战'
}

function rankRow(c, m, i, maxMs) {
  const row = document.createElement('div')
  row.className = 'rank-row' + (m.isMe ? ' me' : '')

  const no = document.createElement('span')
  no.className = 'rank-no'
  no.textContent = i + 1
  row.appendChild(no)

  const main = document.createElement('div')
  main.className = 'rank-main'
  const who = document.createElement('div')
  who.className = 'rank-who'
  who.textContent = m.username + (m.isMe ? '（我）' : '')
  const tag = document.createElement('i')
  tag.className = 'rank-tag'
  tag.textContent = m.missing ? RANK_TAG.none : RANK_TAG[m.taskStatus] || ''
  who.appendChild(tag)
  const bar = document.createElement('div')
  bar.className = 'rank-bar'
  const fill = document.createElement('i')
  fill.style.width = `${(Math.min(1, c.duration > 0 ? m.pct : m.ms / maxMs) * 100).toFixed(1)}%`
  bar.appendChild(fill)
  const text = document.createElement('div')
  text.className = 'rank-text'
  text.textContent = m.missing ? '还没建自己的任务' : progText(m, c)
  main.appendChild(who)
  main.appendChild(bar)
  main.appendChild(text)
  row.appendChild(main)

  const like = document.createElement('button')
  like.className = 'like-btn' + (m.likedByMe ? ' on' : '')
  like.textContent = `♥ ${m.likes}`
  like.disabled = m.isMe || !c.joined
  like.title = m.isMe ? '不能给自己点赞' : c.joined ? '给 TA 鼓劲' : '加入后才能点赞'
  like.onclick = () => likeUser(c.id, m.user)
  row.appendChild(like)

  // 点自己那一行直接进专注：看别人进度的同时自己这个窗不被干扰
  if (m.isMe && m.taskId) row.onclick = () => enterFocus(m.taskId)
  return row
}

// 底部操作区：被邀请时是“接受/拒绝”，发起人则是“追加邀请”
function renderChallengeInvite(c) {
  const box = $('challenge-invite')
  box.innerHTML = ''
  if (!c.joined && c.myInvite && c.myInvite.status === 'pending') {
    const tip = document.createElement('div')
    tip.className = 'empty-tip'
    tip.textContent = `接受后会自动建一份同名任务给你计时，只排行、不共享数据。`
    box.appendChild(tip)
    const ok = document.createElement('button')
    ok.className = 'ctrl-btn solid'
    ok.textContent = '接受邀请'
    ok.onclick = () => respondChallenge(c.id, true)
    box.appendChild(ok)
    const no = document.createElement('button')
    no.className = 'ghost-btn'
    no.textContent = '拒绝'
    no.onclick = () => respondChallenge(c.id, false)
    box.appendChild(no)
    return
  }
  if (!c.isOwner) return
  const others = friends.friends.filter((f) => !c.members.some((m) => m.user === f.id))
  if (!others.length) return
  const tip = document.createElement('div')
  tip.className = 'bg-tip'
  tip.textContent = '再邀请：'
  box.appendChild(tip)
  others.forEach((f) => {
    const waiting = c.pending.some((p) => p.user === f.id)
    const on = challengePick.has(f.id)
    const chip = document.createElement('button')
    chip.className = 'share-chip' + (on ? ' on' : '') + (waiting ? ' dim' : '')
    chip.textContent = waiting ? `${f.username}（待同意）` : on ? `✓ ${f.username}` : f.username
    chip.onclick = () => {
      if (waiting) return
      if (on) challengePick.delete(f.id)
      else challengePick.add(f.id)
      renderChallengeModal()
    }
    box.appendChild(chip)
  })
  const go = document.createElement('button')
  go.className = 'ghost-btn small'
  go.textContent = '发出邀请'
  go.onclick = async () => {
    if (!challengePick.size) return toast('先勾选要邀请的好友')
    try {
      await api(`/api/challenges/${c.id}/invite`, { method: 'POST', body: JSON.stringify({ to: [...challengePick] }) })
      challengePick.clear()
      toast('已发出邀请')
      await loadChallenges()
    } catch (e) { toast(e.message) }
  }
  box.appendChild(go)
}

async function respondChallenge(id, accept) {
  const c = challengeOf(id)
  try {
    await api(`/api/challenges/${id}/respond`, { method: 'POST', body: JSON.stringify({ accept }) })
    toast(accept ? `已加入「${c ? c.title : ''}」，同款任务已建好` : '已拒绝这个邀请')
    await Promise.all([refresh(), loadChallenges()])
    if (!accept && challengeId === id) closeChallenge()
  } catch (e) { toast(e.message) }
}

// 点赞接口直接返回最新视图，拼回去就行，不必整表重拉
async function likeUser(id, user) {
  try {
    const view = await api(`/api/challenges/${id}/like`, { method: 'POST', body: JSON.stringify({ user }) })
    challenges = challenges.map((c) => (c.id === view.id ? view : c))
    renderChallengePanel()
    if (challengeId === id) renderChallengeModal()
  } catch (e) { toast(e.message) }
}

$('btn-challenge-leave').onclick = async () => {
  const c = challengeOf(challengeId)
  if (!c) return
  const owner = c.isOwner
  if (!await confirmAction(owner
    ? `关闭挑战「${c.title}」？所有人的挑战绑定会解开，任务本身保留。`
    : `退出挑战「${c.title}」？你的任务会保留，只是不再参与排行。`)) return
  try {
    if (owner) await api(`/api/challenges/${c.id}`, { method: 'DELETE' })
    else await api(`/api/challenges/${c.id}/leave`, { method: 'POST' })
    toast(owner ? '已关闭挑战' : '已退出挑战')
    closeChallenge()
    await Promise.all([refresh(), loadChallenges()])
  } catch (e) { toast(e.message) }
}

$('btn-share-close').onclick = closeShare
$('share-modal').addEventListener('click', (e) => { if (e.target.id === 'share-modal') closeShare() })
$('btn-challenge-close').onclick = closeChallenge
$('challenge-modal').addEventListener('click', (e) => { if (e.target.id === 'challenge-modal') closeChallenge() })

/* ---------- 渲染：主显示区 + 进度环 ---------- */

function selectedTask() {
  return tasks.find((t) => t.id === selectedId) || null
}

function updateRing(frac) {
  const f = Math.max(0, Math.min(1, frac || 0))
  ringFg.style.strokeDasharray = RING_C
  ringFg.style.strokeDashoffset = RING_C * (1 - f)
}

function renderTimerPanel() {
  const controls = $('timer-controls')
  if (mode === 'clock') {
    $('clock-panel').classList.remove('hidden')
    $('timer-panel').classList.add('hidden')
    return
  }
  $('clock-panel').classList.add('hidden')
  $('timer-panel').classList.remove('hidden')
  $('duration-inputs').classList.toggle('hidden', mode !== 'countdown')
  $('recurrence').classList.toggle('hidden', mode !== 'countdown')
  $('btn-create').textContent = mode === 'countdown' ? '＋ 新建倒计时' : '＋ 新建正计时'

  const t = selectedTask()
  if (!t) { controls.innerHTML = ''; return }
  controlButtons(controls, t)
}

// 控制按钮：主面板和专注层共用一份，避免两处逻辑漂移
function controlBtn(box, label, onclick, solid) {
  const b = document.createElement('button')
  b.className = 'ctrl-btn' + (solid ? ' solid' : '')
  b.textContent = label
  b.onclick = onclick
  box.appendChild(b)
}

function controlButtons(box, t) {
  box.innerHTML = ''
  if (t.status === 'stopped') controlBtn(box, '开始', () => act(t.id, 'start'), true)
  else if (t.status === 'running') controlBtn(box, '暂停', () => act(t.id, 'pause'), true)
  else if (t.status === 'paused') {
    controlBtn(box, '继续', () => act(t.id, 'resume'), true)
    // 之前选了“不休息”，也得有地方能手动开始休息
    if (t.type === 'stopwatch' && !rest) controlBtn(box, '休息', () => startRest(t.id))
  }
  if (t.status !== 'stopped') {
    controlBtn(box, '重置', () => act(t.id, 'reset'))
    controlBtn(box, '完成', () => act(t.id, 'complete'))
    controlBtn(box, '删除', () => deleteTask(t.id))
  }
}

function tickDisplay() {
  const now = new Date(serverNow())
  updateToday(now)
  tickWindows()
  tickFocus()
  if (mode === 'clock') {
    bigTime.textContent = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
    subTime.textContent = `${now.getFullYear()} 年 ${now.getMonth() + 1} 月 ${now.getDate()} 日  ${WEEK[now.getDay()]}`
    updateRing(now.getSeconds() / 60)
    setTitle(`${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`)
    return
  }
  const t = selectedTask()
  if (!t) {
    bigTime.textContent = '00:00'
    subTime.textContent = '选择或创建一个任务'
    updateRing(0)
    setTitle('')
    return
  }
  const st = taskState(t)
  bigTime.textContent = st.text
  subTime.textContent = `${t.name} · ${st.sub}`
  updateRing(st.frac)
  setTitle(st.text)
}

function setTitle(timeText) {
  if (titleFlash) { document.title = titleFlash; return }
  document.title = timeText ? `${timeText} · 时钟` : '时钟'
}

// 今日进度条：填充主卡片下部空间，也让时间过得“看得见”
function updateToday(now) {
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const passed = serverNow() - dayStart
  const pct = clamp(passed / 864e5 * 100, 0, 100)
  $('today-fill').style.width = `${pct.toFixed(2)}%`
  const left = 864e5 - passed
  $('today-text').textContent = `今天已过 ${pct.toFixed(0)}% · 剩余 ${Math.floor(left / 36e5)} 时 ${Math.floor((left % 36e5) / 6e4)} 分`
}

// 完成检测：倒计时归零时提醒一次
function checkCompletion() {
  tasks.forEach((t) => {
    if (t.type !== 'countdown') return
    if (t.recurrence && t.recurrence !== 'none') return
    if (t.status !== 'running') { notified.delete(t.id); return }
    const remain = t.duration - liveElapsed(t)
    if (remain <= 0 && !notified.has(t.id)) {
      notified.add(t.id)
      notifyComplete(t)
    } else if (remain > 0) {
      notified.delete(t.id)
    }
  })
}

/* ---------- 渲染：任务列表（排序 + 分组） ---------- */

const STATUS_ICON = { running: '⏸', paused: '▶', stopped: '▶', done: '' }
const STATUS_ORDER = { running: 0, paused: 1, stopped: 2, done: 3 }

function renderTasks() {
  taskList.innerHTML = ''
  if (!tasks.length) {
    taskList.innerHTML = '<div class="empty-tip">暂无任务，去上方新建一个吧</div>'
    return
  }
  const sortFn = (a, b) => (STATUS_ORDER[a.status] - STATUS_ORDER[b.status]) || (a.createdAt - b.createdAt)
  tasks.slice().sort(sortFn).forEach((t) => taskList.appendChild(taskItem(t)))
}

function groupLabel(text) {
  const d = document.createElement('div')
  d.className = 'group-label'
  d.textContent = text
  return d
}

function taskItem(t) {
  const div = document.createElement('div')
  div.className = 'task-item' + (t.id === selectedId ? ' selected' : '') + (t.window ? ' win' : '')

  const top = document.createElement('div')
  top.className = 'task-top'

  const name = document.createElement('span')
  name.className = 'task-name'
  let label = t.name
  if (t.recurrence && t.recurrence !== 'none') label += ` ↻${REC_LABEL[t.recurrence]}`
  name.textContent = label
  top.appendChild(name)

  const actions = document.createElement('div')
  actions.className = 'task-actions'
  const isRecurring = t.recurrence && t.recurrence !== 'none'
  if (t.status !== 'done' || isRecurring) {
    const play = document.createElement('button')
    play.className = 'icon-btn'
    play.textContent = STATUS_ICON[t.status] || '⏸'
    play.title = t.status === 'running' ? '暂停' : '开始'
    play.onclick = (e) => {
      e.stopPropagation()
      act(t.id, t.status === 'running' ? 'pause' : t.status === 'paused' ? 'resume' : 'start')
    }
    actions.appendChild(play)
  }

  const win = document.createElement('button')
  win.className = 'icon-btn' + (t.window ? ' on' : '')
  win.textContent = '▢'
  win.title = t.window ? '从窗口坞收起（后台继续计时）' : '挂到窗口坞：和别的任务同时计时'
  win.onclick = (e) => { e.stopPropagation(); toggleWindow(t.id) }
  actions.appendChild(win)

  const share = document.createElement('button')
  share.className = 'icon-btn'
  share.textContent = t.challenge ? '⚑' : '↗'
  share.title = t.challenge ? '查看同任务挑战' : '发起同任务挑战'
  share.onclick = (e) => { e.stopPropagation(); t.challenge ? openChallenge(t.challenge) : openShare(t.id) }
  actions.appendChild(share)

  const del = document.createElement('button')
  del.className = 'icon-btn'
  del.textContent = '✕'
  del.title = '删除'
  del.onclick = (e) => { e.stopPropagation(); deleteTask(t.id) }
  actions.appendChild(del)

  top.appendChild(actions)

  const time = document.createElement('div')
  time.className = 'task-time'
  time.id = `tt-${t.id}`

  div.appendChild(top)
  div.appendChild(time)
  div.onclick = () => selectTask(t.id)
  return div
}

function tickTaskTimes() {
  tasks.forEach((t) => {
    const el = $(`tt-${t.id}`)
    if (el) el.textContent = `${t.type === 'countdown' ? '⏳' : '⏱'} ${taskState(t).text}`
  })
}

/* ---------- 计时窗口坞：同屏多开，点窗切换、× 收起（后台继续跑） ---------- */

const dockTasks = () => tasks.filter((t) => t.window)
const focusTask = () => tasks.find((t) => t.id === focusId) || null

async function setWindow(id, open) {
  await api(`/api/tasks/${id}/window`, { method: 'POST', body: JSON.stringify({ open }) })
  const t = tasks.find((x) => x.id === id)
  if (t) t.window = open
  renderDock()
  renderTasks()
}

async function toggleWindow(id) {
  const t = tasks.find((x) => x.id === id)
  if (!t) return
  try {
    await setWindow(id, !t.window)
    // 挂上窗口就直接切到它（所见即所得）；收起时如果正显示着就回到“没选中”
    if (t.window) pickWindow(id)
    else if (selectedId === id) setSelection(null)
  } catch (e) { toast(e.message) }
}

// 点窗口 = 决定当前界面走哪个计时；类型不同得先切到对应标签页，否则大表盘不显示它
function pickWindow(id) {
  const t = tasks.find((x) => x.id === id)
  if (!t) return
  if (mode !== t.type) setMode(t.type)
  setSelection(id)
}

function renderDock() {
  const box = $('dock')
  const list = dockTasks()
  box.innerHTML = ''
  box.classList.toggle('hidden', !list.length)
  list.forEach((t) => {
    const w = document.createElement('div')
    w.className = 'twin' + (t.id === selectedId ? ' active' : '') + (t.status === 'running' ? ' live' : '')

    const head = document.createElement('div')
    head.className = 'twin-head'
    const name = document.createElement('span')
    name.className = 'twin-name'
    name.textContent = t.name
    head.appendChild(name)

    const fs = document.createElement('button')
    fs.className = 'twin-btn'
    fs.textContent = '⤢'
    fs.title = '专注这个窗口（其余全部雾化）'
    fs.onclick = (e) => { e.stopPropagation(); enterFocus(t.id) }
    head.appendChild(fs)

    const cl = document.createElement('button')
    cl.className = 'twin-btn close'
    cl.textContent = '✕'
    cl.title = '收起窗口（后台继续计时）'
    cl.onclick = (e) => { e.stopPropagation(); toggleWindow(t.id) }
    head.appendChild(cl)

    const time = document.createElement('div')
    time.className = 'twin-time'
    time.id = `dw-${t.id}`

    w.appendChild(head)
    w.appendChild(time)
    w.onclick = () => pickWindow(t.id)
    box.appendChild(w)
  })
  tickWindows()
}

// 窗口坞和专注层不属于“当前选中的那个任务”：没被选中的窗也要一秒一秒跳
function tickWindows() {
  dockTasks().forEach((t) => {
    const el = $(`dw-${t.id}`)
    if (el) el.textContent = taskState(t).text
  })
}

/* ---------- 专注模式：整页雾化，只留下这一个计时窗 ---------- */

function enterFocus(id) {
  const t = tasks.find((x) => x.id === id)
  if (!t) return
  focusId = id
  if (mode !== t.type) setMode(t.type)
  setSelection(id)
  $('focus').classList.remove('hidden')
  renderFocus()
}

function exitFocus() {
  focusId = null
  $('focus').classList.add('hidden')
}

function renderFocus() {
  const t = focusTask()
  if (!t) { exitFocus(); return }
  $('focus-name').textContent = t.name
  controlButtons($('focus-controls'), t)
  tickFocus()
}

function tickFocus() {
  if (!focusId) return
  const t = focusTask()
  if (!t) return
  const st = taskState(t)
  $('focus-time').textContent = st.text
  $('focus-sub').textContent = `${st.sub}${t.challenge ? ' · 可看挑战排行' : ''}`
  $('focus-fill').style.width = `${(clamp(st.frac, 0, 1) * 100).toFixed(2)}%`
}

$('btn-focus-exit').onclick = exitFocus

/* ---------- 休息：正计时暂停后问一句，倒计时走完了自动续上刚才的任务 ---------- */

let rest = null // { endAt, taskId }：纯前端状态，刷不刷页面不影响任务自己的计时
const restMins = () => clamp(lsNum('restMin', 5), 1, 30)

async function askRest(t) {
  const mins = restMins()
  if (!await confirmAction(`「${t.name}」已跑 ${fmtElapsed(liveElapsed(t))}，休息 ${mins} 分钟？结束时会自动继续计时。`)) return
  startRest(t.id)
}

function startRest(taskId) {
  rest = { endAt: serverNow() + restMins() * 6e4, taskId, total: restMins() * 6e4 }
  $('rest').classList.remove('hidden')
  renderRest()
  // 解锁必须在任何 await 之前做：Safari 只认用户手势那一次同步调用，先进音乐帧再填地址
  unlockAudio()
  // 外面已经听着呢：不打断，也不再调 playCurrent（否则这首会被从头放起）
  if (queue && !audioEl().paused) { music.owner = 'user'; return }
  musicAutoplay()
}

// auto=true 是倒计时走完，否则是手动提前结束
function endRest(auto) {
  const r = rest
  rest = null
  $('rest').classList.add('hidden')
  if (!r) return
  // 只有“休息替他自动开”的那部分才收掉；他自己点开的听歌要继续留在页面上
  if (music.owner === 'rest') musicStop()
  if (auto) { beep(); toast('休息结束，已继续计时') }
  else toast('已提前结束休息')
  const t = tasks.find((x) => x.id === r.taskId)
  // 只接回“确实因为休息而暂停”的任务，用户中途点了重置/完成就不去动它
  if (t && t.status === 'paused') act(r.taskId, 'resume')
}

function renderRest() {
  if (!rest) return
  const left = Math.max(0, rest.endAt - serverNow())
  $('rest-time').textContent = fmtElapsed(left)
  $('rest-fill').style.width = `${(100 * (1 - left / Math.max(1, rest.total))).toFixed(2)}%`
  const t = tasks.find((x) => x.id === rest.taskId)
  $('rest-sub').textContent = t ? `休息结束后继续「${t.name}」` : '休息结束后回列表选任务'
  if (left <= 0) endRest(true)
}

$('btn-rest-add').onclick = () => {
  if (!rest) return
  rest.endAt += 6e4
  rest.total += 6e4 // 进度条跟着重新算，否则加了时长反而看起来“快完了”
  renderRest()
}
$('btn-rest-end').onclick = () => endRest(false)

function syncRestLenText() { $('rest-len-text').textContent = `${restMins()} 分钟` }
$('rest-len').value = restMins()
syncRestLenText()
$('rest-len').addEventListener('input', () => {
  localStorage.setItem('restMin', $('rest-len').value)
  syncRestLenText()
  if (rest) { // 正在休息时改滑块：按新时长重算剩下的，比“多出的分钟数”直观
    const total = restMins() * 6e4
    rest.endAt = serverNow() + total
    rest.total = total
    renderRest()
  }
})

/* ---------- 音乐：走服务端的网易云只读代理（MUSIC_U 只存 data/，不进仓库） ----------
 * 底部播放条是全局的，任何界面都能听；只有进休息层时才会自动开始放 */

/* 0 采样的静音 WAV：第一次播之前先用它把 <audio> “碰响”，
 * 不然等 await 拉完地址再 play()，Safari 会当成非手势调用直接拦下 */
const SILENT_WAV = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA='

let musicCfg = null // { platform, hasCookie, cookieMask, source: { kind, value, label } }
let queue = null    // { kind, name, playlistId, tracks[], offset }：当前的播放列表，可来自来源、搜索单曲、手动加
/* owner 决定休息结束时收不收起：'rest' 是休息自动起的（结束就替他关掉），
 * 'user' 是他自己点起来的（一直留着，切界面也不停）
 * pool / hist 只服务随机模式：pool 是本轮还没抽到的下标，hist 是去过的地方（上一首靠它往回走） */
const music = { i: 0, tries: 0, loading: false, warn: '', owner: '', pool: [], hist: [] }

const audioEl = () => $('music-audio')
const musicVol = () => clamp(lsNum('musicVol', 60), 0, 100) / 100
const curTrack = () => (queue && queue.tracks && queue.tracks.length ? queue.tracks[music.i] : null)
const fmtSongTime = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

/* 当前的音乐平台：服务端配置里存的那一个，取数据的路径以它为前缀
 * （/api/netease/* 与 /api/qq/* 形状一致：search / url / queue 三件事）*/
const mp = () => (musicCfg && musicCfg.platform === 'qq' ? 'qq' : 'netease')
const isQQ = () => mp() === 'qq'
// 曲目 id：网易云是数字，QQ 音乐是 songmid 字符串，restoreQueue 两种都要认
const isTrackId = (v) => (Number(v) > 0 ? true : /^[A-Za-z0-9]{8,20}$/.test(String(v || '')))

/* 播放方式：顺序（放完下一首）/ 随机（一轮内不重复）/ 单曲循环 */
const PLAY_MODES = ['order', 'shuffle', 'one']
const MODE_LABEL = { order: '顺序', shuffle: '随机', one: '单曲循环' }
const MODE_ICON = { order: '🔁', shuffle: '🔀', one: '🔂' }
const playMode = () => (PLAY_MODES.includes(localStorage.getItem('playMode')) ? localStorage.getItem('playMode') : 'order')
function setPlayMode(m) {
  localStorage.setItem('playMode', m)
  if (m !== 'shuffle') { music.pool = []; music.hist = [] }
  renderMusicBar()
  renderQueuePanel()
}

/* 列表存 localStorage（只存曲目摘要，不存直链——直链几小时就过期，重启时按 id 现取）：
 * 刷新后 ☰ 里的东西还在、点 ▶ 接着从这首放；点 ✕ / 退出登录就清掉，不留上一段的尾巴 */
function saveQueue() {
  if (!queue || !queue.tracks.length) return
  try {
    localStorage.setItem('musicQueue', JSON.stringify({
      name: queue.name,
      i: music.i,
      tracks: queue.tracks.slice(0, 300).map((t) => ({ id: t.id, name: t.name, artists: t.artists, album: t.album, duration: t.duration })),
    }))
  } catch { /* 超出配额就丢了缓存，列表本身还在内存里 */ }
}

function restoreQueue() {
  if (queue) return
  let r = null
  try {
    r = JSON.parse(localStorage.getItem('musicQueue'))
  } catch {
    localStorage.removeItem('musicQueue')
    return
  }
  if (!r || !Array.isArray(r.tracks)) return
  const tracks = r.tracks.filter((t) => t && isTrackId(t.id) && t.name)
  if (!tracks.length) { localStorage.removeItem('musicQueue'); return }
  queue = { kind: 'songs', name: String(r.name || '播放列表').slice(0, 40), playlistId: 0, tracks, offset: 0 }
  music.i = clamp(Number(r.i) || 0, 0, tracks.length - 1)
  renderMusicBar() // 只是把条恢复出来、☰ 里能点开，不自动出声（owner 空，所以不抢休息的自动放）
}

function unlockAudio() {
  const a = audioEl()
  if (a.dataset.unlocked === '1') return
  a.dataset.unlocked = '1'
  a.volume = 0
  a.src = SILENT_WAV
  a.play().then(() => a.pause()).catch(() => { /* 连静音都不让开就作罢，后面靠用户手点 ▶ */ })
}

async function loadMusicCfg() {
  try {
    musicCfg = await api('/api/music/config')
  } catch { musicCfg = null }
  syncMusicModal()
}

async function loadQueue(force) {
  // 已经有列表了就不重拉：手动加的歌、搜到的那批不该被“来源”覆盖掉
  if (queue && !force) return queue
  let q = null
  try {
    q = await api(`/api/${mp()}/queue`)
  } catch (e) { queue = null; syncPlayer(); toast('音乐没拿到：' + e.message); return null }
  if (!q || !Array.isArray(q.tracks) || !q.tracks.length) { queue = null; syncPlayer(); toast('这个来源里没有能读的曲目'); return null }
  queue = q
  music.i = (q.offset || 0) % q.tracks.length
  music.tries = 0
  music.warn = ''
  music.pool = []
  music.hist = []
  renderMusicBar()
  saveQueue()
  return queue
}

// 取不到地址（付费 / 下架 / 需要 MUSIC_U）就连跳，最多试 5 首，不然后果是一首接一首地空转
function skipUnplayable() {
  if (!queue || !queue.tracks.length) return
  music.tries++
  if (music.tries >= 5) {
    music.loading = false
    music.warn = isQQ()
      ? '这个列表里连着 5 首都拿不到地址（QQ 音乐只给免费曲目），换一批试试'
      : musicCfg && musicCfg.hasCookie
        ? '这个来源里连着 5 首都取不到地址，换一批试试'
        : '连着 5 首都是付费歌，填入 MUSIC_U 后才能播'
    audioEl().removeAttribute('src')
    renderMusicBar()
    return
  }
  music.i = (music.i + 1) % queue.tracks.length
  playCurrent()
}

async function playCurrent() {
  if (!queue || !queue.tracks.length) return
  saveQueue() // 记下“现在是第几首”，刷新后 ▶ 能接着这首
  const t = curTrack()
  const a = audioEl()
  music.loading = true
  renderMusicBar()
  let r = null
  try {
    r = await api(`/api/${mp()}/url?id=${encodeURIComponent(t.id)}`)
  } catch (e) {
    music.loading = false
    music.warn = e.message
    renderMusicBar()
    return
  }
  if (!r.url) { music.loading = false; return skipUnplayable() }
  music.tries = 0
  music.loading = false
  music.warn = ''
  a.volume = musicVol()
  a.src = r.url
  a.play().catch(() => {
    // 浏览器还是拦了：把按钮留给用户手点，不反复弹提示
    music.warn = '点了 ▶ 就开始'
    renderMusicBar()
  })
  renderMusicBar()
}

function musicPause() {
  const a = audioEl()
  a.pause()
  renderMusicBar()
}

/* 彻底收摊：暂停 + 丢掉地址 + 清队列 + 藏播放条（休息结束、退出登录、点 ✕ 都走这里） */
function musicStop() {
  const a = audioEl()
  a.pause()
  if (a.src && a.src !== SILENT_WAV) a.removeAttribute('src')
  queue = null
  music.i = 0
  music.tries = 0
  music.loading = false
  music.warn = ''
  music.owner = ''
  music.pool = []
  music.hist = []
  localStorage.removeItem('musicQueue')
  syncPlayer()
}

/* 用户自己点“听歌”：不一定要在休息里，之后切面板、选任务都不打断 */
async function startListen() {
  if (!token) return toast('先登录，音乐设置存在服务端的账号上')
  unlockAudio()
  music.owner = 'user'
  const q = await loadQueue(true)
  if (q) playCurrent()
}

async function toggleListen() {
  const a = audioEl()
  if (queue && !a.paused) return musicPause()
  // 已有列表且只是被按停过：接着放，不重新拉队列（否则每次都从随机那首开头）
  if (queue && a.src && a.src !== SILENT_WAV) {
    music.owner = 'user'
    a.play().then(renderMusicBar).catch(() => playCurrent())
    return
  }
  await startListen()
}

function musicAutoplay() {
  music.owner = 'rest'
  loadQueue().then((q) => {
    if (!q) return
    unlockAudio()
    playCurrent()
  })
}

/* 随机抽一个本轮没抽过的；用完了自动重开一轮 */
function reshufflePool() {
  const n = queue ? queue.tracks.length : 0
  music.pool = Array.from({ length: n }, (_, i) => i).filter((i) => i !== music.i)
  for (let i = music.pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    const t = music.pool[i]
    music.pool[i] = music.pool[j]
    music.pool[j] = t
  }
}

function stepMusic(d) {
  if (!queue || !queue.tracks.length) return
  const n = queue.tracks.length
  music.warn = ''
  if (n === 1) return playCurrent() // 就一首：重播它，不绕回自己空转
  if (playMode() === 'shuffle') {
    if (d > 0) {
      if (!music.pool.length) reshufflePool()
      music.hist.push(music.i)
      music.i = music.pool.pop()
    } else {
      // 上一首走历史栈，否则“我刚听过的那首”根本回不去
      music.i = music.hist.length ? music.hist.pop() : (music.i + n - 1) % n
    }
  } else {
    music.i = ((music.i + d) % n + n) % n
  }
  playCurrent()
}

/* 播放条只跟着“有没有队列”显示；body 上再打个标记，让 toast、页面底部、弹窗的「完成」都给它让位 */
function syncPlayer() {
  const on = !!queue
  $('player').classList.toggle('hidden', !on)
  document.body.classList.toggle('has-player', on)
  $('btn-listen').textContent = queue && !audioEl().paused ? '⏸ 听歌' : '▶ 听歌'
  $('btn-rm-queue').textContent = `☰ ${queue ? queue.tracks.length : 0}`
  $('btn-rm-mode').textContent = MODE_ICON[playMode()]
  $('btn-rm-queue').classList.toggle('on', on && !$('queue-pop').classList.contains('hidden'))
  if (!on) $('queue-pop').classList.add('hidden')
  syncDrawer()   // 抽屉里那个「听歌」跟着播放条走，不能一个在放一个写着“开始”
}

/* 只挪高亮与标题，不重建列表：timeupdate 一秒来好几趟，重建会把主线程吃掉 */
function syncQueueRows() {
  if (!queue || $('queue-pop').classList.contains('hidden')) return
  const rows = $('queue-list').children
  for (let i = 0; i < rows.length; i++) rows[i].classList.toggle('on', i === music.i)
  $('queue-title').textContent = `${queue.name} · ${queue.tracks.length} 首 · ${MODE_LABEL[playMode()]}`
}

function renderMusicBar() {
  syncPlayer()
  if (!queue) return
  const a = audioEl()
  const t = curTrack()
  $('rm-title').textContent = music.warn || (t ? t.name : '—')
  const artist = t ? [t.artists, t.album].filter(Boolean).join(' · ') : ''
  const d = Number(a.duration) || 0
  const pos = d > 0 ? ` ${fmtSongTime(a.currentTime)} / ${fmtSongTime(d)}` : ''
  $('rm-sub').textContent = music.warn
    ? ''
    : `${queue.name} 第 ${music.i + 1}/${queue.tracks.length} 首${artist ? ' · ' + artist : ''}${pos}${!isQQ() && musicCfg && !musicCfg.hasCookie ? ' · 未填 MUSIC_U（付费歌可能播不了）' : ''}`
  $('btn-rm-toggle').textContent = a.paused ? '▶' : '⏸'
  $('rm-fill').style.width = music.loading ? '35%' : d > 0 ? `${clamp((a.currentTime / d) * 100, 0, 100).toFixed(2)}%` : '0%'
  syncQueueRows()
}

$('btn-rm-prev').onclick = () => stepMusic(-1)
$('btn-rm-next').onclick = () => stepMusic(1)
$('btn-rm-close').onclick = musicStop
$('btn-rm-queue').onclick = () => toggleQueuePanel()
$('btn-rm-mode').onclick = cyclePlayMode
$('btn-listen').onclick = () => { void toggleListen() }
$('btn-music-play').onclick = () => { void startListen() }

/* 进度条上点一下就是调位：听歌时想跳回开头不用回到弹窗 */
$('rm-bar').addEventListener('click', (e) => {
  const a = audioEl()
  const d = Number(a.duration) || 0
  if (!d) return
  const box = e.currentTarget.getBoundingClientRect()
  const ratio = clamp((e.clientX - box.left) / Math.max(1, box.width), 0, 1)
  try { a.currentTime = ratio * d } catch { /* 地址还没就绪 */ }
  renderMusicBar()
})

$('btn-rm-toggle').onclick = () => {
  const a = audioEl()
  // 用户主动点 ▶ 就当“再试一次”：之前连跳 5 首设的熔断得重新关掉，否则这个按钮永远是死的
  music.tries = 0
  music.warn = ''
  if (!queue) { void startListen(); return }
  if (a.paused) {
    music.owner = 'user' // 手点起来的，休息结束就别替用户关掉
    if (!a.src || a.src === SILENT_WAV) playCurrent()
    else { a.play().then(renderMusicBar).catch(() => playCurrent()) }
  } else musicPause()
}
audioEl().addEventListener('timeupdate', renderMusicBar)
audioEl().addEventListener('play', renderMusicBar)
audioEl().addEventListener('pause', renderMusicBar)
audioEl().addEventListener('ended', () => {
  const a = audioEl()
  if (playMode() === 'one') { a.currentTime = 0; a.play().catch(() => {}); return }
  stepMusic(1)
})
audioEl().addEventListener('error', () => {
  const src = audioEl().src || ''
  if (!src || src === SILENT_WAV) return // 解锁用的静音帧不算失败
  skipUnplayable()
})

/* ---------- 播放列表：除了“来源”，还能自己拼（搜到的单曲连播、逐首加、点谁播谁） ---------- */

/* 把一批歌直接当成当前列表并从第 startIndex 首开始放：
 * 不必先“设为来源”，搜到的单曲、别人的歌单点了就能连播 */
async function playSongs(list, name, startIndex = 0) {
  if (!token) return toast('先登录，音乐设置存在服务端的账号上')
  if (!list || !list.length) return toast('这批里没有能播的曲目')
  unlockAudio()
  music.owner = 'user'
  queue = { kind: 'songs', name: String(name || '播放列表').slice(0, 40), playlistId: 0, tracks: list.slice(), offset: 0 }
  music.i = clamp(startIndex, 0, list.length - 1)
  music.tries = 0
  music.warn = ''
  music.pool = []
  music.hist = []
  playCurrent()
  toast(`开始放：${queue.tracks[music.i].name}（共 ${queue.tracks.length} 首）`)
}

/* 点搜索结果里的歌单：只拿它的曲目当列表，不动“休息时放什么”的配置 */
async function playPlaylistNow(p) {
  if (!token) return toast('先登录')
  try {
    const pl = await api(`/api/netease/playlist?id=${p.id}`)
    await playSongs(pl.tracks, `歌单 · ${pl.name}`, 0)
  } catch (e) { toast(e.message) }
}

function playAt(i) {
  if (!queue || !queue.tracks[i]) return
  music.i = i
  music.tries = 0
  music.warn = ''
  music.pool = []
  music.hist = []
  playCurrent()
}

/* 逐首攒列表：没在放时这一首单独成列表，之后进休息也放它 */
function addToQueue(s) {
  if (!token) return toast('先登录')
  if (!queue || !queue.tracks.length) {
    queue = { kind: 'songs', name: '我的列表', playlistId: 0, tracks: [s], offset: 0 }
    music.i = 0
    music.tries = 0
    music.warn = ''
    renderMusicBar()
    saveQueue()
    return toast(`已加入「${s.name}」，点 ▶ 听歌开始放`)
  }
  if (queue.tracks.some((t) => t.id === s.id)) return toast('这首已经在列表里了')
  queue.tracks.push(s)
  // 下标全变了，随机池与历史得重开
  music.pool = []
  music.hist = []
  renderMusicBar()
  saveQueue()
  toast(`已加入「${s.name}」（共 ${queue.tracks.length} 首）`)
}

function removeFromQueue(i) {
  if (!queue || !queue.tracks[i]) return
  const wasCur = i === music.i
  queue.tracks.splice(i, 1)
  music.pool = []
  music.hist = []
  if (!queue.tracks.length) { musicStop(); return toast('列表空了，播放已停止') }
  if (wasCur) {
    // 删的正是当前这首：后面的顶上来，索引不动；删到末尾就回绕，播放不能停
    music.i = Math.min(music.i, queue.tracks.length - 1)
    playCurrent()
  } else if (i < music.i) music.i--
  renderMusicBar()
  saveQueue()
}

function cyclePlayMode() {
  const next = PLAY_MODES[(PLAY_MODES.indexOf(playMode()) + 1) % PLAY_MODES.length]
  if (next === 'shuffle') { music.pool = []; music.hist = [] }
  setPlayMode(next)
  toast(next === 'one' ? '单曲循环：这一首反复放' : next === 'shuffle' ? '随机：一轮内不重复放' : '顺序：放完一首放下一首')
}

function toggleQueuePanel(open) {
  const show = open === undefined ? $('queue-pop').classList.contains('hidden') : !!open
  $('queue-pop').classList.toggle('hidden', !show)
  $('btn-rm-queue').classList.toggle('on', show && !!queue)
  if (show) renderQueuePanel()
}

/* 队列面板：整列展开，点一行就切到那首，能单删。
 * 没这个面板的话，搜到的歌只能顺着听，“只能顺序播放”就是这么来的 */
function renderQueuePanel() {
  const box = $('queue-list')
  if ($('queue-pop').classList.contains('hidden')) return
  if (!queue || !queue.tracks.length) {
    $('queue-title').textContent = '列表是空的'
    box.innerHTML = '<div class="empty-tip">去音乐弹窗搜歌，点「播放」或「＋」往里加</div>'
    return
  }
  box.innerHTML = ''
  queue.tracks.forEach((t, i) => {
    const row = document.createElement('div')
    row.className = 'queue-row' + (i === music.i ? ' on' : '')
    const no = document.createElement('span')
    no.className = 'qr-no'
    no.textContent = i === music.i ? '▶' : String(i + 1)
    row.appendChild(no)
    const main = document.createElement('div')
    main.className = 'music-main'
    const name = document.createElement('div')
    name.className = 'music-name'
    name.textContent = t.name
    const sub = document.createElement('div')
    sub.className = 'music-sub'
    sub.textContent = [t.artists, t.album, fmtSongTime(t.duration / 1000)].filter(Boolean).join(' · ')
    main.appendChild(name)
    main.appendChild(sub)
    row.appendChild(main)
    const del = document.createElement('button')
    del.className = 'ghost-btn tiny'
    del.textContent = '✕'
    del.title = '从这个列表移除'
    del.onclick = (e) => { e.stopPropagation(); removeFromQueue(i) }
    row.appendChild(del)
    row.onclick = () => playAt(i)
    box.appendChild(row)
  })
  syncQueueRows()
}

/* ----- 音乐设置弹窗 ----- */

function openMusic() {
  $('music-modal').classList.remove('hidden')
  syncMusicModal()
  loadMusicCfg()
}

function closeMusic() { $('music-modal').classList.add('hidden') }

function syncMusicModal() {
  const onQQ = isQQ()
  // 平台切换：网易云那边才有歌单类来源与 MUSIC_U，切到 QQ 就把整段收起来而不是留一堆灰按钮
  document.querySelectorAll('#music-platform-group button').forEach((b) => b.classList.toggle('active', b.dataset.platform === mp()))
  document.querySelectorAll('#music-modal .ne-only').forEach((el) => el.classList.toggle('hidden', onQQ))
  document.querySelectorAll('#music-modal .qq-only').forEach((el) => el.classList.toggle('hidden', !onQQ))
  const src = (musicCfg && musicCfg.source) || { kind: 'light', value: '' }
  document.querySelectorAll('#music-kind-group button').forEach((b) => b.classList.toggle('active', b.dataset.kind === src.kind))
  $('music-mine').classList.toggle('hidden', src.kind !== 'mine')
  $('music-pid-row').classList.toggle('hidden', src.kind !== 'playlist')
  if (document.activeElement !== $('music-pid')) $('music-pid').value = src.value || ''
  const vol = clamp(lsNum('musicVol', 60), 0, 100)
  $('music-vol').value = vol
  $('music-vol-text').textContent = `${vol}%`
  $('music-cookie').value = ''
  $('music-status').textContent = !musicCfg
    ? '未登录，音乐设置不可用'
    : onQQ
      ? 'QQ 音乐：不需要任何 cookie，但只播免费曲目（付费的排在后面，点了会自动跳过）'
      : musicCfg.hasCookie
        ? `已保存 MUSIC_U（${musicCfg.cookieMask}），付费歌也能取到地址` // 只给打码指纹，明文不回传
        : '未填 MUSIC_U：只播免费曲目，内置轻音乐照常可用'
}

async function saveMusicCfg(patch) {
  try {
    musicCfg = await api('/api/music/config', { method: 'POST', body: JSON.stringify(patch) })
    // 换了来源或平台，手上的队列就作废：曲目 id 属于原来那个平台，拿去要地址只会得到一句“ID 不对”
    if ((patch.kind != null || patch.value != null || patch.platform != null) && queue) {
      const wasPlaying = !audioEl().paused
      queue = null
      localStorage.removeItem('musicQueue')
      syncPlayer()
      if (wasPlaying) void startListen()
    }
    syncMusicModal()
    return true
  } catch (e) { toast(e.message); return false }
}

document.querySelectorAll('#music-platform-group button').forEach((b) => {
  b.onclick = () => saveMusicCfg({ platform: b.dataset.platform })
})

document.querySelectorAll('#music-kind-group button').forEach((b) => {
  b.onclick = () => {
    const kind = b.dataset.kind
    if (kind === 'playlist') {
      const value = $('music-pid').value
      saveMusicCfg({ kind, value, label: '' }).then((saved) => {
        if (saved && !value) toast('把歌单链接或 ID 填到下面这一行')
      })
      return
    }
    saveMusicCfg({ kind, value: '', label: '' })
  }
})

$('music-pid').addEventListener('change', () => {
  if ((musicCfg && musicCfg.source.kind) !== 'playlist') return
  saveMusicCfg({ kind: 'playlist', value: $('music-pid').value, label: '' })
})

$('btn-music-load-pl').onclick = async () => {
  const box = $('music-pl-list')
  box.innerHTML = '<div class="empty-tip">读取中…</div>'
  try {
    const r = await api('/api/netease/playlists')
    box.innerHTML = ''
    if (!r.playlists.length) box.innerHTML = '<div class="empty-tip">这个账号下没有歌单</div>'
    r.playlists.forEach((p) => {
      box.appendChild(musicItem(p.name, `${p.trackCount} 首`, [
        { label: '播放', title: '直接放这个歌单，不改「休息时放什么」', onclick: () => playPlaylistNow(p) },
        { label: '用它', onclick: () => saveMusicCfg({ kind: 'playlist', value: String(p.id), label: p.name }) },
      ]))
    })
  } catch (e) {
    box.innerHTML = `<div class="empty-tip">${e.message}</div>`
  }
}

$('btn-music-search').onclick = searchMusic
$('music-q').addEventListener('keydown', (e) => { if (e.key === 'Enter') searchMusic() })

// 歌单和单曲各拉一次：歌单用来设来源或直接播，单曲用来连播 / 逐首搭自己的列表
// （QQ 音乐读不到歌单，那边只拉单曲一路）
async function searchMusic() {
  const kw = $('music-q').value.trim()
  const box = $('music-result')
  box.innerHTML = `<div class="empty-tip">${kw ? '搜索中…' : '试试搜「轻音乐」'}</div>`
  if (!kw) return
  const onQQ = isQQ()
  const [pls, songs] = await Promise.all([
    onQQ ? Promise.resolve([]) : api(`/api/${mp()}/search?q=${encodeURIComponent(kw)}&kind=playlist`).catch(() => []),
    api(`/api/${mp()}/search?q=${encodeURIComponent(kw)}&kind=song&limit=30`).catch(() => []),
  ])
  box.innerHTML = ''
  if (!pls.length && !songs.length) box.innerHTML = `<div class="empty-tip">${onQQ ? 'QQ 音乐' : '网易云'}没返回结果</div>`
  pls.forEach((p) => {
    box.appendChild(musicItem(p.name, `歌单 · ${p.trackCount} 首 · ${p.creator || ''}`, [
      { label: '播放', title: '直接放这个歌单，不改「休息时放什么」', onclick: () => playPlaylistNow(p) },
      { label: '设为来源', onclick: () => saveMusicCfg({ kind: 'playlist', value: String(p.id), label: p.name }) },
    ]))
  })
  /* QQ 音乐这边付费歌一定拿不到地址：连播时先把它们剔掉，
   * 不然列表尾巴上全是在“自动跳过”，看上去就像卡在最后几首 */
  const playable = onQQ ? songs.filter((s) => s.free !== false) : songs
  if (playable.length) {
    const bar = document.createElement('div')
    bar.className = 'music-batch'
    const all = document.createElement('button')
    all.className = 'ghost-btn small'
    all.textContent = `▶ 连播这 ${playable.length} 首`
    all.onclick = () => playSongs(playable, `单曲 · ${kw}`, 0)
    bar.appendChild(all)
    const tip = document.createElement('span')
    tip.className = 'bg-tip'
    tip.textContent = onQQ && playable.length < songs.length ? `另有 ${songs.length - playable.length} 首要会员，排在后面` : '或逐首点「＋」搭自己的列表'
    bar.appendChild(tip)
    box.appendChild(bar)
  }
  songs.forEach((s) => {
    const at = playable.indexOf(s)
    box.appendChild(musicItem(s.name, `${s.artists} · ${Math.round(s.duration / 1000)}s${onQQ && s.free === false ? ' · 需会员' : ''}`, [
      { label: '播放', title: at >= 0 ? '从这首开始连播搜到的单曲' : '这首要会员，从这批里能播的那首开始', onclick: () => playSongs(playable, `单曲 · ${kw}`, Math.max(0, at)) },
      { label: '＋', title: '加进当前列表', onclick: () => addToQueue(s) },
    ]))
  })
}

// 一行条目 + 若干动作按钮（播放 / 加入 / 设为来源经常要挤在一行里）
function musicItem(name, sub, actions) {
  const row = document.createElement('div')
  row.className = 'music-item'
  const main = document.createElement('div')
  main.className = 'music-main'
  const t = document.createElement('div')
  t.className = 'music-name'
  t.textContent = name
  const s = document.createElement('div')
  s.className = 'music-sub'
  s.textContent = sub
  main.appendChild(t)
  main.appendChild(s)
  row.appendChild(main)
  actions.forEach((a) => {
    const b = document.createElement('button')
    b.className = 'ghost-btn small'
    b.textContent = a.label
    if (a.title) b.title = a.title
    b.onclick = a.onclick
    row.appendChild(b)
  })
  return row
}

$('btn-music').onclick = () => {
  // 顶栏按钮在未登录时也是可见的，先挡一下：不然 api 拿 401 会把刚打开的弹窗连同界面一起踢回登录页
  if (!token) return toast('先登录，音乐设置存在服务端的账号上')
  openMusic()
}
$('btn-music-close').onclick = closeMusic
$('music-modal').addEventListener('click', (e) => { if (e.target.id === 'music-modal') closeMusic() })
$('btn-music-save').onclick = () => {
  const v = $('music-cookie').value.trim()
  if (!v) return toast('先把 MUSIC_U 粘进来（或点「清除」删掉已存的）')
  saveMusicCfg({ musicU: v })
}
$('btn-music-clear').onclick = () => saveMusicCfg({ musicU: '' })
$('music-vol').addEventListener('input', () => {
  const v = clamp(Number($('music-vol').value) || 0, 0, 100)
  localStorage.setItem('musicVol', String(v))
  $('music-vol-text').textContent = `${v}%`
  audioEl().volume = v / 100
})

/* ---------- 标签页 ---------- */

function setMode(m, persist = true) {
  if (!['clock', 'countdown', 'stopwatch'].includes(m)) m = 'clock'
  mode = m
  selectedId = null
  if (persist) localStorage.setItem('mode', m)
  document.querySelectorAll('#tabs .tab').forEach((x) => x.classList.toggle('active', x.dataset.mode === m))
  renderTimerPanel()
  tickDisplay()
}

document.querySelectorAll('#tabs .tab').forEach((tab) => {
  tab.onclick = () => setMode(tab.dataset.mode)
})

$('btn-create').onclick = createTask
$('btn-add-friend').onclick = addFriend
$('friend-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') addFriend() })

/* ---------- 快捷键 ---------- */

document.addEventListener('keydown', (e) => {
  const tag = (e.target.tagName || '').toLowerCase()
  if (tag === 'input' || tag === 'select' || tag === 'textarea') return
  if (e.key === 'Escape') {
    // 一层层退出：手机端抽屉 > 确认框 > 休息 > 专注 > 挑战详情 > 音乐弹窗 > 发起挑战弹窗，不能一上来就把专注关掉
    if (mobDrawer) { setDrawer(false); return }
    if (!$('confirm-modal').classList.contains('hidden')) { closeConfirm(false); return }
    if (rest) { endRest(false); return }
    if (focusId) { exitFocus(); return }
    if (!$('challenge-modal').classList.contains('hidden')) { closeChallenge(); return }
    if (!$('queue-pop').classList.contains('hidden')) { toggleQueuePanel(false); return }
    if (!$('music-modal').classList.contains('hidden')) { closeMusic(); return }
    closeShare()
    return
  }
  if (e.code === 'Space' && token && mode !== 'clock') {
    e.preventDefault()
    const t = selectedTask()
    if (t) act(t.id, t.status === 'running' ? 'pause' : t.status === 'paused' ? 'resume' : 'start')
  }
  // M 切听歌：不用先选任务也不用开弹窗；Ctrl / ⌘ 的组合让给浏览器
  if ((e.key === 'm' || e.key === 'M') && token && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
    e.preventDefault()
    void toggleListen()
  }
})

/* ---------- 手机端外壳：整屏一页一个事（Alpine 绑状态，CDN 不通时退回原生绑定） ---------- */

/* 分工：Alpine 只管 view / drawer 两个状态，靠 :data-view / :data-drawer 刷到 body 上；
 * 页面长什么样全在 mobile.css 里由 body[data-view="…"] 决定。状态真源存在下面的普通变量里，
 * Alpine 只是它的绑定镜像 —— 所以 jsdelivr 不通时（离线 / 被墙）这些入口会退回原生 click，
 * 形态与功能都不缺，只少了抽屉里当前页的高亮 */
const VIEWS = { display: '时钟', tasks: '任务列表', friends: '好友', challenges: '同任务挑战' }
const mqMobile = window.matchMedia('(max-width: 760px)')
let mobView = localStorage.getItem('mView')
if (!VIEWS[mobView]) mobView = 'display'   // 旧存档里可能是 tasks 之类不认识的值
let mobDrawer = false
let shellRef = null        // Alpine 组件 init 时把自己交出来
let drawerHistory = false  // 抽屉是为「返回键先收抽屉」才垫进历史栈的那一条

const isMobile = () => mqMobile.matches

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

function setDrawer(on) {
  mobDrawer = !!on
  // 开抽屉时往历史栈垫一条，关抽屉时把它弹掉：安卓返回键 / iOS 右滑先收抽屉，而不是直接退出站点
  if (mobDrawer && !drawerHistory) { drawerHistory = true; history.pushState({ drawer: 1 }, '') }
  else if (!mobDrawer && drawerHistory) { drawerHistory = false; history.back() }
  if (shellRef) shellRef.drawer = mobDrawer
  else if (mobDrawer) document.body.dataset.drawer = 'open'
  else delete document.body.dataset.drawer
}

function goView(v) {
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
function syncDrawer() {
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

function syncMobile() {
  document.body.classList.toggle('mobile', isMobile())
  if (isMobile()) applyView(mobView, false)
  else setDrawer(false)   // 窗口拖宽了，抽屉这种形态就没意义了
}
/* 转屏 / 分屏 / 拖窗口都会改到这条断点，形态得跟着切。
 * iOS Safari 13 及以前只有旧的 addListener，不给它兜一层的话，横竖屏一切就卡在旧形态 */
if (mqMobile.addEventListener) mqMobile.addEventListener('change', syncMobile)
else if (mqMobile.addListener) mqMobile.addListener(syncMobile)

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

syncMobile()
applyView(mobView, false)
document.addEventListener('DOMContentLoaded', () => { if (!shellRef) bindShellFallback() })

/* ---------- 面板布局：抽边框拖拽重排 + 果冻/撕纸动画 ---------- */

const PANELS = ['display', 'tasks', 'friends', 'challenges']
const DEFAULT_LAYOUT = { mode: 'classic', a: ['display'], b: ['tasks', 'friends', 'challenges'], sideW: 300 }

function loadLayout() {
  let l = null
  try { l = JSON.parse(localStorage.getItem('layoutV2')) } catch { /* 数据坏了就用默认 */ }
  if (!l || !Array.isArray(l.a) || !Array.isArray(l.b)) return { ...DEFAULT_LAYOUT }
  const clean = (arr) => {
    const out = []
    arr.forEach((p) => { if (PANELS.includes(p) && !out.includes(p)) out.push(p) })
    return out
  }
  const a = clean(l.a)
  const b = clean(l.b)
  // 旧存档里没有新面板（比如 challenges）：追到最后一栏，而不是把用户排好的顺序整体重置
  PANELS.forEach((p) => { if (!a.includes(p) && !b.includes(p)) b.push(p) })
  if (!a.length) a.push('display')
  return { mode: ['classic', 'left', 'stack'].includes(l.mode) ? l.mode : 'classic', a, b, sideW: Number(l.sideW) || DEFAULT_LAYOUT.sideW }
}

let layout = loadLayout()
const panelEl = (id) => document.querySelector(`.card[data-panel="${id}"]`)
function saveLayout() { localStorage.setItem('layoutV2', JSON.stringify(layout)) }

/* ---------- 物理驱动：所有面板共用一条 rAF 心跳 ---------- */

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

function applyLayout() {
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
ghost.className = 'ghost'

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
    if (layout.mode === 'stack') { layout.a = ['display']; layout.b = ['tasks', 'friends', 'challenges'] }
    else if (layout.mode === 'left') { layout.a = ['display']; layout.b = ['tasks', 'friends', 'challenges'] }
    saveLayout(); applyLayout(); toast(`已切换为${btn.textContent}布局`)
  }
})
$('btn-layout-reset').onclick = async () => {
  if (!await confirmAction('恢复默认布局？')) return
  layout = { ...DEFAULT_LAYOUT }
  saveLayout(); applyLayout(); toast('已恢复默认布局')
}

/* ---------- 时间同步与心跳 ---------- */

async function syncTime() {
  try {
    const { now } = await fetch('/api/time').then((r) => r.json())
    offset = now - Date.now()
  } catch { /* 后端不可用时退回本地时间 */ }
}

setInterval(() => {
  if (token) { tickDisplay(); tickTaskTimes(); checkCompletion(); renderRest() }
}, 250)

setInterval(() => { if (token) { refresh(); loadFriends(); loadChallenges() } }, 5000) // 定期与后端同步
setInterval(syncTime, 60000)

/* ---------- 启动：校验登录态 ---------- */

;(async () => {
  if (!token) { showView(false); return }
  try {
    const me = await api('/api/me')
    enterApp(me.username)
  } catch {
    logout()
  }
})()
