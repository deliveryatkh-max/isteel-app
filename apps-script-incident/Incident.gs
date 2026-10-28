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
  tplMemo_ = null;   // the template is looked up once per request
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
    case 'media': return media_(getReport_(p.id, user));
    case 'photo': return photo_(getReport_(p.id, user), Number(p.i) || 0);
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
    ['PDF_FONT', 'Kantumruy Pro', 'Font for the whole PDF (a Google font, e.g. Kantumruy Pro, Noto Sans Khmer, Battambang). - = keep the template fonts.'],
    ['PDF_TEMPLATE_LINK', '', 'Drive link to the PDF template: a Google Doc, a Word file or a folder (newest file used). Empty = built-in template.'],
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
  const sups = supsCached_();
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
function supsCached_() {
  const cache = CacheService.getScriptCache();
  const hit = cache.get('ir_sups');
  if (hit) return JSON.parse(hit);
  const s = supervisors_();
  try { cache.put('ir_sups', JSON.stringify(s), 300); } catch (e) { /* too big: read each time */ }
  return s;
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
// report.json is also kept in the cache (6 h), so opening a report does not have to search Drive.
const repKey_ = id => 'irrep:' + id;
function load_(id) {
  const hit = CacheService.getScriptCache().get(repKey_(String(id || '')));
  if (hit) return JSON.parse(hit);
  const f = folder_(String(id || ''), false);
  const it = f && f.getFilesByName('report.json');
  if (!it || !it.hasNext()) fail_('NOTFOUND', 'Report not found.', 'រកមិនឃើញរបាយការណ៍នេះទេ។');
  const json = it.next().getBlob().getDataAsString('UTF-8');
  cacheReport_(id, json);
  return JSON.parse(json);
}
function cacheReport_(id, json) {
  try { if (json.length < 95000) CacheService.getScriptCache().put(repKey_(id), json, 21600); else CacheService.getScriptCache().remove(repKey_(id)); } catch (e) { /* cache full */ }
}
function store_(d) {
  const folder = folder_(d.id, true);
  const it = folder.getFilesByName('report.json');
  const s = JSON.stringify(d);
  if (it.hasNext()) it.next().setContent(s); else folder.createFile(Utilities.newBlob(s, 'application/json', 'report.json'));
  cacheReport_(d.id, s);
  writeRow_(d, folder);
}
function getReport_(id, user) {
  const d = load_(id);
  const row = { 'Reporter Email': d.reporter.email, 'Supervisor Email': d.supervisor.email, Warehouse: d.warehouse };
  if (!canSee_(row, user)) fail_('DENIED', 'You cannot open this report.', 'អ្នកមិនអាចបើករបាយការណ៍នេះបានទេ។');
  return d;
}
/** What the app gets: the report plus what this person may do with it. Photos and the voice note come separately
 *  (media_), so the report opens straight away. */
function view_(d, user) {
  const sup = isSupervisorFor_(d, user);
  return Object.assign({}, d, {
    can: {
      edit: d.status === STATUS.back && d.reporter.email === user.email,
      sign: d.status === STATUS.wait && sup,
      actions: (d.status === STATUS.signed || d.status === STATUS.wait) && canSeeAll_(user),
      close: d.status === STATUS.signed && (sup || user.admin),
      email: d.status === STATUS.signed || d.status === STATUS.closed,
    },
  });
}

const dataUrl_ = (b, type) => 'data:' + (b.getContentType() || type) + ';base64,' + Utilities.base64Encode(b.getBytes());
/** Small photos (Drive thumbnail, kept in the cache) and the voice note for the report screen. */
function media_(d) {
  const cache = CacheService.getScriptCache();
  const photos = (d.photos || []).map(id => {
    const k = 'irth:' + id, hit = cache.get(k);
    if (hit) return hit;
    try {
      const f = DriveApp.getFileById(id), u = dataUrl_(f.getThumbnail() || f.getBlob(), 'image/jpeg');
      if (u.length < 95000) cache.put(k, u, 21600);
      return u;
    } catch (e) { return ''; }
  });
  let voice = '';
  if (d.voice) try { voice = dataUrl_(DriveApp.getFileById(d.voice).getBlob(), 'audio/webm'); } catch (e) { /* file gone */ }
  return { photos, voice };
}
/** One photo in full size, for the photo viewer. */
function photo_(d, i) {
  const id = (d.photos || [])[i];
  if (!id) fail_('BAD', 'Photo not found.', 'រកមិនឃើញរូបថត។');
  return { data: dataUrl_(DriveApp.getFileById(id).getBlob(), 'image/jpeg') };
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
    d.pdf = pdfInfo_(pdf, now);
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
    d.pdf = pdfInfo_(pdf, d.updated);
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

/** The PDF is filled in from Kim's Word template; if that ever fails, the built-in one-page layout is used. */
// Bump PDF_VER when the layout changes: saved PDFs from an older layout are made again the next time they are opened.
const PDF_VER = 3;
const pdfInfo_ = (file, at) => ({ id: file.getId(), url: file.getUrl(), at, v: pdfVer_() });
function makePdf_(d, folder) {
  try {
    const f = templatePdf_(d, folder);
    if (setting_('PDF_TEMPLATE_ERROR')) setSetting_('PDF_TEMPLATE_ERROR', '');
    return f;
  } catch (e) {
    console.error('Template PDF failed, using the built-in layout: ' + e);
    try { setSetting_('PDF_TEMPLATE_ERROR', now_() + ' ' + String(e && e.stack || e).slice(0, 400)); } catch (x) { /* sheet busy */ }
    return basicPdf_(d, folder);
  }
}

// ---- PDF template. IR Settings PDF_TEMPLATE_LINK = a Drive link to a Google Doc, a Word file or a folder (the newest
// Doc / Word file in it is used), so a new or edited template shows in the next PDF. A Google Doc is used as it is;
// a Word file is turned into a Google Doc again whenever it changes (kept as PDF_TEMPLATE_ID / PDF_TEMPLATE_STAMP).
// With no link, web/incident/ir-template.docx is used.
const TEMPLATE_URL = 'https://isteel-app.pages.dev/incident/ir-template.docx';
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const GDOC_MIME = 'application/vnd.google-apps.document';
const PDF_FONT = 'Kantumruy Pro';   // Google font closest to MiSans Khmer (Khmer + English)
function templateSource_() {
  const link = String(setting_('PDF_TEMPLATE_LINK') || '').trim();
  if (!link) return null;
  const m = link.match(/\/d\/([-\w]{20,})|\/folders\/([-\w]{20,})|[?&]id=([-\w]{20,})|^([-\w]{20,})$/);
  if (!m) throw new Error('PDF_TEMPLATE_LINK is not a Google Drive link');
  if (!m[2]) return DriveApp.getFileById(m[1] || m[3] || m[4]);
  let best = null;
  const it = DriveApp.getFolderById(m[2]).getFiles();
  while (it.hasNext()) {
    const f = it.next();
    if (f.isTrashed() || [GDOC_MIME, DOCX_MIME].indexOf(f.getMimeType()) < 0) continue;
    if (!best || f.getLastUpdated() > best.getLastUpdated()) best = f;
  }
  if (!best) throw new Error('No Google Doc or Word file in the PDF_TEMPLATE_LINK folder');
  return best;
}
let tplMemo_ = null;
/** { id, stamp } of the Google Doc to copy; the stamp changes whenever the template does. */
function template_() {
  if (tplMemo_) return tplMemo_;
  const src = templateSource_();
  if (src && src.getMimeType() === GDOC_MIME) return (tplMemo_ = { id: src.getId(), stamp: src.getId() + '@' + src.getLastUpdated().getTime() });
  const stamp = src ? src.getId() + '@' + src.getLastUpdated().getTime() : TEMPLATE_URL + '#' + PDF_VER;
  const old = setting_('PDF_TEMPLATE_ID');
  if (old && setting_('PDF_TEMPLATE_STAMP') === stamp) { try { if (!DriveApp.getFileById(old).isTrashed()) return (tplMemo_ = { id: old, stamp }); } catch (e) { /* gone: convert again */ } }
  const docx = src ? src.getBlob().getBytes() : UrlFetchApp.fetch(TEMPLATE_URL).getBlob().getBytes();
  const b = 'irtpl' + Date.now();
  const meta = { name: 'Incident Report Template (made from ' + (src ? src.getName() : 'ir-template.docx') + ')', mimeType: GDOC_MIME, parents: [root_().getId()] };
  const bytes = x => Utilities.newBlob(x).getBytes();
  const payload = bytes('--' + b + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' + JSON.stringify(meta) + '\r\n--' + b + '\r\nContent-Type: ' + DOCX_MIME + '\r\n\r\n')
    .concat(docx, bytes('\r\n--' + b + '--'));
  const r = UrlFetchApp.fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true', {
    method: 'post', contentType: 'multipart/related; boundary=' + b, payload, headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true });
  if (r.getResponseCode() !== 200) throw new Error('template upload ' + r.getResponseCode() + ' ' + r.getContentText().slice(0, 200));
  const id = JSON.parse(r.getContentText()).id;
  if (old && old !== id) { try { DriveApp.getFileById(old).setTrashed(true); } catch (e) { /* already gone */ } }
  setSetting_('PDF_TEMPLATE_ID', id);
  setSetting_('PDF_TEMPLATE_STAMP', stamp);
  return (tplMemo_ = { id, stamp });
}
/** Version of the PDF layout right now; a saved PDF with another version is made again. */
function pdfVer_() { try { return PDF_VER + '|' + template_().stamp; } catch (e) { return PDF_VER + '|basic'; } }
/** Text for each {{placeholder}} in the template. */
function pdfValues_(d) {
  const t = TYPES[d.type] || {}, sc = d.severity && d.likelihood ? d.severity * d.likelihood : 0;
  const inj = (d.injuredList || []).map(x => x.name + (x.type ? ' (' + x.type + ')' : '') + (x.lti ? ' · LTI' : '')).join('; ');
  return {
    id: d.id, created: d.created, status: d.status, type: [t.km, t.en].filter(Boolean).join(' / '), category: d.category ? catKm_(d.category) : '',
    date: [d.date, d.time].filter(Boolean).join(' ') + (d.shift ? ' · ' + d.shift : ''), reporter: d.reporter.name + (d.reporter.phone ? ' · ' + d.reporter.phone : ''),
    location: (d.location || '') + (d.gps ? ' (' + d.gps + ')' : ''), warehouse: d.warehouse, road: d.road, weather: d.weather,
    driver: d.driver, plate: d.plate, company: d.company, dn: d.dn, story: d.story,
    anyInjured: [d.anyInjured, inj].filter(Boolean).join(' · '), lti: d.anyInjured ? ((d.injuredList || []).some(x => x.lti) ? 'Yes' : 'No') : '',
    vehicleDamage: d.vehicleDamage, goodsDamage: d.goodsDamage, property: d.property, insurance: d.insurance, firstAid: d.firstAid, evidence: d.evidence,
    witnesses: (d.witnesses || []).map(w => w.name + (w.phone ? ' · ' + w.phone : '')).join('; '), cost: d.cost ? '$' + d.cost : '',
    severity: d.severity ? d.severity + ' ' + SEVERITY[d.severity - 1] : '', likelihood: d.likelihood ? d.likelihood + ' ' + LIKELY[d.likelihood - 1] : '',
    score: sc ? sc + ' · ' + level_(sc) : '', cause: d.cause ? (CAUSE_KM[d.cause] ? CAUSE_KM[d.cause] + ' / ' : '') + d.cause : '',
    why: (d.whys || []).filter(Boolean).join(' → '), immediate: d.immediate,
    supComment: [d.supComment, d.voice ? 'Voice note saved in the report folder / សំឡេងរក្សាទុកក្នុង Folder របាយការណ៍' : ''].filter(Boolean).join('\n'),
    photos: '', reporterSignature: ' ', supervisorSignature: ' ',
    reporterName: d.reporter.name + (d.reporter.at ? ' · ' + d.reporter.at : ''), supervisorName: (d.supervisor.name || '') + ' · ' + (d.supervisor.at || two_('រង់ចាំ', 'Waiting')),
  };
}
function templatePdf_(d, folder) {
  const copy = DriveApp.getFileById(template_().id).makeCopy(d.id + ' (pdf)', folder);
  try {
    const doc = DocumentApp.openById(copy.getId()), body = doc.getBody();
    actionRows_(body, d.actions || []);
    images_(body, '{{photos}}', (d.photos || []).slice(0, 4), 128, 90);
    images_(body, '{{reporterSignature}}', d.reporter.sig ? [d.reporter.sig] : [], 130, 40);
    images_(body, '{{supervisorSignature}}', d.supervisor.sig ? [d.supervisor.sig] : [], 130, 40);
    const v = pdfValues_(d);
    const parts = [body, doc.getHeader(), doc.getFooter()].filter(Boolean);
    parts.forEach(el => Object.keys(v).forEach(k => fill_(el, '{{' + k + '}}', v[k])));
    // Google can only print Google fonts, so a Word font such as MiSans Khmer is swapped for one (IR Settings PDF_FONT).
    const font = String(setting_('PDF_FONT') || PDF_FONT).trim();
    if (font && font !== '-') parts.forEach(el => { try { el.editAsText().setFontFamily(font); } catch (e) { /* unknown font: keep the template's */ } });
    doc.saveAndClose();
    return savePdf_(copy, d, folder);
  } finally {
    copy.setTrashed(true);   // only the PDF is kept
  }
}
const pat_ = key => key.replace(/[{}.]/g, '\\$&');
/** Swap every copy of key for the value, as plain text ("-" when empty). */
function fill_(el, key, val) {
  const txt = String(val == null || val === '' ? '-' : val).replace(/\{\{/g, '{ {');
  let r;
  while ((r = el.findText(pat_(key)))) {
    const t = r.getElement().asText(), s = r.getStartOffset(), e = r.getEndOffsetInclusive();
    t.insertText(s, txt);   // insert first so the text element is never left empty
    t.deleteText(s + txt.length, e + txt.length);
  }
}
/** One table row per corrective action, copied from the row that holds {{action.what}}. */
function actionRows_(body, acts) {
  const r = body.findText(pat_('{{action.what}}'));
  if (!r) return;
  let row = r.getElement();
  while (row && row.getType() !== DocumentApp.ElementType.TABLE_ROW) row = row.getParent();
  if (!row) return;
  const table = row.getParentTable(), at = table.getChildIndex(row);
  (acts.length ? acts : [{}]).forEach((a, i) => {
    const nr = table.insertTableRow(at + 1 + i, row.copy());
    [['what', a.what], ['owner', a.owner], ['due', a.due], ['status', a.status ? a.status + (a.done ? ' · ' + a.done : '') : '']].forEach(x => fill_(nr, '{{action.' + x[0] + '}}', x[1]));
  });
  row.removeFromParent();
}
/** Pictures (photos, signatures) where the placeholder is; with none, the placeholder is left for fill_. */
function images_(body, key, ids, w, h) {
  const blobs = ids.map(id => { try { return DriveApp.getFileById(id).getBlob(); } catch (e) { return null; } }).filter(Boolean);
  if (!blobs.length) return;
  const r = body.findText(pat_(key));
  if (!r) return;
  const t = r.getElement().asText(), s = r.getStartOffset(), e = r.getEndOffsetInclusive();
  t.insertText(s, ' ');
  t.deleteText(s + 1, e + 1);
  let p = t.getParent();
  while (p && p.getType() !== DocumentApp.ElementType.PARAGRAPH) p = p.getParent();
  if (!p) return;
  blobs.forEach(b => { try { fit_(p.appendInlineImage(b), w, h); p.appendText(' '); } catch (e) { /* not an image */ } });
}
function savePdf_(docFile, d, folder) {
  const pdfName = d.id + '.pdf';
  const old = folder.getFilesByName(pdfName);
  while (old.hasNext()) old.next().setTrashed(true);
  return folder.createFile(docFile.getAs('application/pdf').setName(pdfName));
}

/** Built-in one-page layout: compact header with the ISI STEEL logo on the right, then short label/value tables. */
function basicPdf_(d, folder) {
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
    hr.setWidth(112);
    try {
      const lp = hr.getChild(0).asParagraph();
      lp.setAlignment(DocumentApp.HorizontalAlignment.RIGHT);
      fit_(lp.appendInlineImage(Utilities.newBlob(Utilities.base64Decode(LOGO_B64), 'image/png', 'isi.png')), 100, 38);
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
    return savePdf_(docFile, d, folder);
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
  if (d.pdf && d.pdf.id && d.pdf.v === pdfVer_()) { try { file = DriveApp.getFileById(d.pdf.id); if (file.isTrashed()) file = null; } catch (e) { file = null; } }
  if (!file) {
    file = makePdf_(d, folder_(d.id, true));
    if (d.status !== STATUS.wait) withLock_(() => { const x = load_(d.id); x.pdf = pdfInfo_(file, now_()); store_(x); });
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
    try { file = d.pdf && d.pdf.v === pdfVer_() && DriveApp.getFileById(d.pdf.id); file.getName(); } catch (e) { file = null; }
    if (!file) { file = makePdf_(d, folder_(d.id, true)); d.pdf = pdfInfo_(file, now_()); }
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
      CacheService.getScriptCache().remove('ir_sups');
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
