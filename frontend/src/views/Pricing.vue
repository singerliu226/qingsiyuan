<template>
  <div class="wrap">
    <el-card>
      <h3>定价策略</h3>
      <el-form label-width="120px">
        <el-form-item label="自用折扣">
          <el-input-number v-model="form.self" :min="0.1" :max="10" :step="0.1" />
        </el-form-item>
        <el-form-item label="VIP 折扣">
          <el-input-number v-model="form.vip" :min="0.1" :max="10" :step="0.1" />
        </el-form-item>
        <el-form-item label="分销折扣">
          <el-input-number v-model="form.distrib" :min="0.1" :max="10" :step="0.1" />
        </el-form-item>
        <el-form-item label="活动折扣">
          <el-input-number v-model="form.event" :min="0.1" :max="10" :step="0.1" />
        </el-form-item>
      </el-form>
      <el-divider>开业活动方案</el-divider>
      <el-tabs v-model="activeTab">
        <el-tab-pane label="自用（固定80/包）" name="self">
          <div class="actions" style="margin-bottom:8px;">
            <el-button size="small" @click="addPlan('self')">新增自用方案</el-button>
          </div>
          <el-alert type="info" show-icon title="自用方案建议按80元/包计算，可设置15/30包等固定套装" style="margin-bottom:8px;" />
          <el-table :data="plansSelf" size="small">
            <el-table-column prop="name" label="名称" width="120" />
            <el-table-column label="套装价格(元)" width="150">
              <template #default="{ row }">
                <el-input-number v-model="row.setPrice" :min="0" :step="1" />
              </template>
            </el-table-column>
            <el-table-column label="套装内包数" width="140">
              <template #default="{ row }">
                <el-input-number v-model="row.packCount" :min="0" :step="1" />
              </template>
            </el-table-column>
            <el-table-column label="应收每包(元)" width="160">
              <template #default="{ row }">
                <el-input-number v-model="row.perPackPrice" :min="0" :step="1" />
              </template>
            </el-table-column>
            <el-table-column prop="remark" label="备注" />
            <el-table-column label="操作" width="120">
              <template #default="{ $index }">
                <el-button size="small" type="danger" @click="removePlan('self', $index)">删除</el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-tab-pane>
        <el-tab-pane label="VIP" name="vip">
          <div class="actions" style="margin-bottom:8px;">
            <el-button size="small" @click="ensureVip">{{ plansVip.length ? '重置为VIP' : '创建VIP' }}</el-button>
          </div>
          <el-table :data="plansVip" size="small">
            <el-table-column prop="name" label="名称" width="100" />
            <el-table-column label="套装价格(元)" width="150">
              <template #default="{ row }">
                <el-input-number v-model="row.setPrice" :min="0" :step="1" />
              </template>
            </el-table-column>
            <el-table-column label="套装内包数" width="140">
              <template #default="{ row }">
                <el-input-number v-model="row.packCount" :min="0" :step="1" />
              </template>
            </el-table-column>
            <el-table-column label="应收每包(元)" width="160">
              <template #default="{ row }">
                <el-input-number v-model="row.perPackPrice" :min="0" :step="1" />
              </template>
            </el-table-column>
            <el-table-column prop="remark" label="备注" />
          </el-table>
        </el-tab-pane>
        <el-tab-pane label="分销（三档）" name="distrib">
          <div class="actions" style="margin-bottom:8px;">
            <el-button size="small" @click="addPlan('distrib')">新增方案</el-button>
          </div>
          <el-table :data="plansDistrib" size="small">
            <el-table-column prop="name" label="名称" width="100" />
            <el-table-column label="套装价格(元)" width="150">
              <template #default="{ row }">
                <el-input-number v-model="row.setPrice" :min="0" :step="1" />
              </template>
            </el-table-column>
            <el-table-column label="套装内包数" width="140">
              <template #default="{ row }">
                <el-input-number v-model="row.packCount" :min="0" :step="1" />
              </template>
            </el-table-column>
            <el-table-column label="应收每包(元)" width="160">
              <template #default="{ row }">
                <el-input-number v-model="row.perPackPrice" :min="0" :step="1" />
              </template>
            </el-table-column>
            <el-table-column prop="remark" label="备注" />
            <el-table-column label="操作" width="120">
              <template #default="{ $index }">
                <el-button size="small" type="danger" @click="removePlan('distrib', $index)">删除</el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-tab-pane>
        <el-tab-pane label="零售（两档）" name="retail">
          <div class="actions" style="margin-bottom:8px;">
            <el-button size="small" @click="addPlan('retail')">新增方案</el-button>
          </div>
          <el-table :data="plansRetail" size="small">
            <el-table-column prop="name" label="名称" width="100" />
            <el-table-column label="套装价格(元)" width="150">
              <template #default="{ row }">
                <el-input-number v-model="row.setPrice" :min="0" :step="1" />
              </template>
            </el-table-column>
            <el-table-column label="套装内包数" width="140">
              <template #default="{ row }">
                <el-input-number v-model="row.packCount" :min="0" :step="1" />
              </template>
            </el-table-column>
            <el-table-column label="应收每包(元)" width="160">
              <template #default="{ row }">
                <el-input-number v-model="row.perPackPrice" :min="0" :step="1" />
              </template>
            </el-table-column>
            <el-table-column prop="remark" label="备注" />
            <el-table-column label="操作" width="120">
              <template #default="{ $index }">
                <el-button size="small" type="danger" @click="removePlan('retail', $index)">删除</el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-tab-pane>
        <el-tab-pane label="临时活动（三档）" name="temp">
          <div class="actions" style="margin-bottom:8px;">
            <el-button size="small" @click="addPlan('temp')">新增方案</el-button>
          </div>
          <el-table :data="plansTemp" size="small">
            <el-table-column prop="name" label="名称" width="120" />
            <el-table-column label="套装价格(元)" width="150">
              <template #default="{ row }">
                <el-input-number v-model="row.setPrice" :min="0" :step="1" />
              </template>
            </el-table-column>
            <el-table-column label="套装内包数" width="140">
              <template #default="{ row }">
                <el-input-number v-model="row.packCount" :min="0" :step="1" />
              </template>
            </el-table-column>
            <el-table-column label="应收每包(元)" width="160">
              <template #default="{ row }">
                <el-input-number v-model="row.perPackPrice" :min="0" :step="1" />
              </template>
            </el-table-column>
            <el-table-column prop="remark" label="备注" />
            <el-table-column label="操作" width="120">
              <template #default="{ $index }">
                <el-button size="small" type="danger" @click="removePlan('temp', $index)">删除</el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-tab-pane>
      </el-tabs>
      <div style="margin-top:12px; text-align:right;">
        <el-button @click="load">重置</el-button>
        <el-button type="primary" :loading="saving" @click="save">保存</el-button>
      </div>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref, onMounted, computed } from 'vue'
