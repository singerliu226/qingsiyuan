import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import AutoImport from 'unplugin-auto-import/vite'
import Components from 'unplugin-vue-components/vite'
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers'
import { VitePWA } from 'vite-plugin-pwa'

// GitHub Pages 部署时使用子路径 /qingsiyuan/
const base = process.env.GITHUB_ACTIONS ? '/qingsiyuan/' : '/'

// https://vitejs.dev/config/
export default defineConfig({
  base,
  plugins: [
    vue(),
    AutoImport({
      resolvers: [ElementPlusResolver()],
      dts: true,
    }),
    Components({
      resolvers: [ElementPlusResolver()],
      dts: true,
    }),
    /**
     * PWA 配置
     * - registerType: 'prompt' — 新版本就绪后提示用户刷新，避免静默更新导致数据错乱
     * - workbox.globPatterns — 缓存所有静态资源（JS/CSS/HTML/图片/字体）
     * - manifest — Web App Manifest，用于"添加到主屏幕"功能
     */
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['favicon.svg', 'icon.svg'],
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2,woff,ttf}'],
        /** 运行时缓存 API 请求：NetworkFirst 策略，优先网络，离线时使用缓存 */
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/.*\/api\/.*/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-cache',
              expiration: {
                maxEntries: 100,
                maxAgeSeconds: 60 * 60 * 24, // 24 小时
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
        ],
      },
      manifest: {
        name: '青丝源进销存助手',
        short_name: '青丝源',
        description: '青丝源发制品进销存管理系统',
        theme_color: '#16a34a',
        background_color: '#f7f8fa',
        display: 'standalone',
        orientation: 'portrait',
        scope: base,
        start_url: base,
        categories: ['business', 'productivity'],
        icons: [
          {
            src: 'icon.svg',
            sizes: '512x512',
            type: 'image/svg+xml',
            purpose: 'any',
          },
          {
            src: 'icon.svg',
            sizes: '512x512',
            type: 'image/svg+xml',
            purpose: 'maskable',
          },
        ],
      },
      devOptions: {
        enabled: true, // 开发环境也启用 PWA 便于调试
      },
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        // 保留 /api 前缀，后端路由已挂载在 /api 下
        rewrite: (path) => path,
      },
    },
  },
})
