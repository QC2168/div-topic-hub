/** 读取本地缓存的选题信息流（前端首屏走这里，秒开）。 */
import type { FeedCategory, FeedItem } from '#shared/types'
import { lastFetchedAt, listFeedItems } from '../utils/repo'

const VALID: FeedCategory[] = ['bili-tech', 'bili-knowledge', 'github', 'ai-news', 'community', 'paper', 'hot-search', 'ai-board']

/**
 * 不指定分类时**默认不返回热搜**。
 * 热搜有一百多条，且和视频类内容完全不同构，混进同一个 limit 会把 B 站内容挤出首屏；
 * 热搜页自己带 category=hot-search 明确来要，两边互不干扰。
 */
const DEFAULT_CATEGORIES: FeedCategory[] = ['bili-tech', 'bili-knowledge', 'github', 'ai-news', 'community', 'paper', 'ai-board']

export default defineEventHandler((event): { items: FeedItem[], fetchedAt: string | null, total: number } => {
  const query = getQuery(event)
  const categories = String(query.category ?? '')
    .split(',')
    .map(value => value.trim())
    .filter((value): value is FeedCategory => (VALID as string[]).includes(value))

  const limit = Number(query.limit ?? 150)
  const items = listFeedItems({
    categories: categories.length > 0 ? categories : DEFAULT_CATEGORIES,
    limit: Number.isFinite(limit) ? limit : 150
  })

  return {
    items,
    fetchedAt: lastFetchedAt(),
    total: items.length
  }
})
