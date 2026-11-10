/**
 * 数据体检：data/free-tier.json 的结构与取值范围校验。
 * CI 和导出前都会跑，坏数据进不了线上接口。
 *
 *   node scripts/validate-data.mjs
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const raw = readFileSync(join(root, 'data/free-tier.json'), 'utf8')
const data = JSON.parse(raw)

const errors = []
const warns = []
const Kinds = new Set(['daily', 'permanent', 'quota', 'trial'])
const Channels = new Set(['app', 'api'])
// media 枚举（text/image/video/audio/office）目前**没有**在这里校验，只由类型系统兜住。
// 曾经定义一个 Medias 集合却从未使用，等于给自己一个「已校验」的错觉，所以删掉了。

function checkUrl(v, label) {
  if (typeof v !== 'string' || !/^https:\/\//.test(v)) errors.push(`${label}：URL 必须是 https 开头（拿到 ${JSON.stringify(v)}）`)
}

function checkEntry(e, group, i) {
  const at = `${group}[${i}] ${e.platform || '(没写平台名)'}`
  if (!e.platform || typeof e.platform !== 'string') errors.push(`${at}：platform 必填`)
  if (!Channels.has(e.channel)) errors.push(`${at}：channel 必须是 app / api`)
  if (!Kinds.has(e.kind)) errors.push(`${at}：kind 必须是 daily / permanent / quota / trial`)
  if (!e.headline || String(e.headline).length < 4) errors.push(`${at}：headline 太短或缺`)
  if (!Array.isArray(e.details) || e.details.length === 0) warns.push(`${at}：details 为空，玩家看不到怎么领`)
  checkUrl(e.applyUrl, `${at}.applyUrl`)
  checkUrl(e.sourceUrl, `${at}.sourceUrl`)
  if (!e.note) warns.push(`${at}：note 为空，坑位提示缺失`)
}

for (const [group, key] of [['国内应用', 'domesticApp'], ['国内API', 'domesticApi'], ['海外平台', 'overseasPlatforms']]) {
  const list = data[key]
  if (!Array.isArray(list) || list.length === 0) {
    errors.push(`${group}：缺失或为空数组`)
    continue
  }
  list.forEach((e, i) => checkEntry(e, group, i))
  // 平台名不许重复——mediaByPlatform 按 platform 键映射，重名会互相覆盖
  const names = list.map(e => e.platform)
  const dup = names.filter((n, i) => names.indexOf(n) !== i)
  if (dup.length) errors.push(`${group}：平台名重复 ${[...new Set(dup)].join('、')}`)
}

if (!/^\d{4}-\d{2}-\d{2}$/.test(data.verifiedAt || '')) errors.push('verifiedAt 必须是 YYYY-MM-DD')

const mediaKeys = Object.keys(data.mediaByPlatform || {})
const platforms = [...data.domesticApp, ...data.domesticApi, ...data.overseasPlatforms].map(e => e.platform)
const orphanMedia = mediaKeys.filter(k => !platforms.includes(k))
if (orphanMedia.length) warns.push(`mediaByPlatform 里有 ${orphanMedia.length} 个键没对应任何条目（改名后忘删旧键？）：${orphanMedia.slice(0, 5).join('、')}`)

const missingMedia = platforms.filter(p => !mediaKeys.includes(p))
if (missingMedia.length) warns.push(`${missingMedia.length} 条没配 media，会按 ['text'] 兜底：${missingMedia.slice(0, 5).join('、')}`)

for (const w of warns) console.log('WARN ' + w)
for (const e of errors) console.log('ERROR ' + e)

const total = platforms.length
console.log(`共 ${total} 条 · 核实于 ${data.verifiedAt}`)
if (errors.length) {
  console.error(`\n数据体检没过：${errors.length} 个错误`)
  process.exit(1)
}
console.log('数据体检通过' + (warns.length ? `（带 ${warns.length} 条提醒）` : ''))
