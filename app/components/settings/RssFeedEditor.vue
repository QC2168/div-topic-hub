<script setup lang="ts">
import type { RssFeedConfig } from '#shared/types'

const feeds = defineModel<RssFeedConfig[]>({ required: true })

function add() {
  feeds.value = [...feeds.value, { name: '', url: '' }]
}

function remove(index: number) {
  feeds.value = feeds.value.filter((_, position) => position !== index)
}
</script>

<template>
  <div class="space-y-2">
    <div
      v-for="(feed, index) in feeds"
      :key="index"
      class="flex flex-col gap-2 sm:flex-row sm:items-center"
    >
      <UInput v-model="feed.name" placeholder="名称，如 机器之心" class="w-full sm:w-40" />
      <UInput v-model="feed.url" placeholder="url" class="min-w-0 flex-1" />
      <UButton
        icon="i-lucide-trash-2"
        color="error"
        variant="ghost"
        size="sm"
        aria-label="删除该源"
        @click="remove(index)"
      />
    </div>

    <UButton
      label="添加 RSS 源"
      icon="i-lucide-plus"
      size="sm"
      color="neutral"
      variant="ghost"
      @click="add"
    />
  </div>
</template>
