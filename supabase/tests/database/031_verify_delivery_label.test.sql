-- Verifikasi Pengiriman, Bagian 2: mencocokkan label box dengan baris jadwal.
-- Spec: docs/superpowers/specs/2026-08-21-verifikasi-pengiriman-design.md
--
-- Perbandingannya langsung: Part No yang tercetak di label lawan kolom pertama
-- jadwal, dan Qty per Box label lawan Qty per Box jadwal. Isi file jadwal
-- berdiri sendiri -- tidak perlu didaftarkan sebagai produk lebih dulu.
--
-- Yang dijaga di sini: angka yang dibandingkan Qty per Box milik batch, bukan
-- Qty/Box Master Item maupun Qty Delivery, dan bukan angka yang kebetulan
-- tertulis di dalam string QR.

begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;

select plan(15);

create temporary table verify_seq_before as
select last_value, is_called from public.delivery_verification_session_seq;

insert into auth.users (
  id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '91310000-0000-0000-0000-000000000001', 'authenticated', 'authenticated',
  'verify-delivery@example.test', '{}'::jsonb, '{}'::jsonb, now(), now()
);

-- Admin, bukan user biasa: file ini ikut menguji create_master_item, yang
-- hanya menerima admin. Seluruh RPC verifikasi pengiriman cuma menuntut
-- pengguna aktif, jadi admin memenuhi keduanya.
insert into public.profiles (id, display_name, role, is_active) values (
  '91310000-0000-0000-0000-000000000001', 'Verify Delivery', 'admin', true
);

insert into public.suppliers (id, supplier_code, supplier_name, is_active) values (
  '95310000-0000-0000-0000-000000000001', 'VDSUP', 'Verify Delivery Supplier', true
);

-- Part No sheet memuat '=' -- bentuk yang ditolak aturan lama. Dua Master Item
-- supaya "cocok" bisa dibedakan dari "kebetulan satu-satunya".
insert into public.master_items (
  id, item_code, part_no, part_name, unit, default_label_qty, supplier_id, is_active
) values
  ('96310000-0000-0000-0000-000000000001', 'vd-item-a', 'VS-B T0.3XW100 L=120MM',
    'Sheet A', 'Pcs', 100, '95310000-0000-0000-0000-000000000001', true),
  ('96310000-0000-0000-0000-000000000002', 'vd-item-b', 'VS-B T0.3XW60 L=110MM',
    'Sheet B', 'Pcs', 100, '95310000-0000-0000-0000-000000000001', true);

insert into public.boxes (id, master_item_id, box_no, box_code, box_name) values
  ('98310000-0000-0000-0000-000000000001',
    '96310000-0000-0000-0000-000000000001', 1, 'vd-box-a', 'Box A'),
  ('98310000-0000-0000-0000-000000000002',
    '96310000-0000-0000-0000-000000000002', 1, 'vd-box-b', 'Box B');

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '91310000-0000-0000-0000-000000000001',
  true
);

-- Ukuran ber-'=' harus bisa didaftarkan sebagai Part No. Tanpa itu Master Item
-- untuk sheet tidak pernah ada, dan labelnya tidak pernah tercetak.
select lives_ok(
  $$
    select public.create_master_item(
      'VS-B T0.3XW80 L=55MM', 'Sheet C', 'Pcs', 100, null,
      '95310000-0000-0000-0000-000000000001'
    )
  $$,
  'Part No boleh memuat tanda sama dengan'
);

select throws_ok(
  $$
    select public.create_master_item(
      'VS-B T0.3XW80 L=55MM*', 'Sheet D', 'Pcs', 100, null,
      '95310000-0000-0000-0000-000000000001'
    )
  $$,
  'P0001', 'MASTER_ITEM_INPUT_INVALID',
  'karakter di luar daftar yang diizinkan tetap ditolak'
);

-- Qty per Box 5000 sengaja berbeda dari Qty/Box Master Item (100) dan dari Qty
-- Delivery (200): ketiganya harus bisa dibedakan oleh tesnya.
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

-- Baris kedua sengaja memakai ejaan berspasi ganda dan huruf kecil: dokumen
-- jadwal diketik tangan, dan kedua sisi harus dirapikan dengan cara yang sama
-- sebelum dibandingkan.
select public.add_delivery_schedule_rows(
  (select id from vd_session),
  'jadwal-vd.xlsx',
  '[{"productSize": "VS-B T0.3XW100 L=120MM", "qty": "5000"},
    {"productSize": "  vs-b   T0.3XW60   L=110MM ", "qty": "5000"},
    {"productSize": "TIDAK-ADA T9XW9 L=9MM", "qty": "5000"}]'::jsonb
);

select is(
  (
    select matching_batch_exists from public.delivery_schedule_rows_resolved
    where session_id = (select id from vd_session) and row_no = 1
  ),
  true,
  'layar melihat labelnya sudah ada sebelum satu pun scan'
);

select is(
  (
    select matching_batch_exists from public.delivery_schedule_rows_resolved
    where session_id = (select id from vd_session) and row_no = 3
  ),
  false,
  'baris yang belum punya label mana pun ditandai sejak upload'
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
  'label yang Part No dan Qty per Box-nya cocok menghasilkan PASS'
);

select is(
  (select part_no from vd_pass),
  'VS-B T0.3XW100 L=120MM',
  'Part No label dibandingkan apa adanya, tanpa terjemahan'
);

select is(
  (select packing_qty from vd_pass),
  5000,
  'angka yang dibandingkan Qty per Box, bukan Qty/Box maupun Qty Delivery'
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

-- Batch kedua: Part No berbeda, Qty per Box sama. Qty saja tidak cukup untuk
-- PASS -- kalau cukup, label Master Item mana pun akan lolos.
create temporary table vd_batch_b as
select * from public.create_label_box_batch(
  '95310000-0000-0000-0000-000000000001',
  'DN-VD-2',
  date '2026-08-24',
  date '2026-08-24',
  '96310000-0000-0000-0000-000000000002',
  200,
  'LOT-VD-B',
  'OP-VD',
  5000
);
grant select on vd_batch_b to public;

select is(
  (
    select result::text from public.verify_delivery_label(
      (select id from vd_session),
      (
        select qr_payload from public.label_boxes
        where batch_id = (select batch_id from vd_batch_b) and box_number = 'B101'
      )
    )
  ),
  'pass',
  'ejaan berspasi ganda dan huruf kecil di jadwal tetap cocok'
);

select is(
  (
    select row_no from public.delivery_schedule_rows
    where session_id = (select id from vd_session)
      and verified_label_box_id is not null
    order by row_no desc limit 1
  ),
  2,
  'yang terisi baris kedua, bukan baris ketiga yang tak punya label'
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
