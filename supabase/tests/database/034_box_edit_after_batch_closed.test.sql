-- Box dan Layer boleh disunting setelah kirimannya selesai.
--
-- Yang dijaga file ini tiga hal. Pertama, batch yang masih terbuka mengunci dan
-- batch yang sudah ditutup melepas -- termasuk melepas sesi yang statusnya
-- tertinggal di 'print_failed', karena sesi hanya menjadi 'confirmed' ketika
-- print job-nya selesai. Kedua, daftar produk sebuah layer boleh dikosongkan.
-- Ketiga, Box yang pernah dikirim diarsipkan alih-alih dihapus, dan slotnya
-- boleh dipakai Box baru.
-- Migrasi: supabase/migrations/20260903025809_box_edit_after_batch_closed.sql

begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;

select plan(14);

insert into auth.users (
  id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '9e400000-0000-0000-0000-000000000001',
  'authenticated', 'authenticated', 'box-edit-admin@example.test',
  '{}'::jsonb, '{}'::jsonb, now(), now()
);

insert into public.profiles (id, display_name, role, is_active) values (
  '9e400000-0000-0000-0000-000000000001', 'Box Edit Admin', 'admin', true
);

insert into public.suppliers (id, supplier_code, supplier_name, is_active) values (
  '9e400000-0000-0000-0000-000000000010', 'SUPBOX', 'Supplier Box', true
);

insert into public.master_items (
  id, item_code, part_no, part_name, unit, default_label_qty, supplier_id
) values (
  '9e400000-0000-0000-0000-000000000020',
  'mstritem-boxedit', 'BOXEDIT-1', 'Part Box Edit', 'Pcs', 100,
  '9e400000-0000-0000-0000-000000000010'
);

insert into public.products (
  id, product_code, part_name, outer_diameter, inner_diameter, length, is_active
) values (
  '9e400000-0000-0000-0000-000000000060', 'boxedit-a', 'VO-B', 10, 5, 20, true
), (
  '9e400000-0000-0000-0000-000000000061', 'boxedit-b', 'VO-G', 12, 6, 24, true
);

insert into public.delivery_numbers (
  id, supplier_id, delivery_number, delivery_date, status, created_by
) values (
  '9e400000-0000-0000-0000-000000000030',
  '9e400000-0000-0000-0000-000000000010',
  'DN-BOXEDIT-0001', date '2026-08-26', 'active',
  '9e400000-0000-0000-0000-000000000001'
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub', '9e400000-0000-0000-0000-000000000001', true
);

-- Box dan layernya dibuat lewat RPC-nya sendiri: kalau pembuatannya berubah,
-- tes ini ikut memakai bentuk barunya.
select public.create_master_item_box('9e400000-0000-0000-0000-000000000020');

select public.create_box_layer(
  (select id from public.boxes
   where master_item_id = '9e400000-0000-0000-0000-000000000020')
);

reset role;

-- Batch dirakit langsung, bukan lewat create_label_box_batch: yang diuji di
-- sini aturan penguncian, bukan perakitan batchnya.
insert into public.label_box_batches (
  id, delivery_number_id, supplier_id, master_item_id, master_item_row_no,
  packing_qty, qty_delivery, lot_no, operator_name, label_count, created_by,
  supplier_code_snapshot, item_code_snapshot, part_no_snapshot,
  part_name_snapshot, delivery_number_snapshot, delivery_date_snapshot,
  packing_date
) values (
  '9e400000-0000-0000-0000-000000000040',
  '9e400000-0000-0000-0000-000000000030',
  '9e400000-0000-0000-0000-000000000010',
  '9e400000-0000-0000-0000-000000000020',
  1, 100, 100, 'LOT-BOXEDIT', 'OP-BOXEDIT', 1,
  '9e400000-0000-0000-0000-000000000001',
  'SUPBOX', 'mstritem-boxedit', 'BOXEDIT-1', 'Part Box Edit',
  'DN-BOXEDIT-0001', date '2026-08-26', date '2026-08-20'
);

