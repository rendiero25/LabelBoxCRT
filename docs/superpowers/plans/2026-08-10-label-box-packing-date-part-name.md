# Label Box: Packing Date field + fixed Part Name row Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a real per-batch "Packing Date" field (create + edit forms, printed above Delivery Date) and a fixed constant "Part Name" row (value always `"Tube"`, printed below Part No) to the label box feature.

**Architecture:** `packing_date` becomes a batch-owned column on `label_box_batches` (validated/returned by `create_label_box_batch`/`update_label_box_batch`) and is snapshotted to `print_jobs.packing_date_snapshot` exactly like `delivery_date_snapshot` (set at print-job creation, rewritten on batch edit, copied verbatim on reprint). It flows through the existing server-action → RPC → label-formatter pipeline unchanged in shape. Part Name needs zero data plumbing — it's a hardcoded row in `labelRowsFor` (the single row-list shared by the ZPL and HTML renderers), the same pattern already used for the constant `OPERATOR_PACK_TEXT` row.

**Tech Stack:** Next.js Server Actions, Supabase Postgres RPC (`SECURITY DEFINER` functions), pgTAP, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-10-label-box-packing-date-part-name-design.md`

---

### Task 1: Database migration — `packing_date` column, snapshot, and RPC changes

**Files:**
- Create: `supabase/migrations/20260810090000_label_box_packing_date.sql`
- Modify: `supabase/tests/database/019_label_box_batch.test.sql`
- Modify: `supabase/tests/database/021_label_box_batch_edit_delete.test.sql`
- Modify: `supabase/tests/database/016_phase_7_print_rpcs.test.sql` (or whichever file currently exercises `create_label_box_print_jobs`/`create_label_box_reprint_jobs` — confirm with the grep in Step 0)

- [ ] **Step 0: Confirm which test file covers the print-job RPCs**

Run: `grep -rl "create_label_box_print_jobs" supabase/tests/database/`

Expected: a filename (e.g. `supabase/tests/database/016_phase_7_print_rpcs.test.sql`). Use that file's actual name for the rest of this task — the plan assumes `016_phase_7_print_rpcs.test.sql` below; substitute if different.

- [ ] **Step 1: Extend `019_label_box_batch.test.sql` with `packing_date` assertions**

Change the plan count on line 6 from `select plan(23);` to `select plan(25);` (2 new assertions below).

Change the `has_function` signature check (currently asserts a 7-arg signature) to the new 8-arg signature — replace:

```sql
select has_function(
  'public',
  'create_label_box_batch',
  array['uuid', 'text', 'date', 'uuid', 'integer', 'text', 'integer'],
  'create_label_box_batch RPC takes supplier, DN, date, master item, qty, lot, qty cetak'
);
```

with:

```sql
select has_function(
  'public',
  'create_label_box_batch',
  array['uuid', 'text', 'date', 'date', 'uuid', 'integer', 'text', 'integer'],
  'create_label_box_batch RPC takes supplier, DN, date, packing date, master item, qty, lot, qty cetak'
);
```

Every existing call to `public.create_label_box_batch(...)` in this file passes positional args in the old order (`supplier, dn, date, master_item, qty, lot[, qty_display]`). Insert a new positional date argument right after the delivery-date argument in **every call in this file** (there are 8 calls: `labelbox_batch_a`, the `qty_delivery_display` call, `labelbox_batch_b`, and 5 `throws_ok` calls). For example, the first one:

```sql
create temporary table labelbox_batch_a as
select *
from public.create_label_box_batch(
  '95190000-0000-0000-0000-000000000001',
  'DN-LABELBOX-1',
  date '2026-07-28',
  '96190000-0000-0000-0000-000000000001',
  100,
  'LOT-LB-A'
);
```

becomes:

```sql
create temporary table labelbox_batch_a as
select *
from public.create_label_box_batch(
  '95190000-0000-0000-0000-000000000001',
  'DN-LABELBOX-1',
  date '2026-07-28',
  date '2026-07-25',
  '96190000-0000-0000-0000-000000000001',
  100,
  'LOT-LB-A'
);
```

Apply the same insertion (`date '2026-07-25',` right after the `date '2026-07-28',` delivery-date line) to the remaining 7 calls in the file, using `date '2026-07-25'` everywhere except the two DN-mismatch `throws_ok` calls near the end where the delivery date itself is `date '2026-08-01'`/others — for those, put the packing date one day before whatever delivery date that call already uses (the exact value doesn't matter for those error-path tests, only that a non-null date is supplied so the test still exercises the intended failure, not a new `PACKING_DATE_INVALID`).

Add these 3 new assertions right after the existing `'batch menyimpan snapshot part no master item'` assertion (after line 158, before the `master_item_row_no` assertion):

```sql
select is(
  (select packing_date from labelbox_batch_a),
  date '2026-07-25',
  'batch menyimpan packing date apa adanya'
);

select throws_ok(
  $$
    select public.create_label_box_batch(
      '95190000-0000-0000-0000-000000000001',
      'DN-LABELBOX-9',
      date '2026-07-28',
      null,
      '96190000-0000-0000-0000-000000000001',
      100,
      'LOT-LB-F'
    )
  $$,
  'P0001',
  'PACKING_DATE_INVALID',
  'packing date kosong ditolak'
);
```

The `is` and `throws_ok` calls above are 1 pgTAP assertion each — 2 total, matching `select plan(25);`.

- [ ] **Step 2: Extend `021_label_box_batch_edit_delete.test.sql` with `packing_date` update assertions**

Change `select plan(19);` to `select plan(21);`.

Replace the `has_function` check for `update_label_box_batch`:

```sql
select has_function(
  'public',
  'update_label_box_batch',
  array['uuid', 'text', 'date', 'text'],
  'update_label_box_batch RPC takes batch, DN, date, lot'
);
```

with:

```sql
select has_function(
  'public',
  'update_label_box_batch',
  array['uuid', 'text', 'date', 'date', 'text'],
  'update_label_box_batch RPC takes batch, DN, date, packing date, lot'
);
```

Update the `create_label_box_batch` call (add packing date positionally, same as Task 1 Step 1):

```sql
create temporary table edit_batch as
select *
from public.create_label_box_batch(
  '95210000-0000-0000-0000-000000000001',
  'DN-LB-EDIT-1',
  date '2026-08-07',
  date '2026-08-05',
  '96210000-0000-0000-0000-000000000001',
  100,
  'LOT-EDIT-A'
);
```

Update the `update_label_box_batch` call to pass a new packing date:

```sql
create temporary table edit_result as
select *
from public.update_label_box_batch(
  (select batch_id from edit_batch),
  'DN-LB-EDIT-2',
  date '2026-08-09',
  date '2026-08-08',
  'LOT-EDIT-B'
);
```

Add a new assertion right after the existing `'snapshot DN, tanggal, dan lot batch ikut berubah'` assertion:

```sql
select is(
  (select packing_date from public.label_box_batches where id = (select batch_id from edit_batch)),
  date '2026-08-08',
  'packing date batch ikut diperbarui'
);
```

Update the two `throws_ok` calls for `DELIVERY_NUMBER_INVALID`/`LOT_NO_INVALID` and the `LABEL_BOX_BATCH_NOT_FOUND`/`DELIVERY_NUMBER_DATE_SHARED` calls to include a packing date positionally (use `date '2026-08-08'`), e.g.:

```sql
select throws_ok(
  $$
    select public.update_label_box_batch(
      (select batch_id from edit_batch), '   ', date '2026-08-09', date '2026-08-08', 'LOT-EDIT-B'
    )
  $$,
  'P0001',
  'DELIVERY_NUMBER_INVALID',
  'Delivery Number kosong ditolak'
);
```

Apply the same positional insertion to the `LOT_NO_INVALID`, `LABEL_BOX_BATCH_NOT_FOUND`, and `DELIVERY_NUMBER_DATE_SHARED` `throws_ok` blocks, and to the `shared_batch` `create_label_box_batch` call.

Add one more new assertion after the packing-date-update assertion above, a validation check:

```sql
select throws_ok(
  $$
    select public.update_label_box_batch(
      (select batch_id from edit_batch), 'DN-LB-EDIT-2', date '2026-08-09', null, 'LOT-EDIT-B'
    )
  $$,
  'P0001',
  'PACKING_DATE_INVALID',
  'packing date kosong ditolak saat update'
);
```

That's 2 new assertions (19 → 21), matching `select plan(21);`.

- [ ] **Step 3: Extend the print-job RPC test file with `packing_date` propagation assertions**

Open the file identified in Step 0. Find its `create_label_box_batch` call(s) and insert the packing-date positional argument the same way as Steps 1–2. Increase its `select plan(N);` count by 2. After the existing assertion that checks `create_label_box_print_jobs` returns the expected fields (look for an `is(...)` against a column list that includes `delivery_date`), add:

```sql
select is(
  (select packing_date from edit_jobs limit 1),
  (select packing_date from public.label_box_batches where id = (select batch_id from edit_batch)),
  'create_label_box_print_jobs mengembalikan packing_date dari batch'
);
```

(Adjust the temp table names — `edit_jobs`/`edit_batch` above are illustrative; use whatever names the actual file uses for its print-jobs-created temp table and its batch temp table.)

If the file also calls `create_label_box_reprint_jobs`, add a matching assertion that the reprinted job's `packing_date` equals the original job's `packing_date` (copied from the parent, not re-read from the batch) — this is the one case where the value must come from the **job**, not the live batch, so it stays correct even if the batch is edited later.

- [ ] **Step 4: Run all three pgTAP files and confirm they fail**

Run:
```bash
node scripts/run-pgtap.mjs supabase/tests/database/019_label_box_batch.test.sql
node scripts/run-pgtap.mjs supabase/tests/database/021_label_box_batch_edit_delete.test.sql
node scripts/run-pgtap.mjs supabase/tests/database/016_phase_7_print_rpcs.test.sql
```

Expected: all three print `FAIL` — the function-signature assertions fail because the RPCs don't accept a packing-date argument yet, and/or the calls themselves error because there are too many positional arguments for the current function signatures. This confirms the tests actually exercise the new behavior before it exists.

- [ ] **Step 5: Write the migration**

Create `supabase/migrations/20260810090000_label_box_packing_date.sql`:

```sql
-- Packing Date: a real per-batch date, printed above Delivery Date.
--
-- label_box_batches gets its own packing_date column — a batch-owned fact
-- like lot_no/packing_qty, not a denormalized snapshot copy (there is no
-- delivery_numbers-style shared registry for it). print_jobs gets
-- packing_date_snapshot, following the exact same lifecycle as
-- delivery_date_snapshot: set when a print job is created, rewritten when
-- the batch is edited, copied verbatim on reprint.

