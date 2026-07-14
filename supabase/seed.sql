begin;

do $$
declare
  admin_user_id uuid;
  operator_user_id uuid;
  supplier_row_id uuid;
  product_row_id uuid;
  master_item_row_id uuid;
  box_definition_row_id uuid;
  layer_1_row_id uuid;
  layer_2_row_id uuid;
  validation_result jsonb;
begin
  select id into admin_user_id
  from auth.users
  where lower(email) = 'admin@crtkabelita.com';

  select id into operator_user_id
  from auth.users
  where lower(email) = 'user@crtkabelita.com';

  if admin_user_id is null then
    raise exception using
      errcode = '22023',
      message = 'SEED_AUTH_USER_MISSING: admin@crtkabelita.com';
  end if;

  if operator_user_id is null then
    raise exception using
      errcode = '22023',
      message = 'SEED_AUTH_USER_MISSING: user@crtkabelita.com';
  end if;

  insert into public.profiles (id, display_name, role, is_active)
  values (admin_user_id, 'Label Box Admin', 'admin', true)
  on conflict (id) do update set
    display_name = excluded.display_name,
    role = excluded.role,
    is_active = true;

  insert into public.profiles (id, display_name, role, is_active)
  values (operator_user_id, 'Label Box Operator', 'operator', true)
  on conflict (id) do update set
    display_name = excluded.display_name,
    role = excluded.role,
    is_active = true;

  select id into supplier_row_id
  from public.suppliers
  where lower(btrim(supplier_code)) = '10015';

  if supplier_row_id is null then
    insert into public.suppliers (supplier_code, supplier_name, is_active)
    values ('10015', 'PT Supplier DEV SAMPLE', true)
    returning id into supplier_row_id;
  else
    update public.suppliers
    set supplier_code = '10015', supplier_name = 'PT Supplier DEV SAMPLE', is_active = true
    where id = supplier_row_id;
  end if;

  -- DEV SAMPLE only. Dimensions are outer diameter x inner diameter x length
  -- from the supplied QR example; they are not approved production master data.
  select id into product_row_id
  from public.products
  where lower(btrim(product_code)) = 'tube-0001';

  if product_row_id is null then
    insert into public.products (
      product_code, part_name, outer_diameter, inner_diameter, length, is_active
    ) values ('tube-0001', 'Tube DEV SAMPLE', 6.3, 5.5, 205, true)
    returning id into product_row_id;
  else
    update public.products
    set part_name = 'Tube DEV SAMPLE',
        outer_diameter = 6.3,
        inner_diameter = 5.5,
        length = 205,
        is_active = true
    where id = product_row_id;
  end if;

  select id into master_item_row_id
  from public.master_items
  where lower(btrim(item_code)) = 'dm-0001';

  if master_item_row_id is null then
    insert into public.master_items (
      item_code, part_no, part_name, unit, default_label_qty,
      item_sequence_code, is_active
    ) values (
      'dm-0001', '3210A-K1Z-NA01-DL', 'Tube Assy DEV SAMPLE', 'Pcs',
      100, null, true
    ) returning id into master_item_row_id;
  else
    update public.master_items
    set part_no = '3210A-K1Z-NA01-DL',
        part_name = 'Tube Assy DEV SAMPLE',
        unit = 'Pcs',
        default_label_qty = 100,
        is_active = true
    where id = master_item_row_id;
  end if;

  insert into public.master_item_products (master_item_id, product_id, is_active)
  values (master_item_row_id, product_row_id, true)
  on conflict (master_item_id, product_id) do update set is_active = true;

  select id into box_definition_row_id
  from public.box_definitions
  where master_item_id = master_item_row_id
    and lower(btrim(box_code)) = 'b101'
    and version = 1;

  if box_definition_row_id is null then
    insert into public.box_definitions (
      master_item_id, box_code, box_name, version, is_active
    ) values (
      master_item_row_id, 'B101', 'B101 DEV SAMPLE', 1, false
    ) returning id into box_definition_row_id;
  else
    update public.box_definitions
    set box_name = 'B101 DEV SAMPLE'
    where id = box_definition_row_id;
  end if;

  insert into public.box_layers (
    box_definition_id, layer_no, layer_name, sort_order, is_active
  ) values (
    box_definition_row_id, 1, 'Layer 1', 1, true
  ) on conflict (box_definition_id, layer_no) do update set
    layer_name = excluded.layer_name,
    sort_order = excluded.sort_order,
    is_active = true
  returning id into layer_1_row_id;

  insert into public.box_layers (
    box_definition_id, layer_no, layer_name, sort_order, is_active
  ) values (
    box_definition_row_id, 2, 'Layer 2', 2, true
  ) on conflict (box_definition_id, layer_no) do update set
    layer_name = excluded.layer_name,
    sort_order = excluded.sort_order,
    is_active = true
  returning id into layer_2_row_id;

  insert into public.box_layer_requirements (
    box_layer_id, product_id, expected_qty, sort_order
  ) values (layer_1_row_id, product_row_id, 3, 1)
  on conflict (box_layer_id, product_id) do update set
    expected_qty = excluded.expected_qty,
    sort_order = excluded.sort_order;

  insert into public.box_layer_requirements (
    box_layer_id, product_id, expected_qty, sort_order
  ) values (layer_2_row_id, product_row_id, 5, 1)
  on conflict (box_layer_id, product_id) do update set
    expected_qty = excluded.expected_qty,
    sort_order = excluded.sort_order;

  validation_result := private.validate_box_definition(box_definition_row_id);
  if not coalesce((validation_result ->> 'valid')::boolean, false) then
    raise exception using
      errcode = '22023',
      message = 'SEED_BOX_DEFINITION_INVALID',
      detail = validation_result::text;
  end if;

  if not (select is_active from public.box_definitions where id = box_definition_row_id) then
    perform set_config('request.jwt.claim.sub', admin_user_id::text, true);
    perform private.activate_box_definition(box_definition_row_id, gen_random_uuid());
  end if;

  if not exists (
    select 1 from public.delivery_numbers
    where supplier_id = supplier_row_id
      and lower(btrim(delivery_number)) = 'dev-dn-001'
  ) then
    insert into public.delivery_numbers (
      supplier_id, delivery_number, delivery_date, status, created_by
    ) values (
      supplier_row_id, 'DEV-DN-001', date '2026-07-14', 'active', admin_user_id
    );
  else
    update public.delivery_numbers
    set delivery_date = date '2026-07-14', status = 'active', created_by = admin_user_id
    where supplier_id = supplier_row_id
      and lower(btrim(delivery_number)) = 'dev-dn-001';
  end if;
end;
$$;

commit;
