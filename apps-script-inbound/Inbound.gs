/**
 * Inbound (ទទួលទំនិញ) — Google Apps Script backend for isteel-app.pages.dev/inbound/ (goods receipt log).
 *
 * Bound to the "SSK-INBOUND-DATA" Google Sheet (Extensions > Apps Script inside that sheet). It keeps:
 *   - "Incoming Plan" tab: Kim's Incoming Packing List (one row per PO line). Paste new shipments here.
 *   - "GR Log" tab: one row per item received (same columns as Kim's GOODS RECEIPT LOG), for filters and pivots
 *   - "Receipts" tab: one row per truck with the full receipt (JSON) the app reads back
 *   - "IB Settings" tab: Telegram chat, app address, 3PL companies
 *   - "Email Lists" tab: named lists of emails for the Send Email button (List, Emails, Active)
 *   - Drive folder "Inbound Photos" (one sub-folder per receipt): truck, load, document and damage photos.
 * Flow: arrival (pick a pending PO, the items on this truck, arrival qty, truck, 3PL DN, 3 photos; start time = now)
 *   -> finish (actual GR qty, damaged qty + type + photos, truck owner, manpower; end time = now).
 *
 * Script Properties (Project Settings > Script properties):
 *   GOOGLE_CLIENT_ID   same Client ID as the other iSteel apps (web/config.js)
 *   SESSION_SECRET     copy of the Fuel app's SESSION_SECRET, so one sign-in works in every app
 *   USERS_SHEET_ID     id of the Fuel Refill Google Sheet: its "Users" tab is the one user list (tick box ទទួលទំនិញ),
 *                      its "Driver & Truck" tab gives the plates
 *   TELEGRAM_BOT_TOKEN optional: copy of the Fuel app's bot token; the group's chat id goes in IB Settings
 *   IB_FOLDER_ID       made by setup(); Drive folder "Inbound Photos"
 */

const SH = { PLAN: 'Incoming Plan', LOG: 'GR Log', REC: 'Receipts', SET: 'IB Settings', MAIL: 'Email Lists' };
const MAIL_COLS = ['List', 'Emails', 'Active'];
const MAIL_SEED = [['Warehouse', '', 'Yes'], ['Procurement', '', 'Yes'], ['Finance', '', 'Yes']];
const EMAIL_RE = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;
const PLAN_COLS = ['No', 'Material', 'Description', 'Plant', 'SLOC', 'Kg', 't', 'PCS', 'Remark', 'No. of Truck', 'PO Number', 'Inbound No.', 'Ref. No', 'ETA', 'Supplier'];
const LOG_COLS = ['Receipt ID', 'Status', 'PO Number', 'Inbound Number', 'Ref. No.', 'Supplier', 'ETA', '3PL DN Number', 'Material', 'Material Description',
  'Truck Number/Trailer', 'PO Qty', 'Arrival Qty', 'Actual GR Qty', 'Damaged Qty', 'Damage Type', 'Received Less', 'UoM', 'Receipt Date', 'Start Time',
  'End Time', 'Time Spent (min)', 'Productivity (t/person/h)', 'Manpower used to Unload/Receive', 'Truck Owner', '3PL Company', 'Remark',
  'Recorded By', 'Finished By', 'Photos Folder', 'Updated'];
const REC_COLS = ['Receipt ID', 'Status', 'Receipt Date', 'PO Number', 'Truck', 'Data', 'Updated'];
const SET_COLS = ['Setting', 'Value', 'Note'];
const APP_COL = 'ទទួលទំនិញ';        // tick box column in the Fuel Refill Users tab (added by the Fuel script)
const STATUS = { live: 'Unloading', done: 'Done' };
const PHOTOS = ['front', 'load', 'doc'];
const MAX_DMG_PHOTOS = 6;
const MAX_PHOTO_BYTES = 4 * 1024 * 1024;
const MAX_ITEMS = 60;
const DMG = { dent: 'Dent', rust: 'Rust', wet: 'Wet / water', edge: 'Edge damage', scratch: 'Scratch', bent: 'Bent / out of shape',
  coat: 'Coating peeled', pack: 'Packing torn', wrong: 'Wrong item', other: 'Other' };

// ---------------------------------------------------------------- web entry points
function doGet() { return json_({ ok: true, app: 'Inbound' }); }

function doPost(e) {
  let body = {};
  try { body = JSON.parse((e && e.postData && e.postData.contents) || '{}'); } catch (err) { return json_({ ok: false, error: 'BAD: Bad request' }); }
  try {
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
    case 'start': return start_(p.receipt || {}, user);
    case 'finish': return update_(p.receipt || {}, user, true);
    case 'save': return update_(p.receipt || {}, user, false);
    case 'photos': return photos_(p.ids);
    case 'pdf': return pdf_(p, user);
    case 'email': return email_(p, user);
    case 'planSave': return withLock_(() => planSave_(p.lines, user));
    case 'planDel': return withLock_(() => planDel_(p.po, user));
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
const clip_ = (v, n) => String(v == null ? '' : v).trim().slice(0, n || 200);
const num_ = v => { const n = Number(String(v == null ? '' : v).replace(/,/g, '').trim()); return isFinite(n) ? n : NaN; };
const ss_ = () => SpreadsheetApp.getActive();
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
  }
  return sh;
}
function objs_(name, cols) {
  const sh = sheet_(name, cols);
  if (sh.getLastRow() < 2) return [];
  const v = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getDisplayValues();
  const head = v[0].map(h => String(h).trim());
  return v.slice(1).map(r => { const o = {}; head.forEach((h, i) => { o[h] = String(r[i] == null ? '' : r[i]).trim(); }); return o; });
}

// ---------------------------------------------------------------- setup (run once from the editor)
/** Adds the tabs and the Drive folder. Safe to run again. */
/** Run once from the editor to allow Google Docs (PDF) and email. */
function authorize() {
  var doc = DocumentApp.create('Inbound permission check');
  DriveApp.getFileById(doc.getId()).setTrashed(true);
  Logger.log('OK. Emails left today: ' + MailApp.getRemainingDailyQuota());
}

