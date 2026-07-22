# Flow System — Scan, Validasi, dan Print Label Box

## 1. Tujuan

Dokumen ini mendefinisikan:

- Struktur data relasional Supabase.
- Flow operator dan admin.
- Validasi Part No, Size, product, box, layer, dan quantity.
- Pemilihan Delivery Number.
- Pembuatan label box.
- Integrasi Zebra DS2208, QZ Tray, dan Zebra ZD220.
- Duplicate prevention, concurrency, reprint, recovery, cron, dan acceptance criteria.

---

## 2. Arsitektur

```text
Zebra DS2208 2D
    │ USB HID Keyboard
    ▼
Next.js Operator Screen
    │
    ├─ Parse QR
    └─ Kirim request scan
            │
            ▼
Supabase PostgreSQL RPC
    ├─ Validasi auth/session
    ├─ Validasi Part No
    ├─ Validasi Size/Product
    ├─ Validasi relasi Product ↔ Part No
    ├─ Validasi requirement Box/Layer
    ├─ Cegah duplicate dan over-quantity
    └─ Simpan scan atomik
            │
            ▼
Semua layer lengkap
    │
    ▼
Pilih Delivery Number
    │
    ▼
RPC Finalize
    ├─ Revalidasi
    ├─ Generate sequence
    ├─ Snapshot label
    └─ Buat Print Job
            │
            ▼
Browser Workstation + QZ Tray
    │ raw ZPL
    ▼
Zebra ZD220
```

---

## 3. Terminologi

- **Master Item:** konfigurasi Part No.
- **Product:** produk yang dikenali terutama dari Size.
- **Box Definition:** template box, contoh `B101`.
- **Layer:** bagian box dengan requirement product dan quantity.
- **Packing Session:** satu proses penyusunan box sampai selesai.
- **Scan Event:** satu label packing yang dipindai.
- **Print Job:** snapshot data label dan payload ZPL.
- **Workstation:** PC/browser dengan scanner, QZ Tray, dan printer.
- **Label UID:** identitas unik label packing.

---

## 4. Model Data Relasional

### 4.1 `profiles`

| Field          | Tipe        | Aturan                      |
| -------------- | ----------- | --------------------------- |
| `id`           | uuid        | PK, referensi auth user     |
| `display_name` | text        | required                    |
| `role`         | text/enum   | admin, supervisor, operator |
| `is_active`    | boolean     | default true                |
| `created_at`   | timestamptz | required                    |
| `updated_at`   | timestamptz | required                    |

### 4.2 `suppliers`

Requirement awal perlu ditambah `supplier_code`, karena kode ini dicetak pada label.

| Field           | Tipe        | Aturan           |
| --------------- | ----------- | ---------------- |
| `id`            | uuid        | PK               |
| `supplier_code` | text        | unique, required |
| `supplier_name` | text        | required         |
| `is_active`     | boolean     | default true     |
| `created_at`    | timestamptz | required         |
| `updated_at`    | timestamptz | required         |

Contoh:

```text
10015
PT Supplier Contoh
```

### 4.3 `delivery_numbers`

| Field             | Tipe        | Aturan                           |
| ----------------- | ----------- | -------------------------------- |
| `id`              | uuid        | PK                               |
| `supplier_id`     | uuid        | FK suppliers                     |
| `delivery_number` | text        | required                         |
| `delivery_date`   | date        | required                         |
| `status`          | text        | draft, active, closed, cancelled |
| `created_by`      | uuid        | FK profiles                      |
| `created_at`      | timestamptz | required                         |

Constraint:

```text
unique(supplier_id, delivery_number)
```

### 4.4 `products`

| Field             | Tipe        | Aturan                     |
| ----------------- | ----------- | -------------------------- |
| `id`              | uuid/text   | PK                         |
| `product_code`    | text        | unique, contoh `tube-0001` |
| `part_name`       | text        | required                   |
| `size`            | text        | required                   |
| `normalized_size` | text        | indexed                    |
| `is_active`       | boolean     | default true               |
| `created_at`      | timestamptz | required                   |
| `updated_at`      | timestamptz | required                   |

Contoh:

```text
tube-0001
tube
VO-B D6x7Pt.L=455
```

Jangan membuat `size` unique global sebelum data nyata membuktikan tidak ada dua produk berbeda dengan size yang sama.

### 4.5 `master_items`

