<template>
  <div class="wrap">
    <el-result icon="warning" title="无权限访问" sub-title="请联系店长为你授权或切换账号">
      <template #extra>
        <el-button type="primary" @click="$router.replace('/')">返回首页</el-button>
      </template>
    </el-result>
  </div>
  </template>

<script setup lang="ts">
</script>

<style scoped>
.wrap { padding: 24px; }
</style>






