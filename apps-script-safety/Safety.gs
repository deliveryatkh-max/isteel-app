/**
 * Safety Walk & 5S (ដើរត្រួតពិនិត្យសុវត្ថិភាព) — Google Apps Script backend for isteel-app.pages.dev/safety/.
 *
 * Bound to the "SSK-SAFETY-WALK" Google Sheet (Extensions > Apps Script inside that sheet). It keeps:
 *   - "Walks" tab: one row per finished walk / audit / check (score, Yes / No / N/A counts)
 *   - "Answers" tab: one row per question answered, for pivots (which questions fail most)
 *   - "Actions" tab: one row per "No" answer: problem photo, owner, due date, Done (after photo), Closed
 *   - "Areas", "Checklists", "SW Settings" tabs: edited by admins from the app's Settings screen
 *   - Drive folder "Safety Walk Photos" (one sub-folder per month) and the walk PDFs.
 * Flow: walker picks area + checklist -> answers Yes / No / N/A -> each No = an action with photo, owner and due date
 *   -> a critical No posts to Telegram at once -> the owner marks it Done with an after photo -> the walker
 *   (or a reviewer / safety officer) closes it. Overdue list on Telegram every morning, summary every Monday.
 *
 * Script Properties (Project Settings > Script properties):
 *   GOOGLE_CLIENT_ID   same Client ID as the other iSteel apps (web/config.js)
 *   SESSION_SECRET     copy of the Fuel app's SESSION_SECRET, so one sign-in works in every app
 *   USERS_SHEET_ID     id of the Fuel Refill Google Sheet: its "Users" tab is the one user list (tick box សុវត្ថិភាព)
 *   TELEGRAM_BOT_TOKEN optional: copy of the Fuel app's bot token; the group's chat id goes in SW Settings
 *   SW_FOLDER_ID       made by setup(); Drive folder "Safety Walk Photos"
 */

const SH = { WALK: 'Walks', ANS: 'Answers', ACT: 'Actions', AREA: 'Areas', CHK: 'Checklists', SET: 'SW Settings' };
const WALK_COLS = ['Walk No', 'Client ID', 'Date', 'Site', 'Area', 'Checklist', 'Walker', 'Walker Email', 'Started', 'Finished',
  'Yes', 'No', 'N/A', 'Score %', 'Critical No', 'Actions', 'Note', 'PDF Link', 'Detail', 'Saved At'];
const ANS_COLS = ['Walk No', 'Date', 'Site', 'Area', 'Checklist', 'Q No', 'Question', 'Answer', 'Critical', 'Note', 'Action No'];
const ACT_COLS = ['Action No', 'Walk No', 'Raised', 'Site', 'Area', 'Checklist', 'Q No', 'Question', 'Critical', 'Problem Note', 'Photo',
  'Owner', 'Owner Email', 'Owner ID', 'Due', 'Status', 'Done At', 'Done By', 'Done Note', 'After Photo', 'Closed At', 'Closed By',
  'Raised By', 'Raised By Email', 'History', 'Updated'];
const AREA_COLS = ['Site', 'Area', 'Area Leader', 'Leader Email', 'Safety walk', '5S audit', 'Forklift check', 'Active', 'Note'];
const CHK_COLS = ['Checklist', 'No', 'Question (English)', 'Question (Khmer)', 'Critical', 'Photo on No', 'Active'];
const SET_COLS = ['Setting', 'Value', 'Note'];
const LISTS = [
  { name: 'Safety walk', km: 'ដើរត្រួតពិនិត្យសុវត្ថិភាព', icon: '🦺' },
  { name: '5S audit', km: 'ត្រួតពិនិត្យ 5S', icon: '🧹' },
  { name: 'Forklift check', km: 'ត្រួតពិនិត្យហ្វកលីប', icon: '🚜' },
];
const FREQ_DAYS = { daily: 1, weekly: 7, monthly: 31 };
const APP_COL = 'សុវត្ថិភាព';     // tick box column in the Users list (added by the Fuel script's HOME_APPS)
const DEFAULTS_URL = 'https://isteel-app.pages.dev/safety/defaults.json';
const LOGO_URL = 'https://isteel-app.pages.dev/icons/isi-steel-logo.png';
const MAX_PHOTOS = 3;                       // per No answer
const MAX_PHOTO_BYTES = 3 * 1024 * 1024;
const ST = { open: 'Open', done: 'Done', closed: 'Closed' };

// ---------------------------------------------------------------- web entry points
function doGet() { return json_({ ok: true, app: 'Safety Walk & 5S' }); }

function doPost(e) {
  setMemo_ = null;
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
    case 'walk': return walk_(p, user);
    case 'submit': return withLock_(() => submit_(p, user));
    case 'photo': return photo_(p, user);
    case 'actionDone': return withLock_(() => actionDone_(p, user));
    case 'actionClose': return withLock_(() => actionClose_(p, user));
    case 'actionReopen': return withLock_(() => actionReopen_(p, user));
    case 'actionEdit': return withLock_(() => actionEdit_(p, user));
    case 'pdf': return pdf_(p, user);
    case 'settings': return settings_(user);
    case 'saveSettings': return withLock_(() => saveSettings_(p, user));
    case 'testTelegram': return testTelegram_(user);
    default: fail_('BAD', 'Unknown action');
  }
}

