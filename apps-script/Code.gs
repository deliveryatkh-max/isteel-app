/**
 * Fuel Refill App – Google Sheets backend (Apps Script web app).
 * The Netlify front end POSTs {action, token, payload} here as text/plain JSON.
 * Data lives in the sheets of the spreadsheet this script is bound to.
 */

const SHEETS = {
  REFILL: 'Fuel Refill',
  TYPES: 'Type of Refill',
  DRIVER_TRUCK: 'Driver & Truck',
  EQUIPMENT: 'Equipment',
  USERS: 'Users',
  SETTINGS: 'Settings',
  PHOTO_CHECK: 'Photo Check',
  ADS: 'Ads',
};

// Column headers in the "Fuel Refill" sheet. Columns are found by header text, so order can change.
const COL = {
  ID_FR: 'ID_FR',
  TYPE: 'ចាក់សាំងសម្រាប់៖',
  PLATE: 'ផ្លាកលេខឡាន',
  DRIVER: 'ឈ្មោះតៃកុង',
  ODO_PHOTO: 'រូបថតកុងទ័រឡាន',
  KM: 'លេខកុងទ័រ (Km)',
  PUMP_PHOTO: 'រូបថតកុងទ័រសាំង',
  LITRES: 'ចំនួនចាក់ (លីត្រ)',
  SIGNATURE: 'ហត្ថលេខា',
  NOTE: 'សំគាល់',
  ID: 'ID',
  DATE: 'Date of Record',
  DATETIME: 'Date & Time of Record',
  LATLONG: 'LatLong',
  USER: 'User',
  STATUS: 'Review Status',
  REVIEWED_BY: 'Reviewed By',
  REVIEWED_AT: 'Reviewed At',
  HOUR: 'Hour Meter',
  HOUR_PHOTO: 'Hour Meter Photo',
  UPDATED_AT: 'Updated At',
};

// Columns in the "Driver & Truck" sheet used for the dropdowns.
const DT_DRIVER = 'ឈ្មោះតៃកុង';
const DT_PLATE = 'CODE';
const MIN_KM = 1000;
// "Odometer Broken?" column in Driver & Truck: Yes = this truck's odometer is broken.
const DT_BROKEN = /odometer\s*broken/i;

const STATUS_OK = 'ត្រឹមត្រូវ';
const STATUS_BAD = 'មិនត្រឹមត្រូវ';
const PHOTO_FOLDER_NAME = 'Fuel Refill_Images (Web App)';

// ---------- HTTP entry points ----------

function doGet() {
  return json_({ ok: true, app: 'Fuel Refill API' });
}

function doPost(e) {
  try {
    const req = JSON.parse(e.postData.contents);
    const action = ACTIONS[req.action];
    // Signed in with Google but not (yet) in the Users sheet: these two only need the sign-in.
    if (req.action === 'requestAccess') return json_({ ok: true, data: requestAccess_(req.token, req.payload || {}) });
    if (req.action === 'requestForm') return json_({ ok: true, data: requestForm_(req.token) });
    if (!action) throw new Error('Unknown action: ' + req.action);
    if (req.action === 'home') ensureAppColumns_();
    const user = authenticate_(req.token);
    // Each app checks its own tick box in the Users sheet (admins can open everything).
    const app = ACTION_APP[req.action];
    if (app && !canUse_(user, app)) throw new Error('NOACCESS: ' + user.email + ' has no access to ' + appTitle_(app) + '. Ask the admin to tick it in the Users sheet.');
    const out = { ok: true, data: action(req.payload || {}, user) };
    if (user.session) out.session = user.session;   // the apps save it in place of the Google sign-in
    return json_(out);
  } catch (err) {
    return json_({ ok: false, error: String((err && err.message) || err) });
  }
}

const ACTIONS = {
  config: getConfig_,
  submit: submitRefill_,
  update: updateRefill_,
  mine: listMine_,
  all: listAll_,
  review: reviewRefill_,
  photo: getPhoto_,
  thumbs: getThumbs_,
  readPhoto: readPhoto_,
  transcribe: transcribe_,
  dashboard: dashboardData_,
  dashboardSave: dashboardSave_,
  home: homeApps_,
  ads: listAds_,
  adMedia: adMedia_,
  adSave: saveAd_,
  adDelete: deleteAd_,
  adSeen: adSeen_,
  adQuick: adQuick_,
  adManager: adManager_,
  adSettings: adSettingsSave_,
  adStats: adStats_,
  umList: umList_,
  umSave: umSave_,
  umBulk: umBulk_,
  umDept: umDeptSave_,
  umOt: umOt_,
  umOtSave: umOtSave_,
};

// ---------- Home menu: which apps each user can open ----------
// One tick box column per app in the Users sheet. Keys match the tiles in web/home.js.
const HOME_APPS = [
  { key: 'fuel', col: 'ចាក់សាំង' },
  { key: 'transport', col: 'ដឹកជញ្ជូន' },
  { key: 'overtime', col: 'ថែមម៉ោង' },
  { key: 'location', col: 'ទីតាំងថ្មី' },
  { key: 'dashboard', col: 'Dashboard' },
  { key: 'meeting', col: 'ប្រជុំ' },
  { key: 'incident', col: 'គ្រោះថ្នាក់' },
  { key: 'inbound', col: 'ទទួលទំនិញ' },
];
// Ticked for every user by default (Kim, 10 Oct 2026). Dashboard stays for reviewers and admins.
// Incident Report: anyone can report, so it starts ticked too (Kim, 25 Oct 2026); untick to hide it.
// Inbound (goods receipt) is not a default: tick ទទួលទំនិញ for the warehouse staff who receive goods.
const DEFAULT_APPS = ['fuel', 'transport', 'overtime', 'location', 'incident'];
const ACTION_APP = {
  config: 'fuel', submit: 'fuel', update: 'fuel', mine: 'fuel', all: 'fuel', review: 'fuel',
  // Ads (ads, adMedia, adSeen) show in every app, so they need no app tick box; the manager actions are admin only.
  dashboard: 'dashboard', dashboardSave: 'dashboard',
};

function appTitle_(key) {
  const a = HOME_APPS.find(x => x.key === key);
  return a ? a.col : key;
}

/** True when the user may open the app. A missing column means the menu isn't set up yet: everyone keeps today's access. */
function canUse_(user, key) {
  if (user.role === 'admin') return true;
  if (user.apps[key] === undefined) return key === 'dashboard' ? isReviewer_(user) : true;
  return user.apps[key];
}

function homeApps_(p, user) {
  ensureRecapTrigger_();
  ensurePhotoCheckTrigger_();
  ensureTelegramSettings_();
  const out = {
    user: { name: user.name, role: user.role, employeeId: user.employeeId || '' },
    apps: HOME_APPS.map(a => a.key).filter(k => canUse_(user, k)),
  };
  // Reviewers see how many entries wait for them on the Fuel Refill tile.
  if (isReviewer_(user) && canUse_(user, 'fuel')) {
    const n = pendingCount_();
    if (n) out.badges = { fuel: n };
  }
  // 🖼️ Gallery for everyone (switched off in the Gallery Manager's Settings) and the manager for admins (Kim, 30 Oct 2026).
  // adsVersion lets the home menu and every app know when the ads changed.
  out.adsVersion = adsVersion_();
  if (adSettings_().gallery) out.apps.push('gallery');
  // 👥 User Management: admins only, with the number of access requests waiting (Kim, 28 Oct 2026).
  if (isAdmin_(user)) {
    out.apps.push('adsmgr');
    out.apps.push('users');
    const w = umWaiting_();
    if (w) out.badges = Object.assign(out.badges || {}, { users: w });
  }
  return out;
}

/**
 * Adds the app tick box columns to the Users sheet the first time the home menu is opened.
 * Starting values: the DEFAULT_APPS ticked for everyone, Dashboard for reviewers and admins.
 * Also ticks the DEFAULT_APPS once for the users already in the sheet (Script Property APPS_DEFAULT_DONE).
 */
function ensureAppColumns_() {
  const sheet = SpreadsheetApp.getActive().getSheetByName(SHEETS.USERS);
  const header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(h => String(h).trim());
  const missing = HOME_APPS.filter(a => header.indexOf(a.col) < 0);
  const props = PropertiesService.getScriptProperties();
  if (!missing.length && props.getProperty('APPS_DEFAULT_DONE')) return;
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const now = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(h => String(h).trim());
    const roleCol = now.indexOf('Role');
    const rows = Math.max(sheet.getLastRow() - 1, 0);
    const roles = !rows ? [] : roleCol >= 0 ? sheet.getRange(2, roleCol + 1, rows, 1).getValues().map(r => String(r[0]).trim().toLowerCase()) : new Array(rows).fill('');
    missing.filter(a => now.indexOf(a.col) < 0).forEach(a => {
      const c = sheet.getLastColumn() + 1;
      sheet.getRange(1, c).setValue(a.col).setFontWeight('bold');
      // Only the rows that exist: blank tick boxes below would count as data and push new rows down the sheet.
      if (rows) sheet.getRange(2, c, rows, 1).insertCheckboxes().setValues(roles.map(r =>
        [DEFAULT_APPS.indexOf(a.key) >= 0 || (a.key === 'dashboard' && accessLevel_(r) !== 'user')]));
    });
    if (!props.getProperty('APPS_DEFAULT_DONE')) {
      const cols = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(h => String(h).trim());
      if (rows) HOME_APPS.filter(a => DEFAULT_APPS.indexOf(a.key) >= 0).forEach(a => {
        const c = cols.indexOf(a.col) + 1;
        if (c > 0) sheet.getRange(2, c, rows, 1).insertCheckboxes().setValues(roles.map(() => [true]));
      });
      props.setProperty('APPS_DEFAULT_DONE', new Date().toISOString());
    }
  } finally {
    lock.releaseLock();
  }
  delete tableCache_[SHEETS.USERS];
}

// ---------- Auth ----------

/**
 * Checks the sign-in (Google ID token or this app's own session) and returns the matching active user
 * from the Users sheet. A Google sign-in only lasts 1 hour, so it is swapped for a 30-day session that
 * renews itself while the person keeps using the apps. Setting Active to No still blocks them at once.
 */
function authenticate_(token) {
  if (!token) throw new Error('AUTH: Please sign in.');
  let email, session = null;
  const own = readSession_(token);
  if (own) {
    email = own.email;
    if (own.exp - Math.floor(Date.now() / 1000) < SESSION_RENEW_DAYS * 86400) session = makeSession_(email);
  } else {
    const cache = CacheService.getScriptCache();
    const key = 'tok_' + Utilities.base64EncodeWebSafe(
      Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, token));
    email = cache.get(key);
    if (!email) {
      const info = verifyToken_(token);
      email = info.email;
      const secondsLeft = Number(info.exp) - Math.floor(Date.now() / 1000);
      if (secondsLeft > 60) cache.put(key, email, Math.min(secondsLeft - 30, 3000));
    }
    session = makeSession_(email);
  }
  const user = readTable_(SHEETS.USERS).find(u =>
    String(u['Email']).trim().toLowerCase() === email && isYes_(u['Active']));
  if (!user) throw new Error('NOACCESS: ' + email + ' is not allowed to use this app. Ask the admin to add you to the Users sheet.');
  const apps = {};
  HOME_APPS.forEach(a => { if (a.col in user) apps[a.key] = isYes_(user[a.col]); });
  return { email: email, name: user['Name'] || '', role: accessLevel_(user['Role']), job: String(user['Role'] || 'user').trim().toLowerCase(), apps: apps, session: session,
    employeeId: String(user['Employee ID'] || '').trim(), dept: String(user['Department'] || '').trim() };
}

// ---------- Sessions: stay signed in ----------
// Shaped like a Google token (header.body.signature) so the apps read the email and expiry the same way.
// Signed with SESSION_SECRET, which the script creates once in Script Properties; deleting it signs everyone out.
const SESSION_DAYS = 30;
const SESSION_RENEW_DAYS = 15;   // used within the last 15 days: a fresh 30 days is sent back

function sessionSecret_() {
  const props = PropertiesService.getScriptProperties();
  let secret = props.getProperty('SESSION_SECRET');
  if (secret) return secret;
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    secret = props.getProperty('SESSION_SECRET');
    if (!secret) {
      secret = Utilities.getUuid() + Utilities.getUuid();
      props.setProperty('SESSION_SECRET', secret);
    }
  } finally {
    lock.releaseLock();
  }
  return secret;
}

const b64url_ = data => Utilities.base64EncodeWebSafe(data).replace(/=+$/, '');
const b64urlText_ = s => Utilities.newBlob(Utilities.base64DecodeWebSafe(s + '==='.slice((s.length + 3) % 4))).getDataAsString();
const SESSION_HEAD = b64url_(JSON.stringify({ alg: 'HS256', typ: 'STEEL' }));

function sessionSig_(text) {
  return b64url_(Utilities.computeHmacSha256Signature(text, sessionSecret_()));
}

function makeSession_(email) {
  const now = Math.floor(Date.now() / 1000);
  const body = b64url_(Utilities.newBlob(JSON.stringify({ email: email, iat: now, exp: now + SESSION_DAYS * 86400 })).getBytes());
  return SESSION_HEAD + '.' + body + '.' + sessionSig_(SESSION_HEAD + '.' + body);
}

/** This app's own session: returns {email, exp}, null for a Google token, or throws AUTH when expired or tampered with. */
function readSession_(token) {
  const parts = String(token).split('.');
  if (parts.length !== 3 || parts[0] !== SESSION_HEAD) return null;
  if (sessionSig_(parts[0] + '.' + parts[1]) !== parts[2]) throw new Error('AUTH: Sign-in expired. Please sign in again.');
  const body = JSON.parse(b64urlText_(parts[1]));
  if (!(body.exp * 1000 > Date.now())) throw new Error('AUTH: Sign-in expired. Please sign in again.');
  return { email: String(body.email).toLowerCase(), exp: body.exp };
}

/** Checks a Google Sign-In ID token with Google; returns its details with a lower-case email. */
function verifyToken_(token) {
  if (!token) throw new Error('AUTH: Please sign in.');
  const res = UrlFetchApp.fetch(
    'https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(token),
    { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) throw new Error('AUTH: Sign-in expired. Please sign in again.');
  const info = JSON.parse(res.getContentText());
  const clientId = getSetting_('GOOGLE_CLIENT_ID');
  if (!clientId || info.aud !== clientId) throw new Error('AUTH: Sign-in is not set up for this app.');
  if (String(info.email_verified) !== 'true') throw new Error('AUTH: Google email is not verified.');
  info.email = String(info.email).toLowerCase();
  return info;
}

// ---------- Request to Admin ----------
// A person signed in with Google but not allowed yet fills in a short form (full name, employee ID,
// department from the "Department" sheet). The answers go into the Users sheet with Active = No, the
// usual apps already ticked, and a note goes to the Telegram alerts group. The admin switches Active to Yes.

const DEPT_SHEET = 'Department';
const REQ_COLS = ['Employee ID', 'Department'];
const EMP_ID_MIN = 100000, EMP_ID_MAX = 190000;   // Kim, 10 Oct 2026

/** Who is signed in (Google token or this app's session), without needing a Users row. */
function identity_(token) {
  const own = readSession_(token);
  return own ? { email: own.email, name: '' } : verifyToken_(token);
}

/**
 * The "Department" sheet (Kim, 10 Oct 2026): one row per department. The column whose header contains
 * "Department" or ផ្នែក (else column A) feeds the request form's drop-down; Active = No hides a department.
 * One tick box column per app (same titles as in Users) says which apps a new person from that department
 * gets: the request copies that row's ticks into their Users row. The columns are added automatically.
 */
let deptCache_ = null;   // read once per request

function deptTable_() {
  if (deptCache_) return deptCache_;
  const ss = SpreadsheetApp.getActive();
  let sheet = ss.getSheetByName(DEPT_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(DEPT_SHEET);
    sheet.getRange(1, 1, 1, 2).setValues([['Department', 'Active']]).setFontWeight('bold');
  }
  let header = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1)).getValues()[0].map(h => String(h).trim());
  const missing = HOME_APPS.filter(a => header.indexOf(a.col) < 0);
  if (missing.length) {
    const rows = Math.max(sheet.getLastRow() - 1, 0);
    missing.forEach(a => {
      const c = sheet.getLastColumn() + 1;
      sheet.getRange(1, c).setValue(a.col).setFontWeight('bold');
      // Starting ticks: the usual apps for everyone, Dashboard off. Change them per department.
      if (rows) sheet.getRange(2, c, rows, 1).insertCheckboxes().setValues(new Array(rows).fill([DEFAULT_APPS.indexOf(a.key) >= 0]));
      header.push(a.col);
    });
  }
  const values = sheet.getLastRow() < 2 ? [] : sheet.getRange(2, 1, sheet.getLastRow() - 1, header.length).getValues();
  const lower = header.map(h => h.toLowerCase());
  const name = Math.max(0, lower.findIndex(h => h.indexOf('department') >= 0 || h.indexOf('ផ្នែក') >= 0));
  const active = lower.indexOf('active');
  const seen = {};
  const list = [];
  values.forEach(r => {
    const d = String(r[name] || '').trim();
    if (!d || seen[d]) return;
    const apps = {};
    HOME_APPS.forEach(a => { const c = header.indexOf(a.col); apps[a.key] = r[c] === true || isYes_(r[c]); });
    seen[d] = { name: d, active: active < 0 || !isNo_(r[active]), apps: apps };
    list.push(seen[d]);
  });
  return (deptCache_ = list);
}

/** Department names for the drop-down. */
function departments_() {
  return deptTable_().filter(d => d.active).map(d => d.name);
}

/** The apps a new person from this department gets; the usual apps when the department isn't listed. */
function deptApps_(dept) {
  const row = deptTable_().find(d => d.name === dept);
  if (row) return row.apps;
  const apps = {};
  HOME_APPS.forEach(a => { apps[a.key] = DEFAULT_APPS.indexOf(a.key) >= 0; });
  return apps;
}

/** What the request form needs: the departments and anything this person already sent. */
function requestForm_(token) {
  const info = identity_(token);
  const sheet = SpreadsheetApp.getActive().getSheetByName(SHEETS.USERS);
  const values = sheet.getDataRange().getValues();
  const header = values[0].map(h => String(h).trim());
  const col = h => header.indexOf(h);
  const row = values.slice(1).find(r => String(r[col('Email')]).trim().toLowerCase() === info.email);
  const get = (r, h) => (r && col(h) >= 0 ? String(r[col(h)] || '').trim() : '');
  return {
    email: info.email,
    status: row && isYes_(row[col('Active')]) ? 'active' : row ? 'requested' : 'new',
    fullName: get(row, 'Name') || String(info.name || '').trim(),
    employeeId: get(row, 'Employee ID'),
    department: get(row, 'Department'),
    departments: departments_(),
  };
}

function requestAccess_(token, p) {
  const info = identity_(token);
  const email = info.email;
  // The form sends fullName, employeeId and department; older app versions send nothing.
  const form = p && p.fullName !== undefined;
  const name = String((form ? p.fullName : info.name) || '').replace(/\s+/g, ' ').trim().slice(0, 100);
  // Employee ID is a number (Khmer digits accepted); kept as text so leading zeros stay.
  const empId = form ? String(p.employeeId || '').replace(/[០-៩]/g, d => String('០១២៣៤៥៦៧៨៩'.indexOf(d))).replace(/\s+/g, '').slice(0, 20) : '';
  const dept = form ? String(p.department || '').trim().slice(0, 100) : '';
  if (form) {
    if (!name) throw new Error('Full name is required. / សូមបញ្ចូលឈ្មោះពេញ។');
    if (!empId) throw new Error('Employee ID is required. / សូមបញ្ចូលលេខសម្គាល់បុគ្គលិក។');
    if (!/^\d+$/.test(empId) || +empId < EMP_ID_MIN || +empId > EMP_ID_MAX) {
      throw new Error('Employee ID must be a number from ' + EMP_ID_MIN + ' to ' + EMP_ID_MAX + '. / លេខសម្គាល់បុគ្គលិក ត្រូវជាលេខពី ' + EMP_ID_MIN + ' ដល់ ' + EMP_ID_MAX + '។');
    }
    if (!dept) throw new Error('Department is required. / សូមជ្រើសរើសផ្នែក។');
    const list = departments_();
    if (list.length && list.indexOf(dept) < 0) throw new Error('Choose a department from the list. / សូមជ្រើសរើសផ្នែកពីបញ្ជី។');
  }
  const apps = deptApps_(dept);
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  let added = false, changed = false;
  try {
    const sheet = SpreadsheetApp.getActive().getSheetByName(SHEETS.USERS);
    let header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(h => String(h).trim());
    if (form) REQ_COLS.filter(h => header.indexOf(h) < 0).forEach(h => {
      sheet.getRange(1, sheet.getLastColumn() + 1).setValue(h).setFontWeight('bold');
      header.push(h);
    });
    const col = h => header.indexOf(h);
    const values = sheet.getDataRange().getValues();
    const i = values.findIndex((r, k) => k > 0 && String(r[col('Email')]).trim().toLowerCase() === email);
    if (i > 0 && isYes_(values[i][col('Active')])) return { status: 'active' };
    let r;
    if (i < 0) {
      sheet.appendRow(header.map(h => ({ Email: email, Name: name, Role: 'user', Active: 'No' })[h] || ''));
      r = sheet.getLastRow();
      // App tick boxes on the new row: the default apps ticked, so the admin only switches Active to Yes.
      HOME_APPS.forEach(a => { const c = col(a.col); if (c >= 0) sheet.getRange(r, c + 1).insertCheckboxes().setValue(apps[a.key]); });
      added = true;
    } else {
      r = i + 1;
      if (form && name) sheet.getRange(r, col('Name') + 1).setValue(name);
    }
    if (form) {
      const old = i > 0 ? [String(values[i][col('Employee ID')] || ''), String(values[i][col('Department')] || '')] : ['', ''];
      changed = added || old[0] !== empId || old[1] !== dept;
      // Kept as text so IDs like 00123 keep their zeros.
      sheet.getRange(r, col('Employee ID') + 1).setNumberFormat('@').setValue(empId);
      sheet.getRange(r, col('Department') + 1).setValue(dept);
      // Still waiting for the admin and the department changed: the app ticks follow the new department.
      if (i > 0 && old[1] !== dept) {
        HOME_APPS.forEach(a => { const c = col(a.col); if (c >= 0) sheet.getRange(r, c + 1).insertCheckboxes().setValue(apps[a.key]); });
      }
    }
  } finally {
    lock.releaseLock();
    delete tableCache_[SHEETS.USERS];
  }
  // One Telegram note per account every 6 hours (or when the details change), so repeated taps don't flood the group.
  const cache = CacheService.getScriptCache();
  // Sent to the alerts group (⚠️ ISI App Alert, Kim 10 Oct 2026); the new-refill group only while no alerts group is connected.
  const reqChat = getSetting_('TELEGRAM_ALERT_CHAT_ID') || getSetting_('TELEGRAM_CHAT_ID');
  if (telegramToken_() && reqChat && (added || changed || !cache.get('req_' + email))) {
    cache.put('req_' + email, '1', 21600);
    const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    try {
      telegram_('sendMessage', { chat_id: reqChat, parse_mode: 'HTML', text: [
        '🔑 <b>ស្នើសុំប្រើកម្មវិធី / Access request</b>',
        '👤 ' + esc(name || '-'),
        empId ? '🪪 ' + esc(empId) : null,
        dept ? '🏢 ' + esc(dept) : null,
        dept ? '📱 ' + HOME_APPS.filter(a => apps[a.key]).map(a => a.col).join(', ') : null,
        '📧 ' + esc(email),
        '',
        'អនុញ្ញាតនៅ 👥 អ្នកប្រើប្រាស់ / Approve in 👥 Users: https://isteel-app.pages.dev/users/#/req',
      ].filter(x => x !== null).join('\n') });
    } catch (e) { /* the request is saved in the sheet even if Telegram fails */ }
  }
  return { status: 'requested' };
}

