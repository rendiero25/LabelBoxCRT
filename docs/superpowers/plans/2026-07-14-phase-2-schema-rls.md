# Phase 2 Schema and RLS Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a reproducible hosted-Supabase schema, constraints, seed graph, RLS policies, database tests, and generated TypeScript types for Phase 2.

**Architecture:** One ordered schema migration creates enums, relational tables, indexes, helper functions, grants, and RLS policies. pgTAP suites specify structure and authorization before migration implementation. An idempotent seed resolves pre-created Auth users by email and then builds the complete development sample graph.

**Tech Stack:** PostgreSQL 17, Supabase hosted project, Supabase CLI 2.109.1 through `npx.cmd`, pgTAP, Next.js 16.2.10, TypeScript 6 strict, npm.

## Global Constraints

- Use only an explicitly approved LabelBoxCRT development or Supabase branch project; never mutate the unrelated projects currently visible to the connector.
- Do not store database passwords, Auth passwords, service-role keys, access tokens, or project credentials in the repository.
- Roles are exactly `admin` and `operator`; admin owns future approval/reprint duties.
- Product measurement fields are positive `numeric` values named `outer_diameter`, `inner_diameter`, and `length`.
- Do not enforce `outer_diameter > inner_diameter` until real approved master data resolves the current sample ambiguity.
- Accepted non-null `label_uid` values are globally unique.
- Sequence scope remains data-driven through `sequence_counters.scope_key`; Phase 2 defines no numbering formula.
- Every exposed table has RLS enabled and forced, explicit grants, and row predicates.
- Direct browser mutation of operational, print, reprint-review, sequence, and audit records remains denied until later RPC phases.
- Every production behavior follows test-first red-green-refactor; hosted database access is required before crossing from failing pgTAP tests to migration implementation.

---

### Task 1: Establish the hosted development target and schema contract tests

**Files:**

- Create: `supabase/tests/database/001_phase_2_schema.test.sql`
- Modify: `docs/development/supabase.md`

**Interfaces:**

- Consumes: An explicitly approved Supabase project reference with PostgreSQL 17 and no conflicting LabelBoxCRT migrations.
- Produces: pgTAP assertions for all Phase 2 enums, relations, columns, constraints, and indexes.

- [ ] **Step 1: Confirm isolation and hosted target**

Run read-only Git detection and verify either a linked worktree or explicit permission to work on `development`. List Supabase projects, select only the user-approved LabelBoxCRT development target, then inspect its migrations and `public` tables before writing DDL.

Expected: the target project reference is confirmed in conversation, is not either unrelated GeekyTech project, and its schema state is known.

- [ ] **Step 2: Write the failing schema test**

Create a pgTAP transaction which installs no application objects, declares the exact assertion count, and asserts:

