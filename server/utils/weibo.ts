/**
 * 微博热搜。
 *
 * 接口是微博网页版的侧边栏数据源，无需登录、无需 cookie、无需签名——
 * 这一点和抖音热榜一样，属于「公开页面自己的数据」，不是破解来的。
 *
 * 为什么值得接：它回答的是「这件事是不是全网都在讨论」。
 * B 站和抖音都有强烈的圈层属性，一个小圈子里的爆款在微博上是静默的；
 * 反过来，微博上挂了半天的词，B 站却没人做，那就是典型的蓝海选题。
 */

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36'

export interface WeiboHotWord {
  word: string
  heat: number
  rank: number
  /** 榜单标记：新 / 热 / 沸 / 爆，普通词为空串 */
  tag: string
}

interface WeiboRealtimeRow {
  word?: string
  note?: string
  num?: number
  realpos?: number
  rank?: number
  label_name?: string
  icon_desc?: string
}

export async function fetchWeiboHot(): Promise<WeiboHotWord[]> {
  const res = await fetch('https://weibo.com/ajax/side/hotSearch', {
    headers: {
      'user-agent': UA,
      'referer': 'https://weibo.com/',
      'accept': 'application/json, text/plain, */*'
    },
    signal: AbortSignal.timeout(15_000)
  })
  if (!res.ok) throw new Error(`微博热搜 HTTP ${res.status}`)

  const json = await res.json() as { ok?: number, data?: { realtime?: WeiboRealtimeRow[] } }
  if (json.ok !== 1) throw new Error(`微博热搜返回 ok=${String(json.ok)}`)

  const rows = json.data?.realtime ?? []
  const words: WeiboHotWord[] = []
  for (const [index, row] of rows.entries()) {
    // note 是纯词条；word 有时带 #话题# 包装，展示用 note 更干净
    const word = (row.note ?? row.word ?? '').trim()
    if (word === '') continue

    const rawPos = row.realpos ?? row.rank
    if (rawPos === 0 || rawPos === undefined) continue // 0 表示推广位，不是真榜

    words.push({
      word,
      heat: typeof row.num === 'number' ? row.num : 0,
      rank: typeof rawPos === 'number' && rawPos > 0 ? rawPos : index + 1,
      tag: (row.label_name ?? row.icon_desc ?? '').trim()
    })
  }
  if (words.length === 0) throw new Error('微博热搜返回空列表')
  return words
}
