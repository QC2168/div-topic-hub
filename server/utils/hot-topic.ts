/**
 * 热搜类数据（抖音热榜 / 微博热搜）→ FeedItem。
 *
 * 这一类的共同点：**没有播放量、没有作者、没有发布时间**，只有「一个词 + 一个热度值」。
 * 所以 B 站那套爆发分、破圈倍率在这里全部失效，必须单独算分，否则会算出荒唐的结果
 * （比如拿 heat 当 play 去做「每小时播放速度」，得出天文数字）。
 *
 * ── 一个被砍掉的指标 ──
 * 抖音原打算用 video_count 算「供给缺口」（热但没视频 = 蓝海）。实测发现
 * 1200 万热度的榜一条目 video_count 只有 2，说明它的口径根本不是「相关视频总数」。
 * 基于含义不明的字段下「还没人做」的结论，就是把猜测包装成洞察，所以整块删掉。
 * 现在只如实展示热度与名次；「有没有人做过」由用户点「查 B 站」自己看实际结果——
 * 那才是可信的证据。
 */
import type { FeedItem, FeedMetrics } from '#shared/types'
import type { CollectOutcome } from './collect'
import { fetchBaiduHot } from './baidu'
import { fetchDouyinHot } from './douyin'
import { fetchWeiboHot } from './weibo'
import { computeBadges, scoreItem } from './score'

/** 国内热榜的四家（其实三家，B 站单独走视频链路） */
export type HotPlatform = 'baidu' | 'douyin' | 'weibo'

export function hotSearchUrl(platform: HotPlatform, word: string): string {
  const encoded = encodeURIComponent(word)
  if (platform === 'douyin') return `https://www.douyin.com/search/${encoded}`
  if (platform === 'weibo') return `https://s.weibo.com/weibo?q=${encoded}`
  return `https://www.baidu.com/s?wd=${encoded}`
}

function toItem(
  platform: HotPlatform,
  word: string,
  metrics: FeedMetrics,
  summary: string,
  now: number,
  cover: string | null = null
): FeedItem {
  const scoreInput = { platform, metrics, publishedAt: null, now }
  return {
    id: `${platform}:hot:${word}`,
    platform,
    category: 'hot-search',
    title: word,
    author: null,
    url: hotSearchUrl(platform, word),
    cover,
    summary,
    metrics,
    comments: [],
    badges: computeBadges(scoreInput),
    publishedAt: null,
    fetchedAt: new Date(now).toISOString(),
    score: scoreItem(scoreInput)
  }
}

/**
 * 同时拉抖音热榜与微博热搜。
 *
 * 两个源各自独立降级：抖音挂了不影响微博，反之亦然。
 * 两家都挂才抛错——这样「微博能看、抖音看不到」这种事会以 warning 的形式暴露出来，
 * 而不是整页空白让人以为功能坏了。
 */
export async function collectHotSearch(): Promise<CollectOutcome> {
  const now = Date.now()
  const warnings: string[] = []
  const items: FeedItem[] = []

  const [douyin, weibo, baidu] = await Promise.allSettled([fetchDouyinHot(), fetchWeiboHot(), fetchBaiduHot()])

  if (douyin.status === 'fulfilled') {
    for (const row of douyin.value) {
      const metrics: FeedMetrics = { heat: row.heat, rank: row.rank }
      // videoCount 存下来备查，但既不展示也不参与判断（口径不明，见文件头注释）
      if (row.videoCount !== null) metrics.videoCount = row.videoCount

      items.push(toItem('douyin', row.word, metrics, `抖音热榜第 ${row.rank} 位`, now))
    }
  } else {
    warnings.push(`抖音热榜：${errorText(douyin.reason)}`)
  }

  if (weibo.status === 'fulfilled') {
    for (const row of weibo.value) {
      const metrics: FeedMetrics = { heat: row.heat, rank: row.rank }
      const tag = row.tag === '' ? '' : ` · ${row.tag}`
      items.push(toItem('weibo', row.word, metrics, `微博热搜第 ${row.rank} 位${tag}`, now))
    }
  } else {
    warnings.push(`微博热搜：${errorText(weibo.reason)}`)
  }

  if (baidu.status === 'fulfilled') {
    for (const row of baidu.value) {
      const metrics: FeedMetrics = { heat: row.heat, rank: row.rank }
      // 百度的 desc 经常比标题本身更有信息量，优先用它当摘要
      const summary = row.desc !== '' ? row.desc : `百度热搜第 ${row.rank} 位`
      items.push(toItem('baidu', row.word, metrics, summary, now, row.cover))
    }
  } else {
    warnings.push(`百度热搜：${errorText(baidu.reason)}`)
  }

  if (items.length === 0) {
    throw new Error(warnings.join('；') || '三个热搜源都没有返回数据')
  }

  return { items, warnings }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
