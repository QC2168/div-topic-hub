/**
 * AI 一手新资讯采集：GitHub 趋势 + 垂类 RSS。
 *
 * GitHub 走 trending 页面抓取（官方 API 没有「日增 star」字段，trending 页面才有），
 * 抓不到时降级到官方 search API（按近 7 天新建 + star 排序），保证接口不空手而归。
 */
import type { FeedComment, FeedMetrics } from '#shared/types'

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36'
const HOUR = 3_600_000

export interface RawNewsItem {
  id: string
  title: string
  author: string | null
  url: string
  summary: string
  publishedAt: string | null
  metrics: FeedMetrics
  comments: FeedComment[]
  /** github → 'github'；rss → 'ai-news'；hn → 'community'；arxiv → 'paper' */
  kind: 'github' | 'rss' | 'hn' | 'arxiv'
}

export interface NewsCollectResult {
  items: RawNewsItem[]
  warnings: string[]
}

/* ── GitHub trending ── */

function parseCount(raw: string | undefined): number {
  if (raw === undefined) return 0
  const text = raw.replace(/,/g, '').trim()
  if (text === '') return 0
  const num = Number.parseFloat(text)
  return Number.isFinite(num) ? Math.round(num) : 0
}

function decodeEntities(text: string): string {
  return text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#39;/g, '\'').replace(/&apos;/g, '\'')
    .replace(/&amp;/g, '&')
    .trim()
}

function stripTags(text: string | undefined): string {
  if (text === undefined) return ''
  return decodeEntities(text.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()
}

/**
 * 抓 GitHub trending 页。`since=daily` 对应「今日 star 增长最快」，
 * 传 language 可拿指定语言榜（python / typescript 这类，与全语言榜重合度不高）。
 * 该页无官方 API，用 article 块切分 + 正则提字段；结构变动时整体降级到 search API。
 */
export async function fetchGithubTrending(since: 'daily' | 'weekly' = 'daily', language?: string): Promise<RawNewsItem[]> {
  const path = language === undefined || language === ''
    ? `https://github.com/trending?since=${since}`
    : `https://github.com/trending/${language}?since=${since}`
  const res = await fetch(path, {
    headers: { 'user-agent': UA, 'accept': 'text/html' },
    signal: AbortSignal.timeout(20_000)
  })
  if (!res.ok) throw new Error(`GitHub trending HTTP ${res.status}`)
  const html = await res.text()
  const articles = html.split('<article').slice(1)

  const items: RawNewsItem[] = []
  for (const block of articles) {
    const repoMatch = /<h2[^>]*>[\s\S]*?<a[^>]*href="\/([^"/]+\/[^"/?#]+)"/.exec(block)
    if (repoMatch === null) continue
    const fullName = repoMatch[1] as string

    const descMatch = /<p[^>]*class="[^"]*col-9[^"]*"[^>]*>([\s\S]*?)<\/p>/.exec(block)
    const starsMatch = /href="\/[^"]+\/stargazers"[^>]*>([\s\S]*?)<\/a>/.exec(block)
    const todayMatch = /([\d,]+)\s+stars?\s+(?:today|this week)/i.exec(stripTags(block))

    const stars = parseCount(starsMatch === null ? undefined : stripTags(starsMatch[1] ?? ''))
    const starsToday = parseCount(todayMatch?.[1])

    items.push({
      id: `gh:${fullName}`,
      title: fullName,
      author: fullName.split('/')[0] ?? null,
      url: `https://github.com/${fullName}`,
      summary: descMatch === null ? '' : stripTags(descMatch[1] ?? '').slice(0, 300),
      publishedAt: new Date().toISOString(),
      metrics: { stars, starsToday },
      comments: [],
      kind: 'github'
    })
  }

  if (items.length === 0) throw new Error('GitHub trending 页面解析为空（页面结构可能已变）')
  return items.sort((a, b) => (b.metrics.starsToday ?? 0) - (a.metrics.starsToday ?? 0))
}

