# Roadmap

Phases are delivered in order. Each phase ends with working code, passing tests, browser verification and updated docs.

## Phase A: Foundation (complete, 2026-11-05)

Delivered: monorepo, PostgreSQL and Prisma, staff authentication, tenants and companies, RBAC, the design system, the application shell, the admin dashboard, and the audit log.

| Definition of done | Status | Evidence |
|---|---|---|
| Application launches locally | Done | API on :4000, web on :3100 |
| Frontend connects to backend | Done | Next.js rewrite to `/api/v1` |
| Database migrations work | Done | `init_foundation` applied to dev and test databases |
| Authentication operational | Done | Login, logout, session expiry, lockout, CSRF |
| Tenant and company isolation enforced | Done | 14 isolation tests |
| Roles and permissions implemented | Done | 9 roles, 36 permissions, grant rules |
| Admin layout works | Done | Desktop and mobile drawer |
| Dashboard uses real backend data | Done | Scoped `/dashboard/summary` |
| Automated tests pass | Done | 11 shared unit, 37 API integration and 22 Playwright tests |
| Basic Playwright checks pass | Done | Desktop 1440px and Pixel 7, including overflow checks |
| Setup documentation complete | Done | README, CLAUDE.md, docs/ |

Known limits:
- Staff MFA is designed but not built. It is scheduled for Phase B and required before production.
- Users are created with an admin-set initial password, because email invitations need an email provider.
- "Add member" creates the account and then the role in two calls. If the second call fails, an account without a role remains. Phase B moves this into one transactional endpoint.

## Phase B: Shareholder system (next)

Scope: share classes, shareholders, identities, contacts, versioned holdings, the CSV/XLSX import pipeline with mapping, validation, preview, confirmation and history, corporate representative and proxy authorizations, shareholder OTP sign-in, staff TOTP MFA, PII masking, row-level security, and private object storage.

Acceptance:
- Importing a 50,000-row register previews in under 30 seconds. Errors are reported per row. Nothing is overwritten without confirmation, and history is kept.
- A shareholder can sign in only with an OTP sent to a verified contact. Failed lookups do not reveal whether a holding exists.
- A proxy outside its meeting scope or past expiry cannot act. This is covered by tests.
- RLS blocks cross-company reads even with a hand-written query.

## Phase C: Meeting management

Meetings, the state machine, agenda and resolutions, documents, rules configuration with schema validation, participant registration, the record-date snapshot, and the meeting control center.

## Phase D: Live AGM experience

The shareholder meeting room, the video provider adapter (Zoom, plus a labelled simulator), attendance, proposed, seconded and poll demand, text and audio questions, the moderator dashboard, the board view, and Socket.IO real-time.

## Phase E: Secure voting

Entitlements, voting sessions, ballot casting with idempotency, weighted tally, hash-chained vote audit, results release, and privileged access grants. The required test list is in `VOTING_RULES.md`.

## Phase F: Reports and hardening

PDF and Excel reports, minutes, accessibility audit, load test, security testing, a backup and restore drill, and deployment readiness.
