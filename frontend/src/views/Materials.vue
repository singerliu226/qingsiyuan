<template>
  <div class="wrap">
    <div class="top">
      <h3>原料列表</h3>
      <div class="actions">
        <el-input v-model="q" placeholder="按名称搜索" size="small" style="width: 200px" @keyup.enter.native="onSearch" />
        <el-select v-model="sortKey" size="small" style="width: 160px">
          <el-option label="按名称" value="name" />
          <el-option label="按库存" value="stock" />
          <el-option label="按阈值" value="threshold" />
        </el-select>
        <el-select v-model="sortDir" size="small" style="width: 120px">
          <el-option label="升序" value="asc" />
          <el-option label="降序" value="desc" />
        </el-select>
        <el-button size="small" @click="onSearch">查询</el-button>
      </div>
    </div>
    <el-skeleton :loading="loading" animated :count="3">
      <template #template>
        <el-skeleton-item variant="text" style="width: 40%" />
        <el-skeleton-item variant="text" style="width: 60%" />
        <el-skeleton-item variant="text" style="width: 80%" />
      </template>
      <template #default>
        <el-empty v-if="!rows.length && !loading && !errorMsg" description="暂无原料数据" />
        <el-table v-else :data="rows" size="small">
          <el-table-column prop="name" label="原料" />
          <el-table-column prop="stock" label="库存(克)" />
          <el-table-column prop="threshold" label="预警阈值(克)" />
          <el-table-column label="状态">
            <template #default="{ row }">
              <el-tag :type="row.stock < row.threshold ? 'danger' : 'success'">{{ row.stock < row.threshold ? '预警' : '正常' }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="260">
            <template #default="{ row }">
              <el-button size="small" @click="openEdit(row)">设置阈值</el-button>
              <el-button size="small" type="primary" @click="gotoInbound(row)">增加库存</el-button>
            </template>
          </el-table-column>
        </el-table>
      </template>
    </el-skeleton>

    <div class="pager">
      <el-pagination layout="prev, pager, next" :total="total" :page-size="pageSize" :current-page="page" @current-change="onPage" />
    </div>

    <el-dialog v-model="dlg.visible" title="设置预警阈值" width="360px">
      <el-form>
        <el-form-item label="阈值(克)">
          <el-input-number v-model="dlg.threshold" :min="0" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dlg.visible=false">取消</el-button>
        <el-button type="primary" :loading="dlg.loading" @click="save">保存</el-button>
      </template>
    </el-dialog>

    
  </div>
</template>

<script setup lang="ts">
import { reactive, ref } from 'vue'
import api from '../api/client'

const rows = reactive<any[]>([])
const loading = ref(false)
const errorMsg = ref('')
const q = ref('')
const sortKey = ref<'name'|'stock'|'threshold'>('name')
const sortDir = ref<'asc'|'desc'>('asc')
const page = ref(1)
const pageSize = ref(10)
const total = ref(0)
const dlg = reactive<{ visible:boolean; loading:boolean; id:string; threshold:number }>({ visible:false, loading:false, id:'', threshold:0 })
import { useRouter } from 'vue-router'
const router = useRouter()

async function load() {
  loading.value = true
  errorMsg.value = ''
  try {
    const { data } = await api.get('/materials')
    let items = data as any[]
    if (q.value) items = items.filter(i => String(i.name).includes(q.value))
    items.sort((a:any, b:any) => {
      const k = sortKey.value
      const av = a[k]
      const bv = b[k]
      if (av === bv) return 0
      const r = av > bv ? 1 : -1
      return sortDir.value === 'asc' ? r : -r
    })
    total.value = items.length
    const start = (page.value - 1) * pageSize.value
    rows.splice(0, rows.length, ...items.slice(start, start + pageSize.value))
  } catch (e:any) {
    errorMsg.value = e?.response?.data?.error?.message || e.message || '加载失败'
    ElMessage.error(errorMsg.value)
  } finally {
    loading.value = false
  }
}

function onSearch() { page.value = 1; load() }
function onPage(p:number) { page.value = p; load() }

function openEdit(row:any) {
  dlg.visible = true
  dlg.id = row.id
  dlg.threshold = row.threshold || 0
}

function gotoInbound(row:any) { router.push({ path: '/purchases', query: { materialId: row.id } }) }

async function save() {
  dlg.loading = true
  try {
    await api.patch(`/materials/${dlg.id}`, { threshold: dlg.threshold })
    await load()
    dlg.visible = false
  } finally {
    dlg.loading = false
  }
}

// 入库流程已改为跳转“进货”模块

load()
</script>

<style scoped>
.wrap { padding: 16px; }
.top { display:flex; align-items:center; justify-content:space-between; margin-bottom: 8px; }
.actions { display:flex; align-items:center; gap: 8px; }
.pager { display:flex; justify-content:flex-end; margin-top: 8px; }
</style>
