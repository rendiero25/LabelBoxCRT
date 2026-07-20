-- `product_id` was both a PL/pgSQL variable and a table column. PostgreSQL
-- rejects the unqualified reference at runtime, preventing valid box saves.
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
  parsed_product_id uuid;
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
    or jsonb_array_length(p_layers) = 0 then
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
        parsed_product_id := product_text::uuid;
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

      if parsed_product_id = any(layer_product_ids) then
        raise exception using errcode = 'P0001', message = 'BOX_DEFINITION_INPUT_INVALID';
      end if;
      layer_product_ids := array_append(layer_product_ids, parsed_product_id);

      if not exists (
        select 1
        from public.products product
        where product.id = parsed_product_id and product.is_active
      ) or not exists (
        select 1
        from public.master_item_products mapping
        where mapping.master_item_id = p_master_item_id
          and mapping.product_id = parsed_product_id
          and mapping.is_active
      ) then
        raise exception using errcode = 'P0001', message = 'BOX_DEFINITION_PRODUCT_NOT_ALLOWED';
      end if;
    end loop;
  end loop;
end;
$$;
