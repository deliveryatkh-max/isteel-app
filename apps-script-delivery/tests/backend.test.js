// Backend tests: run with  TZ=Asia/Phnom_Penh node --test apps-script-delivery/tests/
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { makeEnv } = require('./gas-mock');
const { fixture, LOG_HEAD } = require('./fixture');

const as = email => 'google:' + email;
const ADMIN = as('admin@test.kh'), GUARD = as('guard@test.kh'), LOGI = as('logi@test.kh'), WH = as('wh@test.kh'), SUP = as('sup@test.kh');
let refN = 0;
const ref = () => 'r' + (++refN);

function env() { return makeEnv(fixture()); }
function ok(res) { assert.ok(res.ok, 'expected ok, got ' + JSON.stringify(res.error)); return res.data; }
function rec(e, token, p) { return e.call('record', Object.assign({ ref: ref() }, p), token); }
const logRows = e => e.ss.getSheetByName('Time Log').rows.slice(1).filter(r => r.some(x => x !== '' && x != null));
const col = name => LOG_HEAD.indexOf(name);
const tripsRows = e => e.ss.getSheetByName('Trips').rows.slice(1);
const step = (e, m) => e.advance((m || 5) * 60000);

function gateIn(e, plate, extra) {
  const r = ok(rec(e, GUARD, Object.assign({ code: 1, plate, driver: '01.Driver A' }, extra)));
  if (r.needConfirm) return r;
  assert.ok(r.tripId, 'trip id');
  return r;
}
/** Pickup DNs, loading and Gate Out for a trip. */
function loadAndOut(e, tripId, dns) {
  step(e); ok(rec(e, LOGI, { code: 2, tripId, dns: dns.map(dn => ({ dn })), confirm: ['DN_OPEN_ELSEWHERE', 'DN_NOT_IN_PLAN', 'PLAN_OTHER_TRUCK'] }));
  step(e); ok(rec(e, LOGI, { code: 3, tripId }));
  step(e); ok(rec(e, WH, { code: 4, tripId }));
  step(e); ok(rec(e, WH, { code: 5, tripId }));
  step(e); ok(rec(e, WH, { code: 6, tripId, wh: 'PNP1', kg: 3000, websling: false }));
  step(e); return ok(rec(e, GUARD, { code: 7, tripId }));
}

test('setup adds Trips and Audit Log without touching other tabs', () => {
  const e = env();
  const before = JSON.stringify(e.ss.getSheetByName('Time Log').rows);
  e.run('setup()');
  assert.ok(e.ss.getSheetByName('Trips'));
  assert.deepStrictEqual(e.ss.getSheetByName('Trips').rows[0], ['Trip ID', 'Trip Date', 'Truck No.', "Driver's Name", 'Trip Round', 'Gate In Time', 'Gate Out Time', 'Trip Status']);
  assert.ok(e.ss.getSheetByName('Audit Log'));
  assert.strictEqual(JSON.stringify(e.ss.getSheetByName('Time Log').rows), before);
});

