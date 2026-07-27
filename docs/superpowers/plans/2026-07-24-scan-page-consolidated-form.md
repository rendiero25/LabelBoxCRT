# Scan Page Consolidated Form Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse the operator scan flow into one up-front form (supplier, master item, box, qty delivery, lot no, delivery date), auto-finalize and auto-print when every layer is full, and add a QR code to the box label.

**Architecture:** Delivery Number resolution moves from finalize-time (operator picks from a list) to session-start time (server finds an active DN for supplier+date or auto-creates one with a generated code). `packing_sessions` carries the two new manual fields; `finalize_packing_session` snapshots them onto `print_jobs` alongside a QR-generation timestamp. Scan validation logic in `accept_packing_scan` is unchanged. The ZPL template goes to v2: tighter text rows plus a `^BQ` QR block.

**Tech Stack:** Next.js 15 App Router + React 19 (`useActionState`), Supabase Postgres (SECURITY DEFINER RPCs), pgTAP, Vitest, sonner, Zebra ZPL.

**Spec:** `docs/superpowers/specs/2026-07-24-scan-page-consolidated-form-design.md`

---

## Running database work

Docker is not installed on this workstation, so `supabase test db`, `supabase db dump`, and `supabase db diff` all fail. Two commands still work because they talk to the linked remote project directly:

- **Apply migrations:** `npx supabase db push` (needs `SUPABASE_ACCESS_TOKEN` exported from `.env.local`)
- **Run one pgTAP file:** `node scripts/run-pgtap.mjs <path-to-test.sql>` — submits the file, which is already wrapped in `begin; ... rollback;`, through the Management API. Prints `PASS`/`FAIL` and exits 0/1.

Because pgTAP runs against the linked project, **the migration must be pushed before Tasks 4 and 5 run**, or the tests will assert against the old RPC signatures.

Four test files already fail on `main` for unrelated reasons (stale fixtures left by the earlier box restructure): `001_phase_2_schema`, `003_phase_2_seed`, `012_product_auto_code`, `016_phase_7_print_rpcs`. Leave them alone — they are out of scope here. `014`, `015`, `017`, and `018` pass and must keep passing.

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `supabase/migrations/20260724080000_scan_consolidated_form.sql` | Schema columns, DN sequence, rewritten `start_packing_session` + `finalize_packing_session` | Create |
| `supabase/tests/database/014_phase_5_packing_session_scan.test.sql` | pgTAP: start + scan behaviour | Modify |
| `supabase/tests/database/015_phase_6_finalize.test.sql` | pgTAP: finalize behaviour | Modify |
| `src/types/database.ts` | Generated Supabase types | Modify |
| `src/lib/label/formatter.ts` | Snapshot to display fields + QR payload | Modify |
| `src/lib/label/formatter.test.ts` | Formatter unit tests | Modify |
| `src/lib/label/zpl.ts` | ZPL v2 template with QR | Modify |
| `src/lib/label/zpl.test.ts` | ZPL unit tests | Modify |
| `src/lib/label/__snapshots__/zpl.test.ts.snap` | Golden ZPL sample | Regenerate |
| `src/features/scan/form-state.ts` | Start-session input type | Modify |
| `src/features/scan/actions.ts` | `startPackingSessionAction` | Modify |
| `src/features/finalize/actions.ts` | `finalizePackingSessionAction` | Modify |
| `src/app/(operator)/scan/page.tsx` | Server data load for the scan page | Modify |
| `src/components/operator/packing-scan-console.tsx` | Start form, scan view, auto-finalize, error toast | Modify |
| `src/features/delivery-numbers/components/create-delivery-number-dialog.tsx` | Manual DN creation dialog | Delete (orphaned) |
| `scripts/run-pgtap.mjs` | Runs one pgTAP file against the linked project (Docker-free) | Already exists |

`createDeliveryNumberAction` in `src/features/delivery-numbers/actions.ts` stays — it is the same code path the CSV import template targets, and a future admin DN page would reuse it.

---

### Task 1: Migration — schema columns and Delivery Number sequence

**Files:**
- Create: `supabase/migrations/20260724080000_scan_consolidated_form.sql`

- [ ] **Step 1: Create the migration file with the schema section**

```sql
-- Scan page consolidation (spec
-- docs/superpowers/specs/2026-07-24-scan-page-consolidated-form-design.md).
--
-- 1. packing_sessions carries the two manual operator inputs (qty delivery,
--    lot no) captured when the session starts.
-- 2. print_jobs snapshots them at finalize alongside the timestamp stamped
--    into the label QR, matching the existing *_snapshot convention.
-- 3. delivery_numbers gains a code sequence so the scan flow can auto-create
--    a DN instead of asking the operator to type one.
--
-- Both new packing_sessions columns are nullable: sessions created before
-- this migration have no values, and backfilling them would invent data.

alter table public.packing_sessions
  add column qty_delivery integer check (qty_delivery is null or qty_delivery > 0),
  add column lot_no text check (lot_no is null or btrim(lot_no) <> '');

alter table public.print_jobs
  add column qty_delivery_snapshot integer
    check (qty_delivery_snapshot is null or qty_delivery_snapshot > 0),
  add column lot_no_snapshot text
    check (lot_no_snapshot is null or btrim(lot_no_snapshot) <> ''),
  add column qr_generated_at_snapshot timestamptz;

create sequence public.delivery_number_seq
  as bigint
  minvalue 1
  start with 1;

select setval(
  'public.delivery_number_seq',
  coalesce(
    (
      select max((regexp_match(delivery_number, '^DN-([0-9]+)$'))[1]::bigint)
      from public.delivery_numbers
    ),
    0
  ) + 1,
  false
);

revoke all on sequence public.delivery_number_seq from public, anon, authenticated;
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/20260724080000_scan_consolidated_form.sql
git commit -m "feat: add qty delivery, lot no, and QR timestamp columns for the scan flow"
```

---

### Task 2: Migration — `start_packing_session` resolves the Delivery Number

The RPC gains four parameters and owns Delivery Number resolution. It reuses an active DN for the same supplier and date when one exists, so a shift packing twenty boxes against one delivery produces one DN, not twenty.

**Files:**
- Modify: `supabase/migrations/20260724080000_scan_consolidated_form.sql` (append)

- [ ] **Step 1: Append the rewritten `start_packing_session`**

```sql
-- Argument count changes, so create-or-replace cannot reconcile the old
-- 2-arg signature. Drop explicitly.
drop function public.start_packing_session(uuid, uuid);

create function public.start_packing_session(
  p_master_item_id uuid,
  p_box_id uuid,
  p_supplier_id uuid,
  p_delivery_date date,
  p_qty_delivery integer,
  p_lot_no text
)
returns table (
  session_id uuid,
  status public.packing_session_status,
  operator_id uuid,
  master_item_id uuid,
  box_id uuid,
  delivery_number_id uuid,
  delivery_number text,
  total_expected_qty integer,
  accepted_qty integer,
  started_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  target_item public.master_items%rowtype;
  target_box public.boxes%rowtype;
  target_dn public.delivery_numbers%rowtype;
  created_session public.packing_sessions%rowtype;
  normalized_lot_no text := btrim(coalesce(p_lot_no, ''));
  candidate_number text;
  expected_total integer;
begin
  if not private.is_active_operator() then
    raise exception using errcode = 'P0001', message = 'PACKING_SESSION_OPERATOR_REQUIRED';
  end if;

  select * into target_item
  from public.master_items item
  where item.id = p_master_item_id and item.is_active;

  if target_item.id is null then
    raise exception using errcode = 'P0001', message = 'MASTER_ITEM_NOT_ACTIVE';
  end if;

  select * into target_box
  from public.boxes box
  where box.id = p_box_id and box.master_item_id = p_master_item_id;

  if target_box.id is null then
    raise exception using errcode = 'P0001', message = 'BOX_NOT_FOUND_OR_MISMATCH';
  end if;

  if not exists (
    select 1 from public.suppliers supplier
    where supplier.id = p_supplier_id and supplier.is_active
  ) then
    raise exception using errcode = 'P0001', message = 'DELIVERY_NUMBER_SUPPLIER_INVALID';
  end if;

  -- A Master Item with a supplier may only be packed against that supplier.
  -- Legacy rows with a null supplier_id stay unrestricted.
  if target_item.supplier_id is not null
    and target_item.supplier_id <> p_supplier_id then
    raise exception using errcode = 'P0001', message = 'MASTER_ITEM_SUPPLIER_MISMATCH';
  end if;

  if p_delivery_date is null then
    raise exception using errcode = 'P0001', message = 'DELIVERY_DATE_INVALID';
  end if;

  if p_qty_delivery is null or p_qty_delivery < 1 or p_qty_delivery > 1000000 then
    raise exception using errcode = 'P0001', message = 'QTY_DELIVERY_INVALID';
  end if;

  if normalized_lot_no = '' or char_length(normalized_lot_no) > 100 then
    raise exception using errcode = 'P0001', message = 'LOT_NO_INVALID';
  end if;

  select coalesce(sum(requirement.expected_qty), 0)::integer into expected_total
  from public.box_layer_requirements requirement
  join public.box_layers layer on layer.id = requirement.box_layer_id
  where layer.box_id = p_box_id;

  if expected_total <= 0 then
    raise exception using errcode = 'P0001', message = 'BOX_EMPTY';
  end if;

  -- Reuse the active Delivery Number for this supplier and date when one
  -- already exists; otherwise mint one with a generated code.
  select * into target_dn
  from public.delivery_numbers dn
  where dn.supplier_id = p_supplier_id
    and dn.delivery_date = p_delivery_date
    and dn.status = 'active'
  order by dn.created_at
  limit 1;

  if target_dn.id is null then
    loop
      candidate_number := 'DN-' || lpad(nextval('public.delivery_number_seq')::text, 6, '0');

      begin
        insert into public.delivery_numbers (
          supplier_id, delivery_number, delivery_date, status, created_by
        ) values (
          p_supplier_id, candidate_number, p_delivery_date, 'active', auth.uid()
        )
        returning * into target_dn;
        exit;
      exception when unique_violation then
        -- Code collided with a manually entered DN; take the next value.
        null;
      end;
    end loop;

    insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
    values (
      auth.uid(), 'delivery_number.created', 'delivery_number', target_dn.id::text,
      jsonb_build_object(
        'supplier_id', target_dn.supplier_id,
        'delivery_number', target_dn.delivery_number,
        'delivery_date', target_dn.delivery_date,
        'status', target_dn.status,
        'source', 'packing_session_auto'
      )
    );
  end if;

  insert into public.packing_sessions (
    operator_id, master_item_id, box_id, delivery_number_id,
    qty_delivery, lot_no, status
  ) values (
    auth.uid(), p_master_item_id, p_box_id, target_dn.id,
    p_qty_delivery, normalized_lot_no, 'scanning'
  )
  returning * into created_session;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    auth.uid(), 'packing_session.started', 'packing_session', created_session.id::text,
    jsonb_build_object(
      'master_item_id', created_session.master_item_id,
      'box_id', created_session.box_id,
      'delivery_number_id', created_session.delivery_number_id,
      'qty_delivery', created_session.qty_delivery,
      'total_expected_qty', expected_total
    )
  );

  return query
  select
    created_session.id, created_session.status, created_session.operator_id,
    created_session.master_item_id, created_session.box_id,
    created_session.delivery_number_id, target_dn.delivery_number,
    expected_total, 0, created_session.started_at;
end;
$$;

revoke execute on function public.start_packing_session(uuid, uuid, uuid, date, integer, text)
  from public, anon;
grant execute on function public.start_packing_session(uuid, uuid, uuid, date, integer, text)
  to authenticated;
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/20260724080000_scan_consolidated_form.sql
git commit -m "feat: resolve the Delivery Number when a packing session starts"
```

