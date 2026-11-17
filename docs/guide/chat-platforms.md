# 聊天平台接入

NoneBotMaker 通过各平台官方 Webhook/API 接收和发送消息，不运行 NoneBot、Koishi 或 NapCat 运行时。所有平台共用同一套账号、会话策略、AI 供应商、工具、记忆和费用管理。

## 通用步骤

1. 在「运行平台 → 平台账号」新增账号，选择平台协议并填写该协议凭据。
2. 在对应平台后台把回调地址设置为管理台显示的 URL。
3. 在「群聊管理」绑定账号与会话外部 ID，并选择身份策略和对话策略。Discord、Satori 等 WebSocket 协议不需要回调地址，账号启用后由 Cloudflare Durable Object 自动连接。
4. 在测试会话中发送 `/openid` 获取真实的用户与会话 ID，再回到管理台核对绑定。

账号凭据由服务端使用 `SYS_SECRET` 加密，管理台不回显明文。下方回调地址中的 `<domain>` 替换为实际部署域名。

## QQ 官方机器人

- 回调地址：`https://<domain>/webhook/qq`
- 凭据：AppID、AppSecret。
- Webhook 模式需要 QQ 开放平台保留签名请求头与原始请求体；Cloudflare 可改用 Durable Objects WebSocket Gateway，此时不使用 `/webhook/qq`。
- 群聊与私聊以 QQ 的 `group_openid` / 用户 `openid` 作为会话外部 ID。

## OneBot v11

OneBot v11 可对接 NapCat、go-cqhttp、Koishi、Red，以及带 OneBot 插件的 Mirai 等实现。

1. 在 OneBot 实现中启用 HTTP API，并配置 HTTP 上报（事件上报）地址 `https://<domain>/webhook/onebot`。
2. 如果启用上报签名，把签名密钥同时填入 OneBot 配置和管理台账号的「上报签名密钥」；服务会校验 `X-Signature`（HMAC-SHA1）。
3. 在管理台填写：
   - 机器人 ID（`self_id`，通常是机器人 QQ 号）
   - OneBot HTTP API 地址，例如 `http://127.0.0.1:3000`
   - Access Token（与 OneBot 配置一致，可选）
   - 上报签名密钥（可选）
4. 群聊外部 ID 使用 `group_id`，私聊使用 `user_id`；可在测试会话发送 `/openid` 查看。
5. 文本按 OneBot 消息段发送；图片、语音、视频和文件以 `base64://` 消息段发送，受 QQ/OneBot 实现的大小限制。
6. Serverless 运行环境无法访问你本机的 `127.0.0.1`。OneBot API 地址必须从部署环境可访问（公网或内网穿透），并确保不会被未授权访问。
7. OneBot 本身可承载哪些平台取决于所用的 OneBot 实现；本项目的会话与发送逻辑不依赖 QQ 专属字段。

## Telegram

