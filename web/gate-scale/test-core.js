// node web/gate-scale/test-core.js — checks the Gate vs Scale matching with cases from the real 13–14 Nov 2026 data.
const assert = require('assert');
const C = require('./gs-core.js');
const R = (id, truck, date, start, kg) => ({ id, truck, date, start, end: '', site: 'WH IB', uom: 'Kg', status: 'Done', items: [{ grQty: kg }] });
const T = (no, plate, t1, t2, type, net) => ({ no, plate, t1, t2, type: type || 'In', status: 'Done', net: net == null ? '' : net });

assert.strictEqual(C.edits('3R3990', '3E3990'), 1);
assert.strictEqual(C.edits('37208', '3E7208'), 1);
assert.strictEqual(C.edits('3A1102', '3A1102'), 0);
assert.strictEqual(C.edits('3A1102', '3B1103'), 9);

const rec = [
  R('IB-1', '3A-6355', '2026-11-13', '08:27', 32070),
  R('IB-2', '3R-3990', '2026-11-13', '13:22', 42390),          // typed wrong at Inbound
  R('IB-3', '3C-6981', '2026-11-14', '12:20', 30000),          // weighed in on the 13th, out on the 14th
  R('IB-4', '3A-7596', '2026-11-13', '19:29', 25932),          // no ticket
  R('IB-5', '3A-1102', '2026-11-13', '08:00', 1), R('IB-6', '3A-1102', '2026-11-13', '14:00', 1),   // two trips
  R('IB-7', '3B-0001', '2026-11-13', '10:00', 1),              // ticket ticked Load by mistake
];
const tk = [
  T('WB-1', '3A6355', '2026-11-13T07:43:00', '2026-11-13T08:57:00', 'In', 32000),
  T('WB-2', '3E-3990', '2026-11-13T07:18:00', '2026-11-13T14:22:00'),
  T('WB-3', '3C-6981', '2026-11-13T06:28:00', '2026-11-14T12:47:00'),
  T('WB-4', '3A-1102', '2026-11-13T13:40:00', '2026-11-13T14:50:00'), T('WB-5', '3A-1102', '2026-11-13T07:30:00', '2026-11-13T08:40:00'),
  T('WB-6', '3G-0500', '2026-11-13T10:00:00', '2026-11-13T11:00:00'),   // no Inbound record
  T('WB-7', '3B-0001', '2026-11-13T09:50:00', '2026-11-13T10:30:00', 'Out'),
  Object.assign(T('WB-8', '3A-7596', '2026-11-13T09:00:00', ''), { status: 'Void' }),
];
const by = rows => { const o = {}; rows.forEach(w => { o[(w.ib ? w.ib.id : '') + '/' + (w.sc ? w.sc.no : '')] = w.st; }); return o; };
const d13 = by(C.match(rec, tk, '2026-11-13', '2026-11-13'));
assert.deepStrictEqual(d13, { 'IB-1/WB-1': 'ok', 'IB-2/WB-2': 'typo', 'IB-4/': 'ib', 'IB-5/WB-5': 'ok', 'IB-6/WB-4': 'ok', 'IB-7/': 'ib', '/WB-6': 'sc' });
const r13 = C.match(rec, tk, '2026-11-13', '2026-11-13');
assert.strictEqual(r13.find(w => w.ib && w.ib.id === 'IB-1').diff, -70);
assert.strictEqual(r13.find(w => w.ib && w.ib.id === 'IB-7').outNo, 'WB-7');
const d14 = by(C.match(rec, tk, '2026-11-14', '2026-11-14'));
assert.deepStrictEqual(d14, { 'IB-3/WB-3': 'day' });
console.log('gate-scale core: all tests passed');
