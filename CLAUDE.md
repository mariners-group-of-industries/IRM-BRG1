# CLAUDE.md

Guidance for AI coding agents working in this repository.

## Project

IRM Platform, a modular monolith. The first module is AGM/EGM management for Bangladeshi companies. Read `docs/ROADMAP.md` to see which phase is current. Do not build modules outside the current phase.

## Commands

```bash
pnpm db:start                          # embedded PostgreSQL on :5433 (long-running)
pnpm db:stop                           # stop it cleanly, even after a crash
pnpm build:shared                      # rebuild @irm/shared after editing it; api and web consume dist/
pnpm dev:api                           # API on :4000
pnpm dev:web                           # web on :3100. Port 3000 is often taken on dev machines.
pnpm --filter @irm/api test            # integration tests against irm_test
pnpm --filter @irm/shared test
pnpm --filter @irm/web build
pnpm e2e                               # needs API and web running
pnpm --filter @irm/api exec prisma migrate dev --name <name> --create-only   # then review the SQL
```

`prisma migrate dev` can hang in non-interactive shells. Generate SQL by diffing against the dev database, review it, append hand-written constraints, then apply it:

```bash
pnpm --filter @irm/api exec prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script > prisma/migrations/<timestamp>_<name>/migration.sql
pnpm --filter @irm/api exec prisma migrate deploy
```

The diff does not know about hand-written SQL objects such as composite FKs, partial indexes, triggers and RLS policies. **Delete any DROP it emits for them.**

## Non-negotiable rules

1. **Authorization lives in the API.** Every controller method that touches tenant or company data calls `AccessService.assert`, `assertCompany` or one of its `*Filter` helpers. UI permission checks only hide controls.
2. **Permissions come from `packages/shared/src/permissions.ts` and `roles.ts`.** Never hard-code role names in API logic. Check permissions instead. After changing the catalogue, run `pnpm build:shared` and `pnpm db:seed`, then update `docs/ROLES_AND_PERMISSIONS.md`.
3. **Cross-tenant ids return 404, not 403.** This prevents probing for ids.
4. **Audit every state change.** Write the audit record inside the same transaction as the change: `audit.record(event, tx)`. Never put secrets, tokens, OTPs or ballot choices in audit metadata.
5. **The audit log is append-only.** A database trigger enforces it. Do not try to work around it.
6. **Never present a simulation as a real integration.** This applies especially to video and SMS/OTP providers. Label development adapters clearly.
7. **Legally sensitive rules are configuration, not code constants.** Examples are quorum, poll-demand thresholds, vote changes and proxy limits. See `docs/VOTING_RULES.md`.
8. **Never claim a test passed without running it.**
9. **Destructive database changes need human approval.** This covers dropping columns, rewriting data and resetting the dev database.
10. **Read and write shareholder data only through `prisma.scoped([companyId], tx => ...)`.** That transaction switches to the restricted `irm_app` role, so row-level security applies. New company-owned tables need `tenant_id`, `company_id`, the composite FK, and an RLS policy in their migration.
11. **Shareholder identifiers and contacts are masked** unless the caller has `shareholder.pii.read` for that company. Unmasked detail views are audited.
12. **Never trust uploaded files.** Detect the type with `sniffFileType`, store through `StorageService`, and serve only through authorized endpoints.
13. **Holdings are versioned.** Close the current row (`valid_to`) and insert a new one. A trigger blocks every other update and all deletes.
14. **Sign-in codes.** Never log or audit a one-time code, and keep responses identical whether or not an account matched.

## Conventions

- The API is TypeScript ESM. Relative imports end in `.js`. NestJS DI needs decorator metadata, so tests use SWC through `unplugin-swc`.
- Validate request bodies with shared Zod schemas through `parseBody`.
- Database: UUIDv7 keys, snake_case tables, timestamptz. Company-owned rows carry `tenant_id` and `company_id`.
- Web: Next.js App Router. Pages under `app/(app)` are client components that use TanStack Query and the `api` client in `lib/api.ts`. The client sends the CSRF header automatically.
- UI: use `@irm/ui` primitives and design tokens only. Read `DESIGN.md` and `docs/UI_GUIDELINES.md` before adding UI.
- Commits: one meaningful milestone per commit. Keep docs in sync in the same commit.

## Design tooling

- `DESIGN.md` is the design source of truth. It follows the awesome-design-md format.
- `.mcp.json` registers the Microsoft Playwright MCP server for browser checks.
- See `docs/UI_GUIDELINES.md` for the optional design skills and their install status.
