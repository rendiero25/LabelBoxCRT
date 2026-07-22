# Phase 7 — QZ Tray + Zebra ZD220 Print Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-print finalized box labels to Zebra ZD220 via QZ Tray, with claim/complete RPCs, ZPL v1 template, self-signed cert signing endpoints, and retry-safe browser print worker.

**Architecture:** Client builds ZPL from the finalize snapshot (`src/lib/label/zpl.ts`), persists it via `claim_print_job` SECURITY DEFINER RPC (status → `printing`), sends raw ZPL through `qz-tray` websocket, then records the outcome via `complete_print_job` (attempt row + status `confirmed`/`failed`). QZ message signing runs server-side (`/api/qz/sign`) with `QZ_PRIVATE_KEY`; public cert served at `/api/qz/cert`. No printer server mapping — operator picks printer, stored in `localStorage`.

**Tech Stack:** Next.js App Router, Supabase (hosted dev project, migration via supabase MCP `apply_migration`), pgTAP, vitest, `qz-tray` npm package, Node `crypto`.

**Spec:** `docs/superpowers/specs/2026-07-22-phase-7-qz-print-design.md`

**Hardware constants:** printer `ZDesigner ZD220-203dpi ZPL`, 203 dpi, 55 mm width × 75 mm length, 3 mm gap, thermal transfer (`^MTT`). Dots: `^PW440`, `^LL600`.

**Enum reality check (differs from spec wording):** `packing_session_status` has no `completed` value. Transitions used here: claim → session `printing`; complete sent → session `confirmed`; complete failed → session `print_failed`; re-claim allowed from job status `failed` (session `print_failed`).

---

### Task 1: ZPL builder (`src/lib/label/zpl.ts`) — TDD

**Files:**
- Create: `src/lib/label/zpl.test.ts`
- Create: `src/lib/label/zpl.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/label/zpl.test.ts
import { describe, expect, it } from "vitest"

import type { FormattedLabelFields } from "@/lib/label/formatter"
import {
  LABEL_LENGTH_DOTS,
  LABEL_WIDTH_DOTS,
  TEMPLATE_VERSION,
  buildLabelZpl,
  escapeZplText,
} from "@/lib/label/zpl"

const sampleFields: FormattedLabelFields = {
  supplierCode: "10015",
  partNo: "3210A-K1Z-NA01-DL",
  qty: "100",
  itemBoxReference: "1-150526-B101",
  deliveryNumber: "DN-2026-0001",
  boxName: "Box Utama",
  deliveryDate: "15-May-2026",
}

describe("escapeZplText", () => {
  it("hex-escapes underscore first, then caret and tilde", () => {
    expect(escapeZplText("A_B^C~D")).toBe("A_5fB_5eC_7eD")
  })

  it("strips ASCII control characters", () => {
    expect(escapeZplText("A\nB\tC\x00D")).toBe("ABCD")
  })

  it("passes plain text through unchanged", () => {
    expect(escapeZplText("3210A-K1Z-NA01-DL")).toBe("3210A-K1Z-NA01-DL")
  })
})

describe("buildLabelZpl", () => {
  const zpl = buildLabelZpl(sampleFields)

  it("exports template version v1 and 203dpi 55x75mm dot dimensions", () => {
    expect(TEMPLATE_VERSION).toBe("v1")
    expect(LABEL_WIDTH_DOTS).toBe(440)
    expect(LABEL_LENGTH_DOTS).toBe(600)
  })

  it("wraps output in ^XA/^XZ with media header for thermal transfer + gap", () => {
    expect(zpl.startsWith("^XA")).toBe(true)
    expect(zpl.endsWith("^XZ")).toBe(true)
    expect(zpl).toContain("^CI28")
    expect(zpl).toContain("^MTT")
    expect(zpl).toContain("^PW440")
    expect(zpl).toContain("^LL600")
    expect(zpl).toContain("^MNY")
  })

  it("renders all seven field values", () => {
    for (const value of Object.values(sampleFields)) {
      expect(zpl).toContain(value)
    }
  })

  it("escapes ZPL control characters in dynamic values", () => {
    const zplEscaped = buildLabelZpl({
      ...sampleFields,
      boxName: "BOX^1~X_2",
    })
    expect(zplEscaped).toContain("BOX_5e1_7eX_5f2")
    expect(zplEscaped).not.toContain("BOX^1")
  })

  it("truncates overlong values instead of overflowing the label", () => {
    const zplLong = buildLabelZpl({
      ...sampleFields,
      boxName: "X".repeat(80),
    })
    expect(zplLong).not.toContain("X".repeat(29))
    expect(zplLong).toContain("X".repeat(25) + "...")
  })

  it("matches the golden sample layout", () => {
    expect(zpl).toMatchSnapshot()
  })
})
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `npm test -- src/lib/label/zpl.test.ts`
Expected: FAIL — cannot resolve `@/lib/label/zpl`.

- [ ] **Step 3: Implement `src/lib/label/zpl.ts`**

```ts
import type { FormattedLabelFields } from "@/lib/label/formatter"

/**
 * ZPL template v1 for Zebra ZD220 (203 dpi), media 55 mm x 75 mm with 3 mm
 * gap, thermal-transfer wax ribbon. Layout locked by
 * docs/superpowers/specs/2026-07-22-phase-7-qz-print-design.md — no barcode
 * in v1.
 */
export const TEMPLATE_VERSION = "v1"

const DOTS_PER_MM = 8
export const LABEL_WIDTH_DOTS = 55 * DOTS_PER_MM // 440
export const LABEL_LENGTH_DOTS = 75 * DOTS_PER_MM // 600

const MARGIN_DOTS = 16
const ROW_HEIGHT_DOTS = 80
const FIRST_ROW_Y = 24
const LABEL_FONT = "^A0N,20,20"
const VALUE_FONT = "^A0N,28,28"
const VALUE_FONT_LARGE = "^A0N,34,34"
const MAX_CHARS = 28
const MAX_CHARS_LARGE = 22
const ELLIPSIS = "..."

/**
 * ^FH hex-escape (underscore prefix). Underscore itself must be replaced
 * first so escape sequences are not double-escaped.
 */
export function escapeZplText(value: string): string {
  return value
    .replaceAll("_", "_5f")
    .replaceAll("^", "_5e")
    .replaceAll("~", "_7e")
    .replace(/[\x00-\x1f\x7f]/g, "")
}

function truncate(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value
  return value.slice(0, maxChars - ELLIPSIS.length) + ELLIPSIS
}

