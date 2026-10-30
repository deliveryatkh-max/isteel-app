/**
 * Delivery Journey — Google Apps Script backend for the ដឹកជញ្ជូន (Transport) app on isteel-app.pages.dev/delivery/.
 *
 * Bound to the SSK-DELIVERY-DATA Google Sheet (Extensions > Apps Script inside that sheet).
 * The sheet stays the source of truth. Existing tabs are read as they are; this script only:
 *   - appends rows to "Time Log" (one row per event, never overwriting an earlier event)
 *   - adds the "Trips" tab (Trip ID … Trip Status) and keeps Gate Out Time / Trip Status up to date
 *   - adds the "Audit Log" tab (every time correction and user change)
 *   - adds/edits rows in "User Manager" when an Admin uses the Users screen
 * "Status of Delivery" in Time Log is never written: the app calculates it.
 *
 * Script Properties (Project Settings > Script properties):
 *   GOOGLE_CLIENT_ID   same Client ID as the other iSteel apps (config.js)
 *   SESSION_SECRET     copy of the Fuel app's SESSION_SECRET, so one sign-in works in every app
 *   LINK_SECRET        made by setup(); signs the driver trip links
 *   PHOTO_FOLDER_ID    made by setup(); Drive folder for photos
 */

const SH = {
  LOG: 'Time Log', TRIPS: 'Trips', AUDIT: 'Audit Log', PLAN: 'Delivery Plan', CUST: 'Customer',
  PLATES: 'Plate Number', DRIVERS: 'Driver List', USERS: 'User Manager', TYPES: 'Type Record', WH: 'Warehouse List',
};
const TRIP_COLS = ['Trip ID', 'Trip Date', 'Truck No.', "Driver's Name", 'Trip Round', 'Gate In Time', 'Gate Out Time', 'Trip Status'];
const AUDIT_COLS = ['Time', 'User', 'Action', 'Key No.', 'Trip ID', 'Field', 'Old Value', 'New Value', 'Reason'];

// Time Log columns this app uses, by their real header text (found by name, so moving a column is safe).
const LOG_COLS = {
  key: 'Key No.', recorder: 'អ្នកកត់ត្រា', event: 'ស្ថានភាពដឹកជញ្ជូន', truckPhoto: 'រូបថតឡាន', plate: 'ផ្លាកលេខឡាន',
  driver: 'ឈ្មោះតៃកុង', round: 'ជើងទីប៉ុន្មាន?', wh: 'ឃ្លាំង', so: 'លេខបញ្ជាទិញ (SO)', dn: 'លេខដឹកជញ្ជូន (DN#)',
  cust: 'អតិថិជន', websling: 'ប្រើ Websling?', kg: 'ទំងន់ (Kg)', billPhoto: 'រូបថតបុង', goodsPhoto: 'រូបថតទំនិញ',
  remark: 'កំណត់សំគាល់ ឬ មតិ', user: 'User', date: 'Date of Record', time: 'Date & Time of Record', latlong: 'LatLong',
  tripText: 'Trip ID', status: 'Status of Delivery', mode: 'Form Mode', trip: 'Master Trip ID', current: 'Is Current',
};
const OPS_ROWS = 6000;        // Operations screens read only the newest rows of Time Log (plenty for 30+ days)
const OPEN_DAYS = 14;         // open trips older than this drop off the Active list (they stay in History)
const DRIVER_LINK_DAYS = 4;   // a driver link works for this many days after Gate In
const MAX_PHOTOS = 5;         // photos per step (Delivered: proof of delivery)

// ---------------------------------------------------------------- web entry points
function doGet() { return json_({ ok: true, app: 'Delivery Journey' }); }

function doPost(e) {
  let body = {};
  try { body = JSON.parse((e && e.postData && e.postData.contents) || '{}'); } catch (err) { return json_({ ok: false, error: 'BAD: Bad request' }); }
  try {
    const p = body.payload || {};
    // Driver links: no sign-in, the signed link is the permission (only that trip's delivery steps).
    if (body.action === 'drvTrip') return json_({ ok: true, data: driverTrip_(p) });
    if (body.action === 'drvRecord') return json_({ ok: true, data: driverRecord_(p) });
    if (body.action === 'drvAttach') { const c = checkDriverLink_(p, true); return json_({ ok: true, data: attachPhotos_(Object.assign({}, p, { tripId: c.tripId }), 'driver-link') }); }
    if (body.action === 'drvSiteRate') { const c = checkDriverLink_(p, true); return json_({ ok: true, data: siteRate_(p, c.tripId, 'driver-link') }); }
    // Customer rating link (no sign-in): signed per DN + trip.
    if (body.action === 'rateInfo') return json_({ ok: true, data: rateInfo_(p) });
    if (body.action === 'rateSave') return json_({ ok: true, data: rateSave_(p) });
    const user = authenticate_(body.token);
    const out = { ok: true, data: route_(body.action, p, user) };
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
    case 'ops': return ops_(p, user);
    case 'trip': return tripDetail_(p.tripId, user);
    case 'record': return record_(p, user);
    case 'attach': return attach_(p, user);
    case 'dn': return dnDetail_(p.dn);
    case 'search': return search_(p);
    case 'history': return history_(p);
    case 'deleteEntry': need_(user, 'supervisor'); return deleteEntry_(p, user);
    case 'correct': fail_('DENIED', 'Changing a recorded time is turned off.', 'មិនអនុញ្ញាតឲ្យកែម៉ោងដែលបានកត់ត្រាទេ។');   // Kim, 12 Oct 2026
    case 'users': need_(user, 'admin'); return usersList_();
    case 'setUser': need_(user, 'admin'); return setUser_(p, user);
    case 'quality': need_(user, 'supervisor'); return quality_();
    case 'siteRate': return siteRate_(p, String(p.tripId || ''), user.email);
    case 'confirmDelay': return confirmDelay_(p, user);
    case 'complaints': return complaints_(p);
    case 'complaintAdd': return complaintAdd_(p, user);
    case 'complaintResolve': return complaintResolve_(p, user);
    case 'setSite': return setSite_(p, user);
    case 'kpi': return kpi_(p, user);
    default: fail_('BAD', 'Unknown action');
  }
}

function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function fail_(code, en, kh) { throw new Error(code + ': ' + en + (kh ? ' || ' + kh : '')); }
const prop_ = k => PropertiesService.getScriptProperties().getProperty(k) || '';
const TZ = 'Asia/Phnom_Penh';
const fmt_ = (d, f) => Utilities.formatDate(d, TZ, f);
const ymd_ = d => fmt_(d, 'yyyy-MM-dd');
function now_() { return new Date(); }
function ss_() { return SpreadsheetApp.getActive(); }
function sheet_(name) {
  const sh = ss_().getSheetByName(name);
  if (!sh) fail_('SETUP', 'The sheet tab "' + name + '" is missing. Run setup() in Apps Script.');
  return sh;
}
const timeOf_ = v => (v instanceof Date ? v.getTime() : (v ? new Date(v).getTime() || 0 : 0));
const text_ = v => (v == null ? '' : v instanceof Date ? fmt_(v, 'yyyy-MM-dd HH:mm') : String(v).trim());

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(28000)) fail_('BUSY', 'Many people are saving at once. Please tap Save again.', 'មានអ្នកកំពុងរក្សាទុកច្រើនពេកក្នុងពេលតែមួយ។ សូមចុចរក្សាទុកម្តងទៀត។');
  try { return fn(); } finally { lock.releaseLock(); }
}

