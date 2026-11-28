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
    setFrozenRows: () => sh, appendRow: r => { sh.grid.push(r.slice()); return sh; }, deleteRow: i => { sh.grid.splice(i - 1, 1); return sh; },
    getRange: (r, c, nr, nc) => {
      nr = nr || 1; nc = nc || 1;
      const read = () => { const out = []; for (let i = 0; i < nr; i++) { const row = []; for (let j = 0; j < nc; j++) { const v = (sh.grid[r - 1 + i] || [])[c - 1 + j]; row.push(v == null ? '' : String(v)); } out.push(row); } return out; };
      const rg = {
        getValues: read, getDisplayValues: read, getDisplayValue: () => read()[0][0],
        setValue: v => { while (sh.grid.length < r) sh.grid.push([]); sh.grid[r - 1][c - 1] = v; return rg; },
        setValues: vals => { vals.forEach((row, i) => { while (sh.grid.length < r + i) sh.grid.push([]); row.forEach((v, j) => { sh.grid[r - 1 + i][c - 1 + j] = v; }); }); return rg; },
        setFontWeight: () => rg, setBackground: () => rg, setFontColor: () => rg, setNumberFormat: () => rg,
        clearContent: () => { for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) if (sh.grid[r - 1 + i]) sh.grid[r - 1 + i][c - 1 + j] = ''; while (sh.grid.length && sh.grid[sh.grid.length - 1].every(x => x === '' || x == null)) sh.grid.pop(); return rg; },
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
  ContentService: { MimeType: { JSON: 'json' }, createTextOutput: t => ({ setMimeType: () => ({ getContent: () => t }) }) }, DriveApp: {}, UrlFetchApp: {},
};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(DIR, 'rules.gs'), 'utf8'), ctx);
vm.runInContext(fs.readFileSync(path.join(DIR, 'ProductMaster.gs'), 'utf8'), ctx);
vm.runInContext(fs.readFileSync(path.join(DIR, 'Stock.gs'), 'utf8') + '\nthis.route_ = route_; this.doPost = doPost;', ctx);
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
r = call('binCards', { bin: pipe.bin });
eq(r.rows.filter(x => x.material === pipe.material && x.batch === pipe.batch).map(x => x.type), ['TRANSFER OUT', 'OUT'], 'bin history has the same rows as the card');
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
eq([soh[0][13], soh[0][14], /^\d{4}-\d\d-\d\d$/.test(pr[13]), /^\d\d:\d\d$/.test(pr[14])], ['Count Date', 'Count Time', true, true], 'count date and time stamped (columns added)');
call('submit', { count: { bin: 'BIN-A', lines: [{ material: '1400000021', batch: 'L9', sloc: '2010', bundles: '', kg: '', pieces: 298 }] } });
eq([pr[8], pr[10], pr[12]], ['', 298, -2], 'a new count replaces the old one (no adding up)');
eq([soh[0][15], soh[0][16], pr[15], typeof pr[16]], ['Counted Qty', 'Counted By', 298, 'string'], 'counted qty (book unit) and counter name saved');

// Kim's own Product Master headers (19 Nov): PC/Bundle, Kg/PC, UoM. Boot sends the list; an operator may bring a
// Product Master material into a bin for the first time, with its description, unit and pcs per bundle copied.
sheets['Product Master'].grid = [['Material Group L4', 'Material', 'Description', 'ABC Class', 'Size', 'PC/Bundle', 'Kg/PC', 'UoM'],
  ['Deformed Bar', '1500000000', 'Debar SD390 12mm ISI', 'A', '', '100', '10.66', 'PC']];
Object.keys(cache).filter(k => k === 'pml').forEach(k => delete cache[k]);
r = call('boot', {});
eq([r.products.length, r.products[0].ppb, r.products[0].kg, r.products[0].uom], [1, 100, 10.66, 'PC'], 'boot sends the Product Master read by header name');
r = call('move', { requestId: 'r40', type: 'IN', bin: 'BIN-B', material: '1500000000', batch: 'DB-7', sloc: '2010', qty: 205, reference: 'GR-40' });
const nl = soh[soh.length - 1];
eq([r.balance, nl[1], nl[2], nl[5], nl[6]], [205, '1500000000', 'Debar SD390 12mm ISI', 'PC', 100], 'first IN of a Product Master material makes the line');

