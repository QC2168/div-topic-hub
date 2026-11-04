<script setup lang="ts">
/**
 * 白嫖榜单的一张卡片。
 *
 * 三处网格（国内应用 / 国内 API / 海外平台）共用，避免同一套结构抄三遍。
 * 角标两套：左边「白嫖方式」（每天领/长期免费/一次性），右边「内容类型」（文本/图片/视频/语音/办公）。
 */
import type { FreeTierEntry } from '#shared/free-tier'
import { KIND_LABELS, MEDIA_LABELS } from '#shared/free-tier'

const props = withDefaults(defineProps<{
  entry: FreeTierEntry
  actionLabel?: string
}>(), {
  actionLabel: '去用'
})

const KIND_CLASS: Record<FreeTierEntry['kind'], string> = {
  daily: 'bg-primary/10 text-primary',
  permanent: 'bg-success/10 text-success',
  quota: 'bg-warning/10 text-warning',
  trial: 'bg-elevated text-dimmed'
}

const MEDIA_ICON: Record<FreeTierEntry['media'][number], string> = {
  text: 'i-lucide-message-square',
  image: 'i-lucide-image',
  video: 'i-lucide-clapperboard',
  audio: 'i-lucide-audio-lines',
  office: 'i-lucide-briefcase'
}

const kindLabel = computed(() => KIND_LABELS[props.entry.kind])
const kindClass = computed(() => KIND_CLASS[props.entry.kind])
</script>

<template>
  <article class="flex flex-col rounded-lg border border-default bg-elevated/30 p-3 transition hover:border-primary/40">
    <header class="flex items-start justify-between gap-2">
      <h3 class="text-sm font-semibold text-highlighted">
        {{ entry.platform }}
      </h3>
      <span class="shrink-0 rounded px-1.5 py-px text-[10px] font-medium" :class="kindClass">
        {{ kindLabel }}
      </span>
    </header>

    <p class="mt-1.5 text-xs font-medium text-primary">
      {{ entry.headline }}
    </p>

    <div class="mt-1.5 flex flex-wrap gap-1">
      <span
        v-for="media in entry.media"
        :key="media"
        class="inline-flex items-center gap-0.5 rounded bg-default px-1 py-px text-[10px] text-dimmed"
      >
        <UIcon :name="MEDIA_ICON[media]" class="size-2.5" />
        {{ MEDIA_LABELS[media] }}
      </span>
    </div>

    <ul class="mt-1.5 space-y-1 text-[11px] leading-relaxed text-dimmed">
      <li v-for="detail in entry.details" :key="detail" class="flex gap-1">
        <span class="shrink-0 text-dimmed/60">·</span>
        <span>{{ detail }}</span>
      </li>
    </ul>

    <p class="mt-1.5 text-[11px] text-dimmed/80">
      {{ entry.note }}
    </p>

    <footer class="mt-auto flex items-center justify-between gap-2 pt-2.5">
      <span class="truncate text-[10px] text-dimmed/70">门槛：{{ entry.gate }}</span>
      <div class="flex shrink-0 gap-1">
        <UButton
          :label="actionLabel"
          icon="i-lucide-arrow-up-right"
          size="xs"
          variant="soft"
          color="neutral"
          :to="entry.applyUrl"
          target="_blank"
        />
        <UTooltip text="核实来源">
          <UButton
            icon="i-lucide-book-open"
            size="xs"
            variant="ghost"
            color="neutral"
            :to="entry.sourceUrl"
            target="_blank"
          />
        </UTooltip>
      </div>
    </footer>
  </article>
</template>
