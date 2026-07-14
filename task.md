# Task Plan — Sistem Scan & Print Label Box

## Cara Menggunakan

- Kerjakan berurutan.
- Jangan menandai task selesai tanpa acceptance gate.
- Satu PR/commit fokus pada satu fase atau vertical slice.
- Update checkbox dan keputusan selama development.
- Schema/security memakai Supabase migration dan verification.
- UI memakai shadcn dan browser QA.
- Print wajib diuji dengan QZ Tray dan Zebra ZD220 nyata sebelum production.

---

# Phase 0 — Requirement Lock dan Hardware Discovery

> **Status 13 Juli 2026:** workbench dan evidence register tersedia di
> [`docs/phase-0/README.md`](docs/phase-0/README.md). Gate Phase 0 belum ditutup:
> sample QR nyata, approval business rules, hardware UAT, dan logo resmi masih
> diperlukan. Checklist hanya dicentang setelah ada bukti atau approval.

## 0.1 QR Contract

- [ ] Kumpulkan 5–10 contoh QR nyata.
- [x] Dokumentasikan raw payload.
- [ ] Pastikan ada `label_uid`/serial unik.
- [ ] Konfirmasi field Part No.
- [x] Konfirmasi field Size.
- [ ] Konfirmasi satu scan mewakili berapa unit.
- [ ] Tentukan parser version.
- [ ] Tentukan maximum payload length.
- [ ] Tentukan normalization rules.
- [x] Buat expected parser output untuk sample yang tersedia.

**Gate:** duplicate prevention dapat dilakukan berdasarkan identitas unik nyata.

## 0.2 Business Rules

- [x] Definisikan “3 produk” dan “5 produk”: quantity unit per layer box.
- [x] Definisikan Nama Box sebagai field alfanumerik.
- [ ] Definisikan No Urut Item.
- [ ] Definisikan sequence scope.
- [x] Definisikan source tanggal label dari Delivery Number.
- [ ] Koreksi mismatch `180526` versus `15-mei-2026`.
- [x] Tentukan posisi Delivery Number pada urutan field label.
- [x] Tentukan Qty 100 sebagai default data Master Item, bukan hard-code aplikasi.
- [x] Tentukan sumber supplier dari tabel supplier melalui Delivery Number.
- [ ] Tentukan aturan cancel/reset.
- [ ] Tentukan aturan physical print confirmation.
- [ ] Tentukan retention audit/scan/print.

**Gate:** setiap field label punya sumber dan format tidak ambigu.

## 0.3 Hardware

- [x] Catat OS workstation.
- [ ] Tetapkan Edge atau Chrome.
- [ ] Uji DS2208 ke Notepad.
- [ ] Pastikan suffix Enter.
- [ ] Uji 100 scan beruntun.
- [ ] Catat exact Windows printer name.
- [x] Catat ZD220 DPI.
- [ ] Catat label width/height/gap/black mark.
- [x] Install QZ Tray.
- [ ] Uji raw ZPL manual.
- [ ] Tentukan dev dan production signing strategy.

**Gate:** scanner input dan test print manual berhasil.

## 0.4 Branding

- [x] Dapatkan logo resmi.
- [x] Ekstrak primary/secondary/neutral colors.
- [x] Tentukan semantic success/warning/destructive colors.
- [x] Verifikasi contrast token awal.
- [x] Tentukan typography direction: Google Font Outfit.

**Gate:** UI tidak memakai warna brand tebakan.

---

# Phase 1 — Project Foundation

> **Status 13 Juli 2026:** fondasi project selesai dan diverifikasi. Supabase lokal
> sudah dikonfigurasi, tetapi runtime database lokal belum dijalankan karena Docker
> Desktop belum tersedia di workstation. Phase 0 yang masih terbuka tetap ditunda
> sesuai arahan dan tidak mengubah invariant implementasi.

## 1.1 Repository

