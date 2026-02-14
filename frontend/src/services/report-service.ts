/**
 * 报表服务
 *
 * 提供营收汇总统计和数据导出（CSV/XLSX）功能。
 * 与服务端 GET /reports/summary 和 GET /reports/export 逻辑一致。
 */
import { db } from '../db/schema';
import type { OrderType, PricingPlanGroup } from '../db/schema';

function toDateKey(iso: string): string {
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * 营收汇总统计。
 * 支持时间范围筛选、按类型/定价分组、按日/周/月粒度聚合。
 */
export async function summary(params: {
  from?: string;
  to?: string;
  type?: string;
  pricingGroup?: string;
  pricingPlanId?: string;
  groupBy?: string;
  gran?: string;
}): Promise<{
  receivableTotal: number;
  purchaseCost: number;
  grossEstimate: number;
  series: Array<{ date: string; receivable: number }>;
  byGroup?: Array<{ key: string; receivable: number }>;
}> {
  const from = params.from ? new Date(String(params.from)) : null;
  const to = params.to ? new Date(String(params.to)) : null;
  const type = params.type as OrderType | undefined;
  const pricingGroup = params.pricingGroup as PricingPlanGroup | 'vip' | undefined;
  const pricingPlanId = params.pricingPlanId;
  const groupBy = params.groupBy as 'type' | 'pricingGroup' | 'pricingPlan' | undefined;
  const gran = (params.gran || 'day') as 'day' | 'week' | 'month';

  const allOrders = await db.orders.toArray();
  const orders = allOrders.filter(o => {
    const d = new Date(o.createdAt);
    if (from && d < from) return false;
    if (to && d > to) return false;
    if (type && o.type !== type) return false;
    if (pricingGroup && o.pricingGroup !== pricingGroup) return false;
    if (pricingPlanId && o.pricingPlanId !== pricingPlanId) return false;
    return true;
  });

  const receivableTotal = orders.reduce((s, o) => s + o.receivable, 0);

  const allPurchases = await db.purchases.toArray();
  const purchaseCost = allPurchases.reduce((s, p) => {
    const d = new Date(p.createdAt);
    if (from && d < from) return s;
    if (to && d > to) return s;
    return s + p.cost;
  }, 0);

  function keyByGran(iso: string): string {
    const d = new Date(iso);
    if (gran === 'day') return toDateKey(iso);
    if (gran === 'week') {
      const tmp = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
      const weekDay = tmp.getUTCDay() || 7;
      tmp.setUTCDate(tmp.getUTCDate() - weekDay + 1);
      return `${tmp.getUTCFullYear()}-W${String(Math.ceil(tmp.getUTCDate() / 7)).padStart(2, '0')}`;
    }
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }

  const byKey = new Map<string, number>();
  for (const o of orders) {
    const k = keyByGran(o.createdAt);
    byKey.set(k, (byKey.get(k) || 0) + o.receivable);
  }
  const series = Array.from(byKey.entries())
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([date, receivable]) => ({ date, receivable }));

  let byGroup: Array<{ key: string; receivable: number }> | undefined;
  if (groupBy) {
    const map = new Map<string, number>();
    for (const o of orders) {
      const k = groupBy === 'type'
        ? o.type
        : groupBy === 'pricingGroup'
          ? (o.pricingGroup || '')
          : (o.pricingPlanId || '');
      map.set(k, (map.get(k) || 0) + o.receivable);
    }
    byGroup = Array.from(map.entries()).map(([key, receivable]) => ({
      key,
      receivable: Number(receivable.toFixed(2)),
    }));
  }

  return {
    receivableTotal: Number(receivableTotal.toFixed(2)),
    purchaseCost: Number(purchaseCost.toFixed(2)),
    grossEstimate: Number((receivableTotal - purchaseCost).toFixed(2)),
    series,
    byGroup,
  };
}

/**
 * 导出订单数据为 CSV 字符串。
 * 返回 { content, filename, contentType }，由 adapter 层触发浏览器下载。
 */
export async function exportData(params: {
  format?: string;
  from?: string;
  to?: string;
  type?: string;
  pricingGroup?: string;
  pricingPlanId?: string;
}): Promise<{ content: string; filename: string; contentType: string }> {
  const from = params.from ? new Date(String(params.from)) : null;
  const to = params.to ? new Date(String(params.to)) : null;
  const type = params.type as OrderType | undefined;
  const pricingGroup = params.pricingGroup as PricingPlanGroup | 'vip' | undefined;
  const pricingPlanId = params.pricingPlanId;

  const allOrders = await db.orders.toArray();
  const orders = allOrders.filter(o => {
    const d = new Date(o.createdAt);
    if (from && d < from) return false;
    if (to && d > to) return false;
    if (type && o.type !== type) return false;
    if (pricingGroup && o.pricingGroup !== pricingGroup) return false;
    if (pricingPlanId && o.pricingPlanId !== pricingPlanId) return false;
    return true;
  });

  // CSV 格式（与服务端一致）
  const header = 'id,type,pricingGroup,pricingPlanId,perPackPrice,productId,qty,person,receivable,payment,createdAt\n';
  const rows = orders
    .map(o => `${o.id},${o.type},${o.pricingGroup || ''},${o.pricingPlanId || ''},${o.perPackPrice || ''},${o.productId},${o.qty},${o.person},${o.receivable},${o.payment},${o.createdAt}`)
    .join('\n');

  return {
    content: header + rows,
    filename: 'orders.csv',
    contentType: 'text/csv; charset=utf-8',
  };
}
