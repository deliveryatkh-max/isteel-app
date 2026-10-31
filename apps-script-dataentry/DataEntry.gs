/**
 * Agent Data Entry (បញ្ចូលទិន្នន័យ) — Google Apps Script backend for isteel-app.pages.dev/dataentry/.
 * The app reads weighing tickets in the browser (free Tesseract, no AI service) and sends the reviewed values here.
 *
 * Bound to the "SSK-WEIGHT-SCALE-DATA" Google Sheet (Extensions > Apps Script inside that sheet). It keeps:
 *   - "Weighing Tickets" tab: one row per ticket (a ticket number sent again replaces its row)
 *   - "DE Settings" tab: default email list, days kept
 *   - Drive folder "Weighing Ticket Images": the picture of each ticket (linked from its row)
 * Actions: boot (who is signed in, sheet link), save (tickets + pictures), email (Excel made by the app, attached).
 *
 * Script Properties (Project Settings > Script properties):
 *   GOOGLE_CLIENT_ID   same Client ID as the other iSteel apps (web/config.js)
 *   SESSION_SECRET     copy of the Fuel app's SESSION_SECRET, so one sign-in works in every app
 *   USERS_SHEET_ID     id of the Fuel Refill Google Sheet: its "Users" tab is the one user list (tick box បញ្ចូលទិន្នន័យ)
 *   DE_FOLDER_ID       made by setup(); Drive folder "Weighing Ticket Images"
 */

const SH = { TK: 'Weighing Tickets', SET: 'DE Settings', PRICE: 'Price List' };
const PRICE_COLS = ['3PL Company', 'Destination', 'Charge Per', 'Price', 'UoM'];
const TK_COLS = ['Ticket No', 'Vehicle No', 'Company', 'Document Date', 'Gross (kg)', 'Tare (kg)', 'Net (kg)', 'In Date/Time', 'Out Date/Time',
  'Total Time (min)', 'Total Time', 'Check', 'Source File', 'Picture', 'Entered By', 'Entered At', 'Updated'];
const SET_COLS = ['Setting', 'Value', 'Note'];
const APP_COL = 'បញ្ចូលទិន្នន័យ';     // tick box column in the Fuel Refill Users tab (added by the Fuel script)
const EMAIL_RE = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;
const MAX_ROWS = 50, MAX_IMG_BYTES = 3 * 1024 * 1024, MAX_XLSX_BYTES = 15 * 1024 * 1024, MAX_TO = 20;

// ---------------------------------------------------------------- web entry points
function doGet() { return json_({ ok: true, app: 'Agent Data Entry' }); }

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
    case 'save': return withLock_(() => save_(p.rows, user));
    case 'email': return email_(p, user);
    default: fail_('BAD', 'Unknown action');
  }
}

function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function fail_(code, en, kh) { throw new Error(code + ': ' + en + (kh ? ' || ' + kh : '')); }
const prop_ = k => PropertiesService.getScriptProperties().getProperty(k) || '';
const TZ = 'Asia/Phnom_Penh';
const fmt_ = (d, f) => Utilities.formatDate(d, TZ, f);
const now_ = () => fmt_(new Date(), 'yyyy-MM-dd HH:mm:ss');
const text_ = v => (v == null ? '' : v instanceof Date ? fmt_(v, 'yyyy-MM-dd HH:mm') : String(v).trim());
const yes_ = v => v === true || /^(yes|true|y|1|✓)$/i.test(String(v).trim());
const clip_ = (v, n) => String(v == null ? '' : v).trim().slice(0, n || 200);
const num_ = v => { const s = String(v == null ? '' : v).replace(/[^0-9.\-]/g, ''); const n = Number(s); return s !== '' && isFinite(n) ? n : ''; };
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
    if (seed && seed.length) sh.getRange(2, 1, seed.length, cols.length).setValues(seed);
  }
  return sh;
}
function setting_(k) {
  const sh = sheet_(SH.SET, SET_COLS);
  if (sh.getLastRow() < 2) return '';
  const r = sh.getRange(2, 1, sh.getLastRow() - 1, 2).getDisplayValues().find(x => String(x[0]).trim() === k);
  return r ? String(r[1]).trim() : '';
}

