/**
 * 产物体检：发布前最后一道闸。坏产物绝不进 Pages。
 *
 *   node scripts/validate-site.mjs [--out site]
 *
 * 校验的是「产物本身」，不是源数据（源数据由 validate-data.mjs 管）。重点三条：
 *   1. 每个数据集 count 与实际 items 长度一致 —— 防止信封与内容脱节；
 *   2. contentHash 能复算出来 —— 防止有人手改 JSON 导致下游缓存键与内容不符；
 *   3. 两个 free-tier 文件字节相同 —— 防止新旧路径漂移，B站 Toy 读的是旧路径。
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outIdx = process.argv.indexOf('--out')
const outDir = outIdx !== -1 ? resolve(process.argv[outIdx + 1]) : join(root, 'site')

const errors = []
const warnings = []

const DATASET_IDS = ['bilibili', 'ai-news', 'hot-search']
const REQUIRED = [
  'index.html',
  'llms.txt',
  '_headers',
  'api/v1/datasets.json',
  'api/v1/bilibili.json',
  'api/v1/ai-news.json',
  'api/v1/hot-search.json',
  'api/v1/free-tier.json',
  'api/radar/free-tier.json'
]

for (const relative of REQUIRED) {
  const file = join(outDir, relative)
  if (!existsSync(file)) errors.push(`缺少文件 ${relative}`)
  else if (statSync(file).size === 0) errors.push(`${relative} 是空文件`)
}

const readJson = (relative) => {
  const file = join(outDir, relative)
  if (!existsSync(file)) return null
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch (error) {
    errors.push(`${relative} 不是合法 JSON：${error instanceof Error ? error.message : String(error)}`)
    return null
  }
}

/** 与 scripts/collect-snapshot.ts 必须完全一致的算法，否则复算必然对不上 */
function contentHash(id, items) {
  const canonical = JSON.stringify({ dataset: id, count: items.length, items })
  return `sha256:${createHash('sha256').update(canonical).digest('hex').slice(0, 16)}`
}

/* ── 数据集 ── */

const seen = []
for (const id of DATASET_IDS) {
  const data = readJson(`api/v1/${id}.json`)
  if (data === null) continue

  if (data.schema !== 'div-topic-hub/v1') errors.push(`${id}: schema 应为 div-topic-hub/v1，实际 ${String(data.schema)}`)
  if (data.dataset !== id) errors.push(`${id}: 文件内 dataset 字段是 ${String(data.dataset)}，与文件名不符`)
  if (!Array.isArray(data.items)) {
    errors.push(`${id}: 缺少 items 数组`)
    continue
  }
  if (data.items.length === 0) errors.push(`${id}: items 为空`)
  if (data.count !== data.items.length) errors.push(`${id}: count=${String(data.count)} 与实际 ${data.items.length} 条不一致`)

  const sum = Object.values(data.counts ?? {}).reduce((total, value) => total + Number(value), 0)
  if (sum !== data.items.length) errors.push(`${id}: counts 合计 ${sum} 与实际 ${data.items.length} 条不一致`)

  const recomputed = contentHash(id, data.items)
  if (data.contentHash !== recomputed) {
    errors.push(`${id}: contentHash 复算不符（文件 ${String(data.contentHash)} / 实算 ${recomputed}），说明内容被手改过`)
  }

  // 逐条最低要求：id/url 不能空，score 必须是有限数
  for (const item of data.items) {
    if (typeof item.id !== 'string' || item.id === '') {
      errors.push(`${id}: 存在没有 id 的条目`)
      break
    }
    if (typeof item.url !== 'string' || !item.url.startsWith('https://')) {
      errors.push(`${id}: 条目 ${item.id} 的 url 不是 https`)
      break
    }
    if (!Number.isFinite(item.score)) {
      errors.push(`${id}: 条目 ${item.id} 的 score 不是有限数`)
      break
    }
  }

  if (data.ageMinutes !== null && data.ageMinutes > data.staleAfterMinutes) {
    warnings.push(`${id}: 数据已 ${data.ageMinutes} 分钟未更新（阈值 ${data.staleAfterMinutes}），会标记 stale`)
  }

  seen.push(id)
}

/* ── 目录清单与产物对齐 ── */

const catalog = readJson('api/v1/datasets.json')
if (catalog !== null) {
  if (!Array.isArray(catalog.datasets)) errors.push('datasets.json: 缺少 datasets 数组')
  else {
    const listed = catalog.datasets.map(entry => entry.id)
    for (const id of [...DATASET_IDS, 'free-tier']) {
      if (!listed.includes(id)) errors.push(`datasets.json: 没有列出 ${id}`)
    }
    for (const entry of catalog.datasets) {
      if (entry.schema === 'div-topic-hub/v1') {
        const data = readJson(`api/v1/${entry.id}.json`)
        if (data !== null && entry.count !== data.items.length) {
          errors.push(`datasets.json: ${entry.id} 标称 ${entry.count} 条，实际 ${data.items.length} 条`)
        }
        if (data !== null && entry.contentHash !== data.contentHash) {
          errors.push(`datasets.json: ${entry.id} 的 contentHash 与数据文件不一致`)
        }
      }
    }
  }
}

/* ── free-tier 双写一致性 ── */

const legacy = join(outDir, 'api/radar/free-tier.json')
const modern = join(outDir, 'api/v1/free-tier.json')
if (existsSync(legacy) && existsSync(modern)) {
  const a = readFileSync(legacy)
  const b = readFileSync(modern)
  if (!a.equals(b)) errors.push('api/v1/free-tier.json 与 api/radar/free-tier.json 内容不一致（B站 Toy 读旧路径）')
}

/* ── 报告 ── */

if (warnings.length > 0) {
  for (const warning of warnings) console.warn(`::warning::${warning}`)
}
if (errors.length > 0) {
  for (const error of errors) console.error(`✗ ${error}`)
  console.error(`\n产物体检未通过：${errors.length} 个错误`)
  process.exit(1)
}

console.log(`✓ 产物体检通过：${seen.length} 个数据集 · ${REQUIRED.length} 个必需文件 · free-tier 双写一致`)
