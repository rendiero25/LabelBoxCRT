import { CircleAlertIcon } from "lucide-react"

import {
  PackingScanConsole,
  type ActivePackingSessionView,
} from "@/components/operator/packing-scan-console"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { requireOperator } from "@/features/auth/server"
import { createClient } from "@/lib/supabase/server"

export default async function ScanPage() {
  const auth = await requireOperator()
  const supabase = await createClient()
  const [
    masterItemsResult,
    boxesResult,
    activeSessionsResult,
    deliveryNumbersResult,
    suppliersResult,
  ] = await Promise.all([
    supabase
      .from("master_items")
      .select("id, item_code, part_no, part_name")
      .eq("is_active", true)
      .order("part_no"),
    supabase
      .from("boxes")
      .select("id, master_item_id, box_no, box_code, box_name"),
    supabase
      .from("packing_sessions")
      .select(
        "id, status, master_item_id, box_id, master_items(part_no, part_name), boxes(box_code, box_name, box_layers(id, layer_no, layer_name, sort_order, box_layer_requirements(expected_qty))), packing_session_scans(id, box_layer_id, result, error_code, scanned_at)",
      )
      .eq("operator_id", auth.userId)
      .in("status", ["scanning", "ready_to_finalize"])
      .order("started_at", { ascending: false }),
    supabase
      .from("delivery_numbers")
      .select(
        "id, delivery_number, delivery_date, supplier_id, suppliers(supplier_code, supplier_name)",
      )
      .eq("status", "active")
      .order("delivery_number"),
    supabase
      .from("suppliers")
      .select("id, supplier_code, supplier_name")
      .eq("is_active", true)
      .order("supplier_code"),
  ])

  const dataError =
    masterItemsResult.error ??
    boxesResult.error ??
    activeSessionsResult.error ??
    deliveryNumbersResult.error ??
    suppliersResult.error
  const boxesByMasterItem = boxesResult.data ?? []
  const masterItems = (masterItemsResult.data ?? [])
    .filter((item) =>
      boxesByMasterItem.some((box) => box.master_item_id === item.id),
    )
    .map((item) => ({
      id: item.id,
      itemCode: item.item_code,
      partName: item.part_name,
      partNo: item.part_no,
    }))
  const boxes = boxesByMasterItem.map((box) => ({
    id: box.id,
    masterItemId: box.master_item_id,
    boxCode: box.box_code,
    boxName: box.box_name,
  }))
  const activeSessions = (activeSessionsResult.data ?? [])
    .map(toActivePackingSession)
    .filter((session): session is ActivePackingSessionView => session !== null)
  const deliveryNumbers = (deliveryNumbersResult.data ?? [])
    .filter(
      (deliveryNumber): deliveryNumber is DeliveryNumberQuery & {
        suppliers: NonNullable<DeliveryNumberQuery["suppliers"]>
      } => deliveryNumber.suppliers !== null,
    )
    .map((deliveryNumber) => ({
      id: deliveryNumber.id,
      deliveryDate: deliveryNumber.delivery_date,
      deliveryNumber: deliveryNumber.delivery_number,
      supplierCode: deliveryNumber.suppliers.supplier_code,
      supplierId: deliveryNumber.supplier_id,
      supplierName: deliveryNumber.suppliers.supplier_name,
    }))
    .sort(
      (left, right) =>
        left.supplierCode.localeCompare(right.supplierCode) ||
        left.deliveryNumber.localeCompare(right.deliveryNumber),
    )
  const suppliers = (suppliersResult.data ?? []).map((supplier) => ({
    id: supplier.id,
    supplierCode: supplier.supplier_code,
    supplierName: supplier.supplier_name,
  }))

  return (
    <div className="flex w-full flex-col gap-6">
      {dataError ? (
        <Alert variant="destructive">
          <CircleAlertIcon />
          <AlertTitle>Data scan tidak dapat dimuat</AlertTitle>
          <AlertDescription>
            Periksa koneksi Supabase atau izin operator.
          </AlertDescription>
        </Alert>
      ) : null}
      <PackingScanConsole
        activeSessions={activeSessions}
        boxes={boxes}
        deliveryNumbers={deliveryNumbers}
        masterItems={masterItems}
        suppliers={suppliers}
      />
    </div>
  )
}

type DeliveryNumberQuery = {
  delivery_date: string
  delivery_number: string
  id: string
  supplier_id: string
  suppliers: { supplier_code: string; supplier_name: string } | null
}

type ActiveSessionQuery = {
  id: string
  status: string
  master_items: { part_name: string; part_no: string } | null
  boxes: {
    box_code: string
    box_name: string
    box_layers: Array<{
      id: string
      layer_no: number
      layer_name: string
      sort_order: number
      box_layer_requirements: Array<{ expected_qty: number }>
    }>
  } | null
  packing_session_scans: Array<{
    box_layer_id: string | null
    error_code: string | null
    id: string
    result: "accepted" | "duplicate" | "invalid" | "over_qty"
    scanned_at: string
  }>
}

function toActivePackingSession(
  session: ActiveSessionQuery | null,
): ActivePackingSessionView | null {
  if (!session?.master_items || !session.boxes) return null

  const layers = [...session.boxes.box_layers]
    .sort((left, right) => left.sort_order - right.sort_order)
    .map((layer) => {
      const expectedQty = layer.box_layer_requirements.reduce(
        (total, requirement) => total + requirement.expected_qty,
        0,
      )
      const acceptedQty = session.packing_session_scans.filter(
        (scan) => scan.result === "accepted" && scan.box_layer_id === layer.id,
      ).length

      return {
        id: layer.id,
        layerNo: layer.layer_no,
        layerName: layer.layer_name,
        expectedQty,
        acceptedQty,
      }
    })
  const totalExpectedQty = layers.reduce((total, layer) => total + layer.expectedQty, 0)
  const acceptedQty = layers.reduce((total, layer) => total + layer.acceptedQty, 0)

  return {
    id: session.id,
    status: session.status,
    masterItemPartNo: session.master_items.part_no,
    masterItemName: session.master_items.part_name,
    boxCode: session.boxes.box_code,
    boxName: session.boxes.box_name,
    acceptedQty,
    totalExpectedQty,
    layers,
    recentScans: [...session.packing_session_scans]
      .sort(
        (left, right) =>
          new Date(right.scanned_at).getTime() - new Date(left.scanned_at).getTime(),
      )
      .slice(0, 5)
      .map((scan) => ({
        id: scan.id,
        result: scan.result,
        errorCode: scan.error_code,
        scannedAt: scan.scanned_at,
      })),
  }
}