| Field                | Tipe         | Aturan                   |
| -------------------- | ------------ | ------------------------ |
| `id`                 | uuid/text    | PK                       |
| `item_code`          | text         | unique; admin form: auto-generated `mstritem-01`, `mstritem-02`, ... via `create_master_item`, read-only after creation; CSV import: still supplied manually per row |
| `part_no`            | text         | unique, required         |
| `part_name`          | text         | required                 |
| `unit`               | text         | required                 |
| `default_label_qty`  | integer      | default 100, check > 0   |
| `item_sequence_code` | text/integer | definisi perlu dikunci   |
| `is_active`          | boolean      | default true             |
| `created_at`         | timestamptz  | required                 |
| `updated_at`         | timestamptz  | required                 |

Contoh:

```text
dm-0001
3210A-K1Z-NA01-DL
Tube Assy
Pcs
100
```

### 4.6 `master_item_products`

Relasi many-to-many karena satu product dapat berada di banyak Part No.

| Field            | Tipe    | Aturan       |
| ---------------- | ------- | ------------ |
| `id`             | uuid    | PK           |
| `master_item_id` | FK      | master_items |
| `product_id`     | FK      | products     |
| `is_active`      | boolean | default true |

Constraint:

```text
unique(master_item_id, product_id)
```

### 4.7 `box_definitions`

| Field            | Tipe        | Aturan                               |
| ---------------- | ----------- | ------------------------------------ |
| `id`             | uuid        | PK                                   |
| `master_item_id` | FK          | master_items                         |
| `box_code`       | text        | contoh `B101`                        |
| `box_name`       | text        | nama yang dicetak                    |
| `version`        | integer     | default 1                            |
| `is_active`      | boolean     | hanya versi aktif untuk session baru |
| `created_at`     | timestamptz | required                             |
| `updated_at`     | timestamptz | required                             |

Constraint:

```text
unique(master_item_id, box_code, version)
```

Template yang sudah dipakai tidak diedit destruktif. Buat versi baru.

### 4.8 `box_layers`

| Field               | Tipe    | Aturan                 |
| ------------------- | ------- | ---------------------- |
| `id`                | uuid    | PK                     |
| `box_definition_id` | FK      | box_definitions        |
| `layer_no`          | integer | > 0                    |
| `layer_name`        | text    | contoh `Box 1 Layer 1` |
| `sort_order`        | integer | required               |
| `is_active`         | boolean | default true           |

Constraint:

```text
unique(box_definition_id, layer_no)
```

### 4.9 `box_layer_requirements`

| Field          | Tipe    | Aturan     |
| -------------- | ------- | ---------- |
| `id`           | uuid    | PK         |
| `box_layer_id` | FK      | box_layers |
| `product_id`   | FK      | products   |
| `expected_qty` | integer | > 0        |
| `sort_order`   | integer | required   |

Constraint:

```text
unique(box_layer_id, product_id)
```

Contoh:

```text
B101
├─ Layer 1
│  └─ tube-0001 × 3
└─ Layer 2
   └─ tube-0001 × 5
```

Struktur juga mendukung banyak jenis produk pada satu layer.

### 4.11 `packing_sessions`

| Field                | Tipe        | Aturan                          |
| -------------------- | ----------- | ------------------------------- |
| `id`                 | uuid        | PK                              |
| `operator_id`        | uuid        | FK profiles                     |
| `master_item_id`     | FK          | master_items                    |
| `box_definition_id`  | uuid        | FK box_definitions              |
| `delivery_number_id` | uuid        | nullable sampai finalisasi      |
| `status`             | text        | state machine                   |
| `started_at`         | timestamptz | required                        |
| `ready_at`           | timestamptz | nullable                        |
| `finalized_at`       | timestamptz | nullable                        |
| `cancelled_at`       | timestamptz | nullable                        |
| `version`            | integer     | optional optimistic concurrency |
| `created_at`         | timestamptz | required                        |

Status minimum:

```text
draft
scanning
ready_to_finalize
finalizing
print_pending
printing
sent_to_printer
confirmed
print_failed
cancelled
expired
```

### 4.12 `packing_session_scans`

