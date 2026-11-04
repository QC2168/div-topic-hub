// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  modules: [
    '@nuxt/eslint',
    '@nuxt/ui',
    '@vueuse/nuxt'
  ],

  // 组件名直接用文件名（FeedList / TopicWorkspace），不带 radar- 目录前缀
  components: [
    { path: '~/components', pathPrefix: false }
  ],

  devtools: {
    enabled: true
  },

  app: {
    head: {
      htmlAttrs: { lang: 'zh-CN' }
    }
  },

  css: ['~/assets/css/main.css'],

  runtimeConfig: {
    // 只作为兜底：正式配置写在「源与 AI 设置」页，存本地 SQLite
    deepseekApiKey: '',
    deepseekBaseUrl: 'https://api.deepseek.com',
    deepseekModel: 'deepseek-chat'
  },

  routeRules: {
    '/api/**': {
      cors: true
    },
    // 允许被 Obsidian / 浏览器侧边栏 / DSH 以 iframe 方式嵌入
    '/**': {
      headers: {
        'content-security-policy': 'frame-ancestors *',
        'x-frame-options': 'ALLOWALL'
      }
    }
  },

  // 3000 / 3100 都容易被其它工具抢（Remotion Studio 就占过 3100），开发固定走 3110
  devServer: {
    port: 3110
  },

  compatibilityDate: '2026-06-30',

  nitro: {
    // bun:sqlite / node:sqlite 由运行时提供，不打进产物
    externals: {
      external: ['bun:sqlite', 'node:sqlite']
    }
  },

  eslint: {
    config: {
      stylistic: {
        commaDangle: 'never',
        braceStyle: '1tbs'
      }
    }
  }
})
