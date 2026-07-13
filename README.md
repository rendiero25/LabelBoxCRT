# Label Box CRT

Aplikasi produksi untuk memvalidasi label produk, menyelesaikan packing box, dan mencetak label box melalui QZ Tray serta Zebra ZD220.

## Prasyarat

- Node.js 20.9 atau lebih baru.
- npm (package manager project ini).
- Docker Desktop bila menjalankan Supabase lokal.

## Menjalankan project

1. Salin `.env.example` menjadi `.env.local` dan isi publishable Supabase values.
2. Jalankan `npm install`.
3. Jalankan `npm run dev`.

Alamat utama:

- `/scan` untuk shell operator.
- `/admin` untuk shell admin.

## Pemeriksaan kualitas

```text
npm run format:check
npm run typecheck
npm run lint
npm test
npm run test:integration
npm run build
```

Workflow Supabase lokal dan migration dijelaskan di `docs/development/supabase.md`.