// ---------------------------------------------------------------- small helpers
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function fail_(code, en, kh) { throw new Error(code + ': ' + en + (kh ? ' || ' + kh : '')); }
const prop_ = k => PropertiesService.getScriptProperties().getProperty(k) || '';
const TZ = 'Asia/Phnom_Penh';
const fmt_ = (d, f) => Utilities.formatDate(d, TZ, f);
const now_ = () => fmt_(new Date(), 'yyyy-MM-dd HH:mm');
const today_ = () => fmt_(new Date(), 'yyyy-MM-dd');
const text_ = v => (v == null ? '' : v instanceof Date ? fmt_(v, 'yyyy-MM-dd HH:mm') : String(v).trim());
const yes_ = v => v === true || /^(yes|true|y|1|✓)$/i.test(String(v).trim());
const clip_ = (v, n) => String(v == null ? '' : v).trim().slice(0, n || 500);
const ss_ = () => SpreadsheetApp.getActive();
const esc_ = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const addDays_ = (ymd, n) => { const d = new Date(ymd + 'T12:00:00'); d.setDate(d.getDate() + n); return fmt_(d, 'yyyy-MM-dd'); };
const daysBetween_ = (a, b) => Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 86400000);
const areaKey_ = (site, area) => String(site || '').trim().toLowerCase() + '|' + String(area || '').trim().toLowerCase();
const score_ = (y, n) => (y + n ? Math.round(100 * y / (y + n)) : '');

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
    sh.getRange(1, 1, sh.getMaxRows(), cols.length).setNumberFormat('@');   // plain text: dates and IDs stay as typed
    if (seed && seed.length) sh.getRange(2, 1, seed.length, cols.length).setValues(seed);
  } else if (sh.getLastColumn() < cols.length && sh.getRange(1, 1).getValue() === cols[0]) {
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
  return t.rows.map((r, i) => { const o = { _row: i + 2 }; t.head.forEach((h, j) => { o[h] = String(r[j] == null ? '' : r[j]).trim(); }); return o; });
}
function rewrite_(name, cols, rows) {
  const sh = sheet_(name, cols);
  const last = sh.getLastRow();
  if (last > 1) sh.getRange(2, 1, last - 1, cols.length).clearContent();
  if (rows.length) sh.getRange(2, 1, rows.length, cols.length).setNumberFormat('@').setValues(rows);
}
/** Writes some columns of one row (by header name). */
function setCells_(name, cols, row, values) {
  const sh = sheet_(name, cols);
  const head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(h => String(h).trim());
  Object.keys(values).forEach(k => { const c = head.indexOf(k); if (c >= 0) sh.getRange(row, c + 1).setNumberFormat('@').setValue(values[k]); });
}

// ---------------------------------------------------------------- setup (run once from the editor)
/** Adds the tabs (with the starting checklists and areas), the Drive folder and the morning / Monday triggers. Safe to run again. */
function setup() {
  let def = { questions: [], areas: [] };
  try { def = JSON.parse(UrlFetchApp.fetch(DEFAULTS_URL, { muteHttpExceptions: true }).getContentText()); } catch (e) { console.warn('defaults.json: ' + e); }
  sheet_(SH.WALK, WALK_COLS);
  sheet_(SH.ACT, ACT_COLS);
  sheet_(SH.ANS, ANS_COLS);
  sheet_(SH.AREA, AREA_COLS, (def.areas || []).map(a => [a[0], a[1], a[2] || '', '', a[3] || '', a[4] || '', a[5] || '', 'Yes', '']));
  sheet_(SH.CHK, CHK_COLS, (def.questions || []).map(q => [q[0], String(q[1]), q[2], q[3], q[4] ? 'Y' : 'N', q[5] === false ? 'N' : 'Y', 'Y']));
  sheet_(SH.SET, SET_COLS, [
    ['NUMBER_PREFIX', 'SW', 'Walk number = prefix-yymmdd-number, e.g. SW-261104-01'],
    ['TELEGRAM_CHAT_ID', '', 'Telegram group "ISI Safety" (add the bot to the group). Empty = no Telegram posts.'],
    ['APP_URL', 'https://isteel-app.pages.dev/safety/', 'Address of the app, used in Telegram buttons'],
    ['DUE_DAYS', '7', 'Days to fix a normal "No"'],
    ['CRITICAL_HOURS', '24', 'Hours to fix a critical "No" (also posted to Telegram at once)'],
    ['DAILY_OVERDUE', 'Yes', 'Yes = overdue actions and late areas are posted to Telegram every morning at 08:00'],
    ['WEEKLY_SUMMARY', 'Yes', 'Yes = the week\'s scores are posted to Telegram every Monday at 08:00'],
  ]);
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('SW_FOLDER_ID')) props.setProperty('SW_FOLDER_ID', DriveApp.createFolder('Safety Walk Photos').getId());
  const first = ss_().getSheets()[0];
  if (first && Object.keys(SH).map(k => SH[k]).indexOf(first.getName()) < 0 && first.getLastRow() === 0) ss_().deleteSheet(first);   // the empty "Sheet1"
  // Telegram: overdue list every morning, summary every Monday (Asia/Phnom_Penh, set in appsscript.json).
  ScriptApp.getProjectTriggers().filter(t => ['dailyOverdue', 'weeklySummary'].indexOf(t.getHandlerFunction()) >= 0).forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('dailyOverdue').timeBased().everyDays(1).atHour(8).create();
  ScriptApp.newTrigger('weeklySummary').timeBased().onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(8).create();
  const notes = [];
  ['GOOGLE_CLIENT_ID', 'SESSION_SECRET', 'USERS_SHEET_ID'].forEach(k => { if (!prop_(k)) notes.push('Add ' + k + ' in Script properties.'); });
  if (!prop_('TELEGRAM_BOT_TOKEN')) notes.push('Optional: add TELEGRAM_BOT_TOKEN (copy from the Fuel app) for Telegram posts.');
  if (!(def.questions || []).length) notes.push('Could not load the starting checklists: fill the Checklists tab by hand or run setup() again.');
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
  const u = usersCached_().find(x => x.email === email && x.active);
  // The Safety tick box opens the app; an action owner without the tick can still open it to mark their actions done.
  const owner = !!u && !u.ok && ownersCached_().indexOf(email) >= 0;
  if (!u || !(u.ok || owner)) fail_('NOACCESS', email + ' has no Safety Walk access. Ask the admin to tick ' + APP_COL + ' in Users.',
    email + ' មិនទាន់មានសិទ្ធិប្រើ ' + APP_COL + ' ទេ។ សូមស្នើអ្នកគ្រប់គ្រងធីក ' + APP_COL + ' ក្នុង Users។');
  return { email: email, name: u.name || email, empId: u.empId || '', admin: u.admin, reviewer: u.reviewer, ownerOnly: owner, session: session };
}

