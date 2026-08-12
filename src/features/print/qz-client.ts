import qz from "qz-tray"

import type { UsbDevice } from "@/features/scan/zebra-scanner"

let securityConfigured = false

function configureSecurity(): void {
  if (securityConfigured) return
  securityConfigured = true

  // qz-tray treats a plain function as a `(resolve, reject)` promise
  // executor (it wraps it in `new Promise(...)`), so the handlers below
  // must use resolver style rather than returning a promise directly.
  qz.security.setCertificatePromise(
    (resolve, reject) => {
      fetch("/api/qz/cert")
        .then((response) => {
          if (!response.ok) throw new Error("QZ certificate unavailable")
          return response.text()
        })
        .then(resolve, reject)
    },
    // Without this, qz-tray resolves a failed fetch with a blank
    // certificate, downgrading the connection to an untrusted prompt.
    { rejectOnFailure: true },
  )

  qz.security.setSignatureAlgorithm("SHA512")
  qz.security.setSignaturePromise((toSign: string) => (resolve, reject) => {
    fetch("/api/qz/sign", {
      body: JSON.stringify({ request: toSign }),
      headers: { "content-type": "application/json" },
      method: "POST",
    })
      .then((response) => {
        if (!response.ok) throw new Error("QZ signing failed")
        return response.json() as Promise<{ signature: string }>
      })
      .then(({ signature }) => resolve(signature), reject)
  })
}

export function isQzConnected(): boolean {
  return qz.websocket.isActive()
}

/**
 * Sambungan yang sedang berlangsung, dibagi seluruh pemanggil.
 *
 * Halaman verifikasi memasang dua useQzConnection sekaligus — panel status di
 * header dan kartu cetak — dan keduanya memanggil connectQz() saat mount.
 * Penjaga isActive() tidak menolong di sini: saat panggilan kedua tiba,
 * socketnya masih dalam perjalanan dan belum aktif, jadi keduanya membuka
 * sambungan sendiri-sendiri. Yang kalah melempar, hooknya jatuh ke status
 * "error", dan tombol Cetak ikut mati walau panel di header hijau.
 */
let connectInFlight: Promise<void> | null = null

export async function connectQz(): Promise<void> {
  configureSecurity()
  if (qz.websocket.isActive()) return

  connectInFlight ??= Promise.resolve(
    qz.websocket.connect({ retries: 2, delay: 1 }),
  ).finally(() => {
    connectInFlight = null
  })

  await connectInFlight
}

export async function disconnectQz(): Promise<void> {
  if (qz.websocket.isActive()) await qz.websocket.disconnect()
}

export async function listPrinters(): Promise<string[]> {
  const printers = await qz.printers.find()
  return Array.isArray(printers) ? printers : [printers]
}

/**
 * Daftar perangkat USB yang terlihat QZ Tray, tanpa hub.
 *
 * Sengaja USB, bukan HID: Windows mengunci koleksi HID Keyboard, dan scanner
 * dalam mode wedge hanya mengekspos koleksi itu, sehingga tidak pernah muncul
 * di `hid.listDevices`. Terbukti pada unit DS2208 di workstation ini — daftar
 * HID hanya memuat keyboard Logitech, sedangkan daftar USB memuat 05e0:1200.
 */
export async function listUsbDevices(): Promise<UsbDevice[]> {
  const devices = await qz.usb.listDevices(false)
  return Array.isArray(devices) ? devices : []
}

export async function sendZpl(
  printerName: string,
  zplPayload: string,
): Promise<void> {
  await sendZplBatch(printerName, [zplPayload])
}

/**
 * Entri cetak mentah: teks ZPL biasa, atau perintah yang membawa byte biner
 * (unggahan font) dan karenanya dikirim sebagai base64.
 */
export type RawPrintEntry = string | { data: string; flavor: "base64" }

/**
 * Satu panggilan qz.print untuk seluruh label. Mengirim label satu per satu
 * membuat QZ meminta persetujuan sebanyak jumlah label, dan operator harus
 * mengklik enam kali untuk satu batch. Urutan array dipertahankan printer,
 * jadi label tetap keluar berurutan sesuai nomor box.
 */
export async function sendZplBatch(
  printerName: string,
  entries: RawPrintEntry[],
): Promise<void> {
  if (entries.length === 0) return

  const config = qz.configs.create(printerName)
  await qz.print(
    config,
    entries.map((entry) => ({
      data: typeof entry === "string" ? entry : entry.data,
      flavor: typeof entry === "string" ? ("plain" as const) : entry.flavor,
      format: "command" as const,
      type: "raw" as const,
    })),
  )
}

/**
 * Cetak lembar HTML ke printer kertas biasa lewat mode pixel QZ.
 *
 * Ukuran halaman dinyatakan eksplisit dan scaleContent dimatikan: kalau QZ
 * dibiarkan menskala isi ke area cetak driver, label 75x55 mm keluar mengecil
 * beberapa persen mengikuti margin printer, dan stiker tidak lagi jatuh pas di
 * potongannya. Margin 0 dipakai karena posisi tiap label sudah dihitung dari
 * tepi kertas di dalam HTML-nya.
 */
export async function sendHtmlSheets(
  printerName: string,
  sheets: string[],
): Promise<void> {
  if (sheets.length === 0) return

  const config = qz.configs.create(printerName, {
    margins: 0,
    orientation: "portrait",
    scaleContent: false,
    size: { height: 297, width: 210 },
    units: "mm",
  })

  await qz.print(
    config,
    sheets.map((sheet) => ({
      data: sheet,
      flavor: "plain" as const,
      format: "html" as const,
      type: "pixel" as const,
    })),
  )
}

// qz-tray's `setClosedCallbacks` is a plain assignment, so registering a
// handler directly would replace any previously registered one. Instead we
// register a single stable dispatcher and fan out to a local Set, letting
// multiple consumers subscribe and unsubscribe independently.
const closedHandlers = new Set<() => void>()
let closedDispatcherRegistered = false

export function onQzClosed(handler: () => void): () => void {
  if (!closedDispatcherRegistered) {
    closedDispatcherRegistered = true
    qz.websocket.setClosedCallbacks(() => {
      for (const registered of closedHandlers) registered()
    })
  }
  closedHandlers.add(handler)
  return () => {
    closedHandlers.delete(handler)
  }
}
