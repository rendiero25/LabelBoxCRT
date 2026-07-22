# Master Item Code Auto-Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the admin Master Item form's "Kode item" auto-generated (`mstritem-01`, `mstritem-02`, ...) and non-editable in both create and edit, while CSV import keeps supplying `item_code` manually exactly as it does today.

**Architecture:** One migration adds a dedicated Postgres sequence and reshapes `create_master_item` (item code becomes an optional trailing parameter — `null` triggers auto-generation via the sequence, a provided value is validated and used as-is for CSV import) and `update_master_item` (the parameter is removed entirely — item_code can never be changed through that RPC again). `import_csv_master_data` is recreated with a named-argument call to keep supplying its own `item_code`. The admin form drops the "Kode item" input; TypeScript validation/actions drop the field.

**Tech Stack:** Next.js 16 App Router, React 19 Server Actions, TypeScript strict, Supabase PostgreSQL/RPC (hosted dev project, CLI via `npx.cmd supabase`), pgTAP, Vitest, shadcn/ui.

---

### Task 1: Migration — item code sequence + RPC signature changes

**Files:**
- Create: `supabase/migrations/20260722120000_master_item_code_autogen.sql`

Spec: `docs/superpowers/specs/2026-07-22-master-item-code-autogen-design.md`.

Background verified in the codebase before writing this task:
- `create_master_item`/`update_master_item` currently live in `supabase/migrations/20260715045645_master_item_admin_crud_audit.sql` with signatures `(text, text, text, text, integer, text)` and `(uuid, text, text, text, text, integer, text)` respectively (`p_item_code` is the 1st/2nd positional arg).
- Postgres requires that once a parameter has a `default`, every parameter after it must also have a default. `p_item_code` cannot stay first with a default while `p_part_no` etc. stay required — it must move to be the **last** parameter. This reorders the type tuple, so it is a genuinely different overload; `create or replace` will not replace the old function in place — the old one must be `drop function`-ed first (same technique already used for `create_product` in `supabase/migrations/20260716063311_product_auto_code.sql` and for the packing RPCs in `supabase/migrations/20260721093000_remove_workstation_from_master_item_box_rpcs.sql`).
- The only other caller of `create_master_item` is `import_csv_master_data` in `supabase/migrations/20260720044317_csv_import_master_data.sql:333`, which passes 6 positional args including `item_code` first. It must switch to named-argument syntax so it keeps landing values in the right parameters after the reorder. The Next.js server actions already call `.rpc()` with a named JS object, so they are unaffected by parameter order (only by which keys are sent).
- Unique constraint names on `master_items` (from `supabase/migrations/20260714065242_phase_2_schema.sql:119-122`): `master_items_item_code_key` (on `lower(btrim(item_code))`) and `master_items_part_no_key` (on `upper(btrim(part_no))`).

- [ ] **Step 1: Write the migration SQL**

