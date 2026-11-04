# 选题雷达 · div-topic-hub

跨端 AI 选题工作台：把 **B 站科技区/知识区的黑马爆款** 和 **AI 圈一手新资讯** 收进一个列表，
点一下就用 DeepSeek 拆成「为什么火 + 3 个借势视频角度（标题 + 三步大纲）」。

一套 Web 核心（Nuxt 4 + Bun + Nuxt UI），四端复用：独立浏览器 / Obsidian 侧边栏 / 浏览器侧边栏 / DeepSeek DSH。

## 快速开始

```bash
cd D:\projects\div-topic-hub
bun install
bun run dev
```

打开 `http://localhost:3110`，然后：

1. 进「源与 AI 设置」填 DeepSeek API Key（存在本机 SQLite，不上传）
2. 回「圈内黑马」，点右上角 🔄 采集
3. 点任意卡片 → 右侧看数据 + 高赞评论 → 点「DeepSeek 帮我找切入点」

> 端口被占用时用 `bun run dev -- --port 3210`，记得同步改 `adapters/*` 里的地址。

## 功能地图

| 页面 | 路由 | 说明 |
| --- | --- | --- |
| 圈内黑马 | `/` | B 站科技区 + 知识区的黑马（综合热门 / 全站榜 / 垂类搜索三路合并），按爆发分排序 |
| 全网热点 | `/hot` | 上半：国内三榜（百度/微博/抖音）+ AI 关键词筛选；下半：海外 HF 三榜；顶部粘抖音链接直接拆解 |
| AI 新资讯 | `/ai-news` | HF 榜单（模型/Space/论文）+ GitHub 飙升 + AI 快讯 + HN + arXiv |
| 我的选题池 | `/pool` | 收藏的选题、AI 拆解稿、状态流转（想法/写稿中/已发布/搁置） |
| 源与 AI 设置 | `/settings` | DeepSeek Key、自定义 RSS、监控的 UP 主 UID、采集间隔 |

一次全量采集当前产出约 **635 条**：B 站 100 + AI 385（含 HF 约 75）+ 热搜 149（百度 50 + 微博 50 + 抖音 49）。

深链：`/?item=bili:BV1xxxxxxxx` 直接打开某条热点的拆解台（方便从笔记回跳）。

## 爆发分与标签怎么算

`server/utils/score.ts`：

- **爆发分** = `log10(播放)·9 + log10(播放/小时)·15 + 互动率·180 + 新鲜度 + 热门流加成`
  —— 刻意让「速度」压过「体量」，小 UP 的猛冲能盖过老爆款；「热门流加成」指出现在 B 站
  综合热门里（真实短期爆发信号，+6）
- **标签**（最多 3 个）：🔥 播放破 50 万 / ⚡ 互动率 ≥ 6% / 🐴 近 7 天且日增 ≥ 3000 播放 / 🌱 48 小时内起量
- GitHub 用 `log10(Star)·12 + log10(今日新增)·20`，标签为「今日 +N star」「Star 破万」
- HN 用 `log10(得分)·10 + log10(每小时涨分)·18 + 时效`，标签为「🔥 破 500 分」「⚡ 讨论破 200」
- arXiv 没有互动指标，只按新鲜度排（`55 - 小时数/5`）
- 热搜类（抖音/微博）单独一条分支：`log10(热度)·10 + 名次加成`。
  它们没有播放量，套用上面的「每小时播放速度」会算出天文数字，所以必须隔离。

## 数据从哪来（全部服务端采集，绕开 CORS 与防盗链）

### 国内

| 源 | 接口 | 备注 |
| --- | --- | --- |
| B 站综合热门 | `x/web-interface/popular?ps=50&pn=` | 全站推荐流，实时，带完整 stat；翻 8 页后按子分区 tid 归到科技/知识 |
| B 站全站榜 | `x/web-interface/ranking/v2?rid=0` | **只请求 rid=0**：分区榜已冻结（见下），全站榜是活的 |
| B 站垂类搜索 | `x/web-interface/wbi/search/type?order=totalrank` | 每区 5~6 个垂类关键词各取一页，再用「播放 ≥ 5000 + 30 天内」两道过滤去噪 |
| B 站高赞评论 | `x/v2/reply?oid=&sort=1` | 只给分数最高的 8 条补，礼貌抓取 |
| 关注的 UP 主 | `x/space/wbi/arc/search`（WBI 签名） | 签名算法移植自已验证实现 |
| 百度热搜 | `top.baidu.com/api/board?platform=pc&tab=realtime` | 50 条，**带真实热度值和一句话摘要**。移动版没有 hotScore，所以固定用 PC 版 |
| 微博热搜 | `weibo.com/ajax/side/hotSearch` | 微博网页侧边栏自己的数据源，无需 cookie |
| 抖音热榜 | `aweme.snssdk.com/aweme/v1/hot/search/list/` | 无需鉴权/签名的公开榜单，带 `hot_value` + 名次 |
| 抖音单条解析 | `iesdouyin.com/share/video/{id}/` 里的 `_ROUTER_DATA` | 读分享页自带的 JSON，不破签名。失败即报错，不填充假数据 |
| 中文 AI 媒体 | RSS（机器之心 / 量子位） | 并入 AI 快讯 |