// ---------------------------------------------------------------- setup (run once from the editor)
/** Adds the Trips and Audit Log tabs and the secrets. Safe to run again: nothing existing is changed. */
function setup() {
  const ss = ss_();
  if (!ss.getSheetByName(SH.TRIPS)) {
    const sh = ss.insertSheet(SH.TRIPS);
    sh.getRange(1, 1, 1, TRIP_COLS.length).setValues([TRIP_COLS]).setFontWeight('bold');
    sh.setFrozenRows(1);
    sh.getRange('B:B').setNumberFormat('yyyy-mm-dd');
    sh.getRange('F:G').setNumberFormat('yyyy-mm-dd hh:mm:ss');
  }
  if (!ss.getSheetByName(SH.AUDIT)) {
    const sh = ss.insertSheet(SH.AUDIT);
    sh.getRange(1, 1, 1, AUDIT_COLS.length).setValues([AUDIT_COLS]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('LINK_SECRET')) props.setProperty('LINK_SECRET', Utilities.getUuid() + Utilities.getUuid());
  if (!props.getProperty('PHOTO_FOLDER_ID')) props.setProperty('PHOTO_FOLDER_ID', DriveApp.createFolder('Delivery App Photos').getId());
  const notes = setupExtras_();
  const missing = Object.keys(LOG_COLS).filter(k => logCols_()[k] == null).map(k => LOG_COLS[k]);
  if (missing.length) notes.push('Time Log is missing these headers: ' + missing.join(', '));
  if (!prop_('GOOGLE_CLIENT_ID')) notes.push('Add GOOGLE_CLIENT_ID in Script properties.');
  if (!prop_('SESSION_SECRET')) notes.push('Copy SESSION_SECRET from the Fuel app script into Script properties.');
  const msg = notes.length ? notes.join('\n') : 'Setup OK.';
  console.log(msg);
  return msg;
}

// ---------------------------------------------------------------- sign-in (same sessions as the other iSteel apps)
const SESSION_DAYS = 30, SESSION_RENEW_DAYS = 15;
const b64url_ = data => Utilities.base64EncodeWebSafe(data).replace(/=+$/, '');
const b64urlText_ = s => Utilities.newBlob(Utilities.base64DecodeWebSafe(s + '==='.slice((s.length + 3) % 4))).getDataAsString();
const SESSION_HEAD = () => b64url_(JSON.stringify({ alg: 'HS256', typ: 'STEEL' }));
const sessionSig_ = t => b64url_(Utilities.computeHmacSha256Signature(t, prop_('SESSION_SECRET')));

function makeSession_(email) {
  if (!prop_('SESSION_SECRET')) return null;
  const now = Math.floor(Date.now() / 1000);
  const body = b64url_(Utilities.newBlob(JSON.stringify({ email: email, iat: now, exp: now + SESSION_DAYS * 86400 })).getBytes());
  return SESSION_HEAD() + '.' + body + '.' + sessionSig_(SESSION_HEAD() + '.' + body);
}
function readSession_(token) {
  const parts = String(token).split('.');
  if (parts.length !== 3 || parts[0] !== SESSION_HEAD() || !prop_('SESSION_SECRET')) return null;
  if (sessionSig_(parts[0] + '.' + parts[1]) !== parts[2]) fail_('AUTH', 'Sign-in expired. Please sign in again.', 'ការចូលបានផុតកំណត់។ សូមចូលម្តងទៀត។');
  const b = JSON.parse(b64urlText_(parts[1]));
  if (!(b.exp * 1000 > Date.now())) fail_('AUTH', 'Sign-in expired. Please sign in again.', 'ការចូលបានផុតកំណត់។ សូមចូលម្តងទៀត។');
  return { email: String(b.email).toLowerCase(), exp: b.exp };
}
function verifyGoogle_(token) {
  const cache = CacheService.getScriptCache();
  const key = 'tok_' + b64url_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, token));
  const hit = cache.get(key);
  if (hit) return hit;
  const res = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(token), { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) fail_('AUTH', 'Sign-in expired. Please sign in again.', 'ការចូលបានផុតកំណត់។ សូមចូលម្តងទៀត។');
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
  if (!u) fail_('NOACCESS', email + ' has no Delivery access. Ask the admin to tick ដឹកជញ្ជូន and set your Role (e.g. Logistics, Warehouse, Security, Driver) in Users.', email + ' មិនទាន់មានសិទ្ធិ ដឹកជញ្ជូន ទេ។ សូមស្នើអ្នកគ្រប់គ្រងធីក ដឹកជញ្ជូន និងដាក់ Role (ឧ. Logistics, Warehouse, Security, Driver) ក្នុង Users។');
  return { email: email, name: u.name, role: u.role, roleKey: roleKey(u.role), session: session };
}
function need_(user, level) {
  const ok = level === 'admin' ? user.roleKey === 'admin' : (user.roleKey === 'admin' || user.roleKey === 'supervisor');
  if (!ok) fail_('DENIED', 'Only ' + (level === 'admin' ? 'Admin' : 'Supervisor or Admin') + ' can do this.', 'មានតែ ' + (level === 'admin' ? 'Admin' : 'Supervisor ឬ Admin') + ' ទេដែលអាចធ្វើបាន។');
}

// ---------------------------------------------------------------- master data
function table_(name) {
  const sh = ss_().getSheetByName(name);
  if (!sh || sh.getLastRow() < 2) return { head: [], rows: [] };
  const v = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues();
  return { head: v[0].map(h => String(h).trim()), rows: v.slice(1) };
}
const col_ = (head, name) => head.indexOf(name);

/**
 * One user list for every app (Kim, 17 Oct 2026): the "Users" tab of the Fuel Refill sheet, whose id is the
 * Script Property USERS_SHEET_ID. A user may open Delivery when Active = Yes and the ដឹកជញ្ជូន box is ticked.
 * One Role column for every app (Kim, 30 Oct 2026): admin, supervisor, reviewer, logistics, warehouse, security,
 * driver or user. It sets what they can record (reviewer counts as Supervisor; user records nothing). The old
 * "Delivery Role" column is still read for a plain user until mergeDeliveryRoles() (Code.gs) removes it.
 * Until USERS_SHEET_ID is set, User Manager is used.
 */
const FUEL_USERS_TAB = 'Users', DELIVERY_ROLE_COL = 'Delivery Role', TRANSPORT_COL = 'ដឹកជញ្ជូន';
function usersSheet_() {
  const id = prop_('USERS_SHEET_ID');
  if (!id) return null;
  const sh = SpreadsheetApp.openById(id).getSheetByName(FUEL_USERS_TAB);
  if (!sh) throw new Error('The Fuel Refill sheet has no "' + FUEL_USERS_TAB + '" tab (USERS_SHEET_ID).');
  return sh;
}
function tableOf_(sh) {
  if (!sh || sh.getLastRow() < 1) return { head: [], rows: [] };
  const v = sh.getRange(1, 1, sh.getLastRow(), Math.max(1, sh.getLastColumn())).getValues();
  return { head: v[0].map(h => String(h).trim()), rows: v.slice(1) };
}
const yes_ = v => v === true || /^(yes|true|y|1)$/i.test(String(v).trim());
const JOB_OF = { admin: 'Admin', supervisor: 'Supervisor', reviewer: 'Supervisor', logistics: 'Logistics', warehouse: 'Warehouse', security: 'Security', driver: 'Driver' };
const jobOf_ = role => JOB_OF[String(role || '').trim().toLowerCase()] || '';

/** Everyone in the user list (with or without Delivery access), for sign-in and the Users screen. */
function users_() {
  const fuel = usersSheet_();
  if (!fuel) {
    const t = table_(SH.USERS);
    const e = col_(t.head, 'EMAIL'), n = col_(t.head, 'NAME'), r = col_(t.head, 'ROLE');
    return t.rows.filter(x => x[e]).map(x => ({ email: String(x[e]).trim().toLowerCase(), name: text_(x[n]), role: text_(x[r]), ok: true }));
  }
  const t = tableOf_(fuel);
  const c = name => t.head.indexOf(name);
  const e = c('Email'), n = c('Name'), fr = c('Role'), a = c('Active'), tr = c(TRANSPORT_COL), dr = c(DELIVERY_ROLE_COL);
  return t.rows.filter(x => x[e]).map(x => {
    const fuelAdmin = /admin/i.test(text_(x[fr]));
    const role = jobOf_(x[fr]) || (dr >= 0 ? text_(x[dr]) : '');
    return { email: String(x[e]).trim().toLowerCase(), name: text_(x[n]), role: role,
      ok: (a < 0 || yes_(x[a])) && (tr < 0 || yes_(x[tr]) || fuelAdmin) && !!role };
  });
}

/** Sign-in check on every call: the user list kept 60 s in the cache (saving is faster; a role change shows within a minute). */
function usersCached_() {
  const cache = CacheService.getScriptCache();
  const hit = cache.get('users_v2');
  if (hit) return JSON.parse(hit);
  const u = users_();
  try { cache.put('users_v2', JSON.stringify(u), 60); } catch (e) { /* too big: read each time */ }
  return u;
}

/** Allowed recorders per event code, from Type Record (kept 5 minutes in the cache). */
function allowed_() {
  const cache = CacheService.getScriptCache();
  const hit = cache.get('allowed_v1');
  if (hit) return JSON.parse(hit);
  const t = table_(SH.TYPES);
  const out = {};
  t.rows.forEach(r => { const c = eventCode(r[0]); if (c) out[c] = text_(r[3]); });
  cache.put('allowed_v1', JSON.stringify(out), 300);
  return out;
}

function master_() {
  const cache = CacheService.getScriptCache();
  const hit = cache.get('master_v2');
  if (hit) return JSON.parse(hit);
  const ft = fuelTrucks_();
  let isiPlates, drivers;
  if (ft) ({ plates: isiPlates, drivers } = ft);
  else {   // USERS_SHEET_ID not set yet: the old Plate Number / Driver List tabs of this sheet
    const plates = table_(SH.PLATES);
    const pPlate = 2, pType = 3;   // ផ្លាកលេខឡាន, ប្រភេទឡាន (no header name is stable enough: matched by position, checked below)
    isiPlates = plates.rows.filter(r => r[pPlate]).map(r => ({ plate: normPlate(r[pPlate]), type: text_(r[pType]) }));
    const drv = table_(SH.DRIVERS);
    const dName = col_(drv.head, 'ឈ្មោះតៃកុង'), dPlate = col_(drv.head, 'CODE'), dCo = col_(drv.head, 'ក្រុមហ៊ុន');
    drivers = drv.rows.filter(r => r[dName]).map(r => ({ name: text_(r[dName]), plate: normPlate(r[dPlate]), co: text_(r[dCo]) }));
  }
  const cu = table_(SH.CUST);
  const cId = col_(cu.head, 'Customer ID'), cName = col_(cu.head, 'Customer Name');
  const customers = cu.rows.filter(r => r[cId]).map(r => ({ id: text_(r[cId]), name: text_(r[cName]) }));
  const wh = table_(SH.WH);   // WH_CODE only; the PASSWORD column is never read out
  const whc = col_(wh.head, 'WH_CODE');
  const warehouses = Array.from(new Set(wh.rows.map(r => text_(r[whc])).filter(Boolean)));
  const m = { plates: isiPlates, drivers: drivers, customers: customers, warehouses: warehouses };
  try { cache.put('master_v2', JSON.stringify(m), 600); } catch (e) { /* over 100 KB: just not cached */ }
  return m;
}

/**
 * ISI trucks and drivers from one list (Kim, 17 Oct 2026): the "Driver & Truck" tab of the Fuel Refill sheet
 * (USERS_SHEET_ID), the same list the Fuel app uses. Each row is a driver (ឈ្មោះតៃកុង) with the truck plate in CODE;
 * every plate there counts as an ISI truck unless its company (ក្រុមហ៊ុន) is filled with a non-ISI name.
 * That tab has no truck-type column, so the plate's driver is shown under it instead.
 */
