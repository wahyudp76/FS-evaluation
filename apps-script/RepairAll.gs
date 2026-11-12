/**
 * PG2 Irrigation Dashboard — Layanan Perbaikan Spreadsheet  (v1.23.3)
 * ---------------------------------------------------------------------------
 * Google Apps Script yang terikat pada spreadsheet
 * 1mhXxr7cfdnS-A_gJ6E4aixGRSzINdGP94orr-2lL45o, dijalankan sebagai PEMILIK
 * spreadsheet, dan dipanggil oleh tombol "Repair" pada dashboard PG2.
 *
 * ENDPOINT
 *   POST { action:"ping" }                     -> cek koneksi (tanpa token)
 *   POST { action:"preview", token, keys? }    -> daftar sel yang AMAN diperbaiki
 *   POST { action:"apply",   token, keys? }    -> tulis perbaikan + catat log
 *   GET  ?action=preview|apply|ping&token=...  -> sama, lewat query string
 *   GET  (tanpa action)                        -> halaman konsol HTML (Repair.html)
 *
 * ATURAN PERBAIKAN — konservatif, tidak pernah menebak data:
 *   [1] Sel KOSONG pada kolom yang memang berisi RUMUS  -> ditulis ulang rumus
 *       dengan pola baris terdekat (referensi relatif dijaga lewat R1C1).
 *   [2] Sel berisi ERROR (#VALUE!, #REF!, #DIV/0!, #N/A, #NAME?, #NUM!, #NULL!,
 *       ########) pada kolom rumus                       -> ditulis ulang rumusnya.
 *   [3] Sel KOSONG / ERROR pada kolom turunan yang nilainya pasti
 *       (Biaya Total = Solar+Upah+Alat, Rp/Ha = Total/Luas,
 *        Tot. Oper. Time = Prepare+Operating,
 *        Deviasi L/jam = (Solar/Jam) - Kalibrasi)        -> nilai dihitung.
 *   [4] Sel KOSONG pada kolom Wilayah -> diisi dari riwayat pasangan
 *       Lokasi->Wilayah yang KONSISTEN (satu wilayah saja).
 *   [5] Teks angka / desimal bertitik ("21.08", "1,5", "Rp 2.500.000") pada
 *       kolom numerik                                     -> dijadikan angka murni.
 *
 * TIDAK PERNAH DIUBAH
 *   - Sel yang sudah berisi rumus atau nilai normal.
 *   - Nilai di luar batas wajar (outlier) — sengaja dibiarkan untuk PIC.
 *   - Kolom wajib yang harus diisi manusia (Tanggal, Engine, Lokasi, Irigator).
 *   - Format angka, warna, lebar kolom, dan struktur sheet.
 *   - Sel yang sudah berubah sejak pemindaian (diperiksa ulang sebelum menulis).
 *
 * KEAMANAN
 *   Setiap aksi tulis wajib menyertakan TOKEN yang sama dengan REPAIR_TOKEN di
 *   app.js. Ganti keduanya bila URL Web App bocor. Setiap perubahan dicatat di
 *   sheet "Log Repair PG2" (disembunyikan otomatis) berisi waktu, sel, nilai
 *   lama, nilai baru, dan email akun yang menjalankan.
 */

var CFG = {
  SPREADSHEET_ID: '1mhXxr7cfdnS-A_gJ6E4aixGRSzINdGP94orr-2lL45o',
  SHEETS: ['ZPAS637', 'Index Solar'],
  TOKEN: 'pg2-repair-2026',
  SAMPEL_BARIS: 300,        // b6: jumlah baris sampel untuk pola rumus/nilai (165 ms vs 5.481 ms)
  VERSION: '1.23.10',
  BUILD: 'b11',             // naikkan setiap kali kode diperbarui, untuk cek deployment
  MAX_CHANGES: 800,        // batas jumlah sel per satu kali terapkan
  TEMPLATE_LOOKUP: 400,    // jarak maksimum baris acuan rumus
  PREFER_FORMULA_FAR: false, // true = pakai rumus acuan walau jauh, false = hitung nilai
  FORMULA_MIN: 3,          // minimal jumlah rumus agar kolom dianggap "kolom rumus"
  FORMULA_RATIO: 0.2,      // porsi minimal rumus terhadap baris berdata
  LOG_SHEET: 'Log Repair PG2',
  THROTTLE_MAX: 40,        // maksimum aksi "apply" per jam
  THROTTLE_WINDOW_MS: 3600000
};

/* ========================================================================== *
 * ROUTER
 * ========================================================================== */

