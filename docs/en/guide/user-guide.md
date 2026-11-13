# Admin Console Guide

This guide takes a new installation through its first test message. “Conversation Management” and “Conversation Policies” serve different purposes: the former operates on runtime state for saved policies; the latter defines the provider, model, prompt, allowlist, and budget for a conversation.

## Recommended setup order

The admin sidebar follows this order. Work through it once to send the first message:

1. **Integrations → AI Providers**: enter the compatible API URL, key, and models.
2. **Integrations → Prices**: import presets or register your actual rates; budgets use these prices.
3. **Integrations → Identity**: create an identity policy with a model, system prompt, and tools.
4. **Plugins / Platform Accounts**: confirm the chatbot plugin, then enter the QQ AppID and AppSecret.
5. **Group Policies**: select the account, enter the group openid, and choose the identity policy; leave everything else empty to inherit.
6. **Conversation Management / Logs**: mention the bot in the group and check connection state and errors.

A group policy only links an account and conversation IDs to an identity policy. Models, system prompts, Skills/MCP/Rules, and similar shared settings live in the identity policy, so you do not repeat them for every group. The **05 / Advanced** section can stay untouched.

## Before you start

1. Deploy and initialize persistent storage; set `SYS_PASSWD` and `SYS_SECRET`.
2. Prepare the QQ bot AppID/AppSecret and callback configuration in the QQ Open Platform.
3. Prepare an AI API endpoint and key compatible with the request format used by the project. For MCP, also prepare its endpoint, authentication, and an admin-reviewed tool allowlist.
4. Identify the group/private OpenID to test. Conversation Management lists saved policies; it does not discover or import chat history.

## Initial setup

### 1. Sign in

Open the admin entry point at your deployed domain and sign in with `SYS_PASSWD`. Management APIs require an authenticated admin session. Initialize the database first if this is a fresh deployment.

### 2. Configure an AI provider and prices

In **Integrations → AI Providers**, enter a provider name, compatible API URL, API key, and model information. Then use **Prices** to import common presets or register input/output rates and billing units from your actual bill. Pricing participates in budget checks; text models without a registered price are billed at the default $3 input / $15 output per million tokens instead of being rejected.

Declare media capabilities for the actual provider and model. Attachments unsupported by the selected model are not reported as read. The provider still controls external requests and billing.

### 3. Create an identity policy

In **Integrations → Identity**, create a policy with the provider, model, system prompt, and optional Skills, MCP servers, and Rules. An identity policy is the shared default for group policies: a group policy references it instead of repeating the model and tools. Without an identity policy, a group policy can still override the model and prompt, but the configuration is harder to reuse across groups.

### 4. Confirm the plugin

In **Plugins**, confirm that the Group Chatbot plugin (`elysia-best/plugin-chatbot`) is registered and enabled. Fields are rendered from declared types. Secret fields are not echoed as ordinary text. Do not paste credentials into non-secret fields.

### 5. Add a QQ account

In **Platform Accounts**, create a QQ account, select the chatbot plugin, and enter the QQ AppID and AppSecret. The server encrypts secrets using `SYS_SECRET`; consider existing encrypted data before rotating this secret.

### 6. Add a group or private-chat policy

In **Group Policies**, select the account, enter the external conversation ID/OpenID and conversation type, then follow the form order:

- **01 / Basics**: account, conversation IDs, owner IDs, name, and enabled state;
- **02 / AI and prompts**: choose the identity policy; add a persona or conversation prompt only when this conversation needs a different role; empty overrides inherit the identity policy;
- **03 / Spending limits**: daily, monthly, and total limits; 0 means unlimited;
- **04 / Extensions**: append Skills, MCP servers, and Rules on top of the identity policy;
- **05 / Advanced**: expand only for dialogue/voice policies, the user allowlist, reserved modes, or a custom time zone.

Each conversation can also define a **Persona** under **02 / AI and prompts**. The persona describes identity, tone, and speaking style and is injected before the identity policy/system rules; role cards, conversation memory, Skills/Rules, and mode instructions are appended by the runtime. Keep authorization rules out of the persona, and never put secrets or private data in prompts.

Create policies only for conversations you are authorized to manage. Group OpenIDs and user OpenIDs have different scopes; do not interchange them.

### 7. Verify message delivery

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
