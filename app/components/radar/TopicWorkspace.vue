<script setup lang="ts">
import type { FeedItem, SavedTopic } from '#shared/types'

const props = defineProps<{
  item: FeedItem
}>()

const emit = defineEmits<{ close: [] }>()

const toast = useToast()
const { exportTopicToHost, copyMarkdown, hostLabel, busy: hostBusy } = useHostBridge()

const analysis = ref('')
const analyzing = ref(false)
const editing = ref(false)
const savedTopic = ref<SavedTopic | null>(null)
const saving = ref(false)
const bodyRef = ref<HTMLElement | null>(null)
const abortController = shallowRef<AbortController | null>(null)

const analysisHtml = computed(() => renderMarkdownLite(analysis.value))
const hasAnalysis = computed(() => analysis.value.trim() !== '')

async function loadSavedTopic(): Promise<void> {
  try {
    const topics = await $fetch<SavedTopic[]>('/api/topics')
    const matched = topics.find(topic => topic.sourceItemId === props.item.id)
    if (matched !== undefined) {
      savedTopic.value = matched
      if (matched.aiAnalysisMd !== null && matched.aiAnalysisMd !== '') {
        analysis.value = matched.aiAnalysisMd
      }
    }
  } catch {
    // 选题池读取失败不影响主流程
  }
}

async function resetForItem(): Promise<void> {
  abortController.value?.abort()
  analysis.value = ''
  analyzing.value = false
  editing.value = false
  savedTopic.value = null
  await loadSavedTopic()
}

watch(() => props.item.id, () => {
  void resetForItem()
}, { immediate: true })

onBeforeUnmount(() => abortController.value?.abort())

function scrollToBottom() {
  const el = bodyRef.value
  if (el === null) return
  el.scrollTop = el.scrollHeight
}

/** 调 DeepSeek 拿流式拆解；边收边渲染，支持中断。 */
async function analyze() {
  if (analyzing.value) {
    abortController.value?.abort()
    analyzing.value = false
    return
  }

  analyzing.value = true
  editing.value = false
  analysis.value = ''
  const controller = new AbortController()
  abortController.value = controller

  try {
    const res = await fetch('/api/ai/analyze', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // 同时带 itemId 与完整 item：采集库里的走 id 查库，抖音链接解析出来的
      // 那条视频从没入库，只能靠请求体里的对象。后端优先用 item，两条路都通。
      body: JSON.stringify({ itemId: props.item.id, item: props.item }),
      signal: controller.signal
    })

    if (!res.ok || res.body === null) {
      const detail = await res.json().catch(() => null) as { statusMessage?: string, message?: string } | null
      throw new Error(detail?.statusMessage ?? detail?.message ?? `请求失败（HTTP ${res.status}）`)
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      analysis.value += decoder.decode(value, { stream: true })
      await nextTick()
      scrollToBottom()
    }
  } catch (error) {
    if ((error as Error).name === 'AbortError') {
      toast.add({ title: '已中断生成', icon: 'i-lucide-square', color: 'neutral' })
    } else {
      toast.add({
        title: 'AI 拆解失败',
        description: error instanceof Error ? error.message : String(error),
        icon: 'i-lucide-x',
        color: 'error'
      })
    }
  } finally {
    analyzing.value = false
    abortController.value = null
  }
}

async function saveToPool() {
  saving.value = true
  try {
    if (savedTopic.value === null) {
      savedTopic.value = await $fetch<SavedTopic>('/api/topics', {
        method: 'POST',
        body: { itemId: props.item.id, item: props.item }
      })
    }
    if (hasAnalysis.value) {
      savedTopic.value = await $fetch<SavedTopic>(`/api/topics/${savedTopic.value.id}`, {
        method: 'PUT',
        body: { aiAnalysisMd: analysis.value }
      })
    }
    toast.add({
      title: '已收入选题池',
      description: hasAnalysis.value ? 'AI 拆解稿一并保存了' : '可以在「我的选题池」里继续写稿',
      icon: 'i-lucide-pin',
      color: 'success'
    })
  } catch (error) {
    toast.add({
      title: '收藏失败',
      description: error instanceof Error ? error.message : String(error),
      icon: 'i-lucide-x',
      color: 'error'
    })
  } finally {
    saving.value = false
  }
}

