-- Sunting penuh label box: batch yang belum ditutup dirakit ulang dari data
-- baru -- nomor box, QR, hasil scan, dan job cetaknya dimulai dari awal --
-- sedangkan batch yang sudah ditutup menolak dirakit ulang.
-- Migrasi: supabase/migrations/20260819220000_rebuild_label_box_batch.sql

begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;

select plan(9);

insert into auth.users (
  id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '9dc00000-0000-0000-0000-000000000001',
  'authenticated',
  'authenticated',
  'rebuild-admin@example.test',
  '{}'::jsonb,
  '{}'::jsonb,
  now(),
  now()
);

insert into public.profiles (id, display_name, role, is_active) values (
  '9dc00000-0000-0000-0000-000000000001', 'Rebuild Admin', 'admin', true
);

insert into public.suppliers (id, supplier_code, supplier_name, is_active) values
  ('9dc00000-0000-0000-0000-000000000010', 'RBSUP1', 'Rebuild Supplier', true);

insert into public.master_items (
  id, item_code, part_no, part_name, unit, default_label_qty, supplier_id
) values
  (
    '9dc00000-0000-0000-0000-000000000020', 'rb-item-a', 'RB-PART-A',
    'Rebuild Part A', 'Pcs', 100, '9dc00000-0000-0000-0000-000000000010'
  ),
  (
    '9dc00000-0000-0000-0000-000000000021', 'rb-item-b', 'RB-PART-B',
    'Rebuild Part B', 'Pcs', 50, '9dc00000-0000-0000-0000-000000000010'
  );

insert into public.boxes (id, master_item_id, box_no, box_code, box_name) values
  ('9dc00000-0000-0000-0000-000000000030',
    '9dc00000-0000-0000-0000-000000000020', 1, 'rb-box-a1', 'Box A1'),
  ('9dc00000-0000-0000-0000-000000000031',
    '9dc00000-0000-0000-0000-000000000021', 1, 'rb-box-b1', 'Box B1');

select set_config(
  'request.jwt.claim.sub', '9dc00000-0000-0000-0000-000000000001', true
);
set local role authenticated;

select has_function(
  'public',
  'rebuild_label_box_batch',
  array['uuid', 'uuid', 'text', 'date', 'date', 'uuid', 'integer', 'text', 'text', 'integer'],
  'rebuild_label_box_batch takes every field the create form takes'
);

create temporary table original as
select batch_id, label_count
from public.create_label_box_batch(
  '9dc00000-0000-0000-0000-000000000010',
  'DN-REBUILD-0001',
  date '2026-08-26',
  date '2026-08-20',
  '9dc00000-0000-0000-0000-000000000020',
  100,
  'LOT-REBUILD-A',
  'OP-REBUILD-A',
  5000
);

grant select on table original to authenticated;

-- Scan yang sudah terjadi pada batch lama.
reset role;
with new_session as (
  insert into public.packing_sessions (
    operator_id, master_item_id, box_id, delivery_number_id, qty_delivery,
    lot_no, status
  )
  select
    '9dc00000-0000-0000-0000-000000000001',
    '9dc00000-0000-0000-0000-000000000020',
    '9dc00000-0000-0000-0000-000000000030',
    batch.delivery_number_id,
    100,
    'LOT-REBUILD-A',
    'scanning'
  from public.label_box_batches batch
  where batch.id = (select batch_id from original)
  returning id
)
update public.label_boxes box
set packing_session_id = (select id from new_session)
where box.batch_id = (select batch_id from original);
set local role authenticated;

select is(
  (select count(*)::integer from public.label_boxes
   where batch_id = (select batch_id from original)),
  1,
  'the original batch has one box'
);

create temporary table rebuilt as
select batch_id, label_count, master_item_row_no
from public.rebuild_label_box_batch(
  (select batch_id from original),
  '9dc00000-0000-0000-0000-000000000010',
  'DN-REBUILD-0002',
  date '2026-08-27',
  date '2026-08-21',
  '9dc00000-0000-0000-0000-000000000021',
  100,
  'LOT-REBUILD-B',
  'OP-REBUILD-B',
  7000
);

grant select on table rebuilt to authenticated;

select is(
  (select batch_id from rebuilt),
  (select batch_id from original),
  'the batch keeps its id, so links to it stay valid'
);

-- Master Item baru punya Qty/Box 50, jadi 100 keping jadi dua set.
select is(
  (select label_count from rebuilt),
  2,
  'the box count follows the new master item and qty'
);

select is(
  (select part_no_snapshot from public.label_box_batches
   where id = (select batch_id from original)),
  'RB-PART-B',
  'the batch snapshot follows the new master item'
);

select is(
  (select qty_delivery_display from public.label_box_batches
   where id = (select batch_id from original)),
  7000,
  'the printed qty follows the new input'
);

-- Scan lama dibuang: box lama sudah tidak ada, jadi sesinya tidak menunjuk
-- apa pun lagi.
select is(
  (select count(*)::integer from public.packing_sessions
   where master_item_id = '9dc00000-0000-0000-0000-000000000020'),
  0,
  'the scanning session of the old boxes is gone'
);

select is(
  (
    select split_part(box.qr_payload, '|', 2)
    from public.label_boxes box
    where box.batch_id = (select batch_id from original)
    limit 1
  ),
  'RB-PART-B',
  'the QR of every box is rebuilt from the new data'
);

reset role;
update public.label_box_batches
set closed_at = now()
where id = (select batch_id from original);
set local role authenticated;

-- Batch yang sudah ditutup: labelnya sudah tercetak dan hasil scannya bukti
-- kiriman, jadi merakit ulang tidak boleh.
select throws_ok(
  $$ select public.rebuild_label_box_batch(
    (select batch_id from original),
    '9dc00000-0000-0000-0000-000000000010',
    'DN-REBUILD-0003',
    date '2026-08-28',
    date '2026-08-22',
    '9dc00000-0000-0000-0000-000000000020',
    100,
    'LOT-REBUILD-C',
    'OP-REBUILD-C',
    100
  ) $$,
  'LABEL_BOX_BATCH_CLOSED',
  'a closed batch refuses a full edit'
);

reset role;

select * from finish();

rollback;
