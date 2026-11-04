/** 白嫖榜单的前后端共享类型。数据本体与拉取逻辑在 server/utils/free-tier.ts。 */

/** 单条免费模型（来自 OpenRouter 实时接口）。 */
export interface FreeModel {
  id: string
  name: string
  /** 模型 id 的组织前缀，如 nvidia / google */
  provider: string
  contextLength: number | null
}

/** 内容类型：一个平台可能同时覆盖多种（如豆包聊天+生图+生视频）。 */
export type MediaType = 'text' | 'image' | 'video' | 'audio' | 'office'

/** 一条人工核实的免费政策（应用内或 API）。 */
export interface FreeTierEntry {
  platform: string
  /** app = 打开网页/App 直接能用；api = 开发者接口 */
  channel: 'app' | 'api'
  /**
   * daily = 每天签到/登录/活跃就送（当天或次日到账）；
   * permanent = 长期免费（不限量或限流）；
   * quota = 一次性赠送（用完即止）；
   * trial = 试用赠金/代金券
   */
  kind: 'daily' | 'permanent' | 'quota' | 'trial'
  /** 能用来做什么：文本 / 图片 / 视频 / 语音 / 办公 */
  media: MediaType[]
  /** 卡片主标题：一句话说清能白嫖到什么 */
  headline: string
  /** 明细 2–4 条 */
  details: string[]
  /** 使用门槛 */
  gate: string
  /** 去哪儿用 / 申请 */
  applyUrl: string
  /** 核实依据（官方文档或多方交叉的公开整理） */
  sourceUrl: string
  /** 补充说明与坑 */
  note: string
}

export const KIND_LABELS: Record<FreeTierEntry['kind'], string> = {
  daily: '每天领',
  permanent: '长期免费',
  quota: '一次性',
  trial: '试用金'
}

export const MEDIA_LABELS: Record<MediaType, string> = {
  text: '文本',
  image: '图片',
  video: '视频',
  audio: '语音',
  office: '办公'
}
