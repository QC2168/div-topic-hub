/** B 站垂类黑马采集：拉取 → 打分打标签 → 落库 → 返回。 */
import type { RadarResponse, FeedItem } from '#shared/types'
import { collectBilibili } from '../../utils/collect'
import { logFetch, pruneFeedItems, upsertFeedItems } from '../../utils/repo'

export default defineEventHandler(async (event): Promise<RadarResponse<FeedItem>> => {
  const query = getQuery(event)
  const limit = Number(query.limit ?? 60)
  const started = Date.now()

  try {
    const { items, warnings } = await collectBilibili()
    upsertFeedItems(items)
    pruneFeedItems(7)
    logFetch('bilibili', true, `${items.length} 条 / ${Date.now() - started}ms`)
    return {
      items: items.slice(0, Number.isFinite(limit) ? limit : 60),
      warnings,
      fetchedAt: new Date().toISOString()
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logFetch('bilibili', false, message)
    throw createError({ statusCode: 502, statusMessage: `B 站采集失败：${message}` })
  }
})
