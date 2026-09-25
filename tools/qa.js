// QA fungsional + performa dashboard PG2 (puppeteer)
// pakai: node /tmp/qa.js [url]
const puppeteer = require('/tmp/node/node_modules/puppeteer');
const fs = require('fs');

const URL = process.argv[2] || 'http://localhost:8080/index.html';
const CHROME = '/home/user/.cache/puppeteer/chrome/linux-131.0.6778.204/chrome-linux64/chrome';
const OUT = '/tmp/qa';
fs.mkdirSync(OUT, { recursive: true });

const results = [];
const check = (name, ok, extra = '') => {
  results.push({ name, ok: !!ok, extra });
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (extra ? '  :: ' + extra : ''));
};

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'shell',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--window-size=1366,900', '--disable-features=IsolateOrigins']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1366, height: 900, deviceScaleFactor: 1 });

  const consoleErrors = [];
  const consoleWarns = [];
  const consoleDebug = [];
  const failedReqs = [];
  page.on('console', m => {
    const t = m.type();
    if (t === 'error') consoleErrors.push(m.text());
    else if (t === 'debug') consoleDebug.push(m.text());
    else if (t === 'warning') consoleWarns.push(m.text());
  });
  page.on('pageerror', e => consoleErrors.push('pageerror: ' + e.message));
  page.on('requestfailed', r => failedReqs.push(r.url().slice(0, 120) + ' -> ' + (r.failure() && r.failure().errorText)));

  // ---------- VISIT 1 (jaringan, belum ada cache) ----------
  const t0 = Date.now();
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => {
    const rc = document.querySelector('#rowCount');
    return rc && /records/.test(rc.textContent) && !/^0 records/.test(rc.textContent.trim());
  }, { timeout: 90000 });
  const tReady1 = Date.now() - t0;
  await page.waitForFunction(() => {
    const ov = document.querySelector('#loadingOverlay');
    return ov && (ov.style.display === 'none' || getComputedStyle(ov).display === 'none');
  }, { timeout: 30000 }).catch(() => {});
  console.log('tReady visit-1 (ms):', tReady1);

  const rowCount1 = await page.$eval('#rowCount', el => el.textContent.trim());
  const TOTAL = parseInt(rowCount1.split('/')[1].replace(/\D/g, ''), 10);
  const TOTAL_STR = TOTAL.toLocaleString('id-ID');
  check('rowCount terisi saat load', /records/.test(rowCount1) && TOTAL > 1000, rowCount1 + ' (total ' + TOTAL + ')');
  const ticker1 = await page.$eval('#headerTicker', el => el.innerText.replace(/\n/g, ' | ').trim());
  console.log('ticker:', ticker1);
  check('ticker berisi 8 metrik', (await page.$$eval('#headerTicker span.inline-flex', els => els.length)) === 8);

  // ---------- TAB SWITCH (5 tab) ----------
  const tabLat = {};
  for (const tab of ['wilayah', 'biaya', 'utilisasi', 'indexsolar', 'data', 'overview']) {
    const t = Date.now();
    await page.click(`#tabbtn-${tab}`);
    await new Promise(r => setTimeout(r, 60));
    await page.waitForFunction(tb => {
      const p = document.querySelector('#tab-' + tb);
      return p && !p.classList.contains('hidden');
    }, { timeout: 15000 }, tab);
    tabLat[tab] = Date.now() - t;
    const vis = await page.$eval(`#tab-${tab}`, el => {
      const r = el.getBoundingClientRect();
      return { h: Math.round(r.height), children: el.querySelectorAll('*').length };
    });
    check(`tab ${tab} tampil (isi > 0)`, vis.children > 5 && vis.h > 40, JSON.stringify(vis));
    await page.screenshot({ path: `${OUT}/tab-${tab}.png` });
  }
  console.log('tab switch (ms):', JSON.stringify(tabLat));

  // aria
  const aria = await page.$eval('#tabbtn-overview', el => el.getAttribute('aria-selected'));
  check('aria-selected tab aktif = true', aria === 'true', String(aria));

  // keyboard: fokus ke tab aktif, ArrowRight pindah tab
  await page.focus('#tabbtn-overview');
  await page.keyboard.press('ArrowRight');
  await new Promise(r => setTimeout(r, 200));
  const afterArrow = await page.evaluate(() => {
    const p = ['overview', 'wilayah', 'biaya', 'utilisasi', 'data'].find(t => !document.querySelector('#tab-' + t).classList.contains('hidden'));
    return p;
  });
  check('navigasi keyboard tab (ArrowRight)', afterArrow === 'wilayah', 'tab aktif: ' + afterArrow);

  // ---------- CHART ----------
  const chartsInfo = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll('canvas').forEach(cv => {
      const ch = window.Chart && window.Chart.getChart(cv);
      if (ch) out.push({ id: cv.id, pts: ch.data.datasets.reduce((a, d) => a + (d.data ? d.data.length : 0), 0), ok: !!ch.width });
    });
    return out;
  });
  const canvases = await page.$$eval('canvas', els => els.map(e => e.id));
  console.log('charts:', JSON.stringify(chartsInfo.map(c => c.id + ':' + c.pts)));
  check('semua canvas punya instance chart', chartsInfo.length === canvases.length, canvases.length + ' canvas / ' + chartsInfo.length + ' chart');

  // ---------- FILTER TANGGAL ----------
  await page.evaluate(() => { document.querySelector('#btnRangeAll').scrollIntoView(); });
  await page.evaluate(() => {
    const s = document.querySelector('#filterStart'), e = document.querySelector('#filterEnd');
    s.value = '2026-09-10'; s.dispatchEvent(new Event('change', { bubbles: true }));
    e.value = '2026-09-12'; e.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await new Promise(r => setTimeout(r, 700));
  const rcRange = await page.$eval('#rowCount', el => el.textContent.trim());
  const nRange = parseInt(rcRange.split('/')[0].replace(/\D/g, ''), 10);
  check('filter 10-12 Sep 2026 menyaring', nRange > 0 && nRange < TOTAL, rcRange);

  const tRange = Date.now();
  await page.click('#btnRangeAll');
  await new Promise(r => setTimeout(r, 800));
  // label angka pada chart bar tab Performance Wilayah (plugin barLabels)
  const barLabels = await page.evaluate(() => {
    const c = window.Chart.getChart(document.getElementById('chartWilayah'));
    const c2 = window.Chart.getChart(document.getElementById('chartWilayahCompare'));
    return {
      horizontal: !!(c && c.$barLabels && c.$barLabels.display === false ? false : (c && c.$barLabels)),
      compare: !!(c2 && c2.$barLabels),
      fmtCompare: c2 && c2.$barLabels ? JSON.stringify(c2.$barLabels.fmtBySeries) : '',
      pluginAda: !!(window.Chart.registry && window.Chart.registry.plugins.get('barLabels')),
      hiddenSeries: c2 ? c2.data.datasets.filter(d => d.barLabels === false).length : 0,
      garisTanpaLabel: c2 ? c2.$barLabels && c2.$barLabels.fmtBySeries && !c2.$barLabels.fmtBySeries.y1 : true
    };
  });
  check('wilayah: plugin barLabels aktif di 2 chart bar', !!(barLabels.horizontal && barLabels.compare && barLabels.pluginAda), JSON.stringify(barLabels));
  check('wilayah: satuan label mengikuti sumbu (Ha vs L)', /y1/.test(barLabels.fmtCompare || ''), barLabels.fmtCompare);

  const rcAll = await page.$eval('#rowCount', el => el.textContent.trim());
  const dRangeAll = Date.now() - tRange;
  check('btnRangeAll mengembalikan semua data', rcAll === TOTAL_STR + ' / ' + TOTAL_STR + ' records', rcAll + ' (' + dRangeAll + ' ms)');

  // filter mulai 01/08/2026
  await page.evaluate(() => {
    const s = document.querySelector('#filterStart');
    s.value = '2026-08-01'; s.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await new Promise(r => setTimeout(r, 700));
  const rcAug = await page.$eval('#rowCount', el => el.textContent.trim());
  const nAug = parseInt(rcAug.split('/')[0].replace(/\D/g, ''), 10);
  check('filter >= 01 Agu 2026 menyaring', nAug > 0 && nAug < TOTAL, rcAug);
  await page.click('#btnRangeAll');
  await new Promise(r => setTimeout(r, 600));

  // ---------- FILTER WILAYAH / BULAN / TAHUN / ENGINE ----------
  const wilayahFirst = await page.$$eval('.wilayah-cb', els => els.length);
  check('checkbox wilayah terisi', wilayahFirst > 0, wilayahFirst + ' wilayah');
  const wVal = await page.$eval('.wilayah-cb', el => el.value);
  await page.click('.wilayah-cb');
  await new Promise(r => setTimeout(r, 600));
  const rcWil = await page.$eval('#rowCount', el => el.textContent.trim());
  const [numW, totW] = rcWil.replace(/ records/, '').split(' / ').map(s => parseInt(s.replace(/\./g, ''), 10));
  check('filter wilayah menyaring data', numW > 0 && numW < totW, wVal + ' -> ' + rcWil);
  await page.click('.wilayah-cb');
  await new Promise(r => setTimeout(r, 500));

  const monthBtns = await page.$$eval('.month-btn', els => els.map(e => e.textContent.trim()));
  await page.click('.month-btn');
  await new Promise(r => setTimeout(r, 600));
  const rcMon = await page.$eval('#rowCount', el => el.textContent.trim());
  check('filter bulan menyaring data', !new RegExp('^' + TOTAL_STR.replace(/\./g, '\\.')).test(rcMon), monthBtns[0] + ' -> ' + rcMon);

  // reset semua filter
  await page.click('#btnClearFilters');
  await new Promise(r => setTimeout(r, 700));
  const rcClear = await page.$eval('#rowCount', el => el.textContent.trim());
  check('clear filters -> kembali penuh', rcClear === TOTAL_STR + ' / ' + TOTAL_STR + ' records', rcClear);

  // ---------- PENCARIAN ----------
  await page.type('#filterSearch', 'aw09', { delay: 40 });
  await new Promise(r => setTimeout(r, 900));
  const rcSearch = await page.$eval('#rowCount', el => el.textContent.trim());
  check('pencarian filter "aw09" menyaring', /^[1-9][\d.]* \/ /.test(rcSearch), rcSearch);
  await page.evaluate(() => { const i = document.querySelector('#filterSearch'); i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true })); });
  await new Promise(r => setTimeout(r, 800));

  // tabel: pencarian teks + angka
  await page.click('#tabbtn-data');
  await new Promise(r => setTimeout(r, 400));
  await page.type('#tableSearch', 'SPC0195', { delay: 30 });
  await new Promise(r => setTimeout(r, 700));
  const rowsFound = await page.$$eval('#dataTableBody tr', trs => trs.length);
  const infoFound = await page.$eval('#pageInfo', el => el.textContent.trim()).catch(() => 'n/a');
  check('pencarian tabel "SPC0195" mengembalikan baris', rowsFound > 0 && rowsFound <= 15, rowsFound + ' baris | ' + infoFound);
  await page.evaluate(() => { const i = document.querySelector('#tableSearch'); i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true })); });
  await new Promise(r => setTimeout(r, 700));
  await page.type('#tableSearch', '2,05', { delay: 30 });
  await new Promise(r => setTimeout(r, 700));
  const rowsNum = await page.$$eval('#dataTableBody tr', trs => trs.length);
  check('pencarian tabel angka masih bekerja', rowsNum > 0, rowsNum + ' baris');
  await page.evaluate(() => { const i = document.querySelector('#tableSearch'); i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true })); });
  await new Promise(r => setTimeout(r, 700));

  // ---------- PAGINASI & SORT ----------
  const pageInfoBefore = await page.evaluate(() => (document.querySelector('#pageInfo') || {}).textContent);
  await page.evaluate(() => { const b = document.querySelector('#btnNextPage'); if (b) b.click(); });
  await new Promise(r => setTimeout(r, 400));
  const pageInfoAfter = await page.evaluate(() => (document.querySelector('#pageInfo') || {}).textContent);
  check('tombol next halaman bekerja', pageInfoBefore !== pageInfoAfter, (pageInfoBefore || '') + ' -> ' + (pageInfoAfter || ''));
  await page.evaluate(() => { const t = document.querySelector('th[data-sort]'); if (t) t.click(); });
  await new Promise(r => setTimeout(r, 400));
  const sortedRows = await page.$$eval('#dataTableBody tr', trs => trs.length);
  check('klik header sort tetap merender tabel', sortedRows > 0, sortedRows + ' baris');

  // ---------- GRANULARITAS & BIAYA ----------
  await page.click('#tabbtn-overview');
  await new Promise(r => setTimeout(r, 200));
  for (const g of ['weekly', 'monthly', 'daily']) {
    const t = Date.now();
    await page.click(`.gran-btn[data-gran="${g}"]`);
    await new Promise(r => setTimeout(r, 500));
    const pts = await page.evaluate(() => {
      const cv = document.querySelector('#chartSolar');
      const ch = cv && window.Chart && window.Chart.getChart(cv);
      return ch ? ch.data.datasets.reduce((a, d) => a + (d.data ? d.data.length : 0), 0) : -1;
    });
    check(`granularitas ${g} merender chart`, pts > 0, pts + ' titik (' + (Date.now() - t) + ' ms)');
  }
  await page.click('.gran-btn[data-gran="daily"]');
  await new Promise(r => setTimeout(r, 400));

  await page.click('#tabbtn-biaya');
  await new Promise(r => setTimeout(r, 700));
  const biayaTxt = await page.$eval('#tab-biaya', el => el.innerText);
  check('tab biaya menampilkan total biaya (Rp ... M)', /Rp\s?\d+,\d+\s?M/.test(biayaTxt.replace(/\n/g, ' ')), biayaTxt.split('\n').slice(0, 6).join(' | '));
  const biayaChart = await page.evaluate(() => {
    const cv = document.querySelector('#chartBiayaGran');
    return cv ? !!(window.Chart && window.Chart.getChart(cv)) : 'no-canvas';
  });
  check('chart biaya per granularitas ada', biayaChart === true, String(biayaChart));
  await page.screenshot({ path: `${OUT}/tab-biaya-detail.png` });

  // ---------- EXPORT CSV ----------
  await page.click('#tabbtn-data');
  await new Promise(r => setTimeout(r, 400));
  const exportTxt = await page.evaluate(() => {
    // panggil generator internal lewat tombol: tangkap blob
    return new Promise(resolve => {
      const origCreate = URL.createObjectURL;
      URL.createObjectURL = (blob) => { blob.text().then(t => resolve(t)); return origCreate.call(URL, blob); };
      document.querySelector('#btnExport').click();
      setTimeout(() => resolve('TIMEOUT'), 4000);
    });
  });
  const exportLines = String(exportTxt).split(/\r?\n/);
  check('export CSV: header + baris', /^Date,Wilayah,Lokasi/.test(exportLines[0]) && exportLines.length > 100, exportLines.length + ' baris, header: ' + exportLines[0].slice(0, 60));

  // ---------- SYNC MANUAL ----------
  const tSync = Date.now();
  await page.click('#btnSync');
  await new Promise(r => setTimeout(r, 400));
  const labelAfterSync = await page.$eval('#lastSync', el => el.textContent.trim());
  check('sync manual selesai & label berubah', /Sync .* records/.test(labelAfterSync), labelAfterSync + ' (' + (Date.now() - tSync) + ' ms)');

  // ---------- VISIT 2: cache-first ----------
  const cacheInfo = await page.evaluate(async () => {
    const names = await caches.keys();
    const c = await caches.open('pg2-data-v1');
    const keys = await c.keys();
    return { names, dataKeys: keys.map(k => k.url.replace(/^.*\/d\/[^/]+\//, '').slice(0, 60)) };
  });
  console.log('caches:', JSON.stringify(cacheInfo));
  check('payload tersimpan di Cache Storage', cacheInfo.dataKeys.length > 0, cacheInfo.dataKeys.join(' , '));

  // ---- KUNJUNGAN 2: halaman baru (cache sudah terisi) ----
  const page2 = await browser.newPage();
  await page2.setViewport({ width: 1366, height: 900, deviceScaleFactor: 1 });
  const t2 = Date.now();
  await page2.goto(URL, { waitUntil: 'domcontentloaded' });
  await page2.waitForFunction(() => {
    const rc = document.querySelector('#rowCount');
    return rc && /records/.test(rc.textContent) && !/^0 records/.test(rc.textContent.trim());
  }, { timeout: 60000 });
  const tReady2 = Date.now() - t2;
  console.log('tReady visit-2 (ms):', tReady2);
  check('kunjungan kedua siap dipakai (data tampil)', tReady2 < 6000, tReady1 + ' ms -> ' + tReady2 + ' ms');
  const rc2 = await page2.$eval('#rowCount', el => el.textContent.trim());
  check('data tetap lengkap setelah reload', parseInt(rc2.split('/')[1].replace(/\D/g, ''), 10) === TOTAL, rc2);

  // ---- MODE OFFLINE: data cache tetap tampil ----
  await page2.setOfflineMode(true);
  const t3 = Date.now();
  await page2.reload({ waitUntil: 'domcontentloaded' });
  const offlineOk = await page2.waitForFunction(() => {
    const rc = document.querySelector('#rowCount');
    return rc && /records/.test(rc.textContent) && !/^0 records/.test(rc.textContent.trim());
  }, { timeout: 45000 }).then(() => true).catch(() => false);
  const tOffline = Date.now() - t3;
  const rcOff = await page2.$eval('#rowCount', el => el.textContent.trim()).catch(() => 'n/a');
  check('offline: dashboard tetap terisi dari cache', offlineOk && /records/.test(rcOff) && !/^0 records/.test(rcOff), rcOff + ' (' + tOffline + ' ms)');
  await page2.setOfflineMode(false);

  // ---- FALLBACK: spreadsheet diblokir -> pakai data contoh lokal ----
  const page3 = await browser.newPage();
  await page3.setRequestInterception(true);
  page3.on('request', r => {
    if (r.url().includes('docs.google.com')) r.abort(); else r.continue();
  });
  const t4 = Date.now();
  await page3.goto(URL, { waitUntil: 'domcontentloaded' });
  const sampleOk = await page3.waitForFunction(() => {
    const rc = document.querySelector('#rowCount');
    return rc && /records/.test(rc.textContent) && !/^0 records/.test(rc.textContent.trim());
  }, { timeout: 60000 }).then(() => true).catch(() => false);
  const rcSample = await page3.$eval('#rowCount', el => el.textContent.trim()).catch(() => 'n/a');
  check('fallback data contoh saat spreadsheet gagal', sampleOk && /records/.test(rcSample), rcSample + ' (' + (Date.now() - t4) + ' ms)');
  await page3.screenshot({ path: `${OUT}/fallback-sample.png` });
  await page3.close();

  await page2.screenshot({ path: `${OUT}/reload.png` });
  await page.screenshot({ path: `${OUT}/reload.png` });

  // ---------- HYGIENE ----------
  const appErrors = consoleErrors.filter(e => !/favicon|ERR_|net::/i.test(e));
  console.log('\nlog app:', consoleDebug.slice(0, 12));
  console.log('\nconsole errors:', appErrors.length ? appErrors.slice(0, 10) : '(none)');
  console.log('console warnings:', consoleWarns.length ? consoleWarns.slice(0, 5) : '(none)');
  console.log('failed requests:', failedReqs.length ? failedReqs.slice(0, 6) : '(none)');
  check('tidak ada error runtime', appErrors.length === 0, appErrors.slice(0, 3).join(' ; '));

  const failed = results.filter(r => !r.ok);
  console.log('\n===== RINGKASAN: ' + (results.length - failed.length) + '/' + results.length + ' lulus =====');
  if (failed.length) failed.forEach(f => console.log('  GAGAL:', f.name, '::', f.extra));
  fs.writeFileSync(`${OUT}/results.json`, JSON.stringify({ url: URL, tReady1, tReady2, tabLat, results }, null, 2));
  await browser.close();
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
