/**
 * 快照生成器：把当前信息流导出成 `data/snapshots/*.json`，供静态端点与 agent skill 消费。
 *
 * 为什么要有这一层：`/api/feed` 得跑 Node 进程，而 GitHub Pages 只能托管静态文件。
 * 但这份数据本来每天只变几次，**快照 + fetchedAt 足够让消费方自己判断新鲜度**，
 * 为此养一台服务器不值。导出成文件之后：网站、B站 Toy、任意 agent 读的是同一份契约。
 *
 *   bun scripts/collect-snapshot.ts                # 真采集 → 落库 → 导出（默认）
 *   bun scripts/collect-snapshot.ts --probe        # 只探活：逐数据集打印条数与耗时，不写库不落盘
 *   bun scripts/collect-snapshot.ts --from-db      # 不采集，只读现有 SQLite 重新导出
 *   bun scripts/collect-snapshot.ts --only hot-search
 *   bun scripts/collect-snapshot.ts --force        # 跳过阈值守卫
 *
 * ── 只能用 Bun 跑 ──
 * 采集器用的是无扩展名相对导入（`./db`、`./score`），Node 的 type stripping 不做
 * specifier 解析，实测 `node --experimental-strip-types` 会 ERR_MODULE_NOT_FOUND。
 * Bun 原生支持，且不需要 node_modules（server/utils 下零 npm 依赖）。
 *
 * ── 阈值守卫的语义：不覆盖，而不是中止 ──
 * 条数掉到上次的一半以下时，**保留上一次的文件不动**。这样上游抽风时线上继续是旧的好数据，
 * 而不会因为一个源挂了就让所有数据集一起停更。反过来，如果全部数据集都被守卫拦下，
 * 进程以 1 退出，让 CI 变红报警。
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { FeedCategory, FeedItem, Platform } from '../shared/types'
import { collectAll, refreshAll, type DatasetId } from '../server/utils/collect'
import { listAllFeedItems } from '../server/utils/repo'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = join(ROOT, 'data/snapshots')

/* ── 数据集定义 ── */

interface DatasetSpec {
  id: DatasetId
  name: string
  description: string
  categories: FeedCategory[]
  /** 超过这个分钟数就算「陈旧」。热搜掉得比视频快得多，所以分开给。 */
  staleAfterMinutes: number
  /** 绝对下限：低于它一律不覆盖，防止空文件把线上打空 */
  floor: number
  /** 分区下限：某一类掉下去也要拦（总量够不代表结构没坏） */
  categoryFloors?: Partial<Record<FeedCategory, number>>
  /** 平台下限：热搜按平台分别兜 */
  platformFloors?: Partial<Record<Platform, number>>
}

const SPECS: DatasetSpec[] = [
  {
    id: 'bilibili',
    name: 'B站黑马',
    description: 'B 站科技区/知识区的上升期视频，按「播放速度 × 互动率 × 新鲜度」算爆发分排序',
    categories: ['bili-tech', 'bili-knowledge'],
    staleAfterMinutes: 1440,
    floor: 40,
    categoryFloors: { 'bili-tech': 10, 'bili-knowledge': 10 }
  },
  {
    id: 'ai-news',
    name: 'AI 与开发者资讯',
    description: 'GitHub 飙升、AI 快讯（官方 RSS）、Hacker News、arXiv 新论文、HuggingFace 榜单五类合并',
    categories: ['github', 'ai-news', 'community', 'paper', 'ai-board'],
    staleAfterMinutes: 1440,
    floor: 120
  },
  {
    id: 'hot-search',
    name: '全网热搜',
    description: '抖音热榜、微博热搜、百度热搜的当下快照。只有热度与名次，没有播放量与发布时间',
    categories: ['hot-search'],
    staleAfterMinutes: 120,
    floor: 60,
    platformFloors: { douyin: 15, weibo: 15, baidu: 15 }
  }
]

/* ── 参数 ── */

interface Args {
  probe: boolean
  fromDb: boolean
  force: boolean
  only: DatasetId[]
}

function parseArgs(argv: string[]): Args {
  const known: DatasetId[] = ['bilibili', 'ai-news', 'hot-search']
  const args: Args = { probe: false, fromDb: false, force: false, only: [] }

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (token === '--probe') args.probe = true
    else if (token === '--from-db') args.fromDb = true
    else if (token === '--force') args.force = true
    else if (token === '--only') {
      const value = argv[i + 1]
      if (value === undefined || !known.includes(value as DatasetId)) {
        throw new Error(`--only 需要 bilibili / ai-news / hot-search 之一，收到：${String(value)}`)
      }
      args.only.push(value as DatasetId)
      i += 1
    } else if (token.startsWith('--only=')) {
      const value = token.slice('--only='.length)
      if (!known.includes(value as DatasetId)) throw new Error(`--only 不认识 ${value}`)
      args.only.push(value as DatasetId)
    } else if (token.startsWith('-')) {
      throw new Error(`未知参数：${token}`)
    }
  }
  return args
}