function setup() {
  const plan = sheet_(SH.PLAN, PLAN_COLS);
  plan.getRange(1, 6, plan.getMaxRows(), 1).setNumberFormat('#,##0');   // Kg stays a number
  sheet_(SH.LOG, LOG_COLS);
  sheet_(SH.REC, REC_COLS);
  sheet_(SH.SET, SET_COLS, [
    ['TELEGRAM_CHAT_ID', '', 'Telegram group for trucks arriving and receipts with damage or short qty (the Fuel app\'s TELEGRAM_CHAT_ID works). Empty = off.'],
    ['APP_URL', 'https://isteel-app.pages.dev/inbound/', 'Address of the app, used in Telegram buttons'],
    ['THREEPL_COMPANIES', 'FOXS, Queen Legacy, Srong Sal, Chroek Kimheng', '3PL companies in the app\'s list, comma separated (people can also add new ones)'],
    ['DAYS_SHOWN', '90', 'How many days of receipts the app loads (receipts of POs still in Incoming Plan always load)'],
  ]);
  sheet_(SH.MAIL, MAIL_COLS, MAIL_SEED);
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('IB_FOLDER_ID')) props.setProperty('IB_FOLDER_ID', DriveApp.createFolder('Inbound Photos').getId());
  const first = ss_().getSheets()[0];
  if (first && first.getName() !== SH.PLAN && first.getLastRow() === 0) ss_().deleteSheet(first);   // the empty "Sheet1"
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
  if (!u) fail_('NOACCESS', email + ' has no Inbound access. Ask the admin to tick ' + APP_COL + ' in Users.',
    email + ' មិនទាន់មានសិទ្ធិប្រើ ' + APP_COL + ' ទេ។ សូមស្នើអ្នកគ្រប់គ្រងធីក ' + APP_COL + ' ក្នុង Users។');
  return { email: email, name: u.name || email, admin: u.admin, reviewer: u.reviewer, session: session };
}

/** The one user list: the Users tab of the Fuel Refill sheet. Active = Yes and ទទួលទំនិញ ticked (Fuel admins always). */
function users_() {
  const id = prop_('USERS_SHEET_ID');
  if (!id) fail_('SETUP', 'USERS_SHEET_ID is missing in Script properties.');
  const sh = SpreadsheetApp.openById(id).getSheetByName('Users');
  if (!sh || sh.getLastRow() < 2) return [];
  const v = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues();
  const head = v[0].map(h => String(h).trim());
  const c = n => head.indexOf(n);
  const e = c('Email'), n = c('Name'), r = c('Role'), a = c('Active'), tick = c(APP_COL);
  return v.slice(1).filter(x => x[e]).map(x => {
    const role = r >= 0 ? text_(x[r]) : '';
    const admin = /admin/i.test(role);
    return { email: String(x[e]).trim().toLowerCase(), name: n >= 0 ? text_(x[n]) : '', admin: admin, reviewer: admin || /review/i.test(role),
      ok: (a < 0 || yes_(x[a])) && (admin || (tick >= 0 && yes_(x[tick]))) };
  });
}
function usersCached_() {
  const cache = CacheService.getScriptCache();
  const hit = cache.get('ib_users');
  if (hit) return JSON.parse(hit);
  const u = users_();
  try { cache.put('ib_users', JSON.stringify(u), 60); } catch (e) { /* too big: read each time */ }
  return u;
}

// ---------------------------------------------------------------- lists
function setting_(k) { const r = objs_(SH.SET, SET_COLS).find(o => o.Setting === k); return r ? r.Value : ''; }
function plates_() {
  const cache = CacheService.getScriptCache();
  const hit = cache.get('ib_plates');
  if (hit) return JSON.parse(hit);
  const out = [];
  try {
    const sh = SpreadsheetApp.openById(prop_('USERS_SHEET_ID')).getSheetByName('Driver & Truck');
    if (sh && sh.getLastRow() > 1) {
      const v = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getDisplayValues();
      const ip = v[0].map(h => String(h).trim()).indexOf('CODE');
      if (ip >= 0) v.slice(1).forEach(r => { const p = String(r[ip]).trim(); if (p && p !== '0' && out.indexOf(p) < 0) out.push(p); });
      out.sort();
    }
  } catch (e) { /* no Driver & Truck tab: plates are typed */ }
  try { cache.put('ib_plates', JSON.stringify(out), 600); } catch (e) { /* too big */ }
  return out;
}

/** Incoming Plan: one line per PO + material, read by heading names so extra columns do no harm. */
function plan_() {
  const sh = sheet_(SH.PLAN, PLAN_COLS);
  if (sh.getLastRow() < 2) return [];
  const v = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues();
  const head = v[0].map(h => String(h).trim().toLowerCase().replace(/\.$/, ''));
  const c = (...names) => { for (const n of names) { const i = head.indexOf(n); if (i >= 0) return i; } return -1; };
  const iPo = c('po number', 'po'), iMat = c('material'), iDesc = c('description', 'material description'), iKg = c('kg', 'qty'),
    iPcs = c('pcs'), iIn = c('inbound no', 'inbound number'), iRef = c('ref. no', 'ref no'), iEta = c('eta'), iSup = c('supplier'),
    iPlant = c('plant'), iSloc = c('sloc');
  const cell = (r, i) => (i < 0 ? '' : r[i] instanceof Date ? fmt_(r[i], 'yyyy-MM-dd') : String(r[i] == null ? '' : r[i]).trim());
  const seen = {};
  return v.slice(1).map(r => ({
    po: cell(r, iPo), material: cell(r, iMat), desc: cell(r, iDesc), kg: num_(r[iKg]), pcs: cell(r, iPcs), inbound: cell(r, iIn),
    ref: cell(r, iRef), eta: cell(r, iEta), supplier: cell(r, iSup), plant: cell(r, iPlant), sloc: cell(r, iSloc),
  })).filter(x => x.po && x.material && x.kg > 0 && !seen[x.po + '|' + x.material] && (seen[x.po + '|' + x.material] = 1));
}

