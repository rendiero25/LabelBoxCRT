import {
  LABEL_FONT_BOLD,
  LABEL_FONT_REGULAR,
  labelFontPath,
} from "@/lib/label/font"
import type { FormattedLabelFields } from "@/lib/label/formatter"

/**
 * ZPL template v4 for Zebra ZD220 (203 dpi), media 75 mm x 55 mm landscape
 * with 3 mm gap, thermal-transfer wax ribbon.
 *
 * v8 menambah dua baris: "Part Name" (nilai tetap "Tube", di bawah Part No)
 * dan "Packing Date" (di atas Delivery Date). Sembilan baris jadi sebelas,
 * dan supaya tetap muat di tinggi label yang tetap, seluruh baris menyempit
 * dari 40 ke 33 dot dan setiap font ikut mengecil sebanding.
 *
 * v11 menutup blok angka bulan pada label tanpa QR dengan garis melintang
 * penuh (y=134), sebaris dengan garis di atas PART NO, sehingga teks "FIFO PT
 * CRT" punya atap seperti pada label ber-QR. Sebelumnya garis itu berhenti di
 * kolom kanan dan penanda FIFO mengambang tanpa pemisah dari angka bulannya.
 *
 * v10 mengisi baris Operator Pack dengan nama yang diketik saat batchnya
 * dibuat, menggantikan teks tetap "AD | SR | ST" yang memuat ketiga nama
 * operator sekaligus untuk dilingkari dengan pena. Panjang namanya tidak bisa
 * diperkirakan, jadi barisnya ikut merapatkan hurufnya seperti baris Customer.
 *
 * v9 membuat QR jadi milik satu label saja. Hanya label pertama batch (box 1
 * set 1) yang membawanya; sisanya memakai kolom kanan yang sama untuk penanda
 * FIFO belaka, dengan angka bulan yang membesar mengisi bekas tempat QR. Nilai
 * Lot No sekaligus naik jadi 26 dot dan Bold: itu penanda yang dibaca operator
 * saat mencocokkan box dengan surat jalan.
 *
 * v7 menyusun ulang isi barisnya. "Item List" dan "No Box" tidak lagi berdiri
 * sendiri: keduanya masuk ke baris Lot No sebagai satu rangkaian penanda.
 * Tempat yang terbebas dipakai baris Customer (nama supplier), Operator Pack,
 * dan satu baris penuh "QC Passes" tanpa kolom nilai untuk cap QC. Barisnya
 * jadi sembilan, jadi tingginya turun dari 44 ke 40 dot.
 *
 * v6 memanjangkan kolom kanan ke bawah QR untuk dua penanda FIFO: angka bulan
 * setinggi dua baris lalu satu baris "FIFO PT CRT". Seluruh teksnya juga naik
 * dari SemiBold ke Bold.
 *
 * v5 memakai font TrueType Outfit yang ditanam ke memori printer, sama dengan
 * font aplikasi, menggantikan font resident ^A0. Lebar hurufnya tidak seragam
 * sehingga pemotongan teks diserahkan ke ^FB.
 *
 * v4 mengganti tata letak tumpuk v3 dengan tabel bergaris: kop nama perusahaan
 * di atas, lalu delapan baris "label | nilai", dan QR menempel di kanan atas
 * mengapit tiga baris pertama. Media berubah dari potret 55x75 menjadi
 * mendatar 75x55, jadi seluruh geometrinya dihitung ulang.
 */
export const TEMPLATE_VERSION = "v11"

const DOTS_PER_MM = 8
export const LABEL_WIDTH_DOTS = 75 * DOTS_PER_MM // 600
export const LABEL_LENGTH_DOTS = 55 * DOTS_PER_MM // 440

const COMPANY_NAME = "PT. CRT KABELITA"

