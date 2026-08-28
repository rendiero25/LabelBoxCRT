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

> **Status 13 Juli 2026:** fondasi project selesai dan diverifikasi. Supabase online
> sudah linked; runtime database lokal tidak digunakan untuk project ini. Phase 0
> yang masih terbuka tetap ditunda
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

- [x] Supplier code `10015`.
- [x] Product `tube-0001`.
- [x] Master item `dm-0001`.
- [x] Part No `3210A-K1Z-NA01-DL`.
- [x] Product mapping.
- [x] Box `B101`.
- [x] Layer 1 qty 3.
- [x] Layer 2 qty 5.
- [x] Delivery Number sample.
- [x] Dev users.

## 2.7 Verification

- [x] Apply migrations dari clean DB.
- [x] Generate types.
- [x] Run database advisors.
- [x] Test anon.
- [x] Test operator.
- [x] Supervisor tidak digunakan pada model role yang disetujui.
- [x] Test admin.
- [x] Unauthorized mutation gagal.

**Gate Phase 2:** schema, migration, constraints, seed, dan RLS reproducible.

---

# Phase 3 — Authentication

## 3.1 Auth

- [x] Login.
- [x] Logout.
- [x] Protected routes.
- [x] Verify identity server-side.
- [x] Inactive user handling.
- [x] Session expiry handling.

## 3.2 Role

- [x] Admin guard.
- [x] Supervisor tidak digunakan; approval/reprint tetap pada admin.
- [x] Operator guard.
- [x] Server permission helpers.
- [x] UI navigation per permission.

**Gate Phase 3:** unauthorized user tidak dapat scan atau print.

---

# Phase 4 — Admin Master Data

## 4.1 Supplier

- [x] List/search/filter.
- [x] Create/edit.
- [x] Unique code validation.
- [x] Deactivate.
- [x] Prevent destructive delete if referenced.

## 4.2 Delivery Number

- [x] List by supplier.
- [x] Create/edit.
- [x] Date.
- [x] Status.
- [x] Unique constraint UX.
- [x] Close/cancel behavior.

## 4.3 Product

- [x] CRUD/deactivate.
- [x] Size normalization preview.
- [x] Duplicate/conflict warning.
- [x] Search code/name/size.

## 4.4 Master Item

- [x] CRUD/deactivate.
- [x] Part No.
- [x] Unit.
- [x] Default label Qty.
- [x] Sequence config if needed.

## 4.5 Product Mapping

- [x] Map many products to Master Item.
- [x] Reverse usage view.
- [x] Prevent duplicate mapping.
- [x] Warning on deactivate.

## 4.6 Box Definition

- [x] Create box.
- [x] Add/reorder layers.
- [x] Add product requirements.
- [x] Validate expected_qty.
- [x] Total count summary.
- [x] Publish/activate.
- [x] New version flow.
- [x] Read-only used versions.

## 4.7 Optional CSV Import

- [x] Define templates.
- [x] Preview validation.
- [x] Transactional import.
- [x] Per-row errors.
- [x] Audit import.
- [x] Implement only after CRUD stable.

**Gate Phase 4:** sample B101 dapat dibuat tanpa database console.

---

# Phase 5 — Barcode Parser dan Scan Engine

