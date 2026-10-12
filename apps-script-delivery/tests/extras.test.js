// Tests for Extras.gs: proof of delivery, ratings, complaints, customer sites, 3PL companies, delay alerts, KPIs.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { makeEnv } = require('./gas-mock');
const { fixture } = require('./fixture');
const L = require('../Logic.gs');

const as = email => 'google:' + email;
const ADMIN = as('admin@test.kh'), GUARD = as('guard@test.kh'), LOGI = as('logi@test.kh'), WH = as('wh@test.kh'), SUP = as('sup@test.kh');
// Kim's rule (12 Oct 2026): every field is required except the remark. Tests fill the fields they do not test.
function filled(p) {
  p = Object.assign({}, p);
  if (p.code === 1 && !/^TEST-/.test(p.plate || '') && !p.company) p.company = 'TEST 3PL';
  if (p.code === 1 && !('driver' in p)) p.driver = 'TEST driver';
  if (p.code === 2) p.dns = (p.dns || []).map(d => (/^9/.test(d.dn) || d.so ? d : Object.assign({ so: '1069999999' }, d)));
  if (p.code === 6) p = Object.assign({ wh: 'PNP1', kg: 3000, websling: false }, p);
  if (p.code === 9 && !p.receiver) p.receiver = 'TEST receiver';
  return p;
}
let refN = 0;
const ref = () => 'x' + (++refN);
const ok = res => { assert.ok(res.ok, 'expected ok, got ' + JSON.stringify(res.error)); return res.data; };
const rec = (e, token, p) => e.call('record', filled(Object.assign({ ref: ref() }, p)), token);
const step = (e, m) => e.advance((m || 5) * 60000);
const tab = (e, name) => e.ss.getSheetByName(name).rows.slice(1).filter(r => r.some(x => x !== '' && x != null));
const IMG = 'data:image/jpeg;base64,' + Buffer.from('jpg').toString('base64');
const SIG = 'data:image/png;base64,' + Buffer.from('png').toString('base64');

function env() { const e = makeEnv(fixture()); e.run('setup()'); return e; }
function trip(e, plate, dns, extra) {
  const id = ok(rec(e, GUARD, Object.assign({ code: 1, plate, driver: '01.Driver A' }, extra))).tripId;
  step(e); ok(rec(e, LOGI, { code: 2, tripId: id, dns: dns.map(dn => ({ dn })), confirm: ['DN_OPEN_ELSEWHERE', 'DN_NOT_IN_PLAN', 'PLAN_OTHER_TRUCK', 'PLAN_OTHER_TRUCK'] }));
  step(e); ok(rec(e, LOGI, { code: 3, tripId: id }));
  step(e); ok(rec(e, WH, { code: 4, tripId: id }));
  step(e, 20); ok(rec(e, WH, { code: 5, tripId: id }));
  step(e, 30); ok(rec(e, WH, { code: 6, tripId: id, wh: 'PNP1', kg: 3000, websling: false }));
  step(e); ok(rec(e, GUARD, { code: 7, tripId: id }));
  return id;
}

test('setup adds the feature tabs, default settings and one delay timer (run twice)', () => {
  const e = env(); e.run('setup()');
  ['Delivery Proof', 'Customer Ratings', 'Site Ratings', 'Complaints', 'Customer Sites', 'Truck Companies', 'Delivery Settings'].forEach(n => assert.ok(e.ss.getSheetByName(n), n));
  assert.strictEqual(e.triggers.length, 1);
  assert.ok(tab(e, 'Delivery Settings').some(r => r[0] === 'INSIDE_LATE_MIN' && r[1] === 120));
  const b = ok(e.call('boot', {}, LOGI));
  assert.deepStrictEqual(b.settings, { warnMin: 90, lateMin: 120, farKm: 1 });
  assert.strictEqual(b.canKpi, true);
  assert.strictEqual(ok(e.call('boot', {}, GUARD)).canKpi, false);
});