/** Garis luar dan garis pemisah; 2 dot sudah pekat pada 203 dpi. */
const BORDER_DOTS = 2
const FRAME_X = 8
const FRAME_Y = 8
const FRAME_WIDTH = LABEL_WIDTH_DOTS - FRAME_X * 2 // 584
const FRAME_HEIGHT = LABEL_LENGTH_DOTS - FRAME_Y * 2 // 424

const HEADER_HEIGHT = 60
const ROWS_TOP = FRAME_Y + HEADER_HEIGHT // 68
const ROW_COUNT = 11
const ROW_HEIGHT = 33 // 11 x 33 = 363; 68 + 363 = 431, sisa 1 dot di bawah
const ROWS_BOTTOM = ROWS_TOP + ROW_COUNT * ROW_HEIGHT
/** Baris terakhir tidak berkolom; garis pemisah kolom berhenti di atasnya. */
const FULL_WIDTH_ROW_TOP = ROWS_TOP + (ROW_COUNT - 1) * ROW_HEIGHT

/**
 * Kolom kiri memuat nama field, kolom kanan nilainya. Lebar kolom kiri pas untuk
 * nama terpanjang ("Delivery Date", "Operator Pack") pada ukuran hurufnya dan
 * tidak lebih; sisa ruangnya diberikan ke kolom nilai.
 *
 * Garisnya digeser dari 146 ke 184 dot supaya nama fieldnya muat pada 16 dot:
 * 13 huruf x 0.72 x 16 = 150 dot, sedangkan blok namanya 184 - 22 - 8 = 154.
 * Kolom nilai kehilangan 38 dot yang sama, jadi nilai terpanjang — nama
 * supplier dan Lot No — dirapatkan sedikit lebih jauh dari sebelumnya.
 */
const LABEL_COLUMN_X = FRAME_X + 14
const VALUE_DIVIDER_X = 184
const VALUE_COLUMN_X = VALUE_DIVIDER_X + 14

/**
 * QR berdiri di kanan atas sebagai satu blok utuh: kolomnya dimulai dari tepi
 * atas bingkai, bukan dari bawah kop, dan garis mendatar kop maupun tiga baris
 * pertama berhenti di kolom ini. Tanpa itu ada garis melintas di belakang QR.
 *
 * Ukuran QR dihitung dari payload, bukan dipatok. Jumlah modul naik mengikuti
 * panjang data, dan magnifikasi ZPL hanya menerima bilangan bulat, jadi ukuran
 * yang dipatok akan meleset ke dua arah: menembus bingkai saat payload panjang,
 * atau menyisakan kolom setengah kosong saat payload pendek.
 */
const QR_COLUMN_X = 452
const QR_ROWS = 3
const QR_COLUMN_BOTTOM = ROWS_TOP + QR_ROWS * ROW_HEIGHT
/** Sisa 2 dot di tiap sisi supaya QR tidak menyentuh garis kolomnya. */
const QR_PADDING = 2
const QR_AVAILABLE_WIDTH = FRAME_X + FRAME_WIDTH - QR_COLUMN_X - QR_PADDING * 2
const QR_AVAILABLE_HEIGHT = QR_COLUMN_BOTTOM - FRAME_Y - QR_PADDING * 2

/**
 * Di bawah QR, kolom kanan tetap berdiri untuk dua blok penanda FIFO: angka
 * bulan setinggi dua baris (sejajar Qty/Box dan Qty/Delivery) lalu satu baris
 * "FIFO PT CRT" (sejajar Delivery Date). Keduanya blok utuh tanpa nama field,
 * jadi garis antar baris di dalam blok bulan tidak digambar.
 */
const MONTH_TOP = QR_COLUMN_BOTTOM
const MONTH_ROWS = 2
const MONTH_BOTTOM = MONTH_TOP + MONTH_ROWS * ROW_HEIGHT
const FIFO_BOTTOM = MONTH_BOTTOM + ROW_HEIGHT
/** Kolom kanan berhenti di sini; di bawahnya baris kembali selebar bingkai. */
const RIGHT_COLUMN_BOTTOM = FIFO_BOTTOM

