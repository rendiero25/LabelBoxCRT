import { PackageSearchIcon } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { boxWorkState } from "@/features/master-items/box-lock"
import { MasterItemDirectory } from "@/features/master-items/components/master-item-directory"
import { requireAdmin } from "@/features/auth/server"
import { createClient } from "@/lib/supabase/server"

export default async function MasterItemsPage() {
  await requireAdmin()
  const supabase = await createClient()
  const [
    masterItemsResult,
    rowNumbersResult,
    productsResult,
    boxesResult,
    batchesResult,
    suppliersResult,
  ] = await Promise.all([
    supabase
      .from("master_items")
      .select(
        "id, item_code, part_no, part_name, unit, default_label_qty, supplier_id, is_active",
      )
      // Master Item terhapus tetap ada sebagai jangkar riwayat label box, tapi
      // tidak boleh muncul lagi di daftar mana pun.
      .is("deleted_at", null)
      .order("item_code"),
    // Nomor urut dihitung Postgres, bukan di sini: nomor yang sama dipakai
    // saat QR dibuat, dan mengurutkan ulang di javascript berisiko memberi
    // hasil berbeda dari collation database.
    supabase.from("master_item_row_numbers").select("master_item_id, row_no"),
    supabase
      .from("products")
      .select(
        "id, product_code, part_name, outer_diameter, inner_diameter, length, normalized_dimensions",
      )
      .eq("is_active", true)
      .order("product_code"),
    supabase
      .from("boxes")
      .select(
        "id, master_item_id, box_no, box_code, box_name, box_layers(id, layer_no, layer_name, box_layer_requirements(product_id, expected_qty)), packing_sessions(id, status), label_boxes(batch_id, packing_session_id)",
      )
      // Box yang diarsipkan tetap ada sebagai jangkar label lama, tapi tidak
      // boleh muncul lagi di layar mana pun.
      .is("deleted_at", null)
      .order("box_no"),
    // Batch dipakai untuk memutuskan Box mana yang masih terkunci: yang
    // menyudahi pekerjaan sebuah Box adalah batch-nya yang ditutup, bukan
    // status sesinya.
    supabase.from("label_box_batches").select("id, master_item_id, closed_at"),
    supabase
      .from("suppliers")
      .select("id, supplier_code, supplier_name")
      .eq("is_active", true)
      .order("supplier_code"),
  ])
  const error =
    masterItemsResult.error ??
    rowNumbersResult.error ??
    productsResult.error ??
    boxesResult.error ??
    batchesResult.error ??
    suppliersResult.error
  const rowNumbers = new Map(
    (rowNumbersResult.data ?? []).map((row) => [
      row.master_item_id,
      row.row_no,
    ]),
  )
  const masterItems = (masterItemsResult.data ?? []).map((masterItem) => ({
    ...masterItem,
    row_no: rowNumbers.get(masterItem.id) ?? null,
  }))
  const suppliers = suppliersResult.data ?? []
  const products = (productsResult.data ?? []).map((product) => ({
    id: product.id,
    productCode: product.product_code,
    partName: product.part_name,
    outerDiameter: product.outer_diameter,
    innerDiameter: product.inner_diameter,
    length: product.length,
    normalizedDimensions: product.normalized_dimensions,
  }))
  const batches = batchesResult.data ?? []
  const closedBatchIds = new Set(
    batches
      .filter((batch) => batch.closed_at !== null)
      .map((batch) => batch.id),
  )
  const masterItemsWithOpenBatch = new Set(
    batches
      .filter((batch) => batch.closed_at === null)
      .map((batch) => batch.master_item_id),
  )
  const boxes = (boxesResult.data ?? []).map((box) => ({
    id: box.id,
    masterItemId: box.master_item_id,
    boxNo: box.box_no,
    boxCode: box.box_code,
    boxName: box.box_name,
    ...boxWorkState({
      sessions: box.packing_sessions,
      labelBoxes: box.label_boxes.map((labelBox) => ({
        batchId: labelBox.batch_id,
        packingSessionId: labelBox.packing_session_id,
      })),
      hasOpenBatch: masterItemsWithOpenBatch.has(box.master_item_id),
      closedBatchIds,
    }),
    layers: box.box_layers
      .map((layer) => ({
        id: layer.id,
        layerNo: layer.layer_no,
        layerName: layer.layer_name,
        requirements: layer.box_layer_requirements.map((requirement) => ({
          productId: requirement.product_id,
          expectedQty: requirement.expected_qty,
        })),
      }))
      .sort((first, second) => first.layerNo - second.layerNo),
  }))

  return (
    <div className="flex w-full flex-col gap-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">Master Item</h1>
        <p className="text-muted-foreground text-sm">
          Part No, unit, dan Packing Qty menjadi sumber data label. Tiap Master
          Item memiliki maksimal 3 Box.
        </p>
      </div>

      {error ? (
        <Alert variant="destructive">
          <PackageSearchIcon />
          <AlertTitle>Data Master Item tidak dapat dimuat</AlertTitle>
          <AlertDescription>
            Periksa koneksi Supabase atau izin admin.
          </AlertDescription>
        </Alert>
      ) : null}

      <MasterItemDirectory
        boxes={boxes}
        masterItems={masterItems}
        products={products}
        suppliers={suppliers}
      />
    </div>
  )
}
