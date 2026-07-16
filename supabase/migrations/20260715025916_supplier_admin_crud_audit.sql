-- Supplier records are retained for historical delivery-number integrity.
-- There is deliberately no delete function: delivery_numbers.supplier_id uses
-- ON DELETE RESTRICT and the admin UI offers deactivation instead.

create or replace function public.create_supplier(
  p_supplier_code text,
  p_supplier_name text
)
returns table (
  id uuid,
  supplier_code text,
  supplier_name text,
  is_active boolean,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  normalized_code text := upper(btrim(p_supplier_code));
  normalized_name text := btrim(p_supplier_name);
begin
  if not private.is_active_admin() then
    raise exception using errcode = 'P0001', message = 'SUPPLIER_ADMIN_REQUIRED';
  end if;

  if normalized_code !~ '^[A-Z0-9_-]{2,64}$'
    or normalized_name = ''
    or char_length(normalized_name) > 200 then
    raise exception using errcode = 'P0001', message = 'SUPPLIER_INPUT_INVALID';
  end if;

  begin
    insert into public.suppliers (supplier_code, supplier_name)
    values (normalized_code, normalized_name)
    returning * into id, supplier_code, supplier_name, is_active, created_at, updated_at;
  exception when unique_violation then
    raise exception using errcode = 'P0001', message = 'SUPPLIER_CODE_EXISTS';
  end;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    auth.uid(), 'supplier.created', 'supplier', id::text,
    jsonb_build_object('supplier_code', supplier_code, 'supplier_name', supplier_name)
  );

  return next;
end;
$$;

create or replace function public.update_supplier(
  p_supplier_id uuid,
  p_supplier_code text,
  p_supplier_name text
)
returns table (
  id uuid,
  supplier_code text,
  supplier_name text,
  is_active boolean,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  normalized_code text := upper(btrim(p_supplier_code));
  normalized_name text := btrim(p_supplier_name);
begin
  if not private.is_active_admin() then
    raise exception using errcode = 'P0001', message = 'SUPPLIER_ADMIN_REQUIRED';
  end if;

  if normalized_code !~ '^[A-Z0-9_-]{2,64}$'
    or normalized_name = ''
    or char_length(normalized_name) > 200 then
    raise exception using errcode = 'P0001', message = 'SUPPLIER_INPUT_INVALID';
  end if;

  begin
    update public.suppliers
    set supplier_code = normalized_code, supplier_name = normalized_name
    where public.suppliers.id = p_supplier_id
    returning * into id, supplier_code, supplier_name, is_active, created_at, updated_at;
  exception when unique_violation then
    raise exception using errcode = 'P0001', message = 'SUPPLIER_CODE_EXISTS';
  end;

  if not found then
    raise exception using errcode = 'P0001', message = 'SUPPLIER_NOT_FOUND';
  end if;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    auth.uid(), 'supplier.updated', 'supplier', id::text,
    jsonb_build_object('supplier_code', supplier_code, 'supplier_name', supplier_name)
  );

  return next;
end;
$$;

create or replace function public.set_supplier_active(
  p_supplier_id uuid,
  p_is_active boolean
)
returns table (
  id uuid,
  supplier_code text,
  supplier_name text,
  is_active boolean,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if not private.is_active_admin() then
    raise exception using errcode = 'P0001', message = 'SUPPLIER_ADMIN_REQUIRED';
  end if;

  update public.suppliers
  set is_active = p_is_active
  where public.suppliers.id = p_supplier_id
  returning * into id, supplier_code, supplier_name, is_active, created_at, updated_at;

  if not found then
    raise exception using errcode = 'P0001', message = 'SUPPLIER_NOT_FOUND';
  end if;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    auth.uid(),
    case when is_active then 'supplier.activated' else 'supplier.deactivated' end,
    'supplier', id::text,
    jsonb_build_object('supplier_code', supplier_code)
  );

  return next;
end;
$$;

revoke execute on function public.create_supplier(text, text) from public, anon;
revoke execute on function public.update_supplier(uuid, text, text) from public, anon;
revoke execute on function public.set_supplier_active(uuid, boolean) from public, anon;

grant execute on function public.create_supplier(text, text) to authenticated;
grant execute on function public.update_supplier(uuid, text, text) to authenticated;
grant execute on function public.set_supplier_active(uuid, boolean) to authenticated;
