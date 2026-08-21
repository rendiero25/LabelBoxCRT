-- Kode produk melebar setelah prd-999999, bukan dipotong balik jadi enam digit.
--
-- Cacat yang sama dengan 20260821011700_box_code_widens_past_99.sql dan
-- 20260821015137_master_item_code_widens_past_99.sql, di pembangkit kode
-- Product: `lpad(teks, 6, '0')` di Postgres MEMOTONG ketika teksnya lebih
-- panjang dari lebar yang diminta, jadi begitu product_code_sequence lewat
-- 999999, nilai 1000000..1000009 semuanya menjadi 'prd-100000'.

begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;

select plan(5);

-- Parkir product_code_sequence tepat di 999999 supaya dua create di bawah
-- menyeberangi batas enam digit: 999999 lalu 1000000. Di situlah
-- lpad(teks, 6, '0') memotong dan mengembalikan 'prd-100000'. Nilai aslinya
-- dikembalikan di akhir file -- setval tidak ikut rollback, jadi ia harus
-- dipulangkan sendiri.
create temporary table product_code_sequence_before as
select last_value, is_called from public.product_code_sequence;

select setval('public.product_code_sequence', 999999, false);

insert into auth.users (
  id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '9e280000-0000-0000-0000-000000000001',
  'authenticated',
  'authenticated',
  'product-code-widen-admin@example.test',
  '{}'::jsonb,
  '{}'::jsonb,
  now(),
  now()
);

insert into public.profiles (id, display_name, role, is_active) values (
  '9e280000-0000-0000-0000-000000000001',
  'Product Code Widen Admin',
  'admin',
  true
);

select set_config(
  'request.jwt.claim.sub',
  '9e280000-0000-0000-0000-000000000001',
  true
);
set local role authenticated;

-- Menangkap nilai balik RPC, bukan mencari lewat part_name: part_name tidak
-- unik dan database dev sudah menyimpan beberapa produk dengan nama itu.
select lives_ok(
  $$ create temporary table product_code_at_limit as
     select * from public.create_product('WIDEN-A', 'Tube', 6, 7, 525) $$,
  'admin creates a product while the sequence sits at the six-digit limit'
);

select is(
  (select product_code from product_code_at_limit),
  'prd-999999',
  'the last code that still fits the pad width is unchanged'
);

select lives_ok(
  $$ create temporary table product_code_past_limit as
     select * from public.create_product('WIDEN-B', 'Tube Assy', 6, 7, 530) $$,
  'admin creates the product that crosses the six-digit limit'
);

select is(
  (select product_code from product_code_past_limit),
  'prd-1000000',
  'the code after prd-999999 widens instead of truncating back to prd-100000'
);

select isnt(
  (select product_code from product_code_at_limit),
  (select product_code from product_code_past_limit),
  'automatic product codes stay unique across the six-digit limit'
);

reset role;

select setval(
  'public.product_code_sequence',
  (select last_value from product_code_sequence_before),
  (select is_called from product_code_sequence_before)
);

select * from finish();

rollback;
