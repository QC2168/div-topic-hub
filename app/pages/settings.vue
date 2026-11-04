<script setup lang="ts">
import type { HubSettings, RssFeedConfig } from '#shared/types'

useSeoMeta({ title: '源与 AI 设置 · 选题雷达' })

interface SettingsView extends Omit<HubSettings, 'deepseekApiKey'> {
  hasApiKey: boolean
  apiKeyMasked: string
  builtinRssFeeds?: RssFeedConfig[]
}

const toast = useToast()

const { data, refresh } = await useFetch<SettingsView>('/api/settings', {
  key: 'hub-settings'
})

const apiKeyInput = ref('')
const baseUrl = ref(data.value?.deepseekBaseUrl ?? 'https://api.deepseek.com')
const model = ref(data.value?.deepseekModel ?? 'deepseek-chat')
const rssFeeds = ref<RssFeedConfig[]>(
  structuredClone(data.value?.rssFeeds ?? [])
)
const upUidsText = ref((data.value?.upUids ?? []).join(', '))
const autoRefreshMinutes = ref(data.value?.autoRefreshMinutes ?? 30)
const builtinFeeds = ref<RssFeedConfig[]>(data.value?.builtinRssFeeds ?? [])

const saving = ref(false)
const testing = ref(false)
const testResult = ref<string | null>(null)

const MODEL_OPTIONS = [
  { label: 'deepseek-chat（快，日常拆解够用）', value: 'deepseek-chat' },
  {
    label: 'deepseek-reasoner（慢，想更深推理时用）',
    value: 'deepseek-reasoner'
  }
]

watch(data, (value) => {
  if (value === null || value === undefined) return
  baseUrl.value = value.deepseekBaseUrl
  model.value = value.deepseekModel
  rssFeeds.value = structuredClone(value.rssFeeds)
  upUidsText.value = value.upUids.join(', ')
  autoRefreshMinutes.value = value.autoRefreshMinutes
  builtinFeeds.value = value.builtinRssFeeds ?? []
})

function parseUids(text: string): number[] {
  return text
    .split(/[,\s，、]+/)
    .map(part => Number(part.replace(/\D/g, '')))
    .filter(uid => Number.isFinite(uid) && uid > 0)
}

async function save() {
  saving.value = true
  testResult.value = null
  try {
    const payload: Record<string, unknown> = {
      deepseekBaseUrl: baseUrl.value,
      deepseekModel: model.value,
      rssFeeds: rssFeeds.value.filter(feed => feed.url.trim() !== ''),
      upUids: parseUids(upUidsText.value),
      autoRefreshMinutes: autoRefreshMinutes.value
    }
    if (apiKeyInput.value.trim() !== '') {
      payload.deepseekApiKey = apiKeyInput.value.trim()
    }
    await $fetch('/api/settings', { method: 'PUT', body: payload })
    apiKeyInput.value = ''
    await refresh()
    toast.add({
      title: '设置已保存',
      icon: 'i-lucide-check',
      color: 'success'
    })
  } catch (error) {
    toast.add({
      title: '保存失败',
      description: String(error),
      icon: 'i-lucide-x',
      color: 'error'
    })
  } finally {
    saving.value = false
  }
}

async function clearKey() {
  try {
    await $fetch('/api/settings', {
      method: 'PUT',
      body: { clearApiKey: true }
    })
    await refresh()
    toast.add({
      title: '已清除 API Key',
      icon: 'i-lucide-trash-2',
      color: 'success'
    })
  } catch (error) {
    toast.add({
      title: '操作失败',
      description: String(error),
      icon: 'i-lucide-x',
      color: 'error'
    })
  }
}

