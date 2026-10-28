/* ---------- 播放列表：除了“来源”，还能自己拼（搜到的单曲连播、逐首加、点谁播谁） ---------- */

import { $, token } from './state.js'
import { toast } from './ui.js'
import { clamp } from './background.js'
import { api } from './utils.js'
import { PLAY_MODES, fmtSongTime, music, musicStop, playCurrent, playMode, queue, renderMusicBar, saveQueue, setPlayMode, setQueue, syncQueueRows, unlockAudio } from './music.js'

/* 把一批歌直接当成当前列表并从第 startIndex 首开始放：
 * 不必先“设为来源”，搜到的单曲、别人的歌单点了就能连播 */
export async function playSongs(list, name, startIndex = 0) {
  if (!token) return toast('先登录，音乐设置存在服务端的账号上')
  if (!list || !list.length) return toast('这批里没有能播的曲目')
  unlockAudio()
  music.owner = 'user'
  setQueue({ kind: 'songs', name: String(name || '播放列表').slice(0, 40), playlistId: 0, tracks: list.slice(), offset: 0 })
  music.i = clamp(startIndex, 0, list.length - 1)
  music.tries = 0
  music.warn = ''
  music.pool = []
  music.hist = []
  playCurrent()
  toast(`开始放：${queue.tracks[music.i].name}（共 ${queue.tracks.length} 首）`)
}

/* 点搜索结果里的歌单：只拿它的曲目当列表，不动“休息时放什么”的配置 */
export async function playPlaylistNow(p) {
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
export function addToQueue(s) {
  if (!token) return toast('先登录')
  if (!queue || !queue.tracks.length) {
    setQueue({ kind: 'songs', name: '我的列表', playlistId: 0, tracks: [s], offset: 0 })
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

export function cyclePlayMode() {
  const next = PLAY_MODES[(PLAY_MODES.indexOf(playMode()) + 1) % PLAY_MODES.length]
  if (next === 'shuffle') { music.pool = []; music.hist = [] }
  setPlayMode(next)
  toast(next === 'one' ? '单曲循环：这一首反复放' : next === 'shuffle' ? '随机：一轮内不重复放' : '顺序：放完一首放下一首')
}

export function toggleQueuePanel(open) {
  const show = open === undefined ? $('queue-pop').classList.contains('hidden') : !!open
  $('queue-pop').classList.toggle('hidden', !show)
  $('btn-rm-queue').classList.toggle('on', show && !!queue)
  if (show) renderQueuePanel()
}

/* 队列面板：整列展开，点一行就切到那首，能单删。
 * 没这个面板的话，搜到的歌只能顺着听，“只能顺序播放”就是这么来的 */
export function renderQueuePanel() {
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
