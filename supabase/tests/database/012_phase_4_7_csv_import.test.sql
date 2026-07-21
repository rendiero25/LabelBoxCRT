begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;

select plan(12);

insert into auth.users (
  id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '91200000-0000-0000-0000-000000000001',
  'authenticated',
  'authenticated',
  'phase47-admin@example.test',
  '{}'::jsonb,
  '{}'::jsonb,
  now(),
  now()
);

insert into public.profiles (id, display_name, role, is_active) values (
  '91200000-0000-0000-0000-000000000001',
  'Phase 4.7 Admin',
  'admin',
  true
);

insert into public.suppliers (supplier_code, supplier_name) values
  ('EXISTING', 'Existing Supplier');

select has_function(
  'public',
  'preview_csv_import',
  array['text', 'jsonb'],
  'CSV preview RPC exists'
);

select has_function(
  'public',
  'import_csv_master_data',
  array['text', 'jsonb', 'uuid'],
  'CSV import RPC exists'
);

select set_config(
  'request.jwt.claim.sub',
  '91200000-0000-0000-0000-000000000001',
  true
);
set local role authenticated;

select is(
  (
    select count(*)::integer
    from public.preview_csv_import(
      'supplier',
      '[{"line":2,"supplier_code":"CSV-100","supplier_name":"CSV Supplier"}]'::jsonb
    )
    where cardinality(errors) > 0
  ),
  0,
  'valid supplier row has no preview errors'
);

select ok(
  exists (
    select 1
    from public.preview_csv_import(
      'supplier',
      '[{"line":2,"supplier_code":"EXISTING","supplier_name":"Duplicate"}]'::jsonb
    )
    where row_number = 2
      and 'Kode supplier sudah digunakan.' = any(errors)
  ),
  'preview returns duplicate error on source row'
);

select lives_ok(
  $$
    select public.import_csv_master_data(
      'supplier',
      '[{"line":2,"supplier_code":"CSV-100","supplier_name":"CSV Supplier"}]'::jsonb,
      '91200000-0000-0000-0000-000000000099'
    )
  $$,
  'admin imports one valid supplier'
);

select is(
  (
    select count(*)::integer
    from public.suppliers
    where supplier_code = 'CSV-100'
  ),
  1,
  'import creates supplier'
);

select ok(
  exists (
    select 1
    from public.audit_logs
    where action = 'csv_import.completed'
      and entity_type = 'csv_import'
      and metadata @> '{"template":"supplier","row_count":1}'::jsonb
  ),
  'import appends aggregate audit event'
);

select throws_ok(
  $$
    select public.import_csv_master_data(
      'supplier',
      '[
        {"line":2,"supplier_code":"CSV-ATOMIC","supplier_name":"Must Rollback"},
        {"line":3,"supplier_code":"EXISTING","supplier_name":"Duplicate"}
      ]'::jsonb,
      '91200000-0000-0000-0000-000000000098'
    )
  $$,
  'P0001',
  'CSV_IMPORT_PREVIEW_INVALID',
  'invalid source row aborts import'
);

select is(
  (
    select count(*)::integer
    from public.suppliers
    where supplier_code = 'CSV-ATOMIC'
  ),
  0,
  'transaction does not keep earlier valid rows after an error'
);

select ok(
  exists (
    select 1
    from public.preview_csv_import(
      'product_mapping',
      '[{"line":2,"item_code":"missing-item","product_code":"missing-product"}]'::jsonb
    )
    where 'Master Item aktif tidak ditemukan.' = any(errors)
      and 'Produk aktif tidak ditemukan.' = any(errors)
  ),
  'preview validates Product Mapping references'
);

select lives_ok(
  $$
    select public.import_csv_master_data(
      'delivery_number',
      '[{"line":2,"supplier_code":"CSV-100","delivery_number":"DN-CSV-100","delivery_date":"2026-07-20","status":"active"}]'::jsonb,
      '91200000-0000-0000-0000-000000000097'
    )
  $$,
  'import resolves active supplier for Delivery Number'
);

select is(
  (
    select count(*)::integer
    from public.delivery_numbers delivery
    join public.suppliers supplier on supplier.id = delivery.supplier_id
    where supplier.supplier_code = 'CSV-100'
      and delivery.delivery_number = 'DN-CSV-100'
      and delivery.status = 'active'
  ),
  1,
  'import creates Delivery Number with selected status'
);

reset role;

select * from finish();
rollback;
