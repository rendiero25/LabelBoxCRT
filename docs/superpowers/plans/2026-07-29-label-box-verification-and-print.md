# Label Box Verification and Print Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Operator memverifikasi isi label box dengan scan produk, menutup batch, lalu mencetak seluruh label sekaligus; sisa alur packing session lama dibuang.

**Architecture:** Satu RPC pembungkus memilih label box tujuan lalu mendelegasikan ke `accept_packing_scan` yang sudah teruji, dengan `packing_sessions` dibuat malas per label box. Menutup batch menstempel `closed_at` dan melengkapi sesi yang kosong; RPC ketiga membuat satu `print_jobs` per label box memakai `qr_payload` tersimpan.

**Tech Stack:** Next.js 15 App Router + React 19 (`useActionState`), Supabase Postgres (SECURITY DEFINER RPC), pgTAP, Vitest, QZ Tray, Zebra ZPL.

**Spec:** `docs/superpowers/specs/2026-07-29-label-box-verification-and-print-design.md`

---

## Koreksi spec

Spec menyebut `PrintJobCard` dipakai ulang. Setelah membaca `src/features/print/components/print-job-card.tsx`, kartu itu mencetak **satu** job dan mengambil `FinalizeSnapshot` dari `src/features/finalize/`, yang dibuang di task terakhir. Yang dipakai ulang adalah pipa QZ-nya — `sendZpl`, `useQzConnection`, `PrinterPicker`, `usePreferredPrinter`, `claimPrintJobAction`, `completePrintJobAction` — sedangkan kartunya diganti kartu batch yang mencetak berurutan. `PrintJobCard` ikut dibuang di task terakhir.

## Running database work

Docker tidak terpasang, jadi `supabase test db` dan `supabase db diff` gagal. Dua perintah yang jalan:

- **Terapkan migrasi:** `npx supabase db push` (butuh `SUPABASE_ACCESS_TOKEN` dari `.env.local`)
- **Jalankan satu file pgTAP:** `node scripts/run-pgtap.mjs <path>`

Migrasi wajib di-push sebelum Task 3 jalan.

Empat file test sudah merah di branch ini karena fixture usang dan **bukan bagian pekerjaan ini**: `001_phase_2_schema`, `003_phase_2_seed`, `012_product_auto_code`, `016_phase_7_print_rpcs`.

## File Structure

| File | Tanggung jawab | Aksi |
|---|---|---|
| `supabase/migrations/20260729080000_label_box_verification.sql` | Kolom baru, tiga RPC verifikasi/tutup/cetak | Create |
| `supabase/tests/database/020_label_box_verification.test.sql` | pgTAP alur verifikasi dan cetak | Create |
| `src/types/database.ts` | Tipe Supabase | Modify |
| `src/lib/label/formatter.ts` + `.test.ts` | Snapshot membawa `qrPayload` jadi, bukan merakit | Modify |
| `src/lib/label/zpl.ts` + `.test.ts` + snapshot | `TEMPLATE_VERSION` v3 | Modify |
| `src/features/label-boxes/verification-form-state.ts` | Tipe state verifikasi dan cetak | Create |
| `src/features/label-boxes/verification-actions.ts` | Tiga server action | Create |
| `src/features/label-boxes/components/label-box-verification-console.tsx` | Layar scan | Create |
| `src/app/(operator)/scan/[batchId]/verifikasi/page.tsx` | Data server layar verifikasi | Create |
| `src/features/label-boxes/components/label-box-batch-print-card.tsx` | Cetak seluruh label batch | Create |
| `src/features/label-boxes/components/label-box-batch-table.tsx` | Kolom status, aksi kondisional | Modify |
| `src/app/(operator)/scan/page.tsx` | Muat status batch | Modify |

---

### Task 1: Migrasi — kolom baru

**Files:**
- Create: `supabase/migrations/20260729080000_label_box_verification.sql`

- [ ] **Step 1: Buat file dengan bagian skema**

```sql
-- Label box verification and print (spec
-- docs/superpowers/specs/2026-07-29-label-box-verification-and-print-design.md).
--
-- Batch ditutup operator sebelum boleh dicetak. Tiap label box dipautkan ke
-- satu packing_session supaya logika layer di accept_packing_scan bisa
-- dipakai ulang tanpa ditulis ulang.

alter table public.label_box_batches
  add column closed_at timestamptz,
  add column closed_by uuid references public.profiles (id) on delete restrict;

alter table public.label_boxes
  add column packing_session_id uuid
    references public.packing_sessions (id) on delete restrict;

create unique index label_boxes_packing_session_idx
  on public.label_boxes (packing_session_id)
  where packing_session_id is not null;

-- QR label cetak memakai payload yang sudah tersimpan di label_boxes,
-- bukan dirakit ulang di klien.
alter table public.print_jobs
  add column qr_payload_snapshot text
    check (qr_payload_snapshot is null or btrim(qr_payload_snapshot) <> '');

create index label_box_batches_closed_idx
  on public.label_box_batches (closed_at desc nulls first);
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/20260729080000_label_box_verification.sql
git commit -m "feat: add batch close and label box session columns"
```

---

### Task 2: Migrasi — tiga RPC

**Files:**
- Modify: `supabase/migrations/20260729080000_label_box_verification.sql` (append)

- [ ] **Step 1: Tambahkan `accept_label_box_scan`**

```sql
create function public.accept_label_box_scan(
  p_batch_id uuid,
  p_label_uid text,
  p_raw_payload_hash text,
  p_scanned_size text,
  p_normalized_size text
)
returns table (
  result public.scan_result,
  error_code text,
  label_box_id uuid,
  box_number text,
  label_box_status public.label_box_status,
  layer_accepted_qty integer,
  layer_expected_qty integer,
  total_accepted_qty integer,
  total_expected_qty integer
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  target_batch public.label_box_batches%rowtype;
  target_box public.label_boxes%rowtype;
  created_session public.packing_sessions%rowtype;
  scan_row record;
begin
  if not private.is_active_operator() then
    raise exception using errcode = 'P0001', message = 'LABEL_BOX_OPERATOR_REQUIRED';
  end if;

  select * into target_batch
  from public.label_box_batches batch
  where batch.id = p_batch_id;

  if target_batch.id is null then
    raise exception using errcode = 'P0001', message = 'LABEL_BOX_BATCH_NOT_FOUND';
  end if;

  if target_batch.closed_at is not null then
    raise exception using errcode = 'P0001', message = 'LABEL_BOX_BATCH_CLOSED';
  end if;

  -- Box tujuan: nomor terkecil yang belum penuh. Urutan set lalu box
  -- mencerminkan urutan pengepakan di lapangan.
  --
  -- skip locked, bukan menunggu: dua operator pada batch yang sama harus
  -- mengisi box berbeda. Dengan `for update` biasa, penunggu akan menguji
  -- ulang barisnya setelah lock lepas, mendapati box itu sudah verified,
  -- lalu pulang tangan kosong walau box lain masih kosong.
  select * into target_box
  from public.label_boxes box
  where box.batch_id = p_batch_id and box.status <> 'verified'
  order by box.set_no, box.box_no
  limit 1
  for update skip locked;

  if target_box.id is null then
    raise exception using errcode = 'P0001', message = 'NO_LABEL_BOX_AVAILABLE';
  end if;

  if target_box.packing_session_id is null then
    insert into public.packing_sessions (
      operator_id, master_item_id, box_id, delivery_number_id,
      qty_delivery, lot_no, status
    ) values (
      auth.uid(), target_batch.master_item_id, target_box.box_id,
      target_batch.delivery_number_id, target_batch.qty_delivery,
      target_batch.lot_no, 'scanning'
    )
    returning * into created_session;

    update public.label_boxes box
    set packing_session_id = created_session.id
    where box.id = target_box.id
    returning * into target_box;
  end if;

  select * into scan_row
  from public.accept_packing_scan(
    target_box.packing_session_id,
    p_label_uid,
    p_raw_payload_hash,
    p_scanned_size,
    p_normalized_size
  );

  if scan_row.session_status = 'ready_to_finalize' then
    update public.label_boxes box
    set status = 'verified'
    where box.id = target_box.id;
  end if;

  return query
  select
    scan_row.result,
    scan_row.error_code,
    target_box.id,
    target_box.box_number,
    (
      select box.status from public.label_boxes box where box.id = target_box.id
    ),
    scan_row.layer_accepted_qty,
    scan_row.layer_expected_qty,
    scan_row.total_accepted_qty,
    scan_row.total_expected_qty;
end;
$$;

revoke execute on function public.accept_label_box_scan(uuid, text, text, text, text)
  from public, anon;
grant execute on function public.accept_label_box_scan(uuid, text, text, text, text)
  to authenticated;
```

- [ ] **Step 2: Tambahkan `close_label_box_batch`**

