---
layout: home
hero:
  name: NoneBotMaker
  text: Serverless QQ Bot Service
  tagline: Manage QQ bot accounts, conversation policies, and AI chat capabilities on Cloudflare Workers, EdgeOne, or Alibaba Cloud ESA.
  actions:
    - theme: brand
      text: Quick Deployment
      link: /en/guide/quick-start
    - theme: alt
      text: System Design
      link: /en/design/architecture
    - theme: alt
      text: GitHub
      link: https://github.com/PIKACHUIM/NoneBotMaker
features:
  - title: Accounts and Conversation Policies
    details: Manage plugins, QQ bot accounts, and group/private conversation policies as separate scopes.
  - title: AI Tool Execution
    details: Supports OpenAI-compatible APIs, multi-round tool calls, MCP, web search, Skills/Rules, and conversation memory.
  - title: Serverless Storage
    details: Adapts Cloudflare D1/KV, EdgeOne Blob/KV, and Alibaba Cloud ESA KV; missing persistence is reported explicitly.
  - title: Admin Console and Security
    details: Bilingual admin console, admin authentication, QQ callback signature validation, tool approvals, and conversation-scoped access.
  - title: Multiple Runtimes
    details: Shares Hono application logic across Cloudflare Workers, EdgeOne, ESA, and a local Node entry point.
  - title: TypeScript Behavior Port
    details: Includes an event-dispatch implementation for Workers; it does not load arbitrary Python NoneBot plugins or drivers unchanged.
---

## Interface Preview

![NoneBotMaker admin console overview](../index.png)

## Documentation

- [Quick deployment](/en/guide/quick-start): storage, secrets, migrations, and QQ Webhook setup.
- [Admin console guide](/en/guide/user-guide): configure AI providers, accounts, policies, tools, and memory.
- [Project requirements](/en/design/requirements): implemented capabilities and explicit boundaries.
- [System architecture](/en/design/architecture): module boundaries, message flow, persistence, and trust boundaries.
- [Local development and tests](/en/development/setup) and [platform deployment](/en/development/deployment).

> Requirements and architecture are derived from the current code, configuration, and tests; they are not a separately approved product specification. End-to-end validation with real QQ, AI, Brave, and TTS services still requires real accounts and credentials.
