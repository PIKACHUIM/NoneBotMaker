# 项目需求

> **规格状态：实现反推，未独立产品签字。** 仓库没有单独维护的正式产品需求规格；以下条目根据当前代码、配置、测试和 README 整理，用于说明当前交付范围，不代表未来承诺。需要改变产品行为时，请先补充明确场景和验收标准。

## 目标与用户

NoneBotMaker 为 QQ 官方机器人提供 Serverless 管理与聊天执行服务。管理员通过 Web 管理台维护插件、AI 供应商、机器人账号和群聊/私聊策略；QQ 用户在平台允许的会话内与机器人交互。代码以 TypeScript 实现，在不同运行平台复用 Hono 应用逻辑。

## 功能需求与当前状态

| ID | 需求 | 当前实现与验证线索 |
| --- | --- | --- |
| FR-01 | 管理员登录后管理应用配置 | 密码验证与签名 session；管理 API 要求有效 session。`src/server/routes/index.ts`、`src/server/auth.ts` 与对应测试。 |
| FR-02 | 按插件、平台账号、群聊/私聊策略分层配置 | 插件字段声明驱动表单；账号持有平台凭据；策略设置外部 OpenID、AI 和权限。`src/shared/plugin-catalog.ts`、`src/server/routes/management.ts`。 |
| FR-03 | 接收并验证 QQ Webhook 事件 | `/webhook/qq` 按 AppID 定位账号并验证签名，然后将规范化消息交给聊天处理链。`src/server/protocols/qq/webhook.ts`、`signature.ts`。 |
| FR-04 | 使用兼容 AI API 生成回复并支持工具调用 | 聊天运行时支持多轮工具循环、流式/非流式响应、费用统计和出站消息。`src/server/plugins/chatbot/handler.ts`、`provider.ts`。 |
| FR-05 | 控制工具、MCP、搜索、Skills/Rules 与记忆能力 | 工具按会话权限构建；MCP 管理 allowlist 与 owner 审批；会话/账号共享记忆区分作用域。`src/server/plugins/chatbot/tools.ts`、`knowledge.ts`、`approval.ts`。 |
| FR-06 | 支持媒体、语音、唤醒与会话命令 | 具体能力受 QQ 权限、插件配置、provider/model 能力及平台存储支持约束。`handler.ts`、`media.ts`、`src/platform/cloudflare/qq-do.ts`。 |
| FR-07 | 持久化设置、上下文、日志与计划数据 | Cloudflare D1/KV/DO、EdgeOne Blob/KV、ESA KV adapters；存储不可用时不承诺跨请求持久状态。`src/server/storage/`。 |
| FR-08 | 面向多个 Serverless 平台复用服务逻辑 | Cloudflare Worker、EdgeOne、ESA 与本地 Node 入口均调用共享 `src/server/app.ts`。平台能力并不完全相同。 |
| FR-09 | 对敏感管理操作实施鉴权和信任边界 | session/同源校验、凭据加密、QQ 签名检查、工具权限与审批；日志默认关闭。 |
| FR-10 | 提供中英文管理台和项目文档 | 管理台使用 i18n；VitePress 项目文档提供简体中文与英文。 |

## 关键场景验收

1. 未认证请求访问管理 API 时返回未授权；认证后仅能在管理台暴露的配置域执行管理操作。
2. QQ Webhook 只有通过签名验证、AppID 可定位账号且账号/策略满足条件时才进入聊天处理链。
3. 管理员添加账号和有效会话策略后，该策略可在会话管理列表查看；历史 QQ 聊天不会自动被发现。
4. AI 请求遵守模型、媒体能力、费用单价、预算和会话工具权限；没有价格依据时不得把请求当作零费用。
5. 未明确受信任的 MCP 工具进入审批流程，审批结果持久化后再继续执行；无法安全原子认领时不开放待审批执行。
6. 缺失持久化 binding 时，服务报告配置错误，不以进程内临时状态伪装为可靠持久化。
7. `LOG_RECORD` 默认为关闭；开启后日志按设定保留期处理，并通过平台定时任务或受保护接口清理。
8. EdgeOne 和 ESA 不支持 WebSocket Gateway 模式，配置该模式时服务明确报告不支持。

## 非功能要求

- **安全**：秘密不进前端普通字段、公开仓库或日志；管理接口必须鉴权；外部模型、搜索和 MCP 内容均视为不可信输入。
- **隔离**：账号、会话、会话记忆与账号共享记忆保持各自作用域，跨作用域操作由服务端校验。
- **可移植**：共享业务逻辑不得假设每个边缘平台都有相同的数据库事务、KV 一致性或 Durable Object 能力。
- **可验证**：主要逻辑以 Vitest 单元/路由/平台测试和 TypeScript 类型检查覆盖；真实外部平台测试另行执行。
- **成本透明**：费用基于已登记模型价格和实际 usage；KV/Blob 一致性与并发预算超额限制需在产品使用中明确。

## 明确不包含的兼容承诺

- 不支持直接导入和执行任意 Python NoneBot 插件、Python driver/adapter 或依赖 Python 运行时的生态。
- 不提供 Worker 内任意本地 shell、通用本地文件系统或 `pyttsx3` 执行能力。
- TypeScript dispatcher 是行为移植，不承诺与上游 Python NoneBot 完全等价。
- 外部 QQ 消息、主动发送/媒体权限、具体 AI/Brave/TTS 供应商行为必须用真实账号和服务验证；mock 测试不能替代联调。

## 主要来源

- 应用与路由：`src/server/app.ts`、`src/server/routes/index.ts`
- QQ 协议：`src/server/protocols/qq/`
- 聊天链：`src/server/plugins/chatbot/`
- 持久化：`src/server/storage/`、`src/platform/cloudflare/qq-do.ts`、`migrations/`
- 运行平台入口：`src/platform/cloudflare/worker.ts`、`src/platform/edgeone/entry.ts`、`src/platform/esa/entry.ts`、`src/server/local.ts`
- 共享配置/类型：`src/shared/`