```sql
begin;

select no_plan();

select has_type('public', 'user_role');
select enum_has_labels('public', 'user_role', array['admin', 'operator']);
select has_type('public', 'delivery_status');
select has_type('public', 'packing_session_status');
select has_type('public', 'scan_result');
select has_type('public', 'print_job_status');
select has_type('public', 'print_attempt_result');
select has_type('public', 'reprint_status');

select has_table('public', 'profiles');
select has_table('public', 'suppliers');
select has_table('public', 'delivery_numbers');
select has_table('public', 'products');
select has_column('public', 'products', 'outer_diameter');
select has_column('public', 'products', 'inner_diameter');
select has_column('public', 'products', 'length');
select has_table('public', 'master_items');
select has_table('public', 'master_item_products');
select has_table('public', 'box_definitions');
select has_table('public', 'box_layers');
select has_table('public', 'box_layer_requirements');
select has_table('public', 'workstations');
select has_table('public', 'workstation_assignments');
select has_table('public', 'packing_sessions');
select has_table('public', 'packing_session_scans');
select has_table('public', 'sequence_counters');
select has_table('public', 'print_jobs');
select has_table('public', 'print_attempts');
select has_table('public', 'reprint_requests');
select has_table('public', 'audit_logs');

select col_type_is('public', 'products', 'outer_diameter', 'numeric');
select col_type_is('public', 'products', 'inner_diameter', 'numeric');
select col_type_is('public', 'products', 'length', 'numeric');
select col_not_null('public', 'products', 'outer_diameter');
select col_not_null('public', 'products', 'inner_diameter');
select col_not_null('public', 'products', 'length');
select has_pk('public', 'profiles');
select has_pk('public', 'suppliers');
select has_pk('public', 'products');
select has_pk('public', 'master_items');
select has_pk('public', 'box_definitions');
select has_pk('public', 'packing_sessions');
select has_pk('public', 'print_jobs');
select has_fk('public', 'profiles');
select has_fk('public', 'delivery_numbers');
select has_fk('public', 'master_item_products');
select has_fk('public', 'box_definitions');
select has_fk('public', 'box_layers');
select has_fk('public', 'box_layer_requirements');
select has_fk('public', 'packing_sessions');
select has_fk('public', 'packing_session_scans');
select has_fk('public', 'print_jobs');
select has_fk('public', 'print_attempts');
select has_fk('public', 'reprint_requests');
select has_index('public', 'packing_session_scans', 'packing_session_scans_accepted_label_uid_idx');
select has_index('public', 'print_jobs', 'print_jobs_one_initial_per_session_idx');
select has_index('public', 'reprint_requests', 'reprint_requests_one_open_per_source_idx');

select * from finish();
rollback;
```

The checked-in test expands this pattern across every required column, default,
check, foreign key, unique constraint, and partial index from the design.

- [ ] **Step 3: Run the schema test and verify RED**

Run the current CLI command discovered through:

```powershell
npx.cmd supabase test db --help
npx.cmd supabase test db supabase/tests/database/001_phase_2_schema.test.sql --linked
```

Expected: FAIL because `public.user_role` and Phase 2 tables do not exist. A connection/authentication error is not an acceptable RED result.

- [ ] **Step 4: Document hosted-only workflow**

Update `docs/development/supabase.md` with linked development-project commands, explicitly prohibit reset of a hosted project, and require a Supabase branch or disposable development target.

- [ ] **Step 5: Commit the red contract**

```powershell
git add supabase/tests/database/001_phase_2_schema.test.sql docs/development/supabase.md
git commit -m "test: define phase 2 database contract"
```

### Task 2: Implement relational schema and integrity constraints

**Files:**

- Create via CLI: migration named `phase_2_schema`
- Test: `supabase/tests/database/001_phase_2_schema.test.sql`

**Interfaces:**

- Consumes: The failing pgTAP schema contract from Task 1.
- Produces: All Phase 2 enum and table types, foreign keys, checks, unique indexes, and timestamp maintenance.

- [ ] **Step 1: Create the migration with the pinned CLI**

```powershell
npx.cmd supabase migration new phase_2_schema
```

Record the exact CLI-generated path and use only that file; do not invent or rename its timestamp.

- [ ] **Step 2: Implement enums and reusable primitives**

Add the eight enums from the design, create the non-exposed `private` schema,
revoke schema access from browser roles, and add a fixed-search-path timestamp trigger:

```sql
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create type public.user_role as enum ('admin', 'operator');
create type public.delivery_status as enum ('draft', 'active', 'closed', 'cancelled');
create type public.packing_session_status as enum (
  'draft', 'scanning', 'ready_to_finalize', 'finalizing', 'print_pending',
  'printing', 'sent_to_printer', 'confirmed', 'print_failed', 'cancelled', 'expired'
);
create type public.scan_result as enum ('accepted', 'invalid', 'duplicate', 'over_qty');
create type public.print_job_status as enum ('pending', 'printing', 'sent', 'confirmed', 'failed', 'cancelled');
create type public.print_attempt_result as enum ('sent', 'failed');
create type public.reprint_status as enum ('requested', 'approved', 'rejected', 'executed');

create function private.set_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  new.updated_at = statement_timestamp();
  return new;
end;
$$;
```

