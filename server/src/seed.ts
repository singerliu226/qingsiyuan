import { nanoid } from 'nanoid';
import { storage } from './storage';
import type { Material, Product, ProductRecipeItem, PricingPlan } from './types';

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
 * 初始化开业活动定价方案（当 pricing.plans 为空时）。
 * 方案来源：历史版本的“开业暂定价目表”（现已改为“可自由配置的定价方案”）。
 */
export function ensurePricingSeed(): void {
  const p = storage.pricing as any;
  const hasPlans = Array.isArray(p?.plans) && p.plans.length > 0;
  const plansExisting: PricingPlan[] = hasPlans ? (p.plans as PricingPlan[]) : [];
  const plans: PricingPlan[] = [
    // 说明：自 v0.1.0 起，默认不再内置“开业活动方案”。
    // 原因：不同门店/时期的营销策略差异大，内置固定方案反而限制灵活配置；
    // 操作者可在“定价策略”页自由新增/修改/删除方案。
  ];

  // 迁移：如果历史数据中存在“开业一次性活动”方案，则自动移除。
  // 仅针对明确的 name 精确匹配，避免误删用户自定义方案。
  if (hasPlans) {
    const removed = plansExisting.filter(pl => String(pl.name) === '一次性活动');
    if (removed.length) {
      const next = { ...p, plans: plansExisting.filter(pl => String(pl.name) !== '一次性活动') } as any;
      storage.setPricing(next);
    }
    // 若已存在方案，不进行覆盖
    return;
  }

  // 新安装：默认不注入任何方案，保持空列表。
  const next = { ...p, plans: [] } as any;
  storage.setPricing(next);
}


