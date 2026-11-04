# Project Requirements

> **Specification status: inferred from implementation; not separately approved by product owners.** The repository has no maintained, standalone product specification. The following scope is derived from current code, configuration, tests, and README. It describes the current implementation, not a roadmap promise. Define scenarios and acceptance criteria before changing product behavior.

## Goal and users

NoneBotMaker provides a serverless management and chat service for official QQ bots. Administrators use a web console to configure plugins, AI providers, bot accounts, and group/private conversation policies. QQ users interact with the bot in platform-authorized conversations. The implementation is in TypeScript and shares Hono application logic across runtimes.

## Functional requirements and status

| ID | Requirement | Implementation and evidence pointers |
| --- | --- | --- |
| FR-01 | Let administrators manage application configuration after sign-in | Password verification and signed sessions; management APIs require a valid session. `src/server/routes/index.ts`, `src/server/auth.ts`, and their tests. |
| FR-02 | Scope configuration by plugin, platform account, and group/private policy | Declared plugin fields drive forms; accounts hold platform credentials; policies define external OpenIDs, AI, and permissions. `src/shared/plugin-catalog.ts`, `src/server/routes/management.ts`. |
| FR-03 | Receive and validate QQ Webhook events | `/webhook/qq` resolves an account by AppID and verifies the signature before normalizing and dispatching a message. `src/server/protocols/qq/webhook.ts`, `signature.ts`. |
| FR-04 | Generate replies through compatible AI APIs and support tool calls | Chat runtime supports multi-round tool loops, streaming/non-streaming responses, cost accounting, and outbound messages. `src/server/plugins/chatbot/handler.ts`, `provider.ts`. |
| FR-05 | Control tools, MCP, search, Skills/Rules, and memory | Tools are scoped by conversation permissions; MCP uses allowlists and owner approval; conversation and account-shared memory have separate scopes. `tools.ts`, `knowledge.ts`, `approval.ts`. |
| FR-06 | Support media, voice, wakeups, and conversation commands | Individual capabilities depend on QQ permissions, plugin settings, provider/model capabilities, and platform storage. `handler.ts`, `media.ts`, `src/platform/cloudflare/qq-do.ts`. |
| FR-07 | Persist settings, context, logs, and scheduled data | Cloudflare D1/KV/DO, EdgeOne Blob/KV, and ESA KV adapters; cross-request persistence is not promised without a storage binding. `src/server/storage/`. |
| FR-08 | Reuse application logic across serverless platforms | Cloudflare Worker, EdgeOne, ESA, and local Node entry points call shared `src/server/app.ts`; platform capabilities differ. |
| FR-09 | Enforce authentication and trust boundaries for sensitive management actions | Session/same-origin checks, encrypted credentials, QQ signature validation, tool permissions and approval; logs are disabled by default. |
| FR-10 | Provide a bilingual admin console and project documentation | The console uses i18n; the VitePress site provides Simplified Chinese and English. |

## Acceptance scenarios

1. Unauthenticated requests to management APIs are rejected. Authenticated administrators can perform only server-validated management operations.
2. A QQ Webhook enters the chat handler only after signature validation, account resolution by AppID, and applicable account/policy checks.
3. After an administrator saves an account and a valid conversation policy, the policy appears in Conversation Management. Historical QQ chats are not discovered automatically.
4. AI requests honor the selected model, media capabilities, registered prices, budget, and conversation tool permissions. Requests without pricing evidence are not treated as free.
5. Untrusted MCP tools require approval; approval is persisted before execution continues. Pending execution is unavailable where safe atomic claiming cannot be guaranteed.
6. Missing persistence bindings produce an explicit configuration error rather than pretending process-local state is durable.
7. `LOG_RECORD` defaults to off. When enabled, logs follow the retention period and are cleaned by a platform schedule or protected endpoint.
8. EdgeOne and ESA reject WebSocket Gateway mode explicitly.

## Non-functional requirements

- **Security:** Secrets must not enter ordinary frontend fields, public repositories, or logs. Management APIs require authentication. Model, search, and MCP content is untrusted input.
- **Isolation:** Accounts, conversations, conversation memory, and account-shared memory retain separate scopes; the server validates cross-scope operations.
- **Portability:** Shared business logic must not assume identical database transactions, KV consistency, or Durable Object capabilities across edge platforms.
- **Verifiability:** Core behavior is covered by Vitest unit/route/platform tests and TypeScript checking. Real external platform testing is a separate activity.
- **Cost transparency:** Usage is priced using registered model prices and actual usage. KV/Blob consistency and concurrent budget overshoot must be communicated.

## Explicit compatibility limits

- Arbitrary Python NoneBot plugins, Python drivers/adapters, and Python-runtime ecosystems are not loaded directly.
- The Worker does not provide arbitrary local shell access, a general local filesystem, or `pyttsx3` execution.
- The TypeScript dispatcher is a behavior port, not a guarantee of complete upstream Python NoneBot equivalence.
- Real QQ delivery, proactive messaging/media permissions, and specific AI/Brave/TTS provider behavior require real accounts and services; mocks do not replace integration testing.

## Primary sources

- Application and routes: `src/server/app.ts`, `src/server/routes/index.ts`
- QQ protocol: `src/server/protocols/qq/`
- Chat pipeline: `src/server/plugins/chatbot/`
- Persistence: `src/server/storage/`, `src/platform/cloudflare/qq-do.ts`, `migrations/`
- Runtime entry points: `src/platform/cloudflare/worker.ts`, `src/platform/edgeone/entry.ts`, `src/platform/esa/entry.ts`, `src/server/local.ts`
- Shared configuration/types: `src/shared/`
