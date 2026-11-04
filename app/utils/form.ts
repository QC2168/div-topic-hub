/**
 * 内容形态粗分类。
 *
 * 为什么放在前端：它是展示层的聚合指标，不需要入库，也就没有迁移成本；
 * 标题一变就重算，永远和列表一致。
 *
 * 两个必须承认的局限：
 * 1. 只靠标题关键词判断，误判是必然的（「为什么」开头的教程会被归到观点）。
 * 2. B 站标题比小红书随意得多，很多标题根本没有形态特征（比如「美国中期选举大斗法」），
 *    所以「未分类」占比高是正常的，不是分类器坏了。UI 上必须标注「按标题粗分」。
 */
import type { FeedItem } from '#shared/types'

export type TopicForm = '清单' | '教程' | '测评' | '叙事' | '避雷' | '数据' | '资源' | '观点' | '资讯' | '未分类'

/**
 * 中文数字 + 量词：「五种动物」「十大黑科技」这类盘点句很常见，漏了就会掉进未分类。
 * 刻意不含「一」——「一条路」「一个人」「一句话」是叙事不是盘点，包含进来会大量误判。
 */
const CN_COUNT = /[二三四五六七八九十百]+\s*(个|件|款|种|招|步|条|台|部|套|大|期|集|年)/

/** 顺序即优先级：越具体的形态越靠前，避免「推荐」这类词把教程抢走。 */
const RULES: Array<{ form: Exclude<TopicForm, '未分类'>, pattern: RegExp }> = [
  { form: '避雷', pattern: /避雷|踩坑|别买|翻车|后悔|慎入|维权|投诉|劝退|智商税|割韭菜|坑人/ },
  { form: '测评', pattern: /测评|评测|实测|横评|对比|开箱|上手|体验|装机|拆箱|试用|真机/ },
  { form: '教程', pattern: /教程|怎么|如何|教你|保姆|入门|从零|手把手|指南|攻略|零基础|全套|学会|配置推荐|设置/ },
  { form: '清单', pattern: /盘点|合集|大全|榜单|排行|排名|推荐|\d+\s*(个|件|款|种|招|步|条|台|部|套)|top\s*\d/i },
  { form: '资源', pattern: /资源|素材|模板|网站|工具包|开源|下载|资料|插件|免费/ },
  { form: '数据', pattern: /数据|报告|统计|调研|白皮书|财报|指数|增长|营收/ },
  { form: '观点', pattern: /为什么|本质|真相|底层|逻辑|反思|聊聊|谈谈|观点|详解|解读|揭秘|锐评|看法|凭啥|是不是|之所以|讲清楚|说清楚|看懂|搞懂|解读|[？?❓]\s*$/ },
  // 资讯必须排在观点之后：「为什么XX会公布」是评论，不该被抢成快讯
  { form: '资讯', pattern: /公布|发布|官宣|宣布|上线|延期|曝光|爆出|炸出|热搜|快讯|日报|周报|消息|突发|最新|刚刚|今天|本月|回应|通报|融资|裁员/ },
  // 叙事放最后：以「我」开头太宽，会吃掉别的形态
  // 刻意不含「一天/一年/三年」——「11月的第一天行情」会被误吞成叙事，而「我的一天」已由 ^我 覆盖
  { form: '叙事', pattern: /^我|我把|我做|我造|我买|我去|我用|我试|亲历|经历|故事|回忆|实录|日记|vlog|纪实|自述|自制|手搓|魔改|改造|DIY|旅游|旅行|探店|做饭/i }
]

const FORM_COLORS: Record<TopicForm, string> = {
  清单: '#7F77DD',
  教程: '#1D9E75',
  测评: '#378ADD',
  叙事: '#D85A30',
  避雷: '#E24B4A',
  数据: '#EF9F27',
  资源: '#639922',
  观点: '#D4537E',
  资讯: '#0E9C9C',
  未分类: '#B4B2A9'
}

export function classifyForm(title: string): TopicForm {
  for (const rule of RULES) {
    // 中文数字量词要放到「清单」这一档才判断，否则「十步教你…」会被抢成清单
    if (rule.form === '清单' && isCnCount(title)) return '清单'
    if (rule.pattern.test(title)) return rule.form
  }
  return '未分类'
}

function isCnCount(title: string): boolean {
  const match = CN_COUNT.exec(title)
  if (match === null) return false
  // 「三年」「三期」多半是叙事/系列，不算盘点
  return !['年', '期', '集'].includes(match[1] ?? '')
}

export interface FormSegment {
  form: TopicForm | '其他'
  count: number
  pct: number
  color: string
  /** 悬停时可展示的补充说明，目前只给「其他」用 */
  note?: string
}

/**
 * 当前列表的形态分布。
 *
 * 只统计 B 站内容（HN / arXiv / RSS 的标题是英文或纯公告，形态分类没有意义），
 * 样本少于 12 条时不返回——样本太小，占比只会误导人。
 *
 * 排序上「其他」永远排最后并染成灰色：它是基线噪音，不该占据视觉重心的位置。
 */
export function formDistribution(items: FeedItem[], minSample = 12): { total: number, segments: FormSegment[] } | null {
  const bili = items.filter(item => item.platform === 'bilibili')
  const total = bili.length
  if (total < minSample) return null

  const counts = new Map<TopicForm, number>()
  for (const item of bili) {
    const form = classifyForm(item.title)
    counts.set(form, (counts.get(form) ?? 0) + 1)
  }

  const named = [...counts.entries()]
    .filter(([form]) => form !== '未分类')
    .sort((a, b) => b[1] - a[1])

  // 只保留前 5 个有名字的形态，剩下的并进「其他」，否则图例长到没法看。
  // 注意不能并进「未分类」——清单/叙事这些是识别出来了只是排名靠后，标成未分类等于冤枉它们。
  const head = named.slice(0, 5)
  const unknown = counts.get('未分类') ?? 0
  const restCount = named.slice(5).reduce((sum, [, count]) => sum + count, 0) + unknown

  const segments: FormSegment[] = head.map(([form, count]) => ({
    form,
    count,
    pct: Math.round((count / total) * 100),
    color: FORM_COLORS[form]
  }))
  if (restCount > 0) {
    segments.push({
      form: '其他',
      count: restCount,
      pct: Math.round((restCount / total) * 100),
      color: FORM_COLORS.未分类,
      note: `含标题看不出形态的 ${unknown} 条`
    })
  }
  return { total, segments }
}
