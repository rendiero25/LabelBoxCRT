-- Label box verification and print (spec
-- docs/superpowers/specs/2026-07-29-label-box-verification-and-print-design.md).
--
-- Batch ditutup operator sebelum boleh dicetak. Tiap label box dipautkan ke
-- satu packing_session supaya logika layer di accept_packing_scan bisa
-- dipakai ulang tanpa ditulis ulang.

alter table public.label_box_batches
  add column closed_at timestamptz,
  add column closed_by uuid references public.profiles (id) on delete restrict;

alter table public.label_boxes
  add column packing_session_id uuid
    references public.packing_sessions (id) on delete restrict;

create unique index label_boxes_packing_session_idx
  on public.label_boxes (packing_session_id)
  where packing_session_id is not null;

-- QR label cetak memakai payload yang sudah tersimpan di label_boxes,
-- bukan dirakit ulang di klien.
alter table public.print_jobs
  add column qr_payload_snapshot text
    check (qr_payload_snapshot is null or btrim(qr_payload_snapshot) <> '');

create index label_box_batches_closed_idx
  on public.label_box_batches (closed_at desc nulls first);

create function public.accept_label_box_scan(
  p_batch_id uuid,
  p_label_uid text,
  p_raw_payload_hash text,
  p_scanned_size text,
  p_normalized_size text
)
returns table (
  result public.scan_result,
  error_code text,
  label_box_id uuid,
  box_number text,
  label_box_status public.label_box_status,
  layer_accepted_qty integer,
  layer_expected_qty integer,
  total_accepted_qty integer,
  total_expected_qty integer
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  target_batch public.label_box_batches%rowtype;
  target_box public.label_boxes%rowtype;
  created_session public.packing_sessions%rowtype;
  scan_row record;
begin
  if not private.is_active_operator() then
    raise exception using errcode = 'P0001', message = 'LABEL_BOX_OPERATOR_REQUIRED';
  end if;

  select * into target_batch
  from public.label_box_batches batch
  where batch.id = p_batch_id;

  if target_batch.id is null then
    raise exception using errcode = 'P0001', message = 'LABEL_BOX_BATCH_NOT_FOUND';
  end if;

  if target_batch.closed_at is not null then
    raise exception using errcode = 'P0001', message = 'LABEL_BOX_BATCH_CLOSED';
  end if;

  -- Box tujuan: nomor terkecil yang belum penuh. Urutan set lalu box
  -- mencerminkan urutan pengepakan di lapangan.
  select * into target_box
  from public.label_boxes box
  where box.batch_id = p_batch_id and box.status <> 'verified'
  order by box.set_no, box.box_no
  limit 1
  for update;

  if target_box.id is null then
    raise exception using errcode = 'P0001', message = 'NO_LABEL_BOX_AVAILABLE';
  end if;

  if target_box.packing_session_id is null then
    insert into public.packing_sessions (
      operator_id, master_item_id, box_id, delivery_number_id,
      qty_delivery, lot_no, status
    ) values (
      auth.uid(), target_batch.master_item_id, target_box.box_id,
      target_batch.delivery_number_id, target_batch.qty_delivery,
      target_batch.lot_no, 'scanning'
    )
    returning * into created_session;

    update public.label_boxes box
    set packing_session_id = created_session.id
    where box.id = target_box.id
    returning * into target_box;
  end if;

  select * into scan_row
  from public.accept_packing_scan(
    target_box.packing_session_id,
    p_label_uid,
    p_raw_payload_hash,
    p_scanned_size,
    p_normalized_size
  );

  if scan_row.session_status = 'ready_to_finalize' then
    update public.label_boxes box
    set status = 'verified'
    where box.id = target_box.id;
  end if;

  return query
  select
    scan_row.result,
    scan_row.error_code,
    target_box.id,
    target_box.box_number,
    (
      select box.status from public.label_boxes box where box.id = target_box.id
    ),
    scan_row.layer_accepted_qty,
    scan_row.layer_expected_qty,
    scan_row.total_accepted_qty,
    scan_row.total_expected_qty;
end;
$$;

revoke execute on function public.accept_label_box_scan(uuid, text, text, text, text)
  from public, anon;
grant execute on function public.accept_label_box_scan(uuid, text, text, text, text)
  to authenticated;

create function public.close_label_box_batch(p_batch_id uuid)
returns table (
  batch_id uuid,
  closed_at timestamptz,
  verified_count integer,
  label_count integer
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  target_batch public.label_box_batches%rowtype;
  pending_box public.label_boxes%rowtype;
  created_session public.packing_sessions%rowtype;
  closed_stamp timestamptz := statement_timestamp();
begin
  if not private.is_active_operator() then
    raise exception using errcode = 'P0001', message = 'LABEL_BOX_OPERATOR_REQUIRED';
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

  -- print_jobs.packing_session_id wajib terisi, sedangkan box yang tidak
  -- pernah discan belum punya sesi. Lengkapi di sini supaya semua label
  -- tetap bisa dicetak apa adanya.
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
$$;

revoke execute on function public.close_label_box_batch(uuid) from public, anon;
grant execute on function public.close_label_box_batch(uuid) to authenticated;

create function public.create_label_box_print_jobs(p_batch_id uuid)
returns table (
  print_job_id uuid,
  label_box_id uuid,
  box_number text,
  label_reference text,
  qr_payload text,
  supplier_code text,
  part_no text,
  part_name text,
  qty integer,
  delivery_number text,
  delivery_date date,
  box_name text,
  lot_no text,
  qty_delivery integer,
  status public.print_job_status
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  target_batch public.label_box_batches%rowtype;
  target_item public.master_items%rowtype;
  pending_box record;
  new_sequence_no bigint;
  new_label_reference text;
begin
  if not private.is_active_operator() then
    raise exception using errcode = 'P0001', message = 'LABEL_BOX_OPERATOR_REQUIRED';
  end if;

  select * into target_batch
  from public.label_box_batches batch
  where batch.id = p_batch_id
  for update;

  if target_batch.id is null then
    raise exception using errcode = 'P0001', message = 'LABEL_BOX_BATCH_NOT_FOUND';
  end if;

  if target_batch.closed_at is null then
    raise exception using errcode = 'P0001', message = 'LABEL_BOX_BATCH_NOT_CLOSED';
  end if;

  select * into target_item
  from public.master_items item
  where item.id = target_batch.master_item_id;

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
      new_label_reference, 'v3', 'PENDING_ZPL_GENERATION', auth.uid()
    from public.suppliers supplier
    where supplier.id = target_batch.supplier_id;
  end loop;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    auth.uid(), 'label_box_batch.print_jobs_created', 'label_box_batch',
    p_batch_id::text,
    jsonb_build_object('label_count', target_batch.label_count)
  );

  return query
  select
    job.id, box.id, box.box_number, job.label_reference, job.qr_payload_snapshot,
    job.supplier_code_snapshot, job.part_no_snapshot, job.part_name_snapshot,
    job.qty_snapshot, job.delivery_number_snapshot, job.delivery_date_snapshot,
    job.box_name_snapshot, job.lot_no_snapshot, job.qty_delivery_snapshot,
    job.status
  from public.label_boxes box
  join public.print_jobs job
    on job.packing_session_id = box.packing_session_id
    and job.parent_print_job_id is null
  where box.batch_id = p_batch_id
  order by box.set_no, box.box_no;
end;
$$;

revoke execute on function public.create_label_box_print_jobs(uuid) from public, anon;
grant execute on function public.create_label_box_print_jobs(uuid) to authenticated;

notify pgrst, 'reload schema';
