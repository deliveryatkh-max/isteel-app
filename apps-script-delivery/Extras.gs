/**
 * Delivery Journey: proof of delivery, ratings, complaints, customer sites, 3PL companies, delay alerts and KPIs.
 * Each feature keeps its rows in its own tab (made by setup()), so the existing tabs keep their columns.
 *
 * Extra Script Properties (optional):
 *   TELEGRAM_BOT_TOKEN   bot that posts delay, low-rating and complaint alerts (chat id is in Delivery Settings)
 */

const XT = {
  PROOF: 'Delivery Proof', CRATE: 'Customer Ratings', SRATE: 'Site Ratings', COMPLAINTS: 'Complaints',
  SITES: 'Customer Sites', COMPANIES: 'Truck Companies', SETTINGS: 'Delivery Settings',
};
const XT_COLS = {
  'Delivery Proof': ['Time', 'Key No.', 'Trip ID', 'DN', 'Receiver Name', 'Signature', 'Photos', 'User'],
  'Customer Ratings': ['Time', 'DN', 'Trip ID', 'Truck No.', '3PL', 'Overall', 'Driver Polite', 'On Time', 'Goods OK', 'Comment'],
  'Site Ratings': ['Time', 'DN', 'Trip ID', 'Truck No.', '3PL', 'Customer', 'Wait', 'Unload Help', 'Access', 'Customer Delay', 'Remark', 'Confirmed By', 'Confirmed Time'],
  'Complaints': ['Complaint ID', 'Time', 'DN', 'Trip ID', 'Truck No.', '3PL', 'Customer', 'Type', 'Detail', 'Source', 'Recorded By', 'Status', 'Resolved Time', 'Resolved By', 'Resolution'],
  'Customer Sites': ['Customer ID', 'Customer Name', 'LatLong', 'Set By', 'Set Time'],
  'Truck Companies': ['Truck No.', '3PL Company', 'Set By', 'Set Time'],
  'Delivery Settings': ['Setting', 'Value', 'Note'],
};
const SETTING_DEFAULTS = [
  ['INSIDE_WARN_MIN', 90, 'A truck inside the plant (Gate In, no Gate Out) turns orange after this many minutes'],
  ['INSIDE_LATE_MIN', 120, 'Turns red after this many minutes, and a Telegram alert is sent'],
  ['FAR_KM', 1, 'A delivery recorded further than this from the customer site is flagged'],
  ['OTIF_TARGET', 95, 'OTIF target in % for the 3PL scorecard'],
  ['RATING_TARGET', 4, 'Customer rating target (1-5 stars)'],
  ['TURNAROUND_TARGET_MIN', 180, 'Gate In to Gate Out target in minutes'],
  ['TELEGRAM_CHAT_ID', '', 'Telegram group for alerts (bot token goes in Script properties as TELEGRAM_BOT_TOKEN)'],
];
const COMPLAINT_TYPES = ['late', 'driver', 'damage', 'short', 'wrong', 'other'];

