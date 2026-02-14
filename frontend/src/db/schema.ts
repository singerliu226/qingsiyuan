/**
 * 本地 IndexedDB 数据库 Schema 定义
 *
 * 使用 Dexie.js 封装 IndexedDB，提供与服务端 db.json 完全一致的数据模型。
 * 所有类型定义复用自服务端 types.ts，确保数据结构一致，方便导入/导出迁移。
 */
import Dexie, { type Table } from 'dexie';

// ===================== 类型定义（与服务端 types.ts 保持一致） =====================

export type UserRole = 'owner' | 'staff';

export interface User {
  id: string;
  name: string;
  phone: string;
  role: UserRole;
  passwordHash: string;
  status: 'active' | 'disabled';
}

export interface Material {
  id: string;
  name: string;
  unit: 'g';
  stock: number;
  threshold: number;
}

export interface ProductRecipeItem {
  materialId: string;
  grams: number;
}

export interface Product {
  id: string;
  name: string;
  priceBase: number;
  recipe: ProductRecipeItem[];
  stock?: number;
  threshold?: number;
}

export type OrderType = 'self' | 'vip' | 'distrib' | 'retail' | 'temp' | 'event' | 'test' | 'gift';

export type PricingPlanGroup = 'self' | 'distrib' | 'retail' | 'vip' | 'temp' | 'special';

export interface Order {
  id: string;
  type: OrderType;
  productId: string;
  qty: number;
  usedFinished?: number;
  person: string;
  receivable: number;
  payment: 'cash' | 'wechat' | 'alipay' | 'other' | '';
  createdAt: string;
  remark?: string;
  pricingGroup?: PricingPlanGroup | 'vip';
  pricingPlanId?: string;
  perPackPrice?: number;
}

export type InventoryLogKind = 'in' | 'out';

export interface InventoryLog {
  id: string;
  kind: InventoryLogKind;
  materialId?: string;
  grams?: number;
  productId?: string;
  packages?: number;
  refType: 'order' | 'purchase' | 'produce' | 'adjust';
  refId: string;
  operator?: string;
  createdAt: string;
}

export interface Purchase {
  id: string;
  materialId: string;
  grams: number;
  cost: number;
  operator?: string;
  createdAt: string;
}

export interface PricingPlan {
  id: string;
  group: PricingPlanGroup;
  name: string;
  setPrice: number;
  packCount: number;
  perPackPrice: number;
  remark?: string;
}

export interface PricingConfig {
  id: string; // 固定为 'default'，IndexedDB 主键
  self: number;
  vip: number;
  distrib: number;
  event: number;
  plans?: PricingPlan[];
}

/**
 * 与服务端 DbShape 对齐的完整数据库导出格式（用于 JSON 导入/导出）。
 * 注意：服务端 pricing 没有 id 字段，导入时需要补充。
 */
export interface DbExportShape {
  users: User[];
  materials: Material[];
  products: Product[];
  orders: Order[];
  purchases: Purchase[];
  inventoryLogs: InventoryLog[];
  pricing: Omit<PricingConfig, 'id'>;
}

// ===================== Dexie 数据库类 =====================

/**
 * 青丝源本地数据库
 *
 * IndexedDB 存储引擎，通过 Dexie.js 提供简洁的异步 CRUD 接口。
 * 索引设计原则：主键 + 常用查询/筛选字段。
 */
class QingSiYuanDB extends Dexie {
  users!: Table<User>;
  materials!: Table<Material>;
  products!: Table<Product>;
  orders!: Table<Order>;
  purchases!: Table<Purchase>;
  inventoryLogs!: Table<InventoryLog>;
  pricing!: Table<PricingConfig>;

  constructor() {
    super('qingsiyuan');
    this.version(1).stores({
      users: 'id, phone, role',
      materials: 'id, name',
      products: 'id, name',
      orders: 'id, productId, createdAt, type',
      purchases: 'id, materialId, createdAt',
      inventoryLogs: 'id, kind, materialId, productId, createdAt, refType',
      pricing: 'id',
    });
  }
}

/** 全局单例数据库实例 */
export const db = new QingSiYuanDB();
