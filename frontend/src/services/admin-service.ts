/**
 * 管理服务
 *
 * 提供定价管理、数据备份导出/导入（JSON 格式）等管理功能。
 * 替代服务端的 /admin/* 和 /pricing 相关接口。
 */
import { db } from '../db/schema';
import type { PricingConfig, PricingPlan, DbExportShape } from '../db/schema';
import { uid, makeError } from './auth-service';
import { ensureSeed } from '../db/seed';

// ===================== 定价管理 =====================

/** 获取定价配置（含 plans） */
export async function getPricing(): Promise<PricingConfig> {
  const p = await db.pricing.get('default');
  if (!p) {
    // 若不存在（不应发生），返回默认值
    return { id: 'default', self: 0, vip: 0.8, temp: 1, plans: [] };
  }
  return p;
}

/** 更新定价配置 */
export async function updatePricing(body: Record<string, unknown>): Promise<PricingConfig> {
  const p = await getPricing();
  const next = { ...p } as PricingConfig;

  for (const k of ['self', 'vip', 'temp'] as const) {
    if (body[k] !== undefined) {
      const v = Number(body[k]);
      if (!isFinite(v) || v < 0) throw makeError(400, 'VALIDATION', `${k} 折扣需为非负数`);
      next[k] = v;
    }
  }

  if (Array.isArray(body.plans)) {
    const plans: PricingPlan[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const it of body.plans as Array<any>) {
      if (!it || !it.group || !it.name) throw makeError(400, 'VALIDATION', 'plans 不合法');
      const group = String(it.group) as PricingPlan['group'];
      if (!['self', 'vip', 'temp'].includes(group)) throw makeError(400, 'VALIDATION', 'group 非法');
      const discount = Number(it.discount);
      if (!isFinite(discount) || discount < 0) throw makeError(400, 'VALIDATION', 'discount 非法');
      plans.push({
        id: (it.id as string) || uid(),
        group,
        name: it.name as string,
        discount,
        remark: it.remark as string | undefined,
      });
    }
    next.plans = plans;
  }

  await db.pricing.put(next);
  return next;
}

/**
 * 获取前台可见的方案列表（只读），含 VIP 分组映射。
 * 与服务端 GET /pricing/plans 逻辑一致。
 */
export async function getPlans(): Promise<{ plans: PricingPlan[] }> {
  const pricing = await getPricing();
  const plansRaw = Array.isArray(pricing.plans) ? pricing.plans : [];
  const plans = plansRaw.filter(p => ['self', 'vip', 'temp'].includes(String((p as any).group)));
  return { plans };
}

// ===================== 数据备份与恢复 =====================

/**
 * 导出全部数据为 JSON 字符串。
 * 格式与服务端 db.json 完全一致，方便互相导入。
 */
export async function exportDatabase(): Promise<string> {
  const users = await db.users.toArray();
  const materials = await db.materials.toArray();
  const products = await db.products.toArray();
  const orders = await db.orders.toArray();
  const purchases = await db.purchases.toArray();
  const inventoryLogs = await db.inventoryLogs.toArray();
  const pricingRow = await db.pricing.get('default');
  // 导出时去除 IndexedDB 的 id 主键，与服务端格式对齐
  const pricing = pricingRow
    ? { self: pricingRow.self, vip: pricingRow.vip, temp: pricingRow.temp, plans: pricingRow.plans || [] }
    : { self: 0, vip: 0.8, temp: 1, plans: [] };

  const data: DbExportShape = { users, materials, products, orders, purchases, inventoryLogs, pricing };
  return JSON.stringify(data, null, 2);
}

/**
 * 触发浏览器下载 JSON 文件。
 */
export function downloadJson(content: string, filename: string): void {
  const blob = new Blob([content], { type: 'application/json; charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * 触发浏览器下载 CSV 文件。
 */
export function downloadCsv(content: string, filename: string): void {
  const blob = new Blob(['\uFEFF' + content], { type: 'text/csv; charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * 从 JSON 字符串导入数据（覆盖当前数据库）。
 * 支持服务端 db.json 格式直接导入。
 */
export async function importDatabase(jsonContent: string): Promise<void> {
  let parsed: DbExportShape;
  try {
    parsed = JSON.parse(jsonContent);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : '';
    throw makeError(400, 'VALIDATION', `JSON 解析失败: ${msg}`);
  }

  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.users) || !Array.isArray(parsed.materials)) {
    throw makeError(400, 'VALIDATION', '备份文件结构不正确，缺少 users/materials 等字段');
  }

  // 清空全部数据表再写入
  await db.transaction('rw', [db.users, db.materials, db.products, db.orders, db.purchases, db.inventoryLogs, db.pricing], async () => {
    await db.users.clear();
    await db.materials.clear();
    await db.products.clear();
    await db.orders.clear();
    await db.purchases.clear();
    await db.inventoryLogs.clear();
    await db.pricing.clear();

    if (parsed.users?.length) await db.users.bulkAdd(parsed.users);
    if (parsed.materials?.length) await db.materials.bulkAdd(parsed.materials);
    if (parsed.products?.length) await db.products.bulkAdd(parsed.products);
    if (parsed.orders?.length) await db.orders.bulkAdd(parsed.orders);
    if (parsed.purchases?.length) await db.purchases.bulkAdd(parsed.purchases);
    if (parsed.inventoryLogs?.length) await db.inventoryLogs.bulkAdd(parsed.inventoryLogs);

    // pricing：服务端格式没有 id 字段，需要补充
    const pricing = parsed.pricing || { self: 0, vip: 0.8, temp: 1, plans: [] };
    // 兼容旧备份：若存在 event 字段则映射到 temp；并清空旧方案（清空重做）
    const temp = (pricing as any).temp !== undefined ? Number((pricing as any).temp) : ((pricing as any).event !== undefined ? Number((pricing as any).event) : 1);
    const self = (pricing as any).self !== undefined ? Number((pricing as any).self) : 0;
    await db.pricing.add({ id: 'default', self: isFinite(self) ? self : 0, vip: Number((pricing as any).vip || 0.8), temp: isFinite(temp) ? temp : 1, plans: [] } as PricingConfig);
  });
}

/** 原料库存批量归零 */
export async function materialsZero(): Promise<{ ok: true; count: number }> {
  const all = await db.materials.toArray();
  for (const m of all) {
    if (m.stock !== 0) {
      m.stock = 0;
      await db.materials.put(m);
    }
  }
  return { ok: true, count: all.length };
}

/** 初始化定价种子 */
export async function seedPricing(): Promise<PricingConfig> {
  await ensureSeed();
  return getPricing();
}

/**
 * 备份相关：离线模式下直接用导出/导入替代。
 * 以下方法用于兼容前端设置页中的备份列表 UI。
 */
export function getBackupConfig(): { enabled: boolean; hours: number; retain: number } {
  return { enabled: false, hours: 24, retain: 7 };
}

export function setBackupConfig(_cfg: Record<string, unknown>): { enabled: boolean; hours: number; retain: number } {
  // 离线模式下不支持自动备份，返回默认配置
  return { enabled: false, hours: 24, retain: 7 };
}
