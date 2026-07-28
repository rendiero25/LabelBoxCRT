# Label Box Batch Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ganti halaman Scan menjadi tabel batch label box, dengan satu dialog tiga langkah yang menggenerate seluruh nomor box (B101, B201, B301, B102, …) beserta QR payload sekaligus.

**Architecture:** Dua tabel baru (`label_box_batches` + `label_boxes`) diisi oleh satu RPC `SECURITY DEFINER` yang atomik. Halaman `/scan` membaca batch dan menampilkannya sebagai tabel; alur `packing_sessions` lama tetap ada di database tapi tidak dirender lagi — UI scanning-nya dipakai ulang saat task Verifikasi.

**Tech Stack:** Next.js 15 App Router + React 19 (`useActionState`), Supabase Postgres (SECURITY DEFINER RPC), pgTAP, Vitest, shadcn Dialog/Table, `qrcode`.

**Spec:** `docs/superpowers/specs/2026-07-28-label-box-batch-generation-design.md`

---

## Running database work

Docker tidak tersedia di workstation ini, jadi `supabase test db` dan `supabase db diff` gagal. Dua perintah yang jalan karena bicara langsung ke project yang di-link:

- **Terapkan migrasi:** `npx supabase db push` (butuh `SUPABASE_ACCESS_TOKEN` dari `.env.local`)
- **Jalankan satu file pgTAP:** `node scripts/run-pgtap.mjs <path-ke-test.sql>` — file sudah dibungkus `begin; … rollback;`. Cetak `PASS`/`FAIL`, exit 0/1.

Migrasi wajib di-push sebelum Task 4 jalan, kalau tidak pgTAP menguji signature lama.

Empat file test sudah merah di `main` karena fixture usang dan **bukan bagian pekerjaan ini**: `001_phase_2_schema`, `003_phase_2_seed`, `012_product_auto_code`, `016_phase_7_print_rpcs`. `014`, `015`, `017`, `018` hijau dan harus tetap hijau.

---

## File Structure

| File | Tanggung jawab | Aksi |
|---|---|---|
| `supabase/migrations/20260728080000_label_box_batch.sql` | Enum, dua tabel, RLS, RPC `create_label_box_batch` | Create |
| `supabase/tests/database/019_label_box_batch.test.sql` | pgTAP untuk penomoran dan validasi | Create |
| `src/types/database.ts` | Tipe Supabase hasil generate | Modify |
| `src/lib/label/formatter.ts` | Ekspor `formatShortDate` untuk tampilan tabel | Modify |
| `src/lib/label/formatter.test.ts` | Test `formatShortDate` | Modify |
| `src/features/label-boxes/form-state.ts` | Tipe state action | Create |
| `src/features/label-boxes/actions.ts` | `createLabelBoxBatchAction` | Create |
| `src/features/label-boxes/components/label-box-batch-dialog.tsx` | Dialog tiga langkah | Create |
| `src/features/label-boxes/components/label-box-batch-table.tsx` | Tabel batch + tombol Verifikasi | Create |
| `src/app/(operator)/scan/page.tsx` | Query server halaman scan | Rewrite |
| `package.json` | Tambah `qrcode` + `@types/qrcode` | Modify |

`src/components/operator/packing-scan-console.tsx` **tidak disentuh dan tidak dirender** — dipakai ulang saat task Verifikasi.

**Penyimpangan dari spec:** spec menyebut Vitest untuk perakit QR payload dan pemformat nomor box. Keduanya dirakit di SQL agar nilai yang tersimpan punya satu sumber kebenaran, jadi pengujiannya ada di pgTAP (Task 3), bukan Vitest. Vitest tetap menguji `formatShortDate` yang dipakai tabel.

---

### Task 1: Migrasi — enum, tabel, RLS

**Files:**
- Create: `supabase/migrations/20260728080000_label_box_batch.sql`

- [ ] **Step 1: Buat file migrasi dengan bagian skema**

```sql
-- Label box batch generation (spec
-- docs/superpowers/specs/2026-07-28-label-box-batch-generation-design.md).
--
-- Operator mengisi satu form delivery; sistem menggenerate seluruh label box
-- sekaligus. Batch menyimpan snapshot (packing qty, nomor urut master item,
-- lot no) supaya label yang sudah tercetak tidak ikut berubah ketika master
-- data diedit.

create type public.label_box_status as enum ('generated', 'verified');

create table public.label_box_batches (
  id uuid primary key default gen_random_uuid(),
  delivery_number_id uuid not null references public.delivery_numbers (id) on delete restrict,
  supplier_id uuid not null references public.suppliers (id) on delete restrict,
  master_item_id uuid not null references public.master_items (id) on delete restrict,
  master_item_row_no integer not null check (master_item_row_no > 0),
  packing_qty integer not null check (packing_qty > 0),
  qty_delivery integer not null check (qty_delivery > 0),
  lot_no text not null check (btrim(lot_no) <> ''),
  label_count integer not null check (label_count > 0),
  qr_generated_at timestamptz,
  created_by uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.label_boxes (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.label_box_batches (id) on delete cascade,
  box_id uuid not null references public.boxes (id) on delete restrict,
  box_no integer not null check (box_no between 1 and 3),
  set_no integer not null check (set_no between 1 and 99),
  box_number text not null check (btrim(box_number) <> ''),
  qr_payload text not null check (btrim(qr_payload) <> ''),
  status public.label_box_status not null default 'generated',
  created_at timestamptz not null default now(),
  constraint label_boxes_batch_number_key unique (batch_id, box_number)
);

create index label_box_batches_created_idx
  on public.label_box_batches (created_at desc);
create index label_box_batches_delivery_number_idx
  on public.label_box_batches (delivery_number_id);
create index label_boxes_batch_idx on public.label_boxes (batch_id);

create trigger label_box_batches_set_updated_at
before update on public.label_box_batches
for each row execute function private.set_updated_at();

alter table public.label_box_batches enable row level security;
alter table public.label_boxes enable row level security;

-- Hanya baca lewat RLS; semua tulis lewat RPC SECURITY DEFINER.
grant select on table public.label_box_batches, public.label_boxes to authenticated;

create policy label_box_batches_select on public.label_box_batches
for select to authenticated
using ((select private.is_active_admin()) or (select private.is_active_operator()));

create policy label_boxes_select on public.label_boxes
for select to authenticated
using ((select private.is_active_admin()) or (select private.is_active_operator()));
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/20260728080000_label_box_batch.sql
git commit -m "feat: add label box batch and label box tables"
```

---

### Task 2: Migrasi — RPC `create_label_box_batch`

Satu RPC memegang seluruh aturan: resolusi Delivery Number, validasi kelipatan, penomoran box, dan perakitan QR payload. Dijalankan dalam satu transaksi supaya tidak ada batch setengah jadi.

