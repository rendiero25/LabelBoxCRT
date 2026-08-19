-- Hapus Master Item: yang belum pernah dipakai kirim benar-benar dihapus
-- bersama Box Definition dan product mapping miliknya; yang sudah punya
-- riwayat ditandai terhapus sehingga hilang dari semua daftar, sementara batch
-- label box dan packing sessionnya tetap utuh dengan data lamanya.
-- Migrasi: supabase/migrations/20260819200000_master_item_soft_delete.sql

begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;

select plan(13);

insert into auth.users (
  id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '9d900000-0000-0000-0000-000000000001',
  'authenticated',
  'authenticated',
  'delete-reason-admin@example.test',
  '{}'::jsonb,
  '{}'::jsonb,
  now(),
  now()
);

insert into public.profiles (id, display_name, role, is_active) values (
  '9d900000-0000-0000-0000-000000000001',
  'Delete Reason Admin',
  'admin',
  true
);

insert into public.suppliers (id, supplier_code, supplier_name, is_active) values (
  '9d900000-0000-0000-0000-000000000010', 'DELSUP', 'Delete Supplier', true
);

insert into public.products (
  id, product_code, part_name, outer_diameter, inner_diameter, length, is_active
) values (
  '9d900000-0000-0000-0000-000000000015', 'delprod-01', 'Delete Product',
  6, 7, 455, true
);

-- Master Item yang hanya punya definisi: Box, layer, kebutuhan produk, dan
-- product mapping, tanpa satu pun kiriman.
insert into public.master_items (
  id, item_code, part_no, part_name, unit, default_label_qty, supplier_id
) values (
  '9d900000-0000-0000-0000-000000000020',
  'del-unused',
  'DEL-UNUSED',
  'Delete Unused',
  'Pcs',
  100,
  '9d900000-0000-0000-0000-000000000010'
);

insert into public.boxes (id, master_item_id, box_no, box_code, box_name) values (
  '9d900000-0000-0000-0000-000000000030',
  '9d900000-0000-0000-0000-000000000020',
  1, 'del-box-01', 'Box 1'
);

insert into public.box_layers (id, box_id, layer_no, layer_name, sort_order) values (
  '9d900000-0000-0000-0000-000000000040',
  '9d900000-0000-0000-0000-000000000030',
  1, 'Layer 1', 1
);

insert into public.box_layer_requirements (
  box_layer_id, product_id, expected_qty, sort_order
) values (
  '9d900000-0000-0000-0000-000000000040',
  '9d900000-0000-0000-0000-000000000015',
  1,
  1
);

insert into public.master_item_products (master_item_id, product_id) values (
  '9d900000-0000-0000-0000-000000000020',
  '9d900000-0000-0000-0000-000000000015'
);

-- Master Item yang sudah pernah dipakai kirim.
insert into public.master_items (
  id, item_code, part_no, part_name, unit, default_label_qty, supplier_id
) values (
  '9d900000-0000-0000-0000-000000000021',
  'del-shipped',
  'DEL-SHIPPED',
  'Delete Shipped',
  'Pcs',
  100,
  '9d900000-0000-0000-0000-000000000010'
);

insert into public.delivery_numbers (
  id, supplier_id, delivery_number, delivery_date, status, created_by
) values (
  '9d900000-0000-0000-0000-000000000050',
  '9d900000-0000-0000-0000-000000000010',
  'DN-DELETE-0001',
  date '2026-08-26',
  'active',
  '9d900000-0000-0000-0000-000000000001'
);

