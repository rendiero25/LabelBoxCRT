-- Memperbaiki set_delivery_schedule_row_boxes yang terlanjur dibuat cacat.
--
-- Badan fungsi di 20260828091159 menyebut `verified_at` tanpa kualifikasi,
-- padahal itu juga nama kolom balikan fungsi itu sendiri. Postgres menerima
-- fungsinya saat dibuat -- ambiguitas nama baru ketahuan saat dijalankan --
-- jadi migrasinya sukses dan panggilan pertamanya yang gagal dengan 42702.
--
-- Berkas 20260828091159 sudah dibetulkan sesudah itu, sehingga pada database
-- baru migrasi ini tidak mengubah apa pun. Ia ada untuk database yang terlanjur
-- memegang versi cacatnya. Bagiannya yang berubah cuma satu: `verified_at`
-- dibaca dari salinan barisnya.

create or replace function public.set_delivery_schedule_row_boxes(
  p_row_id uuid,
  p_expected_boxes integer
)
returns table (
  id uuid,
  row_no integer,
  expected_boxes integer,
  verified_boxes integer,
  verified_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  target_row public.delivery_schedule_rows%rowtype;
  target_session public.delivery_verification_sessions%rowtype;
begin
  if not private.is_active_app_user() then
    raise exception using errcode = 'P0001', message = 'ACTIVE_USER_REQUIRED';
  end if;

  select * into target_row
  from public.delivery_schedule_rows schedule_row
  where schedule_row.id = p_row_id;

  if target_row.id is null then
    raise exception using errcode = 'P0001', message = 'DELIVERY_ROW_NOT_FOUND';
  end if;

  select * into target_session
  from public.delivery_verification_sessions session
  where session.id = target_row.session_id;

  if target_session.status <> 'open' then
    raise exception using errcode = 'P0001', message = 'DELIVERY_SESSION_CLOSED';
  end if;

  if p_expected_boxes is null
    or p_expected_boxes < 1
    or p_expected_boxes > 9999 then
    raise exception using errcode = 'P0001', message = 'DELIVERY_BOXES_INVALID';
  end if;

  if p_expected_boxes < target_row.verified_boxes then
    raise exception using errcode = 'P0001', message = 'DELIVERY_BOXES_BELOW_SCANNED';
  end if;

  update public.delivery_schedule_rows
  set
    expected_boxes = p_expected_boxes,
    verified_at = case
      when target_row.verified_boxes >= p_expected_boxes
      then coalesce(target_row.verified_at, now())
      else null
    end
  where public.delivery_schedule_rows.id = p_row_id
  returning * into target_row;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    auth.uid(), 'delivery_schedule_row.boxes_set', 'delivery_schedule_row',
    target_row.id::text,
    jsonb_build_object(
      'session_no', target_session.session_no,
      'row_no', target_row.row_no,
      'product_size', target_row.product_size,
      'expected_boxes', target_row.expected_boxes
    )
  );

  return query
  select
    target_row.id, target_row.row_no, target_row.expected_boxes,
    target_row.verified_boxes, target_row.verified_at;
end;
$$;

notify pgrst, 'reload schema';
