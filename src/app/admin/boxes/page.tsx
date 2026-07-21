import { BoxesIcon } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { requireAdmin } from "@/features/auth/server"
import { BoxDirectory, type Box } from "@/features/boxes/components/box-directory"
import { createClient } from "@/lib/supabase/server"

type BoxLayerRow = {
  id: string
  layer_no: number
  layer_name: string
}

type BoxRow = {
  id: string
  box_code: string
  box_name: string
  is_active: boolean
  box_layers: BoxLayerRow[]
}

type MasterItemBoxRow = { box_id: string }

export default async function BoxesPage() {
  await requireAdmin()
  const supabase = await createClient()
  const [boxesResult, assignmentsResult] = await Promise.all([
    supabase
      .from("boxes")
      .select("id, box_code, box_name, is_active, box_layers(id, layer_no, layer_name)")
      .order("box_code"),
    supabase.from("master_item_boxes").select("box_id"),
  ])

  const boxes = (boxesResult.data ?? []) as BoxRow[]
  const usedBoxIds = new Set(
    ((assignmentsResult.data ?? []) as MasterItemBoxRow[]).map(
      (assignment) => assignment.box_id,
    ),
  )
  const hasError = Boolean(boxesResult.error) || Boolean(assignmentsResult.error)

  const directoryBoxes: Box[] = boxes.map((box) => ({
    id: box.id,
    boxCode: box.box_code,
    boxName: box.box_name,
    isActive: box.is_active,
    isUsed: usedBoxIds.has(box.id),
    layers: box.box_layers
      .map((layer) => ({
        id: layer.id,
        layerNo: layer.layer_no,
        name: layer.layer_name,
      }))
      .sort((a, b) => a.layerNo - b.layerNo),
  }))

  return (
    <div className="flex w-full flex-col gap-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">Box</h1>
        <p className="text-muted-foreground text-sm">
          Master data box dan layer. Produk per layer diatur dari halaman
          Master Item setelah box dipilih.
        </p>
      </div>

      {hasError ? (
        <Alert variant="destructive">
          <BoxesIcon />
          <AlertTitle>Data Box tidak dapat dimuat</AlertTitle>
          <AlertDescription>
            Periksa koneksi Supabase atau izin admin.
          </AlertDescription>
        </Alert>
      ) : null}

      <BoxDirectory boxes={directoryBoxes} />
    </div>
  )
}
