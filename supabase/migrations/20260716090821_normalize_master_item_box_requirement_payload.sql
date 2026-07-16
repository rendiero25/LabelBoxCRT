-- The admin form uses camelCase fields while the existing Box Definition
-- validators and persistence helpers intentionally use their snake_case SQL
-- contract. Normalize only at this public mutation boundary.

create or replace function private.normalize_master_item_box_requirement_payload(
  p_layers jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  layer_record record;
  requirement_record record;
  normalized_layers jsonb := '[]'::jsonb;
  normalized_requirements jsonb;
begin
  if coalesce(jsonb_typeof(p_layers), '') <> 'array' then
    return p_layers;
  end if;

  for layer_record in
    select layer.value
    from jsonb_array_elements(p_layers) as layer(value)
  loop
    if jsonb_typeof(layer_record.value) <> 'object'
      or coalesce(jsonb_typeof(layer_record.value -> 'requirements'), '') <> 'array' then
      return p_layers;
    end if;

    normalized_requirements := '[]'::jsonb;
    for requirement_record in
      select requirement.value
      from jsonb_array_elements(layer_record.value -> 'requirements') as requirement(value)
    loop
      if jsonb_typeof(requirement_record.value) <> 'object' then
        return p_layers;
      end if;

      normalized_requirements := normalized_requirements || jsonb_build_array(
        jsonb_build_object(
          'product_id',
          case
            when requirement_record.value ? 'productId'
              then requirement_record.value -> 'productId'
            else requirement_record.value -> 'product_id'
          end,
          'expected_qty',
          case
            when requirement_record.value ? 'expectedQty'
              then requirement_record.value -> 'expectedQty'
            else requirement_record.value -> 'expected_qty'
          end
        )
      );
    end loop;

    normalized_layers := normalized_layers || jsonb_build_array(
      jsonb_build_object(
        'name', layer_record.value -> 'name',
        'requirements', normalized_requirements
      )
    );
  end loop;

  return normalized_layers;
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
  normalized_layers jsonb;
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

  normalized_layers := private.normalize_master_item_box_requirement_payload(p_layers);

  perform private.sync_master_item_product_mappings(p_master_item_id, normalized_layers);
  perform private.validate_box_definition_payload(p_master_item_id, normalized_layers);

  delete from public.box_layer_requirements requirement
  using public.box_layers layer
  where requirement.box_layer_id = layer.id
    and layer.box_definition_id = p_box_definition_id;

  delete from public.box_layers layer
  where layer.box_definition_id = p_box_definition_id;

  perform private.persist_box_definition_layers(p_box_definition_id, normalized_layers);

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    auth.uid(),
    'master_item.box_requirements_updated',
    'box_definition',
    p_box_definition_id::text,
    jsonb_build_object(
      'master_item_id', p_master_item_id,
      'layer_count', jsonb_array_length(normalized_layers)
    )
  );

  return p_box_definition_id;
end;
$$;

revoke execute on function private.normalize_master_item_box_requirement_payload(jsonb)
  from public, anon, authenticated;
revoke execute on function public.save_master_item_box_requirements(uuid, uuid, jsonb)
  from public, anon;

grant execute on function public.save_master_item_box_requirements(uuid, uuid, jsonb)
  to authenticated;
