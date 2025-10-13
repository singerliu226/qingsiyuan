# 青丝源进销存系统部署指南

## Zeabur 部署配置

### 1. 前置准备
- 注册 Zeabur 账号：https://zeabur.com
- 连接 GitHub 账号授权
- 创建新项目

### 2. 后端服务配置（Node.js Service）

#### 创建服务
1. 点击"Create Service" → "GitHub" → 选择 `singerliu226/qingsiyuan`
2. 服务类型选择 "Node.js"
3. 服务名称设置为 `qingsiyuan-backend`

#### 构建配置
- **Root Directory**: `server`
- **Build Command**: `npm ci && npm run build`
- **Start Command**: `npm run start`
- **Node Version**: `20`
- **Port**: `3001`

#### 环境变量
```env
# 必需的环境变量
TOKEN_KEY=your-random-secret-key-at-least-32-chars
DATA_DIR=/app/data

# 可选的环境变量
AUTO_BACKUP=true
AUTO_BACKUP_HOURS=24
AUTO_BACKUP_RETAIN=7
LOG_DIR=/app/logs
NODE_ENV=production
```

#### 持久化存储
1. 点击"Storage" → "Add Volume"
2. Mount Path: `/app/data`
3. Size: 1GB（根据需要调整）

#### 健康检查
- Path: `/health`
- Interval: 30s
- Timeout: 10s
- Retries: 3

### 3. 前端服务配置（Static Site）

#### 创建服务
1. 点击"Create Service" → "GitHub" → 选择同一仓库
2. 服务类型选择 "Static Site"
3. 服务名称设置为 `qingsiyuan-frontend`

#### 构建配置
- **Root Directory**: `frontend`
- **Build Command**: `npm ci && npm run build`
- **Output Directory**: `dist`
- **Node Version**: `20`

#### 路由转发规则
在前端服务的"Settings" → "Rewrite Rules"添加：
```
/api/* -> http://qingsiyuan-backend:3001/$1
```

### 4. 域名配置

#### 绑定自定义域名
1. 在前端服务的"Domain"设置中添加自定义域名
2. 配置 DNS CNAME 记录指向 Zeabur 提供的域名
3. 等待 SSL 证书自动签发（通常几分钟内完成）

#### 免费域名（可选）
Zeabur 提供免费的 `.zeabur.app` 子域名，可直接使用。

### 5. 部署流程

#### 初次部署
1. Push 代码到 GitHub 仓库
2. 在 Zeabur 项目中选择仓库分支（main）
3. 触发自动构建和部署
4. 等待服务启动（约2-5分钟）

#### 持续部署
- 默认启用 GitHub 自动部署
- 每次 push 到 main 分支会自动触发重新部署
- 可在"Settings" → "Git" 中配置部署分支

### 6. 监控和日志

#### 查看日志
- 实时日志：服务页面 → "Logs" 标签
- 历史日志：如配置了 LOG_DIR，可通过文件系统访问

#### 监控指标
- CPU 使用率
- 内存使用率
- 网络流量
- 请求数和响应时间

### 7. 备份策略

#### 自动备份
如果设置了 `AUTO_BACKUP=true`，系统会自动备份：
- 备份频率：每24小时（可通过 AUTO_BACKUP_HOURS 调整）
- 保留期限：7天（可通过 AUTO_BACKUP_RETAIN 调整）
- 备份位置：`/app/data/backups/`

#### 手动备份
1. 通过"设置"页面的"导出/备份"功能
2. 或直接下载 `/app/data/db.json` 文件

### 8. 故障排查

#### 常见问题

**Q: 前端无法访问后端 API**
- 检查路由转发规则是否正确配置
- 确认后端服务已启动并运行在 3001 端口
- 查看后端服务日志是否有错误

**Q: 数据丢失问题**
- 确认已配置持久化存储卷
- 检查 DATA_DIR 环境变量是否正确设置为 `/app/data`
- 验证 db.json 文件是否存在于持久化目录

**Q: 登录失败**
- 检查 TOKEN_KEY 环境变量是否设置
- 确认用户数据已初始化（首次部署会自动创建默认用户）

### 9. 性能优化建议

#### 前端优化
- 启用 Zeabur CDN 加速
- 配置合理的缓存策略
- 使用 Gzip/Brotli 压缩

#### 后端优化
- 根据实际负载调整实例数量
- 合理设置内存限制（推荐 512MB 起步）
- 定期清理过期的备份文件

### 10. 安全建议

#### 必须设置
- ✅ 强随机的 TOKEN_KEY（至少32字符）
- ✅ 修改默认管理员密码
- ✅ 启用 HTTPS（Zeabur 自动配置）

#### 推荐设置
- 定期更新依赖包
- 启用访问日志审计
- 设置 IP 白名单（如需要）
- 定期备份数据

## Docker Compose 部署（备选方案）

如需本地或其他服务器部署，可使用 Docker Compose：

```yaml
# docker-compose.yml
version: '3.8'

services:
  backend:
    build: ./server
    ports:
      - "3001:3001"
    environment:
      - TOKEN_KEY=${TOKEN_KEY}
      - DATA_DIR=/data
      - NODE_ENV=production
    volumes:
      - ./data:/data
    restart: unless-stopped

  frontend:
    build: ./frontend
    ports:
      - "80:80"
    depends_on:
      - backend
    restart: unless-stopped
```

### 后端 Dockerfile
```dockerfile
# server/Dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
RUN npm run build
EXPOSE 3001
CMD ["npm", "start"]
```

### 前端 Dockerfile
```dockerfile
# frontend/Dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/nginx.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
```

### Nginx 配置
```nginx
# frontend/nginx.conf
server {
    listen 80;
    server_name _;
    root /usr/share/nginx/html;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /api {
        proxy_pass http://backend:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

## 联系支持

如遇到部署问题，请参考：
- GitHub Issues: https://github.com/singerliu226/qingsiyuan/issues
- Zeabur 文档: https://docs.zeabur.com

---
最后更新：2024年10月13日
