begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;

select plan(27);

insert into auth.users (
  id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('91190000-0000-0000-0000-000000000001', 'authenticated', 'authenticated',
    'label-box-operator@example.test', '{}'::jsonb, '{}'::jsonb, now(), now());

insert into public.profiles (id, display_name, role, is_active) values
  ('91190000-0000-0000-0000-000000000001', 'Label Box Operator', 'user', true);

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
  array['uuid', 'text', 'date', 'date', 'uuid', 'integer', 'text', 'text', 'integer'],
  'create_label_box_batch RPC takes supplier, DN, date, packing date, master item, qty, lot, nama operator, qty cetak'
);

-- Empat bulan yang ejaannya berbeda dari singkatan Indonesia yang dipakai
-- sebelumnya: MEI/AGS/OKT/DES. Pemetaannya ditulis tangan, bukan to_char
-- (..., 'MON') yang ikut lc_time server, jadi keempat inilah yang
-- membuktikan tabel bulannya benar-benar sudah berganti.
select is(
  private.label_date_text(date '2026-08-18') || ',' ||
    private.label_date_text(date '2026-05-01') || ',' ||
    private.label_date_text(date '2026-10-09') || ',' ||
    private.label_date_text(date '2026-12-25'),
  '18-AUG-2026,01-MAY-2026,09-OCT-2026,25-DEC-2026',
  'bulan yang ejaannya berbeda dari bulan Indonesia ditulis benar'
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
  date '2026-07-25',
  '96190000-0000-0000-0000-000000000001',
  100,
  'LOT-LB-A',
  'OP-LB-A'
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
    '-LOT-LB-A-B101|28-JUL-2026',
  'QR payload berisi lima field dengan urutan yang dikunci spec'
);

select isnt(
  (select qr_generated_at from labelbox_batch_a),
  null,
  'batch menyimpan waktu generate QR'
);

-- Angka yang dicetak di baris Qty/Delivery berdiri sendiri dari angka yang
-- menentukan jumlah label. Tanpa nilai sendiri ia mengikuti keping yang dipak,
-- persis seperti perilaku lama.
select is(
  (select qty_delivery_display from labelbox_batch_a),
  (select qty_delivery from labelbox_batch_a),
  'tanpa qty cetak, angka yang dicetak mengikuti keping yang dipak'
);

select is(
  (
    select qty_delivery_display::text || '|' || qty_delivery::text
    from public.create_label_box_batch(
      '95190000-0000-0000-0000-000000000001',
      'DN-LABELBOX-1',
      date '2026-07-28',
      date '2026-07-25',
      '96190000-0000-0000-0000-000000000001',
      100,
      'LOT-LB-DISPLAY',
      'OP-LB-DISPLAY',
      2500
    )
  ),
  '2500|100',
  'qty cetak disimpan apa adanya dan tidak mengubah keping yang dipak'
);

-- Snapshot field tampilan disimpan di batch itu sendiri, supaya baris ini
-- tidak hilang dari tabel operator ketika DN ditutup atau supplier/master
-- item dinonaktifkan (RLS suppliers/master_items/delivery_numbers hanya
-- mengizinkan baris aktif).
select is(
  (
    select concat_ws(
      '|', supplier_code_snapshot, item_code_snapshot,
      delivery_number_snapshot, delivery_date_snapshot::text
    )
    from public.label_box_batches
    where id = (select batch_id from labelbox_batch_a)
  ),
  'LB1SUP|labelbox-item|DN-LABELBOX-1|2026-07-28',
  'batch menyimpan snapshot supplier code, item code, DN, dan tanggal delivery'
);

-- Part No ikut disnapshot karena itu yang ditampilkan di kolom Master Item
-- pada tabel halaman scan; item_code hanya kode internal hasil autogen.
select is(
  (
    select part_no_snapshot
    from public.label_box_batches
    where id = (select batch_id from labelbox_batch_a)
  ),
  'LABELBOX-PART',
  'batch menyimpan snapshot part no master item'
);

-- Tanggal packing milik batch sendiri, bukan turunan tanggal delivery: ia
-- dicetak sebagai barisnya sendiri di atas Delivery Date.
select is(
  (select packing_date from labelbox_batch_a),
  date '2026-07-25',
  'batch menyimpan packing date apa adanya'
);

select throws_ok(
  $$
    select public.create_label_box_batch(
      '95190000-0000-0000-0000-000000000001',
      'DN-LABELBOX-9',
      date '2026-07-28',
      null,
      '96190000-0000-0000-0000-000000000001',
      100,
      'LOT-LB-F',
      'OP-LB-F'
    )
  $$,
  'P0001',
  'PACKING_DATE_INVALID',
  'packing date kosong ditolak'
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
  date '2026-07-25',
  '96190000-0000-0000-0000-000000000001',
  200,
  'LOT-LB-B',
  'OP-LB-B'
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
      date '2026-07-31',
      '96190000-0000-0000-0000-000000000001',
      100,
      'LOT-LB-C',
      'OP-LB-C'
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
      date '2026-07-25',
      '96190000-0000-0000-0000-000000000001',
      150,
      'LOT-LB-C',
      'OP-LB-C'
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
      date '2026-07-25',
      '96190000-0000-0000-0000-000000000001',
      10000,
      'LOT-LB-C',
      'OP-LB-C'
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
      date '2026-07-25',
      '96190000-0000-0000-0000-000000000002',
      100,
      'LOT-LB-C',
      'OP-LB-C'
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
      date '2026-07-25',
      '96190000-0000-0000-0000-000000000001',
      100,
      'LOT-LB-C',
      'OP-LB-C'
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
      date '2026-07-25',
      '96190000-0000-0000-0000-000000000001',
      100,
      '   ',
      'OP-LB-EMPTY'
    )
  $$,
  'P0001',
  'LOT_NO_INVALID',
  'lot no kosong ditolak'
);

-- Nama operator dicetak di baris Operator Pack label; batch tanpa nama itu
-- menghasilkan label dengan baris kosong yang tidak bisa ditelusuri lagi.
select throws_ok(
  $$
    select public.create_label_box_batch(
      '95190000-0000-0000-0000-000000000001',
      'DN-LABELBOX-2',
      date '2026-07-28',
      date '2026-07-25',
      '96190000-0000-0000-0000-000000000001',
      100,
      'LOT-LB-G',
      '   '
    )
  $$,
  'P0001',
  'OPERATOR_NAME_INVALID',
  'nama operator kosong ditolak'
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
      date '2026-07-25',
      '96190000-0000-0000-0000-000000000001',
      100,
      'LOT-LB-E',
      'OP-LB-E'
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
      date '2026-07-25',
      '96190000-0000-0000-0000-000000000001',
      100,
      'LOT-LB-D',
      'OP-LB-D'
    )
  $$,
  '42501',
  'permission denied for function create_label_box_batch',
  'anon tidak punya execute privilege'
);

reset role;

select * from finish();

rollback;