---

### Task 3: Migration — `finalize_packing_session` reads the session's Delivery Number

**Files:**
- Modify: `supabase/migrations/20260724080000_scan_consolidated_form.sql` (append)

- [ ] **Step 1: Append the rewritten `finalize_packing_session`**

```sql
drop function public.finalize_packing_session(uuid, uuid);

create function public.finalize_packing_session(
  p_packing_session_id uuid
)
returns table (
  print_job_id uuid,
  packing_session_id uuid,
  session_status public.packing_session_status,
  sequence_no bigint,
  label_reference text,
  supplier_code text,
  supplier_name text,
  part_no text,
  part_name text,
  qty integer,
  delivery_number text,
  delivery_date date,
  box_code text,
  box_name text,
  qty_delivery integer,
  lot_no text,
  qr_generated_at timestamptz,
  already_finalized boolean
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  target_session public.packing_sessions%rowtype;
  target_item public.master_items%rowtype;
  target_box public.boxes%rowtype;
  target_dn public.delivery_numbers%rowtype;
  target_supplier public.suppliers%rowtype;
  existing_job public.print_jobs%rowtype;
  new_job public.print_jobs%rowtype;
  expected_total integer;
  accepted_total integer;
  new_sequence_no bigint;
  new_label_reference text;
  new_qr_generated_at timestamptz := statement_timestamp();
  resulting_status public.packing_session_status;
  finalize_correlation_id uuid := gen_random_uuid();
begin
  select * into target_session
  from public.packing_sessions session
  where session.id = p_packing_session_id
  for update;

  if target_session.id is null then
    raise exception using errcode = 'P0001', message = 'PACKING_SESSION_NOT_FOUND';
  end if;

  if target_session.operator_id <> auth.uid() then
    raise exception using errcode = 'P0001', message = 'PACKING_SESSION_OPERATOR_MISMATCH';
  end if;

  if target_session.status in ('print_pending', 'printing', 'sent_to_printer', 'confirmed') then
    select * into existing_job
    from public.print_jobs job
    where job.packing_session_id = target_session.id
      and job.parent_print_job_id is null;

    if existing_job.id is null then
      raise exception using errcode = 'P0001', message = 'SESSION_NOT_COMPLETE';
    end if;

    return query
    select
      existing_job.id, target_session.id, target_session.status,
      existing_job.sequence_no, existing_job.label_reference,
      existing_job.supplier_code_snapshot, existing_job.supplier_name_snapshot,
      existing_job.part_no_snapshot, existing_job.part_name_snapshot,
      existing_job.qty_snapshot, existing_job.delivery_number_snapshot,
      existing_job.delivery_date_snapshot, existing_job.box_code_snapshot,
      existing_job.box_name_snapshot, existing_job.qty_delivery_snapshot,
      existing_job.lot_no_snapshot, existing_job.qr_generated_at_snapshot, true;
    return;
  end if;

  if target_session.status <> 'ready_to_finalize' then
    raise exception using errcode = 'P0001', message = 'SESSION_NOT_COMPLETE';
  end if;

  select * into target_item from public.master_items item where item.id = target_session.master_item_id;
  select * into target_box from public.boxes box where box.id = target_session.box_id;

  select coalesce(sum(requirement.expected_qty), 0)::integer into expected_total
  from public.box_layer_requirements requirement
  join public.box_layers layer on layer.id = requirement.box_layer_id
  where layer.box_id = target_session.box_id;

  select count(*)::integer into accepted_total
  from public.packing_session_scans scan
  where scan.packing_session_id = target_session.id
    and scan.result = 'accepted';

  if expected_total <= 0 or accepted_total <> expected_total then
    raise exception using errcode = 'P0001', message = 'SESSION_NOT_COMPLETE';
  end if;

  -- The DN was resolved at session start. It can still have been closed or
  -- cancelled by an admin while the operator was scanning, so re-check
  -- rather than trusting the stored id.
  select * into target_dn from public.delivery_numbers dn
  where dn.id = target_session.delivery_number_id and dn.status = 'active';

  if target_dn.id is null then
    raise exception using errcode = 'P0001', message = 'DELIVERY_NUMBER_INVALID';
  end if;

  select * into target_supplier from public.suppliers supplier where supplier.id = target_dn.supplier_id;

  if target_supplier.id is null then
    raise exception using errcode = 'P0001', message = 'DELIVERY_NUMBER_INVALID';
  end if;

  select nextval('public.print_job_sequence') into new_sequence_no;

  new_label_reference := new_sequence_no::text || '-'
    || to_char(target_dn.delivery_date, 'DDMMYY') || '-' || target_box.box_code;

  insert into public.print_jobs (
    packing_session_id, status, supplier_code_snapshot, supplier_name_snapshot,
    part_no_snapshot, part_name_snapshot, qty_snapshot, delivery_number_snapshot,
    delivery_date_snapshot, box_code_snapshot, box_name_snapshot,
    qty_delivery_snapshot, lot_no_snapshot, qr_generated_at_snapshot,
    sequence_no, label_reference, template_version, zpl_payload, created_by
  ) values (
    target_session.id, 'pending', target_supplier.supplier_code, target_supplier.supplier_name,
    target_item.part_no, target_item.part_name, target_item.default_label_qty,
    target_dn.delivery_number, target_dn.delivery_date, target_box.box_code, target_box.box_name,
    target_session.qty_delivery, target_session.lot_no, new_qr_generated_at,
    new_sequence_no, new_label_reference, 'v2', 'PENDING_ZPL_GENERATION', auth.uid()
  )
  returning * into new_job;

  update public.packing_sessions session
  set status = 'print_pending', finalized_at = statement_timestamp()
  where session.id = target_session.id
  returning session.status into resulting_status;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata, correlation_id)
  values (
    auth.uid(), 'packing_session.finalized', 'packing_session', target_session.id::text,
    jsonb_build_object(
      'print_job_id', new_job.id, 'sequence_no', new_sequence_no,
      'label_reference', new_label_reference,
      'delivery_number_id', target_session.delivery_number_id,
      'master_item_id', target_session.master_item_id, 'box_id', target_session.box_id,
      'qty_snapshot', target_item.default_label_qty,
      'qty_delivery_snapshot', target_session.qty_delivery
    ),
    finalize_correlation_id
  );

  return query
  select
    new_job.id, target_session.id, resulting_status, new_sequence_no, new_label_reference,
    target_supplier.supplier_code, target_supplier.supplier_name, target_item.part_no,
    target_item.part_name, target_item.default_label_qty, target_dn.delivery_number,
    target_dn.delivery_date, target_box.box_code, target_box.box_name,
    target_session.qty_delivery, target_session.lot_no, new_qr_generated_at, false;
end;
$$;

revoke execute on function public.finalize_packing_session(uuid) from public, anon;
grant execute on function public.finalize_packing_session(uuid) to authenticated;

notify pgrst, 'reload schema';
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/20260724080000_scan_consolidated_form.sql
git commit -m "feat: snapshot lot no, qty delivery, and QR timestamp at finalize"
```

- [ ] **Step 3: Apply the migration to the linked project**

Tasks 4 and 5 run pgTAP against the remote database, so the new RPC signatures have to be live first.

```bash
export SUPABASE_ACCESS_TOKEN=$(grep '^SUPABASE_ACCESS_TOKEN=' .env.local | cut -d= -f2- | tr -d '\r\n"')
npx supabase db push
```

