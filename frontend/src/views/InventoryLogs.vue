<template>
  <div class="wrap">
    <div class="top">
      <h3>库存流水</h3>
      <div class="actions">
        <el-select v-model="kind" placeholder="类型" style="width:120px">
          <el-option label="全部" value="" />
          <el-option label="存入" value="in" />
          <el-option label="取出" value="out" />
        </el-select>
        <el-date-picker v-model="range" type="daterange" range-separator="至" start-placeholder="开始日期" end-placeholder="结束日期" />
        <el-button @click="load">查询</el-button>
        <el-button type="primary" @click="exportXlsx" :loading="exporting">导出XLSX</el-button>
      </div>
    </div>
    <el-table :data="rows" size="small">
      <el-table-column prop="createdAt" label="时间" width="180">
        <template #default="{ row }">
          {{ formatTime(row.createdAt) }}
        </template>
      </el-table-column>
      <el-table-column label="类型" width="80">
        <template #default="{ row }">{{ row.kind === 'in' ? '存入' : '取出' }}</template>
      </el-table-column>
      <el-table-column label="对象">
        <template #default="{ row }">
          <span v-if="row.materialId">原料 - {{ row.materialName || row.materialId }}</span>
          <span v-else-if="row.productId">成品 - {{ row.productName || row.productId }}</span>
          <span v-else>—</span>
        </template>
      </el-table-column>
      <el-table-column label="数量" width="140">
        <template #default="{ row }">
          <span v-if="row.grams">{{ row.grams }} 克</span>
          <span v-else-if="row.packages">{{ row.packages }} 包</span>
          <span v-else>—</span>
        </template>
      </el-table-column>
      <el-table-column label="操作人">
        <template #default="{ row }">{{ row.operator || row.person || '—' }}</template>
      </el-table-column>
      <el-table-column v-if="isOwner" label="操作" width="140">
        <template #default="{ row }">
          <el-button
            v-if="canRevoke(row)"
            size="small"
            type="danger"
            @click="revoke(row)"
          >
            撤回
          </el-button>
          <span v-else>—</span>
        </template>
      </el-table-column>
    </el-table>
    <div class="pager">
      <el-pagination layout="prev, pager, next" :total="total" :current-page="page" :page-size="pageSize" @current-change="onPage" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref } from 'vue'
import api from '../api/client'
import { useAuthStore } from '../stores/auth'
import { ElMessage, ElMessageBox } from 'element-plus'

const rows = reactive<any[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)
const kind = ref('')
const materialId = ref('')
const range = ref<[Date, Date] | null>(null)
const exporting = ref(false)
const auth = useAuthStore()
const isOwner = auth.user?.role === 'owner'

/**
 * 将 ISO 时间串格式化为“年-月-日 时:分:秒”形式，便于业务人员在手机上快速理解。
 * 示例：2025-11-15T14:53:43.276Z -> 2025-11-15 14:53:43
 */
function formatTime(iso: string | Date): string {
  if (!iso) return ''
  const d = typeof iso === 'string' ? new Date(iso) : iso
  if (Number.isNaN(d.getTime())) return String(iso)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  const ss = String(d.getSeconds()).padStart(2, '0')
  return `${y}-${m}-${day} ${hh}:${mm}:${ss}`
}

async function load() {
  const params:any = { page: page.value, pageSize: pageSize.value }
  if (kind.value) params.kind = kind.value
  if (materialId.value) params.materialId = materialId.value
  if (range.value) { params.from = range.value[0].toISOString(); params.to = range.value[1].toISOString() }
  const { data } = await api.get('/inventory/logs', { params })
  total.value = data.total
  rows.splice(0, rows.length, ...data.data)
}

function onPage(p:number) { page.value = p; load() }

function canRevoke(row:any): boolean {
  return !!(row && row.id && row.refType && row.refId)
}

function revokeTitle(row:any): string {
  if (row.refType === 'purchase') return '撤回进货'
  if (row.refType === 'order') return '撤销订单'
  return '撤回流水'
}

function revokeHint(row:any): string {
  if (row.refType === 'purchase') {
    return '将回滚该笔进货的库存，并从进货记录中删除（报表成本也会同步修正）。'
  }
  if (row.refType === 'order') {
    return '将撤销该笔订单并回滚库存（仅支持 5 分钟内）。'
  }
  return '将写入一条对冲流水并回滚对应库存（不删除原流水，便于审计）。'
}

async function revoke(row:any) {
  if (!canRevoke(row)) return
  const ok = await ElMessageBox.confirm(
    `确认${revokeTitle(row)}？\n\n${revokeHint(row)}\n\n删除/撤回后不可恢复，请谨慎操作。`,
    revokeTitle(row),
    { type: 'warning', confirmButtonText: '确认撤回', cancelButtonText: '取消' },
  ).then(() => true).catch(() => false)
  if (!ok) return
  try {
    await api.post(`/inventory/logs/${row.id}/revoke`)
    ElMessage.success('已撤回')
    await load()
  } catch (e:any) {
    const msg = e?.response?.data?.error?.message || e?.message || '撤回失败'
    ElMessage.error(msg)
  }
}

async function exportXlsx() {
  exporting.value = true
  try {
    const params:any = {}
    if (kind.value) params.kind = kind.value
    if (materialId.value) params.materialId = materialId.value
    if (range.value) { params.from = range.value[0].toISOString(); params.to = range.value[1].toISOString() }
    const resp = await api.get('/inventory/logs/export', { params, responseType: 'blob' })
    const blob = resp.data as Blob
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `inventory-logs.${new Date().toISOString().slice(0,10)}.xlsx`
    document.body.appendChild(a)
    a.click()
    URL.revokeObjectURL(url)
    a.remove()
  } catch (e:any) {
    const msg = e?.response?.data?.error?.message || e?.message || '导出失败'
    ElMessage.error(msg)
  } finally {
    exporting.value = false
  }
}

load()
</script>

<style scoped>
.wrap { padding: 16px; }
.top { display:flex; align-items:center; justify-content:space-between; margin-bottom: 8px; gap: 8px; }
.actions { display:flex; align-items:center; gap: 8px; }
.pager { display:flex; justify-content:flex-end; margin-top: 8px; }
</style>


