# Roles and Permissions

Source of truth: `packages/shared/src/permissions.ts` and `roles.ts`. The seed syncs them into the `roles`, `permissions` and `role_permissions` tables. The web app renders the live matrix at **Roles & permissions**.

## Scopes

| Scope | Applies to | Example |
|---|---|---|
| PLATFORM | Everything, but only with platform permissions | Platform operator |
| TENANT | The tenant and every company in it | Group company secretary for all Meghna companies |
| COMPANY | One company | Company secretary of Meghna Cement |

A check passes when **any** active assignment both holds the permission and covers the resource. The resource's tenant is always resolved from the database.

## Roles

| Role | Scopes | Participant | Can grant |
|---|---|---|---|
| Platform Super Admin | Platform | No | Platform Super Admin, Company Admin |
| Company Admin | Tenant, Company | No | Company Admin, Meeting Admin, Board Member, Moderator, Company Official |
| Meeting Admin | Company | No | None |
| Board Member | Company | No | None |
| Moderator | Company | No | None |
| Company Official | Company | No | None |
| Individual Shareholder | Company | Yes | None |
| Corporate Representative | Company | Yes | None |
| Proxy Representative | Company | Yes | None |

**Grant rule.** A user may grant role R at scope S only if they hold an assignment that covers S, includes `role.assign`, and whose role lists R in its assignable roles. A company-scoped assignment can never grant at tenant or platform scope.

**Participant roles** are never granted by hand. They are created by shareholder verification, corporate authorization and proxy approval in Phase B. Every participation action additionally requires a **voting entitlement** for the specific meeting. A role alone never allows a vote.

## Permission matrix

PA is Platform Admin, CA is Company Admin, MA is Meeting Admin, BM is Board Member, MO is Moderator, CO is Company Official, and SH is Shareholder, Corporate Representative and Proxy.

| Permission | PA | CA | MA | BM | MO | CO | SH |
|---|---|---|---|---|---|---|---|
| platform.settings.manage | ✓ | | | | | | |
| platform.audit.read | ✓ | | | | | | |
| tenant.read | ✓ | | | | | | |
| tenant.manage | ✓ | | | | | | |
| company.read | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | |
| company.create | ✓ | | | | | | |
| company.update | ✓ | ✓ | | | | | |
| user.read | ✓ | ✓ | | | | | |
| user.manage | ✓ | ✓ | | | | | |
| role.assign | ✓ | ✓ | | | | | |
| audit.read | ✓ | ✓ | | | | | |
| shareholder.read | | ✓ | ✓ | | | | |
| shareholder.import | | ✓ | | | | | |
| shareholder.pii.read | | ✓ | | | | | |
| meeting.read | | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| meeting.create | | ✓ | | | | | |
| meeting.update | | ✓ | | | | | |
| meeting.control | | | ✓ | | | | |
| agenda.manage | | ✓ | | | | | |
| document.manage | | ✓ | | | | | |
| announcement.manage | | | ✓ | | | | |
| attendance.read | | ✓ | ✓ | ✓ | | ✓ | |
| meeting.join.board | | | | ✓ | | | |
| meeting.join.shareholder | | | | | | | ✓ |
| proposal.submit | | | | | | | ✓ |
| seconding.submit | | | | | | | ✓ |
| polldemand.submit | | | | | | | ✓ |
| vote.cast | | | | | | | ✓ |
| question.submit | | | | | | | ✓ |
| question.moderate | | | | | ✓ | | |
| question.forwarded.read | | | | ✓ | ✓ | | |
| voting.control | | | ✓ | | | | |
| voting.results.read | | ✓ | ✓ | ✓ | | | |
| voting.results.release | | | ✓ | | | | |
| ballot.individual.read | | | | | | | |
| report.generate | | ✓ | ✓ | | | | |

`ballot.individual.read` belongs to no role. Phase E adds a **privileged access grant**: a time-boxed, justified, dual-approved grant for a named scrutineer. It is recorded in the audit log and visible to the company admin.

Board members see voting results only after release. Phase E enforces this in the voting module.

## Deliberate boundaries

- Platform admins operate the platform but **cannot** see shareholder personal data, ballots or meeting operations. They can bootstrap a company's first Company Admin.
- Company Admins configure meetings but **cannot** open or close voting or release results. That is the Meeting Admin's job, which separates configuration from operation.
- Moderators see questions but not the register.
- Nobody can edit a submitted ballot. Corrections follow the configured vote-change rule and are performed by the voter.
