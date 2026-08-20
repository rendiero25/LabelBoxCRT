-- Master Item boleh disunting setelah pekerjaannya selesai: batch yang masih
-- terbuka dan sesi yang masih berjalan mengunci, batch yang sudah ditutup
-- tidak. Salinan data di batch lama tidak ikut berubah saat Master Item-nya
-- disunting.
-- Migrasi: supabase/migrations/20260819140000_master_item_editable_after_batch_closed.sql

begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;

select plan(7);

insert into auth.users (
  id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '9d400000-0000-0000-0000-000000000001',
  'authenticated',
  'authenticated',
  'master-item-edit-admin@example.test',
  '{}'::jsonb,
  '{}'::jsonb,
  now(),
  now()
);

insert into public.profiles (id, display_name, role, is_active) values (
  '9d400000-0000-0000-0000-000000000001',
  'Master Item Edit Admin',
  'admin',
  true
);

insert into public.suppliers (id, supplier_code, supplier_name, is_active) values (
  '9d400000-0000-0000-0000-000000000010', 'SUPEDIT', 'Supplier Edit', true
);

insert into public.master_items (
  id, item_code, part_no, part_name, unit, default_label_qty, supplier_id
) values (
  '9d400000-0000-0000-0000-000000000020',
  'mstritem-edit',
  'EDIT-BEFORE',
  'Part Sebelum Edit',
  'Pcs',
  100,
  '9d400000-0000-0000-0000-000000000010'
);

insert into public.delivery_numbers (
  id, supplier_id, delivery_number, delivery_date, status, created_by
) values (
  '9d400000-0000-0000-0000-000000000030',
  '9d400000-0000-0000-0000-000000000010',
  'DN-EDIT-0001',
  date '2026-08-26',
  'active',
  '9d400000-0000-0000-0000-000000000001'
);

-- Batch dirakit langsung, bukan lewat create_label_box_batch: yang diuji di
-- sini aturan penguncian dan salinan datanya, bukan perakitan batchnya.
insert into public.label_box_batches (
  id, delivery_number_id, supplier_id, master_item_id, master_item_row_no,
  packing_qty, qty_delivery, lot_no, operator_name, label_count, created_by,
  supplier_code_snapshot, item_code_snapshot, part_no_snapshot,
  part_name_snapshot, delivery_number_snapshot, delivery_date_snapshot,
  packing_date
) values (
  '9d400000-0000-0000-0000-000000000040',
  '9d400000-0000-0000-0000-000000000030',
  '9d400000-0000-0000-0000-000000000010',
  '9d400000-0000-0000-0000-000000000020',
  1, 100, 100, 'LOT-EDIT-1', 'OP-EDIT', 1,
  '9d400000-0000-0000-0000-000000000001',
  'SUPEDIT', 'mstritem-edit', 'EDIT-BEFORE', 'Part Sebelum Edit',
  'DN-EDIT-0001', date '2026-08-26', date '2026-08-20'
);

select set_config(
  'request.jwt.claim.sub',
  '9d400000-0000-0000-0000-000000000001',
  true
);
set local role authenticated;

select has_column(
  'public',
  'label_box_batches',
  'part_name_snapshot',
  'a batch keeps the part name that was current when it was created'
);

-- Batch yang masih terbuka berarti masih ada box yang belum selesai; datanya
-- masih akan dibaca saat job cetaknya dibuat.
select throws_ok(
  $$ select public.update_master_item(
    '9d400000-0000-0000-0000-000000000020',
    'EDIT-AFTER',
    'Part Sesudah Edit',
    'Pcs',
    100,
    '9d400000-0000-0000-0000-000000000010'
  ) $$,
  'MASTER_ITEM_IN_USE',
  'an open batch still locks the master item'
);

reset role;
update public.label_box_batches
set closed_at = now(), closed_by = '9d400000-0000-0000-0000-000000000001'
where id = '9d400000-0000-0000-0000-000000000040';
set local role authenticated;

select lives_ok(
  $$ select public.update_master_item(
    '9d400000-0000-0000-0000-000000000020',
    'EDIT-AFTER',
    'Part Sesudah Edit',
    'Pcs',
    100,
    '9d400000-0000-0000-0000-000000000010'
  ) $$,
  'a closed batch no longer locks the master item'
);

select is(
  (select part_no from public.master_items
   where id = '9d400000-0000-0000-0000-000000000020'),
  'EDIT-AFTER',
  'the master item carries the edited part no'
);

-- Inti aturannya: label box lama tetap memakai data lamanya.
select is(
  (select part_no_snapshot from public.label_box_batches
   where id = '9d400000-0000-0000-0000-000000000040'),
  'EDIT-BEFORE',
  'the closed batch keeps the part no it was created with'
);

select is(
  (select part_name_snapshot from public.label_box_batches
   where id = '9d400000-0000-0000-0000-000000000040'),
  'Part Sebelum Edit',
  'the closed batch keeps the part name it was created with'
);

reset role;
insert into public.packing_sessions (
  id, operator_id, master_item_id, box_id, delivery_number_id, qty_delivery,
  lot_no, status
)
select
  '9d400000-0000-0000-0000-000000000050',
  '9d400000-0000-0000-0000-000000000001',
  '9d400000-0000-0000-0000-000000000020',
  box.id,
  '9d400000-0000-0000-0000-000000000030',
  100,
  'LOT-EDIT-2',
  'scanning'
from public.boxes box
limit 1;
set local role authenticated;

-- Sesi yang masih berjalan tetap mengunci: menyunting di tengah scan berarti
-- satu batch memakai dua versi data.
select throws_ok(
  $$ select public.update_master_item(
    '9d400000-0000-0000-0000-000000000020',
    'EDIT-AGAIN',
    'Part Sesudah Edit',
    'Pcs',
    100,
    '9d400000-0000-0000-0000-000000000010'
  ) $$,
  'MASTER_ITEM_IN_USE',
  'a session still in progress locks the master item'
);

reset role;

select * from finish();

rollback;
