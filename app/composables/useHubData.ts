/**
 * 快照数据层：网站不再有自己的采集服务，而是直接读每天重建一次的静态 JSON。
 *
 * ── 为什么这样更好 ──
 * 原来的网站靠自己的 Nitro 接口读本地 SQLite，意味着「服务没跑就没数据」。
 * 改成读快照后，只要 GitHub Pages 上有那份每日重建的 JSON，页面就有数据，
 * 网站本身可以纯静态部署，也永远不会出现「打开是空列表」。
 *
 * ── 地址 ──
 * 默认指向线上数据端（runtimeConfig.public.hubBase）。如果哪天把网站也挂到同一个
 * Pages 上，把 hubBase 设成空字符串即可走同源相对路径，连跨域都不用。
 */
import type { FeedItem } from '#shared/types'
import type { FreeModel, FreeTierEntry } from '#shared/free-tier'

/**
 * 白嫖榜单快照的字段形状。和旧的服务端接口一致——静态导出脚本是刻意保持同形的，
 * 所以页面从「读接口」换成「读 JSON」时不用改字段名。
 */
export interface FreeTierSnapshot {
  overseas: { models: FreeModel[], fetchedAt: string | null, rateLimitNote: string }
  domestic: { app: FreeTierEntry[], api: FreeTierEntry[], verifiedAt: string }
  overseasPlatforms: { entries: FreeTierEntry[], verifiedAt: string }
  warnings: string[]
}

export interface SnapshotEnvelope<T> {
  schema: string
  dataset: string
  name: string
  description: string
  generatedAt: string
  fetchedAt: string | null
  count: number
  counts: Record<string, number>
  staleAfterMinutes: number
  ageMinutes: number
  contentHash: string
  warnings: string[]
  items: T[]
}

export interface FeedBundle {
  items: FeedItem[]
  fetchedAt: string | null
  warnings: string[]
  /** 数据是否已超过各数据集自己的时效阈值 */
  stale: boolean
}

const FEED_DATASETS = ['bilibili', 'ai-news'] as const

export const useHubData = createSharedComposable(() => {
  const config = useRuntimeConfig()
  const base = String(config.public.hubBase ?? '').replace(/\/$/, '')
  const feedState = useState<FeedBundle | null>('hub-feed', () => null)

  /** 不加 force 时按「今天」做缓存键：同一天内走浏览器/CDN 缓存，跨天自动换 URL */
  function cacheKey(force: boolean): string {
    return force ? `?t=${Date.now()}` : `?d=${new Date().toISOString().slice(0, 10)}`
  }

  async function envelope<T>(id: string, force: boolean): Promise<SnapshotEnvelope<T>> {
    const url = `${base}/api/v1/${id}.json${cacheKey(force)}`
    const res = await fetch(url, { headers: { accept: 'application/json' } })
    if (!res.ok) throw new Error(`读取 ${id} 快照失败（HTTP ${res.status}）`)
    return await res.json() as SnapshotEnvelope<T>
  }

  function newest(values: Array<string | null | undefined>): string | null {
    const times = values
      .filter((value): value is string => typeof value === 'string' && value !== '')
      .map(value => Date.parse(value))
      .filter(value => Number.isFinite(value))
    if (times.length === 0) return null
    return new Date(Math.max(...times)).toISOString()
  }

  /** 圈内黑马 + AI 资讯合并：这是「全部」与两个页签共用的池子 */
  async function feed(options: { force?: boolean } = {}): Promise<FeedBundle> {
    const force = options.force === true
    if (!force && feedState.value !== null) return feedState.value

    const results = await Promise.all(FEED_DATASETS.map(id => envelope<FeedItem>(id, force)))
    const items = results.flatMap(result => result.items).sort((a, b) => b.score - a.score)
    const bundle: FeedBundle = {
      items,
      fetchedAt: newest(results.map(result => result.fetchedAt)),
      warnings: results.flatMap(result => result.warnings),
      stale: results.some(result => result.ageMinutes > result.staleAfterMinutes)
    }
    feedState.value = bundle
    return bundle
  }

  /** 热搜：按平台分组，页面三个 tab 直接用 */
  async function hotSearch(options: { force?: boolean } = {}) {
    const data = await envelope<FeedItem>('hot-search', options.force === true)
    const group = (platform: string) => data.items.filter(item => item.platform === platform)
    return {
      baidu: group('baidu'),
      douyin: group('douyin'),
      weibo: group('weibo'),
      fetchedAt: data.fetchedAt,
      warnings: data.warnings,
      stale: data.ageMinutes > data.staleAfterMinutes
    }
  }

  /** AI 资讯（含 HuggingFace 榜），热搜页的「海外」区块复用 */
  async function aiNews(options: { force?: boolean } = {}) {
    const data = await envelope<FeedItem>('ai-news', options.force === true)
    return { items: data.items, fetchedAt: data.fetchedAt, warnings: data.warnings }
  }

  /**
   * 白嫖榜单：字段与旧的服务端接口**完全同形**（静态导出脚本刻意保持的约定），
   * 所以页面那边几乎不用改。
   */
  async function freeTier(options: { force?: boolean } = {}): Promise<FreeTierSnapshot> {
    const res = await fetch(`${base}/api/v1/free-tier.json${cacheKey(options.force === true)}`, {
      headers: { accept: 'application/json' }
    })
    if (!res.ok) throw new Error(`读取白嫖榜单失败（HTTP ${res.status}）`)
    return await res.json() as FreeTierSnapshot
  }

  /** 目录：给出各数据集的条数与新鲜度，页面底部用它显示「数据截至」 */
  async function catalog() {
    const res = await fetch(`${base}/api/v1/datasets.json${cacheKey(false)}`, {
      headers: { accept: 'application/json' }
    })
    if (!res.ok) throw new Error(`读取数据集目录失败（HTTP ${res.status}）`)
    return await res.json() as {
      generatedAt: string
      baseUrl: string
      datasets: Array<{
        id: string
        name: string
        url: string
        count: number
        fetchedAt: string | null
        ageMinutes: number | null
        stale: boolean
        staleAfterMinutes: number | null
      }>
    }
  }

  return { base, feed, hotSearch, aiNews, freeTier, catalog, envelope }
})
