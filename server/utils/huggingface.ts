/**
 * HuggingFace 三条免费榜单：趋势模型 / 趋势 Space / 每日论文。
 *
 * 全部是官方公开接口，不需要 token、不需要注册、不花钱。响应一般 200~600ms。
 *
 * ── 为什么是这三条 ──
 * 它们覆盖了 AI 选题的三个不同层次：
 *   趋势模型 → 技术热点（全世界的开发者在下载什么）
 *   趋势 Space → 产品热点（今天新出了什么能直接上手玩的 AI 应用）
 *   每日论文 → 学术热点（社区已经帮你从当天几十篇里投过票了）
 *
 * 其中「趋势 Space」是现有数据源完全没有的角度：一个刚上榜的 Space
 * 就是「大部分观众还没见过的新 AI 工具」，天然适合做实测类视频。
 *
 * ── 一个必须处理的问题 ──
 * huggingface.co 在部分网络下 TLS 握手会偶发失败（实测第一次请求就断了，
 * 重试即通）。所以这里所有请求都带一次重试，而不是失败就报警。
 */
import type { FeedComment, FeedMetrics } from '#shared/types'

const UA = 'topic-hub/1.0 (+local personal use)'
const BASE = 'https://huggingface.co'

export type HfKind = 'hf-model' | 'hf-space' | 'hf-paper'

export interface RawHfItem {
  id: string
  title: string
  author: string | null
  url: string
  summary: string
  publishedAt: string | null
  metrics: FeedMetrics
  comments: FeedComment[]
  kind: HfKind
}

/**
 * 带一次重试的 GET。
 * HF 的失败大多发生在 TLS 握手阶段（curl exit 35 / fetch 抛 TypeError），
 * 属于网络抖动而不是接口挂了，重试通常就能过。
 */
async function fetchJson<T>(path: string, timeoutMs = 20_000): Promise<T> {
  let lastError: unknown
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(`${BASE}${path}`, {
        headers: { 'user-agent': UA, 'accept': 'application/json' },
        signal: AbortSignal.timeout(timeoutMs)
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return await res.json() as T
    } catch (error) {
      lastError = error
      if (attempt === 0) await new Promise(resolve => setTimeout(resolve, 500))
    }
  }
  throw new Error(`HF ${path} 请求失败：${lastError instanceof Error ? lastError.message : String(lastError)}`)
}

function toIso(raw: string | undefined | null): string | null {
  if (raw === undefined || raw === null || raw === '') return null
  const ts = Date.parse(raw)
  return Number.isNaN(ts) ? null : new Date(ts).toISOString()
}

/** `deepseek-ai/DeepSeek-V4.1-Flash` → 作者 `deepseek-ai` */
function ownerOf(repoId: string): string | null {
  const slash = repoId.indexOf('/')
  return slash > 0 ? repoId.slice(0, slash) : null
}

/* ── 趋势模型 ── */

interface HfRepo {
  id?: string
  likes?: number
  trendingScore?: number
  downloads?: number
  pipeline_tag?: string | null
  sdk?: string
  createdAt?: string
  tags?: string[]
}

function modelToRaw(row: HfRepo): RawHfItem | null {
  const id = (row.id ?? '').trim()
  if (id === '') return null
  const task = row.pipeline_tag ?? ''
  const downloads = row.downloads ?? 0
  const likes = row.likes ?? 0

  const bits: string[] = []
  if (task !== '') bits.push(task)
  if (downloads > 0) bits.push(`下载 ${formatCount(downloads)}`)
  if (likes > 0) bits.push(`${formatCount(likes)} 赞`)

  return {
    id: `hf-model:${id}`,
    title: id,
    author: ownerOf(id),
    url: `${BASE}/${id}`,
    summary: bits.join(' · '),
    publishedAt: toIso(row.createdAt),
    metrics: {
      trendingScore: row.trendingScore ?? 0,
      like: likes,
      downloads
    },
    comments: [],
    kind: 'hf-model'
  }
}

export async function fetchHfTrendingModels(limit = 25): Promise<RawHfItem[]> {
  const rows = await fetchJson<HfRepo[]>(`/api/models?sort=trendingScore&direction=-1&limit=${limit}`)
  const items = rows.map(modelToRaw).filter((item): item is RawHfItem => item !== null)
  if (items.length === 0) throw new Error('HF 趋势模型返回空列表')
  return items
}

