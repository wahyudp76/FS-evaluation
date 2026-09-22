// Uji stabilitas: interaksi cepat berulang, cek error & kebocoran memori
// pakai: node /tmp/stress.js <url>
const puppeteer = require('/tmp/node/node_modules/puppeteer');
const URL = process.argv[2] || 'http://localhost:8080/index.html';
const CHROME = '/home/user/.cache/puppeteer/chrome/linux-131.0.6778.204/chrome-linux64/chrome';

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'shell', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1366, height: 900 });
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => {
    const rc = document.querySelector('#rowCount');
    return rc && /records/.test(rc.textContent) && !/^0 records/.test(rc.textContent.trim());
  }, { timeout: 90000 });
  await new Promise(r => setTimeout(r, 2500));

  const readHeap = () => page.evaluate(() => performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576 * 10) / 10 : null);
  const rowCount = () => page.$eval('#rowCount', el => el.textContent.trim());

  console.log('heap awal:', await readHeap(), 'MB | rowCount:', await rowCount());

  // 1) klik semua tab bolak-balik 5x dengan cepat
  const tabs = ['overview', 'wilayah', 'biaya', 'utilisasi', 'data'];
  for (let round = 0; round < 5; round++) {
    for (const t of tabs) { await page.click(`#tabbtn-${t}`); await new Promise(r => setTimeout(r, 120)); }
  }
  console.log('setelah 25 klik tab cepat: heap', await readHeap(), 'MB | errors:', errors.length);

  // 2) ubah filter berturut-turut tanpa jeda
  for (let i = 0; i < 25; i++) {
    await page.evaluate((n) => {
      const s = document.querySelector('#filterStart');
      s.value = n % 2 ? '2026-08-01' : '2026-05-29';
      s.dispatchEvent(new Event('change', { bubbles: true }));
    }, i);
    await new Promise(r => setTimeout(r, 90));
  }
  console.log('setelah 25 perubahan tanggal: rowCount', await rowCount(), '| heap', await readHeap(), 'MB | errors:', errors.length);

  // 3) ketik cepat di kedua kotak pencarian
  await page.click('#tabbtn-data');
  await new Promise(r => setTimeout(r, 300));
  for (const q of ['aw', 'aw0', 'aw08', 'spc', 'spc0', 'iti']) {
    await page.evaluate((v) => {
      const el = document.querySelector('#tableSearch');
      el.value = v; el.dispatchEvent(new Event('input', { bubbles: true }));
    }, q);
    await new Promise(r => setTimeout(r, 150));
  }
  await page.evaluate(() => {
    const el = document.querySelector('#filterSearch');
    el.value = 'aw11'; el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await new Promise(r => setTimeout(r, 900));
  console.log('setelah pengetikan cepat: rowCount', await rowCount(), '| heap', await readHeap(), 'MB | errors:', errors.length);

  // 4) ganti granularitas & metrik wilayah berulang
  for (let i = 0; i < 6; i++) {
    await page.click('#tabbtn-overview'); await new Promise(r => setTimeout(r, 100));
    for (const g of ['weekly', 'monthly', 'daily']) { await page.click(`.gran-btn[data-gran="${g}"]`); await new Promise(r => setTimeout(r, 80)); }
  }
  await page.click('#btnClearFilters');
  await new Promise(r => setTimeout(r, 900));
  console.log('setelah 18 ganti granularitas + reset: rowCount', await rowCount(), '| heap', await readHeap(), 'MB | errors:', errors.length);

  // 5) sync manual & dua kali cepat
  await page.click('#btnSync');
  await page.click('#btnSync');
  await new Promise(r => setTimeout(r, 4000));
  console.log('setelah 2x sync cepat: label', await page.$eval('#lastSync', el => el.textContent.trim()), '| heap', await readHeap(), 'MB');

  // 6) ukur kebocoran: 3 putaran filter lagi, catat heap
  const heaps = [];
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => { const s = document.querySelector('#filterStart'); s.value = '2026-09-01'; s.dispatchEvent(new Event('change', { bubbles: true })); });
    await new Promise(r => setTimeout(r, 500));
    await page.click('#btnRangeAll');
    await new Promise(r => setTimeout(r, 700));
    if (global.gc) await page.evaluate(() => {}).catch(() => {});
    heaps.push(await readHeap());
  }
  console.log('heap 3 putaran terakhir:', heaps.join(' -> '), 'MB');

  const final = { errors: errors.slice(0, 8), errorCount: errors.length, heaps };
  console.log('\nerror akhir:', final.errorCount ? final.errors : '(tidak ada)');
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})();
