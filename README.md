# PG2 Irrigation Evaluation Dashboard - ZPAS637

Dashboard profesional, modern, minimalis & interaktif untuk evaluasi realisasi aktivitas irigasi PG2. Data tersinkron otomatis dari Google Spreadsheet **ZPAS637** (ID: `1mhXxr7cfdnS-A_gJ6E4aixGRSzINdGP94orr-2lL45o`).

**Live Demo (GitHub Pages):** https://wahyudp76.github.io/FS-evaluation/

## 🗂️ Navigasi Tab

Dashboard disusun dalam bar navigasi tab (sticky) agar rapi dan tidak berdesakan:

| Tab | Isi |
|-----|-----|
| **Overview** | Garis besar seluruh wilayah: 4 KPI utama + 4 KPI biaya/utilisasi, ringkasan semua afdeling, tren solar harian, luas siram, jam efektif, kecepatan & tebal, efisiensi |
| **Performance Wilayah** | Pemakaian & hasil rata-rata per afdeling: chart metrik dinamis (+ quick chips), mini cards, tabel evaluasi 15 kolom (sortable), bubble efisiensi Ha/Jam vs Ltr/Ha, pemakaian vs hasil |
| **Analisa Biaya** | Biaya irigasi total & per wilayah: stacked biaya solar/upah/alat + garis Rp/Ha, komposisi biaya, tren biaya harian, tabel biaya per wilayah (13 kolom + TOTAL), tabel & chart biaya per periode (harian/mingguan/bulanan), insight biaya |
| **Utilisasi & Efisiensi** | Availability vs Utilization, jenis engine, top engine & irigator, distribusi solar efficiency |
| **Data Harian** | Tabel record harian: sort kolom, pencarian, pagination 15/30/50/100, export CSV |

Tab terakhir yang dibuka tersimpan otomatis (localStorage + hash URL), filter tetap berlaku lintas tab, dan header menampilkan ticker ringkas (luas, solar, biaya, Rp/Ha, Ha/Jam, Ltr/Ha, util, avail) di semua tab.

## ✨ Fitur Evaluasi

### 1. Penggunaan Solar
- **Harian / Mingguan / Bulanan** - Toggle granularitas
- Total solar terpakai (L), rata-rata L/jam, L/Ha
- Trend line vs bar, insight otomatis
- Deteksi engine boros

### 2. Jam Efektif Siram Irigasi
- Operating Time vs Plan Time
- Breakdown: Prepare, Operating, Waiting, Repair, Down, Standby, Off
- % Availability & % Utilization trend
- Stacked bar per periode

### 3. Hasil Luas Siram
- Total Luas Siram vs Luas Cek
- Ha/Hari & Ha/Jam produktivitas
- Performa per Wilayah (AW08, AW09, AW10, AW11, dll)
- Top 5 Engine & Irigator

### 4. Kecepatan & Ketebalan
- Kecepatan rata-rata (m/menit)
- Tebal siram (mm)
- Dual-axis trend
- Scatter plot efisiensi: Ha/Jam vs Solar Ltr/Ha

### 5. Biaya & Efisiensi
- **Analisa biaya total & per wilayah**: biaya Solar, Upah, Alat, Biaya Total, % share per wilayah
- **Rasio biaya**: Rp/Ha, Rp/Jam Operasi, Rp/Liter Solar, Rp/Record (rasio total ÷ total, akurat meski ada outlier)
- **Biaya per periode**: harian / mingguan / bulanan / seluruh periode (tabel + chart)
- **Komposisi biaya** (doughnut solar–upah–alat) & **tren biaya** harian
- **Insight biaya otomatis**: wilayah termurah/termahal Rp/Ha, penyumbang biaya terbesar, komponen dominan, tren periode terakhir
- Air terpakai & solar efficiency distribution

### 6. Interaktivitas
- **Bar navigasi tab**: Overview / Performance Wilayah / Analisa Biaya / Utilisasi & Efisiensi / Detail Data Harian
- Filter: **Periode Tanggal manual** (Mulai–Selesai + tombol *Semua* untuk kembali ke rentang penuh), **Filter Bulan** (Jan–Des) & **Tahun**, Wilayah, Jenis Engine (SPC, DEC, SPE, DEM), Search Engine/Irigator/Lokasi
- Granularitas agregasi terpisah: **Harian / Mingguan / Bulanan** (chart solar, luas, jam, kecepatan, efisiensi)
- Tabel detail 15/page (opsi 15/30/50/100) dengan sort & search
- Export CSV filtered
- Auto-sync 5 menit

