import type { Database } from "@/types/database"

export type AppRole = Database["public"]["Enums"]["user_role"]

/**
 * Peran operator sudah dihapus: alur scan dan label box terbuka untuk setiap
 * profil aktif. Yang tersisa hanya pembeda admin, dipakai untuk mengunci
 * area master data.
 */
export function isAdminRole(role: AppRole): boolean {
  return role === "admin"
}

export function getRoleHomePath(role: AppRole): "/admin" | "/scan" {
  return role === "admin" ? "/admin" : "/scan"
}
