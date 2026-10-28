/**
 * Incident Report (គ្រោះថ្នាក់) — Google Apps Script backend for isteel-app.pages.dev/incident/.
 *
 * Bound to the "SSK-INCIDENT-REPORT" Google Sheet (Extensions > Apps Script inside that sheet). It keeps:
 *   - "Incidents" tab: one row per report (same columns as the Excel Incident Log), for filters and pivots
 *   - "Email Lists", "Supervisors", "Categories", "IR Settings" tabs: edited by admins from the app's Settings screen
 *   - Drive folder "Incident Reports" (one sub-folder per report): report.json (the full report), photos,
 *     signatures and the signed PDF.
 * Flow: the reporter fills the form and signs -> Waiting for the Warehouse Supervisor -> the supervisor signs (or sends
 * it back) -> the PDF is made, posted to Telegram and emailed to the "auto" lists -> actions are followed up -> Closed.
 *
 * Script Properties (Project Settings > Script properties):
 *   GOOGLE_CLIENT_ID   same Client ID as the other iSteel apps (web/config.js)
 *   SESSION_SECRET     copy of the Fuel app's SESSION_SECRET, so one sign-in works in every app
 *   USERS_SHEET_ID     id of the Fuel Refill Google Sheet: its "Users" tab is the one user list (tick box គ្រោះថ្នាក់),
 *                      its "Driver & Truck" tab gives the plates and drivers
 *   TELEGRAM_BOT_TOKEN optional: copy of the Fuel app's bot token; the group's chat id goes in IR Settings
 *   DELIVERY_SHEET_ID  optional: id of SSK-DELIVERY-DATA, so picking a plate fills the trip, DN and customer
 *   IR_FOLDER_ID       made by setup(); Drive folder "Incident Reports"
 *   IR_PUBLIC_KEY      made by setup(); the key in the no-sign-in link for drivers (change it to stop old QR codes)
 */

const SH = { LOG: 'Incidents', MAIL: 'Email Lists', SUP: 'Supervisors', CAT: 'Categories', SET: 'IR Settings', TXT: 'Texts' };
const LOG_COLS = ['Report No', 'Date Reported', 'Status', 'Type', 'Category', 'Incident Date', 'Time', 'Shift', 'Location', 'Warehouse',
  'Truck Plate', 'Driver', 'Company', 'Trip ID', 'DN', 'Customer', 'Injured', 'Severity', 'Likelihood', 'Risk Score', 'Risk Level',
  'Main Cause', 'Est. Cost (USD)', 'Days Lost', 'Open Actions', 'Reporter', 'Reporter Email', 'Supervisor', 'Supervisor Email',
  'Signed At', 'Closed At', 'PDF Link', 'Folder Link', 'Updated'];
const MAIL_COLS = ['List', 'Emails', 'When', 'Active'];
const SUP_COLS = ['Warehouse', 'Name', 'Email', 'Backup Email'];
const CAT_COLS = ['Category', 'Khmer', 'Types', 'Active', 'Icon'];
const TXT_COLS = ['Key (do not change)', 'Screen', 'Sub-screen', 'Step', 'Khmer', 'English'];
const SET_COLS = ['Setting', 'Value', 'Note'];
const APP_COL = 'គ្រោះថ្នាក់';      // tick box column in the Fuel Refill Users tab (added by the Fuel script)
const MAX_PHOTOS = 6;
const MAX_PHOTO_BYTES = 4 * 1024 * 1024;
const MAX_VOICE_BYTES = 4 * 1024 * 1024;   // about 3 minutes of voice
const WHEN = { button: 'Button only', auto: 'Auto after sign-off', high: 'Auto HIGH risk only' };

const TYPES = {
  road: { km: 'គ្រោះថ្នាក់លើផ្លូវ (តៃកុង)', en: 'Road incident (driver)' },
  wh: { km: 'គ្រោះថ្នាក់ក្នុងឃ្លាំង (តៃកុង)', en: 'Warehouse incident (driver)' },
  near: { km: 'ជិតកើតគ្រោះថ្នាក់ក្នុងឃ្លាំង (បុគ្គលិក)', en: 'Near miss in warehouse (employee)' },
};
const DEFAULT_CATS = [
  ['Collision with vehicle', 'បុកយានយន្តផ្សេង', 'road,wh'], ['Collision with object / building', 'បុកវត្ថុ ឬអគារ', 'road,wh,near'],
  ['Rollover', 'ក្រឡាប់ឡាន', 'road,wh'], ['Load fell / shifted', 'ទំនិញធ្លាក់ ឬរអិល', 'road,wh,near'],
  ['Goods damaged', 'ទំនិញខូចខាត', 'road,wh,near'], ['Injury to person', 'របួសមនុស្ស', 'road,wh,near'],
  ['Slip / trip / fall', 'រអិល ជំពប់ ដួល', 'wh,near'], ['Forklift / crane', 'ហ្វកលីហ្វ / ស្ទូច', 'wh,near'],
  ['Lifting / websling', 'ការលើក / Websling', 'wh,near'], ['Speeding / unsafe driving', 'បើកបរលឿន ឬគ្មានសុវត្ថិភាព', 'road,wh'],
  ['Fuel / oil spill', 'សាំង ឬប្រេងកំពប់', 'road,wh,near'], ['Fire', 'អគ្គិភ័យ', 'road,wh,near'],
  ['Theft / security', 'លួច / សន្តិសុខ', 'road,wh,near'], ['Other', 'ផ្សេងៗ', 'road,wh,near'],
];
// Emoji shown before each category in the app's dropdown; change it in the Icon column of the Categories tab.
const CAT_ICONS = { 'Collision with vehicle': '🚗', 'Collision with object / building': '🧱', Rollover: '🔄', 'Load fell / shifted': '📦',
  'Goods damaged': '💔', 'Injury to person': '🤕', 'Slip / trip / fall': '🚶', 'Forklift / crane': '🏗️', 'Lifting / websling': '⛓️',
  'Speeding / unsafe driving': '⚡', 'Fuel / oil spill': '🛢️', Fire: '🔥', 'Theft / security': '🔒', Other: '🏷️' };
const catIcon_ = (en, icon) => clip_(icon, 8) || CAT_ICONS[en] || '🏷️';
const SEVERITY = ['Near miss (no injury)', 'Minor (first aid)', 'Moderate (medical / lost time)', 'Major (hospital / big damage)', 'Critical (fatal / very big loss)'];
const SEVERITY_KM = ['ជិតកើត (គ្មានរបួស)', 'ស្រាល (ជំនួយបឋម)', 'មធ្យម (ពេទ្យ / ឈប់ការងារ)', 'ធ្ងន់ (មន្ទីរពេទ្យ / ខូចខាតធំ)', 'ធ្ងន់ធ្ងរបំផុត (ស្លាប់ / ខាតធំណាស់)'];
const LIKELY = ['Rare', 'Unlikely', 'Possible', 'Likely', 'Almost certain'];
const LIKELY_KM = ['កម្រ', 'មិនសូវកើត', 'អាចកើត', 'ទំនងកើត', 'ស្ទើរតែប្រាកដ'];
const level_ = s => (!s ? '' : s >= 15 ? 'HIGH' : s >= 8 ? 'MEDIUM' : 'LOW');
const STATUS = { wait: 'Waiting supervisor', back: 'Returned', signed: 'Signed', closed: 'Closed' };

// ---------------------------------------------------------------- web entry points
function doGet() { return json_({ ok: true, app: 'Incident Report' }); }

function doPost(e) {
  let body = {};
  try { body = JSON.parse((e && e.postData && e.postData.contents) || '{}'); } catch (err) { return json_({ ok: false, error: 'BAD: Bad request' }); }
  try {
    // Drivers and 3PL drivers report through the QR / link without signing in (the link carries IR_PUBLIC_KEY).
    if (body.action === 'publicBoot' || body.action === 'publicSubmit') return json_({ ok: true, data: publicRoute_(body.action, body.payload || {}) });
    const user = authenticate_(body.token);
    const out = { ok: true, data: route_(body.action, body.payload || {}, user) };
    if (user.session) out.session = user.session;
    return json_(out);
  } catch (err) {
    const msg = String(err && err.message || err);
    if (!/^[A-Z_]+:/.test(msg)) console.error(body.action + ' failed: ' + (err && err.stack || msg));
    return json_({ ok: false, error: /^[A-Z_]+:/.test(msg) ? msg : 'SERVER: ' + msg });
  }
}

function route_(action, p, user) {
  switch (action) {
    case 'boot': return boot_(user);
    case 'list': return list_(user);
    case 'get': return view_(getReport_(p.id, user), user);
    case 'submit': return submit_(p, user);
    case 'sign': return sign_(p, user);
    case 'sendBack': return sendBack_(p, user);
    case 'actions': return setActions_(p, user);
    case 'close': return close_(p, user);
    case 'pdf': return pdf_(p, user);
    case 'email': return email_(p, user);
    case 'trip': return trip_(p);
    case 'settings': return settings_(user);
    case 'saveSettings': return saveSettings_(p, user);
    case 'testTelegram': return testTelegram_(user);
    case 'syncTexts': return syncTexts_(p, user);
    default: fail_('BAD', 'Unknown action');
  }
}

