/**
 * 站点合成：把 data/snapshots/*.json 与白嫖榜单装配成 GitHub Pages 可直接托管的静态目录。
 *
 *   node scripts/build-site.mjs [--out site]
 *
 * 产物结构：
 *   site/
 *   ├── index.html                      目录页（原本根路径是 404）
 *   ├── llms.txt                        给 LLM 爬虫的入口说明
 *   ├── _headers                        从 deploy/_headers 复制（GitHub Pages 不认，Cloudflare/EdgeOne 认）
 *   └── api/
 *       ├── radar/free-tier.json        旧路径，永久保留（B站 Toy 在消费）
 *       └── v1/
 *           ├── datasets.json           数据集目录：agent 的入口，先读这里
 *           ├── bilibili.json
 *           ├── ai-news.json
 *           ├── hot-search.json
 *           └── free-tier.json          与旧路径字节相同
 *
 * 为什么 v1 是多文件而不是一个大 JSON：agent 问「今天热搜」时不该被迫下载 230KB 的
 * 论文与资讯列表。分文件之后每个语义域一次请求，CDN 也更友好。
 *
 * 本脚本零依赖，只要 Node 18+。它不采集、不联网（除了读取已经生成好的 free-tier），
 * 所以 CI 里可以在毫秒级跑完。
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outIdx = process.argv.indexOf('--out')
const outDir = outIdx !== -1 ? resolve(process.argv[outIdx + 1]) : join(root, 'site')

const SNAPSHOT_DIR = join(root, 'data/snapshots')
const FREE_TIER_LEGACY = join(outDir, 'api/radar/free-tier.json')

const BASE_URL = (process.env.HUB_PUBLIC_BASE_URL ?? 'https://qc2168.github.io/div-topic-hub').replace(/\/$/, '')
const REPO_URL = 'https://github.com/QC2168/div-topic-hub'
const DOCS_URL = `${REPO_URL}/blob/master/skills/div-topic-hub/references/data-contract.md`

const DATASET_IDS = ['bilibili', 'ai-news', 'hot-search']

function fail(message) {
  console.error(`✗ ${message}`)
  process.exit(1)
}

function writeJson(file, value, pretty = false) {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify(value, null, pretty ? 2 : 0)}\n`, 'utf8')
}

/* ── 1. 读快照 ── */

const snapshots = []
for (const id of DATASET_IDS) {
  const file = join(SNAPSHOT_DIR, `${id}.json`)
  if (!existsSync(file)) fail(`缺少快照 ${file}，先跑 \`bun run snapshot\` 或 \`bun run snapshot:db\``)
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    if (!Array.isArray(parsed.items)) fail(`${file} 里没有 items 数组`)
    snapshots.push({ id, file, data: parsed })
  } catch (error) {
    fail(`${file} 解析失败：${error instanceof Error ? error.message : String(error)}`)
  }
}

/* ── 2. 白嫖榜单：旧路径由 export-free-tier.mjs 生成，这里只做同源双写 ── */

if (!existsSync(FREE_TIER_LEGACY)) {
  fail('找不到 site/api/radar/free-tier.json，先跑 `node scripts/export-free-tier.mjs`')
}
const freeTierRaw = readFileSync(FREE_TIER_LEGACY)
const freeTier = JSON.parse(freeTierRaw.toString('utf8'))
const freeTierCount = (freeTier.domestic?.app?.length ?? 0)
  + (freeTier.domestic?.api?.length ?? 0)
  + (freeTier.overseasPlatforms?.entries?.length ?? 0)

/* ── 3. 写数据集文件 ── */

for (const snapshot of snapshots) {
  const target = join(outDir, 'api/v1', `${snapshot.id}.json`)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, `${JSON.stringify(snapshot.data, null, 2)}\n`, 'utf8')
}

// v1/free-tier.json 与旧路径**字节完全相同**：B站 Toy 已经在线上消费旧地址，
// 两个文件内容不一致就是给未来的自己埋雷。
const freeTierV1 = join(outDir, 'api/v1/free-tier.json')
mkdirSync(dirname(freeTierV1), { recursive: true })
const freeTierText = freeTierRaw.toString('utf8')
writeFileSync(freeTierV1, freeTierText, 'utf8')

/* ── 4. 目录清单 ── */

