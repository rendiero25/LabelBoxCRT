# Phase 7 Design — QZ Tray + Zebra ZD220 Print Integration

Date: 2026-07-22
Status: Approved (user, 2026-07-22)

## Hardware facts (locked from user, 2026-07-22)

- Printer Windows name: `ZDesigner ZD220-203dpi ZPL` (detected, online).
- QZ Tray installed and running on workstation.
- Resolution: 203 dpi (8 dots/mm).
- Media: 55 mm width (print-head axis) × 75 mm length (feed axis), gap 3 mm between labels.
- Stock: roll sticker printed with wax ribbon → thermal transfer → ZPL `^MTT`.
- Derived dots: `^PW440` (55 mm × 8), `^LL600` (75 mm × 8).

## Decisions

| # | Decision | Choice |
|---|----------|--------|
| D1 | Claim model | Any browser tab logged in as the finalizing operator may claim their own session's print job (per remove-workstation forward note). No workstation entity. |
| D2 | ZPL generation | Pure TypeScript in `src/lib/label/zpl.ts`, client builds ZPL from finalize snapshot; persisted server-side at claim time. Not generated in SQL. |
| D3 | Confirmation | Auto: QZ send success → status `sent` → immediately `confirmed` (single RPC call sets both, `sent_at` + `confirmed_at`). No manual "label OK?" step. Physical problems handled via reprint request (Phase 8). |
| D4 | Retry | Same job, same ZPL, re-claim from `failed` status. Never a new print_jobs row, never a new sequence. Retry button on scan page. |
| D5 | Certificate | One self-signed company root cert (RSA 2048, ~10 yr) for dev and prod. Private key server-only in `QZ_PRIVATE_KEY`. IT installs public cert into Windows Trusted Root on each workstation. No purchased QZ cert. |
| D6 | Printer selection | Operator picks from QZ-discovered list, stored in browser `localStorage`. No server mapping, no first-printer fallback. |
| D7 | Barcode | None in v1. Seven text fields only. Template version stays `v1`. |
| D8 | RLS | No INSERT/UPDATE policies on print tables. All mutation via new SECURITY DEFINER RPCs, matching `finalize_packing_session` pattern. |

## 1. Database — migration `phase_7_print_rpcs`

Two new `SECURITY DEFINER` functions (schema `public`, `search_path` pinned, execute revoked from `public`/`anon`, granted to `authenticated`), following existing RPC conventions.

### `claim_print_job(p_print_job_id uuid, p_zpl_payload text)`

1. Verify `auth.uid()` is an active operator/admin profile.
2. Load job `FOR UPDATE`; verify caller is the operator of the job's packing session (or admin).
3. Require `status IN ('pending','failed')` — else domain error (`PRINT_JOB_NOT_CLAIMABLE`, `PRINT_JOB_NOT_FOUND`, `PRINT_JOB_FORBIDDEN`).
4. Validate `p_zpl_payload` non-empty, length-capped (16 KB), must start with `^XA` and end with `^XZ`.
5. Set `zpl_payload = p_zpl_payload`, `status = 'printing'`, `updated_at`.
6. Insert `audit_logs` row (`print_job_claimed`).
7. Return job row (id, status, attempt_count, label_reference, snapshots).

Atomicity: row lock + status precondition blocks double-claim from two tabs; loser gets `PRINT_JOB_NOT_CLAIMABLE`.

### `complete_print_job(p_print_job_id uuid, p_result print_attempt_result, p_printer_name text, p_error_code text default null, p_error_message_safe text default null)`

1. Same actor + ownership checks; job must be `status = 'printing'` (else `PRINT_JOB_NOT_PRINTING`).
2. Insert `print_attempts` (`attempt_no = attempt_count + 1`, `printer_name`, `result`, error fields only when `failed`).
3. `result = 'sent'` → job `status = 'confirmed'`, `sent_at = now()`, `confirmed_at = now()`.
   `result = 'failed'` → job `status = 'failed'`.
4. `attempt_count = attempt_count + 1`, `updated_at`.
5. Insert `audit_logs` row (`print_attempt_recorded`).
6. Return job row.

Session status: `packing_sessions` stays `print_pending` when job fails; moves to `completed` when job confirmed (same RPC, step 3).

### Stale-state recovery

If a tab dies mid-`printing` (refresh/crash after claim, before complete), the job is stuck in `printing`. Recovery: `claim_print_job` also accepts jobs in `printing` **owned by the same caller** whose `updated_at` is older than 2 minutes (re-claim path, keeps status `printing`, replaces payload). Cron-based reconciliation stays Phase 11.

## 2. ZPL generation — `src/lib/label/zpl.ts`

Pure function, no I/O, mirrors `formatter.ts`:

```ts
buildLabelZpl(fields: FormattedLabelFields): string
```

