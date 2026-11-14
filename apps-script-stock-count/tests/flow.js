// Flow tests for the stock movements in Code.gs, run against an in-memory copy of the sheet.
// Run: node apps-script-stock-count/tests/flow.js
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const DIR = path.join(__dirname, '..');
let pass = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); pass++; };
const fails = (fn, code, m) => { try { fn(); } catch (e) { assert.ok(String(e.message).startsWith(code + ':'), m + ' -> ' + e.message); pass++; return; } assert.fail(m + ' (no error)'); };

// ---- a very small fake of the Apps Script services the code uses
function fakeSheet(name, grid) {
  const sh = {
    grid: grid,
    getName: () => name, getLastRow: () => sh.grid.length, getLastColumn: () => (sh.grid[0] || []).length, getMaxRows: () => 1000,
    setFrozenRows: () => sh, appendRow: r => { sh.grid.push(r.slice()); return sh; },
    getRange: (r, c, nr, nc) => {
      nr = nr || 1; nc = nc || 1;
      const read = () => { const out = []; for (let i = 0; i < nr; i++) { const row = []; for (let j = 0; j < nc; j++) { const v = (sh.grid[r - 1 + i] || [])[c - 1 + j]; row.push(v == null ? '' : String(v)); } out.push(row); } return out; };
      const rg = {
        getValues: read, getDisplayValues: read, getDisplayValue: () => read()[0][0],
        setValue: v => { while (sh.grid.length < r) sh.grid.push([]); sh.grid[r - 1][c - 1] = v; return rg; },
        setValues: vals => { vals.forEach((row, i) => { while (sh.grid.length < r + i) sh.grid.push([]); row.forEach((v, j) => { sh.grid[r - 1 + i][c - 1 + j] = v; }); }); return rg; },
        setFontWeight: () => rg, setBackground: () => rg, setFontColor: () => rg, setNumberFormat: () => rg,
      };
      return rg;
    },
  };
  return sh;
}
const sheets = {
  'Bin Master': fakeSheet('Bin Master', [['Warehouse', 'STORAGE BIN', 'Active'], ['I1', 'BIN-A', 'Yes'], ['I1', 'BIN-B', 'Yes'], ['I1', 'BIN-OFF', 'No']]),
  'Stock On Hand': fakeSheet('Stock On Hand', [['Bin', 'Material', 'Description', 'Batch', 'SLOC', 'UoM', 'Pcs per Bundle', 'Book Qty'],
    ['BIN-A', '1100000231', 'INTANU G300AZ30 BR 1200x0.220', 'D1', '1020', 'kg', '1', '4,620.00'],
    ['BIN-A', 'PIPE-25', 'Square pipe 25x25', 'L1', '1020', 'PC', '50', '200']]),
  'Settings': fakeSheet('Settings', [['Setting', 'Value', 'Note']]),
};
const cache = { 'who_op@isi': JSON.stringify({ Name: 'Operator', admin: false }), 'who_admin@isi': JSON.stringify({ Name: 'Admin', admin: true }) };
let uuid = 0;
const ctx = {
  console: console,
  SpreadsheetApp: { getActive: () => ({ getSheetByName: n => sheets[n] || null, insertSheet: n => (sheets[n] = fakeSheet(n, [])), getSheets: () => Object.values(sheets) }) },
  CacheService: { getScriptCache: () => ({ get: k => cache[k] || null, put: (k, v) => { cache[k] = v; } }) },
  LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => 'x', setProperty: () => {} }) },
  Utilities: { formatDate: (d, tz, f) => (f === 'yyyy-MM-dd' ? '2026-11-13' : f === 'HH:mm' ? '21:00' : '261113210000'), getUuid: () => ('0000' + (++uuid)).slice(-4) + '-x' },
  ContentService: {}, DriveApp: {}, UrlFetchApp: {},
};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(DIR, 'rules.gs'), 'utf8'), ctx);
vm.runInContext(fs.readFileSync(path.join(DIR, 'ProductMaster.gs'), 'utf8'), ctx);
vm.runInContext(fs.readFileSync(path.join(DIR, 'Code.gs'), 'utf8') + '\nthis.route_ = route_;', ctx);
const op = { email: 'op@isi' }, admin = { email: 'admin@isi' };
const call = (action, p, user) => JSON.parse(JSON.stringify(ctx.route_(action, p, user || op)));
const book = (bin, material) => { const r = sheets['Stock On Hand'].grid.find(x => x[0] === bin && x[1] === material); return r ? Number(String(r[7]).replace(/,/g, '')) : null; };
const ledger = () => sheets['Stock Ledger'].grid.slice(1);
const coil = { bin: 'BIN-A', material: '1100000231', batch: 'D1', sloc: '1020' };
const pipe = { bin: 'BIN-A', material: 'PIPE-25', batch: 'L1', sloc: '1020' };