function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function fail_(code, en, kh) { throw new Error(code + ': ' + en + (kh ? ' || ' + kh : '')); }
const prop_ = k => PropertiesService.getScriptProperties().getProperty(k) || '';
const TZ = 'Asia/Phnom_Penh';
const fmt_ = (d, f) => Utilities.formatDate(d, TZ, f);
const now_ = () => fmt_(new Date(), 'yyyy-MM-dd HH:mm');
const text_ = v => (v == null ? '' : v instanceof Date ? fmt_(v, 'yyyy-MM-dd HH:mm') : String(v).trim());
const yes_ = v => v === true || /^(yes|true|y|1|✓)$/i.test(String(v).trim());
const clip_ = (v, n) => String(v == null ? '' : v).trim().slice(0, n || 500);
const ss_ = () => SpreadsheetApp.getActive();
const EMAIL_RE = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;
const esc_ = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(28000)) fail_('BUSY', 'Many people are saving at once. Please try again.', 'មានអ្នករក្សាទុកច្រើនពេក។ សូមព្យាយាមម្តងទៀត។');
  try { return fn(); } finally { lock.releaseLock(); }
}

function sheet_(name, cols, seed) {
  const ss = ss_();
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, cols.length).setValues([cols]).setFontWeight('bold').setBackground('#011e41').setFontColor('#ffffff');
    sh.setFrozenRows(1);
    sh.getRange(1, 1, sh.getMaxRows(), cols.length).setNumberFormat('@');   // plain text: plates like 3E-2588 stay as typed
    if (seed && seed.length) sh.getRange(2, 1, seed.length, cols.length).setValues(seed);
  } else if (sh.getLastColumn() < cols.length && sh.getRange(1, 1).getValue() === cols[0]) {
    // a column added in an update (e.g. Icon in Categories): add its heading to an older tab
    const n = sh.getLastColumn();
    sh.getRange(1, n + 1, 1, cols.length - n).setValues([cols.slice(n)]).setFontWeight('bold').setBackground('#011e41').setFontColor('#ffffff');
  }
  return sh;
}
function table_(sh) {
  if (sh.getLastRow() < 2) return { head: sh.getRange(1, 1, 1, Math.max(1, sh.getLastColumn())).getValues()[0].map(h => String(h).trim()), rows: [] };
  const v = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getDisplayValues();
  return { head: v[0].map(h => String(h).trim()), rows: v.slice(1) };
}
function objs_(name, cols) {
  const t = table_(sheet_(name, cols));
  return t.rows.map(r => { const o = {}; t.head.forEach((h, i) => { o[h] = String(r[i] == null ? '' : r[i]).trim(); }); return o; });
}
function rewrite_(name, cols, rows) {
  const sh = sheet_(name, cols);
  const last = sh.getLastRow();
  if (last > 1) sh.getRange(2, 1, last - 1, cols.length).setValues(new Array(last - 1).fill(0).map(() => new Array(cols.length).fill('')));
  if (rows.length) sh.getRange(2, 1, rows.length, cols.length).setNumberFormat('@').setValues(rows);
}

// ---------------------------------------------------------------- setup (run once from the editor)
/** Adds the tabs, the Drive folder and IR_PUBLIC_KEY. Safe to run again. */
function setup() {
  sheet_(SH.LOG, LOG_COLS);
  sheet_(SH.MAIL, MAIL_COLS, [['W&L Management', '', WHEN.auto, 'Yes'], ['HSE team', '', WHEN.high, 'Yes'], ['Transport / 3PL', '', WHEN.button, 'Yes']]);
  sheet_(SH.SUP, SUP_COLS, [['SSK Warehouse', '', '', '']]);
  sheet_(SH.CAT, CAT_COLS, DEFAULT_CATS.map(c => c.concat(['Yes', catIcon_(c[0])])));
  sheet_(SH.SET, SET_COLS, [
    ['NUMBER_PREFIX', 'IR', 'Report number = prefix-year-number, e.g. IR-2026-001'],
    ['TELEGRAM_CHAT_ID', '', 'Telegram group for new and signed reports (the Fuel app\'s TELEGRAM_CHAT_ID works). Empty = off.'],
    ['APP_URL', 'https://isteel-app.pages.dev/incident/', 'Address of the app, used in Telegram buttons and emails'],
    ['PUBLIC_LINK', 'Yes', 'Yes = drivers can report through the QR / link without signing in'],
  ]);
  sheet_(SH.TXT, TXT_COLS);
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('IR_FOLDER_ID')) props.setProperty('IR_FOLDER_ID', DriveApp.createFolder('Incident Reports').getId());
  if (!props.getProperty('IR_PUBLIC_KEY')) props.setProperty('IR_PUBLIC_KEY', Utilities.getUuid().replace(/-/g, '').slice(0, 16));
  const first = ss_().getSheets()[0];
  if (first && first.getName() !== SH.LOG && first.getLastRow() === 0) ss_().deleteSheet(first);   // the empty "Sheet1"
  const notes = [];
  ['GOOGLE_CLIENT_ID', 'SESSION_SECRET', 'USERS_SHEET_ID'].forEach(k => { if (!prop_(k)) notes.push('Add ' + k + ' in Script properties.'); });
  if (!prop_('TELEGRAM_BOT_TOKEN')) notes.push('Optional: add TELEGRAM_BOT_TOKEN (copy from the Fuel app) for Telegram posts.');
  notes.push('Then: Deploy > New deployment > Web app, Execute as Me, Who has access Anyone.');
  const msg = notes.join('\n');
  console.log(msg);
  return msg;
}

// ---------------------------------------------------------------- sign-in (same sessions as the other iSteel apps)
const SESSION_DAYS = 30, SESSION_RENEW_DAYS = 15;
const b64url_ = data => Utilities.base64EncodeWebSafe(data).replace(/=+$/, '');
const b64urlText_ = s => Utilities.newBlob(Utilities.base64DecodeWebSafe(s + '==='.slice((s.length + 3) % 4))).getDataAsString();
const SESSION_HEAD = () => b64url_(JSON.stringify({ alg: 'HS256', typ: 'STEEL' }));
const sessionSig_ = t => b64url_(Utilities.computeHmacSha256Signature(t, prop_('SESSION_SECRET')));
const AUTH_MSG = ['Sign-in expired. Please sign in again.', 'ការចូលបានផុតកំណត់។ សូមចូលម្តងទៀត។'];

function makeSession_(email) {
  if (!prop_('SESSION_SECRET')) return null;
  const now = Math.floor(Date.now() / 1000);
  const body = b64url_(Utilities.newBlob(JSON.stringify({ email: email, iat: now, exp: now + SESSION_DAYS * 86400 })).getBytes());
  return SESSION_HEAD() + '.' + body + '.' + sessionSig_(SESSION_HEAD() + '.' + body);
}
function readSession_(token) {
  const parts = String(token).split('.');
  if (parts.length !== 3 || parts[0] !== SESSION_HEAD() || !prop_('SESSION_SECRET')) return null;
  if (sessionSig_(parts[0] + '.' + parts[1]) !== parts[2]) fail_('AUTH', AUTH_MSG[0], AUTH_MSG[1]);
  const b = JSON.parse(b64urlText_(parts[1]));
  if (!(b.exp * 1000 > Date.now())) fail_('AUTH', AUTH_MSG[0], AUTH_MSG[1]);
  return { email: String(b.email).toLowerCase(), exp: b.exp };
}
function verifyGoogle_(token) {
  const cache = CacheService.getScriptCache();
  const key = 'tok_' + b64url_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, token));
  const hit = cache.get(key);
  if (hit) return hit;
  const res = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(token), { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) fail_('AUTH', AUTH_MSG[0], AUTH_MSG[1]);
  const info = JSON.parse(res.getContentText());
  if (!prop_('GOOGLE_CLIENT_ID') || info.aud !== prop_('GOOGLE_CLIENT_ID')) fail_('AUTH', 'Sign-in is not set up for this app.', 'ការចូលមិនទាន់រៀបចំសម្រាប់កម្មវិធីនេះ។');
  if (String(info.email_verified) !== 'true') fail_('AUTH', 'Google email is not verified.');
  const email = String(info.email).toLowerCase();
  const left = Number(info.exp) - Math.floor(Date.now() / 1000);
  if (left > 60) cache.put(key, email, Math.min(left - 30, 3000));
  return email;
}

function authenticate_(token) {
  if (!token) fail_('AUTH', 'Please sign in.', 'សូមចូលគណនី។');
  let email, session = null;
  const own = readSession_(token);
  if (own) {
    email = own.email;
    if (own.exp - Math.floor(Date.now() / 1000) < SESSION_RENEW_DAYS * 86400) session = makeSession_(email);
  } else {
    email = verifyGoogle_(token);
    session = makeSession_(email);
  }
  const u = usersCached_().find(x => x.email === email && x.ok);
  if (!u) fail_('NOACCESS', email + ' has no Incident Report access. Ask the admin to tick ' + APP_COL + ' in Users.',
    email + ' មិនទាន់មានសិទ្ធិប្រើ ' + APP_COL + ' ទេ។ សូមស្នើអ្នកគ្រប់គ្រងធីក ' + APP_COL + ' ក្នុង Users។');
  const sups = supervisors_();
  const mine = sups.filter(s => s.email === email || s.backup === email).map(s => s.warehouse);
  return { email: email, name: u.name || email, phone: u.phone || '', admin: u.admin, reviewer: u.reviewer, supervisorOf: mine, session: session };
}

