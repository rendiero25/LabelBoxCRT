import Image from "next/image"
import Link from "next/link"
import {
  Building2Icon,
  BoxesIcon,
  ClipboardCheckIcon,
  FileSpreadsheetIcon,
  LayersIcon,
  LayoutDashboardIcon,
  Link2Icon,
  PackageSearchIcon,
} from "lucide-react"

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar"
import { SidebarNavLink } from "@/components/shared/sidebar-nav-link"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
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
            width={56}
            height={21}
            priority
          />
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Dashboard</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarNavLink href="/admin">
                    <LayoutDashboardIcon />
                    <span>Dashboard</span>
                  </SidebarNavLink>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
          <SidebarGroup>
            <SidebarGroupLabel>Produk, Box, & Master Item</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarNavLink href="/admin/products">
                    <BoxesIcon />
                    <span>Produk</span>
                  </SidebarNavLink>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarNavLink href="/admin/master-items">
                    <PackageSearchIcon />
                    <span>Master Item</span>
                  </SidebarNavLink>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarNavLink href="/admin/mpq-sheet">
                    <LayersIcon />
                    <span>MPQ Sheet</span>
                  </SidebarNavLink>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
          <SidebarGroup>
            <SidebarGroupLabel>Administrasi Lainnya</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarNavLink href="/admin/suppliers">
                    <Building2Icon />
                    <span>Supplier</span>
                  </SidebarNavLink>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarNavLink href="/admin/product-mappings">
                    <Link2Icon />
                    <span>Product Mapping</span>
                  </SidebarNavLink>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarNavLink href="/admin/csv-imports">
                    <FileSpreadsheetIcon />
                    <span>CSV Import</span>
                  </SidebarNavLink>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
      </Sidebar>
      <SidebarInset>
        <header className="bg-background flex h-14 items-center gap-3 border-b px-4">
          <SidebarTrigger />
          <Badge className="hidden sm:inline-flex" variant="secondary">
            {auth.profile.display_name}
          </Badge>
          {/* Kedua halaman operator dinamai sama persis dengan menunya di
              header operator. Sidebar di kiri memuat administrasi; keduanya
              bukan itu, jadi keduanya berdiri di header seperti di sisi
              operator. */}
          <div className="ml-auto flex items-center gap-2">
            <Button asChild size="sm" variant="ghost">
              <Link href="/scan">
                <BoxesIcon data-icon="inline-start" />
                Label Box
              </Link>
            </Button>
            <Button asChild size="sm" variant="ghost">
              <Link href="/verifikasi-pengiriman">
                <ClipboardCheckIcon data-icon="inline-start" />
                Verifikasi Pengiriman
              </Link>
            </Button>
            <SignOutButton />
          </div>
        </header>
        <main className="p-6">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  )
}
