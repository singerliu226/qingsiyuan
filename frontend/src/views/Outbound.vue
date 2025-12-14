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
              <el-option label="测试" value="test" />
              <el-option label="赠送" value="gift" />
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
            <div class="multi-products">
              <div v-for="(row, idx) in items" :key="row.id" class="prod-row">
                <el-select
                  v-model="row.productId"
                  placeholder="选择产品"
                  :loading="loadingList"
                  @change="() => refreshQuote(idx)"
                >
                  <el-option v-for="p in products" :key="p.id" :label="p.name" :value="p.id" />
                </el-select>
                <el-input-number
                  v-model="row.qty"
                  :min="1"
                  @change="() => refreshQuote(idx)"
                />
                <el-button
                  v-if="items.length > 1"
                  link
                  type="danger"
                  @click="removeItem(idx)"
                >
                  移除
                </el-button>
              </div>
              <el-button type="primary" link @click="addItem">+ 添加产品</el-button>
            </div>
          </el-form-item>
          <div class="actions sticky">
            <el-button @click="prev">上一步</el-button>
            <el-button type="primary" @click="next" :disabled="!hasValidItem">下一步</el-button>
          </div>
        </el-form>
      </div>

      <div v-else-if="step === 2" class="pane">
        <el-form label-width="80px">
          <el-form-item label="取货人">
            <el-input v-model="person" placeholder="您的姓名（默认为本账号操作者）" />
          </el-form-item>
          <el-form-item label="支付方式">
            <el-select v-model="payment" placeholder="选择支付方式">
              <el-option label="现金" value="cash" />
              <el-option label="微信" value="wechat" />
              <el-option label="支付宝" value="alipay" />
              <el-option label="其他" value="other" />
            </el-select>
          </el-form-item>
          <el-form-item label="备注">
            <el-input v-model="remark" placeholder="客户姓名" />
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
          <div>支付：{{ paymentLabel }}</div>
          <div class="preview-list">
            <div v-for="row in validItems" :key="row.id" class="preview-row">
              <div>
                <span>{{ productNameOf(row.productId) }}</span>
                <span>× {{ row.qty }}</span>
                <span>，系统金额：¥ {{ row.receivable || 0 }}</span>
              </div>
              <div class="preview-row-edit">
                <span>实际每包价格：</span>
                <el-input-number
                  v-model="row.unitOverride"
                  :min="0"
                  :step="1"
                  size="small"
                  placeholder="可不填"
                />
              </div>
            </div>
          </div>
          <div>本次应收合计：<b>¥ {{ receivable }}</b></div>
        </div>
        <div class="actions sticky">
          <el-button @click="prev">上一步</el-button>
          <el-button type="primary" :loading="loading" @click="submit">确认提交</el-button>
        </div>
      </div>
    </el-card>

    <el-dialog v-model="dlg.visible" title="提交成功" width="420px">
      <p>应收金额：<b>¥ {{ dlg.receivable }}</b></p>
      <p>如需撤销，可在 5 分钟内点击下方按钮，将本次创建的所有订单一并撤销。</p>
      <template #footer>
        <el-button @click="dlg.visible=false">关闭</el-button>
        <el-button type="danger" :loading="dlg.canceling" @click="cancelOrder">撤销订单</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref, computed } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import api from '../api/client'

const products = reactive<any[]>([])
const loadingList = ref(false)
let nextItemId = 1
const items = reactive<Array<{ id:number; productId:string; qty:number; receivable:number; unitOverride?:number }>>([
  { id: nextItemId++, productId: '', qty: 1, receivable: 0, unitOverride: undefined }
])
const type = ref<'self'|'retail'|'vip'|'distrib'|'temp'|'test'|'gift'>('self')
const person = ref('')
const remark = ref('')
const loading = ref(false)
const step = ref(0)
const payment = ref<'cash'|'wechat'|'alipay'|'other'|''>('')
const dlg = reactive<{ visible:boolean; orderIds:string[]; receivable:number; canceling:boolean }>({ visible:false, orderIds:[], receivable:0, canceling:false })
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
  const valid = validItems.value
  if (!valid.length) { ElMessage.warning('请至少选择一种产品并填写数量'); return }
  if (!payment.value) { ElMessage.warning('请选择支付方式'); return }

  // 提交前：如有成品库存不足的行，提示用户是否允许自动按配方扣原料
  const lackMessages:string[] = []
  for (const row of valid) {
    const prod = products.find(p => p.id === row.productId)
    const stock = Number(prod?.stock || 0)
    if (row.qty > stock) {
      const needFromRaw = row.qty - stock
      if (stock > 0) {
        lackMessages.push(`${prod?.name || ''}：成品库存仅剩 ${stock} 包，将额外按配方现配 ${needFromRaw} 包扣原料`)
      } else {
        lackMessages.push(`${prod?.name || ''}：成品库存为 0，将直接按配方扣原料 ${row.qty} 包`)
      }
    }
  }
  if (lackMessages.length) {
    const ok = await ElMessageBox.confirm(
      `${lackMessages.join('\n')}\n\n是否继续？`,
      '成品库存不足',
      { type: 'warning', confirmButtonText: '继续', cancelButtonText: '取消' }
    ).then(() => true).catch(() => false)
    if (!ok) return
  }

  loading.value = true
  try {
    const orderIds:string[] = []
    let total = 0
    for (const row of valid) {
      const overridePerPack = row.unitOverride
      const overrideTotal =
        overridePerPack !== undefined && overridePerPack !== null
          ? Number((overridePerPack * row.qty).toFixed(2))
          : undefined
      const payload: any = {
        type: type.value,
        productId: row.productId,
        qty: row.qty,
        person: person.value,
        payment: payment.value,
        pricingGroup: pricingGroup.value,
        pricingPlanId: pricingPlanId.value,
        remark: remark.value,
      }
      if (overrideTotal !== undefined && overrideTotal >= 0) {
        payload.receivableOverride = overrideTotal
      }
      const { data } = await api.post('/orders', payload)
      orderIds.push(data.id)
      total += data.receivable
    }
    dlg.visible = true
    dlg.orderIds = orderIds
    dlg.receivable = total
    step.value = 0
    person.value = ''
    payment.value = ''
    remark.value = ''
  } catch (e:any) {
    const msg = e?.response?.data?.error?.message || e.message || '提交失败'
    ElMessage.error(msg)
  } finally {
    loading.value = false
  }
}

