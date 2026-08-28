"use client"

import { Fragment, useMemo, useState } from "react"
import {
  ArrowDownIcon,
  ArrowUpDownIcon,
  ArrowUpIcon,
  FilterIcon,
  SearchIcon,
} from "lucide-react"

import {
  DEFAULT_MPQ_SORT,
  MPQ_SORT_OPTIONS,
  headerSortDirection,
  nextHeaderSort,
  sortMpqRows,
  type MpqSortHeader,
  type MpqSortKey,
} from "@/features/mpq-sheet/sorting"
import { PaginationControls } from "@/components/shared/pagination-controls"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

type MpqSheetRow = {
  id: string
  mpq_qty: number
  product_size: string
  row_no: number
  unit: string
}

const PAGE_SIZE = 20

/**
 * Spasi dibuang dari kedua sisi sebelum dibandingkan. Dokumen MPQ menulis
 * "L=60 MM" sementara label menulis "L=60MM", dan admin mengetik salah satunya
 * tanpa tahu daftar ini memakai yang mana — sama seperti pencocokan di
 * verify_delivery_label.
 */
function searchKey(value: string): string {
  return value.replace(/\s/g, "").toLocaleLowerCase("id-ID")
}

export function MpqSheetDirectory({ rows }: { rows: MpqSheetRow[] }) {
  const [query, setQuery] = useState("")
  const [unit, setUnit] = useState("all")
  const [sortKey, setSortKey] = useState<MpqSortKey>(DEFAULT_MPQ_SORT)
  const [page, setPage] = useState(1)

  // Satuan diambil dari datanya, bukan ditulis tetap di sini: dokumen MPQ
  // berikutnya boleh menambah satuan baru tanpa filternya ikut diubah.
  const units = useMemo(
    () => [...new Set(rows.map((row) => row.unit))].sort(),
    [rows],
  )

  function applySort(key: MpqSortKey) {
    setSortKey(key)
    setPage(1)
  }

  function toggleHeaderSort(header: MpqSortHeader) {
    applySort(nextHeaderSort(header, sortKey))
  }

  const filteredRows = useMemo(() => {
    const normalizedQuery = searchKey(query.trim())

    const filtered = rows.filter((row) => {
      const matchesQuery =
        !normalizedQuery ||
        searchKey(row.product_size).includes(normalizedQuery) ||
        String(row.mpq_qty).includes(normalizedQuery)
      const matchesUnit = unit === "all" || row.unit === unit

      return matchesQuery && matchesUnit
    })

    return sortMpqRows(filtered, sortKey)
  }, [rows, query, unit, sortKey])

  const pageCount = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE))
  const currentPage = Math.min(page, pageCount)
  const pagedRows = filteredRows.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE,
  )

  const activeSort = MPQ_SORT_OPTIONS.find((option) => option.key === sortKey)

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-1 flex-wrap items-center gap-2">
        <div className="relative min-w-[16rem] flex-1 sm:max-w-sm">
          <SearchIcon className="text-muted-foreground pointer-events-none absolute top-2 left-2.5 size-4" />
          <Input
            aria-label="Cari ukuran"
            className="pl-8"
            onChange={(event) => {
              setQuery(event.target.value)
              setPage(1)
            }}
            placeholder="Cari ukuran atau Qty MPQ"
            value={query}
          />
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline">
              <FilterIcon data-icon="inline-start" />
              Filter
              {unit !== "all" ? (
                <Badge className="ml-1" variant="secondary">
                  1
                </Badge>
              ) : null}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            <DropdownMenuLabel>Unit/Box</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              onValueChange={(value) => {
                setUnit(value)
                setPage(1)
              }}
              value={unit}
            >
              <DropdownMenuRadioItem value="all">
                Semua satuan
              </DropdownMenuRadioItem>
              {units.map((option) => (
                <DropdownMenuRadioItem key={option} value={option}>
                  {option}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline">
              <ArrowUpDownIcon data-icon="inline-start" />
              Urutkan
              {activeSort && activeSort.key !== DEFAULT_MPQ_SORT ? (
                <Badge className="ml-1" variant="secondary">
                  {activeSort.label}
                </Badge>
              ) : null}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            <DropdownMenuLabel>Urutkan menurut</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              onValueChange={(value) => applySort(value as MpqSortKey)}
              value={sortKey}
            >
              {MPQ_SORT_OPTIONS.map((option, index) => {
                const startsGroup =
                  index > 0 &&
                  MPQ_SORT_OPTIONS[index - 1].group !== option.group
                const Icon =
                  option.direction === "asc" ? ArrowUpIcon : ArrowDownIcon

                return (
                  <Fragment key={option.key}>
                    {startsGroup ? <DropdownMenuSeparator /> : null}
                    <DropdownMenuRadioItem value={option.key}>
                      {option.label}
                      <Icon className="text-muted-foreground ml-auto size-3.5" />
                    </DropdownMenuRadioItem>
                  </Fragment>
                )
              })}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {filteredRows.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyTitle>Tidak ada ukuran</EmptyTitle>
            <EmptyDescription>
              Ubah pencarian atau filter satuannya.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="rounded-xl border">
          <Table className="table-fixed">
            <TableHeader>
              <TableRow>
                <TableHead className="w-16">No</TableHead>
                <TableHead>
                  <SortableHeader
                    header="ukuran"
                    label="Ukuran"
                    onSort={toggleHeaderSort}
                    sortKey={sortKey}
                  />
                </TableHead>
                <TableHead className="w-[18%]">
                  <SortableHeader
                    header="mpq"
                    label="Qty MPQ"
                    onSort={toggleHeaderSort}
                    sortKey={sortKey}
                  />
                </TableHead>
                <TableHead className="w-[20%]">
                  <SortableHeader
                    header="satuan"
                    label="Unit/Box"
                    onSort={toggleHeaderSort}
                    sortKey={sortKey}
                  />
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pagedRows.map((row, index) => (
                <TableRow key={row.id}>
                  <TableCell>
                    {(currentPage - 1) * PAGE_SIZE + index + 1}
                  </TableCell>
                  <TableCell className="font-medium break-words whitespace-normal">
                    {row.product_size}
                  </TableCell>
                  {/* MPQ naik sampai lima digit; tanpa pemisah ribuan angka
                      sebesar itu harus dihitung digitnya dulu sebelum
                      terbaca. */}
                  <TableCell className="tabular-nums">
                    {row.mpq_qty.toLocaleString("id-ID")}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {row.unit}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <PaginationControls
            currentPage={currentPage}
            onPageChange={setPage}
            pageCount={pageCount}
            totalItems={filteredRows.length}
          />
        </div>
      )}
    </div>
  )
}

function SortableHeader({
  header,
  label,
  onSort,
  sortKey,
}: {
  header: MpqSortHeader
  label: string
  onSort: (header: MpqSortHeader) => void
  sortKey: MpqSortKey
}) {
  const direction = headerSortDirection(header, sortKey)
  const Icon = direction === "desc" ? ArrowDownIcon : ArrowUpIcon

  return (
    <Button
      className="h-auto p-0 font-medium"
      onClick={() => onSort(header)}
      size="sm"
      type="button"
      variant="ghost"
    >
      {label}
      {direction ? <Icon className="size-3.5" /> : null}
    </Button>
  )
}
