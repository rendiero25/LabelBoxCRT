import { createServerClient } from "@supabase/ssr"
import { cookies } from "next/headers"

import { getPublicSupabaseEnv } from "@/lib/env/public"
import type { Database } from "@/types/database"

export async function createClient() {
  const cookieStore = await cookies()
  const { url, publishableKey } = getPublicSupabaseEnv()

  return createServerClient<Database>(url, publishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options)
          })
        } catch {
          // Server Components cannot write cookies. The root proxy refreshes them.
        }
      },
    },
  })
}
