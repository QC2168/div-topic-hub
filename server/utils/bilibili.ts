/**
 * B 站垂类黑马采集。
 *
 * 为什么走服务端：浏览器直连 api.bilibili.com 会被 CORS + 防盗链挡住，服务端
 * 带 referer/UA 请求则畅通。WBI 签名算法移植自 div-dsh-workbench/src/radar/adapters.ts
 * （已在生产验证过）。
 *
 * 数据源选型（2026-11 实测，别踩回旧坑）：
 *   ✗ x/web-interface/ranking/v2?rid=188|36   分区总榜，上游自 2025-04 冻结，不再更新
 *   ✗ x/web-interface/ranking/region?day=3|7  同上，返回 2025-04 的快照
 *   ✓ x/web-interface/popular                 综合热门，实时，带完整 stat
 *   ✓ x/web-interface/wbi/search/type         搜索综合排序（totalrank），中位年龄 1~2 天
 *
 * 两个实时源返回的都是**子分区 tid**（95 数码 / 201 科学科普），不是 188 / 36，
 * 所以归区要靠 TID 白名单，不能再按 rid 请求。
 */
import { createHash } from 'node:crypto'

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36'

const DAY_MS = 86_400_000

/** 科技区（rid=188）下的子分区 */
const TECH_TIDS = new Set([188, 95, 230, 231, 232, 233, 234, 251])
/** 知识区（rid=36）下的子分区 */
const KNOWLEDGE_TIDS = new Set([36, 201, 124, 228, 207, 208, 209, 229, 122])

export interface BiliSector {
  key: 'tech' | 'knowledge'
  label: string
  /** 该区下所有子分区 tid，用于把热门流/搜索结果归到正确分区 */
  tids: Set<number>
  /** 综合排序搜索关键词：多词覆盖垂类，避免单词偏科 */
  keywords: string[]
}

export const BILI_SECTORS: BiliSector[] = [
  // 关键词产量是实测出来的：数码评测/电脑/显卡这类「具体品类」比「数码」泛词准得多
  { key: 'tech', label: '科技区', tids: TECH_TIDS, keywords: ['人工智能', '数码评测', '电脑', '编程', '显卡', '科技'] },
  { key: 'knowledge', label: '知识区', tids: KNOWLEDGE_TIDS, keywords: ['科普', '历史', '财经', '心理', '商业'] }
]

/** 综合热门翻几页（每页 50，8 页约覆盖近 3 天的推荐流） */
const POPULAR_PAGES = 8
const POPULAR_PAGE_SIZE = 50
/** 搜索单页条数（上限 50，30 已经够筛） */
const SEARCH_PAGE_SIZE = 30
/** 搜索噪声极大：播放低于此值基本是刚发的零播放稿，直接丢 */
const SEARCH_MIN_PLAY = 5_000
/** 搜索按综合排序会混进多年老爆款，超过这个年龄一律丢 */
const SEARCH_MAX_AGE_DAYS = 30

const WBI_MIXIN_TAB = [46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52]

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

function biliHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    'user-agent': UA,
    'referer': 'https://www.bilibili.com/',
    'accept-language': 'zh-CN,zh;q=0.9',
    ...extra
  }
}

async function fetchJson<T>(url: string, extraHeaders: Record<string, string> = {}, timeoutMs = 12_000): Promise<T> {
  const res = await fetch(url, {
    headers: biliHeaders(extraHeaders),
    signal: AbortSignal.timeout(timeoutMs)
  })
  if (!res.ok) throw new Error(`HTTP ${res.status} ← ${new URL(url).host}`)
  return await res.json() as T
}

/** WBI 混音表 → 32 位签名密钥。 */
export function wbiMixinKey(imgKey: string, subKey: string): string {
  const origin = imgKey + subKey
  return WBI_MIXIN_TAB.map(index => origin[index] ?? '').join('').slice(0, 32)
}

