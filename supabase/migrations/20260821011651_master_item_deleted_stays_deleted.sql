-- Master Item yang sudah terhapus tetap terhapus.
--
-- Sejak 20260819200000_master_item_soft_delete.sql, Master Item yang punya
-- riwayat kiriman tidak dihapus betulan: barisnya ditahan sebagai jangkar
-- riwayat, ditandai deleted_at, dan sekaligus dimatikan is_active-nya. Yang
-- kedua itu dipasang sebagai pagar untuk jalur-jalur yang saat itu masih
-- menyaring is_active saja.
--
-- Pagar itu bisa dibuka: set_master_item_active menyunting is_active tanpa
-- melihat deleted_at sama sekali. Satu panggilan dengan p_is_active = true
-- mengembalikan baris yang sudah hilang dari setiap daftar ke seluruh jalur
-- yang hanya membaca is_active -- misalnya preview_csv_import, yang lalu
-- menerimanya kembali sebagai sasaran product mapping yang sah. Baris itu
-- tetap tidak punya nomor urut dan tetap tidak terlihat di layar mana pun,
-- jadi yang muncul adalah Master Item hantu.
--
-- Perbaikannya dua lapis, dan keduanya perlu:
--
-- 1. set_master_item_active memperlakukan baris terhapus sebagai tidak ada,
--    persis seperti update_master_item dan delete_master_item:
--    MASTER_ITEM_NOT_FOUND, untuk menyalakan maupun mematikan. Ini menutup
--    satu-satunya jalur yang bisa menyalakan is_active kembali.
--
-- 2. Setiap lookup Master Item yang tersisa berhenti bersandar pada is_active
--    saja dan ikut menyaring deleted_at. Aturan sebenarnya memang gabungan
--    keduanya, dan menuliskannya di satu tempat lalu memercayai efek sampingnya
--    di tempat lain persis yang membuat lubang pertama tadi bisa ada.
--    create_label_box_batch dan rebuild_label_box_batch sudah lebih dulu
--    diperlakukan begini di 20260820100000_master_item_row_no_skips_deleted.sql;
--    yang di sini adalah sisanya.
--
-- Khusus import_csv_master_data ada alasan tambahan: indeks unik item_code kini
-- parsial (hanya berlaku untuk deleted_at is null), jadi satu item_code boleh
-- dipakai satu baris hidup dan satu baris terhapus sekaligus. Lookup yang hanya
-- menyaring is_active bisa memungut baris yang salah dari dua kandidat itu.
--
-- Pesan galat tidak ada yang baru: jalur admin memakai kode NOT_FOUND miliknya
-- masing-masing, jalur scan tetap MASTER_ITEM_NOT_ACTIVE. Bagi data yang ada
-- sekarang tidak ada perilaku yang berubah -- setiap baris terhapus is_active-nya
-- memang sudah false -- yang berubah adalah aturannya kini tertulis, bukan
-- disimpulkan.

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

  -- Baris terhapus tidak ikut disunting, jadi statusnya tidak bisa dibalik
  -- kembali. Bagi RPC ini ia sudah tidak ada, sama seperti pada
  -- update_master_item dan delete_master_item.
  update public.master_items
  set is_active = p_is_active
  where public.master_items.id = p_master_item_id
    and public.master_items.deleted_at is null
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

create or replace function public.create_master_item_box(
  p_master_item_id uuid
)
returns table (
  id uuid,
  master_item_id uuid,
  box_no integer,
  box_code text,
  box_name text
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  target_slot integer;
  generated_box_code text;
begin
  if not private.is_active_admin() then
    raise exception using errcode = 'P0001', message = 'MASTER_ITEM_BOX_ADMIN_REQUIRED';
  end if;

  if not exists (
    select 1 from public.master_items item
    where item.id = p_master_item_id
      and item.is_active
      and item.deleted_at is null
  ) then
    raise exception using errcode = 'P0001', message = 'MASTER_ITEM_BOX_MASTER_ITEM_NOT_FOUND';
  end if;

  select min(slot) into target_slot
  from generate_series(1, 3) as slot
  where slot not in (
    select box.box_no from public.boxes box where box.master_item_id = p_master_item_id
  );

  if target_slot is null then
    raise exception using errcode = 'P0001', message = 'MASTER_ITEM_BOX_LIMIT_REACHED';
  end if;

  generated_box_code := 'box-' || lpad(nextval('public.box_code_seq')::text, 2, '0');

  insert into public.boxes (master_item_id, box_no, box_code, box_name)
  values (p_master_item_id, target_slot, generated_box_code, 'Box ' || target_slot)
  returning boxes.id, boxes.master_item_id, boxes.box_no, boxes.box_code, boxes.box_name
  into id, master_item_id, box_no, box_code, box_name;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    auth.uid(), 'master_item_box.created', 'box', id::text,
    jsonb_build_object('master_item_id', master_item_id, 'box_no', box_no, 'box_code', box_code)
  );

  return next;
