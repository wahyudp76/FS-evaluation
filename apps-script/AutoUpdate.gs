/**
 * AUTO-UPDATER RepairAll.gs  (v1.0)
 * ------------------------------------------------------------------
 * Pasang file ini SEBAGAI FILE KEDUA di proyek Apps Script yang sama
 * dengan RepairAll.gs, lalu jalankan fungsi `pasangRepairTerbaru` satu kali.
 *
 * Yang dilakukan:
 *   1. Mengunduh RepairAll.gs TERBARU dari repo GitHub.
 *   2. Menimpa file RepairAll.gs di proyek Apps Script ini lewat Apps Script API.
 *   3. Membuat VERSION baru (tanpa ini, deploy akan tetap memakai kode lama).
 *   4. Memperbarui deployment sehingga URL /exec yang ada menjalankan kode baru.
 *
 * Tidak ada spreadsheets yang ditulis. Hanya kode yang diperbarui.
 *
 * PRASYARAT (sekali saja):
 *   - Di editor Apps Script: Project Settings (ikon gerigi) -> aktifkan
 *     "Show appsscript.json manifest file in editor".
 *   - Buka appsscript.json, pastikan ada:
 *       "oauthScopes": [
 *         "https://www.googleapis.com/auth/script.projects",
 *         "https://www.googleapis.com/auth/script.deployments",
 *         "https://www.googleapis.com/auth/script.external_request",
 *         "https://www.googleapis.com/auth/spreadsheets"
 *       ]
 *   - Simpan, lalu jalankan `pasangRepairTerbaru`. Google akan meminta izin
 *     ("Aplikasi ini tidak diverifikasi" -> Advanced -> Go to project).
 */

var UPD = {
  REPO_RAW: 'https://raw.githubusercontent.com/wahyudp76/FS-evaluation/main/apps-script/RepairAll.gs',
  FILE_NAME: 'RepairAll.gs',
  SCRIPT_ID_OVERRIDE: ''   // opsional: isi Script ID bila proyek standalone
};

