// PG2 Irrigation Evaluation Dashboard - ZPAS637
// Auto-sync to Google Sheets ID: 1mhXxr7cfdnS-A_gJ6E4aixGRSzINdGP94orr-2lL45o
// Updated: Luas Cek column removed (now 34 cols), dynamic label-based parsing
const SPREADSHEET_ID = '1mhXxr7cfdnS-A_gJ6E4aixGRSzINdGP94orr-2lL45o';
const SHEET_NAME = 'ZPAS637';
const GVIZ_BASE = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq`;
// CSV = sumber data utama (payload ~46% lebih kecil dari JSON gviz)
const CSV_URL = `${GVIZ_BASE}?tqx=out:csv&sheet=${SHEET_NAME}`;
// Query kecil khusus kolom tanggal: hanya ~3 KB terkompresi, memberi tanggal + tahun yang akurat
const DATES_URL = `${GVIZ_BASE}?tq=${encodeURIComponent('select A')}&tqx=out:json&sheet=${SHEET_NAME}`;
// JSON penuh dipakai hanya sebagai fallback bila CSV bermasalah
const GVIZ_URL = `${GVIZ_BASE}?tqx=out:json&sheet=${SHEET_NAME}`;
const SAMPLE_URL = './assets/sample-data.csv';
const DATA_CACHE = 'pg2-data-v1';
const META_KEY = 'pg2-meta-v1';
const AUTO_SYNC_MS = 5 * 60 * 1000;
const REQ_TIMEOUT_MS = 25000;

// State
let rawData = [];
let filteredData = [];
let charts = {};
let granularity = 'daily';
let sortField = 'date';
let sortDir = 'desc';
let currentPage = 1;
let pageSize = 15;
let wilayahMetric = 'luas'; // metric for wilayah chart
let wilayahSort = 'totalLuas';
let biayaGran = 'monthly'; // granularity for biaya period table
let biayaSort = 'totalBiaya'; // sort for biaya wilayah table
let currentTab = 'overview'; // active tab
const TAB_IDS = ['overview','wilayah','biaya','utilisasi','data'];
// --- performa & stabilitas ---
let dataVersion = 0;                 // naik setiap filteredData berubah -> invalidasi memo
const memoStore = new Map();
let dirtyTabs = new Set(TAB_IDS);    // tab yang perlu render ulang
let lastMeta = null;                 // {sig, ts, rows}
let syncTimer = null, syncFailures = 0, isSyncing = false;
let dataSource = 'live';             // live | cache | sample
let filtersUIReady = false;
let appliedSig = null;                // sidik jari payload yang sedang tampil (hindari render ganda)
let wasOffline = false;               // agar event 'online' bawaan browser tidak memicu sync ganda
let filters = {
  start: null,
  end: null,
  wilayah: new Set(),
  months: new Set(),
  year: 'all',
  jenisEngine: 'all',
  search: '',
  tableSearch: ''
};

// DOM helpers
const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

// Utilities
function parseGvizDate(v) {
  if (!v) return null;
  if (v instanceof Date) return v;
  if (typeof v === 'string') {
    const m = v.match(/Date\((\d+),(\d+),(\d+)(?:,(\d+),(\d+),(\d+))?\)/);
    if (m) {
      const y = parseInt(m[1]), mo = parseInt(m[2]), d = parseInt(m[3]);
      const h = m[4] ? parseInt(m[4]) : 0;
      const mi = m[5] ? parseInt(m[5]) : 0;
      const se = m[6] ? parseInt(m[6]) : 0;
      return new Date(y, mo, d, h, mi, se);
    }
    return new Date(v);
  }
  return null;
}
// Intl.NumberFormat mahal (~0,1 ms per instansiasi). Simpan per jumlah desimal.
const _nfCache = new Map();
function _nf(decimals) {
  let f = _nfCache.get(decimals);
  if (!f) { f = new Intl.NumberFormat('id-ID', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }); _nfCache.set(decimals, f); }
  return f;
}
const _nfIntFmt = new Intl.NumberFormat('id-ID');
function formatNumber(n, decimals = 2) {
  if (n == null || isNaN(n)) return '-';
  return _nf(decimals).format(n);
}
function formatInt(n) {
  if (n == null || isNaN(n)) return '-';
  return _nfIntFmt.format(Math.round(n));
}
// Debounce untuk input pencarian agar tidak re-render tiap ketikan
function debounce(fn, wait = 220) {
  let t = null;
  return function (...args) {
    if (t) clearTimeout(t);
    t = setTimeout(() => { t = null; fn.apply(this, args); }, wait);
  };
}
// Escape nilai dari spreadsheet sebelum dimasukkan ke innerHTML
const _escMap = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
function esc(v) {
  if (v === null || v === undefined) return '';
  return String(v).replace(/[&<>"']/g, c => _escMap[c]);
}
// ===== Offset header & panel filter =====
// Tinggi header diukur runtime (bisa berubah: ticker, tombol install, zoom, font) lalu
// dibagikan ke CSS lewat --header-h supaya panel filter & tab bar tidak pernah tertutup header.
function headerHeight() {
  const h = document.querySelector('header');
  const v = h ? h.getBoundingClientRect().height : 112;
  return Math.max(64, Math.round(v));
}
function syncHeaderOffset() {
  const h = headerHeight();
  document.documentElement.style.setProperty('--header-h', h + 'px');
  return h;
}
const MOBILE_FILTER_MQ = window.matchMedia ? window.matchMedia('(max-width: 1023.98px)') : null;
function filtersAreMobile() { return MOBILE_FILTER_MQ ? MOBILE_FILTER_MQ.matches : window.innerWidth < 1024; }
function filtersOpen() { const p = document.getElementById('filterPanel'); return !!(p && p.classList.contains('is-open')); }
function openFilters() {
  const panel = document.getElementById('filterPanel');
  if (!panel) return;
  syncHeaderOffset();
  panel.classList.add('is-open');
  const bd = document.getElementById('filterBackdrop'); if (bd) bd.classList.add('is-open');
  document.body.classList.add('filter-open');
  const btn = document.getElementById('btnFilters'); if (btn) btn.setAttribute('aria-expanded', 'true');
  const body = panel.querySelector('.filter-sheet-body'); if (body) body.scrollTop = 0;
  const close = document.getElementById('btnCloseFilters'); if (close) close.focus({ preventScroll: true });
  refreshIcons();
}
function closeFilters(restoreFocus = true) {
  const panel = document.getElementById('filterPanel');
  if (!panel || !panel.classList.contains('is-open')) return;
  panel.classList.remove('is-open');
  const bd = document.getElementById('filterBackdrop'); if (bd) bd.classList.remove('is-open');
  document.body.classList.remove('filter-open');
  const btn = document.getElementById('btnFilters');
  if (btn) {
    btn.setAttribute('aria-expanded', 'false');
    if (restoreFocus && filtersAreMobile()) btn.focus({ preventScroll: true });
  }
}
function toggleFilters() { filtersOpen() ? closeFilters() : openFilters(); }

// Ikon: panggil sekali per frame (dulu bisa 3-4x dalam satu alur render)
let _iconHandle = null;
function refreshIcons() {
  if (!window.lucide) return;
  if (_iconHandle !== null) return;
  const raf = window.requestAnimationFrame || function (cb) { return setTimeout(cb, 16); };
  _iconHandle = raf(() => {
    _iconHandle = null;
    try { window.lucide.createIcons(); } catch (e) {}
  });
}
// Bungkus render agar satu error tidak mematikan seluruh dashboard
function safeRender(name, fn) {
  try { return fn(); } catch (e) { console.error('[render:' + name + ']', e); }
}
// requestIdleCallback dengan fallback
const idle = window.requestIdleCallback || function (cb) { return setTimeout(() => cb({ timeRemaining: () => 0 }), 1); };
// Tanggal lokal dari string 'YYYY-MM-DD' (hindari pergeseran zona waktu UTC)
function parseLocalDate(str) {
  if (!str) return null;
  const [y, m, d] = String(str).split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}
function formatDate(d) {
  if (!d) return '-';
  return d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
}
function formatDateISO(d) {
  if (!d) return '';
  const y = d.getFullYear(), m = String(d.getMonth()+1).padStart(2,'0'), day = String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
}
function getWeekNumber(d) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(),0,1));
  const weekNo = Math.ceil((((date - yearStart) / 86400000) + 1)/7);
  return [date.getUTCFullYear(), weekNo];
}
function getWeekLabel(d) {
  const [y,w] = getWeekNumber(d);
  return `${y}-W${String(w).padStart(2,'0')}`;
}
function getMonthLabel(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
}

// ============================================================
// LAPISAN DATA
// - CSV sebagai sumber utama (lebih ringan dari JSON gviz)
// - Query kecil khusus kolom tanggal untuk tahun yang akurat
// - Cache Storage: muat instan saat kunjungan berikutnya
// ============================================================

// CSV parser satu lintasan (RFC4180: kutip ganda + escape "")
function parseCSVFast(text) {
  const rows = [];
  let field = '', row = [], inQ = false;
  const n = text.length;
  for (let i = 0; i < n; i++) {
    const c = text.charCodeAt(i);
    if (inQ) {
      if (c === 34) {                       // '"'
        if (text.charCodeAt(i + 1) === 34) { field += '"'; i++; }
        else inQ = false;
      } else field += text[i];
      continue;
    }
    if (c === 34) { inQ = true; continue; }
    if (c === 44) { row.push(field); field = ''; continue; }   // ','
    if (c === 13) continue;                                    // CR
    if (c === 10) { row.push(field); rows.push(row); row = []; field = ''; continue; }
    field += text[i];
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

// Angka gaya id-ID: "Rp2.332.240" -> 2332240 ; "2,05" -> 2.05 ; "1.234,5" -> 1234.5
// Dibuat manual (tanpa regex/replace/parseFloat) karena dipanggil >400.000x saat load.
function toNumFast(v) {
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number') return v;
  const n = v.length;
  if (n === 0) return 0;
  let i = 0;
  // lewati awalan "Rp"
  if (v.charCodeAt(0) === 82 /* R */ && v.charCodeAt(1) === 112 /* p */) i = 2;
  let sign = 1;
  let c = v.charCodeAt(i);
  if (c === 45) { sign = -1; i++; }        // '-'
  else if (c === 43) { i++; }              // '+'
  let int = 0, frac = 0, scale = 0, sawDigit = false, sawDec = false;
  for (; i < n; i++) {
    c = v.charCodeAt(i);
    if (c >= 48 && c <= 57) {
      sawDigit = true;
      const dgt = c - 48;
      if (sawDec) { scale++; frac = frac + dgt / Math.pow(10, scale); }
      else int = int * 10 + dgt;
    } else if (c === 44) {                 // ',' = pemisah desimal (id-ID)
      if (!sawDec) sawDec = true;
    } else if (c === 46) {                 // '.' = pemisah ribuan -> diabaikan
      continue;
    } else if (c === 32) {                 // spasi -> diabaikan
      continue;
    } else {
      // karakter lain (mis. '%', 'Ha') -> berhenti membaca angka
      break;
    }
  }
  if (!sawDigit) return 0;
  return sign * (int + frac);
}

// Tanggal dari query kolom A: "Date(2026,4,29)"
function parseDatesJSON(text) {
  const m = text.match(/setResponse\(([\s\S]+)\)/);
  if (!m) return null;
  const j = JSON.parse(m[1]);
  const out = new Array(j.table.rows.length);
  const rows = j.table.rows;
  for (let i = 0; i < rows.length; i++) {
    const c = rows[i].c && rows[i].c[0];
    out[i] = c && c.v ? parseGvizDate(c.v) : null;
  }
  return out;
}

// Tanggal cadangan bila kolom A tidak tersedia: "29-Mei" (tanpa tahun)
const _months = { 'Jan':0,'Feb':1,'Mar':2,'Apr':3,'Mei':4,'Jun':5,'Jul':6,'Ags':7,'Agu':7,'Sep':8,'Okt':9,'Nov':10,'Des':11,
                  'Januari':0,'Februari':1,'Maret':2,'April':3,'Juni':5,'Juli':6,'Agustus':7,'September':8,'Oktober':9,'November':10,'Desember':11 };
function parseShortDate(str, fallbackYear) {
  if (!str) return null;
  const p = String(str).split('-');
  if (p.length >= 2) {
    const d = parseInt(p[0], 10);
    const mon = _months[p[1]] !== undefined ? _months[p[1]] : _months[String(p[1]).substring(0, 3)];
    if (!isNaN(d) && mon !== undefined) return new Date(fallbackYear, mon, d);
  }
  const dt = new Date(str);
  return isNaN(dt) ? null : dt;
}

// Susun objek baris dari CSV + overlay tanggal akurat
function buildRows(csvText, datesText) {
  const t0 = performance.now();
  const rows = parseCSVFast(csvText);
  if (rows.length < 2) throw new Error('CSV kosong / format tidak dikenal');
  const header = rows[0].map(h => h.trim());
  const idx = {};
  for (let i = 0; i < header.length; i++) idx[header[i]] = i;
  const need = (label) => { if (idx[label] === undefined) console.warn('Kolom tidak ditemukan:', label); };

  // tahun cadangan dari data tanggal yang sudah ada (agar filter tahun tetap waras)
  let fallbackYear = 2026;
  try { const y = localStorage.getItem('pg2-year'); if (y) fallbackYear = parseInt(y, 10) || 2026; } catch (e) {}

  let dates = null;
  if (datesText) { try { dates = parseDatesJSON(datesText); } catch (e) { console.warn('parse tanggal gagal', e); } }
  if (dates && dates.length !== rows.length - 1) {
    console.warn('Jumlah baris tanggal (' + dates.length + ') tidak sama dengan CSV (' + (rows.length - 1) + ') -> pakai tanggal CSV');
    dates = null;
  }

  const I = (label) => idx[label];
  const cDate = I('Date'), cWil = I('Wilayah'), cLok = I('Lokasi'), cEng = I('Engine'), cIri = I('Irigator'),
        cJIri = I('Jenis Irigator'), cPlan = I('Plan Time'), cLuas = I('Luas Siram'), cKec = I('Kecepatan Rata-rata'),
        cTebal = I('Tebal Siram'), cPrep = I('Prepare Time'), cOper = I('Operating Time'), cWait = I('Waiting Time'),
        cRep = I('Repair'), cDown = I('Down Time'), cStand = I('Standby'), cOff = I('Off Time'), cTotOper = I('Tot. Oper. Time'),
        cTotAvail = I('Total Avail'), cTotTime = I('Total Time'), cAvail = I('% Availability'), cUtil = I('% Utilization'),
        cAir = I('Air'), cSolar = I('Solar Terpakai (ltr)'), cBSolar = I('Biaya Solar (Std)'), cBUpah = I('Biaya Upah'),
        cBAlat = I('Biaya Alat'), cBTotal = I('Biaya Total'), cRpHa = I('Rp/Ha'), cHaHari = I('Ha/Hari'),
        cHaJam = I('Ha/Jam'), cSolarJam = I('Solar Ltr/jam'), cSolarHa = I('Solar Ltr/Ha'), cJEng = I('Jenis Engine');
  need('Date'); need('Wilayah'); need('Luas Siram'); need('Biaya Total');

  const out = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row.length < 3) continue;
    const rawDate = cDate !== undefined ? row[cDate] : '';
    const date = (dates && dates[r - 1]) || parseShortDate(rawDate, fallbackYear);
    if (!date || isNaN(date)) continue;
    const g = (i) => (i === undefined || i < 0 || row[i] === undefined ? '' : row[i]);
    const num = (i) => (i === undefined || i < 0 ? 0 : toNumFast(row[i]));
    const wilayah = g(cWil).trim(), engine = g(cEng).trim(), irigator = g(cIri).trim(), lokasi = g(cLok).trim();
    const yr = date.getFullYear(), mo = date.getMonth();
    const d = {
      date,
      dateLabel: rawDate,
      wilayah, lokasi, engine, irigator,
      jenisIrigator: g(cJIri).trim(),
      planTime: num(cPlan), luasSiram: num(cLuas), luasCek: 0,
      kecepatan: num(cKec), tebalSiram: num(cTebal),
      prepareTime: num(cPrep), operatingTime: num(cOper), waitingTime: num(cWait),
      repair: num(cRep), downTime: num(cDown), standby: num(cStand), offTime: num(cOff),
      totOperTime: num(cTotOper), totalAvail: num(cTotAvail), totalTime: num(cTotTime),
      availability: num(cAvail), utilization: num(cUtil), air: num(cAir),
      solarTerpakai: num(cSolar),
      biayaSolar: num(cBSolar), biayaUpah: num(cBUpah), biayaAlat: num(cBAlat), biayaTotal: num(cBTotal),
      rpPerHa: num(cRpHa), haPerHari: num(cHaHari), haPerJam: num(cHaJam),
      solarPerJam: num(cSolarJam), solarPerHa: num(cSolarHa),
      jenisEngine: g(cJEng).trim(),
      _y: yr, _m: mo,
      _s: ''   // indeks pencarian, diisi di bawah
    };
    d._s = (lokasi + ' ' + engine + ' ' + irigator + ' ' + wilayah + ' ' + d.jenisIrigator + ' ' + d.jenisEngine + ' ' +
            formatDateISO(date) + ' ' + rawDate).toLowerCase();
    out.push(d);
  }

  if (out.length) {
    try { localStorage.setItem('pg2-year', String(out[out.length - 1]._y)); } catch (e) {}
  }
  console.debug('[data] CSV', rows.length - 1, 'baris ->', out.length, 'dipakai dalam', Math.round(performance.now() - t0), 'ms');
  return out;
}

// Parser JSON gviz penuh (fallback) - satu lintasan, tanpa closure per baris
function parseGvizJSON(text) {
  const m = text.match(/setResponse\(([\s\S]+)\)/);
  if (!m) throw new Error('Respons gviz tidak valid');
  const data = JSON.parse(m[1]);
  const cols = data.table.cols.map(c => c.label);
  const idx = {};
  for (let i = 0; i < cols.length; i++) idx[cols[i]] = i;
  const rows = data.table.rows;
  const out = [];
  for (let r = 0; r < rows.length; r++) {
    const c = rows[r].c; if (!c) continue;
    const val = (label) => { const i = idx[label]; return i === undefined || !c[i] ? null : c[i].v; };
    const str = (label) => { const v = val(label); return v ? String(v).trim() : ''; };
    const num = (label) => { const n = Number(val(label)); return isNaN(n) ? 0 : n; };
    const date = parseGvizDate(val('Date')) || parseGvizDate(c[idx['Date']] && c[idx['Date']].f);
    if (!date || isNaN(date)) continue;
    const d = {
      date, dateLabel: '',
      wilayah: str('Wilayah'), lokasi: str('Lokasi'), engine: str('Engine'), irigator: str('Irigator'),
      jenisIrigator: str('Jenis Irigator'),
      planTime: num('Plan Time'), luasSiram: num('Luas Siram'),
      luasCek: idx['Luas Cek'] !== undefined ? num('Luas Cek') : 0,
      kecepatan: num('Kecepatan Rata-rata'), tebalSiram: num('Tebal Siram'),
      prepareTime: num('Prepare Time'), operatingTime: num('Operating Time'), waitingTime: num('Waiting Time'),
      repair: num('Repair'), downTime: num('Down Time'), standby: num('Standby'), offTime: num('Off Time'),
      totOperTime: num('Tot. Oper. Time'), totalAvail: num('Total Avail'), totalTime: num('Total Time'),
      availability: num('% Availability'), utilization: num('% Utilization'), air: num('Air'),
      solarTerpakai: num('Solar Terpakai (ltr)'),
      biayaSolar: num('Biaya Solar (Std)'), biayaUpah: num('Biaya Upah'), biayaAlat: num('Biaya Alat'),
      biayaTotal: num('Biaya Total'), rpPerHa: num('Rp/Ha'), haPerHari: num('Ha/Hari'), haPerJam: num('Ha/Jam'),
      solarPerJam: num('Solar Ltr/jam'), solarPerHa: num('Solar Ltr/Ha'), jenisEngine: str('Jenis Engine'),
      _y: date.getFullYear(), _m: date.getMonth(), _s: ''
    };
    d._s = (d.lokasi + ' ' + d.engine + ' ' + d.irigator + ' ' + d.wilayah + ' ' +
            formatDateISO(date) + ' ' + str('Date')).toLowerCase();
    out.push(d);
  }
  return out;
}

// Batas waktu untuk janji fetch (supaya unduhan awal yang menggantung tidak memblokir dashboard)
function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout ' + (label || ''))), ms))
  ]);
}

// --- fetch dengan timeout + retry ---
async function fetchText(url, timeoutMs = REQ_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.text();
  } finally { clearTimeout(tid); }
}

// --- Cache Storage untuk payload mentah (muat instan di kunjungan berikutnya) ---
async function cacheGet(key) {
  try { const c = await caches.open(DATA_CACHE); const r = await c.match(key); return r ? await r.text() : null; } catch (e) { return null; }
}
async function cachePut(key, text) {
  if (!text) return;
  try {
    const c = await caches.open(DATA_CACHE);
    await c.put(new Request(key), new Response(text, { headers: { 'content-type': 'text/plain' } }));
  } catch (e) { console.debug('[cache] gagal simpan', e && e.message); }
}
function readMeta() {
  try { const m = JSON.parse(localStorage.getItem(META_KEY) || 'null'); return (m && m.sig) ? m : null; } catch (e) { return null; }
}
function writeMeta(meta) { try { localStorage.setItem(META_KEY, JSON.stringify(meta)); } catch (e) {} }
// Sidik jari ringan: panjang + sampel karakter (cukup untuk mendeteksi perubahan isi)
function fingerprint(text) {
  let h = 2166136261;
  const step = Math.max(1, Math.floor(text.length / 2048));
  for (let i = 0; i < text.length; i += step) { h ^= text.charCodeAt(i); h = (h * 16777619) >>> 0; }
  return text.length + ':' + h.toString(36);
}

// Ambil payload (CSV + tanggal) - CSV utama, JSON penuh bila gagal
async function fetchPayload({ preferCache = false } = {}) {
  if (preferCache) {
    const [csv, dates] = await Promise.all([cacheGet(CSV_URL), cacheGet(DATES_URL)]);
    if (csv && csv.length > 1000) {
      const meta = readMeta();
      return { csv, dates, sig: meta ? meta.sig : fingerprint(csv), ts: meta ? meta.ts : Date.now(), fromCache: true };
    }
  }
  // paralel: CSV (sumber utama) + kolom tanggal (~3 KB).
  // Kalau index.html sudah memulai unduhan lebih awal, hasilnya dipakai ulang di sini.
  let csv = null, dates = null;
  const earlyCsv = window.__pgCsvEarly, earlyDates = window.__pgDatesEarly;
  if (earlyCsv || earlyDates) {
    const [c, d] = await Promise.all([
      earlyCsv ? withTimeout(earlyCsv, REQ_TIMEOUT_MS, 'csv').catch(() => null) : Promise.resolve(null),
      earlyDates ? withTimeout(earlyDates, REQ_TIMEOUT_MS, 'dates').catch(() => null) : Promise.resolve(null)
    ]);
    csv = c; dates = d;
    window.__pgCsvEarly = null; window.__pgDatesEarly = null;   // lepas teks besar dari memori
  }
  if (!csv || !dates) {
    // lengkapi/ulangi bagian yang belum berhasil (juga menutup kasus unduhan awal gagal)
    const retries = await Promise.allSettled([
      csv ? Promise.resolve(csv) : fetchText(CSV_URL),
      dates ? Promise.resolve(dates) : fetchText(DATES_URL)
    ]);
    if (!csv && retries[0].status === 'fulfilled') csv = retries[0].value;
    if (!dates && retries[1].status === 'fulfilled') dates = retries[1].value;
  }
  const ts = Date.now();
  if (csv && csv.length > 1000) {
    return { csv, dates, sig: fingerprint(csv), ts, fromCache: false };
  }
  // CSV bermasalah -> baru ambil JSON gviz penuh (jauh lebih besar, hanya sebagai cadangan)
  console.warn('[data] CSV gagal, memakai fallback JSON gviz');
  const json = await fetchText(GVIZ_URL);
  if (json) return { csv: null, dates, json, sig: fingerprint(json), ts, fromCache: false };
  throw new Error('Semua sumber data gagal dimuat');
}

// Kompatibilitas: parser lama (dipakai harness/testing) kini memakai parser cepat buildRows()
function parseCSVText(csvText, datesText) { return buildRows(csvText, datesText); }

// Kolom angka yang bisa dicari di kotak pencarian tabel (perilaku lama dipertahankan)
const NUM_SEARCH_FIELDS = ['luasSiram','solarTerpakai','biayaTotal','luasSiram','solarPerHa','solarPerJam','kecepatan','tebalSiram','utilization','availability','rpPerHa','operatingTime'];
function rowNumericMatch(d, q) {
  for (let i = 0; i < NUM_SEARCH_FIELDS.length; i++) {
    const v = d[NUM_SEARCH_FIELDS[i]];
    if (v && String(v).indexOf(q) !== -1) return true;
  }
  return false;
}

// Filtering
function applyFilters() {
  // Satu lintasan untuk semua kondisi (jauh lebih cepat dari berantai .filter())
  const t0 = performance.now();
  const startMs = filters.start ? filters.start.getTime() : null;
  const endMs = filters.end ? (filters.end.getTime() + 86399999) : null;
  const fMonths = filters.months, fWilayah = filters.wilayah;
  const y = (filters.year !== 'all') ? parseInt(filters.year, 10) : null;
  const fEngine = filters.jenisEngine;
  const q1 = filters.search ? filters.search.toLowerCase() : null;
  const q2 = filters.tableSearch ? filters.tableSearch.toLowerCase() : null;

  const out = [];
  for (let i = 0; i < rawData.length; i++) {
    const d = rawData[i];
    const t = d.date.getTime();
    if (startMs !== null && t < startMs) continue;
    if (endMs !== null && t > endMs) continue;
    if (fMonths.size && !fMonths.has(d._m)) continue;
    if (y !== null && !isNaN(y) && d._y !== y) continue;
    if (fWilayah.size && !fWilayah.has(d.wilayah)) continue;
    if (fEngine !== 'all' && d.jenisEngine !== fEngine) continue;
    if (q1 && d._s.indexOf(q1) === -1) continue;
    if (q2 && d._s.indexOf(q2) === -1 && !rowNumericMatch(d, q2)) continue;
    out.push(d);
  }
  out.sort((a, b) => a.date - b.date);
  filteredData = out;
  // filter berubah -> semua hasil turunan (agregasi, statistik, KPI) dihitung ulang
  dataVersion++;
  if (memoStore.size > 400) memoStore.clear();
  dirtyTabs = new Set(TAB_IDS);
  console.debug('[filter]', rawData.length, '->', out.length, 'baris dalam', Math.round(performance.now() - t0), 'ms');
}

// Cache hasil turunan per-versi data (memoization)
function memo(key, fn) {
  const k = key + '@' + dataVersion;
  let v = memoStore.get(k);
  if (v === undefined) { v = fn(); memoStore.set(k, v); }
  return v;
}

function getAggregated(gran) {
  return memo('agg:' + gran, () => getAggregatedRaw(gran));
}
function getAggregatedRaw(gran) {
  // Satu lintasan: kelompokkan + akumulasi semua metrik sekaligus
  const groups = {};
  const keysInOrder = [];
  for (let i = 0; i < filteredData.length; i++) {
    const d = filteredData[i];
    let key;
    if (gran === 'daily') key = formatDateISO(d.date);
    else if (gran === 'weekly') key = getWeekLabel(d.date);
    else key = getMonthLabel(d.date);
    let g = groups[key];
    if (!g) {
      g = groups[key] = {
        key, label: key, date: d.date, count: 0,
        luasSiram: 0, solarTerpakai: 0, solarPerJam: 0, solarPerHa: 0, operatingTime: 0,
        prepareTime: 0, waitingTime: 0, kecepatan: 0, tebalSiram: 0, availability: 0,
        utilization: 0, haPerJam: 0, haPerHari: 0, biayaTotal: 0, rpPerHa: 0, planTime: 0
      };
      keysInOrder.push(key);
    }
    g.count++;
    g.luasSiram += d.luasSiram || 0;
    g.solarTerpakai += d.solarTerpakai || 0;
    g.solarPerJam += d.solarPerJam || 0;
    g.solarPerHa += d.solarPerHa || 0;
    g.operatingTime += d.operatingTime || 0;
    g.prepareTime += d.prepareTime || 0;
    g.waitingTime += d.waitingTime || 0;
    g.kecepatan += d.kecepatan || 0;
    g.tebalSiram += d.tebalSiram || 0;
    g.availability += d.availability || 0;
    g.utilization += d.utilization || 0;
    g.haPerJam += d.haPerJam || 0;
    g.haPerHari += d.haPerHari || 0;
    g.biayaTotal += d.biayaTotal || 0;
    g.rpPerHa += d.rpPerHa || 0;
    g.planTime += d.planTime || 0;
  }
  keysInOrder.sort();   // label 'YYYY-MM' / 'YYYY-Www' / 'YYYY-MM-DD' -> urut otomatis benar
  const result = new Array(keysInOrder.length);
  for (let i = 0; i < keysInOrder.length; i++) {
    const g = groups[keysInOrder[i]];
    const n = g.count || 1;
    result[i] = {
      key: g.key,
      label: g.label,
      date: g.date,
      count: g.count,
      totalLuasSiram: g.luasSiram,
      totalSolar: g.solarTerpakai,
      avgSolarPerJam: g.solarPerJam / n,
      avgSolarPerHa: g.solarPerHa / n,
      avgOperating: g.operatingTime / n,
      avgPrepare: g.prepareTime / n,
      avgWaiting: g.waitingTime / n,
      totalOperating: g.operatingTime,
      avgKecepatan: g.kecepatan / n,
      avgTebal: g.tebalSiram / n,
      avgAvailability: g.availability / n,
      avgUtilization: g.utilization / n,
      avgHaPerJam: g.haPerJam / n,
      avgHaPerHari: g.haPerHari / n,
      totalBiaya: g.biayaTotal,
      avgRpPerHa: g.rpPerHa / n,
      avgPlan: g.planTime / n,
    };
  }
  return result;
}

function getWilayahStats() {
  return memo('wil:' + wilayahSort, () => getWilayahStatsRaw());
}
function getWilayahStatsRaw() {
  // Satu lintasan: akumulasi semua field yang dibutuhkan per wilayah (tanpa reduce berulang)
  const groups = {};
  for (let i = 0; i < filteredData.length; i++) {
    const d = filteredData[i];
    let g = groups[d.wilayah];
    if (!g) g = groups[d.wilayah] = {
      wilayah: d.wilayah, count: 0,
      luasSiram: 0, solarTerpakai: 0, haPerJam: 0, haPerHari: 0, solarPerHa: 0, solarPerJam: 0,
      operatingTime: 0, prepareTime: 0, waitingTime: 0, kecepatan: 0, tebalSiram: 0,
      availability: 0, utilization: 0, rpPerHa: 0, biayaTotal: 0, air: 0,
      biayaSolar: 0, biayaUpah: 0, biayaAlat: 0
    };
    g.count++;
    g.luasSiram += d.luasSiram || 0;
    g.solarTerpakai += d.solarTerpakai || 0;
    g.haPerJam += d.haPerJam || 0;
    g.haPerHari += d.haPerHari || 0;
    g.solarPerHa += d.solarPerHa || 0;
    g.solarPerJam += d.solarPerJam || 0;
    g.operatingTime += d.operatingTime || 0;
    g.prepareTime += d.prepareTime || 0;
    g.waitingTime += d.waitingTime || 0;
    g.kecepatan += d.kecepatan || 0;
    g.tebalSiram += d.tebalSiram || 0;
    g.availability += d.availability || 0;
    g.utilization += d.utilization || 0;
    g.rpPerHa += d.rpPerHa || 0;
    g.biayaTotal += d.biayaTotal || 0;
    g.air += d.air || 0;
    g.biayaSolar += d.biayaSolar || 0;
    g.biayaUpah += d.biayaUpah || 0;
    g.biayaAlat += d.biayaAlat || 0;
  }
  const stats = [];
  for (const w in groups) {
    const g = groups[w];
    const n = g.count || 1;
    const avgHaPerJam = g.haPerJam / n, avgSolarPerHa = g.solarPerHa / n;
    stats.push({
      wilayah: g.wilayah,
      count: g.count,
      totalLuas: g.luasSiram,
      avgLuas: g.luasSiram / n,
      totalSolar: g.solarTerpakai,
      avgSolar: g.solarTerpakai / n,
      avgHaPerJam,
      avgHaPerHari: g.haPerHari / n,
      avgSolarPerHa,
      avgSolarPerJam: g.solarPerJam / n,
      avgOperating: g.operatingTime / n,
      avgPrepare: g.prepareTime / n,
      avgWaiting: g.waitingTime / n,
      avgKecepatan: g.kecepatan / n,
      avgTebal: g.tebalSiram / n,
      avgAvailability: g.availability / n,
      avgUtilization: g.utilization / n,
      avgRpPerHa: g.rpPerHa / n,
      totalBiaya: g.biayaTotal,
      totalAir: g.air,
      // BIAYA: rincian pemakaian biaya selama irigasi per wilayah
      biayaSolar: g.biayaSolar,
      biayaUpah: g.biayaUpah,
      biayaAlat: g.biayaAlat,
      totalOperating: g.operatingTime,
      // perhitungan rasio biaya (bukan rata-rata baris, agar lebih akurat)
      rpPerHa: g.luasSiram ? g.biayaTotal / g.luasSiram : 0,
      rpPerJam: g.operatingTime ? g.biayaTotal / g.operatingTime : 0,
      rpPerLiter: g.solarTerpakai ? g.biayaTotal / g.solarTerpakai : 0,
      avgBiayaPerRec: g.biayaTotal / n,
      // efisiensi score: higher Ha/Jam and lower Ltr/Ha is better
      efisiensiScore: avgHaPerJam / (avgSolarPerHa || 1) * 100,
    });
  }
  // sort by selected wilayahSort
  stats.sort((a,b)=>{
    if (wilayahSort==='totalLuas') return b.totalLuas - a.totalLuas;
    if (wilayahSort==='avgHaPerJam') return b.avgHaPerJam - a.avgHaPerJam;
    if (wilayahSort==='avgSolarPerHa') return a.avgSolarPerHa - b.avgSolarPerHa; // lower is better
    if (wilayahSort==='totalSolar') return b.totalSolar - a.totalSolar;
    if (wilayahSort==='avgUtil') return b.avgUtilization - a.avgUtilization;
    if (wilayahSort==='avgRpPerHa') return a.avgRpPerHa - b.avgRpPerHa; // lower is better
    return b.totalLuas - a.totalLuas;
  });
  return stats;
}

// ===== ANALISA BIAYA IRIGASI =====
// Total biaya, biaya solar/upah/alat, Rp/Ha & Rp/Jam - total maupun per wilayah
function getBiayaWilayahStats() {
  return memo('biaya:' + biayaSort, () => getBiayaWilayahStatsRaw());
}
function getBiayaWilayahStatsRaw() {
  const groups = {};
  filteredData.forEach(d => {
    if (!groups[d.wilayah]) groups[d.wilayah] = {
      wilayah: d.wilayah, count: 0, luas: 0, biayaSolar: 0, biayaUpah: 0, biayaAlat: 0,
      biayaTotal: 0, solar: 0, operating: 0, air: 0
    };
    const g = groups[d.wilayah];
    g.count++;
    g.luas += d.luasSiram||0;
    g.biayaSolar += d.biayaSolar||0;
    g.biayaUpah += d.biayaUpah||0;
    g.biayaAlat += d.biayaAlat||0;
    g.biayaTotal += d.biayaTotal||0;
    g.solar += d.solarTerpakai||0;
    g.operating += d.operatingTime||0;
    g.air += d.air||0;
  });
  const list = Object.values(groups).map(g=>{
    // Jika kolom Biaya Total kosong di sheet, hitung dari komponen
    const total = g.biayaTotal || (g.biayaSolar + g.biayaUpah + g.biayaAlat);
    return Object.assign(g, {
      biayaTotal: total,
      rpPerHa: g.luas ? total/g.luas : 0,
      rpPerJam: g.operating ? total/g.operating : 0,
      rpPerLiter: g.solar ? total/g.solar : 0,
      rpPerRec: g.count ? total/g.count : 0,
      avgLuas: g.count ? g.luas/g.count : 0,
      pctSolar: total ? g.biayaSolar/total*100 : 0,
      pctUpah: total ? g.biayaUpah/total*100 : 0,
      pctAlat: total ? g.biayaAlat/total*100 : 0,
      share: 0, // diisi setelah total diketahui
    });
  });
  const grandTotal = list.reduce((s,x)=>s+x.biayaTotal,0);
  const grandLuas = list.reduce((s,x)=>s+x.luas,0);
  const grandOperating = list.reduce((s,x)=>s+x.operating,0);
  const grandSolar = list.reduce((s,x)=>s+x.solar,0);
  list.forEach(x=>{ x.share = grandTotal ? x.biayaTotal/grandTotal*100 : 0; });
  // sort
  list.sort((a,b)=>{
    if (biayaSort==='totalBiaya') return b.biayaTotal - a.biayaTotal;
    if (biayaSort==='rpPerHa') return b.rpPerHa - a.rpPerHa;
    if (biayaSort==='rpPerHaAsc') return a.rpPerHa - b.rpPerHa;
    if (biayaSort==='biayaSolar') return b.biayaSolar - a.biayaSolar;
    if (biayaSort==='biayaUpah') return b.biayaUpah - a.biayaUpah;
    if (biayaSort==='biayaAlat') return b.biayaAlat - a.biayaAlat;
    if (biayaSort==='totalLuas') return b.luas - a.luas;
    return b.biayaTotal - a.biayaTotal;
  });
  const totals = {
    wilayahCount: list.length,
    count: list.reduce((s,x)=>s+x.count,0),
    luas: grandLuas,
    biayaSolar: list.reduce((s,x)=>s+x.biayaSolar,0),
    biayaUpah: list.reduce((s,x)=>s+x.biayaUpah,0),
    biayaAlat: list.reduce((s,x)=>s+x.biayaAlat,0),
    biayaTotal: grandTotal,
    solar: grandSolar,
    operating: grandOperating,
    rpPerHa: grandLuas ? grandTotal/grandLuas : 0,
    rpPerJam: grandOperating ? grandTotal/grandOperating : 0,
    rpPerLiter: grandSolar ? grandTotal/grandSolar : 0,
  };
  totals.pctSolar = grandTotal ? totals.biayaSolar/grandTotal*100 : 0;
  totals.pctUpah = grandTotal ? totals.biayaUpah/grandTotal*100 : 0;
  totals.pctAlat = grandTotal ? totals.biayaAlat/grandTotal*100 : 0;
  totals.pctLuas = 0;
  totals.pctLuas = grandTotal ? 100 : 0;
  return { list, totals };
}

// Biaya per periode (harian/mingguan/bulanan) - total wilayah
function getBiayaPeriodStats() {
  return memo('bperiod:' + biayaGran, () => getBiayaPeriodStatsRaw());
}
function getBiayaPeriodStatsRaw() {
  if (biayaGran === 'all') {
    const { totals } = getBiayaWilayahStats();
    return [Object.assign({ label: 'Seluruh Periode', key: 'all', date: null }, totals)];
  }
  const groups = {};
  filteredData.forEach(d=>{
    let key;
    if (biayaGran === 'daily') key = formatDateISO(d.date);
    else if (biayaGran === 'weekly') key = getWeekLabel(d.date);
    else key = getMonthLabel(d.date);
    if (!groups[key]) groups[key] = { label:key, key, date:d.date, count:0, luas:0, biayaSolar:0, biayaUpah:0, biayaAlat:0, biayaTotal:0, operating:0, solar:0 };
    const g = groups[key];
    g.count++;
    g.luas += d.luasSiram||0;
    g.biayaSolar += d.biayaSolar||0;
    g.biayaUpah += d.biayaUpah||0;
    g.biayaAlat += d.biayaAlat||0;
    g.biayaTotal += d.biayaTotal||0;
    g.operating += d.operatingTime||0;
    g.solar += d.solarTerpakai||0;
    g.date = d.date;
  });
  const rows = Object.keys(groups).sort().map(k=>{
    const g = groups[k];
    const total = g.biayaTotal || (g.biayaSolar + g.biayaUpah + g.biayaAlat);
    return Object.assign(g, {
      biayaTotal: total,
      rpPerHa: g.luas ? total/g.luas : 0,
      rpPerJam: g.operating ? total/g.operating : 0,
      rpPerLiter: g.solar ? total/g.solar : 0,
      pctSolar: total ? g.biayaSolar/total*100 : 0,
      pctUpah: total ? g.biayaUpah/total*100 : 0,
      pctAlat: total ? g.biayaAlat/total*100 : 0,
    });
  });
  return rows;
}

function formatRupiah(n) {
  if (n == null || isNaN(n)) return '-';
  return 'Rp ' + new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 }).format(Math.round(n));
}
function formatRupiahShort(n) {
  if (n == null || isNaN(n)) return '-';
  const abs = Math.abs(n);
  if (abs >= 1000000000) return 'Rp ' + formatNumber(n/1000000000, 2) + ' M';
  if (abs >= 1000000) return 'Rp ' + formatNumber(n/1000000, 1) + ' Jt';
  if (abs >= 1000) return 'Rp ' + formatInt(n/1000) + ' Rb';
  return 'Rp ' + formatInt(n);
}

function renderBiaya() {
  const { list, totals } = getBiayaWilayahStats();
  const tbody = $('#biayaWilayahBody');
  const tfoot = $('#biayaWilayahFoot');
  if (!tbody) return;

  if (!list.length) {
    tbody.innerHTML = '<tr><td colspan="13" class="px-4 py-8 text-center text-slate-400">Tidak ada data biaya untuk filter ini</td></tr>';
    if (tfoot) tfoot.innerHTML = '';
    return;
  }

  // Rasio biaya terhadap produksi - untuk badge efisiensi biaya
  const rpPerHaValues = list.map(x=>x.rpPerHa).filter(v=>v>0);
  const avgRpPerHaAll = rpPerHaValues.length ? rpPerHaValues.reduce((a,b)=>a+b,0)/rpPerHaValues.length : 0;

  tbody.innerHTML = list.map(x=>{
    let badge;
    if (avgRpPerHaAll && x.rpPerHa <= avgRpPerHaAll*0.9) badge = '<span class="inline-flex rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700 ring-1 ring-emerald-200">Hemat</span>';
    else if (avgRpPerHaAll && x.rpPerHa <= avgRpPerHaAll*1.1) badge = '<span class="inline-flex rounded-full bg-sky-50 px-2 py-0.5 text-[10px] font-medium text-sky-700 ring-1 ring-sky-200">Normal</span>';
    else badge = '<span class="inline-flex rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-medium text-red-700 ring-1 ring-red-200">Mahal</span>';
    return `
      <tr class="hover:bg-amber-50/40 transition">
        <td class="px-4 py-2.5 whitespace-nowrap"><span class="inline-flex items-center gap-1.5"><span class="h-2 w-2 rounded-full bg-amber-500"></span><span class="font-semibold text-slate-900">${esc(x.wilayah)}</span></span></td>
        <td class="px-4 py-2.5 whitespace-nowrap text-center"><span class="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium">${formatInt(x.count)}</span></td>
        <td class="px-4 py-2.5 whitespace-nowrap text-right">${formatNumber(x.luas,2)}</td>
        <td class="px-4 py-2.5 whitespace-nowrap text-right">${formatInt(x.biayaSolar)}<span class="ml-1 text-[9px] text-slate-400">${formatNumber(x.pctSolar,0)}%</span></td>
        <td class="px-4 py-2.5 whitespace-nowrap text-right">${formatInt(x.biayaUpah)}<span class="ml-1 text-[9px] text-slate-400">${formatNumber(x.pctUpah,0)}%</span></td>
        <td class="px-4 py-2.5 whitespace-nowrap text-right">${formatInt(x.biayaAlat)}<span class="ml-1 text-[9px] text-slate-400">${formatNumber(x.pctAlat,0)}%</span></td>
        <td class="px-4 py-2.5 whitespace-nowrap text-right font-bold text-amber-700">${formatInt(x.biayaTotal)}</td>
        <td class="px-4 py-2.5 whitespace-nowrap text-right">
          <span class="inline-flex items-center gap-1.5"><span class="hidden h-1.5 w-10 overflow-hidden rounded-full bg-slate-100 sm:inline-flex"><span class="h-full rounded-full bg-amber-400" style="width:${Math.min(100, x.share)}%"></span></span><span class="text-[10px] text-slate-500">${formatNumber(x.share,1)}%</span></span>
        </td>
        <td class="px-4 py-2.5 whitespace-nowrap text-right font-bold text-slate-900">${formatInt(x.rpPerHa)}</td>
        <td class="px-4 py-2.5 whitespace-nowrap text-right">${formatInt(x.rpPerJam)}</td>
        <td class="px-4 py-2.5 whitespace-nowrap text-right">${formatInt(x.rpPerLiter)}</td>
        <td class="px-4 py-2.5 whitespace-nowrap text-right">${formatNumber(x.solar && x.luas ? x.solar/x.luas : 0,1)}</td>
        <td class="px-4 py-2.5 whitespace-nowrap text-center">${badge}</td>
      </tr>
    `;
  }).join('');

  if (tfoot) {
    tfoot.innerHTML = `
      <tr class="bg-slate-900 text-white">
        <td class="px-4 py-3 whitespace-nowrap font-bold">TOTAL ${totals.wilayahCount} Wilayah</td>
        <td class="px-4 py-3 whitespace-nowrap text-center">${formatInt(totals.count)}</td>
        <td class="px-4 py-3 whitespace-nowrap text-right">${formatNumber(totals.luas,2)}</td>
        <td class="px-4 py-3 whitespace-nowrap text-right">${formatInt(totals.biayaSolar)}<span class="ml-1 text-[9px] text-slate-400">${formatNumber(totals.pctSolar,0)}%</span></td>
        <td class="px-4 py-3 whitespace-nowrap text-right">${formatInt(totals.biayaUpah)}<span class="ml-1 text-[9px] text-slate-400">${formatNumber(totals.pctUpah,0)}%</span></td>
        <td class="px-4 py-3 whitespace-nowrap text-right">${formatInt(totals.biayaAlat)}<span class="ml-1 text-[9px] text-slate-400">${formatNumber(totals.pctAlat,0)}%</span></td>
        <td class="px-4 py-3 whitespace-nowrap text-right text-amber-300">${formatInt(totals.biayaTotal)}</td>
        <td class="px-4 py-3 whitespace-nowrap text-right">100%</td>
        <td class="px-4 py-3 whitespace-nowrap text-right text-emerald-300">${formatInt(totals.rpPerHa)}</td>
        <td class="px-4 py-3 whitespace-nowrap text-right">${formatInt(totals.rpPerJam)}</td>
        <td class="px-4 py-3 whitespace-nowrap text-right">${formatInt(totals.rpPerLiter)}</td>
        <td class="px-4 py-3 whitespace-nowrap text-right">${formatNumber(totals.solar && totals.luas ? totals.solar/totals.luas : 0,1)}</td>
        <td class="px-4 py-3 whitespace-nowrap text-center"><span class="inline-flex rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-medium">Total</span></td>
      </tr>
    `;
  }

  // Mini cards biaya total
  const cards = $('#biayaTotalCards');
  if (cards) {
    const items = [
      { label:'Total Biaya Irigasi', value: formatRupiahShort(totals.biayaTotal), sub: `${formatRupiah(totals.biayaTotal)}`, color:'slate' },
      { label:'Rp/Ha (Total)', value: formatRupiah(totals.rpPerHa), sub:`${formatNumber(totals.luas,1)} Ha tersiram`, color:'emerald' },
      { label:'Biaya Solar', value: formatRupiahShort(totals.biayaSolar), sub:`${formatNumber(totals.pctSolar,1)}% dari total • ${formatInt(totals.solar)} L`, color:'amber' },
      { label:'Biaya Upah', value: formatRupiahShort(totals.biayaUpah), sub:`${formatNumber(totals.pctUpah,1)}% dari total`, color:'blue' },
      { label:'Biaya Alat', value: formatRupiahShort(totals.biayaAlat), sub:`${formatNumber(totals.pctAlat,1)}% dari total`, color:'violet' },
      { label:'Rp/Jam Operasi', value: formatRupiah(totals.rpPerJam), sub:`${formatNumber(totals.operating,0)} jam total`, color:'sky' },
      { label:'Rp/Liter Solar', value: formatRupiah(totals.rpPerLiter), sub:`${formatInt(totals.solar)} L solar`, color:'rose' },
      { label:'Rp/Record', value: formatRupiah(totals.count ? totals.biayaTotal/totals.count : 0), sub:`${formatInt(totals.count)} aktivitas`, color:'teal' },
    ];
    cards.innerHTML = items.map(c=>`
      <div class="rounded-xl border border-slate-200 bg-white p-3">
        <div class="text-[10px] font-semibold uppercase tracking-wider text-slate-400">${c.label}</div>
        <div class="mt-1 text-[15px] font-bold text-slate-900">${c.value}</div>
        <div class="mt-0.5 text-[10px] text-slate-500">${c.sub}</div>
      </div>
    `).join('');
  }

  // Chart: total biaya per wilayah (stacked komponen + line Rp/Ha)
  ensureChart('chartBiayaWilayah', {
    type: 'bar',
    data: {
      labels: list.map(x=>x.wilayah),
      datasets: [
        { label:'Biaya Solar', data:list.map(x=>x.biayaSolar), backgroundColor:'rgba(245,158,11,0.85)', borderRadius:4, stack:'biaya', yAxisID:'y' },
        { label:'Biaya Upah', data:list.map(x=>x.biayaUpah), backgroundColor:'rgba(59,130,246,0.75)', borderRadius:4, stack:'biaya', yAxisID:'y' },
        { label:'Biaya Alat', data:list.map(x=>x.biayaAlat), backgroundColor:'rgba(139,92,246,0.7)', borderRadius:4, stack:'biaya', yAxisID:'y' },
        { type:'line', label:'Rp/Ha', data:list.map(x=>x.rpPerHa), borderColor:'#0f172a', backgroundColor:'#0f172a', borderWidth:2, pointRadius:3, tension:0.35, yAxisID:'y1' }
      ]
    },
    options:{
      responsive:true, maintainAspectRatio:false,
      interaction:{mode:'index',intersect:false},
      plugins:{
        legend:{position:'bottom', labels:{usePointStyle:true,font:{size:10}}},
        tooltip:{ backgroundColor:'#0f172a', cornerRadius:12, callbacks:{
          label: ctx => `${ctx.dataset.label}: ${formatRupiah(ctx.raw)}`
        }}
      },
      scales:{
        x:{ stacked:true, grid:{display:false}, ticks:{font:{size:10}} },
        y:{ stacked:true, beginAtZero:true, grid:{color:'#f1f5f9'}, ticks:{font:{size:10}, callback:v=>formatRupiahShort(v)}, title:{display:true,text:'Total Biaya',font:{size:10}} },
        y1:{ position:'right', beginAtZero:true, grid:{display:false}, ticks:{font:{size:10}, callback:v=>formatInt(v/1000)+'rb'}, title:{display:true,text:'Rp/Ha',font:{size:10}} }
      }
    }
  });

  // Chart: komposisi biaya total
  ensureChart('chartBiayaKomposisi', {
    type: 'doughnut',
    data: {
      labels: ['Solar','Upah','Alat'],
      datasets: [{ data:[totals.biayaSolar, totals.biayaUpah, totals.biayaAlat], backgroundColor:['#f59e0b','#3b82f6','#8b5cf6'], borderWidth:2, borderColor:'#fff', hoverOffset:6 }]
    },
    options:{
      responsive:true, maintainAspectRatio:false, cutout:'62%',
      plugins:{
        legend:{position:'bottom', labels:{usePointStyle:true,font:{size:10}}},
        tooltip:{ backgroundColor:'#0f172a', cornerRadius:12, callbacks:{
          label: ctx => `${ctx.label}: ${formatRupiah(ctx.raw)} (${formatNumber(totals.biayaTotal?ctx.raw/totals.biayaTotal*100:0,1)}%)`
        }}
      }
    }
  });

  // Chart: tren biaya per periode
  const periodRows = getBiayaPeriodStats();
  const dailyAgg = getAggregated('daily');
  ensureChart('chartBiayaTrend', {
    type: 'line',
    data: {
      labels: dailyAgg.map(r=>r.label),
      datasets: [
        { label:'Biaya Total', data:dailyAgg.map(r=>r.totalBiaya), borderColor:'#f59e0b', backgroundColor:'rgba(245,158,11,0.15)', fill:true, tension:0.35, pointRadius:0, borderWidth:2, yAxisID:'y' },
        { label:'Rp/Ha', data:dailyAgg.map(r=>r.avgRpPerHa), borderColor:'#0f172a', backgroundColor:'rgba(15,23,42,0.05)', fill:false, tension:0.35, pointRadius:0, borderWidth:1.5, borderDash:[4,3], yAxisID:'y1' }
      ]
    },
    options:{
      responsive:true, maintainAspectRatio:false,
      interaction:{mode:'index',intersect:false},
      plugins:{
        legend:{position:'bottom', labels:{usePointStyle:true,font:{size:10}}},
        tooltip:{ backgroundColor:'#0f172a', cornerRadius:12, callbacks:{ label: ctx => `${ctx.dataset.label}: ${formatRupiah(ctx.raw)}` }}
      },
      scales:{
        x:{ grid:{display:false}, ticks:{font:{size:9}, maxRotation:0, autoSkip:true, maxTicksLimit:6} },
        y:{ beginAtZero:true, grid:{color:'#f1f5f9'}, ticks:{font:{size:10}, callback:v=>formatRupiahShort(v)} },
        y1:{ position:'right', beginAtZero:true, grid:{display:false}, ticks:{font:{size:10}, callback:v=>formatInt(v/1000)+'rb'} }
      }
    }
  });

  // Chart: Total Biaya & Rp/Ha per granularitas terpilih (selaras tabel di samping)
  ensureChart('chartBiayaGran', {
    type: 'bar',
    data: {
      labels: periodRows.map(r=>r.label),
      datasets: [
        { type:'bar', label:'Total Biaya', data: periodRows.map(r=>r.biayaTotal), backgroundColor:'rgba(245,158,11,0.85)', borderRadius:5, yAxisID:'y' },
        { type:'line', label:'Rp/Ha', data: periodRows.map(r=>r.rpPerHa), borderColor:'#0f172a', backgroundColor:'#0f172a', borderWidth:2, pointRadius: periodRows.length>40?0:3, tension:0.35, yAxisID:'y1' }
      ]
    },
    options:{
      responsive:true, maintainAspectRatio:false,
      interaction:{mode:'index',intersect:false},
      plugins:{
        legend:{position:'bottom', labels:{usePointStyle:true,font:{size:10}}},
        tooltip:{backgroundColor:'#0f172a',cornerRadius:12, callbacks:{ label: ctx=> `${ctx.dataset.label}: ${formatRupiah(ctx.raw)}` }}
      },
      scales:{
        x:{grid:{display:false}, ticks:{font:{size:9}, maxRotation:0, autoSkip:true, maxTicksLimit:8}},
        y:{beginAtZero:true, grid:{color:'#f1f5f9'}, ticks:{font:{size:10}, callback:v=>formatRupiahShort(v)}, title:{display:true,text:'Total Biaya',font:{size:9}}},
        y1:{position:'right', beginAtZero:true, grid:{display:false}, ticks:{font:{size:10}, callback:v=>formatInt(v/1000)+'rb'}, title:{display:true,text:'Rp/Ha',font:{size:9}}}
      }
    }
  });

  // Tabel biaya per periode
  const pbody = $('#biayaPeriodeBody');
  const periodoInfo = $('#biayaPeriodeInfo');
  const granLabel = biayaGran==='all' ? 'seluruh periode' : biayaGran==='daily' ? 'harian' : biayaGran==='weekly' ? 'mingguan' : 'bulanan';
  if (periodoInfo) periodoInfo.textContent = `Granularitas: ${granLabel} • ${periodRows.length} periode`;
  const trendLabel = $('#biayaTrendGranLabel');
  if (trendLabel) trendLabel.textContent = '(' + granLabel + ')';
  if (pbody) {
    pbody.innerHTML = periodRows.map(r=>`
      <tr class="hover:bg-amber-50/40 transition">
        <td class="px-4 py-2.5 whitespace-nowrap font-medium text-slate-900">${esc(r.label)}</td>
        <td class="px-4 py-2.5 whitespace-nowrap text-center text-slate-500">${formatInt(r.count)}</td>
        <td class="px-4 py-2.5 whitespace-nowrap text-right">${formatNumber(r.luas,2)}</td>
        <td class="px-4 py-2.5 whitespace-nowrap text-right">${formatInt(r.biayaSolar)}</td>
        <td class="px-4 py-2.5 whitespace-nowrap text-right">${formatInt(r.biayaUpah)}</td>
        <td class="px-4 py-2.5 whitespace-nowrap text-right">${formatInt(r.biayaAlat)}</td>
        <td class="px-4 py-2.5 whitespace-nowrap text-right font-bold text-amber-700">${formatInt(r.biayaTotal)}</td>
        <td class="px-4 py-2.5 whitespace-nowrap text-right font-semibold text-slate-900">${formatInt(r.rpPerHa)}</td>
      </tr>
    `).join('') || '<tr><td colspan="8" class="px-4 py-8 text-center text-slate-400">Tidak ada data</td></tr>';
  }

  // Insight biaya
  const ins = $('#biayaInsights');
  if (ins) {
    const insights = [];
    if (list.length) {
      const termurah = [...list].filter(x=>x.luas>0).sort((a,b)=>a.rpPerHa-b.rpPerHa)[0];
      const termahal = [...list].filter(x=>x.luas>0).sort((a,b)=>b.rpPerHa-a.rpPerHa)[0];
      const terbesar = [...list].sort((a,b)=>b.biayaTotal-a.biayaTotal)[0];
      if (termurah && termahal) {
        insights.push(`Biaya termurah <b>${termurah.wilayah}</b> ${formatRupiah(termurah.rpPerHa)}/Ha, termahal <b>${termahal.wilayah}</b> ${formatRupiah(termahal.rpPerHa)}/Ha (selisih ${formatNumber(termurah.rpPerHa ? (termahal.rpPerHa-termurah.rpPerHa)/termurah.rpPerHa*100 : 0,1)}%).`);
      }
      if (terbesar) {
        insights.push(`Wilayah biaya terbesar: <b>${terbesar.wilayah}</b> ${formatRupiah(terbesar.biayaTotal)} (${formatNumber(terbesar.share,1)}% dari total) untuk ${formatNumber(terbesar.luas,1)} Ha.`);
      }
    }
    // komponen biaya dominan
    const comp = [
      {label:'Solar', v:totals.biayaSolar, p:totals.pctSolar},
      {label:'Upah', v:totals.biayaUpah, p:totals.pctUpah},
      {label:'Alat', v:totals.biayaAlat, p:totals.pctAlat},
    ].sort((a,b)=>b.v-a.v);
    if (comp[0] && comp[0].v>0) {
      insights.push(`Komponen biaya terbesar: <b>${comp[0].label}</b> ${formatRupiah(comp[0].v)} (${formatNumber(comp[0].p,1)}% dari total ${formatRupiah(totals.biayaTotal)}).`);
      insights.push(`Rata-rata biaya irigasi <b>${formatRupiah(totals.rpPerHa)}/Ha</b> • ${formatRupiah(totals.rpPerJam)}/jam operasi • ${formatRupiah(totals.rpPerLiter)}/liter solar.`);
    }
    // trend periode
    if (periodRows.length > 1) {
      const last = periodRows[periodRows.length-1], prev = periodRows[periodRows.length-2];
      const diff = last.biayaTotal - prev.biayaTotal;
      const pct = prev.biayaTotal ? diff/prev.biayaTotal*100 : 0;
      insights.push(`Periode terakhir (${last.label}): ${formatRupiah(last.biayaTotal)} Rp • <b>${pct>=0?'+':''}${formatNumber(pct,1)}%</b> vs periode sebelumnya (${formatRupiah(last.rpPerHa)}/Ha).`);
    }
    ins.innerHTML = insights.map(t=>`<div class="flex gap-2 rounded-xl border border-slate-200/70 bg-white px-3 py-2.5"><span class="mt-1 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-amber-500"></span><span class="leading-relaxed">${t}</span></div>`).join('');
  }

  refreshIcons();
}


function renderWilayahDetail() {
  const stats = getWilayahStats();
  const tbody = $('#wilayahDetailBody');
  const miniCardsContainer = $('#wilayahMiniCards');
  if (!stats.length) {
    if (tbody) tbody.innerHTML = '<tr><td colspan="15" class="px-4 py-8 text-center text-slate-400">Tidak ada data wilayah</td></tr>';
    if (miniCardsContainer) miniCardsContainer.innerHTML = '';
    return;
  }

  // Mini cards - top 6 wilayah with key avg metrics
  if (miniCardsContainer) {
    miniCardsContainer.innerHTML = stats.slice(0,6).map(s=>`
      <div class="rounded-xl border border-slate-200 bg-slate-50/50 p-3">
        <div class="flex items-center justify-between">
          <span class="text-[11px] font-bold text-slate-900">${s.wilayah}</span>
          <span class="rounded-full bg-white px-2 py-0.5 text-[10px] font-medium text-slate-600 ring-1 ring-slate-200">${s.count} rec</span>
        </div>
        <div class="mt-2 grid grid-cols-2 gap-2 text-[10px]">
          <div><span class="text-slate-400">Avg Luas</span><div class="font-semibold text-slate-900">${formatNumber(s.avgLuas,2)} Ha</div></div>
          <div><span class="text-slate-400">Avg Solar</span><div class="font-semibold text-amber-700">${formatInt(s.avgSolar)} L</div></div>
          <div><span class="text-slate-400">Ha/Jam</span><div class="font-semibold text-emerald-700">${formatNumber(s.avgHaPerJam,3)}</div></div>
          <div><span class="text-slate-400">Ltr/Ha</span><div class="font-semibold text-slate-900">${formatNumber(s.avgSolarPerHa,1)}</div></div>
          <div><span class="text-slate-400">Jam Op</span><div class="font-medium">${formatNumber(s.avgOperating,1)}h</div></div>
          <div><span class="text-slate-400">Util</span><div class="font-medium ${s.avgUtilization>=70?'text-emerald-600':'text-amber-600'}">${formatNumber(s.avgUtilization,1)}%</div></div>
        </div>
      </div>
    `).join('');
  }

  // Detailed table
  if (tbody) {
    tbody.innerHTML = stats.map(s=>{
      let effBadge = '';
      if (s.efisiensiScore > 0.5) effBadge = '<span class="inline-flex rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700 ring-1 ring-emerald-200">Efisien</span>';
      else if (s.efisiensiScore > 0.2) effBadge = '<span class="inline-flex rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700 ring-1 ring-amber-200">Cukup</span>';
      else effBadge = '<span class="inline-flex rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-medium text-red-700 ring-1 ring-red-200">Boros</span>';
      return `
        <tr class="hover:bg-slate-50/80 transition">
          <td class="px-4 py-2.5 whitespace-nowrap"><span class="inline-flex items-center gap-1.5"><span class="h-2 w-2 rounded-full bg-emerald-500"></span><span class="font-semibold text-slate-900">${esc(s.wilayah)}</span></span></td>
          <td class="px-4 py-2.5 whitespace-nowrap text-center"><span class="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium">${s.count}</span></td>
          <td class="px-4 py-2.5 whitespace-nowrap text-right font-bold text-emerald-700">${formatNumber(s.totalLuas,2)}</td>
          <td class="px-4 py-2.5 whitespace-nowrap text-right">${formatNumber(s.avgLuas,2)}</td>
          <td class="px-4 py-2.5 whitespace-nowrap text-right font-medium text-amber-700">${formatInt(s.totalSolar)}</td>
          <td class="px-4 py-2.5 whitespace-nowrap text-right">${formatInt(s.avgSolar)}</td>
          <td class="px-4 py-2.5 whitespace-nowrap text-right font-bold text-emerald-700">${formatNumber(s.avgHaPerJam,3)}</td>
          <td class="px-4 py-2.5 whitespace-nowrap text-right">${formatNumber(s.avgSolarPerHa,1)}</td>
          <td class="px-4 py-2.5 whitespace-nowrap text-right">${formatNumber(s.avgSolarPerJam,1)}</td>
          <td class="px-4 py-2.5 whitespace-nowrap text-right">${formatNumber(s.avgOperating,1)}</td>
          <td class="px-4 py-2.5 whitespace-nowrap text-right">${formatNumber(s.avgKecepatan,1)}</td>
          <td class="px-4 py-2.5 whitespace-nowrap text-right">${formatNumber(s.avgTebal,1)}</td>
          <td class="px-4 py-2.5 whitespace-nowrap text-right"><span class="inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium ${s.avgUtilization>=70?'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200':'bg-amber-50 text-amber-700 ring-1 ring-amber-200'}">${formatNumber(s.avgUtilization,1)}%</span></td>
          <td class="px-4 py-2.5 whitespace-nowrap text-right">${formatInt(s.avgRpPerHa)}</td>
          <td class="px-4 py-2.5 whitespace-nowrap text-center">${effBadge}</td>
        </tr>
      `;
    }).join('');
  }

  // Bubble chart: efisiensi per wilayah
  const maxLuas = Math.max(...stats.map(s=>s.totalLuas)) || 1;
  const bubbleData = stats.map(s=>({
    x: s.avgHaPerJam,
    y: s.avgSolarPerHa,
    r: Math.sqrt(s.totalLuas / maxLuas) * 24 + 9, // proporsional, max ~33px
    wilayah: s.wilayah
  }));
  const colors = ['#10b981','#3b82f6','#f59e0b','#8b5cf6','#06b6d4','#ef4444','#64748b','#ec4899'];
  ensureChart('chartWilayahEff', {
    type: 'bubble',
    data: {
      datasets: bubbleData.map((d,i)=>({
        label: d.wilayah,
        data: [{x:d.x, y:d.y, r:d.r}],
        backgroundColor: colors[i%colors.length]+'99',
        borderColor: colors[i%colors.length],
        borderWidth: 1
      }))
    },
    options: {
      responsive:true, maintainAspectRatio:false,
      plugins:{
        legend:{position:'bottom', labels:{usePointStyle:true,font:{size:10}}},
        tooltip:{
          backgroundColor:'#0f172a', cornerRadius:12,
          callbacks:{
            label: ctx=> `${ctx.dataset.label}: ${formatNumber(ctx.raw.x,3)} Ha/Jam, ${formatNumber(ctx.raw.y,1)} L/Ha, Total ${formatNumber(stats.find(s=>s.wilayah===ctx.dataset.label)?.totalLuas||0,1)} Ha`
          }
        }
      },
      scales:{
        x:{ title:{display:true,text:'Avg Ha/Jam (Produktivitas) →',font:{size:10}}, grid:{color:'#f1f5f9'}, ticks:{font:{size:10}} },
        y:{ title:{display:true,text:'Avg Ltr/Ha (Pemakaian) → ideal rendah',font:{size:10}}, grid:{color:'#f1f5f9'}, ticks:{font:{size:10}} }
      }
    }
  });

  // Compare chart: pemakaian vs hasil rata-rata per wilayah
  ensureChart('chartWilayahCompare', {
    type: 'bar',
    data: {
      labels: stats.map(s=>s.wilayah),
      datasets: [
        { label: 'Avg Luas Ha', data: stats.map(s=>s.avgLuas), backgroundColor: 'rgba(16,185,129,0.85)', borderRadius:6, yAxisID:'y' },
        { label: 'Avg Solar L', data: stats.map(s=>s.avgSolar), backgroundColor: 'rgba(245,158,11,0.65)', borderRadius:6, yAxisID:'y1' },
        { type:'line', label: 'Avg Ha/Jam', data: stats.map(s=>s.avgHaPerJam), borderColor:'#0f172a', backgroundColor:'#0f172a', tension:0.4, pointRadius:3, borderWidth:2, yAxisID:'y' }
      ]
    },
    options:{
      responsive:true, maintainAspectRatio:false,
      interaction:{mode:'index',intersect:false},
      plugins:{ legend:{position:'bottom', labels:{usePointStyle:true,font:{size:10}}}, tooltip:{backgroundColor:'#0f172a',cornerRadius:12} },
      scales:{
        x:{ grid:{display:false}, ticks:{font:{size:10}} },
        y:{ beginAtZero:true, grid:{color:'#f1f5f9'}, ticks:{font:{size:10}}, title:{display:true,text:'Ha',font:{size:10}} },
        y1:{ beginAtZero:true, position:'right', grid:{display:false}, ticks:{font:{size:10}}, title:{display:true,text:'Solar L',font:{size:10}} }
      }
    }
  });
}

function calculateKPIs() {
  return memo('kpi', calculateKPIsRaw);
}
function calculateKPIsRaw() {
  const data = filteredData;
  const n = data.length;
  if (n === 0) return null;
  // satu lintasan untuk semua akumulasi
  let luas = 0, solar = 0, oper = 0, solarJam = 0, solarHa = 0, kec = 0, tebal = 0, avail = 0, util = 0,
      biaya = 0, biayaSolar = 0, biayaUpah = 0, biayaAlat = 0, rpHaSum = 0, haHari = 0, haJam = 0,
      plan = 0, prep = 0, wait = 0, air = 0;
  for (let i = 0; i < n; i++) {
    const d = data[i];
    luas += d.luasSiram || 0; solar += d.solarTerpakai || 0; oper += d.operatingTime || 0;
    solarJam += d.solarPerJam || 0; solarHa += d.solarPerHa || 0; kec += d.kecepatan || 0;
    tebal += d.tebalSiram || 0; avail += d.availability || 0; util += d.utilization || 0;
    biaya += d.biayaTotal || 0; biayaSolar += d.biayaSolar || 0; biayaUpah += d.biayaUpah || 0;
    biayaAlat += d.biayaAlat || 0; rpHaSum += d.rpPerHa || 0; haHari += d.haPerHari || 0;
    haJam += d.haPerJam || 0; plan += d.planTime || 0; prep += d.prepareTime || 0;
    wait += d.waitingTime || 0; air += d.air || 0;
  }
  const avg = (tot) => tot / n;
  return {
    totalLuasSiram: luas,
    totalSolar: solar,
    avgOperating: avg(oper),
    avgSolarPerJam: avg(solarJam),
    avgSolarPerHa: avg(solarHa),
    avgKecepatan: avg(kec),
    avgTebal: avg(tebal),
    avgAvailability: avg(avail),
    avgUtilization: avg(util),
    totalBiaya: biaya,
    totalBiayaSolar: biayaSolar,
    totalBiayaUpah: biayaUpah,
    totalBiayaAlat: biayaAlat,
    avgRpPerHa: avg(rpHaSum),
    rpPerHaOps: luas ? biaya / luas : 0,
    rpPerJamOps: oper ? biaya / oper : 0,
    rpPerLiterSolar: solar ? biaya / solar : 0,
    avgHaPerHari: avg(haHari),
    avgHaPerJam: avg(haJam),
    avgPlan: avg(plan),
    avgPrepare: avg(prep),
    avgWaiting: avg(wait),
    totalRecords: n,
    totalAir: air,
  };
}

function renderKPIs() {
  const kpi = calculateKPIs();
  const grid = $('#kpiGrid');
  const secondary = $('#kpiSecondary');
  if (!kpi) {
    grid.innerHTML = '<div class="col-span-4 text-center py-8 text-slate-400 text-[13px]">Tidak ada data untuk filter ini</div>';
    secondary.innerHTML = '';
    return;
  }
  const cards = [
    { label: 'Total Luas Siram', value: `${formatNumber(kpi.totalLuasSiram,2)} Ha`, sub: `${kpi.totalRecords} aktivitas • ${formatNumber(kpi.avgHaPerHari,2)} Ha/hari avg`, icon: 'map', color: 'emerald', trend: `${formatNumber(kpi.avgHaPerJam,3)} Ha/Jam` },
    { label: 'Total Solar Terpakai', value: `${formatInt(kpi.totalSolar)} L`, sub: `${formatNumber(kpi.avgSolarPerJam,2)} L/jam • ${formatNumber(kpi.avgSolarPerHa,2)} L/Ha`, icon: 'fuel', color: 'amber', trend: `${formatNumber(kpi.totalAir,0)} L air` },
    { label: 'Jam Efektif Siram', value: `${formatNumber(kpi.avgOperating,2)} Jam`, sub: `Plan avg ${formatNumber(kpi.avgPlan,2)} Jam • Prepare ${formatNumber(kpi.avgPrepare,2)}`, icon: 'clock-3', color: 'blue', trend: `Util ${formatNumber(kpi.avgUtilization,1)}%` },
    { label: 'Efisiensi Operasional', value: `${formatNumber(kpi.avgHaPerJam,3)} Ha/Jam`, sub: `${formatNumber(kpi.avgHaPerHari,2)} Ha/Hari • Rp ${formatInt(kpi.avgRpPerHa)}/Ha`, icon: 'trending-up', color: 'violet', trend: `Avail ${formatNumber(kpi.avgAvailability,1)}%` },
  ];
  grid.innerHTML = cards.map(c => `
    <div class="group rounded-[18px] border border-slate-200/70 bg-white p-4 shadow-soft card-hover">
      <div class="flex items-start justify-between">
        <div class="flex h-9 w-9 items-center justify-center rounded-xl bg-${c.color}-50 text-${c.color}-600 ring-1 ring-${c.color}-200/50"><i data-lucide="${c.icon}" class="h-4 w-4"></i></div>
        <span class="rounded-full bg-slate-50 px-2.5 py-1 text-[10px] font-medium text-slate-600 ring-1 ring-slate-200">${c.trend}</span>
      </div>
      <div class="mt-3">
        <div class="text-[11px] font-semibold uppercase tracking-wider text-slate-500">${c.label}</div>
        <div class="mt-1 text-[20px] font-bold tracking-tight text-slate-900">${c.value}</div>
        <div class="mt-1 text-[11px] text-slate-500 leading-relaxed">${c.sub}</div>
      </div>
    </div>
  `).join('');

  const secCards = [
    { label: 'Kecepatan Rata-rata', value: `${formatNumber(kpi.avgKecepatan,1)}`, unit: 'm/menit', icon: 'gauge' },
    { label: 'Tebal Siram', value: `${formatNumber(kpi.avgTebal,1)}`, unit: 'mm', icon: 'layers' },
    { label: 'Availability', value: `${formatNumber(kpi.avgAvailability,1)}%`, unit: '', icon: 'shield-check' },
    { label: 'Utilization', value: `${formatNumber(kpi.avgUtilization,1)}%`, unit: '', icon: 'activity' },
    { label: 'Total Biaya Irigasi', value: `${formatInt(kpi.totalBiaya/1000000)}`, unit: 'Jt Rp', icon: 'wallet' },
    { label: 'Biaya Solar', value: `${formatInt(kpi.totalBiayaSolar/1000000)}`, unit: `Jt Rp • ${formatNumber(kpi.totalBiaya?kpi.totalBiayaSolar/kpi.totalBiaya*100:0,0)}%`, icon: 'fuel' },
    { label: 'Biaya Upah', value: `${formatInt(kpi.totalBiayaUpah/1000000)}`, unit: `Jt Rp • ${formatNumber(kpi.totalBiaya?kpi.totalBiayaUpah/kpi.totalBiaya*100:0,0)}%`, icon: 'users' },
    { label: 'Biaya Alat', value: `${formatInt(kpi.totalBiayaAlat/1000000)}`, unit: `Jt Rp • ${formatNumber(kpi.totalBiaya?kpi.totalBiayaAlat/kpi.totalBiaya*100:0,0)}%`, icon: 'settings' },
    { label: 'Biaya Rp/Ha', value: `${formatInt(kpi.rpPerHaOps)}`, unit: `Rp/Ha • ${formatNumber(kpi.totalLuasSiram,0)} Ha`, icon: 'calculator' },
    { label: 'Solar Ltr/Ha', value: `${formatNumber(kpi.avgSolarPerHa,1)}`, unit: 'L/Ha', icon: 'droplet' },
    { label: 'Waiting Time', value: `${formatNumber(kpi.avgWaiting,2)}`, unit: 'Jam', icon: 'pause' },
    { label: 'Air Terpakai', value: `${formatInt(kpi.totalAir)}`, unit: 'L', icon: 'waves' },
  ];
  secondary.innerHTML = secCards.map(c => `
    <div class="rounded-[16px] border border-slate-200/60 bg-white px-4 py-3 shadow-soft flex items-center justify-between">
      <div>
        <div class="text-[10px] font-semibold uppercase tracking-wider text-slate-400">${c.label}</div>
        <div class="mt-1 flex items-baseline gap-1"><span class="text-[16px] font-bold text-slate-900">${c.value}</span><span class="text-[11px] text-slate-500">${c.unit}</span></div>
      </div>
      <div class="flex h-8 w-8 items-center justify-center rounded-full bg-slate-50 text-slate-500"><i data-lucide="${c.icon}" class="h-4 w-4"></i></div>
    </div>
  `).join('');
  refreshIcons();
  updateTicker();
  $('#solarTotal').textContent = formatInt(kpi.totalSolar);
  $('#solarAvg').textContent = formatNumber(kpi.avgSolarPerJam,2);
  $('#avgPrepare').textContent = formatNumber(kpi.avgPrepare,2)+'h';
  $('#avgOperating').textContent = formatNumber(kpi.avgOperating,2)+'h';
  $('#avgWaiting').textContent = formatNumber(kpi.avgWaiting,2)+'h';
  $('#avgKec').textContent = formatNumber(kpi.avgKecepatan,1);
  $('#avgTebal').textContent = formatNumber(kpi.avgTebal,1);
}

// Ticker header: ringkas, selalu tampil di semua tab
function updateTicker() {
  const ticker = $('#headerTicker');
  if (!ticker) return;
  const kpi = calculateKPIs();
  if (!kpi) return;
  const items = [
    { l:'Luas Siram', v:`${formatNumber(kpi.totalLuasSiram,1)} Ha`, c:'text-emerald-600' },
    { l:'Solar', v:`${formatInt(kpi.totalSolar)} L`, c:'text-amber-600' },
    { l:'Total Biaya', v:formatRupiahShort(kpi.totalBiaya), c:'text-slate-900' },
    { l:'Rp/Ha', v:`Rp ${formatInt(kpi.rpPerHaOps)}`, c:'text-slate-900' },
    { l:'Ha/Jam', v:formatNumber(kpi.avgHaPerJam,3), c:'text-emerald-600' },
    { l:'Ltr/Ha', v:formatNumber(kpi.avgSolarPerHa,1), c:'text-amber-600' },
    { l:'Util', v:`${formatNumber(kpi.avgUtilization,1)}%`, c:'text-slate-900' },
    { l:'Avail', v:`${formatNumber(kpi.avgAvailability,1)}%`, c:'text-slate-900' }
  ];
  ticker.innerHTML = items.map(i=>`<span class="inline-flex items-center gap-1.5"><span class="text-[10px] uppercase tracking-wider text-slate-400">${i.l}</span><span class="font-semibold ${i.c}">${i.v}</span></span>`).join('<span class="h-3 w-px flex-shrink-0 bg-slate-200"></span>');
}

// ===== OVERVIEW: ringkasan garis besar semua wilayah =====
function renderOverviewWilayah() {
  const cont = $('#overviewWilayahCards');
  if (!cont) return;
  const stats = getWilayahStats();
  const meta = $('#overviewWilayahMeta');
  if (!stats.length) {
    cont.innerHTML = '<div class="col-span-2 md:col-span-4 py-6 text-center text-[12px] text-slate-400">Tidak ada data wilayah untuk filter ini</div>';
    if (meta) meta.textContent = '-';
    return;
  }
  const maxLuas = Math.max(...stats.map(x=>x.totalLuas)) || 1;
  const totalRec = stats.reduce((a,b)=>a+b.count,0);
  if (meta) meta.textContent = `${stats.length} wilayah • ${formatInt(totalRec)} aktivitas`;
  cont.innerHTML = stats.map(x=>{
    const pct = Math.max(2, x.totalLuas/maxLuas*100);
    const rpHa = x.rpPerHa !== undefined ? x.rpPerHa : (x.totalLuas ? x.totalBiaya/x.totalLuas : 0);
    return `
      <div class="group rounded-xl border border-slate-200 bg-slate-50/40 p-3 transition hover:border-emerald-300 hover:bg-white">
        <div class="flex items-center justify-between">
          <span class="text-[11px] font-bold text-slate-900">${esc(x.wilayah)}</span>
          <span class="rounded-full bg-white px-2 py-0.5 text-[10px] font-medium text-slate-500 ring-1 ring-slate-200">${formatInt(x.count)} rec</span>
        </div>
        <div class="mt-2 text-[17px] font-bold tracking-tight text-slate-900">${formatNumber(x.totalLuas,1)} <span class="text-[10px] font-medium text-slate-400">Ha</span></div>
        <div class="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-200/70"><div class="h-full rounded-full bg-emerald-500" style="width:${pct}%"></div></div>
        <div class="mt-2 grid grid-cols-2 gap-1.5 text-[10px]">
          <div class="rounded-lg bg-white px-2 py-1.5 ring-1 ring-slate-100"><div class="text-slate-400">Solar</div><div class="font-semibold text-amber-700">${formatInt(x.totalSolar)} L</div></div>
          <div class="rounded-lg bg-white px-2 py-1.5 ring-1 ring-slate-100"><div class="text-slate-400">Rp/Ha</div><div class="font-semibold text-slate-900">${formatInt(rpHa)}</div></div>
          <div class="rounded-lg bg-white px-2 py-1.5 ring-1 ring-slate-100"><div class="text-slate-400">Ha/Jam</div><div class="font-semibold text-emerald-700">${formatNumber(x.avgHaPerJam,3)}</div></div>
          <div class="rounded-lg bg-white px-2 py-1.5 ring-1 ring-slate-100"><div class="text-slate-400">Ltr/Ha</div><div class="font-semibold text-slate-900">${formatNumber(x.avgSolarPerHa,1)}</div></div>
        </div>
      </div>
    `;
  }).join('');
}

// Render isi satu tab saja (dipakai oleh updateAll & activateTab)
function renderTab(tab) {
  if (!rawData.length) return;
  if (tab === 'overview') { safeRender('kpi', renderKPIs); safeRender('overviewWilayah', renderOverviewWilayah); safeRender('charts-ovw', () => renderCharts('overview')); }
  else if (tab === 'wilayah') { safeRender('charts-wil', () => renderCharts('wilayah')); safeRender('wilayahDetail', renderWilayahDetail); }
  else if (tab === 'biaya') { safeRender('biaya', renderBiaya); }
  else if (tab === 'utilisasi') { safeRender('charts-util', () => renderCharts('utilisasi')); }
  else if (tab === 'data') { safeRender('table', renderTable); }
  dirtyTabs.delete(tab);
}

// ===== TAB NAVIGATION =====
function activateTab(tab, skipScroll) {
  if (TAB_IDS.indexOf(tab) === -1) tab = 'overview';
  $$('.tab-panel').forEach(p=>{ p.classList.toggle('hidden', p.id !== 'tab-'+tab); });
  $$('.tab-btn').forEach(b=>{
    const on = b.dataset.tab === tab;
    b.className = 'tab-btn inline-flex flex-shrink-0 items-center gap-2 rounded-full px-4 py-2 text-[12px] font-medium transition ' +
      (on ? 'bg-slate-900 text-white shadow-soft' : 'text-slate-600 hover:bg-slate-100');
    b.setAttribute('aria-selected', on ? 'true' : 'false');
    b.setAttribute('tabindex', on ? '0' : '-1');
    if (on && b.scrollIntoView) {
      try { b.scrollIntoView({ block:'nearest', inline:'center', behavior:'smooth' }); } catch(e) {}
    }
  });
  currentTab = tab;
  try { localStorage.setItem('pg2-tab', tab); } catch(e) {}
  try { if (history.replaceState) history.replaceState(null, '', '#'+tab); } catch(e) {}

  if (!rawData.length) return;
  const raf = (window.requestAnimationFrame || function(cb){ setTimeout(cb,16); });
  raf(()=>{
    renderTab(tab);
    // resize hanya chart milik tab aktif (chart di panel tersembunyi berukuran 0)
    const panel = document.getElementById('tab-' + tab);
    if (panel) panel.querySelectorAll('canvas').forEach(cv => { const ch = charts[cv.id]; if (ch) { try { ch.resize(); } catch(e) {} } });
    refreshIcons();
    if (!skipScroll) {
      const nav = document.querySelector('nav[aria-label="Navigasi tab dashboard"]');
      if (nav) {
        const y = nav.getBoundingClientRect().top + window.pageYOffset - (headerHeight() + 16);
        window.scrollTo({ top: Math.max(0, Math.round(y)), behavior: 'smooth' });
      } else {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    }
  });
}

function initTabNav() {
  const btns = Array.from($$('.tab-btn'));
  btns.forEach(b=>{
    if (b.dataset.bound) return;
    b.dataset.bound = '1';
    b.addEventListener('click', ()=> activateTab(b.dataset.tab));
    // Navigasi keyboard: panah kiri/kanan, Home/End (standar tab ARIA)
    b.addEventListener('keydown', (e)=>{
      const i = btns.indexOf(b);
      let next = null;
      if (e.key === 'ArrowRight') next = btns[(i + 1) % btns.length];
      else if (e.key === 'ArrowLeft') next = btns[(i - 1 + btns.length) % btns.length];
      else if (e.key === 'Home') next = btns[0];
      else if (e.key === 'End') next = btns[btns.length - 1];
      if (next) { e.preventDefault(); activateTab(next.dataset.tab, true); next.focus(); }
    });
  });
  let saved = '';
  try { saved = (location.hash||'').replace('#','') || localStorage.getItem('pg2-tab') || ''; } catch(e) { saved = ''; }
  activateTab(TAB_IDS.indexOf(saved) !== -1 ? saved : 'overview', true);
}

function ensureChart(id, config) {
  const ctx = document.getElementById(id);
  if (!ctx) return null;
  if (charts[id]) {
    charts[id].data = config.data;
    charts[id].options = config.options;
    charts[id].update();
    return charts[id];
  } else {
    const chart = new Chart(ctx, config);
    charts[id] = chart;
    return chart;
  }
}

// Peta chart -> tab pemiliknya, agar hanya chart pada tab aktif yang dirender
const CHART_TAB_OF = {
  chartSolar:'overview', chartLuas:'overview', chartJam:'overview', chartKecepatan:'overview',
  chartEfisiensi:'overview', chartWilayah:'wilayah', chartWilayahEff:'wilayah', chartWilayahCompare:'wilayah',
  chartJenisEngine:'utilisasi', chartAvail:'utilisasi', chartScatter:'utilisasi'
};
function renderCharts(tab) {
  const want = (id) => !tab || !CHART_TAB_OF[id] || CHART_TAB_OF[id] === tab;

  const agg = getAggregated(granularity);
  const labels = agg.map(a=>a.label);
  if (want('chartSolar')) ensureChart('chartSolar', {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { type: 'bar', label: 'Solar Terpakai (L)', data: agg.map(a=>a.totalSolar), backgroundColor: 'rgba(245,158,11,0.85)', borderRadius: 8, borderSkipped: false, yAxisID: 'y' },
        { type: 'line', label: 'Avg Ltr/Jam', data: agg.map(a=>a.avgSolarPerJam), borderColor: '#0f172a', backgroundColor: '#0f172a', tension: 0.4, pointRadius: 0, borderWidth: 2, yAxisID: 'y1' }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: { legend: { display: true, position: 'bottom', labels: { usePointStyle: true, font:{size:11}}}, tooltip: { backgroundColor: '#0f172a', titleFont:{size:11}, bodyFont:{size:11}, padding:10, cornerRadius:12 } },
      scales: {
        x: { grid:{display:false}, ticks:{font:{size:10}, maxRotation:45, autoSkip:true, maxTicksLimit:12} },
        y: { beginAtZero:true, grid:{color:'#f1f5f9'}, ticks:{font:{size:10}} , title:{display:true,text:'Total Solar (L)',font:{size:10}} },
        y1: { beginAtZero:true, position:'right', grid:{display:false}, ticks:{font:{size:10}}, title:{display:true,text:'Ltr/Jam',font:{size:10}} }
      }
    }
  });

  // Luas Siram - now single dataset (Luas Cek removed)
  if (want('chartLuas')) ensureChart('chartLuas', {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'Luas Siram (Ha)', data: agg.map(a=>a.totalLuasSiram), backgroundColor: 'rgba(16,185,129,0.85)', borderRadius: 8, borderSkipped: false },
      ]
    },
    options: {
      responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{position:'bottom', labels:{usePointStyle:true,font:{size:11}}}, tooltip:{backgroundColor:'#0f172a',cornerRadius:12} },
      scales:{ x:{grid:{display:false}, ticks:{font:{size:10}, maxTicksLimit:10}}, y:{beginAtZero:true, grid:{color:'#f1f5f9'}, ticks:{font:{size:10}}, title:{display:true,text:'Ha',font:{size:10}}} }
    }
  });

  if (want('chartJam')) ensureChart('chartJam', {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'Prepare', data: agg.map(a=>a.avgPrepare), backgroundColor: '#e2e8f0', stack:'time', borderRadius:4 },
        { label: 'Operating', data: agg.map(a=>a.avgOperating), backgroundColor: '#3b82f6', stack:'time', borderRadius:4 },
        { label: 'Waiting', data: agg.map(a=>a.avgWaiting), backgroundColor: '#f59e0b', stack:'time', borderRadius:4 },
      ]
    },
    options: {
      responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{position:'bottom', labels:{usePointStyle:true,font:{size:10}}}, tooltip:{backgroundColor:'#0f172a',cornerRadius:12} },
      scales:{ x:{stacked:true, grid:{display:false}, ticks:{font:{size:9}, maxTicksLimit:8}}, y:{stacked:true, beginAtZero:true, grid:{color:'#f1f5f9'}, ticks:{font:{size:10}}, title:{display:true,text:'Jam',font:{size:10}}} }
    }
  });

  if (want('chartKecepatan')) ensureChart('chartKecepatan', {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'Kecepatan', data: agg.map(a=>a.avgKecepatan), borderColor:'#8b5cf6', backgroundColor:'rgba(139,92,246,0.1)', tension:0.4, fill:true, pointRadius:0, borderWidth:2 },
        { label: 'Tebal Siram', data: agg.map(a=>a.avgTebal), borderColor:'#06b6d4', backgroundColor:'rgba(6,182,214,0.1)', tension:0.4, fill:true, pointRadius:0, borderWidth:2, yAxisID:'y1' }
      ]
    },
    options:{
      responsive:true, maintainAspectRatio:false,
      interaction:{mode:'index',intersect:false},
      plugins:{ legend:{position:'bottom', labels:{usePointStyle:true,font:{size:10}}}, tooltip:{backgroundColor:'#0f172a',cornerRadius:12} },
      scales:{ x:{grid:{display:false}, ticks:{font:{size:9}, maxTicksLimit:8}}, y:{beginAtZero:false, grid:{color:'#f1f5f9'}, ticks:{font:{size:10}}}, y1:{position:'right', grid:{display:false}, ticks:{font:{size:10}}} }
    }
  });

  if (want('chartEfisiensi')) ensureChart('chartEfisiensi', {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label:'Ha/Jam', data: agg.map(a=>a.avgHaPerJam), borderColor:'#10b981', backgroundColor:'#10b981', tension:0.4, pointRadius:0, borderWidth:2, yAxisID:'y' },
        { label:'Solar Ltr/Ha', data: agg.map(a=>a.avgSolarPerHa), borderColor:'#f59e0b', backgroundColor:'#f59e0b', tension:0.4, pointRadius:0, borderWidth:2, yAxisID:'y1' },
        { label:'Rp/Ha', data: agg.map(a=>a.avgRpPerHa), borderColor:'#0f172a', backgroundColor:'#0f172a', tension:0.4, pointRadius:0, borderWidth:1.5, borderDash:[5,3], yAxisID:'y2', hidden:true }
      ]
    },
    options:{
      responsive:true, maintainAspectRatio:false,
      interaction:{mode:'index',intersect:false},
      plugins:{
        legend:{position:'bottom', labels:{usePointStyle:true,font:{size:9},boxWidth:8}},
        tooltip:{backgroundColor:'#0f172a',cornerRadius:12, callbacks:{ label: ctx=> `${ctx.dataset.label}: ${ctx.dataset.label==='Rp/Ha' ? formatRupiah(ctx.raw) : formatNumber(ctx.raw, ctx.dataset.label==='Ha/Jam'?3:2)}` }}
      },
      scales:{
        x:{grid:{display:false}, ticks:{font:{size:9}, maxTicksLimit:8}},
        y:{grid:{color:'#f1f5f9'}, ticks:{font:{size:10}}, title:{display:true,text:'Ha/Jam',font:{size:9}}},
        y1:{position:'right', grid:{display:false}, ticks:{font:{size:10}}, title:{display:true,text:'Ltr/Ha',font:{size:9}}},
        y2:{display:false, beginAtZero:true}
      }
    }
  });

  // Performa per Wilayah - dynamic metric focused on pemakaian & hasil rata-rata
  const wilayahStatsForChart = getWilayahStats();
  const wilayahLabels = wilayahStatsForChart.map(s=>s.wilayah);
  // Determine data based on wilayahMetric (termasuk analisa biaya)
  const WMETRIC = {
    luas:      { get:s=>s.totalLuas,      label:'Total Luas Siram (Ha)',        color:'rgba(16,185,129,0.85)', fmt:'ha' },
    solar:     { get:s=>s.totalSolar,     label:'Total Solar (L)',              color:'rgba(245,158,11,0.85)', fmt:'l' },
    avgLuas:   { get:s=>s.avgLuas,        label:'Avg Luas / Aktivitas (Ha)',   color:'rgba(16,185,129,0.65)', fmt:'ha' },
    avgSolar:  { get:s=>s.avgSolar,       label:'Avg Solar / Aktivitas (L)',   color:'rgba(245,158,11,0.65)', fmt:'l' },
    haPerJam:  { get:s=>s.avgHaPerJam,    label:'Avg Ha/Jam (Produktivitas)',  color:'rgba(16,185,129,0.95)', fmt:'num3' },
    ltrPerHa:  { get:s=>s.avgSolarPerHa,  label:'Avg Ltr/Ha (Efisiensi)',      color:'rgba(239,68,68,0.75)',  fmt:'num1' },
    ltrPerJam: { get:s=>s.avgSolarPerJam, label:'Avg Ltr/Jam',                 color:'rgba(245,158,11,0.75)', fmt:'num1' },
    operating: { get:s=>s.avgOperating,   label:'Avg Jam Operasi (Jam)',       color:'rgba(59,130,246,0.85)', fmt:'num1' },
    kecepatan: { get:s=>s.avgKecepatan,   label:'Avg Kecepatan (m/menit)',     color:'rgba(139,92,246,0.85)', fmt:'num1' },
    tebal:     { get:s=>s.avgTebal,       label:'Avg Tebal Siram (mm)',        color:'rgba(6,182,214,0.85)',  fmt:'num1' },
    util:      { get:s=>s.avgUtilization, label:'Avg % Utilization',           color:'rgba(15,23,42,0.75)',   fmt:'pct' },
    rpPerHa:   { get:s=>s.avgRpPerHa,     label:'Avg Rp/Ha (Biaya)',           color:'rgba(100,116,139,0.85)',fmt:'rp' },
    totalBiaya:{ get:s=>s.biayaTotal||s.totalBiaya, label:'Total Biaya Irigasi (Rp)', color:'rgba(245,158,11,0.9)', fmt:'rp' },
    biayaSolar:{ get:s=>(s.biayaSolar||0),  label:'Biaya Solar (Rp)',          color:'rgba(245,158,11,0.85)', fmt:'rp' },
    biayaUpah: { get:s=>(s.biayaUpah||0),   label:'Biaya Upah (Rp)',           color:'rgba(59,130,246,0.8)',  fmt:'rp' },
    biayaAlat: { get:s=>(s.biayaAlat||0),   label:'Biaya Alat (Rp)',           color:'rgba(139,92,246,0.8)',  fmt:'rp' },
    rpPerJam:  { get:s=>(s.rpPerJam!==undefined?s.rpPerJam:(s.totalOperating?s.totalBiaya/s.totalOperating:0)), label:'Biaya Rp/Jam Operasi', color:'rgba(14,116,144,0.85)', fmt:'rp' },
    rpPerLiter:{ get:s=>(s.rpPerLiter!==undefined?s.rpPerLiter:0), label:'Biaya Rp/Liter Solar', color:'rgba(190,24,93,0.8)', fmt:'rp' }
  };
  const wm = WMETRIC[wilayahMetric] || WMETRIC.luas;
  const fmtVal = (v) => wm.fmt==='ha' ? formatNumber(v,2)+' Ha'
    : wm.fmt==='l' ? formatInt(v)+' L'
    : wm.fmt==='rp' ? formatRupiah(v)
    : wm.fmt==='pct' ? formatNumber(v,1)+'%'
    : wm.fmt==='num3' ? formatNumber(v,3)
    : formatNumber(v,2);
  const wilayahData = wilayahStatsForChart.map(wm.get);
  const wilayahLabel = wm.label;
  const wilayahColor = wm.color;

  if (want('chartWilayah')) ensureChart('chartWilayah', {
    type: 'bar',
    data: {
      labels: wilayahLabels,
      datasets: [
        { label: wilayahLabel, data: wilayahData, backgroundColor: wilayahColor, borderRadius: 8, borderSkipped:false }
      ]
    },
    options:{
      responsive:true, maintainAspectRatio:false, indexAxis:'y',
      plugins:{
        legend:{display:false},
        tooltip:{
          backgroundColor:'#0f172a', cornerRadius:12,
          callbacks:{
            label: ctx=> `${ctx.dataset.label}: ${fmtVal(ctx.raw)}`
          }
        }
      },
      scales:{ x:{beginAtZero:true, grid:{color:'#f1f5f9'}, ticks:{font:{size:10}}}, y:{grid:{display:false}, ticks:{font:{size:11}}} }
    }
  });

  // Render detailed wilayah analysis (table + bubble + compare)
  renderWilayahDetail();

  const jenisGroups = {};
  filteredData.forEach(d=>{
    const k = d.jenisEngine || 'Unknown';
    if (!jenisGroups[k]) jenisGroups[k]=0;
    jenisGroups[k]+=d.luasSiram;
  });
  const jenisLabels = Object.keys(jenisGroups);
  const jenisValues = jenisLabels.map(k=>jenisGroups[k]);
  const colors = ['#10b981','#3b82f6','#f59e0b','#8b5cf6','#06b6d4','#ef4444','#64748b'];
  if (want('chartJenisEngine')) ensureChart('chartJenisEngine', {
    type: 'doughnut',
    data: {
      labels: jenisLabels,
      datasets: [{ data: jenisValues, backgroundColor: jenisLabels.map((_,i)=>colors[i%colors.length]), borderWidth:0, hoverOffset:8 }]
    },
    options:{
      responsive:true, maintainAspectRatio:false, cutout:'68%',
      plugins:{ legend:{display:false}, tooltip:{backgroundColor:'#0f172a',cornerRadius:12} }
    }
  });
  $('#jenisEngineLegend').innerHTML = jenisLabels.map((l,i)=>{
    const pct = jenisValues[i]/ (jenisValues.reduce((a,b)=>a+b,0) ||1) *100;
    return `<div class="flex items-center justify-between text-[11px]"><div class="flex items-center gap-2"><span class="h-2.5 w-2.5 rounded-full" style="background:${colors[i%colors.length]}"></span><span class="font-medium text-slate-700">${esc(l)}</span></div><span class="font-mono text-slate-500">${formatNumber(pct,1)}%</span></div>`;
  }).join('');

  const engineMap = {};
  const irigatorMap = {};
  filteredData.forEach(d=>{
    engineMap[d.engine] = (engineMap[d.engine]||0)+d.luasSiram;
    irigatorMap[d.irigator] = (irigatorMap[d.irigator]||0)+d.luasSiram;
  });
  const topEngine = Object.entries(engineMap).sort((a,b)=>b[1]-a[1]).slice(0,5);
  const topIrigator = Object.entries(irigatorMap).sort((a,b)=>b[1]-a[1]).slice(0,5);
  $('#topEngine').innerHTML = topEngine.map(([k,v],i)=>`
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-2.5"><span class="flex h-6 w-6 items-center justify-center rounded-full bg-slate-100 text-[10px] font-bold text-slate-600">${i+1}</span><span class="text-[12px] font-medium text-slate-800 font-mono">${esc(k)}</span></div>
      <span class="text-[12px] font-semibold text-slate-900">${formatNumber(v,2)} Ha</span>
    </div>
  `).join('') || '<div class="text-[11px] text-slate-400">No data</div>';
  $('#topIrigator').innerHTML = topIrigator.map(([k,v],i)=>`
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-2.5"><span class="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-50 text-[10px] font-bold text-emerald-700">${i+1}</span><span class="text-[12px] font-medium text-slate-800 font-mono">${esc(k)}</span></div>
      <span class="text-[12px] font-semibold text-slate-900">${formatNumber(v,2)} Ha</span>
    </div>
  `).join('') || '<div class="text-[11px] text-slate-400">No data</div>';

  if (want('chartAvail')) ensureChart('chartAvail', {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label:'% Availability', data: agg.map(a=>a.avgAvailability), borderColor:'#10b981', backgroundColor:'rgba(16,185,129,0.08)', fill:true, tension:0.4, pointRadius:0, borderWidth:2 },
        { label:'% Utilization', data: agg.map(a=>a.avgUtilization), borderColor:'#0f172a', backgroundColor:'rgba(15,23,42,0.06)', fill:true, tension:0.4, pointRadius:0, borderWidth:2 }
      ]
    },
    options:{
      responsive:true, maintainAspectRatio:false,
      interaction:{mode:'index',intersect:false},
      plugins:{ legend:{position:'bottom', labels:{usePointStyle:true,font:{size:10}}}, tooltip:{backgroundColor:'#0f172a',cornerRadius:12} },
      scales:{ x:{grid:{display:false}, ticks:{font:{size:9}, maxTicksLimit:8}}, y:{min:0,max:100, grid:{color:'#f1f5f9'}, ticks:{font:{size:10}, callback:v=>v+'%'}} }
    }
  });

  const scatterData = filteredData.slice(0,800).map(d=>({ x:d.haPerJam, y:d.solarPerHa, wilayah:d.wilayah }));
  const wilayahColorMap = {};
  wilayahLabels.forEach((w,i)=>wilayahColorMap[w]=colors[i%colors.length]);
  if (want('chartScatter')) ensureChart('chartScatter', {
    type: 'scatter',
    data: {
      datasets: Object.keys(wilayahColorMap).map(w=>{
        const pts = scatterData.filter(p=>p.wilayah===w).map(p=>({x:p.x,y:p.y}));
        return { label:w, data:pts, backgroundColor:wilayahColorMap[w]+'CC', pointRadius:4, pointHoverRadius:6 };
      })
    },
    options:{
      responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{position:'bottom', labels:{usePointStyle:true,font:{size:10}}}, tooltip:{backgroundColor:'#0f172a',cornerRadius:12, callbacks:{ label: ctx=> `${ctx.dataset.label}: ${formatNumber(ctx.parsed.x,3)} Ha/Jam, ${formatNumber(ctx.parsed.y,1)} L/Ha` } } },
      scales:{ x:{ title:{display:true,text:'Ha/Jam (Produktivitas)',font:{size:10}}, grid:{color:'#f1f5f9'}, ticks:{font:{size:10}} }, y:{ title:{display:true,text:'Solar Ltr/Ha (Efisiensi)',font:{size:10}}, grid:{color:'#f1f5f9'}, ticks:{font:{size:10}} } }
    }
  });
}

function renderInsights() {
  const kpi = calculateKPIs();
  const container = $('#insights');
  if (!kpi) { container.innerHTML = '<div class="text-slate-400">Tidak ada data</div>'; return; }
  const agg = getAggregated(granularity);
  const { worstSolar, bestEff } = memo('insightExtremes', () => {
    let w = null, b = null;
    for (let i = 0; i < filteredData.length; i++) {
      const d = filteredData[i];
      if (!w || d.solarPerHa > w.solarPerHa) w = d;
      if (!b || d.haPerJam > b.haPerJam) b = d;
    }
    return { worstSolar: w, bestEff: b };
  });
  const insights = [];
  insights.push(`Total <b>${formatNumber(kpi.totalLuasSiram,1)} Ha</b> disiram dengan <b>${formatInt(kpi.totalSolar)} L</b> solar dalam ${kpi.totalRecords} aktivitas.`);
  if (kpi.avgUtilization < 70) insights.push(`Utilisasi rendah <b>${formatNumber(kpi.avgUtilization,1)}%</b> - cek waiting & downtime.`);
  else insights.push(`Utilisasi baik <b>${formatNumber(kpi.avgUtilization,1)}%</b> dengan availability <b>${formatNumber(kpi.avgAvailability,1)}%</b>.`);
  if (worstSolar) insights.push(`Boros tertinggi: <b>${worstSolar.engine}</b> di ${worstSolar.lokasi} dengan ${formatNumber(worstSolar.solarPerHa,1)} L/Ha.`);
  if (bestEff) insights.push(`Produktif tertinggi: <b>${bestEff.engine}</b> ${formatNumber(bestEff.haPerJam,3)} Ha/Jam pada ${formatDate(bestEff.date)}.`);
  if (agg.length >=2) {
    const last = agg[agg.length-1], prev = agg[agg.length-2];
    const diff = last.totalSolar - prev.totalSolar;
    const pct = prev.totalSolar ? diff/prev.totalSolar*100 : 0;
    insights.push(`Trend solar ${granularity}: <b>${pct>=0?'+':''}${formatNumber(pct,1)}%</b> vs periode sebelumnya.`);
  }
  container.innerHTML = insights.map(t=>`<div class="flex gap-2"><span class="mt-1 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-emerald-500"></span><span>${t}</span></div>`).join('');
}

function renderTable() {
  const tbody = $('#dataTableBody');
  let data = [...filteredData];
  data.sort((a,b)=>{
    let av = a[sortField], bv = b[sortField];
    if (sortField==='date') { av=a.date; bv=b.date; }
    if (av==null) av=''; if (bv==null) bv='';
    if (typeof av === 'string') { av=av.toLowerCase(); bv=bv.toLowerCase(); }
    if (av < bv) return sortDir==='asc'?-1:1;
    if (av > bv) return sortDir==='asc'?1:-1;
    return 0;
  });
  const total = data.length;
  const totalPages = Math.max(1, Math.ceil(total/pageSize));
  if (currentPage>totalPages) currentPage=totalPages;
  const start = (currentPage-1)*pageSize;
  const pageData = data.slice(start, start+pageSize);
  $('#tableCount').textContent = pageData.length;
  $('#tableTotal').textContent = total;
  $('#pageInfo').textContent = `Page ${currentPage} / ${totalPages}`;
  $('#btnPrevPage').disabled = currentPage<=1;
  $('#btnNextPage').disabled = currentPage>=totalPages;
  if (pageData.length===0) {
    tbody.innerHTML = `<tr><td colspan="14" class="px-4 py-10 text-center text-slate-400">Tidak ada data</td></tr>`;
    return;
  }
  tbody.innerHTML = pageData.map(d=>`
    <tr class="hover:bg-slate-50/80 transition">
      <td class="px-4 py-2.5 whitespace-nowrap font-medium text-slate-900">${formatDate(d.date)}</td>
      <td class="px-4 py-2.5 whitespace-nowrap"><span class="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium">${d.wilayah}</span></td>
      <td class="px-4 py-2.5 whitespace-nowrap font-mono text-[11px]">${d.lokasi}</td>
      <td class="px-4 py-2.5 whitespace-nowrap font-mono text-[11px] font-medium">${d.engine}</td>
      <td class="px-4 py-2.5 whitespace-nowrap font-mono text-[11px]">${d.irigator}</td>
      <td class="px-4 py-2.5 whitespace-nowrap text-right font-semibold">${formatNumber(d.luasSiram,2)}</td>
      <td class="px-4 py-2.5 whitespace-nowrap text-right">${formatNumber(d.operatingTime,1)}</td>
      <td class="px-4 py-2.5 whitespace-nowrap text-right">${formatInt(d.solarTerpakai)}</td>
      <td class="px-4 py-2.5 whitespace-nowrap text-right">${formatNumber(d.solarPerJam,1)}</td>
      <td class="px-4 py-2.5 whitespace-nowrap text-right font-medium text-emerald-700">${formatNumber(d.haPerJam,3)}</td>
      <td class="px-4 py-2.5 whitespace-nowrap text-right">${formatNumber(d.kecepatan,1)}</td>
      <td class="px-4 py-2.5 whitespace-nowrap text-right">${formatNumber(d.tebalSiram,1)}</td>
      <td class="px-4 py-2.5 whitespace-nowrap text-right">${formatNumber(d.availability,1)}%</td>
      <td class="px-4 py-2.5 whitespace-nowrap text-right"><span class="inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium ${d.utilization>=70?'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200':'bg-amber-50 text-amber-700 ring-1 ring-amber-200'}">${formatNumber(d.utilization,1)}%</span></td>
    </tr>
  `).join('');
}

// Teks ringkas di kepala laci filter: berapa filter aktif & berapa record tampil
function updateFilterSheetMeta() {
  const el = $('#filterSheetMeta');
  if (!el) return;
  let n = 0;
  if (filters.wilayah.size) n++;
  if (filters.months.size) n++;
  if (filters.year !== 'all') n++;
  if (filters.jenisEngine !== 'all') n++;
  if (filters.search) n++;
  if (filters.tableSearch) n++;
  if (rawData.length && filters.start && filters.end) {
    const first = rawData[0].date, last = rawData[rawData.length - 1].date;
    const full = filters.start.getTime() <= first.getTime() && filters.end.getTime() >= last.getTime();
    if (!full) n++;
  }
  el.textContent = n
    ? `${n} filter aktif • ${formatInt(filteredData.length)} dari ${formatInt(rawData.length)} records`
    : `Semua data • ${formatInt(rawData.length)} records`;
}

function updateAll() {
  applyFilters();
  updateTicker();
  safeRender('insights', renderInsights);
  renderTab(currentTab);          // hanya tab yang sedang dilihat
  $('#rowCount').textContent = `${formatInt(filteredData.length)} / ${formatInt(rawData.length)} records`;
  updateFilterSheetMeta();
  scheduleIdlePrefetch();         // sisanya disiapkan saat browser menganggur
}

// Siapkan tab lain di waktu luang agar perpindahan tab terasa instan
let _idlePrefetchHandle = null;
function scheduleIdlePrefetch() {
  if (_idlePrefetchHandle) { if (window.cancelIdleCallback) cancelIdleCallback(_idlePrefetchHandle); }
  _idlePrefetchHandle = idle(() => {
    _idlePrefetchHandle = null;
    TAB_IDS.forEach(t => { if (t !== currentTab && dirtyTabs.has(t)) renderTab(t); });
  }, { timeout: 2500 });
}

function initFiltersUI() {
  if (rawData.length===0) return;
  const dates = rawData.map(d=>d.date).sort((a,b)=>a-b);
  const minDate = dates[0], maxDate = dates[dates.length-1];
  $('#filterStart').value = formatDateISO(minDate);
  $('#filterEnd').value = formatDateISO(maxDate);
  filters.start = minDate;
  filters.end = maxDate;
  // Satu lintasan: kumpulkan nama wilayah + jumlah recordnya (dulu filter() per wilayah)
  const wilayahCount = {};
  for (let i = 0; i < rawData.length; i++) {
    const w = rawData[i].wilayah;
    wilayahCount[w] = (wilayahCount[w] || 0) + 1;
  }
  const wilayahSet = Object.keys(wilayahCount).sort();
  const wilayahContainer = $('#wilayahCheckboxes');
  wilayahContainer.innerHTML = wilayahSet.map(w=>`
    <label class="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-white cursor-pointer transition">
      <input type="checkbox" value="${esc(w)}" class="wilayah-cb h-3.5 w-3.5 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500">
      <span class="text-[12px] font-medium text-slate-700">${esc(w)}</span>
      <span class="ml-auto text-[10px] font-mono text-slate-400">${formatInt(wilayahCount[w])}</span>
    </label>
  `).join('');
  wilayahContainer.querySelectorAll('.wilayah-cb').forEach(cb=>{
    cb.addEventListener('change', (e)=>{
      if (e.target.checked) filters.wilayah.add(e.target.value);
      else filters.wilayah.delete(e.target.value);
      currentPage=1; updateAll();
    });
  });
  const jenisSet = [...new Set(rawData.map(d=>d.jenisEngine).filter(Boolean))].sort();
  const sel = $('#filterJenisEngine');
  sel.innerHTML = '<option value="all">Semua Jenis</option>' + jenisSet.map(j=>`<option value="${j}">${j}</option>`).join('');
  const yearsSet = [...new Set(rawData.map(d=>d.date.getFullYear()))].sort();
  const yearSel = $('#filterYear');
  if (yearSel) yearSel.innerHTML = '<option value="all">Semua Tahun</option>' + yearsSet.map(y=>`<option value="${y}">${y}</option>`).join('');
  const shortNames = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];
  function renderMonthChips() {
    const container = $('#activeMonthChips');
    if (!container) return;
    if (filters.months.size===0 && filters.year==='all') {
      container.innerHTML = '<span class="text-[10px] text-slate-400">Semua bulan & tahun</span>';
      return;
    }
    let chips = [];
    if (filters.months.size>0) {
      filters.months.forEach(m=>{
        chips.push(`<span class="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-medium text-emerald-700 ring-1 ring-emerald-200">${shortNames[m]} <button data-remove-month="${m}" class="ml-1 rounded-full hover:bg-emerald-100 px-0.5">×</button></span>`);
      });
    }
    if (filters.year!=='all') {
      chips.push(`<span class="inline-flex items-center gap-1 rounded-full bg-slate-900 px-2.5 py-1 text-[10px] font-medium text-white">${filters.year} <button data-remove-year class="ml-1 rounded-full hover:bg-slate-800 px-0.5">×</button></span>`);
    }
    container.innerHTML = chips.join('');
    container.querySelectorAll('[data-remove-month]').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        const m = parseInt(btn.dataset.removeMonth);
        filters.months.delete(m);
        document.querySelectorAll('.month-btn').forEach(b=>{
          if (parseInt(b.dataset.month)===m) {
            b.classList.remove('bg-emerald-600','text-white','border-emerald-600','ring-2','ring-emerald-100');
            b.classList.add('bg-white','text-slate-600','border-slate-200');
          }
        });
        if ($('#filterMonthDropdown')) $('#filterMonthDropdown').value = 'all';
        currentPage=1; updateAll(); renderMonthChips();
      });
    });
    const rmYear = container.querySelector('[data-remove-year]');
    if (rmYear) rmYear.addEventListener('click', ()=>{
      filters.year='all';
      if ($('#filterYear')) $('#filterYear').value='all';
      currentPage=1; updateAll(); renderMonthChips();
    });
  }
  $$('.month-btn').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const m = parseInt(btn.dataset.month);
      if (filters.months.has(m)) {
        filters.months.delete(m);
        btn.classList.remove('bg-emerald-600','text-white','border-emerald-600','ring-2','ring-emerald-100');
        btn.classList.add('bg-white','text-slate-600','border-slate-200');
      } else {
        filters.months.add(m);
        btn.classList.remove('bg-white','text-slate-600','border-slate-200');
        btn.classList.add('bg-emerald-600','text-white','border-emerald-600','ring-2','ring-emerald-100');
      }
      currentPage=1; updateAll(); renderMonthChips();
    });
  });
  const monthDropdown = $('#filterMonthDropdown');
  if (monthDropdown) {
    monthDropdown.addEventListener('change', (e)=>{
      const v = e.target.value;
      if (v==='all') {
        filters.months.clear();
        $$('.month-btn').forEach(b=>{
          b.classList.remove('bg-emerald-600','text-white','border-emerald-600','ring-2','ring-emerald-100');
          b.classList.add('bg-white','text-slate-600','border-slate-200');
        });
      } else {
        const m = parseInt(v);
        filters.months.add(m);
        document.querySelectorAll('.month-btn').forEach(b=>{
          if (parseInt(b.dataset.month)===m) {
            b.classList.remove('bg-white','text-slate-600','border-slate-200');
            b.classList.add('bg-emerald-600','text-white','border-emerald-600','ring-2','ring-emerald-100');
          }
        });
      }
      currentPage=1; updateAll(); renderMonthChips();
    });
  }
  if (yearSel) {
    yearSel.addEventListener('change', (e)=>{
      filters.year = e.target.value;
      currentPage=1; updateAll(); renderMonthChips();
    });
  }
  const btnClearMonth = $('#btnClearMonth');
  if (btnClearMonth) {
    btnClearMonth.addEventListener('click', ()=>{
      filters.months.clear();
      filters.year='all';
      $$('.month-btn').forEach(b=>{
        b.classList.remove('bg-emerald-600','text-white','border-emerald-600','ring-2','ring-emerald-100');
        b.classList.add('bg-white','text-slate-600','border-slate-200');
      });
      if ($('#filterMonthDropdown')) $('#filterMonthDropdown').value='all';
      if ($('#filterYear')) $('#filterYear').value='all';
      currentPage=1; updateAll(); renderMonthChips();
    });
  }
  // Wilayah metric & sort - fokus pemakaian & hasil rata-rata
  const wilayahMetricSel = $('#wilayahMetric');
  if (wilayahMetricSel) {
    wilayahMetricSel.addEventListener('change', (e)=>{
      wilayahMetric = e.target.value;
      $$('.wm-chip').forEach(c=>{
        const on = c.dataset.metric === wilayahMetric;
        c.className = 'wm-chip flex-shrink-0 rounded-full px-3 py-1.5 text-[11px] font-medium transition ' + (on ? 'bg-slate-900 text-white shadow-soft' : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50');
      });
      renderCharts();
    });
  }
  // Quick metric chips untuk chart wilayah
  $$('.wm-chip').forEach(chip=>{
    chip.addEventListener('click', ()=>{
      const sel = $('#wilayahMetric');
      if (sel) sel.value = chip.dataset.metric;
      wilayahMetric = chip.dataset.metric;
      $$('.wm-chip').forEach(c=>{
        const on = c.dataset.metric === wilayahMetric;
        c.className = 'wm-chip flex-shrink-0 rounded-full px-3 py-1.5 text-[11px] font-medium transition ' + (on ? 'bg-slate-900 text-white shadow-soft' : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50');
      });
      renderCharts();
    });
  });
  const wilayahSortSel = $('#wilayahSort');
  if (wilayahSortSel) {
    wilayahSortSel.addEventListener('change', (e)=>{
      wilayahSort = e.target.value;
      renderWilayahDetail();
      renderCharts();
    });
  }
  // Biaya irigasi: granularitas periode & sort wilayah
  const biayaGranSel = $('#biayaGran');
  if (biayaGranSel) {
    biayaGranSel.value = biayaGran;
    biayaGranSel.addEventListener('change', (e)=>{
      biayaGran = e.target.value;
      renderCharts();
      renderBiaya();
    });
  }
  const biayaSortSel = $('#biayaSort');
  if (biayaSortSel) {
    biayaSortSel.value = biayaSort;
    biayaSortSel.addEventListener('change', (e)=>{
      biayaSort = e.target.value;
      renderBiaya();
    });
  }
  renderMonthChips();
  $('#filterStart').addEventListener('change', e=>{ filters.start = parseLocalDate(e.target.value); currentPage=1; updateAll(); });
  $('#filterEnd').addEventListener('change', e=>{ filters.end = parseLocalDate(e.target.value); currentPage=1; updateAll(); });
  // Kembalikan periode tanggal ke seluruh rentang data (pengganti tombol 7H/30H/90H)
  const btnRangeAll = $('#btnRangeAll');
  if (btnRangeAll) {
    btnRangeAll.addEventListener('click', ()=>{
      if (!rawData.length) return;
      const dates = rawData.map(d=>d.date).sort((a,b)=>a-b);
      const minDate = dates[0], maxDate = dates[dates.length-1];
      $('#filterStart').value = formatDateISO(minDate);
      $('#filterEnd').value = formatDateISO(maxDate);
      filters.start = minDate; filters.end = maxDate;
      currentPage=1; updateAll();
    });
  }
  $$('.gran-btn').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      $$('.gran-btn').forEach(b=>{ b.className='gran-btn rounded-lg px-2 py-2 text-[12px] font-medium text-slate-500 hover:text-slate-700'; });
      btn.className='gran-btn rounded-lg bg-white px-2 py-2 text-[12px] font-semibold shadow-sm text-slate-900';
      granularity = btn.dataset.gran;
      $('#solarGranLabel').textContent = granularity==='daily'?'harian':granularity==='weekly'?'mingguan':'bulanan';
      updateAll();
    });
  });
  // Debounce: tidak re-render tiap ketikan (hemat CPU di mobile)
  const onFilterSearch = debounce(e=>{ filters.search = e.target.value.trim(); currentPage=1; updateAll(); }, 220);
  $('#filterSearch').addEventListener('input', onFilterSearch);
  $('#filterSearch').addEventListener('search', onFilterSearch);
  $('#filterJenisEngine').addEventListener('change', e=>{ filters.jenisEngine = e.target.value; currentPage=1; updateAll(); });
  const onTableSearch = debounce(e=>{
    const v = e.target.value.trim();
    // hindari filter 1 huruf (menghasilkan ribuan baris & re-render berat)
    filters.tableSearch = (v.length === 1) ? '' : v;
    currentPage = 1;
    renderTable();
  }, 200);
  $('#tableSearch').addEventListener('input', onTableSearch);
  $('#tableSearch').addEventListener('search', onTableSearch);
  $('#btnClearFilters').addEventListener('click', ()=>{
    filters.wilayah.clear(); filters.months.clear(); filters.year='all'; filters.jenisEngine='all'; filters.search=''; filters.tableSearch='';
    $$('.wilayah-cb').forEach(cb=>cb.checked=false);
    $$('.month-btn').forEach(b=>{ b.classList.remove('bg-emerald-600','text-white','border-emerald-600','ring-2','ring-emerald-100'); b.classList.add('bg-white','text-slate-600','border-slate-200'); });
    $('#filterJenisEngine').value='all';
    if ($('#filterYear')) $('#filterYear').value='all';
    if ($('#filterMonthDropdown')) $('#filterMonthDropdown').value='all';
    $('#filterSearch').value=''; $('#tableSearch').value='';
    const dates = rawData.map(d=>d.date).sort((a,b)=>a-b);
    $('#filterStart').value = formatDateISO(dates[0]); $('#filterEnd').value = formatDateISO(dates[dates.length-1]);
    filters.start = dates[0]; filters.end = dates[dates.length-1];
    currentPage=1; updateAll(); renderMonthChips();
  });
  $('#btnPrevPage').addEventListener('click', ()=>{ if (currentPage>1){ currentPage--; renderTable(); } });
  $('#btnNextPage').addEventListener('click', ()=>{ currentPage++; renderTable(); });
  const psSelect = $('#pageSizeSelect');
  if (psSelect) {
    psSelect.addEventListener('change', (e)=>{
      const newSize = parseInt(e.target.value);
      if (!isNaN(newSize) && newSize>0) {
        pageSize = newSize; currentPage = 1; renderTable();
        const info = $('#pageSizeInfo'); if (info) info.textContent = `• ${pageSize} per halaman`;
      }
    });
  }
  $$('th[data-sort]').forEach(th=>{
    th.addEventListener('click', ()=>{
      const field = th.dataset.sort;
      if (sortField===field) sortDir = sortDir==='asc'?'desc':'asc';
      else { sortField=field; sortDir='asc'; }
      renderTable();
    });
  });
  $('#btnExport').addEventListener('click', ()=>{
    const csv = buildExportCSV(filteredData);
    const blob = new Blob(['\ufeff' + csv], {type:'text/csv;charset=utf-8;'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href=url; a.download=`PG2-ZPAS637-${formatDateISO(new Date())}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(()=>URL.revokeObjectURL(url), 1000);
  });
  $('#btnSync').addEventListener('click', ()=>{ loadData({ manual: true }); });
  // Panel filter: laci penuh (mobile/tablet) atau kolom sticky (desktop)
  const btnFilters = $('#btnFilters');
  if (btnFilters && !btnFilters.dataset.bound) {
    btnFilters.dataset.bound = '1';
    btnFilters.addEventListener('click', toggleFilters);
  }
  const btnCloseFilters = $('#btnCloseFilters');
  if (btnCloseFilters && !btnCloseFilters.dataset.bound) {
    btnCloseFilters.dataset.bound = '1';
    btnCloseFilters.addEventListener('click', () => closeFilters());
  }
  const backdrop = $('#filterBackdrop');
  if (backdrop && !backdrop.dataset.bound) {
    backdrop.dataset.bound = '1';
    backdrop.addEventListener('click', () => closeFilters());
  }
  if (!window.__filterKeysBound) {
    window.__filterKeysBound = true;
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && filtersOpen()) closeFilters();       // Esc menutup laci
    });
    window.addEventListener('resize', debounce(() => {
      syncHeaderOffset();
      if (!filtersAreMobile()) closeFilters(false);                   // kembali ke desktop
    }, 200));
  }
}

