begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;

select plan(15);

insert into auth.users (
  id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('91200000-0000-0000-0000-000000000001', 'authenticated', 'authenticated',
    'verify-operator@example.test', '{}'::jsonb, '{}'::jsonb, now(), now());

insert into public.profiles (id, display_name, role, is_active) values
  ('91200000-0000-0000-0000-000000000001', 'Verify Operator', 'user', true);

insert into public.suppliers (id, supplier_code, supplier_name, is_active) values
  ('95200000-0000-0000-0000-000000000001', 'VF1SUP', 'Verify Supplier', true);

insert into public.master_items (
  id, item_code, part_no, part_name, unit, default_label_qty, supplier_id, is_active
) values (
  '96200000-0000-0000-0000-000000000001', 'verify-item', 'VERIFY-PART',
  'Verify Part', 'Pcs', 2, '95200000-0000-0000-0000-000000000001', true
);

-- Dua produk: layer box 1 minta produk pertama, layer box 2 minta produk
-- kedua. Batch tidak boleh ditutup sebelum keduanya pernah discan (guard
-- MASTER_ITEM_PRODUCTS_INCOMPLETE di close_label_box_batch).
insert into public.products (
  id, product_code, part_name, outer_diameter, inner_diameter, length, is_active
) values
  ('97200000-0000-0000-0000-000000000001', 'verify-product', 'Verify Product',
    6.3, 5.5, 205, true),
  ('97200000-0000-0000-0000-000000000002', 'verify-product-2', 'Verify Product 2',
    8.4, 6.5, 150, true);

insert into public.master_item_products (
  master_item_id, product_id, is_active
) values
  ('96200000-0000-0000-0000-000000000001',
    '97200000-0000-0000-0000-000000000001',
    true),
  ('96200000-0000-0000-0000-000000000001',
    '97200000-0000-0000-0000-000000000002',
    true);

insert into public.boxes (id, master_item_id, box_no, box_code, box_name) values
  ('98200000-0000-0000-0000-000000000001',
    '96200000-0000-0000-0000-000000000001', 1, 'verify-01', 'Box 1'),
  ('98200000-0000-0000-0000-000000000002',
    '96200000-0000-0000-0000-000000000001', 2, 'verify-02', 'Box 2');

insert into public.box_layers (id, box_id, layer_no, layer_name, sort_order) values
  ('99200000-0000-0000-0000-000000000001',
    '98200000-0000-0000-0000-000000000001', 1, 'Box 1 - Layer 1', 1),
  ('99200000-0000-0000-0000-000000000002',
    '98200000-0000-0000-0000-000000000002', 1, 'Box 2 - Layer 1', 1);

insert into public.box_layer_requirements (
  box_layer_id, product_id, expected_qty, sort_order
) values
  ('99200000-0000-0000-0000-000000000001',
    '97200000-0000-0000-0000-000000000001', 1, 1),
  ('99200000-0000-0000-0000-000000000002',
    '97200000-0000-0000-0000-000000000002', 1, 1);

select has_function(
  'public', 'accept_label_box_scan',
  array['uuid', 'text', 'text', 'text', 'text'],
  'accept_label_box_scan RPC ada'
);
select has_function(
  'public', 'close_label_box_batch', array['uuid'],
  'close_label_box_batch RPC ada'
);
select has_function(
  'public', 'create_label_box_print_jobs', array['uuid'],
  'create_label_box_print_jobs RPC ada'
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '91200000-0000-0000-0000-000000000001',
  true
);

-- Packing qty 2, qty delivery 2, dua box: satu set, dua label.
create temporary table verify_batch as
select *
from public.create_label_box_batch(
  '95200000-0000-0000-0000-000000000001',
  'DN-VERIFY-1',
  date '2026-07-29',
  '96200000-0000-0000-0000-000000000001',
  2,
  'LOT-VF-A'
);
grant select on verify_batch to public;

select is(
  (select label_count from verify_batch),
  2,
  'batch menghasilkan dua label box'
);

create temporary table verify_scan_a as
select *
from public.accept_label_box_scan(
  (select batch_id from verify_batch),
  'VERIFY-UID-1',
  'aa11',
  'D6.3X5.5 L=205',
  '6.3x5.5x205'
);
grant select on verify_scan_a to public;

select is(
  (select box_number from verify_scan_a),
  'B101',
  'scan pertama masuk ke box bernomor terkecil'
);

select is(
  (select label_box_status::text from verify_scan_a),
  'verified',
  'box penuh setelah layernya terpenuhi'
);

-- Box 1 sudah menutup layernya dengan produk pertama, tetapi box 2 (layer
-- yang meminta produk kedua) belum pernah discan. Batch tidak boleh ditutup.
select throws_ok(
  $$
    select public.close_label_box_batch(
      (select batch_id from verify_batch)
    )
  $$,
  'P0001',
  'MASTER_ITEM_PRODUCTS_INCOMPLETE',
  'menutup batch ditolak selama produk kedua belum pernah discan'
);

create temporary table verify_scan_b as
select *
from public.accept_label_box_scan(
  (select batch_id from verify_batch),
  'VERIFY-UID-2',
  'bb22',
  'D8.4X6.5 L=150',
  '8.4x6.5x150'
);
grant select on verify_scan_b to public;

select is(
  (select box_number from verify_scan_b),
  'B201',
  'scan berikutnya pindah sendiri ke box kedua'
);

select throws_ok(
  $$
    select public.accept_label_box_scan(
      (select batch_id from verify_batch),
      'VERIFY-UID-3', 'cc33', 'D6.3X5.5 L=205', '6.3x5.5x205'
    )
  $$,
  'P0001',
  'NO_LABEL_BOX_AVAILABLE',
  'scan ditolak ketika semua box sudah penuh'
);

-- Kedua produk sudah pernah discan (produk pertama di box 1, produk kedua
-- di box 2), jadi penutupan batch sekarang berhasil.
create temporary table verify_close as
select * from public.close_label_box_batch((select batch_id from verify_batch));
grant select on verify_close to public;

select is(
  (select verified_count from verify_close),
  2,
  'menutup batch melaporkan dua box terverifikasi'
);

select throws_ok(
  $$
    select public.accept_label_box_scan(
      (select batch_id from verify_batch),
      'VERIFY-UID-4', 'dd44', 'D6.3X5.5 L=205', '6.3x5.5x205'
    )
  $$,
  'P0001',
  'LABEL_BOX_BATCH_CLOSED',
  'scan ditolak pada batch yang sudah ditutup'
);

select throws_ok(
  $$ select public.close_label_box_batch((select batch_id from verify_batch)) $$,
  'P0001',
  'LABEL_BOX_BATCH_ALREADY_CLOSED',
  'menutup dua kali ditolak'
);

create temporary table verify_jobs as
select * from public.create_label_box_print_jobs((select batch_id from verify_batch));
grant select on verify_jobs to public;

select is(
  (select count(*)::integer from verify_jobs),
  2,
  'satu print job dibuat per label box'
);

select is(
  (
    select string_agg(job.qr_payload, ',' order by job.box_number)
    from verify_jobs job
  ),
  (
    select string_agg(box.qr_payload, ',' order by box.box_number)
    from public.label_boxes box
    where box.batch_id = (select batch_id from verify_batch)
  ),
  'print job membawa QR payload label box apa adanya'
);

select is(
  (
    select count(*)::integer
    from public.create_label_box_print_jobs((select batch_id from verify_batch))
  ),
  2,
  'memanggil ulang tidak menggandakan print job'
);

reset role;

select * from finish();

rollback;