alter table public.label_box_batches add column if not exists packing_date date;

update public.label_box_batches
set packing_date = delivery_date_snapshot
where packing_date is null;

alter table public.label_box_batches alter column packing_date set not null;

comment on column public.label_box_batches.packing_date is
  'Tanggal packing, dicetak di atas baris Delivery Date pada label.';

alter table public.print_jobs add column if not exists packing_date_snapshot date;

update public.print_jobs job
set packing_date_snapshot = batch.packing_date
from public.label_boxes box
join public.label_box_batches batch on batch.id = box.batch_id
where box.packing_session_id = job.packing_session_id
  and job.packing_date_snapshot is null;

alter table public.print_jobs alter column packing_date_snapshot set not null;

drop function if exists public.create_label_box_batch(uuid, text, date, uuid, integer, text, integer);

CREATE FUNCTION public.create_label_box_batch(p_supplier_id uuid, p_delivery_number text, p_delivery_date date, p_packing_date date, p_master_item_id uuid, p_qty_delivery integer, p_lot_no text, p_qty_delivery_display integer DEFAULT NULL::integer)
 RETURNS TABLE(batch_id uuid, delivery_number text, delivery_date date, packing_date date, supplier_code text, item_code text, master_item_row_no integer, packing_qty integer, qty_delivery integer, qty_delivery_display integer, lot_no text, label_count integer, qr_generated_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  target_item public.master_items%rowtype;
  target_supplier public.suppliers%rowtype;
  target_dn public.delivery_numbers%rowtype;
  created_batch public.label_box_batches%rowtype;
  normalized_lot_no text := btrim(coalesce(p_lot_no, ''));
  normalized_dn text := btrim(coalesce(p_delivery_number, ''));
  resolved_display integer := coalesce(p_qty_delivery_display, p_qty_delivery);
  box_count integer;
  set_count integer;
  computed_row_no integer;
  generated_at timestamptz := statement_timestamp();
begin
  if not private.is_active_app_user() then
    raise exception using errcode = 'P0001', message = 'ACTIVE_USER_REQUIRED';
  end if;

  select * into target_supplier
  from public.suppliers supplier
  where supplier.id = p_supplier_id and supplier.is_active;

  if target_supplier.id is null then
    raise exception using errcode = 'P0001', message = 'SUPPLIER_INVALID';
  end if;

  select * into target_item
  from public.master_items item
  where item.id = p_master_item_id and item.is_active;

  if target_item.id is null then
    raise exception using errcode = 'P0001', message = 'MASTER_ITEM_NOT_ACTIVE';
  end if;

  if target_item.supplier_id is not null
    and target_item.supplier_id <> p_supplier_id then
    raise exception using errcode = 'P0001', message = 'MASTER_ITEM_SUPPLIER_MISMATCH';
  end if;

  if p_delivery_date is null then
    raise exception using errcode = 'P0001', message = 'DELIVERY_DATE_INVALID';
  end if;

  if p_packing_date is null then
    raise exception using errcode = 'P0001', message = 'PACKING_DATE_INVALID';
  end if;

  if normalized_dn = '' or char_length(normalized_dn) > 100 then
    raise exception using errcode = 'P0001', message = 'DELIVERY_NUMBER_INVALID';
  end if;

  if normalized_lot_no = '' or char_length(normalized_lot_no) > 100 then
    raise exception using errcode = 'P0001', message = 'LOT_NO_INVALID';
  end if;

  select count(*)::integer into box_count
  from public.boxes box
  where box.master_item_id = p_master_item_id;

  if box_count = 0 then
    raise exception using errcode = 'P0001', message = 'MASTER_ITEM_HAS_NO_BOX';
  end if;

  if p_qty_delivery is null or p_qty_delivery < 1
    or target_item.default_label_qty < 1 then
    raise exception using errcode = 'P0001', message = 'QTY_DELIVERY_INVALID';
  end if;

  if resolved_display < 1 then
    raise exception using errcode = 'P0001', message = 'QTY_DELIVERY_DISPLAY_INVALID';
  end if;

  if p_qty_delivery % target_item.default_label_qty <> 0 then
    raise exception using errcode = 'P0001', message = 'QTY_DELIVERY_NOT_MULTIPLE';
  end if;

  set_count := p_qty_delivery / target_item.default_label_qty;

  if set_count > 99 then
    raise exception using errcode = 'P0001', message = 'QTY_DELIVERY_INVALID';
  end if;

  select * into target_dn
  from public.delivery_numbers dn
  where dn.supplier_id = p_supplier_id
    and lower(btrim(dn.delivery_number)) = lower(normalized_dn);

  if target_dn.id is null then
    begin
      insert into public.delivery_numbers (
        supplier_id, delivery_number, delivery_date, status, created_by
      ) values (
        p_supplier_id, normalized_dn, p_delivery_date, 'active', auth.uid()
      )
      returning * into target_dn;

      insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
      values (
        auth.uid(), 'delivery_number.created', 'delivery_number', target_dn.id::text,
        jsonb_build_object(
          'supplier_id', target_dn.supplier_id,
          'delivery_number', target_dn.delivery_number,
          'delivery_date', target_dn.delivery_date,
          'status', target_dn.status,
          'source', 'label_box_batch'
        )
      );
    exception when unique_violation then
      select * into target_dn
      from public.delivery_numbers dn
      where dn.supplier_id = p_supplier_id
        and lower(btrim(dn.delivery_number)) = lower(normalized_dn);
    end;
  end if;

  if target_dn.id is null then
    raise exception using errcode = 'P0001', message = 'DELIVERY_NUMBER_INVALID';
  end if;

  if target_dn.status <> 'active' then
    raise exception using errcode = 'P0001', message = 'DELIVERY_NUMBER_NOT_ACTIVE';
  end if;

  if target_dn.delivery_date <> p_delivery_date then
    raise exception using errcode = 'P0001', message = 'DELIVERY_NUMBER_DATE_MISMATCH';
  end if;

  select ranked.position into computed_row_no
  from (
    select item.id, (row_number() over (order by item.item_code))::integer as position
    from public.master_items item
  ) ranked
  where ranked.id = p_master_item_id;

  insert into public.label_box_batches (
    delivery_number_id, supplier_id, master_item_id, master_item_row_no,
    packing_qty, qty_delivery, qty_delivery_display, packing_date, lot_no,
    label_count, qr_generated_at, created_by, supplier_code_snapshot,
    item_code_snapshot, part_no_snapshot, delivery_number_snapshot,
    delivery_date_snapshot
  ) values (
    target_dn.id, p_supplier_id, p_master_item_id, computed_row_no,
    target_item.default_label_qty, p_qty_delivery, resolved_display,
    p_packing_date, normalized_lot_no, set_count * box_count, generated_at,
    auth.uid(), target_supplier.supplier_code, target_item.item_code,
    target_item.part_no, target_dn.delivery_number, target_dn.delivery_date
  )
  returning * into created_batch;

  insert into public.label_boxes (
    batch_id, box_id, box_no, set_no, box_number, qr_payload
  )
  select
    created_batch.id,
    box.id,
    box.box_no,
    series.set_no,
    'B' || box.box_no::text || lpad(series.set_no::text, 2, '0'),
    concat_ws(
      '|',
      target_supplier.supplier_code,
      target_item.part_no,
      target_item.default_label_qty::text,
      computed_row_no::text,
      normalized_lot_no,
      'B' || box.box_no::text || lpad(series.set_no::text, 2, '0'),
      to_char(target_dn.delivery_date, 'DD-MM-YYYY')
    )
  from generate_series(1, set_count) as series(set_no)
  cross join public.boxes box
  where box.master_item_id = p_master_item_id;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    auth.uid(), 'label_box_batch.created', 'label_box_batch', created_batch.id::text,
    jsonb_build_object(
      'delivery_number_id', created_batch.delivery_number_id,
      'master_item_id', created_batch.master_item_id,
      'qty_delivery', created_batch.qty_delivery,
      'qty_delivery_display', created_batch.qty_delivery_display,
      'packing_qty', created_batch.packing_qty,
      'packing_date', created_batch.packing_date,
      'label_count', created_batch.label_count,
      'lot_no', created_batch.lot_no
    )
  );

  return query
  select
    created_batch.id, target_dn.delivery_number, target_dn.delivery_date,
    created_batch.packing_date, target_supplier.supplier_code,
    target_item.item_code, created_batch.master_item_row_no,
    created_batch.packing_qty, created_batch.qty_delivery,
    created_batch.qty_delivery_display, created_batch.lot_no,
    created_batch.label_count, created_batch.qr_generated_at;
end;
$function$;

revoke execute on function public.create_label_box_batch(uuid, text, date, date, uuid, integer, text, integer) from public, anon;
grant execute on function public.create_label_box_batch(uuid, text, date, date, uuid, integer, text, integer) to authenticated;
grant execute on function public.create_label_box_batch(uuid, text, date, date, uuid, integer, text, integer) to service_role;

drop function if exists public.update_label_box_batch(uuid, text, date, text);

CREATE FUNCTION public.update_label_box_batch(
  p_batch_id uuid,
  p_delivery_number text,
  p_delivery_date date,
  p_packing_date date,
  p_lot_no text
)
returns table(
  batch_id uuid,
  delivery_number text,
  delivery_date date,
  packing_date date,
  lot_no text,
  label_count integer
)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  target_batch public.label_box_batches%rowtype;
  target_dn public.delivery_numbers%rowtype;
  previous_dn_id uuid;
  normalized_dn text := btrim(coalesce(p_delivery_number, ''));
  normalized_lot_no text := btrim(coalesce(p_lot_no, ''));
