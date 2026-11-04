/** 爆发分与爆发标签的统一算法（B站 / GitHub / RSS 共用）。 */
import type { BadgeKey, FeedBadge, FeedMetrics, Platform } from '#shared/types'

const HOUR = 3_600_000

export interface ScoreInput {
  platform: Platform
  metrics: FeedMetrics
  publishedAt: string | null
  /** 出现在「综合热门」推荐流里，说明短期确实在冲 */
  hotBoard?: boolean
  now?: number
}

/** 视频年龄（小时），未知发布时间时按 72 小时保守估计。 */
function ageHours(publishedAt: string | null, now: number): number {
  if (publishedAt === null) return 72
  const ts = Date.parse(publishedAt)
  if (Number.isNaN(ts)) return 72
  return Math.max(1, (now - ts) / HOUR)
}

export function interactionRate(metrics: FeedMetrics): number {
  const play = metrics.play ?? 0
  if (play <= 0) return 0
  const engaged = (metrics.like ?? 0) + (metrics.reply ?? 0) + (metrics.danmaku ?? 0) + (metrics.favorite ?? 0) + (metrics.coin ?? 0)
  return engaged / play
}

/**
 * 破圈系数：播放量相对 UP 主粉丝数的倍数。
 *
 * 为什么需要它：只看绝对播放量的话，500 万粉的号发什么都百万播放，永远霸榜；
 * 而 3 千粉跑出 20 万播放才是真黑马，却因为绝对量进不了前列。用「播放/粉丝」
 * 做归一化，把「基本盘」和「破圈」区分开。
 *
 * 阈值来自实采样本：大号平时倍率在 0.1~0.5，正常热门 1~2，明显破圈 3 以上。
 */
export function breakoutRatio(play: number | undefined, fans: number | undefined): number | null {
  if (fans === undefined || fans <= 0 || play === undefined) return null
  return play / fans
}

function breakoutBonus(play: number, fans: number | undefined): number {
  const ratio = breakoutRatio(play, fans)
  if (ratio === null) return 0
  if (ratio >= 10) return 12
  if (ratio >= 3) return 8
  if (ratio >= 1.5) return 4
  return 0
}

/**
 * 爆发分：基数（体量）+ 速度（单位时间播放）+ 互动率 + 新鲜度。
 * 刻意让「速度」权重高于「体量」——这样小 UP 的高速爆发能压过老爆款。
 */
export function scoreItem(input: ScoreInput): number {
  const now = input.now ?? Date.now()
  const metrics = input.metrics

  // 热搜类：只有热度值和名次，没有播放量。套用下面的播放速度公式会算出荒唐数值，
  // 所以单独一条分支——热度做底，名次做加成。
  if (input.platform === 'douyin' || input.platform === 'weibo' || input.platform === 'baidu') {
    const heat = metrics.heat ?? 0
    const rank = metrics.rank ?? 999
    const rankBonus = rank <= 3 ? 10 : rank <= 10 ? 6 : rank <= 20 ? 3 : 0
    return round(Math.log10(heat + 1) * 10 + rankBonus)
  }

  if (input.platform === 'huggingface') {
    // HF 一个平台装了三类东西，靠字段区分：论文有 upvotes，模型/Space 有 trendingScore
    if (metrics.upvotes !== undefined) {
      const hours = ageHours(input.publishedAt, now)
      // 票数权重高于新鲜度：0 票的新论文不如 40 票的前天的
      return round(Math.log10(metrics.upvotes + 1) * 26 + Math.max(0, 30 - hours / 8))
    }
    const trend = metrics.trendingScore ?? 0
    const downloads = metrics.downloads ?? 0
    return round(Math.log10(trend + 1) * 22 + Math.log10(downloads + 1) * 3)
  }

  if (input.platform === 'github') {
    const stars = metrics.stars ?? 0
    const today = metrics.starsToday ?? 0
    // 日增权重远高于存量：这个页面要的是「今天在冲的」，不是「一直很大的」
    return round(Math.log10(stars + 1) * 6 + Math.log10(today + 1) * 35)
  }

  if (input.platform === 'rss') {
    const hours = ageHours(input.publishedAt, now)
    return round(Math.max(0, 60 - hours / 4))
  }

  if (input.platform === 'arxiv') {
    // 论文没有互动指标，只能靠「多新」排序：半天内最新的排最前
    const hours = ageHours(input.publishedAt, now)
    return round(Math.max(0, 55 - hours / 5))
  }

  if (input.platform === 'hn') {
    const points = metrics.points ?? 0
    const hours = ageHours(input.publishedAt, now)
    const pointsPerHour = points / hours
    // 和 B 站同理：单位时间涨分权重压过总分，让「刚上首页就在涨」的压过「昨天的老热帖」
    return round(
      Math.log10(points + 1) * 10
      + Math.log10(pointsPerHour + 1) * 18
      + (hours <= 12 ? 8 : hours <= 24 ? 5 : 0)
    )
  }

  const play = metrics.play ?? 0
  const hours = ageHours(input.publishedAt, now)
  const playPerHour = play / hours
  const interaction = interactionRate(metrics)
  const freshness = hours <= 24 ? 12 : hours <= 72 ? 8 : hours <= 168 ? 4 : 0
  const boardBonus = (input.hotBoard ?? false) ? 6 : 0
  const breakout = breakoutBonus(play, metrics.fans)

  return round(
    Math.log10(play + 1) * 9
    + Math.log10(playPerHour + 1) * 15
    + Math.min(interaction, 0.2) * 180
    + freshness
    + boardBonus
    + breakout
  )
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}

interface BadgeSpec {
  key: BadgeKey
  label: string
  tone: FeedBadge['tone']
  hit: boolean
}

