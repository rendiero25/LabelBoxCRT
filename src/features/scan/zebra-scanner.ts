/**
 * Pencocokan perangkat scanner Zebra dari daftar USB yang dilaporkan QZ Tray.
 *
 * Browser tidak bisa mengetahui keyboard mana yang tertancap, dan scanner
 * DS22 dalam mode wedge memang menyamar sebagai keyboard. QZ Tray berjalan
 * native sehingga bisa membaca daftar perangkat; modul ini hanya menafsirkan
 * daftar itu, terpisah dari pemanggilan QZ supaya bisa diuji tanpa
 * perangkat keras.
 *
 * Sumbernya `usb.listDevices`, bukan `hid.listDevices`. Windows mengunci
 * koleksi HID Keyboard, dan scanner dalam mode wedge hanya mengekspos
 * koleksi itu, sehingga tidak pernah muncul di daftar HID. Enumerasi USB
 * tidak lewat jalur tersebut dan tetap melihatnya.
 *
 * QZ melaporkan id sebagai string heksadesimal tanpa awalan 0x, misalnya
 * "05e0", dan tidak menyertakan nama perangkat sama sekali.
 */

export type UsbDevice = {
  hub?: boolean
  manufacturer?: string
  product?: string
  productId?: number | string
  vendorId?: number | string
}

/** Symbol Technologies, dipakai lini scanner Zebra termasuk DS22xx. */
const SYMBOL_VENDOR_ID = 0x05e0
/** Zebra Technologies, dipakai sebagian perangkat Zebra lain. */
const ZEBRA_VENDOR_ID = 0x0a5f

/** Symbol hanya membuat scanner, jadi namanya saja sudah menentukan. */
const SYMBOL_TEXT_PATTERN = /symbol/i
/** Zebra membuat printer juga, jadi namanya harus menyebut scanner. */
const SCANNER_TEXT_PATTERN = /scanner|ds\s*\d{4}/i
const DS22_PATTERN = /ds\s*22/i

/**
 * String dari QZ selalu heksadesimal, dengan atau tanpa awalan 0x. Menebak
 * basis dari isinya akan salah: "1200" adalah 0x1200, bukan seribu dua ratus.
 */
function toDeviceId(value: number | string | undefined): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null
  }
  if (typeof value !== "string") return null

  const trimmed = value.trim().replace(/^0x/i, "")
  if (!trimmed) return null

  const parsed = Number.parseInt(trimmed, 16)
  return Number.isFinite(parsed) ? parsed : null
}

function deviceText(device: UsbDevice): string {
  return `${device.manufacturer ?? ""} ${device.product ?? ""}`
}

/**
 * Vendor 0a5f dipakai Zebra untuk printer maupun scanner, dan pada
 * workstation ini printer ZD220 (0a5f:0164) dilaporkan QZ lebih dulu daripada
 * scanner (05e0:1200). Mencocokkan vendor itu tanpa syarat membuat panel
 * kesiapan menamai printer sebagai scanner, lalu operator percaya scanner
 * siap padahal belum tentu. Karena itu vendor Zebra hanya diterima bila
 * teksnya menyebut scanner; Symbol tetap diterima langsung.
 */
function isZebraDevice(device: UsbDevice): boolean {
  if (device.hub) return false

  const text = deviceText(device)
  if (toDeviceId(device.vendorId) === SYMBOL_VENDOR_ID) return true
  if (SYMBOL_TEXT_PATTERN.test(text)) return true

  const isZebraVendor = toDeviceId(device.vendorId) === ZEBRA_VENDOR_ID
  return (
    (isZebraVendor || /zebra/i.test(text)) && SCANNER_TEXT_PATTERN.test(text)
  )
}

function isDs22(device: UsbDevice): boolean {
  return DS22_PATTERN.test(deviceText(device))
}

/**
 * Mengembalikan perangkat Zebra pertama yang ditemukan, mendahulukan model
 * DS22 bila daftarnya kebetulan membawa teks nama. Perangkat Zebra lain tetap
 * dilaporkan supaya operator melihat ada scanner tertancap, sekalipun bukan
 * model yang diharapkan.
 */
export function findZebraScanner(devices: UsbDevice[]): UsbDevice | null {
  const zebra = devices.filter(
    (device): device is UsbDevice =>
      typeof device === "object" && device !== null && isZebraDevice(device),
  )

  return zebra.find(isDs22) ?? zebra[0] ?? null
}

function formatDeviceId(value: number | string | undefined): string | null {
  const parsed = toDeviceId(value)
  return parsed === null ? null : parsed.toString(16).padStart(4, "0")
}

/**
 * `usb.listDevices` tidak membawa nama perangkat, jadi identitasnya disusun
 * dari pasangan id. Sufiks setelah "::" pada teks dari sumber lain adalah
 * penanda antarmuka USB, bukan bagian nama, sehingga dibuang.
 */
export function describeZebraScanner(device: UsbDevice): string {
  const name = device.product?.trim() || device.manufacturer?.trim()
  if (name) return name.split("::")[0].trim() || name

  const vendorId = formatDeviceId(device.vendorId)
  const productId = formatDeviceId(device.productId)
  if (vendorId && productId) return `Zebra ${vendorId}:${productId}`

  return "Scanner Zebra"
}
