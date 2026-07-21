import Image from "next/image"
import Link from "next/link"
import {
  Building2Icon,
  BoxesIcon,
  ContainerIcon,
  FileSpreadsheetIcon,
  LayoutDashboardIcon,
  Link2Icon,
  PackageSearchIcon,
  TruckIcon,
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
          <SidebarGroup>
            <SidebarGroupLabel>Produk, Box Definition, & Master Item</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild>
                    <Link href="/admin/products">
                      <BoxesIcon />
                      <span>Produk</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild>
                    <Link href="/admin/box-definitions">
                      <ContainerIcon />
                      <span>Box Definition</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild>
                    <Link href="/admin/master-items">
                      <PackageSearchIcon />
                      <span>Master Item</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
          <SidebarGroup>
            <SidebarGroupLabel>Administrasi Lainnya</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild>
                    <Link href="/admin/suppliers">
                      <Building2Icon />
                      <span>Supplier</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild>
                    <Link href="/admin/delivery-numbers">
                      <TruckIcon />
                      <span>Delivery Number</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild>
                    <Link href="/admin/product-mappings">
                      <Link2Icon />
                      <span>Product Mapping</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild>
                    <Link href="/admin/csv-imports">
                      <FileSpreadsheetIcon />
                      <span>CSV Import</span>
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
