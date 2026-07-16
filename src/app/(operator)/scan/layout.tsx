import Image from "next/image"

import { AppStatus } from "@/components/shared/app-status"
import { Badge } from "@/components/ui/badge"
import { SignOutButton } from "@/features/auth/components/sign-out-button"
import { requireOperator } from "@/features/auth/server"
import { requireVerifiedWorkstation } from "@/features/workstations/server"
import { WorkstationHeartbeat } from "@/features/workstations/components/workstation-heartbeat"

export default async function OperatorLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const auth = await requireOperator()
  const workstation = await requireVerifiedWorkstation()

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
            <Badge variant="secondary">{workstation.code}</Badge>
            <Badge variant="secondary">{auth.profile.display_name}</Badge>
            <SignOutButton />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl p-6">{children}</main>
      <WorkstationHeartbeat />
    </div>
  )
}
