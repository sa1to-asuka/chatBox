# Chatbox

> A self-hosted private AI workspace with accounts, model permissions, daily credits, provider management, cross-device chat sync and a full admin console.

English | [简体中文](README.md)

This project is a fork of [deepseek-ai/chat-demo](https://github.com/deepseek-ai/chat-demo). The upstream project is a static, browser-only chat demo; this fork turns it into a multi-user, server-backed application: the browser never holds the upstream API key, and all model requests, accounts, quotas and attachments are handled and stored by your own Node service.

## Features

### Chat

- Streaming replies, thinking mode, stop/continue, regenerate, edit prompts and branch switching.
- Markdown, syntax highlighting, KaTeX math and Mermaid diagrams.
- Image, PDF, DOCX and text attachments with paste and drag-and-drop support.
- Native web search (OpenAI / Anthropic compatible) with source citations.
- Sandboxed SVG preview with animation replay, fullscreen and download.
- Conversation search (`Ctrl/Cmd + K`), pinning, collapsible categories and category-scoped new chats.
- Public read-only share links (revocable) and Markdown / JSON export.

### Agent and workspace

- Web-enabled agent with multi-round tool use, search and workspace access; configure the search backend/model, rounds, search and file limits, and timeouts in the admin console. Set `AGENT_ENABLED=0` to fall back to single-turn calls.
- Workspace tasks run on the server: track progress, download artifacts, retry or delete them on the `/files` page. Artifacts are kept for 15 days.
- Slash commands and plugins: built-in templates for solving, planning, writing, translation, code, summaries, PPT, Word, Excel, math, Mermaid, SVG and HTML; enable or disable them in the admin console.
- Office output: generate and download Word (docx), PPTX and Excel. PPTX can use native SVG → PPTX rendering via PPT Master when configured, otherwise it falls back to PptxGenJS.
- Rich previews: sandboxed HTML/SVG, image viewer, file-task cards and automatic conversation compaction.

### Accounts and credits

- Admin-created accounts; set `ALLOW_REGISTRATION=1` to temporarily enable public sign-up. Roles: user, VIP, admin.
- Daily credits by Beijing calendar day, charged as tokens × model multiplier; supports daily limits and unlimited accounts.
- Credits are reserved before generation and settled afterwards, with stale reservations reconciled.
- Usage center with daily allowance, reset time, 7-day trend, per-model stats and request history.
- 90-day sliding cookie sessions.

### Admin console

- Dedicated full-page `/admin` UI, accessible to admins only.
- Users: create accounts, change role/VIP, daily quota, unlimited flag, disable, reset password.
- Providers: OpenAI / Anthropic-compatible endpoints; API keys encrypted with AES-GCM.
- Models: discover and import, set display name, premium flag, multiplier, vision/file/thinking/search capabilities.
- Agent settings: search backend, search model, rounds, search count, file count and timeout, with connectivity probe.
- Prompts and plugins: edit the system prompt, restore defaults, and manage built-in/custom slash-command plugins.
- Usage overview and per-user usage details.

## Stack

| Layer | Technology |
| --- | --- |
| Frontend | React 18, TypeScript, Rspack, Zustand, CSS Modules |
| Backend | Node.js 24+, Fastify 5, better-sqlite3 |
| Data | SQLite (chats, messages, attachments, accounts, credit ledger, shares) |
| Model access | OpenAI / Anthropic-compatible APIs (streaming SSE) |
| Deployment | PM2 or Docker, optionally behind Nginx / FRP |

## Quick start

Requirements: **Node.js 24+** and **pnpm 10+**.

```bash
pnpm install
cp .env.example .env
```

Set a random `CONFIG_SECRET` (at least 32 characters) in `.env`:

```bash
openssl rand -hex 32
```

Public registration is closed by default: create the first admin from the server, then create other accounts in the admin console. Set `ALLOW_REGISTRATION=1` in `.env` to temporarily open public sign-up.

Create the first admin (password at least 12 characters):

```bash
pnpm admin:create admin Administrator 'replace-with-a-strong-password'
```

Build and start:

```bash
pnpm build
pnpm server:build
pnpm server
```

Open <http://127.0.0.1:3006>, sign in as the admin, then go to **Admin → Providers** to add a model endpoint.

> `pnpm dev` only starts the frontend dev server on port 8090 and needs an API proxy; for local use the build + `pnpm server` flow above is the simplest.
>
> `better-sqlite3` ships prebuilt binaries for common platforms, so this repo skips its install script. The `Ignored build scripts: better-sqlite3` notice from pnpm is expected. If your platform has no matching prebuild, run `pnpm approve-builds` to compile it locally.

## Environment variables

| Variable | Default | Description |
| --- | --- | --- |
| `NODE_ENV` | `development` | Set to `production` in production |
| `HOST` | `127.0.0.1` | Listen address; keep it local and reverse-proxy publicly |
| `PORT` | `3006` | Server port |
| `DATA_DIR` | `./data` | Persistent directory for SQLite and attachments |
| `STATIC_DIR` | `./dist` | Frontend build output |
| `COOKIE_SECURE` | `false` | Set to `true` when served over HTTPS |
| `TRUST_PROXY` | `false` | Set to `true` behind a reverse proxy |
| `CONFIG_SECRET` | none | **Required**; encrypts provider API keys. Never change it after setup |
| `ALLOW_REGISTRATION` | unset | Public registration is closed when unset; set to `1` to open it temporarily |
| `AGENT_ENABLED` | `1` | Set to `0` to disable the web agent and use single-turn calls |
| `PPTMASTER_PYTHON` | none | Optional Python path inside the PPT Master virtualenv |
| `PPTMASTER_HOME` | none | Optional `skills/ppt-master` directory; PptxGenJS is used when unset |

## Deployment

### PM2

```bash
pnpm install --frozen-lockfile --prod
pm2 start ecosystem.config.cjs
pm2 save
curl http://127.0.0.1:3006/api/health
```

### Docker

```bash
cp .env.example .env   # set CONFIG_SECRET and other values
docker compose up -d --build
```

`compose.yaml` binds `127.0.0.1:3006` by default and persists `./data`.

### Reverse proxy

Terminate HTTPS in Nginx/Caddy and disable buffering for streaming replies, for example:

```nginx
location / {
    proxy_pass http://127.0.0.1:3006;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_buffering off;
    proxy_read_timeout 300s;
}
```

See [DEPLOY.md](DEPLOY.md) for backups, restore, FRP and more.

## Backup

```bash
pnpm backup
```

Creates a consistent `chat.db` snapshot plus all attachments under `backups/<timestamp>/` without stopping the service. Both `data/` and `backups/` are ignored by Git.

## Scripts

| Command | Description |
| --- | --- |
| `pnpm server` | Start the backend with tsx (loads `.env`) |
| `pnpm build` | Build the frontend into `dist/` |
| `pnpm server:build` | Compile the backend into `build/` |
| `pnpm type` / `pnpm server:type` | Type-check frontend / backend |
| `pnpm lint` | Lint with oxlint |
| `pnpm format` | Format with oxfmt |
| `pnpm test:integration` | Backend integration tests against a local mock upstream |
| `pnpm mock:upstream` | Start the local OpenAI-compatible mock (port 3901) |
| `pnpm admin:create` | Create the first admin |
| `pnpm backup` | Back up database and attachments |

## Project layout

```text
src/                 Frontend (React)
  app/               Shell, routing and theme
  components/        Chat, sidebar, account, admin, usage, files workspace, etc.
  services/          Auth, chat state, workspace tasks, plugins, models, uploads, sharing
server/              Fastify backend
  providers/         OpenAI / Anthropic adapters (multi-turn and reasoning)
  routes*.ts         Auth, chat, model, admin, share, usage, workspace, plugin and agent APIs
  agent-loop.ts      Agent tool loop
  workspace.ts       Workspace tasks and artifacts (15-day cleanup)
  pptmaster.ts       Optional native PPTX rendering
  quota.ts           Credit reservation and settlement
  db.ts              SQLite schema and migrations
shared/              Shared types, auto skills and Beijing-time helpers
scripts/             Backup and local mock upstream
```

## Security notes

- Provider API keys stay on the server and are encrypted with `CONFIG_SECRET`; they are never sent to the browser.
- Always set `CONFIG_SECRET` and serve over HTTPS (`COOKIE_SECURE=true`) in production.
- Passwords are hashed with scrypt; disabling a user, changing their role or changing a password invalidates existing sessions.
- Public registration is off by default and rate-limited per IP when enabled.
- Write requests validate `Origin`; attachments are per-user; share links expose a read-only snapshot.
- Never commit `.env`, `data/` or `backups/`.

## Differences from upstream

- Full accounts, roles, credits and usage tracking.
- Provider/model admin console with encrypted key storage.
- Chats and attachments moved from browser storage to server-side SQLite with cross-device sync.
- Categories, pinning, full-text conversation search, sharing, export and sandboxed SVG preview.
- Web agent, workspace tasks, slash-command plugins, prompt management, conversation compaction and Office document generation.
- Rebranded Chinese-first UI with desktop and mobile layouts.

## Publishing to your own fork

This directory keeps the upstream commit history; the original remote is named `upstream` so it is not pushed to by accident. To publish your fork:

```bash
git remote add origin https://github.com/<your-user>/chat-demo.git
git push -u origin main
```

To sync with upstream later:

```bash
git fetch upstream
git merge upstream/main
```

## License

[MIT](LICENSE). The upstream project is also MIT-licensed; keep the original copyright notice when redistributing.
