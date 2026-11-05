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
- Staff MFA was delivered in Phase B.
- Users are created with an admin-set initial password, because email invitations need an email provider.
- "Add member" used two calls, so a failure could leave an account without a role. Phase B replaced it with one transactional endpoint.

## Phase B: Shareholder system (complete, 2026-11-05)

Delivered:
- Share classes, shareholders (individual and corporate), BO and folio accounts, register contacts, and versioned holdings.
- A register import pipeline for CSV and XLSX: upload, column mapping with suggestions, row validation, duplicate detection, preview, confirmed commit, cancel and history.
- Corporate representatives and proxies with documents, four-eyes approval, rejection and revocation.
- Shareholder, representative and proxy sign-in by one-time code, plus a participant portal.
- Staff two-step verification (TOTP) with recovery codes and optional enforcement for admins.
- PII masking, private file storage, and PostgreSQL row-level security on all shareholder tables.

| Acceptance criterion | Status | Evidence |
|---|---|---|
| 50,000-row register previews in under 30 s | Done | 9.5 s preview, 31.5 s commit. A re-import of the same file found 50,000 unchanged rows (`apps/api/scripts/perf-import.mjs`). |
| Per-row errors, nothing overwritten without confirmation, history kept | Done | `register.test.ts`: errors, duplicates, Excel precision loss, confirmation, versioning, immutable history trigger |
| OTP sign-in only to a verified contact; failed lookups reveal nothing | Done | `participants.test.ts`: identical responses, unverifiable decoy challenges, attempt and request limits |
| Proxy outside scope or past expiry cannot act | Done | Expired, pending and revoked proxies and representatives tested |
| RLS blocks cross-company reads even with hand-written SQL | Done | `register.test.ts`: raw SQL count and a cross-company insert under the restricted role |

Test totals: 18 shared unit tests, 71 API integration tests and 30 Playwright tests, on desktop and mobile.

Known limits:
- **Message delivery.** Sign-in codes go to a development outbox page. Real SMS and email providers are needed before production, and the API refuses to boot in production without one.
- **Storage.** Files use the local-disk storage driver. The S3-compatible driver is designed behind the same interface but not built, because no object store is available here.
- **Meeting link for proxies.** Proxies carry a free-text meeting reference. Phase C adds the meeting link and makes it mandatory.
- **RLS coverage.** RLS applies inside the API's company-scoped transactions, which switch to the restricted `irm_app` role. For defence in depth, production should also run the API under a non-owner database role. See DEPLOYMENT.md.
- **Approval needs two admins.** Four-eyes approval needs a second administrator with authorization rights. A company with a single admin cannot approve authorizations until a group admin or second admin is added.
- **Register contacts.** Contacts imported from the register count as verified. Manual contact editing is not built yet.

## Phase C: Meeting management (next)

Meetings, the state machine, agenda and resolutions, documents, rules configuration with schema validation, participant registration, the record-date snapshot, and the meeting control center.

## Phase D: Live AGM experience

The shareholder meeting room, the video provider adapter (Zoom, plus a labelled simulator), attendance, proposed, seconded and poll demand, text and audio questions, the moderator dashboard, the board view, and Socket.IO real-time.

## Phase E: Secure voting

Entitlements, voting sessions, ballot casting with idempotency, weighted tally, hash-chained vote audit, results release, and privileged access grants. The required test list is in `VOTING_RULES.md`.

## Phase F: Reports and hardening

PDF and Excel reports, minutes, accessibility audit, load test, security testing, a backup and restore drill, and deployment readiness.
