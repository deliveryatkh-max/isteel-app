// node web/scale/test-core.js — checks the scale reader, warnings, ticket numbers and the PDF wrapper.
const C = require('./scale-core.js');
const assert = require('assert');
// Keli continuous: 32440 kg shown, digits sent lowest first after "="
let r = C.parse('xx=04423000=04423000=0442', 'auto');
assert.deepStrictEqual(r.weights.map(w => w.kg), [32440, 32440]); assert.strictEqual(r.rest, '=0442');
r = C.parse(r.rest + '3000=', 'keli'); assert.deepStrictEqual(r.weights.map(w => w.kg), [32440]);
r = C.parse('=0.07300=0.0730', 'keli'); assert.deepStrictEqual(r.weights.map(w => w.kg), [370]);   // "0.07300" -> "00370.0"
r = C.parse('=-0300000=', 'keli'); assert.deepStrictEqual(r.weights.map(w => w.kg), [-30]);
// STX frame: + 032440, 0 decimals
r = C.parse('\x02+03244000A\x03\x02+0324', 'auto'); assert.deepStrictEqual(r.weights.map(w => w.kg), [32440]); assert.strictEqual(r.rest, '\x02+0324');
r = C.parse('\x02-00012510\x03', 'stx'); assert.deepStrictEqual(r.weights.map(w => w.kg), [-12.5]);
// line format with stable flag
r = C.parse('ST,GS,+0032440kg\r\nUS,GS,+0032460kg\r\nST,G', 'line');
assert.deepStrictEqual(r.weights, [{ kg: 32440, stable: true }, { kg: 32460, stable: false }]); assert.strictEqual(r.rest, 'ST,G');
// stability
const s = C.Stable(1500); let now = 1e6;
for (let i = 0; i < 5; i++) s.push(1000 + i * 10, undefined, now += 200);
assert.strictEqual(s.isStable(now), false);
for (let i = 0; i < 9; i++) s.push(1040, undefined, now += 200);
assert.strictEqual(s.isStable(now), true);
s.push(1050, undefined, now += 200); assert.strictEqual(s.isStable(now), false);
assert.strictEqual(s.isStable(now + 5000), false);   // no signal
// finish + warnings
let f = C.finish(11360, 32440, { empty: 11300, max: 25000 }, 5);
assert.deepStrictEqual([f.gross, f.tare, f.net], [32440, 11360, 21080]);
assert.deepStrictEqual(f.warn.map(w => w.k), ['over']);
f = C.finish(32440, 12500, { empty: 11300, max: 40000 }, 5);
assert.deepStrictEqual(f.warn.map(w => w.k), ['tare']); assert.ok(/11% above/.test(f.warn[0].en));
f = C.finish(10000, 10000, null, 5); assert.deepStrictEqual(f.warn.map(w => w.k), ['zero']);
// numbers
assert.strictEqual(C.nextNo('WB', new Date(2026, 10, 6), ['WB-261106-001', 'WB-261106-009', 'WB-261105-044']), 'WB-261106-010');
assert.strictEqual(C.nextNo('WB', new Date(2026, 10, 7), ['WB-261106-001']), 'WB-261107-001');
// pdf
const pdf = Buffer.from(C.jpegPdf(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), 10, 10)).toString('latin1');
assert.ok(pdf.startsWith('%PDF-1.4') && pdf.trim().endsWith('%%EOF'));
const sx = +pdf.match(/startxref\n(\d+)/)[1]; assert.strictEqual(pdf.slice(sx, sx + 4), 'xref');
const offs = [...pdf.matchAll(/(\d{10}) 00000 n/g)].map(m => +m[1]);
offs.forEach((o, i) => assert.strictEqual(pdf.slice(o, o + 8), (i + 1) + ' 0 obj\n'));
console.log('scale-core: all checks passed');

// saved English warnings shown in Khmer
{
  const f = C.finish(30000, 12500, { empty: 11000, max: 25000 }, 5);
  if (C.warnKm(f.warn.map(x => x.en).join(' | ')) !== f.warn.map(x => x.km).join(' | ')) throw new Error('warnKm');
  console.log('warnKm ok');
}

// A4 Word page shrunk to A5
{
  const a5 = C.toA5('<w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="737" w:gutter="0"/><w:sz w:val="21"/><w:bottom w:val="single" w:sz="8"/><w:tcW w:w="2000" w:type="dxa"/><w:tblW w:w="5000" w:type="pct"/><w:spacing w:line="276" w:lineRule="auto" w:after="120"/><wp:extent cx="1000000" cy="500000"/>');
  assert.strictEqual(a5, '<w:pgSz w:w="8391" w:h="11906"/><w:pgMar w:top="519" w:gutter="0"/><w:sz w:val="15"/><w:bottom w:val="single" w:sz="8"/><w:tcW w:w="1410" w:type="dxa"/><w:tblW w:w="5000" w:type="pct"/><w:spacing w:line="276" w:lineRule="auto" w:after="85"/><wp:extent cx="704771" cy="352385"/>');
  assert.strictEqual(C.paperOf(a5), 'A5');
  assert.strictEqual(C.paperOf('<w:pgSz w:w="11906" w:h="16838"/>'), 'A4');
  assert.ok(Buffer.from(C.jpegPdf(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), 10, 10, 'A5')).toString('latin1').indexOf('/MediaBox [0 0 419.53 595.28]') > 0);
  console.log('toA5 ok');
}
