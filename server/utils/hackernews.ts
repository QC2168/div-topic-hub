/**
 * Hacker News 采集（官方 Algolia 搜索接口，完全公开、无需鉴权）。
 *
 * 为什么不用 Firebase 官方 API：`v0/topstories.json` 只给 id，每条都要再打一次
 * `/v0/item/{id}.json`，50 条 = 51 个请求。Algolia 是 HN 官方搜索后端，一次请求
 * 回来就带 points / num_comments / created_at / url / author，礼貌度和稳定性都更好。
 *
 * 两条链路互补：
 *   - tags=front_page   首页榜，质量最高，但更新慢（半天前的帖子还在）
 *   - search_by_date    按时间倒序 + 分数门槛，抓「刚发就在涨」的新帖
 */
import type { RawNewsItem } from './ai-news'

const UA = 'topic-hub/1.0 (+local personal use)'
const HOUR = 3_600_000

/** 新帖通道的分数门槛：低于这个值基本是无人问津的投稿 */
const MIN_POINTS = 40
/** 新帖通道只看最近 48 小时 */
const RECENT_HOURS = 48

interface AlgoliaHit {
  objectID?: string
  title?: string | null
  url?: string | null
  author?: string | null
  points?: number | null
  num_comments?: number | null
  created_at?: string | null
  created_at_i?: number | null
  story_text?: string | null
}

interface AlgoliaResponse {
  hits?: AlgoliaHit[]
}

function toIso(hit: AlgoliaHit): string | null {
  if (typeof hit.created_at_i === 'number' && hit.created_at_i > 0) {
    return new Date(hit.created_at_i * 1000).toISOString()
  }
  if (typeof hit.created_at === 'string') {
    const parsed = Date.parse(hit.created_at)
    if (!Number.isNaN(parsed)) return new Date(parsed).toISOString()
  }
  return null
}

function toRaw(hit: AlgoliaHit): RawNewsItem | null {
  const objectId = hit.objectID
  const title = (hit.title ?? '').trim()
  if (objectId === undefined || title === '') return null
  // 招聘帖 / 纯文本自述帖没有外链，对「选题」价值低，跳过
  const url = hit.url
  if (url === undefined || url === null || !/^https?:\/\//.test(url)) return null

  return {
    id: `hn:${objectId}`,
    title,
    author: hit.author ?? null,
    url,
    summary: (hit.story_text ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300),
    publishedAt: toIso(hit),
    metrics: { points: hit.points ?? 0, reply: hit.num_comments ?? 0 },
    comments: [],
    kind: 'hn'
  }
}

async function fetchAlgolia(query: string): Promise<RawNewsItem[]> {
  const res = await fetch(`https://hn.algolia.com/api/v1/search${query}`, {
    headers: { 'user-agent': UA, 'accept': 'application/json' },
    signal: AbortSignal.timeout(20_000)
  })
  if (!res.ok) throw new Error(`HN Algolia HTTP ${res.status}`)
  const json = await res.json() as AlgoliaResponse
  return (json.hits ?? []).map(toRaw).filter((item): item is RawNewsItem => item !== null)
}

/** 首页榜 + 近 48 小时高分开花帖，合并去重后按分数排。 */
export async function fetchHackerNews(limit = 60): Promise<RawNewsItem[]> {
  const since = Math.floor((Date.now() - RECENT_HOURS * HOUR) / 1000)
  const settled = await Promise.allSettled([
    fetchAlgolia('?tags=front_page&hitsPerPage=40'),
    fetchAlgolia(`?tags=story&numericFilters=points%3E${MIN_POINTS},created_at_i%3E${since}&hitsPerPage=60`)
  ])

  const items: RawNewsItem[] = []
  const failures: string[] = []
  for (const result of settled) {
    if (result.status === 'fulfilled') items.push(...result.value)
    else failures.push(result.reason instanceof Error ? result.reason.message : String(result.reason))
  }
  if (items.length === 0) throw new Error(failures[0] ?? 'HN 两条链路都没返回数据')

  const map = new Map<string, RawNewsItem>()
  for (const item of items) {
    const existing = map.get(item.id)
    // 同一帖两条链路都会返回，留分数高的那份
    if (existing === undefined || (item.metrics.points ?? 0) > (existing.metrics.points ?? 0)) {
      map.set(item.id, item)
    }
  }

  return [...map.values()]
    .sort((a, b) => (b.metrics.points ?? 0) - (a.metrics.points ?? 0))
    .slice(0, limit)
}
