# Phase 2 Schema and RLS Design

**Date:** 14 July 2026  
**Status:** Approved for written specification  
**Scope:** Phase 2 in `task.md`

## Goal

Create a reproducible Supabase PostgreSQL schema for master, box, operational,
printing, reprint, and audit data. Every exposed table must have explicit
grants and row-level security. Database invariants must remain authoritative
even when future application code or clients behave incorrectly.

## Confirmed Decisions

- Supabase development and verification use an online Supabase project. The
  local Supabase runtime is not part of this phase.
- Application roles are `admin` and `operator`. There is no supervisor role.
  Administrative approval workflows, including future reprints, belong to the
  admin role.
- Development identities use `admin@crtkabelita.com` and
  `user@crtkabelita.com`. Passwords are created outside version control and are
  never stored in SQL seed files.
- Product dimensions are structured numeric data: outside diameter, inside
  diameter, and length. Multiple products may have different dimensions.
- Box names accept alphanumeric text. The database does not impose a
  numeric-only format.
- Accepted physical labels use a globally unique `label_uid`. Duplicate
  prevention is not weakened to a time debounce.
- Sequence storage uses a generic `scope_key`. Phase 6 will define how business
  attributes produce that key and format the final label reference.
- Seed values not confirmed as production master data are explicitly marked as
  development samples and must not be treated as business invariants.

## Delivery Strategy

Schema changes are committed as ordered Supabase migrations created with the
project-pinned CLI. SQL database tests live under `supabase/tests/database` and
seed data lives in `supabase/seed.sql`.

The first online target must be a disposable development or Supabase branch
project. The migration workflow must not reset an existing hosted database.
After access is supplied, the implementation will link to the approved target,
inspect its migration state, push pending migrations, run database tests and
advisors, then generate `src/types/database.ts` from the verified schema.

Production deployment is outside Phase 2.

## Schema Conventions

- Primary entity identifiers use `uuid` with `gen_random_uuid()` unless the
  identifier is naturally scoped, such as `sequence_counters.scope_key`.
- Audit log identifiers use generated `bigint` values.
- Timestamps use `timestamptz` and default to `now()` where creation is
  database-controlled.
- Mutable master records contain `created_at` and `updated_at`; a shared trigger
  maintains `updated_at`.
- Human codes are trimmed, non-empty text and use case-insensitive unique
  indexes where business lookup is case-insensitive.
- Referenced historical data is deactivated instead of cascade-deleted.
- Foreign keys use restrictive deletion by default. Pure mapping and child
  configuration rows may cascade only when their unused parent is deliberately
  removed.
- All positive quantities, versions, ordering values, dimensions, and counters
  have check constraints.
- Direct grants are explicit because the project configuration does not
  automatically expose new tables.

## Enums

The public schema defines:

- `user_role`: `admin`, `operator`
- `delivery_status`: `draft`, `active`, `closed`, `cancelled`
- `packing_session_status`: `draft`, `scanning`, `ready_to_finalize`,
  `finalizing`, `print_pending`, `printing`, `sent_to_printer`, `confirmed`,
  `print_failed`, `cancelled`, `expired`
- `scan_result`: `accepted`, `invalid`, `duplicate`, `over_qty`
- `print_job_status`: `pending`, `printing`, `sent`, `confirmed`, `failed`,
  `cancelled`
- `print_attempt_result`: `sent`, `failed`
- `reprint_status`: `requested`, `approved`, `rejected`, `executed`

Enums prevent spelling drift while retaining the states required by later
phases.

## Master Data

### Profiles

`profiles.id` references `auth.users.id`. A profile stores `display_name`,
`role`, active state, and timestamps. Authorization always reads this table;
it does not trust user-editable Auth metadata.

Account creation and password assignment remain an Auth administration action.
The seed resolves the two confirmed emails to Auth user IDs and creates their
profiles only when those Auth users already exist. Missing users produce a
clear seed failure instead of inserting passwords or silent partial data.

### Suppliers and Delivery Numbers

`suppliers` stores unique supplier code, supplier name, active state, and
timestamps. `delivery_numbers` belongs to one supplier and stores delivery
number, date, status, creator, and creation time. Delivery number uniqueness is
scoped to supplier.

### Products