async function testConnection() {
  testing.value = true
  testResult.value = null
  try {
    const result = await $fetch<{
      ok: boolean
      latencyMs: number
      model: string
      availableModels: string[]
    }>('/api/settings/test', { method: 'POST' })
    testResult.value = `连接成功 · ${result.latencyMs}ms · 模型 ${result.model}`
    toast.add({
      title: 'DeepSeek 连接正常',
      icon: 'i-lucide-check',
      color: 'success'
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    testResult.value = `连接失败：${message}`
    toast.add({
      title: '连接失败',
      description: message,
      icon: 'i-lucide-x',
      color: 'error'
    })
  } finally {
    testing.value = false
  }
}
</script>

<template>
  <UDashboardPanel id="settings" :ui="{ body: 'lg:py-10' }">
    <UDashboardNavbar title="源与 AI 设置">
      <template #leading>
        <UDashboardSidebarCollapse />
      </template>
      <template #trailing>
        <UButton
          label="保存全部"
          icon="i-lucide-save"
          size="xs"
          :loading="saving"
          @click="save"
        />
      </template>
    </UDashboardNavbar>

    <div class="min-h-0 flex-1 overflow-y-auto px-4 pt-4 pb-10 lg:px-6 lg:pt-6">
      <div class="mx-auto flex w-full max-w-3xl flex-col gap-4 lg:gap-6">
        <!-- DeepSeek -->
        <UPageCard
          title="DeepSeek 拆解"
          description="Key 只存在本机 SQLite（.data/topic-hub.sqlite），不会上传到任何第三方。"
          variant="subtle"
        >
          <div class="space-y-4">
            <UFormField
              label="API Key"
              :description="
                data?.hasApiKey
                  ? `当前已配置：${data.apiKeyMasked}`
                  : '还没有配置，AI 拆解按钮会提示去配置'
              "
            >
              <div class="flex w-full flex-wrap items-center gap-2">
                <UInput
                  v-model="apiKeyInput"
                  type="password"
                  placeholder="sk-..."
                  autocomplete="off"
                  class="min-w-0 flex-1"
                />
                <UButton
                  v-if="data?.hasApiKey"
                  label="清除"
                  color="error"
                  variant="ghost"
                  size="sm"
                  @click="clearKey"
                />
              </div>
            </UFormField>

            <div class="grid gap-4 sm:grid-cols-2">
              <UFormField label="Base URL">
                <UInput
                  v-model="baseUrl"
                  placeholder="https://api.deepseek.com"
                  class="w-full"
                />
              </UFormField>
              <UFormField label="模型">
                <USelect
                  v-model="model"
                  :items="MODEL_OPTIONS"
                  class="w-full"
                />
              </UFormField>
            </div>

            <div class="flex flex-wrap items-center gap-2">
              <UButton
                label="测试连接"
                icon="i-lucide-plug"
                size="sm"
                color="neutral"
                variant="outline"
                :loading="testing"
                @click="testConnection"
              />
              <span
                v-if="testResult"
                class="text-xs"
                :class="
                  testResult.startsWith('连接成功')
                    ? 'text-success'
                    : 'text-error'
                "
              >
                {{ testResult }}
              </span>
            </div>
          </div>
        </UPageCard>

        <!-- 数据源 -->
        <UPageCard
          title="AI 资讯源"
          description="GitHub 趋势、Hacker News、arXiv 为内置通道；下面是可叠加的自定义 RSS。某个源改版导致解析为空时，会在列表顶部提示「源降级」。"
          variant="subtle"
        >
          <div class="space-y-4">
            <div v-if="builtinFeeds.length > 0" class="space-y-2">
              <p class="text-xs font-medium text-toned">
                内置 RSS（始终启用，共 {{ builtinFeeds.length }} 个）
              </p>
              <div class="flex flex-wrap gap-1.5">
                <UBadge
                  v-for="feed in builtinFeeds"
                  :key="feed.url"
                  :label="feed.name"
                  color="neutral"
                  variant="subtle"
                  size="sm"
                />
              </div>
              <p class="text-[11px] text-dimmed">
                内置源随版本升级，不需要手动维护；想加自己的源写在下面。
              </p>
            </div>
            <RssFeedEditor v-model="rssFeeds" />
          </div>
        </UPageCard>

        <!-- B站与节奏 -->
        <UPageCard
          title="B 站与采集节奏"
          description="除了科技区 / 知识区榜单，还可以钉住具体 UP 主，把 TA 的近期投稿一起抓进来。"
          variant="subtle"
        >
          <div class="space-y-4">
            <UFormField
              label="监控的 UP 主 UID"
              description="填 UID 数字，多个用逗号分隔（在 UP 主主页地址栏 space.bilibili.com/ 后面那串数字）"
            >
              <UInput
                v-model="upUidsText"
                placeholder="如 12345678, 87654321"
                class="w-full"
              />
            </UFormField>

            <UFormField
              label="自动采集间隔（分钟）"
              description="打开页面时若缓存超过这个时长会自动刷新，5~720 之间"
            >
              <UInput
                v-model.number="autoRefreshMinutes"
                type="number"
                min="5"
                max="720"
                class="w-40"
              />
            </UFormField>
          </div>
        </UPageCard>

        <p class="px-1 text-xs text-dimmed">
          数据文件：<code class="rounded bg-elevated px-1 py-0.5">.data/topic-hub.sqlite</code>
          （删掉即可重置；采集缓存保留 7 天，选题池永久保留）
        </p>
      </div>
    </div>
  </UDashboardPanel>
</template>
