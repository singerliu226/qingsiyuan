<template>
  <div class="wrap">
    <el-card>
      <h3>进货入库</h3>
      <el-form label-width="80px">
        <el-form-item label="原料">
          <el-select v-model="materialId" placeholder="选择原料" :loading="loadingList">
            <el-option v-for="m in materials" :key="m.id" :label="m.name" :value="m.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="数量(克)">
          <el-input-number v-model="grams" :min="1" />
        </el-form-item>
        <el-form-item label="成本(元)">
          <el-input-number v-model="cost" :min="0" />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" :loading="loading" @click="submit">提交入库</el-button>
        </el-form-item>
      </el-form>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import api from '../api/client'

const materials = reactive<any[]>([])
const materialId = ref('')
const grams = ref(0)
const cost = ref(0)
const loading = ref(false)
const loadingList = ref(false)

async function loadMaterials() {
  loadingList.value = true
  try {
    const { data } = await api.get('/materials')
    materials.splice(0, materials.length, ...data)
  } catch (e:any) {
    ElMessage.error(e?.response?.data?.error?.message || e.message || '加载原料失败')
  } finally {
    loadingList.value = false
  }
}

async function submit() {
  if (!materialId.value || grams.value <= 0) { ElMessage.warning('请完善原料与数量'); return }
  loading.value = true
  try {
    await api.post('/purchases', { materialId: materialId.value, grams: grams.value, cost: cost.value })
    ElMessage.success('入库成功')
    grams.value = 0
    cost.value = 0
  } catch (e:any) {
    ElMessage.error(e?.response?.data?.error?.message || e.message || '提交失败')
  } finally {
    loading.value = false
  }
}

onMounted(loadMaterials)
</script>

<style scoped>
.wrap { padding: 16px; }
</style>