insert into public.label_box_batches (
  id, delivery_number_id, supplier_id, master_item_id, master_item_row_no,
  packing_qty, qty_delivery, lot_no, label_count, created_by,
  supplier_code_snapshot, item_code_snapshot, part_no_snapshot,
  part_name_snapshot, delivery_number_snapshot, delivery_date_snapshot,
  packing_date, closed_at
) values (
  '9d900000-0000-0000-0000-000000000060',
  '9d900000-0000-0000-0000-000000000050',
  '9d900000-0000-0000-0000-000000000010',
  '9d900000-0000-0000-0000-000000000021',
  1, 100, 100, 'LOT-DELETE', 1,
  '9d900000-0000-0000-0000-000000000001',
  'DELSUP', 'del-shipped', 'DEL-SHIPPED', 'Delete Shipped',
  'DN-DELETE-0001', date '2026-08-26', date '2026-08-20', now()
);

select set_config(
  'request.jwt.claim.sub',
  '9d900000-0000-0000-0000-000000000001',
  true
);
set local role authenticated;

-- Batch yang masih terbuka berarti kirimannya belum selesai; Master Item-nya
-- tidak boleh menghilang dari daftar di tengah pekerjaan itu.
reset role;
update public.label_box_batches
set closed_at = null
where id = '9d900000-0000-0000-0000-000000000060';
set local role authenticated;

select throws_ok(
  $$ select public.delete_master_item('9d900000-0000-0000-0000-000000000021') $$,
  'MASTER_ITEM_IN_USE',
  'an open batch holds the delete back'
);

select isnt(
  (select is_active from public.master_items
   where id = '9d900000-0000-0000-0000-000000000021'),
  false,
  'the refused delete leaves the master item untouched'
);

reset role;
update public.label_box_batches
set closed_at = now()
where id = '9d900000-0000-0000-0000-000000000060';
set local role authenticated;

select lives_ok(
  $$ select public.delete_master_item('9d900000-0000-0000-0000-000000000021') $$,
  'a master item whose shipments are all finished can be deleted'
);

-- Barisnya ditahan sebagai jangkar riwayat, tetapi bagi pemakainya ia hilang.
select isnt(
  (select deleted_at from public.master_items
   where id = '9d900000-0000-0000-0000-000000000021'),
  null,
  'the row stays as the anchor of that history, marked deleted'
);

select is(
  (select is_active from public.master_items
   where id = '9d900000-0000-0000-0000-000000000021'),
  false,
  'and it is deactivated, so no new batch can pick it'
);

select is_empty(
  $$ select 1 from public.master_item_row_numbers
     where master_item_id = '9d900000-0000-0000-0000-000000000021' $$,
  'a deleted master item no longer takes a sequence number'
);

-- Inti permintaannya: riwayat label box tetap utuh dengan data lamanya.
select is(
  (select part_no_snapshot from public.label_box_batches
   where id = '9d900000-0000-0000-0000-000000000060'),
  'DEL-SHIPPED',
  'the batch keeps the part no it was created with'
);

select is(
  (select count(*)::integer from public.label_box_batches
   where master_item_id = '9d900000-0000-0000-0000-000000000021'),
  1,
  'the label box history survives the delete'
);

-- Part No yang dilepas boleh dipakai ulang: baris lamanya tidak terlihat di
-- mana pun, jadi ia tidak boleh menghalangi pendaftaran baru.
select lives_ok(
  $$ select public.create_master_item('DEL-SHIPPED', 'Delete Shipped Again', 'Pcs', 100) $$,
  'the part no of a deleted master item can be registered again'
);

select lives_ok(
  $$ select public.delete_master_item('9d900000-0000-0000-0000-000000000020') $$,
  'a master item that was never shipped can be deleted'
);

select is_empty(
  $$ select 1 from public.master_items
     where id = '9d900000-0000-0000-0000-000000000020' $$,
  'that one is removed outright, not just marked'
);

select is_empty(
  $$ select 1 from public.boxes
     where master_item_id = '9d900000-0000-0000-0000-000000000020' $$,
  'its box definition, layers, and requirements go with it'
);

select is_empty(
  $$ select 1 from public.master_item_products
     where master_item_id = '9d900000-0000-0000-0000-000000000020' $$,
  'and its product mapping'
);

reset role;

select * from finish();

rollback;
