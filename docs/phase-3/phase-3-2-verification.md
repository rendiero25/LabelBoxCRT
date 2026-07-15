# Phase 3.2 Verification

Tanggal verifikasi: 15 Juli 2026

## Implementasi Role

- Role aplikasi hanya `admin` dan `operator`, diambil dari `public.profiles.role` setelah identity diverifikasi server-side.
- `requireAdmin()` melindungi seluruh `/admin`.
- `requireOperator()` melindungi seluruh `/scan`.
- `requireRole()` adalah helper permission server yang membandingkan role database dengan role yang diwajibkan.
- Akses role yang salah diarahkan ke `/unauthorized`, yang hanya menawarkan logout dan tidak membocorkan detail permission.
- Login admin mengarah ke `/admin`; login operator mengarah ke `/scan`.
- Sidebar admin hanya memuat navigasi admin. Operator tidak diberi navigasi admin.
- Supervisor tidak diterapkan karena model role yang disetujui hanya admin dan operator; tanggung jawab approval/reprint berada pada admin.

## Verifikasi

| Pemeriksaan | Hasil |
| --- | --- |
| Unit test permission helper | Lulus: admin/operator hanya cocok dengan role yang sama; landing path role benar |
| Full unit test | Lulus: 4 file, 10 test |
| Lint | Lulus |
| Typecheck | Lulus |
| Production build | Lulus; route `/unauthorized` ikut terdeteksi |
| Integration runner | Tidak ada file test; perintah exit 0 |
| E2E browser | Belum dijalankan karena repository dan worktree tidak memiliki `.env.local` untuk public Supabase environment |

Tidak ada perubahan schema atau RLS pada Phase 3.2. Enforcement RLS role dari Phase 2 tetap menjadi lapisan database; guard Phase 3.2 menambahkan pembatasan route dan navigasi di aplikasi server-side.