// Admin edit / delete of a line (Kim, 19 Nov): balance fix is an ADJUST row; batch rename; delete; staff refused.
fails(() => call('editLine', { requestId: 'e0', bin: 'BIN-B', material: '1500000000', batch: 'DB-7', sloc: '2010', balance: 200, reason: 'x' }), 'ADMIN', 'staff cannot edit a line');
fails(() => call('editLine', { requestId: 'e1', bin: 'BIN-B', material: '1500000000', batch: 'DB-7', sloc: '2010', balance: 200, reason: '' }, admin), 'BAD', 'reason required');
r = call('editLine', { requestId: 'e2', bin: 'BIN-B', material: '1500000000', batch: 'DB-7', sloc: '2010', balance: 200, newBatch: 'DB-8', reason: 'typo' }, admin);
const led = sheets['Stock Ledger'].grid, lh = led[0], lr = led[led.length - 1];
eq([r.balance, lr[lh.indexOf('Type')], lr[lh.indexOf('Out')], lr[lh.indexOf('Batch')], soh[soh.length - 1][3], soh[soh.length - 1][7]], [200, 'ADJUST', 5, 'DB-8', 'DB-8', 200], 'balance 205 -> 200 posts ADJUST out 5 and renames the batch');
const before = soh.length;
r = call('editLine', { requestId: 'e3', bin: 'BIN-B', material: '1500000000', batch: 'DB-8', sloc: '2010', delete: true, reason: 'wrong bin' }, admin);
eq([r.deleted, soh.length, led[led.length - 1][lh.indexOf('Out')]], [true, before - 1, 200], 'delete adjusts to 0 and removes the line');

// Product Master synced from Kim's Excel (20 Nov): rows replace the tab, Kg/PC + UoM typed in the tab are kept.
const post = b => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(b) } }).getContent());
const xrows = [{ 'Material Group L4': 'Deformed Bar', 'Material Code': '1500000000', 'Material Description': 'Debar SD390 12mm ISI', Class: 'A', Size: '12mm', 'Pcs/Bundle': 240, 'Material Group L1': 'FG Trading', Brand: 'ISI', 'CBM/Bundle (m³)': '0.5' }];
for (let i = 1; i < 12; i++) xrows.push({ 'Material Group L4': 'Pipe', 'Material Code': 'P' + i, 'Material Description': 'Pipe ' + i, 'Pcs/Bundle': 100 });
eq(post({ action: 'pmSync', key: 'bad', rows: xrows }).ok, false, 'sync refused with a wrong key');
eq(post({ action: 'pmSync', key: 'x', rows: xrows.slice(0, 3) }).ok, false, 'sync refused when the Excel looks empty');
r = post({ action: 'pmSync', key: 'x', rows: xrows, file: 'Product - 2026-11.xlsx' });
const pmg = sheets['Product Master'].grid;
const ph = pmg[0], pc = n => pmg[1][ph.indexOf(n)];
eq([r.ok, r.data.rows, pmg.length, pc('Material'), pc('PC/Bundle'), pc('Kg/PC'), pc('UoM'), pc('Material Group L1'), pc('Brand'), pc('CBM/Bundle (m³)')],
  [true, 12, 13, '1500000000', '240', '10.66', 'PC', 'FG Trading', 'ISI', '0.5'], 'Excel rows replace the tab; old Kg/PC and UoM kept; every Excel column kept');
const pt = call('products', {}, admin);
eq([pt.head[0], pt.rows.length, pt.head.indexOf('CBM/Bundle (m³)') > 0], ['Material', 12, true], 'Product menu gets the whole tab');
let refused = false; try { call('products', {}, op); } catch (e) { refused = /NOACCESS/.test(e.message); }
eq(refused, true, 'Product menu refused for a plain user');

