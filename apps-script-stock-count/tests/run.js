// Tests for the Stock Count rules and the Code.gs syntax. Run: node apps-script-stock-count/tests/run.js
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const DIR = path.join(__dirname, '..');
let pass = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); pass++; };
const ok = (c, m) => { assert.ok(c, m); pass++; };

// rules.gs is plain JavaScript (function declarations), so it runs unchanged in Node.
const ctx = {};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(DIR, 'rules.gs'), 'utf8'), ctx);
const { countedPcs, statusOf, needsPhoto, validateCount, countedQty, accuracyPct, todayList, outOk, comparable } = ctx;

// Bundles x pieces per bundle + loose pieces
eq(countedPcs(2, 50, 7), 107, 'bundles x pcs per bundle + pieces');
eq(countedPcs(0, 50, 12), 12, 'pieces only');
eq(countedPcs('3', '', '0'), 3, 'missing pcs per bundle counts as 1');

// Status against book
eq(statusOf(0, 0), 'MATCH', 'exact match');
eq(statusOf(-1, 0), 'SHORT', 'one short with zero tolerance');
eq(statusOf(4, 0), 'OVER', 'over');
eq(statusOf(-2, 2), 'MATCH', 'within tolerance');
eq(statusOf(-3, 2), 'SHORT', 'beyond tolerance');
eq([needsPhoto('MATCH'), needsPhoto('SHORT'), needsPhoto('OVER')], [false, true, true], 'photo only on SHORT/OVER');

// Validation
eq(validateCount({ bundles: '0', kg: '', pieces: '0' }), '', '0 and 0 is a valid count');
eq(validateCount({ bundles: '', kg: '', pieces: '5' }), '', 'blank bundles = 0');
ok(validateCount({ bundles: '', kg: '', pieces: '' }) === 'Fill Bundle, Kg or Pcs for every line.', 'all blank rejected');
ok(validateCount({ bundles: '1.5', kg: '', pieces: '0' }) !== '', 'fraction bundle rejected');
eq(validateCount({ bundles: '1', kg: '4620.5', pieces: '' }), '', 'decimal kg allowed');
ok(validateCount({ bundles: '-1', kg: '', pieces: '0' }) !== '', 'negative rejected');
// Counted qty follows the book unit (Kim's template: Bundle 1 / Kg 4,620 / Pcs -)
eq(countedQty({ bundles: '1', kg: '4620', pieces: '' }, 'KG', 1), 4620, 'KG line counts the kg');
eq(countedQty({ bundles: '2', kg: '', pieces: '7' }, 'PC', 50), 107, 'PC line counts bundles x pcs + pcs');

// Any one box is enough; the book is compared only when the box in the book unit is filled
eq(validateCount({ bundles: '1', kg: '', pieces: '' }), '', 'bundle only is a valid count');
eq([comparable({ bundles: '1', kg: '', pieces: '' }, 'KG'), comparable({ bundles: '', kg: '4620', pieces: '' }, 'KG')], [false, true], 'KG line compares only with Kg filled');
eq([comparable({ bundles: '', kg: '50', pieces: '' }, 'PC'), comparable({ bundles: '', kg: '', pieces: '0' }, 'PC')], [false, true], 'PC line compares only with Bundle or Pcs filled');

// Accuracy = MATCH share of last N counts
eq(accuracyPct([], 10), null, 'never counted = no score');
eq(accuracyPct(['MATCH', 'SHORT', 'MATCH', 'MATCH'], 10), 75, '3 of 4 match');
eq(accuracyPct(['SHORT', 'SHORT', 'MATCH', 'MATCH'], 2), 100, 'only the last 2 count');

// Stock out
eq(outOk(200, 1200), '', 'out within stock');
ok(outOk(1300, 1200) !== '', 'out more than on hand rejected');
ok(outOk(0, 1200) !== '', 'zero out rejected');

// Today's list: never counted first, then oldest count, active only, limited to N
const bins = [
  { bin: 'B', lastCount: '2026-11-10 09:00' },
  { bin: 'A', lastCount: '' },
  { bin: 'C', lastCount: '2026-11-01 08:00' },
  { bin: 'X', lastCount: '', active: false },
  { bin: 'D', lastCount: '2026-11-12 10:00' },
];
eq(todayList(bins, 3).map(b => b.bin), ['A', 'C', 'B'], 'never-counted, then oldest; inactive dropped; limit 3');

// Product Master: bundles and pieces turned into kg; difference in the book unit
eq(ctx.countedKg({ bundles: 2, kg: '', pieces: 5 }, 150, 4.994), 1523.17, '2 bundles x 150 + 5 pcs at 4.994 kg');
eq(ctx.countedKg({ bundles: 2, kg: 100, pieces: 0 }, 150, 0), 100, 'no kg per piece: only the kg box counts');
eq(ctx.countDiff({ bundles: 0, kg: 4500, pieces: 0 }, 'kg', 1, 0, 4530), -30, 'KG line: kg total - book');
eq(ctx.countDiff({ bundles: 1, kg: 0, pieces: 10 }, 'PC', 150, 4.994, 150), 10, 'PC line: pieces - book');
eq(ctx.countDiff({ bundles: 0, kg: 499.4, pieces: 0 }, 'PC', 150, 4.994, 150), -50, 'PC line counted in kg is turned into pieces');
eq(ctx.countDiff({ bundles: 1, kg: 0, pieces: 0 }, 'kg', 150, 4.994, 749.1), 0, 'KG line counted in bundles');
new vm.Script(fs.readFileSync(path.join(DIR, 'ProductMaster.gs'), 'utf8'), { filename: 'ProductMaster.gs' });
pass++;

// Code.gs must at least compile as JavaScript (it uses Apps Script globals only at run time)
new vm.Script(fs.readFileSync(path.join(DIR, 'Code.gs'), 'utf8'), { filename: 'Code.gs' });
pass++;

console.log('Stock Count tests: ' + pass + ' passed');
