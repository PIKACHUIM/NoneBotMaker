# 对话日志保留与清理

日志记录的 `expiresAt` 最长设置为 30 天；列表查询会立即隐藏已过期记录，物理删除由单独的清理任务负责。`LOG_RECORD` 默认关闭。启用前应确认日志内容、访问权限、保留期限和平台计费。

## Cloudflare Workers

Worker 暴露 `scheduled` handler。若账户 Cron 配额允许，可在 Cloudflare 控制台为 Worker 添加每日 `03:00 UTC` 的 Cron Trigger。该路径调用 `runScheduledConversationLogCleanup(bindings, now)`，再委托 `purgeExpiredLogs(bindings, now)`；使用日志仓库直接清理，不依赖 KV 节流 binding。D1 通过 `expires_at` 索引删除，Cloudflare KV 记录也有原生 TTL。

若 Cron 配额已满，可用外部调度器调用受保护的清理 endpoint。

## EdgeOne

仓库采用的 EdgeOne schedule schema 文档支持 `name`、`cron`、`path`、`method`、`payload` 和 `timezone`，但未记录请求 headers 或 secret/environment 插值。不要把 `SYS_SECRET` 放进已提交的 schedule payload 或 URL，也不要添加未认证清理入口。

应使用能安全保存 Secret 并发送 Authorization header 的外部/控制台调度器，调用 `POST /api/internal/logs/purge`，并配置 `SYS_SECRET` 与清理 KV（`LOG_CLEANUP_KV`、`EDGEONE_KV` 或 `KV`）。该 endpoint 对每个清理 KV namespace 每 24 小时最多执行一次。

## 阿里云 ESA 与本地部署

仓库没有配置 ESA 定时运行时 handler。使用支持安全注入 Authorization header 的外部调度器调用同一受保护 endpoint，并配置清理 KV binding 与 `SYS_SECRET`。本地部署可通过相同 Bearer secret 或已认证同源管理员 session 调用。`SYS_SECRET` 同时用于 session 签名与凭据加密，调度器必须保护该值。

Endpoint 只返回 `{ "deleted": number, "skipped": boolean }`，不会返回日志内容。清理失败时会移除节流标记，以便下一次调度重试。EdgeOne Blob 日志由清理任务物理删除；KV 日志也会通过存储 TTL 到期。

## 运维检查

- 确认 `LOG_RECORD` 是否有业务必要；关闭时不会新增会话日志。
- 核实定时任务的时区、运行身份、Secret 保存方式和最近执行结果。
- 若没有调度器，过期日志查询仍会隐藏旧记录，但 D1/EdgeOne Blob 的物理删除不保证发生。
- 不要把 `SYS_SECRET` 写入 URL、已提交配置、日志或公开 issue。
- 手动清理调用示例：

```sh
curl -X POST "$SERVICE_URL/api/internal/logs/purge" \
  -H "Authorization: Bearer $SYS_SECRET"
```

手动 endpoint 每个清理 namespace 每 24 小时最多实际执行一次；Cloudflare scheduled cleanup 不经过该节流 endpoint。

## 实现来源

`src/server/storage/conversation-log-cleanup.ts`、`src/server/storage/log-retention.ts`、`src/server/routes/log-cleanup.ts`、`src/platform/cloudflare/worker.ts`。
