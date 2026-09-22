// Tangkap kondisi mobile: tutup, terbuka, sticky desktop + cek tumpang tindih header
const puppeteer = require('/tmp/node/node_modules/puppeteer');
const CHROME = '/home/user/.cache/puppeteer/chrome/linux-131.0.6778.204/chrome-linux64/chrome';
const URL = process.argv[2] || 'http://localhost:8080/index.html';
const fs = require('fs'); fs.mkdirSync('/tmp/qa', { recursive: true });
const ready = (p) => p.waitForFunction(() => { const r = document.querySelector('#rowCount'); return r && /records/.test(r.textContent) && !/^0 records/.test(r.textContent.trim()); }, { timeout: 90000 });

(async () => {
  const b = await puppeteer.launch({ executablePath: CHROME, headless: 'shell', args: ['--no-sandbox'] });
  for (const [w, h, name] of [[390, 844, 'iphone'], [768, 1024, 'tablet'], [1366, 900, 'desktop'], [320, 720, 'narrow']]) {
    const p = await b.newPage();
    await p.setViewport({ width: w, height: h, isMobile: w < 1024, deviceScaleFactor: 2 });
    await p.goto(URL, { waitUntil: 'domcontentloaded' });
    await ready(p);
    await new Promise(r => setTimeout(r, 1200));
    // cek overlap elemen header satu sama lain
    const overlap = await p.evaluate(() => {
      const rects = (sel) => Array.from(document.querySelectorAll(sel)).map(e => ({ id: e.id || e.className.split(' ')[0], r: e.getBoundingClientRect() }));
      const els = rects('header h1, header #lastSync, header > div > div > div > div > span, header button, header a, header #headerTicker');
      const bad = [];
      for (let i = 0; i < els.length; i++) for (let j = i + 1; j < els.length; j++) {
        const a = els[i].r, c = els[j].r;
        const ox = Math.min(a.right, c.right) - Math.max(a.left, c.left);
        const oy = Math.min(a.bottom, c.bottom) - Math.max(a.top, c.top);
        const nested = els[i].r.contains ? (document.querySelector('header') && false) : false;
        if (ox > 2 && oy > 2 && a.width > 0 && c.width > 0 && !nested) {
          // cek apakah salah satu elemen adalah leluhur yang lain -> wajar
          const ei = document.querySelectorAll('header *')[i], ej = document.querySelectorAll('header *')[j];
          if (!(ei && ej && (ei.contains(ej) || ej.contains(ei)))) bad.push(els[i].id + ' ⨯ ' + els[j].id + ' (' + Math.round(ox) + 'x' + Math.round(oy) + ')');
        }
      }
      const hd = document.querySelector('header').getBoundingClientRect();
      const overflowing = [];
      document.querySelectorAll('header *').forEach(e => {
        const r = e.getBoundingClientRect();
        if (r.width && e.closest('.overflow-x-auto')) return;
        if (r.width && (r.right > hd.right + 1 || r.left < hd.left - 1)) overflowing.push((e.id || e.className.toString().split(' ')[0]) + ' keluar header');
      });
      return { bad, overflowing: [...new Set(overflowing)].slice(0, 6), headerH: Math.round(hd.height) };
    });
    console.log(name.padEnd(8), w + 'x' + h, '| header', overlap.headerH, 'px | tumpang tindih:', overlap.bad.length ? overlap.bad : 'tidak ada', '| keluar batas:', overlap.overflowing.length ? overlap.overflowing : 'tidak ada');
    await p.screenshot({ path: `/tmp/qa/fix-${name}-top.png` });
    if (w < 1024) {
      await p.click('#btnFilters');
      await new Promise(r => setTimeout(r, 700));
      await p.screenshot({ path: `/tmp/qa/fix-${name}-drawer.png` });
    }
    await p.close();
  }
  await b.close();
})();
