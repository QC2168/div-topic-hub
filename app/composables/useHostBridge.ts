/**
 * 跨端宿主通信桥：一套代码跑在独立浏览器 / Obsidian iframe / 浏览器侧边栏 / DSH iframe。
 *
 * 判定顺序：URL 显式指定 > iframe 特征 > 独立浏览器。
 * 导出动作按宿主分流：Obsidian 写笔记、DSH 起会话、其它环境复制 Markdown 到剪贴板。
 */
import type { FeedComment, FeedMetrics } from '#shared/types'
import { PLATFORM_LABELS } from '#shared/types'

export type HostTarget = 'standalone' | 'obsidian' | 'dsh' | 'sidepanel' | 'iframe'

export interface HostExportPayload {
  title: string
  markdown: string
  url?: string | null
  /** DSH 会话的启动提示词；缺省时用 title + markdown 兜底 */
  prompt?: string
}

export interface HostExportResult {
  ok: boolean
  /** 走的是哪条通道，便于 UI 给出对应文案 */
  channel: 'obsidian' | 'dsh' | 'clipboard'
  message: string
}

const HOST_LABELS: Record<HostTarget, string> = {
  standalone: '独立浏览器',
  obsidian: 'Obsidian 侧边栏',
  dsh: 'DeepSeek DSH 侧边栏',
  sidepanel: '浏览器侧边栏',
  iframe: '嵌入模式'
}

function detectHost(): { target: HostTarget, embedded: boolean } {
  if (typeof window === 'undefined') return { target: 'standalone', embedded: false }

  const params = new URLSearchParams(window.location.search)
  const forced = params.get('host')
  const embedParam = params.get('embed') === 'true' || params.get('embed') === '1'
  const inIframe = window.self !== window.top
  const embedded = inIframe || embedParam
  const ua = navigator.userAgent

  const fromParam: HostTarget | undefined = forced === null
    ? undefined
    : (['obsidian', 'dsh', 'sidepanel', 'standalone'] as HostTarget[]).includes(forced as HostTarget)
        ? forced as HostTarget
        : undefined

  if (fromParam !== undefined) return { target: fromParam, embedded }

  if (!embedded) return { target: 'standalone', embedded: false }

  if (ua.includes('Obsidian')) return { target: 'obsidian', embedded: true }
  if (document.referrer.startsWith('chrome-extension://') || document.referrer.startsWith('moz-extension://')) {
    return { target: 'sidepanel', embedded: true }
  }
  return { target: 'iframe', embedded: true }
}

/** 等待宿主回执；超时不算失败（部分宿主实现不回执）。 */
function waitForAck(types: string[], timeoutMs = 1800): Promise<boolean> {
  return new Promise((resolve) => {
    if (typeof window === 'undefined') return resolve(false)
    const timer = setTimeout(() => {
      window.removeEventListener('message', onMessage)
      resolve(false)
    }, timeoutMs)

    function onMessage(event: MessageEvent) {
      const data = event.data as { type?: string } | null
      if (data === null || typeof data.type !== 'string' || !types.includes(data.type)) return
      clearTimeout(timer)
      window.removeEventListener('message', onMessage)
      resolve(true)
    }
    window.addEventListener('message', onMessage)
  })
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    // 非 https / 无权限时降级到 execCommand
    try {
      const area = document.createElement('textarea')
      area.value = text
      area.style.position = 'fixed'
      area.style.opacity = '0'
      document.body.appendChild(area)
      area.select()
      const ok = document.execCommand('copy')
      document.body.removeChild(area)
      return ok
    } catch {
      return false
    }
  }
}

