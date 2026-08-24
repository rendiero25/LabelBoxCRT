-- Verifikasi Pengiriman, Bagian 2: mencocokkan label box dengan baris jadwal.
-- Spec: docs/superpowers/specs/2026-08-21-verifikasi-pengiriman-design.md
--
-- Baris jadwal menyebut ukuran produk, sedangkan label box menyebut Master
-- Item. Yang diuji di sini terjemahan di antara keduanya, dan bahwa angka yang
-- dibandingkan adalah Packing Qty milik batch -- bukan Qty/Box, bukan Qty
-- Delivery, dan bukan angka yang kebetulan tertulis di dalam string QR.

begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;

select plan(17);

create temporary table verify_seq_before as
select last_value, is_called from public.delivery_verification_session_seq;

insert into auth.users (
  id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '91310000-0000-0000-0000-000000000001', 'authenticated', 'authenticated',
  'verify-delivery@example.test', '{}'::jsonb, '{}'::jsonb, now(), now()
);

insert into public.profiles (id, display_name, role, is_active) values (
  '91310000-0000-0000-0000-000000000001', 'Verify Delivery', 'user', true
);

insert into public.suppliers (id, supplier_code, supplier_name, is_active) values (
  '95310000-0000-0000-0000-000000000001', 'VDSUP', 'Verify Delivery Supplier', true
);

-- Dua Master Item supaya "cocok" bisa dibedakan dari "kebetulan satu-satunya".
insert into public.master_items (
  id, item_code, part_no, part_name, unit, default_label_qty, supplier_id, is_active
) values
  ('96310000-0000-0000-0000-000000000001', 'vd-item-a', 'VD-PART-A',
    'Verify Delivery A', 'Pcs', 100, '95310000-0000-0000-0000-000000000001', true),
  ('96310000-0000-0000-0000-000000000002', 'vd-item-b', 'VD-PART-B',
    'Verify Delivery B', 'Pcs', 100, '95310000-0000-0000-0000-000000000001', true);

insert into public.boxes (id, master_item_id, box_no, box_code, box_name) values
  ('98310000-0000-0000-0000-000000000001',
    '96310000-0000-0000-0000-000000000001', 1, 'vd-box-a', 'Box A'),
  ('98310000-0000-0000-0000-000000000002',
    '96310000-0000-0000-0000-000000000002', 1, 'vd-box-b', 'Box B');

-- Produk berbentuk pelat (tebal x lebar x panjang), ditulis di jadwal sebagai
-- 'VDX T0.3XW100 L=120MM'. Bentuk penulisan itu berbeda dari tabung, dan
-- justru itu yang harus tetap terbaca oleh terjemahan yang sama.
insert into public.products (
  id, product_code, part_name, part_type, outer_diameter, inner_diameter, length
) values
  ('97310000-0000-0000-0000-000000000001', 'vd-prd-01', 'VDX', 'Plate',
    0.3, 100, 120),
  ('97310000-0000-0000-0000-000000000002', 'vd-prd-02', 'VDX', 'Plate',
    0.3, 60, 110);

insert into public.master_item_products (master_item_id, product_id, is_active) values
  ('96310000-0000-0000-0000-000000000001',
    '97310000-0000-0000-0000-000000000001', true),
  ('96310000-0000-0000-0000-000000000002',
    '97310000-0000-0000-0000-000000000002', true);

select is(
  private.product_size_dimensions('VDX T0.3XW100 L=120MM'),
  array[0.3, 100, 120]::numeric[],
  'tiga angka pertama terbaca dari bentuk pelat'
);

select is(
  private.product_size_dimensions('VO-B D6X7 Pt.L=525'),
  array[6, 7, 525]::numeric[],
  'aturan yang sama terbaca dari bentuk tabung'
);

select is(
  private.product_size_dimensions('VDX T0.3XW100'),
  null,
  'teks dengan angka kurang dari tiga tidak menunjuk produk mana pun'
);

-- '0.30' dan '0.3' angka yang sama. Dokumen jadwal diketik tangan, dan nol di
-- belakang koma datang dan pergi.
select is(
  private.master_item_for_product_size('VDX T0.30XW100 L=120.0MM'),
  '96310000-0000-0000-0000-000000000001'::uuid,
  'nol di belakang koma tidak mengubah produk yang ditunjuk'
);

select is(
  private.master_item_for_product_size('VDX T0.3XW60 L=110MM'),
  '96310000-0000-0000-0000-000000000002'::uuid,
  'ukuran berbeda menunjuk Master Item berbeda'
);

