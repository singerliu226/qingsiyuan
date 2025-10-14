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
const DATA_DIR = process.env.DATA_DIR ? resolve(process.env.DATA_DIR) : join(process.cwd(), 'data');
const DB_FILE = join(DATA_DIR, 'db.json');

const defaultDb: DbShape = {
  users: [],
  materials: [],
  products: [],
  orders: [],
  purchases: [],
  inventoryLogs: [],
  pricing: { self: 1, vip: 0.8, distrib: 0.7, event: 1, plans: [
    // 自用（固定每包 80 元，按 15/30 次打包示例）
    { id: 'plan-self-15', group: 'self', name: '自用15次', setPrice: 1200, packCount: 15, perPackPrice: 80, remark: '自用固定¥80/包' },
    { id: 'plan-self-30', group: 'self', name: '自用30次', setPrice: 2400, packCount: 30, perPackPrice: 80, remark: '自用固定¥80/包' },
    // 分销（三档）
    { id: 'plan-distrib-1', group: 'distrib', name: '分销一', setPrice: 14280, packCount: 45, perPackPrice: 317, remark: '首次拿货3×15次疗程套装' },
    { id: 'plan-distrib-2', group: 'distrib', name: '分销二', setPrice: 20400, packCount: 75, perPackPrice: 272, remark: '拿货5×15次疗程套装' },
    { id: 'plan-distrib-3', group: 'distrib', name: '分销三', setPrice: 102000, packCount: 450, perPackPrice: 227, remark: '拿货30×15次疗程套装' },
    // 零售（两档）
    { id: 'plan-retail-1', group: 'retail', name: '零售一', setPrice: 6800, packCount: 15, perPackPrice: 453, remark: '15次疗程套装' },
    { id: 'plan-retail-2', group: 'retail', name: '零售二', setPrice: 12300, packCount: 30, perPackPrice: 410, remark: '30次疗程套装' },
    // 临时活动（三档）
    { id: 'plan-temp-1', group: 'temp', name: '临时活动一', setPrice: 999, packCount: 3, perPackPrice: 333, remark: '开业活动 999 元 3 次疗程' },
    { id: 'plan-temp-2', group: 'temp', name: '临时活动二', setPrice: 5780, packCount: 15, perPackPrice: 385, remark: '好友推荐 8.5 折' },
    { id: 'plan-temp-3', group: 'temp', name: '临时活动三', setPrice: 1088, packCount: 3, perPackPrice: 363, remark: '3 次体验 8 折优惠券' },
  ] },
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