/**
 * Kolom kanan label tanpa QR: penanda FIFO menempati persis jejak QR — dari
 * tepi atas bingkai sampai dasar blok QR — bukan seluruh tinggi kolom kanan.
 * Angka bulan mengambil bagian atasnya, satu baris terakhir untuk teks FIFO,
 * dan di bawah 167 dot barisnya kembali selebar bingkai seperti baris tabel
 * lain: tidak ada lagi kolom kanan yang perlu dihindari di sana.
 */
const NO_QR_FIFO_TOP = QR_COLUMN_BOTTOM - ROW_HEIGHT
const NO_QR_RIGHT_COLUMN_BOTTOM = QR_COLUMN_BOTTOM

const FIFO_TEXT = "FIFO PT CRT"
/** Blok teks kolom kanan, disisakan 4 dot dari garis kolom dan tepi bingkai. */
const RIGHT_TEXT_PADDING = 4
const RIGHT_TEXT_X = QR_COLUMN_X + RIGHT_TEXT_PADDING
const RIGHT_TEXT_WIDTH =
  FRAME_X + FRAME_WIDTH - RIGHT_TEXT_X - RIGHT_TEXT_PADDING

/**
 * Kapasitas byte mode QR model 2 pada level koreksi M, versi 1 sampai 10.
 * Indeksnya versi dikurangi satu; jumlah modul tiap versi adalah 21 + 4(v-1).
 */
const QR_BYTE_CAPACITY_EC_M = [14, 26, 42, 62, 84, 106, 122, 152, 180, 213]

export function qrModulesFor(payloadLength: number): number {
  const version = QR_BYTE_CAPACITY_EC_M.findIndex(
    (capacity) => payloadLength <= capacity,
  )
  // Payload melebihi versi 10 tetap dihitung sebagai versi 10: ukurannya jadi
  // perkiraan terbaik yang masih muat, bukan pembagian dengan angka negatif.
  const resolved = version === -1 ? QR_BYTE_CAPACITY_EC_M.length - 1 : version
  return 21 + 4 * resolved
}

/** Magnifikasi terbesar yang masih muat, dibatasi rentang sah ZPL 1-10. */
export function qrMagnificationFor(
  modules: number,
  availableDots: number,
): number {
  return Math.min(10, Math.max(1, Math.floor(availableDots / modules)))
}

/**
 * Nama field satu ukuran untuk seluruh kolom kiri, diambil dari nama terpanjang
 * ("Delivery Date", "Operator Pack") yang masih muat di 146 dot. Sebelumnya
 * tiap nama dikecilkan sendiri-sendiri oleh perender HTML kalau kepanjangan,
 * sehingga kolom kiri terbaca bergerigi: "Customer" besar, "Operator Pack"
 * kecil, padahal keduanya nama field yang sederajat.
 *
 * Tingginya terikat lebar kolomnya: nama terpanjang 13 huruf menghabiskan
 * 13 x 0.72 x tinggi dot, dan itu harus tetap di bawah lebar blok namanya.
 * Pada 16 dot butuh 150 dari 154 dot yang tersedia. Menaikkannya lagi berarti
 * menggeser VALUE_DIVIDER_X ke kanan lebih dulu — kalau tidak, justru nama
 * terpanjang saja yang menyusut dan kolom kiri kembali bergerigi.
 */
const LABEL_FONT = { height: 16, width: 8 }
const VALUE_FONT = { height: 23, width: 12 }
/** Kop nama perusahaan seukuran isinya, bukan judul yang menjulang di atasnya. */
const COMPANY_FONT = VALUE_FONT
/**
 * "QC Passes" bukan nama field: ia judul ruang kosong tempat QC membubuhkan
 * capnya, jadi ia tetap sebesar nilai-nilai di atasnya.
 */