**Files:**
- Modify: `supabase/migrations/20260728080000_label_box_batch.sql` (append)

- [ ] **Step 1: Tambahkan RPC di akhir file**

```sql
create function public.create_label_box_batch(
  p_supplier_id uuid,
  p_delivery_number text,
  p_delivery_date date,
  p_master_item_id uuid,
  p_qty_delivery integer,
  p_lot_no text
)
returns table (
  batch_id uuid,
  delivery_number text,
  delivery_date date,
  supplier_code text,
  item_code text,
  master_item_row_no integer,
  packing_qty integer,
  qty_delivery integer,
  lot_no text,
  label_count integer,
  qr_generated_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  target_item public.master_items%rowtype;
  target_supplier public.suppliers%rowtype;
  target_dn public.delivery_numbers%rowtype;
  created_batch public.label_box_batches%rowtype;
  normalized_lot_no text := btrim(coalesce(p_lot_no, ''));
  normalized_dn text := btrim(coalesce(p_delivery_number, ''));
  box_count integer;
  set_count integer;
  computed_row_no integer;
  generated_at timestamptz := statement_timestamp();
begin
  if not private.is_active_operator() then
    raise exception using errcode = 'P0001', message = 'LABEL_BOX_OPERATOR_REQUIRED';
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

  -- Master Item bersupplier hanya boleh dipakai untuk supplier itu.
  -- Baris lama dengan supplier_id null dibiarkan bebas.
  if target_item.supplier_id is not null
    and target_item.supplier_id <> p_supplier_id then
    raise exception using errcode = 'P0001', message = 'MASTER_ITEM_SUPPLIER_MISMATCH';
  end if;

  if p_delivery_date is null then
    raise exception using errcode = 'P0001', message = 'DELIVERY_DATE_INVALID';
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

  if p_qty_delivery % target_item.default_label_qty <> 0 then
    raise exception using errcode = 'P0001', message = 'QTY_DELIVERY_NOT_MULTIPLE';
  end if;

  set_count := p_qty_delivery / target_item.default_label_qty;

  -- Nomor set dicetak 2 digit (B101..B199), jadi lebih dari 99 set tidak
  -- punya representasi nomor box yang unik.
  if set_count > 99 then
    raise exception using errcode = 'P0001', message = 'QTY_DELIVERY_INVALID';
  end if;

  select * into target_dn
  from public.delivery_numbers dn
  where dn.supplier_id = p_supplier_id
    and lower(btrim(dn.delivery_number)) = lower(normalized_dn);

  if target_dn.id is null then
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
        'source', 'label_box_batch'
      )
    );
  elsif target_dn.delivery_date <> p_delivery_date then
    raise exception using errcode = 'P0001', message = 'DELIVERY_NUMBER_DATE_MISMATCH';
  end if;

  -- Nomor urut master item = posisi barisnya di tabel master item (urut
  -- item_code, sama dengan halaman admin). Disnapshot ke batch supaya label
  -- yang sudah tercetak tidak berubah ketika ada master item dihapus.
  select ranked.position into computed_row_no
  from (
    select item.id, (row_number() over (order by item.item_code))::integer as position
    from public.master_items item
  ) ranked
  where ranked.id = p_master_item_id;

  insert into public.label_box_batches (
    delivery_number_id, supplier_id, master_item_id, master_item_row_no,
    packing_qty, qty_delivery, lot_no, label_count, qr_generated_at, created_by
  ) values (
    target_dn.id, p_supplier_id, p_master_item_id, computed_row_no,
    target_item.default_label_qty, p_qty_delivery, normalized_lot_no,
    set_count * box_count, generated_at, auth.uid()
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
      'packing_qty', created_batch.packing_qty,
      'label_count', created_batch.label_count,
      'lot_no', created_batch.lot_no
    )
  );

  return query
  select
    created_batch.id, target_dn.delivery_number, target_dn.delivery_date,
    target_supplier.supplier_code, target_item.item_code,
    created_batch.master_item_row_no, created_batch.packing_qty,
    created_batch.qty_delivery, created_batch.lot_no,
    created_batch.label_count, created_batch.qr_generated_at;
end;
$$;

revoke execute on function public.create_label_box_batch(uuid, text, date, uuid, integer, text)
  from public, anon;
grant execute on function public.create_label_box_batch(uuid, text, date, uuid, integer, text)
  to authenticated;

notify pgrst, 'reload schema';
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/20260728080000_label_box_batch.sql
git commit -m "feat: generate label box numbers and QR payloads in one RPC"
```

- [ ] **Step 3: Terapkan migrasi ke project yang di-link**

```bash
export SUPABASE_ACCESS_TOKEN=$(grep '^SUPABASE_ACCESS_TOKEN=' .env.local | cut -d= -f2- | tr -d '\r\n"')
npx supabase db push
```

Diharapkan: `Applying migration 20260728080000_label_box_batch.sql...` lalu `Finished supabase db push.`

Kalau gagal, jangan ulangi buta — baca errornya, perbaiki file migrasi, laporkan apa yang berubah. Migrasi yang setengah masuk butuh `npx supabase migration repair` sebelum percobaan berikutnya.

- [ ] **Step 4: Pastikan test lama masih hijau**

```bash
node scripts/run-pgtap.mjs supabase/tests/database/014_phase_5_packing_session_scan.test.sql
node scripts/run-pgtap.mjs supabase/tests/database/015_phase_6_finalize.test.sql
node scripts/run-pgtap.mjs supabase/tests/database/017_master_item_code_autogen.test.sql
node scripts/run-pgtap.mjs supabase/tests/database/018_box_owned_by_master_item.test.sql
```

Diharapkan: `PASS` untuk keempatnya. Migrasi ini tidak menyentuh RPC lama, jadi kegagalan berarti ada yang salah di file migrasi.

---

### Task 3: pgTAP — `019_label_box_batch.test.sql`

**Files:**
- Create: `supabase/tests/database/019_label_box_batch.test.sql`

- [ ] **Step 1: Tulis file test**

