begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;

select plan(19);

insert into auth.users (
  id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('91210000-0000-0000-0000-000000000001', 'authenticated', 'authenticated',
    'label-box-editor@example.test', '{}'::jsonb, '{}'::jsonb, now(), now());

insert into public.profiles (id, display_name, role, is_active) values
  ('91210000-0000-0000-0000-000000000001', 'Label Box Editor', 'user', true);

insert into public.suppliers (id, supplier_code, supplier_name, is_active) values
  ('95210000-0000-0000-0000-000000000001', 'LB2SUP', 'Label Box Edit Supplier', true);

insert into public.master_items (
  id, item_code, part_no, part_name, unit, default_label_qty, supplier_id, is_active
) values
  (
    '96210000-0000-0000-0000-000000000001', 'labelbox-edit', 'LABELBOX-EDIT',
    'Label Box Edit Part', 'Pcs', 100, '95210000-0000-0000-0000-000000000001', true
  );

insert into public.boxes (id, master_item_id, box_no, box_code, box_name) values
  ('98210000-0000-0000-0000-000000000001',
    '96210000-0000-0000-0000-000000000001', 1, 'labelbox-edit-01', 'Box 1'),
  ('98210000-0000-0000-0000-000000000002',
    '96210000-0000-0000-0000-000000000001', 2, 'labelbox-edit-02', 'Box 2');

select has_function(
  'public',
  'update_label_box_batch',
  array['uuid', 'text', 'date', 'text'],
  'update_label_box_batch RPC takes batch, DN, date, lot'
);

select has_function(
  'public',
  'delete_label_box_batch',
  array['uuid'],
  'delete_label_box_batch RPC takes a batch'
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '91210000-0000-0000-0000-000000000001',
  true
);

create temporary table edit_batch as
select *
from public.create_label_box_batch(
  '95210000-0000-0000-0000-000000000001',
  'DN-LB-EDIT-1',
  date '2026-08-07',
  '96210000-0000-0000-0000-000000000001',
  100,
  'LOT-EDIT-A'
);
grant select on edit_batch to public;

create temporary table edit_result as
select *
from public.update_label_box_batch(
  (select batch_id from edit_batch),
  'DN-LB-EDIT-2',
  date '2026-08-09',
  'LOT-EDIT-B'
);
grant select on edit_result to public;

select is(
  (select lot_no from edit_result),
  'LOT-EDIT-B',
  'RPC mengembalikan lot yang sudah diperbarui'
);

select is(
  (
    select concat_ws(
      '|', delivery_number_snapshot, delivery_date_snapshot::text, lot_no
    )
    from public.label_box_batches
    where id = (select batch_id from edit_batch)
  ),
  'DN-LB-EDIT-2|2026-08-09|LOT-EDIT-B',
  'snapshot DN, tanggal, dan lot batch ikut berubah'
);

-- Nomor box tidak boleh bergeser: yang berubah cuma keterangan kirimannya.
select is(
  (
    select string_agg(box_number, ',' order by set_no, box_no)
    from public.label_boxes
    where batch_id = (select batch_id from edit_batch)
  ),
  'B101,B201',
  'nomor box tetap seperti semula'
);

select is(
  (
    select qr_payload
    from public.label_boxes
    where batch_id = (select batch_id from edit_batch) and box_number = 'B101'
  ),
  'LB2SUP|LABELBOX-EDIT|100|' ||
    (select master_item_row_no from edit_batch)::text ||
    '|LOT-EDIT-B|B101|09-08-2026',
  'QR payload dirakit ulang dengan lot dan tanggal baru'
);

-- Delivery Number baru dibuat kalau belum ada, dan yang lama dibiarkan berdiri.
select is(
  (
    select count(*)::integer
    from public.delivery_numbers
    where supplier_id = '95210000-0000-0000-0000-000000000001'
  ),
  2,
  'DN lama tetap ada dan DN baru dibuat'
);

select is(
  (
    select count(*)::integer
    from public.label_boxes box
    where box.batch_id = (select batch_id from edit_batch)
      and box.packing_session_id is not null
  ),
  0,
  'batch yang belum discan belum punya packing session'
);

select throws_ok(
  $$
    select public.update_label_box_batch(
      (select batch_id from edit_batch), '   ', date '2026-08-09', 'LOT-EDIT-B'
    )
  $$,
  'P0001',
  'DELIVERY_NUMBER_INVALID',
  'Delivery Number kosong ditolak'
);

select throws_ok(
  $$
    select public.update_label_box_batch(
      (select batch_id from edit_batch), 'DN-LB-EDIT-2', date '2026-08-09', ''
    )
  $$,
  'P0001',
  'LOT_NO_INVALID',
  'Lot No kosong ditolak'
);

select throws_ok(
  $$
    select public.update_label_box_batch(
      '00000000-0000-0000-0000-000000000000',
      'DN-LB-EDIT-2', date '2026-08-09', 'LOT-EDIT-B'
    )
  $$,
  'P0001',
  'LABEL_BOX_BATCH_NOT_FOUND',
  'batch yang tidak ada ditolak'
);

-- Tanggal milik Delivery Number: batch kedua yang menumpang nomor yang sama
-- mengunci tanggalnya, karena mengubahnya akan menggeser batch itu juga.
create temporary table shared_batch as
select *
from public.create_label_box_batch(
  '95210000-0000-0000-0000-000000000001',
  'DN-LB-EDIT-2',
  date '2026-08-09',
  '96210000-0000-0000-0000-000000000001',
  100,
  'LOT-EDIT-C'
);
grant select on shared_batch to public;

select throws_ok(
  $$
    select public.update_label_box_batch(
      (select batch_id from edit_batch),
      'DN-LB-EDIT-2', date '2026-08-10', 'LOT-EDIT-B'
    )
  $$,
  'P0001',
  'DELIVERY_NUMBER_DATE_SHARED',
  'tanggal DN yang dipakai batch lain tidak bisa diubah dari sini'
);

-- Batch yang pernah dicetak punya print job, dan tiap penekanan Cetak
-- meninggalkan satu print_attempts yang FK-nya restrict. Batch seperti inilah
-- yang dulu menolak dihapus.
create temporary table edit_jobs as
select * from public.create_label_box_print_jobs((select batch_id from edit_batch));
grant select on edit_jobs to public;

-- print_attempts hanya bisa ditulis complete_print_job; di sini barisnya
-- dipasang langsung supaya jalur cetaknya tidak perlu ditiru seluruhnya.
reset role;
insert into public.print_attempts (print_job_id, attempt_no, printer_name, result)
select job.print_job_id, 1, 'ZDesigner ZD220', 'sent'
from edit_jobs job;

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '91210000-0000-0000-0000-000000000001',
  true
);