function isReviewer_(user) {
  return user.role === 'reviewer' || user.role === 'admin';
}

/** Who may open an entry's details from the Telegram "Check" button: reviewers, admins and anyone with the Dashboard ticked (Kim, 17 Oct 2026). */
function canCheck_(user) {
  return isReviewer_(user) || canUse_(user, 'dashboard');
}

// ---------- Actions ----------

function getConfig_(payload, user) {
  const lists = driverTruck_();
  return {
    user: user,
    types: readTypes_(),
    plates: lists.plates,
    drivers: lists.drivers,
    brokenPlates: lists.brokenPlates,
    equipment: equipmentByType_(),
    litreLimit: Number(getSetting_('LITRE_LIMIT')) || 250,
    lastReadings: lastReadings_(),
    pendingCount: isReviewer_(user) ? pendingCount_() : undefined,
    canCheck: canCheck_(user),
    photoCheck: photoCheckReady_(),
    isAdmin: isAdmin_(user),
    adsVersion: adsVersion_(),
  };
}

function submitRefill_(p, user) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  let tgPost = null, pcJob = null;
  try {
    // The phone sends each entry with a ref and may send it again if the answer got lost: save it once.
    const ref = String(p.ref || '').slice(0, 64);
    const refs = ref ? JSON.parse(PropertiesService.getScriptProperties().getProperty('SUBMIT_REFS') || '{}') : {};
    if (ref && refs[ref]) return { id: refs[ref], duplicate: true };

    const sheet = refillSheet_();
    const cols = headerIndex_(sheet);
    addNewNames_(p);
    const clean = validate_(p, null);
    // The time Submit was pressed on the phone (it may be sent a little later); server time if it looks wrong.
    const taken = Number(p.takenAt);
    const now = taken && taken <= Date.now() + 5 * 60 * 1000 && taken >= Date.now() - 3 * 24 * 3600 * 1000
      ? new Date(taken) : new Date();
    const id = newId_(sheet, cols, now, p.newId);
    const values = new Array(sheet.getLastColumn()).fill('');
    const set = (name, v) => { if (cols[name] !== undefined) values[cols[name]] = v; };

    set(COL.ID_FR, id);
    set(COL.ID, id);
    set(COL.TYPE, clean.type);
    set(COL.PLATE, clean.plate);
    set(COL.DRIVER, clean.driver);
    set(COL.KM, clean.km === null ? '' : clean.km);
    set(COL.HOUR, clean.hour === null ? '' : clean.hour);
    set(COL.LITRES, clean.litres);
    set(COL.NOTE, clean.note);
    set(COL.DATE, new Date(now.getFullYear(), now.getMonth(), now.getDate()));
    set(COL.DATETIME, now);
    set(COL.LATLONG, clean.latLong);
    set(COL.USER, user.email);
    set(COL.ODO_PHOTO, savePhoto_(p.odoPhoto, id, 'odometer'));
    set(COL.HOUR_PHOTO, savePhoto_(p.hourPhoto, id, 'hourmeter'));
    set(COL.PUMP_PHOTO, savePhoto_(p.pumpPhoto, id, 'pump'));
    set(COL.SIGNATURE, savePhoto_(p.signature, id, 'signature'));

    const rowNum = sheet.getLastRow() + 1;
    if (rowNum > sheet.getMaxRows()) sheet.insertRowsAfter(sheet.getMaxRows(), 1);
    keepText_(sheet, rowNum, cols, TEXT_COLS);
    sheet.getRange(rowNum, 1, 1, values.length).setValues([values]);
    pendingChanged_();
    if (photoCheckReady_()) {
      pcJob = { id: id, meterUrl: values[cols[COL.ODO_PHOTO]] || values[cols[COL.HOUR_PHOTO]] || '',
        meterData: p.odoPhoto || p.hourPhoto || '', meterKind: clean.hour !== null && !clean.km ? 'hour' : 'km',
        pumpUrl: values[cols[COL.PUMP_PHOTO]] || '', pumpData: p.pumpPhoto || '' };
    }
    if (ref) {
      refs[ref] = id;
      const keys = Object.keys(refs);
      keys.slice(0, Math.max(0, keys.length - 300)).forEach(k => delete refs[k]);   // keep the last 300
      PropertiesService.getScriptProperties().setProperty('SUBMIT_REFS', JSON.stringify(refs));
    }
    if (telegramReady_() || alertsReady_()) {
      tgPost = { id: id, type: clean.type, plate: clean.plate, driver: clean.driver, km: clean.km, hour: clean.hour,
        litres: clean.litres, dateTime: now.getTime(), note: clean.note,
        odoPhoto: p.odoPhoto, hourPhoto: p.hourPhoto, pumpPhoto: p.pumpPhoto };
    }
    return { id: id, plate: clean.plate, driver: clean.driver };
  } finally {
    lock.releaseLock();
    // Posted straight away (a few seconds), using the photos already in hand. Google's timed triggers can
    // take minutes to run, so the queue + trigger is only the fallback when Telegram fails.
    if (tgPost) {
      try { alertUnusual_(tgPost, allRefills_(), telegramReady_() ? postRefillToTelegram_(tgPost) : null); }
      catch (e) { console.error('Telegram post failed for ' + tgPost.id + ': ' + e); queueTelegram_(tgPost.id); }
    }
    // The meter photos are read straight away too; the 5-minute timer picks up anything missed.
    if (pcJob) {
      try { photoCheckSave_(pcJob, readsFromTokens_(pcJob, p.reads, user.email) || readMeters_(pcJob)); }
      catch (e) { console.error('Photo check failed for ' + pcJob.id + ': ' + e); }
    }
  }
}

function updateRefill_(p, user) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sheet = refillSheet_();
    const cols = headerIndex_(sheet);
    const rowNum = findRow_(sheet, cols, p.id);
    const row = sheet.getRange(rowNum, 1, 1, sheet.getLastColumn()).getValues()[0];
    // Reviewers and admins can correct any entry; others only their own entries before review.
    if (!isReviewer_(user) && String(row[cols[COL.USER]]).toLowerCase() !== user.email) throw new Error('You can only edit your own entries.');
    // Reviewed entries are final for everyone (Kim, 19 Oct 2026).
    if (row[cols[COL.STATUS]]) throw new Error('This entry has already been reviewed and can no longer be edited.');
    const entryTime = row[cols[COL.DATETIME]] instanceof Date ? row[cols[COL.DATETIME]].getTime() : null;
    addNewNames_(p);
    const clean = validate_(p, p.id, entryTime);
    const put = (name, v) => { if (cols[name] !== undefined) row[cols[name]] = v; };
    put(COL.TYPE, clean.type);
    put(COL.PLATE, clean.plate);
    put(COL.DRIVER, clean.driver);
    put(COL.KM, clean.km === null ? '' : clean.km);
    put(COL.HOUR, clean.hour === null ? '' : clean.hour);
    put(COL.LITRES, clean.litres);
    put(COL.NOTE, clean.note);
    put(COL.UPDATED_AT, new Date());
    // New photos replace old ones; missing photos keep what is already saved.
    if (p.odoPhoto) put(COL.ODO_PHOTO, savePhoto_(p.odoPhoto, p.id, 'odometer'));
    if (p.hourPhoto) put(COL.HOUR_PHOTO, savePhoto_(p.hourPhoto, p.id, 'hourmeter'));
    if (p.pumpPhoto) put(COL.PUMP_PHOTO, savePhoto_(p.pumpPhoto, p.id, 'pump'));
    if (p.signature) put(COL.SIGNATURE, savePhoto_(p.signature, p.id, 'signature'));
    if (clean.meterRequired && clean.meter === 'km' && !clean.meterBroken && !row[cols[COL.ODO_PHOTO]]) throw new Error('Odometer photo is required.');
    if (clean.meterRequired && clean.meter === 'hour' && !row[cols[COL.HOUR_PHOTO]]) throw new Error('Hour meter photo is required.');

    keepText_(sheet, rowNum, cols, TEXT_COLS);
    sheet.getRange(rowNum, 1, 1, row.length).setValues([row]);
    return { id: p.id, plate: clean.plate, driver: clean.driver };
  } finally {
    lock.releaseLock();
  }
}

function listMine_(p, user) {
  const since = Date.now() - 45 * 24 * 3600 * 1000;
  return allRefills_()
    .filter(r => r.user === user.email && r.dateTime && r.dateTime >= since)
    .sort((a, b) => b.dateTime - a.dateTime)
    .slice(0, 60);
}

/** Every entry, newest first, for the reviewer tab (grouped by year / month / day on the phone). */
function listAll_(p, user) {
  if (!canCheck_(user)) throw new Error('Only reviewers can see this list.');
  // The reviewer's name from the Users tab is shown instead of the email (Kim, 19 Oct 2026).
  const names = {};
  readTable_(SHEETS.USERS).forEach(u => {
    const email = String(u['Email'] || '').trim().toLowerCase();
    if (email && u['Name']) names[email] = String(u['Name']).trim();
  });
  const checks = photoChecks_();
  return allRefills_()
    .map(r => Object.assign(r, { reviewedByName: names[r.reviewedBy.trim().toLowerCase()] || '', pc: photoCheckFor_(r, checks) }))
    .sort((a, b) => (b.dateTime || 0) - (a.dateTime || 0));
}

function reviewRefill_(p, user) {
  if (!isReviewer_(user)) throw new Error('Only reviewers can review entries.');
  if (p.status !== STATUS_OK && p.status !== STATUS_BAD) throw new Error('Invalid review status.');
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sheet = refillSheet_();
    const cols = headerIndex_(sheet);
    const rowNum = findRow_(sheet, cols, p.id);
    // Kim, 17 Oct 2026: once an entry has a status it is final.
    if (String(sheet.getRange(rowNum, cols[COL.STATUS] + 1).getValue()).trim()) throw new Error('This entry has already been reviewed.');
    sheet.getRange(rowNum, cols[COL.STATUS] + 1).setValue(p.status);
    sheet.getRange(rowNum, cols[COL.REVIEWED_BY] + 1).setValue(user.email);
    sheet.getRange(rowNum, cols[COL.REVIEWED_AT] + 1).setValue(new Date());
    pendingChanged_();
    if (p.note) {
      const cell = sheet.getRange(rowNum, cols[COL.NOTE] + 1);
      const old = String(cell.getValue() || '');
      cell.setValue((old ? old + ' | ' : '') + 'Review: ' + p.note);
    }
    return { id: p.id, status: p.status };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Returns a photo as a data URL. New photos are Drive links inside the app's photo folder.
 * Old AppSheet photos ("Fuel Refill_Images/name.jpg") are looked up by file name in the folder
 * set as OLD_PHOTO_FOLDER_ID in the Settings sheet. Nothing outside those two folders is served.
 */
function getPhoto_(p, user) {
  const file = photoFile_(String(p.url || ''));
  if (!file) return { dataUrl: null };
  const blob = file.getBlob();
  return { dataUrl: 'data:' + blob.getContentType() + ';base64,' + Utilities.base64Encode(blob.getBytes()) };
}

/**
 * Small previews for the Reviewer list (Kim, 19 Oct 2026): Drive's own thumbnail of each photo,
 * kept 6 hours in the script cache so a second reviewer gets them without opening Drive again.
 * A photo Drive has not made a thumbnail for yet comes back as null and the app keeps its icon.
 */
function getThumbs_(p, user) {
  if (!canCheck_(user)) throw new Error('Only reviewers can see this list.');
  const urls = (Array.isArray(p.urls) ? p.urls : []).map(String).filter(Boolean).slice(0, 12);
  const cache = CacheService.getScriptCache();
  const keys = urls.map(u => 'th:' + (fileIdFromUrl_(u) || u).slice(-200));
  const hit = keys.length ? cache.getAll(keys) : {};
  const out = {};
  urls.forEach((url, i) => {
    if (hit[keys[i]]) { out[url] = hit[keys[i]]; return; }
    let data = null;
    try {
      const file = photoFile_(url);
      const blob = file && file.getThumbnail();
      if (blob) data = 'data:' + (blob.getContentType() || 'image/png') + ';base64,' + Utilities.base64Encode(blob.getBytes());
    } catch (e) { /* missing or not shared with the script: keep the icon */ }
    out[url] = data;
    if (data && data.length < 90000) cache.put(keys[i], data, 21600);
  });
  return { thumbs: out };
}

/** The Drive file behind a sheet photo link, only from the app's photo folders. */
function photoFile_(url) {
  const fileId = fileIdFromUrl_(url);
  if (fileId) {
    const f = DriveApp.getFileById(fileId);
    return inFolder_(f, photoFolder_().getId()) ? f : null;
  }
  const oldId = getSetting_('OLD_PHOTO_FOLDER_ID');
  if (!url || !oldId) return null;
  const it = DriveApp.getFolderById(oldId).getFilesByName(url.split('/').pop());
  return it.hasNext() ? it.next() : null;
}

function inFolder_(file, folderId) {
  const parents = file.getParents();
  while (parents.hasNext()) if (parents.next().getId() === folderId) return true;
  return false;
}

// ---------- Photo check (Kim, 19 Oct 2026) ----------
// Google's AI (Gemini) reads the number on the odometer / hour meter photo and on the fuel pump photo, and the
// Reviewer screen marks each entry ✓ (matches what was typed), ✕ (doesn't) or ? (photo could not be read).
// Readings go to a separate "Photo Check" tab; the Fuel Refill tab is never changed by this.
// Turn on: put the key from aistudio.google.com (Get API key) in Script Properties as GEMINI_API_KEY.
// Optional Script Property GEMINI_MODEL, e.g. gemini-2.5-flash. Try it from the editor with photoCheckTest.
// New entries are read right after saving; a timer every 5 minutes reads anything missed or re-photographed
// in the last PC_DAYS days. Matching (within 1 km / 1 hour / 1 litre) is worked out when the list is read,
// so a corrected km or litres updates the mark without reading the photo again.

const PC_HANDLER = 'photoCheckRun';
const PC_DAYS = 30;
const PC_HEAD = ['ID_FR', 'Checked At', 'Meter Photo', 'Meter Read', 'Meter Photo OK', 'Pump Photo', 'Pump Read', 'Pump Photo OK', 'Note'];
const GEMINI = 'https://generativelanguage.googleapis.com/v1beta';

function geminiKey_() {
  return PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY') || '';
}

// Kim's Google account was refused by Gemini (403, 19 Oct 2026), so the free Cloudflare Workers AI relay at
// <APP_URL>/fc/ is used whenever FC_SECRET is set (run fcSetup once); Gemini stays as the other way.
function fcSecret_() {
  return PropertiesService.getScriptProperties().getProperty('FC_SECRET') || '';
}

function photoCheckReady_() {
  return !!(fcSecret_() || geminiKey_());
}

/** Run once from the editor: makes the FC_SECRET password and shows where to paste it in Cloudflare. */
function fcSetup() {
  const props = PropertiesService.getScriptProperties();
  let secret = props.getProperty('FC_SECRET');
  if (!secret) {
    secret = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
    props.setProperty('FC_SECRET', secret);
  }
  console.log('Copy this password into Cloudflare > isteel-app > Settings > Variables and Secrets as FC_SECRET (type Secret):\n' + secret);
  const ping = UrlFetchApp.fetch(appUrl_() + '/fc/ping', { muteHttpExceptions: true });
  console.log('Cloudflare says: ' + ping.getContentText() + '  (needs "ai":true and "secret":true; after adding them, Retry the latest deployment)');
}

function fcCall_(action, body) {
  return { url: appUrl_() + '/fc/' + action, method: 'post', contentType: 'application/json', payload: JSON.stringify(body),
    headers: { 'X-FC-Key': fcSecret_() }, muteHttpExceptions: true };
}

function fcAnswer_(res) {
  let d = {};
  try { d = JSON.parse(res.getContentText()); } catch (e) { /* not JSON */ }
  if (res.getResponseCode() !== 200 || !d.ok) throw new Error('Cloudflare AI ' + res.getResponseCode() + ': ' + (d.error || res.getContentText().slice(0, 300)));
  return d;
}

/** Cloudflare way: one call per photo, both photos at the same time. Same answer shape as readMeters_. */
function readMetersCf_(job) {
  const out = { meter: null, litres: null, meterOk: null, pumpOk: null, note: '', model: '' };
  const asks = [];
  const meter = job.meterUrl ? pcImage_(job.meterData, job.meterUrl) : null;
  const pump = job.pumpUrl ? pcImage_(job.pumpData, job.pumpUrl) : null;
  const dataUrl = img => 'data:' + img.inline_data.mime_type + ';base64,' + img.inline_data.data;
  if (meter) asks.push(['meter', fcCall_('read', { kind: job.meterKind === 'hour' ? 'hour' : 'km', image: dataUrl(meter) })]);
  if (pump) asks.push(['pump', fcCall_('read', { kind: 'litres', image: dataUrl(pump) })]);
  if (!asks.length) { out.note = 'Photos not found'; return out; }
  const answers = UrlFetchApp.fetchAll(asks.map(a => a[1]));
  const notes = [];
  asks.forEach((a, i) => {
    const d = fcAnswer_(answers[i]);
    out.model = d.model || out.model;
    if (a[0] === 'meter') { out.meterOk = d.right === false ? false : d.right === true ? true : null; out.meter = out.meterOk === false ? null : pcNum_(d.value); }
    else { out.pumpOk = d.right === false ? false : d.right === true ? true : null; out.litres = out.pumpOk === false ? null : pcNum_(d.value); }
    if (d.note) notes.push(a[0] + ': ' + d.note);
  });
  out.note = notes.join('; ').slice(0, 300);
  return out;
}

function ensurePhotoCheckTrigger_() {
  if (!photoCheckReady_()) return;
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('PC_TRIGGER')) return;
  if (Date.now() - (Number(props.getProperty('PC_TRIGGER_TRIED')) || 0) < 24 * 3600 * 1000) return;
  try {
    if (!ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() === PC_HANDLER)) {
      ScriptApp.newTrigger(PC_HANDLER).timeBased().everyMinutes(5).create();
    }
    props.setProperty('PC_TRIGGER', String(Date.now()));
  } catch (e) {
    props.setProperty('PC_TRIGGER_TRIED', String(Date.now()));
    console.error('Photo check timer not created: ' + e);
  }
}

/** Saved readings by entry ID. */
function photoChecks_() {
  const out = {};
  readTable_(SHEETS.PHOTO_CHECK).forEach(r => { if (r['ID_FR']) out[String(r['ID_FR'])] = r; });
  return out;
}

const pcNum_ = v => (v === '' || v === null || v === undefined || isNaN(Number(v))) ? null : Number(v);

/** What the phone needs for one entry: the readings, only while the photos are the ones that were read. */
function photoCheckFor_(r, checks) {
  const c = checks[r.id];
  if (!c) return undefined;
  const meterUrl = r.odoPhoto || r.hourPhoto || '';
  const out = {};
  if (meterUrl && String(c['Meter Photo']) === meterUrl) {
    out.meter = pcNum_(c['Meter Read']);
    if (c['Meter Photo OK'] === 'No') out.meterWrong = true;
  }
  if (r.pumpPhoto && String(c['Pump Photo']) === r.pumpPhoto) {
    out.litres = pcNum_(c['Pump Read']);
    if (c['Pump Photo OK'] === 'No') out.pumpWrong = true;
  }
  return Object.keys(out).length ? out : undefined;
}

