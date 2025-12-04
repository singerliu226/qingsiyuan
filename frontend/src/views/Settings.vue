<template>
  <div class="wrap">
    <el-tabs v-model="tab">
      <el-tab-pane label="店员管理" name="users" v-if="auth.user?.role==='owner'">
        <div class="actions">
          <el-button size="small" @click="openCreate">新增店员</el-button>
          <el-button size="small" @click="loadUsers">刷新</el-button>
        </div>
        <el-table :data="users" size="small">
          <el-table-column prop="name" label="姓名" />
          <el-table-column prop="phone" label="手机号" />
          <el-table-column prop="role" label="角色" />
          <el-table-column prop="status" label="状态" />
          <el-table-column label="操作" width="240">
            <template #default="{ row }">
              <el-button size="small" @click="openEdit(row)">编辑</el-button>
              <el-button size="small" @click="resetPwd(row)">重置密码</el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-tab-pane>
      <el-tab-pane label="修改密码" name="password">
        <el-form label-width="120px" style="max-width:420px;">
          <el-form-item label="当前密码">
            <el-input v-model="pwd.current" type="password" />
          </el-form-item>
          <el-form-item label="新密码">
            <el-input v-model="pwd.next" type="password" />
          </el-form-item>
          <el-form-item>
            <el-button type="primary" :loading="pwd.loading" @click="changePass">提交</el-button>
          </el-form-item>
        </el-form>
      </el-tab-pane>
      <el-tab-pane label="导出/备份" name="export">
        <div class="export">
          <el-button @click="download('csv')">导出订单 CSV</el-button>
          <el-button @click="download('xlsx')">导出订单 Excel</el-button>
          <el-divider direction="vertical" />
          <el-button v-if="auth.user?.role==='owner'" @click="backup" :loading="bk.loading">备份数据</el-button>
          <el-select v-if="auth.user?.role==='owner'" v-model="bk.file" placeholder="选择备份文件" style="width: 360px">
            <el-option v-for="f in bk.list" :key="f" :label="f" :value="f" />
          </el-select>
          <el-button v-if="auth.user?.role==='owner'" type="danger" @click="restore" :loading="bk.loading">从备份恢复</el-button>
        </div>
        <div v-if="auth.user?.role==='owner'" class="export">
          <input ref="uploadInput" type="file" accept="application/json" style="display:none" @change="onSelectBackupFile">
          <el-button :loading="bk.loading" @click="triggerUpload">上传备份 JSON 并恢复</el-button>
        </div>
        <div v-if="auth.user?.role==='owner'" class="export">
          <el-popconfirm title="确认将所有原料库存归零？此操作不可撤销" confirm-button-text="确认" cancel-button-text="取消" @confirm="zeroMaterials">
            <template #reference>
              <el-button type="warning">库存一键归零</el-button>
            </template>
          </el-popconfirm>
        </div>
        <div v-if="auth.user?.role==='owner'" class="export">
          <el-switch v-model="cfg.enabled" active-text="启用自动备份" @change="saveCfg" />
          <el-select v-model="cfg.hours" placeholder="频率(小时)" style="width: 160px" @change="saveCfg">
            <el-option :label="'每 6 小时'" :value="6" />
            <el-option :label="'每 12 小时'" :value="12" />
            <el-option :label="'每天'" :value="24" />
            <el-option :label="'每 2 天'" :value="48" />
          </el-select>
          <el-select v-model="cfg.retain" placeholder="保留份数" style="width: 160px" @change="saveCfg">
            <el-option :label="'保留 3 份'" :value="3" />
            <el-option :label="'保留 7 份'" :value="7" />
            <el-option :label="'保留 14 份'" :value="14" />
          </el-select>
        </div>
      </el-tab-pane>
      <el-tab-pane label="关于" name="about">
        <p>青丝源进销存助手</p>
        <p>版本：v0.1.0</p>
      </el-tab-pane>
    </el-tabs>

    <el-dialog v-model="dlg.visible" :title="dlg.mode==='create'?'新增店员':'编辑店员'" width="520px">
      <el-form label-width="100px">
        <el-form-item label="姓名"><el-input v-model="dlg.name" /></el-form-item>
        <el-form-item label="手机号"><el-input v-model="dlg.phone" /></el-form-item>
        <el-form-item label="角色">
          <el-select v-model="dlg.role">
            <el-option label="店长" value="owner" />
            <el-option label="店员" value="staff" />
          </el-select>
        </el-form-item>
        <el-form-item label="状态">
          <el-select v-model="dlg.status">
            <el-option label="启用" value="active" />
            <el-option label="停用" value="disabled" />
          </el-select>
        </el-form-item>
        <el-form-item v-if="dlg.mode==='create'" label="初始密码">
          <el-input v-model="dlg.password" type="password" placeholder="默认 123456" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dlg.visible=false">取消</el-button>
        <el-button type="primary" :loading="dlg.loading" @click="saveUser">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import api from '../api/client'
import { useAuthStore } from '../stores/auth'

