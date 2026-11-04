/** feed_items / saved_topics 的读写封装，API 层只跟这里打交道。 */
import type { FeedCategory, FeedComment, FeedItem, FeedMetrics, Platform, SavedTopic, TopicStatus } from '#shared/types'
import { nowIso, sqlValue, useDb } from './db'

interface FeedRow {
  id: string
  platform: string
  category: string
  title: string
  author: string | null
  url: string
  cover: string | null
  summary: string | null
  metrics_json: string
  comments_json: string
  badges_json: string
  published_at: string | null
  fetched_at: string
  score: number
}

function parseJson<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== 'string' || raw === '') return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function rowToItem(row: FeedRow): FeedItem {
  return {
    id: row.id,
    platform: row.platform as Platform,
    category: row.category as FeedCategory,
    title: row.title,
    author: row.author,
    url: row.url,
    cover: row.cover,
    summary: row.summary ?? '',
    metrics: parseJson<FeedMetrics>(row.metrics_json, {}),
    comments: parseJson<FeedComment[]>(row.comments_json, []),
    badges: parseJson<FeedItem['badges']>(row.badges_json, []),
    publishedAt: row.published_at,
    fetchedAt: row.fetched_at,
    score: row.score
  }
}

/**
 * 落库前的最后一道类型清洗。
 *
 * 起因：HF 论文的 organization 是对象而不是字符串，直接绑定就抛
 * "Provided value cannot be bound to SQLite parameter"，而且**整批采集 500**——
 * 一个上游字段的形态变化能拖垮整个刷新，这是不可接受的。
 * 所以凡是写进 sqlite 的文本字段，都在这里强制成 string | null。
 */
function asText(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  // 对象/数组不猜结构，明确丢掉——宁可少一个作者名，也不能让整批入库失败
  return null
}

