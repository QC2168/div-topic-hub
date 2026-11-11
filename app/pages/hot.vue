<script setup lang="ts">
/**
 * 全网热点：国内榜单 + 海外 AI 榜，分开两段。
 *
 * ── 为什么必须分开 ──
 * 海外有 HuggingFace 这种「AI 原生平台自己出的公开榜单」——规范、实时、免费，
 * 拿到的就是「AI 领域在火什么」。
 * 国内没有任何一家 AI 平台（豆包/文心/通义/Kimi）公布使用量榜，
 * 能白嫖的只有综合热榜（百度/微博/抖音），必须靠**关键词过滤**才能得到「AI 热点」。
 *
 * 所以两段的性质不同：海外是「原生 AI 榜」，国内是「综合热榜 + AI 筛选」。
 * 硬把它们混成一栏会让人误以为国内也有对等的 AI 榜单，那是假的。
 */
import type { FeedItem } from '#shared/types'
import { PLATFORM_LABELS } from '#shared/types'
import { fmtCount } from '~/utils/format'

useSeoMeta({ title: '全网热点 · 选题雷达' })

interface HotResponse {
  baidu: FeedItem[]
  douyin: FeedItem[]
  weibo: FeedItem[]
  fetchedAt: string | null
  warnings: string[]
}

const toast = useToast()

const data = ref<HotResponse>({ baidu: [], douyin: [], weibo: [], fetchedAt: null, warnings: [] })
const loading = ref(false)
const refreshing = ref(false)

const hfItems = ref<FeedItem[]>([])
const hfLoading = ref(false)

/** 国内三个榜分别用 tab 切，避免三条 50 行的长列表堆在一起 */
const activeCn = ref<'baidu' | 'weibo' | 'douyin'>('baidu')
/** 海外三个榜同理 */
const activeHf = ref<'model' | 'space' | 'paper'>('model')

/** 国内热榜是综合榜，勾上只看 AI 相关 */
const aiOnly = ref(false)

const CN_AI_WORDS = [
  'AI', '人工智能', '大模型', '智能体', '机器人', '算法', '芯片', '算力', '显卡',
  'DeepSeek', 'GPT', 'OpenAI', '豆包', '文心', '通义', 'Kimi', '智谱', '月之暗面',
  '英伟达', 'NVIDIA', '自动驾驶', 'AIGC', '数字人', '具身智能', 'AGI', '机器学习', '无人机'
]

function isAiRelated(title: string): boolean {
  const upper = title.toUpperCase()
  return CN_AI_WORDS.some(word => upper.includes(word.toUpperCase()))
}

const cnList = computed(() => {
  const source = data.value[activeCn.value]
  return aiOnly.value ? source.filter(item => isAiRelated(item.title)) : source
})

const hfList = computed(() => {
  const prefix = activeHf.value === 'model'
    ? 'hf-model:'
    : activeHf.value === 'space' ? 'hf-space:' : 'hf-paper:'
  return hfItems.value.filter(item => item.id.startsWith(prefix))
})

const cnStats = computed(() => ({
  baidu: data.value.baidu.length,
  weibo: data.value.weibo.length,
  douyin: data.value.douyin.length,
  aiHits: [...data.value.baidu, ...data.value.weibo, ...data.value.douyin]
    .filter(item => isAiRelated(item.title)).length
}))

/**
 * 「粘一条抖音链接解析」原来走服务端（要绕 CORS、还要解分享页），
 * 现在网站是纯前端的，这条路走不通了，所以整块移除。
 * 服务端接口 /api/douyin/resolve 仍然保留，供本地跑 Nitro 或脚本调用。
 */

const hub = useHubData()

async function loadHot(force = false) {
  const target = force ? refreshing : loading
  target.value = true
  try {
    const snapshot = await hub.hotSearch({ force })
    data.value = {
      baidu: snapshot.baidu,
      douyin: snapshot.douyin,
      weibo: snapshot.weibo,
      fetchedAt: snapshot.fetchedAt,
      warnings: snapshot.warnings
    }
    if (data.value.warnings.length > 0) {
      toast.add({
        title: '部分源降级',
        description: data.value.warnings.join('；'),
        icon: 'i-lucide-triangle-alert',
        color: 'warning'
      })
    }
  } catch (error) {
    toast.add({
      title: '国内热搜加载失败',
      description: error instanceof Error ? error.message : String(error),
      icon: 'i-lucide-x',
      color: 'error'
    })
  } finally {
    target.value = false
  }
}

/** 海外榜与国内热搜在同一次采集里，但落在不同的快照文件（ai-news.json） */
async function loadHf(force = false) {
  hfLoading.value = true
  try {
    const snapshot = await hub.aiNews({ force })
    hfItems.value = snapshot.items.filter(item => item.platform === 'huggingface')
  } catch (error) {
    toast.add({
      title: '海外 AI 榜加载失败',
      description: error instanceof Error ? error.message : String(error),
      icon: 'i-lucide-x',
      color: 'error'
    })
  } finally {
    hfLoading.value = false
  }
}