/** The one user list: the Users tab of the Fuel Refill sheet (a copy of SSK_OT_DATA "Employee & Approver"). */
function users_() {
  const id = prop_('USERS_SHEET_ID');
  if (!id) fail_('SETUP', 'USERS_SHEET_ID is missing in Script properties.');
  const sh = SpreadsheetApp.openById(id).getSheetByName('Users');
  if (!sh || sh.getLastRow() < 2) return [];
  const v = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues();
  const head = v[0].map(h => String(h).trim());
  const c = n => head.indexOf(n);
  const e = c('Email'), n = c('Name'), r = c('Role'), a = c('Active'), tick = c(APP_COL), emp = c('Employee ID');
  return v.slice(1).filter(x => x[e]).map(x => {
    const role = r >= 0 ? text_(x[r]) : '';
    const admin = /admin/i.test(role);
    const active = a < 0 || yes_(x[a]);
    return { email: String(x[e]).trim().toLowerCase(), name: n >= 0 ? text_(x[n]) : '', empId: emp >= 0 ? text_(x[emp]).replace(/\.0+$/, '') : '',
      admin: admin, reviewer: admin || /review|supervis|safety/i.test(role), active: active, ok: active && (admin || (tick >= 0 && yes_(x[tick]))) };
  });
}
function usersCached_() {
  const cache = CacheService.getScriptCache();
  const hit = cache.get('sw_users');
  if (hit) return JSON.parse(hit);
  const u = users_();
  try { cache.put('sw_users', JSON.stringify(u), 60); } catch (e) { /* too big: read each time */ }
  return u;
}
/** Emails that own an action that is not closed yet. */
function ownersCached_() {
  const cache = CacheService.getScriptCache();
  const hit = cache.get('sw_owners');
  if (hit) return JSON.parse(hit);
  const o = {};
  objs_(SH.ACT, ACT_COLS).forEach(a => { if (a['Owner Email'] && a.Status !== ST.closed) o[a['Owner Email'].toLowerCase()] = 1; });
  const list = Object.keys(o);
  try { cache.put('sw_owners', JSON.stringify(list), 120); } catch (e) { /* ignore */ }
  return list;
}

// ---------------------------------------------------------------- settings, areas and checklists
let setMemo_ = null;
function setting_(k) {
  if (!setMemo_) { setMemo_ = {}; objs_(SH.SET, SET_COLS).forEach(o => { if (o.Setting && !(o.Setting in setMemo_)) setMemo_[o.Setting] = o.Value; }); }
  return setMemo_[k] || '';
}
function setSetting_(k, v, note) {
  const rows = objs_(SH.SET, SET_COLS);
  const r = rows.find(o => o.Setting === k);
  if (r) setCells_(SH.SET, SET_COLS, r._row, { Value: String(v) });
  else sheet_(SH.SET, SET_COLS).appendRow([k, String(v), note || '']);
  setMemo_ = null;
}
const dueDays_ = () => Math.max(1, Number(setting_('DUE_DAYS')) || 7);
const critHours_ = () => Math.max(1, Number(setting_('CRITICAL_HOURS')) || 24);

function areas_() {
  return objs_(SH.AREA, AREA_COLS).filter(o => o.Area && (o.Active === '' || yes_(o.Active))).map(o => {
    const freq = {};
    LISTS.forEach(l => { if (o[l.name]) freq[l.name] = o[l.name]; });
    return { site: o.Site, area: o.Area, leader: o['Area Leader'], leaderEmail: (o['Leader Email'] || '').toLowerCase(), freq: freq, note: o.Note };
  });
}
function questions_() {
  const out = {};
  objs_(SH.CHK, CHK_COLS).filter(o => o.Checklist && (o['Question (English)'] || o['Question (Khmer)']) && (o.Active === '' || yes_(o.Active))).forEach(o => {
    (out[o.Checklist] = out[o.Checklist] || []).push({ no: o.No, en: o['Question (English)'], km: o['Question (Khmer)'] || o['Question (English)'],
      critical: yes_(o.Critical), photo: o['Photo on No'] === '' || yes_(o['Photo on No']) });
  });
  return out;
}
function lists_(qs) {
  const names = Object.keys(qs);
  const known = LISTS.filter(l => names.indexOf(l.name) >= 0);
  return known.concat(names.filter(n => !LISTS.some(l => l.name === n)).map(n => ({ name: n, km: n, icon: '📋' })))
    .map(l => Object.assign({ n: qs[l.name].length }, l));
}
/** The person in the Users list a typed leader / owner points to (email, Employee ID or name). */
function person_(s) {
  s = String(s || '').trim().toLowerCase();
  if (!s) return null;
  const u = usersCached_();
  return u.find(x => x.email === s) || u.find(x => x.empId && x.empId === s) || u.find(x => x.name && x.name.toLowerCase() === s) || null;
}

// ---------------------------------------------------------------- what each person sees
const seesAll_ = u => u.admin || u.reviewer;
function walkRows_() { return objs_(SH.WALK, WALK_COLS).filter(w => w['Walk No']); }
function actionRows_() { return objs_(SH.ACT, ACT_COLS).filter(a => a['Action No']); }
function leaderOf_(areas, u) { return areas.filter(a => a.leaderEmail && a.leaderEmail === u.email).map(a => areaKey_(a.site, a.area)); }

function walkView_(w, u) {
  return { id: w['Walk No'], date: w.Date, site: w.Site, area: w.Area, list: w.Checklist, walker: w.Walker, yes: +w.Yes || 0, no: +w.No || 0,
    na: +w['N/A'] || 0, score: w['Score %'] === '' ? null : +w['Score %'], crit: +w['Critical No'] || 0, actions: +w.Actions || 0,
    mine: w['Walker Email'] === u.email, pdf: !!w['PDF Link'] };
}
function actionView_(a, u, leads) {
  const raiser = a['Raised By Email'] === u.email, owner = a['Owner Email'] && a['Owner Email'] === u.email;
  const leader = leads.indexOf(areaKey_(a.Site, a.Area)) >= 0, boss = seesAll_(u);
  return { id: a['Action No'], walk: a['Walk No'], raised: a.Raised, site: a.Site, area: a.Area, list: a.Checklist, q: a['Q No'], question: a.Question,
    critical: yes_(a.Critical), note: a['Problem Note'], photos: ids_(a.Photo), owner: a.Owner, ownerEmail: a['Owner Email'], ownerId: a['Owner ID'],
    due: a.Due, status: a.Status || ST.open, doneAt: a['Done At'], doneBy: a['Done By'], doneNote: a['Done Note'], after: ids_(a['After Photo']),
    closedAt: a['Closed At'], closedBy: a['Closed By'], raisedBy: a['Raised By'], mine: !!owner,
    can: { done: a.Status === ST.open && (owner || raiser || leader || boss), close: a.Status === ST.done && (raiser || boss),
      reopen: a.Status !== ST.open && (raiser || boss), edit: a.Status !== ST.closed && (raiser || leader || boss) } };
}
const ids_ = v => String(v || '').split(/[\s,]+/).filter(Boolean);
function canSeeAction_(a, u, leads) {
  return seesAll_(u) || a['Owner Email'] === u.email || a['Raised By Email'] === u.email || leads.indexOf(areaKey_(a.Site, a.Area)) >= 0;
}
function canSeeWalk_(w, u, leads) { return seesAll_(u) || w['Walker Email'] === u.email || leads.indexOf(areaKey_(w.Site, w.Area)) >= 0; }

