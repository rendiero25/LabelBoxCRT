import type { Database } from "@/types/database"

export type AppRole = Database["public"]["Enums"]["user_role"]

export function hasRequiredRole(
  actualRole: AppRole,
  requiredRole: AppRole,
): boolean {
  return actualRole === "admin" || actualRole === requiredRole
}

export function getRoleHomePath(role: AppRole): "/admin" | "/scan" {
  return role === "admin" ? "/admin" : "/scan"
}
