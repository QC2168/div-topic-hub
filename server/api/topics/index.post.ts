/** 我的选题池：收藏一条热点（重复收藏返回已有条目） */
import type { FeedItem } from '#shared/types'
import { getFeedItem, saveTopicFromItem } from '../../utils/repo'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ itemId?: string, item?: FeedItem }>(event)

  // 先按 id 找缓存；找不到再看请求体里有没有完整对象。
  // 后者是为抖音链接解析准备的——那条视频从没进过采集库，只有前端手里有数据。
  const cached = typeof body?.itemId === 'string' && body.itemId !== ''
    ? getFeedItem(body.itemId)
    : undefined
  const item = cached ?? body?.item

  if (item === undefined || typeof item.title !== 'string' || item.id === undefined) {
    throw createError({ statusCode: 400, statusMessage: '缺少 itemId，且请求体里没有可用的 item' })
  }
  return saveTopicFromItem(item)
})
