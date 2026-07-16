-- Product Mapping is retained as history. Active mappings define which Product
-- may be accepted for a Master Item; inactive mappings can be reactivated but
-- are never duplicated or deleted from the admin UI.

drop policy if exists master_item_products_insert on public.master_item_products;
drop policy if exists master_item_products_update on public.master_item_products;
drop policy if exists master_item_products_delete on public.master_item_products;

create or replace function public.create_master_item_product_mapping(
  p_master_item_id uuid,
  p_product_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  target_mapping_id uuid;
  mapping_is_active boolean;
  target_item_code text;
  target_part_no text;
  target_product_code text;
  audit_action text;
begin
  if not private.is_active_admin() then
    raise exception using errcode = 'P0001', message = 'PRODUCT_MAPPING_ADMIN_REQUIRED';
  end if;

  if p_master_item_id is null or p_product_id is null then
    raise exception using errcode = 'P0001', message = 'PRODUCT_MAPPING_INPUT_INVALID';
  end if;

  select item_code, part_no
  into target_item_code, target_part_no
  from public.master_items
  where id = p_master_item_id and is_active
  for key share;

  if not found then
    raise exception using errcode = 'P0001', message = 'PRODUCT_MAPPING_MASTER_ITEM_NOT_FOUND';
  end if;

  select product_code
  into target_product_code
  from public.products
  where id = p_product_id and is_active
  for key share;

  if not found then
    raise exception using errcode = 'P0001', message = 'PRODUCT_MAPPING_PRODUCT_NOT_FOUND';
  end if;

  select id, is_active
  into target_mapping_id, mapping_is_active
  from public.master_item_products
  where master_item_id = p_master_item_id and product_id = p_product_id
  for update;

  if found then
    if mapping_is_active then
      raise exception using errcode = 'P0001', message = 'PRODUCT_MAPPING_EXISTS';
    end if;

    update public.master_item_products
    set is_active = true
    where id = target_mapping_id;

    audit_action := 'product_mapping.reactivated';
  else
    begin
      insert into public.master_item_products (master_item_id, product_id)
      values (p_master_item_id, p_product_id)
      returning id into target_mapping_id;

      audit_action := 'product_mapping.created';
    exception when unique_violation then
      select id, is_active
      into target_mapping_id, mapping_is_active
      from public.master_item_products
      where master_item_id = p_master_item_id and product_id = p_product_id
      for update;

      if mapping_is_active then
        raise exception using errcode = 'P0001', message = 'PRODUCT_MAPPING_EXISTS';
      end if;

      update public.master_item_products
      set is_active = true
      where id = target_mapping_id;

      audit_action := 'product_mapping.reactivated';
    end;
  end if;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    auth.uid(),
    audit_action,
    'master_item_product',
    target_mapping_id::text,
    jsonb_build_object(
      'master_item_id', p_master_item_id,
      'item_code', target_item_code,
      'part_no', target_part_no,
      'product_id', p_product_id,
      'product_code', target_product_code
    )
  );
end;
$$;

create or replace function public.set_master_item_product_active(
  p_mapping_id uuid,
  p_is_active boolean
)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  target_item_code text;
  target_product_code text;
begin
  if not private.is_active_admin() then
    raise exception using errcode = 'P0001', message = 'PRODUCT_MAPPING_ADMIN_REQUIRED';
  end if;

  if p_mapping_id is null or p_is_active is null then
    raise exception using errcode = 'P0001', message = 'PRODUCT_MAPPING_INPUT_INVALID';
  end if;

  select item.item_code, product.product_code
  into target_item_code, target_product_code
  from public.master_item_products mapping
  join public.master_items item on item.id = mapping.master_item_id
  join public.products product on product.id = mapping.product_id
  where mapping.id = p_mapping_id
  for update of mapping;

  if not found then
    raise exception using errcode = 'P0001', message = 'PRODUCT_MAPPING_NOT_FOUND';
  end if;

  if p_is_active and (
    not exists (
      select 1 from public.master_item_products mapping
      join public.master_items item on item.id = mapping.master_item_id
      where mapping.id = p_mapping_id and item.is_active
    )
    or not exists (
      select 1 from public.master_item_products mapping
      join public.products product on product.id = mapping.product_id
      where mapping.id = p_mapping_id and product.is_active
    )
  ) then
    raise exception using errcode = 'P0001', message = 'PRODUCT_MAPPING_INPUT_INVALID';
  end if;

  update public.master_item_products
  set is_active = p_is_active
  where id = p_mapping_id;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    auth.uid(),
    case when p_is_active then 'product_mapping.activated' else 'product_mapping.deactivated' end,
    'master_item_product',
    p_mapping_id::text,
    jsonb_build_object(
      'item_code', target_item_code,
      'product_code', target_product_code,
      'is_active', p_is_active
    )
  );
end;
$$;

revoke execute on function public.create_master_item_product_mapping(uuid, uuid) from public, anon;
revoke execute on function public.set_master_item_product_active(uuid, boolean) from public, anon;

grant execute on function public.create_master_item_product_mapping(uuid, uuid) to authenticated;
grant execute on function public.set_master_item_product_active(uuid, boolean) to authenticated;
