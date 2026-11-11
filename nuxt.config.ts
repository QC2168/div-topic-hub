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
    // 服务端接口（/api/ai/analyze、/api/settings/test）的兜底配置。
    // 前端已经改成浏览器直连 DeepSeek + Key 存 localStorage，所以这几个值
    // 只对「有人直接调服务端接口」或本机脚本有用，网站跑起来用不到它们
    deepseekApiKey: '',
    deepseekBaseUrl: 'https://api.deepseek.com',
    deepseekModel: 'deepseek-chat',
    public: {
      /**
       * 快照数据端地址。网站不再有采集服务，页面直接读这里的 /api/v1/*.json。
       * 如果哪天把网站也挂到同一个 Pages 上，把它设成空字符串即可走同源相对路径。
       * 可用 NUXT_PUBLIC_HUB_BASE 覆盖。
       */
      hubBase: 'https://qc2168.github.io/div-topic-hub'
    }
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
