import Image from "next/image"
import Link from "next/link"
import { LayoutDashboardIcon } from "lucide-react"

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar"
import { Badge } from "@/components/ui/badge"
import { SignOutButton } from "@/features/auth/components/sign-out-button"
import { requireAdmin } from "@/features/auth/server"

export default async function AdminLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const auth = await requireAdmin()

  return (
    <SidebarProvider>
      <Sidebar>
        <SidebarHeader className="border-b p-4">
          <Image
            src="/logo-crt.png"
            alt="CRT"
            width={112}
            height={42}
            priority
          />
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Administrasi</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild>
                    <Link href="/admin">
                      <LayoutDashboardIcon />
                      <span>Dashboard</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
      </Sidebar>
      <SidebarInset>
        <header className="bg-background flex h-14 items-center gap-3 border-b px-4">
          <SidebarTrigger />
          <p className="font-medium">Admin Label Box</p>
          <Badge className="hidden sm:inline-flex" variant="secondary">
            {auth.profile.display_name}
          </Badge>
          <div className="ml-auto">
            <SignOutButton />
          </div>
        </header>
        <main className="p-6">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  )
}