function boot_(user) {
  const qs = questions_(), areas = areas_(), walks = walkRows_(), acts = actionRows_();
  const leads = leaderOf_(areas, user), today = today_();
  // last walk per area and checklist, for "late" areas
  const last = {};
  walks.forEach(w => { const k = areaKey_(w.Site, w.Area) + '|' + w.Checklist; if (!last[k] || w.Date > last[k]) last[k] = w.Date; });
  const areaOut = areas.map(a => {
    const o = { site: a.site, area: a.area, leader: a.leader, freq: a.freq, last: {}, late: [], due: [] };
    Object.keys(a.freq).forEach(l => {
      const days = FREQ_DAYS[String(a.freq[l]).toLowerCase()];
      const d = last[areaKey_(a.site, a.area) + '|' + l] || '';
      o.last[l] = d;
      if (!days) return;
      const gap = d ? daysBetween_(d, today) : 9999;
      if (gap > days) o.late.push(l); else if (gap === days) o.due.push(l);
    });
    return o;
  });
  const cutoff = addDays_(today, -120);
  const myWalks = walks.filter(w => canSeeWalk_(w, user, leads) && w.Date >= cutoff).reverse().slice(0, 300).map(w => walkView_(w, user));
  const closedCut = addDays_(today, -60);
  const myActs = acts.filter(a => canSeeAction_(a, user, leads) && (a.Status !== ST.closed || (a['Closed At'] || '').slice(0, 10) >= closedCut))
    .reverse().map(a => actionView_(a, user, leads));
  const people = usersCached_().filter(x => x.active && x.name).map(x => ({ n: x.name, e: x.email, id: x.empId }));
  return {
    user: { email: user.email, name: user.name, admin: user.admin, reviewer: user.reviewer, ownerOnly: user.ownerOnly, leaderOf: leads },
    today: today, lists: lists_(qs), questions: qs, areas: areaOut, people: people, walks: myWalks, actions: myActs,
    settings: { dueDays: dueDays_(), criticalHours: critHours_() },
  };
}

function walk_(p, user) {
  const w = walkRows_().find(x => x['Walk No'] === p.id) || fail_('BAD', 'Walk not found.', 'រកមិនឃើញការត្រួតពិនិត្យនេះទេ។');
  const leads = leaderOf_(areas_(), user);
  if (!canSeeWalk_(w, user, leads)) fail_('NOACCESS', 'You cannot open this walk.', 'អ្នកមិនអាចបើកការត្រួតពិនិត្យនេះទេ។');
  let detail = {};
  try { detail = JSON.parse(w.Detail || '{}'); } catch (e) { detail = {}; }
  const acts = actionRows_().filter(a => a['Walk No'] === w['Walk No']).map(a => actionView_(a, user, leads));
  return Object.assign(walkView_(w, user), { started: w.Started, finished: w.Finished, note: w.Note, walkerEmail: w['Walker Email'], answers: detail.a || [], actionList: acts });
}

// ---------------------------------------------------------------- photos (Drive)
function root_() { return DriveApp.getFolderById(prop_('SW_FOLDER_ID') || fail_('SETUP', 'Run setup() first.')); }
function monthFolder_() {
  const name = fmt_(new Date(), 'yyyy-MM');
  const root = root_(), it = root.getFoldersByName(name);
  return it.hasNext() ? it.next() : root.createFolder(name);
}
function saveImage_(folder, dataUrl, name) {
  const m = String(dataUrl || '').match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/);
  if (!m) return '';
  const bytes = Utilities.base64Decode(m[2]);
  if (bytes.length > MAX_PHOTO_BYTES) fail_('BAD', 'Photo is too big.', 'រូបថតធំពេក។');
  return folder.createFile(Utilities.newBlob(bytes, m[1], name + (m[1] === 'image/png' ? '.png' : '.jpg'))).getId();
}
function photo_(p, user) {
  const id = String(p.id || '');
  const leads = leaderOf_(areas_(), user);
  const ok = actionRows_().some(a => (ids_(a.Photo).indexOf(id) >= 0 || ids_(a['After Photo']).indexOf(id) >= 0) && canSeeAction_(a, user, leads));
  if (!ok) fail_('NOACCESS', 'Photo not found.', 'រកមិនឃើញរូបថត។');
  const cache = CacheService.getScriptCache(), hit = cache.get('swp_' + id);
  if (hit) return { data: hit };
  const b = DriveApp.getFileById(id).getBlob();
  const data = 'data:' + (b.getContentType() || 'image/jpeg') + ';base64,' + Utilities.base64Encode(b.getBytes());
  try { if (data.length < 95000) cache.put('swp_' + id, data, 21600); } catch (e) { /* too big for the cache */ }
  return { data: data };
}

// ---------------------------------------------------------------- saving a walk
function nextWalkNo_(walks) {
  const prefix = (setting_('NUMBER_PREFIX') || 'SW') + '-' + fmt_(new Date(), 'yyMMdd') + '-';
  let n = 0;
  walks.forEach(w => { if (w['Walk No'].indexOf(prefix) === 0) n = Math.max(n, Number(w['Walk No'].slice(prefix.length)) || 0); });
  return prefix + String(n + 1).padStart(2, '0');
}

/**
 * p = { clientId, site, area, list, date, started, note, answers: [{ no, q, a: 'Yes'|'No'|'N/A', note, photos: [dataUrl], owner: { n, e, id }, due }] }
 * The phone sends a walk once it is finished (or later, from its offline queue): the same clientId is saved once only.
 */
