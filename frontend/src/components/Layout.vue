<template>
  <div class="layout">
    <a href="#main" class="skip-link">跳到主内容</a>
    <header class="topbar">
      <div class="brand">青丝源助手</div>
      <div class="spacer" />
      <el-button link type="danger" @click="logout" aria-label="退出登录">退出</el-button>
    </header>
    <main id="main" tabindex="-1" ref="mainRef">
      <router-view />
    </main>
    <nav class="tabbar">
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
import { onMounted, ref, watch } from 'vue'
import { useAuthStore } from '../stores/auth'

const router = useRouter()
const route = useRoute()
const auth = useAuthStore()
const mainRef = ref<HTMLElement | null>(null)

function go(path: string) { router.push(path) }
function is(path: string) { return route.path === path ? 'primary' : undefined }
function logout() { auth.logout(); router.replace('/login') }

onMounted(() => {
  watch(() => route.fullPath, () => { setTimeout(() => mainRef.value?.focus(), 0) }, { immediate: true })
})
</script>

<style scoped>
.layout { min-height: 100vh; padding-bottom: 56px; }
.skip-link { position:absolute; left:-9999px; top:auto; width:1px; height:1px; overflow:hidden; }
.skip-link:focus { position:static; width:auto; height:auto; padding:6px 10px; background:#000; color:#fff; }
.topbar { position: sticky; top: 0; z-index: 10; display:flex; align-items:center; gap:12px; padding:8px 12px; border-bottom:1px solid var(--qs-border); background:var(--qs-surface); }
.brand { font-weight: 600; }
.spacer { flex: 1; }
main { padding: 12px; }
.tabbar { position: fixed; left:0; right:0; bottom:0; height:56px; display:flex; align-items:center; justify-content:space-around; border-top:1px solid var(--qs-border); background:var(--qs-surface); }
@media (min-width: 960px) {
  .layout { padding-left: 200px; padding-bottom: 0; }
  .tabbar { position: fixed; left:0; top:0; bottom:0; width:200px; height: 100vh; flex-direction: column; gap:8px; border-top:none; border-right:1px solid var(--qs-border); }
  main { margin-left: 0; padding: 16px; }
  .topbar { position: static; }
}
</style>


