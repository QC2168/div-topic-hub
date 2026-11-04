/** 我的选题池：更新 AI 拆解稿 / 状态 */
import type { TopicStatus } from '#shared/types'
import { updateTopic } from '../../utils/repo'

const VALID: TopicStatus[] = ['idea', 'scripting', 'published', 'dropped']

export default defineEventHandler(async (event) => {
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isFinite(id)) {
    throw createError({ statusCode: 400, statusMessage: 'id 非法' })
  }

  const body = await readBody<{ aiAnalysisMd?: string, status?: string, title?: string }>(event)
  const status = body?.status !== undefined && (VALID as string[]).includes(body.status)
    ? body.status as TopicStatus
    : undefined

  const updated = updateTopic(id, {
    aiAnalysisMd: typeof body?.aiAnalysisMd === 'string' ? body.aiAnalysisMd : undefined,
    status,
    title: typeof body?.title === 'string' ? body.title : undefined
  })

  if (updated === undefined) {
    throw createError({ statusCode: 404, statusMessage: '选题不存在' })
  }
  return updated
})
