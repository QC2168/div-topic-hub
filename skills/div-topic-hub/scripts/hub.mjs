#!/usr/bin/env node
/**
 * div-topic-hub 命令行：查询中文互联网热点选题数据。
 *
 * 零依赖，只要 Node 18+（用原生 fetch）。刻意不读本地仓库的任何文件——
 * 因为 `npx skills add` 只复制 skills/div-topic-hub/ 这一层，目录外的东西不会跟过去。
 *
 *   node hub.mjs datasets
 *   node hub.mjs list bilibili --limit 10
 *   node hub.mjs search "AI 编程" --dataset ai-news --since-hours 48
 *   node hub.mjs get bili:BV1xx411c7mD
 *   node hub.mjs free-tier --channel api
 *   node hub.mjs doctor
 *
 * 输出格式自动切换：**管道/重定向时自动 JSON**，只有直接跑在终端里才打印人类可读格式。
 * agent 调用天然走 JSON 分支，不需要记得加 --json。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

const DEFAULT_BASE = 'https://qc2168.github.io/div-topic-hub'
const CACHE_DIR = join(process.env.XDG_CACHE_HOME || join(homedir(), '.cache'), 'div-topic-hub')

/* ── 参数 ── */

const argv = process.argv.slice(2)
const flags = new Map()
const positional = []

/** 纯开关型参数：绝不能吞掉后面的位置参数（否则 `--human list bilibili` 会把 list 当成值） */
const BOOLEAN_FLAGS = new Set(['json', 'human', 'table', 'help', 'version'])

for (let i = 0; i < argv.length; i += 1) {
  const token = argv[i]
  if (token.startsWith('--')) {
    const eq = token.indexOf('=')
    if (eq !== -1) {
      flags.set(token.slice(2, eq), token.slice(eq + 1))
    } else {
      const name = token.slice(2)
      const next = argv[i + 1]
      if (!BOOLEAN_FLAGS.has(name) && next !== undefined && !next.startsWith('--')) {
        flags.set(name, next)
        i += 1
      } else {
        flags.set(name, true)
      }
    }
  } else {
    positional.push(token)
  }
}

const has = name => flags.has(name)
const str = (name, fallback = undefined) => {
  const value = flags.get(name)
  return typeof value === 'string' ? value : fallback
}
const num = (name, fallback) => {
  const value = Number(flags.get(name))
  return Number.isFinite(value) ? value : fallback
}

const BASE = (str('base') || process.env.HUB_BASE_URL || DEFAULT_BASE).replace(/\/$/, '')
const LOCAL_DIR = str('local') === undefined ? null : resolve(str('local'))
const JSON_MODE = has('json') || (has('human') || has('table') ? false : !process.stdout.isTTY)

/* ── 输出 ── */

