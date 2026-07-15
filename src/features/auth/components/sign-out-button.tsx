import { LogOutIcon } from "lucide-react"

import { signOutAction } from "@/app/(auth)/login/actions"
import { Button } from "@/components/ui/button"

export function SignOutButton() {
  return (
    <form action={signOutAction}>
      <Button size="sm" type="submit" variant="outline">
        <LogOutIcon data-icon="inline-start" />
        Keluar
      </Button>
    </form>
  )
}