const FUEL_TRUCKS_TAB = 'Driver & Truck';
function fuelTrucks_() {
  const id = prop_('USERS_SHEET_ID');
  if (!id) return null;
  const sh = SpreadsheetApp.openById(id).getSheetByName(FUEL_TRUCKS_TAB);
  if (!sh) { console.warn('The Fuel Refill sheet has no "' + FUEL_TRUCKS_TAB + '" tab: using Plate Number / Driver List.'); return null; }
  const t = tableOf_(sh);
  const iName = t.head.indexOf('ឈ្មោះតៃកុង'), iPlate = t.head.indexOf('CODE'), iCo = t.head.indexOf('ក្រុមហ៊ុន');
  if (iName < 0 || iPlate < 0) throw new Error('"' + FUEL_TRUCKS_TAB + '" needs the headers ឈ្មោះតៃកុង and CODE.');
  const drivers = t.rows.filter(r => text_(r[iName])).map(r => ({ name: text_(r[iName]), plate: normPlate(r[iPlate]), co: iCo < 0 ? '' : text_(r[iCo]) }));
  const by = {}, order = [];
  t.rows.forEach(r => {
    const plate = normPlate(r[iPlate]), co = iCo < 0 ? '' : text_(r[iCo]);
    if (!plate || plate === '0' || (co && !/isi/i.test(co))) return;
    if (!by[plate]) { by[plate] = []; order.push(plate); }
    if (text_(r[iName])) by[plate].push(text_(r[iName]));
  });
  return { plates: order.map(p => ({ plate: p, type: by[p].join(', ') })), drivers: drivers };
}

/** Delivery Plan rows by DN: plate, driver, round, customer, SO, weight. */
function plan_() {
  const t = table_(SH.PLAN);
  const c = n => col_(t.head, n);
  const iDate = c('DELIVERY DATE'), iPlate = c('PLATE NUMBER'), iDrv = c('DRIVER'), iRound = c('TRIP INDEX'), iCid = c('CUSTOMER ID'),
    iCname = c('CUSTOMER NAME'), iSo = c('SO NUMBER'), iDn = c('DN NUMBER'), iFleet = c('TRUCK FLEET'), iKg = c('G. WEIGHT KG'), iSched = c('SCHEDULE');
  const out = {};
  t.rows.forEach(r => {
    const dn = normDn(r[iDn]);
    if (!dn) return;
    out[dn] = {
      dn: dn, date: r[iDate] instanceof Date ? ymd_(r[iDate]) : text_(r[iDate]), plate: normPlate(r[iPlate]), driver: text_(r[iDrv]),
      round: text_(r[iRound]), custId: text_(r[iCid]).replace(/\.0+$/, ''), custName: text_(r[iCname]), so: text_(r[iSo]).replace(/\.0+$/, ''),
      fleet: text_(r[iFleet]), kg: Number(r[iKg]) || 0, sched: text_(r[iSched]),
    };
  });
  return out;
}

function boot_(user) {
  const allowed = allowed_();
  const m = master_();
  const plan = plan_();
  const today = ymd_(now_());
  const from = ymd_(new Date(Date.now() - 30 * 86400000));
  const planList = Object.keys(plan).map(k => plan[k]).filter(p => !p.date || p.date >= from);
  const set = settings_(), co = companies_();
  const plateCo = {};
  Object.keys(co).forEach(k => { if (co[k] !== 'ISI') plateCo[k] = co[k]; });
  return {
    user: { email: user.email, name: user.name, role: user.role, roleKey: user.roleKey },
    events: EVENTS.map(e => ({ code: e.code, key: e.key, kh: e.kh, en: e.en, scope: e.scope, allowed: allowed[e.code] || '', can: canRecord(user.role, allowed[e.code]) })),
    canCorrect: user.roleKey === 'admin' || user.roleKey === 'supervisor',
    isAdmin: user.roleKey === 'admin',
    plates: m.plates, drivers: m.drivers, customers: m.customers, warehouses: m.warehouses, plan: planList,
    stages: STAGES, dnStatuses: DN_STATUS, legs: LEG, today: today, serverNow: Date.now(),
    settings: { warnMin: set.INSIDE_WARN_MIN, lateMin: set.INSIDE_LATE_MIN, farKm: set.FAR_KM },
    companies: companyNames_(co), plateCo: plateCo, trucks: trucks_(), complaintTypes: COMPLAINT_TYPES,
    canKpi: ['admin', 'supervisor', 'logistics'].indexOf(user.roleKey) >= 0,
  };
}

// ---------------------------------------------------------------- Time Log reading
let logColsCache_ = null;
function logCols_() {
  if (logColsCache_) return logColsCache_;
  const sh = sheet_(SH.LOG);
  const head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(h => String(h).trim());
  const map = { width: head.length };
  Object.keys(LOG_COLS).forEach(k => { const i = head.indexOf(LOG_COLS[k]); if (i >= 0) map[k] = i; });
  logColsCache_ = map;
  return map;
}

/** One Time Log row as the app sees it. rowNo = sheet row number (for corrections). */
function parseRow_(v, rowNo, C) {
  const t = timeOf_(v[C.time]);
  return {
    row: rowNo, key: text_(v[C.key]), code: eventCode(v[C.event]), eventText: text_(v[C.event]), recorder: text_(v[C.recorder]),
    trip: text_(v[C.trip]) || text_(v[C.key]), plate: normPlate(v[C.plate]), driver: text_(v[C.driver]), round: text_(v[C.round]),
    wh: text_(v[C.wh]), so: text_(v[C.so]).replace(/\.0+$/, ''), dn: normDn(v[C.dn]), cust: text_(v[C.cust]), websling: text_(v[C.websling]),
    kg: Number(v[C.kg]) || 0, remark: text_(v[C.remark]), user: text_(v[C.user]), time: t, latlong: text_(v[C.latlong]),
    mode: text_(v[C.mode]), truckPhoto: text_(v[C.truckPhoto]), billPhoto: text_(v[C.billPhoto]), goodsPhoto: text_(v[C.goodsPhoto]), seq: rowNo,
  };
}

/** The newest n rows of Time Log, parsed. */
function tailRows_(n) {
  const sh = sheet_(SH.LOG), C = logCols_();
  const last = sh.getLastRow();
  if (last < 2) return [];
  const first = Math.max(2, last - n + 1);
  const vals = sh.getRange(first, 1, last - first + 1, C.width).getValues();
  return vals.map((v, i) => parseRow_(v, first + i, C)).filter(r => r.code || r.key);
}

/** All rows whose column `field` equals one of `values` (reads that one column, then only the matching rows). */
function rowsWhere_(field, values) {
  const sh = sheet_(SH.LOG), C = logCols_();
  const last = sh.getLastRow();
  if (last < 2 || C[field] == null) return [];
  const want = {};
  values.forEach(v => { want[field === 'dn' ? normDn(v) : String(v)] = 1; });
  const colVals = sh.getRange(2, C[field] + 1, last - 1, 1).getValues();
  const hits = [];
  colVals.forEach((v, i) => { const k = field === 'dn' ? normDn(v[0]) : text_(v[0]); if (want[k]) hits.push(i + 2); });
  if (!hits.length) return [];
  // Read the matching rows in runs, so 50 rows of one trip cost one or two reads.
  const out = [];
  let i = 0;
  while (i < hits.length) {
    let j = i;
    while (j + 1 < hits.length && hits[j + 1] - hits[j] < 40) j++;
    const from = hits[i], to = hits[j];
    const vals = sh.getRange(from, 1, to - from + 1, C.width).getValues();
    const set = {};
    hits.slice(i, j + 1).forEach(h => { set[h] = 1; });
    vals.forEach((v, k) => { if (set[from + k]) out.push(parseRow_(v, from + k, C)); });
    i = j + 1;
  }
  return out;
}

// Old trips used Key No. as the trip key and left Master Trip ID equal to it, so grouping by `trip` covers both.
function groupTrips_(rows) {
  const g = {};
  rows.forEach(r => { if (r.trip) (g[r.trip] || (g[r.trip] = [])).push(r); });
  return g;
}

function tripsSheetIndex_() {
  const t = table_(SH.TRIPS);
  const idx = {};
  t.rows.forEach((r, i) => { if (r[0]) idx[text_(r[0])] = { row: i + 2, date: r[1] instanceof Date ? ymd_(r[1]) : text_(r[1]), plate: normPlate(r[2]), driver: text_(r[3]), round: text_(r[4]), gateIn: timeOf_(r[5]), gateOut: timeOf_(r[6]), status: text_(r[7]) }; });
  return idx;
}

/** DNs fully delivered, from DN info: open legs of these DNs on other trips show "Delivered on another trip". */
function doneSet_(info) {
  const out = {};
  Object.keys(info).forEach(dn => { if (info[dn].status === 'delivered') out[dn] = true; });
  return out;
}

/**
 * Truck plate cells are set to Plain text before writing (17 Oct 2026): otherwise Google Sheets reads plates
 * like 3E-2588 as a number (3 × 10^-2588) and saves 0. Only the plate columns change format.
 */
function plateText_(sh, row, nRows, cols) {
  cols.filter(c => c != null && c >= 0).forEach(c => sh.getRange(row, c + 1, nRows, 1).setNumberFormat('@'));
}

/**
 * Run once from the editor (17 Oct 2026): lists the Time Log and Trips rows whose truck plate was saved as 0
 * (plates like 3E-2588 before plateText_), with the plate the driver's own truck suggests. Read-only: it changes
 * nothing except writing the list to a "Plate check" tab, so the rows can be checked before any correction.
 */
