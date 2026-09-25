// Uji tata letak panel filter: desktop sticky + laci mobile (tidak boleh tertutup header)
const puppeteer = require('/tmp/node/node_modules/puppeteer');
const CHROME = '/home/user/.cache/puppeteer/chrome/linux-131.0.6778.204/chrome-linux64/chrome';
const URL = process.argv[2] || 'http://localhost:8080/index.html';
const OUT = '/tmp/qa';
require('fs').mkdirSync(OUT, { recursive: true });
const results = [];
const check = (n, ok, extra = '') => { results.push({ n, ok: !!ok }); console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (extra ? '  :: ' + extra : '')); };
const ready = async (p) => p.waitForFunction(() => { const r = document.querySelector('#rowCount'); return r && /records/.test(r.textContent) && !/^0 records/.test(r.textContent.trim()); }, { timeout: 90000 });

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'shell', args: ['--no-sandbox', '--disable-dev-shm-usage'] });

  // ================= DESKTOP =================
  const d = await browser.newPage();
  await d.setViewport({ width: 1366, height: 900 });
  const dErr = [];
  d.on('pageerror', e => dErr.push(e.message));
  await d.goto(URL, { waitUntil: 'domcontentloaded' });
  await ready(d);
  await new Promise(r => setTimeout(r, 1800));

  const desk = await d.evaluate(() => {
    const h = document.querySelector('header').getBoundingClientRect();
    const aside = document.getElementById('filterPanel');
    const a = aside.getBoundingClientRect();
    const nav = document.querySelector('nav[aria-label="Navigasi tab dashboard"]').getBoundingClientRect();
    return {
      headerH: Math.round(h.height), headerBottom: Math.round(h.bottom),
      cssVar: getComputedStyle(document.documentElement).getPropertyValue('--header-h').trim(),
      asideTop: Math.round(a.top), asideVisible: a.width > 0 && a.height > 0,
      asideScrollable: aside.scrollHeight > a.height + 1,
      navTop: Math.round(nav.top)
    };
  });
  console.log('DESKTOP:', JSON.stringify(desk));
  check('desktop: --header-h terukur', /^\d+px$/.test(desk.cssVar) && parseInt(desk.cssVar) >= 64, desk.cssVar);
  check('desktop: panel filter terlihat', desk.asideVisible);
  check('desktop: panel filter mulai DI BAWAH header', desk.asideTop >= desk.headerBottom, 'panel top ' + desk.asideTop + ' vs header bottom ' + desk.headerBottom);
  check('desktop: tab bar mulai di bawah header', desk.navTop >= desk.headerBottom, 'nav ' + desk.navTop + ' vs ' + desk.headerBottom);

  // scroll jauh -> pastikan tidak ada yang tertutup header
  await d.evaluate(() => window.scrollTo(0, 1400));
  await new Promise(r => setTimeout(r, 700));
  const scrolled = await d.evaluate(() => {
    const h = document.querySelector('header').getBoundingClientRect();
    const a = document.getElementById('filterPanel').getBoundingClientRect();
    const nav = document.querySelector('nav[aria-label="Navigasi tab dashboard"]').getBoundingClientRect();
    const panel = document.getElementById('filterPanel');
    return {
      headerBottom: Math.round(h.bottom),
      asideTop: Math.round(a.top), asideBottom: Math.round(a.bottom),
      navTop: Math.round(nav.top), winH: window.innerHeight,
      panelFitsViewport: a.bottom <= window.innerHeight + 1
    };
  });
  console.log('DESKTOP scrolled:', JSON.stringify(scrolled));
  check('desktop (scroll): panel filter tidak tertutup header', scrolled.asideTop >= scrolled.headerBottom, scrolled.asideTop + ' >= ' + scrolled.headerBottom);
  check('desktop (scroll): tab bar tidak tertutup header', scrolled.navTop >= scrolled.headerBottom, scrolled.navTop + ' >= ' + scrolled.headerBottom);
  check('desktop (scroll): panel tidak lebih tinggi dari viewport', scrolled.panelFitsViewport);
  await d.screenshot({ path: `${OUT}/fix-desktop.png` });

  // klik tab -> halaman men-scroll supaya tab bar tepat di bawah header
  await d.evaluate(() => window.scrollTo(0, 0));
  await d.click('#tabbtn-biaya');
  await new Promise(r => setTimeout(r, 1400));
  const afterTab = await d.evaluate(() => {
    const h = document.querySelector('header').getBoundingClientRect();
    const nav = document.querySelector('nav[aria-label="Navigasi tab dashboard"]').getBoundingClientRect();
    return { navTop: Math.round(nav.top), headerBottom: Math.round(h.bottom) };
  });
  check('desktop: klik tab -> tab bar tepat di bawah header', afterTab.navTop >= afterTab.headerBottom - 2 && afterTab.navTop <= afterTab.headerBottom + 40, JSON.stringify(afterTab));
  await d.screenshot({ path: `${OUT}/fix-desktop-tab.png` });
  await d.close();

  // ================= MOBILE =================
  const m = await browser.newPage();
  await m.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const mErr = [];
  m.on('pageerror', e => mErr.push(e.message));
  await m.goto(URL, { waitUntil: 'domcontentloaded' });
  await ready(m);
  await new Promise(r => setTimeout(r, 1500));

  const beforeOpen = await m.evaluate(() => {
    const p = document.getElementById('filterPanel');
    const cs = getComputedStyle(p);
    return { visibility: cs.visibility, pointerEvents: cs.pointerEvents, inFlow: cs.position };
  });
  check('mobile: laci tertutup & tidak menghalangi', beforeOpen.visibility === 'hidden' && beforeOpen.pointerEvents === 'none', JSON.stringify(beforeOpen));

  await m.click('#btnFilters');
  await new Promise(r => setTimeout(r, 600));
  const mob = await m.evaluate(() => {
    const h = document.querySelector('header').getBoundingClientRect();
    const p = document.getElementById('filterPanel');
    const a = p.getBoundingClientRect();
    const cs = getComputedStyle(p);
    const head = p.querySelector('.filter-sheet-head').getBoundingClientRect();
    const body = p.querySelector('.filter-sheet-body');
    const firstCtl = document.getElementById('filterStart').getBoundingClientRect();
    const bd = document.getElementById('filterBackdrop');
    return {
      headerBottom: Math.round(h.bottom), headerH: Math.round(h.height),
      panelTop: Math.round(a.top), panelBottom: Math.round(a.bottom), panelZ: cs.zIndex,
      panelVisible: cs.visibility === 'visible',
      headVisible: head.height > 20, firstCtlTop: Math.round(firstCtl.top),
      bodyScrollable: body.scrollHeight > body.clientHeight + 1,
      backdropVisible: getComputedStyle(bd).visibility === 'visible',
      bodyLocked: document.body.classList.contains('filter-open'),
      ariaExpanded: document.getElementById('btnFilters').getAttribute('aria-expanded')
    };
  });
  console.log('MOBILE (laci terbuka):', JSON.stringify(mob));
  check('mobile: laci tepat mulai di bawah header', mob.panelTop >= mob.headerBottom - 1, mob.panelTop + ' >= ' + mob.headerBottom);
  check('mobile: judul laci terlihat (tidak tertutup)', mob.headVisible);
  check('mobile: kontrol pertama terlihat penuh', mob.firstCtlTop >= mob.panelTop, 'filterStart top ' + mob.firstCtlTop);
  check('mobile: laci bisa di-scroll', mob.bodyScrollable);
  check('mobile: backdrop tampil & body terkunci', mob.backdropVisible && mob.bodyLocked);
  check('mobile: aria-expanded=true', mob.ariaExpanded === 'true', String(mob.ariaExpanded));
  check('mobile: z-index laci di atas konten', parseInt(mob.panelZ) >= 60, mob.panelZ);
  await m.screenshot({ path: `${OUT}/fix-mobile-open.png` });

  // isi filter dari laci -> harus tetap bekerja
  await m.evaluate(() => {
    const s = document.getElementById('filterStart');
    s.value = '2026-09-01'; s.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await new Promise(r => setTimeout(r, 800));
  const rc = await m.$eval('#rowCount', el => el.textContent.trim());
  const [nShow, nAll] = rc.replace(/ records/, '').split(' / ').map(x => parseInt(x.replace(/\./g, ''), 10));
  check('mobile: filter di dalam laci berfungsi', nShow > 0 && nShow < nAll, rc);
  await m.screenshot({ path: `${OUT}/fix-mobile-filtered.png` });

  // tombol close
  await m.click('#btnCloseFilters');
  await new Promise(r => setTimeout(r, 600));
  const closed = await m.evaluate(() => {
    const p = document.getElementById('filterPanel');
    return {
      visible: getComputedStyle(p).visibility, locked: document.body.classList.contains('filter-open'),
      aria: document.getElementById('btnFilters').getAttribute('aria-expanded'),
      focused: document.activeElement && document.activeElement.id
    };
  });
  check('mobile: tombol X menutup laci', closed.visible === 'hidden' && !closed.locked, JSON.stringify(closed));
  check('mobile: fokus kembali ke tombol Filter', closed.focused === 'btnFilters', String(closed.focused));

  // Esc & backdrop
  await m.click('#btnFilters'); await new Promise(r => setTimeout(r, 400));
  await m.keyboard.press('Escape'); await new Promise(r => setTimeout(r, 500));
  const escClosed = await m.evaluate(() => getComputedStyle(document.getElementById('filterPanel')).visibility);
  check('mobile: Esc menutup laci', escClosed === 'hidden', escClosed);

  await m.click('#btnFilters'); await new Promise(r => setTimeout(r, 400));
  await m.evaluate(() => document.getElementById('filterBackdrop').click());
  await new Promise(r => setTimeout(r, 500));
  const bdClosed = await m.evaluate(() => getComputedStyle(document.getElementById('filterPanel')).visibility);
  check('mobile: klik backdrop menutup laci', bdClosed === 'hidden', bdClosed);
  await m.screenshot({ path: `${OUT}/fix-mobile-closed.png` });

  // tablet: 768
  await m.setViewport({ width: 768, height: 1024, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await new Promise(r => setTimeout(r, 800));
  await m.click('#btnFilters'); await new Promise(r => setTimeout(r, 600));
  const tab = await m.evaluate(() => {
    const h = document.querySelector('header').getBoundingClientRect();
    const a = document.getElementById('filterPanel').getBoundingClientRect();
    return { headerBottom: Math.round(h.bottom), panelTop: Math.round(a.top), panelW: Math.round(a.width), win: window.innerWidth };
  });
  check('tablet 768: laci penuh lebar & di bawah header', tab.panelTop >= tab.headerBottom - 1 && tab.panelW === tab.win, JSON.stringify(tab));
  await m.screenshot({ path: `${OUT}/fix-tablet-open.png` });
  await m.close();

  // ================= KEMBALI KE DESKTOP (resize) =================
  const r = await browser.newPage();
  await r.setViewport({ width: 390, height: 844 });
  await r.goto(URL, { waitUntil: 'domcontentloaded' });
  await ready(r);
  await new Promise(r => setTimeout(r, 1200));
  await r.click('#btnFilters'); await new Promise(r => setTimeout(r, 400));
  await r.setViewport({ width: 1366, height: 900 });
  await new Promise(r => setTimeout(r, 900));
  const resized = await r.evaluate(() => {
    const p = document.getElementById('filterPanel');
    const h = document.querySelector('header').getBoundingClientRect();
    const a = p.getBoundingClientRect();
    return { locked: document.body.classList.contains('filter-open'), isOpen: p.classList.contains('is-open'), top: Math.round(a.top), headerBottom: Math.round(h.bottom), visible: a.width > 0 };
  });
  check('resize ke desktop: laci tertutup & body tidak terkunci', !resized.locked && !resized.isOpen, JSON.stringify(resized));
  check('resize ke desktop: panel jadi kolom sticky di bawah header', resized.visible && resized.top >= resized.headerBottom, JSON.stringify(resized));

  console.log('\nerror desktop:', dErr.length ? dErr : '(none)', '| error mobile:', mErr.length ? mErr : '(none)');
  const failed = results.filter(x => !x.ok);
  console.log('\n===== ' + (results.length - failed.length) + '/' + results.length + ' lulus =====');
  failed.forEach(f => console.log('  GAGAL:', f.n));
  await browser.close();
  process.exit(failed.length ? 1 : 0);
})();