function pasangRepairTerbaru() {
  var scriptId = UPD.SCRIPT_ID_OVERRIDE || ScriptApp.getScriptId();
  var hasil = { ok: false, langkah: [] };
  function log(nama, nilai) { hasil.langkah.push(nama + ': ' + nilai); }

  // 1) unduh kode terbaru
  var kode;
  try {
    var r = UrlFetchApp.fetch(UPD.REPO_RAW + '?cb=' + Date.now(), { muteHttpExceptions: true });
    if (r.getResponseCode() !== 200) throw new Error('HTTP ' + r.getResponseCode());
    kode = r.getContentText();
    if (kode.indexOf('function handle_') < 0 || kode.length < 10000) throw new Error('isi file tidak masuk akal (' + kode.length + ' byte)');
    log('unduh', kode.length + ' byte');
  } catch (e) {
    hasil.error = 'Gagal mengunduh kode terbaru: ' + e.message;
    return hasil;
  }

  // 2) ambil daftar file proyek, cari RepairAll.gs
  var files;
  try {
    files = JSON.parse(UrlFetchApp.fetch('https://script.googleapis.com/v1/projects/' + scriptId + '/content',
      { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true }).getContentText());
  } catch (e) {
    hasil.error = 'Gagal membaca isi proyek: ' + e.message;
    return hasil;
  }
  if (!files.files) { hasil.error = 'Respons proyek tidak berisi daftar file.'; return hasil; }

  var target = null, manifes = null;
  files.files.forEach(function (f) {
    if (f.name === UPD.FILE_NAME) target = f;
    if (f.name === 'appsscript') manifes = f;
  });
  if (!target) { hasil.error = 'File ' + UPD.FILE_NAME + ' tidak ada di proyek ini.'; return hasil; }

  // 3) perbarui isi file
  var isiBaru = { files: [{ name: UPD.FILE_NAME, type: 'SERVER_JS', source: kode }] };
  if (manifes) isiBaru.files.push({ name: 'appsscript', type: 'JSON', source: manifes.source });
  var upd = UrlFetchApp.fetch('https://script.googleapis.com/v1/projects/' + scriptId + '/content',
    {
      method: 'put', contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
      payload: JSON.stringify(isiBaru), muteHttpExceptions: true
    });
  log('tulis file', upd.getResponseCode());
  if (upd.getResponseCode() !== 200) {
    hasil.error = 'Gagal menulis file: HTTP ' + upd.getResponseCode() + ' ' + upd.getContentText().slice(0, 300);
    return hasil;
  }

  // 4) buat versi baru
  var vers;
  try {
    vers = JSON.parse(UrlFetchApp.fetch('https://script.googleapis.com/v1/projects/' + scriptId + '/versions',
      {
        method: 'post', contentType: 'application/json',
        headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
        payload: JSON.stringify({ description: 'auto-update ' + new Date().toISOString() }),
        muteHttpExceptions: true
      }).getContentText());
  } catch (e) {
    hasil.error = 'Gagal membuat versi baru: ' + e.message;
    return hasil;
  }
  if (!vers.versionNumber) { hasil.error = 'Versi baru tidak terbentuk: ' + JSON.stringify(vers).slice(0, 200); return hasil; }
  log('versi baru', vers.versionNumber);

  // 5) perbarui deployment yang ada agar menunjuk versi baru
  var deps;
  try {
    deps = JSON.parse(UrlFetchApp.fetch('https://script.googleapis.com/v1/projects/' + scriptId + '/deployments',
      { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true }).getContentText());
  } catch (e) {
    hasil.error = 'Gagal membaca daftar deployment: ' + e.message;
    return hasil;
  }
  // Kumpulkan SEMUA deployment Web App. Sebelumnya kode hanya mem-patch yang PERTAMA,
  // sehingga bila ada lebih dari satu deployment, URL yang dipakai dashboard tetap
  // menjalankan versi lama. Sekarang semuanya diarahkan ke versi baru.
  var daftar = [], dilewati = [];
  (deps.deployments || []).forEach(function (d) {
    var url = '';
    (d.entryPoints || []).forEach(function (ep) {
      if (ep.entryPointType === 'WEB_APP' && ep.webApp) url = ep.webApp.url || '';
    });
    if (url) daftar.push({ id: d.deploymentId, url: url, versiLama: d.deploymentConfig && d.deploymentConfig.versionNumber });
    else dilewati.push(d.deploymentId);
  });
  if (!daftar.length) { hasil.error = 'Tidak ada deployment Web App. Buat dulu sekali lewat menu Deploy → New deployment → Web app.'; return hasil; }
  log('deployment web app ditemukan', daftar.length);

  hasil.webAppUrl = [];
  var gagalPatch = 0;
  daftar.forEach(function (d) {
    var patch = UrlFetchApp.fetch('https://script.googleapis.com/v1/projects/' + scriptId + '/deployments/' + d.id,
      {
        method: 'put', contentType: 'application/json',
        headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
        payload: JSON.stringify({
          deploymentConfig: { scriptId: scriptId, versionNumber: vers.versionNumber, manifestFileName: 'appsscript' }
        }),
        muteHttpExceptions: true
      });
    var kode = patch.getResponseCode();
    log('patch ' + d.url.slice(-14), kode + ' (versi ' + d.versiLama + ' -> ' + vers.versionNumber + ')');
    if (kode === 200) hasil.webAppUrl.push(d.url);
    else { gagalPatch++; hasil.langkah.push('GAGAL patch ' + d.url + ': HTTP ' + kode + ' ' + patch.getContentText().slice(0, 200)); }
  });
  if (gagalPatch === daftar.length) { hasil.error = 'Semua deployment gagal diperbarui.'; return hasil; }

  hasil.ok = true;
  hasil.versiBaru = vers.versionNumber;
  hasil.pesan = 'Selesai. RepairAll.gs -> versi ' + vers.versionNumber + '. ' + hasil.webAppUrl.length + '/' + daftar.length +
    ' deployment Web App sudah diarahkan ke versi itu. Uji TIAP URL di bawah dengan ?action=ping sampai muncul build b5.';
  return hasil;
}

/**
 * PEMERIKSA MANDIRI — jalankan ini DULU sebelum pasangRepairTerbaru.
 * Menjawab 4 pertanyaan tanpa mengubah apa pun:
 *   1. Apakah Apps Script API aktif?   (prasyarat paling sering terlewat)
 *   2. Apakah manifest sudah memuat oauthScopes?
 *   3. Apakah scriptId & deployment Web App terbaca?
 *   4. Apakah RepairAll.gs di proyek ini sudah versi terbaru?
 */