/** The one user list: the Users tab of the Fuel Refill sheet. Active = Yes and គ្រោះថ្នាក់ ticked (Fuel admins always). */
function users_() {
  const id = prop_('USERS_SHEET_ID');
  if (!id) fail_('SETUP', 'USERS_SHEET_ID is missing in Script properties.');
  const sh = SpreadsheetApp.openById(id).getSheetByName('Users');
  if (!sh || sh.getLastRow() < 2) return [];
  const v = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues();
  const head = v[0].map(h => String(h).trim());
  const c = n => head.indexOf(n);
  const e = c('Email'), n = c('Name'), r = c('Role'), a = c('Active'), tick = c(APP_COL);
  const ph = head.findIndex(h => /phone|ទូរស័ព្ទ/i.test(h));
  return v.slice(1).filter(x => x[e]).map(x => {
    const role = r >= 0 ? text_(x[r]) : '';
    const admin = /admin/i.test(role);
    return { email: String(x[e]).trim().toLowerCase(), name: n >= 0 ? text_(x[n]) : '', phone: ph >= 0 ? text_(x[ph]) : '', admin: admin, reviewer: admin || /review/i.test(role),
      ok: (a < 0 || yes_(x[a])) && (admin || (tick >= 0 && yes_(x[tick]))) };
  });
}
function usersCached_() {
  const cache = CacheService.getScriptCache();
  const hit = cache.get('ir_users');
  if (hit) return JSON.parse(hit);
  const u = users_();
  try { cache.put('ir_users', JSON.stringify(u), 60); } catch (e) { /* too big: read each time */ }
  return u;
}

// ---------------------------------------------------------------- lists (Settings tabs)
function setting_(k) { const r = objs_(SH.SET, SET_COLS).find(o => o.Setting === k); return r ? r.Value : ''; }
function supervisors_() {
  return objs_(SH.SUP, SUP_COLS).filter(o => o.Warehouse || o.Email).map(o => ({
    warehouse: o.Warehouse, name: o.Name, email: o.Email.toLowerCase(), backup: o['Backup Email'].toLowerCase() }));
}
function categories_() {
  return objs_(SH.CAT, CAT_COLS).filter(o => o.Category && (o.Active === '' || yes_(o.Active))).map(o => ({
    en: o.Category, km: o.Khmer || o.Category, icon: catIcon_(o.Category, o.Icon), types: (o.Types || 'road,wh,near').split(/[\s,]+/).filter(Boolean) }));
}
// Texts tab: every word of the app (filled by an admin's phone). Change Khmer / English there; leave the Key as it is.
function texts_() {
  const out = {};
  objs_(SH.TXT, TXT_COLS).forEach(o => { const k = o[TXT_COLS[0]]; if (k && !(k in out)) out[k] = [o.Khmer, o.English]; });
  return out;
}
function syncTexts_(p, user) {
  if (!user.admin) fail_('DENIED', 'Admins only.', 'សម្រាប់ Admin ប៉ុណ្ណោះ។');
  return withLock_(() => {
    const have = texts_();
    // rows from the app: [key, screen, sub-screen, step, Khmer, English]; written under the tab's own headings
    const add = (Array.isArray(p.rows) ? p.rows : []).slice(0, 3000)
      .map(r => r.length === 4 ? [r[0], r[1], '', '', r[2], r[3]] : r)
      .map(r => TXT_COLS.map((c, i) => clip_(r[i], i === 1 || i === 3 ? 60 : 1000)))
      .filter(r => r[0] && !(r[0] in have) && (have[r[0]] = 1));
    if (add.length) {
      const sh = sheet_(SH.TXT, TXT_COLS);
      const head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(h => String(h).trim());
      const rows = add.map(r => head.map(h => { const i = TXT_COLS.indexOf(h); return i >= 0 ? r[i] : ''; }));
      sh.getRange(sh.getLastRow() + 1, 1, rows.length, head.length).setNumberFormat('@').setValues(rows);
    }
    return { added: add.length };
  });
}
function mailLists_() {
  return objs_(SH.MAIL, MAIL_COLS).filter(o => o.List).map(o => ({
    name: o.List, emails: o.Emails.split(/[\s,;]+/).map(x => x.trim().toLowerCase()).filter(Boolean),
    when: o.When === WHEN.auto ? 'auto' : o.When === WHEN.high ? 'high' : 'button', active: o.Active === '' || yes_(o.Active) }));
}
function driverTruck_() {
  const cache = CacheService.getScriptCache();
  const hit = cache.get('ir_dt');
  if (hit) return JSON.parse(hit);
  const out = { plates: [], drivers: [] };
  try {
    const sh = SpreadsheetApp.openById(prop_('USERS_SHEET_ID')).getSheetByName('Driver & Truck');
    if (sh && sh.getLastRow() > 1) {
      const v = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getDisplayValues();
      const head = v[0].map(h => String(h).trim());
      const ip = head.indexOf('CODE'), id = head.indexOf('ឈ្មោះតៃកុង'), ic = head.indexOf('ក្រុមហ៊ុន');
      v.slice(1).forEach(r => {
        const plate = ip >= 0 ? String(r[ip]).trim() : '', drv = id >= 0 ? String(r[id]).trim() : '';
        if (plate && plate !== '0' && out.plates.indexOf(plate) < 0) out.plates.push(plate);
        if (drv && !out.drivers.some(d => d.name === drv)) out.drivers.push({ name: drv, plate: plate, company: ic >= 0 ? String(r[ic]).trim() : '' });
      });
      out.plates.sort();
    }
  } catch (e) { /* no Driver & Truck tab: plates are typed */ }
  try { cache.put('ir_dt', JSON.stringify(out), 600); } catch (e) { /* too big */ }
  return out;
}

// ---------------------------------------------------------------- who sees what
// Admins and reviewers (Role admin / reviewer in Users, e.g. HSE) see every report and the Settings / Summary.
// A Warehouse Supervisor sees the reports of their warehouse(s) and signs them. Everyone else sees their own reports.
const canSeeAll_ = u => u.admin || u.reviewer;
function canSee_(row, u) {
  return canSeeAll_(u) || row['Reporter Email'] === u.email || row['Supervisor Email'] === u.email || u.supervisorOf.indexOf(row.Warehouse) >= 0;
}
const isSupervisorFor_ = (d, u) => u.admin || d.supervisor.email === u.email || u.supervisorOf.indexOf(d.warehouse) >= 0;

function boot_(user) {
  const dt = driverTruck_();
  return {
    user: { email: user.email, name: user.name, phone: user.phone, admin: user.admin, reviewer: user.reviewer, supervisorOf: user.supervisorOf },
    categories: categories_(), supervisors: supervisors_().filter(s => s.email).map(s => ({ warehouse: s.warehouse, name: s.name, email: s.email })),
    lists: mailLists_().filter(l => l.active && l.emails.length).map(l => ({ name: l.name, count: l.emails.length, when: l.when })),
    plates: dt.plates, drivers: dt.drivers, reports: list_(user), texts: texts_(),
  };
}

function rowsAll_() {
  const t = table_(sheet_(SH.LOG, LOG_COLS));
  return t.rows.map(r => { const o = {}; t.head.forEach((h, i) => { o[h] = r[i]; }); return o; }).filter(o => o['Report No']);
}
function list_(user) {
  return rowsAll_().filter(o => canSee_(o, user)).reverse().map(o => ({
    id: o['Report No'], reported: o['Date Reported'], status: o.Status, type: o.Type, category: o.Category, date: o['Incident Date'], time: o.Time,
    location: o.Location, warehouse: o.Warehouse, plate: o['Truck Plate'], driver: o.Driver, company: o.Company, injured: o.Injured,
    severity: o.Severity, score: Number(o['Risk Score']) || 0, level: o['Risk Level'], cause: o['Main Cause'], cost: Number(o['Est. Cost (USD)']) || 0,
    open: Number(o['Open Actions']) || 0, reporter: o.Reporter, mine: o['Reporter Email'] === user.email,
    toSign: o.Status === STATUS.wait && (o['Supervisor Email'] === user.email || user.supervisorOf.indexOf(o.Warehouse) >= 0 || user.admin),
    pdf: o['PDF Link'],
  }));
}

// ---------------------------------------------------------------- storage: one Drive folder per report
function root_() { return DriveApp.getFolderById(prop_('IR_FOLDER_ID') || fail_('SETUP', 'Run setup() first.')); }
function folder_(id, make) {
  const it = root_().getFoldersByName(id);
  if (it.hasNext()) return it.next();
  return make ? root_().createFolder(id) : null;
}
function load_(id) {
  const f = folder_(String(id || ''), false);
  const it = f && f.getFilesByName('report.json');
  if (!it || !it.hasNext()) fail_('NOTFOUND', 'Report not found.', 'រកមិនឃើញរបាយការណ៍នេះទេ។');
  return JSON.parse(it.next().getBlob().getDataAsString('UTF-8'));
}
function store_(d) {
  const folder = folder_(d.id, true);
  const it = folder.getFilesByName('report.json');
  const s = JSON.stringify(d);
  if (it.hasNext()) it.next().setContent(s); else folder.createFile(Utilities.newBlob(s, 'application/json', 'report.json'));
  writeRow_(d, folder);
}
function getReport_(id, user) {
  const d = load_(id);
  const row = { 'Reporter Email': d.reporter.email, 'Supervisor Email': d.supervisor.email, Warehouse: d.warehouse };
  if (!canSee_(row, user)) fail_('DENIED', 'You cannot open this report.', 'អ្នកមិនអាចបើករបាយការណ៍នេះបានទេ។');
  return d;
}
/** What the app gets: the report plus what this person may do with it. Signature/photo files stay in Drive. */
function view_(d, user) {
  const sup = isSupervisorFor_(d, user);
  // Photos come back small (Drive thumbnail, or the photo itself, already shrunk on the phone) so the supervisor sees them.
  const thumbs = (d.photos || []).map(id => {
    try {
      const f = DriveApp.getFileById(id);
      const b = f.getThumbnail() || f.getBlob();
      return 'data:' + (b.getContentType() || 'image/jpeg') + ';base64,' + Utilities.base64Encode(b.getBytes());
    } catch (e) { return ''; }
  }).filter(Boolean);
  let voiceData = '';
  if (d.voice) try { const b = DriveApp.getFileById(d.voice).getBlob(); voiceData = 'data:' + (b.getContentType() || 'audio/webm') + ';base64,' + Utilities.base64Encode(b.getBytes()); } catch (e) { /* file gone */ }
  return Object.assign({}, d, { photoThumbs: thumbs, voiceData: voiceData,
    can: {
      edit: d.status === STATUS.back && d.reporter.email === user.email,
      sign: d.status === STATUS.wait && sup,
      actions: (d.status === STATUS.signed || d.status === STATUS.wait) && canSeeAll_(user),
      close: d.status === STATUS.signed && (sup || user.admin),
      email: d.status === STATUS.signed || d.status === STATUS.closed,
    },
  });
}

