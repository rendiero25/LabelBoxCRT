# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Label Box CRT: a production shop-floor app for PT. CRT Kabelita. Operators scan
QR labels with a Zebra DS2208, the app validates each scan against Supabase
and packs it into a box/layer, then prints labels on a Zebra ZD220 (raw ZPL)
or a Canon G4010 paper printer (HTML via QZ Tray). Admin screens manage
master data (suppliers, products, master items, box/layer definitions,
delivery numbers, CSV imports). UI copy, code comments, and domain docs are
written in Indonesian; identifiers, error codes, and commit messages are in
English.

## Commands

```bash
npm install
npm run dev             # Next dev server
npm run build
npm run start

npm run typecheck        # tsc --noEmit
npm run lint             # eslint .
npm run lint:fix
npm run format           # prettier --write (required — no manual formatting)
npm run format:check

npm test                                        # vitest run, src/**/*.test.{ts,tsx}; fails if zero tests match
npx vitest run src/lib/barcode/parser.test.ts   # single unit test file
npm run test:watch
npm run test:integration                        # tests/integration/**/*.test.ts (currently empty; passes with no tests)
npm run test:e2e                                # Playwright, tests/e2e (currently empty); boots `npm run dev` itself

node scripts/run-pgtap.mjs supabase/tests/database/020_label_box_verification.test.sql  # single pgTAP file
```

`run-pgtap.mjs` posts the test file straight to the linked hosted project's
Management API (each file wraps itself in `begin; ... rollback;`); it exists
because Docker (needed by `supabase test db`) isn't available on this
workstation. It needs `SUPABASE_ACCESS_TOKEN` in `.env.local` and a prior
`supabase link`. Sequence counters touched by a test do not roll back.

### Supabase — hosted only, no local instance

Full workflow: `docs/development/supabase.md`. This repo never runs
`supabase start/stop/status/db reset` or any `--local` flag — all schema work
targets the linked hosted dev project. On Windows, invoke the CLI as
`npx.cmd supabase ...`.

```bash
npx.cmd supabase link --project-ref <approved_dev_project_ref>
npx.cmd supabase migration new <descriptive_name>
npx.cmd supabase migration list
npx.cmd supabase db push
```

After any migration, regenerate types from the linked hosted schema (the
`cmd.exe` wrapper avoids a PowerShell redirection encoding issue):

```bash
cmd.exe /d /s /c "npx.cmd supabase gen types typescript --linked --schema public > src\types\database.ts"
```

## Architecture

### Source-of-truth order

When docs, types, and code disagree, resolve in this order (from `AGENTS.md`):
`flowsystem.md` → `task.md` → Supabase migrations/constraints → generated
`src/types/database.ts` → implementation. Business invariants are not to be
changed silently — they live in migrations, not in a debate in application code.

### Business logic lives in Postgres, not in Next.js

Every mutation of consequence (accept a scan, create/update/delete a label
box batch, close verification, create print jobs, claim/complete a print job)
is exactly one `supabase.rpc(...)` call from a `"use server"` action in
`src/features/*/actions.ts`. The action's own job is narrow and repeats
across every feature:

1. Validate shape/UUIDs (a local `uuidPattern` regex) before calling the RPC.
2. Call the single RPC.
3. Map the RPC's error code through a local `Record<string, string>`
   (`safeRpcMessages`, `supplierRpcErrorMessage`, `masterItemBoxRpcErrorMessage`,
   etc.) to an Indonesian, user-safe message — raw DB errors never reach the UI.
4. `revalidatePath(...)` and reshape the returned row to camelCase.

Adding or changing a business rule means writing a migration (new/altered
RPC + pgTAP test in `supabase/tests/database/`), not adding validation in
TypeScript. `src/features/<domain>/validation.ts` only does client-facing
input shaping (trimming, casing, length caps) to fail fast before round-tripping.

### Feature module shape