- [ ] **Step 3: Implement master and box tables**

Create `profiles`, `suppliers`, `delivery_numbers`, `products`, `master_items`,
`master_item_products`, `box_definitions`, `box_layers`, and
`box_layer_requirements`. Use UUID defaults, restrictive foreign keys, non-empty
trim checks, positive numeric/integer checks, case-insensitive unique indexes,
and the approved compound uniqueness rules. Create a stored generated
`normalized_dimensions` value from the three numeric measurement fields and a
non-unique lookup index on it.

Add `updated_at` triggers to mutable master tables. Add a partial unique index:

```sql
create unique index box_definitions_one_active_version_idx
  on public.box_definitions (master_item_id, lower(box_code))
  where is_active;
```

- [ ] **Step 4: Implement operational and print tables**

Create `workstations`, `workstation_assignments`, `packing_sessions`,
`packing_session_scans`, `sequence_counters`, `print_jobs`, `print_attempts`,
`reprint_requests`, and `audit_logs` with the fields and constraints in the
design.

Required partial indexes include:

```sql
create unique index packing_session_scans_accepted_label_uid_idx
  on public.packing_session_scans (label_uid)
  where result = 'accepted' and label_uid is not null;

create unique index print_jobs_one_initial_per_session_idx
  on public.print_jobs (packing_session_id)
  where parent_print_job_id is null;

create unique index reprint_requests_one_open_per_source_idx
  on public.reprint_requests (source_print_job_id)
  where status in ('requested', 'approved');
```

The scan table check requires accepted rows to contain label UID, product, and
layer. Print attempt uniqueness is `(print_job_id, attempt_no)`. Add indexes to
every foreign key and every column used by an RLS ownership predicate.

- [ ] **Step 5: Apply the migration to the approved development target**

Use the linked CLI migration command discovered through `--help`, or the
Supabase migration connector if that is the authenticated approved path.

Expected: the migration appears once in hosted migration history.

- [ ] **Step 6: Run the schema test and verify GREEN**

Run the exact test command from Task 1.

Expected: all schema assertions pass with zero failures.

- [ ] **Step 7: Commit schema implementation**

```powershell
git add supabase/migrations supabase/tests/database/001_phase_2_schema.test.sql
git commit -m "feat: add phase 2 relational schema"
```

### Task 3: Specify and implement RLS, box activation, and function privileges

**Files:**

- Create: `supabase/tests/database/002_phase_2_rls.test.sql`
- Modify: CLI-generated `phase_2_schema` migration

**Interfaces:**

- Consumes: Phase 2 tables and Auth-backed `profiles`.
- Produces: Private authorization helpers, explicit table grants, RLS policies, and admin-only box activation.

- [ ] **Step 1: Write RLS tests before policies**

Create pgTAP tests which insert deterministic Auth users inside a transaction,
set request claims with `set_config`, switch between `anon` and `authenticated`,
and assert:

```sql
select throws_ok(
  $$ select * from public.suppliers $$,
  '42501',
  null,
  'anonymous cannot read suppliers'
);

select lives_ok(
  $$ select * from public.suppliers $$,
  'operator can read active suppliers'
);

select is_empty(
  $$ select id from public.packing_sessions where operator_id <> auth.uid() $$,
  'operator cannot read another operator session'
);

select throws_ok(
  $$ insert into public.suppliers (supplier_code, supplier_name) values ('X', 'X') $$,
  '42501',
  null,
  'operator cannot create suppliers'
);
```

Cover anon, inactive operator, active operator, unassigned workstation,
cross-operator/cross-workstation rows, admin master writes, admin reads, direct
operational mutations, update `USING` plus `WITH CHECK`, audit immutability, and
function execute ACLs. Use explicit assertion counts and transaction rollback.

- [ ] **Step 2: Run RLS tests and verify RED**

```powershell
npx.cmd supabase test db supabase/tests/database/002_phase_2_rls.test.sql --linked
```

Expected: FAIL because policies and helpers are absent. Connection or fixture
errors must be corrected until policy assertions fail for the intended reason.

