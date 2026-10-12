/**
 * Delivery Journey: business rules with no Google services in them.
 * The same file runs inside Apps Script and in Node tests (delivery-src/test), so keep it plain JavaScript.
 *
 * Words used here:
 *   trip   = one truck journey, started by a Gate In, identified by its Trip ID ("Master Trip ID" in Time Log)
 *   DN     = one delivery note; it can ride on several trips and trucks
 *   row    = one Time Log record = one event (Key No. is unique on every row this app writes)
 */

// The journey events exactly as the Type Record sheet and Time Log spell them (the ៤ event has a double ់ in
// the real data, kept on purpose). scope: trip = one row per event; dn = one row per DN it is about.
const EVENTS = [
  { code: 1, key: 'gate_in', kh: '១.ចូលថ្លឹង', en: 'Gate In', scope: 'trip' },
  { code: 2, key: 'pickup_arrive', kh: '២.ដល់កន្លែងចែកបុង', en: 'Arrival-Pickup DN', scope: 'dn' },
  { code: 3, key: 'pickup_depart', kh: '៣.ចេញពីកន្លែងចែកបុង', en: 'Departure-Pickup DN', scope: 'trip' },
  { code: 4, key: 'wh_arrive', kh: '៤.ដល់់ឃ្លាំង', en: 'Arrival-Loading Area', scope: 'trip' },
  { code: 5, key: 'load_start', kh: '៥.ចាប់ផ្តើម ឡើងទំនិញ', en: 'Start Loading', scope: 'trip' },
  { code: 6, key: 'load_end', kh: '៦.ឡើងទំនិញ រួចរាល់', en: 'End Loading', scope: 'trip' },
  { code: 7, key: 'gate_out', kh: '៧.ចេញពីកន្លែងថ្លឹង', en: 'Gate Out', scope: 'trip' },
  { code: 8, key: 'arrive_dest', kh: '៨.មកដល់ទីតាំងទំលាក់', en: 'Arrival Destination', scope: 'dn' },
  { code: 9, key: 'delivered', kh: '៩.បានប្រគល់ទំនិញ', en: 'Delivered', scope: 'dn' },
  { code: 10, key: 'canceled', kh: 'x.លុបចោលការដឹកជញ្ជូន', en: 'Canceled', scope: 'any' },
  { code: 11, key: 'failed', kh: 'x.ការដឹកជញ្ជូនបរាជ័យ', en: 'Delivery Failed', scope: 'dn' },
];
const EV = {};
EVENTS.forEach(e => { EV[e.key] = e; EV[e.code] = e; });

/** Event code from the Khmer text in a Time Log row ('' or unknown text = 0). Tolerates the ់ typo either way. */
function eventCode(text) {
  const s = String(text == null ? '' : text).trim();
  if (!s) return 0;
  for (const e of EVENTS) if (e.kh === s) return e.code;
  const loose = s.replace(/់+/g, '់').replace(/\s+/g, '');
  for (const e of EVENTS) if (e.kh.replace(/់+/g, '់').replace(/\s+/g, '') === loose) return e.code;
  return 0;
}

// Truck journey status, written in Khmer to Trips > Trip Status (Kim, 11 Oct 2026). en is for the English screen.
const STAGES = {
  waiting: { kh: 'រង់ចាំដំណើរការបន្ទាប់', en: 'Waiting for next process' },
  at_pickup: { kh: 'នៅកន្លែងចែកបុង', en: 'At Pickup' },
  departed_pickup: { kh: 'ចេញពីកន្លែងចែកបុង', en: 'Departed Pickup' },
  at_loading: { kh: 'នៅកន្លែងឡើងទំនិញ', en: 'At Loading Area' },
  loading: { kh: 'កំពុងឡើងទំនិញ', en: 'Loading' },
  loaded: { kh: 'ឡើងទំនិញរួចរាល់', en: 'Loading Completed' },
  on_delivery: { kh: 'កំពុងដឹកជញ្ជូន', en: 'On Delivery' },
  at_customer: { kh: 'នៅទីតាំងអតិថិជន', en: 'At Customer' },
  completed: { kh: 'បានបញ្ចប់', en: 'Completed' },
  canceled: { kh: 'បានលុបចោល', en: 'Canceled' },
};
const STAGE_BY_EVENT = { 1: 'waiting', 2: 'at_pickup', 3: 'departed_pickup', 4: 'at_loading', 5: 'loading', 6: 'loaded', 7: 'on_delivery' };

