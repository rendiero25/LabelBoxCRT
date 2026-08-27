-- Verifikasi Pengiriman, Bagian 2: mencocokkan hasil scan dengan baris jadwal.
-- Spec: docs/superpowers/specs/2026-08-21-verifikasi-pengiriman-design.md
--
-- Yang dibandingkan datang dari string QR-nya sendiri: field kedua ukuran
-- produk, field ketiga Qty delivery. Label sheet tidak dibuat aplikasi ini,
-- jadi seluruh file ini sengaja tidak menyentuh master_items, boxes,
-- label_box_batches, maupun label_boxes -- kalau salah satunya diperlukan lagi,
-- tesnya yang gagal lebih dulu.

begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;

select plan(18);

create temporary table verify_seq_before as
select last_value, is_called from public.delivery_verification_session_seq;

insert into auth.users (
  id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '91310000-0000-0000-0000-000000000001', 'authenticated', 'authenticated',
  'verify-delivery@example.test', '{}'::jsonb, '{}'::jsonb, now(), now()
);

insert into public.profiles (id, display_name, role, is_active) values (
  '91310000-0000-0000-0000-000000000001', 'Verify Delivery', 'admin', true
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '91310000-0000-0000-0000-000000000001',
  true
);

create temporary table vd_session as
select * from public.create_delivery_verification_session();
grant select on vd_session to public;

-- Baris 1 dan 2 sengaja kembar: dua kiriman ukuran sama adalah dua baris, dan
-- masing-masing perlu satu box. Baris 3 memakai ejaan berspasi ganda dan huruf
-- kecil. Baris 4 menyalin cacat yang benar-benar ada di dokumen jadwal:
-- 'L=55 MM' berspasi sementara labelnya menulis 'L=55MM' rapat.
select public.add_delivery_schedule_rows(
  (select id from vd_session),
  'jadwal-vd.xlsx',
  '[{"productSize": "VS-B T0.3XW100 L=120MM", "qty": "2000"},
    {"productSize": "VS-B T0.3XW100 L=120MM", "qty": "2000"},
    {"productSize": "  vs-b   T0.3XW60   L=110MM ", "qty": "2000"},
    {"productSize": "VS-B T0.3XW80 L=55 MM", "qty": "2000"}]'::jsonb
);

create temporary table vd_pass as
select * from public.verify_delivery_label(
  (select id from vd_session),
  '10015|VS-B T0.3XW100 L=120MM|2000|DBT-512 NI-2445-240826-B001|24-AUG-2026'
);
grant select on vd_pass to public;

select is(
  (select result from vd_pass)::text,
  'pass',
  'ukuran dan Qty yang cocok menghasilkan PASS tanpa label di database'
);

select is(
  (select part_no from vd_pass),
  'VS-B T0.3XW100 L=120MM',
  'ukuran diambil dari field kedua payload'
);

select is(
  (select packing_qty from vd_pass),
  2000,
  'Qty diambil dari field ketiga payload'
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

-- Cek label dobel sudah dilepas: identitas label fisik hanya ada di
-- label_boxes, dan tabel itu tidak dipakai lagi. Payload yang sama karena itu
-- melunasi baris kembarnya. Konsekuensi yang diterima sadar, bukan kelalaian --
-- kalau perilaku ini berubah, tesnya yang harus ikut berubah.
create temporary table vd_pass_again as
select * from public.verify_delivery_label(
  (select id from vd_session),
  '10015|VS-B T0.3XW100 L=120MM|2000|DBT-512 NI-2445-240826-B001|24-AUG-2026'
);
grant select on vd_pass_again to public;

select is(
  (select result from vd_pass_again)::text,
  'pass',
  'payload yang sama tidak ditolak sebagai dobel'
);

select is(
  (select matched_row_no from vd_pass_again),
  2,
  'ia melunasi baris kembar berikutnya, bukan baris yang sudah PASS'
);

select is(
  (
    select result::text from public.verify_delivery_label(
      (select id from vd_session),
      '10015|TIDAK-ADA T9XW9 L=9MM|2000|DBT-512 NI-2445-240826-B009|24-AUG-2026'
    )
  ),
  'not_pass',
  'Qty sama dengan ukuran berbeda tidak cukup untuk PASS'
);

select is(
  (
    select result::text from public.verify_delivery_label(
      (select id from vd_session),
      '10015|VS-B T0.3XW100 L=120MM|dua ribu|DBT-512|24-AUG-2026'
    )
  ),
  'unknown_label',
  'Qty yang bukan bilangan bulat dilaporkan sebagai QR tak terbaca'
);

select is(
  (
    select result::text from public.verify_delivery_label(
      (select id from vd_session), '10015|VS-B T0.3XW100 L=120MM'
    )
  ),
  'unknown_label',
  'payload kurang dari tiga field dilaporkan sebagai QR tak terbaca'
);

create temporary table vd_row3 as
select * from public.verify_delivery_label(
  (select id from vd_session),
  '10015|VS-B T0.3XW60 L=110MM|2000|DBT-512 NI-2445-240826-B002|24-AUG-2026'
);
grant select on vd_row3 to public;

select is(
  (select result from vd_row3)::text,
  'pass',
  'ejaan berspasi ganda dan huruf kecil di jadwal tetap cocok'
);

select is(
  (select matched_row_no from vd_row3),
  3,
  'baris ketiga yang terisi'
);

-- Jadwal menulis 'L=55 MM', label menulis 'L=55MM'. Spasi diabaikan kedua sisi,
-- jadi baris ini PASS. Sebelum pelonggaran ini ia tidak akan pernah PASS, dan
-- gagalnya baru ketahuan setelah seluruh truk diperiksa.
create temporary table vd_last as
select * from public.verify_delivery_label(
  (select id from vd_session),
  '10015|VS-B T0.3XW80 L=55MM|2000|DBT-512 NI-2445-240826-B003|24-AUG-2026'
);
grant select on vd_last to public;

select is(
  (select result from vd_last)::text,
  'pass',
  'jadwal berspasi cocok dengan label yang menulisnya rapat'
);

select is(
  (select matched_row_no from vd_last),
  4,
  'baris keempat yang terisi'
);

select is(
  (select delivery_ok from vd_last),
  true,
  'baris terakhir yang PASS menutup jadwal: DELIVERY OK'
);

select is(
  (
    select status::text from public.delivery_verification_sessions
    where id = (select id from vd_session)
  ),
  'done',
  'session ikut selesai pada scan yang sama'
);

select is(
  (
    select count(*)::integer from public.delivery_verification_scans
    where session_id = (select id from vd_session)
  ),
  7,
  'ketujuh scan tercatat, termasuk yang NOT PASS dan yang tak terbaca'
);

select is(
  (
    select count(*)::integer from public.delivery_verification_scans
    where session_id = (select id from vd_session)
      and label_box_id is not null
  ),
  0,
  'tidak ada scan yang menunjuk label_boxes lagi'
);

reset role;

select setval(
  'public.delivery_verification_session_seq',
  (select last_value from verify_seq_before),
  (select is_called from verify_seq_before)
);

select * from finish();

rollback;
