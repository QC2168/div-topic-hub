/**
 * 采集编排层：把各源原始数据 → FeedItem（含爆发分/标签/热评）→ 落库。
 * 每个子来源独立降级，单源失败只回一条 warning，绝不拖垮整批。
 */
import type { FeedCategory, FeedItem, Platform } from '#shared/types'
import { BILI_SECTORS, fetchFans, fetchPopularVideos, fetchRankingAll, fetchSearchVideos, fetchTopComments, fetchUpRecentVideos, mergeVideos, type RawBiliVideo } from './bilibili'
import { collectRssFeeds, fetchGithubSearchFallback, fetchGithubTrending, type RawNewsItem } from './ai-news'
import { fetchArxiv } from './arxiv'
import { fetchHackerNews } from './hackernews'
import { collectHotSearch } from './hot-topic'
import { fetchHfDailyPapers, fetchHfTrendingModels, fetchHfTrendingSpaces, type RawHfItem } from './huggingface'
import { loadHubSettings, resolveRssFeeds } from './settings'
import { readFansCache, writeFansCache } from './db'
import { upsertFeedItems, pruneHotSearch } from './repo'
import { computeBadges, scoreItem } from './score'

export interface CollectOutcome {
  items: FeedItem[]
  warnings: string[]
}

const day = 86_400_000

/** 只要 30 天内的内容：过期数据对「蹭热点」毫无价值，宁可少也不掺旧 */
const MAX_AGE_MS = 30 * day
/** 单个分区低于这个条数就告警（说明上游接口异常，而不是真的没内容） */
const MIN_SECTOR_ITEMS = 8
/** 单个分区最多入库条数 */
const MAX_SECTOR_ITEMS = 50
/** B 站总入库上限（两个分区合计） */
const MAX_BILI_ITEMS = 100
/** 单轮最多补查多少个 UP 的粉丝数（有 7 天缓存兜底，正常刷新远低于这个数） */
const FAN_LOOKUP_MAX = 60

const CATEGORY_BY_SECTOR: Record<'tech' | 'knowledge', FeedCategory> = {
  tech: 'bili-tech',
  knowledge: 'bili-knowledge'
}

const delay = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

const errorText = (error: unknown): string => error instanceof Error ? error.message : String(error)

/** 单次请求级降级：失败只记一条 warning，返回兜底值。 */
async function attempt<T>(label: string, run: () => Promise<T>, warnings: string[], fallback: T): Promise<T> {
  try {
    return await run()
  } catch (error) {
    warnings.push(`${label}：${errorText(error)}`)
    return fallback
  }
}

function videoToItem(video: RawBiliVideo, category: FeedCategory, now: number): FeedItem {
  const metrics = {
    play: video.play,
    like: video.like,
    reply: video.reply,
    danmaku: video.danmaku,
    favorite: video.favorite,
    coin: video.coin,
    share: video.share,
    fans: video.fans
  }
  const scoreInput = { platform: 'bilibili' as const, metrics, publishedAt: video.publishedAt, hotBoard: video.hotBoard, now }
  return {
    id: `bili:${video.bvid}`,
    platform: 'bilibili',
    category,
    title: video.title,
    author: video.author === '' ? null : video.author,
    url: video.url,
    cover: video.cover,
    summary: video.summary,
    metrics,
    comments: [],
    badges: computeBadges(scoreInput),
    publishedAt: video.publishedAt,
    fetchedAt: new Date(now).toISOString(),
    score: scoreItem(scoreInput)
  }
}

/**
 * 采集 B 站科技区 + 知识区，并对最靠前的几条补抓高赞评论与 UP 主粉丝数。
 *
 * 数据源：综合热门（全站抓一次，按子分区拆分）+ 全站榜 + 各垂类关键词的综合排序搜索。
 * 注意这里**没有**「数据偏旧就退化为全量展示」的兜底——宁可当天没有 B 站内容，
 * 也不能把过期稿子冒充热点（这是之前把 2025 年数据顶到首页的根因）。
 *
 * 分三步走：先把原始视频攒进 pool（不打分）→ 初排后给最靠前的 UP 查粉丝数 →
 * 回填粉丝再正式算分。因为破圈倍率会影响排序，粉丝必须在定型前拿到。
 */
