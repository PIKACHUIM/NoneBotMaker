# Local Development and Tests

## Requirements

- Node.js `>=20` and npm. The documentation site pins VitePress `2.0.0-alpha.21`; its Vite 8 toolchain requires Node.js `^20.19.0` or `>=22.12.0`. Node.js 22.12+ is recommended for a consistent setup.
- Git and access to the npm registry. Platform accounts are needed only for real integration testing or deployment.

## Install and start

```sh
npm ci
npm run dev
```

`npm run dev` starts the local Hono API (default `127.0.0.1:8787`) and Vite console (default `5173`, with `/api` proxied to the API). The Node entry reads process variables: `SYS_PASSWD`, `SYS_SECRET`, `API_METHOD`, `LOG_RECORD`, and `PORT`. `.dev.vars.example` is a template for Wrangler local development; a regular Node process does not automatically load `.dev.vars`.

The local Node entry does not create D1/KV bindings. Test management settings, chat context, and other persistent behavior in a Worker/platform runtime with a configured persistence binding. A running server does not prove that a data path is operational.

## Common checks

```sh
npm run typecheck
npm test
npm run build
npm run build:worker
npm run build:edgeone
npm run build:esa
```

- `typecheck` checks the source with TypeScript.
- `test` runs Vitest; tests are co-located under `src/**/*.test.ts`.
- `build` type-checks and builds the frontend to `dist/`.
- `build:worker` performs a Cloudflare dry run using `wrangler.example.jsonc`; it does not deploy production resources.
- EdgeOne/ESA outputs are under `dist/edge-functions/` and `dist/edge-routine/`.

## Documentation site

```sh
npm run docs:dev
npm run docs:build
npm run docs:preview
```

The dev server binds to `127.0.0.1`. Static output is written to `docs/.vitepress/dist/`, separate from the application `dist/`; it can be uploaded to any static hosting provider. The pinned VitePress version is an alpha release. Recheck Node requirements, dependency audit, and the build when upgrading it.

## Change workflow

1. Add testable scenarios to `docs/design/requirements.md`, or state why a change does not affect product behavior.
2. Update `docs/design/architecture.md` for cross-platform behavior, permissions, or storage, and verify platform adapter differences.
3. Implement the change and update relevant `*.test.ts` files; documentation is not a substitute for behavior tests.
4. Run type checking, targeted tests, the full suite, and application/docs builds.
5. Check bilingual links, environment variables, deployment instructions, and configuration against the implementation.

## Configuration safety

Do not commit `.dev.vars`, real provider/QQ credentials, platform tokens, or production database IDs. Use isolated resources and dummy credentials for tests. Before touching real production resources, migrations, or data, confirm the target environment, backup, and rollback plan.
