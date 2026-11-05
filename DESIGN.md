# DESIGN.md: IRM Platform

The design system for every IRM surface: the admin console now, and later the shareholder meeting room, moderator queue and board view. Tokens live in `packages/ui/src/tokens.css`. Components live in `packages/ui/src/components`.

## 1. Character

**Calm, exact, trustworthy.** These screens run legally binding shareholder meetings. The interface should feel like a well-kept register, not a marketing site. Users range from company secretaries to elderly retail shareholders on a phone.

- **Minimal.** Every element earns its place. If removing it loses nothing, remove it.
- **Quiet surfaces, loud content.** Neutral canvas, white panels, and colour only where meaning lives.
- **Legible first.** Real text sizes, high contrast and generous line height. Bangla must render as well as English.
- **Predictable.** Same position, same control, same word, everywhere.

Avoid gradients, glassmorphism, decorative illustrations, emoji, oversized hero areas, card grids for their own sake, bouncy animation, and more than one accent colour.

## 2. Colour

| Token | Hex | Use |
|---|---|---|
| `canvas` | #F7F7F5 | App background (warm neutral) |
| `surface` | #FFFFFF | Panels, dialogs, inputs |
| `subtle` | #F1F1EE | Table header, hover, skeletons |
| `line` / `line-strong` | #E4E4DF / #D3D3CC | Dividers and borders / input borders |
| `ink` | #0F1B2D | Headings and primary text (deep navy) |
| `ink-2` | #3A4556 | Body text in tables |
| `ink-3` | #667085 | Secondary text and labels |
| `ink-4` | #98A1AE | Placeholders and disabled text |
| `accent` | #0E6B5C | The only brand colour: primary actions, active nav, focus |
| `accent-soft` / `accent-ink` | #E6F2EF / #0A4D42 | Accent tints |
| `success` / `warning` / `danger` / `info` | #067647 / #A15C07 / #B42318 / #1D4F91 | Status only, each with a `-soft` background |

The accent is a deep teal-green. It is calm, reads as institutional, and stays distinct from the success green. Text on the accent is white, with a contrast ratio of about 6.5:1.

**Rules.** One accent. Status colours never decorate. Body text is never lighter than `ink-3` on white.

## 3. Typography

- **Family:** Geist for Latin text and Noto Sans Bengali for Bangla, loaded through `next/font`. Mono is Geist Mono, used for codes such as trading codes and identifiers.
- **Scale:** page title 22px semibold with −0.01em tracking. Panel title 14px semibold. Body 14px. Secondary 13px. Caption 12px. Overline 11px uppercase with tracking, used for navigation group labels only.
- **Numbers:** use the `tabular` utility for counts, dates and money so columns align.
- **Shareholder surfaces (from Phase D):** step up one size. Body is 16px minimum, and primary buttons are 44px high.

## 4. Layout and spacing

- 4px base grid. Common steps are 8, 12, 16, 20, 24, 32 and 40.
- Admin shell: a 240px sidebar on the canvas colour, with content max-width 1200px and 40px side padding. Below 1024px the sidebar becomes a drawer behind a 56px top bar.
- Page anatomy: a page header with title, one-line description and actions on the right, then panels with 24px between them.
- **Panels, not cards.** A panel is a bordered white section with an optional header row. Do not nest panels. Use a single panel with internal dividers instead of rows of small cards.
- Stats sit in one panel split by 1px dividers. They are never four floating cards.
- No horizontal page scroll at any width. Wide tables scroll inside their panel.

## 5. Elevation and shape

- Borders do the separating. Shadows appear only on floating layers such as dialogs, menus and toasts (`shadow-pop`), plus a hairline `shadow-xs` on the active nav item and the sign-in panel.
- Radius: 6px for controls, 8px for panels, 12px for dialogs. Status badges use 4px.

## 6. Components

| Component | Notes |
|---|---|
| Button | `primary` (accent), `secondary` (outlined), `ghost`, `danger`, `link`. Heights 32, 36 and 44px. Loading state shows a spinner and disables the button. Only one primary button per view region. |
| Input / Textarea / Select | 36px high with a strong border. Focus shows an accent border and a 2px ring. `aria-invalid` gives a red border. Select is native for accessibility and mobile pickers. |
| Field | Label, control, then hint or error text. Wires `aria-describedby` and `aria-invalid`. Marks optional fields as "(optional)", never required fields with asterisks. |
| Badge | Status pill with an optional dot. Tones are neutral, accent, success, warning, danger and info. |
| Panel / PanelHeader | The main grouping surface. |
| Table | 36px header row on `subtle`, 12px cell padding, row hover. Hide less important columns progressively on small screens. |
| Dialog | For create and edit forms. Title plus one-line description, scrolling body, and a footer with Cancel then the primary action. |
| Menu | Account menu and row actions. |
| EmptyState / Skeleton / Alert | Every list has loading, empty and error states. |

## 7. Content style

- Sentence case everywhere. Write "New company", not "New Company".
- Write labels as nouns and buttons as verbs: "Create company", "Revoke".
- Errors say what happened and what to do next. Never expose stack traces or say whether an account exists.
- Confirm destructive or access-removing actions in plain language: "They lose access immediately."
- Dates show as `05 Nov 2026, 15:58` in Asia/Dhaka time.

## 8. Accessibility

- WCAG 2.2 AA contrast. A visible focus ring on every interactive element.
- A skip link, landmark roles, `aria-current` on navigation, and labelled icon buttons.
- Respect `prefers-reduced-motion`.
- Touch targets are at least 36px in the admin console and 44px on shareholder surfaces.

## 9. Shareholder meeting room (Phase D direction)

The live video is the visual anchor. It is full-width on mobile and two-thirds on desktop. To its right sit the agenda, then the current action (proposal, seconding, poll demand or vote) as one large clear control, then questions. The room shows no admin statistics. Only the action the meeting admin has opened is enabled. Everything else is visible but clearly marked "Not open yet".