begin
  if not private.is_active_app_user() then
    raise exception using errcode = 'P0001', message = 'ACTIVE_USER_REQUIRED';
  end if;

  select * into target_batch
  from public.label_box_batches batch
  where batch.id = p_batch_id
  for update;

  if target_batch.id is null then
    raise exception using errcode = 'P0001', message = 'LABEL_BOX_BATCH_NOT_FOUND';
  end if;

  if p_delivery_date is null then
    raise exception using errcode = 'P0001', message = 'DELIVERY_DATE_INVALID';
  end if;

  if p_packing_date is null then
    raise exception using errcode = 'P0001', message = 'PACKING_DATE_INVALID';
  end if;

  if normalized_dn = '' or char_length(normalized_dn) > 100 then
    raise exception using errcode = 'P0001', message = 'DELIVERY_NUMBER_INVALID';
  end if;

  if normalized_lot_no = '' or char_length(normalized_lot_no) > 100 then
    raise exception using errcode = 'P0001', message = 'LOT_NO_INVALID';
  end if;

  previous_dn_id := target_batch.delivery_number_id;

  select * into target_dn
  from public.delivery_numbers dn
  where dn.supplier_id = target_batch.supplier_id
    and lower(btrim(dn.delivery_number)) = lower(normalized_dn)
  for update;

  if target_dn.id is null then
    insert into public.delivery_numbers (
      supplier_id, delivery_number, delivery_date, status, created_by
    ) values (
      target_batch.supplier_id, normalized_dn, p_delivery_date, 'active', auth.uid()
    )
    returning * into target_dn;

    insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
    values (
      auth.uid(), 'delivery_number.created', 'delivery_number', target_dn.id::text,
      jsonb_build_object(
        'supplier_id', target_dn.supplier_id,
        'delivery_number', target_dn.delivery_number,
        'delivery_date', target_dn.delivery_date,
        'status', target_dn.status,
        'source', 'label_box_batch_update'
      )
    );
  end if;

  if target_dn.status <> 'active' then
    raise exception using errcode = 'P0001', message = 'DELIVERY_NUMBER_NOT_ACTIVE';
  end if;

  if target_dn.delivery_date <> p_delivery_date then
    if exists (
      select 1 from public.label_box_batches other
      where other.delivery_number_id = target_dn.id and other.id <> p_batch_id
    ) then
      raise exception using errcode = 'P0001', message = 'DELIVERY_NUMBER_DATE_SHARED';
    end if;

    update public.delivery_numbers dn
    set delivery_date = p_delivery_date
    where dn.id = target_dn.id
    returning * into target_dn;

    insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
    values (
      auth.uid(), 'delivery_number.updated', 'delivery_number', target_dn.id::text,
      jsonb_build_object(
        'delivery_date', target_dn.delivery_date,
        'source', 'label_box_batch_update'
      )
    );
  end if;

  update public.label_box_batches batch
  set
    delivery_number_id = target_dn.id,
    lot_no = normalized_lot_no,
    packing_date = p_packing_date,
    delivery_number_snapshot = target_dn.delivery_number,
    delivery_date_snapshot = target_dn.delivery_date
  where batch.id = p_batch_id
  returning * into target_batch;

  update public.label_boxes box
  set qr_payload = concat_ws(
    '|',
    target_batch.supplier_code_snapshot,
    target_batch.part_no_snapshot,
    target_batch.packing_qty::text,
    target_batch.master_item_row_no::text,
    target_batch.lot_no,
    box.box_number,
    to_char(target_batch.delivery_date_snapshot, 'DD-MM-YYYY')
  )
  where box.batch_id = p_batch_id;

  update public.packing_sessions session
  set lot_no = target_batch.lot_no,
    delivery_number_id = target_batch.delivery_number_id
  where session.id in (
    select box.packing_session_id
    from public.label_boxes box
    where box.batch_id = p_batch_id and box.packing_session_id is not null
  );

  update public.print_jobs job
  set
    lot_no_snapshot = target_batch.lot_no,
    delivery_number_snapshot = target_batch.delivery_number_snapshot,
    delivery_date_snapshot = target_batch.delivery_date_snapshot,
    packing_date_snapshot = target_batch.packing_date,
    qr_payload_snapshot = box.qr_payload
  from public.label_boxes box
  where box.batch_id = p_batch_id
    and job.packing_session_id = box.packing_session_id;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    auth.uid(), 'label_box_batch.updated', 'label_box_batch', p_batch_id::text,
    jsonb_build_object(
      'delivery_number_id_before', previous_dn_id,
      'delivery_number_id_after', target_batch.delivery_number_id,
      'delivery_number', target_batch.delivery_number_snapshot,
      'delivery_date', target_batch.delivery_date_snapshot,
      'packing_date', target_batch.packing_date,
      'lot_no', target_batch.lot_no
    )
  );

  return query
  select
    target_batch.id, target_batch.delivery_number_snapshot,
    target_batch.delivery_date_snapshot, target_batch.packing_date,
    target_batch.lot_no, target_batch.label_count;
end;
$function$;

revoke execute on function public.update_label_box_batch(uuid, text, date, date, text) from public, anon;
grant execute on function public.update_label_box_batch(uuid, text, date, date, text) to authenticated;
grant execute on function public.update_label_box_batch(uuid, text, date, date, text) to service_role;

drop function if exists public.create_label_box_print_jobs(uuid);

CREATE FUNCTION public.create_label_box_print_jobs(p_batch_id uuid)
 RETURNS TABLE(print_job_id uuid, label_box_id uuid, box_number text, label_reference text, qr_payload text, supplier_code text, supplier_name text, part_no text, part_name text, qty integer, delivery_number text, delivery_date date, packing_date date, box_name text, lot_no text, qty_delivery integer, qty_delivery_display integer, master_item_row_no integer, status print_job_status)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  target_batch public.label_box_batches%rowtype;
  target_item public.master_items%rowtype;
  pending_box record;
  unscanned_box public.label_boxes%rowtype;
  created_session public.packing_sessions%rowtype;
  new_sequence_no bigint;
  new_label_reference text;
begin
  if not private.is_active_app_user() then
    raise exception using errcode = 'P0001', message = 'ACTIVE_USER_REQUIRED';
  end if;

  select * into target_batch
  from public.label_box_batches batch
  where batch.id = p_batch_id
  for update;

  if target_batch.id is null then
    raise exception using errcode = 'P0001', message = 'LABEL_BOX_BATCH_NOT_FOUND';
  end if;

  if target_batch.closed_at is null and exists (
    select 1
    from public.label_boxes box
    where box.batch_id = p_batch_id
      and box.status <> 'verified'
      and exists (
        select 1
        from public.box_layers layer
        join public.box_layer_requirements requirement
          on requirement.box_layer_id = layer.id
        where layer.box_id = box.box_id
      )
  ) then
    raise exception using errcode = 'P0001', message = 'LABEL_BOX_SETS_INCOMPLETE';
  end if;

  select * into target_item
  from public.master_items item
  where item.id = target_batch.master_item_id;

  for unscanned_box in
    select * from public.label_boxes box
    where box.batch_id = p_batch_id and box.packing_session_id is null
    order by box.set_no, box.box_no
  loop
    insert into public.packing_sessions (
      operator_id, master_item_id, box_id, delivery_number_id,
      qty_delivery, lot_no, status
    ) values (
      auth.uid(), target_batch.master_item_id, unscanned_box.box_id,
      target_batch.delivery_number_id, target_batch.qty_delivery,
      target_batch.lot_no, 'scanning'
    )
    returning * into created_session;

    update public.label_boxes box
    set packing_session_id = created_session.id
    where box.id = unscanned_box.id;
  end loop;

  for pending_box in
    select box.*, boxes.box_name
    from public.label_boxes box
    join public.boxes boxes on boxes.id = box.box_id
    where box.batch_id = p_batch_id
      and not exists (
        select 1 from public.print_jobs job
        where job.packing_session_id = box.packing_session_id
          and job.parent_print_job_id is null
      )
    order by box.set_no, box.box_no
  loop
    select nextval('public.print_job_sequence') into new_sequence_no;

    new_label_reference := new_sequence_no::text || '-'
      || to_char(target_batch.delivery_date_snapshot, 'DDMMYY') || '-'
      || pending_box.box_number;

    insert into public.print_jobs (
      packing_session_id, status, supplier_code_snapshot, supplier_name_snapshot,
      part_no_snapshot, part_name_snapshot, qty_snapshot, delivery_number_snapshot,
      delivery_date_snapshot, packing_date_snapshot, box_code_snapshot,
      box_name_snapshot, qty_delivery_snapshot, lot_no_snapshot,
      qr_generated_at_snapshot, qr_payload_snapshot, sequence_no, label_reference,
      template_version, zpl_payload, created_by
    )
    select
      pending_box.packing_session_id, 'pending', target_batch.supplier_code_snapshot,
      supplier.supplier_name, target_item.part_no, target_item.part_name,
      target_batch.packing_qty, target_batch.delivery_number_snapshot,
      target_batch.delivery_date_snapshot, target_batch.packing_date,
      pending_box.box_number, pending_box.box_name, target_batch.qty_delivery,
      target_batch.lot_no, target_batch.qr_generated_at, pending_box.qr_payload,
      new_sequence_no, new_label_reference, 'v4', 'PENDING_ZPL_GENERATION', auth.uid()
    from public.suppliers supplier
    where supplier.id = target_batch.supplier_id;
  end loop;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    auth.uid(), 'label_box_batch.print_jobs_created', 'label_box_batch',
    p_batch_id::text,
    jsonb_build_object(
      'label_count', target_batch.label_count,
      'batch_closed', target_batch.closed_at is not null
    )
  );

  return query
  select
    job.id, box.id, box.box_number, job.label_reference, job.qr_payload_snapshot,
    job.supplier_code_snapshot, job.supplier_name_snapshot, job.part_no_snapshot,
    job.part_name_snapshot, job.qty_snapshot, job.delivery_number_snapshot,
    job.delivery_date_snapshot, job.packing_date_snapshot, job.box_name_snapshot,
    job.lot_no_snapshot, job.qty_delivery_snapshot, target_batch.qty_delivery_display,
    target_batch.master_item_row_no, job.status
  from public.label_boxes box
  join public.print_jobs job
    on job.packing_session_id = box.packing_session_id
    and job.parent_print_job_id is null
  where box.batch_id = p_batch_id
  order by box.set_no, box.box_no;
end;
$function$;

grant execute on function public.create_label_box_print_jobs(uuid) to authenticated;
grant execute on function public.create_label_box_print_jobs(uuid) to service_role;

drop function if exists public.create_label_box_reprint_jobs(uuid, uuid[]);

create function public.create_label_box_reprint_jobs(
  p_batch_id uuid,
  p_label_box_ids uuid[] default null
)
returns table(
  print_job_id uuid,
  label_box_id uuid,
  box_number text,
  label_reference text,
  qr_payload text,
  supplier_code text,
  supplier_name text,
  part_no text,
  part_name text,
  qty integer,
  delivery_number text,
  delivery_date date,
  packing_date date,
  box_name text,
  lot_no text,
  qty_delivery integer,
  qty_delivery_display integer,
  master_item_row_no integer,
  status public.print_job_status
)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  target_batch public.label_box_batches%rowtype;
  target_box record;
  parent_job public.print_jobs%rowtype;
  pending_job public.print_jobs%rowtype;
  reprint_ids uuid[] := '{}';
