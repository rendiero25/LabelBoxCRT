-- claim_print_job menolak payload yang tidak berbentuk ZPL, sehingga label yang
-- dicetak ke printer kertas (Canon G4010) gagal di langkah klaim dengan
-- PRINT_PAYLOAD_INVALID sebelum sempat sampai ke printer.
--
-- Payload yang disimpan adalah payload yang benar-benar dikirim ke printer,
-- supaya rekaman job tetap cocok dengan hasil cetaknya. Untuk printer label itu
-- ZPL "^XA...^XZ", untuk printer kertas potongan HTML satu label. Pemeriksaannya
-- karena itu menerima dua bentuk, dan tetap menolak teks sembarang: kolom ini
-- masuk ke rekaman audit, bukan sekadar penyangga.
--
-- Batas panjang naik dari 16 KB ke 32 KB. Satu label HTML kira-kira 8,4 KB —
-- sebagian besar QR yang ditanam sebagai data URL — jadi 16 KB sebenarnya masih
-- muat, tetapi sisanya terlalu tipis untuk part no atau QR payload yang panjang.

CREATE OR REPLACE FUNCTION public.claim_print_job(p_print_job_id uuid, p_zpl_payload text)
 RETURNS TABLE(print_job_id uuid, packing_session_id uuid, job_status print_job_status, session_status packing_session_status, attempt_count integer, label_reference text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  target_job public.print_jobs%rowtype;
  target_session public.packing_sessions%rowtype;
  resulting_session_status public.packing_session_status;
begin
  if not (select private.is_active_app_user()) and not (select private.is_active_admin()) then
    raise exception using errcode = 'P0001', message = 'PRINT_JOB_FORBIDDEN';
  end if;

  if p_zpl_payload is null
     or length(p_zpl_payload) = 0
     or length(p_zpl_payload) > 32768
     or not (
       -- Printer label: ZPL utuh.
       (p_zpl_payload like '^XA%' and p_zpl_payload like '%^XZ')
       -- Printer kertas: potongan HTML satu label. Bentuknya terikat pada
       -- elemen pembungkus buildLabelHtml; kalau pembungkusnya diganti, klaim
       -- cetak akan ditolak di sini dan pemeriksaan ini harus ikut berubah.
       or (p_zpl_payload like '<div%' and p_zpl_payload like '%</div>')
     ) then
    raise exception using errcode = 'P0001', message = 'PRINT_PAYLOAD_INVALID';
  end if;

  select * into target_job
  from public.print_jobs job
  where job.id = p_print_job_id
  for update;

  if target_job.id is null then
    raise exception using errcode = 'P0001', message = 'PRINT_JOB_NOT_FOUND';
  end if;

  select * into target_session
  from public.packing_sessions session
  where session.id = target_job.packing_session_id
  for update;

  if target_session.operator_id <> auth.uid() and not (select private.is_active_admin()) then
    raise exception using errcode = 'P0001', message = 'PRINT_JOB_FORBIDDEN';
  end if;

  -- Claimable: fresh (pending), retry (failed), or stale self re-claim
  -- (printing older than 2 minutes — tab died mid-print).
  if not (
    target_job.status in ('pending', 'failed')
    or (
      target_job.status = 'printing'
      and target_job.updated_at < statement_timestamp() - interval '2 minutes'
    )
  ) then
    raise exception using errcode = 'P0001', message = 'PRINT_JOB_NOT_CLAIMABLE';
  end if;

  update public.print_jobs job
  set status = 'printing', zpl_payload = p_zpl_payload
  where job.id = target_job.id
  returning * into target_job;

  update public.packing_sessions session
  set status = 'printing'
  where session.id = target_session.id
    and session.status in ('print_pending', 'print_failed', 'printing')
  returning session.status into resulting_session_status;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    auth.uid(), 'print_job.claimed', 'print_job', target_job.id::text,
    jsonb_build_object(
      'packing_session_id', target_session.id,
      'attempt_count', target_job.attempt_count,
      'zpl_length', length(p_zpl_payload)
    )
  );

  return query select
    target_job.id, target_session.id, target_job.status,
    coalesce(resulting_session_status, target_session.status),
    target_job.attempt_count, target_job.label_reference;
end;
$function$;
