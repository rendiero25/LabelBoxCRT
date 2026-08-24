-- Verifikasi Pengiriman, Bagian 2: mencocokkan label box dengan jadwal yang
-- berisi ukuran produk (spec
-- docs/superpowers/specs/2026-08-21-verifikasi-pengiriman-design.md).
--
-- Kolom pertama jadwal ternyata ukuran produk, bukan Part No Master Item.
-- Kolomnya diganti nama supaya isinya tidak dibaca sebagai Part No, dan
-- pencocokan Bagian 2 dikerjakan lewat terjemahan ukuran -> produk -> Master
-- Item.

alter table public.delivery_schedule_rows
  rename column part_no to product_size;

/**
 * Tiga angka pertama dari teks ukuran produk, berurutan.
 *
 * Satu aturan ini menangani dua bentuk penulisan yang dipakai di lapangan
 * tanpa perlu tahu jenis partnya:
 *
 *   'VO-B D6X7 Pt.L=525'      -> {6, 7, 525}
 *   'VS-B T0.3XW100 L=120MM'  -> {0.3, 100, 120}
 *
 * Yang dikembalikan angka, bukan teks, supaya '6' dan '6.0' dianggap sama --
 * dokumen jadwal diketik tangan dan nol di belakang koma datang dan pergi.
 *
 * Teks dengan angka kurang dari tiga tidak bisa menunjuk satu produk, jadi
 * hasilnya null: baris seperti itu tetap boleh masuk jadwal, tetapi tidak akan
 * pernah cocok dengan produk mana pun.
 */
create function private.product_size_dimensions(p_text text)
returns numeric[]
language sql
immutable
as $$
  select case
    when count(*) = 3 then array_agg(value order by ord)
  end
  from (
    select (match[1])::numeric as value, ord
    from regexp_matches(
      coalesce(p_text, ''), '([0-9]+(?:\.[0-9]+)?)', 'g'
    ) with ordinality as found(match, ord)
    order by ord
    limit 3
  ) first_three;
$$;

/**
 * Master Item yang diwakili satu teks ukuran produk.
 *
 * Nama part dicocokkan lewat awalan, bukan dengan memotong kata pertama: nama
 * part boleh berisi spasi ('Tube DEV SAMPLE'), dan memotong di spasi pertama
 * akan membuang sisanya.
 *
 * Satu ukuran bisa dipakai lebih dari satu Master Item. Yang diambil satu saja
 * dan yang paling tua: pencocokan yang berubah-ubah antar scan lebih buruk
 * daripada pencocokan yang salah tetapi tetap, karena yang berubah-ubah tidak
 * bisa ditelusuri.
 */
create function private.master_item_for_product_size(p_text text)
returns uuid
language sql
stable
as $$
  select mapping.master_item_id
  from public.products product
  join public.master_item_products mapping
    on mapping.product_id = product.id and mapping.is_active
  join public.master_items item
    on item.id = mapping.master_item_id and item.deleted_at is null
  where upper(btrim(coalesce(p_text, ''))) like upper(btrim(product.part_name)) || ' %'
    and private.product_size_dimensions(p_text) is not null
    and product.outer_diameter = (private.product_size_dimensions(p_text))[1]
    and product.inner_diameter = (private.product_size_dimensions(p_text))[2]
    and product.length = (private.product_size_dimensions(p_text))[3]
  order by mapping.created_at, mapping.id
  limit 1;
$$;

/**
 * Baris jadwal beserta Master Item hasil terjemahan ukurannya.
 *
 * Layar memerlukan terjemahan itu sebelum satu pun scan terjadi: baris yang
 * ukurannya tidak menunjuk produk mana pun tidak akan pernah PASS, dan operator
 * harus tahu itu saat mengunggah filenya, bukan setelah seluruh truk discan.
 *
 * security_invoker supaya RLS tabel di bawahnya tetap berlaku bagi pembacanya.
 */