- Consumes existing `formatLabelFields()` output (Supplier Code, Part No, Qty, Item/Box Reference, Delivery Number, Box Name, Delivery Date).
- Escaping: `escapeZplText()` replaces `^` `~` `_` (hex-escape via `^FH` field-hex `_5e` `_7e` `_5f`); strips control chars; caps each field length with ellipsis truncation rule (overflow rule: truncate, never wrap into next field's zone).
- Layout: `^XA ^CI28 ^MTT ^PW440 ^LL600 ^MNY` header; 7 labeled rows `^FO`-positioned within 440×600 dots with safe margins (16 dots ≈ 2 mm); `^A0N` scalable font, larger size for Part No + Item/Box Reference; `^XZ` trailer.
- `TEMPLATE_VERSION = 'v1'` exported; stored value in `print_jobs.template_version` already `'v1'` from finalize.
- Unit tests: escaping (all three specials, control chars), overflow truncation, exact-dimension header assertions, golden-output snapshot for seed B101 sample, long-value cases.

## 3. QZ client — `src/features/print/`

New feature folder per repo convention:

- `qz-client.ts` — thin wrapper over `qz-tray` npm package (new dependency, pinned): `connectQz()` (idempotent, sets certificate + signature promises pointing at `/api/qz/cert` and `/api/qz/sign`), `disconnectQz()`, `listPrinters()`, `sendZpl(printerName, zpl)` using `qz.print` raw ZPL config.
- `use-qz-connection.ts` — React hook: connection state machine `disconnected | connecting | connected | error`, auto-reconnect with capped backoff on unexpected close, exposes `printers`, `refreshPrinters()`.
- `printer-preference.ts` — `localStorage` get/set of chosen printer name (key `labelbox.printerName`). UI must always show which printer is selected; if stored name no longer in discovered list → treat as unselected, block printing, show warning. **No fallback to any other printer.**
- `actions.ts` — server actions wrapping `claim_print_job` / `complete_print_job` RPCs with safe error-message mapping (same table style as `finalize/actions.ts`).
- `components/qz-status-badge.tsx` — real connection + printer indicator replacing static placeholders in `src/components/shared/app-status.tsx`.
- `components/printer-picker.tsx` — dropdown (shadcn Select) listing discovered printers.

## 4. Signing endpoints — `src/app/api/qz/`

- `GET /api/qz/cert` — returns public certificate PEM from `QZ_CERTIFICATE` env. Public, cacheable.
- `POST /api/qz/sign` — body `{ request: string }`. Guards, in order:
  1. Authenticated Supabase session (server client, `getUser()`), active profile.
  2. `Origin` header ∈ allowlist (`NEXT_PUBLIC_APP_URL` + localhost dev origins).
  3. Rate limit: in-memory sliding window per user id (e.g. 30 req/min) — acceptable for single-instance internal tool; note serverless multi-instance caveat in code comment.
  4. Payload cap (4 KB).
  Signs with SHA-512 + RSA using `QZ_PRIVATE_KEY` (Node built-in `crypto`, no new dep). Returns base64 signature. Failures logged server-side with reason, never logging payload or key. 4xx responses generic.
- Cert generation documented in `docs/phase-7/qz-certificate.md`: `openssl req -x509 -newkey rsa:2048 -sha512 -days 3650 ...`, key → `QZ_PRIVATE_KEY` env (never committed), cert → env/`public` asset + IT installs into Windows Trusted Root per workstation.
- `.env.example` gains `QZ_CERTIFICATE=` alongside existing `QZ_PRIVATE_KEY=`.

## 5. Print worker UI — scan page integration

Flow after `finalizePackingSessionAction` success (in `packing-scan-console.tsx` finalize handler):

1. Build ZPL client-side from returned `FinalizeSnapshot`.
2. Preconditions: QZ connected + printer selected. If not → job stays `pending`, UI shows blocking "Printer belum siap" state with connect/pick affordance and a **Print** button once ready (job not lost; finalize already durable).
3. `claimPrintJobAction(printJobId, zpl)` → on success `sendZpl(printer, zpl)` → `completePrintJobAction(jobId, 'sent', printer)` → success state ("Label terkirim ke printer"), session completed, UI resets for next box.
4. Any QZ error → `completePrintJobAction(jobId, 'failed', printer, code, safeMessage)` → failed state with **Retry Print** button.
5. Retry: rebuild same ZPL from snapshot (still in client state; on page refresh, refetch job row via existing SELECT RLS to recover snapshot + status), re-claim, re-send. Same job id, same sequence, attempt_no increments.
6. Double-click guard: single in-flight promise per job (same pattern as scan queue); button disabled while in flight.
7. Refresh recovery: on mount, query for caller's own job in `printing`/`failed`/`pending` state for their active/just-finalized session; surface resume card with Print/Retry.

## 6. Error taxonomy (safe messages, Indonesian)

| Code | UI message |
|------|-----------|
| QZ_NOT_CONNECTED | "QZ Tray tidak terhubung. Pastikan QZ Tray berjalan." |
| PRINTER_NOT_SELECTED | "Printer belum dipilih." |
| PRINTER_NOT_FOUND | "Printer yang tersimpan tidak ditemukan. Pilih ulang printer." |
| QZ_SEND_FAILED | "Gagal mengirim ke printer. Coba lagi." |
| PRINT_JOB_NOT_CLAIMABLE | "Print job sedang diproses di tempat lain atau sudah selesai." |
| PRINT_JOB_NOT_PRINTING | "Status print job tidak valid untuk penyelesaian." |
| PRINT_JOB_FORBIDDEN | "Anda tidak berhak memproses print job ini." |

## 7. Testing

- **Unit (vitest):** ZPL builder (escaping, truncation, header dims, golden sample), printer-preference logic, qz-client state transitions with mocked `qz-tray` module, sign-endpoint guard logic where extractable.
- **pgTAP (`016_phase_7_print_rpcs.test.sql`):** claim happy path; claim rejects wrong operator/wrong status/bad payload; double-claim second call fails; complete sent → confirmed + session completed + attempt row; complete failed → failed + attempt row with error fields; retry claim from failed; stale re-claim path; attempt_no uniqueness; audit rows written; regression 014/015 stay green.
- **Manual hardware (user-run, checklist stays unchecked until done):** print 20 samples, verify readability + physical dimensions with ruler, failure drills (QZ closed, printer unplugged/paused/no-media, refresh mid-print, network loss after send, workstation restart). Code paths exist; physical proof pending.

## Out of scope

- Reprint request/approval flow — Phase 8.
- Cron stale-job reconciliation — Phase 11.
- Barcode/QR on label — future template v2.
- Purchased QZ Industries certificate — not planned; self-signed root chosen.
