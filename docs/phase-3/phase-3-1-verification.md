# Phase 3.1 Verification

Tanggal verifikasi: 15 Juli 2026

## Implementasi

- Login email dan kata sandi memakai `signInWithPassword`.
- Logout menghapus sesi lokal lalu mengarahkan ke `/login?reason=signed-out`.
- Layout `/scan` dan `/admin` memerlukan identity valid dan profil aktif.
- Identity server-side diverifikasi dengan `auth.getClaims()`, bukan `getSession()`.
- Server membaca profil sendiri untuk membedakan akun aktif, nonaktif, atau profil yang tidak ada.
- Session tanpa claims valid diarahkan ke `/login?reason=session-expired`.
- Akun nonaktif dapat membaca status profil sendiri saja untuk keputusan aplikasi; tetap tidak dapat membaca master data.

## Database Supabase

- Migrasi hosted: `20260714083916_phase_3_auth_profile_self_visibility`.
- Riwayat migration hosted berurutan dengan `20260714065242_phase_2_schema`.
- Cek RLS terarah dijalankan di dalam transaksi yang di-rollback: profil operator sementara dibuat nonaktif, berhasil membaca `is_active = false` pada profil sendiri, dan melihat `supplier_count = 0`.
- Security advisor tidak melaporkan temuan schema/RLS baru. Peringatan yang tersisa adalah `auth_leaked_password_protection`; ini adalah konfigurasi Auth tingkat project, bukan regresi migrasi Phase 3.1.

## Verifikasi Aplikasi

| Pemeriksaan | Hasil |
| --- | --- |
| Unit test | Lulus: 3 file, 8 test |
| Lint | Lulus |
| Typecheck | Lulus |
| Production build | Lulus |
| Integration test | Tidak ada file test; perintah exit 0 |
| E2E login nyata | Belum dijalankan: worktree tidak memiliki `.env.local`, sehingga proxy sengaja menolak request tanpa public Supabase environment |

Build dilakukan dengan akses jaringan agar Next.js dapat mengambil font Outfit dari Google Fonts. Build mengeluarkan peringatan non-blocking tentang root Turbopack karena repository menggunakan linked worktree dengan lockfile sendiri.
