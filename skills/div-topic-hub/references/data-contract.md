# 数据契约（div-topic-hub v1）

网站前端、静态端点、agent skill 共用同一份结构。**改这里之前先改 `shared/types.ts`**，
两边是同一份事实。

## 端点

| 路径 | 内容 |
|---|---|
| `/api/v1/datasets.json` | 数据集目录：id、条数、新鲜度、contentHash、字段文档地址。**程序化调用的入口** |
| `/api/v1/bilibili.json` | B站黑马 |
| `/api/v1/ai-news.json` | GitHub / AI 快讯 / HN / arXiv / HuggingFace 合并 |
| `/api/v1/hot-search.json` | 抖音 + 微博 + 百度热搜 |
| `/api/v1/free-tier.json` | 白嫖榜单（结构与上面四个不同，见文末） |
| `/api/radar/free-tier.json` | 旧地址，内容与 `/api/v1/free-tier.json` 字节相同，**永久保留** |

缓存：数据集文件用 `?v=<contentHash>` 绕 CDN（内容变了 URL 就变）；目录清单是固定 URL，
客户端自己加 `?t=<时间戳>`。所有端点都带 `Access-Control-Allow-Origin: *`。

## 快照信封（三个 FeedItem 类数据集）

```json
{
  "schema": "div-topic-hub/v1",
  "dataset": "bilibili",
  "name": "B站黑马",
  "description": "……",
  "generatedAt": "2026-11-11T01:00:12.000Z",
  "fetchedAt": "2026-11-11T00:59:40.000Z",
  "mode": "refresh",
  "count": 100,
  "counts": { "bili-tech": 50, "bili-knowledge": 50 },
  "staleAfterMinutes": 1440,
  "ageMinutes": 0,
  "contentHash": "sha256:9f3c1a2b3c4d5e6f",
  "collectMs": 31200,
  "warnings": [],
  "items": [ /* FeedItem */ ]
}
```

| 字段 | 说明 |
|---|---|
| `fetchedAt` | **数据采集时刻**。引用时必须带上它 |
| `generatedAt` | 文件写出时刻。CI 重建会刷新它，但不会伪造 `fetchedAt` |
| `mode` | `refresh`（真采集）/ `from-db`（读本地库重新导出） |
| `count` / `counts` | 总数与按 category 的分布，恒等于 `items.length` |
| `staleAfterMinutes` | 超过这个分钟数就该视为过期。bilibili/ai-news 是 1440，**hot-search 是 120** |
| `ageMinutes` | 生成时的年龄，仅作参考；消费方请用自己的时钟算 `now - fetchedAt` |
| `contentHash` | 对 `{dataset, count, items}` 取 sha256 前 16 位，**不含时间戳** |
| `collectMs` | 本次采集耗时；`from-db` 时为 `null` |
| `warnings` | 本次采集的降级说明，例：`微博热搜：HTTP 403` |

## FeedItem

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | string | 形如 `bili:BV1xx411c7mD`、`gh:owner/repo`、`weibo:hot:某个词` |
| `platform` | enum | `bilibili` `github` `rss` `hn` `arxiv` `douyin` `weibo` `baidu` `huggingface` |
| `category` | enum | `bili-tech` `bili-knowledge` `github` `ai-news` `community` `paper` `hot-search` `ai-board` |
| `title` | string | 标题 / 仓库名 / 热搜词 |
| `author` | string \| null | 作者 / 组织；热搜为 null |
| `url` | string | 原始页面，恒为 https |
| `cover` | string \| null | 封面图 |
| `summary` | string | 摘要（热搜用榜单名次或百度 desc） |
| `metrics` | object | 见下表，缺省表示该平台没有这个指标 |
| `comments` | array | 最多几条高赞评论：`{ author, content, likes }` |
| `badges` | array | `{ key, label, tone }`，key ∈ `hot` `interactive` `dark-horse` `trending` `brand-new` `breakout` |
| `publishedAt` | string \| null | 发布时间；**热搜为 null** |
| `fetchedAt` | string | 这条记录的采集时刻 |
| `score` | number | 后端算好的爆发分，**同一数据集内可比，跨数据集不可比** |

### metrics

| 字段 | 平台 | 含义 |
|---|---|---|
| `play` `like` `reply` `danmaku` `favorite` `coin` `share` | bilibili | 播放/点赞/评论/弹幕/收藏/投币/分享 |
| `fans` | bilibili | UP 主粉丝数（判断体量） |
| `stars` / `starsToday` | github | 总 star / 今日新增 |
| `points` | hn | Hacker News 得分（它唯一的热度信号） |
| `heat` / `rank` | douyin / weibo / baidu | 榜单热度值、名次（1 为最高）。**量纲各家不同，跨平台不可比** |
| `videoCount` | douyin | 上游原值，**口径未经验证，不要用来判断竞争度** |
| `trendingScore` | huggingface | 趋势分（按时间衰减滚动算） |
| `upvotes` | huggingface | 每日论文的社区投票数 |
| `downloads` | huggingface | 模型累计下载量 |

## free-tier（结构不同）

```json
{
  "author": { "mid": "…", "name": "…", "bvid": "", "aid": 0 },
  "overseas": { "models": [ { "id", "name", "provider", "contextLength" } ], "fetchedAt": "…", "rateLimitNote": "…" },
  "domestic": { "app": [FreeTierEntry], "api": [FreeTierEntry], "verifiedAt": "2026-11-03" },
  "overseasPlatforms": { "entries": [FreeTierEntry], "verifiedAt": "2026-11-03" },
  "warnings": []
}
```

`FreeTierEntry`：

| 字段 | 说明 |
|---|---|
| `platform` | 平台名 |
| `channel` | `app`（打开就能用）/ `api`（开发者接口） |
| `kind` | `daily`（每天送）/ `permanent`（长期免费）/ `quota`（一次性）/ `trial`（试用金） |
| `media` | `text` `image` `video` `audio` `office` 的数组 |
| `headline` | 一句话说清能白嫖到什么 |
| `details` | 明细 2–4 条 |
| `gate` | 使用门槛（实名 / 手机号 / 绑卡） |
| `applyUrl` / `sourceUrl` | 申请地址 / 核实依据 |
| `note` | 补充说明与坑 |

**`verifiedAt` 是人工核实日期，不是采集时间**——它可能已经过去几周，引用时要说明。
`overseas.models` 是每天实时拉的 OpenRouter 零价模型（判定标准：prompt 与 completion 单价都是 `"0"`）。

## 用 jq 速查

```bash
curl -s https://qc2168.github.io/div-topic-hub/api/v1/bilibili.json \
  | jq '.items[:5][] | {score, title, url, play: .metrics.play}'

curl -s https://qc2168.github.io/div-topic-hub/api/v1/hot-search.json \
  | jq -r '.items[] | select(.platform=="weibo") | "\(.metrics.rank). \(.title)"' | head -10
```

## 稳定性承诺

- 字段只增不改；要改形状就升 `schema` 到 v2 并同时保留 v1 一段时间。
- `items` 每日可能整批变化（重新采集会刷新 `fetchedAt`），**不要按数组下标做缓存**。
- 条数会随上游波动；`count` 掉到平时一半以下时，上游多半是抽风了，看 `warnings` 再下结论。
