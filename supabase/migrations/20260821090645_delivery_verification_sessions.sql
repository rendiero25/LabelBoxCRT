-- Verifikasi Pengiriman, Bagian 1: session dan Schedule Delivery (spec
-- docs/superpowers/specs/2026-08-21-verifikasi-pengiriman-design.md).
--
-- Operator membuat session, lalu mengisi tabel Schedule Delivery dari file
-- Excel/PDF. Bagian 2 (verifikasi label lewat scan QR) menyusul bersama
-- tabel delivery_verification_scans.

create type public.delivery_verification_status as enum ('open', 'done');

create sequence public.delivery_verification_session_seq as integer start 1;

create table public.delivery_verification_sessions (
  id uuid primary key default gen_random_uuid(),
  -- Nomor urut yang dibaca manusia. Tombol "Tambah Session" tidak meminta
  -- isian apa pun, jadi inilah satu-satunya nama yang dipunyai session saat
  -- baru dibuat; sisanya diturunkan dari baris jadwalnya.
  session_no integer not null unique
    default nextval('public.delivery_verification_session_seq'),
  status public.delivery_verification_status not null default 'open',
  created_by uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz
);

create table public.delivery_schedule_rows (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null
    references public.delivery_verification_sessions (id) on delete cascade,
  -- Nomor baris di dalam session, berlanjut lintas upload: file kedua
  -- menambah di bawah baris file pertama, bukan memulai lagi dari 1.
  row_no integer not null check (row_no > 0),
  part_no text not null check (btrim(part_no) <> ''),
  qty integer not null check (qty > 0),
  -- Nama file asalnya disimpan supaya baris yang salah bisa dilacak kembali
  -- ke dokumen yang memasukkannya.
  source_file_name text not null check (btrim(source_file_name) <> ''),
  created_at timestamptz not null default now(),
  -- Terisi ketika satu label box cocok dengan baris ini. Bagian 2 yang
  -- mengisinya; kolomnya sudah ada sekarang supaya Bagian 2 tidak perlu
  -- mengubah bentuk tabel yang sudah dipakai.
  verified_at timestamptz,
  verified_label_box_id uuid references public.label_boxes (id) on delete set null,
  constraint delivery_schedule_rows_session_row_key unique (session_id, row_no)
);

create index delivery_verification_sessions_created_idx
  on public.delivery_verification_sessions (created_at desc);
create index delivery_schedule_rows_session_idx
  on public.delivery_schedule_rows (session_id, row_no);

create trigger delivery_verification_sessions_set_updated_at
before update on public.delivery_verification_sessions
for each row execute function private.set_updated_at();

alter table public.delivery_verification_sessions enable row level security;
alter table public.delivery_verification_sessions force row level security;
alter table public.delivery_schedule_rows enable row level security;
alter table public.delivery_schedule_rows force row level security;

-- Hanya baca lewat RLS; semua tulis lewat RPC security definer.
grant select on table
  public.delivery_verification_sessions, public.delivery_schedule_rows
  to authenticated;

grant usage, select on sequence public.delivery_verification_session_seq
  to authenticated;

create policy delivery_verification_sessions_select
on public.delivery_verification_sessions
for select to authenticated
using ((select private.is_active_app_user()));

create policy delivery_schedule_rows_select
on public.delivery_schedule_rows
for select to authenticated
using ((select private.is_active_app_user()));

create function public.create_delivery_verification_session()
returns table (
  id uuid,
  session_no integer,
  status public.delivery_verification_status,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  created public.delivery_verification_sessions%rowtype;
begin
  if not private.is_active_app_user() then
    raise exception using errcode = 'P0001', message = 'ACTIVE_USER_REQUIRED';
  end if;

  insert into public.delivery_verification_sessions (created_by)
  values (auth.uid())
  returning * into created;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    auth.uid(), 'delivery_verification_session.created',
    'delivery_verification_session', created.id::text,
    jsonb_build_object('session_no', created.session_no)
  );

  return query
  select created.id, created.session_no, created.status, created.created_at;
end;
$$;

/**
 * Menambah baris Schedule Delivery dari satu file.
 *
 * Seluruh baris satu file masuk dalam satu panggilan, bukan satu panggilan per
 * baris: file yang setengah masuk lalu gagal di tengah meninggalkan jadwal yang
 * tidak sesuai dokumen mana pun, dan operator tidak punya cara tahu bagian mana
 * yang hilang.
 *
 * Part No yang sudah ada sengaja tidak ditolak maupun ditimpa. Dua kiriman Part
 * No sama dengan Qty berbeda adalah dua baris jadwal, dan masing-masing perlu
 * satu label yang cocok.
 */
create function public.add_delivery_schedule_rows(
  p_session_id uuid,
  p_source_file_name text,
  p_rows jsonb
)
returns table (
  id uuid,
  row_no integer,
  part_no text,
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

  -- File tanpa satu pun baris terbaca ditolak, bukan diterima diam-diam:
  -- tabel yang tidak bertambah setelah upload terbaca sebagai aplikasi yang
  -- menggantung, dan operator akan mengunggahnya berulang kali.
  if jsonb_array_length(p_rows) = 0 then
    raise exception using errcode = 'P0001', message = 'DELIVERY_ROWS_EMPTY';
  end if;

  select count(*)::integer into row_count
  from jsonb_array_elements(p_rows) as entry
  where coalesce(btrim(entry.value ->> 'partNo'), '') <> ''
    and (entry.value ->> 'qty') ~ '^[1-9][0-9]{0,6}$';

  if row_count <> jsonb_array_length(p_rows) then
    raise exception using errcode = 'P0001', message = 'DELIVERY_ROWS_INVALID';
  end if;

  select coalesce(max(existing.row_no), 0) + 1 into next_row_no
  from public.delivery_schedule_rows existing
  where existing.session_id = p_session_id;

  return query
  insert into public.delivery_schedule_rows (
    session_id, row_no, part_no, qty, source_file_name
  )
  select
    p_session_id,
    next_row_no + (entry.ordinality::integer - 1),
    upper(regexp_replace(btrim(entry.value ->> 'partNo'), '\s+', ' ', 'g')),
    (entry.value ->> 'qty')::integer,
    normalized_file
  from jsonb_array_elements(p_rows) with ordinality as entry(value, ordinality)
  returning
    public.delivery_schedule_rows.id,
    public.delivery_schedule_rows.row_no,
    public.delivery_schedule_rows.part_no,
    public.delivery_schedule_rows.qty,
    public.delivery_schedule_rows.source_file_name,
    public.delivery_schedule_rows.created_at;
end;
$$;

/**
 * Membuang satu baris jadwal. Upload yang salah file hanya bisa diperbaiki
 * dengan membuang barisnya; tidak ada jalan menyunting Part No atau Qty di
 * layar, supaya isi tabel selalu bisa ditelusuri kembali ke dokumennya.
 */
create function public.delete_delivery_schedule_row(p_row_id uuid)
returns void
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

  delete from public.delivery_schedule_rows
  where public.delivery_schedule_rows.id = p_row_id;
end;
$$;

revoke execute on function public.create_delivery_verification_session()
  from public, anon;
grant execute on function public.create_delivery_verification_session()
  to authenticated;

revoke execute on function public.add_delivery_schedule_rows(uuid, text, jsonb)
  from public, anon;
grant execute on function public.add_delivery_schedule_rows(uuid, text, jsonb)
  to authenticated;

revoke execute on function public.delete_delivery_schedule_row(uuid)
  from public, anon;
grant execute on function public.delete_delivery_schedule_row(uuid)
  to authenticated;

notify pgrst, 'reload schema';
