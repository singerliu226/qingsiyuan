import { createRouter, createWebHistory } from 'vue-router'
import type { RouteRecordRaw } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { pinia } from '../pinia'

const routes: RouteRecordRaw[] = [
  { path: '/login', name: 'login', component: () => import('../views/Login.vue'), meta: { title: '登录' } },
  { path: '/', name: 'home', component: () => import('../views/Home.vue'), meta: { requiresAuth: true, title: '首页' } },
  { path: '/outbound', name: 'outbound', component: () => import('../views/Outbound.vue'), meta: { requiresAuth: true } },
  { path: '/materials', name: 'materials', component: () => import('../views/Materials.vue'), meta: { requiresAuth: true } },
  { path: '/inventory-logs', name: 'inventory-logs', component: () => import('../views/InventoryLogs.vue'), meta: { requiresAuth: true } },
  { path: '/stats', name: 'stats', component: () => import('../views/Stats.vue'), meta: { requiresAuth: true } },
  { path: '/settings', name: 'settings', component: () => import('../views/Settings.vue'), meta: { requiresAuth: true, roles: ['owner'] } },
  { path: '/products', name: 'products', component: () => import('../views/Products.vue'), meta: { requiresAuth: true } },
  { path: '/purchases', name: 'purchases', component: () => import('../views/Purchases.vue'), meta: { requiresAuth: true } },
  { path: '/pricing', name: 'pricing', component: () => import('../views/Pricing.vue'), meta: { requiresAuth: true, roles: ['owner'] } },
  { path: '/403', name: 'forbidden', component: () => import('../views/Forbidden.vue') },
]

const router = createRouter({ history: createWebHistory(), routes })

router.beforeEach(async (to) => {
  // 在路由守卫中显式使用全局 pinia 实例，避免白屏于早期守卫阶段
  const auth = useAuthStore(pinia)
  if (to.meta.requiresAuth && !auth.token) {
    return { name: 'login', query: { redirect: to.fullPath } }
  }
  if (auth.token && !auth.user) {
    await auth.ensureBooted()
  }
  // 确保在 ensureBooted 之后再次校验受保护路由条件（处理本地过期 token 被清理的场景）
  if (to.meta.requiresAuth && (!auth.token || !auth.user)) {
    return { name: 'login', query: { redirect: to.fullPath } }
  }
  if (to.name === 'login' && auth.token) {
    const redirect = (to.query.redirect as string) || '/'
    return { path: redirect }
  }
  // 角色守卫：当路由声明 meta.roles 时，仅允许对应角色访问
  if (to.meta && (to.meta as any).roles) {
    const roles = Array.isArray((to.meta as any).roles) ? (to.meta as any).roles : [(to.meta as any).roles]
    const role = auth.user?.role
    if (role && !roles.includes(role)) {
      return { name: 'forbidden' }
    }
  }
  if (to.meta && (to.meta as any).title) {
    document.title = `青丝源 · ${(to.meta as any).title}`
  }
})

export default router