// ---------------------------------------------------------------- setup (run once from the editor)
/** Adds the tabs and the Drive folder. Safe to run again. */
function setup() {
  const tk = sheet_(SH.TK, TK_COLS);
  // Ticket and plate stay as typed (3E-2588 must not become a number); weights are numbers; times are real dates.
  tk.getRange(2, 1, tk.getMaxRows() - 1, 3).setNumberFormat('@');
  tk.getRange(2, 4, tk.getMaxRows() - 1, 1).setNumberFormat('dd-mmm-yyyy');
  tk.getRange(2, 5, tk.getMaxRows() - 1, 3).setNumberFormat('#,##0');
  tk.getRange(2, 8, tk.getMaxRows() - 1, 2).setNumberFormat('dd-mmm-yyyy hh:mm:ss');
  tk.getRange(2, 16, tk.getMaxRows() - 1, 2).setNumberFormat('dd-mmm-yyyy hh:mm');
  // Trip prices for the Debit Note (Kim's sheet "Price List", 31 Oct 2026). Charge Per: "Charge per t" or "Charge per trip".
  sheet_(SH.PRICE, PRICE_COLS, [['3PL #1', 'KPC Branch', 'Charge per t', 8, 't'], ['3PL #1', 'KPC Branch', 'Charge per trip', 250, 'trip']]);
  sheet_(SH.SET, SET_COLS, [
    ['EMAIL_TO', '', 'Default "Send to" for Send Excel to Email (comma separated). People can change it in the app.'],
    ['EMAIL_SUBJECT', 'Weighing tickets', 'Start of the email subject'],
  ]);
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('DE_FOLDER_ID')) props.setProperty('DE_FOLDER_ID', DriveApp.createFolder('Weighing Ticket Images').getId());
  const first = ss_().getSheets()[0];
  if (first && first.getName() !== SH.TK && first.getLastRow() === 0) ss_().deleteSheet(first);   // the empty "Sheet1"
  const notes = [];
  ['GOOGLE_CLIENT_ID', 'SESSION_SECRET', 'USERS_SHEET_ID'].forEach(k => { if (!prop_(k)) notes.push('Add ' + k + ' in Script properties.'); });
  notes.push('Then run authorize(), and Deploy > New deployment > Web app, Execute as Me, Who has access Anyone.');
  const msg = notes.join('\n');
  console.log(msg);
  return msg;
}
/** Run once from the editor so Google asks to allow email (and Drive). */
function authorize() {
  DriveApp.getRootFolder();
  Logger.log('OK. Emails left today: ' + MailApp.getRemainingDailyQuota());
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
  if (!u) fail_('NOACCESS', email + ' has no Data Entry access. Ask the admin to tick ' + APP_COL + ' in Users.',
    email + ' មិនទាន់មានសិទ្ធិប្រើ ' + APP_COL + ' ទេ។ សូមស្នើអ្នកគ្រប់គ្រងធីក ' + APP_COL + ' ក្នុង Users។');
  return { email: email, name: u.name || email, admin: u.admin, reviewer: u.reviewer, session: session };
}

/** The one user list: the Users tab of the Fuel Refill sheet. Active = Yes and បញ្ចូលទិន្នន័យ ticked (Fuel admins always). */
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
    return { email: String(x[e]).trim().toLowerCase(), name: n >= 0 ? text_(x[n]) : '', admin: admin, reviewer: admin || /review|supervis/i.test(role),
      ok: (a < 0 || yes_(x[a])) && (admin || (tick >= 0 && yes_(x[tick]))) };
  });
}
function usersCached_() {
  const cache = CacheService.getScriptCache();
  const hit = cache.get('de_users');
  if (hit) return JSON.parse(hit);
  const u = users_();
  try { cache.put('de_users', JSON.stringify(u), 60); } catch (e) { /* too big: read each time */ }
  return u;
}

// ---------------------------------------------------------------- actions
function boot_(user) {
  return { user: { name: user.name, email: user.email, admin: user.admin, reviewer: user.reviewer }, sheetUrl: ss_().getUrl(), emailTo: setting_('EMAIL_TO'), trucks: trucks_(), prices: prices_() };
}

