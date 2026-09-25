# Laporan Penyesuaian Struktur Data & Tab — v1.7.0

**Tanggal:** 22 September 2026
**Permintaan:** pelajari struktur sheet `ZPAS637` yang baru, sesuaikan struktur tab, tampilkan analisa seluruh kolom **A–AH**, pelajari sheet **Index Solar**, tambahkan analisa pemakaian solar per engine.
**File diubah:** `app.js`, `index.html`, `sw.js` (v1.7.0), `README.md`, `tools/*` (skrip uji baru)

---

## 1. Hasil pembacaan sheet ZPAS637 (terbaru)

| Item | Nilai |
|---|---|
| Jumlah kolom terbaca | **37 kolom**, dashboard hanya memakai **A–AH (34 kolom)** — AI/AJ/AK (`R Lokasi`, `R Irigator`, `R Wilayah`) diabaikan sesuai permintaan |
| Jumlah baris | **12.730** (sebelumnya 12.396) |
| Rentang data | 29 Mei – 21 Sep 2026 |
| Wilayah | AW08 – AW15 (8 afdeling) |
| Engine / Irigator / Lokasi | 135 / 124 / 581 unik |
| Σ Luas Siram | 45.368,0 Ha |
| Σ Solar | 1.502.197 L |
| Σ Air | 7.777.979 L |
| Σ Biaya Total | Rp 70.305.102.957 (± Rp 70,31 M) |
| Nama kolom berubah | kolom R pada sheet kini **`Tot, Oper, Time`** (dulu `Tot. Oper. Time`) → parser dimutakhirkan agar tetap terbaca |

Kolom waktu lengkap yang kini dianalisa: **Plan Time, Prepare Time, Operating Time, Waiting Time, Repair, Down Time, Standby, Off Time, Tot. Oper. Time, Total Avail, Total Time** + **% Availability, % Utilization** + **Air**.

## 2. Hasil pembacaan sheet "Index Solar"

12 kolom × **151 engine**: `Kode Engine, Tanggal Siram, Wilayah, Lokasi, Kode Irrigator, Jenis Engine, Pemakaian Solar, Jam Operaton, Liter/jam, Kalibrasi, Justifikasi, Selisih`. Tipe tanggal **teks `M/D/YYYY`** (mis. `9/21/2026`) — diparse khusus.

Temuan yang memengaruhi desain analisa:

| Temuan | Jumlah | Perlakuan di dashboard |
|---|---|---|
| Kalibrasi 0 (Tidak Ada Siram) | 20 engine | tiap engine diklasifikasikan **Tidak ada siram** |
| Waktu operasi 0 (solar 0 / tidak jalan) | 11 engine | ikut kategori di atas |
| Pemakaian solar 0 L padahal jam > 0 | 24 engine (25 baris) | ditandai **Solar 0 L** – terpisah dari Hemat/Boros |
| Pemakaian **>5× kalibrasi** | 2 engine: **SPC0127** (46.258 L / 2 jam) & **DED0015** (544 L / 3 jam) | ditandai **Anomali**, dikeluarkan dari rata-rata & total selisih (kalau tidak, total selisih melonjak dari 256 L → 23.644 L) |
| Verdict sheet "Hemat" walau aktual > kalibrasi | mis. SPC0143 (11,3 L/j vs 11 L/j) | dashboard memakai **angka aktual vs kalibrasi** sebagai acuan utama, verdict sheet tetap ditampilkan |

Angka kunci setelah anomali & solar-0 dipisah: **104 engine terukur**, L/jam tertimbang **9,33 L/jam** vs kalibrasi rata-rata **10,57 L/jam** (−11,8%), **77 Hemat / 27 Boros**, **Selisih 256 L** (anomali terpisah: +23.388 L).

## 3. Perubahan struktur tab

Sebelumnya 5 tab → sekarang **6 tab**, dengan penyesuaian isi:

| Tab | Status | Isi baru |
|---|---|---|
| Overview | tetap | KPI utama + ringkasan wilayah + 5 chart |
| Performance Wilayah | tetap | perbandingan antar afdeling |
| Analisa Biaya | tetap | biaya solar/upah/alat |
| **Utilisasi & Efisiensi** → **Waktu & Utilisasi** | **diperluas** | **12 kartu kolom waktu + Air** (Plan, Prepare, Operating, Waiting, Repair, Down, Standby, Off, Tot. Oper., Total Avail, Total Time, Air), chart **Komposisi Waktu per Bulan**, chart **Air vs Luas vs Solar**, tabel **Rincian Waktu per Wilayah (17 kolom + baris TOTAL)**, ditambah chart availability/utilization & scatter yang sudah ada |
| **Index Solar** | **baru** | KPI evaluasi solar, chart penyimpangan L/jam, donut hasil evaluasi (+ rekap per jenis engine), hasil per wilayah, scatter aktual vs kalibrasi, tabel per engine (filter/urut/pencarian/paginasi) |
| Detail Data Harian | **diperluas** | tabel **34 kolom sesuai kolom A–AH sheet**, kolom tanggal beku saat digeser, sort klik header, export CSV 34 kolom |

