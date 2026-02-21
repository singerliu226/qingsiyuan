import { nanoid } from 'nanoid';
import { storage } from './storage';
import type { Material, Product, ProductRecipeItem, PricingConfig } from './types';

/**
 * 初始化/对齐业务数据（材料与产品+配方）。
 * 不覆盖已有价格，仅在不存在时创建；若已存在则更新配方为最新规则。
 */
export function ensureCatalogSeed(): void {
  // 1) 原料字典
  const materialNames = ['黑发粉', '营养粉', '生发粉', '防脱粉', '消炎粉'] as const;
  const nameToId = new Map<string, string>();

  for (const name of materialNames) {
    let m = storage.materials.find(x => x.name === name);
    if (!m) {
      m = { id: nanoid(), name, unit: 'g', stock: 0, threshold: 0 } as Material;
      storage.upsertMaterial(m);
    }
    nameToId.set(name, m.id);
  }

  // 2) 产品与配方（克数按业务规则）
  const make = (name: string, priceBase: number, recipe: Array<[string, number]>): void => {
    const product = storage.products.find(p => p.name === name);
    const recipeItems: ProductRecipeItem[] = recipe.map(([matName, grams]) => ({
      materialId: nameToId.get(matName)!,
      grams,
    }));
    if (product) {
      // 保留历史价格，更新配方
      const next: Product = { ...product, recipe: recipeItems } as Product;
      storage.upsertProduct(next);
    } else {
      const next: Product = {
        id: nanoid(),
        name,
        priceBase,
        recipe: recipeItems,
      } as Product;
      storage.upsertProduct(next);
    }
  };

  make('黑发药包', 120, [['黑发粉', 60], ['营养粉', 15]]);
  make('生发药包', 120, [['黑发粉', 30], ['生发粉', 30], ['营养粉', 15]]);
  make('防脱药包', 120, [['黑发粉', 30], ['防脱粉', 30], ['营养粉', 15]]);
  make('消炎药包', 120, [['黑发粉', 30], ['消炎粉', 30], ['营养粉', 15]]);
}


/**
 * 初始化定价配置的基础字段（幂等）。
 *
 * 设计说明：
 * - 当前版本不再注入任何“默认方案”，避免把定价复杂度强加给使用者；
 * - 仅保证 self/vip/temp 三个折扣字段与 plans 数组存在，方便前端直接编辑。
 */
export function ensurePricingSeed(): void {
  const p = storage.pricing as any;
  const next: PricingConfig = {
    // “自用/赠送”默认免费：缺省为 0，门店如需收费可在 UI 中修改
    self: isFinite(Number(p?.self)) ? Number(p.self) : 0,
    vip: isFinite(Number(p?.vip)) ? Number(p.vip) : 0.8,
    temp: isFinite(Number(p?.temp)) ? Number(p.temp) : 1,
    plans: Array.isArray(p?.plans) ? p.plans : [],
  };
  storage.setPricing(next);
}


