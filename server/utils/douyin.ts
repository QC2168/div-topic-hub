/**
 * 抖音数据：热榜（词条级）+ 单条链接解析。
 *
 * ── 为什么热榜能接，视频详情接不了 ──
 * 抖音的「热门视频榜」需要 a_bogus/X-Bogus 签名 + 一整套 cookie，属于主动对抗风控；
 * 但热榜词条接口是抖音自己的分享页后端，无需鉴权、无需签名，返回的是公开榜单。
 * 前者我们不做（破防护 + 随时封号），后者可以放心接。
 *
 * 代价是：**拿不到单条视频的播放量和作者粉丝数**，所以破圈倍率这套在抖音失效。
 * 换来的是 video_count（该热点下的视频数）——热度和视频数的比值，
 * 恰好能回答「这个热点是不是还没人做」，比播放量更贴近选题决策。
 *
 * ── 关于单条解析 ──
 * 走 iesdouyin 移动端分享页里内嵌的 _ROUTER_DATA，不破任何签名。
 * 但这条路**没有在真实链接上验证过**（无 ID 时页面不返回 videoInfoRes），
 * 所以失败时必须明确报错并让用户手动补全，绝不能拿空值凑一个看起来像样的结果。
 */
import type { FeedComment, FeedMetrics } from '#shared/types'

const MOBILE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'

/** 抖音热榜词条（热度 + 竞争度，是我们真正要的信号） */
export interface DouyinHotWord {
  word: string
  heat: number
  rank: number
  /** 该热点下的视频数；接口缺省时为 null */
  videoCount: number | null
  /** 榜单自带标记：0 普通 / 1 新 / 3 热 / 5 沸 / 其他值透传 */
  label: number
}

interface SnssdkWord {
  word?: string
  hot_value?: number
  position?: number
  video_count?: number
  label?: number
}

/**
 * 抖音热榜。
 *
 * 用 aweme.snssdk.com 而不是 iesdouyin 的 billboard/word：
 * 后者只返回 word / hot_value / label 三个字段，**没有 video_count**，
 * 而 video_count 是判断「有没有人做」的唯一依据，缺了它这条数据源就没价值。
 */
export async function fetchDouyinHot(): Promise<DouyinHotWord[]> {
  const res = await fetch('https://aweme.snssdk.com/aweme/v1/hot/search/list/', {
    headers: {
      'user-agent': MOBILE_UA,
      'accept': 'application/json'
    },
    signal: AbortSignal.timeout(15_000)
  })
  if (!res.ok) throw new Error(`抖音热榜 HTTP ${res.status}`)

  const json = await res.json() as { status_code?: number, data?: { word_list?: SnssdkWord[] } }
  if (json.status_code !== undefined && json.status_code !== 0) {
    throw new Error(`抖音热榜 status_code ${json.status_code}`)
  }

  const list = json.data?.word_list ?? []
  const words: DouyinHotWord[] = []
  for (const [index, row] of list.entries()) {
    const word = (row.word ?? '').trim()
    if (word === '') continue
    words.push({
      word,
      heat: typeof row.hot_value === 'number' ? row.hot_value : 0,
      rank: typeof row.position === 'number' && row.position > 0 ? row.position : index + 1,
      videoCount: typeof row.video_count === 'number' ? row.video_count : null,
      label: typeof row.label === 'number' ? row.label : 0
    })
  }
  if (words.length === 0) throw new Error('抖音热榜返回空列表')
  return words
}

/* ── 单条链接解析 ── */

export interface ResolvedDouyinVideo {
  awemeId: string
  title: string
  author: string | null
  /** 作者粉丝数；分享页常常不给，给不出就别编 */
  fans: number | null
  cover: string | null
  summary: string
  metrics: FeedMetrics
  comments: FeedComment[]
  publishedAt: string | null
}