```sql
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;

select plan(19);

insert into auth.users (
  id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('91190000-0000-0000-0000-000000000001', 'authenticated', 'authenticated',
    'label-box-operator@example.test', '{}'::jsonb, '{}'::jsonb, now(), now());

insert into public.profiles (id, display_name, role, is_active) values
  ('91190000-0000-0000-0000-000000000001', 'Label Box Operator', 'operator', true);

insert into public.suppliers (id, supplier_code, supplier_name, is_active) values
  ('95190000-0000-0000-0000-000000000001', 'LB1SUP', 'Label Box Supplier', true),
  ('95190000-0000-0000-0000-000000000002', 'LB1OFF', 'Label Box Inactive', false);

insert into public.master_items (
  id, item_code, part_no, part_name, unit, default_label_qty, supplier_id, is_active
) values
  (
    '96190000-0000-0000-0000-000000000001', 'labelbox-item', 'LABELBOX-PART',
    'Label Box Part', 'Pcs', 100, '95190000-0000-0000-0000-000000000001', true
  ),
  (
    '96190000-0000-0000-0000-000000000002', 'labelbox-nobox', 'LABELBOX-NOBOX',
    'Label Box No Box Part', 'Pcs', 100, '95190000-0000-0000-0000-000000000001', true
  );

insert into public.boxes (id, master_item_id, box_no, box_code, box_name) values
  ('98190000-0000-0000-0000-000000000001',
    '96190000-0000-0000-0000-000000000001', 1, 'labelbox-01', 'Box 1'),
  ('98190000-0000-0000-0000-000000000002',
    '96190000-0000-0000-0000-000000000001', 2, 'labelbox-02', 'Box 2'),
  ('98190000-0000-0000-0000-000000000003',
    '96190000-0000-0000-0000-000000000001', 3, 'labelbox-03', 'Box 3');

select has_function(
  'public',
  'create_label_box_batch',
  array['uuid', 'text', 'date', 'uuid', 'integer', 'text'],
  'create_label_box_batch RPC takes supplier, DN, date, master item, qty, lot'
);

select has_table('public', 'label_box_batches', 'label_box_batches table exists');
select has_table('public', 'label_boxes', 'label_boxes table exists');

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '91190000-0000-0000-0000-000000000001',
  true
);

-- Qty 100 dengan packing qty 100 dan 3 box = 3 label.
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
grant select on labelbox_batch_a to public;

select is(
  (select label_count from labelbox_batch_a),
  3,
  'qty delivery 100 dengan packing qty 100 dan 3 box menghasilkan 3 label'
);

select is(
  (
    select string_agg(box_number, ',' order by set_no, box_no)
    from public.label_boxes
    where batch_id = (select batch_id from labelbox_batch_a)
  ),
  'B101,B201,B301',
  'satu set menghasilkan B101, B201, B301'
);

select is(
  (
    select qr_payload
    from public.label_boxes
    where batch_id = (select batch_id from labelbox_batch_a) and box_number = 'B101'
  ),
  'LB1SUP|LABELBOX-PART|100|' ||
    (select master_item_row_no from labelbox_batch_a)::text ||
    '|LOT-LB-A|B101|28-07-2026',
  'QR payload berisi tujuh field dengan urutan yang dikunci spec'
);

select isnt(
  (select qr_generated_at from labelbox_batch_a),
  null,
  'batch menyimpan waktu generate QR'
);

-- Dihitung ulang tanpa membaca batch, supaya kesalahan pada row_number()
-- di RPC benar-benar tertangkap.
select is(
  (select master_item_row_no from labelbox_batch_a),
  (
    select count(*)::integer
    from public.master_items item
    where item.item_code <= 'labelbox-item'
  ),
  'nomor urut master item sama dengan posisi barisnya saat diurutkan item_code'
);

-- Qty 200 = 2 set = 6 label, set kedua berakhiran 02.
create temporary table labelbox_batch_b as
select *
from public.create_label_box_batch(
  '95190000-0000-0000-0000-000000000001',
  'DN-LABELBOX-1',
  date '2026-07-28',
  '96190000-0000-0000-0000-000000000001',
  200,
  'LOT-LB-B'
);
grant select on labelbox_batch_b to public;

select is(
  (select label_count from labelbox_batch_b),
  6,
  'qty delivery 200 menghasilkan 6 label'
);

select is(
  (
    select string_agg(box_number, ',' order by set_no, box_no)
    from public.label_boxes
    where batch_id = (select batch_id from labelbox_batch_b)
  ),
  'B101,B201,B301,B102,B202,B302',
  'set kedua memakai akhiran 02'
);

select is(
  (
    select count(distinct delivery_number_id)::integer
    from public.label_box_batches
    where id in (
      (select batch_id from labelbox_batch_a),
      (select batch_id from labelbox_batch_b)
    )
  ),
  1,
  'nomor DN yang sama dipakai ulang, tidak membuat DN baru'
);

select throws_ok(
  $$
    select public.create_label_box_batch(
      '95190000-0000-0000-0000-000000000001',
      'DN-LABELBOX-1',
      date '2026-08-01',
      '96190000-0000-0000-0000-000000000001',
      100,
      'LOT-LB-C'
    )
  $$,
  'P0001',
  'DELIVERY_NUMBER_DATE_MISMATCH',
  'DN yang sama dengan tanggal berbeda ditolak'
);

select throws_ok(
  $$
    select public.create_label_box_batch(
      '95190000-0000-0000-0000-000000000001',
      'DN-LABELBOX-2',
      date '2026-07-28',
      '96190000-0000-0000-0000-000000000001',
      150,
      'LOT-LB-C'
    )
  $$,
  'P0001',
  'QTY_DELIVERY_NOT_MULTIPLE',
  'qty delivery yang bukan kelipatan packing qty ditolak'
);

select throws_ok(
  $$
    select public.create_label_box_batch(
      '95190000-0000-0000-0000-000000000001',
      'DN-LABELBOX-2',
      date '2026-07-28',
      '96190000-0000-0000-0000-000000000001',
      10000,
      'LOT-LB-C'
    )
  $$,
  'P0001',
  'QTY_DELIVERY_INVALID',
  'lebih dari 99 set ditolak karena nomor set hanya dua digit'
);

select throws_ok(
  $$
    select public.create_label_box_batch(
      '95190000-0000-0000-0000-000000000001',
      'DN-LABELBOX-2',
      date '2026-07-28',
      '96190000-0000-0000-0000-000000000002',
      100,
      'LOT-LB-C'
    )
  $$,
  'P0001',
  'MASTER_ITEM_HAS_NO_BOX',
  'master item tanpa box ditolak'
);

select throws_ok(
  $$
    select public.create_label_box_batch(
      '95190000-0000-0000-0000-000000000002',
      'DN-LABELBOX-2',
      date '2026-07-28',
      '96190000-0000-0000-0000-000000000001',
      100,
      'LOT-LB-C'
    )
  $$,
  'P0001',
  'SUPPLIER_INVALID',
  'supplier tidak aktif ditolak'
);

select throws_ok(
  $$
    select public.create_label_box_batch(
      '95190000-0000-0000-0000-000000000001',
      'DN-LABELBOX-2',
      date '2026-07-28',
      '96190000-0000-0000-0000-000000000001',
      100,
      '   '
    )
  $$,
  'P0001',
  'LOT_NO_INVALID',
  'lot no kosong ditolak'
);

-- Admin bisa menutup DN kapan saja; label tidak boleh dibuat setelahnya.
reset role;

update public.delivery_numbers
set status = 'closed'
where supplier_id = '95190000-0000-0000-0000-000000000001'
  and delivery_number = 'DN-LABELBOX-1';

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '91190000-0000-0000-0000-000000000001',
  true
);

select throws_ok(
  $$
    select public.create_label_box_batch(
      '95190000-0000-0000-0000-000000000001',
      'DN-LABELBOX-1',
      date '2026-07-28',
      '96190000-0000-0000-0000-000000000001',
      100,
      'LOT-LB-E'
    )
  $$,
  'P0001',
  'DELIVERY_NUMBER_NOT_ACTIVE',
  'Delivery Number yang sudah ditutup ditolak'
);

reset role;
set local role anon;

select throws_ok(
  $$
    select public.create_label_box_batch(
      '95190000-0000-0000-0000-000000000001',
      'DN-LABELBOX-3',
      date '2026-07-28',
      '96190000-0000-0000-0000-000000000001',
      100,
      'LOT-LB-D'
    )
  $$,
  '42501',
  'permission denied for function create_label_box_batch',
  'anon tidak punya execute privilege'
);

reset role;

select * from finish();

rollback;
```