- [x] Inspect repo existing.
- [x] Pastikan Next.js App Router.
- [x] Enable TypeScript strict.
- [x] Konfirmasi package manager.
- [x] Setup lint/format.
- [x] Setup unit/integration/E2E scripts.
- [x] Buat `.env.example` tanpa secret.
- [x] Pin dependency versions.
- [x] Commit lockfile.

## 1.2 Supabase Client

- [x] Install `@supabase/supabase-js`.
- [x] Install `@supabase/ssr`.
- [x] Buat browser client.
- [x] Buat server client.
- [x] Buat auth proxy/session refresh berdasarkan docs terbaru.
- [x] Setup generated database types.
- [x] Setup local/dev Supabase.
- [x] Dokumentasikan migration workflow.

## 1.3 shadcn

- [x] Jalankan `shadcn info`.
- [x] Init bila belum tersedia.
- [x] Gunakan package runner project.
- [x] Terapkan semantic brand tokens.
- [x] Tambahkan komponen:
  - [x] Button
  - [x] Field/Form controls
  - [x] Input
  - [x] Select/Combobox
  - [x] Table
  - [x] Badge
  - [x] Alert
  - [x] Dialog
  - [x] AlertDialog
  - [x] Sheet
  - [x] Sidebar
  - [x] Progress
  - [x] Skeleton
  - [x] Spinner
  - [x] Empty
  - [x] Sonner
  - [x] Tooltip

## 1.4 App Shell

- [x] Auth layout.
- [x] Operator layout.
- [x] Admin layout.
- [x] Error boundary.
- [x] Not found.
- [x] Loading states.
- [x] Toast provider.
- [x] Reduced motion.

**Gate Phase 1**

- [x] Build pass.
- [x] Typecheck pass.
- [x] Supabase client bekerja.
- [x] shadcn components render.
- [x] Tidak ada secret di client bundle.

---

# Phase 2 — Schema dan RLS

## 2.1 Enums

- [x] User role.
- [x] Delivery status.
- [x] Packing session status.
- [x] Scan result.
- [x] Print job status.
- [x] Reprint status.

## 2.2 Master Tables

- [x] `profiles`.
- [x] `suppliers`.
- [x] `delivery_numbers`.
- [x] `products`.
- [x] `master_items`.
- [x] `master_item_products`.
- [x] Index dan unique constraints.

## 2.3 Box Tables

- [x] `box_definitions`.
- [x] Box versioning.
- [x] `box_layers`.
- [x] `box_layer_requirements`.
- [x] expected_qty check.
- [x] Validation function untuk publish/activate.

## 2.4 Operational Tables

- [x] `workstations`.
- [x] `packing_sessions`.
- [x] `packing_session_scans`.
- [x] `sequence_counters` atau PostgreSQL sequence.
- [x] `print_jobs`.
- [x] `print_attempts`.
- [x] `reprint_requests`.
- [x] `audit_logs`.

## 2.5 RLS

- [x] Enable RLS pada semua exposed tables.
- [x] Admin policies.
- [x] Supervisor tidak digunakan; approval/reprint menjadi tanggung jawab admin.
- [x] Operator policies.
- [x] Session/workstation ownership.
- [x] Block direct mutation yang wajib lewat RPC.
- [x] Tidak ada exposed view pada Phase 2.
- [x] Review function execute privileges.
- [x] Verify UPDATE policies punya USING + WITH CHECK.

## 2.6 Seed

- [ ] Supplier code `10015`.
- [ ] Product `tube-0001`.
- [ ] Master item `dm-0001`.
- [ ] Part No `3210A-K1Z-NA01-DL`.
- [ ] Product mapping.
- [ ] Box `B101`.
- [ ] Layer 1 qty 3.
- [ ] Layer 2 qty 5.
- [ ] Delivery Number sample.
- [ ] Dev users.

## 2.7 Verification

- [ ] Apply migrations dari clean DB.
- [x] Generate types.
- [x] Run database advisors.
- [x] Test anon.
- [x] Test operator.
- [x] Supervisor tidak digunakan pada model role yang disetujui.
- [x] Test admin.
- [x] Unauthorized mutation gagal.

