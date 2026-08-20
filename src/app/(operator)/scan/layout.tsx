import Image from "next/image"
import Link from "next/link"
import { HouseIcon, LayoutDashboardIcon } from "lucide-react"

import { AppStatus } from "@/components/shared/app-status"
import { Button } from "@/components/ui/button"
import { SignOutButton } from "@/features/auth/components/sign-out-button"
import { isAdminRole } from "@/features/auth/permissions"
import { requireActiveUser } from "@/features/auth/server"

export default async function OperatorLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const auth = await requireActiveUser()

  return (
    <div className="bg-muted/20 min-h-svh">
      <header className="bg-background border-b">
        {/* Dua wilayah: navigasi di kiri, lalu status kesiapan berdampingan
            dengan tombol keluar di kanan. Status berdiri tepat sebelum tombol
            keluar, bukan di tengah header. */}
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-6 py-4">
          <div className="flex flex-wrap items-center gap-1">
            {/* Beranda operator adalah daftar label box, bukan halaman
                sambutan: dari sanalah setiap pekerjaan scan dimulai. Logo
                membawa ke tempat yang sama seperti tombolnya. */}
            <Link
              aria-label="Kembali ke daftar label box"
              className="focus-visible:ring-ring mr-2 rounded-sm focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
              href="/scan"
            >
              {/* h-auto meredam peringatan Next soal rasio: tinggi mengikuti
                  lebar, bukan angka yang dipatok terpisah. */}
              <Image
                alt="CRT"
                className="h-auto"
                height={42}
                priority
                src="/logo-crt.png"
                width={39}
              />
            </Link>
            <Button asChild size="sm" variant="ghost">
              <Link href="/scan">
                <HouseIcon data-icon="inline-start" />
                Halaman awal
              </Link>
            </Button>
            {isAdminRole(auth.profile.role) ? (
              <Button asChild size="sm" variant="ghost">
                <Link href="/admin">
                  <LayoutDashboardIcon data-icon="inline-start" />
                  Ke halaman admin
                </Link>
              </Button>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center justify-end gap-3">
            <AppStatus />
            <SignOutButton />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl p-6">{children}</main>
    </div>
  )
}