/** 按 WBI 规则签名查询串（键排序 + wts + w_rid）。 */
export function wbiSign(params: Record<string, string>, imgKey: string, subKey: string, nowMs = Date.now()): string {
  const merged: Record<string, string> = { ...params, wts: String(Math.floor(nowMs / 1000)) }
  const query = Object.keys(merged).sort()
    .map(key => `${encodeURIComponent(key)}=${encodeURIComponent((merged[key] ?? '').replace(/[!'()*]/g, ''))}`)
    .join('&')
  return `${query}&w_rid=${createHash('md5').update(query + wbiMixinKey(imgKey, subKey)).digest('hex')}`
}

interface WbiKeys { imgKey: string, subKey: string }

function wbiKeyFromUrl(url: string): string {
  return url.split('/').pop()?.replace(/\.[a-z]+$/i, '') ?? ''
}

/** 匿名 nav 接口会返回 code=-101，但 wbi_img 公钥照常下发。 */
async function fetchWbiKeys(): Promise<WbiKeys> {
  const nav = await fetchJson<{ code?: number, data?: { wbi_img?: { img_url?: string, sub_url?: string } } }>(
    'https://api.bilibili.com/x/web-interface/nav'
  )
  const imgKey = wbiKeyFromUrl(nav.data?.wbi_img?.img_url ?? '')
  const subKey = wbiKeyFromUrl(nav.data?.wbi_img?.sub_url ?? '')
  if (!imgKey || !subKey) throw new Error(`nav 未返回 WBI 密钥（code ${String(nav.code)}）`)
  return { imgKey, subKey }
}

/** 密钥一天只轮换一次，缓存 30 分钟，省掉每次搜索都打一次 nav。 */
let wbiCache: { keys: WbiKeys, at: number } | null = null
const WBI_TTL_MS = 30 * 60_000

async function getWbiKeys(): Promise<WbiKeys> {
  if (wbiCache !== null && Date.now() - wbiCache.at < WBI_TTL_MS) return wbiCache.keys
  const keys = await fetchWbiKeys()
  wbiCache = { keys, at: Date.now() }
  return keys
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: '\'', nbsp: ' ' }

/** 搜索结果标题里带 <em class="keyword"> 高亮标签，还有零散 HTML 实体，统一洗掉。 */
function cleanText(text: string | undefined): string {
  if (text === undefined) return ''
  return text
    .replace(/<[^>]+>/g, '')
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, code: string) => {
      if (code.startsWith('#')) {
        const num = code.startsWith('#x') || code.startsWith('#X') ? Number.parseInt(code.slice(2), 16) : Number(code.slice(1))
        return Number.isFinite(num) && num > 0 ? String.fromCodePoint(num) : whole
      }
      return ENTITIES[code.toLowerCase()] ?? whole
    })
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * B 站封面给两种形态：协议相对地址 "//i0.hdslb.com/..." 和明文的 "http://..."。
 * 统一升到 https，避免将来把面板挂到 https 宿主里被浏览器当混合内容拦掉。
 */
function normalizeCover(pic: string | undefined): string | null {
  if (pic === undefined || pic === '') return null
  if (pic.startsWith('//')) return `https:${pic}`
  if (pic.startsWith('http://')) return `https://${pic.slice('http://'.length)}`
  return pic
}

export interface RawBiliVideo {
  bvid: string
  aid: number | undefined
  title: string
  author: string
  mid: number | undefined
  url: string
  cover: string | null
  summary: string
  publishedAt: string | null
  play: number
  like: number
  reply: number
  danmaku: number
  favorite: number
  coin: number
  share: number
  /** 来自「综合热门」推荐流：真实的短期爆发信号，打分时给正权重 */
  hotBoard: boolean
  /** 子分区 id（95 数码 / 201 科学科普），用于归区与展示 */
  tid: number | null
  typename: string
  /** UP 主粉丝数：后补字段（只给最靠前的若干条查），用于算破圈倍率 */
  fans?: number
}

