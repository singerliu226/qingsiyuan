import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, copyFileSync } from 'fs';
import { join, resolve } from 'path';
import { InventoryLog, Material, Order, PricingConfig, Product, Purchase, User } from './types';

interface DbShape {
  users: User[];
  materials: Material[];
  products: Product[];
  orders: Order[];
  purchases: Purchase[];
  inventoryLogs: InventoryLog[];
  pricing: PricingConfig;
}

// 允许通过环境变量 DATA_DIR 覆盖数据目录（便于 Zeabur/容器化挂载持久化卷）
export const DATA_DIR = process.env.DATA_DIR ? resolve(process.env.DATA_DIR) : join(process.cwd(), 'data');
export const DB_FILE = join(DATA_DIR, 'db.json');

const defaultDb: DbShape = {
  users: [],
  materials: [],
  products: [],
  orders: [],
  purchases: [],
  inventoryLogs: [],
  // 定价策略：默认仅保留三类折扣 + 空方案列表，用户在 UI 中自行创建折扣方案
  pricing: { self: 0, vip: 0.8, temp: 1, plans: [] },
};

let db: DbShape = defaultDb;

export function loadDb(): void {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  if (!existsSync(DB_FILE)) {
    writeFileSync(DB_FILE, JSON.stringify(defaultDb, null, 2), 'utf-8');
    db = { ...defaultDb };
    return;
  }
  const raw = readFileSync(DB_FILE, 'utf-8');
  db = JSON.parse(raw) as DbShape;

  // ===== 轻量迁移：将旧定价结构清理为“折扣方案”模型 =====
  // 目标：按“清空重做”策略，避免旧的套装/单包价方案继续影响取货计算或导致前端解析困难。
  try {
    const p: any = (db as any).pricing || {};
    const hasLegacyFields = p && (p.distrib !== undefined || p.event !== undefined);
    const plans = Array.isArray(p?.plans) ? p.plans : [];
    const hasLegacyPlanShape = plans.some((it: any) => it && (it.perPackPrice !== undefined || it.setPrice !== undefined || it.packCount !== undefined));
    const hasNewShape = plans.some((it: any) => it && it.discount !== undefined);
    if (hasLegacyFields || hasLegacyPlanShape || (!hasNewShape && plans.length > 0)) {
      const next: PricingConfig = {
        // “自用/赠送”默认免费：迁移到新结构时将 self 设为 0（使用者如需收费可在 UI 中修改）
        self: 0,
        vip: isFinite(Number(p.vip)) ? Number(p.vip) : 0.8,
        // 旧结构的 event 折扣映射到 temp；无则为 1
        temp: isFinite(Number(p.temp)) ? Number(p.temp) : (isFinite(Number(p.event)) ? Number(p.event) : 1),
        // 清空方案列表（清空重做）
        plans: [],
      };
      (db as any).pricing = next;
      saveDb();
    }
  } catch {
    // 忽略迁移异常：避免因坏数据导致服务无法启动
  }
}

export function saveDb(): void {
  writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf-8');
}

export const storage = {
  get users() { return db.users; },
  get materials() { return db.materials; },
  get products() { return db.products; },
  get orders() { return db.orders; },
  get purchases() { return db.purchases; },
  get inventoryLogs() { return db.inventoryLogs; },
  get pricing() { return db.pricing; },
  setPricing(cfg: PricingConfig) { db.pricing = cfg; saveDb(); },
  upsertUser(u: User) {
    const i = db.users.findIndex(x => x.id === u.id);
    if (i >= 0) db.users[i] = u; else db.users.push(u);
    saveDb();
  },
  /**
   * 删除用户（物理删除）。
   * 设计说明：
   * - 仅提供最小的数据操作：按 id 从 users 数组移除并落盘；
   * - “权限/安全校验”（如禁止删除最后一个店长、禁止删自己）应在路由层完成；
   * - 不在 storage 层记录审计，避免出现“误调用即删除”的隐式副作用。
   */
  removeUser(id: string) {
    const i = db.users.findIndex(u => u.id === id);
    if (i >= 0) {
      db.users.splice(i, 1);
      saveDb();
      return true;
    }
    return false;
  },
  upsertMaterial(m: Material) {
    const i = db.materials.findIndex(x => x.id === m.id);
    if (i >= 0) db.materials[i] = m; else db.materials.push(m);
    saveDb();
  },
  upsertProduct(p: Product) {
    const i = db.products.findIndex(x => x.id === p.id);
    if (i >= 0) db.products[i] = p; else db.products.push(p);
    saveDb();
  },
  addOrder(o: Order) { db.orders.push(o); saveDb(); },
  removeOrder(id: string) {
    const i = db.orders.findIndex(o => o.id === id);
    if (i >= 0) { db.orders.splice(i, 1); saveDb(); return true; }
    return false;
  },
  addPurchase(p: Purchase) { db.purchases.push(p); saveDb(); },
  /**
   * 删除一条进货入库记录。
   * 设计说明：
   * - 该方法只负责从 purchases 数组移除并落盘；
   * - “撤回进货”业务需要同时回滚库存并写入对冲流水，属于路由层的业务逻辑，
   *   不在 storage 层隐式完成，避免后续复用时产生意外副作用。
   */
  removePurchase(id: string) {
    const i = db.purchases.findIndex(p => p.id === id);
    if (i >= 0) {
      db.purchases.splice(i, 1);
      saveDb();
      return true;
    }
    return false;
  },
  addInventoryLog(l: InventoryLog) { db.inventoryLogs.push(l); saveDb(); },
};

// Utilities for backup management
export const backupManager = {
  _config: { enabled: process.env.AUTO_BACKUP_CRON === 'true', hours: Number(process.env.AUTO_BACKUP_HOURS || 24), retain: Number(process.env.AUTO_BACKUP_RETAIN || 7) },
  getConfig() { return this._config; },
  setConfig(next: Partial<{ enabled: boolean; hours: number; retain: number }>) {
    if (next.enabled !== undefined) this._config.enabled = !!next.enabled;
    if (next.hours !== undefined) this._config.hours = Math.max(1, Number(next.hours));
    if (next.retain !== undefined) this._config.retain = Math.max(1, Number(next.retain));
  },
  listBackups(): string[] {
    if (!existsSync(DATA_DIR)) return [];
    const files = readdirSync(DATA_DIR).filter(f => f.startsWith('db.backup.') && f.endsWith('.json'));
    return files.map(f => join(DATA_DIR, f)).sort((a, b) => (a < b ? 1 : -1));
  },
  createBackup(): string {
    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
    const dst = join(DATA_DIR, `db.backup.${Date.now()}.json`);
    copyFileSync(DB_FILE, dst);
    // cleanup retain policy
    const list = this.listBackups();
    const retain = this._config.retain;
    for (let i = retain; i < list.length; i++) {
      try { require('fs').unlinkSync(list[i]); } catch {}
    }
    return dst;
  }
};
