-- Hapus batch label box gagal untuk batch yang pernah dicetak.
--
-- Tiap penekanan tombol Cetak mencatat satu baris print_attempts lewat
-- complete_print_job, dan print_attempts.print_job_id itu FK on delete restrict.
-- Versi pertama delete_label_box_batch membuang print_jobs tanpa membuang
-- percobaan cetaknya lebih dulu, jadi Postgres menolak dengan 23503 dan
-- operator hanya melihat pesan gagal yang umum.
--
-- reprint_requests menunjuk print_jobs dengan cara yang sama. Belum ada yang
-- mengisinya, tetapi tabelnya ada dan FK-nya sama-sama restrict; membiarkannya
-- di luar urutan hapus berarti bug yang sama menunggu di kemudian hari.
--
-- packing_session_scans juga menunjuk batch lewat label_box_batch_id, bukan
-- hanya lewat sesinya. Baris scan selalu punya packing_session_id, jadi jalur
-- lama sudah menangkap semuanya, tetapi menyaring dengan kedua kolom membuat
-- penghapusannya tidak bergantung pada asumsi itu.

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
  job_ids uuid[];
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

  select
    coalesce(array_agg(job.id), '{}'),
    count(*)::integer
  into job_ids, print_job_count
  from public.print_jobs job
  where job.packing_session_id = any(session_ids);

  select count(*)::integer into scan_count
  from public.packing_session_scans scan
  where scan.packing_session_id = any(session_ids)
    or scan.label_box_batch_id = p_batch_id;

  -- Anak-anak print_jobs lebih dulu: percobaan cetak dan permintaan cetak
  -- ulang sama-sama FK restrict.
  delete from public.print_attempts attempt
  where attempt.print_job_id = any(job_ids);

  delete from public.reprint_requests request
  where request.source_print_job_id = any(job_ids);

  -- Cetak ulang berupa job anak yang menunjuk job awal; induknya baru boleh
  -- pergi setelah anaknya habis.
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