test('Delivered with signature, receiver and several photos: proof row, first photo in Time Log, rating link', () => {
  const e = env();
  const id = trip(e, 'TEST-0001', ['9000000001']);
  step(e, 40);
  const r = ok(rec(e, ADMIN, { code: 9, tripId: id, dns: [{ dn: '9000000001', kg: 1000 }], photos: [IMG, IMG, IMG, IMG, IMG, IMG], signature: SIG, receiver: 'Mr Test', latlong: '11.5,104.9' }));
  assert.strictEqual(e.files.length, 6, '5 photos + signature (6th photo dropped)');
  assert.ok(e.files[5].name.endsWith('.png'));
  const proof = tab(e, 'Delivery Proof');
  assert.strictEqual(proof.length, 1);
  assert.strictEqual(proof[0][3], '9000000001');
  assert.strictEqual(proof[0][4], 'Mr Test');
  assert.strictEqual(proof[0][6].split('\n').length, 5);
  assert.strictEqual(r.rate[0].dn, '9000000001');
  const d = ok(e.call('trip', { tripId: id }, ADMIN));
  assert.strictEqual(d.proof[0].receiver, 'Mr Test');
  assert.ok(d.rate['9000000001']);
  // first delivery with a location sets the customer site
  assert.strictEqual(tab(e, 'Customer Sites')[0][0], '6100000001');
});

test('customer rating link: no sign-in, one rating per DN and trip, low rating alerts Telegram', () => {
  const e = env();
  e.props.TELEGRAM_BOT_TOKEN = 'tok';
  const s = e.ss.getSheetByName('Delivery Settings');
  const row = s.rows.findIndex(r => r[0] === 'TELEGRAM_CHAT_ID');
  s.rows[row][1] = '-100123';
  const id = trip(e, 'TEST-0001', ['9000000001']);
  step(e, 40); const r = ok(rec(e, ADMIN, { code: 9, tripId: id, dns: [{ dn: '9000000001', kg: 1000 }] }));
  const k = r.rate[0].k;
  const bad = e.call('rateInfo', { d: '9000000001', t: id, k: 'nope' }, null);
  assert.ok(!bad.ok && /^LINK/.test(bad.error));
  const info = ok(e.call('rateInfo', { d: '9000000001', t: id, k }, null));
  assert.strictEqual(info.cust, 'TEST Customer A');
  assert.strictEqual(info.rated, false);
  assert.ok(!e.call('rateSave', { d: '9000000001', t: id, k, overall: 0 }, null).ok);
  ok(e.call('rateSave', { d: '9000000001', t: id, k, overall: 2, polite: 3, comment: 'late' }, null));
  const again = e.call('rateSave', { d: '9000000001', t: id, k, overall: 5 }, null);
  assert.ok(!again.ok && /^DONE/.test(again.error));
  const cr = tab(e, 'Customer Ratings');
  assert.strictEqual(cr.length, 1);
  assert.strictEqual(cr[0][4], 'ISI');
  assert.strictEqual(e.telegram.length, 1);
  assert.ok(/2\/5/.test(e.telegram[0].text));
  assert.strictEqual(ok(e.call('dn', { dn: '9000000001' }, ADMIN)).custRatings[0].overall, 2);
});

test('site rating from the driver link after the trip is finished; customer delay needs Logistics to confirm', () => {
  const e = env();
  const id = trip(e, 'TEST-0001', ['9000000001']);
  const k = ok(e.call('trip', { tripId: id }, LOGI)).driverLink;
  step(e, 40); ok(e.call('drvRecord', filled({ t: id, k, code: 9, dns: [{ dn: '9000000001', kg: 1000 }], ref: ref() }), null));
  ok(e.call('drvSiteRate', { t: id, k, dns: ['9000000001'], wait: 'long', help: 'no', access: 'hard', custDelay: true, remark: 'waited 2h' }, null));
  ok(e.call('drvSiteRate', { t: id, k, dns: ['9000000001'], wait: 'short' }, null));   // second time: ignored
  const sr = tab(e, 'Site Ratings');
  assert.strictEqual(sr.length, 1);
  assert.strictEqual(sr[0][9], 'Yes');
  assert.ok(ok(e.call('drvTrip', { t: id, k }, null)).siteRated.includes('9000000001'));
  const d = ok(e.call('dn', { dn: '9000000001' }, LOGI));
  assert.strictEqual(d.siteRatings[0].custDelay, true);
  assert.ok(!e.call('confirmDelay', { row: d.siteRatings[0].row, dn: '9000000001' }, GUARD).ok);
  ok(e.call('confirmDelay', { row: d.siteRatings[0].row, dn: '9000000001' }, LOGI));
  assert.strictEqual(tab(e, 'Site Ratings')[0][11], 'logi@test.kh');
  assert.ok(tab(e, 'Audit Log').some(r => r[2] === 'Customer delay confirmed'));
});

