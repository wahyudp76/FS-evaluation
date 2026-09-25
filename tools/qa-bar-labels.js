// Uji label angka pada chart bar (plugin barLabels) — puppeteer
// pakai: node /home/user/tools/qa-bar-labels.js [url]
// Aturan yang diuji:
//   - chart bar SINGLE (tidak stacked)  -> angka ditulis pada batang
//   - chart bar STACKED                 -> tidak ada angka (permintaan pengguna)
const puppeteer = require('/tmp/node/node_modules/puppeteer');
const fs = require('fs');
const URL = process.argv[2] || 'http://localhost:8080/index.html';
const CHROME = '/home/user/.cache/puppeteer/chrome/linux-131.0.6778.204/chrome-linux64/chrome';
const OUT = '/tmp/qa';
fs.mkdirSync(OUT, { recursive: true });

const results = [];
const ok = (n, c, e = '') => { results.push({ n, ok: !!c }); console.log((c ? 'PASS  ' : 'FAIL  ') + n + (e ? '  :: ' + e : '')); };
const tunggu = (p) => p.waitForFunction(() => { const r = document.querySelector('#rowCount'); return r && /records/.test(r.textContent) && !/^0 records/.test(r.textContent.trim()); }, { timeout: 120000 });
const clipOf = async (p, id, file, pad = 12) => {
  const b = await p.evaluate((id) => { const c = document.getElementById(id); const r = c.getBoundingClientRect(); return { x: r.left + window.scrollX, y: r.top + window.scrollY, w: r.width, h: r.height }; }, id);
  await p.screenshot({ path: file, clip: { x: Math.max(0, b.x - pad), y: Math.max(0, b.y - pad), width: b.w + pad * 2, height: b.h + pad * 2 }, captureBeyondViewport: true });
};

