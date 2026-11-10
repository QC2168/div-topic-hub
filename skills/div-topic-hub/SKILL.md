---
name: div-topic-hub
description: 查询中文互联网的热点选题数据（B站黑马视频、AI 与开发者资讯、全网热搜、AI 免费额度白嫖榜单）。当用户想找选题、看今天有什么热点、B站什么视频在冲、微博/抖音/百度热搜榜、AI 圈最近发生了什么、哪些大模型 API 有免费额度时使用。Use when the user asks for trending topics, viral Bilibili videos, China hot search rankings (Weibo/Douyin/Baidu), daily AI news, GitHub trending, or free LLM API tiers with signup quotas.
version: 1.0.0
allowed-tools: Bash
---

# div-topic-hub 热点数据

四个数据集，全部是**每日更新的静态 JSON 快照**，无鉴权、可直接 GET：

| 数据集 | 内容 | 条数 |
|---|---|---|
| `bilibili` | B 站科技/知识区上升期视频，按「播放速度 × 互动率 × 新鲜度」算爆发分排序 | ~100 |
| `ai-news` | GitHub 飙升 / AI 快讯(RSS) / Hacker News / arXiv / HuggingFace 榜单 | ~360 |
| `hot-search` | 抖音热榜、微博热搜、百度热搜（只有热度与名次） | ~150 |
| `free-tier` | AI 免费额度榜单（国内应用/国内 API/海外平台）+ OpenRouter 零价模型 | ~50 |

## 怎么用

在本 skill 目录下执行（`scripts/hub.mjs` 零依赖，只要 Node 18+）：

```bash
node scripts/hub.mjs datasets                                   # 先看目录与新鲜度
node scripts/hub.mjs list bilibili --limit 10                   # 榜单（按爆发分降序）
node scripts/hub.mjs search "AI 编程" --dataset ai-news --since-hours 48
node scripts/hub.mjs get "bili:BV1i4W86zEUS"                    # 单条详情（含热评）
node scripts/hub.mjs free-tier --channel api --query 免费
node scripts/hub.mjs doctor                                     # 连通性与新鲜度自检
```

**管道调用时自动输出 JSON**（agent 读取天然走这个分支），不需要加 `--json`；终端里给人看时才打印可读格式。
换镜像用 `--base <url>` 或环境变量 `HUB_BASE_URL`。字段含义见 `references/data-contract.md`。

## 三条必须遵守的表述规则

1. **数据是快照不是实时**。引用时必须带上 `fetchedAt`（"截至 X 时间"），并检查 `stale` 字段。
   热搜超过 2 小时就算旧，视频/资讯超过 1 天算旧——`staleAfterMinutes` 已按数据集分别给好。
2. **热搜只有热度与名次**，没有播放量，**跨平台的热度量纲不可比**（抖音 1000 万 ≠ 微博 1000 万）。
3. **`warnings` 非空说明本次采集有子源降级**（比如"微博热搜：HTTP 403"）。这时结论要写清
   "某个源没采到"，不要把缺失当成"没有热点"。

## 常见任务

- **找选题**：`list bilibili --limit 15` 看爆发分高的；再 `list hot-search` 对照全网话题。
- **判断能不能蹭**：`get` 某条详情，看 `badges`（播放破 X 万 / 互动率极高 / 近期黑马）和 `comments` 里的观众槽点。
- **查某个词**：`search <词>` 默认在 `bilibili` 里搜，加 `--dataset ai-news` 或 `hot-search` 换库。
- **白嫖额度**：`free-tier --channel app`（国内应用）/ `--channel api`（开发者 API）/ `--kind daily`（每天送额度）。

## 失败时

`doctor` 不通说明数据端不可达（GitHub Pages 国内偶尔不稳）。此时：
先重试一次；仍失败则改用 `--base` 指向镜像，或让用户访问
`https://qc2168.github.io/div-topic-hub/` 自行查看。**不要凭记忆编造榜单内容。**
