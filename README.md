# PG2 Irrigation Evaluation Dashboard - ZPAS637

Dashboard profesional, modern, minimalis & interaktif untuk evaluasi realisasi aktivitas irigasi PG2. Data tersinkron otomatis dari Google Spreadsheet **ZPAS637** (ID: `1mhXxr7cfdnS-A_gJ6E4aixGRSzINdGP94orr-2lL45o`).

**Live Demo (GitHub Pages):** https://wahyudp76.github.io/FS-evaluation/

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
- Biaya Solar, Upah, Alat, Total
- Rp/Ha
- Air terpakai
- Solar efficiency distribution

### 6. Interaktivitas
- Filter: Tanggal (7H/30H/90H/All), Wilayah, Jenis Engine (SPC, DEC, SPE, DEM), Search Engine/Irigator/Lokasi
- Tabel detail 50/page dengan sort & search
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
const GVIZ_URL = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:json&sheet=ZPAS637`;
```
- Frontend fetch langsung ke Google Sheets (sheet harus **Anyone with link can view**)
- Parsing `google.visualization.Query.setResponse(...)`
- Fallback ke `.../gviz/tq?tqx=out:csv` dan local `assets/sample-data.csv`
- Sync manual tombol + interval 5 menit

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

## 📈 Roadmap
- [ ] Tambah sheet target vs realisasi
- [ ] Alert Telegram jika utilization <60%
- [ ] PWA offline support
- [ ] Multi-sheet (ZPAS638, etc)

## 📄 Lisensi
MIT - Built for PG2 Field Support Evaluation

---
**Maintainer:** wahyudp76 • Terbanggi Besar, Lampung • 2026
