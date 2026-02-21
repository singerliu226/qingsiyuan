import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { nanoid } from 'nanoid';
import { authMiddleware, requireRole, signToken } from './auth';
import { storage, backupManager, DATA_DIR, DB_FILE, loadDb } from './storage';
import { Material, Order, OrderType, Product, ProductRecipeItem, Purchase, PricingPlan, PricingPlanGroup } from './types';
import { Errors } from './errors';
import { logger } from './logger';
import { existsSync, copyFileSync, createReadStream, writeFileSync } from 'fs';
import { join } from 'path';
import { ensurePricingSeed } from './seed';

export const router = Router();

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * 将手机号做脱敏处理，便于写安全审计日志同时避免泄漏隐私。
 * 示例：13800000000 -> 138****0000
 */
function maskPhone(phone: string): string {
  const p = String(phone || '');
  if (p.length < 7) return p ? `${p[0]}***` : '';
  return `${p.slice(0, 3)}****${p.slice(-4)}`;
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

/**
 * 找回密码：使用“重置口令”直接重设密码。
 *
 * 设计原因与方式：
 * - 该系统是“店内本地/局域网工具”，通常没有短信/邮箱能力；
 * - 直接放开“输入手机号即可重置”会导致任何人可接管账号，风险不可接受；
 * - 因此采用环境变量 `PASSWORD_RESET_KEY` 作为“店长持有”的线下重置口令：
 *   - 只有知道该口令的人才能重置指定手机号的密码；
 *   - 口令不落库，便于随时更换并降低泄漏影响面。
 *
 * 请求体：{ phone, resetKey, newPassword }
 */
router.post('/auth/reset-password', (req, res) => {
  const configuredKey = process.env.PASSWORD_RESET_KEY;
  if (!configuredKey) {
    return res
      .status(501)
      .json(Errors.validation('服务端未配置 PASSWORD_RESET_KEY，暂不可使用找回密码功能'));
  }

  const { phone, resetKey, newPassword } = req.body || {};
  const phoneStr = String(phone || '').trim();
  const keyStr = String(resetKey || '');
  const pwdStr = String(newPassword || '');

  if (!phoneStr || !keyStr || !pwdStr) {
    return res.status(400).json(Errors.validation('phone/resetKey/newPassword 必填'));
  }
  if (pwdStr.length < 6) {
    return res.status(400).json(Errors.validation('新密码长度至少 6 位'));
  }
  if (keyStr !== configuredKey) {
    logger.warn('auth:reset-password:denied', { phone: maskPhone(phoneStr) });
    return res.status(403).json(Errors.forbidden('重置口令不正确'));
  }

  const user = storage.users.find(u => u.phone === phoneStr);
  if (!user) {
    logger.warn('auth:reset-password:not-found', { phone: maskPhone(phoneStr) });
    return res.status(404).json(Errors.notFound('手机号不存在'));
  }
  if (user.status !== 'active') {
    return res.status(403).json(Errors.forbidden('账号已停用'));
  }

  user.passwordHash = bcrypt.hashSync(pwdStr, 10);
  storage.upsertUser(user);
  logger.info('auth:reset-password:ok', { phone: maskPhone(phoneStr), userId: user.id, role: user.role });
  return res.json({ ok: true });
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

/**
 * 删除用户（仅店长）。
 *
 * 设计说明：
 * - 物理删除用于清理不再使用的账号，避免“停用但列表越来越长”；
 * - 安全保护：
 *   - 禁止删除当前登录用户（避免误操作把自己踢出且无人可管理）；
 *   - 禁止删除“最后一个店长”（系统必须至少保留一个 owner 才能继续管理）。
 */
router.post('/users/:id/delete', authMiddleware, requireRole('owner'), (req, res) => {
  const id = String(req.params.id || '');
  const actor = (req as any).user as { id?: string; name?: string } | undefined;
  if (!id) return res.status(400).json(Errors.validation('id 非法'));
  if (actor?.id && actor.id === id) {
    return res.status(400).json(Errors.validation('不能删除当前登录账号'));
  }

  const target = storage.users.find(u => u.id === id);
  if (!target) return res.status(404).json(Errors.notFound('用户不存在'));

  if (target.role === 'owner') {
    const owners = storage.users.filter(u => u.role === 'owner' && u.id !== id);
    if (owners.length === 0) {
      return res.status(400).json(Errors.validation('不能删除最后一个店长账号'));
    }
  }

  const ok = storage.removeUser(id);
  if (!ok) return res.status(404).json(Errors.notFound('用户不存在'));

  logger.warn('user:delete', {
    actorId: actor?.id,
    actorName: actor?.name,
    targetId: id,
    targetPhone: maskPhone(target.phone),
    targetRole: target.role,
  });

  return res.json({ ok: true });
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
 * 撤回一条“原料进货入库”记录（仅店长）。
 *
 * 设计说明：
 * - 撤回本质是“写一条对冲操作”，而不是静默删流水：
 *   - 数据层删除 purchases 记录用于避免报表重复统计；
 *   - 但库存流水保持审计可追溯，因此使用 refType='adjust' 写入一条 out 对冲流水；
 * - 为避免出现负库存：要求当前原料库存 >= 当次入库克数，否则拒绝撤回并提示原因。
 */
router.post('/purchases/:id/revoke', authMiddleware, requireRole('owner'), (req, res) => {
  const id = String(req.params.id || '');
  const purchase = storage.purchases.find(p => p.id === id);
  if (!purchase) return res.status(404).json(Errors.notFound('进货记录不存在'));
  const mat = storage.materials.find(m => m.id === purchase.materialId);
  if (!mat) return res.status(404).json(Errors.notFound('原料不存在'));

  const grams = Number(purchase.grams || 0);
  if (!(grams > 0)) return res.status(400).json(Errors.validation('进货记录 grams 非法'));
  if (mat.stock < grams) {
    return res.status(400).json(
      Errors.validation('当前库存不足，无法撤回该进货记录（可能已被消耗）', {
        materialId: mat.id,
        need: grams,
        stock: mat.stock,
      }),
    );
  }

  // 1) 回滚库存
  mat.stock -= grams;
  storage.upsertMaterial(mat);

  // 2) 删除 purchase 记录，避免后续报表/列表重复统计
  storage.removePurchase(id);

  // 3) 写入对冲流水：用 adjust 记录撤回动作，保留审计轨迹
  const operator = String((req as any).user?.name || purchase.operator || '');
  storage.addInventoryLog({
    id: nanoid(),
    kind: 'out',
    materialId: mat.id,
    grams,
    refType: 'adjust',
    refId: `revoke-purchase-${id}`,
    operator,
    createdAt: nowIso(),
  });

  logger.warn('purchase:revoke', {
    purchaseId: id,
    materialId: mat.id,
    grams,
    operator,
    stockAfter: mat.stock,
  });

  return res.json({ ok: true, purchaseId: id, materialId: mat.id, grams, stock: mat.stock });
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
  const { type, productId, qty, person, payment, pricingGroup, pricingPlanId, remark } = req.body || {} as Partial<Order> & { pricingGroup?: PricingPlanGroup | 'vip', pricingPlanId?: string };
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
    remark: remark ? String(remark) : undefined,
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

/**
 * 导出库存流水（XLSX）。
 * 说明：
 * - 使用与 /inventory/logs 相同的筛选条件，但导出为全量数据（不分页）；
 * - 仅导出展示字段（时间、类型、对象、数量、来源、操作人），便于门店留档。
 */
router.get('/inventory/logs/export', authMiddleware, async (req, res) => {
  const { kind, materialId, refType, from, to } = req.query as any;
  let rows = storage.inventoryLogs.slice();
  if (kind) rows = rows.filter(l => l.kind === String(kind));
  if (materialId) rows = rows.filter(l => l.materialId === String(materialId));
  if (refType) rows = rows.filter(l => l.refType === String(refType));
  const fromD = from ? new Date(String(from)) : null;
  const toD = to ? new Date(String(to)) : null;
  if (fromD) rows = rows.filter(l => new Date(l.createdAt) >= fromD);
  if (toD) rows = rows.filter(l => new Date(l.createdAt) <= toD);
  rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

  const ExcelJS = await import('exceljs');
  const wb = new (ExcelJS as any).Workbook();
  const ws = wb.addWorksheet('InventoryLogs');
  ws.addRow(['时间', '类型', '对象', '数量', '来源', '来源ID', '操作人']);

  for (const l of rows) {
    const kindLabel = l.kind === 'in' ? '存入' : '取出';
    const obj =
      l.materialId
        ? `原料 - ${storage.materials.find(m => m.id === l.materialId)?.name || l.materialId}`
        : (l as any).productId
          ? `成品 - ${storage.products.find(p => p.id === (l as any).productId)?.name || (l as any).productId}`
          : '—';
    const qty =
      l.grams !== undefined && l.grams !== null
        ? `${l.grams} 克`
        : (l as any).packages !== undefined && (l as any).packages !== null
          ? `${(l as any).packages} 包`
          : '—';
    let operator = (l as any).operator || '';
    if (!operator) {
      if (l.refType === 'order') operator = storage.orders.find(o => o.id === l.refId)?.person || '';
      else if (l.refType === 'purchase') operator = storage.purchases.find(p => p.id === l.refId)?.operator || '';
    }
    ws.addRow([l.createdAt, kindLabel, obj, qty, l.refType, l.refId, operator || '']);
  }

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="inventory-logs.xlsx"');
  await wb.xlsx.write(res as any);
  return res.end();
});

/**
 * 撤回一条库存流水（仅店长）。
 *
 * 设计说明：
 * - 流水是审计记录，不做“删除”；撤回采用“对冲”方式写入一条相反方向的 adjust 流水；
 * - 对于 purchase / order：
 *   - 需要同时撤回业务记录，保证报表统计一致；
 *   - purchase → 等价于撤回进货（会删除 purchases 记录并写对冲流水）；
 *   - order → 等价于撤销订单（仅支持 5 分钟内）。
 * - 对于 produce / adjust：
 *   - 仅对库存字段做对冲（不涉及额外业务表），写入 adjust 对冲流水即可。
 */
router.post('/inventory/logs/:id/revoke', authMiddleware, requireRole('owner'), (req, res) => {
  const id = String(req.params.id || '');
  const operator = String((req as any).user?.name || '');
  if (!id) return res.status(400).json(Errors.validation('id 非法'));

  const log0: any = storage.inventoryLogs.find(l => (l as any).id === id);
  if (!log0) return res.status(404).json(Errors.notFound('流水不存在'));

  // purchase / order：走专用撤回逻辑，保证业务一致性
  if (log0.refType === 'purchase') {
    // 仅支持撤回“进货入库”对应的 purchase 业务记录
    const purchaseId = String(log0.refId || '');
    if (!purchaseId) return res.status(400).json(Errors.validation('purchaseId 非法'));
    // 复用既有撤回接口逻辑：通过内部查找 purchase 再回滚库存/删除记录/写流水
    const purchase = storage.purchases.find(p => p.id === purchaseId);
    if (!purchase) return res.status(404).json(Errors.notFound('进货记录不存在'));
    const mat = storage.materials.find(m => m.id === purchase.materialId);
    if (!mat) return res.status(404).json(Errors.notFound('原料不存在'));
    const grams = Number(purchase.grams || 0);
    if (!(grams > 0)) return res.status(400).json(Errors.validation('进货记录 grams 非法'));
    if (mat.stock < grams) {
      return res.status(400).json(
        Errors.validation('当前库存不足，无法撤回该进货记录（可能已被消耗）', { materialId: mat.id, need: grams, stock: mat.stock }),
      );
    }
    mat.stock -= grams;
    storage.upsertMaterial(mat);
    storage.removePurchase(purchaseId);
    storage.addInventoryLog({
      id: nanoid(),
      kind: 'out',
      materialId: mat.id,
      grams,
      refType: 'adjust',
      refId: `revoke-purchase-${purchaseId}`,
      operator,
      createdAt: nowIso(),
    });
    logger.warn('purchase:revoke', { purchaseId, materialId: mat.id, grams, operator, stockAfter: mat.stock });
    return res.json({ ok: true, mode: 'purchase', purchaseId });
  }

  if (log0.refType === 'order') {
    const orderId = String(log0.refId || '');
    if (!orderId) return res.status(400).json(Errors.validation('orderId 非法'));
    const order = storage.orders.find(o => o.id === orderId);
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
      storage.addInventoryLog({ id: nanoid(), kind: 'in', productId: product.id, packages: usedFinished, refType: 'order', refId: order.id, operator, createdAt: nowIso() });
    }
    // 回滚原料库存
    if (usedRaw > 0) {
      for (const item of product.recipe) {
        const mat = storage.materials.find(m => m.id === item.materialId);
        if (!mat) return res.status(400).json(Errors.notFound(`原料不存在: ${item.materialId}`));
        const grams = item.grams * usedRaw;
        mat.stock += grams;
        storage.upsertMaterial(mat);
        storage.addInventoryLog({ id: nanoid(), kind: 'in', materialId: mat.id, grams, refType: 'order', refId: order.id, operator, createdAt: nowIso() });
      }
    }
    storage.removeOrder(order.id);
    logger.warn('order:cancel', { orderId, operator });
    return res.json({ ok: true, mode: 'order', orderId });
  }

  // 通用对冲：produce / adjust 等
  const marker = `revoke-log-${id}`;
  const already = storage.inventoryLogs.find(l => l.refType === 'adjust' && l.refId === marker);
  if (already) return res.status(400).json(Errors.validation('该流水已撤回'));

  const kindOpp = log0.kind === 'in' ? 'out' : 'in';

  // 原料流水
  if (log0.materialId && log0.grams !== undefined && log0.grams !== null) {
    const mat = storage.materials.find(m => m.id === log0.materialId);
    if (!mat) return res.status(404).json(Errors.notFound('原料不存在'));
    const grams = Number(log0.grams || 0);
    if (!(grams > 0)) return res.status(400).json(Errors.validation('grams 非法'));
    if (log0.kind === 'in') {
      // 撤回入库：需要扣减库存
      if (mat.stock < grams) return res.status(400).json(Errors.validation('当前库存不足，无法撤回该入库记录'));
      mat.stock -= grams;
    } else {
      // 撤回出库：补回库存
      mat.stock += grams;
    }
    storage.upsertMaterial(mat);
    storage.addInventoryLog({ id: nanoid(), kind: kindOpp, materialId: mat.id, grams, refType: 'adjust', refId: marker, operator, createdAt: nowIso() });
    logger.warn('inventory-log:revoke', { logId: id, mode: 'material', kind: log0.kind, grams, materialId: mat.id, operator });
    return res.json({ ok: true });
  }

  // 成品流水
  if (log0.productId && log0.packages !== undefined && log0.packages !== null) {
    const prod = storage.products.find(p => p.id === log0.productId);
    if (!prod) return res.status(404).json(Errors.notFound('成品不存在'));
    const packages = Number(log0.packages || 0);
    if (!(packages > 0)) return res.status(400).json(Errors.validation('packages 非法'));
    const current = Number((prod as any).stock || 0);
    if (log0.kind === 'in') {
      if (current < packages) return res.status(400).json(Errors.validation('当前成品库存不足，无法撤回该入库记录'));
      (prod as any).stock = current - packages;
    } else {
      (prod as any).stock = current + packages;
    }
    storage.upsertProduct(prod);
    storage.addInventoryLog({ id: nanoid(), kind: kindOpp, productId: prod.id, packages, refType: 'adjust', refId: marker, operator, createdAt: nowIso() });
    logger.warn('inventory-log:revoke', { logId: id, mode: 'product', kind: log0.kind, packages, productId: prod.id, operator });
    return res.json({ ok: true });
  }

  return res.status(400).json(Errors.validation('该流水不支持撤回'));
});

// ===== Backup & Restore (owner only) =====
router.post('/admin/backup', authMiddleware, requireRole('owner'), (_req, res) => {
  const src = DB_FILE;
  if (!existsSync(src)) return res.status(404).json(Errors.notFound('db.json 不存在'));
  const file = backupManager.createBackup();
  return res.json({ ok: true, file });
});

/**
 * 上传备份文件并可选立即生效（仅店长）。
 * 设计说明：
 * - 前端在浏览器中读取本地 JSON 文件为字符串，通过 body 传递 { name, content, apply }；
 * - 服务端做最基本的 JSON 解析与结构校验，确保是一个包含核心字段的对象；
 * - 文件会以 db.backup.<name> 形式落在 DATA_DIR 目录下，方便与现有备份列表统一管理；
 * - 当 apply=true 时，会同时覆盖 DB_FILE 并调用 loadDb 使其立即生效。
 */
router.post('/admin/backup-upload', authMiddleware, requireRole('owner'), (req, res) => {
  const body = req.body || {};
  const rawContent = body.content;
  const nameRaw = body.name as string | undefined;
  const apply = !!body.apply;

  if (typeof rawContent !== 'string' || !rawContent.trim()) {
    return res.status(400).json(Errors.validation('content 必须为非空字符串'));
  }

  let parsed: any;
  try {
    parsed = JSON.parse(rawContent);
  } catch (e: any) {
    return res.status(400).json(Errors.validation(`JSON 解析失败: ${e?.message || ''}`));
  }

  // 进行一个非常宽松的结构校验，主要避免误传完全不相关的文件。
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.users) || !Array.isArray(parsed.materials)) {
    return res.status(400).json(Errors.validation('备份文件结构不正确，缺少 users/materials 等字段'));
  }

  const ts = Date.now();
  const safeBase = (nameRaw && nameRaw.trim()) ? nameRaw.trim().replace(/[^\w.-]/g, '_') : `upload-${ts}.json`;
  const fileName = safeBase.startsWith('db.backup.') ? safeBase : `db.backup.${safeBase}`;
  const fullPath = join(DATA_DIR, fileName);

  try {
    writeFileSync(fullPath, JSON.stringify(parsed, null, 2), 'utf-8');
  } catch (e: any) {
    return res.status(500).json(Errors.validation(`写入备份文件失败: ${e?.message || ''}`));
  }

  let applied = false;
  if (apply) {
    try {
      copyFileSync(fullPath, DB_FILE);
      loadDb();
      applied = true;
    } catch (e: any) {
      return res.status(500).json(Errors.validation(`应用备份失败: ${e?.message || ''}`));
    }
  }

  return res.json({ ok: true, file: fullPath, applied });
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
