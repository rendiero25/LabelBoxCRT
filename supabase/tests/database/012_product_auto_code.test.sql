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
  array['text', 'text', 'numeric', 'numeric', 'numeric'],
  'create_product only accepts product details'
);

-- Capture what the RPC returns rather than looking the row back up by
-- part_name: part_name is not unique, and the dev database already holds
-- several products sharing these names.
select lives_ok(
  $$ create temporary table product_auto_code_first as
     select * from public.create_product('VO-B', 'Tube', 6, 7, 525) $$,
  'admin creates a product without providing a code'
);

select matches(
  (select product_code from product_auto_code_first),
  '^prd-[0-9]{6,}$',
  'first automatic product code uses the required format'
);

select lives_ok(
  $$ create temporary table product_auto_code_second as
     select * from public.create_product('VO-C', 'Tube Assy', 6, 7, 530) $$,
  'admin creates a second product without providing a code'
);

select isnt(
  (select product_code from product_auto_code_first),
  (select product_code from product_auto_code_second),
  'automatic product codes are unique'
);

reset role;

select * from finish();

rollback;