begin
  if not private.is_active_app_user() then
    raise exception using errcode = 'P0001', message = 'ACTIVE_USER_REQUIRED';
  end if;

  select * into target_batch
  from public.label_box_batches batch
  where batch.id = p_batch_id
  for update;

  if target_batch.id is null then
    raise exception using errcode = 'P0001', message = 'LABEL_BOX_BATCH_NOT_FOUND';
  end if;

  for target_box in
    select box.*
    from public.label_boxes box
    where box.batch_id = p_batch_id
      and (p_label_box_ids is null or box.id = any(p_label_box_ids))
    order by box.set_no, box.box_no
  loop
    parent_job := null;
    pending_job := null;

    select * into parent_job
    from public.print_jobs job
    where job.packing_session_id = target_box.packing_session_id
      and job.parent_print_job_id is null;

    if parent_job.id is null then
      raise exception using errcode = 'P0001', message = 'LABEL_BOX_NOT_PRINTED';
    end if;

    select * into pending_job
    from public.print_jobs job
    where (job.id = parent_job.id or job.parent_print_job_id = parent_job.id)
      and job.status in ('pending', 'printing')
    order by job.created_at desc
    limit 1;

    if pending_job.id is not null then
      reprint_ids := reprint_ids || pending_job.id;
      continue;
    end if;

    insert into public.print_jobs (
      packing_session_id, parent_print_job_id, status, supplier_code_snapshot,
      supplier_name_snapshot, part_no_snapshot, part_name_snapshot, qty_snapshot,
      delivery_number_snapshot, delivery_date_snapshot, packing_date_snapshot,
      box_code_snapshot, box_name_snapshot, qty_delivery_snapshot, lot_no_snapshot,
      qr_generated_at_snapshot, qr_payload_snapshot, sequence_no,
      label_reference, template_version, zpl_payload, created_by
    )
    select
      parent_job.packing_session_id, parent_job.id, 'pending',
      parent_job.supplier_code_snapshot, parent_job.supplier_name_snapshot,
      parent_job.part_no_snapshot, parent_job.part_name_snapshot,
      parent_job.qty_snapshot, parent_job.delivery_number_snapshot,
      parent_job.delivery_date_snapshot, parent_job.packing_date_snapshot,
      parent_job.box_code_snapshot, parent_job.box_name_snapshot,
      parent_job.qty_delivery_snapshot, parent_job.lot_no_snapshot,
      parent_job.qr_generated_at_snapshot, parent_job.qr_payload_snapshot,
      parent_job.sequence_no, parent_job.label_reference,
      parent_job.template_version, 'PENDING_ZPL_GENERATION', auth.uid()
    returning id into pending_job.id;

    reprint_ids := reprint_ids || pending_job.id;
  end loop;

  if array_length(reprint_ids, 1) is null then
    raise exception using errcode = 'P0001', message = 'LABEL_BOX_NOT_FOUND';
  end if;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    auth.uid(), 'label_box_batch.reprint_jobs_created', 'label_box_batch',
    p_batch_id::text,
    jsonb_build_object(
      'reprint_count', array_length(reprint_ids, 1),
      'whole_batch', p_label_box_ids is null
    )
  );

  return query
  select
    job.id, box.id, box.box_number, job.label_reference, job.qr_payload_snapshot,
    job.supplier_code_snapshot, job.supplier_name_snapshot, job.part_no_snapshot,
    job.part_name_snapshot, job.qty_snapshot, job.delivery_number_snapshot,
    job.delivery_date_snapshot, job.packing_date_snapshot, job.box_name_snapshot,
    job.lot_no_snapshot, job.qty_delivery_snapshot, target_batch.qty_delivery_display,
    target_batch.master_item_row_no, job.status
  from public.print_jobs job
  join public.label_boxes box
    on box.packing_session_id = job.packing_session_id
  where job.id = any(reprint_ids)
  order by box.set_no, box.box_no;
end;
$function$;

grant execute on function public.create_label_box_reprint_jobs(uuid, uuid[]) to authenticated;
grant execute on function public.create_label_box_reprint_jobs(uuid, uuid[]) to service_role;

notify pgrst, 'reload schema';
```

- [ ] **Step 6: Push the migration**

Run: `npx.cmd supabase db push`
Expected: the new migration applies cleanly against the linked hosted dev project.

- [ ] **Step 7: Run all three pgTAP files again and confirm they pass**

Run the same three commands from Step 4.
Expected: all three print `PASS`.

- [ ] **Step 8: Regenerate TypeScript types**

Run:
```bash
cmd.exe /d /s /c "npx.cmd supabase gen types typescript --linked --schema public > src\types\database.ts"
```
Expected: `src/types/database.ts` now includes `packing_date`/`packing_date_snapshot` columns and the updated RPC `Args`/`Returns` shapes for all four functions touched above.

- [ ] **Step 9: Commit**

```bash
git add supabase/migrations/20260810090000_label_box_packing_date.sql supabase/tests/database/019_label_box_batch.test.sql supabase/tests/database/021_label_box_batch_edit_delete.test.sql supabase/tests/database/016_phase_7_print_rpcs.test.sql src/types/database.ts
git commit -m "feat: add packing_date to label box batches and print jobs"
```

(Substitute the actual print-job test filename from Step 0 if it differs.)

---

### Task 2: Server actions — parse, validate, and pass `packingDate`

**Files:**
- Modify: `src/features/label-boxes/actions.ts`
- Modify: `src/features/label-boxes/form-state.ts`

- [ ] **Step 1: Add the error message and extend the shared field parser**

In `src/features/label-boxes/actions.ts`, add `PACKING_DATE_INVALID` to `safeRpcMessages` (insert alphabetically, right after `MASTER_ITEM_SUPPLIER_MISMATCH`):

```ts
  PACKING_DATE_INVALID: "Tanggal Packing tidak valid.",
```

Rename `deliveryFieldsFromFormData` to `batchFieldsFromFormData` (it now covers more than delivery fields) and add `packingDate` parsing/validation. Replace the whole function:

```ts
function batchFieldsFromFormData(formData: FormData):
  | { error: string }
  | {
      deliveryDate: string
      deliveryNumber: string
      lotNo: string
      packingDate: string
    } {
  const deliveryNumber = valueFromFormData(formData, "deliveryNumber")
  const deliveryDate = valueFromFormData(formData, "deliveryDate")
  const packingDate = valueFromFormData(formData, "packingDate")
  const lotNo = valueFromFormData(formData, "lotNo")

  if (!deliveryNumber || deliveryNumber.trim().length > 100) {
    return { error: "Delivery Number wajib diisi (maksimal 100 karakter)." }
  }

  if (!deliveryDate || !isIsoDate(deliveryDate)) {
    return { error: "Tanggal delivery tidak valid." }
  }

  if (!packingDate || !isIsoDate(packingDate)) {
    return { error: "Tanggal Packing tidak valid." }
  }

  if (!lotNo || lotNo.trim().length > 100) {
    return { error: "Lot No wajib diisi (maksimal 100 karakter)." }
  }

  return {
    deliveryDate,
    deliveryNumber: deliveryNumber.trim(),
    lotNo: lotNo.trim(),
    packingDate,
  }
}
```

- [ ] **Step 2: Wire it into `createLabelBoxBatchAction`**

Replace `const delivery = deliveryFieldsFromFormData(formData)` with `const delivery = batchFieldsFromFormData(formData)` (the local variable name `delivery` can stay — only the function it calls is renamed).

In the `supabase.rpc("create_label_box_batch", {...})` call, add `p_packing_date: delivery.packingDate,` (insert alphabetically, right after `p_master_item_id`):

```ts
  const { data, error } = await supabase.rpc("create_label_box_batch", {
    p_delivery_date: delivery.deliveryDate,
    p_delivery_number: delivery.deliveryNumber,
    p_lot_no: delivery.lotNo,
    p_master_item_id: masterItemId,
    p_packing_date: delivery.packingDate,
    p_qty_delivery: Number(rawPackingQty),
    p_qty_delivery_display: Number(rawQtyDelivery),
    p_supplier_id: supplierId,
  })
```

In the success `result` object returned at the end of `createLabelBoxBatchAction`, add `packingDate: batch.packing_date,` (insert alphabetically, right after `packingQty`):

```ts
  return {
    result: {
      deliveryDate: batch.delivery_date,
      deliveryNumber: batch.delivery_number,
      itemCode: batch.item_code,
      labelBoxes: (labelBoxRows ?? []).map((row) => ({
        boxNumber: row.box_number,
        qrPayload: row.qr_payload,
      })),
      labelCount: batch.label_count,
      lotNo: batch.lot_no,
      masterItemRowNo: batch.master_item_row_no,
      packingDate: batch.packing_date,
      packingQty: batch.packing_qty,
      qtyDelivery: batch.qty_delivery_display,
      supplierCode: batch.supplier_code,
    },
    success: `${batch.label_count} label box dibuat untuk ${batch.delivery_number}.`,
  }
```

- [ ] **Step 3: Wire it into `updateLabelBoxBatchAction`**

Replace `const delivery = deliveryFieldsFromFormData(formData)` with `const delivery = batchFieldsFromFormData(formData)` in this function too.

Add `p_packing_date: delivery.packingDate,` to its `supabase.rpc("update_label_box_batch", {...})` call:

```ts
  const { data, error } = await supabase.rpc("update_label_box_batch", {
    p_batch_id: batchId,
    p_delivery_date: delivery.deliveryDate,
    p_delivery_number: delivery.deliveryNumber,
    p_lot_no: delivery.lotNo,
    p_packing_date: delivery.packingDate,
  })
```

- [ ] **Step 4: Add `packingDate` to `LabelBoxBatchResult`**

In `src/features/label-boxes/form-state.ts`, add the field (insert alphabetically, right after `masterItemRowNo`):

```ts
export type LabelBoxBatchResult = {
  deliveryDate: string
  deliveryNumber: string
  itemCode: string
  labelBoxes: GeneratedLabelBox[]
  labelCount: number
  lotNo: string
  masterItemRowNo: number
  packingDate: string
  packingQty: number
  qtyDelivery: number
  supplierCode: string
}
```

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: fails at this point — `label-box-batch-dialog.tsx` and `label-box-batch-row-actions.tsx` don't submit `packingDate` yet, so their `formAction` calls are fine (FormData is untyped), but nothing consumes `LabelBoxBatchResult.packingDate` yet either, which is fine (unused fields don't error). The typecheck should actually **pass** at this point since nothing statically requires the new field to be read yet — if it fails, read the error and fix it before moving on (don't proceed to Task 3 with a broken build).

- [ ] **Step 6: Commit**

```bash
git add src/features/label-boxes/actions.ts src/features/label-boxes/form-state.ts
git commit -m "feat: parse and forward packingDate in label box batch actions"
```

---

### Task 3: Add Label Box form — Packing Date field

**Files:**
- Modify: `src/features/label-boxes/components/label-box-batch-dialog.tsx`

- [ ] **Step 1: Add a `todayIsoDate` helper**

Add this function near the top of the file, after the imports:

```ts
function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10)
}
```

- [ ] **Step 2: Add the field, positioned above the Delivery Number/Delivery Date grid**

Find this block inside the `<FieldGroup>` in `LabelBoxBatchDialog`:

```tsx
              <FieldGroup>
                <div className="grid gap-5 sm:grid-cols-2">
                  <Field>
                    <FieldLabel htmlFor="label-box-dn">
                      Delivery Number
                    </FieldLabel>
