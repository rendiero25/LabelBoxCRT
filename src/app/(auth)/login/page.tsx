import Image from "next/image"

import { CircleCheckIcon } from "lucide-react"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { LoginForm } from "@/features/auth/components/login-form"
import { getAuthNotice } from "@/features/auth/credentials"

type LoginPageProps = {
  searchParams: Promise<{ reason?: string }>
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const { reason } = await searchParams
  const notice = getAuthNotice(reason)

  return (
    <section className="border-border bg-background w-full rounded-xl border p-6 shadow-sm sm:p-8">
      <div className="mb-8 space-y-4">
        <Image alt="CRT" height={42} priority src="/logo-crt.png" width={112} />
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            Masuk Label Box
          </h1>
          <p className="text-muted-foreground text-sm">
            Gunakan akun workstation Anda untuk melanjutkan.
          </p>
        </div>
      </div>

      {notice ? (
        <Alert className="mb-5" variant="default">
          <CircleCheckIcon />
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      ) : null}

      <LoginForm />
    </section>
  )
}
