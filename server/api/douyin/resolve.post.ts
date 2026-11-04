/**
 * 解析一条抖音分享链接，转成与 B 站同构的 AnalyzeInput，直接喂给拆解流程。
 *
 * 解析不到就报 422 并说明原因——不返回半成品。
 * 「缺字段」和「字段是 0」在选题判断上完全是两回事，混在一起会误导人。
 */
import type { FeedItem } from '#shared/types'
import { resolveDouyinLink } from '../../utils/douyin'
import { computeBadges, scoreItem } from '../../utils/score'

interface ResolveBody {
  text?: string
}

export default defineEventHandler(async (event) => {
  const body = await readBody<ResolveBody>(event)
  const text = (body?.text ?? '').trim()
  if (text === '') {
    throw createError({ statusCode: 400, statusMessage: '请粘贴抖音分享链接或分享文案' })
  }

  try {
    const video = await resolveDouyinLink(text)
    const now = Date.now()
    const scoreInput = { platform: 'douyin' as const, metrics: video.metrics, publishedAt: video.publishedAt, now }

    // 直接返回完整 FeedItem：前端拿到的对象和采集库里的同构，
    // 才能原样塞进拆解台，不用为「来自链接」单独写一套渲染。
    const item: FeedItem = {
      id: `douyin:${video.awemeId}`,
      platform: 'douyin',
      category: 'hot-search',
      title: video.title === '' ? '（该视频无标题）' : video.title,
      author: video.author,
      url: `https://www.douyin.com/video/${video.awemeId}`,
      cover: video.cover,
      summary: video.summary,
      metrics: video.metrics,
      comments: video.comments,
      badges: computeBadges(scoreInput),
      publishedAt: video.publishedAt,
      fetchedAt: new Date(now).toISOString(),
      score: scoreItem(scoreInput)
    }
    return { ok: true, item }
  } catch (error) {
    throw createError({
      statusCode: 422,
      statusMessage: error instanceof Error ? error.message : String(error)
    })
  }
})
