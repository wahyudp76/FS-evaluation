# Laporan Perbaikan — PG2 Irrigation Dashboard v1.5.0

**Tanggal:** 22 September 2026
**Ruang lingkup:** fix bug + cek stabilitas + maintenance performa webapp dashboard ZPAS637
**File yang diubah:** `app.js` (refactor data layer & render), `index.html` (vendors, aksesibilitas, kickoff data), `sw.js` (strategi cache v1.5.0), `README.md`, `tools/*`

---

## 1. Ringkasan hasil

| Metrik (Chrome headless, CPU throttle 4x, median 3 putaran) | Sebelum | Sesudah | Perubahan |
|---|---|---|---|
| Waktu data siap dipakai | **8.681 ms** | **4.673 ms** | **−46%** |
| Pindah tab pertama (dingin) | 1.759 ms | 813 ms | **−54%** |
| Pindah tab (hangat) | 1.110 ms | 313 ms | **−72%** |
| Ubah filter tanggal | 1.204 ms | 136 ms | **−89%** |
| Respons kotak pencarian | 559 ms | 501 ms | −10% |
| Total CPU saat load (task duration) | 7.575 ms | 6.267 ms | −17% |
| Jumlah DOM node setelah load | 6.540 | 3.764 | −42% |

Di jaringan lambat/mobile keunggulannya lebih besar lagi karena payload data turun dari **9,73 MB → 3,56 MB** (−63%).

---

## 2. Bug yang diperbaiki

1. **Sorting "Performance per Wilayah" tidak berfungsi** — pola `b.totalLuas - b.totalLuas === 0 ? 0 : ...` membuat urutan selalu ikut metrik default. Kini urut sesuai metrik yang dipilih (Total Luas, Ha/Jam, Ltr/Ha, Solar, Util, Rp/Ha).
2. **Filter tanggal bergeser satu hari** — `new Date('YYYY-MM-DD')` dibaca sebagai UTC sehingga batas tanggal bisa meleset pada zona WIB (UTC+7). Diganti `parseLocalDate()` (tanggal lokal).
3. **`lucide is not defined`** — library ikon dimuat `defer` sementara inline script memanggilnya lebih dulu → error console setiap load. Kini dipanggil setelah library siap (`refreshIcons()` + guard).
4. **Filter & pencarian jalan berlebihan** — setiap ketikan langsung me-render ulang seluruh dashboard (termasuk 12.396 baris + 15 chart). Kini di-*debounce* 200–220 ms dan pencarian tabel mengabaikan 1 huruf.
5. **Render ganda & data tertimpa** — saat kunjungan berikutnya, hasil cache dan hasil jaringan dua-duanya dirender, dan cache bisa menimpa data jaringan yang lebih baru. Kini payload punya sidik jari (`appliedSig`); cache hanya dipakai kalau belum ada data tampil.
6. **Template injeksi** — nilai dari spreadsheet (wilayah, lokasi, engine, irigator, jenis) tidak di-escape sebelum masuk `innerHTML`. Kini lewat `esc()`.
7. **Export CSV** memakai `Papa.unparse`, padahal papaparse dihapus dari halaman → tombol Export error. Diganti generator CSV internal (dan satu request CDN lebih sedikit).
8. **Event `online` bawaan browser** memicu sync ganda saat halaman baru dibuka → kini hanya sync bila sebelumnya benar-benar offline.

---

## 3. Optimasi performa (maintenance)

**Data & jaringan**
- CSV `tqx=out:csv` (3,56 MB) jadi sumber utama; JSON gviz penuh (9,73 MB) hanya cadangan.
- Hanya **2 permintaan** ke spreadsheet: CSV + query tanggal kecil (`tq=select A`, ±3 KB) untuk tahun yang akurat.
- Unduhan dimulai dari `<head>` (`window.__pgCsvEarly`) → berjalan paralel dengan pemuatan skrip/font (mulai 32 ms, sebelumnya 593 ms), hasilnya dipakai ulang app.js (tanpa unduhan ganda, ada timeout 25 s).
- **Cache Storage `pg2-data-v1`**: kunjungan berikutnya langsung tampil dari cache, lalu diperbarui di belakang; ada notifikasi "Data diperbarui" bila isi spreadsheet berubah.
- Auto-sync 5 menit dijeda saat tab tidak aktif + *backoff* progresif (30 s → 60 s … maks 5 menit) bila gagal.

