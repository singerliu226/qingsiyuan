/**
 * 种子数据初始化模块
 *
 * 首次打开应用时，检测 IndexedDB 是否为空，若为空则写入默认数据：
 * - 默认用户（店长 / 店员）
 * - 5 种原料
 * - 4 种产品及配方
 * - 默认定价配置与方案
 *
 * 逻辑与服务端 seed.ts + storage.ts defaultDb 保持一致。
 */
import bcrypt from 'bcryptjs';
import { db } from './schema';
import type { User, Product, ProductRecipeItem, PricingConfig } from './schema';

/** 生成简单的唯一 ID（nanoid 替代方案，避免额外依赖） */
function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

/**
 * 初始化数据库种子数据。
 * 幂等设计：仅在对应表为空时写入，不会覆盖已有数据。
 */
export async function ensureSeed(): Promise<void> {
  await ensureUsers();
  await ensureCatalog();
  await ensurePricing();
}

// ===================== 用户种子 =====================

async function ensureUsers(): Promise<void> {
  const count = await db.users.count();
  if (count > 0) return;

  const owner: User = {
    id: uid(),
    name: '店长',
    phone: '13800000000',
    role: 'owner',
    passwordHash: bcrypt.hashSync('123456', 10),
    status: 'active',
  };
  const staff: User = {
    id: uid(),
    name: '店员',
    phone: '13900000000',
    role: 'staff',
    passwordHash: bcrypt.hashSync('123456', 10),
    status: 'active',
  };
  await db.users.bulkAdd([owner, staff]);
}

// ===================== 原料 & 产品种子 =====================

async function ensureCatalog(): Promise<void> {
  const matCount = await db.materials.count();
  const prodCount = await db.products.count();
  if (matCount > 0 && prodCount > 0) return;

  // 1) 原料
  const materialNames = ['黑发粉', '营养粉', '生发粉', '防脱粉', '消炎粉'] as const;
  const nameToId = new Map<string, string>();

  for (const name of materialNames) {
    let m = await db.materials.where('name').equals(name).first();
    if (!m) {
      m = { id: uid(), name, unit: 'g' as const, stock: 0, threshold: 0 };
      await db.materials.add(m);
    }
    nameToId.set(name, m.id);
  }

  // 2) 产品与配方
  const makeProduct = async (
    name: string,
    priceBase: number,
    recipe: Array<[string, number]>,
  ): Promise<void> => {
    const existing = await db.products.where('name').equals(name).first();
    const recipeItems: ProductRecipeItem[] = recipe.map(([matName, grams]) => ({
      materialId: nameToId.get(matName)!,
      grams,
    }));
    if (existing) {
      // 保留历史价格，仅更新配方
      await db.products.update(existing.id, { recipe: recipeItems });
    } else {
      const p: Product = { id: uid(), name, priceBase, recipe: recipeItems };
      await db.products.add(p);
    }
  };

  await makeProduct('黑发药包', 120, [['黑发粉', 60], ['营养粉', 15]]);
  await makeProduct('生发药包', 120, [['黑发粉', 30], ['生发粉', 30], ['营养粉', 15]]);
  await makeProduct('防脱药包', 120, [['黑发粉', 30], ['防脱粉', 30], ['营养粉', 15]]);
  await makeProduct('消炎药包', 120, [['黑发粉', 30], ['消炎粉', 30], ['营养粉', 15]]);
}

// ===================== 定价种子 =====================

async function ensurePricing(): Promise<void> {
  const existing = await db.pricing.get('default');
  if (existing) return;

  const pricing: PricingConfig = {
    id: 'default',
    self: 0,
    vip: 0.8,
    temp: 1,
    // 简化定价：不注入默认方案，使用者自行在“定价”页面创建折扣方案
    plans: [],
  };
  await db.pricing.add(pricing);
}
