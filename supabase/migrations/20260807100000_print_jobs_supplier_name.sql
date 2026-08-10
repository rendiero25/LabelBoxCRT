-- Label box memuat baris "Customer", yaitu nama supplier. Namanya sudah
-- disnapshot di print_jobs.supplier_name_snapshot sejak job dibuat, tetapi
-- tidak pernah ikut keluar dari kedua RPC pembuat job, sehingga klien tidak
-- punya sumber untuk mencetaknya dan hanya punya kode supplier.
--
-- Kolom baru ditambahkan pada RETURNS TABLE, jadi kedua fungsinya harus
-- dibuang dulu: CREATE OR REPLACE menolak perubahan tipe kembalian.

drop function if exists public.create_label_box_print_jobs(uuid);

CREATE FUNCTION public.create_label_box_print_jobs(p_batch_id uuid)
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

  -- Batch terbuka: boleh cetak hanya bila cakupan produknya sudah lengkap.
  -- Produk yang diminta diambil dari box_layer_requirements, sama persis
  -- dengan penjaga di close_label_box_batch.
  if target_batch.closed_at is null and exists (
    select requirement.product_id
    from public.box_layer_requirements requirement
    join public.box_layers layer on layer.id = requirement.box_layer_id
    join public.label_boxes box on box.box_id = layer.box_id
    where box.batch_id = p_batch_id
    except
    select scan.product_id
    from public.label_boxes box
    join public.packing_session_scans scan
      on scan.packing_session_id = box.packing_session_id
      and scan.result = 'accepted'
    where box.batch_id = p_batch_id
  ) then
    raise exception using errcode = 'P0001', message = 'MASTER_ITEM_PRODUCTS_INCOMPLETE';
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

-- DROP membuang grant lama; kembalikan persis seperti sebelumnya.
grant execute on function public.create_label_box_print_jobs(uuid) to authenticated;
grant execute on function public.create_label_box_print_jobs(uuid) to service_role;

drop function if exists public.create_label_box_reprint_jobs(uuid, uuid[]);

create function public.create_label_box_reprint_jobs(
  p_batch_id uuid,
  p_label_box_ids uuid[] default null
)
returns table(
  print_job_id uuid,
  label_box_id uuid,
  box_number text,
  label_reference text,
  qr_payload text,
  supplier_code text,
  supplier_name text,
  part_no text,
  part_name text,
  qty integer,
  delivery_number text,
  delivery_date date,
  box_name text,
  lot_no text,
  qty_delivery integer,
  master_item_row_no integer,
  status public.print_job_status
)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  target_batch public.label_box_batches%rowtype;
  target_box record;
  parent_job public.print_jobs%rowtype;
  pending_job public.print_jobs%rowtype;
  reprint_ids uuid[] := '{}';
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

  for target_box in
    select box.*
    from public.label_boxes box
    where box.batch_id = p_batch_id
      and (p_label_box_ids is null or box.id = any(p_label_box_ids))
    order by box.set_no, box.box_no
  loop
    -- SELECT INTO tidak mengosongkan variabel ketika tidak ada baris, jadi
    -- keduanya direset dulu; tanpa itu box berikutnya mewarisi job box
    -- sebelumnya dan mencetak label yang salah.
    parent_job := null;
    pending_job := null;

    select * into parent_job
    from public.print_jobs job
    where job.packing_session_id = target_box.packing_session_id
      and job.parent_print_job_id is null;

    -- Box yang belum pernah dicetak tidak punya induk untuk disalin; label
    -- pertamanya dibuat create_label_box_print_jobs, bukan di sini.
    if parent_job.id is null then
      raise exception using errcode = 'P0001', message = 'LABEL_BOX_NOT_PRINTED';
    end if;

    -- Sudah ada cetakan yang belum tuntas untuk box ini: pakai job itu supaya
    -- satu penekanan tombol tidak menumpuk antrean label yang sama.
    select * into pending_job
    from public.print_jobs job
    where (job.id = parent_job.id or job.parent_print_job_id = parent_job.id)
      and job.status in ('pending', 'printing')
    order by job.created_at desc
    limit 1;

    if pending_job.id is not null then
      reprint_ids := reprint_ids || pending_job.id;
      continue;
    end if;

    insert into public.print_jobs (
      packing_session_id, parent_print_job_id, status, supplier_code_snapshot,
      supplier_name_snapshot, part_no_snapshot, part_name_snapshot, qty_snapshot,
      delivery_number_snapshot, delivery_date_snapshot, box_code_snapshot,
      box_name_snapshot, qty_delivery_snapshot, lot_no_snapshot,
      qr_generated_at_snapshot, qr_payload_snapshot, sequence_no,
      label_reference, template_version, zpl_payload, created_by
    )
    select
      parent_job.packing_session_id, parent_job.id, 'pending',
      parent_job.supplier_code_snapshot, parent_job.supplier_name_snapshot,
      parent_job.part_no_snapshot, parent_job.part_name_snapshot,
      parent_job.qty_snapshot, parent_job.delivery_number_snapshot,
      parent_job.delivery_date_snapshot, parent_job.box_code_snapshot,
      parent_job.box_name_snapshot, parent_job.qty_delivery_snapshot,
      parent_job.lot_no_snapshot, parent_job.qr_generated_at_snapshot,
      parent_job.qr_payload_snapshot, parent_job.sequence_no,
      parent_job.label_reference, parent_job.template_version,
      'PENDING_ZPL_GENERATION', auth.uid()
    returning id into pending_job.id;

    reprint_ids := reprint_ids || pending_job.id;
  end loop;

  if array_length(reprint_ids, 1) is null then
    raise exception using errcode = 'P0001', message = 'LABEL_BOX_NOT_FOUND';
  end if;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    auth.uid(), 'label_box_batch.reprint_jobs_created', 'label_box_batch',
    p_batch_id::text,
    jsonb_build_object(
      'reprint_count', array_length(reprint_ids, 1),
      'whole_batch', p_label_box_ids is null
    )
  );

  return query
  select
    job.id, box.id, box.box_number, job.label_reference, job.qr_payload_snapshot,
    job.supplier_code_snapshot, job.supplier_name_snapshot, job.part_no_snapshot,
    job.part_name_snapshot, job.qty_snapshot, job.delivery_number_snapshot,
    job.delivery_date_snapshot, job.box_name_snapshot, job.lot_no_snapshot,
    job.qty_delivery_snapshot, target_batch.master_item_row_no, job.status
  from public.print_jobs job
  join public.label_boxes box
    on box.packing_session_id = job.packing_session_id
  where job.id = any(reprint_ids)
  order by box.set_no, box.box_no;
end;
$function$;

grant execute on function public.create_label_box_reprint_jobs(uuid, uuid[]) to authenticated;
grant execute on function public.create_label_box_reprint_jobs(uuid, uuid[]) to service_role;

notify pgrst, 'reload schema';
