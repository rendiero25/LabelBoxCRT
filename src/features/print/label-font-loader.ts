"use client"

import {
  LABEL_FONT_BOLD,
  LABEL_FONT_REGULAR,
  buildFontUpload,
  type LabelFontUpload,
} from "@/lib/label/font"

/**
 * Berkas font disajikan statis dari /label-fonts, bukan diimpor sebagai modul:
 * isinya dibutuhkan sebagai byte mentah untuk ditanam ke printer, bukan sebagai
 * aset yang dirender browser.
 */
const BOLD_FONT_URL = "/label-fonts/Outfit-Bold.ttf"

const FONT_SOURCES = [
  { name: LABEL_FONT_REGULAR, url: "/label-fonts/Outfit-Regular.ttf" },
  { name: LABEL_FONT_BOLD, url: BOLD_FONT_URL },
]

let cachedUploads: LabelFontUpload[] | null = null
const cachedBytes = new Map<string, Uint8Array>()

async function fetchFontBytes(url: string): Promise<Uint8Array> {
  const cached = cachedBytes.get(url)
  if (cached) return cached

  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Font label ${url} tidak dapat dimuat.`)
  }

  const bytes = new Uint8Array(await response.arrayBuffer())
  cachedBytes.set(url, bytes)
  return bytes
}

/**
 * Perintah ~DY untuk kedua berat font, dirakit sekali per tab. Perintah ini
 * dikirim mendahului label pada panggilan cetak yang sama: printer menyimpan
 * font sampai memorinya dibersihkan, tetapi reset pabrik atau penggantian unit
 * akan menghapusnya, dan label yang merujuk font hilang tercetak kosong.
 * Mengirim ulang tiap kali mencetak membuatnya pulih sendiri.
 */
export async function loadLabelFontUploads(): Promise<LabelFontUpload[]> {
  if (cachedUploads) return cachedUploads

  const uploads = await Promise.all(
    FONT_SOURCES.map(async ({ name, url }) =>
      buildFontUpload(name, await fetchFontBytes(url)),
    ),
  )

  cachedUploads = uploads
  return uploads
}
