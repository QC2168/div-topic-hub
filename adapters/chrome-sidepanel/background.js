/* global chrome */
/* 点击工具栏图标 → 打开右侧边栏（Chrome 116+，Edge 同源 API） */
chrome.sidePanel?.setPanelBehavior({ openPanelOnActionClick: true }).catch((error) => {
  console.warn('[选题雷达] sidePanel 设置失败', error)
})

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel?.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {})
})