| Field                | Tipe        | Aturan                                 |
| -------------------- | ----------- | -------------------------------------- |
| `id`                 | uuid        | PK                                     |
| `packing_session_id` | uuid        | FK                                     |
| `label_uid`          | text        | required untuk accepted scan           |
| `raw_payload_hash`   | text        | diagnostic/idempotency                 |
| `scanned_part_no`    | text        | snapshot                               |
| `scanned_size`       | text        | snapshot                               |
| `normalized_size`    | text        | snapshot                               |
| `product_id`         | FK          | nullable untuk invalid                 |
| `box_layer_id`       | FK          | nullable untuk invalid                 |
| `result`             | text        | accepted, invalid, duplicate, over_qty |
| `error_code`         | text        | nullable                               |
| `scanned_by`         | uuid        | FK profiles                            |
| `scanned_at`         | timestamptz | required                               |

Scope unique `label_uid` harus diputuskan: global, per Delivery Number, atau scope bisnis lain.

### 4.13 `sequence_counters`

| Field           | Tipe        | Aturan   |
| --------------- | ----------- | -------- |
| `scope_key`     | text        | PK       |
| `current_value` | bigint      | required |
| `updated_at`    | timestamptz | required |

Jika sequence global, PostgreSQL sequence lebih sederhana. Jika reset per tanggal/supplier/DN, gunakan counter row dengan lock.

### 4.14 `print_jobs`

| Field                      | Tipe        | Aturan                                                |
| -------------------------- | ----------- | ----------------------------------------------------- |
| `id`                       | uuid        | PK                                                    |
| `packing_session_id`       | uuid        | FK                                                    |
| `parent_print_job_id`      | uuid        | nullable untuk reprint                                |
| `status`                   | text        | pending, printing, sent, confirmed, failed, cancelled |
| `supplier_code_snapshot`   | text        | required                                              |
| `supplier_name_snapshot`   | text        | required                                              |
| `part_no_snapshot`         | text        | required                                              |
| `part_name_snapshot`       | text        | required                                              |
| `qty_snapshot`             | integer     | required                                              |
| `delivery_number_snapshot` | text        | required                                              |
| `delivery_date_snapshot`   | date        | required                                              |
| `box_code_snapshot`        | text        | required                                              |
| `box_name_snapshot`        | text        | required                                              |
| `sequence_no`              | bigint      | required                                              |
| `label_reference`          | text        | required                                              |
| `template_version`         | text        | required                                              |
| `zpl_payload`              | text        | required                                              |
| `attempt_count`            | integer     | default 0                                             |
| `created_by`               | uuid        | FK                                                    |
| `created_at`               | timestamptz | required                                              |
| `sent_at`                  | timestamptz | nullable                                              |
| `confirmed_at`             | timestamptz | nullable                                              |

Satu session hanya boleh memiliki satu initial print job.

### 4.15 `print_attempts`

| Field                | Tipe        | Aturan       |
| -------------------- | ----------- | ------------ |
| `id`                 | uuid        | PK           |
| `print_job_id`       | uuid        | FK           |
| `attempt_no`         | integer     | required     |
| `printer_name`       | text        | snapshot     |
| `result`             | text        | sent, failed |
| `error_code`         | text        | nullable     |
| `error_message_safe` | text        | nullable     |
| `created_at`         | timestamptz | required     |

### 4.16 `reprint_requests`

| Field                 | Tipe        | Aturan                                  |
| --------------------- | ----------- | --------------------------------------- |
| `id`                  | uuid        | PK                                      |
| `source_print_job_id` | uuid        | FK                                      |
| `requested_by`        | uuid        | FK                                      |
| `reason`              | text        | required                                |
| `status`              | text        | requested, approved, rejected, executed |
| `reviewed_by`         | uuid        | nullable                                |
| `review_note`         | text        | nullable                                |
| `created_at`          | timestamptz | required                                |
| `reviewed_at`         | timestamptz | nullable                                |

### 4.17 `audit_logs`

| Field            | Tipe        | Aturan                |
| ---------------- | ----------- | --------------------- |
| `id`             | bigint/uuid | PK                    |
| `actor_id`       | uuid        | nullable untuk system |
| `action`         | text        | required              |
| `entity_type`    | text        | required              |
| `entity_id`      | text        | nullable              |
| `metadata`       | jsonb       | non-secret            |
| `created_at`     | timestamptz | required              |

---

## 5. Kontrak QR Label Packing

Field minimum:

- `label_uid`
- `part_no`
- `size`

Contoh JSON:

```json
{
  "v": 1,
  "label_uid": "LBL-20260515-000000123",
  "part_no": "3210A-K1Z-NA01-DL",
  "size": "VO-B D6x7Pt.L=455"
}
```

Contoh delimited:

```text
v1|LBL-20260515-000000123|3210A-K1Z-NA01-DL|VO-B D6x7Pt.L=455
```

Pilih satu format dan version-kan parser.

### Hambatan kritis

Jika QR hanya berisi Part No + Size, dua label fisik berbeda akan terlihat identik. Label fisik yang sama juga bisa discan ulang tanpa dapat dibedakan.

**Rekomendasi wajib:** setiap label packing memiliki serial/UID unik.

---

## 6. Normalisasi

### Part No

- Trim.
- Normalize case hanya bila bisnis case-insensitive.
- Jangan menghapus dash/karakter bermakna tanpa keputusan.

### Size

- Trim.
- Normalize whitespace.
- Normalize Unicode.
- Exact normalized match.
- Jangan fuzzy match otomatis di produksi.

Contoh:

```text
" VO-B  D6x7Pt.L=455 "
→ "VO-B D6x7Pt.L=455"
```

---

## 7. Flow Admin Setup

1. Admin login.
2. Buat Supplier:
   - code `10015`
   - supplier name.
3. Buat Product:
   - code `tube-0001`
   - name `tube`
   - size `VO-B D6x7Pt.L=455`.
4. Buat Master Item:
   - `dm-0001`
   - Part No `3210A-K1Z-NA01-DL`
   - Part Name `Tube Assy`
   - Unit `Pcs`
   - default label Qty `100`.
5. Hubungkan Product ke Master Item.
6. Buat Box:
   - code `B101`
   - name.
7. Tambah Layer:
   - Layer 1: tube × 3.
   - Layer 2: tube × 5.
8. Publish template.
9. Buat Delivery Number:
   - supplier
   - No DN
   - tanggal delivery.
10. (Phase 7) Operator memilih printer dari dropdown QZ Tray saat mulai sesi — tidak ada registrasi workstation di admin.

Admin tidak boleh mengaktifkan box bila:

- Tidak ada layer.
- Layer tanpa requirement.
- Product tidak terkait Master Item.
- expected_qty <= 0.
- Duplicate layer number.
- Product/Master Item inactive.

---

## 8. Flow Start Session

1. Operator login.
2. Buka halaman Proses Cetak Label.
3. Health check:
   - Supabase/network.
   - QZ Tray.
   - Printer terpilih (dropdown, bukan mapping server).
4. Operator mulai scan (bisa lebih dari satu session paralel).

### Auto-detect dari scan pertama

1. Scan pertama mengandung Part No dan Size.
2. Sistem menemukan Master Item.
3. Jika hanya satu active Box, pilih otomatis.
4. Jika lebih dari satu, operator memilih Box.
5. Buat Packing Session.
6. Proses scan pertama dalam transaction yang aman.

Alternatif yang lebih eksplisit: operator memilih Part No dan Box sebelum scan.

---

## 9. Flow Validasi Scan

```text
[Scan]
   │
   ▼
[Browser buffer sampai Enter]
   │
   ▼
[Parse payload]
   ├─ gagal → BARCODE_PARSE_FAILED
   ▼
[Check label_uid]
   ├─ kosong → LABEL_UID_MISSING
   ▼
[RPC accept_packing_scan]
   ├─ verify auth/role
   ├─ lock/verify session
   ├─ check duplicate UID
   ├─ lookup Master Item by Part No
   ├─ ensure Part No sama dengan session
   ├─ lookup Product by normalized Size
   ├─ verify Product ↔ Master Item
   ├─ find incomplete matching requirement
   ├─ reject if full/not required
   ├─ insert scan
   ├─ calculate progress
   ├─ change ready state if complete
   └─ append audit
   ▼
[Return result + progress]
```

### Layer assignment

Jika product sama muncul di beberapa layer:

1. Sort layer berdasarkan `sort_order`.
2. Pilih layer pertama yang membutuhkan product dan belum penuh.
3. Setelah penuh, masuk ke layer berikutnya.
4. Scan setelah semua penuh ditolak.
5. Correction manual harus diaudit.

### Contoh B101

```text
Layer 1: tube-0001 × 3
Layer 2: tube-0001 × 5
```

- Scan 1–3 → Layer 1.
- Scan 4–8 → Layer 2.
- Scan ke-9 → ditolak.

