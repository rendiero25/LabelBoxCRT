import { CircleAlertIcon } from "lucide-react"

import {
  LabelBoxBatchTable,
  type LabelBoxBatchRow,
} from "@/features/label-boxes/components/label-box-batch-table"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { requireOperator } from "@/features/auth/server"
import { createClient } from "@/lib/supabase/server"

export default async function ScanPage() {
  await requireOperator()
  const supabase = await createClient()

  const [batchesResult, masterItemsResult, boxesResult, suppliersResult] =
    await Promise.all([
      supabase
        .from("label_box_batches")
        .select(
          "id, master_item_row_no, packing_qty, qty_delivery, lot_no, label_count, qr_generated_at, created_at, delivery_numbers(delivery_number, delivery_date), suppliers(supplier_code), master_items(item_code), label_boxes(box_number, set_no, box_no)",
        )
        .order("created_at", { ascending: false }),
      supabase
        .from("master_items")
        .select("id, item_code, part_no, default_label_qty, supplier_id")
        .eq("is_active", true)
        .order("item_code"),
      supabase.from("boxes").select("id, master_item_id"),
      supabase
        .from("suppliers")
        .select("id, supplier_code")
        .eq("is_active", true)
        .order("supplier_code"),
    ])

  const dataError =
    batchesResult.error ??
    masterItemsResult.error ??
    boxesResult.error ??
    suppliersResult.error

  const boxRows = boxesResult.data ?? []
  const masterItems = (masterItemsResult.data ?? [])
    .filter((item) => boxRows.some((box) => box.master_item_id === item.id))
    .map((item) => ({
      id: item.id,
      itemCode: item.item_code,
      packingQty: item.default_label_qty,
      partNo: item.part_no,
      supplierId: item.supplier_id,
    }))

  const suppliers = (suppliersResult.data ?? []).map((supplier) => ({
    id: supplier.id,
    supplierCode: supplier.supplier_code,
  }))

  const batches = (batchesResult.data ?? [])
    .map(toLabelBoxBatchRow)
    .filter((batch): batch is LabelBoxBatchRow => batch !== null)

  return (
    <div className="flex w-full flex-col gap-6">
      {dataError ? (
        <Alert variant="destructive">
          <CircleAlertIcon />
          <AlertTitle>Data label box tidak dapat dimuat</AlertTitle>
          <AlertDescription>
            Periksa koneksi Supabase atau izin operator.
          </AlertDescription>
        </Alert>
      ) : null}
      <LabelBoxBatchTable
        batches={batches}
        masterItems={masterItems}
        suppliers={suppliers}
      />
    </div>
  )
}

type LabelBoxBatchQuery = {
  id: string
  packing_qty: number
  qty_delivery: number
  lot_no: string
  label_count: number
  qr_generated_at: string | null
  delivery_numbers: { delivery_number: string; delivery_date: string } | null
  suppliers: { supplier_code: string } | null
  master_items: { item_code: string } | null
  label_boxes: Array<{ box_number: string; set_no: number; box_no: number }>
}

function toLabelBoxBatchRow(
  batch: LabelBoxBatchQuery | null,
): LabelBoxBatchRow | null {
  if (!batch?.delivery_numbers || !batch.suppliers || !batch.master_items) {
    return null
  }

  return {
    boxNumbers: [...batch.label_boxes]
      .sort((left, right) =>
        left.set_no === right.set_no
          ? left.box_no - right.box_no
          : left.set_no - right.set_no,
      )
      .map((labelBox) => labelBox.box_number),
    deliveryDate: batch.delivery_numbers.delivery_date,
    deliveryNumber: batch.delivery_numbers.delivery_number,
    id: batch.id,
    itemCode: batch.master_items.item_code,
    labelCount: batch.label_count,
    lotNo: batch.lot_no,
    packingQty: batch.packing_qty,
    qrGenerated: batch.qr_generated_at !== null,
    qtyDelivery: batch.qty_delivery,
    supplierCode: batch.suppliers.supplier_code,
  }
}
