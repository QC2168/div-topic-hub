/**
 * 本地 SQLite 存储层（零依赖）。
 *
 * 运行时自适应：在 Bun 下用内置 `bun:sqlite`（计划指定的方案），在 Node 下
 * 自动回落到 Node 24 内置的 `node:sqlite`。两者的 `prepare / run / all / get /
 * exec` 语义一致，因此这里只做一层极薄的归一化，上层代码不感知运行时。
 *
 * 数据库文件固定落在 <项目根>/.data/topic-hub.sqlite，随项目走、不入库。
 */
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

/** 归一化后的最小 Statement 接口（bun:sqlite 与 node:sqlite 的交集）。 */
export interface SqlStatement {
  run: (...params: SqlValue[]) => { changes: number | bigint, lastInsertRowid: number | bigint }
  all: (...params: SqlValue[]) => Record<string, unknown>[]
  get: (...params: SqlValue[]) => Record<string, unknown> | undefined
}

export interface SqlDatabase {
  prepare: (sql: string) => SqlStatement
  exec: (sql: string) => void
  close: () => void
}

export type SqlValue = string | number | null | Uint8Array

let cached: SqlDatabase | undefined

function isBun(): boolean {
  return typeof (globalThis as { Bun?: unknown }).Bun !== 'undefined'
}

/**
 * 载入运行时内置的 sqlite 实现。specifier 用数组拼接而非字面量，避免打包器
 * 在构建期静态解析 `bun:sqlite`（Node 侧并不存在该模块）。
 */
function loadSqlite(): SqlDatabase {
  const req = createRequire(import.meta.url)
  const specifier = isBun() ? ['bun', 'sqlite'].join(':') : ['node', 'sqlite'].join(':')
  const mod = req(specifier) as {
    Database?: new (path: string, options?: { create?: boolean }) => SqlDatabase
    DatabaseSync?: new (path: string) => SqlDatabase
  }
  const Ctor = mod.Database ?? mod.DatabaseSync
  if (Ctor === undefined) {
    throw new Error(`当前运行时缺少 sqlite 内置模块（${specifier}）`)
  }
  return new Ctor(DB_FILE, { create: true })
}

/** 数据文件路径：优先 <root>/.data，允许用 TOPIC_HUB_DATA_DIR 覆盖。 */
const DB_FILE = (() => {
  const dir = process.env.TOPIC_HUB_DATA_DIR ?? join(process.cwd(), '.data')
  mkdirSync(dir, { recursive: true })
  return join(dir, 'topic-hub.sqlite')
})()

const SCHEMA = `
CREATE TABLE IF NOT EXISTS feed_items (
  id            TEXT PRIMARY KEY,
  platform      TEXT NOT NULL,
  category      TEXT NOT NULL,
  title         TEXT NOT NULL,
  author        TEXT,
  url           TEXT NOT NULL,
  cover         TEXT,
  summary       TEXT,
  metrics_json  TEXT NOT NULL DEFAULT '{}',
  comments_json TEXT NOT NULL DEFAULT '[]',
  badges_json   TEXT NOT NULL DEFAULT '[]',
  published_at  TEXT,
  fetched_at    TEXT NOT NULL,
  score         REAL NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_feed_category ON feed_items(category);
CREATE INDEX IF NOT EXISTS idx_feed_score ON feed_items(score DESC);

CREATE TABLE IF NOT EXISTS saved_topics (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  source_item_id TEXT,
  title          TEXT NOT NULL,
  url            TEXT,
  platform       TEXT,
  category       TEXT,
  metrics_json   TEXT NOT NULL DEFAULT '{}',
  comments_json  TEXT NOT NULL DEFAULT '[]',
  ai_analysis_md TEXT,
  status         TEXT NOT NULL DEFAULT 'idea',
  created_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS fetch_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  source     TEXT NOT NULL,
  ok         INTEGER NOT NULL,
  detail     TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS up_fans (
  mid        INTEGER PRIMARY KEY,
  fans       INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);
`

/** 取数据库单例，首次调用时建表。 */
export function useDb(): SqlDatabase {
  if (cached !== undefined) return cached
  const db = loadSqlite()
  db.exec('PRAGMA journal_mode = WAL;')
  db.exec(SCHEMA)
  cached = db
  return db
}

/** undefined 在部分运行时不可绑定，统一降级为 NULL。 */
export function sqlValue(value: unknown): SqlValue {
  if (value === undefined || value === null) return null
  if (typeof value === 'string' || typeof value === 'number') return value
  if (value instanceof Uint8Array) return value
  return JSON.stringify(value)
}

export const nowIso = (): string => new Date().toISOString()

/* ── settings: 极简 kv ── */

export function readSetting<T>(key: string, fallback: T): T {
  const row = useDb().prepare('SELECT value FROM settings WHERE key = ?').get(key)
  if (row === undefined) return fallback
  try {
    return JSON.parse(String(row.value)) as T
  } catch {
    return fallback
  }
}

export function writeSetting(key: string, value: unknown): void {
  useDb()
    .prepare(`INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
              ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`)
    .run(key, JSON.stringify(value), nowIso())
}

export function listSettings(): Record<string, unknown> {
  const rows = useDb().prepare('SELECT key, value FROM settings').all()
  const out: Record<string, unknown> = {}
  for (const row of rows) {
    try {
      out[String(row.key)] = JSON.parse(String(row.value))
    } catch {
      out[String(row.key)] = row.value
    }
  }
  return out
}

/* ── up_fans: UP 主粉丝数缓存 ── */

/**
 * 粉丝数变化很慢，没必要每轮采集都问一次。缓存 7 天，第二次起几乎零请求，
 * 这样才敢把「所有 UP 都查一遍」放开——否则一次刷新要多打几十个请求。
 */
const FANS_TTL_MS = 7 * 86_400_000

export function readFansCache(mids: number[]): Map<number, number> {
  const out = new Map<number, number>()
  if (mids.length === 0) return out
  const placeholders = mids.map(() => '?').join(',')
  const cutoff = new Date(Date.now() - FANS_TTL_MS).toISOString()
  const rows = useDb()
    .prepare(`SELECT mid, fans FROM up_fans WHERE updated_at >= ? AND mid IN (${placeholders})`)
    .all(sqlValue(cutoff), ...mids.map(mid => sqlValue(mid)))
  for (const row of rows) out.set(Number(row.mid), Number(row.fans))
  return out
}

export function writeFansCache(entries: Array<{ mid: number, fans: number }>): void {
  if (entries.length === 0) return
  const stmt = useDb().prepare(`INSERT INTO up_fans (mid, fans, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(mid) DO UPDATE SET fans = excluded.fans, updated_at = excluded.updated_at`)
  const at = nowIso()
  for (const entry of entries) stmt.run(sqlValue(entry.mid), sqlValue(entry.fans), sqlValue(at))
}
