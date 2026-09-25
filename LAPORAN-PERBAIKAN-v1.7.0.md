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

## 3c. Label angka pada chart bar tab "Performance Wilayah" (v1.7.1)

Permintaan: angka pada chart bar harus langsung terbaca tanpa hover.

- Ditambahkan plugin Chart.js ringan **`barLabels`** (`app.js`) yang menulis nilai di **ujung batang horizontal** dan **di atas batang vertikal**, dengan garis tepi putih (halo) agar tetap terbaca di atas warna batang. Tidak memakai library tambahan (tanpa CDN baru).
- **Chart "Performa per Wilayah"** (bar horizontal, 18 pilihan metrik): label mengikuti satuan metrik aktif — `6.742,01 Ha`, `Rp 1.375.640`, `83,1%`, `0,261`, `234.813 L`, dst. Sumbu diberi ruang tambahan (`grace 18%`) supaya label tetap di luar batang; bila tetap tidak muat (mis. batang hampir penuh), label otomatis dipindah ke dalam batang dengan teks putih.
- **Chart "Pemakaian vs Hasil Rata-rata"** (dua sumbu: Ha & Solar L): label **Ha diputar 90°** di atas batang hijau, label **Solar L ditulis di tengah batang kuning** (putih) — supaya keduanya terbaca meski batangnya rapat; satuan mengikuti judul sumbu.
- Catatan teknis: konfigurasi plugin **tidak boleh berisi fungsi**, karena Chart.js me-*resolve* nilai fungsi di `options.plugins.*` sebagai *scriptable option* dan memanggilnya dengan objek konteks internal (bukan angka) — penyebab error `Cannot convert object to primitive value`. Format karena itu dipilih lewat kode teks (`ha`, `l`, `rp`, `pct`, `num1`, `num2`, `num3`, `int`) yang dipetakan di `BAR_LABEL_FMT`, dan konfigurasi asli disimpan di `chart.$barLabels`.
- Plugin bersifat **opt-in per chart** (`options.plugins.barLabels.display`) sehingga chart lain bisa diberi label angka dengan mudah bila diminta.

## 3d. Label angka pada chart bar tab lain (v1.7.2)

Permintaan lanjutan: beri angka juga pada chart bar **single** di tab lain, tapi **chart bar bertumpuk (stacked) tidak perlu**.

| Chart | Tab | Angka | Satuan |
|---|---|---|---|
| Luas Siram per periode | Overview | ✅ (Mingguan/Bulanan) | `469 Ha` |
| Solar Terpakai | Overview | ✅ (Mingguan/Bulanan) | `241.853 L` |
| Total Biaya per periode | Analisa Biaya | ✅ | ringkas: `Rp 22,94 M`, `Rp 342,2 Jt` |
| Deviasi per engine | Index Solar | ✅ (+/−) | `+7,13` / `−8,19` (L/jam) |
| Performa per Wilayah & Pemakaian vs Hasil | Performance Wilayah | ✅ (sebelumnya) | 18 metrik |
| Jam Efektif Siram, Komposisi Waktu per Bulan | Overview / Waktu | ❌ stacked | — |
| Biaya per Wilayah (solar/upah/alat) | Analisa Biaya | ❌ stacked | — |
| Hasil per Wilayah (Hemat/Boros) | Index Solar | ❌ stacked | — |

Cara kerja label (semuanya otomatis, tanpa pengaturan manual):
- **Anti tumpang tindih**: setiap label punya kotak batas; label yang akan menimpa label lain tidak ditulis.
- **Menghindari garis tren**: titik & ruas garis (mis. "Avg Ltr/Jam", "Rp/Ha") didaftarkan sebagai penghalang sehingga angka tidak tertimpa garis — terlihat pada chart Solar bulan Juni yang sebelumnya tertimpa.
- **Bertingkat**: bila tidak muat di luar batang, angka dipindah ke dalam batang (huruf mengecil otomatis, teks putih) atau ditulis **vertikal 90°** pada batang sempit; batang yang hampir setinggi area chart otomatis dihindari karena tidak ada ruang di atasnya.
- **Batas kepadatan**: pada overview, tampilan **Harian** (116 batang) tidak diberi angka otomatis + ada keterangan kecil "Angka pada batang tidak ditampilkan pada tampilan Harian (terlalu rapat) — pilih Mingguan atau Bulanan."
- **Skrip uji khusus** `tools/qa-bar-labels.js` memverifikasi aturan ini dengan membandingkan hasil render kanvas saat label aktif vs dimatikan (`toDataURL`) sehingga terbukti angkanya benar-benar tergambar — bukan hanya konfigurasi.

