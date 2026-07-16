import Link from "next/link"

import { EnrollWorkstationForm } from "@/features/workstations/components/enroll-workstation-form"
import { Button } from "@/components/ui/button"
import { requireOperator } from "@/features/auth/server"

export default async function WorkstationEnrollPage() {
  await requireOperator()

  return (
    <main className="bg-muted/20 grid min-h-svh place-items-center p-6">
      <section className="bg-background w-full max-w-md rounded-xl border p-6 shadow-sm">
        <div className="mb-6 flex flex-col gap-2">
          <h1 className="text-xl font-semibold">Daftarkan workstation</h1>
          <p className="text-muted-foreground text-sm">
            Gunakan kode sekali-pakai dari admin pada browser PC yang memakai
            scanner dan printer.
          </p>
        </div>
        <EnrollWorkstationForm />
        <Button asChild className="mt-4" variant="ghost">
          <Link href="/scan">Kembali ke scan</Link>
        </Button>
      </section>
    </main>
  )
}
