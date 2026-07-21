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
    workstationAssignmentResult,
    masterItemsResult,
    masterItemBoxesResult,
    activeSessionsResult,
    deliveryNumbersResult,
  ] = await Promise.all([
    supabase
      .from("workstation_assignments")
      .select("workstation_id")
      .eq("operator_id", auth.userId)
      .eq("is_active", true)
      .limit(1)
      .maybeSingle(),
    supabase
      .from("master_items")
      .select("id, item_code, part_no, part_name")
      .eq("is_active", true)
      .order("part_no"),
    supabase
      .from("master_item_boxes")
      .select(
        "id, master_item_id, box_id, version, boxes(box_code, box_name, is_active)",
      )
      .eq("is_active", true),
    supabase
      .from("packing_sessions")
      .select(
        "id, status, version, master_item_id, master_item_box_id, master_items(part_no, part_name), master_item_boxes(boxes(box_code, box_name), box_layer_requirements(box_layer_id, expected_qty, sort_order, box_layers(layer_no, layer_name, sort_order))), packing_session_scans(id, box_layer_id, result, error_code, scanned_at)",
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
  ])

  const dataError =
    workstationAssignmentResult.error ??
    masterItemsResult.error ??
    masterItemBoxesResult.error ??
    activeSessionsResult.error ??
    deliveryNumbersResult.error
  const workstationId = workstationAssignmentResult.data?.workstation_id ?? null
  const activeMasterItemBoxes = (masterItemBoxesResult.data ?? []).filter(
    (assignment): assignment is typeof assignment & {
      boxes: NonNullable<typeof assignment.boxes>
    } => assignment.boxes !== null && assignment.boxes.is_active,
  )
  const masterItems = (masterItemsResult.data ?? [])
    .filter((item) =>
      activeMasterItemBoxes.some(
        (assignment) => assignment.master_item_id === item.id,
      ),
    )
    .map((item) => ({
      id: item.id,
      itemCode: item.item_code,
      partName: item.part_name,
      partNo: item.part_no,
    }))
  const boxDefinitions = activeMasterItemBoxes.map((assignment) => ({
    id: assignment.id,
    masterItemId: assignment.master_item_id,
    boxCode: assignment.boxes.box_code,
    boxName: assignment.boxes.box_name,
    version: assignment.version,
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
        boxDefinitions={boxDefinitions}
        deliveryNumbers={deliveryNumbers}
        masterItems={masterItems}
        workstationId={workstationId}
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
  version: number
  master_items: { part_name: string; part_no: string } | null
  master_item_boxes: {
    boxes: { box_code: string; box_name: string } | null
    box_layer_requirements: Array<{
      box_layer_id: string
      expected_qty: number
      sort_order: number
      box_layers: { layer_no: number; layer_name: string; sort_order: number } | null
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
  if (!session?.master_items || !session.master_item_boxes?.boxes) return null

  const layersById = new Map<
    string,
    { id: string; layerNo: number; layerName: string; sortOrder: number; expectedQty: number }
  >()

  for (const requirement of session.master_item_boxes.box_layer_requirements) {
    if (!requirement.box_layers) continue
    const existing = layersById.get(requirement.box_layer_id)
    if (existing) {
      existing.expectedQty += requirement.expected_qty
    } else {
      layersById.set(requirement.box_layer_id, {
        id: requirement.box_layer_id,
        layerNo: requirement.box_layers.layer_no,
        layerName: requirement.box_layers.layer_name,
        sortOrder: requirement.box_layers.sort_order,
        expectedQty: requirement.expected_qty,
      })
    }
  }

  const layers = [...layersById.values()]
    .sort((left, right) => left.sortOrder - right.sortOrder)
    .map((layer) => {
      const acceptedQty = session.packing_session_scans.filter(
        (scan) => scan.result === "accepted" && scan.box_layer_id === layer.id,
      ).length

      return {
        id: layer.id,
        layerNo: layer.layerNo,
        layerName: layer.layerName,
        expectedQty: layer.expectedQty,
        acceptedQty,
      }
    })
  const totalExpectedQty = layers.reduce(
    (total, layer) => total + layer.expectedQty,
    0,
  )
  const acceptedQty = layers.reduce(
    (total, layer) => total + layer.acceptedQty,
    0,
  )

  return {
    id: session.id,
    status: session.status,
    version: session.version,
    masterItemPartNo: session.master_items.part_no,
    masterItemName: session.master_items.part_name,
    boxCode: session.master_item_boxes.boxes.box_code,
    boxName: session.master_item_boxes.boxes.box_name,
    acceptedQty,
    totalExpectedQty,
    layers,
    recentScans: [...session.packing_session_scans]
      .sort(
        (left, right) =>
          new Date(right.scanned_at).getTime() -
          new Date(left.scanned_at).getTime(),
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
