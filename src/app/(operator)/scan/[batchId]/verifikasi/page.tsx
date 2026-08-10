import { notFound } from "next/navigation"

import {
  LabelBoxVerificationConsole,
  type VerificationSet,
  type VerificationSetBox,
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

  // Nama box datang dari Master Item; nomor B101/B201 hanya penanda label.
  const { data: boxRows } = await supabase
    .from("boxes")
    .select("id, box_no, box_code, box_name")

  /**
   * Keping yang sudah diterima untuk satu produk di satu layer pada satu label
   * box. Disaring lewat sesi milik label box itu, bukan lewat batch: qty
   * delivery menggandakan box yang sama menjadi beberapa set, dan tiap set
   * punya kuotanya sendiri.
   */
  function acceptedQtyFor(
    sessionId: string | null,
    layerId: string,
    productId: string | null,
  ): number {
    if (!sessionId || !productId) return 0
    return (scanRows ?? []).filter(
      (scan) =>
        scan.packing_session_id === sessionId &&
        scan.box_layer_id === layerId &&
        scan.product_id === productId,
    ).length
  }

  function layersFor(
    boxId: string,
    sessionId: string | null,
  ): VerificationSetBox["layers"] {
    return (requirementRows ?? [])
      .filter((layer) => layer.box_id === boxId)
      .map((layer) => ({
        id: layer.id,
        layerName: layer.layer_name,
        layerNo: layer.layer_no,
        products: [...layer.box_layer_requirements]
          .sort((left, right) => left.sort_order - right.sort_order)
          .map((requirement) => ({
            acceptedQty: acceptedQtyFor(
              sessionId,
              layer.id,
              requirement.product_id,
            ),
            expectedQty: requirement.expected_qty,
            id: `${layer.id}-${requirement.product_id ?? "kosong"}`,
            innerDiameter: requirement.products?.inner_diameter ?? 0,
            length: requirement.products?.length ?? 0,
            outerDiameter: requirement.products?.outer_diameter ?? 0,
            partName: requirement.products?.part_name ?? "Produk terhapus",
            productCode: requirement.products?.product_code ?? "-",
          })),
      }))
  }

  /**
   * Satu section per set label. Set adalah Qty Delivery dibagi Packing Qty:
   * qty 200 dengan packing qty 100 dan 3 box berarti dua set, dan tiap set
   * discan sendiri-sendiri sampai ketiga boxnya penuh.
   */
  const setNumbers = [
    ...new Set(batch.label_boxes.map((labelBox) => labelBox.set_no)),
  ].sort((left, right) => left - right)

  const sets: VerificationSet[] = setNumbers.map((setNo) => ({
    boxes: batch.label_boxes
      .filter((labelBox) => labelBox.set_no === setNo)
      .sort((left, right) => left.box_no - right.box_no)
      .map((labelBox) => {
        const layers = layersFor(labelBox.box_id, labelBox.packing_session_id)
        const products = layers.flatMap((layer) => layer.products)

        return {
          acceptedQty: products.reduce(
            (total, product) =>
              total + Math.min(product.acceptedQty, product.expectedQty),
            0,
          ),
          boxName:
            (boxRows ?? []).find((box) => box.id === labelBox.box_id)
              ?.box_name ?? labelBox.box_number,
          boxNumber: labelBox.box_number,
          expectedQty: products.reduce(
            (total, product) => total + product.expectedQty,
            0,
          ),
          id: labelBox.id,
          layers,
          verified: labelBox.status === "verified",
        }
      }),
    setNo,
  }))

  return (
    <LabelBoxVerificationConsole
      batch={{
        deliveryDate: batch.delivery_date_snapshot,
        deliveryNumber: batch.delivery_number_snapshot,
        id: batch.id,
        labelsPrinted,
        lotNo: batch.lot_no,
        partNo: batch.part_no_snapshot,
        qtyDelivery: batch.qty_delivery,
        sets,
        supplierCode: batch.supplier_code_snapshot,
      }}
    />
  )
}
