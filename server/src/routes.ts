import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { nanoid } from 'nanoid';
import { authMiddleware, requireRole, signToken } from './auth';
import { storage, backupManager, DATA_DIR, DB_FILE, loadDb } from './storage';
import { Material, Order, OrderType, Product, ProductRecipeItem, Purchase, PricingPlan, PricingPlanGroup } from './types';
import { Errors } from './errors';
import { existsSync, copyFileSync, createReadStream } from 'fs';
import { join } from 'path';
import { ensurePricingSeed } from './seed';

export const router = Router();

function nowIso(): string {
  return new Date().toISOString();
}

function toDateKey(iso: string): string {
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// ===== Auth =====
router.post('/auth/login', (req, res) => {
  const { phone, password } = req.body || {};
  const user = storage.users.find(u => u.phone === phone);
  if (!user) return res.status(401).json(Errors.invalid());
  if (user.status !== 'active') return res.status(403).json({ error: { code: 'DISABLED', message: '账号已停用' } });
  if (!bcrypt.compareSync(password || '', user.passwordHash)) {
    return res.status(401).json(Errors.invalid());
  }
  const token = signToken({ id: user.id, role: user.role, name: user.name });
  return res.json({ token, user: { id: user.id, role: user.role, name: user.name } });
});

router.get('/auth/me', authMiddleware, (req, res) => {
  return res.json({ ...(req as any).user });
});

// 修改密码（当前用户）
router.post('/auth/change-password', authMiddleware, (req, res) => {
  const userToken = (req as any).user as { id: string } | undefined;
  const { currentPassword, newPassword } = req.body || {};
  if (!userToken?.id) return res.status(401).json(Errors.unauth());
  const user = storage.users.find(u => u.id === userToken.id);
  if (!user) return res.status(404).json(Errors.notFound('用户不存在'));
  if (!bcrypt.compareSync(currentPassword || '', user.passwordHash)) {
    return res.status(400).json(Errors.validation('当前密码不正确'));
  }
  if (!newPassword || String(newPassword).length < 6) {
    return res.status(400).json(Errors.validation('新密码长度至少 6 位'));
  }
  user.passwordHash = bcrypt.hashSync(String(newPassword), 10);
  storage.upsertUser(user);
  return res.json({ ok: true });
});

// ===== Users (owner only) =====
router.get('/users', authMiddleware, requireRole('owner'), (_req, res) => {
  const list = storage.users.map(u => ({ id: u.id, name: u.name, phone: u.phone, role: u.role, status: u.status }));
  res.json(list);
});

router.post('/users', authMiddleware, requireRole('owner'), (req, res) => {
  const { name, phone, role, password } = req.body || {};
  if (!name || !phone || !role) return res.status(400).json(Errors.validation('name/phone/role 必填'));
  if (!['owner','staff'].includes(role)) return res.status(400).json(Errors.validation('role 非法'));
  if (storage.users.find(u => u.phone === String(phone))) return res.status(400).json(Errors.validation('手机号已存在'));
  const user = {
    id: nanoid(),
    name: String(name),
    phone: String(phone),
    role: role as any,
    passwordHash: bcrypt.hashSync(String(password || '123456'), 10),
    status: 'active' as const,
  };
  storage.upsertUser(user);
  return res.status(201).json({ id: user.id, name: user.name, phone: user.phone, role: user.role, status: user.status });
});

router.patch('/users/:id', authMiddleware, requireRole('owner'), (req, res) => {
  const id = req.params.id;
  const user = storage.users.find(u => u.id === id);
  if (!user) return res.status(404).json(Errors.notFound('用户不存在'));
  const { name, phone, role, status, password } = req.body || {};
  if (phone && storage.users.find(u => u.phone === String(phone) && u.id !== id)) return res.status(400).json(Errors.validation('手机号已存在'));
  if (role && !['owner','staff'].includes(role)) return res.status(400).json(Errors.validation('role 非法'));
  if (status && !['active','disabled'].includes(status)) return res.status(400).json(Errors.validation('status 非法'));
  if (name !== undefined) user.name = String(name);
  if (phone !== undefined) user.phone = String(phone);
  if (role !== undefined) (user as any).role = role;
  if (status !== undefined) (user as any).status = status;
  if (password !== undefined) user.passwordHash = bcrypt.hashSync(String(password), 10);
  storage.upsertUser(user);
  return res.json({ id: user.id, name: user.name, phone: user.phone, role: user.role, status: user.status });
});

// ===== Materials =====
router.get('/materials', authMiddleware, (_req, res) => {
  res.json(storage.materials);
});

router.post('/materials', authMiddleware, (req, res) => {
  const body = req.body as Partial<Material>;
  if (!body.name) return res.status(400).json(Errors.validation('name 必填'));
  const mat: Material = {
    id: nanoid(),
    name: body.name!,
    unit: 'g',
    stock: Number(body.stock || 0),
    threshold: Number(body.threshold || 0),
  };
  storage.upsertMaterial(mat);
  res.status(201).json(mat);
});

router.patch('/materials/:id', authMiddleware, (req, res) => {
  const id = req.params.id;
  const mat = storage.materials.find(m => m.id === id);
  if (!mat) return res.status(404).json({ error: { code: 'NOT_FOUND', message: '原料不存在' } });
  const { name, stock, threshold } = req.body || {};
  if (name !== undefined) mat.name = String(name);
  if (stock !== undefined) mat.stock = Number(stock);
  if (threshold !== undefined) mat.threshold = Number(threshold);
  storage.upsertMaterial(mat);
  res.json(mat);
});

/**
 * 手工减少原料库存。
 * 设计说明：
 * - 仅支持减少库存，避免与正常进货流程混淆；
 * - 典型场景：盘点报损、过期作废等；
 * - 会写入库存流水（kind='out', refType='adjust'），方便追溯。
 */
router.post('/materials/:id/decrease', authMiddleware, requireRole('owner'), (req, res) => {
  const id = req.params.id;
  const mat = storage.materials.find(m => m.id === id);
  if (!mat) return res.status(404).json(Errors.notFound('原料不存在'));
  const grams = Number((req.body || {}).grams || 0);
  const operator = String((req.body || {}).operator || (req as any).user?.name || '');
  if (!(grams > 0)) return res.status(400).json(Errors.validation('grams 必须大于 0'));
  if (mat.stock < grams) {
    return res.status(400).json(Errors.insufficient([{ materialId: mat.id, need: grams, stock: mat.stock }]));
  }
  mat.stock -= grams;
  storage.upsertMaterial(mat);
  storage.addInventoryLog({
    id: nanoid(),
    kind: 'out',
    materialId: mat.id,
    grams,
    refType: 'adjust',
    refId: `adjust-${Date.now()}`,
    operator,
    createdAt: nowIso(),
  });
  return res.json({ ok: true, stock: mat.stock });
});

// ===== Products & Recipes =====
router.get('/products', authMiddleware, (_req, res) => {
  res.json(storage.products);
});

router.post('/products', authMiddleware, (req, res) => {
  const body = req.body as Partial<Product>;
  if (!body.name || typeof body.priceBase !== 'number') {
    return res.status(400).json({ error: { code: 'VALIDATION', message: 'name 与 priceBase 必填' } });
  }
  const recipe = Array.isArray(body.recipe) ? body.recipe as ProductRecipeItem[] : [];
  for (const item of recipe) {
    if (!item.materialId || typeof item.grams !== 'number' || item.grams <= 0) {
      return res.status(400).json(Errors.validation('recipe 不合法'));
    }
    if (!storage.materials.find(m => m.id === item.materialId)) {
      return res.status(400).json(Errors.notFound(`原料不存在: ${item.materialId}`));
    }
  }
  const product: Product = {
    id: nanoid(),
    name: body.name,
    priceBase: body.priceBase,
    recipe,
  } as Product;
  storage.upsertProduct(product);
  res.status(201).json(product);
});

// 更新产品（名称/基础价/配方）- 仅店长
router.patch('/products/:id', authMiddleware, requireRole('owner'), (req, res) => {
  const id = req.params.id;
  const product = storage.products.find(p => p.id === id);
  if (!product) return res.status(404).json(Errors.notFound('产品不存在'));
  const body = req.body as Partial<Product>;
  if (body.name !== undefined) product.name = String(body.name);
  if (body.priceBase !== undefined) {
    const pb = Number(body.priceBase);
    if (!(pb >= 0)) return res.status(400).json(Errors.validation('priceBase 非法'));
    product.priceBase = pb;
  }
  if (body.recipe !== undefined) {
    const recipe = Array.isArray(body.recipe) ? (body.recipe as ProductRecipeItem[]) : [];
    for (const item of recipe) {
      if (!item.materialId || typeof item.grams !== 'number' || item.grams <= 0) {
        return res.status(400).json(Errors.validation('recipe 不合法'));
      }
      if (!storage.materials.find(m => m.id === item.materialId)) {
        return res.status(400).json(Errors.notFound(`原料不存在: ${item.materialId}`));
      }
    }
    product.recipe = recipe;
  }
  storage.upsertProduct(product);
  res.json(product);
});

/**
 * 手工减少成品库存（包数）。
 * 说明：
 * - 不回滚原料，仅调整成品 stock 字段，用于盘点时矫正库存。
 * - 建议仅店长使用，因此沿用 products PATCH 的 owner 权限。
 */
router.post('/products/:id/decrease-stock', authMiddleware, requireRole('owner'), (req, res) => {
  const id = req.params.id;
  const product = storage.products.find(p => p.id === id);
  if (!product) return res.status(404).json(Errors.notFound('产品不存在'));
  const qty = Number((req.body || {}).qty || 0);
  if (!(qty > 0)) return res.status(400).json(Errors.validation('qty 必须大于 0'));
  const current = Number((product as any).stock || 0);
  if (current < qty) {
    return res.status(400).json(Errors.validation('成品库存不足'));
  }
  (product as any).stock = current - qty;
  storage.upsertProduct(product);
  // 记录成品手工调整流水（出库）
  const operator = (req as any).user?.name || '';
  storage.addInventoryLog({
    id: nanoid(),
    kind: 'out',
    productId: product.id,
    packages: qty,
    refType: 'adjust',
    refId: `product-adjust-${Date.now()}`,
    operator,
    createdAt: nowIso(),
  });
  return res.json({ ok: true, stock: (product as any).stock });
});

// ===== Pricing =====
router.get('/pricing', authMiddleware, requireRole('owner'), (_req, res) => {
  res.json(storage.pricing);
});

// 仅店长可调整定价策略
router.patch('/pricing', authMiddleware, requireRole('owner'), (req, res) => {
  const p = storage.pricing;
  const body = req.body || {};
  const next = { ...p } as any;
  for (const k of ['self', 'vip', 'distrib', 'event']) {
    if (body[k] !== undefined) {
      const v = Number(body[k]);
      if (!isFinite(v) || v <= 0) return res.status(400).json(Errors.validation(`${k} 折扣需为正数`));
      next[k] = v;
    }
  }
  // 可选：活动方案（plans）
  if (Array.isArray(body.plans)) {
    const plans = [] as PricingPlan[];
    for (const it of body.plans) {
      if (!it || !it.group || !it.name) return res.status(400).json(Errors.validation('plans 不合法'));
      const setPrice = Number(it.setPrice || 0);
      const packCount = Number(it.packCount || 0);
      const perPackInput = it.perPackPrice !== undefined ? Number(it.perPackPrice) : undefined;
      if (!(setPrice >= 0) || !(packCount >= 0)) return res.status(400).json(Errors.validation('setPrice/packCount 非法'));
      const perPackPrice = perPackInput !== undefined && perPackInput >= 0
        ? Math.round(perPackInput)
        : (packCount > 0 ? Number((setPrice / packCount).toFixed(0)) : 0);
      plans.push({ id: it.id || nanoid(), group: it.group, name: it.name, setPrice, packCount, perPackPrice, remark: it.remark });
    }
    next.plans = plans;
  }
  storage.setPricing(next);
  res.json(next);
});

function discountFor(type: OrderType): number {
  const p = storage.pricing;
  switch (type) {
    case 'self': return p.self;
    case 'vip': return p.vip;
    case 'distrib': return p.distrib;
    case 'retail': return 1; // 零售默认不打折
    case 'temp': return p.event; // 临时活动沿用 event 折扣
    case 'event': return p.event; // 兼容旧值
    case 'test': return 1; // 测试类型不参与折扣，按产品基础价结算
    case 'gift': return 0; // 赠送类型默认价格为 0
    default: return 1;
  }
}

// 面向前台的只读方案列表（任何登录用户可见）
router.get('/pricing/plans', authMiddleware, (_req, res) => {
  const plansRaw = Array.isArray(storage.pricing.plans) ? storage.pricing.plans : [];
  // 兼容历史：将名称为 VIP 或分组为 special 的方案在读出时统一映射为 vip 分组，方便前端筛选
  const plans = plansRaw.map(p => (p.name === 'VIP' || (p as any).group === 'special') ? ({ ...p, group: 'vip' as any }) : p);
  res.json({ plans });
});

function resolvePerPackPrice(group: PricingPlanGroup | 'vip' | undefined, planId: string | undefined): number | undefined {
  const plans = Array.isArray(storage.pricing.plans) ? storage.pricing.plans : [];
  // 优先依据方案 ID 精确匹配，避免分组枚举差异导致无法命中（如历史数据中的 special/retail:VIP）
  if (planId) {
    const byId = plans.find(p => p.id === planId);
    if (byId) {
      const price = Number(byId.perPackPrice || 0);
      return price >= 0 ? price : undefined;
    }
  }
  if (group) {
    const byGroup = plans.find(p => p.group === group);
    if (byGroup) {
      const price = Number(byGroup.perPackPrice || 0);
      return price >= 0 ? price : undefined;
    }
  }
  return undefined;
}

// ===== Purchases (Inbound) =====
router.get('/purchases', authMiddleware, (_req, res) => {
  res.json(storage.purchases);
});

/**
 * 单条入库：用于简单场景或向后兼容旧前端。
 */
router.post('/purchases', authMiddleware, (req, res) => {
  const { materialId, grams, cost, operator } = req.body || {} as Purchase;
  const mat = storage.materials.find(m => m.id === materialId);
  if (!mat) return res.status(404).json(Errors.notFound('原料不存在'));
  const g = Number(grams);
  const c = Number(cost || 0);
  if (!(g > 0)) return res.status(400).json(Errors.validation('grams 必须大于 0'));
  const user = (req as any).user as { name?: string } | undefined;
  const purchase: Purchase = { id: nanoid(), materialId, grams: g, cost: c, operator: String(operator || user?.name || ''), createdAt: nowIso() };
  storage.addPurchase(purchase);
  // increase stock
  mat.stock += g;
  storage.upsertMaterial(mat);
  storage.addInventoryLog({ id: nanoid(), kind: 'in', materialId, grams: g, refType: 'purchase', refId: purchase.id, operator: purchase.operator || user?.name || '', createdAt: nowIso() });
  res.status(201).json(purchase);
});

/**
 * 批量入库：一次性为多种原料增加库存并记录流水。
 * 请求体：{ items: [{ materialId, grams, cost?, operator? }] }
 * 返回：{ ok: true, count, purchases: Purchase[] }
 */
/**
 * 批量入库：请求体 items 数组逐条校验并落库，日志逐条写入，确保可追溯。
 */
router.post('/purchases/batch', authMiddleware, (req, res) => {
  const body = req.body || {};
  const items = Array.isArray(body.items) ? body.items : [];
  if (!items.length) return res.status(400).json(Errors.validation('items 不能为空'));
  const user = (req as any).user as { name?: string } | undefined;
  const purchases: Purchase[] = [];
  for (const it of items) {
    const { materialId, grams, cost, operator } = it || {} as Purchase;
    const mat = storage.materials.find(m => m.id === materialId);
    if (!mat) return res.status(404).json(Errors.notFound(`原料不存在: ${materialId}`));
    const g = Number(grams);
    const c = Number(cost || 0);
    if (!(g > 0)) return res.status(400).json(Errors.validation('grams 必须大于 0'));
    const purchase: Purchase = { id: nanoid(), materialId, grams: g, cost: c, operator: String(operator || user?.name || ''), createdAt: nowIso() };
    storage.addPurchase(purchase);
    mat.stock += g;
    storage.upsertMaterial(mat);
    storage.addInventoryLog({ id: nanoid(), kind: 'in', materialId, grams: g, refType: 'purchase', refId: purchase.id, operator: purchase.operator || user?.name || '', createdAt: nowIso() });
    purchases.push(purchase);
  }
  return res.json({ ok: true, count: purchases.length, purchases });
});

/**
 * 批量生产成品入库：
 * - 将原料按配方扣减，并增加对应产品的成品库存（包数）。
 * - 请求体：{ items: [{ productId, qty, operator? }] }
 * - 为保证一致性：先汇总校验所有原料是否充足，全部通过后再统一扣减。
 */
router.post('/inventory/produce', authMiddleware, (req, res) => {
  const body = req.body || {};
  const items = Array.isArray(body.items) ? body.items : [];
  if (!items.length) return res.status(400).json(Errors.validation('items 不能为空'));

  const user = (req as any).user as { name?: string } | undefined;

  // 1) 汇总原料需求
  const materialNeeds = new Map<string, number>();
  for (const it of items) {
    const productId = String(it.productId || '');
    const qty = Number(it.qty || 0);
    if (!productId || !(qty > 0)) {
      return res.status(400).json(Errors.validation('productId/qty 非法'));
    }
    const product = storage.products.find(p => p.id === productId);
    if (!product) return res.status(404).json(Errors.notFound(`产品不存在: ${productId}`));
    for (const r of product.recipe) {
      const need = r.grams * qty;
      materialNeeds.set(r.materialId, (materialNeeds.get(r.materialId) || 0) + need);
    }
  }

  // 2) 校验原料库存是否充足
  const lacks: Array<{ materialId: string; need: number; stock: number }> = [];
  for (const [materialId, need] of materialNeeds.entries()) {
    const mat = storage.materials.find(m => m.id === materialId);
    if (!mat) return res.status(404).json(Errors.notFound(`原料不存在: ${materialId}`));
    if (mat.stock < need) {
      lacks.push({ materialId, need, stock: mat.stock });
    }
  }
  if (lacks.length) return res.status(400).json(Errors.insufficient(lacks));

  // 3) 扣减原料并增加成品库存，写入流水
  for (const it of items) {
    const productId = String(it.productId);
    const qty = Number(it.qty);
    const operator = String(it.operator || user?.name || '');
    const product = storage.products.find(p => p.id === productId)!;

    for (const r of product.recipe) {
      const mat = storage.materials.find(m => m.id === r.materialId)!;
      const grams = r.grams * qty;
      mat.stock -= grams;
      storage.upsertMaterial(mat);
      storage.addInventoryLog({
        id: nanoid(),
        kind: 'out',
        materialId: mat.id,
        grams,
        refType: 'produce',
        refId: productId,
        operator,
        createdAt: nowIso(),
      });
    }

    const current = (product as any).stock || 0;
    (product as any).stock = current + qty;
    storage.upsertProduct(product);
    // 记录成品入库流水：便于在前端统一查看成品库存变化
    storage.addInventoryLog({
      id: nanoid(),
      kind: 'in',
      productId: product.id,
      packages: qty,
      refType: 'produce',
      refId: productId,
      operator,
      createdAt: nowIso(),
    });
  }

  return res.json({ ok: true });
});

// ===== Orders (Outbound) =====
router.get('/orders', authMiddleware, (_req, res) => {
  res.json(storage.orders);
});

router.post('/orders', authMiddleware, (req, res) => {
  const { type, productId, qty, person, payment, pricingGroup, pricingPlanId } = req.body || {} as Partial<Order> & { pricingGroup?: PricingPlanGroup | 'vip', pricingPlanId?: string };
  const t = (type || 'retail') as OrderType;
  if (!['self', 'vip', 'distrib', 'retail', 'temp', 'event', 'test', 'gift'].includes(t)) {
    return res.status(400).json(Errors.validation('type 非法'));
  }
  const product = storage.products.find(p => p.id === productId);
  if (!product) return res.status(404).json(Errors.notFound('产品不存在'));
  const q = Number(qty || 1);
  if (!(q > 0)) return res.status(400).json(Errors.validation('qty 必须大于 0'));
  const productStock = Number((product as any).stock || 0);
  const useFinished = Math.min(productStock, q);
  const needFromRaw = q - useFinished;

  // Check raw material sufficiency（仅对需要按配方现配的数量进行校验）
  if (needFromRaw > 0) {
    const lacks: Array<{ materialId: string; need: number; stock: number }> = [];
    for (const item of product.recipe) {
      const mat = storage.materials.find(m => m.id === item.materialId);
      if (!mat) return res.status(400).json(Errors.notFound(`原料不存在: ${item.materialId}`));
      const need = item.grams * needFromRaw;
      if (mat.stock < need) lacks.push({ materialId: mat.id, need, stock: mat.stock });
    }
    if (lacks.length) {
      return res.status(400).json(Errors.insufficient(lacks));
    }
  }

  // Compute receivable: 优先使用定价方案的应收每包
  const perPackFromPlan = resolvePerPackPrice((pricingGroup as any) || (t === 'vip' ? 'vip' : t === 'distrib' ? 'distrib' : t === 'retail' ? 'retail' : t === 'temp' ? 'temp' : t === 'self' ? 'self' : undefined), pricingPlanId);
  const unit = perPackFromPlan !== undefined ? perPackFromPlan : Number((product.priceBase * discountFor(t)).toFixed(2));
  const receivable = Number((unit * q).toFixed(2));

  // Deduct stock and write logs
  const orderId = nanoid();
  const user = (req as any).user as { name?: string } | undefined;

  // 1) 先扣减成品库存（如果有）
  if (useFinished > 0) {
    (product as any).stock = productStock - useFinished;
    storage.upsertProduct(product);
    // 记录成品出库流水：优先消耗的成品包数
    storage.addInventoryLog({
      id: nanoid(),
      kind: 'out',
      productId: product.id,
      packages: useFinished,
      refType: 'order',
      refId: orderId,
      operator: (person || user?.name || ''),
      createdAt: nowIso(),
    });
  }

  // 2) 再按配方扣减需要现配的部分原料
  if (needFromRaw > 0) {
    for (const item of product.recipe) {
      const mat = storage.materials.find(m => m.id === item.materialId)!;
      const grams = item.grams * needFromRaw;
      mat.stock -= grams;
      storage.upsertMaterial(mat);
      storage.addInventoryLog({
        id: nanoid(),
        kind: 'out',
        materialId: mat.id,
        grams,
        refType: 'order',
        refId: orderId,
        operator: (person || user?.name || ''),
        createdAt: nowIso(),
      });
    }
  }

  // 如前端传入 receivableOverride，则以该值为准记录应收金额；否则使用系统计算值
  const overrideRaw = (req.body as any)?.receivableOverride;
  const override =
    overrideRaw !== undefined && overrideRaw !== null
      ? Number(overrideRaw)
      : undefined;
  const finalReceivable =
    override !== undefined && isFinite(override) && override >= 0
      ? Number(override.toFixed(2))
      : receivable;

  const order: Order = {
    id: orderId,
    type: t,
    productId: product.id,
    qty: q,
    usedFinished: useFinished || undefined,
    person: person || '',
    receivable: finalReceivable,
    payment: (payment || '') as any,
    createdAt: nowIso(),
    pricingGroup: pricingGroup as any,
    pricingPlanId,
    perPackPrice: unit,
  };
  storage.addOrder(order);
  res.status(201).json({ id: order.id, receivable: order.receivable, createdAt: order.createdAt });
});

// 撤销订单（5 分钟内）：回滚库存与流水
router.post('/orders/:id/cancel', authMiddleware, (req, res) => {
  const id = req.params.id;
  const order = storage.orders.find(o => o.id === id);
  if (!order) return res.status(404).json(Errors.notFound('订单不存在'));
  const created = new Date(order.createdAt).getTime();
  if (Date.now() - created > 5 * 60 * 1000) return res.status(400).json(Errors.validation('撤销窗口已过期'));
  const product = storage.products.find(p => p.id === order.productId);
  if (!product) return res.status(400).json(Errors.notFound('产品不存在'));
  const usedFinished = order.usedFinished || 0;
  const usedRaw = order.qty - usedFinished;

  // 回滚成品库存
  if (usedFinished > 0) {
    (product as any).stock = Number((product as any).stock || 0) + usedFinished;
    storage.upsertProduct(product);
    // 记录成品回滚流水：撤销订单时补回已消耗的成品包数
    storage.addInventoryLog({
      id: nanoid(),
      kind: 'in',
      productId: product.id,
      packages: usedFinished,
      refType: 'order',
      refId: order.id,
      createdAt: nowIso(),
    });
  }

  // 回滚原料库存（仅对下单时按配方现配的部分）
  if (usedRaw > 0) {
    for (const item of product.recipe) {
      const mat = storage.materials.find(m => m.id === item.materialId);
      if (!mat) return res.status(400).json(Errors.notFound(`原料不存在: ${item.materialId}`));
      const grams = item.grams * usedRaw;
      mat.stock += grams;
      storage.upsertMaterial(mat);
      storage.addInventoryLog({
        id: nanoid(),
        kind: 'in',
        materialId: mat.id,
        grams,
        refType: 'order',
        refId: order.id,
        createdAt: nowIso(),
      });
    }
  }
  // 删除订单
  storage.removeOrder(order.id);
  return res.json({ ok: true });
});

// 产品调用记录（统计订单使用情况）- 仅店长
router.get('/products/:id/usage', authMiddleware, requireRole('owner'), (req, res) => {
  const id = req.params.id;
  const orders = storage.orders.filter(o => o.productId === id);
  const totalQty = orders.reduce((s, o) => s + o.qty, 0);
  const count = orders.length;
  const recent = orders
    .slice()
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .slice(0, 20)
    .map(o => ({ id: o.id, qty: o.qty, receivable: o.receivable, createdAt: o.createdAt }));
  res.json({ count, totalQty, recent });
});

// 订单预校验：返回应收与库存充足性
router.post('/orders/validate', authMiddleware, (req, res) => {
  const { type, productId, qty, pricingGroup, pricingPlanId } = (req.body || {}) as Partial<Order> & { pricingGroup?: PricingPlanGroup | 'vip', pricingPlanId?: string };
  const t = (type || 'retail') as OrderType;
  if (!['self', 'vip', 'distrib', 'retail', 'temp', 'event', 'test', 'gift'].includes(t)) {
    return res.status(400).json(Errors.validation('type 非法'));
  }
  const product = storage.products.find(p => p.id === productId);
  if (!product) return res.status(404).json(Errors.notFound('产品不存在'));
  const q = Number(qty || 1);
  if (!(q > 0)) return res.status(400).json(Errors.validation('qty 必须大于 0'));
  const productStock = Number((product as any).stock || 0);
  const useFinished = Math.min(productStock, q);
  const needFromRaw = q - useFinished;

  if (needFromRaw > 0) {
    const lacks: Array<{ materialId: string; need: number; stock: number }> = [];
    for (const item of product.recipe) {
      const mat = storage.materials.find(m => m.id === item.materialId);
      if (!mat) return res.status(400).json(Errors.notFound(`原料不存在: ${item.materialId}`));
      const need = item.grams * needFromRaw;
      if (mat.stock < need) lacks.push({ materialId: mat.id, need, stock: mat.stock });
    }
    if (lacks.length) return res.status(400).json(Errors.insufficient(lacks));
  }
  const perPackFromPlan = resolvePerPackPrice((pricingGroup as any) || (t === 'vip' ? 'vip' : t === 'distrib' ? 'distrib' : t === 'retail' ? 'retail' : t === 'temp' ? 'temp' : t === 'self' ? 'self' : undefined), pricingPlanId);
  const unit = perPackFromPlan !== undefined ? perPackFromPlan : Number((product.priceBase * discountFor(t)).toFixed(2));
  const receivable = Number((unit * q).toFixed(2));
  return res.json({ receivable, perPackPrice: unit, usedFinished: useFinished, usedFromRaw: needFromRaw });
});

// ===== Reports =====
router.get('/reports/summary', authMiddleware, (req, res) => {
  const from = req.query.from ? new Date(String(req.query.from)) : null;
  const to = req.query.to ? new Date(String(req.query.to)) : null;
  const type = req.query.type ? String(req.query.type) as OrderType : undefined;
  const pricingGroup = req.query.pricingGroup ? String(req.query.pricingGroup) as PricingPlanGroup | 'vip' : undefined;
  const pricingPlanId = req.query.pricingPlanId ? String(req.query.pricingPlanId) : undefined;
  const groupBy = req.query.groupBy ? String(req.query.groupBy) as 'type'|'pricingGroup'|'pricingPlan' : undefined;
  const gran = (req.query.gran || 'day') as 'day' | 'week' | 'month';

  const orders = storage.orders.filter(o => {
    const d = new Date(o.createdAt);
    if (from && d < from) return false;
    if (to && d > to) return false;
    if (type && o.type !== type) return false;
    if (pricingGroup && o.pricingGroup !== pricingGroup) return false;
    if (pricingPlanId && o.pricingPlanId !== pricingPlanId) return false;
    return true;
  });

  const receivableTotal = orders.reduce((s, o) => s + o.receivable, 0);
  const purchaseCost = storage.purchases.reduce((s, p) => {
    const d = new Date(p.createdAt);
    if (from && d < from) return s;
    if (to && d > to) return s;
    return s + p.cost;
  }, 0);

  function keyByGran(iso: string): string {
    const d = new Date(iso);
    if (gran === 'day') return toDateKey(iso);
    if (gran === 'week') {
      const tmp = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
      const weekDay = tmp.getUTCDay() || 7;
      tmp.setUTCDate(tmp.getUTCDate() - weekDay + 1);
      return `${tmp.getUTCFullYear()}-W${String(Math.ceil((tmp.getUTCDate())/7)).padStart(2,'0')}`;
    }
    // month
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
  }

  const byKey = new Map<string, number>();
  for (const o of orders) {
    const k = keyByGran(o.createdAt);
    byKey.set(k, (byKey.get(k) || 0) + o.receivable);
  }
  const series = Array.from(byKey.entries()).sort(([a],[b]) => a < b ? -1 : 1).map(([date, receivable]) => ({ date, receivable }));

  let byGroup: Array<{ key: string; receivable: number }> | undefined;
  if (groupBy) {
    const map = new Map<string, number>();
    for (const o of orders) {
      const k = groupBy === 'type' ? o.type : groupBy === 'pricingGroup' ? (o.pricingGroup || '') : (o.pricingPlanId || '');
      map.set(k, (map.get(k) || 0) + o.receivable);
    }
    byGroup = Array.from(map.entries()).map(([key, receivable]) => ({ key, receivable: Number(receivable.toFixed(2)) }));
  }

  res.json({ receivableTotal: Number(receivableTotal.toFixed(2)), purchaseCost: Number(purchaseCost.toFixed(2)), grossEstimate: Number((receivableTotal - purchaseCost).toFixed(2)), series, byGroup });
});

// 导出 CSV/XLSX
router.get('/reports/export', authMiddleware, async (req, res) => {
  const format = (req.query.format || 'csv') as 'csv'|'xlsx';
  const from = req.query.from ? new Date(String(req.query.from)) : null;
  const to = req.query.to ? new Date(String(req.query.to)) : null;
  const type = req.query.type ? String(req.query.type) as OrderType : undefined;
  const pricingGroup = req.query.pricingGroup ? String(req.query.pricingGroup) as PricingPlanGroup | 'vip' : undefined;
  const pricingPlanId = req.query.pricingPlanId ? String(req.query.pricingPlanId) : undefined;
  const orders = storage.orders.filter(o => {
    const d = new Date(o.createdAt);
    if (from && d < from) return false;
    if (to && d > to) return false;
    if (type && o.type !== type) return false;
    if (pricingGroup && o.pricingGroup !== pricingGroup) return false;
    if (pricingPlanId && o.pricingPlanId !== pricingPlanId) return false;
    return true;
  });
  if (format === 'csv') {
    const header = 'id,type,pricingGroup,pricingPlanId,perPackPrice,productId,qty,person,receivable,payment,createdAt\n';
    const rows = orders.map(o => `${o.id},${o.type},${o.pricingGroup||''},${o.pricingPlanId||''},${o.perPackPrice||''},${o.productId},${o.qty},${o.person},${o.receivable},${o.payment},${o.createdAt}`).join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="orders.csv"');
    return res.send(header + rows);
  } else {
    const ExcelJS = await import('exceljs');
    const wb = new (ExcelJS as any).Workbook();
    const ws = wb.addWorksheet('Orders');
    ws.addRow(['id','type','pricingGroup','pricingPlanId','perPackPrice','productId','qty','person','receivable','payment','createdAt']);
    for (const o of orders) ws.addRow([o.id,o.type,o.pricingGroup||'',o.pricingPlanId||'',o.perPackPrice||'',o.productId,o.qty,o.person,o.receivable,o.payment,o.createdAt]);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="orders.xlsx"');
    await wb.xlsx.write(res as any);
    return res.end();
  }
});

// ===== Inventory Logs Query =====
router.get('/inventory/logs', authMiddleware, (req, res) => {
  const { kind, materialId, refType, from, to, page = '1', pageSize = '20' } = req.query as any;
  let rows = storage.inventoryLogs.slice();
  if (kind) rows = rows.filter(l => l.kind === String(kind));
  if (materialId) rows = rows.filter(l => l.materialId === String(materialId));
  if (refType) rows = rows.filter(l => l.refType === String(refType));
  const fromD = from ? new Date(String(from)) : null;
  const toD = to ? new Date(String(to)) : null;
  if (fromD) rows = rows.filter(l => new Date(l.createdAt) >= fromD);
  if (toD) rows = rows.filter(l => new Date(l.createdAt) <= toD);
  rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  const p = Math.max(1, Number(page) | 0);
  const ps = Math.min(100, Math.max(1, Number(pageSize) | 0));
  const total = rows.length;
  const start = (p - 1) * ps;
  const slice = rows.slice(start, start + ps);
  // enrich with operator fallback for legacy rows
  const data = slice.map(l => {
    const enriched: any = { ...l };
    // 兼容旧数据：补充缺失的 operator 信息
    if (!enriched.operator) {
      if (l.refType === 'order') {
        const o = storage.orders.find(o => o.id === l.refId);
        enriched.operator = o?.person || '';
      } else if (l.refType === 'purchase') {
        const p0 = storage.purchases.find(p => p.id === l.refId);
        enriched.operator = p0?.operator || '';
      }
    }
    // 补充名称信息，便于前端直接展示
    if (l.materialId) {
      const mat = storage.materials.find(m => m.id === l.materialId);
      enriched.materialName = mat?.name || '';
    }
    if ((l as any).productId) {
      const prod = storage.products.find(p => p.id === (l as any).productId);
      enriched.productName = prod?.name || '';
    }
    return enriched;
  });
  res.json({ total, page: p, pageSize: ps, data });
});

// ===== Backup & Restore (owner only) =====
router.post('/admin/backup', authMiddleware, requireRole('owner'), (_req, res) => {
  const src = DB_FILE;
  if (!existsSync(src)) return res.status(404).json(Errors.notFound('db.json 不存在'));
  const file = backupManager.createBackup();
  return res.json({ ok: true, file });
});

// 批量清零所有原料库存（仅店长）
router.post('/admin/materials-zero', authMiddleware, requireRole('owner'), (_req, res) => {
  for (const m of storage.materials) {
    if (m.stock !== 0) {
      m.stock = 0;
      storage.upsertMaterial(m);
    }
  }
  return res.json({ ok: true, count: storage.materials.length });
});

// 一键导入开业活动定价方案（仅店长）
router.post('/admin/seed-pricing', authMiddleware, requireRole('owner'), (_req, res) => {
  ensurePricingSeed();
  return res.json(storage.pricing);
});

router.post('/admin/restore', authMiddleware, requireRole('owner'), (req, res) => {
  const { file } = req.body || {};
  if (!file) return res.status(400).json(Errors.validation('file 必填'));
  const dst = DB_FILE;
  if (!existsSync(file)) return res.status(404).json(Errors.notFound('备份文件不存在'));
  copyFileSync(String(file), dst);
  loadDb();
  return res.json({ ok: true });
});

router.get('/admin/backups', authMiddleware, requireRole('owner'), (_req, res) => {
  const files = backupManager.listBackups();
  res.json(files);
});

// 直接下载当前 db.json 数据文件，便于在 Zeabur 之外做离线备份。
router.get('/admin/db-download', authMiddleware, requireRole('owner'), (_req, res) => {
  if (!existsSync(DB_FILE)) {
    return res.status(404).json(Errors.notFound('db.json 不存在'));
  }
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="db.json"');
  const stream = createReadStream(DB_FILE);
  stream.on('error', (err) => {
    return res.status(500).json(Errors.validation(`读取数据文件失败: ${err.message}`));
  });
  stream.pipe(res);
});

router.get('/admin/backup-config', authMiddleware, requireRole('owner'), (_req, res) => {
  res.json(backupManager.getConfig());
});

router.post('/admin/backup-config', authMiddleware, requireRole('owner'), (req, res) => {
  backupManager.setConfig(req.body || {});
  // 重新调度
  const server = require('./server');
  const app = server && server.default ? server.default : null;
  try { (app as any)?.rescheduleBackup?.(); } catch {}
  res.json(backupManager.getConfig());
});
