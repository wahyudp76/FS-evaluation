# Laporan Perbaikan Tampilan — Filter & Kontrol (v1.6.0)

**Tanggal:** 22 September 2026
**Keluhan:** panel *Filters & Controls* tumpang tindih / tertutupi header saat ditampilkan
**File yang diubah:** `index.html` (struktur + CSS), `app.js` (offset header & kontrol laci), `sw.js` (v1.6.0), `tools/*`

---

## 1. Akar masalah yang ditemukan

| # | Masalah | Bukti / dampak |
|---|---|---|
| 1 | **Laci filter mobile memakai kelas bawaan `hidden`** sementara panel didesain `lg:block`. Membukanya = melepas `hidden`, sehingga panel kembali ke aliran normal: `position: static`, **tanpa z-index**, dan berhenti di tengah halaman — kepala panel masuk ke bawah header sticky (z-40) dan ikut tertutupi. | `app.js` lama hanya men-toggle `hidden/fixed/inset-0/z-30` tanpa `top`, jadi panel menempel di atas viewport (y=0) → tertutup header. |
| 2 | **Offset header hard-code & tidak akurat.** Panel memakai `lg:top-[104px]`, sementara tinggi header sebenarnya **101–150 px** (berubah saat ticker terisi, tombol Install muncul, lebar layar, atau zoom). | Tablet 768 px: header 150 px > 104 px → **46 px kepala panel tertutup**. |
| 3 | **`overscroll-behavior` memerangkap scroll.** Panel sticky dengan `overflow-y:auto` "mencuri" roda scroll di atas panel sehingga halaman tidak ikut bergeser — terasa seperti panel mentok di bawah header. | Pengguna scroll di area filter, dashboard di belakangnya tidak jalan. |
| 4 | **Scroll setelah pindah tab salah sasaran.** Kode mencari `nav.sticky`, padahal elemen nav tidak punya kelas `sticky` → offset `-90` selalu dipakai. | Tab bar bisa berhenti 25 px di bawah header atau tertutup. |
| 5 | **Header mobile sendiri tumpang tindih.** Di lebar 390 px, judul 2 baris + badge "ZPAS637 LIVE" bertabrakan dengan tombol Sync/Filter (badge tertutup tombol). | Terlihat pada screenshot 390 px sebelum perbaikan. |

---

## 2. Perbaikan

**Panel filter — perilaku baru**
- **Mobile/tablet (<1024 px): laci (sheet) penuh.** `position: fixed`, mulai **tepat di bawah header** (`top: var(--header-h)`), sudut atas membulat, plus *backdrop* gelap ber-blur; isi panel punya area scroll sendiri yang aman dari header.
- **Desktop (≥1024 px): kolom kiri sticky** dengan `top: var(--header-h) + 16px` dan `max-height: 100dvh`, scrollbar tipis di panel, dan `overscroll-behavior: auto` supaya scroll bisa lanjut ke halaman.
- **`--header-h` diukur runtime** (`syncHeaderOffset()`): diukur saat load, saat header berubah tinggi (`ResizeObserver`), saat resize, dan setelah font selesai dimuat. Berfungsi juga untuk zoom browser & mode tablet (101 / 109 / 112 / 150 px semuanya pas).
- **Kontrol lengkap**: tombol X, klik *backdrop*, tombol **Esc**, dan fokus otomatis kembali ke tombol Filter saat ditutup (aksesibilitas keyboard). `aria-expanded` pada tombol Filter ikut tersinkron.
- **Kepala laci informatif**: judul "Filter & Kontrol" + ringkasan langsung, mis. *"1 filter aktif • 1.352 dari 12.396 records"*.
- Saat kembali ke desktop, laci otomatis ditutup dan kunci scroll halaman dilepas.

**Header**
- Blok judul boleh menyusut (`min-w-0 flex-1`) — judul & badge kini `truncate` dan tidak lagi bertabrakan dengan tombol.
- Tombol Sync & Filter di layar kecil menjadi ikon saja (label tampil ≥ `sm`), *aria-label* tetap ada.
- Kotak ID spreadsheet hanya tampil di layar lebar (`xl`), sehingga header mobile lega.
- Sisipan `--header-h` juga dipakai tab bar (`nav`) supaya tidak menyelip di bawah header saat halaman digeser.

**Lain-lain**
- `#loadingOverlay` (z 80) dan `#toastHost` (z 90) dipastikan selalu di atas laci filter (z 60).
- Scroll setelah klik tab kini memakai tinggi header terukur → tab bar berhenti tepat di bawah header.

---

## 3. Hasil uji (Chrome headless, lokal & akan diuji lagi di live)

Uji tata letak otomatis (`tools/layout-test.js`) — **24/24 lulus**:

| Skenario | Hasil |
|---|---|
| Desktop 1366×900: panel & tab bar mulai di bawah header | ✅ panel 141 px vs header 109 px; nav 137 px |
| Desktop setelah scroll 1400 px: tidak ada yang tertutup header | ✅ panel top = 109 px = header bottom; tinggi panel 759 px (muat viewport) |
| Desktop: klik tab → tab bar tepat di bawah header | ✅ nav 125 px vs header 109 px |
| Mobile 390×844: laci tertutup tidak menghalangi klik | ✅ `visibility:hidden`, `pointer-events:none` |
| Mobile: laci terbuka tepat di bawah header, judul terlihat, kontrol pertama penuh | ✅ panel top 112 px = header bottom 112 px |
| Mobile: filter di dalam laci tetap berfungsi | ✅ 1.985 / 12.396 records |
| Mobile: tombol X / Esc / klik backdrop menutup laci + fokus kembali | ✅ semuanya |
| Tablet 768×1024: laci penuh lebar & di bawah header | ✅ panel top 150 px = header bottom 150 px, lebar 768 px |
| Resize laci → desktop: laci tertutup, body tidak terkunci, panel jadi kolom sticky | ✅ |
| Deteksi tabrakan elemen header (320 / 390 / 768 / 1366 px) | ✅ 0 tumpang tindih, 0 elemen keluar batas |
| Regresi fungsional (`tools/qa.js`) | ✅ **35/35 lulus**, 0 error console |
| Uji ketahanan (`tools/stress.js`) | ✅ 0 error, heap stabil 25–30 MB |

Semua fungsi lama tetap utuh: 5 tab, filter tanggal/bulan/wilayah/jenis engine, pencarian, paginasi, sort, export CSV, sync manual, offline, dan fallback data contoh.

---

## 4. Status rilis

- Versi service worker dinaikkan ke **v1.6.0** supaya cache aset lama dibersihkan otomatis.
- Commit & push ke `wahyudp76/FS-evaluation` → GitHub Actions → <https://wahyudp76.github.io/FS-evaluation/>
- Uji ulang pada URL live dilakukan setelah deploy (lihat bagian verifikasi di commit).

### Rumus tinggi header yang sekarang dipakai
```
--header-h = tinggi header terukur (min 64px)
laci mobile : top = var(--header-h)      (menempel persis di bawah header)
kolom desktop: top = var(--header-h)+16px, max-height = 100dvh - var(--header-h) - 32px
tab bar     : top = var(--header-h)+16px
```
