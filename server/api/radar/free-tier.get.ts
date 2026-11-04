/**
 * 白嫖榜单接口。
 *
 * 数据性质在注释和页面里都说死了：
 * - overseas.models：OpenRouter 实时接口算出的零价模型，真·实时（1 小时缓存）；
 * - domestic.app / domestic.api / overseasPlatforms：人工核实清单，静态，带核实日期与来源。
 *
 * OpenRouter 拉取失败只降级不整体 500——静态清单照样可用，
 * 但失败的警告原样透传，页面会显示「实时榜暂时拿不到」而不是装作没这回事。
 */
import { AUTHOR_INFO, DOMESTIC_API_TIERS, DOMESTIC_APP_TIERS, OVERSEAS_FREE_TIERS, TIER_VERIFIED_AT, fetchOpenRouterFreeModels, type FreeModel } from '../../utils/free-tier'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const force = String(query.refresh ?? '') === '1'

  const warnings: string[] = []
  let models: FreeModel[] = []
  let fetchedAt: string | null = null

  try {
    models = await fetchOpenRouterFreeModels(force)
    fetchedAt = new Date().toISOString()
  } catch (error) {
    warnings.push(`OpenRouter 免费模型榜暂时拿不到：${error instanceof Error ? error.message : String(error)}`)
  }

  return {
    // 作者信息给 B站 Toy 端用：渲染「去关注作者」「去看视频」入口；mid/bvid 留空则 Toy 自动收起
    author: AUTHOR_INFO,
    overseas: { models, fetchedAt, rateLimitNote: '免费账号 50 次/天、20 次/分；累计充过 $10 后升到 1000 次/天' },
    domestic: { app: DOMESTIC_APP_TIERS, api: DOMESTIC_API_TIERS, verifiedAt: TIER_VERIFIED_AT },
    overseasPlatforms: { entries: OVERSEAS_FREE_TIERS, verifiedAt: TIER_VERIFIED_AT },
    warnings
  }
})
