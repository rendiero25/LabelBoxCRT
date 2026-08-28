-- Label membawa Qty Delivery, bukan isi box.
--
-- 20260828025319 menganggap tiap box membawa Qty-nya sendiri: box penuh
-- ber-Qty MPQ dan box terakhir ber-Qty sisanya. Itu keliru. Semua box dari satu
-- baris kiriman membawa label yang sama persis, dan angka di field ketiga QR
-- adalah Qty Delivery -- seluruh jumlah untuk ukuran itu.
--
-- Kekeliruannya tidak terlihat sampai sekarang karena setiap baris yang pernah
-- diperiksa kebetulan berjumlah satu box, atau ber-Qty Delivery sama dengan
-- MPQ-nya; pada kedua keadaan itu "Qty box" dan "Qty Delivery" bernilai sama.
-- Session 15 baris 6 yang pertama memisahkannya: Qty Delivery 2000, MPQ 1500,
-- jadi 2 box -- dan labelnya membawa 2000, ditolak karena aturan lama menuntut
-- 1500 atau 500.
--
-- Aturan yang benar: satu scan diterima kalau ukurannya cocok, barisnya masih
-- kurang box, dan Qty di QR sama dengan Qty Delivery baris itu. Tiap scan yang
-- diterima menghitung satu box, dan barisnya lunas setelah discan sebanyak
-- jumlah box-nya. Baris 2000/1500 karena itu discan dua kali dengan label yang
-- sama.
--
-- Konsekuensi yang harus disebut: karena seluruh box satu baris berlabel sama,
-- tidak ada cara membedakan box pertama dari box kedua lewat QR-nya. Satu box
-- yang ditembak dua kali tidak bisa dibedakan dari dua box. Cek dobel memang
-- sudah dimatikan sejak awal, tetapi sekarang ia bukan cuma dimatikan --
-- bahannya tidak ada. Yang menjaga jumlah box tetap benar tinggal ketelitian
-- operator, dan delivery_verification_scans yang mencatat tiap tembakan.

-- Jumlah keping tidak lagi bisa dijumlahkan dari scan: tiap scan membawa angka
-- yang sama. Yang dihitung sekarang box, dan penghitungnya jadi kolom biasa --
-- bukan turunan dari keping.
alter table public.delivery_schedule_rows
  add column verified_box_count integer not null default 0;

update public.delivery_schedule_rows
set verified_box_count = coalesce(verified_boxes, 0);

alter table public.delivery_schedule_rows
  drop column verified_boxes,
  drop column verified_qty;

alter table public.delivery_schedule_rows
  rename column verified_box_count to verified_boxes;

-- Jaring pengaman di database, bukan hanya di RPC: baris tanpa MPQ tidak punya
-- jumlah box, jadi ia tidak boleh punya box terverifikasi sama sekali.
alter table public.delivery_schedule_rows
  add constraint delivery_schedule_rows_verified_boxes_range check (
    verified_boxes >= 0
    and (
      case
        when mpq_qty is null then verified_boxes = 0
        else verified_boxes <= (
          qty_delivery / mpq_qty
          + case when qty_delivery % mpq_qty > 0 then 1 else 0 end
        )
      end
    )
  );

/**
 * Mencocokkan satu hasil scan dengan jadwal.
 *
 * Payload dipecah pada '|'. Field kedua ukuran produk, field ketiga Qty
 * Delivery; sisanya tidak dibaca sama sekali.
 *
 * Sebuah scan diterima kalau ada baris jadwal berukuran sama yang masih kurang
 * box dan Qty-nya sama dengan Qty Delivery baris itu. Tiap scan yang diterima
 * menghitung satu box.
 *
 * Qty tetap diperiksa meski nilainya sama untuk semua box baris itu: ia yang
 * membedakan dua kiriman berukuran sama dengan jumlah berbeda, dan tanpa itu
 * label kiriman lain bisa melunasi baris ini.
 */
drop function if exists public.verify_delivery_label(uuid, text);

