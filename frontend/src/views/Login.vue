<template>
  <div class="login-wrap">
    <el-card class="login-card">
      <h2 class="title">青丝源进销存助手</h2>
      <el-form :model="form" @keyup.enter="onSubmit" label-width="0">
        <el-form-item>
          <el-input v-model="form.phone" placeholder="手机号" size="large" />
        </el-form-item>
        <el-form-item>
          <el-input v-model="form.password" type="password" placeholder="密码" size="large" />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" size="large" class="full" :loading="loading" @click="onSubmit">登录</el-button>
        </el-form-item>
      </el-form>
    </el-card>
    <!-- Fallback（开发专用）：当 UI 组件异常未渲染时，使用原生表单保证可登录 -->
    <div class="fb" v-if="isDev">
      <div class="fb-title">调试备用登录</div>
      <div class="fb-row"><label>手机号</label><input v-model.trim="form.phone" placeholder="13800000000" /></div>
      <div class="fb-row"><label>密码</label><input v-model="form.password" type="password" placeholder="123456" /></div>
      <div class="fb-actions"><button @click="onSubmit" :disabled="loading">登录</button></div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { ElMessage } from 'element-plus'
// 在脚本中读取 import.meta，模板中仅使用普通变量，避免编译错误
const isDev = !!import.meta.env?.DEV

const auth = useAuthStore()
const router = useRouter()
const route = useRoute()
const loading = ref(false)
const form = reactive({ phone: '', password: '' })

async function onSubmit() {
  if (!form.phone || !form.password) return
  loading.value = true
  try {
    ;(window as any).__debugNote?.('submit login')
    await auth.login(form.phone, form.password)
    const redirect = (route.query.redirect as string) || '/'
    router.replace(redirect)
    ;(window as any).__debugNote?.('login ok, redirecting')
  } catch (e: any) {
    const msg = e?.response?.data?.error?.message || e?.message || '登录失败'
    ElMessage.error(msg)
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.login-wrap { display:flex; align-items:center; justify-content:center; min-height:100vh; padding:24px; }
.login-card { width: 100%; max-width: 420px; }
.title { text-align:center; margin-bottom: 16px; }
.full { width: 100%; }
.fb { margin-top: 16px; padding: 12px; border:1px dashed #ccc; border-radius: 8px; max-width: 420px; width: 100%; }
.fb-title { font-size: 14px; margin-bottom: 8px; color:#666; }
.fb-row { display:flex; align-items:center; gap:8px; margin:6px 0; }
.fb-row label { width:64px; color:#555; }
.fb-row input { flex:1; padding:8px 10px; border:1px solid #ddd; border-radius:6px; }
.fb-actions { text-align:right; }
.fb-actions button { padding:8px 12px; }
</style>