/** 「刷新」= 绕过缓存重新拉快照，不会触发采集（采集由每天 09:00 的 Actions 负责） */
async function refreshAll() {
  refreshing.value = true
  try {
    await Promise.all([loadHot(true), loadHf(true)])
    const at = data.value.fetchedAt === null ? '未知时间' : new Date(data.value.fetchedAt).toLocaleString('zh-CN')
    toast.add({
      title: '已拉取最新快照',
      description: `采集于 ${at}`,
      icon: 'i-lucide-refresh-cw',
      color: 'success'
    })
  } catch (error) {
    toast.add({
      title: '刷新失败',
      description: error instanceof Error ? error.message : String(error),
      icon: 'i-lucide-x',
      color: 'error'
    })
  } finally {
    refreshing.value = false
  }
}

/** 一键去 B 站看有没有人做过——跨平台验证最省事的形式 */
function biliSearch(word: string) {
  window.open(`https://search.bilibili.com/all?keyword=${encodeURIComponent(word)}`, '_blank', 'noopener')
}

function badgeClass(tone: string): string {
  return tone === 'success'
    ? 'bg-success/10 text-success'
    : tone === 'error'
      ? 'bg-error/10 text-error'
      : tone === 'warning'
        ? 'bg-warning/10 text-warning'
        : 'bg-elevated text-dimmed'
}

function formLabel(platform: string): string {
  return PLATFORM_LABELS[platform as keyof typeof PLATFORM_LABELS] ?? platform
}

onMounted(() => {
  void loadHot()
  void loadHf()
})
</script>