/* ── 工具 ── */

const iso = (): string => new Date().toISOString()

/** sha256 只覆盖「数据集 + 条数 + 内容」，**刻意排除时间戳**——否则每天都算“变了”，去重失效。 */
function contentHash(id: DatasetId, items: FeedItem[]): string {
  const canonical = JSON.stringify({ dataset: id, count: items.length, items })
  return `sha256:${createHash('sha256').update(canonical).digest('hex').slice(0, 16)}`
}

function snapshotPath(id: DatasetId): string {
  return join(OUT_DIR, `${id}.json`)
}

function readPrevious(id: DatasetId): { count: number } | null {
  const file = snapshotPath(id)
  if (!existsSync(file)) return null
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as { count?: unknown }
    return typeof parsed.count === 'number' ? { count: parsed.count } : null
  } catch {
    // 文件坏了就当没有基线——守卫会退化成只看绝对下限，不至于因此不出数据
    return null
  }
}

/** 同目录 rename 在 Windows 上也是原子的，不会留下半截文件被 CI 读到 */
function writeAtomic(file: string, data: string): void {
  mkdirSync(dirname(file), { recursive: true })
  const tmp = `${file}.tmp-${process.pid}`
  writeFileSync(tmp, data, 'utf8')
  renameSync(tmp, file)
}

function fail(message: string): never {
  console.error(`✗ ${message}`)
  process.exit(1)
}

/* ── 主流程 ── */

const args = parseArgs(process.argv.slice(2))
const picked = args.only.length > 0 ? SPECS.filter(spec => args.only.includes(spec.id)) : SPECS
if (picked.length === 0) fail('没有匹配的数据集')

/* 模式一：探针。只在内存里跑采集，不写库不落盘，用来确认当前网络能不能拿到各家数据。 */
if (args.probe) {
  console.log(`探针模式：逐数据集采集一次，不写库不落盘（${picked.length} 个）\n`)
  const results = await collectAll(picked.map(spec => spec.id))
  for (const result of results) {
    const spec = picked.find(item => item.id === result.id)
    const mark = result.ok ? '✓' : '✗'
    console.log(`${mark} ${result.id.padEnd(11)} 条数 ${String(result.items.length).padStart(4)} · 耗时 ${String(result.ms).padStart(6)}ms · 下限 ${spec?.floor ?? '?'}`)
    for (const warning of result.warnings) console.log(`    ⚠ ${warning}`)
  }
  const dead = results.filter(result => !result.ok)
  console.log(`\n探针结束：${results.length - dead.length}/${results.length} 个数据集可用`)
  process.exit(dead.length === results.length ? 1 : 0)
}

/* 模式二：真采集。refreshAll 会顺带落库，之后 --from-db 才有东西可读。 */
const collected = new Map<DatasetId, { ok: boolean, ms: number, warnings: string[] }>()
if (!args.fromDb) {
  console.log(`采集 ${picked.map(spec => spec.id).join(' / ')} …`)
  const collectStartedAt = Date.now()
  const refreshed = await refreshAll(picked.map(spec => spec.id))
  for (const result of refreshed.datasets) {
    collected.set(result.id, { ok: result.ok, ms: result.ms, warnings: result.warnings })
  }
  console.log(`采集完成，用时 ${Math.round((Date.now() - collectStartedAt) / 1000)}s`)
}

/* 模式三/四：读库导出。--from-db 直接走这里，真采集之后也走这里（口径统一）。 */
let written = 0
let unchanged = 0
let guarded = 0
let missing = 0