**Gate Phase 2:** schema, migration, constraints, seed, dan RLS reproducible.

---

# Phase 3 — Authentication dan Workstation

## 3.1 Auth

- [ ] Login.
- [ ] Logout.
- [ ] Protected routes.
- [ ] Verify identity server-side.
- [ ] Inactive user handling.
- [ ] Session expiry handling.

## 3.2 Role

- [ ] Admin guard.
- [ ] Supervisor guard.
- [ ] Operator guard.
- [ ] Server permission helpers.
- [ ] UI navigation per permission.

## 3.3 Workstation

- [ ] Workstation identity design.
- [ ] Admin register/approve.
- [ ] Bind printer name.
- [ ] Save scanner/printer model.
- [ ] Heartbeat.
- [ ] Disable workstation.
- [ ] Prevent localStorage-only spoofing.

**Gate Phase 3:** unauthorized user/workstation tidak dapat scan atau print.

---

# Phase 4 — Admin Master Data

## 4.1 Supplier

- [ ] List/search/filter.
- [ ] Create/edit.
- [ ] Unique code validation.
- [ ] Deactivate.
- [ ] Prevent destructive delete if referenced.

## 4.2 Delivery Number

- [ ] List by supplier.
- [ ] Create/edit.
- [ ] Date.
- [ ] Status.
- [ ] Unique constraint UX.
- [ ] Close/cancel behavior.

## 4.3 Product

- [ ] CRUD/deactivate.
- [ ] Size normalization preview.
- [ ] Duplicate/conflict warning.
- [ ] Search code/name/size.

## 4.4 Master Item

- [ ] CRUD/deactivate.
- [ ] Part No.
- [ ] Unit.
- [ ] Default label Qty.
- [ ] Sequence config if needed.

## 4.5 Product Mapping

- [ ] Map many products to Master Item.
- [ ] Reverse usage view.
- [ ] Prevent duplicate mapping.
- [ ] Warning on deactivate.

## 4.6 Box Definition

- [ ] Create box.
- [ ] Add/reorder layers.
- [ ] Add product requirements.
- [ ] Validate expected_qty.
- [ ] Total count summary.
- [ ] Publish/activate.
- [ ] New version flow.
- [ ] Read-only used versions.

## 4.7 Optional CSV Import

- [ ] Define templates.
- [ ] Preview validation.
- [ ] Transactional import.
- [ ] Per-row errors.
- [ ] Audit import.
- [ ] Implement only after CRUD stable.

**Gate Phase 4:** sample B101 dapat dibuat tanpa database console.

---

# Phase 5 — Barcode Parser dan Scan Engine

## 5.1 Parser

- [ ] Implement v1 parser.
- [ ] Validate required fields.
- [ ] Normalize Part No.
- [ ] Normalize Size.
- [ ] Validate Label UID.
- [ ] Reject unsupported version.
- [ ] Unit tests dari QR nyata.
- [ ] Malformed payload tests.

## 5.2 Start Session RPC

- [ ] Verify actor/workstation.
- [ ] Resolve Master Item.
- [ ] Resolve active box.
- [ ] Handle multiple boxes.
- [ ] Enforce one active session per workstation.
- [ ] Save box version.

## 5.3 Accept Scan RPC

- [ ] Auth/role.
- [ ] Workstation ownership.
- [ ] Session state.
- [ ] Duplicate UID.
- [ ] Master Item lookup.
- [ ] Product Size lookup.
- [ ] Product ↔ Master Item.
- [ ] Layer assignment.
- [ ] Quantity enforcement.
- [ ] Insert scan.
- [ ] Progress calculation.
- [ ] Ready transition.
- [ ] Audit.
- [ ] Domain errors.

## 5.4 Concurrency Tests

