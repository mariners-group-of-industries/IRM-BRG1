# IRM Platform

Investor Relationship Management platform for companies in Bangladesh. The first module is **AGM/EGM Management**: digital annual and extraordinary general meetings with shareholder verification, live video, agenda control, proposals, poll demands, electronic voting, moderated questions and reporting.

This repository is a modular monolith in a pnpm monorepo.

| Status | |
|---|---|
| Phase A, foundation | **Complete.** |
| Phase B, shareholder system | **Complete.** See [docs/ROADMAP.md](docs/ROADMAP.md) |
| Phase C, meeting management | Next |

## What works today

- Staff sign-in with server-side sessions, CSRF protection, origin checks, rate limiting, account lockout and optional two-step verification (TOTP).
- Tenants (corporate groups) and companies, with isolation enforced on every API query and by PostgreSQL row-level security on shareholder data.
- Nine roles and 37 permissions from one shared catalogue, plus role assignment that blocks privilege escalation.
- The shareholder register: BO and folio accounts, versioned holdings and masked personal data.
- Register imports from CSV or Excel, with column mapping, row-by-row preview and confirmed commit.
- Corporate representatives and proxies, which need approval by a second administrator.
- Shareholder, representative and proxy sign-in with one-time codes, plus a participant portal with Bangla labels.
- An append-only audit log, enforced by a PostgreSQL trigger.

## Repository layout

```
apps/
  api/        NestJS 12 REST API, Prisma 7, PostgreSQL
  web/        Next.js 16 App Router frontend
packages/
  shared/     Permission catalogue, roles, RBAC rules, Zod schemas, API types
  ui/         Design tokens and accessible React primitives
  config/     Shared TypeScript configuration
tests/
  e2e/        Playwright browser tests
infrastructure/
  dev-db/     Embedded PostgreSQL launcher for machines without Docker
  docker-compose.yml
docs/         Product, architecture, database, security and workflow documentation
```

## Requirements

- Node.js 24 or newer
- pnpm 12
- PostgreSQL 16 or newer. You can use Docker Compose, a local install, or the bundled embedded server.

## Quick start

```bash
pnpm install
pnpm build:shared

# 1. Database. Option A needs no Docker:
pnpm db:start                      # embedded PostgreSQL 18 on 127.0.0.1:5433; keep it running
# Option B, with Docker:
#   docker compose -f infrastructure/docker-compose.yml up -d
#   then set DATABASE_URL to port 5432 in apps/api/.env

# 2. API configuration and schema
cp apps/api/.env.example apps/api/.env      # then set SESSION_SECRET
pnpm --filter @irm/api exec prisma migrate deploy
pnpm db:seed

# 3. Run the apps, each in its own terminal
pnpm dev:api                       # http://127.0.0.1:4000/api/v1, Swagger at /api/docs
pnpm dev:web                       # http://localhost:3100
```

Generate a session secret with:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

## Development accounts

The seed creates fictitious companies and these staff accounts. They are for development only. The password is the `SEED_DEFAULT_PASSWORD` value in `apps/api/.env`.

| Email | Role | Scope |
|---|---|---|
| platform.admin@irm.local | Platform Super Admin | Platform |
| group.admin@meghna.example | Company Admin | Meghna Holdings Group, every company |
| cs@meghnacement.example | Company Admin | Meghna Cement Mills PLC |
| meeting.admin@meghnacement.example | Meeting Admin | Meghna Cement Mills PLC |
| moderator@meghnacement.example | Moderator | Meghna Cement Mills PLC |
| director@meghnacement.example | Board Member | Meghna Cement Mills PLC |
| cs@padmapharma.example | Company Admin | Padma Pharmaceuticals PLC |

### Try the shareholder sign-in

Meghna Cement Mills PLC has a small fictitious register. Find its company id on the Companies page or in the URL, then open:

```
http://localhost:3100/join/<company-id>
```

| Sign in as | Enter | Code is sent to |
|---|---|---|
| Shareholder | BO ID `1201950000000002` | rokeya.begum@example.com |
| Shareholder | Folio `F-00017` | +8801811000017 |
| Company representative | imran.hossain@deltalife.example | that email |
| Proxy | nasima.akter@example.com | that email |

No real SMS or email is sent in development. Read the code at http://localhost:3100/dev/outbox. That page and its API are disabled in production.

A sample register to import is in `docs/samples/register-sample.csv`. Its last row is deliberately invalid, so you can see the error preview.

## Testing

```bash
pnpm --filter @irm/shared test     # RBAC and identifier unit tests
pnpm --filter @irm/api test        # API integration tests; rebuilds the irm_test database
pnpm --filter @irm/web build       # production build and type check
pnpm e2e                           # Playwright; needs the API and web servers running
```

API tests refuse to run against a database whose name does not end in `_test`. Browser tests use the development database and add a uniquely named company on each run.

## Documentation

| Document | Contents |
|---|---|
| [docs/PRD.md](docs/PRD.md) | Product requirements for the AGM/EGM module |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Module boundaries, request flow, technology choices |
| [docs/DATABASE.md](docs/DATABASE.md) | Entity model, ERD, isolation constraints |
| [docs/ROLES_AND_PERMISSIONS.md](docs/ROLES_AND_PERMISSIONS.md) | Roles, permission matrix, assignment rules |
| [docs/AGM_WORKFLOW.md](docs/AGM_WORKFLOW.md) | Meeting lifecycle and stage controls |
| [docs/VOTING_RULES.md](docs/VOTING_RULES.md) | Voting engine rules and legal configuration points |
| [docs/SECURITY.md](docs/SECURITY.md) | Security controls and threat model |
| [docs/API.md](docs/API.md) | REST API reference |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Environments, configuration, backups |
| [docs/ROADMAP.md](docs/ROADMAP.md) | Phases and acceptance criteria |
| [DESIGN.md](DESIGN.md) | Design system |
| [docs/UI_GUIDELINES.md](docs/UI_GUIDELINES.md) | Component usage rules |
