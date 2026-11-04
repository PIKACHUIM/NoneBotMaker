<div align="center">

# NoneBotMaker

A serverless management and AI chat service for official QQ bots

[Online docs](https://pikachuim.github.io/NoneBotMaker/en/) · [简体中文](README.md) · [AGPL-3.0](LICENSE)

</div>

## Overview

Built with TypeScript, Hono, and React, NoneBotMaker manages QQ bot accounts, group/private conversation policies, and AI chat. It supports Cloudflare Workers, EdgeOne, and Alibaba Cloud ESA. Cloudflare can also use a Durable Objects WebSocket Gateway.

### Compatibility

This is a TypeScript service for serverless runtimes, not a Python NoneBot runtime. It cannot load arbitrary Python plugins, drivers/adapters, or local shell/filesystem tools. Real QQ, AI, Brave, TTS, and media capabilities require integration tests with real accounts and services.

## Quick Deployment

Choose a platform to start:

<div align="center">

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https%3A%2F%2Fgithub.com%2FPIKACHUIM%2FNoneBotMaker)
[![Deploy with EdgeOne](https://cdnstatic.tencentcs.com/edgeone/pages/deploy.svg)](https://edgeone.ai/pages/new?repository-url=https%3A%2F%2Fgithub.com%2FPIKACHUIM%2FNoneBotMaker&repository-name=NoneBotMaker&project-name=NoneBotMaker&install-command=npm%20install&build-command=npm%20run%20build%3Aedgeone&output-directory=dist)

</div>

- **Cloudflare / EdgeOne:** The buttons open the platform's repository import or deployment flow. Configure your own resources and variables as required.
- **Alibaba Cloud ESA:** [Open the ESA console](https://esa.console.aliyun.com/) and import the GitHub repository. There is no one-click deployment button for this project on ESA.
- One-click deployment does not configure the QQ Open Platform. Before going live, configure storage, `SYS_PASSWD`, and `SYS_SECRET`; initialize the database; and set the QQ callback to `https://<your-domain>/webhook/qq`.
- For Cloudflare, review the resource IDs and domains in `wrangler.jsonc` and replace them with your own. Do not use another account's resources.

See the [quick deployment guide](docs/en/guide/quick-start.md) for details.

## Features

- **Admin console:** Manage plugins, QQ accounts, conversation policies, AI providers, model pricing, MCP, Skills/Rules, and memory.
- **AI chat:** OpenAI-compatible APIs, multi-round tool calls, streaming, conversation context, and role cards.
- **Tools and approvals:** Web search, messaging, and media tools; MCP tools are controlled by allowlists and owner approval.
- **Runtime management:** Conversation modes, allowlists, budgets, context, logs, scheduled wakeups, and media assets.
- **Multi-platform storage:** Cloudflare D1/KV/DO, EdgeOne Blob/KV, and ESA KV adapters.

## How It Works

Platform entry points pass requests to the shared Hono application. The QQ Webhook validates signatures and resolves the account and conversation policy. The chat runtime loads permissions, context, and model settings, calls the AI API, executes permitted tools, and replies through the QQ API. Platform-specific storage adapters provide persistence; missing bindings are reported instead of silently replaced with process-local state.

## Development and Deployment

Node.js `>=20` is required. Start the local environment and run checks:

```sh
npm ci
npm run dev
npm run typecheck
npm test
npm run build
```

Build for each platform:

```sh
npm run build:worker
npm run build:edgeone
npm run build:esa
```

`build:worker` runs a dry run only. EdgeOne and ESA use Webhook and do not support the WebSocket Gateway. The local Node entry does not create D1/KV; validate persistence-dependent features in an environment with storage bindings.

Preview locally with `npm run docs:dev`; build with `npm run docs:build`. Source files live in `docs/`; pushes to `main` trigger GitHub Actions to publish the [online documentation site](https://pikachuim.github.io/NoneBotMaker/en/). For the first deployment, set the repository's Pages source to **GitHub Actions** under Settings → Pages.

## References

- [NoneBot2](https://github.com/nonebot/nonebot2): Reference for event, matcher, and session concepts; this project does not run its Python plugins.
- [VitePress](https://vitepress.dev/): Documentation site generator.
- [Cloudflare Workers](https://developers.cloudflare.com/workers/), [EdgeOne](https://edgeone.ai/document), and [Alibaba Cloud ESA](https://help.aliyun.com/product/58613.html): Platform runtime and storage documentation.

## License

This project is licensed under the [GNU Affero General Public License v3.0](LICENSE) (AGPL-3.0).
