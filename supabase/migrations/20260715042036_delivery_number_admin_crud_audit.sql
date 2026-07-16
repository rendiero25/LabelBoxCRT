-- Delivery Number status is terminal once closed or cancelled. The operator
-- policy already exposes only active Delivery Numbers paired with active suppliers.

create or replace function public.create_delivery_number(
  p_supplier_id uuid,
  p_delivery_number text,
  p_delivery_date date,
  p_status public.delivery_status default 'draft'
)
returns table (
  id uuid,
  supplier_id uuid,
  delivery_number text,
  delivery_date date,
  status public.delivery_status,
  created_by uuid,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  normalized_number text := upper(btrim(p_delivery_number));
begin
  if not private.is_active_admin() then
    raise exception using errcode = 'P0001', message = 'DELIVERY_NUMBER_ADMIN_REQUIRED';
  end if;

  if normalized_number !~ '^[A-Z0-9][A-Z0-9_/-]{1,99}$'
    or p_delivery_date is null
    or p_status not in ('draft', 'active') then
    raise exception using errcode = 'P0001', message = 'DELIVERY_NUMBER_INPUT_INVALID';
  end if;

  if not exists (
    select 1 from public.suppliers
    where public.suppliers.id = p_supplier_id and public.suppliers.is_active
  ) then
    raise exception using errcode = 'P0001', message = 'DELIVERY_NUMBER_SUPPLIER_INVALID';
  end if;

  begin
    insert into public.delivery_numbers (
      supplier_id, delivery_number, delivery_date, status, created_by
    ) values (
      p_supplier_id, normalized_number, p_delivery_date, p_status, auth.uid()
    ) returning * into id, supplier_id, delivery_number, delivery_date, status,
      created_by, created_at, updated_at;
  exception when unique_violation then
    raise exception using errcode = 'P0001', message = 'DELIVERY_NUMBER_EXISTS';
  end;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    auth.uid(), 'delivery_number.created', 'delivery_number', id::text,
    jsonb_build_object(
      'supplier_id', supplier_id,
      'delivery_number', delivery_number,
      'delivery_date', delivery_date,
      'status', status
    )
  );

  return next;
end;
$$;

create or replace function public.update_delivery_number(
  p_delivery_number_id uuid,
  p_supplier_id uuid,
  p_delivery_number text,
  p_delivery_date date
)
returns table (
  id uuid,
  supplier_id uuid,
  delivery_number text,
  delivery_date date,
  status public.delivery_status,
  created_by uuid,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  target public.delivery_numbers%rowtype;
  normalized_number text := upper(btrim(p_delivery_number));
begin
  if not private.is_active_admin() then
    raise exception using errcode = 'P0001', message = 'DELIVERY_NUMBER_ADMIN_REQUIRED';
  end if;

  if normalized_number !~ '^[A-Z0-9][A-Z0-9_/-]{1,99}$'
    or p_delivery_date is null then
    raise exception using errcode = 'P0001', message = 'DELIVERY_NUMBER_INPUT_INVALID';
  end if;

  select * into target from public.delivery_numbers
  where public.delivery_numbers.id = p_delivery_number_id for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'DELIVERY_NUMBER_NOT_FOUND';
  end if;

  if target.status in ('closed', 'cancelled') then
    raise exception using errcode = 'P0001', message = 'DELIVERY_NUMBER_TERMINAL';
  end if;

  if not exists (
    select 1 from public.suppliers
    where public.suppliers.id = p_supplier_id and public.suppliers.is_active
  ) then
    raise exception using errcode = 'P0001', message = 'DELIVERY_NUMBER_SUPPLIER_INVALID';
  end if;

  begin
    update public.delivery_numbers
    set supplier_id = p_supplier_id,
        delivery_number = normalized_number,
        delivery_date = p_delivery_date
    where public.delivery_numbers.id = p_delivery_number_id
    returning * into id, supplier_id, delivery_number, delivery_date, status,
      created_by, created_at, updated_at;
  exception when unique_violation then
    raise exception using errcode = 'P0001', message = 'DELIVERY_NUMBER_EXISTS';
  end;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    auth.uid(), 'delivery_number.updated', 'delivery_number', id::text,
    jsonb_build_object(
      'supplier_id', supplier_id,
      'delivery_number', delivery_number,
      'delivery_date', delivery_date
    )
  );

  return next;
end;
$$;

create or replace function public.close_or_cancel_delivery_number(
  p_delivery_number_id uuid,
  p_status public.delivery_status
)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  target public.delivery_numbers%rowtype;
begin
  if not private.is_active_admin() then
    raise exception using errcode = 'P0001', message = 'DELIVERY_NUMBER_ADMIN_REQUIRED';
  end if;

  if p_status not in ('closed', 'cancelled') then
    raise exception using errcode = 'P0001', message = 'DELIVERY_NUMBER_STATUS_INVALID';
  end if;

  select * into target from public.delivery_numbers
  where public.delivery_numbers.id = p_delivery_number_id for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'DELIVERY_NUMBER_NOT_FOUND';
  end if;

  if target.status in ('closed', 'cancelled') then
    raise exception using errcode = 'P0001', message = 'DELIVERY_NUMBER_TERMINAL';
  end if;

  update public.delivery_numbers
  set status = p_status
  where public.delivery_numbers.id = p_delivery_number_id;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    auth.uid(),
    case when p_status = 'closed' then 'delivery_number.closed' else 'delivery_number.cancelled' end,
    'delivery_number', p_delivery_number_id::text,
    jsonb_build_object('previous_status', target.status, 'status', p_status)
  );
end;
$$;

revoke execute on function public.create_delivery_number(uuid, text, date, public.delivery_status) from public, anon;
revoke execute on function public.update_delivery_number(uuid, uuid, text, date) from public, anon;
revoke execute on function public.close_or_cancel_delivery_number(uuid, public.delivery_status) from public, anon;

grant execute on function public.create_delivery_number(uuid, text, date, public.delivery_status) to authenticated;
grant execute on function public.update_delivery_number(uuid, uuid, text, date) to authenticated;
grant execute on function public.close_or_cancel_delivery_number(uuid, public.delivery_status) to authenticated;
