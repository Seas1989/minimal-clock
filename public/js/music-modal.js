/* ----- 音乐设置弹窗 ----- */

import { $, token } from './state.js'
import { toast } from './ui.js'
import { clamp, lsNum } from './background.js'
import { api } from './utils.js'
import { audioEl, isQQ, loadMusicCfg, mp, musicCfg, queue, setMusicCfg, setQueue, startListen, syncPlayer } from './music.js'
import { addToQueue, playPlaylistNow, playSongs } from './music-queue.js'

function openMusic() {
  $('music-modal').classList.remove('hidden')
  syncMusicModal()
  loadMusicCfg()
}

export function closeMusic() { $('music-modal').classList.add('hidden') }

export function syncMusicModal() {
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
    setMusicCfg(await api('/api/music/config', { method: 'POST', body: JSON.stringify(patch) }))
    // 换了来源或平台，手上的队列就作废：曲目 id 属于原来那个平台，拿去要地址只会得到一句“ID 不对”
    if ((patch.kind != null || patch.value != null || patch.platform != null) && queue) {
      const wasPlaying = !audioEl().paused
      setQueue(null)
      localStorage.removeItem('musicQueue')
      syncPlayer()
      if (wasPlaying) void startListen()
    }
    syncMusicModal()
    return true
  } catch (e) { toast(e.message); return false }
}

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

/* 顶层接线：DOM 事件与初始渲染。原来直接摊在 app.js 顶层，
 * 拆成模块后放进 init()，由 main.js 按原文件顺序调用，避免模块求值顺序影响这些副作用。 */
export function init() {
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

}
