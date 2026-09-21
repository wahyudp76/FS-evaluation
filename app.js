// PG2 Irrigation Evaluation Dashboard - ZPAS637
// Auto-sync to Google Sheets ID: 1mhXxr7cfdnS-A_gJ6E4aixGRSzINdGP94orr-2lL45o
const SPREADSHEET_ID = '1mhXxr7cfdnS-A_gJ6E4aixGRSzINdGP94orr-2lL45o';
const SHEET_NAME = 'ZPAS637';
const GVIZ_URL = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:json&sheet=${SHEET_NAME}`;
const CSV_URL = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:csv&sheet=${SHEET_NAME}`;
const CSV_EXPORT_URL = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/export?format=csv&sheet=${SHEET_NAME}`;

// State
let rawData = [];
let filteredData = [];
let charts = {};
let granularity = 'daily';
let sortField = 'date';
let sortDir = 'desc';
let currentPage = 1;
let pageSize = 15;
let filters = {
  start: null,
  end: null,
  wilayah: new Set(),
  months: new Set(), // 0-11
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
  // v like "Date(2026,4,29)" or "Date(2026,4,29,10,30,0)"
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
    // fallback f format like "29-Mei"
    return new Date(v);
  }
  return null;
}

function formatNumber(n, decimals = 2) {
  if (n == null || isNaN(n)) return '-';
  return new Intl.NumberFormat('id-ID', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(n);
}
function formatInt(n) {
  if (n == null || isNaN(n)) return '-';
  return new Intl.NumberFormat('id-ID').format(Math.round(n));
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

// Fetch & Parse
async function fetchSheetData() {
  try {
    // Try GVIZ JSON first
    const res = await fetch(GVIZ_URL, { cache: 'no-store' });
    if (!res.ok) throw new Error('GVIZ fetch failed');
    const text = await res.text();
    // Extract JSON
    const jsonStr = text.substring(text.indexOf('{'), text.lastIndexOf('}')+1);
    // The text is wrapped in google.visualization.Query.setResponse(...)
    // So we need to extract between first { and last }
    // But there is outer wrapper, we already did substring, but need to handle prefix
    // Better regex
    const match = text.match(/google\.visualization\.Query\.setResponse\(([\s\S]+)\)/);
    if (!match) throw new Error('Invalid GVIZ response');
    const data = JSON.parse(match[1]);
    const cols = data.table.cols.map(c => c.label);
    const rows = data.table.rows;
    const parsed = rows.map(r => {
      const c = r.c;
      // helper to get v
      const getV = (i) => c[i] ? c[i].v : null;
      const getF = (i) => c[i] ? c[i].f : null;
      // Date is col 0
      const dateRaw = getV(0);
      const date = parseGvizDate(dateRaw) || parseGvizDate(getF(0));
      return {
        date,
        dateLabel: getF(0) || formatDate(date),
        wilayah: getV(1) || '',
        lokasi: getV(2) || '',
        engine: getV(3) || '',
        irigator: getV(4) || '',
        jenisIrigator: getV(5) || '',
        planTime: Number(getV(6)) || 0,
        luasSiram: Number(getV(7)) || 0,
        luasCek: Number(getV(8)) || 0,
        kecepatan: Number(getV(9)) || 0,
        tebalSiram: Number(getV(10)) || 0,
        prepareTime: Number(getV(11)) || 0,
        operatingTime: Number(getV(12)) || 0,
        waitingTime: Number(getV(13)) || 0,
        repair: Number(getV(14)) || 0,
        downTime: Number(getV(15)) || 0,
        standby: Number(getV(16)) || 0,
        offTime: Number(getV(17)) || 0,
        totOperTime: Number(getV(18)) || 0,
        totalAvail: Number(getV(19)) || 0,
        totalTime: Number(getV(20)) || 0,
        availability: Number(getV(21)) || 0,
        utilization: Number(getV(22)) || 0,
        air: Number(getV(23)) || 0,
        solarTerpakai: Number(getV(24)) || 0,
        biayaSolar: Number(getV(25)) || 0,
        biayaUpah: Number(getV(26)) || 0,
        biayaAlat: Number(getV(27)) || 0,
        biayaTotal: Number(getV(28)) || 0,
        rpPerHa: Number(getV(29)) || 0,
        haPerHari: Number(getV(30)) || 0,
        haPerJam: Number(getV(31)) || 0,
        solarPerJam: Number(getV(32)) || 0,
        solarPerHa: Number(getV(33)) || 0,
        jenisEngine: getV(34) || '',
      };
    }).filter(r => r.date && !isNaN(r.date));
    return parsed;
  } catch (e) {
    console.warn('GVIZ JSON failed, trying CSV', e);
    // fallback CSV
    try {
      const res = await fetch(CSV_URL, { cache: 'no-store' });
      if (!res.ok) throw new Error('CSV fetch failed');
      const csvText = await res.text();
      return parseCSVText(csvText);
    } catch (e2) {
      console.error('CSV fallback failed', e2);
      // try sample local
      try {
        const res = await fetch('./assets/sample-data.csv');
        if (res.ok) {
          const txt = await res.text();
          return parseCSVText(txt);
        }
      } catch {}
      throw e2;
    }
  }
}

function parseCSVText(csvText) {
  const result = Papa.parse(csvText, { header: true, skipEmptyLines: true });
  const data = result.data.map(row => {
    // Date parsing: row.Date like "29-Mei" - we need year? Assume 2026 from context, but we have sample with month name Indonesian
    // We'll try to parse Date with year 2026 if not present
    let date = null;
    const dateStr = row['Date'] || row['date'];
    if (dateStr) {
      // Try Indonesian month mapping
      const months = { 'Jan':0,'Feb':1,'Mar':2,'Apr':3,'Mei':4,'Jun':5,'Jul':6,'Ags':7,'Agu':7,'Sep':8,'Okt':9,'Nov':10,'Des':11,
                       'Januari':0,'Februari':1,'Maret':2,'April':3,'Mei':4,'Juni':5,'Juli':6,'Agustus':7,'September':8,'Oktober':9,'November':10,'Desember':11 };
      // Format "29-Mei" or "29-Mei-2026" etc
      const parts = dateStr.split('-');
      if (parts.length >=2) {
        const day = parseInt(parts[0]);
        const monStr = parts[1];
        const mon = months[monStr] ?? months[monStr.substring(0,3)] ?? 4;
        const year = parts[2] ? parseInt(parts[2]) : 2026;
        if (!isNaN(day)) date = new Date(year, mon, day);
      } else {
        date = new Date(dateStr);
      }
    }
    const num = (k) => {
      let v = row[k];
      if (v == null) return 0;
      // remove Rp, dots, replace comma with dot
      if (typeof v === 'string') {
        v = v.replace(/Rp|\./g,'').replace(',','.').trim();
        // But for thousand separator with dot, above removes dot, but need handle: Indonesian 1.234,56 -> 1234.56
        // Our replace removes dots then comma->dot is okay
        // However if it's like "2,05" -> "2.05"
        // If it's "2.332.240" -> after replace Rp and . -> "2332240"
      }
      const n = parseFloat(v);
      return isNaN(n) ? 0 : n;
    };
    const str = (k) => row[k] ? String(row[k]).trim() : '';
    return {
      date,
      dateLabel: dateStr,
      wilayah: str('Wilayah'),
      lokasi: str('Lokasi'),
      engine: str('Engine'),
      irigator: str('Irigator'),
      jenisIrigator: str('Jenis Irigator'),
      planTime: num('Plan Time'),
      luasSiram: num('Luas Siram'),
      luasCek: num('Luas Cek'),
      kecepatan: num('Kecepatan Rata-rata'),
      tebalSiram: num('Tebal Siram'),
      prepareTime: num('Prepare Time'),
      operatingTime: num('Operating Time'),
      waitingTime: num('Waiting Time'),
      repair: num('Repair'),
      downTime: num('Down Time'),
      standby: num('Standby'),
      offTime: num('Off Time'),
      totOperTime: num('Tot. Oper. Time'),
      totalAvail: num('Total Avail'),
      totalTime: num('Total Time'),
      availability: num('% Availability'),
      utilization: num('% Utilization'),
      air: num('Air'),
      solarTerpakai: num('Solar Terpakai (ltr)'),
      biayaSolar: num('Biaya Solar (Std)'),
      biayaUpah: num('Biaya Upah'),
      biayaAlat: num('Biaya Alat'),
      biayaTotal: num('Biaya Total'),
      rpPerHa: num('Rp/Ha'),
      haPerHari: num('Ha/Hari'),
      haPerJam: num('Ha/Jam'),
      solarPerJam: num('Solar Ltr/jam'),
      solarPerHa: num('Solar Ltr/Ha'),
      jenisEngine: str('Jenis Engine'),
    };
  }).filter(r => r.date && !isNaN(r.date));
  return data;
}

// Filtering
function applyFilters() {
  let data = [...rawData];
  // date range
  if (filters.start) {
    data = data.filter(d => d.date >= filters.start);
  }
  if (filters.end) {
    const end = new Date(filters.end);
    end.setHours(23,59,59,999);
    data = data.filter(d => d.date <= end);
  }
  // months filter (0-11)
  if (filters.months.size > 0) {
    data = data.filter(d => filters.months.has(d.date.getMonth()));
  }
  // year filter
  if (filters.year !== 'all') {
    const y = parseInt(filters.year);
    if (!isNaN(y)) data = data.filter(d => d.date.getFullYear() === y);
  }
  // wilayah
  if (filters.wilayah.size > 0) {
    data = data.filter(d => filters.wilayah.has(d.wilayah));
  }
  // jenisEngine
  if (filters.jenisEngine !== 'all') {
    data = data.filter(d => d.jenisEngine === filters.jenisEngine);
  }
  // search
  if (filters.search) {
    const q = filters.search.toLowerCase();
    data = data.filter(d => 
      d.engine.toLowerCase().includes(q) ||
      d.irigator.toLowerCase().includes(q) ||
      d.lokasi.toLowerCase().includes(q) ||
      d.wilayah.toLowerCase().includes(q)
    );
  }
  // table search
  if (filters.tableSearch) {
    const q = filters.tableSearch.toLowerCase();
    data = data.filter(d =>
      Object.values(d).some(v => String(v).toLowerCase().includes(q))
    );
  }
  // sort for table? Keep separate
  filteredData = data;
  // sort for aggregation? Keep chronological for charts
  filteredData.sort((a,b) => a.date - b.date);
}

function getAggregated(gran) {
  const groups = {};
  filteredData.forEach(d => {
    let key;
    if (gran === 'daily') key = formatDateISO(d.date);
    else if (gran === 'weekly') key = getWeekLabel(d.date);
    else if (gran === 'monthly') key = getMonthLabel(d.date);
    if (!groups[key]) groups[key] = [];
    groups[key].push(d);
  });
  const sortedKeys = Object.keys(groups).sort();
  const result = sortedKeys.map(k => {
    const arr = groups[k];
    const sum = (field) => arr.reduce((s,x)=>s+(x[field]||0),0);
    const avg = (field) => arr.length ? sum(field)/arr.length : 0;
    // date for label
    let labelDate = arr[0].date;
    return {
      key: k,
      label: k,
      date: labelDate,
      count: arr.length,
      totalLuasSiram: sum('luasSiram'),
      totalLuasCek: sum('luasCek'),
      totalSolar: sum('solarTerpakai'),
      avgSolarPerJam: avg('solarPerJam'),
      avgSolarPerHa: avg('solarPerHa'),
      avgOperating: avg('operatingTime'),
      avgPrepare: avg('prepareTime'),
      avgWaiting: avg('waitingTime'),
      totalOperating: sum('operatingTime'),
      avgKecepatan: avg('kecepatan'),
      avgTebal: avg('tebalSiram'),
      avgAvailability: avg('availability'),
      avgUtilization: avg('utilization'),
      avgHaPerJam: avg('haPerJam'),
      avgHaPerHari: avg('haPerHari'),
      totalBiaya: sum('biayaTotal'),
      avgRpPerHa: avg('rpPerHa'),
      avgPlan: avg('planTime'),
    };
  });
  return result;
}

// KPI Calculation
function calculateKPIs() {
  const data = filteredData;
  if (data.length === 0) return null;
  const sum = (f) => data.reduce((s,x)=>s+(x[f]||0),0);
  const avg = (f) => data.length ? sum(f)/data.length : 0;
  return {
    totalLuasSiram: sum('luasSiram'),
    totalLuasCek: sum('luasCek'),
    totalSolar: sum('solarTerpakai'),
    avgOperating: avg('operatingTime'),
    avgSolarPerJam: avg('solarPerJam'),
    avgSolarPerHa: avg('solarPerHa'),
    avgKecepatan: avg('kecepatan'),
    avgTebal: avg('tebalSiram'),
    avgAvailability: avg('availability'),
    avgUtilization: avg('utilization'),
    totalBiaya: sum('biayaTotal'),
    avgRpPerHa: avg('rpPerHa'),
    avgHaPerHari: avg('haPerHari'),
    avgHaPerJam: avg('haPerJam'),
    avgPlan: avg('planTime'),
    avgPrepare: avg('prepareTime'),
    avgWaiting: avg('waitingTime'),
    totalRecords: data.length,
    totalAir: sum('air'),
  };
}

// Rendering
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
    { label: 'Total Luas Siram', value: `${formatNumber(kpi.totalLuasSiram,2)} Ha`, sub: `Cek: ${formatNumber(kpi.totalLuasCek,2)} Ha • ${kpi.totalRecords} records`, icon: 'map', color: 'emerald', trend: '+'+formatNumber(kpi.avgHaPerHari,2)+' Ha/hari avg' },
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
    { label: 'Total Biaya', value: `Rp ${formatInt(kpi.totalBiaya/1000000)}`, unit: 'Jt', icon: 'wallet' },
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
  // refresh icons
  if (window.lucide) lucide.createIcons();

  // Update small stats
  $('#solarTotal').textContent = formatInt(kpi.totalSolar);
  $('#solarAvg').textContent = formatNumber(kpi.avgSolarPerJam,2);
  $('#avgPrepare').textContent = formatNumber(kpi.avgPrepare,2)+'h';
  $('#avgOperating').textContent = formatNumber(kpi.avgOperating,2)+'h';
  $('#avgWaiting').textContent = formatNumber(kpi.avgWaiting,2)+'h';
  $('#avgKec').textContent = formatNumber(kpi.avgKecepatan,1);
  $('#avgTebal').textContent = formatNumber(kpi.avgTebal,1);
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

function renderCharts() {
  const agg = getAggregated(granularity);
  const labels = agg.map(a=>a.label);
  // Solar chart
  ensureChart('chartSolar', {
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

  // Luas chart
  ensureChart('chartLuas', {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'Luas Siram', data: agg.map(a=>a.totalLuasSiram), backgroundColor: 'rgba(16,185,129,0.85)', borderRadius: 8 },
        { label: 'Luas Cek', data: agg.map(a=>a.totalLuasCek), backgroundColor: 'rgba(16,185,129,0.25)', borderRadius: 8 }
      ]
    },
    options: {
      responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{position:'bottom', labels:{usePointStyle:true,font:{size:11}}}, tooltip:{backgroundColor:'#0f172a',cornerRadius:12} },
      scales:{ x:{grid:{display:false}, ticks:{font:{size:10}, maxTicksLimit:10}}, y:{beginAtZero:true, grid:{color:'#f1f5f9'}, ticks:{font:{size:10}}} }
    }
  });

  // Jam chart - stacked time components average
  // For simplicity, show operating vs plan
  ensureChart('chartJam', {
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

  // Kecepatan & Tebal
  ensureChart('chartKecepatan', {
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

  // Efisiensi
  ensureChart('chartEfisiensi', {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label:'Ha/Jam', data: agg.map(a=>a.avgHaPerJam), borderColor:'#10b981', backgroundColor:'#10b981', tension:0.4, pointRadius:0, borderWidth:2 },
        { label:'Solar Ltr/Ha', data: agg.map(a=>a.avgSolarPerHa), borderColor:'#f59e0b', backgroundColor:'#f59e0b', tension:0.4, pointRadius:0, borderWidth:2, yAxisID:'y1' }
      ]
    },
    options:{
      responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{position:'bottom', labels:{usePointStyle:true,font:{size:10}}}, tooltip:{backgroundColor:'#0f172a',cornerRadius:12} },
      scales:{ x:{grid:{display:false}, ticks:{font:{size:9}, maxTicksLimit:8}}, y:{grid:{color:'#f1f5f9'}, ticks:{font:{size:10}}}, y1:{position:'right', grid:{display:false}, ticks:{font:{size:10}}} }
    }
  });

  // Wilayah breakdown
  const wilayahGroups = {};
  filteredData.forEach(d=>{
    if (!wilayahGroups[d.wilayah]) wilayahGroups[d.wilayah]=[];
    wilayahGroups[d.wilayah].push(d);
  });
  const wilayahLabels = Object.keys(wilayahGroups).sort();
  const wilayahLuas = wilayahLabels.map(w=>wilayahGroups[w].reduce((s,x)=>s+x.luasSiram,0));
  const wilayahSolar = wilayahLabels.map(w=>wilayahGroups[w].reduce((s,x)=>s+x.solarTerpakai,0));
  ensureChart('chartWilayah', {
    type: 'bar',
    data: {
      labels: wilayahLabels,
      datasets: [
        { label:'Luas Siram Ha', data:wilayahLuas, backgroundColor:'rgba(16,185,129,0.85)', borderRadius:8 },
        { label:'Solar L', data:wilayahSolar, backgroundColor:'rgba(245,158,11,0.35)', borderRadius:8, yAxisID:'y1' }
      ]
    },
    options:{
      responsive:true, maintainAspectRatio:false, indexAxis:'y',
      plugins:{ legend:{position:'bottom', labels:{usePointStyle:true,font:{size:10}}}, tooltip:{backgroundColor:'#0f172a',cornerRadius:12} },
      scales:{ x:{grid:{color:'#f1f5f9'}, ticks:{font:{size:10}}}, y:{grid:{display:false}, ticks:{font:{size:11}}}, y1:{position:'right', display:false} }
    }
  });

  // Jenis Engine doughnut
  const jenisGroups = {};
  filteredData.forEach(d=>{
    const k = d.jenisEngine || 'Unknown';
    if (!jenisGroups[k]) jenisGroups[k]=0;
    jenisGroups[k]+=d.luasSiram;
  });
  const jenisLabels = Object.keys(jenisGroups);
  const jenisValues = jenisLabels.map(k=>jenisGroups[k]);
  const colors = ['#10b981','#3b82f6','#f59e0b','#8b5cf6','#06b6d4','#ef4444','#64748b'];
  ensureChart('chartJenisEngine', {
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
  // legend custom
  $('#jenisEngineLegend').innerHTML = jenisLabels.map((l,i)=>{
    const pct = jenisValues[i]/ (jenisValues.reduce((a,b)=>a+b,0) ||1) *100;
    return `<div class="flex items-center justify-between text-[11px]"><div class="flex items-center gap-2"><span class="h-2.5 w-2.5 rounded-full" style="background:${colors[i%colors.length]}"></span><span class="font-medium text-slate-700">${l}</span></div><span class="font-mono text-slate-500">${formatNumber(pct,1)}%</span></div>`;
  }).join('');

  // Top Engine & Irigator
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
      <div class="flex items-center gap-2.5"><span class="flex h-6 w-6 items-center justify-center rounded-full bg-slate-100 text-[10px] font-bold text-slate-600">${i+1}</span><span class="text-[12px] font-medium text-slate-800 font-mono">${k}</span></div>
      <span class="text-[12px] font-semibold text-slate-900">${formatNumber(v,2)} Ha</span>
    </div>
  `).join('') || '<div class="text-[11px] text-slate-400">No data</div>';
  $('#topIrigator').innerHTML = topIrigator.map(([k,v],i)=>`
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-2.5"><span class="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-50 text-[10px] font-bold text-emerald-700">${i+1}</span><span class="text-[12px] font-medium text-slate-800 font-mono">${k}</span></div>
      <span class="text-[12px] font-semibold text-slate-900">${formatNumber(v,2)} Ha</span>
    </div>
  `).join('') || '<div class="text-[11px] text-slate-400">No data</div>';

  // Availability vs Utilization
  ensureChart('chartAvail', {
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

  // Scatter
  const scatterData = filteredData.slice(0,800).map(d=>({ x:d.haPerJam, y:d.solarPerHa, wilayah:d.wilayah }));
  const wilayahColorMap = {};
  wilayahLabels.forEach((w,i)=>wilayahColorMap[w]=colors[i%colors.length]);
  ensureChart('chartScatter', {
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
  const worstSolar = [...filteredData].sort((a,b)=>b.solarPerHa - a.solarPerHa).slice(0,1)[0];
  const bestEff = [...filteredData].sort((a,b)=>b.haPerJam - a.haPerJam).slice(0,1)[0];
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
  // sort
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

function updateAll() {
  applyFilters();
  renderKPIs();
  renderCharts();
  renderInsights();
  renderTable();
  $('#rowCount').textContent = `${formatInt(filteredData.length)} / ${formatInt(rawData.length)} records`;
}

// Init filters UI from data
function initFiltersUI() {
  if (rawData.length===0) return;
  const dates = rawData.map(d=>d.date).sort((a,b)=>a-b);
  const minDate = dates[0], maxDate = dates[dates.length-1];
  $('#filterStart').value = formatDateISO(minDate);
  $('#filterEnd').value = formatDateISO(maxDate);
  filters.start = minDate;
  filters.end = maxDate;

  // wilayah checkboxes
  const wilayahSet = [...new Set(rawData.map(d=>d.wilayah))].sort();
  const wilayahContainer = $('#wilayahCheckboxes');
  wilayahContainer.innerHTML = wilayahSet.map(w=>`
    <label class="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-white cursor-pointer transition">
      <input type="checkbox" value="${w}" class="wilayah-cb h-3.5 w-3.5 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500">
      <span class="text-[12px] font-medium text-slate-700">${w}</span>
      <span class="ml-auto text-[10px] font-mono text-slate-400">${rawData.filter(d=>d.wilayah===w).length}</span>
    </label>
  `).join('');
  wilayahContainer.querySelectorAll('.wilayah-cb').forEach(cb=>{
    cb.addEventListener('change', (e)=>{
      if (e.target.checked) filters.wilayah.add(e.target.value);
      else filters.wilayah.delete(e.target.value);
      currentPage=1;
      updateAll();
    });
  });

  // jenisEngine select
  const jenisSet = [...new Set(rawData.map(d=>d.jenisEngine).filter(Boolean))].sort();
  const sel = $('#filterJenisEngine');
  sel.innerHTML = '<option value="all">Semua Jenis</option>' + jenisSet.map(j=>`<option value="${j}">${j}</option>`).join('');

  // year filter populate
  const yearsSet = [...new Set(rawData.map(d=>d.date.getFullYear()))].sort();
  const yearSel = $('#filterYear');
  if (yearSel) {
    yearSel.innerHTML = '<option value="all">Semua Tahun</option>' + yearsSet.map(y=>`<option value="${y}">${y}</option>`).join('');
  }

  // helper to render active month chips
  const monthNames = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
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
        // update UI buttons
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
    if (rmYear) {
      rmYear.addEventListener('click', ()=>{
        filters.year='all';
        if ($('#filterYear')) $('#filterYear').value='all';
        currentPage=1; updateAll(); renderMonthChips();
      });
    }
  }

  // month buttons toggle
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

  // month dropdown (single select, adds to set)
  const monthDropdown = $('#filterMonthDropdown');
  if (monthDropdown) {
    monthDropdown.addEventListener('change', (e)=>{
      const v = e.target.value;
      if (v==='all') {
        // clear months if user selects all via dropdown? Keep existing? We'll clear
        filters.months.clear();
        $$('.month-btn').forEach(b=>{
          b.classList.remove('bg-emerald-600','text-white','border-emerald-600','ring-2','ring-emerald-100');
          b.classList.add('bg-white','text-slate-600','border-slate-200');
        });
      } else {
        const m = parseInt(v);
        filters.months.add(m);
        // highlight button
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

  // year dropdown
  if (yearSel) {
    yearSel.addEventListener('change', (e)=>{
      filters.year = e.target.value;
      currentPage=1; updateAll(); renderMonthChips();
    });
  }

  // clear month filter
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

  renderMonthChips();

  // bind events
  $('#filterStart').addEventListener('change', e=>{
    filters.start = e.target.value ? new Date(e.target.value) : null;
    currentPage=1; updateAll();
  });
  $('#filterEnd').addEventListener('change', e=>{
    filters.end = e.target.value ? new Date(e.target.value) : null;
    currentPage=1; updateAll();
  });
  $$('.range-btn').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      $$('.range-btn').forEach(b=>{ b.className='range-btn flex-1 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-medium text-slate-600 hover:bg-slate-50'; });
      btn.className='range-btn flex-1 rounded-full bg-slate-900 px-3 py-1.5 text-[11px] font-medium text-white';
      const range = btn.dataset.range;
      const max = new Date(Math.max(...rawData.map(d=>d.date)));
      let start = new Date(max);
      if (range==='7') start.setDate(max.getDate()-7);
      else if (range==='30') start.setDate(max.getDate()-30);
      else if (range==='90') start.setDate(max.getDate()-90);
      else { start = new Date(Math.min(...rawData.map(d=>d.date))); }
      $('#filterStart').value = formatDateISO(start);
      $('#filterEnd').value = formatDateISO(max);
      filters.start = start; filters.end = max;
      currentPage=1; updateAll();
    });
  });
  $$('.gran-btn').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      $$('.gran-btn').forEach(b=>{ b.className='gran-btn rounded-lg px-2 py-2 text-[12px] font-medium text-slate-500 hover:text-slate-700'; });
      btn.className='gran-btn rounded-lg bg-white px-2 py-2 text-[12px] font-semibold shadow-sm text-slate-900';
      granularity = btn.dataset.gran;
      $('#solarGranLabel').textContent = granularity==='daily'?'harian':granularity==='weekly'?'mingguan':'bulanan';
      updateAll();
    });
  });
  $('#filterSearch').addEventListener('input', e=>{
    filters.search = e.target.value;
    currentPage=1; updateAll();
  });
  $('#filterJenisEngine').addEventListener('change', e=>{
    filters.jenisEngine = e.target.value;
    currentPage=1; updateAll();
  });
  $('#tableSearch').addEventListener('input', e=>{
    filters.tableSearch = e.target.value;
    currentPage=1; renderTable();
  });
  $('#btnClearFilters').addEventListener('click', ()=>{
    filters.wilayah.clear();
    filters.months.clear();
    filters.year='all';
    filters.jenisEngine='all';
    filters.search='';
    filters.tableSearch='';
    $$('.wilayah-cb').forEach(cb=>cb.checked=false);
    $$('.month-btn').forEach(b=>{
      b.classList.remove('bg-emerald-600','text-white','border-emerald-600','ring-2','ring-emerald-100');
      b.classList.add('bg-white','text-slate-600','border-slate-200');
    });
    $('#filterJenisEngine').value='all';
    if ($('#filterYear')) $('#filterYear').value='all';
    if ($('#filterMonthDropdown')) $('#filterMonthDropdown').value='all';
    $('#filterSearch').value='';
    $('#tableSearch').value='';
    const dates = rawData.map(d=>d.date).sort((a,b)=>a-b);
    $('#filterStart').value = formatDateISO(dates[0]);
    $('#filterEnd').value = formatDateISO(dates[dates.length-1]);
    filters.start = dates[0]; filters.end = dates[dates.length-1];
    currentPage=1; updateAll(); renderMonthChips();
  });
  $('#btnPrevPage').addEventListener('click', ()=>{ if (currentPage>1){ currentPage--; renderTable(); } });
  $('#btnNextPage').addEventListener('click', ()=>{ currentPage++; renderTable(); });
  // page size selector - 15 default, options 15,30,50,100
  const psSelect = $('#pageSizeSelect');
  if (psSelect) {
    psSelect.addEventListener('change', (e)=>{
      const newSize = parseInt(e.target.value);
      if (!isNaN(newSize) && newSize>0) {
        pageSize = newSize;
        currentPage = 1; // reset to first page when size changes
        renderTable();
        const info = $('#pageSizeInfo');
        if (info) info.textContent = `• ${pageSize} per halaman`;
      }
    });
  }
  // sort headers
  $$('th[data-sort]').forEach(th=>{
    th.addEventListener('click', ()=>{
      const field = th.dataset.sort;
      if (sortField===field) sortDir = sortDir==='asc'?'desc':'asc';
      else { sortField=field; sortDir='asc'; }
      renderTable();
    });
  });
  $('#btnExport').addEventListener('click', ()=>{
    const csv = Papa.unparse(filteredData.map(d=>({
      Date: formatDateISO(d.date),
      Wilayah: d.wilayah,
      Lokasi: d.lokasi,
      Engine: d.engine,
      Irigator: d.irigator,
      'Jenis Engine': d.jenisEngine,
      'Luas Siram': d.luasSiram,
      'Operating Time': d.operatingTime,
      'Solar L': d.solarTerpakai,
      'Ltr/Jam': d.solarPerJam,
      'Ha/Jam': d.haPerJam,
      'Kecepatan': d.kecepatan,
      'Tebal Siram': d.tebalSiram,
      'Availability': d.availability,
      'Utilization': d.utilization
    })));
    const blob = new Blob([csv], {type:'text/csv'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href=url; a.download=`PG2-ZPAS637-${formatDateISO(new Date())}.csv`; a.click();
    URL.revokeObjectURL(url);
  });
  $('#btnSync').addEventListener('click', async ()=>{
    $('#btnSync').innerHTML = '<i data-lucide="loader-2" class="h-4 w-4 animate-spin"></i> Syncing';
    lucide.createIcons();
    await loadData(true);
    $('#btnSync').innerHTML = '<i data-lucide="refresh-cw" class="h-4 w-4"></i> Sync';
    lucide.createIcons();
  });
  $('#btnFilters').addEventListener('click', ()=>{
    const panel = $('#filterPanel');
    panel.classList.toggle('hidden');
    panel.classList.toggle('fixed');
    panel.classList.toggle('inset-0');
    panel.classList.toggle('z-30');
    panel.classList.toggle('bg-white');
    panel.classList.toggle('p-6');
    panel.classList.toggle('overflow-y-auto');
  });
}

async function loadData(isManual=false) {
  try {
    if (!isManual) $('#loadingOverlay').style.display='flex';
    const data = await fetchSheetData();
    rawData = data;
    if (!isManual) {
      initFiltersUI();
    }
    applyFilters();
    renderKPIs();
    renderCharts();
    renderInsights();
    renderTable();
    $('#lastSync').textContent = `Sync ${new Date().toLocaleTimeString('id-ID')} • ${formatInt(rawData.length)} records`;
    $('#rowCount').textContent = `${formatInt(filteredData.length)} / ${formatInt(rawData.length)} records`;
    $('#loadingOverlay').style.display='none';
  } catch (e) {
    console.error(e);
    $('#loadingOverlay').innerHTML = `<div class="text-center p-6"><div class="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-red-50 text-red-600"><i data-lucide="alert-triangle" class="h-6 w-6"></i></div><div class="mt-4 text-[13px] font-medium text-slate-900">Gagal memuat data</div><div class="mt-1 text-[11px] text-slate-500 max-w-[320px]">${e.message}</div><button onclick="location.reload()" class="mt-4 rounded-full bg-slate-900 px-4 py-2 text-[12px] font-medium text-white">Reload</button></div>`;
    lucide.createIcons();
  }
}

// Init
document.addEventListener('DOMContentLoaded', ()=>{
  loadData(false);
  // auto-sync every 5 minutes
  setInterval(()=>loadData(true), 5*60*1000);
});