```sql
create function public.close_label_box_batch(p_batch_id uuid)
returns table (
  batch_id uuid,
  closed_at timestamptz,
  verified_count integer,
  label_count integer
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  target_batch public.label_box_batches%rowtype;
  pending_box public.label_boxes%rowtype;
  created_session public.packing_sessions%rowtype;
  closed_stamp timestamptz := statement_timestamp();
begin
  if not private.is_active_operator() then
    raise exception using errcode = 'P0001', message = 'LABEL_BOX_OPERATOR_REQUIRED';
  end if;

  select * into target_batch
  from public.label_box_batches batch
  where batch.id = p_batch_id
  for update;

  if target_batch.id is null then
    raise exception using errcode = 'P0001', message = 'LABEL_BOX_BATCH_NOT_FOUND';
  end if;

  if target_batch.closed_at is not null then
    raise exception using errcode = 'P0001', message = 'LABEL_BOX_BATCH_ALREADY_CLOSED';
  end if;

  -- print_jobs.packing_session_id wajib terisi, sedangkan box yang tidak
  -- pernah discan belum punya sesi. Lengkapi di sini supaya semua label
  -- tetap bisa dicetak apa adanya.
  for pending_box in
    select * from public.label_boxes box
    where box.batch_id = p_batch_id and box.packing_session_id is null
    order by box.set_no, box.box_no
  loop
    insert into public.packing_sessions (
      operator_id, master_item_id, box_id, delivery_number_id,
      qty_delivery, lot_no, status
    ) values (
      auth.uid(), target_batch.master_item_id, pending_box.box_id,
      target_batch.delivery_number_id, target_batch.qty_delivery,
      target_batch.lot_no, 'scanning'
    )
    returning * into created_session;

    update public.label_boxes box
    set packing_session_id = created_session.id
    where box.id = pending_box.id;
  end loop;

  update public.label_box_batches batch
  set closed_at = closed_stamp, closed_by = auth.uid()
  where batch.id = p_batch_id;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    auth.uid(), 'label_box_batch.closed', 'label_box_batch', p_batch_id::text,
    jsonb_build_object(
      'verified_count', (
        select count(*) from public.label_boxes box
        where box.batch_id = p_batch_id and box.status = 'verified'
      ),
      'label_count', target_batch.label_count
    )
  );

  return query
  select
    p_batch_id,
    closed_stamp,
    (
      select count(*)::integer from public.label_boxes box
      where box.batch_id = p_batch_id and box.status = 'verified'
    ),
    target_batch.label_count;
end;
$$;

revoke execute on function public.close_label_box_batch(uuid) from public, anon;
grant execute on function public.close_label_box_batch(uuid) to authenticated;
```

- [ ] **Step 3: Tambahkan `create_label_box_print_jobs`**

```sql
create function public.create_label_box_print_jobs(p_batch_id uuid)
returns table (
  print_job_id uuid,
  label_box_id uuid,
  box_number text,
  label_reference text,
  qr_payload text,
  supplier_code text,
  part_no text,
  part_name text,
  qty integer,
  delivery_number text,
  delivery_date date,
  box_name text,
  lot_no text,
  qty_delivery integer,
  status public.print_job_status
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  target_batch public.label_box_batches%rowtype;
  target_item public.master_items%rowtype;
  pending_box record;
  new_sequence_no bigint;
  new_label_reference text;
begin
  if not private.is_active_operator() then
    raise exception using errcode = 'P0001', message = 'LABEL_BOX_OPERATOR_REQUIRED';
  end if;

  select * into target_batch
  from public.label_box_batches batch
  where batch.id = p_batch_id
  for update;

  if target_batch.id is null then
    raise exception using errcode = 'P0001', message = 'LABEL_BOX_BATCH_NOT_FOUND';
  end if;

  if target_batch.closed_at is null then
    raise exception using errcode = 'P0001', message = 'LABEL_BOX_BATCH_NOT_CLOSED';
  end if;

  select * into target_item
  from public.master_items item
  where item.id = target_batch.master_item_id;

  -- Idempoten: hanya box yang belum punya print job yang diproses, sehingga
  -- memanggil ulang tidak menggandakan label.
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
      delivery_date_snapshot, box_code_snapshot, box_name_snapshot,
      qty_delivery_snapshot, lot_no_snapshot, qr_generated_at_snapshot,
      qr_payload_snapshot, sequence_no, label_reference, template_version,
      zpl_payload, created_by
    )
    select
      pending_box.packing_session_id, 'pending', target_batch.supplier_code_snapshot,
      supplier.supplier_name, target_item.part_no, target_item.part_name,
      target_batch.packing_qty, target_batch.delivery_number_snapshot,
      target_batch.delivery_date_snapshot, pending_box.box_number,
      pending_box.box_name, target_batch.qty_delivery, target_batch.lot_no,
      target_batch.qr_generated_at, pending_box.qr_payload, new_sequence_no,
      new_label_reference, 'v3', 'PENDING_ZPL_GENERATION', auth.uid()
    from public.suppliers supplier
    where supplier.id = target_batch.supplier_id;
  end loop;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    auth.uid(), 'label_box_batch.print_jobs_created', 'label_box_batch',
    p_batch_id::text,
    jsonb_build_object('label_count', target_batch.label_count)
  );

  return query
  select
    job.id, box.id, box.box_number, job.label_reference, job.qr_payload_snapshot,
    job.supplier_code_snapshot, job.part_no_snapshot, job.part_name_snapshot,
    job.qty_snapshot, job.delivery_number_snapshot, job.delivery_date_snapshot,
    job.box_name_snapshot, job.lot_no_snapshot, job.qty_delivery_snapshot,
    job.status
  from public.label_boxes box
  join public.print_jobs job
    on job.packing_session_id = box.packing_session_id
    and job.parent_print_job_id is null
  where box.batch_id = p_batch_id
  order by box.set_no, box.box_no;
end;
$$;

revoke execute on function public.create_label_box_print_jobs(uuid) from public, anon;
grant execute on function public.create_label_box_print_jobs(uuid) to authenticated;

notify pgrst, 'reload schema';
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260729080000_label_box_verification.sql
git commit -m "feat: add label box scan, batch close, and print job RPCs"
```

- [ ] **Step 5: Terapkan migrasi**

```bash
export SUPABASE_ACCESS_TOKEN=$(grep '^SUPABASE_ACCESS_TOKEN=' .env.local | cut -d= -f2- | tr -d '\r\n"')
npx supabase db push
```

Diharapkan: `Applying migration 20260729080000_label_box_verification.sql...` lalu `Finished supabase db push.`

Kalau gagal, baca errornya, perbaiki file, laporkan perubahannya. Jangan ulangi buta.

- [ ] **Step 6: Pastikan suite lama masih hijau**

```bash
node scripts/run-pgtap.mjs supabase/tests/database/014_phase_5_packing_session_scan.test.sql
node scripts/run-pgtap.mjs supabase/tests/database/019_label_box_batch.test.sql
```

Diharapkan: `PASS` untuk keduanya.

---

### Task 3: pgTAP verifikasi

**Files:**
- Create: `supabase/tests/database/020_label_box_verification.test.sql`

- [ ] **Step 1: Tulis file test**

