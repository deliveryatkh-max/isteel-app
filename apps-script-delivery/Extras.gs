/**
 * Delivery Journey: proof of delivery, ratings, complaints, customer sites, 3PL companies, delay alerts and KPIs.
 * Each feature keeps its rows in its own tab (made by setup()), so the existing tabs keep their columns.
 *
 * Extra Script Properties (optional):
 *   TELEGRAM_BOT_TOKEN   bot that posts delay, low-rating and complaint alerts (chat id is in Delivery Settings)
 */

const XT = {
  PROOF: 'Delivery Proof', CRATE: 'Customer Ratings', SRATE: 'Site Ratings', COMPLAINTS: 'Complaints',
  SITES: 'Customer Sites', COMPANIES: 'Truck Companies', SETTINGS: 'Delivery Settings', TRUCKS: '3PL Truck',
};
const XT_COLS = {
  'Delivery Proof': ['Time', 'Key No.', 'Trip ID', 'DN', 'Receiver Name', 'Signature', 'Photos', 'User'],
  'Customer Ratings': ['Time', 'DN', 'Trip ID', 'Truck No.', '3PL', 'Overall', 'Driver Polite', 'On Time', 'Goods OK', 'Comment'],
  'Site Ratings': ['Time', 'DN', 'Trip ID', 'Truck No.', '3PL', 'Customer', 'Wait', 'Unload Help', 'Access', 'Customer Delay', 'Remark', 'Confirmed By', 'Confirmed Time'],
  'Complaints': ['Complaint ID', 'Time', 'DN', 'Trip ID', 'Truck No.', '3PL', 'Customer', 'Type', 'Detail', 'Source', 'Recorded By', 'Status', 'Resolved Time', 'Resolved By', 'Resolution'],
  'Customer Sites': ['Customer ID', 'Customer Name', 'LatLong', 'Set By', 'Set Time'],
  'Truck Companies': ['Truck No.', '3PL Company', 'Set By', 'Set Time', 'Truck Type'],
  'Delivery Settings': ['Setting', 'Value', 'Note'],
  '3PL Truck': ['Plate', 'Company', 'Truck Type', 'Driver', 'Active', 'Added By', 'Added Time'],
};
const SETTING_DEFAULTS = [
  ['INSIDE_WARN_MIN', 90, 'A truck inside the plant (Gate In, no Gate Out) turns orange after this many minutes'],
  ['INSIDE_LATE_MIN', 120, 'Turns red after this many minutes, and a Telegram alert is sent'],
  ['FAR_KM', 1, 'A delivery recorded further than this from the customer site is flagged'],
  ['OTIF_TARGET', 95, 'OTIF target in % for the 3PL scorecard'],
  ['RATING_TARGET', 4, 'Customer rating target (1-5 stars)'],
  ['TURNAROUND_TARGET_MIN', 180, 'Gate In to Gate Out target in minutes'],
  ['TARGET_WAIT_MIN', 40, 'Report: Gate In (or the last warehouse) to arrival at the next warehouse, target in minutes'],
  ['TARGET_LOAD_MIN', 90, 'Report: arrival at a warehouse to End Loading, target in minutes'],
  ['TARGET_GATE_MIN', 30, 'Report: End Loading to Gate Out, target in minutes'],
  ['TARGET_SITE_MIN', 60, 'Report: arrival at the customer to Delivered, target in minutes'],
  ['TELEGRAM_CHAT_ID', '', 'Telegram group for alerts (bot token goes in Script properties as TELEGRAM_BOT_TOKEN)'],
];
const COMPLAINT_TYPES = ['late', 'driver', 'damage', 'short', 'wrong', 'other'];

/** Called by setup(): adds the feature tabs (never touches existing ones) and the delay-alert timer. */
function setupExtras_() {
  const ss = ss_();
  trucksTab_();
  Object.keys(XT_COLS).forEach(name => {
    if (ss.getSheetByName(name)) return;
    const sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, XT_COLS[name].length).setValues([XT_COLS[name]]).setFontWeight('bold');
    sh.setFrozenRows(1);
    if (name === XT.SETTINGS) sh.getRange(2, 1, SETTING_DEFAULTS.length, 3).setValues(SETTING_DEFAULTS);
  });
  const set = ss.getSheetByName(XT.SETTINGS);
  const have = set.getRange(1, 1, set.getLastRow(), 1).getValues().map(r => String(r[0]).trim());
  SETTING_DEFAULTS.filter(d => have.indexOf(d[0]) < 0).forEach(d => set.appendRow(d));   // new settings added later
  if (!ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() === 'checkDelays')) {
    ScriptApp.newTrigger('checkDelays').timeBased().everyMinutes(10).create();
  }
  const notes = [];
  if (!prop_('TELEGRAM_BOT_TOKEN') || !settings_().TELEGRAM_CHAT_ID) notes.push('Telegram alerts are off until TELEGRAM_BOT_TOKEN (Script properties) and TELEGRAM_CHAT_ID (Delivery Settings tab) are filled.');
  return notes;
}

// ---------------------------------------------------------------- small tab helpers
function xtab_(name) {
  const sh = mdOf_(name) || ss_().getSheetByName(name);
  if (!sh) fail_('SETUP', 'The tab "' + name + '" is missing. Run setup() in Apps Script once more.', 'ខ្វះតារាង "' + name + '"។ សូមដំណើរការ setup() ម្តងទៀត។');
  return sh;
}
/** Rows of a feature tab as objects keyed by header (with _row = sheet row). Missing tab = no rows. */
function xrows_(name) {
  const sh = mdOf_(name) || ss_().getSheetByName(name);
  if (!sh || sh.getLastRow() < 2) return [];
  const v = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues();
  const head = v[0].map(h => String(h).trim());
  return v.slice(1).map((r, i) => { const o = { _row: i + 2 }; head.forEach((h, j) => { o[h] = r[j]; }); return o; });
}
function xappend_(name, obj) {
  const sh = xtab_(name);
  const head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(h => String(h).trim());
  // A column added to one of this app's own tabs in a later version: its header goes at the end.
  (XT_COLS[name] || []).filter(h => head.indexOf(h) < 0).forEach(h => { head.push(h); sh.getRange(1, head.length).setValue(h).setFontWeight('bold'); });
  const r = sh.getLastRow() + 1;
  if (r > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), 50);
  plateText_(sh, r, 1, head.map((h, i) => (/truck no|plate/i.test(h) ? i : -1)));   // 3E-2588 stays a plate, not 0
  sh.getRange(r, 1, 1, head.length).setValues([head.map(h => (obj[h] == null ? '' : obj[h]))]);
  return r;
}
function xset_(name, row, field, value) {
  const sh = xtab_(name);
  const head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(h => String(h).trim());
  const c = head.indexOf(field);
  if (c >= 0) sh.getRange(row, c + 1).setValue(value);
}

function settings_() {
  const cache = CacheService.getScriptCache();
  const hit = cache.get('settings_v1');
  if (hit) return JSON.parse(hit);
  const out = {};
  SETTING_DEFAULTS.forEach(d => { out[d[0]] = d[1]; });
  xrows_(XT.SETTINGS).forEach(r => { const k = String(r.Setting || '').trim(); if (k) out[k] = typeof r.Value === 'number' ? r.Value : String(r.Value == null ? '' : r.Value).trim(); });
  ['INSIDE_WARN_MIN', 'INSIDE_LATE_MIN', 'FAR_KM', 'OTIF_TARGET', 'RATING_TARGET', 'TURNAROUND_TARGET_MIN', 'TARGET_WAIT_MIN', 'TARGET_LOAD_MIN', 'TARGET_GATE_MIN', 'TARGET_SITE_MIN'].forEach(k => { out[k] = Number(out[k]) || SETTING_DEFAULTS.find(d => d[0] === k)[1]; });
  cache.put('settings_v1', JSON.stringify(out), 300);
  return out;
}

// ---------------------------------------------------------------- Telegram
function telegram_(text) {
  const token = prop_('TELEGRAM_BOT_TOKEN'), chat = String(settings_().TELEGRAM_CHAT_ID || '');
  if (!token || !chat) return false;
  try {
    UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/sendMessage', {
      method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      payload: JSON.stringify({ chat_id: chat, text: text, disable_web_page_preview: true }),
    });
    return true;
  } catch (e) { console.error('Telegram: ' + e); return false; }
}

// ---------------------------------------------------------------- 3PL trucks and their companies
/**
 * Rented and customer trucks live in the "3PL Truck" tab (Kim, 17 Oct 2026): Plate, Company, Truck Type
 * (Rented / Customer), Driver, Active. Kim can add or edit rows by hand; Active = No hides a truck.
 * Made on first use, with the trucks already kept in Truck Companies copied over once (that tab is left as it is).
 */
