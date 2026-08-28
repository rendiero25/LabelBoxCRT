-- Verifikasi Pengiriman, Bagian 2: satu baris jadwal adalah satu kiriman yang
-- dipecah ke beberapa box menurut MPQ ukurannya.
-- Spec: docs/superpowers/specs/2026-08-21-verifikasi-pengiriman-design.md
--
-- Dua contoh dari lantai produksi yang dijaga file ini: 8000 keping dengan MPQ
-- 2000 harus discan empat kali, dan 7000 keping dengan MPQ 1500 harus discan
-- lima kali karena box kelima memuat sisa 1000. Yang kedua ditembak dengan box
-- sisa lebih dulu, sebab urutan operator mengambil box dari palet tidak diatur.
--
-- File ini sengaja tidak menyentuh master_items, boxes, label_box_batches,
-- maupun label_boxes: label sheet tidak dibuat aplikasi ini.

begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;

select plan(34);

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

-- MPQ dari ukuran uji. Ukuran ketiga ditulis berspasi di sini dan rapat di
-- labelnya nanti, meniru selisih ejaan yang benar-benar ada antara dokumen MPQ
-- dan label cetak.
insert into public.mpq_sheet_rows (row_no, product_size, mpq_qty, unit, is_active)
values
  (9001, 'UJI-A T1XW1 L=10MM', 2000, 'PCS/BOX', true),
  (9002, 'UJI-B T1XW1 L=20MM', 1500, 'PCS/BOX', true),
  (9003, 'UJI-C T1XW1 L=30 MM', 500, 'PCS/BOX', true),
  -- Nonaktif: jadwal baru harus memperlakukannya seperti belum punya MPQ sama
  -- sekali. Tanpa itu menonaktifkan cuma mengubah warna badge.
  (9004, 'UJI-D T1XW1 L=40MM', 400, 'PCS/BOX', false);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '91310000-0000-0000-0000-000000000001',
  true
);

create temporary table vd_session as
select * from public.create_delivery_verification_session();
grant select on vd_session to public;

-- Baris A habis dibagi MPQ-nya, baris B menyisakan satu box, baris C hanya satu
-- box penuh. Ketiganya berdampingan supaya satu scan tidak bisa "menemukan"
-- baris lain yang kebetulan cocok.
select public.add_delivery_schedule_rows(
  (select id from vd_session),
  'jadwal-vd.xlsx',
  '[{"customer": "PT. UJI SEJAHTERA",
     "productSize": "UJI-A T1XW1 L=10MM", "qty": "8000"},
    {"customer": "PT. UJI SEJAHTERA",
     "productSize": "UJI-B T1XW1 L=20MM", "qty": "7000"},
    {"customer": "PT. UJI LAINNYA",
     "productSize": "  uji-c   T1XW1 L=30MM ", "qty": "500"}]'::jsonb
);

select is(
  (
    select customer from public.delivery_schedule_rows
    where session_id = (select id from vd_session) and row_no = 3
  ),
  'PT. UJI LAINNYA',
  'Customer disimpan per baris: satu file memuat beberapa customer sekaligus'
);

select is(
  (
    select expected_boxes from public.delivery_schedule_rows
    where session_id = (select id from vd_session) and row_no = 1
  ),
  4,
  '8000 keping dengan MPQ 2000 berarti 4 box'
);

select is(
  (
    select expected_boxes from public.delivery_schedule_rows
    where session_id = (select id from vd_session) and row_no = 2
  ),
  5,
  '7000 keping dengan MPQ 1500 berarti 5 box: sisa 1000 minta box sendiri'
);

select is(
  (
    select mpq_qty from public.delivery_schedule_rows
    where session_id = (select id from vd_session) and row_no = 3
  ),
  500,
  'MPQ disalin ke baris jadwal meski ejaan spasinya berbeda'
);