- [ ] **Step 2: Jalankan test**

Run: `node scripts/run-pgtap.mjs supabase/tests/database/019_label_box_batch.test.sql`
Diharapkan: `PASS  supabase/tests/database/019_label_box_batch.test.sql`, exit code 0.

Baris `# Looks like you failed N tests of 19` berarti ada assertion yang salah; `HTTP 400` dengan error Postgres berarti SQL-nya sendiri rusak. Perbaiki lalu jalankan ulang.

- [ ] **Step 3: Commit**

```bash
git add supabase/tests/database/019_label_box_batch.test.sql
git commit -m "test: cover label box numbering, QR payload, and batch validation"
```

---

### Task 4: Tipe Supabase

**Files:**
- Modify: `src/types/database.ts`

- [ ] **Step 1: Tambahkan blok tabel `label_box_batches`**

Di dalam `Tables`, urut alfabetis (sebelum `label_boxes`):

```ts
      label_box_batches: {
        Row: {
          created_at: string
          created_by: string
          delivery_number_id: string
          id: string
          label_count: number
          lot_no: string
          master_item_id: string
          master_item_row_no: number
          packing_qty: number
          qr_generated_at: string | null
          qty_delivery: number
          supplier_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          delivery_number_id: string
          id?: string
          label_count: number
          lot_no: string
          master_item_id: string
          master_item_row_no: number
          packing_qty: number
          qr_generated_at?: string | null
          qty_delivery: number
          supplier_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          delivery_number_id?: string
          id?: string
          label_count?: number
          lot_no?: string
          master_item_id?: string
          master_item_row_no?: number
          packing_qty?: number
          qr_generated_at?: string | null
          qty_delivery?: number
          supplier_id?: string
          updated_at?: string
        }
        Relationships: []
      }
```

- [ ] **Step 2: Tambahkan blok tabel `label_boxes`**

```ts
      label_boxes: {
        Row: {
          batch_id: string
          box_id: string
          box_no: number
          box_number: string
          created_at: string
          id: string
          qr_payload: string
          set_no: number
          status: Database["public"]["Enums"]["label_box_status"]
        }
        Insert: {
          batch_id: string
          box_id: string
          box_no: number
          box_number: string
          created_at?: string
          id?: string
          qr_payload: string
          set_no: number
          status?: Database["public"]["Enums"]["label_box_status"]
        }
        Update: {
          batch_id?: string
          box_id?: string
          box_no?: number
          box_number?: string
          created_at?: string
          id?: string
          qr_payload?: string
          set_no?: number
          status?: Database["public"]["Enums"]["label_box_status"]
        }
        Relationships: []
      }
```

- [ ] **Step 3: Tambahkan tipe fungsi**

Di dalam `Functions`, urut alfabetis:

```ts
      create_label_box_batch: {
        Args: {
          p_delivery_date: string
          p_delivery_number: string
          p_lot_no: string
          p_master_item_id: string
          p_qty_delivery: number
          p_supplier_id: string
        }
        Returns: {
          batch_id: string
          delivery_date: string
          delivery_number: string
          item_code: string
          label_count: number
          lot_no: string
          master_item_row_no: number
          packing_qty: number
          qr_generated_at: string
          qty_delivery: number
          supplier_code: string
        }[]
      }
```

- [ ] **Step 4: Tambahkan enum**

Di dalam `Enums`:

```ts
      label_box_status: "generated" | "verified"
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Diharapkan: tidak ada error.

- [ ] **Step 6: Commit**

```bash
git add src/types/database.ts
git commit -m "chore: add Supabase types for the label box batch tables"
```

---

### Task 5: Formatter tanggal pendek

Tabel batch menampilkan tanggal `DD-MM-YYYY`. Logika itu sudah ada di `formatQrDate` tapi belum diekspor.

**Files:**
- Modify: `src/lib/label/formatter.ts`
- Test: `src/lib/label/formatter.test.ts`

- [ ] **Step 1: Tulis test yang gagal**

Tambahkan di akhir `src/lib/label/formatter.test.ts`:

```ts
describe("formatShortDate", () => {
  it("formats an ISO date as DD-MM-YYYY", () => {
    expect(formatShortDate("2026-07-28")).toBe("28-07-2026")
  })

  it("accepts a full ISO timestamp", () => {
    expect(formatShortDate("2026-12-31T23:59:59.123Z")).toBe("31-12-2026")
  })

  it("throws when the value is not an ISO date", () => {
    expect(() => formatShortDate("28/07/2026")).toThrow()
  })
})
```

Perbarui baris import di puncak file agar menyertakan `formatShortDate`:

```ts
import { formatLabelFields, formatShortDate } from "@/lib/label/formatter"
```

Kalau import lama memakai bentuk lain (misal `import { formatLabelFields } from "./formatter"`), pertahankan gaya path-nya dan cukup tambahkan `formatShortDate` ke daftar.

- [ ] **Step 2: Jalankan test untuk memastikan gagal**

Run: `npx vitest run src/lib/label/formatter.test.ts`
Diharapkan: FAIL — `formatShortDate` belum diekspor.

- [ ] **Step 3: Ekspor fungsinya**

Di `src/lib/label/formatter.ts`, ubah deklarasi `formatQrDate` menjadi ekspor bernama `formatShortDate` dan perbarui pemakaiannya:

```ts
/**
 * Tanggal ringkas DD-MM-YYYY. Dipakai QR payload label dan kolom tanggal di
 * tabel batch label box.
 */