## 🚀 Tech Stack
- **Frontend only** - No backend, deploy ke GitHub Pages
- TailwindCSS (CDN) - Modern minimalist UI
- Chart.js 4.4 + date-fns adapter
- PapaParse for CSV fallback
- Lucide Icons
- Google Sheets GViz JSON API (`/gviz/tq?tqx=out:json`)

## 🔄 Auto-Sync Logic
```js
const CSV_URL   = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:csv&sheet=ZPAS637`;   // sumber utama (~3,6 MB)
const DATES_URL = GVIZ_BASE + `?tq=select A&tqx=out:json&sheet=ZPAS637`;                                            // overlay tanggal (~3 KB)
const GVIZ_URL  = GVIZ_BASE + `?tqx=out:json&sheet=ZPAS637`;                                                        // cadangan (~9,7 MB)
```
- Frontend fetch langsung ke Google Sheets (sheet harus **Anyone with link can view**)
- **CSV jadi sumber utama** karena ~46% lebih ringan dari JSON gviz; JSON penuh hanya dipakai bila CSV gagal
- Unduhan sudah dimulai dari `<head>` (`window.__pgCsvEarly`) sehingga tumpang tindih dengan pemuatan skrip
- **Cache Storage `pg2-data-v1`**: kunjungan berikutnya tampil instan dari cache, lalu diperbarui di belakang
- Fallback berlapis: cache → CSV live → JSON gviz → `assets/sample-data.csv` (offline)
- Sync manual (tombol Sync) + otomatis tiap 5 menit, dijeda otomatis saat tab tidak aktif, ada *backoff* saat gagal
- Notifikasi ringan (toast) untuk sukses/gagal sync — dashboard tidak pernah tertutup overlay karena gangguan jaringan

## 🧰 Panel Filter & Kontrol (v1.6.0)
- **Mobile/tablet (<1024 px):** panel dibuka sebagai **laci penuh yang menempel tepat di bawah header** (+ backdrop, tombol X, Esc, klik luar untuk menutup, fokus kembali ke tombol Filter). Isi laci punya area scroll sendiri sehingga tidak pernah tertutup header.
- **Desktop (≥1024 px):** panel jadi **kolom kiri sticky** dengan tinggi maksimum mengikuti viewport.
- Tinggi header diukur otomatis (`--header-h`) dan dipakai panel + tab bar, jadi offset tetap pas walau tinggi header berubah (ticker terisi, tombol Install muncul, zoom, atau lebar layar berbeda).
- Kepala laci menampilkan ringkasan langsung, mis. *"1 filter aktif • 1.352 dari 12.396 records"*.

## ⚡ Performa & Stabilitas (v1.5.0)
Hasil uji A/B (Chrome headless, throttling CPU 4x, median 3 putaran, `tools/`):

| Metrik | Sebelum | Sesudah | Perubahan |
|---|---|---|---|
| Data siap dipakai | 8.681 ms | 4.673 ms | **-46%** |
| Pindah tab pertama (dingin) | 1.759 ms | 813 ms | **-54%** |
| Pindah tab (hangat) | 1.110 ms | 313 ms | **-72%** |
| Ubah filter tanggal | 1.204 ms | 136 ms | **-89%** |
| Respons kotak pencarian | 559 ms | 501 ms | -10% |
| Task CPU saat load | 7.575 ms | 6.267 ms | -17% |

Yang membuatnya lebih cepat:
1. **Data**: CSV 3,56 MB menggantikan JSON 9,73 MB + unduhan dimulai lebih awal.
2. **Parsing**: parser CSV/angka satu lintasan tanpa regex (`toNumFast`), agregasi satu pass per grup.
3. **Render bertahap**: hanya tab yang sedang dilihat yang dirender; tab lain disiapkan `requestIdleCallback`.
4. **Memoization** per-versi data (`applyFilters()` menaikkan `dataVersion`) untuk KPI, agregasi, statistik wilayah.
5. **Chart hemat**: animasi otomatis nonaktif untuk >60 titik, `devicePixelRatio` dibatasi 2.
6. **Input**: pencarian di-*debounce* 200-220 ms; tab bisa dinavigasi lewat keyboard (←/→/Home/End).

Perbaikan bug & ketahanan:
- Sorting "Performance per Wilayah" tidak lagi salah urut, filter tanggal kini memakai waktu lokal (bukan UTC)
- Escape HTML untuk nilai dari spreadsheet (anti-XML injection), pencarian tabel tetap bisa menemukan angka
- Mode offline: data terakhir tetap tampil dari cache; spreadsheet gagal → otomatis pakai data contoh + toast peringatan
- Uji stabilitas: 25 klik tab cepat, 25 perubahan filter, pengetikan cepat, 2x sync bersamaan → 0 error, heap stabil
- Export CSV tanpa dependensi papaparse (papaparse dihapus dari halaman → 1 request lebih sedikit)

## 📁 Struktur Repo
```
/
├── index.html          # Dashboard utama
├── app.js              # Logic fetch, filter, aggregation, charts
├── assets/
│   └── sample-data.csv # Snapshot 12.396 records untuk offline dev
├── .github/
│   └── workflows/
│       └── deploy.yml  # GitHub Pages auto-deploy
└── README.md
```

## 🛠️ Deploy ke GitHub Pages (wahyudp76/FS-evaluation)

### Opsi 1: Via Workflow (sudah ada)
1. Push repo ini ke `main`:
```bash
git init
git remote add origin https://github.com/wahyudp76/FS-evaluation.git
git add .
git commit -m "feat: PG2 irrigation dashboard ZPAS637"
git push -u origin main
```
2. Di GitHub > Settings > Pages > Source: **GitHub Actions**
3. Workflow `deploy.yml` akan otomatis deploy ke `https://wahyudp76.github.io/FS-evaluation/`

