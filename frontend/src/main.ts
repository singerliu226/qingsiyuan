import { createApp } from 'vue'
import { pinia } from './pinia'
import App from './App.vue'
import router from './router'
import 'element-plus/theme-chalk/src/dark/css-vars.scss'
import './style.css'
import './theme.css'
import { ensureSeed } from './db/seed'

// 开发期调试覆盖层：仅在 dev 注入
if (import.meta.env?.DEV) {
  import('./debug')
}

/**
 * 应用启动流程：
 * 1. 初始化 IndexedDB 种子数据（首次使用时写入默认用户、原料、产品、定价）
 * 2. 创建并挂载 Vue 应用
 */
async function bootstrap() {
  await ensureSeed()
  const app = createApp(App)
  app.use(pinia)
  app.use(router)
  app.mount('#app')
  ;(window as any).__app_mounted = true
}

bootstrap()
