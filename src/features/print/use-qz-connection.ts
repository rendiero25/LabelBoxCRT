"use client"

import { useSyncExternalStore } from "react"

import {
  connectQz,
  listPrinters,
  listUsbDevices,
  onQzClosed,
} from "@/features/print/qz-client"
import { findZebraScanner, type UsbDevice } from "@/features/scan/zebra-scanner"

export type QzConnectionStatus =
  "connecting" | "connected" | "disconnected" | "error"

const RECONNECT_DELAYS_MS = [2000, 5000, 10000, 30000]

type QzSnapshot = {
  /**
   * Sebab daftar printer kosong, kalau pembacaannya memang gagal.
   *
   * Dulu kegagalan ini ditelan jadi daftar kosong belaka, dan layarnya
   * menyuruh "pilih printer dulu" — padahal tidak ada yang bisa dipilih.
   * Kegagalan yang paling sering justru tidak kelihatan dari QZ sama sekali:
   * sambungannya hijau, tetapi /api/qz/sign menolak, dan tiap panggilan
   * bertanda tangan sesudahnya gagal diam-diam.
   */
  printerError: string | null
  printers: string[]
  scanner: UsbDevice | null
  status: QzConnectionStatus
}

/**
 * Satu keadaan QZ untuk seluruh halaman, bukan satu per komponen.
 *
 * Halaman verifikasi memasang dua pemakai sekaligus — panel status di header
 * dan kartu cetak. Ketika masing-masing menyimpan daftar printernya sendiri,
 * keduanya bisa berbeda isi: header menemukan G4010 sementara daftar kartu
 * kosong, sehingga resolvePrinter mengembalikan null dan tombol Cetak mati
 * dengan alasan "pilih printer dulu" — padahal printernya sudah dipilih dan
 * terbaca di header. Preferensi printer sudah lama dibagi lewat
 * useSyncExternalStore; status dan daftar printernya sekarang menyusul.
 */
let snapshot: QzSnapshot = {
  printerError: null,
  printers: [],
  scanner: null,
  status: "disconnected",
}

const serverSnapshot: QzSnapshot = {
  printerError: null,
  printers: [],
  scanner: null,
  status: "disconnected",
}

const listeners = new Set<() => void>()
let started = false
let reconnectAttempt = 0
let reconnectTimer: ReturnType<typeof setTimeout> | null = null

function publish(patch: Partial<QzSnapshot>): void {
  snapshot = { ...snapshot, ...patch }
  for (const listener of listeners) listener()
}

async function refreshPrinters(): Promise<void> {
  try {
    publish({ printerError: null, printers: await listPrinters() })
  } catch (error) {
    publish({
      printerError:
        error instanceof Error
          ? error.message
          : "Daftar printer tidak bisa dibaca dari QZ Tray.",
      printers: [],
    })
  }
}

// Enumerasi USB bisa gagal walau QZ terhubung, misalnya ketika Java tidak punya
// izin membaca perangkat. Kegagalan diperlakukan sebagai "tidak ditemukan",
// bukan memutus koneksi QZ.
async function refreshScanner(): Promise<void> {
  try {
    publish({ scanner: findZebraScanner(await listUsbDevices()) })
  } catch {
    publish({ scanner: null })
  }
}

async function connect(): Promise<void> {
  publish({ status: "connecting" })
  try {
    await connectQz()
    reconnectAttempt = 0
    publish({ status: "connected" })
    await refreshPrinters()
    await refreshScanner()
  } catch {
    publish({ status: "error" })
    const delay =
      RECONNECT_DELAYS_MS[
        Math.min(reconnectAttempt, RECONNECT_DELAYS_MS.length - 1)
      ]
    reconnectAttempt += 1
    reconnectTimer = setTimeout(() => void connect(), delay)
  }
}

/**
 * Dijalankan sekali pada pemakai pertama dan dibiarkan hidup sesudahnya:
 * berpindah halaman tidak seharusnya memutus dan menyambung ulang QZ, dan
 * pemakai berikutnya langsung memakai keadaan yang sudah ada.
 */
function start(): void {
  if (started) return
  started = true

  onQzClosed(() => {
    publish({
      printerError: null,
      printers: [],
      scanner: null,
      status: "disconnected",
    })
    reconnectTimer = setTimeout(() => void connect(), 2000)
  })

  void connect()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  start()
  return () => {
    listeners.delete(listener)
  }
}

function getSnapshot(): QzSnapshot {
  return snapshot
}

function getServerSnapshot(): QzSnapshot {
  return serverSnapshot
}

/** Hanya untuk tes: kembalikan modul ke keadaan sebelum ada yang menyambung. */
export function resetQzConnectionForTests(): void {
  if (reconnectTimer) clearTimeout(reconnectTimer)
  reconnectTimer = null
  reconnectAttempt = 0
  started = false
  listeners.clear()
  snapshot = {
    printerError: null,
    printers: [],
    scanner: null,
    status: "disconnected",
  }
}

export function useQzConnection() {
  const current = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  )

  return {
    connect,
    printerError: current.printerError,
    printers: current.printers,
    refreshPrinters,
    refreshScanner,
    scanner: current.scanner,
    status: current.status,
  }
}
