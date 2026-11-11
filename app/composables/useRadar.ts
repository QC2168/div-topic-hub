/** 信息流状态：一份共享的「圈内黑马 + AI 资讯」快照，三个页签复用。 */
import { createSharedComposable } from '@vueuse/core'
import type { FeedCategory, FeedItem } from '#shared/types'

export const useRadar = createSharedComposable(() => {
  const hub = useHubData()
  const items = useState<FeedItem[]>('radar-items', () => [])
  const fetchedAt = useState<string | null>('radar-fetched-at', () => null)
  const loading = useState<boolean>('radar-loading', () => false)
  const refreshing = useState<boolean>('radar-refreshing', () => false)
  const error = useState<string | null>('radar-error', () => null)
  const warnings = useState<string[]>('radar-warnings', () => [])
  const stale = useState<boolean>('radar-stale', () => false)
  const selectedId = useState<string | null>('radar-selected-id', () => null)
  const toast = useToast()

  const selectedItem = computed(() => items.value.find(item => item.id === selectedId.value) ?? null)

  async function load(options: { force?: boolean } = {}): Promise<void> {
    loading.value = true
    error.value = null
    try {
      const bundle = await hub.feed({ force: options.force === true })
      items.value = bundle.items
      fetchedAt.value = bundle.fetchedAt
      warnings.value = bundle.warnings
      stale.value = bundle.stale
      if (selectedId.value !== null && !bundle.items.some(item => item.id === selectedId.value)) {
        selectedId.value = null
      }
    } catch (fetchError) {
      error.value = fetchError instanceof Error ? fetchError.message : String(fetchError)
    } finally {
      loading.value = false
    }
  }

  /**
   * 「刷新」的含义变了：以前是**跑一次采集**，现在是**绕过缓存重新拉快照**。
   * 采集已经交给每天 09:00 的 Actions，前端能做的只有拿更新的一份文件。
   * 所以提示语必须说实话，不能让用户以为点了就立刻有新视频。
   */
  async function refresh(): Promise<boolean> {
    if (refreshing.value) return false
    refreshing.value = true
    error.value = null
    try {
      await load({ force: true })
      const at = fetchedAt.value === null ? '未知时间' : new Date(fetchedAt.value).toLocaleString('zh-CN')
      toast.add({
        title: '已拉取最新快照',
        description: `这份数据采集于 ${at}；采集本身每天 09:00 自动跑一次`,
        icon: 'i-lucide-refresh-cw',
        color: 'success'
      })
      if (stale.value) {
        toast.add({
          title: '这份快照偏旧',
          description: warnings.value[0] ?? '超过一天没更新，可能上游采集受阻',
          icon: 'i-lucide-triangle-alert',
          color: 'warning'
        })
      }
      return items.value.length > 0
    } catch (refreshError) {
      error.value = refreshError instanceof Error ? refreshError.message : String(refreshError)
      toast.add({ title: '拉取失败', description: error.value, icon: 'i-lucide-x', color: 'error' })
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
    stale,
    selectedId,
    selectedItem,
    load,
    refresh,
    filterBy,
    countOf
  }
})
