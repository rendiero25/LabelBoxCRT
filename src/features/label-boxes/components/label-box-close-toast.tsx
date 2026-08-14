"use client"

import { useEffect, useRef } from "react"
import { usePathname, useRouter } from "next/navigation"
import { toast } from "sonner"

/**
 * Kabar penutupan verifikasi, dimunculkan di halaman scan.
 *
 * Aksinya berpindah halaman lewat redirect() di server, jadi state suksesnya
 * tidak pernah sampai ke klien dan tidak ada useActionState yang bisa
 * menampilkan tosnya. Ringkasannya karena itu dibawa sebagai query, lalu
 * dihapus dari alamat begitu terbaca: alamat yang menyimpannya akan memunculkan
 * tos yang sama setiap kali halaman ini dibuka ulang atau di-bookmark.
 */
export function LabelBoxCloseToast({
  labelCount,
  verifiedCount,
}: {
  labelCount: number
  verifiedCount: number
}) {
  const pathname = usePathname()
  const router = useRouter()
  const shown = useRef(false)

  useEffect(() => {
    if (shown.current) return
    shown.current = true

    toast.success(
      `Verifikasi ditutup. ${verifiedCount} dari ${labelCount} box terverifikasi.`,
    )
    router.replace(pathname)
  }, [labelCount, pathname, router, verifiedCount])

  return null
}
