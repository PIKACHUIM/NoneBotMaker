# Conversation Log Retention and Cleanup

Log records are assigned an `expiresAt` capped at 30 days. List operations hide expired records immediately; a separate cleanup task performs physical deletion. `LOG_RECORD` is disabled by default. Before enabling it, review log contents, access controls, retention, and platform billing.

## Cloudflare Workers

The Worker exposes a `scheduled` handler. If account Cron quota permits, add a daily `03:00 UTC` Cron Trigger in the Cloudflare dashboard. The handler calls `runScheduledConversationLogCleanup(bindings, now)`, which delegates to `purgeExpiredLogs(bindings, now)` and cleans through the log repository without a KV throttle binding. D1 uses the `expires_at` index; Cloudflare KV records also have native TTL.

If Cron quota is full, use an external scheduler with the protected cleanup endpoint.

## EdgeOne

The EdgeOne schedule schema documented by this repository supports `name`, `cron`, `path`, `method`, `payload`, and `timezone`, but does not document request headers or secret/environment interpolation. Do not put `SYS_SECRET` in a checked-in schedule payload or URL, and do not add an unauthenticated cleanup path.

Use an external/console scheduler that can securely store a Secret and send an Authorization header to `POST /api/internal/logs/purge`. Configure `SYS_SECRET` and a cleanup KV binding (`LOG_CLEANUP_KV`, `EDGEONE_KV`, or `KV`). The endpoint performs at most one sweep per 24 hours per cleanup KV namespace.

## Alibaba Cloud ESA and local deployments

The repository does not configure an ESA scheduled runtime handler. Use an external scheduler with a securely injected Authorization header to call the same protected endpoint, and configure cleanup KV plus `SYS_SECRET`. Local deployments can use the same Bearer secret or an authenticated same-origin admin session. `SYS_SECRET` is also used for session signing and credential encryption; protect it in the scheduler.

The endpoint returns only `{ "deleted": number, "skipped": boolean }`; it never returns log contents. On failure, the throttle marker is removed so the next scheduled invocation can retry. EdgeOne Blob logs are physically deleted by the sweep; KV logs also expire through storage TTL.

## Operations checklist

- Confirm that `LOG_RECORD` is necessary; no new conversation logs are written when it is disabled.
- Verify the scheduler timezone, identity, Secret storage, and most recent execution.
- Without a scheduler, expired logs remain hidden from list results, but physical deletion of D1/EdgeOne Blob logs is not guaranteed.
- Never put `SYS_SECRET` in URLs, committed configuration, logs, or public issues.
- Manual cleanup example:

```sh
curl -X POST "$SERVICE_URL/api/internal/logs/purge" \
  -H "Authorization: Bearer $SYS_SECRET"
```

The manual endpoint performs at most one actual sweep per 24 hours per cleanup namespace. Cloudflare scheduled cleanup bypasses this endpoint throttle.

## Implementation sources

`src/server/storage/conversation-log-cleanup.ts`, `src/server/storage/log-retention.ts`, `src/server/routes/log-cleanup.ts`, and `src/platform/cloudflare/worker.ts`.