`src/features/<domain>/` consistently has: `validation.ts` (FormData parsing +
Indonesian error strings), `form-state.ts` (the `{ error?, success? }` shape
consumed by `useActionState`, plus an `initial...State` const), `actions.ts`
(`"use server"`, thin RPC wrapper as above), and `components/` (client
components). Routes under `src/app/` stay thin and compose these.

### Auth and route protection

Supabase Auth + a `profiles.role` enum. The `operator` role was removed
(migration `20260730080000_drop_operator_role`) — scan/print is now open to
any active profile, and `admin` is the only distinction that still gates
anything (`features/auth/permissions.ts`). `src/proxy.ts` is the Next.js 16
file-convention successor to `middleware.ts` (`PROXY_FILENAME` in Next's own
constants) and does exactly one thing: refresh the Supabase session cookie via
`lib/supabase/proxy.ts#updateSession`. Actual authorization is re-verified
server-side on every protected layout via `features/auth/server.ts`:
`requireActiveUser()` / `requireAdmin()` call `auth.getClaims()` plus a
`profiles.is_active` lookup and redirect — nothing trusts client state or
treats `getSession()` alone as verification.

### Scan pipeline

The Zebra DS2208 is a USB-HID *keyboard wedge*, not an SDK device.
`features/scan/scanner-listener.ts` buffers `keydown` characters on the page
(ignoring inputs/textareas/selects/contenteditable/open `<dialog>`), and on
Enter submits the buffered line through a serial queue — one in-flight scan
request at a time, client-side, with the server as the real race-condition
authority. Every payload passes through `lib/barcode/parser.ts`
(`parseBarcodeV1`, a versioned pipe-delimited 5-field format) before it can
reach a server action; `label_uid` is normalized and uppercased there because
duplicate detection compares it byte-for-byte. Separately,
`features/scan/zebra-scanner.ts` identifies the physical scanner from QZ
Tray's **USB** device list (not HID — Windows hides the HID keyboard
collection the wedge exposes) purely for the operator's readiness panel.

### Label rendering: one geometry, two printers

`lib/label/zpl.ts` is the single source of truth for label geometry
(`LABEL_LAYOUT`, `labelRowsFor`, `TEMPLATE_VERSION`) and renders it as raw ZPL
for the Zebra ZD220 over QZ Tray. `lib/label/html.ts` renders the *same*
`LABEL_LAYOUT`/`labelRowsFor` as absolutely-positioned HTML for the Canon
G4010 (a driver-based inkjet with no ZPL support, printed via QZ Tray's pixel
mode) — geometry is derived, never re-specified. QR module count and
magnification are computed from payload length (`qrModulesFor`,
`qrMagnificationFor`), not hardcoded. Changing the layout means editing both
files together and bumping both version constants.

### QZ Tray integration

`features/print/qz-client.ts` wraps the `qz-tray` SDK. Certificate and
signing requests are proxied through `/api/qz/cert` and `/api/qz/sign` so
`QZ_PRIVATE_KEY`/`QZ_CERTIFICATE` stay server-only. Vercel cannot reach
workstation USB — printing is always browser (workstation) → QZ Tray (local)
→ printer, and Vercel Cron must never assume it can print or touch USB
devices.

## Conventions

- Prettier owns formatting (no semicolons, trailing commas, Tailwind class
  sorting via `prettier-plugin-tailwindcss`) — run `npm run format`, don't
  hand-format.
- shadcn/ui (`components.json`, style `radix-nova`) is the component source;
  prefer composing existing `components/ui/*` over new custom markup.
- Path alias `@/*` → `src/*`.

## Where to look next

- `AGENTS.md` — the fullest single spec: stack, business invariants, RLS/security
  rules, domain error codes, testing checklist, Definition of Done, forbidden actions.
- `flowsystem.md` — data model and end-to-end flow in detail.
- `task.md` — phased build checklist; reflects what's actually done vs. still open.
- `docs/development/*.md` — per-admin-feature notes (suppliers, delivery numbers,
  products, master items, box definitions, CSV import, Supabase workflow).
- `docs/superpowers/specs/` and `docs/superpowers/plans/` — per-feature design
  docs and execution plans, filenames dated `YYYY-MM-DD`.
