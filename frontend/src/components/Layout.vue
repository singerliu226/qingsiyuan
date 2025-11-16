<template>
  <div class="layout">
    <a href="#main" class="skip-link">跳到主内容</a>
    <header class="topbar">
      <!-- 移动端功能菜单开关：仅在小屏显示，点击展开/收起功能列表 -->
      <button
        class="menu-toggle"
        type="button"
        aria-label="打开功能菜单"
        @click="toggleMobileMenu"
      >
        <span class="menu-label">功能</span>
        <span class="menu-icon">
          <span />
          <span />
          <span />
        </span>
      </button>
      <div class="brand">青丝源助手</div>
      <div class="spacer" />
      <el-button link type="danger" @click="logout" aria-label="退出登录">退出</el-button>
    </header>

    <!-- 移动端功能抽屉菜单：只在小屏幕使用，PC 端不显示 -->
    <div
      v-if="mobileMenuVisible"
      class="mobile-menu-backdrop"
      @click.self="closeMobileMenu"
    >
      <nav class="mobile-menu-panel" aria-label="功能菜单">
        <button
          v-for="item in mobileNavItems"
          :key="item.path"
          type="button"
          class="mobile-menu-item"
          :aria-current="is(item.path) ? 'page' : undefined"
          @click="onMobileNavClick(item.path)"
        >
          {{ item.label }}
        </button>
      </nav>
    </div>

    <main id="main" tabindex="-1" ref="mainRef">
      <router-view />
    </main>

    <!-- 桌面端侧边导航，移动端隐藏；保持原有行为不变 -->
    <nav class="tabbar" aria-label="主导航">
      <el-button :aria-current="is('/') ? 'page' : undefined" :type="is('/')" text @click="go('/')">首页</el-button>
      <el-button :aria-current="is('/purchases') ? 'page' : undefined" :type="is('/purchases')" text @click="go('/purchases')">进货</el-button>
      <el-button :aria-current="is('/outbound') ? 'page' : undefined" :type="is('/outbound')" text @click="go('/outbound')">取货</el-button>
      <el-button :aria-current="is('/materials') ? 'page' : undefined" :type="is('/materials')" text @click="go('/materials')">库存</el-button>
      <el-button :aria-current="is('/inventory-logs') ? 'page' : undefined" :type="is('/inventory-logs')" text @click="go('/inventory-logs')">流水</el-button>
      <el-button :aria-current="is('/products') ? 'page' : undefined" :type="is('/products')" text @click="go('/products')">产品</el-button>
      <el-button v-if="auth.user?.role === 'owner'" :aria-current="is('/pricing') ? 'page' : undefined" :type="is('/pricing')" text @click="go('/pricing')">定价</el-button>
      <el-button :aria-current="is('/stats') ? 'page' : undefined" :type="is('/stats')" text @click="go('/stats')">统计</el-button>
      <el-button v-if="auth.user?.role === 'owner'" :aria-current="is('/settings') ? 'page' : undefined" :type="is('/settings')" text @click="go('/settings')">设置</el-button>
    </nav>
  </div>
</template>

<script setup lang="ts">
import { useRouter, useRoute } from 'vue-router'
import { computed, onMounted, ref, watch } from 'vue'
import { useAuthStore } from '../stores/auth'

const router = useRouter()
const route = useRoute()
const auth = useAuthStore()
const mainRef = ref<HTMLElement | null>(null)
const mobileMenuVisible = ref(false)

type NavItem = { path: string; label: string; ownerOnly?: boolean }

const baseNavItems: NavItem[] = [
  { path: '/', label: '首页' },
  { path: '/purchases', label: '进货' },
  { path: '/outbound', label: '取货' },
  { path: '/materials', label: '库存' },
  { path: '/inventory-logs', label: '流水' },
  { path: '/products', label: '产品' },
  { path: '/pricing', label: '定价', ownerOnly: true },
  { path: '/stats', label: '统计' },
  { path: '/settings', label: '设置', ownerOnly: true },
]

const mobileNavItems = computed(() => {
  const isOwner = auth.user?.role === 'owner'
  return baseNavItems.filter((item) => !item.ownerOnly || isOwner)
})

function go(path: string) {
  router.push(path)
}

function is(path: string) {
  return route.path === path ? 'primary' : undefined
}

function logout() {
  auth.logout()
  router.replace('/login')
}

function toggleMobileMenu() {
  mobileMenuVisible.value = !mobileMenuVisible.value
}

function closeMobileMenu() {
  mobileMenuVisible.value = false
}

function onMobileNavClick(path: string) {
  mobileMenuVisible.value = false
  router.push(path)
}

onMounted(() => {
  watch(
    () => route.fullPath,
    () => {
      // 路由变化时自动收起移动端菜单，并把焦点回到主内容区域
      mobileMenuVisible.value = false
      setTimeout(() => mainRef.value?.focus(), 0)
    },
    { immediate: true },
  )
})
</script>

<style scoped>
.layout { min-height: 100vh; padding-bottom: 56px; }
.skip-link { position:absolute; left:-9999px; top:auto; width:1px; height:1px; overflow:hidden; }
.skip-link:focus { position:static; width:auto; height:auto; padding:6px 10px; background:#000; color:#fff; }
.topbar { position: sticky; top: 0; z-index: 20; display:flex; align-items:center; gap:12px; padding:8px 12px; border-bottom:1px solid var(--qs-border); background:var(--qs-surface); }
.menu-toggle {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border: none;
  background: transparent;
  padding: 4px 6px;
  margin-right: 4px;
  color: var(--qs-text);
  font-size: 14px;
}
.menu-label { font-weight: 500; }
.menu-icon {
  display: inline-flex;
  flex-direction: column;
  gap: 2px;
}
.menu-icon span {
  display: block;
  width: 14px;
  height: 2px;
  border-radius: 999px;
  background: var(--qs-text);
}
.brand { font-weight: 600; }
.spacer { flex: 1; }
main { padding: 12px; }
.tabbar {
  display: none; /* 默认在移动端隐藏，PC 端通过媒体查询启用 */
}

.mobile-menu-backdrop {
  position: fixed;
  inset: 0;
  z-index: 15;
  background: rgba(0, 0, 0, 0.35);
}

.mobile-menu-panel {
  position: absolute;
  top: 52px;
  left: 8px;
  right: 8px;
  max-width: 260px;
  background: #fff;
  border-radius: 8px;
  box-shadow: var(--qs-shadow);
  padding: 8px 0;
}

.mobile-menu-item {
  width: 100%;
  border: none;
  background: transparent;
  padding: 10px 16px;
  text-align: left;
  font-size: 14px;
  color: var(--qs-text);
}

.mobile-menu-item[aria-current='page'] {
  font-weight: 600;
  background: var(--qs-surface-muted);
}

@media (min-width: 960px) {
  .layout { padding-left: 200px; padding-bottom: 0; }
  .tabbar {
    position: fixed;
    left: 0;
    top: 0;
    bottom: 0;
    width: 200px;
    height: 100vh;
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 12px 8px;
    border-top: none;
    border-right: 1px solid var(--qs-border);
    background: var(--qs-surface);
  }
  main { margin-left: 0; padding: 16px; }
  .topbar { position: static; }
  .menu-toggle { display: none; }
  .mobile-menu-backdrop { display: none; }
  }
}
</style>


