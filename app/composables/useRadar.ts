/** 信息流状态：一份缓存 + 一次刷新的共享逻辑，三个页签复用。 */
import { createSharedComposable } from '@vueuse/core'
import type { FeedCategory, FeedItem } from '#shared/types'

interface FeedResponse {
  items: FeedItem[]
  fetchedAt: string | null
  total: number
}

interface RefreshResponse {
  bilibili: number
  aiNews: number
  hotSearch: number
  warnings: string[]
  fetchedAt: string
  durationMs: number
  ok: boolean
}

export const useRadar = createSharedComposable(() => {
  const items = useState<FeedItem[]>('radar-items', () => [])
  const fetchedAt = useState<string | null>('radar-fetched-at', () => null)
  const loading = useState<boolean>('radar-loading', () => false)
  const refreshing = useState<boolean>('radar-refreshing', () => false)
  const error = useState<string | null>('radar-error', () => null)
  const warnings = useState<string[]>('radar-warnings', () => [])
  const selectedId = useState<string | null>('radar-selected-id', () => null)
  const toast = useToast()

  const selectedItem = computed(() => items.value.find(item => item.id === selectedId.value) ?? null)

  async function load(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      const data = await $fetch<FeedResponse>('/api/feed', { query: { limit: 200 } })
      items.value = data.items
      fetchedAt.value = data.fetchedAt
      if (selectedId.value !== null && !data.items.some(item => item.id === selectedId.value)) {
        selectedId.value = null
      }
    } catch (fetchError) {
      error.value = fetchError instanceof Error ? fetchError.message : String(fetchError)
    } finally {
      loading.value = false
    }
  }

  async function refresh(): Promise<boolean> {
    if (refreshing.value) return false
    refreshing.value = true
    error.value = null
    try {
      const result = await $fetch<RefreshResponse>('/api/radar/refresh', { method: 'POST' })
      warnings.value = result.warnings ?? []
      await load()
      const total = result.bilibili + result.aiNews + result.hotSearch
      if (total === 0) {
        toast.add({
          title: '这次没抓到新内容',
          description: result.warnings[0] ?? '可能是网络或接口限流，稍后再试',
          icon: 'i-lucide-triangle-alert',
          color: 'warning'
        })
      } else {
        toast.add({
          title: `采集完成：B站 ${result.bilibili} 条 · AI 资讯 ${result.aiNews} 条 · 热搜 ${result.hotSearch} 条`,
          description: result.warnings.length > 0 ? `${result.warnings.length} 个源降级，详见列表底部提示` : `耗时 ${(result.durationMs / 1000).toFixed(1)}s`,
          icon: 'i-lucide-radar',
          color: 'success'
        })
      }
      return total > 0
    } catch (refreshError) {
      error.value = refreshError instanceof Error ? refreshError.message : String(refreshError)
      toast.add({ title: '采集失败', description: error.value, icon: 'i-lucide-x', color: 'error' })
      return false
    } finally {
      refreshing.value = false
    }
  }

  function filterBy(category: FeedCategory | 'all'): FeedItem[] {
    return category === 'all' ? items.value : items.value.filter(item => item.category === category)
  }

  function countOf(category: FeedCategory | 'all'): number {
    return filterBy(category).length
  }

  return {
    items,
    fetchedAt,
    loading,
    refreshing,
    error,
    warnings,
    selectedId,
    selectedItem,
    load,
    refresh,
    filterBy,
    countOf
  }
})