## 3e. Mode rata-rata pada tab "Waktu & Utilisasi" (v1.8.0)

Permintaan: tampilkan **angka rata-rata**, bukan hanya total, pada tab Waktu & Utilisasi.

- Ditambahkan pemilih mode di kanan judul **Rincian Waktu Alat**:
  **Rata-rata / Aktivitas** (bawaan, sesuai permintaan) • **Rata-rata / Hari** • **Total**.
- Yang ikut berubah saat mode diganti:
  1. **12 kartu kolom waktu** — nilai utama memakai satuan mode (`jam/aktivitas`, `jam/hari`, `jam`; untuk Air `L/aktivitas`, `L/hari`, `L`), sedangkan baris kecil di bawahnya menampilkan **total • per aktivitas • per hari sekaligus** sebagai pembanding.
  2. **Tabel Rincian Waktu per Wilayah** — semua kolom waktu dibagi sesuai mode; wilayah dibagi data wilayah itu sendiri (per aktivitas wilayah = total ÷ baris wilayah; per hari wilayah = total ÷ hari operasi wilayah). Ditambahkan kolom **Hari** di samping **Rec** (batch SQL lewat `Set` tanggal per kelompok, tanpa mengubah performa agregasi).
  3. **Chart Komposisi Waktu per Bulan** — tiap bulan dibagi sesuai mode, judul sumbu ikut berubah (`Jam/aktivitas`, `Jam/hari`, `Jam`).
- Keterangan otomatis ikut berubah di tiga tempat (header kartu, bawah tabel, bawah chart) sehingga tidak ada keraguan angka mana yang sedang dibaca. Baris bawah tabel berjudul **RATA-RATA / AKTIVITAS**, **RATA-RATA / HARI**, atau **TOTAL** mengikuti mode.
- Angka penting: 12.730 aktivitas • 116 hari operasi • Σ Operating 180.934,8 jam → **14,21 jam/aktivitas** atau **1.559,78 jam/hari**.
- Rasio (L/Ha, % Avail, % Util) tetap tidak dibagi.

## 3f. Kolom Wilayah beku & chart Performa Waktu (v1.8.1)

Permintaan: (1) kolom **Wilayah** pada tabel *Rincian Waktu per Wilayah* dibekukan agar tetap terlihat saat tabel digeser, (2) ditambahkan **chart bar gaya Performance Wilayah** untuk waktu & utilization.

**1. Kolom Wilayah beku (sticky)**
- Kolom pertama tabel (sel header, seluruh baris data, dan baris kaki rata-rata) diberi `position: sticky; left: 0` sehingga tetap menempel di kiri saat tabel digeser horizontal (tabel berisi 19 kolom dan lebih lebar dari layar).
- Agar batasnya jelas: garis pemisah kanan (`border-right`) + bayangan halus pada kolom beku, serta latar solid putih agar angka di belakangnya tidak tembus.
- Catatan teknis: Tailwind memakai `border-collapse: collapse`, dan pada mode itu `sticky` pada sel tabel tidak dapat diandalkan di Chrome. Tabel ini karena itu memakai `border-collapse: separate; border-spacing: 0` (kelas `wide-table`), tanpa mengubah tampilan garis tabel.
- Hasil uji: pada `scrollLeft = 700` posisi kolom Wilayah tetap di **x = 408 px** (sebelum digeser 408 px) untuk sel header, sel data, dan sel kaki — bukti tangkapan layar `dokumentasi-v1.7.0/15-kolom-wilayah-beku.png`.

