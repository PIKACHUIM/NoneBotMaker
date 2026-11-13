# Admin Console Guide

The path to the first reply is: initialize → Model Capabilities (interfaces, policies, tools) → Runtime Platform (account, group) → Conversation Management. **Group Management** holds persistent settings; **Conversation Management** shows live status, approvals, chat records, costs and individual memory entries.

## Recommended setup order

1. On first deployment, initialize the database and default policies/prices with `SYS_SECRET`. Existing deployments may explicitly **Fill Missing Defaults** on the setup page. Both operations only fill missing entries, without overwriting manual prices or policies. The default identity needs a model, default voice has no TTS model, and image generation is disabled.
2. **Model Capabilities → Interface Management → AI Providers**: enter the compatible API URL, key and actual models; review **Model Prices**. Existing price snapshots comprise 50 text models, two TTS models and four image models. Your gateway's actual bill may differ.
3. **Policy Management → Identity**: define one reusable **default persona**, base system rules, model and authorized Skills/MCP/Rules/tools. **Dialogue** configures streaming, rounds and output. Group Management requires both an identity and a dialogue policy. **Voice** is optional; **Budget** defines reusable USD limits (`0/0/0` is unlimited); **Memory** configures how to remember, capacity and expiry.
4. **Runtime Platform → Plugins / Platform Accounts**: enable the chatbot plugin and enter the QQ AppID and AppSecret.
5. **Runtime Platform → Group Management**: bind the account and group/private OpenID, then select identity and dialogue policies. Voice, budget and memory are optional. Enter only group-specific owner, access rules and tool approvals; groups cannot grant tools beyond the identity policy.
6. **Runtime Platform → Conversation Management**: mention the bot in the group, then inspect connectivity, approvals, records, per-event costs and errors. Manage actual memory entries here, not the memory policy.

A saved policy name alone does not make a provider usable: configure the default identity's model explicitly; an empty voice model or disabled image tool remains unavailable.

## Before you start

1. Deploy and initialize persistent storage; set `SYS_PASSWD` and `SYS_SECRET`.
2. Prepare the QQ bot AppID/AppSecret and callback configuration in the QQ Open Platform.
3. Prepare an AI API endpoint and key compatible with the request format used by the project. For MCP, also prepare its endpoint, authentication, and an admin-reviewed tool allowlist.
4. Identify the group/private OpenID to test. Conversation Management lists saved policies; it does not discover or import chat history.

## Initial setup

### 1. Sign in

Open the admin entry point at your deployed domain and sign in with `SYS_PASSWD`. Management APIs require an authenticated admin session. Initialize the database first if this is a fresh deployment.

### 2. Configure provider, identity and dialogue

Under **Model Capabilities → Interface Management → AI Providers**, register the provider's actual models and review **Model Prices**. Missing **text-chat** prices use the default $3 input / $15 output per million tokens; generated images use their modality rates or the administrator-configured per-image fallback, never a silently free request. Image presets are public snapshots, not your gateway's guaranteed invoice.

Under **Policy Management → Identity**, set the reusable **default persona** separately from **base system rules**, then choose the provider/model and authorized Skills/MCP/Rules/tools. Under **Dialogue**, configure streaming, tool rounds and output parameters. Both are required when binding a group. A selected conversation `/role` persona **replaces**, rather than appends to, the identity's default persona; clearing it restores the default.

A Budget policy supplies reusable daily/monthly/total limits (`0` means unlimited). A Memory policy chooses manual owner `/save`, candidate extraction awaiting admin review, or explicitly enabled automatic saving. The default is 100 memories per conversation, each expiring seven days after its last update; automatic direct saving currently considers owner messages only. No selected memory policy means memory is off. An empty Voice policy synthesis model leaves TTS disabled.

### 3. Confirm the chatbot plugin and account

Under **Runtime Platform → Plugins**, confirm the Group Chatbot plugin (`elysia-best/plugin-chatbot`) is enabled. Under **Platform Accounts**, bind the QQ AppID and AppSecret. The server encrypts secrets with `SYS_SECRET`; plan recovery before rotating it.

### 4. Bind the group and choose policies