-- Baris A: empat box penuh.
create temporary table vd_a1 as
select * from public.verify_delivery_label(
  (select id from vd_session),
  '10015|UJI-A T1XW1 L=10MM|2000|DBT-512|24-AUG-2026'
);
grant select on vd_a1 to public;

select is(
  (select result from vd_a1)::text,
  'pass',
  'box penuh pertama diterima'
);

select is(
  (select verified_boxes from vd_a1),
  1,
  'baru satu box dari empat yang masuk'
);

select is(
  (select row_done from vd_a1),
  false,
  'baris belum lunas selama box-nya masih kurang'
);

-- Box kedua ber-Qty setengah MPQ. Ditolak: menghitung banyaknya scan saja akan
-- meloloskan ini, dan kiriman 8000 keping berangkat dengan 5000.
select is(
  (
    select result::text from public.verify_delivery_label(
      (select id from vd_session),
      '10015|UJI-A T1XW1 L=10MM|1000|DBT-512|24-AUG-2026'
    )
  ),
  'not_pass',
  'Qty yang bukan MPQ dan bukan sisa ditolak'
);

create temporary table vd_a_wrong as
select * from public.verify_delivery_label(
  (select id from vd_session),
  '10015|UJI-A T1XW1 L=10MM|999|DBT-512|24-AUG-2026'
);
grant select on vd_a_wrong to public;

select is(
  (select full_box_qty from vd_a_wrong),
  2000,
  'penolakan menyebut Qty yang seharusnya, bukan NOT PASS belaka'
);

select is(
  (select last_box_qty from vd_a_wrong),
  null::integer,
  'baris yang habis dibagi MPQ tidak punya box sisa'
);

select public.verify_delivery_label(
  (select id from vd_session), '10015|UJI-A T1XW1 L=10MM|2000|DBT-512|24-AUG-2026'
);
select public.verify_delivery_label(
  (select id from vd_session), '10015|UJI-A T1XW1 L=10MM|2000|DBT-512|24-AUG-2026'
);

create temporary table vd_a4 as
select * from public.verify_delivery_label(
  (select id from vd_session),
  '10015|UJI-A T1XW1 L=10MM|2000|DBT-512|24-AUG-2026'
);
grant select on vd_a4 to public;

select is(
  (select row_done from vd_a4),
  true,
  'box keempat melunasi baris 8000 keping'
);

select is(
  (select verified_boxes from vd_a4),
  4,
  'keempat box tercatat'
);

-- Box kelima untuk ukuran yang sudah lengkap. Dibedakan dari NOT PASS biasa:
-- operator perlu tahu bahwa yang salah bukan labelnya melainkan bahwa kiriman
-- ini sudah cukup.
create temporary table vd_a5 as
select * from public.verify_delivery_label(
  (select id from vd_session),
  '10015|UJI-A T1XW1 L=10MM|2000|DBT-512|24-AUG-2026'
);
grant select on vd_a5 to public;

select is(
  (select result from vd_a5)::text,
  'not_pass',
  'box berlebih ditolak setelah barisnya lengkap'
);

select is(
  (select size_complete from vd_a5),
  true,
  'penolakannya menyebut bahwa ukuran ini sudah lengkap'
);

-- Baris B: box sisa ditembak lebih dulu.
create temporary table vd_b_rest as
select * from public.verify_delivery_label(
  (select id from vd_session),
  '10015|UJI-B T1XW1 L=20MM|1000|DBT-512|24-AUG-2026'
);
grant select on vd_b_rest to public;

select is(
  (select result from vd_b_rest)::text,
  'pass',
  'box sisa boleh ditembak lebih dulu'
);

-- Box sisa kedua. Ditolak: satu baris hanya punya satu sisa, dan menerimanya
-- dua kali berarti 7000 keping tidak akan pernah lunas dengan komposisi box
-- mana pun.
select is(
  (
    select result::text from public.verify_delivery_label(
      (select id from vd_session),
      '10015|UJI-B T1XW1 L=20MM|1000|DBT-512|24-AUG-2026'
    )
  ),
  'not_pass',
  'box sisa kedua ditolak'
);