export async function collectBilibili(): Promise<CollectOutcome> {
  const now = Date.now()
  const settings = loadHubSettings()
  const warnings: string[] = []
  /** 原始视频 + 所属分区；粉丝数补齐后才转成 FeedItem */
  const pool: Array<{ video: RawBiliVideo, category: FeedCategory }> = []
  /** bvid → aid：评论接口要 oid（=aid），顺手留一份映射 */
  const aidByBvid = new Map<string, number>()

  // 综合热门全站抓一遍，再按 tid 白名单拆给各分区
  const popular = await attempt('B站综合热门', () => fetchPopularVideos(8), warnings, [])
  // 全站榜（rid=0）是活的，分区榜（rid=188/36）已冻结，所以只走全站榜再按 tid 筛
  const ranking = await attempt('B站全站榜', () => fetchRankingAll(), warnings, [])

  for (const sector of BILI_SECTORS) {
    const category = CATEGORY_BY_SECTOR[sector.key]
    const boards = [...popular, ...ranking]
    const fromBoard = boards.filter(video => video.tid !== null && sector.tids.has(video.tid))

    // 关键词搜索串行 + 间隔：比并发温和得多
    const searched: RawBiliVideo[] = []
    for (const [index, keyword] of sector.keywords.entries()) {
      const rows = await attempt(
        `${sector.label}搜索「${keyword}」`,
        () => fetchSearchVideos(keyword, sector.tids),
        warnings,
        [] as RawBiliVideo[]
      )
      searched.push(...rows)
      if (index < sector.keywords.length - 1) await delay(300)
    }

    const merged = mergeVideos(fromBoard, searched)

    // 硬过滤：解析不出发布时间的一律丢，超过 30 天的也丢
    const fresh = merged.filter(video =>
      video.publishedAt !== null && now - Date.parse(video.publishedAt) <= MAX_AGE_MS
    )
    const stale = merged.length - fresh.length

    if (fresh.length < MIN_SECTOR_ITEMS) {
      warnings.push(`${sector.label}仅采到 ${fresh.length} 条 30 天内内容，接口可能异常`)
    }
    if (stale > 0 && fresh.length >= MIN_SECTOR_ITEMS) {
      warnings.push(`${sector.label}丢弃 ${stale} 条超过 30 天或时间缺失的旧数据`)
    }

    for (const video of fresh) {
      pool.push({ video, category })
      if (video.aid !== undefined && Number.isFinite(video.aid)) aidByBvid.set(video.bvid, video.aid)
    }
  }

  // 自定义关注的 UP 主：拉近期投稿，按分区热度粗分到科技区
  if (settings.upUids.length > 0) {
    for (const uid of settings.upUids.slice(0, 10)) {
      const videos = await attempt(`UP ${uid} 投稿`, () => fetchUpRecentVideos(uid), warnings, [] as RawBiliVideo[])
      for (const video of videos) {
        pool.push({ video, category: 'bili-tech' })
        if (video.aid !== undefined && Number.isFinite(video.aid)) aidByBvid.set(video.bvid, video.aid)
      }
      await delay(150)
    }
  }

  const unique = dedupeVideos(pool)

  // 粉丝数：先读缓存（7 天有效），只给没缓存的 UP 发请求。
  // 有缓存兜着才敢把所有 UP 都补齐——否则一次刷新要多打几十个请求。
  const isMid = (mid: number | undefined): mid is number => mid !== undefined && Number.isFinite(mid) && mid > 0
  const allMids = [...new Set(unique.map(entry => entry.video.mid).filter(isMid))]
  const cachedFans = readFansCache(allMids)
  const missing = allMids.filter(mid => !cachedFans.has(mid)).slice(0, FAN_LOOKUP_MAX)

  const fetched: Array<{ mid: number, fans: number }> = []
  for (const [index, mid] of missing.entries()) {
    const fans = await attempt(`UP ${mid} 粉丝数`, () => fetchFans(mid), warnings, 0)
    if (fans > 0) fetched.push({ mid, fans })
    if (index < missing.length - 1) await delay(150)
  }
  if (fetched.length > 0) writeFansCache(fetched)

  const fansByMid = new Map<number, number>(cachedFans)
  for (const entry of fetched) fansByMid.set(entry.mid, entry.fans)
  for (const { video } of unique) {
    if (video.mid === undefined) continue
    const fans = fansByMid.get(video.mid)
    if (fans !== undefined) video.fans = fans
  }

  // 回填粉丝后正式算分（破圈倍率会影响排序），再按分区配额截断入库
  const ranked = unique
    .map(entry => videoToItem(entry.video, entry.category, now))
    .sort((a, b) => b.score - a.score)

  // 每个分区各自留前 N：纯按总分截断会让知识区把科技区挤空，两个胶囊就一边倒
  const usedBySector = new Map<FeedCategory, number>()
  const deduped = ranked
    .filter((item) => {
      const used = usedBySector.get(item.category) ?? 0
      if (used >= MAX_SECTOR_ITEMS) return false
      usedBySector.set(item.category, used + 1)
      return true
    })
    .slice(0, MAX_BILI_ITEMS)

  // 只给最靠前的 8 条补评论：够 AI 用，又不至于把 B 站打烦
  for (const item of deduped.slice(0, 8)) {
    const bvid = item.id.replace(/^bili:/, '')
    try {
      item.comments = await fetchTopComments(aidByBvid.get(bvid), 5)
    } catch {
      // 评论是加分项，失败静默
    }
    await delay(180)
  }

  return { items: deduped, warnings }
}

