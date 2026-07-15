import Image from "next/image"

import { AppStatus } from "@/components/shared/app-status"
import { SignOutButton } from "@/features/auth/components/sign-out-button"
import { requireActiveUser } from "@/features/auth/server"

export default async function OperatorLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  await requireActiveUser()

  return (
    <div className="bg-muted/20 min-h-svh">
      <header className="bg-background border-b">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-6 py-4">
          <Image
            src="/logo-crt.png"
            alt="CRT"
            width={112}
            height={42}
            priority
          />
          <div className="flex items-center gap-3">
            <AppStatus />
            <SignOutButton />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl p-6">{children}</main>
    </div>
  )
}
