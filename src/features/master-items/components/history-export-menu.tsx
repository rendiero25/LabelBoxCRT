"use client"

import {
  DownloadIcon,
  FileSpreadsheetIcon,
  FileTextIcon,
  TableIcon,
} from "lucide-react"

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Button } from "@/components/ui/button"
import { HISTORY_SECTIONS } from "@/features/master-items/history-export"

/**
 * Menu unduhan riwayat satu label box.
 *
 * Isinya tautan biasa, bukan tombol yang memanggil aksi: berkasnya dirakit
 * server dan dikirim sebagai unduhan, jadi browser bisa menanganinya sendiri
 * tanpa menunggu javascript dan tanpa menahan data berkasnya di memori tab.
 *
 * CSV bercabang per bagian karena satu berkas CSV hanya memuat satu tabel,
 * sementara riwayat satu box tetap punya empat tingkat.
 */
export function HistoryExportMenu({
  boxNumber,
  labelBoxId,
  masterItemId,
}: {
  boxNumber: string
  labelBoxId: string
  masterItemId: string
}) {
  const base = `/admin/master-items/${masterItemId}/history/export?labelBox=${labelBoxId}`

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {/* Klik di baris tabel membuka detailnya; klik di menu ini tidak boleh
            ikut membukanya. */}
        <Button
          aria-label={`Ekspor riwayat box ${boxNumber}`}
          onClick={(event) => event.stopPropagation()}
          size="sm"
          variant="outline"
        >
          <DownloadIcon data-icon="inline-start" />
          Ekspor
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-56"
        onClick={(event) => event.stopPropagation()}
      >
        <DropdownMenuLabel>Unduh box {boxNumber}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <a href={`${base}&format=xlsx`}>
            <FileSpreadsheetIcon data-icon="inline-start" />
            Excel
          </a>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <a href={`${base}&format=pdf`}>
            <FileTextIcon data-icon="inline-start" />
            PDF
          </a>
        </DropdownMenuItem>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <TableIcon data-icon="inline-start" />
            CSV
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            {HISTORY_SECTIONS.map((section) => (
              <DropdownMenuItem asChild key={section.key}>
                <a href={`${base}&format=csv&section=${section.key}`}>
                  {section.name}
                </a>
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