test('1, 2, 14: Gate In makes a unique Trip ID; same truck twice a day gets round 2; Cambodia time', () => {
  const e = env(); e.run('setup()');
  const a = gateIn(e, 'TEST-0001');
  assert.strictEqual(a.tripId, '26-10-12-008');   // October already has 26-10-01-007
  assert.strictEqual(a.round, 'ជើងទី​ 1');
  const rows = logRows(e);
  const last = rows[rows.length - 1];
  assert.strictEqual(last[col('Key No.')], '26-10-12-008-01');
  assert.strictEqual(last[col('ស្ថានភាពដឹកជញ្ជូន')], '១.ចូលថ្លឹង');
  assert.strictEqual(last[col('អ្នកកត់ត្រា')], '១.សន្តិសុខ');
  assert.strictEqual(last[col('Master Trip ID')], a.tripId);
  assert.strictEqual(last[col('Trip ID')], a.tripId);
  const t = last[col('Date & Time of Record')];
  assert.strictEqual(t.getHours(), 8);   // 08:00 Cambodia time (UTC+7)
  assert.strictEqual(t.toISOString(), '2026-10-12T01:00:00.000Z');
  assert.strictEqual(tripsRows(e)[0][0], a.tripId);
  assert.strictEqual(tripsRows(e)[0][7], 'រង់ចាំដំណើរការបន្ទាប់');

  // Second trip for the same truck: the first is still open, so the guard confirms, then a new ID and round 2.
  step(e, 30);
  const warn = ok(rec(e, GUARD, { code: 1, plate: 'TEST-0001' }));
  assert.strictEqual(warn.needConfirm[0].code, 'OPEN_PREV_TRIP');
  const b = ok(rec(e, GUARD, { code: 1, plate: 'TEST-0001', confirm: ['OPEN_PREV_TRIP'] }));
  assert.strictEqual(b.tripId, '26-10-12-009');
  assert.strictEqual(b.round, 'ជើងទី​ 2');
  assert.notStrictEqual(a.tripId, b.tripId);
});

test('Trip ID keeps counting through the month after old trips', () => {
  const e = env(); e.run('setup()');
  // the fixture already has 26-10-01-007 from AppSheet
  assert.strictEqual(gateIn(e, 'TEST-0002').tripId, '26-10-12-008');
});

test('3, 4, 5, 11: every event is its own row on the right trip; Gate Out fills Trips', () => {
  const e = env(); e.run('setup()');
  const a = gateIn(e, 'TEST-0001');
  step(e, 2); gateIn(e, 'TEST-0002');   // another truck in between must not mix in
  const before = logRows(e).length;
  loadAndOut(e, a.tripId, ['9000000001', '9000000002']);
  const rows = logRows(e).slice(before);
  // pickup = 2 rows (one per DN), then depart, arrive WH, start, end, gate out = 7 rows
  assert.strictEqual(rows.length, 7);
  rows.forEach(r => assert.strictEqual(r[col('Master Trip ID')], a.tripId));
  rows.forEach(r => assert.strictEqual(r[col('ផ្លាកលេខឡាន')], 'TEST-0001'));
  const keys = logRows(e).map(r => r[0]).filter(k => String(k).startsWith(a.tripId + '-'));
  assert.strictEqual(new Set(keys).size, keys.length, 'Key No. unique');
  const pick = rows.filter(r => r[col('ស្ថានភាពដឹកជញ្ជូន')] === '២.ដល់កន្លែងចែកបុង');
  assert.deepStrictEqual(pick.map(r => r[col('លេខដឹកជញ្ជូន (DN#)')]), ['9000000001', '9000000002']);
  assert.strictEqual(pick[0][col('អតិថិជន')], '6100000001-TEST Customer A');
  assert.strictEqual(pick[0][col('លេខបញ្ជាទិញ (SO)')], '1060000001');
  const end = rows.find(r => r[col('ស្ថានភាពដឹកជញ្ជូន')] === '៦.ឡើងទំនិញ រួចរាល់');
  assert.strictEqual(end[col('ឃ្លាំង')], 'PNP1');
  assert.strictEqual(end[col('ប្រើ Websling?')], 'មិនប្រើ');
  const trip = tripsRows(e).find(r => r[0] === a.tripId);
  assert.ok(trip[6] instanceof Date, 'Gate Out Time filled');
  assert.strictEqual(trip[7], 'កំពុងដឹកជញ្ជូន');
  const other = tripsRows(e).find(r => r[0] !== a.tripId);
  assert.strictEqual(other[6], '', 'other truck untouched');
});

