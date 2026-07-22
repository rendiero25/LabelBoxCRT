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
    <section className="w-full max-w-[22rem]">
      <div className="mb-8 space-y-4">
        <div className="space-y-1">
          <h1 className="text-5xl leading-[0.98] font-semibold text-[#15222b]">
            Masuk ke workspace.
          </h1>
          <p className="text-muted-foreground text-sm">
            Gunakan akun Anda untuk melanjutkan.
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
