# DeepSeek DSH 接入

`TopicHubPanel.vue` 是一个 60 行的 iframe 容器，把它注册到 DSH 的侧边栏，
页面里的「发送到宿主」就会走 DSH 通道：把选题方案拼成 prompt，直接开一个写稿会话。

## 注册方式（在 div-dsh-workbench 里）

```vue
<script setup lang="ts">
import TopicHubPanel from '@/adapters/TopicHubPanel.vue'

// DSH 自己的会话入口（按你项目里的实际 API 替换）
const startSession = (prompt: string) => {
  createSession({ title: '选题写稿', prompt })
}
</script>

<template>
  <SidebarPanel title="选题雷达">
    <TopicHubPanel :on-start-session="startSession" />
  </SidebarPanel>
</template>
```

## 消息协议

| 方向 | type | payload |
| --- | --- | --- |
| 页面 → DSH | `DSH_START_SESSION` | `{ prompt, title, url }` |
| DSH → 页面 | `DSH_SESSION_STARTED` | — （可选回执，页面 1.8s 超时也不报错）|
| DSH → 页面 | `DSH_ERROR` | `{ message }` |

## 备注

- `?embed=true` 让页面收起侧边栏、详情走抽屉，适配 DSH 侧边栏宽度
- `host=dsh` 让页面跳过 iframe 特征嗅探，直接认定宿主为 DSH
- 页面所有导出都基于同一份 Markdown（`buildTopicMarkdown`），
  Obsidian / DSH / 剪贴板三条通道内容完全一致，不用维护两套模板
