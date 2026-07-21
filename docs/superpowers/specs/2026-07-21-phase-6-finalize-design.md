# Phase 6 — Finalization dan Label Snapshot — Design

Status: approved by project owner (Rendiero), 21 Juli 2026, via brainstorming skill.
Scope: task.md Phase 6 (6.1 Delivery Selection, 6.2 Sequence, 6.3 Finalize RPC, 6.4 Formatter).
Out of scope: Phase 7 (QZ Tray, ZPL template/escaping, printing), Phase 8 (reprint, session
cancel/exception), BR-11 physical print confirmation.

## Business decisions locked for this phase

These resolve the open items in `docs/phase-0/business-rules.md` (BR-03, BR-04, BR-06) and
`flowsystem.md` §26 (open decisions 5, 6, 13) that were blocking Phase 6:

- **BR-04 Sequence scope: global, never reset.** One counter across all Master Items, boxes,
  suppliers, and dates. Implemented as a native PostgreSQL `SEQUENCE`, not a row-locked counter
  table — simplest correct option for a global, monotonically increasing value, and matches the
  recommendation already written in `flowsystem.md` §4.13.
- **BR-03/BR-06 label reference format:** `{sequence_no}-{delivery_date_DDMMYY}-{box_code}`,
  sequence rendered as a plain unpadded integer. Example: `1-150526-B101`. `delivery_date`
  comes from `delivery_numbers.delivery_date` (BR-05, already approved), formatted `DDMMYY`
  for the reference. This is separate from the label's displayed "Tanggal Delivery" field,
  which stays `dd-MMMM-yyyy` English (BR-05), e.g. `15-May-2026` — two different
  representations of the same date, used in two different label fields.
- **Finalize idempotency:** if a session is already at `print_pending` or later and a
  `print_jobs` row already exists for it, `finalize_packing_session` returns that existing job
  (`already_finalized: true`) instead of erroring. This applies uniformly to both a genuine
  network retry of the same request and to a real concurrent second finalize call that loses
  the row-lock race — both observe "the job already exists" and get it back. This supersedes
  the `PRINT_JOB_ALREADY_EXISTS` error sketched in `flowsystem.md` §12; that error code is not
  used by this RPC.
- **Delivery Number reuse:** one DN may be used by many packing sessions/boxes. Finalize does
  not close or lock the DN row itself — it only snapshots the DN's fields onto the print job.
  DN `status` transitions (closed/cancelled) remain an admin action from Phase 4.2, unrelated
  to finalize.

## Architecture

```
operator (ready_to_finalize)
  → loads active Delivery Numbers (server component, filtered status = 'active')
  → picks DN, sees confirmation summary (Part No, Box, layers, total, DN, date)
  → submits finalize action
      → public.finalize_packing_session(p_packing_session_id, p_delivery_number_id)
          - lock session FOR UPDATE
          - verify operator/workstation (reuse private.assert_active_assigned_workstation)
          - idempotent short-circuit if already finalized
          - else: verify ready_to_finalize, recheck qty, validate DN, resolve supplier,
            nextval() sequence, build label_reference, insert print_jobs row,
            update session → print_pending, audit
      → UI renders the returned snapshot via src/lib/label/formatter.ts
```

### Database (6.2 + 6.3)

New migration `supabase/migrations/<ts>_phase_6_finalize_rpc.sql`:

- `create sequence if not exists public.print_job_sequence as bigint minvalue 1;` — no grants
  to `anon`/`authenticated`; only reachable through the `SECURITY DEFINER` RPC.
- `public.finalize_packing_session(p_packing_session_id uuid, p_delivery_number_id uuid)`
  returns a single row: `print_job_id, packing_session_id, session_status, sequence_no,
  label_reference, supplier_code, supplier_name, part_no, part_name, qty, delivery_number,
  delivery_date, box_code, box_name, already_finalized`.
- Domain errors (reuse the list already in AGENTS.md §14 — do not invent new ones without
  updating that list): `PACKING_SESSION_NOT_FOUND`, `PACKING_SESSION_OPERATOR_MISMATCH`,
  `WORKSTATION_NOT_ASSIGNED`/`WORKSTATION_NOT_APPROVED` (via the shared assert helper),
  `SESSION_NOT_COMPLETE`, `DELIVERY_NUMBER_INVALID`, `DELIVERY_SUPPLIER_MISMATCH` (reserved,
  only if a future rule requires DN↔session supplier cross-check beyond what FK integrity
  already guarantees).
- Revoke execute from `public`/`anon`; grant to `authenticated` only (same pattern as Phase 5).
- pgTAP test `supabase/tests/database/015_phase_6_finalize.test.sql`: happy path B101 (3+5),
  two concurrent finalize calls on the same session yield one sequence/job, wrong-status
  session rejected, cancelled/draft/closed DN rejected, idempotent replay after
  already-finalized returns the same `label_reference`/`sequence_no`, audit row count.

### Formatter (6.4)

`src/lib/label/formatter.ts` — pure function, input is the shape returned by
`finalize_packing_session` (or an equivalent `print_jobs` row), output is a plain object of
display-ready strings: `supplierCode, partNo, qty, itemBoxReference, deliveryNumber, boxName,
deliveryDate`. No ZPL escaping (Phase 7's job) and no truncation — long values pass through
unmodified, per AGENTS.md §18 ("Jangan diam-diam memotong Part No atau Delivery Number").
`formatter.test.ts` covers date formatting (`dd-MMMM-yyyy` English month names, zero-padded
day) and long-value passthrough.

### UI (6.1)

Extend `src/app/(operator)/scan/page.tsx` to also load active Delivery Numbers
(`status = 'active'`, joined to `suppliers` for code/name and filtering). Extend
`src/components/operator/packing-scan-console.tsx`'s `ready_to_finalize` branch (currently just
shows a badge, no action) with a DN combobox (searchable, grouped/filterable by supplier),
a confirmation summary, and a submit button wired to a new
`src/features/finalize/actions.ts` server action calling the RPC. Errors map through the same
safe-message pattern used in `src/features/scan/actions.ts`.

## Non-goals / explicitly deferred

- Printing, QZ Tray, ZPL generation/escaping — Phase 7.
- Physical print confirmation state machine (BR-11) — Phase 7/8.
- Session cancel/expire/correction — Phase 8.4.
- Retention/audit cleanup policy (BR-12) — Phase 11.