function findZeroPlates() {
  const C = logCols_(), log = sheet_(SH.LOG), trips = sheet_(SH.TRIPS);
  const byDriver = {};
  master_().drivers.forEach(d => { if (d.plate && d.plate !== '0') byDriver[d.name] = d.plate; });
  const zero = v => v === 0 || String(v).trim() === '0';
  const out = [];
  const lv = log.getLastRow() >= 2 ? log.getRange(2, 1, log.getLastRow() - 1, C.width).getValues() : [];
  lv.forEach((v, i) => {
    if (!zero(v[C.plate])) return;
    const r = parseRow_(v, i + 2, C);
    out.push([SH.LOG, i + 2, r.trip, r.time ? new Date(r.time) : '', r.driver, byDriver[r.driver] || '']);
  });
  const tv = trips.getLastRow() >= 2 ? trips.getRange(2, 1, trips.getLastRow() - 1, TRIP_COLS.length).getValues() : [];
  tv.forEach((v, i) => { if (zero(v[2])) out.push([SH.TRIPS, i + 2, text_(v[0]), v[5] || v[1] || '', text_(v[3]), byDriver[text_(v[3])] || '']); });
  const ss = ss_();
  const sh = ss.getSheetByName('Plate check') || ss.insertSheet('Plate check');
  sh.clear();
  sh.getRange(1, 1, 1, 6).setValues([['Sheet', 'Row', 'Trip ID', 'Time', 'Driver', "Driver's truck (suggested)"]]).setFontWeight('bold');
  if (out.length) { plateText_(sh, 2, out.length, [5]); sh.getRange(2, 1, out.length, 6).setValues(out); }
  const msg = 'Rows with plate 0: ' + out.length + ' (see the Plate check tab). Nothing was changed.';
  console.log(msg);
  return msg;
}

/** Summary of one trip for lists. */
function tripSummary_(id, rows, tripsIdx, done) {
  const st = tripState(rows, done);
  const first = rows.slice().sort((a, b) => a.time - b.time)[0] || {};
  const meta = tripsIdx[id] || {};
  const pick = f => rows.map(r => r[f]).filter(Boolean)[0] || '';
  return {
    id: id, date: meta.date || (st.gateIn ? ymd_(new Date(st.gateIn)) : first.time ? ymd_(new Date(first.time)) : ''),
    plate: meta.plate || pick('plate'), driver: meta.driver || pick('driver'), round: meta.round || pick('round'),
    gateIn: st.gateIn, gateOut: st.gateOut, stage: st.stage, closed: st.closed, lastTime: st.last ? st.last.time : 0,
    lastCode: st.last ? st.last.code : 0, progress: st.lastProgress,
    dns: st.dnList.map(d => ({ dn: d.dn, cust: d.cust, leg: d.leg, kg: d.kg })),
    legacy: !tripsIdx[id],
  };
}

// ---------------------------------------------------------------- Operations
function ops_(p, user) {
  const rows = tailRows_(OPS_ROWS);
  const groups = groupTrips_(rows);
  const idx = tripsSheetIndex_();
  const today = ymd_(now_());
  const openFrom = Date.now() - OPEN_DAYS * 86400000;
  const dnSeen = {};
  rows.forEach(r => { if (r.dn) dnSeen[r.dn] = 1; });
  const info = dnsInfo_(Object.keys(dnSeen), rows, plan_());
  const done = doneSet_(info);
  const trips = [];
  Object.keys(groups).forEach(id => {
    const s = tripSummary_(id, groups[id], idx, done);
    const isToday = s.date === today;
    // Old AppSheet trips without any DN never reach "Completed"; they show only on their own day.
    const untracked = s.legacy && !s.dns.length;
    if (isToday || (!s.closed && !untracked && s.lastTime >= openFrom)) trips.push(s);
  });
  trips.sort((a, b) => (b.gateIn || b.lastTime) - (a.gateIn || a.lastTime));
  const dnCounts = { delivered: 0, partial: 0, in_progress: 0, failed: 0, canceled: 0 };
  Object.keys(info).forEach(dn => {
    const i = info[dn];
    const touchedToday = i.legs.some(l => ymd_(new Date(l.time)) === today);
    if (touchedToday && dnCounts[i.status] != null) dnCounts[i.status]++;
  });
  return { trips: trips, dnToday: dnCounts, today: today, serverNow: Date.now() };
}

function tripDetail_(tripId, user) {
  tripId = String(tripId || '').trim();
  if (!tripId) fail_('BAD', 'Trip ID is missing.');
  const rows = rowsWhere_('trip', [tripId]);
  const legacyRows = rows.length ? [] : rowsWhere_('key', [tripId]);
  const all = rows.length ? rows : legacyRows;
  if (!all.length) fail_('NOTFOUND', 'Trip ' + tripId + ' was not found.', 'រកមិនឃើញជើងដឹក ' + tripId + '។');
  const idx = tripsSheetIndex_();
  const dns = Array.from(new Set(all.map(r => r.dn).filter(Boolean)));
  const plan = plan_();
  const others = dns.length ? rowsWhere_('dn', dns) : [];
  const dnInfo = dnsInfo_(dns, others, plan);
  const s = tripSummary_(tripId, all, idx, doneSet_(dnInfo));
  const out = Object.assign(s, {
    rows: all.sort((a, b) => a.time - b.time || a.row - b.row),
    dnInfo: dnInfo,
  });
  if (!s.closed && (user.roleKey === 'admin' || user.roleKey === 'supervisor' || user.roleKey === 'logistics' || user.roleKey === 'security')) {
    out.driverLink = driverLinkToken_(tripId);
  }
  out.far = farRows_(all);
  out.proof = proofFor_(tripId);
  out.rate = rateLinks_(tripId, all);
  out.company = companyOf_(s.plate);
  out.complaints = complaintList_(xrows_(XT.COMPLAINTS).filter(r => text_(r['Trip ID']) === tripId)).length;
  return out;
}

/** Overall status of each DN over every trip, from the DN's Time Log rows. */
function dnsInfo_(dns, dnRows, plan) {
  const byDn = {};
  dnRows.forEach(r => { if (r.dn) (byDn[r.dn] || (byDn[r.dn] = [])).push(r); });
  const out = {};
  dns.forEach(dn => {
    const rs = byDn[dn] || [];
    const trips = groupTrips_(rs);
    const legs = Object.keys(trips).map(id => {
      const st = tripState(trips[id]);
      const d = st.dns[dn];
      return { tripId: id, leg: d.leg, kg: d.kg, final: d.final, time: d.time, plate: trips[id][0].plate, cust: d.cust };
    });
    const p = plan[dn] || null;
    const s = dnStatus(legs, p ? p.kg : 0);
    out[dn] = { dn: dn, plan: p, legs: legs, status: s.status, kg: s.kg, planKg: s.planKg, openTrips: s.openTrips };
  });
  return out;
}

function dnDetail_(dn) {
  dn = normDn(dn);
  if (!dn) fail_('BAD', 'Type a DN number.', 'សូមវាយលេខ DN។');
  const plan = plan_();
  const rows = rowsWhere_('dn', [dn]);
  const info = dnsInfo_([dn], rows, plan)[dn];
  info.rows = rows.sort((a, b) => a.time - b.time);
  info.complaints = complaints_({ dn: dn }).items;
  info.siteRatings = siteRatingsOf_(dn);
  info.custRatings = customerRatingsOf_(dn);
  info.rate = {};
  rows.filter(r => r.code === 9 && r.trip).forEach(r => { info.rate[r.trip] = rateToken_(dn, r.trip); });
  return info;
}

/**
 * DN / delivery search. Any of: q (DN, customer, trip, plate or driver text), from/to (yyyy-mm-dd), status.
 * Reads the whole Time Log once (only a few columns matter) and the Delivery Plan.
 */
function search_(p) {
  const q = String(p.q || '').trim().toLowerCase();
  const from = p.from || '', to = p.to || '';
  const sh = sheet_(SH.LOG), C = logCols_();
  const last = sh.getLastRow();
  const vals = last >= 2 ? sh.getRange(2, 1, last - 1, C.width).getValues() : [];
  const rows = vals.map((v, i) => parseRow_(v, i + 2, C)).filter(r => r.dn);
  const plan = plan_();
  const dns = {};
  rows.forEach(r => { dns[r.dn] = 1; });
  Object.keys(plan).forEach(dn => { dns[dn] = 1; });
  const info = dnsInfo_(Object.keys(dns), rows, plan);
  const rowsByDn = {};
  rows.forEach(r => { (rowsByDn[r.dn] || (rowsByDn[r.dn] = [])).push(r); });
  let list = Object.keys(info).map(dn => {
    const i = info[dn], rs = rowsByDn[dn] || [], pl = i.plan || {};
    const firstTime = rs.length ? Math.min.apply(null, rs.map(r => r.time)) : 0;
    const date = rs.length ? ymd_(new Date(firstTime)) : pl.date || '';
    const cust = pl.custName ? (pl.custId ? pl.custId + '-' : '') + pl.custName : (rs.map(r => r.cust).filter(Boolean)[0] || '');
    const hay = [dn, cust, pl.so || '', i.legs.map(l => l.tripId + ' ' + l.plate).join(' '), rs.map(r => r.driver).join(' '), pl.plate || '', pl.driver || ''].join(' ').toLowerCase();
    return { dn: dn, cust: cust, so: pl.so || rs.map(r => r.so).filter(Boolean)[0] || '', date: date, status: i.status, kg: i.kg, planKg: i.planKg, trips: i.legs.map(l => ({ id: l.tripId, plate: l.plate, leg: l.leg })), hay: hay };
  });
  if (q) list = list.filter(x => matchText(x.hay, q));
  if (from) list = list.filter(x => x.date >= from);
  if (to) list = list.filter(x => x.date <= to);
  if (p.status) list = list.filter(x => x.status === p.status);
  list.sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.dn.localeCompare(a.dn));
  const total = list.length;
  return { total: total, items: list.slice(0, 300).map(x => { delete x.hay; return x; }) };
}