type LabelRow = {
  label: string
  value: string
  large?: boolean
}

export function buildLabelZpl(fields: FormattedLabelFields): string {
  const rows: LabelRow[] = [
    { label: "Supplier Code", value: fields.supplierCode },
    { label: "Part No", value: fields.partNo, large: true },
    { label: "Qty", value: fields.qty },
    { label: "No Urut Item", value: fields.itemBoxReference, large: true },
    { label: "Delivery Number", value: fields.deliveryNumber },
    { label: "Nama Box", value: fields.boxName },
    { label: "Tanggal Delivery", value: fields.deliveryDate },
  ]

  const commands = ["^XA", "^CI28", "^MTT", "^PW440", "^LL600", "^MNY", "^LH0,0"]

  rows.forEach((row, index) => {
    const y = FIRST_ROW_Y + index * ROW_HEIGHT_DOTS
    const font = row.large ? VALUE_FONT_LARGE : VALUE_FONT
    const maxChars = row.large ? MAX_CHARS_LARGE : MAX_CHARS
    const value = escapeZplText(truncate(row.value, maxChars))
    commands.push(
      `^FO${MARGIN_DOTS},${y}${LABEL_FONT}^FD${row.label}^FS`,
      `^FO${MARGIN_DOTS},${y + 26}${font}^FH^FD${value}^FS`,
    )
  })

  commands.push("^XZ")
  return commands.join("\n")
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `npm test -- src/lib/label/zpl.test.ts`
Expected: PASS (snapshot written on first run).

- [ ] **Step 5: Commit**

```bash
git add src/lib/label/zpl.ts src/lib/label/zpl.test.ts
git commit -m "feat: ZPL v1 label builder for ZD220 55x75mm"
```

---

### Task 2: Migration — `claim_print_job` + `complete_print_job` RPCs

**Files:**
- Create: `supabase/migrations/<timestamp>_phase_7_print_rpcs.sql` (timestamp from `date +%Y%m%d%H%M%S` UTC)
- Apply via supabase MCP `apply_migration` (name `phase_7_print_rpcs`) against the hosted dev project, same as previous phases.

- [ ] **Step 1: Write migration SQL**

```sql
-- Phase 7: print job claim/complete RPCs (spec
-- docs/superpowers/specs/2026-07-22-phase-7-qz-print-design.md).
-- All print_jobs/print_attempts mutation stays RPC-only; no INSERT/UPDATE
-- RLS policies are added.

create or replace function public.claim_print_job(
  p_print_job_id uuid,
  p_zpl_payload text
)
returns table (
  print_job_id uuid,
  packing_session_id uuid,
  job_status public.print_job_status,
  session_status public.packing_session_status,
  attempt_count integer,
  label_reference text
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  target_job public.print_jobs%rowtype;
  target_session public.packing_sessions%rowtype;
  resulting_session_status public.packing_session_status;
begin
  if not (select private.is_active_operator()) and not (select private.is_active_admin()) then
    raise exception using errcode = 'P0001', message = 'PRINT_JOB_FORBIDDEN';
  end if;

  if p_zpl_payload is null
     or length(p_zpl_payload) = 0
     or length(p_zpl_payload) > 16384
     or p_zpl_payload not like '^XA%'
     or p_zpl_payload not like '%^XZ' then
    raise exception using errcode = 'P0001', message = 'PRINT_PAYLOAD_INVALID';
  end if;

  select * into target_job
  from public.print_jobs job
  where job.id = p_print_job_id
  for update;

  if target_job.id is null then
    raise exception using errcode = 'P0001', message = 'PRINT_JOB_NOT_FOUND';
  end if;

  select * into target_session
  from public.packing_sessions session
  where session.id = target_job.packing_session_id
  for update;

  if target_session.operator_id <> auth.uid() and not (select private.is_active_admin()) then
    raise exception using errcode = 'P0001', message = 'PRINT_JOB_FORBIDDEN';
  end if;

  -- Claimable: fresh (pending), retry (failed), or stale self re-claim
  -- (printing older than 2 minutes — tab died mid-print).
  if not (
    target_job.status in ('pending', 'failed')
    or (
      target_job.status = 'printing'
      and target_job.updated_at < statement_timestamp() - interval '2 minutes'
    )
  ) then
    raise exception using errcode = 'P0001', message = 'PRINT_JOB_NOT_CLAIMABLE';
  end if;

  update public.print_jobs job
  set status = 'printing', zpl_payload = p_zpl_payload
  where job.id = target_job.id
  returning * into target_job;

  update public.packing_sessions session
  set status = 'printing'
  where session.id = target_session.id
    and session.status in ('print_pending', 'print_failed', 'printing')
  returning session.status into resulting_session_status;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    auth.uid(), 'print_job.claimed', 'print_job', target_job.id::text,
    jsonb_build_object(
      'packing_session_id', target_session.id,
      'attempt_count', target_job.attempt_count,
      'zpl_length', length(p_zpl_payload)
    )
  );

  return query select
    target_job.id, target_session.id, target_job.status,
    coalesce(resulting_session_status, target_session.status),
    target_job.attempt_count, target_job.label_reference;
end;
$$;

create or replace function public.complete_print_job(
  p_print_job_id uuid,
  p_result public.print_attempt_result,
  p_printer_name text,
  p_error_code text default null,
  p_error_message_safe text default null
)
returns table (
  print_job_id uuid,
  packing_session_id uuid,
  job_status public.print_job_status,
  session_status public.packing_session_status,
  attempt_no integer,
  label_reference text
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  target_job public.print_jobs%rowtype;
  target_session public.packing_sessions%rowtype;
  new_attempt_no integer;
  resulting_session_status public.packing_session_status;
begin
  if not (select private.is_active_operator()) and not (select private.is_active_admin()) then
    raise exception using errcode = 'P0001', message = 'PRINT_JOB_FORBIDDEN';
  end if;

  if p_printer_name is null or length(trim(p_printer_name)) = 0 then
    raise exception using errcode = 'P0001', message = 'PRINTER_NAME_REQUIRED';
  end if;

  select * into target_job
  from public.print_jobs job
  where job.id = p_print_job_id
  for update;

  if target_job.id is null then
    raise exception using errcode = 'P0001', message = 'PRINT_JOB_NOT_FOUND';
  end if;

  select * into target_session
  from public.packing_sessions session
  where session.id = target_job.packing_session_id
  for update;

  if target_session.operator_id <> auth.uid() and not (select private.is_active_admin()) then
    raise exception using errcode = 'P0001', message = 'PRINT_JOB_FORBIDDEN';
  end if;

  if target_job.status <> 'printing' then
    raise exception using errcode = 'P0001', message = 'PRINT_JOB_NOT_PRINTING';
  end if;

  new_attempt_no := target_job.attempt_count + 1;

  insert into public.print_attempts (
    print_job_id, attempt_no, printer_name, result, error_code, error_message_safe
  ) values (
    target_job.id, new_attempt_no, trim(p_printer_name), p_result,
    case when p_result = 'failed' then p_error_code end,
    case when p_result = 'failed' then p_error_message_safe end
  );

  if p_result = 'sent' then
    update public.print_jobs job
    set status = 'confirmed',
        attempt_count = new_attempt_no,
        sent_at = statement_timestamp(),
        confirmed_at = statement_timestamp()
    where job.id = target_job.id
    returning * into target_job;

    update public.packing_sessions session
    set status = 'confirmed'
    where session.id = target_session.id
    returning session.status into resulting_session_status;
  else
    update public.print_jobs job
    set status = 'failed', attempt_count = new_attempt_no
    where job.id = target_job.id
    returning * into target_job;

    update public.packing_sessions session
    set status = 'print_failed'
    where session.id = target_session.id
    returning session.status into resulting_session_status;
  end if;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    auth.uid(),
    case when p_result = 'sent' then 'print_attempt.sent' else 'print_attempt.failed' end,
    'print_job', target_job.id::text,
    jsonb_strip_nulls(jsonb_build_object(
      'packing_session_id', target_session.id,
      'attempt_no', new_attempt_no,
      'printer_name', trim(p_printer_name),
      'error_code', p_error_code
    ))
  );

  return query select
    target_job.id, target_session.id, target_job.status,
    resulting_session_status, new_attempt_no, target_job.label_reference;
end;
$$;

revoke execute on function public.claim_print_job(uuid, text) from public, anon;
revoke execute on function public.complete_print_job(uuid, public.print_attempt_result, text, text, text) from public, anon;
grant execute on function public.claim_print_job(uuid, text) to authenticated;
grant execute on function public.complete_print_job(uuid, public.print_attempt_result, text, text, text) to authenticated;
```

Note: `updated_at` on both tables is maintained by the existing `private.set_updated_at()` trigger — do not set it manually.

- [ ] **Step 2: Apply migration**

Use supabase MCP `apply_migration` with name `phase_7_print_rpcs` and the SQL above. Save identical content to `supabase/migrations/<timestamp>_phase_7_print_rpcs.sql`.
Expected: success, no error.

- [ ] **Step 3: Run database advisors**

Use supabase MCP `get_advisors` (type `security`). Expected: no new findings against the two functions (search_path pinned, security definer accepted pattern).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/*_phase_7_print_rpcs.sql
git commit -m "feat: claim_print_job and complete_print_job RPCs"
```

---

### Task 3: pgTAP tests `016_phase_7_print_rpcs.test.sql`

**Files:**
- Create: `supabase/tests/database/016_phase_7_print_rpcs.test.sql`

Seed strategy: insert the session + print job directly as superuser (state `print_pending`/`pending`) — unit under test is the two new RPCs only, so we do not replay the whole scan flow.

- [ ] **Step 1: Write test file**

```sql
-- Phase 7 print RPCs: claim/complete authorization, state machine, attempt
-- audit, retry, and stale re-claim. Spec:
-- docs/superpowers/specs/2026-07-22-phase-7-qz-print-design.md

begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;

select plan(20);

insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
  ('a7100000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'phase7-operator@example.test', '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('a7100000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'phase7-other@example.test', '{}'::jsonb, '{}'::jsonb, now(), now());

insert into public.profiles (id, display_name, role, is_active) values
  ('a7100000-0000-0000-0000-000000000001', 'Phase 7 Operator', 'operator', true),
  ('a7100000-0000-0000-0000-000000000002', 'Phase 7 Other', 'operator', true);

insert into public.master_items (id, item_code, part_no, part_name, unit, default_label_qty, is_active)
values ('a7200000-0000-0000-0000-000000000001', 'phase7-item', 'PHASE7-PART', 'Phase 7 Part', 'Pcs', 100, true);

insert into public.boxes (id, box_code, box_name, is_active)
values ('a7400000-0000-0000-0000-000000000001', 'B701', 'Phase 7 Box', true);

insert into public.master_item_boxes (id, master_item_id, box_id, version, is_active)
values ('a7450000-0000-0000-0000-000000000001', 'a7200000-0000-0000-0000-000000000001', 'a7400000-0000-0000-0000-000000000001', 1, true);

insert into public.packing_sessions (id, operator_id, master_item_id, master_item_box_id, status)
values ('a7600000-0000-0000-0000-000000000001', 'a7100000-0000-0000-0000-000000000001',
        'a7200000-0000-0000-0000-000000000001', 'a7450000-0000-0000-0000-000000000001', 'print_pending');

insert into public.print_jobs (
  id, packing_session_id, status, supplier_code_snapshot, supplier_name_snapshot,
  part_no_snapshot, part_name_snapshot, qty_snapshot, delivery_number_snapshot,
  delivery_date_snapshot, box_code_snapshot, box_name_snapshot, sequence_no,
  label_reference, template_version, zpl_payload, created_by
) values (
  'a7700000-0000-0000-0000-000000000001', 'a7600000-0000-0000-0000-000000000001', 'pending',
  '10015', 'Phase 7 Supplier', 'PHASE7-PART', 'Phase 7 Part', 100, 'DN-P7-001',
  date '2026-05-15', 'B701', 'Phase 7 Box', 9001, '9001-150526-B701', 'v1',
  'PENDING_ZPL_GENERATION', 'a7100000-0000-0000-0000-000000000001'
);

-- Wrong operator cannot claim.
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a7100000-0000-0000-0000-000000000002', true);
select throws_ok(
  $$ select public.claim_print_job('a7700000-0000-0000-0000-000000000001', '^XA^FDx^FS^XZ') $$,
  'P0001', 'PRINT_JOB_FORBIDDEN', 'non-owner operator cannot claim'
);

-- Owner claims successfully.
select set_config('request.jwt.claim.sub', 'a7100000-0000-0000-0000-000000000001', true);

select throws_ok(
  $$ select public.claim_print_job('a7700000-0000-0000-0000-000000000001', 'NOPE') $$,
  'P0001', 'PRINT_PAYLOAD_INVALID', 'payload must be ^XA..^XZ'
);
select throws_ok(
  $$ select public.claim_print_job('a7700000-0000-0000-0000-000000000001', '^XA' || repeat('X', 17000) || '^XZ') $$,
  'P0001', 'PRINT_PAYLOAD_INVALID', 'payload over 16KB rejected'
);
select throws_ok(
  $$ select public.claim_print_job('00000000-0000-0000-0000-00000000dead', '^XA^FDx^FS^XZ') $$,
  'P0001', 'PRINT_JOB_NOT_FOUND', 'unknown job id rejected'
);

create temporary table phase7_claim as
select * from public.claim_print_job('a7700000-0000-0000-0000-000000000001', '^XA^FDreal^FS^XZ');

select is((select job_status from phase7_claim), 'printing'::public.print_job_status, 'claim sets job printing');
select is((select session_status from phase7_claim), 'printing'::public.packing_session_status, 'claim sets session printing');

reset role;
select is(
  (select zpl_payload from public.print_jobs where id = 'a7700000-0000-0000-0000-000000000001'),
  '^XA^FDreal^FS^XZ', 'claim persists zpl payload'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a7100000-0000-0000-0000-000000000001', true);

-- Fresh double-claim blocked (job now printing, updated_at recent).
select throws_ok(
  $$ select public.claim_print_job('a7700000-0000-0000-0000-000000000001', '^XA^FDagain^FS^XZ') $$,
  'P0001', 'PRINT_JOB_NOT_CLAIMABLE', 'recent printing job cannot be re-claimed'
);

-- Complete failed path.
select throws_ok(
  $$ select public.complete_print_job('a7700000-0000-0000-0000-000000000001', 'sent', '') $$,
  'P0001', 'PRINTER_NAME_REQUIRED', 'printer name required'
);

create temporary table phase7_fail as
select * from public.complete_print_job(
  'a7700000-0000-0000-0000-000000000001', 'failed',
  'ZDesigner ZD220-203dpi ZPL', 'QZ_SEND_FAILED', 'Gagal mengirim ke printer.'
);

select is((select job_status from phase7_fail), 'failed'::public.print_job_status, 'failed result sets job failed');
select is((select session_status from phase7_fail), 'print_failed'::public.packing_session_status, 'failed result sets session print_failed');
select is((select attempt_no from phase7_fail), 1, 'first attempt recorded as attempt 1');

reset role;
select is(
  (select count(*)::integer from public.print_attempts where print_job_id = 'a7700000-0000-0000-0000-000000000001'),
  1, 'one attempt row inserted'
);
select is(
  (select error_code from public.print_attempts where print_job_id = 'a7700000-0000-0000-0000-000000000001' and attempt_no = 1),
  'QZ_SEND_FAILED', 'attempt stores error code'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a7100000-0000-0000-0000-000000000001', true);

-- Retry: re-claim from failed, then complete sent.
create temporary table phase7_reclaim as
select * from public.claim_print_job('a7700000-0000-0000-0000-000000000001', '^XA^FDretry^FS^XZ');
select is((select job_status from phase7_reclaim), 'printing'::public.print_job_status, 'failed job re-claimable');

select throws_ok(
  $$ select public.complete_print_job('00000000-0000-0000-0000-00000000dead', 'sent', 'p') $$,
  'P0001', 'PRINT_JOB_NOT_FOUND', 'complete unknown job rejected'
);

create temporary table phase7_sent as
select * from public.complete_print_job('a7700000-0000-0000-0000-000000000001', 'sent', 'ZDesigner ZD220-203dpi ZPL');

select is((select job_status from phase7_sent), 'confirmed'::public.print_job_status, 'sent result sets job confirmed');
select is((select session_status from phase7_sent), 'confirmed'::public.packing_session_status, 'sent result sets session confirmed');
select is((select attempt_no from phase7_sent), 2, 'retry increments attempt number');

-- Completed job no longer completable.
select throws_ok(
  $$ select public.complete_print_job('a7700000-0000-0000-0000-000000000001', 'sent', 'p') $$,
  'P0001', 'PRINT_JOB_NOT_PRINTING', 'confirmed job cannot be completed again'
);

reset role;
select is(
  (select confirmed_at is not null and sent_at is not null from public.print_jobs where id = 'a7700000-0000-0000-0000-000000000001'),
  true, 'sent/confirmed timestamps set'
);
select is(
  (select count(*)::integer from public.audit_logs
   where entity_type = 'print_job' and entity_id = 'a7700000-0000-0000-0000-000000000001'),
  4, 'audit rows for two claims and two attempts'
);

select * from finish();

rollback;
```

- [ ] **Step 2: Run pgTAP 016**

Execute the file content against the hosted dev project via supabase MCP `execute_sql` (whole file is one `begin...rollback` transaction, same as earlier phases).
Expected: 20/20 asserts pass, `# Looks like you planned 20 tests and ran 20`. If `print_jobs` insert requires columns not listed (schema drift), fix seed, not RPC.

- [ ] **Step 3: Run pgTAP regressions 014 + 015**

Same method with `supabase/tests/database/014_phase_5_packing_session_scan.test.sql` and `015_phase_6_finalize.test.sql`.
Expected: all green (40 + 42 asserts).

- [ ] **Step 4: Commit**

```bash
git add supabase/tests/database/016_phase_7_print_rpcs.test.sql
git commit -m "test: pgTAP coverage for print claim/complete RPCs"
```

---

### Task 4: Regenerate database types

**Files:**
- Modify: `src/types/database.ts`

- [ ] **Step 1: Regenerate**

Use supabase MCP `generate_typescript_types`, overwrite `src/types/database.ts` with the output.

- [ ] **Step 2: Verify functions present + typecheck**

Run: `grep -n "claim_print_job\|complete_print_job" src/types/database.ts` → both present.
Run: `npm run typecheck` → PASS.

- [ ] **Step 3: Commit**

```bash
git add src/types/database.ts
git commit -m "chore: regenerate types with print RPCs"
```

---

### Task 5: QZ signing endpoints + cert docs

**Files:**
- Create: `src/app/api/qz/cert/route.ts`
- Create: `src/app/api/qz/sign/route.ts`
- Modify: `.env.example`
- Create: `docs/phase-7/qz-certificate.md`

- [ ] **Step 1: Cert endpoint**

```ts
// src/app/api/qz/cert/route.ts
import { NextResponse } from "next/server"

export function GET() {
  const certificate = process.env.QZ_CERTIFICATE
  if (!certificate) {
    return NextResponse.json(
      { error: "Certificate not configured" },
      { status: 503 },
    )
  }

  return new NextResponse(certificate.replaceAll("\\n", "\n"), {
    headers: {
      "cache-control": "public, max-age=86400",
      "content-type": "text/plain; charset=utf-8",
    },
  })
}
```

- [ ] **Step 2: Sign endpoint**

```ts
// src/app/api/qz/sign/route.ts
import { createSign } from "node:crypto"

import { NextResponse, type NextRequest } from "next/server"

import { createClient } from "@/lib/supabase/server"

const MAX_PAYLOAD_BYTES = 4096
const RATE_LIMIT_WINDOW_MS = 60_000
const RATE_LIMIT_MAX_REQUESTS = 30

// In-memory sliding window per user. Single-instance internal tool; on
// serverless multi-instance deploys each instance rate-limits independently
// (accepted trade-off, spec §4).
const requestLog = new Map<string, number[]>()

function isRateLimited(userId: string): boolean {
  const now = Date.now()
  const recent = (requestLog.get(userId) ?? []).filter(
    (timestamp) => now - timestamp < RATE_LIMIT_WINDOW_MS,
  )
  if (recent.length >= RATE_LIMIT_MAX_REQUESTS) {
    requestLog.set(userId, recent)
    return true
  }
  recent.push(now)
  requestLog.set(userId, recent)
  return false
}

function allowedOrigins(): string[] {
  const origins = ["http://localhost:3000", "https://localhost:3000"]
  const appUrl = process.env.NEXT_PUBLIC_APP_URL
  if (appUrl) origins.push(appUrl.replace(/\/$/, ""))
  return origins
}

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin")
  if (!origin || !allowedOrigins().includes(origin)) {
    console.warn("qz-sign: rejected origin", origin)
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    console.warn("qz-sign: unauthenticated request")
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  if (isRateLimited(user.id)) {
    console.warn("qz-sign: rate limited", user.id)
    return NextResponse.json({ error: "Too many requests" }, { status: 429 })
  }

  const privateKey = process.env.QZ_PRIVATE_KEY
  if (!privateKey) {
    console.error("qz-sign: QZ_PRIVATE_KEY not configured")
    return NextResponse.json({ error: "Not configured" }, { status: 503 })
  }

  let payload: unknown
  try {
    payload = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 })
  }

  const message =
    payload && typeof payload === "object" && "request" in payload
      ? (payload as { request: unknown }).request
      : null
  if (typeof message !== "string" || message.length === 0) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 })
  }
  if (Buffer.byteLength(message, "utf8") > MAX_PAYLOAD_BYTES) {
    console.warn("qz-sign: payload too large", user.id)
    return NextResponse.json({ error: "Payload too large" }, { status: 413 })
  }

  const signer = createSign("RSA-SHA512")
  signer.update(message)
  const signature = signer.sign(privateKey.replaceAll("\\n", "\n"), "base64")

  return NextResponse.json({ signature })
}
```

- [ ] **Step 3: `.env.example`**

Append below `QZ_PRIVATE_KEY=`:

```
QZ_CERTIFICATE=
NEXT_PUBLIC_APP_URL=
```

- [ ] **Step 4: Write `docs/phase-7/qz-certificate.md`**

```markdown
# QZ Tray Self-Signed Certificate

One self-signed company root cert (RSA 2048, SHA-512, 10 years) is used for
both dev and production (spec D5). The private key never leaves the server.

## Generate (run once, on a trusted machine)

    openssl req -x509 -newkey rsa:2048 -sha512 -days 3650 -nodes \
      -keyout qz-private-key.pem -out qz-certificate.pem \
      -subj "/C=ID/O=LabelBoxCRT/CN=LabelBoxCRT QZ Signing"

## Install

1. `QZ_PRIVATE_KEY` env = full content of `qz-private-key.pem`
   (escape newlines as `\n` when the host needs single-line values).
2. `QZ_CERTIFICATE` env = full content of `qz-certificate.pem` (same rule).
3. Delete `qz-private-key.pem` from the generating machine after storing it
   in the secret manager. NEVER commit either PEM.
4. Per workstation (IT): import `qz-certificate.pem` into Windows
   `certmgr.msc` → Trusted Root Certification Authorities, then restart
   QZ Tray. Without this, QZ shows an untrusted-signature warning per print.

## Endpoints

- `GET /api/qz/cert` — serves the public certificate to the QZ client.
- `POST /api/qz/sign` — authenticated + origin-allowlisted + rate-limited
  SHA-512 signing. Never logs payloads or the key.
```

- [ ] **Step 5: Verify**

Run: `npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/qz .env.example docs/phase-7/qz-certificate.md
git commit -m "feat: QZ cert and signing endpoints with origin/rate guards"
```

---

### Task 6: Printer preference — TDD

**Files:**
- Create: `src/features/print/printer-preference.test.ts`
- Create: `src/features/print/printer-preference.ts`

- [ ] **Step 1: Failing tests**

```ts
// src/features/print/printer-preference.test.ts
import { afterEach, describe, expect, it } from "vitest"

import {
  PRINTER_STORAGE_KEY,
  clearPreferredPrinter,
  readPreferredPrinter,
  resolvePrinter,
  savePreferredPrinter,
} from "@/features/print/printer-preference"

afterEach(() => window.localStorage.clear())

describe("printer preference", () => {
  it("round-trips the printer name through localStorage", () => {
    savePreferredPrinter("ZDesigner ZD220-203dpi ZPL")
    expect(readPreferredPrinter()).toBe("ZDesigner ZD220-203dpi ZPL")
    expect(window.localStorage.getItem(PRINTER_STORAGE_KEY)).toBe(
      "ZDesigner ZD220-203dpi ZPL",
    )
    clearPreferredPrinter()
    expect(readPreferredPrinter()).toBeNull()
  })

  it("resolves only when the stored printer is still discovered", () => {
    expect(
      resolvePrinter("ZDesigner ZD220-203dpi ZPL", [
        "Microsoft Print to PDF",
        "ZDesigner ZD220-203dpi ZPL",
      ]),
    ).toBe("ZDesigner ZD220-203dpi ZPL")
  })

  it("returns null (never a fallback) when stored printer is missing", () => {
    expect(resolvePrinter("ZDesigner ZD220-203dpi ZPL", ["Other Printer"])).toBeNull()
    expect(resolvePrinter(null, ["Other Printer"])).toBeNull()
  })
})
```

- [ ] **Step 2: Run, verify fail** — `npm test -- src/features/print/printer-preference.test.ts` → FAIL (module missing). Note: vitest config must use `jsdom`/`happy-dom` environment for this file; if project default is node, add `// @vitest-environment jsdom` comment at top of the test.

- [ ] **Step 3: Implement**

```ts
// src/features/print/printer-preference.ts
export const PRINTER_STORAGE_KEY = "labelbox.printerName"

export function readPreferredPrinter(): string | null {
  if (typeof window === "undefined") return null
  return window.localStorage.getItem(PRINTER_STORAGE_KEY)
}

export function savePreferredPrinter(printerName: string): void {
  window.localStorage.setItem(PRINTER_STORAGE_KEY, printerName)
}

export function clearPreferredPrinter(): void {
  window.localStorage.removeItem(PRINTER_STORAGE_KEY)
}

/**
 * A stored printer is only usable when it is still present in the list QZ
 * discovered. Missing → null: the UI must force an explicit re-pick. Never
 * fall back to another printer (spec D6).
 */
export function resolvePrinter(
  stored: string | null,
  discovered: string[],
): string | null {
  if (!stored) return null
  return discovered.includes(stored) ? stored : null
}
```

- [ ] **Step 4: Run, verify pass** — same command → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/print/printer-preference.ts src/features/print/printer-preference.test.ts
git commit -m "feat: printer preference storage with no-fallback resolution"
```

---

### Task 7: QZ client wrapper + connection hook

**Files:**
- Modify: `package.json` (add dependency)
- Create: `src/features/print/qz-client.ts`
- Create: `src/features/print/use-qz-connection.ts`

- [ ] **Step 1: Install dependency**

Run: `npm install qz-tray@2.2.5 --save-exact`
Expected: lockfile updated. (2.2.5 = current stable; pin exact per repo convention.)

- [ ] **Step 2: QZ client wrapper**

```ts
// src/features/print/qz-client.ts
import qz from "qz-tray"

let securityConfigured = false

function configureSecurity(): void {
  if (securityConfigured) return
  securityConfigured = true

  qz.security.setCertificatePromise(
    () => fetch("/api/qz/cert").then((response) => {
      if (!response.ok) throw new Error("QZ certificate unavailable")
      return response.text()
    }),
  )

  qz.security.setSignatureAlgorithm("SHA512")
  qz.security.setSignaturePromise((toSign: string) => async () => {
    const response = await fetch("/api/qz/sign", {
      body: JSON.stringify({ request: toSign }),
      headers: { "content-type": "application/json" },
      method: "POST",
    })
    if (!response.ok) throw new Error("QZ signing failed")
    const { signature } = (await response.json()) as { signature: string }
    return signature
  })
}

export function isQzConnected(): boolean {
  return qz.websocket.isActive()
}

export async function connectQz(): Promise<void> {
  configureSecurity()
  if (qz.websocket.isActive()) return
  await qz.websocket.connect({ retries: 2, delay: 1 })
}

export async function disconnectQz(): Promise<void> {
  if (qz.websocket.isActive()) await qz.websocket.disconnect()
}

export async function listPrinters(): Promise<string[]> {
  const printers = await qz.printers.find()
  return Array.isArray(printers) ? printers : [printers]
}

export async function sendZpl(
  printerName: string,
  zplPayload: string,
): Promise<void> {
  const config = qz.configs.create(printerName)
  await qz.print(config, [
    { data: zplPayload, flavor: "plain", format: "command", type: "raw" },
  ])
}

export function onQzClosed(handler: () => void): void {
  qz.websocket.setClosedCallbacks(handler)
}
```

If `qz-tray` ships no TypeScript types, add `src/types/qz-tray.d.ts` with `declare module "qz-tray"` exporting a minimal typed surface for the members used above (websocket.isActive/connect/disconnect/setClosedCallbacks, security.setCertificatePromise/setSignaturePromise/setSignatureAlgorithm, printers.find, configs.create, print).

- [ ] **Step 3: Connection hook**

```ts
// src/features/print/use-qz-connection.ts
"use client"

import { useCallback, useEffect, useRef, useState } from "react"

import {
  connectQz,
  listPrinters,
  onQzClosed,
} from "@/features/print/qz-client"

export type QzConnectionStatus =
  | "connecting"
  | "connected"
  | "disconnected"
  | "error"

const RECONNECT_DELAYS_MS = [2000, 5000, 10000, 30000]

export function useQzConnection() {
  const [status, setStatus] = useState<QzConnectionStatus>("disconnected")
  const [printers, setPrinters] = useState<string[]>([])
  const reconnectAttempt = useRef(0)
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const refreshPrinters = useCallback(async () => {
    try {
      setPrinters(await listPrinters())
    } catch {
      setPrinters([])
    }
  }, [])

  const connect = useCallback(async () => {
    setStatus("connecting")
    try {
      await connectQz()
      reconnectAttempt.current = 0
      setStatus("connected")
      await refreshPrinters()
    } catch {
      setStatus("error")
      const delay =
        RECONNECT_DELAYS_MS[
          Math.min(reconnectAttempt.current, RECONNECT_DELAYS_MS.length - 1)
        ]
      reconnectAttempt.current += 1
      reconnectTimer.current = setTimeout(() => void connect(), delay)
    }
  }, [refreshPrinters])

  useEffect(() => {
    onQzClosed(() => {
      setStatus("disconnected")
      setPrinters([])
      reconnectTimer.current = setTimeout(() => void connect(), 2000)
    })
    void connect()
    return () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current)
    }
  }, [connect])

  return { connect, printers, refreshPrinters, status }
}
```

- [ ] **Step 4: Verify** — `npm run typecheck && npm run lint` → PASS.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json src/features/print/qz-client.ts src/features/print/use-qz-connection.ts src/types/qz-tray.d.ts
git commit -m "feat: QZ Tray client wrapper and connection hook"
```

---

### Task 8: Print server actions + form-state

**Files:**
- Create: `src/features/print/form-state.ts`
- Create: `src/features/print/actions.ts`

- [ ] **Step 1: form-state**

```ts
// src/features/print/form-state.ts
export type PrintJobPhase =
  | "idle"
  | "claiming"
  | "sending"
  | "completing"
  | "confirmed"
  | "failed"

export type PrintActionResult = {
  error?: string
  errorCode?: string
  jobStatus?: string
  sessionStatus?: string
  attemptNo?: number
}
```

- [ ] **Step 2: actions**

```ts
// src/features/print/actions.ts
"use server"

import { revalidatePath } from "next/cache"

import type { PrintActionResult } from "@/features/print/form-state"
import { createClient } from "@/lib/supabase/server"

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const safeRpcMessages: Record<string, string> = {
  PRINT_JOB_FORBIDDEN: "Anda tidak berhak memproses print job ini.",
  PRINT_JOB_NOT_CLAIMABLE:
    "Print job sedang diproses di tempat lain atau sudah selesai.",
  PRINT_JOB_NOT_FOUND: "Print job tidak ditemukan.",
  PRINT_JOB_NOT_PRINTING: "Status print job tidak valid untuk penyelesaian.",
  PRINT_PAYLOAD_INVALID: "Payload label tidak valid.",
  PRINTER_NAME_REQUIRED: "Printer belum dipilih.",
}

function rpcErrorMessage(code: string): string {
  return safeRpcMessages[code] ?? "Aksi print gagal. Coba lagi atau hubungi admin."
}

export async function claimPrintJobAction(input: {
  printJobId: string
  zplPayload: string
}): Promise<PrintActionResult> {
  if (!uuidPattern.test(input.printJobId) || !input.zplPayload) {
    return { error: "Print job tidak valid." }
  }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc("claim_print_job", {
    p_print_job_id: input.printJobId,
    p_zpl_payload: input.zplPayload,
  })

  if (error || !data?.[0]) {
    const code = error?.message ?? ""
    return { error: rpcErrorMessage(code), errorCode: code }
  }

  return {
    jobStatus: data[0].job_status,
    sessionStatus: data[0].session_status,
  }
}

export async function completePrintJobAction(input: {
  printJobId: string
  result: "sent" | "failed"
  printerName: string
  errorCode?: string
  errorMessage?: string
}): Promise<PrintActionResult> {
  if (!uuidPattern.test(input.printJobId) || !input.printerName.trim()) {
    return { error: "Print job atau printer tidak valid." }
  }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc("complete_print_job", {
    p_error_code: input.errorCode,
    p_error_message_safe: input.errorMessage,
    p_print_job_id: input.printJobId,
    p_printer_name: input.printerName,
    p_result: input.result,
  })

  if (error || !data?.[0]) {
    const code = error?.message ?? ""
    return { error: rpcErrorMessage(code), errorCode: code }
  }

  revalidatePath("/scan")
  return {
    attemptNo: data[0].attempt_no,
    jobStatus: data[0].job_status,
    sessionStatus: data[0].session_status,
  }
}
```

- [ ] **Step 3: Verify** — `npm run typecheck && npm run lint` → PASS.

- [ ] **Step 4: Commit**

```bash
git add src/features/print/actions.ts src/features/print/form-state.ts
git commit -m "feat: print claim/complete server actions"
```

---

### Task 9: Print worker UI — status badge, printer picker, auto-print card

**Files:**
- Create: `src/features/print/components/printer-picker.tsx`
- Create: `src/features/print/components/print-job-card.tsx`
- Modify: `src/components/shared/app-status.tsx` (replace static badges)
- Modify: `src/components/shared/app-status.test.tsx` (update expectations)
- Modify: `src/components/operator/packing-scan-console.tsx` (integrate)

- [ ] **Step 1: Printer picker**

```tsx
// src/features/print/components/printer-picker.tsx
"use client"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

export function PrinterPicker({
  onSelect,
  printers,
  selected,
}: {
  onSelect: (printerName: string) => void
  printers: string[]
  selected: string | null
}) {
  return (
    <Select onValueChange={onSelect} value={selected ?? ""}>
      <SelectTrigger aria-label="Pilih printer" className="w-full">
        <SelectValue placeholder="Pilih printer" />
      </SelectTrigger>
      <SelectContent>
        {printers.length === 0 ? (
          <div className="text-muted-foreground px-2 py-1.5 text-sm">
            Tidak ada printer terdeteksi.
          </div>
        ) : (
          printers.map((printerName) => (
            <SelectItem key={printerName} value={printerName}>
              {printerName}
            </SelectItem>
          ))
        )}
      </SelectContent>
    </Select>
  )
}
```

- [ ] **Step 2: Print job card (auto-print worker)**

State machine drives spec §5 flow. `snapshot` is the `FinalizeSnapshot` from finalize success; auto-print fires once on mount when QZ connected + printer resolved.

```tsx
// src/features/print/components/print-job-card.tsx
"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { CircleAlertIcon, CircleCheckIcon, PrinterIcon } from "lucide-react"

import {
  claimPrintJobAction,
  completePrintJobAction,
} from "@/features/print/actions"
import { sendZpl } from "@/features/print/qz-client"
import {
  resolvePrinter,
  readPreferredPrinter,
  savePreferredPrinter,
} from "@/features/print/printer-preference"
import { useQzConnection } from "@/features/print/use-qz-connection"
import { PrinterPicker } from "@/features/print/components/printer-picker"
import type { FinalizeSnapshot } from "@/features/finalize/form-state"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { formatLabelFields } from "@/lib/label/formatter"
import { buildLabelZpl } from "@/lib/label/zpl"

type PrintPhase = "waiting" | "printing" | "confirmed" | "failed"

export function PrintJobCard({ snapshot }: { snapshot: FinalizeSnapshot }) {
  const { printers, status } = useQzConnection()
  const [selectedPrinter, setSelectedPrinter] = useState<string | null>(
    readPreferredPrinter,
  )
  const [phase, setPhase] = useState<PrintPhase>("waiting")
  const [message, setMessage] = useState<string | null>(null)
  const inFlight = useRef(false)
  const autoPrinted = useRef(false)

  const activePrinter = resolvePrinter(selectedPrinter, printers)

  const runPrint = useCallback(async () => {
    if (inFlight.current || !activePrinter) return
    inFlight.current = true
    setPhase("printing")
    setMessage(null)

    const zpl = buildLabelZpl(formatLabelFields(snapshot))
    const claim = await claimPrintJobAction({
      printJobId: snapshot.printJobId,
      zplPayload: zpl,
    })
    if (claim.error) {
      setPhase("failed")
      setMessage(claim.error)
      inFlight.current = false
      return
    }

    try {
      await sendZpl(activePrinter, zpl)
      const complete = await completePrintJobAction({
        printJobId: snapshot.printJobId,
        printerName: activePrinter,
        result: "sent",
      })
      if (complete.error) {
        setPhase("failed")
        setMessage(complete.error)
      } else {
        setPhase("confirmed")
        setMessage(`Label terkirim ke ${activePrinter}.`)
      }
    } catch {
      await completePrintJobAction({
        errorCode: "QZ_SEND_FAILED",
        errorMessage: "Gagal mengirim ke printer.",
        printJobId: snapshot.printJobId,
        printerName: activePrinter,
        result: "failed",
      })
      setPhase("failed")
      setMessage("Gagal mengirim ke printer. Coba lagi.")
    } finally {
      inFlight.current = false
    }
  }, [activePrinter, snapshot])

  useEffect(() => {
    if (
      autoPrinted.current ||
      phase !== "waiting" ||
      status !== "connected" ||
      !activePrinter
    ) {
      return
    }
    autoPrinted.current = true
    void runPrint()
  }, [activePrinter, phase, runPrint, status])

  if (phase === "confirmed") {
    return (
      <Alert>
        <CircleCheckIcon />
        <AlertTitle>Label tercetak</AlertTitle>
        <AlertDescription>{message}</AlertDescription>
      </Alert>
    )
  }

  return (
    <div className="grid gap-4 rounded-xl border p-5">
      <div className="flex items-center gap-2">
        <PrinterIcon className="size-5" />
        <h2 className="font-semibold">Print label</h2>
      </div>

      {status !== "connected" ? (
        <Alert variant="destructive">
          <CircleAlertIcon />
          <AlertTitle>QZ Tray tidak terhubung</AlertTitle>
          <AlertDescription>
            Pastikan aplikasi QZ Tray berjalan. Koneksi dicoba ulang otomatis.
          </AlertDescription>
        </Alert>
      ) : null}

      {status === "connected" && !activePrinter ? (
        <Alert variant="destructive">
          <CircleAlertIcon />
          <AlertTitle>Printer belum siap</AlertTitle>
          <AlertDescription>
            {selectedPrinter
              ? "Printer yang tersimpan tidak ditemukan. Pilih ulang printer."
              : "Pilih printer tujuan terlebih dahulu."}
          </AlertDescription>
        </Alert>
      ) : null}

      <PrinterPicker
        onSelect={(printerName) => {
          savePreferredPrinter(printerName)
          setSelectedPrinter(printerName)
        }}
        printers={printers}
        selected={selectedPrinter}
      />

      {phase === "failed" && message ? (
        <Alert variant="destructive">
          <CircleAlertIcon />
          <AlertTitle>Print gagal</AlertTitle>
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      ) : null}

      <Button
        disabled={phase === "printing" || status !== "connected" || !activePrinter}
        onClick={() => void runPrint()}
        type="button"
      >
        {phase === "printing" ? (
          <Spinner data-icon="inline-start" />
        ) : (
          <PrinterIcon data-icon="inline-start" />
        )}
        {phase === "failed" ? "Retry Print" : "Print label"}
      </Button>
    </div>
  )
}
```

- [ ] **Step 3: Integrate into scan console**

In `src/components/operator/packing-scan-console.tsx`, inside the `if (completedSnapshot)` block (currently renders the summary + "Mulai session baru" button), add the print card between the summary `<div>` and the button:

```tsx
<PrintJobCard snapshot={completedSnapshot} />
```

with import:

```tsx
import { PrintJobCard } from "@/features/print/components/print-job-card"
```

- [ ] **Step 4: Wire real status into `AppStatus`**

Replace `src/components/shared/app-status.tsx` content:

```tsx
"use client"

import { Badge } from "@/components/ui/badge"
import { readPreferredPrinter } from "@/features/print/printer-preference"
import { useQzConnection } from "@/features/print/use-qz-connection"

export function AppStatus() {
  const { status } = useQzConnection()
  const printer = readPreferredPrinter()

  return (
    <div aria-label="Status aplikasi" className="flex flex-wrap gap-2">
      <Badge variant="secondary">Aplikasi siap</Badge>
      <Badge variant={status === "connected" ? "secondary" : "outline"}>
        {status === "connected" ? "QZ terhubung" : "QZ belum terhubung"}
      </Badge>
      <Badge variant={printer ? "secondary" : "outline"}>
        {printer ? `Printer: ${printer}` : "Printer belum dipilih"}
      </Badge>
    </div>
  )
}
```

Update `src/components/shared/app-status.test.tsx` to mock `useQzConnection`/`readPreferredPrinter` (vitest `vi.mock`) and assert the connected/disconnected badge text renders.

- [ ] **Step 5: Verify**

Run: `npm run typecheck && npm run lint && npm test`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add src/features/print/components src/components/shared/app-status.tsx src/components/shared/app-status.test.tsx src/components/operator/packing-scan-console.tsx
git commit -m "feat: auto-print worker card, printer picker, live QZ status"
```

---

### Task 10: Full verification + browser QA + task.md update

- [ ] **Step 1: Full suite**

Run: `npm run typecheck && npm run lint && npm test && npm run build`
Expected: all PASS.

- [ ] **Step 2: Browser QA (dev server via launch.json/preview)**

- Load `/scan` as admin-viewable route or verify login page renders; confirm no console errors from QZ hook (it should retry gracefully when QZ absent).
- With QZ Tray running locally: verify "QZ terhubung" badge, printer list contains `ZDesigner ZD220-203dpi ZPL`.
- Screenshot proof.

- [ ] **Step 3: Update `task.md` Phase 7 checkboxes**

Check only items verified by code + tests. Leave unchecked (need physical printer runs by user): "Print 20 samples", "Verify readability", "Verify physical dimensions", all of 7.5 hardware failure drills, "Test production domain" (7.2).

- [ ] **Step 4: Commit**

```bash
git add task.md
git commit -m "docs: mark Phase 7 implemented items"
```

---

## Self-review notes

- Spec coverage: §1 → Tasks 2-3; §2 → Task 1; §3 → Tasks 6-7; §4 → Task 5; §5 → Task 9; §6 error taxonomy → Tasks 8-9; §7 testing → Tasks 1, 3, 6, 10. Stale re-claim covered in RPC (Task 2) — pgTAP stale-timing assert omitted (cannot time-travel `updated_at` under the update trigger inside one transaction); logic asserted via `PRINT_JOB_NOT_CLAIMABLE` on fresh printing job.
- Refresh-recovery (spec §5.7 resume card) intentionally minimal in v1: `completedSnapshot` lives in client state; after refresh, session list shows the session until `confirmed`. Full resume-card query deferred — noted for reviewer; add follow-up task if user wants it now.
- Physical hardware items stay unchecked per spec §6.