test('6, 7, 8, 9: split DN over two trips (Kim example), customer stops, statuses', () => {
  const e = env(); e.run('setup()');
  const t1 = gateIn(e, 'TEST-0001').tripId;
  loadAndOut(e, t1, ['9000000001', '9000000002']);
  // Stop 1: customer A gets DN-1 in full (1000 kg)
  step(e, 30); ok(rec(e, ADMIN, { code: 8, tripId: t1, dns: [{ dn: '9000000001' }] }));
  let d = ok(e.call('trip', { tripId: t1 }, ADMIN));
  assert.strictEqual(d.stage, 'at_customer');
  step(e); ok(rec(e, ADMIN, { code: 9, tripId: t1, dns: [{ dn: '9000000001', kg: 1000 }] }));
  d = ok(e.call('trip', { tripId: t1 }, ADMIN));
  assert.strictEqual(d.stage, 'on_delivery', 'trip not complete: DN-2 still open');
  assert.strictEqual(d.dnInfo['9000000001'].status, 'delivered');
  assert.strictEqual(d.dnInfo['9000000002'].status, 'in_progress', 'DN-2 must not be delivered on trip 1');
  // DN-2: only 800 of 2000 kg delivered on trip 1
  step(e); ok(rec(e, ADMIN, { code: 8, tripId: t1, dns: [{ dn: '9000000002' }] }));
  step(e); ok(rec(e, ADMIN, { code: 9, tripId: t1, dns: [{ dn: '9000000002', kg: 800 }] }));
  d = ok(e.call('trip', { tripId: t1 }, ADMIN));
  assert.strictEqual(d.stage, 'completed', 'every DN on trip 1 has an end state');
  assert.strictEqual(d.dnInfo['9000000002'].status, 'partial');
  assert.strictEqual(tripsRows(e).find(r => r[0] === t1)[7], 'បានបញ្ចប់');

  // Truck comes back: new trip, DN-2 again (the rest), on the same truck
  step(e, 60);
  const t2 = gateIn(e, 'TEST-0001').tripId;
  assert.notStrictEqual(t2, t1);
  step(e); ok(rec(e, LOGI, { code: 2, tripId: t2, dns: [{ dn: '9000000002' }] }));
  loadRest(e, t2);
  step(e, 20); ok(rec(e, ADMIN, { code: 8, tripId: t2, dns: [{ dn: '9000000002' }] }));
  step(e); ok(rec(e, ADMIN, { code: 9, tripId: t2, dns: [{ dn: '9000000002', kg: 1200 }] }));
  const dn = ok(e.call('dn', { dn: '9000000002' }, ADMIN));
  assert.strictEqual(dn.status, 'delivered');
  assert.strictEqual(dn.kg, 2000, 'counted once per delivery, not twice');
  assert.strictEqual(dn.legs.length, 2);
  assert.deepStrictEqual(dn.legs.map(l => l.tripId).sort(), [t1, t2].sort());
  assert.strictEqual(ok(e.call('trip', { tripId: t2 }, ADMIN)).stage, 'completed');

  // 10: Status of Delivery stays blank on every row
  logRows(e).forEach(r => assert.ok(r[col('Status of Delivery')] === '' || r[col('Status of Delivery')] == null));
});

function loadRest(e, tripId) {
  step(e); ok(rec(e, LOGI, { code: 3, tripId }));
  step(e); ok(rec(e, WH, { code: 4, tripId }));
  step(e); ok(rec(e, WH, { code: 5, tripId }));
  step(e); ok(rec(e, WH, { code: 6, tripId }));
  step(e); ok(rec(e, GUARD, { code: 7, tripId }));
}

