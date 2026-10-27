/* ---------- lib/store.js：抗损坏的 JSON 存储 ----------
 * 三条原则：
 *   1. 内存数组是唯一真源，磁盘只是它的快照。接口里的“读-改-写”全在同步代码里完成，
 *      不再各请求独立读文件后互相覆盖（并发注册丢掉账号就是这么来的）。
 *   2. 原子落盘：先写 .tmp 并 fsync，确认进磁盘后再改名替换，
 *      断电或强杀进程都不会留下半截 JSON。
 *   3. 每次替换把旧主文件转成 .bak；主文件真坏了就自动回滚到备份，
 *      坏内容改名留档成 .bad-*，绝不静默清空用户数据。
 * 只用 node:fs / node:path，无第三方依赖。
 */
const fs = require('fs')
const path = require('path')

const log = (...a) => console.log('[store]', ...a)

function readText(file) {
  try {
    return fs.readFileSync(file, 'utf8')
  } catch {
    return null
  }
}

// 空文件多半是写到一半被打断，不能当作“合法的列表”
function parseList(text) {
  if (text === null || !text.trim()) return null
  try {
    const v = JSON.parse(text)
    return Array.isArray(v) ? v : null
  } catch {
    return null
  }
}

// 坏文件留档而非删除，人工还能捞回来
function quarantine(file) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  try {
    fs.renameSync(file, `${file}.bad-${stamp}`)
    log(`损坏的 ${path.basename(file)} 已留档为 ${path.basename(file)}.bad-${stamp}`)
  } catch {
    /* 留档失败也不能抛，后面照常走备份恢复 */
  }
}

class Store {
  constructor(file, { fallback = [], validate = null } = {}) {
    this.file = file
    this.name = path.basename(file)
    this.fallback = fallback
    this.validate = validate // (item) => boolean，用于剔除结构不完整的记录
    this.cache = null
    this.snapshot = null // 当前已落盘的内容，用来跳过无意义的重复写
    this.repairs = 0
    this.dropped = 0
  }

  /* 首次访问：主文件 -> .tmp -> .bak，取第一个能解析的；全都坏则从空列表开始 */
  _load() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true })
    const order = [this.file, this.file + '.tmp', this.file + '.bak']
    let picked = null
    let pickedFrom = null
    for (const f of order) {
      if (!fs.existsSync(f)) continue
      const data = parseList(readText(f))
      if (data && !picked) {
        picked = data
        pickedFrom = f
      } else if (!data) {
        quarantine(f)
      }
    }
    if (picked && this.validate) {
      const ok = picked.filter((x) => x && this.validate(x))
      this.dropped = picked.length - ok.length
      picked = ok
    }
    if (picked && pickedFrom !== this.file) {
      this.repairs++
      log(`已从 ${path.basename(pickedFrom)} 恢复 ${this.name}（${picked.length} 条）`)
    }
    this.cache = picked || this.fallback.slice()
    this.snapshot = null
    // 恢复出来的结果立刻固化成主文件，下次启动就不必再走一遍抢救
    if (picked && pickedFrom !== this.file) this.save()
    return this.cache
  }

  get data() {
    if (this.cache === null) this._load()
    return this.cache
  }

  /* 原子写：内容没变就不碰磁盘；写完 fsync 再改名 */
  save() {
    const text = JSON.stringify(this.data, null, 2) + '\n'
    if (text === this.snapshot) return false
    const tmp = this.file + '.tmp'
    const fd = fs.openSync(tmp, 'w')
    try {
      fs.writeFileSync(fd, text, 'utf8')
      fs.fsyncSync(fd) // 确认落盘后再替换，缓存里的“已保存”才当得了真
    } finally {
      fs.closeSync(fd)
    }
    if (fs.existsSync(this.file)) fs.renameSync(this.file, this.file + '.bak')
    fs.renameSync(tmp, this.file)
    this.snapshot = text
    return true
  }

  /* 同步改内存再落盘；mutator 显式 return false 表示放弃本次修改 */
  update(mutator) {
    const r = mutator(this.data)
    if (r !== false) this.save()
    return r
  }

  /* 启动自检：把三份数据的现状摊开来说清楚 */
  info() {
    const list = this.data
    const notes = []
    if (this.repairs) notes.push(`已自愈 ${this.repairs} 次`)
    if (this.dropped) notes.push(`剔除不完整记录 ${this.dropped} 条`)
    return { name: this.name, count: list.length, notes }
  }
}

module.exports = { Store }
