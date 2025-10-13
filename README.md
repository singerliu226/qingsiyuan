## 青丝源进销存助手

### 快速开始
- 后端：
  - 进入 `server/` 执行 `npm i && npm run dev`
  - 健康检查：`GET http://localhost:3001/health`
- 前端：
  - 进入 `frontend/` 执行 `npm i && npm run dev`
  - 打开浏览器访问 `http://localhost:5173/`
- 默认店长账号：`13800000000 / 123456`

### 环境变量（server/.env）
- `PORT`：后端端口（默认 3001）
- `TOKEN_KEY`：JWT 密钥（生产必改）
- `LOG_LEVEL`：日志级别（info/debug）
- `AUTO_BACKUP_CRON`：是否启用自动备份（true/false）
- `AUTO_BACKUP_HOURS`：自动备份间隔小时数（默认 24）
- `AUTO_BACKUP_RETAIN`：备份最大保留份数（默认 7）

### 前端配置
- 开发走代理：`VITE_API_BASE=/api`（见 `frontend/vite.config.ts`）

### 备份与回滚
- 立即备份（店长）：`POST /admin/backup` → 生成 `data/db.backup.<ts>.json`
- 列表备份：`GET /admin/backups`
- 从备份恢复（店长）：`POST /admin/restore { file }`
- 自动备份配置：`GET/POST /admin/backup-config`（启用/频率/保留份数），支持运行时动态生效

### 端到端验收
- 清单文档：`E2E_ACCEPTANCE.md`
- 提交前钩子：`.husky/pre-push` 会构建前后端并校验清单文件存在
- 一键本地回归：`bash scripts/e2e-smoke.sh`

### 目录说明
- `server/`：Express API（JWT、库存/订单/统计、导出、备份）
- `frontend/`：Vue3 + Pinia + Element Plus（登录、出入库、产品、统计、设置）
- `scripts/`：辅助脚本（e2e-smoke）
- `E2E_ACCEPTANCE.md`：端到端验收与常见问题清单

### 安全建议
- 生产环境务必更换强 `TOKEN_KEY`，限制 CORS 源
- 持久化与备份：建议迁移到数据库与对象存储，并配置定时与保留策略