/** 批量 upsert；同一 id 只更新指标与标签，不覆盖已抓到的评论。 */
export function upsertFeedItems(items: FeedItem[]): number {
  if (items.length === 0) return 0
  const db = useDb()
  const stmt = db.prepare(`
    INSERT INTO feed_items (id, platform, category, title, author, url, cover, summary, metrics_json, comments_json, badges_json, published_at, fetched_at, score)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      category = excluded.category,
      title = excluded.title,
      author = excluded.author,
      url = excluded.url,
      cover = COALESCE(excluded.cover, feed_items.cover),
      summary = CASE WHEN excluded.summary <> '' THEN excluded.summary ELSE feed_items.summary END,
      metrics_json = excluded.metrics_json,
      comments_json = CASE WHEN excluded.comments_json <> '[]' THEN excluded.comments_json ELSE feed_items.comments_json END,
      badges_json = excluded.badges_json,
      published_at = COALESCE(excluded.published_at, feed_items.published_at),
      fetched_at = excluded.fetched_at,
      score = excluded.score
  `)

  db.exec('BEGIN')
  try {
    for (const item of items) {
      stmt.run(
        item.id,
        item.platform,
        item.category,
        asText(item.title) ?? item.id,
        asText(item.author),
        asText(item.url) ?? '',
        asText(item.cover),
        asText(item.summary) ?? '',
        JSON.stringify(item.metrics),
        JSON.stringify(item.comments),
        JSON.stringify(item.badges),
        item.publishedAt,
        item.fetchedAt,
        item.score
      )
    }
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
  return items.length
}

export interface FeedQuery {
  /** 不传 = 全部 */
  categories?: FeedCategory[]
  limit?: number
  /** 只要最近 N 小时内抓到的 */
  freshWithinHours?: number
  /**
   * 只看这个天数内**发布**的内容，传 null 表示不限。
   * 默认 45 天：这是防止上游返回历史快照（曾经踩过 B 站分区榜返回 2025 年数据）的
   * 最后一道闸，即便库里混进旧数据也不会顶到首页。
   */
  maxAgeDays?: number | null
}

/** 信息流默认时效窗口（天） */
export const DEFAULT_MAX_AGE_DAYS = 45

export function listFeedItems(query: FeedQuery = {}): FeedItem[] {
  const conditions: string[] = []
  const params: (string | number | null)[] = []

  if (query.categories !== undefined && query.categories.length > 0) {
    conditions.push(`category IN (${query.categories.map(() => '?').join(',')})`)
    params.push(...query.categories)
  }
  if (query.freshWithinHours !== undefined) {
    conditions.push('fetched_at >= ?')
    params.push(new Date(Date.now() - query.freshWithinHours * 3_600_000).toISOString())
  }
  const maxAgeDays = query.maxAgeDays === undefined ? DEFAULT_MAX_AGE_DAYS : query.maxAgeDays
  if (maxAgeDays !== null) {
    conditions.push('(published_at IS NULL OR published_at >= ?)')
    params.push(new Date(Date.now() - maxAgeDays * 86_400_000).toISOString())
  }

  const where = conditions.length === 0 ? '' : `WHERE ${conditions.join(' AND ')}`
  const limit = Math.min(Math.max(query.limit ?? 200, 1), 500)
  params.push(limit)

  const rows = useDb()
    .prepare(`SELECT * FROM feed_items ${where} ORDER BY score DESC, COALESCE(published_at, fetched_at) DESC LIMIT ?`)
    .all(...params.map(value => sqlValue(value))) as unknown as FeedRow[]

  return rows.map(rowToItem)
}

export function getFeedItem(id: string): FeedItem | undefined {
  const row = useDb().prepare('SELECT * FROM feed_items WHERE id = ?').get(id) as unknown as FeedRow | undefined
  return row === undefined ? undefined : rowToItem(row)
}

/**
 * 旧数据清理：默认保留 7 天抓取记录、45 天发布时间，避免 SQLite 无限膨胀。
 * 按 published_at 一起删，是为了把上游偶发返回的历史快照彻底清出去。
 */
export function pruneFeedItems(keepDays = 7, maxAgeDays = DEFAULT_MAX_AGE_DAYS): number {
  const db = useDb()
  const fetchedCutoff = new Date(Date.now() - keepDays * 86_400_000).toISOString()
  const publishCutoff = new Date(Date.now() - maxAgeDays * 86_400_000).toISOString()
  const byFetch = Number(db.prepare('DELETE FROM feed_items WHERE fetched_at < ?').run(fetchedCutoff).changes)
  const byPublish = Number(db.prepare('DELETE FROM feed_items WHERE published_at IS NOT NULL AND published_at < ?').run(publishCutoff).changes)
  return byFetch + byPublish
}

/**
 * 清掉上一轮的热搜记录。
 *
 * 热搜是「当下快照」而不是累积资料：今天掉榜的词如果还留在库里，
 * 用户会以为它仍在榜上。所以每次采集成功后立刻按抓取时间清掉旧的。
 * 只在采集成功时调用——采集失败还删，就变成「一出错页面就空了」。
 */
export function pruneHotSearch(staleBefore: string): number {
  const result = useDb()
    .prepare('DELETE FROM feed_items WHERE category = \'hot-search\' AND fetched_at < ?')
    .run(staleBefore)
  return Number(result.changes)
}

export function lastFetchedAt(): string | null {
  const row = useDb().prepare('SELECT MAX(fetched_at) AS at FROM feed_items').get()
  return row === undefined || row.at === null ? null : String(row.at)
}

/* ── 选题池 ── */

interface TopicRow {
  id: number
  source_item_id: string | null
  title: string
  url: string | null
  platform: string | null
  category: string | null
  metrics_json: string
  comments_json: string
  ai_analysis_md: string | null
  status: string
  created_at: string
}

function rowToTopic(row: TopicRow): SavedTopic {
  return {
    id: Number(row.id),
    sourceItemId: row.source_item_id,
    title: row.title,
    url: row.url,
    platform: row.platform as Platform | null,
    category: row.category as FeedCategory | null,
    metrics: parseJson<FeedMetrics>(row.metrics_json, {}),
    comments: parseJson<FeedComment[]>(row.comments_json, []),
    aiAnalysisMd: row.ai_analysis_md,
    status: row.status as TopicStatus,
    createdAt: row.created_at
  }
}

export function listTopics(status?: TopicStatus): SavedTopic[] {
  const rows = (status === undefined
    ? useDb().prepare('SELECT * FROM saved_topics ORDER BY created_at DESC').all()
    : useDb().prepare('SELECT * FROM saved_topics WHERE status = ? ORDER BY created_at DESC').all(status)) as unknown as TopicRow[]
  return rows.map(rowToTopic)
}

export function getTopic(id: number): SavedTopic | undefined {
  const row = useDb().prepare('SELECT * FROM saved_topics WHERE id = ?').get(id) as unknown as TopicRow | undefined
  return row === undefined ? undefined : rowToTopic(row)
}

/** 同一个来源视频重复收藏时返回已有条目，不产生重复选题。 */
export function saveTopicFromItem(item: FeedItem): SavedTopic {
  const db = useDb()
  if (item.id !== '') {
    const existing = db.prepare('SELECT * FROM saved_topics WHERE source_item_id = ?').get(item.id) as unknown as TopicRow | undefined
    if (existing !== undefined) return rowToTopic(existing)
  }
  const result = db.prepare(`
    INSERT INTO saved_topics (source_item_id, title, url, platform, category, metrics_json, comments_json, ai_analysis_md, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 'idea', ?)
  `).run(
    item.id,
    item.title,
    item.url,
    item.platform,
    item.category,
    JSON.stringify(item.metrics),
    JSON.stringify(item.comments),
    nowIso()
  )
  return getTopic(Number(result.lastInsertRowid)) as SavedTopic
}

export function updateTopic(id: number, patch: { aiAnalysisMd?: string | null, status?: TopicStatus, title?: string }): SavedTopic | undefined {
  const db = useDb()
  const current = getTopic(id)
  if (current === undefined) return undefined
  db.prepare('UPDATE saved_topics SET ai_analysis_md = ?, status = ?, title = ? WHERE id = ?').run(
    patch.aiAnalysisMd === undefined ? current.aiAnalysisMd : patch.aiAnalysisMd,
    patch.status ?? current.status,
    patch.title ?? current.title,
    id
  )
  return getTopic(id)
}

export function deleteTopic(id: number): boolean {
  const result = useDb().prepare('DELETE FROM saved_topics WHERE id = ?').run(id)
  return Number(result.changes) > 0
}

export function countTopics(): number {
  const row = useDb().prepare('SELECT COUNT(*) AS n FROM saved_topics').get()
  return row === undefined ? 0 : Number(row.n)
}

/* ── 采集日志 ── */

export function logFetch(source: string, ok: boolean, detail: string): void {
  useDb().prepare('INSERT INTO fetch_log (source, ok, detail, created_at) VALUES (?, ?, ?, ?)')
    .run(source, ok ? 1 : 0, detail.slice(0, 500), nowIso())
}
