# Deployment

## Environments

| Environment | Database | Notes |
|---|---|---|
| Local | Embedded PostgreSQL (`pnpm db:start`) or Docker Compose | Seeded demo data |
| Test | `irm_test`, rebuilt by the API test suite | Never point it at a shared database |
| Staging and production | Managed PostgreSQL 16 or newer with PITR | No demo seed. Only the catalogue sync runs. |

## Configuration

API (`apps/api/.env`, validated at boot by `src/config/env.ts`):

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | yes | |
| `SESSION_SECRET` | yes | At least 32 random characters. Rotating it invalidates CSRF tokens, so users must refresh. |
| `WEB_ORIGIN` | yes | The exact browser origin, used for the origin check and CORS |
| `COOKIE_SECURE` | yes in prod | Must be `true` in production. Boot fails otherwise. |
| `SESSION_TTL_HOURS`, `SESSION_IDLE_MINUTES` | no | Default 12 hours and 60 minutes |
| `LOGIN_MAX_FAILURES`, `LOGIN_LOCK_MINUTES` | no | Default 5 failures and 15 minutes |
| `PORT` | no | Default 4000 |

Web: `API_ORIGIN` is the internal URL the Next.js server proxies `/api/v1` to.

## Build and release

```bash
pnpm install --frozen-lockfile
pnpm build:shared
pnpm --filter @irm/api build          # prisma generate + tsc
pnpm --filter @irm/web build
pnpm --filter @irm/api exec prisma migrate deploy
NODE_ENV=production pnpm --filter @irm/api exec prisma db seed   # syncs roles/permissions only
node apps/api/dist/main.js
pnpm --filter @irm/web start
```

Run the API and web behind a TLS-terminating reverse proxy that serves both on one public origin. Route `/api/v1/*` to the API or let Next.js rewrite it. The API trusts one proxy hop for client IPs.

## Docker Compose (local services)

`infrastructure/docker-compose.yml` provides PostgreSQL 18, plus Redis and MinIO for later phases.

## Backups

- Use managed PostgreSQL with point-in-time recovery and at least 35 days of retention. Take a daily logical dump to separate encrypted storage.
- Version object storage, with lifecycle rules matching statutory record retention.
- Snapshot the database immediately before and after each meeting goes Live and Completed. This is a Phase F runbook.
- Run a restore drill quarterly and before the first production meeting.

## Operations checklist before the first real meeting

- MFA enforced for all staff admins.
- Legal sign-off on the meeting's rules configuration (see `VOTING_RULES.md`).
- Video provider credentials configured and a test meeting held.
- SMS and email OTP provider configured and delivery tested.
- Load test passed at the expected attendance.
- Security contact and incident runbook published.
