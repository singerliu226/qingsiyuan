<!--
  PWA 更新提示组件
  - 当 Service Worker 检测到新版本时，显示底部通知条，引导用户刷新
  - 使用 vite-plugin-pwa 提供的 virtual:pwa-register/vue 模块
  - 关闭按钮仅隐藏当前提示，下次打开仍会提示
-->
<template>
  <div v-if="needRefresh" class="pwa-toast" role="alert" aria-live="assertive">
    <div class="pwa-toast__content">
      <span class="pwa-toast__icon">🔄</span>
      <span class="pwa-toast__text">发现新版本，刷新后即可使用</span>
    </div>
    <div class="pwa-toast__actions">
      <button class="pwa-toast__btn pwa-toast__btn--primary" @click="updateServiceWorker()">
        立即刷新
      </button>
      <button class="pwa-toast__btn pwa-toast__btn--secondary" @click="close">
        稍后
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 引入 vite-plugin-pwa 的 Vue composable
 * - needRefresh: 是否有新版本等待激活
 * - updateServiceWorker: 激活新 SW 并刷新页面
 */
import { useRegisterSW } from 'virtual:pwa-register/vue'

const {
  needRefresh,
  updateServiceWorker,
} = useRegisterSW({
  /**
   * 每 60 分钟自动检查一次更新
   * 适合部署到闺蜜机等长时间运行的场景
   */
  immediate: true,
  onRegisteredSW(_swUrl, registration) {
    if (registration) {
      setInterval(() => {
        registration.update()
      }, 60 * 60 * 1000) // 每小时检查一次
    }
  },
})

/** 关闭提示（不刷新） */
function close() {
  needRefresh.value = false
}
</script>

<style scoped>
.pwa-toast {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px;
  background: #1a1a2e;
  color: #fff;
  box-shadow: 0 -2px 12px rgba(0, 0, 0, 0.15);
  animation: slideUp 0.3s ease-out;
}

@keyframes slideUp {
  from { transform: translateY(100%); }
  to   { transform: translateY(0); }
}

.pwa-toast__content {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
}

.pwa-toast__icon {
  font-size: 20px;
  flex-shrink: 0;
}

.pwa-toast__text {
  font-size: 14px;
  line-height: 1.4;
}

.pwa-toast__actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}

.pwa-toast__btn {
  border: none;
  border-radius: 6px;
  padding: 8px 16px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  transition: opacity 0.2s;
}

.pwa-toast__btn:active {
  opacity: 0.8;
}

.pwa-toast__btn--primary {
  background: #16a34a;
  color: #fff;
}

.pwa-toast__btn--secondary {
  background: rgba(255, 255, 255, 0.15);
  color: #fff;
}
</style>
