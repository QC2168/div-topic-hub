/**
 * 百度热搜。
 *
 * 国内几个综合热榜里，只有百度的 PC 版接口同时给出**真实热度值**和封面图
 * （微博只给 num、抖音给 hot_value，量纲各不相同，但至少都是官方口径）。
 *
 * 移动版（platform=wise）返回的结构里没有 hotScore，所以固定用 PC 版。
 *
 * 注意：这是百度搜索自己的榜单，不是「AI 榜单」。
 * 国内没有任何一家 AI 平台公布使用量榜，想做「国内 AI 热点」只能从综合热榜里筛，
 * 具体筛选逻辑在页面侧（关键词高亮 + 过滤），采集层不做判断。
 */

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36'

export interface BaiduHotWord {
  word: string
  heat: number
  rank: number
  /** 百度给的一句话摘要，经常比标题本身更有信息量 */
  desc: string
  cover: string | null
  /** 榜单标记：1 新 / 2 热 / 3 爆，0 为普通 */
  tag: string
}

interface BaiduRow {
  word?: string
  query?: string
  index?: number
  hotScore?: number | string
  hotTag?: string | number
  desc?: string
  img?: string
  url?: string
}

interface BaiduCard {
  content?: BaiduRow[] | BaiduRow[][]
}

function flatten(cards: BaiduCard[]): BaiduRow[] {
  const rows: BaiduRow[] = []
  for (const card of cards) {
    for (const entry of card.content ?? []) {
      // tabTextList 那种卡片的 content 是「数组套数组」，普通榜单是扁平数组，两种都要能接
      if (Array.isArray(entry)) rows.push(...entry)
      else rows.push(entry)
    }
  }
  return rows
}

export async function fetchBaiduHot(): Promise<BaiduHotWord[]> {
  const res = await fetch('https://top.baidu.com/api/board?platform=pc&tab=realtime', {
    headers: {
      'user-agent': UA,
      'referer': 'https://top.baidu.com/board?tab=realtime',
      'accept': 'application/json'
    },
    signal: AbortSignal.timeout(15_000)
  })
  if (!res.ok) throw new Error(`百度热搜 HTTP ${res.status}`)

  const json = await res.json() as { success?: boolean, data?: { cards?: BaiduCard[] } }
  if (json.success !== true) throw new Error('百度热搜返回 success=false')

  const rows = flatten(json.data?.cards ?? [])
  const words: BaiduHotWord[] = []
  for (const [position, row] of rows.entries()) {
    const word = (row.word ?? row.query ?? '').trim()
    if (word === '') continue
    const heat = typeof row.hotScore === 'string' ? Number.parseFloat(row.hotScore) : row.hotScore ?? 0

    words.push({
      word,
      heat: Number.isFinite(heat) ? Math.round(heat) : 0,
      // index 从 0 开始；置顶条目不参与排名，用数组位置兜底
      rank: typeof row.index === 'number' && row.index >= 0 ? row.index + 1 : position + 1,
      desc: (row.desc ?? '').trim(),
      cover: typeof row.img === 'string' && row.img.startsWith('http') ? row.img : null,
      tag: String(row.hotTag ?? '')
    })
  }
  if (words.length === 0) throw new Error('百度热搜返回空列表')
  return words
}
