<script setup lang="ts">
import { breakpointsTailwind } from '@vueuse/core'
import { CATEGORY_LABELS } from '#shared/types'
import type { FeedCategory, FeedItem } from '#shared/types'

const props = defineProps<{
  title: string
  subtitle?: string
  /** 本页允许出现的分类（第一个不作为默认，默认是「全部」） */
  categories: FeedCategory[]
}>()

const radar = useRadar()
const { embedded } = useHostBridge()
const route = useRoute()

const breakpoints = useBreakpoints(breakpointsTailwind)
const isCompact = computed(
  () => breakpoints.smaller('lg').value || embedded.value
)

const activeCategory = ref<FeedCategory | 'all'>('all')
const selected = ref<FeedItem | null>(null)

const scopedItems = computed(() =>
  radar.items.value.filter(item => props.categories.includes(item.category))
)

const filteredItems = computed(() => {
  const list
    = activeCategory.value === 'all'
      ? scopedItems.value
      : scopedItems.value.filter(
          item => item.category === activeCategory.value
        )
  return [...list].sort((a, b) => b.score - a.score)
})

const pills = computed(() => {
  const options: Array<{ value: FeedCategory | 'all', label: string }> = [
    { value: 'all', label: '全部' },
    ...props.categories.map(category => ({
      value: category,
      label: CATEGORY_LABELS[category]
    }))
  ]
  return options.map(option => ({
    ...option,
    count:
      option.value === 'all'
        ? scopedItems.value.length
        : scopedItems.value.filter(item => item.category === option.value)
          .length
  }))
})

const panelOpen = computed({
  get: () => selected.value !== null,
  set: (value: boolean) => {
    if (!value) selected.value = null
  }
})

function onSelect(item: FeedItem) {
  selected.value = item
  radar.selectedId.value = item.id
}

function onRefresh() {
  void radar.refresh()
}

onMounted(async () => {
  if (radar.items.value.length === 0) {
    await radar.load()
  }

  // 深链：/?item=bili:BVxxx 直接打开这条热点的拆解台（方便从笔记里回跳）
  const deepLink = route.query.item
  if (typeof deepLink === 'string' && deepLink !== '' && selected.value === null) {
    const matched = radar.items.value.find(item => item.id === deepLink)
    if (matched !== undefined) onSelect(matched)
  }

  // 缓存为空或超过 30 分钟，自动补一次采集（避免用户面对空列表）
  const fetchedAt = radar.fetchedAt.value === null ? 0 : Date.parse(radar.fetchedAt.value)
  const stale = Date.now() - fetchedAt > 30 * 60_000
  if (stale && !radar.refreshing.value) {
    void radar.refresh()
  }
})

watch(filteredItems, (list) => {
  if (
    selected.value !== null
    && !list.some(item => item.id === selected.value?.id)
  ) {
    selected.value = null
  }
})
</script>

<template>
  <UDashboardPanel
    id="radar"
    :default-size="34"
    :min-size="26"
    :max-size="50"
    resizable
  >
    <UDashboardNavbar :title="title">
      <template #leading>
        <UDashboardSidebarCollapse />
      </template>
      <template #trailing>
        <UBadge
          :label="String(filteredItems.length)"
          variant="subtle"
          size="sm"
        />
        <UTooltip
          v-if="radar.warnings.value.length > 0"
          :text="radar.warnings.value.join('\n')"
        >
          <UBadge
            :label="`${radar.warnings.value.length} 源降级`"
            color="warning"
            variant="subtle"
            size="sm"
          />
        </UTooltip>
      </template>
    </UDashboardNavbar>

    <div class="flex min-h-0 flex-1 flex-col">
      <p
        v-if="subtitle"
        class="border-b border-default px-4 py-2 text-xs text-dimmed"
      >
        {{ subtitle }}
      </p>
      <FeedList
        v-model:active-category="activeCategory"
        :items="filteredItems"
        :loading="radar.loading.value"
        :refreshing="radar.refreshing.value"
        :selected-id="selected?.id ?? null"
        :categories="pills"
        :active-since="radar.fetchedAt.value"
        @select="onSelect"
        @refresh="onRefresh"
      />
    </div>
  </UDashboardPanel>

  <!-- 宽屏：右侧常驻工作台 -->
  <TopicWorkspace
    v-if="selected && !isCompact"
    :key="selected.id"
    :item="selected"
    class="flex-1 border-l border-default"
    @close="selected = null"
  />
  <div
    v-else-if="!isCompact"
    class="hidden flex-1 items-center justify-center bg-elevated/20 lg:flex"
  >
    <div class="max-w-72 text-center">
      <UIcon
        name="i-lucide-mouse-pointer-click"
        class="mx-auto mb-3 size-12 text-dimmed"
      />
      <p class="text-sm font-medium text-highlighted">
        选一条热点开始拆解
      </p>
      <p class="mt-1 text-xs text-dimmed">
        左边点任意卡片，这里会出现详情、高赞评论和 DeepSeek 借势方案
      </p>
    </div>
  </div>

  <!-- 窄屏 / 插件嵌入：详情走抽屉 -->
  <ClientOnly>
    <USlideover
      v-if="isCompact"
      v-model:open="panelOpen"
      :ui="{ content: 'max-w-full sm:max-w-xl' }"
    >
      <template #content>
        <TopicWorkspace
          v-if="selected"
          :key="selected.id"
          :item="selected"
          @close="selected = null"
        />
      </template>
    </USlideover>
  </ClientOnly>
</template>