test('Kim example: DN-002 still pending on trip 1, delivered on trip 2 by the same truck', () => {
  const e = env(); e.run('setup()');
  const t1 = gateIn(e, 'TEST-0001').tripId;
  loadAndOut(e, t1, ['9000000001', '9000000002']);
  step(e, 30); ok(rec(e, ADMIN, { code: 9, tripId: t1, dns: [{ dn: '9000000001', kg: 1000 }], confirm: [] }));
  // truck returns with DN-002 still on board
  step(e, 60);
  const warn = ok(rec(e, GUARD, { code: 1, plate: 'TEST-0001' }));
  assert.strictEqual(warn.needConfirm[0].code, 'OPEN_PREV_TRIP');
  assert.strictEqual(warn.needConfirm[0].tripId, t1);
  const t2 = ok(rec(e, GUARD, { code: 1, plate: 'TEST-0001', confirm: ['OPEN_PREV_TRIP'] })).tripId;
  step(e);
  const w2 = ok(rec(e, LOGI, { code: 2, tripId: t2, dns: [{ dn: '9000000002' }] }));
  assert.strictEqual(w2.needConfirm[0].code, 'DN_OPEN_ELSEWHERE', 'warns that DN-002 is open on trip 1');
  ok(rec(e, LOGI, { code: 2, tripId: t2, dns: [{ dn: '9000000002' }], confirm: ['DN_OPEN_ELSEWHERE'] }));
  let one = ok(e.call('trip', { tripId: t1 }, ADMIN));
  assert.strictEqual(one.dns.find(x => x.dn === '9000000002').leg, 'picked', 'not delivered on trip 1');
  assert.strictEqual(one.stage, 'on_delivery');
  loadRest(e, t2);
  step(e, 20); ok(rec(e, ADMIN, { code: 9, tripId: t2, dns: [{ dn: '9000000002', kg: 2000 }] }));
  one = ok(e.call('trip', { tripId: t1 }, ADMIN));
  assert.strictEqual(one.dns.find(x => x.dn === '9000000002').leg, 'moved', 'shown as delivered on another trip');
  assert.strictEqual(one.stage, 'completed');
  assert.strictEqual(tripsRows(e).find(r => r[0] === t1)[7], 'បានបញ្ចប់', 'Trips status of trip 1 updated');
  // the rows for trip 1 never say DN-002 was delivered
  const t1Delivered = logRows(e).filter(r => r[col('Master Trip ID')] === t1 && r[col('ស្ថានភាពដឹកជញ្ជូន')] === '៩.បានប្រគល់ទំនិញ').map(r => r[col('លេខដឹកជញ្ជូន (DN#)')]);
  assert.deepStrictEqual(t1Delivered, ['9000000001']);
  const ops = ok(e.call('ops', {}, ADMIN));
  assert.ok(ops.trips.find(t => t.id === t2).stage === 'completed');
});

test('12: repeated submissions do not create duplicates', () => {
  const e = env(); e.run('setup()');
  const r1 = rec(e, GUARD, { code: 1, plate: 'TEST-0001', ref: 'same-ref' });
  const n = logRows(e).length;
  const r2 = e.call('record', { code: 1, plate: 'TEST-0001', ref: 'same-ref' }, GUARD);
  assert.deepStrictEqual(ok(r2), ok(r1), 'network retry gets the same answer');
  assert.strictEqual(logRows(e).length, n);
  // double tap without the same ref: refused
  const r3 = rec(e, GUARD, { code: 1, plate: 'TEST-0001' });
  assert.ok(!r3.ok && /^DUPLICATE/.test(r3.error));
  const tripId = ok(r1).tripId;
  step(e, 1); ok(rec(e, WH, { code: 4, tripId, confirm: ['ORDER'] }));
  const r4 = rec(e, WH, { code: 4, tripId, confirm: ['ORDER'] });
  assert.ok(!r4.ok && /^DUPLICATE/.test(r4.error));
  assert.strictEqual(logRows(e).filter(r => r[col('Master Trip ID')] === tripId).length, 2);
});

