-- Part No Master Item boleh memuat spasi.
--
-- Nomor part dari pelanggan memang ditulis berspasi ("VO B 6X7"), dan pola
-- lama memaksa admin mengarang penggantinya -- garis bawah di satu tempat,
-- garis minus di tempat lain -- sehingga part yang sama bisa tercatat dua kali
-- dengan ejaan berbeda dan pencarian tidak menemukan keduanya.
--
-- Spasi berderet dirapatkan jadi satu dan ujungnya tetap dipangkas, jadi
-- "VO  B " dan "VO B" tidak bisa hidup berdampingan sebagai dua Part No
-- berbeda. Ketiga fungsi yang memvalidasi Part No diganti bersama-sama: aturan
-- yang berbeda antara formulir admin dan impor CSV berarti baris CSV yang sah
-- ditolak pratinjaunya. Badan fungsinya disalin apa adanya dari migrasi yang
-- terakhir mendefinisikannya; hanya pola dan perapian spasinya yang berubah.

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
  normalized_part_no text := regexp_replace(upper(btrim(p_part_no)), '\s+', ' ', 'g');
  normalized_part_name text := btrim(p_part_name);
  normalized_unit text := initcap(lower(btrim(p_unit)));
  candidate_code text;
  violated_constraint text;
begin
  if not private.is_active_admin() then
    raise exception using errcode = 'P0001', message = 'MASTER_ITEM_ADMIN_REQUIRED';
  end if;

  if (normalized_item_code is not null and normalized_item_code !~ '^[a-z0-9][a-z0-9_-]{1,63}$')
    or normalized_part_no !~ '^[A-Z0-9][A-Z0-9 _./-]{1,127}$'
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
  normalized_part_no text := regexp_replace(upper(btrim(p_part_no)), '\s+', ' ', 'g');
  normalized_part_name text := btrim(p_part_name);
  normalized_unit text := initcap(lower(btrim(p_unit)));
begin
  if not private.is_active_admin() then
    raise exception using errcode = 'P0001', message = 'MASTER_ITEM_ADMIN_REQUIRED';
  end if;

  if normalized_part_no !~ '^[A-Z0-9][A-Z0-9 _./-]{1,127}$'
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

