# Security

## 1. Implemented controls (Phase A)

| Control | Implementation | Verified by |
|---|---|---|
| Password storage | argon2id (19 MiB, t=2, p=1). Rehashed on login when the parameters change. | Code review |
| Password policy | At least 12 characters and three character classes, for staff accounts. | `rbac.test.ts` |
| Generic login errors | One message for an unknown account, a wrong password, a lock or a disabled account. A dummy hash equalises timing. | `auth.test.ts` |
| Account lockout | 5 failures lock the account for 15 minutes. Both values are configurable. | `auth.test.ts` |
| Rate limiting | Global 300 requests per minute per IP. Login 10 per minute per IP. | Manual and e2e |
| Sessions | Opaque 256-bit token in an `HttpOnly`, `SameSite=Lax`, `Secure` (in production) cookie. Only its SHA-256 is stored. 12-hour absolute and 60-minute idle expiry. Revoked server-side on logout and when a user is disabled. | `auth.test.ts`, `rbac.test.ts` |
| CSRF | State-changing requests need `X-CSRF-Token`, which is an HMAC of the session token. Foreign `Origin` headers are rejected, which also prevents login CSRF. | `auth.test.ts` |
| Authorization | `AccessService` on every data operation. Scope comes from the database. Cross-tenant ids return 404. | `isolation.test.ts`, `rbac.test.ts` |
| Escalation prevention | Explicit assignable-role lists. Participant roles cannot be granted by hand. | `rbac.test.ts`, shared unit tests |
| Audit | Append-only `audit_logs`, enforced by triggers. Written in the same transaction as the change. Sensitive metadata keys are redacted. | `rbac.test.ts` |
| Input validation | Zod on every body. JSON limited to 1 MB. UUID parsing on ids. | Tests |
| Error hygiene | The global filter returns generic 500s and logs details with the request id. | Code review |
| HTTP headers | helmet on the API. Frame denial, nosniff, referrer and permissions policies on the web. | Code review |
| Secrets | Environment variables only. Env is validated at boot. Production refuses non-secure cookies. | Code review |
| Platform admin limits | No shareholder PII, ballot or meeting operation permissions. | Shared unit tests |

## 2. Planned controls

| Phase | Control |
|---|---|
| B | Shareholder OTP: 6 digits, stored hashed, 5-minute TTL, 5 attempts, per-identifier and per-IP limits, never logged. MFA (TOTP) for staff with WebAuthn later. Mandatory for Platform and Company Admins before production. |
| B | PostgreSQL row-level security on shareholder, voting and communication tables. |
| B | Secure uploads: type sniffing, size limits, pre-signed private object storage, malware scan hook, and no public buckets. |
| B | PII masking: BO IDs shown as `1201****5678` unless the user has `shareholder.pii.read`. |
| E | Ballot secrecy, privileged access grants (time-boxed, justified, dual-approved, audited) and hash-chained vote audit. |
| F | Dependency and secret scanning in CI, a DAST pass, a penetration test before go-live, and a backup and restore drill. |

## 3. Threat model summary

| Threat | Mitigation |
|---|---|
| Account takeover of a shareholder | OTP to a verified contact from the register. Rate limits. Device and session audit. Proxy and corporate authorization checks. |
| Insider alters votes | No ballot UPDATE path, enforced by a trigger. Hash-chained audit. Separation of the configuring and operating roles. Results sealed until release. |
| Cross-tenant data leak | API filters plus composite FKs, plus RLS from Phase B. 404 on foreign ids. Isolation test suite. |
| Duplicate or replayed votes | Unique effective-ballot index, idempotency keys, row locks. |
| Platform operator overreach | Platform roles exclude PII and ballots. Privileged grants are audited and visible to the company. |
| CSRF or clickjacking | CSRF token, origin check, SameSite cookies, `X-Frame-Options: DENY`. |
| Log leakage | Metadata redaction. Tokens, OTPs and passwords never logged. Request ids for correlation. |

## 4. Reporting a vulnerability

Report issues privately to the platform security contact set in `DEPLOYMENT.md`. Never report them in a public issue tracker.