/**
 * The phone sends one meter or pump photo as soon as it is taken, so the driver is warned while still entering.
 * The reading is kept 6 hours under a token; Submit sends the tokens back and the photos are not read again.
 */
function readPhoto_(p, user) {
  if (!photoCheckReady_()) return { off: true };
  const kind = ['km', 'hour', 'litres'].indexOf(p.kind) >= 0 ? p.kind : 'km';
  const photo = String(p.photo || '');
  if (!/^data:image\/(jpeg|png);base64,/.test(photo) || photo.length > 4e6) throw new Error('Invalid photo.');
  const job = kind === 'litres' ? { pumpUrl: 'phone', pumpData: photo } : { meterUrl: 'phone', meterData: photo, meterKind: kind };
  const res = readMeters_(job);
  const value = kind === 'litres' ? res.litres : res.meter;
  const ok = kind === 'litres' ? res.pumpOk : res.meterOk;
  const token = Utilities.getUuid();
  CacheService.getScriptCache().put('pr:' + token, JSON.stringify({ kind: kind, value: value, ok: ok, by: user.email }), 6 * 3600);
  return { value: value, wrong: ok === false, token: token };
}

/**
 * Voice note for the Note box (Kim, 19 Oct 2026): the phone records up to a minute and Gemini writes it as text.
 * Uses the same GEMINI_API_KEY as the photo check. Nothing is saved here; the text goes back into the Note box.
 */
function transcribe_(p, user) {
  if (!photoCheckReady_()) throw new Error('Voice notes are not set up yet.');
  const m = /^data:(audio\/[\w.+-]+)(?:;[^,]*)?;base64,(.+)$/.exec(String(p.audio || ''));
  if (!m || m[2].length > 6e6) throw new Error('Invalid recording.');
  if (fcSecret_()) {
    try {
      const d = fcAnswer_(UrlFetchApp.fetchAll([fcCall_('transcribe', { audio: String(p.audio) })])[0]);
      return { text: String(d.text || '').slice(0, 1000) };
    } catch (e) {
      console.error(e);
      throw new Error('Could not turn the voice into text. Please try again.');
    }
  }
  const mime = { 'audio/mp4': 'audio/m4a', 'audio/x-m4a': 'audio/m4a', 'audio/mp3': 'audio/mpeg' }[m[1]] || m[1];
  const body = {
    contents: [{ role: 'user', parts: [{ text: [
      'Transcribe this short voice note from a driver or fuel attendant in Cambodia about a fuel refill.',
      'Write exactly what is said in Khmer script; keep English words in English. Write numbers and plate numbers as digits.',
      'No title, no quotes, no explanation. If there is no speech, answer with nothing.',
    ].join(' ') }, { inline_data: { mime_type: mime, data: m[2] } }] }],
    generationConfig: { temperature: 0 },
  };
  const res = UrlFetchApp.fetch(GEMINI + '/models/' + geminiModel_() + ':generateContent', {
    method: 'post', contentType: 'application/json', payload: JSON.stringify(body),
    headers: { 'x-goog-api-key': geminiKey_() }, muteHttpExceptions: true,
  });
  if (res.getResponseCode() !== 200) throw new Error('Could not turn the voice into text. Please try again.');
  const data = JSON.parse(res.getContentText());
  const text = (((data.candidates || [])[0] || {}).content || { parts: [] }).parts.map(x => x.text || '').join('').trim();
  return { text: text.slice(0, 1000) };
}

/** Readings the phone already got for these photos (see readPhoto_), or null when one is missing. */
function readsFromTokens_(job, tokens, email) {
  if (!tokens) return null;
  const cache = CacheService.getScriptCache();
  const get = k => {
    if (!tokens[k]) return null;
    try { const v = JSON.parse(cache.get('pr:' + tokens[k]) || 'null'); return v && v.by === email ? v : null; } catch (e) { return null; }
  };
  const out = { meter: null, litres: null, meterOk: null, pumpOk: null, note: 'Read on the phone' };
  if (job.meterUrl) {
    const m = get(job.meterKind === 'hour' ? 'hourPhoto' : 'odoPhoto');
    if (!m) return null;
    out.meter = m.value; out.meterOk = m.ok;
  }
  if (job.pumpUrl) {
    const m = get('pumpPhoto');
    if (!m) return null;
    out.litres = m.value; out.pumpOk = m.ok;
  }
  return out;
}

/** Timer: reads the photos of recent entries that have no reading yet (or got new photos), newest first. */
function photoCheckRun() {
  if (!photoCheckReady_()) return;
  // Gemini takes a few seconds per entry, so no sheet lock is held while reading; this flag stops two runs overlapping.
  const cache = CacheService.getScriptCache();
  if (cache.get('PC_RUNNING')) return;
  cache.put('PC_RUNNING', '1', 300);
  const started = Date.now();
  const since = started - PC_DAYS * 24 * 3600 * 1000;
  const checks = photoChecks_();
  const todo = allRefills_()
    .filter(r => r.dateTime && r.dateTime >= since && r.status !== STATUS_BAD)
    .filter(r => {
      const c = checks[r.id], meterUrl = r.odoPhoto || r.hourPhoto || '';
      if (!meterUrl && !r.pumpPhoto) return false;
      return !c || String(c['Meter Photo']) !== meterUrl || String(c['Pump Photo']) !== r.pumpPhoto;
    })
    .sort((a, b) => b.dateTime - a.dateTime)
    .slice(0, 8);
  for (const r of todo) {
    if (Date.now() - started > 4 * 60 * 1000) break;
    const job = { id: r.id, meterUrl: r.odoPhoto || r.hourPhoto || '', meterKind: r.odoPhoto ? 'km' : 'hour', pumpUrl: r.pumpPhoto };
    try { photoCheckSave_(job, readMeters_(job)); }
    catch (e) { console.error('Photo check stopped at ' + r.id + ': ' + e); break; }   // quota or key problem: try again later
  }
  cache.remove('PC_RUNNING');
}

/** Writes (or replaces) the entry's row in the Photo Check tab. */
function photoCheckSave_(job, res) {
  const ss = SpreadsheetApp.getActive();
  let sheet = ss.getSheetByName(SHEETS.PHOTO_CHECK);
  if (!sheet) {
    sheet = ss.insertSheet(SHEETS.PHOTO_CHECK);
    sheet.getRange(1, 1, 1, PC_HEAD.length).setValues([PC_HEAD]).setFontWeight('bold');
    sheet.setFrozenRows(1);
    sheet.getRange('A:A').setNumberFormat('@');
  }
  const yn = v => v === true ? 'Yes' : v === false ? 'No' : '';
  const row = [job.id, new Date(), job.meterUrl || '', res.meter === null ? '' : res.meter, yn(res.meterOk),
    job.pumpUrl || '', res.litres === null ? '' : res.litres, yn(res.pumpOk), res.note || ''];
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const n = sheet.getLastRow() - 1;
    const ids = n > 0 ? sheet.getRange(2, 1, n, 1).getValues().map(v => String(v[0])) : [];
    const i = ids.indexOf(String(job.id));
    sheet.getRange(i >= 0 ? i + 2 : sheet.getLastRow() + 1, 1, 1, row.length).setValues([row]);
    delete tableCache_[SHEETS.PHOTO_CHECK];
  } finally {
    lock.releaseLock();
  }
}

/** One Gemini call per entry with both photos. Returns { meter, litres, meterOk, pumpOk, note }; null = could not be read.
 *  meterOk / pumpOk = false when the photo is not that kind of meter at all (wrong photo). */
function readMeters_(job) {
  if (fcSecret_()) return readMetersCf_(job);
  const parts = [{ text: PC_PROMPT }];
  const meter = job.meterUrl ? pcImage_(job.meterData, job.meterUrl) : null;
  const pump = job.pumpUrl ? pcImage_(job.pumpData, job.pumpUrl) : null;
  if (meter) parts.push({ text: 'Photo A: ' + (job.meterKind === 'hour' ? 'hour meter (hours)' : 'vehicle odometer (km)') }, meter);
  else parts.push({ text: 'Photo A: none' });
  if (pump) parts.push({ text: 'Photo B: fuel pump display' }, pump);
  else parts.push({ text: 'Photo B: none' });
  const out = { meter: null, litres: null, meterOk: null, pumpOk: null, note: '' };
  if (!meter && !pump) { out.note = 'Photos not found'; return out; }
  const body = {
    contents: [{ role: 'user', parts: parts }],
    generationConfig: {
      temperature: 0,
      responseMimeType: 'application/json',
      responseSchema: { type: 'OBJECT', properties: {
        meterIsMeter: { type: 'BOOLEAN', nullable: true }, meter: { type: 'NUMBER', nullable: true },
        pumpIsPump: { type: 'BOOLEAN', nullable: true }, litres: { type: 'NUMBER', nullable: true }, note: { type: 'STRING' } } },
    },
  };
  const res = UrlFetchApp.fetch(GEMINI + '/models/' + geminiModel_() + ':generateContent', {
    method: 'post', contentType: 'application/json', payload: JSON.stringify(body),
    headers: { 'x-goog-api-key': geminiKey_() }, muteHttpExceptions: true,
  });
  const code = res.getResponseCode();
  if (code !== 200) throw new Error('Gemini ' + code + ': ' + res.getContentText().slice(0, 300));
  const data = JSON.parse(res.getContentText());
  const text = (((data.candidates || [])[0] || {}).content || { parts: [] }).parts.map(x => x.text || '').join('');
  let got = {};
  try { got = JSON.parse(text); } catch (e) { out.note = 'Unreadable answer'; return out; }
  const yes = v => v === true ? true : v === false ? false : null;
  if (meter) { out.meterOk = yes(got.meterIsMeter); out.meter = out.meterOk === false ? null : pcNum_(got.meter); }
  if (pump) { out.pumpOk = yes(got.pumpIsPump); out.litres = out.pumpOk === false ? null : pcNum_(got.litres); }
  out.note = String(got.note || '').slice(0, 300);
  out.model = geminiModel_();
  return out;
}

const PC_PROMPT = [
  'You check fuel refill records for a steel company in Cambodia. Read the numbers in the photos.',
  'Each photo may have a dark blue strip at the bottom with an ID and a date: that is a watermark, ignore it.',
  'Photo A is a vehicle odometer (return the total distance in whole km; ignore the trip meter and the tenths digit)',
  'or a machine hour meter (return hours, with the decimal if shown).',
  'Photo B is a fuel pump. Return the litres of this refill from the main display (often marked LITRE or L).',
  'Ignore the small running-total counter (TOTAL), the price and any money amount.',
  'On rolling number wheels a digit between two numbers counts as the lower one.',
  'First say if each photo really is that kind of meter: meterIsMeter = true only when Photo A shows a vehicle odometer',
  '(or, when asked, a machine hour meter); pumpIsPump = true only when Photo B shows a fuel pump or fuel meter display.',
  'A fuel pump in Photo A, an odometer in Photo B, a person, a truck, paper, a screen or anything else is false (wrong photo).',
  'Return null for a number that is missing, blurred or cut off. Never guess.',
  'Answer JSON: {"meterIsMeter": bool|null, "meter": number|null, "pumpIsPump": bool|null, "litres": number|null,',
  '"note": "short reason when something is null or false"}. Use null for a photo marked none.',
].join(' ');

/** A photo for Gemini: the data URL the phone just sent, or the saved file from Drive. */
function pcImage_(dataUrl, url) {
  const m = /^data:(image\/(?:jpeg|png));base64,(.+)$/.exec(String(dataUrl || ''));
  if (m) return { inline_data: { mime_type: m[1], data: m[2] } };
  const file = photoFile_(url);
  if (!file) return null;
  const blob = file.getBlob();
  return { inline_data: { mime_type: blob.getContentType() || 'image/jpeg', data: Utilities.base64Encode(blob.getBytes()) } };
}

/** GEMINI_MODEL, else the newest stable gemini-N-flash this key can use (kept 6 hours). */
function geminiModel_() {
  const set = PropertiesService.getScriptProperties().getProperty('GEMINI_MODEL');
  if (set) return set;
  const cache = CacheService.getScriptCache();
  const hit = cache.get('GEMINI_MODEL');
  if (hit) return hit;
  let best = 'gemini-2.5-flash', bestV = 0;
  try {
    const res = UrlFetchApp.fetch(GEMINI + '/models?pageSize=1000', { headers: { 'x-goog-api-key': geminiKey_() }, muteHttpExceptions: true });
    (JSON.parse(res.getContentText()).models || []).forEach(m => {
      const name = String(m.name || '').replace(/^models\//, '');
      const v = (name.match(/^gemini-(\d+(?:\.\d+)?)-flash$/) || [])[1];
      if (v && (m.supportedGenerationMethods || []).indexOf('generateContent') >= 0 && +v > bestV) { best = name; bestV = +v; }
    });
  } catch (e) { /* keep the fallback */ }
  cache.put('GEMINI_MODEL', best, 6 * 3600);
  return best;
}

/** Run from the editor: reads the newest entry with photos and shows the result in the log. */
function photoCheckTest() {
  if (!photoCheckReady_()) throw new Error('Run fcSetup first (free Cloudflare AI), or add GEMINI_API_KEY in Script Properties.');
  const r = allRefills_().filter(x => x.odoPhoto || x.hourPhoto || x.pumpPhoto).sort((a, b) => b.dateTime - a.dateTime)[0];
  if (!r) throw new Error('No entry with photos yet.');
  const job = { id: r.id, meterUrl: r.odoPhoto || r.hourPhoto || '', meterKind: r.odoPhoto ? 'km' : 'hour', pumpUrl: r.pumpPhoto };
  const res = readMeters_(job);
  photoCheckSave_(job, res);
  ensurePhotoCheckTrigger_();
  console.log(r.id + ' (' + r.plate + ') model ' + res.model + ': typed ' + (r.km !== null ? r.km + ' km' : r.hour + ' h') + ', ' + r.litres +
    ' L. Photo: ' + res.meter + (res.meterOk === false ? ' (wrong photo)' : '') + ' / ' + res.litres + ' L' + (res.pumpOk === false ? ' (wrong photo)' : '') + '. ' + res.note);
}

// ---------- Fuel dashboard (read only) ----------
// The dashboard only reads "Fuel Refill". Its own settings (targets, vehicle types, fuel price)
// are kept as JSON in a separate "Dashboard Settings" sheet.

const DASH_SHEET = 'Dashboard Settings';
const DASH_FIELDS = [
  ['id', COL.ID_FR], ['type', COL.TYPE], ['plate', COL.PLATE], ['driver', COL.DRIVER],
  ['km', COL.KM], ['litres', COL.LITRES], ['dateTime', COL.DATETIME], ['status', COL.STATUS],
  ['user', COL.USER], ['hour', COL.HOUR], ['note', COL.NOTE],
  ['odoPhoto', COL.ODO_PHOTO], ['pumpPhoto', COL.PUMP_PHOTO], ['hourPhoto', COL.HOUR_PHOTO],
];

function dashboardData_(p, user) {
  if (!canUse_(user, 'dashboard')) throw new Error('NOACCESS: Only users with Dashboard ticked in the Users sheet can open the dashboard.');
  const raw = dashboardRaw_();
  raw.user = { name: user.name, role: user.role };
  return raw;
}

/** Everything the dashboard reads (also used for the Telegram monthly recap). */
function dashboardRaw_() {
  const sheet = refillSheet_();
  const values = sheet.getDataRange().getValues();
  const header = values.shift().map(h => String(h).trim());
  const idx = DASH_FIELDS.map(f => header.indexOf(f[1]));
  // "Entered by" goes out as the person's name from the Users sheet, never the email.
  const userCol = DASH_FIELDS.findIndex(f => f[0] === 'user');
  const names = {};
  readTable_(SHEETS.USERS).forEach((u, i) => {
    const email = String(u['Email'] || '').trim().toLowerCase();
    if (email) names[email] = String(u['Name'] || '').trim() || 'No name (Users row ' + (i + 2) + ')';
  });
  const nameOf = email => {
    const e = String(email || '').trim().toLowerCase();
    return !e ? '' : names[e] || 'Not in Users sheet';
  };
  const rows = [];
  values.forEach(r => {
    if (idx[0] < 0 || r[idx[0]] === '') return;
    rows.push(idx.map((i, k) => {
      if (i < 0) return '';
      const v = r[i];
      if (k === userCol) return nameOf(v);
      if (v instanceof Date) return v.getTime();
      // Drive photo links shortened to "d:<file id>" to keep the download small; the dashboard expands them.
      return typeof v === 'string' ? v.replace(/^https:\/\/drive\.google\.com\/file\/d\/([\w-]+)\/view.*$/, 'd:$1') : v;
    }));
  });
  return {
    columns: DASH_FIELDS.map(f => f[0]),
    rows: rows,
    types: readTable_(SHEETS.TYPES).map(t => ({
      name: String(t['Type of Refill'] || '').trim(),
      meter: String(t['Meter'] || '').trim().toLowerCase(),
    })).filter(t => t.name),
    drivers: readTable_(SHEETS.DRIVER_TRUCK).map(d => ({
      no: d['ID_DL'], name: String(d['ឈ្មោះ'] || '').trim(),
      label: String(d[DT_DRIVER] || '').trim(), plate: String(d[DT_PLATE] || '').trim(),
    })).filter(d => d.label || d.name),
    brokenPlates: driverTruck_().brokenPlates,
    settings: dashSettings_(),
    generatedAt: Date.now(),
  };
}

function dashboardSave_(p, user) {
  if (!canUse_(user, 'dashboard')) throw new Error('NOACCESS: Only users with Dashboard ticked in the Users sheet can change dashboard settings.');
  const text = JSON.stringify(p.settings || {});
  if (text.length > 45000) throw new Error('Settings are too large.');
  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName(DASH_SHEET) || ss.insertSheet(DASH_SHEET);
  sheet.getRange(1, 1, 3, 2).setValues([
    ['Key', 'Value'],
    ['settings', text],
    ['updated', user.email + ' ' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm')],
  ]);
  const odo = p.odometer && typeof p.odometer === 'object' ? p.odometer : {};
  return { saved: true, odometer: setOdometer_(odo) };
}

/**
 * Dashboard Settings › Plates › Good / Odometer Broken: writes Yes (broken) or No (good) in the
 * "Odometer Broken?" column of Driver & Truck for every row with that plate. Only that column changes.
 */
function setOdometer_(odo) {
  const plates = Object.keys(odo).map(k => String(k).trim().toUpperCase()).filter(Boolean);
  if (!plates.length) return { updated: 0, missing: [] };
  const want = {};
  Object.keys(odo).forEach(k => { want[String(k).trim().toUpperCase()] = odo[k] === 'broken' ? 'Yes' : 'No'; });
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sheet = SpreadsheetApp.getActive().getSheetByName(SHEETS.DRIVER_TRUCK);
    const lastCol = sheet.getLastColumn();
    const header = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(h => String(h).trim());
    const codeCol = header.indexOf(DT_PLATE);
    if (codeCol < 0) throw new Error('CODE column not found in Driver & Truck.');
    let col = header.findIndex(h => DT_BROKEN.test(h));
    if (col < 0) { col = lastCol; sheet.getRange(1, col + 1).setValue('Odometer Broken?'); }
    const n = sheet.getLastRow() - 1;
    if (n < 1) return { updated: 0, missing: plates };
    const codes = sheet.getRange(2, codeCol + 1, n, 1).getValues();
    const cells = sheet.getRange(2, col + 1, n, 1);
    const vals = cells.getValues();
    const found = {};
    let updated = 0;
    codes.forEach((c, i) => {
      const code = String(c[0] || '').trim().toUpperCase();
      if (!want[code]) return;
      found[code] = true;
      if (String(vals[i][0]).trim() !== want[code]) { vals[i][0] = want[code]; updated++; }
    });
    if (updated) cells.setValues(vals);
    delete tableCache_[SHEETS.DRIVER_TRUCK];
    return { updated: updated, missing: plates.filter(x => !found[x]) };
  } finally {
    lock.releaseLock();
  }
}

function dashSettings_() {
  const sheet = SpreadsheetApp.getActive().getSheetByName(DASH_SHEET);
  if (!sheet) return null;
  try { return JSON.parse(String(sheet.getRange(2, 2).getValue() || 'null')); } catch (e) { return null; }
}

// ---------- Telegram notifications ----------
// Each new entry is posted to a Telegram group with a short summary and its photos.
// The bot token is kept in Script Properties (TELEGRAM_BOT_TOKEN), not in the sheet, so sheet users can't see it.
// The group's chat ID is saved in the Settings sheet (TELEGRAM_CHAT_ID) by telegramConnect(); clear it to stop posting.
// Posting happens a few seconds after saving, from a one-off trigger, so the app doesn't wait for Telegram.

const TG_HANDLER = 'sendTelegramQueue';
const TG_QUEUE = 'TG_QUEUE';
const TG_DUE = 'TG_DUE';

/**
 * Adds a new entry to the Telegram queue (called while submitRefill_ holds the lock).
 * Returns 'now' when no trigger could be scheduled, so the caller posts straight away instead.
 */
function queueTelegram_(id) {
  try {
    if (!telegramReady_()) return '';
    const props = PropertiesService.getScriptProperties();
    const queue = JSON.parse(props.getProperty(TG_QUEUE) || '[]');
    queue.push({ id: id, tries: 0 });
    props.setProperty(TG_QUEUE, JSON.stringify(queue));
    return scheduleTelegram_(5) ? 'queued' : 'now';
  } catch (e) {
    console.error(e);
    return '';
  }
}

/** Makes sure a one-off trigger will run sendTelegramQueue soon. Returns false if triggers aren't allowed. */
function scheduleTelegram_(seconds) {
  const props = PropertiesService.getScriptProperties();
  const due = Number(props.getProperty(TG_DUE)) || 0;
  if (due && Date.now() - due < 10 * 60 * 1000) return true;   // one is already on its way
  try {
    deleteTelegramTriggers_();
    ScriptApp.newTrigger(TG_HANDLER).timeBased().after(seconds * 1000).create();
    props.setProperty(TG_DUE, String(Date.now()));
    return true;
  } catch (e) {
    console.error('Telegram trigger not created: ' + e);
    return false;
  }
}

function deleteTelegramTriggers_() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === TG_HANDLER)
    .forEach(t => ScriptApp.deleteTrigger(t));
}