/**
 * B 站时间字段有两种形态：popular / 搜索给 Unix 秒，个别老接口给
 * "2025-04-01 12:03" 这种无时区字符串。统一转成 ISO，解析不出来就返回 null
 * （不让脏数据打崩整批）。
 */
function toIso(value: unknown): string | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value > 0 ? new Date(value * 1000).toISOString() : null
  }
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (trimmed === '') return null
  if (/^\d+$/.test(trimmed)) return new Date(Number(trimmed) * 1000).toISOString()
  const parsed = Date.parse(trimmed.replace(' ', 'T'))
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString()
}

interface StatBlock {
  view?: number
  danmaku?: number
  reply?: number
  favorite?: number
  coin?: number
  share?: number
  like?: number
}

/** popular 与 newlist 共用同一种结构（archives 数组）。 */
interface PopularItem {
  aid?: number
  bvid?: string
  title?: string
  desc?: string
  pic?: string
  pubdate?: number | string
  tid?: number
  tname?: string
  owner?: { mid?: number, name?: string }
  stat?: StatBlock
}

interface SearchItem {
  type?: string
  aid?: number
  bvid?: string
  title?: string
  author?: string
  mid?: number
  typeid?: number | string
  typename?: string
  description?: string
  pic?: string
  play?: number
  like?: number
  danmaku?: number
  video_review?: number
  review?: number
  favorites?: number
  pubdate?: number | string
}

/** popular 与全站榜返回同一种结构，映射逻辑共用一份。 */
function popularItemToRaw(item: PopularItem): RawBiliVideo | null {
  if (typeof item.bvid !== 'string' || item.bvid === '') return null
  return {
    bvid: item.bvid,
    aid: item.aid,
    title: cleanText(item.title),
    author: item.owner?.name ?? '',
    mid: item.owner?.mid,
    url: `https://www.bilibili.com/video/${item.bvid}`,
    cover: normalizeCover(item.pic),
    summary: cleanText(item.desc).slice(0, 300),
    publishedAt: toIso(item.pubdate),
    play: item.stat?.view ?? 0,
    like: item.stat?.like ?? 0,
    reply: item.stat?.reply ?? 0,
    danmaku: item.stat?.danmaku ?? 0,
    favorite: item.stat?.favorite ?? 0,
    coin: item.stat?.coin ?? 0,
    share: item.stat?.share ?? 0,
    hotBoard: true,
    tid: typeof item.tid === 'number' ? item.tid : null,
    typename: item.tname ?? ''
  }
}

/**
 * 综合热门（全站推荐流，实时）。返回的是子分区 tid，调用方按白名单归区。
 * 单页失败不拖垮整批：已经拿到的页照常返回。
 */
export async function fetchPopularVideos(pages = POPULAR_PAGES): Promise<RawBiliVideo[]> {
  const out: RawBiliVideo[] = []
  for (let pn = 1; pn <= pages; pn++) {
    try {
      const json = await fetchJson<{ code?: number, data?: { no_more?: boolean, list?: PopularItem[] } }>(
        `https://api.bilibili.com/x/web-interface/popular?ps=${POPULAR_PAGE_SIZE}&pn=${pn}`
      )
      if (json.code !== 0) throw new Error(`综合热门接口 code ${String(json.code)}`)
      const list = json.data?.list ?? []
      out.push(...list.map(popularItemToRaw).filter((video): video is RawBiliVideo => video !== null))
      if (json.data?.no_more === true || list.length === 0) break
    } catch (error) {
      if (out.length === 0) throw error
      break
    }
    if (pn < pages) await sleep(250)
  }
  return out
}

/**
 * 全站榜（rid=0）。
 *
 * 注意和 `ranking/v2?rid=188|36` 的区别：**那个分区榜已经冻结，这个全站榜是活的**
 * （实测返回当天数据）。所以这里继续用排行榜路线，但只请求 rid=0，再按 tid 白名单
 * 从中挑出科技/知识条目。产量不高（100 条里约 11 条命中），胜在质量最好。
 */