// Status of one DN, calculated (the "Status of Delivery" column stays blank on purpose).
const DN_STATUS = {
  not_started: { kh: 'មិនទាន់ចាប់ផ្តើម', en: 'Not Started' },
  in_progress: { kh: 'កំពុងដំណើរការ', en: 'In Progress' },
  partial: { kh: 'បានប្រគល់ខ្លះ', en: 'Partially Delivered' },
  delivered: { kh: 'បានប្រគល់', en: 'Delivered' },
  failed: { kh: 'ប្រគល់មិនបាន', en: 'Delivery Failed' },
  canceled: { kh: 'បានលុបចោល', en: 'Canceled' },
};

// What a DN is doing on one trip.
const LEG = {
  picked: { kh: 'បានយកបុង', en: 'Picked up' },
  at_customer: { kh: 'នៅទីតាំងអតិថិជន', en: 'At customer' },
  delivered: { kh: 'បានប្រគល់', en: 'Delivered' },
  failed: { kh: 'ប្រគល់មិនបាន', en: 'Failed' },
  canceled: { kh: 'បានលុបចោល', en: 'Canceled' },
  moved: { kh: 'ប្រគល់តាមជើងផ្សេង', en: 'Delivered on another trip' },
};
const LEG_DONE = { delivered: 1, failed: 1, canceled: 1, moved: 1 };

const ROUND_WORD = 'ជើងទី​ ';   // as in Delivery Plan and Time Log: "ជើងទី​ 1"
const roundText = n => ROUND_WORD + n;
const roundNumber = s => { const m = String(s || '').match(/(\d+)\s*$/); return m ? +m[1] : 0; };

const normDn = v => String(v == null ? '' : v).replace(/\.0+$/, '').replace(/\s+/g, '').toUpperCase();
const normPlate = v => String(v == null ? '' : v).trim().toUpperCase().replace(/\s+/g, '');

/**
 * Builds the state of one trip from its Time Log rows.
 * row = { key, code, dn, cust, time (ms), kg, mode ('Final'|'Partial'|''), plate, driver }
 * doneElsewhere = { dn: true } for DNs already fully delivered (on any trip): a DN still open on this trip
 * but delivered by another truck or round shows as "Delivered on another trip", so this trip can finish
 * without ever saying the DN was delivered here.
 */