```sql
-- Master Item "Kode item" auto-generation (spec
-- docs/superpowers/specs/2026-07-22-master-item-code-autogen-design.md).
-- The admin form no longer collects item_code: create_master_item generates
-- it from a dedicated sequence when the caller omits it. CSV import keeps
-- supplying item_code explicitly (unchanged behavior), so the parameter
-- stays but moves to the end and becomes optional. update_master_item loses
-- the parameter entirely -- item_code can never be changed after creation.

create sequence public.master_item_code_seq
  as bigint
  minvalue 1
  start with 1;

select setval(
  'public.master_item_code_seq',
  coalesce(
    (
      select max((regexp_match(item_code, '^mstritem-([0-9]+)$'))[1]::bigint)
      from public.master_items
    ),
    0
  ) + 1,
  false
);

revoke all on sequence public.master_item_code_seq from public, anon, authenticated;

drop function public.create_master_item(text, text, text, text, integer, text);

create function public.create_master_item(
  p_part_no text,
  p_part_name text,
  p_unit text,
  p_default_label_qty integer,
  p_item_sequence_code text default null,
  p_item_code text default null
)
returns table (
  id uuid,
  item_code text,
  part_no text,
  part_name text,
  unit text,
  default_label_qty integer,
  item_sequence_code text,
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
  normalized_part_no text := upper(btrim(p_part_no));
  normalized_part_name text := btrim(p_part_name);
  normalized_unit text := initcap(lower(btrim(p_unit)));
  normalized_sequence_code text := upper(btrim(coalesce(p_item_sequence_code, '')));
  candidate_code text;
  violated_constraint text;
begin
  if not private.is_active_admin() then
    raise exception using errcode = 'P0001', message = 'MASTER_ITEM_ADMIN_REQUIRED';
  end if;

  if (normalized_item_code is not null and normalized_item_code !~ '^[a-z0-9][a-z0-9_-]{1,63}$')
    or normalized_part_no !~ '^[A-Z0-9][A-Z0-9_./-]{1,127}$'
    or normalized_part_name = ''
    or char_length(normalized_part_name) > 200
    or normalized_unit !~ '^[A-Za-z][A-Za-z ./-]{0,31}$'
    or p_default_label_qty is null or p_default_label_qty < 1 or p_default_label_qty > 1000000
    or (normalized_sequence_code <> '' and normalized_sequence_code !~ '^[A-Z0-9][A-Z0-9_-]{1,63}$') then
    raise exception using errcode = 'P0001', message = 'MASTER_ITEM_INPUT_INVALID';
  end if;

  if normalized_item_code is null then
    loop
      candidate_code := 'mstritem-' || lpad(nextval('public.master_item_code_seq')::text, 2, '0');

      begin
        insert into public.master_items (
          item_code, part_no, part_name, unit, default_label_qty, item_sequence_code
        ) values (
          candidate_code, normalized_part_no, normalized_part_name, normalized_unit,
          p_default_label_qty, nullif(normalized_sequence_code, '')
        ) returning * into id, item_code, part_no, part_name, unit, default_label_qty,
          item_sequence_code, is_active, created_at, updated_at;
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
      insert into public.master_items (
        item_code, part_no, part_name, unit, default_label_qty, item_sequence_code
      ) values (
        normalized_item_code, normalized_part_no, normalized_part_name, normalized_unit,
        p_default_label_qty, nullif(normalized_sequence_code, '')
      ) returning * into id, item_code, part_no, part_name, unit, default_label_qty,
        item_sequence_code, is_active, created_at, updated_at;
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
      'item_sequence_code', item_sequence_code
    )
  );

  return next;
end;
$$;

drop function public.update_master_item(uuid, text, text, text, text, integer, text);

create function public.update_master_item(
  p_master_item_id uuid,
  p_part_no text,
  p_part_name text,
  p_unit text,
  p_default_label_qty integer,
  p_item_sequence_code text default null
)
returns table (
  id uuid,
  item_code text,
  part_no text,
  part_name text,
  unit text,
  default_label_qty integer,
  item_sequence_code text,
  is_active boolean,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  normalized_part_no text := upper(btrim(p_part_no));
  normalized_part_name text := btrim(p_part_name);
  normalized_unit text := initcap(lower(btrim(p_unit)));
  normalized_sequence_code text := upper(btrim(coalesce(p_item_sequence_code, '')));
begin
  if not private.is_active_admin() then
    raise exception using errcode = 'P0001', message = 'MASTER_ITEM_ADMIN_REQUIRED';
  end if;

  if normalized_part_no !~ '^[A-Z0-9][A-Z0-9_./-]{1,127}$'
    or normalized_part_name = ''
    or char_length(normalized_part_name) > 200
    or normalized_unit !~ '^[A-Za-z][A-Za-z ./-]{0,31}$'
    or p_default_label_qty is null or p_default_label_qty < 1 or p_default_label_qty > 1000000
    or (normalized_sequence_code <> '' and normalized_sequence_code !~ '^[A-Z0-9][A-Z0-9_-]{1,63}$') then
    raise exception using errcode = 'P0001', message = 'MASTER_ITEM_INPUT_INVALID';
  end if;

  if exists (
    select 1 from public.packing_sessions
    where master_item_id = p_master_item_id
  ) then
    raise exception using errcode = 'P0001', message = 'MASTER_ITEM_IN_USE';
  end if;

  begin
    update public.master_items
    set part_no = normalized_part_no,
        part_name = normalized_part_name,
        unit = normalized_unit,
        default_label_qty = p_default_label_qty,
        item_sequence_code = nullif(normalized_sequence_code, '')
    where public.master_items.id = p_master_item_id
    returning * into id, item_code, part_no, part_name, unit, default_label_qty,
      item_sequence_code, is_active, created_at, updated_at;
  exception when unique_violation then
    raise exception using errcode = 'P0001', message = 'MASTER_ITEM_PART_NO_EXISTS';
  end;

  if not found then
    raise exception using errcode = 'P0001', message = 'MASTER_ITEM_NOT_FOUND';
  end if;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    auth.uid(), 'master_item.updated', 'master_item', id::text,
    jsonb_build_object(
      'item_code', item_code,
      'part_no', part_no,
      'default_label_qty', default_label_qty,
      'item_sequence_code', item_sequence_code
    )
  );

  return next;
end;
$$;

revoke execute on function public.create_master_item(text, text, text, integer, text, text) from public, anon;
revoke execute on function public.update_master_item(uuid, text, text, text, integer, text) from public, anon;

grant execute on function public.create_master_item(text, text, text, integer, text, text) to authenticated;
grant execute on function public.update_master_item(uuid, text, text, text, integer, text) to authenticated;

create or replace function public.import_csv_master_data(
  p_template text,
  p_rows jsonb,
  p_correlation_id uuid
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  normalized_template text := lower(btrim(p_template));
  preview_row record;
  row_data jsonb;
  supplier_id uuid;
  master_item_id uuid;
  product_id uuid;
  imported_count integer := 0;
begin
  if not private.is_active_admin() then
    raise exception using errcode = 'P0001', message = 'CSV_IMPORT_ADMIN_REQUIRED';
  end if;

  if p_correlation_id is null then
    raise exception using errcode = 'P0001', message = 'CSV_IMPORT_INPUT_INVALID';
  end if;

  for preview_row in
    select * from public.preview_csv_import(normalized_template, p_rows)
  loop
    if cardinality(preview_row.errors) > 0 then
      raise exception using errcode = 'P0001', message = 'CSV_IMPORT_PREVIEW_INVALID';
    end if;
  end loop;

  for row_data in select value from jsonb_array_elements(p_rows)
  loop
    if normalized_template = 'supplier' then
      perform public.create_supplier(
        private.csv_import_value(row_data, 'supplier_code'),
        private.csv_import_value(row_data, 'supplier_name')
      );
    elsif normalized_template = 'product' then
      perform public.create_product(
        private.csv_import_value(row_data, 'part_name'),
        private.csv_import_value(row_data, 'outer_diameter')::numeric,
        private.csv_import_value(row_data, 'inner_diameter')::numeric,
        private.csv_import_value(row_data, 'length')::numeric
      );
    elsif normalized_template = 'master_item' then
      perform public.create_master_item(
        p_part_no => private.csv_import_value(row_data, 'part_no'),
        p_part_name => private.csv_import_value(row_data, 'part_name'),
        p_unit => private.csv_import_value(row_data, 'unit'),
        p_default_label_qty => private.csv_import_value(row_data, 'default_label_qty')::integer,
        p_item_sequence_code => nullif(private.csv_import_value(row_data, 'item_sequence_code'), ''),
        p_item_code => private.csv_import_value(row_data, 'item_code')
      );
    elsif normalized_template = 'product_mapping' then
      select id into master_item_id
      from public.master_items
      where lower(btrim(item_code)) = lower(private.csv_import_value(row_data, 'item_code'))
        and is_active;

      select id into product_id
      from public.products
      where lower(btrim(product_code)) = lower(private.csv_import_value(row_data, 'product_code'))
        and is_active;

      perform public.create_master_item_product_mapping(master_item_id, product_id);
    else
      select id into supplier_id
      from public.suppliers
      where lower(btrim(supplier_code)) = lower(private.csv_import_value(row_data, 'supplier_code'))
        and is_active;

      perform public.create_delivery_number(
        supplier_id,
        private.csv_import_value(row_data, 'delivery_number'),
        private.csv_import_value(row_data, 'delivery_date')::date,
        private.csv_import_value(row_data, 'status')::public.delivery_status
      );
    end if;

    imported_count := imported_count + 1;
  end loop;

  insert into public.audit_logs (
    actor_id,
    action,
    entity_type,
    entity_id,
    metadata,
    correlation_id
  ) values (
    auth.uid(),
    'csv_import.completed',
    'csv_import',
    normalized_template,
    jsonb_build_object('template', normalized_template, 'row_count', imported_count),
    p_correlation_id
  );

  return imported_count;
end;
$$;
```

