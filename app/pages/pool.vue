<script setup lang="ts">
import type { SavedTopic, TopicStatus } from '#shared/types'
import { PLATFORM_LABELS } from '#shared/types'

useSeoMeta({ title: '我的选题池 · 选题雷达' })

const toast = useToast()
const { exportTopicToHost, copyMarkdown, busy: hostBusy } = useHostBridge()
const store = useTopics()

const topics = store.topics
const loading = ref(true)
const expandedId = ref<number | null>(null)
const statusFilter = ref<TopicStatus | 'all'>('all')

const STATUS_OPTIONS: Array<{
  label: string
  value: TopicStatus
  color: 'neutral' | 'primary' | 'success' | 'warning'
}> = [
  { label: '想法', value: 'idea', color: 'neutral' },
  { label: '写稿中', value: 'scripting', color: 'primary' },
  { label: '已发布', value: 'published', color: 'success' },
  { label: '搁置', value: 'dropped', color: 'warning' }
]

const statusLabel = (status: TopicStatus) =>
  STATUS_OPTIONS.find(option => option.value === status)?.label ?? status
const statusColor = (status: TopicStatus) =>
  STATUS_OPTIONS.find(option => option.value === status)?.color ?? 'neutral'

const filtered = computed(() =>
  statusFilter.value === 'all'
    ? topics.value
    : topics.value.filter(topic => topic.status === statusFilter.value)
)

function loadTopics() {
  loading.value = true
  try {
    // localStorage 读取是同步的；外面套一层 loading 只是让首屏不闪
    store.load()
  } finally {
    loading.value = false
  }
}

onMounted(loadTopics)

async function updateStatus(topic: SavedTopic, status: string) {
  try {
    store.setStatus(topic.id, status as TopicStatus)
  } catch (error) {
    toast.add({
      title: '更新失败',
      description: String(error),
      color: 'error',
      icon: 'i-lucide-x'
    })
  }
}

async function removeTopic(topic: SavedTopic) {
  try {
    store.remove(topic.id)
    toast.add({
      title: '已从选题池移除',
      icon: 'i-lucide-trash-2',
      color: 'success'
    })
  } catch (error) {
    toast.add({
      title: '删除失败',
      description: String(error),
      color: 'error',
      icon: 'i-lucide-x'
    })
  }
}

async function copyTopic(topic: SavedTopic) {
  await copyMarkdown(
    buildTopicMarkdown(topic, topic.aiAnalysisMd),
    '选题 Markdown 已复制'
  )
}

async function sendTopic(topic: SavedTopic) {
  const result = await exportTopicToHost({
    title: topic.title,
    markdown: buildTopicMarkdown(topic, topic.aiAnalysisMd),
    url: topic.url
  })
  toast.add({
    title: result.ok ? result.message : '发送失败',
    icon: result.ok ? 'i-lucide-send' : 'i-lucide-x',
    color: result.ok ? 'success' : 'error'
  })
}
</script>

