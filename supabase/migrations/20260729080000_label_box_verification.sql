-- Label box verification and print (spec
-- docs/superpowers/specs/2026-07-29-label-box-verification-and-print-design.md).
--
-- Batch ditutup operator sebelum boleh dicetak. Tiap label box dipautkan ke
-- satu packing_session supaya logika layer di accept_packing_scan bisa
-- dipakai ulang tanpa ditulis ulang.

alter table public.label_box_batches
  add column closed_at timestamptz,
  add column closed_by uuid references public.profiles (id) on delete restrict;

alter table public.label_boxes
  add column packing_session_id uuid
    references public.packing_sessions (id) on delete restrict;

create unique index label_boxes_packing_session_idx
  on public.label_boxes (packing_session_id)
  where packing_session_id is not null;

-- QR label cetak memakai payload yang sudah tersimpan di label_boxes,
-- bukan dirakit ulang di klien.
alter table public.print_jobs
  add column qr_payload_snapshot text
    check (qr_payload_snapshot is null or btrim(qr_payload_snapshot) <> '');

create index label_box_batches_closed_idx
  on public.label_box_batches (closed_at desc nulls first);
