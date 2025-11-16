## 端到端验收与常见问题自检清单（E2E Acceptance & Troubleshooting)

建议按顺序逐项打勾。每轮回归约 20 分钟；若超过 30 分钟仍未通过，启动“防停滞机制”：记录阻塞点、抓日志、回滚最近改动点再复测。

### 0. 启动前准备（Pre-flight）
- [ ] Node 版本 ≥ 18（`node -v`）
- [ ] 安装依赖：`server/` 与 `frontend/` 各执行 `npm i`
- [ ] 环境变量：
  - server 新建 `.env`（参考 `PORT=3001`, `TOKEN_KEY=strong-secret`, `LOG_LEVEL=info`）
  - frontend 开发默认走 Vite 代理（`VITE_API_BASE=/api`）
- [ ] 端口占用检查：3001（后端）、5173（前端）无冲突
- [ ] 首次运行或重置数据：如需干净数据，删除 `server/data/db.json` 以触发种子账号（店长：13800000000/123456）

### 1. 启动与健康检查（5 分钟）
- [ ] 启动后端：`server/` 执行 `npm run dev`，日志出现 `API listening on http://localhost:3001`
- [ ] 健康探针：`GET http://localhost:3001/health` 返回 `{ ok: true }`
- [ ] 启动前端：`frontend/` 执行 `npm run dev`，打开 `http://localhost:5173/`

### 2. 登录与权限（M1）
- [ ] 店长登录：13800000000/123456 成功，跳转首页
- [ ] 路由守卫：无 token 访问受限页跳转登录；已登录访问 `/login` 自动重定向回前页
- [ ] 角色控制：`/pricing` 仅店长可见且可访问；店员访问返回 403 页面

### 3. 首页与指标（M1/M5）
- [ ] KPI：今日应收、毛利试算展示；库存预警与阈值联动
- [ ] 快捷入口：显示“取货登记”“定价策略（仅店长）”

### 4. 取货登记（M2/M4）
- [ ] 步骤流：类型→产品→信息→确认，可前后切换
- [ ] 价格预览：选择类型/产品/数量后自动调用 `/orders/validate` 返回应收
- [ ] 提交订单：成功弹窗显示“5 分钟可撤销”
- [ ] 撤销订单：点击“撤销订单”，库存与流水回滚，二次查询库存验证数量正确
- [ ] 库存不足：下单超出配方扣减量，收到 `INSUFFICIENT_STOCK` 错误提示

### 5. 进货与库存（M3）
- [ ] 入库：选择原料、输入克数/成本，提交后库存增加，流水出现入库记录
- [ ] 原料列表：搜索、排序（名称/库存/阈值）、分页工作正常
- [ ] 库存流水：筛选（kind/materialId/refType/时间窗）与分页工作正常

### 6. 产品与配方（M4）
- [ ] 新建产品：名称/基础价/配方校验，创建后可见于列表
- [ ] 编辑产品：修改名称/基础价/配方保存成功，后续下单按新配方与价格计算
- [ ] 调用记录：打开“调用记录”对话框，数量与应收统计正确（最近 20 条）

### 7. 统计与导出（M5）
- [ ] 统计筛选：按日/周/月、类型与时间窗查询，ECharts 折线图展示；KPI 数值与筛选一致
- [ ] 导出 CSV：下载 `orders.csv`，内容含筛选范围
- [ ] 导出 Excel：下载 `orders.xlsx` 并可在 Excel 打开

### 8. 设置与账号（M6）
- [ ] 店员管理（店长）：新增/编辑（状态/角色）/重置密码为 123456
- [ ] 修改密码：当前用户输入原密码与新密码成功修改；退出重登后新密码生效
- [ ] 关于/导出：设置页可直接导出订单（与统计导出等价）

### 9. 可用性与无障碍（M7）
- [ ] Skip Link：键盘 `Tab` 首个焦点出现“跳到主内容”，回车后主内容聚焦
- [ ] 焦点可见性：`Tab` 遍历组件时可见 `:focus-visible` 样式
- [ ] 标题同步：路由切换 `document.title` 更新为“青丝源 · 页面名”
- [ ] 导航 ARIA：当前页按钮 `aria-current="page"` 正确切换

---

## 常见问题 Checklist（Troubleshooting）

### 启动/环境
- [ ] 端口占用：3001/5173 被占用 → 修改 `server/.env` 的 `PORT` 或 Vite 配置
- [ ] TOKEN_KEY 不一致：后端更换 `TOKEN_KEY` 导致旧 token 无效 → 清空浏览器 LocalStorage 重新登录
- [ ] Vite 代理未生效：前端 404 或 CORS 报错 → 检查 `frontend/vite.config.ts` 代理 `/api`；前端 `VITE_API_BASE=/api`
- [ ] 依赖未装全：导出失败 `exceljs` not found → 在 `server/` 重新 `npm i`

### 登录/权限
- [ ] 登录后仍跳登录：token 未注入 → 刷新后 `stores/auth.ts` 的 `bootstrap()` 会注入 Authorization；确认后端 `cors()` 与 `/auth/me` 可用
- [ ] `/pricing` 403：店员受限；若店长仍 403，检查 `auth.user.role` 与后端 `requireRole`

### 数据与订单
- [ ] 撤销窗口已过期：系统时间不准或超过 5 分钟 → 对齐时钟；或重下单立即撤销
- [ ] 库存不变/流水缺失：确认提交成功并查看后端日志；`/inventory/logs` 是否有对应记录
- [ ] JSON 异常：手动编辑 `server/data/db.json` 导致解析失败 → 删除该文件重启后端重新种子

### 统计与导出
- [ ] 图表为空：需有订单数据；无数据时为空属正常
- [ ] Excel 打不开：Excel 版本过旧或下载被拦截 → 先用 CSV

### 提示与 UI
- [ ] 401 BAD_TOKEN：token 过期 → 重新登录；后端 `req:finish` status=401 日志定位
- [ ] 错误提示未出现：确保视图用 `ElMessage` 展示后端 `{ error.message }`

---

## 日志与错误自检
- [ ] 请求日志：每个请求结束有 `req:finish`（status/durationMs）
- [ ] 业务错误：`{ error: { code, message } }`；未捕获异常由 `errorHandler` 返回 `{ code: 'INTERNAL', reqId }`
- [ ] 追踪 ID：同一请求日志含 `reqId`

---

## 回归用时与防停滞机制
- [ ] 标准回归 20 分钟；关键路径（登录→取货→撤销→入库→统计→导出→设置）优先
- [ ] 超 30 分钟：记录阻塞点/日志，回滚最近改动点，必要时功能降级（Excel→CSV）

---

## 版本与账号
- [ ] 版本：v0.1.0
- [ ] 默认店长：13800000000 / 123456

提示：生产环境务必更换强 `TOKEN_KEY`、限制 CORS 源、配置持久化与备份（当前为本地 JSON 存储）。