function submit_(p, user) {
  const walks = walkRows_();
  const clientId = clip_(p.clientId, 60);
  const dup = clientId && walks.find(w => w['Client ID'] === clientId);
  if (dup) return { id: dup['Walk No'], again: true };
  const qs = questions_();
  const list = clip_(p.list, 60);
  const site = clip_(p.site, 60), area = clip_(p.area, 100);
  if (!list || !area) fail_('BAD', 'Pick the area and the checklist.', 'សូមជ្រើសតំបន់ និងបញ្ជីត្រួតពិនិត្យ។');
  const date = DATE_RE.test(p.date) ? p.date : today_();
  const sheetQs = qs[list] || [];
  const answers = (p.answers || []).slice(0, 80).map(x => {
    const q = sheetQs.find(s => String(s.no) === String(x.no)) || {};
    const a = { no: clip_(x.no, 10), q: clip_(x.q || q.en, 300), km: clip_(x.km || q.km, 300), a: ['Yes', 'No', 'N/A'].indexOf(x.a) >= 0 ? x.a : '',
      critical: q.critical !== undefined ? q.critical : !!x.critical, photoReq: q.photo !== undefined ? q.photo : true, note: clip_(x.note, 500) };
    if (a.a === 'No') {
      a.photos = (x.photos || []).slice(0, MAX_PHOTOS);
      a.owner = { n: clip_(x.owner && x.owner.n, 80), e: clip_(x.owner && x.owner.e, 120).toLowerCase(), id: clip_(x.owner && x.owner.id, 20) };
      a.due = DATE_RE.test(x.due) ? x.due : addDays_(date, a.critical ? Math.ceil(critHours_() / 24) : dueDays_());
      if (!a.owner.n) fail_('BAD', 'Question ' + a.no + ': pick who will fix it.', 'សំណួរ ' + a.no + '៖ សូមជ្រើសអ្នកទទួលខុសត្រូវ។');
      if (a.photoReq && !a.photos.length) fail_('BAD', 'Question ' + a.no + ': a photo is needed for a No.', 'សំណួរ ' + a.no + '៖ ត្រូវការរូបថតសម្រាប់ "ទេ"។');
      if (!a.owner.e) { const pp = person_(a.owner.id) || person_(a.owner.n); if (pp) { a.owner.e = pp.email; a.owner.id = a.owner.id || pp.empId; } }
    }
    return a;
  }).filter(a => a.a);
  if (!answers.length) fail_('BAD', 'Answer at least one question.', 'សូមឆ្លើយយ៉ាងហោចណាស់មួយសំណួរ។');

  const id = nextWalkNo_(walks);
  const folder = answers.some(a => a.a === 'No') ? monthFolder_() : null;
  const at = now_();
  let y = 0, n = 0, na = 0, crit = 0, k = 0;
  const actRows = [], ansRows = [], detail = [];
  answers.forEach(a => {
    if (a.a === 'Yes') y++; else if (a.a === 'N/A') na++; else n++;
    let actId = '';
    if (a.a === 'No') {
      k++;
      if (a.critical) crit++;
      actId = id + '-' + k;
      const photos = (a.photos || []).map((d, i) => saveImage_(folder, d, actId + '-' + (i + 1))).filter(Boolean);
      a.photoIds = photos;
      actRows.push([actId, id, at, site, area, list, a.no, a.q, a.critical ? 'Yes' : 'No', a.note, photos.join(','), a.owner.n, a.owner.e, a.owner.id,
        a.due, ST.open, '', '', '', '', '', '', user.name, user.email, at + ' ' + user.name + ': raised', at]);
    }
    ansRows.push([id, date, site, area, list, a.no, a.q, a.a, a.critical ? 'Yes' : 'No', a.note, actId]);
    detail.push({ no: a.no, q: a.q, km: a.km, a: a.a, c: a.critical ? 1 : 0, note: a.note, act: actId });
  });
  const score = score_(y, n);
  const row = [id, clientId, date, site, area, list, user.name, user.email, clip_(p.started, 20), at, y, n, na, String(score), crit, k,
    clip_(p.note, 500), '', JSON.stringify({ a: detail }).slice(0, 49000), at];
  const wsh = sheet_(SH.WALK, WALK_COLS);
  wsh.getRange(wsh.getLastRow() + 1, 1, 1, row.length).setNumberFormat('@').setValues([row.map(String)]);
  if (actRows.length) { const s = sheet_(SH.ACT, ACT_COLS); s.getRange(s.getLastRow() + 1, 1, actRows.length, ACT_COLS.length).setNumberFormat('@').setValues(actRows.map(r => r.map(String))); }
  const as = sheet_(SH.ANS, ANS_COLS);
  as.getRange(as.getLastRow() + 1, 1, ansRows.length, ANS_COLS.length).setNumberFormat('@').setValues(ansRows.map(r => r.map(String)));
  // a typed area that is not in the Areas tab yet is added (frequency left empty for the admin)
  if (!areas_().some(a => areaKey_(a.site, a.area) === areaKey_(site, area))) sheet_(SH.AREA, AREA_COLS).appendRow([site, area, '', '', '', '', '', 'Yes', 'Added by ' + user.name + ' ' + at]);
  CacheService.getScriptCache().remove('sw_owners');
  if (crit) telegramCritical_({ id: id, site: site, area: area, list: list, walker: user.name, score: score }, answers.filter(a => a.a === 'No' && a.critical));
  return { id: id, score: score, yes: y, no: n, na: na, actions: k, critical: crit };
}

// ---------------------------------------------------------------- actions
function findAction_(id, user) {
  const a = actionRows_().find(x => x['Action No'] === id) || fail_('BAD', 'Action not found.', 'រកមិនឃើញសកម្មភាពនេះទេ។');
  const leads = leaderOf_(areas_(), user);
  const v = actionView_(a, user, leads);
  return { row: a, view: v, leads: leads };
}
const hist_ = (a, user, what) => (a.History ? a.History + '\n' : '') + now_() + ' ' + user.name + ': ' + what;
function actionDone_(p, user) {
  const f = findAction_(p.id, user);
  if (!f.view.can.done) fail_('NOACCESS', 'Only the owner, the walker or a reviewer can mark this done.', 'មានតែអ្នកទទួលខុសត្រូវ អ្នកត្រួតពិនិត្យ ឬអ្នកពិនិត្យប៉ុណ្ណោះ។');
  const photos = (p.photos || (p.photo ? [p.photo] : [])).slice(0, MAX_PHOTOS);
  if (!photos.length) fail_('BAD', 'Take a photo after the fix.', 'សូមថតរូបក្រោយពេលកែរួច។');
  const folder = monthFolder_();
  const ids = photos.map((d, i) => saveImage_(folder, d, p.id + '-after-' + (i + 1))).filter(Boolean);
  setCells_(SH.ACT, ACT_COLS, f.row._row, { Status: ST.done, 'Done At': now_(), 'Done By': user.name, 'Done Note': clip_(p.note, 500),
    'After Photo': ids.join(','), History: hist_(f.row, user, 'done'), Updated: now_() });
  return actionAgain_(p.id, user);
}
function actionClose_(p, user) {
  const f = findAction_(p.id, user);
  if (!f.view.can.close) fail_('NOACCESS', 'Only the walker or a reviewer can close this.', 'មានតែអ្នកត្រួតពិនិត្យ ឬអ្នកពិនិត្យប៉ុណ្ណោះដែលអាចបិទ។');
  setCells_(SH.ACT, ACT_COLS, f.row._row, { Status: ST.closed, 'Closed At': now_(), 'Closed By': user.name, History: hist_(f.row, user, 'closed'), Updated: now_() });
  CacheService.getScriptCache().remove('sw_owners');
  return actionAgain_(p.id, user);
}
function actionReopen_(p, user) {
  const f = findAction_(p.id, user);
  if (!f.view.can.reopen) fail_('NOACCESS', 'Only the walker or a reviewer can reopen this.', 'មានតែអ្នកត្រួតពិនិត្យ ឬអ្នកពិនិត្យប៉ុណ្ណោះ។');
  setCells_(SH.ACT, ACT_COLS, f.row._row, { Status: ST.open, 'Closed At': '', 'Closed By': '', History: hist_(f.row, user, 'reopened' + (p.note ? ': ' + clip_(p.note, 200) : '')), Updated: now_() });
  CacheService.getScriptCache().remove('sw_owners');
  return actionAgain_(p.id, user);
}
function actionEdit_(p, user) {
  const f = findAction_(p.id, user);
  if (!f.view.can.edit) fail_('NOACCESS', 'You cannot change this action.', 'អ្នកមិនអាចកែសកម្មភាពនេះទេ។');
  const v = { Updated: now_() }, what = [];
  if (p.owner && p.owner.n) {
    let e = clip_(p.owner.e, 120).toLowerCase(), id = clip_(p.owner.id, 20);
    if (!e) { const pp = person_(id) || person_(p.owner.n); if (pp) { e = pp.email; id = id || pp.empId; } }
    Object.assign(v, { Owner: clip_(p.owner.n, 80), 'Owner Email': e, 'Owner ID': id });
    what.push('owner ' + v.Owner);
  }
  if (DATE_RE.test(p.due || '')) { v.Due = p.due; what.push('due ' + p.due); }
  v.History = hist_(f.row, user, what.join(', ') || 'edited');
  setCells_(SH.ACT, ACT_COLS, f.row._row, v);
  CacheService.getScriptCache().remove('sw_owners');
  return actionAgain_(p.id, user);
}
function actionAgain_(id, user) { const f = findAction_(id, user); return f.view; }

