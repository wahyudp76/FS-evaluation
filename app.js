// PG2 Irrigation Evaluation Dashboard - ZPAS637
// Auto-sync to Google Sheets ID: 1mhXxr7cfdnS-A_gJ6E4aixGRSzINdGP94orr-2lL45o
// Updated: sheet ZPAS637 = 35 kolom A..AI (kolom bantu 'R Bulan' di A), parsing berbasis label
const SPREADSHEET_ID = '1mhXxr7cfdnS-A_gJ6E4aixGRSzINdGP94orr-2lL45o';
const SHEET_NAME = 'ZPAS637';
const GVIZ_BASE = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq`;
// CSV = sumber data utama (payload ~46% lebih kecil dari JSON gviz)
const CSV_URL = `${GVIZ_BASE}?tqx=out:csv&sheet=${SHEET_NAME}`;
// Query kecil khusus kolom tanggal: hanya ~3 KB terkompresi, memberi tanggal + tahun yang akurat.
// Kolom tanggal sheet ZPAS637 = kolom B ("Date"); kolom A kini berisi bantu "R Bulan".
// Huruf kolom dihitung ulang otomatis dari header CSV bila susunan kolom sheet berubah lagi.
const DATE_COL = 'B';
const datesUrlFor = (letter) => `${GVIZ_BASE}?tq=${encodeURIComponent('select ' + letter)}&tqx=out:json&sheet=${SHEET_NAME}`;
const DATES_URL = datesUrlFor(DATE_COL);
// JSON penuh dipakai hanya sebagai fallback bila CSV bermasalah
const GVIZ_URL = `${GVIZ_BASE}?tqx=out:json&sheet=${SHEET_NAME}`;
const INDEX_SHEET = 'Index Solar';
const INDEX_URL = `${GVIZ_BASE}?tqx=out:csv&sheet=${encodeURIComponent(INDEX_SHEET)}`;
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
// Mode tampilan waktu pada tab "Waktu & Utilisasi": rata-rata per aktivitas (bawaan),
// rata-rata per hari, atau total. Dipakai kartu, tabel per wilayah, dan chart komposisi.
let waktuMode = 'avgAkt';
let waktuMetric = 'operating';
const WAKTU_MODES = {
  avgAkt: { id:'avgAkt', label:'Rata-rata / Aktivitas', satJam:'jam/aktivitas', satAir:'L/aktivitas', satPendek:'jam/akt',  nilai:g => g.count || 1 },
  avgHari:{ id:'avgHari',label:'Rata-rata / Hari',      satJam:'jam/hari',      satAir:'L/hari',      satPendek:'jam/hari', nilai:g => g.hari || 1 },
  total:  { id:'total',  label:'Total',                 satJam:'jam',           satAir:'L',           satPendek:'jam',      nilai:()=>1 }
};
const modeWaktu = () => WAKTU_MODES[waktuMode] || WAKTU_MODES.avgAkt;
// Mode tampilan biaya pada tab "Analisa Biaya": total (bawaan), rata-rata per aktivitas, rata-rata per hari.
// Rasio (Rp/Ha, Rp/Jam, Rp/Liter, % komposisi) tidak ikut dibagi.
let biayaMode = 'total';
let biayaMetric = 'total';
const BIAYA_MODES = {
  total:  { id:'total',  label:'Total',                satRp:'Rp',            satPendek:'Rp',           nilai:()=>1 },
  avgAkt: { id:'avgAkt', label:'Rata-rata / Aktivitas', satRp:'Rp/aktivitas',  satPendek:'Rp/akt',       nilai:g => g.count || 1 },
  avgHari:{ id:'avgHari',label:'Rata-rata / Hari',      satRp:'Rp/hari',       satPendek:'Rp/hari',      nilai:g => g.hari || 1 }
};
const modeBiaya = () => BIAYA_MODES[biayaMode] || BIAYA_MODES.total;
function bagiBiaya(g) {
  const f = modeBiaya().nilai(g);
  return f > 0 ? f : 1;
}
function satuanMetrikBiaya(m) {
  if (m.tipe === 'rp')  return modeBiaya().satPendek;   // Rp | Rp/akt | Rp/hari
  if (m.tipe === 'rr')  return m.unit || 'Rp';          // rasio rupiah: Rp/Ha, Rp/Jam, Rp/Liter, Rp/Record
  if (m.tipe === 'vol') return m.satVol;                // Ha | L
  return '%';                                           // persentase (komposisi)
}
// Metrik nominal/volume ikut mode tampilan; rasio (Rp/Ha, %, dst) selalu tetap
const ikutModeBiaya = (m) => (m.tipe === 'rp' || m.tipe === 'vol');
let sortField = 'date';
let sortDir = 'desc';
let currentPage = 1;
let pageSize = 15;
let wilayahMetric = 'luas'; // metric for wilayah chart
let wilayahSort = 'totalLuas';
let biayaGran = 'monthly'; // granularity for biaya period table
let biayaSort = 'totalBiaya'; // sort for biaya wilayah table
let currentTab = 'overview'; // active tab
const TAB_IDS = ['overview','wilayah','biaya','utilisasi','indexsolar','data'];
// --- performa & stabilitas ---
let dataVersion = 0;                 // naik setiap filteredData berubah -> invalidasi memo
const memoStore = new Map();
let dirtyTabs = new Set(TAB_IDS);    // tab yang perlu render ulang
let lastMeta = null;                 // {sig, ts, rows}
let syncTimer = null, syncFailures = 0, isSyncing = false;
let dataSource = 'live';             // live | cache | sample
let filtersUIReady = false;
// --- sheet "Index Solar" (evaluasi pemakaian solar per engine) ---
let indexData = [];                  // baris hasil parsing sheet Index Solar
let indexVersion = 0;                // naik saat indexData berubah
let indexPage = 1;
let indexSort = 'selisih';
let indexSearch = '';
let indexJust = 'all';               // all | Hemat | Boros | anomali
let indexPageSize = 12;
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

// Huruf kolom gaya spreadsheet: 0 -> A, 1 -> B, ... 26 -> AA
function colLetter(i) {
  let s = '', n = i + 1;
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
}
// Cari huruf kolom "Date" dari header CSV (hanya baris pertama) untuk penyesuaian otomatis
function csvDateLetter(csv) {
  try {
    const nl = csv.indexOf('\n');
    const head = parseCSVFast(nl === -1 ? csv : csv.slice(0, nl))[0] || [];
    for (let i = 0; i < head.length; i++) if (head[i].trim() === 'Date') return colLetter(i);
  } catch (e) {}
  return null;
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

// Tanggal dari query kolom "Date" (kolom B): "Date(2026,4,29)"
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

// Tanggal cadangan bila overlay kolom "Date" tidak tersedia: "29-Mei" (tanpa tahun)
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
        cRep = I('Repair'), cDown = I('Down Time'), cStand = I('Standby'), cOff = I('Off Time'),
        cTotOper = (I('Tot, Oper, Time') !== undefined ? I('Tot, Oper, Time') : I('Tot. Oper. Time')),
        cTotAvail = I('Total Avail'), cTotTime = I('Total Time'), cAvail = I('% Availability'), cUtil = I('% Utilization'),
        cAir = I('Air'), cSolar = I('Solar Terpakai (ltr)'), cBSolar = I('Biaya Solar (Std)'), cBUpah = I('Biaya Upah'),
        cBAlat = I('Biaya Alat'), cBTotal = I('Biaya Total'), cRpHa = I('Rp/Ha'), cHaHari = I('Ha/Hari'),
        cHaJam = I('Ha/Jam'), cSolarJam = I('Solar Ltr/jam'), cSolarHa = I('Solar Ltr/Ha'), cJEng = I('Jenis Engine'),
        cBulan = I('R Bulan');
  need('Date'); need('Wilayah'); need('Luas Siram'); need('Biaya Total');

  const out = [];
  let badOverlay = 0;
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row.length < 3) continue;
    const rawDate = cDate !== undefined ? row[cDate] : '';
    // Overlay tanggal (kolom B) dipakai hanya bila valid; kalau tidak (mis. susunan kolom sheet
    // berubah) baris ini jatuh ke tanggal dari CSV supaya tidak ada baris yang hilang.
    const ov = dates ? dates[r - 1] : null;
    if (ov && isNaN(ov)) badOverlay++;
    const date = (ov && !isNaN(ov)) ? ov : parseShortDate(rawDate, fallbackYear);
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
      bulanR: g(cBulan).trim(),          // kolom A sheet: bantu bulan (Mei..Sep)
      _y: yr, _m: mo,
      _s: ''   // indeks pencarian, diisi di bawah
    };
    d._s = (lokasi + ' ' + engine + ' ' + irigator + ' ' + wilayah + ' ' + d.jenisIrigator + ' ' + d.jenisEngine + ' ' +
            formatDateISO(date) + ' ' + rawDate).toLowerCase();
    out.push(d);
  }

  if (badOverlay) console.warn('[data] overlay tanggal kolom ' + DATE_COL + ' tidak valid pada ' + badOverlay + ' baris -> memakai tanggal dari CSV');
  if (out.length) {
    try { localStorage.setItem('pg2-year', String(out[out.length - 1]._y)); } catch (e) {}
  }
  console.debug('[data] CSV', rows.length - 1, 'baris ->', out.length, 'dipakai dalam', Math.round(performance.now() - t0), 'ms');
  return out;
}

// ============================================================
// SHEET "INDEX SOLAR" - evaluasi pemakaian solar per engine
// Kolom: Kode Engine, Tanggal Siram, Wilayah, Lokasi, Kode Irrigator, Jenis Engine,
//        Pemakaian Solar, Jam Operaton, Liter/jam, Kalibrasi, Justifikasi, Selisih
// ============================================================
const _norm = (h) => String(h || '').toLowerCase().replace(/[^a-z0-9]/g, '');
function colIndex(headers, candidates) {
  const map = {};
  for (let i = 0; i < headers.length; i++) map[_norm(headers[i])] = i;
  for (let i = 0; i < candidates.length; i++) {
    const k = _norm(candidates[i]);
    if (map[k] !== undefined) return map[k];
  }
  return -1;
}
// "9/21/2026" (bulan/tanggal/tahun gaya sheet) -> "21-Sep" + objek Date
function parseIndexDate(str, fallbackYear) {
  const t = String(str || '').trim();
  if (!t) return { label: '', date: null };
  const m = t.match(/^\s*(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})/);
  if (m) {
    let a = parseInt(m[1], 10), b = parseInt(m[2], 10), y = parseInt(m[3], 10);
    if (y < 100) y += 2000;
    let day = a, mon = b;
    if (a > 12) { day = a; mon = b; }          // pasti tanggal/bulan
    else if (b > 12) { day = b; mon = a; }     // bulan/tanggal
    else { day = b; mon = a; }                 // gaya default sheet: bulan/tanggal
    const NAMA = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];
    const mon0 = Math.min(11, Math.max(0, mon - 1));
    return { label: `${day}-${NAMA[mon0]}`, date: new Date(y, mon0, day) };
  }
  const fallback = parseShortDate(t, fallbackYear);
  return { label: t, date: fallback };
}
// Buang satuan "Liter" pada kolom Selisih -> angka
function parseSelisih(v) {
  if (v === null || v === undefined || v === '') return 0;
  const t = String(v).replace(/[^0-9,.-]/g, '').trim();
  return toNumFast(t);
}
function parseIndexSolar(csvText) {
  if (!csvText) return [];
  const rows = parseCSVFast(csvText);
  if (rows.length < 2) return [];
  const headers = rows[0].map(h => h.trim());
  const cEngine = colIndex(headers, ['Kode Engine', 'Engine']);
  const cDate = colIndex(headers, ['Tanggal Siram', 'Tanggal']);
  const cWil = colIndex(headers, ['Wilayah']);
  const cLok = colIndex(headers, ['Lokasi']);
  const cIri = colIndex(headers, ['Kode Irrigator', 'Irigator']);
  const cJenis = colIndex(headers, ['Jenis Engine']);
  const cSolar = colIndex(headers, ['Pemakaian Solar', 'Solar Terpakai']);
  const cJam = colIndex(headers, ['Jam Operaton', 'Jam Operation', 'Jam Operasi', 'Jam']);
  const cLpj = colIndex(headers, ['Liter/jam', 'Liter per jam']);
  const cKal = colIndex(headers, ['Kalibrasi']);
  const cJust = colIndex(headers, ['Justifikasi']);
  const cSel = colIndex(headers, ['Selisih']);
  if (cEngine < 0) { console.warn('[index solar] kolom "Kode Engine" tidak ditemukan'); return []; }

  let fallbackYear = new Date().getFullYear();
  try { const y = parseInt(localStorage.getItem('pg2-year'), 10); if (y) fallbackYear = y; } catch (e) {}

  const out = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || !row.length) continue;
    const g = (i) => (i < 0 || row[i] === undefined ? '' : String(row[i]).trim());
    const engine = g(cEngine);
    if (!engine) continue;
    const solar = toNumFast(g(cSolar));
    const jam = toNumFast(g(cJam));
    const kalibrasi = toNumFast(g(cKal));
    const justifikasiRaw = g(cJust);
    const wilayah = g(cWil);
    const tgl = parseIndexDate(g(cDate), fallbackYear);
    const lpjSheet = toNumFast(g(cLpj));
    const lpjAktual = jam > 0 ? solar / jam : 0;          // dihitung sendiri agar akurat
    const aktif = !/tidak/i.test(wilayah) && !/^tid$/i.test(g(cJenis)) && jam > 0;
    // Anomali: pemakaian jauh di atas kalibrasi (mis. salah input 46.258 L untuk 2 jam)
    const anomali = aktif && kalibrasi > 0 && lpjAktual > kalibrasi * 5;
    const justifikasi = /boros/i.test(justifikasiRaw) ? 'Boros' : (/hemat/i.test(justifikasiRaw) ? 'Hemat' : (aktif ? 'Hemat' : 'Tidak Ada Siram'));
    out.push({
      engine,
      tanggalLabel: tgl.label,
      date: tgl.date,
      _y: tgl.date ? tgl.date.getFullYear() : 0,
      _m: tgl.date ? tgl.date.getMonth() : -1,
      wilayah: aktif ? wilayah : 'Tidak Ada Siram',
      lokasi: g(cLok),
      irigator: g(cIri),
      jenis: g(cJenis) || '-',
      solar, jam, kalibrasi, lpjSheet, lpjAktual,
      selisih: parseSelisih(g(cSel)),
      deviasi: kalibrasi > 0 ? lpjAktual - kalibrasi : 0,
      justifikasi, aktif, anomali,
      _s: (engine + ' ' + g(cLok) + ' ' + g(cIri) + ' ' + wilayah + ' ' + g(cJenis) + ' ' + tgl.label).toLowerCase()
    });
  }
  console.debug('[index solar]', out.length, 'engine dibaca (', out.filter(x => x.aktif).length, 'aktif )');
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
    const [csv, dates, index] = await Promise.all([cacheGet(CSV_URL), cacheGet(DATES_URL), cacheGet(INDEX_URL)]);
    if (csv && csv.length > 1000) {
      const meta = readMeta();
      return { csv, dates, index, sig: meta ? meta.sig : fingerprint(csv), ts: meta ? meta.ts : Date.now(), fromCache: true };
    }
  }
  // paralel: CSV (sumber utama) + kolom tanggal (~3 KB).
  // Kalau index.html sudah memulai unduhan lebih awal, hasilnya dipakai ulang di sini.
  let csv = null, dates = null, index = null;
  const earlyCsv = window.__pgCsvEarly, earlyDates = window.__pgDatesEarly;
  const indexPromise = fetchText(INDEX_URL).catch(() => null);   // ~13 KB, dijalankan paralel
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
  index = await indexPromise;
  const ts = Date.now();
  if (csv && csv.length > 1000) {
    return { csv, dates, index, sig: fingerprint(csv) + '|' + (index ? fingerprint(index) : '-'), ts, fromCache: false };
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
// ===== WAKTU & KETERSEDIAAN (kolom Plan/Prepare/Operating/Waiting/Repair/Down/Standby/Off/dst.) =====
// Diringkas per bulan (untuk chart komposisi) dan per wilayah (untuk tabel ringkas)
function getWaktuBulanan() {
  return memo('waktuBulanan', () => {
    const groups = {};
    const keys = [];
    for (let i = 0; i < filteredData.length; i++) {
      const d = filteredData[i];
      const key = getMonthLabel(d.date);
      let g = groups[key];
      if (!g) {
        g = groups[key] = { key, count: 0, plan: 0, prepare: 0, operating: 0, waiting: 0, repair: 0, down: 0, standby: 0, off: 0, totOper: 0, totalAvail: 0, totalTime: 0, air: 0, luas: 0, solar: 0, avail: 0, util: 0, _hari: new Set() };
        keys.push(key);
      }
      g.count++;
      if (d.date) g._hari.add(d.date.getTime());
      g.plan += d.planTime || 0; g.prepare += d.prepareTime || 0; g.operating += d.operatingTime || 0;
      g.waiting += d.waitingTime || 0; g.repair += d.repair || 0; g.down += d.downTime || 0;
      g.standby += d.standby || 0; g.off += d.offTime || 0; g.totOper += d.totOperTime || 0;
      g.totalAvail += d.totalAvail || 0; g.totalTime += d.totalTime || 0; g.air += d.air || 0;
      g.luas += d.luasSiram || 0; g.solar += d.solarTerpakai || 0;
      g.avail += d.availability || 0; g.util += d.utilization || 0;
    }
    keys.sort();
    return keys.map(k => {
      const g = groups[k], n = g.count || 1;
      return {
        key: g.key, label: g.key, count: g.count,
        plan: g.plan, prepare: g.prepare, operating: g.operating, waiting: g.waiting,
        repair: g.repair, down: g.down, standby: g.standby, off: g.off,
        totOper: g.totOper, totalAvail: g.totalAvail, totalTime: g.totalTime,
        air: g.air, luas: g.luas, solar: g.solar,
        hari: g._hari ? g._hari.size : 0,
        avgAvail: g.avail / n, avgUtil: g.util / n
      };
    });
  });
}
// Pembagi nilai waktu sesuai mode aktif untuk satu kelompok (wilayah/bulan/total)
function bagiWaktu(g) {
  const f = modeWaktu().nilai(g);
  return f > 0 ? f : 1;
}

function getWaktuWilayah() {
  return memo('waktuWilayah', () => {
    const groups = {};
    for (let i = 0; i < filteredData.length; i++) {
      const d = filteredData[i];
      let g = groups[d.wilayah];
      if (!g) g = groups[d.wilayah] = { wilayah: d.wilayah, count: 0, plan: 0, prepare: 0, operating: 0, waiting: 0, repair: 0, down: 0, standby: 0, off: 0, totOper: 0, totalAvail: 0, totalTime: 0, air: 0, luas: 0, solar: 0, avail: 0, util: 0, _hari: new Set() };
      g.count++;
      if (d.date) g._hari.add(d.date.getTime());
      g.plan += d.planTime || 0; g.prepare += d.prepareTime || 0; g.operating += d.operatingTime || 0;
      g.waiting += d.waitingTime || 0; g.repair += d.repair || 0; g.down += d.downTime || 0;
      g.standby += d.standby || 0; g.off += d.offTime || 0; g.totOper += d.totOperTime || 0;
      g.totalAvail += d.totalAvail || 0; g.totalTime += d.totalTime || 0; g.air += d.air || 0;
      g.luas += d.luasSiram || 0; g.solar += d.solarTerpakai || 0;
      g.avail += d.availability || 0; g.util += d.utilization || 0;
    }
    const out = Object.keys(groups).map(w => {
      const g = groups[w], n = g.count || 1;
      g.avgAvail = g.avail / n; g.avgUtil = g.util / n;
      g.literPerHa = g.luas ? g.air / g.luas : 0;
      g.hari = g._hari ? g._hari.size : 0;
      delete g._hari;
      return g;
    });
    out.sort((a, b) => b.air - a.air);
    return out;
  });
}
// Total waktu pemakaian alat (untuk kartu ringkas) - satu lintasan
function getWaktuTotal() {
  return memo('waktuTotal', () => {
    const t = { plan: 0, prepare: 0, operating: 0, waiting: 0, repair: 0, down: 0, standby: 0, off: 0, totOper: 0, totalAvail: 0, totalTime: 0, air: 0, count: 0, hari: 0 };
    const setHari = new Set();
    for (let i = 0; i < filteredData.length; i++) {
      const d = filteredData[i];
      t.count++;
      if (d.date) setHari.add(d.date.getTime());
      t.plan += d.planTime || 0; t.prepare += d.prepareTime || 0; t.operating += d.operatingTime || 0;
      t.waiting += d.waitingTime || 0; t.repair += d.repair || 0; t.down += d.downTime || 0;
      t.standby += d.standby || 0; t.off += d.offTime || 0; t.totOper += d.totOperTime || 0;
      t.totalAvail += d.totalAvail || 0; t.totalTime += d.totalTime || 0; t.air += d.air || 0;
    }
    t.hari = setHari.size;
    return t;
  });
}

// ===== INDEX SOLAR: agregasi per engine (digabung dengan data ZPAS637) =====
// Hasil: daftar engine dengan pemakaian solar aktual vs kalibrasi + rekap wilayah/jenis engine
function getIndexSolarView() {
  return memo('indexSolar:' + indexJust + ':' + indexSort + ':' + indexSearch, () => {
    const wFilter = filters.wilayah;
    const q = indexSearch ? indexSearch.toLowerCase() : null;
    const rows = [];
    // ringkasan aktivitas ZPAS637 per engine (mengikuti filter sidebar)
    const zp = {};
    for (let i = 0; i < filteredData.length; i++) {
      const d = filteredData[i];
      let a = zp[d.engine];
      if (!a) a = zp[d.engine] = { n: 0, jam: 0, solar: 0, luas: 0 };
      a.n++; a.jam += d.operatingTime || 0; a.solar += d.solarTerpakai || 0; a.luas += d.luasSiram || 0;
    }
    for (let i = 0; i < indexData.length; i++) {
      const r = indexData[i];
      if (wFilter.size && !wFilter.has(r.wilayah)) continue;
      if (q && r._s.indexOf(q) === -1) continue;
      if (indexJust === 'Hemat' && !(r.aktif && r.justifikasi === 'Hemat' && !r.anomali)) continue;
      if (indexJust === 'Boros' && !(r.aktif && r.justifikasi === 'Boros' && !r.anomali)) continue;
      if (indexJust === 'aktif' && !r.aktif) continue;
      if (indexJust === 'anomali' && !r.anomali) continue;
      const z = zp[r.engine] || null;
      rows.push(Object.assign({}, r, {
        zpN: z ? z.n : 0,
        zpJam: z ? z.jam : 0,
        zpSolar: z ? z.solar : 0,
        zpLuas: z ? z.luas : 0,
        zpLtrPerJam: z && z.jam ? z.solar / z.jam : 0
      }));
    }
    const sorters = {
      selisih: (a, b) => b.selisih - a.selisih,
      deviasi: (a, b) => Math.abs(b.deviasi) - Math.abs(a.deviasi),
      solar: (a, b) => b.solar - a.solar,
      jam: (a, b) => b.jam - a.jam,
      lpj: (a, b) => b.lpjAktual - a.lpjAktual,
      engine: (a, b) => a.engine.localeCompare(b.engine)
    };
    rows.sort(sorters[indexSort] || sorters.selisih);

    const aktif = rows.filter(r => r.aktif && !r.anomali);
    // "solar 0 L" dipisah: pemakaian belum tercatat, tidak adil disebut Hemat/Boros
    const nolSolar = aktif.filter(r => r.solar === 0);
    const terukur = aktif.filter(r => r.solar > 0);
    const ringkas = {
      total: rows.length,
      aktifAll: rows.filter(r => r.aktif).length,
      aktif: aktif.length,
      terukur: terukur.length,
      nol: nolSolar.length,
      hemat: terukur.filter(r => r.justifikasi === 'Hemat').length,
      boros: terukur.filter(r => r.justifikasi === 'Boros').length,
      anomaly: rows.filter(r => r.anomali).length,
      tanpaSiram: rows.filter(r => !r.aktif).length,
      solar: aktif.reduce((a, r) => a + r.solar, 0),
      jam: aktif.reduce((a, r) => a + r.jam, 0),
      selisih: terukur.reduce((a, r) => a + r.selisih, 0),
      selisihAbs: terukur.reduce((a, r) => a + Math.abs(r.selisih), 0),
      selisihAnomali: rows.filter(r => r.anomali).reduce((a, r) => a + r.selisih, 0),
      kalibrasi: aktif.filter(r => r.kalibrasi > 0).reduce((a, r) => a + r.kalibrasi, 0),
      kalibrasiN: aktif.filter(r => r.kalibrasi > 0).length,
      // rekap per jenis (kolom "Jenis Engine" pada sheet Index Solar)
      perJenisRingkas: {}
    };
    const jamTerukur = terukur.reduce((a, r) => a + r.jam, 0);
    ringkas.ltrPerJam = jamTerukur ? terukur.reduce((a, r) => a + r.solar, 0) / jamTerukur : 0;
    ringkas.kalibrasiAvg = ringkas.kalibrasiN ? ringkas.kalibrasi / ringkas.kalibrasiN : 0;
    // rekap per wilayah & per jenis engine
    const perWilayah = {}, perJenis = {};
    aktif.forEach(r => {
      const w = perWilayah[r.wilayah] || (perWilayah[r.wilayah] = { wilayah: r.wilayah, hemat: 0, boros: 0, solar: 0, jam: 0, selisih: 0 });
      w.hemat += r.justifikasi === 'Hemat' ? 1 : 0;
      w.boros += r.justifikasi === 'Boros' ? 1 : 0;
      w.solar += r.solar; w.jam += r.jam; w.selisih += r.selisih;
      const j = perJenis[r.jenis] || (perJenis[r.jenis] = { jenis: r.jenis, hemat: 0, boros: 0, solar: 0, jam: 0, n: 0 });
      j.n++; j.hemat += r.justifikasi === 'Hemat' ? 1 : 0; j.boros += r.justifikasi === 'Boros' ? 1 : 0;
      j.solar += r.solar; j.jam += r.jam;
    });
    Object.keys(perJenis).forEach(k => { ringkas.perJenisRingkas[k] = perJenis[k]; });
    return {
      rows,
      ringkas,
      perWilayah: Object.keys(perWilayah).map(k => perWilayah[k]).sort((a, b) => (b.hemat + b.boros) - (a.hemat + a.boros)),
      perJenis: Object.keys(perJenis).map(k => perJenis[k]).sort((a, b) => b.n - a.n)
    };
  });
}

function getBiayaWilayahStats() {
  return memo('biaya:' + biayaSort, () => getBiayaWilayahStatsRaw());
}
function getBiayaWilayahStatsRaw() {
  const groups = {};
  filteredData.forEach(d => {
    if (!groups[d.wilayah]) groups[d.wilayah] = {
      wilayah: d.wilayah, count: 0, luas: 0, biayaSolar: 0, biayaUpah: 0, biayaAlat: 0,
      biayaTotal: 0, solar: 0, operating: 0, air: 0, _hari: new Set()
    };
    const g = groups[d.wilayah];
    g.count++;
    if (d.date) g._hari.add(d.date.getTime());
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
    g.hari = g._hari ? g._hari.size : 0;
    delete g._hari;
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
    hari: getBiayaTotal().hari,
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

// Total biaya seluruh periode terpilih (untuk kartu biaya & pembagi mode) - satu lintasan
function getBiayaTotal() {
  return memo('biayaTotal', () => {
    const t = { count: 0, hari: 0, luas: 0, solar: 0, air: 0, operating: 0, biayaSolar: 0, biayaUpah: 0, biayaAlat: 0, biayaTotal: 0 };
    const setHari = new Set();
    for (let i = 0; i < filteredData.length; i++) {
      const d = filteredData[i];
      t.count++;
      if (d.date) setHari.add(d.date.getTime());
      t.luas += d.luasSiram||0; t.solar += d.solarTerpakai||0; t.air += d.air||0;
      t.operating += d.operatingTime||0;
      t.biayaSolar += d.biayaSolar||0; t.biayaUpah += d.biayaUpah||0; t.biayaAlat += d.biayaAlat||0;
      t.biayaTotal += (d.biayaTotal || ((d.biayaSolar||0)+(d.biayaUpah||0)+(d.biayaAlat||0)));
    }
    t.hari = setHari.size;
    if (!t.biayaTotal) t.biayaTotal = t.biayaSolar + t.biayaUpah + t.biayaAlat;
    t.rpPerHa = t.luas ? t.biayaTotal/t.luas : 0;
    t.rpPerJam = t.operating ? t.biayaTotal/t.operating : 0;
    t.rpPerLiter = t.solar ? t.biayaTotal/t.solar : 0;
    t.rpPerRec = t.count ? t.biayaTotal/t.count : 0;
    t.pctSolar = t.biayaTotal ? t.biayaSolar/t.biayaTotal*100 : 0;
    t.pctUpah = t.biayaTotal ? t.biayaUpah/t.biayaTotal*100 : 0;
    t.pctAlat = t.biayaTotal ? t.biayaAlat/t.biayaTotal*100 : 0;
    return t;
  });
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
    if (!groups[key]) groups[key] = { label:key, key, date:d.date, count:0, hari:0, luas:0, biayaSolar:0, biayaUpah:0, biayaAlat:0, biayaTotal:0, operating:0, solar:0, _hari:new Set() };
    const g = groups[key];
    g.count++;
    if (d.date) g._hari.add(d.date.getTime());
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
    g.hari = g._hari ? g._hari.size : 0;
    delete g._hari;
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

// ===== KARTU BIAYA (gaya sama dengan kartu waktu pada tab Waktu & Utilisasi) =====
// Nominal (biaya) & volume ikut mode; rasio (Rp/Ha, Rp/Jam, Rp/Liter, % ) tetap.
const BIAYA_CARDS = [
  { k:'biayaTotal', label:'Biaya Total',        desc:'Solar+Upah+Alat', tipe:'rp',   icon:'wallet',        color:'amber' },
  { k:'biayaSolar', label:'Biaya Solar',        desc:'Komponen 1',      tipe:'rp',   icon:'fuel',          color:'amber' },
  { k:'biayaUpah',  label:'Biaya Upah',         desc:'Komponen 2',      tipe:'rp',   icon:'users',         color:'blue' },
  { k:'biayaAlat',  label:'Biaya Alat',         desc:'Komponen 3',      tipe:'rp',   icon:'truck',         color:'violet' },
  { k:'rpPerHa',    label:'Rp/Ha',              desc:'Efisiensi lahan', tipe:'rasio',icon:'land-plot',     color:'emerald' },
  { k:'rpPerJam',   label:'Rp/Jam Operasi',     desc:'Efisiensi alat',  tipe:'rasio',icon:'timer',         color:'sky' },
  { k:'rpPerLiter', label:'Rp/Liter Solar',     desc:'Efisiensi bahan', tipe:'rasio',icon:'droplet',       color:'rose' },
  { k:'rpPerRec',   label:'Rp/Record',          desc:'Per aktivitas',   tipe:'rasio',icon:'list-checks',   color:'teal' },
  { k:'luas',       label:'Luas Siram',         desc:'Volume kerja',    tipe:'vol',  icon:'sprout',        color:'emerald', satVol:'Ha' },
  { k:'solar',      label:'Solar Terpakai',     desc:'Volume bahan',    tipe:'vol',  icon:'fuel',          color:'amber',   satVol:'L' },
  { k:'komposisi',  label:'Komponen Terbesar',  desc:'Komposisi biaya', tipe:'share',icon:'pie-chart',     color:'slate' },
  { k:'wilayahMahal', label:'Wilayah Termahal', desc:'Rp/Ha tertinggi',  tipe:'wil',  icon:'arrow-up-right', color:'red' }
];

function renderBiayaCards() {
  const host = $('#biayaCards');
  if (!host) return;
  const t = getBiayaTotal();
  if (!t.count) { host.innerHTML = '<div class="col-span-12 text-center py-6 text-[12px] text-slate-400">Tidak ada data untuk filter ini</div>'; return; }
  const mode = modeBiaya();
  const bagi = bagiBiaya(t);
  const nAkt = t.count || 1, nHari = t.hari || 1;

  const subRupiah = (total) => {
    const bagian = [];
    if (biayaMode !== 'total')  bagian.push('total ' + formatRupiah(total));
    if (biayaMode !== 'avgAkt') bagian.push(formatRupiah(total / nAkt) + '/aktivitas');
    if (biayaMode !== 'avgHari')bagian.push(formatRupiah(total / nHari) + '/hari');
    return bagian.join(' • ');
  };
  const subVolume = (total, sat, des) => {
    const bagian = [];
    if (biayaMode !== 'total')  bagian.push('total ' + formatNumber(total, des) + ' ' + sat);
    if (biayaMode !== 'avgAkt') bagian.push(formatNumber(total / nAkt, des) + ' ' + sat + '/aktivitas');
    if (biayaMode !== 'avgHari')bagian.push(formatNumber(total / nHari, des) + ' ' + sat + '/hari');
    return bagian.join(' • ');
  };

  const noteMode = $('#biayaModeNote');
  if (noteMode) {
    noteMode.textContent = biayaMode === 'total'
      ? `Total seluruh komponen biaya pada periode terpilih (${formatInt(t.count)} aktivitas, ${formatInt(t.hari)} hari) & rasio efisiensi biaya.`
      : (biayaMode === 'avgAkt'
        ? `Biaya dibagi jumlah AKTIVITAS (${formatInt(t.count)} baris data, mencakup ${formatInt(t.hari)} hari). Rasio Rp/Ha, Rp/Jam, Rp/Liter tetap.`
        : `Biaya dibagi jumlah HARI operasi (${formatInt(t.hari)} hari, dari ${formatInt(t.count)} aktivitas). Rasio Rp/Ha, Rp/Jam, Rp/Liter tetap.`);
  }

  // wilayah termahal/termurah menurut Rp/Ha (dipakai kartu ke-12)
  const { list } = getBiayaWilayahStats();
  const berLahan = list.filter(x => x.luas > 0);
  const termahal = berLahan.slice().sort((a, b) => b.rpPerHa - a.rpPerHa)[0];
  const termurah = berLahan.slice().sort((a, b) => a.rpPerHa - b.rpPerHa)[0];

  host.innerHTML = BIAYA_CARDS.map(c => {
    const isRasio = c.tipe === 'rasio';
    let utama, sub;

    if (c.tipe === 'wil') {
      utama = termahal
        ? `${esc(termahal.wilayah)} <span class="text-[10px] font-medium text-slate-400">${formatRupiahShort(termahal.rpPerHa)}/Ha</span>`
        : '-';
      sub = termurah && termahal && termurah.wilayah !== termahal.wilayah
        ? `termurah ${esc(termurah.wilayah)} ${formatRupiahShort(termurah.rpPerHa)}/Ha • selisih ${formatNumber(termurah.rpPerHa ? (termahal.rpPerHa - termurah.rpPerHa) / termurah.rpPerHa * 100 : 0, 1)}%`
        : '\u00a0';
    } else if (c.tipe === 'share') {
      const komp = [
        { n:'Solar', v:t.pctSolar }, { n:'Upah', v:t.pctUpah }, { n:'Alat', v:t.pctAlat }
      ].sort((a, b) => b.v - a.v);
      utama = komp[0] ? `${esc(komp[0].n)} ${formatNumber(komp[0].v, 1)}<span class="text-[10px] font-medium text-slate-400">%</span>` : '-';
      sub = komp.map(x => `${x.n} ${formatNumber(x.v, 0)}%`).join(' • ');
    } else if (c.tipe === 'vol') {
      const total = t[c.k] || 0;
      const nilai = total / bagi;
      const des = c.k === 'luas' ? 2 : 0;
      utama = `${formatNumber(nilai, des)} <span class="text-[10px] font-medium text-slate-400">${esc(c.satVol)}</span>`;
      sub = subVolume(total, c.satVol, des);
    } else if (isRasio) {
      utama = `${formatRupiah(t[c.k] || 0)}`;
      sub = c.k === 'rpPerRec'
        ? `${formatInt(t.count)} aktivitas • ${formatInt(t.hari)} hari`
        : (c.k === 'rpPerHa' ? `${formatNumber(t.luas, 1)} Ha tersiram` : (c.k === 'rpPerJam' ? `${formatNumber(t.operating, 0)} jam operasi` : `${formatInt(t.solar)} L solar`));
    } else {
      const total = t[c.k] || 0;
      const nilai = total / bagi;
      const unit = biayaMode === 'total' ? '' : (biayaMode === 'avgHari' ? ' / hari' : ' / aktivitas');
      utama = `${biayaMode === 'total' ? formatRupiahShort(nilai) : formatRupiah(nilai)}` +
              (unit ? `<span class="text-[10px] font-medium text-slate-400">${unit}</span>` : '');
      sub = subRupiah(total);
    }

    const labelSatuan = '';

    return `
      <div class="rounded-2xl border border-slate-200/70 bg-white p-4 shadow-soft transition hover:border-slate-300">
        <div class="flex items-center justify-between gap-2">
          <span class="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-${c.color}-50 text-${c.color}-600 ring-1 ring-${c.color}-100"><i data-lucide="${c.icon}" class="h-4 w-4"></i></span>
          <span class="text-[10px] uppercase tracking-wider text-slate-400">${esc(c.desc)}</span>
        </div>
        <div class="mt-2.5 text-[16px] font-bold leading-tight tracking-tight text-slate-900">${utama}${labelSatuan}</div>
        <div class="mt-0.5 text-[11px] font-medium text-slate-500">${esc(c.label)}</div>
        <div class="mt-1 text-[10px] leading-relaxed text-slate-400">${esc(sub || '\u00a0')}</div>
      </div>`;
  }).join('');
  refreshIcons();
}

// ===== Chart bar "Performa Biaya per Wilayah" (gaya sama dengan Performa Waktu / Performance Wilayah) =====
// rp & vol: ikut mode (total / Rp per aktivitas / Rp per hari) • rasio (Rp/Ha, %, dst) tetap
const BIAYA_METRIC = {
  total:      { label:'Biaya Total',        k:'biayaTotal', tipe:'rp',   warna:'rgba(245,158,11,0.85)', color:'#b45309' },
  solar:      { label:'Biaya Solar',        k:'biayaSolar', tipe:'rp',   warna:'rgba(251,191,36,0.85)', color:'#92400e' },
  upah:       { label:'Biaya Upah',         k:'biayaUpah',  tipe:'rp',   warna:'rgba(59,130,246,0.8)',  color:'#1d4ed8' },
  alat:       { label:'Biaya Alat',         k:'biayaAlat',  tipe:'rp',   warna:'rgba(139,92,246,0.75)', color:'#6d28d9' },
  rpPerHa:    { label:'Rp/Ha (efisiensi)',  k:'rpPerHa',    tipe:'rr',   unit:'Rp/Ha',    warna:'rgba(16,185,129,0.85)', color:'#047857' },
  rpPerJam:   { label:'Rp/Jam Operasi',     k:'rpPerJam',   tipe:'rr',   unit:'Rp/Jam',   warna:'rgba(14,165,233,0.85)', color:'#0369a1' },
  rpPerLiter: { label:'Rp/Liter Solar',     k:'rpPerLiter', tipe:'rr',   unit:'Rp/Liter', warna:'rgba(244,63,94,0.8)',  color:'#be123c' },
  rpPerRec:   { label:'Rp/Record',          k:'rpPerRec',   tipe:'rr',   unit:'Rp/Record',warna:'rgba(20,184,166,0.85)',color:'#0f766e' },
  share:      { label:'% dari Total Biaya', k:'share',      tipe:'pct',  warna:'rgba(15,23,42,0.75)',  color:'#0f172a' },
  solarL:     { label:'Solar Terpakai',     k:'solar',      tipe:'vol',  satVol:'L',  warna:'rgba(245,158,11,0.8)', color:'#b45309' }
};
const BIAYA_METRIC_CEPAT = ['total', 'solar', 'alat', 'rpPerHa', 'rpPerJam', 'share'];

function renderBiayaPerformaChart() {
  const cv = document.getElementById('chartBiayaPerforma');
  if (!cv) return;
  const { list } = getBiayaWilayahStats();
  if (!list.length) { ensureChart('chartBiayaPerforma', { type:'bar', data:{ labels:[], datasets:[] }, options:{ responsive:true, maintainAspectRatio:false } }); return; }
  const m = BIAYA_METRIC[biayaMetric] || BIAYA_METRIC.total;
  const f = (w) => (ikutModeBiaya(m) ? bagiBiaya(w) : 1);
  const data = list.map(w => ({ w, v: (w[m.k] || 0) / f(w) })).sort((a, b) => b.v - a.v);
  const satuan = satuanMetrikBiaya(m);
  // label batang: rupiah ringkas (Rp 1,2 M / Rp 350 Rb), persen 1 desimal, atau angka
  // label batang: rupiah selalu ringkas (Rp 1,2 M / Rp 422 Rb) supaya tidak terpotong pada batang pendek
  const fmtLabel = m.tipe === 'pct' ? 'pct1' : (m.tipe === 'vol' ? (m.k === 'luas' ? 'ha1' : 'int') : 'rpshort');
  const satVolMode = m.tipe === 'vol' ? m.satVol + (biayaMode === 'avgAkt' ? '/aktivitas' : (biayaMode === 'avgHari' ? '/hari' : '')) : '';
  const judulMetrik = m.label + (m.tipe === 'rp' ? ' (' + satuan + ')' : (m.tipe === 'vol' ? ' (' + satVolMode + ')' : (m.tipe === 'pct' ? ' (%)' : '')));

  ensureChart('chartBiayaPerforma', {
    type: 'bar',
    data: {
      labels: data.map(d => d.w.wilayah),
      datasets: [{
        label: judulMetrik,
        data: data.map(d => d.v),
        backgroundColor: m.warna,
        borderRadius: 8,
        borderSkipped: false
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      indexAxis: 'y',
      layout: { padding: { right: 84 } },
      plugins: {
        legend: { display: false },
        barLabels: { display: true, fmt: fmtLabel, color: m.color, maxBars: 45 },
        tooltip: {
          backgroundColor: '#0f172a', cornerRadius: 12,
          callbacks: {
            label: (ctx) => {
              const d = data[ctx.dataIndex];
              const nilai = (m.tipe === 'rp' || m.tipe === 'rr') ? formatRupiah(d.v) : (m.tipe === 'pct' ? formatNumber(d.v, 1) + '%' : formatNumber(d.v, 2) + ' ' + (m.tipe === 'vol' ? (satVolMode || m.satVol) : ''));
              const komposisi = m.k === 'biayaTotal' ? ` • solar ${formatRupiahShort(d.w.biayaSolar)} + upah ${formatRupiahShort(d.w.biayaUpah)} + alat ${formatRupiahShort(d.w.biayaAlat)}` : '';
              return `${m.label}: ${nilai}${komposisi} • ${formatInt(d.w.count)} rec, ${formatInt(d.w.hari)} hari`;
            }
          }
        }
      },
      scales: {
        x: { beginAtZero: true, grace: '18%', grid: { color: '#f1f5f9' },
             ticks: { font: { size: 10 }, maxTicksLimit: 5, callback: v => ((m.tipe === 'rp' || m.tipe === 'rr') ? formatRupiahShort(v) : (m.tipe === 'pct' ? v + '%' : v)) },
             title: { display: true, text: (m.tipe === 'rp' ? satuan : (m.tipe === 'rr' ? m.unit : (m.tipe === 'vol' ? (satVolMode || m.satVol) : '% dari total'))), font: { size: 10 } } },
        y: { grid: { display: false }, ticks: { font: { size: 11 } } }
      }
    }
  });

  // kontrol metrik (dropdown + tombol cepat) — dipasang sekali
  const sel = document.getElementById('biayaMetric');
  if (sel && !sel.dataset.bound) {
    sel.dataset.bound = '1';
    sel.innerHTML = Object.keys(BIAYA_METRIC).map(k => `<option value="${k}">${esc(BIAYA_METRIC[k].label)}</option>`).join('');
    sel.value = biayaMetric;
    sel.addEventListener('change', (e) => { biayaMetric = e.target.value; renderBiayaPerformaChart(); });
  } else if (sel) { sel.value = biayaMetric; }

  const chips = document.getElementById('biayaMetricChips');
  if (chips && !chips.dataset.bound) {
    chips.dataset.bound = '1';
    chips.innerHTML = BIAYA_METRIC_CEPAT.map(k =>
      `<button type="button" data-biaya-metric="${k}" class="rounded-full border border-slate-200 bg-white px-3 py-1 text-[10px] font-semibold text-slate-600 transition hover:border-slate-300 hover:bg-slate-50">${esc(BIAYA_METRIC[k].label)}</button>`).join('');
    chips.addEventListener('click', (e) => {
      const b = e.target.closest('[data-biaya-metric]');
      if (!b) return;
      biayaMetric = b.dataset.biayaMetric;
      if (sel) sel.value = biayaMetric;
      renderBiayaPerformaChart();
    });
  }
  if (chips) {
    chips.querySelectorAll('[data-biaya-metric]').forEach(b => {
      const aktif = b.dataset.biayaMetric === biayaMetric;
      b.className = aktif
        ? 'rounded-full border border-slate-900 bg-slate-900 px-3 py-1 text-[10px] font-semibold text-white transition'
        : 'rounded-full border border-slate-200 bg-white px-3 py-1 text-[10px] font-semibold text-slate-600 transition hover:border-slate-300 hover:bg-slate-50';
      b.setAttribute('aria-pressed', aktif ? 'true' : 'false');
    });
  }

  const note = document.getElementById('chartBiayaPerformaNote');
  if (note) {
    const tertinggi = data[0], terendah = data[data.length - 1];
    const tulis = (d) => ((m.tipe === 'rp' || m.tipe === 'rr') ? formatRupiah(d.v) : (m.tipe === 'pct' ? formatNumber(d.v, 1) + '%' : formatNumber(d.v, 2) + ' ' + (m.tipe === 'vol' ? (satVolMode || m.satVol) : '')));
    note.textContent = (!ikutModeBiaya(m)
      ? 'Rasio per wilayah (tidak mengikuti mode rata-rata/total). '
      : (biayaMode === 'total' ? 'Nilai = total per wilayah. ' : `Nilai = rata-rata ${satuan} per wilayah (dibagi data wilayah itu sendiri). `)) +
      (tertinggi ? `Tertinggi: ${tertinggi.w.wilayah} — ${tulis(tertinggi)}` : '') +
      (terendah && terendah !== tertinggi ? ` • Terendah: ${terendah.w.wilayah} — ${tulis(terendah)}.` : '.');
  }
}

// ===== TABEL "Rincian Biaya per Wilayah" (kolom Wilayah beku, gaya tabel waktu) =====
function renderBiayaWilayahTable() {
  const tbody = $('#biayaWilayahBody');
  if (!tbody) return;
  const { list, totals } = getBiayaWilayahStats();
  const foot = $('#biayaWilayahFoot');
  const mode = modeBiaya();
  if (!list.length) {
    tbody.innerHTML = '<tr><td colspan="15" class="px-4 py-8 text-center text-slate-400">Tidak ada data biaya untuk filter ini</td></tr>';
    if (foot) foot.innerHTML = '';
    return;
  }
  // rata-rata Rp/Ha untuk badge efisiensi (rasio, tidak ikut mode)
  const rpHa = list.map(x => x.rpPerHa).filter(v => v > 0);
  const avgRpHa = rpHa.length ? rpHa.reduce((a, b) => a + b, 0) / rpHa.length : 0;

  // judul kolom nominal menyebut satuan mode aktif
  document.querySelectorAll('#biayaWilayahHead th[data-unit]').forEach(th => {
    if (!th.dataset.label) th.dataset.label = th.textContent.trim().replace(/\s*\([^)]*\)$/, '');
    const sat = th.dataset.unit === 'rr' ? 'Rp' : modeBiaya().satPendek;   // kolom rasio tetap Rp
    th.textContent = th.dataset.label + ' (' + sat + ')';
  });

  tbody.innerHTML = list.map(x => {
    const f = bagiBiaya(x);
    let badge;
    if (avgRpHa && x.rpPerHa <= avgRpHa * 0.9) badge = '<span class="inline-flex rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700 ring-1 ring-emerald-200">Hemat</span>';
    else if (avgRpHa && x.rpPerHa <= avgRpHa * 1.1) badge = '<span class="inline-flex rounded-full bg-sky-50 px-2 py-0.5 text-[10px] font-medium text-sky-700 ring-1 ring-sky-200">Normal</span>';
    else badge = '<span class="inline-flex rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-medium text-red-700 ring-1 ring-red-200">Mahal</span>';
    return `
    <tr class="hover:bg-amber-50/40 transition">
      <td class="px-3 py-2.5 whitespace-nowrap font-semibold text-slate-900">${esc(x.wilayah)}</td>
      <td class="px-3 py-2.5 text-right">${formatInt(x.count)}</td>
      <td class="px-3 py-2.5 text-right">${formatInt(x.hari)}</td>
      <td class="px-3 py-2.5 text-right">${formatNumber(x.luas, 2)}</td>
      <td class="px-3 py-2.5 text-right">${formatInt(x.biayaSolar / f)}</td>
      <td class="px-3 py-2.5 text-right">${formatInt(x.biayaUpah / f)}</td>
      <td class="px-3 py-2.5 text-right">${formatInt(x.biayaAlat / f)}</td>
      <td class="px-3 py-2.5 text-right font-bold text-amber-700">${formatInt(x.biayaTotal / f)}</td>
      <td class="px-3 py-2.5 text-right">
        <span class="inline-flex items-center gap-1.5"><span class="hidden h-1.5 w-10 overflow-hidden rounded-full bg-slate-100 sm:inline-flex"><span class="h-full rounded-full bg-amber-400" style="width:${Math.min(100, x.share)}%"></span></span><span class="text-[10px] text-slate-500">${formatNumber(x.share, 1)}%</span></span>
      </td>
      <td class="px-3 py-2.5 text-right font-semibold text-slate-900">${formatInt(x.rpPerHa)}</td>
      <td class="px-3 py-2.5 text-right">${formatInt(x.rpPerJam)}</td>
      <td class="px-3 py-2.5 text-right">${formatInt(x.rpPerLiter)}</td>
      <td class="px-3 py-2.5 text-right">${formatInt(x.count ? x.biayaTotal / x.count : 0)}</td>
      <td class="px-3 py-2.5 text-right">${formatNumber(x.solar && x.luas ? x.solar / x.luas : 0, 1)}</td>
      <td class="px-3 py-2.5 text-center">${badge}</td>
    </tr>`;
  }).join('');

  if (foot) {
    const t = getBiayaTotal();
    const f = bagiBiaya(t);
    const labelFoot = biayaMode === 'total' ? 'TOTAL' : (biayaMode === 'avgHari' ? 'RATA-RATA / HARI' : 'RATA-RATA / AKTIVITAS');
    foot.innerHTML = `
      <tr class="bg-slate-50 font-semibold text-slate-900">
        <td class="px-3 py-3 whitespace-nowrap">${labelFoot}</td>
        <td class="px-3 py-3 text-right">${formatInt(t.count)}</td>
        <td class="px-3 py-3 text-right">${formatInt(t.hari)}</td>
        <td class="px-3 py-3 text-right">${formatNumber(t.luas, 2)}</td>
        <td class="px-3 py-3 text-right">${formatInt(t.biayaSolar / f)}</td>
        <td class="px-3 py-3 text-right">${formatInt(t.biayaUpah / f)}</td>
        <td class="px-3 py-3 text-right">${formatInt(t.biayaAlat / f)}</td>
        <td class="px-3 py-3 text-right text-amber-700">${formatInt(t.biayaTotal / f)}</td>
        <td class="px-3 py-3 text-right">100%</td>
        <td class="px-3 py-3 text-right text-emerald-700">${formatInt(t.rpPerHa)}</td>
        <td class="px-3 py-3 text-right">${formatInt(t.rpPerJam)}</td>
        <td class="px-3 py-3 text-right">${formatInt(t.rpPerLiter)}</td>
        <td class="px-3 py-3 text-right">${formatInt(t.count ? t.biayaTotal / t.count : 0)}</td>
        <td class="px-3 py-3 text-right">${formatNumber(t.solar && t.luas ? t.solar / t.luas : 0, 1)}</td>
        <td class="px-3 py-3 text-center">-</td>
      </tr>`;
  }

  const note = $('#biayaWilayahNote');
  if (note) {
    note.textContent = biayaMode === 'total'
      ? 'Nilai = akumulasi seluruh aktivitas pada periode & filter aktif. Kolom % dr Total, Rp/Ha, Rp/Jam, Rp/Liter, L/Ha tetap rasio.'
      : (biayaMode === 'avgAkt'
        ? `Nilai biaya = rata-rata per AKTIVITAS (dibagi jumlah baris data). Kolom % dr Total, Rp/Ha, Rp/Jam, Rp/Liter, L/Ha tetap rasio.`
        : `Nilai biaya = rata-rata per HARI (dibagi hari operasi; kolom Hari per wilayah bisa berbeda). Kolom % dr Total, Rp/Ha, Rp/Jam, Rp/Liter, L/Ha tetap rasio.`);
  }
}

// Tombol mode biaya (total / rata-rata per aktivitas / per hari) pada tab Analisa Biaya
function bindBiayaModeButtons() {
  document.querySelectorAll('[data-biaya]').forEach(btn => {
    const set = () => {
      biayaMode = btn.dataset.biaya;
      document.querySelectorAll('[data-biaya]').forEach(x => {
        const aktif = x.dataset.biaya === biayaMode;
        x.className = aktif
          ? 'rounded-full bg-slate-900 px-3 py-1 text-[10px] font-semibold text-white transition'
          : 'rounded-full px-3 py-1 text-[10px] font-semibold text-slate-600 transition hover:bg-white';
        x.setAttribute('aria-pressed', aktif ? 'true' : 'false');
      });
      // renderBiaya() sudah mencakup kartu, chart Performa Biaya, tabel wilayah & tabel periode
      safeRender('biaya', renderBiaya);
    };
    if (btn.dataset.biayaBound === '1') return;
    btn.dataset.biayaBound = '1';
    btn.addEventListener('click', set);
  });
}

function renderBiaya() {
  const { list, totals } = getBiayaWilayahStats();

  // Kartu biaya (gaya tab Waktu & Utilisasi), chart Performa Biaya, & tabel per wilayah (kolom beku)
  safeRender('biayaCards', renderBiayaCards);
  safeRender('chartBiayaPerforma', renderBiayaPerformaChart);
  safeRender('biayaWilayah', renderBiayaWilayahTable);
  if (!list.length) return;

  // Chart: total biaya per wilayah (stacked komponen + line Rp/Ha)
  const fBiaya = (x) => bagiBiaya(x);
  ensureChart('chartBiayaWilayah', {
    type: 'bar',
    data: {
      labels: list.map(x=>x.wilayah),
      datasets: [
        { label:'Biaya Solar', data:list.map(x=>x.biayaSolar/fBiaya(x)), backgroundColor:'rgba(245,158,11,0.85)', borderRadius:4, stack:'biaya', yAxisID:'y' },
        { label:'Biaya Upah', data:list.map(x=>x.biayaUpah/fBiaya(x)), backgroundColor:'rgba(59,130,246,0.75)', borderRadius:4, stack:'biaya', yAxisID:'y' },
        { label:'Biaya Alat', data:list.map(x=>x.biayaAlat/fBiaya(x)), backgroundColor:'rgba(139,92,246,0.7)', borderRadius:4, stack:'biaya', yAxisID:'y' },
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
        y:{ stacked:true, beginAtZero:true, grid:{color:'#f1f5f9'}, ticks:{font:{size:10}, callback:v=>formatRupiahShort(v)}, title:{display:true,text:(biayaMode === 'total' ? 'Total Biaya' : 'Biaya ' + modeBiaya().satPendek),font:{size:10}} },
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
        { type:'bar', label: (biayaMode === 'total' ? 'Biaya' : 'Biaya (' + modeBiaya().satPendek + ')'), data: periodRows.map(r=>r.biayaTotal/bagiBiaya(r)), backgroundColor:'rgba(245,158,11,0.85)', borderRadius:5, yAxisID:'y' },
        { type:'line', label:'Rp/Ha', data: periodRows.map(r=>r.rpPerHa), borderColor:'#0f172a', backgroundColor:'#0f172a', borderWidth:2, pointRadius: periodRows.length>40?0:3, tension:0.35, yAxisID:'y1' }
      ]
    },
    options:{
      responsive:true, maintainAspectRatio:false,
      interaction:{mode:'index',intersect:false},
      plugins:{
        legend:{position:'bottom', labels:{usePointStyle:true,font:{size:10}}},
        // angka biaya ditulis ringkas (Rp 1,2 M / Rp 350 Rb) agar muat di atas batang
        barLabels:{ display:true, fmt:'rpshort', color:'#b45309' },
        title:{ display: biayaMode !== 'total', text: 'Nilai dibagi sesuai mode ' + modeBiaya().label, font:{size:10}, color:'#94a3b8', padding:{bottom:4} },
        tooltip:{backgroundColor:'#0f172a',cornerRadius:12, callbacks:{ label: ctx=> `${ctx.dataset.label}: ${formatRupiah(ctx.raw)}` }}
      },
      scales:{
        x:{grid:{display:false}, ticks:{font:{size:9}, maxRotation:0, autoSkip:true, maxTicksLimit:8}},
        y:{beginAtZero:true, grid:{color:'#f1f5f9'}, ticks:{font:{size:10}, callback:v=>formatRupiahShort(v)}, title:{display:true,text:(biayaMode === 'total' ? 'Total Biaya' : 'Biaya ' + modeBiaya().satPendek),font:{size:9}}},
        y1:{position:'right', beginAtZero:true, grid:{display:false}, ticks:{font:{size:10}, callback:v=>formatInt(v/1000)+'rb'}, title:{display:true,text:'Rp/Ha',font:{size:9}}}
      }
    }
  });

  // Tabel biaya per periode (nominal mengikuti mode tampilan biaya)
  const pbody = $('#biayaPeriodeBody');
  const periodoInfo = $('#biayaPeriodeInfo');
  const granLabel = biayaGran==='all' ? 'seluruh periode' : biayaGran==='daily' ? 'harian' : biayaGran==='weekly' ? 'mingguan' : 'bulanan';
  if (periodoInfo) periodoInfo.textContent = `Granularitas: ${granLabel} • ${periodRows.length} periode • mode ${modeBiaya().label}`;
  const trendLabel = $('#biayaTrendGranLabel');
  if (trendLabel) trendLabel.textContent = '(' + granLabel + ')';
  const judulGran = $('#biayaGranJudul');
  if (judulGran) judulGran.textContent = (biayaMode === 'total' ? 'Total' : 'Rata-rata') + ' Biaya & Rp/Ha per Periode';
  document.querySelectorAll('#biayaPeriodeHead th[data-unit]').forEach(th => {
    if (!th.dataset.label) th.dataset.label = th.textContent.trim().replace(/\s*\([^)]*\)$/, '');
    th.textContent = th.dataset.label + ' (' + modeBiaya().satPendek + ')';
  });
  if (pbody) {
    pbody.innerHTML = periodRows.map(r=>{
      const f = bagiBiaya(r);
      return `
      <tr class="hover:bg-amber-50/40 transition">
        <td class="px-4 py-2.5 whitespace-nowrap font-medium text-slate-900">${esc(r.label)}</td>
        <td class="px-4 py-2.5 whitespace-nowrap text-center text-slate-500">${formatInt(r.count)}<span class="ml-1 text-[9px] text-slate-400">${formatInt(r.hari)}h</span></td>
        <td class="px-4 py-2.5 whitespace-nowrap text-right">${formatNumber(r.luas,2)}</td>
        <td class="px-4 py-2.5 whitespace-nowrap text-right">${formatInt(r.biayaSolar/f)}</td>
        <td class="px-4 py-2.5 whitespace-nowrap text-right">${formatInt(r.biayaUpah/f)}</td>
        <td class="px-4 py-2.5 whitespace-nowrap text-right">${formatInt(r.biayaAlat/f)}</td>
        <td class="px-4 py-2.5 whitespace-nowrap text-right font-bold text-amber-700">${formatInt(r.biayaTotal/f)}</td>
        <td class="px-4 py-2.5 whitespace-nowrap text-right font-semibold text-slate-900">${formatInt(r.rpPerHa)}</td>
      </tr>`;
    }).join('') || '<tr><td colspan="8" class="px-4 py-8 text-center text-slate-400">Tidak ada data</td></tr>';
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
      layout:{ padding:{ top: 34 } },
      plugins:{
        legend:{position:'bottom', labels:{usePointStyle:true,font:{size:10}}},
        barLabels:{
          display:true,
          skipZero:true,
          // tiap batang memakai satuannya sendiri: Ha (kiri) vs Solar L (kanan)
          // satuan tidak ditulis (sumbu kiri 'Ha', kanan 'Solar L') agar label tidak bertabrakan
          fmtBySeries:{ y:'num2', y1:'int' },
          colorBySeries:{ y:'#047857', y1:'#b45309' },
          // label L ditulis di tengah batang (putih), label Ha di atas batang
          posBySeries:{ y:'outside', y1:'inside' },
          rotateBySeries:{ y:true },
          font:'600 9px Inter, system-ui, -apple-system, sans-serif'
        },
        tooltip:{backgroundColor:'#0f172a',cornerRadius:12}
      },
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

// ===== TAB UTILISASI: kartu waktu alat + tabel ringkas per wilayah =====
const WAKTU_CARDS = [
  { k:'plan',      label:'Plan Time',      icon:'calendar-clock', color:'slate',   fmt:'jam', desc:'Rencana jam kerja' },
  { k:'prepare',   label:'Prepare Time',   icon:'wrench',         color:'slate',   fmt:'jam', desc:'Persiapan sebelum operasi' },
  { k:'operating', label:'Operating Time', icon:'activity',       color:'blue',    fmt:'jam', desc:'Jam operasi efektif' },
  { k:'waiting',   label:'Waiting Time',   icon:'hourglass',      color:'amber',   fmt:'jam', desc:'Menunggu (cuaca/teknis)' },
  { k:'repair',    label:'Repair',         icon:'hammer',         color:'red',     fmt:'jam', desc:'Waktu perbaikan' },
  { k:'down',      label:'Down Time',      icon:'alert-octagon',  color:'red',     fmt:'jam', desc:'Alat berhenti (breakdown)' },
  { k:'standby',   label:'Standby',        icon:'pause-circle',   color:'violet',  fmt:'jam', desc:'Siaga tanpa operasi' },
  { k:'off',       label:'Off Time',       icon:'moon',           color:'slate',   fmt:'jam', desc:'Di luar jam kerja' },
  { k:'totOper',   label:'Tot. Oper. Time',icon:'timer',          color:'blue',    fmt:'jam', desc:'Total waktu operasional' },
  { k:'totalAvail',label:'Total Avail',    icon:'shield-check',   color:'emerald', fmt:'jam', desc:'Waktu tersedia' },
  { k:'totalTime', label:'Total Time',     icon:'clock',          color:'slate',   fmt:'jam', desc:'Total seluruh waktu' },
  { k:'air',       label:'Air Terpakai',   icon:'droplets',       color:'sky',     fmt:'air', desc:'Volume air irigasi' }
];
function renderWaktuCards() {
  const host = $('#waktuCards');
  if (!host) return;
  const t = getWaktuTotal();
  if (!t.count) { host.innerHTML = '<div class="col-span-12 text-center py-6 text-[12px] text-slate-400">Tidak ada data untuk filter ini</div>'; return; }
  const mode = modeWaktu();
  const bagi = bagiWaktu(t);
  const nAkt = t.count || 1, nHari = t.hari || 1;

  // angka pendukung: selalu tampilkan total, per aktivitas, dan per hari sekaligus
  const angka = (v, isAir, des) => (isAir ? formatInt(v) : formatNumber(v, des)) + (isAir ? ' L' : ' jam');
  const subUntuk = (total, isAir) => {
    const bagian = [];
    if (waktuMode !== 'total') bagian.push('total ' + angka(total, isAir, 1));
    if (waktuMode !== 'avgAkt') bagian.push(angka(total / nAkt, isAir, isAir ? 0 : 2) + '/aktivitas');
    if (waktuMode !== 'avgHari') bagian.push(angka(total / nHari, isAir, isAir ? 0 : 2) + '/hari');
    return bagian.join(' • ');
  };

  const noteMode = $('#waktuModeNote');
  if (noteMode) {
    noteMode.textContent = waktuMode === 'total'
      ? `Total seluruh kolom waktu pada periode terpilih (${formatInt(t.count)} aktivitas, ${formatInt(t.hari)} hari) & volume air terpakai.`
      : (waktuMode === 'avgHari'
        ? `Rata-rata per HARI seluruh kolom waktu (dibagi ${formatInt(t.hari)} hari operasi, dari ${formatInt(t.count)} aktivitas).`
        : `Rata-rata per AKTIVITAS seluruh kolom waktu (dibagi ${formatInt(t.count)} baris data, mencakup ${formatInt(t.hari)} hari).`);
  }

  host.innerHTML = WAKTU_CARDS.map(c => {
    const total = t[c.k] || 0;
    const isAir = c.fmt === 'air';
    const nilai = total / bagi;
    const utama = (isAir ? formatInt(nilai) : formatNumber(nilai, waktuMode === 'total' ? 1 : 2)) +
      ` <span class="text-[10px] font-medium text-slate-400">${esc(isAir ? mode.satAir : mode.satJam)}</span>`;
    return `
      <div class="rounded-2xl border border-slate-200/70 bg-white p-4 shadow-soft transition hover:border-slate-300">
        <div class="flex items-center justify-between gap-2">
          <span class="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-${c.color}-50 text-${c.color}-600 ring-1 ring-${c.color}-100"><i data-lucide="${c.icon}" class="h-4 w-4"></i></span>
          <span class="text-[10px] uppercase tracking-wider text-slate-400">${esc(c.desc)}</span>
        </div>
        <div class="mt-2.5 text-[16px] font-bold leading-tight tracking-tight text-slate-900">${utama}</div>
        <div class="mt-0.5 text-[11px] font-medium text-slate-500">${esc(c.label)}</div>
        <div class="mt-1 text-[10px] leading-relaxed text-slate-400">${esc(subUntuk(total, isAir))}</div>
      </div>`;
  }).join('');
  refreshIcons();
}

function renderWaktuWilayahTable() {
  const tbody = $('#waktuWilayahBody');
  if (!tbody) return;
  const rows = getWaktuWilayah();
  const foot = $('#waktuWilayahFoot');
  const mode = modeWaktu();
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="18" class="px-4 py-10 text-center text-slate-400">Tidak ada data</td></tr>';
    if (foot) foot.innerHTML = '';
    return;
  }
  const d = (v, des = 1) => formatNumber(v, des);

  // judul kolom ikut menyebut satuannya (jam/aktivitas, jam/hari, atau jam)
  const ths = document.querySelectorAll('#waktuWilayahHead th[data-unit]');
  ths.forEach(th => {
    const asli = th.dataset.label || th.textContent.trim();
    if (!th.dataset.label) th.dataset.label = asli.replace(/\s*\([^)]*\)$/, '');
    th.textContent = th.dataset.label + ' (' + (th.dataset.unit === 'L' ? mode.satPendek.replace('jam', 'L') : mode.satPendek) + ')';
  });

  tbody.innerHTML = rows.map(w => {
    const f = bagiWaktu(w);
    const jam = k => d(w[k] / f);
    return `
    <tr class="hover:bg-slate-50/80 transition">
      <td class="px-3 py-2.5 whitespace-nowrap font-semibold text-slate-900">${esc(w.wilayah)}</td>
      <td class="px-3 py-2.5 text-right">${formatInt(w.count)}</td>
      <td class="px-3 py-2.5 text-right">${formatInt(w.hari)}</td>
      <td class="px-3 py-2.5 text-right">${jam('plan')}</td>
      <td class="px-3 py-2.5 text-right">${jam('prepare')}</td>
      <td class="px-3 py-2.5 text-right font-medium text-blue-700">${jam('operating')}</td>
      <td class="px-3 py-2.5 text-right">${jam('waiting')}</td>
      <td class="px-3 py-2.5 text-right">${d(w.repair / f, 2)}</td>
      <td class="px-3 py-2.5 text-right">${d(w.down / f, 2)}</td>
      <td class="px-3 py-2.5 text-right">${jam('standby')}</td>
      <td class="px-3 py-2.5 text-right">${jam('off')}</td>
      <td class="px-3 py-2.5 text-right">${jam('totOper')}</td>
      <td class="px-3 py-2.5 text-right">${jam('totalAvail')}</td>
      <td class="px-3 py-2.5 text-right">${jam('totalTime')}</td>
      <td class="px-3 py-2.5 text-right font-medium text-sky-700">${w.air ? formatInt(w.air / f) : '0'}</td>
      <td class="px-3 py-2.5 text-right">${formatNumber(w.literPerHa, 0)}</td>
      <td class="px-3 py-2.5 text-right">${formatNumber(w.avgAvail, 1)}%</td>
      <td class="px-3 py-2.5 text-right">${formatNumber(w.avgUtil, 1)}%</td>
    </tr>`;
  }).join('');

  if (foot) {
    const t = getWaktuTotal();
    const f = bagiWaktu(t);
    const jam = k => d(t[k] / f);
    // baris ringkasan: pada mode rata-rata nilainya rata-rata keseluruhan (bukan penjumlahan kolom)
    const labelFoot = waktuMode === 'total' ? 'TOTAL' : (waktuMode === 'avgHari' ? 'RATA-RATA / HARI' : 'RATA-RATA / AKTIVITAS');
    foot.innerHTML = `
      <tr class="bg-slate-50 font-semibold text-slate-900">
        <td class="px-3 py-3 whitespace-nowrap">${labelFoot}</td>
        <td class="px-3 py-3 text-right">${formatInt(t.count)}</td>
        <td class="px-3 py-3 text-right">${formatInt(t.hari)}</td>
        <td class="px-3 py-3 text-right">${jam('plan')}</td>
        <td class="px-3 py-3 text-right">${jam('prepare')}</td>
        <td class="px-3 py-3 text-right text-blue-700">${jam('operating')}</td>
        <td class="px-3 py-3 text-right">${jam('waiting')}</td>
        <td class="px-3 py-3 text-right">${d(t.repair / f, 2)}</td>
        <td class="px-3 py-3 text-right">${d(t.down / f, 2)}</td>
        <td class="px-3 py-3 text-right">${jam('standby')}</td>
        <td class="px-3 py-3 text-right">${jam('off')}</td>
        <td class="px-3 py-3 text-right">${jam('totOper')}</td>
        <td class="px-3 py-3 text-right">${jam('totalAvail')}</td>
        <td class="px-3 py-3 text-right">${jam('totalTime')}</td>
        <td class="px-3 py-3 text-right text-sky-700">${formatInt(t.air / f)}</td>
        <td class="px-3 py-3 text-right">${formatNumber(t.air / (rows.reduce((a, w) => a + w.luas, 0) || 1), 0)}</td>
        <td class="px-3 py-3 text-right">-</td>
        <td class="px-3 py-3 text-right">-</td>
      </tr>`;
  }

  // keterangan mode di bawah/judul tabel
  const note = $('#waktuWilayahNote');
  if (note) {
    const nHari = getWaktuTotal().hari;
    note.textContent = waktuMode === 'total'
      ? 'Nilai = akumulasi seluruh aktivitas pada periode & filter aktif.'
      : (waktuMode === 'avgHari'
        ? `Nilai = rata-rata per HARI (total dibagi ${formatInt(nHari)} hari operasi pada periode ini; kolom Hari per wilayah bisa berbeda). Kolom L/Ha, % Avail, % Util tetap rasio.`
        : 'Nilai = rata-rata per AKTIVITAS (total dibagi jumlah baris data). Kolom L/Ha, % Avail, % Util tetap rasio.');
  }
}

// ===== Chart bar "Performa Waktu per Wilayah" (gaya sama dengan tab Performance Wilayah) =====
// jam: ikut mode (per aktivitas / per hari / total) • rasio (L/Ha, %Avail, %Util) tetap
const WAKTU_METRIC = {
  operating:  { label:'Jam Operasi',        k:'operating',  tipe:'jam',  ich:'activity',     warna:'rgba(59,130,246,0.85)',  color:'#1d4ed8' },
  plan:       { label:'Plan Time',          k:'plan',       tipe:'jam',  ich:'calendar-clock',warna:'rgba(100,116,139,0.85)', color:'#475569' },
  prepare:    { label:'Prepare Time',       k:'prepare',    tipe:'jam',  ich:'wrench',       warna:'rgba(148,163,184,0.85)', color:'#475569' },
  waiting:    { label:'Waiting Time',       k:'waiting',    tipe:'jam',  ich:'hourglass',    warna:'rgba(245,158,11,0.85)',  color:'#b45309' },
  repair:     { label:'Repair',             k:'repair',     tipe:'jam',  ich:'hammer',       warna:'rgba(239,68,68,0.8)',    color:'#b91c1c' },
  down:       { label:'Down Time',          k:'down',       tipe:'jam',  ich:'alert-octagon', warna:'rgba(220,38,38,0.75)',  color:'#991b1b' },
  standby:    { label:'Standby',            k:'standby',    tipe:'jam',  ich:'pause-circle', warna:'rgba(139,92,246,0.8)',   color:'#6d28d9' },
  off:        { label:'Off Time',           k:'off',        tipe:'jam',  ich:'moon',         warna:'rgba(203,213,225,0.95)', color:'#475569' },
  totOper:    { label:'Tot. Oper. Time',    k:'totOper',    tipe:'jam',  ich:'timer',        warna:'rgba(37,99,235,0.8)',     color:'#1e40af' },
  totalAvail: { label:'Total Avail',        k:'totalAvail', tipe:'jam',  ich:'shield-check', warna:'rgba(16,185,129,0.8)',   color:'#047857' },
  totalTime:  { label:'Total Time',         k:'totalTime',  tipe:'jam',  ich:'clock',        warna:'rgba(71,85,105,0.8)',    color:'#334155' },
  air:        { label:'Air Terpakai',       k:'air',        tipe:'air',  ich:'droplets',     warna:'rgba(14,165,233,0.85)',  color:'#0369a1' },
  literPerHa: { label:'L/Ha (efisiensi)',   k:'literPerHa',tipe:'rasio',ich:'gauge',        warna:'rgba(239,68,68,0.7)',    color:'#b91c1c' },
  avail:      { label:'% Availability',     k:'avgAvail',  tipe:'rasio',ich:'check-circle',  warna:'rgba(16,185,129,0.85)',  color:'#047857' },
  util:       { label:'% Utilization',      k:'avgUtil',   tipe:'rasio',ich:'trending-up',   warna:'rgba(15,23,42,0.75)',    color:'#0f172a' }
};
const WAKTU_METRIC_CEPAT = ['operating', 'waiting', 'air', 'totalAvail', 'util', 'literPerHa'];

function satuanMetrikWaktu(m) {
  if (m.tipe === 'jam')  return modeWaktu().satPendek;   // jam/akt | jam/hari | jam
  if (m.tipe === 'air')  return modeWaktu().satAir.replace(/^L/, 'L'); // L/aktivitas | L/hari | L
  if (m.k === 'literPerHa') return 'L/Ha';
  return '%';
}

function renderWaktuWilayahChart() {
  const cv = document.getElementById('chartWaktuWilayah');
  if (!cv) return;
  const rows = getWaktuWilayah();
  if (!rows.length) { ensureChart('chartWaktuWilayah', { type:'bar', data:{ labels:[], datasets:[] }, options:{ responsive:true, maintainAspectRatio:false } }); return; }
  const m = WAKTU_METRIC[waktuMetric] || WAKTU_METRIC.operating;
  const f = (w) => (m.tipe === 'rasio' ? 1 : bagiWaktu(w));
  const nilai = (w) => (w[m.k] || 0) / f(w);
  const data = rows.map(w => ({ w, v: nilai(w) })).sort((a, b) => b.v - a.v);
  const satuan = satuanMetrikWaktu(m);
  const fmtLabel = m.tipe === 'rasio' ? 'pct1' : (m.tipe === 'air' ? 'int' : 'num1');

  ensureChart('chartWaktuWilayah', {
    type: 'bar',
    data: {
      labels: data.map(d => d.w.wilayah),
      datasets: [{
        label: m.label + ' (' + satuan + ')',
        data: data.map(d => d.v),
        backgroundColor: m.warna,
        borderRadius: 8,
        borderSkipped: false
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      indexAxis: 'y',
      layout: { padding: { right: 64 } },
      plugins: {
        legend: { display: false },
        barLabels: { display: true, fmt: fmtLabel, color: m.color, maxBars: 45 },
        tooltip: {
          backgroundColor: '#0f172a', cornerRadius: 12,
          callbacks: {
            label: (ctx) => {
              const d = data[ctx.dataIndex];
              return `${m.label}: ${m.tipe === 'rasio' ? formatNumber(d.v, 1) + '%' : (m.tipe === 'air' ? formatInt(d.v) + ' L' : formatNumber(d.v, 2) + ' ' + satuan)} • ${formatInt(d.w.count)} rec, ${formatInt(d.w.hari)} hari`;
            }
          }
        }
      },
      scales: {
        x: { beginAtZero: true, grace: '18%', grid: { color: '#f1f5f9' }, ticks: { font: { size: 10 } }, title: { display: true, text: satuan, font: { size: 10 } } },
        y: { grid: { display: false }, ticks: { font: { size: 11 } } }
      }
    }
  });

  // kontrol metrik (dropdown + chip cepat) sekali saja
  const sel = document.getElementById('waktuMetric');
  if (sel && !sel.dataset.bound) {
    sel.dataset.bound = '1';
    sel.innerHTML = Object.keys(WAKTU_METRIC).map(k => `<option value="${k}">${esc(WAKTU_METRIC[k].label)}</option>`).join('');
    sel.value = waktuMetric;
    sel.addEventListener('change', (e) => { waktuMetric = e.target.value; renderWaktuWilayahChart(); });
  } else if (sel) {
    sel.value = waktuMetric;
  }
  const chips = document.getElementById('waktuMetricChips');
  if (chips && !chips.dataset.bound) {
    chips.dataset.bound = '1';
    chips.innerHTML = WAKTU_METRIC_CEPAT.map(k =>
      `<button type="button" data-waktu-metric="${k}" class="rounded-full border border-slate-200 bg-white px-3 py-1 text-[10px] font-semibold text-slate-600 transition hover:border-slate-300 hover:bg-slate-50">${esc(WAKTU_METRIC[k].label)}</button>`).join('');
    chips.addEventListener('click', (e) => {
      const b = e.target.closest('[data-waktu-metric]');
      if (!b) return;
      waktuMetric = b.dataset.waktuMetric;
      if (sel) sel.value = waktuMetric;
      renderWaktuWilayahChart();
    });
  }
  if (chips) {
    chips.querySelectorAll('[data-waktu-metric]').forEach(b => {
      const aktif = b.dataset.waktuMetric === waktuMetric;
      b.className = aktif
        ? 'rounded-full border border-slate-900 bg-slate-900 px-3 py-1 text-[10px] font-semibold text-white transition'
        : 'rounded-full border border-slate-200 bg-white px-3 py-1 text-[10px] font-semibold text-slate-600 transition hover:border-slate-300 hover:bg-slate-50';
      b.setAttribute('aria-pressed', aktif ? 'true' : 'false');
    });
  }
  const note = document.getElementById('chartWaktuWilayahNote');
  if (note) {
    const nilaiTertinggi = data[0];
    note.textContent = (m.tipe === 'rasio'
      ? `Rasio per wilayah (tidak mengikuti mode rata-rata/total). `
      : (waktuMode === 'total' ? `Nilai = total ${modeWaktu().satJam} per wilayah. `
        : `Nilai = rata-rata ${satuan} per wilayah (dibagi data wilayah itu sendiri). `)) +
      (nilaiTertinggi ? `Tertinggi: ${nilaiTertinggi.w.wilayah} — ${m.tipe === 'rasio' ? formatNumber(nilaiTertinggi.v, 1) + '%' : (m.tipe === 'air' ? formatInt(nilaiTertinggi.v) + ' L' : formatNumber(nilaiTertinggi.v, 2) + ' ' + satuan)}.` : '');
  }
}

function renderUtilisasiTab() {
  safeRender('charts-util', () => renderCharts('utilisasi'));
  safeRender('waktuCards', renderWaktuCards);
  safeRender('chartWaktuWilayah', renderWaktuWilayahChart);
  safeRender('waktuWilayah', renderWaktuWilayahTable);
}

// Tombol mode waktu (rata-rata/aktivitas, rata-rata/hari, total) pada tab Waktu & Utilisasi
function bindWaktuModeButtons() {
  document.querySelectorAll('[data-waktu]').forEach(btn => {
    const set = () => {
      waktuMode = btn.dataset.waktu;
      document.querySelectorAll('[data-waktu]').forEach(x => {
        const aktif = x.dataset.waktu === waktuMode;
        x.className = aktif
          ? 'rounded-full bg-slate-900 px-3 py-1 text-[10px] font-semibold text-white transition'
          : 'rounded-full px-3 py-1 text-[10px] font-semibold text-slate-600 transition hover:bg-white';
        x.setAttribute('aria-pressed', aktif ? 'true' : 'false');
      });
      safeRender('waktuCards', renderWaktuCards);
      safeRender('chartWaktuWilayah', renderWaktuWilayahChart);
      safeRender('waktuWilayah', renderWaktuWilayahTable);
      safeRender('charts-util', () => renderCharts('utilisasi'));
    };
    if (btn.dataset.waktuBound === '1') return;
    btn.dataset.waktuBound = '1';
    btn.addEventListener('click', set);
  });
}

// ===== TAB INDEX SOLAR =====
function renderIndexKPI() {
  const host = $('#indexKpiGrid');
  if (!host) return;
  const iv = getIndexSolarView();
  if (!iv.rows.length) {
    host.innerHTML = '<div class="col-span-12 rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-center text-[12px] text-slate-400">Data "Index Solar" belum tersedia atau tidak ada yang cocok dengan filter.</div>';
    return;
  }
  const r = iv.ringkas;
  const nol = r.nol;
  const selisihTotal = r.selisih + r.selisihAnomali;
  const deviasiPct = r.kalibrasiAvg ? ((r.ltrPerJam - r.kalibrasiAvg) / r.kalibrasiAvg) * 100 : 0;
  const cards = [
    { label:'Engine Dievaluasi', value:`${formatInt(r.aktifAll)}`, unit:'engine', sub:`${formatInt(r.nol)} tanpa catatan solar • ${formatInt(r.anomaly)} anomali • ${formatInt(r.tanpaSiram)} tanpa siram`, icon:'cpu', color:'slate' },
    { label:'Pemakaian Solar (Index)', value:formatInt(r.solar), unit:'L', sub:`${formatNumber(r.jam,1)} jam operasi tercatat`, icon:'fuel', color:'amber' },
    { label:'Aktual vs Kalibrasi', value:`${formatNumber(r.ltrPerJam,2)}`, unit:'L/jam',
      sub:`kalibrasi rata-rata ${formatNumber(r.kalibrasiAvg,2)} L/jam (${deviasiPct>=0?'+':''}${formatNumber(deviasiPct,1)}%)`, icon:'gauge', color: deviasiPct<=0 ? 'emerald' : 'red' },
    { label:'Hasil Evaluasi', value:`${formatInt(r.hemat)} / ${formatInt(r.boros)}`, unit:'hemat / boros',
      sub:`dari ${formatInt(r.terukur)} engine dengan pemakaian terukur (${formatNumber(r.terukur ? r.hemat / r.terukur * 100 : 0, 0)}% hemat)`, icon:'clipboard-check', color:'emerald' },
    { label:'Total Selisih', value:formatInt(r.selisih), unit:'L',
      sub: selisihTotal > r.selisih ? `+${formatInt(selisihTotal - r.selisih)} L dari ${formatInt(r.anomaly)} data anomali` : 'selisih terhadap kalibrasi', icon:'scale', color:'red' }
  ];
  host.innerHTML = cards.map(c => `
    <div class="rounded-[18px] border border-slate-200/70 bg-white p-4 shadow-soft">
      <div class="flex items-start justify-between">
        <span class="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-${c.color}-50 text-${c.color}-600 ring-1 ring-${c.color}-200/50"><i data-lucide="${c.icon}" class="h-4 w-4"></i></span>
      </div>
      <div class="mt-3 text-[11px] font-medium uppercase tracking-wide text-slate-500">${esc(c.label)}</div>
      <div class="mt-1 text-[20px] font-bold leading-tight tracking-tight text-slate-900">${c.value} <span class="text-[11px] font-medium text-slate-400">${c.unit}</span></div>
      <div class="mt-1 text-[11px] text-slate-500">${c.sub}</div>
    </div>`).join('');
  refreshIcons();
}
function renderIndexTable() {
  const tbody = $('#indexTableBody');
  if (!tbody) return;
  const iv = getIndexSolarView();
  const rows = iv.rows;
  const totalPages = Math.max(1, Math.ceil(rows.length / indexPageSize));
  if (indexPage > totalPages) indexPage = totalPages;
  const start = (indexPage - 1) * indexPageSize;
  const pageRows = rows.slice(start, start + indexPageSize);
  const info = $('#indexPageInfo'); if (info) info.textContent = `Page ${indexPage} / ${totalPages}`;
  const cnt = $('#indexCount'); if (cnt) cnt.textContent = formatInt(rows.length);
  const prev = $('#indexPrevPage'); if (prev) prev.disabled = indexPage <= 1;
  const next = $('#indexNextPage'); if (next) next.disabled = indexPage >= totalPages;

  if (!pageRows.length) {
    tbody.innerHTML = '<tr><td colspan="13" class="px-4 py-10 text-center text-slate-400">Tidak ada engine yang cocok</td></tr>';
    return;
  }
  const badge = (r) => {
    if (r.anomali) return '<span class="inline-flex whitespace-nowrap rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-medium text-violet-700 ring-1 ring-violet-200">Anomali</span>';
    if (!r.aktif) return '<span class="inline-flex whitespace-nowrap rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500 ring-1 ring-slate-200">Tidak ada siram</span>';
    if (r.solar === 0) return '<span class="inline-flex whitespace-nowrap rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600 ring-1 ring-slate-200">Solar 0 L</span>';
    return r.justifikasi === 'Boros'
      ? '<span class="inline-flex whitespace-nowrap rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-medium text-red-700 ring-1 ring-red-200">Boros</span>'
      : '<span class="inline-flex whitespace-nowrap rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700 ring-1 ring-emerald-200">Hemat</span>';
  };
  tbody.innerHTML = pageRows.map(r => {
    const devWarna = !r.kalibrasi ? 'text-slate-400' : (r.deviasi > 0 ? 'text-red-600' : 'text-emerald-600');
    return `
    <tr class="hover:bg-slate-50/80 transition">
      <td class="px-3 py-2.5 whitespace-nowrap font-mono text-[11px] font-semibold text-slate-900">${esc(r.engine)}</td>
      <td class="px-3 py-2.5 whitespace-nowrap"><span class="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium">${esc(r.wilayah)}</span></td>
      <td class="px-3 py-2.5 whitespace-nowrap font-mono text-[11px] text-slate-600">${esc(r.lokasi)}</td>
      <td class="px-3 py-2.5 whitespace-nowrap text-[11px] text-slate-600">${esc(r.jenis)}</td>
      <td class="px-3 py-2.5 whitespace-nowrap text-[11px] text-slate-600">${esc(r.tanggalLabel || '-')}</td>
      <td class="px-3 py-2.5 text-right font-medium">${formatInt(r.solar)}</td>
      <td class="px-3 py-2.5 text-right">${formatNumber(r.jam, 1)}</td>
      <td class="px-3 py-2.5 text-right font-semibold">${formatNumber(r.lpjAktual, 1)}</td>
      <td class="px-3 py-2.5 text-right text-slate-500">${r.kalibrasi ? formatNumber(r.kalibrasi, 2) : '-'}</td>
      <td class="px-3 py-2.5 text-right ${devWarna}">${r.kalibrasi ? (r.deviasi > 0 ? '+' : '') + formatNumber(r.deviasi, 1) : '-'}</td>
      <td class="px-3 py-2.5 text-right ${r.selisih ? 'font-medium text-slate-700' : 'text-slate-400'}">${formatNumber(r.selisih, 0)}</td>
      <td class="px-3 py-2.5 whitespace-nowrap text-center">${badge(r)}</td>
      <td class="px-3 py-2.5 text-right text-[11px] text-slate-500">${r.zpN ? formatInt(r.zpN) + ' act • ' + formatNumber(r.zpLtrPerJam, 1) + ' L/j' : '-'}</td>
    </tr>`;
  }).join('');
}
function renderIndexSolar() {
  safeRender('indexKpi', renderIndexKPI);
  safeRender('charts-index', () => renderCharts('indexsolar'));
  safeRender('indexTable', renderIndexTable);
}

// Render isi satu tab saja (dipakai oleh updateAll & activateTab)
function renderTab(tab) {
  if (!rawData.length) return;
  if (tab === 'overview') { safeRender('kpi', renderKPIs); safeRender('overviewWilayah', renderOverviewWilayah); safeRender('charts-ovw', () => renderCharts('overview')); }
  else if (tab === 'wilayah') { safeRender('charts-wil', () => renderCharts('wilayah')); safeRender('wilayahDetail', renderWilayahDetail); }
  else if (tab === 'biaya') { safeRender('biaya', renderBiaya); }
  else if (tab === 'utilisasi') { renderUtilisasiTab(); }
  else if (tab === 'indexsolar') { renderIndexSolar(); }
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

// ---------------------------------------------------------------- plugin label bar
// Menuliskan nilai langsung di atas batang (bar vertikal) atau di ujung batang
// (bar horizontal / indexAxis 'y') supaya angka bisa dibaca tanpa tooltip.
//
// PENTING: konfigurasi hanya boleh berisi nilai primitif (string/angka/boolean).
// Chart.js me-resolve nilai fungsi di dalam options.plugins.* sebagai "scriptable
// option" dan memanggilnya dengan objek konteks internal (bukan angka), sehingga
// formatter berbentuk fungsi akan error. Karena itu format dipilih lewat kode teks
// ('ha', 'l', 'rp', ...) yang dipetakan di BAR_LABEL_FMT.
const BAR_LABEL_FMT = {
  ha:   v => formatNumber(v, 2) + ' Ha',
  l:    v => formatInt(v) + ' L',
  rp:   v => formatRupiah(v),
  pct:  v => formatNumber(v, 1) + '%',
  num1: v => formatNumber(v, 1),
  num2: v => formatNumber(v, 2),
  num3: v => formatNumber(v, 3),
  int:  v => formatInt(v),
  'ha0': v => formatInt(v) + ' Ha',
  'ha1': v => formatNumber(v, 1) + ' Ha',
  'Lint': v => formatInt(Math.round(v)) + ' L',
  'rpshort': v => formatRupiahShort(v),
  'signed2': v => (v > 0 ? '+' : '') + formatNumber(v, 2)
};

let barLabelsRegistered = false;
const BAR_LABELS = {
  id: 'barLabels',
  afterDatasetsDraw(chart) {
    const cfg = chart.$barLabels;                 // objek asli (bukan proxy Chart.js)
    // $labelInfo selalu di-reset supaya informasi dari render sebelumnya tidak tertinggal
    chart.$labelInfo = { tertulis: 0, kandidat: 0, batang: chart.data.datasets.reduce((a, d) => a + (d.data ? d.data.length : 0), 0) };
    if (!cfg || cfg.display === false) return;
    const ctx = chart.ctx;
    const area = chart.chartArea;
    if (!area) return;
    const horizontal = chart.options.indexAxis === 'y';
    ctx.save();
    ctx.font = cfg.font || '600 10px Inter, system-ui, -apple-system, sans-serif';
    ctx.lineWidth = 3;
    ctx.strokeStyle = cfg.halo || 'rgba(255,255,255,0.9)';
    ctx.lineJoin = 'round';
    const kotakTerpakai = [];                       // label yang sudah tertulis, agar tidak bertumpuk
    let jumlahKandidat = 0, jumlahTertulis = 0;     // untuk diagnosa/skrip uji
    const tumpangTindih = (r) => kotakTerpakai.some(k => !(r.x1 < k.x0 || r.x0 > k.x1 || r.y1 < k.y0 || r.y0 > k.y1));

    // Rintangan: titik & ruas garis dari dataset garis/scatter. Label dihindarkan dari garis tren
    // agar angkanya tidak tertimpa (mis. garis "Avg Ltr/Jam" pada chart Solar).
    const rintangan = [];
    chart.data.datasets.forEach((ds, di) => {
      const tipe = ds.type || chart.config.type;
      if (tipe === 'bar' || tipe === 'doughnut' || tipe === 'pie') return;
      const m = chart.getDatasetMeta(di);
      if (!m || m.hidden) return;
      const titik = m.data.filter(el => el && isFinite(el.x) && isFinite(el.y)).map(el => ({ x: el.x, y: el.y }));
      titik.forEach(t => rintangan.push({ x0: t.x - 6, x1: t.x + 6, y0: t.y - 6, y1: t.y + 6 }));
      for (let i = 1; i < titik.length; i++) {
        const a = titik[i - 1], b = titik[i];
        [0.25, 0.5, 0.75].forEach(t => {
          const x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t;
          rintangan.push({ x0: x - 5, x1: x + 5, y0: y - 5, y1: y + 5 });
        });
      }
    });
    const kenaRintangan = (r) => rintangan.some(k => !(r.x1 < k.x0 || r.x0 > k.x1 || r.y1 < k.y0 || r.y0 > k.y1));

    chart.data.datasets.forEach((ds, di) => {
      if (ds.barLabels === false) return;
      const tipe = ds.type || chart.config.type;
      if (tipe !== 'bar') return;                   // lewati garis/scatter/bubble/doughnut
      // terlalu banyak batang (mis. tampilan Harian) -> angka tidak akan terbaca, lebih baik tidak ditulis
      if (cfg.maxBars && ds.data.length > cfg.maxBars) return;
      const meta = chart.getDatasetMeta(di);
      if (!meta || meta.hidden) return;
      const kunci = (cfg.fmtBySeries && ds.yAxisID && cfg.fmtBySeries[ds.yAxisID]) || cfg.fmt || 'num1';
      const format = BAR_LABEL_FMT[kunci] || BAR_LABEL_FMT.num1;
      const warna = (cfg.colorBySeries && ds.yAxisID && cfg.colorBySeries[ds.yAxisID]) || cfg.color || '#334155';
      const posisi = (cfg.posBySeries && ds.yAxisID && cfg.posBySeries[ds.yAxisID]) || 'outside';
      const rotate = !!(cfg.rotateBySeries ? (ds.yAxisID && cfg.rotateBySeries[ds.yAxisID]) : cfg.rotate);
      const warnaIsi = (cfg.insideColorBySeries && ds.yAxisID && cfg.insideColorBySeries[ds.yAxisID]) || cfg.insideColor || '#ffffff';
      const fontDasar = cfg.font || '600 10px Inter, system-ui, -apple-system, sans-serif';
      // ukuran huruf alternatif (mengecil) untuk label yang harus masuk ke dalam batang
      const fontKecil = [fontDasar, fontDasar.replace(/\b(\d+)px\b/, (m, n) => Math.max(8, n - 1) + 'px'), fontDasar.replace(/\b(\d+)px\b/, (m, n) => Math.max(8, n - 2) + 'px')]
        .filter((f, i, a) => a.indexOf(f) === i);

      // kandidat label: hanya nilai angka yang valid
      const kandidat = [];
      meta.data.forEach((el, i) => {
        const v = ds.data[i];
        if (typeof v !== 'number' || !isFinite(v)) return;
        if (cfg.skipZero && v === 0) return;
        const teks = format(v);
        if (teks) kandidat.push({ el, i, v, teks });
      });

      // Batang rapat (mis. granularitas harian): tulis angka sebisanya saja, tapi
      // diprioritaskan untuk nilai terbesar supaya yang tampil tetap yang penting.
      // jarak minimum antar batang (dipakai untuk ukuran huruf label yang ditulis di dalam batang)
      let jarakMin = Infinity;
      for (let i = 1; i < meta.data.length; i++) {
        const a = meta.data[i - 1], b = meta.data[i];
        if (!a || !b) continue;
        const d = horizontal ? Math.abs(b.y - a.y) : Math.abs(b.x - a.x);
        if (d > 1) jarakMin = Math.min(jarakMin, d);
      }
      if (!isFinite(jarakMin)) jarakMin = 999;

      // batang terpanjang/tertinggi paling sulit mendapat ruang di luar batang -> didahulukan
      kandidat.sort((x, y) => Math.abs(y.v) - Math.abs(x.v));
      if (cfg.maxLabels && kandidat.length > cfg.maxLabels) kandidat.length = cfg.maxLabels;

      kandidat.forEach(({ el, v, teks }) => {
        const lebar = ctx.measureText(teks).width;
        const tinggi = 11;
        const opsi = [];                 // beberapa alternatif posisi; dipakai yang pertama tidak bertabrakan

        if (horizontal) {
          const cx = el.base !== undefined ? el.base + (el.x - el.base) / 2 : el.x;
          const muatDiLuar = v >= 0 && el.x + 6 + lebar <= area.right - 2;
          if (posisi === 'inside' || (v >= 0 && !muatDiLuar)) {
            // coba ukuran huruf penuh dulu, lalu mengecil supaya muat di dalam batang
            fontKecil.forEach(f => {
              ctx.font = f;
              const lw = ctx.measureText(teks).width;
              ctx.font = fontDasar;
              opsi.push({
                rect: { x0: cx - lw / 2 - 1, x1: cx + lw / 2 + 1, y0: el.y - tinggi, y1: el.y + tinggi },
                gambar: () => { ctx.save(); ctx.font = f; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = warnaIsi; ctx.fillText(teks, cx, el.y); ctx.restore(); }
              });
            });
          } else if (v < 0) {
            const x = el.x - 6;
            opsi.push({
              rect: { x0: x - lebar - 2, x1: x + 2, y0: el.y - tinggi, y1: el.y + tinggi },
              gambar: () => { ctx.textAlign = 'right'; ctx.textBaseline = 'middle'; ctx.fillStyle = warna; ctx.strokeText(teks, x, el.y); ctx.fillText(teks, x, el.y); }
            });
          } else {
            const tinggiBatang = el.height || 12;
            [0, -(tinggiBatang / 2 + 3), (tinggiBatang / 2 + 3)].forEach(dy => {
              const x = el.x + 6, y = el.y + dy;
              opsi.push({
                rect: { x0: x - 2, x1: x + lebar + 2, y0: y - tinggi, y1: y + tinggi },
                gambar: () => { ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillStyle = warna; ctx.strokeText(teks, x, y); ctx.fillText(teks, x, y); }
              });
            });
          }
        } else {
          const x = Math.max(area.left + 2, Math.min(el.x, area.right - 2));
          if (rotate) {
            // label diputar 90°; ukuran huruf dipilih agar tetap muat di lebar batang
            const lebarBatang = el.width || 12;
            let fPutar = fontKecil[fontKecil.length - 1];
            for (const f of fontKecil) {
              ctx.font = f;
              const th = ctx.measureText('0').width;   // tinggi huruf saat diputar
              if (th <= lebarBatang - 2) { fPutar = f; break; }
            }
            ctx.font = fPutar;
            const lebarTeks = ctx.measureText(teks).width;
            ctx.font = fontDasar;
            const dasar = el.y - 4;
            const mode = [];
            if (dasar - lebarTeks >= area.top + 2) mode.push({ y: dasar, tandai: 'luar' });      // di atas batang
            if (el.base !== undefined && el.base - el.y > lebarTeks + 16) mode.push({ y: el.y + 6, tandai: 'dalam' });  // di dalam batang
            mode.forEach(m => {
              const yTeks = m.tandai === 'luar' ? m.y : m.y + lebarTeks;   // gambar dari bawah ke atas
              opsi.push({
                rect: { x0: x - 6, x1: x + 6, y0: yTeks - lebarTeks - 2, y1: (m.tandai === 'luar' ? m.y : m.y + lebarTeks) + 2 },
                gambar: () => {
                  ctx.save(); ctx.translate(x, yTeks); ctx.rotate(-Math.PI / 2);
                  ctx.font = fPutar; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
                  ctx.fillStyle = m.tandai === 'luar' ? warna : warnaIsi;
                  if (m.tandai === 'luar') ctx.strokeText(teks, 0, 0);
                  ctx.fillText(teks, 0, 0); ctx.restore();
                }
              });
            });
          } else if (posisi === 'inside') {
            const tengahY = el.base !== undefined ? el.y + (el.base - el.y) / 2 : el.y + 10;
            opsi.push({
              rect: { x0: x - lebar / 2 - 2, x1: x + lebar / 2 + 2, y0: tengahY - tinggi, y1: tengahY + tinggi },
              gambar: () => { ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = warnaIsi; ctx.fillText(teks, x, tengahY); }
            });
          } else if (v < 0) {
            [el.y + 5, el.y + 17].forEach(y => {
              opsi.push({
                rect: { x0: x - lebar / 2 - 2, x1: x + lebar / 2 + 2, y0: y - 2, y1: y + tinggi + 2 },
                gambar: () => { ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.fillStyle = warna; ctx.strokeText(teks, x, y); ctx.fillText(teks, x, y); }
              });
            });
          } else {
            // di atas batang; kalau bertabrakan dicoba naik lebih tinggi, terakhir ke dalam batang
            const dasar = el.y - 5;
            [0, 12, 24].forEach(naik => {
              const y = dasar - naik;
              if (y - tinggi < area.top + 2) return;      // bisa dicoba berikutnya
              opsi.push({
                rect: { x0: x - lebar / 2 - 2, x1: x + lebar / 2 + 2, y0: y - tinggi - 2, y1: y + 2 },
                gambar: () => { ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; ctx.fillStyle = warna; ctx.strokeText(teks, x, y); ctx.fillText(teks, x, y); }
              });
            });
            if (el.base !== undefined && el.base - el.y > tinggi + 20) {   // batang tinggi -> boleh di dalam
              const y = el.y + 14;                                        // agak ke bawah agar tidak menyentuh ujung batang
              // pilih satu ukuran huruf terbesar yang masih muat pada jarak antar batang
              let fTerpilih = fontKecil[fontKecil.length - 1];
              for (const f of fontKecil) {
                ctx.font = f;
                const lw0 = ctx.measureText(teks).width;
                if (lw0 <= jarakMin - 2 || f === fontKecil[fontKecil.length - 1]) { fTerpilih = f; break; }
              }
              ctx.font = fTerpilih;
              const lw = ctx.measureText(teks).width;
              ctx.font = fontDasar;
              const lebarBatang = el.width || 20;
              if (lw <= lebarBatang - 3) {
                // muat mendatar di dalam batang
                opsi.push({
                  rect: { x0: x - lw / 2 - 1, x1: x + lw / 2 + 1, y0: y - 2, y1: y + tinggi + 2 },
                  gambar: () => { ctx.save(); ctx.font = fTerpilih; ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.fillStyle = warnaIsi; ctx.fillText(teks, x, y); ctx.restore(); }
                });
              }
              // batang sempit -> tulis angka diputar 90° di dalam batang (tetap terbaca, tidak terpotong)
              const yPutar = el.y + 14 + lw;
              if (el.base !== undefined && el.base - el.y > lw + 26) {
                opsi.push({
                  rect: { x0: x - 7, x1: x + 7, y0: el.y + 12, y1: yPutar + 2 },
                  gambar: () => {
                    ctx.save(); ctx.translate(x, yPutar); ctx.rotate(-Math.PI / 2);
                    ctx.font = fTerpilih; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
                    ctx.fillStyle = warnaIsi;
                    ctx.fillText(teks, 0, 0); ctx.restore();
                  }
                });
              }
            }
          }
        }

        if (!opsi.length) return;
        jumlahKandidat++;
        for (const o of opsi) {
          if (tumpangTindih(o.rect) || kenaRintangan(o.rect)) continue;
          o.gambar();
          kotakTerpakai.push(o.rect);
          jumlahTertulis++;
          return;
        }
      });
    });
    chart.$labelInfo = { tertulis: jumlahTertulis, kandidat: jumlahKandidat, batang: chart.$labelInfo.batang };
    ctx.restore();
  }
};

function ensureChart(id, config) {
  const ctx = document.getElementById(id);
  if (!ctx) return null;
  if (!barLabelsRegistered && typeof Chart !== 'undefined' && Chart.register) {
    Chart.register(BAR_LABELS);
    barLabelsRegistered = true;
  }
  // simpan konfigurasi label bar sebagai objek biasa (hindari proxy scriptable Chart.js)
  const cfgLabel = config && config.options && config.options.plugins && config.options.plugins.barLabels;
  if (charts[id]) {
    charts[id].data = config.data;
    charts[id].options = config.options;
    charts[id].$barLabels = cfgLabel || null;
    charts[id].update();
    return charts[id];
  } else {
    const chart = new Chart(ctx, config);
    chart.$barLabels = cfgLabel || null;
    charts[id] = chart;
    return chart;
  }
}

// Peta chart -> tab pemiliknya, agar hanya chart pada tab aktif yang dirender
const CHART_TAB_OF = {
  chartSolar:'overview', chartLuas:'overview', chartJam:'overview', chartKecepatan:'overview',
  chartEfisiensi:'overview', chartWilayah:'wilayah', chartWilayahEff:'wilayah', chartWilayahCompare:'wilayah',
  chartJenisEngine:'utilisasi', chartAvail:'utilisasi', chartScatter:'utilisasi',
  chartWaktuKomposisi:'utilisasi', chartAir:'utilisasi', chartWaktuWilayah:'utilisasi',
  chartIndexBoros:'indexsolar', chartIndexHasil:'indexsolar', chartIndexWilayah:'indexsolar', chartIndexScatter:'indexsolar',
  chartBiayaWilayah:'biaya', chartBiayaKomposisi:'biaya', chartBiayaTrend:'biaya', chartBiayaGran:'biaya', chartBiayaPerforma:'biaya'
};
// Keterangan kecil di bawah chart: menjelaskan kapan angka pada batang tampil
function renderBarLabelNotes() {
  const nLuas = document.getElementById('chartLuasNote');
  const nSolar = document.getElementById('chartSolarNote');
  const teks = granularity === 'daily'
    ? 'Angka pada batang tidak ditampilkan pada tampilan Harian (terlalu rapat) — pilih Mingguan atau Bulanan.'
    : 'Angka pada setiap batang menunjukkan nilainya.';
  if (nLuas) nLuas.textContent = teks;
  if (nSolar) nSolar.textContent = teks;
}

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
      plugins: {
        legend: { display: true, position: 'bottom', labels: { usePointStyle: true, font:{size:11}}},
        barLabels: { display:true, fmt:'Lint', color:'#b45309', maxBars:45, rotate:true },
        tooltip: { backgroundColor: '#0f172a', titleFont:{size:11}, bodyFont:{size:11}, padding:10, cornerRadius:12 }
      },
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
      plugins:{
        legend:{position:'bottom', labels:{usePointStyle:true,font:{size:11}}},
        // angka di atas batang; otomatis disembunyikan bila batang terlalu rapat (harian)
        barLabels:{ display:true, fmt:'ha0', color:'#047857', maxBars:45, rotate:true },
        tooltip:{backgroundColor:'#0f172a',cornerRadius:12}
      },
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

  // keterangan label angka pada chart Overview
  renderBarLabelNotes();

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
      layout:{ padding:{ right: wm.fmt==='rp' || wm.fmt==='l' ? 84 : 58 } },
      plugins:{
        legend:{display:false},
        // angka langsung di ujung batang supaya terbaca tanpa hover
        // fmt memakai kunci teks (bukan fungsi) + mengikuti satuan metrik terpilih
        barLabels:{
          display:true,
          fmt: wm.fmt,
          color: wm.fmt==='pct' ? '#0f172a' : '#1e293b',
          font:'600 10px Inter, system-ui, -apple-system, sans-serif'
        },
        tooltip:{
          backgroundColor:'#0f172a', cornerRadius:12,
          callbacks:{
            label: ctx=> `${ctx.dataset.label}: ${fmtVal(ctx.raw)}`
          }
        }
      },
      scales:{ x:{beginAtZero:true, grace:'18%', grid:{color:'#f1f5f9'}, ticks:{font:{size:10}}}, y:{grid:{display:false}, ticks:{font:{size:11}}} }
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

  // ===== TAB UTILISASI: komposisi waktu alat (kolom Plan..Off, Tot Oper, Total Avail, Total Time) =====
  if (want('chartWaktuKomposisi')) {
    const wb = getWaktuBulanan();
    const modeW = modeWaktu();
    // nilai tiap bulan dibagi sesuai mode (total / rata-rata per aktivitas / rata-rata per hari)
    const bagiBulan = (w) => bagiWaktu(w);
    const seri = (k) => wb.map(w => w[k] / bagiBulan(w));
    const satuanY = modeW.id === 'total' ? 'Jam' : (modeW.id === 'avgHari' ? 'Jam/hari' : 'Jam/aktivitas');
    ensureChart('chartWaktuKomposisi', {
      type: 'bar',
      data: {
        labels: wb.map(w => w.label),
        datasets: [
          { label:'Operating', data: seri('operating'), backgroundColor:'#3b82f6', stack:'waktu' },
          { label:'Waiting', data: seri('waiting'), backgroundColor:'#f59e0b', stack:'waktu' },
          { label:'Prepare', data: seri('prepare'), backgroundColor:'#94a3b8', stack:'waktu' },
          { label:'Standby', data: seri('standby'), backgroundColor:'#8b5cf6', stack:'waktu' },
          { label:'Repair', data: seri('repair'), backgroundColor:'#ef4444', stack:'waktu' },
          { label:'Down Time', data: seri('down'), backgroundColor:'#dc2626', stack:'waktu' },
          { label:'Off Time', data: seri('off'), backgroundColor:'#cbd5e1', stack:'waktu' }
        ]
      },
      options: {
        responsive:true, maintainAspectRatio:false,
        interaction:{ mode:'index', intersect:false },
        plugins:{ legend:{ position:'bottom', labels:{ usePointStyle:true, font:{size:10}, boxWidth:8 }}, tooltip:{ backgroundColor:'#0f172a', cornerRadius:12, callbacks:{ label: ctx=> `${ctx.dataset.label}: ${formatNumber(ctx.raw,1)} ${modeW.satPendek}` } } },
        scales:{ x:{ stacked:true, grid:{display:false}, ticks:{font:{size:9}, maxTicksLimit:10} }, y:{ stacked:true, beginAtZero:true, grid:{color:'#f1f5f9'}, ticks:{font:{size:10}} , title:{display:true,text:satuanY,font:{size:10}}} }
      }
    });
    const noteW = $('#chartWaktuNote');
    if (noteW) noteW.textContent = modeW.id === 'total'
      ? 'Nilai = total jam setiap bulan.'
      : (modeW.id === 'avgHari'
        ? 'Nilai = rata-rata jam per HARI pada setiap bulan.'
        : 'Nilai = rata-rata jam per AKTIVITAS pada setiap bulan.');
  }
  if (want('chartAir')) {
    const wb = getWaktuBulanan();
    ensureChart('chartAir', {
      type: 'line',
      data: {
        labels: wb.map(w=>w.label),
        datasets: [
          { label:'Air Terpakai (m³)', data: wb.map(w=>w.air/1000), borderColor:'#0ea5e9', backgroundColor:'rgba(14,165,233,0.12)', fill:true, tension:0.35, pointRadius:0, borderWidth:2, yAxisID:'y' },
          { label:'Luas Siram (Ha)', data: wb.map(w=>w.luas), borderColor:'#10b981', backgroundColor:'transparent', tension:0.35, pointRadius:0, borderWidth:2, yAxisID:'y1' },
          { label:'Solar (L)', data: wb.map(w=>w.solar/1000), borderColor:'#f59e0b', borderDash:[4,4], tension:0.35, pointRadius:0, borderWidth:1.5, yAxisID:'y1' }
        ]
      },
      options: {
        responsive:true, maintainAspectRatio:false,
        interaction:{ mode:'index', intersect:false },
        plugins:{ legend:{ position:'bottom', labels:{ usePointStyle:true, font:{size:10} }}, tooltip:{ backgroundColor:'#0f172a', cornerRadius:12 } },
        scales:{ x:{ grid:{display:false}, ticks:{font:{size:9}, maxTicksLimit:10} },
                 y:{ beginAtZero:true, grid:{color:'#f1f5f9'}, ticks:{font:{size:10}}, title:{display:true,text:'Air (m³)',font:{size:10}} },
                 y1:{ beginAtZero:true, position:'right', grid:{display:false}, ticks:{font:{size:10}}, title:{display:true,text:'Ha / ribu L solar',font:{size:10}} } }
      }
    });
  }

  // ===== TAB INDEX SOLAR: pemakaian solar per engine vs kalibrasi =====
  if (want('chartIndexBoros') || want('chartIndexHasil') || want('chartIndexWilayah') || want('chartIndexScatter')) {
    const iv = getIndexSolarView();
    if (want('chartIndexBoros')) {
      // 10 penyimpangan terbesar (|deviasi| L/jam) supaya engine Boros & Hemat paling menyimpang
      // sama-sama terlihat - bukan hanya yang selisihnya kecil.
      // hanya engine dengan pemakaian terukur (solar > 0) supaya batang tidak didominasi
      // engine yang belum ada catatan solar (selisihnya = -kalibrasi, bukan penyimpangan nyata)
      const top = iv.rows
        .filter(r => r.aktif && !r.anomali && r.kalibrasi > 0 && r.solar > 0)
        .sort((a, b) => Math.abs(b.deviasi) - Math.abs(a.deviasi))
        .slice(0, 10)
        .sort((a, b) => Math.abs(a.deviasi) - Math.abs(b.deviasi));
      ensureChart('chartIndexBoros', {
        type: 'bar',
        data: {
          labels: top.map(r => r.engine + ' • ' + r.wilayah),
          datasets: [{ label:'Deviasi L/jam', data: top.map(r=>r.deviasi),
            backgroundColor: top.map(r=> r.justifikasi==='Boros' ? 'rgba(239,68,68,0.85)' : 'rgba(16,185,129,0.85)'), borderRadius:6, borderSkipped:false }]
        },
        options:{ responsive:true, maintainAspectRatio:false, indexAxis:'y',
          layout:{ padding:{ left: 46, right: 52 } },
          plugins:{ legend:{display:false},
            // +7,13 (boros) / -8,19 (hemat) di ujung batang
            barLabels:{ display:true, fmt:'signed2', font:'600 9px Inter, system-ui, -apple-system, sans-serif' },
            tooltip:{ backgroundColor:'#0f172a', cornerRadius:12,
            callbacks:{ label: ctx=> `${top[ctx.dataIndex].justifikasi} • aktual ${formatNumber(top[ctx.dataIndex].lpjAktual,2)} L/j vs kalibrasi ${formatNumber(top[ctx.dataIndex].kalibrasi,2)} L/j (${ctx.raw>0?'+':''}${formatNumber(ctx.raw,2)})` } } },
          scales:{ x:{ beginAtZero:true, grid:{color:'#f1f5f9'}, ticks:{font:{size:10}} }, y:{ grid:{display:false}, ticks:{font:{size:10}} } } }
      });
    }
    if (want('chartIndexHasil')) {
      const r = iv.ringkas;
      const nol = r.nol;
      ensureChart('chartIndexHasil', {
        type: 'doughnut',
        data: { labels:['Hemat (L/j < kalibrasi)','Boros (L/j > kalibrasi)','Tanpa catatan solar','Anomali','Tidak ada siram'],
          datasets:[{ data:[ r.hemat, r.boros, nol, r.anomaly, r.tanpaSiram ],
            backgroundColor:['#10b981','#ef4444','#cbd5e1','#8b5cf6','#e2e8f0'], borderWidth:0, hoverOffset:8 }] },
        options:{ responsive:true, maintainAspectRatio:false, cutout:'66%',
          plugins:{ legend:{display:false}, tooltip:{ backgroundColor:'#0f172a', cornerRadius:12 } } }
      });
      const legend = $('#indexHasilLegend');
      if (legend) {
        const items = [
          ['Hemat', r.hemat, '#10b981'], ['Boros', r.boros, '#ef4444'], ['Tanpa catatan solar', nol, '#cbd5e1'],
          ['Anomali', r.anomaly, '#8b5cf6'], ['Tidak ada siram', r.tanpaSiram, '#e2e8f0']
        ];
        const perJenis = Object.keys(r.perJenisRingkas || {}).map(k => {
          const j = r.perJenisRingkas[k];
          return `<div class="mt-2 border-t border-slate-100 pt-2">
            <div class="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Jenis ${esc(k)} • ${formatInt(j.n)} engine</div>
            <div class="mt-1 flex items-center justify-between text-[11px]"><span class="text-slate-600">Hemat / Boros</span><span class="font-mono text-slate-500">${formatInt(j.hemat)} / ${formatInt(j.boros)}</span></div>
            <div class="flex items-center justify-between text-[11px]"><span class="text-slate-600">L/jam tertimbang</span><span class="font-mono text-slate-500">${j.jam ? formatNumber(j.solar / j.jam, 2) : '-'}</span></div>
          </div>`;
        }).join('');
        legend.innerHTML = items.map(([l, v, c]) =>
          `<div class="flex items-center justify-between text-[11px]"><div class="flex items-center gap-2"><span class="h-2.5 w-2.5 rounded-full" style="background:${c}"></span><span class="font-medium text-slate-700">${esc(l)}</span></div><span class="font-mono text-slate-500">${formatInt(v)} engine</span></div>`
        ).join('') + perJenis;
      }
    }
    if (want('chartIndexWilayah')) {
      ensureChart('chartIndexWilayah', {
        type: 'bar',
        data: { labels: iv.perWilayah.map(w=>w.wilayah),
          datasets:[
            { label:'Hemat', data: iv.perWilayah.map(w=>w.hemat), backgroundColor:'rgba(16,185,129,0.85)', stack:'hasil', borderRadius:6 },
            { label:'Boros', data: iv.perWilayah.map(w=>w.boros), backgroundColor:'rgba(239,68,68,0.85)', stack:'hasil', borderRadius:6 }
          ] },
        options:{ responsive:true, maintainAspectRatio:false,
          plugins:{ legend:{ position:'bottom', labels:{ usePointStyle:true, font:{size:10} }}, tooltip:{ backgroundColor:'#0f172a', cornerRadius:12,
            callbacks:{ label: ctx=> `${ctx.dataset.label}: ${formatInt(ctx.raw)} engine` } } },
          scales:{ x:{ stacked:true, grid:{display:false}, ticks:{font:{size:10}} }, y:{ stacked:true, beginAtZero:true, grid:{color:'#f1f5f9'}, ticks:{font:{size:10}, precision:0}, title:{display:true,text:'Jumlah engine',font:{size:10}} } } }
      });
    }
    if (want('chartIndexScatter')) {
      // Anomali dikeluarkan dari scatter (nilainya 100x lipat dan membuat skala tidak terbaca);
      // anomali tetap tampil di kartu KPI, tabel, dan dapat disaring lewat "Hanya anomali".
      const grup = { Hemat:[], Boros:[], Nol:[] };
      let outlier = 0, tanpaKal = 0;
      iv.rows.forEach(r => {
        if (!r.aktif) return;
        if (r.anomali) { outlier++; return; }
        if (r.kalibrasi <= 0) { tanpaKal++; return; }
        const key = r.solar === 0 ? 'Nol' : r.justifikasi;
        (grup[key] || grup.Nol).push({ x: r.kalibrasi, y: r.lpjAktual, engine: r.engine });
      });
      const warna = { Hemat:'#10b981', Boros:'#ef4444', Nol:'#cbd5e1' };
      let maxV = 20;
      iv.rows.forEach(r => { if (r.aktif && !r.anomali) maxV = Math.max(maxV, r.kalibrasi, r.lpjAktual); });
      const catatan = $('#chartIndexScatterNote');
      if (catatan) {
        const pesan = [];
        if (outlier) pesan.push(`${outlier} engine anomali tidak ditampilkan (skala terlalu jauh) — lihat filter "Hanya anomali"`);
        if (tanpaKal) pesan.push(`${tanpaKal} engine tanpa angka kalibrasi di sheet`);
        catatan.textContent = pesan.length ? '• ' + pesan.join(' • ') : '';
      }
      ensureChart('chartIndexScatter', {
        type: 'scatter',
        data: { datasets: Object.keys(grup).filter(k=>grup[k].length).map(k => ({
            label: k, data: grup[k], backgroundColor: warna[k] + 'CC', pointRadius: 5, pointHoverRadius: 7, showLine:false
          })).concat([{ label:'Garis kalibrasi (ideal)', data:[{x:0,y:0},{x:Math.ceil(maxV),y:Math.ceil(maxV)}], type:'line', borderColor:'#94a3b8', borderDash:[5,5], borderWidth:1.5, pointRadius:0, fill:false }]) },
        options:{ responsive:true, maintainAspectRatio:false,
          plugins:{ legend:{ position:'bottom', labels:{ usePointStyle:true, font:{size:10} }},
            tooltip:{ backgroundColor:'#0f172a', cornerRadius:12, callbacks:{ label: ctx=> ctx.raw.engine ? `${ctx.raw.engine}: kalibrasi ${formatNumber(ctx.parsed.x,1)} L/j, aktual ${formatNumber(ctx.parsed.y,1)} L/j` : 'Garis kalibrasi' } } },
          scales:{ x:{ beginAtZero:true, title:{display:true,text:'Kalibrasi standar (L/jam)',font:{size:10}}, grid:{color:'#f1f5f9'}, ticks:{font:{size:10}} },
                   y:{ beginAtZero:true, suggestedMax: Math.ceil(maxV * 1.15), title:{display:true,text:'Aktual (L/jam)',font:{size:10}}, grid:{color:'#f1f5f9'}, ticks:{font:{size:10}} } } }
      });
    }
  }
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

// ===== TAB DETAIL: seluruh kolom sheet ZPAS637 (A..AI = 35 kolom) =====
// Urutan kolom mengikuti urutan sheet agar mudah dicocokkan saat verifikasi data.
const DETAIL_COLS = [
  { h:'Tanggal',            s:'date',          get:d=>d.date,                        fmt:'date',  align:'left',  sort:true },
  { h:'Bulan',              s:'bulanR',        get:d=>d.bulanR,                      fmt:'text',  align:'left',  sort:true },
  { h:'Wilayah',            s:'wilayah',       get:d=>d.wilayah,                     fmt:'text',  align:'left',  sort:true, badge:true },
  { h:'Lokasi',             s:'lokasi',        get:d=>d.lokasi,                      fmt:'mono',  align:'left',  sort:true },
  { h:'Engine',             s:'engine',        get:d=>d.engine,                      fmt:'monoB', align:'left',  sort:true },
  { h:'Irigator',           s:'irigator',      get:d=>d.irigator,                    fmt:'mono',  align:'left',  sort:true },
  { h:'Jenis Irigator',     s:'jenisIrigator', get:d=>d.jenisIrigator,               fmt:'text',  align:'left',  sort:true },
  { h:'Plan Time',          s:'planTime',      get:d=>d.planTime,                    fmt:'n1',    align:'right' },
  { h:'Luas Siram',         s:'luasSiram',     get:d=>d.luasSiram,                   fmt:'n2b',   align:'right', sort:true },
  { h:'Kecepatan',          s:'kecepatan',     get:d=>d.kecepatan,                   fmt:'n1',    align:'right' },
  { h:'Tebal Siram',        s:'tebalSiram',    get:d=>d.tebalSiram,                  fmt:'n1',    align:'right' },
  { h:'Prepare',            s:'prepareTime',   get:d=>d.prepareTime,                 fmt:'n1',    align:'right' },
  { h:'Operating',          s:'operatingTime', get:d=>d.operatingTime,               fmt:'n1',    align:'right', sort:true, cls:'text-blue-700' },
  { h:'Waiting',            s:'waitingTime',   get:d=>d.waitingTime,                 fmt:'n1',    align:'right' },
  { h:'Repair',             s:'repair',        get:d=>d.repair,                      fmt:'n2',    align:'right' },
  { h:'Down Time',          s:'downTime',      get:d=>d.downTime,                    fmt:'n2',    align:'right' },
  { h:'Standby',            s:'standby',       get:d=>d.standby,                     fmt:'n1',    align:'right' },
  { h:'Off Time',           s:'offTime',       get:d=>d.offTime,                     fmt:'n1',    align:'right' },
  { h:'Tot. Oper. Time',    s:'totOperTime',   get:d=>d.totOperTime,                 fmt:'n1',    align:'right' },
  { h:'Total Avail',        s:'totalAvail',    get:d=>d.totalAvail,                  fmt:'n1',    align:'right' },
  { h:'Total Time',         s:'totalTime',     get:d=>d.totalTime,                   fmt:'n1',    align:'right' },
  { h:'% Availability',     s:'availability',  get:d=>d.availability,                fmt:'pct',   align:'right' },
  { h:'% Utilization',      s:'utilization',   get:d=>d.utilization,                 fmt:'util',  align:'right', sort:true },
  { h:'Air',                s:'air',           get:d=>d.air,                         fmt:'i0',    align:'right', sort:true, cls:'text-sky-700' },
  { h:'Solar L',            s:'solarTerpakai', get:d=>d.solarTerpakai,               fmt:'i0',    align:'right', sort:true, cls:'text-amber-700' },
  { h:'Biaya Solar',        s:'biayaSolar',    get:d=>d.biayaSolar,                  fmt:'rp',    align:'right' },
  { h:'Biaya Upah',         s:'biayaUpah',     get:d=>d.biayaUpah,                   fmt:'rp',    align:'right' },
  { h:'Biaya Alat',         s:'biayaAlat',     get:d=>d.biayaAlat,                   fmt:'rp',    align:'right' },
  { h:'Biaya Total',        s:'biayaTotal',    get:d=>d.biayaTotal,                  fmt:'rp',    align:'right', sort:true },
  { h:'Rp/Ha',              s:'rpPerHa',       get:d=>d.rpPerHa,                     fmt:'i0',    align:'right' },
  { h:'Ha/Hari',            s:'haPerHari',     get:d=>d.haPerHari,                   fmt:'n2',    align:'right' },
  { h:'Ha/Jam',             s:'haPerJam',      get:d=>d.haPerJam,                    fmt:'n3',    align:'right', sort:true, cls:'text-emerald-700 font-medium' },
  { h:'Solar Ltr/jam',      s:'solarPerJam',   get:d=>d.solarPerJam,                 fmt:'n1',    align:'right' },
  { h:'Solar Ltr/Ha',       s:'solarPerHa',    get:d=>d.solarPerHa,                  fmt:'n1',    align:'right' },
  { h:'Jenis Engine',       s:'jenisEngine',   get:d=>d.jenisEngine,                 fmt:'text',  align:'left',  sort:true }
];
function detailCell(col, d) {
  const v = col.get(d);
  switch (col.fmt) {
    case 'date': return formatDate(v);
    case 'text': return v === '' || v === null || v === undefined ? '-' : esc(v);
    case 'mono': return esc(v || '-');
    case 'monoB': return esc(v || '-');
    case 'n1': return formatNumber(v, 1);
    case 'n2': return formatNumber(v, 2);
    case 'n3': return formatNumber(v, 3);
    case 'n2b': return formatNumber(v, 2);
    case 'i0': return formatInt(v);
    case 'pct': return formatNumber(v, 1) + '%';
    case 'rp': return formatRupiah(v);
    case 'util': {
      const w = v >= 70 ? 'bg-emerald-50 text-emerald-700 ring-emerald-200' : 'bg-amber-50 text-amber-700 ring-amber-200';
      return `<span class="inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium ${w}">${formatNumber(v, 1)}%</span>`;
    }
    default: return v === '' || v === null || v === undefined ? '-' : String(v);
  }
}
function renderTable() {
  const tbody = $('#dataTableBody');
  if (!tbody) return;
  let data = filteredData.slice();
  data.sort((a, b) => {
    let av = a[sortField], bv = b[sortField];
    if (sortField === 'date') { av = a.date; bv = b.date; }
    if (av == null) av = ''; if (bv == null) bv = '';
    if (typeof av === 'string') { av = av.toLowerCase(); bv = String(bv).toLowerCase(); }
    if (av < bv) return sortDir === 'asc' ? -1 : 1;
    if (av > bv) return sortDir === 'asc' ? 1 : -1;
    return 0;
  });
  const total = data.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (currentPage > totalPages) currentPage = totalPages;
  const start = (currentPage - 1) * pageSize;
  const pageData = data.slice(start, start + pageSize);
  const tc = $('#tableCount'); if (tc) tc.textContent = formatInt(pageData.length);
  const tt = $('#tableTotal'); if (tt) tt.textContent = formatInt(total);
  const pi = $('#pageInfo'); if (pi) pi.textContent = `Page ${currentPage} / ${totalPages}`;
  const bp = $('#btnPrevPage'); if (bp) bp.disabled = currentPage <= 1;
  const bn = $('#btnNextPage'); if (bn) bn.disabled = currentPage >= totalPages;
  if (!pageData.length) {
    tbody.innerHTML = `<tr><td colspan="${DETAIL_COLS.length}" class="px-4 py-10 text-center text-slate-400">Tidak ada data</td></tr>`;
    return;
  }
  const cellCls = (col) => `px-3 py-2.5 whitespace-nowrap ${col.align === 'right' ? 'text-right' : ''} ${col.cls || ''}`;
  tbody.innerHTML = pageData.map(d => {
    let html = '<tr class="hover:bg-slate-50/80 transition">';
    for (let i = 0; i < DETAIL_COLS.length; i++) {
      const col = DETAIL_COLS[i];
      const isSticky = i === 0;
      const val = detailCell(col, d);
      if (col.badge) html += `<td class="px-3 py-2.5 whitespace-nowrap"><span class="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium">${val}</span></td>`;
      else html += `<td class="${cellCls(col)}${isSticky ? ' font-medium text-slate-900' : ''}">${val}</td>`;
    }
    return html + '</tr>';
  }).join('');
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
    if ($('#indexSearch')) $('#indexSearch').value='';
    indexSearch=''; indexJust='all'; indexPage=1;
    if ($('#indexJustifikasi')) $('#indexJustifikasi').value='all';
    const dates = rawData.map(d=>d.date).sort((a,b)=>a-b);
    $('#filterStart').value = formatDateISO(dates[0]); $('#filterEnd').value = formatDateISO(dates[dates.length-1]);
    filters.start = dates[0]; filters.end = dates[dates.length-1];
    currentPage=1; updateAll(); renderMonthChips();
  });
  // --- kontrol tab Waktu & Utilisasi (mode rata-rata/total) ---
  bindWaktuModeButtons();
  // --- kontrol tab Analisa Biaya (mode total / rata-rata per aktivitas / per hari) ---
  bindBiayaModeButtons();

  // --- kontrol tab Index Solar ---
  const idxSearch = $('#indexSearch');
  if (idxSearch && !idxSearch.dataset.bound) {
    idxSearch.dataset.bound = '1';
    idxSearch.addEventListener('input', debounce(e => { indexSearch = e.target.value.trim(); indexPage = 1; renderIndexSolar(); }, 220));
  }
  const idxJust = $('#indexJustifikasi');
  if (idxJust && !idxJust.dataset.bound) {
    idxJust.dataset.bound = '1';
    idxJust.addEventListener('change', e => { indexJust = e.target.value; indexPage = 1; renderIndexSolar(); });
  }
  const idxSort = $('#indexSort');
  if (idxSort && !idxSort.dataset.bound) {
    idxSort.dataset.bound = '1';
    idxSort.addEventListener('change', e => { indexSort = e.target.value; indexPage = 1; renderIndexSolar(); });
  }
  const idxPrev = $('#indexPrevPage');
  if (idxPrev && !idxPrev.dataset.bound) {
    idxPrev.dataset.bound = '1';
    idxPrev.addEventListener('click', () => { if (indexPage > 1) { indexPage--; renderIndexTable(); } });
  }
  const idxNext = $('#indexNextPage');
  if (idxNext && !idxNext.dataset.bound) {
    idxNext.dataset.bound = '1';
    idxNext.addEventListener('click', () => { indexPage++; renderIndexTable(); });
  }

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
  ['R Bulan', d=>d.bulanR], ['Date', d=>formatDateISO(d.date)], ['Wilayah', d=>d.wilayah], ['Lokasi', d=>d.lokasi],
  ['Engine', d=>d.engine], ['Irigator', d=>d.irigator], ['Jenis Irigator', d=>d.jenisIrigator],
  ['Plan Time', d=>d.planTime], ['Luas Siram', d=>d.luasSiram], ['Kecepatan Rata-rata', d=>d.kecepatan],
  ['Tebal Siram', d=>d.tebalSiram], ['Prepare Time', d=>d.prepareTime], ['Operating Time', d=>d.operatingTime],
  ['Waiting Time', d=>d.waitingTime], ['Repair', d=>d.repair], ['Down Time', d=>d.downTime],
  ['Standby', d=>d.standby], ['Off Time', d=>d.offTime], ['Tot. Oper. Time', d=>d.totOperTime],
  ['Total Avail', d=>d.totalAvail], ['Total Time', d=>d.totalTime], ['% Availability', d=>d.availability],
  ['% Utilization', d=>d.utilization], ['Air', d=>d.air], ['Solar Terpakai (ltr)', d=>d.solarTerpakai],
  ['Biaya Solar (Std)', d=>d.biayaSolar], ['Biaya Upah', d=>d.biayaUpah], ['Biaya Alat', d=>d.biayaAlat],
  ['Biaya Total', d=>d.biayaTotal], ['Rp/Ha', d=>d.rpPerHa], ['Ha/Hari', d=>d.haPerHari],
  ['Ha/Jam', d=>d.haPerJam], ['Solar Ltr/jam', d=>d.solarPerJam], ['Solar Ltr/Ha', d=>d.solarPerHa],
  ['Jenis Engine', d=>d.jenisEngine]
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
  if (!rows.length) throw new Error('Tidak ada baris data yang bisa dibaca (periksa kolom Date/Wilayah pada sheet)');
  rawData = rows;
  // sheet Index Solar (opsional: kalau gagal, dashboard utama tetap jalan)
  if (payload.index) {
    try { indexData = parseIndexSolar(payload.index); indexVersion++; }
    catch (e) { console.warn('[index solar] gagal parse', e); }
  }
  payload.index = null;
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

// Kalau kolom "Date" di sheet tidak lagi di kolom B, ambil ulang overlay tanggal memakai huruf
// kolom yang benar (dibaca dari header CSV) supaya dashboard tidak jatuh ke data contoh.
async function fixDatesColumn(payload) {
  if (!payload || !payload.csv) return;
  const letter = csvDateLetter(payload.csv);
  if (!letter || letter === DATE_COL) return;
  const t = await fetchText(datesUrlFor(letter)).catch(() => null);
  if (t) { payload.dates = t; console.warn('[data] kolom Date ada di kolom ' + letter + ' (bukan ' + DATE_COL + ') — overlay tanggal disesuaikan'); }
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
      if (payload.index) cachePut(INDEX_URL, payload.index);
      await fixDatesColumn(payload);          // jaga-jaga bila kolom Date di sheet berpindah
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
