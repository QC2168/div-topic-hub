/** 设置读写（含 API Key 掩码规则），路由层只做搬运。 */
/**
 * 用相对路径而不是 `#shared/types`：这是全服务端唯一的**值导入**（其余全是 `import type`，
 * 转译时被擦除），而 `#shared` 是 Nuxt 的 tsconfig 别名，在 Nuxt 之外（scripts/ 下的
 * 快照脚本用 Bun 直接跑）解析不到。改成相对路径后两边都能加载，Vite/Nitro 同样认相对路径。
 */
import type { HubSettings, RssFeedConfig } from '../../shared/types'
import { BUILTIN_RSS_FEEDS, DEFAULT_SETTINGS } from '../../shared/types'
import { readSetting, writeSetting } from './db'

export function maskKey(key: string): string {
  if (key === '') return ''
  if (key.length <= 8) return '••••••••'
  return `${key.slice(0, 4)}••••${key.slice(-4)}`
}

export function loadHubSettings(): HubSettings {
  const stored = readSetting<Partial<HubSettings>>('hubSettings', {})
  const merged: HubSettings = { ...DEFAULT_SETTINGS, ...stored }
  // 数组类字段做类型兜底，避免手改数据库写坏结构
  if (!Array.isArray(merged.rssFeeds)) merged.rssFeeds = DEFAULT_SETTINGS.rssFeeds
  if (!Array.isArray(merged.upUids)) merged.upUids = []
  return merged
}

/**
 * 旧版本把这三个源写死在默认设置里，会随首次保存落进库；现在改由 BUILTIN_RSS_FEEDS
 * 统一维护。其中「机器之心」的 /rss 已经变成 SPA 的 HTML 外壳（实测原样返回网页），
 * 留着只会每次采集都报一条「解析为空」，所以在这里一次性摘掉。
 * 幂等：摘过之后库里就没有了，重复调用无副作用。
 */
const LEGACY_FEED_URLS = new Set([
  'https://huggingface.co/blog/feed.xml',
  'https://www.jiqizhixin.com/rss',
  'https://www.qbitai.com/feed'
])

/**
 * 实际参与采集的 RSS 列表 = 内置源 + 用户自定义源（按 URL 去重）。
 *
 * 分开存的好处：内置源升级（加源/换地址）对已有用户直接生效，不需要用户重填；
 * 用户自己加的源也不会被内置源的更新冲掉。
 */
export function resolveRssFeeds(settings: HubSettings): RssFeedConfig[] {
  const seen = new Set(BUILTIN_RSS_FEEDS.map(feed => feed.url))
  const custom = settings.rssFeeds.filter((feed) => {
    if (seen.has(feed.url) || LEGACY_FEED_URLS.has(feed.url)) return false
    seen.add(feed.url)
    return true
  })
  return [...BUILTIN_RSS_FEEDS, ...custom]
}

export interface PublicSettings extends Omit<HubSettings, 'deepseekApiKey'> {
  hasApiKey: boolean
  apiKeyMasked: string
  /** 只读：让设置页能显示「内置源也在这跑」，避免用户以为漏采集 */
  builtinRssFeeds: RssFeedConfig[]
}

/** 回给前端的安全视图：不含明文 Key。 */
export function toPublicSettings(settings: HubSettings): PublicSettings {
  const { deepseekApiKey, ...rest } = settings
  const key = deepseekApiKey ?? ''
  return {
    ...rest,
    hasApiKey: key !== '',
    apiKeyMasked: maskKey(key),
    builtinRssFeeds: BUILTIN_RSS_FEEDS
  }
}

export interface SettingsPatch {
  deepseekApiKey?: string
  clearApiKey?: boolean
  deepseekBaseUrl?: string
  deepseekModel?: string
  rssFeeds?: Array<{ name: string, url: string }>
  upUids?: number[]
  autoRefreshMinutes?: number
}

/** 只覆盖显式传入的字段；空字符串的 Key 视为「不修改」，避免清空误操作。 */
export function patchHubSettings(patch: SettingsPatch): HubSettings {
  const current = loadHubSettings()
  const next: HubSettings = { ...current }

  if (patch.clearApiKey === true) {
    next.deepseekApiKey = ''
  } else if (typeof patch.deepseekApiKey === 'string' && patch.deepseekApiKey.trim() !== '') {
    next.deepseekApiKey = patch.deepseekApiKey.trim()
  }
  if (typeof patch.deepseekBaseUrl === 'string' && patch.deepseekBaseUrl.trim() !== '') {
    next.deepseekBaseUrl = patch.deepseekBaseUrl.trim().replace(/\/$/, '')
  }
  if (typeof patch.deepseekModel === 'string' && patch.deepseekModel.trim() !== '') {
    next.deepseekModel = patch.deepseekModel.trim()
  }
  if (Array.isArray(patch.rssFeeds)) {
    next.rssFeeds = patch.rssFeeds
      .filter(feed => typeof feed?.url === 'string' && /^https?:\/\//.test(feed.url))
      .map(feed => ({ name: String(feed.name || feed.url).slice(0, 60), url: feed.url.trim() }))
      .slice(0, 20)
  }
  if (Array.isArray(patch.upUids)) {
    next.upUids = patch.upUids
      .map(uid => Number(uid))
      .filter(uid => Number.isFinite(uid) && uid > 0)
      .slice(0, 20)
  }
  if (typeof patch.autoRefreshMinutes === 'number' && Number.isFinite(patch.autoRefreshMinutes)) {
    next.autoRefreshMinutes = Math.min(Math.max(Math.round(patch.autoRefreshMinutes), 5), 720)
  }

  writeSetting('hubSettings', next)
  return next
}
