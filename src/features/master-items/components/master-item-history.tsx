"use client"

import { useMemo, useState, type ReactNode } from "react"
import {
  ArrowUpIcon,
  ChevronRightIcon,
  FilterIcon,
  HistoryIcon,
  PrinterIcon,
  ScanLineIcon,
  SearchIcon,
} from "lucide-react"

import type {
  LabelBoxStatus,
  MasterItemHistoryRow,
  PrintJobStatus,
  ScanResult,
} from "@/features/master-items/history"
import { PaginationControls } from "@/components/shared/pagination-controls"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

const PAGE_SIZE = 25

/**
 * Status cetak sebuah box diringkas dari job cetaknya, bukan dibaca dari satu
 * kolom: satu box bisa punya beberapa job karena cetak ulang, dan yang menjawab
 * "label ini sudah keluar atau belum" adalah job terakhirnya.
 */
type PrintSummary = {
  label: string
  lastAt: string | null
  reprints: number
  status: PrintJobStatus | "none"
  tone: BadgeTone
}

type BadgeTone = "danger" | "muted" | "neutral" | "ok" | "warn"

const PRINT_STATUS_LABEL: Record<PrintJobStatus, string> = {
  cancelled: "Dibatalkan",
  confirmed: "Terkirim",
  failed: "Gagal",
  pending: "Menunggu",
  printing: "Mencetak",
  sent: "Terkirim ke printer",
}

const PRINT_STATUS_TONE: Record<PrintJobStatus, BadgeTone> = {
  cancelled: "muted",
  confirmed: "ok",
  failed: "danger",
  pending: "neutral",
  printing: "warn",
  sent: "ok",
}

const SCAN_RESULT_LABEL: Record<ScanResult, string> = {
  accepted: "Diterima",
  duplicate: "Duplikat",
  invalid: "Tidak valid",
  over_qty: "Kelebihan qty",
}

const SCAN_RESULT_TONE: Record<ScanResult, BadgeTone> = {
  accepted: "ok",
  duplicate: "warn",
  invalid: "danger",
  over_qty: "warn",
}

const LABEL_STATUS_LABEL: Record<LabelBoxStatus, string> = {
  generated: "Belum diverifikasi",
  verified: "Terverifikasi",
}

const SORT_OPTIONS = {
  boxNumber: "Nomor box",
  newest: "Terbaru",
  oldest: "Terlama",
  printedLast: "Terakhir dicetak",
} as const

type SortKey = keyof typeof SORT_OPTIONS

/**
 * Nada warna dipetakan ke token tema, bukan ke warna mentah, supaya status
 * terbaca sama di mode terang maupun gelap. Hanya status yang butuh perhatian
 * yang diberi warna; sisanya abu-abu supaya yang merah benar-benar menonjol.
 */
function StatusBadge({
  children,
  tone,
}: {
  children: ReactNode
  tone: BadgeTone
}) {
  if (tone === "danger") return <Badge variant="destructive">{children}</Badge>
  if (tone === "ok")
    return (
      <Badge className="bg-primary/10 text-primary" variant="outline">
        {children}
      </Badge>
    )
  if (tone === "warn")
    return (
      <Badge className="text-foreground border-foreground/30" variant="outline">
        {children}
      </Badge>
    )
  if (tone === "muted")
    return (
      <Badge className="text-muted-foreground" variant="ghost">
        {children}
      </Badge>
    )
  return <Badge variant="secondary">{children}</Badge>
}

function formatDate(value: string | null): string {
  if (!value) return "—"
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return parsed.toLocaleDateString("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  })
}

function formatDateTime(value: string | null): string {
  if (!value) return "—"
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return parsed.toLocaleString("id-ID", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
    year: "numeric",
  })
}

function summarisePrint(row: MasterItemHistoryRow): PrintSummary {
  if (row.printJobs.length === 0) {
    return {
      label: "Belum dicetak",
      lastAt: null,
      reprints: 0,
      status: "none",
      tone: "muted",
    }
  }

  const latest = row.printJobs.reduce((newest, job) =>
    job.createdAt.localeCompare(newest.createdAt) > 0 ? job : newest,
  )

  return {
    label: PRINT_STATUS_LABEL[latest.status],
    lastAt: latest.confirmedAt ?? latest.sentAt ?? latest.createdAt,
    reprints: row.printJobs.filter((job) => job.isReprint).length,
    status: latest.status,
    tone: PRINT_STATUS_TONE[latest.status],
  }
}

