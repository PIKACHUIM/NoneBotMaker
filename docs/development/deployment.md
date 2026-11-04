# 多平台部署

各平台复用 `src/server/app.ts`，但入口、持久化和可用功能并不完全一致。先按目标平台准备资源，再部署与验证；不要把本地 build 成功当作平台 binding 已配置。

## 通用环境变量

| 名称 | 用途 |
| --- | --- |
| `SYS_PASSWD` | 管理台登录密码，建议通过平台 Secret 设置。 |
| `SYS_SECRET` | session 签名、敏感凭据加密和受保护维护接口；必须是独立高熵 Secret。 |
| `API_METHOD` | `webhook`（默认）或 `websocket`；WebSocket Gateway 仅 Cloudflare 支持。 |
| `LOG_RECORD` | 是否记录对话日志，默认关闭。 |

QQ AppID/AppSecret 和 AI Provider Key 在管理员登录后配置到相应账号/供应商，不应写在公开环境变量模板或部署命令参数中。

## Cloudflare Workers

### 资源

创建 D1 数据库和 KV namespace，把名称与 ID 写到个人 Worker 配置中。使用 `wrangler.example.jsonc` 了解所需绑定，勿提交含个人账户信息的配置。默认主入口为 `src/platform/cloudflare/worker.ts`，前端 assets 由 `dist/` 提供。

```sh
npx wrangler d1 create nonebot-data
npx wrangler kv namespace create nonebot-kv
```

### 构建、迁移与部署

```sh
npm ci
npm run build
npx wrangler d1 migrations apply <database-name> --remote --config wrangler.jsonc
npx wrangler secret put SYS_PASSWD
npx wrangler secret put SYS_SECRET
npx wrangler deploy --config wrangler.jsonc
```

也可以先部署，再访问 `/setup` 并使用 `SYS_SECRET` 初始化 schema。两种 migration 路径不要重复手工执行 DDL。`npm run build:worker` 仅为 dry-run。

默认 `API_METHOD=webhook`。要使用 Cloudflare Gateway，需配置 `QQ_GATEWAY_SESSIONS` Durable Object binding、SQLite class migration，并评估 WebSocket 常驻连接的计费与配额。更多配置字段以目标 Cloudflare 帐户实际支持的 Wrangler schema 为准。

## EdgeOne

构建函数包：

```sh
npm run build:edgeone
```

部署入口为 `dist/edge-functions/api/[[default]].js`。运行环境需要提供 `EDGEONE_BLOB` 或 `EDGEONE_KV`；可按项目存储配置提供 `KV`。Blob 优先于 EdgeOne KV。维护日志清理接口时还需配置可持久化清理节流标记的 KV。将 `SYS_PASSWD` 与 `SYS_SECRET` 配置为平台环境 Secret。

## 阿里云 ESA

构建函数包：

```sh
npm run build:esa
```

部署入口为 `dist/edge-routine/index.js`。ESA 环境需要 `ESA_KV` 或 `KV`，并设置 `SYS_PASSWD` 与 `SYS_SECRET`。当前 ESA 入口支持 Webhook，不支持 WebSocket Gateway。

## 本地 Worker 集成验证

当 `wrangler.jsonc` 已配置有效资源与 local bindings 后，可用 `wrangler dev` 验证真实 Worker 入口。先运行 `npm run build` 生成静态 assets，并在隔离的 D1/KV 本地状态目录执行迁移。不要对真实生产配置执行 `--local` 测试，也不要将含生产 IDs 的配置复制进文档。

## 部署后检查

1. 检查 `/api/health` 与 `/api/setup/status`。
2. 确认 schema 已就绪、持久化 binding 可写读、管理员登录成功。
3. 核对 QQ callback URL、签名 headers、账号启用状态与会话 OpenID。
4. 使用受控测试会话验证 AI provider、用量和回复权限。
5. 启用日志前确认访问权限、保留策略和清理调度；检查账单、配额和错误率。

EdgeOne/ESA 的存储一致性、媒体接口、定时触发和部署控制台行为均由目标平台决定；发布前需在对应账号实测。