```

Replace it with:

```tsx
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="label-box-packing-date">
                    Packing Date
                  </FieldLabel>
                  <Input
                    defaultValue={todayIsoDate()}
                    id="label-box-packing-date"
                    name="packingDate"
                    required
                    type="date"
                  />
                  <FieldDescription>
                    Dicetak di atas baris Delivery Date pada label.
                  </FieldDescription>
                </Field>

                <div className="grid gap-5 sm:grid-cols-2">
                  <Field>
                    <FieldLabel htmlFor="label-box-dn">
                      Delivery Number
                    </FieldLabel>
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS (the new input just adds a `packingDate` FormData entry; `batchFieldsFromFormData` from Task 2 already reads it).

- [ ] **Step 4: Manual check**

Run: `npm run dev`, open `/scan`, click "Tambah". Confirm a "Packing Date" field appears above "Delivery Number"/"Tanggal Delivery Number", pre-filled with today's date, and that submitting the form with it changed still succeeds (the RPC now requires it, so this also proves Task 1 + Task 2 are wired correctly end to end).

- [ ] **Step 5: Commit**

```bash
git add src/features/label-boxes/components/label-box-batch-dialog.tsx
git commit -m "feat: add Packing Date field to the Add Label Box form"
```

---

### Task 4: Edit Label Box form — Packing Date field + row data plumbing

**Files:**
- Modify: `src/features/label-boxes/components/label-box-batch-row-actions.tsx`
- Modify: `src/features/label-boxes/components/label-box-batch-table.tsx`
- Modify: `src/app/(operator)/scan/page.tsx`

This task only extends the underlying row data and the Edit dialog — it does **not** add a visible column to the batch list table.

- [ ] **Step 1: Add `packingDate` to `LabelBoxBatchEditable` and the Edit form**

In `src/features/label-boxes/components/label-box-batch-row-actions.tsx`, update the type:

```ts
export type LabelBoxBatchEditable = {
  deliveryDate: string
  deliveryNumber: string
  id: string
  labelCount: number
  lotNo: string
  packingDate: string
  partNo: string
}
```

Find this block inside `EditLabelBoxBatchDialog`'s form:

```tsx
          <input name="batchId" type="hidden" value={batch.id} />
          <FieldGroup>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor={`edit-dn-${batch.id}`}>
                  Delivery Number
                </FieldLabel>
```

Replace it with:

```tsx
          <input name="batchId" type="hidden" value={batch.id} />
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor={`edit-packing-date-${batch.id}`}>
                Packing Date
              </FieldLabel>
              <Input
                defaultValue={batch.packingDate.slice(0, 10)}
                id={`edit-packing-date-${batch.id}`}
                name="packingDate"
                required
                type="date"
              />
            </Field>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor={`edit-dn-${batch.id}`}>
                  Delivery Number
                </FieldLabel>
```

- [ ] **Step 2: Add `packingDate` to `LabelBoxBatchRow`**

In `src/features/label-boxes/components/label-box-batch-table.tsx`, update the type (this is data plumbing only — `EditLabelBoxBatchDialog` receives `batch` directly and needs the field; no new `<TableHead>`/`<TableCell>` is added):

```ts
export type LabelBoxBatchRow = {
  boxNumbers: string[]
  closed: boolean
  deliveryDate: string
  deliveryNumber: string
  id: string
  labelCount: number
  lotNo: string
  packingDate: string
  packingQty: number
  partNo: string
  printed: boolean
  qtyDelivery: number
  supplierCode: string
}
```

- [ ] **Step 3: Select and map `packing_date` in the scan page query**

In `src/app/(operator)/scan/page.tsx`, add `packing_date` to the `label_box_batches` select column list:

```ts
    supabase
      .from("label_box_batches")
      .select(
        "id, packing_qty, qty_delivery, lot_no, label_count, qr_generated_at, created_at, closed_at, supplier_code_snapshot, part_no_snapshot, delivery_number_snapshot, delivery_date_snapshot, packing_date, label_boxes(box_number, set_no, box_no, packing_session_id)",
      )
      .order("created_at", { ascending: false }),
```

Add `packing_date: string` to the `LabelBoxBatchQuery` type:

```ts
type LabelBoxBatchQuery = {
  id: string
  packing_qty: number
  qty_delivery: number
  lot_no: string
  label_count: number
  qr_generated_at: string | null
  closed_at: string | null
  supplier_code_snapshot: string
  part_no_snapshot: string
  delivery_number_snapshot: string
  delivery_date_snapshot: string
  packing_date: string
  label_boxes: Array<{
    box_number: string
    set_no: number
    box_no: number
    packing_session_id: string | null
  }>
}
```

Add `packingDate: batch.packing_date,` to `toLabelBoxBatchRow`'s return object (insert alphabetically, right after `lotNo`):

```ts
function toLabelBoxBatchRow(
  batch: LabelBoxBatchQuery,
  printedSessionIds: Set<string | null>,
): LabelBoxBatchRow {
  return {
    boxNumbers: [...batch.label_boxes]
      .sort((left, right) =>
        left.set_no === right.set_no
          ? left.box_no - right.box_no
          : left.set_no - right.set_no,
      )
      .map((labelBox) => labelBox.box_number),
    closed: batch.closed_at !== null,
    deliveryDate: batch.delivery_date_snapshot,
    deliveryNumber: batch.delivery_number_snapshot,
    id: batch.id,
    labelCount: batch.label_count,
    lotNo: batch.lot_no,
    packingDate: batch.packing_date,
    packingQty: batch.packing_qty,
    partNo: batch.part_no_snapshot,
    printed: batch.label_boxes.some(
      (labelBox) =>
        labelBox.packing_session_id !== null &&
        printedSessionIds.has(labelBox.packing_session_id),
    ),
    qtyDelivery: batch.qty_delivery,
    supplierCode: batch.supplier_code_snapshot,
  }
}
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Manual check**

On `/scan`, open "Edit" on an existing batch. Confirm "Packing Date" appears pre-filled above "Delivery Number", and saving a changed date succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/features/label-boxes/components/label-box-batch-row-actions.tsx src/features/label-boxes/components/label-box-batch-table.tsx "src/app/(operator)/scan/page.tsx"
git commit -m "feat: add Packing Date to the Edit Label Box form"
```

---

### Task 5: Print job plumbing + label formatter

**Files:**
- Modify: `src/features/label-boxes/verification-form-state.ts`
- Modify: `src/features/label-boxes/verification-actions.ts`
- Modify: `src/features/label-boxes/components/label-box-batch-print-card.tsx`
- Modify: `src/lib/label/formatter.ts`
- Modify: `src/lib/label/formatter.test.ts`

- [ ] **Step 1: Add `packingDate` to `LabelBoxPrintJob`**

In `src/features/label-boxes/verification-form-state.ts`, update the type (insert alphabetically, between `masterItemRowNo` and `partName`):

```ts
export type LabelBoxPrintJob = {
  boxName: string
  boxNumber: string
  deliveryDate: string
  deliveryNumber: string
  labelBoxId: string
  labelReference: string
  lotNo: string
  masterItemRowNo: number
  packingDate: string
  partName: string
  partNo: string
  printJobId: string
  qrPayload: string
  qty: number
  /**
   * Angka yang dicetak di baris Qty/Delivery. Bukan qty_delivery batch — kolom
   * itu keping yang dipak, yaitu penentu jumlah label.
   */
  qtyDelivery: number
  status: string
  supplierCode: string
  /** Nama supplier; dicetak di baris Customer pada label box. */
  supplierName: string
}
```

- [ ] **Step 2: Map `packing_date` in both print-job actions**

In `src/features/label-boxes/verification-actions.ts`, in **both** `createLabelBoxPrintJobsAction` and `createLabelBoxReprintJobsAction`, add `packingDate: row.packing_date,` to the `.map()` object literal (insert alphabetically, between `masterItemRowNo` and `partName`). Each map becomes:

```ts
    jobs: data.map((row) => ({
      boxName: row.box_name,
      boxNumber: row.box_number,
      deliveryDate: row.delivery_date,
      deliveryNumber: row.delivery_number,
      labelBoxId: row.label_box_id,
      labelReference: row.label_reference,
      lotNo: row.lot_no,
      masterItemRowNo: row.master_item_row_no,
      packingDate: row.packing_date,
      partName: row.part_name,
      partNo: row.part_no,
      printJobId: row.print_job_id,
      qrPayload: row.qr_payload,
      qty: row.qty,
      qtyDelivery: row.qty_delivery_display,
      status: row.status,
      supplierCode: row.supplier_code,
      supplierName: row.supplier_name,
    })),
```

- [ ] **Step 3: Add `packingDate` to `FinalizedLabelSnapshot` and `FormattedLabelFields`**