- [ ] **Step 3: Implement private authorization helpers**

Add stable, fixed-search-path helpers which query `public.profiles` and
`public.workstation_assignments`: `private.is_active_admin()`,
`private.is_active_operator()`, and `private.is_assigned_to_workstation(uuid)`.
Revoke all default execution, then grant only what policies require. Helpers do
not use `raw_user_meta_data`.

- [ ] **Step 4: Enable and force RLS with explicit grants**

Enable and force RLS, then revoke inherited browser privileges for the complete
Phase 2 table set:

```sql
do $$
declare
  relation_name text;
begin
  foreach relation_name in array array[
    'profiles', 'suppliers', 'delivery_numbers', 'products', 'master_items',
    'master_item_products', 'box_definitions', 'box_layers',
    'box_layer_requirements', 'workstations', 'workstation_assignments',
    'packing_sessions', 'packing_session_scans', 'sequence_counters',
    'print_jobs', 'print_attempts', 'reprint_requests', 'audit_logs'
  ]
  loop
    execute format('alter table public.%I enable row level security', relation_name);
    execute format('alter table public.%I force row level security', relation_name);
    execute format('revoke all on table public.%I from anon, authenticated', relation_name);
  end loop;
end;
$$;
```

Grant `SELECT` to `authenticated` only where a select policy exists. Grant
admin master-table `INSERT`, `UPDATE`, and `DELETE` only where matching admin
policies exist. Every update policy contains both `USING` and `WITH CHECK`.
Operational mutation tables receive no direct browser write grants.

- [ ] **Step 5: Implement role and ownership policies**

Implement the exact matrix from the design. Operator select predicates require
an active operator profile plus either active master data or ownership and an
active workstation assignment. Admin policies call
`(select private.is_active_admin())`. Own-profile access compares
`(select auth.uid())` to `profiles.id`.

- [ ] **Step 6: Implement box validation and activation**

Add `private.validate_box_definition(uuid)` returning a structured validation
result and `private.activate_box_definition(uuid, uuid)` performing locked,
atomic activation and audit append. Both use a fixed search path. Only the
activation entrypoint required by authenticated admins receives execute; its
body re-verifies `auth.uid()` and active admin role. Revoke execution from
`PUBLIC` and `anon` explicitly.

- [ ] **Step 7: Apply the updated migration on a fresh development branch**

Because an already-applied migration must never be edited in place on shared
history, reset or recreate only the disposable Supabase development branch, or
create a follow-up CLI migration if the approved target cannot be recreated.

Expected: migration history remains linear and reproducible.

- [ ] **Step 8: Run RLS tests and verify GREEN**

Run both database test files.

Expected: all assertions pass, including unauthorized mutation failures.

- [ ] **Step 9: Commit authorization implementation**

```powershell
git add supabase/migrations supabase/tests/database/002_phase_2_rls.test.sql
git commit -m "feat: enforce phase 2 row security"
```

### Task 4: Add idempotent development seed and seed verification

**Files:**

- Create: `supabase/seed.sql`
- Create: `supabase/tests/database/003_phase_2_seed.test.sql`

**Interfaces:**

- Consumes: Existing Auth users `admin@crtkabelita.com` and `user@crtkabelita.com`.
- Produces: Admin/operator profiles and the complete B101 development sample graph.

- [ ] **Step 1: Write seed verification before seed data**

Assert exact lookup identities and relationships without hardcoding generated
UUIDs:

```sql
select results_eq(
  $$ select role::text from public.profiles p join auth.users u on u.id = p.id
     where lower(u.email) = 'admin@crtkabelita.com' $$,
  array['admin'],
  'admin profile is seeded'
);

select results_eq(
  $$ select array_agg(expected_qty order by layer_no)
     from public.box_layer_requirements r
     join public.box_layers l on l.id = r.box_layer_id
     join public.box_definitions b on b.id = l.box_definition_id
     where b.box_code = 'B101' $$,
  array[3, 5],
  'B101 development layers require 3 and 5 units'
);
```

