# 快速部署

本指南以 Cloudflare Workers 为例，适合首次部署。EdgeOne 与阿里云 ESA 的构建和运行差异见[多平台部署](/development/deployment)。生产配置会创建和修改云资源；请先在自己的 Cloudflare 账户准备 D1 数据库、KV namespace 和 Worker 域名。

## 1. 获取代码并安装依赖

```sh
git clone https://github.com/PIKACHUIM/NoneBotMaker.git
cd NoneBotMaker
npm ci
```

要求 Node.js 20 或更高版本；本文档站的构建建议使用 Node.js 22 或更高版本。

## 2. 配置 Worker 与存储

使用 `wrangler.example.jsonc` 作为模板，检查 Worker 名称、D1 数据库名和 ID、KV namespace ID 与资源绑定。不要将个人账号、域名或真实凭据复制到公开提交中。Cloudflare 的 Gateway 模式还需要 Durable Object binding 和对应 migration；Webhook 是默认接入方式。

在 Cloudflare 创建 D1 和 KV，并把命令返回的资源 ID 写入你自己的 Worker 配置。随后设置管理员登录密码与独立系统密钥：

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
npx wrangler secret put SYS_PASSWD
npx wrangler secret put SYS_SECRET
```

`SYS_SECRET` 用于 session 签名、敏感凭据加密和受保护的维护接口；请使用独立的高熵值，并安全保存。不要把 Secret 写入 `vars`、源码、命令历史或公开日志。

## 3. 构建并部署

```sh
npm run build
npx wrangler deploy --config wrangler.jsonc
```

部署后检查 `https://<worker-domain>/api/health`。首次部署或升级 schema 时，二选一执行：

- 打开 `https://<worker-domain>/setup`，输入 `SYS_SECRET` 并初始化；或
- 使用 CLI 应用远程迁移：

```sh
npx wrangler d1 migrations apply <database-name> --remote --config wrangler.jsonc
```

迁移脚本会维护 schema 版本；不要在生产环境直接手工删除或重建数据表。

## 4. 配置 QQ 回调

在 QQ 开放平台配置机器人回调地址：

```text
https://<worker-domain>/webhook/qq
```

在管理台创建群聊助手插件、QQ 账号和会话策略。QQ 账号凭据应填写在管理台受保护的账号配置中；会话策略填写群聊/私聊 OpenID 并选择供应商和模型。回调需要保留 QQ 签名请求头与原始请求体。

## 5. 验证

```sh
curl -fsS https://<worker-domain>/api/health
curl -fsS https://<worker-domain>/api/setup/status
```

登录管理台，确认账号和会话策略保存成功，再用已授权测试群/测试账号完成真实 QQ 联调。不要把本地 mock 测试当作 QQ 平台权限、媒体能力或供应商服务的端到端验证。

## Cloudflare 部署注意事项

- `npm run build:worker` 是基于模板的 dry-run，不会替你创建云资源或写入 Secret。
- Cloudflare Gateway 使用 Durable Object 管理 WebSocket 会话，会持续消耗资源；不需要 Gateway 时保持 `API_METHOD=webhook`。
- 管理员密码通过 `SYS_PASSWD` 设置；机器人 AppID/AppSecret 属于账号凭据，不是管理员密码。
- 上线前核对 Cloudflare 计费、资源配额、数据库备份及日志保留策略。
