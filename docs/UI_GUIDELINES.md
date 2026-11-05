# UI Component Guidelines

Read `DESIGN.md` first. This file covers how to build screens with `@irm/ui`.

## Building a page

```tsx
<PageHeader title="Companies" description="One sentence on what this page is for." actions={<Button>New company</Button>} />
<Panel>
  <PanelHeader title="…" description="optional" actions={…} />
  {/* table, list or definition list */}
</Panel>
```

- One `PageHeader` per page, with at most one primary action.
- Group content in `Panel`s. Do not nest panels. Use dividers (`divide-y divide-line`) inside a panel.
- Every data region handles all three states: `Skeleton` while loading, `Alert tone="danger"` on error, and `EmptyState` when empty.

## Forms

- Use React Hook Form with `zodResolver(sharedSchema)` so the same schema validates in the browser and the API.
- Wrap each control in `Field`, which gives you the label, hint, error and aria wiring.
- Map API `fieldErrors` back with `form.setError`. Show other errors in an `Alert` at the top of the form.
- Create and edit forms belong in a `Dialog` when short (up to 8 fields). Longer forms get their own page.
- Destructive actions need a confirmation that names the consequence.

## Tables

- Use the `Table`, `THead`, `TR`, `TH` and `TD` primitives. Use TanStack Table v8 when you need sorting or column definitions.
- The first column identifies the row and links to its detail page. Status sits on the right as a `Badge`.
- On narrow screens hide secondary columns with `hidden md:table-cell` and similar classes. The table itself scrolls inside its wrapper, never the page.
- Numbers right-aligned with `tabular`.

## Permissions in the UI

- Use `useSession().can(permission, { tenantId, companyId })` for resource-specific controls. Use `canAnywhere` only for navigation.
- Hiding a control is a courtesy. The API decides.

## Copy

Sentence case. Verbs on buttons. Plain-language errors with a next step. Use "group" for tenant in user-facing copy where it reads better.

## Design tooling status

| Tool | Status | Notes |
|---|---|---|
| Awesome DESIGN.md | Used as format reference | `DESIGN.md` follows its structure. No install step exists. |
| Microsoft Playwright MCP | Configured in `.mcp.json` | `npx @playwright/mcp@latest`. The Playwright test suite in `tests/e2e` covers automated checks. |
| Vercel web design guidelines | Not installed | Install with `npx skills add vercel-labs/agent-skills`. It fetches skills from GitHub. Review the downloaded skill before relying on it. |
| Taste Skill | Not installed | `npx skills add https://github.com/Leonxlnx/taste-skill --skill "design-taste-frontend"` |
| Impeccable | Not installed, needs owner approval | `npx impeccable install` adds Claude Code hooks that run even when commands are denied, downloads an engine binary, and has telemetry, which you can turn off with `npx impeccable telemetry off`. Review it before enabling. |

The three skill installers were not run unattended. Each fetches third-party content that then acts as instructions to the coding agent. The project owner should review and approve them.
