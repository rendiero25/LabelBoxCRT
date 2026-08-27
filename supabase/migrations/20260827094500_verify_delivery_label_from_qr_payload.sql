-- Verifikasi pengiriman dicocokkan langsung dari isi string QR.
--
-- Label sheet tidak dibuat aplikasi ini. Ia sudah tercetak di lantai produksi,
-- jadi payload-nya tidak pernah ada di label_boxes dan pencarian lewat tabel
-- itu selalu berakhir unknown_label -- tidak ada baris jadwal yang bisa PASS
-- sebelum Master Item sheet didaftarkan dan batch-nya dicetak. Padahal yang
-- diperiksa cuma dua angka, dan keduanya tercetak di dalam QR-nya sendiri:
--
--   10015|VS-B T0.3XW100 L=120MM|2000|DBT-512 NI-2445-240826-B001|24-AUG-2026
--          ^ field 2: ukuran produk          ^ field 3: Qty delivery
--
-- Karena itu tiga hal berubah bersama:
--
--   1. RPC mengurai payload sendiri; label_boxes dan label_box_batches tidak
--      lagi disentuh.
--   2. Cek label dobel dilepas. Ia bertumpu pada identitas label fisik di
--      label_boxes, dan identitas itu sudah tidak ada. Field 4 payload memang
--      berbeda antar label, tetapi yang diminta hanya ukuran dan Qty, jadi
--      field itu sengaja tidak ikut dibaca -- membacanya berarti memutuskan
--      diam-diam bahwa penulisannya konsisten, dan itu belum diperiksa.
--   3. Kolom matching_batch_exists dibuang beserta view-nya. Ia menjawab
--      "sudah ada labelnya di database?", dan sekarang jawabannya selalu tidak
--      untuk setiap baris -- peringatan yang menyala terus tidak dibaca siapa
--      pun.
--
-- Konsekuensi yang diterima sadar: satu label fisik yang discan dua kali
-- melunasi dua baris jadwal berukuran sama. Session bisa tutup dengan satu box
-- kurang di truk. Tabel delivery_verification_scans tetap mencatat tiap scan
-- beserta payload mentahnya, jadi kejadian itu masih bisa ditelusuri sesudahnya.

-- View tidak menyumbang apa pun lagi di atas tabelnya; halaman membaca
-- delivery_schedule_rows langsung.
drop view public.delivery_schedule_rows_resolved;

/**
 * Mencocokkan satu hasil scan dengan jadwal.
 *
 * Payload dipecah pada '|'. Field kedua adalah ukuran produk dan field ketiga
 * Qty delivery; sisanya -- kode supplier, lot, tanggal -- tidak dibaca sama
 * sekali, sebab tidak ada yang meminta keduanya diperiksa dan setiap field
 * tambahan yang dibaca adalah satu cara baru sebuah scan gagal.
 *
 * Kedua sisi dirapikan dengan cara yang sama sebelum dibandingkan (huruf besar,
 * spasi beruntun jadi satu, ujung dipangkas). Dokumen jadwal diketik tangan dan
 * penulisan spasinya tidak selalu sama dengan yang tercetak di label.
 *
 * Payload yang tidak berbentuk demikian -- kurang dari tiga field, ukuran
 * kosong, atau Qty bukan bilangan bulat positif -- jatuh ke unknown_label.
 * Membedakannya dari not_pass penting bagi operator: yang satu berarti QR-nya
 * tidak terbaca, yang lain berarti QR terbaca tetapi barangnya bukan yang
 * dijadwalkan.
 */
create or replace function public.verify_delivery_label(
  p_session_id uuid,
  p_qr_payload text
)
returns table (
  result public.delivery_scan_result,
  matched_row_id uuid,
  matched_row_no integer,
  product_size text,
  qty integer,
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
  scan_result public.delivery_scan_result;
  normalized_payload text := btrim(coalesce(p_qr_payload, ''));
  payload_fields text[];
  label_part_no text;
  label_qty_text text;
  label_qty integer;
  remaining integer;
  total integer;
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
    label_qty_text := btrim(payload_fields[3]);
  end if;

  -- Qty dibatasi sembilan digit sebelum di-cast: teks yang lebih panjang
  -- meledakkan integer, dan ledakan itu naik sebagai kegagalan tak terduga
  -- alih-alih sebagai NOT PASS yang bisa dibaca operator.
  if coalesce(label_part_no, '') = ''
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
      and schedule_row.verified_at is null
      and schedule_row.product_size = label_part_no
      and schedule_row.qty = label_qty
    order by schedule_row.row_no
    limit 1;

    if matched.id is null then
      scan_result := 'not_pass';
    else
      update public.delivery_schedule_rows
      set verified_at = now()
      where public.delivery_schedule_rows.id = matched.id;

      scan_result := 'pass';
    end if;
  end if;

  insert into public.delivery_verification_scans (
    session_id, qr_payload, result, matched_row_id, label_box_id, scanned_by
  ) values (
    p_session_id, normalized_payload, scan_result, matched.id, null, auth.uid()
  );

  select count(*)::integer,
    count(*) filter (where schedule_row.verified_at is null)::integer
  into total, remaining
  from public.delivery_schedule_rows schedule_row
  where schedule_row.session_id = p_session_id;

  -- Session ditutup hanya kalau ada barisnya. Jadwal kosong yang otomatis
  -- "selesai" akan menutup session sebelum satu pun kiriman diperiksa.
  if total > 0 and remaining = 0 then
    update public.delivery_verification_sessions
    set status = 'done', closed_at = now()
    where public.delivery_verification_sessions.id = p_session_id;

    insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
    values (
      auth.uid(), 'delivery_verification_session.completed',
      'delivery_verification_session', p_session_id::text,
      jsonb_build_object('session_no', target_session.session_no, 'label_count', total)
    );
  end if;

  return query
  select
    scan_result,
    matched.id,
    matched.row_no,
    matched.product_size,
    matched.qty,
    label_part_no,
    label_qty,
    (total - remaining),
    total,
    (total > 0 and remaining = 0);
end;
$$;

notify pgrst, 'reload schema';
