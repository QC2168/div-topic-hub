<script setup lang="ts">
useSeoMeta({ title: 'AI 新资讯 · 选题雷达' })
</script>

<template>
  <RadarView
    title="AI 新资讯"
    subtitle="HF 榜单（趋势模型 / 趋势 Space / 每日论文）+ GitHub 飙升 + Hacker News + arXiv"
    :categories="['ai-board', 'github', 'ai-news', 'community', 'paper']"
  />
</template>
