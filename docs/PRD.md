# Product Requirements: AGM/EGM Management

**Product:** IRM Platform, Module 1, AGM/EGM Management
**Market:** Private, public unlisted and listed companies in Bangladesh, including corporate groups with several companies.
**Status:** Phase A delivered. This document covers the full module.

## 1. Problem

Companies hold annual and extraordinary general meetings with shareholders who are spread across the country and abroad. Digital and hybrid meetings need four things to be credible. Participants must be verified against the register. Voting rights must follow holdings on the record date. Proposals, seconding, poll demands and votes must be controlled and auditable. Results must be defensible. Generic video tools do none of this.

## 2. Goals

1. Run a complete AGM or EGM, from notice to minutes, inside one system.
2. Make every vote attributable to a verified entitlement and impossible to duplicate or silently alter.
3. Keep the shareholder experience simple enough for first-time digital participants.
4. Give company secretaries an auditable record suitable for regulators and auditors.
5. Lay a data foundation that later IRM modules can reuse: the shareholder register, holdings and communications.

Out of scope for this module: dividend distribution, the investor CRM, trading data, and document management beyond meeting documents.

## 3. Users

| Persona | Primary needs |
|---|---|
| Platform operator | Onboard tenants and companies. Operate the platform. No access to shareholder data or ballots. |
| Company admin (company secretary) | Import the register, create meetings, configure rules, manage staff, generate reports. |
| Meeting admin | Run the live meeting: open stages, open and close voting, release results. |
| Board member | Join the board video room, follow the agenda, read forwarded questions and released results. |
| Moderator | Triage text and audio questions. Approve, reject or forward them to the board. |
| Company official | Read-only meeting visibility. No voting. |
| Individual shareholder | Verify identity, join, follow the agenda, propose, second, demand a poll, vote, ask questions. |
| Corporate representative | Act for a corporate shareholder, possibly across several BO or folio accounts, under authorization. |
| Proxy | Act for a shareholder under a valid, meeting-specific proxy. |

## 4. Functional requirements

### 4.1 Foundation (Phase A)

- **F-1** Multi-tenant model: tenant (corporate group), then company. Tenant and company isolation is enforced server-side.
- **F-2** Staff authentication with sessions, lockout, rate limiting and CSRF protection.
- **F-3** Role-based access control with platform, tenant and company scopes. The role catalogue is in `ROLES_AND_PERMISSIONS.md`.
- **F-4** Company management: create, edit and suspend.
- **F-5** Staff membership management per company.
- **F-6** An append-only audit log of security-relevant and administrative events.
- **F-7** An admin dashboard showing real scoped data.

### 4.2 Shareholder system (Phase B)

- **S-1** Shareholder register import from CSV or Excel. The flow is upload, column mapping, validation, duplicate detection, preview, confirmation and history. Imports never silently overwrite. Changes are versioned.
- **S-2** Shareholder identity: individual or corporate, BO ID or folio, holdings by share class, and verified contacts.
- **S-3** Record-date snapshot per meeting. Holdings are frozen into immutable entitlement rows.
- **S-4** Corporate representative authorization: documents, the BO/folio accounts covered, validity and approval.
- **S-5** Proxy authorization: grantor, proxy identity, meeting scope, expiry, revocation and voting restrictions.
- **S-6** Shareholder sign-in. An identifier lookup is followed by an OTP to the verified contact registered for that holding. A BO ID, name or share count alone is never enough.

### 4.3 Meeting management (Phase C)

- **M-1** Create an AGM or EGM with title, company, schedule, timezone, notice, description, record date and documents.
- **M-2** A server-enforced state machine: Draft, Scheduled, Registration Open, Live, Paused (and back to Live), Completed, Archived.
- **M-3** Agenda items with number, title, description, resolution text, documents, order, status, and voting and results configuration.
- **M-4** Assign board members and moderators per meeting.
- **M-5** Participant registration and invitations.
- **M-6** Meeting configuration for every legal configuration point listed in `VOTING_RULES.md`.

### 4.4 Live meeting (Phase D)

- **L-1** A shareholder meeting room: header, live video as the main focus, agenda, the current action, questions and information.
- **L-2** Video through a provider abstraction (Zoom first). Server-side credentials and authorized joins only. A development-only simulator is clearly labelled.
- **L-3** Attendance records with join and leave events and live counts.
- **L-4** Proposed and Seconded stages are admin-activated. First-accepted-only acceptance is atomic, with identity and timestamp recorded.
- **L-5** Poll demand: admin-activated, eligibility-checked, one per entitlement, with counts and audit.
- **L-6** Text questions in Bangla and English. Audio questions with recording, preview, upload and a configurable maximum of 2 to 3 minutes. Nothing is published unmoderated.
- **L-7** A moderator queue (pending, approved, rejected, forwarded) with filters and history.
- **L-8** A board member view.
- **L-9** Real-time updates through authenticated, meeting-scoped channels. The database stays authoritative.

### 4.5 Voting (Phase E)

- **V-1** Agenda-wise voting with For, Against and Abstain, where configured.
- **V-2** Eligibility from record-date entitlements, including proxy and corporate rights.
- **V-3** Share-weighted or one-member-one-vote modes, per configuration.
- **V-4** One effective ballot per entitlement. Whether a ballot can be changed before closure is explicit configuration. Submissions use idempotency keys and database uniqueness.
- **V-5** Admin-controlled opening and closing, with deadlines.
- **V-6** Immutable vote audit events. No silent administrative ballot edits.
- **V-7** Results stay sealed until an authorized release. Individual choices are never visible to staff roles.

### 4.6 Reports (Phase F)

Attendance, participation, shareholder, proxy, proposed and seconded, poll demand, resolution-wise voting, moderation, minutes and the full audit report, as PDF and Excel/CSV. Every report shows the meeting, company, source data timestamps and generation time.

## 5. Non-functional requirements

| Area | Requirement |
|---|---|
| Security | See `SECURITY.md`. OWASP ASVS L2 is the target for authentication, session and access control. |
| Privacy | Shareholder identifiers are masked by default. Unmasking requires `shareholder.pii.read`. |
| Availability | A live meeting must survive API restarts. Clients reconcile from the database on reconnect. |
| Performance | 5,000 concurrent viewers per meeting, and vote submission p95 under 500 ms at 200 submissions per second. These targets are validated in Phase F. |
| Accessibility | WCAG 2.2 AA. Usable on a mid-range Android phone over 4G. |
| Localisation | English and Bangla UI. Bangla input everywhere. Dates in Asia/Dhaka time. |
| Auditability | Every state change is audited in the same transaction as the change. |

## 6. Assumptions and open questions

1. Legal rules differ by company type and articles of association. The system exposes them as configuration and does not assert compliance. A legal review of each company's configuration is required before production use.
2. OTP delivery needs an SMS or email provider. In development, OTPs go to a dev-only outbox and are never logged.
3. Video needs Zoom (or another provider) credentials. Without them, only the labelled simulator is available.
4. The register source format (CDBL BO data or a company folio register) must be confirmed per company. The import mapper supports both through column mapping.
