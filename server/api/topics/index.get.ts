/** 我的选题池：列表 */
import type { TopicStatus } from '#shared/types'
import { listTopics } from '../../utils/repo'

const VALID: TopicStatus[] = ['idea', 'scripting', 'published', 'dropped']

export default defineEventHandler((event) => {
  const query = getQuery(event)
  const status = String(query.status ?? '')
  return listTopics((VALID as string[]).includes(status) ? status as TopicStatus : undefined)
})