/** Price List rows: [company, destination, charge per, price, UoM]. */
function prices_() {
  const sh = sheet_(SH.PRICE, PRICE_COLS);
  if (sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, 5).getValues()
    .filter(r => String(r[0]).trim() && r[3] !== '' && isFinite(Number(r[3])))
    .map(r => [String(r[0]).trim(), String(r[1]).trim(), String(r[2]).trim(), Number(r[3]), String(r[4]).trim()]);
}

/** Plate → company from the Fuel Refill sheet, tab "Driver & Truck": column G (ផ្លាកលេខឡាន) and column E (ក្រុមហ៊ុន). */
function trucks_() {
  const cache = CacheService.getScriptCache();
  const hit = cache.get('de_trucks');
  if (hit) return JSON.parse(hit);
  const sh = SpreadsheetApp.openById(prop_('USERS_SHEET_ID')).getSheetByName('Driver & Truck');
  if (!sh || sh.getLastRow() < 2) return [];
  const v = sh.getRange(2, 5, sh.getLastRow() - 1, 3).getDisplayValues();   // E:G
  const out = v.filter(r => String(r[2]).trim()).map(r => [String(r[2]).trim(), String(r[0]).trim()]);
  try { cache.put('de_trucks', JSON.stringify(out), 300); } catch (e) { /* too big */ }
  return out;
}

const date_ = s => { const m = String(s || '').match(/^(\d{4})-(\d\d)-(\d\d)(?:[ T](\d\d):(\d\d)(?::(\d\d))?)?/); return m ? new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)) : ''; };
const hhmm_ = m => (m === '' || m == null ? '' : Math.floor(m / 60) + ':' + ('0' + (m % 60)).slice(-2));

/** Tickets from the app. A ticket number already in the sheet is replaced (its row is updated), others are added. */
function save_(rows, user) {
  if (!Array.isArray(rows) || !rows.length) fail_('BAD', 'Nothing to save.');
  if (rows.length > MAX_ROWS) fail_('BAD', 'Too many tickets at once.');
  const sh = sheet_(SH.TK, TK_COLS);
  const last = sh.getLastRow();
  const nos = last > 1 ? sh.getRange(2, 1, last - 1, 1).getDisplayValues().map(r => String(r[0]).trim()) : [];
  const out = [];
  rows.forEach(p => {
    const ticket = clip_(p.ticket, 40).replace(/[^0-9A-Za-z\-\/]/g, '');
    const vehicle = clip_(p.vehicle, 20).toUpperCase();
    if (!ticket || !vehicle) fail_('BAD', 'Ticket No and Vehicle No are required.', 'ត្រូវការលេខប័ណ្ណ និងលេខឡាន។');
    const g = num_(p.gross), t = num_(p.tare), n = num_(p.net);
    const din = date_(p.inTime), dout = date_(p.outTime);
    const mins = din && dout && dout >= din ? Math.round((dout - din) / 60000) : '';
    const check = g !== '' && t !== '' && n !== '' ? (g - t === n ? 'OK' : 'Gross - Tare = ' + (g - t) + ', Net ' + n) : '';
    const idx = nos.indexOf(ticket);
    const row = idx >= 0 ? idx + 2 : null;
    // Changing a ticket already in the sheet: Role Reviewer or Admin only (Kim, 31 Oct 2026).
    if (row && !(user.admin || user.reviewer)) fail_('DENIED', 'Ticket ' + ticket + ' is already in the sheet. Only a Reviewer or Admin can change it.',
      'ប័ណ្ណ ' + ticket + ' មានក្នុង Sheet រួចហើយ។ មានតែ Reviewer ឬ Admin ទេដែលអាចកែបាន។');
    let pic = row ? sh.getRange(row, 14).getDisplayValue() : '';
    if (p.img) pic = savePicture_(p.img, ticket, vehicle) || pic;
    const enteredAt = row ? sh.getRange(row, 16).getValue() : new Date();
    const company = clip_(p.company, 80);
    const vals = [ticket, vehicle, company, date_(p.date), g, t, n, din, dout, mins, hhmm_(mins), check, clip_(p.file, 120), pic,
      row ? sh.getRange(row, 15).getDisplayValue() || user.name : (clip_(p.by, 80) || user.name), enteredAt || new Date(), new Date()];
    if (row) sh.getRange(row, 1, 1, vals.length).setValues([vals]);
    else { sh.appendRow(vals); nos.push(ticket); }
    const r = row || sh.getLastRow();
    sh.getRange(r, 1, 1, 3).setNumberFormat('@').setValues([[ticket, vehicle, company]]);   // plates stay text
    out.push({ id: p.id, ticket: ticket, row: r, replaced: !!row });
  });
  return { saved: out };
}