Expected: `Applying migration 20260724080000_scan_consolidated_form.sql...` then `Finished supabase db push.`

If it fails, do not retry blindly — read the error, fix the migration file, and report what changed. A partially applied migration needs `npx supabase migration repair` before another attempt.

- [ ] **Step 4: Confirm the old tests still pass against the new schema**

```bash
node scripts/run-pgtap.mjs supabase/tests/database/017_master_item_code_autogen.test.sql
node scripts/run-pgtap.mjs supabase/tests/database/018_box_owned_by_master_item.test.sql
```

Expected: `PASS` for both. `014` and `015` will fail here — they still use the old signatures and are rewritten in Tasks 4 and 5.

---

### Task 4: pgTAP — rewrite `014_phase_5_packing_session_scan.test.sql`

Every `start_packing_session` call gains four arguments, the fixture gains a supplier, and three new validation branches need coverage. Scan assertions stay as they are — `accept_packing_scan` did not change.

**Files:**
- Modify: `supabase/tests/database/014_phase_5_packing_session_scan.test.sql`

- [ ] **Step 1: Raise the plan count and add a supplier fixture**

Change line 6 from `select plan(35);` to:

```sql
select plan(41);
```

After the `insert into public.profiles (...)` block (ends line 24), insert:

```sql
insert into public.suppliers (id, supplier_code, supplier_name, is_active) values
  ('95900000-0000-0000-0000-000000000001', 'PH5SUP', 'Phase 5 Supplier', true),
  ('95900000-0000-0000-0000-000000000002', 'PH5OFF', 'Phase 5 Inactive Supplier', false);
```

- [ ] **Step 2: Point the Master Item fixture at the supplier**

Replace the `insert into public.master_items (...)` block (lines 26-46) with:

```sql
insert into public.master_items (
  id, item_code, part_no, part_name, unit, default_label_qty, supplier_id, is_active
) values
  (
    '96100000-0000-0000-0000-000000000001',
    'phase5-item',
    'PHASE5-PART',
    'Phase 5 Part',
    'Pcs',
    100,
    '95900000-0000-0000-0000-000000000001',
    true
  ),
  (
    '96100000-0000-0000-0000-000000000002',
    'phase5-other-item',
    'PHASE5-OTHER',
    'Phase 5 Other Part',
    'Pcs',
    100,
    '95900000-0000-0000-0000-000000000001',
    true
  );
```

- [ ] **Step 3: Update the `has_function` assertion**

Replace the first `select has_function(...)` block (lines 121-126) with:

```sql
select has_function(
  'public',
  'start_packing_session',
  array['uuid', 'uuid', 'uuid', 'date', 'integer', 'text'],
  'start packing-session RPC takes master item, box, supplier, delivery date, qty delivery, and lot no'
);
```

- [ ] **Step 4: Update every `start_packing_session` call site**

There are five. Replace each with the six-argument form.

Lines 166-176 (missing master item) become:

```sql
select throws_ok(
  $$
    select public.start_packing_session(
      '96100000-0000-0000-0000-000000000099',
      '98100000-0000-0000-0000-000000000001',
      '95900000-0000-0000-0000-000000000001',
      date '2026-05-15',
      40,
      'LOT-P5-A'
    )
  $$,
  'P0001',
  'MASTER_ITEM_NOT_ACTIVE',
  'start rejects a missing or inactive Master Item'
);
```

Lines 178-188 (box mismatch) become:

```sql
select throws_ok(
  $$
    select public.start_packing_session(
      '96100000-0000-0000-0000-000000000002',
      '98100000-0000-0000-0000-000000000001',
      '95900000-0000-0000-0000-000000000001',
      date '2026-05-15',
      40,
      'LOT-P5-A'
    )
  $$,
  'P0001',
  'BOX_NOT_FOUND_OR_MISMATCH',
  'start requires the selected Box to belong to its Master Item'
);
```

Lines 190-195 (session A) become:

```sql
create temporary table phase5_b101_session as
select *
from public.start_packing_session(
  '96100000-0000-0000-0000-000000000001',
  '98100000-0000-0000-0000-000000000001',
  '95900000-0000-0000-0000-000000000001',
  date '2026-05-15',
  40,
  'LOT-P5-A'
);
```

Lines 373-378 (second session) become:

```sql
create temporary table phase5_second_session as
select *
from public.start_packing_session(
  '96100000-0000-0000-0000-000000000001',
  '98100000-0000-0000-0000-000000000001',
  '95900000-0000-0000-0000-000000000001',
  date '2026-05-15',
  40,
  'LOT-P5-B'
);
```

Lines 408-413 (overflow session) become:

```sql
create temporary table phase5_overflow_session as
select *
from public.start_packing_session(
  '96100000-0000-0000-0000-000000000001',
  '98100000-0000-0000-0000-000000000002',
  '95900000-0000-0000-0000-000000000001',
  date '2026-05-15',
  40,
  'LOT-P5-C'
);
```

Lines 599-609 (anon check) become:

```sql
select throws_ok(
  $$
    select public.start_packing_session(
      '96100000-0000-0000-0000-000000000001',
      '98100000-0000-0000-0000-000000000001',
      '95900000-0000-0000-0000-000000000001',
      date '2026-05-15',
      40,
      'LOT-P5-A'
    )
  $$,
  '42501',
  'permission denied for function start_packing_session',
  'anon has no execute privilege for starting sessions'
);
```

- [ ] **Step 5: Add the six new assertions for input validation and DN resolution**

Insert directly after the `create temporary table phase5_b101_session ... grant select on phase5_b101_session to public;` block:

```sql
select isnt(
  (select delivery_number_id from phase5_b101_session),
  null,
  'start resolves a Delivery Number onto the session'
);

select matches(
  (select delivery_number from phase5_b101_session),
  '^DN-[0-9]{6}$',
  'an auto-created Delivery Number uses the generated code format'
);

select is(
  (
    select qty_delivery::text || ':' || lot_no
    from public.packing_sessions
    where id = (select session_id from phase5_b101_session)
  ),
  '40:LOT-P5-A',
  'start persists the manual qty delivery and lot no'
);
```

Insert directly after the `BOX_NOT_FOUND_OR_MISMATCH` assertion (before session A is created):

```sql
select throws_ok(
  $$
    select public.start_packing_session(
      '96100000-0000-0000-0000-000000000001',
      '98100000-0000-0000-0000-000000000001',
      '95900000-0000-0000-0000-000000000002',
      date '2026-05-15',
      40,
      'LOT-P5-A'
    )
  $$,
  'P0001',
  'DELIVERY_NUMBER_SUPPLIER_INVALID',
  'start rejects an inactive supplier'
);

select throws_ok(
  $$
    select public.start_packing_session(
      '96100000-0000-0000-0000-000000000001',
      '98100000-0000-0000-0000-000000000001',
      '95900000-0000-0000-0000-000000000001',
      date '2026-05-15',
      0,
      'LOT-P5-A'
    )
  $$,
  'P0001',
  'QTY_DELIVERY_INVALID',
  'start rejects a non-positive qty delivery'
);

select throws_ok(
  $$
    select public.start_packing_session(
      '96100000-0000-0000-0000-000000000001',
      '98100000-0000-0000-0000-000000000001',
      '95900000-0000-0000-0000-000000000001',
      date '2026-05-15',
      40,
      '   '
    )
  $$,
  'P0001',
  'LOT_NO_INVALID',
  'start rejects a blank lot no'
);
```

- [ ] **Step 6: Add the DN-reuse assertion**

Insert directly after the `create temporary table phase5_second_session ...` block:

```sql
select is(
  (select delivery_number_id from phase5_second_session),
  (select delivery_number_id from phase5_b101_session),
  'a second session on the same supplier and date reuses the same Delivery Number'
);
```

- [ ] **Step 7: Run the test**

Run: `node scripts/run-pgtap.mjs supabase/tests/database/014_phase_5_packing_session_scan.test.sql`
Expected: `PASS  supabase/tests/database/014_phase_5_packing_session_scan.test.sql`, exit code 0.

A `# Looks like you failed N tests of 41` line means an assertion is wrong; an `HTTP 400` with a Postgres error means the SQL itself is malformed. Fix and re-run.

- [ ] **Step 8: Commit**

```bash
git add supabase/tests/database/014_phase_5_packing_session_scan.test.sql
git commit -m "test: cover Delivery Number resolution and manual inputs at session start"
```

---

### Task 5: pgTAP — rewrite `015_phase_6_finalize.test.sql`

`finalize_packing_session` no longer takes a Delivery Number, so the four "reject a draft/closed/cancelled/nonexistent DN" cases move to a single "DN closed mid-session" case, and session B's purpose changes accordingly.

**Files:**
- Modify: `supabase/tests/database/015_phase_6_finalize.test.sql`

- [ ] **Step 1: Lower the plan count**

Change line 12 from `select plan(42);` to:

```sql
select plan(40);
```

- [ ] **Step 2: Point the Master Item fixture at the supplier**

The supplier insert (lines 76-77) currently sits below the master item insert. Move it above by replacing lines 32-37 with:

```sql
insert into public.suppliers (id, supplier_code, supplier_name, is_active) values
  ('a6700000-0000-0000-0000-000000000001', 'PH6SUP', 'Phase 6 Supplier', true);

insert into public.master_items (
  id, item_code, part_no, part_name, unit, default_label_qty, supplier_id, is_active
) values (
  'a6200000-0000-0000-0000-000000000001',
  'phase6-item', 'PHASE6-PART', 'Phase 6 Part', 'Pcs', 40,
  'a6700000-0000-0000-0000-000000000001', true
);
```

