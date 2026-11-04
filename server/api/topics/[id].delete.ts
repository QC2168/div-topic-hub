/** 我的选题池：删除 */
import { deleteTopic } from '../../utils/repo'

export default defineEventHandler((event) => {
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isFinite(id)) {
    throw createError({ statusCode: 400, statusMessage: 'id 非法' })
  }
  if (!deleteTopic(id)) {
    throw createError({ statusCode: 404, statusMessage: '选题不存在' })
  }
  return { ok: true }
})