// ---------------------------------------------------------------- PDF per walk (ISI STEEL logo)
const NAVY = '#011e41', SOFT = '#d4e1f5', LINE = '#b9c3cf';
function logoBlob_() {
  const cache = CacheService.getScriptCache();
  let b64 = cache.get('sw_logo');
  if (!b64) {
    try {
      const r = UrlFetchApp.fetch(LOGO_URL, { muteHttpExceptions: true });
      if (r.getResponseCode() === 200) { b64 = Utilities.base64Encode(r.getContent()); if (b64.length < 95000) cache.put('sw_logo', b64, 21600); }
    } catch (e) { b64 = ''; }
  }
  return b64 ? Utilities.newBlob(Utilities.base64Decode(b64), 'image/png', 'isi-steel.png') : null;
}
function fit_(img, w, h) {
  const k = Math.min(w / img.getWidth(), h / img.getHeight(), 1);
  img.setWidth(Math.round(img.getWidth() * k)).setHeight(Math.round(img.getHeight() * k));
  return img;
}
function compact_(t) {
  for (let i = 0; i < t.getNumRows(); i++) { const r = t.getRow(i); for (let j = 0; j < r.getNumCells(); j++) r.getCell(j).setPaddingTop(1).setPaddingBottom(1).setPaddingLeft(3).setPaddingRight(3); }
}
function grid_(body, rows, widths) {
  const t = body.appendTable(rows.map(r => r.map(x => String(x == null ? '' : x))));
  t.setBorderColor(LINE);
  t.editAsText().setBackgroundColor(null);
  const r = t.getRow(0);
  for (let i = 0; i < r.getNumCells(); i++) r.getCell(i).setBackgroundColor(SOFT).editAsText().setBold(true);
  if (widths) widths.forEach((w, i) => { if (w) t.setColumnWidth(i, w); });
  compact_(t);
  return t;
}
function section_(body, title) {
  const p = body.appendParagraph(title);
  p.editAsText().setForegroundColor(NAVY).setBold(true).setFontSize(9).setBackgroundColor(null);
  p.setSpacingBefore(6).setSpacingAfter(2);
}

function pdf_(p, user) {
  const w = walk_(p, user);
  const row = walkRows_().find(x => x['Walk No'] === w.id);
  let file = null;
  const old = (row['PDF Link'] || '').match(/[-\w]{25,}/);
  if (old) { try { file = DriveApp.getFileById(old[0]); if (file.isTrashed()) file = null; } catch (e) { file = null; } }
  // a PDF made before an action changed is made again, so it shows today's status
  if (file && file.getLastUpdated() < new Date(Math.max.apply(null, [0].concat(w.actionList.map(a => Date.parse(String(a.closedAt || a.doneAt || '').replace(' ', 'T')) || 0))))) file = null;
  if (!file) {
    file = makePdf_(w);
    setCells_(SH.WALK, WALK_COLS, row._row, { 'PDF Link': file.getUrl() });
  }
  return { name: w.id + '.pdf', data: Utilities.base64Encode(file.getBlob().getBytes()) };
}