---

## 10. UI Hasil Scan

### Valid

Tampilkan:

- `VALID`.
- Product/Size.
- Assigned layer.
- Progress layer.
- Total progress.
- Bunyi success singkat.
- Animasi progress yang tidak menghambat scan berikutnya.

### Invalid

Tampilkan alasan dan tindakan.

Contoh:

```text
Size tidak terdaftar untuk Part No 3210A-K1Z-NA01-DL.
Hubungi admin atau scan label yang benar.
```

### Duplicate

```text
Label ini sudah pernah dipindai.
Scan pertama: 15 Mei 2026 10:31:25.
```

---

## 11. Completion dan Delivery Number

Ketika seluruh requirement lengkap:

1. Session menjadi `ready_to_finalize`.
2. UI berhenti menerima scan normal.
3. Tampilkan summary:
   - Part No.
   - Box.
   - Layer dan quantity.
   - Total accepted.
4. Operator memilih Delivery Number.
5. Hanya DN aktif yang dapat dipilih.
6. Supplier berasal dari DN.
7. Operator menekan `Validasi & Buat Label`.
8. Server menjalankan finalization RPC.

DN dapat difilter/preselect lebih awal untuk UX, tetapi dikunci saat finalisasi.

---

## 12. Finalization RPC

Pseudo-flow:

```sql
begin;

-- verify actor and role
-- lock packing session for update
-- ensure status = ready_to_finalize
-- recalculate all expected vs accepted
-- validate delivery number and supplier
-- obtain atomic sequence
-- build label reference
-- snapshot label fields
-- create one print job
-- set session print_pending
-- append audit

commit;
```

Dua finalize paralel:

- Request pertama sukses.
- Request kedua mendapat `PRINT_JOB_ALREADY_EXISTS`.
- Hanya satu sequence.

---

## 13. Format Label

Field:

1. Supplier Code.
2. Part No.
3. Qty.
4. No Urut Item/Box Reference.
5. Delivery Number.
6. Nama Box.
7. Tanggal Delivery.

Contoh input:

```text
Supplier Code : 10015
Part No       : 3210A-K1Z-NA01-DL
Qty           : 100
Sequence      : 1
Box Code      : B101
Delivery No   : DN-001
Delivery Date : 2026-05-15
```

Requirement memberi contoh:

```text
1-180526-B101
15-mei-2026
```

Terdapat mismatch: `180526` berarti 18 Mei 2026 bila format DDMMYY, sedangkan tanggal tertulis 15 Mei 2026.

### Proposal konsisten

```text
Supplier Code : 10015
Part No       : 3210A-K1Z-NA01-DL
Qty           : 100
Item/Box Ref  : 1-150526-B101
Delivery No   : DN-001
Box Name      : B101 / [box_name]
Delivery Date : 15-May-2026
```

Formula:

```text
{sequence_no}-{delivery_date_DDMMYY}-{box_code}
```

Sequence tidak boleh dibuat dari row count atau timestamp frontend.

---

## 14. ZPL Generation

```text
Print Job Snapshot
    │
    ▼
Versioned ZPL Template
    ├─ escape dynamic text
    ├─ format dates
    ├─ place text/barcode
    └─ validate max length
    ▼
Raw ZPL
```

Template menentukan:

- Width/height.
- DPI.
- Rotation.
- Font.
- Coordinates.
- Barcode/QR.
- Darkness/speed bila diperlukan.
- Template version.

Jangan diam-diam memotong Part No atau Delivery Number.

---

## 15. Flow Print

```text
[print job pending]
       │
       ▼
[Browser claims job]
       │
       ▼
[QZ connected?]
   ├─ no → recoverable failure
   ▼
[Printer ditemukan?]
   ├─ no → PRINTER_NOT_FOUND
   ▼
[Set printing]
       │
       ▼
[qz.print(config, zpl)]
   ├─ reject → print_attempt failed
   ▼
[print_attempt sent]
       │
       ▼
[print job sent_to_printer]
       │
       ├─ optional operator confirmation
       ▼
[session confirmed]
```

`qz.print()` resolved bukan bukti mekanik mutlak label keluar.

Pilihan:

- MVP: `sent_to_printer` dianggap selesai, dengan tombol “Cetak bermasalah”.
- Lebih aman: operator konfirmasi label keluar.
- Advanced: printer status communication bila setup terbukti stabil.

