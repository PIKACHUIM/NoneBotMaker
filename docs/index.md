---
layout: home
hero:
  name: NoneBotMaker
  text: QQ 官方机器人 Serverless 服务
  tagline: 管理机器人账号、会话策略与 AI 聊天能力，部署到 Cloudflare Workers、EdgeOne 或阿里云 ESA。
  actions:
    - theme: brand
      text: 快速部署
      link: /guide/quick-start
    - theme: alt
      text: 查看系统设计
      link: /design/architecture
    - theme: alt
      text: GitHub
      link: https://github.com/PIKACHUIM/NoneBotMaker
features:
  - title: 多账号与会话策略
    details: 从插件、QQ 平台账号到群聊/私聊策略分层管理，按会话选择模型、工具和权限。
  - title: AI 工具执行
    details: 支持 OpenAI-compatible API、多轮工具调用、MCP、联网搜索、Skills/Rules 与会话记忆。
  - title: Serverless 存储
    details: 适配 Cloudflare D1/KV、EdgeOne Blob/KV 与阿里云 ESA KV；持久化缺失时明确报错。
  - title: 管理台与安全边界
    details: 双语管理台、管理员鉴权、QQ 回调签名校验、工具审批和会话范围校验。
  - title: 多运行平台
    details: 共用 Hono 应用逻辑，提供 Cloudflare Worker、EdgeOne、ESA 与本地 Node 入口。
  - title: TypeScript 行为移植
    details: 提供 Worker 内的事件调度实现；不等同于可原样加载任意 Python NoneBot 插件或驱动。
---

## 界面预览

![NoneBotMaker 管理台运行总览](./index.png)

## 文档导航

- [快速部署](/guide/quick-start)：准备存储资源、密钥、迁移并配置 QQ Webhook。
- [管理台使用教程](/guide/user-guide)：创建 AI 供应商、账号、会话策略并管理工具和记忆。
- [项目需求](/design/requirements)：基于当前实现整理的功能需求与限制。
- [系统设计](/design/architecture)：模块边界、消息数据流、持久化和信任边界。
- [本地开发与测试](/development/setup) 与 [多平台部署](/development/deployment)。

> 需求与架构文档依据当前代码、配置和测试整理；尚无独立产品签字确认的正式规格。真实 QQ、AI、Brave 与 TTS 外部服务仍需使用真实账号和凭据联调。