set local role authenticated;

-- 1. Batch terbuka mengunci --------------------------------------------------

select throws_ok(
  $$ select public.save_box_layer_requirements(
    (select layer.id from public.box_layers layer
     join public.boxes box on box.id = layer.box_id
     where box.master_item_id = '9e400000-0000-0000-0000-000000000020'),
    '[{"product_id": "9e400000-0000-0000-0000-000000000060", "expected_qty": 1}]'::jsonb
  ) $$,
  'MASTER_ITEM_BOX_IN_USE',
  'an open batch still locks the box layer'
);

-- 2. Batch tertutup melepas --------------------------------------------------

reset role;
update public.label_box_batches
set closed_at = now(), closed_by = '9e400000-0000-0000-0000-000000000001'
where id = '9e400000-0000-0000-0000-000000000040';
set local role authenticated;

select lives_ok(
  $$ select public.save_box_layer_requirements(
    (select layer.id from public.box_layers layer
     join public.boxes box on box.id = layer.box_id
     where box.master_item_id = '9e400000-0000-0000-0000-000000000020'),
    '[{"product_id": "9e400000-0000-0000-0000-000000000060", "expected_qty": 1}]'::jsonb
  ) $$,
  'a closed batch no longer locks the box layer'
);

select is(
  (select count(*)::integer from public.box_layer_requirements requirement
   join public.box_layers layer on layer.id = requirement.box_layer_id
   join public.boxes box on box.id = layer.box_id
   where box.master_item_id = '9e400000-0000-0000-0000-000000000020'),
  1,
  'the product the admin ticked is stored'
);

-- 3. Sesi yang tertinggal di batch tertutup ikut dilepas ---------------------
--
-- Sesi hanya menjadi 'confirmed' ketika print job-nya selesai, dan
-- close_label_box_batch justru membuat sesi 'scanning' untuk box yang tidak
-- pernah discan. Tanpa aturan ini satu cetak gagal mengunci Box selamanya.

reset role;
insert into public.packing_sessions (
  id, operator_id, master_item_id, box_id, delivery_number_id, qty_delivery,
  lot_no, status
)
select
  '9e400000-0000-0000-0000-000000000050',
  '9e400000-0000-0000-0000-000000000001',
  '9e400000-0000-0000-0000-000000000020',
  box.id,
  '9e400000-0000-0000-0000-000000000030',
  100, 'LOT-BOXEDIT', 'print_failed'
from public.boxes box
where box.master_item_id = '9e400000-0000-0000-0000-000000000020';

insert into public.label_boxes (
  batch_id, box_id, box_no, set_no, box_number, qr_payload, packing_session_id
)
select
  '9e400000-0000-0000-0000-000000000040',
  box.id, box.box_no, 1, 'BOXEDIT-B1-01', 'QR-BOXEDIT-1',
  '9e400000-0000-0000-0000-000000000050'
from public.boxes box
where box.master_item_id = '9e400000-0000-0000-0000-000000000020';
set local role authenticated;

select lives_ok(
  $$ select public.save_box_layer_requirements(
    (select layer.id from public.box_layers layer
     join public.boxes box on box.id = layer.box_id
     where box.master_item_id = '9e400000-0000-0000-0000-000000000020'),
    '[{"product_id": "9e400000-0000-0000-0000-000000000061", "expected_qty": 1}]'::jsonb
  ) $$,
  'a print_failed session inside a closed batch does not lock the box'
);

-- 4. Sesi berjalan yang tidak berasal dari batch tertutup tetap mengunci ------

