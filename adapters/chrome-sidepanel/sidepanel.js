/* global chrome */
/* 侧边栏健康检查：Nuxt 没起来时给一句人话提示，而不是白屏 */
const HUB_URL = 'http://localhost:3110/?embed=true&host=sidepanel'

const frame = document.getElementById('hub')
const hint = document.getElementById('hint')

fetch('http://localhost:3110/api/feed?limit=1')
  .then((res) => {
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
  })
  .catch(() => {
    if (frame) frame.hidden = true
    if (hint) hint.hidden = false
  })

// 允许页面把选题写回扩展（预留：可接 Chrome 下载 / 剪贴板 / 通知）
window.addEventListener('message', (event) => {
  const data = event.data || {}
  if (data.type === 'HUB_COPY_MARKDOWN' && typeof data.markdown === 'string') {
    navigator.clipboard.writeText(data.markdown)
  }
})

// 便于在 service worker 里改地址
if (typeof chrome !== 'undefined' && chrome.storage && frame) {
  chrome.storage.local.get(['hubUrl'], (result) => {
    if (result && typeof result.hubUrl === 'string' && result.hubUrl !== HUB_URL) {
      frame.src = result.hubUrl
    }
  })
}
