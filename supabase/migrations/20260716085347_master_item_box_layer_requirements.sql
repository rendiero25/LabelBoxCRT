-- Master Item requirement edits reuse the existing normalized Box Definition
-- graph.  The public RPC is the only mutation boundary so mapping activation,
-- layer persistence, and audit history commit or roll back together.

create or replace function private.validate_box_definition_payload(
  p_master_item_id uuid,
  p_layers jsonb
)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  layer_record record;
  requirement_record record;
  normalized_layer_name text;
  product_text text;
  product_id uuid;
  expected_qty_text text;
  expected_qty integer;
  layer_product_ids uuid[];
begin
  if p_master_item_id is null
    or not exists (
      select 1
      from public.master_items item
      where item.id = p_master_item_id and item.is_active
    ) then
    raise exception using errcode = 'P0001', message = 'BOX_DEFINITION_MASTER_ITEM_NOT_FOUND';
  end if;

  if coalesce(jsonb_typeof(p_layers), '') <> 'array'
    or jsonb_array_length(p_layers) = 0
    or jsonb_array_length(p_layers) > 10 then
    raise exception using errcode = 'P0001', message = 'BOX_DEFINITION_INPUT_INVALID';
  end if;

  for layer_record in
    select layer.value, layer.ordinality
    from jsonb_array_elements(p_layers) with ordinality as layer(value, ordinality)
  loop
    if jsonb_typeof(layer_record.value) <> 'object'
      or jsonb_typeof(layer_record.value -> 'name') <> 'string'
      or coalesce(jsonb_typeof(layer_record.value -> 'requirements'), '') <> 'array'
      or jsonb_array_length(layer_record.value -> 'requirements') = 0 then
      raise exception using errcode = 'P0001', message = 'BOX_DEFINITION_INPUT_INVALID';
    end if;

    normalized_layer_name := btrim(layer_record.value ->> 'name');
    if normalized_layer_name = '' or char_length(normalized_layer_name) > 200 then
      raise exception using errcode = 'P0001', message = 'BOX_DEFINITION_INPUT_INVALID';
    end if;

    layer_product_ids := array[]::uuid[];
    for requirement_record in
      select requirement.value, requirement.ordinality
      from jsonb_array_elements(layer_record.value -> 'requirements') with ordinality
        as requirement(value, ordinality)
    loop
      if jsonb_typeof(requirement_record.value) <> 'object'
        or jsonb_typeof(requirement_record.value -> 'product_id') <> 'string'
        or jsonb_typeof(requirement_record.value -> 'expected_qty') <> 'number' then
        raise exception using errcode = 'P0001', message = 'BOX_DEFINITION_INPUT_INVALID';
      end if;

      product_text := requirement_record.value ->> 'product_id';
      expected_qty_text := requirement_record.value ->> 'expected_qty';
      begin
        product_id := product_text::uuid;
      exception when invalid_text_representation then
        raise exception using errcode = 'P0001', message = 'BOX_DEFINITION_INPUT_INVALID';
      end;

      if expected_qty_text !~ '^[0-9]+$'
        or char_length(expected_qty_text) > 7 then
        raise exception using errcode = 'P0001', message = 'BOX_DEFINITION_INPUT_INVALID';
      end if;

      expected_qty := expected_qty_text::integer;
      if expected_qty < 1 or expected_qty > 1000000 then
        raise exception using errcode = 'P0001', message = 'BOX_DEFINITION_INPUT_INVALID';
      end if;

      if product_id = any(layer_product_ids) then
        raise exception using errcode = 'P0001', message = 'BOX_DEFINITION_INPUT_INVALID';
      end if;
      layer_product_ids := array_append(layer_product_ids, product_id);

      if not exists (
        select 1
        from public.products product
        where product.id = product_id and product.is_active
      ) or not exists (
        select 1
        from public.master_item_products mapping
        where mapping.master_item_id = p_master_item_id
          and mapping.product_id = product_id
          and mapping.is_active
      ) then
        raise exception using errcode = 'P0001', message = 'BOX_DEFINITION_PRODUCT_NOT_ALLOWED';
      end if;
    end loop;
  end loop;
end;
$$;

create or replace function private.sync_master_item_product_mappings(
  p_master_item_id uuid,
  p_layers jsonb
)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  layer_record record;
  requirement_record record;
  product_text text;
  product_id uuid;
