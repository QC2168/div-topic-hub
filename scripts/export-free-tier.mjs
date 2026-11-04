/**
 * 静态端点导出：把 data/free-tier.json 装配成与 Nuxt 接口 /api/radar/free-tier
 * **完全同形**的 JSON，写到 site/api/radar/free-tier.json。
 *
 * 为什么要有这一步：Nuxt 版接口要跑 Node 服务，GitHub Pages / EdgeOne 静态托管
 * 跑不了。但这个接口的读流量全在 B站 Toy 端，静态文件 + 每日定时重建完全够用，
 * 还省掉一台服务器。响应体同形意味着 Toy 端和 /free 页面不用关心数据来自哪边。
 *
 *   node scripts/export-free-tier.mjs [--out site]
 *
 * OpenRouter 拉失败不阻断导出：models 给空数组 + warnings 原样写进去，
 * 前端本来就会显示「实时榜暂时拿不到」。
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outIdx = process.argv.indexOf('--out')
const outDir = outIdx !== -1 ? resolve(process.argv[outIdx + 1]) : join(root, 'site')

const data = JSON.parse(readFileSync(join(root, 'data/free-tier.json'), 'utf8'))

function withMedia(list) {
  const map = data.mediaByPlatform || {}
  return list.map(e => ({ ...e, media: map[e.platform] || ['text'] }))
}

const warnings = []
let models = []
let fetchedAt = null

try {
  const res = await fetch('https://openrouter.ai/api/v1/models?limit=1000', {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(20_000)
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const body = await res.json()
  models = (body.data || [])
    .filter(m => m.pricing?.prompt === '0' && m.pricing?.completion === '0')
    .map(m => ({
      id: m.id,
      name: m.name,
      provider: m.id.includes('/') ? m.id.slice(0, m.id.indexOf('/')) : 'unknown',
      contextLength: typeof m.context_length === 'number' ? m.context_length : null
    }))
    .sort((a, b) => (b.contextLength ?? 0) - (a.contextLength ?? 0))
  fetchedAt = new Date().toISOString()
  console.log(`OpenRouter 零价模型：${models.length} 个`)
} catch (e) {
  warnings.push(`OpenRouter 免费模型榜暂时拿不到：${e instanceof Error ? e.message : String(e)}`)
  console.warn('WARN ' + warnings[0])
}

const payload = {
  author: data.author || { mid: '', name: '', bvid: '', aid: 0 },
  overseas: {
    models,
    fetchedAt,
    rateLimitNote: '免费账号 50 次/天、20 次/分；累计充过 $10 后升到 1000 次/天'
  },
  domestic: { app: withMedia(data.domesticApp), api: withMedia(data.domesticApi), verifiedAt: data.verifiedAt },
  overseasPlatforms: { entries: withMedia(data.overseasPlatforms), verifiedAt: data.verifiedAt },
  warnings
}

const outFile = join(outDir, 'api/radar/free-tier.json')
mkdirSync(dirname(outFile), { recursive: true })
writeFileSync(outFile, JSON.stringify(payload), 'utf8')

const total = payload.domestic.app.length + payload.domestic.api.length + payload.overseasPlatforms.entries.length
console.log(`已写出 ${outFile}`)
console.log(`  条目 ${total} · 零价模型 ${models.length} · 核实于 ${data.verifiedAt}`)

// README 放进站点根，访问 JSON 的人至少知道这是什么
const readme = join(outDir, 'README.md')
if (!existsSync(readme)) {
  writeFileSync(readme, `# free-tier 数据端点\n\n本目录由 \`scripts/export-free-tier.mjs\` 自动生成，不要手改。\n\n- \`/api/radar/free-tier.json\`：白嫖榜单（B站 Toy 与 /free 页面共用）\n- 数据源在仓库 \`data/free-tier.json\`，改数据改那边\n`)
}

console.log('导出完成')