/* ── 趋势 Space ── */

function spaceToRaw(row: HfRepo): RawHfItem | null {
  const id = (row.id ?? '').trim()
  if (id === '') return null
  const likes = row.likes ?? 0

  const bits: string[] = ['可直接打开的 AI 应用']
  if (row.sdk !== undefined && row.sdk !== '') bits.push(row.sdk)
  if (likes > 0) bits.push(`${formatCount(likes)} 赞`)

  return {
    id: `hf-space:${id}`,
    title: id,
    author: ownerOf(id),
    url: `${BASE}/spaces/${id}`,
    summary: bits.join(' · '),
    publishedAt: toIso(row.createdAt),
    metrics: { trendingScore: row.trendingScore ?? 0, like: likes },
    comments: [],
    kind: 'hf-space'
  }
}

export async function fetchHfTrendingSpaces(limit = 20): Promise<RawHfItem[]> {
  const rows = await fetchJson<HfRepo[]>(`/api/spaces?sort=trendingScore&direction=-1&limit=${limit}`)
  const items = rows.map(spaceToRaw).filter((item): item is RawHfItem => item !== null)
  if (items.length === 0) throw new Error('HF 趋势 Space 返回空列表')
  return items
}

/* ── 每日论文 ── */

/** HF 的 organization 实测是对象，但也见过字符串形式，两种都接 */
type HfOrg = { name?: string, fullname?: string } | string | null

interface HfPaperRow {
  paper?: {
    id?: string
    title?: string
    summary?: string
    upvotes?: number
    publishedAt?: string
    githubRepo?: string | null
    /**
     * 实测是**对象**而不是字符串：`{ _id, name, fullname, avatar }`。
     * 直接塞进 sqlite 会抛 "cannot be bound to SQLite parameter"，
     * 而且是整批采集 500，所以必须在这里取出口径里的 name。
     */
    organization?: HfOrg
    ai_keywords?: string[]
  }
  numComments?: number
}

function orgName(org: HfOrg | undefined): string | null {
  if (org === undefined || org === null) return null
  if (typeof org === 'string') return org === '' ? null : org
  const name = org.name ?? org.fullname ?? ''
  return name === '' ? null : name
}

function paperToRaw(row: HfPaperRow): RawHfItem | null {
  const paper = row.paper
  const id = (paper?.id ?? '').trim()
  const title = (paper?.title ?? '').trim()
  if (id === '' || title === '') return null

  const bits: string[] = []
  const keywords = (paper?.ai_keywords ?? []).slice(0, 3)
  if (keywords.length > 0) bits.push(keywords.join('、'))
  if (typeof paper?.githubRepo === 'string' && paper.githubRepo !== '') bits.push('有代码')

  // HF 的 summary 是完整摘要，截断到 300 字给卡片用；拆解时够 AI 判断主题
  const summary = (paper?.summary ?? '').replace(/\s+/g, ' ').trim()
  const combined = [bits.join(' · '), summary].filter(part => part !== '').join('　')

  return {
    id: `hf-paper:${id}`,
    title,
    author: orgName(paper?.organization),
    url: `${BASE}/papers/${id}`,
    summary: combined.slice(0, 300),
    publishedAt: toIso(paper?.publishedAt),
    metrics: { upvotes: paper?.upvotes ?? 0, reply: row.numComments ?? 0 },
    comments: [],
    kind: 'hf-paper'
  }
}

export async function fetchHfDailyPapers(limit = 30): Promise<RawHfItem[]> {
  const rows = await fetchJson<HfPaperRow[]>(`/api/daily_papers?limit=${limit}`)
  const items = rows.map(paperToRaw).filter((item): item is RawHfItem => item !== null)
  if (items.length === 0) throw new Error('HF 每日论文返回空列表')
  return items
}

function formatCount(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0'
  if (value >= 100_000_000) return `${(value / 100_000_000).toFixed(1)}亿`
  if (value >= 10_000) return `${(value / 10_000).toFixed(1)}万`
  return String(Math.round(value))
}