reset role;
insert into public.packing_sessions (
  id, operator_id, master_item_id, box_id, delivery_number_id, qty_delivery,
  lot_no, status
)
select
  '9e400000-0000-0000-0000-000000000051',
  '9e400000-0000-0000-0000-000000000001',
  '9e400000-0000-0000-0000-000000000020',
  box.id,
  '9e400000-0000-0000-0000-000000000030',
  100, 'LOT-BOXEDIT', 'scanning'
from public.boxes box
where box.master_item_id = '9e400000-0000-0000-0000-000000000020';
set local role authenticated;

select throws_ok(
  $$ select public.save_box_layer_requirements(
    (select layer.id from public.box_layers layer
     join public.boxes box on box.id = layer.box_id
     where box.master_item_id = '9e400000-0000-0000-0000-000000000020'),
    '[{"product_id": "9e400000-0000-0000-0000-000000000060", "expected_qty": 1}]'::jsonb
  ) $$,
  'MASTER_ITEM_BOX_IN_USE',
  'a running session that no closed batch claims still locks the box'
);

reset role;
delete from public.packing_sessions
where id = '9e400000-0000-0000-0000-000000000051';
set local role authenticated;

-- 5. Layer boleh dikosongkan -------------------------------------------------

select lives_ok(
  $$ select public.save_box_layer_requirements(
    (select layer.id from public.box_layers layer
     join public.boxes box on box.id = layer.box_id
     where box.master_item_id = '9e400000-0000-0000-0000-000000000020'),
    '[]'::jsonb
  ) $$,
  'unticking every product is a change the layer accepts'
);

select is(
  (select count(*)::integer from public.box_layer_requirements requirement
   join public.box_layers layer on layer.id = requirement.box_layer_id
   join public.boxes box on box.id = layer.box_id
   where box.master_item_id = '9e400000-0000-0000-0000-000000000020'),
  0,
  'the emptied layer asks for no product at all'
);

-- 6. Tambah dan hapus layer ikut terbuka ------------------------------------

select lives_ok(
  $$ select public.create_box_layer(
    (select id from public.boxes
     where master_item_id = '9e400000-0000-0000-0000-000000000020')
  ) $$,
  'a closed batch no longer blocks adding a layer'
);

select lives_ok(
  $$ select public.delete_box_layer(
    (select layer.id from public.box_layers layer
     join public.boxes box on box.id = layer.box_id
     where box.master_item_id = '9e400000-0000-0000-0000-000000000020'
     order by layer.layer_no desc limit 1)
  ) $$,
  'a closed batch no longer blocks deleting the last layer'
);

-- 7. Box berjejak diarsipkan, bukan dihapus ---------------------------------

select lives_ok(
  $$ select public.delete_master_item_box(
    (select id from public.boxes
     where master_item_id = '9e400000-0000-0000-0000-000000000020')
  ) $$,
  'a box whose shipment is finished can be deleted'
);

select isnt(
  (select deleted_at from public.boxes
   where master_item_id = '9e400000-0000-0000-0000-000000000020'),
  null,
  'the box that shipped is archived rather than removed'
);

select is(
  (select count(*)::integer from public.label_boxes box
   where box.batch_id = '9e400000-0000-0000-0000-000000000040'),
  1,
  'the label box printed from it still points at the archived row'
);

-- 8. Slot Box yang diarsipkan boleh dipakai lagi ----------------------------

select is(
  (select box_no from public.create_master_item_box(
    '9e400000-0000-0000-0000-000000000020'
  )),
  1,
  'the archived box gives its slot back to a new box'
);

-- 9. Box tanpa jejak tetap dihapus betulan ----------------------------------

select public.delete_master_item_box(
  (select id from public.boxes
   where master_item_id = '9e400000-0000-0000-0000-000000000020'
     and deleted_at is null)
);

select is(
  (select count(*)::integer from public.boxes box
   where box.master_item_id = '9e400000-0000-0000-0000-000000000020'
     and box.deleted_at is null),
  0,
  'a box that never shipped is removed outright'
);

reset role;

select * from finish();

rollback;