function nextId_() {
  const prefix = (setting_('NUMBER_PREFIX') || 'IR').replace(/[^A-Za-z0-9]/g, '') || 'IR';
  const year = fmt_(new Date(), 'yyyy');
  let n = 0;
  rowsAll_().forEach(o => { const m = String(o['Report No']).match(/^[A-Za-z0-9]+-(\d{4})-(\d+)$/); if (m && m[1] === year) n = Math.max(n, +m[2]); });
  return prefix + '-' + year + '-' + String(n + 1).padStart(3, '0');
}

function writeRow_(d, folder) {
  const sh = sheet_(SH.LOG, LOG_COLS);
  const score = d.severity && d.likelihood ? d.severity * d.likelihood : '';
  const injured = injuredCount_(d);
  const open = (d.actions || []).filter(a => a.what && a.status !== 'Done').length;
  const row = [d.id, d.created, d.status, (TYPES[d.type] || {}).en || d.type, d.category, d.date, d.time, d.shift, d.location, d.warehouse,
    d.plate, d.driver, d.company, d.tripId, d.dn, d.customer, String(injured), d.severity ? SEVERITY[d.severity - 1] : '',
    d.likelihood ? d.likelihood + ' ' + LIKELY[d.likelihood - 1] : '', String(score), level_(score), d.cause, String(d.cost || ''), String(d.daysLost || ''),
    String(open), d.reporter.anonymous ? 'Anonymous' : d.reporter.name, d.reporter.email, d.supervisor.name, d.supervisor.email,
    d.supervisor.at || '', d.closedAt || '', d.pdf ? d.pdf.url : '', folder.getUrl(), d.updated];
  const ids = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, 1).getDisplayValues().map(r => r[0]) : [];
  const at = ids.indexOf(d.id);
  const r = at >= 0 ? at + 2 : sh.getLastRow() + 1;
  sh.getRange(r, 1, 1, row.length).setNumberFormat('@').setValues([row.map(x => (x == null ? '' : String(x)))]);
}

// ---------------------------------------------------------------- submit (reporter)
const FIELDS = ['type', 'category', 'shift', 'date', 'time', 'location', 'warehouse', 'gps', 'road', 'weather', 'driver', 'driverId', 'plate',
  'company', 'tripId', 'dn', 'customer', 'load', 'story', 'couldHappen', 'firstAid', 'hospital', 'vehicleDamage', 'goodsDamage', 'property',
  'police', 'policeNo', 'insurance', 'cause', 'immediate', 'evidence', 'anyInjured'];
// people hurt: the injured list (step 3 "Anyone injured?") or, for older reports, people ticked as injured
const injuredCount_ = d => (d.anyInjured === 'Yes' ? Math.max(1, (d.injuredList || []).length) : 0) || (d.people || []).filter(p => p.injured).length;

function clean_(p) {
  const d = {};
  FIELDS.forEach(k => { d[k] = clip_(p[k], k === 'story' || k === 'couldHappen' || k === 'immediate' ? 3000 : 300); });
  if (!TYPES[d.type]) fail_('BAD', 'Choose the incident type.', 'សូមជ្រើសរើសប្រភេទហេតុការណ៍។');
  if (!d.category) fail_('BAD', 'Choose a category.', 'សូមជ្រើសរើសប្រភេទ។');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date)) fail_('BAD', 'Enter the date of the incident.', 'សូមបញ្ចូលថ្ងៃកើតហេតុ។');
  if (!d.story && !/^data:audio\//.test(String(p.voice || '')) && !p.keepVoice) fail_('BAD', 'Describe what happened.', 'សូមរៀបរាប់អំពីអ្វីដែលបានកើតឡើង។');
  d.plate = d.plate.toUpperCase().replace(/\s+/g, '');
  d.severity = Math.min(5, Math.max(0, parseInt(p.severity, 10) || 0));
  d.likelihood = Math.min(5, Math.max(0, parseInt(p.likelihood, 10) || 0));
  d.cost = Math.max(0, Number(p.cost) || 0);
  d.daysLost = Math.max(0, Number(p.daysLost) || 0);
  d.whys = (Array.isArray(p.whys) ? p.whys : []).slice(0, 5).map(x => clip_(x, 500));
  d.people = (Array.isArray(p.people) ? p.people : []).slice(0, 10).map(x => ({ name: clip_(x.name, 100), empId: clip_(x.empId, 40),
    company: clip_(x.company, 60), role: clip_(x.role, 60), injured: !!x.injured, injury: clip_(x.injury, 200) })).filter(x => x.name);
  d.actions = (Array.isArray(p.actions) ? p.actions : []).slice(0, 10).map(x => ({ what: clip_(x.what, 500), owner: clip_(x.owner, 100),
    due: clip_(x.due, 10), status: x.status === 'Done' ? 'Done' : x.status === 'In progress' ? 'In progress' : 'Open', done: clip_(x.done, 10) })).filter(x => x.what);
  d.injuredList = d.anyInjured === 'Yes' ? (Array.isArray(p.injuredList) ? p.injuredList : []).slice(0, 10).map(x => ({ name: clip_(x.name, 100), type: clip_(x.type, 40), lti: !!x.lti })).filter(x => x.name) : [];
  d.witnesses = (Array.isArray(p.witnesses) ? p.witnesses : []).slice(0, 5).map(x => ({ name: clip_(x.name, 100), phone: clip_(x.phone, 40) })).filter(x => x.name);
  return d;
}
function saveImage_(folder, dataUrl, name) {
  const m = String(dataUrl || '').match(/^data:(image\/(png|jpeg|webp));base64,(.+)$/);
  if (!m) return null;
  const bytes = Utilities.base64Decode(m[3]);
  if (bytes.length > MAX_PHOTO_BYTES) fail_('BIG', 'A photo is too big.', 'រូបថតធំពេក។');
  return folder.createFile(Utilities.newBlob(bytes, m[1], name)).getId();
}
/** Voice note of "what happened" (recorded on the phone). */
function saveVoice_(folder, dataUrl) {
  const m = String(dataUrl || '').match(/^data:(audio\/(webm|mp4|ogg|mpeg|aac|x-m4a))(?:;[^,]*)?;base64,(.+)$/);
  if (!m) return null;
  const bytes = Utilities.base64Decode(m[3]);
  if (bytes.length > MAX_VOICE_BYTES) fail_('BIG', 'The voice note is too long.', 'សំឡេងវែងពេក។');
  const ext = { webm: 'webm', mp4: 'm4a', ogg: 'ogg', mpeg: 'mp3', aac: 'aac', 'x-m4a': 'm4a' }[m[2]];
  return folder.createFile(Utilities.newBlob(bytes, m[1], 'voice-' + Date.now() + '.' + ext)).getId();
}
function pickSupervisor_(p, warehouse) {
  const sups = supervisors_().filter(s => s.email);
  const s = sups.find(x => x.email === String(p.supervisor || '').toLowerCase()) || sups.find(x => x.warehouse === warehouse);
  if (!s) fail_('BAD', 'Choose the Warehouse Supervisor. (Admin: add supervisors in Settings.)', 'សូមជ្រើសរើសប្រធានឃ្លាំង។ (Admin៖ បន្ថែមប្រធានឃ្លាំងក្នុងការកំណត់។)');
  return s;
}

/** New report (or a returned one sent again). p: form fields, photos [dataURL], keepPhotos [fileId], signature dataURL, anonymous. */
function submit_(p, user, publicReporter) {
  const d0 = clean_(p);
  const anonymous = !!p.anonymous && d0.type === 'near';
  if (!anonymous && !/^data:image\/png;base64,/.test(String(p.signature || ''))) fail_('BAD', 'Please sign before sending.', 'សូមចុះហត្ថលេខាមុនពេលផ្ញើ។');
  const photos = (Array.isArray(p.photos) ? p.photos : []).slice(0, MAX_PHOTOS);
  return withLock_(() => {
    let d, old = null;
    if (p.id) {
      old = load_(p.id);
      if (old.status !== STATUS.back || old.reporter.email !== (user && user.email)) fail_('DENIED', 'Only a returned report can be changed, by its reporter.', 'អាចកែបានតែរបាយការណ៍ដែលបានបញ្ជូនត្រឡប់ ដោយអ្នករាយការណ៍ប៉ុណ្ណោះ។');
    }
    const id = old ? old.id : nextId_();
    const folder = folder_(id, true);
    const sup = pickSupervisor_(p, d0.warehouse);
    const now = now_();
    d = Object.assign({}, old || {}, d0, {
      id: id, status: STATUS.wait, updated: now, warehouse: d0.warehouse || sup.warehouse,
      reporter: {
        name: anonymous ? 'Anonymous' : clip_(publicReporter ? p.reporterName : (p.reporterName || user.name), 100),
        phone: anonymous ? '' : clip_(p.reporterPhone || (user && user.phone), 40), email: user ? user.email : '',
        anonymous: anonymous, link: !!publicReporter, at: now, sig: '',
      },
      supervisor: { name: sup.name, email: sup.email, at: '', sig: '' }, returnNote: '',
    });
    if (!old) { d.created = now; d.history = []; }
    if (!d.reporter.name) fail_('BAD', 'Enter your name.', 'សូមបញ្ចូលឈ្មោះរបស់អ្នក។');
    if (!anonymous) d.reporter.sig = saveImage_(folder, p.signature, 'signature-reporter-' + Date.now() + '.png');
    const keep = (old && old.photos || []).filter(f => (p.keepPhotos || []).indexOf(f) >= 0);
    d.photos = keep.concat(photos.map((u, i) => saveImage_(folder, u, 'photo-' + Date.now() + '-' + (i + 1) + '.jpg')).filter(Boolean)).slice(0, MAX_PHOTOS);
    d.voice = saveVoice_(folder, p.voice) || (old && old.voice && p.keepVoice === old.voice ? old.voice : '');
    if (!d.story && !d.voice) fail_('BAD', 'Describe what happened.', 'សូមរៀបរាប់អំពីអ្វីដែលបានកើតឡើង។');
    if (!d.story) d.story = '🎤 (Voice note / សំឡេង)';
    d.history = (d.history || []).concat([{ at: now, by: d.reporter.name, what: old ? 'Sent again' : 'Reported and signed' }]);
    store_(d);
    telegramNew_(d);
    return { id: id, status: d.status };
  });
}

