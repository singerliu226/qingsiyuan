/**
 * 库存流水服务
 *
 * 提供库存流水查询（分页、筛选）和成品生产入库功能。
 */
import { db } from '../db/schema';
import type { InventoryLog } from '../db/schema';
import { uid, makeError } from './auth-service';
import * as purchaseService from './purchase-service';
import * as orderService from './order-service';

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * 查询库存流水列表（支持筛选和分页）。
 * 与服务端 GET /inventory/logs 逻辑一致。
 */
export async function logs(params: {
  kind?: string;
  materialId?: string;
  refType?: string;
  from?: string;
  to?: string;
  page?: string | number;
  pageSize?: string | number;
}): Promise<{ total: number; page: number; pageSize: number; data: Array<InventoryLog & { materialName?: string; productName?: string; remark?: string }> }> {
  let rows = await db.inventoryLogs.toArray();

  // 筛选
  if (params.kind) rows = rows.filter(l => l.kind === String(params.kind));
  if (params.materialId) rows = rows.filter(l => l.materialId === String(params.materialId));
  if (params.refType) rows = rows.filter(l => l.refType === String(params.refType));

  const fromD = params.from ? new Date(String(params.from)) : null;
  const toD = params.to ? new Date(String(params.to)) : null;
  if (fromD) rows = rows.filter(l => new Date(l.createdAt) >= fromD);
  if (toD) rows = rows.filter(l => new Date(l.createdAt) <= toD);

  // 按时间倒序
  rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

  // 分页
  const p = Math.max(1, Number(params.page || 1) | 0);
  const ps = Math.min(100, Math.max(1, Number(params.pageSize || 20) | 0));
  const total = rows.length;
  const start = (p - 1) * ps;
  const slice = rows.slice(start, start + ps);

  // 补充名称信息和 operator 兼容旧数据
  const allMaterials = await db.materials.toArray();
  const allProducts = await db.products.toArray();
  const allOrders = await db.orders.toArray();
  const allPurchases = await db.purchases.toArray();

  const matMap = new Map(allMaterials.map(m => [m.id, m.name]));
  const prodMap = new Map(allProducts.map(p => [p.id, p.name]));

  const data = slice.map(l => {
    const enriched: InventoryLog & { materialName?: string; productName?: string; remark?: string } = { ...l };
    // 兼容旧数据：补充缺失的 operator 信息
    if (!enriched.operator) {
      if (l.refType === 'order') {
        const o = allOrders.find(o => o.id === l.refId);
        enriched.operator = o?.person || '';
        enriched.remark = o?.remark || '';
      } else if (l.refType === 'purchase') {
        const p0 = allPurchases.find(p => p.id === l.refId);
        enriched.operator = p0?.operator || '';
      }
    }
    // 即使 operator 存在，也补充 remark（用于前端展示）
    if (enriched.remark === undefined && l.refType === 'order') {
      const o = allOrders.find(o => o.id === l.refId);
      enriched.remark = o?.remark || '';
    }
    if (l.materialId) enriched.materialName = matMap.get(l.materialId) || '';
    if (l.productId) (enriched as any).productName = prodMap.get(l.productId) || ''; // eslint-disable-line @typescript-eslint/no-explicit-any
    return enriched;
  });

  return { total, page: p, pageSize: ps, data };
}

/**
 * 撤回一条库存流水（离线模式）。
 *
 * 设计说明：
 * - 与服务端 /inventory/logs/:id/revoke 行为对齐：
 *   - purchase：撤回进货（回滚库存 + 删除 purchases + 写对冲流水）
 *   - order：撤销订单（仅 5 分钟内）
 *   - produce/adjust：写对冲流水并同步回滚库存字段
 * - 防重复：使用 refType='adjust' 且 refId='revoke-log-<id>' 作为撤回标记。
 */