Under **Runtime Platform → Group Management**, select an account and conversation type, then enter the group/user OpenID and owner IDs. **Identity and Dialogue are required and always visible; Voice, Budget and Memory remain visible but optional.** Group-specific rules are appended to identity base rules; overriding a model requires selecting the provider and model together. A group cannot add a tool the identity does not authorize. Tool approval supports per-tool rules, approve all, or allow all; allowing all skips manual approval and must be reviewed carefully before saving.

One group-management record may bind multiple OpenIDs, but conversation history and memory stay isolated by actual OpenID. Group and user OpenIDs are different scopes. Advanced options contain only rare settings, never core policies.

### 5. Verify behavior and billed usage

Check `API_METHOD`: `websocket` uses QQ Gateway and **does not** receive events at `/webhook/qq`; `webhook` requires its QQ callback URL, signature headers and original JSON body. Mention the bot in a bound conversation, then inspect connections, approvals, chat records, costs and errors in Conversation Management. Use `/openid` to confirm QQ identifiers. Do not post keys or private information in public chats.

## Conversation Management and commands

**Conversation Management** shows connectivity, approvals, conversation-specific chat records and charges, memory entries, emergency silence, one-time prompts and context reset. Persistent mode and approval rules belong in Group Management. Per-event cost sums all model/image/voice calls; hover to inspect token usage, price source and estimated charges. If the conversation list is empty, check the account and bound OpenIDs; historical messages do not automatically create a policy.

Common commands (permissions depend on the policy and sender identity):

| Command | Purpose |
| --- | --- |
| `/help` | Show commands available to the current identity |
| `/status` | Inspect conversation runtime status |
| `/reset` | Reset conversation context |
| `/mode` | Manage runtime mode |
| `/role` | Let an owner select a conversation persona in place of the identity default |
| `/save <name> <content>` | Let an owner explicitly save a conversation memory when memory is enabled |
| `/memory` | Query and manage this conversation's memories, not account-shared project memories |
| `/openid` | Show the current user and group OpenID |
| `/approvals`, `/approval`, `/approve`, `/reject` | Inspect, approve, or reject pending tool calls |
| `/wake` | List or cancel persistent scheduled wakeups where supported |
| `/tools` | Further restrict tools within policy permissions |

A remote MCP `readOnlyHint` is not proof of trust: MCP calls must pass the administrator's allowlist and the identity's authorization first. Groups may then disable an authorized tool or require approval. Side-effecting tools require owner approval by default; choosing **Allow all** for a group skips manual approval and should be restricted to trusted conversations with audit logs. In **Pending approvals**, saving edited JSON arguments does not execute the tool; the owner must still approve it.

## Persona and memory

The identity sets the **default persona**. A persona chosen with `/role` replaces that default until cleared; the two are never concatenated. Base system rules and group-only appended rules live in separate fields. Tool/security authorization must not rely on prompt wording alone. Account-shared project memory has a different scope from conversation memory; the latter uses a separate database table and can be listed, edited, approved or deleted per conversation. Explicit `/save`, `MemoryWrite` and `MemoryForget` are owner-only; automatic direct capture currently considers owner messages, while member messages may only become review candidates.

Before enabling memory or MCP, review participants, data scope, and retention. Model output, web search results, Skills/Rules, and external documents are untrusted content.

## Logs and privacy

`LOG_RECORD` is disabled by default. When enabled, records may include user/conversation identifiers, message content, model/tool status, usage, and errors. Retention is capped at 30 days and requires scheduled physical cleanup. See [Log retention](/en/operations/log-retention). Do not put credentials or sensitive personal data in prompts, group chats, or logs.

## Troubleshooting

- **Empty conversation list:** Check for a platform account, a saved group/private policy, and a valid OpenID. An account alone does not discover chat history.
- **Model request fails:** Check the API URL, key, model ID, declared media capabilities, and provider quota. Do not expose secrets in logs.
- **No reply is sent:** Check whether the instance uses WebSocket Gateway or Webhook, then verify the account, required identity/dialogue policies, OpenID, allowlists and QQ send permissions. Only Webhook mode uses callback signatures.
- **Tool requires approval:** Inspect the authorized tool and arguments in Conversation Management, then have an owner approve or reject it; a self-declared read-only marker is insufficient.
- **An estimated charge appears:** Unpriced text uses the default rate. Images with only `total_tokens` use an average-rate estimate; images without billable usage use the configured per-image fallback. Estimates may differ from your actual provider bill; verify whether the Budget policy is unlimited.
