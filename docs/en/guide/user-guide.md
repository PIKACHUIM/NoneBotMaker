# Admin Console Guide

This guide takes a new installation through its first test message. “Conversation Management” and “Conversation Policies” serve different purposes: the former operates on runtime state for saved policies; the latter defines the provider, model, prompt, allowlist, and budget for a conversation.

## Before you start

1. Deploy and initialize persistent storage; set `SYS_PASSWD` and `SYS_SECRET`.
2. Prepare the QQ bot AppID/AppSecret and callback configuration in the QQ Open Platform.
3. Prepare an AI API endpoint and key compatible with the request format used by the project. For MCP, also prepare its endpoint, authentication, and an admin-reviewed tool allowlist.
4. Identify the group/private OpenID to test. Conversation Management lists saved policies; it does not discover or import chat history.

## Initial setup

### 1. Sign in

Open the admin entry point at your deployed domain and sign in with `SYS_PASSWD`. Management APIs require an authenticated admin session. Initialize the database first if this is a fresh deployment.

### 2. Create the plugin

In **Plugins**, add the Group Chatbot plugin (`elysia-best/plugin-chatbot`). Fields are rendered from declared types. Secret fields are not echoed as ordinary text. Do not paste credentials into non-secret fields.

### 3. Configure an AI provider and prices

In **AI Providers**, enter a provider name, compatible API URL, API key, and model information. Then use **API Capabilities / Model Pricing** to record input/output rates and billing units. Pricing participates in budget checks; text models without a registered price are billed at the default $3 input / $15 output per million tokens instead of being rejected. The pricing page offers public price presets for common models; import them and adjust against your actual bill.

Declare media capabilities for the actual provider and model. Attachments unsupported by the selected model are not reported as read. The provider still controls external requests and billing.

### 4. Add a QQ account

In **Platform Accounts**, create a QQ account, select the chatbot plugin, and enter the QQ AppID and AppSecret. The server encrypts secrets using `SYS_SECRET`; consider existing encrypted data before rotating this secret.

### 5. Add a group or private-chat policy

In **Conversation Policies**, select the account, enter the external conversation ID/OpenID and conversation type, and configure:

- AI provider, model, and optional reasoning effort;
- system prompt, tools, MCP servers, Skills/Rules;
- owner/admin/user allowlists or the relevant access policy;
- context budget, summary ratio, message batching/chunking, rate limits, and spending limits.

Each conversation can also define a **Persona** in the Persona & prompts extension settings of its policy. The persona describes identity, tone, and speaking style and is injected before the identity policy/system rules; role cards, conversation memory, Skills/Rules, and mode instructions are appended by the runtime. Keep authorization rules out of the persona, and never put secrets or private data in prompts.

Create policies only for conversations you are authorized to manage. Group OpenIDs and user OpenIDs have different scopes; do not interchange them.

### 6. Verify message delivery

Point the QQ callback at `/webhook/qq`; ensure proxies preserve signature headers and the original JSON body. Send a message from an allowlisted test account in the configured conversation. Use `/help` to inspect available commands and `/openid` to verify the current user and group IDs. Never send credentials or private data to public groups.

## Conversation Management and commands

**Conversation Management** displays state for saved policies and can configure runtime mode, silence, one-time prompts, additional tool restrictions, context reset, pending tool approvals, scheduled wakeups, and media assets. If the list is empty, check the account, policy, and valid OpenID; it is not a chat-history browser.

Common commands (permissions depend on the policy and sender identity):

| Command | Purpose |
| --- | --- |
| `/help` | Show commands available to the current identity |
| `/status` | Inspect conversation runtime status |
| `/reset` | Reset conversation context |
| `/mode` | Manage runtime mode |
| `/role` | Manage conversation role cards |
| `/memory` | Manage current-conversation memory |
| `/openid` | Show the current user and group OpenID |
| `/approvals`, `/approval`, `/approve`, `/reject` | Inspect, approve, or reject pending tool calls |
| `/wake` | List or cancel persistent scheduled wakeups where supported |
| `/tools` | Further restrict tools within policy permissions |

A remote MCP `readOnlyHint` is not proof of trust. A tool runs directly only when both the admin allowlist and the remote read-only marker permit it; other available calls require owner approval. In the console, **Pending approvals** lets you edit arguments before approval: saving only changes the pending call and never executes the tool; an owner must still approve it. Arguments must be a JSON object and must not contain secrets.

## Role cards and memory

Conversation role cards can be managed with `/role` or the console. Account-shared role cards and project memory have a different scope from conversation memory; shared data does not grant arbitrary write access to each conversation. `MemoryWrite`, `MemoryForget`, and shared writes/deletes are owner-restricted.

Before enabling memory or MCP, review participants, data scope, and retention. Model output, web search results, Skills/Rules, and external documents are untrusted content.

## Logs and privacy

`LOG_RECORD` is disabled by default. When enabled, records may include user/conversation identifiers, message content, model/tool status, usage, and errors. Retention is capped at 30 days and requires scheduled physical cleanup. See [Log retention](/en/operations/log-retention). Do not put credentials or sensitive personal data in prompts, group chats, or logs.

## Troubleshooting

- **Empty conversation list:** Check for a platform account, a saved group/private policy, and a valid OpenID. An account alone does not discover chat history.
- **Model request fails:** Check the API URL, key, model ID, declared media capabilities, and provider quota. Do not expose secrets in logs.
- **No reply is sent:** Check QQ callback signatures, account status, conversation OpenID, allowlists, and platform send permissions.
- **Tool requires approval:** Review its name and arguments in the console, then have an owner approve or reject it. Do not trust a tool's self-declared read-only status alone.
- **Missing pricing or rejected request:** Check that an active price exists for the model and billing unit, and review the conversation budget.
