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
        <div class="extra">
          <el-button link type="primary" @click="openReset">找回密码</el-button>
        </div>
      </el-form>
    </el-card>
    <el-dialog v-model="reset.visible" title="找回密码" width="420px">
      <el-alert
        type="warning"
        show-icon
        title="需要店长提供“重置口令”"
        description="出于安全考虑，必须输入服务端配置的 PASSWORD_RESET_KEY 才能重置密码。"
        style="margin-bottom:12px;"
      />
      <el-form label-width="100px">
        <el-form-item label="手机号">
          <el-input v-model="reset.phone" placeholder="例如 13800000000" />
        </el-form-item>
        <el-form-item label="重置口令">
          <el-input v-model="reset.key" type="password" placeholder="店长提供" />
        </el-form-item>
        <el-form-item label="新密码">
          <el-input v-model="reset.pwd" type="password" placeholder="至少 6 位" />
        </el-form-item>
        <el-form-item label="确认密码">
          <el-input v-model="reset.pwd2" type="password" placeholder="再次输入" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="reset.visible=false">取消</el-button>
        <el-button type="primary" :loading="reset.loading" @click="doReset">确认重置</el-button>
      </template>
    </el-dialog>
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
import api from '../api/client'
// 在脚本中读取 import.meta，模板中仅使用普通变量，避免编译错误
const isDev = !!import.meta.env?.DEV

const auth = useAuthStore()
const router = useRouter()
const route = useRoute()
const loading = ref(false)
const form = reactive({ phone: '', password: '' })
const reset = reactive({ visible: false, loading: false, phone: '', key: '', pwd: '', pwd2: '' })

function openReset() {
  reset.visible = true
  reset.loading = false
  reset.phone = form.phone || ''
  reset.key = ''
  reset.pwd = ''
  reset.pwd2 = ''
}

/**
 * 找回密码提交。
 * 设计说明：
 * - 不自动登录：重置密码是高风险操作，完成后由用户自行用新密码登录，更符合审计与心理预期；
 * - 失败原因由后端返回（如未配置 PASSWORD_RESET_KEY / 口令不正确 / 手机号不存在）。
 */
async function doReset() {
  const phone = String(reset.phone || '').trim()
  const key = String(reset.key || '')
  const pwd = String(reset.pwd || '')
  if (!phone || !key || !pwd) {
    ElMessage.warning('请填写手机号、重置口令和新密码')
    return
  }
  if (pwd.length < 6) {
    ElMessage.warning('新密码长度至少 6 位')
    return
  }
  if (pwd !== String(reset.pwd2 || '')) {
    ElMessage.warning('两次输入的新密码不一致')
    return
  }
  reset.loading = true
  try {
    await api.post('/auth/reset-password', { phone, resetKey: key, newPassword: pwd })
    ElMessage.success('密码已重置，请使用新密码登录')
    reset.visible = false
  } catch (e: any) {
    const msg = e?.response?.data?.error?.message || e?.message || '重置失败'
    ElMessage.error(msg)
  } finally {
    reset.loading = false
  }
}

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
.extra { display:flex; justify-content:flex-end; margin-top: -6px; }
.fb { margin-top: 16px; padding: 12px; border:1px dashed #ccc; border-radius: 8px; max-width: 420px; width: 100%; }
.fb-title { font-size: 14px; margin-bottom: 8px; color:#666; }
.fb-row { display:flex; align-items:center; gap:8px; margin:6px 0; }
.fb-row label { width:64px; color:#555; }
.fb-row input { flex:1; padding:8px 10px; border:1px solid #ddd; border-radius:6px; }
.fb-actions { text-align:right; }
.fb-actions button { padding:8px 12px; }
</style>
