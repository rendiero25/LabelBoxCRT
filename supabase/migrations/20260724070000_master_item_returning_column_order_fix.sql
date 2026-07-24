-- Corrective migration: 20260724060000_master_item_supplier_and_delete.sql
-- used `returning * into (...)` in create_master_item/update_master_item.
-- `returning *` yields columns in the table's PHYSICAL column order, not the
-- order written in the INTO list -- and `alter table ... add column
-- supplier_id` appended supplier_id at the end of that physical order, not
-- where it was written in RETURNS TABLE. The two lists were therefore
-- misaligned, so `is_active` (boolean, text 't'/'f') was assigned into the
-- `supplier_id` uuid variable, raising "invalid input syntax for type uuid:
-- t". Fix: list explicit columns on both sides of `returning ... into ...`
-- so positions match by declaration, not by physical storage order. No
-- signature change, so create or replace is safe here.

create or replace function public.create_master_item(
  p_part_no text,
  p_part_name text,
  p_unit text,
  p_default_label_qty integer,
  p_item_code text default null,
  p_supplier_id uuid default null
)
returns table (
  id uuid,
  item_code text,
  part_no text,
  part_name text,
  unit text,
  default_label_qty integer,
  supplier_id uuid,
  is_active boolean,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  normalized_item_code text := nullif(lower(btrim(coalesce(p_item_code, ''))), '');
  normalized_part_no text := upper(btrim(p_part_no));
  normalized_part_name text := btrim(p_part_name);
  normalized_unit text := initcap(lower(btrim(p_unit)));
  candidate_code text;
  violated_constraint text;
begin
  if not private.is_active_admin() then
    raise exception using errcode = 'P0001', message = 'MASTER_ITEM_ADMIN_REQUIRED';
  end if;

  if (normalized_item_code is not null and normalized_item_code !~ '^[a-z0-9][a-z0-9_-]{1,63}$')
    or normalized_part_no !~ '^[A-Z0-9][A-Z0-9_./-]{1,127}$'
    or normalized_part_name = ''
    or char_length(normalized_part_name) > 200
    or normalized_unit !~ '^[A-Za-z][A-Za-z ./-]{0,31}$'
    or p_default_label_qty is null or p_default_label_qty < 1 or p_default_label_qty > 1000000 then
    raise exception using errcode = 'P0001', message = 'MASTER_ITEM_INPUT_INVALID';
  end if;

  if p_supplier_id is not null and not exists (
    select 1 from public.suppliers supplier
    where supplier.id = p_supplier_id and supplier.is_active
  ) then
    raise exception using errcode = 'P0001', message = 'MASTER_ITEM_SUPPLIER_NOT_FOUND';
  end if;

  if normalized_item_code is null then
    loop
      candidate_code := 'mstritem-' || lpad(nextval('public.master_item_code_seq')::text, 2, '0');

      begin
        insert into public.master_items (item_code, part_no, part_name, unit, default_label_qty, supplier_id)
        values (candidate_code, normalized_part_no, normalized_part_name, normalized_unit, p_default_label_qty, p_supplier_id)
        returning
          public.master_items.id, public.master_items.item_code, public.master_items.part_no,
          public.master_items.part_name, public.master_items.unit, public.master_items.default_label_qty,
          public.master_items.supplier_id, public.master_items.is_active, public.master_items.created_at,
          public.master_items.updated_at
        into
          id, item_code, part_no, part_name, unit, default_label_qty, supplier_id,
          is_active, created_at, updated_at;
        exit;
      exception when unique_violation then
        get stacked diagnostics violated_constraint = constraint_name;
        if violated_constraint <> 'master_items_item_code_key' then
          raise exception using errcode = 'P0001', message = 'MASTER_ITEM_PART_NO_EXISTS';
        end if;
      end;
    end loop;
  else
    begin
      insert into public.master_items (item_code, part_no, part_name, unit, default_label_qty, supplier_id)
      values (normalized_item_code, normalized_part_no, normalized_part_name, normalized_unit, p_default_label_qty, p_supplier_id)
      returning
        public.master_items.id, public.master_items.item_code, public.master_items.part_no,
        public.master_items.part_name, public.master_items.unit, public.master_items.default_label_qty,
        public.master_items.supplier_id, public.master_items.is_active, public.master_items.created_at,
        public.master_items.updated_at
      into
        id, item_code, part_no, part_name, unit, default_label_qty, supplier_id,
        is_active, created_at, updated_at;
    exception when unique_violation then
      get stacked diagnostics violated_constraint = constraint_name;
      raise exception using errcode = 'P0001', message = case
        when violated_constraint = 'master_items_item_code_key' then 'MASTER_ITEM_CODE_EXISTS'
        else 'MASTER_ITEM_PART_NO_EXISTS'
      end;
    end;
  end if;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    auth.uid(), 'master_item.created', 'master_item', id::text,
    jsonb_build_object(
      'item_code', item_code,
      'part_no', part_no,
      'default_label_qty', default_label_qty,
      'supplier_id', supplier_id
    )
  );

  return next;