select public.verify_delivery_label(
  (select id from vd_session), '10015|UJI-B T1XW1 L=20MM|1500|DBT-512|24-AUG-2026'
);
select public.verify_delivery_label(
  (select id from vd_session), '10015|UJI-B T1XW1 L=20MM|1500|DBT-512|24-AUG-2026'
);
select public.verify_delivery_label(
  (select id from vd_session), '10015|UJI-B T1XW1 L=20MM|1500|DBT-512|24-AUG-2026'
);

create temporary table vd_b_last as
select * from public.verify_delivery_label(
  (select id from vd_session),
  '10015|UJI-B T1XW1 L=20MM|1500|DBT-512|24-AUG-2026'
);
grant select on vd_b_last to public;

select is(
  (select verified_boxes from vd_b_last),
  5,
  'empat box penuh dan satu box sisa menutup baris 7000 keping'
);

select is(
  (
    select verified_qty from public.delivery_schedule_rows
    where session_id = (select id from vd_session) and row_no = 2
  ),
  7000,
  'jumlah keping yang masuk sama persis dengan Qty Delivery'
);

select is(
  (select delivery_ok from vd_b_last),
  false,
  'baris ketiga belum discan, jadi belum DELIVERY OK'
);

-- Diuji selagi session masih terbuka: session yang sudah selesai menolak scan
-- lebih dulu, jadi setelah baris terakhir lunas payload rusak pun tidak sampai
-- ke pembacaan QR-nya.
select is(
  (
    select result::text from public.verify_delivery_label(
      (select id from vd_session), '10015|UJI-A T1XW1 L=10MM'
    )
  ),
  'unknown_label',
  'payload kurang dari tiga field tetap dilaporkan sebagai QR tak terbaca'
);

-- Baris C: jadwal berspasi, label rapat.
create temporary table vd_c as
select * from public.verify_delivery_label(
  (select id from vd_session),
  '10015|UJI-C T1XW1 L=30MM|500|DBT-512|24-AUG-2026'
);
grant select on vd_c to public;

select is(
  (select delivery_ok from vd_c),
  true,
  'box terakhir menutup seluruh jadwal: DELIVERY OK'
);

select is(
  (select total_count from vd_c),
  10,
  'hitungannya box, bukan baris: 4 + 5 + 1'
);

select is(
  (
    select status::text from public.delivery_verification_sessions
    where id = (select id from vd_session)
  ),
  'done',
  'session ikut selesai pada box terakhir'
);

-- Ukuran sheet yang belum ada di MPQ Sheet tetap masuk jadwal. Menolak seluruh
-- file berarti tidak ada jadwal yang bisa diunggah sampai daftar MPQ dikejar --
-- pada DO Report nyata, delapan dari tiga belas baris sheet belum punya MPQ.
-- Yang dijaga di sini: barisnya terlihat, tidak bisa discan, dan menahan
-- session tetap terbuka. Kurangnya terlihat, bukan hilang.
create temporary table vd_session2 as
select * from public.create_delivery_verification_session();
grant select on vd_session2 to public;

select public.add_delivery_schedule_rows(
  (select id from vd_session2),
  'jadwal-asing.xlsx',
  '[{"productSize": "UJI-A T1XW1 L=10MM", "qty": "2000"},
    {"productSize": "TANPA-MPQ T9XW9 L=99MM", "qty": "100"},
    {"productSize": "UJI-D T1XW1 L=40MM", "qty": "800"}]'::jsonb
);

select is(
  (
    select count(*)::integer from public.delivery_schedule_rows
    where session_id = (select id from vd_session2)
  ),
  3,
  'ukuran tanpa MPQ tetap masuk jadwal, tidak menggagalkan filenya'
);