function tripState(rows, doneElsewhere) {
  rows = rows.slice().sort((a, b) => a.time - b.time || a.seq - b.seq);
  const out = { gateIn: null, gateOut: null, canceled: false, dns: {}, last: null, lastProgress: 0, events: rows.length };
  rows.forEach(r => {
    if (r.code === 1 && out.gateIn == null) out.gateIn = r.time;
    if (r.code === 7 && out.gateOut == null) out.gateOut = r.time;
    if (r.code === 10 && !r.dn) out.canceled = true;
    if (r.code >= 1 && r.code <= 7 && r.code !== 2) out.lastProgress = Math.max(out.lastProgress, r.code);
    if (r.code === 2) out.lastProgress = Math.max(out.lastProgress, 2);
    if (r.dn) {
      const d = out.dns[r.dn] || (out.dns[r.dn] = { dn: r.dn, cust: '', leg: 'picked', kg: 0, final: false, time: r.time });
      if (r.cust) d.cust = r.cust;
      if (r.code === 8 && !LEG_DONE[d.leg]) d.leg = 'at_customer';
      if (r.code === 9) { d.leg = 'delivered'; d.kg += Number(r.kg) || 0; if (r.mode === 'Final') d.final = true; d.time = r.time; }
      if (r.code === 11) { d.leg = 'failed'; d.time = r.time; }
      if (r.code === 10) { d.leg = 'canceled'; d.time = r.time; }
    }
    out.last = r;
  });
  const dnList = Object.keys(out.dns).map(k => out.dns[k]);
  dnList.forEach(d => { if (!LEG_DONE[d.leg] && doneElsewhere && doneElsewhere[d.dn]) d.leg = 'moved'; });
  const open = dnList.filter(d => !LEG_DONE[d.leg]);
  let stage;
  if (out.canceled) stage = 'canceled';
  else if (out.gateOut != null && dnList.length && !open.length) stage = 'completed';
  else if (open.some(d => d.leg === 'at_customer')) stage = 'at_customer';
  else if (out.gateOut != null) stage = 'on_delivery';
  else stage = STAGE_BY_EVENT[out.lastProgress] || 'waiting';
  out.stage = stage;
  out.closed = stage === 'completed' || stage === 'canceled';
  out.dnList = dnList;
  out.openDns = open.map(d => d.dn);
  return out;
}

/**
 * Overall status of one DN from every trip it rode on.
 * legs = [{ tripId, leg, kg, final, time }], planKg = weight in Delivery Plan (0 = unknown).
 * Delivered when the delivered kg reach the plan weight, or when a Delivered step without a weight was marked
 * "the whole DN / last part" (Form Mode = Final). Anything less is Partially Delivered.
 */
function dnStatus(legs, planKg) {
  planKg = Number(planKg) || 0;
  if (!legs.length) return { status: 'not_started', kg: 0, planKg: planKg, openTrips: [] };
  const delivered = legs.filter(l => l.leg === 'delivered');
  const kg = delivered.reduce((s, l) => s + (Number(l.kg) || 0), 0);
  const openTrips = legs.filter(l => !LEG_DONE[l.leg]).map(l => l.tripId);
  let status;
  if (delivered.length) {
    // Weight decides when it is known (plan weight and delivered kg typed); a "whole DN / last part" tick
    // without a weight finishes the DN on its own (Kim's answer C).
    const tickOnly = delivered.some(l => l.final && !(planKg > 0 && Number(l.kg) > 0));
    const full = tickOnly || (planKg > 0 ? kg >= planKg * 0.995 : false);
    status = full ? 'delivered' : 'partial';
  } else if (openTrips.length) status = 'in_progress';
  else {
    const latest = legs.slice().sort((a, b) => b.time - a.time)[0];
    status = latest.leg === 'failed' ? 'failed' : legs.every(l => l.leg === 'canceled') ? 'canceled' : 'failed';
  }
  return { status: status, kg: kg, planKg: planKg, openTrips: openTrips };
}

/**
 * Next Trip ID for a date: yy-mm-dd-NNN, where NNN keeps counting through the month like the old trips
 * (26-09-01-001 … 26-09-22-502), so a new ID can never repeat an old one.
 */
function nextTripId(ymd, existingIds) {
  const prefix = ymd.slice(2, 4) + '-' + ymd.slice(5, 7) + '-';
  let max = 0;
  existingIds.forEach(id => {
    const m = String(id || '').match(/^(\d\d-\d\d)-\d\d-(\d+)$/);
    if (m && m[1] + '-' === prefix) max = Math.max(max, +m[2]);
  });
  return prefix + ymd.slice(8, 10) + '-' + String(max + 1).padStart(3, '0');
}

/** Key No. for a new row: Trip ID + running number inside the trip (26-10-11-001-03). */
function nextKey(tripId, existingKeys) {
  let max = 0;
  const re = new RegExp('^' + String(tripId).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '-(\\d+)$');
  existingKeys.forEach(k => { const m = String(k || '').match(re); if (m) max = Math.max(max, +m[1]); });
  return tripId + '-' + String(max + 1).padStart(2, '0');
}