/** Trips between two dates (by trip date), newest first; closed and open alike. */
function history_(p) {
  const today = ymd_(now_());
  const from = p.from || ymd_(new Date(Date.now() - 7 * 86400000)), to = p.to || today;
  const q = String(p.q || '').trim().toLowerCase();
  const sh = sheet_(SH.LOG), C = logCols_();
  const last = sh.getLastRow();
  const vals = last >= 2 ? sh.getRange(2, 1, last - 1, C.width).getValues() : [];
  const rows = vals.map((v, i) => parseRow_(v, i + 2, C)).filter(r => r.trip);
  const groups = groupTrips_(rows);
  const idx = tripsSheetIndex_();
  const dnSeen = {};
  rows.forEach(r => { if (r.dn) dnSeen[r.dn] = 1; });
  const done = doneSet_(dnsInfo_(Object.keys(dnSeen), rows.filter(r => r.dn), plan_()));
  let list = Object.keys(groups).map(id => tripSummary_(id, groups[id], idx, done)).filter(t => t.date >= from && t.date <= to);
  if (p.stage === 'closed') list = list.filter(t => t.closed);
  else if (p.stage) list = list.filter(t => t.stage === p.stage);
  if (q) list = list.filter(t => matchText([t.id, t.plate, t.driver, t.dns.map(d => d.dn + ' ' + d.cust).join(' ')].join(' '), q));
  list.sort((a, b) => (b.gateIn || b.lastTime) - (a.gateIn || a.lastTime));
  return { total: list.length, items: list.slice(0, 400), from: from, to: to };
}

// ---------------------------------------------------------------- Recording an event
/**
 * p = { ref, code, tripId, plate, driver, truckType, dns: [{dn, custId, custName, so, kg, final}], cust,
 *       wh, kg, websling, remark, latlong, photo (data URL), photoKind, takenAt, confirm: [codes] }
 * Gate In makes the Trip ID. Every event appends its own row(s); nothing earlier is overwritten.
 * Warnings (wrong order, DN not in plan, DN open on another trip …) come back as needConfirm until the user agrees.
 */
function record_(p, user) {
  const code = Number(p.code);
  const ev = EV[code];
  if (!ev) fail_('BAD', 'Unknown event.');
  const allowed = allowed_();
  if (!canRecord(user.role, allowed[code])) fail_('DENIED', 'Your role (' + (user.role || 'none') + ') cannot record ' + ev.en + '.', 'តួនាទីរបស់អ្នក (' + (user.role || 'គ្មាន') + ') មិនអាចកត់ត្រា ' + ev.kh + ' បានទេ។');
  const recorder = recorderLabel_(user, allowed[code], p.truckType);
  return saveEvent_(p, { email: user.email, recorder: recorder });
}

/** The Time Log "អ្នកកត់ត្រា" value: the user's group from Type Record (Security → ១.សន្តិសុខ …). */
function recorderLabel_(user, allowedText, truckType) {
  const groups = String(allowedText || '').split('|').map(s => s.trim()).filter(Boolean);
  const k = user.roleKey;
  const want = { security: '១', logistics: '២', warehouse: '៣' }[k];
  if (want) return groups.find(g => g.charAt(0) === want) || '';
  if (k === 'driver') return truckLabel_(truckType, groups);
  return groups[0] || '';   // Supervisor / Admin: the event's usual recorder
}
function truckLabel_(truckType, groups) {
  const want = { isi: '៤', rented: '៥', customer: '៦' }[truckType] || '៤';
  return (groups || []).find(g => g.charAt(0) === want) || { '៤': '៤.ឡាន ISI', '៥': '៥.ឡានជួល', '៦': '៦.ឡានអតិថិជន' }[want];
}

function saveEvent_(p, who) {
  const code = Number(p.code);
  const ev = EV[code];
  const ref = String(p.ref || '').slice(0, 80);
  const cache = CacheService.getScriptCache();
  if (ref) { const done = cache.get('ref_' + ref); if (done) return JSON.parse(done); }   // network retry: same answer, nothing written twice

  const plan = plan_();
  const confirm = {};
  (p.confirm || []).forEach(c => { confirm[c] = 1; });
  const dnsIn = (p.dns || []).map(d => Object.assign({}, d, { dn: normDn(d.dn) })).filter(d => d.dn);
  const seen = {};
  const dns = dnsIn.filter(d => (seen[d.dn] ? false : (seen[d.dn] = 1)));
  dns.forEach(d => { if (!/^[0-9A-Z-]{4,20}$/.test(d.dn)) fail_('BAD', 'DN "' + d.dn + '" does not look like a DN number.', 'DN "' + d.dn + '" មិនមែនជាលេខ DN ទេ។'); });

  return withLock_(() => {
    if (ref) { const done = cache.get('ref_' + ref); if (done) return JSON.parse(done); }
    const now = now_();
    const at = eventTime_(p.takenAt, now);
    const sh = sheet_(SH.LOG), C = logCols_();
    let tripId = String(p.tripId || '').trim();
    let tripRows = [], st = null, plate = normPlate(p.plate), driver = String(p.driver || '').trim(), round = '';
    const trips = sheet_(SH.TRIPS);
    const idx = tripsSheetIndex_();

    if (code === 1) {
      if (!plate) fail_('BAD', 'Type or choose the truck plate.', 'សូមវាយ ឬជ្រើសផ្លាកលេខឡាន។');
      if (!/^[A-Z0-9ក-៿.-]{3,15}$/.test(plate)) fail_('BAD', 'Plate "' + plate + '" does not look right (example 3A-1234).', 'ផ្លាកលេខ "' + plate + '" មិនត្រឹមត្រូវ (ឧ. 3A-1234)។');
      // The same truck may make several trips a day; warn only when an earlier trip is still open.
      const recent = Object.keys(idx).filter(id => idx[id].plate === plate);
      const openPrev = recent.filter(id => idx[id].status && idx[id].status !== STAGES.completed.kh && idx[id].status !== STAGES.canceled.kh);
      const dup = recent.filter(id => idx[id].gateIn && Math.abs(at.getTime() - idx[id].gateIn) < DUPLICATE_MINUTES * 60000);
      if (dup.length) fail_('DUPLICATE', 'Gate In for ' + plate + ' was just recorded (trip ' + dup[0] + ').', 'ចូលថ្លឹងសម្រាប់ ' + plate + ' ទើបតែកត់ត្រា (ជើង ' + dup[0] + ')។');
      if (openPrev.length && !confirm.OPEN_PREV_TRIP) {
        return { needConfirm: openPrev.map(id => ({ code: 'OPEN_PREV_TRIP', tripId: id, en: plate + ' still has an open trip ' + id + ' (' + (STAGES[stageKey_(idx[id].status)] || {}).en + '). Gate In starts a new trip; the old one stays open until its DNs are closed.', kh: plate + ' នៅមានជើងដឹក ' + id + ' មិនទាន់បិទ (' + idx[id].status + ')។ ចូលថ្លឹងនឹងចាប់ផ្តើមជើងថ្មី ជើងចាស់នៅបើករហូតដល់ DN ត្រូវបិទ។' })) };
      }
      const today = ymd_(at);
      const ids = Object.keys(idx).concat(columnValues_(sh, C.trip));
      tripId = nextTripId(today, ids);
      const sameDay = Object.keys(idx).filter(id => idx[id].plate === plate && idx[id].date === today).length;
      const legacySameDay = legacyRoundsToday_(plate, today, idx);
      round = roundText(Math.max(sameDay, legacySameDay) + 1);
      st = tripState([]);
    } else {
      if (!tripId) fail_('NO_TRIP', 'Choose the trip.', 'សូមជ្រើសរើសជើងដឹក។');
      tripRows = rowsWhere_('trip', [tripId]);
      if (!tripRows.length) tripRows = rowsWhere_('key', [tripId]);
      if (!tripRows.length) fail_('NOTFOUND', 'Trip ' + tripId + ' was not found.', 'រកមិនឃើញជើងដឹក ' + tripId + '។');
      st = tripState(tripRows);
      const meta = idx[tripId] || {};
      plate = meta.plate || tripRows.map(r => r.plate).filter(Boolean)[0] || '';
      driver = meta.driver || tripRows.map(r => r.driver).filter(Boolean).pop() || driver;
      round = meta.round || tripRows.map(r => r.round).filter(Boolean)[0] || '';
      if (p.plate && normPlate(p.plate) !== plate) fail_('WRONG_TRIP', 'Trip ' + tripId + ' belongs to truck ' + plate + ', not ' + normPlate(p.plate) + '.', 'ជើងដឹក ' + tripId + ' ជារបស់ឡាន ' + plate + ' មិនមែន ' + normPlate(p.plate) + ' ទេ។');
    }

    const dnList = dns.map(d => d.dn);
    const tripDns = Array.from(new Set(tripRows.map(r => r.dn).filter(Boolean).concat(dnList)));
    const dnRows = tripDns.length ? rowsWhere_('dn', tripDns) : [];
    const info = dnsInfo_(tripDns, dnRows, plan);
    if (code !== 1) st = tripState(tripRows, doneSet_(info));
    const check = checkEvent({ code: code, trip: code === 1 ? null : st, tripId: tripId, dns: dnList, dnInfo: info, plate: plate });
    if (check.errors.length) fail_(check.errors[0].code, check.errors.map(e => e.en).join(' '), check.errors.map(e => e.kh).join(' '));
    requiredFields_(code, p, dns, plate, plan);
    // Repeated taps / retries without a ref: the same step for the same DN a moment ago.
    (dnList.length ? dnList : ['']).forEach(dn => {
      if (code !== 1 && isDuplicate(code, dn, at.getTime(), tripRows)) fail_('DUPLICATE', ev.en + (dn ? ' for DN ' + dn : '') + ' was already recorded a moment ago.', ev.kh + (dn ? ' សម្រាប់ DN ' + dn : '') + ' ទើបតែកត់ត្រារួចហើយ។');
    });
    const pending = check.warnings.filter(w => !confirm[w.code]);
    if (pending.length) return { needConfirm: pending };

    // Photos first (outside the sheet): a failed upload stops the save before anything is written.
    // p.later: the phone sends the photos right after, with 'attach' (the step is saved without waiting for them).
    const photos = p.later ? [] : (p.photos || (p.photo ? [p.photo] : [])).slice(0, MAX_PHOTOS);
    const photoUrls = photos.map((ph, i) => savePhoto_(ph, tripId + '_' + ev.key + (i ? '_' + (i + 1) : '')));
    const photoUrl = photoUrls[0] || '';
    const sigUrl = code === 9 && p.signature && !p.later ? savePhoto_(p.signature, tripId + '_signature') : '';

    const keys = tripRows.map(r => r.key);
    const rowsOut = [];
    const base = () => new Array(C.width).fill('');
    const put = (row, f, v) => { if (C[f] != null) row[C[f]] = v; };
    const targets = ev.scope === 'trip' || (code === 10 && !dns.length) ? [null] : dns;
    targets.forEach(d => {
      const row = base();
      const key = nextKey(tripId, keys);
      keys.push(key);
      put(row, 'key', key);
      put(row, 'recorder', who.recorder);
      put(row, 'event', ev.kh);
      put(row, 'plate', plate);
      put(row, 'driver', driver);
      put(row, 'round', round);
      put(row, 'user', who.email);
      put(row, 'date', new Date(at.getFullYear(), at.getMonth(), at.getDate()));
      put(row, 'time', at);
      put(row, 'latlong', String(p.latlong || '').slice(0, 40));
      put(row, 'tripText', tripId);
      put(row, 'trip', tripId);
      put(row, 'remark', String(p.remark || '').slice(0, 500));
      if (code === 6) {
        put(row, 'wh', String(p.wh || ''));
        put(row, 'websling', p.websling === true ? 'ប្រើ' : p.websling === false ? 'មិនប្រើ' : '');
      }
      if (code === 6 && p.kg) put(row, 'kg', Number(p.kg) || '');
      if (code === 1 && photoUrl) put(row, 'truckPhoto', photoUrl);
      if (code === 6 && photoUrl) put(row, 'goodsPhoto', photoUrl);
      if ((code === 9 || code === 11 || code === 8) && photoUrl) put(row, 'billPhoto', photoUrl);
      if (d) {
        const pl = plan[d.dn] || {};
        const custId = String(d.custId || pl.custId || '').trim(), custName = String(d.custName || pl.custName || '').trim();
        const known = st.dns[d.dn] && st.dns[d.dn].cust;
        put(row, 'dn', d.dn);
        put(row, 'so', String(d.so || pl.so || ''));
        put(row, 'cust', known || (custId && custName ? custId + '-' + custName : custName || custId));
        if (code === 9) {
          put(row, 'kg', Number(d.kg) || '');
          put(row, 'mode', d.final === false ? 'Partial' : 'Final');
        } else if (code === 2 && (d.kg || pl.kg)) put(row, 'kg', Number(d.kg || pl.kg) || '');
      }
      rowsOut.push(row);
    });
    const start = sh.getLastRow() + 1;
    if (start + rowsOut.length - 1 > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), rowsOut.length + 50);
    plateText_(sh, start, rowsOut.length, [C.plate]);
    sh.getRange(start, 1, rowsOut.length, C.width).setValues(rowsOut);

    // Trips tab: new row on Gate In; Gate Out Time and Trip Status kept up to date.
    const newRows = rowsOut.map((r, i) => parseRow_(r, start + i, C));
    const infoAfter = dnsInfo_(tripDns, dnRows.concat(newRows.filter(r => r.dn)), plan);
    const doneAfter = doneSet_(infoAfter);
    const after = tripState(tripRows.concat(newRows), doneAfter);
    if (code === 1) {
      const r = trips.getLastRow() + 1;
      plateText_(trips, r, 1, [2]);
      trips.getRange(r, 1, 1, TRIP_COLS.length).setValues([[tripId, new Date(at.getFullYear(), at.getMonth(), at.getDate()), plate, driver, round, at, '', STAGES[after.stage].kh]]);
    } else {
      const meta = idx[tripId];
      if (meta) {
        if (meta.status !== STAGES[after.stage].kh) trips.getRange(meta.row, 8).setValue(STAGES[after.stage].kh);
        if (code === 7 && !meta.gateOut) trips.getRange(meta.row, 7).setValue(at);
      }
    }
    // A DN delivered now may finish another trip that still carried part of it ("Delivered on another trip").
    if (code === 9) {
      const others = {};
      dnList.forEach(dn => (infoAfter[dn].openTrips || []).forEach(id => { if (id !== tripId && idx[id]) others[id] = 1; }));
      Object.keys(others).forEach(id => {
        const rows2 = rowsWhere_('trip', [id]);   // the new rows are already in the sheet
        const dns2 = Array.from(new Set(rows2.map(r => r.dn).filter(Boolean)));
        const st2 = tripState(rows2, doneSet_(dnsInfo_(dns2, rowsWhere_('dn', dns2), plan)));
        if (idx[id].status !== STAGES[st2.stage].kh) trips.getRange(idx[id].row, 8).setValue(STAGES[st2.stage].kh);
      });
    }
    // Extras (own tabs): proof of delivery, 3PL company of a rented truck, customer site from the first delivery.
    if (code === 9) {
      saveProof_(newRows, tripId, p.receiver, sigUrl, photoUrls, who.email);
      learnSites_(newRows.filter(r => r.latlong), who.email);
    }
    if (code === 1 && photoUrls.length > 1) saveProof_(newRows, tripId, '', '', photoUrls, who.email);
    if (code === 1 && !master_().plates.some(x => x.plate === plate)) rememberTruck_(plate, p.company, p.truckType, who.email, p.driver);
    const res = { ok: true, tripId: tripId, round: round, keys: newRows.map(r => r.key), stage: after.stage, time: at.getTime(), photo: photoUrl };
    if (code === 9) res.rate = newRows.map(r => ({ dn: r.dn, k: rateToken_(r.dn, tripId) }));
    if (ref) cache.put('ref_' + ref, JSON.stringify(res), 21600);
    return res;
  });
}

