/**
 * 极简 Markdown → HTML（流式 AI 输出专用）。
 *
 * 不引第三方依赖：先整体转义 HTML，再按行解析标题/列表/引用/代码块，最后只做
 * 加粗、行内代码、链接三种行内替换 —— 因此不存在 HTML 注入面。
 * 生成的标签带 Tailwind 类，样式与 Nuxt UI 的排版语言一致。
 */

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function inline(text: string): string {
  return text
    .replace(/`([^`]+)`/g, '<code class="rounded bg-elevated px-1 py-0.5 font-mono text-[0.85em] text-highlighted">$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong class="font-semibold text-highlighted">$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener" class="text-primary underline decoration-primary/40 underline-offset-2">$1</a>')
}

const H_CLASS: Record<number, string> = {
  1: 'mt-1 mb-3 text-lg font-bold text-highlighted',
  2: 'mt-5 mb-2.5 flex items-center gap-2 text-base font-semibold text-highlighted',
  3: 'mt-4 mb-2 text-sm font-semibold text-highlighted',
  4: 'mt-3 mb-1.5 text-sm font-semibold text-toned'
}

/** 把 Markdown 文本渲染为可安全 v-html 的 HTML。 */
export function renderMarkdownLite(markdown: string): string {
  const lines = escapeHtml(markdown).split('\n')
  const out: string[] = []
  let listType: 'ul' | 'ol' | null = null
  let inCode = false
  let codeBuffer: string[] = []

  const closeList = () => {
    if (listType !== null) {
      out.push(`</${listType}>`)
      listType = null
    }
  }

  for (const rawLine of lines) {
    const line = rawLine.trimEnd()

    if (line.trim().startsWith('```')) {
      if (inCode) {
        out.push(`<pre class="my-3 overflow-x-auto rounded-lg bg-elevated p-3 text-xs leading-relaxed text-toned"><code>${codeBuffer.join('\n')}</code></pre>`)
        codeBuffer = []
        inCode = false
      } else {
        closeList()
        inCode = true
      }
      continue
    }
    if (inCode) {
      codeBuffer.push(rawLine)
      continue
    }

    const heading = /^(#{1,4})\s+(.*)$/.exec(line)
    if (heading !== null) {
      closeList()
      const level = (heading[1] ?? '#').length
      out.push(`<h${level} class="${H_CLASS[level]}">${inline(heading[2] ?? '')}</h${level}>`)
      continue
    }

    if (/^\s*(---|\*\*\*|___)\s*$/.test(line)) {
      closeList()
      out.push('<hr class="my-4 border-default">')
      continue
    }

    const ordered = /^\s*\d+\.\s+(.*)$/.exec(line)
    if (ordered !== null) {
      if (listType !== 'ol') {
        closeList()
        out.push('<ol class="my-2 list-decimal space-y-1 pl-5 text-sm leading-relaxed text-toned">')
        listType = 'ol'
      }
      out.push(`<li>${inline(ordered[1] ?? '')}</li>`)
      continue
    }

    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line)
    if (bullet !== null) {
      if (listType !== 'ul') {
        closeList()
        out.push('<ul class="my-2 list-disc space-y-1 pl-5 text-sm leading-relaxed text-toned">')
        listType = 'ul'
      }
      out.push(`<li>${inline(bullet[1] ?? '')}</li>`)
      continue
    }

    const quote = /^\s*&gt;\s?(.*)$/.exec(line)
    if (quote !== null) {
      closeList()
      out.push(`<blockquote class="my-2 border-l-2 border-primary/40 pl-3 text-sm text-toned">${inline(quote[1] ?? '')}</blockquote>`)
      continue
    }

    if (line.trim() === '') {
      closeList()
      continue
    }

    closeList()
    out.push(`<p class="my-1.5 text-sm leading-relaxed text-toned">${inline(line)}</p>`)
  }

  if (inCode && codeBuffer.length > 0) {
    out.push(`<pre class="my-3 overflow-x-auto rounded-lg bg-elevated p-3 text-xs leading-relaxed text-toned"><code>${codeBuffer.join('\n')}</code></pre>`)
  }
  closeList()
  return out.join('\n')
}
