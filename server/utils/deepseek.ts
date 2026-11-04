/**
 * DeepSeek 蹭热点拆解（流式）。
 *
 * 只做一件事：把一条热点的标题/指标/简介/高赞评论喂给 DeepSeek，让它按
 * 固定结构吐 Markdown。Key 优先读本地 settings 表，其次读环境变量。
 */
import type { FeedComment, FeedItem, FeedMetrics } from '#shared/types'
import { breakoutRatio, formatCount } from './score'
import { loadHubSettings } from './settings'

export interface DeepSeekConfig {
  apiKey: string
  baseUrl: string
  model: string
}

/** 优先级：本地设置（设置页保存）> 环境变量 / runtimeConfig > 官方默认值。 */
export function resolveDeepSeekConfig(): DeepSeekConfig {
  const config = useRuntimeConfig()
  const settings = loadHubSettings()
  return {
    apiKey: (settings.deepseekApiKey ?? '') || String(config.deepseekApiKey ?? '') || String(process.env.DEEPSEEK_API_KEY ?? ''),
    baseUrl: (settings.deepseekBaseUrl || String(config.deepseekBaseUrl ?? 'https://api.deepseek.com')).replace(/\/$/, ''),
    model: settings.deepseekModel || String(config.deepseekModel ?? 'deepseek-chat')
  }
}

const SYSTEM_PROMPT = `你是一个 B 站科技区/知识区的资深选题策划。你的工作不是复述内容，而是判断「这条为什么爆、哪部分能抄、哪部分抄不了」。

三条铁律：
1. 只给能落地的判断，禁止正确的废话。「内容优质」「抓住了用户痛点」「选题新颖」这类话一个字都不要写。
2. 必须区分「可复用」和「不可复用」。身份壁垒（三甲医生、大厂员工、职业选手）、资源壁垒（独家属实、内部数据、独家素材）、账号壁垒（百万粉基础盘带来的初始推荐）都要明确点出来——只给能抄的，等于把人往坑里带。
3. 不编数据。没给的信息就写「未提供」，不要估算、不要脑补评论区在说什么。`

function metricsLine(platform: string, metrics: FeedMetrics): string {
  const parts: string[] = []
  if (metrics.play !== undefined) parts.push(`播放 ${formatCount(metrics.play)}`)
  if (metrics.like !== undefined) parts.push(`点赞 ${formatCount(metrics.like)}`)
  if (metrics.reply !== undefined) parts.push(`评论 ${formatCount(metrics.reply)}`)
  if (metrics.danmaku !== undefined) parts.push(`弹幕 ${formatCount(metrics.danmaku)}`)
  if (metrics.favorite !== undefined) parts.push(`收藏 ${formatCount(metrics.favorite)}`)
  if (metrics.stars !== undefined) parts.push(`Star ${formatCount(metrics.stars)}`)
  if (metrics.starsToday !== undefined) parts.push(`今日新增 Star ${formatCount(metrics.starsToday)}`)
  if (metrics.points !== undefined) parts.push(`HN 得分 ${formatCount(metrics.points)}`)
  return parts.length === 0 ? '（无指标数据）' : parts.join(' · ')
}

/** 账号量级单独一行：破圈倍率是判断「大号基本盘 vs 小号破圈」的关键，不能混在指标里。 */
function accountLine(metrics: FeedMetrics): string {
  const fans = metrics.fans
  const play = metrics.play
  if (fans === undefined || fans <= 0) return '粉丝数：未提供（无法判断账号量级，请如实写"未提供"）'
  const ratio = breakoutRatio(play, fans)
  const scale = ratio === null
    ? ''
    : ratio >= 10
      ? '，属于明显破圈（播放远超粉丝基本盘）'
      : ratio >= 3
        ? '，属于小号跑出量'
        : ratio >= 1
          ? '，略高于基本盘'
          : '，属于大号的基本盘表现'
  return `粉丝 ${formatCount(fans)}｜播放/粉丝 ${ratio === null ? '未提供' : `${ratio.toFixed(1)} 倍`}${scale}`
}

export interface AnalyzeInput {
  title: string
  platform?: string
  author?: string | null
  summary?: string
  url?: string
  publishedAt?: string | null
  metrics?: FeedMetrics
  comments?: FeedComment[]
}

