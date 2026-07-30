import { notFound } from "next/navigation"

import {
  LabelBoxVerificationConsole,
  type VerificationLabelBox,
  type VerificationMasterItemProduct,
} from "@/features/label-boxes/components/label-box-verification-console"
import { requireActiveUser } from "@/features/auth/server"
import { createClient } from "@/lib/supabase/server"

export default async function LabelBoxVerificationPage({
  params,
}: {
  params: Promise<{ batchId: string }>
}) {
  await requireActiveUser()
  const { batchId } = await params
  const supabase = await createClient()

  const { data: batch, error } = await supabase
    .from("label_box_batches")
    .select(
      "id, lot_no, qty_delivery, closed_at, supplier_code_snapshot, item_code_snapshot, delivery_number_snapshot, delivery_date_snapshot, label_boxes(id, box_id, box_number, set_no, box_no, status, packing_session_id)",
    )
    .eq("id", batchId)
    .maybeSingle()

  if (error || !batch || batch.closed_at !== null) {
    notFound()
  }

  const sessionIds = batch.label_boxes
    .map((labelBox) => labelBox.packing_session_id)
    .filter((sessionId): sessionId is string => sessionId !== null)

  const { data: scanRows } = sessionIds.length
    ? await supabase
        .from("packing_session_scans")
        .select("packing_session_id, product_id, result")
        .in("packing_session_id", sessionIds)
        .eq("result", "accepted")
    : { data: [] }

  const { data: requirementRows } = await supabase
    .from("box_layers")
    .select(
      "box_id, box_layer_requirements(expected_qty, product_id, products(id, product_code, part_name, outer_diameter, inner_diameter, length))",
    )

  function expectedQtyForBox(boxId: string): number {
    return (requirementRows ?? [])
      .filter((layer) => layer.box_id === boxId)
      .reduce(
        (total, layer) =>
          total +
          layer.box_layer_requirements.reduce(
            (layerTotal, requirement) => layerTotal + requirement.expected_qty,
            0,
          ),
        0,
      )
  }

  const labelBoxes: VerificationLabelBox[] = [...batch.label_boxes]
    .sort((left, right) =>
      left.set_no === right.set_no
        ? left.box_no - right.box_no
        : left.set_no - right.set_no,
    )
    .map((labelBox) => ({
      acceptedQty: (scanRows ?? []).filter(
        (scan) => scan.packing_session_id === labelBox.packing_session_id,
      ).length,
      boxNumber: labelBox.box_number,
      expectedQty: expectedQtyForBox(labelBox.box_id),
      id: labelBox.id,
      verified: labelBox.status === "verified",
    }))

  const batchBoxIds = new Set(
    batch.label_boxes.map((labelBox) => labelBox.box_id),
  )
  const coveredProductIds = new Set(
    (scanRows ?? [])
      .map((scan) => scan.product_id)
      .filter((productId): productId is string => productId !== null),
  )

  const masterItemProductsById = new Map<string, VerificationMasterItemProduct>()
  for (const layer of requirementRows ?? []) {
    if (!batchBoxIds.has(layer.box_id)) continue
    for (const requirement of layer.box_layer_requirements) {
      const product = requirement.products
      if (!product || masterItemProductsById.has(product.id)) continue
      masterItemProductsById.set(product.id, {
        id: product.id,
        innerDiameter: product.inner_diameter,
        length: product.length,
        outerDiameter: product.outer_diameter,
        partName: product.part_name,
        productCode: product.product_code,
        scanned: coveredProductIds.has(product.id),
      })
    }
  }
  const masterItemProducts = [...masterItemProductsById.values()].sort(
    (left, right) => left.productCode.localeCompare(right.productCode),
  )

  return (
    <LabelBoxVerificationConsole
      batch={{
        deliveryDate: batch.delivery_date_snapshot,
        deliveryNumber: batch.delivery_number_snapshot,
        id: batch.id,
        itemCode: batch.item_code_snapshot,
        labelBoxes,
        lotNo: batch.lot_no,
        masterItemProducts,
        qtyDelivery: batch.qty_delivery,
        supplierCode: batch.supplier_code_snapshot,
      }}
    />
  )
}
