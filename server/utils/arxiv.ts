/**
 * arXiv 采集（官方 Atom API，公开、无需鉴权、无限量）。
 *
 * 论文是「AI 选题」的上游：GitHub 和媒体讲的是已经火的东西，arXiv 上是刚提交、
 * 还没人讲的东西。按提交时间倒序取最近的，正好补上「领先一步」这一档。
 *
 * 注意 arXiv 的软限制是「每 3 秒不超过 1 个请求」，所以这里一次只发一个请求、
 * 一次取 40 条，绝不循环翻页。
 */
import type { RawNewsItem } from './ai-news'

const UA = 'topic-hub/1.0 (+local personal use)'

/** 关注的分类：人工智能 / 计算语言学 / 机器学习 / 计算机视觉 */
const CATEGORIES = ['cs.AI', 'cs.CL', 'cs.LG', 'cs.CV']
const MAX_RESULTS = 40

function decode(text: string): string {
  return text
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#39;/g, '\'').replace(/&apos;/g, '\'')
    .replace(/&amp;/g, '&')
}

/** arXiv 标题/摘要里常有换行与 LaTeX 残留，压成一行再去掉公式符号。 */
function flatten(text: string | undefined): string {
  if (text === undefined) return ''
  return decode(text)
    .replace(/\$[^$]*\$/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function tag(block: string, name: string): string | undefined {
  const match = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i').exec(block)
  return match === null ? undefined : match[1]
}

interface ArxivEntry {
  id: string
  title: string
  author: string | null
  url: string
  summary: string
  publishedAt: string | null
  category: string | null
}

function parseEntries(xml: string): ArxivEntry[] {
  const blocks = xml.split('<entry>').slice(1)
  const out: ArxivEntry[] = []
  for (const block of blocks) {
    const rawId = flatten(tag(block, 'id'))
    const title = flatten(tag(block, 'title'))
    if (rawId === '' || title === '') continue

    // 新版论文 id 形如 http://arxiv.org/abs/2610.40655v1，去掉版本号保证同一篇不重复入库
    const idMatch = /abs\/([^<\s]+)$/.exec(rawId)
    const shortId = (idMatch?.[1] ?? rawId).replace(/v\d+$/, '')
    // 摘要里可能带 "<p>" 之类，先剥标签再压缩
    const summary = flatten((tag(block, 'summary') ?? '').replace(/<[^>]+>/g, ' '))
    const firstAuthor = /<author>[\s\S]*?<name>([\s\S]*?)<\/name>/.exec(block)?.[1]
    const primary = /<arxiv:primary_category[^>]*term="([^"]+)"/.exec(block)?.[1]
      ?? /<category[^>]*term="([^"]+)"/.exec(block)?.[1]

    out.push({
      id: shortId,
      title,
      author: firstAuthor === undefined ? null : flatten(firstAuthor),
      url: `https://arxiv.org/abs/${shortId}`,
      summary: summary.slice(0, 320),
      publishedAt: toIso(flatten(tag(block, 'published'))),
      category: primary ?? null
    })
  }
  return out
}

function toIso(raw: string): string | null {
  if (raw === '') return null
  const parsed = Date.parse(raw)
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString()
}

/** 最近提交的 AI 论文，按提交时间倒序。 */
export async function fetchArxiv(limit = MAX_RESULTS): Promise<RawNewsItem[]> {
  const query = CATEGORIES.map(cat => `cat:${cat}`).join('+OR+')
  const url = `https://export.arxiv.org/api/query?search_query=${query}&sortBy=submittedDate&sortOrder=descending&max_results=${limit}`
  const res = await fetch(url, {
    headers: { 'user-agent': UA, 'accept': 'application/atom+xml' },
    signal: AbortSignal.timeout(25_000)
  })
  if (!res.ok) throw new Error(`arXiv HTTP ${res.status}`)
  const xml = await res.text()

  const entries = parseEntries(xml)
  if (entries.length === 0) throw new Error('arXiv 返回为空（查询可能被判为过于频繁，等 3 秒再试）')

  return entries.map(entry => ({
    id: `arxiv:${entry.id}`,
    title: entry.title,
    author: entry.author,
    url: entry.url,
    summary: entry.category === null ? entry.summary : `[${entry.category}] ${entry.summary}`,
    publishedAt: entry.publishedAt,
    // 论文没有互动指标，只靠新鲜度排序（score 里单独走 rss 那条分支）
    metrics: {},
    comments: [],
    kind: 'arxiv'
  }))
}