**Parsing & komputasi**
- `toNumFast()` versi baru tanpa regex/`replace`/`parseFloat` (dipanggil >400.000 kali saat load; sebelumnya ±500 ms CPU) dan parser CSV tetap satu lintasan.
- Agregasi KPI, per-periode, dan per-wilayah kini **satu lintasan akumulasi** per grup (dulu `reduce` berulang per field).
- **Memoization** per versi data (`key@dataVersion`) untuk KPI, agregasi harian/mingguan/bulanan, statistik wilayah & biaya; otomatis invalid saat filter berubah.
- Penyaringan (filter) satu pass dengan batas waktu `getTime()` serta indeks tahun/bulan yang sudah dihitung sekali.

**Rendering**
- Hanya tab yang sedang dilihat yang dirender; tab lain disiapkan `requestIdleCallback` → pindah tab terasa instan.
- Chart dipisah per tab (peta `CHART_TAB_OF`); animasi otomatis mati untuk dataset >60 titik; `devicePixelRatio` dibatasi 2; hanya chart tab aktif yang di-`resize()`.
- `lucide.createIcons()` dipanggil maksimal sekali per frame (dulu 3–4× per alur render).
- Teks CSV besar dilepas dari memori tepat setelah diparse.

**Aksesibilitas & UX**
- Tab memakai `role="tablist"/tab/tabpanel`, `aria-selected` sinkron, navigasi keyboard ←/→/Home/End.
- Toast ringan untuk status sync — dashboard tidak pernah tertutup overlay error karena gangguan sesaat.
- Pesan loading gagal kini punya tombol **Coba lagi** (bukan hanya reload).

---

## 4. Hasil cek stabilitas

| Uji | Hasil |
|---|---|
| Uji fungsional end-to-end (`tools/qa.js`) — 5 tab, filter tanggal/wilayah/bulan/jenis engine, pencarian (teks & angka), paginasi, sort, granularitas, chart, export CSV, sync manual | **35/35 lulus**, 0 error runtime, 0 request gagal |
| Ketahanan (`tools/stress.js`) — 25 klik tab cepat, 25 perubahan filter berturut, pengetikan cepat, 18× ganti granularitas, 2× sync bersamaan | **0 error**, heap stabil 26–28 MB (tidak ada kebocoran) |
| Mode offline (koneksi diputus) | Dashboard tetap terisi dari cache: 12.396 / 12.396 records |
| Spreadsheet tidak bisa diakses | Fallback otomatis ke `assets/sample-data.csv` + toast peringatan (12.396 records) |
| Angka hasil hitung | Sama dengan versi sebelumnya: 44.116,5 Ha • 1.483.274 L solar • Rp 68,39 M • Rp 1.550.299/Ha • 0,251 Ha/Jam • 34,4 L/Ha • 81,5% util • 98,9% avail |
| Uji kesetaraan parser angka | 33.856 nilai unik spreadsheet dibandingkan lama vs baru → identik untuk semua kolom numerik |

---

## 5. Cara menguji ulang di lokal

```bash
python3 -m http.server 8080 --bind 0.0.0.0        # dari folder repo
bash tools/setup-browser.sh                       # sekali saja, siapkan Chrome
export LD_LIBRARY_PATH=/tmp/libs/usr/lib/x86_64-linux-gnu:/tmp/libs/lib/x86_64-linux-gnu
node tools/qa.js http://localhost:8080/index.html         # fungsional + screenshot ke /tmp/qa
node tools/stress.js http://localhost:8080/index.html     # ketahanan
node tools/perf-ab.js <url-lama> <url-baru> 3             # bandingkan performa
```

---

## 6. Status deploy — SELESAI & LIVE

| Item | Status |
|---|---|
| Commit | `42b32ce` — "perf: optimasi performa (data siap -46%, filter -89%), perbaikan bug & penguatan stabilitas v1.5.0" |
| Push ke `wahyudp76/FS-evaluation` | ✅ berhasil (`3ff23dc..42b32ce main -> main`) |
| GitHub Actions run [#35701720696](https://github.com/wahyudp76/FS-evaluation/actions/runs/35701720696) | ✅ success (22 Sep 2026 07:51 UTC) |
| Verifikasi file live | ✅ `app.js` 114.584 B, `index.html` 72.441 B, `sw.js` v1.5.0, `tools/qa.js` tersedia |
| Uji fungsional pada URL live <https://wahyudp76.github.io/FS-evaluation/> | ✅ **35/35 lulus**, 0 error console, 0 request gagal |
| Data siap di live (tanpa throttling) | 599 ms, cache kunjungan berikutnya 1.092 ms, mode offline tetap 12.396 records |

Pengguna yang sudah pernah membuka dashboard akan otomatis mendapat versi baru saat kunjungan berikutnya (service worker `network-first` untuk app shell, cache lama `v1.4.0` dihapus otomatis) — tidak perlu hard refresh.