test('13: wrong associations are refused or need confirmation', () => {
  const e = env(); e.run('setup()');
  const t1 = gateIn(e, 'TEST-0001').tripId;
  // Delivered for a DN that is not on the trip
  let r = rec(e, ADMIN, { code: 9, tripId: t1, dns: [{ dn: '9000000001' }] });
  assert.ok(!r.ok && /^DN_NOT_ON_TRIP/.test(r.error));
  // Trip of another truck
  r = rec(e, ADMIN, { code: 4, tripId: t1, plate: 'TEST-0002' });
  assert.ok(!r.ok && /^WRONG_TRIP/.test(r.error));
  // DN not in Delivery Plan needs confirmation, and a customer
  step(e);
  r = ok(rec(e, LOGI, { code: 2, tripId: t1, dns: [{ dn: '5000999999', custId: '6100000002', custName: 'TEST Customer B' }] }));
  assert.strictEqual(r.needConfirm[0].code, 'DN_NOT_IN_PLAN');
  // Unknown trip
  r = rec(e, ADMIN, { code: 3, tripId: 'nope' });
  assert.ok(!r.ok && /^NOTFOUND/.test(r.error));
  // Events after the trip is finished
  ok(rec(e, ADMIN, { code: 10, tripId: t1 }));
  r = rec(e, ADMIN, { code: 3, tripId: t1 });
  assert.ok(!r.ok && /^TRIP_CLOSED/.test(r.error));
  // Pickup after Gate Out
  const t2 = gateIn(e, 'TEST-0002').tripId;
  step(e); ok(rec(e, GUARD, { code: 7, tripId: t2, confirm: ['NO_DN', 'ORDER'] }));
  r = rec(e, LOGI, { code: 2, tripId: t2, dns: [{ dn: '9000000001' }] });
  assert.ok(!r.ok && /^AFTER_GATE_OUT/.test(r.error));
});

test('roles: each role records only its own events; no role = view only', () => {
  const e = env(); e.run('setup()');
  const t1 = gateIn(e, 'TEST-0001').tripId;
  let r = rec(e, GUARD, { code: 5, tripId: t1 });
  assert.ok(!r.ok && /^DENIED/.test(r.error));
  r = rec(e, as('norole@test.kh'), { code: 1, plate: 'TEST-0002' });
  assert.ok(!r.ok && /^DENIED/.test(r.error));
  r = e.call('boot', {}, as('stranger@test.kh'));
  assert.ok(!r.ok && /^NOACCESS/.test(r.error));
  const b = ok(e.call('boot', {}, WH));
  assert.deepStrictEqual(b.events.filter(x => x.can).map(x => x.code), [4, 5, 6]);
  assert.ok(!b.canCorrect);
  assert.ok(ok(e.call('boot', {}, SUP)).canCorrect);
  r = e.call('users', {}, SUP);
  assert.ok(!r.ok && /^DENIED/.test(r.error));
  assert.ok(!JSON.stringify(ok(e.call('boot', {}, ADMIN))).includes('secret1'), 'warehouse passwords never sent');
});

test('sessions: the Google sign-in is swapped for a 30-day session that the other apps share', () => {
  const e = env(); e.run('setup()');
  const res = e.call('boot', {}, ADMIN);
  assert.ok(res.session && res.session.split('.').length === 3);
  const again = e.call('boot', {}, res.session);
  assert.ok(again.ok);
  const bad = e.call('boot', {}, res.session.slice(0, -2) + 'xx');
  assert.ok(!bad.ok && /^AUTH/.test(bad.error));
});

