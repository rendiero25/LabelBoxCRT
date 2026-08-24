-- Membuang satu session verifikasi pengiriman beserta isinya.
--
-- Baris jadwal dan catatan scan ikut terhapus lewat cascade, jadi yang hilang
-- bukan cuma sessionnya melainkan seluruh bukti pemeriksaannya. Karena itu
-- ringkasannya dicatat ke audit_logs lebih dulu: berapa baris, berapa yang
-- sudah PASS, dan berapa kali label discan. Setelah itu barisnya boleh pergi,
-- tetapi keterangan bahwa pernah ada pemeriksaan sebesar itu tetap tinggal.

create function public.delete_delivery_verification_session(p_session_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  target_session public.delivery_verification_sessions%rowtype;
  row_total integer;
  verified_total integer;
  scan_total integer;
begin
  if not private.is_active_app_user() then
    raise exception using errcode = 'P0001', message = 'ACTIVE_USER_REQUIRED';
  end if;

  select * into target_session
  from public.delivery_verification_sessions session
  where session.id = p_session_id;

  if target_session.id is null then
    raise exception using errcode = 'P0001', message = 'DELIVERY_SESSION_NOT_FOUND';
  end if;

  select
    count(*)::integer,
    count(*) filter (where schedule_row.verified_at is not null)::integer
  into row_total, verified_total
  from public.delivery_schedule_rows schedule_row
  where schedule_row.session_id = p_session_id;

  select count(*)::integer into scan_total
  from public.delivery_verification_scans scan
  where scan.session_id = p_session_id;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    auth.uid(), 'delivery_verification_session.deleted',
    'delivery_verification_session', p_session_id::text,
    jsonb_build_object(
      'session_no', target_session.session_no,
      'status', target_session.status,
      'row_count', row_total,
      'verified_count', verified_total,
      'scan_count', scan_total
    )
  );

  delete from public.delivery_verification_sessions
  where public.delivery_verification_sessions.id = p_session_id;
end;
$$;

revoke execute on function public.delete_delivery_verification_session(uuid)
  from public, anon;
grant execute on function public.delete_delivery_verification_session(uuid)
  to authenticated;

notify pgrst, 'reload schema';