---

## 16. Recovery

### QZ tidak aktif

- Print job tetap sama.
- Tampilkan instruksi membuka QZ.
- `Coba Hubungkan`.
- Resume job yang sama setelah connect.

### Printer tidak ditemukan

- Tampilkan expected printer.
- Operator memilih ulang printer dari dropdown QZ Tray.
- Jangan memilih printer lain otomatis.

### Printer offline/no media

- Catat failed attempt.
- Job tetap recoverable.
- Retry job yang sama.
- Jangan membuat sequence baru.

### Browser refresh

1. Identifikasi user (Supabase Auth).
2. Load semua session aktif milik operator (`scanning`/`ready_to_finalize`).
3. Load pending/printing/sent job per session.
4. Resume UI (list session, lalu detail).
5. Jangan membuat session baru otomatis bila session lama masih terbuka; operator boleh membuka session baru secara paralel.

### Browser/PC restart

State tetap di Supabase. Browser reconnect ke QZ dan resume.

### Network putus setelah scan

Request bisa sudah committed tetapi response hilang.

Solusi:

- Client idempotency key.
- Status lookup sebelum retry.
- Unique `label_uid`.

### Print response hilang

- Query print job/attempt.
- Jangan create job baru.
- Job `printing` terlalu lama masuk review.
- Cron hanya menandai stuck; tidak mencetak.

---

## 17. Reprint

```text
Operator request + reason
      │
      ▼
Supervisor/Admin review
   ├─ reject → audit
   ▼ approve
Buat child print job
      │
      ▼
Print via browser/QZ
      │
      ▼
Audit parent + reprint no
```

Gunakan snapshot print job asli kecuali kebijakan menyatakan data perlu direfresh.

---

## 18. State Machine

### Packing Session

```text
draft
  ↓
scanning
  ├─ cancel → cancelled
  ├─ timeout → expired
  ↓ complete
ready_to_finalize
  ↓ finalize
print_pending
  ↓ claim
printing
  ├─ fail → print_failed
  ↓ qz accepted
sent_to_printer
  ↓ optional confirm
confirmed
```

Retry:

```text
print_failed → print_pending → printing
```

---

## 19. Concurrency

### Dua session scan label sama

- Unique `label_uid`.
- Satu berhasil.
- Satu duplicate/conflict.

### Dua scan cepat

- Client queue satu request.
- Server transaction tetap wajib.

### Dua finalize

- Lock session.
- Unique initial job.
- Atomic sequence.

### Template diubah saat session aktif

- Session menyimpan box definition version.
- Admin membuat versi baru.
- Session lama tetap memakai versi lama.

---

## 20. Halaman

### Auth

- Login.
- Unauthorized.

### Operator

- `/scan`
- Session recovery.
- Finalization summary.
- Print status.
- Reprint request.

### Admin

- Dashboard.
- Master Items.
- Products.
- Product ↔ Part No mapping.
- Box Definitions.
- Layers & Requirements.
- Suppliers.
- Delivery Numbers.
- Users & Roles.
- Packing Sessions.
- Print Jobs.
- Reprint Requests.
- Audit Logs.
- Label Template/Settings.

### Supervisor

- Exception session.
- Reprint approval.
- Stuck print resolution.
- Audit view.

---

## 21. Operator UI

```text
┌──────────────────────────────────────────────────────────────┐
│ Logo | Proses Cetak Label            QZ ●  Printer ●  User   │
├───────────────────────┬──────────────────────────────────────┤
│ Part No & Box         │ Scan Result                          │
│ 3210A-...             │ VALID                               │
│ B101                  │ VO-B D6x7Pt.L=455                   │
│                       │ Assigned: Layer 1                    │
├───────────────────────┼──────────────────────────────────────┤
│ Layer Progress        │ Total Progress                       │
│ Layer 1  3/3          │ 8/8                                  │
│ Layer 2  5/5          │ [Finalize & Select Delivery Number]  │
├───────────────────────┴──────────────────────────────────────┤
│ Last scans / actionable error                               │
└──────────────────────────────────────────────────────────────┘
```

Prinsip:

- Satu tugas utama.
- Fullscreen-friendly.
- Status terlihat dari jarak operator.
- Tidak memakai card berlebihan.
- Tidak mengandalkan warna saja.
- Loading/error/empty state tersedia.

---

## 22. Security Flow

