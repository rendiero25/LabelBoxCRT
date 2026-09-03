-- Box dan Layer boleh disunting setelah kirimannya selesai.
--
-- Sebelumnya satu packing session saja sudah mengunci sebuah Box selamanya:
-- admin tidak bisa lagi mencentang produk pada layernya, menambah layer, atau
-- menghapus Box itu, meski seluruh kirimannya sudah lama ditutup dan dicetak.
--
-- Yang benar-benar perlu dikunci hanyalah pekerjaan yang masih berjalan, sama
-- seperti yang sudah berlaku untuk Master Item sejak
-- 20260819140000_master_item_editable_after_batch_closed.
--
-- Ada satu koreksi terhadap aturan Master Item itu, dan ia dibawa ke sini
-- sekaligus: sebuah session baru menjadi 'confirmed' ketika print job-nya
-- selesai, bukan ketika batch-nya ditutup -- dan close_label_box_batch justru
-- membuat session berstatus 'scanning' untuk box yang tidak pernah discan.
-- Dengan aturan lama, satu cetak yang gagal mengunci Box selamanya tanpa jalan
-- keluar dari layar mana pun. Karena itu batch yang sudah ditutup selalu
-- menyudahi session-nya, apa pun status session itu.

-- 1. Box bisa diarsipkan -----------------------------------------------------
--
-- packing_sessions.box_id dan label_boxes.box_id keduanya `on delete restrict`,
-- jadi Box yang pernah dikirim tidak bisa dihapus dari tabel. Polanya mengikuti
-- master_items: barisnya ditahan sebagai jangkar riwayat, ditandai terhapus,
-- dan hilang dari setiap daftar.

alter table public.boxes
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references auth.users (id) on delete set null;

-- Slot Box 1..3 hanya berlaku untuk Box yang hidup: tanpa indeks parsial, Box 1
-- yang diarsipkan akan menahan slotnya selamanya dan Master Item itu tidak
-- pernah bisa punya Box 1 lagi.
alter table public.boxes
  drop constraint if exists boxes_master_item_box_no_key;

drop index if exists public.boxes_master_item_box_no_key;

create unique index boxes_master_item_box_no_key
  on public.boxes (master_item_id, box_no)
  where deleted_at is null;

drop policy if exists boxes_select on public.boxes;

create policy boxes_select on public.boxes for select to authenticated
using (
  (select private.is_active_admin())
  or ((select private.is_active_app_user()) and boxes.deleted_at is null and exists (
    select 1 from public.master_items item
    where item.id = boxes.master_item_id and item.is_active
  ))
);

-- 2. Predikat "masih ada pekerjaan berjalan" ---------------------------------

