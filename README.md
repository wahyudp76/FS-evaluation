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
const DATES_URL = GVIZ_BASE + `?tq=select B&tqx=out:json&sheet=ZPAS637`;                                            // overlay tanggal (~3 KB, kolom "Date")
// huruf kolom "Date" dideteksi dari header CSV -> kalau susunan kolom sheet berubah, query ini menyesuaikan sendiri
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

## 🗂️ Struktur Data & Tab (v1.7.0)
**Sheet ZPAS637** dibaca pada rentang **kolom A–AI (35 kolom)** — kolom bantu **AJ–AL** (`R Lokasi`, `R Irigator`, `R Wilayah`) sengaja diabaikan:

`R Bulan, Date, Wilayah, Lokasi, Engine, Irigator, Jenis Irigator, Plan Time, Luas Siram, Kecepatan Rata-rata, Tebal Siram, Prepare Time, Operating Time, Waiting Time, Repair, Down Time, Standby, Off Time, Tot, Oper, Time, Total Avail, Total Time, % Availability, % Utilization, Air, Solar Terpakai (ltr), Biaya Solar (Std), Biaya Upah, Biaya Alat, Biaya Total, Rp/Ha, Ha/Hari, Ha/Jam, Solar Ltr/jam, Solar Ltr/Ha, Jenis Engine`

> **Catatan kolom A ("R Bulan")** — kolom A kini berisi kolom bantu bulan (Mei…Sep), sehingga kolom tanggal ada di **kolom B ("Date")**. Dashboard mengambil tanggal dari kolom B dan **mendeteksi sendiri huruf kolom `Date`** dari header CSV: bila sheet diubah lagi (kolom disisipkan/dipindah), dashboard otomatis menyesuaikan tanpa perlu diperbaiki manual. Bila seluruh pembacaan tanggal gagal, angka dari CSV tetap dipakai — dashboard tidak akan diam-diam menampilkan data contoh. Bila tidak dibutuhkan, kolom A bisa dihapus/dikosongkan dan dashboard tetap berjalan (kolom tanggal akan terdeteksi kembali secara otomatis).

**Sheet baru "Index Solar"** (12 kolom, 151 engine) kini dianalisa di dashboard:
`Kode Engine, Tanggal Siram, Wilayah, Lokasi, Kode Irrigator, Jenis Engine, Pemakaian Solar, Jam Operaton, Liter/jam, Kalibrasi, Justifikasi, Selisih`

### Tab dashboard (6 tab)
| Tab | Isi |
|---|---|
| **Overview** | KPI utama, ringkasan 8 wilayah, chart solar / luas (angka pada batang tampil untuk tampilan **Mingguan & Bulanan**; pada **Harian** angka disembunyikan otomatis karena batang terlalu rapat dan diberi keterangan), chart jam / kecepatan / efisiensi |
| **Performance Wilayah** | Perbandingan metrik antar afdeling dengan **angka ditulis langsung pada tiap batang** (18 metrik: luas, solar, biaya, Rp/Ha, Ha/Jam, Ltr/Ha, util, kecepatan, tebal, dll.), tabel detail wilayah, bubble & compare |
| **Analisa Biaya** | **Tampilan disamakan dengan tab Waktu & Utilisasi**: **12 kartu biaya** (biaya total, solar, upah, alat, Rp/Ha, Rp/Jam, Rp/Liter, Rp/Record, luas, solar, komponen terbesar, wilayah termahal) dengan **3 mode: Total (bawaan) / Rata-rata per Aktivitas / Rata-rata per Hari**; **chart "Performa Biaya per Wilayah"** (batang horizontal berlabel angka, 11 metrik + 6 tombol cepat, nominal ikut mode & rasio tetap); **tabel Rincian Biaya per Wilayah** dengan **kolom Wilayah beku** (15 kolom: Rec, Hari, Luas, biaya solar/upah/alat/total, % dr Total, Rp/Ha, Rp/Jam, Rp/Liter, Rp/Record, Solar L/Ha, badge Hemat/Normal/Mahal) + pemilih urutan; komposisi solar/upah/alat per wilayah (stacked — tanpa angka) & doughnut total, tren per periode, serta tabel biaya per periode (mengikuti granularitas & mode, angka pada batang) |
| **Waktu & Utilisasi** | **Rincian seluruh kolom waktu** (Plan, Prepare, Operating, Waiting, Repair, Down, Standby, Off, Tot. Oper., Total Avail, Total Time) + **Air** dalam 12 kartu dengan **3 mode tampilan: Rata-rata / Aktivitas (bawaan), Rata-rata / Hari, atau Total** — kartu & tabel & chart komposisi ikut mode; tabel per wilayah punya kolom **Hari**, plus **chart Performa Waktu per Wilayah**: batang horizontal berlabel angka, 15 metrik + 6 tombol cepat, mengikuti mode rata-rata/total), chart komposisi waktu per bulan, air vs luas vs solar, availability/utilization |
| **Index Solar** *(baru)* | Chart penyimpangan dengan **angka deviasi (+7,13 / −8,19 L/jam)** pada tiap batang; pemakaian solar per engine vs **kalibrasi**: L/jam aktual, deviasi, selisih (L), verdict Hemat/Boros, penanda **Solar 0 L** & **Anomali** (>5× kalibrasi), rekap per wilayah & jenis engine, scatter aktual vs kalibrasi, tabel per engine + filter/urut/paginasi/pencarian |
| **Detail Data Harian** | Tabel **35 kolom A–AI** (bisa digeser horizontal, **kolom tanggal & kolom wilayah beku**), termasuk kolom **Bulan** dari sheet, sort klik header, paginasi, export CSV 35 kolom urut sheet (dibuka dengan `R Bulan, Date, …`) |