- [ ] Same label parallel.
- [ ] Same label two workstations.
- [ ] Rapid labels same product.
- [ ] Last required scan parallel.
- [ ] Over-quantity race.

## 5.5 Operator Scan UI

- [ ] Dedicated scan listener.
- [ ] Ignore editable controls.
- [ ] Enter terminator.
- [ ] One active request queue.
- [ ] Success state.
- [ ] Error state.
- [ ] Duplicate state.
- [ ] Layer progress.
- [ ] Total progress.
- [ ] Last scans.
- [ ] Sound.
- [ ] Mute setting.
- [ ] Fullscreen-friendly.
- [ ] Refresh recovery.

**Gate Phase 5:** B101 selesai dengan assignment 3 + 5 yang benar.

---

# Phase 6 — Finalization dan Label Snapshot

## 6.1 Delivery Selection

- [ ] Load active DNs.
- [ ] Group/filter by supplier.
- [ ] Show DN and date.
- [ ] Block invalid/cancelled.
- [ ] Confirmation summary.

## 6.2 Sequence

- [ ] Finalize sequence scope.
- [ ] Implement atomic sequence/counter.
- [ ] Concurrency tests.
- [ ] Date-source test.
- [ ] Reset behavior test if applicable.

## 6.3 Finalize RPC

- [ ] Lock session.
- [ ] Recalculate exact quantity.
- [ ] Validate DN.
- [ ] Resolve supplier.
- [ ] Allocate sequence.
- [ ] Build label reference.
- [ ] Snapshot label.
- [ ] Create exactly one initial print job.
- [ ] Set `print_pending`.
- [ ] Audit.
- [ ] Idempotent replay.

## 6.4 Formatter

- [ ] Supplier Code.
- [ ] Part No.
- [ ] Qty.
- [ ] Item/Box reference.
- [ ] Delivery Number.
- [ ] Box Name.
- [ ] Delivery Date.
- [ ] Date formatting tests.
- [ ] Long-value tests.

**Gate Phase 6:** parallel finalize menghasilkan satu sequence dan satu print job.

---

# Phase 7 — QZ Tray dan Zebra ZD220

## 7.1 QZ Client

- [ ] Install dependency.
- [ ] Connect/disconnect/reconnect.
- [ ] Connection indicator.
- [ ] Discover exact configured printer.
- [ ] No arbitrary fallback.
- [ ] Handle permission/warning state.

## 7.2 Signing

- [ ] Dev certificate.
- [ ] Production certificate/license decision.
- [ ] Public certificate endpoint.
- [ ] Authenticated signing endpoint.
- [ ] Private key server-only.
- [ ] Origin validation.
- [ ] Rate limiting.
- [ ] Audit failures.
- [ ] Test production domain.

## 7.3 ZPL Template

- [ ] Confirm media dimensions.
- [ ] Confirm DPI.
- [ ] Build template v1.
- [ ] Escape dynamic text.
- [ ] Text overflow rules.
- [ ] Delivery Number.
- [ ] Optional barcode/QR.
- [ ] Print 20 samples.
- [ ] Verify readability.
- [ ] Verify physical dimensions.

## 7.4 Browser Print Worker

- [ ] Claim only workstation target job.
- [ ] Set printing.
- [ ] Create print attempt.
- [ ] Send raw ZPL.
- [ ] Mark sent.
- [ ] Handle fail.
- [ ] Retry same job.
- [ ] No new sequence on retry.
- [ ] Prevent double-click duplicate.
- [ ] Optional operator confirmation.

## 7.5 Failure Tests

- [ ] QZ closed.
- [ ] Wrong printer mapping.
- [ ] Printer unplugged.
- [ ] Printer paused.
- [ ] No media.
- [ ] Refresh during printing.
- [ ] Network loss after send.
- [ ] Workstation restart.

**Gate Phase 7:** label tercetak benar dan recovery tidak membuat duplicate sequence.

---

# Phase 8 — Reprint dan Exceptions

## 8.1 Reprint Request