function trucksTab_() {
  const ss = ss_();
  let sh = ss.getSheetByName(XT.TRUCKS);
  if (sh) return sh;
  const cols = XT_COLS[XT.TRUCKS];
  sh = ss.insertSheet(XT.TRUCKS);
  sh.getRange(1, 1, 1, cols.length).setValues([cols]).setFontWeight('bold');
  sh.setFrozenRows(1);
  sh.getRange('A:A').setNumberFormat('@');   // plates like 3E-2588 stay text
  const seen = {};
  const old = xrows_(XT.COMPANIES).map(r => {
    const plate = normPlate(r['Truck No.']);
    if (!plate || seen[plate]) return null;
    seen[plate] = 1;
    return [plate, text_(r['3PL Company']), text_(r['Truck Type']) === 'customer' ? 'Customer' : 'Rented', '', 'Yes', text_(r['Set By']), r['Set Time'] || ''];
  }).filter(Boolean);
  if (old.length) sh.getRange(2, 1, old.length, cols.length).setValues(old);
  const cache = CacheService.getScriptCache();
  cache.remove('companies_v2'); cache.remove('trucks_v2');
  return sh;
}
const truckType_ = v => (/cust|អតិថិជន/i.test(String(v || '')) ? 'customer' : 'rented');
const truckActive_ = v => !/^(no|false|n|0|ទេ)$/i.test(String(v == null ? '' : v).trim());
function truckRows_() {
  trucksTab_();
  return xrows_(XT.TRUCKS).map(r => ({ row: r._row, plate: normPlate(r.Plate), co: text_(r.Company), type: truckType_(r['Truck Type']), driver: text_(r.Driver), active: truckActive_(r.Active) }))
    .filter(x => x.plate);
}

/** plate → company: ISI trucks are "ISI"; others from 3PL Truck (filled at Gate In), else the driver's company. */
function companies_() {
  const cache = CacheService.getScriptCache();
  const hit = cache.get('companies_v2');
  if (hit) return JSON.parse(hit);
  const m = master_();
  const map = {};
  m.drivers.forEach(d => { if (d.plate && d.co) map[d.plate] = d.co; });
  truckRows_().forEach(x => { if (x.co) map[x.plate] = x.co; });
  m.plates.forEach(p => { map[p.plate] = 'ISI'; });
  try { cache.put('companies_v2', JSON.stringify(map), 600); } catch (e) { /* too big to cache */ }
  return map;
}
const companyOf_ = (plate, map) => (map || companies_())[normPlate(plate)] || '';
function companyNames_(map) {
  const set = {};
  Object.keys(map).forEach(k => { if (map[k] && map[k] !== 'ISI') set[map[k]] = 1; });
  return Object.keys(set).sort();
}
/**
 * Gate In of a rented / customer truck: the plate, its company, truck type and driver are kept in 3PL Truck,
 * so the plate shows in the list next time (like "Add new truck" in the Fuel app). ISI plates are never added.
 */
function rememberTruck_(plate, company, type, email, driver) {
  plate = normPlate(plate); company = String(company || '').trim().slice(0, 60); driver = String(driver || '').trim().slice(0, 60);
  type = type === 'customer' ? 'customer' : 'rented';
  if (!plate || master_().plates.some(x => x.plate === plate)) return;
  const label = type === 'customer' ? 'Customer' : 'Rented';
  const row = truckRows_().find(x => x.plate === plate);
  if (row && row.co === company && row.type === type && (row.driver || !driver) && row.active) return;
  if (row) {
    if (company) xset_(XT.TRUCKS, row.row, 'Company', company);
    xset_(XT.TRUCKS, row.row, 'Truck Type', label);
    if (driver && !row.driver) xset_(XT.TRUCKS, row.row, 'Driver', driver);
    if (!row.active) xset_(XT.TRUCKS, row.row, 'Active', 'Yes');   // seen at the gate again
  } else xappend_(XT.TRUCKS, { Plate: plate, Company: company, 'Truck Type': label, Driver: driver, Active: 'Yes', 'Added By': email, 'Added Time': now_() });
  const cache = CacheService.getScriptCache();
  cache.remove('companies_v2'); cache.remove('trucks_v2');
}
/** Active rented / customer trucks (3PL Truck tab): plate, company, type, driver. */
function trucks_() {
  const cache = CacheService.getScriptCache();
  const hit = cache.get('trucks_v2');
  if (hit) return JSON.parse(hit);
  const out = truckRows_().filter(x => x.active).map(x => ({ plate: x.plate, co: x.co, type: x.type, driver: x.driver }));
  try { cache.put('trucks_v2', JSON.stringify(out), 600); } catch (e) { /* too big */ }
  return out;
}

// ---------------------------------------------------------------- proof of delivery (signature + extra photos)
function saveProof_(rows, tripId, receiver, sigUrl, photoUrls, email, always) {
  if (!always && !sigUrl && !receiver && photoUrls.length < 2) return;
  rows = rows.slice(0, 1).concat(rows.slice(1).filter(r => r.dn));   // a trip step (Gate In) has one row
  const sh = xtab_(XT.PROOF);
  const head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(h => String(h).trim());
  const out = rows.map(r => {
    const o = { Time: now_(), 'Key No.': r.key, 'Trip ID': tripId, DN: r.dn, 'Receiver Name': String(receiver || '').slice(0, 80), Signature: sigUrl, Photos: photoUrls.join('\n'), User: email };
    return head.map(h => (o[h] == null ? '' : o[h]));
  });
  sh.getRange(sh.getLastRow() + 1, 1, out.length, head.length).setValues(out);
}
/** Photos sent after the step: completes the Delivery Proof row of each Key No. (made with the receiver name), or adds it. */
function proofUpdate_(rows, tripId, sigUrl, photoUrls, email) {
  rows = rows.slice(0, 1).concat(rows.slice(1).filter(r => r.dn));
  const sh = xtab_(XT.PROOF);
  const head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(h => String(h).trim());
  const have = {};
  xrows_(XT.PROOF).forEach(r => { if (String(r['Trip ID']) === tripId) have[text_(r['Key No.'])] = r._row; });
  const iSig = head.indexOf('Signature'), iPh = head.indexOf('Photos');
  const add = [];
  rows.forEach(r => {
    const at = have[r.key];
    if (at) {
      if (sigUrl && iSig >= 0) sh.getRange(at, iSig + 1).setValue(sigUrl);
      if (photoUrls.length && iPh >= 0) sh.getRange(at, iPh + 1).setValue(photoUrls.join('\n'));
    } else add.push(r);
  });
  if (add.length) saveProof_(add, tripId, '', sigUrl, photoUrls.length ? photoUrls : [], email, true);
}
function proofFor_(tripId) {
  return xrows_(XT.PROOF).filter(r => String(r['Trip ID']) === tripId).map(r => ({
    key: text_(r['Key No.']), dn: normDn(r.DN), receiver: text_(r['Receiver Name']), signature: text_(r.Signature),
    photos: String(r.Photos || '').split('\n').filter(Boolean),
  }));
}

// ---------------------------------------------------------------- customer sites (location check)
// Kim (24 Nov 2026): one place for a customer's location, the "Customer Latlong" column of the master Customer tab.
// The old Customer Site tab was merged into it and is only read when the Customer tab has no such column.
const CUST_LL = 'Customer Latlong';
function custTab_() {
  const rows = xrows_(SH.CUST);
  const has = rows.length ? Object.prototype.hasOwnProperty.call(rows[0], CUST_LL) : false;
  const byId = {};
  rows.forEach(r => { const id = text_(r['Customer ID']).replace(/\.0+$/, ''); if (id && !byId[id]) byId[id] = r; });
  return { rows: rows, has: has, byId: byId };
}
function sites_() {
  const out = {}, cu = custTab_();
  if (cu.has) {
    Object.keys(cu.byId).forEach(id => {
      const r = cu.byId[id], ll = text_(r[CUST_LL]).replace(/\s+/g, '');
      if (distanceKm(ll, ll) != null) out[id] = { latlong: ll, row: r._row, name: text_(r['Customer Name']) };
    });
    return out;
  }
  xrows_(XT.SITES).forEach(r => { const id = text_(r['Customer ID']).replace(/\.0+$/, ''); if (id && r.LatLong) out[id] = { latlong: text_(r.LatLong), row: r._row, name: text_(r['Customer Name']), old: true }; });
  return out;
}
/** Saves a customer's location: their Customer row (a new row when the customer is not in the list yet). */
function saveSite_(id, name, ll, by) {
  const cu = custTab_();
  if (!cu.has) {   // master Customer tab without the column: old Customer Site tab
    const s = xrows_(XT.SITES).find(r => text_(r['Customer ID']).replace(/\.0+$/, '') === id);
    if (s) { xset_(XT.SITES, s._row, 'LatLong', ll); xset_(XT.SITES, s._row, 'Set By', by); xset_(XT.SITES, s._row, 'Set Time', now_()); }
    else xappend_(XT.SITES, { 'Customer ID': id, 'Customer Name': name, LatLong: ll, 'Set By': by, 'Set Time': now_() });
    return;
  }
  const r = cu.byId[id];
  if (r) { xset_(SH.CUST, r._row, CUST_LL, ll); return; }
  const no = cu.rows.reduce((m, x) => Math.max(m, Number(x.No) || 0), 0) + 1;
  xappend_(SH.CUST, { No: no, 'Customer ID': id, 'Customer Name': name, [CUST_LL]: ll });
}
/** First delivery with a location sets the customer site (Logistics can move it later). */
function learnSites_(rows, email) {
  const sites = sites_();
  rows.forEach(r => {
    const id = custIdOf(r.cust);
    if (!id || !r.latlong || sites[id]) return;
    saveSite_(id, String(r.cust).replace(/^\s*\d+\s*-\s*/, ''), r.latlong, 'first delivery: ' + email);
    sites[id] = { latlong: r.latlong };
  });
}
/** km from the customer site for each Arrived/Delivered row with a location, when over the limit. */
function farRows_(rows) {
  const sites = sites_(), lim = settings_().FAR_KM, out = {};
  rows.forEach(r => {
    if ((r.code !== 8 && r.code !== 9) || !r.latlong) return;
    const s = sites[custIdOf(r.cust)];
    const km = s ? distanceKm(s.latlong, r.latlong) : null;
    if (km != null && km > lim) out[r.row] = Math.round(km * 10) / 10;
  });
  return out;
}
function setSite_(p, user) {
  needAny_(user, ['admin', 'supervisor', 'logistics']);
  const id = String(p.custId || '').trim(), ll = String(p.latlong || '').trim();
  if (!/^\d{6,}$/.test(id) || distanceKm(ll, ll) == null) fail_('BAD', 'Customer or location is missing.', 'ខ្វះអតិថិជន ឬទីតាំង។');
  return withLock_(() => {
    const s = sites_()[id];
    if (s) audit_(user.email, 'Customer site', '', '', id, s.latlong, ll, String(p.reason || 'Moved from trip screen'));
    saveSite_(id, String(p.custName || (s && s.name) || ''), ll, user.email);
    return { ok: true };
  });
}