select is(
  private.master_item_for_product_size('TIDAK-ADA T9XW9 L=9MM'),
  null,
  'ukuran yang tidak terdaftar tidak menunjuk apa pun'
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '91310000-0000-0000-0000-000000000001',
  true
);

-- Packing Qty 5000 sengaja berbeda dari Qty/Box (100) dan Qty Delivery (200):
-- ketiganya harus bisa dibedakan oleh tesnya.
create temporary table vd_batch as
select * from public.create_label_box_batch(
  '95310000-0000-0000-0000-000000000001',
  'DN-VD-1',
  date '2026-08-24',
  date '2026-08-24',
  '96310000-0000-0000-0000-000000000001',
  200,
  'LOT-VD',
  'OP-VD',
  5000
);
grant select on vd_batch to public;

create temporary table vd_session as
select * from public.create_delivery_verification_session();
grant select on vd_session to public;

select public.add_delivery_schedule_rows(
  (select id from vd_session),
  'jadwal-vd.xlsx',
  '[{"productSize": "VDX T0.3XW100 L=120MM", "qty": "5000"},
    {"productSize": "TIDAK-ADA T9XW9 L=9MM", "qty": "5000"}]'::jsonb
);

select is(
  (
    select resolved_part_no from public.delivery_schedule_rows_resolved
    where session_id = (select id from vd_session) and row_no = 1
  ),
  'VD-PART-A',
  'layar melihat Master Item hasil terjemahan sebelum satu pun scan'
);

select is(
  (
    select resolved_part_no from public.delivery_schedule_rows_resolved
    where session_id = (select id from vd_session) and row_no = 2
  ),
  null,
  'baris yang ukurannya tak dikenal tampak sebagai tak terterjemahkan'
);

create temporary table vd_pass as
select * from public.verify_delivery_label(
  (select id from vd_session),
  (
    select qr_payload from public.label_boxes
    where batch_id = (select batch_id from vd_batch) and box_number = 'B101'
  )
);
grant select on vd_pass to public;

select is(
  (select result from vd_pass)::text,
  'pass',
  'label yang Master Item dan Packing Qty-nya cocok menghasilkan PASS'
);

select is(
  (select packing_qty from vd_pass),
  5000,
  'angka yang dibandingkan Packing Qty, bukan Qty/Box maupun Qty Delivery'
);

select is(
  (select matched_row_no from vd_pass),
  1,
  'baris pertama yang cocok dan belum terverifikasi yang terisi'
);

select is(
  (select delivery_ok from vd_pass),
  false,
  'masih ada baris yang belum PASS, jadi belum DELIVERY OK'
);

-- Satu label fisik hanya boleh memenuhi satu baris jadwal.
select is(
  (
    select result::text from public.verify_delivery_label(
      (select id from vd_session),
      (
        select qr_payload from public.label_boxes
        where batch_id = (select batch_id from vd_batch) and box_number = 'B101'
      )
    )
  ),
  'duplicate_label',
  'label yang sama discan dua kali tidak memenuhi baris kedua'
);

select is(
  (
    select result::text from public.verify_delivery_label(
      (select id from vd_session), 'BUKAN|PAYLOAD|YANG|PERNAH|ADA'
    )
  ),
  'unknown_label',
  'payload yang tidak ada di label_boxes dilaporkan sebagai label tak dikenal'
);

-- Label kedua dari batch yang sama: Master Item dan Packing Qty-nya cocok,
-- tetapi baris yang tersisa ukurannya tak dikenal, jadi tidak ada yang cocok.
select is(
  (
    select result::text from public.verify_delivery_label(
      (select id from vd_session),
      (
        select qr_payload from public.label_boxes
        where batch_id = (select batch_id from vd_batch) and box_number = 'B102'
      )
    )
  ),
  'not_pass',
  'tidak ada baris tersisa yang cocok menghasilkan NOT PASS'
);

select is(
  (
    select count(*)::integer from public.delivery_verification_scans
    where session_id = (select id from vd_session)
  ),
  4,
  'keempat scan tercatat, termasuk yang gagal'
);

select is(
  (
    select status::text from public.delivery_verification_sessions
    where id = (select id from vd_session)
  ),
  'open',
  'session tetap terbuka selama masih ada baris yang belum PASS'
);

reset role;

select setval(
  'public.delivery_verification_session_seq',
  (select last_value from verify_seq_before),
  (select is_called from verify_seq_before)
);

select * from finish();

rollback;
