-- Box Definition mutations are only available through these audited RPCs. The
-- nested layer payload is validated before it is persisted so a client cannot
-- bypass the activation validator with malformed draft content.

drop policy if exists box_definitions_insert on public.box_definitions;
drop policy if exists box_definitions_update on public.box_definitions;
drop policy if exists box_definitions_delete on public.box_definitions;
drop policy if exists box_layers_insert on public.box_layers;
drop policy if exists box_layers_update on public.box_layers;
drop policy if exists box_layers_delete on public.box_layers;
drop policy if exists box_layer_requirements_insert on public.box_layer_requirements;
drop policy if exists box_layer_requirements_update on public.box_layer_requirements;
drop policy if exists box_layer_requirements_delete on public.box_layer_requirements;

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

create or replace function private.persist_box_definition_layers(
  p_box_definition_id uuid,
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
  target_layer_id uuid;
begin
  for layer_record in
    select layer.value, layer.ordinality
    from jsonb_array_elements(p_layers) with ordinality as layer(value, ordinality)
  loop
    insert into public.box_layers (
      box_definition_id,
      layer_no,
      layer_name,
      sort_order
    ) values (
      p_box_definition_id,
      layer_record.ordinality::integer,
      btrim(layer_record.value ->> 'name'),
      layer_record.ordinality::integer
    ) returning id into target_layer_id;

    for requirement_record in
      select requirement.value, requirement.ordinality
      from jsonb_array_elements(layer_record.value -> 'requirements') with ordinality
        as requirement(value, ordinality)
    loop
      insert into public.box_layer_requirements (
        box_layer_id,
        product_id,
        expected_qty,
        sort_order
      ) values (
        target_layer_id,
        (requirement_record.value ->> 'product_id')::uuid,
        (requirement_record.value ->> 'expected_qty')::integer,
        requirement_record.ordinality::integer
      );
    end loop;
  end loop;
end;
$$;

create or replace function public.create_box_definition(
  p_master_item_id uuid,
  p_box_code text,
  p_box_name text,
  p_layers jsonb
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  normalized_box_code text := upper(btrim(p_box_code));
  normalized_box_name text := btrim(p_box_name);
  target_box_definition_id uuid;
begin
  if not private.is_active_admin() then
    raise exception using errcode = 'P0001', message = 'BOX_DEFINITION_ADMIN_REQUIRED';
  end if;

  if normalized_box_code = ''
    or char_length(normalized_box_code) > 64
    or normalized_box_name = ''
    or char_length(normalized_box_name) > 200 then
    raise exception using errcode = 'P0001', message = 'BOX_DEFINITION_INPUT_INVALID';
  end if;

  perform private.validate_box_definition_payload(p_master_item_id, p_layers);

  begin
    insert into public.box_definitions (
      master_item_id,
      box_code,
      box_name,
      version,
      is_active
    ) values (
      p_master_item_id,
      normalized_box_code,
      normalized_box_name,
      1,
      false
    ) returning id into target_box_definition_id;
  exception when unique_violation then
    raise exception using errcode = 'P0001', message = 'BOX_DEFINITION_VERSION_EXISTS';
  end;

  perform private.persist_box_definition_layers(target_box_definition_id, p_layers);

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    auth.uid(),
    'box_definition.created',
    'box_definition',
    target_box_definition_id::text,
    jsonb_build_object(
      'box_code', normalized_box_code,
      'version', 1,
      'master_item_id', p_master_item_id
    )
  );

  return target_box_definition_id;
end;
$$;

create or replace function public.update_box_definition(
  p_box_definition_id uuid,
  p_box_code text,
  p_box_name text,
  p_layers jsonb
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  target_definition public.box_definitions%rowtype;
  normalized_box_code text := upper(btrim(p_box_code));
  normalized_box_name text := btrim(p_box_name);
begin
  if not private.is_active_admin() then
    raise exception using errcode = 'P0001', message = 'BOX_DEFINITION_ADMIN_REQUIRED';
  end if;

  if normalized_box_code = ''
    or char_length(normalized_box_code) > 64
    or normalized_box_name = ''
    or char_length(normalized_box_name) > 200 then
    raise exception using errcode = 'P0001', message = 'BOX_DEFINITION_INPUT_INVALID';
  end if;

  select * into target_definition
  from public.box_definitions definition
  where definition.id = p_box_definition_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'BOX_DEFINITION_NOT_FOUND';
  end if;

  if exists (
    select 1
    from public.packing_sessions session
    where session.box_definition_id = p_box_definition_id
  ) then
    raise exception using errcode = 'P0001', message = 'BOX_DEFINITION_IN_USE';
  end if;

  perform private.validate_box_definition_payload(target_definition.master_item_id, p_layers);

  begin
    update public.box_definitions
    set box_code = normalized_box_code,
        box_name = normalized_box_name
    where id = p_box_definition_id;
  exception when unique_violation then
    raise exception using errcode = 'P0001', message = 'BOX_DEFINITION_VERSION_EXISTS';
  end;

  delete from public.box_layer_requirements requirement
  using public.box_layers layer
  where requirement.box_layer_id = layer.id
    and layer.box_definition_id = p_box_definition_id;
  delete from public.box_layers
  where box_definition_id = p_box_definition_id;

  perform private.persist_box_definition_layers(p_box_definition_id, p_layers);

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    auth.uid(),
    'box_definition.updated',
    'box_definition',
    p_box_definition_id::text,
    jsonb_build_object(
      'box_code', normalized_box_code,
      'version', target_definition.version,
      'master_item_id', target_definition.master_item_id
    )
  );

  return p_box_definition_id;
end;
$$;

create or replace function public.publish_box_definition(
  p_box_definition_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if not private.is_active_admin() then
    raise exception using errcode = 'P0001', message = 'BOX_DEFINITION_ADMIN_REQUIRED';
  end if;

  return private.activate_box_definition(p_box_definition_id, gen_random_uuid());
end;
$$;

create or replace function public.clone_box_definition_version(
  p_box_definition_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  source_definition public.box_definitions%rowtype;
  source_layer record;
  source_requirement record;
  target_layer_id uuid;
  target_box_definition_id uuid;
  target_version integer;
begin
  if not private.is_active_admin() then
    raise exception using errcode = 'P0001', message = 'BOX_DEFINITION_ADMIN_REQUIRED';
  end if;

  select * into source_definition
  from public.box_definitions definition
  where definition.id = p_box_definition_id;

  if not found then
    raise exception using errcode = 'P0001', message = 'BOX_DEFINITION_NOT_FOUND';
  end if;

  -- All versions of a master-item/normalized-box-code family contend on this
  -- transaction-scoped key before any row locks are acquired.  This prevents
  -- sibling clones from taking source and family row locks in inverse order.
  perform pg_advisory_xact_lock(
    hashtextextended(
      source_definition.master_item_id::text
        || ':'
        || lower(btrim(source_definition.box_code)),
      0
    )
  );

  perform 1
  from public.box_definitions definition
  where definition.master_item_id = source_definition.master_item_id
    and lower(btrim(definition.box_code)) = lower(btrim(source_definition.box_code))
  order by definition.id
  for update;

  select coalesce(max(definition.version), 0) + 1 into target_version
  from public.box_definitions definition
  where definition.master_item_id = source_definition.master_item_id
    and lower(btrim(definition.box_code)) = lower(btrim(source_definition.box_code));

  insert into public.box_definitions (
    master_item_id,
    box_code,
    box_name,
    version,
    is_active
  ) values (
    source_definition.master_item_id,
    source_definition.box_code,
    source_definition.box_name,
    target_version,
    false
  ) returning id into target_box_definition_id;

  for source_layer in
    select layer.id, layer.layer_no, layer.layer_name, layer.sort_order, layer.is_active
    from public.box_layers layer
    where layer.box_definition_id = source_definition.id
    order by layer.sort_order
  loop
    insert into public.box_layers (
      box_definition_id,
      layer_no,
      layer_name,
      sort_order,
      is_active
    ) values (
      target_box_definition_id,
      source_layer.layer_no,
      source_layer.layer_name,
      source_layer.sort_order,
      source_layer.is_active
    ) returning id into target_layer_id;

    for source_requirement in
      select requirement.product_id, requirement.expected_qty, requirement.sort_order
      from public.box_layer_requirements requirement
      where requirement.box_layer_id = source_layer.id
      order by requirement.sort_order
    loop
      insert into public.box_layer_requirements (
        box_layer_id,
        product_id,
        expected_qty,
        sort_order
      ) values (
        target_layer_id,
        source_requirement.product_id,
        source_requirement.expected_qty,
        source_requirement.sort_order
      );
    end loop;
  end loop;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    auth.uid(),
    'box_definition.cloned',
    'box_definition',
    target_box_definition_id::text,
    jsonb_build_object(
      'box_code', source_definition.box_code,
      'version', target_version,
      'source_box_definition_id', source_definition.id
    )
  );

  return target_box_definition_id;
end;
$$;

revoke execute on function private.validate_box_definition_payload(uuid, jsonb)
  from public, anon, authenticated;
revoke execute on function private.persist_box_definition_layers(uuid, jsonb)
  from public, anon, authenticated;

revoke execute on function public.create_box_definition(uuid, text, text, jsonb)
  from public, anon;
revoke execute on function public.update_box_definition(uuid, text, text, jsonb)
  from public, anon;
revoke execute on function public.publish_box_definition(uuid)
  from public, anon;
revoke execute on function public.clone_box_definition_version(uuid)
  from public, anon;

grant execute on function public.create_box_definition(uuid, text, text, jsonb)
  to authenticated;
grant execute on function public.update_box_definition(uuid, text, text, jsonb)
  to authenticated;
grant execute on function public.publish_box_definition(uuid)
  to authenticated;
grant execute on function public.clone_box_definition_version(uuid)
  to authenticated;
