<script setup lang="ts">
/**
 * 白嫖榜单：谁家能免费用 AI，国内优先，卡片式。
 *
 * ── 两个筛选维度 ──
 * 「白嫖方式」= 怎么拿到（每天领 / 长期免费 / 一次性 / 试用金）；
 * 「内容类型」= 能用来干什么（文本 / 图片 / 视频 / 语音 / 办公）。
 * 两个维度独立筛，因为「每天领 130 积分」和「每天 66 灵感值」完全是两种用途。
 *
 * ── 新鲜度必须诚实 ──
 * 「海外实时免费模型」来自 OpenRouter 公开接口（无需鉴权），判定标准只有一条：
 * pricing 全为 0，是真·实时，接口挂了会明说。
 *
 * 其余平台政策（国内应用 / 国内 API / 海外平台）没有任何公开接口可拉——
 * 额度都绑在账号体系里，所以是人工核实的静态数据，每条带核实日期与来源链接。
 * 规则变得勤（即梦一个月调三次、魔搭一年改过计量方式），过期了要人工更新。
 * 不把静态数据伪装成实时，是这个页面最重要的底线。
 */
import type { FreeTierEntry, MediaType } from '#shared/free-tier'
import { MEDIA_LABELS } from '#shared/free-tier'

useSeoMeta({ title: '白嫖榜单 · 选题雷达' })

const toast = useToast()

const data = ref<FreeTierSnapshot | null>(null)
const loading = ref(false)
const refreshing = ref(false)

/** 维度一：怎么拿到 */
const activeKind = ref<'all' | FreeTierEntry['kind']>('all')
/** 维度二：能用来干什么 */
const activeMedia = ref<'all' | MediaType>('all')

const KIND_TABS = [
  { key: 'all' as const, label: '全部' },
  { key: 'daily' as const, label: '每天领' },
  { key: 'permanent' as const, label: '长期免费' },
  { key: 'quota' as const, label: '一次性' }
]

const MEDIA_TABS = [
  { key: 'all' as const, label: '全部', icon: 'i-lucide-layout-grid' },
  { key: 'text' as const, label: MEDIA_LABELS.text, icon: 'i-lucide-message-square' },
  { key: 'image' as const, label: MEDIA_LABELS.image, icon: 'i-lucide-image' },
  { key: 'video' as const, label: MEDIA_LABELS.video, icon: 'i-lucide-clapperboard' },
  { key: 'audio' as const, label: MEDIA_LABELS.audio, icon: 'i-lucide-audio-lines' },
  { key: 'office' as const, label: MEDIA_LABELS.office, icon: 'i-lucide-briefcase' }
]

function filterEntries(list: FreeTierEntry[]): FreeTierEntry[] {
  return list.filter(entry =>
    (activeKind.value === 'all' || entry.kind === activeKind.value)
    && (activeMedia.value === 'all' || entry.media.includes(activeMedia.value))
  )
}

const domesticApp = computed(() => filterEntries(data.value?.domestic.app ?? []))
const domesticApi = computed(() => filterEntries(data.value?.domestic.api ?? []))
const overseasEntries = computed(() => filterEntries(data.value?.overseasPlatforms.entries ?? []))

/** 全量口径（不受筛选影响），用于顶部统计 */
const allDomestic = computed(() => [...(data.value?.domestic.app ?? []), ...(data.value?.domestic.api ?? [])])
const dailyCount = computed(() => allDomestic.value.filter(e => e.kind === 'daily').length)
const videoCount = computed(() => allDomestic.value.filter(e => e.media.includes('video')).length)
const textCount = computed(() => allDomestic.value.filter(e => e.media.includes('text')).length)

const overseasModels = computed(() => data.value?.overseas.models ?? [])
const filteredTotal = computed(() => domesticApp.value.length + domesticApi.value.length + overseasEntries.value.length)

const hub = useHubData()

async function load(force = false) {
  const target = force ? refreshing : loading
  target.value = true
  try {
    // 白嫖榜单的静态快照与旧的服务端接口**字段完全同形**，所以这里只需要换取数方式
    data.value = await hub.freeTier({ force })
    if (data.value.warnings.length > 0) {
      toast.add({
        title: '实时榜暂时拿不到',
        description: data.value.warnings.join('；'),
        icon: 'i-lucide-triangle-alert',
        color: 'warning'
      })
    }
  } catch (error) {
    toast.add({
      title: '白嫖榜单加载失败',
      description: error instanceof Error ? error.message : String(error),
      icon: 'i-lucide-x',
      color: 'error'
    })
  } finally {
    target.value = false
  }
}

