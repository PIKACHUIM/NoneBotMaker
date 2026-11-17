# Chat platform setup

NoneBotMaker receives and sends messages through each platform's official Webhooks/APIs. It does not run the NoneBot, Koishi, or NapCat runtimes. Every platform shares the same accounts, conversation policies, AI providers, tools, memory, and cost management.

## Common steps

1. Create an account under **Runtime → Platform accounts**, choose the platform protocol, and enter its credentials.
2. Set the callback URL shown in the admin console in the platform's own console.
3. Bind the account and conversation external IDs under **Groups**, then choose the identity and dialog policies. WebSocket protocols such as Discord and Satori need no callback URL; the Cloudflare Durable Object connects automatically once the account is enabled.
4. Send `/openid` in a test conversation to obtain the real user and conversation IDs, then verify the binding in the admin console.

Credentials are encrypted with `SYS_SECRET` and never echoed in plaintext. Replace `<domain>` below with the deployed domain.

## QQ official bot

- Callback: `https://<domain>/webhook/qq`
- Credentials: AppID and AppSecret.
- Webhook mode requires QQ Open Platform to send signed headers and the original JSON body. On Cloudflare you may use the Durable Objects WebSocket Gateway instead, in which case `/webhook/qq` is not used.
- Group and private conversations use QQ `group_openid` / user `openid` as external IDs.

## OneBot v11

OneBot v11 connects to NapCat, go-cqhttp, Koishi, Red, and Mirai with an OneBot plugin.

1. Enable the OneBot HTTP API and set the HTTP report URL to `https://<domain>/webhook/onebot`.
2. If report signing is enabled, enter the same secret in OneBot and in the admin account's **Report signing secret**; the service verifies `X-Signature` (HMAC-SHA1).
3. In the admin console, enter:
   - Bot ID (`self_id`, usually the bot QQ number)
   - OneBot HTTP API base URL, for example `http://127.0.0.1:3000`
   - Access Token (must match OneBot, optional)
   - Report signing secret (optional)
4. Group external IDs use `group_id`; private chats use `user_id`. Send `/openid` in a test conversation to inspect them.
5. Text is sent as OneBot message segments. Images, audio, video, and files use `base64://` segments, subject to QQ/OneBot size limits.
6. Serverless runtimes cannot reach your local `127.0.0.1`. The OneBot API address must be reachable from the deployment environment (public or tunneled) and must not be exposed without authentication.
7. Which platforms OneBot can serve depends on the OneBot implementation; this project's conversation and send logic does not rely on QQ-specific fields.

## Telegram

