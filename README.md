<div align="center">

# NoneBotMaker

**面向 QQ 官方机器人的 Serverless 管理与 AI 聊天服务**
**A serverless management and AI chat service for official QQ bots**

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https%3A%2F%2Fgithub.com%2FPIKACHUIM%2FNoneBotMaker)
[![Deploy with EdgeOne](https://cdnstatic.tencentcs.com/edgeone/pages/deploy.svg)](https://edgeone.ai/pages/new?repository-url=https%3A%2F%2Fgithub.com%2FPIKACHUIM%2FNoneBotMaker&repository-name=NoneBotMaker&project-name=NoneBotMaker&install-command=npm%20install&build-command=npm%20run%20build%3Aedgeone&output-directory=dist)
[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](LICENSE)

**简体中文 / English**

</div>

## 项目简介 | Project Overview

NoneBotMaker 使用 TypeScript、Hono 和 React 构建，为 QQ 机器人提供账号/会话策略管理、AI 聊天执行和工具扩展能力。应用逻辑可部署到 Cloudflare Workers、EdgeOne 或阿里云 ESA；Cloudflare 另支持基于 Durable Objects 的 WebSocket Gateway。项目还提供本地 Node 入口用于开发。

NoneBotMaker is built with TypeScript, Hono, and React. It provides QQ bot account and conversation-policy management, AI chat execution, and extensible tools. The shared application can run on Cloudflare Workers, EdgeOne, or Alibaba Cloud ESA. Cloudflare additionally supports a Durable Objects-based WebSocket Gateway. A local Node entry point is available for development.

> **兼容性 / Compatibility:** 本项目是 Worker 中的 TypeScript 行为实现，不是 Python NoneBot 运行时；不能直接加载任意 Python 插件、driver/adapter 或本地 shell/文件系统工具。真实 QQ、AI、Brave、TTS 和平台媒体能力仍需真实账号与服务联调。
> This is a TypeScript behavior implementation for serverless runtimes, not a Python NoneBot runtime. It cannot load arbitrary Python plugins, drivers/adapters, or local shell/filesystem tools. Real QQ, AI, Brave, TTS, and media capabilities require integration testing with real accounts and services.

双语文档源文件位于 [`docs/index.md`](docs/index.md)，包含需求、设计、使用教程、开发和部署。运行 `npm run docs:dev` 预览文档站。

## 快速部署 | Quick Deployment

以下使用 Cloudflare Workers；完整流程见[快速部署指南](docs/guide/quick-start.md)。部署会创建和修改云资源，请先准备自己的 Cloudflare 账户、D1、KV 和 Worker 域名。

The following steps target Cloudflare Workers. See the [full deployment guide](docs/guide/quick-start.md). Deployment creates and changes cloud resources; prepare your own Cloudflare account, D1, KV, and Worker domain first.

### 1. 安装依赖 / Install dependencies

```sh
git clone https://github.com/PIKACHUIM/NoneBotMaker.git
cd NoneBotMaker
npm ci
```

项目需要 Node.js `>=20`。文档站工具链还要求 Node.js `^20.19.0` 或 `>=22.12.0`，建议使用 Node.js 22.12+。
The application requires Node.js `>=20`. The docs toolchain requires Node.js `^20.19.0` or `>=22.12.0`; Node.js 22.12+ is recommended.

### 2. 配置资源与密钥 / Configure resources and secrets

使用 `wrangler.example.jsonc` 作为模板创建自己的 Worker 配置，填写 D1 database 和 KV namespace 的名称及 ID。不要复用其他账户的资源 ID，也不要提交真实密钥。创建资源：

Use `wrangler.example.jsonc` as a template for your Worker configuration and fill in your own D1 and KV resource names and IDs. Do not reuse another account's IDs or commit secrets. Create resources with:

```sh
npx wrangler d1 create nonebot-data
npx wrangler kv namespace create nonebot-kv
```

设置管理台密码和独立的高熵系统密钥。每条 `secret put` 命令会提示输入 Secret：

Set the admin password and a separate high-entropy system secret. Each `secret put` command prompts for the value:

```sh
npx wrangler secret put SYS_PASSWD
npx wrangler secret put SYS_SECRET
```

`SYS_SECRET` 用于 session 签名、账号/provider 敏感凭据加密和受保护的维护接口；不要写入 `vars`、源码、URL 或命令行参数。
`SYS_SECRET` is used for session signing, encryption of sensitive account/provider credentials, and protected maintenance endpoints. Do not put it in `vars`, source code, URLs, or command-line arguments.

### 3. 构建、迁移、部署 / Build, migrate, and deploy

```sh
npm run build
npx wrangler d1 migrations apply <database-name> --remote --config wrangler.jsonc
npx wrangler deploy --config wrangler.jsonc
```

也可先部署，再访问 `https://<worker-domain>/setup` 并用 `SYS_SECRET` 初始化数据库。两种迁移方式二选一；不要手工重复执行 DDL。部署后确认 `/api/health` 正常，并将 QQ 开放平台回调配置为 `https://<worker-domain>/webhook/qq`。
Alternatively, deploy first, then initialize the database at `https://<worker-domain>/setup` with `SYS_SECRET`. Choose one migration path; do not reapply DDL manually. Verify `/api/health` and configure the QQ callback as `https://<worker-domain>/webhook/qq`.

> `npm run build:worker` 只执行 Cloudflare dry-run，不会部署或创建资源。Fork 后请检查仓库内的 `wrangler.jsonc`，确保其中没有他人账户资源配置，再使用自己的资源。
> `npm run build:worker` only performs a Cloudflare dry run; it does not deploy or create resources. After forking, review the repository's `wrangler.jsonc` and replace any account-specific configuration before using your own resources.

## 功能介绍 | Features

- **管理台 / Admin console**：中英文界面，管理插件、QQ 账号、群聊/私聊策略、AI 供应商、模型价格、Skills/Rules、MCP、日志和记忆。 / Bilingual console for plugins, QQ accounts, group/private policies, AI providers, model pricing, Skills/Rules, MCP, logs, and memory.
- **AI 对话 / AI conversations**：OpenAI-compatible API、多轮工具调用、流式响应、会话上下文、角色卡、会话记忆与账号共享项目记忆。 / OpenAI-compatible APIs, multi-round tool calls, streaming, conversation context, role cards, conversation memory, and account-shared project memory.
- **工具与审批 / Tools and approvals**：内置时间、联网搜索、消息/媒体发送等工具；MCP 工具受 allowlist 与 owner 审批约束。 / Built-in time, web search, and message/media tools; MCP tools are controlled by allowlists and owner approval.
- **QQ 功能 / QQ capabilities**：Webhook 消息、受平台许可的回复/媒体、命令、语音素材、计划唤醒与会话控制。具体能力取决于平台权限、策略与部署平台。 / Webhook messages, permitted replies/media, commands, voice assets, scheduled wakeups, and conversation controls. Availability depends on platform permissions, policies, and runtime.
- **成本与日志 / Cost and logs**：模型单价、会话预算、用量与最多 30 天对话日志保留；日志默认关闭。KV/Blob 的一致性及并发预算限制以平台语义为准。 / Model pricing, conversation budgets, usage tracking, and up to 30-day conversation-log retention; logging is disabled by default. KV/Blob consistency and concurrent budget limits follow platform semantics.
- **事件调度移植 / Event-dispatch port**：提供 TypeScript matcher 生命周期、传播控制和交互 session 行为，不代表与 Python NoneBot 生态完全兼容。 / Provides TypeScript matcher lifecycle, propagation control, and interactive session behavior; this is not full compatibility with the Python NoneBot ecosystem.

## 工作原理 | How It Works

1. **平台入口 / Runtime entry:** Cloudflare Worker、EdgeOne、ESA 或本地 Node 将平台 binding 传给共享 Hono 应用。 / Each runtime passes its bindings to the shared Hono application.
2. **管理 API / Management API:** 管理路由验证管理员 session 与数据作用域，再读写插件、账号和会话策略。 / Management routes validate admin sessions and data scope before accessing plugin, account, and policy records.
3. **QQ 接入 / QQ integration:** `/webhook/qq` 校验签名、按 AppID 找到账号并归一化事件。 / `/webhook/qq` validates signatures, resolves the account by AppID, and normalizes events.
4. **聊天执行 / Chat execution:** 运行时读取策略、权限、上下文与价格，调用 AI API，并执行获准的工具，再按 QQ 能力发送回复。 / The runtime loads policy, permissions, context, and pricing; calls the AI API; executes permitted tools; and sends replies within QQ capabilities.
5. **持久化 / Persistence:** D1/KV/Blob/DO adapter 隔离平台存储。缺少 binding 时不会用进程内状态假装持久化。 / D1/KV/Blob/DO adapters isolate platform storage. Missing bindings are reported rather than silently replaced with process-local state.

| 运行平台 / Runtime | 接入方式 / Integration | 存储 / Storage |
| --- | --- | --- |
| Cloudflare Workers | Webhook；可选 Durable Objects WebSocket Gateway | D1、KV、Durable Objects |
| EdgeOne | Webhook | EdgeOne Blob 或 KV |
| 阿里云 ESA / Alibaba Cloud ESA | Webhook | ESA KV 或 KV |
| 本地 Node / Local Node | 共享 Hono API | 需自行提供持久化 binding；本地入口不自动创建数据库 |

## 开发部署 | Development & Deployment

### 开发与测试 / Development and tests

```sh
npm ci
npm run dev
npm run typecheck
npm test
npm run build
```

`npm run dev` 启动本地 API 与 Vite 管理台，但本地 Node 入口不自动提供 D1/KV；需要持久化的管理和聊天行为应在配置了隔离存储的 Worker 环境验证。
`npm run dev` starts the local API and Vite console, but the local Node entry does not create D1/KV bindings. Validate persistence-dependent management and chat behavior in a Worker environment with isolated storage.

### 平台构建 / Platform builds

```sh
npm run build:worker
npm run build:edgeone
npm run build:esa
```

Cloudflare 使用 `wrangler.example.jsonc` dry-run；EdgeOne 输出到 `dist/edge-functions/`；ESA 输出到 `dist/edge-routine/`。EdgeOne 和 ESA 当前不支持 WebSocket Gateway。
Cloudflare uses `wrangler.example.jsonc` for its dry run; EdgeOne outputs to `dist/edge-functions/`; ESA outputs to `dist/edge-routine/`. EdgeOne and ESA do not currently support the WebSocket Gateway.

### 文档站 / Documentation site

```sh
npm run docs:dev
npm run docs:build
npm run docs:preview
```

VitePress 双语静态站源文件位于 `docs/`，静态产物位于 `docs/.vitepress/dist/`。当前 VitePress 固定为 `2.0.0-alpha.21`，是为避开 VitePress 1.x 已知开发工具链漏洞而选用的 alpha 版本；升级时应重新审计依赖并验证构建。
The bilingual VitePress site lives in `docs/` and builds to `docs/.vitepress/dist/`. VitePress is pinned to `2.0.0-alpha.21` to avoid known development-toolchain advisories in VitePress 1.x. Re-audit dependencies and verify the build when upgrading.

更完整的[本地开发与测试](docs/development/setup.md)和[多平台部署](docs/development/deployment.md)指南包含本地入口限制、平台 bindings、迁移与安全检查。
The [local development and test](docs/development/setup.md) and [platform deployment](docs/development/deployment.md) guides cover local-entry limitations, platform bindings, migrations, and security checks.

## 参考项目 | References

- [NoneBot2](https://github.com/nonebot/nonebot2)：参考事件、matcher 和 session 等概念；本项目用 TypeScript 实现可移植行为，不加载上游 Python 插件。 / Reference for event, matcher, and session concepts; this project ports selected behavior to TypeScript and does not load upstream Python plugins.
- [VitePress](https://vitepress.dev/)：本项目双语技术文档站的静态站点生成器。 / Static site generator for this bilingual documentation site.
- 平台 SDK/API 与存储行为以 [Cloudflare Workers](https://developers.cloudflare.com/workers/)、[EdgeOne](https://edgeone.ai/document) 和 [阿里云 ESA](https://help.aliyun.com/product/58613.html) 官方文档为准。 / Refer to the official Cloudflare Workers, EdgeOne, and Alibaba Cloud ESA documentation for platform APIs and storage behavior.

## 开源许可 | Open Source License

本项目采用 **GNU Affero General Public License v3.0（AGPL-3.0）**，详见 [`LICENSE`](LICENSE)。分发或通过网络提供修改版本时，请遵循许可证要求。
This project is licensed under the **GNU Affero General Public License v3.0 (AGPL-3.0)**. See [`LICENSE`](LICENSE). Follow the license requirements when distributing modified versions or making them available over a network.