/**
 * Every field of the form is required except the remark (Kim, 12 Oct 2026). Photos and the signature are checked
 * on the phone only: a step kept on a full phone is sent without them rather than lost.
 */
function requiredFields_(code, p, dns, plate, plan) {
  const miss = (en, kh) => fail_('REQUIRED', en, kh);
  if (code === 1) {
    if (!String(p.driver || '').trim()) miss('Choose or type the driver.', 'សូមជ្រើស ឬវាយឈ្មោះតៃកុង។');
    if (!master_().plates.some(x => x.plate === plate) && !String(p.company || '').trim()) miss('Choose or type the transport company of this truck.', 'សូមជ្រើស ឬវាយក្រុមហ៊ុនដឹកជញ្ជូនរបស់ឡាននេះ។');
  }
  if (code === 2) dns.forEach(d => { if (!plan[d.dn] && !String(d.so || '').trim()) miss('Type the SO number of DN ' + d.dn + '.', 'សូមវាយលេខ SO របស់ DN ' + d.dn + '។'); });
  if (code === 6) {
    if (!String(p.wh || '').trim()) miss('Choose the warehouse.', 'សូមជ្រើសរើសឃ្លាំង។');
    if (!(Number(p.kg) > 0)) miss('Type the loaded weight (kg).', 'សូមវាយទំងន់ទំនិញ (kg)។');
    if (p.websling !== true && p.websling !== false) miss('Choose whether a websling was used.', 'សូមជ្រើស ប្រើ ឬមិនប្រើ Websling។');
  }
  if (code === 9) {
    dns.forEach(d => { if (!(Number(d.kg) > 0)) miss('Type the delivered weight (kg) of DN ' + d.dn + '.', 'សូមវាយទំងន់ដែលប្រគល់ (kg) របស់ DN ' + d.dn + '។'); });
    if (!String(p.receiver || '').trim()) miss('Type the receiver name.', 'សូមវាយឈ្មោះអ្នកទទួល។');
  }
}

const stageKey_ = kh => Object.keys(STAGES).find(k => STAGES[k].kh === kh) || 'waiting';
function columnValues_(sh, c) {
  const last = sh.getLastRow();
  if (c == null || last < 2) return [];
  return sh.getRange(2, c + 1, last - 1, 1).getValues().map(r => text_(r[0]));
}
/** Trips of this plate today that exist only in Time Log (made by AppSheet), so Trip Round keeps counting. */
function legacyRoundsToday_(plate, today, idx) {
  const rows = tailRows_(300).filter(r => r.code === 1 && r.plate === plate && ymd_(new Date(r.time)) === today && !idx[r.trip]);
  return rows.length;
}

/**
 * Event time: the server clock. If the phone saved the event while offline and sends it late (over 90 s),
 * the phone's own time is used instead, but never in the future and never more than 24 h back.
 */
function eventTime_(takenAt, now) {
  const t = Number(takenAt) || 0;
  if (t && now.getTime() - t > 90000 && now.getTime() - t < 86400000) return new Date(t);
  return now;
}

/**
 * Photos and signature of a step already saved (sent right after the step so saving feels instant).
 * p = { ref, tripId, code, keys, photos, signature }. The keys must be rows of that trip and step.
 * Drive uploads happen before the lock; the first photo goes in the Time Log photo column (only if empty),
 * the signature and all photos in Delivery Proof (the row of that Key No. is completed, or added).
 */