### Opsi 2: Manual Pages
- Settings > Pages > Branch: main / root > Save

## 🔧 Konfigurasi Spreadsheet
Jika ID sheet berubah, edit di `app.js`:
```js
const SPREADSHEET_ID = 'YOUR_NEW_ID';
const SHEET_NAME = 'ZPAS637';
```

Pastikan sheet **File > Share > Anyone with link - Viewer**.

## 📊 Struktur Kolom ZPAS637
`Date | Wilayah | Lokasi | Engine | Irigator | Jenis Irigator | Plan Time | Luas Siram | Luas Cek | Kecepatan Rata-rata | Tebal Siram | Prepare Time | Operating Time | Waiting Time | Repair | Down Time | Standby | Off Time | Tot. Oper. Time | Total Avail | Total Time | % Availability | % Utilization | Air | Solar Terpakai (ltr) | Biaya Solar (Std) | Biaya Upah | Biaya Alat | Biaya Total | Rp/Ha | Ha/Hari | Ha/Jam | Solar Ltr/jam | Solar Ltr/Ha | Jenis Engine`

## 🎨 Desain
- Minimalist, rounded 2xl, soft shadow, glass header
- Palette: emerald (primary), amber (solar), blue (time), violet (speed)
- Typography: Inter + JetBrains Mono
- Responsive: sidebar filters sticky desktop, drawer mobile
- KPI cards hover lift

## 🪧 Logo & Ikon
Logo: tetes air + sprinkler irigasi (brand emerald `#10A05C`).
- **Ikon transparan** (tanpa kotak putih): `favicon.svg`, `favicon.ico`, `favicon-16/32.png`, `icon-16…512.png` → tampil bersih di tab browser, bookmark, dan taskbar
- **Glyph putih transparan**: `logo-white-192.png`, `logo-white-512.png` → dipakai di header dashboard & loading screen
- **Full-bleed hijau** (khusus platform yang tidak mendukung transparansi): `apple-touch-icon.png`, `icon-180.png`
- **Maskable Android** (safe zone 66%): `icon-maskable-192.png`, `icon-maskable-512.png`
- Ukuran kecil (16–32 px) memakai versi glyph disederhanakan (tetes air saja) agar tetap tajam

## 📈 Roadmap
- [ ] Tambah sheet target vs realisasi
- [ ] Alert Telegram jika utilization <60%
- [x] PWA offline support (app shell + data cache, sw v1.5.0)
- [ ] Multi-sheet (ZPAS638, etc)

## 📄 Lisensi
MIT - Built for PG2 Field Support Evaluation

---
**Maintainer:** wahyudp76 • Terbanggi Besar, Lampung • 2026
