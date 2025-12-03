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
  /**
   * 成品库存（包数）
   * 说明：
   * - 用于记录已经预先配好的成品药包数量；
   * - 取货时会优先扣减该字段，耗尽后再按配方扣减原料；
   * - 老数据中可能不存在该字段，读取时需视为 0。
   */
  stock?: number;
  /**
   * 成品库存预警阈值（包数）
   * - 仅用于前端“成品列表”页展示预警，不影响业务计算；
   * - 可选字段，缺省视为 0。
   */
  threshold?: number;
}

export type OrderType = 'self' | 'vip' | 'distrib' | 'retail' | 'temp' | 'event' | 'test' | 'gift';

export interface Order {
  id: string;
  type: OrderType;
  productId: string;
  qty: number;
  /**
   * 本次订单中实际消耗的成品包数。
   * 说明：
   * - 下单时按照“先用成品库存，再用原料”的顺序计算；
   * - 若下单时没有可用成品，则该字段为 0 或 undefined；
   * - 撤销订单时会据此恢复成品库存，其余数量按配方回补原料。
   */
  usedFinished?: number;
  person: string;
  receivable: number;
  payment: 'cash' | 'wechat' | 'alipay' | 'other' | '';
  createdAt: string; // ISO
  // 定价策略（可选，便于追溯）
  pricingGroup?: PricingPlanGroup | 'vip';
  pricingPlanId?: string;
  perPackPrice?: number;
}

export type InventoryLogKind = 'in' | 'out';

export interface InventoryLog {
  id: string;
  kind: InventoryLogKind;
  /**
   * 原料维度信息（旧版字段，仍然保留以兼容历史数据）：
   * - materialId: 原料 ID，表示该条流水针对哪种原料；
   * - grams:     原料出入库克数，正数且单位为克。
   *
   * 从设计上看，一条流水可以是“原料流水”或“成品流水”：
   * - 仅 materialId/grams 有值 → 代表某种原料的入库/出库；
   * - 仅 productId/packages 有值 → 代表某个成品的入库/出库；
   * - 目前不会同时对同一条记录既写原料又写成品，方便前端区分展示。
   */
  materialId?: string;
  grams?: number;
  /**
   * 成品维度信息（新增）：
   * - productId: 成品产品 ID；
   * - packages:  成品出入库包数。
   *
   * 典型使用场景：
   * - 生产成品时增加成品库存（inventory/produce）；
   * - 订单取货优先消耗成品库存（orders）；
   * - 店长在“成品列表”中手工调整成品库存（decrease-stock）。
   */
  productId?: string;
  packages?: number;
  /**
   * 流水来源类型：
   * - order:   销售出库（可同时产生原料或成品流水）
   * - purchase:原料进货入库
   * - produce: 成品生产（会产生原料出库 + 成品入库两类流水）
   * - adjust:  手工调整库存（盘点损益等，既可能作用于原料也可能作用于成品）
   */
  refType: 'order' | 'purchase' | 'produce' | 'adjust';
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

export type PricingPlanGroup = 'self' | 'distrib' | 'retail' | 'vip' | 'temp' | 'special';

export interface PricingPlan {
  id: string;
  group: PricingPlanGroup; // 分销/零售/临时活动
  name: string; // 分销一/零售二/临时活动三 等
  setPrice: number; // 套装价格
  packCount: number; // 套装内包数
  perPackPrice: number; // 应收每包，服务端冗余存储，保存时计算
  remark?: string;
}