test('complaints: add (numbered per day, 3PL from the truck), resolve with a note, drivers cannot add', () => {
  const e = env();
  const id = trip(e, 'TEST-0001', ['9000000001']);
  step(e, 40); ok(rec(e, ADMIN, { code: 9, tripId: id, dns: [{ dn: '9000000001', kg: 1000 }] }));
  assert.ok(!e.call('complaintAdd', { dn: '9000000001', type: 'driver', detail: 'rude' }, as('norole@test.kh')).ok);
  const a = ok(e.call('complaintAdd', { dn: '9000000001', type: 'driver', detail: 'Driver was rude', source: 'Phone' }, LOGI));
  assert.strictEqual(a.items[0].id, 'C261012-01');
  assert.strictEqual(a.items[0].trip, id);
  assert.strictEqual(a.items[0].co, 'ISI');
  const b = ok(e.call('complaintAdd', { dn: '9000000001', type: 'damage', detail: 'Bent bars' }, SUP));
  assert.strictEqual(b.items[0].id, 'C261012-02');
  assert.ok(!e.call('complaintResolve', { row: b.items[0].row, id: b.items[0].id, resolution: '' }, LOGI).ok);
  const c = ok(e.call('complaintResolve', { row: b.items[0].row, id: b.items[0].id, resolution: 'Replaced 2 bars' }, LOGI));
  assert.strictEqual(c.items.find(x => x.id === 'C261012-02').status, 'Resolved');
  assert.strictEqual(ok(e.call('complaints', { status: 'Open' }, LOGI)).items.length, 1);
  assert.strictEqual(ok(e.call('trip', { tripId: id }, LOGI)).complaints, 2);
});

test('rented truck: company remembered at Gate In and offered in boot', () => {
  const e = env();
  ok(rec(e, GUARD, { code: 1, plate: '2B-5555', driver: 'Rented driver', truckType: 'rented', company: 'Fast Trans' }));
  const b = ok(e.call('boot', {}, GUARD));
  assert.ok(b.companies.includes('Fast Trans'));
  assert.strictEqual(b.plateCo['2B-5555'], 'Fast Trans');
  assert.ok(!('TEST-0001' in b.plateCo), 'ISI trucks are not listed');
});

test('location check: Delivered far from the customer site is flagged on the trip and in Data quality', () => {
  const e = env();
  const t1 = trip(e, 'TEST-0001', ['9000000001']);
  step(e, 40); ok(rec(e, ADMIN, { code: 9, tripId: t1, dns: [{ dn: '9000000001', kg: 1000 }], latlong: '11.5500,104.9200' }));
  step(e, 60);
  const t2 = trip(e, 'TEST-0001', ['9000000002']);
  step(e, 40);
  // Customer B has no site yet: first delivery sets it, then Logistics moves it 5 km away.
  ok(rec(e, ADMIN, { code: 9, tripId: t2, dns: [{ dn: '9000000002', kg: 2000 }], latlong: '11.5600,104.9300' }));
  assert.ok(!e.call('setSite', { custId: '6100000002', latlong: '11.6050,104.9300' }, GUARD).ok);
  ok(e.call('setSite', { custId: '6100000002', latlong: '11.6050,104.9300', reason: 'real gate' }, LOGI));
  const d = ok(e.call('trip', { tripId: t2 }, LOGI));
  const kms = Object.values(d.far);
  assert.strictEqual(kms.length, 1);
  assert.ok(kms[0] > 4.5 && kms[0] < 5.5, String(kms[0]));
  assert.strictEqual(Object.keys(ok(e.call('trip', { tripId: t1 }, LOGI)).far).length, 0);
  assert.ok(ok(e.call('quality', {}, SUP)).issues.some(i => i.type === 'FAR'));
});

