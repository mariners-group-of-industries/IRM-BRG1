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

Request and response TypeScript types are in `packages/shared/src/api-types.ts`.