function fmtCtx(n: number | null): string {
  if (n === null) return '—'
  return n >= 1024 ? `${Math.round(n / 1024)}K` : String(n)
}

/** OpenRouter 模型页的正确地址就是 /{模型 id}，带 /model/ 会 404（实测） */
function modelUrl(id: string): string {
  return `https://openrouter.ai/${id}`
}

onMounted(() => {
  void load()
})
</script>

<template>
  <UDashboardPanel id="free-tier">
    <UDashboardNavbar title="白嫖榜单">
      <template #leading>
        <UDashboardSidebarCollapse />
      </template>
      <template #trailing>
        <UBadge
          :label="`国内 ${dailyCount} 家每天领 · 文本 ${textCount} · 视频 ${videoCount}`"
          variant="subtle"
          size="sm"
        />
        <UButton
          icon="i-lucide-refresh-cw"
          color="neutral"
          variant="ghost"
          size="xs"
          :loading="refreshing"
          @click="load(true)"
        />
      </template>
    </UDashboardNavbar>

    <div class="min-h-0 flex-1 overflow-y-auto">
      <!-- 两个维度的筛选 -->
      <div class="sticky top-0 z-10 border-b border-default bg-default/95 backdrop-blur">
        <div class="flex flex-wrap items-center gap-1.5 px-4 pb-1 pt-2">
          <span class="w-14 shrink-0 text-[11px] text-dimmed">怎么白嫖</span>
          <UButton
            v-for="tab in KIND_TABS"
            :key="tab.key"
            :label="tab.label"
            :color="activeKind === tab.key ? 'primary' : 'neutral'"
            :variant="activeKind === tab.key ? 'solid' : 'ghost'"
            size="xs"
            @click="activeKind = tab.key"
          />
        </div>
        <div class="flex flex-wrap items-center gap-1.5 px-4 pb-2">
          <span class="w-14 shrink-0 text-[11px] text-dimmed">干什么用</span>
          <UButton
            v-for="tab in MEDIA_TABS"
            :key="tab.key"
            :label="tab.label"
            :icon="tab.icon"
            :color="activeMedia === tab.key ? 'primary' : 'neutral'"
            :variant="activeMedia === tab.key ? 'soft' : 'ghost'"
            size="xs"
            @click="activeMedia = tab.key"
          />
          <span class="ml-auto text-[11px] text-dimmed">
            命中 {{ filteredTotal }} 个 · 核实于 {{ data?.domestic.verifiedAt ?? '—' }}
          </span>
        </div>
      </div>

      <div v-if="loading && data === null" class="px-4 py-8 text-xs text-dimmed">
        正在加载…
      </div>

      <template v-else>
        <!-- 国内 · 应用 -->
        <section class="border-b border-default">
          <header class="flex flex-wrap items-baseline gap-2 px-4 pb-1 pt-3">
            <span class="text-sm font-medium text-highlighted">国内 · 应用</span>
            <span class="text-[11px] text-dimmed">打开网页/App 就能用 — {{ domesticApp.length }} 个</span>
          </header>
          <p class="px-4 pb-2 text-[11px] text-dimmed">
            「每天领」= 签到/登录/活跃就送，当天或次日到账；这类最值得占，但基本都带水印或非商用限制
          </p>

          <div v-if="domesticApp.length === 0" class="px-4 pb-5 text-xs text-dimmed">
            这个组合下没有应用，换个筛选试试
          </div>
          <div v-else class="grid gap-3 px-4 pb-4 sm:grid-cols-2 xl:grid-cols-3">
            <FreeTierCard
              v-for="entry in domesticApp"
              :key="entry.platform"
              :entry="entry"
              action-label="去用"
            />
          </div>
        </section>

        <!-- 国内 · 开发者 API -->
        <section class="border-b border-default">
          <header class="flex flex-wrap items-baseline gap-2 px-4 pb-1 pt-3">
            <span class="text-sm font-medium text-highlighted">国内 · 开发者 API</span>
            <span class="text-[11px] text-dimmed">要写代码调接口看这段 — {{ domesticApi.length }} 家</span>
          </header>
          <p class="px-4 pb-2 text-[11px] text-dimmed">
            「每天领」按天重置、最适合长期跑脚本；「一次性」送完即止，别拿它当生产依赖
          </p>

          <div v-if="domesticApi.length === 0" class="px-4 pb-5 text-xs text-dimmed">
            这个组合下没有 API，换个筛选试试
          </div>
          <div v-else class="grid gap-3 px-4 pb-4 sm:grid-cols-2 xl:grid-cols-3">
            <FreeTierCard
              v-for="entry in domesticApi"
              :key="entry.platform"
              :entry="entry"
              action-label="去申请"
            />
          </div>
        </section>

        <!-- 海外 · 实时免费模型 -->
        <section class="border-b border-default">
          <header class="flex flex-wrap items-center justify-between gap-2 border-b border-default px-4 py-2">
            <div class="flex items-baseline gap-2">
              <span class="text-sm font-medium text-highlighted">海外 · 实时免费模型</span>
              <span class="text-[11px] text-dimmed">OpenRouter 接口，pricing 全为 0 才上榜</span>
            </div>
            <span class="text-[11px] text-dimmed">
              {{ data?.overseas.fetchedAt ? new Date(data.overseas.fetchedAt).toLocaleString('zh-CN') : '未抓取' }}
            </span>
          </header>

          <p class="px-4 pb-1 pt-2 text-[11px] text-dimmed">
            全页唯一真·实时的部分。{{ data?.overseas.rateLimitNote }}；高峰期会挤，验证够用、生产不行
          </p>

          <div v-if="overseasModels.length === 0" class="px-4 py-5 text-xs text-dimmed">
            实时榜暂时拿不到（接口失败或当前没有零价模型），下面的平台清单不受影响
          </div>

          <ul v-else class="divide-y divide-default/60">
            <li
              v-for="model in overseasModels"
              :key="model.id"
              class="group flex items-center gap-2 px-4 py-2 hover:bg-elevated/40"
            >
              <span class="shrink-0 rounded bg-primary/10 px-1.5 py-px text-[10px] font-medium text-primary">
                {{ model.provider }}
              </span>
              <div class="min-w-0 flex-1">
                <p class="truncate text-sm text-toned" :title="model.id">
                  {{ model.name }}
                </p>
                <p class="truncate font-mono text-[10px] text-dimmed" :title="model.id">
                  {{ model.id }}
                </p>
              </div>
              <span class="shrink-0 text-[11px] tabular-nums text-dimmed">上下文 {{ fmtCtx(model.contextLength) }}</span>
              <UButton
                icon="i-lucide-external-link"
                color="neutral"
                variant="ghost"
                size="xs"
                class="opacity-0 transition group-hover:opacity-100"
                :to="modelUrl(model.id)"
                target="_blank"
              />
            </li>
          </ul>
        </section>

        <!-- 海外 · 平台政策 -->
        <section>
          <header class="flex flex-wrap items-baseline gap-2 px-4 pb-1 pt-3">
            <span class="text-sm font-medium text-highlighted">海外 · 平台政策</span>
            <span class="text-[11px] text-dimmed">静态核实，多数无需信用卡 — {{ overseasEntries.length }} 家</span>
          </header>

          <div v-if="overseasEntries.length === 0" class="px-4 pb-5 text-xs text-dimmed">
            这个组合下没有平台，换个筛选试试
          </div>
          <div v-else class="grid gap-3 px-4 pb-4 sm:grid-cols-2 xl:grid-cols-3">
            <FreeTierCard
              v-for="entry in overseasEntries"
              :key="entry.platform"
              :entry="entry"
              action-label="去申请"
            />
          </div>
        </section>

        <p class="border-t border-default px-4 py-2 text-[11px] text-dimmed">
          白嫖的正确姿势：每天先领 WorkBuddy 加油站 100 分，再占可灵/即梦/通义万相的每日额度；写代码用智谱 + 硅基流动的大额赠送，脚本用火山 200 万/天。
          免费额度都可能限流、改规则、下架——没有一条可以当生产依赖
        </p>
      </template>
    </div>
  </UDashboardPanel>
</template>
