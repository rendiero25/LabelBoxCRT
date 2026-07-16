import { TruckIcon } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { DeliveryNumberDirectory } from "@/features/delivery-numbers/components/delivery-number-directory"
import { requireAdmin } from "@/features/auth/server"
import { createClient } from "@/lib/supabase/server"

export default async function DeliveryNumbersPage() {
  await requireAdmin()
  const supabase = await createClient()
  const [deliveryResult, supplierResult] = await Promise.all([
    supabase
      .from("delivery_numbers")
      .select("id, supplier_id, delivery_number, delivery_date, status")
      .order("delivery_date", { ascending: false }),
    supabase
      .from("suppliers")
      .select("id, supplier_code, supplier_name, is_active")
      .order("supplier_code"),
  ])
  const error = deliveryResult.error ?? supplierResult.error

  return (
    <div className="flex max-w-6xl flex-col gap-8">
      <div className="flex flex-col gap-2">
        <p className="text-muted-foreground text-sm font-medium">Phase 4.2</p>
        <h1 className="text-2xl font-semibold">Delivery Number</h1>
        <p className="text-muted-foreground text-sm">
          Delivery Number aktif tersedia untuk proses operator. Closed dan
          cancelled adalah status terminal demi integritas riwayat.
        </p>
      </div>

      {error ? (
        <Alert variant="destructive">
          <TruckIcon />
          <AlertTitle>Data Delivery Number tidak dapat dimuat</AlertTitle>
          <AlertDescription>
            Periksa koneksi Supabase atau izin admin.
          </AlertDescription>
        </Alert>
      ) : null}

      <DeliveryNumberDirectory
        deliveryNumbers={deliveryResult.data ?? []}
        suppliers={supplierResult.data ?? []}
      />
    </div>
  )
}