end;
$$;

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
  where id = p_master_item_id and is_active and deleted_at is null
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

  -- Mematikan mapping tetap boleh apa pun keadaan induknya; menyalakannya butuh
  -- Master Item yang benar-benar masih ada dan aktif.
  if p_is_active and (
    not exists (
      select 1 from public.master_item_products mapping
      join public.master_items item on item.id = mapping.master_item_id
      where mapping.id = p_mapping_id
        and item.is_active
        and item.deleted_at is null
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
          and m.deleted_at is null
      ) then
        errors := array_append(errors, 'Kode item sudah digunakan.');
      end if;
      if exists (
        select 1 from public.master_items as m
        where upper(btrim(m.part_no)) = v_part_no
          and m.deleted_at is null
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
      -- Master Item terhapus bukan sasaran mapping yang sah, berapa pun isi
      -- is_active-nya: ia sudah tidak muncul di daftar mana pun.
      if not exists (
        select 1 from public.master_items as m
        where lower(btrim(m.item_code)) = v_item_code
          and m.is_active
          and m.deleted_at is null
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
        p_item_code => private.csv_import_value(row_data, 'item_code')
      );
    elsif normalized_template = 'product_mapping' then
      -- Menyaring deleted_at di sini bukan pengulangan preview: indeks unik
      -- item_code hanya berlaku untuk baris yang belum terhapus, jadi satu
      -- item_code bisa dimiliki satu baris hidup dan satu baris terhapus
      -- sekaligus, dan lookup ini harus memungut yang hidup.
      select id into master_item_id
      from public.master_items
      where lower(btrim(item_code)) = lower(private.csv_import_value(row_data, 'item_code'))
        and is_active
        and deleted_at is null;

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
    actor_id, action, entity_type, entity_id, metadata, correlation_id
  ) values (
    auth.uid(), 'csv_import.completed', 'csv_import', normalized_template,
    jsonb_build_object('template', normalized_template, 'row_count', imported_count),
    p_correlation_id
  );

  return imported_count;
end;
$$;

create or replace function public.accept_packing_scan(
  p_packing_session_id uuid,
  p_label_uid text,
  p_raw_payload_hash text,
  p_scanned_size text,
  p_normalized_size text
)
returns table (
  result public.scan_result,
  error_code text,
  session_id uuid,
  session_status public.packing_session_status,
  product_id uuid,
  box_layer_id uuid,
  layer_accepted_qty integer,
  layer_expected_qty integer,
  total_accepted_qty integer,
  total_expected_qty integer,
  ready_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  target_session public.packing_sessions%rowtype;
  target_item public.master_items%rowtype;
  target_product public.products%rowtype;
  normalized_label_uid text := nullif(btrim(p_label_uid), '');
  normalized_size text := lower(btrim(p_normalized_size));
  raw_hash text := btrim(p_raw_payload_hash);
  scan_result_value public.scan_result;
  scan_error_code text;
  selected_box_layer_id uuid;
  selected_layer_expected_qty integer;
  selected_layer_accepted_qty integer := 0;
  selected_product_id uuid;
  expected_total integer;
  accepted_total integer;
  resulting_status public.packing_session_status;
  resulting_ready_at timestamptz;
  scan_correlation_id uuid := gen_random_uuid();
  target_batch_id uuid;
begin
  if raw_hash is null
    or raw_hash = ''
    or p_scanned_size is null
    or btrim(p_scanned_size) = ''
    or normalized_size is null
    or normalized_size = '' then
    raise exception using errcode = 'P0001', message = 'SCAN_INPUT_INVALID';
  end if;

  select * into target_session
  from public.packing_sessions session
  where session.id = p_packing_session_id
  for update;

  if target_session.id is null then
    raise exception using errcode = 'P0001', message = 'PACKING_SESSION_NOT_FOUND';
  end if;

  if target_session.operator_id <> auth.uid() then
    raise exception using errcode = 'P0001', message = 'PACKING_SESSION_OPERATOR_MISMATCH';
  end if;

  if target_session.status <> 'scanning' then
    raise exception using errcode = 'P0001', message = 'SESSION_NOT_ACCEPTING_SCAN';
  end if;

  -- Batch pemilik sesi ini. Keunikan label dipagari per batch: satu keping
  -- tidak boleh masuk dua box dalam kiriman yang sama, tetapi QR produk yang
  -- sama boleh muncul lagi pada batch lain.
  select box.batch_id into target_batch_id
  from public.label_boxes box
  where box.packing_session_id = target_session.id;

  -- Master Item terhapus diperlakukan sama dengan yang dinonaktifkan: labelnya
  -- boleh sudah beredar, tetapi tidak ada scan baru yang boleh dicatat atas
  -- namanya.
  select * into target_item
  from public.master_items item
  where item.id = target_session.master_item_id
    and item.is_active
    and item.deleted_at is null;

  if target_item.id is null then
    raise exception using errcode = 'P0001', message = 'MASTER_ITEM_NOT_ACTIVE';
  end if;

  select coalesce(sum(requirement.expected_qty), 0)::integer into expected_total
  from public.box_layer_requirements requirement
  join public.box_layers layer on layer.id = requirement.box_layer_id
  where layer.box_id = target_session.box_id;

  if expected_total <= 0 then
    raise exception using errcode = 'P0001', message = 'SESSION_BOX_INVALID';
  end if;

  select count(*)::integer into accepted_total
  from public.packing_session_scans scan
  where scan.packing_session_id = target_session.id
    and scan.result = 'accepted';

  if normalized_label_uid is null
    or normalized_label_uid ~ '[[:cntrl:]]'
    or char_length(normalized_label_uid) > 256 then
    scan_result_value := 'invalid';
    scan_error_code := case
      when normalized_label_uid is null then 'LABEL_UID_MISSING'
      else 'LABEL_UID_INVALID'
    end;
  elsif exists (
    select 1 from public.packing_session_scans scan
    where scan.label_uid = normalized_label_uid
      and scan.result = 'accepted'
      and scan.label_box_batch_id is not distinct from target_batch_id
  ) then
    scan_result_value := 'duplicate';
    scan_error_code := 'LABEL_ALREADY_SCANNED';
  else
    select product.* into target_product
    from public.products product
    join public.master_item_products mapping
      on mapping.product_id = product.id
      and mapping.master_item_id = target_session.master_item_id
      and mapping.is_active
    where product.normalized_dimensions = normalized_size
      and product.is_active
    order by product.id
    limit 1;

    if target_product.id is null then
      select product.* into target_product
      from public.products product
      where product.normalized_dimensions = normalized_size
        and product.is_active
      order by product.id
      limit 1;

      if target_product.id is null then
        scan_result_value := 'invalid';
        scan_error_code := 'PRODUCT_SIZE_NOT_FOUND';
      else
        selected_product_id := target_product.id;
        scan_result_value := 'invalid';
        scan_error_code := 'PRODUCT_NOT_ALLOWED_FOR_PART';
      end if;
    else
      selected_product_id := target_product.id;

      select
        requirement.box_layer_id, requirement.expected_qty, count(scan.id)::integer
      into
        selected_box_layer_id, selected_layer_expected_qty, selected_layer_accepted_qty
      from public.box_layer_requirements requirement
      join public.box_layers layer on layer.id = requirement.box_layer_id
      left join public.packing_session_scans scan
        on scan.packing_session_id = target_session.id
        and scan.box_layer_id = requirement.box_layer_id
        and scan.product_id = requirement.product_id
        and scan.result = 'accepted'
      where layer.box_id = target_session.box_id
        and requirement.product_id = target_product.id
      group by requirement.box_layer_id, requirement.expected_qty,
        layer.sort_order, requirement.sort_order
      having count(scan.id) < requirement.expected_qty
      order by layer.sort_order, requirement.sort_order
      limit 1;

      if selected_box_layer_id is not null then
        scan_result_value := 'accepted';
        scan_error_code := null;
      elsif exists (
        select 1
        from public.box_layer_requirements requirement
        join public.box_layers layer on layer.id = requirement.box_layer_id
        where layer.box_id = target_session.box_id
          and requirement.product_id = target_product.id
      ) then
        scan_result_value := 'over_qty';
        scan_error_code := 'LAYER_QUANTITY_FULL';
      else
        scan_result_value := 'invalid';
        scan_error_code := 'PRODUCT_NOT_REQUIRED_IN_BOX';
      end if;
    end if;
  end if;

  if scan_result_value = 'accepted' then
    begin
      insert into public.packing_session_scans (
        packing_session_id, label_box_batch_id, label_uid, raw_payload_hash, scanned_part_no,
        scanned_size, normalized_size, product_id, box_layer_id, result,
        scanned_by, correlation_id
      ) values (
        target_session.id, target_batch_id, normalized_label_uid, raw_hash, target_item.part_no,
        btrim(p_scanned_size), normalized_size, selected_product_id,
        selected_box_layer_id, 'accepted', auth.uid(), scan_correlation_id
      );
    exception when unique_violation then
      scan_result_value := 'duplicate';
      scan_error_code := 'LABEL_ALREADY_SCANNED';
      selected_box_layer_id := null;
      selected_layer_expected_qty := null;
      selected_layer_accepted_qty := 0;
    end;
  end if;

  if scan_result_value <> 'accepted' then
    insert into public.packing_session_scans (
      packing_session_id, label_box_batch_id, label_uid, raw_payload_hash, scanned_part_no,
      scanned_size, normalized_size, product_id, box_layer_id, result,
      error_code, scanned_by, correlation_id
    ) values (
      target_session.id, target_batch_id, normalized_label_uid, raw_hash, target_item.part_no,
      btrim(p_scanned_size), normalized_size, selected_product_id, null,
      scan_result_value, scan_error_code, auth.uid(), scan_correlation_id
    );
  end if;

  if scan_result_value = 'accepted' then
    selected_layer_accepted_qty := selected_layer_accepted_qty + 1;

    select count(*)::integer into accepted_total
    from public.packing_session_scans scan
    where scan.packing_session_id = target_session.id
      and scan.result = 'accepted';

    if accepted_total = expected_total then
      update public.packing_sessions session
      set status = 'ready_to_finalize', ready_at = statement_timestamp()
      where session.id = target_session.id
        and session.status = 'scanning'
      returning session.status, session.ready_at
      into resulting_status, resulting_ready_at;
    else
      resulting_status := target_session.status;
      resulting_ready_at := target_session.ready_at;
    end if;
  else
    resulting_status := target_session.status;
    resulting_ready_at := target_session.ready_at;
  end if;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata, correlation_id)
  values (
    auth.uid(),
    case when scan_result_value = 'accepted' then 'packing_scan.accepted' else 'packing_scan.rejected' end,
    'packing_session_scan', target_session.id::text,
    jsonb_strip_nulls(jsonb_build_object(
      'result', scan_result_value::text,
      'error_code', scan_error_code,
      'product_id', selected_product_id,
      'box_layer_id', selected_box_layer_id,
      'raw_payload_hash', raw_hash,
      'total_accepted_qty', accepted_total,
      'total_expected_qty', expected_total
    )),
    scan_correlation_id
  );

  return query
  select
    scan_result_value, scan_error_code, target_session.id, resulting_status,
    selected_product_id, selected_box_layer_id, selected_layer_accepted_qty,
    selected_layer_expected_qty, accepted_total, expected_total, resulting_ready_at;
end;
$$;

-- Penanda untuk perubahan berikutnya: "Master Item yang bisa dipakai" berarti
-- is_active dan deleted_at is null sekaligus, di setiap jalur tanpa kecuali.
comment on column public.master_items.deleted_at is
  'Penanda Master Item terhapus: barisnya ditahan sebagai jangkar riwayat label box. Setiap lookup Master Item yang dipakai harus menyaring is_active DAN deleted_at is null -- is_active saja tidak cukup.';

notify pgrst, 'reload schema';
