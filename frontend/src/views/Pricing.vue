<template>
  <div class="wrap">
    <el-card>
      <h3>定价（简化版）</h3>
      <el-form label-width="120px">
        <el-form-item label="自用/赠送默认折扣">
          <el-input v-model="defaults.selfInput" placeholder="例如：0.8 / 8折 / 80%" style="max-width:260px" @blur="syncDefault('self')" />
          <span class="hint">当前：{{ discountLabel(form.self) }}</span>
        </el-form-item>
        <el-form-item label="VIP 默认折扣">
          <el-input v-model="defaults.vipInput" placeholder="例如：0.7 / 7折 / 70%" style="max-width:260px" @blur="syncDefault('vip')" />
          <span class="hint">当前：{{ discountLabel(form.vip) }}</span>
        </el-form-item>
        <el-form-item label="临时活动默认折扣">
          <el-input v-model="defaults.tempInput" placeholder="例如：0.65 / 6.5折 / 65%" style="max-width:260px" @blur="syncDefault('temp')" />
          <span class="hint">当前：{{ discountLabel(form.temp) }}</span>
        </el-form-item>
      </el-form>
      <el-divider>折扣方案（可保存常用折扣）</el-divider>
      <el-tabs v-model="activeTab">
        <el-tab-pane label="自用/赠送" name="self">
          <div class="actions" style="margin-bottom:8px;">
            <el-button size="small" @click="addPlan('self')">新增自用/赠送方案</el-button>
          </div>
          <el-alert type="info" show-icon title="建议：把常用折扣保存为方案，取货登记时一键选择" style="margin-bottom:8px;" />
          <el-table :data="plansSelf" size="small">
            <el-table-column label="名称" width="160">
              <template #default="{ row }">
                <el-input v-model="row.name" placeholder="例如：自用8折" />
              </template>
            </el-table-column>
            <el-table-column label="折扣" width="160">
              <template #default="{ row }">
                <el-input v-model="row.discountInput" placeholder="0.8 / 8折 / 80%" @blur="syncPlanDiscount(row)" />
              </template>
            </el-table-column>
            <el-table-column label="展示" width="120">
              <template #default="{ row }">
                <el-tag v-if="row.discount !== null" type="success">{{ discountLabel(row.discount) }}</el-tag>
                <el-tag v-else type="danger">无效</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="备注">
              <template #default="{ row }">
                <el-input v-model="row.remark" placeholder="可选" />
              </template>
            </el-table-column>
            <el-table-column label="操作" width="120">
              <template #default="{ $index }">
                <el-button size="small" type="danger" @click="removePlan('self', $index)">删除</el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-tab-pane>
        <el-tab-pane label="VIP" name="vip">
          <div class="actions" style="margin-bottom:8px;">
            <el-button size="small" @click="addPlan('vip')">新增 VIP 方案</el-button>
          </div>
          <el-table :data="plansVip" size="small">
            <el-table-column label="名称" width="160">
              <template #default="{ row }">
                <el-input v-model="row.name" placeholder="例如：VIP7折" />
              </template>
            </el-table-column>
            <el-table-column label="折扣" width="160">
              <template #default="{ row }">
                <el-input v-model="row.discountInput" placeholder="0.7 / 7折 / 70%" @blur="syncPlanDiscount(row)" />
              </template>
            </el-table-column>
            <el-table-column label="展示" width="120">
              <template #default="{ row }">
                <el-tag v-if="row.discount !== null" type="success">{{ discountLabel(row.discount) }}</el-tag>
                <el-tag v-else type="danger">无效</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="备注">
              <template #default="{ row }">
                <el-input v-model="row.remark" placeholder="可选" />
              </template>
            </el-table-column>
            <el-table-column label="操作" width="120">
              <template #default="{ $index }">
                <el-button size="small" type="danger" @click="removePlan('vip', $index)">删除</el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-tab-pane>
        <el-tab-pane label="临时活动" name="temp">
          <div class="actions" style="margin-bottom:8px;">
            <el-button size="small" @click="addPlan('temp')">新增方案</el-button>
          </div>
          <el-table :data="plansTemp" size="small">
            <el-table-column label="名称" width="160">
              <template #default="{ row }">
                <el-input v-model="row.name" placeholder="例如：活动6.5折" />
              </template>
            </el-table-column>
            <el-table-column label="折扣" width="160">
              <template #default="{ row }">
                <el-input v-model="row.discountInput" placeholder="0.65 / 6.5折 / 65%" @blur="syncPlanDiscount(row)" />
              </template>
            </el-table-column>
            <el-table-column label="展示" width="120">
              <template #default="{ row }">
                <el-tag v-if="row.discount !== null" type="success">{{ discountLabel(row.discount) }}</el-tag>
                <el-tag v-else type="danger">无效</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="备注">
              <template #default="{ row }">
                <el-input v-model="row.remark" placeholder="可选" />
              </template>
            </el-table-column>
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