- [ ] **Step 2: Inspect current migration history before pushing**

```powershell
npx.cmd supabase migration list --linked
```

Expected: the latest entry is `20260722044128_phase_7_print_rpcs` (or later), confirming no conflicting migration already occupies the new timestamp.

- [ ] **Step 3: Apply the migration**

```powershell
npx.cmd supabase db push --linked --dry-run
npx.cmd supabase db push --linked --yes
```

Expected: dry-run shows exactly `20260722120000_master_item_code_autogen.sql` pending; the real push reports it applied with no errors.

- [ ] **Step 4: Run database advisors**

```powershell
npx.cmd supabase db advisors --linked
```

Expected: no new findings attributable to `create_master_item`, `update_master_item`, `import_csv_master_data`, or `master_item_code_seq` (both functions keep `search_path = pg_catalog`, `security definer`, explicit `revoke`/`grant`; the sequence has all privileges revoked from `public`/`anon`/`authenticated`).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260722120000_master_item_code_autogen.sql
git commit -m "feat: auto-generate master item codes, lock item_code on update"
```

---

### Task 2: pgTAP coverage — `017_master_item_code_autogen.test.sql`

**Files:**
- Create: `supabase/tests/database/017_master_item_code_autogen.test.sql`

- [ ] **Step 1: Write the test file**

```sql
-- Master item item_code auto-generation: create_master_item generates
-- mstritem-NN when p_item_code is omitted, still honors an explicit value
-- (the CSV import path), and update_master_item can no longer change
-- item_code at all. Spec:
-- docs/superpowers/specs/2026-07-22-master-item-code-autogen-design.md

begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;

select plan(11);

insert into auth.users (
  id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '9d100000-0000-0000-0000-000000000001',
  'authenticated',
  'authenticated',
  'master-item-code-admin@example.test',
  '{}'::jsonb,
  '{}'::jsonb,
  now(),
  now()
);

insert into public.profiles (id, display_name, role, is_active) values (
  '9d100000-0000-0000-0000-000000000001',
  'Master Item Code Admin',
  'admin',
  true
);

select set_config(
  'request.jwt.claim.sub',
  '9d100000-0000-0000-0000-000000000001',
  true
);
set local role authenticated;

select has_function(
  'public',
  'create_master_item',
  array['text', 'text', 'text', 'integer', 'text', 'text'],
  'create_master_item takes part_no, part_name, unit, qty, sequence code, and an optional item code'
);

select has_function(
  'public',
  'update_master_item',
  array['uuid', 'text', 'text', 'text', 'integer', 'text'],
  'update_master_item no longer accepts an item code'
);

select lives_ok(
  $$ select public.create_master_item('AUTOGEN-A', 'Autogen Part A', 'Pcs', 100) $$,
  'admin creates a master item without providing a code'
);

select matches(
  (select item_code from public.master_items where part_no = 'AUTOGEN-A'),
  '^mstritem-[0-9]{2,}$',
  'first automatic item code uses the required format'
);

select lives_ok(
  $$ select public.create_master_item('AUTOGEN-B', 'Autogen Part B', 'Pcs', 100) $$,
  'admin creates a second master item without providing a code'
);

select isnt(
  (select item_code from public.master_items where part_no = 'AUTOGEN-A'),
  (select item_code from public.master_items where part_no = 'AUTOGEN-B'),
  'automatic item codes are unique'
);

select lives_ok(
  $$ select public.create_master_item('AUTOGEN-C', 'Autogen Part C', 'Pcs', 100, null, 'manual-csv-code') $$,
  'admin (simulating CSV import) creates a master item with an explicit code'
);

select is(
  (select item_code from public.master_items where part_no = 'AUTOGEN-C'),
  'manual-csv-code',
  'an explicitly provided item code is used as-is'
);

select throws_ok(
  $$ select public.create_master_item('AUTOGEN-D', 'Autogen Part D', 'Pcs', 100, null, 'manual-csv-code') $$,
  'P0001', 'MASTER_ITEM_CODE_EXISTS', 'duplicate explicit item codes are still rejected'
);

create temporary table item_code_before_update as
select item_code from public.master_items where part_no = 'AUTOGEN-A';

select lives_ok(
  $$ select public.update_master_item(
    (select id from public.master_items where part_no = 'AUTOGEN-A'),
    'AUTOGEN-A',
    'Autogen Part A Updated',
    'Pcs',
    150
  ) $$,
  'admin updates a master item without an item code parameter'
);