Tab overview/dll tidak diubah supaya tidak ada regresi; semua filter sidebar (periode, wilayah, bulan, jenis engine, pencarian) kini juga menyaring tab Index Solar.

## 3b. Penyesuaian tampilan setelah uji visual

- **Chart "10 Penyimpangan Terbesar (L/jam)"** — sebelumnya hanya menampilkan selisih positif sehingga seluruh batang berwarna hijau (verdict sheet terlalu longgar). Kini diurutkan berdasarkan **|deviasi L/jam|** dan dibalik urutannya supaya **Boros (merah) dan Hemat (hijau)** tampil mengelompok.
- **Scatter "Aktual vs Kalibrasi"** — 2 engine anomali (SPC0127, DED0015) yang nilainya ±100× lipat dikeluarkan dari scatter agar sumbu Y tidak rusak; sebagai gantinya muncul catatan *"2 engine anomali tidak ditampilkan (skala terlalu jauh) — lihat filter 'Hanya anomali'"*. Engine tanpa angka kalibrasi (mis. SPE0002) juga tidak diplot; sumbu Y dibatasi otomatis ±15% di atas nilai tertinggi.
- **Kartu KPI** — "Engine Dievaluasi" kini 131 (semua engine dengan catatan aktivitas), rinciannya dipindah ke baris kecil (25 tanpa catatan solar • 2 anomali • 20 tanpa siram); "Hasil Evaluasi" menampilkan dasar perhitungan dari 104 engine terukur.
- **Tabel Index Solar** — badge status dibuat `nowrap` agar tidak terpotong dua baris; judul kolom dibaca `Jenis (sheet)` untuk membedakan dari jenis engine pada ZPAS637.
- **Label tab** disamakan antara tombol dan judul panel: **Waktu & Utilisasi**.

## 4. Hasil uji (Chrome headless, lokal)

| Skrip | Hasil |
|---|---|
| `tools/qa-index-solar.js` (baru) | **24/24 lulus** — 6 tab, semua 23 chart terisi, 12 kartu waktu, tabel waktu 8 wilayah + TOTAL, Index Solar 151 engine, filter Boros=27/anomali=2, urut & pencarian & paginasi, filter sidebar AW08 = 19 engine, tabel detail 34 kolom, export CSV 34 kolom × 12.730 baris, 0 error |
| `tools/qa.js` (regresi, kini dinamis) | **36/36 lulus** — filter tanggal/bulan/wilayah, pencarian teks & angka, paginasi, sort, granularitas, biaya, export, sync, offline, fallback |
| `tools/layout-test.js` | **24/24 lulus** — laci filter mobile tetap menempel di bawah header, sticky desktop, resize, Esc/backdrop, fokus |
| `tools/stress.js` | **0 error**, heap stabil 29–35 MB |

## 5. Catatan teknis

- **Parser**: nama kolom baru `Tot, Oper, Time` dibaca via pencarian header yang toleran (juga menerima `Tot. Oper. Time`); semua pencarian kolom memakai normalisasi huruf/angka sehingga perubahan tanda baca di sheet tidak lagi mematahkan dashboard.
- **Tanggal Index Solar** `M/D/YYYY` diparse dengan fallback aman (jika angka pertama > 12 dianggap tanggal/bulan).
- **Konflik filter**: filter "Bulan" pada sidebar tidak memfilter tab Index Solar karena tanggalnya berbeda (mis. `18-Sep` tanpa tahun); filter yang berlaku adalah **periode tanggal + wilayah + jenis engine + pencarian**.
- **Perhitungan**: `L/jam aktual = Pemakaian Solar ÷ Jam Operasi` (dihitung sendiri, tidak memakai kolom sheet) agar konsisten antar baris; kolom `ZPAS637` pada tabel index = rekap aktivitas engine yang sama pada periode terpilih (mengikuti filter).
- **Kinerja**: unduhan sheet Index Solar (±13 KB) berjalan paralel dengan CSV utama dan ikut di-cache (`Cache Storage pg2-data-v1`), jadi tidak menambah waktu muat yang berarti — data siap ±0,4–0,6 ms DCL pada uji lokal.

## 6. Status rilis

- Service worker dinaikkan ke **v1.7.0** (cache aset lama dibersihkan otomatis).
- Push ke `wahyudp76/FS-evaluation` → GitHub Actions → <https://wahyudp76.github.io/FS-evaluation/>
