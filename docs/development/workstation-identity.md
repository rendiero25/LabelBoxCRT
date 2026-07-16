# Workstation Identity

## Alur

1. Admin mendaftarkan kode workstation, nama printer Windows persis, model printer/scanner, dan operator yang ditugaskan.
2. Sistem membuat workstation `pending` dan satu kode enrollment acak, sekali pakai, berlaku 24 jam.
3. Operator yang ditugaskan membuka `/workstation/enroll` pada browser PC target. Kode ditukar menjadi token perangkat acak.
4. Token perangkat hanya tersimpan dalam cookie `HttpOnly`, `SameSite=Strict`, dan tidak pernah di-return ke UI atau disimpan di `localStorage`.
5. Admin menyetujui workstation setelah browser terdaftar. Hanya workstation `approved`, aktif, token-valid, dan assignment operator-valid yang lulus heartbeat serta boleh membuka `/scan`.

## Keamanan

- Database hanya menyimpan hash SHA-256 token; kode enrollment dan token perangkat tidak tersimpan plaintext.
- Enrollment dan device credential berada pada schema `private`, tanpa privilege browser.
- RPC di `public` memakai `SECURITY DEFINER`, search path terkunci, role server diperiksa dari `profiles`, dan `EXECUTE` hanya diberikan ke `authenticated`.
- Menonaktifkan workstation mencabut token perangkat dan membatalkan enrollment terbuka.
- Heartbeat berjalan saat halaman scan dibuka dan setiap 60 detik. Gagal heartbeat tidak mengungkap detail token.

## Batasan

Token browser membuktikan browser telah didaftarkan dan disetujui, bukan attestation hardware fisik. QZ Tray/printer health check tetap dilakukan pada Phase 7. Scanner/print RPC wajib menggunakan helper workstation yang sama pada Phase 5 dan Phase 7.