select is(
  (select item_code from public.master_items where part_no = 'AUTOGEN-A'),
  (select item_code from item_code_before_update),
  'item_code is unchanged after update_master_item runs'
);

reset role;

select * from finish();

rollback;
```

- [ ] **Step 2: Run the new pgTAP file**

```powershell
npx.cmd supabase test db --file supabase/tests/database/017_master_item_code_autogen.test.sql
```

Expected: `11/11` assertions pass, output ends with `# Looks like you planned 11 tests and ran 11`.

- [ ] **Step 3: Run regression pgTAP files that touch `master_items`**

```powershell
npx.cmd supabase test db --file supabase/tests/database/001_phase_2_schema.test.sql
npx.cmd supabase test db --file supabase/tests/database/002_phase_2_rls.test.sql
npx.cmd supabase test db --file supabase/tests/database/003_phase_2_seed.test.sql
npx.cmd supabase test db --file supabase/tests/database/012_phase_4_7_csv_import.test.sql
npx.cmd supabase test db --file supabase/tests/database/013_master_item_box_layer_requirements.test.sql
```

Expected: all still fully green (these seed/insert `master_items` rows directly or exercise CSV import — none call `create_master_item`/`update_master_item` by RPC name except CSV import, which now uses named-argument syntax internally but the same external contract).

- [ ] **Step 4: Commit**

```bash
git add supabase/tests/database/017_master_item_code_autogen.test.sql
git commit -m "test: pgTAP coverage for master item code auto-generation"
```

---

### Task 3: Regenerate database types

**Files:**
- Modify: `src/types/database.ts`

- [ ] **Step 1: Regenerate**

```powershell
cmd.exe /d /s /c "npx.cmd supabase gen types typescript --linked --schema public > src\types\database.ts"
```

- [ ] **Step 2: Verify the new signatures landed**

```powershell
grep -n "create_master_item\|update_master_item\|master_item_code_seq" src/types/database.ts
```

Expected: `create_master_item`'s `Args` type has `p_part_no`, `p_part_name`, `p_unit`, `p_default_label_qty` as required and `p_item_sequence_code`, `p_item_code` as optional (`?:`); `update_master_item`'s `Args` type has no `p_item_code` key at all.

- [ ] **Step 3: Typecheck**

```powershell
npm run typecheck
```

Expected: FAILS at this point — `src/features/master-items/actions.ts` still passes `p_item_code` to both RPCs, which no longer matches the regenerated types. This confirms the type regeneration actually changed the surface (this is the expected red state before Task 5).

- [ ] **Step 4: Commit**

```bash
git add src/types/database.ts
git commit -m "chore: regenerate types for master item code auto-generation"
```

---

### Task 4: `parseMasterItemInput` drops `itemCode` — TDD

**Files:**
- Modify: `src/features/master-items/validation.ts`
- Test: `src/features/master-items/validation.test.ts`

- [ ] **Step 1: Update the test to the desired shape**

Replace the first test in `src/features/master-items/validation.test.ts` (the `describe("parseMasterItemInput", ...)` block):

```ts
import { describe, expect, it } from "vitest"

import {
  masterItemRpcErrorMessage,
  parseMasterItemInput,
} from "@/features/master-items/validation"

describe("parseMasterItemInput", () => {
  it("normalizes identifiers and preserves the default label quantity", () => {
    const formData = new FormData()
    formData.set("partNo", " 3210a-k1z-na01-dl ")
    formData.set("partName", " Tube Assy ")
    formData.set("unit", " pcs ")
    formData.set("defaultLabelQty", "100")
    formData.set("itemSequenceCode", " line-a ")

    expect(parseMasterItemInput(formData)).toEqual({
      data: {
        partNo: "3210A-K1Z-NA01-DL",
        partName: "Tube Assy",
        unit: "Pcs",
        defaultLabelQty: 100,
        itemSequenceCode: "LINE-A",
      },
    })
  })

  it("rejects a non-positive default label quantity", () => {
    const formData = new FormData()
    formData.set("partNo", "3210A-K1Z-NA01-DL")
    formData.set("partName", "Tube Assy")
    formData.set("unit", "Pcs")
    formData.set("defaultLabelQty", "0")

    expect(parseMasterItemInput(formData)).toEqual({
      error:
        "Default label Qty harus berupa bilangan bulat lebih besar dari 0.",
    })
  })
})

describe("masterItemRpcErrorMessage", () => {
  it("maps a duplicate part number to a safe message", () => {
    expect(masterItemRpcErrorMessage("MASTER_ITEM_PART_NO_EXISTS")).toBe(
      "Part No sudah digunakan.",
    )
  })
})
```