export async function fetchRankingAll(): Promise<RawBiliVideo[]> {
  const json = await fetchJson<{ code?: number, data?: { list?: PopularItem[] } }>(
    'https://api.bilibili.com/x/web-interface/ranking/v2?rid=0&type=all'
  )
  if (json.code !== 0) throw new Error(`全站榜接口 code ${String(json.code)}`)
  return (json.data?.list ?? [])
    .map(popularItemToRaw)
    .filter((video): video is RawBiliVideo => video !== null)
}

/**
 * 综合排序搜索（WBI 签名）。
 *
 * 为什么是 totalrank：order=pubdate 虽然绝对新鲜但播放量基本为 0（全平台每秒都在
 * 发稿），order=click 全是多年老爆款；默认的 totalrank 中位年龄 1~2 天且混有高
 * 播放新稿，是唯一能同时满足「新鲜 + 有量」的排序。
 * 因此这里必须用播放下限 + 时间上限两道过滤把噪声挡在外面。
 */
export async function fetchSearchVideos(keyword: string, tids: Set<number>, maxAgeDays = SEARCH_MAX_AGE_DAYS): Promise<RawBiliVideo[]> {
  const keys = await getWbiKeys()
  const signed = wbiSign({
    search_type: 'video',
    keyword,
    order: 'totalrank',
    page: '1',
    page_size: String(SEARCH_PAGE_SIZE)
  }, keys.imgKey, keys.subKey)
  const json = await fetchJson<{ code?: number, data?: { result?: SearchItem[] } }>(
    `https://api.bilibili.com/x/web-interface/wbi/search/type?${signed}`
  )
  if (json.code !== 0) throw new Error(`搜索接口 code ${String(json.code)}`)

  const now = Date.now()
  const maxAgeMs = maxAgeDays * DAY_MS
  return (json.data?.result ?? [])
    .filter(item => item.type === 'video' && typeof item.bvid === 'string' && item.bvid !== '')
    .map((item) => {
      const publishedAt = toIso(item.pubdate)
      return {
        bvid: item.bvid as string,
        aid: item.aid,
        title: cleanText(item.title),
        author: cleanText(item.author),
        mid: item.mid,
        url: `https://www.bilibili.com/video/${item.bvid as string}`,
        cover: normalizeCover(item.pic),
        summary: cleanText(item.description).slice(0, 300),
        publishedAt,
        play: item.play ?? 0,
        like: item.like ?? 0,
        reply: item.review ?? 0,
        danmaku: item.danmaku ?? item.video_review ?? 0,
        favorite: item.favorites ?? 0,
        coin: 0,
        share: 0,
        hotBoard: false,
        tid: Number.isFinite(Number(item.typeid)) ? Number(item.typeid) : null,
        typename: cleanText(item.typename)
      } satisfies RawBiliVideo
    })
    .filter(video =>
      video.tid !== null
      && tids.has(video.tid)
      && video.play >= SEARCH_MIN_PLAY
      && video.publishedAt !== null
      && now - Date.parse(video.publishedAt) <= maxAgeMs
    )
}

