<script setup lang="ts">
import type { RssFeedConfig } from '#shared/types'
import { BUILTIN_RSS_FEEDS } from '#shared/types'

useSeoMeta({ title: '源与 AI 设置 · 选题雷达' })

// 设置全部落在本机浏览器：DeepSeek 由前端直连、数据由每日快照提供，
// 所以这一页不需要任何服务端接口
const toast = useToast()
const local = useLocalSettings()
const ai = useAiAnalyze()
const hub = useHubData()

const apiKeyInput = ref('')
const baseUrl = ref(local.settings.value.deepseekBaseUrl)
const model = ref(local.settings.value.deepseekModel)
const saving = ref(false)
const testing = ref(false)
const testResult = ref<string | null>(null)

interface CatalogView {
  generatedAt: string
  datasets: Array<{
    id: string
    name: string
    count: number
    fetchedAt: string | null
    ageMinutes: number | null
    stale: boolean
  }>
}

const catalog = ref<CatalogView | null>(null)
const catalogError = ref<string | null>(null)
/** 数据端地址：模板里别直接读 composable 返回的普通字段，包成 ref 类型才稳 */
const dataBase = ref('')

/** 包成 ref 而不是模板里直接用导入常量：模板对 import 绑定会按「可能是 ref」加 .value */
const builtinFeeds = ref<RssFeedConfig[]>(BUILTIN_RSS_FEEDS)

const MODEL_OPTIONS = [
  { label: 'deepseek-chat（快，日常拆解够用）', value: 'deepseek-chat' },
  {
    label: 'deepseek-reasoner（慢，想更深推理时用）',
    value: 'deepseek-reasoner'
  }
]

const hasApiKey = computed(() => local.settings.value.deepseekApiKey !== '')
const maskedKey = computed(() => local.masked())

onMounted(async () => {
  local.load()
  dataBase.value = hub.base
  baseUrl.value = local.settings.value.deepseekBaseUrl
  model.value = local.settings.value.deepseekModel
  try {
    catalog.value = await hub.catalog()
  } catch (error) {
    catalogError.value = error instanceof Error ? error.message : String(error)
  }
})

/** 把表单上的值写进 localStorage。测试连接也先落盘，避免「测的是旧的 key」 */
function applyForm(): void {
  const next: Parameters<typeof local.save>[0] = {
    deepseekBaseUrl: baseUrl.value.trim() === '' ? 'https://api.deepseek.com' : baseUrl.value.trim(),
    deepseekModel: model.value
  }
  if (apiKeyInput.value.trim() !== '') next.deepseekApiKey = apiKeyInput.value.trim()
  local.save(next)
  apiKeyInput.value = ''
}

function save() {
  saving.value = true
  testResult.value = null
  try {
    applyForm()
    toast.add({
      title: '设置已保存到本机',
      description: '只存这个浏览器，换设备要重填',
      icon: 'i-lucide-check',
      color: 'success'
    })
  } catch (error) {
    toast.add({
      title: '保存失败',
      description: error instanceof Error ? error.message : String(error),
      icon: 'i-lucide-x',
      color: 'error'
    })
  } finally {
    saving.value = false
  }
}

function clearKey() {
  local.clearApiKey()
  apiKeyInput.value = ''
  testResult.value = null
  toast.add({
    title: '已清除本机 API Key',
    icon: 'i-lucide-trash-2',
    color: 'success'
  })
}

async function testConnection() {
  testing.value = true
  testResult.value = null
  try {
    applyForm()
    const result = await ai.testConnection()
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
          description="Key 只存在这台机器的浏览器里（localStorage），不上传任何服务器，请求由浏览器直连 api.deepseek.com。"
          variant="subtle"
        >
          <div class="space-y-4">
            <UFormField
              label="API Key"
              :description="
                hasApiKey
                  ? `当前已配置：${maskedKey}`
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
                  v-if="hasApiKey"
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

        <!-- 数据来源 -->
        <UPageCard
          title="数据来源"
          description="页面上的热点不是实时抓的，而是读每天自动重建一次的静态快照。"
          variant="subtle"
        >
          <div class="space-y-4">
            <div class="rounded-lg border border-default bg-elevated/30 px-3 py-2.5 text-xs text-toned">
              <p>
                数据端：<code class="rounded bg-elevated px-1 py-0.5">{{ dataBase || '同源（相对路径）' }}</code>
              </p>
              <p
                v-if="catalog"
                class="mt-1 text-dimmed"
              >
                最近一次重建：{{ fmtAge(catalog.generatedAt) }}
              </p>
              <p
                v-else-if="catalogError"
                class="mt-1 text-error"
              >
                {{ catalogError }}
              </p>
            </div>

            <div v-if="catalog" class="space-y-1.5">
              <div
                v-for="dataset in catalog.datasets"
                :key="dataset.id"
                class="flex items-center justify-between gap-2 rounded border border-default px-2.5 py-1.5 text-xs"
              >
                <span class="text-toned">{{ dataset.name }}</span>
                <span class="flex items-center gap-2">
                  <span class="text-dimmed">{{ dataset.count }} 条</span>
                  <UBadge
                    :label="dataset.stale ? '偏旧' : '新鲜'"
                    :color="dataset.stale ? 'warning' : 'success'"
                    variant="subtle"
                    size="sm"
                  />
                </span>
              </div>
            </div>

            <div class="space-y-2">
              <p class="text-xs font-medium text-toned">
                内置 RSS（随仓库版本走，共 {{ builtinFeeds.length }} 个）
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
            </div>

            <p class="text-[11px] leading-relaxed text-dimmed">
              数据由仓库里的 GitHub Actions 每天定时采集并生成 JSON，采集源写在
              <code class="rounded bg-elevated px-1 py-0.5">shared/types.ts</code>
              的 <code class="rounded bg-elevated px-1 py-0.5">BUILTIN_RSS_FEEDS</code> 和
              <code class="rounded bg-elevated px-1 py-0.5">scripts/collect-snapshot.ts</code>
              里。改源要改仓库，这一页不提供在线编辑。
            </p>
          </div>
        </UPageCard>

        <!-- 本机存储 -->
        <UPageCard
          title="本机存储"
          description="选题池和这一页的设置都存在浏览器本地，不经过任何服务器。"
          variant="subtle"
        >
          <div class="space-y-2 text-xs leading-relaxed text-toned">
            <p>
              好处是网站可以纯静态跑；代价是换电脑、换浏览器、清缓存就没了，也没法多端同步。
            </p>
            <p>
              要长期留稿，用选题池详情里的「复制 Markdown」或「发送到宿主」导出去。
            </p>
            <p class="text-dimmed">
              存储键：<code class="rounded bg-elevated px-1 py-0.5">div-topic-hub:topics</code>
              （选题池）、<code class="rounded bg-elevated px-1 py-0.5">div-topic-hub:settings</code>
              （本页设置）
            </p>
          </div>
        </UPageCard>
      </div>
    </div>
  </UDashboardPanel>
</template>