// ---------------------------------------------------------------- Incoming Plan from the app (Supervisor / Admin, Kim 28 Oct 2026)
function planner_(user) { if (!(user.admin || user.reviewer)) fail_('DENIED', 'Only a Supervisor or Admin can change the Incoming Plan.', 'មានតែ Supervisor ឬ Admin ទេដែលអាចកែផែនការបាន។'); }
const poOf_ = v => { const s = String(v == null ? '' : v).replace(/\s+/g, '').toUpperCase(); return s && !/^PO/.test(s) ? 'PO' + s : s; };
/** kg arrived (still unloading) or received per PO|material */
function recvdMap_() {
  const m = {};
  receipts_().forEach(r => (r.items || []).forEach(i => { const k = r.po + '|' + i.material; m[k] = (m[k] || 0) + (num_(r.end ? i.grQty : i.arrQty) || 0); }));
  return m;
}
/** Rewrites the Incoming Plan tab: rows of other POs stay as they are (all columns). */
function planWrite_(keep, add) {
  const sh = sheet_(SH.PLAN, PLAN_COLS);
  const width = Math.max(sh.getLastColumn(), PLAN_COLS.length);
  const head = sh.getRange(1, 1, 1, width).getValues()[0].map(h => String(h).trim());
  const rows = keep.concat(add.map(l => head.map(h => {
    switch (h.toLowerCase().replace(/\.$/, '')) {
      case 'material': return l.material; case 'description': case 'material description': return l.desc; case 'plant': return l.plant; case 'sloc': return l.sloc;
      case 'kg': return l.kg; case 't': return Math.round(l.kg) / 1000; case 'pcs': return l.pcs; case 'no. of truck': return Math.ceil(l.kg / 1000 / 40);
      case 'po number': case 'po': return l.po; case 'inbound no': case 'inbound number': return l.inbound; case 'ref. no': case 'ref no': return l.ref;
      case 'eta': return l.eta; case 'supplier': return l.supplier; default: return '';
    }
  })));
  const iNo = head.indexOf('No');
  if (iNo >= 0) rows.forEach((r, i) => { r[iNo] = i + 1; });
  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, width).clearContent();
  if (rows.length) sh.getRange(2, 1, rows.length, width).setNumberFormat('@').setValues(rows.map(r => r.map(v => (v == null ? '' : String(v)))));
}
function planRows_() {
  const sh = sheet_(SH.PLAN, PLAN_COLS);
  const width = Math.max(sh.getLastColumn(), PLAN_COLS.length);
  const v = sh.getRange(1, 1, Math.max(1, sh.getLastRow()), width).getValues();
  const head = v[0].map(h => String(h).trim().toLowerCase().replace(/\.$/, ''));
  const iPo = Math.max(head.indexOf('po number'), head.indexOf('po')), iMat = head.indexOf('material');
  return v.slice(1).filter(r => r.some(c => String(c).trim())).map(r => ({ po: poOf_(r[iPo]), material: String(r[iMat]).trim(), row: r.map(c => (c instanceof Date ? fmt_(c, 'yyyy-MM-dd') : c)) }));
}
/** Upload (Excel or by hand): each PO in the upload replaces its lines; lines already received and not in the upload stay. */
function planSave_(lines, user) {
  planner_(user);
  const add = [], seen = {};
  (Array.isArray(lines) ? lines : []).slice(0, 2000).forEach(l => {
    const x = { po: poOf_(l.po), material: clip_(l.material, 40), desc: clip_(l.desc, 120), plant: clip_(l.plant, 10), sloc: clip_(l.sloc, 10), kg: num_(l.kg),
      pcs: clip_(l.pcs, 12), inbound: clip_(l.inbound, 40), ref: clip_(l.ref, 40), eta: /^\d{4}-\d\d-\d\d$/.test(String(l.eta || '')) ? String(l.eta) : clip_(l.eta, 20), supplier: clip_(l.supplier, 80) };
    if (!x.po || !x.material || !(x.kg > 0)) return;
    const k = x.po + '|' + x.material; if (seen[k]) { seen[k].kg += x.kg; return; }   // same material twice in a PO: one line
    seen[k] = x; add.push(x);
  });
  if (!add.length) fail_('BAD', 'No rows with PO, Material and Kg.', 'គ្មានជួរដែលមាន PO, Material និង Kg ទេ។');
  const pos = {}; add.forEach(x => { pos[x.po] = 1; });
  const got = recvdMap_();
  const keep = planRows_().filter(r => !pos[r.po] || (got[r.po + '|' + r.material] > 0 && !seen[r.po + '|' + r.material])).map(r => r.row);
  planWrite_(keep, add);
  return plan_();
}
function planDel_(po, user) {
  planner_(user);
  po = poOf_(po);
  if (receipts_().some(r => r.po === po)) fail_('BAD', 'Trucks were received on ' + po + ', so it cannot be deleted.', 'មានឡានទទួលលើ ' + po + ' រួចហើយ មិនអាចលុបបានទេ។');
  planWrite_(planRows_().filter(r => r.po !== po).map(r => r.row), []);
  return plan_();
}

