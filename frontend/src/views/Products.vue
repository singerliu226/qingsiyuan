<template>
  <div class="wrap">
    <div class="top">
      <h3>产品与配方</h3>
      <div class="actions">
        <el-button size="small" @click="openCreate">新建产品</el-button>
        <el-button size="small" @click="load">刷新</el-button>
      </div>
    </div>

    <el-skeleton :loading="loading" animated :count="3">
      <template #template>
        <el-skeleton-item variant="text" style="width: 40%" />
        <el-skeleton-item variant="text" style="width: 60%" />
        <el-skeleton-item variant="text" style="width: 80%" />
      </template>
      <template #default>
        <el-empty v-if="!rows.length && !loading && !errorMsg" description="暂无产品数据" />
        <el-table v-else :data="rows" size="small">
          <el-table-column prop="name" label="产品" />
          <el-table-column prop="priceBase" label="基础价" />
          <el-table-column label="配方">
            <template #default="{ row }">
              <div>
                <div v-for="item in row.recipe" :key="item.materialId">{{ matName(item.materialId) }}：{{ item.grams }}g</div>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="220">
            <template #default="{ row }">
              <el-button size="small" @click="openEdit(row)">编辑</el-button>
              <el-button size="small" @click="openUsage(row)">调用记录</el-button>
            </template>
          </el-table-column>
        </el-table>
      </template>
    </el-skeleton>

    <el-dialog v-model="dlg.visible" title="新建产品" width="520px">
      <el-form label-width="80px">
        <el-form-item label="名称">
          <el-input v-model="dlg.name" />
        </el-form-item>
        <el-form-item label="基础价">
          <el-input-number v-model="dlg.priceBase" :min="0" />
        </el-form-item>
        <el-form-item label="配方">
          <div class="recipe">
            <div v-for="(r,i) in dlg.recipe" :key="i" class="recipe-row">
              <el-select v-model="r.materialId" placeholder="原料" style="width: 200px">
                <el-option v-for="m in materials" :key="m.id" :label="m.name" :value="m.id" />
              </el-select>
              <el-input-number v-model="r.grams" :min="1" />
              <el-button link type="danger" @click="dlg.recipe.splice(i,1)">删除</el-button>
            </div>
            <el-button size="small" @click="dlg.recipe.push({ materialId:'', grams: 1 })">添加原料</el-button>
          </div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dlg.visible=false">取消</el-button>
        <el-button v-if="!dlg.id" type="primary" :loading="dlg.loading" @click="create">创建</el-button>
        <el-button v-else type="primary" :loading="dlg.loading" @click="saveEdit">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="usage.visible" title="调用记录" width="600px">
      <div style="margin-bottom:8px;">最近 20 条 · 次数：{{ usage.count }} · 总数量：{{ usage.totalQty }}</div>
      <el-table :data="usage.rows" size="small">
        <el-table-column prop="createdAt" label="时间" width="180" />
        <el-table-column prop="qty" label="数量" width="80" />
        <el-table-column prop="receivable" label="应收" width="100" />
        <el-table-column prop="id" label="订单ID" />
      </el-table>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref } from 'vue'
import api from '../api/client'

const rows = reactive<any[]>([])
const materials = reactive<any[]>([])
const loading = ref(false)
const errorMsg = ref('')
const dlg = reactive<any>({ visible:false, loading:false, id:'', name:'', priceBase:0, recipe:[] as Array<{materialId:string; grams:number}> })
const usage = reactive<any>({ visible:false, loading:false, rows:[], count:0, totalQty:0 })

function matName(id:string) { return materials.find(m => m.id === id)?.name || id }

async function load() {
  loading.value = true
  errorMsg.value = ''
  try {
    const [prods, mats] = await Promise.all([api.get('/products'), api.get('/materials')])
    rows.splice(0, rows.length, ...prods.data)
    materials.splice(0, materials.length, ...mats.data)
  } catch (e:any) {
    errorMsg.value = e?.response?.data?.error?.message || e.message || '加载失败'
    ElMessage.error(errorMsg.value)
  } finally {
    loading.value = false
  }
}

function openCreate() {
  dlg.visible = true
  dlg.id = ''
  dlg.name = ''
  dlg.priceBase = 0
  dlg.recipe = []
}

async function create() {
  dlg.loading = true
  try {
    const payload = { name: dlg.name, priceBase: dlg.priceBase, recipe: dlg.recipe }
    await api.post('/products', payload)
    dlg.visible = false
    await load()
  } finally {
    dlg.loading = false
  }
}

function openEdit(row:any) {
  dlg.visible = true
  dlg.id = row.id
  dlg.name = row.name
  dlg.priceBase = row.priceBase
  dlg.recipe = row.recipe.map((r:any) => ({ ...r }))
}

async function saveEdit() {
  dlg.loading = true
  try {
    const payload:any = { name: dlg.name, priceBase: dlg.priceBase, recipe: dlg.recipe }
    await api.patch(`/products/${dlg.id}`, payload)
    dlg.visible = false
    await load()
  } finally {
    dlg.loading = false
  }
}

async function openUsage(row:any) {
  usage.visible = true
  usage.loading = true
  try {
    const { data } = await api.get(`/products/${row.id}/usage`)
    usage.count = data.count
    usage.totalQty = data.totalQty
    usage.rows = data.recent
  } finally {
    usage.loading = false
  }
}

load()
</script>

<style scoped>
.wrap { padding: 16px; }
.top { display:flex; align-items:center; justify-content:space-between; margin-bottom: 8px; }
.recipe { display:flex; flex-direction: column; gap: 8px; }
.recipe-row { display:flex; align-items:center; gap: 8px; }
</style>
