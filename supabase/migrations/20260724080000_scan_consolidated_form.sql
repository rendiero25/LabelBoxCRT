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

-- Argument count changes, so create-or-replace cannot reconcile the old
-- 2-arg signature. Drop explicitly.
drop function public.start_packing_session(uuid, uuid);

create function public.start_packing_session(
  p_master_item_id uuid,
  p_box_id uuid,
  p_supplier_id uuid,
  p_delivery_date date,
  p_qty_delivery integer,
  p_lot_no text
)
returns table (
  session_id uuid,
  status public.packing_session_status,
  operator_id uuid,
  master_item_id uuid,
  box_id uuid,
  delivery_number_id uuid,
  delivery_number text,
  total_expected_qty integer,
  accepted_qty integer,
  started_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  target_item public.master_items%rowtype;
  target_box public.boxes%rowtype;
  target_dn public.delivery_numbers%rowtype;
  created_session public.packing_sessions%rowtype;
  normalized_lot_no text := btrim(coalesce(p_lot_no, ''));
  candidate_number text;
  expected_total integer;
begin
  if not private.is_active_operator() then
    raise exception using errcode = 'P0001', message = 'PACKING_SESSION_OPERATOR_REQUIRED';
  end if;

  select * into target_item
  from public.master_items item
  where item.id = p_master_item_id and item.is_active;

  if target_item.id is null then
    raise exception using errcode = 'P0001', message = 'MASTER_ITEM_NOT_ACTIVE';
  end if;

  select * into target_box
  from public.boxes box
  where box.id = p_box_id and box.master_item_id = p_master_item_id;

  if target_box.id is null then
    raise exception using errcode = 'P0001', message = 'BOX_NOT_FOUND_OR_MISMATCH';
  end if;

  if not exists (
    select 1 from public.suppliers supplier
    where supplier.id = p_supplier_id and supplier.is_active
  ) then
    raise exception using errcode = 'P0001', message = 'DELIVERY_NUMBER_SUPPLIER_INVALID';
  end if;

  -- A Master Item with a supplier may only be packed against that supplier.
  -- Legacy rows with a null supplier_id stay unrestricted.
  if target_item.supplier_id is not null
    and target_item.supplier_id <> p_supplier_id then
    raise exception using errcode = 'P0001', message = 'MASTER_ITEM_SUPPLIER_MISMATCH';
  end if;

  if p_delivery_date is null then
    raise exception using errcode = 'P0001', message = 'DELIVERY_DATE_INVALID';
  end if;

  if p_qty_delivery is null or p_qty_delivery < 1 or p_qty_delivery > 1000000 then
    raise exception using errcode = 'P0001', message = 'QTY_DELIVERY_INVALID';
  end if;

  if normalized_lot_no = '' or char_length(normalized_lot_no) > 100 then
    raise exception using errcode = 'P0001', message = 'LOT_NO_INVALID';
  end if;

  select coalesce(sum(requirement.expected_qty), 0)::integer into expected_total
  from public.box_layer_requirements requirement
  join public.box_layers layer on layer.id = requirement.box_layer_id
  where layer.box_id = p_box_id;

  if expected_total <= 0 then
    raise exception using errcode = 'P0001', message = 'BOX_EMPTY';
  end if;

  -- Reuse the active Delivery Number for this supplier and date when one
  -- already exists; otherwise mint one with a generated code.
  select * into target_dn
  from public.delivery_numbers dn
  where dn.supplier_id = p_supplier_id
    and dn.delivery_date = p_delivery_date
    and dn.status = 'active'
  order by dn.created_at
  limit 1;

  if target_dn.id is null then
    loop
      candidate_number := 'DN-' || lpad(nextval('public.delivery_number_seq')::text, 6, '0');

      begin
        insert into public.delivery_numbers (
          supplier_id, delivery_number, delivery_date, status, created_by
        ) values (
          p_supplier_id, candidate_number, p_delivery_date, 'active', auth.uid()
        )
        returning * into target_dn;
        exit;
      exception when unique_violation then
        -- Code collided with a manually entered DN; take the next value.
        null;
      end;
    end loop;

    insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
    values (
      auth.uid(), 'delivery_number.created', 'delivery_number', target_dn.id::text,
      jsonb_build_object(
        'supplier_id', target_dn.supplier_id,
        'delivery_number', target_dn.delivery_number,
        'delivery_date', target_dn.delivery_date,
        'status', target_dn.status,
        'source', 'packing_session_auto'
      )
    );
  end if;

  insert into public.packing_sessions (
    operator_id, master_item_id, box_id, delivery_number_id,
    qty_delivery, lot_no, status
  ) values (
    auth.uid(), p_master_item_id, p_box_id, target_dn.id,
    p_qty_delivery, normalized_lot_no, 'scanning'
  )
  returning * into created_session;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    auth.uid(), 'packing_session.started', 'packing_session', created_session.id::text,
    jsonb_build_object(
      'master_item_id', created_session.master_item_id,
      'box_id', created_session.box_id,
      'delivery_number_id', created_session.delivery_number_id,
      'qty_delivery', created_session.qty_delivery,
      'total_expected_qty', expected_total
    )
  );

  return query
  select
    created_session.id, created_session.status, created_session.operator_id,
    created_session.master_item_id, created_session.box_id,
    created_session.delivery_number_id, target_dn.delivery_number,
    expected_total, 0, created_session.started_at;
end;
$$;

revoke execute on function public.start_packing_session(uuid, uuid, uuid, date, integer, text)
  from public, anon;
grant execute on function public.start_packing_session(uuid, uuid, uuid, date, integer, text)
  to authenticated;
