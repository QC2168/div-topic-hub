/**
 * 本地设置：DeepSeek 的 Key / Base URL / 模型存在浏览器里，不再写服务端 SQLite。
 *
 * ── 为什么可以直接放浏览器 ──
 * 实测 api.deepseek.com 的 CORS 会回显 Origin（`access-control-allow-origin`），
 * 浏览器可以直连，不经过任何中转。Key 因此不需要发给我们的服务端——
 * 反过来说，它现在只存在于这台机器的这个浏览器里，换设备要重填。
 *
 * 「测试连接」也走直连，用的是一次极短的 chat 请求，不消耗可用额度之外的东西。
 */
export interface LocalSettings {
  deepseekApiKey: string
  deepseekBaseUrl: string
  deepseekModel: string
}

const STORAGE_KEY = 'div-topic-hub:settings'

const DEFAULTS: LocalSettings = {
  deepseekApiKey: '',
  deepseekBaseUrl: 'https://api.deepseek.com',
  deepseekModel: 'deepseek-chat'
}

export const useLocalSettings = createSharedComposable(() => {
  const settings = useState<LocalSettings>('local-settings', () => ({ ...DEFAULTS }))
  const ready = useState<boolean>('local-settings-ready', () => false)

  function load(): LocalSettings {
    if (!import.meta.client || ready.value) return settings.value
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw !== null) {
        const parsed = JSON.parse(raw) as Partial<LocalSettings>
        settings.value = {
          deepseekApiKey: typeof parsed.deepseekApiKey === 'string' ? parsed.deepseekApiKey : '',
          deepseekBaseUrl: parsed.deepseekBaseUrl || DEFAULTS.deepseekBaseUrl,
          deepseekModel: parsed.deepseekModel || DEFAULTS.deepseekModel
        }
      }
    } catch {
      settings.value = { ...DEFAULTS }
    }
    ready.value = true
    return settings.value
  }

  onMounted(load)

  function save(next: Partial<LocalSettings>): void {
    settings.value = { ...settings.value, ...next }
    if (!import.meta.client) return
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings.value))
    } catch {
      // 写不进去就当本次会话有效
    }
  }

  function clearApiKey(): void {
    save({ deepseekApiKey: '' })
  }

  function masked(): string {
    const key = settings.value.deepseekApiKey
    if (key === '') return ''
    if (key.length <= 8) return '••••••••'
    return `${key.slice(0, 4)}••••${key.slice(-4)}`
  }

  return { settings, load, save, clearApiKey, masked }
})
