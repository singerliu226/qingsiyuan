/**
 * 订单服务
 *
 * 实现取货登记的核心业务逻辑：
 * - 下单：优先扣减成品库存，不足时按配方扣减原料
 * - 撤单：5 分钟内可撤销，反向回滚库存
 * - 验证：预计算应收金额和库存充足性
 *
 * 所有库存变动都会写入 inventoryLogs 流水表。
 */
import { db } from '../db/schema';
import type { Order, OrderType, PricingPlanGroup } from '../db/schema';
import { uid, makeError } from './auth-service';

function nowIso(): string {
  return new Date().toISOString();
}

/** 获取全部订单列表 */
export async function list(): Promise<Order[]> {
  return db.orders.toArray();
}

/**
 * 创建订单（取货登记）。
 *
 * 库存扣减顺序：
 * 1. 先扣减成品库存 Product.stock
 * 2. 成品不足时按 Product.recipe 扣减原料
 *
 * 应收计算：优先使用定价方案的 discount，否则 priceBase * 默认折扣
 */
export async function create(data: {
  type?: string;
  productId: string;
  qty?: number;
  person?: string;
  payment?: string;
  pricingGroup?: string;
  pricingPlanId?: string;
  remark?: string;
  receivableOverride?: number;
}): Promise<{ id: string; receivable: number; createdAt: string }> {
  const t = (data.type || 'retail') as OrderType;
  const validTypes = ['self', 'vip', 'distrib', 'retail', 'temp', 'event', 'test', 'gift'];
  if (!validTypes.includes(t)) throw makeError(400, 'VALIDATION', 'type 非法');

  const product = await db.products.get(data.productId);
  if (!product) throw makeError(404, 'NOT_FOUND', '产品不存在');

  const q = Number(data.qty || 1);
  if (!(q > 0)) throw makeError(400, 'VALIDATION', 'qty 必须大于 0');

  const productStock = Number(product.stock || 0);
  const useFinished = Math.min(productStock, q);
  const needFromRaw = q - useFinished;

  // 校验原料充足性
  if (needFromRaw > 0) {
    await checkRawMaterialStock(product.recipe, needFromRaw);
  }

  // 计算应收
  const discount = await resolveDiscount(
    data.pricingGroup as PricingPlanGroup | 'vip' | undefined,
    data.pricingPlanId,
    t,
  );
  const unit = Number((product.priceBase * discount).toFixed(2));
  const receivable = Number((unit * q).toFixed(2));

  const orderId = uid();

  // 1) 扣减成品库存
  if (useFinished > 0) {
    product.stock = productStock - useFinished;
    await db.products.put(product);
    await db.inventoryLogs.add({
      id: uid(),
      kind: 'out',
      productId: product.id,
      packages: useFinished,
      refType: 'order',
      refId: orderId,
      operator: data.person || '',
      createdAt: nowIso(),
    });
  }

  // 2) 按配方扣减原料
  if (needFromRaw > 0) {
    for (const item of product.recipe) {
      const mat = await db.materials.get(item.materialId);
      if (!mat) throw makeError(400, 'NOT_FOUND', `原料不存在: ${item.materialId}`);
      const grams = item.grams * needFromRaw;
      mat.stock -= grams;
      await db.materials.put(mat);
      await db.inventoryLogs.add({
        id: uid(),
        kind: 'out',
        materialId: mat.id,
        grams,
        refType: 'order',
        refId: orderId,
        operator: data.person || '',
        createdAt: nowIso(),
      });
    }
  }

  // 计算最终应收（支持前端覆盖）
  const overrideRaw = data.receivableOverride;
  const override = overrideRaw !== undefined && overrideRaw !== null ? Number(overrideRaw) : undefined;
  const finalReceivable = override !== undefined && isFinite(override) && override >= 0
    ? Number(override.toFixed(2))
    : receivable;

  const order: Order = {
    id: orderId,
    type: t,
    productId: product.id,
    qty: q,
    usedFinished: useFinished || undefined,
    person: data.person || '',
    receivable: finalReceivable,
    payment: (data.payment || '') as Order['payment'],
    createdAt: nowIso(),
    pricingGroup: data.pricingGroup as Order['pricingGroup'],
    pricingPlanId: data.pricingPlanId,
    perPackPrice: unit,
    discountApplied: discount,
    remark: data.remark ? String(data.remark) : undefined,
  };
  await db.orders.add(order);
  return { id: order.id, receivable: order.receivable, createdAt: order.createdAt };
}

/**
 * 撤销订单（5 分钟内）：回滚成品库存和原料库存。
 */