test('driver link: signed per trip, only delivery steps, closes with the trip', () => {
  const e = env(); e.run('setup()');
  const t1 = gateIn(e, 'TEST-0001').tripId;
  loadAndOut(e, t1, ['9000000001']);
  const k = ok(e.call('trip', { tripId: t1 }, LOGI)).driverLink;
  assert.ok(k);
  const bad = e.call('drvTrip', { t: t1, k: 'wrong' }, null);
  assert.ok(!bad.ok && /^LINK/.test(bad.error));
  const v = ok(e.call('drvTrip', { t: t1, k }, null));
  assert.strictEqual(v.trip.dns[0].dn, '9000000001');
  const no = e.call('drvRecord', { t: t1, k, code: 4, ref: ref() }, null);
  assert.ok(!no.ok && /^DENIED/.test(no.error));
  step(e, 30); ok(e.call('drvRecord', { t: t1, k, code: 8, dns: [{ dn: '9000000001' }], ref: ref() }, null));
  step(e); ok(e.call('drvRecord', { t: t1, k, code: 9, dns: [{ dn: '9000000001', kg: 1000 }], photo: 'data:image/jpeg;base64,' + Buffer.from('jpg').toString('base64'), ref: ref() }, null));
  const last = logRows(e).pop();
  assert.strictEqual(last[col('អ្នកកត់ត្រា')], '៤.ឡាន ISI');
  assert.strictEqual(last[col('User')], 'driver-link');
  assert.ok(String(last[col('រូបថតបុង')]).startsWith('https://drive.google.com/'));
  const closed = e.call('drvTrip', { t: t1, k }, null);
  assert.ok(!closed.ok && /^LINK_CLOSED/.test(closed.error));
});

test('no plan weight: Delivered needs the "whole DN" tick, else Partially Delivered', () => {
  const e = env(); e.run('setup()');
  const t1 = gateIn(e, 'TEST-0001').tripId;
  step(e); ok(rec(e, LOGI, { code: 2, tripId: t1, dns: [{ dn: '5000111111', custName: 'TEST Customer B', custId: '6100000002' }], confirm: ['DN_NOT_IN_PLAN'] }));
  loadRest(e, t1);
  step(e, 30); ok(rec(e, ADMIN, { code: 9, tripId: t1, dns: [{ dn: '5000111111', final: false }] }));
  assert.strictEqual(ok(e.call('dn', { dn: '5000111111' }, ADMIN)).status, 'partial');
  const row = logRows(e).pop();
  assert.strictEqual(row[col('Form Mode')], 'Partial');
});

test('failed delivery stays open for a later trip; canceled trip', () => {
  const e = env(); e.run('setup()');
  const t1 = gateIn(e, 'TEST-0001').tripId;
  loadAndOut(e, t1, ['9000000001']);
  step(e, 30); ok(rec(e, ADMIN, { code: 11, tripId: t1, dns: [{ dn: '9000000001' }], remark: 'customer closed' }));
  assert.strictEqual(ok(e.call('trip', { tripId: t1 }, ADMIN)).stage, 'completed');
  assert.strictEqual(ok(e.call('dn', { dn: '9000000001' }, ADMIN)).status, 'failed');
  const t2 = gateIn(e, 'TEST-0001').tripId;
  step(e); ok(rec(e, LOGI, { code: 2, tripId: t2, dns: [{ dn: '9000000001' }] }));
  assert.strictEqual(ok(e.call('dn', { dn: '9000000001' }, ADMIN)).status, 'in_progress');
  ok(rec(e, ADMIN, { code: 10, tripId: t2, remark: 'truck broke' }));
  assert.strictEqual(ok(e.call('trip', { tripId: t2 }, ADMIN)).stage, 'canceled');
});

test('time correction: Supervisor only, with an Audit Log row', () => {
  const e = env(); e.run('setup()');
  const t1 = gateIn(e, 'TEST-0001').tripId;
  const d = ok(e.call('trip', { tripId: t1 }, SUP));
  const row = d.rows[0];
  const newTime = Date.parse('2026-10-12T07:45:00+07:00');
  let r = e.call('correct', { row: row.row, key: row.key, time: newTime, reason: 'guard was late' }, GUARD);
  assert.ok(!r.ok && /^DENIED/.test(r.error));
  r = e.call('correct', { row: row.row, key: 'other', time: newTime, reason: 'x yz' }, SUP);
  assert.ok(!r.ok && /^CHANGED/.test(r.error));
  ok(e.call('correct', { row: row.row, key: row.key, time: newTime, reason: 'guard was late' }, SUP));
  const audit = e.ss.getSheetByName('Audit Log').rows;
  assert.strictEqual(audit.length, 3);   // header + Time Log + Trips
  assert.strictEqual(audit[1][1], 'sup@test.kh');
  assert.strictEqual(audit[1][6], '2026-10-12 08:00:00');
  assert.strictEqual(audit[1][7], '2026-10-12 07:45:00');
  assert.strictEqual(tripsRows(e)[0][5].getTime(), newTime);
});

