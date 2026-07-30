-- Alur packing session lama digantikan alur batch label box
-- (docs/superpowers/specs/2026-07-29-label-box-verification-and-print-design.md).
-- accept_packing_scan tetap: accept_label_box_scan mendelegasikan kepadanya.

drop function if exists public.start_packing_session(uuid, uuid, uuid, date, integer, text);
drop function if exists public.finalize_packing_session(uuid);

notify pgrst, 'reload schema';
