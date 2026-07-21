create function private.csv_import_value(p_row jsonb, p_key text)
returns text
language sql
immutable
set search_path = pg_catalog
as $$
  select btrim(coalesce(p_row ->> p_key, ''));
$$;

create function public.preview_csv_import(
  p_template text,
  p_rows jsonb
)
returns table (
  row_number integer,
  errors text[]
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  normalized_template text := lower(btrim(p_template));
  row_data jsonb;
  row_index bigint;
  source_line_text text;
  supplier_code text;
  supplier_name text;
  part_name text;
  outer_diameter_text text;
  inner_diameter_text text;
  length_text text;
  item_code text;
  part_no text;
  unit_text text;
  default_label_qty_text text;
  sequence_code text;
  product_code text;
  delivery_number_text text;
  delivery_date_text text;
  delivery_status_text text;
  parsed_date date;
  seen_keys text[] := array[]::text[];
  duplicate_key text;
begin
  if not private.is_active_admin() then
    raise exception using errcode = 'P0001', message = 'CSV_IMPORT_ADMIN_REQUIRED';
  end if;

  if normalized_template not in (
    'supplier', 'product', 'master_item', 'product_mapping', 'delivery_number'
  ) then
    raise exception using errcode = 'P0001', message = 'CSV_IMPORT_TEMPLATE_INVALID';
  end if;

  if jsonb_typeof(p_rows) <> 'array'
    or jsonb_array_length(p_rows) = 0
    or jsonb_array_length(p_rows) > 500 then
    raise exception using errcode = 'P0001', message = 'CSV_IMPORT_INPUT_INVALID';
  end if;

  for row_data, row_index in
    select source.value, source.ordinality
    from jsonb_array_elements(p_rows) with ordinality as source(value, ordinality)
  loop
    row_number := row_index::integer + 1;
    errors := array[]::text[];

    if jsonb_typeof(row_data) <> 'object' then
      errors := array_append(errors, 'Baris CSV tidak valid.');
      return next;
      continue;
    end if;

    source_line_text := private.csv_import_value(row_data, 'line');
    begin
      if source_line_text !~ '^[2-9][0-9]*$' then
        raise exception 'invalid source line';
      end if;
      row_number := source_line_text::integer;
    exception when others then
      errors := array_append(errors, 'Nomor baris CSV tidak valid.');
    end;

    if normalized_template = 'supplier' then
      supplier_code := upper(private.csv_import_value(row_data, 'supplier_code'));
      supplier_name := private.csv_import_value(row_data, 'supplier_name');

      if supplier_code !~ '^[A-Z0-9_-]{2,64}$' then
        errors := array_append(errors, 'Kode supplier tidak valid.');
      end if;
      if supplier_name = '' or char_length(supplier_name) > 200 then
        errors := array_append(errors, 'Nama supplier tidak valid.');
      end if;

      duplicate_key := 'supplier:' || lower(supplier_code);
      if duplicate_key = any(seen_keys) then
        errors := array_append(errors, 'Kode supplier duplikat di CSV.');
      else
        seen_keys := array_append(seen_keys, duplicate_key);
      end if;

      if exists (
        select 1 from public.suppliers supplier
        where lower(btrim(supplier.supplier_code)) = lower(supplier_code)
      ) then
        errors := array_append(errors, 'Kode supplier sudah digunakan.');
      end if;
    elsif normalized_template = 'product' then
      part_name := private.csv_import_value(row_data, 'part_name');
      outer_diameter_text := private.csv_import_value(row_data, 'outer_diameter');
      inner_diameter_text := private.csv_import_value(row_data, 'inner_diameter');
      length_text := private.csv_import_value(row_data, 'length');

      if part_name = '' or char_length(part_name) > 200 then
        errors := array_append(errors, 'Nama part tidak valid.');
      end if;
      if outer_diameter_text !~ '^[0-9]+(\.[0-9]+)?$'
        or outer_diameter_text::numeric <= 0
        or outer_diameter_text::numeric > 1000000 then
        errors := array_append(errors, 'Diameter luar harus lebih besar dari 0.');
      end if;
      if inner_diameter_text !~ '^[0-9]+(\.[0-9]+)?$'
        or inner_diameter_text::numeric <= 0
        or inner_diameter_text::numeric > 1000000 then
        errors := array_append(errors, 'Diameter dalam harus lebih besar dari 0.');
      end if;
      if length_text !~ '^[0-9]+(\.[0-9]+)?$'
        or length_text::numeric <= 0
        or length_text::numeric > 1000000 then
        errors := array_append(errors, 'Panjang harus lebih besar dari 0.');
      end if;
    elsif normalized_template = 'master_item' then
      item_code := lower(private.csv_import_value(row_data, 'item_code'));
      part_no := upper(private.csv_import_value(row_data, 'part_no'));
      part_name := private.csv_import_value(row_data, 'part_name');
      unit_text := initcap(lower(private.csv_import_value(row_data, 'unit')));
      default_label_qty_text := private.csv_import_value(row_data, 'default_label_qty');
      sequence_code := upper(private.csv_import_value(row_data, 'item_sequence_code'));

      if item_code !~ '^[a-z0-9][a-z0-9_-]{1,63}$' then
        errors := array_append(errors, 'Kode item tidak valid.');
      end if;
      if part_no !~ '^[A-Z0-9][A-Z0-9_./-]{1,127}$' then
        errors := array_append(errors, 'Part No tidak valid.');
      end if;
      if part_name = '' or char_length(part_name) > 200 then
        errors := array_append(errors, 'Nama part tidak valid.');
      end if;
      if unit_text !~ '^[A-Za-z][A-Za-z ./-]{0,31}$' then
        errors := array_append(errors, 'Unit tidak valid.');
      end if;
      if default_label_qty_text !~ '^[1-9][0-9]{0,5}$' then
        errors := array_append(errors, 'Default label Qty tidak valid.');
      end if;
      if sequence_code <> '' and sequence_code !~ '^[A-Z0-9][A-Z0-9_-]{1,63}$' then
        errors := array_append(errors, 'Kode sequence tidak valid.');
      end if;

      duplicate_key := 'master-item-code:' || item_code;
      if duplicate_key = any(seen_keys) then
        errors := array_append(errors, 'Kode item duplikat di CSV.');
      else
        seen_keys := array_append(seen_keys, duplicate_key);
      end if;
      duplicate_key := 'master-item-part:' || part_no;
      if duplicate_key = any(seen_keys) then
        errors := array_append(errors, 'Part No duplikat di CSV.');
      else
        seen_keys := array_append(seen_keys, duplicate_key);
      end if;

      if exists (
        select 1 from public.master_items item
        where lower(btrim(item.item_code)) = item_code
      ) then
        errors := array_append(errors, 'Kode item sudah digunakan.');
      end if;
      if exists (
        select 1 from public.master_items item
        where upper(btrim(item.part_no)) = part_no
      ) then
        errors := array_append(errors, 'Part No sudah digunakan.');
      end if;
    elsif normalized_template = 'product_mapping' then
      item_code := lower(private.csv_import_value(row_data, 'item_code'));
      product_code := lower(private.csv_import_value(row_data, 'product_code'));

      if item_code = '' then
        errors := array_append(errors, 'Kode item wajib diisi.');
      end if;
      if product_code = '' then
        errors := array_append(errors, 'Kode produk wajib diisi.');
      end if;

      duplicate_key := 'product-mapping:' || item_code || ':' || product_code;
      if duplicate_key = any(seen_keys) then
        errors := array_append(errors, 'Product Mapping duplikat di CSV.');
      else
        seen_keys := array_append(seen_keys, duplicate_key);
      end if;

      if not exists (
        select 1 from public.master_items item
        where lower(btrim(item.item_code)) = item_code and item.is_active
      ) then
        errors := array_append(errors, 'Master Item aktif tidak ditemukan.');
      end if;
      if not exists (
        select 1 from public.products product
        where lower(btrim(product.product_code)) = product_code and product.is_active
      ) then
        errors := array_append(errors, 'Produk aktif tidak ditemukan.');
      end if;
      if exists (
        select 1
        from public.master_item_products mapping
        join public.master_items item on item.id = mapping.master_item_id
        join public.products product on product.id = mapping.product_id
        where lower(btrim(item.item_code)) = item_code
          and lower(btrim(product.product_code)) = product_code
      ) then
        errors := array_append(errors, 'Product Mapping sudah terdaftar.');
      end if;
    else
      supplier_code := upper(private.csv_import_value(row_data, 'supplier_code'));
      delivery_number_text := upper(private.csv_import_value(row_data, 'delivery_number'));
      delivery_date_text := private.csv_import_value(row_data, 'delivery_date');
      delivery_status_text := lower(private.csv_import_value(row_data, 'status'));

      if supplier_code !~ '^[A-Z0-9_-]{2,64}$' then
        errors := array_append(errors, 'Kode supplier tidak valid.');
      end if;
      if delivery_number_text !~ '^[A-Z0-9][A-Z0-9_/-]{1,99}$' then
        errors := array_append(errors, 'Delivery Number tidak valid.');
      end if;
      if delivery_status_text not in ('draft', 'active') then
        errors := array_append(errors, 'Status awal harus draft atau active.');
      end if;

      begin
        if delivery_date_text !~ '^\d{4}-\d{2}-\d{2}$' then
          raise exception 'invalid date';
        end if;
        parsed_date := delivery_date_text::date;
        if parsed_date::text <> delivery_date_text then
          raise exception 'invalid date';
        end if;
      exception when others then
        errors := array_append(errors, 'Tanggal delivery tidak valid.');
      end;

      duplicate_key := 'delivery-number:' || lower(supplier_code) || ':' || lower(delivery_number_text);
      if duplicate_key = any(seen_keys) then
        errors := array_append(errors, 'Delivery Number duplikat di CSV.');
      else
        seen_keys := array_append(seen_keys, duplicate_key);
      end if;

      if not exists (
        select 1 from public.suppliers supplier
        where lower(btrim(supplier.supplier_code)) = lower(supplier_code)
          and supplier.is_active
      ) then
        errors := array_append(errors, 'Supplier aktif tidak ditemukan.');
      end if;
      if exists (
        select 1
        from public.delivery_numbers delivery
        join public.suppliers supplier on supplier.id = delivery.supplier_id
        where lower(btrim(supplier.supplier_code)) = lower(supplier_code)
          and lower(btrim(delivery.delivery_number)) = lower(delivery_number_text)
      ) then
        errors := array_append(errors, 'Delivery Number sudah digunakan untuk supplier ini.');
      end if;
    end if;

    return next;
  end loop;
end;
$$;

create function public.import_csv_master_data(
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
        private.csv_import_value(row_data, 'item_code'),
        private.csv_import_value(row_data, 'part_no'),
        private.csv_import_value(row_data, 'part_name'),
        private.csv_import_value(row_data, 'unit'),
        private.csv_import_value(row_data, 'default_label_qty')::integer,
        nullif(private.csv_import_value(row_data, 'item_sequence_code'), '')
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

revoke execute on function private.csv_import_value(jsonb, text)
from public, anon, authenticated;
revoke execute on function public.preview_csv_import(text, jsonb)
from public, anon;
revoke execute on function public.import_csv_master_data(text, jsonb, uuid)
from public, anon;

grant execute on function public.preview_csv_import(text, jsonb) to authenticated;
grant execute on function public.import_csv_master_data(text, jsonb, uuid) to authenticated;