(async () => {
  const b = await puppeteer.launch({ executablePath: CHROME, headless: 'shell', args: ['--no-sandbox'] });
  const p = await b.newPage(); await p.setViewport({ width: 1440, height: 1050 });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(URL, { waitUntil: 'domcontentloaded' }); await tunggu(p);
  await new Promise(r => setTimeout(r, 2500));

  // buka semua tab supaya seluruh chart terbentuk
  for (const t of ['wilayah', 'biaya', 'utilisasi', 'indexsolar', 'data', 'overview']) {
    await p.evaluate(x => document.querySelector('[data-tab="' + x + '"]').click(), t);
    await new Promise(r => setTimeout(r, 900));
  }

  const info = await p.evaluate(() => {
    const out = {};
    ['chartLuas', 'chartSolar', 'chartBiayaGran', 'chartIndexBoros', 'chartWilayah', 'chartWilayahCompare',
      'chartJam', 'chartWaktuKomposisi', 'chartIndexWilayah', 'chartBiayaWilayah'].forEach(id => {
        const c = window.Chart.getChart(document.getElementById(id));
        if (!c) { out[id] = { ada: false }; return; }
        out[id] = {
          ada: true,
          label: !!(c.$barLabels && c.$barLabels.display !== false),
          fmt: c.$barLabels ? (c.$barLabels.fmt || JSON.stringify(c.$barLabels.fmtBySeries || {})) : '',
          stacked: !!(c.options.scales && ((c.options.scales.x && c.options.scales.x.stacked) || (c.options.scales.y && c.options.scales.y.stacked)))
        };
      });
    return out;
  });

  const single = ['chartLuas', 'chartSolar', 'chartBiayaGran', 'chartIndexBoros', 'chartWilayah', 'chartWilayahCompare'];
  const stacked = ['chartJam', 'chartWaktuKomposisi', 'chartIndexWilayah', 'chartBiayaWilayah'];
  ok('semua chart bar single diberi label angka', single.every(id => info[id].ada && info[id].label && !info[id].stacked),
    single.filter(id => !(info[id].ada && info[id].label && !info[id].stacked)).join(',') || 'lengkap 6 chart');
  ok('chart bar stacked TIDAK diberi label angka', stacked.every(id => info[id].ada && info[id].stacked && !info[id].label),
    stacked.map(id => id + '(stacked:' + info[id].stacked + ',label:' + info[id].label + ')').join(' '));
  ok('satuan label sesuai chart',
    info.chartLuas.fmt === 'ha0' && info.chartSolar.fmt === 'Lint' && info.chartBiayaGran.fmt === 'rpshort' &&
    info.chartIndexBoros.fmt === 'signed2' && /y1/.test(info.chartWilayahCompare.fmt),
    `luas=${info.chartLuas.fmt} solar=${info.chartSolar.fmt} biaya=${info.chartBiayaGran.fmt} index=${info.chartIndexBoros.fmt} compare=${info.chartWilayahCompare.fmt}`);

  // bukti label benar-benar tertulis: bandingkan hasil kanvas saat label aktif vs dimatikan
  const ukur = async (tab, ids) => {
    await p.evaluate(x => document.querySelector('[data-tab="' + x + '"]').click(), tab);
    await new Promise(r => setTimeout(r, 1100));
    return await p.evaluate((ids) => {
      const out = {};
      ids.forEach(id => {
        const c = window.Chart.getChart(document.getElementById(id));
        if (!c) { out[id] = { beda: 0, info: null }; return; }
        c.options.animation = false; c.update('none');
        // pastikan kondisi stabil: dua gambar berturut-turut harus identik lebih dulu
        c.draw(); const a1 = c.canvas.toDataURL();
        c.draw(); const a2 = c.canvas.toDataURL();
        const stabil = a1 === a2;
        const dengan = a2;
        const simpan = c.$barLabels;
        c.$barLabels = Object.assign({}, simpan, { display: false }); c.draw();
        const tanpa = c.canvas.toDataURL();
        c.$barLabels = simpan; c.draw();
        out[id] = { beda: dengan === tanpa ? 0 : 1, stabil, info: c.$labelInfo };
      });
      return out;
    }, ids);
  };

  // pengukuran dilakukan pada granularitas bulanan (label memang tampil di tampilan ini)
  await p.evaluate(() => document.querySelector('[data-tab="overview"]').click());
  await new Promise(r => setTimeout(r, 900));
  await p.evaluate(() => { const btn = document.querySelector('[data-gran="monthly"]'); if (btn) btn.click(); });
  await new Promise(r => setTimeout(r, 1600));

  const bukti = Object.assign({},
    await ukur('overview', ['chartLuas', 'chartSolar', 'chartJam']),
    await ukur('biaya', ['chartBiayaGran', 'chartBiayaWilayah']),
    await ukur('indexsolar', ['chartIndexBoros', 'chartIndexWilayah']),
    await ukur('wilayah', ['chartWilayah', 'chartWilayahCompare']),
    await ukur('utilisasi', ['chartWaktuKomposisi'])
  );
  console.log('bukti gambar:', JSON.stringify(Object.fromEntries(Object.entries(bukti).map(([k, v]) => [k, { tertulis: v.info && v.info.tertulis, kandidat: v.info && v.info.kandidat, adaGambar: v.beda }]))));
  ok('angka benar-benar tergambar pada chart single', single.every(id => bukti[id].beda === 1 && bukti[id].info && bukti[id].info.tertulis > 0),
    single.map(id => id + ':' + (bukti[id].info && bukti[id].info.tertulis)).join(' '));
  ok('chart stacked tidak bertambah gambar', ['chartJam', 'chartWaktuKomposisi', 'chartIndexWilayah', 'chartBiayaWilayah'].every(id => bukti[id].beda === 0),
    ['chartJam', 'chartWaktuKomposisi', 'chartIndexWilayah', 'chartBiayaWilayah'].map(id => id + ':' + bukti[id].beda).join(' '));

  // batang rapat (granularitas harian): hanya sebagian label ditulis, tidak menumpuk
  await p.evaluate(() => document.querySelector('[data-tab="overview"]').click());
  await new Promise(r => setTimeout(r, 1100));
  await p.evaluate(() => { const btn = document.querySelector('[data-gran="daily"]'); if (btn) btn.click(); });
  await new Promise(r => setTimeout(r, 1500));
  const harian = await p.evaluate(() => {
    const c = window.Chart.getChart(document.getElementById('chartLuas'));
    return { batang: c.data.labels.length, info: c.$labelInfo };
  });
  const catatanHarian = await p.evaluate(() => (document.getElementById('chartLuasNote') || {}).textContent || '');
  ok('harian (batang rapat): label tidak ditulis + ada keterangan',
    (harian.info.tertulis === 0 || !harian.info.tertulis) && /Harian/.test(catatanHarian), JSON.stringify(harian) + ' | catatan: ' + catatanHarian);

  // granularitas bulanan: semua batang dapat label
  await p.evaluate(() => { const btn = document.querySelector('[data-gran="monthly"]'); if (btn) btn.click(); });
  await new Promise(r => setTimeout(r, 1600));
  const bulanan = await p.evaluate(() => {
    const c = window.Chart.getChart(document.getElementById('chartLuas'));
    return { batang: c.data.labels.length, info: c.$labelInfo };
  });
  ok('bulanan (batang lega): semua batang berlabel', bulanan.info.tertulis === bulanan.batang && bulanan.batang > 0, JSON.stringify(bulanan));
  const catatanBulanan = await p.evaluate(() => (document.getElementById('chartLuasNote') || {}).textContent || '');
  ok('keterangan label ikut berubah saat granularitas berganti', /menunjukkan nilainya/.test(catatanBulanan), catatanBulanan);

  // granularitas mingguan: label tetap tampil
  await p.evaluate(() => { const btn = document.querySelector('[data-gran="weekly"]'); if (btn) btn.click(); });
  await new Promise(r => setTimeout(r, 1600));
  const mingguan = await p.evaluate(() => {
    const c = window.Chart.getChart(document.getElementById('chartLuas'));
    return { batang: c.data.labels.length, info: c.$labelInfo };
  });
  ok('mingguan: label tampil pada sebagian besar batang', mingguan.info.tertulis > 0 && mingguan.info.tertulis >= mingguan.batang * 0.6, JSON.stringify(mingguan));

  // tangkapan layar bukti
  await p.evaluate(() => { const btn = document.querySelector('[data-gran="daily"]'); if (btn) btn.click(); });
  await new Promise(r => setTimeout(r, 1400));
  await clipOf(p, 'chartLuas', OUT + '/lbl-luas-harian.png');
  await p.evaluate(() => { const btn = document.querySelector('[data-gran="monthly"]'); if (btn) btn.click(); });
  await new Promise(r => setTimeout(r, 1400));
  await clipOf(p, 'chartLuas', OUT + '/lbl-luas-bulanan.png');
  await clipOf(p, 'chartSolar', OUT + '/lbl-solar-bulanan.png');
  await clipOf(p, 'chartJam', OUT + '/lbl-jam-stacked.png');
  await p.evaluate(() => document.querySelector('[data-tab="biaya"]').click());
  await new Promise(r => setTimeout(r, 1400));
  await clipOf(p, 'chartBiayaGran', OUT + '/lbl-biaya-gran.png');
  await p.evaluate(() => document.querySelector('[data-tab="indexsolar"]').click());
  await new Promise(r => setTimeout(r, 1500));
  await clipOf(p, 'chartIndexBoros', OUT + '/lbl-index-boros.png');

  ok('tidak ada error runtime', errs.length === 0, errs.slice(0, 3).join(' ; '));

  const gagal = results.filter(r => !r.ok);
  console.log(`\n===== ${results.length - gagal.length}/${results.length} lulus =====`);
  gagal.forEach(f => console.log('  GAGAL:', f.n));
  await b.close();
  process.exit(gagal.length ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
