# Tombol Repair pada notifikasi data error (v1.23.0)

Sebelumnya tombol **Repair all** di panel audit hanya membuka tab baru ke Apps Script
yang belum berfungsi (`Script function not found: doGet`), hanya menangani 3 kolom rumus
di sheet `ZPAS637`, dan setelah itu pengguna harus menekan **Sync Now** sendiri.

Sekarang tombol **Repair** langsung memperbaiki spreadsheet dan dashboard ikut
tersinkronisasi otomatis.

## Yang berubah

| Berkas | Perubahan |
|---|---|
| `apps-script/RepairAll.gs` | Ditulis ulang: endpoint `doPost`/`doGet` JSON, 5 aturan perbaikan, verifikasi sel, log audit, lock, throttle |
| `apps-script/Repair.html` | Ditulis ulang: konsol perbaikan dengan filter jenis, pratinjau nilai baru, status hasil |
| `apps-script/README.md` | Panduan pasang, deploy, verifikasi endpoint, dan batas perbaikan |
| `app.js` | Modul repair baru (pratinjau → terapkan → verifikasi → Sync otomatis), `showToast` mendukung tombol aksi, badge/banner/toast kini punya tombol Repair, bug `onclick` inline diperbaiki |
| `index.html` | Tombol Repair di banner tab Data, versi v1.23.0, cache-busting `app.js?v=1.23.0` |
| `sw.js` | Versi cache v1.23.0 |
| `assets/tailwind.css` | Dibangun ulang agar kelas warna tombol baru tersedia |

## Tiga pintu masuk tombol Repair

1. **Toast notifikasi** yang muncul saat audit menemukan data error
   → tombol `Repair spreadsheet` + `Lihat rincian`.
2. **Badge header** (`17 data janggal / error`) → panel audit → tombol **Repair**
   (dan ikon ↗ untuk konsol penuh di tab baru).
3. **Banner tab Data** → tombol **Repair** di samping "Buka Pusat Audit Data".

## Alur kerja

```
Notifikasi error
   └─ Repair
        ├─ 1. Pratinjau: Apps Script memindai ZPAS637 + Index Solar
        │      (daftar sel, nilai/rumus baru, alasan tiap perbaikan)
        ├─ 2. Terapkan: tulis ke sheet + verifikasi + catat Log Repair PG2
        └─ 3. Sync otomatis: cache payload dibuang, loadData() dipanggil,
               badge & panel audit diperbarui, sisa isu dilaporkan
```

## Aturan perbaikan (konservatif)

Hanya sel yang nilainya **pasti**:

1. Sel kosong pada kolom rumus → ditulis rumus dengan pola baris terdekat (R1C1).
2. Sel error (`#VALUE!`, `#REF!`, `#DIV/0!`, `#N/A`, `#NAME?`, `#NUM!`, `########`)
   pada kolom rumus → rumus ditulis ulang.
3. Sel kosong/error pada kolom turunan pasti:
   - `Biaya Total` = Biaya Solar + Biaya Upah + Biaya Alat
   - `Rp/Ha` = Biaya Total / Luas Siram
   - `Tot. Oper. Time` = Prepare + Operating
   - `Deviasi L/jam` = (Pemakaian Solar / Jam Operasi) − Kalibrasi (kecuali mesin SPE)
4. `Wilayah` kosong → dari riwayat `Lokasi → Wilayah` bila konsisten satu wilayah.
5. Teks angka pada kolom numerik (`21.08`, `1,5`, `Rp 2.500.000`) → angka murni.

Tidak pernah diubah: angka normal, rumus yang sudah ada, outlier, kolom wajib
(Tanggal/Engine/Lokasi/Irigator), format & tata letak sheet.

## Kondisi data saat fitur ini dibuat

Diambil langsung dari spreadsheet (17.401 baris):

| Temuan | Jumlah | Ditangani Repair |
|---|---|---|
| `Biaya Total` berisi `########` | 16 | ya — dihitung dari Solar+Upah+Alat |
| `Wilayah` kosong (baris 766, lokasi `172F`) | 1 | ya — `AW15` dari riwayat lokasi |
| `Biaya Total` kosong total | 0 | — |
| `Rp/Ha`, `Tot. Oper. Time` kosong | 0 | — |
| Error formula lain | 0 | — |
| Nilai bertitik desimal | 0 | — |
| **Total badge dashboard** | **17** | **17 bisa diperbaiki** |

## Cara mengaktifkan

Ikuti `apps-script/README.md` (pasang dua file → deploy Web App sebagai pemilik,
akses `Anyone` → New version → samakan `REPAIR_TOKEN` dengan `CFG.TOKEN`).

Selama deployment belum diperbarui, tombol Repair tetap menampilkan pesan ramah
berisi langkah perbaikannya, bukan gagal diam-diam.

## Catatan teknis

- Penulisan **tidak** dilakukan dari JavaScript publik; hanya Apps Script yang
  berjalan sebagai pemilik spreadsheet yang menulis. Autentikasi memakai token.
- Setelah menulis, sel dibaca ulang (verifikasi). Google Sheets kadang butuh beberapa
  detik untuk menghitung ulang rumus, jadi bila dashboard masih menandai sel yang baru
  diperbaiki, panel menampilkan tombol **Sync Now** untuk menyegarkan sekali lagi.
- Setiap perubahan tercatat di sheet `Log Repair PG2` (disembunyikan otomatis).
