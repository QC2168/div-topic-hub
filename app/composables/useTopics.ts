/**
 * 选题池：存浏览器 localStorage，不再走后端 SQLite。
 *
 * ── 代价与取舍 ──
 * 好处是网站可以纯静态跑，不依赖任何服务；代价是换电脑、清缓存、换浏览器就没了，
 * 也没法多端同步。所以「导出 Markdown / 发送到宿主」这些出口保留了——
 * 真的要长期保存，走导出，别指望浏览器存储。
 *
 * 数据结构与 SavedTopic 完全一致，页面那边不用改字段名。
 */
import type { FeedItem, SavedTopic, TopicStatus } from '#shared/types'

const STORAGE_KEY = 'div-topic-hub:topics'

function emptyTopic(item: FeedItem, id: number): SavedTopic {
  return {
    id,
    sourceItemId: item.id,
    title: item.title,
    url: item.url,
    platform: item.platform,
    category: item.category,
    metrics: item.metrics,
    comments: item.comments,
    aiAnalysisMd: null,
    status: 'idea',
    createdAt: new Date().toISOString()
  }
}

export const useTopics = createSharedComposable(() => {
  const topics = useState<SavedTopic[]>('local-topics', () => [])
  const ready = useState<boolean>('local-topics-ready', () => false)

  function persist(): void {
    if (!import.meta.client) return
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(topics.value))
    } catch {
      // 隐私模式 / 配额满：写不进去也不该让页面崩，用户的改动只是这次会话有效
    }
  }

  /** 幂等：多个页面调用只有第一次真正读盘，避免重复解析 */
  function load(): SavedTopic[] {
    if (!import.meta.client || ready.value) return topics.value
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw !== null) {
        const parsed = JSON.parse(raw) as SavedTopic[]
        if (Array.isArray(parsed)) topics.value = parsed
      }
    } catch {
      topics.value = []
    }
    ready.value = true
    return topics.value
  }

  onMounted(load)

  /** 收藏一条热点；已经收藏过就返回原来那条，不重复插 */
  function save(item: FeedItem): SavedTopic {
    load()
    const existing = topics.value.find(topic => topic.sourceItemId === item.id)
    if (existing !== undefined) return existing

    const nextId = topics.value.reduce((max, topic) => Math.max(max, topic.id), 0) + 1
    const created = emptyTopic(item, nextId)
    topics.value = [created, ...topics.value]
    persist()
    return created
  }

  function patch(id: number, changes: Partial<SavedTopic>): SavedTopic | null {
    load()
    let updated: SavedTopic | null = null
    topics.value = topics.value.map((topic) => {
      if (topic.id !== id) return topic
      updated = { ...topic, ...changes }
      return updated
    })
    persist()
    return updated
  }

  function setStatus(id: number, status: TopicStatus): SavedTopic | null {
    return patch(id, { status })
  }

  function setAnalysis(id: number, aiAnalysisMd: string): SavedTopic | null {
    return patch(id, { aiAnalysisMd })
  }

  function remove(id: number): void {
    load()
    topics.value = topics.value.filter(topic => topic.id !== id)
    persist()
  }

  function findByItemId(itemId: string): SavedTopic | null {
    load()
    return topics.value.find(topic => topic.sourceItemId === itemId) ?? null
  }

  return { topics, load, save, patch, setStatus, setAnalysis, remove, findByItemId }
})
