-- Master Items remain in the database for packing and print history. Sequence
-- scope is intentionally not implemented here; item_sequence_code is metadata
-- only until the Phase 6 scope decision is approved.

create or replace function public.create_master_item(
  p_item_code text,
  p_part_no text,
  p_part_name text,
  p_unit text,
  p_default_label_qty integer,
  p_item_sequence_code text default null
)
returns table (
  id uuid,
  item_code text,
  part_no text,
  part_name text,
  unit text,
  default_label_qty integer,
  item_sequence_code text,
  is_active boolean,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  normalized_item_code text := lower(btrim(p_item_code));
  normalized_part_no text := upper(btrim(p_part_no));
  normalized_part_name text := btrim(p_part_name);
  normalized_unit text := initcap(lower(btrim(p_unit)));
  normalized_sequence_code text := upper(btrim(coalesce(p_item_sequence_code, '')));
  violated_constraint text;
begin
  if not private.is_active_admin() then
    raise exception using errcode = 'P0001', message = 'MASTER_ITEM_ADMIN_REQUIRED';
  end if;

  if normalized_item_code !~ '^[a-z0-9][a-z0-9_-]{1,63}$'
    or normalized_part_no !~ '^[A-Z0-9][A-Z0-9_./-]{1,127}$'
    or normalized_part_name = ''
    or char_length(normalized_part_name) > 200
    or normalized_unit !~ '^[A-Za-z][A-Za-z ./-]{0,31}$'
    or p_default_label_qty is null or p_default_label_qty < 1 or p_default_label_qty > 1000000
    or (normalized_sequence_code <> '' and normalized_sequence_code !~ '^[A-Z0-9][A-Z0-9_-]{1,63}$') then
    raise exception using errcode = 'P0001', message = 'MASTER_ITEM_INPUT_INVALID';
  end if;

  begin
    insert into public.master_items (
      item_code, part_no, part_name, unit, default_label_qty, item_sequence_code
    ) values (
      normalized_item_code, normalized_part_no, normalized_part_name, normalized_unit,
      p_default_label_qty, nullif(normalized_sequence_code, '')
    ) returning * into id, item_code, part_no, part_name, unit, default_label_qty,
      item_sequence_code, is_active, created_at, updated_at;
  exception when unique_violation then
    get stacked diagnostics violated_constraint = constraint_name;
    raise exception using errcode = 'P0001', message = case
      when violated_constraint = 'master_items_item_code_key' then 'MASTER_ITEM_CODE_EXISTS'
      else 'MASTER_ITEM_PART_NO_EXISTS'
    end;
  end;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    auth.uid(), 'master_item.created', 'master_item', id::text,
    jsonb_build_object(
      'item_code', item_code,
      'part_no', part_no,
      'default_label_qty', default_label_qty,
      'item_sequence_code', item_sequence_code
    )
  );

  return next;
end;
$$;

create or replace function public.update_master_item(
  p_master_item_id uuid,
  p_item_code text,
  p_part_no text,
  p_part_name text,
  p_unit text,
  p_default_label_qty integer,
  p_item_sequence_code text default null
)
returns table (
  id uuid,
  item_code text,
  part_no text,
  part_name text,
  unit text,
  default_label_qty integer,
  item_sequence_code text,
  is_active boolean,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  normalized_item_code text := lower(btrim(p_item_code));
  normalized_part_no text := upper(btrim(p_part_no));
  normalized_part_name text := btrim(p_part_name);
  normalized_unit text := initcap(lower(btrim(p_unit)));
  normalized_sequence_code text := upper(btrim(coalesce(p_item_sequence_code, '')));
  violated_constraint text;
begin
  if not private.is_active_admin() then
    raise exception using errcode = 'P0001', message = 'MASTER_ITEM_ADMIN_REQUIRED';
  end if;

  if normalized_item_code !~ '^[a-z0-9][a-z0-9_-]{1,63}$'
    or normalized_part_no !~ '^[A-Z0-9][A-Z0-9_./-]{1,127}$'
    or normalized_part_name = ''
    or char_length(normalized_part_name) > 200
    or normalized_unit !~ '^[A-Za-z][A-Za-z ./-]{0,31}$'
    or p_default_label_qty is null or p_default_label_qty < 1 or p_default_label_qty > 1000000
    or (normalized_sequence_code <> '' and normalized_sequence_code !~ '^[A-Z0-9][A-Z0-9_-]{1,63}$') then
    raise exception using errcode = 'P0001', message = 'MASTER_ITEM_INPUT_INVALID';
  end if;

  if exists (
    select 1 from public.packing_sessions
    where master_item_id = p_master_item_id
  ) then
    raise exception using errcode = 'P0001', message = 'MASTER_ITEM_IN_USE';
  end if;

  begin
    update public.master_items
    set item_code = normalized_item_code,
        part_no = normalized_part_no,
        part_name = normalized_part_name,
        unit = normalized_unit,
        default_label_qty = p_default_label_qty,
        item_sequence_code = nullif(normalized_sequence_code, '')
    where public.master_items.id = p_master_item_id
    returning * into id, item_code, part_no, part_name, unit, default_label_qty,
      item_sequence_code, is_active, created_at, updated_at;
  exception when unique_violation then
    get stacked diagnostics violated_constraint = constraint_name;
    raise exception using errcode = 'P0001', message = case
      when violated_constraint = 'master_items_item_code_key' then 'MASTER_ITEM_CODE_EXISTS'
      else 'MASTER_ITEM_PART_NO_EXISTS'
    end;
  end;

  if not found then
    raise exception using errcode = 'P0001', message = 'MASTER_ITEM_NOT_FOUND';
  end if;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    auth.uid(), 'master_item.updated', 'master_item', id::text,
    jsonb_build_object(
      'item_code', item_code,
      'part_no', part_no,
      'default_label_qty', default_label_qty,
      'item_sequence_code', item_sequence_code
    )
  );

  return next;
end;
$$;

create or replace function public.set_master_item_active(
  p_master_item_id uuid,
  p_is_active boolean
)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  target_code text;
begin
  if not private.is_active_admin() then
    raise exception using errcode = 'P0001', message = 'MASTER_ITEM_ADMIN_REQUIRED';
  end if;

  update public.master_items
  set is_active = p_is_active
  where public.master_items.id = p_master_item_id
  returning item_code into target_code;

  if not found then
    raise exception using errcode = 'P0001', message = 'MASTER_ITEM_NOT_FOUND';
  end if;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    auth.uid(),
    case when p_is_active then 'master_item.activated' else 'master_item.deactivated' end,
    'master_item', p_master_item_id::text,
    jsonb_build_object('item_code', target_code)
  );
end;
$$;

revoke execute on function public.create_master_item(text, text, text, text, integer, text) from public, anon;
revoke execute on function public.update_master_item(uuid, text, text, text, text, integer, text) from public, anon;
revoke execute on function public.set_master_item_active(uuid, boolean) from public, anon;

grant execute on function public.create_master_item(text, text, text, text, integer, text) to authenticated;
grant execute on function public.update_master_item(uuid, text, text, text, text, integer, text) to authenticated;
grant execute on function public.set_master_item_active(uuid, boolean) to authenticated;