function emit(payload, render) {
  if (JSON_MODE) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`)
    return
  }
  process.stdout.write(`${render(payload)}\n`)
}

function note(message) {
  process.stderr.write(`${message}\n`)
}

function die(message, code = 1) {
  note(`✗ ${message}`)
  process.exit(code)
}

/* ── 取数（带本地缓存与降级） ── */

function cachePath(path) {
  const name = path.replace(/^\//, '').replace(/[^a-zA-Z0-9._-]/g, '_')
  return join(CACHE_DIR, name)
}

function readCache(path) {
  const file = cachePath(path)
  if (!existsSync(file)) return null
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

function writeCache(path, value) {
  try {
    mkdirSync(CACHE_DIR, { recursive: true })
    writeFileSync(cachePath(path), JSON.stringify(value), 'utf8')
  } catch {
    // 缓存写不进去不影响主流程（只读挂载、磁盘满等）
  }
}

async function fetchJson(path, { ttlMs = 0, query = '' } = {}) {
  if (LOCAL_DIR !== null) {
    // --local <dir> 直接读本地 site/ 目录，改完数据不用先发布就能验证
    const file = join(LOCAL_DIR, path)
    if (!existsSync(file)) die(`本地文件不存在：${file}（先跑 bun run site:build）`, 2)
    return { data: JSON.parse(readFileSync(file, 'utf8')), cached: false, local: true }
  }

  const cached = ttlMs > 0 ? readCache(path) : null
  if (cached !== null) {
    const age = Date.now() - Date.parse(cached.__cachedAt ?? 0)
    if (age >= 0 && age < ttlMs) return { data: cached.data, cached: true, local: false }
  }

  const url = `${BASE}${path}${query}`
  try {
    const res = await fetch(url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(15_000)
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    writeCache(path, { __cachedAt: new Date().toISOString(), data })
    return { data, cached: false, local: false }
  } catch (error) {
    // 网络失败时退到「过期缓存」而不是直接报错：agent 拿到 3 小时前的榜单，
    // 比拿不到强得多。但必须在 stderr 和 payload 里都说清楚，不能假装是新的。
    const stale = readCache(path)
    if (stale !== null) {
      note(`⚠ 远端取数失败（${error instanceof Error ? error.message : String(error)}），使用 ${stale.__cachedAt ?? '未知时间'} 的本地缓存`)
      return { data: stale.data, cached: true, local: false, staleFallback: true }
    }
    die(`取数失败：${error instanceof Error ? error.message : String(error)}\n  地址：${url}\n  可用 HUB_BASE_URL 指向其他镜像，或用 --local <dir> 读本地产物`, 2)
  }
}

/* ── 数据集 ── */

async function loadCatalog() {
  const result = await fetchJson('/api/v1/datasets.json', { ttlMs: 5 * 60_000, query: `?t=${Date.now()}` })
  if (!Array.isArray(result.data.datasets)) die('datasets.json 结构异常：缺少 datasets 数组', 2)
  return { ...result.data, _cache: { hit: result.cached, staleFallback: result.staleFallback === true, local: result.local } }
}

async function loadDataset(id) {
  const catalog = await loadCatalog()
  const entry = catalog.datasets.find(item => item.id === id)
  if (entry === undefined) {
    die(`没有数据集 ${id}。可用：${catalog.datasets.map(item => item.id).join(', ')}`, 1)
  }
  // 内容变了 URL 就变（?v=contentHash），所以 CDN 缓存是优点而不是障碍
  const query = entry.contentHash === null ? '' : `?v=${String(entry.contentHash).replace('sha256:', '')}`
  const result = await fetchJson(entry.url, { query })
  return { entry, data: result.data, cache: { hit: result.cached, staleFallback: result.staleFallback === true, local: result.local } }
}

/* ── 人类可读渲染 ── */

function metricLine(item) {
  const m = item.metrics ?? {}
  const parts = []
  if (m.play !== undefined) parts.push(`播放 ${fmt(m.play)}`)
  if (m.like !== undefined) parts.push(`赞 ${fmt(m.like)}`)
  if (m.stars !== undefined) parts.push(`star ${fmt(m.stars)}`)
  if (m.starsToday !== undefined) parts.push(`今日 +${fmt(m.starsToday)}`)
  if (m.points !== undefined) parts.push(`分 ${fmt(m.points)}`)
  if (m.heat !== undefined) parts.push(`热度 ${fmt(m.heat)}`)
  if (m.rank !== undefined) parts.push(`第 ${m.rank} 位`)
  if (m.downloads !== undefined) parts.push(`下载 ${fmt(m.downloads)}`)
  if (m.fans !== undefined) parts.push(`粉丝 ${fmt(m.fans)}`)
  const when = item.publishedAt ?? item.fetchedAt
  return [item.platform, ...parts, when?.slice(0, 10)].filter(Boolean).join(' · ')
}

function fmt(value) {
  if (typeof value !== 'number') return String(value)
  if (value >= 100_000_000) return `${(value / 100_000_000).toFixed(1)} 亿`
  if (value >= 10_000) return `${(value / 10_000).toFixed(1)} 万`
  return String(Math.round(value * 10) / 10)
}

function renderItems(payload) {
  const lines = [`${payload.dataset.name}（${payload.count} 条 · 采集于 ${payload.fetchedAt ?? '未知'}${payload.stale ? ' · ⚠ 可能已过期' : ''}）`, '']
  payload.items.forEach((item, index) => {
    lines.push(`${String(index + 1).padStart(2)}. [${item.score.toFixed(1)}] ${item.title}`)
    lines.push(`    ${metricLine(item)}`)
    lines.push(`    ${item.url}`)
  })
  if (payload.warnings.length > 0) {
    lines.push('', '采集告警：')
    for (const warning of payload.warnings) lines.push(`  ⚠ ${warning}`)
  }
  return lines.join('\n')
}

/* ── 命令 ── */

const command = positional[0]

function parseDatasetArg() {
  const id = str('dataset') ?? positional[1]
  if (id === undefined) die('需要指定数据集：bilibili / ai-news / hot-search / free-tier', 1)
  return id
}

function shapePayload(entry, data, items, extra = {}) {
  return {
    dataset: { id: entry.id, name: entry.name, schema: entry.schema },
    count: items.length,
    fetchedAt: entry.fetchedAt ?? data.fetchedAt ?? null,
    ageMinutes: entry.ageMinutes ?? null,
    stale: entry.stale ?? false,
    staleAfterMinutes: entry.staleAfterMinutes ?? null,
    warnings: data.warnings ?? [],
    ...extra,
    items
  }
}

async function cmdDatasets() {
  const catalog = await loadCatalog()
  emit({ ...catalog, base: BASE }, (payload) => {
    const lines = [`数据源：${payload.base}`, `生成于：${payload.generatedAt}`, '']

    for (const entry of payload.datasets) {
      const age = entry.ageMinutes === null ? entry.fetchedAt ?? '未标注' : `${entry.ageMinutes} 分钟前`
      lines.push(`${entry.id.padEnd(12)} ${String(entry.count).padStart(4)} 条  ${age}${entry.stale === true ? '  ⚠ 已过期' : ''}`)
      lines.push(`             ${entry.description}`)
    }
    return lines.join('\n')
  })
}

async function cmdList() {
  const id = parseDatasetArg()
  if (id === 'free-tier') return cmdFreeTier()

  const { entry, data } = await loadDataset(id)
  let items = data.items ?? []

  const category = str('category')
  if (category !== undefined) items = items.filter(item => item.category === category)
  const platform = str('platform')
  if (platform !== undefined) items = items.filter(item => item.platform === platform)
  const minScore = num('min-score', null)
  if (minScore !== null) items = items.filter(item => item.score >= minScore)

  const limit = num('limit', 10)
  if (limit > 0) items = items.slice(0, limit)

  emit(shapePayload(entry, data, items), renderItems)
}

async function cmdSearch() {
  const query = positional[1]
  if (query === undefined || query === '') die('用法：hub.mjs search <关键词> [--dataset bilibili]', 1)

  const id = str('dataset') ?? 'bilibili'
  const { entry, data } = await loadDataset(id)
  const needle = query.toLowerCase()
  const sinceHours = num('since-hours', null)
  const since = sinceHours === null ? null : Date.now() - sinceHours * 3_600_000

  let items = (data.items ?? []).filter((item) => {
    const haystack = `${item.title} ${item.author ?? ''} ${item.summary ?? ''}`.toLowerCase()
    if (!haystack.includes(needle)) return false
    if (since === null) return true
    const at = Date.parse(item.publishedAt ?? item.fetchedAt)
    return Number.isFinite(at) && at >= since
  })

  const limit = num('limit', 20)
  if (limit > 0) items = items.slice(0, limit)

  emit(shapePayload(entry, data, items, { query }), payload => renderItems({ ...payload, dataset: { ...payload.dataset, name: `「${query}」的匹配` } }))
}

async function cmdGet() {
  const wanted = positional[1]
  if (wanted === undefined) die('用法：hub.mjs get <item-id>\n  id 形如 bili:BV1xx411c7mD / weibo:hot:某个词 / gh:owner/repo', 1)

  for (const id of ['bilibili', 'ai-news', 'hot-search']) {
    const { entry, data } = await loadDataset(id)
    const hit = (data.items ?? []).find(item => item.id === wanted)
    if (hit !== undefined) {
      emit({ dataset: { id: entry.id, name: entry.name }, item: hit }, payload => [
        `${payload.item.title}`,
        '',
        metricLine(payload.item),
        payload.item.url,
        '',
        payload.item.summary,
        '',
        `id: ${payload.item.id}`,
        `爆发分: ${payload.item.score.toFixed(1)}`,
        payload.item.badges.length > 0 ? `标签: ${payload.item.badges.map(badge => badge.label).join(' / ')}` : '',
        payload.item.comments.length > 0 ? `\n热评:\n${payload.item.comments.map(c => `  · ${c.author}（${c.likes} 赞）：${c.content}`).join('\n')}` : ''
      ].filter(Boolean).join('\n'))
      return
    }
  }
  die(`三个数据集里都没有 id = ${wanted} 的条目`, 1)
}

async function cmdFreeTier() {
  const { entry, data } = await loadDataset('free-tier')
  const channel = str('channel')
  const kind = str('kind')

  const bucket = (list, group) => (list ?? [])
    .filter(item => channel === undefined || item.channel === channel)
    .filter(item => kind === undefined || item.kind === kind)
    .map(item => ({ ...item, group }))

  const items = [
    ...bucket(data.domestic?.app, 'domesticApp'),
    ...bucket(data.domestic?.api, 'domesticApi'),
    ...bucket(data.overseasPlatforms?.entries, 'overseasPlatforms')
  ]

  const query = str('query') ?? positional[1]
  const filtered = query === undefined
    ? items
    : items.filter(item => `${item.platform} ${item.headline} ${(item.details ?? []).join(' ')}`.toLowerCase().includes(query.toLowerCase()))

  const limit = num('limit', 40)
  const shown = limit > 0 ? filtered.slice(0, limit) : filtered

  emit({
    dataset: { id: 'free-tier', name: entry.name, schema: entry.schema },
    count: shown.length,
    total: items.length,
    verifiedAt: entry.verifiedAt ?? data.domestic?.verifiedAt ?? null,
    stale: false,
    warnings: data.warnings ?? [],
    freeModels: data.overseas?.models ?? [],
    items: shown
  }, (payload) => {
    const lines = [`白嫖榜单（${payload.count}/${payload.total} 条 · 人工核实于 ${payload.verifiedAt ?? '未知'}）`, '']
    for (const item of payload.items) {
      lines.push(`[${item.channel}] ${item.platform} —— ${item.headline}`)
      if (item.gate !== undefined) lines.push(`    门槛：${item.gate}`)
      lines.push(`    ${item.applyUrl}`)
    }
    if (payload.freeModels.length > 0) {
      lines.push('', `OpenRouter 当前零价模型（${payload.freeModels.length} 个，按上下文长度排序）：`)
      for (const model of payload.freeModels.slice(0, 15)) lines.push(`  · ${model.id}（${model.contextLength ?? '?'} ctx）`)
    }
    return lines.join('\n')
  })
}

async function cmdDoctor() {
  const checks = []
  const started = Date.now()
  let catalog
  try {
    catalog = await loadCatalog()
  } catch {
    die('连不上数据端。检查 HUB_BASE_URL，或看 GitHub Actions 最近一次发布是否成功。', 2)
  }
  checks.push({ name: 'datasets.json', ok: true, ms: Date.now() - started, cache: catalog._cache })

  for (const entry of catalog.datasets) {
    try {
      const { data } = await loadDataset(entry.id)
      const count = Array.isArray(data.items) ? data.items.length : (entry.count ?? 0)
      checks.push({ name: entry.id, ok: true, count, ageMinutes: entry.ageMinutes, stale: entry.stale })
    } catch (error) {
      checks.push({ name: entry.id, ok: false, error: error instanceof Error ? error.message : String(error) })
    }
  }

  emit({ base: BASE, local: LOCAL_DIR, cacheDir: CACHE_DIR, checks }, (payload) => {
    const lines = [`地址：${payload.base}${payload.local === null ? '' : `（本地模式：${payload.local}）`}`, `缓存：${payload.cacheDir}`, '']
    for (const check of payload.checks) {
      if (!check.ok) {
        lines.push(`✗ ${check.name.padEnd(13)} ${check.error}`)
        continue
      }
      const count = check.count === undefined ? '' : `${String(check.count).padStart(4)} 条`
      const age = check.ageMinutes === undefined || check.ageMinutes === null ? '' : ` · ${check.ageMinutes} 分钟前`
      lines.push(`✓ ${check.name.padEnd(13)} ${count}${age}${check.stale === true ? ' ⚠ 已过期' : ''}${check.cache === undefined ? '' : ' · 目录已就绪'}`)
    }
    return lines.join('\n')
  })
}

/* ── 分发 ── */

const COMMANDS = {
  'datasets': cmdDatasets,
  'list': cmdList,
  'search': cmdSearch,
  'get': cmdGet,
  'free-tier': cmdFreeTier,
  'freedtier': cmdFreeTier,
  'doctor': cmdDoctor,
  'help': async () => {
    process.stdout.write(`div-topic-hub 数据查询

  hub.mjs datasets                              数据集目录与新鲜度
  hub.mjs list <dataset> [--limit 10] [--min-score 40] [--category bili-tech] [--platform bilibili]
  hub.mjs search <关键词> [--dataset ai-news] [--since-hours 48]
  hub.mjs get <item-id>
  hub.mjs free-tier [--channel app|api] [--kind daily|permanent|quota|trial] [--query 关键词]
  hub.mjs doctor                                连通性与新鲜度自检

全局：--json 强制 JSON · --base <url> 换镜像 · --local <dir> 读本地 site/ 产物
环境变量：HUB_BASE_URL

数据集：bilibili（B站黑马） · ai-news（GitHub/HN/arXiv/HF/RSS） · hot-search（抖音/微博/百度热搜） · free-tier（白嫖榜单）
`)
  }
}

if (command === undefined) {
  await COMMANDS.help()
  process.exit(0)
}

const handler = COMMANDS[command]
if (handler === undefined) {
  note(`未知命令：${command}`)
  await COMMANDS.help()
  process.exit(1)
}

await handler()
