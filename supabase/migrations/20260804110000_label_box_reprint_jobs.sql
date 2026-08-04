-- Cetak ulang label box.
--
-- Label bisa rusak, hilang, atau gagal keluar karena kertas habis, dan batch
-- yang sudah ditutup memang disimpan supaya bisa dicetak lagi. Sampai sekarang
-- jalur itu buntu: create_label_box_print_jobs bersifat idempoten dan
-- mengembalikan job lama apa adanya, sehingga klien mencoba mengklaim job yang
-- sudah 'confirmed' dan ditolak PRINT_JOB_NOT_CLAIMABLE.
--
-- Kolom parent_print_job_id sudah disiapkan skema Phase 7 untuk ini tetapi
-- tidak pernah ada yang mengisinya. RPC ini membuat job anak dari job awal
-- setiap label box, menyalin seluruh snapshot termasuk label_reference,
-- sequence_no, dan qr_payload: label pengganti harus identik dengan yang
-- hilang, kalau tidak catatan pengiriman dan kertas yang menempel di box tidak
-- lagi bercerita sama.
--
-- Indeks print_jobs_one_initial_per_session_idx hanya melarang job awal ganda
-- per sesi, jadi anak boleh sebanyak yang dibutuhkan.

create or replace function public.create_label_box_reprint_jobs(
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
    job.supplier_code_snapshot, job.part_no_snapshot, job.part_name_snapshot,
    job.qty_snapshot, job.delivery_number_snapshot, job.delivery_date_snapshot,
    job.box_name_snapshot, job.lot_no_snapshot, job.qty_delivery_snapshot,
    target_batch.master_item_row_no, job.status
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