Then delete the now-duplicated supplier insert (originally lines 76-77).

- [ ] **Step 3: Trim the Delivery Number fixture**

Replace the four-row `insert into public.delivery_numbers (...)` block (lines 79-97) with two rows — the active one the sessions resolve to, and a second active one on a different date used for the closed-mid-session case:

```sql
insert into public.delivery_numbers (
  id, supplier_id, delivery_number, delivery_date, status, created_by
) values
  (
    'a6800000-0000-0000-0000-000000000001', 'a6700000-0000-0000-0000-000000000001',
    'DN-PHASE6-ACTIVE', date '2026-05-15', 'active', 'a6100000-0000-0000-0000-000000000001'
  ),
  (
    'a6800000-0000-0000-0000-000000000005', 'a6700000-0000-0000-0000-000000000001',
    'DN-PHASE6-LATER', date '2026-06-20', 'active', 'a6100000-0000-0000-0000-000000000001'
  );
```

- [ ] **Step 4: Update the signature assertions**

Replace lines 99-104 with:

```sql
select has_function(
  'public',
  'finalize_packing_session',
  array['uuid'],
  'finalize_packing_session RPC takes only the session id'
);
```

Replace lines 122-127 with:

```sql
select ok(
  not has_function_privilege(
    'anon', 'public.finalize_packing_session(uuid)', 'EXECUTE'
  ),
  'anon has no execute privilege on finalize_packing_session'
);
```

- [ ] **Step 5: Update every `start_packing_session` call site**

There are three (sessions A, B, C). Session A (lines 137-142) becomes:

```sql
create temporary table phase6_session_a as
select *
from public.start_packing_session(
  'a6200000-0000-0000-0000-000000000001',
  'a6400000-0000-0000-0000-000000000001',
  'a6700000-0000-0000-0000-000000000001',
  date '2026-05-15',
  25,
  'LOT-P6-A'
);
```

Session B (lines 385-390) becomes — note the different date, so it resolves the second DN:

```sql
create temporary table phase6_session_b as
select *
from public.start_packing_session(
  'a6200000-0000-0000-0000-000000000001',
  'a6400000-0000-0000-0000-000000000001',
  'a6700000-0000-0000-0000-000000000001',
  date '2026-06-20',
  30,
  'LOT-P6-B'
);
```

Session C (lines 543-548) becomes:

```sql
create temporary table phase6_session_c as
select *
from public.start_packing_session(
  'a6200000-0000-0000-0000-000000000001',
  'a6400000-0000-0000-0000-000000000001',
  'a6700000-0000-0000-0000-000000000001',
  date '2026-05-15',
  15,
  'LOT-P6-C'
);
```

- [ ] **Step 6: Update every `finalize_packing_session` call site**

Non-owner check (lines 234-244):

```sql
select throws_ok(
  $$
    select public.finalize_packing_session(
      (select session_id from phase6_session_a)
    )
  $$,
  'P0001',
  'PACKING_SESSION_OPERATOR_MISMATCH',
  'another operator cannot finalize the session'
);
```

Anon check (lines 255-265):

```sql
select throws_ok(
  $$
    select public.finalize_packing_session(
      (select session_id from phase6_session_a)
    )
  $$,
  '42501',
  'permission denied for function finalize_packing_session',
  'anon has no execute privilege for finalize'
);
```

First finalize (lines 276-282):

```sql
create temporary table phase6_finalize_a1 as
select *
from public.finalize_packing_session(
  (select session_id from phase6_session_a)
);
grant select on phase6_finalize_a1 to public;
```

Replay finalize (lines 320-326):

```sql
create temporary table phase6_finalize_a2 as
select *
from public.finalize_packing_session(
  (select session_id from phase6_session_a)
);
grant select on phase6_finalize_a2 to public;
```

Session C rejection (lines 550-560):

```sql
select throws_ok(
  $$
    select public.finalize_packing_session(
      (select session_id from phase6_session_c)
    )
  $$,
  'P0001',
  'SESSION_NOT_COMPLETE',
  'a session that has not reached ready_to_finalize is rejected'
);
```

- [ ] **Step 7: Update the snapshot assertion for the auto-resolved DN**

Session A now resolves `DN-PHASE6-ACTIVE` (existing active DN, supplier + 2026-05-15), so the expected string is unchanged. Add two assertions after the existing snapshot assertion (lines 308-316):

```sql
select is(
  (select qty_delivery::text || ':' || lot_no from phase6_finalize_a1),
  '25:LOT-P6-A',
  'finalize snapshots the manual qty delivery and lot no'
);

select isnt(
  (select qr_generated_at from phase6_finalize_a1),
  null,
  'finalize stamps the QR generation timestamp'
);
```

- [ ] **Step 8: Replace the four Delivery Number rejection cases with one closed-mid-session case**

Replace the four `throws_ok` blocks (lines 469-515) with:

```sql
-- The DN was valid when session B started. An admin closing it mid-session
-- must block finalize rather than let a box print against a closed DN.
reset role;

update public.delivery_numbers
set status = 'closed'
where id = 'a6800000-0000-0000-0000-000000000005';

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  'a6100000-0000-0000-0000-000000000001',
  true
);

select throws_ok(
  $$
    select public.finalize_packing_session(
      (select session_id from phase6_session_b)
    )
  $$,
  'P0001',
  'DELIVERY_NUMBER_INVALID',
  'a Delivery Number closed mid-session blocks finalize'
);
```

- [ ] **Step 9: Run the test**

Run: `node scripts/run-pgtap.mjs supabase/tests/database/015_phase_6_finalize.test.sql`
Expected: `PASS  supabase/tests/database/015_phase_6_finalize.test.sql`, exit code 0.

- [ ] **Step 10: Commit**

```bash
git add supabase/tests/database/015_phase_6_finalize.test.sql
git commit -m "test: finalize reads the session's Delivery Number instead of taking one"
```

---

### Task 6: Regenerate Supabase types

**Files:**
- Modify: `src/types/database.ts`

- [ ] **Step 1: Add the new `packing_sessions` columns**

In the `packing_sessions` table block, add to `Row`:

```ts
          lot_no: string | null
          qty_delivery: number | null
```

Add to `Insert` and `Update`:

```ts
          lot_no?: string | null
          qty_delivery?: number | null
```

- [ ] **Step 2: Add the new `print_jobs` columns**

In the `print_jobs` table block, add to `Row`:

```ts
          lot_no_snapshot: string | null
          qr_generated_at_snapshot: string | null
          qty_delivery_snapshot: number | null
```

Add to `Insert` and `Update`:

```ts
          lot_no_snapshot?: string | null
          qr_generated_at_snapshot?: string | null
          qty_delivery_snapshot?: number | null
```

- [ ] **Step 3: Replace the `start_packing_session` function type**

```ts
      start_packing_session: {
        Args: {
          p_box_id: string
          p_delivery_date: string
          p_lot_no: string
          p_master_item_id: string
          p_qty_delivery: number
          p_supplier_id: string
        }
        Returns: {
          accepted_qty: number
          box_id: string
          delivery_number: string
          delivery_number_id: string
          master_item_id: string
          operator_id: string
          session_id: string
          started_at: string
          status: Database["public"]["Enums"]["packing_session_status"]
          total_expected_qty: number
        }[]
      }
```

- [ ] **Step 4: Replace the `finalize_packing_session` function type**

```ts
      finalize_packing_session: {
        Args: { p_packing_session_id: string }
        Returns: {
          already_finalized: boolean
          box_code: string
          box_name: string
          delivery_date: string
          delivery_number: string
          label_reference: string
          lot_no: string
          packing_session_id: string
          part_name: string
          part_no: string
          print_job_id: string
          qr_generated_at: string
          qty: number
          qty_delivery: number
          sequence_no: number
          session_status: Database["public"]["Enums"]["packing_session_status"]
          supplier_code: string
          supplier_name: string
        }[]
      }
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: errors in `scan/actions.ts` and `finalize/actions.ts` only (they still pass the old arguments). Those are fixed in Tasks 9 and 10.

- [ ] **Step 6: Commit**

```bash
git add src/types/database.ts
git commit -m "chore: regenerate Supabase types for the consolidated scan flow"
```

---

### Task 7: Formatter — QR payload

**Files:**
- Modify: `src/lib/label/formatter.ts`
- Test: `src/lib/label/formatter.test.ts`

- [ ] **Step 1: Write the failing tests**

Append inside the existing `describe("formatLabelFields", ...)` block in `src/lib/label/formatter.test.ts`:

```ts
  it("builds the QR payload as five pipe-separated fields", () => {
    expect(formatLabelFields(baseSnapshot).qrPayload).toBe(
      "10015|PN-0001|100|1-150526-B101|24-07-2026",
    )
  })

  it("formats the QR date as DD-MM-YYYY from a full timestamp", () => {
    const result = formatLabelFields({
      ...baseSnapshot,
      qrGeneratedAt: "2026-12-31T23:59:59.123Z",
    })
    expect(result.qrPayload.endsWith("|31-12-2026")).toBe(true)
  })

  it("throws when qrGeneratedAt is not a parseable ISO timestamp", () => {
    expect(() =>
      formatLabelFields({ ...baseSnapshot, qrGeneratedAt: "24/07/2026" }),
    ).toThrow()
  })