/** 指定 UP 主的近期投稿（WBI 签名接口）。 */
export async function fetchUpRecentVideos(mid: number): Promise<RawBiliVideo[]> {
  const keys = await getWbiKeys()
  const signed = wbiSign({ mid: String(mid), pn: '1', ps: '10', order: 'pubdate' }, keys.imgKey, keys.subKey)
  const json = await fetchJson<{ code?: number, data?: { list?: { vlist?: SearchItem[] } } }>(
    `https://api.bilibili.com/x/space/wbi/arc/search?${signed}`
  )
  if (json.code !== 0) throw new Error(`UP 主投稿接口 code ${String(json.code)}`)
  return (json.data?.list?.vlist ?? [])
    .filter(item => typeof item.bvid === 'string' && item.bvid !== '')
    .map(item => ({
      bvid: item.bvid as string,
      aid: item.aid,
      title: cleanText(item.title),
      author: cleanText(item.author) || `UP ${mid}`,
      mid,
      url: `https://www.bilibili.com/video/${item.bvid as string}`,
      cover: normalizeCover(item.pic),
      summary: cleanText(item.description).slice(0, 300),
      publishedAt: toIso(item.pubdate),
      play: item.play ?? 0,
      like: item.like ?? 0,
      reply: item.review ?? 0,
      danmaku: item.video_review ?? 0,
      favorite: item.favorites ?? 0,
      coin: 0,
      share: 0,
      hotBoard: false,
      tid: null,
      typename: ''
    }))
}

/**
 * UP 主粉丝数。
 *
 * 只为了算「播放 / 粉丝」比——判断一条视频是真的破圈，还是大号的基本盘。
 * 接口选择上踩过坑：`relation/stat?fid=` 现在返回 -400（参数已废弃），必须用 `vmid`；
 * 而 `space/wbi/acc/info` 会直接吃 -352 风控校验失败，别用。
 */
export async function fetchFans(mid: number): Promise<number> {
  if (!Number.isFinite(mid) || mid <= 0) return 0
  const json = await fetchJson<{ code?: number, data?: { follower?: number } }>(
    `https://api.bilibili.com/x/relation/stat?vmid=${mid}`
  )
  if (json.code !== 0) throw new Error(`粉丝数接口 code ${String(json.code)}`)
  return json.data?.follower ?? 0
}

interface ReplyItem {
  rpid?: number
  like?: number
  ctime?: number
  content?: { message?: string }
  member?: { uname?: string }
}/** 视频前排高赞评论（sort=1 为按点赞排序）。 */
export async function fetchTopComments(aid: number | undefined, ps = 5): Promise<{ author: string, content: string, likes: number }[]> {
  if (aid === undefined || !Number.isFinite(aid)) return []
  const json = await fetchJson<{ code?: number, data?: { replies?: ReplyItem[] } }>(
    `https://api.bilibili.com/x/v2/reply?type=1&oid=${aid}&pn=1&ps=${ps}&sort=1`
  )
  if (json.code !== 0) return []
  return (json.data?.replies ?? [])
    .filter(reply => (reply.content?.message ?? '').trim() !== '')
    .map(reply => ({
      author: reply.member?.uname ?? '匿名',
      content: (reply.content?.message ?? '').replace(/\s+/g, ' ').slice(0, 220),
      likes: reply.like ?? 0
    }))
}

/**
 * 按 bvid 合并去重（同一视频会同时出现在热门流与多个关键词搜索结果里）。
 * 统计字段取两边的较大值：搜索有时少给 coin/share，热门流补上。
 */
export function mergeVideos(...groups: RawBiliVideo[][]): RawBiliVideo[] {
  const map = new Map<string, RawBiliVideo>()
  for (const group of groups) {
    for (const video of group) {
      const existing = map.get(video.bvid)
      if (existing === undefined) {
        map.set(video.bvid, video)
        continue
      }
      map.set(video.bvid, {
        ...existing,
        like: Math.max(existing.like, video.like),
        reply: Math.max(existing.reply, video.reply),
        danmaku: Math.max(existing.danmaku, video.danmaku),
        favorite: Math.max(existing.favorite, video.favorite),
        coin: Math.max(existing.coin, video.coin),
        share: Math.max(existing.share, video.share),
        play: Math.max(existing.play, video.play),
        hotBoard: existing.hotBoard || video.hotBoard,
        summary: existing.summary || video.summary,
        cover: existing.cover ?? video.cover,
        tid: existing.tid ?? video.tid,
        typename: existing.typename || video.typename,
        publishedAt: existing.publishedAt ?? video.publishedAt
      })
    }
  }
  return [...map.values()]
}
