<template>
  <div class="home-wrap">
    <div class="top">
      <h2>欢迎，{{ auth.user?.name }}</h2>
      <el-button type="danger" link @click="logout">退出登录</el-button>
    </div>

    <div class="quick">
      <el-button type="primary" @click="$router.push('/outbound')">取货登记</el-button>
      <el-button v-if="auth.user?.role === 'owner'" @click="$router.push('/pricing')">定价策略</el-button>
      <el-button @click="loadStats">刷新统计</el-button>
    </div>

    <el-row :gutter="16">
      <el-col :xs="24" :md="8" :xl="6">
        <el-card>
          <div class="kpi">
            <div>今日应收</div>
            <div class="num">¥ {{ stats.receivableTotal.toFixed(2) }}</div>
          </div>
        </el-card>
      </el-col>
      <el-col :xs="24" :md="8" :xl="6">
        <el-card>
          <div class="kpi">
            <div>毛利试算</div>
            <div class="num">¥ {{ stats.grossEstimate.toFixed(2) }}</div>
          </div>
        </el-card>
      </el-col>
      <el-col :xs="24" :md="8" :xl="6">
        <el-card>
          <div class="kpi">
            <div>库存预警</div>
            <div class="num warn">{{ warningCount }}</div>
          </div>
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, computed } from 'vue'
import api from '../api/client'
import { useAuthStore } from '../stores/auth'

const auth = useAuthStore()
const stats = reactive({ receivableTotal: 0, purchaseCost: 0, grossEstimate: 0 })
const materials = reactive<any[]>([])

async function loadStats() {
  const { data } = await api.get('/reports/summary')
  stats.receivableTotal = data.receivableTotal
}

async function loadMaterials() {
  const { data } = await api.get('/materials')
  materials.splice(0, materials.length, ...data)
}

const warningCount = computed(() => materials.filter(m => m.threshold && m.stock < m.threshold).length)

function logout() { auth.logout() }

onMounted(() => {
  auth.bootstrap()
  loadStats()
  loadMaterials()
})
</script>

<style scoped>
.home-wrap { padding: 16px; }
.top { display:flex; align-items:center; justify-content:space-between; margin-bottom: 12px; }
.quick { display:flex; gap: 8px; margin-bottom: 12px; }
.kpi { display:flex; align-items:center; justify-content:space-between; font-size: 14px; }
.num { font-size: 22px; font-weight: 600; }
.warn { color: #F56C6C }
</style>