// ---------------------------------------------------------------- customer rating (signed link, no sign-in)
const rateToken_ = (dn, tripId) => b64url_(Utilities.computeHmacSha256Signature('rate|' + dn + '|' + tripId, linkSecret_())).slice(0, 16);
function checkRate_(p) {
  const dn = normDn(p.d), tripId = String(p.t || '').trim();
  if (!dn || !tripId || String(p.k || '') !== rateToken_(dn, tripId)) fail_('LINK', 'This link is not valid.', 'តំណនេះមិនត្រឹមត្រូវ។');
  return { dn: dn, tripId: tripId };
}
function rateInfo_(p) {
  const c = checkRate_(p);
  const rows = rowsWhere_('dn', [c.dn]).filter(r => r.trip === c.tripId);
  const del = rows.filter(r => r.code === 9).pop();
  if (!del) fail_('LINK', 'This delivery is not recorded yet.', 'ការប្រគល់នេះមិនទាន់កត់ត្រាទេ។');
  const rated = xrows_(XT.CRATE).some(r => normDn(r.DN) === c.dn && String(r['Trip ID']) === c.tripId);
  return { dn: c.dn, tripId: c.tripId, plate: del.plate, driver: del.driver, cust: String(del.cust).replace(/^\s*\d+\s*-\s*/, ''), time: del.time, rated: rated };
}
function rateSave_(p) {
  const c = checkRate_(p);
  const star = v => { const n = Math.round(Number(v)); return n >= 1 && n <= 5 ? n : 0; };
  // Kim (24 Nov 2026): the total score is worked out from the 3 answers (average, 1 decimal); old links still send Overall
  const three = [star(p.polite), star(p.ontime), star(p.goods)];
  const overall = three.every(Boolean) ? Math.round(three.reduce((a, x) => a + x, 0) / 3 * 10) / 10 : star(p.overall);
  if (!overall) fail_('BAD', 'Choose 1 to 5 stars.', 'សូមជ្រើស ១ ដល់ ៥ ផ្កាយ។');
  return withLock_(() => {
    const info = rateInfo_(p);
    if (info.rated) fail_('DONE', 'Thank you, this delivery is already rated.', 'សូមអរគុណ ការដឹកជញ្ជូននេះបានវាយតម្លៃរួចហើយ។');
    const co = companyOf_(info.plate);
    const comment = String(p.comment || '').slice(0, 500);
    xappend_(XT.CRATE, { Time: now_(), DN: c.dn, 'Trip ID': c.tripId, 'Truck No.': info.plate, '3PL': co, Overall: overall, 'Driver Polite': star(p.polite) || '', 'On Time': star(p.ontime) || '', 'Goods OK': star(p.goods) || '', Comment: comment });
    if (overall <= 2) telegram_('⭐ ' + overall + '/5 from ' + info.cust + ' · DN ' + c.dn + ' · ' + info.plate + (co ? ' (' + co + ')' : '') + ' · trip ' + c.tripId + (comment ? '\n💬 ' + comment : ''));
    return { ok: true };
  });
}

// ---------------------------------------------------------------- driver / 3PL rates the customer site
/** p = { dns: [..], wait: short|mid|long, help: yes|some|no, access: easy|hard|blocked, custDelay: bool, remark } */
function siteRate_(p, tripId, email) {
  const dns = (p.dns || []).map(normDn).filter(Boolean);
  if (!dns.length) fail_('BAD', 'DN is missing.');
  const pick = (v, list) => (list.indexOf(v) >= 0 ? v : '');
  return withLock_(() => {
    const rows = rowsWhere_('dn', dns).filter(r => r.trip === tripId && r.code === 9);
    if (!rows.length) fail_('BAD', 'Record Delivered first.', 'សូមកត់ត្រា បានប្រគល់ ជាមុន។');
    const done = {};
    xrows_(XT.SRATE).forEach(r => { if (String(r['Trip ID']) === tripId) done[normDn(r.DN)] = 1; });
    const plate = rows[0].plate, co = companyOf_(plate);
    dns.filter(dn => !done[dn]).forEach(dn => {
      const r = rows.find(x => x.dn === dn) || rows[0];
      xappend_(XT.SRATE, { Time: now_(), DN: dn, 'Trip ID': tripId, 'Truck No.': plate, '3PL': co, Customer: r.cust, Wait: pick(p.wait, ['short', 'mid', 'long']),
        'Unload Help': pick(p.help, ['yes', 'some', 'no']), Access: pick(p.access, ['easy', 'hard', 'blocked']), 'Customer Delay': p.custDelay ? 'Yes' : '', Remark: String(p.remark || '').slice(0, 300) + (email ? '' : '') });
    });
    return { ok: true };
  });
}
function confirmDelay_(p, user) {
  needAny_(user, ['admin', 'supervisor', 'logistics']);
  return withLock_(() => {
    const r = xrows_(XT.SRATE).find(x => x._row === Number(p.row) && normDn(x.DN) === normDn(p.dn));
    if (!r) fail_('NOTFOUND', 'That site rating was not found. Refresh and try again.');
    xset_(XT.SRATE, r._row, 'Confirmed By', p.undo ? '' : user.email);
    xset_(XT.SRATE, r._row, 'Confirmed Time', p.undo ? '' : now_());
    audit_(user.email, p.undo ? 'Customer delay unconfirmed' : 'Customer delay confirmed', '', text_(r['Trip ID']), 'DN ' + normDn(r.DN), '', '', 'OTIF');
    return { ok: true };
  });
}

// ---------------------------------------------------------------- complaints
function complaintList_(rows) {
  return rows.map(r => ({
    row: r._row, id: text_(r['Complaint ID']), time: timeOf_(r.Time), dn: normDn(r.DN), trip: text_(r['Trip ID']), plate: text_(r['Truck No.']), co: text_(r['3PL']),
    cust: text_(r.Customer), type: text_(r.Type), detail: text_(r.Detail), source: text_(r.Source), by: text_(r['Recorded By']), status: text_(r.Status) || 'Open',
    resolvedAt: timeOf_(r['Resolved Time']), resolvedBy: text_(r['Resolved By']), resolution: text_(r.Resolution),
  }));
}
function complaints_(p) {
  let list = complaintList_(xrows_(XT.COMPLAINTS));
  if (p.dn) list = list.filter(c => c.dn === normDn(p.dn));
  if (p.trip) list = list.filter(c => c.trip === String(p.trip));
  if (p.status) list = list.filter(c => c.status === p.status);
  return { items: list.sort((a, b) => b.time - a.time || b.row - a.row).slice(0, 300), types: COMPLAINT_TYPES };
}
function complaintAdd_(p, user) {
  if (user.roleKey === 'driver' || !user.roleKey) fail_('DENIED', 'Your role cannot record complaints.', 'តួនាទីរបស់អ្នកមិនអាចកត់ត្រាបណ្តឹងបានទេ។');
  const dn = normDn(p.dn), type = COMPLAINT_TYPES.indexOf(p.type) >= 0 ? p.type : '';
  const detail = String(p.detail || '').trim().slice(0, 1000);
  if (!dn || !type || detail.length < 3) fail_('BAD', 'Choose the DN and type, and describe the complaint.', 'សូមជ្រើស DN និងប្រភេទ ហើយពិពណ៌នាបណ្តឹង។');
  return withLock_(() => {
    const rows = rowsWhere_('dn', [dn]);
    // The trip that delivered (or last carried) this DN gets the complaint, unless the user picked one.
    const tripRows = p.trip ? rows.filter(r => r.trip === p.trip) : rows;
    const last = tripRows.filter(r => r.code === 9).pop() || tripRows.slice().sort((a, b) => a.time - b.time).pop() || {};
    const plan = plan_()[dn] || {};
    const today = fmt_(now_(), 'yyMMdd');
    const n = xrows_(XT.COMPLAINTS).filter(r => String(r['Complaint ID']).indexOf('C' + today) === 0).length + 1;
    const id = 'C' + today + '-' + String(n).padStart(2, '0');
    const plate = last.plate || plan.plate || '';
    const co = companyOf_(plate);
    const cust = last.cust || (plan.custName ? (plan.custId ? plan.custId + '-' : '') + plan.custName : '');
    xappend_(XT.COMPLAINTS, { 'Complaint ID': id, Time: now_(), DN: dn, 'Trip ID': last.trip || '', 'Truck No.': plate, '3PL': co, Customer: cust, Type: type, Detail: detail,
      Source: String(p.source || '').slice(0, 60), 'Recorded By': user.email, Status: 'Open' });
    telegram_('📣 Complaint ' + id + ' (' + type + ') · DN ' + dn + ' · ' + cust + ' · ' + plate + (co ? ' (' + co + ')' : '') + '\n' + detail);
    return complaints_({ dn: dn });
  });
}
function complaintResolve_(p, user) {
  needAny_(user, ['admin', 'supervisor', 'logistics']);
  const note = String(p.resolution || '').trim();
  if (note.length < 3) fail_('BAD', 'Write how it was resolved.', 'សូមសរសេររបៀបដោះស្រាយ។');
  return withLock_(() => {
    const r = xrows_(XT.COMPLAINTS).find(x => x._row === Number(p.row) && text_(x['Complaint ID']) === String(p.id));
    if (!r) fail_('NOTFOUND', 'That complaint was not found. Refresh and try again.');
    xset_(XT.COMPLAINTS, r._row, 'Status', 'Resolved');
    xset_(XT.COMPLAINTS, r._row, 'Resolved Time', now_());
    xset_(XT.COMPLAINTS, r._row, 'Resolved By', user.email);
    xset_(XT.COMPLAINTS, r._row, 'Resolution', note.slice(0, 1000));
    return complaints_({ dn: normDn(r.DN) });
  });
}

