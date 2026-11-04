# 本地开发与测试

## 环境要求

- Node.js `>=20` 与 npm。文档站使用已锁定的 VitePress `2.0.0-alpha.21`；该工具链依赖 Vite 8，要求 Node.js `^20.19.0` 或 `>=22.12.0`，建议统一使用 Node.js 22.12+。
- Git、可访问 npm registry 的开发环境；可选的平台账号只在真实联调或部署时需要。

## 安装和启动

```sh
npm ci
npm run dev
```

`npm run dev` 并行启动本地 Hono API（默认 `127.0.0.1:8787`）与 Vite 管理台（默认 `5173`，`/api` 代理到 API）。Node 入口读取进程环境变量：`SYS_PASSWD`、`SYS_SECRET`、`API_METHOD`、`LOG_RECORD` 和 `PORT`。`.dev.vars.example` 是 Wrangler 本地运行模板；普通 Node 进程不会自动加载 `.dev.vars`。

本地 Node 入口不自动创建 D1/KV 数据库 binding。管理配置、聊天上下文和其他需要持久化的功能，需在具有真实持久化 binding 的 Worker/平台运行时测试；不能把服务器能启动等同于数据路径可用。

## 常用检查

```sh
npm run typecheck
npm test
npm run build
npm run build:worker
npm run build:edgeone
npm run build:esa
```

- `typecheck` 使用 TypeScript 检查源码。
- `test` 运行 Vitest；测试文件与实现共置于 `src/**/*.test.ts`。
- `build` 执行类型检查并构建前端到 `dist/`。
- `build:worker` 使用 `wrangler.example.jsonc` 做 Cloudflare dry-run，不部署生产资源。
- EdgeOne / ESA 构建产物位于 `dist/edge-functions/` 和 `dist/edge-routine/`。

## 文档站

```sh
npm run docs:dev
npm run docs:build
npm run docs:preview
```

开发服务器只绑定 `127.0.0.1`。构建静态站输出到 `docs/.vitepress/dist/`，可上传到任意静态托管服务；它与应用的 `dist/` 输出分离。当前锁定的 VitePress 版本为 alpha，升级时重新检查 Node 要求、依赖审计及本文档构建。

## 变更工作流

1. 先在 `docs/design/requirements.md` 补充可验证场景，或明确该变更不涉及产品行为。
2. 涉及跨平台行为、权限或存储时更新 `docs/design/architecture.md`，并核对平台 adapter 的能力差异。
3. 实现变更并更新相应 `*.test.ts`；不以文档替代行为测试。
4. 执行类型检查、定向测试和完整测试，再构建应用及文档站。
5. 检查中英文文档链接、环境变量、部署说明与实际配置是否一致。

## 配置安全

不要提交 `.dev.vars`、真实 provider/QQ 凭据、平台 token 或生产数据库 ID。测试请使用隔离资源和无效测试凭据。处理真实线上资源、迁移或数据时，先确认目标环境、备份和回滚步骤。
