/**
 * 进货服务
 *
 * 提供原料入库（单条/批量）和进货撤回功能。
 * 所有操作都会同步更新原料库存并写入库存流水。
 */
import { db } from '../db/schema';
import type { Purchase } from '../db/schema';
import { uid, makeError } from './auth-service';

function nowIso(): string {
  return new Date().toISOString();
}

/** 获取全部进货记录 */
export async function list(): Promise<Purchase[]> {
  return db.purchases.toArray();
}

/** 单条入库 */
export async function create(data: { materialId: string; grams: number; cost?: number; operator?: string }): Promise<Purchase> {
  const mat = await db.materials.get(data.materialId);
  if (!mat) throw makeError(404, 'NOT_FOUND', '原料不存在');
  const g = Number(data.grams);
  const c = Number(data.cost || 0);
  if (!(g > 0)) throw makeError(400, 'VALIDATION', 'grams 必须大于 0');
  const purchase: Purchase = {
    id: uid(),
    materialId: data.materialId,
    grams: g,
    cost: c,
    operator: String(data.operator || ''),
    createdAt: nowIso(),
  };
  await db.purchases.add(purchase);
  mat.stock += g;
  await db.materials.put(mat);
  await db.inventoryLogs.add({
    id: uid(),
    kind: 'in',
    materialId: data.materialId,
    grams: g,
    refType: 'purchase',
    refId: purchase.id,
    operator: purchase.operator || '',
    createdAt: nowIso(),
  });
  return purchase;
}

/**
 * 批量入库：一次性为多种原料增加库存并记录流水。
 */
export async function batchCreate(items: Array<{ materialId: string; grams: number; cost?: number; operator?: string }>): Promise<{ ok: true; count: number; purchases: Purchase[] }> {
  if (!items.length) throw makeError(400, 'VALIDATION', 'items 不能为空');
  const purchases: Purchase[] = [];
  for (const it of items) {
    const mat = await db.materials.get(it.materialId);
    if (!mat) throw makeError(404, 'NOT_FOUND', `原料不存在: ${it.materialId}`);
    const g = Number(it.grams);
    const c = Number(it.cost || 0);
    if (!(g > 0)) throw makeError(400, 'VALIDATION', 'grams 必须大于 0');
    const purchase: Purchase = {
      id: uid(),
      materialId: it.materialId,
      grams: g,
      cost: c,
      operator: String(it.operator || ''),
      createdAt: nowIso(),
    };
    await db.purchases.add(purchase);
    mat.stock += g;
    await db.materials.put(mat);
    await db.inventoryLogs.add({
      id: uid(),
      kind: 'in',
      materialId: it.materialId,
      grams: g,
      refType: 'purchase',
      refId: purchase.id,
      operator: purchase.operator || '',
      createdAt: nowIso(),
    });
    purchases.push(purchase);
  }
  return { ok: true, count: purchases.length, purchases };
}

/**
 * 撤回进货：回滚库存、删除进货记录、写入对冲流水。
 */
export async function revoke(id: string, operatorName: string): Promise<{ ok: true; purchaseId: string; materialId: string; grams: number; stock: number }> {
  const purchase = await db.purchases.get(id);
  if (!purchase) throw makeError(404, 'NOT_FOUND', '进货记录不存在');
  const mat = await db.materials.get(purchase.materialId);
  if (!mat) throw makeError(404, 'NOT_FOUND', '原料不存在');
  const grams = Number(purchase.grams || 0);
  if (!(grams > 0)) throw makeError(400, 'VALIDATION', '进货记录 grams 非法');
  if (mat.stock < grams) {
    throw makeError(400, 'VALIDATION', '当前库存不足，无法撤回该进货记录（可能已被消耗）', {
      materialId: mat.id,
      need: grams,
      stock: mat.stock,
    });
  }
  // 1) 回滚库存
  mat.stock -= grams;
  await db.materials.put(mat);
  // 2) 删除进货记录
  await db.purchases.delete(id);
  // 3) 写入对冲流水
  const operator = operatorName || purchase.operator || '';
  await db.inventoryLogs.add({
    id: uid(),
    kind: 'out',
    materialId: mat.id,
    grams,
    refType: 'adjust',
    refId: `revoke-purchase-${id}`,
    operator,
    createdAt: nowIso(),
  });
  return { ok: true, purchaseId: id, materialId: mat.id, grams, stock: mat.stock };
}