In `src/lib/label/formatter.ts`, update `FinalizedLabelSnapshot` (field order follows print-row order per the type's own doc comment — insert `packingDate` right before `deliveryDate`, since Packing Date prints directly above it):

```ts
export type FinalizedLabelSnapshot = {
  supplierCode: string
  supplierName: string
  partNo: string
  packingQty: number
  qtyDelivery: number
  masterItemRowNo: number
  lotNo: string
  boxNumber: string
  packingDate: string
  deliveryDate: string
  /** QR payload yang sudah dirakit dan disimpan di label_boxes.qr_payload. */
  qrPayload: string
}
```

Update `FormattedLabelFields` the same way:

```ts
export type FormattedLabelFields = {
  supplierCode: string
  /** Nama supplier, dicetak di baris Customer di bawah Supplier ID. */
  supplierName: string
  partNo: string
  packingQty: string
  qtyDelivery: string
  /**
   * Tiga penanda kiriman dirangkai jadi satu baris: nomor urut Master Item dua
   * digit, Lot No dari form, lalu nomor box. Ketiganya dulu berdiri sendiri
   * ("Item List", "Lot No", "No Box") dan menghabiskan tiga baris label.
   */
  lotNo: string
  packingDate: string
  deliveryDate: string
  /** Bulan kirim tanpa angka nol di depan, dicetak besar sebagai penanda FIFO. */
  deliveryMonth: string
  qrPayload: string
}
```

- [ ] **Step 4: Format it in `formatLabelFields`**

Add `packingDate: formatShortDate(snapshot.packingDate),` right before the `deliveryDate:` line:

```ts
export function formatLabelFields(
  snapshot: FinalizedLabelSnapshot,
): FormattedLabelFields {
  return {
    supplierCode: text(snapshot.supplierCode),
    supplierName: text(snapshot.supplierName),
    partNo: text(snapshot.partNo),
    packingQty: withUnit(snapshot.packingQty),
    qtyDelivery: withUnit(snapshot.qtyDelivery),
    lotNo: formatLotNoLine(snapshot),
    packingDate: formatShortDate(snapshot.packingDate),
    deliveryDate: formatShortDate(snapshot.deliveryDate),
    deliveryMonth: formatDeliveryMonth(snapshot.deliveryDate),
    qrPayload: text(snapshot.qrPayload),
  }
}
```

- [ ] **Step 5: Update `formatter.test.ts` fixtures**

Add `packingDate: "2026-08-05"` to `baseSnapshot` (insert right before `deliveryDate`):

```ts
const baseSnapshot: FinalizedLabelSnapshot = {
  supplierCode: "10015",
  supplierName: "PT SUMBER KABEL",
  partNo: "3210A-K1Z-NA01-DL",
  packingQty: 100,
  qtyDelivery: 200,
  masterItemRowNo: 1,
  lotNo: "M-CRT-004A-581-300726-B001",
  boxNumber: "B101",
  packingDate: "2026-08-05",
  deliveryDate: "2026-08-15",
  qrPayload: "10015|3210A-K1Z-NA01-DL|100|1|LOT-A|B101|15-08-2026",
}
```

Add `packingDate: "05-08-2026",` to the expected object in `"maps a snapshot to the rows printed on the label"` (insert right before `deliveryDate`):

```ts
  it("maps a snapshot to the rows printed on the label", () => {
    expect(formatLabelFields(baseSnapshot)).toEqual({
      supplierCode: "10015",
      supplierName: "PT SUMBER KABEL",
      partNo: "3210A-K1Z-NA01-DL",
      packingQty: "100 pcs",
      qtyDelivery: "200 pcs",
      lotNo: "01-M-CRT-004A-581-300726-B001-B101",
      packingDate: "05-08-2026",
      deliveryDate: "15-08-2026",
      deliveryMonth: "8",
      qrPayload: "10015|3210A-K1Z-NA01-DL|100|1|LOT-A|B101|15-08-2026",
    })
  })
```

- [ ] **Step 6: Add `packingDate` to the print card's `formatLabelFields` call**

In `src/features/label-boxes/components/label-box-batch-print-card.tsx`, inside `printJobs`, add `packingDate: job.packingDate,` (insert alphabetically, between `masterItemRowNo` and `packingQty`):

```ts
          const fields = formatLabelFields({
            boxNumber: job.boxNumber,
            deliveryDate: job.deliveryDate,
            lotNo: job.lotNo,
            masterItemRowNo: job.masterItemRowNo,
            packingDate: job.packingDate,
            packingQty: job.qty,
            partNo: job.partNo,
            qrPayload: job.qrPayload,
            qtyDelivery: job.qtyDelivery,
            supplierCode: job.supplierCode,
            supplierName: job.supplierName,
          })
```

- [ ] **Step 7: Run the unit tests**

Run: `npx vitest run src/lib/label/formatter.test.ts`
Expected: PASS.

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/features/label-boxes/verification-form-state.ts src/features/label-boxes/verification-actions.ts src/features/label-boxes/components/label-box-batch-print-card.tsx src/lib/label/formatter.ts src/lib/label/formatter.test.ts
git commit -m "feat: plumb packingDate through print jobs and the label formatter"
```

---

### Task 6: Label layout — `zpl.ts` (row list, dimensions, fonts) + its tests

This is the geometry-sensitive task. `ROW_COUNT` goes from 9 to 11 and `ROW_HEIGHT` from 40 to 33 dots (header stays 60). Every other layout constant (`QR_COLUMN_BOTTOM`, `MONTH_TOP/BOTTOM`, `FIFO_BOTTOM`, `FULL_WIDTH_ROW_TOP`, rule widths) is derived from those two numbers plus `HEADER_HEIGHT`/`QR_ROWS`/`MONTH_ROWS`, so changing them recomputes the whole label automatically — the exact new pixel values below were hand-derived from those same formulas, but **this is exactly the kind of arithmetic that must be confirmed by actually running the tests, not trusted blindly**. If a test in Step 3 fails against a value given below, trust the test failure output over this plan, fix the expected value to match, and move on — do not fight the test to match this document.

**Files:**
- Modify: `src/lib/label/zpl.ts`
- Modify: `src/lib/label/zpl.test.ts`

- [ ] **Step 1: Update the version comment and `TEMPLATE_VERSION`**

Find:
```ts
/**
 * ZPL template v4 for Zebra ZD220 (203 dpi), media 75 mm x 55 mm landscape
 * with 3 mm gap, thermal-transfer wax ribbon.
 *
 * v7 menyusun ulang isi barisnya.
```

Replace with (prepend a v8 paragraph, keep everything else in the comment unchanged below it):
```ts
/**
 * ZPL template v4 for Zebra ZD220 (203 dpi), media 75 mm x 55 mm landscape
 * with 3 mm gap, thermal-transfer wax ribbon.
 *
 * v8 menambah dua baris: "Part Name" (nilai tetap "Tube", di bawah Part No)
 * dan "Packing Date" (di atas Delivery Date). Sembilan baris jadi sebelas,
 * dan supaya tetap muat di tinggi label yang tetap, seluruh baris menyempit
 * dari 40 ke 33 dot dan setiap font ikut mengecil sebanding.
 *
 * v7 menyusun ulang isi barisnya.
```

Then find `export const TEMPLATE_VERSION = "v7"` and replace with `export const TEMPLATE_VERSION = "v8"`.

- [ ] **Step 2: Update row/font constants**

Find:
```ts
const HEADER_HEIGHT = 60
const ROWS_TOP = FRAME_Y + HEADER_HEIGHT // 68
const ROW_COUNT = 9
const ROW_HEIGHT = 40 // 9 x 40 = 360; 68 + 360 = 428, sisa 4 dot di bawah
const ROWS_BOTTOM = ROWS_TOP + ROW_COUNT * ROW_HEIGHT
```

Replace with:
```ts
const HEADER_HEIGHT = 60
const ROWS_TOP = FRAME_Y + HEADER_HEIGHT // 68
const ROW_COUNT = 11
const ROW_HEIGHT = 33 // 11 x 33 = 363; 68 + 363 = 431, sisa 1 dot di bawah
const ROWS_BOTTOM = ROWS_TOP + ROW_COUNT * ROW_HEIGHT
```

Find:
```ts
const LABEL_FONT = { height: 12, width: 6 }
const VALUE_FONT = { height: 28, width: 14 }
```

Replace with:
```ts
const LABEL_FONT = { height: 10, width: 5 }
const VALUE_FONT = { height: 23, width: 12 }
```

Find `const PART_NO_FONT = { height: 32, width: 13 }` and replace with `const PART_NO_FONT = { height: 26, width: 11 }`.

Find:
```ts
const MONTH_FONT = { height: 62, width: 34 }
const FIFO_FONT = { height: 24, width: 12 }
```

Replace with:
```ts
const MONTH_FONT = { height: 51, width: 28 }
const FIFO_FONT = { height: 20, width: 10 }
```

- [ ] **Step 3: Add the fixed Part Name text constant**

Find:
```ts
/** Ketiga operator packing dicetak tetap; yang mengepak melingkari namanya. */
const OPERATOR_PACK_TEXT = "AD | SR | ST"
const QC_PASSES_TEXT = "QC Passes"
```

Replace with:
```ts
/** Ketiga operator packing dicetak tetap; yang mengepak melingkari namanya. */
const OPERATOR_PACK_TEXT = "AD | SR | ST"
const QC_PASSES_TEXT = "QC Passes"
/** Semua Master Item saat ini bertipe tube; nilainya tetap, bukan dari fields. */
const PART_NAME_TEXT = "Tube"
```

- [ ] **Step 4: Insert the two new rows in `labelRowsFor`**

Find:
```ts
    {
      boldValue: true,
      fitValueToColumn: true,
      font: PART_NO_FONT,
      label: upper("Part No"),
      value: upper(fields.partNo),
    },
    {
      boldValue: true,
      font: VALUE_FONT,
      label: upper("Qty/Box"),
      value: upper(fields.packingQty),
    },
    {
      boldValue: true,
      font: VALUE_FONT,
      label: upper("Qty/Delivery"),
      value: upper(fields.qtyDelivery),
    },
    {
      font: VALUE_FONT,
      label: upper("Delivery Date"),
      value: fields.deliveryDate,
    },
    // Tiga baris terakhir ada di bawah kolom kanan, jadi hanya di sini nilainya
    // selebar bingkai. Lot No yang memuat tiga penanda sekaligus ditaruh di
    // baris pertamanya karena itu nilai terpanjang di label.
    {
      fitValueToColumn: true,
      font: VALUE_FONT,
      label: upper("Lot No"),
      value: upper(fields.lotNo),
    },
```

Replace with:
```ts
    {
      boldValue: true,
      fitValueToColumn: true,
      font: PART_NO_FONT,
      label: upper("Part No"),
      value: upper(fields.partNo),
    },
    // Semua Master Item saat ini bertipe tube; nilainya konstan, berbeda
    // dengan baris lain yang datanya ikut batch/master item.
    {
      font: VALUE_FONT,
      label: upper("Part Name"),
      value: upper(PART_NAME_TEXT),
    },
    {
      boldValue: true,
      font: VALUE_FONT,
      label: upper("Qty/Box"),
      value: upper(fields.packingQty),
    },
    {
      boldValue: true,
      font: VALUE_FONT,
      label: upper("Qty/Delivery"),
      value: upper(fields.qtyDelivery),
    },
    // Packing Date dan keempat baris di bawahnya sudah di luar kolom kanan
    // (QR, bulan, dan FIFO berhenti sebelum baris ini), jadi nilainya selebar
    // bingkai. Lot No yang memuat tiga penanda sekaligus ditaruh di baris
    // pertamanya karena itu nilai terpanjang di label.
    {
      font: VALUE_FONT,
      label: upper("Packing Date"),
      value: fields.packingDate,
    },
    {
      font: VALUE_FONT,
      label: upper("Delivery Date"),
      value: fields.deliveryDate,
    },
    {
      fitValueToColumn: true,
      font: VALUE_FONT,
      label: upper("Lot No"),
      value: upper(fields.lotNo),
    },
```

- [ ] **Step 5: Update `zpl.test.ts` fixtures and simple assertions**

Add `packingDate: "10-08-2026",` to `sampleFields` (insert right before `deliveryDate`):
```ts
const sampleFields: FormattedLabelFields = {
  supplierCode: "10015",
  supplierName: "PT SUMBER KABEL",
  partNo: "3210A-K1Z-NA01-DL",
  packingQty: "100 pcs",
  qtyDelivery: "200 pcs",
  lotNo: "01-M-CRT-004A-581-300726-B001-B101",
  packingDate: "10-08-2026",
  deliveryDate: "15-08-2026",
  deliveryMonth: "8",
  qrPayload: "10015|3210A-K1Z-NA01-DL|100|1|LOT-A|B101|15-08-2026",
}
```

Replace:
```ts
  it("exports template version v7 and 203dpi 75x55mm landscape dimensions", () => {
    expect(TEMPLATE_VERSION).toBe("v7")
    expect(LABEL_WIDTH_DOTS).toBe(600)
    expect(LABEL_LENGTH_DOTS).toBe(440)
  })
```
with:
```ts
  it("exports template version v8 and 203dpi 75x55mm landscape dimensions", () => {
    expect(TEMPLATE_VERSION).toBe("v8")
    expect(LABEL_WIDTH_DOTS).toBe(600)
    expect(LABEL_LENGTH_DOTS).toBe(440)
  })
```

Replace:
```ts
  it("prints the nine row labels in the order of the approved layout", () => {
    const labels = [
      "CUSTOMER",
      "SUPPLIER ID",
      "PART NO",
      "QTY/BOX",
      "QTY/DELIVERY",
      "DELIVERY DATE",
      "LOT NO",
      "OPERATOR PACK",
      "QC Passes",
    ]
    const positions = labels.map((label) => zpl.indexOf(`^FD${label}^FS`))

    expect(positions.every((position) => position > 0)).toBe(true)
    expect([...positions].sort((left, right) => left - right)).toEqual(
      positions,
    )
  })
```
with:
```ts
  it("prints the eleven row labels in the order of the approved layout", () => {
    const labels = [
      "CUSTOMER",
      "SUPPLIER ID",
      "PART NO",
      "PART NAME",
      "QTY/BOX",
      "QTY/DELIVERY",
      "PACKING DATE",
      "DELIVERY DATE",
      "LOT NO",
      "OPERATOR PACK",
      "QC Passes",
    ]
    const positions = labels.map((label) => zpl.indexOf(`^FD${label}^FS`))

    expect(positions.every((position) => position > 0)).toBe(true)
    expect([...positions].sort((left, right) => left - right)).toEqual(
      positions,
    )
  })
```

Replace the divider-height assertion inside `"draws the frame and stops the divider above the QC row"`:
```ts
    expect(zpl).toContain("^FO8,8^GB584,424,2^FS")
    expect(zpl).toContain("^FO146,68^GB0,320,2^FS")
```
with:
```ts
    expect(zpl).toContain("^FO8,8^GB584,424,2^FS")
    expect(zpl).toContain("^FO146,68^GB0,330,2^FS")
```

Replace `"runs the right column from the top edge down to the FIFO row"`:
```ts
    expect(zpl).toContain("^FO452,8^GB0,300,2^FS")
```
with:
```ts
    expect(zpl).toContain("^FO452,8^GB0,258,2^FS")
```

Replace the body of `"stops the rules inside the right column and spans full width elsewhere"`:
```ts
    const rules = [...zpl.matchAll(/\^FO8,(\d+)\^GB(\d+),0,2\^FS/g)].map(
      ([, y, width]) => ({ width: Number(width), y: Number(y) }),
    )
    expect(rules.length).toBe(9)

    // Garis kop dan dua garis baris berikutnya mengapit QR; garis di 228
    // jatuh tepat di tengah angka bulan.
    const insideRightColumn = new Set([68, 108, 148, 228])
    for (const rule of rules) {
      expect(rule.width).toBe(insideRightColumn.has(rule.y) ? 444 : 584)
    }
```
with:
```ts
    const rules = [...zpl.matchAll(/\^FO8,(\d+)\^GB(\d+),0,2\^FS/g)].map(
      ([, y, width]) => ({ width: Number(width), y: Number(y) }),
    )
    expect(rules.length).toBe(11)

    // Garis kop dan dua garis baris berikutnya mengapit QR; garis di 200
    // jatuh tepat di tengah angka bulan.
    const insideRightColumn = new Set([68, 101, 134, 200])
    for (const rule of rules) {
      expect(rule.width).toBe(insideRightColumn.has(rule.y) ? 444 : 584)
    }
```

Replace `"prints Lot No at the same size as the other values"`:
```ts
    expect(zpl).toContain(
      "^A@N,28,14,E:OUTFITRG.TTF^FB418,1,0,L,0^FH^FD01-M-CRT-004A-581-300726-B001-B101^FS",
    )
```
with:
```ts
    expect(zpl).toContain(
      "^A@N,23,12,E:OUTFITRG.TTF^FB418,1,0,L,0^FH^FD01-M-CRT-004A-581-300726-B001-B101^FS",
    )
```

Replace `"prints the company header at the same size as Supplier ID"`:
```ts
    expect(zpl).toContain(
      "^A@N,28,14,E:OUTFITBD.TTF^FB416,1,0,L,0^FH^FDPT. CRT KABELITA^FS",
    )
```
with:
```ts
    expect(zpl).toContain(
      "^A@N,23,12,E:OUTFITBD.TTF^FB416,1,0,L,0^FH^FDPT. CRT KABELITA^FS",
    )
```

Replace `"prints the supplier name at its nominal width when it fits"`:
```ts
    expect(zpl).toContain(
      "^A@N,28,14,E:OUTFITRG.TTF^FB278,1,0,L,0^FH^FDPT SUMBER KABEL^FS",
    )
```
with:
```ts
    expect(zpl).toContain(
      "^A@N,23,12,E:OUTFITRG.TTF^FB278,1,0,L,0^FH^FDPT SUMBER KABEL^FS",
    )
```

Replace `"keeps a 26-character supplier name uncondensed and uncut"`:
```ts
    expect(zplLong).toContain(
      "^A@N,28,14,E:OUTFITRG.TTF^FB278,1,0,L,0^FH^FDPT CIPTA MANDIRI WIRASAKTI^FS",
    )
```
with:
```ts
    expect(zplLong).toContain(
      "^A@N,23,12,E:OUTFITRG.TTF^FB278,1,0,L,0^FH^FDPT CIPTA MANDIRI WIRASAKTI^FS",
    )
```

Replace `"condenses a supplier name too long for its column"`:
```ts
    // 41 karakter di blok 236 dot: 236 / (41 x 0.75) = 7.
    expect(zplLonger).toContain("^A@N,28,9,E:OUTFITRG.TTF^FB278,1,0,L,0^FH^FDPT")
```
with:
```ts
    // 41 karakter di blok 278 dot: floor(278 / (41 x 0.75)) = 9.
    expect(zplLonger).toContain("^A@N,23,9,E:OUTFITRG.TTF^FB278,1,0,L,0^FH^FDPT")
```

Replace the FIFO/month block in `"prints the delivery month and the FIFO line under the QR"`:
```ts
    expect(zpl).toContain(
      "^FO456,197^A@N,62,34,E:OUTFITBD.TTF^FB132,1,0,C,0^FH^FD8^FS",
    )
    expect(zpl).toContain(
      "^FO456,276^A@N,24,12,E:OUTFITBD.TTF^FB132,1,0,C,0^FH^FDFIFO PT CRT^FS",
    )
```
with:
```ts
    expect(zpl).toContain(
      "^FO456,174^A@N,51,28,E:OUTFITBD.TTF^FB132,1,0,C,0^FH^FD8^FS",
    )
    expect(zpl).toContain(
      "^FO456,239^A@N,20,10,E:OUTFITBD.TTF^FB132,1,0,C,0^FH^FDFIFO PT CRT^FS",
    )
```

Replace the y-bound in `"keeps the QR inside its top-right column"`:
```ts
    expect(Number(y) + 132).toBeLessThanOrEqual(188)
```
with:
```ts
    expect(Number(y) + 132).toBeLessThanOrEqual(167)
```

Replace the body of `"draws the field names in Bold and only the sought values with them"`:
```ts
    expect(zpl).toContain(
      "^A@N,12,6,E:OUTFITBD.TTF^FB116,1,0,L,0^FH^FDPART NO^FS",
    )
    expect(zpl).toContain(
      "^A@N,32,13,E:OUTFITBD.TTF^FB278,1,0,L,0^FH^FD3210A-K1Z-NA01-DL^FS",
    )
    expect(zpl).toContain(
      "^A@N,28,14,E:OUTFITBD.TTF^FB278,1,0,L,0^FH^FD100 PCS^FS",
    )
    expect(zpl).toContain(
      "^A@N,28,14,E:OUTFITBD.TTF^FB278,1,0,L,0^FH^FD200 PCS^FS",
    )
    expect(zpl).toContain(
      "^A@N,28,14,E:OUTFITBD.TTF^FB556,1,0,C,0^FH^FDQC Passes^FS",
    )
    expect(zpl).not.toContain("^A0N,")
```
with:
```ts
    expect(zpl).toContain(
      "^A@N,10,5,E:OUTFITBD.TTF^FB116,1,0,L,0^FH^FDPART NO^FS",
    )
    expect(zpl).toContain(
      "^A@N,26,11,E:OUTFITBD.TTF^FB278,1,0,L,0^FH^FD3210A-K1Z-NA01-DL^FS",
    )
    expect(zpl).toContain(
      "^A@N,23,12,E:OUTFITBD.TTF^FB278,1,0,L,0^FH^FD100 PCS^FS",
    )
    expect(zpl).toContain(
      "^A@N,23,12,E:OUTFITBD.TTF^FB278,1,0,L,0^FH^FD200 PCS^FS",
    )
    expect(zpl).toContain(
      "^A@N,23,12,E:OUTFITBD.TTF^FB556,1,0,C,0^FH^FDQC Passes^FS",
    )
    expect(zpl).not.toContain("^A0N,")
```

Replace `"draws the remaining values in the Regular face"` (Delivery Date moved from the narrow/278 column to the wide/418 column, so it needs its own check instead of sharing a loop with Supplier ID):
```ts
  it("draws the remaining values in the Regular face", () => {
    for (const value of ["10015", "15-08-2026"]) {
      expect(zpl).toContain(`E:OUTFITRG.TTF^FB278,1,0,L,0^FH^FD${value}^FS`)
    }
    // Dua baris terbawah selebar bingkai, bukan berhenti di kolom QR.
    expect(zpl).toContain(
      "E:OUTFITRG.TTF^FB418,1,0,L,0^FH^FDAD | SR | ST^FS",
    )
  })
```
with:
```ts
  it("draws the remaining values in the Regular face", () => {
    expect(zpl).toContain("E:OUTFITRG.TTF^FB278,1,0,L,0^FH^FD10015^FS")
    // Packing Date, Delivery Date, dan Operator Pack sudah di luar kolom
    // kanan, jadi selebar bingkai (418), bukan berhenti di kolom QR (278).
    expect(zpl).toContain("E:OUTFITRG.TTF^FB418,1,0,L,0^FH^FD15-08-2026^FS")
    expect(zpl).toContain(
      "E:OUTFITRG.TTF^FB418,1,0,L,0^FH^FDAD | SR | ST^FS",
    )
  })
```

Add two new tests at the end of the `describe("buildLabelZpl", ...)` block, right before the closing `})` of the describe block (after the `"escapes ZPL control characters inside the QR payload"` test):
```ts

  it("prints the fixed Part Name value regardless of the input fields", () => {
    expect(zpl).toContain(
      "^A@N,23,12,E:OUTFITRG.TTF^FB278,1,0,L,0^FH^FDTUBE^FS",
    )
  })

  it("prints Packing Date above Delivery Date, both spanning the full frame width", () => {
    const packingDateIndex = zpl.indexOf("^FDPACKING DATE^FS")
    const deliveryDateIndex = zpl.indexOf("^FDDELIVERY DATE^FS")
    expect(packingDateIndex).toBeGreaterThan(0)
    expect(deliveryDateIndex).toBeGreaterThan(packingDateIndex)
    expect(zpl).toContain(
      "^A@N,23,12,E:OUTFITRG.TTF^FB418,1,0,L,0^FH^FD10-08-2026^FS",
    )
  })
