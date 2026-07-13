# Branding Gate

Status: `READY — LOGO AND TYPOGRAPHY PROVIDED`

## Aset dan arah yang disetujui

- Logo: `docs/Logo CRT.png`, 900 × 960 px.
- Typography: Google Font **Outfit**.
- Warna dominan hasil ekstraksi pixel: red `#FF0404`/`#FF0606`, blue
  `#1212FF`, black `#020202`, dan charcoal `#1C1C1C`.

## Semantic token direction

- Primary UI memakai red turunan `#B91C1C` agar foreground putih mencapai
  contrast 6.47:1; warna logo mentah `#FF0404` hanya 3.98:1 terhadap putih.
- Secondary/info memakai blue turunan `#1D4ED8` dengan foreground putih,
  contrast 6.70:1. Blue logo mentah `#1212FF` tetap boleh dipakai pada aset logo.
- Neutral foreground memakai charcoal `#1C1C1C` dengan background putih,
  contrast 17.04:1.
- Success memakai `#166534`, warning memakai `#854D0E`, destructive memakai
  primary red gelap; semua status juga wajib memiliki icon dan label teks.
- Implementasi memakai semantic token shadcn/Tailwind, bukan raw color pada
  komponen.
- State success, warning, destructive, info, dan neutral harus tetap dapat
  dibedakan melalui icon, label teks, dan contrast—bukan warna saja.
- Outfit digunakan untuk content dan UI chrome dengan fallback sans-serif.

## Review implementasi nanti

1. Ekstrak candidate primary, secondary, dan neutral dari file sumber resmi.
2. Buat pasangan foreground/background untuk light dan dark bila dark mode
   memang diperlukan.
3. Uji WCAG contrast untuk body text, large text, focus indicator, dan status.
4. Review tampilan operator dari jarak kerja normal dan dalam kondisi pabrik.
5. Catat token final dan approval tanpa mengubah source shadcn secara sembarang.

| Peran                  | Nama                        | Tanggal    | Status                      |
| ---------------------- | --------------------------- | ---------- | --------------------------- |
| Brand/business owner   | Rendy                       | 2026-07-13 | Approved                    |
| UI/UX                  | —                           | —          | Pending                     |
| Accessibility reviewer | Codex (token contrast only) | 2026-07-13 | Partial; browser QA pending |