function attach_(p, user) {
  const code = Number(p.code);
  if (!EV[code]) fail_('BAD', 'Unknown event.');
  if (!canRecord(user.role, allowed_()[code])) fail_('DENIED', 'Your role cannot record this step.', 'តួនាទីរបស់អ្នកមិនអាចកត់ត្រាជំហាននេះទេ។');
  return attachPhotos_(p, user.email);
}
function attachPhotos_(p, email) {
  const code = Number(p.code), ev = EV[code];
  if (!ev) fail_('BAD', 'Unknown event.');
  const tripId = String(p.tripId || '').trim();
  const ref = String(p.ref || '').slice(0, 80);
  const cache = CacheService.getScriptCache();
  if (ref && cache.get('att_' + ref)) return JSON.parse(cache.get('att_' + ref));
  const keys = (p.keys || []).map(String).filter(Boolean).slice(0, 40);
  if (!tripId || !keys.length) fail_('BAD', 'Nothing to attach the photos to.', 'គ្មានការកត់ត្រាសម្រាប់ភ្ជាប់រូបថតទេ។');
  const rows = rowsWhere_('key', keys);
  if (rows.length !== keys.length || rows.some(r => r.trip !== tripId || r.code !== code)) fail_('NOTFOUND', 'That record was not found.', 'រកមិនឃើញការកត់ត្រានោះទេ។');
  const photos = (p.photos || (p.photo ? [p.photo] : [])).slice(0, MAX_PHOTOS);
  const photoUrls = photos.map((ph, i) => savePhoto_(ph, tripId + '_' + ev.key + (i ? '_' + (i + 1) : '')));
  const sigUrl = code === 9 && p.signature ? savePhoto_(p.signature, tripId + '_signature') : '';
  return withLock_(() => {
    const sh = sheet_(SH.LOG), C = logCols_();
    const f = code === 1 ? 'truckPhoto' : code === 6 ? 'goodsPhoto' : (code === 8 || code === 9 || code === 11) ? 'billPhoto' : '';
    if (photoUrls[0] && f && C[f] != null) {
      rows.forEach(r => { const cell = sh.getRange(r.row, C[f] + 1); if (!text_(cell.getValue())) cell.setValue(photoUrls[0]); });
    }
    if (sigUrl || photoUrls.length > 1 || (code === 9 && photoUrls.length)) proofUpdate_(rows, tripId, sigUrl, photoUrls, email);
    const res = { ok: true, photos: photoUrls.length, signature: !!sigUrl };
    if (ref) cache.put('att_' + ref, JSON.stringify(res), 21600);
    return res;
  });
}

function savePhoto_(dataUrl, name) {
  const m = String(dataUrl).match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/);
  if (!m) fail_('BAD', 'The photo could not be read. Please take it again.', 'មិនអាចអានរូបថតបានទេ។ សូមថតម្តងទៀត។');
  if (m[2].length > 2800000) fail_('BAD', 'The photo is too large.', 'រូបថតធំពេក។');
  const id = prop_('PHOTO_FOLDER_ID');
  if (!id) fail_('SETUP', 'Run setup() once in Apps Script (photo folder).');
  const ext = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' }[m[1]];
  const blob = Utilities.newBlob(Utilities.base64Decode(m[2]), m[1], name + '_' + fmt_(now_(), 'yyyyMMdd_HHmmss') + ext);
  const file = DriveApp.getFolderById(id).createFile(blob);
  return file.getUrl();
}

// ---------------------------------------------------------------- Delete an entry (Supervisor / Admin)
const DELETED_TAB = 'Deleted Records';
/**
 * p = { row, key, reason }. The row number and Key No. must both match. The whole row is first copied to the
 * "Deleted Records" tab (with who, when and why) and to the Audit Log, then removed from Time Log, so it can be put back.
 * The trip's line in Trips follows: new status, Gate In / Gate Out time cleared if that step is gone, removed if no step is left.
 */
function deleteEntry_(p, user) {
  const reason = String(p.reason || '').trim();
  if (reason.length < 3) fail_('BAD', 'Write the reason for deleting.', 'សូមសរសេរមូលហេតុនៃការលុប។');
  return withLock_(() => {
    const ss = ss_(), sh = sheet_(SH.LOG), C = logCols_();
    const rowNo = Number(p.row);
    if (!(rowNo >= 2 && rowNo <= sh.getLastRow())) fail_('NOTFOUND', 'That record was not found.', 'រកមិនឃើញការកត់ត្រានោះទេ។');
    const vals = sh.getRange(rowNo, 1, 1, C.width).getValues()[0];
    const r = parseRow_(vals, rowNo, C);
    if (r.key !== String(p.key)) fail_('CHANGED', 'The sheet changed. Please reload and try again.', 'សន្លឹកបានផ្លាស់ប្តូរ។ សូមផ្ទុកឡើងវិញ។');
    let del = ss.getSheetByName(DELETED_TAB);
    if (!del) {
      del = ss.insertSheet(DELETED_TAB);
      const head = sh.getRange(1, 1, 1, C.width).getValues()[0];
      del.getRange(1, 1, 1, head.length + 3).setValues([['Deleted Time', 'Deleted By', 'Reason'].concat(head)]).setFontWeight('bold');
      del.setFrozenRows(1);
    }
    const dr = del.getLastRow() + 1;
    plateText_(del, dr, 1, [3 + C.plate]);
    del.getRange(dr, 1, 1, vals.length + 3).setValues([[now_(), user.email, reason].concat(vals)]);
    audit_(user.email, 'Delete record', r.key, r.trip, 'Time Log row ' + rowNo, [r.eventText, r.dn, r.time ? fmt_(new Date(r.time), 'yyyy-MM-dd HH:mm') : ''].filter(Boolean).join(' · '), '', reason);
    sh.deleteRow(rowNo);
    const idx = tripsSheetIndex_(), meta = idx[r.trip];
    if (meta) {
      const trips = sheet_(SH.TRIPS);
      const rows = rowsWhere_('trip', [r.trip]);
      if (!rows.length) trips.deleteRow(meta.row);
      else {
        const dns = Array.from(new Set(rows.map(x => x.dn).filter(Boolean)));
        const st = tripState(rows, dns.length ? doneSet_(dnsInfo_(dns, rowsWhere_('dn', dns), plan_())) : {});
        if (meta.status !== STAGES[st.stage].kh) trips.getRange(meta.row, 8).setValue(STAGES[st.stage].kh);
        if (r.code === 1 && st.gateIn == null) trips.getRange(meta.row, 6).setValue('');
        if (r.code === 7 && st.gateOut == null) trips.getRange(meta.row, 7).setValue('');
      }
    }
    return { ok: true, tripLeft: !!(meta ? rowsWhere_('trip', [r.trip]).length : true) };
  });
}

// ---------------------------------------------------------------- Corrections (turned off 12 Oct 2026; kept for reference)
/** p = { row, key, time (ms), reason }. The row number and Key No. must both match, so a moved row is never edited. */
function correct_(p, user) {
  need_(user, 'supervisor');
  const reason = String(p.reason || '').trim();
  if (reason.length < 3) fail_('BAD', 'Write the reason for the correction.', 'សូមសរសេរមូលហេតុនៃការកែ។');
  const t = Number(p.time);
  if (!t || t > Date.now() + 5 * 60000) fail_('BAD', 'The new time is not valid.', 'ម៉ោងថ្មីមិនត្រឹមត្រូវ។');
  return withLock_(() => {
    const sh = sheet_(SH.LOG), C = logCols_();
    const rowNo = Number(p.row);
    if (!(rowNo >= 2 && rowNo <= sh.getLastRow())) fail_('NOTFOUND', 'That record was not found.');
    const r = parseRow_(sh.getRange(rowNo, 1, 1, C.width).getValues()[0], rowNo, C);
    if (r.key !== String(p.key)) fail_('CHANGED', 'The sheet changed. Please reload and try again.', 'សន្លឹកបានផ្លាស់ប្តូរ។ សូមផ្ទុកឡើងវិញ។');
    const d = new Date(t);
    const old = r.time ? fmt_(new Date(r.time), 'yyyy-MM-dd HH:mm:ss') : '';
    sh.getRange(rowNo, C.time + 1).setValue(d);
    if (C.date != null) sh.getRange(rowNo, C.date + 1).setValue(new Date(d.getFullYear(), d.getMonth(), d.getDate()));
    audit_(user.email, 'Correct time', r.key, r.trip, LOG_COLS.time, old, fmt_(d, 'yyyy-MM-dd HH:mm:ss'), reason);
    const idx = tripsSheetIndex_();
    const meta = idx[r.trip];
    if (meta && (r.code === 1 || r.code === 7)) {
      sheet_(SH.TRIPS).getRange(meta.row, r.code === 1 ? 6 : 7).setValue(d);
      audit_(user.email, 'Correct time', r.key, r.trip, r.code === 1 ? 'Trips > Gate In Time' : 'Trips > Gate Out Time', old, fmt_(d, 'yyyy-MM-dd HH:mm:ss'), reason);
    }
    return { ok: true };
  });
}

function audit_(email, action, key, trip, field, oldV, newV, reason) {
  sheet_(SH.AUDIT).appendRow([now_(), email, action, key, trip, field, oldV, newV, reason]);
}

