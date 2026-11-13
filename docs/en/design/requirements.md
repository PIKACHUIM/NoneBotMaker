# Project Requirements

> **Specification status: inferred from implementation; not separately approved by product owners.** The repository has no maintained, standalone product specification. The following scope is derived from current code, configuration, tests, and README. It describes the current implementation, not a roadmap promise. Define scenarios and acceptance criteria before changing product behavior.

## Goal and users

NoneBotMaker provides a serverless management and chat service for official QQ bots. Administrators use a web console to configure plugins, AI providers, bot accounts, and group/private conversation policies. QQ users interact with the bot in platform-authorized conversations. The implementation is in TypeScript and shares Hono application logic across runtimes.

## Functional requirements and status

| ID | Requirement | Implementation and evidence pointers |
| --- | --- | --- |
| FR-01 | Let administrators manage application configuration after sign-in | Password verification and signed sessions; management APIs require a valid session. `src/server/routes/index.ts`, `src/server/auth.ts`, and their tests. |
| FR-02 | Give each configuration field one owner and reuse policies | Plugins declare technical defaults, accounts hold QQ credentials, and Group Management binds OpenIDs to **required visible Identity and Dialogue** policies plus optional Voice/Budget/Memory. Groups cannot grant tools outside Identity; inherited values are read-only, not written back to the group record. `src/shared/plugin-catalog.ts`, `src/server/routes/management.ts`. |
| FR-03 | Receive and validate QQ Webhook events | `/webhook/qq` resolves an account by AppID and verifies the signature before normalizing and dispatching a message. `src/server/protocols/qq/webhook.ts`, `signature.ts`. |
| FR-04 | Generate replies through compatible AI APIs and support tool calls | Chat runtime supports multi-round tool loops, streaming/non-streaming responses, cost accounting, and outbound messages. `src/server/plugins/chatbot/handler.ts`, `provider.ts`. |
| FR-05 | Control tools, MCP, Skills/Rules, and memory | Built-in/custom HTTPS tools are configured centrally and granted by Identity; groups may only disable or adjust approval. MCP keeps the admin allowlist and side-effect approval by default. Conversation memory is stored separately by account, conversation type and actual OpenID; only confirmed entries enter context. `src/server/plugins/chatbot/`, `src/server/storage/conversation-memory-repository.ts`. |
| FR-06 | Support media, voice, wakeups, and conversation commands | Individual capabilities depend on QQ permissions, plugin settings, provider/model capabilities, and platform storage. `handler.ts`, `media.ts`, `src/platform/cloudflare/qq-do.ts`. |
| FR-07 | Persist settings, context, logs, and scheduled data | Cloudflare D1/KV/DO, EdgeOne Blob/KV, and ESA KV adapters; cross-request persistence is not promised without a storage binding. `src/server/storage/`. |
| FR-08 | Reuse application logic across serverless platforms | Cloudflare Worker, EdgeOne, ESA, and local Node entry points call shared `src/server/app.ts`; platform capabilities differ. |
| FR-09 | Enforce authentication and trust boundaries for sensitive management actions | Session/same-origin checks, encrypted credentials, QQ signature validation, tool permissions and approval; logs are disabled by default. |
| FR-10 | Provide a bilingual admin console and project documentation | The console uses i18n; the VitePress site provides Simplified Chinese and English. |
| FR-11 | Initialize reusable defaults without replacing user changes | Identity/Dialogue, disabled-TTS Voice, Memory and Budget policies, built-in tools, existing text/TTS price snapshots and new image rates are seeded idempotently; deployed instances use an explicit protected fill-missing action. `src/server/storage/d1-setup.ts`, `src/server/routes/setup.ts`. |
| FR-12 | Include image generation and chat charges in one conversation budget | Image generation is disabled by default and requires a provider, model, positive per-image fallback and identity authorization. Itemized usage uses modality rates; total-only tokens use an explicitly labeled average estimate; no usage uses the fallback. Each logged turn accumulates its model/image/voice charges. `src/server/plugins/chatbot/image-generation.ts`, `src/server/routes/logs.ts`. |

## Acceptance scenarios

1. Unauthenticated requests to management APIs are rejected. Authenticated administrators can perform only server-validated management operations.
2. A QQ Webhook enters the chat handler only after signature validation, account resolution by AppID, and applicable account/policy checks.
3. After an administrator saves an account and a valid conversation policy, the policy appears in Conversation Management. Historical QQ chats are not discovered automatically.
4. Text chat without a registered rate uses the default price. Images use modality-specific usage where available, average-rate estimates for total-only tokens, or the required configured per-image fallback when no usage is returned. Charges count toward the selected Budget policy and estimates are explicitly labeled.
5. Side-effecting MCP calls require owner approval by default. A group administrator can choose per-tool, approve-all or allow-all *within* Identity authorization; allow-all carries external side-effect risk and must be audited. Execution is unavailable where safe atomic claiming cannot be guaranteed.
6. Conversation memory requires its separate D1 table. A missing persistent database produces an explicit unsupported error, never a process-local or opaque DO/KV substitute for manageable records.
7. `LOG_RECORD` defaults to off. When enabled, logs follow the retention period and are cleaned by a platform schedule or protected endpoint.
8. EdgeOne and ESA reject WebSocket Gateway mode explicitly.

## Non-functional requirements

- **Security:** Secrets must not enter ordinary frontend fields, public repositories, or logs. Management APIs require authentication. Model, search, and MCP content is untrusted input.
- **Isolation:** Accounts, conversations, conversation memory, and account-shared memory retain separate scopes; the server validates cross-scope operations.
- **Portability:** Shared business logic must not assume identical database transactions, KV consistency, or Durable Object capabilities across edge platforms.
- **Verifiability:** Core behavior is covered by Vitest unit/route/platform tests and TypeScript checking. Real external platform testing is a separate activity.
- **Cost transparency:** Use registered rates and measured usage when present. Total-only image usage is an average-rate estimate that can understate actual billing. Document KV/Blob conditional-write limits and non-atomic budget check/charge overshoot.

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
