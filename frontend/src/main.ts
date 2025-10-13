import { createApp } from 'vue'
import { pinia } from './pinia'
import App from './App.vue'
import router from './router'
import 'element-plus/theme-chalk/src/dark/css-vars.scss'
import './style.css'
import './theme.css'
// 开发期调试覆盖层：仅在 dev 注入
if (import.meta.env?.DEV) {
  import('./debug')
}

const app = createApp(App)
app.use(pinia)
app.use(router)
app.mount('#app')
;(window as any).__app_mounted = true