const auth = useAuthStore()
const tab = ref(auth.user?.role==='owner' ? 'users' : 'password')
const users = reactive<any[]>([])
const dlg = reactive<any>({ visible:false, loading:false, mode:'create', id:'', name:'', phone:'', role:'staff', status:'active', password:'' })
const pwd = reactive<any>({ current:'', next:'', loading:false })
const bk = reactive<any>({ loading:false, file:'', list:[] as string[] })
const uploadInput = ref<HTMLInputElement | null>(null)
const cfg = reactive<any>({ enabled:false, hours:24, retain:7 })

async function loadUsers() {
  if (auth.user?.role !== 'owner') return
  const { data } = await api.get('/users')
  users.splice(0, users.length, ...data)
}

function openCreate() { Object.assign(dlg, { visible:true, loading:false, mode:'create', id:'', name:'', phone:'', role:'staff', status:'active', password:'' }) }
function openEdit(row:any) { Object.assign(dlg, { visible:true, loading:false, mode:'edit', id:row.id, name:row.name, phone:row.phone, role:row.role, status:row.status, password:'' }) }

async function saveUser() {
  dlg.loading = true
  try {
    if (dlg.mode === 'create') {
      await api.post('/users', { name: dlg.name, phone: dlg.phone, role: dlg.role, password: dlg.password })
    } else {
      await api.patch(`/users/${dlg.id}`, { name: dlg.name, phone: dlg.phone, role: dlg.role, status: dlg.status, ...(dlg.password ? { password: dlg.password } : {}) })
    }
    dlg.visible = false
    await loadUsers()
  } finally {
    dlg.loading = false
  }
}

async function resetPwd(row:any) {
  await api.patch(`/users/${row.id}`, { password: '123456' })
  ElMessage.success('已重置为 123456')
}

async function changePass() {
  if (!pwd.current || !pwd.next) { ElMessage.warning('请填写完整'); return }
  pwd.loading = true
  try {
    await api.post('/auth/change-password', { currentPassword: pwd.current, newPassword: pwd.next })
    ElMessage.success('修改成功')
    pwd.current = ''
    pwd.next = ''
  } finally {
    pwd.loading = false
  }
}

onMounted(() => { loadUsers(); loadBackupList(); loadCfg() })
async function download(fmt:'csv'|'xlsx') {
  try {
    const resp = await api.get('/reports/export', { params: { format: fmt }, responseType: 'blob' })
    const blob = resp.data as Blob
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = fmt === 'xlsx' ? 'orders.xlsx' : 'orders.csv'
    document.body.appendChild(a)
    a.click()
    URL.revokeObjectURL(url)
    a.remove()
  } catch (e:any) {
    const msg = e?.response?.data?.error?.message || e?.message || '导出失败'
    ElMessage.error(msg)
  }
}

async function backup() {
  bk.loading = true
  try {
    const { data } = await api.post('/admin/backup')
    bk.file = data.file
    await loadBackupList()
    ElMessage.success('备份成功')
  } finally {
    bk.loading = false
  }
}

async function restore() {
  if (!bk.file) { ElMessage.warning('请填写备份文件路径'); return }
  bk.loading = true
  try {
    await api.post('/admin/restore', { file: bk.file })
    ElMessage.success('恢复完成')
  } finally {
    bk.loading = false
  }
}

async function loadBackupList() {
  if (auth.user?.role !== 'owner') return
  const { data } = await api.get('/admin/backups')
  bk.list = data
}

async function loadCfg() {
  if (auth.user?.role !== 'owner') return
  const { data } = await api.get('/admin/backup-config')
  Object.assign(cfg, data)
}

async function saveCfg() {
  if (auth.user?.role !== 'owner') return
  await api.post('/admin/backup-config', cfg)
  ElMessage.success('自动备份配置已保存')
}

async function zeroMaterials() {
  if (auth.user?.role !== 'owner') return
  const { data } = await api.post('/admin/materials-zero')
  ElMessage.success(`已归零，共 ${data.count} 项原料`)
}

function triggerUpload() {
  if (!uploadInput.value) return
  uploadInput.value.value = ''
  uploadInput.value.click()
}

async function onSelectBackupFile(e: Event) {
  const input = e.target as HTMLInputElement
  const files = input.files
  if (!files || !files.length) return
  const file: File = files[0]!
  const reader = new FileReader()
  bk.loading = true
  reader.onload = async () => {
    try {
      const text = String(reader.result || '')
      await api.post('/admin/backup-upload', {
        name: file.name,
        content: text,
        apply: true
      })
      ElMessage.success('备份上传并恢复完成')
      await loadBackupList()
    } catch (err:any) {
      const msg = err?.response?.data?.error?.message || err?.message || '上传备份失败'
      ElMessage.error(msg)
    } finally {
      bk.loading = false
      if (uploadInput.value) uploadInput.value.value = ''
    }
  }
  reader.onerror = () => {
    bk.loading = false
    ElMessage.error('读取本地文件失败')
  }
  reader.readAsText(file, 'utf-8')
}
</script>

<style scoped>
.wrap { padding: 16px; }
.actions { display:flex; gap: 8px; margin-bottom: 8px; }
.export { display:flex; gap: 8px; }
</style>