- [ ] **Step 2: Run the test, verify it fails**

```powershell
npm test -- src/features/master-items/validation.test.ts
```

Expected: FAIL — the current `parseMasterItemInput` still requires `itemCode` in the `FormData`, so with no `itemCode` field set it returns `{ error: "Kode item harus ..." }` instead of the expected `{ data: {...} }`.

- [ ] **Step 3: Update `parseMasterItemInput`**

Replace the full contents of `src/features/master-items/validation.ts`:

```ts
const partNoPattern = /^[A-Z0-9][A-Z0-9_./-]{1,127}$/
const unitPattern = /^[A-Za-z][A-Za-z ./-]{0,31}$/
const sequenceCodePattern = /^[A-Z0-9][A-Z0-9_-]{1,63}$/

type MasterItemInput = {
  partNo: string
  partName: string
  unit: string
  defaultLabelQty: number
  itemSequenceCode: string | null
}

function normalizeUnit(value: string): string {
  const normalized = value.trim().toLowerCase()
  return normalized
    ? `${normalized[0].toUpperCase()}${normalized.slice(1)}`
    : ""
}

export function parseMasterItemInput(
  formData: FormData,
): { data: MasterItemInput } | { error: string } {
  const partNo = String(formData.get("partNo") ?? "")
    .trim()
    .toUpperCase()
  const partName = String(formData.get("partName") ?? "").trim()
  const unit = normalizeUnit(String(formData.get("unit") ?? ""))
  const rawQuantity = String(formData.get("defaultLabelQty") ?? "").trim()
  const sequenceCode = String(formData.get("itemSequenceCode") ?? "")
    .trim()
    .toUpperCase()

  if (!partNoPattern.test(partNo)) {
    return {
      error:
        "Part No harus 2–128 karakter huruf besar, angka, titik, garis bawah, garis miring, atau tanda minus.",
    }
  }
  if (!partName) return { error: "Nama part wajib diisi." }
  if (partName.length > 200)
    return { error: "Nama part maksimal 200 karakter." }
  if (!unitPattern.test(unit)) return { error: "Unit tidak valid." }
  if (!/^[1-9]\d{0,5}$/.test(rawQuantity)) {
    return {
      error:
        "Default label Qty harus berupa bilangan bulat lebih besar dari 0.",
    }
  }
  if (sequenceCode && !sequenceCodePattern.test(sequenceCode)) {
    return {
      error:
        "Kode sequence harus 2–64 karakter A–Z, angka, garis bawah, atau tanda minus.",
    }
  }

  return {
    data: {
      partNo,
      partName,
      unit,
      defaultLabelQty: Number(rawQuantity),
      itemSequenceCode: sequenceCode || null,
    },
  }
}

export function masterItemRpcErrorMessage(message: string): string {
  const messages: Record<string, string> = {
    MASTER_ITEM_ADMIN_REQUIRED: "Aksi ini hanya tersedia untuk admin aktif.",
    MASTER_ITEM_CODE_EXISTS: "Kode item sudah digunakan.",
    MASTER_ITEM_IN_USE:
      "Master Item sudah memiliki session dan tidak dapat diubah.",
    MASTER_ITEM_INPUT_INVALID: "Data Master Item tidak valid.",
    MASTER_ITEM_NOT_FOUND: "Master Item tidak ditemukan.",
    MASTER_ITEM_PART_NO_EXISTS: "Part No sudah digunakan.",
  }

  return (
    messages[message] ?? "Aksi Master Item gagal. Coba lagi atau hubungi admin."
  )
}
```

- [ ] **Step 4: Run the test, verify it passes**

```powershell
npm test -- src/features/master-items/validation.test.ts
```