// ---------------------------------------------------------------- delay alerts (time trigger every 10 minutes)
function checkDelays() {
  const s = settings_();
  if (!prop_('TELEGRAM_BOT_TOKEN') || !s.TELEGRAM_CHAT_ID) return;
  const rows = tailRows_(1500);
  const groups = groupTrips_(rows);
  const props = PropertiesService.getScriptProperties();
  let sent = {};
  try { sent = JSON.parse(props.getProperty('DELAY_SENT') || '{}'); } catch (e) { sent = {}; }
  const now = Date.now(), lim = s.INSIDE_LATE_MIN * 60000;
  const co = companies_();
  const msgs = [];
  Object.keys(groups).forEach(id => {
    const st = tripState(groups[id]);
    if (st.closed || st.gateIn == null || st.gateOut != null || sent[id]) return;
    const inside = now - st.gateIn;
    if (inside < lim || inside > 24 * 3600000) return;
    const plate = groups[id][0].plate;
    msgs.push('🔴 ' + plate + (co[plate] ? ' (' + co[plate] + ')' : '') + ' inside ' + Math.floor(inside / 3600000) + ':' + String(Math.floor(inside / 60000) % 60).padStart(2, '0') +
      ' · ' + STAGES[st.stage].kh + ' · trip ' + id);
    sent[id] = now;
  });
  Object.keys(sent).forEach(id => { if (now - sent[id] > 2 * 86400000) delete sent[id]; });
  if (msgs.length && telegram_(msgs.join('\n'))) props.setProperty('DELAY_SENT', JSON.stringify(sent));
}

// ---------------------------------------------------------------- Report tab: time spent at each area (Kim, 24 Nov 2026, option C)
/**
 * Minutes of one trip of the 9-step flow, from the first time of each step (codes: 1 Gate In, 4 arrival at a warehouse,
 * 6 End Loading, 7 Gate Out, 8 arrival at the customer, 12/13 unloading, 9/10/11 Delivered/Canceled/Failed).
 * wh: one visit per warehouse (wait = Gate In or the previous End Loading to arrival; load = arrival to End Loading);
 * gate = last End Loading to Gate Out; stops: one per customer (road = Gate Out or the previous stop's end to arrival;
 * wait = arrival to Start Unloading; unload = Start to Finish Unloading; sign = Finish Unloading to Delivered).
 * total = Gate In to the last Delivered / Failed / Canceled (only when every DN is finished).
 */
function tripTimes_(g) {
  const sorted = g.slice().sort((a, b) => a.time - b.time);
  const min = (a, b) => (a != null && b != null && b >= a ? Math.round((b - a) / 60000) : null);
  const first = code => { const r = sorted.find(x => x.code === code); return r ? r.time : null; };
  const gin = first(1), gout = first(7);
  const out = { gin: gin, gout: gout, wh: [], stops: [], gate: null, plant: min(gin, gout), total: null };
  // a visit opens at arrival (4), or at Start Loading (5) when the arrival step was skipped, and closes at End Loading (6)
  let prev = gin, open = null;
  sorted.filter(r => r.code === 4 || r.code === 5 || r.code === 6).forEach(r => {
    if (r.code === 4 || (r.code === 5 && !open)) {
      if (open && r.code === 4) out.wh.push(open);
      open = { wh: r.wh || 'Unknown', wait: min(prev, r.time), load: null, at: r.time };
    } else if (r.code === 6 && open) { open.load = min(open.at, r.time); out.wh.push(open); open = null; prev = r.time; }
  });
  if (open) out.wh.push(open);
  out.wh.forEach(w => { delete w.at; });
  const ends = sorted.filter(r => r.code === 6);
  if (ends.length) out.gate = min(ends[ends.length - 1].time, gout);
  // stops: DNs of the same customer arrive together (one stop per customer)
  const byCust = {};
  sorted.filter(r => r.dn && [8, 12, 13, 9, 10, 11].indexOf(r.code) >= 0).forEach(r => {
    const k = custIdOf(r.cust) || r.cust || r.dn;
    const s = byCust[k] || (byCust[k] = { cust: String(r.cust || '').replace(/^\s*\d+\s*-\s*/, '') || 'DN ' + r.dn, dns: {} });
    s.dns[r.dn] = 1;
    const f = { 8: 'arr', 12: 'us', 13: 'ue', 9: 'done', 10: 'done', 11: 'done' }[r.code];
    if (s[f] == null || (f === 'done' ? r.time > s[f] : r.time < s[f])) s[f] = r.time;
  });
  let last = gout;
  Object.keys(byCust).map(k => byCust[k]).filter(s => s.arr != null).sort((a, b) => a.arr - b.arr).forEach(s => {
    out.stops.push({ cust: s.cust, dns: Object.keys(s.dns).length, road: min(last, s.arr), wait: min(s.arr, s.us), unload: min(s.us, s.ue), sign: min(s.ue, s.done), site: min(s.arr, s.done) });
    if (s.done != null) last = s.done;
  });
  out.road = out.stops.length ? out.stops[0].road : null;
  const dns = {}, fin = {};
  g.forEach(r => { if (r.dn && r.code !== 10) dns[r.dn] = 1; if (r.dn && [9, 10, 11].indexOf(r.code) >= 0) fin[r.dn] = Math.max(fin[r.dn] || 0, r.time); });
  const tripCanceled = g.some(r => r.code === 10 && !r.dn);
  const dnList = Object.keys(dns);
  if (gin != null && !tripCanceled && dnList.length && dnList.every(d => fin[d])) out.total = min(gin, Math.max.apply(null, dnList.map(d => fin[d])));
  return out;
}

