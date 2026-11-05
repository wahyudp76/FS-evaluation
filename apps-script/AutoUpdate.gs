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
  var webApp = null;
  (deps.deployments || []).forEach(function (d) {
    if (d.entryPoints) d.entryPoints.forEach(function (ep) {
      if (ep.entryPointType === 'WEB_APP' && !webApp) webApp = d;
    });
  });
  if (!webApp) { hasil.error = 'Tidak ada deployment Web App. Buat dulu sekali lewat menu Deploy.'; return hasil; }

  var patch = UrlFetchApp.fetch('https://script.googleapis.com/v1/projects/' + scriptId + '/deployments/' + webApp.deploymentId,
    {
      method: 'put', contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
      payload: JSON.stringify({
        deploymentConfig: { scriptId: scriptId, versionNumber: vers.versionNumber, manifestFileName: 'appsscript' }
      }),
      muteHttpExceptions: true
    });
  log('perbarui deployment', patch.getResponseCode());
  if (patch.getResponseCode() !== 200) {
    hasil.error = 'Gagal memperbarui deployment: HTTP ' + patch.getResponseCode() + ' ' + patch.getContentText().slice(0, 300);
    return hasil;
  }

  hasil.ok = true;
  hasil.deploymentId = webApp.deploymentId;
  hasil.webAppUrl = (webApp.entryPoints && webApp.entryPoints[0] && webApp.entryPoints[0].webApp && webApp.entryPoints[0].webApp.url) || '';
  hasil.pesan = 'Selesai. Kode RepairAll.gs diperbarui ke versi ' + vers.versionNumber +
    ' dan deployment sudah diarahkan ke versi itu. Muat ulang /exec?action=ping untuk memastikan build terbaru.';
  return hasil;
}
