# 聊天平台接入

NoneBotMaker 通过各平台官方 Webhook/API 接收和发送消息，不运行 NoneBot、Koishi 或 NapCat 运行时。所有平台共用同一套账号、会话策略、AI 供应商、工具、记忆和费用管理。

## 通用步骤

1. 在「运行平台 → 插件管理」确认群聊助手插件已启用。
2. 在「运行平台 → 平台账号」新增账号，选择平台协议并填写该协议凭据。
3. 在对应平台后台把回调地址设置为管理台显示的 URL。
4. 在「群聊管理」绑定账号与会话外部 ID，并选择身份策略和对话策略。
5. 在测试会话中发送 `/openid` 获取真实的用户与会话 ID，再回到管理台核对绑定。

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
- 需要主动消息的平台必须在账号凭据中提供对应能力：钉钉需要 RobotCode，微信公众号需要可用的 `access_token` 与交互窗口，飞书需要有效的应用权限，OneBot 需要可用的 HTTP API，Telegram 需要有效的 Bot Token。

## 与 NoneBot2 适配器的对应关系

下表对照 NoneBot2 文档中的协议适配器，说明本项目当前的原生支持情况：

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
| Satori | ❌ | 基于 WebSocket 的协议，不适合无状态 Webhook；Cloudflare 可另用 Durable Object 做长连接 |
| Discord | ❌ | 普通消息需要 Gateway；仅实现 interactions 无法覆盖日常聊天 |
| DoDo | ❌ | Bot 长连接协议，未实现 |
| Kritor | ❌ | 独立 WebSocket/TCP 标准，未实现 |
| Milky | ❌ | 独立 WebSocket 标准，未实现 |
| 钉钉 / 微信公众号 | ✅ | 本项目额外支持，见上文 |

## 排查

- **回调校验失败**：核对 Token/Verification Token/AppSecret 是否与管理台一致，以及回调地址是否使用了部署域名。
- **收到消息但没有回复**：检查账号是否启用、插件是否启用、会话是否绑定并启用、白名单与 owner 设置，以及平台发送权限。
- **签名通过但事件被忽略**：检查事件订阅类型、机器人是否在群内、消息类型是否受支持。
- **媒体发送失败**：不同平台限制不同；钉钉回调不支持媒体，微信公众号不支持客服文件，QQ 富媒体上限 5 MB；OneBot 受实现和 QQ 限制，Telegram 支持图片/音频/视频/文件。