/** Report tab (office roles): averages per warehouse / 3PL / customer / driver for trips with Gate In in [from, to]. */
function report_(p, user) {
  needAny_(user, ['admin', 'supervisor', 'logistics']);
  const from = /^\d{4}-\d\d-\d\d$/.test(p.from || '') ? p.from : ymd_(new Date(Date.now() - 6 * 86400000));
  const to = /^\d{4}-\d\d-\d\d$/.test(p.to || '') ? p.to : ymd_(now_());
  const cache = CacheService.getScriptCache();
  const ck = 'rep1_' + from + '_' + to;
  const hit = !p.fresh && cache.get(ck);
  if (hit) return JSON.parse(hit);
  const s = settings_();
  const sh = sheet_(SH.LOG), C = logCols_();
  const lastRow = sh.getLastRow();
  const vals = lastRow >= 2 ? sh.getRange(2, 1, lastRow - 1, C.width).getValues() : [];
  const groups = groupTrips_(vals.map((v, i) => parseRow_(v, i + 2, C)).filter(r => r.trip));
  const co = companies_();
  const coOf = plate => co[normPlate(plate)] || 'Unknown';
  const acc = {}, add = (view, key, col, v) => {
    if (v == null) return;
    const o = (acc[view] || (acc[view] = {}))[key] || (acc[view][key] = { n: {}, sum: {}, trips: {} });
    o.n[col] = (o.n[col] || 0) + 1; o.sum[col] = (o.sum[col] || 0) + v;
  };
  const count = (view, key, id) => { const o = (acc[view] || (acc[view] = {}))[key] || (acc[view][key] = { n: {}, sum: {}, trips: {} }); o.trips[id] = 1; };
  const trips = [];
  Object.keys(groups).forEach(id => {
    const g = groups[id];
    const tt = tripTimes_(g);
    if (tt.gin == null) return;
    const day = ymd_(new Date(tt.gin));
    if (day < from || day > to) return;
    const gi = g.find(r => r.code === 1) || {};
    const drv = (g.filter(r => r.driver).pop() || {}).driver || 'Unknown';
    const c = coOf(gi.plate);
    const atSite = tt.stops.reduce((a, x) => (x.site != null ? a + x.site : a), 0) || null;
    const load = tt.wh.reduce((a, x) => (x.load != null ? a + x.load : a), 0) || null;
    const wait = tt.wh.reduce((a, x) => (x.wait != null ? a + x.wait : a), 0) || null;
    trips.push({ id: id, day: day, plate: gi.plate || '', co: c, driver: drv, wh: tt.wh.map(x => x.wh).join(', '), cust: tt.stops.map(x => x.cust).join(', '),
      wait: wait, load: load, gate: tt.gate, road: tt.road, site: atSite, plant: tt.plant, total: tt.total });
    tt.wh.forEach((w, i) => { count('wh', w.wh, id); add('wh', w.wh, 'wait', w.wait); add('wh', w.wh, 'load', w.load); if (i === tt.wh.length - 1) add('wh', w.wh, 'gate', tt.gate); });
    [['co', c], ['driver', drv]].forEach(v => {
      count(v[0], v[1], id);
      add(v[0], v[1], 'plant', tt.plant); add(v[0], v[1], 'road', tt.road); add(v[0], v[1], 'site', atSite); add(v[0], v[1], 'total', tt.total);
    });
    tt.stops.forEach(st => { count('cust', st.cust, id); ['road', 'wait', 'unload', 'site'].forEach(k => add('cust', st.cust, k, st[k])); });
  });
  const avg = (o, k) => (o.n[k] ? Math.round(o.sum[k] / o.n[k]) : null);
  const views = {};
  ['wh', 'co', 'driver', 'cust'].forEach(v => {
    const a = acc[v] || {};
    views[v] = Object.keys(a).map(k => {
      const o = a[k], row = { key: k, trips: Object.keys(o.trips).length };
      Object.keys(o.n).forEach(col => { row[col] = avg(o, col); });
      return row;
    }).sort((x, y) => y.trips - x.trips);
  });
  const mean = k => { const xs = trips.map(t => t[k]).filter(x => x != null); return xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null; };
  const done = trips.filter(t => t.total != null);
  const out = {
    from: from, to: to, builtAt: Date.now(),
    targets: { wait: s.TARGET_WAIT_MIN, load: s.TARGET_LOAD_MIN, gate: s.TARGET_GATE_MIN, site: s.TARGET_SITE_MIN, plant: s.TURNAROUND_TARGET_MIN },
    summary: { trips: trips.length, done: done.length, total: mean('total'), plant: mean('plant'), wait: mean('wait'), load: mean('load'), gate: mean('gate'), road: mean('road'), site: mean('site'),
      underPlant: trips.filter(t => t.plant != null).length ? Math.round(trips.filter(t => t.plant != null && t.plant <= s.TURNAROUND_TARGET_MIN).length * 100 / trips.filter(t => t.plant != null).length) : null },
    views: views,
    trips: trips.sort((a, b) => (b.total || b.plant || 0) - (a.total || a.plant || 0)).slice(0, 500),
  };
  try { cache.put(ck, JSON.stringify(out), 300); } catch (e) { /* too big to cache */ }
  return out;
}

// ---------------------------------------------------------------- KPIs: turnaround, OTIF, 3PL scorecard (Supervisor / Admin / Logistics)
function kpi_(p, user) {
  needAny_(user, ['admin', 'supervisor', 'logistics']);
  const from = /^\d{4}-\d\d-\d\d$/.test(p.from || '') ? p.from : ymd_(new Date(Date.now() - 6 * 86400000));
  const to = /^\d{4}-\d\d-\d\d$/.test(p.to || '') ? p.to : ymd_(now_());
  const cache = CacheService.getScriptCache();
  const ck = 'kpi_' + from + '_' + to;
  const hit = !p.fresh && cache.get(ck);
  if (hit) return JSON.parse(hit);

  const s = settings_();
  const sh = sheet_(SH.LOG), C = logCols_();
  const last = sh.getLastRow();
  const vals = last >= 2 ? sh.getRange(2, 1, last - 1, C.width).getValues() : [];
  const rows = vals.map((v, i) => parseRow_(v, i + 2, C)).filter(r => r.trip);
  const groups = groupTrips_(rows);
  const co = companies_();
  const coOf = plate => co[normPlate(plate)] || 'Unknown';

  // Turnaround: trips with Gate In in the period
  const seg = {}, byWh = {}, byDay = {}, byCo = {};
  const add = (o, k, v) => { const x = o[k] || (o[k] = { n: 0, sum: 0 }); x.n++; x.sum += v; };
  let trips = 0, totalN = 0, totalSum = 0, underTarget = 0;
  Object.keys(groups).forEach(id => {
    const g = groups[id];
    const gi = g.filter(r => r.code === 1).sort((a, b) => a.time - b.time)[0];
    if (!gi) return;
    const day = ymd_(new Date(gi.time));
    if (day < from || day > to) return;
    trips++;
    const c = coOf(gi.plate);
    const cs = byCo[c] || (byCo[c] = { trips: 0, inPlantN: 0, inPlantSum: 0, dns: 0, ok: 0, failed: 0, complaints: 0, ratingN: 0, ratingSum: 0, podN: 0, podOk: 0 });
    cs.trips++;
    const m = stageMinutes(g);
    SEGMENTS.forEach(sg => { if (m[sg[0]] != null) add(seg, sg[0], m[sg[0]]); });
    if (m.total != null) {
      totalN++; totalSum += m.total; if (m.total <= s.TURNAROUND_TARGET_MIN) underTarget++;
      cs.inPlantN++; cs.inPlantSum += m.total;
      const wh = (g.find(r => r.code === 6 && r.wh) || {}).wh || 'Unknown';
      add(byWh, wh, m.total);
      add(byDay, day, m.total);
    } else (byDay[day] || (byDay[day] = { n: 0, sum: 0 }));
    // Proof of delivery: each Delivered row with a photo
    g.filter(r => r.code === 9).forEach(r => { cs.podN++; if (r.billPhoto) cs.podOk++; });
  });

  // OTIF: DNs due (plan date) in the period
  const plan = plan_();
  const dueDns = Object.keys(plan).filter(dn => plan[dn].date >= from && plan[dn].date <= to);
  const dnRows = rows.filter(r => r.dn);
  const info = dnsInfo_(dueDns, dnRows, plan);
  const delays = {};
  xrows_(XT.SRATE).forEach(r => { if (r['Customer Delay'] === 'Yes' && r['Confirmed By']) delays[normDn(r.DN)] = 1; });
  const otif = { due: 0, ok: 0, late: 0, short: 0, failed: 0, open: 0, excluded: 0 };
  const misses = [];
  dueDns.forEach(dn => {
    const i = info[dn];
    const o = otifOf(i, plan[dn].date, t => ymd_(new Date(t)), !!delays[dn]);
    if (!o) { if (i.status !== 'canceled') otif.excluded++; return; }
    if (!o.doneAt && !o.failed && (i.status === 'in_progress' || i.status === 'not_started') && plan[dn].date >= ymd_(now_())) { otif.open++; return; }   // still due today
    const lastLeg = i.legs.slice().sort((a, b) => b.time - a.time)[0];
    const c = coOf(lastLeg ? lastLeg.plate : plan[dn].plate);
    const cs = byCo[c] || (byCo[c] = { trips: 0, inPlantN: 0, inPlantSum: 0, dns: 0, ok: 0, failed: 0, complaints: 0, ratingN: 0, ratingSum: 0, podN: 0, podOk: 0 });
    otif.due++; cs.dns++;
    if (o.ok) { otif.ok++; cs.ok++; return; }
    if (o.failed) { otif.failed++; cs.failed++; }
    else if (!o.inFull && o.doneAt) otif.short++;
    else otif.late++;
    if (misses.length < 60) misses.push({ dn: dn, cust: plan[dn].custName, due: plan[dn].date, doneAt: o.doneAt, onTime: o.onTime, inFull: o.inFull, failed: o.failed, co: c });
  });

  // Ratings and complaints in the period
  const inRange = t => { const d = ymd_(new Date(timeOf_(t))); return d >= from && d <= to; };
  let rN = 0, rSum = 0;
  xrows_(XT.CRATE).forEach(r => {
    if (!inRange(r.Time) || !(Number(r.Overall) > 0)) return;
    rN++; rSum += Number(r.Overall);
    const c = text_(r['3PL']) || coOf(r['Truck No.']);
    const cs = byCo[c]; if (cs) { cs.ratingN++; cs.ratingSum += Number(r.Overall); }
  });
  const cl = complaintList_(xrows_(XT.COMPLAINTS).filter(r => inRange(r.Time)));
  const cTypes = {};
  cl.forEach(c => { cTypes[c.type] = (cTypes[c.type] || 0) + 1; const cs = byCo[c.co || coOf(c.plate)]; if (cs) cs.complaints++; });

  const avg = o => (o && o.n ? Math.round(o.sum / o.n) : null);
  const out = {
    from: from, to: to, settings: { turnaroundTarget: s.TURNAROUND_TARGET_MIN, otifTarget: s.OTIF_TARGET, ratingTarget: s.RATING_TARGET },
    trips: trips, avgTotal: totalN ? Math.round(totalSum / totalN) : null, underTargetPct: totalN ? Math.round(underTarget * 100 / totalN) : null,
    segments: SEGMENTS.map(sg => ({ key: sg[0], avg: avg(seg[sg[0]]), n: seg[sg[0]] ? seg[sg[0]].n : 0 })),
    byWh: Object.keys(byWh).sort().map(k => ({ wh: k, avg: avg(byWh[k]), n: byWh[k].n })),
    byDay: Object.keys(byDay).sort().map(k => ({ day: k, avg: avg(byDay[k]), n: byDay[k].n })),
    otif: Object.assign(otif, { pct: otif.due ? Math.round(otif.ok * 1000 / otif.due) / 10 : null }), misses: misses,
    rating: { n: rN, avg: rN ? Math.round(rSum * 10 / rN) / 10 : null },
    complaints: { n: cl.length, open: cl.filter(c => c.status !== 'Resolved').length, types: cTypes },
    scorecard: Object.keys(byCo).map(k => {
      const c = byCo[k];
      return { co: k, trips: c.trips, dns: c.dns, otif: c.dns ? Math.round(c.ok * 1000 / c.dns) / 10 : null, failed: c.failed, complaints: c.complaints,
        rating: c.ratingN ? Math.round(c.ratingSum * 10 / c.ratingN) / 10 : null, ratingN: c.ratingN, inPlant: c.inPlantN ? Math.round(c.inPlantSum / c.inPlantN) : null,
        pod: c.podN ? Math.round(c.podOk * 100 / c.podN) : null };
    }).sort((a, b) => (b.otif == null ? -1 : b.otif) - (a.otif == null ? -1 : a.otif) || b.trips - a.trips),
    builtAt: Date.now(),
  };
  try { cache.put(ck, JSON.stringify(out), 300); } catch (e) { /* too big to cache */ }
  return out;
}