/** Posts every queued entry to the group. Run by the trigger; you can also run it from the editor. */
function sendTelegramQueue() {
  const props = PropertiesService.getScriptProperties();
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  let queue;
  try {
    try { deleteTelegramTriggers_(); } catch (e) { /* no trigger permission: posting inline */ }
    queue = JSON.parse(props.getProperty(TG_QUEUE) || '[]');
    props.deleteProperty(TG_QUEUE);
    props.deleteProperty(TG_DUE);
  } finally {
    lock.releaseLock();
  }
  if (!queue.length || !telegramReady_()) return;

  const rows = allRefills_();
  const retry = [];
  queue.forEach(item => {
    const r = rows.find(x => x.id === item.id);
    if (!r) return;
    try {
      alertUnusual_(r, rows, postRefillToTelegram_(r));
    } catch (e) {
      console.error('Telegram post failed for ' + item.id + ': ' + e);
      if (item.tries < 3) retry.push({ id: item.id, tries: item.tries + 1 });
    }
  });
  if (retry.length) {
    lock.waitLock(30000);
    try {
      const later = JSON.parse(props.getProperty(TG_QUEUE) || '[]');
      props.setProperty(TG_QUEUE, JSON.stringify(retry.concat(later)));
      scheduleTelegram_(60);
    } finally {
      lock.releaseLock();
    }
  }
}

/**
 * Sends one entry with a "Check" button: one photo with the summary, or a text message.
 * Telegram allows no buttons on an album, so 2+ photos go as an album with the summary and button just under it.
 */
function postRefillToTelegram_(r) {
  const chatId = getSetting_('TELEGRAM_CHAT_ID');
  const caption = telegramCaption_(r);
  const buttons = JSON.stringify({ inline_keyboard: [[checkButton_(r)]] });
  const photos = [r.odoPhoto, r.hourPhoto, r.pumpPhoto].map(telegramPhoto_).filter(Boolean);
  if (!photos.length) {
    return telegram_('sendMessage', { chat_id: chatId, text: caption, parse_mode: 'HTML', reply_markup: buttons });
  }
  if (photos.length === 1) {
    return telegram_('sendPhoto', { chat_id: chatId, photo: photos[0], caption: caption, parse_mode: 'HTML', reply_markup: buttons });
  }
  const payload = { chat_id: chatId };
  payload.media = JSON.stringify(photos.map((blob, i) => {
    payload['p' + i] = blob;
    return { type: 'photo', media: 'attach://p' + i };
  }));
  const album = telegram_('sendMediaGroup', payload);
  const first = Array.isArray(album) ? album[0] : album;
  const text = { chat_id: chatId, text: caption, parse_mode: 'HTML', reply_markup: buttons };
  if (first && first.message_id) text.reply_parameters = JSON.stringify({ message_id: first.message_id, allow_sending_without_reply: true });
  return telegram_('sendMessage', text);
}

/**
 * The "Check" button: opens the entry's details in the Fuel app. Telegram shows a button to everyone in the group,
 * so the app itself lets only reviewers, admins and Dashboard users see the details (canCheck_).
 */
function checkButton_(r) {
  return { text: '🔎 ពិនិត្យ · Check', url: appUrl_() + '/fuel/?check=' + encodeURIComponent(r.id) };
}

function telegramPhoto_(url) {
  // A photo just sent from the phone (data URL) is used as is; saved entries load it from Drive.
  const m = /^data:(image\/(jpeg|png));base64,(.+)$/.exec(String(url || ''));
  if (m) return Utilities.newBlob(Utilities.base64Decode(m[3]), m[1], 'photo.' + (m[2] === 'png' ? 'png' : 'jpg'));
  const id = fileIdFromUrl_(url);
  if (!id) return null;
  try {
    const blob = DriveApp.getFileById(id).getBlob();
    return blob.setName(blob.getName() || 'photo.jpg');
  } catch (e) {
    return null;
  }
}

function telegramCaption_(r) {
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const num = n => Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 });
  const type = readTypes_().find(t => t.name === r.type) || { meter: 'none' };
  const when = r.dateTime
    ? Utilities.formatDate(new Date(r.dateTime), Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm') : '';
  const lines = [
    '⛽ <b>ចាក់សាំងថ្មី / New fuel refill</b>',
    '<b>' + esc(r.type) + '</b>',
    '',
    (type.meter === 'km' ? '🚚 ផ្លាកលេខ / Plate: ' : '🔧 ឧបករណ៍ / Equipment: ') + '<b>' + esc(r.plate) + '</b>',
    '👤 តៃកុង / Driver: ' + esc(r.driver),
  ];
  if (r.km) lines.push('📏 កុងទ័រ / Km: <b>' + num(r.km) + '</b>');
  if (r.hour) lines.push('⏱ ម៉ោង / Hours: <b>' + num(r.hour) + '</b>');
  lines.push('🛢 ចំនួនចាក់ / Litres: <b>' + num(r.litres) + ' L</b>');
  if (when) lines.push('🕒 ' + when);
  if (r.note) lines.push('📝 សំគាល់ / Note: ' + esc(r.note.length > 300 ? r.note.slice(0, 300) + '…' : r.note));
  lines.push('🆔 <code>' + esc(r.id) + '</code>');
  return lines.join('\n');
}

function telegramReady_() {
  return !!(telegramToken_() && getSetting_('TELEGRAM_CHAT_ID'));
}

function telegramToken_() {
  return String(PropertiesService.getScriptProperties().getProperty('TELEGRAM_BOT_TOKEN') || '').trim();
}

/** Calls the Telegram Bot API. Follows the group if Telegram upgraded it to a supergroup (new chat ID). */
function telegram_(method, payload) {
  const res = UrlFetchApp.fetch('https://api.telegram.org/bot' + telegramToken_() + '/' + method,
    { method: 'post', payload: payload, muteHttpExceptions: true });
  let body = {};
  try { body = JSON.parse(res.getContentText()); } catch (e) { /* not JSON */ }
  if (body.ok) return body.result;
  const moved = body.parameters && body.parameters.migrate_to_chat_id;
  if (moved && payload.chat_id) {
    ['TELEGRAM_CHAT_ID', 'TELEGRAM_ALERT_CHAT_ID'].forEach(k => { if (getSetting_(k) === String(payload.chat_id)) setSetting_(k, String(moved)); });
    payload.chat_id = String(moved);
    return telegram_(method, payload);
  }
  throw new Error('Telegram ' + method + ': ' + (body.description || 'HTTP ' + res.getResponseCode()));
}

// ---------- Waiting for review ----------
// Count of entries with no Review Status, for the reviewer badges. Kept for a minute so the
// home menu stays fast; a new entry or a review clears it straight away.
const PENDING_CACHE = 'PENDING_COUNT';

function pendingCount_() {
  const cache = CacheService.getScriptCache();
  const hit = cache.get(PENDING_CACHE);
  if (hit !== null) return Number(hit) || 0;
  const sheet = refillSheet_();
  const cols = headerIndex_(sheet);
  const n = sheet.getLastRow() - 1;
  if (n < 1 || cols[COL.STATUS] === undefined) return 0;
  const ids = sheet.getRange(2, cols[COL.ID_FR] + 1, n, 1).getValues();
  const status = sheet.getRange(2, cols[COL.STATUS] + 1, n, 1).getValues();
  let count = 0;
  ids.forEach((r, i) => { if (r[0] !== '' && String(status[i][0]).trim() === '') count++; });
  cache.put(PENDING_CACHE, String(count), 60);
  return count;
}

function pendingChanged_() {
  try { CacheService.getScriptCache().remove(PENDING_CACHE); } catch (e) { /* the count catches up within a minute */ }
}

// ---------- Unusual refill alerts (Telegram) ----------
// Sent to the alerts group (TELEGRAM_ALERT_CHAT_ID, connect it with telegramConnectAlerts) when a refill looks out of the ordinary:
//  · litres well above that truck's usual refill (1.5 × the median of its last 10, and at least 20 L more),
//  · a second refill for the same plate on the same day,
//  · km since the last refill above the dashboard's "Maximum km between refills" (Settings, default 2,000).
// Worded "Requires Investigation": it never says anyone did something wrong.
// Turn off by setting TELEGRAM_ALERTS = No in the Settings sheet.
const ALERT_LITRES_X = 1.5;

function median_(list) {
  const a = list.slice().sort((x, y) => x - y);
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

/** What is unusual about entry r, compared with the earlier entries of the same plate. */
function unusualRefill_(r, rows) {
  const out = { usual: null, sameDay: 0, kmGap: null };
  if (!r.plate || !r.dateTime) return out;
  const tz = Session.getScriptTimeZone();
  const day = t => Utilities.formatDate(new Date(t), tz, 'yyyy-MM-dd');
  const before = rows
    .filter(x => x.id !== r.id && x.plate === r.plate && x.type === r.type && x.status !== STATUS_BAD && x.dateTime && x.dateTime < r.dateTime)
    .sort((a, b) => b.dateTime - a.dateTime);

  const recent = before.filter(x => x.litres > 0).slice(0, 10).map(x => x.litres);
  if (recent.length >= 3) {
    const usual = median_(recent);
    if (r.litres > usual * ALERT_LITRES_X && r.litres - usual >= 20) out.usual = usual;
  }
  out.sameDay = before.filter(x => day(x.dateTime) === day(r.dateTime)).length;

  const broken = driverTruck_().brokenPlates.indexOf(r.plate) >= 0;
  const last = before.find(x => x.km > 1);
  if (r.km > 1 && last && !broken) {
    const maxJump = Number((dashSettings_() || {}).maxJumpKm) || 2000;
    if (r.km - last.km > maxJump) out.kmGap = r.km - last.km;
  }
  return out;
}

/** Posts the alert when something is unusual. replyTo: what Telegram returned for the entry's own post. */
function alertUnusual_(r, rows, replyTo) {
  try {
    if (!alertsReady_() || isNo_(getSetting_('TELEGRAM_ALERTS'))) return;
    const u = unusualRefill_(r, rows);
    if (u.usual === null && !u.sameDay && u.kmGap === null) return;
    const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const num = n => Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 });
    const lines = [
      '⚠️ <b>ការចាក់ខុសធម្មតា · Unusual refill</b>',
      '🚚 <b>' + esc(r.plate) + '</b> · ' + esc(r.driver),
      '⛽ <b>' + num(r.litres) + ' L</b>' + (u.usual !== null ? ' (ធម្មតា / usual ~' + num(u.usual) + ' L)' : ''),
    ];
    if (u.sameDay) lines.push('🔁 ចាក់លើកទី ' + (u.sameDay + 1) + ' នៅថ្ងៃនេះ / refill no. ' + (u.sameDay + 1) + ' today');
    if (u.kmGap !== null) lines.push('📏 ' + num(u.kmGap) + ' km ពីលើកមុន / since the last refill');
    lines.push('👉 Requires Investigation');
    if (r.dateTime) lines.push('🕒 ' + Utilities.formatDate(new Date(r.dateTime), Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm'));
    lines.push('🆔 <code>' + esc(r.id) + '</code>');
    const chatId = getSetting_('TELEGRAM_ALERT_CHAT_ID');
    const payload = { chat_id: chatId, text: lines.join('\n'), parse_mode: 'HTML', disable_web_page_preview: true,
      reply_markup: JSON.stringify({ inline_keyboard: [[checkButton_(r), { text: '📊 Dashboard', url: appUrl_() + '/dashboard/' }]] }) };
    // Shown as a reply under the entry's post only if alerts ever go to the same group.
    const first = Array.isArray(replyTo) ? replyTo[0] : replyTo;
    if (first && first.message_id && chatId === getSetting_('TELEGRAM_CHAT_ID')) {
      payload.reply_parameters = JSON.stringify({ message_id: first.message_id, allow_sending_without_reply: true });
    }
    telegram_('sendMessage', payload);
  } catch (e) {
    console.error('Unusual refill alert failed for ' + r.id + ': ' + e);   // never blocks the entry's own post
  }
}

/** Alerts and the recap go to their own group (TELEGRAM_ALERT_CHAT_ID, set by telegramConnectAlerts). */
function alertsReady_() {
  return !!(telegramToken_() && getSetting_('TELEGRAM_ALERT_CHAT_ID'));
}

function appUrl_() {
  return (getSetting_('APP_URL') || 'https://isteel-app.pages.dev').replace(/\/+$/, '');
}

// ---------- Monthly recap (Telegram) ----------
// On the 1st of each month at about 08:00, last month's figures go to the alerts group (TELEGRAM_ALERT_CHAT_ID). The numbers come from
// the dashboard's own engine (FuelEngine at the end of this file), so they match the dashboard.
// The timer is created automatically the first time someone opens the home menu after this update.
// Turn off by setting TELEGRAM_RECAP = No in the Settings sheet. To try it now, run telegramSendRecap.
const RECAP_HANDLER = 'sendMonthlyRecap';
const MONTHS_KM = ['មករា', 'កុម្ភៈ', 'មីនា', 'មេសា', 'ឧសភា', 'មិថុនា', 'កក្កដា', 'សីហា', 'កញ្ញា', 'តុលា', 'វិច្ឆិកា', 'ធ្នូ'];
const MONTHS_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function ensureRecapTrigger_() {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('RECAP_TRIGGER')) return;
  if (Date.now() - (Number(props.getProperty('RECAP_TRIGGER_TRIED')) || 0) < 24 * 3600 * 1000) return;   // failed: try again tomorrow
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return;
  try {
    if (props.getProperty('RECAP_TRIGGER')) return;
    if (!ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() === RECAP_HANDLER)) {
      ScriptApp.newTrigger(RECAP_HANDLER).timeBased().onMonthDay(1).atHour(8).create();
    }
    props.setProperty('RECAP_TRIGGER', String(Date.now()));
  } catch (e) {
    props.setProperty('RECAP_TRIGGER_TRIED', String(Date.now()));
    console.error('Monthly recap timer not created: ' + e);
  } finally {
    lock.releaseLock();
  }
}

/**
 * Adds the TELEGRAM_ALERTS and TELEGRAM_RECAP rows (Yes) to the Settings sheet once, so they are easy to find.
 * Change a value to No to stop that message. Rows already there are left as they are.
 */
function ensureTelegramSettings_() {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('TG_SETTINGS_ROWS')) return;
  try {
    const sheet = SpreadsheetApp.getActive().getSheetByName(SHEETS.SETTINGS);
    if (!sheet) return;
    const keys = sheet.getDataRange().getValues().map(r => String(r[0]).trim());
    [['TELEGRAM_ALERTS', 'Yes', 'Unusual refill alerts in the Telegram group. No = off.'],
     ['TELEGRAM_RECAP', 'Yes', 'Monthly recap in the Telegram group on the 1st at 08:00. No = off.']]
      .forEach(row => { if (keys.indexOf(row[0]) < 0) sheet.appendRow(row); });
    delete tableCache_[SHEETS.SETTINGS];
    props.setProperty('TG_SETTINGS_ROWS', String(Date.now()));
  } catch (e) {
    console.error('Telegram settings rows not added: ' + e);
  }
}

/** Run by the monthly timer: sends last month's recap. */
function sendMonthlyRecap() {
  if (!alertsReady_() || isNo_(getSetting_('TELEGRAM_RECAP'))) return;
  const now = new Date();
  const recap = FuelEngine.monthlyRecap(dashboardRaw_(), now.getFullYear(), now.getMonth() - 1);
  telegram_('sendMessage', { chat_id: getSetting_('TELEGRAM_ALERT_CHAT_ID'), text: recapText_(recap), parse_mode: 'HTML', disable_web_page_preview: true });
}

/** Run from the editor to send last month's recap now (to try it). */
function telegramSendRecap() {
  if (!alertsReady_()) throw new Error('The alerts group is not connected yet: run telegramConnectAlerts first.');
  ensureTelegramSettings_();
  sendMonthlyRecap();
}

function recapText_(r) {
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const n0 = n => Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 });
  const n1 = n => Number(n).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const prevName = MONTHS_EN[(r.month + 11) % 12];
  const lines = ['🏆 <b>សង្ខេបប្រចាំខែ' + MONTHS_KM[r.month] + ' · ' + MONTHS_EN[r.month] + ' ' + r.year + ' recap</b>', ''];
  lines.push('⛽ <b>' + n0(r.litres) + ' L</b>' + (r.spent !== null ? ' · <b>' + esc(r.currency) + n0(r.spent) + '</b>' : '') + ' · ' + n0(r.refills) + ' refills');
  if (r.prevLitres > 0) {
    const d = (r.litres / r.prevLitres - 1) * 100;
    lines.push('    ' + (Math.abs(d) < 1 ? 'about the same as ' : (d > 0 ? '▲ ' : '▼ ') + n0(Math.abs(d)) + '% vs ') + prevName);
  }
  if (r.l100 !== null) {
    let line = '📈 <b>' + n1(r.l100) + ' L/100 km</b>';
    if (r.prevL100) {
      const d = (r.l100 / r.prevL100 - 1) * 100;
      line += ' (' + (Math.abs(d) < 1 ? 'same as ' : (d > 0 ? '▲ ' : '▼ ') + n0(Math.abs(d)) + '% vs ') + prevName + ')';
    }
    lines.push(line);
  }
  if (r.budget > 0 && r.spent !== null) {
    const diff = r.spent - r.budget;
    lines.push('💰 Budget ' + esc(r.currency) + n0(r.budget) + ': ' + (diff > 0 ? '▲ ' + esc(r.currency) + n0(diff) + ' over' : '▼ ' + esc(r.currency) + n0(-diff) + ' under'));
  }
  lines.push('');
  if (r.savers.length) {
    lines.push('<b>Fuel Saver of the Month</b>');
    const medals = ['🥇', '🥈', '🥉'];
    r.savers.forEach((s, i) => lines.push(medals[i] + ' ' + esc(s.driver) + ' · ' + n1(s.l100) + ' L/100 km'));
    lines.push('');
  }
  lines.push('⭐ Complete Data: <b>' + n0(r.clean) + '</b> ' + (r.clean === 1 ? 'driver' : 'drivers') + ' with no data problems');
  if (r.investigate.length) {
    lines.push('🔎 Requires Investigation: ' + r.investigate.length + ' ' + (r.investigate.length === 1 ? 'vehicle' : 'vehicles')
      + ' (' + esc(r.investigate.slice(0, 5).join(', ')) + (r.investigate.length > 5 ? ' …' : '') + ')');
  }
  if (r.pending) lines.push('🧾 ' + n0(r.pending) + ' refills still waiting for review (not counted yet)');
  lines.push('🎉 អរគុណ! Thank you all!');
  lines.push('👉 <a href="' + appUrl_() + '/dashboard/">Dashboard</a>');
  return lines.join('\n');
}

/**
 * Run once from the editor (Kim's request, 9 Oct 2026): makes every driver name in "Fuel Refill"
 * match the numbered name in Driver & Truck column C, e.g. "សេង រដ្ឋា" → "15.សេង រដ្ឋា", 36 → "36.ខាត់ ស៊ីហា".
 * Only the driver column changes. Every change (and any name it can't match) is listed in a new
 * "Driver name fixes" sheet, which also keeps the old values.
 */
