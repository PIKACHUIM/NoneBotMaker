# 系统设计

## 架构概览

```text
管理浏览器 ──静态资源──> 平台入口 / ASSETS
     │                       │
     └──管理 API + session──> Hono API Router
                              ├──账号/插件/策略管理
QQ/OneBot/Telegram/Slack/LINE/WhatsApp/飞书/钉钉/Mattermost/微信 ──Webhook──> ├──认证/初始化/日志/会话运行路由
                              └──各平台签名校验与消息归一化
                                         │
                                  Chatbot Runtime
                              ├──策略与权限解析
                              ├──AI Provider 请求 / 多轮工具循环
                              ├──MCP / 搜索 / Skills / Memory
                              └──按协议回复与媒体发送
                                         │
                ┌────────────────────────┴────────────────────┐
                │ 持久化适配器                                 │ 外部服务
                │ D1 / KV / Blob / Durable Object              │ 各平台 / AI / MCP
                └─────────────────────────────────────────────┘
```

该图表示主要逻辑路径，不意味着所有平台支持同一能力。应用入口见 `src/server/app.ts`；运行平台只负责把平台 bindings 映射成 `RuntimeBindings` 并将请求交给共享应用。

## 请求与模块边界

1. **平台入口**：`src/platform/cloudflare/worker.ts`、`src/platform/edgeone/entry.ts`、`src/platform/esa/entry.ts` 及 `src/server/local.ts` 建立平台环境。Cloudflare Worker 另外处理静态资源、Gateway Durable Object 维护和 scheduled 日志清理。
2. **共享应用**：`src/server/app.ts` 挂载 `/api` 管理路由与 `/webhook/qq`、`/webhook/feishu`、`/webhook/dingtalk`、`/webhook/wechat` 回调。应用 middleware 识别 `API_METHOD`，非 Cloudflare 平台拒绝 WebSocket 模式。
3. **管理 API**：`src/server/routes/index.ts` 统一认证和路由注册；插件、账号、群聊策略、供应商、价格、日志和会话状态由各 route 管理。管理 API 在服务端执行 session、同源与作用域校验。
4. **平台接入**：`src/server/protocols/` 按协议拆分。QQ 校验 Ed25519 签名并按 AppID 定位账号；OneBot 校验可选的 HMAC-SHA1 上报签名并按 self_id 定位账号；Telegram 用 secret_token 定位账号；Slack 校验 X-Slack-Signature 并按 App ID 定位账号；LINE 用 Channel Secret 签名定位账号；WhatsApp 校验 X-Hub-Signature-256 并按 Phone Number ID 定位账号；Mattermost 用传出 Webhook Token 定位账号；飞书校验签名、解密事件并按 App ID 定位账号；钉钉用 timestamp/sign 匹配账号；微信公众号用 Token/SHA1 校验。归一化后的消息进入同一聊天处理链。
5. **聊天执行链**：`src/server/plugins/chatbot/runtime.ts` 组装持久化 stores 和 handler；`handler.ts` 解析会话策略与权限，调用 provider，执行允许的工具，然后通过 `protocols/sender.ts` 按账号协议发送回复。
6. **数据访问**：业务逻辑通过 repository/store 接口读取配置、上下文、成本、日志和媒体素材；平台 adapter 隔离具体存储 API。

## 配置与数据作用域

```text
插件配置
  └── 平台账号（按协议保存 AppID/AppSecret、Token 等，关联插件）
       └── 群聊/私聊策略（外部会话 ID、模型、权限、提示和预算）
            └── 会话运行状态 / 上下文 / 会话记忆
```

账号共享角色卡/项目记忆与会话记忆分开管理。服务端通过账号 ID、策略 ID、外部会话 ID、会话类型和平台用户身份进行范围校验，不能把前端选择值当作授权依据。

## 持久化策略

`src/server/storage/repository.ts` 按可用 bindings 选择记录仓库：D1 优先；EdgeOne 可使用 Blob 或 KV；ESA 使用 `ESA_KV` 或 `KV`；通用 KV 作为后备。没有可用的持久化 binding 时抛出 `StorageUnavailableError`。

| 平台 | 记录仓库 | 重要差异 |
| --- | --- | --- |
| Cloudflare Workers | D1，或运行环境提供 KV | D1 提供关系数据与迁移；`QQ_GATEWAY_SESSIONS` Durable Object 管理 Gateway 会话和队列。 |
| EdgeOne | EDGEONE_BLOB 优先，其次 EDGEONE_KV | Blob/KV 的一致性由存储服务提供；需配置上下文和成本 adapter 所需的 binding。 |
| 阿里云 ESA | ESA_KV 或 KV | 当前只支持 Webhook；不具备 Cloudflare Durable Object Gateway。 |
| 本地 Node | 当前入口提供环境变量，不自动创建数据库 binding | 需要真实存储 binding 的管理/运行功能不能因启动本地 API 就视为完成。 |

成本检查和实际 usage 累计并非跨平台统一事务。D1 可进行原子累计；KV/Blob adapter 的一致性取决于平台语义，并发处理仍可能产生预算超额。

## 聊天处理流程

1. 收到平台 Webhook，按协议验证签名并解析账号与事件。
2. 根据平台账号和群聊/私聊外部 ID 查找已保存策略；校验启用状态、访问白名单和限流条件。
3. 读取上下文、提示词、Skills/Rules、角色卡、记忆和模型价格，生成 provider 请求。
4. 按所选 API 与模型声明的媒体能力转换消息；不支持的附件不会宣称已读。
5. 处理 AI 文本或工具调用。内置工具受策略和身份控制；外部 MCP 工具由管理员 allowlist 与 owner 审批策略约束。
6. 收集模型 usage 并累计费用，保存上下文和日志（日志仅在启用时）。
7. 依据模式、平台限制和消息分段策略发送文本/媒体回复。

Cloudflare WebSocket Gateway 由 Durable Object 保持 QQ Gateway 连接；Webhook 模式在 Cloudflare 也使用相应对象处理持久化队列、去重和出站限流。EdgeOne/ESA 当前只支持 Webhook。

## 安全信任边界

- **可信配置**：只有经过管理员 session 验证并由后端校验的数据才构成授权策略。
- **平台输入**：各平台回调必须通过对应的签名或 Token 校验；用户与会话 ID、消息内容都是外部输入。
- **AI 与外部工具**：模型输出、搜索结果、MCP 参数和工具返回值均不可信；远端 `readOnlyHint` 不能独立证明安全。
- **凭据**：`SYS_PASSWD`、`SYS_SECRET` 和供应商/平台凭据不得写入公开配置。敏感账号/provider 凭据由 `SYS_SECRET` 加密。
- **副作用**：审批调用需要权限与持久化认领；外发消息、媒体和主动唤醒受会话权限及平台限制约束。

## 设计边界

本架构把 NoneBot 风格事件调度行为移植为 TypeScript Worker 逻辑；它不是 Python 运行时，也不会加载任意 Python 插件、driver/adapter、本地 shell 或语音引擎。平台的存储一致性、媒体 API、网络出口和计费能力不同，部署文档应按目标平台核对。