function folder_() { return DriveApp.getFolderById(prop_('DE_FOLDER_ID') || fail_('SETUP', 'Run setup() first.')); }
function savePicture_(dataUrl, ticket, vehicle) {
  const m = String(dataUrl).match(/^data:(image\/(?:jpeg|png));base64,(.+)$/);
  if (!m) return '';
  const bytes = Utilities.base64Decode(m[2]);
  if (bytes.length > MAX_IMG_BYTES) return '';
  const name = 'Ticket_' + ticket + '_' + vehicle.replace(/[^A-Z0-9\-]/g, '') + (m[1] === 'image/png' ? '.png' : '.jpg');
  const f = folder_();
  const old = f.getFilesByName(name);
  while (old.hasNext()) old.next().setTrashed(true);
  return f.createFile(Utilities.newBlob(bytes, m[1], name)).getUrl();
}

/** Sends the Excel file made by the app as an attachment. */
function email_(p, user) {
  const to = (Array.isArray(p.to) ? p.to : String(p.to || '').split(/[,;\s]+/)).map(s => String(s).trim()).filter(Boolean);
  if (!to.length) fail_('BAD', 'Please type an email.', 'សូមវាយអ៊ីមែល។');
  if (to.length > MAX_TO) fail_('BAD', 'Too many email addresses.');
  if (to.some(e => !EMAIL_RE.test(e))) fail_('BAD', 'An email address is not valid.', 'អ៊ីមែលមិនត្រឹមត្រូវ។');
  const bytes = Utilities.base64Decode(String(p.xlsx || ''));
  if (!bytes.length || bytes.length > MAX_XLSX_BYTES) fail_('BAD', 'The Excel file is missing or too big.');
  if (MailApp.getRemainingDailyQuota() < to.length) fail_('QUOTA', 'Today\'s email limit is used up. Try again tomorrow.', 'អ៊ីមែលថ្ងៃនេះអស់កូតាហើយ។ សូមព្យាយាមថ្ងៃស្អែក។');
  const name = clip_(p.fileName, 80).replace(/[^\w.\-]/g, '_') || 'Weighing_Tickets.xlsx';
  const count = Number(p.count) || 0, net = Number(p.net) || 0;
  const range = p.first && p.last ? (p.first === p.last ? p.first : p.first + ' to ' + p.last) : '';
  const subject = (setting_('EMAIL_SUBJECT') || 'Weighing tickets') + (range ? ' · ' + range : '') + ' · ' + count + ' ticket' + (count === 1 ? '' : 's');
  const html = '<div style="font-family:Arial,sans-serif;font-size:14px;color:#011e41">' +
    '<p>Dear team,</p><p>Please find attached <b>' + count + '</b> weighing ticket' + (count === 1 ? '' : 's') + (range ? ' (' + esc_(range) + ')' : '') +
    ', total net <b>' + (net / 1000).toLocaleString('en-US', { maximumFractionDigits: 3 }) + ' t</b>.</p>' +
    '<p style="color:#546274">Sent by ' + esc_(user.name) + ' from the iSteel app · Agent Data Entry.</p></div>';
  MailApp.sendEmail({ to: to.join(','), subject: subject, htmlBody: html, name: 'ISI STEEL · Agent Data Entry', replyTo: user.email,
    attachments: [Utilities.newBlob(bytes, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', name)] });
  return { sent: to.length };
}