/** Site ratings of a DN (for the DN screen: customer delay to confirm). */
function siteRatingsOf_(dn) {
  return xrows_(XT.SRATE).filter(r => normDn(r.DN) === dn).map(r => ({
    row: r._row, time: timeOf_(r.Time), trip: text_(r['Trip ID']), wait: text_(r.Wait), help: text_(r['Unload Help']), access: text_(r.Access),
    custDelay: r['Customer Delay'] === 'Yes', remark: text_(r.Remark), confirmedBy: text_(r['Confirmed By']),
  }));
}
function customerRatingsOf_(dn) {
  return xrows_(XT.CRATE).filter(r => normDn(r.DN) === dn).map(r => ({
    time: timeOf_(r.Time), trip: text_(r['Trip ID']), overall: Number(r.Overall) || 0, polite: Number(r['Driver Polite']) || 0, ontime: Number(r['On Time']) || 0, goods: Number(r['Goods OK']) || 0, comment: text_(r.Comment),
  }));
}

function needAny_(user, keys) {
  if (keys.indexOf(user.roleKey) < 0) fail_('DENIED', 'Your role cannot do this.', 'តួនាទីរបស់អ្នកមិនអាចធ្វើបានទេ។');
}

// ---------------------------------------------------------------- customer live tracking (Kim, 22 Nov 2026)
// After Gate Out the driver's phone (driver link or the driver's own sign-in) sends its GPS. The customer opens
// track.html?d=DN&t=TRIP&k=KEY (signed per DN + trip, no sign-in) and sees the truck on a map until the DN is done.
// The latest point is kept in the cache (fast); a row goes to the "Live GPS" tab at most every GPS_LOG_MIN minutes.
// Truck GPS (provider API) can be added later as another Source.
const GPS_TAB = 'Live GPS';
const GPS_COLS = ['Time', 'Trip ID', 'Truck No.', 'LatLong', 'Accuracy (m)', 'Source', 'User'];
XT_COLS[GPS_TAB] = GPS_COLS;
const GPS_LOG_MIN = 2;
const trackToken_ = (dn, tripId) => b64url_(Utilities.computeHmacSha256Signature('trk|' + dn + '|' + tripId, linkSecret_())).slice(0, 16);

function gpsTabReady_() {
  const ss = ss_();
  if (ss.getSheetByName(GPS_TAB)) return;
  const sh = ss.insertSheet(GPS_TAB);
  sh.getRange(1, 1, 1, GPS_COLS.length).setValues([GPS_COLS]).setFontWeight('bold');
  sh.setFrozenRows(1);
}
/** Checks a phone position: "lat,lng" inside Cambodia and around (no fake 0,0). */
function cleanLatLong_(ll) {
  const m = String(ll || '').match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
  if (!m) return '';
  const lat = Number(m[1]), lng = Number(m[2]);
  if (!(lat > 8 && lat < 16 && lng > 100 && lng < 109)) return '';
  return lat.toFixed(6) + ',' + lng.toFixed(6);
}
/** Saves one position for an open trip after Gate Out. */
function gpsSave_(tripId, st, plate, p, source, email) {
  if (!st.gateOut || st.closed) return { ok: true, skipped: true };
  const ll = cleanLatLong_(p.ll);
  if (!ll) fail_('BAD', 'The location is not valid.', 'ទីតាំងមិនត្រឹមត្រូវ។');
  const acc = Math.max(0, Math.round(Number(p.acc) || 0));
  const cache = CacheService.getScriptCache();
  const point = { ll: ll, acc: acc, t: Date.now(), src: source };
  cache.put('gps_' + tripId, JSON.stringify(point), 21600);
  if (!cache.get('gpslog_' + tripId)) {
    cache.put('gpslog_' + tripId, '1', GPS_LOG_MIN * 60);
    gpsTabReady_();
    xappend_(GPS_TAB, { Time: now_(), 'Trip ID': tripId, 'Truck No.': plate, LatLong: ll, 'Accuracy (m)': acc, Source: source, User: email });
  }
  return { ok: true };
}
/** Latest position of a trip: the cache, else the last row of the Live GPS tab. */
function gpsLast_(tripId) {
  const hit = CacheService.getScriptCache().get('gps_' + tripId);
  if (hit) return JSON.parse(hit);
  const rows = xrows_(GPS_TAB).filter(r => text_(r['Trip ID']) === tripId);
  const r = rows.pop();
  return r ? { ll: text_(r.LatLong), acc: Number(r['Accuracy (m)']) || 0, t: timeOf_(r.Time), src: text_(r.Source) } : null;
}
function driverGps_(p) {
  const c = checkDriverLink_(p, true);
  return gpsSave_(c.tripId, c.st, c.rows[0].plate, p, 'phone', 'driver-link');
}
function userGps_(p, user) {
  needAny_(user, ['driver', 'admin', 'supervisor', 'logistics']);
  const tripId = String(p.tripId || '').trim();
  const rows = rowsWhere_('trip', [tripId]);
  if (!rows.length) fail_('NOTFOUND', 'Trip ' + tripId + ' was not found.', 'រកមិនឃើញជើងដឹក ' + tripId + '។');
  return gpsSave_(tripId, tripState(rows), rows[0].plate, p, 'phone', user.email);
}
/** Customer tracking links (DN → key) for every DN on the trip once it has gone out. */
function trackLinks_(tripId, rows) {
  const out = {};
  if (!rows.some(r => r.code === 7)) return out;
  rows.forEach(r => { if (r.dn && !out[r.dn]) out[r.dn] = trackToken_(r.dn, tripId); });
  return out;
}
/**
 * Driver of the trip with a phone (Kim, 22/24 Nov 2026: shown to the customer, tap to call). Looks in the Users list, then in
 * every row of the master Employee List (drivers without a Gmail too) by Full Name, Name, Khmer Name or Employee ID.
 * No phone found: the Script property TRACK_CALL_PHONE (an office line), when set.
 */
function driverContact_(name) {
  const n = String(name || '').trim();
  const bare = x => String(x || '').replace(/^\s*\d+\s*[.\-]\s*/, '').replace(/\s+/g, ' ').trim().toLowerCase();
  const fix = p => { p = String(p || '').replace(/\.0+$/, '').trim(); return /^[1-9]\d{7,8}$/.test(p) ? '0' + p : p; };   // a number cell drops the leading 0
  let phone = '';
  if (n) {
    const d = usersCached_().filter(u => u.phone).find(u => u.name === n || bare(u.name) === bare(n));
    phone = d && d.phone ? fix(d.phone) : '';
    if (!phone) {
      const m = employeePhones_();
      phone = m[bare(n)] || m[String(n).trim().toLowerCase()] || '';
      const id = (n.match(/\b(\d{5,})\b/) || [])[1];   // "Driver A 100001": employee ID in the name
      if (!phone && id) phone = m[id] || '';
    }
  }
  const office = !phone && prop_('TRACK_CALL_PHONE') ? fix(prop_('TRACK_CALL_PHONE')) : '';
  // No Employee ID shown to the customer (Kim, 24 Nov 2026): "Me Votha 100069" -> "Me Votha".
  return { name: n.replace(/^\s*\d+\s*[.\-]\s*/, '').replace(/\s*[(\[]?\b\d{5,7}\b[)\]]?\s*$/, '').trim(), phone: phone || office, office: !!office };
}
/**
 * The trip's driver; when the scale ticket had no driver (Kim, 24 Nov 2026: name and phone were blank), the last driver
 * recorded for the same truck, else the driver kept for that plate in the truck list.
 */
