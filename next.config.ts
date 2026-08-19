import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  // pdfkit membaca berkas metrik fontnya dari disk dan menyeret fontkit, yang
  // gagal dibundel Turbopack. Dibiarkan sebagai paket Node biasa, ia dimuat
  // dari node_modules saat dijalankan.
  serverExternalPackages: ["pdfkit"],
}

export default nextConfig