// ---------------------------------------------------------------- supervisor
function sign_(p, user) {
  return withLock_(() => {
    const d = load_(p.id);
    if (d.status !== STATUS.wait) fail_('BAD', 'This report is not waiting for a signature.', 'របាយការណ៍នេះមិនរង់ចាំហត្ថលេខាទេ។');
    if (!isSupervisorFor_(d, user)) fail_('DENIED', 'Only the Warehouse Supervisor can sign this report.', 'មានតែប្រធានឃ្លាំងទេដែលអាចចុះហត្ថលេខាបាន។');
    if (!/^data:image\/png;base64,/.test(String(p.signature || ''))) fail_('BAD', 'Please sign first.', 'សូមចុះហត្ថលេខាជាមុនសិន។');
    const folder = folder_(d.id, true);
    const now = now_();
    if (Array.isArray(p.actions) && canSeeAll_(user)) d.actions = clean_(Object.assign({}, d, { actions: p.actions })).actions;
    if (p.comment) d.supComment = clip_(p.comment, 1000);
    d.supervisor = { name: user.name, email: user.email, at: now, sig: saveImage_(folder, p.signature, 'signature-supervisor-' + Date.now() + '.png') };
    d.status = STATUS.signed;
    d.updated = now;
    d.history = (d.history || []).concat([{ at: now, by: user.name, what: 'Signed by Warehouse Supervisor' }]);
    const pdf = makePdf_(d, folder);
    d.pdf = { id: pdf.getId(), url: pdf.getUrl(), at: now };
    store_(d);
    telegramSigned_(d, pdf);
    const sent = autoEmail_(d, pdf, user);
    return { id: d.id, status: d.status, pdf: d.pdf.url, emailed: sent };
  });
}
function sendBack_(p, user) {
  return withLock_(() => {
    const d = load_(p.id);
    if (d.status !== STATUS.wait || !isSupervisorFor_(d, user)) fail_('DENIED', 'Only the Warehouse Supervisor can send it back.', 'មានតែប្រធានឃ្លាំងទេដែលអាចបញ្ជូនត្រឡប់បាន។');
    const note = clip_(p.note, 1000);
    if (!note) fail_('BAD', 'Write what needs to change.', 'សូមសរសេរអ្វីដែលត្រូវកែ។');
    if (!d.reporter.email) fail_('BAD', 'This report came from the driver link; the driver cannot edit it. Sign it, or add a comment.', 'របាយការណ៍នេះមកពីតំណតៃកុង ដែលតៃកុងមិនអាចកែបាន។ សូមចុះហត្ថលេខា ឬបន្ថែមមតិ។');
    d.status = STATUS.back; d.returnNote = note; d.updated = now_();
    d.history = (d.history || []).concat([{ at: d.updated, by: user.name, what: 'Sent back: ' + note }]);
    store_(d);
    telegram_('sendMessage', { text: '↩️ <b>' + esc_(d.id) + '</b> sent back to ' + esc_(d.reporter.name) + ' by ' + esc_(user.name) + '\n' + esc_(note), parse_mode: 'HTML' });
    return { id: d.id, status: d.status };
  });
}
function setActions_(p, user) {
  return withLock_(() => {
    const d = load_(p.id);
    if (!canSeeAll_(user)) fail_('DENIED', 'Only an admin or reviewer can update actions.', 'មានតែ Admin ឬអ្នកត្រួតពិនិត្យទេដែលអាចកែវិធានការបាន។');
    if (d.status === STATUS.closed) fail_('BAD', 'This report is closed.', 'របាយការណ៍នេះបានបិទហើយ។');
    const today = fmt_(new Date(), 'yyyy-MM-dd');
    d.actions = clean_(Object.assign({}, d, { actions: p.actions })).actions.map(a => Object.assign(a, { done: a.status === 'Done' ? (a.done || today) : '' }));
    d.updated = now_();
    d.history = (d.history || []).concat([{ at: d.updated, by: user.name, what: 'Actions updated' }]);
    store_(d);
    return view_(d, user);
  });
}
function close_(p, user) {
  return withLock_(() => {
    const d = load_(p.id);
    if (d.status !== STATUS.signed || (!isSupervisorFor_(d, user) && !user.admin)) fail_('DENIED', 'Only the Warehouse Supervisor or an admin can close a signed report.', 'មានតែប្រធានឃ្លាំង ឬ Admin ទេដែលអាចបិទរបាយការណ៍បាន។');
    const open = (d.actions || []).filter(a => a.status !== 'Done');
    if (open.length && !p.force) fail_('OPEN', open.length + ' action(s) are not done yet.', 'នៅមានវិធានការ ' + open.length + ' មិនទាន់រួចរាល់។');
    d.status = STATUS.closed; d.closedAt = now_(); d.updated = d.closedAt;
    d.history = (d.history || []).concat([{ at: d.updated, by: user.name, what: 'Case closed' }]);
    const pdf = makePdf_(d, folder_(d.id, true));
    d.pdf = { id: pdf.getId(), url: pdf.getUrl(), at: d.updated };
    store_(d);
    return view_(d, user);
  });
}

// ---------------------------------------------------------------- PDF (Google Doc -> PDF, so Khmer text renders well)
const NAVY = '#011e41', SOFT = '#d4e1f5', LINE = '#b9c3cf';
const two_ = (km, en) => km + ' · ' + en;
const CAUSE_KM = { 'People (behaviour, training)': 'មនុស្ស (ឥរិយាបថ ការបណ្តុះបណ្តាល)', 'Equipment / vehicle': 'ឧបករណ៍ / ឡាន',
  'Method / procedure': 'វិធីសាស្ត្រ / នីតិវិធី', 'Environment (road, weather, light)': 'បរិស្ថាន (ផ្លូវ អាកាសធាតុ ពន្លឺ)',
  'Material / load': 'ទំនិញ / ការផ្ទុក', 'Management / supervision': 'ការគ្រប់គ្រង / ត្រួតពិនិត្យ' };

function catKm_(en) { const c = categories_().find(x => x.en === en); return c && c.km !== en ? c.km + ' / ' + en : en; }

// ISI logo (web/icons/isi-logo.png), kept here so the PDF never depends on a download.
const LOGO_B64 = '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';