// Export CSV internal (pengganti papaparse): escape kutip ganda & pemisah
const EXPORT_COLS = [
  ['Date', d=>formatDateISO(d.date)], ['Wilayah', d=>d.wilayah], ['Lokasi', d=>d.lokasi],
  ['Engine', d=>d.engine], ['Irigator', d=>d.irigator], ['Jenis Engine', d=>d.jenisEngine],
  ['Jenis Irigator', d=>d.jenisIrigator], ['Plan Time', d=>d.planTime], ['Luas Siram', d=>d.luasSiram],
  ['Operating Time', d=>d.operatingTime], ['Prepare Time', d=>d.prepareTime], ['Waiting Time', d=>d.waitingTime],
  ['Solar L', d=>d.solarTerpakai], ['Ltr/Jam', d=>d.solarPerJam], ['Ltr/Ha', d=>d.solarPerHa],
  ['Ha/Jam', d=>d.haPerJam], ['Kecepatan', d=>d.kecepatan], ['Tebal Siram', d=>d.tebalSiram],
  ['Availability', d=>d.availability], ['Utilization', d=>d.utilization],
  ['Biaya Solar', d=>d.biayaSolar], ['Biaya Upah', d=>d.biayaUpah], ['Biaya Alat', d=>d.biayaAlat],
  ['Biaya Total', d=>d.biayaTotal], ['Rp/Ha', d=>d.rpPerHa]
];
function csvCell(v) {
  const s = (v === null || v === undefined) ? '' : String(v);
  return (s.indexOf(',') !== -1 || s.indexOf('"') !== -1 || s.indexOf('\n') !== -1 || s.indexOf(';') !== -1)
    ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function buildExportCSV(rows) {
  const parts = [EXPORT_COLS.map(c=>csvCell(c[0])).join(',')];
  for (let i = 0; i < rows.length; i++) {
    const d = rows[i], line = new Array(EXPORT_COLS.length);
    for (let j = 0; j < EXPORT_COLS.length; j++) line[j] = csvCell(EXPORT_COLS[j][1](d));
    parts.push(line.join(','));
  }
  return parts.join('\r\n');
}

// Notifikasi ringan (tidak menutupi dashboard seperti overlay error)
function showToast(message, type = 'info', ms = 6000) {
  let host = $('#toastHost');
  if (!host) {
    host = document.createElement('div');
    host.id = 'toastHost';
    host.className = 'fixed bottom-4 right-4 z-[60] flex w-[min(92vw,380px)] flex-col gap-2';
    document.body.appendChild(host);
  }
  const styles = {
    info:    { bg:'bg-slate-900',  icon:'info' },
    success: { bg:'bg-emerald-600',icon:'check-circle-2' },
    warn:    { bg:'bg-amber-500',  icon:'alert-triangle' },
    error:   { bg:'bg-red-600',    icon:'alert-octagon' }
  }[type] || { bg:'bg-slate-900', icon:'info' };
  const el = document.createElement('div');
  el.className = `${styles.bg} flex items-start gap-2.5 rounded-2xl px-4 py-3 text-[12px] font-medium text-white shadow-soft-lg opacity-0 transition-opacity duration-300`;
  el.innerHTML = `<i data-lucide="${styles.icon}" class="mt-0.5 h-4 w-4 flex-shrink-0"></i><span class="leading-relaxed">${esc(message)}</span>`;
  host.appendChild(el);
  refreshIcons();
  requestAnimationFrame(()=>{ el.style.opacity = '1'; });
  setTimeout(()=>{ el.style.opacity = '0'; setTimeout(()=> el.remove(), 350); }, ms);
}

function setSyncLabel(ts, fromCache) {
  const el = $('#lastSync'); if (!el) return;
  const jam = new Date(ts).toLocaleTimeString('id-ID');
  const src = fromCache ? 'cache' : (dataSource === 'sample' ? 'contoh' : 'live');
  el.textContent = `Sync ${jam} • ${formatInt(rawData.length)} records • ${src}`;
}

// Terapkan payload ke dashboard: parse (sekali) + filter + render tab aktif
function applyPayload(payload, { fromCache = false } = {}) {
  const t0 = performance.now();
  let rows;
  if (payload.csv) { rows = buildRows(payload.csv, payload.dates); payload.csv = null; payload.dates = null; }
  else { rows = parseGvizJSON(payload.json); payload.json = null; }
  if (!rows.length) throw new Error('Tidak ada baris data yang bisa dibaca');
  rawData = rows;
  appliedSig = payload.sig;
  if (!filtersUIReady) { initFiltersUI(); initTabNav(); filtersUIReady = true; }
  lastMeta = { sig: payload.sig, ts: payload.ts, rows: rows.length };
  writeMeta(lastMeta);
  applyFilters();
  updateTicker();
  safeRender('insights', renderInsights);
  renderTab(currentTab);
  $('#rowCount').textContent = `${formatInt(filteredData.length)} / ${formatInt(rawData.length)} records`;
  setSyncLabel(payload.ts, fromCache);
  console.debug('[data] siap dalam', Math.round(performance.now() - t0), 'ms (', fromCache ? 'cache' : 'jaringan', ')');
}

async function loadData(opts = {}) {
  const { manual = false, silent = false } = (typeof opts === 'boolean') ? { manual: opts } : opts;
  if (isSyncing) {                     // hindari dua unduhan spreadsheet bersamaan
    if (manual) showToast('Sinkronisasi sedang berjalan…', 'info', 2500);
    return;
  }
  isSyncing = true;
  const first = rawData.length === 0;
  const overlay = $('#loadingOverlay');
  if (first && !silent) overlay.style.display = 'flex';
  if (manual) {
    const btn = $('#btnSync');
    if (btn) { btn.innerHTML = '<i data-lucide="loader-2" class="h-4 w-4 animate-spin"></i> Syncing'; refreshIcons(); }
  }
  try {
    // Mulai unduhan dari jaringan lebih dulu, lalu baca cache secara paralel:
    // mana pun yang siap duluan langsung dipakai (tidak saling menunggu).
    const netPromise = fetchPayload();
    if (first) {
      try {
        const tCache = performance.now();
        const cached = await fetchPayload({ preferCache: true });
        console.debug('[data] cache dibaca dalam', Math.round(performance.now() - tCache), 'ms');
        // hanya dipakai kalau memang belum ada data tampil (jangan menimpa data jaringan yang lebih baru)
        if (cached && cached.fromCache && rawData.length === 0) {
          applyPayload(cached, { fromCache: true });
          overlay.style.display = 'none';
        }
      } catch (e) { console.debug('cache tidak tersedia', e); }
    }
    // 2) Data terbaru dari spreadsheet
    const payload = await netPromise;
    const changed = payload.sig !== appliedSig;
    if (changed) {
      dataSource = 'live';
      // simpan mentah untuk kunjungan berikutnya (sebelum teksnya dilepas dari memori)
      if (payload.csv) { cachePut(CSV_URL, payload.csv); if (payload.dates) cachePut(DATES_URL, payload.dates); }
      applyPayload(payload);
      if (!first && !silent) showToast(`Data diperbarui — ${formatInt(rawData.length)} records`, 'success');
    } else {
      setSyncLabel(Date.now(), false);
      if (manual) showToast('Data sudah terbaru', 'info', 3000);
    }
    syncFailures = 0;
  } catch (e) {
    console.error('[sync]', e);
    syncFailures++;
    if (first) {
      // belum ada data sama sekali -> coba file contoh lokal
      try {
        const txt = await fetchText(SAMPLE_URL);
        dataSource = 'sample';
        applyPayload({ csv: txt, dates: null, sig: 'sample', ts: Date.now() }, { fromCache: true });
        showToast('Live sync gagal — memakai data contoh (offline)', 'warn', 9000);
        syncFailures = 0;
      } catch (e2) {
        overlay.innerHTML = `<div class="text-center p-6 max-w-[420px]"><div class="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-red-50 text-red-600"><i data-lucide="alert-triangle" class="h-6 w-6"></i></div><div class="mt-4 text-[13px] font-medium text-slate-900">Gagal memuat data</div><div class="mt-1 text-[11px] text-slate-500">${esc(e.message || 'Tidak dapat menghubungi Google Sheets')}</div><button id="btnRetryLoad" class="mt-4 rounded-full bg-slate-900 px-4 py-2 text-[12px] font-medium text-white">Coba lagi</button></div>`;
        refreshIcons();
        const rb = $('#btnRetryLoad');
        if (rb) rb.addEventListener('click', () => loadData({ manual: true }));
      }
    } else {
      // sudah ada data tampil -> jangan tutupi dashboard, cukup beri tahu
      showToast(`Sinkron gagal (${esc(e.message || 'jaringan')}) — mencoba lagi otomatis`, 'warn', 7000);
      scheduleSync(true);
    }
  } finally {
    isSyncing = false;
    if (overlay) overlay.style.display = 'none';
    if (manual) {
      const btn = $('#btnSync');
      if (btn) { btn.innerHTML = '<i data-lucide="refresh-cw" class="h-4 w-4"></i> Sync'; refreshIcons(); }
    }
  }
}

// Penjadwalan sync: normal 5 menit, atau backoff progresif saat gagal
function scheduleSync(isRetry = false) {
  if (syncTimer) clearTimeout(syncTimer);
  const delay = isRetry ? Math.min(30000 * Math.pow(2, Math.max(0, syncFailures - 1)), AUTO_SYNC_MS) : AUTO_SYNC_MS;
  syncTimer = setTimeout(() => { if (document.visibilityState === 'visible' || isRetry) loadData({ silent: true }); else scheduleSync(); }, delay);
}

document.addEventListener('DOMContentLoaded', () => {
  syncHeaderOffset();
  // Tinggi header bisa berubah (ticker terisi, tombol Install muncul, font selesai dimuat)
  // -> ukur ulang supaya offset panel filter & tab bar selalu pas.
  const headerEl = document.querySelector('header');
  if (headerEl && window.ResizeObserver) {
    try { new ResizeObserver(() => syncHeaderOffset()).observe(headerEl); } catch (e) {}
  }
  window.addEventListener('resize', debounce(syncHeaderOffset, 200));
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(syncHeaderOffset).catch(() => {});

  loadData({ manual: false });
  scheduleSync();
  // hemat baterai & bandwidth: jeda saat tab tidak terlihat, sinkron saat kembali aktif
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      const meta = readMeta();
      if (meta && Date.now() - meta.ts > AUTO_SYNC_MS - 30000) loadData({ silent: true });
    }
  });
  window.addEventListener('online', () => {
    if (!wasOffline) return;            // browser kadang memicu 'online' saat halaman baru dibuka
    wasOffline = false;
    showToast('Kembali online — menyinkronkan data', 'info', 4000);
    loadData({ silent: true });
  });
  window.addEventListener('offline', () => { wasOffline = true; showToast('Koneksi terputus — menampilkan data terakhir', 'warn', 6000); });
});