const QC_FONT = VALUE_FONT
/** Part No dicetak paling tinggi; itu field yang dicari operator lebih dulu. */
const PART_NO_FONT = { height: 26, width: 11 }
/**
 * Nama supplier setinggi nilai lain. Lebarnya tidak dipatok — fitValueToColumn
 * yang merapatkan hurufnya sampai muat di kolomnya, jadi nama pendek tercetak
 * penuh dan nama panjang tetap utuh, tidak terpotong.
 */
const CUSTOMER_FONT = VALUE_FONT
/**
 * Lot No dicetak setinggi Part No dan Bold. Baris ini memuat tiga penanda
 * sekaligus — nomor urut Master Item, lot, dan nomor box — dan itu yang
 * dicocokkan operator dengan surat jalan; seukuran nilai biasa ia tenggelam di
 * antara sepuluh baris lain.
 */
const LOT_NO_FONT = { height: 26, width: 13 }
/** Angka bulan mengisi tinggi dua baris; ini penanda yang dibaca dari jauh. */
const MONTH_FONT = { height: 51, width: 28 }
/**
 * Angka bulan di label tanpa QR, mengisi bagian atas jejak QR. Tingginya bukan
 * sebesar ruangnya: yang membatasi adalah lebar kolom kanan, dan bulan dua
 * digit pada 88 dot sudah memakai 127 dari 132 dot yang ada. Huruf yang lebih
 * tinggi hanya akan dipersempit lagi oleh perender HTML, sehingga label Zebra
 * dan label kertas tidak lagi sebangun.
 */
const MONTH_FONT_NO_QR = { height: 88, width: 46 }
const FIFO_FONT = { height: 20, width: 10 }

type ZplFont = { height: number; width: number }

/**
 * ^FH hex-escape (underscore prefix). Underscore itself must be replaced
 * first so escape sequences are not double-escaped.
 */
export function escapeZplText(value: string): string {
  return value
    .replaceAll("_", "_5f")
    .replaceAll("^", "_5e")
    .replaceAll("~", "_7e")
    .replace(/[\x00-\x1f\x7f]/g, "")
}

/**
 * Taksiran advance rata-rata satu huruf sebagai pecahan lebar nominal. Outfit
 * lebih rapat dari ini; taksiran yang longgar hanya membuat huruf sedikit lebih
 * kecil dari perlunya, sedangkan taksiran yang terlalu sempit membuat ^FB
 * memotong teksnya diam-diam dan potongannya baru ketahuan setelah label
 * menempel di box.
 */
const AVERAGE_ADVANCE_RATIO = 0.75

/**
 * Lebar huruf terbesar yang teksnya masih muat utuh di bloknya, dibatasi lebar
 * nominal barisnya. Tingginya tidak ikut turun: dalam satu tabel, baris yang
 * tiba-tiba lebih pendek terbaca sebagai baris yang kurang penting.
 */
export function fitFontWidth(
  text: string,
  blockWidthDots: number,
  nominalWidth: number,
): number {
  if (text.length === 0) return nominalWidth

  const fitted = Math.floor(
    blockWidthDots / (text.length * AVERAGE_ADVANCE_RATIO),
  )
  return Math.max(1, Math.min(nominalWidth, fitted))
}

export type LabelRow = {
  /**
   * Nilainya dicetak Bold. Hanya untuk angka yang dicari operator lebih dulu;
   * kalau seluruh kolom nilai Bold, tidak ada satu pun yang menonjol.
   */
  boldValue?: boolean
  /**
   * Rapatkan huruf nilainya kalau tidak muat. Dipakai baris yang nilainya kata
   * bebas, bukan kode berformat tetap: panjangnya tidak bisa diperkirakan saat
   * tata letaknya dirancang.
   */
  fitValueToColumn?: boolean
  font: ZplFont
  label: string
  /** Huruf nama fieldnya, kalau baris itu bukan nama field biasa. */
  labelFont?: ZplFont
  /**
   * Baris tanpa kolom nilai: nama barisnya ditengahkan selebar bingkai dan
   * sisanya sengaja dikosongkan untuk dibubuhi tangan atau cap.
   */
  spansRow?: boolean
  value: string
}