```sql
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;

select plan(12);

insert into auth.users (
  id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('91200000-0000-0000-0000-000000000001', 'authenticated', 'authenticated',
    'verify-operator@example.test', '{}'::jsonb, '{}'::jsonb, now(), now());

insert into public.profiles (id, display_name, role, is_active) values
  ('91200000-0000-0000-0000-000000000001', 'Verify Operator', 'operator', true);

insert into public.suppliers (id, supplier_code, supplier_name, is_active) values
  ('95200000-0000-0000-0000-000000000001', 'VF1SUP', 'Verify Supplier', true);

insert into public.master_items (
  id, item_code, part_no, part_name, unit, default_label_qty, supplier_id, is_active
) values (
  '96200000-0000-0000-0000-000000000001', 'verify-item', 'VERIFY-PART',
  'Verify Part', 'Pcs', 2, '95200000-0000-0000-0000-000000000001', true
);

insert into public.products (
  id, product_code, part_name, outer_diameter, inner_diameter, length, is_active
) values (
  '97200000-0000-0000-0000-000000000001', 'verify-product', 'Verify Product',
  6.3, 5.5, 205, true
);

insert into public.master_item_products (
  master_item_id, product_id, is_active
) values (
  '96200000-0000-0000-0000-000000000001',
  '97200000-0000-0000-0000-000000000001',
  true
);

insert into public.boxes (id, master_item_id, box_no, box_code, box_name) values
  ('98200000-0000-0000-0000-000000000001',
    '96200000-0000-0000-0000-000000000001', 1, 'verify-01', 'Box 1'),
  ('98200000-0000-0000-0000-000000000002',
    '96200000-0000-0000-0000-000000000001', 2, 'verify-02', 'Box 2');

insert into public.box_layers (id, box_id, layer_no, layer_name, sort_order) values
  ('99200000-0000-0000-0000-000000000001',
    '98200000-0000-0000-0000-000000000001', 1, 'Box 1 - Layer 1', 1),
  ('99200000-0000-0000-0000-000000000002',
    '98200000-0000-0000-0000-000000000002', 1, 'Box 2 - Layer 1', 1);

insert into public.box_layer_requirements (
  box_layer_id, product_id, expected_qty, sort_order
) values
  ('99200000-0000-0000-0000-000000000001',
    '97200000-0000-0000-0000-000000000001', 1, 1),
  ('99200000-0000-0000-0000-000000000002',
    '97200000-0000-0000-0000-000000000001', 1, 1);

select has_function(
  'public', 'accept_label_box_scan',
  array['uuid', 'text', 'text', 'text', 'text'],
  'accept_label_box_scan RPC ada'
);
select has_function(
  'public', 'close_label_box_batch', array['uuid'],
  'close_label_box_batch RPC ada'
);
select has_function(
  'public', 'create_label_box_print_jobs', array['uuid'],
  'create_label_box_print_jobs RPC ada'
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '91200000-0000-0000-0000-000000000001',
  true
);

-- Packing qty 2, qty delivery 2, dua box: satu set, dua label.
create temporary table verify_batch as
select *
from public.create_label_box_batch(
  '95200000-0000-0000-0000-000000000001',
  'DN-VERIFY-1',
  date '2026-07-29',
  '96200000-0000-0000-0000-000000000001',
  2,
  'LOT-VF-A'
);
grant select on verify_batch to public;

select is(
  (select label_count from verify_batch),
  2,
  'batch menghasilkan dua label box'
);

create temporary table verify_scan_a as
select *
from public.accept_label_box_scan(
  (select batch_id from verify_batch),
  'VERIFY-UID-1',
  'aa11',
  'D6.3X5.5 L=205',
  '6.3x5.5x205'
);
grant select on verify_scan_a to public;

select is(
  (select box_number from verify_scan_a),
  'B101',
  'scan pertama masuk ke box bernomor terkecil'
);

select is(
  (select label_box_status::text from verify_scan_a),
  'verified',
  'box penuh setelah layernya terpenuhi'
);

create temporary table verify_scan_b as
select *
from public.accept_label_box_scan(
  (select batch_id from verify_batch),
  'VERIFY-UID-2',
  'bb22',
  'D6.3X5.5 L=205',
  '6.3x5.5x205'
);
grant select on verify_scan_b to public;

select is(
  (select box_number from verify_scan_b),
  'B201',
  'scan berikutnya pindah sendiri ke box kedua'
);

select throws_ok(
  $$
    select public.accept_label_box_scan(
      (select batch_id from verify_batch),
      'VERIFY-UID-3', 'cc33', 'D6.3X5.5 L=205', '6.3x5.5x205'
    )
  $$,
  'P0001',
  'NO_LABEL_BOX_AVAILABLE',
  'scan ditolak ketika semua box sudah penuh'
);

create temporary table verify_close as
select * from public.close_label_box_batch((select batch_id from verify_batch));
grant select on verify_close to public;

select is(
  (select verified_count from verify_close),
  2,
  'menutup batch melaporkan dua box terverifikasi'
);

select throws_ok(
  $$
    select public.accept_label_box_scan(
      (select batch_id from verify_batch),
      'VERIFY-UID-4', 'dd44', 'D6.3X5.5 L=205', '6.3x5.5x205'
    )
  $$,
  'P0001',
  'LABEL_BOX_BATCH_CLOSED',
  'scan ditolak pada batch yang sudah ditutup'
);

select throws_ok(
  $$ select public.close_label_box_batch((select batch_id from verify_batch)) $$,
  'P0001',
  'LABEL_BOX_BATCH_ALREADY_CLOSED',
  'menutup dua kali ditolak'
);

create temporary table verify_jobs as
select * from public.create_label_box_print_jobs((select batch_id from verify_batch));
grant select on verify_jobs to public;

select is(
  (select count(*)::integer from verify_jobs),
  2,
  'satu print job dibuat per label box'
);

select is(
  (
    select string_agg(job.qr_payload, ',' order by job.box_number)
    from verify_jobs job
  ),
  (
    select string_agg(box.qr_payload, ',' order by box.box_number)
    from public.label_boxes box
    where box.batch_id = (select batch_id from verify_batch)
  ),
  'print job membawa QR payload label box apa adanya'
);

select is(
  (
    select count(*)::integer
    from public.create_label_box_print_jobs((select batch_id from verify_batch))
  ),
  2,
  'memanggil ulang tidak menggandakan print job'
);

reset role;

select * from finish();

rollback;
```

- [ ] **Step 2: Jalankan test**

```bash
export SUPABASE_ACCESS_TOKEN=$(grep '^SUPABASE_ACCESS_TOKEN=' .env.local | cut -d= -f2- | tr -d '\r\n"')
node scripts/run-pgtap.mjs supabase/tests/database/020_label_box_verification.test.sql
```

Diharapkan: `PASS  supabase/tests/database/020_label_box_verification.test.sql`, exit code 0.

Kalau ada assertion gagal, tentukan jujur apakah TEST-nya yang salah atau RPC-nya. Kalau RPC yang salah, laporkan sebagai temuan dan berhenti — jangan melemahkan assertion agar hijau.

- [ ] **Step 3: Commit**

```bash
git add supabase/tests/database/020_label_box_verification.test.sql
git commit -m "test: cover label box scanning, batch close, and print job creation"
```

---

### Task 4: Tipe Supabase

**Files:**
- Modify: `src/types/database.ts`

- [ ] **Step 1: Tambahkan kolom baru**

Di blok `label_box_batches`, tambahkan ke `Row` (dan versi opsionalnya ke `Insert`/`Update`), jaga urutan alfabetis:

```ts
          closed_at: string | null
          closed_by: string | null
```

Di blok `label_boxes`:

```ts
          packing_session_id: string | null
```

Di blok `print_jobs`:

```ts
          qr_payload_snapshot: string | null
```

- [ ] **Step 2: Tambahkan tipe tiga fungsi**

Di dalam `Functions`, urut alfabetis:

```ts
      accept_label_box_scan: {
        Args: {
          p_batch_id: string
          p_label_uid: string
          p_normalized_size: string
          p_raw_payload_hash: string
          p_scanned_size: string
        }
        Returns: {
          box_number: string
          error_code: string
          label_box_id: string
          label_box_status: Database["public"]["Enums"]["label_box_status"]
          layer_accepted_qty: number
          layer_expected_qty: number
          result: Database["public"]["Enums"]["scan_result"]
          total_accepted_qty: number
          total_expected_qty: number
        }[]
      }
      close_label_box_batch: {
        Args: { p_batch_id: string }
        Returns: {
          batch_id: string
          closed_at: string
          label_count: number
          verified_count: number
        }[]
      }
      create_label_box_print_jobs: {
        Args: { p_batch_id: string }
        Returns: {
          box_name: string
          box_number: string
          delivery_date: string
          delivery_number: string
          label_box_id: string
          label_reference: string
          lot_no: string
          part_name: string
          part_no: string
          print_job_id: string
          qr_payload: string
          qty: number
          qty_delivery: number
          status: Database["public"]["Enums"]["print_job_status"]
          supplier_code: string
        }[]
      }
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Diharapkan: tidak ada error.

- [ ] **Step 4: Commit**

```bash
git add src/types/database.ts
git commit -m "chore: add Supabase types for label box verification RPCs"
```

---

### Task 5: Formatter menerima QR payload jadi

Label cetak berhenti merakit QR sendiri; ia memakai payload yang sudah disimpan `label_boxes.qr_payload`.

**Files:**
- Modify: `src/lib/label/formatter.ts`
- Test: `src/lib/label/formatter.test.ts`

- [ ] **Step 1: Tulis test yang gagal**

Di `src/lib/label/formatter.test.ts`, ganti `qrGeneratedAt` pada `baseSnapshot` menjadi `qrPayload`:

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
  qrPayload: "10015|PN-0001|100|1|LOT-A|B101|24-07-2026",
}
```

Ganti seluruh blok `describe`-level test QR lama dengan:

```ts
  it("passes the stored QR payload through untouched", () => {
    expect(formatLabelFields(baseSnapshot).qrPayload).toBe(
      "10015|PN-0001|100|1|LOT-A|B101|24-07-2026",
    )
  })
```

Perbarui ekspektasi "maps a normal snapshot to display-ready fields" agar `qrPayload` bernilai string di atas. Hapus tiga test lama yang menguji perakitan QR dari `qrGeneratedAt` (`builds the QR payload as five pipe-separated fields`, `formats the QR date as DD-MM-YYYY from a full timestamp`, `throws when qrGeneratedAt is not a parseable ISO timestamp`) — perilaku itu memang dihapus.

Blok `describe("formatShortDate", ...)` tetap apa adanya; fungsi itu masih dipakai tabel batch.

- [ ] **Step 2: Jalankan test untuk memastikan gagal**

Run: `npx vitest run src/lib/label/formatter.test.ts`
Diharapkan: FAIL — `qrPayload` belum ada di `FinalizedLabelSnapshot`.