function fixDriverNames() {
  const plain = s => String(s).replace(/^\s*[0-9០-៩]+\s*[.)\-]?\s*/, '').replace(/\s+/g, ' ').trim();
  const byNo = {}, byName = {}, labels = {};
  readTable_(SHEETS.DRIVER_TRUCK).forEach(r => {
    const label = String(r[DT_DRIVER] || '').trim();
    if (!label) return;
    labels[label] = true;
    const m = label.match(/^\s*([0-9០-៩]+)\s*\./);
    const no = m ? toNumber_(m[1]) : toNumber_(r['ID_DL']);
    if (no && !byNo[no]) byNo[no] = label;
    const key = plain(label);
    (byName[key] = byName[key] || []).push({ label: label, plate: String(r[DT_PLATE] || '').trim() });
  });

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sheet = refillSheet_();
    const cols = headerIndex_(sheet);
    const n = sheet.getLastRow() - 1;
    if (n < 1) return 'No rows.';
    const all = sheet.getRange(2, 1, n, sheet.getLastColumn()).getValues();
    const drv = cols[COL.DRIVER], plateCol = cols[COL.PLATE], idCol = cols[COL.ID_FR];
    const out = all.map(r => [r[drv]]);
    const log = [];
    all.forEach((r, i) => {
      const v = String(r[drv] === null ? '' : r[drv]).trim();
      if (!v || labels[v]) return;
      let next = '';
      if (/^[0-9០-៩]+(\.0+)?$/.test(v)) {
        next = byNo[toNumber_(v)] || '';
      } else {
        const list = byName[plain(v)] || [];
        const plate = String(r[plateCol] || '').trim();
        next = (list.find(x => x.plate === plate) || list[0] || {}).label || '';
      }
      log.push([i + 2, r[idCol], v, next || '(not found, left as is)']);
      if (next) out[i][0] = next;
    });
    if (log.length) {
      sheet.getRange(2, drv + 1, n, 1).setValues(out);
      const ss = SpreadsheetApp.getActive();
      const logSheet = ss.getSheetByName('Driver name fixes') || ss.insertSheet('Driver name fixes');
      logSheet.clear();
      logSheet.getRange(1, 1, 1, 4).setValues([['Row', 'ID_FR', 'Old name', 'New name']]).setFontWeight('bold');
      logSheet.getRange(2, 1, log.length, 4).setValues(log);
    }
    const fixed = log.filter(x => x[3].indexOf('(not found') !== 0).length;
    const msg = 'Driver names fixed: ' + fixed + '. Not found: ' + (log.length - fixed) + '.';
    console.log(msg);
    return msg;
  } finally {
    lock.releaseLock();
  }
}

/**
 * Run once from the editor (Kim's request, 17 Oct 2026): puts back the truck plates that Google Sheets
 * turned into 0 (plates like 3E-2588 were read as a number). For each such row it picks the plate from
 * the driver's own truck, checked against the km reading, or else the one truck whose last km fits.
 * Only the plate column changes, and the whole column is set to Plain text so it can't happen again.
 * Every row is listed in a new "Plate fixes" sheet; rows it can't be sure about stay 0 there for a manual fix.
 */
function fixZeroPlates() {
  const ePlate = v => /^\d+E-\d+$/i.test(String(v || '').trim());
  const masterPlate = {};
  const candidates = [];
  readTable_(SHEETS.DRIVER_TRUCK).forEach(r => {
    const code = String(r[DT_PLATE] || '').trim().toUpperCase();
    if (!ePlate(code)) return;
    if (candidates.indexOf(code) < 0) candidates.push(code);
    const label = String(r[DT_DRIVER] || '').trim();
    if (label && !masterPlate[label]) masterPlate[label] = code;
  });

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sheet = refillSheet_();
    const cols = headerIndex_(sheet);
    const n = sheet.getLastRow() - 1;
    if (n < 1) return 'No rows.';
    const all = sheet.getRange(2, 1, n, sheet.getLastColumn()).getValues();
    const plateCol = cols[COL.PLATE], drvCol = cols[COL.DRIVER], kmCol = cols[COL.KM];
    const idCol = cols[COL.ID_FR], dtCol = cols[COL.DATETIME];
    const rows = all.map((r, i) => {
      const dt = r[dtCol];
      const km = kmCol === undefined ? NaN : toNumber_(r[kmCol]);
      return { i: i, id: r[idCol], plate: String(r[plateCol] === null ? '' : r[plateCol]).trim().toUpperCase(),
        driver: String(r[drvCol] || '').trim(), km: km > 0 ? km : null, t: dt instanceof Date ? dt.getTime() : 0 };
    }).sort((a, b) => a.t - b.t || a.i - b.i);
    rows.forEach(r => { if (ePlate(r.plate) && candidates.indexOf(r.plate) < 0) candidates.push(r.plate); });

    const lastKm = {}, used = {};   // per plate: last km so far; per driver: how often each E-plate was used
    const log = [];
    rows.forEach(r => {
      if (r.plate === '0') {
        const counts = used[r.driver] || {};
        const mine = masterPlate[r.driver]
          || Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0] || '';
        const gap = c => (r.km !== null && lastKm[c] !== undefined) ? r.km - lastKm[c] : null;
        const fits = c => { const g = gap(c); return g !== null && g >= 0 && g <= 3000; };
        let plate = '', how = '';
        if (mine && (r.km === null || lastKm[mine] === undefined || fits(mine))) {
          plate = mine; how = "driver's truck" + (fits(mine) ? ', km fits (+' + gap(mine) + ')' : '');
        } else {
          const ok = candidates.filter(fits).sort((a, b) => gap(a) - gap(b));
          if (ok.length === 1 || (ok.length > 1 && gap(ok[1]) - gap(ok[0]) > 500)) {
            plate = ok[0]; how = 'km follows on from this truck (+' + gap(ok[0]) + ')';
          } else {
            how = ok.length ? 'not sure: ' + ok.slice(0, 3).join(', ') : 'no truck matches the km';
          }
        }
        log.push([r.i + 2, r.id, r.driver, r.km === null ? '' : r.km, plate || '(left as 0)', how]);
        if (plate) r.plate = plate;
      }
      if (ePlate(r.plate)) {
        if (r.km !== null) lastKm[r.plate] = r.km;
        const u = used[r.driver] = used[r.driver] || {};
        u[r.plate] = (u[r.plate] || 0) + 1;
      }
    });

    sheet.getRange(2, plateCol + 1, sheet.getMaxRows() - 1, 1).setNumberFormat('@');
    log.forEach(l => { if (l[4].charAt(0) !== '(') sheet.getRange(l[0], plateCol + 1).setValue(l[4]); });
    const ss = SpreadsheetApp.getActive();
    const logSheet = ss.getSheetByName('Plate fixes') || ss.insertSheet('Plate fixes');
    logSheet.clear();
    logSheet.getRange(1, 1, 1, 6).setValues([['Row', 'ID_FR', 'Driver', 'Km', 'New plate', 'How']]).setFontWeight('bold');
    if (log.length) logSheet.getRange(2, 1, log.length, 6).setNumberFormat('@').setValues(log.map(l => l.map(String)));
    const fixed = log.filter(l => l[4].charAt(0) !== '(').length;
    const msg = 'Plates fixed: ' + fixed + '. Left as 0: ' + (log.length - fixed) + '.';
    console.log(msg);
    return msg;
  } finally {
    lock.releaseLock();
  }
}

/**
 * Run once from the editor: finds the group the bot was added to, saves its chat ID in the
 * Settings sheet and posts a test message there. Before running it, add the bot to the group
 * and send /start@<bot name> in the group.
 */
function telegramConnect() {
  const found = telegramGroups_();
  const chatId = found.ids[found.ids.length - 1];
  setSetting_('TELEGRAM_CHAT_ID', chatId);
  telegram_('sendMessage', { chat_id: chatId,
    text: '✅ Fuel Refill App ភ្ជាប់រួចរាល់។ ការចាក់សាំងថ្មីនឹងបង្ហាញនៅទីនេះ។\nFuel Refill App is connected. New refills will be posted here.' });
  Logger.log('Connected to "' + found.groups[chatId] + '" (' + chatId + ') as @' + found.bot.username);
}

/**
 * Run once from the editor to send unusual-refill alerts and the monthly recap to a second group
 * (Kim, 10 Oct 2026): add the same bot to that group, send /start@<bot> there, then run this.
 * It picks the most recently active group that is not the new-refill group.
 */
function telegramConnectAlerts() {
  const found = telegramGroups_();
  const main = getSetting_('TELEGRAM_CHAT_ID');
  const ids = found.ids.filter(id => id !== main);
  if (!ids.length) {
    throw new Error('Only the new-refill group was found. Add @' + found.bot.username + ' to the alerts group, send /start@' +
      found.bot.username + ' in that group, then run telegramConnectAlerts again.');
  }
  const chatId = ids[ids.length - 1];
  setSetting_('TELEGRAM_ALERT_CHAT_ID', chatId);
  telegram_('sendMessage', { chat_id: chatId,
    text: '✅ ក្រុមនេះនឹងទទួលការជូនដំណឹងចាក់ខុសធម្មតា និងសង្ខេបប្រចាំខែ។\nThis group will get unusual refill alerts and the monthly recap.' });
  Logger.log('Alerts and recap go to "' + found.groups[chatId] + '" (' + chatId + ')');
}

/** Groups the bot has seen recently, oldest first by last activity. */
function telegramGroups_() {
  if (!telegramToken_()) throw new Error('Add TELEGRAM_BOT_TOKEN in Project Settings → Script Properties first.');
  const bot = telegram_('getMe', {});
  let updates;
  try {
    updates = telegram_('getUpdates', { limit: '100' });
  } catch (e) {
    if (/webhook/i.test(e.message)) throw new Error('This bot has a webhook set by another tool. Remove it first, then run this again.');
    throw e;
  }
  const groups = {};
  updates.forEach(u => {
    const m = u.message || u.my_chat_member || u.channel_post || u.edited_message;
    const chat = m && m.chat;
    if (!chat || (chat.type !== 'group' && chat.type !== 'supergroup')) return;
    delete groups[chat.id];                       // keep the most recently active group last
    groups[chat.id] = chat.title || String(chat.id);
  });
  const ids = Object.keys(groups);
  if (!ids.length) {
    throw new Error('No group found. Add @' + bot.username + ' to the group, send /start@' + bot.username +
      ' in the group, then run this again.');
  }
  if (ids.length > 1) Logger.log('Groups seen: ' + ids.map(id => groups[id] + ' (' + id + ')').join(', '));
  return { bot: bot, groups: groups, ids: ids };
}

/** Optional: posts the newest entry to the group so you can see what a notification looks like. */
function telegramSendLatest() {
  const latest = allRefills_().sort((a, b) => (b.dateTime || 0) - (a.dateTime || 0))[0];
  if (!latest) throw new Error('No entries yet.');
  postRefillToTelegram_(latest);
}

// ---------- Validation ----------

function validate_(p, editingId, entryTime) {
  const type = readTypes_().find(t => t.name === String(p.type || ''));
  if (!type) throw new Error('Choose what the fuel is for.');
  const meter = type.meter;
  const lists = driverTruck_();

  // Trucks pick a plate from the CODE column; every other type is free text.
  const plate = String(p.plate || '').trim();
  if (!plate) throw new Error(meter === 'km' ? 'Plate number is required.' : 'Equipment / purpose is required.');
  if (meter === 'km' && lists.plates.indexOf(plate) < 0) {
    throw new Error('Plate "' + plate + '" is not in the CODE column of the Driver & Truck sheet.');
  }
  const equipList = equipmentByType_()[type.name];
  if (meter !== 'km' && equipList && equipList.indexOf(plate) < 0) {
    throw new Error('Equipment "' + plate + '" is not in the Equipment sheet.');
  }

  const driver = String(p.driver || '').trim();
  if (!driver) throw new Error('Driver name is required.');
  if (!lists.drivers.some(d => d.name === driver)) {
    throw new Error('Driver "' + driver + '" is not in the Driver & Truck sheet.');
  }

  const litres = toNumber_(p.litres);
  if (!(litres > 0)) throw new Error('Litres must be more than 0.');

  // "Meter broken" ticked in the app: no km and no odometer photo; the note says so for the reviewer.
  const broken = meter === 'km' && !!p.meterBroken;
  const brokenText = 'កុងទ័រខូច / Odometer broken';
  let note = String(p.note || '').trim();
  if (broken && note.indexOf(brokenText) !== 0) note = brokenText + (note ? ' · ' + note : '');
  const limit = Number(getSetting_('LITRE_LIMIT')) || 250;
  if (litres > limit && !note) throw new Error('More than ' + limit + ' L: please add a note.');

  let km = null, hour = null;
  const last = lastReadings_(editingId, entryTime)[plate] || {};
  if (meter === 'km') {
    km = broken ? null : toNumber_(p.km);
    if (isNaN(km)) km = null;
    if (type.required && !broken && !(km > 0)) throw new Error('Odometer (km) is required, or tick Meter broken.');
    if (type.required && !broken && !editingId && !p.odoPhoto) throw new Error('Odometer photo is required.');
    // 0, 1, 100… typed because the meter can't be read: ask for the tick box instead. New trucks (last reading under 1,000) are fine.
    if (km > 0 && km < MIN_KM && !(last.km && last.km < MIN_KM)) throw new Error('Km ' + km + ' looks wrong (under ' + MIN_KM + '). If the odometer is broken, tick Meter broken.');
    if (km && last.km && km <= last.km && !note) throw new Error('Km is not higher than the last reading (' + last.km + '): please add a note.');
  }
  if (meter === 'hour') {
    hour = toNumber_(p.hour);
    if (isNaN(hour)) hour = null;
    if (type.required && !(hour > 0)) throw new Error('Hour meter reading is required.');
    if (type.required && !editingId && !p.hourPhoto) throw new Error('Hour meter photo is required.');
    if (hour && last.hour && hour <= last.hour && !note) throw new Error('Hour meter is not higher than the last reading (' + last.hour + '): please add a note.');
  }

  if (!editingId && !p.pumpPhoto) throw new Error('Fuel pump photo is required.');

  let latLong = '';
  if (!editingId) {
    const lat = Number(p.lat), lng = Number(p.lng);
    if (!isFinite(lat) || !isFinite(lng) || (lat === 0 && lng === 0)) throw new Error('GPS location is required. Turn on location and try again.');
    latLong = lat.toFixed(6) + ', ' + lng.toFixed(6);
  }

  return { type: type.name, meter: meter, meterRequired: type.required, plate: plate, driver: driver,
           km: km, hour: hour, litres: litres, note: note, latLong: latLong, meterBroken: broken };
}

// ---------- Data helpers ----------

/** Refill types. Meter: km | hour | none. Meter Required: Yes/No. Default Equipment: pre-filled text. */
function readTypes_() {
  return readTable_(SHEETS.TYPES)
    .filter(t => t['Type of Refill'])
    .map(t => {
      const meter = String(t['Meter'] || 'none').trim().toLowerCase();
      const req = t['Meter Required'];
      return {
        name: String(t['Type of Refill']).trim(),
        meter: meter,
        required: meter !== 'none' && (req === undefined || req === '' || isYes_(req)),
        defaultEquipment: String(t['Default Equipment'] || '').trim(),
      };
    });
}

/**
 * A driver or truck typed in the app that is not in the lists yet (newDriver / newPlate flags) is
 * added to the "Driver & Truck" sheet first. A new driver gets the next number, written like the
 * existing rows: ID_DL 39, ឈ្មោះ "មាស តារា", ឈ្មោះតៃកុង "39.មាស តារា". Runs inside the submit lock.
 */
function addNewNames_(p) {
  const wantDriver = p.newDriver && String(p.driver || '').trim();
  const wantPlate = p.newPlate && String(p.plate || '').trim();
  if (!wantDriver && !wantPlate) return;
  const type = readTypes_().find(t => t.name === String(p.type || ''));
  const lists = driverTruck_();
  const row = {};

  if (wantPlate && type && type.meter === 'km') {
    const plate = cleanPlate_(p.plate);
    if (!/^[A-Z0-9][A-Z0-9.\-]{1,19}$/.test(plate)) throw new Error('Plate "' + p.plate + '" does not look like a plate number.');
    const key = x => String(x).toUpperCase().replace(/[^A-Z0-9]/g, '');
    const same = lists.plates.find(x => key(x) === key(plate));
    p.plate = same || plate;
    if (!same) row[DT_PLATE] = plate;
  }

  if (wantDriver) {
    // Typed names may carry a number already ("39. មាស តារា"): keep only the name.
    const name = String(p.driver).replace(/^\s*[0-9០-៩]+\s*[.)\-]?\s*/, '').replace(/\s+/g, ' ').trim().slice(0, 60);
    if (!name) throw new Error('Driver name is required.');
    const plain = s => String(s).replace(/^\s*[0-9០-៩]+\s*[.)\-]?\s*/, '').replace(/\s+/g, ' ').trim();
    const same = lists.drivers.find(d => plain(d.name) === name);
    if (same) {
      p.driver = same.name;
    } else {
      const rows = readTable_(SHEETS.DRIVER_TRUCK);
      let max = 0, last = null;
      rows.forEach(r => {
        const m = String(r[DT_DRIVER] || '').match(/^\s*([0-9០-៩]+)\s*\./);
        const n = Math.max(toNumber_(r['ID_DL']) || 0, m ? toNumber_(m[1]) || 0 : 0);
        if (n >= max) { max = n; last = r; }
      });
      const no = max + 1;
      const label = (no < 10 ? '0' : '') + no + '.' + name;
      row['ID_DL'] = no;
      row['ឈ្មោះ'] = name;
      row[DT_DRIVER] = label;
      if (last && last['ក្រុមហ៊ុន']) row['ក្រុមហ៊ុន'] = last['ក្រុមហ៊ុន'];
      if (!row[DT_PLATE] && type && type.meter === 'km' && p.plate) row[DT_PLATE] = String(p.plate).trim();
      p.driver = label;
    }
  }

  if (!row[DT_PLATE] && !row[DT_DRIVER]) return;
  const sheet = SpreadsheetApp.getActive().getSheetByName(SHEETS.DRIVER_TRUCK);
  const header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(h => String(h).trim());
  const rowNum = sheet.getLastRow() + 1;
  if (rowNum > sheet.getMaxRows()) sheet.insertRowsAfter(sheet.getMaxRows(), 1);
  const at = {};
  header.forEach((h, i) => { at[h] = i; });
  keepText_(sheet, rowNum, at, [DT_PLATE, DT_DRIVER]);
  sheet.getRange(rowNum, 1, 1, header.length).setValues([header.map(h => row[h] === undefined ? '' : row[h])]);
  delete tableCache_[SHEETS.DRIVER_TRUCK];
}

/** "3f 8691" or "3F8691" → "3F-8691", the way plates are written in the CODE column. */
function cleanPlate_(v) {
  const s = String(v || '').toUpperCase().trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-');
  const m = s.match(/^(\d[A-Z]{1,2})-?(\d{4})$/);
  return m ? m[1] + '-' + m[2] : s;
}

/** Dropdown lists from the "Driver & Truck" sheet: unique plates (CODE) and drivers with their plate. */
function driverTruck_() {
  const rows = readTable_(SHEETS.DRIVER_TRUCK);
  const plates = [], drivers = [];
  rows.forEach(r => {
    const name = String(r[DT_DRIVER] || '').trim();
    const code = String(r[DT_PLATE] || '').trim();
    if (code && plates.indexOf(code) < 0) plates.push(code);
    if (name && !drivers.some(d => d.name === name)) drivers.push({ name: name, plate: code });
  });
  plates.sort();
  return { plates: plates, drivers: drivers, brokenPlates: brokenPlates_(rows) };
}

/** Plates whose "Odometer Broken?" cell says Yes (also accepts Y, True, ខូច). */
function brokenPlates_(rows) {
  const out = [];
  rows.forEach(r => {
    const key = Object.keys(r).find(k => DT_BROKEN.test(k));
    const v = key ? String(r[key] || '').trim().toLowerCase() : '';
    const code = String(r[DT_PLATE] || '').trim();
    if (code && /^(yes|y|true|ខូច|បាទ|ចាស)$/.test(v) && out.indexOf(code) < 0) out.push(code);
  });
  return out;
}

/** Equipment dropdowns per refill type from the "Equipment" sheet. Types without rows use free text. */
function equipmentByType_() {
  const out = {};
  readTable_(SHEETS.EQUIPMENT).forEach(r => {
    const name = String(r['Equipment'] || '').trim();
    const type = String(r['Type of Refill'] || '').trim();
    if (!name || !type || (r['Active'] !== undefined && r['Active'] !== '' && !isYes_(r['Active']))) return;
    (out[type] || (out[type] = [])).push(name);
  });
  return out;
}

// Plates like 3E-2588 look like numbers to Google Sheets (3 × 10^-2588, saved as 0), so these
// cells are set to Plain text before anything is written to them.
const TEXT_COLS = [COL.PLATE, COL.DRIVER, COL.NOTE];

function keepText_(sheet, rowNum, cols, names) {
  names.forEach(n => { if (cols[n] !== undefined) sheet.getRange(rowNum, cols[n] + 1).setNumberFormat('@'); });
}

function refillSheet_() {
  const sheet = SpreadsheetApp.getActive().getSheetByName(SHEETS.REFILL);
  if (!sheet) throw new Error('Sheet "' + SHEETS.REFILL + '" not found.');
  return sheet;
}

const headerCache_ = {};

function headerIndex_(sheet) {
  if (headerCache_[sheet.getName()]) return headerCache_[sheet.getName()];
  const header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const idx = {};
  header.forEach((h, i) => { if (h !== '') idx[String(h).trim()] = i; });
  [COL.HOUR, COL.HOUR_PHOTO, COL.UPDATED_AT].forEach(name => {
    if (idx[name] === undefined) {               // add missing app columns once
      const c = sheet.getLastColumn() + 1;
      sheet.getRange(1, c).setValue(name);
      idx[name] = c - 1;
    }
  });
  return (headerCache_[sheet.getName()] = idx);
}

// Each small sheet is read at most once per request; setSetting_ clears the Settings copy.
const tableCache_ = {};

function readTable_(name) {
  if (!tableCache_[name]) tableCache_[name] = readTableNow_(name);
  return tableCache_[name];
}

function readTableNow_(name) {
  const sheet = SpreadsheetApp.getActive().getSheetByName(name);
  if (!sheet || sheet.getLastRow() < 2) return [];
  const values = sheet.getDataRange().getValues();
  const header = values.shift().map(h => String(h).trim());
  return values.map(r => {
    const o = {};
    header.forEach((h, i) => { if (h) o[h] = r[i]; });
    return o;
  });
}