create function public.verify_delivery_label(
  p_session_id uuid,
  p_qr_payload text
)
returns table (
  result public.delivery_scan_result,
  matched_row_id uuid,
  matched_row_no integer,
  product_size text,
  qty_delivery integer,
  mpq_qty integer,
  expected_boxes integer,
  verified_boxes integer,
  row_done boolean,
  size_complete boolean,
  mpq_missing boolean,
  expected_qty integer,
  part_no text,
  packing_qty integer,
  verified_count integer,
  total_count integer,
  delivery_ok boolean
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  target_session public.delivery_verification_sessions%rowtype;
  matched public.delivery_schedule_rows%rowtype;
  explainer public.delivery_schedule_rows%rowtype;
  scan_result public.delivery_scan_result;
  normalized_payload text := btrim(coalesce(p_qr_payload, ''));
  payload_fields text[];
  label_part_no text;
  label_part_no_key text;
  label_qty_text text;
  label_qty integer;
  boxes_total integer;
  boxes_done integer;
  rows_total integer;
  rows_left integer;
  out_size_complete boolean := false;
  out_mpq_missing boolean := false;
  out_expected_qty integer;
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

  if normalized_payload = '' then
    raise exception using errcode = 'P0001', message = 'DELIVERY_SCAN_EMPTY';
  end if;

  payload_fields := string_to_array(normalized_payload, '|');

  if coalesce(array_length(payload_fields, 1), 0) >= 3 then
    label_part_no := regexp_replace(
      upper(btrim(payload_fields[2])), '\s+', ' ', 'g'
    );
    label_part_no_key := regexp_replace(upper(payload_fields[2]), '\s', '', 'g');
    label_qty_text := btrim(payload_fields[3]);
  end if;

  if coalesce(label_part_no_key, '') = ''
    or coalesce(label_qty_text, '') !~ '^[0-9]{1,9}$'
    or label_qty_text::integer <= 0 then
    scan_result := 'unknown_label';
    label_part_no := null;
    label_qty := null;
  else
    label_qty := label_qty_text::integer;

    select schedule_row.* into matched
    from public.delivery_schedule_rows schedule_row
    where schedule_row.session_id = p_session_id
      and regexp_replace(upper(schedule_row.product_size), '\s', '', 'g')
        = label_part_no_key
      and schedule_row.mpq_qty is not null
      and schedule_row.qty_delivery = label_qty
      and schedule_row.verified_boxes < schedule_row.expected_boxes
    order by schedule_row.row_no
    limit 1;

    if matched.id is null then
      scan_result := 'not_pass';

      -- Baris berukuran sama tetap dicari untuk menjelaskan penolakannya.
      -- Yang belum lunas didahulukan, dan di antaranya yang belum punya MPQ --
      -- itu sebab yang paling menentukan tindakan berikutnya.
      select schedule_row.* into explainer
      from public.delivery_schedule_rows schedule_row
      where schedule_row.session_id = p_session_id
        and regexp_replace(upper(schedule_row.product_size), '\s', '', 'g')
          = label_part_no_key
      order by
        (
          schedule_row.mpq_qty is null
          or schedule_row.verified_boxes < schedule_row.expected_boxes
        ) desc,
        (schedule_row.mpq_qty is null) desc,
        schedule_row.row_no
      limit 1;

      if explainer.id is not null then
        out_mpq_missing := explainer.mpq_qty is null;
        out_size_complete := not out_mpq_missing
          and explainer.verified_boxes >= explainer.expected_boxes;

        if not out_mpq_missing then
          out_expected_qty := explainer.qty_delivery;
        end if;
      end if;
    else
      update public.delivery_schedule_rows
      set
        verified_boxes = matched.verified_boxes + 1,
        verified_at = case
          when matched.verified_boxes + 1 >= matched.expected_boxes
          then now()
          else null
        end
      where public.delivery_schedule_rows.id = matched.id
      returning * into matched;

      scan_result := 'pass';
    end if;
  end if;

  insert into public.delivery_verification_scans (
    session_id, qr_payload, result, matched_row_id, label_box_id, scanned_by
  ) values (
    p_session_id, normalized_payload, scan_result, matched.id, null, auth.uid()
  );

  -- Baris tanpa MPQ tidak menyumbang box ke hitungan, tetapi tetap terhitung
  -- sebagai baris yang belum lunas.
  select
    count(*)::integer,
    count(*) filter (
      where schedule_row.mpq_qty is null
        or schedule_row.verified_boxes < schedule_row.expected_boxes
    )::integer,
    coalesce(sum(schedule_row.expected_boxes), 0)::integer,
    coalesce(sum(schedule_row.verified_boxes), 0)::integer
  into rows_total, rows_left, boxes_total, boxes_done
  from public.delivery_schedule_rows schedule_row
  where schedule_row.session_id = p_session_id;

  if rows_total > 0 and rows_left = 0 then
    update public.delivery_verification_sessions
    set status = 'done', closed_at = now()
    where public.delivery_verification_sessions.id = p_session_id;

    insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
    values (
      auth.uid(), 'delivery_verification_session.completed',
      'delivery_verification_session', p_session_id::text,
      jsonb_build_object('session_no', target_session.session_no, 'box_count', boxes_total)
    );
  end if;

  return query
  select
    scan_result,
    matched.id,
    matched.row_no,
    coalesce(matched.product_size, explainer.product_size),
    coalesce(matched.qty_delivery, explainer.qty_delivery),
    coalesce(matched.mpq_qty, explainer.mpq_qty),
    coalesce(matched.expected_boxes, explainer.expected_boxes),
    coalesce(matched.verified_boxes, explainer.verified_boxes),
    (matched.id is not null and matched.verified_at is not null),
    out_size_complete,
    out_mpq_missing,
    out_expected_qty,
    label_part_no,
    label_qty,
    boxes_done,
    boxes_total,
    (rows_total > 0 and rows_left = 0);
end;
$$;

revoke execute on function public.verify_delivery_label(uuid, text)
  from public, anon;
grant execute on function public.verify_delivery_label(uuid, text)
  to authenticated;

notify pgrst, 'reload schema';
