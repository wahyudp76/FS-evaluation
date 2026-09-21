# Panduan Deploy ke wahyudp76/FS-evaluation

## 1. Struktur Tabel ZPAS637 (Sudah Dibaca)
- **ID Spreadsheet**: `1mhXxr7cfdnS-A_gJ6E4aixGRSzINdGP94orr-2lL45o`
- **Sheet**: `ZPAS637`
- **Total Records**: 12.396 baris (29 Mei 2026 - sekarang)
- **Kolom Kunci**:
  - Solar: `Solar Terpakai (ltr)`, `Solar Ltr/jam`, `Solar Ltr/Ha`
  - Jam: `Plan Time`, `Prepare Time`, `Operating Time`, `Waiting Time`, `Tot. Oper. Time`
  - Luas: `Luas Siram`, `Luas Cek`, `Ha/Hari`, `Ha/Jam`
  - Performa: `Kecepatan Rata-rata`, `Tebal Siram`, `% Availability`, `% Utilization`
  - Biaya: `Biaya Total`, `Rp/Ha`

## 2. File Dashboard yang Sudah Dibuat
- `index.html` - UI modern minimalist, Tailwind, responsive
- `app.js` - Auto-sync logic + aggregation + Chart.js
- `assets/sample-data.csv` - Fallback offline
- `.github/workflows/deploy.yml` - Auto deploy Pages

## 3. Cara Push ke GitHub
```bash
# Di lokal komputer
git clone https://github.com/wahyudp76/FS-evaluation.git
cd FS-evaluation
# Copy semua file dari workspace ini ke folder tersebut
# Lalu:
git add .
git commit -m "feat: PG2 irrigation dashboard ZPAS637 professional"
git push origin main
```

Atau jika repo masih kosong (Initial commit saja):
```bash
git remote add origin https://github.com/wahyudp76/FS-evaluation.git
git branch -M main
git push -u origin main
```

## 4. Aktifkan GitHub Pages
1. Buka https://github.com/wahyudp76/FS-evaluation/settings/pages
2. Source: **GitHub Actions** (bukan branch)
3. Tunggu 1-2 menit, cek Actions tab
4. Akses: https://wahyudp76.github.io/FS-evaluation/

## 5. Verifikasi Auto-Sync
- Buka dashboard, lihat header "ZPAS637 LIVE" + last sync time
- Buka DevTools > Network > filter `gviz` - harus 200
- Edit data di Google Sheets, tunggu 5 menit, klik Sync, data update

## 6. Jika CORS Error
Jika fetch GViz gagal karena CORS, solusi:
- Pastikan Sheet Share = Anyone with link Viewer
- Alternatif: Publish to web: File > Share > Publish to web > Link > CSV > Publish
- Atau gunakan Google Apps Script sebagai proxy (sudah ada fallback CSV)

## 7. Kustomisasi
Edit `app.js` baris atas:
```js
const SPREADSHEET_ID = '1mhXxr7cfdnS-A_gJ6E4aixGRSzINdGP94orr-2lL45o';
const SHEET_NAME = 'ZPAS637';
```

## 8. Preview Lokal
```bash
python -m http.server 8000
# buka http://localhost:8000
```

Selesai! Dashboard siap dipakai untuk evaluasi PG2.
