-- Sunting penuh label box yang belum selesai: seluruh isian bisa diganti, dan
-- batchnya dirakit ulang dari data baru.
--
-- update_label_box_batch hanya menyentuh keterangan kiriman -- Delivery Number,
-- kedua tanggal, dan Lot No -- karena supplier, Master Item, dan Qty menentukan
-- berapa banyak nomor box yang ada. Selama batchnya belum ditutup, membuang
-- nomor box lama dan merakitnya ulang justru yang diharapkan: yang salah
-- diperbaiki di tempat, lalu scannya diulang dari awal dengan data baru.
--
-- Batch yang sudah ditutup tetap memakai jalur lama. Labelnya sudah tercetak
-- dan menempel di box, dan hasil scannya adalah bukti kiriman; merakitnya ulang
-- berarti membuang bukti itu.

drop function if exists public.rebuild_label_box_batch(uuid, uuid, text, date, date, uuid, integer, text, integer);

create function public.rebuild_label_box_batch(
  p_batch_id uuid,
  p_supplier_id uuid,
  p_delivery_number text,
  p_delivery_date date,
  p_packing_date date,
  p_master_item_id uuid,
  p_qty_delivery integer,
  p_lot_no text,
  p_qty_delivery_display integer default null
)
returns table (
  batch_id uuid,
  delivery_number text,
  delivery_date date,
  packing_date date,
  supplier_code text,
  item_code text,
  master_item_row_no integer,
  packing_qty integer,
  qty_delivery integer,
  qty_delivery_display integer,
  lot_no text,
  label_count integer,
  qr_generated_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  target_batch public.label_box_batches%rowtype;
  session_ids uuid[];
  job_ids uuid[];
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

  select * into target_batch
  from public.label_box_batches batch
  where batch.id = p_batch_id
  for update;

  if target_batch.id is null then
    raise exception using errcode = 'P0001', message = 'LABEL_BOX_BATCH_NOT_FOUND';
  end if;

  -- Batch yang verifikasinya sudah selesai tidak boleh dirakit ulang: labelnya
  -- sudah tercetak dan menempel di box, dan hasil scannya adalah bukti kiriman.
  if target_batch.closed_at is not null then
    raise exception using errcode = 'P0001', message = 'LABEL_BOX_BATCH_CLOSED';
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
  end if;

  select ranked.position into computed_row_no
  from (
    select item.id, (row_number() over (order by item.item_code))::integer as position
    from public.master_items item
  ) ranked
  where ranked.id = p_master_item_id;

  -- Isi lama batch ini dibuang lebih dulu: nomor box, hasil scan, dan job
  -- cetaknya dirakit dari data yang baru saja diganti, jadi tidak ada satu pun
  -- yang masih berlaku. Urutannya mengikuti delete_label_box_batch -- anak
  -- print_jobs dulu, baru induknya.
  select
    coalesce(array_agg(box.packing_session_id) filter (where box.packing_session_id is not null), '{}')
  into session_ids
  from public.label_boxes box
  where box.batch_id = p_batch_id;

  select coalesce(array_agg(job.id), '{}') into job_ids
  from public.print_jobs job
  where job.packing_session_id = any(session_ids);

  delete from public.print_attempts attempt
  where attempt.print_job_id = any(job_ids);

  delete from public.reprint_requests request
  where request.source_print_job_id = any(job_ids);

  delete from public.print_jobs job
  where job.id = any(job_ids) and job.parent_print_job_id is not null;

  delete from public.print_jobs job
  where job.id = any(job_ids);

  delete from public.packing_session_scans scan
  where scan.packing_session_id = any(session_ids)
    or scan.label_box_batch_id = p_batch_id;

  delete from public.label_boxes box
  where box.batch_id = p_batch_id;

  delete from public.packing_sessions session
  where session.id = any(session_ids);

  update public.label_box_batches batch
  set
    delivery_number_id = target_dn.id,
    supplier_id = p_supplier_id,
    master_item_id = p_master_item_id,
    master_item_row_no = computed_row_no,
    packing_qty = target_item.default_label_qty,
    qty_delivery = p_qty_delivery,
    qty_delivery_display = resolved_display,
    packing_date = p_packing_date,
    lot_no = normalized_lot_no,
    label_count = set_count * box_count,
    qr_generated_at = generated_at,
    supplier_code_snapshot = target_supplier.supplier_code,
    item_code_snapshot = target_item.item_code,
    part_no_snapshot = target_item.part_no,
    part_name_snapshot = target_item.part_name,
    delivery_number_snapshot = target_dn.delivery_number,
    delivery_date_snapshot = target_dn.delivery_date
  where batch.id = p_batch_id
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
    auth.uid(), 'label_box_batch.rebuilt', 'label_box_batch', created_batch.id::text,
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
$function$;

revoke execute on function public.rebuild_label_box_batch(uuid, uuid, text, date, date, uuid, integer, text, integer) from public, anon;
grant execute on function public.rebuild_label_box_batch(uuid, uuid, text, date, date, uuid, integer, text, integer) to authenticated;
grant execute on function public.rebuild_label_box_batch(uuid, uuid, text, date, date, uuid, integer, text, integer) to service_role;

notify pgrst, 'reload schema';
