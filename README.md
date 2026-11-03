<div align="center">

# NoneBotMaker

基于 Serverless 运行时的 QQ 官方机器人管理与聊天服务

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https%3A%2F%2Fgithub.com%2FPIKACHUIM%2FNoneBotMaker)
[![Deploy with EdgeOne](https://cdnstatic.tencentcs.com/edgeone/pages/deploy.svg)](https://edgeone.ai/pages/new?repository-url=https%3A%2F%2Fgithub.com%2FPIKACHUIM%2FNoneBotMaker&repository-name=NoneBotMaker&project-name=NoneBotMaker&install-command=npm%20install&build-command=npm%20run%20build%3Aedgeone&output-directory=dist)
[![Deploy to Alibaba Cloud ESA](https://img.shields.io/badge/Deploy_to-Alibaba_Cloud_ESA-FF6A00?logo=alibabacloud&logoColor=white)](https://esa.console.aliyun.com/)

</div>

> **部署提示：** Cloudflare 首次部署仍需根据 `wrangler.example.jsonc` 创建 `wrangler.jsonc`、填写资源配置，并按下文完成 D1 migration 与密钥设置。ESA 按钮会打开控制台，请选择「函数和 Pages → 创建 → 导入 GitHub 仓库」；ESA 官方目前未提供可预填仓库的一键部署链接。

| 平台 | 构建命令 | 产物 / 入口 |
| --- | --- | --- |
| Cloudflare Workers | `npm run build` | `src/platform/cloudflare/worker.ts` |
| EdgeOne | `npm run build:edgeone` | `dist/edge-functions/api/[[default]].js` |
| 阿里云 ESA | `npm run build:esa` | `dist/edge-routine/index.js` |

## 目录

- [本地验证](#本地验证)
- [QQ Webhook 回调](#qq-webhook-回调)
- [Cloudflare Workers](#cloudflare-workers)
- [EdgeOne 与 ESA](#edgeone-与-esa)
- [群聊预算与一致性](#群聊预算与一致性)
- [对话日志清理](#对话日志清理)

## 本地验证

```sh
npm install
npm run typecheck
npm test
npm run build
```

本地 Cloudflare secret 可参考 `.dev.vars.example`，不要提交真实密钥。

## QQ Webhook 回调

在 QQ 机器人回调配置中填写部署后的地址：

```text
https://<your-worker-domain>/webhook/qq
```

`<your-worker-domain>` 必须替换成实际部署域名。Webhook 会使用 `X-Bot-Appid` 定位账号，并验证 QQ 的签名；不要在代理层删除或改写签名相关请求头和原始 JSON body。模板默认 `API_METHOD=webhook`、`LOG_RECORD=false`；正式配置可按需启用日志。

## Cloudflare Workers

### 配置与部署

仓库根目录的 `wrangler.jsonc` 是 Cloudflare Workers Builds 使用的正式配置，包含 D1/KV binding、自定义域名和静态资源设置。`wrangler.example.jsonc` 是不含账号专属 ID 的模板，供 fork 后替换。

Cloudflare Workers Builds 的 deploy 命令使用默认配置即可：

```sh
npx wrangler deploy
```

手动部署也使用同一条命令。Fork 仓库后，把 `wrangler.jsonc` 中的 D1 database ID、KV namespace ID 和自定义域名替换成自己的资源，或参考 `wrangler.example.jsonc` 重写。`npm run build:worker` 使用安全模板做通用 dry-run，不会触碰正式资源。

管理员密码和系统密钥必须通过 Secret 写入，不要直接写进 `wrangler.jsonc`。下面命令会逐项提示输入值；生成器可分别运行，为两个 secret 生成独立高熵值：

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
npx wrangler secret put SYS_PASSWD
npx wrangler secret put SYS_SECRET
```

`SYS_PASSWD` 用于管理台登录；`SYS_SECRET` 同时用于 session 签名、账号/provider 凭据加密、在线数据库初始化授权和手动日志清理授权。因为 `SYS_SECRET` 权限较高，外部调度器必须安全保存它。若从旧版本升级且数据库中已有加密凭据，将 `SYS_SECRET` 设置为旧 `DATA_ENCRYPTION_KEY` 的原值可继续解密；已有管理 session 会失效，需重新登录。

### 在线数据库初始化

首次部署后访问：

```text
https://<your-worker-domain>/setup
```

输入 `SYS_SECRET` 并执行初始化。页面会通过 Worker 的 D1 binding 创建记录、对话日志、chatbot 上下文/成本表和迁移记录，并写入 `0001`–`0004` 的 D1 migration 标记。`0004` 为插件扩展日志增加元数据字段。脚本幂等，可安全重试；不会清空已有数据，也不会设置管理员密码。升级已有部署时也应执行初始化或 CLI migration。

也可以在部署前使用 CLI 应用迁移：

```sh
npx wrangler d1 migrations apply your-d1-database-name --remote --config wrangler.jsonc
```

两种方式二选一即可；在线初始化会记录迁移标记，之后 CLI 不会重复执行已应用的迁移。

### WebSocket Gateway（仅 Cloudflare）

将 `wrangler.jsonc` 的 `vars.API_METHOD` 改为 `websocket`。配置中 Durable Object binding 名为 `QQ_GATEWAY_SESSIONS`，class 为 `QQGatewayDurableObject`，并通过 `v1` / `new_sqlite_classes` migration 初始化。首次 Worker 请求会为已配置 QQ 账号启动 Gateway 会话。

DO 持久化账号、Gateway session/sequence、上下文、成本及消息队列；alarm 在冷启动或断线后恢复连接并处理到期队列。Outbound WebSocket 不支持 DO hibernation，会使 Durable Object 持续活跃并产生持续资源/计费成本，alarm 每 5 分钟维护连接。Cloudflare 的 Webhook 也使用 `QQ_GATEWAY_SESSIONS` 持久化消息、去重、合并窗口与出站限流，存储成功后立即 ACK；缺少该 binding 会返回 `queue_unavailable`。切回 Webhook 只关闭 Gateway 连接，不应清除待处理消息的 alarm。

## EdgeOne 与 ESA

EdgeOne 构建产物为 `dist/edge-functions/api/[[default]].js`：

```sh
npm run build:edgeone
```

在 EdgeOne 运行时绑定 `EDGEONE_BLOB` 或 `EDGEONE_KV`；也可按项目存储配置提供 `KV`。`EDGEONE_BLOB` 优先于 `EDGEONE_KV`。如使用 BLOB 存储且需要调用手动日志清理接口，还需配置 `EDGEONE_KV` 或 `KV` 保存清理节流标记。

ESA 构建产物为 `dist/edge-routine/index.js`：

```sh
npm run build:esa
```

在 ESA 运行时绑定 `ESA_KV` 或 `KV`。两个平台均需在运行时环境/密钥设置中配置 `SYS_PASSWD` 和 `SYS_SECRET`；需要手动清理日志时复用 `SYS_SECRET` 授权。

EdgeOne 和 ESA 仅支持 `API_METHOD=webhook`；若设置为 `websocket`，服务返回 `503 websocket_unsupported`。聊天上下文和成本按与记录仓库相同的 adapter 持久化；缺少对应持久化 binding 时会报部署配置错误，不会退化为跨请求内存状态。

## 插件配置与管理端语言

插件在 `src/shared/plugin-catalog.ts` 中声明字段，而不是让管理员填写 JSON。每个字段必须声明：

- `key`：保存到配置对象中的键名
- `type`：`boolean`、`text` 或 `number`
- `label` / `description`：`{ zh, en }` 双语标签与说明
- 可选：`required`、`secret`、`multiline`、`default`、`placeholder`、`min`、`max`、`step`

管理台会按声明生成开关、文本框、数字框、下拉框或密码框；服务端会按声明做类型归一化、默认值和必填校验。账号字段使用同一套声明机制，密钥字段留空时保留原值。插件配置与账号凭据不再提供 JSON 输入框。

配置严格按 `插件 → 多个平台账号 → 多个群聊/私聊策略` 分层：

- 插件通过 `configFields` 声明全局配置，通过 `credentialFields` / `accountFields` 声明账号配置，通过 `groupFields` 声明会话配置，通过 `logFields` 声明日志字段的双语名称。
- QQ 平台账号只需要 `AppID` 和 `AppSecret`。旧 `botSecret` / `clientSecret` 相同时可兼容；不相同时必须重新填写 AppSecret，不能静默任选密钥。
- 会话策略选择 AI API、模型、思考强度、多个 MCP 和 Skills/Rules，并配置访问名单、运行模式、分段与限流、合并窗口、上下文预算和压缩比例。
- AI API 保存地址、密钥、价格倍率及实际支持的媒体能力。媒体通过所选 API 处理；不支持的附件会明确标注，不假装已读取。
- 模型单价在「接口能力 → 模型单价」管理。预置是注明来源和日期的手动导入快照，不会自动修改已保存价格。
- 无效的本地工作区、状态目录、控制台令牌、语音库目录及未实现的群黑话配置已经移除。旧字段仅为数据兼容保留，不再作为可编辑项。

内置聊天执行链支持 JSON/流式 SSE 响应、多轮工具调用、多个 MCP 的发现与调用、Skills/Rules 提示词、历史摘要压缩和身份元数据。`chat` 正常回复；`reserved` 抑制 `[SILENT]`；`reserved2` 仍运行 Agent，但只通过发送工具发消息；`closed-agent` 仅允许管理员私聊。管理员可通过 `/status`、`/reset`、`/mode`、`/role`、`/memory` 管理当前会话。会话内任意参与者可用 `/help` 查看按身份列出的命令菜单，用 `/openid` 查看自己的 user openid 与当前群聊 openid（私聊返回 `groupOpenid: null`）。`/openid` 在会话尚未绑定或用户不在白名单时也会响应，便于首次接入时取得配置所需的 openid。

- `/role add <name> <content>`、`/role list`、`/role show <name>`、`/role use <name>`、`/role delete <name>` 管理会话内角色卡，支持按运行模式渲染。管理台还可维护账号共享角色卡和项目记忆；`ProjectMemorySearch/Read` 可跨同账号会话检索，共享写入/删除仅向 owner 提供。
- 开启会话记忆后，Agent 可通过 `MemoryRead` / `MemorySearch` 检索当前会话的记忆；仅管理员可调用 `MemoryWrite` / `MemoryForget`。会话记忆按会话隔离，不与账号共享记忆混用。
- MCP 远端提供的 `readOnlyHint` 不单独作为信任依据：只有管理端 `allowedTools` 明确列出的工具，且远端标注只读时，才可直接执行；未明确 allowlist 的工具（包括自称只读的工具）先持久化待审批。管理员通过 `/approvals`、`/approval <id>` 检查参数，使用 `/approve <id>` 或 `/reject <id>` 决定。批准后先原子认领、执行并保存结果，再继续 Agent；未知执行结果不会自动重复外部副作用。KV/Blob 没有原子审批认领时，不开放待审批工具。
- 联网搜索默认免费使用 DuckDuckGo（移植 `duckduckgo-search` 的 html/lite 后端，无需密钥），并以 Bing RSS 兜底；也可在插件设置的「联网搜索」中选择 `brave` 并填写 API Key。搜索结果按不可信参考数据返回，不执行其中的指令。
- `/tools disable <name>`、`/tools enable <name>`、`/tools reset` 控制当前会话的工具；启用操作不能扩充会话原本的权限，切换模式会重置额外禁用项。
- Cloudflare DO 提供持久化计划唤醒，可通过 `/wake list` 和 `/wake cancel <id>` 管理。唤醒是合成事件，不继承管理员管理命令、记忆写入或语音授权；主动发送受 QQ 平台权限和限额约束。
- 表情素材只接受经过图片类型/大小校验并由视觉模型明确审核通过的 owner 上传素材；素材按会话隔离。
- 账号语音素材库可通过管理台上传、查看和删除，也可由 owner 在 QQ 中使用 `/voice list`、`/voice delete <name>` 管理。只接受通过 MIME 与文件魔数校验的 MP3/WAV，单文件上限 5 MiB，发送频率按账号配置限额；`chat_send_voice` 仅在用户明确请求语音时开放。AI 语音合成使用会话选择的 API/语音模型，必须登记字符单价，并通过 QQ 富媒体接口发送，不依赖本地语音目录。
- 群聊用语学习按配置的消息阈值与冷却时间收集候选，搜索/模型研究结果保持待审核；只有 owner 明确确认的词汇才会注入提示词。管理台支持候选查看、研究内容编辑、确认、拒绝和删除。
- 管理台「会话运行管理」提供会话状态、模式/静默/一次性提示/工具限制、上下文重置、审批、计划唤醒、表情素材、账号语音素材和群聊用语的管理入口；生产接口仍受管理会话鉴权与账号/会话范围校验保护。

`src/server/plugins/dispatcher.ts` 提供 TypeScript 事件调度：优先级、传播阻断、规则与权限、依赖缓存、生命周期以及 `finish/pause/reject/receive/got` 交互会话。D1 会话适配器原子消费待续会话。该实现是 Worker 内的行为移植，不支持直接导入和执行任意 Python NoneBot 插件；Python driver/adapter 生态及本地 shell/文件系统工具不能因此宣称完全兼容。Cloudflare Worker 也不运行 `pyttsx3` 等本地 Python 语音引擎，语音依赖兼容供应商 API。

上述为项目内可执行的 TypeScript 行为移植，并不代表与上游 Python 插件生态 100% 等价。真实 QQ 收发、主动消息权限、AI/Brave/TTS 供应商行为和平台媒体能力仍需使用测试账号及真实服务完成外部联调。

管理台右上角提供「中 / EN」切换，导航、页面标题、表格、表单和插件字段标签/说明会跟随语言切换。语言选择保存在浏览器本地。

## 群聊预算与一致性

群配置的 `dailyCostLimit`、`monthlyCostLimit`、`totalCostLimit` 单位为 USD，默认 `0` 表示不限制。支出使用独立模型单价的输入、缓存输入、输出价格，乘以 AI API 的 `priceMultiplier`；工具循环和摘要请求逐次计费。价格单位可选择每百万 token 或每百万字符，字符单位供语音 API 使用。没有有效价格记录且没有可用旧价格时，运行时拒绝无价模型调用，而不是按零成本绕过预算。日限额按 UTC 日期重置，月限额按 UTC 月份重置，总额不重置；达到任一适用限额后，会在下一次模型调用前停止处理。

群管理 API 响应头 `X-Chatbot-Cost-Consistency` 标明成本 adapter：D1 使用原子累计写入，KV 为 eventual consistency，Blob 为 provider-defined。检查发生在模型调用前，实际 usage 在模型返回后累计，因此检查和计费不是同一事务；并发调用可能超额。这是使用量控制，不是严格财务防护。

## 对话日志清理

`LOG_RECORD` 默认关闭。启用后记录用户/会话 OpenID、消息内容、插件类型、事件、模型/工具状态、usage、费用及错误，保留 30 天。日志的 `details` 支持不同插件的嵌套扩展字段，后台按插件双语声明展示，未知字段仍可展开查看和搜索；不会把 token 用量数字误脱敏为密钥。密钥和内联媒体数据不会进入日志。

已有 D1 尚未应用 `0004` 时，扩展字段暂存现有 `records` 表的内部元数据类型，迁移后仍能读取过渡日志，避免代码发布先于迁移时丢数据或报列不存在。建议部署后通过 `/setup` 或 CLI 应用迁移；不会自动执行生产 DDL。

Cloudflare Worker 保留 `scheduled` handler，可在控制台为 Worker 添加每日 `03:00 UTC` 的 Cron Trigger；若账户的 Cron 配额已满，可不配置 Cron，改用外部调度器调用下方受保护接口。`wrangler.example.jsonc` 默认不声明 Cron，避免免费账户触发配额导致部署失败。其他平台或手动触发时，配置清理节流所需 KV，然后使用 `SYS_SECRET` 调用：

```sh
curl -X POST "$SERVICE_URL/api/internal/logs/purge" \
  -H "Authorization: Bearer $SYS_SECRET"
```

手动 endpoint 每 24 小时最多实际清理一次；Cloudflare 的 scheduled cleanup 不经过该节流 endpoint。