function doGet(e) {
  var p = (e && e.parameter) || {};
  var action = String(p.action || '').toLowerCase();
  if (action === 'ping' || action === 'preview' || action === 'apply' || action === 'diagnosa') {
    return jsonOut_(handle_({
      action: action,
      token: p.token,
      keys: p.keys ? String(p.keys).split('|') : null
    }));
  }
  var t = HtmlService.createTemplateFromFile('Repair');
  t.token = String(p.token || CFG.TOKEN);
  t.embed = String(p.embed || '') === '1';
  t.scope = String(p.keys || '');
  t.autoApply = String(p.do || '') === 'apply';
  return t.evaluate()
    .setTitle('PG2 — Repair Spreadsheet')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function doPost(e) {
  var body = {};
  try {
    body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return jsonOut_({ ok: false, error: 'Payload JSON tidak valid.' });
  }
  return jsonOut_(handle_(body));
}

/**
 * JALAN PINTAS DARI EDITOR — tidak perlu deploy Web App sama sekali.
 * Buka editor Apps Script -> pilih fungsi "perbaikiSekarang" -> Run.
 * Hasil lengkap muncul di panel Execution log.
 */
function perbaikiSekarang() {
  var res = apply_(null);
  if (!res || !res.ok) {
    Logger.log('GAGAL: ' + ((res && res.error) || 'tidak diketahui'));
    return res;
  }
  Logger.log('SELESAI — ' + res.applied + ' sel diperbaiki, ' + res.verified + ' terverifikasi.');
  (res.items || []).forEach(function (it) {
    Logger.log('  ' + it.kunci + ' [' + it.kolom + '] -> ' + (it.hasil || it.nilaiBaru || it.rumus));
  });
  var gagal = res.gagal || [];
  if (gagal.length) {
    Logger.log('DILEWATI (' + gagal.length + '):');
    gagal.forEach(function (g) { Logger.log('  ' + g.kunci + ' — ' + g.alasan); });
  }
  return res;
}

/**
 * Cek cepat tanpa membuka spreadsheet: cek koneksi + jumlah sel yang siap diperbaiki.
 */
function cekStatus() {
  var p = preview_(null);
  Logger.log('Versi ' + CFG.VERSION + ' build ' + CFG.BUILD + ' — ' + p.items.length + ' sel siap diperbaiki.');
  (p.items || []).forEach(function (it) {
    Logger.log('  ' + it.kunci + ' [' + it.kolom + '] -> ' + (it.nilaiBaru || it.rumus));
  });
  return p;
}

/** Dipakai halaman HtmlService lewat google.script.run. */
function api(req) {
  return handle_(req || {});
}

/**
 * Sidik fitur: membuktikan kode yang BERJALAN (bukan hanya tersimpan) sudah versi terbaru.
 * Cara pakai: buka .../exec?action=ping lalu bandingkan "fitur" dengan yang diharapkan.
 * v1.23.3 menambahkan: WAKTU (field waktu pada preview) + SATU_BUKA (1x openById).
 */

/**
 * Pemeriksa keutuhan tempelan. Membandingkan fitur yang SEHARUSNYA ada pada build ini
 * dengan yang benar-benar ditemukan. Kalau tempelan terpotong, daftar 'hilang' akan
 * menunjukkan bagian mana yang tidak masuk.
 */
function lengkap_(build) {
  var perlu = {
    b11: ['DIAGNOSA', 'SATU_BUKA', 'SAMPEL', 'PINDAI_GALAT', 'GALAT_LUAR_SAMPEL', 'ISNUM_DARI_NILAI', 'PREVIEW_WAKTU', 'WAKTU', 'RINCIAN_WAKTU', 'PRASYARAT_RUMUS', 'PRASYARAT_BACA_LANGSUNG', 'PRASYARAT_ANGKA', 'PINDAI_PENUH'],
    b10: ['DIAGNOSA', 'SATU_BUKA', 'SAMPEL', 'PINDAI_GALAT', 'GALAT_LUAR_SAMPEL', 'ISNUM_DARI_NILAI', 'PREVIEW_WAKTU', 'WAKTU', 'RINCIAN_WAKTU', 'PRASYARAT_RUMUS', 'PRASYARAT_BACA_LANGSUNG', 'PRASYARAT_ANGKA'],
    b9: ['DIAGNOSA', 'SATU_BUKA', 'SAMPEL', 'PINDAI_GALAT', 'GALAT_LUAR_SAMPEL', 'ISNUM_DARI_NILAI', 'PREVIEW_WAKTU', 'WAKTU', 'RINCIAN_WAKTU', 'PRASYARAT_RUMUS', 'PRASYARAT_BACA_LANGSUNG'],
    b8: ['DIAGNOSA', 'SATU_BUKA', 'SAMPEL', 'PINDAI_GALAT', 'GALAT_LUAR_SAMPEL', 'ISNUM_DARI_NILAI', 'PREVIEW_WAKTU', 'WAKTU', 'RINCIAN_WAKTU', 'PRASYARAT_RUMUS'],
    b7: ['DIAGNOSA', 'SATU_BUKA', 'SAMPEL', 'PINDAI_GALAT', 'GALAT_LUAR_SAMPEL', 'ISNUM_DARI_NILAI', 'PREVIEW_WAKTU', 'WAKTU', 'RINCIAN_WAKTU'],
    b6: ['DIAGNOSA', 'SATU_BUKA', 'SAMPEL', 'PINDAI_GALAT', 'GALAT_LUAR_SAMPEL', 'ISNUM_DARI_NILAI', 'PREVIEW_WAKTU', 'WAKTU'],
    b5: ['DIAGNOSA', 'SATU_BUKA', 'PREVIEW_WAKTU', 'WAKTU']
  }[String(build || '')] || null;
  if (!perlu) return { ok: true, catatan: 'build tidak dikenal, pemeriksaan dilewati' };
  var ada = sidikFitur_();
  var hilang = [];
  for (var i = 0; i < perlu.length; i++) if (ada.indexOf(perlu[i]) < 0) hilang.push(perlu[i]);
  return {
    ok: hilang.length === 0,
    fiturAda: ada,
    hilang: hilang,
    pesan: hilang.length === 0
      ? 'Kode lengkap untuk ' + build + '.'
      : 'TEMPELAN TERPOTONG — ' + hilang.length + ' bagian tidak ada: ' + hilang.join(', ') +
        '. Tempel ulang SELURUH isi RepairAll.gs.'
  };
}

function sidikFitur_() {
  var f = [];
  try {
    // Fitur diperiksa dari ISI FUNGSI yang benar-benar berjalan, bukan dari variabel versi.
    // Tempelan yang terpotong tidak akan lolos pemeriksaan ini.
    if (typeof diagnosa_ === 'function') f.push('DIAGNOSA');
    if (String(buildPlan_).indexOf('dibuka SEKALI') >= 0) f.push('SATU_BUKA');
    if (String(scanSheet_).indexOf('CFG.SAMPEL_BARIS') >= 0) f.push('SAMPEL');
    if (typeof pindaiDalam_ === 'function') f.push('PINDAI_GALAT');   // diteruskan demi kompatibilitas
    if (String(scanSheet_).indexOf('galatLuarIdx') >= 0) f.push('GALAT_LUAR_SAMPEL');
    if (String(scanSheet_).indexOf('numTotal / terisi') >= 0) f.push('ISNUM_DARI_NILAI');
    if (String(preview_).indexOf('plan.waktu') >= 0) f.push('PREVIEW_WAKTU');
    if (String(scanSheet_).indexOf('out.waktu.loop') >= 0) f.push('RINCIAN_WAKTU');
    if (String(scanSheet_).indexOf('periksaPrasyarat_') >= 0) f.push('PRASYARAT_RUMUS');
    if (String(scanSheet_).indexOf('periksaPrasyarat_(rumusTpl, row, col, sh,') >= 0) f.push('PRASYARAT_BACA_LANGSUNG');
    // b10: penanda diperiksa di fungsi pemeriksanya sendiri, bukan di scanSheet_.
    if (String(periksaPrasyarat_).indexOf('bilanganKetat_') >= 0 && String(periksaPrasyarat_).indexOf('bukanAngka') >= 0) f.push('PRASYARAT_ANGKA');
    if (String(pindaiDalam_).indexOf('posisiRumus') >= 0 && String(scanSheet_).indexOf('polaTerdekat_') >= 0) f.push('PINDAI_PENUH');
    if (String(buildPlan_).indexOf('waktu') >= 0) f.push('WAKTU');
  } catch (e) { f.push('GAGAL_' + (e && e.message ? e.message.slice(0, 40) : 'unknown')); }
  return f;
}

/** Jumlah baris & penanda penutup: mendeteksi tempelan yang terpotong. */
function ukuranKode_() {
  var out = { baris: 0, tulis: false };
  try {
    var src = String(scanSheet_) + String(buildPlan_) + String(preview_) + String(apply_) + String(diagnosa_);
    out.baris = src.split('\n').length;
  } catch (e) {}
  return out;
}

/**
 * DIAGNOSA PERFORMA (hanya baca, tidak pernah menulis).
 * Memanggil .../exec?action=diagnosa&token=... akan mengukur biaya tiap operasi
 * Google Sheets secara terpisah, supaya jelas bagian mana yang makan 20+ detik.
 */
function diagnosa_() {
  var hasil = { ok: true, action: 'diagnosa', build: CFG.BUILD, langkah: [] };
  function ukur(nama, fn) {
    var t = Date.now();
    var val = null, err = null;
    try { val = fn(); } catch (e) { err = (e && e.message) ? e.message : String(e); }
    hasil.langkah.push({ nama: nama, ms: Date.now() - t, err: err });
    return val;
  }

  var ss = ukur('openById', function () { return SpreadsheetApp.openById(CFG.SPREADSHEET_ID); });
  var sh = ukur('getSheetByName(ZPAS637)', function () { return ss.getSheetByName('ZPAS637'); });
  if (!sh) { hasil.ok = false; hasil.error = 'Sheet ZPAS637 tidak ditemukan'; return hasil; }

  var lastRow = ukur('getLastRow', function () { return sh.getLastRow(); }) || 0;
  var lastCol = ukur('getLastColumn', function () { return sh.getLastColumn(); }) || 0;
  hasil.dimensi = { baris: lastRow, kolom: lastCol, sel: lastRow * lastCol };

  // 1) getValues() seluruh rentang
  var values = ukur('getValues (seluruh ' + (lastRow * lastCol) + ' sel)', function () {
    return sh.getRange(1, 1, lastRow, lastCol).getValues();
  });

  // 2) getFormulas() seluruh rentang
  var formulas = ukur('getFormulas (seluruh rentang)', function () {
    return sh.getRange(1, 1, lastRow, lastCol).getFormulas();
  });

  // 3) berapa kolom yang benar-benar berisi rumus (informasi >0 berarti range berumus)
  var kolomRumus = 0, selRumus = 0;
  if (formulas) {
    for (var c = 0; c < lastCol; c++) {
      var ada = false;
      for (var r = 1; r < formulas.length; r++) { if (formulas[r][c] !== '') { ada = true; selRumus++; } }
      if (ada) kolomRumus++;
    }
  }
  hasil.kolomRumus = kolomRumus;
  hasil.selRumus = selRumus;

  // 4) getFormulas() hanya pada sampel kecil (200 baris) -> untuk deteksi pola murah
  ukur('getFormulas (sampel 200 baris)', function () {
    return sh.getRange(1, 1, Math.min(200, lastRow), lastCol).getFormulas();
  });

  // 5) getValues() per kolom (39 panggilan) -> pembanding biaya round-trip
  ukur('getValues per kolom (' + lastCol + ' panggilan)', function () {
    var total = 0;
    for (var i = 1; i <= lastCol; i++) total += sh.getRange(2, i, lastRow - 1, 1).getValues().length;
    return total;
  });

  // 6) biaya logika aturan saja (tanpa baca Sheets) memakai data yang sudah ada
  if (values && formulas) {
    var dummy = { name: 'ZPAS637', getLastRow: function () { return lastRow; }, getLastColumn: function () { return lastCol; },
      getRange: function () { return { getValues: function () { return values; }, getFormulas: function () { return formulas; } }; } };
    ukur('LOGIKA scanSheet_ (data sudah di memori)', function () { return scanSheet_(dummy, 'ZPAS637', null); });
  }

  hasil.totalMs = 0;
  for (var k = 0; k < hasil.langkah.length; k++) hasil.totalMs += hasil.langkah[k].ms;
  return hasil;
}

function handle_(req) {
  var action = String(req.action || '').toLowerCase();
  try {
    if (action === 'ping') {
      return {
        ok: true, pong: true, version: CFG.VERSION, build: CFG.BUILD,
        fitur: sidikFitur_(),
        lengkap: lengkap_(CFG.BUILD),
        barisKode: (function () { try { return String(buildPlan_).length; } catch (e) { return 0; } })(),
        time: new Date().toISOString(),
        user: userEmail_(),
        sheets: CFG.SHEETS
      };
    }
    if (action === 'diagnosa') return diagnosa_();   // hanya baca, tidak pernah menulis -> tidak perlu token
    var tokenKirim = String(req.token || '');
    if (!tokenKirim) {
      // b9: pesan dibedakan. Penyebab tersering BUKAN token salah, melainkan token tidak
      // terkirim sama sekali (mis. membuka /exec tanpa ?token=, atau body POST kosong
      // setelah redirect Apps Script). Dulu keduanya dilaporkan sebagai "token tidak cocok"
      // sehingga menyesatkan ke arah mengubah konstanta.
      return {
        ok: false,
        error: 'Permintaan tidak membawa token. Bila membuka URL langsung, sertakan ?action=' + action +
               '&token=<TOKEN>. Bila dari dashboard, muat ulang halaman dengan Ctrl+Shift+R.'
      };
    }
    if (tokenKirim !== CFG.TOKEN) {
      return {
        ok: false,
        error: 'Token tidak cocok (dikirim ' + tokenKirim.length + ' karakter, seharusnya ' +
               CFG.TOKEN.length + '). Periksa REPAIR_TOKEN di app.js terhadap CFG.TOKEN di Apps Script.'
      };
    }
    if (action === 'preview') return preview_(req.keys);
    if (action === 'apply') return apply_(req.keys);
    return { ok: false, error: 'Aksi tidak dikenal: ' + action };
  } catch (err) {
    return { ok: false, error: (err && err.message) ? err.message : String(err) };
  }
}

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function userEmail_() {
  try { return Session.getEffectiveUser().getEmail() || 'anonim'; }
  catch (e) { return 'anonim'; }
}

/* ========================================================================== *
 * PREVIEW & APPLY
 * ========================================================================== */

function preview_(keys) {
  var plan = buildPlan_(keys);
  return {
    ok: true,
    action: 'preview',
    version: CFG.VERSION,
    build: CFG.BUILD,
    spreadsheet: plan.spreadsheet || CFG.SPREADSHEET_ID,
    items: plan.items,
    skipped: plan.skipped,
    ringkasan: ringkas_(plan.items, plan.skipped),
    waktu: plan.waktu || null,
    at: new Date().toISOString()
  };
}

function apply_(keys) {
  // getDocumentLock() hanya tersedia bila skrip terikat pada spreadsheet. Proyek
  // standalone mengembalikan null -> pakai getScriptLock() sebagai gantinya.
  var lock = ambilLock_();
  var adaLock = false;
  if (lock) {
    try { adaLock = lock.tryLock(20000); } catch (e) { adaLock = false; }
    if (!adaLock) {
      return { ok: false, error: 'Spreadsheet sedang dipakai proses lain (locked). Coba lagi beberapa detik lagi.' };
    }
  }
  try {
    var batas = cekThrottle_();
    if (batas) return { ok: false, error: batas };

    var plan = buildPlan_(keys);
    var akanDitulis = plan.items.slice(0, CFG.MAX_CHANGES);
    var dilewati = plan.items.slice(CFG.MAX_CHANGES).map(function (it) {
      return { kunci: it.kunci, alasan: 'Melewati batas ' + CFG.MAX_CHANGES + ' sel sekali terapkan.' };
    });

    var ss = SpreadsheetApp.openById(CFG.SPREADSHEET_ID);
    var perSheet = {};
    akanDitulis.forEach(function (it) { (perSheet[it.sheet] = perSheet[it.sheet] || []).push(it); });

    var applied = [], gagal = [];

    Object.keys(perSheet).forEach(function (sheetName) {
      var sh = ss.getSheetByName(sheetName);
      if (!sh) {
        perSheet[sheetName].forEach(function (it) {
          gagal.push({ kunci: it.kunci, alasan: 'Sheet "' + sheetName + '" tidak ditemukan.' });
        });
        return;
      }
      var cacheR1C1 = {};

      perSheet[sheetName].forEach(function (it) {
        var col = colToNum_(it.huruf);
        try {
          var cell = sh.getRange(it.baris, col);
          var formulaSekarang = cell.getFormula();
          var nilaiSekarang = cell.getValue();
          var nilaiTeks = String(nilaiSekarang === null || nilaiSekarang === undefined ? '' : nilaiSekarang).trim();

          if (formulaSekarang !== '') {
            gagal.push({ kunci: it.kunci, alasan: 'Sel sudah berisi rumus (berubah setelah pemindaian). Dilewati.' });
            return;
          }

          // ---- mode FORMULA: tulis ulang pola rumus dari sel acuan
          if (it.mode === 'formula') {
            var cacheKey = it.huruf + '|' + it.template;
            if (cacheR1C1[cacheKey] === undefined) {
              cacheR1C1[cacheKey] = it.template ? sh.getRange(it.template, col).getFormulaR1C1() : '';
            }
            if (!cacheR1C1[cacheKey]) {
              gagal.push({ kunci: it.kunci, alasan: 'Rumus acuan tidak ditemukan lagi.' });
              return;
            }
            cell.setFormulaR1C1(cacheR1C1[cacheKey]);
            applied.push(it);
            return;
          }

          // ---- mode VALUE: tulis nilai hasil hitung / wilayah
          var bolehTimpa = (it.tipe === 'error') ||
                           /^#{4,}$/.test(nilaiTeks) ||
                           nilaiTeks === '' ||
                           nilaiTeks === it.nilaiSekarang;
          if (!bolehTimpa) {
            gagal.push({
              kunci: it.kunci,
              alasan: 'Sel sudah terisi "' + nilaiTeks + '" (berubah setelah pemindaian). Dilewati.'
            });
            return;
          }

          if (it.tipe === 'wilayah') {
            cell.setValue(it.nilaiBaru);
            applied.push(it);
            return;
          }
          var n = angka_(it.nilaiBaru);
          if (!isFinite(n)) {
            gagal.push({ kunci: it.kunci, alasan: 'Nilai hasil hitung tidak valid.' });
            return;
          }
          cell.setValue(n);
          applied.push(it);
        } catch (err) {
          gagal.push({ kunci: it.kunci, alasan: (err && err.message) ? err.message : String(err) });
        }
      });
    });

    SpreadsheetApp.flush();

    // Verifikasi: pastikan sel benar-benar sudah terisi sesudah penulisan.
    var terverifikasi = 0, tidakTerbaca = [];
    applied.forEach(function (it) {
      try {
        var sh2 = ss.getSheetByName(it.sheet);
        var c2 = sh2.getRange(it.baris, colToNum_(it.huruf));
        var isi = c2.getFormula();
        if (!isi) {
          var v = c2.getValue();
          isi = String(v === null || v === undefined ? '' : v).trim();
        }
        if (isi) { terverifikasi++; it.hasil = isi; }
        else tidakTerbaca.push(it.kunci);
      } catch (e) { tidakTerbaca.push(it.kunci); }
    });

    tulisLog_(applied);

    return {
      ok: true,
      action: 'apply',
      version: CFG.VERSION,
      applied: applied.length,
      verified: terverifikasi,
      items: applied,
      gagal: gagal.concat(dilewati),
      tidakTerbaca: tidakTerbaca,
      at: new Date().toISOString()
    };
  } finally {
    if (adaLock) { try { lock.releaseLock(); } catch (e) {} }
  }
}

/**
 * Lock yang aman untuk skrip standalone maupun terikat.
 * getDocumentLock() null bila skrip tidak terikat pada dokumen.
 */
function ambilLock_() {
  try {
    var dl = LockService.getDocumentLock();
    if (dl) return dl;
  } catch (e) { /* standalone: tidak ada document lock */ }
  try { return LockService.getScriptLock(); } catch (e) { return null; }
}

function cekThrottle_() {
  try {
    var cache = CacheService.getScriptCache();
    var n = Number(cache.get('repair-apply-count') || 0);
    if (n >= CFG.THROTTLE_MAX) {
      return 'Batas ' + CFG.THROTTLE_MAX + ' kali terapkan per jam tercapai. Coba lagi nanti.';
    }
    cache.put('repair-apply-count', String(n + 1), Math.floor(CFG.THROTTLE_WINDOW_MS / 1000));
  } catch (e) { /* cache opsional */ }
  return '';
}

/* ========================================================================== *
 * PEMINDAIAN — inti aturan perbaikan
 * ========================================================================== */

function buildPlan_(keys) {
  var only = keysToSet_(keys);
  var t0 = Date.now();
  var ss = SpreadsheetApp.openById(CFG.SPREADSHEET_ID);   // dibuka SEKALI (dulu 2x untuk preview)
  var tBuka = Date.now() - t0;
  var items = [], skipped = [], tScan = 0, hasilWaktu = {};

  CFG.SHEETS.forEach(function (name) {
    var sh = ss.getSheetByName(name);
    if (!sh) {
      skipped.push({ kunci: '', sheet: name, alasan: 'Sheet "' + name + '" tidak ditemukan di spreadsheet.' });
      return;
    }
    var ts = Date.now();
    var res = scanSheet_(sh, name, only);
    tScan += Date.now() - ts;
    (hasilWaktu[name] = res.waktu || {});
    items = items.concat(res.items);
    skipped = skipped.concat(res.skipped);
  });

  items.sort(function (a, b) {
    if (a.sheet !== b.sheet) return a.sheet < b.sheet ? -1 : 1;
    if (a.baris !== b.baris) return a.baris - b.baris;
    return a.huruf < b.huruf ? -1 : 1;
  });
  var nama = '';
  try { nama = ss.getName(); } catch (e) {}
  // Waktu ini membantu mendiagnosis lambatnya Apps Script (batas platform, bukan bug).
  return {
    items: items, skipped: skipped, spreadsheet: nama,
    waktu: { buka: tBuka, scan: tScan, total: Date.now() - t0, perSheet: hasilWaktu }
  };
}


/**
 * Deteksi sel error DI LUAR blok sampel tanpa mengunduh seluruh sheet.
 * Dipakai oleh optimizeGrid_. Kembalikan { "huruf|baris": teksError }.
 */
/**
 * b11: satu lintasan menyeluruh atas seluruh baris.
 *
 * Menggantikan pindaiGalat yang hanya mencari teks error (#REF!, #DIV/0!, ...).
 * Fungsi ini mencatat TIGA hal sekaligus dalam satu pembacaan:
 *   1. teks error            -> out['HURUF|barisIdx']
 *   2. sel kosong pada kolom yang PUNYA rumus di mana pun -> out['HURUF|barisIdx'] = '(kosong)'
 *   3. rumus pola           -> daftarRumus[kolom] (60 terakhir) supaya bisa memulihkan
 *                              rumus pada baris di luar blok sampel.
 *
 * Mengapa (3) penting: dulu isFormulaCol hanya menandai kolom yang >= FORMULA_MIN sel
 * berumus DI SAMPEL. Kolom yang semua baris sampelnya kosong (mis. AG Ha/Jam yang seluruh
 * barisnya kosong karena pembagi 0) tidak pernah dianggap kolom rumus, sehingga sel kosong
 * di dalamnya TIDAK PERNAH dilaporkan. Notifikasi "data error" muncul tetapi tombol Repair
 * tidak menawarkan apa pun. Sekarang keberadaan rumus di mana pun sudah cukup.
 */
function pindaiDalam_(sh, nRow, nCol, kolomTarget, posisiRumus, daftarRumus) {
  var hasil = { err: {}, kosong: {} };
  if (!kolomTarget.length) return hasil;
  var out = hasil.err, kosongPeta = hasil.kosong;
  var BLOK = 1500;          // 1500 baris per panggilan; getValues+getFormulas sekaligus
  var SIMPAN_RUMUS = 60;    // 60 pola terakhir sudah lebih dari cukup
  for (var b = 0; b < kolomTarget.length; b++) {
    var c = kolomTarget[b];
    var huruf = colLetter_(c + 1);
    var punyaRumus = false;
    var mulai = 2;                                     // baris 1 = header
    for (; mulai <= nRow + BLOK; mulai += BLOK) {
      var n = Math.min(BLOK, nRow - mulai + 1);
      if (n <= 0) break;
      var rng = sh.getRange(mulai, c + 1, n, 1);
      var nil = rng.getValues();
      var fm = rng.getFormulas();
      for (var i = 0; i < n; i++) {
        var f = fm[i][0];
        if (f && String(f).replace(/^\s+/, '').charAt(0) === '=') {
          punyaRumus = true;
          posisiRumus[c] = (posisiRumus[c] || 0) + 1;
          var simpan = daftarRumus[c];
          if (simpan && simpan.length < SIMPAN_RUMUS) simpan.push({ f: String(f), r: mulai + i });
        }
      }
      for (var j = 0; j < n; j++) {
        var t = teks_(nil[j][0]);
        if (t && (t.charAt(0) === '#' || /^NaN$/i.test(t))) {
          out[huruf + '|' + (mulai + j)] = t;         // NOMOR BARIS SHEET (1-based), sama seperti pindaiGalat
        }
      }
    }
    // Sel kosong hanya dicatat untuk kolom yang benar-benar berisi rumus di suatu tempat.
    if (!punyaRumus) continue;
    for (var mulai2 = 2; mulai2 <= nRow; mulai2 += BLOK) {
      var n2 = Math.min(BLOK, nRow - mulai2 + 1);
      if (n2 <= 0) break;
      var blk2 = sh.getRange(mulai2, c + 1, n2, 1).getValues();
      for (var k = 0; k < n2; k++) {
        var vv = blk2[k][0];
        if (vv === '' || vv === null || vv === undefined) {
          kosongPeta[huruf + '|' + (mulai2 + k)] = true;   // NOMOR BARIS SHEET (1-based)
        }
      }
    }
  }
  return hasil;
}

/**
 * b11: apakah rumus layak dipasang di baris ini?
 *
 * Aturan inti: JANGAN usulkan bila hasilnya hanya akan kosong lagi. Contoh nyata:
 * AG = round(I/M;4) dengan M = 0 -> #DIV/0! -> ditelan iferror -> kosong kembali.
 * Jadi setiap sel acuan yang berupa ANGKA harus terisi dan bukan nol.
 * Acuan yang dirangkai dengan & (teks) tidak dipaksa angka.
 */
function pembandingRumus_(rumus, barisSheet, vBaris, kol) {
  var ruj = rujukanRumus_(rumus);
  if (!ruj.length) return { ok: true, catatan: 'Rumus tidak bergantung pada sel lain.' };
  // b11: rujukan pada `rumus` masih menunjuk baris TEMPLATE (mis. I61), sedangkan yang
  // dipasang nanti adalah versi yang sudah digeser (I15083). Geser dulu sebelum diperiksa.
  var geser = barisSheet - 1 - ruj[0].baris;
  if (!isFinite(geser)) geser = 0;
  var kosong = [], nol = [], teks = [], dipakai = [];
  for (var i = 0; i < ruj.length; i++) {
    var rr = ruj[i].baris + geser, cc = ruj[i].kolom;
    if (rr < 0 || cc < 0) continue;
    var a1 = hurufKolom_(cc + 1) + (rr + 1);
    if (dipakai.indexOf(a1) >= 0) continue;
    dipakai.push(a1);
    var v = vBaris[cc];
    var hampa = (v === '' || v === null || v === undefined);
    if (hampa) { kosong.push(a1); continue; }
    if (teksBoleh_(rumus, a1)) continue;                 // memang dirangkai sebagai teks
    if (!bilanganKetat_(v)) { teks.push(a1 + '="' + v + '"'); continue; }
    if (angka_(v) === 0) nol.push(a1);
  }
  if (!kosong.length && !nol.length && !teks.length) {
    return { ok: true, catatan: 'Semua acuan terisi: ' + dipakai.join(', ') + '.' };
  }
  var sebab = [];
  if (kosong.length) sebab.push(kosong.join(', ') + ' masih kosong');
  if (nol.length) sebab.push(nol.join(', ') + ' bernilai 0 (pembagi/penjumlah kosong)');
  if (teks.length) sebab.push(teks.join(', ') + ' berisi teks, bukan angka');
  return {
    ok: false,
    alasan: 'PRASYARAT TIDAK SIAP: ' + sebab.join('; ') + '. Rumus pola kolom ini membutuhkannya, ' +
      'jadi memasangnya sekarang hanya menghasilkan sel kosong lagi (error ditelan iferror) ' +
      'dan masalahnya justru tersembunyi. Lengkapi dulu ' + dipakai.join(', ') + ' dengan angka yang benar.'
  };
}

/** Pola rumus dengan jarak baris terdekat dari baris tujuan. */
function polaTerdekat_(daftar, barisSheet) {
  var best = null, jarak = 1e9;
  for (var i = 0; i < daftar.length; i++) {
    var d = Math.abs(daftar[i].r - barisSheet);
    if (d < jarak) { jarak = d; best = daftar[i]; }
  }
  return best;
}

/** Apakah nilai pembanding ini terisi (bukan kosong / 0)? */
function adaIsi_(v) {
  if (v === '' || v === null || v === undefined) return false;
  if (typeof v === 'number') return v !== 0 && isFinite(v);
  var t = teks_(v);
  if (!t) return false;
  var n = angka_(v);
  return !(isFinite(n) && n === 0);
}

function scanSheet_(sh, sheetName, only) {
  var out = { items: [], skipped: [], waktu: {} };
  var T0 = Date.now();
  var lastRow = sh.getLastRow();
  var lastCol = sh.getLastColumn();
  if (lastRow < 2 || lastCol < 1) return out;

  // ===== OPTIMASI b6 (berdasarkan pengukuran nyata, lihat catatan di bawah) =====
  // Hasil ukur Apps Script pada sheet ini (17.857 x 39 = 696.423 sel):
  //   getValues seluruh rentang   5.659 ms   <- dipakai
  //   getFormulas seluruh rentang 5.481 ms   <- dipakai
  //   getFormulas 300 baris         165 ms   <- 33x lebih murah
  //   getValues per kolom        125.251 ms  <- 39 panggilan, JANGAN dipakai
  //   panggilan ulang ke-2 SAMA mahalnya     -> Google tidak meng-cache
  // Dari 174.921 sel berumus, 93% berada di 8 kolom yang bernilai konstan sepanjang
  // baris (AF=I, AG=I/M, AH=Y/M, AI=Y/I, AJ=LEFT(E,3), AK=D, AL=B, AM=C).
  // Jadi cukup dibaca APA adanya dari sampel; yang perlu diperiksa penuh hanya kolom A
  // (text(B,"MMM")) dan AC (Biaya Total, 14.217 rumus = 8% sel).
  // b11: penanda baris yang datanya TIDAK LENGKAP di memori. Wajib dideklarasikan di awal
  // (var bersifat hoisted; kalau diletakkan setelah pemakaian nilainya undefined).
  var barisSintetis = {};   // dibuat hanya untuk menampung sel error di luar sampel
  var barisParsial = {};    // hanya berisi Wilayah+Lokasi (hasil baca duaKolom), kolom lain tak diketahui
  // b11: penanda rumus per kolom. Wajib ada sebelum profil kolom & sebelum pindaiDalam_.
  var posisiRumus_ = {};
  var daftarRumus = {};

  var SAMPEL = Math.min(CFG.SAMPEL_BARIS || 300, Math.max(2, lastRow - 1));
  var blokAkhir = Math.min(SAMPEL, lastRow - SAMPEL);

  // Header dibaca bersama sampel (1 panggilan). nRow = lastRow: nomor baris sheet tetap akurat.
  var _t = Date.now();
  var sampelAwal = sh.getRange(1, 1, SAMPEL, lastCol).getValues();
  out.waktu.sampelAwal = Date.now() - _t; _t = Date.now();
  var headers = sampelAwal[0].map(function (v) { return String(v == null ? '' : v).trim(); });
  var nCol = headers.length, nRow = lastRow;
  for (var pc = 0; pc < nCol; pc++) { posisiRumus_[pc] = 0; daftarRumus[pc] = []; }

  // Blok terakhir: menangkap data yang baru diisi di bawah (baris baru = tempat error paling sering)
  var sampelAkhir = blokAkhir > 0 ? sh.getRange(lastRow - blokAkhir + 1, 1, blokAkhir, nCol).getValues() : [];
  out.waktu.sampelAkhir = Date.now() - _t; _t = Date.now();

  // Pola rumus: hanya sampel (165 ms vs 5.481 ms untuk seluruh sheet)
  var rumusSampel = sh.getRange(1, 1, SAMPEL, nCol).getFormulas();
  out.waktu.rumusSampel = Date.now() - _t; _t = Date.now();

  // Nilai & rumus per indeks baris (0 = header). Baris di luar sampel tidak dimasukkan ->
  // loop akan melewatinya lewat adaData[] = false.
  var values = new Array(nRow), formulas = new Array(nRow);
  for (var iz = 0; iz < nRow; iz++) { values[iz] = null; formulas[iz] = null; }
  var b;
  for (b = 0; b < sampelAwal.length; b++) { values[b] = sampelAwal[b]; formulas[b] = rumusSampel[b] || null; }
  for (b = 0; b < sampelAkhir.length; b++) {
    var idxA = lastRow - blokAkhir + b;
    values[idxA] = sampelAkhir[b];
    formulas[idxA] = null;   // pola rumus di blok akhir tidak diperlukan; dicek lewat pindaiGalat
  }

  /* --- 1. Riwayat Lokasi -> Wilayah (untuk aturan [4]) --- */
  // b11: kolom pembanding untuk aturan "rumus kosong padahal pembandingnya ada"
  var cWil = -1, cLok = -1, cJenis = -1;
  var cEngine = -1, cOper = -1, cSolarL = -1, cLuas = -1, cDate = -1, cBulan = -1;
  for (var h = 0; h < nCol; h++) {
    var hd = String(headers[h] || '');
    if (cWil < 0 && /^wilayah$/i.test(hd)) cWil = h;
    if (cLok < 0 && /^lokasi$/i.test(hd)) cLok = h;
    if (cJenis < 0 && /^(jenis engine|kode engine)$/i.test(hd)) cJenis = cJenis < 0 ? h : cJenis;
    if (cEngine < 0 && /^engine$/i.test(hd)) cEngine = h;
    if (cOper < 0 && /^operating\s*time/i.test(hd)) cOper = h;
    if (cSolarL < 0 && /^solar\s*terpakai/i.test(hd)) cSolarL = h;
    if (cLuas < 0 && /^luas\s*siram/i.test(hd)) cLuas = h;
    if (cDate < 0 && /^date$/i.test(hd)) cDate = h;
    if (cBulan < 0 && /^(r\s*bulan|bulan)$/i.test(hd)) cBulan = h;
  }
  var lokasiToWil = {}, lokasiBentrok = {};
  if (cWil >= 0 && cLok >= 0) {
    // b6: cukup 2 kolom (Wilayah, Lokasi) untuk SELURUH baris -> jauh lebih murah dari
    // membaca 39 kolom penuh. Nilainya disimpan ke values[] agar aturan [4] tetap bekerja.
    var dasar2 = Math.min(cWil, cLok);
    var duaKol = sh.getRange(2, dasar2 + 1, lastRow - 1, Math.abs(cWil - cLok) + 1).getValues();
    out.waktu.duaKolom = Date.now() - _t; _t = Date.now();
    for (var rw2 = 1; rw2 < nRow; rw2++) {
      var barisDua = duaKol[rw2 - 1];
      if (!barisDua) continue;
      // b11: tandai baris yang di sini hanya diisi Wilayah+Lokasi. Nilai kolom LAIN pada
      // baris tersebut tidak ada di memori (undefined), BUKAN kosong di sheet. Tanpa tanda
      // ini, setiap kolom lain terbaca "kosong" -> ribuan item palsu.
      if (!values[rw2]) { values[rw2] = []; barisParsial[rw2] = true; }
      values[rw2][cWil] = barisDua[cWil - dasar2];
      values[rw2][cLok] = barisDua[cLok - dasar2];
    }
  }
  if (cWil >= 0 && cLok >= 0) {
    for (var rp = 1; rp < nRow; rp++) {
      if (!values[rp]) continue;
      var lv = teks_(values[rp][cLok]);
      var wv = teks_(values[rp][cWil]);
      if (!lv || !wv) continue;
      if (lokasiToWil[lv] === undefined) lokasiToWil[lv] = wv;
      else if (lokasiToWil[lv] !== wv) lokasiBentrok[lv] = true;
    }
  }

  /* --- 2. Profil kolom: numerik? kolom rumus? letak rumus pertama? --- */
  var isNum = new Array(nCol), isFormulaCol = new Array(nCol);
  var firstF = new Array(nCol);
  var barisBerdata = 0;
  // v1.23.2 (performa): status "baris ada data" dihitung SEKALI.
  // Dulu barisAdaData_() dipanggil di dalam loop kolom x baris = 39 x 17.856 = 696.384
  // panggilan, masing-masing memindai 39 sel -> ~27 juta operasi per preview/apply.
  var adaData = new Array(nRow);
  for (var r0 = 1; r0 < nRow; r0++) {
    var ad = barisAdaData_(values[r0]);
    adaData[r0] = ad;
    if (ad) barisBerdata++;
  }

  var rules = aturanTurunan_(headers);

  // ===== b6a: lewati kolom yang tidak punya urusan sama sekali =====
  // Pengukuran b6 (Index Solar 151 baris x 39 kolom) menunjukkan loop memindai 5.889 sel
  // kosong tanpa hasil. Kolom yang di sampel tidak punya rumus DAN tidak punya nilai DAN
  // bukan kolom di luar sampel (Wilayah/Lokasi) tidak mungkin menghasilkan item.
  var kolomPenting = {};

  // ===== b6: sel error DI LUAR blok sampel =====
  // Tanpa ini, sel error pada baris 301..17.557 akan terlewat. Dipindai per kolom berblok
  // 2.000 sel: hanya kolom yang mungkin bermasalah (kolom rumus + kolom yang punya aturan
  // turunan + kolom Wilayah) supaya tetap murah.
  /* --- 2. Profil kolom: numerik? kolom rumus? letak rumus pertama? --- */
  var isNum = new Array(nCol), isFormulaCol = new Array(nCol);
  var firstF = new Array(nCol);
  var barisBerdata = 0;
  // v1.23.2 (performa): status "baris ada data" dihitung SEKALI.
  // Dulu barisAdaData_() dipanggil di dalam loop kolom x baris = 39 x 17.856 = 696.384
  // panggilan, masing-masing memindai 39 sel -> ~27 juta operasi per preview/apply.
  var adaData = new Array(nRow);
  for (var r0 = 1; r0 < nRow; r0++) {
    var ad = barisAdaData_(values[r0]);
    adaData[r0] = ad;
    if (ad) barisBerdata++;
  }

  var rules = aturanTurunan_(headers);

  // ===== b6a: lewati kolom yang tidak punya urusan sama sekali =====
  // Pengukuran b6 (Index Solar 151 baris x 39 kolom) menunjukkan loop memindai 5.889 sel
  // kosong tanpa hasil. Kolom yang di sampel tidak punya rumus DAN tidak punya nilai DAN
  // bukan kolom di luar sampel (Wilayah/Lokasi) tidak mungkin menghasilkan item.
  var kolomPenting = {};

  // ===== b6: sel error DI LUAR blok sampel =====
  // Tanpa ini, sel error pada baris 301..17.557 akan terlewat. Dipindai per kolom berblok
  // 2.000 sel: hanya kolom yang mungkin bermasalah (kolom rumus + kolom yang punya aturan
  // turunan + kolom Wilayah) supaya tetap murah.
  var kolomPindai = [];   // dibangun setelah profil kolom (lihat di bawah)
  // Kolom penting = punya rumus di sampel, atau punya nilai di sampel, atau target aturan,
  // atau kolom Wilayah/Lokasi (yang datanya dibaca di luar sampel).
  for (var kp2 = 0; kp2 < nCol; kp2++) {
    var punyaRumus = false, punyaNilai = false;
    for (var rr = 1; rr < Math.min(sampelAwal.length, nRow); rr++) {
      var fr = formulas[rr], vr = values[rr];
      if (fr && fr[kp2] !== '' && fr[kp2] != null) { punyaRumus = true; break; }
      if (vr && vr[kp2] !== '' && vr[kp2] != null) { punyaNilai = true; }
    }
    var targetAturan = false;
    for (var ka = 0; ka < rules.length; ka++) if (rules[ka].target === kp2) { targetAturan = true; break; }
    var luarSampel = (kp2 === cWil || kp2 === cLok);
    kolomPenting[kp2] = punyaRumus || punyaNilai || targetAturan || luarSampel;
  }

  // Sisipkan sebagai baris semu: nilai error ditaruh di values[] agar loop memperlakukannya
  // sama seperti error yang ditemukan di sampel, tetapi TIDAK dihitung sebagai "baris berdata"
  // (adaData tetap dari sampel) -- item tetap dibuat karena nilainya error.
  // Sel error di luar sampel disimpan PALING AKHIR ke values[] -- setelah profil kolom
  // dihitung -- supaya jenis kolom (numerik/teks) ditentukan oleh data normal, bukan
  // oleh nilai error. Penandaan barisnya dilakukan pada variabel terpisah.
  var galatLuarIdx = {};   // "barisIdx|kolom" -> teks error (diisi setelah pemindaian)
  var galatLuar = {}, kosongLuar = {};
  for (var gk in galatLuar) {
    if (!galatLuar.hasOwnProperty(gk)) continue;
    var pisah = gk.split('|');
    // b11: pindaiDalam_ mengembalikan NOMOR BARIS SHEET (1-based, baris 2 = data pertama).
    // Indeks array = nomorBaris - 1. Tanpa konversi ini, nilai disisipkan satu baris terlalu
    // jauh sehingga seluruh kolom di luar sampel tampak kosong (17.749 item palsu).
    var barisSheet = parseInt(pisah[1], 10);
    var kc = colToNum_(pisah[0]) - 1;
    var hr = barisSheet - 1;
    if (hr < 1 || hr >= nRow) continue;
    galatLuarIdx[hr + '|' + kc] = galatLuar[gk];
  }


  for (var c = 0; c < nCol; c++) {
    var numTotal = 0, terisi = 0, ff = -1, cf = 0;
    for (var r = 1; r < nRow; r++) {
      // b6: values[]/formulas[] hanya terisi pada blok sampel; selebihnya null.
      var fR = formulas[r], vR = values[r];
      if (fR && fR[c] !== '' && fR[c] !== undefined && fR[c] !== null) {
        if (ff < 0) ff = r;
        cf++;
        continue;
      }
      if (!vR) continue;
      var v = vR[c];
      if (v === '' || v === null || v === undefined) continue;
      terisi++;
      if (typeof v === 'number') numTotal++;
    }
    // b6: profil kolom hanya dari blok sampel. Karena values[] di luar sampel null,
    // terisi/numTotal di sini memang hanya menghitung sampel -- kecuali baris yang
    // disisipi sel error. Karena itu isNum ditentukan HANYA bila ada data sampel.
    // BUG LAMA yang diperbaiki di b6: dulu `cf > 0 ? true` membuat SETIAP kolom yang
    // seluruhnya berisi rumus dianggap kolom ANGKA -- termasuk kolom teks seperti
    // Lokasi (AK=D), Wilayah (AM=C), R Bulan (A), Jenis Irigator (AJ), Total Time (AF),
    // Ha/Hari (AG), Ha/Jam (AH), Solar Ltr/jam (AI). Akibatnya nomor rumah seperti
    // "148C" berubah menjadi... tidak (cobaAngka_ menolak), tetapi nilai yang kebetulan
    // mirip angka bisa ditulis ulang sebagai angka. Jenis kolom sekarang ditentukan dari
    // NILAI hasil rumus pada sampel, bukan dari keberadaan rumus.
    isNum[c] = terisi > 0 ? (numTotal / terisi) >= 0.6 : false;
    firstF[c] = ff;
    // b11: BUG LAMA. `cf` dihitung dari SELURUH nRow, tetapi formulas[] hanya terisi pada
    // blok sampel, jadi cf maksimum = SAMPEL (300). Sementara ambangRumus =
    // max(FORMULA_MIN, floor(barisBerdata * FORMULA_RATIO)) memakai jumlah baris SELURUH
    // sheet. Untuk sheet 18.348 baris ambangnya 9.174 -- mustahil dicapai 300 baris,
    // sehingga SETIAP kolom rumus dianggap bukan kolom rumus dan tidak pernah dipindai.
    // Perbandingan yang benar memakai porsi terhadap baris yang benar-benar di sampel.
    var dalamSampel = Math.min(SAMPEL, nRow - 1) + blokAkhir;
    var ambangSampel = Math.max(CFG.FORMULA_MIN, Math.floor(dalamSampel * CFG.FORMULA_RATIO));
    isFormulaCol[c] = cf >= CFG.FORMULA_MIN && (cf >= ambangSampel || posisiRumus_[c] > 0);
    // Kolom yang mayoritas berisi angka dan hanya punya 1-2 rumus TIDAK dianggap kolom
    // rumus: itu kolom nilai (mis. Total Time = I) yang sesekali ditimpa rumus.
  }

  // b11: kolomPindai dibangun SETELAH profil kolom. Dulu dibangun sebelum isFormulaCol
  // dihitung, sehingga isFormulaCol[cc] masih undefined dan kolom rumus tidak pernah ikut
  // dipindai -- inilah sebab 4 sel di baris 15.083 tidak pernah terdeteksi.
  (function () {
    var tandai = {};
    for (var kk = 0; kk < rules.length; kk++) tandai[rules[kk].target] = true;
    if (cWil >= 0) tandai[cWil] = true;
    // b11: kolom pembanding ikut dipindai supaya nilainya tersedia untuk
    // aturan "rumus kosong padahal pembandingnya terisi" di luar blok sampel.
    var pembanding = [cEngine, cOper, cSolarL, cLuas, cDate];
    for (var pj = 0; pj < pembanding.length; pj++) if (pembanding[pj] >= 0) tandai[pembanding[pj]] = true;
    for (var cc = 0; cc < nCol; cc++) if (isFormulaCol[cc] || posisiRumus_[cc] || tandai[cc]) kolomPindai.push(cc);
  })();

  // b11: pemindaian menyeluruh dijalankan di sini -- SETELAH kolomPindai terbentuk dan
  // SEBELUM loop membaca nilai. Satu-satunya pemanggilan pindaiDalam_.
  var _tp = Date.now();
  var hasilPindai = pindaiDalam_(sh, nRow, nCol, kolomPindai, posisiRumus_, daftarRumus);
  galatLuar = hasilPindai.err;
  kosongLuar = hasilPindai.kosong;
  out.waktu.pindaiGalat = Date.now() - _tp; _t = Date.now();
  for (var gk9 in galatLuar) {
    if (!galatLuar.hasOwnProperty(gk9)) continue;
    var ps9 = gk9.split('|');
    var bs9 = parseInt(ps9[1], 10), kk9 = colToNum_(ps9[0]) - 1;
    var hi9 = bs9 - 1;                       // nomor baris sheet -> indeks array
    if (hi9 < 1 || hi9 >= nRow) continue;
    galatLuarIdx[hi9 + '|' + kk9] = galatLuar[gk9];
  }


  // Nilai yang sudah dihitung pada pemindaian ini, agar kolom turunan berantai
  // (mis. Rp/Ha butuh Biaya Total yang juga kosong) tetap bisa dipastikan.
  var computed = {};

  /* --- 2b. Sisipkan sel error di luar sampel (setelah profil kolom dihitung) --- */
  var adaGalatLuar = false;
  for (var gk2 in galatLuarIdx) {
    if (!galatLuarIdx.hasOwnProperty(gk2)) continue;
    var pg = gk2.split('|');
    var hg = parseInt(pg[0], 10), kg = parseInt(pg[1], 10);
    if (!values[hg]) { values[hg] = []; barisSintetis[hg] = {}; }
    if (!formulas[hg]) formulas[hg] = [];
    if (barisSintetis[hg]) barisSintetis[hg][kg] = true;
    values[hg][kg] = galatLuarIdx[gk2];
    formulas[hg][kg] = '';        // bukan sel rumus -> akan masuk aturan error/nilai
    adaData[hg] = true;
    adaGalatLuar = true;
  }

  out.waktu.persiapan = Date.now() - T0 - (out.waktu.sampelAwal || 0) - (out.waktu.sampelAkhir || 0)
    - (out.waktu.rumusSampel || 0) - (out.waktu.duaKolom || 0) - (out.waktu.pindaiGalat || 0);
  var Tloop = Date.now();

  /* --- 3. Pemindaian sel --- */
  var kolomDilewati = 0;
  for (var col = 0; col < nCol; col++) {
    if (!kolomPenting[col]) { kolomDilewati++; continue; }
    var header = headers[col] || colLetter_(col + 1);
    var huruf = colLetter_(col + 1);
    var acuanTerakhir = -1;
    var ruleCol = null;
    for (var k = 0; k < rules.length; k++) if (rules[k].target === col) ruleCol = rules[k];

    for (var row = 1; row < nRow; row++) {
      var fRow = formulas[row];
      if (fRow && fRow[col] !== '' && fRow[col] !== undefined && fRow[col] !== null) { acuanTerakhir = row; continue; }
      if (!adaData[row]) continue;

      var vRow = values[row];
      // b11: baris sintetis (dibuat untuk sel error di luar sampel) hanya berisi SATU kolom.
      // Tanpa penjagaan ini, semua kolom lain pada baris itu terbaca undefined -> dianggap
      // kosong -> ribuan item palsu (pernah terjadi: 17.749 item).
      var bsint = barisSintetis[row];
      if (bsint && !bsint[col]) continue;
      // b11: baris parsial hanya memuat Wilayah & Lokasi di memori. Kolom lain nilainya
      // TIDAK DIKETAHUI (bukan kosong) -> jangan dinilai sama sekali.
      if (barisParsial[row] && col !== cWil && col !== cLok) continue;
      var nilai = vRow ? vRow[col] : '';
      var kosong = (nilai === '' || nilai === null || nilai === undefined);
      var teks = kosong ? '' : teks_(nilai);
      var error = !kosong && (teks.charAt(0) === '#' || /^NaN$/i.test(teks));

      // Lewati cepat sel yang sudah normal (angka / teks biasa pada kolom non-numerik).
      if (!kosong && !error && !(typeof nilai === 'string' && isNum[col] && perluAngka_(teks))) continue;

      var kunci = sheetName + '!' + huruf + (row + 1);
      if (only && !only[kunci]) continue;

      /* baris acuan rumus terdekat */
      var tpl = -1, rumusTpl = '';
      if (isFormulaCol[col]) {
        tpl = acuanTerakhir >= 0 ? acuanTerakhir : firstF[col];
        if (tpl >= 0 && Math.abs(tpl - row) > CFG.TEMPLATE_LOOKUP && !CFG.PREFER_FORMULA_FAR) tpl = -1;
        if (tpl === row) tpl = firstF[col] === row ? -1 : firstF[col];
        if (tpl >= 0 && formulas[tpl]) rumusTpl = formulas[tpl][col] || '';
      }
      // b11: kolom yang seluruh baris sampelnya kosong tidak pernah punya tpl.
      // Pakai pola rumus dari baris lain (hasil pindaiDalam_) sebagai acuan.
      if (!rumusTpl && daftarRumus[col] && daftarRumus[col].length) {
        var pola = polaTerdekat_(daftarRumus[col], row + 1);
        if (pola && (pola.r - 1) !== row) { rumusTpl = pola.f; tpl = pola.r - 1; }
      }

      /* [1] & [2] kolom rumus -> tulis ulang rumus, SETELAH prasyarat diperiksa (b8) */
      if ((kosong || error) && tpl >= 0 && rumusTpl) {
        // b9: prasyarat dibaca LANGSUNG dari sel acuan di sheet, bukan dari sampel di memori.
        // b8 membaca dari salinan sampel; di mock sampelnya lengkap sehingga lolos uji,
        // tetapi di produksi salinan itu tidak memuat baris tujuan -> K152 kosong DILOLOSKAN.
        var prasyarat = periksaPrasyarat_(rumusTpl, row, col, sh, row - tpl);
        if (!prasyarat.ok) {
          // JANGAN tawarkan perbaikan. Rumus akan menghasilkan angka yang terlihat sah
          // padahal acuannya kosong -> masalah jadi tersembunyi.
          var daftar = [], ringkas = [];
          for (var pk = 0; pk < prasyarat.kosong.length; pk++) {
            ringkas.push(prasyarat.kosong[pk].kolom + prasyarat.kosong[pk].baris);
            daftar.push(prasyarat.kosong[pk].kolom + prasyarat.kosong[pk].baris + ' masih kosong');
          }
          if (prasyarat.takTerbaca.length) {
            ringkas.push(prasyarat.takTerbaca.join(', '));
            daftar.push(prasyarat.takTerbaca.join(', ') + ' gagal dibaca');
          }
          if (prasyarat.bukanAngka.length) {
            for (var pn = 0; pn < prasyarat.bukanAngka.length; pn++) {
              var ba = prasyarat.bukanAngka[pn];
              ringkas.push(ba.kolom + ba.baris);
              daftar.push(ba.kolom + ba.baris + ' berisi teks "' + ba.nilai + '" padahal harus angka');
            }
          }
          out.skipped.push(lewat_(sheetName, row, col, header, huruf, teks,
            'PRASYARAT TIDAK SIAP: ' + daftar.join('; ') + '. Rumus pola baris ' +
            (tpl + 1) + ' membutuhkannya, jadi rumus tidak bisa dipasang sekarang. Bila tetap dipasang, hasilnya angka yang terlihat sah ' +
            'tetapi tidak berdasar dan masalahnya justru tersembunyi: sel kosong dianggap 0, dan bila isinya teks ' +
            'rumusnya error lalu ditelan iferror menjadi sel kosong lagi. ' +
            'Lengkapi dulu ' + ringkas.join(', ') + ' dengan angka yang benar.'));
          continue;
        }
        out.items.push(item_(sheetName, row, col, header, huruf,
          error ? 'error' : 'rumus', teks, '', 'formula',
          rumusPratinjau_(rumusTpl, row - tpl),
          'Acuan: rumus baris ' + (tpl + 1) + '. Prasyarat terisi: ' + jejakTeks_(prasyarat) + '.',
          (error ? 'Sel error' : 'Sel kosong pada kolom rumus') +
          '. Ditulis ulang memakai pola rumus baris ' + (tpl + 1) + '.',
          tpl + 1));
        continue;
      }

      /* [3] kolom turunan -> nilai yang sudah pasti */
      if ((kosong || error) && ruleCol) {
        var hit = hitungTurunan_(ruleCol, values, row, cJenis, computed);
        if (hit) {
          computed[col + '|' + row] = hit.nilai;
          out.items.push(item_(sheetName, row, col, header, huruf,
            error ? 'error' : 'nilai', teks, hit.nilai, 'value', '', '',
            hit.alasan, 0));
          continue;
        }
      }

      if (error) {
        out.skipped.push(lewat_(sheetName, row, col, header, huruf, teks,
          'Sel error tanpa rumus acuan maupun nilai yang bisa dipastikan — periksa manual.'));
        continue;
      }

      /* [4] Wilayah kosong dari riwayat lokasi */
      if (kosong) {
        // v1.23.2: syarat cWil >= 0 wajib. Tanpa ini cWil = -1 (kolom Wilayah tidak ada)
        // bisa "cocok" dengan indeks kolom -1 dan sel kosong di kolom lain dilaporkan
        // sebagai isu wilayah.
        if (cWil >= 0 && col === cWil && cLok >= 0) {
          var lok = teks_(values[row][cLok]);
          if (lok && lokasiToWil[lok] && !lokasiBentrok[lok]) {
            out.items.push(item_(sheetName, row, col, header, huruf, 'wilayah', '', lokasiToWil[lok],
              'value', '', '',
              'Lokasi "' + lok + '" selalu tercatat pada wilayah ' + lokasiToWil[lok] + ' menurut riwayat sheet.', 0));
          } else {
            out.skipped.push(lewat_(sheetName, row, col, header, huruf, '',
              lok
                ? (lokasiBentrok[lok]
                  ? 'Lokasi "' + lok + '" pernah tercatat di lebih dari satu wilayah — sengaja tidak ditebak.'
                  : 'Lokasi "' + lok + '" belum punya riwayat wilayah.')
                : 'Lokasi pada baris ini juga kosong — tidak bisa diturunkan.'));
          }
        }
        continue;
      }

      /* [5] teks angka pada kolom numerik */
      if (typeof nilai === 'string' && isNum[col]) {
        var nAngka = cobaAngka_(teks);
        if (nAngka !== null) {
          out.items.push(item_(sheetName, row, col, header, huruf, 'format', teks, nAngka,
            'value', '', '', 'Teks angka pada kolom numerik dijadikan angka murni.', 0));
        }
      }
    }
  }

  /* --- 3b. b11: rumus yang kosong padahal seharusnya terisi --- */
  // Sel kosong TIDAK disisipkan ke values[] seperti error. Error aman karena teks "#REF!"
  // bukan nilai sah, tetapi sel kosong yang disisipkan akan membuat baris di luar sampel
  // tampak "ada data" lalu seluruh kolom dinilai kosong (17.749 item palsu). Jadi sel
  // kosong diproses di sini secara terpisah, memakai pola rumus dari pindaiDalam_.
  var diusulkan = {};
  var cacheBaris = {};   // barisIdx -> nilai SATU BARIS PENUH dibaca dari sheet
  for (var ki in kosongLuar) {
    if (!kosongLuar.hasOwnProperty(ki)) continue;
    var pp = ki.split('|');
    var barisSheetK = parseInt(pp[1], 10);
    var kolK = colToNum_(pp[0]) - 1;
    if (!(kolK >= 0) || kolK >= nCol) continue;
    if (barisSheetK < 2 || barisSheetK > nRow) continue;
    if (!kolomPenting[kolK]) continue;                  // kolom yang sengaja dilewati
    var kunciK = sheetName + '!' + pp[0] + barisSheetK;
    if (only && !only[kunciK]) continue;
    if (diusulkan[kunciK]) continue;

    // Kolom harus benar-benar berumus (ada rumus di mana pun).
    if (!posisiRumus_[kolK] && !isFormulaCol[kolK]) continue;
    var polaK = (daftarRumus[kolK] && daftarRumus[kolK].length) ? polaTerdekat_(daftarRumus[kolK], barisSheetK) : null;
    if (!polaK) continue;

    // Aturan: hanya usulkan bila pembandingnya sudah terisi. Tanpa ini, rumus hanya akan
    // menghasilkan kosong lagi (mis. Operating = 0 -> #DIV/0! -> ditelan iferror).
    var rowIdx = barisSheetK - 1;
    // b11: values[rowIdx] untuk baris di luar sampel hanya memuat Wilayah+Lokasi (hasil
    // baca duaKolom). Memakainya membuat SEMUA kolom lain terbaca kosong. Jadi baris ini
    // dibaca utuh dari sheet, sekali per baris (di-cache).
    if (!cacheBaris[rowIdx]) {
      try {
        cacheBaris[rowIdx] = sh.getRange(barisSheetK, 1, 1, nCol).getValues()[0] || [];
      } catch (e) { cacheBaris[rowIdx] = []; }
    }
    var vBaris = cacheBaris[rowIdx];
    if (!vBaris || !vBaris.length) continue;
    var bukti = pembandingRumus_(polaK.f, barisSheetK, vBaris, { engine: cEngine, oper: cOper, solar: cSolarL, luas: cLuas, date: cDate });
    if (!bukti.ok) {
      out.skipped.push(lewat_(sheetName, rowIdx, kolK, headers[kolK] || pp[0], pp[0], '',
        bukti.alasan));
      continue;
    }

    var rumusK = rumusPratinjau_(polaK.f, barisSheetK - polaK.r);
    diusulkan[kunciK] = true;
    out.items.push(item_(sheetName, rowIdx, kolK, headers[kolK] || pp[0], pp[0],
      'rumus', '', '', 'formula', rumusK,
      'Pola: rumus baris ' + polaK.r + '. ' + bukti.catatan,
      'Sel kosong pada kolom rumus. Ditulis ulang memakai pola rumus di kolom yang sama.',
      polaK.r));
  }

  out.waktu.loop = Date.now() - Tloop;
  out.waktu.total = Date.now() - T0;
  out.waktu.kolomDilewati = kolomDilewati;
  out.waktu.kolomDipindai = nCol - kolomDilewati;
  return out;
}

/** Aturan kolom turunan — hanya kolom yang nilainya benar-benar bisa dipastikan. */
function aturanTurunan_(headers) {
  var rules = [];
  function cari(re) {
    for (var i = 0; i < headers.length; i++) if (re.test(headers[i])) return i;
    return -1;
  }
  var bSolar = cari(/^biaya\s*solar/i);
  var bUpah = cari(/^biaya\s*upah/i);
  var bAlat = cari(/^biaya\s*alat/i);
  var bTotal = cari(/^biaya\s*total/i);
  var luas = cari(/^luas\s*siram/i);
  var prep = cari(/^prepare/i);
  var oper = cari(/^operating/i);
  var rpHa = cari(/^rp\s*\/?\s*ha$/i);
  var totOper = cari(/^tot[.,\s]*oper/i);

  if (bTotal >= 0 && bSolar >= 0 && bUpah >= 0 && bAlat >= 0) {
    rules.push({ target: bTotal, kind: 'sum', deps: [bSolar, bUpah, bAlat], label: 'Biaya Solar + Biaya Upah + Biaya Alat' });
  }
  if (rpHa >= 0 && bTotal >= 0 && luas >= 0) {
    rules.push({ target: rpHa, kind: 'div', deps: [bTotal, luas], label: 'Biaya Total / Luas Siram' });
  }
  // "Tot, Oper, Time" / "Tot. Oper. Time" SENGAJA tidak masuk aturan turunan.
  // Audit 17.660 baris (v1.23.2): kolom ini bukan rumus, diisi manual, dan pada 675 baris
  // nilainya memang lebih kecil dari Prepare+Operating (waktu terpakai vs waktu terjadwal).
  // Menimpanya akan merusak data, jadi hanya dilaporkan sebagai temuan untuk PIC.
  void prep; void oper;
  // Index Solar: Deviasi L/jam = (Pemakaian Solar / Jam Operasi) - Kalibrasi
  var solar = cari(/^pemakaian\s*solar/i);
  var jam = cari(/^jam\s*oper/i);
  var kal = cari(/^kalibrasi$/i);
  var dev = cari(/^deviasi/i);
  if (dev >= 0 && solar >= 0 && jam >= 0 && kal >= 0) {
    rules.push({ target: dev, kind: 'deviasi', deps: [solar, jam, kal], label: '(Solar / Jam Operasi) - Kalibrasi' });
  }
  void totOper;
  return rules;
}


/**
 * b8: PRASYARAT RUMUS.
 * Rumus tidak otomatis aman. Contoh nyata di sheet Index Solar baris 152:
 *   M152 = iferror(J152-K152)     dengan K152 (Kalibrasi) KOSONG
 * Google Sheets menganggap sel kosong = 0, sehingga M152 = 11 (bukan error).
 * Lalu L152 = if(M152>0;"Boros";"Hemat") -> "Boros", dan N152 -> "11 Liter".
 * Tiga nilai palsu yang terlihat sah, dan masalahnya jadi TERSEMBUNYIKAN.
 * Karena itu setiap rumus diperiksa dulu: kalau ada sel acuan yang kosong,
 * perbaikan TIDAK ditawarkan, melainkan dilaporkan sebagai "perlu dilengkapi".
 */

/** Ambil rujukan A1 ("J152", "$K$152") dari sebuah rumus, sebagai indeks 0-based. */
function rujukanRumus_(rumusA1) {
  var out = [];
  if (!rumusA1) return out;
  // Buang isi string literal dulu, supaya teks seperti "Boros"/"Liter" tidak dianggap sel.
  var t = String(rumusA1).replace(/"[^"]*"/g, '""');
  var re = /\$?([A-Z]{1,3})\$?(\d{1,7})/g, m;
  while ((m = re.exec(t)) !== null) {
    out.push({ baris: parseInt(m[2], 10) - 1, kolom: colToNum_(m[1]) - 1 });
  }
  return out;
}

/** Nomor kolom (1-based) -> huruf. */
function hurufKolom_(n) {
  var s = '';
  while (n > 0) { var r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

/** Ringkas jejak pembacaan untuk ditampilkan di catatan item. */
function jejakTeks_(prasyarat) {
  var j = prasyarat.jejak || [];
  var potong = [];
  for (var i = 0; i < j.length; i++) {
    var v = j[i].nilai === '' ? '(kosong)' : j[i].nilai;
    if (j[i].jenis === 'teks-salah') v = v + ' [TEKS, bukan angka]';
    else if (j[i].jenis === 'angka') v = v + ' [angka]';
    else if (j[i].jenis === 'kosong') v = '(kosong)';
    potong.push(j[i].sel + '=' + v);
  }
  return '(' + prasyarat.jumlah + ' sel) ' + potong.join(' | ');
}

/**
 * Periksa apakah semua sel acuan rumus terisi -- dengan MEMBACA SELNYA LANGSUNG.
 *
 * b8 membaca dari salinan sampel di memori (values[]/formulas[]). Itu salah: salinan itu
 * tidak selalu memuat baris tujuan (blok sampel awal/akhir, penggabungan blok kecil),
 * sehingga sel kosong bisa tampak terisi dan perbaikan berbahaya tetap ditawarkan.
 * b9 tidak memakai salinan apa pun: setiap alamat dibaca dari sheet.
 *
 * geserBaris WAJIB: rumus disalin dari baris template lalu digeser ke baris tujuan.
 *
 * Gagal membaca sel = TIDAK ditawarkan (fail-closed).
 */
function periksaPrasyarat_(rumusA1, barisRumus, kolomRumus, sh, geserBaris) {
  var delta = geserBaris || 0;
  var ruj = rujukanRumus_(rumusA1);
  var target = [], dilihat = {};
  for (var i = 0; i < ruj.length; i++) {
    var r = ruj[i].baris + delta, c = ruj[i].kolom;
    if (!(r >= 0) || !(c >= 0)) continue;
    if (r === barisRumus && c === kolomRumus) continue;      // rujukan ke diri sendiri
    if (r + 1 < 1 || c + 1 < 1) continue;
    var kunci = r + '|' + c;
    if (dilihat[kunci]) continue;
    dilihat[kunci] = true;
    target.push({ r: r, c: c, a1: hurufKolom_(c + 1) + (r + 1) });
  }

  // b10: sel yang terisi TEKS tidak selalu siap dipakai. Bila rumus memakai sel itu
  // sebagai angka (J152-K152), teks membuat Sheets menghasilkan error; iferror lalu
  // menelannya menjadi "" sehingga sel tetap kosong dan masalahnya TERSEMBUNYI.
  // Terjadi nyata: K152 berisi "Tidak Ada Kalibrasi." -> M152/N152 tampak "berhasil".
  var wajibAngka = rumusButuhAngka_(rumusA1);

  var kosong = [], takTerbaca = [], bukanAngka = [], jejak = [];
  for (var j = 0; j < target.length; j++) {
    var t = target[j], v = undefined, terbaca = false;
    try {
      var satu = sh.getRange(t.a1).getValues();
      if (satu && satu[0]) { v = satu[0][0]; terbaca = true; }
    } catch (e) { terbaca = false; }
    if (!terbaca) {
      jejak.push({ sel: t.a1, nilai: 'GAGAL DIBACA', jenis: 'gagal' });
      takTerbaca.push(t.a1);
      continue;
    }
    var hampa = (v === '' || v === null || v === undefined);
    var angkaOk = !hampa && bilanganKetat_(v);
    var perluAngka = wajibAngka && !teksBoleh_(rumusA1, t.a1);
    var jenis = hampa ? 'kosong' : (angkaOk ? 'angka' : 'teks');
    jejak.push({
      sel: t.a1,
      nilai: hampa ? '' : String(v),
      jenis: (perluAngka && !hampa && !angkaOk) ? 'teks-salah' : jenis
    });
    if (hampa) {
      kosong.push({ baris: t.r + 1, kolom: hurufKolom_(t.c + 1) });
    } else if (perluAngka && !angkaOk) {
      bukanAngka.push({ baris: t.r + 1, kolom: hurufKolom_(t.c + 1), nilai: String(v) });
    }
  }

  return {
    ok: kosong.length === 0 && takTerbaca.length === 0 && bukanAngka.length === 0,
    kosong: kosong,
    takTerbaca: takTerbaca,
    bukanAngka: bukanAngka,
    jumlah: target.length,
    jejak: jejak
  };
}

/** Apakah rumus ini memakai sel sebagai ANGKA (aritmetika / fungsi numerik)? */
function rumusButuhAngka_(rumusA1) {
  var t = String(rumusA1 || '').replace(/"[^"]*"/g, '""');   // buang teks literal
  if (/[+\-*\/^]/.test(t)) return true;
  return /\b(SUM|ROUND|ABS|MIN|MAX|AVERAGE|INT|FLOOR|CEILING|MOD|SQRT|POWER|PRODUCT)\s*\(/i.test(t);
}

/**
 * Apakah isi sel benar-benar sebuah BILANGAN?
 * angka_() memakai parseFloat yang memaafkan sampah di belakang ("11*" -> 11),
 * padahal Google Sheets memperlakukan "11*" sebagai TEKS dan rumusnya error.
 * Di sini seluruh isi harus berupa angka.
 */
function bilanganKetat_(v) {
  if (typeof v === 'number') return isFinite(v);
  if (v === null || v === undefined) return false;
  var s = String(v).trim();
  if (!s) return false;
  s = s.replace(/Rp/ig, '').replace(/\s/g, '').replace(/%$/, '');
  if (!/^-?[\d.,]+$/.test(s)) return false;      // hanya digit, titik, koma
  if (!/\d/.test(s)) return false;
  return isFinite(angka_(s));
}

/**
 * Apakah sel ini khusus dipakai sebagai TEKS (dirangkai dengan & atau masuk fungsi teks)?
 * Kalau ya, isinya boleh teks dan tidak perlu angka.
 */
function teksBoleh_(rumusA1, a1) {
  var t = String(rumusA1 || '').replace(/"[^"]*"/g, '""');
  var re = /\$?([A-Z]{1,3})\$?(\d{1,7})/g, m;
  var cari = String(a1).replace(/\$/g, '').toUpperCase();
  while ((m = re.exec(t)) !== null) {
    if (String(m[0]).replace(/\$/g, '').toUpperCase() !== cari) continue;
    var sblm = t.slice(0, m.index).replace(/\s+$/, '');
    var sdhd = t.slice(m.index + m[0].length).replace(/^\s+/, '');
    if (sblm.slice(-1) === '&' || sdhd.slice(0, 1) === '&') return true;   // dirangkai, bukan dihitung
  }
  return false;
}

function hitungTurunan_(rule, values, row, cJenis, computed) {
  // Angka sel; kalau sel itu justru sedang diperbaiki pada pemindaian ini,
  // pakai nilai hasil hitungnya agar kolom turunan berantai tetap pasti.
  function sel(c) {
    if (computed && computed[c + '|' + row] !== undefined) return computed[c + '|' + row];
    return angka_(values[row][c]);
  }

  var a = sel(rule.deps[0]);
  var b = sel(rule.deps[1]);
  var cc = rule.deps.length > 2 ? sel(rule.deps[2]) : 0;

  if (rule.kind === 'sum') {
    if (!isFinite(a) || !isFinite(b) || !isFinite(cc)) return null;
    if (!(a > 0 || b > 0 || cc > 0)) return null;
    return { nilai: bulat_(a + b + cc), alasan: 'Dihitung: ' + rule.label + '.' };
  }
  if (rule.kind === 'div') {
    if (!isFinite(a) || !isFinite(b) || !(a > 0) || !(b > 0)) return null;
    return { nilai: bulat_(a / b), alasan: 'Dihitung: ' + rule.label + '.' };
  }
  if (rule.kind === 'deviasi') {
    if (!isFinite(a) || !isFinite(b) || !isFinite(cc)) return null;
    if (!(b > 0) || !(cc > 0)) return null;
    if (cJenis >= 0 && /^SPE/i.test(teks_(values[row][cJenis]))) return null;  // mesin listrik: tidak ada solar
    return { nilai: bulat_((a / b) - cc), alasan: 'Dihitung: ' + rule.label + '.' };
  }
  return null;
}

function bulat_(n) { return Math.round(n * 1e6) / 1e6; }

/* ========================================================================== *
 * UTILITAS
 * ========================================================================== */

function item_(sheet, row0, col0, kolom, huruf, tipe, lama, baru, mode, rumus, catatan, alasan, templateBaris) {
  return {
    kunci: sheet + '!' + huruf + (row0 + 1),
    sheet: sheet,
    baris: row0 + 1,
    huruf: huruf,
    kolom: kolom || huruf,
    tipe: tipe,
    mode: mode,
    nilaiSekarang: String(lama === null || lama === undefined ? '' : lama),
    nilaiBaru: String(baru === null || baru === undefined ? '' : baru),
    rumus: rumus || '',
    catatan: catatan || '',
    alasan: alasan || '',
    template: templateBaris || 0
  };
}

function lewat_(sheet, row0, col0, kolom, huruf, nilai, alasan) {
  return {
    kunci: sheet + '!' + huruf + (row0 + 1),
    sheet: sheet, baris: row0 + 1, huruf: huruf, kolom: kolom || huruf,
    nilaiSekarang: String(nilai === null || nilai === undefined ? '' : nilai),
    alasan: alasan
  };
}

/** Geser referensi relatif rumus A1 (hanya untuk tampilan pratinjau). */
function rumusPratinjau_(formula, deltaBaris) {
  if (!formula) return '';
  if (!deltaBaris) return formula;
  return formula.replace(/(\$?)([A-Z]{1,3})(\$?)(\d{1,7})/g, function (m, cAbs, letter, rAbs, digits) {
    if (rAbs === '$') return m;
    return cAbs + letter + rAbs + String(parseInt(digits, 10) + deltaBaris);
  });
}

function barisAdaData_(arr) {
  var n = 0;
  for (var i = 0; i < arr.length; i++) {
    var v = arr[i];
    if (v !== '' && v !== null && v !== undefined) { n++; if (n >= 2) return true; }
  }
  return false;
}

function teks_(v) {
  if (v === null || v === undefined) return '';
  return String(v).trim();
}

/** Angka gaya id-ID: "2.500.000" -> 2500000 ; "2,5" -> 2.5 ; "21.08" -> 21.08 */
function angka_(v) {
  if (typeof v === 'number') return v;
  var s = teks_(v);
  if (!s || !/\d/.test(s)) return NaN;
  s = s.replace(/Rp/ig, '').replace(/\s/g, '').replace(/%$/, '');
  if (s.indexOf(',') >= 0) return parseFloat(s.replace(/\./g, '').replace(',', '.'));
  var titik = s.split('.');
  if (titik.length === 2 && titik[1].length <= 2) return parseFloat(s);
  return parseFloat(s.replace(/\./g, ''));
}

/** Sel teks angka yang layak dijadikan angka murni? */
function perluAngka_(teks) {
  if (!teks) return false;
  if (/^#{4,}$/.test(teks)) return true;                        // ########
  if (/^0\d/.test(teks)) return false;                          // kode berawalan nol, jangan diubah
  return cobaAngka_(teks) !== null;
}

/** Teks angka -> angka murni bila aman; null bila bukan angka sederhana. */
function cobaAngka_(teks) {
  if (!teks) return null;
  if (/^#{4,}$/.test(teks)) return null;
  var m = /^\-?\s*(Rp)?\s*([\d.,]+)\s*(l|lt|ltr|liter|ha|jam|kwh|%)?$/i.exec(teks);
  if (!m) return null;
  var body = m[2];
  if (!/\d/.test(body)) return null;
  var n;
  if (body.indexOf(',') >= 0) n = angka_(body);
  else if (/^\d{1,3}(\.\d{3})+$/.test(body)) n = angka_(body);
  else if (/^\-?\d+\.\d{1,2}$/.test(body)) n = parseFloat(body);
  else n = parseFloat(body.replace(/\./g, ''));
  if (!isFinite(n)) return null;
  return n;
}

function keysToSet_(keys) {
  if (!keys) return null;
  var arr = Array.isArray(keys) ? keys : String(keys).split('|');
  var set = {}, ada = false;
  arr.forEach(function (k) {
    k = String(k || '').trim();
    if (k) { set[k] = true; ada = true; }
  });
  return ada ? set : null;
}

function colLetter_(n) {
  var s = '';
  while (n > 0) {
    var r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function colToNum_(letter) {
  var s = String(letter).toUpperCase().replace(/[^A-Z]/g, '');
  var n = 0;
  for (var i = 0; i < s.length; i++) n = n * 26 + (s.charCodeAt(i) - 64);
  return n;
}

function ringkas_(items, skipped) {
  var perTipe = {}, perSheet = {};
  items.forEach(function (it) {
    perTipe[it.tipe] = (perTipe[it.tipe] || 0) + 1;
    perSheet[it.sheet] = (perSheet[it.sheet] || 0) + 1;
  });
  return { total: items.length, dilewati: skipped.length, perTipe: perTipe, perSheet: perSheet };
}

/** Catat setiap perubahan agar bisa diaudit. */
function tulisLog_(applied) {
  if (!applied || !applied.length) return;
  try {
    var ss = SpreadsheetApp.openById(CFG.SPREADSHEET_ID);
    var log = ss.getSheetByName(CFG.LOG_SHEET);
    if (!log) {
      log = ss.insertSheet(CFG.LOG_SHEET);
      log.getRange(1, 1, 1, 9).setValues([[
        'Waktu', 'Sheet', 'Sel', 'Kolom', 'Jenis', 'Nilai Lama', 'Nilai Baru', 'Rumus', 'Oleh'
      ]]);
      log.getRange(1, 1, 1, 9).setFontWeight('bold');
      log.setFrozenRows(1);
      try { log.hideSheet(); } catch (e) {}
    }
    var now = new Date();
    var rows = applied.map(function (it) {
      return [
        now, it.sheet, String(it.kunci).split('!')[1] || '', it.kolom, it.tipe,
        it.nilaiSekarang, it.nilaiBaru, it.hasil || it.rumus || '', userEmail_()
      ];
    });
    log.getRange(log.getLastRow() + 1, 1, rows.length, 9).setValues(rows);
  } catch (e) {
    // Log tidak boleh menggagalkan perbaikan.
  }
}