function tripDriverName_(rows) {
  const own = (rows.filter(r => r.driver).pop() || {}).driver;
  if (own) return own;
  const plate = normPlate(rows[0] && rows[0].plate);
  if (!plate) return '';
  try {
    const last = rowsWhere_('plate', [plate]).filter(r => r.driver).pop();
    if (last) return last.driver;
  } catch (e) { console.warn('Last driver: ' + e); }
  const t = truckRows_().find(x => x.plate === plate);
  return t ? t.driver : '';
}
/** name / ID (lower case) -> phone from the master Employee List, 10 minutes in the cache. */
function employeePhones_() {
  const cache = CacheService.getScriptCache();
  const hit = cache.get('emp_phones_v1');
  if (hit) return JSON.parse(hit);
  const out = {};
  try {
    const t = tableOf_(mdTab_('Employee List'));
    const c = k => t.head.indexOf(k), ph = c('Phone');
    if (ph >= 0) t.rows.forEach(r => {
      let p = String(r[ph] == null ? '' : r[ph]).replace(/\.0+$/, '').trim();
      if (/^[1-9]\d{7,8}$/.test(p)) p = '0' + p;
      if (!p) return;
      ['Full Name', 'Name', 'Khmer Name', 'Employee ID'].forEach(k => { const v = c(k) >= 0 ? String(r[c(k)] || '').replace(/\s+/g, ' ').trim().toLowerCase() : ''; if (v && !out[v]) out[v] = p; });
    });
  } catch (e) { console.warn('Employee phones: ' + e); }
  try { cache.put('emp_phones_v1', JSON.stringify(out), 600); } catch (e) { /* too big */ }
  return out;
}
/** What the customer sees: only this DN, the steps, the truck plate and position, the site pin, the driver's name and phone. */
function trackInfo_(p) {
  const dn = normDn(p.d), tripId = String(p.t || '').trim();
  if (!dn || !tripId || String(p.k || '') !== trackToken_(dn, tripId)) fail_('LINK', 'This link is not valid.', 'តំណនេះមិនត្រឹមត្រូវ។');
  const rows = rowsWhere_('trip', [tripId]);
  const mine = rows.filter(r => r.dn === dn);
  if (!mine.length) fail_('LINK', 'This delivery was not found.', 'រកមិនឃើញការដឹកជញ្ជូននេះ។');
  const st = tripState(rows);
  const d = st.dns[dn] || { leg: 'picked' };
  const at = code => { const r = mine.filter(x => x.code === code).pop() || (code === 7 ? rows.filter(x => x.code === 7)[0] : null); return r ? r.time : null; };
  const pl = plan_()[dn] || {};
  const custId = pl.custId || custIdOf(d.cust);
  const site = sites_()[custId];
  const done = LEG_DONE[d.leg] || st.canceled;
  const out = {
    dn: dn, tripId: tripId, plate: rows[0].plate, so: pl.so || '', kg: d.kg || d.loadKg || pl.kg || 0,
    cust: String(d.cust || pl.custName || '').replace(/^\s*\d+\s*-\s*/, ''), leg: st.canceled ? 'canceled' : d.leg,
    times: { out: at(7), arrived: at(8), unloading: at(12), unloaded: at(13), delivered: at(9), failed: at(11), canceled: at(10) },
    site: site ? site.latlong : '', factory: '11.525575,104.868668', serverNow: Date.now(),
  };
  if (!done) out.driver = driverContact_(tripDriverName_(rows));
  if (!done && st.gateOut) out.gps = gpsLast_(tripId);
  if (d.leg === 'delivered') {
    const pr = proofFor_(tripId).filter(x => normDn(x.dn) === dn).pop();
    if (pr) out.proof = { receiver: pr.receiver || '', photos: (pr.photos || []).length, signed: !!pr.signature };
    out.rateKey = rateToken_(dn, tripId);
  }
  return out;
}

// ---------------------------------------------------------------- customer Telegram bot (Kim, 22 Nov 2026)
// Bot @isisteellive_bot (token in Script property TRACK_BOT_TOKEN, never in code). A customer joins once by
// opening the join link Sales sends (t.me/<bot>?start=c<CustomerID>_<sig>); the chat is kept in "Customer Telegram".
// At every Gate Out the bot sends that customer's chats the live map link of each DN. The bot is read by a 1-minute
// timer (getUpdates), not a webhook, because Apps Script answers webhooks with a redirect that Telegram retries.
const TG_CUST = 'Customer Telegram';
XT_COLS[TG_CUST] = ['Customer ID', 'Customer Name', 'Chat ID', 'Telegram Name', 'Joined Time', 'Active'];
const TRACK_PAGE_DEFAULT = 'https://isteel-app.pages.dev/delivery/track.html';
const joinSig_ = id => b64url_(Utilities.computeHmacSha256Signature('tg|' + id, linkSecret_())).slice(0, 10);
const trackBotName_ = () => prop_('TRACK_BOT_NAME') || 'isisteellive_bot';
const trackPage_ = () => prop_('TRACK_PAGE_URL') || TRACK_PAGE_DEFAULT;
const trackLinkUrl_ = (dn, tripId) => trackPage_() + '?d=' + encodeURIComponent(dn) + '&t=' + encodeURIComponent(tripId) + '&k=' + trackToken_(dn, tripId);
function joinLink_(custId) { return /^\d{6,}$/.test(custId) ? 'https://t.me/' + trackBotName_() + '?start=c' + custId + '_' + joinSig_(custId) : ''; }

