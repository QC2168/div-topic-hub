/** 源与 AI 设置：读取（API Key 永不明文回传） */
import { loadHubSettings, toPublicSettings } from '../utils/settings'

export default defineEventHandler(() => toPublicSettings(loadHubSettings()))