Also assert supplier `10015`, product `tube-0001`, master item `dm-0001`, part
number, active mapping, development Delivery Number, and idempotent row counts.

- [ ] **Step 2: Run seed verification and verify RED**

Run against the migrated development target before applying seed.

Expected: FAIL because the two profiles and sample graph do not exist.

- [ ] **Step 3: Implement idempotent seed**

Use a transaction and resolve Auth user IDs by normalized email. Raise a clear
exception if either user is missing. Upsert profiles and all sample entities by
their natural unique keys, retrieving IDs with `SELECT`/`RETURNING` rather than
hardcoding generated identifiers. Mark unconfirmed names and codes with
`DEV SAMPLE`. Do not insert or update Auth passwords.

Use the real QR sample measurements only as development values and document
that they are not approved production master data.

- [ ] **Step 4: Apply seed twice**

Use the hosted SQL editor/connector or the linked CLI command appropriate for
the approved development target.

Expected: both runs succeed; the second run creates no duplicate rows.

- [ ] **Step 5: Run seed verification and verify GREEN**

Expected: all sample graph and idempotency assertions pass.

- [ ] **Step 6: Commit seed**

```powershell
git add supabase/seed.sql supabase/tests/database/003_phase_2_seed.test.sql
git commit -m "test: add reproducible phase 2 seed"
```

### Task 5: Generate types, run advisors, and close the Phase 2 checklist

**Files:**

- Modify: `src/types/database.ts`
- Modify: `docs/development/supabase.md`
- Modify: `task.md`

**Interfaces:**

- Consumes: Verified hosted schema, migrations, RLS, and seed.
- Produces: Generated application types and fresh completion evidence.

- [ ] **Step 1: Run every database test together**

Discover the current CLI flags and run the full `supabase/tests/database`
suite against the approved target.

Expected: zero failed files and zero failed assertions.

- [ ] **Step 2: Run database lint and advisors**

Use `npx.cmd supabase db lint --help` before the linked lint command. Run both
Supabase security and performance advisors through the authenticated connector.

Expected: no Phase 2 security errors, no missing RLS, no unsafe function
execute grants, and no unreviewed performance warning caused by this phase.

- [ ] **Step 3: Generate TypeScript types**

Use the Supabase connector type generator for the approved project or discover
the current CLI syntax with:

```powershell
npx.cmd supabase gen types --help
```

Replace the Phase 1 placeholder in `src/types/database.ts` with unedited
generated output.

- [ ] **Step 4: Run application verification**

```powershell
npm.cmd run typecheck
npm.cmd run lint
npm.cmd test -- --reporter=verbose
npm.cmd run build
```

Expected: every command exits 0 with no failed tests or build errors.

- [ ] **Step 5: Review Phase 2 requirements line by line**

Compare migration objects and test evidence to sections 2.1 through 2.7 in
`task.md`. Check only items proven by fresh evidence. Record hosted project and
advisor verification without credentials. Leave any unverified item unchecked.

- [ ] **Step 6: Run final repository checks**

```powershell
git diff --check
git status --short
git diff --stat HEAD
```

Inspect migrations for secrets and confirm no password, service key, or access
token is present.

- [ ] **Step 7: Commit verified Phase 2 completion**

```powershell
git add src/types/database.ts docs/development/supabase.md task.md
git commit -m "docs: verify phase 2 schema and rls"
```

## Plan Self-Review

- Spec coverage: Tasks 1–5 cover enums, all required tables, box versioning and
  activation, constraints, RLS, grants, seed, migrations, types, advisors, role
  tests, and unauthorized mutation tests.
- Isolation: No hosted mutation occurs until the user identifies and approves a
  LabelBoxCRT development target. The visible GeekyTech projects are excluded.
- Type consistency: Database identifiers and enum labels match the approved
  design and later phases.
- Deferred decisions: Sequence formula and QR contract are not guessed; schema
  boundaries preserve them for Phases 5 and 6.
