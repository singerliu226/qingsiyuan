<script setup lang="ts">
import Layout from './components/Layout.vue'
</script>

<template>
  <Layout />
  
</template>

<style>
/* 统一排版基线，避免全局居中导致内容不显示 */
html, body, #app { height: 100%; }
body { margin: 0; }
:root { font-size: clamp(14px, 2vw, 18px); }
</style>
