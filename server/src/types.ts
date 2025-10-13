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
  stock: number; // grams
  threshold: number; // grams
}

export interface ProductRecipeItem {
  materialId: string;
  grams: number;
}

export interface Product {
  id: string;
  name: string;
  priceBase: number; // base price per package
  recipe: ProductRecipeItem[];
}

export type OrderType = 'self' | 'vip' | 'distrib' | 'event';

export interface Order {
  id: string;
  type: OrderType;
  productId: string;
  qty: number;
  person: string;
  receivable: number;
  payment: 'cash' | 'wechat' | 'alipay' | 'other' | '';
  createdAt: string; // ISO
}

export type InventoryLogKind = 'in' | 'out';

export interface InventoryLog {
  id: string;
  kind: InventoryLogKind;
  materialId: string;
  grams: number;
  refType: 'order' | 'purchase';
  refId: string;
  operator?: string; // 执行该操作的账号姓名
  createdAt: string; // ISO
}

export interface Purchase {
  id: string;
  materialId: string;
  grams: number;
  cost: number;
  operator?: string; // 本次入库操作人
  createdAt: string; // ISO
}

export interface PricingConfig {
  self: number;
  vip: number;
  distrib: number;
  event: number;
  plans?: PricingPlan[];
}

export type PricingPlanGroup = 'distrib' | 'retail' | 'temp' | 'special';

export interface PricingPlan {
  id: string;
  group: PricingPlanGroup; // 分销/零售/临时活动
  name: string; // 分销一/零售二/临时活动三 等
  setPrice: number; // 套装价格
  packCount: number; // 套装内包数
  perPackPrice: number; // 应收每包，服务端冗余存储，保存时计算
  remark?: string;
}
