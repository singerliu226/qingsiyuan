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
 * 方案来源：用户提供的“开业暂定价目表”。
 */
export function ensurePricingSeed(): void {
  const p = storage.pricing as any;
  const hasPlans = Array.isArray(p?.plans) && p.plans.length > 0;
  if (hasPlans) return;
  const plans: PricingPlan[] = [
    // 分销（三档）
    { id: nanoid(), group: 'distrib', name: '分销一', setPrice: 14280, packCount: 45, perPackPrice: 317, remark: '分销首次拿货3个15次疗程套装；按零售价7折' },
    { id: nanoid(), group: 'distrib', name: '分销二', setPrice: 20400, packCount: 75, perPackPrice: 272, remark: '拿货5个15次疗程套装；按零售价6折' },
    { id: nanoid(), group: 'distrib', name: '分销三', setPrice: 102000, packCount: 450, perPackPrice: 227, remark: '拿货30个15次疗程套装；按零售价5折' },
    // 零售（两档） + VIP
    { id: nanoid(), group: 'retail', name: 'VIP', setPrice: 2000, packCount: 15, perPackPrice: 133, remark: '亲朋体验15次疗程套装2000元15包' },
    { id: nanoid(), group: 'retail', name: '零售一', setPrice: 6800, packCount: 15, perPackPrice: 453, remark: '零售15次疗程套装6800元15包' },
    { id: nanoid(), group: 'retail', name: '零售二', setPrice: 12300, packCount: 30, perPackPrice: 410, remark: '零售30次疗程套装12300元30包' },
    // 临时活动（三档） + 一次性活动
    { id: nanoid(), group: 'temp', name: '临时活动一', setPrice: 999, packCount: 3, perPackPrice: 333, remark: '开业活动999元3次疗程' },
    { id: nanoid(), group: 'temp', name: '临时活动二', setPrice: 5780, packCount: 15, perPackPrice: 385, remark: '好友推荐8.5折（小程序登记推荐人）' },
    { id: nanoid(), group: 'temp', name: '临时活动三', setPrice: 1088, packCount: 3, perPackPrice: 363, remark: '3次体验8折优惠券' },
    { id: nanoid(), group: 'temp', name: '一次性活动', setPrice: 0, packCount: 15, perPackPrice: 0, remark: '三位被试15次疗程免费' },
  ];
  const next = { ...p, plans } as any;
  storage.setPricing(next);
}