function makePdf_(w) {
  const doc = DocumentApp.create(w.id);
  const docFile = DriveApp.getFileById(doc.getId());
  try {
    const body = doc.getBody();
    body.setMarginTop(24).setMarginBottom(20).setMarginLeft(28).setMarginRight(28);
    const base = {};
    base[DocumentApp.Attribute.FONT_FAMILY] = 'Noto Sans Khmer';
    base[DocumentApp.Attribute.FONT_SIZE] = 8;
    try { body.setAttributes(base); } catch (e) { /* font not offered */ }
    const list = LISTS.find(l => l.name === w.list) || { km: w.list };
    const head = body.appendTable([[(w.list || '').toUpperCase() + ' REPORT\n' + list.km + '\n' + w.id + '  ·  ' + w.date, '']]);
    head.setBorderWidth(0);
    const hl = head.getRow(0).getCell(0), hr = head.getRow(0).getCell(1);
    hl.editAsText().setForegroundColor(NAVY).setBold(true).setFontSize(11);
    hr.setWidth(150);
    const logo = logoBlob_();
    try {
      const lp = hr.getChild(0).asParagraph();
      lp.setAlignment(DocumentApp.HorizontalAlignment.RIGHT);
      if (logo) fit_(lp.appendInlineImage(logo), 140, 40); else hr.editAsText().setText('ISI STEEL');
    } catch (e) { hr.editAsText().setText('ISI STEEL'); }

    const kv = grid_(body, [['Site · ទីតាំង', 'Area · តំបន់', 'Done by · អ្នកត្រួតពិនិត្យ', 'Finished · បញ្ចប់'],
      [w.site, w.area, w.walker, w.finished],
      ['Score · ពិន្ទុ', 'Yes · បាទ/ចាស', 'No · ទេ', 'N/A'],
      [w.score == null ? '-' : w.score + '%', w.yes, w.no + (w.crit ? ' (' + w.crit + ' critical)' : ''), w.na]]);
    for (let i = 0; i < 4; i++) kv.getRow(2).getCell(i).setBackgroundColor(SOFT).editAsText().setBold(true);

    section_(body, 'ANSWERS · ចម្លើយ');
    const t = grid_(body, [['No', 'Question · សំណួរ', 'Answer', 'Note · កំណត់ចំណាំ']].concat(w.answers.map(a =>
      [a.no, a.q + (a.km && a.km !== a.q ? '\n' + a.km : '') + (a.c ? '  ⚠ critical' : ''), a.a, a.note || ''])), [28, 300, 50, 0]);
    w.answers.forEach((a, i) => { if (a.a === 'No') t.getRow(i + 1).getCell(2).setBackgroundColor('#fbe9e7').editAsText().setBold(true).setForegroundColor('#b3261e'); });

    if (w.actionList.length) {
      section_(body, 'ACTIONS · សកម្មភាពកែតម្រូវ');
      grid_(body, [['Action', 'Problem · បញ្ហា', 'Owner · អ្នកទទួលខុសត្រូវ', 'Due', 'Status']].concat(w.actionList.map(a =>
        [a.id, a.question + (a.note ? '\n' + a.note : ''), a.owner, a.due, a.status + (a.closedAt ? ' ' + a.closedAt.slice(0, 10) : a.doneAt ? ' ' + a.doneAt.slice(0, 10) : '')])), [90, 230, 100, 60, 0]);
      const ph = w.actionList.filter(a => a.photos.length).slice(0, 8);
      if (ph.length) {
        section_(body, 'PHOTOS · រូបថត');
        const p = body.appendParagraph('');
        ph.forEach(a => {
          [a.photos[0], a.after[0]].filter(Boolean).forEach(id => { try { fit_(p.appendInlineImage(DriveApp.getFileById(id).getBlob()), 120, 90); p.appendText(' '); } catch (e) { /* gone */ } });
          p.appendText(a.id + '   ');
        });
      }
    }
    if (w.note) { section_(body, 'NOTE · កំណត់ចំណាំ'); body.appendParagraph(w.note); }
    if (body.getNumChildren() > 1 && body.getChild(0).asText().getText() === '') body.getChild(0).removeFromParent();
    doc.saveAndClose();
    const folder = monthFolder_();
    const old = folder.getFilesByName(w.id + '.pdf');
    while (old.hasNext()) old.next().setTrashed(true);
    return folder.createFile(docFile.getAs('application/pdf').setName(w.id + '.pdf'));
  } finally {
    docFile.setTrashed(true);
  }
}

// ---------------------------------------------------------------- Telegram
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
const appUrl_ = () => setting_('APP_URL') || 'https://isteel-app.pages.dev/safety/';
const button_ = (text, hash) => ({ reply_markup: JSON.stringify({ inline_keyboard: [[{ text: text, url: appUrl_() + (hash || '') }]] }) });

function telegramCritical_(w, crits) {
  const lines = ['🚨 <b>Critical problem found · បញ្ហាធ្ងន់ធ្ងរ</b>', '📍 ' + esc_([w.site, w.area].filter(String).join(' · ')) + ' · ' + esc_(w.list) + ' ' + esc_(w.id),
    '🧍 ' + esc_(w.walker) + (w.score !== '' ? ' · score ' + w.score + '%' : '')]
    .concat(crits.map(a => '❌ ' + esc_(a.q) + (a.note ? ' (' + esc_(a.note) + ')' : '') + '\n    👤 ' + esc_(a.owner.n) + ' · due ' + a.due));
  const first = crits.find(a => (a.photoIds || []).length);
  const extra = button_('Open actions · បើកសកម្មភាព', '#/actions');
  if (first) {
    try {
      const res = telegram_('sendPhoto', Object.assign({ photo: DriveApp.getFileById(first.photoIds[0]).getBlob(), caption: lines.join('\n').slice(0, 1000), parse_mode: 'HTML' }, extra));
      if (res && res.ok) return;
    } catch (e) { console.error('critical photo: ' + e); }
  }
  telegram_('sendMessage', Object.assign({ text: lines.join('\n'), parse_mode: 'HTML' }, extra));
}

/** Every morning 08:00 (trigger made by setup): actions past their due date and areas that are late for a walk. */
function dailyOverdue() {
  setMemo_ = null;
  if (setting_('DAILY_OVERDUE') && !yes_(setting_('DAILY_OVERDUE'))) return;
  const today = today_();
  const late = actionRows_().filter(a => a.Status === ST.open && a.Due && a.Due < today)
    .sort((a, b) => (a.Due < b.Due ? -1 : 1));
  const areas = boot_({ email: '', name: 'system', admin: true, reviewer: true }).areas.filter(a => a.late.length);
  if (!late.length && !areas.length) return;
  const lines = ['⏰ <b>Safety: overdue today · ហួសកំណត់</b> (' + today + ')'];
  if (late.length) {
    lines.push('', '<b>' + late.length + ' action' + (late.length > 1 ? 's' : '') + ' past due</b>');
    late.slice(0, 25).forEach(a => lines.push((yes_(a.Critical) ? '🔴 ' : '🟠 ') + esc_(a.Area) + ': ' + esc_(a.Question) + '\n    👤 ' + esc_(a.Owner) + ' · ' + daysBetween_(a.Due, today) + ' days late'));
    if (late.length > 25) lines.push('… +' + (late.length - 25));
  }
  if (areas.length) {
    lines.push('', '<b>Areas late for a check</b>');
    areas.slice(0, 20).forEach(a => lines.push('📍 ' + esc_(a.site + ' · ' + a.area) + ': ' + a.late.map(l => esc_(l) + (a.last[l] ? ' (last ' + a.last[l] + ')' : ' (never)')).join(', ')));
  }
  telegram_('sendMessage', Object.assign({ text: lines.join('\n').slice(0, 4000), parse_mode: 'HTML' }, button_('Open actions · បើកសកម្មភាព', '#/actions')));
}