const now = Date.now()
const datasets = snapshots.map((snapshot) => {
  const data = snapshot.data
  const fetchedAt = typeof data.fetchedAt === 'string' ? data.fetchedAt : null
  const ageMinutes = fetchedAt === null ? null : Math.max(0, Math.round((now - Date.parse(fetchedAt)) / 60_000))
  const staleAfter = typeof data.staleAfterMinutes === 'number' ? data.staleAfterMinutes : 1440
  return {
    id: snapshot.id,
    name: data.name ?? snapshot.id,
    description: data.description ?? '',
    url: `/api/v1/${snapshot.id}.json`,
    schema: data.schema ?? 'div-topic-hub/v1',
    count: data.count ?? data.items.length,
    counts: data.counts ?? {},
    fetchedAt,
    ageMinutes,
    staleAfterMinutes: staleAfter,
    stale: ageMinutes === null || ageMinutes > staleAfter,
    contentHash: data.contentHash ?? null
  }
})

// free-tier 结构与其他三张表不同（不是 FeedItem 列表），单独列一条，schema 也单独标
const freeTierVerifiedAt = freeTier.domestic?.verifiedAt ?? null
datasets.push({
  id: 'free-tier',
  name: 'AI 免费额度白嫖榜单',
  description: '国内应用 / 国内开发者 API / 海外平台的免费额度与获取方式，外加 OpenRouter 实时零价模型列表',
  url: '/api/v1/free-tier.json',
  legacyUrl: '/api/radar/free-tier.json',
  schema: 'free-tier/v1',
  count: freeTierCount,
  counts: {
    domesticApp: freeTier.domestic?.app?.length ?? 0,
    domesticApi: freeTier.domestic?.api?.length ?? 0,
    overseasPlatforms: freeTier.overseasPlatforms?.entries?.length ?? 0,
    freeModels: freeTier.overseas?.models?.length ?? 0
  },
  fetchedAt: freeTierVerifiedAt,
  verifiedAt: freeTierVerifiedAt,
  ageMinutes: null,
  staleAfterMinutes: null,
  stale: false,
  contentHash: null
})

writeJson(join(outDir, 'api/v1/datasets.json'), {
  schema: 'div-topic-hub/datasets/v1',
  generatedAt: new Date().toISOString(),
  baseUrl: BASE_URL,
  docs: DOCS_URL,
  note: '所有数据集均为静态快照。stale 为 true 表示该数据集已超过 staleAfterMinutes 未更新，引用时请说明时间。',
  datasets,
  warnings: freeTier.warnings ?? []
})

/* ── 5. llms.txt ── */

const totalItems = datasets.filter(d => d.schema === 'div-topic-hub/v1').reduce((sum, d) => sum + d.count, 0)

const llms = `# div-topic-hub

> 中文互联网热点选题数据：B站黑马视频、AI 与开发者资讯、全网热搜、AI 免费额度榜单。
> 全部是**静态 JSON 快照**，每日更新一次，无鉴权、可直接 GET。数据采集自各平台公开接口。

## 数据集

${datasets.map(d => `- [${d.name}](${BASE_URL}${d.url})：${d.description}${d.count === undefined ? '' : `（${d.count} 条）`}`).join('\n')}

## 怎么用

先读目录，拿到各数据集的条数与新鲜度，再按需取具体文件：

\`\`\`bash
curl -s ${BASE_URL}/api/v1/datasets.json
curl -s ${BASE_URL}/api/v1/bilibili.json | head -c 400
\`\`\`

或者用现成的 skill（零依赖，任意 agent 可执行）：

\`\`\`bash
npx skills add QC2168/div-topic-hub -g -y
node ~/.claude/skills/div-topic-hub/scripts/hub.mjs list bilibili --limit 10
\`\`\`

## 字段

条目结构与网站前端共用同一份契约，字段说明见 ${DOCS_URL}

## 注意

- 数据是**快照不是实时**：引用时请带上 \`fetchedAt\`，并检查 \`stale\` 字段。
- 热搜类只有热度与名次，没有播放量；跨平台的热度量纲不可比。
- 条数会随上游波动，\`warnings\` 里是本次采集的降级说明。
- 本数据集共 ${totalItems} 条结构化条目（不含白嫖榜单的 ${freeTierCount} 条平台条目）。

## 许可

数据归各原始平台所有，此处仅做聚合与排序，供选题参考；转载内容请注明原平台。
`