// ---------------------------------------------------------------- receipts
function recRows_() {
  const sh = sheet_(SH.REC, REC_COLS);
  if (sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, REC_COLS.length).getDisplayValues();
}
function receipts_() {
  return recRows_().map(r => { try { return JSON.parse(r[5]); } catch (e) { return null; } }).filter(Boolean);
}
function boot_(user) {
  const plan = plan_();
  const pos = {}; plan.forEach(x => { pos[x.po] = 1; });
  const days = Math.max(1, num_(setting_('DAYS_SHOWN')) || 90);
  const from = fmt_(new Date(Date.now() - days * 86400000), 'yyyy-MM-dd');
  const recs = receipts_().filter(r => r.date >= from || pos[r.po]);
  const carriers = setting_('THREEPL_COMPANIES').split(',').map(s => s.trim()).filter(Boolean);
  recs.forEach(r => { if (r.carrier && carriers.indexOf(r.carrier) < 0) carriers.push(r.carrier); });
  return { user: { email: user.email, name: user.name, admin: user.admin, reviewer: user.reviewer }, plan: plan, receipts: recs, plates: plates_(), carriers: carriers,
    lists: mailLists_().filter(l => l.active && l.emails.length).map(l => ({ name: l.name, count: l.emails.length })) };
}
function find_(id) {
  const rows = recRows_();
  const i = rows.findIndex(r => r[0] === String(id || ''));
  if (i < 0) fail_('NOTFOUND', 'Receipt not found.', 'រកមិនឃើញការទទួលនេះទេ។');
  return { row: i + 2, rec: JSON.parse(rows[i][5]) };
}
function nextId_() {
  const day = fmt_(new Date(), 'yyMMdd');
  let n = 0;
  recRows_().forEach(r => { const m = String(r[0]).match(/^IB-(\d{6})-(\d+)$/); if (m && m[1] === day) n = Math.max(n, +m[2]); });
  return 'IB-' + day + '-' + String(n + 1).padStart(2, '0');
}

