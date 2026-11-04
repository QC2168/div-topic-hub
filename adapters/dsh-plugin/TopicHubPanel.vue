<script setup lang="ts">
/**
 * DeepSeek DSH 侧边栏容器组件（极简版，约 60 行）
 *
 * 用法：在 DSH 的侧边栏注册面板里渲染本组件，并把「新开会话」的能力
 * 通过 `onStartSession` 传进来 —— 页面里点「发送到宿主」时，
 * iframe 会 postMessage `DSH_START_SESSION`，这里转成 DSH 自己的会话入口。
 */
import { onBeforeUnmount, onMounted, ref } from 'vue'

const props = withDefaults(defineProps<{
  /** 本地选题雷达地址 */
  src?: string
  /** DSH 侧：拿到 prompt 后开一个写稿会话 */
  onStartSession?: (prompt: string) => void
}>(), {
  src: 'http://localhost:3110/?embed=true&host=dsh'
})

const frame = ref<HTMLIFrameElement | null>(null)

function reply(payload: Record<string, unknown>) {
  frame.value?.contentWindow?.postMessage(payload, '*')
}

function onMessage(event: MessageEvent) {
  const data = event.data as { type?: string, prompt?: string } | null
  if (data === null || typeof data.type !== 'string') return

  if (data.type === 'DSH_START_SESSION' && typeof data.prompt === 'string') {
    try {
      props.onStartSession?.(data.prompt)
      reply({ type: 'DSH_SESSION_STARTED' })
    } catch (error) {
      reply({ type: 'DSH_ERROR', message: error instanceof Error ? error.message : String(error) })
    }
  }
}

onMounted(() => window.addEventListener('message', onMessage))
onBeforeUnmount(() => window.removeEventListener('message', onMessage))
</script>

<template>
  <div class="h-full w-full">
    <iframe
      ref="frame"
      :src="src"
      title="选题雷达"
      class="h-full w-full border-0"
    />
  </div>
</template>