/**
 * 爆发标签：最多保留 3 个，按「最抓眼」的顺序取。
 * 阈值刻意写成常量，方便后续在设置页开放自定义。
 */
export function computeBadges(input: ScoreInput): FeedBadge[] {
  const now = input.now ?? Date.now()
  const metrics = input.metrics
  const hours = ageHours(input.publishedAt, now)

  if (input.platform === 'douyin' || input.platform === 'weibo' || input.platform === 'baidu') {
    const heat = metrics.heat ?? 0
    const rank = metrics.rank ?? 999
    const specs: BadgeSpec[] = [
      { key: 'hot', label: `🔥 热度 ${formatCount(heat)}`, tone: 'error', hit: heat >= 10_000_000 },
      { key: 'trending', label: '🥇 榜一', tone: 'warning', hit: rank === 1 },
      { key: 'dark-horse', label: '📈 前十', tone: 'primary', hit: rank <= 10 }
    ]
    return pick(specs)
  }

  if (input.platform === 'huggingface') {
    if (metrics.upvotes !== undefined) {
      const specs: BadgeSpec[] = [
        { key: 'hot', label: '⭐ 社区高票', tone: 'warning', hit: (metrics.upvotes ?? 0) >= 20 },
        { key: 'brand-new', label: '📄 今日精选', tone: 'primary', hit: hours <= 24 },
        { key: 'dark-horse', label: '🆕 有票但不多', tone: 'neutral', hit: (metrics.upvotes ?? 0) > 0 && (metrics.upvotes ?? 0) < 20 }
      ]
      return pick(specs)
    }
    const trend = metrics.trendingScore ?? 0
    const specs: BadgeSpec[] = [
      { key: 'trending', label: '📈 趋势榜前列', tone: 'error', hit: trend >= 500 },
      { key: 'hot', label: '🔥 趋势榜', tone: 'warning', hit: trend >= 200 },
      { key: 'brand-new', label: '🌱 一周内新发布', tone: 'success', hit: hours <= 24 * 7 }
    ]
    return pick(specs)
  }

  if (input.platform === 'github') {
    const today = metrics.starsToday ?? 0
    const specs: BadgeSpec[] = [
      { key: 'trending', label: `📈 今日 +${formatCount(today)} star`, tone: 'warning', hit: today >= 300 },
      { key: 'hot', label: '🔥 Star 破万', tone: 'error', hit: (metrics.stars ?? 0) >= 10_000 },
      { key: 'brand-new', label: '🌱 新项目', tone: 'success', hit: hours <= 24 * 30 }
    ]
    return pick(specs)
  }

  if (input.platform === 'rss') {
    const specs: BadgeSpec[] = [
      { key: 'brand-new', label: '📰 今日更新', tone: 'primary', hit: hours <= 24 },
      { key: 'brand-new', label: '🆕 近 3 日', tone: 'neutral', hit: hours <= 72 }
    ]
    return pick(specs)
  }

  if (input.platform === 'arxiv') {
    const specs: BadgeSpec[] = [
      { key: 'brand-new', label: '📄 24 小时内', tone: 'primary', hit: hours <= 24 },
      { key: 'brand-new', label: '🆕 近 3 日', tone: 'neutral', hit: hours <= 72 }
    ]
    return pick(specs)
  }

  if (input.platform === 'hn') {
    const points = metrics.points ?? 0
    const specs: BadgeSpec[] = [
      { key: 'hot', label: '🔥 破 500 分', tone: 'error', hit: points >= 500 },
      { key: 'interactive', label: '⚡ 讨论破 200', tone: 'warning', hit: (metrics.reply ?? 0) >= 200 },
      { key: 'dark-horse', label: '🐴 12 小时内', tone: 'primary', hit: hours <= 12 },
      { key: 'brand-new', label: '🌱 3 小时新帖', tone: 'success', hit: hours <= 3 }
    ]
    return pick(specs)
  }

  const play = metrics.play ?? 0
  const rate = interactionRate(metrics)
  const playPerHour = play / hours
  const ratio = breakoutRatio(play, metrics.fans)
  const fans = metrics.fans ?? 0
  const specs: BadgeSpec[] = [
    { key: 'hot', label: '🔥 播放破 50 万', tone: 'error', hit: play >= 500_000 },
    // 两个破圈标签互斥：10 万粉以下叫「小号爆款」（更值得追），以上叫「破圈爆发」
    {
      key: 'breakout',
      label: '🐣 小号爆款',
      tone: 'success',
      hit: ratio !== null && ratio >= 3 && fans > 0 && fans <= 100_000
    },
    {
      key: 'breakout',
      label: '📈 破圈爆发',
      tone: 'warning',
      hit: ratio !== null && ratio >= 10 && fans > 100_000
    },
    { key: 'interactive', label: '⚡ 互动率极高', tone: 'warning', hit: rate >= 0.06 },
    { key: 'dark-horse', label: '🐴 近期黑马', tone: 'primary', hit: hours <= 168 && playPerHour >= 3_000 },
    { key: 'brand-new', label: '🌱 新星起飞', tone: 'success', hit: hours <= 48 && play >= 50_000 }
  ]
  return pick(specs)
}

function pick(specs: BadgeSpec[]): FeedBadge[] {
  return specs
    .filter(spec => spec.hit)
    .slice(0, 3)
    .map(({ key, label, tone }) => ({ key, label, tone }))
}

/** 12345 → 1.2万；用于标签文案与前端展示复用。 */
export function formatCount(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0'
  if (value >= 100_000_000) return `${(value / 100_000_000).toFixed(1)}亿`
  if (value >= 10_000) return `${(value / 10_000).toFixed(1)}万`
  return String(Math.round(value))
}