export function formatShortDate(isoTimestamp: string): string {
  const match = isoDatePattern.exec(isoTimestamp)
  if (!match) {
    throw new Error(
      `formatShortDate: expected an ISO timestamp (YYYY-MM-DD...), received "${isoTimestamp}"`,
    )
  }

  const [, yearText, monthText, dayText] = match
  return `${dayText}-${monthText}-${yearText}`
}
```

Lalu di `buildQrPayload`, ganti `formatQrDate(snapshot.qrGeneratedAt)` menjadi `formatShortDate(snapshot.qrGeneratedAt)`.

Test lama yang berbunyi "throws when qrGeneratedAt is not a parseable ISO timestamp" tetap lulus karena pesan errornya tidak diperiksa.

- [ ] **Step 4: Jalankan test untuk memastikan lulus**

Run: `npx vitest run src/lib/label/formatter.test.ts`
Diharapkan: PASS, semua assertion hijau.

- [ ] **Step 5: Commit**

```bash
git add src/lib/label/formatter.ts src/lib/label/formatter.test.ts
git commit -m "refactor: export the short date formatter for the batch table"
```

---

### Task 6: State dan action

**Files:**
- Create: `src/features/label-boxes/form-state.ts`
- Create: `src/features/label-boxes/actions.ts`

- [ ] **Step 1: Buat `src/features/label-boxes/form-state.ts`**

```ts
export type GeneratedLabelBox = {
  boxNumber: string
  qrPayload: string
}

export type LabelBoxBatchResult = {
  deliveryDate: string
  deliveryNumber: string
  itemCode: string
  labelBoxes: GeneratedLabelBox[]
  labelCount: number
  lotNo: string
  masterItemRowNo: number
  packingQty: number
  qtyDelivery: number
  supplierCode: string
}

export type LabelBoxBatchActionState = {
  error?: string
  result?: LabelBoxBatchResult
  success?: string
}

export const initialLabelBoxBatchActionState: LabelBoxBatchActionState = {}
```

- [ ] **Step 2: Buat `src/features/label-boxes/actions.ts`**

```ts
"use server"

import { revalidatePath } from "next/cache"

import {
  type LabelBoxBatchActionState,
} from "@/features/label-boxes/form-state"
import { createClient } from "@/lib/supabase/server"

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const safeRpcMessages: Record<string, string> = {
  DELIVERY_DATE_INVALID: "Tanggal delivery tidak valid.",
  DELIVERY_NUMBER_DATE_MISMATCH:
    "Delivery Number ini sudah terdaftar dengan tanggal berbeda.",
  DELIVERY_NUMBER_INVALID:
    "Delivery Number wajib diisi (maksimal 100 karakter).",
  DELIVERY_NUMBER_NOT_ACTIVE:
    "Delivery Number ini sudah ditutup atau dibatalkan admin.",
  LABEL_BOX_OPERATOR_REQUIRED: "Aksi ini hanya untuk operator aktif.",
  LOT_NO_INVALID: "Lot No wajib diisi (maksimal 100 karakter).",
  MASTER_ITEM_HAS_NO_BOX: "Master Item ini belum punya Box.",
  MASTER_ITEM_NOT_ACTIVE: "Master Item tidak aktif atau tidak ditemukan.",
  MASTER_ITEM_SUPPLIER_MISMATCH:
    "Master Item ini tidak terdaftar untuk supplier yang dipilih.",
  QTY_DELIVERY_INVALID:
    "Qty Delivery tidak valid (maksimal 99 kali Packing Qty).",
  QTY_DELIVERY_NOT_MULTIPLE:
    "Qty Delivery harus kelipatan Packing Qty Master Item.",
  SUPPLIER_INVALID: "Supplier tidak aktif atau tidak ditemukan.",
}

function rpcErrorMessage(code: string): string {
  return (
    safeRpcMessages[code] ??
    "Gagal membuat label box. Coba lagi atau hubungi admin."
  )
}

