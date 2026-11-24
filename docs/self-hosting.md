# Self-hosting Atelier

The Atelier server stores accounts and synced boards, serves public category links and tells open browsers when something changed. It is one container plus Postgres. Sync is optional: the extension works without it.

## Requirements

- A machine with Docker and the Docker Compose plugin
- A domain name pointing at it, if you want HTTPS (recommended for anything beyond your own laptop)
- Optional: an SMTP account for sign-in links and invites, and a Google OAuth client

## Set up

```sh
git clone <this repository> atelier
cd atelier
cp .env.example .env
```

Edit `.env`:

- `PUBLIC_URL`: the address people will use, with no trailing slash, for example `https://atelier.example.com`
- `POSTGRES_PASSWORD`: any password of letters and digits (`openssl rand -hex 24`)
- `SESSION_SECRET`: at least 32 characters (`openssl rand -base64 48`)

Then start it:

```sh
docker compose up -d
curl http://localhost:8787/health   # ok
```

The server applies its database migrations on startup. Put the server address in the extension's sync settings and create an account.

## HTTPS with Caddy

Run a reverse proxy in front of the server so traffic is encrypted. With Caddy, a `Caddyfile` on the same host:

```
atelier.example.com {
    reverse_proxy localhost:8787
}
```

Set these in `.env` and restart with `docker compose up -d`:

```
PUBLIC_URL=https://atelier.example.com
TRUST_PROXY=true
BIND_ADDRESS=127.0.0.1
```

`BIND_ADDRESS=127.0.0.1` is required whenever `TRUST_PROXY=true`. By default Docker publishes the port on every interface (`0.0.0.0`), and it does so ahead of host firewalls such as ufw. Anyone could then reach the server directly, bypassing Caddy, and send a forged `X-Forwarded-For` to dodge the login rate limit. Binding to `127.0.0.1` leaves the proxy on the same host as the only way in.

`TRUST_PROXY=true` makes the login rate limit use the client address Caddy puts last in `X-Forwarded-For`. Set it only when a proxy you control sits in front, and never when the port is reachable directly: a client could then pick its own address and dodge the limit. With the default `false` the limit uses the connection's address, which behind a proxy is the proxy itself, so all users share one limit. nginx works the same way; make sure it sets `X-Forwarded-For` (`proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`) and that WebSocket upgrades are passed through for live updates.

To keep the server off the public network, change the `ports` line in `docker-compose.yml` to `"127.0.0.1:8787:8787"` so only the proxy can reach it.

## Email (optional)

Set both variables to turn on email sign-in links and workspace invitation emails:

```
SMTP_URL=smtps://user:password@smtp.example.com:465
SMTP_FROM=Atelier <atelier@example.com>
```

Use `smtp://` with port 587 for STARTTLS. Without them, only password and Google sign-in are offered.

## Sign in with Google (optional)

1. In the Google Cloud console create an OAuth client of type Web application.
2. Add the authorised redirect URI `<PUBLIC_URL>/auth/google/callback`, for example `https://atelier.example.com/auth/google/callback`.
3. Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in `.env` and restart.

## Security notes

- Password sign-ups do not verify the email address. Anyone who can reach the server can register any address with a password.
- Workspace invitations to an email without an account attach to whoever signs up with that email.
- When someone later signs in with an email link or Google for an address that was registered with a password, the password and all of that account's sessions are removed, so a pre-registered account cannot be kept by the person who created it. Until then, treat password accounts as unverified.
- Once you have created your accounts, set `ALLOW_SIGNUP=false` and restart. Password sign-up is then refused and email links and Google create no new accounts; existing users can still sign in. Invited emails can only sign in if SMTP (email link) or Google is configured, since password sign-up is refused. Configure SMTP or Google before inviting people to a closed server.
- Run the server behind HTTPS, and keep `.env` private: it holds the session secret and database password.

## Backups

All data is in the Postgres volume `atelier-db`. Dump it:

```sh
docker compose exec -T db pg_dump -U atelier atelier | gzip > atelier-$(date +%F).sql.gz
```

Restore into a fresh install (after `docker compose up -d db`):

```sh
gunzip -c atelier-2026-01-01.sql.gz | docker compose exec -T db psql -U atelier atelier
```

## Upgrading

```sh
git pull
docker compose build
docker compose up -d
```

Migrations run automatically when the new server starts. Take a backup first. `docker compose down` keeps your data; `docker compose down -v` deletes the database volume.

## Environment reference

See `.env.example` for every variable: `PUBLIC_URL`, `POSTGRES_PASSWORD`, `SESSION_SECRET`, `PORT`, `BIND_ADDRESS`, `TRUST_PROXY`, `ALLOW_SIGNUP`, `SMTP_URL`, `SMTP_FROM`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`.