`products` stores product code, part name, outside diameter, inside diameter,
length, a deterministic normalized dimension key, active state, and timestamps.
Dimensions use positive `numeric` values so decimal measurements are not
subject to floating-point drift.

The schema does not enforce outside diameter greater than inside diameter in
Phase 2 because the decoded real sample and current naming have not established
that physical relationship reliably. Positivity is enforced; semantic ordering
can be added after approved master-data examples are available.

The normalized dimension key supports indexed lookup but is not globally
unique. Distinct product codes may share identical dimensions.

### Master Items and Product Mapping

`master_items` stores item code, part number, part name, unit, positive default
label quantity, optional alphanumeric item sequence code, active state, and
timestamps. Item code and part number are independently unique.

`master_item_products` is a many-to-many mapping with active state and a unique
pair of master item and product.

## Versioned Box Configuration

`box_definitions` belongs to a master item and stores box code, alphanumeric box
name, positive version, lifecycle state, and timestamps. The unique key is
master item, box code, and version. A partial unique index permits at most one
active version for a master item and box code.

`box_layers` belongs to a box definition and stores positive layer number,
layer name, positive sort order, and active state. Layer number and sort order
are unique within a box definition.

`box_layer_requirements` belongs to a layer and product and stores positive
expected quantity and positive sort order. A product and sort order are each
unique within a layer.

A database validation function reports whether a box version is publishable.
An activation function runs with controlled privileges and atomically:

1. Verifies the authenticated actor is an active admin.
2. Locks the target box family.
3. Requires an active master item, at least one active layer, and at least one
   valid active product requirement per active layer.
4. Requires every required product to be actively mapped to the master item.
5. Deactivates the previously active version in the same box family.
6. Activates the selected version and appends an audit record.

The privileged function lives in a non-exposed `private` schema, has a fixed
safe `search_path`, revokes default execution from `PUBLIC`, and grants execute
only to `authenticated`. The function performs its own identity and role check.

## Operational Data

`workstations` stores unique workstation code, name, exact printer mapping,
printer and scanner models, active state, optional last-seen time, and
timestamps. A workstation assignment table maps active operators to approved
workstations. This explicit relationship supplies the ownership predicate
required by RLS and avoids trusting browser storage.

`packing_sessions` references operator, workstation, master item, immutable box
version, and an optional delivery number. It stores state timestamps, a
positive optimistic concurrency version, cancellation reason, and creation
time. A partial unique index permits at most one non-terminal session per
workstation.

`packing_session_scans` stores scan snapshots and outcomes. Accepted scans
require `label_uid`, product, and layer; rejected scans may omit them while
retaining a safe payload hash and error code. A partial unique index enforces
global uniqueness of non-null accepted `label_uid` values.

`sequence_counters` stores `scope_key`, non-negative current value, and update
time. Direct browser access is denied. Phase 6 RPC logic will lock and increment
the relevant row.

## Printing and Reprints

`print_jobs` stores the session and workstation target, optional parent job,
status, complete label snapshot, sequence number, label reference, template
version, raw ZPL, attempt count, actor, and lifecycle timestamps. Snapshot
fields and quantities are constrained to non-empty or positive values. A
partial unique index allows exactly one root initial print job per packing
session while permitting child reprint jobs.

`print_attempts` stores monotonically numbered attempts per print job,
workstation and printer snapshots, result, safe error fields, and creation time.
Attempt number is unique within a print job.

`reprint_requests` stores source print job, requester, mandatory reason, status,
admin reviewer, review note, and review timestamps. A partial unique index
prevents more than one open request for a source job.

`audit_logs` is append-oriented and stores actor, action, entity identity,
optional workstation, non-secret JSON metadata, correlation ID, and timestamp.
Authenticated clients receive no direct insert, update, or delete permission.
Trusted database functions append audit events.

## RLS and Grants

RLS is enabled and forced on every table in `public`. The migration revokes all
table privileges from `anon` and grants only the operations explicitly required
by `authenticated` policies.

Reusable private authorization functions determine whether the current Auth
user is an active admin, active operator, or assigned to a workstation. These
functions do not read JWT user metadata.

Policy matrix:

| Data group                 | Admin                                            | Operator                                         | Anonymous |
| -------------------------- | ------------------------------------------------ | ------------------------------------------------ | --------- |
| Own profile                | Read own profile; read all for administration    | Read own profile                                 | No access |
| Master and active box data | Read and manage through allowed admin operations | Read active records required for work            | No access |
| Delivery numbers           | Read and manage                                  | Read active records needed by assigned sessions  | No access |
| Workstations               | Read and manage                                  | Read assigned active workstation                 | No access |
| Packing sessions and scans | Read all                                         | Read only own sessions on assigned workstations  | No access |
| Print jobs and attempts    | Read all                                         | Read only jobs targeted to assigned workstations | No access |
| Reprint requests           | Read all                                         | Read own requests and related source job         | No access |
| Audit logs                 | Read all                                         | No direct access                                 | No access |

Direct mutation of packing sessions, scans, sequence counters, print jobs,
print attempts, reprint status, and audit logs is denied to browser roles in
Phase 2. Later transactional RPC migrations will grant the narrowly required
operations. Admin master-data writes use explicit policies with both `USING`
and `WITH CHECK` for updates.

No exposed view is required for Phase 2. Any later public-schema view must use
`security_invoker = true` or remain ungranted.

## Seed Design

The seed is idempotent. It resolves the two confirmed Auth emails, upserts their
profiles as admin and operator, then inserts the required Phase 2 sample graph:
supplier `10015`, product `tube-0001`, master item `dm-0001`, part number
`3210A-K1Z-NA01-DL`, their mapping, box `B101` version 1, layer quantities 3 and
5, and a development Delivery Number.

Values not supplied by the owner use conspicuous `DEV SAMPLE` names and codes.
They exist only to verify relationships, constraints, policies, and future
flows. The real QR sample dimensions may be included as development measurement
data, but they do not establish a production product master record.

## Database Tests

pgTAP tests cover:

- All required enums, tables, columns, foreign keys, checks, unique indexes,
  and partial indexes exist.
- Invalid dimensions, quantities, versions, sort orders, counters, and empty
  required text are rejected.
- Duplicate supplier, delivery number within supplier, product mapping, box
  version, layer number, layer requirement, accepted label UID, initial print
  job, print attempt number, and open reprint request are rejected.
- Invalid box configurations cannot activate; a valid configuration activates
  and deactivates its prior family version atomically.
- Anonymous users cannot read or mutate exposed data.
- Operators can read active master data and only their own assigned operational
  rows, but cannot mutate protected tables or master data.
- Admins can manage permitted master data and inspect operational and audit
  data.
- Inactive profiles and unassigned workstations lose access.
- Update policies enforce both the original-row and resulting-row predicates.
- Sensitive functions are not executable by `PUBLIC` or `anon` and reject an
  unauthorized authenticated caller.

## Verification on Hosted Supabase

Once hosted access is available:

1. Confirm the target is a disposable development or branch project and record
   its project reference without storing credentials in the repository.
2. Discover the pinned CLI commands with `--help` and inspect local versus
   remote migration history.
3. Create the two Auth users through a protected administration path and keep
   their passwords outside version control.
4. Apply migrations to the approved development target.
5. Run the database tests against the linked target.
6. Run database lint and Supabase security/performance advisors; address all
   findings caused by Phase 2.
7. Generate TypeScript types from the hosted schema into
   `src/types/database.ts`.
8. Run application typecheck, lint, unit tests, and build.
9. Re-run role smoke tests through Supabase clients using anonymous, operator,
   and admin identities.

The Phase 2 gate is complete only after all steps have fresh successful
evidence. Before hosted access is supplied, implementation may be prepared but
the gate remains explicitly unverified.

## Out of Scope

- Barcode parsing and scan acceptance RPC behavior belong to Phase 5.
- Sequence allocation and label-reference formatting belong to Phase 6.
- QZ Tray, ZPL generation, and print-worker behavior belong to Phase 7.
- Reprint approval and execution RPC behavior belong to Phase 8.
- Authentication screens and workstation registration flows belong to Phase 3.
- Production deployment and production seed data belong to Phase 13.

## Requirement Traceability

This design covers every Phase 2 checklist group: enums, master tables,
versioned box tables, operational tables, RLS, reproducible development seed,
hosted migration verification, generated types, advisors, role tests, and
unauthorized-mutation tests. Deferred Phase 0 decisions are represented by
extensible fields rather than guessed business formulas.