function valueFromFormData(formData: FormData, name: string): string | null {
  const value = formData.get(name)
  return typeof value === "string" && value.trim() ? value : null
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00.000Z`)
  return (
    !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value
  )
}

export async function createLabelBoxBatchAction(
  _previousState: LabelBoxBatchActionState,
  formData: FormData,
): Promise<LabelBoxBatchActionState> {
  const supplierId = valueFromFormData(formData, "supplierId")
  const masterItemId = valueFromFormData(formData, "masterItemId")
  const deliveryNumber = valueFromFormData(formData, "deliveryNumber")
  const deliveryDate = valueFromFormData(formData, "deliveryDate")
  const lotNo = valueFromFormData(formData, "lotNo")
  const rawQtyDelivery = String(formData.get("qtyDelivery") ?? "").trim()

  if (
    !supplierId ||
    !masterItemId ||
    !uuidPattern.test(supplierId) ||
    !uuidPattern.test(masterItemId)
  ) {
    return { error: "Supplier dan Master Item wajib dipilih." }
  }

  if (!deliveryNumber || deliveryNumber.trim().length > 100) {
    return { error: "Delivery Number wajib diisi (maksimal 100 karakter)." }
  }

  if (!deliveryDate || !isIsoDate(deliveryDate)) {
    return { error: "Tanggal delivery tidak valid." }
  }

  if (!/^[1-9]\d{0,6}$/.test(rawQtyDelivery)) {
    return { error: "Qty Delivery harus bilangan bulat lebih besar dari 0." }
  }

  if (!lotNo || lotNo.trim().length > 100) {
    return { error: "Lot No wajib diisi (maksimal 100 karakter)." }
  }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc("create_label_box_batch", {
    p_delivery_date: deliveryDate,
    p_delivery_number: deliveryNumber.trim(),
    p_lot_no: lotNo.trim(),
    p_master_item_id: masterItemId,
    p_qty_delivery: Number(rawQtyDelivery),
    p_supplier_id: supplierId,
  })

  if (error || !data?.[0]) {
    return { error: rpcErrorMessage(error?.message ?? "") }
  }

  const batch = data[0]
  const { data: labelBoxRows, error: labelBoxError } = await supabase
    .from("label_boxes")
    .select("box_number, qr_payload, set_no, box_no")
    .eq("batch_id", batch.batch_id)
    .order("set_no")
    .order("box_no")

  if (labelBoxError) {
    return {
      error:
        "Batch tersimpan tetapi daftar label gagal dimuat. Buka kembali halaman scan.",
    }
  }

  revalidatePath("/scan")
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
      packingQty: batch.packing_qty,
      qtyDelivery: batch.qty_delivery,
      supplierCode: batch.supplier_code,
    },
    success: `${batch.label_count} label box dibuat untuk ${batch.delivery_number}.`,
  }
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Diharapkan: tidak ada error.

- [ ] **Step 4: Commit**

```bash
git add src/features/label-boxes/form-state.ts src/features/label-boxes/actions.ts
git commit -m "feat: add the create label box batch server action"
```

---

### Task 7: Dependency QR

**Files:**
- Modify: `package.json`, `package-lock.json`

- [ ] **Step 1: Pasang library**

```bash
npm install qrcode@1.5.4 && npm install --save-dev @types/qrcode@1.5.5
```

- [ ] **Step 2: Pastikan build masih bersih**

Run: `npx tsc --noEmit -p tsconfig.json`
Diharapkan: tidak ada error.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add qrcode for the on-screen label QR preview"
```

---

### Task 8: Dialog tiga langkah

**Files:**
- Create: `src/features/label-boxes/components/label-box-batch-dialog.tsx`

- [ ] **Step 1: Buat komponennya**

```tsx
"use client"

import { useActionState, useEffect, useMemo, useState } from "react"
import { CircleAlertIcon, PackageCheckIcon, PlusIcon } from "lucide-react"
import QRCode from "qrcode"

import { createLabelBoxBatchAction } from "@/features/label-boxes/actions"
import {
  initialLabelBoxBatchActionState,
  type LabelBoxBatchResult,
} from "@/features/label-boxes/form-state"
import { useActionStateToast } from "@/components/shared/action-state-toast"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"

export type LabelBoxSupplierOption = {
  id: string
  supplierCode: string
}

export type LabelBoxMasterItemOption = {
  id: string
  itemCode: string
  packingQty: number
  partNo: string
  supplierId: string | null
}

export function LabelBoxBatchDialog({
  masterItems,
  suppliers,
}: {
  masterItems: LabelBoxMasterItemOption[]
  suppliers: LabelBoxSupplierOption[]
}) {
  const [state, formAction, isPending] = useActionState(
    createLabelBoxBatchAction,
    initialLabelBoxBatchActionState,
  )
  useActionStateToast(state)

  const [open, setOpen] = useState(false)
  const [supplierId, setSupplierId] = useState("")
  const [masterItemId, setMasterItemId] = useState("")

  const filteredMasterItems = useMemo(
    () =>
      masterItems.filter(
        (item) => item.supplierId === null || item.supplierId === supplierId,
      ),
    [masterItems, supplierId],
  )

  const selectedMasterItem = useMemo(
    () => masterItems.find((item) => item.id === masterItemId) ?? null,
    [masterItemId, masterItems],
  )

  function resetForm() {
    setSupplierId("")
    setMasterItemId("")
  }

  return (
    <Dialog
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen)
        if (!nextOpen) resetForm()
      }}
      open={open}
    >
      <DialogTrigger asChild>
        <Button>
          <PlusIcon data-icon="inline-start" />
          Tambah
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        {state.result ? (
          <GeneratedStep
            onFinish={() => {
              setOpen(false)
              resetForm()
            }}
            result={state.result}
          />
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Tambah label box</DialogTitle>
              <DialogDescription>
                Nomor box dan QR dibuat otomatis dari Qty Delivery dibagi
                Packing Qty Master Item.
              </DialogDescription>
            </DialogHeader>
            <form action={formAction} className="flex flex-col gap-5" noValidate>
              {state.error ? (
                <Alert variant="destructive">
                  <CircleAlertIcon />
                  <AlertDescription>{state.error}</AlertDescription>
                </Alert>
              ) : null}
              <input name="supplierId" type="hidden" value={supplierId} />
              <input name="masterItemId" type="hidden" value={masterItemId} />
              <FieldGroup>
                <div className="grid gap-5 sm:grid-cols-2">
                  <Field>
                    <FieldLabel htmlFor="label-box-dn">Delivery Number</FieldLabel>
                    <Input
                      id="label-box-dn"
                      maxLength={100}
                      name="deliveryNumber"
                      placeholder="DN-2026-0001"
                      required
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="label-box-date">
                      Tanggal Delivery Number
                    </FieldLabel>
                    <Input
                      id="label-box-date"
                      name="deliveryDate"
                      required
                      type="date"
                    />
                  </Field>
                </div>

                <Field>
                  <FieldLabel htmlFor="label-box-supplier">Kode Supplier</FieldLabel>
                  <Select
                    onValueChange={(value) => {
                      setSupplierId(value)
                      setMasterItemId("")
                    }}
                    value={supplierId}
                  >
                    <SelectTrigger className="w-full" id="label-box-supplier">
                      <SelectValue placeholder="Pilih kode supplier" />
                    </SelectTrigger>
                    <SelectContent>
                      {suppliers.map((supplier) => (
                        <SelectItem key={supplier.id} value={supplier.id}>
                          {supplier.supplierCode}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>

                <Field>
                  <FieldLabel htmlFor="label-box-master-item">Master Item</FieldLabel>
                  <Select
                    key={supplierId}
                    onValueChange={setMasterItemId}
                    value={masterItemId}
                  >
                    <SelectTrigger className="w-full" id="label-box-master-item">
                      <SelectValue placeholder="Pilih kode Master Item" />
                    </SelectTrigger>
                    <SelectContent>
                      {filteredMasterItems.length === 0 ? (
                        <div className="text-muted-foreground px-2 py-1.5 text-sm">
                          Tidak ada Master Item ber-Box untuk supplier ini.
                        </div>
                      ) : (
                        filteredMasterItems.map((item) => (
                          <SelectItem key={item.id} value={item.id}>
                            {item.itemCode}
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                </Field>

                <div className="grid gap-5 sm:grid-cols-2">
                  <Field>
                    <FieldLabel htmlFor="label-box-packing-qty">
                      Packing Qty
                    </FieldLabel>
                    <Input
                      disabled
                      id="label-box-packing-qty"
                      value={
                        selectedMasterItem
                          ? String(selectedMasterItem.packingQty)
                          : "Pilih Master Item terlebih dahulu"
                      }
                    />
                    <FieldDescription>Ikut master data, tidak bisa diubah.</FieldDescription>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="label-box-qty-delivery">
                      Qty Delivery
                    </FieldLabel>
                    <Input
                      id="label-box-qty-delivery"
                      inputMode="numeric"
                      name="qtyDelivery"
                      placeholder="100"
                      required
                    />
                    <FieldDescription>Harus kelipatan Packing Qty.</FieldDescription>
                  </Field>
                </div>

                <Field>
                  <FieldLabel htmlFor="label-box-lot">Lot Number</FieldLabel>
                  <Input
                    id="label-box-lot"
                    maxLength={100}
                    name="lotNo"
                    placeholder="LOT-2026-07-001"
                    required
                  />
                </Field>
              </FieldGroup>
              <DialogFooter>
                <Button
                  onClick={() => setOpen(false)}
                  type="button"
                  variant="outline"
                >
                  Batal
                </Button>
                <Button
                  disabled={isPending || !supplierId || !masterItemId}
                  type="submit"
                >
                  {isPending ? <Spinner data-icon="inline-start" /> : null}
                  Simpan
                </Button>
              </DialogFooter>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

function GeneratedStep({
  onFinish,
  result,
}: {
  onFinish: () => void
  result: LabelBoxBatchResult
}) {
  const samplePayload = result.labelBoxes[0]?.qrPayload ?? ""
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!samplePayload) return
    let cancelled = false
    QRCode.toDataURL(samplePayload, { margin: 1, width: 120 })
      .then((url) => {
        if (!cancelled) setQrDataUrl(url)
      })
      .catch(() => {
        if (!cancelled) setQrDataUrl(null)
      })
    return () => {
      cancelled = true
    }
  }, [samplePayload])

  return (
    <>
      <DialogHeader>
        <DialogTitle>{result.labelCount} label box dibuat</DialogTitle>
        <DialogDescription>
          {result.deliveryNumber} · {result.supplierCode} · {result.itemCode} ·
          Lot {result.lotNo}
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-5">
        <div>
          <p className="mb-2 text-sm font-medium">Nomor box</p>
          <div className="flex flex-wrap gap-2">
            {result.labelBoxes.map((labelBox) => (
              <span
                className="bg-muted rounded-md px-2 py-1 font-mono text-sm"
                key={labelBox.boxNumber}
              >
                {labelBox.boxNumber}
              </span>
            ))}
          </div>
        </div>

        <div>
          <div className="mb-2 flex items-center gap-2">
            <PackageCheckIcon className="size-4" />
            <p className="text-sm font-medium">QR tergenerate</p>
          </div>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
            {qrDataUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                alt={`QR ${result.labelBoxes[0]?.boxNumber ?? ""}`}
                className="rounded-md border"
                height={120}
                src={qrDataUrl}
                width={120}
              />
            ) : (
              <div className="size-[120px] rounded-md border" />
            )}
            <div className="grid flex-1 gap-1">
              {result.labelBoxes.map((labelBox) => (
                <p
                  className="text-muted-foreground font-mono text-xs break-all"
                  key={labelBox.boxNumber}
                >
                  {labelBox.qrPayload}
                </p>
              ))}
            </div>
          </div>
        </div>
      </div>

      <DialogFooter>
        <Button onClick={onFinish} type="button">
          Selesai
        </Button>
      </DialogFooter>
    </>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Diharapkan: tidak ada error.

- [ ] **Step 3: Commit**

```bash
git add src/features/label-boxes/components/label-box-batch-dialog.tsx
git commit -m "feat: add the three-step label box batch dialog"
```

---

### Task 9: Tabel batch

**Files:**
- Create: `src/features/label-boxes/components/label-box-batch-table.tsx`

- [ ] **Step 1: Buat komponennya**

```tsx
"use client"

import { Fragment, useState } from "react"
import { CheckCircle2Icon, ChevronRightIcon } from "lucide-react"

import {
  LabelBoxBatchDialog,
  type LabelBoxMasterItemOption,
  type LabelBoxSupplierOption,
} from "@/features/label-boxes/components/label-box-batch-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { formatShortDate } from "@/lib/label/formatter"

export type LabelBoxBatchRow = {
  boxNumbers: string[]
  deliveryDate: string
  deliveryNumber: string
  id: string
  itemCode: string
  labelCount: number
  lotNo: string
  packingQty: number
  qrGenerated: boolean
  qtyDelivery: number
  supplierCode: string
}

export function LabelBoxBatchTable({
  batches,
  masterItems,
  suppliers,
}: {
  batches: LabelBoxBatchRow[]
  masterItems: LabelBoxMasterItemOption[]
  suppliers: LabelBoxSupplierOption[]
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null)

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">Data label box</h1>
          <p className="text-muted-foreground text-sm">
            Nomor box dan QR dibuat sekaligus saat data delivery disimpan.
          </p>
        </div>
        <LabelBoxBatchDialog masterItems={masterItems} suppliers={suppliers} />
      </div>

      {batches.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>Belum ada label box</EmptyTitle>
            <EmptyDescription>
              Tekan Tambah untuk mengisi data delivery dan menggenerate label.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Delivery Number</TableHead>
                <TableHead>Tanggal</TableHead>
                <TableHead>Supplier</TableHead>
                <TableHead>Master Item</TableHead>
                <TableHead className="text-right">Packing Qty</TableHead>
                <TableHead className="text-right">Qty Delivery</TableHead>
                <TableHead>Lot No</TableHead>
                <TableHead className="text-right">Label</TableHead>
                <TableHead>QR</TableHead>
                <TableHead className="text-right">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {batches.map((batch) => (
                <Fragment key={batch.id}>
                  <TableRow>
                    <TableCell className="font-medium">
                      {batch.deliveryNumber}
                    </TableCell>
                    <TableCell>{formatShortDate(batch.deliveryDate)}</TableCell>
                    <TableCell>{batch.supplierCode}</TableCell>
                    <TableCell>{batch.itemCode}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {batch.packingQty}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {batch.qtyDelivery}
                    </TableCell>
                    <TableCell>{batch.lotNo}</TableCell>
                    <TableCell className="text-right">
                      <Button
                        className="px-0"
                        onClick={() =>
                          setExpandedId(expandedId === batch.id ? null : batch.id)
                        }
                        type="button"
                        variant="link"
                      >
                        {batch.labelCount} box
                        <ChevronRightIcon data-icon="inline-end" />
                      </Button>
                    </TableCell>
                    <TableCell>
                      {batch.qrGenerated ? (
                        <Badge variant="secondary">
                          <CheckCircle2Icon data-icon="inline-start" />
                          Siap
                        </Badge>
                      ) : (
                        <Badge variant="outline">Belum</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button disabled size="sm" type="button" variant="outline">
                        Verifikasi
                      </Button>
                    </TableCell>
                  </TableRow>
                  {expandedId === batch.id ? (
                    <TableRow>
                      <TableCell colSpan={10}>
                        <div className="flex flex-wrap gap-2">
                          {batch.boxNumbers.map((boxNumber) => (
                            <span
                              className="bg-muted rounded-md px-2 py-1 font-mono text-sm"
                              key={boxNumber}
                            >
                              {boxNumber}
                            </span>
                          ))}
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : null}
                </Fragment>
              ))}
            </TableBody>
          </Table>
        </div>
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
git add src/features/label-boxes/components/label-box-batch-table.tsx
git commit -m "feat: add the label box batch table"
```

---

### Task 10: Halaman scan

Halaman berhenti memuat data packing session dan beralih memuat batch. `PackingScanConsole` tidak lagi dirender.

**Files:**
- Rewrite: `src/app/(operator)/scan/page.tsx`

- [ ] **Step 1: Ganti seluruh isi file**

```tsx
import { CircleAlertIcon } from "lucide-react"

import {
  LabelBoxBatchTable,
  type LabelBoxBatchRow,
} from "@/features/label-boxes/components/label-box-batch-table"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { requireOperator } from "@/features/auth/server"
import { createClient } from "@/lib/supabase/server"

export default async function ScanPage() {
  await requireOperator()
  const supabase = await createClient()

  const [batchesResult, masterItemsResult, boxesResult, suppliersResult] =
    await Promise.all([
      supabase
        .from("label_box_batches")
        .select(
          "id, master_item_row_no, packing_qty, qty_delivery, lot_no, label_count, qr_generated_at, created_at, delivery_numbers(delivery_number, delivery_date), suppliers(supplier_code), master_items(item_code), label_boxes(box_number, set_no, box_no)",
        )
        .order("created_at", { ascending: false }),
      supabase
        .from("master_items")
        .select("id, item_code, part_no, default_label_qty, supplier_id")
        .eq("is_active", true)
        .order("item_code"),
      supabase.from("boxes").select("id, master_item_id"),
      supabase
        .from("suppliers")
        .select("id, supplier_code")
        .eq("is_active", true)
        .order("supplier_code"),
    ])

  const dataError =
    batchesResult.error ??
    masterItemsResult.error ??
    boxesResult.error ??
    suppliersResult.error

  const boxRows = boxesResult.data ?? []
  const masterItems = (masterItemsResult.data ?? [])
    .filter((item) => boxRows.some((box) => box.master_item_id === item.id))
    .map((item) => ({
      id: item.id,
      itemCode: item.item_code,
      packingQty: item.default_label_qty,
      partNo: item.part_no,
      supplierId: item.supplier_id,
    }))

  const suppliers = (suppliersResult.data ?? []).map((supplier) => ({
    id: supplier.id,
    supplierCode: supplier.supplier_code,
  }))

  const batches = (batchesResult.data ?? [])
    .map(toLabelBoxBatchRow)
    .filter((batch): batch is LabelBoxBatchRow => batch !== null)

  return (
    <div className="flex w-full flex-col gap-6">
      {dataError ? (
        <Alert variant="destructive">
          <CircleAlertIcon />
          <AlertTitle>Data label box tidak dapat dimuat</AlertTitle>
          <AlertDescription>
            Periksa koneksi Supabase atau izin operator.
          </AlertDescription>
        </Alert>
      ) : null}
      <LabelBoxBatchTable
        batches={batches}
        masterItems={masterItems}
        suppliers={suppliers}
      />
    </div>
  )
}

type LabelBoxBatchQuery = {
  id: string
  packing_qty: number
  qty_delivery: number
  lot_no: string
  label_count: number
  qr_generated_at: string | null
  delivery_numbers: { delivery_number: string; delivery_date: string } | null
  suppliers: { supplier_code: string } | null
  master_items: { item_code: string } | null
  label_boxes: Array<{ box_number: string; set_no: number; box_no: number }>
}

function toLabelBoxBatchRow(
  batch: LabelBoxBatchQuery | null,
): LabelBoxBatchRow | null {
  if (!batch?.delivery_numbers || !batch.suppliers || !batch.master_items) {
    return null
  }

  return {
    boxNumbers: [...batch.label_boxes]
      .sort((left, right) =>
        left.set_no === right.set_no
          ? left.box_no - right.box_no
          : left.set_no - right.set_no,
      )
      .map((labelBox) => labelBox.box_number),
    deliveryDate: batch.delivery_numbers.delivery_date,
    deliveryNumber: batch.delivery_numbers.delivery_number,
    id: batch.id,
    itemCode: batch.master_items.item_code,
    labelCount: batch.label_count,
    lotNo: batch.lot_no,
    packingQty: batch.packing_qty,
    qrGenerated: batch.qr_generated_at !== null,
    qtyDelivery: batch.qty_delivery,
    supplierCode: batch.suppliers.supplier_code,
  }
}
```

- [ ] **Step 2: Typecheck dan lint**

Run: `npx tsc --noEmit -p tsconfig.json`
Diharapkan: tidak ada error. Kalau Supabase mengembalikan relasi sebagai array (bukan objek), sesuaikan `LabelBoxBatchQuery` menjadi array dan ambil elemen pertama di `toLabelBoxBatchRow` — pola yang sama dipakai `toActivePackingSession` sebelumnya.

Run: `npx eslint "src/app/(operator)/scan" src/features/label-boxes --max-warnings=0`
Diharapkan: tidak ada output.

- [ ] **Step 3: Commit**

```bash
git add "src/app/(operator)/scan/page.tsx"
git commit -m "feat: turn the scan page into the label box batch table"
```

---

### Task 11: Verifikasi menyeluruh

**Files:** tidak ada perubahan kode, kecuali perbaikan yang muncul dari kegagalan.

- [ ] **Step 1: Jalankan seluruh unit test**

Run: `npx vitest run`
Diharapkan: semua file lulus.

- [ ] **Step 2: Jalankan pgTAP yang relevan**

```bash
node scripts/run-pgtap.mjs supabase/tests/database/019_label_box_batch.test.sql
node scripts/run-pgtap.mjs supabase/tests/database/014_phase_5_packing_session_scan.test.sql
node scripts/run-pgtap.mjs supabase/tests/database/015_phase_6_finalize.test.sql
node scripts/run-pgtap.mjs supabase/tests/database/017_master_item_code_autogen.test.sql
node scripts/run-pgtap.mjs supabase/tests/database/018_box_owned_by_master_item.test.sql
```

Diharapkan: `PASS` untuk kelimanya.

- [ ] **Step 3: Lint seluruh area yang tersentuh**

Run: `npx eslint "src/app/(operator)/scan" src/features/label-boxes src/lib/label --max-warnings=0`
Diharapkan: tidak ada output.

- [ ] **Step 4: Build produksi**

Run: `npx next build`
Diharapkan: build selesai tanpa error. Ini menangkap masalah import client/server yang lolos dari `tsc`.

- [ ] **Step 5: Commit perbaikan bila ada**

```bash
git add -- src supabase
git commit -m "fix: address verification findings for the label box batch flow"
```

Kalau tidak ada yang perlu diperbaiki, lewati langkah ini.

---

## Verifikasi manual (dijalankan user)

Alur ini butuh kredensial operator, jadi tetap terbuka sampai dijalankan:

- [ ] Tekan Tambah: dropdown supplier terisi, daftar Master Item menyempit ke supplier terpilih, Packing Qty terisi otomatis dan terkunci
- [ ] Simpan dengan Qty Delivery 100 dan Packing Qty 100: muncul B101, B201, B301 beserta tiga payload QR dan satu QR kecil
- [ ] Simpan dengan Qty Delivery 200: muncul enam nomor, set kedua berakhiran 02
- [ ] Simpan dengan Qty Delivery 150: ditolak dengan pesan kelipatan
- [ ] Tekan Selesai: dialog tertutup, baris baru muncul di tabel dengan jumlah label dan tanda QR siap
- [ ] Buka kolom Label: seluruh nomor box tampil
- [ ] Scan QR kecil di layar dengan scanner: terbaca `kodeSupplier|partNo|packingQty|noUrutMasterItem|lotNo|noBox|tanggal`