- [ ] Operator reason.
- [ ] Link source job.
- [ ] Prevent duplicate open request.
- [ ] Audit.

## 8.2 Approval

- [ ] Supervisor/admin queue.
- [ ] Approve/reject.
- [ ] Review note.
- [ ] Permission tests.

## 8.3 Execution

- [ ] Child print job.
- [ ] Preserve snapshot.
- [ ] Reprint number.
- [ ] Audit.
- [ ] UI distinguishes reprint.

## 8.4 Session Exception

- [ ] Cancel.
- [ ] Expire stale.
- [ ] Supervisor correction policy.
- [ ] No silent delete scan.
- [ ] Correction audit.

**Gate Phase 8:** setiap reprint dapat ditelusuri ke original dan approver.

---

# Phase 9 — Design dan Polish

## 9.1 Design Concept

- [ ] Gunakan frontend-design/frontend-app-builder.
- [ ] Gunakan logo dan palette.
- [ ] Konsep full operator screen.
- [ ] Konsep admin list/form.
- [ ] Success/error/print failure states.
- [ ] Accessibility review.
- [ ] Approval bila workflow memungkinkan.

## 9.2 shadcn Audit

- [ ] Forms memakai Field/FieldGroup.
- [ ] Tables memakai Table.
- [ ] Dialog memiliki title.
- [ ] Loading memakai Skeleton/Spinner.
- [ ] Empty memakai Empty.
- [ ] Status memakai Badge/Alert.
- [ ] Semantic tokens.
- [ ] No raw color sprawl.
- [ ] No monolithic component.

## 9.3 Micro-interactions

- [ ] Scan success.
- [ ] Scan fail.
- [ ] Layer progress.
- [ ] Completion.
- [ ] QZ/printer status.
- [ ] Reduced motion.
- [ ] No blocking animation.

## 9.4 Responsive

- [ ] Desktop workstation.
- [ ] Small laptop.
- [ ] Minimum viewport.
- [ ] Admin tablet only if needed.
- [ ] Operator mobile out of scope unless requested.

## 9.5 Design QA

- [ ] Browser screenshots.
- [ ] Typography.
- [ ] Contrast.
- [ ] Focus order.
- [ ] Keyboard navigation.
- [ ] Error copy.
- [ ] Empty states.
- [ ] Loading states.
- [ ] Impeccable/design critique if available.

**Gate Phase 9:** operator memahami state tanpa training teknis panjang.

---

# Phase 10 — Security Hardening

## 10.1 RLS Review

- [ ] No authorization with only `TO authenticated`.
- [ ] Correct row predicates.
- [ ] UPDATE USING + WITH CHECK.
- [ ] Secure views.
- [ ] Secure privileged functions.
- [ ] Revoke public execute.
- [ ] Advisors reviewed.

## 10.2 API

- [ ] Zod validation.
- [ ] Payload limits.
- [ ] Rate limiting.
- [ ] CSRF/origin strategy.
- [ ] CSP compatible with QZ.
- [ ] Safe errors.
- [ ] Structured logs.
- [ ] Secret rotation.

## 10.3 Abuse Tests

- [ ] Operator calls admin action.
- [ ] Role tampering.
- [ ] Cross-workstation claim.
- [ ] Cross-session scan.
- [ ] Replay scan.
- [ ] Replay finalize.
- [ ] Supplier/DN mismatch.
- [ ] ZPL injection.
- [ ] Unauthorized reprint.
- [ ] Direct table mutation.

## 10.4 Dependency

- [ ] Lockfile.
- [ ] Security audit.
- [ ] Remove unused packages.
- [ ] Verify QZ package/version.
- [ ] Verify Supabase compatibility.

**Gate Phase 10:** no unresolved critical/high issue without documented acceptance.

---

# Phase 11 — Cron dan Operations

## 11.1 Cron

- [ ] Stale session endpoint.
- [ ] Stuck print reconciliation.
- [ ] Failed job alert.
- [ ] Daily summary.
- [ ] Retention cleanup if approved.