create or replace function private.master_item_has_ongoing_work(p_master_item_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select exists (
    select 1 from public.label_box_batches batch
    where batch.master_item_id = p_master_item_id
      and batch.closed_at is null
  ) or exists (
    select 1 from public.packing_sessions session
    where session.master_item_id = p_master_item_id
      and session.status not in ('confirmed', 'cancelled', 'expired')
      -- Session yang lahir dari batch tertutup sudah selesai menurut orang yang
      -- menutupnya, meski statusnya tertinggal di 'scanning' atau 'print_failed'.
      and not exists (
        select 1
        from public.label_boxes box
        join public.label_box_batches batch on batch.id = box.batch_id
        where box.packing_session_id = session.id
          and batch.closed_at is not null
      )
  );
$$;

create or replace function private.box_has_ongoing_work(p_box_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select exists (
    select 1
    from public.boxes box
    join public.label_box_batches batch on batch.master_item_id = box.master_item_id
    where box.id = p_box_id
      and batch.closed_at is null
  ) or exists (
    select 1 from public.packing_sessions session
    where session.box_id = p_box_id
      and session.status not in ('confirmed', 'cancelled', 'expired')
      and not exists (
        select 1
        from public.label_boxes box
        join public.label_box_batches batch on batch.id = box.batch_id
        where box.packing_session_id = session.id
          and batch.closed_at is not null
      )
  );
$$;

-- 3. RPC Box dan Layer memakai predikat itu ---------------------------------

create or replace function public.create_master_item_box(p_master_item_id uuid)
returns table (id uuid, master_item_id uuid, box_no integer, box_code text, box_name text)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  target_slot integer;
  next_code_number text;
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

  -- Box yang diarsipkan melepaskan slotnya; slot itu boleh diisi Box baru.
  select min(slot) into target_slot
  from generate_series(1, 3) as slot
  where slot not in (
    select box.box_no from public.boxes box
    where box.master_item_id = p_master_item_id and box.deleted_at is null
  );

  if target_slot is null then
    raise exception using errcode = 'P0001', message = 'MASTER_ITEM_BOX_LIMIT_REACHED';
  end if;

  next_code_number := nextval('public.box_code_seq')::text;

  -- greatest(2, length(...)) memberi lebar minimum dua digit tanpa pernah
  -- memotong: satu digit dipad jadi '05', tiga digit dibiarkan '100'.
  generated_box_code := 'box-' || lpad(
    next_code_number, greatest(2, length(next_code_number)), '0'
  );

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
$function$;

create or replace function public.delete_master_item_box(p_box_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  target_box public.boxes%rowtype;
  has_history boolean;
begin
  if not private.is_active_admin() then
    raise exception using errcode = 'P0001', message = 'MASTER_ITEM_BOX_ADMIN_REQUIRED';
  end if;

  select * into target_box
  from public.boxes
  where id = p_box_id and deleted_at is null
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'MASTER_ITEM_BOX_NOT_FOUND';
  end if;

  if private.box_has_ongoing_work(p_box_id) then
    raise exception using errcode = 'P0001', message = 'MASTER_ITEM_BOX_IN_USE';
  end if;

  select exists (
    select 1 from public.packing_sessions session where session.box_id = p_box_id
  ) or exists (
    select 1 from public.label_boxes box where box.box_id = p_box_id
  ) into has_history;

  -- Box berjejak kiriman ditahan sebagai jangkar: label yang sudah dicetak
  -- menunjuk balik ke baris ini, dan kedua foreign key itu `on delete restrict`.
  if has_history then
    update public.boxes
    set deleted_at = now(), deleted_by = auth.uid()
    where id = p_box_id;

    insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
    values (
      auth.uid(), 'master_item_box.deleted', 'box', p_box_id::text,
      jsonb_build_object(
        'master_item_id', target_box.master_item_id,
        'box_no', target_box.box_no,
        'mode', 'archived'
      )
    );

    return;
  end if;

  delete from public.box_layer_requirements
  where box_layer_id in (select id from public.box_layers where box_id = p_box_id);
  delete from public.box_layers where box_id = p_box_id;
  delete from public.boxes where id = p_box_id;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    auth.uid(), 'master_item_box.deleted', 'box', p_box_id::text,
    jsonb_build_object(
      'master_item_id', target_box.master_item_id,
      'box_no', target_box.box_no,
      'mode', 'removed'
    )
  );
end;
$function$;

create or replace function public.create_box_layer(p_box_id uuid)
returns table (id uuid, box_id uuid, layer_no integer, layer_name text, sort_order integer)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  target_box public.boxes%rowtype;
  next_layer_no integer;
  generated_layer_name text;
begin
  if not private.is_active_admin() then
    raise exception using errcode = 'P0001', message = 'MASTER_ITEM_BOX_ADMIN_REQUIRED';
  end if;

  select * into target_box from public.boxes box
  where box.id = p_box_id and box.deleted_at is null;
  if not found then
    raise exception using errcode = 'P0001', message = 'MASTER_ITEM_BOX_NOT_FOUND';
  end if;

  if private.box_has_ongoing_work(p_box_id) then
    raise exception using errcode = 'P0001', message = 'MASTER_ITEM_BOX_IN_USE';
  end if;

  select count(*) into next_layer_no from public.box_layers layer where layer.box_id = p_box_id;
  if next_layer_no >= 10 then
    raise exception using errcode = 'P0001', message = 'BOX_LAYER_LIMIT_REACHED';
  end if;
  next_layer_no := next_layer_no + 1;
  generated_layer_name := 'Box ' || target_box.box_no || ' - Layer ' || next_layer_no;

  insert into public.box_layers (box_id, layer_no, layer_name, sort_order)
  values (p_box_id, next_layer_no, generated_layer_name, next_layer_no)
  returning box_layers.id, box_layers.box_id, box_layers.layer_no, box_layers.layer_name, box_layers.sort_order
  into id, box_id, layer_no, layer_name, sort_order;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    auth.uid(), 'box_layer.created', 'box_layer', id::text,
    jsonb_build_object('box_id', box_id, 'layer_no', layer_no)
  );

  return next;
end;
$function$;

create or replace function public.delete_box_layer(p_box_layer_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  target_layer public.box_layers%rowtype;
  highest_layer_no integer;
begin
  if not private.is_active_admin() then
    raise exception using errcode = 'P0001', message = 'MASTER_ITEM_BOX_ADMIN_REQUIRED';
  end if;

  select * into target_layer from public.box_layers where id = p_box_layer_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'BOX_LAYER_NOT_FOUND';
  end if;

  if private.box_has_ongoing_work(target_layer.box_id) then
    raise exception using errcode = 'P0001', message = 'MASTER_ITEM_BOX_IN_USE';
  end if;

  select max(layer_no) into highest_layer_no
  from public.box_layers layer where layer.box_id = target_layer.box_id;

  if target_layer.layer_no <> highest_layer_no then
    raise exception using errcode = 'P0001', message = 'BOX_LAYER_NOT_LAST';
  end if;

  delete from public.box_layer_requirements where box_layer_id = p_box_layer_id;
  delete from public.box_layers where id = p_box_layer_id;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    auth.uid(), 'box_layer.deleted', 'box_layer', p_box_layer_id::text,
    jsonb_build_object('box_id', target_layer.box_id, 'layer_no', target_layer.layer_no)
  );
end;
$function$;

-- Daftar produk sebuah layer boleh dikosongkan. Tanpa ini admin bisa menambah
-- produk tetapi tidak pernah bisa membatalkan produk terakhir. Aman karena
-- penutupan batch dan pembuatan print job sudah mengecualikan box yang
-- layernya tidak meminta produk apa pun.
create or replace function public.save_box_layer_requirements(p_box_layer_id uuid, p_requirements jsonb)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  target_layer public.box_layers%rowtype;
  target_box public.boxes%rowtype;
  requirement_record record;
  product_text text;
  parsed_product_id uuid;
  expected_qty_text text;
  expected_qty integer;
  seen_product_ids uuid[] := array[]::uuid[];
begin
  if not private.is_active_admin() then
    raise exception using errcode = 'P0001', message = 'MASTER_ITEM_BOX_ADMIN_REQUIRED';
  end if;

  select * into target_layer from public.box_layers where id = p_box_layer_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'BOX_LAYER_NOT_FOUND';
  end if;

  select * into target_box from public.boxes
  where id = target_layer.box_id and deleted_at is null;
  if not found then
    raise exception using errcode = 'P0001', message = 'MASTER_ITEM_BOX_NOT_FOUND';
  end if;

  if private.box_has_ongoing_work(target_box.id) then
    raise exception using errcode = 'P0001', message = 'MASTER_ITEM_BOX_IN_USE';
  end if;

  if coalesce(jsonb_typeof(p_requirements), '') <> 'array' then
    raise exception using errcode = 'P0001', message = 'MASTER_ITEM_BOX_INPUT_INVALID';
  end if;

  for requirement_record in
    select value from jsonb_array_elements(p_requirements) as elem(value)
  loop
    if jsonb_typeof(requirement_record.value) <> 'object'
      or jsonb_typeof(requirement_record.value -> 'product_id') <> 'string'
      or jsonb_typeof(requirement_record.value -> 'expected_qty') <> 'number' then
      raise exception using errcode = 'P0001', message = 'MASTER_ITEM_BOX_INPUT_INVALID';
    end if;

    product_text := requirement_record.value ->> 'product_id';
    expected_qty_text := requirement_record.value ->> 'expected_qty';
    begin
      parsed_product_id := product_text::uuid;
    exception when invalid_text_representation then
      raise exception using errcode = 'P0001', message = 'MASTER_ITEM_BOX_INPUT_INVALID';
    end;

    if expected_qty_text !~ '^[0-9]+$' or char_length(expected_qty_text) > 7 then
      raise exception using errcode = 'P0001', message = 'MASTER_ITEM_BOX_INPUT_INVALID';
    end if;
    expected_qty := expected_qty_text::integer;
    if expected_qty < 1 or expected_qty > 1000000 then
      raise exception using errcode = 'P0001', message = 'MASTER_ITEM_BOX_INPUT_INVALID';
    end if;

    if parsed_product_id = any(seen_product_ids) then
      raise exception using errcode = 'P0001', message = 'MASTER_ITEM_BOX_INPUT_INVALID';
    end if;
    seen_product_ids := array_append(seen_product_ids, parsed_product_id);

    perform private.sync_master_item_product_mapping(target_box.master_item_id, parsed_product_id);

    if not exists (
      select 1 from public.products product
      where product.id = parsed_product_id and product.is_active
    ) or not exists (
      select 1 from public.master_item_products mapping
      where mapping.master_item_id = target_box.master_item_id
        and mapping.product_id = parsed_product_id
        and mapping.is_active
    ) then
      raise exception using errcode = 'P0001', message = 'MASTER_ITEM_BOX_PRODUCT_NOT_ALLOWED';
    end if;
  end loop;

  delete from public.box_layer_requirements where box_layer_id = p_box_layer_id;

  insert into public.box_layer_requirements (box_layer_id, product_id, expected_qty, sort_order)
  select
    p_box_layer_id,
    (elem.value ->> 'product_id')::uuid,
    (elem.value ->> 'expected_qty')::integer,
    elem.ordinality::integer
  from jsonb_array_elements(p_requirements) with ordinality as elem(value, ordinality);

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    auth.uid(), 'box_layer.requirements_saved', 'box_layer', p_box_layer_id::text,
    jsonb_build_object('box_id', target_box.id, 'requirement_count', jsonb_array_length(p_requirements))
  );
