import ExcelJS from "exceljs"
import { describe, expect, it } from "vitest"

import { parseScheduleWorkbook } from "@/features/delivery-verification/schedule-excel"

/**
 * Workbook dirakit di sini, bukan disimpan sebagai file contoh: yang diuji
 * adalah bentuk dokumen yang ditemui parser, dan tiap bentuk itu jadi lebih
 * jelas dibaca sebagai daftar sel daripada sebagai berkas biner.
 */
async function workbookBuffer(
  rows: (string | number | null)[][],
): Promise<ArrayBuffer> {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet("Schedule")
  for (const row of rows) sheet.addRow(row)
  const buffer = await workbook.xlsx.writeBuffer()
  return buffer as ArrayBuffer
}

/** Dokumen tanpa kolom Customer atau DO Date menghasilkan baris tanpa keduanya. */
function row(
  productSize: string,
  qty: string,
  customer: string | null = null,
  doDate: string | null = null,
) {
  return { customer, doDate, productSize, qty }
}

describe("parseScheduleWorkbook", () => {
  it("reads Part No and Qty from a plain two-column sheet", async () => {
    const result = await parseScheduleWorkbook(
      await workbookBuffer([
        ["Part No", "Qty"],
        ["TB 3210A-K1Z-NF01-DL", 5000],
        ["3210A-K1Z-NA01-DL", 300],
      ]),
    )

    expect(result).toEqual({
      ok: true,
      rows: [
        row("TB 3210A-K1Z-NF01-DL", "5000"),
        row("3210A-K1Z-NA01-DL", "300"),
      ],
    })
  })

  it("reads a file that carries a single row", async () => {
    const result = await parseScheduleWorkbook(
      await workbookBuffer([
        ["Part No", "Qty"],
        ["TB 3210A-K1Z-NF01-DL", 5000],
      ]),
    )

    expect(result.ok && result.rows).toHaveLength(1)
  })

  // Dokumen jadwal lazim berkop sebelum tabelnya mulai, jadi header tidak bisa
  // dipatok di baris pertama.
  it("finds the header below a document letterhead", async () => {
    const result = await parseScheduleWorkbook(
      await workbookBuffer([
        ["PT. CRT KABELITA", null],
        ["Schedule Delivery", null],
        ["19-AUG-2026", null],
        [null, null],
        ["Part No", "Qty"],
        ["TB 3210A-K1Z-NF01-DL", 5000],
      ]),
    )

    expect(result.ok && result.rows).toEqual([
      row("TB 3210A-K1Z-NF01-DL", "5000"),
    ])
  })

  // Tiap variasi ejaan tidak boleh butuh cabangnya sendiri di parser.
  it.each([
    ["PART_NO", "QTY"],
    ["Part Number", "Quantity"],
    ["part-no", "Qty Delivery"],
    ["No Part", "Jumlah"],
    ["Item No", "Qty"],
  ])("accepts the header spelled %s / %s", async (partHeader, qtyHeader) => {
    const result = await parseScheduleWorkbook(
      await workbookBuffer([
        [partHeader, qtyHeader],
        ["TB 3210A-K1Z-NF01-DL", 5000],
      ]),
    )

    expect(result.ok && result.rows).toEqual([
      row("TB 3210A-K1Z-NF01-DL", "5000"),
    ])
  })

  /**
   * Bentuk DO Report yang dipakai seterusnya: satu file memuat seluruh divisi
   * dan seluruh customer untuk rentang tanggalnya. Yang diambil kolom DO Date,
   * Customer, Item No, dan Qty; yang lain lewat.
   */
  describe("DO Report", () => {
    const HEADER = [
      "DO Date",
      "DONo",
      "Customer PONo",
      "Customer No",
      "Customer",
      "DNNo",
      "Item No",
      "Description",
      "Qty",
      "Unit Price",
      "Divisi",
    ]

    function doRow(
      customer: string,
      itemNo: string,
      qty: number,
      divisi: string,
    ) {
      return [
        "2026-08-21",
        "CRT-DOS26-00327",
        "PO-1",
        "CUST-00018",
        customer,
        null,
        itemNo,
        "VINYL SHEET",
        qty,
        1173,
        divisi,
      ]
    }

    it("takes DO Date, Customer, Item No and Qty from the fixed layout", async () => {
      const result = await parseScheduleWorkbook(
        await workbookBuffer([
          HEADER,
          doRow(
            "PT. CIPTA MANDIRI WIRASAKTI",
            "VS-B T0.3XW100 L=185MM",
            3000,
            "DEVISI SHEET",
          ),
        ]),
      )

      expect(result.ok && result.rows).toEqual([
        row(
          "VS-B T0.3XW100 L=185MM",
          "3000",
          "PT. CIPTA MANDIRI WIRASAKTI",
          "2026-08-21",
        ),
      ])
    })

    /**
     * Tanggal yang tidak berbentuk ISO dikosongkan, bukan ditebak: `03/04`
     * bisa 3 April atau 4 Maret, dan menebaknya lebih buruk daripada
     * membiarkan kartunya tidak menyebut tanggal.
     */
    it("leaves an unparseable DO Date empty instead of guessing", async () => {
      const result = await parseScheduleWorkbook(
        await workbookBuffer([
          HEADER,
          [
            "21/08/2026",
            "CRT-DOS26-00327",
            "PO-1",
            "CUST-00018",
            "PT. CIPTA MANDIRI WIRASAKTI",
            null,
            "VS-B T0.3XW100 L=185MM",
            "VINYL SHEET",
            3000,
            1173,
            "DEVISI SHEET",
          ],
        ]),
      )

      expect(result.ok && result.rows[0].doDate).toBeNull()
    })

    /**
     * "Customer PONo" dan "Customer No" berdiri sebelum kolom "Customer" yang
     * sebenarnya. Pencocokan longgar akan mengambil nomor PO sebagai nama
     * customer, dan salahnya tidak kelihatan sampai ada yang membaca tabelnya.
     */
    it("does not mistake Customer PONo or Customer No for the customer", async () => {
      const result = await parseScheduleWorkbook(
        await workbookBuffer([
          HEADER,
          doRow(
            "PT. INDOPRIMA GEMILANG",
            "VS-A-0,4X70X600MM",
            400,
            "DEVISI SHEET",
          ),
        ]),
      )

      expect(result.ok && result.rows[0].customer).toBe(
        "PT. INDOPRIMA GEMILANG",
      )
    })

    /**
     * Tube dan kabel tidak diverifikasi di halaman ini. Membiarkannya masuk
     * berarti tiap session menyeret ratusan baris yang tidak akan pernah discan
     * siapa pun.
     */
    it("keeps only the sheet division", async () => {
      const result = await parseScheduleWorkbook(
        await workbookBuffer([
          HEADER,
          doRow("PT. HI-LEX INDONESIA", "AP1G724P0", 13800, "DEVISI TUBE"),
          doRow(
            "PT. CIPTA MANDIRI WIRASAKTI",
            "VS-B T0.3XW60 L=255MM",
            7500,
            "DEVISI SHEET",
          ),
          doRow(
            "PT. CASUARINA HARNESSINDO",
            "RBR-INS-ANTENNA FG",
            1110,
            "DEVISI KABEL",
          ),
        ]),
      )

      expect(result.ok && result.rows).toEqual([
        row(
          "VS-B T0.3XW60 L=255MM",
          "7500",
          "PT. CIPTA MANDIRI WIRASAKTI",
          "2026-08-21",
        ),
      ])
    })

    /**
     * Baris tube kerap ber-Qty kosong atau nol. Divisi disaring lebih dulu,
     * jadi baris semacam itu tidak boleh menggagalkan file jadwal sheet.
     */
    it("does not fail on an unreadable Qty in a division it skips", async () => {
      const result = await parseScheduleWorkbook(
        await workbookBuffer([
          HEADER,
          [
            "2026-08-21",
            "CRT-DOT26-01359",
            "PO-1",
            "CUST-00068",
            "PT. HI-LEX INDONESIA",
            null,
            "AP10608P0",
            "PROTECTOR",
            "",
            1007,
            "DEVISI TUBE",
          ],
          doRow(
            "PT. CIPTA MANDIRI WIRASAKTI",
            "VS-B T0.3XW80 L=245MM",
            1500,
            "DEVISI SHEET",
          ),
        ]),
      )

      expect(result.ok && result.rows).toHaveLength(1)
    })

    // Qty nol berarti barisnya tidak jadi dikirim; tidak ada yang perlu
    // diverifikasi, dan barisnya bukan dokumen rusak.
    it("skips a sheet row that ships nothing", async () => {
      const result = await parseScheduleWorkbook(
        await workbookBuffer([
          HEADER,
          doRow(
            "PT. CIPTA MANDIRI WIRASAKTI",
            "VS-B T0.3XW80 L=230MM",
            0,
            "DEVISI SHEET",
          ),
          doRow(
            "PT. CIPTA MANDIRI WIRASAKTI",
            "VS-B T0.3XW80 L=245MM",
            1500,
            "DEVISI SHEET",
          ),
        ]),
      )

      expect(result.ok && result.rows).toEqual([
        row(
          "VS-B T0.3XW80 L=245MM",
          "1500",
          "PT. CIPTA MANDIRI WIRASAKTI",
          "2026-08-21",
        ),
      ])
    })

    /**
     * File yang hanya berisi tube bukan dokumen rusak, cuma bukan jadwal sheet.
     * Pesannya harus mengatakan itu, bukan menyuruh operator memeriksa judul
     * kolomnya.
     */
    it("separates a tube-only file from a broken one", async () => {
      const result = await parseScheduleWorkbook(
        await workbookBuffer([
          HEADER,
          doRow("PT. HI-LEX INDONESIA", "AP1G724P0", 13800, "DEVISI TUBE"),
        ]),
      )

      expect(!result.ok && result.code).toBe("SCHEDULE_NO_SHEET_ROWS")
    })
  })

  /**
   * Bentuk dokumen jadwal lama: kolom nomor urut di depan, header "Part no",
   * dan Part No yang kerap berspasi ekor karena diketik tangan. Tanpa kolom
   * Divisi, seluruh barisnya dibaca seperti dulu.
   */
  it("reads the older delivery schedule with no division column", async () => {
    const result = await parseScheduleWorkbook(
      await workbookBuffer([
        ["No", "Part no", "Qty"],
        [1, "VS-X T0.3XW100 L=120MM", 2000],
        [2, "VS-X T0.3XW100 L=185MM ", 3000],
        [3, "VS-X T0.3XW60 L=110 MM ", 6000],
      ]),
    )

    expect(result.ok && result.rows).toEqual([
      row("VS-X T0.3XW100 L=120MM", "2000"),
      row("VS-X T0.3XW100 L=185MM", "3000"),
      // Spasi di dalam nama dipertahankan apa adanya; hanya yang di ujung
      // dibuang dan yang berderet dirapatkan jadi satu.
      row("VS-X T0.3XW60 L=110 MM", "6000"),
    ])
  })

  it("ignores columns that sit between Part No and Qty", async () => {
    const result = await parseScheduleWorkbook(
      await workbookBuffer([
        ["No", "Part No", "Part Name", "Qty"],
        [1, "TB 3210A-K1Z-NF01-DL", "Tube Assy", 5000],
      ]),
    )

    expect(result.ok && result.rows).toEqual([
      row("TB 3210A-K1Z-NF01-DL", "5000"),
    ])
  })

  // Baris kosong pemisah, subtotal, dan catatan kaki bukan kiriman.
  it("skips rows that carry no Part No", async () => {
    const result = await parseScheduleWorkbook(
      await workbookBuffer([
        ["Part No", "Qty"],
        ["TB 3210A-K1Z-NF01-DL", 5000],
        [null, null],
        [null, 5000],
        ["3210A-K1Z-NA01-DL", 300],
      ]),
    )

    expect(result.ok && result.rows).toHaveLength(2)
  })

  it.each([
    ["5.000", "5000"],
    ["5,000", "5000"],
    ["5000 pcs", "5000"],
    ["  300  ", "300"],
    ["0300", "300"],
  ])("reads the quantity written as %s", async (written, expected) => {
    const result = await parseScheduleWorkbook(
      await workbookBuffer([
        ["Part No", "Qty"],
        ["TB 3210A-K1Z-NF01-DL", written],
      ]),
    )

    expect(result.ok && result.rows[0].qty).toBe(expected)
  })

  // Part No yang ada tapi Qty-nya tidak terbaca menggagalkan seluruh file.
  // Melewatinya berarti kiriman hilang dari jadwal tanpa ada yang tahu, dan itu
  // baru ketahuan ketika labelnya tidak punya baris untuk dicocokkan.
  it.each([
    ["", "kosong"],
    ["5000.4", "pecahan"],
    ["lima ribu", "kata"],
  ])("fails the whole file when a quantity is %s", async (written) => {
    const result = await parseScheduleWorkbook(
      await workbookBuffer([
        ["Part No", "Qty"],
        ["TB 3210A-K1Z-NF01-DL", written],
      ]),
    )

    expect(result.ok).toBe(false)
    expect(!result.ok && result.code).toBe("SCHEDULE_QTY_INVALID")
  })

  it("reports a missing header instead of guessing the columns", async () => {
    const result = await parseScheduleWorkbook(
      await workbookBuffer([
        ["Kode", "Banyak"],
        ["TB 3210A-K1Z-NF01-DL", 5000],
      ]),
    )

    expect(!result.ok && result.code).toBe("SCHEDULE_HEADER_NOT_FOUND")
  })

  it("reports a header with no rows under it", async () => {
    const result = await parseScheduleWorkbook(
      await workbookBuffer([["Part No", "Qty"]]),
    )

    expect(!result.ok && result.code).toBe("SCHEDULE_NO_ROWS")
  })

  it("reports an unreadable file rather than throwing", async () => {
    const notAWorkbook = new TextEncoder().encode("bukan file excel")
    const result = await parseScheduleWorkbook(
      notAWorkbook.buffer as ArrayBuffer,
    )

    expect(!result.ok && result.code).toBe("SCHEDULE_FILE_UNREADABLE")
  })
})
