/** 源与 AI 设置：保存 */
import type { SettingsPatch } from '../utils/settings'
import { patchHubSettings, toPublicSettings } from '../utils/settings'

export default defineEventHandler(async (event) => {
  const body = await readBody<SettingsPatch>(event)
  const next = patchHubSettings(body ?? {})
  return toPublicSettings(next)
})
