<div align="center">

# NoneBotMaker

面向 QQ 官方机器人的 Serverless 管理与 AI 聊天服务

[在线文档站](https://cfnbot.opkg.cn/) · [English](README.en.md) · [AGPL-3.0](LICENSE)

</div>

## 项目简介

NoneBotMaker 使用 TypeScript、Hono 和 React，提供 QQ 机器人账号、群聊/私聊策略和 AI 对话管理。支持 Cloudflare Workers、EdgeOne 和阿里云 ESA；Cloudflare 还可使用 Durable Objects WebSocket Gateway。

### 兼容性边界

本项目是在 Serverless 环境中实现的 TypeScript 服务，不是 Python NoneBot 运行时。它不能直接加载任意 Python 插件、driver/adapter 或本地 shell、文件系统工具。真实 QQ、AI、Brave、TTS 和媒体能力需要使用真实账号与服务联调。

## 快速部署

选择平台开始部署：

<div align="center">

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https%3A%2F%2Fgithub.com%2FPIKACHUIM%2FNoneBotMaker)
[![Deploy with EdgeOne](https://cdnstatic.tencentcs.com/edgeone/pages/deploy.svg)](https://edgeone.ai/pages/new?repository-url=https%3A%2F%2Fgithub.com%2FPIKACHUIM%2FNoneBotMaker&repository-name=NoneBotMaker&project-name=NoneBotMaker&install-command=npm%20install&build-command=npm%20run%20build%3Aedgeone&output-directory=dist)

</div>

- **Cloudflare / EdgeOne**：按钮会带你进入对应平台的仓库导入或部署流程。部署前按平台要求配置自己的资源和变量。
- **阿里云 ESA**：[打开 ESA 控制台](https://esa.console.aliyun.com/)后导入 GitHub 仓库；ESA 当前没有本项目可用的一键部署按钮。
- 一键部署不会代替 QQ 开放平台配置。上线前仍需配置存储、`SYS_PASSWD`、`SYS_SECRET`，初始化数据库，并设置 QQ 回调地址 `https://<你的域名>/webhook/qq`。
- Cloudflare 首次部署请检查 `wrangler.jsonc` 中的资源 ID 和域名，替换为自己的配置；不要直接使用其他账户的资源。

详细步骤见[快速部署指南](docs/guide/quick-start.md)。

## 功能介绍

- **管理台**：管理插件、QQ 账号、会话策略、AI 供应商、模型价格、MCP、Skills/Rules 和记忆。
- **AI 对话**：支持兼容 OpenAI 的 API、多轮工具调用、流式响应、会话上下文与角色卡。
- **工具与审批**：提供联网搜索、消息和媒体工具；MCP 工具受 allowlist 与 owner 审批控制。
- **运行管理**：支持会话模式、白名单、预算、上下文、日志、计划唤醒和素材管理。
- **多平台存储**：适配 Cloudflare D1/KV/DO、EdgeOne Blob/KV 与 ESA KV。

## 工作原理

平台入口将请求交给共享 Hono 应用。QQ Webhook 经签名验证后解析账号和会话策略；聊天运行时读取权限、上下文与模型配置，调用 AI API 并执行获准的工具，最后通过 QQ API 回复。持久化由各平台的存储适配器负责；缺少必要 binding 时会报错，不以进程内状态替代。

## 开发部署

需要 Node.js `>=20`。本地启动和检查：

```sh
npm ci
npm run dev
npm run typecheck
npm test
npm run build
```

平台构建：

```sh
npm run build:worker
npm run build:edgeone
npm run build:esa
```

`build:worker` 只运行 dry-run。EdgeOne 与 ESA 使用 Webhook，不支持 WebSocket Gateway。本地 Node 入口不会自动创建 D1/KV；持久化功能需在配置了存储 binding 的环境验证。

本地预览文档站：`npm run docs:dev`；构建：`npm run docs:build`。源文件位于 `docs/`，推送到 `main` 后由 GitHub Actions 自动发布到[在线文档站](https://cfnbot.opkg.cn/)。

## 参考项目

- [NoneBot2](https://github.com/nonebot/nonebot2)：事件、matcher 和 session 概念的参考；本项目不运行其 Python 插件。
- [VitePress](https://vitepress.dev/)：项目文档站生成器。
- [Cloudflare Workers](https://developers.cloudflare.com/workers/)、[EdgeOne](https://edgeone.ai/document)、[阿里云 ESA](https://help.aliyun.com/product/58613.html)：平台运行与存储文档。

## 开源许可

本项目采用 [GNU Affero General Public License v3.0](LICENSE)（AGPL-3.0）。