```

- [ ] **Step 6: Run the ZPL unit tests**

Run: `npx vitest run src/lib/label/zpl.test.ts`

Expected: most tests pass. If any hand-derived numeric literal above is wrong, this run tells you exactly which one and what the actual value is — fix that specific expected value in the test to match the actual (correct, formula-driven) output, don't change the source constants to match a guessed test value.

The **snapshot test** (`"matches the golden sample layout"`) will fail because the stored snapshot is still the v7 layout. Delete the stale snapshot and regenerate it:

Run: `npx vitest run src/lib/label/zpl.test.ts -u`

Expected: PASS, and `src/lib/label/__snapshots__/zpl.test.ts.snap` is rewritten with the new v8 output. Open the diff and sanity-check it by eye — it should contain the eleven rows in the right order with the new dot values.

- [ ] **Step 7: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/lib/label/zpl.ts src/lib/label/zpl.test.ts src/lib/label/__snapshots__/zpl.test.ts.snap
git commit -m "feat: add Part Name and Packing Date rows to the ZPL label template (v8)"
```

---

### Task 7: `html.ts` tests + full verification + hardware UAT

`src/lib/label/html.ts` needs **no source changes** — it renders whatever `LABEL_LAYOUT` and `labelRowsFor` (both from `zpl.ts`) describe, so it already picks up the eleven-row v8 layout from Task 6. Only its test file's expectations shift.

