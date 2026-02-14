/**
 * 产品服务
 *
 * 提供产品 CRUD、成品库存管理、配方验证、使用统计等功能。
 */
import { db } from '../db/schema';
import type { Product, ProductRecipeItem, InventoryLog } from '../db/schema';
import { uid, makeError } from './auth-service';

function nowIso(): string {
  return new Date().toISOString();
}

/** 获取全部产品列表 */
export async function list(): Promise<Product[]> {
  return db.products.toArray();
}

/** 创建新产品 */
export async function create(data: Partial<Product>): Promise<Product> {
  if (!data.name || typeof data.priceBase !== 'number') {
    throw makeError(400, 'VALIDATION', 'name 与 priceBase 必填');
  }
  const recipe = Array.isArray(data.recipe) ? data.recipe as ProductRecipeItem[] : [];
  await validateRecipe(recipe);
  const product: Product = {
    id: uid(),
    name: data.name,
    priceBase: data.priceBase,
    recipe,
  };
  await db.products.add(product);
  return product;
}

/** 更新产品（名称/基础价/配方） */
export async function update(id: string, data: Partial<Product>): Promise<Product> {
  const product = await db.products.get(id);
  if (!product) throw makeError(404, 'NOT_FOUND', '产品不存在');
  if (data.name !== undefined) product.name = String(data.name);
  if (data.priceBase !== undefined) {
    const pb = Number(data.priceBase);
    if (!(pb >= 0)) throw makeError(400, 'VALIDATION', 'priceBase 非法');
    product.priceBase = pb;
  }
  if (data.recipe !== undefined) {
    const recipe = Array.isArray(data.recipe) ? (data.recipe as ProductRecipeItem[]) : [];
    await validateRecipe(recipe);
    product.recipe = recipe;
  }
  await db.products.put(product);
  return product;
}

/**
 * 手工减少成品库存（盘点场景）。
 * 不回滚原料，仅调整 stock 字段。
 */
export async function decreaseStock(id: string, qty: number, operator: string): Promise<{ ok: true; stock: number }> {
  const product = await db.products.get(id);
  if (!product) throw makeError(404, 'NOT_FOUND', '产品不存在');
  if (!(qty > 0)) throw makeError(400, 'VALIDATION', 'qty 必须大于 0');
  const current = Number(product.stock || 0);
  if (current < qty) throw makeError(400, 'VALIDATION', '成品库存不足');
  product.stock = current - qty;
  await db.products.put(product);
  const log: InventoryLog = {
    id: uid(),
    kind: 'out',
    productId: product.id,
    packages: qty,
    refType: 'adjust',
    refId: `product-adjust-${Date.now()}`,
    operator,
    createdAt: nowIso(),
  };
  await db.inventoryLogs.add(log);
  return { ok: true, stock: product.stock };
}

/** 产品使用统计（订单维度） */
export async function usage(id: string): Promise<{ count: number; totalQty: number; recent: Array<{ id: string; qty: number; receivable: number; createdAt: string }> }> {
  const orders = await db.orders.where('productId').equals(id).toArray();
  const totalQty = orders.reduce((s, o) => s + o.qty, 0);
  const recent = orders
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .slice(0, 20)
    .map(o => ({ id: o.id, qty: o.qty, receivable: o.receivable, createdAt: o.createdAt }));
  return { count: orders.length, totalQty, recent };
}

// ===================== 内部工具 =====================

/** 校验配方中的原料是否存在 */
async function validateRecipe(recipe: ProductRecipeItem[]): Promise<void> {
  for (const item of recipe) {
    if (!item.materialId || typeof item.grams !== 'number' || item.grams <= 0) {
      throw makeError(400, 'VALIDATION', 'recipe 不合法');
    }
    const mat = await db.materials.get(item.materialId);
    if (!mat) throw makeError(404, 'NOT_FOUND', `原料不存在: ${item.materialId}`);
  }
}
