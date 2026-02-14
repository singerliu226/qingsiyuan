/**
 * 本地 API 适配器
 *
 * 核心模块：提供与 axios 兼容的 get/post/patch 接口，
 * 根据 URL 模式匹配分发到对应的本地 service 函数。
 *
 * 设计目标：所有 Vue 页面零修改。页面中的 `api.get('/materials')` 等调用
 * 会被透明地路由到 IndexedDB 本地操作，无需网络请求。
 *
 * 响应格式模拟 axios：返回 { data: ... } 对象。
 * 错误格式模拟 axios error：{ response: { status, data: { error: { code, message } } } }
 */
import * as authService from '../services/auth-service';
import * as materialService from '../services/material-service';
import * as productService from '../services/product-service';
import * as orderService from '../services/order-service';
import * as purchaseService from '../services/purchase-service';
import * as inventoryService from '../services/inventory-service';
import * as reportService from '../services/report-service';
import * as adminService from '../services/admin-service';

// ===================== 类型定义 =====================

/** 与 axios 的 AxiosResponse 对齐，data 使用 any 确保 Vue 页面零修改 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
interface AdapterResponse<T = any> {
  data: T;
  status: number;
  headers: Record<string, string>;
}

interface AdapterConfig {
  params?: Record<string, unknown>;
  responseType?: string;
  [key: string]: unknown;
}

// ===================== URL 路由器 =====================

/**
 * 提取 URL 中的路径参数。
 * 例如：match('/products/abc123/usage', /^\/products\/(.+)\/usage$/) => 'abc123'
 */
function matchUrl(url: string, pattern: RegExp): RegExpMatchArray | null {
  return url.match(pattern);
}

// ===================== GET 路由 =====================

async function handleGet(url: string, config?: AdapterConfig): Promise<unknown> {
  const params = config?.params || {};

  // Auth
  if (url === '/auth/me') {
    const session = authService.getSession();
    if (!session) throw makeAdapterError(401, 'UNAUTH', 'Missing token');
    return session;
  }

  // Users
  if (url === '/users') return authService.listUsers();

  // Materials
  if (url === '/materials') return materialService.list();

  // Products
  if (url === '/products') return productService.list();

  // Product usage
  let m = matchUrl(url, /^\/products\/(.+)\/usage$/);
  if (m) return productService.usage(m[1]!);

  // Pricing (owner)
  if (url === '/pricing') return adminService.getPricing();

  // Pricing plans (readonly)
  if (url === '/pricing/plans') return adminService.getPlans();

  // Purchases
  if (url === '/purchases') return purchaseService.list();

  // Orders
  if (url === '/orders') return orderService.list();

  // Inventory logs
  if (url === '/inventory/logs') return inventoryService.logs(params as Record<string, string>);

  // Reports
  if (url === '/reports/summary') return reportService.summary(params as Record<string, string>);

  // Reports export
  if (url === '/reports/export') {
    const result = await reportService.exportData(params as Record<string, string>);
    // 触发浏览器下载
    adminService.downloadCsv(result.content, result.filename);
    // 返回空 blob（前端期望 responseType: 'blob'，但本地模式直接下载即可）
    return new Blob([result.content], { type: result.contentType });
  }

  // Admin
  if (url === '/admin/backups') return []; // 离线模式不支持服务端备份列表
  if (url === '/admin/backup-config') return adminService.getBackupConfig();
  if (url === '/admin/db-download') {
    const content = await adminService.exportDatabase();
    adminService.downloadJson(content, 'db.json');
    return new Blob([content], { type: 'application/json' });
  }

  throw makeAdapterError(404, 'NOT_FOUND', `未匹配的路由: GET ${url}`);
}

// ===================== POST 路由 =====================