async function cancelOrder() {
  if (!dlg.orderIds.length) return
  dlg.canceling = true
  try {
    for (const id of dlg.orderIds) {
      await api.post(`/orders/${id}/cancel`)
    }
    ElMessage.success('已撤销本次所有订单并回滚库存')
    dlg.visible = false
  } catch (e:any) {
    ElMessage.error(e?.response?.data?.error?.message || e.message || '撤销失败')
  } finally {
    dlg.canceling = false
  }
}

function next() { step.value = Math.min(3, step.value + 1) }
function prev() { step.value = Math.max(0, step.value - 1) }

const validItems = computed(() => items.filter(r => r.productId && r.qty > 0))
const hasValidItem = computed(() => validItems.value.length > 0)
const productNameOf = (id:string) => products.find(p => p.id === id)?.name || ''
const typeLabel = computed(() => ({ self:'自用', retail:'零售', vip:'VIP', distrib:'分销', temp:'临时活动', test:'测试', gift:'赠送' } as any)[type.value])
const paymentLabel = computed(() => ({ cash:'现金', wechat:'微信', alipay:'支付宝', other:'其他', '':'' } as any)[payment.value])
const receivable = computed(() =>
  validItems.value.reduce((sum, row) => {
    const rowTotal =
      row.unitOverride !== undefined && row.unitOverride !== null
        ? Number((row.unitOverride * row.qty).toFixed(2))
        : row.receivable || 0
    return sum + rowTotal
  }, 0),
)
const pricingGroup = computed(() => {
  if (type.value === 'self') return 'self'
  if (type.value === 'vip') return 'vip'
  if (type.value === 'distrib') return 'distrib'
  if (type.value === 'retail') return 'retail'
  if (type.value === 'temp') return 'temp'
  return undefined
})
const plansByType = computed(() => {
  // 兼容历史：VIP 方案可能存于 special 或 retail:VIP 名称下，服务端已在 /pricing/plans 统一映射 group='vip'
  const g = pricingGroup.value
  return plans.value.filter(p => p.group === g)
})
function planLabel(pl:any){ return `${pl.name}（¥${pl.setPrice}/${pl.packCount}包，¥${pl.perPackPrice}/包）` }
function onTypeChange(){ pricingPlanId.value=''; loadPlans(); refreshQuote() }
function onPlanDropdown(open:boolean){ if (open) loadPlans() }

function addItem() {
  items.push({ id: nextItemId++, productId: '', qty: 1, receivable: 0, unitOverride: undefined })
}

function removeItem(idx:number) {
  if (items.length <= 1) return
  items.splice(idx, 1)
}

async function refreshQuote(index?:number) {
  if (typeof index === 'number') {
    const row = items[index]
    if (!row) return
    row.receivable = 0
    if (!row.productId || !row.qty) return
    try {
      const { data } = await api.post('/orders/validate', { type: type.value, productId: row.productId, qty: row.qty, pricingGroup: pricingGroup.value, pricingPlanId: pricingPlanId.value })
      row.receivable = data.receivable
    } catch (e:any) {
      row.receivable = 0
    }
    return
  }
  // 当类型或方案变化时，逐行刷新
  for (let i = 0; i < items.length; i++) {
    // eslint-disable-next-line no-await-in-loop
    await refreshQuote(i)
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