- [ ] **Step 3: Implementasi**

Di `src/lib/label/formatter.ts`, ganti field `qrGeneratedAt` pada `FinalizedLabelSnapshot`:

```ts
  /** QR payload yang sudah dirakit dan disimpan di label_boxes.qr_payload. */
  qrPayload: string
```

Hapus fungsi `buildQrPayload` seluruhnya, lalu ubah `formatLabelFields`:

```ts
    qrPayload: snapshot.qrPayload,
```

Pertahankan `formatShortDate` dan `formatDeliveryDate` apa adanya.

- [ ] **Step 4: Jalankan test untuk memastikan lulus**

Run: `npx vitest run src/lib/label/formatter.test.ts`
Diharapkan: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/label/formatter.ts src/lib/label/formatter.test.ts
git commit -m "refactor: take the label QR payload from storage instead of rebuilding it"
```

---

### Task 6: ZPL v3

**Files:**
- Modify: `src/lib/label/zpl.ts`
- Test: `src/lib/label/zpl.test.ts`
- Regenerate: `src/lib/label/__snapshots__/zpl.test.ts.snap`

- [ ] **Step 1: Tulis test yang gagal**

Di `src/lib/label/zpl.test.ts`, ubah assertion versi template:

```ts
  it("exports template version v3 and 203dpi 55x75mm dot dimensions", () => {
    expect(TEMPLATE_VERSION).toBe("v3")
    expect(LABEL_WIDTH_DOTS).toBe(440)
    expect(LABEL_LENGTH_DOTS).toBe(600)
  })
```

Ubah `qrPayload` pada `sampleFields` menjadi payload tujuh field:

```ts
  qrPayload: "10015|3210A-K1Z-NA01-DL|100|1|LOT-A|B101|29-07-2026",
```

Perbarui assertion isi QR:

```ts
  it("emits a QR block with the payload after the text rows", () => {
    expect(zpl).toContain("^BQN,2,5")
    expect(zpl).toContain(
      "^FDMA,10015|3210A-K1Z-NA01-DL|100|1|LOT-A|B101|29-07-2026^FS",
    )
  })
```

- [ ] **Step 2: Jalankan test untuk memastikan gagal**

Run: `npx vitest run src/lib/label/zpl.test.ts`
Diharapkan: FAIL — `TEMPLATE_VERSION` masih `"v2"`.

- [ ] **Step 3: Implementasi**

Di `src/lib/label/zpl.ts`, ubah komentar blok dan konstanta versi:

```ts
/**
 * ZPL template v3 for Zebra ZD220 (203 dpi), media 55 mm x 75 mm with 3 mm
 * gap, thermal-transfer wax ribbon. Layout locked by
 * docs/superpowers/specs/2026-07-24-scan-page-consolidated-form-design.md.
 *
 * v3 keeps the v2 layout exactly. Only the QR content changed: the payload
 * now arrives already assembled from label_boxes.qr_payload (seven fields)
 * instead of being rebuilt from the print job snapshot (five fields).
 */
export const TEMPLATE_VERSION = "v3"
```

Isi `buildLabelZpl` tidak berubah.

- [ ] **Step 4: Perbarui snapshot emas**

Run: `npx vitest run src/lib/label/zpl.test.ts -u`

Lalu buka `src/lib/label/__snapshots__/zpl.test.ts.snap` dan pastikan baris QR-nya berbunyi:

```
^FO137,392^BQN,2,5^FH^FDMA,10015|3210A-K1Z-NA01-DL|100|1|LOT-A|B101|29-07-2026^FS
```

Tujuh baris teks di atasnya harus sama persis dengan sebelumnya. Kalau ada yang bergeser, tata letaknya tidak sengaja berubah — perbaiki, jangan terima snapshotnya.

- [ ] **Step 5: Jalankan test untuk memastikan lulus**

Run: `npx vitest run src/lib/label/`
Diharapkan: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/label/zpl.ts src/lib/label/zpl.test.ts src/lib/label/__snapshots__/zpl.test.ts.snap
git commit -m "feat: bump the label template to v3 with the stored QR payload"
```

---

### Task 7: State dan action verifikasi

**Files:**
- Create: `src/features/label-boxes/verification-form-state.ts`
- Create: `src/features/label-boxes/verification-actions.ts`

- [ ] **Step 1: Buat `src/features/label-boxes/verification-form-state.ts`**

```ts
export type LabelBoxScanResult = {
  boxNumber: string
  labelBoxId: string
  labelBoxStatus: "generated" | "verified"
  layerAcceptedQty: number
  layerExpectedQty: number
  message: string
  status: "duplicate" | "error" | "success"
  totalAcceptedQty: number
  totalExpectedQty: number
}

export type LabelBoxScanInput = {
  batchId: string
  rawPayload: string
}

export type CloseLabelBoxBatchActionState = {
  error?: string
  success?: string
}

export const initialCloseLabelBoxBatchActionState: CloseLabelBoxBatchActionState =
  {}

export type LabelBoxPrintJob = {
  boxName: string
  boxNumber: string
  deliveryDate: string
  deliveryNumber: string
  labelReference: string
  lotNo: string
  partName: string
  partNo: string
  printJobId: string
  qrPayload: string
  qty: number
  qtyDelivery: number
  status: string
  supplierCode: string
}

export type LabelBoxPrintJobsActionState = {
  error?: string
  jobs?: LabelBoxPrintJob[]
  success?: string
}

export const initialLabelBoxPrintJobsActionState: LabelBoxPrintJobsActionState =
  {}
```

- [ ] **Step 2: Buat `src/features/label-boxes/verification-actions.ts`**

```ts
"use server"

import { createHash } from "node:crypto"

import { revalidatePath } from "next/cache"

import { parseBarcodeV1 } from "@/lib/barcode/parser"
import {
  type CloseLabelBoxBatchActionState,
  type LabelBoxPrintJobsActionState,
  type LabelBoxScanInput,
  type LabelBoxScanResult,
} from "@/features/label-boxes/verification-form-state"
import { createClient } from "@/lib/supabase/server"

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const safeRpcMessages: Record<string, string> = {
  BARCODE_PARSE_FAILED: "Format QR tidak valid.",
  BARCODE_PAYLOAD_TOO_LONG: "Payload QR melebihi batas yang diizinkan.",
  BARCODE_UNSUPPORTED_ENVELOPE: "Format QR belum didukung.",
  BARCODE_UNSUPPORTED_VERSION: "Versi QR belum didukung.",
  LABEL_ALREADY_SCANNED: "Label ini sudah pernah diterima.",
  LABEL_BOX_BATCH_ALREADY_CLOSED: "Batch ini sudah ditutup sebelumnya.",
  LABEL_BOX_BATCH_CLOSED: "Batch sudah ditutup, scan tidak diterima lagi.",
  LABEL_BOX_BATCH_NOT_CLOSED:
    "Tutup verifikasi batch ini dulu sebelum mencetak.",
  LABEL_BOX_BATCH_NOT_FOUND: "Batch label box tidak ditemukan.",
  LABEL_BOX_OPERATOR_REQUIRED: "Aksi ini hanya untuk operator aktif.",
  LABEL_UID_MISSING: "QR tidak memiliki Label UID unik.",
  LAYER_QUANTITY_FULL: "Kebutuhan layer untuk produk ini sudah penuh.",
  NO_LABEL_BOX_AVAILABLE: "Semua label box pada batch ini sudah penuh.",
  PRODUCT_NOT_ALLOWED_FOR_PART: "Produk tidak diizinkan untuk Master Item ini.",
  PRODUCT_NOT_REQUIRED_IN_BOX: "Produk tidak diperlukan oleh Box aktif.",
  PRODUCT_SIZE_NOT_FOUND: "Ukuran produk dari QR tidak ditemukan.",
}

function rpcErrorMessage(code: string): string {
  return (
    safeRpcMessages[code] ?? "Aksi gagal. Coba lagi atau hubungi admin."
  )
}

function productDimensionsLookup(size: {
  dimension1: number
  dimension2: number
  length: number
}): string {
  return `${size.dimension1}x${size.dimension2}x${size.length}`
}

export async function acceptLabelBoxScanAction(
  input: LabelBoxScanInput,
): Promise<LabelBoxScanResult | { message: string; status: "error" }> {
  if (!uuidPattern.test(input.batchId)) {
    return { message: "Batch tidak valid.", status: "error" }
  }

  const parsed = parseBarcodeV1(input.rawPayload)
  if (!parsed.ok) {
    return { message: rpcErrorMessage(parsed.code), status: "error" }
  }

  if (!parsed.data.labelUid) {
    return { message: rpcErrorMessage("LABEL_UID_MISSING"), status: "error" }
  }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc("accept_label_box_scan", {
    p_batch_id: input.batchId,
    p_label_uid: parsed.data.labelUid,
    p_normalized_size: productDimensionsLookup(parsed.data.size),
    p_raw_payload_hash: createHash("sha256")
      .update(input.rawPayload)
      .digest("hex"),
    p_scanned_size: parsed.data.sizeNormalized,
  })

  if (error || !data?.[0]) {
    return { message: rpcErrorMessage(error?.message ?? ""), status: "error" }
  }

  const row = data[0]
  const status =
    row.result === "accepted"
      ? ("success" as const)
      : row.error_code === "LABEL_ALREADY_SCANNED"
        ? ("duplicate" as const)
        : ("error" as const)

  if (status === "success") revalidatePath(`/scan/${input.batchId}/verifikasi`)

  return {
    boxNumber: row.box_number,
    labelBoxId: row.label_box_id,
    labelBoxStatus: row.label_box_status,
    layerAcceptedQty: row.layer_accepted_qty,
    layerExpectedQty: row.layer_expected_qty,
    message:
      status === "success"
        ? `Scan diterima untuk ${row.box_number}.`
        : rpcErrorMessage(row.error_code ?? ""),
    status,
    totalAcceptedQty: row.total_accepted_qty,
    totalExpectedQty: row.total_expected_qty,
  }
}

export async function closeLabelBoxBatchAction(
  _previousState: CloseLabelBoxBatchActionState,
  formData: FormData,
): Promise<CloseLabelBoxBatchActionState> {
  const batchId = String(formData.get("batchId") ?? "").trim()

  if (!uuidPattern.test(batchId)) {
    return { error: "Batch tidak valid." }
  }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc("close_label_box_batch", {
    p_batch_id: batchId,
  })

  if (error || !data?.[0]) {
    return { error: rpcErrorMessage(error?.message ?? "") }
  }

  revalidatePath("/scan")
  return {
    success: `Verifikasi ditutup. ${data[0].verified_count} dari ${data[0].label_count} box terverifikasi.`,
  }
}

export async function createLabelBoxPrintJobsAction(
  _previousState: LabelBoxPrintJobsActionState,
  formData: FormData,
): Promise<LabelBoxPrintJobsActionState> {
  const batchId = String(formData.get("batchId") ?? "").trim()

  if (!uuidPattern.test(batchId)) {
    return { error: "Batch tidak valid." }
  }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc("create_label_box_print_jobs", {
    p_batch_id: batchId,
  })

  if (error || !data) {
    return { error: rpcErrorMessage(error?.message ?? "") }
  }

  revalidatePath("/scan")
  return {
    jobs: data.map((row) => ({
      boxName: row.box_name,
      boxNumber: row.box_number,
      deliveryDate: row.delivery_date,
      deliveryNumber: row.delivery_number,
      labelReference: row.label_reference,
      lotNo: row.lot_no,
      partName: row.part_name,
      partNo: row.part_no,
      printJobId: row.print_job_id,
      qrPayload: row.qr_payload,
      qty: row.qty,
      qtyDelivery: row.qty_delivery,
      status: row.status,
      supplierCode: row.supplier_code,
    })),
    success: `${data.length} label siap dicetak.`,
  }
}
```