create or replace function public.preview_csv_import(
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
  v_template text := lower(btrim(p_template));
  v_row jsonb;
  v_index bigint;
  v_source_line text;
  v_supplier_code text;
  v_supplier_name text;
  v_part_name text;
  v_outer_diameter text;
  v_inner_diameter text;
  v_length text;
  v_item_code text;
  v_part_no text;
  v_unit text;
  v_label_qty text;
  v_product_code text;
  v_delivery_number text;
  v_delivery_date text;
  v_delivery_status text;
  v_parsed_date date;
  v_seen_keys text[] := array[]::text[];
  v_key text;
begin
  if not private.is_active_admin() then
    raise exception using errcode = 'P0001', message = 'CSV_IMPORT_ADMIN_REQUIRED';
  end if;

  if v_template not in (
    'supplier', 'product', 'master_item', 'product_mapping', 'delivery_number'
  ) then
    raise exception using errcode = 'P0001', message = 'CSV_IMPORT_TEMPLATE_INVALID';
  end if;

  if jsonb_typeof(p_rows) <> 'array'
    or jsonb_array_length(p_rows) = 0
    or jsonb_array_length(p_rows) > 500 then
    raise exception using errcode = 'P0001', message = 'CSV_IMPORT_INPUT_INVALID';
  end if;

  for v_row, v_index in
    select source.value, source.ordinality
    from jsonb_array_elements(p_rows) with ordinality as source(value, ordinality)
  loop
    row_number := v_index::integer + 1;
    errors := array[]::text[];

    if jsonb_typeof(v_row) <> 'object' then
      errors := array_append(errors, 'Baris CSV tidak valid.');
      return next;
      continue;
    end if;

    v_source_line := private.csv_import_value(v_row, 'line');
    begin
      if v_source_line !~ '^[2-9][0-9]*$' then
        raise exception 'invalid source line';
      end if;
      row_number := v_source_line::integer;
    exception when others then
      errors := array_append(errors, 'Nomor baris CSV tidak valid.');
    end;

    if v_template = 'supplier' then
      v_supplier_code := upper(private.csv_import_value(v_row, 'supplier_code'));
      v_supplier_name := private.csv_import_value(v_row, 'supplier_name');
      if v_supplier_code !~ '^[A-Z0-9_-]{2,64}$' then
        errors := array_append(errors, 'Kode supplier tidak valid.');
      end if;
      if v_supplier_name = '' or char_length(v_supplier_name) > 200 then
        errors := array_append(errors, 'Nama supplier tidak valid.');
      end if;
      v_key := 'supplier:' || lower(v_supplier_code);
      if v_key = any(v_seen_keys) then
        errors := array_append(errors, 'Kode supplier duplikat di CSV.');
      else
        v_seen_keys := array_append(v_seen_keys, v_key);
      end if;
      if exists (
        select 1 from public.suppliers as s
        where lower(btrim(s.supplier_code)) = lower(v_supplier_code)
      ) then
        errors := array_append(errors, 'Kode supplier sudah digunakan.');
      end if;

    elsif v_template = 'product' then
      v_part_name := private.csv_import_value(v_row, 'part_name');
      v_outer_diameter := private.csv_import_value(v_row, 'outer_diameter');
      v_inner_diameter := private.csv_import_value(v_row, 'inner_diameter');
      v_length := private.csv_import_value(v_row, 'length');
      if v_part_name = '' or char_length(v_part_name) > 200 then
        errors := array_append(errors, 'Nama part tidak valid.');
      end if;
      if v_outer_diameter !~ '^[0-9]+(\.[0-9]+)?$'
        or v_outer_diameter::numeric <= 0 or v_outer_diameter::numeric > 1000000 then
        errors := array_append(errors, 'Diameter luar harus lebih besar dari 0.');
      end if;
      if v_inner_diameter !~ '^[0-9]+(\.[0-9]+)?$'
        or v_inner_diameter::numeric <= 0 or v_inner_diameter::numeric > 1000000 then
        errors := array_append(errors, 'Diameter dalam harus lebih besar dari 0.');
      end if;
      if v_length !~ '^[0-9]+(\.[0-9]+)?$'
        or v_length::numeric <= 0 or v_length::numeric > 1000000 then
        errors := array_append(errors, 'Panjang harus lebih besar dari 0.');
      end if;

    elsif v_template = 'master_item' then
      v_item_code := lower(private.csv_import_value(v_row, 'item_code'));
      v_part_no := regexp_replace(upper(private.csv_import_value(v_row, 'part_no')), '\s+', ' ', 'g');
      v_part_name := private.csv_import_value(v_row, 'part_name');
      v_unit := initcap(lower(private.csv_import_value(v_row, 'unit')));
      v_label_qty := private.csv_import_value(v_row, 'default_label_qty');
      if v_item_code !~ '^[a-z0-9][a-z0-9_-]{1,63}$' then
        errors := array_append(errors, 'Kode item tidak valid.');
      end if;
      if v_part_no !~ '^[A-Z0-9][A-Z0-9 _./-]{1,127}$' then
        errors := array_append(errors, 'Part No tidak valid.');
      end if;
      if v_part_name = '' or char_length(v_part_name) > 200 then
        errors := array_append(errors, 'Nama part tidak valid.');
      end if;
      if v_unit !~ '^[A-Za-z][A-Za-z ./-]{0,31}$' then
        errors := array_append(errors, 'Unit tidak valid.');
      end if;
      if v_label_qty !~ '^[1-9][0-9]{0,5}$' then
        errors := array_append(errors, 'Packing Qty tidak valid.');
      end if;
      v_key := 'master-item-code:' || v_item_code;
      if v_key = any(v_seen_keys) then
        errors := array_append(errors, 'Kode item duplikat di CSV.');
      else
        v_seen_keys := array_append(v_seen_keys, v_key);
      end if;
      v_key := 'master-item-part:' || v_part_no;
      if v_key = any(v_seen_keys) then
        errors := array_append(errors, 'Part No duplikat di CSV.');
      else
        v_seen_keys := array_append(v_seen_keys, v_key);
      end if;
      if exists (
        select 1 from public.master_items as m
        where lower(btrim(m.item_code)) = v_item_code
      ) then
        errors := array_append(errors, 'Kode item sudah digunakan.');
      end if;
      if exists (
        select 1 from public.master_items as m
        where upper(btrim(m.part_no)) = v_part_no
      ) then
        errors := array_append(errors, 'Part No sudah digunakan.');
      end if;

    elsif v_template = 'product_mapping' then
      v_item_code := lower(private.csv_import_value(v_row, 'item_code'));
      v_product_code := lower(private.csv_import_value(v_row, 'product_code'));
      if v_item_code = '' then
        errors := array_append(errors, 'Kode item wajib diisi.');
      end if;
      if v_product_code = '' then
        errors := array_append(errors, 'Kode produk wajib diisi.');
      end if;
      v_key := 'product-mapping:' || v_item_code || ':' || v_product_code;
      if v_key = any(v_seen_keys) then
        errors := array_append(errors, 'Product Mapping duplikat di CSV.');
      else
        v_seen_keys := array_append(v_seen_keys, v_key);
      end if;
      if not exists (
        select 1 from public.master_items as m
        where lower(btrim(m.item_code)) = v_item_code and m.is_active
      ) then
        errors := array_append(errors, 'Master Item aktif tidak ditemukan.');
      end if;
      if not exists (
        select 1 from public.products as p
        where lower(btrim(p.product_code)) = v_product_code and p.is_active
      ) then
        errors := array_append(errors, 'Produk aktif tidak ditemukan.');
      end if;
      if exists (
        select 1
        from public.master_item_products as mp
        join public.master_items as m on m.id = mp.master_item_id
        join public.products as p on p.id = mp.product_id
        where lower(btrim(m.item_code)) = v_item_code
          and lower(btrim(p.product_code)) = v_product_code
      ) then
        errors := array_append(errors, 'Product Mapping sudah terdaftar.');
      end if;

    else
      v_supplier_code := upper(private.csv_import_value(v_row, 'supplier_code'));
      v_delivery_number := upper(private.csv_import_value(v_row, 'delivery_number'));
      v_delivery_date := private.csv_import_value(v_row, 'delivery_date');
      v_delivery_status := lower(private.csv_import_value(v_row, 'status'));
      if v_supplier_code !~ '^[A-Z0-9_-]{2,64}$' then
        errors := array_append(errors, 'Kode supplier tidak valid.');
      end if;
      if v_delivery_number !~ '^[A-Z0-9][A-Z0-9_/-]{1,99}$' then
        errors := array_append(errors, 'Delivery Number tidak valid.');
      end if;
      if v_delivery_status not in ('draft', 'active') then
        errors := array_append(errors, 'Status awal harus draft atau active.');
      end if;
      begin
        if v_delivery_date !~ '^\d{4}-\d{2}-\d{2}$' then
          raise exception 'invalid date';
        end if;
        v_parsed_date := v_delivery_date::date;
        if v_parsed_date::text <> v_delivery_date then
          raise exception 'invalid date';
        end if;
      exception when others then
        errors := array_append(errors, 'Tanggal delivery tidak valid.');
      end;
      v_key := 'delivery-number:' || lower(v_supplier_code) || ':' || lower(v_delivery_number);
      if v_key = any(v_seen_keys) then
        errors := array_append(errors, 'Delivery Number duplikat di CSV.');
      else
        v_seen_keys := array_append(v_seen_keys, v_key);
      end if;
      if not exists (
        select 1 from public.suppliers as s
        where lower(btrim(s.supplier_code)) = lower(v_supplier_code) and s.is_active
      ) then
        errors := array_append(errors, 'Supplier aktif tidak ditemukan.');
      end if;
      if exists (
        select 1
        from public.delivery_numbers as d
        join public.suppliers as s on s.id = d.supplier_id
        where lower(btrim(s.supplier_code)) = lower(v_supplier_code)
          and lower(btrim(d.delivery_number)) = lower(v_delivery_number)
      ) then
        errors := array_append(errors, 'Delivery Number sudah digunakan untuk supplier ini.');
      end if;
    end if;

    return next;
  end loop;
end;
$$;

notify pgrst, 'reload schema';
