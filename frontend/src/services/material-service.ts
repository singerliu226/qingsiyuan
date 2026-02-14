/**
 * 原料服务
 *
 * 提供原料的 CRUD、库存增减、批量归零等功能。
 * 所有库存变动都会写入 inventoryLogs 流水表。
 */
import { db } from '../db/schema';
import type { Material, InventoryLog } from '../db/schema';
import { uid, makeError } from './auth-service';

function nowIso(): string {
  return new Date().toISOString();
}

/** 获取全部原料列表 */
export async function list(): Promise<Material[]> {
  return db.materials.toArray();
}

/** 创建新原料 */
export async function create(data: Partial<Material>): Promise<Material> {
  if (!data.name) throw makeError(400, 'VALIDATION', 'name 必填');
  const mat: Material = {
    id: uid(),
    name: data.name,
    unit: 'g',
    stock: Number(data.stock || 0),
    threshold: Number(data.threshold || 0),
  };
  await db.materials.add(mat);
  return mat;
}

/** 更新原料信息（名称、库存、阈值） */
export async function update(id: string, data: { name?: string; stock?: number; threshold?: number }): Promise<Material> {
  const mat = await db.materials.get(id);
  if (!mat) throw makeError(404, 'NOT_FOUND', '原料不存在');
  if (data.name !== undefined) mat.name = String(data.name);
  if (data.stock !== undefined) mat.stock = Number(data.stock);
  if (data.threshold !== undefined) mat.threshold = Number(data.threshold);
  await db.materials.put(mat);
  return mat;
}

/**
 * 手工减少原料库存（盘点报损等场景）。
 * 会写入 kind='out', refType='adjust' 的流水记录。
 */
export async function decrease(id: string, grams: number, operator: string): Promise<{ ok: true; stock: number }> {
  const mat = await db.materials.get(id);
  if (!mat) throw makeError(404, 'NOT_FOUND', '原料不存在');
  if (!(grams > 0)) throw makeError(400, 'VALIDATION', 'grams 必须大于 0');
  if (mat.stock < grams) {
    throw makeError(400, 'INSUFFICIENT_STOCK', '库存不足', [{ materialId: mat.id, need: grams, stock: mat.stock }]);
  }
  mat.stock -= grams;
  await db.materials.put(mat);
  const log: InventoryLog = {
    id: uid(),
    kind: 'out',
    materialId: mat.id,
    grams,
    refType: 'adjust',
    refId: `adjust-${Date.now()}`,
    operator,
    createdAt: nowIso(),
  };
  await db.inventoryLogs.add(log);
  return { ok: true, stock: mat.stock };
}

/** 批量将所有原料库存归零（仅店长使用） */
export async function zeroAll(): Promise<{ ok: true; count: number }> {
  const all = await db.materials.toArray();
  for (const m of all) {
    if (m.stock !== 0) {
      m.stock = 0;
      await db.materials.put(m);
    }
  }
  return { ok: true, count: all.length };
}
