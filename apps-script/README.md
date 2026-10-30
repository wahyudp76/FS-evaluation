# Aktifkan tombol Repair all

## Status endpoint
URL deployment yang diberikan saat ini merespons **`Script function not found: doGet`**. Artinya web app belum memiliki handler halaman, jadi jangan gunakan untuk menulis sebelum dua file Apps Script di bawah ditambahkan dan versi baru dideploy.

## Pasang kode
1. Buka proyek Google Apps Script yang menjadi sumber URL tersebut.
2. Buat file script bernama `RepairAll.gs`, lalu salin isi file `RepairAll.gs` di workspace ini.
3. Buat file HTML bernama `Repair`, lalu salin isi `Repair.html` (nama file HTML di editor tanpa ekstensi).
4. Simpan. Pastikan project terikat pada akun pemilik spreadsheet yang memang berhak mengubah sheet.
5. Pilih **Deploy → Manage deployments → Edit** pada deployment web app yang sama, pilih **New version**, lalu deploy. Pertahankan URL `/exec` yang sudah diberikan.
6. Atur web app agar dijalankan sebagai pemilik spreadsheet dan aksesnya dibatasi sesuai kebijakan akun Anda. Jangan menaruh secret atau credential di JavaScript dashboard.
7. Buka URL `/exec`, izinkan akses Google saat diminta, lalu periksa daftar preview sebelum menekan **Repair all**.

## Batas perbaikan
Skrip hanya mengisi sel rumus kosong pada tab `ZPAS637` untuk `Biaya Total`, `Rp/Ha`, dan `Tot, Oper, Time` bila header ditemukan dan semua input untuk kalkulasi tersedia. Ia mengabaikan rumus yang sudah ada, nilai teks wajib kosong, format, outlier, serta kolom yang tidak dikenali. Tidak ada pengisian spekulatif.

Tombol dashboard membuka halaman Apps Script di tab baru; halaman tersebut menampilkan preview dan meminta konfirmasi sebelum menulis. Sesudah selesai, kembali ke dashboard dan tekan **Sync Now** untuk memuat ulang data.
