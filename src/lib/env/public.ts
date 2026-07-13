export type PublicSupabaseEnv = {
  url: string
  publishableKey: string
}

type PublicEnvironment = Record<string, string | undefined>

export function getPublicSupabaseEnv(
  environment: PublicEnvironment = process.env,
): PublicSupabaseEnv {
  const url = environment.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const publishableKey =
    environment.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim()

  if (!url || !publishableKey) {
    throw new Error("Supabase public environment is not configured")
  }

  return { url, publishableKey }
}
