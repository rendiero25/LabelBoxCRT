begin;

create extension if not exists pgtap with schema extensions;

select plan(12);

select results_eq(
  $$ select p.role::text from public.profiles p join auth.users u on u.id = p.id where lower(u.email) = 'admin@crtkabelita.com' $$,
  array['admin'::text],
  'admin profile is seeded'
);

select results_eq(
  $$ select p.role::text from public.profiles p join auth.users u on u.id = p.id where lower(u.email) = 'user@crtkabelita.com' $$,
  array['operator'::text],
  'operator profile is seeded'
);

select results_eq(
  $$ select supplier_code from public.suppliers where supplier_code = '10015' and is_active $$,
  array['10015'::text],
  'supplier 10015 is seeded and active'
);

select results_eq(
  $$ select product_code from public.products where product_code = 'tube-0001' and outer_diameter = 6.3 and inner_diameter = 5.5 and length = 205 and is_active $$,
  array['tube-0001'::text],
  'development product dimensions are seeded as outer x inner x length'
);

select results_eq(
  $$ select part_no from public.master_items where item_code = 'dm-0001' and is_active $$,
  array['3210A-K1Z-NA01-DL'::text],
  'master item and authoritative Part No are seeded'
);

select results_eq(
  $$ select count(*)::bigint from public.master_item_products mapping join public.master_items item on item.id = mapping.master_item_id join public.products product on product.id = mapping.product_id where item.item_code = 'dm-0001' and product.product_code = 'tube-0001' and mapping.is_active $$,
  array[1::bigint],
  'product is actively mapped to the master item'
);

select results_eq(
  $$ select assignment.version from public.master_item_boxes assignment join public.master_items item on item.id = assignment.master_item_id join public.boxes box on box.id = assignment.box_id where item.item_code = 'dm-0001' and box.box_code = 'B101' and assignment.is_active $$,
  array[1],
  'B101 version 1 is active'
);

select is(
  (select array_agg(requirement.expected_qty order by layer.layer_no) from public.box_layer_requirements requirement join public.box_layers layer on layer.id = requirement.box_layer_id join public.master_item_boxes assignment on assignment.id = requirement.master_item_box_id join public.master_items item on item.id = assignment.master_item_id join public.boxes box on box.id = assignment.box_id where item.item_code = 'dm-0001' and box.box_code = 'B101' and assignment.version = 1),
  array[3, 5],
  'B101 development layers require 3 and 5 units'
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

select results_eq(
  $$ select count(*)::bigint from public.master_item_boxes assignment join public.master_items item on item.id = assignment.master_item_id join public.boxes box on box.id = assignment.box_id where item.item_code = 'dm-0001' and box.box_code = 'B101' and assignment.version = 1 $$,
  array[1::bigint],
  'box assignment seed identity remains unique'
);

select results_eq(
  $$ select count(*)::bigint from public.box_layers layer join public.boxes box on box.id = layer.box_id where box.box_code = 'B101' $$,
  array[2::bigint],
  'B101 seed has exactly two layers'
);

select * from finish();
rollback;