Expected: PASS, 3/3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/features/master-items/validation.ts src/features/master-items/validation.test.ts
git commit -m "feat: drop manual item code from master item form validation"
```

---

### Task 5: Server actions stop sending `p_item_code`

**Files:**
- Modify: `src/features/master-items/actions.ts:26-75`

- [ ] **Step 1: Update `createMasterItemAction` and `updateMasterItemAction`**

In `src/features/master-items/actions.ts`, replace the RPC call inside `createMasterItemAction`:

```ts
  const supabase = await createClient()
  const { error } = await supabase.rpc("create_master_item", {
    p_part_no: parsed.data.partNo,
    p_part_name: parsed.data.partName,
    p_unit: parsed.data.unit,
    p_default_label_qty: parsed.data.defaultLabelQty,
    p_item_sequence_code: parsed.data.itemSequenceCode ?? undefined,
  })
```

And the RPC call inside `updateMasterItemAction`:

```ts
  const supabase = await createClient()
  const { error } = await supabase.rpc("update_master_item", {
    p_master_item_id: masterItemId,
    p_part_no: parsed.data.partNo,
    p_part_name: parsed.data.partName,
    p_unit: parsed.data.unit,
    p_default_label_qty: parsed.data.defaultLabelQty,
    p_item_sequence_code: parsed.data.itemSequenceCode ?? undefined,
  })
```

Nothing else in the file changes (`masterItemIdFromFormData`, `setMasterItemActiveAction`, the box/layer actions below are untouched).

- [ ] **Step 2: Typecheck**

```powershell
npm run typecheck
```

Expected: PASS — this was the failure introduced in Task 3 Step 3; it's resolved now that `actions.ts` matches both the new `validation.ts` output shape and the regenerated RPC `Args` types.

- [ ] **Step 3: Commit**

```bash
git add src/features/master-items/actions.ts
git commit -m "feat: stop sending item_code from master item server actions"
```

---

### Task 6: Admin form — remove the editable "Kode item" field

**Files:**
- Modify: `src/features/master-items/components/master-item-directory.tsx:323-355`

- [ ] **Step 1: Replace the "Kode item" input**

In `src/features/master-items/components/master-item-directory.tsx`, inside `MasterItemForm`, replace this block:

```tsx
        <div className="grid gap-5 sm:grid-cols-2">
          <Field>
            <FieldLabel
              htmlFor={masterItem ? `itemCode-${masterItem.id}` : "itemCode"}
            >
              Kode item
            </FieldLabel>
            <Input
              defaultValue={masterItem?.item_code}
              id={masterItem ? `itemCode-${masterItem.id}` : "itemCode"}
              maxLength={64}
              name="itemCode"
              placeholder="dm-0001"
              required
            />
          </Field>
          <Field>
            <FieldLabel
              htmlFor={masterItem ? `partNo-${masterItem.id}` : "partNo"}
            >
              Part No
            </FieldLabel>
            <Input
              defaultValue={masterItem?.part_no}
              id={masterItem ? `partNo-${masterItem.id}` : "partNo"}
              maxLength={128}
              name="partNo"
              placeholder="3210A-K1Z-NA01-DL"
              required
            />
          </Field>
        </div>
```

with:

```tsx
        <div className="grid gap-5 sm:grid-cols-2">
          <Field>
            <FieldLabel
              htmlFor={masterItem ? `itemCode-${masterItem.id}` : "itemCode"}
            >
              Kode item
            </FieldLabel>
            <Input
              disabled
              id={masterItem ? `itemCode-${masterItem.id}` : "itemCode"}
              value={masterItem?.item_code ?? "Dibuat otomatis setelah disimpan"}
            />
            <FieldDescription>
              Kode item dibuat otomatis oleh sistem dan tidak bisa diubah.
            </FieldDescription>
          </Field>
          <Field>
            <FieldLabel
              htmlFor={masterItem ? `partNo-${masterItem.id}` : "partNo"}
            >
              Part No
            </FieldLabel>
            <Input
              defaultValue={masterItem?.part_no}
              id={masterItem ? `partNo-${masterItem.id}` : "partNo"}
              maxLength={128}
              name="partNo"
              placeholder="3210A-K1Z-NA01-DL"
              required
            />
          </Field>
        </div>
