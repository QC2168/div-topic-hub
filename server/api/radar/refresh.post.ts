/** 手动刷新：一键跑完 B站 + AI 资讯 + 全网热搜三个采集器并落库。 */
import { refreshAll } from '../../utils/collect'
import { logFetch, pruneFeedItems } from '../../utils/repo'

export default defineEventHandler(async () => {
  const started = Date.now()
  const result = await refreshAll()
  const pruned = pruneFeedItems(7)
  const ok = result.bilibili + result.aiNews + result.hotSearch > 0
  logFetch('refresh-all', ok, `bilibili ${result.bilibili} / aiNews ${result.aiNews} / hot ${result.hotSearch} / pruned ${pruned}`)
  return {
    ...result,
    pruned,
    durationMs: Date.now() - started,
    ok
  }
})
