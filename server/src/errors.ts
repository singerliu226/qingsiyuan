/**
 * 业务错误与工具方法。
 * 约定：使用 throw 抛出 createError(...) 的返回值，由统一错误处理中间件捕获并格式化响应。
 */

export interface BizErrorBody {
  error: { code: string; message: string; details?: any };
  status?: number;
}

/**
 * 构造业务错误对象。
 * 使用方法：throw createError('VALIDATION', '参数错误', 400, { field: 'name' })
 */
export function createError(code: string, message: string, status = 400, details?: any): BizErrorBody {
  return { status, error: { code, message, ...(details ? { details } : {}) } };
}

export const Errors = {
  unauth: (msg = 'Missing token') => createError('UNAUTH', msg, 401),
  badToken: (msg = 'Invalid token') => createError('BAD_TOKEN', msg, 401),
  forbidden: (msg = 'Forbidden') => createError('FORBIDDEN', msg, 403),
  notFound: (msg = 'Not found') => createError('NOT_FOUND', msg, 404),
  invalid: (msg = '账号或密码错误') => createError('INVALID', msg, 401),
  validation: (msg = '参数不合法', details?: any) => createError('VALIDATION', msg, 400, details),
  insufficient: (details?: any) => createError('INSUFFICIENT_STOCK', '库存不足', 400, details),
};









