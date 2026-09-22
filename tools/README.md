# tools/ — skrip uji & deploy

Semua skrip Node di folder ini memakai Chrome milik `tools/setup-browser.sh`.
Jalankan sekali (atau setelah `/tmp` direset):

```bash
bash tools/setup-browser.sh          # unduh Chrome for Testing + puppeteer ke /tmp/node
export LD_LIBRARY_PATH=/tmp/libs/usr/lib/x86_64-linux-gnu:/tmp/libs/lib/x86_64-linux-gnu
```

| Skrip | Kegunaan | Contoh |
|---|---|---|
| `qa.js` | Uji fungsional end-to-end (tab, filter, pencarian, paginasi, export, sync, offline, fallback). Screenshot ke `/tmp/qa/` | `node tools/qa.js http://localhost:8080/index.html` |
| `stress.js` | Uji ketahanan: klik tab & filter cepat berulang, pantau error console + heap | `node tools/stress.js http://localhost:8080/index.html` |
| `perf-ab.js` | Bandingkan dua versi (lama vs baru) dengan pengukuran di dalam halaman + throttling CPU 4x | `node tools/perf-ab.js http://localhost:8081/index.html http://localhost:8080/index.html 3` |
| `perf.js` | Profil singkat satu halaman (tDom, tReady, latensi interaksi, durasi CPU) | `node tools/perf.js http://localhost:8080/index.html BARU` |
| `netcheck.js` | Audit jaringan: daftar permintaan `docs.google.com` + timing resource | `node tools/netcheck.js http://localhost:8080/index.html` |
| `setup-browser.sh` | Siapkan Chrome + puppeteer + pustaka sistem di `/tmp` | `bash tools/setup-browser.sh` |
| `push.sh` | Commit & push ke `wahyudp76/FS-evaluation` (butuh PAT) | `bash tools/push.sh <PAT> "pesan commit"` |

Catatan: `push.sh` menerima token sebagai argumen pertama supaya tidak tersimpan di repo;
setelah selesai, remote dikembalikan ke URL tanpa token.