```

Add `qrGeneratedAt` to `baseSnapshot` (line 8-19):

```ts
const baseSnapshot: FinalizedLabelSnapshot = {
  supplierCode: "10015",
  partNo: "PN-0001",
  partName: "Bracket Assembly",
  qty: 100,
  sequenceNo: 1,
  labelReference: "1-150526-B101",
  deliveryNumber: "DN-2026-0042",
  deliveryDate: "2026-05-15",
  boxCode: "B101",
  boxName: "Standard Box",
  qrGeneratedAt: "2026-07-24T09:15:00.000Z",
}
```

Update the existing "maps a normal snapshot to display-ready fields" expectation to include the new key:

```ts
  it("maps a normal snapshot to display-ready fields", () => {
    expect(formatLabelFields(baseSnapshot)).toEqual({
      supplierCode: "10015",
      partNo: "PN-0001",
      qty: "100",
      itemBoxReference: "1-150526-B101",
      deliveryNumber: "DN-2026-0042",
      boxName: "Standard Box",
      deliveryDate: "15-May-2026",
      qrPayload: "10015|PN-0001|100|1-150526-B101|24-07-2026",
    })
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/label/formatter.test.ts`
Expected: FAIL — `qrGeneratedAt` is not a known property of `FinalizedLabelSnapshot`.

- [ ] **Step 3: Implement**

In `src/lib/label/formatter.ts`, add `qrGeneratedAt` to `FinalizedLabelSnapshot`:

```ts
export type FinalizedLabelSnapshot = {
  supplierCode: string
  partNo: string
  partName: string
  qty: number
  sequenceNo: number
  labelReference: string
  deliveryNumber: string
  deliveryDate: string
  boxCode: string
  boxName: string
  /** ISO timestamp stamped when the print job (and its QR) was created. */
  qrGeneratedAt: string
}
```

Add `qrPayload` to `FormattedLabelFields`:

```ts
export type FormattedLabelFields = {
  supplierCode: string
  partNo: string
  qty: string
  itemBoxReference: string
  deliveryNumber: string
  boxName: string
  deliveryDate: string
  qrPayload: string
}
```

Add the QR date helper and payload builder above `formatLabelFields`:

```ts
function formatQrDate(isoTimestamp: string): string {
  const match = isoDatePattern.exec(isoTimestamp)
  if (!match) {
    throw new Error(
      `formatQrDate: expected an ISO timestamp (YYYY-MM-DD...), received "${isoTimestamp}"`,
    )
  }

  const [, yearText, monthText, dayText] = match
  return `${dayText}-${monthText}-${yearText}`
}

/**
 * Pipe-separated QR content, locked by the 2026-07-24 scan-page spec:
 * supplier code, Part No, packing qty, label reference, QR generation date.
 * The label reference already encodes {sequence}-{DDMMYY}-{box code}.
 */
function buildQrPayload(snapshot: FinalizedLabelSnapshot): string {
  return [
    snapshot.supplierCode,
    snapshot.partNo,
    String(snapshot.qty),
    snapshot.labelReference,
    formatQrDate(snapshot.qrGeneratedAt),
  ].join("|")
}
```

Add the field to the `formatLabelFields` return:

```ts
export function formatLabelFields(
  snapshot: FinalizedLabelSnapshot,
): FormattedLabelFields {
  return {
    supplierCode: snapshot.supplierCode,
    partNo: snapshot.partNo,
    qty: String(snapshot.qty),
    itemBoxReference: snapshot.labelReference,
    deliveryNumber: snapshot.deliveryNumber,
    boxName: snapshot.boxName,
    deliveryDate: formatDeliveryDate(snapshot.deliveryDate),
    qrPayload: buildQrPayload(snapshot),
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/label/formatter.test.ts`
Expected: PASS, all assertions green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/label/formatter.ts src/lib/label/formatter.test.ts
git commit -m "feat: build the label QR payload from the finalize snapshot"
```

---

### Task 8: ZPL template v2 — tighter rows plus QR

Seven text rows currently end at y=558 of 600 available dots, leaving no room for a QR. Row pitch drops from 80 to 52 dots and fonts shrink one step, freeing y=392..600 for a 165-dot QR (33 modules at magnification 5).

**Files:**
- Modify: `src/lib/label/zpl.ts`
- Test: `src/lib/label/zpl.test.ts`
- Regenerate: `src/lib/label/__snapshots__/zpl.test.ts.snap`

- [ ] **Step 1: Write the failing tests**

In `src/lib/label/zpl.test.ts`, add `qrPayload` to `sampleFields`:

```ts
const sampleFields: FormattedLabelFields = {
  supplierCode: "10015",
  partNo: "3210A-K1Z-NA01-DL",
  qty: "100",
  itemBoxReference: "1-150526-B101",
  deliveryNumber: "DN-2026-0001",
  boxName: "Box Utama",
  deliveryDate: "15-May-2026",
  qrPayload: "10015|3210A-K1Z-NA01-DL|100|1-150526-B101|24-07-2026",
}
```

Change the template-version assertion:

```ts
  it("exports template version v2 and 203dpi 55x75mm dot dimensions", () => {
    expect(TEMPLATE_VERSION).toBe("v2")
    expect(LABEL_WIDTH_DOTS).toBe(440)
    expect(LABEL_LENGTH_DOTS).toBe(600)
  })
```

Add three QR assertions inside `describe("buildLabelZpl", ...)`:

```ts
  it("emits a QR block with the payload after the text rows", () => {
    expect(zpl).toContain("^BQN,2,5")
    expect(zpl).toContain(
      "^FDMA,10015|3210A-K1Z-NA01-DL|100|1-150526-B101|24-07-2026^FS",
    )
  })

  it("keeps every element inside the 440x600 dot media area", () => {
    const origins = [...zpl.matchAll(/\^FO(\d+),(\d+)/g)]
    expect(origins.length).toBeGreaterThan(0)
    for (const [, x, y] of origins) {
      expect(Number(x)).toBeLessThan(LABEL_WIDTH_DOTS)
      expect(Number(y)).toBeLessThan(LABEL_LENGTH_DOTS)
    }
  })

  it("escapes ZPL control characters inside the QR payload", () => {
    const zplEscaped = buildLabelZpl({
      ...sampleFields,
      qrPayload: "A^B~C_D",
    })
    expect(zplEscaped).toContain("^FDMA,A_5eB_7eC_5fD^FS")
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/label/zpl.test.ts`
Expected: FAIL — `TEMPLATE_VERSION` is `"v1"` and no `^BQ` block exists.

- [ ] **Step 3: Implement the v2 template**

Replace the constants block and `buildLabelZpl` in `src/lib/label/zpl.ts`:

```ts
/**
 * ZPL template v2 for Zebra ZD220 (203 dpi), media 55 mm x 75 mm with 3 mm
 * gap, thermal-transfer wax ribbon. Layout locked by
 * docs/superpowers/specs/2026-07-24-scan-page-consolidated-form-design.md.
 *
 * v2 tightens the seven text rows (pitch 80 -> 52 dots, fonts one step
 * smaller) so the bottom third of the label is free for the QR block. Text
 * ends at y=374; the QR occupies y=392..557 of the 600 available dots.
 */
export const TEMPLATE_VERSION = "v2"

const DOTS_PER_MM = 8
export const LABEL_WIDTH_DOTS = 55 * DOTS_PER_MM // 440
export const LABEL_LENGTH_DOTS = 75 * DOTS_PER_MM // 600

const MARGIN_DOTS = 16
const ROW_HEIGHT_DOTS = 52
const FIRST_ROW_Y = 16
const VALUE_OFFSET_Y = 22
const LABEL_FONT = "^A0N,18,18"
const VALUE_FONT = "^A0N,24,24"
const VALUE_FONT_LARGE = "^A0N,30,30"
const MAX_CHARS = 28
const MAX_CHARS_LARGE = 22
const ELLIPSIS = "..."

/**
 * Model 2 QR at magnification 5. A ~52-character byte-mode payload needs
 * version 4 (33 modules), so 33 x 5 = 165 dots wide — centred horizontally
 * and clear of the text rows above.
 */
const QR_MAGNIFICATION = 5
const QR_MODULES = 33
const QR_Y = 392
const QR_X = Math.round((LABEL_WIDTH_DOTS - QR_MODULES * QR_MAGNIFICATION) / 2)
```

Keep `escapeZplText`, `truncate`, and the `LabelRow` type exactly as they are. Replace the body of `buildLabelZpl`:

```ts
export function buildLabelZpl(fields: FormattedLabelFields): string {
  const rows: LabelRow[] = [
    { label: "Supplier Code", value: fields.supplierCode },
    { label: "Part No", value: fields.partNo, large: true },
    { label: "Qty", value: fields.qty },
    { label: "No Urut Item", value: fields.itemBoxReference, large: true },
    { label: "Delivery Number", value: fields.deliveryNumber },
    { label: "Nama Box", value: fields.boxName },
    { label: "Tanggal Delivery", value: fields.deliveryDate },
  ]

  const commands = ["^XA", "^CI28", "^MTT", "^PW440", "^LL600", "^MNY", "^LH0,0"]

  rows.forEach((row, index) => {
    const y = FIRST_ROW_Y + index * ROW_HEIGHT_DOTS
    const font = row.large ? VALUE_FONT_LARGE : VALUE_FONT
    const maxChars = row.large ? MAX_CHARS_LARGE : MAX_CHARS
    const value = escapeZplText(truncate(row.value, maxChars))
    commands.push(
      `^FO${MARGIN_DOTS},${y}${LABEL_FONT}^FD${row.label}^FS`,
      `^FO${MARGIN_DOTS},${y + VALUE_OFFSET_Y}${font}^FH^FD${value}^FS`,
    )
  })

  // ^BQ data is prefixed with the error-correction level (M) and input mode
  // (A, auto). The prefix must not be hex-escaped; only the payload is.
  commands.push(
    `^FO${QR_X},${QR_Y}^BQN,2,${QR_MAGNIFICATION}^FH^FDMA,${escapeZplText(fields.qrPayload)}^FS`,
  )

  commands.push("^XZ")
  return commands.join("\n")
}
```

- [ ] **Step 4: Regenerate the golden snapshot**

Run: `npx vitest run src/lib/label/zpl.test.ts -u`

Then open `src/lib/label/__snapshots__/zpl.test.ts.snap` and confirm it reads exactly:

```
"^XA
^CI28
^MTT
^PW440
^LL600
^MNY
^LH0,0
^FO16,16^A0N,18,18^FDSupplier Code^FS
^FO16,38^A0N,24,24^FH^FD10015^FS
^FO16,68^A0N,18,18^FDPart No^FS
^FO16,90^A0N,30,30^FH^FD3210A-K1Z-NA01-DL^FS
^FO16,120^A0N,18,18^FDQty^FS
^FO16,142^A0N,24,24^FH^FD100^FS
^FO16,172^A0N,18,18^FDNo Urut Item^FS
^FO16,194^A0N,30,30^FH^FD1-150526-B101^FS
^FO16,224^A0N,18,18^FDDelivery Number^FS
^FO16,246^A0N,24,24^FH^FDDN-2026-0001^FS
^FO16,276^A0N,18,18^FDNama Box^FS
^FO16,298^A0N,24,24^FH^FDBox Utama^FS
^FO16,328^A0N,18,18^FDTanggal Delivery^FS
^FO16,350^A0N,24,24^FH^FD15-May-2026^FS
^FO137,392^BQN,2,5^FH^FDMA,10015|3210A-K1Z-NA01-DL|100|1-150526-B101|24-07-2026^FS
^XZ"
```

If it differs, the constants above were mistyped — fix them rather than accepting the snapshot.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/lib/label/zpl.test.ts`
Expected: PASS, all assertions green.

- [ ] **Step 6: Commit**

```bash
git add src/lib/label/zpl.ts src/lib/label/zpl.test.ts src/lib/label/__snapshots__/zpl.test.ts.snap
git commit -m "feat: add a QR block to the box label as ZPL template v2"
```

---

### Task 9: `startPackingSessionAction` takes the consolidated form

**Files:**
- Modify: `src/features/scan/actions.ts`

- [ ] **Step 1: Add the new error messages**

In `src/features/scan/actions.ts`, add to `safeRpcMessages`:

```ts
  DELIVERY_DATE_INVALID: "Tanggal delivery tidak valid.",
  DELIVERY_NUMBER_SUPPLIER_INVALID: "Supplier tidak aktif atau tidak ditemukan.",
  LOT_NO_INVALID: "Lot No wajib diisi (maksimal 100 karakter).",
  MASTER_ITEM_SUPPLIER_MISMATCH:
    "Master Item ini tidak terdaftar untuk supplier yang dipilih.",
  QTY_DELIVERY_INVALID: "Qty Delivery harus bilangan bulat lebih besar dari 0.",
```

- [ ] **Step 2: Add an ISO date guard**

Add above `startPackingSessionAction`:

```ts
function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00.000Z`)
  return (
    !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value
  )
}
```

- [ ] **Step 3: Replace `startPackingSessionAction`**

```ts
export async function startPackingSessionAction(
  _previousState: PackingSessionActionState,
  formData: FormData,
): Promise<PackingSessionActionState> {
  const masterItemId = valueFromFormData(formData, "masterItemId")
  const boxId = valueFromFormData(formData, "boxId")
  const supplierId = valueFromFormData(formData, "supplierId")
  const deliveryDate = valueFromFormData(formData, "deliveryDate")
  const lotNo = valueFromFormData(formData, "lotNo")
  const rawQtyDelivery = String(formData.get("qtyDelivery") ?? "").trim()

  if (
    !masterItemId ||
    !boxId ||
    !supplierId ||
    !uuidPattern.test(masterItemId) ||
    !uuidPattern.test(boxId) ||
    !uuidPattern.test(supplierId)
  ) {
    return { error: "Supplier, Master Item, dan Box wajib dipilih." }
  }

  if (!deliveryDate || !isIsoDate(deliveryDate)) {
    return { error: "Tanggal delivery tidak valid." }
  }

  if (!/^[1-9]\d{0,5}$/.test(rawQtyDelivery)) {
    return { error: "Qty Delivery harus bilangan bulat lebih besar dari 0." }
  }

  if (!lotNo || lotNo.trim().length > 100) {
    return { error: "Lot No wajib diisi (maksimal 100 karakter)." }
  }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc("start_packing_session", {
    p_box_id: boxId,
    p_delivery_date: deliveryDate,
    p_lot_no: lotNo.trim(),
    p_master_item_id: masterItemId,
    p_qty_delivery: Number(rawQtyDelivery),
    p_supplier_id: supplierId,
  })

  if (error || !data?.[0]) {
    return { error: rpcErrorMessage(error?.message ?? "") }
  }

  revalidatePath("/scan")
  return {
    success: `Packing session dimulai (${data[0].delivery_number}). Scanner siap digunakan.`,
  }
}
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: remaining errors only in `finalize/actions.ts` and `packing-scan-console.tsx`.

- [ ] **Step 5: Commit**

```bash
git add src/features/scan/actions.ts
git commit -m "feat: accept supplier, delivery date, qty delivery, and lot no when starting a session"
```

---

### Task 10: `finalizePackingSessionAction` drops the Delivery Number argument

**Files:**
- Modify: `src/features/finalize/actions.ts`

- [ ] **Step 1: Replace the action body**

In `src/features/finalize/actions.ts`, replace `finalizePackingSessionAction`:

```ts
export async function finalizePackingSessionAction(
  _previousState: FinalizePackingSessionActionState,
  formData: FormData,
): Promise<FinalizePackingSessionActionState> {
  const packingSessionId = valueFromFormData(formData, "packingSessionId")

  if (!packingSessionId || !uuidPattern.test(packingSessionId)) {
    return { error: "Packing session tidak valid." }
  }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc("finalize_packing_session", {
    p_packing_session_id: packingSessionId,
  })

  if (error || !data?.[0]) {
    return { error: rpcErrorMessage(error?.message ?? "") }
  }

  const row = data[0]
  const snapshot: FinalizeSnapshot = {
    alreadyFinalized: row.already_finalized,
    boxCode: row.box_code,
    boxName: row.box_name,
    deliveryDate: row.delivery_date,
    deliveryNumber: row.delivery_number,
    labelReference: row.label_reference,
    lotNo: row.lot_no,
    packingSessionId: row.packing_session_id,
    partName: row.part_name,
    partNo: row.part_no,
    printJobId: row.print_job_id,
    qrGeneratedAt: row.qr_generated_at,
    qty: row.qty,
    qtyDelivery: row.qty_delivery,
    sequenceNo: row.sequence_no,
    sessionStatus: row.session_status,
    supplierCode: row.supplier_code,
  }

  revalidatePath("/scan")
  return {
    snapshot,
    success: row.already_finalized
      ? "Session ini sudah difinalisasi sebelumnya."
      : "Finalisasi berhasil. Print job dibuat.",
  }
}
```

- [ ] **Step 2: Update the error message table**

Replace `DELIVERY_NUMBER_INVALID` and drop `DELIVERY_SUPPLIER_MISMATCH` (the RPC no longer raises it):

```ts
const safeRpcMessages: Record<string, string> = {
  DELIVERY_NUMBER_INVALID:
    "Delivery Number session ini sudah tidak aktif. Hubungi admin.",
  PACKING_SESSION_NOT_FOUND: "Packing session tidak ditemukan.",
  PACKING_SESSION_OPERATOR_MISMATCH:
    "Packing session ini bukan milik operator aktif.",
  SESSION_NOT_COMPLETE: "Packing session belum lengkap untuk difinalisasi.",
}
```

- [ ] **Step 3: Extend `FinalizeSnapshot`**

In `src/features/finalize/form-state.ts`:

```ts
import type { FinalizedLabelSnapshot } from "@/lib/label/formatter"

export type FinalizeSnapshot = FinalizedLabelSnapshot & {
  alreadyFinalized: boolean
  lotNo: string
  packingSessionId: string
  printJobId: string
  qtyDelivery: number
  sessionStatus: string
}
```

`qrGeneratedAt` arrives through `FinalizedLabelSnapshot` (Task 7), so it is not repeated here.

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: remaining errors only in `packing-scan-console.tsx` and `scan/page.tsx`.

- [ ] **Step 5: Commit**

```bash
git add src/features/finalize/actions.ts src/features/finalize/form-state.ts
git commit -m "feat: finalize without a Delivery Number argument and carry the new snapshot fields"
```

---

### Task 11: Scan page server data

The page no longer needs the Delivery Number list. It now needs active suppliers and the supplier link plus packing qty on each Master Item.

**Files:**
- Modify: `src/app/(operator)/scan/page.tsx`

- [ ] **Step 1: Replace the query block**

Replace lines 14-49 (the `Promise.all`) with:

```ts
  const [masterItemsResult, boxesResult, activeSessionsResult, suppliersResult] =
    await Promise.all([
      supabase
        .from("master_items")
        .select("id, item_code, part_no, part_name, default_label_qty, supplier_id")
        .eq("is_active", true)
        .order("part_no"),
      supabase
        .from("boxes")
        .select("id, master_item_id, box_no, box_code, box_name"),
      supabase
        .from("packing_sessions")
        .select(
          "id, status, master_item_id, box_id, master_items(part_no, part_name), boxes(box_code, box_name, box_layers(id, layer_no, layer_name, sort_order, box_layer_requirements(expected_qty))), packing_session_scans(id, box_layer_id, result, error_code, scanned_at)",
        )
        .eq("operator_id", auth.userId)
        .in("status", ["scanning", "ready_to_finalize"])
        .order("started_at", { ascending: false }),
      supabase
        .from("suppliers")
        .select("id, supplier_code, supplier_name")
        .eq("is_active", true)
        .order("supplier_code"),
    ])
```

- [ ] **Step 2: Replace the mapping block**

Replace lines 51-100 with:

```ts
  const dataError =
    masterItemsResult.error ??
    boxesResult.error ??
    activeSessionsResult.error ??
    suppliersResult.error
  const boxesByMasterItem = boxesResult.data ?? []
  const masterItems = (masterItemsResult.data ?? [])
    .filter((item) =>
      boxesByMasterItem.some((box) => box.master_item_id === item.id),
    )
    .map((item) => ({
      id: item.id,
      defaultLabelQty: item.default_label_qty,
      itemCode: item.item_code,
      partName: item.part_name,
      partNo: item.part_no,
      supplierId: item.supplier_id,
    }))
  const boxes = boxesByMasterItem.map((box) => ({
    id: box.id,
    masterItemId: box.master_item_id,
    boxCode: box.box_code,
    boxName: box.box_name,
  }))
  const activeSessions = (activeSessionsResult.data ?? [])
    .map(toActivePackingSession)
    .filter((session): session is ActivePackingSessionView => session !== null)
  const suppliers = (suppliersResult.data ?? []).map((supplier) => ({
    id: supplier.id,
    supplierCode: supplier.supplier_code,
    supplierName: supplier.supplier_name,
  }))
```

- [ ] **Step 3: Update the component props**

Replace the `<PackingScanConsole ... />` element (lines 113-119) with:

```tsx
      <PackingScanConsole
        activeSessions={activeSessions}
        boxes={boxes}
        masterItems={masterItems}
        suppliers={suppliers}
      />
```

- [ ] **Step 4: Delete the now-unused `DeliveryNumberQuery` type**

Remove the `type DeliveryNumberQuery = { ... }` block (lines 124-130).

- [ ] **Step 5: Commit**

```bash
git add "src/app/(operator)/scan/page.tsx"
git commit -m "feat: load suppliers and packing qty for the consolidated scan form"
```

---

### Task 12: Scan console — consolidated form, auto-finalize, error toast

**Files:**
- Modify: `src/components/operator/packing-scan-console.tsx`
- Delete: `src/features/delivery-numbers/components/create-delivery-number-dialog.tsx`

- [ ] **Step 1: Update imports**

Replace the import block (lines 1-57) with:

```tsx
"use client"

import {
  useActionState,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import {
  ArrowLeftIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  PackageCheckIcon,
  PlusIcon,
  ScanLineIcon,
  Volume2Icon,
  VolumeOffIcon,
} from "lucide-react"

import { finalizePackingSessionAction } from "@/features/finalize/actions"
import { initialFinalizePackingSessionActionState } from "@/features/finalize/form-state"
import {
  acceptPackingScanAction,
  startPackingSessionAction,
} from "@/features/scan/actions"
import { initialPackingSessionActionState } from "@/features/scan/form-state"
import { PrintJobCard } from "@/features/print/components/print-job-card"
import { useScannerListener } from "@/features/scan/use-scanner-listener"
import { useActionStateToast } from "@/components/shared/action-state-toast"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { formatLabelFields } from "@/lib/label/formatter"
```

`SearchIcon` and `CreateDeliveryNumberDialog` are gone with the finalize picker.

- [ ] **Step 2: Update the exported option types**

Replace `ScanMasterItemOption` (lines 59-64) and `DeliveryNumberOption` (lines 88-95):

```tsx
export type ScanMasterItemOption = {
  defaultLabelQty: number
  id: string
  itemCode: string
  partName: string
  partNo: string
  supplierId: string | null
}

export type ScanSupplierOption = {
  id: string
  supplierCode: string
  supplierName: string
}
```

Delete the `DeliveryNumberOption` type entirely.

- [ ] **Step 3: Replace `StartSessionForm` with the consolidated form**

Replace the whole `StartSessionForm` function (lines 155-288):

```tsx
function StartSessionForm({
  allowedBoxes,
  filteredMasterItems,
  onCancel,
  selectedBoxId,
  selectedMasterItem,
  selectedMasterItemId,
  selectedSupplierId,
  setSelectedBoxId,
  setSelectedMasterItemId,
  setSelectedSupplierId,
  startAction,
  startPending,
  startState,
  suppliers,
}: {
  allowedBoxes: ScanBoxOption[]
  filteredMasterItems: ScanMasterItemOption[]
  onCancel: (() => void) | null
  selectedBoxId: string
  selectedMasterItem: ScanMasterItemOption | null
  selectedMasterItemId: string
  selectedSupplierId: string
  setSelectedBoxId: (value: string) => void
  setSelectedMasterItemId: (value: string) => void
  setSelectedSupplierId: (value: string) => void
  startAction: (formData: FormData) => void
  startPending: boolean
  startState: { error?: string }
  suppliers: ScanSupplierOption[]
}) {
  return (
    <section className="mx-auto grid max-w-2xl gap-6">
      <div className="space-y-2">
        {onCancel ? (
          <Button
            className="px-0"
            onClick={onCancel}
            type="button"
            variant="link"
          >
            <ArrowLeftIcon data-icon="inline-start" />
            Kembali ke daftar session
          </Button>
        ) : null}
        <h1 className="text-2xl font-semibold">Mulai packing session</h1>
        <p className="text-muted-foreground text-sm">
          Isi data delivery dan pilih Box. Scanner hanya aktif setelah session
          dibuat.
        </p>
      </div>
      {suppliers.length === 0 ? (
        <Alert variant="destructive">
          <CircleAlertIcon />
          <AlertTitle>Supplier tidak tersedia</AlertTitle>
          <AlertDescription>Tidak ada supplier aktif.</AlertDescription>
        </Alert>
      ) : (
        <form action={startAction} className="rounded-xl border p-5" noValidate>
          {startState.error ? (
            <Alert className="mb-5" variant="destructive">
              <CircleAlertIcon />
              <AlertDescription>{startState.error}</AlertDescription>
            </Alert>
          ) : null}
          <FieldGroup>
            <input name="supplierId" type="hidden" value={selectedSupplierId} />
            <input
              name="masterItemId"
              type="hidden"
              value={selectedMasterItemId}
            />
            <input name="boxId" type="hidden" value={selectedBoxId} />

            <Field>
              <FieldLabel htmlFor="scan-supplier">Kode supplier</FieldLabel>
              <Select
                onValueChange={(value) => {
                  setSelectedSupplierId(value)
                  setSelectedMasterItemId("")
                  setSelectedBoxId("")
                }}
                value={selectedSupplierId}
              >
                <SelectTrigger id="scan-supplier" className="w-full">
                  <SelectValue placeholder="Pilih supplier aktif" />
                </SelectTrigger>
                <SelectContent>
                  {suppliers.map((supplier) => (
                    <SelectItem key={supplier.id} value={supplier.id}>
                      {supplier.supplierCode} · {supplier.supplierName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field>
              <FieldLabel htmlFor="scan-master-item">
                Master Item / Part No
              </FieldLabel>
              <Select
                key={selectedSupplierId}
                onValueChange={(value) => {
                  setSelectedMasterItemId(value)
                  setSelectedBoxId("")
                }}
                value={selectedMasterItemId}
              >
                <SelectTrigger id="scan-master-item" className="w-full">
                  <SelectValue placeholder="Pilih Part No" />
                </SelectTrigger>
                <SelectContent>
                  {filteredMasterItems.length === 0 ? (
                    <div className="text-muted-foreground px-2 py-1.5 text-sm">
                      Tidak ada Master Item aktif untuk supplier ini.
                    </div>
                  ) : (
                    filteredMasterItems.map((item) => (
                      <SelectItem key={item.id} value={item.id}>
                        {item.partNo} · {item.partName}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
              <FieldDescription>
                Hanya Master Item milik supplier terpilih yang memiliki Box.
              </FieldDescription>
            </Field>

            <Field>
              <FieldLabel htmlFor="scan-packing-qty">
                Packing Qty (Master Item)
              </FieldLabel>
              <Input
                disabled
                id="scan-packing-qty"
                value={
                  selectedMasterItem
                    ? String(selectedMasterItem.defaultLabelQty)
                    : "Pilih Master Item terlebih dahulu"
                }
              />
              <FieldDescription>
                Nilai ini berasal dari master data dan tercetak di label.
              </FieldDescription>
            </Field>

            <Field>
              <FieldLabel htmlFor="scan-box">Box</FieldLabel>
              <Select
                key={selectedMasterItemId}
                onValueChange={setSelectedBoxId}
                value={selectedBoxId}
              >
                <SelectTrigger id="scan-box" className="w-full">
                  <SelectValue placeholder="Pilih Box" />
                </SelectTrigger>
                <SelectContent>
                  {allowedBoxes.map((box) => (
                    <SelectItem key={box.id} value={box.id}>
                      {box.boxCode} · {box.boxName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <div className="grid gap-5 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="scan-qty-delivery">Qty Delivery</FieldLabel>
                <Input
                  id="scan-qty-delivery"
                  inputMode="numeric"
                  name="qtyDelivery"
                  placeholder="100"
                  required
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="scan-lot-no">Lot No</FieldLabel>
                <Input
                  id="scan-lot-no"
                  maxLength={100}
                  name="lotNo"
                  placeholder="LOT-2026-07-001"
                  required
                />
              </Field>
            </div>

            <Field>
              <FieldLabel htmlFor="scan-delivery-date">
                Tanggal Delivery
              </FieldLabel>
              <Input
                id="scan-delivery-date"
                name="deliveryDate"
                required
                type="date"
              />
              <FieldDescription>
                Delivery Number dibuat otomatis dari supplier dan tanggal ini.
              </FieldDescription>
            </Field>

            <Button
              disabled={
                startPending ||
                !selectedSupplierId ||
                !selectedMasterItemId ||
                !selectedBoxId
              }
              type="submit"
            >
              {startPending ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <ScanLineIcon data-icon="inline-start" />
              )}
              Mulai scan
            </Button>
          </FieldGroup>
        </form>
      )}
    </section>
  )
}
```

- [ ] **Step 4: Remove the "Phase 5" label from `SessionListView`**

In `SessionListView`, delete this line:

```tsx
          <p className="text-muted-foreground text-sm font-medium">Phase 5</p>
```

- [ ] **Step 5: Update the component signature and state**

Replace the `PackingScanConsole` signature and the first state block (lines 363-395):

```tsx
export function PackingScanConsole({
  activeSessions,
  boxes,
  masterItems,
  suppliers,
}: {
  activeSessions: ActivePackingSessionView[]
  boxes: ScanBoxOption[]
  masterItems: ScanMasterItemOption[]
  suppliers: ScanSupplierOption[]
}) {
  const router = useRouter()
  const [startState, startAction, startPending] = useActionState(
    startPackingSessionAction,
    initialPackingSessionActionState,
  )
  const [selectedSupplierId, setSelectedSupplierId] = useState("")
  const [selectedMasterItemId, setSelectedMasterItemId] = useState("")
  const [selectedBoxId, setSelectedBoxId] = useState("")
  const startSucceeded = useRef(false)
  useActionStateToast(startState)

  const [view, setView] = useState<
    { type: "list" } | { type: "start" } | { type: "detail"; sessionId: string }
  >(activeSessions.length === 0 ? { type: "start" } : { type: "list" })

  useEffect(() => {
    if (!startState.success || startSucceeded.current) return
    startSucceeded.current = true
    setView({ type: "list" })
    router.refresh()
  }, [router, startState.success])
```

- [ ] **Step 6: Drop the Delivery Number picker state**

Replace lines 397-439 (the finalize state block through `selectedDeliveryNumber`) with:

```tsx
  const [finalizeState, finalizeFormAction, finalizePending] = useActionState(
    finalizePackingSessionAction,
    initialFinalizePackingSessionActionState,
  )
  const [completedSnapshot, setCompletedSnapshot] = useState<
    typeof finalizeState.snapshot
  >(undefined)
  const finalizeRefreshedSnapshot = useRef<typeof finalizeState.snapshot>(
    undefined,
  )
  useActionStateToast(finalizeState)

  useEffect(() => {
    if (
      !finalizeState.snapshot ||
      finalizeRefreshedSnapshot.current === finalizeState.snapshot
    ) {
      return
    }
    finalizeRefreshedSnapshot.current = finalizeState.snapshot
    setCompletedSnapshot(finalizeState.snapshot)
    router.refresh()
  }, [finalizeState.snapshot, router])
```

- [ ] **Step 7: Replace the derived values**

Replace the `allowedBoxes` and `previewLabelFields` memos (lines 482-504) with:

```tsx
  const filteredMasterItems = useMemo(
    () =>
      masterItems.filter(
        (item) =>
          item.supplierId === null || item.supplierId === selectedSupplierId,
      ),
    [masterItems, selectedSupplierId],
  )

  const selectedMasterItem = useMemo(
    () => masterItems.find((item) => item.id === selectedMasterItemId) ?? null,
    [masterItems, selectedMasterItemId],
  )

  const allowedBoxes = useMemo(
    () => boxes.filter((box) => box.masterItemId === selectedMasterItemId),
    [boxes, selectedMasterItemId],
  )
```

`previewLabelFields` is deleted — the pre-finalize summary card goes with the picker.

- [ ] **Step 8: Add the auto-finalize effect**

Insert directly after the `allowedBoxes` memo:

```tsx
  const autoFinalizedSessionId = useRef<string | null>(null)

  // Every layer is full, so finalize without asking. The Delivery Number was
  // already resolved when the session started; PrintJobCard then auto-prints
  // once QZ and a printer are ready.
  useEffect(() => {
    if (
      !activeSession ||
      activeSession.status !== "ready_to_finalize" ||
      autoFinalizedSessionId.current === activeSession.id ||
      finalizePending
    ) {
      return
    }

    autoFinalizedSessionId.current = activeSession.id
    const payload = new FormData()
    payload.set("packingSessionId", activeSession.id)
    finalizeFormAction(payload)
  }, [activeSession, finalizeFormAction, finalizePending])
```

- [ ] **Step 9: Raise a sticky toast on rejected scans**

Replace the scan-tone effect (lines 475-481):

```tsx
  useEffect(() => {
    const scan = scanner.lastScan
    if (!scan || playedScanAt.current === scan.scannedAt.getTime()) return

    playedScanAt.current = scan.scannedAt.getTime()
    playScanTone(scan.status, scanner.muted)

    // A rejected scan must not scroll away behind the next one: hold the
    // toast until the operator dismisses it.
    if (scan.status === "error") {
      toast.error(scan.message, { closeButton: true, duration: Infinity })
    }
  }, [scanner.lastScan, scanner.muted])
```

- [ ] **Step 10: Show the new fields on the completed card**

In the `if (completedSnapshot)` branch, add two rows after the existing "Tanggal Delivery" `SummaryRow`:

```tsx
          <SummaryRow
            label="Qty Delivery"
            value={String(completedSnapshot.qtyDelivery)}
          />
          <SummaryRow label="Lot No" value={completedSnapshot.lotNo} />
```

And reset the new form state in the "Mulai session baru" button handler:

```tsx
        <Button
          onClick={() => {
            setCompletedSnapshot(undefined)
            setSelectedSupplierId("")
            setSelectedMasterItemId("")
            setSelectedBoxId("")
            setView(activeSessions.length > 1 ? { type: "list" } : { type: "start" })
          }}
          type="button"
          variant="outline"
        >
          Mulai session baru
        </Button>
```

- [ ] **Step 11: Pass the new props to `StartSessionForm`**

Replace the `view.type === "start"` branch:

```tsx
  if (view.type === "start") {
    return (
      <StartSessionForm
        allowedBoxes={allowedBoxes}
        filteredMasterItems={filteredMasterItems}
        onCancel={
          activeSessions.length > 0 ? () => setView({ type: "list" }) : null
        }
        selectedBoxId={selectedBoxId}
        selectedMasterItem={selectedMasterItem}
        selectedMasterItemId={selectedMasterItemId}
        selectedSupplierId={selectedSupplierId}
        setSelectedBoxId={setSelectedBoxId}
        setSelectedMasterItemId={setSelectedMasterItemId}
        setSelectedSupplierId={setSelectedSupplierId}
        startAction={startAction}
        startPending={startPending}
        startState={startState}
        suppliers={suppliers}
      />
    )
  }
```

- [ ] **Step 12: Replace the finalize block with an auto-finalize status card**

Replace the whole `{activeSession.status === "ready_to_finalize" ? (...) : null}` block (lines 712-850):

```tsx
        {activeSession.status === "ready_to_finalize" ? (
          <div className="rounded-xl border p-5">
            <div className="mb-3 flex items-center gap-2">
              {finalizePending ? (
                <Spinner className="size-5" />
              ) : (
                <PackageCheckIcon className="size-5" />
              )}
              <h2 className="font-semibold">
                {finalizePending
                  ? "Memfinalisasi box…"
                  : "Box lengkap, menunggu finalisasi"}
              </h2>
            </div>
            <p className="text-muted-foreground text-sm">
              Semua layer terpenuhi. Label dibuat dan dikirim ke printer secara
              otomatis.
            </p>
            {finalizeState.error ? (
              <Alert className="mt-4" variant="destructive">
                <CircleAlertIcon />
                <AlertDescription>{finalizeState.error}</AlertDescription>
              </Alert>
            ) : null}
          </div>
        ) : null}
```

- [ ] **Step 13: Delete the orphaned dialog**

```bash
git rm src/features/delivery-numbers/components/create-delivery-number-dialog.tsx
```

- [ ] **Step 14: Typecheck and lint**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no errors.

Run: `npx eslint "src/app/(operator)/scan" src/components/operator src/features/scan src/features/finalize src/lib/label --max-warnings=0`
Expected: no output.

- [ ] **Step 15: Run the full unit suite**

Run: `npx vitest run`
Expected: all files pass.

- [ ] **Step 16: Commit**

```bash
git add -A
git commit -m "feat: consolidate the scan start form and auto-finalize a completed box"
```

---

## Manual verification (user-run, after `supabase db push`)

The dev server cannot exercise this flow without operator credentials, so these stay unchecked until run against real hardware:

- [ ] Start a session: supplier list loads, Master Item list narrows to that supplier, packing qty fills in read-only, submitting creates a session and reports the generated `DN-NNNNNN`.
- [ ] Start a second session with the same supplier and delivery date: the toast reports the same DN, not a new one.
- [ ] Scan a product that belongs to another Master Item: a red toast appears and stays until closed.
- [ ] Fill every layer: no finalize button appears, the session finalizes on its own, and the label prints without further clicks.
- [ ] Physical label: all seven text rows are legible at the smaller font, and the QR scans back as `supplier|partNo|qty|labelReference|DD-MM-YYYY`.