test('delay alert: one Telegram message per trip inside longer than the limit', () => {
  const e = env();
  e.props.TELEGRAM_BOT_TOKEN = 'tok';
  const s = e.ss.getSheetByName('Delivery Settings');
  s.rows[s.rows.findIndex(r => r[0] === 'TELEGRAM_CHAT_ID')][1] = '-100123';
  ok(rec(e, GUARD, { code: 1, plate: 'TEST-0001', driver: '01.Driver A' }));
  step(e, 60); e.run('checkDelays()');
  assert.strictEqual(e.telegram.length, 0);
  step(e, 61); e.run('checkDelays()');
  assert.strictEqual(e.telegram.length, 1);
  assert.ok(/TEST-0001/.test(e.telegram[0].text));
  step(e, 10); e.run('checkDelays()');
  assert.strictEqual(e.telegram.length, 1, 'not sent twice');
});

test('KPIs: turnaround segments, OTIF per DN (customer delay excluded), 3PL scorecard; roles', () => {
  const e = env();
  const t1 = trip(e, 'TEST-0001', ['9000000001', '9000000002']);
  step(e, 40); ok(rec(e, ADMIN, { code: 9, tripId: t1, dns: [{ dn: '9000000001', kg: 1000 }] }));
  step(e, 10); ok(rec(e, ADMIN, { code: 9, tripId: t1, dns: [{ dn: '9000000002', kg: 1500, final: false }] }));   // short
  assert.ok(!e.call('kpi', {}, GUARD).ok);
  const k = ok(e.call('kpi', { from: '2026-10-12', to: '2026-10-12', fresh: true }, LOGI));
  assert.strictEqual(k.trips, 1);
  assert.strictEqual(k.avgTotal, 70);   // 5+5+5+20+30+5 minutes
  assert.strictEqual(k.segments.find(s => s.key === 'loading').avg, 30);
  assert.strictEqual(k.otif.due, 2);
  assert.strictEqual(k.otif.ok, 1);
  assert.strictEqual(k.otif.short, 1);
  assert.strictEqual(k.otif.pct, 50);
  assert.strictEqual(k.scorecard[0].co, 'ISI');
  assert.strictEqual(k.scorecard[0].otif, 50);
  assert.strictEqual(k.byWh[0].wh, 'PNP1');
});

test('Logic: OTIF rules, stage minutes and distance', () => {
  const ymd = t => new Date(t).toISOString().slice(0, 10);
  const day = s => Date.parse(s + 'T10:00:00Z');
  const del = (time, extra) => Object.assign({ leg: 'delivered', time }, extra);
  assert.strictEqual(L.otifOf({ status: 'canceled', legs: [] }, '2026-10-12', ymd, false), null);
  assert.strictEqual(L.otifOf({ status: 'delivered', legs: [del(day('2026-10-12'))] }, '2026-10-12', ymd, false).ok, true);
  const late = L.otifOf({ status: 'delivered', legs: [del(day('2026-10-13'))] }, '2026-10-12', ymd, false);
  assert.strictEqual(late.ok, false); assert.strictEqual(late.onTime, false);
  assert.strictEqual(L.otifOf({ status: 'delivered', legs: [del(day('2026-10-13'))] }, '2026-10-12', ymd, true), null, 'confirmed customer delay excluded');
  assert.strictEqual(L.otifOf({ status: 'delivered', legs: [{ leg: 'failed', time: day('2026-10-11') }, del(day('2026-10-12'))] }, '2026-10-12', ymd, false).ok, false, 'a failed leg is not OTIF');
  assert.strictEqual(L.otifOf({ status: 'partial', legs: [del(day('2026-10-12'))] }, '2026-10-12', ymd, false).inFull, false);
  const m = L.stageMinutes([{ code: 1, time: 0 }, { code: 2, time: 600000 }, { code: 7, time: 3600000 }]);
  assert.strictEqual(m.gate_to_bill, 10); assert.strictEqual(m.total, 60); assert.ok(!('loading' in m));
  assert.ok(Math.abs(L.distanceKm('11.55,104.92', '11.55,104.93') - 1.09) < 0.02);
  assert.strictEqual(L.distanceKm('', '11,104'), null);
  assert.strictEqual(L.custIdOf('6100000001-TEST Customer A'), '6100000001');
});

