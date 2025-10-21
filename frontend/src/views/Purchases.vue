<template>
  <div class="wrap">
    <el-card>
      <h3>进货入库</h3>
      <div class="ops">
        <el-button size="small" @click="loadMaterials">刷新原料</el-button>
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
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { useRoute } from 'vue-router'
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
        tableData.unshift(row)
      }
    }
  } catch (e:any) {
    ElMessage.error(e?.response?.data?.error?.message || e.message || '加载原料失败')
  } finally {
    loadingList.value = false
  }
}

/**
 * 批量提交：仅提交 grams>0 的行；后端将写入库存与流水，并记录操作人。
 */
async function submitBatch() {
  const items = tableData.filter(r => Number(r.grams) > 0).map(r => ({ materialId: r.id, grams: Number(r.grams), cost: Number(r.cost||0), operator: r.operator }))
  if (!items.length) { ElMessage.warning('请至少填写一行入库数量'); return }
  submitting.value = true
  try {
    await api.post('/purchases/batch', { items })
    ElMessage.success('批量入库成功')
    // 重置数量与成本
    for (const r of tableData) { r.grams = 0; r.cost = 0; r.operator = '' }
  } catch (e:any) {
    ElMessage.error(e?.response?.data?.error?.message || e.message || '提交失败')
  } finally {
    submitting.value = false
  }
}

onMounted(loadMaterials)
</script>

<style scoped>
 .wrap { padding: 16px; }
 .ops { display:flex; gap: 8px; margin-bottom: 8px; }
</style>