- [ ] **Step 3: Typecheck dan lint**

Run: `npx tsc --noEmit -p tsconfig.json`
Diharapkan: tidak ada error.

Run: `npx eslint src/features/label-boxes --max-warnings=0`
Diharapkan: tidak ada output.

- [ ] **Step 4: Commit**

```bash
git add src/features/label-boxes/verification-form-state.ts src/features/label-boxes/verification-actions.ts
git commit -m "feat: add label box scan, close, and print job actions"
```

---

### Task 8: Layar verifikasi

**Files:**
- Create: `src/features/label-boxes/components/label-box-verification-console.tsx`

- [ ] **Step 1: Buat komponennya**

```tsx
"use client"

import { useActionState, useCallback, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import {
  ArrowLeftIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  PackageCheckIcon,
  ScanLineIcon,
  Volume2Icon,
  VolumeOffIcon,
} from "lucide-react"
import Link from "next/link"

import { acceptLabelBoxScanAction, closeLabelBoxBatchAction } from "@/features/label-boxes/verification-actions"
import { initialCloseLabelBoxBatchActionState } from "@/features/label-boxes/verification-form-state"
import { useScannerListener } from "@/features/scan/use-scanner-listener"
import { useActionStateToast } from "@/components/shared/action-state-toast"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { Spinner } from "@/components/ui/spinner"

export type VerificationLabelBox = {
  acceptedQty: number
  boxNumber: string
  expectedQty: number
  id: string
  verified: boolean
}

export type VerificationBatchView = {
  deliveryDate: string
  deliveryNumber: string
  id: string
  itemCode: string
  labelBoxes: VerificationLabelBox[]
  lotNo: string
  qtyDelivery: number
  supplierCode: string
}

function percentage(acceptedQty: number, expectedQty: number): number {
  if (expectedQty <= 0) return 0
  return Math.min(100, Math.round((acceptedQty / expectedQty) * 100))
}

function playScanTone(
  status: "duplicate" | "error" | "success",
  muted: boolean,
) {
  if (muted || typeof window === "undefined") return

  try {
    const context = new AudioContext()
    const oscillator = context.createOscillator()
    const gain = context.createGain()
    oscillator.type = "sine"
    oscillator.frequency.value = status === "success" ? 880 : 220
    gain.gain.setValueAtTime(0.06, context.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.12)
    oscillator.connect(gain).connect(context.destination)
    oscillator.start()
    oscillator.stop(context.currentTime + 0.12)
    oscillator.addEventListener("ended", () => void context.close())
  } catch {
    // Sebagian browser menahan audio sebelum ada gestur pengguna. Tampilan
    // visualnya tetap memberi tahu hasil scan.
  }
}

export function LabelBoxVerificationConsole({
  batch,
}: {
  batch: VerificationBatchView
}) {
  const router = useRouter()
  const [closeState, closeAction, closePending] = useActionState(
    closeLabelBoxBatchAction,
    initialCloseLabelBoxBatchActionState,
  )
  useActionStateToast(closeState)

  const [muted, setMuted] = useState(false)
  const playedScanAt = useRef<number | null>(null)
  const closed = useRef(false)

  const onScan = useCallback(
    async (rawPayload: string) => {
      const result = await acceptLabelBoxScanAction({
        batchId: batch.id,
        rawPayload,
      })
      if (result.status === "success") router.refresh()
      return { message: result.message, status: result.status }
    },
    [batch.id, router],
  )

  const scanner = useScannerListener({ enabled: true, onScan })

  useEffect(() => {
    const scan = scanner.lastScan
    if (!scan || playedScanAt.current === scan.scannedAt.getTime()) return

    playedScanAt.current = scan.scannedAt.getTime()
    playScanTone(scan.status, muted)

    // Scan ditolak tidak boleh tergeser scan berikutnya: tahan sampai
    // operator menutupnya sendiri.
    if (scan.status === "error") {
      toast.error(scan.message, { closeButton: true, duration: Infinity })
    }
  }, [muted, scanner.lastScan])

  useEffect(() => {
    if (!closeState.success || closed.current) return
    closed.current = true
    router.push("/scan")
  }, [closeState.success, router])

  const acceptedTotal = batch.labelBoxes.reduce(
    (total, labelBox) => total + labelBox.acceptedQty,
    0,
  )
  const expectedTotal = batch.labelBoxes.reduce(
    (total, labelBox) => total + labelBox.expectedQty,
    0,
  )
  const activeBox = batch.labelBoxes.find((labelBox) => !labelBox.verified)

  return (
    <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="grid gap-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <Button asChild className="mb-2 px-0" variant="link">
              <Link href="/scan">
                <ArrowLeftIcon data-icon="inline-start" />
                Daftar label box
              </Link>
            </Button>
            <h1 className="text-2xl font-semibold">{batch.deliveryNumber}</h1>
            <p className="text-muted-foreground text-sm">
              {batch.supplierCode} · {batch.itemCode} · Lot {batch.lotNo} · Qty{" "}
              {batch.qtyDelivery}
            </p>
          </div>
          <Button
            aria-label={muted ? "Nyalakan bunyi scan" : "Matikan bunyi scan"}
            onClick={() => setMuted(!muted)}
            size="icon"
            type="button"
            variant="outline"
          >
            {muted ? <VolumeOffIcon /> : <Volume2Icon />}
          </Button>
        </div>

        <div className="rounded-xl border p-5">
          <div className="mb-3 flex items-end justify-between gap-4">
            <div>
              <p className="text-muted-foreground text-sm">Total progress</p>
              <p className="text-3xl font-semibold tabular-nums">
                {acceptedTotal} / {expectedTotal}
              </p>
            </div>
            <span className="text-muted-foreground text-sm">
              {percentage(acceptedTotal, expectedTotal)}%
            </span>
          </div>
          <Progress value={percentage(acceptedTotal, expectedTotal)} />
        </div>

        <Alert
          className="items-center gap-x-4 px-5 py-4"
          variant={
            scanner.lastScan?.status === "error" ||
            scanner.lastScan?.status === "duplicate"
              ? "destructive"
              : "default"
          }
        >
          {scanner.lastScan?.status === "success" ? (
            <CircleCheckIcon className="size-7" />
          ) : (
            <ScanLineIcon className="size-7" />
          )}
          <AlertTitle className="text-xl font-semibold sm:text-2xl">
            {scanner.pending
              ? "Memproses scan…"
              : scanner.lastScan?.status === "success"
                ? "Scan diterima"
                : scanner.lastScan?.status === "duplicate"
                  ? "Label duplikat"
                  : scanner.lastScan?.status === "error"
                    ? "Scan ditolak"
                    : "Scanner siap"}
          </AlertTitle>
          <AlertDescription className="text-sm sm:text-base">
            {scanner.lastScan?.message ??
              (activeBox
                ? `Box aktif ${activeBox.boxNumber}. Arahkan fokus ke halaman ini lalu scan produk.`
                : "Semua box sudah penuh. Tutup verifikasi untuk lanjut mencetak.")}
          </AlertDescription>
        </Alert>

        <div className="grid gap-3 sm:grid-cols-2">
          {batch.labelBoxes.map((labelBox) => (
            <div className="rounded-xl border p-4" key={labelBox.id}>
              <div className="mb-2 flex items-center justify-between gap-3">
                <p className="font-mono font-medium">{labelBox.boxNumber}</p>
                {labelBox.verified ? (
                  <Badge variant="secondary">
                    <CircleCheckIcon data-icon="inline-start" />
                    Penuh
                  </Badge>
                ) : labelBox.id === activeBox?.id ? (
                  <Badge>Aktif</Badge>
                ) : (
                  <span className="text-muted-foreground text-sm tabular-nums">
                    {labelBox.acceptedQty} / {labelBox.expectedQty}
                  </span>
                )}
              </div>
              <Progress
                value={percentage(labelBox.acceptedQty, labelBox.expectedQty)}
              />
            </div>
          ))}
        </div>

        <form action={closeAction} className="rounded-xl border p-5" noValidate>
          <input name="batchId" type="hidden" value={batch.id} />
          <div className="mb-3 flex items-center gap-2">
            <PackageCheckIcon className="size-5" />
            <h2 className="font-semibold">Selesaikan verifikasi</h2>
          </div>
          <p className="text-muted-foreground mb-4 text-sm">
            Batch yang ditutup tidak menerima scan lagi. Seluruh label kemudian
            dapat dicetak, termasuk box yang belum penuh.
          </p>
          {closeState.error ? (
            <Alert className="mb-4" variant="destructive">
              <CircleAlertIcon />
              <AlertDescription>{closeState.error}</AlertDescription>
            </Alert>
          ) : null}
          <Button disabled={closePending} type="submit">
            {closePending ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <PackageCheckIcon data-icon="inline-start" />
            )}
            Selesaikan verifikasi
          </Button>
        </form>
      </div>

      <aside className="rounded-xl border p-5">
        <h2 className="mb-3 font-semibold">Scan terakhir</h2>
        <div className="grid gap-2">
          {scanner.recentScans.length > 0 ? (
            scanner.recentScans.map((scan) => (
              <div
                className="bg-muted/50 flex items-start justify-between gap-3 rounded-lg p-3"
                key={`${scan.scannedAt.toISOString()}-${scan.rawPayload}`}
              >
                <div>
                  <p className="text-sm font-medium">
                    {scan.status === "success"
                      ? "Diterima"
                      : scan.status === "duplicate"
                        ? "Duplikat"
                        : "Ditolak"}
                  </p>
                  <p className="text-muted-foreground text-xs">{scan.message}</p>
                </div>
              </div>
            ))
          ) : (
            <p className="text-muted-foreground text-sm">
              Belum ada scan pada batch ini.
            </p>
          )}
        </div>
      </aside>
    </section>
  )
}
```

