-- QR label box: tiga penanda kiriman dirangkai jadi satu field, dan bulannya
-- ditulis huruf.
--
-- Sebelumnya payloadnya tujuh field: nomor urut Master Item, Lot No, dan nomor
-- box berdiri sendiri-sendiri di antara pemisah '|'. Ketiganya sebenarnya satu
-- keterangan yang sama dengan yang dicetak di baris Lot No label, jadi kini
-- dirangkai dengan '-' menjadi satu field. Payloadnya turun jadi lima field.
--
-- Tanggal delivery memakai singkatan bulan tiga huruf, bukan angka: "18-08-2026"
-- dan "08-11-2026" tidak bisa dibedakan sekilas oleh yang membaca dari gudang,
-- sedangkan "18-AGS-2026" tidak punya bacaan kedua.
--
-- Baris label_boxes yang sudah ada sengaja tidak ikut ditulis ulang. Sebagian
-- labelnya sudah tercetak dan menempel di box; payload di database harus tetap
-- sama dengan yang ada di QR yang tertempel. Batch lama akan memakai bentuk
-- baru begitu ia disunting, karena update_label_box_batch merakit ulang QR-nya.

-- Nama bulan Indonesia tiga huruf. to_char(..., 'MON') memberi singkatan
-- Inggris ("AUG") dan ikut berubah kalau lc_time server berbeda, jadi
-- pemetaannya ditulis di sini supaya hasilnya sama di mana pun ia dijalankan.
create or replace function private.label_date_text(p_date date)
returns text
language sql
immutable
set search_path to 'pg_catalog'
as $function$
  select to_char(p_date, 'DD') || '-' ||
    case extract(month from p_date)::integer
      when 1 then 'JAN'
      when 2 then 'FEB'
      when 3 then 'MAR'
      when 4 then 'APR'
      when 5 then 'MEI'
      when 6 then 'JUN'
      when 7 then 'JUL'
      when 8 then 'AGS'
      when 9 then 'SEP'
      when 10 then 'OKT'
      when 11 then 'NOV'
      when 12 then 'DES'
    end || '-' || to_char(p_date, 'YYYY')
$function$;

create or replace function public.create_label_box_batch(p_supplier_id uuid, p_delivery_number text, p_delivery_date date, p_packing_date date, p_master_item_id uuid, p_qty_delivery integer, p_lot_no text, p_qty_delivery_display integer DEFAULT NULL::integer)
 RETURNS TABLE(batch_id uuid, delivery_number text, delivery_date date, packing_date date, supplier_code text, item_code text, master_item_row_no integer, packing_qty integer, qty_delivery integer, qty_delivery_display integer, lot_no text, label_count integer, qr_generated_at timestamp with time zone)
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
  where item.id = p_master_item_id and item.is_active;

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

  select count(*)::integer into box_count
  from public.boxes box
  where box.master_item_id = p_master_item_id;

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

  select ranked.position into computed_row_no
  from (
    select item.id, (row_number() over (order by item.item_code))::integer as position
    from public.master_items item
  ) ranked
  where ranked.id = p_master_item_id;

  insert into public.label_box_batches (
    delivery_number_id, supplier_id, master_item_id, master_item_row_no,
    packing_qty, qty_delivery, qty_delivery_display, packing_date, lot_no,
    label_count, qr_generated_at, created_by, supplier_code_snapshot,
    item_code_snapshot, part_no_snapshot, delivery_number_snapshot,
    delivery_date_snapshot
  ) values (
    target_dn.id, p_supplier_id, p_master_item_id, computed_row_no,
    target_item.default_label_qty, p_qty_delivery, resolved_display,
    p_packing_date, normalized_lot_no, set_count * box_count, generated_at,
    auth.uid(), target_supplier.supplier_code, target_item.item_code,
    target_item.part_no, target_dn.delivery_number, target_dn.delivery_date
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
      target_item.default_label_qty::text,
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
  where box.master_item_id = p_master_item_id;

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
      'lot_no', created_batch.lot_no
    )
  );

  return query
  select
    created_batch.id, target_dn.delivery_number, target_dn.delivery_date,
    created_batch.packing_date, target_supplier.supplier_code,
    target_item.item_code, created_batch.master_item_row_no,
    created_batch.packing_qty, created_batch.qty_delivery,
    created_batch.qty_delivery_display, created_batch.lot_no,
    created_batch.label_count, created_batch.qr_generated_at;
end;
$function$
;

