-- Asserts the development seed baseline (supabase/seed.sql) is present.
--
-- The B101 box assertions that used to live here are gone: migration
-- 20260723150000_box_owned_by_master_item.sql truncated boxes/box_layers and
-- dropped master_item_boxes, and seed.sql has not been updated for the new
-- shape (it still writes master_items.item_sequence_code, boxes.is_active and
-- master_item_boxes, and calls the dropped private.validate_master_item_box /
-- private.activate_master_item_box). There is no box seed left to assert.
-- The current Box/Layer shape is covered by 018_box_owned_by_master_item.

begin;

create extension if not exists pgtap with schema extensions;

select plan(8);

select results_eq(
  $$ select p.role::text from public.profiles p join auth.users u on u.id = p.id where lower(u.email) = 'admin@crtkabelita.com' $$,
  array['admin'::text],
  'admin profile is seeded'
);

select results_eq(
  $$ select p.role::text from public.profiles p join auth.users u on u.id = p.id where lower(u.email) = 'user@crtkabelita.com' $$,
  array['user'::text],
  'operator profile is seeded'
);

select results_eq(
  $$ select supplier_code from public.suppliers where supplier_code = '10015' and is_active $$,
  array['10015'::text],
  'supplier 10015 is seeded and active'
);

-- is_active is deliberately not asserted here: the seed creates the product
-- active, but it is ordinary master data an admin may deactivate from the UI.
-- What the seed owns is the dimension triple.
select results_eq(
  $$ select product_code from public.products where product_code = 'tube-0001' and outer_diameter = 6.3 and inner_diameter = 5.5 and length = 205 $$,
  array['tube-0001'::text],
  'development product dimensions are seeded as outer x inner x length'
);

-- part_no and is_active are deliberately not asserted here, for the same
-- reason they are left out of the product assertion above: Part No became
-- editable from the admin UI (20260819090000_master_item_part_no_allow_space)
-- and a Master Item that already has shipping history can be archived from it
-- (20260819200000_master_item_soft_delete), which also clears is_active. Both
-- have since happened to this row in the dev project. What the seed owns is
-- the identity of the row, and that row stays put as the anchor of its own
-- history.
select results_eq(
  $$ select item_code from public.master_items where item_code = 'dm-0001' $$,
  array['dm-0001'::text],
  'master item is seeded'
);

select results_eq(
  $$ select count(*)::bigint from public.master_item_products mapping join public.master_items item on item.id = mapping.master_item_id join public.products product on product.id = mapping.product_id where item.item_code = 'dm-0001' and product.product_code = 'tube-0001' and mapping.is_active $$,
  array[1::bigint],
  'product is actively mapped to the master item'
);

select results_eq(
  $$ select delivery_number from public.delivery_numbers delivery join public.suppliers supplier on supplier.id = delivery.supplier_id where supplier.supplier_code = '10015' and delivery.delivery_number = 'DEV-DN-001' and delivery.status = 'active' $$,
  array['DEV-DN-001'::text],
  'development Delivery Number is seeded and active'
);

select results_eq(
  $$ select count(*)::bigint from public.suppliers where supplier_code = '10015' $$,
  array[1::bigint],
  'supplier seed identity remains unique'
);

select * from finish();
rollback;