<template>
  <UDashboardPanel id="pool">
    <UDashboardNavbar title="我的选题池">
      <template #leading>
        <UDashboardSidebarCollapse />
      </template>
      <template #trailing>
        <UBadge
          :label="`${filtered.length} / ${topics.length}`"
          variant="subtle"
          size="sm"
        />
      </template>
    </UDashboardNavbar>

    <UDashboardToolbar>
      <div class="flex flex-wrap items-center gap-1.5">
        <UButton
          label="全部"
          size="xs"
          :color="statusFilter === 'all' ? 'primary' : 'neutral'"
          :variant="statusFilter === 'all' ? 'soft' : 'ghost'"
          @click="statusFilter = 'all'"
        />
        <UButton
          v-for="option in STATUS_OPTIONS"
          :key="option.value"
          :label="option.label"
          size="xs"
          :color="statusFilter === option.value ? 'primary' : 'neutral'"
          :variant="statusFilter === option.value ? 'soft' : 'ghost'"
          @click="statusFilter = option.value"
        />
      </div>
    </UDashboardToolbar>

    <div class="min-h-0 flex-1 overflow-y-auto">
      <div v-if="loading" class="space-y-3 p-6">
        <USkeleton v-for="index in 4" :key="index" class="h-24 w-full" />
      </div>

      <div
        v-else-if="filtered.length === 0"
        class="flex flex-col items-center justify-center gap-3 px-6 py-24 text-center"
      >
        <UIcon name="i-lucide-pin" class="size-12 text-dimmed" />
        <p class="text-sm font-medium text-highlighted">
          选题池还是空的
        </p>
        <p class="max-w-72 text-xs text-dimmed">
          去「圈内黑马」或「AI 新资讯」挑一条，点「收入选题池」就会出现在这里。
        </p>
        <UButton
          to="/"
          label="去挑热点"
          icon="i-lucide-flame"
          size="sm"
        />
      </div>

      <div
        v-else
        class="mx-auto flex w-full max-w-3xl flex-col gap-3 p-4 lg:p-6"
      >
        <article
          v-for="topic in filtered"
          :key="topic.id"
          class="rounded-xl border border-default bg-default transition-colors hover:border-primary/40"
        >
          <div class="flex flex-col gap-3 p-4">
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0">
                <div
                  class="mb-1 flex flex-wrap items-center gap-2 text-[11px] text-dimmed"
                >
                  <UBadge
                    :label="statusLabel(topic.status)"
                    :color="statusColor(topic.status)"
                    variant="subtle"
                    size="sm"
                  />
                  <span>{{ fmtRelative(topic.createdAt) }}收藏</span>
                  <span v-if="topic.platform">· {{ PLATFORM_LABELS[topic.platform] }}</span>
                </div>
                <h3
                  class="line-clamp-2 text-sm font-semibold leading-snug text-highlighted"
                >
                  {{ topic.title }}
                </h3>
              </div>

              <USelect
                :model-value="topic.status"
                :items="
                  STATUS_OPTIONS.map((option) => ({
                    label: option.label,
                    value: option.value
                  }))
                "
                size="xs"
                class="w-24 shrink-0"
                @update:model-value="
                  (value: string) => updateStatus(topic, value)
                "
              />
            </div>

            <div class="flex flex-wrap items-center gap-1.5">
              <UButton
                v-if="topic.aiAnalysisMd"
                :icon="
                  expandedId === topic.id
                    ? 'i-lucide-chevron-up'
                    : 'i-lucide-chevron-down'
                "
                :label="expandedId === topic.id ? '收起拆解' : '查看拆解'"
                size="xs"
                color="primary"
                variant="soft"
                @click="expandedId = expandedId === topic.id ? null : topic.id"
              />
              <UButton
                v-if="topic.url"
                icon="i-lucide-external-link"
                label="看原文"
                size="xs"
                color="neutral"
                variant="ghost"
                :to="topic.url"
                target="_blank"
              />
              <UButton
                icon="i-lucide-clipboard-copy"
                label="复制"
                size="xs"
                color="neutral"
                variant="ghost"
                @click="copyTopic(topic)"
              />
              <UButton
                icon="i-lucide-send"
                label="发送到宿主"
                size="xs"
                color="neutral"
                variant="ghost"
                :loading="hostBusy"
                @click="sendTopic(topic)"
              />
              <UButton
                icon="i-lucide-trash-2"
                label="移除"
                size="xs"
                color="error"
                variant="ghost"
                class="ml-auto"
                @click="removeTopic(topic)"
              />
            </div>

            <div
              v-if="expandedId === topic.id && topic.aiAnalysisMd"
              class="max-h-96 overflow-y-auto rounded-lg border border-default bg-elevated/30 px-3.5 py-2"
              v-html="renderMarkdownLite(topic.aiAnalysisMd)"
            />
          </div>
        </article>
      </div>
    </div>
  </UDashboardPanel>
</template>