/** 同一视频可能同时出现在热门流、全站榜、多个关键词搜索里，优先留带热门标记的那份。 */
function dedupeVideos(pool: Array<{ video: RawBiliVideo, category: FeedCategory }>): Array<{ video: RawBiliVideo, category: FeedCategory }> {
  const map = new Map<string, { video: RawBiliVideo, category: FeedCategory }>()
  for (const entry of pool) {
    const existing = map.get(entry.video.bvid)
    if (existing === undefined || (!existing.video.hotBoard && entry.video.hotBoard)) {
      map.set(entry.video.bvid, entry)
    }
  }
  return [...map.values()]
}

function dedupe(items: FeedItem[]): FeedItem[] {
  const map = new Map<string, FeedItem>()
  for (const item of items) {
    const existing = map.get(item.id)
    if (existing === undefined || item.score > existing.score) map.set(item.id, item)
  }
  return [...map.values()]
}

interface NewsLike {
  id: string
  title: string
  author: string | null
  url: string
  summary: string
  publishedAt: string | null
  metrics: FeedItem['metrics']
}

/** GitHub 趋势 + 垂类 RSS 的公共提交逻辑。 */
function pushNews(
  items: FeedItem[],
  raw: NewsLike,
  category: FeedCategory,
  platform: Platform,
  cover: string | null,
  now: number
): void {
  const scoreInput = { platform, metrics: raw.metrics, publishedAt: raw.publishedAt, now }
  items.push({
    id: raw.id,
    platform,
    category,
    title: raw.title,
    author: raw.author,
    url: raw.url,
    cover,
    summary: raw.summary,
    metrics: raw.metrics,
    comments: [],
    badges: computeBadges(scoreInput),
    publishedAt: raw.publishedAt,
    fetchedAt: new Date(now).toISOString(),
    score: scoreItem(scoreInput)
  })
}