async function handlePost(url: string, data?: unknown): Promise<unknown> {
  const body = (data || {}) as Record<string, unknown>;

  // Auth
  if (url === '/auth/login') {
    return authService.login(String(body.phone || ''), String(body.password || ''));
  }
  if (url === '/auth/reset-password') {
    await authService.resetPassword(
      String(body.phone || ''),
      String(body.resetKey || ''),
      String(body.newPassword || ''),
    );
    return { ok: true };
  }
  if (url === '/auth/change-password') {
    const session = authService.getSession();
    if (!session) throw makeAdapterError(401, 'UNAUTH', 'Missing token');
    await authService.changePassword(session.id, String(body.currentPassword || ''), String(body.newPassword || ''));
    return { ok: true };
  }

  // Users
  if (url === '/users') {
    return authService.createUser(body as { name: string; phone: string; role: string; password?: string });
  }

  // Materials
  if (url === '/materials') return materialService.create(body);

  // Material decrease
  let m = matchUrl(url, /^\/materials\/(.+)\/decrease$/);
  if (m) {
    const session = authService.getSession();
    return materialService.decrease(m[1]!, Number(body.grams || 0), String(body.operator || session?.name || ''));
  }

  // Products
  if (url === '/products') return productService.create(body);

  // Product decrease-stock
  m = matchUrl(url, /^\/products\/(.+)\/decrease-stock$/);
  if (m) {
    const session = authService.getSession();
    return productService.decreaseStock(m[1]!, Number(body.qty || 0), String(body.operator || session?.name || ''));
  }

  // Purchases
  if (url === '/purchases') {
    return purchaseService.create(body as { materialId: string; grams: number; cost?: number; operator?: string });
  }
  if (url === '/purchases/batch') {
    const items = Array.isArray(body.items) ? body.items : [];
    return purchaseService.batchCreate(items);
  }

  // Purchase revoke
  m = matchUrl(url, /^\/purchases\/(.+)\/revoke$/);
  if (m) {
    const session = authService.getSession();
    return purchaseService.revoke(m[1]!, session?.name || '');
  }

  // Inventory produce
  if (url === '/inventory/produce') {
    const items = Array.isArray(body.items) ? body.items : [];
    return inventoryService.produce(items);
  }

  // Orders
  if (url === '/orders') {
    return orderService.create(body as Parameters<typeof orderService.create>[0]);
  }
  if (url === '/orders/validate') {
    return orderService.validate(body as Parameters<typeof orderService.validate>[0]);
  }

  // Order cancel
  m = matchUrl(url, /^\/orders\/(.+)\/cancel$/);
  if (m) return orderService.cancel(m[1]!);

  // Pricing
  if (url === '/pricing') return adminService.updatePricing(body);

  // Admin
  if (url === '/admin/backup') {
    const content = await adminService.exportDatabase();
    adminService.downloadJson(content, `db.backup.${Date.now()}.json`);
    return { ok: true, file: `db.backup.${Date.now()}.json` };
  }
  if (url === '/admin/backup-upload') {
    const rawContent = body.content as string;
    const apply = !!body.apply;
    if (apply && rawContent) {
      await adminService.importDatabase(rawContent);
      return { ok: true, applied: true };
    }
    return { ok: true, applied: false };
  }
  if (url === '/admin/restore') {
    // 离线模式不支持从服务端文件路径恢复
    throw makeAdapterError(400, 'VALIDATION', '离线模式请使用"导入数据"功能');
  }
  if (url === '/admin/materials-zero') return adminService.materialsZero();
  if (url === '/admin/seed-pricing') return adminService.seedPricing();
  if (url === '/admin/backup-config') return adminService.setBackupConfig(body);

  throw makeAdapterError(404, 'NOT_FOUND', `未匹配的路由: POST ${url}`);
}

// ===================== PATCH 路由 =====================

async function handlePatch(url: string, data?: unknown): Promise<unknown> {
  const body = (data || {}) as Record<string, unknown>;

  // Users
  let m = matchUrl(url, /^\/users\/(.+)$/);
  if (m) return authService.updateUser(m[1]!, body);

  // Materials
  m = matchUrl(url, /^\/materials\/(.+)$/);
  if (m) return materialService.update(m[1]!, body as { name?: string; stock?: number; threshold?: number });

  // Products
  m = matchUrl(url, /^\/products\/(.+)$/);
  if (m) return productService.update(m[1]!, body);

  // Pricing
  if (url === '/pricing') return adminService.updatePricing(body);

  throw makeAdapterError(404, 'NOT_FOUND', `未匹配的路由: PATCH ${url}`);
}

// ===================== 适配器主体 =====================

/**
 * 将 service 调用结果包装为 axios 风格的响应对象。
 */
function wrap<T>(data: T): AdapterResponse<T> {
  return { data, status: 200, headers: {} };
}

/**
 * 构造 axios 风格的错误对象。
 * Vue 页面的 catch 块期望 err.response.data.error.message 格式。
 */
function makeAdapterError(status: number, code: string, message: string, details?: unknown): Error & { response: { status: number; data: { error: { code: string; message: string; details?: unknown } } } } {
  const err = new Error(message) as Error & { response: { status: number; data: { error: { code: string; message: string; details?: unknown } } } };
  err.response = {
    status,
    data: { error: { code, message, ...(details ? { details } : {}) } },
  };
  return err;
}

/**
 * 将 service 层抛出的 makeError 错误转换为 adapter 格式。
 */
function convertError(e: unknown): never {
  if (e instanceof Error) {
    const err = e as Error & { status?: number; code?: string; details?: unknown; response?: unknown };
    // 已经是 adapter 格式（有 response 属性）
    if (err.response) throw e;
    // service 层的 makeError 格式
    if (err.status && err.code) {
      throw makeAdapterError(err.status, err.code, err.message, err.details);
    }
  }
  throw makeAdapterError(500, 'INTERNAL', String(e));
}

/**
 * 本地 API 适配器对象。
 *
 * 接口与 axios 实例兼容：
 * - get(url, config?) → Promise<{ data }>
 * - post(url, data?, config?) → Promise<{ data }>
 * - patch(url, data?, config?) → Promise<{ data }>
 *
 * 所有 Vue 页面直接使用此对象替代 axios，无需修改调用代码。
 */
const localAdapter = {
  async get(url: string, config?: AdapterConfig): Promise<AdapterResponse> {
    try {
      const result = await handleGet(url, config);
      return wrap(result);
    } catch (e) {
      convertError(e);
    }
  },

  async post(url: string, data?: unknown, _config?: AdapterConfig): Promise<AdapterResponse> {
    try {
      const result = await handlePost(url, data);
      return wrap(result);
    } catch (e) {
      convertError(e);
    }
  },

  async patch(url: string, data?: unknown, _config?: AdapterConfig): Promise<AdapterResponse> {
    try {
      const result = await handlePatch(url, data);
      return wrap(result);
    } catch (e) {
      convertError(e);
    }
  },

  /** 拦截器存根：兼容部分代码对 interceptors 的引用 */
  interceptors: {
    request: { use: () => 0, eject: () => {} },
    response: { use: () => 0, eject: () => {} },
  },
};

export default localAdapter;