1. Create a bot with [BotFather](https://t.me/BotFather) and obtain the Bot Token.
2. Set the webhook; `secret_token` must match the admin console:

```sh
curl "https://api.telegram.org/bot<bot-token>/setWebhook" \
  -d "url=https://<domain>/webhook/telegram" \
  -d "secret_token=<secret-token>"
```

3. In the admin console, enter the Bot Token, the Bot numeric ID (leave empty to derive it from the token prefix), and the Webhook Secret Token.
4. Conversation external IDs use Telegram `chat_id`: private chats match the user ID, while groups are usually negative.
5. In groups, bots normally receive only commands and @mentions. Disable privacy mode in BotFather to receive ordinary group messages.
6. Inbound images/files currently enter model context as placeholders; outbound supports photos, audio, video, and documents.

## Slack

1. Create an app on [Slack API](https://api.slack.com/apps) and note the App ID and Signing Secret from Basic Information.
2. Add the `chat:write` scope under OAuth & Permissions (plus `files:write` for uploads), install the app, and note the Bot User OAuth Token (`xoxb-`).
3. Under Event Subscriptions, set the Request URL to `https://<domain>/webhook/slack` and subscribe to `message.channels`, `message.groups`, and `message.im`; add `app_mention` if you want explicit mention events.
4. Enter the App ID, Bot Token, and Signing Secret in the admin console.
5. Conversation external IDs use channel IDs (`C...`, or `D...` for direct messages). Invite the bot to the channel before chatting.

Notes:

- Callbacks are verified with `X-Slack-Signature` (HMAC-SHA256) and a five-minute timestamp window; retried events are deduplicated by `event_id`.
- Channel messages must @mention the bot; direct messages are always answered.
- Text uses `chat.postMessage`; files use the external upload flow (`files.getUploadURLExternal` → upload → `files.completeUploadExternal`) and require `files:write`.

## LINE

1. Create a Messaging API channel on [LINE Developers](https://developers.line.biz/) and note the Channel ID, Channel Secret, and long-lived Channel Access Token.
2. Set the Webhook URL to `https://<domain>/webhook/line` and enable **Use webhook**.
3. Enter the Channel ID, Channel Secret, and Channel Access Token in the admin console; optionally add the Bot User ID (`U...`) for callback checks.
4. Direct chats use the user ID, groups use `groupId`, and multi-user rooms use `roomId`.
5. Disable the channel's auto-reply messages so they do not conflict with the bot.

Notes:

- Callbacks are verified with `X-Line-Signature` (base64 HMAC-SHA256).
- Replies use the push API with a 5000-character text limit; group chats require the bot to be invited and @mentioned.
- LINE image/video messages require public HTTPS URLs, so this service sends text only.

## WhatsApp Cloud API

1. Create an app on the [Meta developer console](https://developers.facebook.com/), add the WhatsApp product, and note the Phone Number ID, App Secret, and access token.
2. Under WhatsApp → Configuration, set the Callback URL to `https://<domain>/webhook/whatsapp`, enter a custom verify token, and subscribe to the `messages` field.
3. Enter the Phone Number ID, Graph API access token, App Secret, and webhook verify token in the admin console.
4. Conversation external IDs use the user's WhatsApp number (`wa_id`).

Notes:

- GET verification echoes `hub.challenge`; POST callbacks are verified with `X-Hub-Signature-256` (HMAC-SHA256).
- One-to-one chats only; groups are not supported.
- Replies are limited to the 24-hour customer-service window; outside it you need template messages.
- Outbound supports text, images, audio, video, and documents. Media is uploaded to Meta first and sent by media id.

## Mattermost

1. Create an outgoing webhook under **Integrations → Outgoing Webhooks** in the Mattermost system console, select a channel, and note the token.
2. Create a bot account under **Integrations → Bot Accounts**, or prepare a personal access token that can create posts.
3. Set the callback URL to `https://<domain>/webhook/mattermost` and configure trigger words as needed.
4. Enter the server URL, outgoing webhook token, and bot access token in the admin console.
5. Conversation external IDs use channel IDs.

Notes:

- Outgoing webhooks only deliver messages that match a trigger word; the service strips the trigger word before passing the text to the model.
- Replies use `POST /api/v4/posts`; files are uploaded to `/api/v4/files` and attached to the post.
- Direct messages are outside the outgoing webhook trigger scope and are currently treated as channel messages.

## Discord

Discord delivers ordinary messages only through its Gateway, so this project uses a Cloudflare Durable Object WebSocket instead of a Webhook.

1. Create an application and bot in the [Discord Developer Portal](https://discord.com/developers/applications) and note the Application ID and Bot Token.
2. Enable **Message Content Intent** on the Bot page; enable Server Members Intent only if member data is needed.
3. In the admin console, add an account, choose Discord, and enter the Application ID (the same value as the Bot User ID) and Bot Token.
4. Invite the bot to the server; channel conversations use the channel ID, and direct messages use the DM channel ID.

Notes:

- Uses Gateway v10 with `GUILD_MESSAGES`, `DIRECT_MESSAGES`, and `MESSAGE_CONTENT`, including session resume.
- Channel messages must @mention the bot; direct messages are always answered.
- Text is capped at 2000 characters; media uses multipart uploads; model output cannot trigger `@everyone`.
- Requires Cloudflare Durable Objects. EdgeOne and Alibaba Cloud ESA have no matching binding and will not connect.

## Satori

Satori unifies QQ, Discord, Telegram, and other platforms behind one protocol through Koishi and other SDKs. Satori also uses a Cloudflare Durable Object WebSocket here.

1. Deploy a Satori SDK (for example the Koishi satori plugin) and note the HTTP URL and access token.
2. In the admin console, add an account, choose Satori, and enter the server URL, platform name (such as `onebot`), bot ID (`self_id`), and token.
3. The service connects to `/v1/events`, sends IDENTIFY, receives `message-created`, and replies through `/v1/message.create`.
4. Conversation external IDs use the Satori `channel.id`.

Notes:

- Requires Cloudflare Durable Objects; EdgeOne and Alibaba Cloud ESA are not supported.
- Text only; media tools report an unsupported error.
- Groups require an @mention; reconnects resume with the last `sn`.

## Feishu / Lark

1. Create an enterprise self-built app on [Feishu Open Platform](https://open.feishu.cn/) and note the App ID and App Secret.
2. Under **Events & Callbacks → Event configuration**, set the request URL to `https://<domain>/webhook/feishu` and subscribe to `im.message.receive_v1`.
3. Grant message receive/send permissions (for example `im:message` and `im:message:send_as_bot`) and publish an app version.
4. Add the bot to the target group or start a direct chat.
5. Enter App ID, App Secret, and Verification Token in the admin console; also enter the Encrypt Key if the console has encryption enabled.

Notes:

- Without an Encrypt Key only plaintext events are accepted. With one, the service verifies `X-Lark-Signature` and decrypts the event.
- Direct and group conversations both use the Feishu `chat_id` as the external ID.
- Replies support text, images, and files; other media is sent as a file.

## DingTalk robot

1. Create an internal enterprise app on [DingTalk Open Platform](https://open.dingtalk.com/), add a robot, and choose HTTP callback message receiving.
2. Set the callback to `https://<domain>/webhook/dingtalk`.
3. Record the AppKey (Client ID) and AppSecret (Client Secret). Add the robot's RobotCode if you need proactive messages such as schedules.
4. Publish the app and add the robot to a group or direct chat.

Notes:

- Callbacks are verified with the `timestamp` and `sign` headers derived from the AppSecret; the service matches the single account whose secret produced the signature.
- Normal replies use the callback's `sessionWebhook` and do not need RobotCode.
- Scheduled proactive text uses the DingTalk robot API and requires RobotCode plus an `openConversationId` (group external ID) or user ID (direct chat).
- Robot callbacks do not support proactive media; image, audio, video, and file tools report an unsupported error in DingTalk conversations.

## WeChat Official Account

1. In the Official Account console under **Development → Basic configuration**, note the AppID and AppSecret, and add the service egress IP to the IP allowlist. Access tokens cannot be obtained without it.
2. Under **Server configuration**, set the URL to `https://<domain>/webhook/wechat`, choose a Token, and select **plaintext mode**.
3. Enter the same AppID, AppSecret, and Token in the admin console.
4. When the server configuration is submitted, WeChat sends a GET verification request; the service computes the SHA1 signature from the Token and echoes `echostr`.

Notes:

- Plaintext mode only; safe-mode (AES-encrypted) callbacks are not supported.
- Official Account messages are treated as direct messages, and the user openid is also the conversation external ID.
- Replies use the customer-service message API and support text, images, voice, and video. Files are unsupported and the 48-hour interaction window applies.
- Serverless egress IPs, including Cloudflare Workers, are not fixed and may not satisfy the Official Account IP allowlist. Verify `access_token` with a test account before going live.

## Conversations and proactive messages

- Obtain platform external IDs with `/openid` and enter them under **Groups**. A group record may contain several external IDs, while context remains isolated per real conversation.
- Schedule `message` actions send text proactively through the account protocol; `prompt` and `command` actions pass a synthetic message to the chat runtime. QQ uses `QQ_GATEWAY_SESSIONS` when configured, while other platforms execute in the current process.
- Proactive messages require the matching platform capability: RobotCode for DingTalk, a valid `access_token` and open interaction window for WeChat, app permissions for Feishu, a reachable HTTP API for OneBot, a valid Bot Token for Telegram, `chat:write` for Slack, a Channel Access Token for LINE, the 24-hour window for WhatsApp, and a post-capable access token for Mattermost.

## NoneBot2 adapter coverage

The table maps the chat protocol adapters documented by NoneBot2. It does not cover community plugins (GitHub, Bilibili, Minecraft, and similar), which target specific services or need long-running processes rather than a general chat protocol.

| NoneBot2 adapter | Supported | Notes |
| --- | --- | --- |
| OneBot | ✅ | `/webhook/onebot`, HTTP reports plus HTTP API |
| Telegram | ✅ | `/webhook/telegram` |
| Feishu | ✅ | `/webhook/feishu` |
| QQ | ✅ | `/webhook/qq` or the Cloudflare WebSocket Gateway |
| Red | ✅ | Through OneBot HTTP reports |
| Mirai | ⚠️ | Through the Mirai OneBot plugin; native `mirai-api-http` is not implemented |
| GitHub | ❌ | Event-driven source-hosting adapter, not a general chat protocol; issue/PR conversation semantics need a separate design |
| Console | ❌ | The project has an admin console and conversation management, but no simulated chat channel |
| Satori | ✅ | `/v1/events` WebSocket plus `/v1/message.create`, using a Cloudflare Durable Object |
| Discord | ✅ | Gateway v10 WebSocket, using a Cloudflare Durable Object |
| DoDo | ❌ | Long-lived bot connection protocol, not implemented |
| Kritor | ❌ | Separate WebSocket/TCP standard, not implemented |
| Milky | ❌ | Separate WebSocket standard, not implemented |
| DingTalk / WeChat Official Account / Slack / LINE / WhatsApp / Mattermost | ✅ | Additional native Webhook protocols in this project, see above |

## Troubleshooting

- **Callback verification fails:** Compare the Token, Verification Token, or AppSecret with the admin console and confirm the callback uses the deployed domain.
- **Messages arrive but no reply is sent:** Check that the account and plugin are enabled, the conversation is bound and enabled, allowlists and owners are correct, and the platform send permission is granted.
- **Signature passes but events are ignored:** Check the subscribed event type, whether the bot is in the group, and whether the message type is supported.
- **Media send fails:** Limits differ per platform. DingTalk callbacks do not support media, WeChat Official Accounts do not support customer-service files, QQ rich media is capped at 5 MB, OneBot is subject to the implementation and QQ limits, Telegram supports photos/audio/video/documents, Slack needs `files:write`, LINE sends text only, WhatsApp uploads media first, and Mattermost uses its file API.
