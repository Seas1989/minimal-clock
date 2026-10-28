/* ---------- 音乐：走服务端的网易云只读代理（MUSIC_U 只存 data/，不进仓库） ----------
 * 底部播放条是全局的，任何界面都能听；只有进休息层时才会自动开始放 */

import { $, token } from './state.js'
import { toast } from './ui.js'
import { clamp, lsNum } from './background.js'
import { api } from './utils.js'
import { cyclePlayMode, renderQueuePanel, toggleQueuePanel } from './music-queue.js'
import { syncMusicModal } from './music-modal.js'
import { syncDrawer } from './mobile-shell.js'

/* 0 采样的静音 WAV：第一次播之前先用它把 <audio> “碰响”，
 * 不然等 await 拉完地址再 play()，Safari 会当成非手势调用直接拦下 */
const SILENT_WAV = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA='

export let musicCfg = null // { platform, hasCookie, cookieMask, source: { kind, value, label } }
export let queue = null    // { kind, name, playlistId, tracks[], offset }：当前的播放列表，可来自来源、搜索单曲、手动加
/* owner 决定休息结束时收不收起：'rest' 是休息自动起的（结束就替他关掉），
 * 'user' 是他自己点起来的（一直留着，切界面也不停）
 * pool / hist 只服务随机模式：pool 是本轮还没抽到的下标，hist 是去过的地方（上一首靠它往回走） */
export const music = { i: 0, tries: 0, loading: false, warn: '', owner: '', pool: [], hist: [] }

export const audioEl = () => $('music-audio')
const musicVol = () => clamp(lsNum('musicVol', 60), 0, 100) / 100
const curTrack = () => (queue && queue.tracks && queue.tracks.length ? queue.tracks[music.i] : null)
export const fmtSongTime = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

/* 当前的音乐平台：服务端配置里存的那一个，取数据的路径以它为前缀
 * （/api/netease/* 与 /api/qq/* 形状一致：search / url / queue 三件事）*/
export const mp = () => (musicCfg && musicCfg.platform === 'qq' ? 'qq' : 'netease')
export const isQQ = () => mp() === 'qq'
// 曲目 id：网易云是数字，QQ 音乐是 songmid 字符串，restoreQueue 两种都要认
const isTrackId = (v) => (Number(v) > 0 ? true : /^[A-Za-z0-9]{8,20}$/.test(String(v || '')))

/* 播放方式：顺序（放完下一首）/ 随机（一轮内不重复）/ 单曲循环 */
export const PLAY_MODES = ['order', 'shuffle', 'one']
const MODE_LABEL = { order: '顺序', shuffle: '随机', one: '单曲循环' }
const MODE_ICON = { order: '🔁', shuffle: '🔀', one: '🔂' }
export const playMode = () => (PLAY_MODES.includes(localStorage.getItem('playMode')) ? localStorage.getItem('playMode') : 'order')
export function setPlayMode(m) {
  localStorage.setItem('playMode', m)
  if (m !== 'shuffle') { music.pool = []; music.hist = [] }
  renderMusicBar()
  renderQueuePanel()
}

/* 列表存 localStorage（只存曲目摘要，不存直链——直链几小时就过期，重启时按 id 现取）：
 * 刷新后 ☰ 里的东西还在、点 ▶ 接着从这首放；点 ✕ / 退出登录就清掉，不留上一段的尾巴 */
export function saveQueue() {
  if (!queue || !queue.tracks.length) return
  try {
    localStorage.setItem('musicQueue', JSON.stringify({
      name: queue.name,
      i: music.i,
      tracks: queue.tracks.slice(0, 300).map((t) => ({ id: t.id, name: t.name, artists: t.artists, album: t.album, duration: t.duration })),
    }))
  } catch { /* 超出配额就丢了缓存，列表本身还在内存里 */ }
}

export function restoreQueue() {
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

export function unlockAudio() {
  const a = audioEl()
  if (a.dataset.unlocked === '1') return
  a.dataset.unlocked = '1'
  a.volume = 0
  a.src = SILENT_WAV
  a.play().then(() => a.pause()).catch(() => { /* 连静音都不让开就作罢，后面靠用户手点 ▶ */ })
}

export async function loadMusicCfg() {
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

export async function playCurrent() {
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
export function musicStop() {
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
export async function startListen() {
  if (!token) return toast('先登录，音乐设置存在服务端的账号上')
  unlockAudio()
  music.owner = 'user'
  const q = await loadQueue(true)
  if (q) playCurrent()
}

export async function toggleListen() {
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

export function musicAutoplay() {
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
export function syncPlayer() {
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
export function syncQueueRows() {
  if (!queue || $('queue-pop').classList.contains('hidden')) return
  const rows = $('queue-list').children
  for (let i = 0; i < rows.length; i++) rows[i].classList.toggle('on', i === music.i)
  $('queue-title').textContent = `${queue.name} · ${queue.tracks.length} 首 · ${MODE_LABEL[playMode()]}`
}

export function renderMusicBar() {
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

/* 顶层接线：DOM 事件与初始渲染。原来直接摊在 app.js 顶层，
 * 拆成模块后放进 init()，由 main.js 按原文件顺序调用，避免模块求值顺序影响这些副作用。 */
export function init() {
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

}

/* 这几个状态会被别的模块整体重新赋值。ESM 的 import 绑定只读（能读不能写），
 * 所以写一律走这里的 setter：读的人 import 名字，拿到的永远是最新值。 */
export function setMusicCfg(v) { musicCfg = v }
export function setQueue(v) { queue = v }