function allRefills_() {
  const sheet = refillSheet_();
  const cols = headerIndex_(sheet);
  const values = sheet.getDataRange().getValues();
  values.shift();
  const get = (r, name) => cols[name] === undefined ? '' : r[cols[name]];
  return values.filter(r => get(r, COL.ID_FR)).map(r => {
    const dt = get(r, COL.DATETIME);
    return {
      id: String(get(r, COL.ID_FR)),
      type: String(get(r, COL.TYPE)),
      plate: String(get(r, COL.PLATE)),
      driver: String(get(r, COL.DRIVER)),
      km: get(r, COL.KM) === '' ? null : Number(get(r, COL.KM)),
      hour: get(r, COL.HOUR) === '' ? null : Number(get(r, COL.HOUR)),
      litres: Number(get(r, COL.LITRES)) || 0,
      note: String(get(r, COL.NOTE)),
      latLong: String(get(r, COL.LATLONG)),
      user: String(get(r, COL.USER)).toLowerCase(),
      dateTime: dt instanceof Date ? dt.getTime() : null,
      status: String(get(r, COL.STATUS)),
      reviewedBy: String(get(r, COL.REVIEWED_BY)),
      reviewedAt: get(r, COL.REVIEWED_AT) instanceof Date ? get(r, COL.REVIEWED_AT).getTime() : null,
      updatedAt: get(r, COL.UPDATED_AT) instanceof Date ? get(r, COL.UPDATED_AT).getTime() : null,
      odoPhoto: String(get(r, COL.ODO_PHOTO)),
      hourPhoto: String(get(r, COL.HOUR_PHOTO)),
      pumpPhoto: String(get(r, COL.PUMP_PHOTO)),
      signature: String(get(r, COL.SIGNATURE)),
    };
  });
}

/**
 * Most recent km / hour reading per plate, ignoring rejected entries, placeholder readings (0 or 1),
 * the entry being edited and (optionally) entries at or after beforeTime.
 */
function lastReadings_(excludeId, beforeTime) {
  const out = {};
  allRefills_().forEach(r => {
    if (r.status === STATUS_BAD || r.id === excludeId || !r.plate || !r.dateTime) return;
    if (beforeTime && r.dateTime >= beforeTime) return;   // when correcting an old entry, compare with earlier ones only
    const o = out[r.plate] || (out[r.plate] = { km: 0, kmAt: 0, hour: 0, hourAt: 0 });
    if (r.km > 1 && r.dateTime > o.kmAt) { o.km = r.km; o.kmAt = r.dateTime; }
    if (r.hour > 1 && r.dateTime > o.hourAt) { o.hour = r.hour; o.hourAt = r.dateTime; }
  });
  return out;
}

function findRow_(sheet, cols, id) {
  const ids = sheet.getRange(2, cols[COL.ID_FR] + 1, Math.max(sheet.getLastRow() - 1, 1), 1).getValues();
  const i = ids.findIndex(r => String(r[0]) === String(id));
  if (i < 0) throw new Error('Entry ' + id + ' not found.');
  return i + 2;
}

function newId_(sheet, cols, now, wanted) {
  const ids = new Set(sheet.getRange(2, cols[COL.ID_FR] + 1, Math.max(sheet.getLastRow() - 1, 1), 1)
    .getValues().map(r => String(r[0])));
  // The phone stamps this ID on the photos (watermark), so it is kept when it is free.
  if (/^FR\d{6}-\d{6}$/.test(String(wanted || '')) && !ids.has(wanted)) return wanted;
  const base = 'FR' + Utilities.formatDate(now, Session.getScriptTimeZone(), 'yyMMdd-HHmmss');
  let id = base, n = 2;
  while (ids.has(id)) id = base + '-' + n++;
  return id;
}

function getSetting_(key) {
  const row = readTable_(SHEETS.SETTINGS).find(s => String(s['Key']).trim() === key);
  return row ? String(row['Value']).trim() : '';
}

function setSetting_(key, value) {
  delete tableCache_[SHEETS.SETTINGS];
  const sheet = SpreadsheetApp.getActive().getSheetByName(SHEETS.SETTINGS);
  const values = sheet.getDataRange().getValues();
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][0]).trim() === key) { sheet.getRange(i + 1, 2).setValue(value); return; }
  }
  sheet.appendRow([key, value]);
}

let photoFolderCache_ = null;

function photoFolder_() {
  if (photoFolderCache_) return photoFolderCache_;
  const id = getSetting_('PHOTO_FOLDER_ID');
  if (id) {
    try { return (photoFolderCache_ = DriveApp.getFolderById(id)); } catch (e) { /* recreate below */ }
  }
  const ssFile = DriveApp.getFileById(SpreadsheetApp.getActive().getId());
  const parents = ssFile.getParents();
  const parent = parents.hasNext() ? parents.next() : DriveApp.getRootFolder();
  const folder = parent.createFolder(PHOTO_FOLDER_NAME);
  setSetting_('PHOTO_FOLDER_ID', folder.getId());
  return (photoFolderCache_ = folder);
}

/** Saves a data URL image to the photo folder and returns its Drive link ('' when none). */
function savePhoto_(dataUrl, id, label) {
  if (!dataUrl) return '';
  const m = /^data:(image\/(jpeg|png));base64,(.+)$/.exec(dataUrl);
  if (!m) throw new Error('Invalid image for ' + label + '.');
  const ext = m[2] === 'png' ? 'png' : 'jpg';
  const stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'HHmmss');
  const blob = Utilities.newBlob(Utilities.base64Decode(m[3]), m[1], id + '.' + label + '.' + stamp + '.' + ext);
  const file = photoFolder_().createFile(blob);
  return 'https://drive.google.com/file/d/' + file.getId() + '/view';
}

function fileIdFromUrl_(url) {
  const m = /\/d\/([\w-]{20,})/.exec(String(url || ''));
  return m ? m[1] : null;
}

function toNumber_(v) {
  if (v === null || v === undefined || v === '') return NaN;
  const khmer = '០១២៣៤៥៦៧៨៩';
  const s = String(v).replace(/[០-៩]/g, d => String(khmer.indexOf(d))).replace(/,/g, '').trim();
  return Number(s);
}

function isYes_(v) {
  const s = String(v).trim().toLowerCase();
  return s === 'yes' || s === 'true' || s === 'y' || s === '1';
}

function isNo_(v) {
  const s = String(v).trim().toLowerCase();
  return s === 'no' || s === 'false' || s === 'n' || s === '0' || s === 'off';
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/** Run once from the editor to grant permissions and create the photo folder. */
function setup() {
  headerIndex_(refillSheet_());
  const folder = photoFolder_();
  Logger.log('Photo folder: ' + folder.getUrl());
  Logger.log('Client ID set: ' + (getSetting_('GOOGLE_CLIENT_ID') ? 'yes' : 'NO - fill it in the Settings sheet'));
}

// ==== BEGIN FuelEngine (generated from the dashboard's engine.ts + recap.ts by "npm run engine": do not edit by hand) ====
"use strict";var FuelEngine=(()=>{var U=Object.defineProperty;var le=Object.getOwnPropertyDescriptor;var oe=Object.getOwnPropertyNames;var ue=Object.prototype.hasOwnProperty;var ae=(t,r)=>{for(var n in r)U(t,n,{get:r[n],enumerable:!0})},ce=(t,r,n,i)=>{if(r&&typeof r=="object"||typeof r=="function")for(let l of oe(r))!ue.call(t,l)&&l!==n&&U(t,l,{get:()=>r[l],enumerable:!(i=le(r,l))||i.enumerable});return t};var me=t=>ce(U({},"__esModule",{value:!0}),t);var ye={};ae(ye,{cleanDrivers:()=>ie,monthStart:()=>Y,monthView:()=>q,monthlyRecap:()=>ve,savers:()=>se});var pe="\u178F\u17D2\u179A\u17B9\u1798\u178F\u17D2\u179A\u17BC\u179C",ge="\u1798\u17B7\u1793\u178F\u17D2\u179A\u17B9\u1798\u178F\u17D2\u179A\u17BC\u179C";var J={minReadingKm:1e3,placeholders:[0,1,100,123,150,200,1234,12345,123455,123456,111111,999999],maxJumpKm:2e3,maxJumpHour:500,minStretches:3,minKm:1e3,investigatePct:20,fuelPrice:0,currency:"$",fuelPrices:[],monthlyBudget:0,defaultType:"Truck",vehicleTypes:[{name:"Truck",target:null,inFleet:!0},{name:"Motorbike",target:null,inFleet:!1}],plateType:{"1HS-1800":"Motorbike","1IG-9159":"Motorbike","1JQ-2735":"Motorbike","1LU-5135":"Motorbike"}};function ee(t){let r={...J,...t||{}};return(!Array.isArray(r.vehicleTypes)||!r.vehicleTypes.length)&&(r.vehicleTypes=J.vehicleTypes),(!r.plateType||typeof r.plateType!="object")&&(r.plateType={}),Array.isArray(r.placeholders)||(r.placeholders=J.placeholders),Array.isArray(r.fuelPrices)||(r.fuelPrices=[]),r.fuelPrices=r.fuelPrices.filter(n=>n&&/^\d{4}-\d{2}-\d{2}$/.test(n.from)&&n.price>0).sort((n,i)=>n.from.localeCompare(i.from)),r}var z=t=>t.fuelPrice>0||t.fuelPrices.length>0;function de(t,r){if(!t.fuelPrices.length)return t.fuelPrice;let n=new Date(r),i=`${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,"0")}-${String(n.getDate()).padStart(2,"0")}`,l=t.fuelPrices[0].price;for(let c of t.fuelPrices)if(c.from<=i)l=c.price;else break;return l}var V="(mixed drivers)",E="(no plate)",te="\u17E0\u17E1\u17E2\u17E3\u17E4\u17E5\u17E6\u17E7\u17E8\u17E9";function G(t){if(t==null||t==="")return null;if(typeof t=="number")return isFinite(t)?t:null;let r=String(t).replace(/[០-៩]/g,i=>String(te.indexOf(i))).replace(/,/g,"").trim();if(!r)return null;let n=Number(r);return isFinite(n)?n:null}var R=t=>(t==null?"":String(t)).trim(),W=t=>{let r=R(t);return r.startsWith("d:")?`https://drive.google.com/file/d/${r.slice(2)}/view`:r},Q=t=>t.replace(/[០-៩]/g,r=>String(te.indexOf(r)));function fe(t,r){let n=r.find(l=>l.name===t),i=n?n.meter:"";return i==="km"?"km":i==="hour"?"hour":n?"none":/🚚|ឡាន/.test(t)?"km":"none"}function be(t){var i;let r=new Map,n=new Map;for(let l of t){let c=l.label||l.name,u=Q(c).match(/^0*(\d+)\s*\.\s*(.+)$/),d=(l.name||(u?u[2]:c)).trim();r.set(d,c),r.set(c,c);let b=(i=G(l.no))!=null?i:u?Number(u[1]):null;b!==null&&n.set(b,c)}return l=>{let c=Q(l).replace(/\s+/g," ").trim();if(!c)return{name:"(no driver)",known:!1};if(r.has(c))return{name:r.get(c),known:!0};let u=c.match(/^0*(\d+)\s*[.\-]?\s*(.*)$/);return u&&u[2]&&r.has(u[2].trim())?{name:r.get(u[2].trim()),known:!0}:u&&!u[2]&&n.has(Number(u[1]))?{name:n.get(Number(u[1])),known:!0}:{name:u&&u[2]?u[2].trim():c,known:!1}}}function re(t,r){let n=o=>t.columns.indexOf(o),i={id:n("id"),type:n("type"),plate:n("plate"),driver:n("driver"),km:n("km"),litres:n("litres"),t:n("dateTime"),status:n("status"),user:n("user"),hour:n("hour"),note:n("note"),odo:n("odoPhoto"),pump:n("pumpPhoto"),hourPhoto:n("hourPhoto")},l=(o,p)=>p<0?"":o[p],c=be(t.drivers||[]),u={},d=[],b=[],S=[],K=new Set((t.brokenPlates||[]).map(o=>String(o).trim().toUpperCase()).filter(Boolean)),N=0,F=0;for(let o of t.rows){let p=R(l(o,i.status));if(p!==pe){p===ge?F++:N++;continue}let m=R(l(o,i.type));m in u||(u[m]=fe(m,t.types||[]));let P=l(o,i.t),g=typeof P=="number"?P:P?Date.parse(String(P)):NaN;if(!isFinite(g))continue;let v=c(R(l(o,i.driver))),f=R(l(o,i.plate)).replace(/\s+/g," "),h={id:R(l(o,i.id)),type:m,meter:u[m],plate:f?/^[0-9A-Za-z-]+$/.test(f)?f.toUpperCase():f:E,driverRaw:R(l(o,i.driver)),driver:v.name,km:G(l(o,i.km)),hour:G(l(o,i.hour)),litres:G(l(o,i.litres))||0,t:g,status:p,user:R(l(o,i.user)),note:R(l(o,i.note)),odoPhoto:W(l(o,i.odo)),pumpPhoto:W(l(o,i.pump)),hourPhoto:W(l(o,i.hourPhoto)),dup:!1,role:""};d.push(h),!f&&h.meter!=="none"&&b.push({rec:h,kind:"noPlate",detail:"Plate is empty"}),!v.known&&h.driverRaw&&b.push({rec:h,kind:"unknownDriver",detail:h.driverRaw})}d.sort((o,p)=>o.t-p.t);let I=new Map;for(let o of d){if(o.meter==="none"||o.plate===E)continue;let p=I.get(o.plate);p||I.set(o.plate,p=[]),p.push(o)}let D=[],$=new Set(r.placeholders);for(let[o,p]of I){let m=p[0].meter==="hour"?"hour":"km",P=m==="km"?r.maxJumpKm:r.maxJumpHour,g=null,v=0,f=null,h=0,T=null;for(let a of p){let k=m==="km"?a.km:a.hour;if(T&&a.t-T.t<108e5&&a.litres===T.litres&&(m==="km"?a.km:a.hour)===(m==="km"?T.km:T.hour)&&k!==null){a.dup=!0,b.push({rec:a,kind:"duplicate",detail:`Same reading and litres as ${T.id}`});continue}if(T=a,m==="km"&&K.has(o)){a.role="invalid",S.push({rec:a,kind:"broken",detail:"Marked in Driver & Truck"});continue}let y=null,x="";if(k===null){if(m==="hour"){v+=a.litres,h+=a.litres,a.role="invalid";continue}if(/^\s*(កុងទ័រខូច|Odometer broken)/i.test(a.note)){a.role="invalid",v+=a.litres,h+=a.litres,S.push({rec:a,kind:"broken",detail:"Ticked in the app"});continue}y="missing"}else if(m==="km"&&($.has(k)||k<r.minReadingKm))y="placeholder",x=`Km ${k}`;else if(g){let w=m==="km"?g.km:g.hour;k<w?(y="lower",x=`${C(k)} after ${C(w)}`):k===w?(y="zero",x=`${C(k)} again`):k-w>P&&(y="jump",x=`+${C(k-w)} ${m} since ${C(w)}`)}if(y==="lower"||y==="jump"){let w=f?m==="km"?f.km:f.hour:null;f&&w!==null&&k>w&&k-w<=P?(g=f,g.role="start",v=h,f=null,y=null):(f=a,h=0)}if(y){a.role="invalid",m==="hour"&&y==="zero"||b.push({rec:a,kind:y,detail:x}),v+=a.litres,a!==f&&(h+=a.litres);continue}if(!g){g=a,a.role="start",v=0;continue}let _=m==="km"?g.km:g.hour;D.push({plate:o,meter:m,from:g,to:a,dist:k-_,litres:a.litres+v,carried:v,t:a.t,driver:g.driver===a.driver?a.driver:V}),a.role="stretch",g=a,v=0,f=null,h=0}}D.sort((o,p)=>o.t-p.t);let O=o=>[...new Set(o)].sort((p,m)=>p.localeCompare(m));return{records:d,stretches:D,issues:b,broken:S,brokenPlates:K,pendingCount:N,rejectedCount:F,typeMeter:u,plates:O(d.filter(o=>o.plate!==E).map(o=>o.plate)),drivers:O(d.map(o=>o.driver)),types:O(d.map(o=>o.type)),minT:d.length?d[0].t:0,maxT:d.length?d[d.length-1].t:0}}function C(t){return Math.round(t*10)/10+""}var H={from:null,to:null,type:"",plate:"",driver:"",vtype:""};function he(t,r){let n=r.plateType[t]||r.defaultType;return r.vehicleTypes.find(i=>i.name===n)||{name:n,target:null,inFleet:!0}}var j=(t,r)=>(r.from===null||t>=r.from)&&(r.to===null||t<=r.to);function ke(t){let r=new Date(t),n=(r.getDay()+6)%7;return r.setHours(0,0,0,0),r.setDate(r.getDate()-n),r.getTime()}function ne(t,r,n){let i=new Map,l=e=>{let s=i.get(e);return s||i.set(e,s=he(e,r)),s},c=e=>!e.dup&&j(e.t,n)&&(!n.type||e.type===n.type)&&(!n.plate||e.plate===n.plate)&&(!n.driver||e.driver===n.driver)&&(!n.vtype||e.meter==="km"&&l(e.plate).name===n.vtype),u=t.records.filter(c),d=t.stretches.filter(e=>j(e.t,n)&&(!n.type||e.to.type===n.type)&&(!n.plate||e.plate===n.plate)&&(!n.driver||e.driver===n.driver)&&(!n.vtype||l(e.plate).name===n.vtype)),b=e=>j(e.rec.t,n)&&(!n.type||e.rec.type===n.type)&&(!n.plate||e.rec.plate===n.plate)&&(!n.driver||e.rec.driver===n.driver),S=t.issues.filter(b),K=t.broken.filter(b),N=d.filter(e=>e.meter==="km"),F=N.filter(e=>l(e.plate).inFleet),I=A(F,e=>e.dist),D=A(F,e=>e.litres),$=I>0&&D>0?D/I*100:null,O=u.filter(e=>e.meter==="km"&&l(e.plate).inFleet&&!t.brokenPlates.has(e.plate)),o=A(O,e=>e.litres),p=new Map;for(let e of S)p.set(e.rec.plate,(p.get(e.rec.plate)||0)+1);let m=e=>{let s=l(e).target;return s&&s>0?{ref:s,isTarget:!0}:{ref:$,isTarget:!1}},P=new Map,g=(e,s,M)=>{let L=e.get(s);return L||e.set(s,L={key:s,refills:0,litres:0,stretches:0,dist:0,sLitres:0,l100:null,kmL:null,ref:null,refIsTarget:!1,gapPct:null,enough:!1,status:"nodata",saving:0,issues:0,meterBroken:!1,vtype:M,last:0}),L};for(let e of u){if(e.meter!=="km")continue;let s=g(P,e.plate,l(e.plate).name);s.refills++,s.litres+=e.litres,s.last=Math.max(s.last,e.t)}for(let e of N){let s=g(P,e.plate,l(e.plate).name);s.stretches++,s.dist+=e.dist,s.sLitres+=e.litres}for(let e of P.values()){e.issues=p.get(e.key)||0,e.meterBroken=t.brokenPlates.has(e.key);let s=m(e.key);Z(e,s.ref,s.isTarget,r)}let v=new Map,f=new Map;for(let e of u){let s=g(v,e.driver,"");s.refills++,s.litres+=e.litres,s.last=Math.max(s.last,e.t)}for(let e of F){if(e.driver===V)continue;let s=g(v,e.driver,"");s.stretches++,s.dist+=e.dist,s.sLitres+=e.litres;let M=m(e.plate),L=f.get(e.driver)||{w:0,d:0,target:!0};M.ref!==null&&(L.w+=M.ref*e.dist,L.d+=e.dist),L.target=L.target&&M.isTarget,f.set(e.driver,L)}for(let e of v.values()){let s=f.get(e.key);Z(e,s&&s.d>0?s.w/s.d:null,!!(s&&s.target),r)}let h=new Map;for(let e of u){if(e.meter==="km")continue;let s=g(h,e.plate===E?e.type:e.plate,e.type);s.refills++,s.litres+=e.litres,s.last=Math.max(s.last,e.t)}for(let e of d){if(e.meter!=="hour")continue;let s=g(h,e.plate,e.to.type);s.stretches++,s.dist+=e.dist,s.sLitres+=e.litres}for(let e of h.values())e.l100=e.dist>0&&e.sLitres>0?e.sLitres/e.dist:null;let T=new Map,a=e=>{let s=ke(e),M=T.get(s);return M||T.set(s,M={week:s,litres:0,dist:0,sLitres:0,l100:null,refills:0}),M};for(let e of u){let s=a(e.t);s.litres+=e.litres,s.refills++}for(let e of F){let s=a(e.t);s.dist+=e.dist,s.sLitres+=e.litres}let k=[...T.values()].sort((e,s)=>e.week-s.week);for(let e of k)e.l100=e.dist>0&&e.sLitres>0?e.sLitres/e.dist*100:null;let y=new Map;for(let e of u){let s=y.get(e.type)||{type:e.type,litres:0,refills:0};s.litres+=e.litres,s.refills++,y.set(e.type,s)}let x=[...P.values()],_=[...v.values()],w=x.filter(e=>l(e.key).inFleet),B=A(u,e=>e.litres),X=z(r)?A(u,e=>e.litres*de(r,e.t)):0;return{records:u,stretches:d,issues:S,broken:K,litres:B,refills:u.length,kmLitres:o,spent:X,avgPrice:B>0?X/B:0,dist:I,sLitres:D,fleetL100:$,fleetKmL:$?100/$:null,coverage:o>0?Math.min(1,D/o):null,trucks:x,drivers:_,weeks:k,byType:[...y.values()].sort((e,s)=>s.litres-e.litres),equipment:[...h.values()].sort((e,s)=>s.litres-e.litres),savingLitres:A(w,e=>e.saving),investigate:w.filter(e=>e.status==="investigate").length}}function Z(t,r,n,i){t.l100=t.dist>0&&t.sLitres>0?t.sLitres/t.dist*100:null,t.kmL=t.l100?100/t.l100:null,t.ref=r,t.refIsTarget=n,t.enough=t.stretches>=i.minStretches&&t.dist>=i.minKm,t.gapPct=t.l100!==null&&r?(t.l100/r-1)*100:null,t.l100===null||!t.enough?t.status="nodata":t.gapPct!==null&&t.gapPct>i.investigatePct?t.status="investigate":t.gapPct!==null&&t.gapPct>0?t.status="above":t.status="ok",t.saving=t.enough&&r&&t.l100!==null&&t.l100>r?t.sLitres-t.dist*r/100:0}function A(t,r){let n=0;for(let i of t)n+=r(i);return n}function se(t){return t.drivers.filter(r=>r.key!==V&&r.enough&&r.l100!==null&&r.gapPct!==null&&r.gapPct<=0).sort((r,n)=>r.gapPct-n.gapPct).map(r=>{var l;let n=new Map;for(let c of t.stretches)c.driver===r.key&&n.set(c.plate,(n.get(c.plate)||0)+1);let i=((l=[...n.entries()].sort((c,u)=>u[1]-c[1])[0])==null?void 0:l[0])||"";return{driver:r.key,l100:r.l100,gapPct:r.gapPct,dist:r.dist,plate:i}})}function ie(t){let r=new Set(t.issues.map(n=>n.rec.driver));return new Set(t.records.map(n=>n.driver).filter(n=>n&&!r.has(n))).size}var Y=(t,r)=>new Date(t,r,1).getTime(),q=(t,r,n,i,l)=>ne(t,r,{...n,from:Y(i,l),to:Y(i,l+1)-1});function ve(t,r,n){let i=ee(t.settings),l=re(t,i),c=q(l,i,H,r,n),u=q(l,i,H,r,n-1),d=b=>{var S;return((S=i.vehicleTypes.find(K=>K.name===b))==null?void 0:S.inFleet)!==!1};return{year:new Date(r,n,1).getFullYear(),month:new Date(r,n,1).getMonth(),refills:c.refills,litres:c.litres,spent:z(i)?c.spent:null,currency:i.currency,l100:c.fleetL100,prevL100:u.fleetL100,prevLitres:u.litres,budget:i.monthlyBudget,savers:se(c).slice(0,3),clean:ie(c),investigate:c.trucks.filter(b=>d(b.vtype)&&b.status==="investigate").map(b=>b.key),pending:l.pendingCount}}return me(ye);})();
// ==== END FuelEngine ====

// ---------- Startup ads and Gallery (Kim, 25 Oct 2026) ----------
// Admins upload an image or a short video with a big red line of text. Each time the Fuel app opens it shows
// the newest one that is switched on (5–10 seconds, Skip any time); every one stays in the Gallery for everyone.
// Rows live in the "Ads" tab and the files in a "Fuel App Ads" folder next to the photo folder.
// The Fuel Refill tab is never touched by this.

// ---------- Gallery Manager (Kim, 30 Oct 2026) ----------
// Ads used to be managed inside the Fuel app; now admins run them from the 🖼️ Gallery Manager (web/gallery/).
// Each ad picks the apps it shows in, who sees it (everyone, departments or roles), how often (every open, once a
// day, once a week) and its dates. Pause = no startup ad but still in the Gallery; Hide = gone for everyone.
// Nothing is deleted from the manager, so its views stay in the "Ad Log" tab.
const AD_HEAD = ['ID_AD', 'Type', 'File', 'File ID', 'Name', 'Red Text', 'Seconds', 'Start', 'End', 'Show', 'Thumb', 'Created At', 'Created By', 'Updated At', 'Views', 'Skips',
  'Apps', 'Audience', 'Frequency', 'Hidden', 'English Text'];
const AD_MAX_BYTES = 20 * 1024 * 1024;   // about 30 seconds of phone video at 720p
const AD_APPS = ['fuel', 'transport', 'overtime', 'inbound', 'incident', 'meeting', 'home'];
const AD_FREQ = ['open', 'day', 'week'];
const AD_LOG = 'Ad Log';
const AD_LOG_COLS = ['Time', 'ID_AD', 'App', 'Email', 'Skipped'];

function isAdmin_(user) { return user.role === 'admin'; }
/** What a Role means in this app: admin, reviewer (reviewer or supervisor) or user (every job role). */
function accessLevel_(role) {
  const r = String(role || '').trim().toLowerCase();
  return r === 'admin' ? 'admin' : r === 'reviewer' || r === 'supervisor' ? 'reviewer' : 'user';
}

/**
 * Run once from the editor (Kim, 30 Oct 2026), after the new Delivery.gs is deployed: copies each "Delivery Role"
 * into Role, then removes the Delivery Role column. Admins stay admin; a reviewer keeps reviewer (Delivery reads it as
 * Supervisor). Every change goes to the User Log. Nothing is removed if a row could not be copied.
 */
function mergeDeliveryRoles() {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const ctx = umSheet_();
    const dc = ctx.col(DELIVERY_ROLE_HEAD), rc = ctx.col('Role');
    if (dc < 0) return 'There is no Delivery Role column: nothing to do.';
    if (rc < 0) throw new Error('The Users tab has no Role column.');
    const out = [];
    ctx.values.forEach((row, i) => {
      const email = String(row[ctx.col('Email')] || '').trim().toLowerCase();
      const job = String(row[dc] || '').trim().toLowerCase();
      if (!email || !job) return;
      const now = String(row[rc] || 'user').trim().toLowerCase();
      let next = now;
      if (now === 'admin' || now === 'supervisor') next = now;
      else if (job === 'admin' || job === 'supervisor') next = job;
      else if (now === 'reviewer') next = 'reviewer';
      else if (UM_ROLES.indexOf(job) >= 0) next = job;
      else { out.push(email + ': unknown Delivery Role "' + row[dc] + '" left as ' + now); return; }
      if (next !== now) {
        ctx.sheet.getRange(i + 2, rc + 1).setValue(next);
        umLog_('mergeDeliveryRoles', email, String(row[ctx.col('Name')] || ''), ['Role: ' + now + ' → ' + next + ' (from Delivery Role ' + row[dc] + ')']);
      }
      out.push(email + ': Role ' + next + (next !== now ? ' (was ' + now + ')' : '') + ', Delivery Role was ' + row[dc]);
    });
    if (out.some(x => /unknown/.test(x))) out.push('Delivery Role column kept: fix the rows above, then run again.');
    else { ctx.sheet.deleteColumn(dc + 1); out.push('Delivery Role column removed.'); }
    const msg = out.join('\n');
    console.log(msg);
    return msg;
  } finally {
    lock.releaseLock();
  }
}

