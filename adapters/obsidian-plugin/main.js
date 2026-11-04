/*
 * 选题雷达 · Obsidian 插件壳（约 80 行，无需编译，复制即可用）
 *
 * 安装：
 *   1. 把本目录复制到 <你的笔记库>/.obsidian/plugins/div-topic-hub/
 *   2. Obsidian → 设置 → 第三方插件 → 关闭安全模式 → 启用「选题雷达」
 *   3. 先在本机跑起 Nuxt（bun run dev，默认 http://localhost:3110）
 *
 * 双向能力：
 *   - 侧边栏 iframe 展示 http://localhost:3110?embed=true&host=obsidian
 *   - 监听 iframe 的 OBSIDIAN_CREATE_NOTE 消息 → 在库根目录「选题雷达」文件夹写 .md
 */
const { Plugin, ItemView, Notice } = require('obsidian')

const VIEW_TYPE = 'topic-hub-view'
const HUB_URL = 'http://localhost:3110/?embed=true&host=obsidian'
const NOTE_FOLDER = '选题雷达'

function sanitize(name) {
  return String(name).replace(/[\\/:*?"<>|#^[\]]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || '未命名选题'
}

class TopicHubView extends ItemView {
  constructor(leaf) {
    super(leaf)
    this.iframe = null
  }

  getViewType() {
    return VIEW_TYPE
  }

  getDisplayText() {
    return '选题雷达'
  }

  getIcon() {
    return 'radar'
  }

  async onOpen() {
    const container = this.containerEl.children[1]
    container.empty()
    container.style.padding = '0'
    this.iframe = container.createEl('iframe', {
      attr: { src: HUB_URL, style: 'width:100%;height:100%;border:0;display:block' }
    })
  }

  async onClose() {
    this.iframe = null
  }

  /** 供插件实例调用：把消息回传给 iframe，让页面知道写入成功 */
  reply(payload) {
    if (this.iframe && this.iframe.contentWindow) {
      this.iframe.contentWindow.postMessage(payload, '*')
    }
  }
}

module.exports = class TopicHubPlugin extends Plugin {
  async onload() {
    this.registerView(VIEW_TYPE, leaf => new TopicHubView(leaf))

    this.addRibbonIcon('radar', '打开选题雷达', () => this.activateView())

    this.addCommand({ id: 'open-topic-hub', name: '打开选题雷达侧边栏', callback: () => this.activateView() })

    this.onMessage = async (event) => {
      const data = event.data || {}
      if (data.type !== 'OBSIDIAN_CREATE_NOTE') return

      try {
        const folder = NOTE_FOLDER
        if (!this.app.vault.getAbstractFileByPath(folder)) {
          await this.app.vault.createFolder(folder)
        }
        const path = `${folder}/${sanitize(data.title)}.md`
        const body = data.markdown || `# ${data.title}\n`
        const existing = this.app.vault.getAbstractFileByPath(path)
        if (existing) {
          await this.app.vault.append(existing, `\n\n${body}`)
        } else {
          await this.app.vault.create(path, body)
        }
        new Notice(`已写入笔记：${path}`)
        this.notifyViews({ type: 'OBSIDIAN_NOTE_CREATED', path })
      } catch (error) {
        new Notice(`写入笔记失败：${error.message}`)
        this.notifyViews({ type: 'OBSIDIAN_ERROR', message: error.message })
      }
    }
    window.addEventListener('message', this.onMessage)
  }

  notifyViews(payload) {
    this.app.workspace.getLeavesOfType(VIEW_TYPE).forEach((leaf) => {
      if (leaf.view && leaf.view.reply) leaf.view.reply(payload)
    })
  }

  async activateView() {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE)
    if (existing.length === 0) {
      await this.app.workspace.getRightLeaf(false).setViewState({ type: VIEW_TYPE, active: true })
    }
    this.app.workspace.revealLeaf(this.app.workspace.getLeavesOfType(VIEW_TYPE)[0])
  }

  onunload() {
    window.removeEventListener('message', this.onMessage)
  }
}
