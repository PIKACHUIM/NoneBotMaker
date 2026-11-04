# System Architecture

## Overview

```text
Admin browser ──static assets──> Platform entry / ASSETS
      │                              │
      └──management API + session──> Hono API Router
                                     ├──plugin/account/policy management
QQ Open Platform ──Webhook────────> ├──auth/setup/log/conversation routes
                                     └──QQ signature checks and normalization
                                                   │
                                            Chatbot Runtime
                                     ├──policy and permission resolution
                                     ├──AI provider / multi-round tool loop
                                     ├──MCP / search / Skills / Memory
                                     └──QQ replies and media delivery
                                                   │
                 ┌─────────────────────────────────┴────────────────────┐
                 │ persistence adapters                                │ external services
                 │ D1 / KV / Blob / Durable Object                     │ QQ / AI / MCP
                 └────────────────────────────────────────────────────┘
```

This diagram shows the main path, not feature parity across platforms. `src/server/app.ts` is the shared application entry. Platform entry points map runtime bindings to `RuntimeBindings` and pass requests to the shared app.

## Request and module boundaries

1. **Platform entry points:** `src/platform/cloudflare/worker.ts`, `src/platform/edgeone/entry.ts`, `src/platform/esa/entry.ts`, and `src/server/local.ts` establish platform context. The Cloudflare Worker also handles static assets, Gateway Durable Object maintenance, and scheduled log cleanup.
2. **Shared application:** `src/server/app.ts` mounts management routes under `/api` and the `/webhook/qq` callback. Middleware validates `API_METHOD`; non-Cloudflare platforms reject WebSocket mode.
3. **Management API:** `src/server/routes/index.ts` centralizes authentication and route registration. Separate routes manage plugins, accounts, conversation policies, providers, prices, logs, and runtime state. Session, same-origin, and scope checks run on the server.
4. **QQ integration:** `src/server/protocols/qq/` validates signatures, resolves accounts by AppID, normalizes platform events, and calls QQ APIs for replies or media.
5. **Chat pipeline:** `src/server/plugins/chatbot/runtime.ts` composes stores and handlers. `handler.ts` resolves conversation policies and permissions, calls providers, executes permitted tools, and sends replies within QQ constraints.
6. **Data access:** Repository/store interfaces isolate configuration, context, cost, logs, and media assets from platform storage APIs.

## Configuration and data scopes

```text
Plugin configuration
  └── platform account (QQ AppID/AppSecret, linked plugin)
       └── group/private policy (external OpenID, model, permissions, prompt, budget)
            └── conversation runtime state / context / memory
```

Account-shared role cards/project memory are separate from conversation memory. The server validates account ID, policy ID, external conversation ID, conversation type, and user identity. A value selected in the browser is not itself authorization.

## Persistence strategy

`src/server/storage/repository.ts` chooses a record repository based on available bindings: D1 first; EdgeOne Blob or KV; ESA `ESA_KV` or `KV`; then generic KV. If no persistence binding is available, it throws `StorageUnavailableError`.

| Platform | Record repository | Important differences |
| --- | --- | --- |
| Cloudflare Workers | D1 or a provided KV binding | D1 provides relational records and migrations. `QQ_GATEWAY_SESSIONS` Durable Object manages Gateway sessions and queues. |
| EdgeOne | EDGEONE_BLOB first, then EDGEONE_KV | Consistency is provider-defined; configure bindings required by context and cost adapters. |
| Alibaba Cloud ESA | ESA_KV or KV | Webhook only; no Cloudflare Durable Object Gateway. |
| Local Node | The current entry supplies environment variables, not an automatic database binding | Starting the local API does not imply that management/runtime features requiring persistent bindings are fully operational. |

Cost checks and usage accumulation are not one cross-platform transaction. D1 supports atomic accumulation; KV/Blob consistency follows platform semantics, and concurrent requests may exceed a budget.

## Chat processing flow

1. Receive a QQ Webhook, validate its signature, and resolve the account and event.
2. Find the saved policy by platform account and group/private OpenID; check enabled state, allowlists, and rate limits.
3. Load context, prompts, Skills/Rules, role cards, memory, and model prices to build a provider request.
4. Convert messages according to the selected API/model media capabilities. Unsupported attachments are not reported as read.
5. Process AI text or tool calls. Built-in tools are scoped by policy and identity; external MCP calls follow admin allowlist and owner-approval rules.
6. Record model usage and costs, save context, and write logs only when logging is enabled.
7. Send text/media replies subject to runtime mode, QQ platform limits, and message chunking.

Cloudflare WebSocket Gateway connections are maintained by a Durable Object. Cloudflare Webhook mode also uses the configured object for durable queueing, deduplication, and outbound rate limiting. EdgeOne and ESA currently support Webhook only.

## Security boundaries

- **Trusted configuration:** Only data authenticated with an admin session and validated by the server forms an authorization policy.
- **Platform input:** QQ callbacks must pass signature validation; OpenIDs and message contents are external input.
- **AI and external tools:** Model output, search results, MCP arguments, and tool results are untrusted. A remote `readOnlyHint` alone does not establish safety.
- **Credentials:** Never commit `SYS_PASSWD`, `SYS_SECRET`, or provider/platform credentials. Sensitive account/provider credentials are encrypted with `SYS_SECRET`.
- **Side effects:** Approval calls require authorization and persistent claiming. Outbound messages, media, and scheduled wakeups are limited by policy and platform permissions.

## Design boundaries

The project ports NoneBot-style event-dispatch behavior into TypeScript Worker logic. It is not a Python runtime and does not load arbitrary Python plugins, drivers/adapters, local shell tools, or speech engines. Storage consistency, media APIs, network egress, and billing differ by platform; consult the deployment guide for the target runtime.
