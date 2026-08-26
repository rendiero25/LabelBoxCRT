-- Jadwal dicocokkan langsung dengan Part No label, dan Part No boleh memuat '='.
--
-- Kolom pertama file jadwal ternyata Part No label sheet itu sendiri
-- ("VS-B T0.3XW100 L=120MM"), bukan penunjuk ke produk yang harus didaftarkan
-- lebih dulu. Isi file berdiri sendiri: disimpan ke delivery_schedule_rows lalu
-- dibandingkan apa adanya dengan Part No dan Qty per Box yang dibawa label.
--
-- Karena itu dua hal berubah bersama:
--
--   1. Aturan Part No Master Item menerima '=' -- tanpa itu Master Item untuk
--      sheet tidak bisa didaftarkan sama sekali, dan labelnya tidak pernah ada.
--   2. verify_delivery_label membandingkan teks langsung; terjemahan lewat
--      products dan master_item_products dibuang beserta kedua fungsinya.
--
-- Ketiga fungsi pemvalidasi Part No disalin apa adanya dari versi hidup lewat
-- pg_get_functiondef; hanya pola regexnya yang diganti, oleh skrip yang menolak
-- jalan kalau kecocokannya bukan tepat satu per fungsi.

CREATE OR REPLACE FUNCTION public.create_master_item(p_part_no text, p_part_name text, p_unit text, p_default_label_qty integer, p_item_code text DEFAULT NULL::text, p_supplier_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(id uuid, item_code text, part_no text, part_name text, unit text, default_label_qty integer, supplier_id uuid, is_active boolean, created_at timestamp with time zone, updated_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  normalized_item_code text := nullif(lower(btrim(coalesce(p_item_code, ''))), '');
  normalized_part_no text := regexp_replace(upper(btrim(p_part_no)), '\s+', ' ', 'g');
  normalized_part_name text := btrim(p_part_name);
  normalized_unit text := initcap(lower(btrim(p_unit)));
  next_code_number text;
  candidate_code text;
  violated_constraint text;
begin
  if not private.is_active_admin() then
    raise exception using errcode = 'P0001', message = 'MASTER_ITEM_ADMIN_REQUIRED';
  end if;

  if (normalized_item_code is not null and normalized_item_code !~ '^[a-z0-9][a-z0-9_-]{1,63}$')
    or normalized_part_no !~ '^[A-Z0-9][A-Z0-9 _.=/-]{1,127}$'
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
      next_code_number := nextval('public.master_item_code_seq')::text;

      -- greatest(2, length(...)) memberi lebar minimum dua digit tanpa pernah
      -- memotong: satu digit dipad jadi '05', tiga digit dibiarkan '100'.
      candidate_code := 'mstritem-' || lpad(
        next_code_number, greatest(2, length(next_code_number)), '0'
      );

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
$function$;

CREATE OR REPLACE FUNCTION public.update_master_item(p_master_item_id uuid, p_part_no text, p_part_name text, p_unit text, p_default_label_qty integer, p_supplier_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(id uuid, item_code text, part_no text, part_name text, unit text, default_label_qty integer, supplier_id uuid, is_active boolean, created_at timestamp with time zone, updated_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  normalized_part_no text := regexp_replace(upper(btrim(p_part_no)), '\s+', ' ', 'g');
  normalized_part_name text := btrim(p_part_name);
  normalized_unit text := initcap(lower(btrim(p_unit)));
begin
  if not private.is_active_admin() then
    raise exception using errcode = 'P0001', message = 'MASTER_ITEM_ADMIN_REQUIRED';
  end if;

  if normalized_part_no !~ '^[A-Z0-9][A-Z0-9 _.=/-]{1,127}$'
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

  -- Riwayat yang sudah selesai tidak lagi mengunci Master Item-nya. Batch
  -- yang ditutup dan sesi yang sudah dikonfirmasi, dibatalkan, atau
  -- kedaluwarsa membawa salinannya sendiri, jadi labelnya tidak ikut berubah
  -- ketika Master Item disunting. Yang masih berjalan tetap dikunci: box yang
  -- belum diverifikasi atau belum dicetak masih akan membaca Master Item ini,
  -- dan menyuntingnya di tengah jalan berarti satu batch memakai dua versi
  -- data yang berbeda.
  if not exists (
    select 1 from public.master_items item
    where item.id = p_master_item_id and item.deleted_at is null
  ) then
    raise exception using errcode = 'P0001', message = 'MASTER_ITEM_NOT_FOUND';
  end if;

  if exists (
    select 1 from public.label_box_batches batch
    where batch.master_item_id = p_master_item_id
      and batch.closed_at is null
  ) or exists (
    select 1 from public.packing_sessions session
    where session.master_item_id = p_master_item_id
      and session.status not in ('confirmed', 'cancelled', 'expired')
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
$function$;

CREATE OR REPLACE FUNCTION public.preview_csv_import(p_template text, p_rows jsonb)
 RETURNS TABLE(row_number integer, errors text[])
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
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
      if v_part_no !~ '^[A-Z0-9][A-Z0-9 _.=/-]{1,127}$' then
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
$function$;

-- Baris jadwal dicocokkan langsung dengan Part No label, tanpa terjemahan.
--
-- View lama menerjemahkan ukuran lewat products dan master_item_products.
-- Sekarang tidak ada lagi yang diterjemahkan, jadi kolom itu diganti dengan
-- pertanyaan yang benar-benar berguna sebelum truk diperiksa: apakah sudah ada
-- label yang membawa Part No dan Qty per Box ini.

drop view public.delivery_schedule_rows_resolved;

create view public.delivery_schedule_rows_resolved
with (security_invoker = true)
as
select
  schedule_row.id,
  schedule_row.session_id,
  schedule_row.row_no,
  schedule_row.product_size,
  schedule_row.qty,
  schedule_row.source_file_name,
  schedule_row.created_at,
  schedule_row.verified_at,
  schedule_row.verified_label_box_id,
  exists (
    select 1
    from public.label_box_batches batch
    where regexp_replace(upper(btrim(batch.part_no_snapshot)), '\s+', ' ', 'g')
        = schedule_row.product_size
      and coalesce(batch.qty_delivery_display, batch.qty_delivery)
        = schedule_row.qty
  ) as matching_batch_exists
from public.delivery_schedule_rows schedule_row;

grant select on public.delivery_schedule_rows_resolved to authenticated;

-- Terjemahan ukuran ke Master Item tidak dipakai lagi oleh siapa pun.
drop function private.master_item_for_product_size(text);
drop function private.product_size_dimensions(text);

/**
 * Mencocokkan satu label box dengan jadwal.
 *
 * Perbandingannya langsung: Part No yang tercetak di label lawan teks di kolom
 * pertama jadwal, dan Qty per Box label lawan Qty per Box jadwal. Tidak ada
 * lagi langkah lewat products maupun master_item_products -- isi file jadwal
 * berdiri sendiri dan tidak perlu didaftarkan sebagai master data lebih dulu.
 *
 * Kedua sisi dirapikan dengan cara yang sama sebelum dibandingkan (huruf besar,
 * spasi beruntun jadi satu, ujungnya dipangkas). Dokumen jadwal diketik tangan
 * dan Part No di master data tidak selalu ditulis dengan spasi yang sama.
 *
 * Isi string QR tetap tidak dipercaya. Tiga generasi payload beredar dan dua di
 * antaranya berbentuk sama persis sementara field ketiganya berbeda arti, jadi
 * payload cuma dipakai sebagai kunci pencarian; angka dan Part No-nya diambil
 * dari batch di database.
 *
 * Satu label fisik hanya boleh memenuhi satu baris jadwal, jadi label yang
 * sudah terpakai di session ini ditolak sebagai duplicate_label.
 */
create or replace function public.verify_delivery_label(
  p_session_id uuid,
  p_qr_payload text
)
returns table (
  result public.delivery_scan_result,
  matched_row_id uuid,
  matched_row_no integer,
  product_size text,
  qty integer,
  part_no text,
  packing_qty integer,
  verified_count integer,
  total_count integer,
  delivery_ok boolean
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  target_session public.delivery_verification_sessions%rowtype;
  target_label public.label_boxes%rowtype;
  target_batch public.label_box_batches%rowtype;
  matched public.delivery_schedule_rows%rowtype;
  scan_result public.delivery_scan_result;
  normalized_payload text := btrim(coalesce(p_qr_payload, ''));
  label_part_no text;
  label_qty integer;
  remaining integer;
  total integer;
begin
  if not private.is_active_app_user() then
    raise exception using errcode = 'P0001', message = 'ACTIVE_USER_REQUIRED';
  end if;

  select * into target_session
  from public.delivery_verification_sessions session
  where session.id = p_session_id;

  if target_session.id is null then
    raise exception using errcode = 'P0001', message = 'DELIVERY_SESSION_NOT_FOUND';
  end if;

  if target_session.status <> 'open' then
    raise exception using errcode = 'P0001', message = 'DELIVERY_SESSION_CLOSED';
  end if;

  if normalized_payload = '' then
    raise exception using errcode = 'P0001', message = 'DELIVERY_SCAN_EMPTY';
  end if;

  select * into target_label
  from public.label_boxes label_box
  where label_box.qr_payload = normalized_payload
  limit 1;

  if target_label.id is null then
    scan_result := 'unknown_label';
  elsif exists (
    select 1 from public.delivery_schedule_rows used
    where used.session_id = p_session_id
      and used.verified_label_box_id = target_label.id
  ) then
    scan_result := 'duplicate_label';
  else
    select * into target_batch
    from public.label_box_batches batch
    where batch.id = target_label.batch_id;

    label_part_no := regexp_replace(
      upper(btrim(target_batch.part_no_snapshot)), '\s+', ' ', 'g'
    );
    label_qty := coalesce(
      target_batch.qty_delivery_display, target_batch.qty_delivery
    );

    select schedule_row.* into matched
    from public.delivery_schedule_rows schedule_row
    where schedule_row.session_id = p_session_id
      and schedule_row.verified_at is null
      and schedule_row.product_size = label_part_no
      and schedule_row.qty = label_qty
    order by schedule_row.row_no
    limit 1;

    if matched.id is null then
      scan_result := 'not_pass';
    else
      update public.delivery_schedule_rows
      set verified_at = now(), verified_label_box_id = target_label.id
      where public.delivery_schedule_rows.id = matched.id;

      scan_result := 'pass';
    end if;
  end if;

  insert into public.delivery_verification_scans (
    session_id, qr_payload, result, matched_row_id, label_box_id, scanned_by
  ) values (
    p_session_id, normalized_payload, scan_result, matched.id,
    target_label.id, auth.uid()
  );

  select count(*)::integer,
    count(*) filter (where schedule_row.verified_at is null)::integer
  into total, remaining
  from public.delivery_schedule_rows schedule_row
  where schedule_row.session_id = p_session_id;

  -- Session ditutup hanya kalau ada barisnya. Jadwal kosong yang otomatis
  -- "selesai" akan menutup session sebelum satu pun kiriman diperiksa.
  if total > 0 and remaining = 0 then
    update public.delivery_verification_sessions
    set status = 'done', closed_at = now()
    where public.delivery_verification_sessions.id = p_session_id;

    insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
    values (
      auth.uid(), 'delivery_verification_session.completed',
      'delivery_verification_session', p_session_id::text,
      jsonb_build_object('session_no', target_session.session_no, 'label_count', total)
    );
  end if;

  return query
  select
    scan_result,
    matched.id,
    matched.row_no,
    matched.product_size,
    matched.qty,
    label_part_no,
    label_qty,
    (total - remaining),
    total,
    (total > 0 and remaining = 0);
end;
$$;

notify pgrst, 'reload schema';
