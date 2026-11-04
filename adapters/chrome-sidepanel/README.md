# 浏览器扩展接入（Chrome / Edge 侧边栏）

1. 确认本地已跑起服务：`cd D:\projects\div-topic-hub && bun run dev`
2. Chrome 打开 `chrome://extensions` → 右上角打开「开发者模式」
3. 点「加载已解压的扩展程序」→ 选择本目录 `adapters/chrome-sidepanel`
4. 点工具栏上的扩展图标，右侧边栏即常驻打开

## 说明

- 面板内嵌 `http://localhost:3110/?embed=true&host=sidepanel`，
  页面会自动收起左侧导航、详情用抽屉滑出，适配 400px 左右宽度
- `sidepanel.js` 会先 ping 一次 `/api/feed`，服务没起来时显示「请先 bun run dev」而不是白屏
- 想换端口：改 `sidepanel.html` 的 iframe src，或在扩展控制台执行
  `chrome.storage.local.set({ hubUrl: 'http://localhost:4000/?embed=true&host=sidepanel' })`
- 扩展只申请了 `sidePanel` 权限 + localhost 访问权，不注入任何页面脚本

## 已知限制

浏览器侧边栏环境下没有宿主可回写，点「发送到宿主」会退化为**复制 Markdown 到剪贴板**，
再粘贴到你的笔记 / 文档 / DSH 会话里。