> **Status 21 Juli 2026:** parser, RPC (`start_packing_session`, `accept_packing_scan`),
> dan operator scan UI diverifikasi lewat 25 unit test (vitest) dan 40 pgTAP assertion
> yang dijalankan terhadap hosted development project (migrasi Phase 5 sudah live).
> Gate B101 3 + 5 terverifikasi otomatis lewat pgTAP. Label UID tetap menolak setiap
> scan nyata (`LABEL_UID_MISSING`) karena QR asli belum memiliki identitas unik
> (Phase 0.1 belum ditutup, lihat AGENTS.md Open Decision #2) — end-to-end hardware
> UAT belum bisa dilakukan. Concurrency hanya diverifikasi struktural (unique index +
> `FOR UPDATE` lock via pgTAP single-connection), bukan uji koneksi paralel nyata.
> Fullscreen/kiosk sizing diperbaiki tapi belum di-screenshot live (operator auth
> sengaja tidak diseed ke repo).

## 5.1 Parser

- [x] Implement v1 parser.
- [x] Validate required fields.
- [ ] Normalize Part No.
- [x] Normalize Size.
- [x] Validate Label UID.
- [x] Reject unsupported version.
- [x] Unit tests dari QR nyata.
- [x] Malformed payload tests.

## 5.2 Start Session RPC

- [x] Verify actor.
- [x] Resolve Master Item.
- [x] Resolve active box.
- [x] Handle multiple boxes.
- [x] Save box version.

## 5.3 Accept Scan RPC

- [x] Auth/role.
- [x] Session state.
- [x] Duplicate UID.
- [x] Master Item lookup.
- [x] Product Size lookup.
- [x] Product ↔ Master Item.
- [x] Layer assignment.
- [x] Quantity enforcement.
- [x] Insert scan.
- [x] Progress calculation.
- [x] Ready transition.
- [x] Audit.
- [x] Domain errors.

## 5.4 Concurrency Tests

- [ ] Same label parallel.
- [ ] Rapid labels same product.
- [ ] Last required scan parallel.
- [ ] Over-quantity race.

## 5.5 Operator Scan UI

- [x] Dedicated scan listener.
- [x] Ignore editable controls.
- [x] Enter terminator.
- [x] One active request queue.
- [x] Success state.
- [x] Error state.
- [x] Duplicate state.
- [x] Layer progress.
- [x] Total progress.
- [x] Last scans.
- [x] Sound.
- [x] Mute setting.
- [ ] Fullscreen-friendly.
- [x] Refresh recovery.

**Gate Phase 5:** B101 selesai dengan assignment 3 + 5 yang benar. Terverifikasi
otomatis lewat pgTAP (`014_phase_5_packing_session_scan.test.sql`, assertion 34).
Live hardware/browser UAT masih tertunda Phase 0.1.

---

# Phase 6 — Finalization dan Label Snapshot

> **Status 21 Juli 2026:** desain dikunci lewat brainstorming (BR-04 sequence global
> never-reset, format reference `{sequence}-{DDMMYY}-{box_code}` tanpa padding,
> finalize idempotent replay, DN reusable lintas session) — lihat
> [`docs/superpowers/specs/2026-07-21-phase-6-finalize-design.md`](docs/superpowers/specs/2026-07-21-phase-6-finalize-design.md).
> Implementasi diverifikasi lewat 42 pgTAP assertion baru + 40 regresi Phase 5 (tetap
> hijau), 14 unit test formatter, dan full suite 139/139 test aplikasi; typecheck+lint
> bersih. `print_jobs.zpl_payload` diisi placeholder `'PENDING_ZPL_GENERATION'` sampai
> Phase 7 membangun ZPL generator asli. Preview qty pra-submit di UI masih approximate
> (`totalExpectedQty`, bukan `default_label_qty` asli) karena client belum fetch nilai
> itu — qty final tetap benar dari RPC setelah submit. Concurrency test 6.2 hanya
> diverifikasi via pgTAP single-connection (row lock + idempotent replay), belum uji
> koneksi paralel nyata — sama seperti catatan Phase 5.4.

## 6.1 Delivery Selection

- [x] Load active DNs.
- [x] Group/filter by supplier.
- [x] Show DN and date.
- [x] Block invalid/cancelled.
- [x] Confirmation summary.

## 6.2 Sequence

- [x] Finalize sequence scope.
- [x] Implement atomic sequence/counter.
- [ ] Concurrency tests.
- [x] Date-source test.
- [x] Reset behavior test if applicable.

## 6.3 Finalize RPC

- [x] Lock session.
- [x] Recalculate exact quantity.
- [x] Validate DN.
- [x] Resolve supplier.
- [x] Allocate sequence.
- [x] Build label reference.
- [x] Snapshot label.
- [x] Create exactly one initial print job.
- [x] Set `print_pending`.
- [x] Audit.
- [x] Idempotent replay.

## 6.4 Formatter

- [x] Supplier Code.
- [x] Part No.
- [x] Qty.
- [x] Item/Box reference.
- [x] Delivery Number.
- [x] Box Name.
- [x] Delivery Date.
- [x] Date formatting tests.
- [x] Long-value tests.

**Gate Phase 6:** parallel finalize menghasilkan satu sequence dan satu print job.
Terverifikasi pgTAP (`015_phase_6_finalize.test.sql`): dua finalize call pada session
sama hanya alokasi satu sequence/satu print job, call kedua idempotent-return.

---

# Phase 7 — QZ Tray dan Zebra ZD220

> **Status 22 Juli 2026:** implementasi kode selesai dan diverifikasi (26 pgTAP
> assertion baru di `016_phase_7_print_rpcs.test.sql`, regresi 014/015 hijau,
> 126 unit test, typecheck/lint/build bersih). Desain terkunci di
> [`docs/superpowers/specs/2026-07-22-phase-7-qz-print-design.md`](docs/superpowers/specs/2026-07-22-phase-7-qz-print-design.md).
> Hardware terkonfirmasi: `ZDesigner ZD220-203dpi ZPL`, 203 dpi, media
> 55×75 mm gap 3 mm, thermal transfer. Update 23 Juli 2026: dev certificate
> RSA-2048/SHA-512 sudah di-generate (openssl, lihat
> [`docs/phase-7/qz-certificate.md`](docs/phase-7/qz-certificate.md)) dan
> `QZ_PRIVATE_KEY`/`QZ_CERTIFICATE` sudah terisi di `.env.local`; sign/verify
> roundtrip dites via Node crypto langsung (cocok dengan parsing
> `route.ts`), hasil valid. Private key PEM sudah dihapus dari disk sesuai
> dokumentasi. Item yang belum dicentang tetap butuh tindakan fisik user:
> install cert ke Trusted Root tiap workstation (`certmgr.msc`), test di
> production domain, lalu drill print 20 sample + failure tests di printer
> nyata.

## 7.1 QZ Client

- [x] Install dependency.
- [x] Connect/disconnect/reconnect.
- [x] Connection indicator.
- [x] Discover exact configured printer.
- [x] No arbitrary fallback.
- [x] Handle permission/warning state.

## 7.2 Signing

- [x] Dev certificate. _(self-signed generated 23 Juli 2026, `.env.local` diisi)_
- [x] Production certificate/license decision. _(self-signed company root, D5)_
- [x] Public certificate endpoint.
- [x] Authenticated signing endpoint.
- [x] Private key server-only.
- [x] Origin validation.
- [x] Rate limiting.
- [x] Audit failures.
- [ ] Test production domain.

## 7.3 ZPL Template

- [x] Confirm media dimensions. _(55×75 mm, gap 3 mm)_
- [x] Confirm DPI. _(203)_
- [x] Build template v1.
- [x] Escape dynamic text.
- [x] Text overflow rules.
- [x] Delivery Number.
- [x] Optional barcode/QR. _(diputuskan skip di v1, spec D7)_
- [ ] Print 20 samples.
- [ ] Verify readability.
- [ ] Verify physical dimensions.

## 7.4 Browser Print Worker

- [x] Claim only target job. _(desain baru: browser tab operator finalizing
      meng-claim print job session miliknya via `claim_print_job` RPC)_
- [x] Set printing.
- [x] Create print attempt.
- [x] Send raw ZPL.
- [x] Mark sent.
- [x] Handle fail.
- [x] Retry same job.
- [x] No new sequence on retry.
- [x] Prevent double-click duplicate.
- [x] Optional operator confirmation. _(diputuskan auto-confirm, spec D3)_

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
Kode + pgTAP selesai; gate fisik menunggu certificate setup dan drill hardware user.

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

# Verifikasi Pengiriman

Diminta setelah tiga belas phase di atas disusun, jadi ia berdiri sendiri dan
bukan bagian dari salah satunya. Spec:
`docs/superpowers/specs/2026-08-21-verifikasi-pengiriman-design.md`.

Memeriksa muatan truk terhadap jadwal kiriman: satu session per kiriman, jadwal
diisi dari file, tiap label box discan dan dicocokkan.

## Bagian 1 — Schedule Delivery

- [x] Tabel `delivery_verification_sessions` dan `delivery_schedule_rows`, RLS
      baca saja, tulis lewat RPC `security definer`.
- [x] `create_delivery_verification_session`, `add_delivery_schedule_rows`,
      `delete_delivery_schedule_row`.
- [x] Halaman `/verifikasi-pengiriman` dengan tombol Tambah Session.
- [x] Parser Excel (`exceljs`) — cari header, toleran variasi ejaan dan
      penulisan Qty, dicocokkan ke dokumen asli.
- [x] Bentuk DO Report: baca kolom Customer, Item No, dan Qty; hanya baris
      berdivisi sheet; baris ber-Qty nol dilewati (`20260828035015`).
- [x] Upload menambah baris, tidak menimpa; nomor baris berlanjut lintas file.
- [ ] Upload PDF — menunggu contoh dokumen asli.

## Bagian 2 — Verifikasi Label

- [x] `verify_delivery_label` membaca ukuran dan Qty dari string QR-nya sendiri;
      `master_items`/`label_boxes` tidak dipakai sama sekali (`20260827094500`).
      View `delivery_schedule_rows_resolved` ikut dibuang bersamanya.
- [x] Pencocokan ukuran mengabaikan spasi di kedua sisi (`20260827103000`).
- [x] Jumlah box per baris diturunkan dari MPQ Sheet: `ceil(Qty Delivery / MPQ)`,
      Qty tiap box harus tepat MPQ atau tepat sisanya (`20260828025319`).
- [x] Ukuran tanpa MPQ tetap masuk jadwal, bertanda "MPQ belum ada", tidak bisa
      discan, dan menahan session tetap terbuka (`20260828035015`).
- [x] MPQ Sheet bisa disunting admin dari `/admin/mpq-sheet` — tambah, edit,
      nonaktifkan, hapus — lewat RPC teraudit; ukuran nonaktif diperlakukan
      jadwal baru seperti belum ada MPQ (`20260828063230`).
- [x] Tombol "Ambil MPQ" mengisi baris jadwal yang MPQ-nya kosong tanpa
      mengunggah ulang filenya; yang sudah punya MPQ tidak ditimpa
      (`20260828070519`).
- [x] Scan lewat kotak scan yang mengirim sendiri setelah ketikan diam 180 ms —
      DS2208 tidak memakai sufiks apa pun (`af9e479`).
- [x] Toast PASS/NOT PASS/DELIVERY OK menyebut sisa box dan Qty yang seharusnya.
- [x] Indikasi scan aktif: cincin kartu, titik berdenyut, hasil terakhir
      bertahan di layar.
- [x] DELIVERY OK bertahan di kartu session, bukan cuma lewat sebagai toast.

## Session

- [x] Lipat/buka kartu session; melipat mematikan pendengar scan.
- [x] Hapus session, ringkasannya ditulis ke `audit_logs` lebih dulu.

## Terbuka

- [ ] Upload PDF — menunggu contoh dokumen asli.
- [ ] Delapan ukuran sheet pada DO Report 21 Agustus 2026 belum ada di MPQ
      Sheet: empat VS-B milik CIPTA MANDIRI (`L=230MM`, `L=195MM`, `L=250MM`,
      `L=255MM`) dan empat VS-A milik INDOPRIMA. Selama itu jadwal yang
      memuatnya tidak bisa DELIVERY OK. Ditambahkan admin dari
      `/admin/mpq-sheet`; yang ditunggu angka MPQ-nya, bukan kodenya.
- [ ] Belum ada jadwal berbox-banyak yang diverifikasi di lantai produksi;
      aturan banyak box baru terbukti di pgTAP.
- [ ] MPQ belum dipakai membatasi Qty per Box saat packing.
- [ ] Migrasi belum jalan di production.

**Gate Verifikasi Pengiriman:** satu kiriman nyata diperiksa dari upload jadwal
sampai DELIVERY OK, memakai label yang benar-benar tercetak.

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
