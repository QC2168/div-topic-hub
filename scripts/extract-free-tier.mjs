/**
 * 一次性迁移脚本：把 server/utils/free-tier.ts 里的静态数据抽到 data/free-tier.json。
 * 跑一次就够，留着是为了下回数据搬家还能用。
 *
 *   node scripts/extract-free-tier.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = readFileSync(join(root, 'server/utils/free-tier.ts'), 'utf8')

/** 从 TS 源里抠出 `NAME: 类型 = [ ... ];` 的数组字面量，按对象的一个键 eval 出来。 */
function cutArray(name) {
  const start = src.indexOf(`${name}:`)
  if (start === -1) throw new Error(`找不到 ${name}`)
  const bracket = src.indexOf('[', start)
  let depth = 0
  let end = -1
  for (let i = bracket; i < src.length; i++) {
    if (src[i] === '[') depth++
    else if (src[i] === ']') {
      depth--
      if (depth === 0) {
        end = i
        break
      }
    }
  }
  const body = src.slice(bracket, end + 1)
  // TS 数组字面量本身是合法 JS（对象键都带引号或是不带引号的合法标识符）
  // eslint-disable-next-line no-new-func
  return Function(`"use strict"; return (${body})`)()
}

function cutObject(name) {
  const start = src.indexOf(`${name}:`)
  if (start === -1) throw new Error(`找不到 ${name}`)
  const brace = src.indexOf('{', start)
  let depth = 0
  let end = -1
  for (let i = brace; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}') {
      depth--
      if (depth === 0) {
        end = i
        break
      }
    }
  }
  const body = src.slice(brace, end + 1)
  // eslint-disable-next-line no-new-func
  return Function(`"use strict"; return (${body})`)()
}

function cutString(name) {
  const m = src.match(new RegExp(`${name}\\s*=\\s*'([^']+)'`))
  if (!m) throw new Error(`找不到 ${name}`)
  return m[1]
}

const data = {
  verifiedAt: cutString('TIER_VERIFIED_AT'),
  // 作者信息（可选）：mid = B站用户号，bvid = 绑定的投稿视频。留空则 Toy 里不显示关注入口。
  author: { mid: '', name: '', bvid: '', aid: 0 },
  domesticApp: cutArray('DOMESTIC_APP_RAW'),
  domesticApi: cutArray('DOMESTIC_API_RAW'),
  overseasPlatforms: cutArray('OVERSEAS_RAW'),
  mediaByPlatform: cutObject('MEDIA_BY_PLATFORM')
}

const out = join(root, 'data/free-tier.json')
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, JSON.stringify(data, null, 2) + '\n', 'utf8')

const n = data.domesticApp.length + data.domesticApi.length + data.overseasPlatforms.length
console.log(`已写出 ${out}`)
console.log(`  verifiedAt = ${data.verifiedAt}`)
console.log(`  国内应用 ${data.domesticApp.length} · 国内 API ${data.domesticApi.length} · 海外平台 ${data.overseasPlatforms.length} · 共 ${n} 条`)
