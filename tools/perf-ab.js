// A/B performa dengan pengukuran DI DALAM halaman (stabil, tanpa noise polling puppeteer)
// pakai: node /tmp/ab2.js <urlLama> <urlBaru> [putaran]
const puppeteer = require('/tmp/node/node_modules/puppeteer');
const U1 = process.argv[2] || 'http://localhost:8081/index.html';
const U2 = process.argv[3] || 'http://localhost:8080/index.html';
const ROUNDS = parseInt(process.argv[4] || '3', 10);
const CHROME = '/home/user/.cache/puppeteer/chrome/linux-131.0.6778.204/chrome-linux64/chrome';

const PROBE = () => {
  window.__probe = { tDom: null, tKpi: null, payload: null, tabSwitches: [] };
  // waktu KPI pertama terisi
  const mo = new MutationObserver(() => {
    const g = document.getElementById('kpiGrid');
    if (!window.__probe.tKpi && g && g.innerHTML.trim().length > 50) window.__probe.tKpi = performance.now();
  });
  window.__probe.tKpi = null;
  const attach = () => {
    const rc = document.getElementById('rowCount');
    if (!rc) return setTimeout(attach, 20);
    const hit = () => { if (!window.__probe.tKpi && /records/.test(rc.textContent) && !/^0 records/.test(rc.textContent.trim())) window.__probe.tKpi = performance.now(); };
    hit();
    if (!window.__probe.tKpi) mo.observe(rc, { childList: true, characterData: true, subtree: true, attributes: true });
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { window.__probe.tDom = performance.now(); attach(); });
  } else { window.__probe.tDom = performance.now(); attach(); }
  window.__measureLoad = () => {
    const res = performance.getEntriesByType('resource').filter(r => r.name.includes('docs.google.com'));
    const total = res.reduce((a, r) => a + (r.encodedBodySize || 0), 0);
    const dur = Math.max.apply(null, res.map(r => r.duration).concat([0]));
    return { payloadBytes: total, payloadMs: Math.round(dur), requests: res.length };
  };
  window.__measureTab = (tab, n = 3) => new Promise(resolve => {
    const lat = [];
    const go = (i) => {
      if (i >= n) return resolve(lat);
      const t0 = performance.now();
      document.querySelector('.tab-btn[data-tab="' + tab + '"]').click();
      requestAnimationFrame(() => requestAnimationFrame(() => { lat.push(performance.now() - t0); go(i + 1); }));
    };
    go(0);
  });
  window.__measureSearch = (sel, text) => new Promise(resolve => {
    const el = document.querySelector(sel);
    const t0 = performance.now();
    el.value = text;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    const check = () => {
      const rc = document.getElementById('rowCount').textContent;
      if (/\d/.test(rc)) return resolve({ ms: performance.now() - t0, rowCount: rc });
      requestAnimationFrame(check);
    };
    setTimeout(check, 500);
  });
  window.__measureFilter = (sel, val) => new Promise(resolve => {
    const el = document.querySelector(sel);
    const t0 = performance.now();
    el.value = val; el.dispatchEvent(new Event('change', { bubbles: true }));
    requestAnimationFrame(() => requestAnimationFrame(() => resolve(performance.now() - t0)));
  });
};

async function runOnce(browser, url, throttle = 4) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1366, height: 900 });
  const client = await page.createCDPSession();
  await client.send('Emulation.setCPUThrottlingRate', { rate: throttle });
  await client.send('Performance.enable').catch(() => {});
  await page.evaluateOnNewDocument(PROBE);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => window.__probe && window.__probe.tKpi, { timeout: 120000 });

  // tab dingin: langsung setelah data siap (sebelum prefetch idle jalan)
  const cold = await page.evaluate(async () => {
    const t0 = performance.now();
    document.querySelector('.tab-btn[data-tab="wilayah"]').click();
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    return Math.round(performance.now() - t0);
  });
  await new Promise(r => setTimeout(r, 3000)); // biarkan idle prefetch & chart settle

  const out = await page.evaluate(async (coldMs) => {
    const p = window.__probe;
    const loadInfo = window.__measureLoad();
    const tabLat = await window.__measureTab('wilayah', 3);
    const tabLat2 = await window.__measureTab('data', 2);
    const search = await window.__measureSearch('#tableSearch', 'SPC0195');
    await new Promise(r => setTimeout(r, 1200));
    const searchClear = await window.__measureSearch('#tableSearch', '');
    await new Promise(r => setTimeout(r, 1200));
    const month = await window.__measureFilter('#filterStart', '2026-08-01');
    await new Promise(r => setTimeout(r, 1500));
    const mem = performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null;
    return {
      tDom: Math.round(p.tDom), tKpi: Math.round(p.tKpi), tabCold: coldMs,
      payloadBytes: loadInfo.payloadBytes, payloadMs: loadInfo.payloadMs, payloadReq: loadInfo.requests,
      tabWilayah: Math.round(tabLat.reduce((a, b) => a + b, 0) / tabLat.length),
      tabData: Math.round(tabLat2.reduce((a, b) => a + b, 0) / tabLat2.length),
      searchMs: Math.round(search.ms), searchChanged: search.rowCount,
      searchClearMs: Math.round(searchClear.ms),
      filterMs: Math.round(month),
      heapMB: mem
    };
  }, cold);
  await page.close();
  return out;
}

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'shell', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const rows = { lama: [], baru: [] };
  for (let i = 1; i <= ROUNDS; i++) {
    const a = await runOnce(browser, U1);
    const b = await runOnce(browser, U2);
    rows.lama.push(a); rows.baru.push(b);
    console.log(`putaran ${i}`);
    console.log('  LAMA:', JSON.stringify(a));
    console.log('  BARU:', JSON.stringify(b));
  }
  const med = (arr, k) => { const v = arr.map(o => o[k]).filter(x => typeof x === 'number').sort((x, y) => x - y); return v.length ? v[Math.floor(v.length / 2)] : null; };
  const keys = ['tDom', 'tKpi', 'tabCold', 'payloadMs', 'tabWilayah', 'tabData', 'searchMs', 'filterMs', 'heapMB'];
  console.log('\n===== MEDIAN (' + ROUNDS + ' putaran, throttling 4x) =====');
  console.log('metrik'.padEnd(14), 'LAMA'.padStart(10), 'BARU'.padStart(10), 'perubahan'.padStart(12));
  keys.forEach(k => {
    const a = med(rows.lama, k), b = med(rows.baru, k);
    const pct = (a && b) ? (((b - a) / a) * 100).toFixed(1) + '%' : '-';
    console.log(k.padEnd(14), String(a).padStart(10), String(b).padStart(10), pct.padStart(12));
  });
  await browser.close();
})();