// ---------------------------------------------------------------- photos (one Drive folder per receipt)
function root_() { return DriveApp.getFolderById(prop_('IB_FOLDER_ID') || fail_('SETUP', 'Run setup() first.')); }
function folder_(id) {
  const it = root_().getFoldersByName(id);
  return it.hasNext() ? it.next() : root_().createFolder(id);
}
function saveImage_(folder, dataUrl, name) {
  const m = String(dataUrl || '').match(/^data:(image\/(png|jpeg|webp));base64,(.+)$/);
  if (!m) return null;
  const bytes = Utilities.base64Decode(m[3]);
  if (bytes.length > MAX_PHOTO_BYTES) fail_('BIG', 'A photo is too big.', 'រូបថតធំពេក។');
  return folder.createFile(Utilities.newBlob(bytes, m[1], name)).getId();
}
/** A photo value from the app: a new photo (data URL) is saved; an old one (file id) is kept only if it was already on this receipt. */
function photo_(folder, v, keep, name) {
  if (/^data:image\//.test(String(v || ''))) return saveImage_(folder, v, name);
  return keep.indexOf(v) >= 0 ? v : null;
}
/** Small thumbnails for the app. Only files inside the Inbound Photos folder are read. */
function photos_(ids) {
  const rootId = root_().getId();
  const out = {};
  (Array.isArray(ids) ? ids : []).slice(0, 20).forEach(id => {
    try {
      const f = DriveApp.getFileById(String(id));
      const p = f.getParents();
      const parent = p.hasNext() ? p.next() : null;
      const gp = parent && parent.getParents();
      if (!gp || !gp.hasNext() || gp.next().getId() !== rootId) return;
      const b = f.getThumbnail() || f.getBlob();
      out[id] = 'data:' + (b.getContentType() || 'image/jpeg') + ';base64,' + Utilities.base64Encode(b.getBytes());
    } catch (e) { /* gone */ }
  });
  return out;
}

// ---------------------------------------------------------------- arrival
function start_(p, user) {
  const plan = plan_().filter(x => x.po === String(p.po || ''));
  if (!plan.length) fail_('BAD', 'This PO is not in the Incoming Plan.', 'PO នេះមិនមានក្នុងផែនការទំនិញចូលទេ។');
  const items = (Array.isArray(p.items) ? p.items : []).slice(0, MAX_ITEMS).map(i => {
    const line = plan.find(x => x.material === String(i.material || ''));
    if (!line) fail_('BAD', 'Item ' + clip_(i.material, 30) + ' is not on this PO.', 'ទំនិញ ' + clip_(i.material, 30) + ' មិនមែនរបស់ PO នេះទេ។');
    const arr = num_(i.arrQty);
    if (!(arr > 0)) fail_('BAD', 'Arrival Qty is missing for ' + line.desc + '.', 'សូមបញ្ចូលបរិមាណមកដល់សម្រាប់ ' + line.desc + '។');
    return { material: line.material, desc: line.desc, poQty: line.kg, pcs: line.pcs, arrQty: arr, grQty: '', dmgQty: '', dmgType: '', dmgPh: [] };
  });
  if (!items.length) fail_('BAD', 'Choose the items on this truck.', 'សូមជ្រើសទំនិញលើឡាននេះ។');
  const truck = clip_(p.truck, 20).toUpperCase().replace(/\s+/g, '');
  if (!truck) fail_('BAD', 'Truck number is missing.', 'សូមបញ្ចូលផ្លាកលេខឡាន។');
  const dn = clip_(p.dn3pl, 40);
  if (!dn) fail_('BAD', '3PL DN Number is missing.', 'សូមបញ្ចូលលេខ DN របស់ 3PL។');
  const ph = p.ph || {};
  if (PHOTOS.some(k => !/^data:image\//.test(String(ph[k] || '')))) fail_('BAD', 'Take the 3 photos first.', 'សូមថតរូប ៣ ជាមុនសិន។');
  return withLock_(() => {
    const id = nextId_();
    const folder = folder_(id);
    const now = new Date();
    const l = plan[0];
    const rec = {
      id: id, status: STATUS.live, po: l.po, inbound: l.inbound, ref: l.ref, supplier: l.supplier, eta: l.eta, dn3pl: dn, truck: truck,
      items: items, uom: 'Kg', date: fmt_(now, 'yyyy-MM-dd'), start: fmt_(now, 'HH:mm'), end: '', manpower: '', owner: '', carrier: '', remark: '',
      ph: { front: saveImage_(folder, ph.front, 'front.jpg'), load: saveImage_(folder, ph.load, 'load.jpg'), doc: saveImage_(folder, ph.doc, 'document.jpg') },
      by: user.name, byEmail: user.email, finishedBy: '', folder: folder.getUrl(), updated: now_(),
    };
    store_(rec);
    telegramArrived_(rec);
    return rec;
  });
}

// ---------------------------------------------------------------- finish / save
function update_(p, user, finish) {
  return withLock_(() => {
    const f = find_(p.id);
    const rec = f.rec;
    const live = rec.status === STATUS.live;
    if (!live && !(user.admin || user.reviewer || rec.byEmail === user.email)) fail_('DENIED', 'Only the person who recorded it or an admin can change it.', 'មានតែអ្នកកត់ត្រា ឬ Admin ទេដែលអាចកែបាន។');
    if (finish && !live) fail_('BAD', 'This truck is already finished.', 'ឡាននេះបានបញ្ចប់រួចហើយ។');
    const folder = folder_(rec.id);
    const sent = Array.isArray(p.items) ? p.items : [];
    rec.items.forEach(i => {
      const s = sent.find(x => String(x.material) === i.material) || {};
      const gr = s.grQty === '' || s.grQty == null ? '' : num_(s.grQty);
      const dm = s.dmgQty === '' || s.dmgQty == null ? 0 : num_(s.dmgQty);
      if (gr !== '' && !(gr >= 0)) fail_('BAD', 'Actual GR Qty must be a number.', 'បរិមាណទទួលត្រូវតែជាលេខ។');
      if (!(dm >= 0)) fail_('BAD', 'Damaged Qty must be a number.', 'បរិមាណខូចខាតត្រូវតែជាលេខ។');
      if (finish && gr === '') fail_('BAD', 'Actual GR Qty is missing for ' + i.desc + '.', 'សូមបញ្ចូលបរិមាណទទួលសម្រាប់ ' + i.desc + '។');
      i.grQty = gr;
      i.dmgQty = gr === '' && !dm ? '' : dm;
      i.dmgType = dm > 0 ? (DMG[s.dmgType] ? s.dmgType : clip_(s.dmgType, 40)) : '';
      const keep = i.dmgPh || [];
      i.dmgPh = dm > 0 ? (Array.isArray(s.dmgPh) ? s.dmgPh : []).slice(0, MAX_DMG_PHOTOS)
        .map((v, n) => photo_(folder, v, keep, 'damage-' + i.material + '-' + (n + 1) + '.jpg')).filter(Boolean) : [];
      if (finish && dm > 0 && !i.dmgType) fail_('BAD', 'Choose the damage type for ' + i.desc + '.', 'សូមជ្រើសប្រភេទខូចខាតសម្រាប់ ' + i.desc + '។');
      if (finish && dm > 0 && !i.dmgPh.length) fail_('BAD', 'Take a damage photo for ' + i.desc + '.', 'សូមថតរូបខូចខាតសម្រាប់ ' + i.desc + '។');
    });
    const truck = clip_(p.truck, 20).toUpperCase().replace(/\s+/g, '');
    if (truck) rec.truck = truck;
    if (clip_(p.dn3pl, 40)) rec.dn3pl = clip_(p.dn3pl, 40);
    rec.owner = p.owner === 'ISI' || p.owner === '3PL' ? p.owner : rec.owner;
    rec.carrier = rec.owner === '3PL' ? clip_(p.carrier, 60) : '';
    const mp = num_(p.manpower);
    rec.manpower = mp > 0 ? Math.round(mp) : rec.manpower;
    rec.remark = clip_(p.remark, 500);
    if (finish) {
      if (!rec.owner) fail_('BAD', 'Choose ISI or 3PL truck.', 'សូមជ្រើសឡាន ISI ឬ 3PL។');
      if (!(rec.manpower > 0)) fail_('BAD', 'Manpower is missing.', 'សូមបញ្ចូលចំនួនកម្មករ។');
      rec.end = fmt_(new Date(), 'HH:mm');
      rec.status = STATUS.done;
      rec.finishedBy = user.name;
    }
    rec.updated = now_();
    store_(rec, f.row);
    if (finish) telegramDone_(rec);
    return rec;
  });
}

// ---------------------------------------------------------------- sheet rows
const spent_ = r => { if (!r.start || !r.end) return ''; const a = r.start.split(':'), b = r.end.split(':'); let m = (+b[0] * 60 + +b[1]) - (+a[0] * 60 + +a[1]); if (m < 0) m += 1440; return m; };
const tot_ = (r, k) => r.items.reduce((s, i) => s + (Number(i[k]) || 0), 0);
const isLess_ = i => i.grQty !== '' && i.grQty != null && Number(i.grQty) < Number(i.arrQty);
function prod_(r) { const m = spent_(r); const t = tot_(r, 'grQty') / 1000; return m && r.manpower && t ? Math.round(t / (m / 60) / r.manpower * 100) / 100 : ''; }
const showDate_ = s => (s ? s.split('-').reverse().join('.') : '');

function store_(rec, row) {
  const data = [rec.id, rec.status, rec.date, rec.po, rec.truck, JSON.stringify(rec), rec.updated];
  const sh = sheet_(SH.REC, REC_COLS);
  sh.getRange(row || sh.getLastRow() + 1, 1, 1, data.length).setNumberFormat('@').setValues([data.map(String)]);
  writeLog_(rec);
}
/** GR Log: one row per item, in the order of Kim's GOODS RECEIPT LOG. Old rows of the receipt are replaced. */
function writeLog_(rec) {
  const sh = sheet_(SH.LOG, LOG_COLS);
  const rows = rec.items.map(i => [rec.id, rec.status, rec.po, rec.inbound, rec.ref, rec.supplier, showDate_(rec.eta), rec.dn3pl, i.material, i.desc,
    rec.truck, i.poQty, i.arrQty, i.grQty, i.dmgQty, i.dmgType ? DMG[i.dmgType] || i.dmgType : '', isLess_(i) ? 'Yes' : '', rec.uom, showDate_(rec.date),
    rec.start, rec.end, spent_(rec), prod_(rec), rec.manpower, rec.owner === 'ISI' ? 'ISI Truck' : rec.owner === '3PL' ? '3PL Truck' : '', rec.carrier, rec.remark,
    rec.by, rec.finishedBy, rec.folder, rec.updated].map(x => (x == null ? '' : String(x))));
  const last = sh.getLastRow();
  const ids = last > 1 ? sh.getRange(2, 1, last - 1, 1).getDisplayValues().map(r => r[0]) : [];
  const at = [];
  ids.forEach((id, n) => { if (id === rec.id) at.push(n + 2); });
  if (at.length === rows.length && at.every((r, n) => r === at[0] + n)) {
    sh.getRange(at[0], 1, rows.length, LOG_COLS.length).setNumberFormat('@').setValues(rows);
    return;
  }
  at.reverse().forEach(r => sh.deleteRow(r));
  sh.getRange(sh.getLastRow() + 1, 1, rows.length, LOG_COLS.length).setNumberFormat('@').setValues(rows);
}

// ---------------------------------------------------------------- Telegram
function telegram_(payload) {
  const token = prop_('TELEGRAM_BOT_TOKEN'), chat = setting_('TELEGRAM_CHAT_ID');
  if (!token || !chat) return null;
  try {
    const res = UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/sendMessage', { method: 'post', payload: Object.assign({ chat_id: chat, parse_mode: 'HTML' }, payload), muteHttpExceptions: true });
    const out = JSON.parse(res.getContentText() || '{}');
    if (!out.ok) console.error('telegram: ' + res.getContentText());
    return out;
  } catch (e) { console.error('telegram: ' + e); return null; }
}
function button_(r) { const u = setting_('APP_URL'); return u ? { reply_markup: JSON.stringify({ inline_keyboard: [[{ text: 'Open · បើក', url: u + '#/r/' + encodeURIComponent(r.id) }]] }) } : {}; }
const kg_ = n => Number(n || 0).toLocaleString('en-US');
function telegramArrived_(r) {
  telegram_(Object.assign({ text: ['🚛 <b>Truck arrived ' + esc_(r.truck) + '</b> · ' + esc_(r.start),
    '📄 ' + esc_(r.po) + ' · ' + esc_(r.supplier) + ' · DN ' + esc_(r.dn3pl),
    '📦 ' + r.items.length + ' item(s) · ' + kg_(tot_(r, 'arrQty')) + ' Kg', '✍️ ' + esc_(r.by)].join('\n') }, button_(r)));
}
/** Posted when a truck finishes with damage or a short quantity. */
function telegramDone_(r) {
  const dmg = r.items.filter(i => Number(i.dmgQty) > 0), less = r.items.filter(isLess_);
  if (!dmg.length && !less.length) return;
  const lines = ['⚠️ <b>Receipt ' + esc_(r.id) + '</b> · ' + esc_(r.truck) + ' · ' + esc_(r.po)];
  less.forEach(i => lines.push('⬇ Received less: ' + esc_(i.desc) + ' ' + kg_(i.grQty) + ' / ' + kg_(i.arrQty) + ' Kg'));
  dmg.forEach(i => lines.push('💥 Damaged: ' + esc_(i.desc) + ' ' + kg_(i.dmgQty) + ' (' + esc_(DMG[i.dmgType] || i.dmgType) + ')'));
  lines.push('✍️ ' + esc_(r.finishedBy));
  telegram_(Object.assign({ text: lines.join('\n') }, button_(r)));
}

// ---------------------------------------------------------------- PDF report and email (Kim, 28 Oct 2026)
function mailLists_() {
  sheet_(SH.MAIL, MAIL_COLS, MAIL_SEED);   // made with sample lists the first time
  return objs_(SH.MAIL, MAIL_COLS).filter(o => o.List).map(o => ({ name: o.List, active: o.Active === '' || yes_(o.Active),
    emails: String(o.Emails).split(/[\s,;]+/).map(x => x.trim().toLowerCase()).filter(x => EMAIL_RE.test(x)) }));
}
function doneRec_(id) {
  const rec = find_(id).rec;
  if (rec.status !== STATUS.done) fail_('BAD', 'The report is ready once unloading is finished.', 'របាយការណ៍អាចធ្វើបាន ពេលបញ្ចប់ការទម្លាក់រួច។');
  return rec;
}
/** The receipt's PDF, kept in its photo folder and made again only when the receipt changed. */
function pdfFile_(rec) {
  const ver = Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, JSON.stringify(rec)));
  const folder = folder_(rec.id), name = rec.id + '.pdf';
  const it = folder.getFilesByName(name);
  while (it.hasNext()) { const f = it.next(); if (f.getDescription() === ver) return f; f.setTrashed(true); }
  const f = makePdf_(rec, folder, name);
  f.setDescription(ver);
  return f;
}
/** Generate Report button: the PDF as base64 (the Drive file belongs to the script owner, so others cannot open its link). */
function pdf_(p, user) {
  const rec = doneRec_(p.id);
  return { name: rec.id + '.pdf', b64: Utilities.base64Encode(pdfFile_(rec).getBlob().getBytes()) };
}
/** Send Email button: p.lists (names), p.extra (typed addresses), p.note. */
function email_(p, user) {
  const rec = doneRec_(p.id);
  const extra = String(p.extra || '').split(/[\s,;]+/).map(x => x.trim().toLowerCase()).filter(Boolean);
  const bad = extra.filter(x => !EMAIL_RE.test(x));
  if (bad.length) fail_('BAD', 'Check these email addresses: ' + bad.join(', '), 'សូមពិនិត្យអ៊ីមែលទាំងនេះ៖ ' + bad.join(', '));
  const names = Array.isArray(p.lists) ? p.lists.map(String) : [];
  const to = [];
  mailLists_().filter(l => l.active && names.indexOf(l.name) >= 0).forEach(l => l.emails.forEach(e => { if (to.indexOf(e) < 0) to.push(e); }));
  extra.forEach(e => { if (to.indexOf(e) < 0) to.push(e); });
  if (!to.length) fail_('BAD', 'Tick a list or type an email.', 'សូមធីកបញ្ជី ឬវាយអ៊ីមែល។');
  if (to.length > 40) fail_('BAD', 'Up to 40 people per email.', 'អាចផ្ញើបានច្រើនបំផុត 40 នាក់ក្នុងមួយអ៊ីមែល។');
  if (MailApp.getRemainingDailyQuota() < to.length) fail_('LIMIT', 'Google\'s daily email limit is reached. Try again tomorrow.', 'ដល់ចំនួនអ៊ីមែលកំណត់ប្រចាំថ្ងៃហើយ។ សូមព្យាយាមថ្ងៃស្អែក។');
  const file = pdfFile_(rec);
  const less = rec.items.some(isLess_), dmg = rec.items.some(i => Number(i.dmgQty) > 0);
  const row = (k, v) => (v === '' || v == null ? '' : '<tr><td style="padding:4px 8px;background:#f2f5f9;font-weight:600;border:1px solid #d6dee8">' + esc_(k) + '</td><td style="padding:4px 8px;border:1px solid #d6dee8">' + esc_(v) + '</td></tr>');
  const note = clip_(p.note, 1000), url = setting_('APP_URL');
  const html = '<div style="font-family:Arial,\'Noto Sans Khmer\',sans-serif;color:#011e41;max-width:680px">' +
    (note ? '<p style="white-space:pre-line">' + esc_(note) + '</p>' : '') +
    '<div style="background:#011e41;color:#fff;padding:12px 16px;border-radius:8px"><div style="font-size:12px;opacity:.8">ISI STEEL · Goods Receipt Report · របាយការណ៍ទទួលទំនិញ</div>' +
    '<div style="font-size:18px;font-weight:700">' + esc_(rec.id) + ' · ' + esc_(rec.truck) + '</div><div style="font-size:12px;opacity:.85">' +
    esc_([rec.po, rec.supplier, showDate_(rec.date) + ' ' + rec.start + '–' + rec.end].filter(String).join(' · ')) + '</div></div>' +
    '<table style="border-collapse:collapse;width:100%;margin-top:10px;font-size:13px">' +
    row('Inbound / Ref.', [rec.inbound, rec.ref].filter(String).join(' · ')) + row('3PL DN', rec.dn3pl) + row('Items', rec.items.length) +
    row('Received', kg_(tot_(rec, 'grQty')) + ' ' + rec.uom + ' of ' + kg_(tot_(rec, 'arrQty')) + ' arrived') +
    row('Damaged', dmg ? kg_(tot_(rec, 'dmgQty')) + ' ' + rec.uom : 'No') + row('Received less', less ? 'Yes' : 'No') +
    row('Time spent', spent_(rec) + ' min · ' + rec.manpower + ' people') + row('Remark', rec.remark) + '</table>' +
    (url ? '<p><a href="' + esc_(url) + '#/r/' + encodeURIComponent(rec.id) + '">Open in the iSteel app</a></p>' : '') +
    '<p style="color:#546274;font-size:12px">The PDF report is attached.</p></div>';
  MailApp.sendEmail({ to: to.join(','), subject: 'Goods receipt ' + rec.id + ': ' + rec.po + ' · ' + rec.truck + (dmg ? ' · DAMAGED' : '') + (less ? ' · RECEIVED LESS' : ''),
    htmlBody: html, name: 'ISI Steel Inbound', replyTo: user.email || '', attachments: [file.getBlob().setName(rec.id + '.pdf')] });
  return { sent: to.length };
}

const NAVY = '#011e41', SOFT = '#d4e1f5', LINE = '#b9c3cf', PAGE_W = 539, LABEL_W = 92;
const two_ = (km, en) => km + ' · ' + en;
const COLS = [['#475569', '#eef2f6'], ['#0b62a4', '#e3f0fb'], ['#1e7a3c', '#e3f4e7'], ['#b45309', '#fdf0dc'], ['#6b3fa0', '#f1e9f9']];
/** One A4 page: header with the ISI logo, receipt details, items table (same column colours as the app), times, photos, names. */
function makePdf_(r, folder, name) {
  const doc = DocumentApp.create(r.id);
  const docFile = DriveApp.getFileById(doc.getId());
  try {
    const body = doc.getBody();
    body.setMarginTop(24).setMarginBottom(20).setMarginLeft(28).setMarginRight(28);
    const base = {};
    base[DocumentApp.Attribute.FONT_FAMILY] = 'Kantumruy Pro';
    base[DocumentApp.Attribute.FONT_SIZE] = 8;
    try { body.setAttributes(base); } catch (e) { /* font not offered: keep the default */ }
    const head = body.appendTable([['ISI STEEL · GOODS RECEIPT REPORT\nរបាយការណ៍ទទួលទំនិញ\n' + r.id + '  ·  ' + showDate_(r.date) + '  ·  ' + r.status, '']]);
    head.setBorderWidth(0);
    const hl = head.getRow(0).getCell(0), hr = head.getRow(0).getCell(1);
    hl.editAsText().setForegroundColor(NAVY).setBold(true).setFontSize(10);
    hr.setWidth(110);
    try {
      const lp = hr.getChild(0).asParagraph();
      lp.setAlignment(DocumentApp.HorizontalAlignment.RIGHT);
      fit_(lp.appendInlineImage(Utilities.newBlob(Utilities.base64Decode(LOGO_B64), 'image/png', 'isi.png')), 34, 34);
      lp.appendText(' STEEL').setForegroundColor(NAVY).setBold(true).setFontSize(16);
    } catch (e) { hr.editAsText().setText('ISI STEEL'); }

    section_(body, 'A. ' + two_('ព័ត៌មានទទួល', 'RECEIPT'));
    kv_(body, [[two_('លេខ PO', 'PO Number'), r.po, two_('លេខ Inbound', 'Inbound No.'), r.inbound],
      ['Ref. No.', r.ref, two_('អ្នកផ្គត់ផ្គង់', 'Supplier'), r.supplier],
      ['ETA', showDate_(r.eta), two_('លេខ DN 3PL', '3PL DN No.'), r.dn3pl],
      [two_('ឡាន', 'Truck / trailer'), r.truck, two_('ម្ចាស់ឡាន', 'Truck owner'), r.owner === 'ISI' ? 'ISI Truck' : r.owner === '3PL' ? '3PL Truck' + (r.carrier ? ' · ' + r.carrier : '') : '']]);

    section_(body, 'B. ' + two_('បរិមាណទំនិញ', 'ITEMS') + ' (' + r.items.length + ')');
    const rows = [['#', two_('សម្ភារៈ', 'Material'), two_('ចំនួន (PO)', 'PO Qty'), two_('ចំនួន (ដល់)', 'Arrival'), two_('ទទួល', 'GR Qty'), two_('ខូច', 'Damaged'), two_('ឯកតា', 'UoM')]];
    r.items.forEach((i, n) => rows.push([String(n + 1), i.material + '\n' + i.desc + (isLess_(i) ? '\n⬇ Received less' : '') + (Number(i.dmgQty) > 0 ? '\n⚠ ' + (DMG[i.dmgType] || i.dmgType || '') : ''),
      kg_(i.poQty), kg_(i.arrQty), kg_(i.grQty), kg_(i.dmgQty || 0), r.uom]));
    rows.push(['', two_('សរុប', 'Total'), kg_(tot_(r, 'poQty')), kg_(tot_(r, 'arrQty')), kg_(tot_(r, 'grQty')), kg_(tot_(r, 'dmgQty')), r.uom]);
    const t = body.appendTable(rows);
    t.setBorderColor(LINE);
    compact_(t);
    const widths = [18, 215, 62, 62, 62, 62, 58];
    widths.forEach((w, j) => t.setColumnWidth(j, w));
    for (let j = 0; j < 7; j++) {
      const c = t.getRow(0).getCell(j); c.editAsText().setBold(true);
      if (j >= 2) { c.setBackgroundColor(COLS[j - 2][1]); c.editAsText().setForegroundColor(COLS[j - 2][0]); }
      else c.setBackgroundColor('#f2f5f9');
      for (let i = 1; i < rows.length; i++) if (j >= 2) t.getRow(i).getCell(j).getChild(0).asParagraph().setAlignment(DocumentApp.HorizontalAlignment.RIGHT);
    }
    const last = t.getRow(rows.length - 1);
    for (let j = 0; j < 7; j++) last.getCell(j).setBackgroundColor('#f2f5f9').editAsText().setBold(true);

    section_(body, 'C. ' + two_('ពេលវេលា និងកម្មករ', 'TIME AND MANPOWER'));
    const pr = prod_(r);
    kv_(body, [[two_('ចាប់ផ្តើម', 'Start'), r.start, two_('បញ្ចប់', 'End'), r.end],
      [two_('រយៈពេល', 'Time spent'), spent_(r) === '' ? '' : spent_(r) + ' min', two_('កម្មករ', 'Manpower'), r.manpower],
      [two_('ផលិតភាព', 'Productivity'), pr === '' ? '' : pr + ' t/person/h', two_('សំគាល់', 'Remark'), r.remark]]);

    const ph = PHOTOS.map(k => (r.ph || {})[k]).filter(Boolean);
    if (ph.length) { section_(body, 'D. ' + two_('រូបថតឡាន', 'TRUCK PHOTOS')); photos_doc_(body, ph, 170, 120); }
    const dp = [].concat.apply([], r.items.map(i => i.dmgPh || []));
    if (dp.length) { section_(body, 'E. ' + two_('រូបថតខូចខាត', 'DAMAGE PHOTOS') + ' (' + dp.length + ')'); photos_doc_(body, dp.slice(0, 12), 125, 90); }

    section_(body, two_('អ្នកកត់ត្រា', 'RECORDED BY'));
    kv_(body, [[two_('មកដល់', 'Arrival by'), r.by, two_('បញ្ចប់ដោយ', 'Finished by'), r.finishedBy]]);
    if (body.getNumChildren() > 1 && body.getChild(0).asText().getText() === '') body.getChild(0).removeFromParent();
    doc.saveAndClose();
    return folder.createFile(docFile.getAs('application/pdf').setName(name));
  } finally {
    docFile.setTrashed(true);   // only the PDF is kept
  }
}
function photos_doc_(body, ids, w, h) {
  const p = body.appendParagraph('');
  ids.forEach(id => { try { fit_(p.appendInlineImage(DriveApp.getFileById(id).getBlob()), w, h); p.appendText(' '); } catch (e) { /* photo gone */ } });
}
function fit_(img, w, h) {
  const k = Math.min(w / img.getWidth(), h / img.getHeight(), 1);
  img.setWidth(Math.round(img.getWidth() * k)).setHeight(Math.round(img.getHeight() * k));
  return img;
}
function section_(body, title) {
  const p = body.appendParagraph(title);
  p.editAsText().setForegroundColor(NAVY).setBold(true).setFontSize(8.5);
  p.setSpacingBefore(5).setSpacingAfter(1);
}
function compact_(t) {
  for (let i = 0; i < t.getNumRows(); i++) { const r = t.getRow(i); for (let j = 0; j < r.getNumCells(); j++) r.getCell(j).setPaddingTop(1).setPaddingBottom(1).setPaddingLeft(3).setPaddingRight(3); }
}
/** Label / value rows, 4 cells per row; empty values print as "-". */
function kv_(body, rows) {
  const t = body.appendTable(rows.map(r => r.map((x, i) => (i % 2 ? String(x === '' || x == null ? '-' : x) : String(x)))));
  t.setBorderColor(LINE);
  for (let i = 0; i < t.getNumRows(); i++) for (let j = 0; j < 4; j += 2) t.getRow(i).getCell(j).setBackgroundColor('#f2f5f9').editAsText().setBold(true);
  const vw = (PAGE_W - LABEL_W * 2) / 2;
  for (let j = 0; j < 4; j++) t.setColumnWidth(j, j % 2 ? vw : LABEL_W);
  compact_(t);
}

const LOGO_B64 = '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';