export async function cancel(id: string): Promise<{ ok: true }> {
  const order = await db.orders.get(id);
  if (!order) throw makeError(404, 'NOT_FOUND', '订单不存在');

  const created = new Date(order.createdAt).getTime();
  if (Date.now() - created > 5 * 60 * 1000) {
    throw makeError(400, 'VALIDATION', '撤销窗口已过期');
  }

  const product = await db.products.get(order.productId);
  if (!product) throw makeError(400, 'NOT_FOUND', '产品不存在');

  const usedFinished = order.usedFinished || 0;
  const usedRaw = order.qty - usedFinished;

  // 回滚成品库存
  if (usedFinished > 0) {
    product.stock = Number(product.stock || 0) + usedFinished;
    await db.products.put(product);
    await db.inventoryLogs.add({
      id: uid(),
      kind: 'in',
      productId: product.id,
      packages: usedFinished,
      refType: 'order',
      refId: order.id,
      createdAt: nowIso(),
    });
  }

  // 回滚原料库存
  if (usedRaw > 0) {
    for (const item of product.recipe) {
      const mat = await db.materials.get(item.materialId);
      if (!mat) throw makeError(400, 'NOT_FOUND', `原料不存在: ${item.materialId}`);
      const grams = item.grams * usedRaw;
      mat.stock += grams;
      await db.materials.put(mat);
      await db.inventoryLogs.add({
        id: uid(),
        kind: 'in',
        materialId: mat.id,
        grams,
        refType: 'order',
        refId: order.id,
        createdAt: nowIso(),
      });
    }
  }

  await db.orders.delete(order.id);
  return { ok: true };
}

/**
 * 订单预校验：返回应收金额与库存充足性，不实际扣库存。
 */
export async function validate(data: {
  type?: string;
  productId: string;
  qty?: number;
  pricingGroup?: string;
  pricingPlanId?: string;
}): Promise<{ receivable: number; perPackPrice: number; discountApplied: number; usedFinished: number; usedFromRaw: number }> {
  const t = (data.type || 'retail') as OrderType;
  const validTypes = ['self', 'vip', 'distrib', 'retail', 'temp', 'event', 'test', 'gift'];
  if (!validTypes.includes(t)) throw makeError(400, 'VALIDATION', 'type 非法');

  const product = await db.products.get(data.productId);
  if (!product) throw makeError(404, 'NOT_FOUND', '产品不存在');

  const q = Number(data.qty || 1);
  if (!(q > 0)) throw makeError(400, 'VALIDATION', 'qty 必须大于 0');

  const productStock = Number(product.stock || 0);
  const useFinished = Math.min(productStock, q);
  const needFromRaw = q - useFinished;

  if (needFromRaw > 0) {
    await checkRawMaterialStock(product.recipe, needFromRaw);
  }

  const discount = await resolveDiscount(
    data.pricingGroup as PricingPlanGroup | 'vip' | undefined,
    data.pricingPlanId,
    t,
  );
  const unit = Number((product.priceBase * discount).toFixed(2));
  const receivable = Number((unit * q).toFixed(2));

  return { receivable, perPackPrice: unit, discountApplied: discount, usedFinished: useFinished, usedFromRaw: needFromRaw };
}

// ===================== 内部工具 =====================

/** 校验原料库存是否足够 */
async function checkRawMaterialStock(recipe: Array<{ materialId: string; grams: number }>, qty: number): Promise<void> {
  const lacks: Array<{ materialId: string; need: number; stock: number }> = [];
  for (const item of recipe) {
    const mat = await db.materials.get(item.materialId);
    if (!mat) throw makeError(400, 'NOT_FOUND', `原料不存在: ${item.materialId}`);
    const need = item.grams * qty;
    if (mat.stock < need) lacks.push({ materialId: mat.id, need, stock: mat.stock });
  }
  if (lacks.length) throw makeError(400, 'INSUFFICIENT_STOCK', '库存不足', lacks);
}

/**
 * 根据定价方案 ID 或分组查找 discount。
 * 与服务端 resolveDiscount 逻辑一致。
 */
async function resolveDiscount(
  group: PricingPlanGroup | 'vip' | undefined,
  planId: string | undefined,
  type: OrderType,
): Promise<number> {
  const pricing = await db.pricing.get('default');
  const plans = pricing?.plans || [];

  if (planId) {
    const byId = plans.find(p => p.id === planId);
    if (byId) {
      const discount = Number((byId as any).discount);
      return isFinite(discount) && discount >= 0 ? discount : defaultDiscount(group, type, pricing);
    }
  }
  if (group) {
    const byGroup = plans.find(p => p.group === group);
    if (byGroup) {
      const discount = Number((byGroup as any).discount);
      return isFinite(discount) && discount >= 0 ? discount : defaultDiscount(group, type, pricing);
    }
  }
  return defaultDiscount(group, type, pricing);
}

function defaultDiscount(group: PricingPlanGroup | 'vip' | undefined, type: OrderType, pricing: any): number {
  const g =
    group ||
    (type === 'self' ? 'self' : type === 'vip' ? 'vip' : type === 'temp' ? 'temp' : undefined);
  // “自用/赠送”默认免费：self 缺省为 0（使用者如需收费可在“定价”里调整 self 默认折扣或选择方案）
  if (g === 'self') return isFinite(Number(pricing?.self)) ? Number(pricing?.self) : 0;
  if (g === 'vip') return Number(pricing?.vip ?? 1) || 1;
  if (g === 'temp') return Number(pricing?.temp ?? (pricing?.event ?? 1)) || 1;
  if (type === 'gift') return 0;
  return 1;
}