export function useHostBridge() {
  const target = useState<HostTarget>('host-target', () => 'standalone')
  const embedded = useState<boolean>('host-embedded', () => false)
  const busy = useState<boolean>('host-busy', () => false)
  const toast = useToast()

  function detect() {
    const result = detectHost()
    target.value = result.target
    embedded.value = result.embedded
  }

  const hostLabel = computed(() => HOST_LABELS[target.value])
  const canPostToParent = computed(() => embedded.value && target.value !== 'standalone')

  /** 通用消息出口：宿主只要监听 message 就能扩展新能力。 */
  function postToHost(type: string, payload: Record<string, unknown>) {
    if (typeof window === 'undefined' || window.parent === window) return false
    window.parent.postMessage({ type, ...payload }, '*')
    return true
  }

  async function exportTopicToHost(payload: HostExportPayload): Promise<HostExportResult> {
    busy.value = true
    try {
      const markdown = payload.markdown
      const fallbackPrompt = payload.prompt
        ?? `基于下面这条热点，帮我写一版视频逐字稿（口语化、开头 3 秒有钩子）：\n\n${payload.title}\n${payload.url ?? ''}\n\n---\n\n${markdown}`

      if (target.value === 'obsidian' && canPostToParent.value) {
        const acked = waitForAck(['OBSIDIAN_NOTE_CREATED', 'OBSIDIAN_ERROR'])
        postToHost('OBSIDIAN_CREATE_NOTE', { title: payload.title, markdown, url: payload.url ?? null })
        await acked
        return { ok: true, channel: 'obsidian', message: '已发送到 Obsidian，笔记已写入你的库' }
      }

      if (target.value === 'dsh' && canPostToParent.value) {
        const acked = waitForAck(['DSH_SESSION_STARTED', 'DSH_ERROR'])
        postToHost('DSH_START_SESSION', { prompt: fallbackPrompt, title: payload.title, url: payload.url ?? null })
        await acked
        return { ok: true, channel: 'dsh', message: '已唤起 DSH 会话，可以开始写逐字稿了' }
      }

      const copied = await copyToClipboard(markdown)
      return copied
        ? { ok: true, channel: 'clipboard', message: '完整选题方案已复制到剪贴板' }
        : { ok: false, channel: 'clipboard', message: '复制失败，请手动全选复制' }
    } finally {
      busy.value = false
    }
  }

  /** 复制任意文本（详情页「复制 Markdown」按钮）。 */
  async function copyMarkdown(markdown: string, label = '已复制到剪贴板') {
    const ok = await copyToClipboard(markdown)
    toast.add({ title: ok ? label : '复制失败', icon: ok ? 'i-lucide-check' : 'i-lucide-x', color: ok ? 'success' : 'error' })
    return ok
  }

  return {
    target,
    embedded,
    busy,
    hostLabel,
    canPostToParent,
    detect,
    postToHost,
    exportTopicToHost,
    copyMarkdown
  }
}

/** 导出所需的最小字段集合：FeedItem 与 SavedTopic 都能直接传进来。 */
export interface TopicLike {
  title: string
  author?: string | null
  platform?: string | null
  url?: string | null
  summary?: string
  publishedAt?: string | null
  metrics?: FeedMetrics
  comments?: FeedComment[]
  badges?: Array<{ label: string }>
}

/** 把一条热点（+ 可选 AI 拆解稿）转成结构化 Markdown，三端共用同一份内容。 */
export function buildTopicMarkdown(item: TopicLike, analysisMd?: string | null): string {
  const lines: string[] = [`# ${item.title}`, '']
  const meta: string[] = []
  if (item.author) meta.push(`来源：${item.author}`)
  if (item.platform) meta.push(`平台：${(PLATFORM_LABELS as Record<string, string>)[item.platform] ?? item.platform}`)
  if (item.publishedAt) meta.push(`发布：${String(item.publishedAt).slice(0, 10)}`)
  if (item.badges !== undefined && item.badges.length > 0) meta.push(`标签：${item.badges.map(badge => badge.label).join(' ')}`)
  if (meta.length > 0) lines.push(`> ${meta.join(' · ')}`, '')

  const metrics = item.metrics ?? {}
  const metricParts: string[] = []
  if (metrics.play !== undefined) metricParts.push(`播放 ${metrics.play}`)
  if (metrics.like !== undefined) metricParts.push(`点赞 ${metrics.like}`)
  if (metrics.reply !== undefined) metricParts.push(`评论 ${metrics.reply}`)
  if (metrics.favorite !== undefined) metricParts.push(`收藏 ${metrics.favorite}`)
  if (metrics.stars !== undefined) metricParts.push(`Star ${metrics.stars}`)
  if (metrics.starsToday !== undefined) metricParts.push(`今日 +${metrics.starsToday}`)
  if (metricParts.length > 0) lines.push(`**数据**：${metricParts.join(' · ')}`, '')

  if (item.url) lines.push(`**原链接**：${item.url}`, '')
  if (item.summary !== undefined && item.summary !== '') lines.push('## 内容简介', '', item.summary, '')

  const comments = item.comments ?? []
  if (comments.length > 0) {
    lines.push('## 高赞评论', '')
    for (const comment of comments) {
      lines.push(`- 👍${comment.likes} **${comment.author}**：${comment.content}`)
    }
    lines.push('')
  }

  if (analysisMd !== undefined && analysisMd !== null && analysisMd.trim() !== '') {
    lines.push('## AI 拆解方案', '', analysisMd.trim(), '')
  }

  lines.push('---', `_由选题雷达导出 · ${new Date().toLocaleString('zh-CN')}_`)
  return lines.join('\n')
}