export function MasterItemHistoryView({
  rows,
}: {
  rows: MasterItemHistoryRow[]
}) {
  const [search, setSearch] = useState("")
  const [deliveryFilter, setDeliveryFilter] = useState("all")
  const [labelFilter, setLabelFilter] = useState<"all" | LabelBoxStatus>("all")
  const [printFilter, setPrintFilter] = useState<
    "all" | PrintJobStatus | "none"
  >("all")
  const [sortKey, setSortKey] = useState<SortKey>("newest")
  const [page, setPage] = useState(1)
  const [expanded, setExpanded] = useState<string | null>(null)

  const summaries = useMemo(() => {
    const map = new Map<string, PrintSummary>()
    for (const row of rows) map.set(row.labelBoxId, summarisePrint(row))
    return map
  }, [rows])

  const deliveryNumbers = useMemo(
    () => [...new Set(rows.map((row) => row.deliveryNumber))].sort(),
    [rows],
  )

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase()

    const filtered = rows.filter((row) => {
      if (deliveryFilter !== "all" && row.deliveryNumber !== deliveryFilter) {
        return false
      }
      if (labelFilter !== "all" && row.labelStatus !== labelFilter) return false
      if (printFilter !== "all") {
        const summary = summaries.get(row.labelBoxId)
        if (summary?.status !== printFilter) return false
      }
      if (!needle) return true

      // Pencarian menyapu sampai ke nomor part yang discan dan nama printer:
      // pertanyaan admin sering berangkat dari salah satu keduanya, bukan dari
      // nomor box yang justru paling jarang diingat.
      return (
        row.boxNumber.toLowerCase().includes(needle) ||
        row.deliveryNumber.toLowerCase().includes(needle) ||
        row.lotNo.toLowerCase().includes(needle) ||
        row.scans.some((scan) =>
          scan.scannedPartNo.toLowerCase().includes(needle),
        ) ||
        row.printJobs.some(
          (job) =>
            job.labelReference.toLowerCase().includes(needle) ||
            job.attempts.some((attempt) =>
              attempt.printerName.toLowerCase().includes(needle),
            ),
        )
      )
    })

    const sorted = [...filtered]
    sorted.sort((first, second) => {
      if (sortKey === "boxNumber") {
        return first.boxNumber.localeCompare(second.boxNumber, "id", {
          numeric: true,
        })
      }
      if (sortKey === "oldest") {
        return first.batchCreatedAt.localeCompare(second.batchCreatedAt)
      }
      if (sortKey === "printedLast") {
        const firstAt = summaries.get(first.labelBoxId)?.lastAt ?? ""
        const secondAt = summaries.get(second.labelBoxId)?.lastAt ?? ""
        return secondAt.localeCompare(firstAt)
      }
      return second.batchCreatedAt.localeCompare(first.batchCreatedAt)
    })

    return sorted
  }, [
    deliveryFilter,
    labelFilter,
    printFilter,
    rows,
    search,
    sortKey,
    summaries,
  ])

  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE))
  const currentPage = Math.min(page, pageCount)
  const pageRows = visible.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE,
  )

  const totals = useMemo(() => {
    let printed = 0
    let verified = 0
    let failed = 0
    for (const row of rows) {
      if (row.labelStatus === "verified") verified += 1
      const summary = summaries.get(row.labelBoxId)
      if (summary && summary.status !== "none") printed += 1
      if (summary?.status === "failed") failed += 1
    }
    return { failed, printed, verified }
  }, [rows, summaries])

  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed py-16 text-center">
        <HistoryIcon className="text-muted-foreground size-6" />
        <div className="flex flex-col gap-1">
          <p className="font-medium">Belum ada riwayat</p>
          <p className="text-muted-foreground mx-auto max-w-md text-sm">
            Riwayat terisi setelah Master Item ini dipakai pada batch label box:
            tiap box yang dicetak, discan, dan diverifikasi tercatat di sini.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <dl className="grid grid-cols-2 gap-x-8 gap-y-1 sm:flex sm:flex-wrap sm:gap-x-10">
        <HistoryTotal label="Label box" value={rows.length} />
        <HistoryTotal label="Sudah dicetak" value={totals.printed} />
        <HistoryTotal label="Terverifikasi" value={totals.verified} />
        <HistoryTotal label="Cetak gagal" value={totals.failed} />
      </dl>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="relative lg:max-w-xs lg:flex-1">
          <SearchIcon className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <Input
            aria-label="Cari riwayat"
            className="pl-9"
            onChange={(event) => {
              setSearch(event.target.value)
              setPage(1)
            }}
            placeholder="Box, delivery, lot, part no, printer"
            value={search}
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <FilterMenu
            label="Delivery"
            onChange={(next) => {
              setDeliveryFilter(next)
              setPage(1)
            }}
            options={[
              { label: "Semua delivery", value: "all" },
              ...deliveryNumbers.map((number) => ({
                label: number,
                value: number,
              })),
            ]}
            value={deliveryFilter}
          />
          <FilterMenu
            label="Verifikasi"
            onChange={(next) => {
              setLabelFilter(next as "all" | LabelBoxStatus)
              setPage(1)
            }}
            options={[
              { label: "Semua status", value: "all" },
              { label: LABEL_STATUS_LABEL.verified, value: "verified" },
              { label: LABEL_STATUS_LABEL.generated, value: "generated" },
            ]}
            value={labelFilter}
          />
          <FilterMenu
            label="Cetak"
            onChange={(next) => {
              setPrintFilter(next as "all" | PrintJobStatus | "none")
              setPage(1)
            }}
            options={[
              { label: "Semua cetak", value: "all" },
              ...Object.entries(PRINT_STATUS_LABEL).map(([value, label]) => ({
                label,
                value,
              })),
              { label: "Belum dicetak", value: "none" },
            ]}
            value={printFilter}
          />
          <FilterMenu
            icon="sort"
            label="Urutkan"
            onChange={(next) => {
              setSortKey(next as SortKey)
              setPage(1)
            }}
            options={Object.entries(SORT_OPTIONS).map(([value, label]) => ({
              label,
              value,
            }))}
            value={sortKey}
          />
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8" />
                <TableHead>Box</TableHead>
                <TableHead>Delivery</TableHead>
                <TableHead>Tgl kirim</TableHead>
                <TableHead>Lot No</TableHead>
                <TableHead className="text-right">Set / Box</TableHead>
                <TableHead>Verifikasi</TableHead>
                <TableHead className="text-right">Scan</TableHead>
                <TableHead>Cetak</TableHead>
                <TableHead>Terakhir dicetak</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pageRows.length === 0 ? (
                <TableRow>
                  <TableCell
                    className="text-muted-foreground py-10 text-center"
                    colSpan={10}
                  >
                    Tidak ada riwayat yang cocok dengan filter ini.
                  </TableCell>
                </TableRow>
              ) : (
                pageRows.map((row) => {
                  const summary = summaries.get(row.labelBoxId)
                  const isOpen = expanded === row.labelBoxId
                  const accepted = row.scans.filter(
                    (scan) => scan.result === "accepted",
                  ).length

                  return (
                    <HistoryRow
                      accepted={accepted}
                      isOpen={isOpen}
                      key={row.labelBoxId}
                      onToggle={() =>
                        setExpanded(isOpen ? null : row.labelBoxId)
                      }
                      row={row}
                      summary={summary}
                    />
                  )
                })
              )}
            </TableBody>
          </Table>
        </div>
        <PaginationControls
          currentPage={currentPage}
          onPageChange={setPage}
          pageCount={pageCount}
          totalItems={visible.length}
        />
      </div>
    </div>
  )
}

