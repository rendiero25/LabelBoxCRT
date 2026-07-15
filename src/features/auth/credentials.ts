export type LoginCredentials = {
  email: string
  password: string
}

export type CredentialParseResult =
  { credentials: LoginCredentials } | { error: string }

export type AuthStatus =
  "unauthenticated" | "missing-profile" | "inactive" | "active"

const MAX_EMAIL_LENGTH = 254
const MAX_PASSWORD_LENGTH = 1024

export function parseCredentials(values: {
  email: unknown
  password: unknown
}): CredentialParseResult {
  const email =
    typeof values.email === "string" ? values.email.trim().toLowerCase() : ""
  const password = typeof values.password === "string" ? values.password : ""

  if (!email || !password) {
    return { error: "Email dan kata sandi wajib diisi." }
  }

  if (
    email.length > MAX_EMAIL_LENGTH ||
    password.length > MAX_PASSWORD_LENGTH ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)
  ) {
    return { error: "Email atau kata sandi tidak valid." }
  }

  return { credentials: { email, password } }
}

export function getAuthNotice(reason: string | undefined): string | null {
  switch (reason) {
    case "inactive":
      return "Akun Anda tidak aktif. Hubungi administrator."
    case "session-expired":
      return "Sesi Anda telah berakhir. Silakan masuk kembali."
    case "signed-out":
      return "Anda telah keluar dari aplikasi."
    case "unauthorized":
      return "Silakan masuk untuk melanjutkan."
    default:
      return null
  }
}

export function getLoginReasonForAuthStatus(status: AuthStatus): string {
  switch (status) {
    case "inactive":
      return "inactive"
    case "missing-profile":
      return "unauthorized"
    case "unauthenticated":
      return "session-expired"
    case "active":
      return "unauthorized"
  }
}