async function sendToHost() {
  const result = await exportTopicToHost({
    title: props.item.title,
    markdown: buildTopicMarkdown(props.item, analysis.value),
    url: props.item.url
  })
  toast.add({
    title: result.ok ? result.message : '发送失败',
    description: result.ok ? undefined : `当前环境：${hostLabel.value}`,
    icon: result.ok ? 'i-lucide-send' : 'i-lucide-x',
    color: result.ok ? 'success' : 'error'
  })
}

async function copyAll() {
  await copyMarkdown(buildTopicMarkdown(props.item, analysis.value), '完整选题 Markdown 已复制')
}

function openOriginal() {
  window.open(props.item.url, '_blank', 'noopener')
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-col bg-default">
    <!-- 顶部操作栏 -->
    <div class="flex items-start gap-3 border-b border-default px-4 py-3">
      <div class="min-w-0 flex-1">
        <h2 class="line-clamp-2 text-sm font-semibold leading-snug text-highlighted">
          {{ item.title }}
        </h2>
        <div class="mt-1 flex flex-wrap items-center gap-2 text-xs text-dimmed">
          <span>{{ item.author ?? '未知来源' }}</span>
          <span class="text-dimmed/50">·</span>
          <span>{{ fmtAge(item.publishedAt) }}</span>
          <template v-if="item.platform === 'bilibili'">
            <span class="text-dimmed/50">·</span>
            <span>{{ item.category === 'bili-tech' ? '科技区' : '知识区' }}</span>
          </template>
        </div>
      </div>

      <UButton
        icon="i-lucide-x"
        color="neutral"
        variant="ghost"
        size="xs"
        aria-label="关闭"
        class="lg:hidden"
        @click="emit('close')"
      />
    </div>

    <div class="flex flex-wrap items-center gap-2 border-b border-default px-4 py-2">
      <UButton
        icon="i-lucide-external-link"
        label="看原文"
        size="xs"
        color="neutral"
        variant="outline"
        @click="openOriginal"
      />
      <UButton
        :icon="savedTopic ? 'i-lucide-pin' : 'i-lucide-pin-off'"
        :label="savedTopic ? '已在选题池' : '收入选题池'"
        size="xs"
        :color="savedTopic ? 'success' : 'primary'"
        :variant="savedTopic ? 'soft' : 'solid'"
        :loading="saving"
        @click="saveToPool"
      />
      <UButton
        icon="i-lucide-send"
        label="发送到宿主"
        size="xs"
        color="neutral"
        variant="outline"
        :loading="hostBusy"
        @click="sendToHost"
      />
      <UButton
        icon="i-lucide-clipboard-copy"
        label="复制"
        size="xs"
        color="neutral"
        variant="ghost"
        @click="copyAll"
      />
    </div>

    <!-- 内容区 -->
    <div ref="bodyRef" class="min-h-0 flex-1 overflow-y-auto px-4 py-4">
      <div class="flex flex-wrap gap-1.5">
        <span
          v-for="badge in item.badges"
          :key="badge.label"
          class="rounded px-2 py-0.5 text-xs font-medium"
          :class="{
            'bg-error/10 text-error': badge.tone === 'error',
            'bg-warning/10 text-warning': badge.tone === 'warning',
            'bg-primary/10 text-primary': badge.tone === 'primary',
            'bg-success/10 text-success': badge.tone === 'success',
            'bg-elevated text-toned': badge.tone === 'neutral'
          }"
        >{{ badge.label }}</span>
      </div>

      <div class="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
        <div
          v-for="pill in metricPills(item.metrics)"
          :key="pill.label"
          class="rounded-lg border border-default bg-elevated/40 px-2.5 py-1.5"
        >
          <div class="flex items-center gap-1 text-[11px] text-dimmed">
            <UIcon :name="pill.icon" class="size-3" />
            {{ pill.label }}
          </div>
          <div class="text-sm font-semibold text-highlighted">
            {{ pill.value }}
          </div>
        </div>
      </div>

      <section v-if="item.summary" class="mt-4">
        <h3 class="mb-1.5 text-xs font-semibold uppercase tracking-wide text-dimmed">
          内容简介
        </h3>
        <p class="text-sm leading-relaxed text-toned">
          {{ item.summary }}
        </p>
      </section>

      <section v-if="item.comments.length > 0" class="mt-4">
        <h3 class="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-dimmed">
          <UIcon name="i-lucide-flame" class="size-3.5 text-warning" />
          评论区高赞（前排梗在这）
        </h3>
        <ul class="space-y-2">
          <li
            v-for="(comment, index) in item.comments"
            :key="index"
            class="rounded-lg border border-default bg-elevated/30 px-3 py-2"
          >
            <div class="mb-0.5 flex items-center gap-2 text-[11px] text-dimmed">
              <span class="font-medium text-toned">{{ comment.author }}</span>
              <span class="flex items-center gap-0.5">
                <UIcon name="i-lucide-thumbs-up" class="size-3" />{{ fmtCount(comment.likes) }}
              </span>
            </div>
            <p class="text-sm leading-relaxed text-toned">
              {{ comment.content }}
            </p>
          </li>
        </ul>
      </section>

      <USeparator class="my-5" />

      <!-- AI 拆解区 -->
      <section>
        <div class="mb-3 flex flex-wrap items-center gap-2">
          <UButton
            :icon="analyzing ? 'i-lucide-square' : 'i-lucide-sparkles'"
            :label="analyzing ? '停止生成' : hasAnalysis ? '重新拆解' : 'DeepSeek 帮我找切入点'"
            :color="analyzing ? 'neutral' : 'primary'"
            :variant="analyzing ? 'outline' : 'solid'"
            size="sm"
            @click="analyze"
          />
          <UButton
            v-if="hasAnalysis && !analyzing"
            :icon="editing ? 'i-lucide-eye' : 'i-lucide-pencil'"
            :label="editing ? '预览' : '手动改'"
            size="sm"
            color="neutral"
            variant="ghost"
            @click="editing = !editing"
          />
          <UButton
            v-if="hasAnalysis && !analyzing && savedTopic"
            icon="i-lucide-save"
            label="保存改动"
            size="sm"
            color="neutral"
            variant="ghost"
            @click="saveToPool"
          />
        </div>

        <div v-if="!hasAnalysis && !analyzing" class="rounded-lg border border-dashed border-default px-4 py-8 text-center">
          <UIcon name="i-lucide-sparkles" class="mx-auto mb-2 size-8 text-dimmed" />
          <p class="text-sm text-toned">
            点上面的按钮，让 DeepSeek 拆出「为什么火 + 3 个借势角度」
          </p>
          <p class="mt-1 text-xs text-dimmed">
            会结合播放/互动数据和评论区高赞一起分析
          </p>
        </div>

        <div v-if="analyzing && !hasAnalysis" class="space-y-2 py-2">
          <USkeleton class="h-4 w-1/3" />
          <USkeleton class="h-4 w-full" />
          <USkeleton class="h-4 w-4/5" />
        </div>

        <UTextarea
          v-if="editing"
          v-model="analysis"
          :rows="18"
          autoresize
          class="w-full font-mono text-xs"
        />

        <!-- 流式渲染：内容已转义，v-html 安全 -->
        <div v-else-if="hasAnalysis" class="rounded-lg border border-default bg-elevated/20 px-3.5 py-2" v-html="analysisHtml" />
      </section>
    </div>
  </div>
</template>