end;
$function$;

-- 4. Master Item memakai aturan yang setara ---------------------------------
--
-- Kalau tidak diseragamkan, checkbox produk hidup tetapi tombol Simpan pada
-- dialog yang sama menolak dengan MASTER_ITEM_IN_USE.

create or replace function public.update_master_item(p_master_item_id uuid, p_part_no text, p_part_name text, p_unit text, p_default_label_qty integer, p_supplier_id uuid DEFAULT NULL::uuid)
returns table(id uuid, item_code text, part_no text, part_name text, unit text, default_label_qty integer, supplier_id uuid, is_active boolean, created_at timestamp with time zone, updated_at timestamp with time zone)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
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

  if not exists (
    select 1 from public.master_items item
    where item.id = p_master_item_id and item.deleted_at is null
  ) then
    raise exception using errcode = 'P0001', message = 'MASTER_ITEM_NOT_FOUND';
  end if;

  if private.master_item_has_ongoing_work(p_master_item_id) then
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

create or replace function public.delete_master_item(p_master_item_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  target_code text;
  batch_count integer;
  session_count integer;
  box_count integer;
  mapping_count integer;
begin
  if not private.is_active_admin() then
    raise exception using errcode = 'P0001', message = 'MASTER_ITEM_ADMIN_REQUIRED';
  end if;

  select item_code into target_code
  from public.master_items
  where id = p_master_item_id and deleted_at is null;

  if not found then
    raise exception using errcode = 'P0001', message = 'MASTER_ITEM_NOT_FOUND';
  end if;

  if private.master_item_has_ongoing_work(p_master_item_id) then
    raise exception using errcode = 'P0001', message = 'MASTER_ITEM_IN_USE';
  end if;

  select count(*)::integer into batch_count
  from public.label_box_batches batch
  where batch.master_item_id = p_master_item_id;

  select count(*)::integer into session_count
  from public.packing_sessions session
  where session.master_item_id = p_master_item_id;

  -- Riwayat kiriman: barisnya ditahan sebagai jangkar, tetapi ditandai
  -- terhapus dan dinonaktifkan sekaligus supaya tidak bisa dipakai batch baru
  -- lewat jalur mana pun yang masih menyaring is_active.
  if batch_count > 0 or session_count > 0 then
    update public.master_items
    set deleted_at = now(),
        deleted_by = auth.uid(),
        is_active = false
    where id = p_master_item_id;

    insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
    values (
      auth.uid(), 'master_item.deleted', 'master_item', p_master_item_id::text,
      jsonb_build_object(
        'item_code', target_code,
        'mode', 'archived',
        'label_box_batches', batch_count,
        'packing_sessions', session_count
      )
    );

    return;
  end if;

  select count(*)::integer into box_count
  from public.boxes box
  where box.master_item_id = p_master_item_id;

  select count(*)::integer into mapping_count
  from public.master_item_products mapping
  where mapping.master_item_id = p_master_item_id;

  delete from public.box_layer_requirements requirement
  where requirement.box_layer_id in (
    select layer.id
    from public.box_layers layer
    join public.boxes box on box.id = layer.box_id
    where box.master_item_id = p_master_item_id
  );

  delete from public.box_layers layer
  where layer.box_id in (
    select box.id from public.boxes box
    where box.master_item_id = p_master_item_id
  );

  delete from public.boxes box
  where box.master_item_id = p_master_item_id;

  delete from public.master_item_products mapping
  where mapping.master_item_id = p_master_item_id;

  begin
    delete from public.master_items where id = p_master_item_id;
  exception when foreign_key_violation then
    -- Jaring terakhir untuk tabel baru yang menunjuk master_items dan belum
    -- terpikirkan di sini; lebih baik menolak daripada menghapus separuh.
    raise exception using errcode = 'P0001', message = 'MASTER_ITEM_IN_USE';
  end;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    auth.uid(), 'master_item.deleted', 'master_item', p_master_item_id::text,
    jsonb_build_object(
      'item_code', target_code,
      'mode', 'removed',
      'boxes_removed', box_count,
      'product_mappings_removed', mapping_count
    )
  );