/**
 * Which recorder groups (Type Record "Allowed Recorders", e.g. "១.សន្តិសុខ|៤.ឡាន ISI") a User Manager role covers.
 * Supervisor and Admin may record every event.
 */
const ROLE_GROUPS = {
  security: ['១'], logistics: ['២'], lt: ['២'], warehouse: ['៣'], driver: ['៤', '៥', '៦'],
};
function roleKey(role) {
  const r = String(role || '').trim().toLowerCase();
  if (!r) return '';
  if (/admin/.test(r)) return 'admin';
  if (/super|manager|lead/.test(r)) return 'supervisor';
  if (/secur|សន្តិសុខ/.test(r)) return 'security';
  if (/^lt$|logist|ភស្តុភារ/.test(r)) return 'logistics';
  if (/wareh|ឃ្លាំង/.test(r)) return 'warehouse';
  if (/driver|តៃកុង|ឡាន/.test(r)) return 'driver';
  return '';
}
function canRecord(role, allowedText) {
  const k = roleKey(role);
  if (k === 'admin' || k === 'supervisor') return true;
  const groups = ROLE_GROUPS[k] || [];
  const allowed = String(allowedText || '').split('|').map(s => s.trim().charAt(0)).filter(Boolean);
  return groups.some(g => allowed.indexOf(g) >= 0);
}

/**
 * Warnings and hard stops for a new event on a trip. Pure: everything it needs is passed in.
 * ctx = { code, trip (tripState or null), dns: [normalised DN], dnInfo: {dn: {plan, legs: [{tripId, leg}]}}, plate }
 * Returns { errors: [{code,msg}], warnings: [{code,msg}] }; warnings need the user to confirm.
 */
