-- Ubah dan hapus data label box.
--
-- Sampai sekarang batch hanya bisa dibuat. Salah ketik Delivery Number, salah
-- tanggal, atau salah Lot No berarti batchnya menggantung selamanya di tabel
-- operator, dan satu-satunya jalan keluar adalah membuat batch kedua yang
-- benar lalu membiarkan yang salah ikut terhitung.
--
-- Yang boleh diubah cuma tiga field itu. Supplier, Master Item, dan Qty
-- Delivery menentukan jumlah dan nomor box; mengubahnya berarti membuang
-- seluruh label box lalu membuatnya ulang, dan itu batch baru, bukan suntingan.
--
-- QR payload memuat lot dan tanggal, jadi payload tiap box dirakit ulang di
-- sini dengan rumus yang sama persis dengan create_label_box_batch. Snapshot
-- di print_jobs ikut diperbarui supaya cetak ulang mengeluarkan data yang
-- sudah dibetulkan; zpl_payload tidak disentuh karena itu rekaman apa yang
-- benar-benar keluar dari printer.

create or replace function public.update_label_box_batch(
  p_batch_id uuid,
  p_delivery_number text,
  p_delivery_date date,
  p_lot_no text
)
returns table(
  batch_id uuid,
  delivery_number text,
  delivery_date date,
  lot_no text,
  label_count integer
)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
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

  -- Tanggal milik Delivery Number, bukan milik batch. Selama nomor itu hanya
  -- dipakai batch ini, membetulkan tanggalnya aman; kalau batch lain ikut
  -- memakainya, tanggalnya tidak boleh berubah diam-diam di belakang mereka.
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
    delivery_number_snapshot = target_dn.delivery_number,
    delivery_date_snapshot = target_dn.delivery_date
  where batch.id = p_batch_id
  returning * into target_batch;

  -- Payload dirakit dengan urutan field yang sama dengan create_label_box_batch;
  -- keduanya harus berubah bersamaan kalau urutannya pernah diubah.
  update public.label_boxes box
  set qr_payload = concat_ws(
    '|',
    target_batch.supplier_code_snapshot,
    target_batch.part_no_snapshot,
    target_batch.packing_qty::text,
    target_batch.master_item_row_no::text,
    target_batch.lot_no,
    box.box_number,
    to_char(target_batch.delivery_date_snapshot, 'DD-MM-YYYY')
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
      'lot_no', target_batch.lot_no
    )
  );

  return query
  select
    target_batch.id, target_batch.delivery_number_snapshot,
    target_batch.delivery_date_snapshot, target_batch.lot_no,
    target_batch.label_count;
end;
$function$;

revoke execute on function public.update_label_box_batch(uuid, text, date, text) from public, anon;
grant execute on function public.update_label_box_batch(uuid, text, date, text) to authenticated;
grant execute on function public.update_label_box_batch(uuid, text, date, text) to service_role;

-- Hapus batch berikut seluruh jejaknya: print job, hasil scan, label box, dan
-- packing session miliknya. Semua FK ke packing_sessions berjenis restrict,
-- jadi urutannya tidak bisa diserahkan ke cascade — anak dulu, induk terakhir.
--
-- Delivery Number tidak ikut terhapus: nomor itu milik supplier dan bisa
-- dipakai batch lain, sekarang atau nanti.
create or replace function public.delete_label_box_batch(p_batch_id uuid)
returns table(
  batch_id uuid,
  deleted_label_count integer,
  deleted_print_job_count integer,
  deleted_scan_count integer
)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  target_batch public.label_box_batches%rowtype;
  session_ids uuid[];
  label_box_count integer;
  print_job_count integer;
  scan_count integer;
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

  select
    coalesce(array_agg(box.packing_session_id) filter (where box.packing_session_id is not null), '{}'),
    count(*)::integer
  into session_ids, label_box_count
  from public.label_boxes box
  where box.batch_id = p_batch_id;

  select count(*)::integer into print_job_count
  from public.print_jobs job
  where job.packing_session_id = any(session_ids);

  select count(*)::integer into scan_count
  from public.packing_session_scans scan
  where scan.packing_session_id = any(session_ids);

  -- Cetak ulang berupa job anak yang menunjuk job awal; induknya baru boleh
  -- pergi setelah anaknya habis.
  delete from public.print_jobs job
  where job.packing_session_id = any(session_ids)
    and job.parent_print_job_id is not null;

  delete from public.print_jobs job
  where job.packing_session_id = any(session_ids);

  delete from public.packing_session_scans scan
  where scan.packing_session_id = any(session_ids);

  delete from public.label_boxes box
  where box.batch_id = p_batch_id;

  delete from public.packing_sessions session
  where session.id = any(session_ids);

  delete from public.label_box_batches batch
  where batch.id = p_batch_id;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    auth.uid(), 'label_box_batch.deleted', 'label_box_batch', p_batch_id::text,
    jsonb_build_object(
      'delivery_number', target_batch.delivery_number_snapshot,
      'delivery_date', target_batch.delivery_date_snapshot,
      'supplier_code', target_batch.supplier_code_snapshot,
      'part_no', target_batch.part_no_snapshot,
      'lot_no', target_batch.lot_no,
      'label_count', label_box_count,
      'print_job_count', print_job_count,
      'scan_count', scan_count,
      'was_closed', target_batch.closed_at is not null
    )
  );

  return query
  select p_batch_id, label_box_count, print_job_count, scan_count;
end;
$function$;

revoke execute on function public.delete_label_box_batch(uuid) from public, anon;
grant execute on function public.delete_label_box_batch(uuid) to authenticated;
grant execute on function public.delete_label_box_batch(uuid) to service_role;

notify pgrst, 'reload schema';