## 11.2 Cron Security

- [ ] Secret.
- [ ] Idempotency.
- [ ] UTC schedule.
- [ ] Logging.
- [ ] Failure alert.
- [ ] Concurrency safe.
- [ ] No printer access.

## 11.3 Monitoring

- [ ] Error monitoring.
- [ ] Correlation IDs.
- [ ] Audit dashboard.
- [ ] Print failure alert.
- [ ] Stuck session alert.
- [ ] Workstation last seen.

**Gate Phase 11:** cron aman dipanggil ulang dan tidak mencetak secara langsung.

---

# Phase 12 — Testing dan UAT

## 12.1 Automated

- [ ] Unit.
- [ ] RPC/database.
- [ ] Integration.
- [ ] E2E operator.
- [ ] E2E admin.
- [ ] Concurrency.
- [ ] Security.
- [ ] Build/typecheck/lint.

## 12.2 Data

- [ ] Import sample.
- [ ] Verify references.
- [ ] Verify active box versions.
- [ ] Verify supplier/DN.
- [ ] Verify label snapshot.

## 12.3 Operator UAT

- [ ] Start shift.
- [ ] Valid scans.
- [ ] Invalid Part No.
- [ ] Invalid Size.
- [ ] Duplicate.
- [ ] Complete B101.
- [ ] Select DN.
- [ ] Print.
- [ ] Recover failure.
- [ ] Reprint request.

## 12.4 Performance

- [ ] Agree scan-to-result target.
- [ ] Agree print-dispatch target.
- [ ] 100+ scan stability.
- [ ] Multiple workstation concurrency.
- [ ] Query/index review.
- [ ] Avoid N+1.

## 12.5 Sign-off

- [ ] Business owner.
- [ ] Operator.
- [ ] Admin.
- [ ] IT/security.
- [ ] Hardware/printer.

**Gate Phase 12:** UAT sign-off dan rollback plan tersedia.

---

# Phase 13 — Production Deployment

## 13.1 Environment

- [ ] Production Supabase.
- [ ] Vercel env vars.
- [ ] Separate dev/staging/prod.
- [ ] QZ certificate.
- [ ] Production origin allowlist.
- [ ] Cron secret.
- [ ] Monitoring env.

## 13.2 Database Release

- [ ] Backup/restore plan.
- [ ] Apply migrations.
- [ ] Generate/check types.
- [ ] Advisors.
- [ ] RLS smoke test.
- [ ] Production config seed only.

## 13.3 App Release

- [ ] Preview QA.
- [ ] Production deploy.
- [ ] Login.
- [ ] Workstation registration.
- [ ] QZ certificate test.
- [ ] Test print.
- [ ] Cron verification.
- [ ] Monitoring verification.

## 13.4 Rollback

- [ ] Previous Vercel deployment.
- [ ] Backward-compatible migration strategy.
- [ ] Printer fallback SOP.
- [ ] Manual contingency.

**Gate Phase 13:** production scan-to-print berhasil dari workstation nyata.

---

# Post-Launch

- [ ] Review invalid scan reasons.
- [ ] Review duplicate frequency.
- [ ] Review print failures.
- [ ] Review reprint anomaly.
- [ ] Review master-data corrections.
- [ ] Tune indexes.
- [ ] Test restore.
- [ ] Renew QZ certificate.
- [ ] DS2208/ZD220 maintenance SOP.
- [ ] Periodic security review.

---

# Definition of Ready

Feature siap dikerjakan jika:

- Requirement jelas.
- Data source jelas.
- Permission jelas.
- Failure behavior jelas.
- Acceptance criteria jelas.
- UI states jelas.
- Dependency phase selesai.

# Definition of Done

- Code reviewed.
- Migration reviewed.
- RLS reviewed.
- Tests pass.
- Error/recovery tested.
- Audit implemented.
- Docs updated.
- Browser QA pass.
- Hardware QA pass untuk scan/print.
