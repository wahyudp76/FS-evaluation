// Uji v1.7.0: struktur kolom A..AH + sheet Index Solar
const puppeteer = require('/tmp/node/node_modules/puppeteer');
const CHROME = '/home/user/.cache/puppeteer/chrome/linux-131.0.6778.204/chrome-linux64/chrome';
const URL = process.argv[2] || 'http://localhost:8080/index.html';
const fs = require('fs'); fs.mkdirSync('/tmp/qa', { recursive: true });
const results = [];
const check = (n, ok, extra = '') => { results.push({ n, ok: !!ok }); console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (extra ? '  :: ' + extra : '')); };
const ready = (p) => p.waitForFunction(() => { const r = document.querySelector('#rowCount'); return r && /records/.test(r.textContent) && !/^0 records/.test(r.textContent.trim()); }, { timeout: 120000 });

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'shell', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  const errs = [];
  page.on('pageerror', e => errs.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 160)); });
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await ready(page);
  await new Promise(r => setTimeout(r, 2500));

  const total = await page.$eval('#rowCount', el => el.textContent.trim());
  console.log('rowCount:', total);
  const totalRows = parseInt(total.split('/')[1].replace(/\D/g, ''), 10);
  check('data ZPAS637 baru termuat (12.730 baris)', totalRows === 12730, String(totalRows));

  // ---- struktur tab ----
  const tabs = await page.$$eval('.tab-btn', els => els.map(e => e.dataset.tab));
  check('6 tab dengan Index Solar', tabs.length === 6 && tabs.includes('indexsolar'), tabs.join(', '));

  // ---- keliling semua tab, cek canvas + panel ----
  const canvasesByTab = {
    overview: ['chartSolar','chartLuas','chartJam','chartKecepatan','chartEfisiensi'],
    wilayah: ['chartWilayah','chartWilayahEff','chartWilayahCompare'],
    biaya: ['chartBiayaWilayah','chartBiayaKomposisi','chartBiayaTrend','chartBiayaGran'],
    utilisasi: ['chartJenisEngine','chartWaktuKomposisi','chartAir','chartAvail','chartScatter'],
    indexsolar: ['chartIndexBoros','chartIndexHasil','chartIndexWilayah','chartIndexScatter']
  };
  for (const [tab, ids] of Object.entries(canvasesByTab)) {
    await page.click(`#tabbtn-${tab}`);
    await new Promise(r => setTimeout(r, 900));
    const info = await page.evaluate((ids) => {
      return ids.map(id => {
        const cv = document.getElementById(id);
        const ch = cv && window.Chart && window.Chart.getChart(cv);
        return { id, ada: !!cv, chart: !!ch, titik: ch ? ch.data.datasets.reduce((a, d) => a + (d.data ? d.data.length : 0), 0) : 0 };
      });
    }, ids);
    const bad = info.filter(i => !i.chart || i.titik === 0);
    check(`tab ${tab}: semua chart terisi`, bad.length === 0, info.map(i => `${i.id}:${i.titik}`).join(' '));
  }

  // ---- tab Waktu & Utilisasi: kartu + tabel waktu ----
  await page.click('#tabbtn-utilisasi');
  await new Promise(r => setTimeout(r, 900));
  const waktu = await page.evaluate(() => ({
    kartu: document.querySelectorAll('#waktuCards > div').length,
    rows: document.querySelectorAll('#waktuWilayahBody tr').length,
    foot: document.querySelectorAll('#waktuWilayahFoot tr').length,
    judul: (document.querySelector('#tab-utilisasi h2') || {}).textContent
  }));
  check('utilisasi: 12 kartu waktu', waktu.kartu === 12, JSON.stringify(waktu.kartu));
  check('utilisasi: tabel waktu per wilayah (8 wilayah + baris ringkasan)', waktu.rows === 8 && waktu.foot === 1, `rows ${waktu.rows}, foot ${waktu.foot}`);

  // ---- mode rata-rata vs total pada tab Waktu & Utilisasi ----
  const bacaWaktu = () => page.evaluate(() => {
    const c = window.Chart.getChart(document.getElementById('chartWaktuKomposisi'));
    return {
      kartu1: (document.querySelector('#waktuCards > div') || {}).innerText || '',
      head: Array.from(document.querySelectorAll('#waktuWilayahHead th')).map(t => t.textContent.trim()).join('|'),
      foot: (document.querySelector('#waktuWilayahFoot tr td') || {}).textContent || '',
      selBulan1: c ? c.data.datasets[0].data[1] : null,
      sumbuY: c ? c.options.scales.y.title.text : '',
      catatanKartu: (document.getElementById('waktuModeNote') || {}).textContent || '',
      catatanTabel: (document.getElementById('waktuWilayahNote') || {}).textContent || '',
      catatanChart: (document.getElementById('chartWaktuNote') || {}).textContent || '',
      aktif: Array.from(document.querySelectorAll('[data-waktu]')).filter(x => x.getAttribute('aria-pressed') === 'true').map(x => x.dataset.waktu)
    };
  });
  const mDefault = await bacaWaktu();
  check('waktu: bawaan = rata-rata per aktivitas', /jam\/aktivitas/.test(mDefault.kartu1) && /jam\/akt/.test(mDefault.head) && mDefault.aktif[0] === 'avgAkt', mDefault.kartu1.split('\n')[0] + ' | ' + mDefault.aktif.join(','));
  check('waktu: kartu tetap menampilkan total & per hari sebagai pendukung', /total /.test(mDefault.kartu1) && /jam\/hari/.test(mDefault.kartu1), mDefault.kartu1.replace(/\n/g, ' | '));
  check('waktu: tabel & chart ikut mode rata-rata', /AKTIVITAS/.test(mDefault.foot) && mDefault.sumbuY === 'Jam/aktivitas' && /per AKTIVITAS/.test(mDefault.catatanChart), mDefault.foot + ' | ' + mDefault.sumbuY);

  await page.evaluate(() => document.querySelector('[data-waktu="total"]').click());
  await new Promise(r => setTimeout(r, 1200));
  const mTotal = await bacaWaktu();
  check('waktu: mode Total mengembalikan angka akumulasi', mTotal.foot === 'TOTAL' && mTotal.sumbuY === 'Jam' && /225\.424/.test(mTotal.kartu1), mTotal.kartu1.replace(/\n/g, ' | ').slice(0, 90));
  check('waktu: nilai chart Total jauh lebih besar dari rata-rata', mTotal.selBulan1 > mDefault.selBulan1 * 5, `${mDefault.selBulan1} -> ${mTotal.selBulan1}`);

  await page.evaluate(() => document.querySelector('[data-waktu="avgHari"]').click());
  await new Promise(r => setTimeout(r, 1200));
  const mHari = await bacaWaktu();
  check('waktu: mode Rata-rata / Hari memakai jam/hari di kartu, tabel, chart', /jam\/hari/.test(mHari.kartu1) && /jam\/hari/.test(mHari.head) && mHari.sumbuY === 'Jam/hari' && /HARI/.test(mHari.foot), mHari.sumbuY + ' | ' + mHari.foot);
  check('waktu: keterangan ikut berubah di ketiga tempat', /HARI/.test(mHari.catatanTabel) && /per HARI/.test(mHari.catatanChart) && /HARI/.test(mHari.catatanKartu), mHari.catatanKartu.slice(0, 60));

  // kembali ke bawaan supaya uji lain tidak terpengaruh
  await page.evaluate(() => document.querySelector('[data-waktu="avgAkt"]').click());
  await new Promise(r => setTimeout(r, 1000));
  check('utilisasi: judul tab baru', /Waktu & Utilisasi/.test(waktu.judul || ''), waktu.judul);

  // ---- tab Index Solar ----
  await page.click('#tabbtn-indexsolar');
  await new Promise(r => setTimeout(r, 1200));
  const idx = await page.evaluate(() => {
    const kpi = Array.from(document.querySelectorAll('#indexKpiGrid > div')).map(d => d.innerText.replace(/\n/g, ' | '));
    const rows = Array.from(document.querySelectorAll('#indexTableBody tr')).slice(0, 3).map(tr => tr.innerText.replace(/\t/g, ' | ').slice(0, 120));
    return {
      kpiCount: kpi.length, kpi: kpi.slice(0, 2),
      count: (document.getElementById('indexCount') || {}).textContent,
      pageInfo: (document.getElementById('indexPageInfo') || {}).textContent,
      rowsShown: document.querySelectorAll('#indexTableBody tr').length,
      rowsSample: rows,
      legend: (document.getElementById('indexHasilLegend') || {}).innerText
    };
  });
  console.log('KPI index:', idx.kpi.join(' || '));
  console.log('sample baris:', idx.rowsSample.join(' // '));
  console.log('legend:', (idx.legend || '').replace(/\n/g, ' | '));
  check('index solar: 5 kartu KPI', idx.kpiCount === 5, String(idx.kpiCount));
  check('index solar: 151 engine terbaca', idx.count === '151', String(idx.count));
  check('index solar: tabel terisi (12 baris/halaman)', idx.rowsShown === 12, String(idx.rowsShown));
  check('index solar: legend hasil evaluasi terisi', /Hemat/.test(idx.legend || '') && /Boros/.test(idx.legend || ''));
  await page.screenshot({ path: '/tmp/qa/v17-index-solar.png', fullPage: false });

  // filter hasil: Boros
  await page.select('#indexJustifikasi', 'Boros');
  await new Promise(r => setTimeout(r, 900));
  const boros = await page.evaluate(() => ({ count: (document.getElementById('indexCount') || {}).textContent, rows: document.querySelectorAll('#indexTableBody tr').length }));
  check('index solar: filter Boros menyaring', /^2[0-9]$|^3[0-9]$/.test(boros.count), JSON.stringify(boros));
  await page.select('#indexJustifikasi', 'anomali');
  await new Promise(r => setTimeout(r, 800));
  const anom = await page.evaluate(() => ({ count: (document.getElementById('indexCount') || {}).textContent, teks: (document.querySelector('#indexTableBody') || {}).innerText }));
  check('index solar: filter anomali menampilkan 2 engine', anom.count === '2' && /SPC0127|DED0015/.test(anom.teks || ''), anom.count);
  await page.select('#indexJustifikasi', 'all');
  await new Promise(r => setTimeout(r, 700));

  // urut + pencarian + paginasi
  await page.select('#indexSort', 'engine');
  await new Promise(r => setTimeout(r, 700));
  const firstEng = await page.$eval('#indexTableBody tr td', el => el.textContent.trim());
  check('index solar: urut kode engine A-Z', /^DE/.test(firstEng), firstEng);
  await page.type('#indexSearch', 'SPC0127', { delay: 40 });
  await new Promise(r => setTimeout(r, 1000));
  const cari = await page.evaluate(() => ({ count: (document.getElementById('indexCount') || {}).textContent, teks: (document.querySelector('#indexTableBody') || {}).innerText }));
  check('index solar: pencarian engine berfungsi', cari.count === '1' && /SPC0127/.test(cari.teks), cari.count);
  await page.evaluate(() => { const i = document.getElementById('indexSearch'); i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true })); });
  await new Promise(r => setTimeout(r, 900));
  const p1 = await page.$eval('#indexPageInfo', el => el.textContent);
  await page.click('#indexNextPage');
  await new Promise(r => setTimeout(r, 600));
  const p2 = await page.$eval('#indexPageInfo', el => el.textContent);
  check('index solar: paginasi jalan', p1 !== p2, p1 + ' -> ' + p2);

  // ---- filter sidebar memengaruhi index solar ----
  await page.evaluate(() => {
    const cb = Array.from(document.querySelectorAll('.wilayah-cb')).find(c => c.value === 'AW08');
    cb.checked = true; cb.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await new Promise(r => setTimeout(r, 1100));
  const perWil = await page.evaluate(() => ({ count: (document.getElementById('indexCount') || {}).textContent, rowCount: document.getElementById('rowCount').textContent }));
  check('index solar: ikut filter wilayah AW08', parseInt(perWil.count.replace(/\D/g, ''), 10) > 0 && parseInt(perWil.count.replace(/\D/g, ''), 10) < 151, JSON.stringify(perWil));
  await page.click('#btnClearFilters');
  await new Promise(r => setTimeout(r, 1200));

  // ---- tabel detail 34 kolom ----
  await page.click('#tabbtn-data');
  await new Promise(r => setTimeout(r, 900));
  const detail = await page.evaluate(() => {
    const th = document.querySelectorAll('#tab-data thead th').length;
    const firstRow = document.querySelector('#dataTableBody tr');
    return {
      kolom: th,
      selCount: firstRow ? firstRow.children.length : 0,
      cuplikan: firstRow ? firstRow.innerText.replace(/\t/g, ' | ').slice(0, 200) : '',
      lebarTabel: (document.querySelector('#tab-data table') || {}).scrollWidth,
      wadahScroll: (document.querySelector('#tab-data .overflow-x-auto') || {}).scrollWidth
    };
  });
  console.log('baris detail:', detail.cuplikan);
  check('detail: 34 kolom sesuai sheet A..AH', detail.kolom === 34 && detail.selCount === 34, `th ${detail.kolom}, td ${detail.selCount}`);
  check('detail: tabel bisa digeser horizontal', detail.lebarTabel > 1200, 'lebar ' + detail.lebarTabel);

  // ---- export CSV 34 kolom ----
  const csv = await page.evaluate(() => new Promise(resolve => {
    const orig = URL.createObjectURL;
    URL.createObjectURL = (blob) => { blob.text().then(t => resolve(t)); return orig.call(URL, blob); };
    document.getElementById('btnExport').click();
    setTimeout(() => resolve('TIMEOUT'), 5000);
  }));
  const lines = String(csv).split(/\r?\n/);
  const header = lines[0].replace(/^\ufeff/, '');
  const nKolom = header.split(',').length;
  check('export CSV: 34 kolom + seluruh baris', nKolom === 34 && lines.length > 12000, `${nKolom} kolom, ${lines.length} baris`);
  console.log('header CSV:', header.slice(0, 150));

  // ---- kecepatan & error ----
  const perf = await page.evaluate(() => {
    const n = performance.getEntriesByType('navigation')[0];
    return { dcl: Math.round(n.domContentLoadedEventEnd), heap: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null };
  });
  console.log('perf:', JSON.stringify(perf));
  check('tidak ada error runtime', errs.length === 0, errs.slice(0, 3).join(' ; '));

  const failed = results.filter(r => !r.ok);
  console.log(`\n===== ${results.length - failed.length}/${results.length} lulus =====`);
  failed.forEach(f => console.log('  GAGAL:', f.n));
  await browser.close();
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