/** Every Monday 08:00: last week's walks, scores per area and actions opened / closed. */
function weeklySummary() {
  setMemo_ = null;
  if (setting_('WEEKLY_SUMMARY') && !yes_(setting_('WEEKLY_SUMMARY'))) return;
  const today = today_(), from = addDays_(today, -7);
  const walks = walkRows_().filter(w => w.Date >= from && w.Date < today);
  const acts = actionRows_();
  const opened = acts.filter(a => a.Raised.slice(0, 10) >= from && a.Raised.slice(0, 10) < today).length;
  const closed = acts.filter(a => (a['Closed At'] || '').slice(0, 10) >= from && (a['Closed At'] || '').slice(0, 10) < today).length;
  const open = acts.filter(a => a.Status !== ST.closed).length;
  const overdue = acts.filter(a => a.Status === ST.open && a.Due && a.Due < today).length;
  const by = {};
  walks.forEach(w => { const k = w.Site + ' · ' + w.Area; const o = by[k] = by[k] || { y: 0, n: 0, c: 0 }; o.y += +w.Yes || 0; o.n += +w.No || 0; o.c++; });
  const lines = ['📊 <b>Safety week · សង្ខេបប្រចាំសប្តាហ៍</b> (' + from + ' to ' + addDays_(today, -1) + ')',
    '🦺 ' + walks.length + ' checks done · ❌ ' + opened + ' new actions · ✅ ' + closed + ' closed', '📋 ' + open + ' still open, ' + overdue + ' overdue'];
  const keys = Object.keys(by).sort((a, b) => score_(by[a].y, by[a].n) - score_(by[b].y, by[b].n));
  if (keys.length) { lines.push('', '<b>Score by area</b>'); keys.forEach(k => { const s = score_(by[k].y, by[k].n); lines.push((s >= 90 ? '🟢' : s >= 75 ? '🟠' : '🔴') + ' ' + esc_(k) + ': ' + s + '% (' + by[k].c + ')'); }); }
  telegram_('sendMessage', Object.assign({ text: lines.join('\n').slice(0, 4000), parse_mode: 'HTML' }, button_('Open scores · បើកពិន្ទុ', '#/scores')));
}

function testTelegram_(user) {
  if (!user.admin) fail_('NOACCESS', 'Admins only.', 'សម្រាប់អ្នកគ្រប់គ្រងប៉ុណ្ណោះ។');
  if (!prop_('TELEGRAM_BOT_TOKEN')) fail_('SETUP', 'Add TELEGRAM_BOT_TOKEN in Script properties first.', 'សូមបន្ថែម TELEGRAM_BOT_TOKEN ក្នុង Script properties ជាមុនសិន។');
  if (!setting_('TELEGRAM_CHAT_ID')) fail_('SETUP', 'Type the Telegram group chat id first.', 'សូមវាយ chat id របស់ក្រុម Telegram ជាមុនសិន។');
  const r = telegram_('sendMessage', { text: '✅ Safety Walk & 5S is connected to this group. Sent by ' + user.name + '.' });
  if (!r || !r.ok) fail_('BAD', 'Telegram did not accept the message: check the chat id and that the bot is in the group.', 'Telegram មិនទទួលសារ។ សូមពិនិត្យ chat id និង bot នៅក្នុងក្រុម។');
  return { ok: true };
}

// ---------------------------------------------------------------- admin settings
function settings_(user) {
  if (!user.admin) fail_('NOACCESS', 'Admins only.', 'សម្រាប់អ្នកគ្រប់គ្រងប៉ុណ្ណោះ។');
  return {
    telegramChat: setting_('TELEGRAM_CHAT_ID'), telegramBot: !!prop_('TELEGRAM_BOT_TOKEN'), dueDays: dueDays_(), criticalHours: critHours_(),
    daily: setting_('DAILY_OVERDUE') === '' || yes_(setting_('DAILY_OVERDUE')), weekly: setting_('WEEKLY_SUMMARY') === '' || yes_(setting_('WEEKLY_SUMMARY')),
    areas: objs_(SH.AREA, AREA_COLS).filter(o => o.Area).map(o => ({ site: o.Site, area: o.Area, leader: o['Area Leader'], walk: o['Safety walk'], s5: o['5S audit'],
      forklift: o['Forklift check'], active: o.Active === '' || yes_(o.Active), note: o.Note })),
    questions: objs_(SH.CHK, CHK_COLS).filter(o => o.Checklist).map(o => ({ list: o.Checklist, no: o.No, en: o['Question (English)'], km: o['Question (Khmer)'],
      critical: yes_(o.Critical), photo: o['Photo on No'] === '' || yes_(o['Photo on No']), active: o.Active === '' || yes_(o.Active) })),
  };
}
function saveSettings_(p, user) {
  if (!user.admin) fail_('NOACCESS', 'Admins only.', 'សម្រាប់អ្នកគ្រប់គ្រងប៉ុណ្ណោះ។');
  if (p.telegramChat !== undefined) setSetting_('TELEGRAM_CHAT_ID', clip_(p.telegramChat, 40));
  if (p.dueDays !== undefined) setSetting_('DUE_DAYS', Math.max(1, Math.min(60, Number(p.dueDays) || 7)));
  if (p.criticalHours !== undefined) setSetting_('CRITICAL_HOURS', Math.max(1, Math.min(168, Number(p.criticalHours) || 24)));
  if (p.daily !== undefined) setSetting_('DAILY_OVERDUE', p.daily ? 'Yes' : 'No');
  if (p.weekly !== undefined) setSetting_('WEEKLY_SUMMARY', p.weekly ? 'Yes' : 'No');
  const freq = v => { const s = String(v || '').trim().toLowerCase(); return FREQ_DAYS[s] ? s.charAt(0).toUpperCase() + s.slice(1) : ''; };
  if (Array.isArray(p.areas)) {
    rewrite_(SH.AREA, AREA_COLS, p.areas.filter(a => a && clip_(a.area)).slice(0, 300).map(a => {
      const who = person_(a.leader);
      return [clip_(a.site, 60), clip_(a.area, 100), clip_(a.leader, 80), who ? who.email : '', freq(a.walk), freq(a.s5), freq(a.forklift), a.active === false ? 'No' : 'Yes', clip_(a.note, 200)];
    }));
  }
  if (Array.isArray(p.questions)) {
    const n = {};
    rewrite_(SH.CHK, CHK_COLS, p.questions.filter(q => q && clip_(q.list) && (clip_(q.en) || clip_(q.km))).slice(0, 400).map(q => {
      const l = clip_(q.list, 60); n[l] = (n[l] || 0) + 1;
      return [l, String(n[l]), clip_(q.en, 300), clip_(q.km, 300), q.critical ? 'Y' : 'N', q.photo === false ? 'N' : 'Y', q.active === false ? 'N' : 'Y'];
    }));
  }
  return settings_(user);
}
