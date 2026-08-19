-- Part No Master Item boleh memuat spasi: create_master_item dan
-- update_master_item menerimanya, spasi berderet dirapatkan, dan pratinjau
-- impor CSV memakai aturan yang sama supaya baris yang sah tidak ditolak.
-- Migrasi: supabase/migrations/20260819090000_master_item_part_no_allow_space.sql

begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;

select plan(8);

insert into auth.users (
  id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '9d200000-0000-0000-0000-000000000001',
  'authenticated',
  'authenticated',
  'part-no-space-admin@example.test',
  '{}'::jsonb,
  '{}'::jsonb,
  now(),
  now()
);

insert into public.profiles (id, display_name, role, is_active) values (
  '9d200000-0000-0000-0000-000000000001',
  'Part No Space Admin',
  'admin',
  true
);

select set_config(
  'request.jwt.claim.sub',
  '9d200000-0000-0000-0000-000000000001',
  true
);
set local role authenticated;

select lives_ok(
  $$ select public.create_master_item('VO B 6X7', 'Part Berspasi', 'Pcs', 100) $$,
  'admin creates a master item whose part no carries a space'
);

select is(
  (select part_no from public.master_items where part_name = 'Part Berspasi'),
  'VO B 6X7',
  'the space is stored as typed'
);

-- Spasi berderet dirapatkan: dua ejaan yang hanya beda jumlah spasi tidak boleh
-- hidup sebagai dua Part No berbeda.
select lives_ok(
  $$ select public.create_master_item('  vo   c   6x7  ', 'Part Spasi Ganda', 'Pcs', 100) $$,
  'admin creates a master item written with padded and repeated spaces'
);

select is(
  (select part_no from public.master_items where part_name = 'Part Spasi Ganda'),
  'VO C 6X7',
  'repeated spaces collapse and the ends are trimmed'
);

select throws_ok(
  $$ select public.create_master_item(' ', 'Part Kosong', 'Pcs', 100) $$,
  'MASTER_ITEM_INPUT_INVALID',
  'a part no made of nothing but spaces is still rejected'
);

select lives_ok(
  $$ select public.update_master_item(
    (select id from public.master_items where part_name = 'Part Berspasi'),
    'VO B 6X7 REV2',
    'Part Berspasi',
    'Pcs',
    100
  ) $$,
  'admin updates a master item to another part no that carries spaces'
);

select is(
  (select part_no from public.master_items where part_name = 'Part Berspasi'),
  'VO B 6X7 REV2',
  'the updated part no keeps its spaces'
);

-- Pratinjau CSV memakai pola yang sama; kalau tidak, baris yang diterima
-- formulir admin akan ditolak sebelum sempat diimpor.
select is_empty(
  $$
  select unnest(errors)
  from public.preview_csv_import(
    'master_item',
    jsonb_build_array(
      jsonb_build_object(
        'line', '2',
        'item_code', 'mstritem-space-1',
        'part_no', 'VO D 6X7',
        'part_name', 'Part CSV Berspasi',
        'unit', 'Pcs',
        'default_label_qty', '100'
      )
    )
  )
  $$,
  'csv preview accepts a part no that carries a space'
);

reset role;

select * from finish();

rollback;
