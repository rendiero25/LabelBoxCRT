-- Scan page consolidation (spec
-- docs/superpowers/specs/2026-07-24-scan-page-consolidated-form-design.md).
--
-- 1. packing_sessions carries the two manual operator inputs (qty delivery,
--    lot no) captured when the session starts.
-- 2. print_jobs snapshots them at finalize alongside the timestamp stamped
--    into the label QR, matching the existing *_snapshot convention.
-- 3. delivery_numbers gains a code sequence so the scan flow can auto-create
--    a DN instead of asking the operator to type one.
--
-- Both new packing_sessions columns are nullable: sessions created before
-- this migration have no values, and backfilling them would invent data.

alter table public.packing_sessions
  add column qty_delivery integer check (qty_delivery is null or qty_delivery > 0),
  add column lot_no text check (lot_no is null or btrim(lot_no) <> '');

alter table public.print_jobs
  add column qty_delivery_snapshot integer
    check (qty_delivery_snapshot is null or qty_delivery_snapshot > 0),
  add column lot_no_snapshot text
    check (lot_no_snapshot is null or btrim(lot_no_snapshot) <> ''),
  add column qr_generated_at_snapshot timestamptz;

create sequence public.delivery_number_seq
  as bigint
  minvalue 1
  start with 1;

select setval(
  'public.delivery_number_seq',
  coalesce(
    (
      select max((regexp_match(delivery_number, '^DN-([0-9]+)$'))[1]::bigint)
      from public.delivery_numbers
    ),
    0
  ) + 1,
  false
);

revoke all on sequence public.delivery_number_seq from public, anon, authenticated;
