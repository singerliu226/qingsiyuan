## API 规范（草案）

### 鉴权
- POST /auth/login { phone, password } → { token, user{ id, role, name } }
- GET /auth/me → { id, role, name }

授权：Bearer Token；店长/店员角色控制写入操作。

### 材料（Materials）
- GET /materials → [{ id, name, unit, stock, threshold }]
- POST /materials { name, unit, stock, threshold } → material
- PATCH /materials/:id { name?, unit?, stock?, threshold? }

### 产品与配方（Products）
- GET /products → [{ id, name, priceBase, recipe: [{ materialId, grams }] }]
- POST /products { name, priceBase, recipe[] } → product
- PATCH /products/:id { name?, priceBase?, recipe? }

### 进货（Purchases）
- GET /purchases → [{ id, materialId, grams, cost, createdAt }]
- POST /purchases { materialId, grams, cost } → purchase
  - 写入库存：InventoryLog(kind=in)

### 订单/出库（Orders）
- GET /orders?range=day|week|month&type=all|self|vip|distrib|event
- POST /orders {
  type, productId, qty, person, payment
} → { id, receivable, createdAt }
  - 定价：receivable = qty × priceBase × discount(type)
  - 扣减：按产品 recipe × qty 写入 InventoryLog(kind=out)

### 统计（Reports）
- GET /reports/summary?from=ISO&to=ISO&type=all|self|vip|distrib|event → {
  receivableTotal, purchaseCost, grossEstimate, series: [{ date, receivable }]
}

### 用户（Users）
- GET /users → 仅店长
- POST /users → 仅店长
- PATCH /users/:id → 仅店长

### 折扣策略
- GET /pricing → { self:1, vip:0.8, distrib:0.7, event:1 }
- PATCH /pricing { self?, vip?, distrib?, event? }

### 错误格式
{ error: { code, message, details? } }

### 示例（创建订单）
Request:
{
  "type": "vip",
  "productId": "p_black",
  "qty": 1,
  "person": "王小姐",
  "payment": "cash"
}

Response:
{
  "id": "ord_25051301",
  "receivable": 96,
  "createdAt": "2025-10-08T09:30:00Z"
}
