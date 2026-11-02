<div align="center">

# NoneBotMaker

基于 Serverless 运行时的 QQ 官方机器人管理与聊天服务

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https%3A%2F%2Fgithub.com%2FPIKACHUIM%2FNoneBotMaker)
[![Deploy with EdgeOne](https://cdnstatic.tencentcs.com/edgeone/pages/deploy.svg)](https://edgeone.ai/pages/new?repository-url=https%3A%2F%2Fgithub.com%2FPIKACHUIM%2FNoneBotMaker&repository-name=NoneBotMaker&project-name=NoneBotMaker&install-command=npm%20install&build-command=npm%20run%20build%3Aedgeone&output-directory=dist)
[![Deploy to Alibaba Cloud ESA](https://img.shields.io/badge/Deploy_to-Alibaba_Cloud_ESA-FF6A00?logo=alibabacloud&logoColor=white)](https://esa.console.aliyun.com/)

</div>

> **部署提示：** Cloudflare 首次部署仍需根据 `wrangler.example.jsonc` 创建 `wrangler.jsonc`、填写资源配置，并按下文完成 D1 migration 与密钥设置。ESA 按钮会打开控制台，请选择「函数和 Pages → 创建 → 导入 GitHub 仓库」；ESA 官方目前未提供可预填仓库的一键部署链接。

| 平台 | 构建命令 | 产物 / 入口 |
| --- | --- | --- |
| Cloudflare Workers | `npm run build` | `src/platform/cloudflare/worker.ts` |
| EdgeOne | `npm run build:edgeone` | `dist/edge-functions/api/[[default]].js` |
| 阿里云 ESA | `npm run build:esa` | `dist/edge-routine/index.js` |

## 目录

- [本地验证](#本地验证)
- [QQ Webhook 回调](#qq-webhook-回调)
- [Cloudflare Workers](#cloudflare-workers)
- [EdgeOne 与 ESA](#edgeone-与-esa)
- [群聊预算与一致性](#群聊预算与一致性)
- [对话日志清理](#对话日志清理)

## 本地验证

```sh
npm install
npm run typecheck
npm test
npm run build
```

本地 Cloudflare secret 可参考 `.dev.vars.example`，不要提交真实密钥。

## QQ Webhook 回调

在 QQ 机器人回调配置中填写部署后的地址：

```text
https://<your-worker-domain>/webhook/qq
```

`<your-worker-domain>` 必须替换成实际部署域名。Webhook 会使用 `X-Bot-Appid` 定位账号，并验证 QQ 的签名；不要在代理层删除或改写签名相关请求头和原始 JSON body。Cloudflare 默认 `API_METHOD=webhook`，`LOG_RECORD=false`。

## Cloudflare Workers

### 配置与部署

仓库提供不含账号专属 ID 的 `wrangler.example.jsonc` 模板。首次部署时复制为本地 `wrangler.jsonc`（该文件由 Git 忽略），填写 D1 database name/ID 与 KV namespace ID。手动 Wrangler 命令显式指定本地配置；`npm run build:worker` 使用已跟踪的安全模板做通用 dry-run：

PowerShell:

```powershell
Copy-Item wrangler.example.jsonc wrangler.jsonc
```

macOS/Linux:

```sh
cp wrangler.example.jsonc wrangler.jsonc
```

填入 D1/KV 资源信息后先部署 Worker：

```sh
npx wrangler deploy --dry-run --config wrangler.jsonc --outdir .wrangler-build
npx wrangler deploy --config wrangler.jsonc
```

配置管理员密码和系统密钥。下面命令会逐项提示输入值；生成器可分别运行，为两个 secret 生成独立高熵值：

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
npx wrangler secret put SYS_PASSWD --config wrangler.jsonc
npx wrangler secret put SYS_SECRET --config wrangler.jsonc
```

`SYS_PASSWD` 用于管理台登录；`SYS_SECRET` 同时用于 session 签名、账号/provider 凭据加密、在线数据库初始化授权和手动日志清理授权。因为 `SYS_SECRET` 权限较高，外部调度器必须安全保存它。若从旧版本升级且数据库中已有加密凭据，将 `SYS_SECRET` 设置为旧 `DATA_ENCRYPTION_KEY` 的原值可继续解密；已有管理 session 会失效，需重新登录。

### 在线数据库初始化

首次部署后访问：

```text
https://<your-worker-domain>/setup
```

输入 `SYS_SECRET` 并执行初始化。页面会通过 Worker 的 D1 binding 创建记录、对话日志、chatbot 上下文/成本表和迁移记录，并写入 `0001`–`0003` 的 D1 migration 标记。脚本幂等，可安全重试；不会清空已有数据，也不会设置管理员密码。初始化完成后即可登录管理台。

也可以在部署前使用 CLI 应用迁移：

```sh
npx wrangler d1 migrations apply your-d1-database-name --remote --config wrangler.jsonc
```

两种方式二选一即可；在线初始化会记录迁移标记，之后 CLI 不会重复执行已应用的迁移。

### WebSocket Gateway（仅 Cloudflare）

将 `wrangler.jsonc` 的 `vars.API_METHOD` 改为 `websocket`。配置中 Durable Object binding 名为 `QQ_GATEWAY_SESSIONS`，class 为 `QQGatewayDurableObject`，并通过 `v1` / `new_sqlite_classes` migration 初始化。首次 Worker 请求会为已配置 QQ 账号启动 Gateway 会话。

DO 持久化账号、Gateway session/sequence、上下文和成本；alarm 在冷启动或断线后恢复连接。Outbound WebSocket 不支持 DO hibernation，会使 Durable Object 持续活跃并产生持续资源/计费成本，alarm 每 5 分钟维护连接。切回 webhook 时 Worker 会通过 `/disconnect` 清理旧会话；无 DO binding 的默认 webhook 不依赖 Durable Object，也不会启动 Gateway session。

## EdgeOne 与 ESA

EdgeOne 构建产物为 `dist/edge-functions/api/[[default]].js`：

```sh
npm run build:edgeone
```

在 EdgeOne 运行时绑定 `EDGEONE_BLOB` 或 `EDGEONE_KV`；也可按项目存储配置提供 `KV`。`EDGEONE_BLOB` 优先于 `EDGEONE_KV`。如使用 BLOB 存储且需要调用手动日志清理接口，还需配置 `EDGEONE_KV` 或 `KV` 保存清理节流标记。

ESA 构建产物为 `dist/edge-routine/index.js`：

```sh
npm run build:esa
```

在 ESA 运行时绑定 `ESA_KV` 或 `KV`。两个平台均需在运行时环境/密钥设置中配置 `SYS_PASSWD` 和 `SYS_SECRET`；需要手动清理日志时复用 `SYS_SECRET` 授权。

EdgeOne 和 ESA 仅支持 `API_METHOD=webhook`；若设置为 `websocket`，服务返回 `503 websocket_unsupported`。聊天上下文和成本按与记录仓库相同的 adapter 持久化；缺少对应持久化 binding 时会报部署配置错误，不会退化为跨请求内存状态。

## 群聊预算与一致性

群配置的 `dailyCostLimit`、`monthlyCostLimit`、`totalCostLimit` 单位为 USD，默认 `0` 表示不限制。支出按 `inputCostPerMillion`、`outputCostPerMillion` 与模型返回的 usage 估算。日限额按 UTC 日期重置，月限额按 UTC 月份重置，总额不重置；达到任一适用限额后，会在模型调用前停止处理。

群管理 API 响应头 `X-Chatbot-Cost-Consistency` 标明成本 adapter：D1 使用原子累计写入，KV 为 eventual consistency，Blob 为 provider-defined。检查发生在模型调用前，实际 usage 在模型返回后累计，因此检查和计费不是同一事务；并发调用可能超额。这是使用量控制，不是严格财务防护。

## 对话日志清理

`LOG_RECORD` 默认关闭。启用后记录入站消息和机器人回复，保留 30 天；日志不包含 bot/client secret 或 HTTP headers。

Cloudflare Worker 保留 `scheduled` handler，可在控制台为 Worker 添加每日 `03:00 UTC` 的 Cron Trigger；若账户的 Cron 配额已满，可不配置 Cron，改用外部调度器调用下方受保护接口。`wrangler.example.jsonc` 默认不声明 Cron，避免免费账户触发配额导致部署失败。其他平台或手动触发时，配置清理节流所需 KV，然后使用 `SYS_SECRET` 调用：

```sh
curl -X POST "$SERVICE_URL/api/internal/logs/purge" \
  -H "Authorization: Bearer $SYS_SECRET"
```

手动 endpoint 每 24 小时最多实际清理一次；Cloudflare 的 scheduled cleanup 不经过该节流 endpoint。