// Stock IN adds to the balance and writes one ledger row
let r = call('move', Object.assign({ requestId: 'r1', type: 'IN', qty: 100.5, reference: 'GR-001' }, coil));
eq([r.balance, book('BIN-A', '1100000231'), ledger().length], [4720.5, 4720.5, 1], 'IN adds and logs');
// Same request again (double tap / re-send) is answered, not posted twice
r = call('move', Object.assign({ requestId: 'r1', type: 'IN', qty: 100.5, reference: 'GR-001' }, coil));
eq([r.duplicate, book('BIN-A', '1100000231'), ledger().length], [true, 4720.5, 1], 'duplicate request is not posted again');
// Stock OUT subtracts; cannot go negative; needs a reference; pieces must be whole
r = call('move', Object.assign({ requestId: 'r2', type: 'OUT', qty: 50, reference: 'DN-9' }, pipe));
eq([r.balance, book('BIN-A', 'PIPE-25')], [150, 150], 'OUT subtracts');
fails(() => call('move', Object.assign({ requestId: 'r3', type: 'OUT', qty: 151, reference: 'DN-9' }, pipe)), 'BAD', 'OUT more than balance rejected');
fails(() => call('move', Object.assign({ requestId: 'r4', type: 'OUT', qty: 10, reference: '' }, pipe)), 'BAD', 'reference required');
fails(() => call('move', Object.assign({ requestId: 'r5', type: 'OUT', qty: 1.5, reference: 'DN' }, pipe)), 'BAD', 'pieces must be whole');
fails(() => call('move', Object.assign({ requestId: 'r6', type: 'OUT', qty: 0, reference: 'DN' }, pipe)), 'BAD', 'zero rejected');
eq([book('BIN-A', 'PIPE-25'), ledger().length], [150, 2], 'rejected movements change nothing');
// Transfer moves stock to another bin: both balances, two ledger rows, one Transfer ID
r = call('transfer', Object.assign({ requestId: 'r7', qty: 60, toBin: 'bin-b' }, pipe));
eq([r.balance, r.toBalance, book('BIN-A', 'PIPE-25'), book('BIN-B', 'PIPE-25')], [90, 60, 90, 60], 'transfer updates both bins');
const tr = ledger().slice(-2);
eq([tr[0][3], tr[1][3], tr[0][15] === tr[1][15], tr[0][4], tr[1][4]], ['TRANSFER OUT', 'TRANSFER IN', true, 'BIN-A', 'BIN-B'], 'two linked ledger rows');
r = call('transfer', Object.assign({ requestId: 'r7', qty: 60, toBin: 'BIN-B' }, pipe));
eq([r.duplicate, book('BIN-A', 'PIPE-25'), book('BIN-B', 'PIPE-25')], [true, 90, 60], 'duplicate transfer is not posted again');
fails(() => call('transfer', Object.assign({ requestId: 'r8', qty: 10, toBin: 'BIN-A' }, pipe)), 'BAD', 'same bin rejected');
fails(() => call('transfer', Object.assign({ requestId: 'r9', qty: 10, toBin: 'BIN-OFF' }, pipe)), 'NOBIN', 'inactive bin rejected');
fails(() => call('transfer', Object.assign({ requestId: 'r10', qty: 91, toBin: 'BIN-B' }, pipe)), 'BAD', 'transfer more than balance rejected');
eq([book('BIN-A', 'PIPE-25'), book('BIN-B', 'PIPE-25')], [90, 60], 'rejected transfers change nothing');
// Stock IN of a known material into a bin that does not hold it yet makes a new line; an unknown material needs an admin
r = call('move', { requestId: 'r11', type: 'IN', bin: 'BIN-B', material: '1100000231', batch: 'D2', sloc: '1020', qty: 4500, reference: 'GR-2' });
eq([r.balance, book('BIN-B', '1100000231')], [4500, 4500], 'IN makes a new line for a known material');
fails(() => call('move', { requestId: 'r12', type: 'IN', bin: 'BIN-B', material: 'NEW-1', batch: 'X', qty: 5, reference: 'GR-3' }), 'NOMAT', 'unknown material needs an admin');
r = call('move', { requestId: 'r13', type: 'IN', bin: 'BIN-B', material: 'NEW-1', desc: 'New item', uom: 'PC', batch: 'X', qty: 5, reference: 'GR-3' }, admin);
eq(r.balance, 5, 'admin can bring in a new material');
// Stock card: balance and movements of one line, newest first
r = call('card', pipe);
eq([r.line.book, r.rows.map(x => x.type), r.rows[0].balance], [90, ['TRANSFER OUT', 'OUT'], 90], 'card lists the line movements, newest first');
// Home numbers
r = call('boot', {});
eq([r.dash.inToday, r.dash.outToday, r.dash.transferToday, r.dash.recent.length], [3, 1, 1, 6], 'dashboard numbers for today');

// Product Master: the empty tab is filled from the seed; a pipe counted in bundles and pieces gets its kg total
eq(sheets['Product Master'].grid.length, 427, 'Product Master tab filled from the seed (426 pipes + header)');
const soh = sheets['Stock On Hand'].grid;
soh[0].push('Counted Qty Bundle', 'Counted Qty Kg', 'Counted Qty Pcs', 'Total Counted Qty Kg', 'Difference');
soh.push(['BIN-A', '1400000021', 'Galvanized Square Pipe 25x25x1.10x6m', 'L9', '2010', 'PC', '', '300']);
call('submit', { count: { bin: 'BIN-A', lines: [{ material: '1400000021', batch: 'L9', sloc: '2010', bundles: 2, kg: '', pieces: 5 }] } });
const pr = soh[soh.length - 1];
eq([pr[8], pr[10], pr[11], pr[12]], [2, 5, 1523.17, 5], '2 bundles x 150 + 5 pcs = 305 pcs = 1,523.17 kg, 5 pcs over the book');

console.log('Stock Count flow tests: ' + pass + ' passed');
