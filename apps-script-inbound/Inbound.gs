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
  const ver = Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, "v2" + JSON.stringify(rec)));
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
    hr.setWidth(112);
    try {
      const lp = hr.getChild(0).asParagraph();
      lp.setAlignment(DocumentApp.HorizontalAlignment.RIGHT);
      fit_(lp.appendInlineImage(Utilities.newBlob(Utilities.base64Decode(LOGO_B64), 'image/png', 'isi.png')), 100, 38);
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
