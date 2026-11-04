/**
 * 白嫖榜单数据（读取层）。
 *
 * ── 数据本体在 data/free-tier.json，改数据只改那一个文件 ──
 * 这里不再手写任何条目：分组、media 映射、核实日期全部由 JSON 提供。
 * 以前这份文件里有 800 多行 TS 数组，改一条数据要在代码里翻半天，
 * 现在给非程序员改也只要动 JSON。
 *
 * ── 两类数据，新鲜度不同，页面上分开标注 ──
 *
 * 1. 海外实时免费模型：OpenRouter 的 GET /api/v1/models 无需鉴权、公开，
 *    pricing.prompt / pricing.completion 全为 "0" 即免费。这是真·实时。
 *
 * 2. 平台免费政策（国内应用 / 国内 API / 海外平台）：**没有任何平台把免费额度
 *    暴露成机器可读接口**——额度都绑在账号体系里，得登录才看得到自己的余量。
 *    所以这部分是人工核实的静态数据，每条带核实日期与来源，规则变了需要人工更新。
 *    绝不把静态数据伪装成实时。
 *
 * ── 为什么把「应用」和「API」分开 ──
 * 普通人问「哪个能白嫖」，指的是打开网页就能用、每天签到领积分那种；
 * 开发者问的是 token 额度。两者完全是不同的东西，混在一张表里会误导。
 */

import rawJson from '../../data/free-tier.json'
import type { FreeModel, FreeTierEntry } from '#shared/free-tier'

/** 静态清单的核实日期，随 JSON 一起维护。 */
export const TIER_VERIFIED_AT: string = rawJson.verifiedAt

/**
 * 作者信息（可选）。mid = B站用户号，bvid / aid = 绑定的投稿视频。
 * Toy 端靠它渲染「去关注作者」「去看视频」入口；留空则入口自动收起。
 */
export const AUTHOR_INFO: { mid: string, name: string, bvid: string, aid: number } = rawJson.author

const MEDIA_BY_PLATFORM = rawJson.mediaByPlatform as Record<string, string[]>

/** JSON 里的条目缺 media 字段（它按平台名在 mediaByPlatform 里统一配），补上再出去。 */
function withMedia(list: Array<Omit<FreeTierEntry, 'media'>>): FreeTierEntry[] {
  return list.map((entry) => {
    const media = (MEDIA_BY_PLATFORM[entry.platform] ?? ['text']) as FreeTierEntry['media']
    return { ...entry, kind: entry.kind as FreeTierEntry['kind'], channel: entry.channel as FreeTierEntry['channel'], media }
  })
}

export const DOMESTIC_APP_TIERS: FreeTierEntry[] = withMedia(rawJson.domesticApp as Array<Omit<FreeTierEntry, 'media'>>)
export const DOMESTIC_API_TIERS: FreeTierEntry[] = withMedia(rawJson.domesticApi as Array<Omit<FreeTierEntry, 'media'>>)
export const OVERSEAS_FREE_TIERS: FreeTierEntry[] = withMedia(rawJson.overseasPlatforms as Array<Omit<FreeTierEntry, 'media'>>)

/* ── OpenRouter 实时免费模型 ────────────────────────────────────────── */

const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models?limit=1000'

/** 免费模型榜 1 小时内视为新鲜——它本身变化频率就是天级，没必要每次请求都打 */
const CACHE_TTL_MS = 60 * 60_000

let cache: { at: number, models: FreeModel[] } | null = null

interface OpenRouterModel {
  id: string
  name: string
  context_length: number | null
  pricing: { prompt: string, completion: string }
}

/**
 * 拉取 OpenRouter 当前全部零价模型。
 * 判定标准只有一条且可复核：pricing.prompt 与 pricing.completion 均为 "0"。
 */
export async function fetchOpenRouterFreeModels(force = false): Promise<FreeModel[]> {
  if (!force && cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return cache.models
  }

  const res = await $fetch<{ data: OpenRouterModel[] }>(OPENROUTER_MODELS_URL, {
    timeout: 20_000,
    headers: { Accept: 'application/json' }
  })

  const models: FreeModel[] = (res.data ?? [])
    .filter(m => m.pricing?.prompt === '0' && m.pricing?.completion === '0')
    .map(m => ({
      id: m.id,
      name: m.name,
      provider: m.id.includes('/') ? m.id.slice(0, m.id.indexOf('/')) : 'unknown',
      contextLength: typeof m.context_length === 'number' ? m.context_length : null
    }))
    .sort((a, b) => (b.contextLength ?? 0) - (a.contextLength ?? 0))

  cache = { at: Date.now(), models }
  return models
}
