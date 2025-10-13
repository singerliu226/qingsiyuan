import winston from 'winston';

/**
 * 创建应用级 Winston 日志器。
 * 设计要点：
 * - 统一 JSON 格式，便于后续接入集中式日志（如 ELK）。
 * - 根据环境变量 LOG_LEVEL 调整日志级别，默认 info；开发环境同时打印到控制台。
 */
export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console({
      level: process.env.LOG_LEVEL || 'info',
      format: winston.format.combine(
        winston.format.colorize({ all: process.stdout.isTTY }),
        winston.format.timestamp(),
        winston.format.printf(({ level, message, timestamp, ...meta }) => {
          const tail = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
          return `${timestamp} ${level}: ${message}${tail}`;
        })
      ),
    }),
  ],
});

/**
 * 生成每次请求的简单访问日志。
 * 说明：
 * - 不使用 morgan，直接在中间件中捕获响应完成事件，记录 status/耗时/
 *   method/url/reqId 等，减少依赖并统一进入 Winston。
 */
export function requestLogger(req: any, res: any, next: any) {
  const start = Date.now();
  // 轻量请求 ID，便于串联日志
  const reqId = (req as any).id || Math.random().toString(36).slice(2, 10);
  (req as any).id = reqId;
  logger.debug('req:start', { reqId, method: req.method, url: req.originalUrl });
  res.on('finish', () => {
    const durationMs = Date.now() - start;
    const meta = {
      reqId,
      method: req.method,
      url: req.originalUrl,
      status: res.statusCode,
      durationMs,
    };
    if (res.statusCode >= 500) logger.error('req:finish', meta);
    else if (res.statusCode >= 400) logger.warn('req:finish', meta);
    else logger.info('req:finish', meta);
  });
  next();
}

/**
 * 统一错误处理中间件。
 * 策略：
 * - 识别业务错误格式 { error: { code, message } } 直接透传；
 * - 其余错误记录堆栈并返回通用错误码，避免泄漏实现细节。
 */
export function errorHandler(err: any, req: any, res: any, _next: any) {
  const reqId = (req as any).id;
  // 已按标准格式包装的业务错误：直接返回
  if (err && err.error && err.error.code) {
    logger.warn('biz:error', { reqId, ...err });
    return res.status(err.status || 400).json(err);
  }
  logger.error('unhandled:error', { reqId, message: err?.message, stack: err?.stack });
  return res.status(500).json({ error: { code: 'INTERNAL', message: '服务器开小差了，请稍后再试', reqId } });
}


