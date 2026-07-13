# AGENTS — Sistem Scan & Print Label Box

> **Untuk Codex:** file ini sebaiknya diubah namanya menjadi `AGENTS.md` dan diletakkan di root repository agar terdeteksi otomatis.

## 1. Tujuan Proyek

Bangun aplikasi produksi untuk:

1. Membaca QR/2D barcode memakai **Zebra DS2208 2D** melalui USB HID Keyboard.
2. Memvalidasi `Part No`, `Size`, produk, box, layer, dan quantity terhadap **Supabase PostgreSQL**.
3. Menyelesaikan packing session hanya ketika semua kebutuhan box/layer valid.
4. Memilih Delivery Number yang sah.
5. Membuat print job secara atomik.
6. Mencetak label box ke **Zebra ZD220** melalui **QZ Tray + raw ZPL**.
7. Menyediakan:
   - Halaman operator untuk scan dan print.
   - Halaman admin untuk master data, supplier, Delivery Number, box/layer, user, workstation, print job, reprint, dan audit.

Aplikasi di-host di Vercel. Scanner dan printer tetap terhubung ke workstation lokal.

---

## 2. Stack Wajib

- Next.js App Router.
- TypeScript strict.
- Supabase PostgreSQL.
- Supabase Auth.
- `@supabase/ssr`.
- Supabase RLS.
- shadcn/ui.
- Tailwind CSS mengikuti konfigurasi shadcn.
- Zebra DS2208 2D.
- Zebra ZD220.
- QZ Tray.
- Raw ZPL.
- Vercel.
- Vercel Cron hanya untuk housekeeping/reconciliation.
- Unit, integration, E2E, concurrency, security, dan hardware UAT.

Gunakan package manager yang sudah ditentukan project. Jangan mencampur npm, pnpm, yarn, atau bun.

---

## 3. Urutan Sumber Kebenaran

1. `flowsystem.md`.
2. `task.md`.
3. Supabase migrations dan database constraints.
4. Generated Supabase TypeScript types.
5. Implementasi.
6. UI mockup/asumsi developer.

Jangan mengubah business invariant secara diam-diam.

---

## 4. Skill dan Workflow Codex

Gunakan skill berikut bila tersedia:

1. Supabase untuk schema, migrations, Auth, RLS, RPC, advisors, dan verification.
2. `frontend-design` atau `frontend-app-builder` untuk konsep dan implementasi UI.
3. shadcn untuk init, instalasi, dokumentasi, dan komposisi komponen.
4. `impeccable` untuk design critique/polish bila benar-benar tersedia.
5. Systematic debugging untuk bug.
6. Verification-before-completion sebelum menyatakan selesai.

Jika nama skill yang diminta tidak tersedia, gunakan skill terdekat dan dokumentasikan fallback. Jangan mengarang hasil skill.

Sebelum coding:

- Baca ketiga dokumen.
- Inspect repository.
- Cek package manager, Next.js, TypeScript, Tailwind, dan shadcn.
- Verifikasi dokumentasi dependency terbaru.
- Catat open decisions.
- Kerjakan per fase pada `task.md`.

---

## 5. Struktur Modul

```text
src/
├─ app/
│  ├─ (auth)/
│  ├─ (operator)/scan/
│  ├─ admin/
│  ├─ api/qz/certificate/
│  ├─ api/qz/sign/
│  └─ api/cron/
├─ components/
│  ├─ ui/
│  ├─ operator/
│  ├─ admin/
│  └─ shared/
├─ features/
│  ├─ auth/
│  ├─ master-items/
│  ├─ products/
│  ├─ box-templates/
│  ├─ delivery-numbers/
│  ├─ scan/
│  ├─ packing-sessions/
│  ├─ printing/
│  ├─ reprints/
│  └─ audit/
├─ lib/
│  ├─ supabase/
│  ├─ validation/
│  ├─ barcode/
│  ├─ qz/
│  ├─ zpl/
│  └─ security/
└─ types/

supabase/
├─ migrations/
├─ seed.sql
└─ tests/
```

Nama dapat disesuaikan dengan repo, tetapi separation of concerns wajib dipertahankan.

---

## 6. Tabel Inti

Gunakan model relasional, bukan nested JSON besar:

- `profiles`
- `suppliers`
- `delivery_numbers`
- `products`
- `master_items`
- `master_item_products`
- `box_definitions`
- `box_layers`
- `box_layer_requirements`
- `workstations`
- `packing_sessions`
- `packing_session_scans`
- `sequence_counters`
- `print_jobs`
- `print_attempts`
- `reprint_requests`
- `audit_logs`

Detail terdapat di `flowsystem.md`.

---

## 7. Invariant Bisnis

### 7.1 Scan valid

Scan diterima hanya bila:

1. Payload dapat diparse.
2. Ada `label_uid` atau serial unik.
3. Part No ada dan aktif.
4. Size cocok dengan product.
5. Product diizinkan untuk Part No.
6. Product diperlukan oleh box/layer aktif.
7. Quantity layer belum penuh.
8. Label UID belum pernah diterima sesuai scope bisnis.
9. Session menerima scan.
10. Keputusan dibuat server/database.

**Tanpa ID label unik, scan fisik yang sama tidak dapat dideteksi ulang secara andal.** Debounce waktu bukan solusi integritas.

### 7.2 Completion

Session menjadi `ready_to_finalize` hanya jika:

- Semua layer lengkap.
- Semua expected quantity tepat.
- Tidak ada over-quantity.
- Tidak ada invalid scan yang dihitung.
- Box template/version konsisten.

### 7.3 Delivery Number

- Harus aktif.
- Harus terkait supplier valid.
- Tidak boleh lintas supplier.
- Dikunci saat finalisasi.
- Data penting disnapshot ke print job.

### 7.4 Finalisasi atomik

Finalisasi harus dilakukan dalam PostgreSQL transaction/Supabase RPC:

1. Lock session.
2. Revalidasi seluruh quantity.
3. Validasi Delivery Number.
4. Ambil sequence atomik.
5. Bentuk label reference.
6. Buat satu print job.
7. Update session.
8. Append audit.

Jangan melakukan check di client lalu insert terpisah.

### 7.5 Duplicate dan concurrency

- Unique constraint pada `label_uid`.
- Maksimal satu initial print job per session.
- Dua workstation memproses label sama: hanya satu diterima.
- Dua finalize bersamaan: hanya satu print job.
- Conflict memakai domain error, bukan generic 500.

### 7.6 Reprint

- Memerlukan reason.
- Memerlukan supervisor/admin atau approval rule.
- Menyimpan actor, approver, timestamp, workstation, source job, dan nomor reprint.
- Tidak menghapus histori sebelumnya.

---

## 8. Auth dan Authorization

Role minimum:

- `admin`
- `supervisor`
- `operator`

Aturan:

- Jangan memakai user-editable metadata untuk authorization.
- Verifikasi identity di server.
- Jangan mengandalkan `getSession()` sebagai satu-satunya server verification.
- Operator hanya memproses session/workstation yang diizinkan.
- Admin mengelola master data.
- Supervisor menangani exception/reprint.

---

## 9. Supabase Security

### RLS

- Enable RLS pada seluruh tabel exposed.
- Jangan memakai policy `TO authenticated` tanpa row predicate.
- UPDATE membutuhkan `USING` dan `WITH CHECK`.
- Exposed view gunakan `security_invoker = true` bila sesuai.
- Function privileged diletakkan di non-exposed schema bila menggunakan `SECURITY DEFINER`.
- Revoke default execute dari `PUBLIC` untuk function sensitif.
- Function sensitif memverifikasi `auth.uid()` dan permission.
- Jalankan database advisors.

### Keys

- Publishable key boleh di browser dengan RLS yang benar.
- Service role/secret key hanya server.
- QZ private signing key hanya server.
- Jangan log token/key/cookie/private key.

### Input

- Validasi semua input.
- Batasi panjang barcode.
- Tolak control character yang tidak diizinkan.
- Normalisasi deterministik.
- Escape data dinamis sebelum dimasukkan ke ZPL.
- Jangan menyusun SQL dari string input.

### Audit

Audit wajib untuk:

- CRUD master penting.
- Scan valid/invalid/duplicate/over-qty.
- Start/cancel/finalize session.
- Create/claim/send/fail print.
- Reprint request/approval/execution.
- Perubahan workstation/printer.