create view public.delivery_schedule_rows_resolved
with (security_invoker = true)
as
select
  schedule_row.id,
  schedule_row.session_id,
  schedule_row.row_no,
  schedule_row.product_size,
  schedule_row.qty,
  schedule_row.source_file_name,
  schedule_row.created_at,
  schedule_row.verified_at,
  schedule_row.verified_label_box_id,
  private.master_item_for_product_size(schedule_row.product_size)
    as resolved_master_item_id,
  (
    select item.part_no from public.master_items item
    where item.id = private.master_item_for_product_size(schedule_row.product_size)
  ) as resolved_part_no
from public.delivery_schedule_rows schedule_row;

grant select on public.delivery_schedule_rows_resolved to authenticated;

create type public.delivery_scan_result as enum (
  'pass', 'not_pass', 'unknown_label', 'duplicate_label'
);

/**
 * Tiap scan dicatat, termasuk yang gagal. Tanpa ini NOT PASS hilang tanpa jejak
 * dan tidak ada yang tahu label mana yang salah masuk truk.
 */
create table public.delivery_verification_scans (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null
    references public.delivery_verification_sessions (id) on delete cascade,
  qr_payload text not null check (btrim(qr_payload) <> ''),
  result public.delivery_scan_result not null,
  matched_row_id uuid
    references public.delivery_schedule_rows (id) on delete set null,
  label_box_id uuid references public.label_boxes (id) on delete set null,
  scanned_by uuid not null references public.profiles (id) on delete restrict,
  scanned_at timestamptz not null default now()
);

create index delivery_verification_scans_session_idx
  on public.delivery_verification_scans (session_id, scanned_at desc);

alter table public.delivery_verification_scans enable row level security;
alter table public.delivery_verification_scans force row level security;

grant select on table public.delivery_verification_scans to authenticated;

create policy delivery_verification_scans_select
on public.delivery_verification_scans
for select to authenticated
using ((select private.is_active_app_user()));

/**
 * Mencocokkan satu label box dengan jadwal.
 *
 * Isi string QR sengaja tidak dipercaya. Tiga generasi payload beredar, dan dua
 * di antaranya berbentuk sama persis sementara field ketiganya berbeda arti --
 * sebelum 20260821083835 berisi Qty/Box, sesudahnya Packing Qty. Dari bentuknya
 * saja keduanya tidak bisa dibedakan, jadi payload dipakai sebagai kunci
 * pencarian belaka dan angkanya diambil dari batch di database.
 *
 * Satu label fisik hanya boleh memenuhi satu baris jadwal, jadi label yang
 * sudah terpakai di session ini ditolak sebagai duplicate_label, bukan
 * dicocokkan lagi ke baris berikutnya yang kebetulan sama.
 */
