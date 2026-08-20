-- Nama Operator: diisi di formulir label box, disimpan di batch, disnapshot ke
-- print job, dan ikut berubah ketika batchnya disunting.
-- Migrasi: supabase/migrations/20260820090000_label_box_operator_name.sql

begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;

select plan(7);

insert into auth.users (
  id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '9e700000-0000-0000-0000-000000000001'::uuid,
  'authenticated',
  'authenticated',
  'operator-name@example.test',
  '{}'::jsonb,
  '{}'::jsonb,
  now(),
  now()
);

insert into public.profiles (id, display_name, role, is_active) values (
  '9e700000-0000-0000-0000-000000000001'::uuid, 'Operator Name Admin', 'admin', true
);

insert into public.suppliers (id, supplier_code, supplier_name, is_active) values
  ('9e700000-0000-0000-0000-000000000010'::uuid, 'OPSUP1', 'Operator Supplier', true);

insert into public.master_items (
  id, item_code, part_no, part_name, unit, default_label_qty, supplier_id
) values (
  '9e700000-0000-0000-0000-000000000020'::uuid, 'op-item-a', 'OP-PART-A',
  'Operator Part A', 'Pcs', 100, '9e700000-0000-0000-0000-000000000010'::uuid
);

insert into public.boxes (id, master_item_id, box_no, box_code, box_name) values
  ('9e700000-0000-0000-0000-000000000030'::uuid,
    '9e700000-0000-0000-0000-000000000020'::uuid, 1, 'op-box-a1', 'Box A1');

select has_column(
  'public', 'label_box_batches', 'operator_name',
  'batch menyimpan nama operator sendiri, bukan diturunkan dari tabel lain'
);

select has_column(
  'public', 'print_jobs', 'operator_name_snapshot',
  'print job menyimpan snapshot nama operator seperti packing date'
);

select set_config(
  'request.jwt.claim.sub', '9e700000-0000-0000-0000-000000000001', true
);
set local role authenticated;

create temporary table op_batch as
select batch_id, operator_name
from public.create_label_box_batch(
  '9e700000-0000-0000-0000-000000000010'::uuid,
  'DN-OPERATOR-0001',
  date '2026-08-26',
  date '2026-08-20',
  '9e700000-0000-0000-0000-000000000020'::uuid,
  100,
  'LOT-OPERATOR-A',
  '  Andi Prasetyo  '
);

grant select on table op_batch to authenticated;

-- Spasi di ujung nama dipangkas seperti Lot No dan Delivery Number: nama yang
-- tersimpan itu yang tercetak, dan spasi di depannya menggeser barisnya.
select is(
  (select operator_name from op_batch),
  'Andi Prasetyo',
  'nama operator disimpan tanpa spasi di ujungnya'
);

-- Nama operator hanya dicetak di baris Operator Pack. QR payload tetap lima
-- field seperti kontrak parseBarcodeV1, jadi scanner tidak ikut berubah.
select is(
  (
    select array_length(string_to_array(box.qr_payload, '|'), 1)
    from public.label_boxes box
    where box.batch_id = (select batch_id from op_batch)
    limit 1
  ),
  5,
  'QR payload tetap lima field, nama operator tidak masuk ke sana'
);

select * from public.create_label_box_print_jobs((select batch_id from op_batch));

select is(
  (
    select distinct job.operator_name_snapshot
    from public.print_jobs job
    join public.label_boxes box
      on box.packing_session_id = job.packing_session_id
    where box.batch_id = (select batch_id from op_batch)
  ),
  'Andi Prasetyo',
  'print job menyalin nama operator dari batch saat dibuat'
);

-- Batch yang sudah ditutup masih boleh berganti nama operator: itu keterangan
-- kiriman, dan label penggantinya harus menyebut nama yang diperbaiki.
reset role;
update public.label_box_batches
set closed_at = now()
where id = (select batch_id from op_batch);
set local role authenticated;

select public.update_label_box_batch(
  (select batch_id from op_batch),
  'DN-OPERATOR-0001',
  date '2026-08-26',
  date '2026-08-20',
  'LOT-OPERATOR-A',
  'Siti Rahayu'
);

-- Job cetak yang sudah ada ikut ditulis ulang, seperti lot dan packing date:
-- cetak ulang memakai snapshot, bukan batchnya.
select is(
  (
    select distinct job.operator_name_snapshot
    from public.print_jobs job
    join public.label_boxes box
      on box.packing_session_id = job.packing_session_id
    where box.batch_id = (select batch_id from op_batch)
  ),
  'Siti Rahayu',
  'menyunting batch ikut menulis ulang snapshot nama operator di print job'
);

select throws_ok(
  $$
    select public.update_label_box_batch(
      (select batch_id from op_batch),
      'DN-OPERATOR-0001',
      date '2026-08-26',
      date '2026-08-20',
      'LOT-OPERATOR-A',
      '   '
    )
  $$,
  'P0001',
  'OPERATOR_NAME_INVALID',
  'nama operator kosong ditolak saat menyunting'
);

reset role;

select * from finish();

rollback;
