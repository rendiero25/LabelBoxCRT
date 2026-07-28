-- Label box batch generation (spec
-- docs/superpowers/specs/2026-07-28-label-box-batch-generation-design.md).
--
-- Operator mengisi satu form delivery; sistem menggenerate seluruh label box
-- sekaligus. Batch menyimpan snapshot (packing qty, nomor urut master item,
-- lot no) supaya label yang sudah tercetak tidak ikut berubah ketika master
-- data diedit.

create type public.label_box_status as enum ('generated', 'verified');

create table public.label_box_batches (
  id uuid primary key default gen_random_uuid(),
  delivery_number_id uuid not null references public.delivery_numbers (id) on delete restrict,
  supplier_id uuid not null references public.suppliers (id) on delete restrict,
  master_item_id uuid not null references public.master_items (id) on delete restrict,
  master_item_row_no integer not null check (master_item_row_no > 0),
  packing_qty integer not null check (packing_qty > 0),
  qty_delivery integer not null check (qty_delivery > 0),
  lot_no text not null check (btrim(lot_no) <> ''),
  label_count integer not null check (label_count > 0),
  qr_generated_at timestamptz,
  created_by uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.label_boxes (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.label_box_batches (id) on delete cascade,
  box_id uuid not null references public.boxes (id) on delete restrict,
  box_no integer not null check (box_no between 1 and 3),
  set_no integer not null check (set_no between 1 and 99),
  box_number text not null check (btrim(box_number) <> ''),
  qr_payload text not null check (btrim(qr_payload) <> ''),
  status public.label_box_status not null default 'generated',
  created_at timestamptz not null default now(),
  constraint label_boxes_batch_number_key unique (batch_id, box_number)
);

create index label_box_batches_created_idx
  on public.label_box_batches (created_at desc);
create index label_box_batches_delivery_number_idx
  on public.label_box_batches (delivery_number_id);
create index label_boxes_batch_idx on public.label_boxes (batch_id);

create trigger label_box_batches_set_updated_at
before update on public.label_box_batches
for each row execute function private.set_updated_at();

alter table public.label_box_batches enable row level security;
alter table public.label_boxes enable row level security;

-- Hanya baca lewat RLS; semua tulis lewat RPC SECURITY DEFINER.
grant select on table public.label_box_batches, public.label_boxes to authenticated;

create policy label_box_batches_select on public.label_box_batches
for select to authenticated
using ((select private.is_active_admin()) or (select private.is_active_operator()));

create policy label_boxes_select on public.label_boxes
for select to authenticated
using ((select private.is_active_admin()) or (select private.is_active_operator()));