// ---- SAP variance log (27 Nov)
const vrow = (k, v, extra) => Object.assign({ key: k, material: k.split('|')[0], batch: k.split('|')[1], digital: 100, sap: 100 - v, variance: v, uom: 'PC', status: 'var' }, extra || {});
let vs = call('varSave', { file: 'a.xlsx', at: '2026-11-27 09:00', level: 'material+batch', lines: 3, match: 1, rows: [vrow('M1|B1', 5, { reason: 'Wrong batch', remark: 'r1' }), vrow('M2|B2', -3)] });
eq([vs.added, vs.updated, vs.closed], [2, 0, 0], 'first save opens two cases');
vs = call('varSave', { file: 'a.xlsx', at: '2026-11-27 09:00', level: 'material+batch', lines: 3, match: 1, rows: [vrow('M1|B1', 5), vrow('M2|B2', -3, { reason: 'Count error' })] });
let vl = call('varList', {});
eq([vs.added, vs.updated, vl.cases.length, vl.snaps.length, vl.cases[0].Times, vl.cases[0].Reason, vl.cases[1].Reason], [0, 2, 2, 1, '1', 'Wrong batch', 'Count error'], 'saving the same file again updates, keeps reasons');
vs = call('varSave', { file: 'b.xlsx', at: '2026-11-28 09:00', level: 'material+batch', lines: 2, match: 1, rows: [vrow('M1|B1', 4)], matched: ['M2|B2'] });
vl = call('varList', {});
eq([vs.updated, vs.closed, vl.cases[0].Times, vl.cases[0].Variance, vl.cases[1].Status, vl.cases[1].Action, vl.snaps.length], [1, 1, '2', '4', 'Resolved', 'Matched in SAP', 2], 'next file: repeat counted, matched case closed');
fails(() => call('varUpdate', { id: vl.cases[0]['Case ID'], status: 'Resolved' }), 'BAD', 'resolve needs an action');
const vu = call('varUpdate', { id: vl.cases[0]['Case ID'], status: 'Resolved', action: 'SAP adjustment', owner: 'Dara' });
eq([vu.case.Status, vu.case.Owner, !!vu.case['Resolved At']], ['Resolved', 'Dara', true], 'resolve by hand');

// ---- fix a wrong movement (27 Nov, question 2): reverse = REVERSAL row, old row kept; own + today; no double reverse
const pBal = book('BIN-A', 'PIPE-25');
const mv = call('move', Object.assign({ requestId: 'q1', type: 'OUT', qty: 10, reference: 'DN-77' }, pipe));
eq(book('BIN-A', 'PIPE-25'), pBal - 10, 'out before undo');
fails(() => call('reverse', { requestId: 'q2', id: mv.id }), 'BAD', 'reverse needs a reason when not an undo');
let rv = call('reverse', { requestId: 'q3', id: mv.id, undo: true });
const rl = ledger()[ledger().length - 1], lh2 = sheets['Stock Ledger'].grid[0];
eq([book('BIN-A', 'PIPE-25'), rl[lh2.indexOf('Type')], rl[lh2.indexOf('In')], rl[lh2.indexOf('Reverses')], rv.reversed], [pBal, 'REVERSAL', 10, mv.id, [mv.id]], 'undo puts the stock back with a REVERSAL row');
fails(() => call('reverse', { requestId: 'q4', id: mv.id, reason: 'again' }), 'BAD', 'cannot reverse twice');
eq(call('reverse', { requestId: 'q3', id: mv.id, undo: true }).duplicate, true, 'same request answered, not posted again');
fails(() => call('reverse', { requestId: 'q5', id: rv.id, reason: 'x' }), 'BAD', 'a reversal cannot be reversed');
const mv2 = call('move', Object.assign({ requestId: 'q6', type: 'IN', qty: 3, reference: 'GR-77' }, pipe), admin);
fails(() => call('reverse', { requestId: 'q7', id: mv2.id, reason: 'wrong qty' }), 'NOACCESS', 'a user cannot fix someone else\'s movement');
rv = call('reverse', { requestId: 'q8', id: mv2.id, reason: 'wrong qty' }, admin);
eq(book('BIN-A', 'PIPE-25'), pBal, 'admin reverses an IN');
const tr2 = call('transfer', Object.assign({ requestId: 'q9', qty: 5, toBin: 'BIN-B' }, pipe));
const bB = book('BIN-B', 'PIPE-25');
rv = call('reverse', { requestId: 'q10', id: tr2.id, reason: 'wrong bin' });
eq([book('BIN-A', 'PIPE-25'), book('BIN-B', 'PIPE-25'), rv.reversed.length], [pBal, bB - 5, 2], 'transfer reversed on both bins');