- [ ] **Step 2: Typecheck dan lint**

Run: `npx tsc --noEmit -p tsconfig.json`
Diharapkan: tidak ada error.

Run: `npx eslint src/features/label-boxes --max-warnings=0`
Diharapkan: tidak ada output.

- [ ] **Step 3: Commit**

```bash
git add src/features/label-boxes/components/label-box-verification-console.tsx
git commit -m "feat: add the label box verification console"
```

---

### Task 9: Rute verifikasi

**Files:**
- Create: `src/app/(operator)/scan/[batchId]/verifikasi/page.tsx`

- [ ] **Step 1: Buat halamannya**

```tsx
import { notFound } from "next/navigation"

import {
  LabelBoxVerificationConsole,
  type VerificationLabelBox,
} from "@/features/label-boxes/components/label-box-verification-console"
import { requireOperator } from "@/features/auth/server"
import { createClient } from "@/lib/supabase/server"

export default async function LabelBoxVerificationPage({
  params,
}: {
  params: Promise<{ batchId: string }>
}) {
  await requireOperator()
  const { batchId } = await params
  const supabase = await createClient()

  const { data: batch, error } = await supabase
    .from("label_box_batches")
    .select(
      "id, lot_no, qty_delivery, closed_at, supplier_code_snapshot, item_code_snapshot, delivery_number_snapshot, delivery_date_snapshot, label_boxes(id, box_id, box_number, set_no, box_no, status, packing_session_id)",
    )
    .eq("id", batchId)
    .maybeSingle()

  if (error || !batch || batch.closed_at !== null) {
    notFound()
  }

  const sessionIds = batch.label_boxes
    .map((labelBox) => labelBox.packing_session_id)
    .filter((sessionId): sessionId is string => sessionId !== null)

  const { data: scanRows } = sessionIds.length
    ? await supabase
        .from("packing_session_scans")
        .select("packing_session_id, result")
        .in("packing_session_id", sessionIds)
        .eq("result", "accepted")
    : { data: [] }

  const { data: requirementRows } = await supabase
    .from("box_layers")
    .select("box_id, box_layer_requirements(expected_qty)")

  function expectedQtyForBox(boxId: string): number {
    return (requirementRows ?? [])
      .filter((layer) => layer.box_id === boxId)
      .reduce(
        (total, layer) =>
          total +
          layer.box_layer_requirements.reduce(
            (layerTotal, requirement) => layerTotal + requirement.expected_qty,
            0,
          ),
        0,
      )
  }

  const labelBoxes: VerificationLabelBox[] = [...batch.label_boxes]
    .sort((left, right) =>
      left.set_no === right.set_no
        ? left.box_no - right.box_no
        : left.set_no - right.set_no,
    )
    .map((labelBox) => ({
      acceptedQty: (scanRows ?? []).filter(
        (scan) => scan.packing_session_id === labelBox.packing_session_id,
      ).length,
      boxNumber: labelBox.box_number,
      expectedQty: expectedQtyForBox(labelBox.box_id),
      id: labelBox.id,
      verified: labelBox.status === "verified",
    }))

  return (
    <LabelBoxVerificationConsole
      batch={{
        deliveryDate: batch.delivery_date_snapshot,
        deliveryNumber: batch.delivery_number_snapshot,
        id: batch.id,
        itemCode: batch.item_code_snapshot,
        labelBoxes,
        lotNo: batch.lot_no,
        qtyDelivery: batch.qty_delivery,
        supplierCode: batch.supplier_code_snapshot,
      }}
    />
  )
}
```

- [ ] **Step 2: Typecheck, lint, build**

Run: `npx tsc --noEmit -p tsconfig.json`
Diharapkan: tidak ada error.

Run: `npx eslint "src/app/(operator)/scan" src/features/label-boxes --max-warnings=0`
Diharapkan: tidak ada output.

Run: `npx next build`
Diharapkan: build sukses, rute `/scan/[batchId]/verifikasi` muncul di daftar.

- [ ] **Step 3: Commit**

```bash
git add "src/app/(operator)/scan/[batchId]/verifikasi/page.tsx"
git commit -m "feat: add the label box verification route"
```

---

### Task 10: Kartu cetak batch

**Files:**
- Create: `src/features/label-boxes/components/label-box-batch-print-card.tsx`

- [ ] **Step 1: Buat komponennya**

