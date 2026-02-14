<script setup lang="ts">
import Layout from './components/Layout.vue'
import ReloadPrompt from './components/ReloadPrompt.vue'
</script>

<template>
  <Layout />
  <!-- PWA 更新提示：新版本就绪时在底部弹出通知 -->
  <ReloadPrompt />
</template>

<style>
/* 统一排版基线，避免全局居中导致内容不显示 */
html, body, #app { height: 100%; }
body { margin: 0; }
:root { font-size: clamp(14px, 2vw, 18px); }
</style>