// ---- damaged stock in a count (27 Nov, point 7): saved as Damaged Qty + Damage Type columns in Counts
call('submit', { count: { bin: 'BIN-A', lines: [{ material: '1400000021', batch: 'L9', sloc: '2010', bundles: '', kg: '', pieces: 300, remark: 'rack 2', damaged: { bundles: '', kg: '', pieces: 6, type: 'Bent' } }] } });
const cg = sheets['Counts'].grid, ch = cg[0].map(h => String(h).toLowerCase()), cl = cg[cg.length - 1];
eq([cl[ch.indexOf('damaged qty')], cl[ch.indexOf('damage type')], cl[ch.indexOf('remark')], pr[12]], [6, 'Bent', 'rack 2', 0], 'damaged qty, type and remark saved; total includes damaged');

// ---- Confirm GI (27 Nov, points 12-13)
let gi = call('giConfirm', { file: 'MB51.xlsx', lines: [{ key: '5011|M1|B1', ref: '5011', material: 'M1', batch: 'B1', appQty: -5, sapQty: -5, diff: 0, result: 'Matched' }, { key: '5012|M2|B2', ref: '5012' }] });
eq([gi.added, gi.skipped], [2, 0], 'two lines confirmed');
gi = call('giConfirm', { file: 'MB51b.xlsx', lines: [{ key: '5011|m1|b1' }, { key: '5013|M3|B3' }] });
const gl = call('giList', {});
eq([gi.added, gi.skipped, gl.rows.length, gl.rows[0].key, gl.rows[0].file], [1, 1, 3, '5011|M1|B1', 'MB51.xlsx'], 'already confirmed lines are skipped; list reads back');
fails(() => call('giConfirm', { lines: [] }), 'BAD', 'nothing ticked');
// ---- stock access (27 Nov): Stock Categories limit what a person sees
const g231 = vm.runInContext('(pm_()["1100000231"] || {}).group', ctx) || '';
cache['who_cat@isi'] = JSON.stringify({ Name: 'Cat', admin: false, cats: [g231 || 'NONE'] });
cache['who_none@isi'] = JSON.stringify({ Name: 'None', admin: false, cats: ['No Such Group'] });
const bc = call('boot', {}, { email: 'cat@isi' }), bn = call('boot', {}, { email: 'none@isi' }), ba = call('boot', {}, admin);
eq([bn.stock.length, call('ledger', {}, { email: 'none@isi' }).rows.length, call('bin', { bin: 'BIN-A' }, { email: 'none@isi' }).lines.length, ba.stock.length > 0],
  [0, 0, 0, true], 'no matching category: nothing shown; blank = everything');
if (g231) eq([bc.stock.every(l => l.material === '1100000231' || vm.runInContext('(pm_()[' + JSON.stringify(l.material.toUpperCase()) + '] || {}).group', ctx) === g231), bc.stock.length > 0, bc.user.cats[0]], [true, true, g231], 'only own category lines');
// L2 (28 Nov): a person saved with a Material Group L2 sees every L4 under it; old L4 names still work
vm.runInContext("pm_ = () => ({ M1: { group: 'Deformed Bar', group2: 'Bars' }, M2: { group: 'Wire Rod', group2: 'Bars' }, M3: { group: 'GI Pipe', group2: 'Pipes' } })", ctx);
const seeL2 = vm.runInContext("seeFn_({ cats: ['bars'] })", ctx), seeL4 = vm.runInContext("seeFn_({ cats: ['GI Pipe'] })", ctx), seeAll = vm.runInContext("seeFn_({ cats: [] })", ctx);
eq([seeL2('M1'), seeL2('M2'), seeL2('M3'), seeL4('M3'), seeL4('M1'), seeAll], [true, true, false, true, false, null], 'stock access by Material Group L2 (and old L4 names)');
// L1 + L2 (28 Nov): the same L2 under two L1 is told apart; a plain L2 still covers both
vm.runInContext("pm_ = () => ({ F1: { group: 'x', group1: 'Finished Goods', group2: 'Roofing' }, R1: { group: 'y', group1: 'Raw Material', group2: 'Roofing' } })", ctx);
const seeFG = vm.runInContext("seeFn_({ cats: ['Finished Goods > Roofing'] })", ctx), seePlain = vm.runInContext("seeFn_({ cats: ['Roofing'] })", ctx);
eq([seeFG('F1'), seeFG('R1'), seePlain('F1'), seePlain('R1')], [true, false, true, true], 'stock access by L1 > L2 pair; plain L2 still covers both');
console.log('Stock Count flow tests: ' + pass + ' passed');
