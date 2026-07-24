import Link from "next/link"
import {
  Building2Icon,
  ClipboardListIcon,
  FileStackIcon,
  PackageIcon,
  PackageSearchIcon,
  PrinterIcon,
  ScanLineIcon,
  ScrollTextIcon,
  TruckIcon,
} from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { requireAdmin } from "@/features/auth/server"
import { createClient } from "@/lib/supabase/server"

type CountResult = { count: number | null; error: { message: string } | null }

async function activeCount(
  supabase: Awaited<ReturnType<typeof createClient>>,
  table: "suppliers" | "products" | "master_items",
): Promise<CountResult> {
  const { count, error } = await supabase
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq("is_active", true)
  return { count, error }
}

async function statusCount(
  supabase: Awaited<ReturnType<typeof createClient>>,
  table:
    | "delivery_numbers"
    | "packing_sessions"
    | "print_jobs"
    | "reprint_requests",
  column: string,
  value: string,
): Promise<CountResult> {
  const { count, error } = await supabase
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq(column, value)
  return { count, error }
}

async function totalCount(
  supabase: Awaited<ReturnType<typeof createClient>>,
  table: "audit_logs" | "packing_sessions" | "print_jobs" | "boxes",
): Promise<CountResult> {
  const { count, error } = await supabase
    .from(table)
    .select("id", { count: "exact", head: true })
  return { count, error }
}

function formatCount(result: CountResult): string {
  if (result.error) return "—"
  return String(result.count ?? 0)
}

type StatItem = {
  label: string
  value: string
  href: string
  icon: React.ComponentType<{ className?: string }>
}

type StatSection = {
  title: string
  description: string
  items: StatItem[]
}

export default async function AdminPage() {
  await requireAdmin()
  const supabase = await createClient()

  const [
    suppliers,
    deliveryNumbers,
    products,
    masterItems,
    boxes,
    scanningSessions,
    readySessions,
    printPending,
    sentToPrinter,
    printFailed,
    reprintPending,
    auditLogs,
  ] = await Promise.all([
    activeCount(supabase, "suppliers"),
    statusCount(supabase, "delivery_numbers", "status", "active"),
    activeCount(supabase, "products"),
    activeCount(supabase, "master_items"),
    totalCount(supabase, "boxes"),
    statusCount(supabase, "packing_sessions", "status", "scanning"),
    statusCount(supabase, "packing_sessions", "status", "ready_to_finalize"),
    statusCount(supabase, "print_jobs", "status", "pending"),
    statusCount(supabase, "print_jobs", "status", "sent"),
    statusCount(supabase, "print_jobs", "status", "failed"),
    statusCount(supabase, "reprint_requests", "status", "requested"),
    totalCount(supabase, "audit_logs"),
  ])

  const anyError = [
    suppliers,
    deliveryNumbers,
    products,
    masterItems,
    boxes,
    scanningSessions,
    readySessions,
    printPending,
    sentToPrinter,
    printFailed,
    reprintPending,
    auditLogs,
  ].some((result) => result.error)

  const sections: StatSection[] = [
    {
      title: "Master data",
      description: "Data referensi aktif yang siap dipakai operator.",
      items: [
        {
          label: "Supplier aktif",
          value: formatCount(suppliers),
          href: "/admin/suppliers",
          icon: Building2Icon,
        },
        {
          label: "Delivery Number aktif",
          value: formatCount(deliveryNumbers),
          href: "/scan",
          icon: TruckIcon,
        },
        {
          label: "Product aktif",
          value: formatCount(products),
          href: "/admin/products",
          icon: PackageSearchIcon,
        },
        {
          label: "Master Item aktif",
          value: formatCount(masterItems),
          href: "/admin/master-items",
          icon: PackageIcon,
        },
        {
          label: "Box terdaftar",
          value: formatCount(boxes),
          href: "/admin/master-items",
          icon: FileStackIcon,
        },
      ],
    },
    {
      title: "Operasional hari berjalan",
      description: "Progress scan dan antrean cetak saat ini.",
      items: [
        {
          label: "Session sedang scanning",
          value: formatCount(scanningSessions),
          href: "/admin",
          icon: ScanLineIcon,
        },
        {
          label: "Session siap finalisasi",
          value: formatCount(readySessions),
          href: "/admin",
          icon: ClipboardListIcon,
        },
        {
          label: "Print job pending",
          value: formatCount(printPending),
          href: "/admin",
          icon: PrinterIcon,
        },
        {
          label: "Print job terkirim",
          value: formatCount(sentToPrinter),
          href: "/admin",
          icon: PrinterIcon,
        },
        {
          label: "Print job gagal",
          value: formatCount(printFailed),
          href: "/admin",
          icon: PrinterIcon,
        },
        {
          label: "Reprint menunggu approval",
          value: formatCount(reprintPending),
          href: "/admin",
          icon: ScrollTextIcon,
        },
      ],
    },
  ]

  return (
    <div className="flex w-full flex-col gap-8">
      <div className="flex flex-col gap-2">
        <p className="text-muted-foreground text-sm font-medium">Admin</p>
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="text-muted-foreground text-sm">
          Ringkasan master data dan status operasional terkini.
        </p>
      </div>

      {anyError ? (
        <Alert variant="destructive">
          <ScrollTextIcon />
          <AlertTitle>Sebagian data tidak dapat dimuat</AlertTitle>
          <AlertDescription>
            Periksa koneksi Supabase atau izin admin. Nilai yang gagal dimuat
            ditampilkan sebagai —.
          </AlertDescription>
        </Alert>
      ) : null}

      {sections.map((section) => (
        <div className="flex flex-col gap-3" key={section.title}>
          <div>
            <h2 className="text-lg font-semibold">{section.title}</h2>
            <p className="text-muted-foreground text-sm">
              {section.description}
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {section.items.map((item) => (
              <Link href={item.href} key={item.label}>
                <Card className="transition-colors hover:bg-muted/50">
                  <CardHeader className="flex-row items-center justify-between">
                    <CardTitle className="text-muted-foreground text-sm font-medium">
                      {item.label}
                    </CardTitle>
                    <item.icon className="text-muted-foreground size-4" />
                  </CardHeader>
                  <CardContent>
                    <p className="text-3xl font-semibold tabular-nums">
                      {item.value}
                    </p>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </div>
      ))}

      <div className="flex flex-col gap-3">
        <div>
          <h2 className="text-lg font-semibold">Audit</h2>
          <p className="text-muted-foreground text-sm">
            Total entri audit log tercatat sejak awal.
          </p>
        </div>
        <Card className="max-w-xs">
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="text-muted-foreground text-sm font-medium">
              Total audit log
            </CardTitle>
            <ScrollTextIcon className="text-muted-foreground size-4" />
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold tabular-nums">
              {formatCount(auditLogs)}
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
