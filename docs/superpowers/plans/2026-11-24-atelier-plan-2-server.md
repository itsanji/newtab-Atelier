# Atelier Plan 2 — Self-hosted Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A self-hostable Bun + Hono + Postgres server giving Atelier accounts, sync, shared workspaces, public category links and live change notifications, started with one `docker compose up`.

**Architecture:** New workspace `apps/server` (`@atelier/server`). Hono app built by `createApp(deps)` so tests inject a database, clock and mail transport. Postgres through Bun's built-in `SQL` client; plain SQL migrations applied at startup. Every synced row carries a `version` from one global sequence; the client's sync cursor is the highest version it has seen. Pushes are serialised with a transaction-level advisory lock so versions commit in order. Validation reuses the zod row schemas from `@atelier/core`.

**Tech Stack:** Bun 1.4.4 (`bun:test`, `Bun.SQL`, `Bun.password`, `Bun.serve` WebSockets), Hono 4 (`hono/bun` `upgradeWebSocket`), zod (via core), nodemailer (SMTP only), Postgres 16 (`postgres:16-alpine`, already pulled locally), Docker + compose.

**Spec:** `docs/superpowers/specs/2026-11-24-atelier-tab-board-design.md` (sections Feature set 13–16, Architecture, Data model, Sync, Reminders in shared workspaces, Writes sync can't apply, Constraints).
**Carried notes:** `docs/superpowers/notes/2026-11-24-notes-for-sync-plans.md`.

## Global Constraints

- **No CI/CD.** Never create `.github/workflows`, GitLab CI or any pipeline file. Tests run locally.
- Max 3 subagents at a time.
- Server runs with only Postgres. SMTP and Google OAuth are optional and switch features on only when configured.
- Environment: `PUBLIC_URL` (required, no trailing slash), `DATABASE_URL` (required), `SESSION_SECRET` (required, ≥ 32 chars), `PORT` (default `8787`), `SMTP_URL` + `SMTP_FROM` (optional, both or neither), `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` (optional, both or neither). Startup fails with a clear message when a required value is missing or invalid.
- All JSON API routes live under `/api`. Errors are `{ "error": "<sentence-case message>" }` with a fitting status (400 invalid input, 401 not signed in, 403 not allowed, 404 not found, 409 conflict, 429 too many attempts).
- Row JSON on the wire uses the core model's camelCase field names (`Workspace`, `Category`, `Item`, `Reminder` from `@atelier/core`), ISO-8601 timestamps. DB columns are snake_case.
- The server assigns `updatedAt` (its clock, strictly increasing per row) and `updatedBy` (the user id) on every accepted write; client values for those are ignored.
- Link URLs: only `http`, `https`, `file`, `ftp` (core `isLinkUrl`), enforced on every write.
- `shareToken` and `ownerId` are server-controlled: values a client pushes are ignored.
- A reminder belongs to its creator: pushes force `userId` to the caller; pulls return only the caller's reminders.
- A public link exposes exactly one live category's live items, read-only, and nothing else (no workspace name, no members, no reminders).
- Passwords hashed with `Bun.password` (argon2id). Session tokens: 32 random bytes, base64url, stored only as HMAC-SHA256(`SESSION_SECRET`, token). Sliding 90-day expiry.
- Tests: `bun test` in `apps/server` against a real Postgres from `apps/server/test/compose.yml` (`postgres:16-alpine`, `127.0.0.1:54329`, user/password `postgres`, tmpfs). Each test file gets its own fresh database. No test talks to a third-party service (fake SMTP transport and a fake Google server via `Bun.serve`).
- Voice in pages and emails: sentence case, no exclamation marks. No tabExtend name or styling.

## Review Focus

1. **A user removed from a shared workspace, or a viewer, pushes edits** — every such row comes back `rejected` (none applied), and other users' data is untouched. Test: Task 3 `push rejects writes from viewers and non-members`.
2. **An item is pushed into a category another device deleted** — the category (and its workspace if deleted) is restored and the item stored with `restored: true`; result status `restored`. Test: Task 3 `push restores a deleted parent`.
3. **Two pushes racing** — a pull with the cursor from between them never skips a row. Test: Task 3 `concurrent pushes never let a pull skip a version`.
4. **A share token for a deleted or revoked category, or an HTML-ish item title** — 404 for the former; titles and notes are escaped. Test: Task 5 `share page 404s for revoked and deleted, escapes content`.
5. **Brute-force sign-in** — after 10 failed attempts for one email from one IP within 15 minutes, further attempts get 429 even with the right password. Test: Task 2 `login is rate limited`.

---

## File structure

```
apps/server/
  package.json            @atelier/server; scripts: dev, start, test, build (tsc --noEmit)
  tsconfig.json
  Dockerfile
  migrations/001_init.sql
  static/fonts/*.woff2    Cormorant Garamond 500 + Jost 400/500 (copied from @fontsource)
  src/
    main.ts               reads config, migrates, Bun.serve(app.fetch + websocket)
    config.ts             loadConfig(env) -> Config
    app.ts                createApp(deps) -> { app: Hono, websocket }
    db.ts                 connect(url) -> SQL; migrate(sql)
    auth/{passwords.ts,sessions.ts,middleware.ts,routes.ts,rateLimit.ts,magic.ts,google.ts}
    sync/{push.ts,pull.ts,routes.ts,permissions.ts,rows.ts}
    members/routes.ts
    share/{routes.ts,page.ts}
    live/hub.ts           WebSocket hub: notifyUsers(userIds)
    mail.ts               MailTransport interface; smtpTransport(url, from); memoryTransport()
  test/compose.yml
  test/helpers.ts         freshDb(), makeApp(overrides), signUp(app, email)
docker-compose.yml        server + postgres
.env.example
docs/self-hosting.md
packages/core/src/exportFormat.ts   export row schemas; Item gains `restored`
```

---

### Task 1: Server scaffold, config, schema, test harness

**Files:** create everything under `apps/server` listed above except auth/sync/members/share/live/mail bodies (empty route modules are not needed — add them in their tasks); modify `packages/core/src/{model.ts,exportFormat.ts,index.ts}`, root `package.json`.

**Interfaces — Produces:**
- `loadConfig(env: Record<string,string|undefined>): Config` — `{ publicUrl, databaseUrl, sessionSecret, port, smtp: {url, from} | null, google: {clientId, clientSecret, authUrl, tokenUrl, userInfoUrl} | null }`. Google URLs default to `https://accounts.google.com/o/oauth2/v2/auth`, `https://oauth2.googleapis.com/token`, `https://openidconnect.googleapis.com/v1/userinfo`, overridable by `GOOGLE_AUTH_URL`, `GOOGLE_TOKEN_URL`, `GOOGLE_USERINFO_URL` (for tests). Throws `ConfigError` naming the variable.
- `connect(url: string): SQL`, `migrate(sql: SQL): Promise<void>` — applies `migrations/*.sql` in filename order inside a transaction holding `pg_advisory_xact_lock(424242)`, recording names in `schema_migrations(name text primary key, applied_at timestamptz)`; idempotent.
- `createApp(deps: { sql: SQL; config: Config; mail: MailTransport; now?: () => Date }): { app: Hono; websocket: unknown; hub: Hub }`.
- `GET /health` → `200 "ok"`. `GET /api/config` → `{ name: "Atelier", auth: { password: true, magicLink: boolean, google: boolean } }`.
- Test helpers: `freshDb(): Promise<{ sql: SQL; drop(): Promise<void> }>` creates `atelier_test_<random>` on `TEST_DATABASE_URL` (default `postgres://postgres:postgres@127.0.0.1:54329/postgres`), migrates it; `makeApp(overrides?)` returns `{ app, sql, mail: memoryTransport, hub, close }`.
- Core: export `workspaceSchema`, `categorySchema`, `itemSchema`, `reminderSchema`; `Item` gains `restored: boolean`; `itemSchema.restored` is `z.boolean().default(false)` so plan-1 export files still import. Update the extension's item creation (`repo.ts`) and any fixtures to set `restored: false` so the extension type-checks and its tests pass.

**Schema (`001_init.sql`)** — exact tables:
- `create sequence change_seq;`
- `users(id uuid pk, email text not null unique, password_hash text, display_name text not null default '', created_at timestamptz not null default now())` — email stored trimmed + lower-cased.
- `sessions(token_hash text pk, user_id uuid not null references users on delete cascade, created_at, last_used_at, expires_at timestamptz not null)`.
- `workspaces(id uuid pk, name text not null, emoji text, owner_id uuid not null references users, sort_key text not null, created_at, updated_at timestamptz not null, deleted_at timestamptz, updated_by uuid, version bigint not null)`.
- `workspace_members(id uuid pk, workspace_id uuid not null references workspaces, user_id uuid references users, email text not null, role text not null check (role in ('owner','editor','viewer')), invited_by uuid, created_at, updated_at, deleted_at, version bigint not null, unique (workspace_id, email))`.
- `categories(id uuid pk, workspace_id uuid not null references workspaces, name, emoji, sort_key, tab_group jsonb, share_token text unique, created_at, updated_at, deleted_at, updated_by, version)`.
- `items(id uuid pk, category_id uuid not null references categories, kind text check in ('link','note','todo'), sort_key, title text not null, url text, favicon_url text, note text, body jsonb, done boolean not null default false, restored boolean not null default false, created_at, updated_at, deleted_at, updated_by, version)`.
- `reminders(id uuid pk, item_id uuid not null references items, user_id uuid not null references users, remind_at timestamptz not null, reminded_at timestamptz, created_at, updated_at, deleted_at, updated_by, version)`.
- `magic_links(id uuid pk, email text not null, token_hash text not null unique, poll_hash text not null, expires_at timestamptz not null, verified_user_id uuid, consumed_at timestamptz)`.
- `oauth_codes(code_hash text pk, user_id uuid not null, expires_at timestamptz not null)`, `oauth_states(state text pk, redirect_uri text not null, client_state text not null, expires_at timestamptz not null)`.
- Indexes on `version` for the four synced tables and `workspace_members`, on `workspace_id`, `category_id`, `item_id`, `workspace_members(user_id)`, `workspace_members(email)`.

- [ ] Step 1: `test/compose.yml`, root scripts `"db:test:up": "docker compose -f apps/server/test/compose.yml up -d --wait"`, `"test": "vitest run && bun run --filter @atelier/server test"`. Bring the DB up.
- [ ] Step 2: failing tests `config.test.ts` (`loadConfig rejects missing PUBLIC_URL`, `short SESSION_SECRET`, `SMTP_URL without SMTP_FROM`; `accepts minimal config with smtp and google null`), `migrate.test.ts` (`migrate is idempotent`, `creates all tables`), `app.test.ts` (`GET /health`, `GET /api/config reports magicLink false and google false without smtp/google`).
- [ ] Step 3: implement; core schema change with a core test `itemSchema defaults restored to false`.
- [ ] Step 4: `bun run db:test:up && bun run test` — all green (extension + core + server).
- [ ] Step 5: commit `feat(server): scaffold, config, schema and test harness`.

### Task 2: Password accounts and sessions

**Interfaces — Produces:**
- `requireUser` Hono middleware: reads `Authorization: Bearer <token>`, sets `c.var.user = { id, email, displayName }`, refreshes `last_used_at`/`expires_at` at most once an hour; 401 otherwise.
- `createSession(sql, userId, now): Promise<string>` (returns raw token), `attachPendingInvites(sql, user)` — sets `user_id` on `workspace_members` rows with that email and `user_id is null`, bumping their `version`.
- Routes: `POST /api/auth/signup {email, password, displayName?}` → 201 `{ token, user }` (409 if email taken; password 8–200 chars; email must contain `@`); `POST /api/auth/login {email, password}` → `{ token, user }` or 401 `"Email or password is wrong"`; `POST /api/auth/logout` → 204; `GET /api/auth/me` → `{ user }`.
- `RateLimiter` in memory: key `ip|email`, 10 failures per 15 minutes → 429 `"Too many attempts. Try again later"`. IP from `x-forwarded-for` first entry, else the socket address.
- Signup also creates the user's first workspace? **No** — the extension pushes its own rows.

- [ ] Tests: `signup returns token and me works`, `signup normalises email case and rejects duplicates`, `login wrong password 401 same message as unknown email`, `logout invalidates token`, `expired session 401`, `login is rate limited`, `signup attaches pending invites`.
- [ ] Implement, run, commit `feat(server): password accounts and sessions`.

### Task 3: Sync push and pull

**Interfaces — Produces:**
- `POST /api/sync/push { changes: Array<{ table: 'workspaces'|'categories'|'items'|'reminders'; row: unknown }> }` (1–1000 changes) → `{ results: Array<{ table, id, status: 'applied'|'restored'|'rejected', reason?: string }> }` in input order.
- `GET /api/sync/pull?cursor=<int>` → `{ cursor: number, workspaces, categories, items, reminders, members: Member[], removedWorkspaceIds: string[] }` where `Member = { id, workspaceId, userId: string|null, email, role, displayName: string|null, deletedAt }`.
- `roleIn(sql, userId, workspaceId): Promise<'owner'|'editor'|'viewer'|null>` (live membership only) — used by Tasks 4 and 5.
- `notify` hook: push calls `deps.hub.notifyUsers(userIds)` with every live member of each workspace it changed (Task 4 implements the hub; this task uses an injected `hub` with a no-op default).

**Push rules** (one transaction, `pg_advisory_xact_lock(1)` first, changes processed in table order workspaces → categories → items → reminders, stable within a table):
- Invalid row (core schema) → `rejected`, reason `invalid`.
- Workspace: new id → insert with `owner_id = caller` and a live `owner` member row (email = caller's). Existing → caller role must be owner or editor; setting `deletedAt` needs owner.
- Category / item: target workspace (via `workspaceId` / category) must exist and caller must be owner/editor of it; moving a row between workspaces needs owner/editor on both. A tombstoned parent chain is restored (`deleted_at = null`, new version) when the incoming row is live; the item then stores `restored = true` and the status is `restored`. A tombstone push never restores parents.
- Parent missing entirely (never pushed) → `rejected`, reason `missing-parent`.
- Reminder: `userId` forced to caller; item must be visible to the caller; an existing reminder id owned by someone else → `rejected`.
- Every accepted write: `updated_at = greatest(now, previous updated_at + 1ms)`, `updated_by = caller`, `version = nextval('change_seq')`; `share_token` and `owner_id` keep server values; `restored` from the client is kept only when false→false (clients may clear it by pushing `false`; only the server sets it true).

**Pull rules:** visible workspaces = live membership of caller. Return rows with `version > cursor` from visible workspaces (including tombstones), the caller's reminders with `version > cursor`, and member rows of visible workspaces with `version > cursor` (with `displayName` joined). Any workspace whose caller membership row has `version > cursor` is returned in full (all its categories/items/members regardless of version — it was just shared with the caller). `removedWorkspaceIds`: workspaces where the caller's membership became deleted with `version > cursor`. `cursor` = max version returned or the input cursor, never lower than the input.

- [ ] Tests (two users A and B via signup helper): `push creates workspace with owner member`, `pull returns own rows after cursor 0 and nothing new after returned cursor`, `push rejects writes from viewers and non-members`, `push restores a deleted parent`, `missing parent is rejected`, `server ignores client shareToken, ownerId, updatedAt`, `reminders are private to their user`, `rejects non-http link url`, `newly shared workspace is pulled in full`, `removed member gets removedWorkspaceIds`, `concurrent pushes never let a pull skip a version` (fire 20 parallel pushes, pull repeatedly with returned cursors, assert every row seen).
- [ ] Implement, run, commit `feat(server): sync push and pull with permissions`.

### Task 4: Members, invites, mail, live notifications

**Interfaces — Produces:**
- `MailTransport { send(msg: { to: string; subject: string; text: string; html: string }): Promise<void> }`; `smtpTransport(url, from)` (nodemailer); `memoryTransport(): MailTransport & { sent: Msg[] }`. With no SMTP configured, `createApp` gets `null` mail and skips sending.
- `GET /api/workspaces/:id/members` (any member) → `{ members: Member[] }` (live only).
- `POST /api/workspaces/:id/members { email, role: 'editor'|'viewer' }` (owner only) → 201 `{ member }`; links `user_id` when that email has an account; re-inviting a removed email revives the row; sends an invite email when mail is configured (subject `"<inviter> shared “<workspace>” with you on Atelier"`, body says to sign in to `<PUBLIC_URL>` with this email).
- `PATCH /api/workspaces/:id/members/:memberId { role }` (owner only, cannot change the owner row) ; `DELETE /api/workspaces/:id/members/:memberId` (owner, or the member themself = leave; the owner row cannot be removed). All bump `version` and notify.
- Hub: `GET /api/live` WebSocket. Client's first message `{"type":"auth","token":"..."}`; server replies `{"type":"ready"}` or closes with code 4401. Subscribes to `user:<id>`. `hub.notifyUsers(ids)` publishes `{"type":"changed"}`. Ping every 30 s.

- [ ] Tests: `owner invites existing user who then pulls the workspace`, `invite unknown email is pending then attached on signup`, `editor cannot invite`, `member can leave, owner cannot be removed`, `invite email sent only when mail configured`, `websocket gets changed after a member's push` (real `Bun.serve` on port 0).
- [ ] Implement, run, commit `feat(server): members, invites and live notifications`.

### Task 5: Public share links

**Interfaces — Produces:**
- `POST /api/categories/:id/share` (owner/editor) → `{ shareToken, url: "<PUBLIC_URL>/s/<token>" }` (idempotent: returns the existing token); `DELETE /api/categories/:id/share` → 204. Both bump the category's `version` and notify.
- `GET /s/:token` → HTML page: category emoji + name (Cormorant Garamond heading), then live items in sort-key order — links as anchors (`rel="noopener noreferrer nofollow"`, `target="_blank"`) with host shown, notes as plain text paragraphs extracted from TipTap JSON (text nodes only), to-dos with a done/not-done mark. Footer "Shared with Atelier". Headers: `Cache-Control: no-store`, `X-Robots-Tag: noindex`, `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; font-src 'self'; img-src 'self'`, `Referrer-Policy: no-referrer`. Fonts served from `/static/fonts/`. Impression look: Giverny tokens (copy values from `apps/extension/src/ui/theme/tokens.css`), light only.
- 404 page (same styling, "This link isn't available") when token unknown, revoked, or category/workspace deleted.

- [ ] Tests: `owner creates and revokes share link`, `viewer cannot create share link`, `share page shows only that category's live items`, `share page 404s for revoked and deleted, escapes content`, `share page sets security headers`.
- [ ] Implement, run, commit `feat(server): public share links`.

### Task 6: Magic link and Google sign-in

**Interfaces — Produces (routes return 404 when the feature isn't configured):**
- `POST /api/auth/magic/start { email }` → `{ requestId, pollSecret }`; emails a link `<PUBLIC_URL>/auth/magic?token=<token>` valid 15 minutes. Rate limit 5 per email per 15 min.
- `GET /auth/magic?token=` → HTML page with a single "Sign in" button (POST form) — the GET itself changes nothing (mail scanners prefetch links). `POST /auth/magic` → verifies, finds or creates the user (`attachPendingInvites`), marks `verified_user_id`, shows "You're signed in. Return to Atelier."
- `POST /api/auth/magic/poll { requestId, pollSecret }` → 202 `{ status: "pending" }`, then once 200 `{ token, user }` (sets `consumed_at`), 410 when expired or already consumed.
- `GET /auth/google/start?redirect_uri=&state=` — `redirect_uri` must match `^https://[a-p]{32}\.chromiumapp\.org/` (400 otherwise); stores an `oauth_states` row (10 min) and redirects to Google with `redirect_uri = <PUBLIC_URL>/auth/google/callback`, `scope=openid email profile`, its own random state.
- `GET /auth/google/callback?code=&state=` — exchanges the code, reads userinfo, requires `email_verified`, finds/creates user, issues a one-time code (60 s, stored hashed) and redirects to the stored `redirect_uri?code=<code>&state=<client_state>`.
- `POST /api/auth/google/exchange { code }` → `{ token, user }` once.

- [ ] Tests (memory mail, fake Google `Bun.serve`): `magic link full flow`, `GET magic page does not sign in`, `poll after consume is 410`, `magic routes 404 without smtp`, `google flow creates user and exchanges code once`, `google start rejects foreign redirect_uri`, `unverified google email rejected`.
- [ ] Implement, run, commit `feat(server): magic link and google sign-in`.

### Task 7: Docker, compose and self-hosting docs

- `apps/server/Dockerfile`: `oven/bun:1.4.4-alpine` (fall back to `oven/bun:1.4-alpine` if that tag doesn't exist); installs workspace deps for server + core only, runs as non-root `bun` user, `CMD ["bun","apps/server/src/main.ts"]`, `HEALTHCHECK` on `/health`.
- Root `docker-compose.yml`: `db` (`postgres:16-alpine`, volume `atelier-db`, healthcheck) and `server` (build from Dockerfile, `depends_on: db: condition: service_healthy`, `env_file: .env`, port `${PORT:-8787}:8787`). `.env.example` lists every variable with comments. `.dockerignore`.
- `docs/self-hosting.md`: requirements, `cp .env.example .env`, generate secret (`openssl rand -base64 48`), `docker compose up -d`, putting it behind HTTPS (Caddy example), SMTP and Google setup (authorised redirect URI `<PUBLIC_URL>/auth/google/callback`), backups (`pg_dump`), upgrading. README links it. No CI/CD.
- [ ] Verify: `docker compose build && docker compose up -d` with a test `.env` (not committed), `curl localhost:8787/health` → `ok`, `curl /api/config`, then `docker compose down -v`. Record output in the report.
- [ ] Commit `feat(server): docker image, compose and self-hosting guide`.