writeFileSync(join(outDir, 'llms.txt'), llms, 'utf8')

/* ── 6. index.html（根路径原本是 404） ── */

const rows = datasets.map((d) => {
  const freshness = d.fetchedAt === null ? '未标注' : `${d.ageMinutes} 分钟前`
  const flag = d.stale === true ? ' <span class="warn">可能已过期</span>' : ''
  return `      <li>
        <a href="${d.url}"><b>${d.name}</b></a>
        <span class="meta">${d.count} 条 · ${freshness}${flag}</span>
        <p>${d.description}</p>
      </li>`
}).join('\n')

const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>div-topic-hub · 数据端点</title>
<style>
  :root { color-scheme: dark; }
  body {
    margin: 0; padding: 48px 24px; background: #0b0d10; color: #e6e8eb;
    font: 15px/1.7 ui-sans-serif, system-ui, "PingFang SC", "Microsoft YaHei", sans-serif;
  }
  main { max-width: 720px; margin: 0 auto; }
  h1 { font-size: 22px; margin: 0 0 6px; letter-spacing: .3px; }
  .sub { color: #8b949e; margin: 0 0 32px; font-size: 13px; }
  ul { list-style: none; padding: 0; margin: 0; }
  li { padding: 16px 0; border-top: 1px solid #1f242b; }
  a { color: #6cb6ff; text-decoration: none; }
  a:hover { text-decoration: underline; }
  p { margin: 4px 0 0; color: #8b949e; font-size: 13px; }
  .meta { color: #6e7681; font-size: 12px; margin-left: 10px; }
  .warn { color: #d29922; }
  code { background: #161b22; padding: 2px 6px; border-radius: 4px; font-size: 12px; color: #adbac7; }
  footer { margin-top: 32px; padding-top: 16px; border-top: 1px solid #1f242b; color: #6e7681; font-size: 12px; }
</style>
</head>
<body>
<main>
  <h1>div-topic-hub · 数据端点</h1>
  <p class="sub">静态 JSON 快照，每日 09:00（北京时间）重建一次。无鉴权，可直接 GET。</p>
  <ul>
${rows}
  </ul>
  <footer>
    程序化调用先读 <a href="/api/v1/datasets.json">datasets.json</a>；
    字段说明见 <a href="${DOCS_URL}">data-contract</a>；
    或 <code>npx skills add QC2168/div-topic-hub -g -y</code>
  </footer>
</main>
</body>
</html>
`

writeFileSync(join(outDir, 'index.html'), html, 'utf8')

/* ── 7. 静态配置与说明 ── */

const headers = join(root, 'deploy/_headers')
if (existsSync(headers)) {
  mkdirSync(outDir, { recursive: true })
  copyFileSync(headers, join(outDir, '_headers'))
} else {
  console.warn('WARN 找不到 deploy/_headers，跳过')
}

writeFileSync(join(outDir, 'README.md'), `# div-topic-hub 数据端点

本目录由 \`scripts/build-site.mjs\` 自动生成，**不要手改**。

- 源数据：仓库 \`data/snapshots/*.json\` 与 \`data/free-tier.json\`
- 入口：\`/api/v1/datasets.json\`（目录与新鲜度）
- 旧地址 \`/api/radar/free-tier.json\` 永久保留，与 \`/api/v1/free-tier.json\` 内容相同
- 字段说明：${DOCS_URL}
`, 'utf8')

/* ── 报告 ── */

const kb = path => Math.round(Buffer.byteLength(readFileSync(path)) / 1024)
console.log(`已写出 ${outDir}`)
for (const d of datasets) {
  const flag = d.stale === true ? '  ⚠ 已过期' : ''
  console.log(`  /api/v1/${d.id}.json`.padEnd(26) + `${String(d.count).padStart(4)} 条 · ${String(kb(join(outDir, 'api/v1', `${d.id}.json`))).padStart(4)} KB${flag}`)
}
console.log(`  ${'datasets.json'.padEnd(24)}${datasets.length} 个数据集`)
console.log(`  ${'llms.txt / index.html'.padEnd(24)}已生成`)
console.log('合成完成')
