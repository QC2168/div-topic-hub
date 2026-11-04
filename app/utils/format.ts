/** 展示层格式化：数字、时间、指标行。 */
import type { FeedItem, FeedMetrics } from '#shared/types'

/** 12345 → 1.2万 */
export function fmtCount(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return '0'
  if (value >= 100_000_000) return `${(value / 100_000_000).toFixed(1)}亿`
  if (value >= 10_000) return `${(value / 10_000).toFixed(1)}万`
  return String(Math.round(value))
}

/** 「3 小时前 / 昨天 / 3 天前」 */
export function fmtRelative(iso: string | null | undefined): string {
  if (iso === null || iso === undefined) return ''
  const ts = Date.parse(iso)
  if (Number.isNaN(ts)) return ''
  const diff = Date.now() - ts
  if (diff < 0) return '刚刚'
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  const days = Math.floor(hours / 24)
  if (days === 1) return '昨天'
  if (days < 30) return `${days} 天前`
  return new Date(ts).toLocaleDateString('zh-CN')
}

/** 「6 小时」这类粗粒度年龄，用于判断热度窗口 */
export function fmtAge(iso: string | null | undefined): string {
  if (iso === null || iso === undefined) return '时间未知'
  const ts = Date.parse(iso)
  if (Number.isNaN(ts)) return '时间未知'
  const hours = Math.max(0, (Date.now() - ts) / 3_600_000)
  if (hours < 1) return '1 小时内'
  if (hours < 24) return `${Math.round(hours)} 小时内`
  return `${Math.round(hours / 24)} 天内`
}

/** 卡片右侧的主指标（不同平台取不同字段） */
export function primaryMetric(item: FeedItem): { label: string, value: string } {
  if (item.platform === 'bilibili') {
    return { label: '播放', value: fmtCount(item.metrics.play) }
  }
  if (item.platform === 'github') {
    const today = item.metrics.starsToday ?? 0
    return today > 0
      ? { label: '今日 star', value: `+${fmtCount(today)}` }
      : { label: 'Star', value: fmtCount(item.metrics.stars) }
  }
  if (item.platform === 'hn') {
    return { label: '分', value: fmtCount(item.metrics.points) }
  }
  if (item.platform === 'arxiv') {
    return { label: '提交于', value: fmtRelative(item.publishedAt) }
  }
  // 热搜类：主指标就是热度，位次放进详情胶囊
  if (item.platform === 'douyin' || item.platform === 'weibo' || item.platform === 'baidu') {
    return { label: '热度', value: fmtCount(item.metrics.heat) }
  }
  // HF：论文看票数，模型/Space 看趋势分
  if (item.platform === 'huggingface') {
    return item.metrics.upvotes !== undefined
      ? { label: '社区票', value: fmtCount(item.metrics.upvotes) }
      : { label: '趋势分', value: fmtCount(item.metrics.trendingScore) }
  }
  return { label: '更新', value: fmtRelative(item.publishedAt) }
}

/** 详情页的指标胶囊列表 */
export function metricPills(metrics: FeedMetrics): Array<{ label: string, value: string, icon: string }> {
  const pills: Array<{ label: string, value: string, icon: string }> = []
  if (metrics.play !== undefined) pills.push({ label: '播放', value: fmtCount(metrics.play), icon: 'i-lucide-play' })
  if (metrics.like !== undefined && metrics.like > 0) pills.push({ label: '点赞', value: fmtCount(metrics.like), icon: 'i-lucide-thumbs-up' })
  if (metrics.reply !== undefined && metrics.reply > 0) pills.push({ label: '评论', value: fmtCount(metrics.reply), icon: 'i-lucide-message-circle' })
  if (metrics.danmaku !== undefined && metrics.danmaku > 0) pills.push({ label: '弹幕', value: fmtCount(metrics.danmaku), icon: 'i-lucide-messages-square' })
  if (metrics.favorite !== undefined && metrics.favorite > 0) pills.push({ label: '收藏', value: fmtCount(metrics.favorite), icon: 'i-lucide-star' })
  if (metrics.stars !== undefined) pills.push({ label: 'Star', value: fmtCount(metrics.stars), icon: 'i-lucide-star' })
  if (metrics.starsToday !== undefined && metrics.starsToday > 0) pills.push({ label: '今日 +', value: fmtCount(metrics.starsToday), icon: 'i-lucide-trending-up' })
  if (metrics.points !== undefined) pills.push({ label: '得分', value: fmtCount(metrics.points), icon: 'i-lucide-flame' })
  if (metrics.heat !== undefined) pills.push({ label: '热度', value: fmtCount(metrics.heat), icon: 'i-lucide-flame' })
  if (metrics.rank !== undefined) pills.push({ label: '榜位', value: `第 ${metrics.rank}`, icon: 'i-lucide-trophy' })
  if (metrics.trendingScore !== undefined) pills.push({ label: '趋势分', value: fmtCount(metrics.trendingScore), icon: 'i-lucide-trending-up' })
  if (metrics.upvotes !== undefined) pills.push({ label: '社区票', value: fmtCount(metrics.upvotes), icon: 'i-lucide-thumbs-up' })
  if (metrics.downloads !== undefined && metrics.downloads > 0) pills.push({ label: '下载', value: fmtCount(metrics.downloads), icon: 'i-lucide-download' })
  return pills
}

/** 互动率百分比（B站专用） */
export function fmtInteractionRate(metrics: FeedMetrics): string | null {
  const play = metrics.play ?? 0
  if (play <= 0) return null
  const engaged = (metrics.like ?? 0) + (metrics.reply ?? 0) + (metrics.danmaku ?? 0) + (metrics.favorite ?? 0)
  return `${((engaged / play) * 100).toFixed(1)}%`
}
