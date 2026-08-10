-- Verifikasi dihitung per set label, bukan sekali untuk seluruh batch.
--
-- Qty Delivery 200 dengan Packing Qty 100 dan 3 box menghasilkan 6 label box:
-- set pertama B101/B201/B301, set kedua B102/B202/B302. Kepingnya pun 200,
-- bukan 100. Penjaga lama hanya menuntut tiap produk yang diminta layer box
-- pernah punya satu scan diterima di batch itu, jadi operator bisa menutup
-- batch setelah mengisi set pertama saja dan set kedua tidak pernah discan.
--
-- Penjaga baru: setiap label box harus penuh. accept_label_box_scan sudah
-- mengisi box satu per satu urut set lalu box, dan menandainya 'verified'
-- ketika kuota layernya terpenuhi, jadi yang kurang cuma syaratnya.

CREATE OR REPLACE FUNCTION public.close_label_box_batch(p_batch_id uuid)
 RETURNS TABLE(batch_id uuid, closed_at timestamp with time zone, verified_count integer, label_count integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  target_batch public.label_box_batches%rowtype;
  pending_box public.label_boxes%rowtype;
  created_session public.packing_sessions%rowtype;
  closed_stamp timestamptz := statement_timestamp();
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

  if target_batch.closed_at is not null then
    raise exception using errcode = 'P0001', message = 'LABEL_BOX_BATCH_ALREADY_CLOSED';
  end if;

  -- Tiap label box punya kuota layernya sendiri, dan statusnya berubah jadi
  -- 'verified' hanya ketika kuota itu penuh. Menuntut semuanya penuh sama
  -- dengan menuntut seluruh set discan.
  --
  -- Box yang layernya tidak meminta produk apa pun dikecualikan: box seperti
  -- itu tidak pernah bisa penuh, dan menuntutnya akan mengunci batchnya
  -- selamanya.
  if exists (
    select 1
    from public.label_boxes box
    where box.batch_id = p_batch_id
      and box.status <> 'verified'
      and exists (
        select 1
        from public.box_layers layer
        join public.box_layer_requirements requirement
          on requirement.box_layer_id = layer.id
        where layer.box_id = box.box_id
      )
  ) then
    raise exception using errcode = 'P0001', message = 'LABEL_BOX_SETS_INCOMPLETE';
  end if;

  -- Batch lama bisa punya box tanpa sesi; print_jobs.packing_session_id wajib
  -- terisi, jadi sisanya dilengkapi di sini sebelum batch ditutup.
  for pending_box in
    select * from public.label_boxes box
    where box.batch_id = p_batch_id and box.packing_session_id is null
    order by box.set_no, box.box_no
  loop
    insert into public.packing_sessions (
      operator_id, master_item_id, box_id, delivery_number_id,
      qty_delivery, lot_no, status
    ) values (
      auth.uid(), target_batch.master_item_id, pending_box.box_id,
      target_batch.delivery_number_id, target_batch.qty_delivery,
      target_batch.lot_no, 'scanning'
    )
    returning * into created_session;

    update public.label_boxes box
    set packing_session_id = created_session.id
    where box.id = pending_box.id;
  end loop;

  update public.label_box_batches batch
  set closed_at = closed_stamp, closed_by = auth.uid()
  where batch.id = p_batch_id;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    auth.uid(), 'label_box_batch.closed', 'label_box_batch', p_batch_id::text,
    jsonb_build_object(
      'verified_count', (
        select count(*) from public.label_boxes box
        where box.batch_id = p_batch_id and box.status = 'verified'
      ),
      'label_count', target_batch.label_count
    )
  );

  return query
  select
    p_batch_id,
    closed_stamp,
    (
      select count(*)::integer from public.label_boxes box
      where box.batch_id = p_batch_id and box.status = 'verified'
    ),
    target_batch.label_count;
end;
$function$;

