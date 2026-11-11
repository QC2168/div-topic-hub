<script setup lang="ts">
import type { FeedCategory, FeedItem } from '#shared/types'

const props = defineProps<{
  items: FeedItem[]
  loading?: boolean
  refreshing?: boolean
  selectedId?: string | null
  categories: Array<{ value: FeedCategory | 'all', label: string, count: number }>
  activeCategory: FeedCategory | 'all'
  activeSince?: string | null
}>()

const emit = defineEmits<{
  'select': [item: FeedItem]
  'refresh': []
  'update:activeCategory': [value: FeedCategory | 'all']
}>()

const listRef = ref<HTMLElement | null>(null)

watch(() => props.selectedId, async () => {
  await nextTick()
  const el = listRef.value?.querySelector<HTMLElement>('[data-selected="true"]')
  el?.scrollIntoView({ block: 'nearest' })
})

/**
 * 封面图：静态部署没有服务端，只能让浏览器直连 CDN。
 * B 站 CDN 会拦带站外 Referer 的请求，所以 <img> 上带 referrerpolicy="no-referrer"，
 * 让它按「直接访问」处理；万一还是被拦，onerror 把这张图藏掉，不影响列表本身。
 */
const failedCovers = ref<Set<string>>(new Set())

function coverUrl(url: string | null): string | null {
  if (url === null || url === '') return null
  if (failedCovers.value.has(url)) return null
  return url.startsWith('//') ? `https:${url}` : url
}

function markCoverFailed(url: string | null): void {
  if (url === null) return
  failedCovers.value = new Set(failedCovers.value).add(url)
}

/** 形态分布：只跟当前筛选结果走，样本不足时自动隐藏 */
const formDist = computed(() => formDistribution(props.items))

const toneClass: Record<string, string> = {
  error: 'bg-error/10 text-error',
  warning: 'bg-warning/10 text-warning',
  primary: 'bg-primary/10 text-primary',
  success: 'bg-success/10 text-success',
  neutral: 'bg-elevated text-toned'
}
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <!-- 顶部工具栏：分类胶囊 + 刷新采集 -->
    <div class="flex items-center gap-2 border-b border-default px-3 py-2">
      <div class="flex min-w-0 flex-1 gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <UButton
          v-for="category in categories"
          :key="category.value"
          :label="category.count > 0 ? `${category.label} ${category.count}` : category.label"
          size="xs"
          :color="activeCategory === category.value ? 'primary' : 'neutral'"
          :variant="activeCategory === category.value ? 'soft' : 'ghost'"
          class="shrink-0"
          @click="emit('update:activeCategory', category.value)"
        />
      </div>

      <UTooltip text="重新采集全部源">
        <UButton
          icon="i-lucide-refresh-cw"
          size="xs"
          color="neutral"
          variant="ghost"
          :loading="refreshing"
          aria-label="刷新采集"
          @click="emit('refresh')"
        />
      </UTooltip>
    </div>

    <!-- 今日形态分布：一眼看出平台当下在给哪种内容流量 -->
    <div v-if="formDist" class="border-b border-default px-3 py-2">
      <div class="mb-1.5 flex items-baseline justify-between">
        <span class="text-[11px] font-medium text-toned">今日形态分布</span>
        <span class="text-[11px] text-dimmed">{{ formDist.total }} 条 · 按标题粗分</span>
      </div>
      <div class="flex h-1.5 gap-px overflow-hidden rounded-full bg-elevated">
        <div
          v-for="segment in formDist.segments"
          :key="segment.form"
          :style="{ width: `${segment.pct}%`, backgroundColor: segment.color }"
          :title="segment.note ? `${segment.form} ${segment.count} 条（${segment.note}）` : `${segment.form} ${segment.count} 条`"
        />
      </div>
      <div class="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-dimmed">
        <span
          v-for="segment in formDist.segments"
          :key="segment.form"
          class="inline-flex items-center gap-1"
          :title="segment.note ? `${segment.count} 条 · ${segment.note}` : `${segment.count} 条`"
        >
          <span class="size-1.5 shrink-0 rounded-full" :style="{ backgroundColor: segment.color }" />
          {{ segment.form }} {{ segment.pct }}%
        </span>
      </div>
    </div>

    <!-- 列表 -->
    <div ref="listRef" class="min-h-0 flex-1 divide-y divide-default overflow-y-auto">
      <template v-if="loading && items.length === 0">
        <div v-for="index in 6" :key="index" class="space-y-2.5 p-4">
          <USkeleton class="h-4 w-1/3" />
          <USkeleton class="h-4 w-full" />
          <USkeleton class="h-3 w-2/3" />
        </div>
      </template>

      <div
        v-else-if="items.length === 0"
        class="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center"
      >
        <UIcon name="i-lucide-radar" class="size-12 text-dimmed" />
        <p class="text-sm font-medium text-highlighted">
          还没有采集到内容
        </p>
        <p class="max-w-64 text-xs text-dimmed">
          点右上角刷新，或先到「源与 AI 设置」确认 RSS 源与 DeepSeek Key。
        </p>
        <UButton
          label="立即采集"
          icon="i-lucide-download"
          size="sm"
          :loading="refreshing"
          @click="emit('refresh')"
        />
      </div>

      <template v-else>
        <div
          v-for="item in items"
          :key="item.id"
          :data-selected="item.id === selectedId"
          class="group cursor-pointer border-l-2 px-4 py-3 transition-colors"
          :class="item.id === selectedId
            ? 'border-primary bg-primary/5'
            : 'border-transparent hover:border-primary/40 hover:bg-elevated/60'"
          @click="emit('select', item)"
        >
          <div class="flex items-start gap-3">
            <div class="min-w-0 flex-1">
              <div class="mb-1.5 flex flex-wrap items-center gap-1.5">
                <span
                  v-for="badge in item.badges.slice(0, 2)"
                  :key="badge.label"
                  class="rounded px-1.5 py-0.5 text-[11px] font-medium"
                  :class="toneClass[badge.tone] ?? toneClass.neutral"
                >{{ badge.label }}</span>
                <span class="text-[11px] text-dimmed">{{ item.platform === 'github' ? '今日趋势' : fmtRelative(item.publishedAt) }}</span>
              </div>

              <p class="line-clamp-2 text-sm font-medium leading-snug text-highlighted">
                {{ item.title }}
              </p>

              <div class="mt-1.5 flex items-center gap-2 text-xs text-dimmed">
                <span class="max-w-32 truncate">{{ item.author ?? '未知来源' }}</span>
                <span class="text-dimmed/50">·</span>
                <span class="font-medium text-toned">{{ primaryMetric(item).value }}</span>
                <span>{{ primaryMetric(item).label }}</span>
                <template v-if="item.platform === 'bilibili' && fmtInteractionRate(item.metrics)">
                  <span class="text-dimmed/50">·</span>
                  <span>互动 {{ fmtInteractionRate(item.metrics) }}</span>
                </template>
              </div>
            </div>

            <img
              v-if="coverUrl(item.cover)"
              :src="coverUrl(item.cover) as string"
              alt=""
              loading="lazy"
              referrerpolicy="no-referrer"
              class="hidden h-12 w-20 shrink-0 rounded object-cover sm:block"
              @error="markCoverFailed(item.cover)"
            >
          </div>
        </div>
      </template>
    </div>

    <div v-if="activeSince" class="border-t border-default px-3 py-1.5 text-[11px] text-dimmed">
      上次采集 {{ fmtRelative(activeSince) }} · 共 {{ items.length }} 条
    </div>
  </div>
</template>