**2. Chart baru "Performa Waktu per Wilayah"**
- Diletakkan tepat di atas tabel *Rincian Waktu per Wilayah* (tab Waktu & Utilisasi), gaya sama dengan chart Performance Wilayah: batang horizontal, diurutkan dari terbesar, **angka ditulis pada tiap batang**, tooltip berisi rincian.
- **15 metrik** bisa dipilih lewat dropdown **Metrik**: Jam Operasi (bawaan), Plan Time, Prepare, Waiting, Repair, Down, Standby, Off Time, Tot. Oper., Total Avail, Total Time, Air Terpakai, L/Ha (efisiensi), % Availability, % Utilization — ditambah **6 tombol cepat**: Jam Operasi, Waiting Time, Air Terpakai, Total Avail, % Utilization, L/Ha.
- **Mengikuti mode tampilan waktu**: pada mode Rata-rata/Aktivitas dan Rata-rata/Hari nilai jam & air dibagi sesuai mode wilayahnya (judul sumbu berubah: `jam/akt`, `jam/hari`, `jam`), sedangkan rasio L/Ha, % Avail, % Util tidak dibagi — diberi keterangan "Rasio per wilayah (tidak mengikuti mode rata-rata/total)".
- Keterangan di bawah chart menyebut wilayah tertinggi, mis. *"Nilai = rata-rata jam/akt per wilayah (dibagi data wilayah itu sendiri). Tertinggi: AW11 — 15,68 jam/akt."*
- Contoh hasil (mode bawaan): Jam Operasi **AW11 15,7 → AW09 13,2 jam/aktivitas**; % Utilization **AW15 85,2 → AW10 78,4 %**.

## 4. Hasil uji (Chrome headless, lokal)

| Skrip | Hasil |
|---|---|
| `tools/qa-index-solar.js` | **37/37 lulus** (7 pemeriksaan mode rata-rata/total + **5 pemeriksaan baru v1.8.1**: chart Performa Waktu terisi 8 batang & terurut, satuan mengikuti mode & label sumbu, pemilih 15 metrik + chip cepat, ganti metrik ke % Utilization mengubah data, kolom Wilayah `sticky` di thead/tbody/tfoot & posisinya tidak bergeser saat tabel digeser `scrollLeft=700`) — 6 tab, semua 24 chart terisi, 12 kartu waktu, tabel waktu 8 wilayah + TOTAL, Index Solar 151 engine, filter Boros=27/anomali=2, urut & pencarian & paginasi, filter sidebar AW08 = 19 engine, tabel detail 34 kolom, export CSV 34 kolom × 12.730 baris, 0 error |
| `tools/qa-bar-labels.js` (baru) | **10/10 lulus** — 6 chart single berlabel, 4 chart stacked tanpa label, bukti piksel, aturan harian/bulanan/mingguan |
| `tools/qa.js` (regresi, kini dinamis) | **42/42 lulus** — filter tanggal/bulan/wilayah, pencarian teks & angka, paginasi, sort, granularitas, biaya, export, sync, offline, fallback |
| `tools/layout-test.js` | **24/24 lulus** — laci filter mobile tetap menempel di bawah header, sticky desktop, resize, Esc/backdrop, fokus |
| `tools/stress.js` | **0 error**, heap stabil 29–35 MB |

## 5. Catatan teknis

- **Parser**: nama kolom baru `Tot, Oper, Time` dibaca via pencarian header yang toleran (juga menerima `Tot. Oper. Time`); semua pencarian kolom memakai normalisasi huruf/angka sehingga perubahan tanda baca di sheet tidak lagi mematahkan dashboard.
- **Tanggal Index Solar** `M/D/YYYY` diparse dengan fallback aman (jika angka pertama > 12 dianggap tanggal/bulan).
- **Konflik filter**: filter "Bulan" pada sidebar tidak memfilter tab Index Solar karena tanggalnya berbeda (mis. `18-Sep` tanpa tahun); filter yang berlaku adalah **periode tanggal + wilayah + jenis engine + pencarian**.
- **Perhitungan**: `L/jam aktual = Pemakaian Solar ÷ Jam Operasi` (dihitung sendiri, tidak memakai kolom sheet) agar konsisten antar baris; kolom `ZPAS637` pada tabel index = rekap aktivitas engine yang sama pada periode terpilih (mengikuti filter).
- **Kinerja**: unduhan sheet Index Solar (±13 KB) berjalan paralel dengan CSV utama dan ikut di-cache (`Cache Storage pg2-data-v1`), jadi tidak menambah waktu muat yang berarti — data siap ±0,4–0,6 ms DCL pada uji lokal.

## 6. Status rilis

- Service worker dinaikkan ke **v1.8.1** (cache aset lama dibersihkan otomatis).
- Push ke `wahyudp76/FS-evaluation` → GitHub Actions → <https://wahyudp76.github.io/FS-evaluation/>