test('every field is required except the remark (server side)', () => {
  const e = env();
  const r1 = e.call('record', { ref: ref(), code: 1, plate: 'TEST-0001' }, GUARD);
  assert.ok(!r1.ok && /^REQUIRED/.test(r1.error), 'driver');
  const r2 = e.call('record', { ref: ref(), code: 1, plate: '2C-1111', driver: 'X' }, GUARD);
  assert.ok(!r2.ok && /company/.test(r2.error), 'company of a rented truck');
  const id = ok(rec(e, GUARD, { code: 1, plate: '2C-1111', driver: 'X', company: 'New 3PL', truckType: 'customer', photos: [IMG, IMG] })).tripId;
  assert.deepStrictEqual(ok(e.call('boot', {}, GUARD)).trucks.find(x => x.plate === '2C-1111'), { plate: '2C-1111', co: 'New 3PL', type: 'customer' });
  assert.strictEqual(tab(e, 'Delivery Proof').filter(r => r[2] === id).length, 1, 'extra truck photos kept');
  step(e); ok(rec(e, LOGI, { code: 2, tripId: id, dns: [{ dn: '9000000001' }], confirm: ['PLAN_OTHER_TRUCK'] }));
  step(e); ok(rec(e, LOGI, { code: 3, tripId: id }));
  step(e); ok(rec(e, WH, { code: 4, tripId: id }));
  step(e); ok(rec(e, WH, { code: 5, tripId: id }));
  const r3 = e.call('record', { ref: ref(), code: 6, tripId: id, wh: 'PNP1', kg: 3000 }, WH);
  assert.ok(!r3.ok && /Websling/.test(r3.error));
  step(e); ok(rec(e, WH, { code: 6, tripId: id }));
  step(e); ok(rec(e, GUARD, { code: 7, tripId: id }));
  const r4 = e.call('record', { ref: ref(), code: 9, tripId: id, dns: [{ dn: '9000000001' }], receiver: 'A' }, ADMIN);
  assert.ok(!r4.ok && /kg/.test(r4.error));
  const r5 = e.call('record', { ref: ref(), code: 9, tripId: id, dns: [{ dn: '9000000001', kg: 1000 }] }, ADMIN);
  assert.ok(!r5.ok && /receiver/.test(r5.error));
});

test('a Truck Companies tab made by the first version gets the new Truck Type column by itself', () => {
  const e = env();
  e.ss.getSheetByName('Truck Companies').rows[0].length = 4;   // header without Truck Type
  ok(rec(e, GUARD, { code: 1, plate: '2D-2222', driver: 'X', company: 'Old 3PL', truckType: 'rented' }));
  const rows = e.ss.getSheetByName('Truck Companies').rows;
  assert.strictEqual(rows[0][4], 'Truck Type');
  assert.strictEqual(rows[1][0], '2D-2222'); assert.strictEqual(rows[1][4], 'rented');
});

