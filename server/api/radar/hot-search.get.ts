/**
 * 全网热搜：抖音热榜 + 微博热搜。
 *
 * 首次访问自动采集一次（约 1 秒，两个接口都很快），之后走本地缓存；
 * 缓存超过 10 分钟或带 refresh=1 时重新采集。
 *
 * 为什么要自动采集而不是等用户点刷新：这两个源加起来才 1 秒，
 * 让用户为了看热榜先点一次「采集」纯属多余操作。
 */
import type { FeedItem } from '#shared/types'
import { collectHotSearch } from '../../utils/hot-topic'
import { listFeedItems, pruneHotSearch, upsertFeedItems } from '../../utils/repo'

/** 热榜变化很快，10 分钟已经算「旧」了 */
const STALE_MS = 10 * 60_000

/** 并发去重：同一时刻只允许一个采集在跑，第二个请求直接等结果 */
let inflight: Promise<void> | null = null

function readHot(): FeedItem[] {
  // 热搜没有发布时间，maxAgeDays 必须传 null，否则会被期刊那道 45 天闸误杀
  return listFeedItems({ categories: ['hot-search'], limit: 300, maxAgeDays: null })
}

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const force = String(query.refresh ?? '') === '1'

  let items = readHot()
  const warnings: string[] = []

  const newest = items[0]?.fetchedAt
  const stale = newest === undefined || Date.now() - Date.parse(newest) > STALE_MS

  if (force || stale) {
    if (inflight === null) {
      inflight = (async () => {
        // 记下发起时间，采集完成后把早于这个时刻的旧热搜全删掉（掉榜的词不该留在列表里）
        const startedAt = new Date(Date.now() - 1_000).toISOString()
        const outcome = await collectHotSearch()
        upsertFeedItems(outcome.items)
        pruneHotSearch(startedAt)
        warnings.push(...outcome.warnings)
      })().finally(() => {
        inflight = null
      })
    }
    try {
      await inflight
      items = readHot()
    } catch (error) {
      warnings.push(error instanceof Error ? error.message : String(error))
    }
  }

  // 按平台分组并按名次排：热榜的顺序就是名次，按 score 排会打乱「第几位」的直觉
  const byRank = (a: FeedItem, b: FeedItem): number => (a.metrics.rank ?? 999) - (b.metrics.rank ?? 999)

  return {
    baidu: items.filter(item => item.platform === 'baidu').sort(byRank),
    douyin: items.filter(item => item.platform === 'douyin').sort(byRank),
    weibo: items.filter(item => item.platform === 'weibo').sort(byRank),
    fetchedAt: items[0]?.fetchedAt ?? null,
    warnings
  }
})