const QC_PASSES_TEXT = "QC Passes"
/** Semua Master Item saat ini bertipe tube; nilainya tetap, bukan dari fields. */
const PART_NAME_TEXT = "Tube"

/**
 * Kedua kolom dicetak huruf besar. Huruf kecil pada cetakan termal di media
 * buram lebih cepat kehilangan bentuk daripada huruf besar, dan nama field
 * yang setengah besar setengah kecil terbaca sebagai dua jenis keterangan.
 */
function upper(value: string): string {
  return value.toUpperCase()
}

/**
 * Sebelas baris label beserta beratnya, dipisahkan dari perakit ZPL supaya
 * perender HTML untuk printer kertas memakai daftar yang sama persis. Urutan
 * dan pilihan hurufnya cuma boleh berubah di satu tempat.
 */
export function labelRowsFor(fields: FormattedLabelFields): LabelRow[] {
  return [
    {
      fitValueToColumn: true,
      font: CUSTOMER_FONT,
      label: upper("Customer"),
      value: upper(fields.supplierName),
    },
    {
      font: VALUE_FONT,
      label: upper("Supplier ID"),
      value: upper(fields.supplierCode),
    },
    // Ketiga baris inilah yang dicari operator lebih dulu di gudang, jadi cuma
    // nilai-nilai ini yang Bold; sisanya berat biasa supaya keduanya terbedakan
    // dari seberang meja, bukan cuma setelah dibaca.
    {
      boldValue: true,
      fitValueToColumn: true,
      font: PART_NO_FONT,
      label: upper("Part No"),
      value: upper(fields.partNo),
    },
    // Semua Master Item saat ini bertipe tube; nilainya konstan, berbeda
    // dengan baris lain yang datanya ikut batch/master item.
    {
      font: VALUE_FONT,
      label: upper("Part Name"),
      value: upper(PART_NAME_TEXT),
    },
    {
      boldValue: true,
      font: VALUE_FONT,
      label: upper("Qty/Box"),
      value: upper(fields.packingQty),
    },
    {
      boldValue: true,
      font: VALUE_FONT,
      label: upper("Qty/Delivery"),
      value: upper(fields.qtyDelivery),
    },
    // Packing Date dan keempat baris di bawahnya sudah di luar kolom kanan
    // (QR, bulan, dan FIFO berhenti sebelum baris ini), jadi nilainya selebar
    // bingkai. Lot No yang memuat tiga penanda sekaligus ditaruh di baris
    // pertamanya karena itu nilai terpanjang di label.
    {
      font: VALUE_FONT,
      label: upper("Packing Date"),
      value: fields.packingDate,
    },
    {
      font: VALUE_FONT,
      label: upper("Delivery Date"),
      value: fields.deliveryDate,
    },
    {
      boldValue: true,
      fitValueToColumn: true,
      font: LOT_NO_FONT,
      label: upper("Lot No"),
      value: upper(fields.lotNo),
    },
    // Nama yang diketik operator, panjangnya bebas, jadi hurufnya dirapatkan
    // sampai muat seperti baris Customer -- bukan dipotong ^FB di tepi kolom.
    {
      fitValueToColumn: true,
      font: VALUE_FONT,
      label: upper("Operator Pack"),
      value: upper(fields.operatorName),
    },
    {
      font: VALUE_FONT,
      label: QC_PASSES_TEXT,
      labelFont: QC_FONT,
      spansRow: true,
      value: "",
    },
  ]
}

/**
 * Seluruh geometri label dalam dot pada 203 dpi. Diekspor supaya perender HTML
 * menurunkan ukuran milimeternya dari angka yang sama, bukan menyalin ulang:
 * label yang keluar dari Zebra dan dari printer kertas harus sebangun.
 */