function trackBot_(method, payload) {
  const token = prop_('TRACK_BOT_TOKEN');
  if (!token) return null;
  try {
    const r = UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/' + method, { method: 'post', contentType: 'application/json', muteHttpExceptions: true, payload: JSON.stringify(payload || {}) });
    return JSON.parse(r.getContentText() || '{}');
  } catch (e) { console.error('Track bot ' + method + ': ' + e); return null; }
}
function tgChats_() {
  const out = {};
  xrows_(TG_CUST).forEach(r => {
    const id = text_(r['Customer ID']).replace(/\.0+$/, ''), chat = text_(r['Chat ID']).replace(/\.0+$/, '');
    if (id && chat && String(r.Active || 'Yes') !== 'No') (out[id] || (out[id] = [])).push(chat);
  });
  return out;
}
function trackMessage_(dn, tripId, info) {
  // Kim's wording (24 Nov 2026), Khmer only, with the driver's name and phone from Users.
  const kg = info.kg ? '=' + Math.round(info.kg).toLocaleString('en-US') + ' kg' : '';
  return {
    text: '🚚 ទំនិញរបស់អ្នកបានចេញពីរោងចក្រ អាយ អេស អាយ ហើយ\n\n'
      + '📄 លេខដឹក៖ DN ' + dn + kg + '\n'
      + '🚛 ឡាន៖ ' + info.plate + '\n'
      + '👷 អ្នកបើកបរ៖ ' + (info.driver || '-') + '\n'
      + '📞 លេខទូរស័ព្ទ៖ ' + (info.phone || '-'),
    reply_markup: { inline_keyboard: [[{ text: '📍 មើលទីតាំងឡានផ្ទាល់', url: trackLinkUrl_(dn, tripId) }]] },
  };
}
/** Driver name + phone for the Telegram message (same lookup as the live map page). */
function trackDriver_(rows) {
  const c = driverContact_(tripDriverName_(rows));
  return { driver: c.name, phone: c.phone };
}
/** Gate Out: send each DN's live map link to the customer's joined chats (once per DN and trip). */
function trackNotify_(tripId) {
  if (!prop_('TRACK_BOT_TOKEN')) return 0;
  const rows = rowsWhere_('trip', [tripId]);
  if (!rows.some(r => r.code === 7)) return 0;
  const plan = plan_(), chats = tgChats_(), st = tripState(rows), cache = CacheService.getScriptCache(), drv = trackDriver_(rows);
  let sent = 0;
  Object.keys(st.dns).forEach(dn => {
    const d = st.dns[dn];
    if (LEG_DONE[d.leg] || cache.get('tgsent_' + tripId + '_' + dn)) return;
    const pl = plan[dn] || {};
    const to = chats[pl.custId || custIdOf(d.cust)] || [];
    to.forEach(chat => {
      const m = trackMessage_(dn, tripId, Object.assign({ so: pl.so, plate: rows[0].plate, kg: d.loadKg || pl.kg }, drv));
      const r = trackBot_('sendMessage', Object.assign({ chat_id: chat }, m));
      if (r && r.ok) { sent++; tgRemember_(dn, tripId, chat, r.result && r.result.message_id); }
    });
    if (to.length) cache.put('tgsent_' + tripId + '_' + dn, '1', 21600);
  });
  return sent;
}
/** 1-minute timer: answers /start. A valid join link saves the chat for that customer and sends their deliveries on the way. */
function trackBotPoll() {
  if (!prop_('TRACK_BOT_TOKEN')) return;
  const props = PropertiesService.getScriptProperties();
  const offset = Number(props.getProperty('TRACK_BOT_OFFSET') || 0);
  const res = trackBot_('getUpdates', { offset: offset, timeout: 0, allowed_updates: ['message'] });
  if (!res || !res.ok || !res.result.length) return;
  res.result.forEach(u => {
    props.setProperty('TRACK_BOT_OFFSET', String(u.update_id + 1));
    const m = u.message;
    if (!m || !m.chat || !/^\/start\b/.test(String(m.text || ''))) return;
    const arg = String(m.text).split(/\s+/)[1] || '';
    const g = arg.match(/^c(\d{6,})_([A-Za-z0-9_-]{10})$/);
    if (!g || g[2] !== joinSig_(g[1])) {
      trackBot_('sendMessage', { chat_id: m.chat.id, text: 'សួស្តី! សូមបើកតំណដែល ISI Steel Sales ផ្ញើឲ្យ ដើម្បីទទួលដំណឹងពេលទំនិញចេញដឹក។\nHello! Please open the link ISI Steel Sales sent you to get delivery updates.' });
      return;
    }
    const custId = g[1], chat = String(m.chat.id);
    const plan = plan_();
    const name = (Object.keys(plan).map(k => plan[k]).find(x => x.custId === custId) || {}).custName || (sites_()[custId] || {}).name || '';
    withLock_(() => {
      if (!xrows_(TG_CUST).some(r => text_(r['Customer ID']).replace(/\.0+$/, '') === custId && text_(r['Chat ID']).replace(/\.0+$/, '') === chat)) {
        if (!ss_().getSheetByName(TG_CUST)) { const sh = ss_().insertSheet(TG_CUST); sh.getRange(1, 1, 1, XT_COLS[TG_CUST].length).setValues([XT_COLS[TG_CUST]]).setFontWeight('bold'); sh.setFrozenRows(1); }
        xappend_(TG_CUST, { 'Customer ID': custId, 'Customer Name': name, 'Chat ID': chat, 'Telegram Name': [m.from && m.from.first_name, m.from && m.from.last_name].filter(Boolean).join(' '), 'Joined Time': now_(), Active: 'Yes' });
      }
    });
    trackBot_('sendMessage', { chat_id: chat, text: '✅ បានភ្ជាប់រួចរាល់' + (name ? ' សម្រាប់អតិថិជន៖ ' + String(name).replace(/^\s*\d+\s*-\s*/, '') : '') + '។ អ្នកនឹងទទួលតំណផែនទីផ្ទាល់ រាល់ពេលឡានចេញពីរោងចក្រ។\nConnected. You will get a live map link every time a truck leaves ISI Steel.' });
    // Deliveries already on the way for this customer (last 3 days)
    const from = ymd_(new Date(Date.now() - 3 * 86400000));
    const dns = Object.keys(plan).filter(k => plan[k].custId === custId && (!plan[k].date || plan[k].date >= from));
    if (!dns.length) return;
    const byTrip = {};
    rowsWhere_('dn', dns).forEach(r => { if (r.trip) byTrip[r.trip] = 1; });
    Object.keys(byTrip).forEach(tripId => {
      const rows = rowsWhere_('trip', [tripId]), st = tripState(rows);
      if (!st.gateOut || st.closed) return;
      dns.filter(dn => st.dns[dn] && !LEG_DONE[st.dns[dn].leg]).forEach(dn => {
        const r = trackBot_('sendMessage', Object.assign({ chat_id: chat }, trackMessage_(dn, tripId, Object.assign({ so: plan[dn].so, plate: rows[0].plate, kg: st.dns[dn].loadKg || plan[dn].kg }, trackDriver_(rows)))));
        if (r && r.ok) tgRemember_(dn, tripId, chat, r.result && r.result.message_id);
      });
    });
  });
}
/** Run once after TRACK_BOT_TOKEN is set: turns off any webhook and starts the 1-minute bot timer. */
function setupTrackBot() {
  const r = trackBot_('deleteWebhook', {});
  if (!r) throw new Error('Add the Script property TRACK_BOT_TOKEN first.');
  if (!ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() === 'trackBotPoll')) ScriptApp.newTrigger('trackBotPoll').timeBased().everyMinutes(1).create();
  return 'Bot ready: ' + JSON.stringify(trackBot_('getMe', {}).result || {});
}

/**
 * Customer Join Links page (Kim, 24 Nov 2026): one row per customer of the Customer master with its signed join link and
 * how many Telegram chats joined. Office roles only (Admin, Supervisor, Logistics); the link itself grants nothing but updates.
 */
function joinLinks_(user) {
  if (['admin', 'supervisor', 'logistics'].indexOf(user.roleKey) < 0) fail_('DENIED', 'Only office roles can see customer join links.', 'មានតែបុគ្គលិកការិយាល័យទេ ដែលអាចមើលតំណភ្ជាប់អតិថិជន។');
  const cu = table_(SH.CUST);
  const cId = col_(cu.head, 'Customer ID'), cName = col_(cu.head, 'Customer Name'), cPhone = col_(cu.head, 'Phone Number');
  const cTg = col_(cu.head, 'Telegram');
  const chats = tgChats_();
  const seen = {};
  const rows = [];
  cu.rows.forEach(r => {
    const id = text_(r[cId]).replace(/\.0+$/, '');
    if (!/^\d{6,}$/.test(id) || seen[id]) return;
    seen[id] = 1;
    rows.push({ id: id, name: text_(r[cName]), phone: cPhone >= 0 ? text_(r[cPhone]).replace(/\.0+$/, '') : '', tg: cTg >= 0 ? text_(r[cTg]).replace(/\.0+$/, '') : '', link: joinLink_(id), chats: (chats[id] || []).length });
  });
  return { bot: !!prop_('TRACK_BOT_TOKEN'), botName: trackBotName_(), rows: rows };
}

// ---- Delivered message (Kim, 24 Nov 2026): reply to the Gate Out message in Telegram with the rating (survey) link.
const tgMsgKey_ = (dn, tripId) => 'tgm_' + dn + '_' + tripId;
/** Keeps the Gate Out message id per DN and chat (Script property, removed after Delivered / Failed / Canceled). */
function tgRemember_(dn, tripId, chat, msgId) {
  if (!msgId) return;
  const props = PropertiesService.getScriptProperties(), k = tgMsgKey_(dn, tripId);
  let m = {};
  try { m = JSON.parse(props.getProperty(k) || '{}'); } catch (e) { m = {}; }
  m[String(chat)] = msgId;
  props.setProperty(k, JSON.stringify(m));
}
const rateLinkUrl_ = (dn, tripId) => trackPage_().replace(/track\.html.*$/, 'rate.html') + '?d=' + encodeURIComponent(dn) + '&t=' + encodeURIComponent(tripId) + '&k=' + rateToken_(dn, tripId);
/** After Delivered (code 9): tell the customer's chats, as a reply to the Gate Out message when it is known. */
function tgDelivered_(tripId, rows, plate, receiver) {
  if (!prop_('TRACK_BOT_TOKEN')) return 0;
  const props = PropertiesService.getScriptProperties(), plan = plan_(), chats = tgChats_();
  let sent = 0;
  rows.forEach(r => {
    const dn = r.dn, k = tgMsgKey_(dn, tripId);
    let known = {};
    try { known = JSON.parse(props.getProperty(k) || '{}'); } catch (e) { known = {}; }
    const pl = plan[dn] || {};
    const to = Object.keys(known).length ? Object.keys(known) : (chats[pl.custId || custIdOf(r.cust)] || []);
    to.forEach(chat => {
      const body = {
        chat_id: chat,
        text: '✅ ទំនិញរបស់អ្នកបានប្រគល់រួចរាល់ហើយ\n\n'
          + '📄 លេខដឹក៖ DN ' + dn + (r.kg ? '=' + Math.round(r.kg).toLocaleString('en-US') + ' kg' : '') + '\n'
          + '🚛 ឡាន៖ ' + plate + '\n'
          + (receiver ? '👤 អ្នកទទួល៖ ' + receiver + '\n' : '')
          + '\n🙏 សូមអរគុណ! សូមជួយវាយតម្លៃសេវាដឹកជញ្ជូនរបស់យើង។',
        reply_markup: { inline_keyboard: [[{ text: '⭐ វាយតម្លៃការដឹកជញ្ជូន', url: rateLinkUrl_(dn, tripId) }]] },
      };
      if (known[chat]) body.reply_parameters = { message_id: known[chat], allow_sending_without_reply: true };
      const res = trackBot_('sendMessage', body);
      if (res && res.ok) sent++;
    });
    props.deleteProperty(k);
  });
  return sent;
}