function checkEvent(ctx) {
  const errors = [], warnings = [];
  const ev = EV[ctx.code];
  const t = ctx.trip;
  const err = (c, en, kh) => errors.push({ code: c, en: en, kh: kh });
  const warn = (c, en, kh) => warnings.push({ code: c, en: en, kh: kh });
  if (!ev) { err('EVENT', 'Unknown event.', 'ព្រឹត្តិការណ៍មិនត្រឹមត្រូវ។'); return { errors, warnings }; }
  if (ev.code !== 1) {
    if (!t) { err('NO_TRIP', 'Choose the trip first.', 'សូមជ្រើសរើសជើងដឹកជាមុន។'); return { errors, warnings }; }
    if (t.closed) err('TRIP_CLOSED', 'This trip is already ' + STAGES[t.stage].en + '. Start a new trip with Gate In.', 'ជើងដឹកនេះ' + STAGES[t.stage].kh + 'រួចហើយ។ សូមចាប់ផ្តើមជើងថ្មីដោយ ចូលថ្លឹង។');
    if (t.gateIn == null) warn('NO_GATE_IN', 'This trip has no Gate In record.', 'ជើងដឹកនេះគ្មានការកត់ត្រា ចូលថ្លឹង។');
  }
  const dns = ctx.dns || [];
  if (ev.scope === 'dn' && !dns.length) err('NEED_DN', 'Choose at least one DN.', 'សូមជ្រើសរើស DN យ៉ាងហោចណាស់មួយ។');

  if (t && !t.closed) {
    const onTrip = dn => !!t.dns[dn];
    if (ev.code === 7 && !t.dnList.length) warn('NO_DN', 'No DN has been picked up on this trip yet.', 'មិនទាន់មាន DN ណាមួយនៅលើជើងដឹកនេះទេ។');
    if (ev.code >= 2 && ev.code <= 7 && t.gateOut != null) err('AFTER_GATE_OUT', 'The truck already left (Gate Out). This step belongs before Gate Out.', 'ឡានបានចេញពីកន្លែងថ្លឹងរួចហើយ។');
    // Kim (12 Oct 2026): once a trip has done a step, that step and the ones before it are closed for it.
    if (ev.code >= 3 && ev.code <= 7 && t.gateOut == null && t.lastProgress >= ev.code) err('STEP_PASSED', 'This trip is already at ' + EV[t.lastProgress].en + '. Earlier steps can no longer be recorded.', 'ជើងដឹកនេះនៅជំហាន ' + EV[t.lastProgress].kh + ' រួចហើយ។ មិនអាចកត់ត្រាជំហានមុនបានទៀតទេ។');
    if ((ev.code === 8 || ev.code === 9 || ev.code === 11) && t.gateOut == null) warn('NOT_OUT', 'This truck has no Gate Out yet.', 'ឡាននេះមិនទាន់ចេញពីកន្លែងថ្លឹងទេ។');
    if ([8, 9, 11].indexOf(ev.code) >= 0 || (ev.code === 10 && dns.length)) {
      dns.forEach(dn => {
        if (!onTrip(dn)) err('DN_NOT_ON_TRIP', 'DN ' + dn + ' is not on this trip. Record Arrival-Pickup DN for it first.', 'DN ' + dn + ' មិននៅលើជើងដឹកនេះទេ។ សូមកត់ត្រា ដល់កន្លែងចែកបុង ជាមុន។');
        else if (ev.code === 8 && t.dns[dn].leg === 'at_customer') err('DN_ARRIVED', 'DN ' + dn + ' has already arrived at the customer.', 'DN ' + dn + ' បានមកដល់ទីតាំងទំលាក់រួចហើយ។');
        else if (LEG_DONE[t.dns[dn].leg]) err('DN_DONE_ON_TRIP', 'DN ' + dn + ' is already ' + LEG[t.dns[dn].leg].en + ' on this trip.', 'DN ' + dn + ' ' + LEG[t.dns[dn].leg].kh + ' នៅលើជើងដឹកនេះរួចហើយ។');
      });
    }
    if (ev.code === 2) {
      dns.forEach(dn => {
        const info = (ctx.dnInfo || {})[dn] || {};
        if (onTrip(dn)) err('DN_ALREADY_ON_TRIP', 'DN ' + dn + ' is already on this trip.', 'DN ' + dn + ' មាននៅលើជើងដឹកនេះរួចហើយ។');
        if (!info.plan) warn('DN_NOT_IN_PLAN', 'DN ' + dn + ' is not in Delivery Plan.', 'DN ' + dn + ' មិនមាននៅក្នុង Delivery Plan ទេ។');
        if (info.status === 'delivered') err('DN_DELIVERED', 'DN ' + dn + ' is already fully delivered.', 'DN ' + dn + ' បានប្រគល់គ្រប់ហើយ។');
        (info.openTrips || []).filter(id => id !== ctx.tripId).forEach(id => warn('DN_OPEN_ELSEWHERE', 'DN ' + dn + ' is still open on trip ' + id + '. Continue only if this DN is split over trucks or rounds.', 'DN ' + dn + ' នៅបើកលើជើងដឹក ' + id + '។ បន្តតែពេល DN នេះបែងចែកដឹកច្រើនជើង។'));
        if (info.plan && info.plan.plate && ctx.plate && normPlate(info.plan.plate) !== normPlate(ctx.plate)) warn('PLAN_OTHER_TRUCK', 'Delivery Plan puts DN ' + dn + ' on truck ' + info.plan.plate + '.', 'Delivery Plan ដាក់ DN ' + dn + ' លើឡាន ' + info.plan.plate + '។');
      });
    }
  }
  return { errors, warnings };
}

/** Same trip, same event, same DN within this many minutes = a repeated tap or a network retry. */
const DUPLICATE_MINUTES = 3;
function isDuplicate(code, dn, nowMs, tripRows) {
  return tripRows.some(r => r.code === code && (r.dn || '') === (dn || '') && Math.abs(nowMs - r.time) < DUPLICATE_MINUTES * 60000);
}