function adSheet_() {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(SHEETS.ADS);
  if (!sh) {
    sh = ss.insertSheet(SHEETS.ADS);
    sh.getRange(1, 1, 1, AD_HEAD.length).setValues([AD_HEAD]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

let adFolderCache_ = null;
function adFolder_() {
  if (adFolderCache_) return adFolderCache_;
  const id = getSetting_('AD_FOLDER_ID');
  if (id) {
    try { return (adFolderCache_ = DriveApp.getFolderById(id)); } catch (e) { /* recreate below */ }
  }
  const parents = photoFolder_().getParents();
  const folder = (parents.hasNext() ? parents.next() : DriveApp.getRootFolder()).createFolder('Fuel App Ads');
  setSetting_('AD_FOLDER_ID', folder.getId());
  return (adFolderCache_ = folder);
}

/** Changes whenever an ad is added, edited or deleted, so phones know to fetch the list again. */
function adsVersion_() { return PropertiesService.getScriptProperties().getProperty('ADS_VER') || '0'; }
function adsChanged_() { PropertiesService.getScriptProperties().setProperty('ADS_VER', String(Date.now())); }

/** Gallery Manager settings: which apps show startup ads, the users' Gallery tile, Skip, and ads per person per day. */
function adSettings_() {
  const out = { apps: {}, gallery: true, skip: true, maxPerDay: 5 };
  AD_APPS.forEach(k => { out.apps[k] = true; });
  try {
    const s = JSON.parse(PropertiesService.getScriptProperties().getProperty('ADS_SETTINGS') || '{}');
    AD_APPS.forEach(k => { if (s.apps && typeof s.apps[k] === 'boolean') out.apps[k] = s.apps[k]; });
    if (typeof s.gallery === 'boolean') out.gallery = s.gallery;
    if (typeof s.skip === 'boolean') out.skip = s.skip;
    if (s.maxPerDay !== undefined) out.maxPerDay = Math.max(0, Math.min(20, Math.round(Number(s.maxPerDay) || 0)));
  } catch (e) { /* defaults */ }
  return out;
}

function adRows_() {
  const sh = SpreadsheetApp.getActive().getSheetByName(SHEETS.ADS);
  if (!sh || sh.getLastRow() < 2) return [];
  const values = sh.getDataRange().getValues();
  const head = values.shift().map(h => String(h).trim());
  const at = name => head.indexOf(name);
  const ms = v => v instanceof Date ? v.getTime() : null;
  return values.map((r, i) => {
    const g = name => at(name) < 0 ? '' : r[at(name)];
    const end = g('End') instanceof Date ? new Date(g('End').getTime()) : null;
    if (end) end.setHours(23, 59, 59, 999);   // shown until the end of the last day
    // Ads made in the Fuel app before the Gallery Manager have no Apps: they stay Fuel ads.
    const apps = String(g('Apps')).split(/[,\s]+/).map(x => x.trim().toLowerCase()).filter(x => AD_APPS.indexOf(x) >= 0);
    const freq = String(g('Frequency')).trim().toLowerCase();
    return {
      row: i + 2, id: String(g('ID_AD')), type: String(g('Type')) === 'video' ? 'video' : 'image',
      fileId: String(g('File ID')), name: String(g('Name')), text: String(g('Red Text')), textEn: String(g('English Text')),
      seconds: Math.min(10, Math.max(5, Number(g('Seconds')) || 7)),
      start: ms(g('Start')), end: end ? end.getTime() : null, show: String(g('Show')).trim().toLowerCase() === 'yes',
      hidden: isYes_(g('Hidden')), apps: apps.length ? apps : ['fuel'],
      audience: String(g('Audience')).trim() || 'all', freq: AD_FREQ.indexOf(freq) >= 0 ? freq : 'open',
      thumb: String(g('Thumb')), createdAt: ms(g('Created At')), createdBy: String(g('Created By')),
      updatedAt: ms(g('Updated At')), views: Number(g('Views')) || 0, skips: Number(g('Skips')) || 0,
    };
  }).filter(a => a.id);
}

/** "all", "dept:Transport|Warehouse" or "role:driver|security": true when this person is in it. */
function adForUser_(a, user) {
  const m = /^(dept|role):(.*)$/.exec(a.audience);
  if (!m) return true;
  const list = m[2].split('|').map(x => x.trim().toLowerCase()).filter(String);
  if (m[1] === 'dept') return list.indexOf(String(user.dept || '').trim().toLowerCase()) >= 0;
  return list.indexOf(user.job) >= 0 || list.indexOf(user.role) >= 0;
}

/**
 * The ads this person may see, newest first, with the settings. Admins get every ad (hidden ones too) with its
 * numbers. When the phone already has this version (p.have) only "same" comes back, so a check costs almost nothing.
 */
function listAds_(p, user) {
  const admin = isAdmin_(user);
  const version = adsVersion_();
  if (p.have && String(p.have) === version) return { version: version, same: true };
  return {
    version: version,
    settings: adSettings_(),
    ads: adRows_().filter(a => admin || (!a.hidden && adForUser_(a, user)))
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).map(a => {
        const o = { id: a.id, type: a.type, key: a.fileId, text: a.text, textEn: a.textEn, seconds: a.seconds, start: a.start, end: a.end,
          show: a.show, thumb: a.thumb, createdAt: a.createdAt, apps: a.apps, freq: a.freq };
        if (admin) Object.assign(o, { name: a.name, createdBy: a.createdBy, updatedAt: a.updatedAt, views: a.views, skips: a.skips,
          hidden: a.hidden, audience: a.audience });
        return o;
      }),
  };
}

/** The image or video itself, as a data URL. Phones keep it, so each file is downloaded once. */
function adMedia_(p, user) {
  const ad = adRows_().find(a => a.id === String(p.id || ''));
  if (!ad || !ad.fileId || (!isAdmin_(user) && (ad.hidden || !adForUser_(ad, user)))) return { dataUrl: null };
  const file = DriveApp.getFileById(ad.fileId);
  if (!inFolder_(file, adFolder_().getId())) return { dataUrl: null };
  const blob = file.getBlob();
  return { key: ad.fileId, dataUrl: 'data:' + blob.getContentType() + ';base64,' + Utilities.base64Encode(blob.getBytes()) };
}

function adHeadCols_(sh) {
  const head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(h => String(h).trim());
  AD_HEAD.forEach(h => { if (head.indexOf(h) < 0) { head.push(h); sh.getRange(1, head.length).setValue(h).setFontWeight('bold'); } });
  return name => head.indexOf(name) + 1;
}

/** Cleans the apps and audience an admin chose. */
function adAppsText_(list) {
  const apps = (Array.isArray(list) ? list : String(list || '').split(',')).map(x => String(x).trim().toLowerCase()).filter(x => AD_APPS.indexOf(x) >= 0);
  return apps.filter((x, i) => apps.indexOf(x) === i).join(',');
}
function adAudienceText_(v) {
  const m = /^(dept|role):(.*)$/.exec(String(v || '').trim());
  if (!m) return 'all';
  const list = m[2].split('|').map(x => x.trim()).filter(String).slice(0, 50);
  return list.length ? m[1] + ':' + list.join('|') : 'all';
}

/** Admin: adds a new ad or changes one. The file is only sent when it is new or replaced. */
function saveAd_(p, user) {
  if (!isAdmin_(user)) throw new Error('Only admins can post ads.');
  const sh = adSheet_();
  const col = adHeadCols_(sh);
  const now = new Date();
  const text = String(p.text || '').trim().slice(0, 200);
  const seconds = Math.min(10, Math.max(5, Math.round(Number(p.seconds) || 7)));
  const day = s => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || '')); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : ''; };
  const thumb = /^data:image\/jpeg;base64,/.test(String(p.thumb || '')) && String(p.thumb).length < 45000 ? String(p.thumb) : '';

  let file = null, type = '';
  if (p.media) {
    const m = /^data:((image|video)\/[\w.+-]+);base64,(.+)$/.exec(String(p.media));
    if (!m) throw new Error('Please choose an image or a video.');
    const bytes = Utilities.base64Decode(m[3]);
    if (bytes.length > AD_MAX_BYTES) throw new Error('The file is too big (over 20 MB). Please use a shorter video.');
    type = m[2];
    const ext = (m[1].split('/')[1] || 'bin').replace('quicktime', 'mov').replace('jpeg', 'jpg');
    const name = 'AD_' + Utilities.formatDate(now, Session.getScriptTimeZone(), 'yyMMdd-HHmmss') + '.' + ext;
    file = adFolder_().createFile(Utilities.newBlob(bytes, m[1], name));
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    let rowNum, oldFileId = '';
    if (p.id) {
      const ad = adRows_().find(a => a.id === String(p.id));
      if (!ad) throw new Error('This ad was deleted.');
      rowNum = ad.row; oldFileId = ad.fileId;
    } else {
      if (!file) throw new Error('Please choose an image or a video.');
      rowNum = sh.getLastRow() + 1;
      sh.getRange(rowNum, col('ID_AD')).setValue('AD' + Utilities.formatDate(now, Session.getScriptTimeZone(), 'yyMMdd-HHmmss'));
      sh.getRange(rowNum, col('Created At')).setValue(now);
      sh.getRange(rowNum, col('Created By')).setValue(user.email);
      sh.getRange(rowNum, col('Views')).setValue(0);
      sh.getRange(rowNum, col('Skips')).setValue(0);
    }
    if (file) {
      sh.getRange(rowNum, col('Type')).setValue(type);
      sh.getRange(rowNum, col('File')).setValue(file.getUrl());
      sh.getRange(rowNum, col('File ID')).setValue(file.getId());
      sh.getRange(rowNum, col('Name')).setNumberFormat('@').setValue(String(p.name || file.getName()).slice(0, 120));
    }
    if (thumb || file) sh.getRange(rowNum, col('Thumb')).setValue(thumb);
    sh.getRange(rowNum, col('Red Text')).setNumberFormat('@').setValue(text);
    sh.getRange(rowNum, col('Seconds')).setValue(seconds);
    sh.getRange(rowNum, col('Start')).setValue(day(p.start)).setNumberFormat('dd-MMM-yyyy');
    sh.getRange(rowNum, col('End')).setValue(day(p.end)).setNumberFormat('dd-MMM-yyyy');
    sh.getRange(rowNum, col('Show')).setValue(p.show === false ? 'No' : 'Yes');
    // Sent by the Gallery Manager only, so an old Fuel app saving an ad leaves these as they are.
    if (p.apps !== undefined) sh.getRange(rowNum, col('Apps')).setNumberFormat('@').setValue(adAppsText_(p.apps) || 'fuel');
    if (p.audience !== undefined) sh.getRange(rowNum, col('Audience')).setNumberFormat('@').setValue(adAudienceText_(p.audience));
    if (p.freq !== undefined) sh.getRange(rowNum, col('Frequency')).setValue(AD_FREQ.indexOf(p.freq) >= 0 ? p.freq : 'open');
    if (p.hidden !== undefined) sh.getRange(rowNum, col('Hidden')).setValue(p.hidden ? 'Yes' : 'No');
    if (p.textEn !== undefined) sh.getRange(rowNum, col('English Text')).setNumberFormat('@').setValue(String(p.textEn || '').trim().slice(0, 200));
    sh.getRange(rowNum, col('Updated At')).setValue(now);
    // A replaced file goes to the Drive bin (kept there 30 days).
    if (file && oldFileId) { try { DriveApp.getFileById(oldFileId).setTrashed(true); } catch (e) { /* already gone */ } }
    adsChanged_();
    return { id: String(sh.getRange(rowNum, col('ID_AD')).getValue()) };
  } finally {
    lock.releaseLock();
  }
}

/** Admin: Pause / play or Hide / unhide one or more ads in one go, without sending the whole ad again. */
function adQuick_(p, user) {
  needAdmin_(user);
  const ids = (Array.isArray(p.ids) ? p.ids : [p.id]).map(String);
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = adSheet_();
    const col = adHeadCols_(sh);
    const now = new Date();
    adRows_().filter(a => ids.indexOf(a.id) >= 0).forEach(a => {
      if (p.show !== undefined) sh.getRange(a.row, col('Show')).setValue(p.show ? 'Yes' : 'No');
      if (p.hidden !== undefined) sh.getRange(a.row, col('Hidden')).setValue(p.hidden ? 'Yes' : 'No');
      sh.getRange(a.row, col('Updated At')).setValue(now);
    });
    adsChanged_();
    return listAds_({}, user);
  } finally {
    lock.releaseLock();
  }
}

/** Admin: the Gallery Manager screen: every ad, the settings, departments and roles for the "who sees it" lists. */
function adManager_(p, user) {
  needAdmin_(user);
  return Object.assign(listAds_({}, user), { depts: departments_(), roles: UM_ROLES });
}

/** Admin: saves the Settings screen. */
function adSettingsSave_(p, user) {
  needAdmin_(user);
  const s = adSettings_();
  AD_APPS.forEach(k => { if (p.apps && typeof p.apps[k] === 'boolean') s.apps[k] = p.apps[k]; });
  if (typeof p.gallery === 'boolean') s.gallery = p.gallery;
  if (typeof p.skip === 'boolean') s.skip = p.skip;
  if (p.maxPerDay !== undefined) s.maxPerDay = Math.max(0, Math.min(20, Math.round(Number(p.maxPerDay) || 0)));
  PropertiesService.getScriptProperties().setProperty('ADS_SETTINGS', JSON.stringify(s));
  adsChanged_();
  return s;
}

/** Admin: deletes an ad. Its file goes to the Drive bin (kept there 30 days). */
function deleteAd_(p, user) {
  if (!isAdmin_(user)) throw new Error('Only admins can delete ads.');
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const ad = adRows_().find(a => a.id === String(p.id || ''));
    if (!ad) return { id: p.id };
    adSheet_().deleteRow(ad.row);
    if (ad.fileId) { try { DriveApp.getFileById(ad.fileId).setTrashed(true); } catch (e) { /* already gone */ } }
    adsChanged_();
    return { id: ad.id };
  } finally {
    lock.releaseLock();
  }
}