export const LABEL_LAYOUT = {
  borderDots: BORDER_DOTS,
  companyFont: COMPANY_FONT,
  companyName: COMPANY_NAME,
  fifoBottom: FIFO_BOTTOM,
  fifoFont: FIFO_FONT,
  fifoText: FIFO_TEXT,
  frameHeight: FRAME_HEIGHT,
  frameWidth: FRAME_WIDTH,
  frameX: FRAME_X,
  frameY: FRAME_Y,
  fullWidthRowTop: FULL_WIDTH_ROW_TOP,
  headerHeight: HEADER_HEIGHT,
  labelColumnX: LABEL_COLUMN_X,
  labelFont: LABEL_FONT,
  labelHeight: LABEL_LENGTH_DOTS,
  labelWidth: LABEL_WIDTH_DOTS,
  monthBottom: MONTH_BOTTOM,
  /** Tanpa QR, blok bulan berakhir satu baris di atas dasar jejak QR. */
  monthBottomNoQr: NO_QR_FIFO_TOP,
  monthFont: MONTH_FONT,
  monthFontNoQr: MONTH_FONT_NO_QR,
  monthTop: MONTH_TOP,
  /** Tanpa QR, blok bulan mulai dari tepi atas bingkai, bukan dari bawah QR. */
  monthTopNoQr: FRAME_Y,
  noQrFifoTop: NO_QR_FIFO_TOP,
  noQrRightColumnBottom: NO_QR_RIGHT_COLUMN_BOTTOM,
  qrAvailableWidth: QR_AVAILABLE_WIDTH,
  qrColumnBottom: QR_COLUMN_BOTTOM,
  qrColumnX: QR_COLUMN_X,
  rightColumnBottom: RIGHT_COLUMN_BOTTOM,
  rightTextWidth: RIGHT_TEXT_WIDTH,
  rightTextX: RIGHT_TEXT_X,
  rowHeight: ROW_HEIGHT,
  rowsBottom: ROWS_BOTTOM,
  rowsTop: ROWS_TOP,
  valueColumnX: VALUE_COLUMN_X,
  valueDividerX: VALUE_DIVIDER_X,
} as const

/** Dot per milimeter pada 203 dpi, dipakai perender HTML untuk menskala ulang. */
export const LABEL_DOTS_PER_MM = DOTS_PER_MM

/**
 * TrueType punya lebar huruf yang berbeda-beda, jadi muat atau tidaknya tidak
 * bisa dihitung dari jumlah karakter seperti pada font resident. ^FB menyerahkan
 * pemotongan kepada printer: teks dibatasi selebar kolomnya, satu baris saja.
 */
function textCommand(
  x: number,
  y: number,
  font: ZplFont,
  blockWidth: number,
  text: string,
  bold: boolean,
  align: "C" | "L" = "L",
): string {
  const fontPath = labelFontPath(bold ? LABEL_FONT_BOLD : LABEL_FONT_REGULAR)

  return (
    `^FO${x},${y}` +
    `^A@N,${font.height},${font.width},${fontPath}` +
    `^FB${blockWidth},1,0,${align},0` +
    `^FH^FD${text}^FS`
  )
}

/**
 * Satu label sebagai ZPL. `showQr` mematikan QR-nya: hanya label pertama batch
 * yang membawa QR, dan pada label lain kolom kanan yang sama dipakai penanda
 * FIFO saja — angka bulannya membesar mengisi bekas tempat QR.
 */
