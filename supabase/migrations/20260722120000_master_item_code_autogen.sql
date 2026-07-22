-- Master Item "Kode item" auto-generation (spec
-- docs/superpowers/specs/2026-07-22-master-item-code-autogen-design.md).
-- The admin form no longer collects item_code: create_master_item generates
-- it from a dedicated sequence when the caller omits it. CSV import keeps
-- supplying item_code explicitly (unchanged behavior), so the parameter
-- stays but moves to the end and becomes optional. update_master_item loses
-- the parameter entirely -- item_code can never be changed after creation.

create sequence public.master_item_code_seq
  as bigint
  minvalue 1
  start with 1;

select setval(
  'public.master_item_code_seq',
  coalesce(
    (
      select max((regexp_match(item_code, '^mstritem-([0-9]+)$'))[1]::bigint)
      from public.master_items
    ),
    0
  ) + 1,
  false
);

revoke all on sequence public.master_item_code_seq from public, anon, authenticated;

drop function public.create_master_item(text, text, text, text, integer, text);

create function public.create_master_item(
  p_part_no text,
  p_part_name text,
  p_unit text,
  p_default_label_qty integer,
  p_item_sequence_code text default null,
  p_item_code text default null
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
  normalized_item_code text := nullif(lower(btrim(coalesce(p_item_code, ''))), '');
  normalized_part_no text := upper(btrim(p_part_no));
  normalized_part_name text := btrim(p_part_name);
  normalized_unit text := initcap(lower(btrim(p_unit)));
  normalized_sequence_code text := upper(btrim(coalesce(p_item_sequence_code, '')));
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
    or p_default_label_qty is null or p_default_label_qty < 1 or p_default_label_qty > 1000000
    or (normalized_sequence_code <> '' and normalized_sequence_code !~ '^[A-Z0-9][A-Z0-9_-]{1,63}$') then
    raise exception using errcode = 'P0001', message = 'MASTER_ITEM_INPUT_INVALID';
  end if;

  if normalized_item_code is null then
    loop
      candidate_code := 'mstritem-' || lpad(nextval('public.master_item_code_seq')::text, 2, '0');

      begin
        insert into public.master_items (
          item_code, part_no, part_name, unit, default_label_qty, item_sequence_code
        ) values (
          candidate_code, normalized_part_no, normalized_part_name, normalized_unit,
          p_default_label_qty, nullif(normalized_sequence_code, '')
        ) returning * into id, item_code, part_no, part_name, unit, default_label_qty,
          item_sequence_code, is_active, created_at, updated_at;
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
  end if;

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

drop function public.update_master_item(uuid, text, text, text, text, integer, text);

create function public.update_master_item(
  p_master_item_id uuid,
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
  normalized_part_no text := upper(btrim(p_part_no));
  normalized_part_name text := btrim(p_part_name);
  normalized_unit text := initcap(lower(btrim(p_unit)));
  normalized_sequence_code text := upper(btrim(coalesce(p_item_sequence_code, '')));
begin
  if not private.is_active_admin() then
    raise exception using errcode = 'P0001', message = 'MASTER_ITEM_ADMIN_REQUIRED';
  end if;

  if normalized_part_no !~ '^[A-Z0-9][A-Z0-9_./-]{1,127}$'
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
    set part_no = normalized_part_no,
        part_name = normalized_part_name,
        unit = normalized_unit,
        default_label_qty = p_default_label_qty,
        item_sequence_code = nullif(normalized_sequence_code, '')
    where public.master_items.id = p_master_item_id
    returning * into id, item_code, part_no, part_name, unit, default_label_qty,
      item_sequence_code, is_active, created_at, updated_at;
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
      'item_sequence_code', item_sequence_code
    )
  );

  return next;
end;
$$;

revoke execute on function public.create_master_item(text, text, text, integer, text, text) from public, anon;
revoke execute on function public.update_master_item(uuid, text, text, text, integer, text) from public, anon;

grant execute on function public.create_master_item(text, text, text, integer, text, text) to authenticated;
grant execute on function public.update_master_item(uuid, text, text, text, integer, text) to authenticated;

create or replace function public.import_csv_master_data(
  p_template text,
  p_rows jsonb,
  p_correlation_id uuid
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  normalized_template text := lower(btrim(p_template));
  preview_row record;
  row_data jsonb;
  supplier_id uuid;
  master_item_id uuid;
  product_id uuid;
  imported_count integer := 0;
begin
  if not private.is_active_admin() then
    raise exception using errcode = 'P0001', message = 'CSV_IMPORT_ADMIN_REQUIRED';
  end if;

  if p_correlation_id is null then
    raise exception using errcode = 'P0001', message = 'CSV_IMPORT_INPUT_INVALID';
  end if;

  for preview_row in
    select * from public.preview_csv_import(normalized_template, p_rows)
  loop
    if cardinality(preview_row.errors) > 0 then
      raise exception using errcode = 'P0001', message = 'CSV_IMPORT_PREVIEW_INVALID';
    end if;
  end loop;

  for row_data in select value from jsonb_array_elements(p_rows)
  loop
    if normalized_template = 'supplier' then
      perform public.create_supplier(
        private.csv_import_value(row_data, 'supplier_code'),
        private.csv_import_value(row_data, 'supplier_name')
      );
    elsif normalized_template = 'product' then
      perform public.create_product(
        private.csv_import_value(row_data, 'part_name'),
        private.csv_import_value(row_data, 'outer_diameter')::numeric,
        private.csv_import_value(row_data, 'inner_diameter')::numeric,
        private.csv_import_value(row_data, 'length')::numeric
      );
    elsif normalized_template = 'master_item' then
      perform public.create_master_item(
        p_part_no => private.csv_import_value(row_data, 'part_no'),
        p_part_name => private.csv_import_value(row_data, 'part_name'),
        p_unit => private.csv_import_value(row_data, 'unit'),
        p_default_label_qty => private.csv_import_value(row_data, 'default_label_qty')::integer,
        p_item_sequence_code => nullif(private.csv_import_value(row_data, 'item_sequence_code'), ''),
        p_item_code => private.csv_import_value(row_data, 'item_code')
      );
    elsif normalized_template = 'product_mapping' then
      select id into master_item_id
      from public.master_items
      where lower(btrim(item_code)) = lower(private.csv_import_value(row_data, 'item_code'))
        and is_active;

      select id into product_id
      from public.products
      where lower(btrim(product_code)) = lower(private.csv_import_value(row_data, 'product_code'))
        and is_active;

      perform public.create_master_item_product_mapping(master_item_id, product_id);
    else
      select id into supplier_id
      from public.suppliers
      where lower(btrim(supplier_code)) = lower(private.csv_import_value(row_data, 'supplier_code'))
        and is_active;

      perform public.create_delivery_number(
        supplier_id,
        private.csv_import_value(row_data, 'delivery_number'),
        private.csv_import_value(row_data, 'delivery_date')::date,
        private.csv_import_value(row_data, 'status')::public.delivery_status
      );
    end if;

    imported_count := imported_count + 1;
  end loop;

  insert into public.audit_logs (
    actor_id,
    action,
    entity_type,
    entity_id,
    metadata,
    correlation_id
  ) values (
    auth.uid(),
    'csv_import.completed',
    'csv_import',
    normalized_template,
    jsonb_build_object('template', normalized_template, 'row_count', imported_count),
    p_correlation_id
  );

  return imported_count;
end;
$$;