// ---------------------------------------------------------------- KPIs (dashboard)
/** Plant stages measured from the first time of each step: [key, from code, to code]. */
const SEGMENTS = [
  ['gate_to_bill', 1, 2], ['at_bill', 2, 3], ['to_wh', 3, 4], ['wait_load', 4, 5], ['loading', 5, 6], ['to_gate_out', 6, 7],
];
/** Minutes of each plant stage for one trip (only stages whose two steps exist, in order). total = Gate In → Gate Out. */
function stageMinutes(rows) {
  const first = {};
  rows.forEach(r => { if (r.code >= 1 && r.code <= 7 && (first[r.code] == null || r.time < first[r.code])) first[r.code] = r.time; });
  const out = {};
  SEGMENTS.forEach(s => {
    const a = first[s[1]], b = first[s[2]];
    if (a != null && b != null && b >= a) out[s[0]] = (b - a) / 60000;
  });
  if (first[1] != null && first[7] != null && first[7] >= first[1]) out.total = (first[7] - first[1]) / 60000;
  return out;
}

/**
 * OTIF of one DN: info = dnsInfo entry (legs, status), due = plan date yyyy-mm-dd, ymdOf = time → yyyy-mm-dd.
 * Returns null when the DN does not count (canceled, or late only because of a confirmed customer delay),
 * else { ok, onTime, inFull, failed, doneAt }.
 */
function otifOf(info, due, ymdOf, customerDelay) {
  if (!info || info.status === 'canceled') return null;
  const failed = info.legs.some(l => l.leg === 'failed');
  const delivered = info.legs.filter(l => l.leg === 'delivered');
  const doneAt = delivered.length ? Math.max.apply(null, delivered.map(l => l.time)) : 0;
  const inFull = info.status === 'delivered';
  const onTime = !!doneAt && (!due || ymdOf(doneAt) <= due);
  if (!onTime && customerDelay && inFull && !failed) return null;
  return { ok: onTime && inFull && !failed, onTime: onTime, inFull: inFull, failed: failed, doneAt: doneAt };
}

/** Straight-line distance in km between two "lat,long" texts (null when either is missing). */
function distanceKm(a, b) {
  const p = String(a || '').split(',').map(Number), q = String(b || '').split(',').map(Number);
  if (p.length !== 2 || q.length !== 2 || p.some(isNaN) || q.some(isNaN) || (!p[0] && !p[1]) || (!q[0] && !q[1])) return null;
  const R = 6371, rad = x => x * Math.PI / 180;
  const dLat = rad(q[0] - p[0]), dLon = rad(q[1] - p[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(p[0])) * Math.cos(rad(q[0])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Customer ID from the Time Log customer text "6100000001-Name" (empty when there is none). */
function custIdOf(text) { const m = String(text || '').match(/^\s*(\d{6,})/); return m ? m[1] : ''; }

/** Search boxes match any part of the text: "1234" finds 3A-1234 or DN 8001234567; spaces, dashes and dots are ignored. */
function matchText(hay, q) {
  const squash = s => String(s || '').toLowerCase().replace(/[\s\-_.\/]+/g, '');
  const w = String(q || '').trim().toLowerCase();
  return !w || String(hay || '').toLowerCase().indexOf(w) >= 0 || squash(hay).indexOf(squash(w)) >= 0;
}

if (typeof module !== 'undefined') {
  module.exports = { EVENTS, EV, STAGES, DN_STATUS, LEG, LEG_DONE, eventCode, tripState, dnStatus, nextTripId, nextKey, roleKey, canRecord, checkEvent, isDuplicate, roundText, roundNumber, normDn, normPlate, DUPLICATE_MINUTES, SEGMENTS, stageMinutes, otifOf, distanceKm, custIdOf, matchText };
}