```tsx
"use client"

import { useActionState, useCallback, useRef, useState } from "react"
import { CircleAlertIcon, CircleCheckIcon, PrinterIcon } from "lucide-react"

import {
  claimPrintJobAction,
  completePrintJobAction,
} from "@/features/print/actions"
import { PrinterPicker } from "@/features/print/components/printer-picker"
import {
  setPreferredPrinter,
  usePreferredPrinter,
} from "@/features/print/components/use-preferred-printer"
import { resolvePrinter } from "@/features/print/printer-preference"
import { sendZpl } from "@/features/print/qz-client"
import { useQzConnection } from "@/features/print/use-qz-connection"
import { createLabelBoxPrintJobsAction } from "@/features/label-boxes/verification-actions"
import { initialLabelBoxPrintJobsActionState } from "@/features/label-boxes/verification-form-state"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { formatLabelFields } from "@/lib/label/formatter"
import { buildLabelZpl } from "@/lib/label/zpl"

export function LabelBoxBatchPrintCard({ batchId }: { batchId: string }) {
  const { printers, status } = useQzConnection()
  const selectedPrinter = usePreferredPrinter()
  const [jobsState, jobsAction, jobsPending] = useActionState(
    createLabelBoxPrintJobsAction,
    initialLabelBoxPrintJobsActionState,
  )
  const [printedCount, setPrintedCount] = useState(0)
  const [printError, setPrintError] = useState<string | null>(null)
  const [printing, setPrinting] = useState(false)
  const inFlight = useRef(false)

  const activePrinter = resolvePrinter(selectedPrinter, printers)
  const jobs = jobsState.jobs ?? []

  const runPrint = useCallback(async () => {
    if (inFlight.current || !activePrinter || jobs.length === 0) return
    inFlight.current = true
    setPrinting(true)
    setPrintError(null)
    setPrintedCount(0)

    try {
      // Cetak berurutan, bukan paralel: satu printer, dan urutan label harus
      // sama dengan urutan nomor box supaya operator menempelnya runtut.
      for (const job of jobs) {
        const zpl = buildLabelZpl(
          formatLabelFields({
            supplierCode: job.supplierCode,
            partNo: job.partNo,
            partName: job.partName,
            qty: job.qty,
            sequenceNo: 0,
            labelReference: job.labelReference,
            deliveryNumber: job.deliveryNumber,
            deliveryDate: job.deliveryDate,
            boxCode: job.boxNumber,
            boxName: job.boxName,
            qrPayload: job.qrPayload,
          }),
        )

        const claim = await claimPrintJobAction({
          printJobId: job.printJobId,
          zplPayload: zpl,
        })
        if (claim.error) {
          setPrintError(claim.error)
          return
        }

        try {
          await sendZpl(activePrinter, zpl)
        } catch {
          await completePrintJobAction({
            errorCode: "QZ_SEND_FAILED",
            errorMessage: "Gagal mengirim ke printer.",
            printJobId: job.printJobId,
            printerName: activePrinter,
            result: "failed",
          }).catch(() => undefined)
          setPrintError(`Gagal mengirim ${job.boxNumber} ke printer.`)
          return
        }

        const complete = await completePrintJobAction({
          printJobId: job.printJobId,
          printerName: activePrinter,
          result: "sent",
        })
        if (complete.error) {
          setPrintError(complete.error)
          return
        }

        setPrintedCount((count) => count + 1)
      }
    } finally {
      inFlight.current = false
      setPrinting(false)
    }
  }, [activePrinter, jobs])

  return (
    <div className="grid gap-4 rounded-xl border p-5">
      <div className="flex items-center gap-2">
        <PrinterIcon className="size-5" />
        <h2 className="font-semibold">Cetak label batch</h2>
      </div>

      {status !== "connected" ? (
        <Alert variant="destructive">
          <CircleAlertIcon />
          <AlertTitle>QZ Tray tidak terhubung</AlertTitle>
          <AlertDescription>
            Pastikan aplikasi QZ Tray berjalan. Koneksi dicoba ulang otomatis.
          </AlertDescription>
        </Alert>
      ) : null}

      <PrinterPicker
        onSelect={setPreferredPrinter}
        printers={printers}
        selected={selectedPrinter}
      />

      {jobsState.error ? (
        <Alert variant="destructive">
          <CircleAlertIcon />
          <AlertDescription>{jobsState.error}</AlertDescription>
        </Alert>
      ) : null}

      {printError ? (
        <Alert variant="destructive">
          <CircleAlertIcon />
          <AlertTitle>Cetak gagal</AlertTitle>
          <AlertDescription>{printError}</AlertDescription>
        </Alert>
      ) : null}

      {jobs.length > 0 && printedCount === jobs.length ? (
        <Alert>
          <CircleCheckIcon />
          <AlertTitle>Semua label tercetak</AlertTitle>
          <AlertDescription>
            {printedCount} label terkirim ke {activePrinter}.
          </AlertDescription>
        </Alert>
      ) : null}

      {jobs.length === 0 ? (
        <form action={jobsAction} noValidate>
          <input name="batchId" type="hidden" value={batchId} />
          <Button disabled={jobsPending} type="submit">
            {jobsPending ? <Spinner data-icon="inline-start" /> : null}
            Siapkan label
          </Button>
        </form>
      ) : (
        <Button
          disabled={printing || status !== "connected" || !activePrinter}
          onClick={() => void runPrint()}
          type="button"
        >
          {printing ? (
            <Spinner data-icon="inline-start" />
          ) : (
            <PrinterIcon data-icon="inline-start" />
          )}
          {printing
            ? `Mencetak ${printedCount + 1} dari ${jobs.length}…`
            : `Cetak ${jobs.length} label`}
        </Button>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Typecheck dan lint**

Run: `npx tsc --noEmit -p tsconfig.json`
Diharapkan: tidak ada error.

Run: `npx eslint src/features/label-boxes --max-warnings=0`
Diharapkan: tidak ada output.

- [ ] **Step 3: Commit**

```bash
git add src/features/label-boxes/components/label-box-batch-print-card.tsx
git commit -m "feat: print every label in a closed batch from one card"
```

---

### Task 11: Tabel batch memakai status baru

**Files:**
- Modify: `src/features/label-boxes/components/label-box-batch-table.tsx`
- Modify: `src/app/(operator)/scan/page.tsx`

- [ ] **Step 1: Tambahkan status ke baris tabel**

Di `src/features/label-boxes/components/label-box-batch-table.tsx`, tambahkan dua field ke `LabelBoxBatchRow`:

```ts
  closed: boolean
  printed: boolean
```

Ganti kolom header `<TableHead>QR</TableHead>` menjadi:

```tsx
                <TableHead>Status</TableHead>
```

Ganti sel QR (blok `{batch.qrGenerated ? ... : ...}`) menjadi:

```tsx
                      {batch.printed ? (
                        <Badge variant="secondary">
                          <CheckCircle2Icon data-icon="inline-start" />
                          Tercetak
                        </Badge>
                      ) : batch.closed ? (
                        <Badge>Ditutup</Badge>
                      ) : (
                        <Badge variant="outline">Terbuka</Badge>
                      )}
```

Hapus field `qrGenerated` dari `LabelBoxBatchRow` — kolomnya sudah tidak ada.

Ganti sel aksi (blok `Tooltip` berisi tombol Verifikasi nonaktif) menjadi:

```tsx
                      {batch.closed ? (
                        <Button asChild size="sm" variant="outline">
                          <Link href={`/scan/${batch.id}/cetak`}>Cetak</Link>
                        </Button>
                      ) : (
                        <Button asChild size="sm" variant="outline">
                          <Link href={`/scan/${batch.id}/verifikasi`}>
                            Verifikasi
                          </Link>
                        </Button>
                      )}
```

Tambahkan `import Link from "next/link"` di puncak file, dan hapus impor `Tooltip`, `TooltipContent`, `TooltipTrigger` yang tidak lagi terpakai.

- [ ] **Step 2: Muat status di halaman scan**

Di `src/app/(operator)/scan/page.tsx`, tambahkan `closed_at` dan pautan print job ke select batch:

```ts
          "id, packing_qty, qty_delivery, lot_no, label_count, qr_generated_at, created_at, closed_at, supplier_code_snapshot, item_code_snapshot, delivery_number_snapshot, delivery_date_snapshot, label_boxes(box_number, set_no, box_no, packing_session_id)",
```

Tambahkan satu query ke `Promise.all` untuk mengetahui batch mana yang sudah punya print job:

```ts
      supabase
        .from("print_jobs")
        .select("packing_session_id")
        .is("parent_print_job_id", null),
```

Beri namanya `printJobsResult`, dan sertakan `printJobsResult.error` ke rantai `dataError`.

Di `toLabelBoxBatchRow`, ganti field `qrGenerated` dengan:

```ts
    closed: batch.closed_at !== null,
    printed: batch.label_boxes.some(
      (labelBox) =>
        labelBox.packing_session_id !== null &&
        printedSessionIds.has(labelBox.packing_session_id),
    ),
```

`printedSessionIds` dibangun sebelum pemetaan:

```ts
  const printedSessionIds = new Set(
    (printJobsResult.data ?? []).map((job) => job.packing_session_id),
  )
```

Karena `toLabelBoxBatchRow` kini butuh `printedSessionIds`, ubah ia menjadi fungsi dalam yang menutupi variabel itu, atau tambahkan parameter kedua — pilih yang lebih rapi dan konsisten dengan gaya file.

Perbarui `LabelBoxBatchQuery` agar memuat `closed_at: string | null` dan `packing_session_id: string | null` pada `label_boxes`.

- [ ] **Step 3: Typecheck, lint, build**

Run: `npx tsc --noEmit -p tsconfig.json`
Diharapkan: tidak ada error.

Run: `npx eslint "src/app/(operator)/scan" src/features/label-boxes --max-warnings=0`
Diharapkan: tidak ada output.

Run: `npx next build`
Diharapkan: build sukses.

- [ ] **Step 4: Commit**

```bash
git add src/features/label-boxes/components/label-box-batch-table.tsx "src/app/(operator)/scan/page.tsx"
git commit -m "feat: show batch status and route to verification or printing"
```

---

### Task 12: Rute cetak

**Files:**
- Create: `src/app/(operator)/scan/[batchId]/cetak/page.tsx`

- [ ] **Step 1: Buat halamannya**

```tsx
import Link from "next/link"
import { ArrowLeftIcon } from "lucide-react"
import { notFound } from "next/navigation"