### 海外

| 源 | 接口 | 备注 |
| --- | --- | --- |
| GitHub 趋势 | `github.com/trending`（日榜/周榜/python/typescript） | 官方 API 没有「今日新增 star」字段，抓不到时降级官方 search |
| Hacker News | `hn.algolia.com/api/v1/search` | **官方搜索后端**，一次请求带 points/comments。首页榜 + 48 小时高分新帖 |
| arXiv | `export.arxiv.org/api/query` | **官方 Atom API**，cs.AI / cs.CL / cs.LG / cs.CV 按提交时间倒序 |
| HF 趋势模型 | `huggingface.co/api/models?sort=trendingScore` | 全世界开发者在下载什么。带 trendingScore / downloads / likes |
| HF 趋势 Space | `huggingface.co/api/spaces?sort=trendingScore` | **每一条都是能直接打开玩的 AI 应用**，是「新工具实测」类选题的直接来源 |
| HF 每日论文 | `huggingface.co/api/daily_papers` | 比 arXiv 原始列表多一层社区投票，带 AI 摘要与关键词 |
| 白嫖榜单（实时模型） | `openrouter.ai/api/v1/models` | 无需鉴权，`pricing` 全为 0 即免费模型，1 小时缓存 |
| 白嫖榜单（平台政策） | 人工核实静态清单 | 国内/海外的免费额度与每日积分没有公开接口，每条带核实日期与来源链接，不伪装成实时 |
| AI 媒体 | RSS / Atom（9 个内置源，见 `BUILTIN_RSS_FEEDS`） | OpenAI / DeepMind / Google Research / HF / MIT / Verge / TechCrunch / Simon Willison / 量子位 |

### 为什么必须分「国内 / 海外」两组

**海外有 HuggingFace 这种「AI 原生平台自己出的公开榜单」——规范、实时、免费，
拿到的就是「AI 领域在火什么」。国内没有。**

豆包、文心、通义、Kimi 没有任何一家公布使用量榜。国内能白嫖的「AI 榜」只有两条路：

1. **综合热榜里过滤 AI 关键词**（百度/微博/抖音）——实时，但**不是 AI 专属榜**
2. **第三方评测榜**（OpenCompass 司南、SuperCLUE、AI 产品榜）——是真正的 AI 榜，
   但**月度/季度更新，且没有公开 JSON 接口**（实测前两个返回 SPA 空壳，只能爬 HTML）

所以 `/hot` 页面把两段分开：海外是原生 AI 榜，国内是综合热榜 + AI 关键词筛选。
硬混成一栏会让人误以为国内也有对等的 AI 榜单，那是假的。

**顺带一个真实观察**：某天三榜合计 149 条，AI 关键词只命中 2 条。
这个数字本身就是信息——AI 在国内大众热榜上仍然是小众话题。

**抖音为什么只接热榜、不接视频详情**：抖音的视频接口要 `a_bogus`/`X-Bogus` 签名 +
一整套 cookie，属于主动对抗风控，代价是随时封号和明确的法律风险；热榜接口是分享页
自己的后端，公开、无需签名。所以这里的选择是「拿能拿的，不啃需要破防护的」。

代价必须说清楚：**拿不到播放量和作者粉丝数，破圈倍率那套在抖音不成立**，
抖音数据在页面上只作为「热点词 + 热度名次」使用。

**一个被砍掉的指标**：原打算用热榜返回的 `video_count` 算「供给缺口」（热但没人做）。
实测 1200 万热度的榜一条目 `video_count` 只有 2，说明它的口径根本不是「相关视频总数」。
基于含义不明的字段下「还没人做」的结论等于编造洞察，所以整块删掉——
「有没有人做过」改成页面上的「查 B 站」一键跳转，让用户看真实搜索结果。

**已弃用的接口（踩过的坑，别再加回来）**：`x/web-interface/ranking/v2?rid=188|36` 与
`x/web-interface/ranking/region?rid=&day=3|7` 是「分区排行榜」，上游自 2025-04 起
返回冻结快照（响应头 `no-cache`、`Date` 是当前时间，说明不是本地缓存），采集出来全是
一年前的旧稿。现在这两条链路已整体替换为「综合热门 + 全站榜 + 综合排序搜索」。

**扩容优先级的判断依据**：能加量的地方全在官方公开接口上——HN 走 Algolia、arXiv 走
Atom、RSS 走各家 feed，不需要绕风控，可以放心多拉；B 站只能小幅加深（翻页 + 关键词），
因为它的非文档接口本身就是风险源。想再扩，优先"加官方源"，而不是"啃灰产接口"。