/** 降级方案：官方 search API，近 7 天新建的 AI 相关仓库按 star 排序。 */
export async function fetchGithubSearchFallback(): Promise<RawNewsItem[]> {
  const since = new Date(Date.now() - 7 * 24 * HOUR).toISOString().slice(0, 10)
  const query = encodeURIComponent(`topic:ai OR topic:llm OR topic:agent created:>=${since}`)
  const res = await fetch(`https://api.github.com/search/repositories?q=${query}&sort=stars&order=desc&per_page=20`, {
    headers: { 'user-agent': 'div-topic-hub', 'accept': 'application/vnd.github+json' },
    signal: AbortSignal.timeout(15_000)
  })
  if (!res.ok) throw new Error(`GitHub search HTTP ${res.status}`)
  const json = await res.json() as {
    items?: Array<{ full_name?: string, html_url?: string, description?: string | null, stargazers_count?: number, owner?: { login?: string }, created_at?: string }>
  }
  return (json.items ?? [])
    .filter(repo => typeof repo.full_name === 'string')
    .map(repo => ({
      id: `gh:${repo.full_name as string}`,
      title: repo.full_name as string,
      author: repo.owner?.login ?? null,
      url: repo.html_url ?? `https://github.com/${repo.full_name as string}`,
      summary: (repo.description ?? '').slice(0, 300),
      publishedAt: repo.created_at ?? new Date().toISOString(),
      metrics: { stars: repo.stargazers_count ?? 0 },
      comments: [],
      kind: 'github' as const
    }))
}

/* ── RSS / Atom ── */

function tagText(block: string, tag: string): string | undefined {
  const match = new RegExp(`<(?:${tag})(?:\\s[^>]*)?>([\\s\\S]*?)</(?:${tag})>`, 'i').exec(block)
  return match === null ? undefined : decodeEntities(match[1] ?? '')
}

function tagHref(block: string, tag: string): string | undefined {
  const match = new RegExp(`<(?:${tag})\\b[^>]*\\bhref="([^"]+)"`, 'i').exec(block)
  return match === null ? undefined : decodeEntities(match[1] ?? '')
}

function toIso(raw: string | undefined): string | null {
  if (raw === undefined) return null
  const parsed = Date.parse(raw)
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString()
}

/** 极简 RSS/Atom 解析（正则版，覆盖主流官方 feed 的标准形态）。 */
export function parseFeed(xml: string, feedName: string): RawNewsItem[] {
  const blocks = xml.match(/<item\b[\s\S]*?<\/item>|<entry\b[\s\S]*?<\/entry>/gi) ?? []
  const items: RawNewsItem[] = []
  for (const block of blocks) {
    const title = stripTags(tagText(block, 'title') ?? '')
    const link = tagText(block, 'link') ?? tagHref(block, 'link') ?? ''
    if (title === '' || link === '' || !/^https?:\/\//.test(link)) continue
    const description = stripTags(tagText(block, 'description') ?? tagText(block, 'summary') ?? tagText(block, 'content') ?? '').slice(0, 280)
    items.push({
      id: `rss:${link}`,
      title,
      author: feedName,
      url: link,
      summary: description,
      publishedAt: toIso(tagText(block, 'pubdate') ?? tagText(block, 'published') ?? tagText(block, 'updated')),
      metrics: {},
      comments: [],
      kind: 'rss'
    })
  }
  return items
}

export async function fetchRssFeed(feed: { name: string, url: string }): Promise<RawNewsItem[]> {
  const res = await fetch(feed.url, {
    headers: {
      'user-agent': UA,
      'accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.8'
    },
    signal: AbortSignal.timeout(15_000)
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return parseFeed(await res.text(), feed.name)
}

/**
 * 并发拉取多个 RSS，单个失败只记 warning。
 * 单源最多取 maxPerFeed 条：OpenAI 这类 feed 一次给上千条，不截会把列表淹掉。
 */
export async function collectRssFeeds(feeds: Array<{ name: string, url: string }>, maxPerFeed = 20): Promise<NewsCollectResult> {
  const warnings: string[] = []
  const settled = await Promise.allSettled(feeds.map(feed => fetchRssFeed(feed)))
  const items: RawNewsItem[] = []
  settled.forEach((result, index) => {
    const feed = feeds[index]
    if (result.status === 'fulfilled') {
      if (result.value.length === 0) {
        warnings.push(`${feed?.name ?? 'RSS'} 解析为空（可能改版或该源无条目）`)
        return
      }
      items.push(...result.value.slice(0, maxPerFeed))
    } else {
      warnings.push(`${feed?.name ?? 'RSS'} 拉取失败：${result.reason instanceof Error ? result.reason.message : String(result.reason)}`)
    }
  })
  return { items, warnings }
}