import { LabelBoxBatchPrintCard } from "@/features/label-boxes/components/label-box-batch-print-card"
import { Button } from "@/components/ui/button"
import { requireOperator } from "@/features/auth/server"
import { createClient } from "@/lib/supabase/server"

export default async function LabelBoxPrintPage({
  params,
}: {
  params: Promise<{ batchId: string }>
}) {
  await requireOperator()
  const { batchId } = await params
  const supabase = await createClient()

  const { data: batch, error } = await supabase
    .from("label_box_batches")
    .select(
      "id, lot_no, label_count, closed_at, supplier_code_snapshot, item_code_snapshot, delivery_number_snapshot",
    )
    .eq("id", batchId)
    .maybeSingle()

  if (error || !batch || batch.closed_at === null) {
    notFound()
  }

  return (
    <section className="mx-auto grid max-w-2xl gap-6">
      <div>
        <Button asChild className="mb-2 px-0" variant="link">
          <Link href="/scan">
            <ArrowLeftIcon data-icon="inline-start" />
            Daftar label box
          </Link>
        </Button>
        <h1 className="text-2xl font-semibold">
          {batch.delivery_number_snapshot}
        </h1>
        <p className="text-muted-foreground text-sm">
          {batch.supplier_code_snapshot} · {batch.item_code_snapshot} · Lot{" "}
          {batch.lot_no} · {batch.label_count} label
        </p>
      </div>
      <LabelBoxBatchPrintCard batchId={batch.id} />
    </section>
  )
}
```

- [ ] **Step 2: Typecheck, lint, build**

Run: `npx tsc --noEmit -p tsconfig.json`
Diharapkan: tidak ada error.

Run: `npx eslint "src/app/(operator)/scan" --max-warnings=0`
Diharapkan: tidak ada output.

Run: `npx next build`
Diharapkan: build sukses, rute `/scan/[batchId]/cetak` muncul.

- [ ] **Step 3: Commit**

```bash
git add "src/app/(operator)/scan/[batchId]/cetak/page.tsx"
git commit -m "feat: add the batch print route"
```

---

### Task 13: Buang alur lama

Dikerjakan terakhir supaya `tsc`, `eslint`, dan `next build` menangkap rujukan yang menggantung seketika.

**Files:**
- Delete: `src/components/operator/packing-scan-console.tsx`
- Delete: `src/features/finalize/actions.ts`, `src/features/finalize/form-state.ts`
- Delete: `src/features/print/components/print-job-card.tsx`
- Modify: `src/features/scan/actions.ts`, `src/features/scan/form-state.ts`
- Create: `supabase/migrations/20260729120000_drop_packing_session_rpcs.sql`
- Delete: `supabase/tests/database/015_phase_6_finalize.test.sql`
- Modify: `supabase/tests/database/014_phase_5_packing_session_scan.test.sql`

- [ ] **Step 1: Hapus berkas frontend yang tak berpenghuni**

```bash
git rm src/components/operator/packing-scan-console.tsx
git rm src/features/finalize/actions.ts src/features/finalize/form-state.ts
git rm src/features/print/components/print-job-card.tsx
```

`PrinterPicker`, `use-preferred-printer`, `printer-preference`, `qz-client`, `use-qz-connection`, dan `src/features/print/actions.ts` **tetap** — kartu cetak batch memakainya.

- [ ] **Step 2: Ramping­kan `src/features/scan/`**

Di `src/features/scan/actions.ts`, hapus `startPackingSessionAction` beserta helper yang hanya dipakainya (`isIsoDate`, dan entri `safeRpcMessages` yang hanya muncul di alur start: `BOX_NOT_FOUND_OR_MISMATCH`, `BOX_EMPTY`, `DELIVERY_DATE_INVALID`, `DELIVERY_NUMBER_SUPPLIER_INVALID`, `LOT_NO_INVALID`, `MASTER_ITEM_SUPPLIER_MISMATCH`, `QTY_DELIVERY_INVALID`). `acceptPackingScanAction` tetap.

Di `src/features/scan/form-state.ts`, hapus `PackingSessionActionState` dan `initialPackingSessionActionState`; `AcceptPackingScanInput` dan `AcceptPackingScanActionResult` tetap.

- [ ] **Step 3: Buat migrasi pembuang RPC**

```sql
-- Alur packing session lama digantikan alur batch label box
-- (docs/superpowers/specs/2026-07-29-label-box-verification-and-print-design.md).
-- accept_packing_scan tetap: accept_label_box_scan mendelegasikan kepadanya.

drop function if exists public.start_packing_session(uuid, uuid, uuid, date, integer, text);
drop function if exists public.finalize_packing_session(uuid);

notify pgrst, 'reload schema';
```

Simpan sebagai `supabase/migrations/20260729120000_drop_packing_session_rpcs.sql`.

- [ ] **Step 4: Rapikan pgTAP**

```bash
git rm supabase/tests/database/015_phase_6_finalize.test.sql
```

Di `supabase/tests/database/014_phase_5_packing_session_scan.test.sql`, ganti setiap pemanggilan `public.start_packing_session(...)` dengan penyisipan `packing_sessions` langsung, karena RPC-nya sudah tidak ada. Contoh untuk sesi pertama:

```sql
insert into public.packing_sessions (
  id, operator_id, master_item_id, box_id, delivery_number_id,
  qty_delivery, lot_no, status
) values (
  'a1400000-0000-0000-0000-000000000001',
  '91100000-0000-0000-0000-000000000002',
  '96100000-0000-0000-0000-000000000001',
  '98100000-0000-0000-0000-000000000001',
  (select id from public.delivery_numbers limit 1),
  40, 'LOT-P5-A', 'scanning'
);
```

Buang assertion yang hanya menguji `start_packing_session` (has_function, penolakan supplier/qty/lot, penolakan anon atas RPC itu, dan penggunaan ulang Delivery Number) lalu turunkan `select plan(...)` sesuai jumlah assertion yang tersisa. Assertion `accept_packing_scan` tetap seluruhnya — itu inti nilai file ini.

Hitung ulang assertion secara manual sebelum menetapkan angka `plan(...)`; kalau meleset, pgTAP melaporkan `Looks like you planned N tests but ran M`.

- [ ] **Step 5: Terapkan migrasi dan jalankan test**

```bash
export SUPABASE_ACCESS_TOKEN=$(grep '^SUPABASE_ACCESS_TOKEN=' .env.local | cut -d= -f2- | tr -d '\r\n"')
npx supabase db push
node scripts/run-pgtap.mjs supabase/tests/database/014_phase_5_packing_session_scan.test.sql
node scripts/run-pgtap.mjs supabase/tests/database/019_label_box_batch.test.sql
node scripts/run-pgtap.mjs supabase/tests/database/020_label_box_verification.test.sql
```

Diharapkan: push sukses, `PASS` untuk ketiga file.

- [ ] **Step 6: Verifikasi menyeluruh**

```bash
npx tsc --noEmit -p tsconfig.json
npx eslint src --max-warnings=0
npx vitest run
npx next build
```

Keempatnya harus bersih. `tsc` dan `next build` adalah jaring pengaman utama di sini — merekalah yang membuktikan tidak ada impor menggantung setelah penghapusan.

- [ ] **Step 7: Commit**

```bash
git add -A -- src supabase
git commit -m "refactor: drop the superseded packing session start and finalize flow"
```

---

## Verifikasi manual (dijalankan user)

Alur ini butuh kredensial operator, scanner, dan printer Zebra:

- [ ] Tabel batch: batch baru berstatus Terbuka dengan tombol Verifikasi
- [ ] Buka verifikasi, scan produk: scan pertama masuk ke B101, progress box naik
- [ ] Isi B101 sampai penuh: box ditandai Penuh dan scan berikutnya pindah sendiri ke B201
- [ ] Scan produk yang tidak diperlukan box: toast merah bertahan sampai ditutup
- [ ] Tekan Selesaikan verifikasi: kembali ke tabel, status jadi Ditutup, tombol berubah jadi Cetak
- [ ] Halaman cetak: tekan Siapkan label lalu Cetak; seluruh label keluar berurutan B101, B201, B301
- [ ] Label fisik: QR terbaca sebagai `kodeSupplier|partNo|packingQty|noUrutMasterItem|lotNo|noBox|tanggal`
- [ ] Buka ulang halaman cetak dan tekan Siapkan label lagi: jumlah label tetap sama, tidak berlipat
