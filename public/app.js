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
  selectedId = null
  showView(false)
}

async function enterApp(username) {
  showView(true)
  $('user-name').textContent = username || ''
  setMode(mode, false)
  applyLayout() // 可见后重排一次，保证拖拽限位基于真实尺寸
  await syncTime()
  await Promise.all([refresh(), loadFriends()])
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
  renderTasks()
  renderTimerPanel()
}

async function act(id, action) {
  try {
    await api(`/api/tasks/${id}/action`, { method: 'POST', body: JSON.stringify({ action }) })
    await refresh()
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
  selectedId = selectedId === id ? null : id
  renderTasks()
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
  if (!await confirmAction(`解除与「${name}」的好友关系？相关共享任务将撤回。`)) return
  try {
    await api(`/api/friends/${id}`, { method: 'DELETE' })
    toast('已解除好友')
    await Promise.all([loadFriends(), refresh()])
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

/* ---------- 任务共享 ---------- */

let shareTaskId = null

function openShare(taskId) {
  shareTaskId = taskId
  const t = tasks.find((x) => x.id === taskId)
  $('share-task-name').textContent = t ? t.name : ''
  renderShareModal()
  $('share-modal').classList.remove('hidden')
}

function closeShare() {
  shareTaskId = null
  $('share-modal').classList.add('hidden')
}

function renderShareModal() {
  const box = $('share-friends')
  box.innerHTML = ''
  const t = tasks.find((x) => x.id === shareTaskId)
  if (!t) return
  if (!friends.friends.length) {
    box.innerHTML = '<div class="empty-tip">还没有好友，先在右侧添加好友</div>'
    return
  }
  friends.friends.forEach((f) => {
    const shared = (t.shareWith || []).includes(f.id)
    const chip = document.createElement('button')
    chip.className = 'share-chip' + (shared ? ' on' : '')
    chip.textContent = shared ? `✓ ${f.username}` : f.username
    chip.onclick = async () => {
      try {
        if (shared) await api(`/api/tasks/${t.id}/unshare`, { method: 'POST', body: JSON.stringify({ from: f.id }) })
        else await api(`/api/tasks/${t.id}/share`, { method: 'POST', body: JSON.stringify({ to: f.id }) })
        await refresh()
        renderShareModal()
      } catch (e) { toast(e.message) }
    }
    box.appendChild(chip)
  })
}

$('btn-share-close').onclick = closeShare
$('share-modal').addEventListener('click', (e) => { if (e.target.id === 'share-modal') closeShare() })

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
  controls.innerHTML = ''
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
  if (!t) return
  if (t.shared) return // 好友共享的任务只读

  const btn = (label, onclick, solid) => {
    const b = document.createElement('button')
    b.className = 'ctrl-btn' + (solid ? ' solid' : '')
    b.textContent = label
    b.onclick = onclick
    controls.appendChild(b)
  }
  if (t.status === 'stopped') btn('开始', () => act(t.id, 'start'), true)
  else if (t.status === 'running') btn('暂停', () => act(t.id, 'pause'), true)
  else if (t.status === 'paused') btn('继续', () => act(t.id, 'resume'), true)
  if (t.status !== 'stopped') {
    btn('重置', () => act(t.id, 'reset'))
    btn('删除', () => deleteTask(t.id))
  }
}

function tickDisplay() {
  const now = new Date(serverNow())
  updateToday(now)
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
  subTime.textContent = t.shared ? `${t.name} · 来自 ${t.sharedBy}` : `${t.name} · ${st.sub}`
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
    if (t.type !== 'countdown' || t.shared) return
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
  const own = tasks.filter((t) => !t.shared).sort(sortFn)
  const sharedList = tasks.filter((t) => t.shared).sort(sortFn)

  if (sharedList.length) {
    if (own.length) taskList.appendChild(groupLabel('我的任务'))
    own.forEach((t) => taskList.appendChild(taskItem(t)))
    taskList.appendChild(groupLabel('好友共享'))
    sharedList.forEach((t) => taskList.appendChild(taskItem(t)))
  } else {
    own.forEach((t) => taskList.appendChild(taskItem(t)))
  }
}

function groupLabel(text) {
  const d = document.createElement('div')
  d.className = 'group-label'
  d.textContent = text
  return d
}

function taskItem(t) {
  const div = document.createElement('div')
  div.className = 'task-item' + (t.id === selectedId ? ' selected' : '') + (t.shared ? ' shared' : '')

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
  if (t.shared) {
    const tag = document.createElement('span')
    tag.className = 'shared-tag'
    tag.textContent = `@${t.sharedBy}`
    actions.appendChild(tag)
  } else {
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
    const share = document.createElement('button')
    share.className = 'icon-btn'
    share.textContent = '↗'
    share.title = (t.shareWith && t.shareWith.length) ? `已共享给 ${t.shareWith.length} 人` : '共享给好友'
    share.onclick = (e) => { e.stopPropagation(); openShare(t.id) }
    actions.appendChild(share)

    const del = document.createElement('button')
    del.className = 'icon-btn'
    del.textContent = '✕'
    del.title = '删除'
    del.onclick = (e) => { e.stopPropagation(); deleteTask(t.id) }
    actions.appendChild(del)
  }
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
  if (e.key === 'Escape') { closeShare(); closeConfirm(false); return }
  if (e.code === 'Space' && token && mode !== 'clock') {
    e.preventDefault()
    const t = selectedTask()
    if (t && !t.shared) act(t.id, t.status === 'running' ? 'pause' : t.status === 'paused' ? 'resume' : 'start')
  }
})

/* ---------- 面板布局：抽边框拖拽重排 + 果冻/撕纸动画 ---------- */

const PANELS = ['display', 'tasks', 'friends']
const DEFAULT_LAYOUT = { mode: 'classic', a: ['display'], b: ['tasks', 'friends'], sideW: 300 }

function loadLayout() {
  let l = null
  try { l = JSON.parse(localStorage.getItem('layoutV2')) } catch { /* 数据坏了就用默认 */ }
  if (!l || !Array.isArray(l.a) || !Array.isArray(l.b)) return { ...DEFAULT_LAYOUT }
  const all = [...l.a, ...l.b]
  if (all.length !== PANELS.length || PANELS.some((p) => !all.includes(p))) return { ...DEFAULT_LAYOUT }
  return { mode: ['classic', 'left', 'stack'].includes(l.mode) ? l.mode : 'classic', a: l.a, b: l.b, sideW: Number(l.sideW) || DEFAULT_LAYOUT.sideW }
}

let layout = loadLayout()
const panelEl = (id) => document.querySelector(`.card[data-panel="${id}"]`)
function saveLayout() { localStorage.setItem('layoutV2', JSON.stringify(layout)) }

// FLIP：先量旧位置，改动后用 transform 播回去 —— 其他面板是被“挤开”而不是瞬移
function flip(mutate) {
  const cards = [...document.querySelectorAll('#app-view .card')]
  if ($('app-view').classList.contains('hidden')) { mutate(); return }
  const first = new Map(cards.map((c) => [c, c.getBoundingClientRect()]))
  mutate()
  const moved = []
  cards.forEach((c) => {
    if (c.classList.contains('dragging')) return
    const f = first.get(c)
    const l = c.getBoundingClientRect()
    const dx = f.left - l.left, dy = f.top - l.top
    const sx = l.width ? f.width / l.width : 1, sy = l.height ? f.height / l.height : 1
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1 && Math.abs(sx - 1) < 0.01 && Math.abs(sy - 1) < 0.01) return
    c.classList.remove('pushed')
    c.style.transition = 'none' // Invert 帧必须无过渡，否则会从新位置反向动画到旧位置
    c.style.transformOrigin = 'top left'
    c.style.transform = `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`
    moved.push(c)
  })
  if (!moved.length) return
  // 关键：强制一次回流把 Invert 帧提交给渲染器。
  // 少了这一步，下一帧的清除会与本次赋值合并到同一次样式计算，挤让位动画根本不会播放。
  void document.body.offsetHeight
  requestAnimationFrame(() => {
    moved.forEach((c) => {
      c.style.transition = '' // 交还给 .card / .pushed 的过渡
      c.classList.add('pushed')
      c.style.transform = ''
    })
    setTimeout(() => moved.forEach((c) => {
      c.classList.remove('pushed')
      c.style.transformOrigin = ''
    }), 520)
  })
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

function insertGhost(x, y) {
  const cols = [$('col-a'), $('col-b')]
  let col = cols.find((c) => {
    const r = c.getBoundingClientRect()
    return x >= r.left - 14 && x <= r.right + 14 && y >= r.top - 60 && y <= r.bottom + 60
  })
  if (!col) {
    col = cols.map((c) => ({ c, r: c.getBoundingClientRect() }))
      .sort((p, q) => Math.abs(x - (p.r.left + p.r.right) / 2) - Math.abs(x - (q.r.left + q.r.right) / 2))[0].c
  }
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
  drag = { card, ox: r.left, oy: r.top, lastX: e.clientX, lastY: e.clientY, vx: 0, vy: 0, t: performance.now() }
  ghost.style.height = `${r.height}px`
  card.parentNode.insertBefore(ghost, card)
  document.body.appendChild(card) // 移到 body，避免祖先 transform 影响 fixed 定位
  card.classList.add('dragging', 'torn')
  card.style.clipPath = tornPath()
  drag.tornAt = performance.now()
  card.style.width = `${r.width}px`
  card.style.height = `${r.height}px`
  card.style.left = `${r.left}px`
  card.style.top = `${r.top}px`
  moveDrag(e)
}

function moveDrag(e) {
  if (!drag) return
  const now = performance.now()
  const dt = Math.max(8, now - drag.t)
  drag.vx = (e.clientX - drag.lastX) / dt * 16
  drag.vy = (e.clientY - drag.lastY) / dt * 16
  drag.lastX = e.clientX; drag.lastY = e.clientY; drag.t = now
  // 撕纸：边缘每 ~110ms 换一次毛边，看起来像纸被撕着走，而不是硬贴图
  if (now - drag.tornAt > 110) {
    drag.tornAt = now
    drag.card.style.clipPath = tornPath(1.4)
  }
  // 果冻：用速度驱动拉伸/倾斜，松手自然回弹，不会生硬
  const skew = clamp(drag.vx * 0.1, -5, 5)
  const sy = clamp(1 + Math.abs(drag.vy) * 0.0014, 1, 1.05)
  const sx = clamp(1 + Math.abs(drag.vx) * 0.001, 1, 1.04)
  const tilt = clamp(drag.vx * 0.06, -2, 2)
  drag.card.style.transform = `translate(${e.clientX - drag.ox}px, ${e.clientY - drag.oy}px) skewX(${skew}deg) scale(${sx}, ${sy}) rotate(${tilt}deg)`
  insertGhost(e.clientX, e.clientY)
}

function endDrag() {
  if (!drag) return
  const { card } = drag
  drag = null // 先释放，任何情况下都不允许重入
  const from = card.getBoundingClientRect()
  const parent = ghost.parentNode || homeOf(card)
  const ref = ghost.parentNode === parent ? ghost : null
  // 先把“浮起”状态无条件清干净：宁可少一段动画，也不能留下卡在 body 上、
  // 带 fixed 定位与固定宽高的面板——那正是“两个面板占同一位置”的成因
  card.classList.remove('dragging')
  card.style.width = card.style.height = card.style.left = card.style.top = ''
  flip(() => { parent.insertBefore(card, ref); if (ghost.parentNode) ghost.remove() })
  document.querySelectorAll('.col.dropping').forEach((c) => c.classList.remove('dropping'))
  try {
    // 毛边逐帧收敛后再恢复圆角，避免“啪”一下弹齐
    card.style.clipPath = tornPath(0.7)
    setTimeout(() => {
      card.style.clipPath = tornPath(0.25)
      setTimeout(() => {
        card.style.clipPath = ''
        card.classList.remove('torn')
      }, 90)
    }, 90)
    const to = card.getBoundingClientRect()
    card.style.transformOrigin = 'top left'
    card.style.transition = 'none'
    card.style.transform = `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${from.width / to.width}, ${from.height / to.height})`
    void document.body.offsetHeight // 同 flip：不强制回流则倒放帧被合并，落位动画看不到
    requestAnimationFrame(() => {
      card.style.transition = 'transform .38s cubic-bezier(.22,1,.36,1)'
      card.style.transform = ''
      setTimeout(() => {
        card.style.transition = card.style.transformOrigin = ''
        card.classList.add('settle') // 落位果冻回弹
        setTimeout(() => card.classList.remove('settle'), 660)
      }, 390)
    })
  } catch { /* 动画出错不影响布局已复原 */ }
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
      startDrag(card, e)
      const onMove = (ev) => moveDrag(ev)
      const onUp = () => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        window.removeEventListener('pointercancel', onUp)
        window.removeEventListener('blur', onUp)
        endDrag()
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
  c.classList.remove('dragging', 'torn', 'settle', 'pushed')
  c.style.cssText = ''
})
document.querySelectorAll('#app-view .card').forEach(makeDraggable)
applyLayout()

// 列宽拖动：把另一列“挤窄”
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
    if (layout.mode === 'stack') { layout.a = ['display']; layout.b = ['tasks', 'friends'] }
    else if (layout.mode === 'left') { layout.a = ['display']; layout.b = ['tasks', 'friends'] }
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
  if (token) { tickDisplay(); tickTaskTimes(); checkCompletion() }
}, 250)

setInterval(() => { if (token) { refresh(); loadFriends() } }, 5000) // 定期与后端同步
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
