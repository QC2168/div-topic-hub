/** 校验 DeepSeek Key 是否可用（设置页「测试连接」按钮） */
import { loadHubSettings } from '../../utils/settings'
import { resolveDeepSeekConfig } from '../../utils/deepseek'

export default defineEventHandler(async () => {
  const config = resolveDeepSeekConfig()
  if (config.apiKey === '') {
    throw createError({ statusCode: 400, statusMessage: '尚未配置 API Key' })
  }

  const started = Date.now()
  try {
    const res = await fetch(`${config.baseUrl}/models`, {
      headers: { authorization: `Bearer ${config.apiKey}` },
      signal: AbortSignal.timeout(15_000)
    })
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      throw new Error(`HTTP ${res.status} ${detail.slice(0, 160)}`)
    }
    const json = await res.json() as { data?: Array<{ id?: string }> }
    return {
      ok: true,
      latencyMs: Date.now() - started,
      model: config.model,
      availableModels: (json.data ?? []).map(item => item.id).filter(Boolean).slice(0, 10),
      rssFeedCount: loadHubSettings().rssFeeds.length
    }
  } catch (error) {
    throw createError({
      statusCode: 502,
      statusMessage: `连接失败：${error instanceof Error ? error.message : String(error)}`
    })
  }
})
