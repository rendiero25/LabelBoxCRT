-- Nomor urut Master Item bersifat dinamis: posisi Master Item di dalam daftar
-- yang diurutkan item_code, dihitung saat batch label box dibuat. Nomor itulah
-- yang tercetak di QR, dan view master_item_row_numbers memberi angka yang
-- sama kepada layar.
-- Migrasi: supabase/migrations/20260819180000_master_item_dynamic_row_no.sql

begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;

select plan(6);

insert into auth.users (
  id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '9d800000-0000-0000-0000-000000000001',
  'authenticated',
  'authenticated',
  'dynamic-row-no-admin@example.test',
  '{}'::jsonb,
  '{}'::jsonb,
  now(),
  now()
);

insert into public.profiles (id, display_name, role, is_active) values (
  '9d800000-0000-0000-0000-000000000001',
  'Dynamic Row No Admin',
  'admin',
  true
);

insert into public.suppliers (id, supplier_code, supplier_name, is_active) values (
  '9d800000-0000-0000-0000-000000000010', 'DYNSUP', 'Dynamic Supplier', true
);

insert into public.master_items (
  id, item_code, part_no, part_name, unit, default_label_qty, supplier_id
) values (
  '9d800000-0000-0000-0000-000000000020',
  'zzz-dynamic',
  'DYN-PART',
  'Dynamic Part',
  'Pcs',
  100,
  '9d800000-0000-0000-0000-000000000010'
);

insert into public.boxes (id, master_item_id, box_no, box_code, box_name) values (
  '9d800000-0000-0000-0000-000000000030',
  '9d800000-0000-0000-0000-000000000020',
  1,
  'dyn-box-01',
  'Box 1'
);

select set_config(
  'request.jwt.claim.sub',
  '9d800000-0000-0000-0000-000000000001',
  true
);
set local role authenticated;

-- Kode item 'zzz-dynamic' berada di urutan terakhir, jadi nomornya sama dengan
-- jumlah seluruh Master Item.
select is(
  (
    select row_no from public.master_item_row_numbers
    where master_item_id = '9d800000-0000-0000-0000-000000000020'
  ),
  (select count(*)::integer from public.master_items),
  'the view ranks a master item by its item code'
);

create temporary table dynamic_batch as
select batch_id, master_item_row_no
from public.create_label_box_batch(
  '9d800000-0000-0000-0000-000000000010',
  'DN-DYNAMIC-0001',
  date '2026-08-26',
  date '2026-08-20',
  '9d800000-0000-0000-0000-000000000020',
  100,
  'LOT-DYNAMIC',
  'OP-DYNAMIC'
);

grant select on table dynamic_batch to authenticated;

select is(
  (select master_item_row_no from dynamic_batch),
  (
    select row_no from public.master_item_row_numbers
    where master_item_id = '9d800000-0000-0000-0000-000000000020'
  ),
  'the batch takes the number the view shows on screen'
);

-- Yang tercetak di QR adalah nomor itu juga, sebagai field keempat.
select is(
  (
    select split_part(box.qr_payload, '|', 4)
    from public.label_boxes box
    where box.batch_id = (select batch_id from dynamic_batch)
      and box.box_number = 'B101'
  ),
  (select master_item_row_no from dynamic_batch)::text || '-LOT-DYNAMIC-B101',
  'the QR payload prints that number'
);

reset role;
insert into public.master_items (
  item_code, part_no, part_name, unit, default_label_qty, supplier_id
) values (
  'aaa-dynamic',
  'DYN-PART-EARLIER',
  'Dynamic Part Earlier',
  'Pcs',
  100,
  '9d800000-0000-0000-0000-000000000010'
);
set local role authenticated;

-- Inti dari nomor dinamis: Master Item yang kodenya lebih awal menggeser nomor
-- yang di bawahnya.
select is(
  (
    select row_no from public.master_item_row_numbers
    where master_item_id = '9d800000-0000-0000-0000-000000000020'
  ),
  (select master_item_row_no + 1 from dynamic_batch),
  'a master item added ahead of it shifts the number up'
);

-- Batch yang sudah ada memakai salinannya sendiri, jadi QR yang sudah tercetak
-- tidak ikut bergeser.
select is(
  (select master_item_row_no from public.label_box_batches
   where id = (select batch_id from dynamic_batch)),
  (select master_item_row_no from dynamic_batch),
  'the existing batch keeps the number it was created with'
);

select is(
  (
    select split_part(box.qr_payload, '|', 4)
    from public.label_boxes box
    where box.batch_id = (select batch_id from dynamic_batch)
      and box.box_number = 'B101'
  ),
  (select master_item_row_no from dynamic_batch)::text || '-LOT-DYNAMIC-B101',
  'the QR already generated keeps its number too'
);

reset role;

select * from finish();

rollback;