/** 各来源的落库分类、平台与封面规则。 */
const KIND_META: Record<RawNewsItem['kind'], { category: FeedCategory, platform: Platform, cover: (raw: RawNewsItem) => string | null }> = {
  github: {
    category: 'github',
    platform: 'github',
    cover: raw => raw.author === null ? null : `https://github.com/${raw.author}.png?size=80`
  },
  rss: { category: 'ai-news', platform: 'rss', cover: () => null },
  hn: { category: 'community', platform: 'hn', cover: () => null },
  arxiv: { category: 'paper', platform: 'arxiv', cover: () => null }
}

/**
 * 采集 AI 一侧的全部来源：GitHub 趋势（日榜/周榜/分语言）+ Hacker News + arXiv + 垂类 RSS。
 *
 * 扩容思路：能加量的地方全在**官方公开接口**上——HN 走 Algolia、arXiv 走 Atom、
 * GitHub 用页面或官方 search，都不需要绕风控，所以可以放心多拉。
 */
export async function collectAiNews(): Promise<CollectOutcome> {
  const now = Date.now()
  const settings = loadHubSettings()
  const warnings: string[] = []
  const items: FeedItem[] = []

  const sources: Array<{ label: string, run: () => Promise<RawNewsItem[]> }> = [
    { label: 'GitHub 日榜', run: () => fetchGithubTrending('daily') },
    { label: 'GitHub 周榜', run: () => fetchGithubTrending('weekly') },
    { label: 'GitHub Python 榜', run: () => fetchGithubTrending('daily', 'python') },
    { label: 'GitHub TypeScript 榜', run: () => fetchGithubTrending('daily', 'typescript') },
    { label: 'Hacker News', run: () => fetchHackerNews(60) },
    { label: 'arXiv', run: () => fetchArxiv(40) }
  ]

  const settled = await Promise.allSettled(sources.map(source => source.run()))
  let githubCount = 0
  settled.forEach((result, index) => {
    const label = sources[index]?.label ?? '未知源'
    if (result.status === 'rejected') {
      warnings.push(`${label} 采集失败：${errorText(result.reason)}`)
      return
    }
    for (const raw of result.value) {
      const meta = KIND_META[raw.kind]
      if (raw.kind === 'github') githubCount += 1
      pushNews(items, raw, meta.category, meta.platform, meta.cover(raw), now)
    }
  })

  // 四条 GitHub 链路全挂时才降级到官方 search API（覆盖不到「今日新增 star」，但至少不空手）
  if (githubCount === 0) {
    try {
      const fallback = await fetchGithubSearchFallback()
      warnings.push(`GitHub 趋势四条链路均失败，已降级到 search API（${fallback.length} 条）`)
      for (const raw of fallback) pushNews(items, raw, 'github', 'github', null, now)
    } catch (fallbackError) {
      warnings.push(`GitHub search 兜底也失败：${errorText(fallbackError)}`)
    }
  }

  // HuggingFace 三条榜：模型/Space 归到「HF 榜单」，论文并入「arXiv 新论文」。
  // 论文之所以不单开一类：它和 arXiv 都是论文，一个是精选（社区投过票）、一个是全量，
  // 放一起反而好比较——同一篇在两边都出现，说明是真的热。
  const hfSources: Array<{ label: string, run: () => Promise<RawHfItem[]>, category: FeedCategory }> = [
    { label: 'HF 趋势模型', run: () => fetchHfTrendingModels(25), category: 'ai-board' },
    { label: 'HF 趋势 Space', run: () => fetchHfTrendingSpaces(20), category: 'ai-board' },
    { label: 'HF 每日论文', run: () => fetchHfDailyPapers(30), category: 'paper' }
  ]
  const hfSettled = await Promise.allSettled(hfSources.map(source => source.run()))
  hfSettled.forEach((result, index) => {
    const meta = hfSources[index]
    if (meta === undefined) return
    if (result.status === 'rejected') {
      warnings.push(`${meta.label} 采集失败：${errorText(result.reason)}`)
      return
    }
    for (const raw of result.value) {
      pushNews(items, raw, meta.category, 'huggingface', null, now)
    }
  })

  const rss = await collectRssFeeds(resolveRssFeeds(settings))
  warnings.push(...rss.warnings)
  for (const raw of rss.items.slice(0, 180)) {
    const meta = KIND_META[raw.kind]
    pushNews(items, raw, meta.category, meta.platform, meta.cover(raw), now)
  }

  return { items: dedupe(items).sort((a, b) => b.score - a.score), warnings }
}