export async function revokeLog(logId: string, operatorName: string): Promise<{ ok: true }> {
  if (!logId) throw makeError(400, 'VALIDATION', 'id 非法');
  const log = await db.inventoryLogs.get(logId);
  if (!log) throw makeError(404, 'NOT_FOUND', '流水不存在');

  // purchase / order：走专用撤回逻辑，保证业务一致性
  if (log.refType === 'purchase') {
    await purchaseService.revoke(String(log.refId || ''), operatorName || '');
    return { ok: true };
  }
  if (log.refType === 'order') {
    await orderService.cancel(String(log.refId || ''));
    return { ok: true };
  }

  const marker = `revoke-log-${logId}`;
  const dup = await db.inventoryLogs.where('refId').equals(marker).first();
  if (dup) throw makeError(400, 'VALIDATION', '该流水已撤回');

  const kindOpp = log.kind === 'in' ? 'out' : 'in';

  // 原料流水
  if (log.materialId && (log as any).grams !== undefined && (log as any).grams !== null) {
    const grams = Number((log as any).grams || 0);
    if (!(grams > 0)) throw makeError(400, 'VALIDATION', 'grams 非法');
    const mat = await db.materials.get(log.materialId);
    if (!mat) throw makeError(404, 'NOT_FOUND', '原料不存在');
    if (log.kind === 'in') {
      if (mat.stock < grams) throw makeError(400, 'VALIDATION', '当前库存不足，无法撤回该入库记录');
      mat.stock -= grams;
    } else {
      mat.stock += grams;
    }
    await db.materials.put(mat);
    await db.inventoryLogs.add({
      id: uid(),
      kind: kindOpp,
      materialId: mat.id,
      grams,
      refType: 'adjust',
      refId: marker,
      operator: operatorName || '',
      createdAt: nowIso(),
    } as any);
    return { ok: true };
  }

  // 成品流水
  if ((log as any).productId && (log as any).packages !== undefined && (log as any).packages !== null) {
    const productId = String((log as any).productId);
    const packages = Number((log as any).packages || 0);
    if (!(packages > 0)) throw makeError(400, 'VALIDATION', 'packages 非法');
    const prod = await db.products.get(productId);
    if (!prod) throw makeError(404, 'NOT_FOUND', '成品不存在');
    const current = Number(prod.stock || 0);
    if (log.kind === 'in') {
      if (current < packages) throw makeError(400, 'VALIDATION', '当前成品库存不足，无法撤回该入库记录');
      prod.stock = current - packages;
    } else {
      prod.stock = current + packages;
    }
    await db.products.put(prod);
    await db.inventoryLogs.add({
      id: uid(),
      kind: kindOpp,
      productId: prod.id,
      packages,
      refType: 'adjust',
      refId: marker,
      operator: operatorName || '',
      createdAt: nowIso(),
    } as any);
    return { ok: true };
  }

  throw makeError(400, 'VALIDATION', '该流水不支持撤回');
}

/**
 * 批量生产成品入库：将原料按配方扣减，增加对应产品的成品库存。
 *
 * 流程：
 * 1. 汇总校验所有原料是否充足
 * 2. 扣减原料 + 增加成品 stock + 写入流水
 */
export async function produce(items: Array<{ productId: string; qty: number; operator?: string }>): Promise<{ ok: true }> {
  if (!items.length) throw makeError(400, 'VALIDATION', 'items 不能为空');

  // 1) 汇总原料需求
  const materialNeeds = new Map<string, number>();
  for (const it of items) {
    const productId = String(it.productId || '');
    const qty = Number(it.qty || 0);
    if (!productId || !(qty > 0)) throw makeError(400, 'VALIDATION', 'productId/qty 非法');
    const product = await db.products.get(productId);
    if (!product) throw makeError(404, 'NOT_FOUND', `产品不存在: ${productId}`);
    for (const r of product.recipe) {
      const need = r.grams * qty;
      materialNeeds.set(r.materialId, (materialNeeds.get(r.materialId) || 0) + need);
    }
  }

  // 2) 校验原料库存
  const lacks: Array<{ materialId: string; need: number; stock: number }> = [];
  for (const [materialId, need] of materialNeeds.entries()) {
    const mat = await db.materials.get(materialId);
    if (!mat) throw makeError(404, 'NOT_FOUND', `原料不存在: ${materialId}`);
    if (mat.stock < need) lacks.push({ materialId, need, stock: mat.stock });
  }
  if (lacks.length) throw makeError(400, 'INSUFFICIENT_STOCK', '库存不足', lacks);

  // 3) 执行扣减和入库
  for (const it of items) {
    const productId = String(it.productId);
    const qty = Number(it.qty);
    const operator = String(it.operator || '');
    const product = (await db.products.get(productId))!;

    for (const r of product.recipe) {
      const mat = (await db.materials.get(r.materialId))!;
      const grams = r.grams * qty;
      mat.stock -= grams;
      await db.materials.put(mat);
      await db.inventoryLogs.add({
        id: uid(),
        kind: 'out',
        materialId: mat.id,
        grams,
        refType: 'produce',
        refId: productId,
        operator,
        createdAt: nowIso(),
      });
    }

    const current = product.stock || 0;
    product.stock = current + qty;
    await db.products.put(product);
    await db.inventoryLogs.add({
      id: uid(),
      kind: 'in',
      productId: product.id,
      packages: qty,
      refType: 'produce',
      refId: productId,
      operator,
      createdAt: nowIso(),
    });
  }

  return { ok: true };
}
