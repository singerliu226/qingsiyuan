<template>
  <div class="wrap">
    <el-card>
      <h3>进货入库</h3>
      <div class="ops">
        <el-button size="small" @click="loadMaterials">刷新原料</el-button>
        <el-button size="small" @click="loadProducts">刷新成品</el-button>
        <el-button type="primary" :loading="submitting" @click="submitBatch">提交批量入库</el-button>
      </div>

      <el-table :data="tableData" v-loading="loadingList" size="small">
        <el-table-column prop="name" label="原料" width="180" />
        <el-table-column label="本次入库(克)" width="180">
          <template #default="{ row }">
            <el-input-number v-model="row.grams" :min="0" />
          </template>
        </el-table-column>
        <el-table-column label="成本(元)" width="160">
          <template #default="{ row }">
            <el-input-number v-model="row.cost" :min="0" />
          </template>
        </el-table-column>
        <el-table-column label="操作人" width="200">
          <template #default="{ row }">
            <el-input v-model="row.operator" placeholder="可留空默认当前用户" />
          </template>
        </el-table-column>
      </el-table>

      <h4 style="margin-top:16px;">成品入库（将原料按配方转为成品库存）</h4>
      <el-table :data="productRows" v-loading="productLoading" size="small">
        <el-table-column prop="name" label="成品" width="200" />
        <el-table-column label="本次入库(包数)" width="200">
          <template #default="{ row }">
            <el-input-number v-model="row.qty" :min="0" />
          </template>
        </el-table-column>
        <el-table-column label="操作人" width="200">
          <template #default="{ row }">
            <el-input v-model="row.operator" placeholder="可留空默认当前用户" />
          </template>
        </el-table-column>
      </el-table>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'
import api from '../api/client'

/**
 * 批量进货视图
 * 设计：
 * - 使用表格列出全部原料，每行输入本次入库克数、成本与操作人。
 * - 点击提交时，仅提交 grams>0 的项目，以减少空提交负担。
 * - 若从“库存”页跳转会携带 query.materialId，则将该行置顶便于快速输入。
 */

// 原料及表格行
const materials = reactive<any[]>([])
const tableData = reactive<Array<{ id:string; name:string; grams:number; cost:number; operator:string }>>([])
const loadingList = ref(false)
const submitting = ref(false)
const route = useRoute()

// 成品入库
const products = reactive<any[]>([])
const productRows = reactive<Array<{ id:string; name:string; qty:number; operator:string }>>([])
const productLoading = ref(false)

/**
 * 加载原料并构建表格数据；若存在路由 query.materialId，则将对应行置顶方便输入。
 */
async function loadMaterials() {
  loadingList.value = true
  try {
    const { data } = await api.get('/materials')
    materials.splice(0, materials.length, ...data)
    const map = new Map<string, any>(materials.map((m:any) => [m.id, m]))
    tableData.splice(0, tableData.length, ...materials.map((m:any) => ({ id:m.id, name:m.name, grams:0, cost:0, operator:'' })))
    const prefer = String(route.query.materialId || '')
    if (prefer && map.has(prefer)) {
      const idx = tableData.findIndex(r => r.id === prefer)
      if (idx > 0) {
        const [row] = tableData.splice(idx, 1)
        if (row) tableData.unshift(row)
      }
    }
  } catch (e:any) {
    ElMessage.error(e?.response?.data?.error?.message || e.message || '加载原料失败')
  } finally {
    loadingList.value = false
  }
}

async function loadProducts() {
  productLoading.value = true
  try {
    const { data } = await api.get('/products')
    products.splice(0, products.length, ...data)
    productRows.splice(0, productRows.length, ...products.map((p:any) => ({ id:p.id, name:p.name, qty:0, operator:'' })))
    const prefer = String(route.query.productId || '')
    if (prefer) {
      const idx = productRows.findIndex(r => r.id === prefer)
      if (idx > 0) {
        const [row] = productRows.splice(idx, 1)
        if (row) productRows.unshift(row)
      }
    }
  } catch (e:any) {
    ElMessage.error(e?.response?.data?.error?.message || e.message || '加载成品失败')
  } finally {
    productLoading.value = false
  }
}

/**
 * 批量提交：仅提交 grams>0 的行；后端将写入库存与流水，并记录操作人。
 */
async function submitBatch() {
  const items = tableData.filter(r => Number(r.grams) > 0).map(r => ({ materialId: r.id, grams: Number(r.grams), cost: Number(r.cost||0), operator: r.operator }))
  const produceItems = productRows.filter(r => Number(r.qty) > 0).map(r => ({ productId: r.id, qty: Number(r.qty), operator: r.operator }))
  if (!items.length && !produceItems.length) { ElMessage.warning('请至少填写一行入库数量'); return }
  submitting.value = true
  try {
    if (items.length) {
      await api.post('/purchases/batch', { items })
    }
    if (produceItems.length) {
      await api.post('/inventory/produce', { items: produceItems })
    }
    ElMessage.success('批量入库成功')
    // 重置数量与成本
    for (const r of tableData) { r.grams = 0; r.cost = 0; r.operator = '' }
    for (const r of productRows) { r.qty = 0; r.operator = '' }
  } catch (e:any) {
    ElMessage.error(e?.response?.data?.error?.message || e.message || '提交失败')
  } finally {
    submitting.value = false
  }
}

onMounted(() => { loadMaterials(); loadProducts() })
</script>

<style scoped>
 .wrap { padding: 16px; }
 .ops { display:flex; gap: 8px; margin-bottom: 8px; }
</style>