/* ── 按数据集编排（快照导出与站点共用） ── */

/**
 * 三个数据集：分别对应 site 上的一组分类，也对应快照里的三个 JSON 文件。
 *
 * 拆出来是为了让快照脚本能单独跑某一块（比如只想刷热搜），并且让 warnings 按数据集
 * 归因——refreshAll 原来把三块告警混成一个数组，快照里就没法说清「是哪一类出的问题」。
 */
export type DatasetId = 'bilibili' | 'ai-news' | 'hot-search'

export interface DatasetCollectResult {
  id: DatasetId
  /** 该数据集是否整体采集成功（部分子源失败仍算成功，细节在 warnings 里） */
  ok: boolean
  items: FeedItem[]
  warnings: string[]
  /** 采集耗时（毫秒） */
  ms: number
  /** 开始采集的时刻，热搜清理需要用它算「早于本次」的截止时间 */
  startedAt: number
}

const DATASETS: Record<DatasetId, { label: string, run: () => Promise<CollectOutcome> }> = {
  'bilibili': { label: 'B站', run: collectBilibili },
  'ai-news': { label: 'AI 资讯', run: collectAiNews },
  'hot-search': { label: '全网热搜', run: collectHotSearch }
}

export const DATASET_IDS = Object.keys(DATASETS) as DatasetId[]

/** 并行跑一个或多个数据集，单个失败只体现在该条结果的 ok/warnings 里，不影响其他。 */
export async function collectAll(only?: DatasetId[]): Promise<DatasetCollectResult[]> {
  const ids = only === undefined || only.length === 0 ? DATASET_IDS : only
  return Promise.all(ids.map(async (id) => {
    const startedAt = Date.now()
    const meta = DATASETS[id]
    try {
      const outcome = await meta.run()
      return { id, ok: true, items: outcome.items, warnings: outcome.warnings, ms: Date.now() - startedAt, startedAt }
    } catch (error) {
      return {
        id,
        ok: false,
        items: [],
        warnings: [`${meta.label}采集整体失败：${errorText(error)}`],
        ms: Date.now() - startedAt,
        startedAt
      }
    }
  }))
}

/** 全量采集并落库，返回条数与告警。 */
export async function refreshAll(only?: DatasetId[]): Promise<{
  bilibili: number
  aiNews: number
  hotSearch: number
  warnings: string[]
  fetchedAt: string
  /** 逐数据集的明细（快照导出要按数据集归因告警与耗时） */
  datasets: DatasetCollectResult[]
}> {
  const results = await collectAll(only)
  const warnings: string[] = []
  const counts: Record<DatasetId, number> = { 'bilibili': 0, 'ai-news': 0, 'hot-search': 0 }

  for (const result of results) {
    if (result.ok) {
      counts[result.id] = upsertFeedItems(result.items)
      // 热搜是「当下快照」而不是累积资料：不清就会越攒越多（实测微博能涨到 66 条）。
      // 只删早于本次采集的记录，所以只在采集成功后调用——失败还删就变成「一出错页面就空了」。
      if (result.id === 'hot-search') pruneHotSearch(new Date(result.startedAt - 1_000).toISOString())
    }
    warnings.push(...result.warnings)
  }

  return {
    bilibili: counts.bilibili,
    aiNews: counts['ai-news'],
    hotSearch: counts['hot-search'],
    warnings,
    fetchedAt: new Date().toISOString(),
    datasets: results
  }
}
