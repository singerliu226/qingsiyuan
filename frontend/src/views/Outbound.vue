<template>
  <div class="out-wrap">
    <el-card>
      <h3>取货登记</h3>
      <el-steps :active="step" finish-status="success" align-center>
        <el-step title="类型" />
        <el-step title="产品" />
        <el-step title="信息" />
        <el-step title="确认" />
      </el-steps>

      <div v-if="step === 0" class="pane">
        <el-form label-width="80px">
          <el-form-item label="类型">
            <el-select v-model="type" placeholder="选择取货类型" @change="onTypeChange">
              <el-option label="自用" value="self" />
              <el-option label="零售" value="retail" />
              <el-option label="VIP" value="vip" />
              <el-option label="分销" value="distrib" />
              <el-option label="临时活动" value="temp" />
            </el-select>
          </el-form-item>
          <template v-if="type==='self' || type==='vip' || type==='distrib' || type==='retail' || type==='temp'">
            <el-form-item label="方案">
              <el-select v-model="pricingPlanId" placeholder="选择定价方案" @change="refreshQuote" @visible-change="onPlanDropdown">
                <el-option v-for="pl in plansByType" :key="pl.id" :label="planLabel(pl)" :value="pl.id" />
              </el-select>
            </el-form-item>
          </template>
          <el-button type="primary" @click="next">下一步</el-button>
        </el-form>
      </div>

      <div v-else-if="step === 1" class="pane">
        <el-form label-width="80px">
          <el-form-item label="产品">
            <el-select v-model="productId" placeholder="选择产品" :loading="loadingList" @change="refreshQuote">
              <el-option v-for="p in products" :key="p.id" :label="p.name" :value="p.id" />
            </el-select>
          </el-form-item>
          <el-form-item label="数量">
            <el-input-number v-model="qty" :min="1" @change="refreshQuote" />
          </el-form-item>
          <div class="actions sticky">
            <el-button @click="prev">上一步</el-button>
            <el-button type="primary" @click="next" :disabled="!productId">下一步</el-button>
          </div>
        </el-form>
      </div>

      <div v-else-if="step === 2" class="pane">
        <el-form label-width="80px">
          <el-form-item label="取货人">
            <el-input v-model="person" placeholder="客户姓名（可选）" />
          </el-form-item>
          <el-form-item label="支付方式">
            <el-select v-model="payment" placeholder="选择支付方式">
              <el-option label="现金" value="cash" />
              <el-option label="微信" value="wechat" />
              <el-option label="支付宝" value="alipay" />
              <el-option label="其他" value="other" />
            </el-select>
          </el-form-item>
          <div class="actions">
            <el-button @click="prev">上一步</el-button>
            <el-button type="primary" @click="next" :disabled="!payment">下一步</el-button>
          </div>
        </el-form>
      </div>

      <div v-else class="pane">
        <div class="preview">
          <div>类型：{{ typeLabel }}</div>
          <div>产品：{{ productName }}</div>
          <div>数量：{{ qty }}</div>
          <div>应收：<b>¥ {{ receivable }}</b></div>
          <div>支付：{{ paymentLabel }}</div>
        </div>
        <div class="actions sticky">
          <el-button @click="prev">上一步</el-button>
          <el-button type="primary" :loading="loading" @click="submit">确认提交</el-button>
        </div>
      </div>
    </el-card>

    <el-dialog v-model="dlg.visible" title="提交成功" width="420px">
      <p>应收金额：<b>¥ {{ dlg.receivable }}</b></p>
      <p>如需撤销，可在 5 分钟内点击下方按钮。</p>
      <template #footer>
        <el-button @click="dlg.visible=false">关闭</el-button>
        <el-button type="danger" :loading="dlg.canceling" @click="cancelOrder">撤销订单</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref, computed } from 'vue'
import api from '../api/client'