// ---------------------------------------------------------------- Users (Admin)
const ROLES = ['Security', 'Logistics', 'Warehouse', 'Driver', 'Supervisor', 'Admin'];
function usersList_() { return { users: users_(), roles: ROLES }; }
function setUser_(p, user) {
  const email = String(p.email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fail_('BAD', 'Type a valid email.', 'សូមវាយអ៊ីមែលត្រឹមត្រូវ។');
  const role = String(p.role || '').trim();
  if (role && ROLES.indexOf(role) < 0 && role !== 'LT') fail_('BAD', 'Unknown role.');
  if (email === user.email && role !== 'Admin') fail_('BAD', 'You cannot remove your own Admin role.', 'អ្នកមិនអាចដកតួនាទី Admin ពីខ្លួនឯងបានទេ។');
  return withLock_(() => {
    const fuel = usersSheet_();
    if (fuel) return setFuelUser_(fuel, email, role, p.name, user);
    const sh = sheet_(SH.USERS);
    const t = table_(SH.USERS);
    const e = col_(t.head, 'EMAIL'), n = col_(t.head, 'NAME'), r = col_(t.head, 'ROLE'), uid = col_(t.head, 'UID');
    const i = t.rows.findIndex(x => String(x[e]).trim().toLowerCase() === email);
    if (i >= 0) {
      const old = text_(t.rows[i][r]);
      sh.getRange(i + 2, r + 1).setValue(role);
      if (p.name != null && n >= 0) sh.getRange(i + 2, n + 1).setValue(String(p.name).trim());
      audit_(user.email, 'User role', '', '', email, old, role, 'Users screen');
    } else {
      const row = new Array(t.head.length).fill('');
      const next = t.rows.reduce((m, x) => Math.max(m, Number(x[uid]) || 0), 0) + 1;
      if (uid >= 0) row[uid] = next;
      row[e] = email; if (n >= 0) row[n] = String(p.name || '').trim(); row[r] = role;
      sh.getRange(sh.getLastRow() + 1, 1, 1, row.length).setValues([row]);
      audit_(user.email, 'User added', '', '', email, '', role, 'Users screen');
    }
    CacheService.getScriptCache().remove('users_v2');
    return usersList_();
  });
}

/** Users screen with the shared list: sets the one Role column; a new person gets Active = Yes and ដឹកជញ្ជូន ticked. */
function setFuelUser_(sh, email, role, name, user) {
  const t = tableOf_(sh);
  const c = n => t.head.indexOf(n);
  const e = c('Email'), rc = c('Role');
  if (rc < 0) fail_('SETUP', 'The Users tab has no Role column.');
  const value = role ? role.toLowerCase() : 'user';
  const i = t.rows.findIndex(x => String(x[e]).trim().toLowerCase() === email);
  if (i >= 0) {
    const old = text_(t.rows[i][rc]);
    sh.getRange(i + 2, rc + 1).setValue(value);
    if (c(TRANSPORT_COL) >= 0 && role && !yes_(t.rows[i][c(TRANSPORT_COL)])) sh.getRange(i + 2, c(TRANSPORT_COL) + 1).setValue(true);
    audit_(user.email, 'User role', '', '', email, old, value, 'Users screen');
  } else {
    const row = new Array(t.head.length).fill('');
    row[e] = email; row[rc] = value;
    if (c('Name') >= 0) row[c('Name')] = String(name || '').trim();
    if (c('Active') >= 0) row[c('Active')] = 'Yes';
    if (c(TRANSPORT_COL) >= 0) row[c(TRANSPORT_COL)] = true;
    sh.getRange(sh.getLastRow() + 1, 1, 1, row.length).setValues([row]);
    audit_(user.email, 'User added', '', '', email, '', value, 'Users screen');
  }
  CacheService.getScriptCache().remove('users_v2');
  return usersList_();
}

// ---------------------------------------------------------------- Data quality report (read only: nothing is fixed automatically)
function quality_() {
  const rows = tailRows_(OPS_ROWS);
  const groups = groupTrips_(rows);
  const issues = [];
  const add = (type, trip, en, kh) => issues.push({ type: type, trip: trip, en: en, kh: kh });
  Object.keys(groups).forEach(id => {
    const rs = groups[id].slice().sort((a, b) => a.row - b.row);
    const st = tripState(rs);
    if (st.gateIn == null) add('NO_GATE_IN', id, 'No Gate In record.', 'គ្មានការកត់ត្រា ចូលថ្លឹង។');
    const plates = Array.from(new Set(rs.map(r => r.plate).filter(Boolean)));
    if (plates.length > 1) add('PLATES', id, 'More than one truck on one trip: ' + plates.join(', ') + '.', 'ឡានច្រើនជាងមួយនៅលើជើងដឹកតែមួយ: ' + plates.join(', ') + '។');
    const t = {};
    rs.forEach(r => { if (r.code && t[r.code] == null) t[r.code] = r.time; });
    for (let a = 1; a <= 7; a++) for (let b = a + 1; b <= 7; b++) {
      if (t[a] && t[b] && t[b] < t[a]) { add('ORDER', id, EV[b].en + ' is earlier than ' + EV[a].en + '.', EV[b].kh + ' មុនម៉ោង ' + EV[a].kh + '។'); a = 8; break; }
    }
    rs.forEach((r, i) => {
      const prev = rs.slice(0, i).find(x => x.code === r.code && x.dn === r.dn && Math.abs(x.time - r.time) < DUPLICATE_MINUTES * 60000);
      if (prev && r.code) add('REPEAT', id, EV[r.code].en + ' recorded twice within ' + DUPLICATE_MINUTES + ' minutes (' + prev.key + ', ' + r.key + ').', EV[r.code].kh + ' កត់ត្រាពីរដងក្នុង ' + DUPLICATE_MINUTES + ' នាទី។');
    });
    rs.filter(r => (r.code === 9 || r.code === 8) && r.dn && !rs.some(x => x.code === 2 && x.dn === r.dn)).forEach(r => add('NO_PICKUP', id, 'DN ' + r.dn + ' has ' + EV[r.code].en + ' but no Arrival-Pickup DN.', 'DN ' + r.dn + ' មាន ' + EV[r.code].kh + ' ប៉ុន្តែគ្មាន ដល់កន្លែងចែកបុង។'));
    if (!st.closed && st.last && Date.now() - st.last.time > 2 * 86400000 && st.dnList.length) add('STALE', id, 'Still open after 2 days (' + st.openDns.join(', ') + ').', 'នៅបើកលើសពី 2 ថ្ងៃ (' + st.openDns.join(', ') + ')។');
  });
  const far = farRows_(rows);
  rows.filter(r => far[r.row]).forEach(r => add('FAR', r.trip, EV[r.code].en + ' for DN ' + r.dn + ' was recorded ' + far[r.row] + ' km from the customer site.', EV[r.code].kh + ' DN ' + r.dn + ' កត់ត្រាឆ្ងាយពីទីតាំងអតិថិជន ' + far[r.row] + ' គ.ម។'));
  return { issues: issues.slice(0, 500), total: issues.length, checkedRows: rows.length };
}

// ---------------------------------------------------------------- Driver trip links (no sign-in)
function linkSecret_() { const s = prop_('LINK_SECRET'); if (!s) fail_('SETUP', 'Run setup() once in Apps Script.'); return s; }
function driverLinkToken_(tripId) { return b64url_(Utilities.computeHmacSha256Signature('drv|' + tripId, linkSecret_())).slice(0, 22); }
function checkDriverLink_(p, allowClosed) {
  const tripId = String(p.t || '').trim();
  if (!tripId || String(p.k || '') !== driverLinkToken_(tripId)) fail_('LINK', 'This link is not valid.', 'តំណនេះមិនត្រឹមត្រូវ។');
  let rows = rowsWhere_('trip', [tripId]);
  if (!rows.length) fail_('LINK', 'This trip was not found.', 'រកមិនឃើញជើងដឹកនេះ។');
  const dns = Array.from(new Set(rows.map(r => r.dn).filter(Boolean)));
  const done = dns.length ? doneSet_(dnsInfo_(dns, rowsWhere_('dn', dns), plan_())) : {};
  const st = tripState(rows, done);
  if (st.closed && !allowClosed) fail_('LINK_CLOSED', 'This trip is finished. Thank you!', 'ជើងដឹកនេះបានបញ្ចប់ហើយ។ សូមអរគុណ!');
  if (st.gateIn && Date.now() - st.gateIn > DRIVER_LINK_DAYS * 86400000) fail_('LINK', 'This link has expired.', 'តំណនេះផុតកំណត់ហើយ។');
  return { tripId: tripId, rows: rows, st: st, done: done };
}
function driverTrip_(p) {
  const c = checkDriverLink_(p, true);   // a finished trip still opens (rating QR, site rating), but records nothing
  const idx = tripsSheetIndex_();
  const s = tripSummary_(c.tripId, c.rows, idx, c.done);
  const rated = {};
  xrows_(XT.SRATE).forEach(r => { if (String(r['Trip ID']) === c.tripId) rated[normDn(r.DN)] = 1; });
  return { trip: { id: s.id, plate: s.plate, driver: s.driver, round: s.round, stage: s.stage, gateOut: s.gateOut, closed: s.closed, dns: s.dns }, stages: STAGES, legs: LEG,
    rate: rateLinks_(c.tripId, c.rows), siteRated: Object.keys(rated) };
}
function driverRecord_(p) {
  const c = checkDriverLink_(p);
  const code = Number(p.code);
  if ([8, 9, 11].indexOf(code) < 0) fail_('DENIED', 'This link can record only Arrival, Delivered or Delivery Failed.', 'តំណនេះកត់ត្រាបានតែ មកដល់ ប្រគល់ ឬ ប្រគល់មិនបាន។');
  const isi = master_().plates.some(x => x.plate === normPlate(c.rows[0].plate));
  const plan = plan_();
  const fleet = (p.dns || []).map(d => (plan[normDn(d.dn)] || {}).fleet).filter(Boolean)[0] || '';
  const type = isi ? 'isi' : /អតិថិជន/.test(fleet) ? 'customer' : 'rented';
  const allowed = allowed_();
  return saveEvent_(Object.assign({}, p, { tripId: c.tripId, plate: '' }), { email: 'driver-link', recorder: truckLabel_(type, String(allowed[code] || '').split('|').map(s => s.trim())) });
}

/** Customer rating links (DN → key) for the DNs delivered on this trip. */
function rateLinks_(tripId, rows) {
  const out = {};
  rows.forEach(r => { if (r.code === 9 && r.dn) out[r.dn] = rateToken_(r.dn, tripId); });
  return out;
}
