/**
 * PG2 dashboard — controlled formula repair page for ZPAS637.
 * Deploy as a Google Apps Script Web App, execute as the spreadsheet owner.
 * This deliberately repairs only blank formula-derived cells whose inputs are present.
 * It does NOT guess required text fields, fix formats, or alter outliers.
 */
const REPAIR_SPREADSHEET_ID = '1mhXxr7cfdnS-A_gJ6E4aixGRSzINdGP94orr-2lL45o';
const REPAIR_SHEET_NAME = 'ZPAS637';

function doGet() {
  const t = HtmlService.createTemplateFromFile('Repair');
  return t.evaluate().setTitle('PG2 — Repair rumus spreadsheet');
}

function getRepairPreview() {
  const sh = SpreadsheetApp.openById(REPAIR_SPREADSHEET_ID).getSheetByName(REPAIR_SHEET_NAME);
  if (!sh) throw new Error('Sheet ZPAS637 tidak ditemukan.');
  const values = sh.getDataRange().getValues();
  const formulas = sh.getDataRange().getFormulas();
  if (values.length < 2) return { sheet: REPAIR_SHEET_NAME, items: [] };
  const headers = values[0].map(v => String(v).trim().toLowerCase());
  const find = (...terms) => headers.findIndex(h => terms.every(t => h.includes(t)));
  const col = {
    solar: find('biaya', 'solar'), upah: find('biaya', 'upah'), alat: find('biaya', 'alat'),
    total: find('biaya', 'total'), luas: find('luas', 'siram'), rpHa: find('rp', 'ha'),
    prep: find('prepare'), oper: find('oper'), totOper: find('tot', 'oper')
  };
  const items = [];
  const add = (r, c, formula, label, why) => {
    if (c < 0 || values[r][c] !== '' || formulas[r][c]) return;
    items.push({ row: r + 1, cell: colLetter_(c + 1), label, formula, why });
  };
  for (let r = 1; r < values.length; r++) {
    if (col.total >= 0 && [col.solar, col.upah, col.alat].every(c => c >= 0)) {
      const parts = [values[r][col.solar], values[r][col.upah], values[r][col.alat]];
      if (parts.some(v => v !== '' && Number(v) !== 0) && parts.every(v => v !== '' && Number.isFinite(Number(v))))
        add(r, col.total, `=${colLetter_(col.solar+1)}${r+1}+${colLetter_(col.upah+1)}${r+1}+${colLetter_(col.alat+1)}${r+1}`, 'Biaya Total', 'Dihitung dari Biaya Solar + Biaya Upah + Biaya Alat.');
    }
    if (col.rpHa >= 0 && col.total >= 0 && col.luas >= 0 && Number(values[r][col.total]) > 0 && Number(values[r][col.luas]) > 0)
      add(r, col.rpHa, `=${colLetter_(col.total+1)}${r+1}/${colLetter_(col.luas+1)}${r+1}`, 'Rp/Ha', 'Dihitung dari Biaya Total / Luas Siram.');
    if (col.totOper >= 0 && col.prep >= 0 && col.oper >= 0 && (Number(values[r][col.prep]) > 0 || Number(values[r][col.oper]) > 0))
      add(r, col.totOper, `=${colLetter_(col.prep+1)}${r+1}+${colLetter_(col.oper+1)}${r+1}`, 'Tot Oper Time', 'Dihitung dari Prepare + Operating time.');
  }
  return { sheet: REPAIR_SHEET_NAME, items };
}

function applyRepairs() {
  const lock = LockService.getDocumentLock();
  lock.waitLock(15000);
  try {
    const preview = getRepairPreview();
    const sh = SpreadsheetApp.openById(REPAIR_SPREADSHEET_ID).getSheetByName(REPAIR_SHEET_NAME);
    const changes = [];
    preview.items.forEach(item => {
      // Re-check immediately before writing to avoid overwriting a cell edited after preview.
      const target = sh.getRange(item.cell + item.row);
      if (target.isBlank() && target.getFormula() === '') {
        target.setFormula(item.formula);
        changes.push(item);
      }
    });
    SpreadsheetApp.flush();
    return { sheet: REPAIR_SHEET_NAME, repaired: changes.length, items: changes };
  } finally { lock.releaseLock(); }
}

function colLetter_(n) {
  let s = '';
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
}