function cekStatusPasang() {
  var out = { langkah: [], masalah: [], saran: [] };
  var scriptId = UPD.SCRIPT_ID_OVERRIDE || ScriptApp.getScriptId();
  out.scriptId = scriptId;

  // 1) izin dasar
  try {
    var token = ScriptApp.getOAuthToken();
    out.langkah.push('token OAuth: ' + (token ? 'OK (' + token.length + ' karakter)' : 'KOSONG'));
    if (!token) out.masalah.push('Token OAuth kosong.');
  } catch (e) { out.masalah.push('getOAuthToken gagal: ' + e.message); }

  // 2) Apps Script API aktif?
  var isi = '';
  try {
    var r = UrlFetchApp.fetch('https://script.googleapis.com/v1/projects/' + scriptId + '/content',
      { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true });
    out.kodeHTTP_content = r.getResponseCode();
    isi = r.getContentText();
    if (r.getResponseCode() === 200) {
      var j = JSON.parse(isi);
      out.jumlahFile = (j.files || []).length;
      out.langkah.push('baca isi proyek: OK, ' + out.jumlahFile + ' file');
      var ra = null;
      (j.files || []).forEach(function (f) { if (f.name === 'RepairAll') ra = f; });
      if (ra && ra.source) {
        out.repairAllBytes = ra.source.length;
        out.repairAllPunyaDiagnosa = ra.source.indexOf('function diagnosa_') >= 0;
        out.repairAllBuild = (ra.source.match(/BUILD:\s*'(b[0-9]+)'/) || [])[1] || '(tidak terbaca)';
        out.langkah.push('RepairAll.gs di proyek: ' + out.repairAllBytes + ' byte, build ' + out.repairAllBuild +
          ', diagnosa: ' + (out.repairAllPunyaDiagnosa ? 'ADA' : 'TIDAK ADA'));
      } else {
        out.masalah.push('File RepairAll.gs tidak ditemukan di proyek.');
      }
    } else if (r.getResponseCode() === 403) {
      out.masalah.push('HTTP 403 — Apps Script API belum aktif ATAU scope script.projects belum disetujui.');
      out.saran.push('Buka https://script.google.com/home/usersettings lalu AKTIFKAN "Google Apps Script API".');
      out.saran.push('Pastikan appsscript.json memuat oauthScopes script.projects + script.deployments, simpan, lalu jalankan ulang.');
      out.cuplikanError = isi.slice(0, 300);
    } else {
      out.masalah.push('HTTP ' + r.getResponseCode() + ': ' + isi.slice(0, 200));
    }
  } catch (e) {
    out.masalah.push('Panggilan API gagal total: ' + e.message);
    out.saran.push('Kemungkinan scope script.external_request belum aktif.');
  }

  // 3) deployment
  try {
    var d = UrlFetchApp.fetch('https://script.googleapis.com/v1/projects/' + scriptId + '/deployments',
      { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true });
    out.kodeHTTP_deployments = d.getResponseCode();
    if (d.getResponseCode() === 200) {
      var dj = JSON.parse(d.getContentText());
      out.deployments = (dj.deployments || []).map(function (x) {
        var url = '';
        (x.entryPoints || []).forEach(function (ep) {
          if (ep.entryPointType === 'WEB_APP' && ep.webApp) url = ep.webApp.url || '';
        });
        return { id: x.deploymentId, versi: x.deploymentConfig && x.deploymentConfig.versionNumber, url: url };
      });
      out.langkah.push('deployment terbaca: ' + out.deployments.length);
    }
  } catch (e) { out.masalah.push('baca deployment gagal: ' + e.message); }

  out.kesimpulan = out.masalah.length === 0
    ? 'Semua prasyarat siap. Jalankan pasangRepairTerbaru().'
    : 'Ada ' + out.masalah.length + ' masalah — lihat daftar masalah & saran.';
  return out;
}

/**
 * Pintu HTTP untuk cekStatusPasang: buka
 *   .../exec?action=cek
 * Berguna bila Anda tidak ingin membuka editor untuk melihat log.
 */
function doGet(e) {
  var p = (e && e.parameter) || {};
  if (String(p.action || '').toLowerCase() === 'cek') {
    return ContentService.createTextOutput(JSON.stringify(cekStatusPasang()))
      .setMimeType(ContentService.MimeType.JSON);
  }
  return ContentService.createTextOutput(JSON.stringify({
    ok: true,
    pesan: 'AutoUpdate siap. Aksi tersedia: ?action=cek (memeriksa prasyarat). Jalankan pasangRepairTerbaru dari editor untuk memasang kode terbaru.'
  })).setMimeType(ContentService.MimeType.JSON);
}
