<script setup lang="ts">
useSeoMeta({ title: '圈内黑马 · 选题雷达' })
</script>

<template>
  <RadarView
    title="圈内黑马"
    subtitle="B 站科技区 / 知识区正在冲的视频：按「播放速度 × 互动率 × 新鲜度」排序"
    :categories="['bili-tech', 'bili-knowledge']"
  />
</template>