/** One-page PDF: compact header with the ISI STEEL logo on the right, then short label/value tables. */
function makePdf_(d, folder) {
  const name = d.id + (d.status === STATUS.wait ? ' (draft)' : '');
  const doc = DocumentApp.create(name);
  const docFile = DriveApp.getFileById(doc.getId());
  try {
    const body = doc.getBody();
    body.setMarginTop(24).setMarginBottom(20).setMarginLeft(28).setMarginRight(28);
    const base = {};
    base[DocumentApp.Attribute.FONT_FAMILY] = 'Noto Sans Khmer';
    base[DocumentApp.Attribute.FONT_SIZE] = 8;
    try { body.setAttributes(base); } catch (e) { /* font not offered: keep the default */ }

    // header: title and number on the left, logo on the right
    const head = body.appendTable([['ISI STEEL · INCIDENT & NEAR MISS REPORT\nរបាយការណ៍គ្រោះថ្នាក់ និងហេតុការណ៍ជិតកើតគ្រោះថ្នាក់\n' +
      d.id + '  ·  ' + two_('រាយការណ៍', 'Reported') + ' ' + d.created + '  ·  ' + two_('ស្ថានភាព', 'Status') + ' ' + d.status, '']]);
    head.setBorderWidth(0);
    head.editAsText().setBackgroundColor(null);
    const hl = head.getRow(0).getCell(0), hr = head.getRow(0).getCell(1);
    hl.editAsText().setForegroundColor(NAVY).setBold(true).setFontSize(10);
    hr.setWidth(110);
    try {
      const lp = hr.getChild(0).asParagraph();
      lp.setAlignment(DocumentApp.HorizontalAlignment.RIGHT);
      fit_(lp.appendInlineImage(Utilities.newBlob(Utilities.base64Decode(LOGO_B64), 'image/png', 'isi.png')), 34, 34);
      lp.appendText(' STEEL').setForegroundColor(NAVY).setBold(true).setFontSize(16);
    } catch (e) { hr.editAsText().setText('ISI STEEL'); }

    const sc = d.severity && d.likelihood ? d.severity * d.likelihood : 0;
    section_(body, 'A. ' + two_('ប្រភេទហេតុការណ៍ ពេលវេលា ទីកន្លែង', 'TYPE, WHEN AND WHERE'));
    kv_(body, [[two_('ប្រភេទ', 'Type'), (TYPES[d.type] || {}).km + ' / ' + (TYPES[d.type] || {}).en, two_('ប្រភេទរង', 'Category'), catKm_(d.category)],
      [two_('ថ្ងៃ ម៉ោង', 'Date / time'), d.date + ' ' + d.time + (d.shift ? ' · ' + d.shift : ''), two_('អ្នករាយការណ៍', 'Reported by'), d.reporter.name + (d.reporter.phone ? ' · ' + d.reporter.phone : '')],
      [two_('ទីកន្លែង', 'Location'), d.location + (d.gps ? ' (' + d.gps + ')' : ''), two_('ឃ្លាំង', 'Warehouse'), d.warehouse],
      [two_('ស្ថានភាពផ្លូវ', 'Road / site'), d.road, two_('អាកាសធាតុ', 'Weather / light'), d.weather]]);
    if (d.plate || d.driver || d.dn || d.company) {
      section_(body, 'B. ' + two_('តៃកុង និងឡាន', 'DRIVER AND TRUCK'));
      kv_(body, [[two_('តៃកុង', 'Driver'), d.driver, two_('ផ្លាកលេខ', 'Truck plate'), d.plate],
        [two_('ក្រុមហ៊ុន', 'Company'), d.company, two_('លេខដឹកជញ្ជូន', 'DN #'), d.dn]]);
    }
    section_(body, 'C. ' + two_('តើមានអ្វីកើតឡើង', 'WHAT HAPPENED'));
    body.appendParagraph(d.story || '-').setSpacingAfter(2);
    if ((d.people || []).length) grid_(body, [['Name', 'Employee ID', 'Company', 'Role', 'Injured?', 'Injury']].concat(d.people.map(x => [x.name, x.empId, x.company, x.role, x.injured ? 'Yes' : 'No', x.injury])));
    section_(body, 'D. ' + two_('របួស និងការខូចខាត', 'INJURY AND DAMAGE'));
    const inj = (d.injuredList || []).map(x => x.name + (x.type ? ' (' + x.type + ')' : '') + (x.lti ? ' · LTI' : '')).join('; ');
    kv_(body, [[two_('មានអ្នករងរបួស?', 'Anyone injured?'), [d.anyInjured, inj].filter(Boolean).join(' · '), two_('LTI', 'Lost time injury'), d.anyInjured ? ((d.injuredList || []).some(x => x.lti) ? 'Yes' : 'No') : ''],
      [two_('ខូចខាតឡាន', 'Vehicle damage'), d.vehicleDamage, two_('ខូចខាតទំនិញ', 'Goods damage'), d.goodsDamage],
      [two_('ទ្រព្យសម្បត្តិ', 'Property / other'), d.property, two_('ធានារ៉ាប់រងមកពិនិត្យ', 'Insurance inspected'), d.insurance || ''],
      [two_('ជំនួយបឋម', 'First aid'), d.firstAid, two_('ភស្តុតាង', 'Video / CCTV'), d.evidence],
      [two_('សាក្សី', 'Witnesses'), (d.witnesses || []).map(w => w.name + (w.phone ? ' · ' + w.phone : '')).join('; '), two_('ថ្លៃប៉ាន់ស្មាន', 'Est. cost'), d.cost ? '$' + d.cost : '']]);
    section_(body, 'E. ' + two_('ហានិភ័យ និងមូលហេតុ', 'RISK AND CAUSE'));
    kv_(body, [[two_('ភាពធ្ងន់ធ្ងរ', 'Severity'), d.severity ? d.severity + ' ' + SEVERITY[d.severity - 1] : '', two_('លទ្ធភាព', 'Likelihood'), d.likelihood ? d.likelihood + ' ' + LIKELY[d.likelihood - 1] : ''],
      [two_('ពិន្ទុ', 'Risk score'), sc ? sc + ' · ' + level_(sc) : '', two_('មូលហេតុចម្បង', 'Main cause'), d.cause ? (CAUSE_KM[d.cause] ? CAUSE_KM[d.cause] + ' / ' : '') + d.cause : '']]);
    const whys = (d.whys || []).filter(Boolean);
    if (whys.length) kv_(body, [[two_('ហេតុអ្វី', 'Why'), whys.join(' → ')]]);
    section_(body, 'F. ' + two_('វិធានការ', 'ACTIONS'));
    kv_(body, [[two_('វិធានការភ្លាមៗ', 'Immediate action'), d.immediate]]);
    if ((d.actions || []).length) grid_(body, [['Corrective / preventive action', 'Owner', 'Due', 'Status', 'Done']].concat(d.actions.map(a => [a.what, a.owner, a.due, a.status, a.done])));
    const notes = [];
    if (d.supComment) notes.push([two_('មតិប្រធានឃ្លាំង', 'Supervisor comment'), d.supComment]);
    if (d.voice) notes.push([two_('សំឡេង', 'Voice note'), 'Saved in the report folder / រក្សាទុកក្នុង Folder របាយការណ៍']);
    if (notes.length) kv_(body, notes);
    if ((d.photos || []).length) {
      section_(body, 'G. ' + two_('រូបថត', 'PHOTOS') + ' (' + d.photos.length + ')');
      const p = body.appendParagraph('');
      d.photos.slice(0, 4).forEach(id => { try { const img = p.appendInlineImage(DriveApp.getFileById(id).getBlob()); fit_(img, 128, 90); p.appendText(' '); } catch (e) { /* photo gone */ } });
    }
    section_(body, two_('ហត្ថលេខា', 'SIGN-OFF'));
    const t = body.appendTable([[two_('អ្នករាយការណ៍', 'Reported by'), two_('ប្រធានឃ្លាំង', 'Warehouse Supervisor')], ['', ''],
      [d.reporter.name + (d.reporter.at ? ' · ' + d.reporter.at : ''), (d.supervisor.name || '') + ' · ' + (d.supervisor.at || two_('រង់ចាំ', 'Waiting'))]]);
    t.setBorderColor(LINE);
    t.editAsText().setBackgroundColor(null);
    compact_(t);
    [0, 1].forEach(i => t.getRow(0).getCell(i).setBackgroundColor(SOFT).editAsText().setBold(true));
    [[d.reporter.sig, 0], [d.supervisor.sig, 1]].forEach(s => {
      if (!s[0]) return;
      try { fit_(t.getRow(1).getCell(s[1]).getChild(0).asParagraph().appendInlineImage(DriveApp.getFileById(s[0]).getBlob()), 130, 40); } catch (e) { /* no image */ }
    });
    // A new Doc starts with one empty paragraph; drop it so the header is first.
    if (body.getNumChildren() > 1 && body.getChild(0).asText().getText() === '') body.getChild(0).removeFromParent();
    doc.saveAndClose();
    const pdfName = d.id + '.pdf';
    const old = folder.getFilesByName(pdfName);
    while (old.hasNext()) old.next().setTrashed(true);
    return folder.createFile(docFile.getAs('application/pdf').setName(pdfName));
  } finally {
    docFile.setTrashed(true);   // only the PDF is kept
  }
}
function fit_(img, w, h) {
  const k = Math.min(w / img.getWidth(), h / img.getHeight(), 1);
  img.setWidth(Math.round(img.getWidth() * k)).setHeight(Math.round(img.getHeight() * k));
  return img;
}
function section_(body, title) {
  const p = body.appendParagraph(title);
  p.editAsText().setForegroundColor(NAVY).setBold(true).setFontSize(8.5).setBackgroundColor(null);   // no highlight behind the words
  p.setSpacingBefore(4).setSpacingAfter(1);
}
/** Label / value rows: 2 or 4 cells per row; empty values print as "-". */
// page width 539 pt (A4 minus margins): labels 92 pt, values share the rest
const PAGE_W = 539, LABEL_W = 92;
function compact_(t) {
  for (let i = 0; i < t.getNumRows(); i++) { const r = t.getRow(i); for (let j = 0; j < r.getNumCells(); j++) r.getCell(j).setPaddingTop(1).setPaddingBottom(1).setPaddingLeft(3).setPaddingRight(3); }
}
function kv_(body, rows) {
  rows = rows.filter(r => r.some((x, i) => i % 2 === 1 && x));
  if (!rows.length) return;
  const w = Math.max.apply(null, rows.map(r => r.length));
  const t = body.appendTable(rows.map(r => { const o = r.map((x, i) => (i % 2 === 1 ? String(x || '-') : String(x || ''))); while (o.length < w) o.push(''); return o; }));
  t.setBorderColor(LINE);
  t.editAsText().setBackgroundColor(null);   // cells are shaded; the words themselves are never highlighted
  for (let i = 0; i < t.getNumRows(); i++) for (let j = 0; j < w; j += 2) t.getRow(i).getCell(j).setBackgroundColor('#f2f5f9').editAsText().setBold(true);
  const vw = (PAGE_W - LABEL_W * (w / 2)) / (w / 2);
  for (let j = 0; j < w; j++) t.setColumnWidth(j, j % 2 ? vw : LABEL_W);
  compact_(t);
}
function grid_(body, rows) {
  const t = body.appendTable(rows.map(r => r.map(x => String(x || ''))));
  t.setBorderColor(LINE);
  t.editAsText().setBackgroundColor(null);
  const r = t.getRow(0);
  for (let i = 0; i < r.getNumCells(); i++) r.getCell(i).setBackgroundColor(SOFT).editAsText().setBold(true);
  compact_(t);
}

