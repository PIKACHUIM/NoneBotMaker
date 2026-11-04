# Quick Deployment

This guide uses Cloudflare Workers for a first deployment. See [Platform deployment](/en/development/deployment) for EdgeOne and Alibaba Cloud ESA. Production setup creates and changes cloud resources; prepare your own Cloudflare account, D1 database, KV namespace, and Worker domain first.

## 1. Clone and install

```sh
git clone https://github.com/PIKACHUIM/NoneBotMaker.git
cd NoneBotMaker
npm ci
```

Node.js 20 or later is required by the project. Node.js 22 or later is recommended for building the documentation site.

## 2. Configure the Worker and storage

Use `wrangler.example.jsonc` as a template. Review the Worker name, D1 database name and ID, KV namespace ID, and bindings. Do not commit account-specific IDs, domains, or credentials to a public repository. Cloudflare Gateway mode additionally requires its Durable Object binding and migration; Webhook is the default integration mode.

Create D1 and KV resources in your Cloudflare account and put their returned IDs in your private Worker configuration. Set the admin password and an independent system secret:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
npx wrangler secret put SYS_PASSWD
npx wrangler secret put SYS_SECRET
```

`SYS_SECRET` is used for session signing, sensitive credential encryption, and protected maintenance endpoints. Use an independent high-entropy value and store it securely. Never put secrets in `vars`, source code, shell history, or public logs.

## 3. Build and deploy

```sh
npm run build
npx wrangler deploy --config wrangler.jsonc
```

After deployment, check `https://<worker-domain>/api/health`. For a first deployment or schema upgrade, choose one of these options:

- Open `https://<worker-domain>/setup`, enter `SYS_SECRET`, and initialize; or
- Apply remote migrations with the CLI:

```sh
npx wrangler d1 migrations apply <database-name> --remote --config wrangler.jsonc
```

Migration scripts maintain schema versions. Do not manually drop or recreate production tables.

## 4. Configure the QQ callback

Set this callback URL in the QQ Open Platform:

```text
https://<worker-domain>/webhook/qq
```

In the admin console, create the chatbot plugin, a QQ account, and a conversation policy. Store QQ account credentials in the protected account settings. Enter the group/private OpenID in the policy and select a provider and model. Preserve QQ signature headers and the original request body at the callback endpoint.

## 5. Verify

```sh
curl -fsS https://<worker-domain>/api/health
curl -fsS https://<worker-domain>/api/setup/status
```

Log into the admin console and confirm that the account and policy are saved. Then test with an authorized QQ group and account. Local mocks do not verify QQ permissions, media capabilities, or provider behavior end to end.

## Cloudflare notes

- `npm run build:worker` is a template-based dry run; it does not create cloud resources or set secrets.
- Cloudflare Gateway uses Durable Objects to maintain WebSocket sessions and consumes resources continuously. Keep `API_METHOD=webhook` if Gateway is not needed.
- `SYS_PASSWD` is the admin password. The bot AppID/AppSecret are account credentials, not the admin password.
- Review billing, quotas, database backups, and log-retention policy before production use.
