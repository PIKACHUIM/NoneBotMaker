# Platform Deployment

All platforms reuse `src/server/app.ts`, but entry points, persistence, and available features differ. Prepare resources for the target platform before deployment; a successful local build does not prove that runtime bindings are configured.

## Common environment variables

| Name | Purpose |
| --- | --- |
| `SYS_PASSWD` | Admin console password; set it as a platform Secret. |
| `SYS_SECRET` | Session signing, sensitive credential encryption, and protected maintenance endpoints; use an independent high-entropy secret. |
| `API_METHOD` | `webhook` (default) or `websocket`; WebSocket Gateway is supported only on Cloudflare. |
| `LOG_RECORD` | Whether to record conversation logs; disabled by default. |

Configure QQ AppID/AppSecret and AI Provider Keys in the corresponding account/provider settings after admin sign-in. Do not put them in public environment templates or command-line arguments.

## Cloudflare Workers

### Resources

Create a D1 database and KV namespace, then put their names and IDs in your private Worker configuration. Use `wrangler.example.jsonc` to review required bindings; do not commit account-specific configuration. The default entry is `src/platform/cloudflare/worker.ts`, and frontend assets are served from `dist/`.

```sh
npx wrangler d1 create nonebot-data
npx wrangler kv namespace create nonebot-kv
```

### Build, migrate, and deploy

```sh
npm ci
npm run build
npx wrangler d1 migrations apply <database-name> --remote --config wrangler.jsonc
npx wrangler secret put SYS_PASSWD
npx wrangler secret put SYS_SECRET
npx wrangler deploy --config wrangler.jsonc
```

Alternatively, deploy first and initialize the schema at `/setup` using `SYS_SECRET`. Do not manually apply duplicate DDL. `npm run build:worker` is only a dry run.

The default is `API_METHOD=webhook`. Cloudflare Gateway requires a `QQ_GATEWAY_SESSIONS` Durable Object binding and SQLite class migration. Review the cost and quota implications of persistent WebSocket connections. Use the Wrangler schema supported by your actual Cloudflare account for configuration details.

## EdgeOne

Build the function bundle:

```sh
npm run build:edgeone
```

The deployment entry is `dist/edge-functions/api/[[default]].js`. The runtime must provide `EDGEONE_BLOB` or `EDGEONE_KV`; configure `KV` if required by the storage setup. Blob is preferred over EdgeOne KV. Log-cleanup endpoints also need KV for persistent cleanup throttling. Set `SYS_PASSWD` and `SYS_SECRET` as platform environment secrets.

## Alibaba Cloud ESA

Build the function bundle:

```sh
npm run build:esa
```

The deployment entry is `dist/edge-routine/index.js`. The ESA runtime requires `ESA_KV` or `KV`, plus `SYS_PASSWD` and `SYS_SECRET`. The current ESA entry supports Webhook, not WebSocket Gateway.

## Local Worker integration checks

Once `wrangler.jsonc` has valid resources and local bindings, use `wrangler dev` to test the actual Worker entry. Run `npm run build` to produce assets and apply migrations to an isolated local D1/KV state directory. Do not run `--local` tests against real production configuration or copy production IDs into documentation.

## Post-deployment checks

1. Check `/api/health` and `/api/setup/status`.
2. Confirm the schema is ready, persistence bindings can read/write, and admin sign-in works.
3. Verify the QQ callback URL, signature headers, account status, and conversation OpenID.
4. Test the AI provider, usage, and reply permissions in a controlled conversation.
5. Before enabling logs, confirm access controls, retention, and cleanup schedule; monitor billing, quotas, and error rates.

Storage consistency, media APIs, scheduling, and console behavior on EdgeOne/ESA are provider-defined and must be tested in the target account before release.