type Group = 'self' | 'vip' | 'temp'
type Plan = { id?: string; group: Group; name: string; discount: number | null; discountInput: string; remark?: string }
const form = reactive({ self: 0, vip: 0.8, temp: 1, plans: [] as Plan[] })
const saving = ref(false)
const activeTab = ref<Group>('self')
const defaults = reactive({ selfInput: '0', vipInput: '0.8', tempInput: '1' })

const plansSelf = computed(() => form.plans.filter(p => p.group==='self'))
const plansVip = computed(() => form.plans.filter(p => p.group==='vip'))
const plansTemp = computed(() => form.plans.filter(p => p.group==='temp'))

function addPlan(group: Group) {
  const seq = (form.plans.filter(p => p.group===group).length + 1)
  const name = group === 'self' ? `自用/赠送方案${seq}` : group === 'vip' ? `VIP方案${seq}` : `活动方案${seq}`
  form.plans.push({ group, name, discount: null, discountInput: '', remark: '' })
}

function removePlan(group: Group, index:number) {
  const list = form.plans.filter(p => p.group===group)
  const target = list[index]
  if (!target) return
  const i = form.plans.indexOf(target)
  if (i>=0) form.plans.splice(i,1)
}

function discountLabel(discount: number): string {
  if (!isFinite(discount)) return ''
  if (Number(discount) === 0) return '免费'
  const z = discount * 10
  const text = Math.round(z * 10) / 10
  return `${text}折`
}

function normalizeDiscountInput(input: string): number | null {
  const raw = String(input || '').trim()
  if (!raw) return null
  const s = raw.replace(/\s+/g, '').replace(/％/g, '%')
  // 8折 / 6.5折
  if (s.endsWith('折')) {
    const n = Number(s.slice(0, -1))
    if (!isFinite(n) || n < 0) return null
    return n > 1 ? n / 10 : n
  }
  // 80%
  if (s.endsWith('%')) {
    const n = Number(s.slice(0, -1))
    if (!isFinite(n) || n < 0) return null
    return n / 100
  }
  const n = Number(s)
  if (!isFinite(n) || n < 0) return null
  // 用户输入 8 代表 8 折；80 代表 80%
  if (n > 1 && n <= 10) return n / 10
  if (n > 10 && n <= 100) return n / 100
  return n
}

function syncDefault(group: Group) {
  const input = group === 'self' ? defaults.selfInput : group === 'vip' ? defaults.vipInput : defaults.tempInput
  const v = normalizeDiscountInput(input)
  if (v === null) return
  if (group === 'self') form.self = v
  if (group === 'vip') form.vip = v
  if (group === 'temp') form.temp = v
}

function syncPlanDiscount(row: Plan) {
  const v = normalizeDiscountInput(row.discountInput)
  row.discount = v
}

async function load() {
  const { data } = await api.get('/pricing')
  Object.assign(form, { self: 0, vip: 0.8, temp: 1, plans: [] })
  Object.assign(form, data)
  defaults.selfInput = String(form.self)
  defaults.vipInput = String(form.vip)
  defaults.tempInput = String(form.temp)
  // 将服务端 plans 映射为 UI 结构
  const rawPlans = Array.isArray((data as any)?.plans) ? (data as any).plans : []
  form.plans = rawPlans
    .filter((p:any) => p && ['self','vip','temp'].includes(String(p.group)))
    .map((p:any) => ({
      id: p.id,
      group: p.group,
      name: String(p.name || ''),
      discount: isFinite(Number(p.discount)) ? Number(p.discount) : null,
      discountInput: isFinite(Number(p.discount)) ? String(p.discount) : '',
      remark: p.remark ? String(p.remark) : '',
    }))
}

async function save() {
  saving.value = true
  try {
    const invalid = form.plans.find(p => !p.name || p.discount === null)
    if (invalid) {
      ElMessage.error('请确保每个方案都填写“名称”和有效“折扣”')
      return
    }
    const payload = {
      self: form.self,
      vip: form.vip,
      temp: form.temp,
      plans: form.plans.map(p => ({ id: p.id, group: p.group, name: p.name, discount: Number(p.discount), remark: p.remark })),
    }
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
.hint { margin-left: 10px; color: var(--el-text-color-secondary); font-size: 12px; }
</style>