/** Called by setup(): adds the feature tabs (never touches existing ones) and the delay-alert timer. */
function setupExtras_() {
  const ss = ss_();
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
  const sh = ss_().getSheetByName(name);
  if (!sh) fail_('SETUP', 'The tab "' + name + '" is missing. Run setup() in Apps Script once more.', 'ខ្វះតារាង "' + name + '"។ សូមដំណើរការ setup() ម្តងទៀត។');
  return sh;
}
/** Rows of a feature tab as objects keyed by header (with _row = sheet row). Missing tab = no rows. */
function xrows_(name) {
  const sh = ss_().getSheetByName(name);
  if (!sh || sh.getLastRow() < 2) return [];
  const v = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues();
  const head = v[0].map(h => String(h).trim());
  return v.slice(1).map((r, i) => { const o = { _row: i + 2 }; head.forEach((h, j) => { o[h] = r[j]; }); return o; });
}
function xappend_(name, obj) {
  const sh = xtab_(name);
  const head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(h => String(h).trim());
  sh.appendRow(head.map(h => (obj[h] == null ? '' : obj[h])));
  return sh.getLastRow();
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
  ['INSIDE_WARN_MIN', 'INSIDE_LATE_MIN', 'FAR_KM', 'OTIF_TARGET', 'RATING_TARGET', 'TURNAROUND_TARGET_MIN'].forEach(k => { out[k] = Number(out[k]) || SETTING_DEFAULTS.find(d => d[0] === k)[1]; });
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

// ---------------------------------------------------------------- 3PL company of a truck
/** plate → company: ISI trucks are "ISI"; others from Truck Companies (filled at Gate In), else the driver's company. */
function companies_() {
  const cache = CacheService.getScriptCache();
  const hit = cache.get('companies_v1');
  if (hit) return JSON.parse(hit);
  const m = master_();
  const map = {};
  m.drivers.forEach(d => { if (d.plate && d.co) map[d.plate] = d.co; });
  xrows_(XT.COMPANIES).forEach(r => { const p = normPlate(r['Truck No.']); if (p && r['3PL Company']) map[p] = String(r['3PL Company']).trim(); });
  m.plates.forEach(p => { map[p.plate] = 'ISI'; });
  try { cache.put('companies_v1', JSON.stringify(map), 600); } catch (e) { /* too big to cache */ }
  return map;
}
const companyOf_ = (plate, map) => (map || companies_())[normPlate(plate)] || '';
function companyNames_(map) {
  const set = {};
  Object.keys(map).forEach(k => { if (map[k] && map[k] !== 'ISI') set[map[k]] = 1; });
  return Object.keys(set).sort();
}
/** Gate In of a non-ISI truck with a company: remembered for next time. */
function rememberCompany_(plate, company, email) {
  plate = normPlate(plate); company = String(company || '').trim().slice(0, 60);
  if (!plate || !company) return;
  const map = companies_();
  if (map[plate] === 'ISI' || map[plate] === company) return;
  const row = xrows_(XT.COMPANIES).find(r => normPlate(r['Truck No.']) === plate);
  if (row) { xset_(XT.COMPANIES, row._row, '3PL Company', company); xset_(XT.COMPANIES, row._row, 'Set By', email); xset_(XT.COMPANIES, row._row, 'Set Time', now_()); }
  else xappend_(XT.COMPANIES, { 'Truck No.': plate, '3PL Company': company, 'Set By': email, 'Set Time': now_() });
  CacheService.getScriptCache().remove('companies_v1');
}

// ---------------------------------------------------------------- proof of delivery (signature + extra photos)
function saveProof_(rows, tripId, receiver, sigUrl, photoUrls, email) {
  if (!sigUrl && !receiver && photoUrls.length < 2) return;
  const sh = xtab_(XT.PROOF);
  const head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(h => String(h).trim());
  const out = rows.map(r => {
    const o = { Time: now_(), 'Key No.': r.key, 'Trip ID': tripId, DN: r.dn, 'Receiver Name': String(receiver || '').slice(0, 80), Signature: sigUrl, Photos: photoUrls.join('\n'), User: email };
    return head.map(h => (o[h] == null ? '' : o[h]));
  });
  sh.getRange(sh.getLastRow() + 1, 1, out.length, head.length).setValues(out);
}
function proofFor_(tripId) {
  return xrows_(XT.PROOF).filter(r => String(r['Trip ID']) === tripId).map(r => ({
    key: text_(r['Key No.']), dn: normDn(r.DN), receiver: text_(r['Receiver Name']), signature: text_(r.Signature),
    photos: String(r.Photos || '').split('\n').filter(Boolean),
  }));
}

// ---------------------------------------------------------------- customer sites (location check)
function sites_() {
  const out = {};
  xrows_(XT.SITES).forEach(r => { const id = text_(r['Customer ID']).replace(/\.0+$/, ''); if (id && r.LatLong) out[id] = { latlong: text_(r.LatLong), row: r._row, name: text_(r['Customer Name']) }; });
  return out;
}
/** First delivery with a location sets the customer site (Logistics can move it later). */
function learnSites_(rows, email) {
  const sites = sites_();
  rows.forEach(r => {
    const id = custIdOf(r.cust);
    if (!id || !r.latlong || sites[id]) return;
    xappend_(XT.SITES, { 'Customer ID': id, 'Customer Name': String(r.cust).replace(/^\s*\d+\s*-\s*/, ''), LatLong: r.latlong, 'Set By': 'first delivery: ' + email, 'Set Time': now_() });
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
    if (s) { audit_(user.email, 'Customer site', '', '', id, s.latlong, ll, String(p.reason || 'Moved from trip screen')); xset_(XT.SITES, s.row, 'LatLong', ll); xset_(XT.SITES, s.row, 'Set By', user.email); xset_(XT.SITES, s.row, 'Set Time', now_()); }
    else xappend_(XT.SITES, { 'Customer ID': id, 'Customer Name': String(p.custName || ''), LatLong: ll, 'Set By': user.email, 'Set Time': now_() });
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
  const overall = star(p.overall);
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
