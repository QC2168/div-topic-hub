/** 前后端共享的数据契约（app 与 server 都从这里取类型）。 */

export type Platform = 'bilibili' | 'github' | 'rss' | 'hn' | 'arxiv' | 'douyin' | 'weibo' | 'baidu' | 'huggingface'

export type FeedCategory = 'bili-tech' | 'bili-knowledge' | 'github' | 'ai-news' | 'community' | 'paper' | 'hot-search' | 'ai-board'

/** 一条高赞评论（辅助 AI 分析观众槽点与讨论梗）。 */
export interface FeedComment {
  author: string
  content: string
  likes: number
}

/** 指标快照：不同平台用到的字段不同，缺省即无该指标。 */
export interface FeedMetrics {
  play?: number
  like?: number
  reply?: number
  danmaku?: number
  favorite?: number
  coin?: number
  share?: number
  stars?: number
  /** GitHub：今日新增 star */
  starsToday?: number
  /** B站：粉丝数（用于判断黑马体量） */
  fans?: number
  /** Hacker News：得分（相当于播放/star，是它唯一的热度信号） */
  points?: number
  /** 热搜类（抖音/微博）：榜单热度值，量纲各家不同，只在本平台内比较 */
  heat?: number
  /** 热搜类：榜单名次，1 为最高 */
  rank?: number
  /**
   * 抖音：热榜返回的 video_count 原值。
   *
   * **不要用它判断竞争度。** 实测 1200 万热度的榜一条目只有 2 条，
   * 说明它的口径不是「相关视频总数」（可能是内部精选计数），含义未经验证。
   * 字段留着是为了排查和将来搞清口径，UI 不展示、也不参与排序。
   */
  videoCount?: number
  /** HuggingFace：趋势分，由下载/点赞等按时间衰减滚动算出，小时级更新 */
  trendingScore?: number
  /** HuggingFace 每日论文：社区投票数（比 arXiv 的原始列表多一层人工筛选） */
  upvotes?: number
  /** HuggingFace 模型：累计下载量 */
  downloads?: number
}

export type BadgeKey = 'hot' | 'interactive' | 'dark-horse' | 'trending' | 'brand-new' | 'breakout'

export interface FeedBadge {
  key: BadgeKey
  label: string
  /** 语义色调，前端映射到 Nuxt UI 的 color */
  tone: 'error' | 'warning' | 'primary' | 'success' | 'neutral'
}

export interface FeedItem {
  id: string
  platform: Platform
  category: FeedCategory
  title: string
  author: string | null
  url: string
  cover: string | null
  summary: string
  metrics: FeedMetrics
  comments: FeedComment[]
  badges: FeedBadge[]
  publishedAt: string | null
  fetchedAt: string
  /** 排序权重（后端算好的爆发分） */
  score: number
}

export type TopicStatus = 'idea' | 'scripting' | 'published' | 'dropped'

export interface SavedTopic {
  id: number
  sourceItemId: string | null
  title: string
  url: string | null
  platform: Platform | null
  category: FeedCategory | null
  metrics: FeedMetrics
  comments: FeedComment[]
  aiAnalysisMd: string | null
  status: TopicStatus
  createdAt: string
}

export interface RssFeedConfig {
  name: string
  url: string
}

export interface HubSettings {
  /** 永不明文回传前端，GET 只返回掩码与是否已配置 */
  deepseekApiKey?: string
  deepseekBaseUrl: string
  deepseekModel: string
  rssFeeds: RssFeedConfig[]
  /** 额外关注的 UP 主 UID，采集时一并拉取其近期作品 */
  upUids: number[]
  autoRefreshMinutes: number
}

/**
 * 内置 RSS 源：始终参与采集，不写入用户设置，也不能在设置页删除。
 * 全部是官方 feed（200 实测通过），改版导致解析为空时只会在采集告警里体现。
 * 想加量的正路就在这儿——加官方源，而不是去啃灰产接口。
 */
export const BUILTIN_RSS_FEEDS: RssFeedConfig[] = [
  { name: 'OpenAI', url: 'https://openai.com/blog/rss.xml' },
  { name: 'Google DeepMind', url: 'https://deepmind.google/blog/rss.xml' },
  { name: 'Google Research', url: 'https://research.google/blog/rss/' },
  { name: 'HuggingFace Blog', url: 'https://huggingface.co/blog/feed.xml' },
  { name: 'MIT News AI', url: 'https://news.mit.edu/rss/topic/artificial-intelligence2' },
  { name: 'The Verge AI', url: 'https://www.theverge.com/rss/ai-artificial-intelligence/index.xml' },
  { name: 'TechCrunch AI', url: 'https://techcrunch.com/category/artificial-intelligence/feed/' },
  { name: 'Simon Willison', url: 'https://simonwillison.net/atom/everything/' },
  { name: '量子位', url: 'https://www.qbitai.com/feed' }
]

export const DEFAULT_SETTINGS: HubSettings = {
  deepseekApiKey: '',
  deepseekBaseUrl: 'https://api.deepseek.com',
  deepseekModel: 'deepseek-chat',
  /** 只存「用户自定义追加」的源；内置源见 BUILTIN_RSS_FEEDS，由后端自动合并 */
  rssFeeds: [],
  upUids: [],
  autoRefreshMinutes: 30
}

/** 采集接口的统一返回外壳。 */
export interface RadarResponse<T> {
  items: T[]
  /** 各子来源的独立失败信息，不影响主流程 */
  warnings: string[]
  fetchedAt: string
}

export const CATEGORY_LABELS: Record<FeedCategory, string> = {
  'bili-tech': 'B站科技',
  'bili-knowledge': 'B站知识',
  'github': 'GitHub 飙升',
  'ai-news': 'AI 快讯',
  'community': 'HN 热帖',
  'paper': 'arXiv 新论文',
  'hot-search': '全网热搜',
  'ai-board': 'HF 榜单'
}

export const CATEGORY_ICONS: Record<FeedCategory, string> = {
  'bili-tech': 'i-lucide-cpu',
  'bili-knowledge': 'i-lucide-graduation-cap',
  'github': 'i-simple-icons-github',
  'ai-news': 'i-lucide-newspaper',
  'community': 'i-lucide-messages-square',
  'paper': 'i-lucide-file-text',
  'hot-search': 'i-lucide-flame',
  'ai-board': 'i-lucide-trophy'
}

/** 平台短标签（选题池、宿主导出、卡片脚注共用）。 */
export const PLATFORM_LABELS: Record<Platform, string> = {
  bilibili: 'B 站',
  github: 'GitHub',
  rss: 'AI 资讯',
  hn: 'HN',
  arxiv: 'arXiv',
  douyin: '抖音',
  weibo: '微博',
  baidu: '百度',
  huggingface: 'HF'
}