end;
$function$;

revoke execute on function private.master_item_has_ongoing_work(uuid) from public, anon, authenticated;
revoke execute on function private.box_has_ongoing_work(uuid) from public, anon, authenticated;

-- 5. Batch baru hanya memakai Box yang hidup -------------------------------

CREATE OR REPLACE FUNCTION public.create_label_box_batch(p_supplier_id uuid, p_delivery_number text, p_delivery_date date, p_packing_date date, p_master_item_id uuid, p_qty_delivery integer, p_lot_no text, p_operator_name text DEFAULT NULL::text, p_qty_delivery_display integer DEFAULT NULL::integer)
 RETURNS TABLE(batch_id uuid, delivery_number text, delivery_date date, packing_date date, supplier_code text, item_code text, master_item_row_no integer, packing_qty integer, qty_delivery integer, qty_delivery_display integer, lot_no text, operator_name text, label_count integer, qr_generated_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  target_item public.master_items%rowtype;
  target_supplier public.suppliers%rowtype;
  target_dn public.delivery_numbers%rowtype;
  created_batch public.label_box_batches%rowtype;
  normalized_lot_no text := btrim(coalesce(p_lot_no, ''));
  normalized_dn text := btrim(coalesce(p_delivery_number, ''));
  normalized_operator text := btrim(coalesce(p_operator_name, ''));
  resolved_display integer := coalesce(p_qty_delivery_display, p_qty_delivery);
  box_count integer;
  set_count integer;
  computed_row_no integer;
  generated_at timestamptz := statement_timestamp();
begin
  if not private.is_active_app_user() then
    raise exception using errcode = 'P0001', message = 'ACTIVE_USER_REQUIRED';
  end if;

  select * into target_supplier
  from public.suppliers supplier
  where supplier.id = p_supplier_id and supplier.is_active;

  if target_supplier.id is null then
    raise exception using errcode = 'P0001', message = 'SUPPLIER_INVALID';
  end if;

  select * into target_item
  from public.master_items item
  where item.id = p_master_item_id and item.is_active and item.deleted_at is null;

  if target_item.id is null then
    raise exception using errcode = 'P0001', message = 'MASTER_ITEM_NOT_ACTIVE';
  end if;

  if target_item.supplier_id is not null
    and target_item.supplier_id <> p_supplier_id then
    raise exception using errcode = 'P0001', message = 'MASTER_ITEM_SUPPLIER_MISMATCH';
  end if;

  if p_delivery_date is null then
    raise exception using errcode = 'P0001', message = 'DELIVERY_DATE_INVALID';
  end if;

  if p_packing_date is null then
    raise exception using errcode = 'P0001', message = 'PACKING_DATE_INVALID';
  end if;

  if normalized_dn = '' or char_length(normalized_dn) > 100 then
    raise exception using errcode = 'P0001', message = 'DELIVERY_NUMBER_INVALID';
  end if;

  if normalized_lot_no = '' or char_length(normalized_lot_no) > 100 then
    raise exception using errcode = 'P0001', message = 'LOT_NO_INVALID';
  end if;

  if normalized_operator = '' or char_length(normalized_operator) > 100 then
    raise exception using errcode = 'P0001', message = 'OPERATOR_NAME_INVALID';
  end if;

  select count(*)::integer into box_count
  from public.boxes box
  where box.master_item_id = p_master_item_id and box.deleted_at is null;

  if box_count = 0 then
    raise exception using errcode = 'P0001', message = 'MASTER_ITEM_HAS_NO_BOX';
  end if;

  if p_qty_delivery is null or p_qty_delivery < 1
    or target_item.default_label_qty < 1 then
    raise exception using errcode = 'P0001', message = 'QTY_DELIVERY_INVALID';
  end if;

  if resolved_display < 1 then
    raise exception using errcode = 'P0001', message = 'QTY_DELIVERY_DISPLAY_INVALID';
  end if;

  if p_qty_delivery % target_item.default_label_qty <> 0 then
    raise exception using errcode = 'P0001', message = 'QTY_DELIVERY_NOT_MULTIPLE';
  end if;

  set_count := p_qty_delivery / target_item.default_label_qty;

  if set_count > 99 then
    raise exception using errcode = 'P0001', message = 'QTY_DELIVERY_INVALID';
  end if;

  select * into target_dn
  from public.delivery_numbers dn
  where dn.supplier_id = p_supplier_id
    and lower(btrim(dn.delivery_number)) = lower(normalized_dn);

  if target_dn.id is null then
    begin
      insert into public.delivery_numbers (
        supplier_id, delivery_number, delivery_date, status, created_by
      ) values (
        p_supplier_id, normalized_dn, p_delivery_date, 'active', auth.uid()
      )
      returning * into target_dn;

      insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
      values (
        auth.uid(), 'delivery_number.created', 'delivery_number', target_dn.id::text,
        jsonb_build_object(
          'supplier_id', target_dn.supplier_id,
          'delivery_number', target_dn.delivery_number,
          'delivery_date', target_dn.delivery_date,
          'status', target_dn.status,
          'source', 'label_box_batch'
        )
      );
    exception when unique_violation then
      select * into target_dn
      from public.delivery_numbers dn
      where dn.supplier_id = p_supplier_id
        and lower(btrim(dn.delivery_number)) = lower(normalized_dn);
    end;
  end if;

  if target_dn.id is null then
    raise exception using errcode = 'P0001', message = 'DELIVERY_NUMBER_INVALID';
  end if;

  if target_dn.status <> 'active' then
    raise exception using errcode = 'P0001', message = 'DELIVERY_NUMBER_NOT_ACTIVE';
  end if;

  if target_dn.delivery_date <> p_delivery_date then
    raise exception using errcode = 'P0001', message = 'DELIVERY_NUMBER_DATE_MISMATCH';
  end if;

  -- Sama persis dengan public.master_item_row_numbers: yang terhapus tidak
  -- ikut dihitung. Kalau definisi di sini dan di view itu berbeda, angka yang
  -- tercetak di label berbeda dari angka yang dilihat admin di layar.
  select ranked.position into computed_row_no
  from (
    select item.id, (row_number() over (order by item.item_code))::integer as position
    from public.master_items item
    where item.deleted_at is null
  ) ranked
  where ranked.id = p_master_item_id;

  insert into public.label_box_batches (
    delivery_number_id, supplier_id, master_item_id, master_item_row_no,
    packing_qty, qty_delivery, qty_delivery_display, packing_date, lot_no,
    operator_name, label_count, qr_generated_at, created_by,
    supplier_code_snapshot, item_code_snapshot, part_no_snapshot,
    part_name_snapshot, delivery_number_snapshot, delivery_date_snapshot
  ) values (
    target_dn.id, p_supplier_id, p_master_item_id, computed_row_no,
    target_item.default_label_qty, p_qty_delivery, resolved_display,
    p_packing_date, normalized_lot_no, normalized_operator,
    set_count * box_count, generated_at, auth.uid(),
    target_supplier.supplier_code, target_item.item_code, target_item.part_no,
    target_item.part_name, target_dn.delivery_number, target_dn.delivery_date
  )
  returning * into created_batch;

  insert into public.label_boxes (
    batch_id, box_id, box_no, set_no, box_number, qr_payload
  )
  select
    created_batch.id,
    box.id,
    box.box_no,
    series.set_no,
    'B' || box.box_no::text || lpad(series.set_no::text, 2, '0'),
    concat_ws(
      '|',
      target_supplier.supplier_code,
      target_item.part_no,
      resolved_display::text,
      concat_ws(
        '-',
        computed_row_no::text,
        normalized_lot_no,
        'B' || box.box_no::text || lpad(series.set_no::text, 2, '0')
      ),
      private.label_date_text(target_dn.delivery_date)
    )
  from generate_series(1, set_count) as series(set_no)
  cross join public.boxes box
  where box.master_item_id = p_master_item_id and box.deleted_at is null;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    auth.uid(), 'label_box_batch.created', 'label_box_batch', created_batch.id::text,
    jsonb_build_object(
      'delivery_number_id', created_batch.delivery_number_id,
      'master_item_id', created_batch.master_item_id,
      'qty_delivery', created_batch.qty_delivery,
      'qty_delivery_display', created_batch.qty_delivery_display,
      'packing_qty', created_batch.packing_qty,
      'packing_date', created_batch.packing_date,
      'label_count', created_batch.label_count,
      'lot_no', created_batch.lot_no,
      'operator_name', created_batch.operator_name
    )
  );

  return query
  select
    created_batch.id, target_dn.delivery_number, target_dn.delivery_date,
    created_batch.packing_date, target_supplier.supplier_code,
    target_item.item_code, created_batch.master_item_row_no,
    created_batch.packing_qty, created_batch.qty_delivery,
    created_batch.qty_delivery_display, created_batch.lot_no,
    created_batch.operator_name, created_batch.label_count,
    created_batch.qr_generated_at;
end;
$function$
;

notify pgrst, 'reload schema';
