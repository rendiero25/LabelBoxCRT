"use server"

import { redirect } from "next/navigation"

import { getAuthNotice, parseCredentials } from "@/features/auth/credentials"
import type { LoginActionState } from "@/features/auth/form-state"
import { getRoleHomePath } from "@/features/auth/permissions"
import { getVerifiedAuthContext } from "@/features/auth/server"
import { createClient } from "@/lib/supabase/server"

export async function signInAction(
  _previousState: LoginActionState,
  formData: FormData,
): Promise<LoginActionState> {
  const parsed = parseCredentials({
    email: formData.get("email"),
    password: formData.get("password"),
  })

  if ("error" in parsed) {
    return { error: parsed.error }
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithPassword(parsed.credentials)

  if (error) {
    return { error: "Email atau kata sandi tidak valid." }
  }

  const context = await getVerifiedAuthContext()
  if (context.status !== "active") {
    await supabase.auth.signOut({ scope: "local" })

    return {
      error:
        getAuthNotice(
          context.status === "inactive" ? "inactive" : "unauthorized",
        ) ?? "Akun tidak dapat mengakses aplikasi.",
    }
  }

  redirect(getRoleHomePath(context.profile.role))
}

export async function signOutAction() {
  const supabase = await createClient()
  await supabase.auth.signOut({ scope: "local" })
  redirect("/login?reason=signed-out")
}
