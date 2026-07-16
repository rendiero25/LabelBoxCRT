begin;

create extension if not exists pgtap with schema extensions;

select plan(5);

insert into auth.users (
  id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '94000000-0000-0000-0000-000000000001',
  'authenticated',
  'authenticated',
  'product-code-admin@example.test',
  '{}'::jsonb,
  '{}'::jsonb,
  now(),
  now()
);

insert into public.profiles (id, display_name, role, is_active) values (
  '94000000-0000-0000-0000-000000000001',
  'Product Code Admin',
  'admin',
  true
);

select set_config(
  'request.jwt.claim.sub',
  '94000000-0000-0000-0000-000000000001',
  true
);
set local role authenticated;

select has_function(
  'public',
  'create_product',
  array['text', 'numeric', 'numeric', 'numeric'],
  'create_product only accepts product details'
);

select lives_ok(
  $$ select public.create_product('VO-B', 6, 7, 525) $$,
  'admin creates a product without providing a code'
);

select matches(
  (select product_code from public.products where part_name = 'VO-B'),
  '^prd-[0-9]{6,}$',
  'first automatic product code uses the required format'
);

select lives_ok(
  $$ select public.create_product('VO-C', 6, 7, 530) $$,
  'admin creates a second product without providing a code'
);

select isnt(
  (select product_code from public.products where part_name = 'VO-B'),
  (select product_code from public.products where part_name = 'VO-C'),
  'automatic product codes are unique'
);

reset role;

select * from finish();

rollback;