```

The disabled `Input` has no `name` attribute, so it is never part of the submitted `FormData` in either create or edit mode — the browser excludes disabled controls from form submission regardless. `FieldDescription` is already imported at the top of the file (used elsewhere in this same form), so no import changes are needed.

- [ ] **Step 2: Typecheck and lint**

```powershell
npm run typecheck
npm run lint
```

Expected: both PASS.

- [ ] **Step 3: Manual UAT in the browser**

```powershell
npm run dev
```

Then, logged in as an admin, open `/admin/master-items`:
1. Click "Master Item baru" — confirm the "Kode item" field shows a disabled input reading "Dibuat otomatis setelah disimpan" with no way to type into it, fill in the rest, submit, and confirm the created row shows a real `mstritem-NN` code.
2. Click "Edit" on that same row — confirm "Kode item" shows the actual code, disabled, and cannot be edited; change Part Name and save; confirm the item_code is unchanged after saving.
3. Note any visual issue (e.g. disabled input styling, spacing) and fix inline before moving on.

- [ ] **Step 4: Commit**

```bash
git add src/features/master-items/components/master-item-directory.tsx
git commit -m "feat: make master item Kode item read-only in the admin form"
```

---

### Task 7: Documentation — update the `master_items` field reference

**Files:**
- Modify: `flowsystem.md:148-161`

- [ ] **Step 1: Update the `item_code` row**

In `flowsystem.md`, section `4.5 master_items`, replace this line:

```markdown
| `item_code`          | text         | unique, contoh `dm-0001` |
```

with:

```markdown
| `item_code`          | text         | unique; admin form: auto-generated `mstritem-01`, `mstritem-02`, ... via `create_master_item`, read-only after creation; CSV import: still supplied manually per row |
```

- [ ] **Step 2: Commit**

```bash
git add flowsystem.md
git commit -m "docs: note master item code auto-generation in the data model reference"
```

---

### Task 8: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full local check suite**

```powershell
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build
```

Expected: all PASS. If `npm run build` fails only on the known Google Font network fetch (documented in `docs/development/supabase.md`), treat that as a pre-existing environment limitation, not a regression from this change.

- [ ] **Step 2: Run the full pgTAP suite against the hosted dev project**

```powershell
npx.cmd supabase test db
```

Expected: every file in `supabase/tests/database/` passes, including the new `017_master_item_code_autogen.test.sql`.

- [ ] **Step 3: Re-run advisors**

```powershell
npx.cmd supabase db advisors --linked
```

Expected: no new findings versus the pre-existing baseline noted in `docs/development/supabase.md`.

- [ ] **Step 4: Update `task.md` if it tracks a Master Item admin checklist item**

Search for any Master Item "Kode item" checklist line in `task.md` and check it off or add a note that item_code is now auto-generated, matching how other completed phases in this file are annotated. If no such line exists, skip this step — do not invent a new checklist section.

---

## Self-review notes

- Spec coverage: "Database (migrasi baru)" → Task 1; "Server actions" → Tasks 4-5; "UI" → Task 6; "Error handling" (no new codes, `MASTER_ITEM_CODE_EXISTS` retained) → Task 1's RPC body and Task 4's unchanged `masterItemRpcErrorMessage`; "Testing" → Tasks 2, 4, 8; the spec's non-goals (CSV import untouched externally, no backfill, `item_sequence_code` unaffected) are honored — `import_csv_master_data`'s CSV-facing contract, `preview_csv_import`, and `seed.sql` are not modified.
- The spec's original wording ("create or replace… no drop function needed" for `create_master_item`) is corrected in this plan: giving the *first* parameter a default forces every later parameter to have one too, which Postgres rejects unless `p_item_code` moves to last position — a genuine signature change that does require `drop function` first, same as `update_master_item`. This was discovered by re-reading the current RPC signatures and Postgres's default-parameter ordering rule before writing Task 1; the externally observable behavior (auto-generate on omission, manual value honored when provided, CSV import untouched) matches the approved spec exactly — only the internal parameter order changed, and only one caller (`import_csv_master_data`) needed a corresponding update, which Task 1 includes.
- Type consistency check: `MasterItemInput` (Task 4) has no `itemCode` field; `actions.ts` (Task 5) never reads `parsed.data.itemCode`; the UI (Task 6) never sends a `name="itemCode"` field; the RPC (Task 1) matches all of that. `master_item_code_seq`, `create_master_item`, `update_master_item`, and `MASTER_ITEM_CODE_EXISTS`/`MASTER_ITEM_PART_NO_EXISTS` are spelled identically across Tasks 1, 2, and 4.
- No placeholders: every SQL/TS block above is complete, runnable code, not a description of code.
