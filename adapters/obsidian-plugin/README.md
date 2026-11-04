# Obsidian 接入（两种方案）

前提：本机已跑起选题雷达 —— `cd D:\projects\div-topic-hub && bun run dev`（默认 3110 端口）。

## 方案 1：零代码，5 分钟挂上去

1. Obsidian → 设置 → 第三方插件 → 关闭安全模式
2. 社区插件市场搜索并安装 **Custom Frames**
3. 在 Custom Frames 设置里新增一个 frame：
   - Title：`选题雷达`
   - URL：`http://localhost:3110/?embed=true&host=obsidian`
   - 打开 `Add ribbon icon`
4. 点左侧 ribbon 图标即可在右侧打开

> `?embed=true` 会让页面自动收起侧边栏、详情改用抽屉；`host=obsidian` 让「发送到宿主」走 Obsidian 通道。

缺点：Custom Frames 只能显示，不能把内容写进笔记库（点「发送到宿主」会退化成复制 Markdown）。

## 方案 2：深度联动，一键写笔记

把本目录整体复制到：

```
<你的笔记库>/.obsidian/plugins/div-topic-hub/
├── main.js
└── manifest.json
```

然后在 Obsidian → 设置 → 第三方插件里启用「选题雷达」。

- ribbon 图标 / 命令面板「打开选题雷达侧边栏」都能唤起
- 页面里点「发送到宿主」，插件会监听 `OBSIDIAN_CREATE_NOTE` 消息，
  在笔记库根目录的 `选题雷达/` 文件夹下生成 `<标题>.md`（同名则追加）
- 写入成功后回传 `OBSIDIAN_NOTE_CREATED`，页面会弹成功提示

默认写库路径和端口在 `main.js` 顶部两个常量里改：`HUB_URL`、`NOTE_FOLDER`。
