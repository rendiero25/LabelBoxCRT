"use client"

import Link from "next/link"
import type { ReactNode } from "react"

import { SidebarMenuButton, useSidebar } from "@/components/ui/sidebar"

/**
 * Tautan menu sidebar yang menutup sidebarnya sendiri di layar kecil.
 *
 * Di layar lebar sidebar tetap terbuka karena tidak menutupi apa pun. Di layar
 * kecil ia melayang di atas halaman: dibiarkan terbuka, halaman yang baru saja
 * dipilih tertutup oleh menu yang memilihnya, dan operator harus menutupnya
 * sendiri setiap kali berpindah.
 */
export function SidebarNavLink({
  children,
  href,
}: {
  children: ReactNode
  href: string
}) {
  const { isMobile, setOpenMobile } = useSidebar()

  return (
    <SidebarMenuButton
      asChild
      onClick={() => {
        if (isMobile) setOpenMobile(false)
      }}
    >
      <Link href={href}>{children}</Link>
    </SidebarMenuButton>
  )
}
