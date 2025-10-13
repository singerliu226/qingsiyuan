import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import { loadDb } from './storage';
import { ensureSeed } from './auth';
import { ensureCatalogSeed, ensurePricingSeed } from './seed';
import { router } from './routes';
import { errorHandler, logger, requestLogger } from './logger';

dotenv.config();
loadDb();
ensureSeed();
ensureCatalogSeed();
ensurePricingSeed();

const app = express();
app.disable('x-powered-by');
app.use(requestLogger);
app.use(helmet());
app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.use('/', router);
// 错误处理中间件放在路由之后
app.use(errorHandler);

const port = process.env.PORT ? Number(process.env.PORT) : 3001;
app.listen(port, () => {
  logger.info(`API listening on http://localhost:${port}`);
});

// 可选：简单的自动备份（每天一次）。默认关闭，设置 AUTO_BACKUP_CRON=true 启用。
{
  const { backupManager } = require('./storage');
  let timer: NodeJS.Timeout | null = null;
  function schedule() {
    if (timer) { clearInterval(timer); timer = null; }
    const cfg = backupManager.getConfig();
    if (!cfg.enabled) return;
    const ms = Math.max(1, cfg.hours) * 60 * 60 * 1000;
    timer = setInterval(() => {
      try {
        const file = backupManager.createBackup();
        logger.info('auto-backup:ok', { file });
      } catch (e: any) {
        logger.error('auto-backup:failed', { message: e?.message });
      }
    }, ms);
    (timer as any).unref?.();
    logger.info('auto-backup:enabled', { everyHours: cfg.hours, retain: cfg.retain });
  }
  schedule();
  (app as any).rescheduleBackup = schedule;
}
