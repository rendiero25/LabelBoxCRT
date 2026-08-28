type MpqInput = {
  mpqQty: number
  productSize: string
  unit: string
}

/**
 * Batas atas yang sama dengan RPC-nya. Yang sungguh dipakai sekarang tertinggi
 * 10.000, jadi angka ini bukan aturan bisnis melainkan pagar terhadap salah
 * ketik -- 2000000 yang kelebihan nol tidak boleh diam-diam jadi MPQ.
 */
const MAX_MPQ_QTY = 10_000_000

/**
 * Ukuran dan satuan dibakukan di sini persis seperti di RPC-nya: huruf besar,
 * spasi beruntun dirapatkan, ujungnya dibuang. Yang di sini hanya untuk gagal
 * lebih cepat sebelum bolak-balik ke server; yang mengikat tetap RPC-nya.
 */
export function parseMpqInput(
  formData: FormData,
): { data: MpqInput } | { error: string } {
  const productSize = String(formData.get("productSize") ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase()
  const unit = String(formData.get("unit") ?? "")
    .trim()
    .toUpperCase()
  const rawQty = String(formData.get("mpqQty") ?? "").trim()

  if (!productSize) return { error: "Ukuran wajib diisi." }
  if (productSize.length > 100) {
    return { error: "Ukuran maksimal 100 karakter." }
  }

  if (!unit) return { error: "Unit/Box wajib diisi." }
  if (unit.length > 32) return { error: "Unit/Box maksimal 32 karakter." }

  // Pecahan ditolak, bukan dibulatkan: setengah keping tidak punya arti di
  // lapangan, dan membulatkannya diam-diam mengubah angka yang dipakai
  // menghitung jumlah box.
  if (!/^\d+$/.test(rawQty)) {
    return { error: "Qty MPQ harus bilangan bulat." }
  }

  const mpqQty = Number(rawQty)
  if (mpqQty <= 0) return { error: "Qty MPQ harus lebih dari nol." }
  if (mpqQty > MAX_MPQ_QTY) {
    return { error: "Qty MPQ terlalu besar. Periksa lagi angkanya." }
  }

  return { data: { mpqQty, productSize, unit } }
}

export function mpqRpcErrorMessage(message: string): string {
  const messages: Record<string, string> = {
    MPQ_ADMIN_REQUIRED: "Aksi ini hanya tersedia untuk admin aktif.",
    MPQ_INPUT_INVALID: "Data MPQ tidak valid.",
    MPQ_NOT_FOUND: "Ukuran tidak ditemukan.",
    // Ukuran dibandingkan tanpa spasi, jadi "L=60 MM" dan "L=60MM" adalah satu
    // ukuran. Pesannya menyebut itu supaya admin tidak mengira ia mengetik
    // sesuatu yang belum ada.
    MPQ_SIZE_EXISTS:
      "Ukuran ini sudah ada di MPQ Sheet. Spasi tidak membedakan: “L=60 MM” dan “L=60MM” dihitung sama.",
  }

  return messages[message] ?? "Aksi MPQ gagal. Coba lagi atau hubungi admin."
}
