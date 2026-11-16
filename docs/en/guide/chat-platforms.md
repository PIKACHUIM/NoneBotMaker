# Chat platform setup

NoneBotMaker receives and sends messages through each platform's official Webhooks/APIs. It does not run the NoneBot, Koishi, or NapCat runtimes. Every platform shares the same accounts, conversation policies, AI providers, tools, memory, and cost management.

## Common steps

1. Confirm the chatbot plugin is enabled under **Runtime → Plugins**.
2. Create an account under **Runtime → Platform accounts**, choose the platform protocol, and enter its credentials.
3. Set the callback URL shown in the admin console in the platform's own console.
4. Bind the account and conversation external IDs under **Groups**, then choose the identity and dialog policies.
5. Send `/openid` in a test conversation to obtain the real user and conversation IDs, then verify the binding in the admin console.

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
- Proactive messages require the matching platform capability: RobotCode for DingTalk, a valid `access_token` and open interaction window for WeChat, app permissions for Feishu, a reachable HTTP API for OneBot, and a valid Bot Token for Telegram.

## NoneBot2 adapter coverage

The table maps the protocol adapters listed in the NoneBot2 documentation to native support in this project:

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
| Satori | ❌ | WebSocket protocol, unsuitable for stateless Webhooks; Cloudflare could use a Durable Object for a long connection |
| Discord | ❌ | Normal messages require the Gateway; interactions alone do not cover everyday chat |
| DoDo | ❌ | Long-lived bot connection protocol, not implemented |
| Kritor | ❌ | Separate WebSocket/TCP standard, not implemented |
| Milky | ❌ | Separate WebSocket standard, not implemented |
| DingTalk / WeChat Official Account | ✅ | Additional support in this project, see above |

## Troubleshooting

- **Callback verification fails:** Compare the Token, Verification Token, or AppSecret with the admin console and confirm the callback uses the deployed domain.
- **Messages arrive but no reply is sent:** Check that the account and plugin are enabled, the conversation is bound and enabled, allowlists and owners are correct, and the platform send permission is granted.
- **Signature passes but events are ignored:** Check the subscribed event type, whether the bot is in the group, and whether the message type is supported.
- **Media send fails:** Limits differ per platform. DingTalk callbacks do not support media, WeChat Official Accounts do not support customer-service files, QQ rich media is capped at 5 MB, OneBot is subject to the implementation and QQ limits, and Telegram supports photos/audio/video/documents.