end;
$$;

create or replace function public.update_master_item(
  p_master_item_id uuid,
  p_part_no text,
  p_part_name text,
  p_unit text,
  p_default_label_qty integer,
  p_supplier_id uuid default null
)
returns table (
  id uuid,
  item_code text,
  part_no text,
  part_name text,
  unit text,
  default_label_qty integer,
  supplier_id uuid,
  is_active boolean,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  normalized_part_no text := upper(btrim(p_part_no));
  normalized_part_name text := btrim(p_part_name);
  normalized_unit text := initcap(lower(btrim(p_unit)));
begin
  if not private.is_active_admin() then
    raise exception using errcode = 'P0001', message = 'MASTER_ITEM_ADMIN_REQUIRED';
  end if;

  if normalized_part_no !~ '^[A-Z0-9][A-Z0-9_./-]{1,127}$'
    or normalized_part_name = ''
    or char_length(normalized_part_name) > 200
    or normalized_unit !~ '^[A-Za-z][A-Za-z ./-]{0,31}$'
    or p_default_label_qty is null or p_default_label_qty < 1 or p_default_label_qty > 1000000 then
    raise exception using errcode = 'P0001', message = 'MASTER_ITEM_INPUT_INVALID';
  end if;

  if p_supplier_id is not null and not exists (
    select 1 from public.suppliers supplier
    where supplier.id = p_supplier_id and supplier.is_active
  ) then
    raise exception using errcode = 'P0001', message = 'MASTER_ITEM_SUPPLIER_NOT_FOUND';
  end if;

  if exists (
    select 1 from public.packing_sessions
    where master_item_id = p_master_item_id
  ) then
    raise exception using errcode = 'P0001', message = 'MASTER_ITEM_IN_USE';
  end if;

  begin
    update public.master_items
    set part_no = normalized_part_no,
        part_name = normalized_part_name,
        unit = normalized_unit,
        default_label_qty = p_default_label_qty,
        supplier_id = p_supplier_id
    where public.master_items.id = p_master_item_id
    returning
      public.master_items.id, public.master_items.item_code, public.master_items.part_no,
      public.master_items.part_name, public.master_items.unit, public.master_items.default_label_qty,
      public.master_items.supplier_id, public.master_items.is_active, public.master_items.created_at,
      public.master_items.updated_at
    into
      id, item_code, part_no, part_name, unit, default_label_qty, supplier_id,
      is_active, created_at, updated_at;
  exception when unique_violation then
    raise exception using errcode = 'P0001', message = 'MASTER_ITEM_PART_NO_EXISTS';
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
      'supplier_id', supplier_id
    )
  );

  return next;
end;
$$;

notify pgrst, 'reload schema';
