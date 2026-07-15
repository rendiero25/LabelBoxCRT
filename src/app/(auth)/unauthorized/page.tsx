import { ShieldAlertIcon } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { SignOutButton } from "@/features/auth/components/sign-out-button"

export default function UnauthorizedPage() {
  return (
    <section className="border-border bg-background flex flex-col gap-6 rounded-xl border p-6 shadow-sm sm:p-8">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Akses ditolak</h1>
        <p className="text-muted-foreground text-sm">
          Akun ini tidak memiliki izin untuk membuka halaman tersebut.
        </p>
      </div>
      <Alert variant="destructive">
        <ShieldAlertIcon />
        <AlertTitle>Role tidak sesuai</AlertTitle>
        <AlertDescription>
          Masuk dengan akun yang memiliki role yang tepat, atau hubungi
          administrator.
        </AlertDescription>
      </Alert>
      <div>
        <SignOutButton />
      </div>
    </section>
  )
}