function adLogSheet_() {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(AD_LOG);
  if (!sh) {
    sh = ss.insertSheet(AD_LOG);
    sh.getRange(1, 1, 1, AD_LOG_COLS.length).setValues([AD_LOG_COLS]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

/**
 * Counts a view, and a skip when the person tapped Skip: one line in the "Ad Log" tab (for the Stats screen)
 * and the totals on the ad. Never holds anyone up: a busy sheet just misses one count.
 */
function adSeen_(p, user) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(3000)) return { counted: false };
  try {
    const ad = adRows_().find(a => a.id === String(p.id || ''));
    if (!ad) return { counted: false };
    const app = AD_APPS.indexOf(String(p.app || '')) >= 0 ? String(p.app) : 'fuel';
    adLogSheet_().appendRow([new Date(), ad.id, app, user.email, p.skipped ? 'Yes' : 'No']);
    const sh = adSheet_();
    const head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(h => String(h).trim());
    sh.getRange(ad.row, head.indexOf('Views') + 1).setValue(ad.views + 1);
    if (p.skipped) sh.getRange(ad.row, head.indexOf('Skips') + 1).setValue(ad.skips + 1);
    return { counted: true };
  } finally {
    lock.releaseLock();
  }
}

/** Admin: views of the last p.days days (30 by default) from the "Ad Log": by day, by ad and by app. */
function adStats_(p, user) {
  needAdmin_(user);
  const days = Math.max(1, Math.min(365, Math.round(Number(p.days) || 30)));
  const since = new Date(); since.setHours(0, 0, 0, 0); since.setDate(since.getDate() - days + 1);
  const sh = SpreadsheetApp.getActive().getSheetByName(AD_LOG);
  const out = { days: days, from: since.getTime(), views: 0, skips: 0, people: 0, byDay: {}, byAd: {}, byApp: {} };
  if (!sh || sh.getLastRow() < 2) return out;
  // The newest rows are at the bottom: read at most the last 50,000.
  const n = Math.min(sh.getLastRow() - 1, 50000);
  const rows = sh.getRange(sh.getLastRow() - n + 1, 1, n, AD_LOG_COLS.length).getValues();
  const tz = Session.getScriptTimeZone(), people = {};
  rows.forEach(r => {
    const t = r[0] instanceof Date ? r[0] : null;
    if (!t || t < since) return;
    const day = Utilities.formatDate(t, tz, 'yyyy-MM-dd'), id = String(r[1]), app = String(r[2]), skip = isYes_(r[4]);
    out.views++; if (skip) out.skips++;
    people[String(r[3]).toLowerCase()] = 1;
    out.byDay[day] = (out.byDay[day] || 0) + 1;
    const a = out.byAd[id] || (out.byAd[id] = { views: 0, skips: 0, people: {} });
    a.views++; if (skip) a.skips++; a.people[String(r[3]).toLowerCase()] = 1;
    out.byApp[app] = (out.byApp[app] || 0) + 1;
  });
  out.people = Object.keys(people).length;
  Object.keys(out.byAd).forEach(id => { out.byAd[id].people = Object.keys(out.byAd[id].people).length; });
  return out;
}

// ---------- User Management (Kim, 28 Oct 2026) ----------
// One screen for admins (web/users/, the 👥 tile) to manage everyone for every iSteel app. It edits the same
// Users tab every app already reads, so the apps need no change. Admins only. Nobody is deleted: switching a
// person off keeps their history (Off At / Off Note). Every change is written to the "User Log" tab.
// A person who sent "Request to Admin" is a row with Active = No and no Off At: that is the Requests list.

const UM_LOG = 'User Log';
const UM_LOG_COLS = ['Time', 'By', 'Email', 'Name', 'Change'];
/**
 * One Role column for every app (Kim, 30 Oct 2026): the old "Delivery Role" column is merged into Role.
 * admin = everything; supervisor and reviewer check entries in the other apps; the job roles
 * (logistics, warehouse, security, driver) say which Delivery steps a person records and are plain users elsewhere.
 */
const UM_ROLES = ['user', 'driver', 'security', 'warehouse', 'logistics', 'reviewer', 'supervisor', 'admin'];
const DELIVERY_ROLE_HEAD = 'Delivery Role';   // old column, only read by mergeDeliveryRoles()
// The OT app's own sheet (SSK_OT_DATA): line managers live in its "Employee & Approver" tab.
const OT_SHEET_DEFAULT = '1K3rRyfY6jw-NmUAlKF4W8P246BjxfD78SVul72qkk44';
const OT_EMP_TAB = 'Employee & Approver';

function needAdmin_(user) {
  if (!isAdmin_(user)) throw new Error('NOACCESS: Admins only. / សម្រាប់តែ Admin ប៉ុណ្ណោះ។');
}

/** The Users tab with its header; any of the named columns that are missing are added at the end. */
function umSheet_(need) {
  const sheet = SpreadsheetApp.getActive().getSheetByName(SHEETS.USERS);
  let header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(h => String(h).trim());
  (need || []).filter(h => header.indexOf(h) < 0).forEach(h => {
    sheet.getRange(1, header.length + 1).setValue(h).setFontWeight('bold');
    header.push(h);
  });
  const values = sheet.getLastRow() < 2 ? [] : sheet.getRange(2, 1, sheet.getLastRow() - 1, header.length).getValues();
  return { sheet, header, values, col: h => header.indexOf(h) };
}

function umUser_(ctx, r) {
  const g = h => (ctx.col(h) >= 0 ? r[ctx.col(h)] : '');
  const apps = {};
  HOME_APPS.forEach(a => { if (ctx.col(a.col) >= 0) apps[a.key] = g(a.col) === true || isYes_(g(a.col)); });
  const off = g('Off At');
  const role = String(g('Role') || 'user').trim().toLowerCase();
  return {
    email: String(g('Email') || '').trim().toLowerCase(),
    name: String(g('Name') || '').trim(),
    role: UM_ROLES.indexOf(role) >= 0 ? role : 'user',
    active: g('Active') === true || isYes_(g('Active')),
    empId: String(g('Employee ID') || '').trim(),
    dept: String(g('Department') || '').trim(),
    apps: apps,
    offAt: off instanceof Date ? off.getTime() : (off ? new Date(off).getTime() || 0 : 0),
    offNote: String(g('Off Note') || '').trim(),
  };
}

/** Everything the screen needs in one call. */
function umList_(p, user) {
  needAdmin_(user);
  const ctx = umSheet_();
  return {
    me: user.email,
    users: ctx.values.map(r => umUser_(ctx, r)).filter(u => u.email),
    apps: HOME_APPS.map(a => ({ key: a.key, col: a.col })),
    depts: deptTable_(),
    log: umLogRead_(60),
  };
}

/** Count for the red badge on the 👥 tile: people waiting for an answer. */
function umWaiting_() {
  return readTable_(SHEETS.USERS).filter(u => String(u['Email'] || '').trim() && !(u['Active'] === true || isYes_(u['Active'])) && !u['Off At']).length;
}

function umCheck_(p, isNew) {
  const out = {};
  if (isNew) {
    const email = String(p.email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Enter a valid email. / សូមបញ្ចូលអ៊ីមែលឲ្យត្រឹមត្រូវ។');
    out.email = email;
  }
  if (p.name !== undefined) {
    out.name = String(p.name || '').replace(/\s+/g, ' ').trim().slice(0, 100);
    if (!out.name) throw new Error('Full name is required. / សូមបញ្ចូលឈ្មោះពេញ។');
  }
  if (p.empId !== undefined) {
    out.empId = String(p.empId || '').replace(/[០-៩]/g, d => String('០១២៣៤៥៦៧៨៩'.indexOf(d))).replace(/\s+/g, '');
    if (out.empId && (!/^\d+$/.test(out.empId) || +out.empId < EMP_ID_MIN || +out.empId > EMP_ID_MAX)) {
      throw new Error('Employee ID must be a number from ' + EMP_ID_MIN + ' to ' + EMP_ID_MAX + '. / លេខសម្គាល់បុគ្គលិក ត្រូវជាលេខពី ' + EMP_ID_MIN + ' ដល់ ' + EMP_ID_MAX + '។');
    }
  }
  if (p.dept !== undefined) out.dept = String(p.dept || '').trim().slice(0, 100);
  if (p.role !== undefined) {
    out.role = String(p.role || '').toLowerCase();
    if (UM_ROLES.indexOf(out.role) < 0) throw new Error('Unknown role.');
  }
  if (p.active !== undefined) out.active = !!p.active;
  if (p.offNote !== undefined) out.offNote = String(p.offNote || '').trim().slice(0, 200);
  if (p.apps) {
    out.apps = {};
    HOME_APPS.forEach(a => { if (p.apps[a.key] !== undefined) out.apps[a.key] = !!p.apps[a.key]; });
  }
  return out;
}

/** Writes one person's changes into the open Users tab; returns the log lines. Only cells that change are written. */
function umWrite_(ctx, email, v, by, isNew) {
  let i = ctx.values.findIndex(r => String(r[ctx.col('Email')] || '').trim().toLowerCase() === email);
  if (isNew && i >= 0) throw new Error(email + ' is already in the list. / មានក្នុងបញ្ជីរួចហើយ។');
  if (!isNew && i < 0) throw new Error(email + ' is not in the Users tab.');
  // Never lock yourself out.
  if (email === by && ((v.role && v.role !== 'admin') || v.active === false)) {
    throw new Error('You cannot remove your own admin access. / អ្នកមិនអាចដកសិទ្ធិ Admin របស់ខ្លួនឯងបានទេ។');
  }
  const log = [];
  const sample = ctx.values.length ? ctx.values[0][ctx.col('Active')] : '';
  const yesNo = (cur, on) => (typeof cur === 'boolean' || (isNew && typeof sample === 'boolean') ? on : (on ? 'Yes' : 'No'));
  if (i < 0) {
    const row = ctx.header.map(() => '');
    row[ctx.col('Email')] = email;
    ctx.sheet.appendRow(row);
    ctx.values.push(row);
    i = ctx.values.length - 1;
    log.push('Added');
  }
  const r = i + 2, cur = ctx.values[i];
  const before = umUser_(ctx, cur);
  const set = (h, val, fmtText) => {
    const c = ctx.col(h);
    const cell = ctx.sheet.getRange(r, c + 1);
    if (fmtText) cell.setNumberFormat('@');
    cell.setValue(val);
    cur[c] = val;
  };
  if (v.name !== undefined && v.name !== before.name) { set('Name', v.name); if (!isNew) log.push('Name: ' + before.name + ' → ' + v.name); }
  if (v.empId !== undefined && v.empId !== before.empId) { set('Employee ID', v.empId, true); log.push('Employee ID: ' + (before.empId || '–') + ' → ' + (v.empId || '–')); }
  if (v.dept !== undefined && v.dept !== before.dept) { set('Department', v.dept); log.push('Department: ' + (before.dept || '–') + ' → ' + (v.dept || '–')); }
  if (v.role !== undefined && (v.role !== before.role || isNew)) { set('Role', v.role); log.push('Role: ' + (isNew ? '' : before.role + ' → ') + v.role); }
  if (v.apps) HOME_APPS.forEach(a => {
    const on = v.apps[a.key];
    if (on === undefined || (!isNew && before.apps[a.key] === on) || ctx.col(a.col) < 0) return;
    const c = ctx.col(a.col);
    ctx.sheet.getRange(r, c + 1).insertCheckboxes().setValue(on);
    cur[c] = on;
    log.push(a.col + (on ? ' ✓' : ' ✗'));
  });
  // Rejecting a request: Active is already No, so the change is stamping Off At (it leaves the Requests list).
  if (v.active !== undefined && (v.active !== before.active || isNew || (!v.active && !before.offAt))) {
    set('Active', yesNo(cur[ctx.col('Active')], v.active));
    if (v.active) { set('Off At', ''); set('Off Note', ''); log.push(isNew ? 'Active' : before.offAt ? 'Switched on' : 'Approved'); }
    else if (!isNew) { set('Off At', new Date()); set('Off Note', v.offNote || ''); const what = before.offAt || before.active ? 'Switched off' : 'Request rejected'; log.push(what + (v.offNote && v.offNote !== what ? ' (' + v.offNote + ')' : '')); }
  } else if (v.offNote !== undefined && !before.active && v.offNote !== before.offNote) {
    set('Off Note', v.offNote);
  }
  return { user: umUser_(ctx, cur), log };
}

function umLog_(by, email, name, lines) {
  if (!lines.length) return [];
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(UM_LOG);
  if (!sh) {
    sh = ss.insertSheet(UM_LOG);
    sh.getRange(1, 1, 1, UM_LOG_COLS.length).setValues([UM_LOG_COLS]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  const now = new Date();
  const row = [now, by, email, name, lines.join('; ')];
  sh.appendRow(row);
  return [{ time: now.getTime(), by, email, name, change: row[4] }];
}

function umLogRead_(n) {
  const sh = SpreadsheetApp.getActive().getSheetByName(UM_LOG);
  if (!sh || sh.getLastRow() < 2) return [];
  const last = sh.getLastRow(), k = Math.min(n, last - 1);
  return sh.getRange(last - k + 1, 1, k, UM_LOG_COLS.length).getValues().reverse().map(r => ({
    time: r[0] instanceof Date ? r[0].getTime() : 0, by: String(r[1]), email: String(r[2]), name: String(r[3]), change: String(r[4]),
  }));
}

function umNeedCols_(v) {
  const need = ['Active', 'Off At', 'Off Note'];
  if (v.empId !== undefined) need.push('Employee ID');
  if (v.dept !== undefined) need.push('Department');
  return need;
}

/** Add or change one person. */
function umSave_(p, user) {
  needAdmin_(user);
  const isNew = !!p.isNew;
  const v = umCheck_(p, isNew);
  const email = isNew ? v.email : String(p.email || '').trim().toLowerCase();
  if (isNew) {
    if (v.name === undefined) throw new Error('Full name is required. / សូមបញ្ចូលឈ្មោះពេញ។');
    if (v.role === undefined) v.role = 'user';
    if (v.active === undefined) v.active = true;
  }
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  let out;
  try {
    const ctx = umSheet_(umNeedCols_(v));
    out = umWrite_(ctx, email, v, user.email, isNew);
    out.log = umLog_(user.name || user.email, email, out.user.name, out.log);
  } finally {
    lock.releaseLock();
    delete tableCache_[SHEETS.USERS];
  }
  return out;
}

/** The same change for many people at once (from the computer table). */
function umBulk_(p, user) {
  needAdmin_(user);
  const emails = (p.emails || []).map(e => String(e).trim().toLowerCase()).filter(Boolean).slice(0, 300);
  if (!emails.length) throw new Error('Nobody selected.');
  const v = umCheck_(p.patch || {}, false);
  const lock = LockService.getScriptLock();
  lock.waitLock(25000);
  const users = [], log = [];
  try {
    const ctx = umSheet_(umNeedCols_(v));
    emails.forEach(email => {
      if (email === user.email && ((v.role && v.role !== 'admin') || v.active === false)) return;   // never yourself
      const o = umWrite_(ctx, email, v, user.email, false);
      users.push(o.user);
      Array.prototype.push.apply(log, umLog_(user.name || user.email, email, o.user.name, o.log));
    });
  } finally {
    lock.releaseLock();
    delete tableCache_[SHEETS.USERS];
  }
  return { users, log };
}

/** A department's default apps (what a new request from that department gets), or a new department. */
function umDeptSave_(p, user) {
  needAdmin_(user);
  const name = String(p.name || '').trim().slice(0, 100);
  if (!name) throw new Error('Department name is required. / សូមបញ្ចូលឈ្មោះផ្នែក។');
  deptTable_();   // makes sure the sheet and its app columns exist
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  const lines = [];
  try {
    const sheet = SpreadsheetApp.getActive().getSheetByName(DEPT_SHEET);
    const header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(h => String(h).trim());
    const lower = header.map(h => h.toLowerCase());
    const nameCol = Math.max(0, lower.findIndex(h => h.indexOf('department') >= 0 || h.indexOf('ផ្នែក') >= 0));
    let activeCol = lower.indexOf('active');
    if (activeCol < 0 && p.active !== undefined) { activeCol = header.length; sheet.getRange(1, activeCol + 1).setValue('Active').setFontWeight('bold'); }
    const values = sheet.getLastRow() < 2 ? [] : sheet.getRange(2, 1, sheet.getLastRow() - 1, header.length).getValues();
    let i = values.findIndex(r => String(r[nameCol] || '').trim() === name);
    if (p.isNew && i >= 0) throw new Error(name + ' is already in the list. / មានក្នុងបញ្ជីរួចហើយ។');
    if (i < 0) {
      if (!p.isNew) throw new Error(name + ' is not in the Department tab.');
      const row = header.map(() => '');
      row[nameCol] = name;
      sheet.appendRow(row);
      i = values.length;
      values.push(row);
      lines.push('New department');
      // A new department starts with the usual apps unless the screen sent its own ticks.
      if (!p.apps) { p.apps = {}; HOME_APPS.forEach(a => { p.apps[a.key] = DEFAULT_APPS.indexOf(a.key) >= 0; }); }
      if (p.active === undefined) p.active = true;
    }
    const r = i + 2;
    if (p.active !== undefined && activeCol >= 0) {
      const was = !isNo_(values[i][activeCol]);
      if (was !== !!p.active || lines.length) { sheet.getRange(r, activeCol + 1).setValue(p.active ? 'Yes' : 'No'); lines.push(p.active ? 'Department on' : 'Department off'); }
    }
    if (p.apps) HOME_APPS.forEach(a => {
      const c = header.indexOf(a.col);
      if (c < 0 || p.apps[a.key] === undefined) return;
      const was = values[i][c] === true || isYes_(values[i][c]);
      if (was === !!p.apps[a.key] && !lines.length) return;
      sheet.getRange(r, c + 1).insertCheckboxes().setValue(!!p.apps[a.key]);
      lines.push(a.col + (p.apps[a.key] ? ' ✓' : ' ✗'));
    });
  } finally {
    lock.releaseLock();
    deptCache_ = null;
  }
  const log = umLog_(user.name || user.email, '', 'Department: ' + name, lines);
  return { depts: deptTable_(), log };
}

// ---- OT line manager (the OT app's own sheet) ----
function otEmpSheet_() {
  const id = getSetting_('OT_SHEET_ID') || OT_SHEET_DEFAULT;
  const sh = SpreadsheetApp.openById(id).getSheetByName(OT_EMP_TAB);
  if (!sh) throw new Error('"' + OT_EMP_TAB + '" tab not found in the OT sheet.');
  const values = sh.getDataRange().getValues();
  const keys = (values[0] || []).map(h => String(h).toLowerCase().replace(/[^a-z0-9]/g, ''));
  const col = test => keys.findIndex(test);
  const c = {
    id: col(k => k === 'idno' || k === 'employeeid' || k === 'id'),
    en: col(k => k === 'name' || k === 'englishname' || k === 'employeename'),
    mgr: col(k => k.indexOf('manager') >= 0 || k.indexOf('approver') >= 0),
    tg: col(k => k.indexOf('telegram') >= 0 && k.indexOf('chat') < 0),
  };
  if (c.id < 0 || c.mgr < 0) throw new Error('"' + OT_EMP_TAB + '" needs ID No. and Direct Manager (Approver) columns.');
  return { sh, values, c };
}
const otId_ = v => String(v == null ? '' : v).trim().replace(/\.0+$/, '');

/** Each employee's OT approver, and the approvers to choose from (a manager always goes with their own Telegram). */
function umOt_(p, user) {
  needAdmin_(user);
  try {
    const o = otEmpSheet_();
    const byId = {}, seen = {}, managers = [];
    for (let r = 1; r < o.values.length; r++) {
      const id = otId_(o.values[r][o.c.id]);
      const mgr = String(o.values[r][o.c.mgr] || '').trim();
      const tg = o.c.tg >= 0 ? String(o.values[r][o.c.tg] || '').trim() : '';
      if (id) byId[id] = { manager: mgr, tg: tg, name: o.c.en >= 0 ? String(o.values[r][o.c.en] || '').trim() : '' };
      if (mgr && !seen[mgr + '|' + tg]) { seen[mgr + '|' + tg] = 1; managers.push({ name: mgr, tg: tg }); }
    }
    managers.sort((a, b) => a.name.localeCompare(b.name));
    return { ok: true, byId, managers };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
}

function umOtSave_(p, user) {
  needAdmin_(user);
  const id = otId_(p.empId);
  if (!id) throw new Error('Employee ID is required.');
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  let before = '', name = '';
  try {
    const o = otEmpSheet_();
    // Only a manager already in the list, with the Telegram that goes with them, so requests still reach the right person.
    const pick = [];
    for (let r = 1; r < o.values.length; r++) {
      const m = String(o.values[r][o.c.mgr] || '').trim(), t = o.c.tg >= 0 ? String(o.values[r][o.c.tg] || '').trim() : '';
      if (m === String(p.manager || '').trim() && t === String(p.tg || '').trim()) { pick.push(m, t); break; }
    }
    if (!pick.length) throw new Error('Choose an approver from the list.');
    let n = 0;
    for (let r = 1; r < o.values.length; r++) {
      if (otId_(o.values[r][o.c.id]) !== id) continue;
      before = String(o.values[r][o.c.mgr] || '');
      name = o.c.en >= 0 ? String(o.values[r][o.c.en] || '') : '';
      o.sh.getRange(r + 1, o.c.mgr + 1).setValue(pick[0]);
      if (o.c.tg >= 0) o.sh.getRange(r + 1, o.c.tg + 1).setValue(pick[1]);
      n++;
    }
    if (!n) throw new Error('Employee ID ' + id + ' is not in the OT employee list.');
  } finally {
    lock.releaseLock();
  }
  const log = umLog_(user.name || user.email, String(p.email || ''), name, ['OT approver: ' + (before || '–') + ' → ' + p.manager]);
  return { manager: p.manager, tg: p.tg, log };
}
