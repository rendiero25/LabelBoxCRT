"use client"

import { Fragment, useState } from "react"
import { CheckCircle2Icon, ChevronDownIcon, ChevronUpIcon } from "lucide-react"
import Link from "next/link"

import {
  LabelBoxBatchDialog,
  type LabelBoxMasterItemOption,
  type LabelBoxSupplierOption,
} from "@/features/label-boxes/components/label-box-batch-dialog"
import {
  DeleteLabelBoxBatchAction,
  EditLabelBoxBatchDialog,
} from "@/features/label-boxes/components/label-box-batch-row-actions"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { formatShortDate } from "@/lib/label/formatter"

export type LabelBoxBatchRow = {
  boxNumbers: string[]
  closed: boolean
  deliveryDate: string
  deliveryNumber: string
  id: string
  labelCount: number
  lotNo: string
  masterItemId: string
  operatorName: string
  packingDate: string
  partNo: string
  printed: boolean
  qtyDelivery: number
  supplierCode: string
  supplierId: string
}

export function LabelBoxBatchTable({
  batches,
  masterItems,
  prefillMasterItemId = null,
  suppliers,
}: {
  batches: LabelBoxBatchRow[]
  masterItems: LabelBoxMasterItemOption[]
  prefillMasterItemId?: string | null
  suppliers: LabelBoxSupplierOption[]
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null)

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">Data label box</h1>
          <p className="text-muted-foreground text-sm">
            Nomor box dan QR dibuat sekaligus saat data delivery disimpan.
          </p>
        </div>
        <LabelBoxBatchDialog
          masterItems={masterItems}
          prefillMasterItemId={prefillMasterItemId}
          suppliers={suppliers}
        />
      </div>

      {batches.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>Belum ada label box</EmptyTitle>
            <EmptyDescription>
              Tekan Tambah untuk mengisi data delivery dan menggenerate label.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Delivery Number</TableHead>
                <TableHead>Tanggal</TableHead>
                <TableHead>Supplier</TableHead>
                <TableHead>Master Item</TableHead>
                <TableHead className="text-right">Qty Delivery</TableHead>
                <TableHead>Lot No</TableHead>
                <TableHead className="text-right">Label</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {batches.map((batch) => (
                <Fragment key={batch.id}>
                  <TableRow>
                    <TableCell className="font-medium">
                      {batch.deliveryNumber}
                    </TableCell>
                    <TableCell>{formatShortDate(batch.deliveryDate)}</TableCell>
                    <TableCell>{batch.supplierCode}</TableCell>
                    <TableCell>{batch.partNo}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {batch.qtyDelivery}
                    </TableCell>
                    <TableCell>{batch.lotNo}</TableCell>
                    <TableCell className="text-right">
                      <Button
                        className="px-0"
                        onClick={() =>
                          setExpandedId(
                            expandedId === batch.id ? null : batch.id,
                          )
                        }
                        type="button"
                        variant="link"
                      >
                        {batch.labelCount} box
                        {expandedId === batch.id ? (
                          <ChevronUpIcon data-icon="inline-end" />
                        ) : (
                          <ChevronDownIcon data-icon="inline-end" />
                        )}
                      </Button>
                    </TableCell>
                    <TableCell>
                      {batch.printed ? (
                        <Badge variant="secondary">
                          <CheckCircle2Icon data-icon="inline-start" />
                          Tercetak
                        </Badge>
                      ) : batch.closed ? (
                        <Badge>Ditutup</Badge>
                      ) : (
                        <Badge variant="outline">Terbuka</Badge>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {/* Ketiganya sebaris: tabelnya sudah bisa digeser
                          mendatar, jadi tombol yang membungkus hanya membuat
                          tinggi barisnya berbeda-beda tanpa memuat apa pun. */}
                      <div className="flex justify-end gap-2">
                        {batch.closed ? (
                          <Button asChild size="sm" variant="outline">
                            <Link href={`/scan/${batch.id}/cetak`}>Cetak</Link>
                          </Button>
                        ) : (
                          <Button asChild size="sm" variant="outline">
                            <Link href={`/scan/${batch.id}/verifikasi`}>
                              Verifikasi
                            </Link>
                          </Button>
                        )}
                        <EditLabelBoxBatchDialog
                          batch={batch}
                          masterItems={masterItems}
                          suppliers={suppliers}
                        />
                        <DeleteLabelBoxBatchAction batch={batch} />
                      </div>
                    </TableCell>
                  </TableRow>
                  {expandedId === batch.id ? (
                    <TableRow>
                      <TableCell colSpan={9}>
                        <div className="flex flex-wrap gap-2">
                          {batch.boxNumbers.map((boxNumber) => (
                            <span
                              className="bg-muted rounded-md px-2 py-1 font-mono text-sm"
                              key={boxNumber}
                            >
                              {boxNumber}
                            </span>
                          ))}
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : null}
                </Fragment>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
