<template>
  <div class="wrap">
    <div class="controls">
      <el-select v-model="gran" style="width: 140px">
        <el-option label="按日" value="day" />
        <el-option label="按周" value="week" />
        <el-option label="按月" value="month" />
      </el-select>
      <el-select v-model="type" style="width: 160px">
        <el-option label="全部类型" value="" />
        <el-option label="零售" value="retail" />
        <el-option label="VIP" value="vip" />
        <el-option label="分销" value="distrib" />
        <el-option label="临时活动" value="temp" />
      </el-select>
      <el-select v-model="pricingGroup" placeholder="方案分组" style="width: 140px">
        <el-option label="方案不限" value="" />
        <el-option label="零售" value="retail" />
        <el-option label="VIP" value="vip" />
        <el-option label="分销" value="distrib" />
        <el-option label="临时活动" value="temp" />
      </el-select>
      <el-input v-model="pricingPlanId" placeholder="方案ID（可选）" style="width: 200px" />
      <el-date-picker v-model="range" type="daterange" range-separator="至" start-placeholder="开始日期" end-placeholder="结束日期" />
      <el-button type="primary" @click="load">查询</el-button>
      <el-button @click="exportFile('csv')">导出 CSV</el-button>
      <el-button @click="exportFile('xlsx')">导出 Excel</el-button>
    </div>
    <div class="kpis">
      <el-card>
        <div>应收合计</div>
        <div class="num">¥ {{ kpi.receivableTotal.toFixed(2) }}</div>
      </el-card>
      <el-card>
        <div>进货成本</div>
        <div class="num">¥ {{ kpi.purchaseCost.toFixed(2) }}</div>
      </el-card>
      <el-card>
        <div>毛利试算</div>
        <div class="num">¥ {{ kpi.grossEstimate.toFixed(2) }}</div>
      </el-card>
    </div>
    <div ref="chartRef" style="height: 360px;" />
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import * as echarts from 'echarts'
import api from '../api/client'

const chartRef = ref<HTMLDivElement | null>(null)
let chart: echarts.ECharts | null = null

const gran = ref<'day'|'week'|'month'>('day')
const type = ref('')
const pricingGroup = ref('')
const pricingPlanId = ref('')
const range = ref<[Date, Date] | null>(null)
const kpi = ref({ receivableTotal: 0, purchaseCost: 0, grossEstimate: 0 })
const series = ref<Array<{date:string; receivable:number}>>([])

async function load() {
  const params:any = { gran: gran.value }
  if (type.value) params.type = type.value
  if (pricingGroup.value) params.pricingGroup = pricingGroup.value
  if (pricingPlanId.value) params.pricingPlanId = pricingPlanId.value
  if (range.value) { params.from = range.value[0].toISOString(); params.to = range.value[1].toISOString() }
  const { data } = await api.get('/reports/summary', { params })
  kpi.value = { receivableTotal: data.receivableTotal, purchaseCost: data.purchaseCost, grossEstimate: data.grossEstimate }
  series.value = data.series
  render()
}

function render() {
  if (!chart) return
  chart.setOption({
    tooltip: { trigger: 'axis' },
    xAxis: { type: 'category', data: series.value.map(s => s.date) },
    yAxis: { type: 'value' },
    series: [{ type: 'line', smooth: true, data: series.value.map(s => s.receivable) }]
  })
}

async function exportFile(fmt:'csv'|'xlsx') {
  const params:any = {}
  if (type.value) params.type = type.value
  if (pricingGroup.value) params.pricingGroup = pricingGroup.value
  if (pricingPlanId.value) params.pricingPlanId = pricingPlanId.value
  if (range.value) { params.from = range.value[0].toISOString(); params.to = range.value[1].toISOString() }
  params.format = fmt
  const resp = await api.get('/reports/export', { params, responseType: 'blob' })
  const blob = resp.data as Blob
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fmt === 'xlsx' ? 'orders.xlsx' : 'orders.csv'
  document.body.appendChild(a)
  a.click()
  URL.revokeObjectURL(url)
  a.remove()
}

onMounted(() => {
  if (chartRef.value) chart = echarts.init(chartRef.value)
  load()
})
</script>

<style scoped>
.wrap { padding: 16px; }
.controls { display:flex; align-items:center; gap: 8px; margin-bottom: 12px; flex-wrap: wrap; }
.kpis { display:grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-bottom: 12px; }
.num { font-size: 20px; font-weight: 600; }
</style>


