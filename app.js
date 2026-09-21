// PG2 Irrigation Evaluation Dashboard - ZPAS637
// Auto-sync to Google Sheets ID: 1mhXxr7cfdnS-A_gJ6E4aixGRSzINdGP94orr-2lL45o
// Updated: Luas Cek column removed (now 34 cols), dynamic label-based parsing
const SPREADSHEET_ID = '1mhXxr7cfdnS-A_gJ6E4aixGRSzINdGP94orr-2lL45o';
const SHEET_NAME = 'ZPAS637';
const GVIZ_URL = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:json&sheet=${SHEET_NAME}`;
const CSV_URL = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:csv&sheet=${SHEET_NAME}`;

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

// Fetch & Parse - dynamic label based (resilient to column removal like Luas Cek)
async function fetchSheetData() {
  try {
    const res = await fetch(GVIZ_URL, { cache: 'no-store' });
    if (!res.ok) throw new Error('GVIZ fetch failed');
    const text = await res.text();
    const match = text.match(/google\.visualization\.Query\.setResponse\(([\s\S]+)\)/);
    if (!match) throw new Error('Invalid GVIZ response');
    const data = JSON.parse(match[1]);
    const cols = data.table.cols.map(c => c.label);
    const colIndex = {};
    cols.forEach((label, idx) => { colIndex[label] = idx; });
    // Helper to get value by label
    const getByLabel = (c, label) => {
      const idx = colIndex[label];
      if (idx === undefined || !c[idx]) return null;
      return c[idx].v;
    };
    const getFByLabel = (c, label) => {
      const idx = colIndex[label];
      if (idx === undefined || !c[idx]) return null;
      return c[idx].f;
    };

    const rows = data.table.rows;
    const parsed = rows.map(r => {
      const c = r.c;
      const dateRaw = getByLabel(c, 'Date');
      const dateF = getFByLabel(c, 'Date');
      const date = parseGvizDate(dateRaw) || parseGvizDate(dateF);
      // Dynamic getters
      const getNum = (label) => {
        const v = getByLabel(c, label);
        const n = Number(v);
        return isNaN(n) ? 0 : n;
      };
      const getStr = (label) => {
        const v = getByLabel(c, label);
        return v ? String(v).trim() : '';
      };
      // Luas Cek may be removed - handle gracefully
      const luasCek = colIndex['Luas Cek'] !== undefined ? getNum('Luas Cek') : 0;

      return {
        date,
        dateLabel: dateF || formatDate(date),
        wilayah: getStr('Wilayah'),
        lokasi: getStr('Lokasi'),
        engine: getStr('Engine'),
        irigator: getStr('Irigator'),
        jenisIrigator: getStr('Jenis Irigator'),
        planTime: getNum('Plan Time'),
        luasSiram: getNum('Luas Siram'),
        luasCek: luasCek, // kept for backward compatibility, 0 if removed
        kecepatan: getNum('Kecepatan Rata-rata'),
        tebalSiram: getNum('Tebal Siram'),
        prepareTime: getNum('Prepare Time'),
        operatingTime: getNum('Operating Time'),
        waitingTime: getNum('Waiting Time'),
        repair: getNum('Repair'),
        downTime: getNum('Down Time'),
        standby: getNum('Standby'),
        offTime: getNum('Off Time'),
        totOperTime: getNum('Tot. Oper. Time'),
        totalAvail: getNum('Total Avail'),
        totalTime: getNum('Total Time'),
        availability: getNum('% Availability'),
        utilization: getNum('% Utilization'),
        air: getNum('Air'),
        solarTerpakai: getNum('Solar Terpakai (ltr)'),
        biayaSolar: getNum('Biaya Solar (Std)'),
        biayaUpah: getNum('Biaya Upah'),
        biayaAlat: getNum('Biaya Alat'),
        biayaTotal: getNum('Biaya Total'),
        rpPerHa: getNum('Rp/Ha'),
        haPerHari: getNum('Ha/Hari'),
        haPerJam: getNum('Ha/Jam'),
        solarPerJam: getNum('Solar Ltr/jam'),
        solarPerHa: getNum('Solar Ltr/Ha'),
        jenisEngine: getStr('Jenis Engine'),
      };
    }).filter(r => r.date && !isNaN(r.date));
    return parsed;
  } catch (e) {
    console.warn('GVIZ JSON failed, trying CSV', e);
    try {
      const res = await fetch(CSV_URL, { cache: 'no-store' });
      if (!res.ok) throw new Error('CSV fetch failed');
      const csvText = await res.text();
      return parseCSVText(csvText);
    } catch (e2) {
      console.error('CSV fallback failed', e2);
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
    let date = null;
    const dateStr = row['Date'] || row['date'];
    if (dateStr) {
      const months = { 'Jan':0,'Feb':1,'Mar':2,'Apr':3,'Mei':4,'Jun':5,'Jul':6,'Ags':7,'Agu':7,'Sep':8,'Okt':9,'Nov':10,'Des':11,
                       'Januari':0,'Februari':1,'Maret':2,'April':3,'Mei':4,'Juni':5,'Juli':6,'Agustus':7,'September':8,'Oktober':9,'November':10,'Desember':11 };
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
      if (v == null || v === '') return 0;
      if (typeof v === 'string') {
        v = v.replace(/Rp|\./g,'').replace(',','.').trim();
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
      luasCek: num('Luas Cek'), // will be 0 if column removed
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
  if (filters.start) data = data.filter(d => d.date >= filters.start);
  if (filters.end) {
    const end = new Date(filters.end);
    end.setHours(23,59,59,999);
    data = data.filter(d => d.date <= end);
  }
  if (filters.months.size > 0) data = data.filter(d => filters.months.has(d.date.getMonth()));
  if (filters.year !== 'all') {
    const y = parseInt(filters.year);
    if (!isNaN(y)) data = data.filter(d => d.date.getFullYear() === y);
  }
  if (filters.wilayah.size > 0) data = data.filter(d => filters.wilayah.has(d.wilayah));
  if (filters.jenisEngine !== 'all') data = data.filter(d => d.jenisEngine === filters.jenisEngine);
  if (filters.search) {
    const q = filters.search.toLowerCase();
    data = data.filter(d => d.engine.toLowerCase().includes(q) || d.irigator.toLowerCase().includes(q) || d.lokasi.toLowerCase().includes(q) || d.wilayah.toLowerCase().includes(q));
  }
  if (filters.tableSearch) {
    const q = filters.tableSearch.toLowerCase();
    data = data.filter(d => Object.values(d).some(v => String(v).toLowerCase().includes(q)));
  }
  filteredData = data;
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
    return {
      key: k,
      label: k,
      date: arr[0].date,
      count: arr.length,
      totalLuasSiram: sum('luasSiram'),
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

// NEW: Detailed stats per wilayah - fokus pemakaian & hasil rata-rata
function getWilayahStats() {
  const groups = {};
  filteredData.forEach(d => {
    if (!groups[d.wilayah]) groups[d.wilayah] = [];
    groups[d.wilayah].push(d);
  });
  const stats = Object.keys(groups).map(w => {
    const arr = groups[w];
    const sum = (f) => arr.reduce((s,x)=>s+(x[f]||0),0);
    const avg = (f) => arr.length ? sum(f)/arr.length : 0;
    return {
      wilayah: w,
      count: arr.length,
      totalLuas: sum('luasSiram'),
      avgLuas: avg('luasSiram'),
      totalSolar: sum('solarTerpakai'),
      avgSolar: avg('solarTerpakai'),
      avgHaPerJam: avg('haPerJam'),
      avgHaPerHari: avg('haPerHari'),
      avgSolarPerHa: avg('solarPerHa'),
      avgSolarPerJam: avg('solarPerJam'),
      avgOperating: avg('operatingTime'),
      avgPrepare: avg('prepareTime'),
      avgWaiting: avg('waitingTime'),
      avgKecepatan: avg('kecepatan'),
      avgTebal: avg('tebalSiram'),
      avgAvailability: avg('availability'),
      avgUtilization: avg('utilization'),
      avgRpPerHa: avg('rpPerHa'),
      totalBiaya: sum('biayaTotal'),
      totalAir: sum('air'),
      // efisiensi score: higher Ha/Jam and lower Ltr/Ha is better
      efisiensiScore: avg('haPerJam') / (avg('solarPerHa') || 1) * 100,
    };
  });
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
          <td class="px-4 py-2.5 whitespace-nowrap"><span class="inline-flex items-center gap-1.5"><span class="h-2 w-2 rounded-full bg-emerald-500"></span><span class="font-semibold text-slate-900">${s.wilayah}</span></span></td>
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
  const bubbleData = stats.map(s=>({
    x: s.avgHaPerJam,
    y: s.avgSolarPerHa,
    r: Math.sqrt(s.totalLuas) * 2 + 5, // bubble size based on total luas
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
  const data = filteredData;
  if (data.length === 0) return null;
  const sum = (f) => data.reduce((s,x)=>s+(x[f]||0),0);
  const avg = (f) => data.length ? sum(f)/data.length : 0;
  return {
    totalLuasSiram: sum('luasSiram'),
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
  if (window.lucide) lucide.createIcons();
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

  // Luas Siram - now single dataset (Luas Cek removed)
  ensureChart('chartLuas', {
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

  // Performa per Wilayah - dynamic metric focused on pemakaian & hasil rata-rata
  const wilayahStatsForChart = getWilayahStats();
  const wilayahLabels = wilayahStatsForChart.map(s=>s.wilayah);
  // Determine data based on wilayahMetric
  let wilayahData, wilayahLabel, wilayahColor;
  if (wilayahMetric==='luas') { wilayahData=wilayahStatsForChart.map(s=>s.totalLuas); wilayahLabel='Total Luas Siram (Ha)'; wilayahColor='rgba(16,185,129,0.85)'; }
  else if (wilayahMetric==='solar') { wilayahData=wilayahStatsForChart.map(s=>s.totalSolar); wilayahLabel='Total Solar (L)'; wilayahColor='rgba(245,158,11,0.85)'; }
  else if (wilayahMetric==='avgLuas') { wilayahData=wilayahStatsForChart.map(s=>s.avgLuas); wilayahLabel='Avg Luas / Aktivitas (Ha)'; wilayahColor='rgba(16,185,129,0.65)'; }
  else if (wilayahMetric==='avgSolar') { wilayahData=wilayahStatsForChart.map(s=>s.avgSolar); wilayahLabel='Avg Solar / Aktivitas (L)'; wilayahColor='rgba(245,158,11,0.65)'; }
  else if (wilayahMetric==='haPerJam') { wilayahData=wilayahStatsForChart.map(s=>s.avgHaPerJam); wilayahLabel='Avg Ha/Jam (Produktivitas)'; wilayahColor='rgba(16,185,129,0.95)'; }
  else if (wilayahMetric==='ltrPerHa') { wilayahData=wilayahStatsForChart.map(s=>s.avgSolarPerHa); wilayahLabel='Avg Ltr/Ha (Efisiensi)'; wilayahColor='rgba(239,68,68,0.75)'; }
  else if (wilayahMetric==='ltrPerJam') { wilayahData=wilayahStatsForChart.map(s=>s.avgSolarPerJam); wilayahLabel='Avg Ltr/Jam'; wilayahColor='rgba(245,158,11,0.75)'; }
  else if (wilayahMetric==='operating') { wilayahData=wilayahStatsForChart.map(s=>s.avgOperating); wilayahLabel='Avg Jam Operasi (Jam)'; wilayahColor='rgba(59,130,246,0.85)'; }
  else if (wilayahMetric==='kecepatan') { wilayahData=wilayahStatsForChart.map(s=>s.avgKecepatan); wilayahLabel='Avg Kecepatan (m/menit)'; wilayahColor='rgba(139,92,246,0.85)'; }
  else if (wilayahMetric==='tebal') { wilayahData=wilayahStatsForChart.map(s=>s.avgTebal); wilayahLabel='Avg Tebal Siram (mm)'; wilayahColor='rgba(6,182,214,0.85)'; }
  else if (wilayahMetric==='util') { wilayahData=wilayahStatsForChart.map(s=>s.avgUtilization); wilayahLabel='Avg % Utilization'; wilayahColor='rgba(15,23,42,0.75)'; }
  else if (wilayahMetric==='rpPerHa') { wilayahData=wilayahStatsForChart.map(s=>s.avgRpPerHa); wilayahLabel='Avg Rp/Ha (Biaya)'; wilayahColor='rgba(100,116,139,0.85)'; }
  else { wilayahData=wilayahStatsForChart.map(s=>s.totalLuas); wilayahLabel='Total Luas Siram (Ha)'; wilayahColor='rgba(16,185,129,0.85)'; }

  ensureChart('chartWilayah', {
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
            label: ctx=> `${ctx.dataset.label}: ${wilayahMetric.includes('Ha')||wilayahMetric==='luas'||wilayahMetric==='avgLuas'?formatNumber(ctx.raw,2)+' Ha':wilayahMetric.includes('Solar')||wilayahMetric==='solar'||wilayahMetric==='avgSolar'?formatInt(ctx.raw)+' L':formatNumber(ctx.raw,2)}`
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
  $('#jenisEngineLegend').innerHTML = jenisLabels.map((l,i)=>{
    const pct = jenisValues[i]/ (jenisValues.reduce((a,b)=>a+b,0) ||1) *100;
    return `<div class="flex items-center justify-between text-[11px]"><div class="flex items-center gap-2"><span class="h-2.5 w-2.5 rounded-full" style="background:${colors[i%colors.length]}"></span><span class="font-medium text-slate-700">${l}</span></div><span class="font-mono text-slate-500">${formatNumber(pct,1)}%</span></div>`;
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

function initFiltersUI() {
  if (rawData.length===0) return;
  const dates = rawData.map(d=>d.date).sort((a,b)=>a-b);
  const minDate = dates[0], maxDate = dates[dates.length-1];
  $('#filterStart').value = formatDateISO(minDate);
  $('#filterEnd').value = formatDateISO(maxDate);
  filters.start = minDate;
  filters.end = maxDate;
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
      renderCharts();
    });
  }
  const wilayahSortSel = $('#wilayahSort');
  if (wilayahSortSel) {
    wilayahSortSel.addEventListener('change', (e)=>{
      wilayahSort = e.target.value;
      renderWilayahDetail();
      renderCharts();
    });
  }
  renderMonthChips();
  $('#filterStart').addEventListener('change', e=>{ filters.start = e.target.value ? new Date(e.target.value) : null; currentPage=1; updateAll(); });
  $('#filterEnd').addEventListener('change', e=>{ filters.end = e.target.value ? new Date(e.target.value) : null; currentPage=1; updateAll(); });
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
  $('#filterSearch').addEventListener('input', e=>{ filters.search = e.target.value; currentPage=1; updateAll(); });
  $('#filterJenisEngine').addEventListener('change', e=>{ filters.jenisEngine = e.target.value; currentPage=1; updateAll(); });
  $('#tableSearch').addEventListener('input', e=>{ filters.tableSearch = e.target.value; currentPage=1; renderTable(); });
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
    const csv = Papa.unparse(filteredData.map(d=>({
      Date: formatDateISO(d.date), Wilayah: d.wilayah, Lokasi: d.lokasi, Engine: d.engine, Irigator: d.irigator,
      'Jenis Engine': d.jenisEngine, 'Luas Siram': d.luasSiram, 'Operating Time': d.operatingTime,
      'Solar L': d.solarTerpakai, 'Ltr/Jam': d.solarPerJam, 'Ha/Jam': d.haPerJam, 'Kecepatan': d.kecepatan,
      'Tebal Siram': d.tebalSiram, 'Availability': d.availability, 'Utilization': d.utilization
    })));
    const blob = new Blob([csv], {type:'text/csv'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href=url; a.download=`PG2-ZPAS637-${formatDateISO(new Date())}.csv`; a.click();
    URL.revokeObjectURL(url);
  });
  $('#btnSync').addEventListener('click', async ()=>{
    $('#btnSync').innerHTML = '<i data-lucide="loader-2" class="h-4 w-4 animate-spin"></i> Syncing';
    lucide.createIcons(); await loadData(true);
    $('#btnSync').innerHTML = '<i data-lucide="refresh-cw" class="h-4 w-4"></i> Sync'; lucide.createIcons();
  });
  $('#btnFilters').addEventListener('click', ()=>{
    const panel = $('#filterPanel');
    panel.classList.toggle('hidden'); panel.classList.toggle('fixed'); panel.classList.toggle('inset-0');
    panel.classList.toggle('z-30'); panel.classList.toggle('bg-white'); panel.classList.toggle('p-6'); panel.classList.toggle('overflow-y-auto');
  });
}

async function loadData(isManual=false) {
  try {
    if (!isManual) $('#loadingOverlay').style.display='flex';
    const data = await fetchSheetData();
    rawData = data;
    if (!isManual) initFiltersUI();
    applyFilters(); renderKPIs(); renderCharts(); renderInsights(); renderTable();
    $('#lastSync').textContent = `Sync ${new Date().toLocaleTimeString('id-ID')} • ${formatInt(rawData.length)} records`;
    $('#rowCount').textContent = `${formatInt(filteredData.length)} / ${formatInt(rawData.length)} records`;
    $('#loadingOverlay').style.display='none';
  } catch (e) {
    console.error(e);
    $('#loadingOverlay').innerHTML = `<div class="text-center p-6"><div class="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-red-50 text-red-600"><i data-lucide="alert-triangle" class="h-6 w-6"></i></div><div class="mt-4 text-[13px] font-medium text-slate-900">Gagal memuat data</div><div class="mt-1 text-[11px] text-slate-500 max-w-[320px]">${e.message}</div><button onclick="location.reload()" class="mt-4 rounded-full bg-slate-900 px-4 py-2 text-[12px] font-medium text-white">Reload</button></div>`;
    lucide.createIcons();
  }
}

document.addEventListener('DOMContentLoaded', ()=>{
  loadData(false);
  setInterval(()=>loadData(true), 5*60*1000);
});
