/**
 * Pencocokan perangkat scanner Zebra dari daftar HID yang dilaporkan QZ Tray.
 *
 * Browser tidak bisa mengetahui keyboard mana yang tertancap, dan scanner
 * DS22 dalam mode wedge memang menyamar sebagai keyboard. QZ Tray berjalan
 * native sehingga bisa membaca daftar HID; modul ini hanya menafsirkan
 * daftar itu, terpisah dari pemanggilan QZ supaya bisa diuji tanpa
 * perangkat keras.
 *
 * Bentuk data QZ tidak dijamin: vendorId bisa datang sebagai angka, string
 * desimal, atau string heksadesimal, dan sebagian field bisa hilang. Semua
 * pencocokan di sini bertahan terhadap itu.
 */

export type HidDevice = {
  manufacturer?: string
  product?: string
  productId?: number | string
  serial?: string
  vendorId?: number | string
}

/** Symbol Technologies, dipakai lini scanner Zebra termasuk DS22xx. */
const SYMBOL_VENDOR_ID = 0x05e0
/** Zebra Technologies, dipakai sebagian perangkat Zebra lain. */
const ZEBRA_VENDOR_ID = 0x0a5f

const VENDOR_TEXT_PATTERN = /zebra|symbol/i
const DS22_PATTERN = /ds\s*22/i

function toVendorId(value: number | string | undefined): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null
  }
  if (typeof value !== "string") return null

  const trimmed = value.trim()
  if (!trimmed) return null

  const parsed = /^0x/i.test(trimmed)
    ? Number.parseInt(trimmed, 16)
    : Number.parseInt(trimmed, 10)

  return Number.isFinite(parsed) ? parsed : null
}

function deviceText(device: HidDevice): string {
  return `${device.manufacturer ?? ""} ${device.product ?? ""}`
}

function isZebraDevice(device: HidDevice): boolean {
  const vendorId = toVendorId(device.vendorId)
  if (vendorId === SYMBOL_VENDOR_ID || vendorId === ZEBRA_VENDOR_ID) return true
  return VENDOR_TEXT_PATTERN.test(deviceText(device))
}

function isDs22(device: HidDevice): boolean {
  return DS22_PATTERN.test(deviceText(device))
}

/**
 * Mengembalikan perangkat Zebra pertama yang ditemukan, mendahulukan model
 * DS22 bila ada. Perangkat Zebra lain tetap dilaporkan supaya operator
 * melihat bahwa ada scanner tertancap, sekalipun bukan model yang diharapkan.
 */
export function findZebraScanner(devices: HidDevice[]): HidDevice | null {
  const zebra = devices.filter(
    (device): device is HidDevice =>
      typeof device === "object" && device !== null && isZebraDevice(device),
  )

  return zebra.find(isDs22) ?? zebra[0] ?? null
}

/**
 * Windows melaporkan unit DS2208 di workstation ini sebagai
 * "Symbol Bar Code Scanner::EA" — sufiks setelah "::" itu penanda antarmuka
 * USB, bukan bagian nama perangkat, jadi dibuang agar baris status terbaca
 * dari jarak operator.
 */
export function describeZebraScanner(device: HidDevice): string {
  const name = device.product?.trim() || device.manufacturer?.trim()
  if (!name) return "Scanner Zebra"
  return name.split("::")[0].trim() || name
}