**Files:**
- Modify: `src/lib/label/html.test.ts`

- [ ] **Step 1: Update the `sampleFields` fixture**

Add `packingDate: "10-08-2026",` right before `deliveryDate`, matching Task 6's `zpl.test.ts` fixture:

```ts
const sampleFields: FormattedLabelFields = {
  supplierCode: "10015",
  supplierName: "PT SUMBER KABEL",
  partNo: "3210A-K1Z-NA01-DL",
  packingQty: "100 pcs",
  qtyDelivery: "200 pcs",
  lotNo: "01-M-CRT-004A-581-300726-B001-B101",
  packingDate: "10-08-2026",
  deliveryDate: "15-08-2026",
  deliveryMonth: "8",
  qrPayload: "10015|3210A-K1Z-NA01-DL|100|1|LOT-A|B101|15-08-2026",
}
```

- [ ] **Step 2: Update the field-name and upper-case tests**

Replace:
```ts
  it("prints the company name and all nine field names", () => {
    for (const name of [
      "PT. CRT KABELITA",
      "CUSTOMER",
      "SUPPLIER ID",
      "PART NO",
      "QTY/BOX",
      "QTY/DELIVERY",
      "DELIVERY DATE",
      "LOT NO",
      "OPERATOR PACK",
      "QC Passes",
    ]) {
      expect(html).toContain(`>${name}</div>`)
    }
  })
```
with:
```ts
  it("prints the company name and all eleven field names", () => {
    for (const name of [
      "PT. CRT KABELITA",
      "CUSTOMER",
      "SUPPLIER ID",
      "PART NO",
      "PART NAME",
      "QTY/BOX",
      "QTY/DELIVERY",
      "PACKING DATE",
      "DELIVERY DATE",
      "LOT NO",
      "OPERATOR PACK",
      "QC Passes",
    ]) {
      expect(html).toContain(`>${name}</div>`)
    }
  })
```

Replace:
```ts
  it("renders every field value in upper case", () => {
    for (const value of [
      sampleFields.supplierCode,
      sampleFields.packingQty,
      sampleFields.qtyDelivery,
      sampleFields.deliveryDate,
      "AD | SR | ST",
    ]) {
      expect(html).toContain(`>${value.toUpperCase()}</div>`)
    }

    for (const value of [
      sampleFields.supplierName,
      sampleFields.partNo,
      sampleFields.lotNo,
    ]) {
      expect(html).toContain(`>${value.toUpperCase()}<`)
    }
  })
```
with:
```ts
  it("renders every field value in upper case", () => {
    for (const value of [
      sampleFields.supplierCode,
      sampleFields.packingQty,
      sampleFields.qtyDelivery,
      sampleFields.packingDate,
      sampleFields.deliveryDate,
      "AD | SR | ST",
    ]) {
      expect(html).toContain(`>${value.toUpperCase()}</div>`)
    }

    for (const value of [
      sampleFields.supplierName,
      sampleFields.partNo,
      sampleFields.lotNo,
    ]) {
      expect(html).toContain(`>${value.toUpperCase()}<`)
    }
  })

  it("prints the fixed Part Name value regardless of the input fields", () => {
    expect(html).toContain(">TUBE</div>")
  })
```

- [ ] **Step 3: Update the divider and QC-row geometry assertions**

Replace:
```ts
  it("stops the column divider above the QC row", () => {
    expect(html).toContain("left:18.25mm;top:8.5mm;width:0.25mm;height:40mm")
  })
```
with:
```ts
  it("stops the column divider above the QC row", () => {
    expect(html).toContain(
      "left:18.25mm;top:8.5mm;width:0.25mm;height:41.25mm",
    )
  })
```

Replace:
```ts
  it("centres the QC row across the frame with no value column", () => {
    expect(html).toContain("left:2.75mm;top:48.5mm;width:69.5mm")
    expect(html).toContain("justify-content:center;font-size:3.5mm")
    expect(html.slice(html.indexOf(">QC Passes</div>"))).not.toContain(
      "left:26.75mm",
    )
  })
```
with:
```ts
  it("centres the QC row across the frame with no value column", () => {
    expect(html).toContain("left:2.75mm;top:49.75mm;width:69.5mm")
    expect(html).toContain("justify-content:center;font-size:2.875mm")
    expect(html.slice(html.indexOf(">QC Passes</div>"))).not.toContain(
      "left:26.75mm",
    )
  })
```

- [ ] **Step 4: Run the HTML unit tests**

Run: `npx vitest run src/lib/label/html.test.ts`
Expected: PASS. As in Task 6, if a geometry number here doesn't match, trust the actual failure output (derived from the now-correct `zpl.ts` constants) over this plan's hand-computed value.

- [ ] **Step 5: Commit**

```bash
git add src/lib/label/html.test.ts
git commit -m "test: update HTML label tests for the eleven-row v8 layout"
```

- [ ] **Step 6: Full verification sweep**

Run each of these and confirm they all pass before calling this done — this mirrors `npm run format:check && npm run typecheck && npm run lint && npm test && npm run test:integration && npm run build` from the README:

```bash
npm run format:check
npm run typecheck
npm run lint
npm test
npm run test:integration
npm run build
```

`npm run test:integration` is expected to pass with no tests (the repo has none yet). If `format:check` fails, run `npm run format` and re-stage/commit the reformatted files.

- [ ] **Step 7: Hardware verification (required before production use)**

This cannot be done from code and is not optional per this repo's Definition of Done for label changes (`AGENTS.md` §17: "Hardware UAT tersedia untuk fitur scan/print"):

1. On the real workstation with QZ Tray running, create a test label box batch (or reprint an existing one) so a v8 label is generated.
2. Print one label on the Zebra ZD220. Confirm all eleven rows are present, none of the text is clipped by `^FB`, the "Part Name: Tube" and "Packing Date" rows read clearly at the new 33-dot row height, and the QR still scans.
3. Print the same batch on the Canon G4010 paper path (HTML/pixel mode). Confirm the same eleven rows render correctly and match the ZD220 layout proportionally.
4. If any row's text is clipped, too small to read, or visually unbalanced, adjust the specific font size(s) in `zpl.ts` (Task 6, Step 2) and re-run Task 6 Step 6 (`vitest run src/lib/label/zpl.test.ts -u`) to regenerate the snapshot against the adjusted values, then repeat this hardware check.

- [ ] **Step 8: Final commit (only if Step 7 required font adjustments)**

```bash
git add src/lib/label/zpl.ts src/lib/label/zpl.test.ts src/lib/label/__snapshots__/zpl.test.ts.snap
git commit -m "fix: tune v8 label font sizes after hardware verification"
```

---

## Definition of Done

- [ ] All 7 tasks above complete, each committed separately.
- [ ] `packing_date`/`packing_date_snapshot` round-trip through create → print → reprint, and through edit (Task 1).
- [ ] Add Label Box and Edit Label Box Batch forms both require and submit Packing Date (Tasks 3–4).
- [ ] Printed label shows Part Name ("Tube") below Part No and Packing Date above Delivery Date, on both the ZD220 and the Canon G4010 paths (Tasks 6–7).
- [ ] `npm run format:check && npm run typecheck && npm run lint && npm test && npm run test:integration && npm run build` all pass (Task 7, Step 6).
- [ ] Hardware UAT on both printers confirms the eleven-row layout is legible (Task 7, Step 7).

