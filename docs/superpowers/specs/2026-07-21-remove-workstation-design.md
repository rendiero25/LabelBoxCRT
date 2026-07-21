# Remove Workstation Concept — Design

Status: approved by project owner (Rendiero), 21 Juli 2026, via brainstorming skill.
Supersedes: Phase 3.3 ("Workstation") in task.md, `docs/development/workstation-identity.md`,
and every workstation-scoped invariant in AGENTS.md/flowsystem.md.

## Rationale

Owner decision: operators do not register or get admin-approved per device. An authenticated
operator scans on any browser and the system works correctly without a device-identity layer.
Device/printer registration added friction with no offsetting benefit for this deployment.

## Decisions locked

- **Printer selection**: no server-side printer mapping. QZ Tray discovers printers on the
  local machine; the operator picks one from a dropdown each time they start a session.
  The choice is remembered in that browser's `localStorage` purely as a convenience default
  for next time — not an approval record, not synced to the server. (Consumed by Phase 7,
  which hasn't started; this spec only removes the workstation entity, it does not build the
  QZ printer picker — that lands when Phase 7 is implemented.)
- **Concurrency scope**: the "one active session" constraint is removed entirely. An operator
  may have any number of packing sessions open in parallel (e.g. multiple browser tabs, each
  working a different box). No unique-active-session constraint remains in the schema.
- **Trust model**: Supabase Auth + `profiles.role = 'operator'`/`'admin'` is the only identity
  check. No separate device approval, no `is_active_operator()` change needed (unaffected),
  just drop the workstation-assignment check layered on top of it.
- **Print job targeting** (forward note, not decided/built now): with no workstation entity,
  "claim only workstation target job" (task.md 7.4) needs a new design when Phase 7 starts —
  most likely "any browser tab logged in as the finalizing operator may claim their own
  session's print job." Out of scope here.

## Schema changes

New migration `supabase/migrations/<ts>_remove_workstation.sql`:

- Drop `public.workstation_assignments`.
- Drop `public.workstations`.
- Drop `workstation_id` column from `packing_sessions`, `packing_session_scans`, `print_jobs`,
  `print_attempts`, `audit_logs` (all nullable already except where NOT NULL — check each and
  drop the column outright since the referenced table is gone).
- Drop `packing_sessions_one_open_per_workstation_idx` (the partial unique index enforcing
  one active session per workstation — no longer applicable, and no replacement is needed
  since "no active-session limit" was the explicit decision).
- Drop `private.assert_active_assigned_workstation(uuid)`.
- Drop any RLS policy referencing `workstation_assignments`/`workstations` (session/scan
  ownership policies keyed off `operator_id = auth.uid()` stay; only the workstation-approval
  layer goes).
- The still-unapplied `20260715021548_workstation_identity.sql` migration is abandoned — do
  not push it. Its file stays in git history for record but is a dead migration; note this
  clearly in a comment at the top of the new migration so a future reader isn't confused about
  why an old timestamped file was skipped.

## RPC changes

- `public.start_packing_session(p_master_item_id uuid, p_box_definition_id uuid)` — drop
  `p_workstation_id` param and the `assert_active_assigned_workstation` call; keep
  `private.is_active_operator()` guard. Drop the `SESSION_ALREADY_ACTIVE_FOR_WORKSTATION`
  error path entirely (no replacement — unlimited parallel sessions is intended).
- `public.accept_packing_scan(...)` — drop the workstation assertion call and the
  `p_workstation_id`-derived audit/scan columns (the RPC already takes
  `p_packing_session_id`; the session row itself no longer carries `workstation_id`).
- `public.finalize_packing_session(...)` — same: drop the workstation assertion call and
  `workstation_id` from its inserted/returned rows.
- Error code list in AGENTS.md §14: remove `WORKSTATION_NOT_ASSIGNED` won't be listed as
  reachable dead code, but IS still returned by `requireVerifiedWorkstation()` on the client
  side today — that helper is deleted too (see Application changes), so the whole client-side
  error-message table drops its workstation branches.
- pgTAP: update `014_phase_5_packing_session_scan.test.sql` and
  `015_phase_6_finalize.test.sql` fixtures/assertions to drop workstation setup rows and
  workstation-specific assertions (the "pending workstation cannot start", "not assigned",
  "one session per workstation" tests are deleted, not adapted — those invariants no longer
  exist). Re-verify the remaining assertions still hold with the new signatures.

## Application changes

- Delete: `src/app/admin/workstations/`, `src/app/workstation/enroll/`,
  `src/app/api/workstation/heartbeat/`, `src/features/workstations/` (entire directory,
  including its two test files), workstation nav entries in `src/app/admin/layout.tsx`.
- `src/features/scan/actions.ts` and `src/features/finalize/actions.ts`: remove
  `requireVerifiedWorkstation()` calls and any workstation param passed into the RPC calls.
- `src/app/(operator)/scan/page.tsx`: change from "load the one active session
  (`.maybeSingle()`)" to "load all sessions for this operator with
  `status in ('scanning','ready_to_finalize')`", pass the list down.
- `src/components/operator/packing-scan-console.tsx`: add a session list/picker view when
  more than zero sessions exist (click a session card to enter its scan view — same detail
  view as today, just reachable from a list instead of being the only possible state) plus a
  "Mulai session baru" affordance that's always available (not just when zero sessions exist,
  since sessions no longer block each other).
- `src/app/(auth)/login/page.tsx`: remove any workstation-approval-pending messaging/redirect.
- Regenerate `src/types/database.ts` after the schema migration lands.

## Documentation changes

- `task.md`: delete Phase 3.3 "Workstation" section and its Gate note; remove workstation
  bullet items from Phase 5.2/5.3/5.5 and Phase 6/7 wherever "workstation" appears as a
  constraint, replacing with the new operator-only model where the checklist item still makes
  sense (e.g. "Enforce one active session per workstation" → delete the line entirely, it's
  not replaced by anything).
- `AGENTS.md`: remove §10's device-trust paragraph ("Identitas workstation tidak boleh
  dipercaya..."), update §7.1/§14 error codes, update §5 module structure (drop
  `features/` workstation references), update §19 open decisions if any referenced it.
- `flowsystem.md`: remove `workstations` from §4 data model, update §8/§19/§21 flow
  descriptions that assumed a workstation identity step, update §26 open decisions.
- `docs/development/workstation-identity.md`: delete (superseded).
- `docs/phase-0/hardware-discovery.md`: keep hardware facts (DS2208/ZD220/DPI etc.), strip any
  language implying a `workstations` table/registration flow.

## Testing

- `npm run typecheck`, `npm run lint`, `npm test` after application changes.
- pgTAP full suite (existing files 001–015, minus removed workstation-specific assertions)
  against the hosted dev project after the migration lands, plus advisors.
- No new hardware/browser UAT required by this change — it removes a gate, it doesn't add
  scan/print behavior.

## Non-goals

- Does not implement the QZ printer picker UI (Phase 7).
- Does not redesign print-job claiming (forward note above, decided when Phase 7 starts).
- Does not change RLS row ownership on `packing_sessions`/`packing_session_scans` beyond
  removing the workstation-approval layer — `operator_id = auth.uid()` ownership stays as-is.