<template>
  <UDashboardPanel id="hot-search">
    <UDashboardNavbar title="全网热点">
      <template #leading>
        <UDashboardSidebarCollapse />
      </template>
      <template #trailing>
        <UBadge
          :label="`国内 ${cnStats.baidu + cnStats.weibo + cnStats.douyin} · 海外 ${hfItems.length}`"
          variant="subtle"
          size="sm"
        />
        <UButton
          icon="i-lucide-refresh-cw"
          color="neutral"
          variant="ghost"
          size="xs"
          :loading="refreshing"
          @click="refreshAll"
        />
      </template>
    </UDashboardNavbar>

    <div class="min-h-0 flex-1 overflow-y-auto">
      <!-- 国内 -->
      <section class="border-b border-default">
        <header class="flex flex-wrap items-center justify-between gap-2 border-b border-default px-4 py-2">
          <div class="flex items-baseline gap-2">
            <span class="text-sm font-medium text-highlighted">国内热搜</span>
            <span class="text-[11px] text-dimmed">综合热榜，非 AI 专属</span>
          </div>
          <UButton
            :label="`只看 AI 相关（${cnStats.aiHits}）`"
            :color="aiOnly ? 'primary' : 'neutral'"
            :variant="aiOnly ? 'solid' : 'ghost'"
            size="xs"
            icon="i-lucide-sparkles"
            @click="aiOnly = !aiOnly"
          />
        </header>

        <div class="flex gap-1 px-4 pt-2">
          <UButton
            v-for="tab in [
              { key: 'baidu' as const, label: `百度 ${cnStats.baidu}` },
              { key: 'weibo' as const, label: `微博 ${cnStats.weibo}` },
              { key: 'douyin' as const, label: `抖音 ${cnStats.douyin}` }
            ]"
            :key="tab.key"
            :label="tab.label"
            :color="activeCn === tab.key ? 'primary' : 'neutral'"
            :variant="activeCn === tab.key ? 'soft' : 'ghost'"
            size="xs"
            @click="activeCn = tab.key"
          />
        </div>

        <p class="px-4 pb-1 pt-2 text-[11px] text-dimmed">
          国内没有 AI 平台公布使用量榜，这里只能拿综合热榜过滤——所以「只看 AI 相关」是关键词匹配，会漏也会误判
        </p>

        <div v-if="loading && cnList.length === 0" class="px-4 py-6 text-xs text-dimmed">
          正在拉取…
        </div>
        <div v-else-if="cnList.length === 0" class="px-4 py-6 text-xs text-dimmed">
          这个榜这次没返回数据，点右上角刷新重试
        </div>

        <ul v-else class="divide-y divide-default/60">
          <li
            v-for="item in cnList"
            :key="item.id"
            class="group flex items-start gap-2 px-4 py-2 hover:bg-elevated/40"
          >
            <span
              class="mt-0.5 w-5 shrink-0 text-right text-xs font-medium tabular-nums"
              :class="(item.metrics.rank ?? 99) <= 3 ? 'text-error' : 'text-dimmed'"
            >
              {{ item.metrics.rank }}
            </span>
            <div class="min-w-0 flex-1">
              <p class="truncate text-sm text-toned" :title="item.title">
                {{ item.title }}
              </p>
              <div class="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-dimmed">
                <span v-if="item.metrics.heat">热度 {{ fmtCount(item.metrics.heat) }}</span>
                <span
                  v-for="badge in item.badges"
                  :key="badge.label"
                  class="rounded px-1 py-px"
                  :class="badgeClass(badge.tone)"
                >
                  {{ badge.label }}
                </span>
              </div>
            </div>
            <div class="flex shrink-0 items-center gap-1 opacity-0 transition group-hover:opacity-100">
              <UTooltip text="去 B 站看有没有人做过">
                <UButton
                  icon="i-lucide-search"
                  color="neutral"
                  variant="ghost"
                  size="xs"
                  @click="biliSearch(item.title)"
                />
              </UTooltip>
              <UTooltip :text="`在${formLabel(item.platform)}里打开`">
                <UButton
                  icon="i-lucide-external-link"
                  color="neutral"
                  variant="ghost"
                  size="xs"
                  :to="item.url"
                  target="_blank"
                />
              </UTooltip>
            </div>
          </li>
        </ul>
      </section>

      <!-- 海外 -->
      <section>
        <header class="flex flex-wrap items-center justify-between gap-2 border-b border-default px-4 py-2">
          <div class="flex items-baseline gap-2">
            <span class="text-sm font-medium text-highlighted">海外 AI 榜</span>
            <span class="text-[11px] text-dimmed">HuggingFace 原生榜单，就是「AI 在火什么」</span>
          </div>
          <span class="text-[11px] text-dimmed">{{ hfItems.length }} 条</span>
        </header>

        <div class="flex gap-1 px-4 pt-2">
          <UButton
            v-for="tab in [
              { key: 'model' as const, label: '趋势模型' },
              { key: 'space' as const, label: '趋势 Space' },
              { key: 'paper' as const, label: '每日论文' }
            ]"
            :key="tab.key"
            :label="tab.label"
            :color="activeHf === tab.key ? 'primary' : 'neutral'"
            :variant="activeHf === tab.key ? 'soft' : 'ghost'"
            size="xs"
            @click="activeHf = tab.key"
          />
        </div>

        <p class="px-4 pb-1 pt-2 text-[11px] text-dimmed">
          {{ activeHf === 'space'
            ? '每个 Space 都是一个能直接打开玩的 AI 应用——刚上榜意味着大部分观众还没见过'
            : activeHf === 'paper'
              ? 'HF 已经帮你从当天几十篇里投过票了，比 arXiv 原始列表省事'
              : '全世界开发者在过去一天下载最多的模型，趋势分越高说明越新近' }}
        </p>

        <div v-if="hfLoading && hfList.length === 0" class="px-4 py-6 text-xs text-dimmed">
          正在拉取…
        </div>
        <div v-else-if="hfList.length === 0" class="px-4 py-6 text-xs text-dimmed">
          还没有数据。海外榜跟着全量采集走，点右上角刷新按钮跑一次（约 12 秒）
        </div>

        <ul v-else class="divide-y divide-default/60">
          <li
            v-for="item in hfList"
            :key="item.id"
            class="group flex items-start gap-2 px-4 py-2 hover:bg-elevated/40"
          >
            <div class="min-w-0 flex-1">
              <p class="truncate text-sm text-toned" :title="item.title">
                {{ item.title }}
              </p>
              <p v-if="item.summary" class="mt-0.5 truncate text-[11px] text-dimmed" :title="item.summary">
                {{ item.summary }}
              </p>
              <div class="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-dimmed">
                <span v-if="item.metrics.trendingScore">趋势分 {{ item.metrics.trendingScore }}</span>
                <span v-if="item.metrics.upvotes !== undefined">票 {{ item.metrics.upvotes }}</span>
                <span
                  v-for="badge in item.badges"
                  :key="badge.label"
                  class="rounded px-1 py-px"
                  :class="badgeClass(badge.tone)"
                >
                  {{ badge.label }}
                </span>
              </div>
            </div>
            <div class="flex shrink-0 items-center gap-1 opacity-0 transition group-hover:opacity-100">
              <UButton
                icon="i-lucide-external-link"
                color="neutral"
                variant="ghost"
                size="xs"
                :to="item.url"
                target="_blank"
              />
            </div>
          </li>
        </ul>
      </section>

      <p v-if="data.fetchedAt" class="border-t border-default px-4 py-2 text-[11px] text-dimmed">
        数据采集于 {{ new Date(data.fetchedAt).toLocaleString('zh-CN') }} · 每天 09:00 自动更新一次 · 热榜超过 2 小时就算旧
      </p>
    </div>
  </UDashboardPanel>
</template>