import { ElMessage } from 'element-plus'
import api from '../api/client'

type Plan = { id?: string; group: 'self'|'distrib'|'retail'|'temp'|'special'; name: string; setPrice: number; packCount: number; perPackPrice?: number; remark?: string }
const form = reactive({ self: 1, vip: 0.8, distrib: 0.7, event: 1, plans: [] as Plan[] })
const saving = ref(false)
const activeTab = ref('self')

const plansSelf = computed(() => form.plans.filter(p => p.group==='self'))
const plansVip = computed(() => form.plans.filter(p => p.group==='special' && p.name==='VIP'))
const plansDistrib = computed(() => form.plans.filter(p => p.group==='distrib'))
const plansRetail = computed(() => form.plans.filter(p => p.group==='retail' && p.name!=='VIP'))
const plansTemp = computed(() => form.plans.filter(p => p.group==='temp'))

function addPlan(group:'self'|'distrib'|'retail'|'temp') {
  const seq = (form.plans.filter(p => p.group===group).length + 1)
  const name = group==='self' ? `自用${['一','二','三','四','五'][seq-1]||seq}` : group==='distrib' ? `分销${['一','二','三','四','五'][seq-1]||seq}` : group==='retail' ? `零售${['一','二','三','四','五'][seq-1]||seq}` : `临时活动${['一','二','三','四','五'][seq-1]||seq}`
  form.plans.push({ group, name, setPrice: 0, packCount: 0, remark: '' })
}

function removePlan(group:'self'|'distrib'|'retail'|'temp', index:number) {
  const list = form.plans.filter(p => p.group===group)
  const target = list[index]
  if (!target) return
  const i = form.plans.indexOf(target)
  if (i>=0) form.plans.splice(i,1)
}

function ensureVip() {
  const exists = form.plans.find(p => p.group==='special' && p.name==='VIP')
  if (!exists) {
    form.plans.push({ group:'special', name:'VIP', setPrice: 2000, packCount: 15, remark:'亲朋体验15次疗程套装2000元15包' })
  }
}

async function load() {
  const { data } = await api.get('/pricing')
  Object.assign(form, { self: 1, vip: 0.8, distrib: 0.7, event: 1, plans: [] })
  Object.assign(form, data)
}

async function save() {
  saving.value = true
  try {
    // 将 perPackPrice 一并提交，确保后端采用操作者手动调整后的单包价
    const payload = { self: form.self, vip: form.vip, distrib: form.distrib, event: form.event, plans: form.plans.map(p => ({ id: p.id, group: p.group, name: p.name, setPrice: p.setPrice, packCount: p.packCount, perPackPrice: (p as any).perPackPrice, remark: p.remark })) }
    await api.patch('/pricing', payload)
    ElMessage.success('已保存')
  } finally {
    saving.value = false
  }
}

onMounted(load)
</script>

<style scoped>
.wrap { padding: 16px; }
</style>