1. Browser memakai Supabase publishable key.
2. RLS membatasi row/action.
3. Sensitive mutation lewat protected route/action atau RPC.
4. Service role dan QZ private key hanya server.
5. Finalize RPC memverifikasi actor.
6. QZ signing endpoint authenticated, origin-checked, dan rate-limited.
7. Cron protected secret.
8. Audit append-only.

Uji abuse:

- Operator mencoba admin action.
- Session ID user lain.
- Cross-operator print claim (needs new design in Phase 7, workstation identity removed).
- Replay finalize.
- Replay scan.
- ZPL injection.
- Supplier/DN mismatch.
- Reprint tanpa approval.

---

## 23. Vercel Cron

Use cases:

| Job                        | Fungsi                             |
| -------------------------- | ---------------------------------- |
| stale-session-check        | Menandai session idle              |
| stuck-print-reconciliation | Menandai job printing terlalu lama |
| daily-operations-summary   | Agregasi statistik                 |
| retention-cleanup          | Cleanup sesuai policy              |
| failed-job-alert           | Alert admin                        |

Aturan:

- UTC.
- Idempotent.
- Protected.
- Tidak melakukan physical print.
- Tidak menandai sent sebagai confirmed tanpa rule/bukti.

---

## 24. Sequence Diagram

```text
Operator      DS2208       Browser       Supabase RPC      QZ Tray       ZD220
   │             │             │               │               │            │
   │ scan QR     │             │               │               │            │
   │────────────►│ HID chars   │               │               │            │
   │             │────────────►│               │               │            │
   │             │   Enter     │               │               │            │
   │             │────────────►│ accept scan   │               │            │
   │             │             │──────────────►│               │            │
   │             │             │               │ validate+save │            │
   │             │             │◄──────────────│ result        │            │
   │◄──────────────────────────│ UI/beep        │               │            │
   │             │             │               │               │            │
   │ ... repeat until complete │               │               │            │
   │             │             │ finalize(DN)  │               │            │
   │             │             │──────────────►│               │            │
   │             │             │               │ transaction   │            │
   │             │             │◄──────────────│ print job+ZPL │            │
   │             │             │──────────────────────────────►│ raw ZPL    │
   │             │             │               │               │───────────►│
   │             │             │◄──────────────────────────────│ accepted   │
   │             │             │ update attempt│               │            │
   │             │             │──────────────►│               │            │
   │◄──────────────────────────│ success        │               │            │
```

---

## 25. Acceptance Criteria

### Master data

- Product dapat terkait ke banyak Master Item.
- Master Item dapat memiliki banyak box version.
- Box memiliki layer terurut.
- Layer memiliki product requirements.
- Invalid configuration tidak dapat diaktifkan.

### Scan

- Part No salah ditolak.
- Size tidak dikenal ditolak.
- Product tidak terkait Part No ditolak.
- Product tidak diperlukan box ditolak.
- Over-quantity ditolak.
- Duplicate label ditolak.
- Assignment layer benar.
- Progress tetap benar setelah refresh.

### Completion

- Finalize disabled sebelum lengkap.
- Delivery Number wajib.
- Supplier valid.
- Finalize menghasilkan satu sequence dan satu print job.
- Label memakai snapshot.

### Print

- Hanya browser/session target yang mencetak job miliknya.
- Printer sesuai pilihan operator (QZ Tray, Zebra ZD220).
- Raw ZPL tercetak melalui QZ.
- Retry tidak membuat sequence baru.
- Semua attempt tercatat.

### Security

- RLS mencegah unauthorized data/action.
- Operator tidak dapat mengubah master.
- Operator tidak dapat reprint tanpa rule.
- Service role/private key tidak terekspos.
- Cron endpoint terlindungi.

---

## 26. Open Decisions

1. QR payload aktual.
2. Label UID unik.
3. Satu scan = berapa unit.
4. “3/5 produk” berarti unit atau jenis.
5. Sequence scope.
6. `1-180526-B101` format final.
7. Tanggal berasal dari Delivery Date atau Print Date.
8. Delivery Number placement.
9. Nama Box final.
10. Qty 100 scope.
11. Ukuran label dan DPI.
12. Supplier ditentukan via DN atau relation lain.
13. Satu DN boleh dipakai berapa session.
14. Physical confirmation diperlukan atau tidak.
15. Label membutuhkan barcode/QR tambahan atau tidak.
