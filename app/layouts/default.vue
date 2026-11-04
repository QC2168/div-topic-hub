<script setup lang="ts">
/**
 * 跨端自适应外壳：宽屏为侧边栏 + 双栏工作台，窄屏 / 插件嵌入时侧边栏自动收起，
 * 100% 宽度让给信息流（详情靠 USlideover 抽屉）。
 */
import type { NavigationMenuItem } from '@nuxt/ui'
import type { SavedTopic } from '#shared/types'

const route = useRoute()
const { embedded, hostLabel, detect } = useHostBridge()

const sidebarOpen = ref(true)

const { data: topics } = await useFetch<SavedTopic[]>('/api/topics', { key: 'sidebar-topics', default: () => [] })

const links = computed<NavigationMenuItem[][]>(() => [[{
  label: '圈内黑马',
  icon: 'i-lucide-flame',
  to: '/',
  onSelect: () => {
    sidebarOpen.value = false
  }
}, {
  label: '全网热搜',
  icon: 'i-lucide-flame',
  to: '/hot',
  onSelect: () => {
    sidebarOpen.value = false
  }
}, {
  label: 'AI 新资讯',
  icon: 'i-lucide-bot',
  to: '/ai-news',
  onSelect: () => {
    sidebarOpen.value = false
  }
}, {
  label: '白嫖榜单',
  icon: 'i-lucide-gift',
  to: '/free',
  onSelect: () => {
    sidebarOpen.value = false
  }
}, {
  label: '我的选题池',
  icon: 'i-lucide-pin',
  to: '/pool',
  badge: topics.value.length > 0 ? String(topics.value.length) : undefined,
  onSelect: () => {
    sidebarOpen.value = false
  }
}], [{
  label: '源与 AI 设置',
  icon: 'i-lucide-settings',
  to: '/settings',
  onSelect: () => {
    sidebarOpen.value = false
  }
}]])

onMounted(() => {
  detect()
  // 插件嵌入 / 窄屏：默认收起侧边栏，把宽度全给信息流
  if (embedded.value || window.innerWidth < 640) {
    sidebarOpen.value = false
  }
})

watch(() => route.fullPath, () => {
  if (window.innerWidth < 640) sidebarOpen.value = false
})
</script>

<template>
  <UDashboardGroup unit="rem">
    <UDashboardSidebar
      id="topic-hub"
      v-model:open="sidebarOpen"
      collapsible
      resizable
      class="bg-elevated/25"
      :ui="{ footer: 'lg:border-t lg:border-default' }"
    >
      <template #header="{ collapsed }">
        <NuxtLink to="/" class="flex items-center gap-2.5 overflow-hidden px-1 py-1">
          <span class="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <UIcon name="i-lucide-radar" class="size-5" />
          </span>
          <span v-if="!collapsed" class="flex flex-col leading-tight">
            <span class="text-sm font-semibold text-highlighted">选题雷达</span>
            <span class="text-xs text-dimmed">B站黑马 · AI 资讯</span>
          </span>
        </NuxtLink>
      </template>

      <template #default="{ collapsed }">
        <UNavigationMenu
          :collapsed="collapsed"
          :items="links[0]"
          orientation="vertical"
          tooltip
        />

        <UNavigationMenu
          :collapsed="collapsed"
          :items="links[1]"
          orientation="vertical"
          tooltip
          class="mt-auto"
        />
      </template>

      <template #footer="{ collapsed }">
        <div class="flex items-center gap-2 px-1 py-0.5 text-xs text-dimmed" :class="collapsed && 'justify-center'">
          <UIcon
            name="i-lucide-plug-zap"
            class="size-4 shrink-0"
            :class="embedded ? 'text-success' : 'text-dimmed'"
          />
          <span v-if="!collapsed" class="truncate">{{ hostLabel }}</span>
        </div>
      </template>
    </UDashboardSidebar>

    <slot />
  </UDashboardGroup>
</template>
