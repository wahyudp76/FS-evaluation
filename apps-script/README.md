# Layanan Repair Spreadsheet (tombol Repair di dashboard)

Folder ini berisi dua file yang harus dipasang di Google Apps Script supaya tombol
**Repair** pada notifikasi data error bisa menulis langsung ke spreadsheet.

| File | Isi |
|---|---|
| `RepairAll.gs` | Mesin perbaikan + endpoint Web App (`doGet`, `doPost`, `api`) |
| `Repair.html` | Halaman konsol perbaikan (dibuka Apps Script, bukan dashboard) |

Spreadsheet sasaran: `1mhXxr7cfdnS-A_gJ6E4aixGRSzINdGP94orr-2lL45o`
Sheet: `ZPAS637` dan `Index Solar`.

---

## 1. Pasang kode

1. Buka spreadsheet → **Extensions → Apps Script**.
2. Buat file script bernama `RepairAll`, salin **seluruh** isi `RepairAll.gs`.
3. Buat file HTML bernama `Repair` (tanpa ekstensi), salin seluruh isi `Repair.html`.
4. Simpan (Ctrl/Cmd + S). Pastikan proyek ini terikat pada akun pemilik spreadsheet.
5. Jalankan fungsi `doGet` sekali dari editor (**Run**) untuk memberi izin akses
   (Spreadsheet, Lock, Session, Cache, ContentService).

## 2. Deploy sebagai Web App

1. **Deploy → Manage deployments → Edit** pada deployment yang dipakai dashboard,
   atau **New deployment** bila belum ada.
2. Jenis: **Web app**.
3. **Execute as: Me (akun pemilik spreadsheet)**
4. **Who has access: Anyone** — *wajib*, karena dashboard adalah halaman statis
   publik yang memanggil endpoint ini dari browser pengunjung.
5. Klik **Deploy**, lalu salin URL yang berakhiran `/exec`.

> Keamanan penulisan bertumpu pada **token**, bukan pada Google login. Lihat bagian 4.

## 3. Samakan konfigurasi

Di `app.js` (bagian `REPAIR SPREADSHEET`):

```js
const REPAIR_ENDPOINT = 'https://script.google.com/macros/s/…/exec';  // URL /exec Anda
const REPAIR_TOKEN    = 'pg2-repair-2026';                             // harus sama dengan CFG.TOKEN
```

Di `RepairAll.gs`:

```js
var CFG = {
  TOKEN: 'pg2-repair-2026',       // ganti bila URL bocor
  SHEETS: ['ZPAS637', 'Index Solar'],
  ...
};
```

Setiap kali `RepairAll.gs` diubah: **Deploy → Manage deployments → Edit → New version → Deploy**.
Mengubah kode tanpa versi baru **tidak** mengubah endpoint yang sudah beredar.

## 4. Cek cepat endpoint

Buka di browser (ganti `TOKEN`):

```
…/exec?action=ping
→ {"ok":true,"pong":true,"version":"1.23.0", ...}

…/exec?action=preview&token=pg2-repair-2026
→ {"ok":true,"items":[...],"skipped":[...],"ringkasan":{...}}
```

Bila muncul halaman login Google, artinya **Who has access** belum `Anyone`.
Bila muncul `Script function not found: doGet`, versi deployment belum diperbarui.

---

## Aturan perbaikan

Tombol Repair **hanya** menulis sel yang nilainya bisa dipastikan:

| # | Kondisi sel | Tindakan |
|---|---|---|
| 1 | Kosong pada kolom yang memang berisi rumus | Ditulis rumus dengan pola baris terdekat (referensi relatif dijaga lewat R1C1) |
| 2 | Berisi error `#VALUE!`, `#REF!`, `#DIV/0!`, `#N/A`, `#NAME?`, `#NUM!`, `########` pada kolom rumus | Rumusnya ditulis ulang |
| 3 | Kosong/error pada kolom turunan yang pasti | Dihitung: `Biaya Total = Solar+Upah+Alat`, `Rp/Ha = Total/Luas`, `Tot. Oper. Time = Prepare+Operating`, `Deviasi L/jam = (Solar/Jam)−Kalibrasi` |
| 4 | `Wilayah` kosong | Diisi dari riwayat `Lokasi → Wilayah` **hanya bila konsisten satu wilayah** |
| 5 | Teks angka pada kolom numerik (`"21.08"`, `"1,5"`, `"Rp 2.500.000"`) | Dijadikan angka murni |

**Tidak pernah diubah:** sel yang sudah berisi rumus/nilai normal, nilai di luar batas
wajar (outlier), kolom yang harus diisi manusia (Tanggal, Engine, Lokasi, Irigator),
format angka, warna, lebar kolom, serta sel yang berubah sejak pemindaian
(diperiksa ulang tepat sebelum menulis).

Bila sebuah sel tidak memenuhi satu pun aturan di atas, sel itu masuk daftar
**"sengaja tidak diperbaiki"** beserta alasannya — tidak ada penebakan nilai.

## Keselamatan & jejak audit

- `LockService` mencegah dua proses menulis bersamaan.
- Maksimum **800 sel** per sekali terapkan.
- Maksimum **40 kali terapkan per jam** (throttle berbasis cache).
- Setiap perubahan dicatat di sheet **`Log Repair PG2`** (otomatis disembunyikan):
  waktu, sheet, sel, kolom, jenis perbaikan, nilai lama, nilai baru, rumus, dan email pelaku.
- Setelah menulis, sel dibaca ulang untuk verifikasi; hasilnya dilaporkan sebagai
  `applied` dan `verified`.

## Alur di dashboard

1. Notifikasi data error muncul → tombol **Repair spreadsheet** (atau badge header → **Repair**).
2. Panel menampilkan pratinjau sel yang akan diubah beserta nilai/rumus barunya.
3. **Terapkan perbaikan** → Apps Script menulis, memverifikasi, dan mencatat log.
4. Dashboard otomatis membuang cache payload dan menjalankan **Sync Now**, lalu
   menampilkan jumlah isu yang tersisa.