### Mode tampilan waktu (v1.8.0)
Tombol **Rata-rata / Aktivitas • Rata-rata / Hari • Total** di bagian "Rincian Waktu Alat" (tab Waktu & Utilisasi):

| Mode | Arti pembagi | Contoh (Plan Time, seluruh periode) |
|---|---|---|
| Rata-rata / Aktivitas *(bawaan)* | total ÷ 12.730 baris data | 17,71 jam/aktivitas |
| Rata-rata / Hari | total ÷ 116 hari operasi | 1.943,31 jam/hari |
| Total | tanpa pembagi | 225.424,0 jam |

- Berlaku serentak untuk **kartu 12 kolom waktu**, **tabel Rincian Waktu per Wilayah** (wilayah dibagi data wilayah itu sendiri — jumlah hari per wilayah ditampilkan di kolom **Hari**), dan **chart Komposisi Waktu per Bulan** (dibagi per bulan).
- Setiap kartu tetap menampilkan angka pendukung: total, per aktivitas, dan per hari sekaligus — jadi tidak perlu bolak-balik mengganti mode untuk membandingkan.
- Kolom **L/Ha, % Avail, % Util** tetap berupa rasio (tidak dibagi).
- Chart "Air, Luas Siram & Solar per Bulan" sengaja tetap akumulasi bulanan (diberi keterangan di bawah judul).

### Kolom beku & chart Performa Waktu (v1.8.1)
- **Kolom Wilayah beku** pada tabel *Rincian Waktu per Wilayah* (tab Waktu & Utilisasi): saat tabel digeser horizontal untuk melihat kolom waktu berikutnya, kolom **Wilayah** tetap menempel di kiri (latar solid, garis pemisah + bayangan) — berlaku juga untuk baris kepala dan baris kaki rata-rata. Tabel memakai `border-collapse: separate` agar `sticky` berfungsi benar di Chrome.
- **Chart "Performa Waktu per Wilayah"** (gaya sama dengan tab Performance Wilayah): batang horizontal terurut, **angka pada tiap batang**, bisa diganti lewat dropdown **Metrik** (15 metrik: seluruh kolom waktu, Air Terpakai, L/Ha, % Availability, % Utilization) atau **6 tombol cepat** (Jam Operasi, Waiting Time, Air Terpakai, Total Avail, % Utilization, L/Ha).
- Chart ini **mengikuti mode tampilan waktu**: pada mode Rata-rata/Aktivitas & Rata-rata/Hari nilai jam/air dibagi sesuai mode per wilayah (judul sumbu ikut berubah), sedangkan L/Ha, % Avail, % Util tetap rasio (ada keterangan di bawah chart). Keterangan juga menyebut wilayah dengan nilai tertinggi.

### Mode tampilan biaya & tampilan baru tab Analisa Biaya (v1.8.3)
Tab **Analisa Biaya** kini berbentuk sama dengan tab **Waktu & Utilisasi**:

- **12 kartu biaya** (gaya dan susunan kartu sama seperti kartu waktu): Biaya Total, Biaya Solar, Biaya Upah, Biaya Alat, Rp/Ha, Rp/Jam Operasi, Rp/Liter Solar, Rp/Record, Luas Siram, Solar Terpakai, Komponen Terbesar, dan Wilayah Termahal (Rp/Ha tertinggi + pembanding wilayah termurah).
- **Tiga mode tampilan** di kanan judul: **Total** (bawaan) • **Rata-rata / Aktivitas** • **Rata-rata / Hari**. Nominal biaya & volume (luas, solar) ikut dibagi sesuai mode; **rasio tetap** — Rp/Ha, Rp/Jam, Rp/Liter, Rp/Record, `% dr Total`, dan Solar L/Ha tidak pernah dibagi. Setiap kartu tetap menampilkan angka pendukung (total • per aktivitas • per hari sekaligus).
- **Chart "Performa Biaya per Wilayah"** (gaya sama dengan Performa Waktu/Performance Wilayah): batang horizontal terurut, **angka pada tiap batang** (rupiah ditulis ringkas: `Rp 423 Rb`, `Rp 10,25 M`), tooltip berisi komposisi solar/upah/alat untuk metrik Biaya Total. **10 metrik** lewat dropdown: Biaya Total, Biaya Solar, Biaya Upah, Biaya Alat, **Rp/Ha**, **Rp/Jam**, **Rp/Liter**, **Rp/Record**, % dari Total Biaya, Solar Terpakai — plus **6 tombol cepat** (Biaya Total, Biaya Solar, Biaya Alat, Rp/Ha, **Rp/Jam**, % dari Total).
- **Tabel Rincian Biaya per Wilayah** dengan **kolom Wilayah beku** (latar solid + garis pemisah, tetap terlihat saat tabel digeser) — 15 kolom termasuk kolom **Hari** baru, Rp/Jam, Rp/Liter, Rp/Record, serta badge **Hemat/Normal/Mahal** (dibanding rata-rata Rp/Ha antarfolding).
- **Tabel & chart biaya per periode** mengikuti granularitas (harian/mingguan/bulanan/seluruh periode) **dan** mode tampilan; judul kolom menyebut satuannya (`Rp`, `Rp/akt`, `Rp/hari`).
- Metrik **Rp/Jam Operasi** tampil otomatis sebagai rasio (`Rp/jam` pada sumbu, tidak ikut dibagi mode): **AW12 Rp 422.763/jam** (tertinggi) → **AW11 Rp 357.755/jam** (terendah).
- Contoh angka (periode penuh, mode Total): **Rp 70,31 M** total biaya (solar Rp 33,79 M • alat Rp 28,19 M • upah Rp 8,32 M) • **Rp 1.549.662/Ha** • Rp 388.566/jam operasi • Rp 46.802/liter solar; wilayah biaya terbesar **AW12 Rp 10,25 M**, Rp/Ha termahal **AW09 Rp 1.859.528** (termurah AW11 Rp 1.362.841).

### Aturan label angka pada batang (v1.7.2)
- **Chart bar single** → angka ditulis pada batang: Overview (Luas, Solar), Analisa Biaya (biaya per periode), Index Solar (deviasi per engine), Performance Wilayah (18 metrik + chart pembanding).
- **Chart bar bertumpuk (stacked)** → tanpa angka: Jam Efektif Siram, Komposisi Waktu per Bulan, Hasil per Wilayah (Index Solar), Biaya per Wilayah pada tab Analisa Biaya.
- Angka otomatis: menghindari tumpang tindih antar label **dan** menghindari garis tren; bila tidak muat di luar batang, angka dipindah ke dalam batang (ukuran huruf mengecil) atau ditulis vertikal 90°.
- Tampilan **Harian** pada Overview tidak diberi angka (116 batang terlalu rapat) — ada keterangan kecil di bawah judul chart agar pengguna tahu harus beralih ke Mingguan/Bulanan.

Catatan metodologi Index Solar:
- `L/jam aktual` dihitung sendiri dari **Pemakaian Solar ÷ Jam Operasi** (kolom "Liter/jam" sheet tidak dipakai) agar konsisten.
- Engine dengan pemakaian **0 L** dipisah (belum ada catatan solar) dan tidak dihitung Hemat/Boros; selisih & rata-rata hanya dari engine terukur.
- Pemakaian **>5× kalibrasi** ditandai **Anomali** (mis. SPC0127 46.258 L untuk 2 jam) dan dikecualikan dari rata-rata/total selisih agar tidak merusak kesimpulan.
- Filter sidebar (periode, wilayah, jenis engine, pencarian) tetap berlaku; kolom `ZPAS637` pada tabel = rekap aktivitas engine yang sama pada periode terpilih.

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