select is(
  (
    select mpq_qty from public.delivery_schedule_rows
    where session_id = (select id from vd_session2) and row_no = 3
  ),
  null::integer,
  'MPQ yang dinonaktifkan tidak dipakai jadwal baru'
);

select is(
  (
    select mpq_qty from public.delivery_schedule_rows
    where session_id = (select id from vd_session2) and row_no = 2
  ),
  null::integer,
  'MPQ-nya kosong, bukan ditebak'
);

select is(
  (
    select expected_boxes from public.delivery_schedule_rows
    where session_id = (select id from vd_session2) and row_no = 2
  ),
  null::integer,
  'jumlah box tak diketahui ditulis null, bukan 1 -- 100 keping tidak lunas oleh satu label'
);

create temporary table vd_no_mpq as
select * from public.verify_delivery_label(
  (select id from vd_session2),
  '10015|TANPA-MPQ T9XW9 L=99MM|100|DBT-512|24-AUG-2026'
);
grant select on vd_no_mpq to public;

select is(
  (select result from vd_no_mpq)::text,
  'not_pass',
  'baris tanpa MPQ tidak bisa dicocokkan: tidak ada Qty yang bisa disebut sah'
);

select is(
  (select mpq_missing from vd_no_mpq),
  true,
  'penolakannya menyebut bahwa yang kurang data master, bukan labelnya'
);

-- Baris pertama lunas oleh satu box, tetapi baris kedua menahan session.
create temporary table vd_session2_done as
select * from public.verify_delivery_label(
  (select id from vd_session2),
  '10015|UJI-A T1XW1 L=10MM|2000|DBT-512|24-AUG-2026'
);
grant select on vd_session2_done to public;

select is(
  (select delivery_ok from vd_session2_done),
  false,
  'session tidak bisa DELIVERY OK selama masih ada ukuran tanpa MPQ'
);

-- MPQ ditambahkan sesudah jadwalnya diunggah. Tanpa jalan mengisinya, satu
-- angka yang terlambat berarti seluruh file harus diunggah ulang ke session
-- baru.
reset role;
insert into public.mpq_sheet_rows (row_no, product_size, mpq_qty, unit)
values (9005, 'TANPA-MPQ T9XW9 L=99MM', 50, 'PCS/BOX');

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '91310000-0000-0000-0000-000000000001',
  true
);

-- Baris yang MPQ-nya dinonaktifkan tetap dilewati: nonaktif berarti tidak
-- dipakai, bukan dipakai lewat pintu belakang.
select is(
  public.refresh_delivery_schedule_mpq((select id from vd_session2)),
  1,
  'satu baris terisi; yang MPQ-nya nonaktif tidak ikut'
);

select is(
  (
    select mpq_qty from public.delivery_schedule_rows
    where session_id = (select id from vd_session2) and row_no = 2
  ),
  50,
  'MPQ yang terlambat masuk terisi tanpa mengunggah ulang jadwalnya'
);

select is(
  (
    select expected_boxes from public.delivery_schedule_rows
    where session_id = (select id from vd_session2) and row_no = 2
  ),
  2,
  '100 keping dengan MPQ 50 langsung terbaca sebagai 2 box'
);

-- Baris pertama sudah lunas dengan MPQ 2000. Kalau angka di MPQ Sheet berubah,
-- baris itu tidak boleh ikut berubah -- pemeriksaan yang sudah terjadi tidak
-- boleh dihitung ulang dengan aturan baru.
select is(
  (
    select mpq_qty from public.delivery_schedule_rows
    where session_id = (select id from vd_session2) and row_no = 1
  ),
  2000,
  'baris yang sudah punya MPQ tidak ditimpa'
);

reset role;

select setval(
  'public.delivery_verification_session_seq',
  (select last_value from verify_seq_before),
  (select is_called from verify_seq_before)
);

select * from finish();

rollback;