for (const spec of picked) {
  const collectInfo = collected.get(spec.id)
  const mode = args.fromDb ? 'from-db' : 'refresh'
  const warnings: string[] = [...(collectInfo?.warnings ?? [])]

  if (!args.fromDb && collectInfo !== undefined && !collectInfo.ok) {
    // 采集整块失败：不写文件，让它保持上一版
    console.log(`✗ ${spec.id}：采集失败，保留上次快照`)
    if (collectInfo.warnings[0] !== undefined) console.log(`    ⚠ ${collectInfo.warnings[0]}`)
    guarded += 1
    continue
  }

  const items = listAllFeedItems({ categories: spec.categories })
  if (items.length === 0) {
    console.log(`✗ ${spec.id}：库里没有数据，跳过`)
    missing += 1
    continue
  }

  /* 阈值守卫 */
  const previous = readPrevious(spec.id)
  const counts: Record<string, number> = {}
  for (const item of items) counts[item.category] = (counts[item.category] ?? 0) + 1

  const problems: string[] = []
  if (items.length < spec.floor) problems.push(`条数 ${items.length} 低于绝对下限 ${spec.floor}`)
  for (const [category, floor] of Object.entries(spec.categoryFloors ?? {})) {
    const actual = counts[category] ?? 0
    if (actual < floor) problems.push(`分类 ${category} 只有 ${actual} 条（下限 ${floor}）`)
  }
  if (spec.platformFloors !== undefined) {
    const byPlatform: Record<string, number> = {}
    for (const item of items) byPlatform[item.platform] = (byPlatform[item.platform] ?? 0) + 1
    for (const [platform, floor] of Object.entries(spec.platformFloors)) {
      const actual = byPlatform[platform] ?? 0
      if (actual < floor) problems.push(`平台 ${platform} 只有 ${actual} 条（下限 ${floor}）`)
    }
  }

  const ratio = previous === null ? 1 : items.length / previous.count
  const hardBlock = problems.length > 0 || ratio < 0.5
  const softWarn = !hardBlock && previous !== null && ratio < 0.8

  if (hardBlock && !args.force) {
    for (const problem of problems) console.log(`✗ ${spec.id}：${problem}`)
    if (ratio < 0.5 && previous !== null) {
      console.log(`✗ ${spec.id}：条数较上次骤降 ${previous.count} → ${items.length}（${Math.round(ratio * 100)}%），保留上次快照`)
    }
    guarded += 1
    continue
  }
  if (softWarn) {
    warnings.push(`条数较上次下降 ${previous.count} → ${items.length}（${Math.round(ratio * 100)}%），上游可能部分失败`)
  }

  const hash = contentHash(spec.id, items)
  const previousFile = snapshotPath(spec.id)
  if (existsSync(previousFile)) {
    try {
      const old = JSON.parse(readFileSync(previousFile, 'utf8')) as { contentHash?: unknown }
      if (old.contentHash === hash) {
        console.log(`= ${spec.id}：内容未变化（${items.length} 条），不重写`)
        unchanged += 1
        continue
      }
    } catch {
      // 旧文件坏了，直接覆盖
    }
  }

  const fetchedTimes = items.map(item => Date.parse(item.fetchedAt)).filter(value => Number.isFinite(value))
  const fetchedAt = fetchedTimes.length > 0 ? new Date(Math.max(...fetchedTimes)).toISOString() : iso()

  const payload = {
    schema: 'div-topic-hub/v1',
    dataset: spec.id,
    name: spec.name,
    description: spec.description,
    generatedAt: iso(),
    fetchedAt,
    mode,
    count: items.length,
    counts,
    staleAfterMinutes: spec.staleAfterMinutes,
    ageMinutes: Math.max(0, Math.round((Date.now() - Date.parse(fetchedAt)) / 60_000)),
    contentHash: hash,
    collectMs: collectInfo?.ms ?? null,
    warnings,
    items
  }

  // 2 空格缩进而不是压成一行：这份文件每天要进 git，压成一行等于让 diff 失去意义
  writeAtomic(snapshotPath(spec.id), `${JSON.stringify(payload, null, 2)}\n`)
  const kb = Math.round(Buffer.byteLength(JSON.stringify(payload)) / 1024)
  console.log(`✓ ${spec.id}：${items.length} 条 · ${kb} KB · ${hash.slice(7, 15)}`)
  for (const warning of warnings) console.log(`    ⚠ ${warning}`)
  written += 1
}

console.log(`\n写出 ${written} 个 · 未变化 ${unchanged} 个 · 守卫拦下 ${guarded} 个 · 无数据 ${missing} 个`)

// 全部数据集都没产出（既没写也没旧的可用）才算失败；部分被守卫拦下时构建仍应继续，
// 让 build-site 用上一版文件发布，避免一个源抽风导致整站停更。
if (written === 0 && unchanged === 0) {
  fail('本轮没有可用的快照，检查采集结果或先跑一次 --probe')
}

// 被守卫拦下时给 CI 留一条 annotation，肉眼能看见但不阻断发布
if (guarded > 0) console.log(`::warning::有 ${guarded} 个数据集未更新，线上将沿用上一版快照`)