export function buildUserPrompt(input: AnalyzeInput): string {
  const comments = (input.comments ?? [])
    .slice(0, 5)
    .map((comment, index) => `${index + 1}. [👍${comment.likes}] ${comment.author}：${comment.content}`)
    .join('\n')
  const metrics = input.metrics ?? {}

  return `请拆解下面这条正在爆的内容，给出可以直接开拍的选题方案。

【标题】${input.title}
【平台】${input.platform ?? '未知'}${input.author ? ` 【作者】${input.author}` : ''}
【数据】${metricsLine(input.platform ?? '', metrics)}
【账号】${accountLine(metrics)}
【发布时间】${input.publishedAt ?? '未知'}
【内容简介】${input.summary?.trim() || '（无简介）'}
【评论区高赞】
${comments || '（未抓到评论）'}

严格按以下 Markdown 结构输出，不要加任何前言或结尾寒暄：

## 🎯 3 秒看懂热点
用 3 句话说清：①它是什么 ②为什么现在突然火 ③评论区最大的争议或共鸣点是什么。每句一行，短句。

## 🧩 爆款结构拆解
- **内容形态**：从「清单 / 教程 / 测评 / 叙事 / 避雷 / 数据 / 资源 / 观点」里选一个最贴的，用一句话说依据
- **标题钩子**：这条标题用了哪个钩子（数字 / 人群标签 / 痛点原话 / 反差 / 身份背书 / 时效），这个钩子能复用到什么题材上
- **账号量级**：结合上面的粉丝数与播放/粉丝倍率判断，这是「大号基本盘」还是「小号破圈」。粉丝数未提供就直说未提供

## ✅ 可复用 / ❌ 不可复用 / 🕳 空位
**可复用**
- <具体的做法，能被另一个 UP 直接照搬，2~3 条>

**不可复用**
- <每条都写明属于哪一类壁垒：身份壁垒 / 资源壁垒 / 账号壁垒，以及为什么照抄会失效>

**空位**
- <同类内容里还没人做的角度，1~2 条。要说明这是真机会，还是平台不给这种形态流量>

## 🔥 3 个借势视频角度

### 角度 A · 科普揭秘向
- **爆款标题 1**：<标题>
- **爆款标题 2**：<标题>
- **核心大纲**：
  1. <第一步：开场钩子，具体到第一句话怎么说>
  2. <第二步：主体展开，讲什么、用什么例子>
  3. <第三步：收尾与引导互动>

### 角度 B · 实测对比向
（同上结构：2 个标题 + 3 步大纲）

### 角度 C · 锐评避坑向
（同上结构：2 个标题 + 3 步大纲）

## ⏱ 蹭热点的时效判断
一句话：这个热点还剩几天窗口期，最晚什么时候必须发。`
}

export interface StreamAnalysisOptions {
  signal?: AbortSignal
  temperature?: number
}

/**
 * 调用 DeepSeek 流式接口，返回纯文本增量流（已抽取 delta.content）。
 * 上游错误以异常抛出，由路由层转成结构化错误。
 */
export async function streamDeepSeek(prompt: string, options: StreamAnalysisOptions = {}): Promise<ReadableStream<Uint8Array>> {
  const config = resolveDeepSeekConfig()
  if (config.apiKey === '') {
    throw createError({ statusCode: 400, statusMessage: '尚未配置 DeepSeek API Key，请到「源与 AI 设置」填写' })
  }

  const upstream = await fetch(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'authorization': `Bearer ${config.apiKey}`
    },
    body: JSON.stringify({
      model: config.model,
      stream: true,
      temperature: options.temperature ?? 0.7,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: prompt }
      ]
    }),
    signal: options.signal ?? AbortSignal.timeout(120_000)
  })

  if (!upstream.ok || upstream.body === null) {
    const detail = await upstream.text().catch(() => '')
    throw createError({
      statusCode: 502,
      statusMessage: `DeepSeek 返回 ${upstream.status}：${detail.slice(0, 200)}`
    })
  }

  const decoder = new TextDecoder()
  const encoder = new TextEncoder()
  let buffer = ''

  return upstream.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed.startsWith('data:')) continue
        const payload = trimmed.slice(5).trim()
        if (payload === '' || payload === '[DONE]') continue
        try {
          const parsed = JSON.parse(payload) as { choices?: Array<{ delta?: { content?: string } }> }
          const delta = parsed.choices?.[0]?.delta?.content
          if (typeof delta === 'string' && delta !== '') controller.enqueue(encoder.encode(delta))
        } catch {
          // 单行解析失败不影响后续增量
        }
      }
    },
    flush(controller) {
      const trimmed = buffer.trim()
      if (!trimmed.startsWith('data:')) return
      const payload = trimmed.slice(5).trim()
      if (payload === '' || payload === '[DONE]') return
      try {
        const parsed = JSON.parse(payload) as { choices?: Array<{ delta?: { content?: string } }> }
        const delta = parsed.choices?.[0]?.delta?.content
        if (typeof delta === 'string' && delta !== '') controller.enqueue(encoder.encode(delta))
      } catch {
        // 忽略尾部残片
      }
    }
  }))
}

/** 把 FeedItem 映射成 prompt 输入。 */
export function toAnalyzeInput(item: FeedItem): AnalyzeInput {
  return {
    title: item.title,
    platform: item.platform,
    author: item.author,
    summary: item.summary,
    url: item.url,
    publishedAt: item.publishedAt,
    metrics: item.metrics,
    comments: item.comments
  }
}