test('16: Gate Ins in a row never share a Trip ID', () => {
  const e = env(); e.run('setup()');
  const ids = [];
  for (let i = 0; i < 12; i++) { e.advance(1000); ids.push(gateIn(e, 'TRK-' + i).tripId); }
  assert.strictEqual(new Set(ids).size, 12);
});

test('late phone sends use the phone time; fresh sends use the server time', () => {
  const e = env(); e.run('setup()');
  const taken = e.now() - 10 * 60000;
  const r = ok(rec(e, GUARD, { code: 1, plate: 'TEST-0001', takenAt: taken }));
  assert.strictEqual(r.time, taken);
  const r2 = ok(rec(e, GUARD, { code: 1, plate: 'TEST-0002', takenAt: e.now() + 3600000 }));
  assert.strictEqual(r2.time, e.now(), 'a phone clock in the future is ignored');
});

test('search, history and quality reports', () => {
  const e = env(); e.run('setup()');
  const t1 = gateIn(e, 'TEST-0001').tripId;
  loadAndOut(e, t1, ['9000000001', '9000000002']);
  step(e, 30); ok(rec(e, ADMIN, { code: 9, tripId: t1, dns: [{ dn: '9000000001', kg: 1000 }] }));
  const s = ok(e.call('search', { q: 'customer a' }, ADMIN));
  assert.deepStrictEqual(s.items.map(x => x.dn), ['9000000001']);
  assert.strictEqual(s.items[0].status, 'delivered');
  assert.strictEqual(ok(e.call('search', { status: 'in_progress' }, ADMIN)).items[0].dn, '9000000002');
  assert.strictEqual(ok(e.call('search', { q: t1 }, ADMIN)).total, 2);
  const h = ok(e.call('history', { from: '2026-09-01', to: '2026-10-31' }, ADMIN));
  assert.ok(h.items.find(t => t.id === '26-09-01-001' && t.legacy));
  const q = ok(e.call('quality', {}, SUP));
  assert.ok(Array.isArray(q.issues));
});

test('Users screen: Admin adds and changes roles, with audit', () => {
  const e = env(); e.run('setup()');
  ok(e.call('setUser', { email: 'new@test.kh', name: 'New', role: 'Security' }, ADMIN));
  const u = ok(e.call('users', {}, ADMIN)).users.find(x => x.email === 'new@test.kh');
  assert.strictEqual(u.role, 'Security');
  ok(e.call('setUser', { email: 'new@test.kh', role: 'Warehouse' }, ADMIN));
  assert.strictEqual(ok(e.call('users', {}, ADMIN)).users.find(x => x.email === 'new@test.kh').role, 'Warehouse');
  assert.strictEqual(e.ss.getSheetByName('Audit Log').rows.length, 3);
  const r = e.call('setUser', { email: 'admin@test.kh', role: 'Security' }, ADMIN);
  assert.ok(!r.ok);
});

test('plan weight known but no kg typed: the "whole DN" tick finishes the DN', () => {
  const e = env(); e.run('setup()');
  const t1 = gateIn(e, 'TEST-0001').tripId;
  loadAndOut(e, t1, ['9000000001']);
  step(e, 30); ok(rec(e, ADMIN, { code: 9, tripId: t1, dns: [{ dn: '9000000001', final: true }] }));
  const d = ok(e.call('trip', { tripId: t1 }, ADMIN));
  assert.strictEqual(d.dnInfo['9000000001'].status, 'delivered');
  assert.strictEqual(d.stage, 'completed');
});
