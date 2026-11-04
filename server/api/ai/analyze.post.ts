/**
 * DeepSeek 蹭热点拆解（流式 Markdown）。
 *
 * 入参二选一：`{ itemId }` 直接从缓存取，或 `{ item }` 直接给内容
 * （选题池里的旧选题也用这条路径复用同一套 prompt）。
 */
import type { AnalyzeInput } from '../../utils/deepseek'
import { buildUserPrompt, streamDeepSeek, toAnalyzeInput } from '../../utils/deepseek'
import { getFeedItem } from '../../utils/repo'

interface AnalyzeBody {
  itemId?: string
  item?: AnalyzeInput
}

export default defineEventHandler(async (event) => {
  const body = await readBody<AnalyzeBody>(event)

  let input: AnalyzeInput
  if (body?.item !== undefined && typeof body.item.title === 'string' && body.item.title !== '') {
    input = body.item
  } else if (typeof body?.itemId === 'string' && body.itemId !== '') {
    const item = getFeedItem(body.itemId)
    if (item === undefined) {
      throw createError({ statusCode: 404, statusMessage: `缓存中找不到该热点：${body.itemId}，请先刷新采集` })
    }
    input = toAnalyzeInput(item)
  } else {
    throw createError({ statusCode: 400, statusMessage: '请提供 itemId 或 item' })
  }

  const stream = await streamDeepSeek(buildUserPrompt(input), { signal: event.context.abortSignal })

  setHeader(event, 'content-type', 'text/plain; charset=utf-8')
  setHeader(event, 'cache-control', 'no-cache, no-transform')
  setHeader(event, 'x-accel-buffering', 'no')
  return sendStream(event, stream)
})
