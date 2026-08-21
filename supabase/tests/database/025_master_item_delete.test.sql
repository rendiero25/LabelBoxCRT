-- Hapus Master Item: yang belum pernah dipakai kirim benar-benar dihapus
-- bersama Box Definition dan product mapping miliknya; yang sudah punya
-- riwayat ditandai terhapus sehingga hilang dari semua daftar, sementara batch
-- label box dan packing sessionnya tetap utuh dengan data lamanya.
--
-- Bagian kedua file ini menjaga agar Master Item terhapus tidak bisa hidup
-- kembali: set_master_item_active menolaknya, dan setiap jalur yang dulu hanya
-- menyaring is_active kini ikut menyaring deleted_at.
--
-- Migrasi: supabase/migrations/20260819200000_master_item_soft_delete.sql
--          supabase/migrations/20260821011651_master_item_deleted_stays_deleted.sql

begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;

select plan(23);

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

-- Produk kedua dipakai bagian kedua file ini: ia belum pernah dipetakan ke
-- Master Item mana pun, jadi setiap penolakan yang muncul benar-benar datang
-- dari Master Item-nya, bukan dari mapping yang kebetulan sudah ada.
insert into public.products (
  id, product_code, part_name, outer_diameter, inner_diameter, length, is_active
) values (
  '9d900000-0000-0000-0000-000000000016', 'delprod-02', 'Delete Product Two',
  8, 9, 455, true
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

-- Definisi milik Master Item berriwayat ini tidak ikut dibuang saat ia
-- diarsipkan, jadi ia masih punya Box, layer, dan mapping sesudahnya -- persis
-- keadaan yang dipakai bagian kedua file ini.
insert into public.boxes (id, master_item_id, box_no, box_code, box_name) values (
  '9d900000-0000-0000-0000-000000000031',
  '9d900000-0000-0000-0000-000000000021',
  1, 'del-box-02', 'Box 1'
);

insert into public.box_layers (id, box_id, layer_no, layer_name, sort_order) values (
  '9d900000-0000-0000-0000-000000000041',
  '9d900000-0000-0000-0000-000000000031',
  1, 'Layer 1', 1
);

insert into public.box_layer_requirements (
  box_layer_id, product_id, expected_qty, sort_order
) values (
  '9d900000-0000-0000-0000-000000000041',
  '9d900000-0000-0000-0000-000000000015',
  1,
  1
);

insert into public.master_item_products (
  id, master_item_id, product_id, is_active
) values (
  '9d900000-0000-0000-0000-000000000070',
  '9d900000-0000-0000-0000-000000000021',
  '9d900000-0000-0000-0000-000000000015',
  false
);

-- Pembanding yang masih hidup: apa pun yang ditolak untuk Master Item terhapus
-- harus tetap berjalan untuk Master Item biasa.
insert into public.master_items (
  id, item_code, part_no, part_name, unit, default_label_qty, supplier_id
) values (
  '9d900000-0000-0000-0000-000000000022',
  'del-live',
  'DEL-LIVE',
  'Delete Live',
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
  packing_qty, qty_delivery, lot_no, operator_name, label_count, created_by,
  supplier_code_snapshot, item_code_snapshot, part_no_snapshot,
  part_name_snapshot, delivery_number_snapshot, delivery_date_snapshot,
  packing_date, closed_at
) values (
  '9d900000-0000-0000-0000-000000000060',
  '9d900000-0000-0000-0000-000000000050',
  '9d900000-0000-0000-0000-000000000010',
  '9d900000-0000-0000-0000-000000000021',
  1, 100, 100, 'LOT-DELETE', 'OP-DELETE', 1,
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

-- Master Item terhapus tidak boleh dihidupkan kembali. Menyalakan is_active-nya
-- akan mengembalikannya ke setiap jalur yang menyaring is_active saja, padahal
-- ia sudah hilang dari semua daftar dan tidak lagi punya nomor urut.
select throws_ok(
  $$ select public.set_master_item_active('9d900000-0000-0000-0000-000000000021', true) $$,
  'MASTER_ITEM_NOT_FOUND',
  'a deleted master item cannot be switched back on'
);

select is(
  (select is_active from public.master_items
   where id = '9d900000-0000-0000-0000-000000000021'),
  false,
  'the refused reactivation leaves it deactivated'
);

-- Mematikannya pun tidak ada artinya: bagi RPC ini baris terhapus sudah tidak
-- ada, sama seperti pada update_master_item dan delete_master_item.
select throws_ok(
  $$ select public.set_master_item_active('9d900000-0000-0000-0000-000000000021', false) $$,
  'MASTER_ITEM_NOT_FOUND',
  'and it is missing either way round, not just for reactivation'
);

select lives_ok(
  $$ select public.set_master_item_active('9d900000-0000-0000-0000-000000000022', false) $$,
  'a master item that is still there can still be switched off'
);

-- Sisa berkas ini memaksa keadaan yang dulu bisa dibuat set_master_item_active:
-- baris terhapus yang is_active-nya menyala. Setiap jalur yang hanya membaca
-- is_active akan menerimanya kembali sebagai Master Item yang sah, jadi jalur
-- itu harus ikut membaca deleted_at -- bukan bersandar pada satu RPC saja.
reset role;
update public.master_items
set is_active = true
where id = '9d900000-0000-0000-0000-000000000021';
set local role authenticated;

select throws_ok(
  $$ select * from public.create_master_item_box('9d900000-0000-0000-0000-000000000021') $$,
  'MASTER_ITEM_BOX_MASTER_ITEM_NOT_FOUND',
  'no new box definition can be hung on a deleted master item'
);

select ok(
  (select 'Master Item aktif tidak ditemukan.' = any(preview.errors)
   from public.preview_csv_import(
     'product_mapping',
     $$[{"line": "2", "item_code": "del-shipped", "product_code": "delprod-02"}]$$::jsonb
   ) as preview),
  'the csv preview refuses a deleted master item as a mapping target'
);

select throws_ok(
  $sql$ select public.import_csv_master_data(
          'product_mapping',
          $$[{"line": "2", "item_code": "del-shipped", "product_code": "delprod-02"}]$$::jsonb,
          '9d900000-0000-0000-0000-000000000090'
        ) $sql$,
  'CSV_IMPORT_PREVIEW_INVALID',
  'and the import behind it stops on the same row'
);

select throws_ok(
  $$ select public.create_master_item_product_mapping(
       '9d900000-0000-0000-0000-000000000021',
       '9d900000-0000-0000-0000-000000000016'
     ) $$,
  'PRODUCT_MAPPING_MASTER_ITEM_NOT_FOUND',
  'a deleted master item cannot take a new product mapping'
);

select throws_ok(
  $$ select public.set_master_item_product_active('9d900000-0000-0000-0000-000000000070', true) $$,
  'PRODUCT_MAPPING_INPUT_INVALID',
  'and the mapping it already had cannot be switched back on'
);

-- Jaring terakhir di ujung jalur scan: sesi yang menunjuk Master Item terhapus
-- ditolak sebelum satu scan pun tercatat.
reset role;
insert into public.packing_sessions (
  id, operator_id, master_item_id, box_id, status
) values (
  '9d900000-0000-0000-0000-000000000080',
  '9d900000-0000-0000-0000-000000000001',
  '9d900000-0000-0000-0000-000000000021',
  '9d900000-0000-0000-0000-000000000031',
  'scanning'
);
set local role authenticated;

select throws_ok(
  $$ select * from public.accept_packing_scan(
       '9d900000-0000-0000-0000-000000000080',
       'DELSUP|DEL-SHIPPED|100|1-LOT-DELETE-B101|260826',
       'hash-delete-0001',
       '6x7x455',
       '6x7x455'
     ) $$,
  'MASTER_ITEM_NOT_ACTIVE',
  'a scan against a deleted master item is refused'
);

reset role;

select * from finish();

rollback;