const products = reactive<any[]>([])
const loadingList = ref(false)
const productId = ref('')
const qty = ref(1)
const type = ref<'self'|'retail'|'vip'|'distrib'|'temp'>('self')
const person = ref('')
const loading = ref(false)
const step = ref(0)
const payment = ref<'cash'|'wechat'|'alipay'|'other'|''>('')
const dlg = reactive<{ visible:boolean; orderId:string; receivable:number; canceling:boolean }>({ visible:false, orderId:'', receivable:0, canceling:false })
const pricingPlanId = ref<string>('')
const plans = ref<Array<any>>([])

async function loadProducts() {
  loadingList.value = true
  try {
    const { data } = await api.get('/products')
    products.splice(0, products.length, ...data)
    await loadPlans()
  } catch (e:any) {
    ElMessage.error(e?.response?.data?.error?.message || e.message || '加载产品失败')
  } finally {
    loadingList.value = false
  }
}

async function loadPlans() {
  try {
    const res = await api.get('/pricing/plans')
    plans.value = Array.isArray(res.data?.plans) ? res.data.plans : []
  } catch {}
}

async function submit() {
  if (!productId.value) { ElMessage.warning('请选择产品'); return }
  if (!payment.value) { ElMessage.warning('请选择支付方式'); return }
  loading.value = true
  try {
    const { data } = await api.post('/orders', { type: type.value, productId: productId.value, qty: qty.value, person: person.value, payment: payment.value, pricingGroup: pricingGroup.value, pricingPlanId: pricingPlanId.value })
    dlg.visible = true
    dlg.orderId = data.id
    dlg.receivable = data.receivable
    step.value = 0
    person.value = ''
    payment.value = ''
  } catch (e:any) {
    const msg = e?.response?.data?.error?.message || e.message || '提交失败'
    ElMessage.error(msg)
  } finally {
    loading.value = false
  }
}

async function cancelOrder() {
  if (!dlg.orderId) return
  dlg.canceling = true
  try {
    await api.post(`/orders/${dlg.orderId}/cancel`)
    ElMessage.success('已撤销订单并回滚库存')
    dlg.visible = false
  } catch (e:any) {
    ElMessage.error(e?.response?.data?.error?.message || e.message || '撤销失败')
  } finally {
    dlg.canceling = false
  }
}

function next() { step.value = Math.min(3, step.value + 1) }
function prev() { step.value = Math.max(0, step.value - 1) }

const productName = computed(() => products.find(p => p.id === productId.value)?.name || '')
const typeLabel = computed(() => ({ retail:'零售', vip:'VIP', distrib:'分销', temp:'临时活动' } as any)[type.value])
const paymentLabel = computed(() => ({ cash:'现金', wechat:'微信', alipay:'支付宝', other:'其他', '':'' } as any)[payment.value])
const receivable = ref(0)
const pricingGroup = computed(() => {
  if (type.value === 'self') return 'self'
  if (type.value === 'vip') return 'vip'
  if (type.value === 'distrib') return 'distrib'
  if (type.value === 'retail') return 'retail'
  if (type.value === 'temp') return 'temp'
  return undefined
})
const plansByType = computed(() => plans.value.filter(p => p.group === pricingGroup.value))
function planLabel(pl:any){ return `${pl.name}（¥${pl.setPrice}/${pl.packCount}包，¥${pl.perPackPrice}/包）` }
function onTypeChange(){ pricingPlanId.value=''; loadPlans(); refreshQuote() }
function onPlanDropdown(open:boolean){ if (open) loadPlans() }

async function refreshQuote() {
  receivable.value = 0
  if (!productId.value || !qty.value) return
  try {
    const { data } = await api.post('/orders/validate', { type: type.value, productId: productId.value, qty: qty.value, pricingGroup: pricingGroup.value, pricingPlanId: pricingPlanId.value })
    receivable.value = data.receivable
  } catch (e:any) {
    receivable.value = 0
  }
}

onMounted(() => {
  loadProducts()
})
</script>

<style scoped>
.out-wrap { padding: 16px; }
.pane { margin-top: 12px; }
.actions { display:flex; gap: 8px; }
.actions.sticky { position: sticky; bottom: 0; padding: 8px 0; background: var(--qs-surface); border-top: 1px solid var(--qs-border); }
.preview { display:flex; flex-direction: column; gap: 6px; margin: 8px 0 16px; }
</style>