create function public.verify_delivery_label(
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
  target_label public.label_boxes%rowtype;
  target_batch public.label_box_batches%rowtype;
  matched public.delivery_schedule_rows%rowtype;
  scan_result public.delivery_scan_result;
  normalized_payload text := btrim(coalesce(p_qr_payload, ''));
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

  select * into target_label
  from public.label_boxes label_box
  where label_box.qr_payload = normalized_payload
  limit 1;

  if target_label.id is null then
    scan_result := 'unknown_label';
  elsif exists (
    select 1 from public.delivery_schedule_rows used
    where used.session_id = p_session_id
      and used.verified_label_box_id = target_label.id
  ) then
    scan_result := 'duplicate_label';
  else
    select * into target_batch
    from public.label_box_batches batch
    where batch.id = target_label.batch_id;

    -- Baris pertama yang belum terverifikasi, ukurannya menunjuk Master Item
    -- yang sama, dan Qty-nya sama dengan Packing Qty label.
    select schedule_row.* into matched
    from public.delivery_schedule_rows schedule_row
    where schedule_row.session_id = p_session_id
      and schedule_row.verified_at is null
      and schedule_row.qty = coalesce(
        target_batch.qty_delivery_display, target_batch.qty_delivery
      )
      and private.master_item_for_product_size(schedule_row.product_size)
        = target_batch.master_item_id
    order by schedule_row.row_no
    limit 1;

    if matched.id is null then
      scan_result := 'not_pass';
    else
      update public.delivery_schedule_rows
      set verified_at = now(), verified_label_box_id = target_label.id
      where public.delivery_schedule_rows.id = matched.id;

      scan_result := 'pass';
    end if;
  end if;

  insert into public.delivery_verification_scans (
    session_id, qr_payload, result, matched_row_id, label_box_id, scanned_by
  ) values (
    p_session_id, normalized_payload, scan_result, matched.id,
    target_label.id, auth.uid()
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
    target_batch.part_no_snapshot,
    coalesce(target_batch.qty_delivery_display, target_batch.qty_delivery),
    (total - remaining),
    total,
    (total > 0 and remaining = 0);
end;
$$;

revoke execute on function public.verify_delivery_label(uuid, text)
  from public, anon;
grant execute on function public.verify_delivery_label(uuid, text)
  to authenticated;

-- add_delivery_schedule_rows menyebut kolom lamanya, jadi ia ikut diganti.
-- Selain nama kolom dan nama field jsonb-nya, badannya tidak berubah.
--
-- Nama kolom di `returns table` ikut berganti, dan itu terhitung perubahan tipe
-- balik yang tidak bisa direkonsiliasi create-or-replace. Jadi didrop dulu.
drop function if exists public.add_delivery_schedule_rows(uuid, text, jsonb);

create function public.add_delivery_schedule_rows(
  p_session_id uuid,
  p_source_file_name text,
  p_rows jsonb
)
returns table (
  id uuid,
  row_no integer,
  product_size text,
  qty integer,
  source_file_name text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  target_session public.delivery_verification_sessions%rowtype;
  normalized_file text := btrim(coalesce(p_source_file_name, ''));
  next_row_no integer;
  row_count integer;
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

  if normalized_file = '' or char_length(normalized_file) > 255 then
    raise exception using errcode = 'P0001', message = 'DELIVERY_SOURCE_FILE_INVALID';
  end if;

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception using errcode = 'P0001', message = 'DELIVERY_ROWS_INVALID';
  end if;

  if jsonb_array_length(p_rows) = 0 then
    raise exception using errcode = 'P0001', message = 'DELIVERY_ROWS_EMPTY';
  end if;

  select count(*)::integer into row_count
  from jsonb_array_elements(p_rows) as entry
  where coalesce(btrim(entry.value ->> 'productSize'), '') <> ''
    and (entry.value ->> 'qty') ~ '^[1-9][0-9]{0,6}$';

  if row_count <> jsonb_array_length(p_rows) then
    raise exception using errcode = 'P0001', message = 'DELIVERY_ROWS_INVALID';
  end if;

  select coalesce(max(existing.row_no), 0) + 1 into next_row_no
  from public.delivery_schedule_rows existing
  where existing.session_id = p_session_id;

  -- Ukuran yang tidak menunjuk produk mana pun tetap diterima. Menolaknya di
  -- sini berarti satu baris salah ketik menggagalkan seluruh file, sementara
  -- barisnya sendiri sudah tampak jelas di layar sebagai yang tak dikenal.
  return query
  insert into public.delivery_schedule_rows (
    session_id, row_no, product_size, qty, source_file_name
  )
  select
    p_session_id,
    next_row_no + (entry.ordinality::integer - 1),
    upper(regexp_replace(btrim(entry.value ->> 'productSize'), '\s+', ' ', 'g')),
    (entry.value ->> 'qty')::integer,
    normalized_file
  from jsonb_array_elements(p_rows) with ordinality as entry(value, ordinality)
  returning
    public.delivery_schedule_rows.id,
    public.delivery_schedule_rows.row_no,
    public.delivery_schedule_rows.product_size,
    public.delivery_schedule_rows.qty,
    public.delivery_schedule_rows.source_file_name,
    public.delivery_schedule_rows.created_at;
end;
$$;

revoke execute on function public.add_delivery_schedule_rows(uuid, text, jsonb)
  from public, anon;
grant execute on function public.add_delivery_schedule_rows(uuid, text, jsonb)
  to authenticated;

notify pgrst, 'reload schema';
