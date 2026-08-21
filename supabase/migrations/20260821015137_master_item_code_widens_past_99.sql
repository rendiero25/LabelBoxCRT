-- Kode item melebar setelah mstritem-99, bukan dipotong jadi dua digit lagi.
--
-- Cacat yang sama persis dengan 20260821011700_box_code_widens_past_99.sql,
-- di pembangkit kode Master Item: `lpad(teks, 2, '0')` di Postgres MEMOTONG
-- ketika teksnya lebih panjang dari lebar yang diminta, jadi begitu
-- master_item_code_seq lewat 99, nilai 100..109 semuanya menjadi
-- 'mstritem-10' dan 110..119 menjadi 'mstritem-11'.
--
-- Di sini akibatnya lebih halus daripada di Box karena insert-nya sudah
-- dibungkus loop retry: yang terjadi bukan error, melainkan kode yang mundur
-- dan berulang. Kode item baru akan tampak lebih kecil daripada kode yang
-- sudah ada, dan setiap kali nomor yang dipotong itu masih dipakai baris yang
-- hidup, loop membakar sepuluh nilai sequence sebelum menemukan celah.
--
-- master_item_code_seq berada di 88 ketika migrasi ini ditulis, jadi cacatnya
-- belum pernah terpakai; tidak ada baris yang perlu diperbaiki.
--
-- Selain baris pembangkit kode, badan fungsi ini identik dengan versi di
-- 20260819180000_master_item_dynamic_row_no.sql.

create or replace function public.create_master_item(
  p_part_no text,
  p_part_name text,
  p_unit text,
  p_default_label_qty integer,
  p_item_code text default null,
  p_supplier_id uuid default null
)
returns table (
  id uuid,
  item_code text,
  part_no text,
  part_name text,
  unit text,
  default_label_qty integer,
  supplier_id uuid,
  is_active boolean,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  normalized_item_code text := nullif(lower(btrim(coalesce(p_item_code, ''))), '');
  normalized_part_no text := regexp_replace(upper(btrim(p_part_no)), '\s+', ' ', 'g');
  normalized_part_name text := btrim(p_part_name);
  normalized_unit text := initcap(lower(btrim(p_unit)));
  next_code_number text;
  candidate_code text;
  violated_constraint text;
begin
  if not private.is_active_admin() then
    raise exception using errcode = 'P0001', message = 'MASTER_ITEM_ADMIN_REQUIRED';
  end if;

  if (normalized_item_code is not null and normalized_item_code !~ '^[a-z0-9][a-z0-9_-]{1,63}$')
    or normalized_part_no !~ '^[A-Z0-9][A-Z0-9 _./-]{1,127}$'
    or normalized_part_name = ''
    or char_length(normalized_part_name) > 200
    or normalized_unit !~ '^[A-Za-z][A-Za-z ./-]{0,31}$'
    or p_default_label_qty is null or p_default_label_qty < 1 or p_default_label_qty > 1000000 then
    raise exception using errcode = 'P0001', message = 'MASTER_ITEM_INPUT_INVALID';
  end if;

  if p_supplier_id is not null and not exists (
    select 1 from public.suppliers supplier
    where supplier.id = p_supplier_id and supplier.is_active
  ) then
    raise exception using errcode = 'P0001', message = 'MASTER_ITEM_SUPPLIER_NOT_FOUND';
  end if;

  if normalized_item_code is null then
    loop
      next_code_number := nextval('public.master_item_code_seq')::text;

      -- greatest(2, length(...)) memberi lebar minimum dua digit tanpa pernah
      -- memotong: satu digit dipad jadi '05', tiga digit dibiarkan '100'.
      candidate_code := 'mstritem-' || lpad(
        next_code_number, greatest(2, length(next_code_number)), '0'
      );

      begin
        insert into public.master_items (item_code, part_no, part_name, unit, default_label_qty, supplier_id)
        values (candidate_code, normalized_part_no, normalized_part_name, normalized_unit, p_default_label_qty, p_supplier_id)
        returning
          public.master_items.id, public.master_items.item_code, public.master_items.part_no,
          public.master_items.part_name, public.master_items.unit, public.master_items.default_label_qty,
          public.master_items.supplier_id, public.master_items.is_active, public.master_items.created_at,
          public.master_items.updated_at
        into
          id, item_code, part_no, part_name, unit, default_label_qty, supplier_id,
          is_active, created_at, updated_at;
        exit;
      exception when unique_violation then
        get stacked diagnostics violated_constraint = constraint_name;
        if violated_constraint <> 'master_items_item_code_key' then
          raise exception using errcode = 'P0001', message = 'MASTER_ITEM_PART_NO_EXISTS';
        end if;
      end;
    end loop;
  else
    begin
      insert into public.master_items (item_code, part_no, part_name, unit, default_label_qty, supplier_id)
      values (normalized_item_code, normalized_part_no, normalized_part_name, normalized_unit, p_default_label_qty, p_supplier_id)
      returning
        public.master_items.id, public.master_items.item_code, public.master_items.part_no,
        public.master_items.part_name, public.master_items.unit, public.master_items.default_label_qty,
        public.master_items.supplier_id, public.master_items.is_active, public.master_items.created_at,
        public.master_items.updated_at
      into
        id, item_code, part_no, part_name, unit, default_label_qty, supplier_id,
        is_active, created_at, updated_at;
    exception when unique_violation then
      get stacked diagnostics violated_constraint = constraint_name;
      raise exception using errcode = 'P0001', message = case
        when violated_constraint = 'master_items_item_code_key' then 'MASTER_ITEM_CODE_EXISTS'
        else 'MASTER_ITEM_PART_NO_EXISTS'
      end;
    end;
  end if;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    auth.uid(), 'master_item.created', 'master_item', id::text,
    jsonb_build_object(
      'item_code', item_code,
      'part_no', part_no,
      'default_label_qty', default_label_qty,
      'supplier_id', supplier_id
    )
  );

  return next;
end;
$$;

notify pgrst, 'reload schema';