begin
  if p_master_item_id is null
    or not exists (
      select 1
      from public.master_items item
      where item.id = p_master_item_id and item.is_active
    ) then
    raise exception using errcode = 'P0001', message = 'MASTER_ITEM_BOX_REQUIREMENTS_INPUT_INVALID';
  end if;

  if coalesce(jsonb_typeof(p_layers), '') <> 'array'
    or jsonb_array_length(p_layers) = 0
    or jsonb_array_length(p_layers) > 10 then
    raise exception using errcode = 'P0001', message = 'MASTER_ITEM_BOX_REQUIREMENTS_INPUT_INVALID';
  end if;

  for layer_record in
    select layer.value
    from jsonb_array_elements(p_layers) as layer(value)
  loop
    if jsonb_typeof(layer_record.value) <> 'object'
      or coalesce(jsonb_typeof(layer_record.value -> 'requirements'), '') <> 'array'
      or jsonb_array_length(layer_record.value -> 'requirements') = 0 then
      raise exception using errcode = 'P0001', message = 'MASTER_ITEM_BOX_REQUIREMENTS_INPUT_INVALID';
    end if;

    for requirement_record in
      select requirement.value
      from jsonb_array_elements(layer_record.value -> 'requirements') as requirement(value)
    loop
      if jsonb_typeof(requirement_record.value) <> 'object'
        or jsonb_typeof(requirement_record.value -> 'product_id') <> 'string' then
        raise exception using errcode = 'P0001', message = 'MASTER_ITEM_BOX_REQUIREMENTS_INPUT_INVALID';
      end if;

      product_text := requirement_record.value ->> 'product_id';
      begin
        product_id := product_text::uuid;
      exception when invalid_text_representation then
        raise exception using errcode = 'P0001', message = 'MASTER_ITEM_BOX_REQUIREMENTS_INPUT_INVALID';
      end;

      if not exists (
        select 1
        from public.products product
        where product.id = product_id and product.is_active
      ) then
        raise exception using errcode = 'P0001', message = 'MASTER_ITEM_BOX_REQUIREMENTS_PRODUCT_INVALID';
      end if;

      insert into public.master_item_products (master_item_id, product_id, is_active)
      values (p_master_item_id, product_id, true)
      on conflict (master_item_id, product_id) do update
      set is_active = true
      where not public.master_item_products.is_active;
    end loop;
  end loop;
end;
$$;

create or replace function public.save_master_item_box_requirements(
  p_master_item_id uuid,
  p_box_definition_id uuid,
  p_layers jsonb
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  target_definition public.box_definitions%rowtype;
begin
  if not private.is_active_admin() then
    raise exception using errcode = 'P0001', message = 'MASTER_ITEM_BOX_REQUIREMENTS_ADMIN_REQUIRED';
  end if;

  select * into target_definition
  from public.box_definitions definition
  where definition.id = p_box_definition_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'MASTER_ITEM_BOX_REQUIREMENTS_INPUT_INVALID';
  end if;

  if target_definition.master_item_id <> p_master_item_id then
    raise exception using errcode = 'P0001', message = 'MASTER_ITEM_BOX_DEFINITION_MISMATCH';
  end if;

  if exists (
    select 1
    from public.packing_sessions session
    where session.box_definition_id = p_box_definition_id
  ) then
    raise exception using errcode = 'P0001', message = 'MASTER_ITEM_BOX_DEFINITION_IN_USE';
  end if;

  perform private.sync_master_item_product_mappings(p_master_item_id, p_layers);
  perform private.validate_box_definition_payload(p_master_item_id, p_layers);

  delete from public.box_layer_requirements requirement
  using public.box_layers layer
  where requirement.box_layer_id = layer.id
    and layer.box_definition_id = p_box_definition_id;

  delete from public.box_layers layer
  where layer.box_definition_id = p_box_definition_id;

  perform private.persist_box_definition_layers(p_box_definition_id, p_layers);

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    auth.uid(),
    'master_item.box_requirements_updated',
    'box_definition',
    p_box_definition_id::text,
    jsonb_build_object(
      'master_item_id', p_master_item_id,
      'layer_count', jsonb_array_length(p_layers)
    )
  );

  return p_box_definition_id;
end;
$$;

revoke execute on function private.sync_master_item_product_mappings(uuid, jsonb)
  from public, anon, authenticated;
revoke execute on function public.save_master_item_box_requirements(uuid, uuid, jsonb)
  from public, anon;

grant execute on function public.save_master_item_box_requirements(uuid, uuid, jsonb)
  to authenticated;
