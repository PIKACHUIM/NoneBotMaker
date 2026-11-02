# Conversation log retention

Conversation log records are written with `expiresAt` capped at 30 days. List operations hide expired entries immediately; physical deletion is handled separately.

## Cloudflare Workers

The Worker exposes a `scheduled` handler. Add a Cloudflare Cron Trigger for 03:00 UTC in the dashboard when the account has Cron quota available. The handler calls `runScheduledConversationLogCleanup(bindings, now)` from `src/server/storage/conversation-log-cleanup.ts`, which delegates to `purgeExpiredLogs(bindings, now)` in `src/server/storage/log-retention.ts`. This direct scheduled path needs only the configured log repository and does not require a KV throttle binding. D1 deletion uses the `expires_at` index. Cloudflare KV records also have a native TTL. When the account Cron quota is full, use an external scheduler against the authenticated cleanup endpoint described below.

## EdgeOne

The official `edgeone.json` schedule schema supports `name`, `cron`, `path`, `method`, `payload`, and `timezone`, but does not document request headers or secret/environment interpolation. Do not put `LOG_CLEANUP_SECRET` in a checked-in schedule payload or URL, and do not add an unauthenticated cleanup path. Configure an external/console scheduler that can keep the secret out of source control and send `POST /api/internal/logs/purge` with `Authorization: Bearer <LOG_CLEANUP_SECRET>`. This route requires the dedicated secret and a cleanup KV namespace (`LOG_CLEANUP_KV`, `EDGEONE_KV`, or `KV`). The endpoint is throttled to one sweep per 24 hours per cleanup KV namespace.

## ESA and local deployments

ESA has no in-repository scheduled runtime handler configured. Use an external scheduler capable of secret-managed Authorization headers to call the same authenticated endpoint, and configure `LOG_CLEANUP_KV` (or the platform's KV binding) plus `LOG_CLEANUP_SECRET`. Local deployments can invoke the endpoint with the same Bearer secret or an authenticated same-origin admin session. Keep the cleanup secret independent from `SYS_PASSWD` and `SYS_SECRET`.

The endpoint returns only `{ "deleted": number, "skipped": boolean }`; it never returns log contents. On a failed sweep, the throttle marker is removed so the next scheduled invocation can retry. EdgeOne Blob logs are physically deleted by the sweep; KV-backed logs additionally expire through their storage TTL.

Without a configured scheduler, list results still hide expired records, but physical deletion of D1/EdgeOne Blob logs is not guaranteed. Ensure the daily trigger is enabled after deployment.
