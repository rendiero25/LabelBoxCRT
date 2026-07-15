import { redirect } from "next/navigation"

import {
  getLoginReasonForAuthStatus,
  type AuthStatus,
} from "@/features/auth/credentials"
import { createClient } from "@/lib/supabase/server"
import type { Database } from "@/types/database"

type Profile = Pick<
  Database["public"]["Tables"]["profiles"]["Row"],
  "display_name" | "id" | "is_active" | "role"
>

type IdentifiedAuthContext = {
  userId: string
  email: string | null
  profile: Profile
}

export type AuthContext =
  | { status: Exclude<AuthStatus, "active"> }
  | ({ status: "active" } & IdentifiedAuthContext)

export type ActiveAuthContext = Extract<AuthContext, { status: "active" }>

export async function getVerifiedAuthContext(): Promise<AuthContext> {
  const supabase = await createClient()
  const { data, error } = await supabase.auth.getClaims()
  const claims = data?.claims
  const userId = claims?.sub

  if (error || typeof userId !== "string") {
    return { status: "unauthenticated" }
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, display_name, role, is_active")
    .eq("id", userId)
    .maybeSingle()

  if (profileError || !profile) {
    return { status: "missing-profile" }
  }

  const context: IdentifiedAuthContext = {
    userId,
    email: typeof claims?.email === "string" ? claims.email : null,
    profile,
  }

  if (!profile.is_active) {
    return { status: "inactive" }
  }

  return { status: "active", ...context }
}

export async function requireActiveUser(): Promise<ActiveAuthContext> {
  const context = await getVerifiedAuthContext()

  if (context.status !== "active") {
    redirect(`/login?reason=${getLoginReasonForAuthStatus(context.status)}`)
  }

  return context
}