Audit append-oriented dan tidak punya delete normal dari UI.

---

## 10. Scanner Rules

Target Zebra DS2208:

- USB HID Keyboard.
- Suffix Enter/Carriage Return.
- Keyboard layout sesuai OS.
- Symbology QR/2D yang diperlukan aktif.
- Tidak perlu software Zebra aktif saat produksi.
- 123Scan hanya untuk konfigurasi/troubleshooting.

Implementasi:

- Listener aktif hanya pada halaman scan.
- Jangan menangkap input ketika user sedang mengetik pada input/textarea/select/contenteditable/dialog form.
- Enter menjadi terminator.
- Reset buffer setelah keputusan.
- Satu request scan aktif pada satu waktu di client.
- Server tetap menangani race condition.
- Diagnostic raw payload hanya untuk role berizin.

---

## 11. Printing Rules

### Boundary

Vercel tidak dapat mengakses printer USB lokal.

Alur:

```text
Supabase/Vercel membuat print job
→ browser workstation mengambil job
→ browser terhubung ke QZ Tray lokal
→ QZ Tray mengirim ZPL ke Zebra ZD220
→ browser mencatat print attempt
```

### QZ Tray

- Gunakan signing.
- Signature dibuat server-side.
- Private key tidak boleh ke browser.
- Allowlist production origin.
- Printer dipilih dari mapping workstation, bukan printer pertama.
- Health check:
  - QZ connected.
  - Printer ditemukan.
  - Mapping cocok.
- `qz.print()` resolved berarti diterima bridge/spooler, bukan bukti fisik label pasti keluar.
- Bedakan `sent_to_printer` dan `confirmed` bila bisnis membutuhkan konfirmasi fisik.

### ZPL

- Template versioned.
- Dynamic text di-escape.
- Ukuran media, DPI, orientation, gap, darkness, dan speed diuji di ZD220 nyata.
- Simpan `template_version` pada print job.
- Snapshot job dipakai untuk retry/reprint.

---

## 12. Cron Rules

Vercel Cron hanya untuk:

- Menandai stale session.
- Rekonsiliasi stuck print job.
- Daily report.
- Retention cleanup sesuai kebijakan.
- Alert job gagal.

Cron harus:

- Protected dengan secret.
- Idempotent.
- Aman dipanggil ulang.
- Menggunakan UTC.
- Tidak mencoba mengakses QZ Tray/printer USB.
- Tidak melakukan auto-reprint fisik tanpa workstation aktif.

---

## 13. UI/UX Rules

### Design

- Palette mengikuti logo.
- Jangan mengunci warna tebakan sebelum logo tersedia.
- Gunakan semantic tokens.
- Fokus pada desktop workstation.
- UI minimalis, rapi, dan satu tugas utama.
- Semua state harus jelas dari jarak operator.
- Micro-interaction hanya untuk memperjelas status.
- Respect `prefers-reduced-motion`.

### shadcn

- Init memakai package runner project.
- Jalankan `shadcn info`.
- Gunakan komponen existing sebelum custom markup.
- Form memakai Field/FieldGroup.
- Data tabular memakai Table.
- Gunakan Alert, Empty, Skeleton, Spinner, Badge, Dialog, AlertDialog, Sidebar, Progress, Tooltip, dan Sonner sesuai fungsi.
- Dialog/Sheet/Drawer wajib memiliki title.
- Gunakan semantic class, bukan raw color acak.
- Jangan mengubah source shadcn tanpa alasan terdokumentasi.

### Operator screen

Prioritas:

1. Status aplikasi/QZ/printer.
2. Part No dan Box aktif.
3. Progress per layer.
4. Hasil scan terakhir.
5. CTA finalisasi.
6. Recovery action.

Gunakan bunyi success/fail berbeda dan opsi mute. Jangan menampilkan navigation admin pada operator.

### Admin

- Sidebar konsisten.
- Table dengan search/filter/sort/pagination.
- Inline validation.
- Confirmation untuk tindakan berisiko.
- Data bersejarah dinonaktifkan, bukan dihapus, bila sudah direferensikan.

---

## 14. Domain Error Codes

Gunakan error code konsisten:

- `BARCODE_PARSE_FAILED`
- `LABEL_UID_MISSING`
- `LABEL_ALREADY_SCANNED`
- `PART_NO_NOT_FOUND`
- `PRODUCT_SIZE_NOT_FOUND`
- `PRODUCT_NOT_ALLOWED_FOR_PART`
- `PRODUCT_NOT_REQUIRED_IN_BOX`
- `LAYER_QUANTITY_FULL`
- `SESSION_NOT_ACCEPTING_SCAN`
- `SESSION_NOT_COMPLETE`
- `DELIVERY_NUMBER_INVALID`
- `DELIVERY_SUPPLIER_MISMATCH`
- `PRINT_JOB_ALREADY_EXISTS`
- `QZ_NOT_CONNECTED`
- `PRINTER_NOT_FOUND`
- `PRINT_SEND_FAILED`
- `REPRINT_NOT_AUTHORIZED`

Frontend mengubah code menjadi pesan operator yang jelas. Jangan tampilkan stack trace/database error mentah.

---

## 15. Observability

Log context minimum:

- correlation ID
- user ID
- workstation ID
- session ID
- label UID/hash
- print job ID
- action
- result/error code
- timestamp

Jangan log QR penuh bila mengandung data sensitif.

Dashboard admin minimum:

- Session hari ini.
- Valid/invalid/duplicate scan.
- Box selesai.
- Print success/fail.
- Stuck jobs.
- Reprint count.
- Workstation last seen.

---

## 16. Testing Wajib

### Unit

- Barcode parser.
- Normalisasi.
- Layer assignment.
- Quantity calculation.
- Label reference formatter.
- ZPL escaping.
- Permission helpers.

### Database/RPC

- Valid scan.
- Invalid Part No/Size.
- Product tidak terkait Part No.
- Product tidak ada pada box.
- Over-quantity.
- Duplicate UID.
- Dua scan paralel.
- Dua finalize paralel.
- Delivery/supplier mismatch.
- Reprint permission.

### E2E

- Login operator.
- Scan sampai complete.
- Pilih DN.
- Finalize.
- Print mock.
- Refresh/recovery.
- Admin CRUD.
- Supervisor reprint.

### Hardware UAT

- DS2208 payload + Enter.
- 100 scan beruntun.
- QZ reconnect.
- Printer offline/paused/no media.
- ZD220 actual-size print.
- Workstation restart.
- Network reconnect.

---

## 17. Definition of Done

Selesai hanya jika:

- Acceptance criteria terpenuhi.
- Typecheck, lint, test, dan build berhasil.
- Migration dapat diterapkan dari database bersih.
- RLS/RPC diuji per role.
- Tidak ada secret di client/repo.
- Browser flow diuji.
- Error/recovery diuji.
- Audit tercatat.
- Dokumentasi diperbarui.
- Hardware UAT tersedia untuk fitur scan/print.

---

## 18. Larangan

- Jangan pakai MongoDB/Mongoose.
- Jangan expose service role/private key.
- Jangan mengandalkan client validation.
- Jangan membuat print job tanpa invariant database.
- Jangan membuat nomor urut dari row count/timestamp frontend.
- Jangan hard-code supplier code, Qty 100, printer name, ukuran label, atau sequence scope.
- Jangan menganggap Cron bisa mencetak USB printer.
- Jangan auto-reprint tanpa idempotency/approval.
- Jangan hapus audit history.
- Jangan membuat UI custom bila komponen shadcn cocok.
- Jangan menyatakan selesai tanpa verification.

---

## 19. Open Decisions

1. Format QR nyata.
2. Apakah QR punya `label_uid` unik.
3. Satu scan merepresentasikan berapa unit.
4. “3 produk/5 produk” berarti jumlah unit atau jenis.
5. Scope nomor urut.
6. Makna `1-180526-B101`.
7. Sumber tanggal: delivery date atau print date.
8. Letak Delivery Number pada label.
9. Nama Box mengambil code/name/layer atau kombinasi.
10. Qty 100 berlaku global/per item/per box.
11. Ukuran media, DPI, orientation, gap/black mark.
12. Apakah `sent_to_printer` perlu konfirmasi operator.
13. Retention audit/scan/print.