1. 通过 [BotFather](https://t.me/BotFather) 创建机器人并获取 Bot Token。
2. 设置 Webhook，`secret_token` 必须与管理台填写的一致：

```sh
curl "https://api.telegram.org/bot<bot-token>/setWebhook" \
  -d "url=https://<domain>/webhook/telegram" \
  -d "secret_token=<secret-token>"
```

3. 在管理台填写 Bot Token、Bot 数字 ID（可留空，服务会自动从 Token 冒号前提取）和 Webhook Secret Token。
4. 会话外部 ID 使用 Telegram `chat_id`：私聊与用户 ID 相同，群组通常是负数。
5. 群聊中机器人默认只能收到命令和 @ 消息；需要在 BotFather 关闭 privacy mode 才能接收普通群消息。
6. 入站图片/文件目前只以占位符进入模型上下文；出站支持图片、音频、视频和文件。

## Slack

1. 在 [Slack API](https://api.slack.com/apps) 创建应用，记录 Basic Information 中的 App ID 与 Signing Secret。
2. 在 OAuth & Permissions 添加 `chat:write` 权限（需要发文件时再加 `files:write`），安装到工作区并记录 Bot User OAuth Token（`xoxb-` 开头）。
3. 在 Event Subscriptions 把 Request URL 设为 `https://<domain>/webhook/slack`，订阅 `message.channels`、`message.groups`、`message.im`；需要单独响应 @ 时再加 `app_mention`。
4. 在管理台填写 App ID、Bot Token 和 Signing Secret。
5. 会话外部 ID 使用频道 ID（`C...`，私聊为 `D...`）。把机器人邀请进频道后才能收发消息。

说明：

- 回调使用 `X-Slack-Signature`（HMAC-SHA256）和 5 分钟时间戳窗口校验，重试事件按 `event_id` 去重。
- 频道内必须 @ 机器人才会触发；私聊直接回复。
- 文本通过 `chat.postMessage` 发送；文件走外部上传流程（`files.getUploadURLExternal` → 上传 → `files.completeUploadExternal`），需要 `files:write` 权限。

## LINE

1. 在 [LINE Developers](https://developers.line.biz/) 创建 Messaging API 频道，记录 Channel ID、Channel Secret 和长期 Channel Access Token。
2. 在 Messaging API 设置中把 Webhook URL 设为 `https://<domain>/webhook/line`，并启用 Use webhook。
3. 在管理台填写 Channel ID、Channel Secret、Channel Access Token；可选填写 Bot User ID（`U...`）用于校验回调归属。
4. 私聊外部 ID 是用户 ID，群聊使用 `groupId`，多人会话使用 `roomId`。
5. 关闭频道的自动回复消息，避免和机器人回复冲突。

说明：

- 回调使用 `X-Line-Signature`（base64 HMAC-SHA256）校验。
- 回复通过 push API 发送，单条文本上限 5000 字符；群聊需要把机器人加入群，并在消息中 @ 机器人。
- LINE 的图片/视频消息要求公网 HTTPS 地址，本服务目前只发送文本。

## WhatsApp Cloud API

1. 在 [Meta 开发者后台](https://developers.facebook.com/) 创建应用并添加 WhatsApp 产品，记录 Phone Number ID、App Secret 和访问令牌。
2. 在 WhatsApp → Configuration 把 Callback URL 设为 `https://<domain>/webhook/whatsapp`，填写自定义 Verify token，并订阅 `messages` 字段。
3. 在管理台填写 Phone Number ID、Graph API Access Token、App Secret 和 Webhook Verify Token。
4. 会话外部 ID 是用户的 WhatsApp 号码（`wa_id`）。

说明：

- GET 校验回显 `hub.challenge`；POST 使用 `X-Hub-Signature-256`（HMAC-SHA256）校验。
- 只支持一对一聊天，不支持群聊。
- 服务只能在 24 小时客服窗口内回复；窗口外需要改用模板消息。
- 出站支持文本、图片、音频、视频和文件；媒体先上传到 Meta，再按 media id 发送。

## Mattermost

1. 在 Mattermost 系统控制台「集成 → 传出 Webhook」新建 Webhook，选择频道并记录 Token。
2. 在「集成 → 机器人账号」创建机器人，或准备一个可创建帖子的个人访问令牌。
3. 把回调地址设为 `https://<domain>/webhook/mattermost`，按需配置触发词。
4. 在管理台填写服务器地址、Outgoing Webhook Token 和 Bot Access Token。
5. 会话外部 ID 使用频道 ID。

说明：

- 传出 Webhook 只发送命中触发词的消息；服务会先去掉触发词前缀再交给模型。
- 回复通过 `POST /api/v4/posts` 发送；文件先上传到 `/api/v4/files`，再附加到帖子。
- 私聊不在传出 Webhook 的触发范围内，目前按频道消息处理。

## Discord

Discord 的普通消息只能通过 Gateway 接收，因此本项目使用 Cloudflare Durable Object WebSocket，而不是 Webhook。

1. 在 [Discord Developer Portal](https://discord.com/developers/applications) 创建应用与 Bot，记录 Application ID 和 Bot Token。
2. 在 Bot 页面开启 **Message Content Intent**；需要读取成员信息时再开启 Server Members Intent。
3. 在管理台新增账号，协议选择 Discord，填写 Application ID（与 Bot User ID 相同）和 Bot Token。
4. 把机器人邀请进服务器；频道会话外部 ID 使用频道 ID，私聊使用 DM 频道 ID。

说明：

- 使用 Gateway v10，订阅 `GUILD_MESSAGES`、`DIRECT_MESSAGES` 与 `MESSAGE_CONTENT`，并支持断线续传。
- 频道内必须 @ 机器人才会触发；私聊直接回复。
- 单条文本上限 2000 字符；媒体走 multipart 上传；模型输出不会触发 `@everyone`。
- 需要 Cloudflare（Durable Objects）；EdgeOne、阿里云 ESA 没有对应绑定，账号不会连接。

## Satori

Satori 通过 Koishi 等 SDK 把 QQ、Discord、Telegram 等平台统一成一套协议。本项目的 Satori 协议同样使用 Cloudflare Durable Object WebSocket。

1. 部署 Satori SDK（例如 Koishi 的 satori 插件），记录 HTTP 地址与访问令牌。
2. 在管理台新增账号，协议选择 Satori，填写服务地址、平台标识（如 `onebot`）、机器人 ID（`self_id`）和令牌。
3. 服务会连接 `/v1/events`，发送 IDENTIFY 并接收 `message-created`，回复通过 `/v1/message.create`。
4. 会话外部 ID 使用 Satori 的 `channel.id`。

说明：

- 需要 Cloudflare（Durable Objects）；EdgeOne、阿里云 ESA 没有对应绑定。
- 只发送文本；媒体工具会返回不支持。
- 群聊中仅在 @ 机器人时触发；断线后会携带 `sn` 恢复会话。

## KOOK

1. 在 [KOOK 开发者中心](https://developer.kookapp.cn/) 创建应用，机器人连接模式选择 WebSocket，记录 Bot Token 与机器人 ID。
2. 在「邀请链接」生成邀请并把机器人添加到服务器，授予读取与发送消息权限。
3. 管理台新增账号 → 协议选 KOOK → 填写机器人 ID 与 Bot Token。
4. 频道会话外部 ID 使用频道 ID，私聊使用用户 ID。

说明：

- 使用 Gateway WebSocket，30 秒心跳并支持 `sn` 续传；需要 Cloudflare Durable Object。
- 频道内需 @ 机器人；私聊直接回复。
- 文本按 KMarkdown 发送；图片和文件先上传到 `/asset/create`，再以 Markdown 链接发送。

## 企业微信

1. 企业微信管理后台创建自建应用，记录 CorpID（我的企业）、AgentID 与应用 Secret。
2. 在应用「接收消息 → 设置 API 接收」填写 URL `https://<domain>/webhook/wecom`、Token 和 43 位 EncodingAESKey，消息加解密选择**安全模式**。
3. 把服务出口 IP 加入应用的「企业可信 IP」，否则无法获取 `access_token`。
4. 管理台新增账号 → 协议选企业微信 → 填写 CorpID、AgentID、Secret、Token 和 EncodingAESKey。
5. 会话外部 ID 使用成员 UserID。

说明：

- 回调使用 SHA1 签名与 AES-256-CBC 解密，并按 CorpID 校验归属。
- 仅支持应用与成员的一对一消息；企业微信应用回调不接收群聊消息。
- 回复通过应用消息接口发送，支持文本、图片、语音、视频与文件；素材先上传再按 media_id 发送。
- Serverless 出口 IP 不固定，可能无法满足可信 IP 白名单；上线前请用测试企业验证。

## Facebook Messenger

1. 在 [Meta 开发者后台](https://developers.facebook.com/) 创建应用并添加 Messenger 产品，绑定一个 Facebook 主页。
2. 在 Messenger → Settings 生成 Page Access Token，并记录 App Secret。
3. 把 Callback URL 设为 `https://<domain>/webhook/messenger`，填写 Verify Token，订阅 `messages` 字段。
4. 管理台新增账号 → 协议选 Facebook Messenger → 填写主页 ID、Page Access Token、App Secret 和 Verify Token。

说明：

- GET 校验回显 `hub.challenge`；POST 使用 `X-Hub-Signature-256` 校验。
- 只支持主页与用户的一对一会话。
- 出站支持文本、图片、音频、视频和文件；媒体先上传为可重用附件，再按 attachment_id 发送。

## VK

1. 在 VK 社区管理页面创建社区令牌（messages 权限），并在「管理 → API 使用 → Callback API」配置服务器地址 `https://<domain>/webhook/vk`。
2. 记录社区数字 ID、Callback API 的 secret 和 confirmation 字符串。
3. 管理台新增账号 → 协议选 VK → 填写群组 ID、社区访问令牌、Callback Secret 和 Confirmation Token。

说明：

- 服务会原样返回 confirmation 字符串完成回调验证，并逐条校验回调中的 `secret`。
- `peer_id` 大于等于 2000000000 视为群聊，否则为私聊。
- 出站仅支持文本；图片与文件需要先通过 VK 上传接口取得附件，暂由模型以链接形式回复。

## Zulip

1. 在 Zulip 的「设置 → 机器人」创建传入/传出 Webhook 机器人，记录机器人邮箱与 API Key。
2. 在机器人配置中把 Outgoing Webhook URL 设为 `https://<domain>/webhook/zulip`，记录 Token。
3. 管理台新增账号 → 协议选 Zulip → 填写站点地址、机器人邮箱、API Key 和 Webhook Token。
4. 频道会话外部 ID 形如 `stream:<stream_id>:<topic>`，私聊形如 `dm:<user_id>`，发送 `/openid` 可确认。

说明：

- 传出 Webhook 只在 @ 机器人时触发。
- 回复通过 `POST /api/v1/messages` 发送，频道消息带主题。
- 文件先上传到 `/api/v1/user_uploads`，再以 Markdown 链接发送。

## Rocket.Chat

1. 在 Rocket.Chat 的「管理 → 集成 → 传出 Webhook」新建集成，填写回调地址 `https://<domain>/webhook/rocketchat` 并记录 Token。
2. 准备机器人账号或个人访问令牌，记录 User ID 与 Auth Token。
3. 管理台新增账号 → 协议选 Rocket.Chat → 填写服务器地址、User ID、Auth Token 和 Webhook Token。
4. 会话外部 ID 使用房间 ID。

说明：

- 服务校验回调中的 Token，并通过 `chat.postMessage` 回复。
- 文件先上传到 `/api/v1/rooms.media/:rid`，确认后附带在消息中。
- 传出 Webhook 只在命中触发词或 @ 机器人时触发。

## DoDo

DoDo 只提供 WebSocket 事件订阅，因此使用 Cloudflare Durable Object 网关。

1. 在 [DoDo 开放平台](https://open.imdodo.com/) 创建机器人，记录 Client ID 与 Token。
2. 把机器人邀请到语音频道社区，并授予发送消息权限。
3. 管理台新增账号 → 协议选 DoDo → 填写 Client ID 与 Token。
4. 频道会话外部 ID 使用频道 ID；私聊使用 `islandId|用户ID`，`/openid` 会返回该格式。

说明：

- 服务先调用 `/api/v2/websocket/connection` 获取网关地址，再发送 25 秒心跳。
- 频道内消息会全部进入运行时；私聊直接回复。
- 图片先上传到 `/api/v2/resource/picture/upload`，再按图片消息发送；其他媒体以链接回复。

## Matrix

Matrix 没有 Webhook，服务通过 Durable Object 持续执行 `/sync` 长轮询。

1. 在 homeserver 上创建机器人账号并取得 Access Token（需要 `m.room.message` 读写权限）。
2. 把机器人邀请进需要服务的房间；收到邀请后服务会自动加入。
3. 管理台新增账号 → 协议选 Matrix → 填写 Homeserver 地址、机器人 MXID 和 Access Token。
4. 会话外部 ID 使用房间 ID（`!xxx:server`）。

说明：

- 首次同步只记录 `next_batch`，不会回放历史消息。
- 已加入的加密房间（E2EE）不会解密，需要关闭加密或使用未加密房间。
- 发送时使用 `PUT /rooms/{roomId}/send/m.room.message/{txnId}`；媒体先上传到 `/_matrix/media/v3/upload`。
- 群聊需要 @ 机器人或回复机器人消息；`m.direct` 中的私聊房间始终触发。

## Revolt

1. 在 Revolt 客户端「设置 → My Bots」创建机器人，记录机器人用户 ID 与 Token。
2. 把机器人邀请到服务器并授予发送消息权限。
3. 管理台新增账号 → 协议选 Revolt → 填写机器人用户 ID 与 Bot Token；自建实例可另填 API 与 WebSocket 地址。
4. 会话外部 ID 使用频道 ID。

说明：

- 服务连接 Bonfire WebSocket 并每 20 秒发送 Ping，`Ready` 事件中的频道类型用于区分私聊与服务器频道。
- 频道内需要 @ 机器人才触发；私聊直接回复。
- 文件先上传到 Autumn 附件服务，再按附件消息发送。

## Mastodon

1. 在实例的「开发 → 新建应用」创建应用，授予 `read:statuses` 与 `write:statuses`，记录访问令牌。
2. 记录机器人账号的本地数字 ID。
3. 管理台新增账号 → 协议选 Mastodon → 填写实例地址、账号 ID 和访问令牌。
4. 会话外部 ID 形如 `acct:user@instance`。

说明：

- 服务连接 `/api/v1/streaming?stream=user`，处理 `update` 事件。
- 回复会 @ 作者；私信使用 `direct` 可见性，公开提及使用 `unlisted`。
- 文本按 Mastodon 默认 500 字符截断；媒体先上传到 `/api/v2/media`。
- 访问令牌会出现在 WebSocket 查询参数中，请使用专用令牌并定期轮换。

## Instagram Messaging

1. 在 Meta 开发者后台把 Instagram 专业账号与 Facebook 主页绑定，并授予 `instagram_manage_messages`。
2. 把 Callback URL 设为 `https://<domain>/webhook/instagram`，填写 Verify Token，订阅 `messages`。
3. 管理台新增账号 → 协议选 Instagram Messaging → 填写 Instagram 账号 ID、Page Access Token、App Secret 和 Verify Token。

说明：

- 回调结构与 Messenger 相同，服务按 `entry.id` 匹配账号并用 `X-Hub-Signature-256` 校验。
- 仅支持一对一文本回复；媒体需要公网 HTTPS URL，当前不支持。

## Viber

1. 在 Viber 管理后台创建机器人，记录 Auth Token，并把 Webhook 设为 `https://<domain>/webhook/viber`。
2. 管理台新增账号 → 协议选 Viber → 填写 Auth Token 与机器人名称。
3. 会话外部 ID 使用 Viber 用户 ID（`sender.id`）。

说明：

- 服务用 Auth Token 对原始请求体计算 HMAC-SHA256，并与 `X-Viber-Content-Signature` 比对。
- 仅支持一对一文本；媒体需要公网 URL，当前不支持。

## Misskey

1. 在 Misskey 的「设置 → API」创建访问令牌，勾选发帖与查看权限；记录实例地址、机器人 userId 和令牌。
2. 管理台新增账号 → 协议选 Misskey → 填写实例地址、机器人用户 ID 和访问令牌。
3. 会话外部 ID 为 `channel:<channelId>` 或 `user:<userId>`。

说明：

- 服务连接 `/streaming?i=<token>` 并订阅 `main` 频道，每 30 秒发送 ping。
- 私信（`specified`）直接回复；公开帖子需要 @ 机器人或回复机器人的帖子。
- 文件先上传到 `/api/drive/files/create`，再按 `fileIds` 发帖。
- 令牌会出现在 WebSocket 查询参数中，请使用专用令牌。

## 飞书 / Lark

1. 在[飞书开放平台](https://open.feishu.cn/)创建企业自建应用，记录「凭证与基础信息」中的 App ID 和 App Secret。
2. 在「事件与回调 → 事件配置」把请求地址设为 `https://<domain>/webhook/feishu`，订阅 `im.message.receive_v1`。
3. 在「权限管理」开通接收消息与发送消息所需权限（例如 `im:message`、`im:message:send_as_bot`），并发布应用版本。
4. 把机器人添加到目标群，或在单聊中发起会话。
5. 在管理台账号凭据中填写 App ID、App Secret、Verification Token；如果后台启用了 Encrypt Key，也一并填写。

说明：

- 未配置 Encrypt Key 时只接收明文事件；配置后同时校验 `X-Lark-Signature` 并解密事件。
- 私聊会话的外部 ID 是飞书的 `chat_id`，群聊同样以 `chat_id` 区分。
- 回复支持文本、图片和文件；其他媒体按文件发送。

## 钉钉机器人

1. 在[钉钉开放平台](https://open.dingtalk.com/)创建企业内部应用，添加机器人，消息接收模式选择 HTTP 回调。
2. 回调地址填写 `https://<domain>/webhook/dingtalk`。
3. 记录 AppKey（Client ID）与 AppSecret（Client Secret）；需要定时任务等主动消息时，再填写机器人 RobotCode。
4. 发布应用并把机器人添加到群聊或单聊。

说明：

- 回调使用 `timestamp` 与 `sign` 校验，签名基于 AppSecret；服务会遍历已配置的钉钉账号匹配唯一密钥。
- 普通回复通过回调携带的 `sessionWebhook` 发送，不需要 RobotCode。
- 定时任务等主动文本消息使用钉钉机器人 API，需要 RobotCode 与 `openConversationId`（群聊外部 ID）或用户 ID（私聊）。
- 钉钉机器人回调不支持主动媒体消息；图片、语音、视频和文件工具在钉钉会话中会返回不支持错误。

## 微信公众号

1. 在公众号后台「开发 → 基本配置」记录 AppID 与 AppSecret，并把服务出口 IP 加入 IP 白名单，否则无法获取 `access_token`。
2. 在「开发 → 基本配置 → 服务器配置」填写 URL `https://<domain>/webhook/wechat`、自定义 Token，消息加解密方式选择**明文模式**。
3. 在管理台账号凭据中填写 AppID、AppSecret 和同一个 Token。
4. 提交服务器配置时，微信会发起 GET 校验；服务会按 Token 计算 SHA1 签名并回显 `echostr`。

说明：

- 仅支持明文模式，不支持安全模式（AES 加密回调）。
- 公众号消息按私聊处理，用户 openid 同时作为会话外部 ID。
- 回复通过客服消息接口发送，支持文本、图片、语音和视频；客服消息不支持文件类型，且有 48 小时交互窗口限制。
- Cloudflare Workers 等 Serverless 平台的出口 IP 不固定，可能无法满足公众号 IP 白名单；上线前请先用测试账号验证 `access_token` 能否获取。

## 会话与主动消息

- 群聊和私聊的外部 ID 由各平台提供，先用 `/openid` 命令获取，再写入「群聊管理」。群聊记录可绑定多个外部 ID，但上下文按真实会话隔离。
- 定时任务的 `message` 动作会按账号协议主动发送文本；`prompt` 和 `command` 动作会把合成消息交给聊天运行时。QQ 在配置 `QQ_GATEWAY_SESSIONS` 时优先投递到 Gateway，其他平台直接在本进程执行。
- 需要主动消息的平台必须在账号凭据中提供对应能力：钉钉需要 RobotCode，微信公众号需要可用的 `access_token` 与交互窗口，飞书需要有效的应用权限，OneBot 需要可用的 HTTP API，Telegram 需要有效的 Bot Token，Slack 需要 `chat:write`，LINE 需要 Channel Access Token，WhatsApp 受 24 小时窗口限制，Mattermost 需要可创建帖子的访问令牌，Zulip 需要机器人 API Key，Rocket.Chat 需要 Auth Token，VK 需要社区令牌，Mastodon 需要 `write:statuses`。

## 与 NoneBot2 适配器的对应关系

下表只对照 NoneBot2 的聊天协议适配器，不包含社区插件（如 GitHub、B 站、Minecraft 等）。社区插件通常面向具体业务或需要常驻进程，不是通用聊天协议，本项目不逐一适配。

| NoneBot2 适配器 | 本项目支持 | 说明 |
| --- | --- | --- |
| OneBot | ✅ | `/webhook/onebot`，HTTP 上报 + HTTP API |
| Telegram | ✅ | `/webhook/telegram` |
| 飞书 | ✅ | `/webhook/feishu` |
| QQ | ✅ | `/webhook/qq` 或 Cloudflare WebSocket Gateway |
| Red | ✅ | 通过 OneBot HTTP 上报接入 |
| Mirai | ⚠️ | 通过 Mirai 的 OneBot 插件接入；原生 `mirai-api-http` 未实现 |
| GitHub | ❌ | 事件驱动的代码托管适配器，不是通用聊天协议；需要单独设计 issue/PR 会话语义 |
| Console | ❌ | 本项目有管理台和会话管理，但不提供模拟聊天入口 |
| Satori | ✅ | `/v1/events` WebSocket + `/v1/message.create`，需要 Cloudflare Durable Object |
| Discord | ✅ | Gateway v10 WebSocket，需要 Cloudflare Durable Object |
| DoDo | ✅ | Gateway WebSocket + 开放接口，需要 Cloudflare Durable Object |
| Kritor | ❌ | 独立 WebSocket/TCP 标准，未实现 |
| Milky | ❌ | 独立 WebSocket 标准，未实现 |
| 钉钉 / 企业微信 / 微信公众号 / Slack / LINE / WhatsApp / Mattermost | ✅ | 本项目额外支持的原生 Webhook 协议，见上文 |
| Facebook Messenger / Instagram / Viber / VK / Zulip / Rocket.Chat | ✅ | 本项目额外支持的原生 Webhook 协议，见上文 |
| Matrix / Revolt / Mastodon / Misskey | ✅ | 长连接或轮询接入，需要 Cloudflare Durable Object |
| KOOK | ✅ | Gateway WebSocket + REST，需要 Cloudflare Durable Object |

## 常见聊天软件支持情况

| 平台 | 状态 | 说明 |
| --- | --- | --- |
| QQ / QQ 频道 | ✅ | 官方机器人 Webhook 或 Cloudflare Gateway |
| 企业微信 | ✅ | 自建应用一对一消息；应用回调不接收群聊 |
| 微信个人号 | ❌ | 官方未提供机器人 API，第三方协议不稳定且有封号风险 |
| 钉钉 / 飞书 | ✅ | 见上文 |
| Telegram / Discord / Slack / WhatsApp / LINE / KOOK / Mattermost | ✅ | 见上文各自限制 |
| DoDo | ✅ | Gateway WebSocket + 开放接口 |
| Matrix | ✅ | `/sync` 长轮询；仅未加密房间 |
| Microsoft Teams | ⏳ | Bot Framework JWT 校验，计划中 |
| Google Chat | ⏳ | 需要 Google JWT 校验，计划中 |
| VK | ✅ | Callback API |
| Mastodon | ✅ | 用户流 WebSocket |
| Misskey | ✅ | 流式 API WebSocket |
| Zulip / Rocket.Chat | ✅ | 传出 Webhook + REST |
| Revolt | ✅ | Bonfire WebSocket |
| Instagram | ✅ | 专业账号一对一消息 |
| Threads | ❌ | 无通用机器人消息 API |
| Viber | ✅ | 机器人 Webhook |
| Signal | ❌ | 无官方 Bot API |
| 抖音 / 小红书 | ❌ | 无公开通用机器人 API |

## 排查

- **回调校验失败**：核对 Token/Verification Token/AppSecret 是否与管理台一致，以及回调地址是否使用了部署域名。
- **收到消息但没有回复**：检查账号是否启用、插件是否启用、会话是否绑定并启用、白名单与 owner 设置，以及平台发送权限。
- **签名通过但事件被忽略**：检查事件订阅类型、机器人是否在群内、消息类型是否受支持。
- **媒体发送失败**：不同平台限制不同；钉钉回调不支持媒体，微信公众号不支持客服文件，QQ 富媒体上限 5 MB；OneBot 受实现和 QQ 限制，Telegram 支持图片/音频/视频/文件，Slack 需要 `files:write`，LINE 只发送文本，WhatsApp 先上传媒体，Mattermost 走文件接口。