select is(
  (select count(*)::integer from edit_jobs),
  2,
  'tiap label box punya satu print job'
);

create temporary table delete_result as
select * from public.delete_label_box_batch((select batch_id from edit_batch));
grant select on delete_result to public;

select is(
  (select deleted_print_job_count from delete_result),
  2,
  'penghapusan melaporkan print job yang ikut terhapus'
);

select is(
  (select deleted_label_count from delete_result),
  2,
  'penghapusan melaporkan jumlah nomor box yang ikut terhapus'
);

select is(
  (
    select count(*)::integer
    from public.label_boxes
    where batch_id = (select batch_id from edit_batch)
  ),
  0,
  'label box milik batch ikut terhapus'
);

select is(
  (
    select count(*)::integer
    from public.print_attempts attempt
    join edit_jobs job on job.print_job_id = attempt.print_job_id
  ),
  0,
  'percobaan cetak ikut terhapus, bukan menahan print job-nya'
);

select is(
  (
    select count(*)::integer
    from public.label_box_batches
    where id = (select batch_id from edit_batch)
  ),
  0,
  'batch terhapus'
);

-- Delivery Number milik supplier, bukan milik batch; ia tetap berdiri supaya
-- batch lain yang memakainya tidak ikut hilang.
select is(
  (
    select count(*)::integer
    from public.delivery_numbers
    where supplier_id = '95210000-0000-0000-0000-000000000001'
  ),
  2,
  'Delivery Number tidak ikut terhapus'
);

reset role;

select * from finish();

rollback;
