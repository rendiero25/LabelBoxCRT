import type { CsvImportRow } from "@/features/csv-imports/csv"

export const csvImportTemplates = {
  suppliers: {
    databaseType: "supplier",
    label: "Supplier",
    headers: ["supplier_code", "supplier_name"],
    sample: "supplier_code,supplier_name\n10015,PT Supplier Contoh\n",
  },
  products: {
    databaseType: "product",
    label: "Product",
    headers: ["part_name", "outer_diameter", "inner_diameter", "length"],
    sample: "part_name,outer_diameter,inner_diameter,length\nTube,6,5,205\n",
  },
  masterItems: {
    databaseType: "master_item",
    label: "Master Item",
    headers: [
      "item_code",
      "part_no",
      "part_name",
      "unit",
      "default_label_qty",
      "item_sequence_code",
    ],
    sample:
      "item_code,part_no,part_name,unit,default_label_qty,item_sequence_code\ndm-0001,3210A-K1Z-NA01-DL,Tube Assy,Pcs,100,\n",
  },
  productMappings: {
    databaseType: "product_mapping",
    label: "Product Mapping",
    headers: ["item_code", "product_code"],
    sample: "item_code,product_code\ndm-0001,prd-000001\n",
  },
  deliveryNumbers: {
    databaseType: "delivery_number",
    label: "Delivery Number",
    headers: ["supplier_code", "delivery_number", "delivery_date", "status"],
    sample:
      "supplier_code,delivery_number,delivery_date,status\n10015,DN-2026-0001,2026-07-20,active\n",
  },
} as const

export type CsvImportTemplateKey = keyof typeof csvImportTemplates

export const csvImportTemplateKeys = Object.keys(
  csvImportTemplates,
) as CsvImportTemplateKey[]

export function isCsvImportTemplate(
  value: string,
): value is CsvImportTemplateKey {
  return value in csvImportTemplates
}

export function getCsvImportTemplate(key: CsvImportTemplateKey) {
  return csvImportTemplates[key]
}

export function toCsvImportPayload(rows: CsvImportRow[]) {
  return rows.map(({ line, values }) => ({ line, ...values }))
}
