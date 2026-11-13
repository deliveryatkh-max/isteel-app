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
const { countedPcs, statusOf, needsPhoto, validateCount, accuracyPct, todayList } = ctx;

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
eq(validateCount({ bundles: '0', pieces: '0' }), '', '0 and 0 is a valid count');
ok(validateCount({ bundles: '', pieces: '5' }) !== '', 'empty bundles rejected');
ok(validateCount({ bundles: '1.5', pieces: '0' }) !== '', 'fraction rejected');
ok(validateCount({ bundles: '-1', pieces: '0' }) !== '', 'negative rejected');

// Accuracy = MATCH share of last N counts
eq(accuracyPct([], 10), null, 'never counted = no score');
eq(accuracyPct(['MATCH', 'SHORT', 'MATCH', 'MATCH'], 10), 75, '3 of 4 match');
eq(accuracyPct(['SHORT', 'SHORT', 'MATCH', 'MATCH'], 2), 100, 'only the last 2 count');

// Today's list: never counted first, then oldest count, active only, limited to N
const bins = [
  { bin: 'B', lastCount: '2026-11-10 09:00' },
  { bin: 'A', lastCount: '' },
  { bin: 'C', lastCount: '2026-11-01 08:00' },
  { bin: 'X', lastCount: '', active: false },
  { bin: 'D', lastCount: '2026-11-12 10:00' },
];
eq(todayList(bins, 3).map(b => b.bin), ['A', 'C', 'B'], 'never-counted, then oldest; inactive dropped; limit 3');

// Code.gs must at least compile as JavaScript (it uses Apps Script globals only at run time)
new vm.Script(fs.readFileSync(path.join(DIR, 'Code.gs'), 'utf8'), { filename: 'Code.gs' });
pass++;

console.log('Stock Count tests: ' + pass + ' passed');
