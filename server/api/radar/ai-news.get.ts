/** AI 一手新资讯采集：GitHub 日增 star 榜 + 垂类 AI RSS。 */
import type { FeedItem, RadarResponse } from '#shared/types'
import { collectAiNews } from '../../utils/collect'
import { logFetch, pruneFeedItems, upsertFeedItems } from '../../utils/repo'

export default defineEventHandler(async (event): Promise<RadarResponse<FeedItem>> => {
  const query = getQuery(event)
  const limit = Number(query.limit ?? 80)
  const started = Date.now()

  try {
    const { items, warnings } = await collectAiNews()
    upsertFeedItems(items)
    pruneFeedItems(7)
    logFetch('ai-news', true, `${items.length} 条 / ${Date.now() - started}ms`)
    return {
      items: items.slice(0, Number.isFinite(limit) ? limit : 80),
      warnings,
      fetchedAt: new Date().toISOString()
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logFetch('ai-news', false, message)
    throw createError({ statusCode: 502, statusMessage: `AI 资讯采集失败：${message}` })
  }
})
