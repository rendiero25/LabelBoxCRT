-- Mengisi MPQ yang kosong pada jadwal yang sudah diunggah.
--
-- Jadwal menyalin MPQ ke barisnya sendiri saat diunggah, dan itu tetap benar:
-- truk yang sedang diperiksa tidak boleh berubah jumlah box-nya di tengah
-- jalan. Tetapi aturan itu menjebak baris yang MPQ-nya belum ada saat diunggah.
-- Ukuran ditambahkan ke MPQ Sheet sesudahnya, dan jadwalnya tidak pernah ikut
-- terisi -- satu-satunya jalan keluar mengunggah ulang seluruh file ke session
-- baru, padahal yang kurang cuma satu angka.
--
-- Baris ber-MPQ kosong tidak pernah bisa diverifikasi sama sekali: tidak ada
-- Qty yang bisa disebut sah untuknya, jadi verified_qty-nya pasti nol dan tidak
-- ada satu pun box yang sudah masuk. Mengisinya belakangan karena itu tidak
-- bisa merusak pemeriksaan yang sedang berjalan, dan hanya baris semacam itu
-- yang disentuh fungsi ini. Yang sudah punya MPQ tidak pernah ditimpa, bahkan
-- kalau angkanya di MPQ Sheet sudah berubah.

create function public.refresh_delivery_schedule_mpq(p_session_id uuid)
returns integer
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  target_session public.delivery_verification_sessions%rowtype;
  filled_count integer;
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

  if target_session.status <> 'open' then
    raise exception using errcode = 'P0001', message = 'DELIVERY_SESSION_CLOSED';
  end if;

  with filled as (
    update public.delivery_schedule_rows schedule_row
    set mpq_qty = mpq.mpq_qty
    from public.mpq_sheet_rows mpq
    where schedule_row.session_id = p_session_id
      and schedule_row.mpq_qty is null
      and mpq.is_active
      and mpq.product_size_key
        = regexp_replace(upper(schedule_row.product_size), '\s', '', 'g')
    returning schedule_row.id
  )
  select count(*)::integer into filled_count from filled;

  -- Dicatat meski nol: "sudah saya tekan tombolnya dan tidak ada yang berubah"
  -- adalah pertanyaan yang datang kemudian, dan jawabannya harus ada.
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    auth.uid(), 'delivery_verification_session.mpq_refreshed',
    'delivery_verification_session', p_session_id::text,
    jsonb_build_object(
      'session_no', target_session.session_no,
      'filled_rows', filled_count
    )
  );

  return filled_count;
end;
$$;

revoke execute on function public.refresh_delivery_schedule_mpq(uuid)
  from public, anon;
grant execute on function public.refresh_delivery_schedule_mpq(uuid)
  to authenticated;

notify pgrst, 'reload schema';