create or replace function public.update_label_box_batch(p_batch_id uuid, p_delivery_number text, p_delivery_date date, p_packing_date date, p_lot_no text)
 RETURNS TABLE(batch_id uuid, delivery_number text, delivery_date date, packing_date date, lot_no text, label_count integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  target_batch public.label_box_batches%rowtype;
  target_dn public.delivery_numbers%rowtype;
  previous_dn_id uuid;
  normalized_dn text := btrim(coalesce(p_delivery_number, ''));
  normalized_lot_no text := btrim(coalesce(p_lot_no, ''));
begin
  if not private.is_active_app_user() then
    raise exception using errcode = 'P0001', message = 'ACTIVE_USER_REQUIRED';
  end if;

  select * into target_batch
  from public.label_box_batches batch
  where batch.id = p_batch_id
  for update;

  if target_batch.id is null then
    raise exception using errcode = 'P0001', message = 'LABEL_BOX_BATCH_NOT_FOUND';
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

  previous_dn_id := target_batch.delivery_number_id;

  select * into target_dn
  from public.delivery_numbers dn
  where dn.supplier_id = target_batch.supplier_id
    and lower(btrim(dn.delivery_number)) = lower(normalized_dn)
  for update;

  if target_dn.id is null then
    insert into public.delivery_numbers (
      supplier_id, delivery_number, delivery_date, status, created_by
    ) values (
      target_batch.supplier_id, normalized_dn, p_delivery_date, 'active', auth.uid()
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
        'source', 'label_box_batch_update'
      )
    );
  end if;

  if target_dn.status <> 'active' then
    raise exception using errcode = 'P0001', message = 'DELIVERY_NUMBER_NOT_ACTIVE';
  end if;

  if target_dn.delivery_date <> p_delivery_date then
    if exists (
      select 1 from public.label_box_batches other
      where other.delivery_number_id = target_dn.id and other.id <> p_batch_id
    ) then
      raise exception using errcode = 'P0001', message = 'DELIVERY_NUMBER_DATE_SHARED';
    end if;

    update public.delivery_numbers dn
    set delivery_date = p_delivery_date
    where dn.id = target_dn.id
    returning * into target_dn;

    insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
    values (
      auth.uid(), 'delivery_number.updated', 'delivery_number', target_dn.id::text,
      jsonb_build_object(
        'delivery_date', target_dn.delivery_date,
        'source', 'label_box_batch_update'
      )
    );
  end if;

  update public.label_box_batches batch
  set
    delivery_number_id = target_dn.id,
    lot_no = normalized_lot_no,
    packing_date = p_packing_date,
    delivery_number_snapshot = target_dn.delivery_number,
    delivery_date_snapshot = target_dn.delivery_date
  where batch.id = p_batch_id
  returning * into target_batch;

  update public.label_boxes box
  set qr_payload = concat_ws(
    '|',
    target_batch.supplier_code_snapshot,
    target_batch.part_no_snapshot,
    target_batch.packing_qty::text,
    concat_ws(
      '-',
      target_batch.master_item_row_no::text,
      target_batch.lot_no,
      box.box_number
    ),
    private.label_date_text(target_batch.delivery_date_snapshot)
  )
  where box.batch_id = p_batch_id;

  update public.packing_sessions session
  set lot_no = target_batch.lot_no,
    delivery_number_id = target_batch.delivery_number_id
  where session.id in (
    select box.packing_session_id
    from public.label_boxes box
    where box.batch_id = p_batch_id and box.packing_session_id is not null
  );

  update public.print_jobs job
  set
    lot_no_snapshot = target_batch.lot_no,
    delivery_number_snapshot = target_batch.delivery_number_snapshot,
    delivery_date_snapshot = target_batch.delivery_date_snapshot,
    packing_date_snapshot = target_batch.packing_date,
    qr_payload_snapshot = box.qr_payload
  from public.label_boxes box
  where box.batch_id = p_batch_id
    and job.packing_session_id = box.packing_session_id;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    auth.uid(), 'label_box_batch.updated', 'label_box_batch', p_batch_id::text,
    jsonb_build_object(
      'delivery_number_id_before', previous_dn_id,
      'delivery_number_id_after', target_batch.delivery_number_id,
      'delivery_number', target_batch.delivery_number_snapshot,
      'delivery_date', target_batch.delivery_date_snapshot,
      'packing_date', target_batch.packing_date,
      'lot_no', target_batch.lot_no
    )
  );

  return query
  select
    target_batch.id, target_batch.delivery_number_snapshot,
    target_batch.delivery_date_snapshot, target_batch.packing_date,
    target_batch.lot_no, target_batch.label_count;
end;
$function$
;

notify pgrst, 'reload schema';
