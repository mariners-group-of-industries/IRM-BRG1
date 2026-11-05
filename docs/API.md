# API Reference

Base path: `/api/v1`. Interactive OpenAPI docs are served at `/api/docs` outside production.

**Authentication.** Sign in with `POST /auth/login`, which sets the `irm_session` cookie and returns a `csrfToken`. Send `X-CSRF-Token: <csrfToken>` on every POST, PATCH and DELETE. `GET /auth/me` also returns the current token.

**Errors** always have this shape:

```json
{ "statusCode": 400, "message": "Validation failed", "errors": { "email": ["Enter a valid email address"] } }
```

| Status | Meaning |
|---|---|
| 401 | No session, or the session expired |
| 403 | Signed in but not permitted, or a CSRF or origin failure |
| 404 | Not found, **or not visible to you**. Cross-tenant ids always return 404. |
| 409 | Uniqueness conflict |
| 429 | Rate limited |

## Endpoints (Phase A)

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/health` | public | Database liveness |
| POST | `/auth/login` | public | Body `{ email, password }`. Limited to 10 per minute per IP. |
| POST | `/auth/logout` | session | Revokes the session server-side |
| GET | `/auth/me` | session | User, role assignments with permissions, and the CSRF token |
| GET | `/tenants` | session | Platform users see all tenants. Others see their own. |
| POST | `/tenants` | `tenant.manage` | `{ name, slug }` |
| PATCH | `/tenants/:id` | `tenant.manage` | `{ name?, status? }` |
| GET | `/companies?q=&tenantId=&page=&pageSize=` | `company.read`, filtered | Paginated |
| GET | `/companies/:id` | `company.read` on the company | |
| POST | `/companies` | `company.create` on the tenant | See `createCompanySchema` |
| PATCH | `/companies/:id` | `company.update`. Changing `status` also needs `tenant.manage`. | |
| GET | `/users?q=&page=&companyId=` | `user.read`, filtered | Only assignments inside the caller's scope are returned |
| POST | `/users` | `user.manage` | `{ email, fullName, password }`. Password policy enforced. |
| POST | `/users/:id/disable` | `user.manage` | Revokes all of the user's sessions |
| GET | `/roles` | session | Role catalogue and permission descriptions |
| POST | `/assignments` | `role.assign`, plus the grant rule | `{ userId, roleKey, scope, tenantId?, companyId? }` |
| DELETE | `/assignments/:id` | `role.assign` on the assignment scope | |
| GET | `/dashboard/summary` | session | Counts and lists scoped to the caller |
| GET | `/audit?page=&action=` | `audit.read` or `platform.audit.read` | `action` is a prefix filter such as `auth.` |

| POST | `/companies/:id/members` | `user.manage` plus the grant rule | `{ email, fullName, password, roleKey }`. Creates the account and role in one transaction. |

## Endpoints (Phase B)

### Staff two-step verification

| Method | Path | Access | Notes |
|---|---|---|---|
| POST | `/auth/login` | public | Returns `{ mfaRequired: true, mfaToken }` and no cookie when MFA is on |
| POST | `/auth/mfa/verify` | public | `{ mfaToken, code }`. The code is a 6-digit TOTP or a recovery code. Sets the session. |
| POST | `/auth/mfa/setup` | session | Returns `{ secret, otpauthUrl, qrDataUrl }`. Not active until enabled. |
| POST | `/auth/mfa/enable` | session | `{ code }`. Returns 10 recovery codes once. |
| POST | `/auth/mfa/disable` | session | `{ code }` |

Responses blocked by MFA enforcement return 403 with `"code": "MFA_SETUP_REQUIRED"`.

### Shareholder register

Every company-scoped path is `/companies/:companyId/...`.

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `register/summary` | `shareholder.read` | Counts, shares by class, last import |
| GET / POST | `share-classes` | read / `shareholder.import` | `{ code, name, votesPerShare }` |
| GET | `shareholders?q=&type=&page=` | `shareholder.read` | `q` matches name or an exact BO ID or folio. Masked without `shareholder.pii.read`. |
| GET | `shareholders/:id` | `shareholder.read` | Accounts, contacts, current holdings and history. Unmasked views are audited. |
| GET / POST | `imports` | `shareholder.import` | POST is multipart with field `file` (CSV or XLSX, up to 25 MB) |
| GET | `imports/:id` | `shareholder.import` | Includes `suggestedMapping` and `sampleRows` before commit |
| POST | `imports/:id/validate` | `shareholder.import` | `{ mapping, mode: FULL|DELTA, asOfDate }` |
| GET | `imports/:id/rows?filter=ERROR|NEW|CHANGED|UNCHANGED|CLOSED&page=` | `shareholder.import` | 50 per page |
| POST | `imports/:id/commit` | `shareholder.import` | `{ acceptErrors?: boolean }`. A FULL import with errors is always refused. Returns 409 if the register changed after validation. |
| POST | `imports/:id/cancel` | `shareholder.import` | |

### Corporate representatives and proxies

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `corporate-representatives`, `proxies` | `shareholder.read` | |
| POST | `corporate-representatives` | `authorization.manage` | Multipart: `shareholderId`, `fullName`, `designation?`, `email`, `phone?`, `identityIds` (repeated), `validFrom`, `validUntil`, plus an optional `document` (PDF, PNG or JPEG, up to 10 MB) |
| POST | `proxies` | `authorization.manage` | Multipart: `grantorShareholderId`, `fullName`, `email`, `phone?`, `scope`, `meetingReference`, `validFrom`, `validUntil`, plus an optional `document` |
| POST | `:kind/:id/decision` | `authorization.manage` | `{ decision: APPROVE|REJECT|REVOKE, note? }`. The creator cannot approve. |
| GET | `:kind/:id/document` | `authorization.manage` | Download. Audited. |

### Participants

| Method | Path | Access | Notes |
|---|---|---|---|
| GET | `/participant/companies/:id` | public | Company name for the sign-in page |
| POST | `/participant/otp/request` | public | `{ kind: SHAREHOLDER, companyId, identifier }`, or `{ kind: CORPORATE_REPRESENTATIVE|PROXY_REPRESENTATIVE, companyId, email }`. Always returns the same message. |
| POST | `/participant/otp/verify` | public | `{ challengeId, code }`. Sets the session. |
| GET | `/participant/me` | participant session | What the person represents, per company |
| GET | `/dev/outbox` | public, development only | Returns 404 in production |

## Endpoints (Phase C)

### Meetings (staff)

All paths are under `/companies/:companyId/meetings`.

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET / POST | `/` | `meeting.read` / `meeting.create` | POST `{ type, title, scheduledStart (ISO with offset), recordDate, mode, venue? }` |
| GET / PATCH | `/:id` | `meeting.read` / `meeting.update` | Editable in Draft and Scheduled only |
| PUT | `/:id/rules` | `meeting.update` | The full rules object (see `meetingRulesSchema`). Locked once live. |
| GET | `/:id/control` | `meeting.read` | Next transitions with readiness checks, and history |
| POST | `/:id/transition` | per the transition table | `{ to, expectedVersion, reason? }`. Returns 409 if not ready, not allowed by the state machine, or stale. |
| GET / POST | `/:id/agenda` | read / `agenda.manage` | `{ number, title, description?, hasResolution, resolutionKind, resolutionText, requiresProposal, requiresSeconding }` |
| PATCH / DELETE | `/:id/agenda/:itemId` | `agenda.manage` | |
| POST | `/:id/agenda/order` | `agenda.manage` | `{ ids }`, every item exactly once |
| GET / POST | `/:id/documents` | read / `document.manage` | Multipart `file` (PDF only, up to 25 MB), `kind`, `title`, `agendaItemId?` |
| PATCH | `/:id/documents/:docId` | `document.manage` | `{ published }` or `{ removed: true }` |
| GET | `/:id/documents/:docId/download` | `meeting.read` | |
| GET / PUT | `/:id/staff` | read / `meeting.update` | `{ boardMemberIds, moderatorIds }`. Each person must hold that role in the company. |
| GET | `/:id/snapshot`, `/:id/entitlements?q=&page=` | `shareholder.read` | Accounts are masked without `shareholder.pii.read` |
| GET | `/:id/participants` | `attendance.read` | Registrations with votes |

| Transition | Permission |
|---|---|
| Draft → Scheduled, Scheduled → Draft (reason required), Completed → Archived | `meeting.update` |
| Scheduled → Registration Open | `meeting.update` or `meeting.control` |
| Registration Open → Live, Live ↔ Paused, Live or Paused → Completed | `meeting.control` |

### Meetings (participants)

| Method | Path | Notes |
|---|---|---|
| GET | `/participant/meetings` | Published meetings of the companies the person is linked to |
| GET | `/participant/meetings/:id` | Notice, agenda, published documents and eligibility per capacity |
| POST | `/participant/meetings/:id/register` | `{ key }` from `eligibility`. Idempotent. |
| GET | `/participant/meetings/:id/documents/:docId` | Published documents only |

Request and response TypeScript types are in `packages/shared/src/api-types.ts`, `shareholder-types.ts` and `meeting-types.ts`.
