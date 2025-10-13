import { createPinia } from 'pinia'

/**
 * Pinia 单例实例
 * 说明：为了解决在路由守卫等组件外环境中使用 `useAuthStore()` 时需要显式提供 Pinia 实例的问题，
 * 这里导出全局唯一的 Pinia 实例，确保守卫中调用 `useAuthStore(pinia)` 始终有活动实例可用。
 */
export const pinia = createPinia()



