/**
 * 浏览器直连 DeepSeek 的流式拆解。
 *
 * 为什么不走自己的服务端：实测 api.deepseek.com 的预检会回显
 * `access-control-allow-origin`，浏览器可以直接发请求。直连的好处是 Key 只存在
 * 本机 localStorage，不经过任何中转；代价是拆解功能从此不依赖后端，
 * 网站可以纯静态部署。
 *
 * Prompt 与非流式的结构化约束都在 shared/ai-prompt.ts，和旧的服务端实现同一份。
 */
import type { FeedItem } from '#shared/types'
import { SYSTEM_PROMPT, buildUserPrompt, toAnalyzeInput } from '#shared/ai-prompt'

interface ChatDelta {
  choices?: Array<{ delta?: { content?: string } }>
}

export function useAiAnalyze() {
  const { settings, load } = useLocalSettings()

  function config() {
    load()
    const apiKey = settings.value.deepseekApiKey.trim()
    if (apiKey === '') {
      throw new Error('还没配置 DeepSeek API Key，去「设置」页填一个（只存本机浏览器）')
    }
    return {
      apiKey,
      baseUrl: (settings.value.deepseekBaseUrl || 'https://api.deepseek.com').replace(/\/$/, ''),
      model: settings.value.deepseekModel || 'deepseek-chat'
    }
  }

  /**
   * 流式生成，逐段回调。中途调 abort 会抛 AbortError，调用方按「已中断」处理。
   */
  async function analyze(item: FeedItem, onChunk: (text: string) => void, signal: AbortSignal): Promise<void> {
    const { apiKey, baseUrl, model } = config()

    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        stream: true,
        temperature: 0.7,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: buildUserPrompt(toAnalyzeInput(item)) }
        ]
      }),
      signal
    })

    if (!res.ok || res.body === null) {
      const detail = await res.text().catch(() => '')
      throw new Error(`DeepSeek 返回 ${res.status}${detail === '' ? '' : `：${detail.slice(0, 200)}`}`)
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed.startsWith('data:')) continue
        const payload = trimmed.slice(5).trim()
        if (payload === '' || payload === '[DONE]') continue
        try {
          const parsed = JSON.parse(payload) as ChatDelta
          const delta = parsed.choices?.[0]?.delta?.content
          if (typeof delta === 'string' && delta !== '') onChunk(delta)
        } catch {
          // 单行残片跳过，不影响后续增量
        }
      }
    }
  }

  /** 用一次极短的请求验证 Key 与网络，返回往返耗时 */
  async function testConnection(): Promise<{ latencyMs: number, model: string }> {
    const { apiKey, baseUrl, model } = config()
    const startedAt = Date.now()
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        max_tokens: 1,
        messages: [{ role: 'user', content: 'ping' }]
      })
    })
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      throw new Error(`HTTP ${res.status}${detail === '' ? '' : `：${detail.slice(0, 150)}`}`)
    }
    return { latencyMs: Date.now() - startedAt, model }
  }

  return { analyze, testConnection }
}
