/**
 * 封面图代理：B 站图片 CDN 有防盗链，iframe 内直接 <img> 可能 403，
 * 这里服务端带 referer 取回并缓存，前端统一走 /api/img?url=...
 */
const ALLOWED_HOSTS = ['hdslb.com', 'bilibili.com', 'githubusercontent.com', 'github.com', 'huggingface.co']

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const raw = String(query.url ?? '')
  if (raw === '') {
    throw createError({ statusCode: 400, statusMessage: '缺少 url' })
  }

  let target: URL
  try {
    target = new URL(raw.startsWith('//') ? `https:${raw}` : raw)
  } catch {
    throw createError({ statusCode: 400, statusMessage: 'url 非法' })
  }

  const host = target.hostname
  if (!ALLOWED_HOSTS.some(allowed => host === allowed || host.endsWith(`.${allowed}`))) {
    throw createError({ statusCode: 403, statusMessage: `不允许代理该域名：${host}` })
  }
  if (target.protocol !== 'https:' && target.protocol !== 'http:') {
    throw createError({ statusCode: 400, statusMessage: '仅支持 http(s)' })
  }

  const res = await fetch(target, {
    headers: {
      'referer': 'https://www.bilibili.com/',
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36'
    },
    signal: AbortSignal.timeout(15_000)
  })
  if (!res.ok || res.body === null) {
    throw createError({ statusCode: res.status === 0 ? 502 : res.status, statusMessage: '图片取回失败' })
  }

  setHeader(event, 'content-type', res.headers.get('content-type') ?? 'image/jpeg')
  setHeader(event, 'cache-control', 'public, max-age=86400, immutable')
  return sendStream(event, res.body)
})