/** The PDF for the app to open or save: the signed one when there is one, otherwise a fresh draft. Sent as base64,
 *  because the Drive file belongs to the account that runs the script and others cannot open its link. */
function pdf_(p, user) {
  const d = getReport_(p.id, user);
  let file = null;
  if (d.pdf && d.pdf.id) { try { file = DriveApp.getFileById(d.pdf.id); if (file.isTrashed()) file = null; } catch (e) { file = null; } }
  if (!file) {
    file = makePdf_(d, folder_(d.id, true));
    if (d.status !== STATUS.wait) withLock_(() => { const x = load_(d.id); x.pdf = { id: file.getId(), url: file.getUrl(), at: now_() }; store_(x); });
  }
  return { name: d.id + '.pdf', b64: Utilities.base64Encode(file.getBlob().getBytes()) };
}

// ---------------------------------------------------------------- email
function listEmails_(names) {
  const out = [];
  mailLists_().filter(l => l.active && names.indexOf(l.name) >= 0).forEach(l => l.emails.forEach(e => { if (EMAIL_RE.test(e) && out.indexOf(e) < 0) out.push(e); }));
  return out;
}
function sendMail_(d, pdfFile, to, by, note) {
  if (!to.length) return 0;
  if (MailApp.getRemainingDailyQuota() < to.length) fail_('LIMIT', 'Google\'s daily email limit is reached. Try again tomorrow.', 'ដល់ចំនួនអ៊ីមែលកំណត់ប្រចាំថ្ងៃហើយ។ សូមព្យាយាមថ្ងៃស្អែក។');
  const sc = d.severity && d.likelihood ? d.severity * d.likelihood : 0;
  const row = (k, v) => v ? '<tr><td style="padding:4px 8px;background:#f2f5f9;font-weight:600;border:1px solid #d6dee8">' + esc_(k) + '</td><td style="padding:4px 8px;border:1px solid #d6dee8">' + esc_(v) + '</td></tr>' : '';
  const url = setting_('APP_URL');
  const html = '<div style="font-family:Arial,\'Noto Sans Khmer\',sans-serif;color:#011e41;max-width:680px">' +
    (note ? '<p style="white-space:pre-line">' + esc_(note) + '</p>' : '') +
    '<div style="background:#011e41;color:#fff;padding:12px 16px;border-radius:8px"><div style="font-size:12px;opacity:.8">ISI STEEL · Incident report · របាយការណ៍គ្រោះថ្នាក់</div>' +
    '<div style="font-size:18px;font-weight:700">' + esc_(d.id) + ' · ' + esc_((TYPES[d.type] || {}).en) + '</div><div style="font-size:12px;opacity:.85">' +
    esc_([d.category, d.date + ' ' + d.time, d.location].filter(String).join(' · ')) + '</div></div>' +
    '<table style="border-collapse:collapse;width:100%;margin-top:10px;font-size:13px">' +
    row('Status', d.status) + row('Truck / driver', [d.plate, d.driver].filter(String).join(' · ')) + row('Injured', String(injuredCount_(d))) +
    row('Risk', sc ? sc + ' ' + level_(sc) : '') + row('What happened', d.story) + row('Main cause', d.cause) +
    row('Actions', (d.actions || []).map(a => a.what + ' (' + (a.owner || '-') + ', ' + (a.due || '-') + ', ' + a.status + ')').join('\n')) +
    row('Signed', [d.reporter.name + ' ' + (d.reporter.at || ''), d.supervisor.at ? d.supervisor.name + ' ' + d.supervisor.at : ''].filter(String).join(' · ')) + '</table>' +
    (url ? '<p><a href="' + esc_(url) + '#/r/' + encodeURIComponent(d.id) + '">Open in the iSteel app</a></p>' : '') +
    '<p style="color:#546274;font-size:12px">The signed PDF is attached.</p></div>';
  MailApp.sendEmail({ to: to.join(','), subject: 'Incident report ' + d.id + ': ' + d.category + ' (' + d.date + ')' + (sc >= 15 ? ' · HIGH RISK' : ''),
    htmlBody: html, name: 'ISI Steel Incident Report', replyTo: by && by.email || '', attachments: [pdfFile.getBlob().setName(d.id + '.pdf')] });
  d.sent = (d.sent || []).concat([{ at: now_(), by: by ? by.name : 'auto', to: to }]);
  return to.length;
}
function autoEmail_(d, pdf, user) {
  const sc = d.severity && d.likelihood ? d.severity * d.likelihood : 0;
  const names = mailLists_().filter(l => l.active && (l.when === 'auto' || (l.when === 'high' && sc >= 15))).map(l => l.name);
  try {
    const n = sendMail_(d, pdf, listEmails_(names), user, '');
    if (n) { d.history = d.history.concat([{ at: now_(), by: 'auto', what: 'Emailed to ' + names.join(', ') }]); store_(d); }
    return n;
  } catch (e) { console.error('auto email failed: ' + e); return 0; }
}
/** Send by email button: p.lists (names), p.extra (typed addresses), p.note. */
function email_(p, user) {
  const d = getReport_(p.id, user);
  if (d.status !== STATUS.signed && d.status !== STATUS.closed) fail_('BAD', 'The report can be emailed once it is signed.', 'អាចផ្ញើតាមអ៊ីមែលបាន ពេលរបាយការណ៍ចុះហត្ថលេខារួច។');
  const extra = String(p.extra || '').split(/[\s,;]+/).map(x => x.trim().toLowerCase()).filter(Boolean);
  const bad = extra.filter(x => !EMAIL_RE.test(x));
  if (bad.length) fail_('BAD', 'Check these email addresses: ' + bad.join(', '), 'សូមពិនិត្យអ៊ីមែលទាំងនេះ៖ ' + bad.join(', '));
  const to = listEmails_(Array.isArray(p.lists) ? p.lists : []);
  extra.forEach(e => { if (to.indexOf(e) < 0) to.push(e); });
  if (!to.length) fail_('BAD', 'Tick a list or type an email.', 'សូមធីកបញ្ជី ឬវាយអ៊ីមែល។');
  if (to.length > 40) fail_('BAD', 'Up to 40 people per email.', 'អាចផ្ញើបានច្រើនបំផុត 40 នាក់ក្នុងមួយអ៊ីមែល។');
  return withLock_(() => {
    let file = null;
    try { file = d.pdf && DriveApp.getFileById(d.pdf.id); file.getName(); } catch (e) { file = null; }
    if (!file) { file = makePdf_(d, folder_(d.id, true)); d.pdf = { id: file.getId(), url: file.getUrl(), at: now_() }; }
    const n = sendMail_(d, file, to, user, clip_(p.note, 1000));
    d.history = (d.history || []).concat([{ at: now_(), by: user.name, what: 'Emailed to ' + n + ' people' }]);
    store_(d);
    return { sent: n };
  });
}

// ---------------------------------------------------------------- Telegram (same bot as the Fuel app)
function telegram_(method, payload) {
  const token = prop_('TELEGRAM_BOT_TOKEN'), chat = setting_('TELEGRAM_CHAT_ID');
  if (!token || !chat) return null;
  try {
    const res = UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/' + method, { method: 'post', payload: Object.assign({ chat_id: chat }, payload), muteHttpExceptions: true });
    const out = JSON.parse(res.getContentText() || '{}');
    if (!out.ok) console.error('telegram ' + method + ': ' + res.getContentText());
    return out;
  } catch (e) { console.error('telegram ' + method + ': ' + e); return null; }
}
function appLink_(d) { const u = setting_('APP_URL'); return u ? u + '#/r/' + encodeURIComponent(d.id) : ''; }
function telegramNew_(d) {
  const sc = d.severity && d.likelihood ? d.severity * d.likelihood : 0;
  const icon = { road: '🚚', wh: '🏭', near: '👀' }[d.type] || '⚠️';
  const injured = injuredCount_(d);
  const lines = ['⚠️ <b>New incident ' + esc_(d.id) + '</b>', icon + ' ' + esc_((TYPES[d.type] || {}).en) + ' · ' + esc_(d.category),
    '📍 ' + esc_([d.location || d.warehouse, d.date + ' ' + d.time].filter(String).join(' · ')),
    d.plate || d.driver ? '🚛 ' + esc_([d.plate, d.driver].filter(String).join(' · ')) : '', injured ? '🤕 ' + injured + ' injured' : '',
    sc ? (sc >= 15 ? '🔴' : sc >= 8 ? '🟠' : '🟢') + ' Risk <b>' + sc + ' ' + level_(sc) + '</b>' : '',
    '✍️ ' + esc_(d.reporter.name) + '. Waiting for: <b>' + esc_(d.supervisor.name || d.supervisor.email) + '</b>'].filter(Boolean);
  const link = appLink_(d);
  telegram_('sendMessage', Object.assign({ text: lines.join('\n'), parse_mode: 'HTML' },
    link ? { reply_markup: JSON.stringify({ inline_keyboard: [[{ text: 'Open and sign · បើក និងចុះហត្ថលេខា', url: link }]] }) } : {}));
}
function telegramSigned_(d, pdf) {
  const link = appLink_(d);
  telegram_('sendDocument', Object.assign({ document: pdf.getBlob().setName(d.id + '.pdf'), parse_mode: 'HTML',
    caption: '✅ <b>' + esc_(d.id) + ' signed</b> by ' + esc_(d.supervisor.name) + ', ' + esc_(d.supervisor.at) },
    link ? { reply_markup: JSON.stringify({ inline_keyboard: [[{ text: 'Open · បើក', url: link }]] }) } : {}));
}
function testTelegram_(user) {
  if (!user.admin) fail_('DENIED', 'Admins only.', 'សម្រាប់ Admin ប៉ុណ្ណោះ។');
  if (!prop_('TELEGRAM_BOT_TOKEN')) fail_('SETUP', 'Add TELEGRAM_BOT_TOKEN in Script properties first.', 'សូមបន្ថែម TELEGRAM_BOT_TOKEN ក្នុង Script properties ជាមុនសិន។');
  if (!setting_('TELEGRAM_CHAT_ID')) fail_('SETUP', 'Enter the Telegram chat ID first.', 'សូមបញ្ចូល Telegram chat ID ជាមុនសិន។');
  const r = telegram_('sendMessage', { text: '✅ Incident Report app is connected. Test by ' + user.name });
  if (!r || !r.ok) fail_('TG', 'Telegram refused: ' + (r && r.description || 'no answer') + '. Check the chat ID and that the bot is in the group.', 'Telegram បដិសេធ។ សូមពិនិត្យ chat ID និងថា bot នៅក្នុងក្រុម។');
  return { ok: true };
}