失败是逐源的：某个源挂了只在顶部显示「N 源降级」，其余照常展示。
另外**不做「数据偏旧就退化为全量展示」的兜底**——宁可某天没有 B 站内容，也不能把过期
稿子冒充热点。读取层还有一道 45 天的发布时间闸（`listFeedItems` 的 `maxAgeDays`），
即便库里混进旧数据也顶不到首页。

## 免费额度榜单（白嫖图鉴）数据怎么维护

B站 Toy「AI 免费额度图鉴」和本仓库 `/free` 页面共用一份数据。

```text
data/free-tier.json          ← 唯一要改的文件（schema 见 data/free-tier.schema.json）
server/utils/free-tier.ts    ← 读取层：补 media、装配 OpenRouter 实时模型
server/api/radar/free-tier   ← Nuxt 接口（本机跑 workbench 时用）
site/api/radar/free-tier.json ← 静态端点（线上给 Toy 用，脚本生成，别手改）
```

**改数据只改 `data/free-tier.json`**：改完跑 `node scripts/validate-data.mjs` 自检
（URL、kind 取值、平台名重复都会拦），本地想看效果再 `node scripts/export-free-tier.mjs`
重新导出。推上 master 后 CI 会自动重建并发布；每天早上 9 点也会定时刷新一次
OpenRouter 零价模型榜（人工核实的静态条目不会变，只有实时榜会动）。

**线上地址**（GitHub Pages，见 `.github/workflows/free-tier.yml`）：
`https://<用户名>.github.io/div-topic-hub/api/radar/free-tier.json`

国内访问 GitHub Pages 不稳定时，把同一个仓库接到 EdgeOne Pages / Cloudflare Pages
（构建命令留空、输出目录填 `site` 即可，`site/_headers` 已带 CORS 头），
然后把 Toy 端 `assets/js/core.js` 的 `REMOTE_API` 指到新地址。

## 存储

`bun:sqlite`（Bun 下）自动回落 `node:sqlite`（Node 24），零依赖。

```text
.data/topic-hub.sqlite
├── feed_items    采集缓存（按爆发分排序，抓取超 7 天 / 发布超 45 天自动清理）
├── saved_topics  选题池 + AI 拆解稿（永久保留）
├── settings      Key / RSS / UP 主 / 采集间隔
└── fetch_log     每次采集的结果，便于排查
```

删掉 `.data/` 即可重置。

## 跨端接入

| 端 | 方法 | 文档 |
| --- | --- | --- |
| Obsidian | Custom Frames（零代码）或自带插件壳（一键写笔记） | `adapters/obsidian-plugin/README.md` |
| 浏览器侧边栏 | 加载 `adapters/chrome-sidepanel` 未打包扩展 | `adapters/chrome-sidepanel/README.md` |
| DeepSeek DSH | 注册 `adapters/dsh-plugin/TopicHubPanel.vue` | `adapters/dsh-plugin/README.md` |

宿主通信在 `app/composables/useHostBridge.ts`：

- `?embed=true` 自动收起侧边栏、详情改抽屉
- `?host=obsidian|dsh|sidepanel` 显式指定宿主，跳过 iframe 嗅探
- 「发送到宿主」三通道：`OBSIDIAN_CREATE_NOTE` 写笔记 / `DSH_START_SESSION` 起会话 / 兜底复制 Markdown

## 目录结构

```text
app/
├── components/radar/{RadarView,FeedList,TopicWorkspace}.vue
├── composables/{useRadar,useHostBridge}.ts
├── pages/{index,ai-news,pool,settings}.vue
├── utils/{format,markdown}.ts
server/
├── api/radar/{bilibili,ai-news}.get.ts · refresh.post.ts
├── api/ai/analyze.post.ts · api/feed.get.ts · api/topics/* · api/settings*
└── utils/{db,collect,bilibili,ai-news,hackernews,arxiv,score,deepseek,repo,settings}.ts
shared/types.ts        # 前后端共享契约
adapters/              # 三端插件壳
```

## 常用命令

```bash
bun run dev        # 开发
bun run build      # 生产构建
bun run preview    # 预览产物
bun run typecheck  # vue-tsc 类型检查
bun run lint       # eslint
```

## 已知取舍

- **不碰泛娱乐热榜**：只有科技/知识区 + AI 垂类，宁可少不要杂
- **评论只抓前 8 条视频**：免费采集保持克制，避免触发风控
- **老数据兜底**：若榜单整体偏旧（超过 30 天），会退化为全量并提示，不让选区空掉
- **DeepSeek 输出走极简 Markdown 渲染**：先整体转义再渲染，无 XSS 面（不引 mdc 依赖）