/** 从「复制打开抖音，看看…」这类分享文案里揪出链接。 */
export function extractDouyinUrl(text: string): string | null {
  const matches = text.match(/https?:\/\/[^\s\u4e00-\u9fa5"'<>]+/g)
  if (matches === null) return null
  const hit = matches.find(url => /douyin\.com|iesdouyin\.com/.test(url))
  return hit ?? null
}

/** 从各种形态的抖音地址里取 aweme_id（视频页 / 短链跳转后的页面 / modal_id 参数）。 */
function parseAwemeId(url: string): string | null {
  const video = url.match(/\/(?:video|note|share\/video)\/(\d{6,})/)
  if (video?.[1] !== undefined) return video[1]
  const modal = url.match(/[?&]modal_id=(\d{6,})/)
  if (modal?.[1] !== undefined) return modal[1]
  return null
}

/** 短链（v.douyin.com/xxx）先跟一次跳转，拿到带 id 的最终地址。 */
async function followShortLink(url: string): Promise<string> {
  if (!/v\.douyin\.com|iesdouyin\.com\/share/.test(url)) return url
  const res = await fetch(url, {
    redirect: 'follow',
    headers: { 'user-agent': MOBILE_UA },
    signal: AbortSignal.timeout(15_000)
  })
  // 有些短链不返回 30x，而是直接 200 落地页，此时 response.url 就是终点
  return res.url === '' ? url : res.url
}

interface SnssdkItem {
  desc?: string
  create_time?: number
  author?: { nickname?: string, follower_count?: number }
  statistics?: { digg_count?: number, comment_count?: number, share_count?: number, play_count?: number }
  video?: { cover?: { url_list?: string[] } }
}

/** 分享页把整页数据塞进 `_ROUTER_DATA = {...}`，抠出来即可，不涉及任何签名。 */
function extractRouterData(html: string): SnssdkItem | null {
  const matched = html.match(/_ROUTER_DATA\s*=\s*(\{[\s\S]*?\});?\s*<\/script>/)
  if (matched?.[1] === undefined) return null
  try {
    const data = JSON.parse(matched[1]) as {
      loaderData?: Record<string, { videoInfoRes?: { item_list?: SnssdkItem[] } }>
    }
    for (const value of Object.values(data.loaderData ?? {})) {
      const list = value?.videoInfoRes?.item_list
      if (Array.isArray(list) && list.length > 0) return list[0] ?? null
    }
    return null
  } catch {
    return null
  }
}

/**
 * 解析一条抖音分享链接。
 *
 * 失败时抛出带明确原因的错误，由路由层转成 4xx——宁可让用户手动粘贴标题，
 * 也不能用空字段拼一条假数据混进选题池。
 */
export async function resolveDouyinLink(text: string): Promise<ResolvedDouyinVideo> {
  const url = extractDouyinUrl(text)
  if (url === null) {
    throw new Error('没找到抖音链接。请把 App 里「分享 → 复制链接」的整段文案粘进来')
  }

  const landed = await followShortLink(url)
  const awemeId = parseAwemeId(landed) ?? parseAwemeId(url)
  if (awemeId === null) {
    throw new Error('这个链接里没有视频 ID，可能是主页或直播链接。请粘贴单条视频的分享链接')
  }

  const res = await fetch(`https://www.iesdouyin.com/share/video/${awemeId}/`, {
    headers: {
      'user-agent': MOBILE_UA,
      'accept': 'text/html,application/xhtml+xml',
      'accept-language': 'zh-CN,zh;q=0.9'
    },
    signal: AbortSignal.timeout(15_000)
  })
  if (!res.ok) throw new Error(`抖音分享页 HTTP ${res.status}`)

  const item = extractRouterData(await res.text())
  if (item === null) {
    throw new Error('抖音这条没返回视频数据（可能已删除、是私密作品，或分享页结构变了）。请手动粘贴标题和播放量')
  }

  const stats = item.statistics ?? {}
  const metrics: FeedMetrics = {}
  if (typeof stats.play_count === 'number' && stats.play_count > 0) metrics.play = stats.play_count
  if (typeof stats.digg_count === 'number') metrics.like = stats.digg_count
  if (typeof stats.comment_count === 'number') metrics.reply = stats.comment_count
  if (typeof stats.share_count === 'number') metrics.share = stats.share_count

  const fans = item.author?.follower_count
  if (typeof fans === 'number' && fans > 0) metrics.fans = fans

  return {
    awemeId,
    title: (item.desc ?? '').trim(),
    author: item.author?.nickname ?? null,
    fans: typeof fans === 'number' && fans > 0 ? fans : null,
    cover: item.video?.cover?.url_list?.[0] ?? null,
    summary: '',
    metrics,
    comments: [],
    publishedAt: typeof item.create_time === 'number' && item.create_time > 0
      ? new Date(item.create_time * 1000).toISOString()
      : null
  }
}