// ---------------------------------------------------------------- trip lookup (Delivery Journey)
/** Latest Delivery trip of this plate on this date: Trip ID, driver, DNs and customers. Empty when not set up or not found. */
function trip_(p) {
  const id = prop_('DELIVERY_SHEET_ID');
  const plate = String(p.plate || '').toUpperCase().replace(/\s+/g, '');
  if (!id || !plate) return {};
  const date = String(p.date || '');
  const key = 'ir_trip_' + plate + '_' + date;
  const cache = CacheService.getScriptCache();
  const hit = cache.get(key);
  if (hit) return JSON.parse(hit);
  const ss = SpreadsheetApp.openById(id);
  const trips = ss.getSheetByName('Trips');
  if (!trips || trips.getLastRow() < 2) return {};
  const from = Math.max(2, trips.getLastRow() - 1500);
  const tv = trips.getRange(from, 1, trips.getLastRow() - from + 1, 4).getValues();
  const day = v => (v instanceof Date ? fmt_(v, 'yyyy-MM-dd') : String(v).replace(/^(\d{2})\/(\d{2})\/(\d{4}).*$/, '$3-$2-$1').slice(0, 10));
  let hitRow = null;
  tv.forEach(r => { if (String(r[2]).toUpperCase().replace(/\s+/g, '') === plate && (!date || day(r[1]) === date)) hitRow = r; });
  if (!hitRow) return {};
  const out = { tripId: text_(hitRow[0]), driver: text_(hitRow[3]), dn: '', customer: '' };
  const log = ss.getSheetByName('Time Log');
  if (log && log.getLastRow() > 1) {
    const head = log.getRange(1, 1, 1, log.getLastColumn()).getValues()[0].map(h => String(h).trim());
    const iT = head.indexOf('Master Trip ID'), iD = head.indexOf('លេខដឹកជញ្ជូន (DN#)'), iC = head.indexOf('អតិថិជន');
    if (iT >= 0) {
      const lf = Math.max(2, log.getLastRow() - 6000);
      const dns = [], custs = [];
      log.getRange(lf, 1, log.getLastRow() - lf + 1, head.length).getValues().forEach(r => {
        if (text_(r[iT]) !== out.tripId) return;
        const dn = iD >= 0 ? text_(r[iD]) : '', c = iC >= 0 ? text_(r[iC]) : '';
        if (dn && dns.indexOf(dn) < 0) dns.push(dn);
        if (c && custs.indexOf(c) < 0) custs.push(c);
      });
      out.dn = dns.join(', '); out.customer = custs.join(', ');
    }
  }
  try { cache.put(key, JSON.stringify(out), 300); } catch (e) { /* ignore */ }
  return out;
}

// ---------------------------------------------------------------- Settings screen (admins)
function settings_(user) {
  if (!user.admin) fail_('DENIED', 'Admins only.', 'សម្រាប់ Admin ប៉ុណ្ណោះ។');
  return {
    lists: mailLists_(), supervisors: supervisors_(), categories: objs_(SH.CAT, CAT_COLS).filter(o => o.Category).map(o => ({ en: o.Category, km: o.Khmer, icon: catIcon_(o.Category, o.Icon), types: o.Types, active: o.Active === '' || yes_(o.Active) })),
    telegramChat: setting_('TELEGRAM_CHAT_ID'), telegramBot: !!prop_('TELEGRAM_BOT_TOKEN'), prefix: setting_('NUMBER_PREFIX') || 'IR',
    publicLink: yes_(setting_('PUBLIC_LINK')) ? prop_('IR_PUBLIC_KEY') : '', delivery: !!prop_('DELIVERY_SHEET_ID'),
  };
}
function setSetting_(k, v) {
  const sh = sheet_(SH.SET, SET_COLS);
  const t = table_(sh);
  const i = t.rows.findIndex(r => r[0] === k);
  if (i >= 0) sh.getRange(i + 2, 2).setNumberFormat('@').setValue(String(v)); else sh.getRange(sh.getLastRow() + 1, 1, 1, 3).setNumberFormat('@').setValues([[k, String(v), '']]);
}
function saveSettings_(p, user) {
  if (!user.admin) fail_('DENIED', 'Admins only.', 'សម្រាប់ Admin ប៉ុណ្ណោះ។');
  return withLock_(() => {
    if (Array.isArray(p.lists)) {
      const rows = p.lists.filter(l => l && clip_(l.name, 80)).map(l => {
        const emails = (Array.isArray(l.emails) ? l.emails : String(l.emails || '').split(/[\s,;]+/)).map(x => String(x).trim().toLowerCase()).filter(Boolean);
        const bad = emails.filter(x => !EMAIL_RE.test(x));
        if (bad.length) fail_('BAD', 'Check these email addresses: ' + bad.join(', '), 'សូមពិនិត្យអ៊ីមែលទាំងនេះ៖ ' + bad.join(', '));
        return [clip_(l.name, 80), emails.join(', '), WHEN[l.when] || WHEN.button, l.active === false ? 'No' : 'Yes'];
      });
      rewrite_(SH.MAIL, MAIL_COLS, rows);
    }
    if (Array.isArray(p.supervisors)) {
      const rows = p.supervisors.filter(s => s && (clip_(s.warehouse, 80) || clip_(s.email, 120))).map(s => {
        const e = clip_(s.email, 120).toLowerCase(), b = clip_(s.backup, 120).toLowerCase();
        [e, b].filter(Boolean).forEach(x => { if (!EMAIL_RE.test(x)) fail_('BAD', 'Check this email: ' + x, 'សូមពិនិត្យអ៊ីមែលនេះ៖ ' + x); });
        return [clip_(s.warehouse, 80), clip_(s.name, 100), e, b];
      });
      rewrite_(SH.SUP, SUP_COLS, rows);
    }
    if (Array.isArray(p.categories)) {
      rewrite_(SH.CAT, CAT_COLS, p.categories.filter(c => c && clip_(c.en, 80)).map(c => [clip_(c.en, 80), clip_(c.km, 80),
        String(c.types || 'road,wh,near').split(/[\s,]+/).filter(x => TYPES[x]).join(',') || 'road,wh,near', c.active === false ? 'No' : 'Yes', catIcon_(clip_(c.en, 80), c.icon)]));
    }
    if (p.telegramChat !== undefined) setSetting_('TELEGRAM_CHAT_ID', clip_(p.telegramChat, 40));
    if (p.prefix !== undefined) setSetting_('NUMBER_PREFIX', clip_(p.prefix, 10).replace(/[^A-Za-z0-9]/g, '') || 'IR');
    if (p.publicOn !== undefined) setSetting_('PUBLIC_LINK', p.publicOn ? 'Yes' : 'No');
    if (p.newPublicKey) PropertiesService.getScriptProperties().setProperty('IR_PUBLIC_KEY', Utilities.getUuid().replace(/-/g, '').slice(0, 16));
    return settings_(user);
  });
}

// ---------------------------------------------------------------- no-sign-in link for drivers
function publicCheck_(p) {
  if (!yes_(setting_('PUBLIC_LINK')) || !prop_('IR_PUBLIC_KEY') || String(p.key || '') !== prop_('IR_PUBLIC_KEY'))
    fail_('NOACCESS', 'This link is not valid any more. Ask the warehouse for the new QR code.', 'តំណនេះលែងប្រើបានហើយ។ សូមសុំ QR ថ្មីពីឃ្លាំង។');
}
function publicRoute_(action, p) {
  publicCheck_(p);
  if (action === 'publicBoot') {
    const dt = driverTruck_();
    return { categories: categories_(), supervisors: supervisors_().filter(s => s.email).map(s => ({ warehouse: s.warehouse, name: s.name, email: s.email })),
      plates: dt.plates, drivers: dt.drivers, texts: texts_() };
  }
  if (!clip_(p.reporterName, 100)) fail_('BAD', 'Enter your name.', 'សូមបញ្ចូលឈ្មោះរបស់អ្នក។');
  if (!clip_(p.reporterPhone, 40)) fail_('BAD', 'Enter your phone number.', 'សូមបញ្ចូលលេខទូរស័ព្ទរបស់អ្នក។');
  const cache = CacheService.getScriptCache();
  const k = 'ir_pub_' + String(p.reporterPhone).replace(/\D/g, '');
  if (cache.get(k)) fail_('BUSY', 'Please wait a minute before sending another report.', 'សូមរង់ចាំមួយនាទី មុនផ្ញើរបាយការណ៍ទៀត។');
  cache.put(k, '1', 60);
  delete p.id;
  return submit_(p, null, true);
}