-- Cetak memakai syarat yang sama dengan tutup: label keluar setelah seluruh
-- set terisi, bukan setelah set pertama saja.
CREATE OR REPLACE FUNCTION public.create_label_box_print_jobs(p_batch_id uuid)
 RETURNS TABLE(print_job_id uuid, label_box_id uuid, box_number text, label_reference text, qr_payload text, supplier_code text, supplier_name text, part_no text, part_name text, qty integer, delivery_number text, delivery_date date, box_name text, lot_no text, qty_delivery integer, master_item_row_no integer, status print_job_status)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  target_batch public.label_box_batches%rowtype;
  target_item public.master_items%rowtype;
  pending_box record;
  unscanned_box public.label_boxes%rowtype;
  created_session public.packing_sessions%rowtype;
  new_sequence_no bigint;
  new_label_reference text;
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

  -- Batch terbuka: boleh cetak hanya bila seluruh label box sudah penuh, dengan
  -- pengecualian yang sama seperti di close_label_box_batch — box yang layernya
  -- tidak meminta produk apa pun tidak pernah bisa penuh. Batch yang sudah
  -- ditutup dibiarkan lewat supaya cetak ulang tetap bisa.
  if target_batch.closed_at is null and exists (
    select 1
    from public.label_boxes box
    where box.batch_id = p_batch_id
      and box.status <> 'verified'
      and exists (
        select 1
        from public.box_layers layer
        join public.box_layer_requirements requirement
          on requirement.box_layer_id = layer.id
        where layer.box_id = box.box_id
      )
  ) then
    raise exception using errcode = 'P0001', message = 'LABEL_BOX_SETS_INCOMPLETE';
  end if;

  select * into target_item
  from public.master_items item
  where item.id = target_batch.master_item_id;

  for unscanned_box in
    select * from public.label_boxes box
    where box.batch_id = p_batch_id and box.packing_session_id is null
    order by box.set_no, box.box_no
  loop
    insert into public.packing_sessions (
      operator_id, master_item_id, box_id, delivery_number_id,
      qty_delivery, lot_no, status
    ) values (
      auth.uid(), target_batch.master_item_id, unscanned_box.box_id,
      target_batch.delivery_number_id, target_batch.qty_delivery,
      target_batch.lot_no, 'scanning'
    )
    returning * into created_session;

    update public.label_boxes box
    set packing_session_id = created_session.id
    where box.id = unscanned_box.id;
  end loop;

  -- Idempoten: hanya box yang belum punya print job yang diproses, sehingga
  -- memanggil ulang tidak menggandakan label.
  for pending_box in
    select box.*, boxes.box_name
    from public.label_boxes box
    join public.boxes boxes on boxes.id = box.box_id
    where box.batch_id = p_batch_id
      and not exists (
        select 1 from public.print_jobs job
        where job.packing_session_id = box.packing_session_id
          and job.parent_print_job_id is null
      )
    order by box.set_no, box.box_no
  loop
    select nextval('public.print_job_sequence') into new_sequence_no;

    new_label_reference := new_sequence_no::text || '-'
      || to_char(target_batch.delivery_date_snapshot, 'DDMMYY') || '-'
      || pending_box.box_number;

    insert into public.print_jobs (
      packing_session_id, status, supplier_code_snapshot, supplier_name_snapshot,
      part_no_snapshot, part_name_snapshot, qty_snapshot, delivery_number_snapshot,
      delivery_date_snapshot, box_code_snapshot, box_name_snapshot,
      qty_delivery_snapshot, lot_no_snapshot, qr_generated_at_snapshot,
      qr_payload_snapshot, sequence_no, label_reference, template_version,
      zpl_payload, created_by
    )
    select
      pending_box.packing_session_id, 'pending', target_batch.supplier_code_snapshot,
      supplier.supplier_name, target_item.part_no, target_item.part_name,
      target_batch.packing_qty, target_batch.delivery_number_snapshot,
      target_batch.delivery_date_snapshot, pending_box.box_number,
      pending_box.box_name, target_batch.qty_delivery, target_batch.lot_no,
      target_batch.qr_generated_at, pending_box.qr_payload, new_sequence_no,
      new_label_reference, 'v4', 'PENDING_ZPL_GENERATION', auth.uid()
    from public.suppliers supplier
    where supplier.id = target_batch.supplier_id;
  end loop;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    auth.uid(), 'label_box_batch.print_jobs_created', 'label_box_batch',
    p_batch_id::text,
    jsonb_build_object(
      'label_count', target_batch.label_count,
      'batch_closed', target_batch.closed_at is not null
    )
  );

  return query
  select
    job.id, box.id, box.box_number, job.label_reference, job.qr_payload_snapshot,
    job.supplier_code_snapshot, job.supplier_name_snapshot, job.part_no_snapshot,
    job.part_name_snapshot, job.qty_snapshot, job.delivery_number_snapshot,
    job.delivery_date_snapshot, job.box_name_snapshot, job.lot_no_snapshot,
    job.qty_delivery_snapshot, target_batch.master_item_row_no, job.status
  from public.label_boxes box
  join public.print_jobs job
    on job.packing_session_id = box.packing_session_id
    and job.parent_print_job_id is null
  where box.batch_id = p_batch_id
  order by box.set_no, box.box_no;
end;
$function$;

notify pgrst, 'reload schema';