export function buildLabelZpl(
  fields: FormattedLabelFields,
  { showQr = true }: { showQr?: boolean } = {},
): string {
  const rows = labelRowsFor(fields)
  const monthTop = showQr ? MONTH_TOP : FRAME_Y
  const monthBottom = showQr ? MONTH_BOTTOM : NO_QR_FIFO_TOP
  const monthFont = showQr ? MONTH_FONT : MONTH_FONT_NO_QR
  const fifoTop = showQr ? MONTH_BOTTOM : NO_QR_FIFO_TOP
  const rightColumnBottom = showQr
    ? RIGHT_COLUMN_BOTTOM
    : NO_QR_RIGHT_COLUMN_BOTTOM

  const commands = [
    "^XA",
    "^CI28",
    "^MTT",
    "^PW600",
    "^LL440",
    "^MNY",
    "^LH0,0",
  ]

  // Lebar garis mendatar: garis yang jatuh di tengah blok kolom kanan berhenti
  // di kolom itu, sedangkan garis yang justru menutup sebuah blok — di bawah
  // QR, di bawah angka bulan, di bawah FIFO — melintang penuh.
  //
  // Empat garis karenanya berhenti di x=452: tiga mengapit QR, dan satu jatuh
  // di tengah blok angka bulan yang setinggi dua baris. Ini disengaja, bukan
  // garis yang terlupa. Menembus QR membuatnya gagal dipindai, dan menembus
  // angka bulan membelah angkanya. Kolom kanan adalah kolomnya sendiri dengan
  // sel yang lebih tinggi; batas selnya tetap digambar di y=167, 233, dan 266.
  // Setiap batas baris lain wajib punya garisnya — dijaga oleh tes yang
  // mencocokkan posisi seluruh garis, bukan cuma jumlahnya.
  //
  // Tanpa QR, penanda FIFO menempati jejak QR itu sendiri: angka bulan di
  // bagian atasnya lalu teks FIFO di baris terakhir jejak itu. Yang berhenti
  // hanya garis di dalam blok bulan (y=68 dan 101); y=134 adalah dasar blok itu
  // sekaligus atap baris FIFO, jadi ia melintang penuh — sebaris dengan garis
  // di atas PART NO — persis seperti y=233 pada label ber-QR. y=167 tetap
  // garis penutup baris FIFO.
  const ruleWidth = (y: number) =>
    (
      showQr
        ? y < QR_COLUMN_BOTTOM || (y > MONTH_TOP && y < MONTH_BOTTOM)
        : y < NO_QR_FIFO_TOP
    )
      ? QR_COLUMN_X - FRAME_X
      : FRAME_WIDTH

  commands.push(
    `^FO${FRAME_X},${FRAME_Y}^GB${FRAME_WIDTH},${FRAME_HEIGHT},${BORDER_DOTS}^FS`,
    `^FO${FRAME_X},${ROWS_TOP}^GB${ruleWidth(ROWS_TOP)},0,${BORDER_DOTS}^FS`,
    // Garis pemisah kolom berhenti di baris terakhir, bukan di dasar bingkai:
    // baris QC Passes tidak berkolom, dan garis yang menembusnya membelah
    // ruang cap QC jadi dua.
    `^FO${VALUE_DIVIDER_X},${ROWS_TOP}^GB0,${FULL_WIDTH_ROW_TOP - ROWS_TOP},${BORDER_DOTS}^FS`,
    // Kolom kanan berdiri dari tepi atas bingkai sampai akhir baris FIFO.
    `^FO${QR_COLUMN_X},${FRAME_Y}^GB0,${rightColumnBottom - FRAME_Y},${BORDER_DOTS}^FS`,
  )

  const labelBlockWidth = VALUE_DIVIDER_X - LABEL_COLUMN_X - 8

  commands.push(
    textCommand(
      LABEL_COLUMN_X,
      // Ditengahkan di kopnya seperti perender HTML menengahkannya lewat
      // flexbox; angka tetap hanya kebetulan pas pada tinggi huruf yang lama.
      FRAME_Y + Math.floor((HEADER_HEIGHT - COMPANY_FONT.height) / 2),
      COMPANY_FONT,
      QR_COLUMN_X - LABEL_COLUMN_X - 14,
      escapeZplText(COMPANY_NAME),
      true,
    ),
  )

  rows.forEach((row, index) => {
    const rowTop = ROWS_TOP + index * ROW_HEIGHT
    const valueRight =
      rowTop < rightColumnBottom ? QR_COLUMN_X : FRAME_X + FRAME_WIDTH
    const valueBlockWidth = valueRight - VALUE_COLUMN_X - 14
    const font = row.fitValueToColumn
      ? {
          height: row.font.height,
          width: fitFontWidth(row.value, valueBlockWidth, row.font.width),
        }
      : row.font

    // Garis pemisah antar baris; baris pertama sudah dibatasi garis kop.
    if (index > 0) {
      commands.push(
        `^FO${FRAME_X},${rowTop}^GB${ruleWidth(rowTop)},0,${BORDER_DOTS}^FS`,
      )
    }

    const labelFont = row.labelFont ?? LABEL_FONT
    const labelBaseline =
      rowTop + Math.floor((ROW_HEIGHT - labelFont.height) / 2)
    const valueBaseline = rowTop + Math.floor((ROW_HEIGHT - font.height) / 2)

    commands.push(
      textCommand(
        LABEL_COLUMN_X,
        labelBaseline,
        labelFont,
        // Baris tanpa kolom nilai memakai seluruh lebar bingkai untuk namanya.
        row.spansRow
          ? FRAME_X + FRAME_WIDTH - LABEL_COLUMN_X - 14
          : labelBlockWidth,
        escapeZplText(row.label),
        true,
        row.spansRow ? "C" : "L",
      ),
    )

    if (row.spansRow) return

    commands.push(
      textCommand(
        VALUE_COLUMN_X,
        valueBaseline,
        font,
        valueBlockWidth,
        escapeZplText(row.value),
        row.boldValue === true,
      ),
    )
  })

  // QR sebesar yang muat: modul dihitung dari panjang payload, magnifikasi
  // diambil sebesar mungkin, lalu hasilnya ditengahkan di kolomnya sendiri.
  if (showQr) {
    const qrModules = qrModulesFor(fields.qrPayload.length)
    const qrMagnification = qrMagnificationFor(
      qrModules,
      Math.min(QR_AVAILABLE_WIDTH, QR_AVAILABLE_HEIGHT),
    )
    const qrSize = qrModules * qrMagnification
    const qrX =
      QR_COLUMN_X +
      Math.floor((FRAME_X + FRAME_WIDTH - QR_COLUMN_X - qrSize) / 2)
    const qrY = FRAME_Y + Math.floor((QR_COLUMN_BOTTOM - FRAME_Y - qrSize) / 2)

    // ^BQ data is prefixed with the error-correction level (M) and input mode
    // (A, auto). The prefix must not be hex-escaped; only the payload is.
    commands.push(
      `^FO${qrX},${qrY}^BQN,2,${qrMagnification}^FH^FDMA,${escapeZplText(fields.qrPayload)}^FS`,
    )
  }

  // Dua blok penanda FIFO di kolom kanan, keduanya ditengahkan. Tanpa QR blok
  // bulannya yang naik mengisi tempat itu; baris FIFO tetap di dasarnya.
  commands.push(
    textCommand(
      RIGHT_TEXT_X,
      monthTop + Math.floor((monthBottom - monthTop - monthFont.height) / 2),
      monthFont,
      RIGHT_TEXT_WIDTH,
      escapeZplText(fields.deliveryMonth),
      true,
      "C",
    ),
    textCommand(
      RIGHT_TEXT_X,
      fifoTop + Math.floor((ROW_HEIGHT - FIFO_FONT.height) / 2),
      FIFO_FONT,
      RIGHT_TEXT_WIDTH,
      escapeZplText(FIFO_TEXT),
      true,
      "C",
    ),
  )

  commands.push("^XZ")
  return commands.join("\n")
}
