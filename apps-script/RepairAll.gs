/**
 * PG2 Irrigation Dashboard — Layanan Perbaikan Spreadsheet  (v1.23.0)
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
  VERSION: '1.23.0',
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
  if (action === 'ping' || action === 'preview' || action === 'apply') {
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

/** Dipakai halaman HtmlService lewat google.script.run. */
function api(req) {
  return handle_(req || {});
}

function handle_(req) {
  var action = String(req.action || '').toLowerCase();
  try {
    if (action === 'ping') {
      return {
        ok: true, pong: true, version: CFG.VERSION,
        time: new Date().toISOString(),
        user: userEmail_(),
        sheets: CFG.SHEETS
      };
    }
    if (String(req.token || '') !== CFG.TOKEN) {
      return {
        ok: false,
        error: 'Token repair tidak cocok. Samakan REPAIR_TOKEN di app.js dengan CFG.TOKEN di Apps Script, lalu deploy ulang.'
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
  var name = '';
  try { name = SpreadsheetApp.openById(CFG.SPREADSHEET_ID).getName(); } catch (e) {}
  return {
    ok: true,
    action: 'preview',
    version: CFG.VERSION,
    spreadsheet: name || CFG.SPREADSHEET_ID,
    items: plan.items,
    skipped: plan.skipped,
    ringkasan: ringkas_(plan.items, plan.skipped),
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
  var ss = SpreadsheetApp.openById(CFG.SPREADSHEET_ID);
  var items = [], skipped = [];

  CFG.SHEETS.forEach(function (name) {
    var sh = ss.getSheetByName(name);
    if (!sh) {
      skipped.push({ kunci: '', sheet: name, alasan: 'Sheet "' + name + '" tidak ditemukan di spreadsheet.' });
      return;
    }
    var res = scanSheet_(sh, name, only);
    items = items.concat(res.items);
    skipped = skipped.concat(res.skipped);
  });

  items.sort(function (a, b) {
    if (a.sheet !== b.sheet) return a.sheet < b.sheet ? -1 : 1;
    if (a.baris !== b.baris) return a.baris - b.baris;
    return a.huruf < b.huruf ? -1 : 1;
  });
  return { items: items, skipped: skipped };
}

function scanSheet_(sh, sheetName, only) {
  var out = { items: [], skipped: [] };
  var lastRow = sh.getLastRow();
  var lastCol = sh.getLastColumn();
  if (lastRow < 2 || lastCol < 1) return out;

  var rng = sh.getRange(1, 1, lastRow, lastCol);
  var values = rng.getValues();
  var formulas = rng.getFormulas();
  var headers = values[0].map(function (v) { return String(v == null ? '' : v).trim(); });
  var nCol = headers.length, nRow = values.length;

  /* --- 1. Riwayat Lokasi -> Wilayah (untuk aturan [4]) --- */
  var cWil = -1, cLok = -1, cJenis = -1;
  for (var h = 0; h < nCol; h++) {
    if (cWil < 0 && /^wilayah$/i.test(headers[h])) cWil = h;
    if (cLok < 0 && /^lokasi$/i.test(headers[h])) cLok = h;
    if (cJenis < 0 && /^(jenis engine|kode engine)$/i.test(headers[h])) cJenis = cJenis < 0 ? h : cJenis;
  }
  var lokasiToWil = {}, lokasiBentrok = {};
  if (cWil >= 0 && cLok >= 0) {
    for (var rp = 1; rp < nRow; rp++) {
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
  var r0;
  for (r0 = 1; r0 < nRow; r0++) if (barisAdaData_(values[r0])) barisBerdata++;

  var ambangRumus = Math.max(CFG.FORMULA_MIN, Math.floor(barisBerdata * CFG.FORMULA_RATIO));

  for (var c = 0; c < nCol; c++) {
    var numTotal = 0, terisi = 0, ff = -1, cf = 0;
    for (var r = 1; r < nRow; r++) {
      if (formulas[r][c] !== '') {
        if (ff < 0) ff = r;
        cf++;
        continue;
      }
      var v = values[r][c];
      if (v === '' || v === null || v === undefined) continue;
      terisi++;
      if (typeof v === 'number') numTotal++;
    }
    isNum[c] = cf > 0 ? true : (terisi > 0 && (numTotal / terisi) >= 0.6);
    firstF[c] = ff;
    isFormulaCol[c] = cf >= CFG.FORMULA_MIN && cf >= Math.min(ambangRumus, barisBerdata);
  }

  var rules = aturanTurunan_(headers);
  // Nilai yang sudah dihitung pada pemindaian ini, agar kolom turunan berantai
  // (mis. Rp/Ha butuh Biaya Total yang juga kosong) tetap bisa dipastikan.
  var computed = {};

  /* --- 3. Pemindaian sel --- */
  for (var col = 0; col < nCol; col++) {
    var header = headers[col] || colLetter_(col + 1);
    var huruf = colLetter_(col + 1);
    var acuanTerakhir = -1;
    var ruleCol = null;
    for (var k = 0; k < rules.length; k++) if (rules[k].target === col) ruleCol = rules[k];

    for (var row = 1; row < nRow; row++) {
      if (formulas[row][col] !== '') { acuanTerakhir = row; continue; }
      if (!barisAdaData_(values[row])) continue;

      var nilai = values[row][col];
      var kosong = (nilai === '' || nilai === null || nilai === undefined);
      var teks = kosong ? '' : teks_(nilai);
      var error = !kosong && (teks.charAt(0) === '#' || /^NaN$/i.test(teks));

      // Lewati cepat sel yang sudah normal (angka / teks biasa pada kolom non-numerik).
      if (!kosong && !error && !(typeof nilai === 'string' && isNum[col] && perluAngka_(teks))) continue;

      var kunci = sheetName + '!' + huruf + (row + 1);
      if (only && !only[kunci]) continue;

      /* baris acuan rumus terdekat */
      var tpl = -1;
      if (isFormulaCol[col]) {
        tpl = acuanTerakhir >= 0 ? acuanTerakhir : firstF[col];
        if (tpl >= 0 && Math.abs(tpl - row) > CFG.TEMPLATE_LOOKUP && !CFG.PREFER_FORMULA_FAR) tpl = -1;
        if (tpl === row) tpl = firstF[col] === row ? -1 : firstF[col];
      }

      /* [1] & [2] kolom rumus -> tulis ulang rumus */
      if ((kosong || error) && tpl >= 0) {
        out.items.push(item_(sheetName, row, col, header, huruf,
          error ? 'error' : 'rumus', teks, '', 'formula',
          rumusPratinjau_(formulas[tpl][col], row - tpl),
          'Acuan: rumus baris ' + (tpl + 1) + '.',
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
        if (col === cWil && cLok >= 0) {
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

  if (bTotal >= 0 && bSolar >= 0 && bUpah >= 0 && bAlat >= 0) {
    rules.push({ target: bTotal, kind: 'sum', deps: [bSolar, bUpah, bAlat], label: 'Biaya Solar + Biaya Upah + Biaya Alat' });
  }
  if (rpHa >= 0 && bTotal >= 0 && luas >= 0) {
    rules.push({ target: rpHa, kind: 'div', deps: [bTotal, luas], label: 'Biaya Total / Luas Siram' });
  }
  // "Tot, Oper, Time" / "Tot. Oper. Time"
  for (var i = 0; i < headers.length; i++) {
    if (/^tot[.,\s]*oper/i.test(headers[i]) && prep >= 0 && oper >= 0) {
      rules.push({ target: i, kind: 'sum', deps: [prep, oper], label: 'Prepare Time + Operating Time' });
      break;
    }
  }
  // Index Solar: Deviasi L/jam = (Pemakaian Solar / Jam Operasi) - Kalibrasi
  var solar = cari(/^pemakaian\s*solar/i);
  var jam = cari(/^jam\s*oper/i);
  var kal = cari(/^kalibrasi$/i);
  var dev = cari(/^deviasi/i);
  if (dev >= 0 && solar >= 0 && jam >= 0 && kal >= 0) {
    rules.push({ target: dev, kind: 'deviasi', deps: [solar, jam, kal], label: '(Solar / Jam Operasi) - Kalibrasi' });
  }
  return rules;
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