test('delete an entry: Supervisor/Admin only, with a reason; the row is kept in Deleted Records and the Audit Log', () => {
  const e = env();
  const id = trip(e, 'TEST-0001', ['9000000001']);
  const d = ok(e.call('trip', { tripId: id }, SUP));
  const out = d.rows.find(r => r.code === 7);
  assert.ok(!e.call('deleteEntry', { row: out.row, key: out.key, reason: 'tapped by mistake' }, GUARD).ok);
  assert.ok(!e.call('deleteEntry', { row: out.row, key: out.key, reason: '' }, SUP).ok);
  assert.ok(/^CHANGED/.test(e.call('deleteEntry', { row: out.row, key: 'other', reason: 'tapped by mistake' }, SUP).error));
  const before = e.ss.getSheetByName('Time Log').rows.length;
  ok(e.call('deleteEntry', { row: out.row, key: out.key, reason: 'tapped by mistake' }, SUP));
  assert.strictEqual(e.ss.getSheetByName('Time Log').rows.length, before - 1);
  const del = tab(e, 'Deleted Records');
  assert.strictEqual(del.length, 1); assert.strictEqual(del[0][1], 'sup@test.kh'); assert.strictEqual(del[0][2], 'tapped by mistake');
  assert.ok(tab(e, 'Audit Log').some(r => r[2] === 'Delete record' && r[3] === out.key));
  const after = ok(e.call('trip', { tripId: id }, ADMIN));
  assert.strictEqual(after.gateOut, null);
  assert.strictEqual(after.stage, 'loaded');
  const tr = e.ss.getSheetByName('Trips').rows.find(r => r[0] === id);
  assert.strictEqual(tr[6], '');
  // deleting every step of a trip removes its Trips line too
  for (const r of after.rows.slice().reverse()) ok(e.call('deleteEntry', { row: r.row, key: r.key, reason: 'test trip' }, ADMIN));
  assert.ok(!e.ss.getSheetByName('Trips').rows.some(r => r[0] === id));
});

test('fast save: the step is saved first, photos and signature follow with attach (also from the driver link)', () => {
  const e = env();
  const id = trip(e, 'TEST-0001', ['9000000001', '9000000002']);
  step(e, 40);
  const r = ok(rec(e, ADMIN, { code: 9, tripId: id, dns: [{ dn: '9000000001', kg: 1000 }], receiver: 'Mr Fast', later: true, photos: [IMG], signature: SIG }));
  assert.strictEqual(e.files.length, 0, 'nothing uploaded while saving the step');
  assert.strictEqual(tab(e, 'Delivery Proof')[0][4], 'Mr Fast');
  const a = { ref: ref(), tripId: id, code: 9, keys: r.keys, photos: [IMG, IMG], signature: SIG };
  ok(e.call('attach', a, ADMIN));
  ok(e.call('attach', a, ADMIN));   // retried: nothing uploaded twice
  assert.strictEqual(e.files.length, 3);
  const proof = tab(e, 'Delivery Proof');
  assert.strictEqual(proof.length, 1);
  assert.strictEqual(proof[0][6].split('\n').length, 2);
  assert.ok(proof[0][5]);
  const d = ok(e.call('trip', { tripId: id }, ADMIN));
  assert.ok(d.rows.find(x => x.key === r.keys[0]).billPhoto || d.proof[0].photos.length === 2);
  // wrong trip or step, and roles
  assert.strictEqual(e.call('attach', { ref: ref(), tripId: id, code: 8, keys: r.keys, photos: [IMG] }, ADMIN).error.split(':')[0], 'NOTFOUND');
  assert.strictEqual(e.call('attach', { ref: ref(), tripId: id, code: 9, keys: r.keys, photos: [IMG] }, GUARD).error.split(':')[0], 'DENIED');
  // driver link
  const k = ok(e.call('trip', { tripId: id }, LOGI)).driverLink;
  step(e); const r2 = ok(e.call('drvRecord', filled({ t: id, k, code: 9, dns: [{ dn: '9000000002', kg: 500 }], later: true, ref: ref() }), null));
  ok(e.call('drvAttach', { t: id, k, ref: ref(), code: 9, keys: r2.keys, photos: [IMG] }, null));
  assert.strictEqual(tab(e, 'Delivery Proof').length, 2);
  assert.ok(!e.call('drvAttach', { t: id, k: 'bad', ref: ref(), code: 9, keys: r2.keys, photos: [IMG] }, null).ok);
});