function HistoryTotal({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="text-lg font-semibold tabular-nums">{value}</dd>
    </div>
  )
}

function FilterMenu({
  icon,
  label,
  onChange,
  options,
  value,
}: {
  icon?: "sort"
  label: string
  onChange: (value: string) => void
  options: { label: string; value: string }[]
  value: string
}) {
  const active = options.find((option) => option.value === value)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="outline">
          {icon === "sort" ? (
            <ArrowUpIcon data-icon="inline-start" />
          ) : (
            <FilterIcon data-icon="inline-start" />
          )}
          {active && active.value !== "all" ? active.label : label}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-72 overflow-y-auto">
        <DropdownMenuLabel>{label}</DropdownMenuLabel>
        <DropdownMenuRadioGroup onValueChange={onChange} value={value}>
          {options.map((option) => (
            <DropdownMenuRadioItem key={option.value} value={option.value}>
              {option.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function HistoryRow({
  accepted,
  isOpen,
  onToggle,
  row,
  summary,
}: {
  accepted: number
  isOpen: boolean
  onToggle: () => void
  row: MasterItemHistoryRow
  summary: PrintSummary | undefined
}) {
  return (
    <>
      <TableRow
        aria-expanded={isOpen}
        className="cursor-pointer"
        onClick={onToggle}
      >
        <TableCell>
          <ChevronRightIcon
            className={`text-muted-foreground size-4 transition-transform duration-200 ${
              isOpen ? "rotate-90" : ""
            }`}
          />
        </TableCell>
        <TableCell className="font-medium">{row.boxNumber}</TableCell>
        <TableCell>{row.deliveryNumber}</TableCell>
        <TableCell className="whitespace-nowrap">
          {formatDate(row.deliveryDate)}
        </TableCell>
        <TableCell className="max-w-56 truncate" title={row.lotNo}>
          {row.lotNo}
        </TableCell>
        <TableCell className="text-right tabular-nums">
          {row.setNo} / {row.boxNo}
        </TableCell>
        <TableCell>
          <StatusBadge tone={row.labelStatus === "verified" ? "ok" : "neutral"}>
            {LABEL_STATUS_LABEL[row.labelStatus]}
          </StatusBadge>
        </TableCell>
        <TableCell className="text-right tabular-nums">
          {row.scans.length === 0 ? (
            <span className="text-muted-foreground">—</span>
          ) : (
            <span>
              {accepted}
              <span className="text-muted-foreground">
                {" "}
                / {row.scans.length}
              </span>
            </span>
          )}
        </TableCell>
        <TableCell>
          <div className="flex items-center gap-1.5">
            <StatusBadge tone={summary?.tone ?? "muted"}>
              {summary?.label ?? "—"}
            </StatusBadge>
            {summary && summary.reprints > 0 ? (
              <span className="text-muted-foreground text-xs">
                +{summary.reprints} ulang
              </span>
            ) : null}
          </div>
        </TableCell>
        <TableCell className="whitespace-nowrap">
          {formatDateTime(summary?.lastAt ?? null)}
        </TableCell>
      </TableRow>

      {isOpen ? (
        <TableRow className="hover:bg-transparent">
          <TableCell className="bg-muted/40 p-0" colSpan={10}>
            <HistoryDetail row={row} />
          </TableCell>
        </TableRow>
      ) : null}
    </>
  )
}

function HistoryDetail({ row }: { row: MasterItemHistoryRow }) {
  return (
    <div className="grid gap-8 px-6 py-5 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
      <section className="flex flex-col gap-3">
        <h3 className="text-xs font-semibold tracking-wide uppercase">
          Batch &amp; sesi
        </h3>
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-sm">
          <DetailPair label="Item List" value={String(row.rowNo)} />
          <DetailPair label="Qty/Box" value={String(row.packingQty)} />
          <DetailPair label="Qty/Delivery" value={String(row.qtyDelivery)} />
          <DetailPair label="Label di batch" value={String(row.labelCount)} />
          <DetailPair
            label="Batch dibuat"
            value={formatDateTime(row.batchCreatedAt)}
          />
          <DetailPair
            label="Batch ditutup"
            value={formatDateTime(row.batchClosedAt)}
          />
          <DetailPair
            label="Box dibuat"
            value={formatDateTime(row.createdAt)}
          />
          <DetailPair
            label="Scan dimulai"
            value={formatDateTime(row.session?.startedAt ?? null)}
          />
          <DetailPair
            label="Siap finalisasi"
            value={formatDateTime(row.session?.readyAt ?? null)}
          />
          <DetailPair
            label="Difinalisasi"
            value={formatDateTime(row.session?.finalizedAt ?? null)}
          />
          {row.session?.cancelledAt ? (
            <DetailPair
              label="Dibatalkan"
              value={`${formatDateTime(row.session.cancelledAt)}${
                row.session.cancelReason ? ` — ${row.session.cancelReason}` : ""
              }`}
            />
          ) : null}
        </dl>
      </section>

      <div className="flex flex-col gap-8">
        <section className="flex flex-col gap-3">
          <h3 className="flex items-center gap-2 text-xs font-semibold tracking-wide uppercase">
            <ScanLineIcon className="size-3.5" />
            Scan produk ({row.scans.length})
          </h3>
          {row.scans.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              Box ini belum pernah discan.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-muted-foreground text-xs">
                  <tr className="text-left">
                    <th className="pb-2 font-medium">Waktu</th>
                    <th className="pb-2 font-medium">Part No</th>
                    <th className="pb-2 font-medium">Ukuran</th>
                    <th className="pb-2 font-medium">Hasil</th>
                    <th className="pb-2 font-medium">Label UID</th>
                  </tr>
                </thead>
                <tbody>
                  {row.scans.map((scan) => (
                    <tr className="border-t" key={scan.id}>
                      <td className="py-1.5 whitespace-nowrap">
                        {formatDateTime(scan.scannedAt)}
                      </td>
                      <td className="py-1.5">{scan.scannedPartNo}</td>
                      <td className="py-1.5">{scan.scannedSize}</td>
                      <td className="py-1.5">
                        <StatusBadge tone={SCAN_RESULT_TONE[scan.result]}>
                          {SCAN_RESULT_LABEL[scan.result]}
                          {scan.errorCode ? ` · ${scan.errorCode}` : ""}
                        </StatusBadge>
                      </td>
                      <td className="text-muted-foreground py-1.5">
                        {scan.labelUid ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="flex flex-col gap-3">
          <h3 className="flex items-center gap-2 text-xs font-semibold tracking-wide uppercase">
            <PrinterIcon className="size-3.5" />
            Job cetak ({row.printJobs.length})
          </h3>
          {row.printJobs.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              Belum ada job cetak untuk box ini.
            </p>
          ) : (
            <div className="flex flex-col gap-3">
              {row.printJobs.map((job) => (
                <div className="bg-background rounded-md border" key={job.id}>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-4 py-2.5 text-sm">
                    <span className="font-medium">{job.labelReference}</span>
                    <StatusBadge tone={PRINT_STATUS_TONE[job.status]}>
                      {PRINT_STATUS_LABEL[job.status]}
                    </StatusBadge>
                    {job.isReprint ? (
                      <Badge variant="outline">Cetak ulang</Badge>
                    ) : null}
                    <span className="text-muted-foreground text-xs">
                      Urutan {job.sequenceNo} · Templat {job.templateVersion} ·{" "}
                      {job.attemptCount} percobaan
                    </span>
                    <span className="text-muted-foreground ml-auto text-xs">
                      Dibuat {formatDateTime(job.createdAt)}
                      {job.sentAt
                        ? ` · Dikirim ${formatDateTime(job.sentAt)}`
                        : ""}
                      {job.confirmedAt
                        ? ` · Selesai ${formatDateTime(job.confirmedAt)}`
                        : ""}
                    </span>
                  </div>
                  {job.attempts.length === 0 ? (
                    <p className="text-muted-foreground px-4 py-2.5 text-sm">
                      Belum ada percobaan tercatat.
                    </p>
                  ) : (
                    <ul className="divide-y">
                      {job.attempts.map((attempt) => (
                        <li
                          className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 text-sm"
                          key={attempt.id}
                        >
                          <span className="text-muted-foreground tabular-nums">
                            #{attempt.attemptNo}
                          </span>
                          <StatusBadge
                            tone={attempt.result === "sent" ? "ok" : "danger"}
                          >
                            {attempt.result === "sent" ? "Terkirim" : "Gagal"}
                          </StatusBadge>
                          <span>{attempt.printerName}</span>
                          {attempt.errorCode ? (
                            <span className="text-destructive text-xs">
                              {attempt.errorCode}
                              {attempt.errorMessage
                                ? ` — ${attempt.errorMessage}`
                                : ""}
                            </span>
                          ) : null}
                          <span className="text-muted-foreground ml-auto text-xs">
                            {formatDateTime(attempt.createdAt)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

function DetailPair({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-muted-foreground whitespace-nowrap">{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </>
  )
}
