import Image from "next/image"
import Link from "next/link"

import { Button } from "@/components/ui/button"

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-svh max-w-3xl flex-col items-center justify-center gap-8 px-6 text-center">
      <Image src="/logo-crt.png" alt="CRT" width={172} height={64} priority />
      <div className="space-y-3">
        <p className="text-muted-foreground text-sm font-medium tracking-widest uppercase">
          Sistem Scan & Print Label Box
        </p>
        <h1 className="text-foreground text-4xl font-semibold tracking-tight">
          Fondasi aplikasi siap dikembangkan
        </h1>
        <p className="text-muted-foreground">
          Pilih area kerja untuk melihat shell aplikasi Phase 1.
        </p>
      </div>
      <div className="flex flex-wrap justify-center gap-3">
        <Button asChild>
          <Link href="/scan">Buka halaman operator</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/admin">Buka halaman admin</Link>
        </Button>
      </div>
    </main>
  )
}
