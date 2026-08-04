import { notFound } from "next/navigation"

import {
  LabelBoxVerificationConsole,
  type VerificationBox,
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
      "id, lot_no, qty_delivery, closed_at, supplier_code_snapshot, part_no_snapshot, delivery_number_snapshot, delivery_date_snapshot, label_boxes(id, box_id, box_number, set_no, box_no, status, packing_session_id)",
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
        .select("packing_session_id, product_id, box_layer_id, result")
        .in("packing_session_id", sessionIds)
        .eq("result", "accepted")
    : { data: [] }

  // Sudah tercetak atau belum harus dibaca dari database, bukan dari ingatan
  // tab: kalau tidak, listrik mati atau tab tertutup setelah mencetak membuat
  // tombol Selesaikan verifikasi terkunci selamanya, sebab job cetaknya sudah
  // 'confirmed' dan tidak bisa dicetak ulang lewat jalur biasa.
  const { data: printJobRows } = sessionIds.length
    ? await supabase
        .from("print_jobs")
        .select("packing_session_id, status")
        .in("packing_session_id", sessionIds)
        .in("status", ["sent", "confirmed"])
    : { data: [] }

  const printedSessionIds = new Set(
    (printJobRows ?? []).map((job) => job.packing_session_id),
  )
  const labelsPrinted =
    batch.label_boxes.length > 0 &&
    batch.label_boxes.every(
      (labelBox) =>
        labelBox.packing_session_id !== null &&
        printedSessionIds.has(labelBox.packing_session_id),
    )

  const { data: requirementRows } = await supabase
    .from("box_layers")
    .select(
      "id, box_id, layer_no, layer_name, sort_order, box_layer_requirements(expected_qty, sort_order, product_id, products(id, product_code, part_name, outer_diameter, inner_diameter, length))",
    )
    .order("sort_order")

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

  // Nama box datang dari Master Item; nomor B101/B201 hanya penanda label.
  // Operator memantau pekerjaannya per box dan per layer, jadi keduanya
  // dikirim lengkap dengan progress masing-masing.
  const { data: boxRows } = await supabase
    .from("boxes")
    .select("id, box_no, box_code, box_name")

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
      boxId: labelBox.box_id,
      boxName:
        (boxRows ?? []).find((box) => box.id === labelBox.box_id)?.box_name ??
        labelBox.box_number,
      boxNumber: labelBox.box_number,
      expectedQty: expectedQtyForBox(labelBox.box_id),
      id: labelBox.id,
      setNo: labelBox.set_no,
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

  const masterItemProductsById = new Map<
    string,
    VerificationMasterItemProduct
  >()
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

  // Susunan box Master Item, satu baris per box fisik. Qty delivery menggandakan
  // box yang sama menjadi beberapa set label (B101, B102, …); penggandaan itu
  // tidak menambah informasi bagi operator yang sedang mengisi rak, jadi panel
  // monitoring memakai bentuk aslinya.
  const boxes: VerificationBox[] = [...batchBoxIds]
    .map((boxId) => ({
      boxNo: (boxRows ?? []).find((box) => box.id === boxId)?.box_no ?? 0,
      id: boxId,
    }))
    .sort((left, right) => left.boxNo - right.boxNo)
    .map(({ id }) => ({
      boxName:
        (boxRows ?? []).find((box) => box.id === id)?.box_name ??
        "Box tanpa nama",
      id,
      layers: (requirementRows ?? [])
        .filter((layer) => layer.box_id === id)
        .map((layer) => ({
          id: layer.id,
          layerName: layer.layer_name,
          layerNo: layer.layer_no,
          products: [...layer.box_layer_requirements]
            .sort((left, right) => left.sort_order - right.sort_order)
            .map((requirement) => ({
              expectedQty: requirement.expected_qty,
              id: requirement.product_id ?? layer.id,
              innerDiameter: requirement.products?.inner_diameter ?? 0,
              length: requirement.products?.length ?? 0,
              outerDiameter: requirement.products?.outer_diameter ?? 0,
              partName: requirement.products?.part_name ?? "Produk terhapus",
              productCode: requirement.products?.product_code ?? "-",
              scanned: requirement.product_id
                ? coveredProductIds.has(requirement.product_id)
                : false,
            })),
        })),
    }))

  return (
    <LabelBoxVerificationConsole
      batch={{
        boxes,
        deliveryDate: batch.delivery_date_snapshot,
        deliveryNumber: batch.delivery_number_snapshot,
        id: batch.id,
        labelBoxes,
        labelsPrinted,
        lotNo: batch.lot_no,
        masterItemProducts,
        partNo: batch.part_no_snapshot,
        qtyDelivery: batch.qty_delivery,
        supplierCode: batch.supplier_code_snapshot,
      }}
    />
  )
}
