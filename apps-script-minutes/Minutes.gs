/**
 * Meeting Minutes (ប្រជុំ) — Google Apps Script backend for isteel-app.pages.dev/minutes/.
 *
 * Bound to the "SSK-MEETING-MINUTES" Google Sheet (Extensions > Apps Script inside that sheet). It keeps:
 *   - "Meetings" tab: one row per meeting (title, date, status, summary, links)
 *   - "Actions" tab: one row per action item, so open tasks can be followed up across meetings
 *   - Drive folder "Meeting Minutes" (one sub-folder per meeting): minutes.json (minutes, transcript, text from photos),
 *     the photos and documents people added, and the Google Doc / Word version of the minutes.
 * The AI work (transcript, reading photos, writing the minutes) is done by the Cloudflare relay /mm/* with Gemini;
 * this script only signs the "ticket" that lets a signed-in user call it.
 *
 * Script Properties (Project Settings > Script properties):
 *   GOOGLE_CLIENT_ID   same Client ID as the other iSteel apps (web/config.js)
 *   SESSION_SECRET     copy of the Fuel app's SESSION_SECRET, so one sign-in works in every app
 *   USERS_SHEET_ID     id of the Fuel Refill Google Sheet: its "Users" tab is the one user list (tick box ប្រជុំ)
 *   MM_SECRET          made by setup(); copy the same value into Cloudflare (Settings > Variables and Secrets)
 *   MM_FOLDER_ID       made by setup(); Drive folder "Meeting Minutes"
 *   MM_TEMPLATE_DOC_ID optional: a Google Doc with the company letterhead; each Word file starts from a copy of it
 */

const SH = { MEET: 'Meetings', ACT: 'Actions' };
const MEET_COLS = ['ID', 'Created', 'Created By', 'Title', 'Meeting Date', 'Time', 'Location', 'Spoken Language', 'Minutes Language',
  'Attendees', 'Status', 'Summary', 'Decisions', 'Open Actions', 'Doc Link', 'Folder Link', 'Updated', 'Updated By'];
const ACT_COLS = ['Meeting ID', 'No.', 'Task', 'Owner', 'Due', 'Priority', 'Status', 'Done Date', 'Meeting Title', 'Updated'];
const APP_COL = 'ប្រជុំ';           // tick box column in the Fuel Refill Users tab (added by the Fuel script)
const TICKET_HOURS = 12;
const MAX_ATTACH = 15 * 1024 * 1024;

// ---------------------------------------------------------------- web entry points
function doGet() { return json_({ ok: true, app: 'Meeting Minutes' }); }

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
    case 'boot': return { user: { email: user.email, name: user.name, admin: user.admin }, ticket: makeTicket_(user.email), recent: list_(user, 60) };
    case 'ticket': return { ticket: makeTicket_(user.email) };
    case 'list': return list_(user, 500);
    case 'get': return getMeeting_(p.id);
    case 'save': return save_(p, user);
    case 'attach': return attach_(p, user);
    case 'word': return word_(p, user);
    case 'email': return email_(p, user);
    case 'tasks': return tasks_();
    case 'taskSet': return taskSet_(p, user);
    case 'delete': return delete_(p, user);
    default: fail_('BAD', 'Unknown action');
  }
}

function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function fail_(code, en, kh) { throw new Error(code + ': ' + en + (kh ? ' || ' + kh : '')); }
const prop_ = k => PropertiesService.getScriptProperties().getProperty(k) || '';
const TZ = 'Asia/Phnom_Penh';
const fmt_ = (d, f) => Utilities.formatDate(d, TZ, f);
const text_ = v => (v == null ? '' : v instanceof Date ? fmt_(v, 'yyyy-MM-dd HH:mm') : String(v).trim());
const yes_ = v => v === true || /^(yes|true|y|1)$/i.test(String(v).trim());
const ss_ = () => SpreadsheetApp.getActive();

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(28000)) fail_('BUSY', 'Many people are saving at once. Please try again.', 'មានអ្នករក្សាទុកច្រើនពេក។ សូមព្យាយាមម្តងទៀត។');
  try { return fn(); } finally { lock.releaseLock(); }
}

function sheet_(name, cols) {
  const ss = ss_();
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, cols.length).setValues([cols]).setFontWeight('bold').setBackground('#011e41').setFontColor('#ffffff');
    sh.setFrozenRows(1);
    sh.getRange(1, 1, sh.getMaxRows(), cols.length).setNumberFormat('@');   // plain text: IDs and dates stay as typed
  }
  return sh;
}

// ---------------------------------------------------------------- setup (run once from the editor)
/** Adds the tabs, the Drive folder and MM_SECRET. Safe to run again. */
function setup() {
  sheet_(SH.MEET, MEET_COLS);
  sheet_(SH.ACT, ACT_COLS);
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('MM_SECRET')) props.setProperty('MM_SECRET', Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, ''));
  if (!props.getProperty('MM_FOLDER_ID')) props.setProperty('MM_FOLDER_ID', DriveApp.createFolder('Meeting Minutes').getId());
  const first = ss_().getSheets()[0];
  if (first && first.getName() !== SH.MEET && first.getLastRow() === 0) ss_().deleteSheet(first);   // the empty "Sheet1"
  const notes = [];
  ['GOOGLE_CLIENT_ID', 'SESSION_SECRET', 'USERS_SHEET_ID'].forEach(k => { if (!prop_(k)) notes.push('Add ' + k + ' in Script properties.'); });
  notes.push('Copy MM_SECRET from Script properties into Cloudflare (isteel-app > Settings > Variables and Secrets).');
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
  if (!u) fail_('NOACCESS', email + ' has no Meeting Minutes access. Ask the admin to tick ' + APP_COL + ' in Users.',
    email + ' មិនទាន់មានសិទ្ធិប្រើ ' + APP_COL + ' ទេ។ សូមស្នើអ្នកគ្រប់គ្រងធីក ' + APP_COL + ' ក្នុង Users។');
  return { email: email, name: u.name || email, admin: u.admin, session: session };
}

/** The one user list: the Users tab of the Fuel Refill sheet. Active = Yes and ប្រជុំ ticked (Fuel admins always). */
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
    const admin = r >= 0 && /admin/i.test(text_(x[r]));
    return { email: String(x[e]).trim().toLowerCase(), name: text_(x[n]), admin: admin,
      ok: (a < 0 || yes_(x[a])) && (admin || (tick >= 0 && yes_(x[tick]))) };
  });
}
function usersCached_() {
  const cache = CacheService.getScriptCache();
  const hit = cache.get('mm_users');
  if (hit) return JSON.parse(hit);
  const u = users_();
  try { cache.put('mm_users', JSON.stringify(u), 60); } catch (e) { /* too big: read each time */ }
  return u;
}

/** Ticket for the Cloudflare AI relay: base64url(JSON {e, x}) + "." + base64url(HMAC-SHA256 with MM_SECRET). */
function makeTicket_(email) {
  const secret = prop_('MM_SECRET');
  if (!secret) return '';
  const body = b64url_(Utilities.newBlob(JSON.stringify({ e: email, x: Math.floor(Date.now() / 1000) + TICKET_HOURS * 3600 })).getBytes());
  const sig = Utilities.computeHmacSha256Signature(Utilities.newBlob(body).getBytes(), Utilities.newBlob(secret).getBytes());
  return body + '.' + b64url_(sig);
}

// ---------------------------------------------------------------- meetings
function table_(sh) {
  if (sh.getLastRow() < 2) return { head: sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String), rows: [] };
  const v = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getDisplayValues();
  return { head: v[0].map(h => String(h).trim()), rows: v.slice(1) };
}
function rowObj_(head, r) { const o = {}; head.forEach((h, i) => { o[h] = r[i]; }); return o; }

function list_(user, limit) {
  const t = table_(sheet_(SH.MEET, MEET_COLS));
  return t.rows.map(r => rowObj_(t.head, r)).filter(o => o.ID).reverse().slice(0, limit).map(o => ({
    id: o.ID, title: o.Title, date: o['Meeting Date'], time: o.Time, created: o.Created, by: o['Created By'], status: o.Status,
    summary: String(o.Summary || '').slice(0, 220), open: Number(o['Open Actions']) || 0, doc: o['Doc Link'],
  }));
}

function folder_(id, make) {
  const root = DriveApp.getFolderById(prop_('MM_FOLDER_ID') || fail_('SETUP', 'Run setup() first.'));
  const it = root.getFoldersByName(id);
  if (it.hasNext()) return it.next();
  return make ? root.createFolder(id) : null;
}
function dataFile_(folder) {
  const it = folder.getFilesByName('minutes.json');
  return it.hasNext() ? it.next() : null;
}

function getMeeting_(id) {
  const f = folder_(String(id || ''), false);
  const file = f && dataFile_(f);
  if (!file) fail_('NOTFOUND', 'Meeting not found.', 'រកមិនឃើញការប្រជុំនេះទេ។');
  const d = JSON.parse(file.getBlob().getDataAsString('UTF-8'));
  // Action status lives in the Actions tab (people tick tasks done from the Tasks screen).
  const st = {};
  const t = table_(sheet_(SH.ACT, ACT_COLS));
  t.rows.forEach(r => { const o = rowObj_(t.head, r); if (o['Meeting ID'] === d.id) st[o['No.']] = { status: o.Status, done: o['Done Date'] }; });
  ['km', 'en'].forEach(l => {
    const m = d.minutes && d.minutes[l];
    if (m && m.actions) m.actions.forEach((a, i) => { const s = st[String(i + 1)]; if (s) { a.status = s.status; a.doneDate = s.done; } });
  });
  return d;
}

function newId_() {
  const day = fmt_(new Date(), 'yyMMdd');
  const t = table_(sheet_(SH.MEET, MEET_COLS));
  let n = 0;
  t.rows.forEach(r => { const m = String(r[0]).match(/^MM-(\d{6})-(\d+)$/); if (m && m[1] === day) n = Math.max(n, +m[2]); });
  return 'MM-' + day + '-' + String(n + 1).padStart(3, '0');
}

/** Creates or updates one meeting. The full data goes to minutes.json; the sheet keeps a short row and the action list. */
function save_(p, user) {
  return withLock_(() => {
    const sh = sheet_(SH.MEET, MEET_COLS);
    let id = String(p.id || '');
    let old = null;
    if (id) { try { old = getMeeting_(id); } catch (e) { old = null; } }
    if (!id) id = newId_();
    const now = fmt_(new Date(), 'yyyy-MM-dd HH:mm');
    const d = Object.assign({}, old || {}, {
      id: id, meta: p.meta || (old && old.meta) || {}, lang: p.lang || (old && old.lang) || 'auto', outLang: p.outLang || (old && old.outLang) || 'km',
      status: p.status || (old && old.status) || 'Draft', updated: now, updatedBy: user.email,
    });
    ['minutes', 'transcript', 'ocr', 'notes', 'files', 'model'].forEach(k => { if (p[k] !== undefined) d[k] = p[k]; });
    if (!old) { d.created = now; d.createdBy = user.email; }
    const folder = folder_(id, true);
    const blob = Utilities.newBlob(JSON.stringify(d), 'application/json', 'minutes.json');
    const f = dataFile_(folder);
    if (f) f.setContent(blob.getDataAsString('UTF-8')); else folder.createFile(blob);

    const m = (d.minutes && (d.minutes[d.outLang === 'en' ? 'en' : 'km'] || d.minutes.en || d.minutes.km)) || {};
    const meta = d.meta || {};
    const actions = m.actions || [];
    const openN = writeActions_(id, m.title || meta.title || '', actions);
    const row = [id, d.created || '', d.createdBy || '', m.title || meta.title || '', m.meetingDate || meta.date || '', m.startTime || meta.time || '',
      m.location || meta.location || '', d.lang, d.outLang, (m.attendees || []).map(a => a.name).join(', ') || meta.attendees || '', d.status,
      String(m.summary || '').slice(0, 4000), (m.decisions || []).join('\n').slice(0, 4000), openN, d.docUrl || '', folder.getUrl(), now, user.email];
    const ids = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, 1).getDisplayValues().map(r => r[0]) : [];
    const at = ids.indexOf(id);
    if (at >= 0) sh.getRange(at + 2, 1, 1, row.length).setNumberFormat('@').setValues([row]);
    else { const r = sh.getLastRow() + 1; sh.getRange(r, 1, 1, row.length).setNumberFormat('@').setValues([row]); }
    return { id: id, updated: now, folder: folder.getUrl() };
  });
}

/** Rewrites this meeting's rows in Actions, keeping Status/Done Date of tasks that did not change. Returns the open count. */
function writeActions_(id, title, actions) {
  const sh = sheet_(SH.ACT, ACT_COLS);
  const t = table_(sh);
  const keep = {}, rowsAt = [];
  t.rows.forEach((r, i) => { const o = rowObj_(t.head, r); if (o['Meeting ID'] === id) { keep[o.Task] = o; rowsAt.push(i + 2); } });
  for (let i = rowsAt.length - 1; i >= 0; i--) sh.deleteRow(rowsAt[i]);
  const now = fmt_(new Date(), 'yyyy-MM-dd HH:mm');
  const rows = actions.filter(a => a && a.task).map((a, i) => {
    const k = keep[a.task] || {};
    return [id, String(i + 1), a.task, a.owner || 'TBC', a.due || 'TBC', a.priority || '', k.Status || 'Open', k['Done Date'] || '', title, now];
  });
  if (rows.length) sh.getRange(sh.getLastRow() + 1, 1, rows.length, ACT_COLS.length).setNumberFormat('@').setValues(rows);
  return rows.filter(r => r[6] !== 'Done').length;
}

function attach_(p, user) {
  const folder = folder_(String(p.id || ''), false) || fail_('NOTFOUND', 'Save the meeting first.');
  const bytes = Utilities.base64Decode(String(p.b64 || ''));
  if (!bytes.length) fail_('BAD', 'Empty file');
  if (bytes.length > MAX_ATTACH) fail_('BIG', 'File is over 15 MB.', 'ឯកសារធំជាង 15 MB។');
  const name = String(p.name || 'file').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 120);
  const f = folder.createFile(Utilities.newBlob(bytes, String(p.mime || 'application/octet-stream'), name));
  f.setDescription('Added by ' + user.email);
  return { fileId: f.getId(), url: f.getUrl(), name: name };
}

function delete_(p, user) {
  return withLock_(() => {
    const id = String(p.id || '');
    const sh = sheet_(SH.MEET, MEET_COLS);
    const t = table_(sh);
    const i = t.rows.findIndex(r => r[0] === id);
    if (i < 0) fail_('NOTFOUND', 'Meeting not found.', 'រកមិនឃើញការប្រជុំនេះទេ។');
    if (!user.admin && String(t.rows[i][2]).toLowerCase() !== user.email) fail_('DENIED', 'Only the person who made it or an admin can delete it.', 'មានតែអ្នកបង្កើត ឬ Admin ទេដែលអាចលុបបាន។');
    sh.deleteRow(i + 2);
    writeActions_(id, '', []);
    const f = folder_(id, false);
    if (f) f.setTrashed(true);   // stays in Drive's bin for 30 days
    return { id: id };
  });
}

// ---------------------------------------------------------------- tasks across meetings
function tasks_() {
  const t = table_(sheet_(SH.ACT, ACT_COLS));
  const cut = fmt_(new Date(Date.now() - 30 * 86400000), 'yyyy-MM-dd');
  return t.rows.map(r => rowObj_(t.head, r)).filter(o => o.Task && (o.Status !== 'Done' || String(o['Done Date']) >= cut)).map(o => ({
    id: o['Meeting ID'], no: o['No.'], task: o.Task, owner: o.Owner, due: o.Due, priority: o.Priority, status: o.Status, done: o['Done Date'], title: o['Meeting Title'],
  }));
}
function taskSet_(p, user) {
  return withLock_(() => {
    const sh = sheet_(SH.ACT, ACT_COLS);
    const t = table_(sh);
    const i = t.rows.findIndex(r => r[0] === String(p.id) && r[1] === String(p.no));
    if (i < 0) fail_('NOTFOUND', 'Task not found.', 'រកមិនឃើញកិច្ចការនេះទេ។');
    const done = p.status === 'Done';
    sh.getRange(i + 2, 7, 1, 4).setNumberFormat('@').setValues([[done ? 'Done' : 'Open', done ? fmt_(new Date(), 'yyyy-MM-dd') : '', t.rows[i][8], fmt_(new Date(), 'yyyy-MM-dd HH:mm') + ' ' + user.email]]);
    // keep the open count on the meeting row right
    const open = t.rows.filter((r, j) => r[0] === String(p.id) && (j === i ? !done : r[6] !== 'Done')).length;
    const ms = sheet_(SH.MEET, MEET_COLS);
    const ids = ms.getLastRow() > 1 ? ms.getRange(2, 1, ms.getLastRow() - 1, 1).getDisplayValues().map(r => r[0]) : [];
    const at = ids.indexOf(String(p.id));
    if (at >= 0) ms.getRange(at + 2, MEET_COLS.indexOf('Open Actions') + 1).setValue(String(open));
    return { status: done ? 'Done' : 'Open' };
  });
}

// ---------------------------------------------------------------- Word / Google Doc
const L = {
  km: { minutes: 'កំណត់ហេតុប្រជុំ', date: 'កាលបរិច្ឆេទ', time: 'ម៉ោង', place: 'ទីកន្លែង', chair: 'អធិបតី', who: 'អ្នកចូលរួម', summary: 'សេចក្តីសង្ខេប',
    discussion: 'ចំណុចពិភាក្សាសំខាន់ៗ', decisions: 'កិច្ចព្រមព្រៀង និងសេចក្តីសម្រេច', actions: 'កិច្ចការត្រូវអនុវត្ត', task: 'កិច្ចការ',
    owner: 'អ្នកទទួលខុសត្រូវ', due: 'ថ្ងៃកំណត់', prio: 'អាទិភាព', follow: 'ផែនការតាមដាន', open: 'ចំណុចមិនទាន់សម្រេច', next: 'ការប្រជុំបន្ទាប់',
    gloss: 'ពាក្យបច្ចេកទេស', by: 'រៀបចំដោយ', none: 'គ្មាន', name: 'ឈ្មោះ', role: 'តួនាទី' },
  en: { minutes: 'Meeting Minutes', date: 'Date', time: 'Time', place: 'Location', chair: 'Chair', who: 'Attendees', summary: 'Executive Summary',
    discussion: 'Key Discussion Points', decisions: 'Agreements & Decisions', actions: 'Action Items', task: 'Task', owner: 'Owner',
    due: 'Due date', prio: 'Priority', follow: 'Follow-up Plan', open: 'Open Points', next: 'Next Meeting', gloss: 'Glossary',
    by: 'Prepared by', none: 'None', name: 'Name', role: 'Role' },
};
const NAVY = '#011e41', BLUE = '#0b76a0', SOFT = '#d4e1f5';
const langsOf_ = (d, lang) => (lang === 'both' ? ['km', 'en'] : [lang === 'en' ? 'en' : 'km']).filter(l => d.minutes && d.minutes[l]);

function buildDoc_(d, lang, user) {
  const folder = folder_(d.id, true);
  const langs = langsOf_(d, lang);
  if (!langs.length) fail_('BAD', 'These minutes are not written yet.', 'កំណត់ហេតុមិនទាន់បានសរសេរនៅឡើយ។');
  const first = d.minutes[langs[0]];
  const name = (first.meetingDate || (d.meta && d.meta.date) || '') + ' ' + (first.title || 'Minutes') + ' (' + d.id + ')';
  let doc;
  const tpl = prop_('MM_TEMPLATE_DOC_ID');
  if (tpl) doc = DocumentApp.openById(DriveApp.getFileById(tpl).makeCopy(name, folder).getId());
  else { doc = DocumentApp.create(name); DriveApp.getFileById(doc.getId()).moveTo(folder); }
  const body = doc.getBody();
  if (!tpl) body.setMarginTop(48).setMarginBottom(48).setMarginLeft(56).setMarginRight(56);
  const base = {};
  base[DocumentApp.Attribute.FONT_FAMILY] = 'Noto Sans Khmer';
  base[DocumentApp.Attribute.FONT_SIZE] = 10.5;
  try { body.setAttributes(base); } catch (e) { /* font not offered: keep the default */ }

  langs.forEach((l, li) => {
    const m = d.minutes[l], T = L[l];
    if (li > 0) body.appendPageBreak();
    const h = body.appendParagraph(T.minutes).setHeading(DocumentApp.ParagraphHeading.TITLE);
    h.editAsText().setForegroundColor(NAVY).setBold(true).setFontSize(20);
    body.appendParagraph(m.title || '').setHeading(DocumentApp.ParagraphHeading.SUBTITLE).editAsText().setForegroundColor(BLUE).setFontSize(14);
    const info = [[T.date, m.meetingDate || ''], [T.time, [m.startTime, m.duration].filter(String).join(' · ')], [T.place, m.location || ''], [T.chair, m.chair || '']]
      .filter(r => r[1]);
    if (info.length) styleTable_(body.appendTable(info), false);
    section_(body, T.who);
    const ppl = (m.attendees || []).map(a => [a.name || '', a.role || '']);
    if (ppl.length) styleTable_(body.appendTable([[T.name, T.role]].concat(ppl)), true); else bullet_(body, [T.none]);
    section_(body, T.summary);
    body.appendParagraph(m.summary || T.none);
    section_(body, T.discussion);
    (m.discussion || []).forEach((g, i) => {
      body.appendParagraph((i + 1) + '. ' + (g.topic || '')).editAsText().setBold(true);
      bullet_(body, g.points || []);
    });
    if (!(m.discussion || []).length) bullet_(body, [T.none]);
    section_(body, T.decisions);
    bullet_(body, (m.decisions || []).length ? m.decisions : [T.none]);
    section_(body, T.actions);
    const acts = (m.actions || []).map((a, i) => [String(i + 1), a.task || '', a.owner || 'TBC', a.due || 'TBC', a.priority || '']);
    if (acts.length) styleTable_(body.appendTable([['#', T.task, T.owner, T.due, T.prio]].concat(acts)), true); else bullet_(body, [T.none]);
    section_(body, T.follow);
    bullet_(body, (m.followUp || []).length ? m.followUp : [T.none]);
    if ((m.openPoints || []).length) { section_(body, T.open); bullet_(body, m.openPoints); }
    if (m.nextMeeting) { section_(body, T.next); body.appendParagraph(m.nextMeeting); }
    if ((m.glossary || []).length) {
      section_(body, T.gloss);
      styleTable_(body.appendTable(m.glossary.map(g => [g.term || '', g.meaning || ''])), false);
    }
    body.appendParagraph('');
    body.appendParagraph(T.by + ': ' + (user.name || user.email) + ' · ' + d.id).editAsText().setForegroundColor('#546274').setFontSize(9);
  });
  // A new Doc starts with one empty paragraph; drop it so the title is first.
  if (!tpl && body.getNumChildren() > 1 && body.getChild(0).asText().getText() === '') body.getChild(0).removeFromParent();
  doc.saveAndClose();
  return doc;
}
function section_(body, title) {
  const p = body.appendParagraph(title).setHeading(DocumentApp.ParagraphHeading.HEADING2);
  p.editAsText().setForegroundColor(NAVY).setBold(true).setFontSize(13);
  p.setSpacingBefore(14).setSpacingAfter(4);
}
function bullet_(body, items) { items.forEach(t => body.appendListItem(String(t)).setGlyphType(DocumentApp.GlyphType.BULLET)); }
function styleTable_(t, header) {
  t.setBorderColor('#c9d6e6');
  if (header) {
    const r = t.getRow(0);
    for (let i = 0; i < r.getNumCells(); i++) r.getCell(i).setBackgroundColor(NAVY).editAsText().setForegroundColor('#ffffff').setBold(true);
  } else {
    for (let i = 0; i < t.getNumRows(); i++) t.getRow(i).getCell(0).setBackgroundColor(SOFT).editAsText().setBold(true);
  }
}
function docx_(docId) {
  const res = UrlFetchApp.fetch('https://docs.google.com/document/d/' + docId + '/export?format=docx',
    { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) fail_('SERVER', 'Could not make the Word file (' + res.getResponseCode() + ').');
  return res.getBlob();
}

/** Makes the Google Doc (kept in the meeting folder) and returns the Word file for download. */
function word_(p, user) {
  const d = getMeeting_(p.id);
  const doc = buildDoc_(d, p.lang || d.outLang, user);
  const blob = docx_(doc.getId());
  const name = fileName_(d);
  setDocLink_(d, doc.getUrl());
  return { docUrl: doc.getUrl(), name: name, b64: Utilities.base64Encode(blob.getBytes()) };
}
/** Word file name in plain letters: browsers save a Khmer file name as "download" with no .docx. */
function fileName_(d) {
  const m = d.minutes && (d.minutes.km || d.minutes.en) || {};
  const date = String(m.meetingDate || (d.meta && d.meta.date) || '').replace(/[^0-9-]/g, '');
  return 'Meeting Minutes ' + d.id + (date ? ' ' + date : '') + '.docx';
}
function setDocLink_(d, url) {
  d.docUrl = url;
  const folder = folder_(d.id, true), f = dataFile_(folder);
  if (f) f.setContent(JSON.stringify(d));
  const sh = sheet_(SH.MEET, MEET_COLS);
  const ids = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, 1).getDisplayValues().map(r => r[0]) : [];
  const at = ids.indexOf(d.id);
  if (at >= 0) sh.getRange(at + 2, MEET_COLS.indexOf('Doc Link') + 1).setValue(url);
}

// ---------------------------------------------------------------- email
const EMAIL_RE = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;
const esc_ = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function email_(p, user) {
  const split = s => String(s || '').split(/[\s,;]+/).map(x => x.trim()).filter(Boolean);
  const to = split(p.to), cc = split(p.cc);
  if (!to.length) fail_('BAD', 'Add at least one email address.', 'សូមបញ្ចូលអាសយដ្ឋានអ៊ីមែលយ៉ាងហោចណាស់មួយ។');
  const bad = to.concat(cc).filter(x => !EMAIL_RE.test(x));
  if (bad.length) fail_('BAD', 'Check these email addresses: ' + bad.join(', '), 'សូមពិនិត្យអ៊ីមែលទាំងនេះ៖ ' + bad.join(', '));
  if (to.length + cc.length > 40) fail_('BAD', 'Up to 40 people per email.', 'អាចផ្ញើបានច្រើនបំផុត 40 នាក់ក្នុងមួយអ៊ីមែល។');
  if (MailApp.getRemainingDailyQuota() < to.length + cc.length) fail_('LIMIT', 'Google\'s daily email limit is reached. Try again tomorrow.', 'ដល់ចំនួនអ៊ីមែលកំណត់ប្រចាំថ្ងៃហើយ។ សូមព្យាយាមថ្ងៃស្អែក។');
  const d = getMeeting_(p.id);
  const lang = p.lang || d.outLang;
  const doc = buildDoc_(d, lang, user);
  setDocLink_(d, doc.getUrl());
  const first = d.minutes[langsOf_(d, lang)[0]];
  const subject = String(p.subject || '').trim() || ((lang === 'en' ? 'Meeting minutes: ' : 'កំណត់ហេតុប្រជុំ៖ ') + (first.title || d.id) + (first.meetingDate ? ' (' + first.meetingDate + ')' : ''));
  const html = emailHtml_(d, lang, p.note, user);
  MailApp.sendEmail({
    to: to.join(','), cc: cc.join(','), subject: subject, htmlBody: html, name: user.name || 'ISI Steel W&L',
    replyTo: user.email, attachments: [docx_(doc.getId()).setName(fileName_(d))],
  });
  const sent = (d.sent || []).concat([{ at: fmt_(new Date(), 'yyyy-MM-dd HH:mm'), by: user.email, to: to, cc: cc }]);
  d.sent = sent;
  const f = dataFile_(folder_(d.id, true));
  if (f) f.setContent(JSON.stringify(d));
  return { sent: to.length + cc.length, docUrl: doc.getUrl() };
}

function emailHtml_(d, lang, note, user) {
  const th = 'style="background:' + NAVY + ';color:#fff;text-align:left;padding:6px 8px;font-size:13px"';
  const td = 'style="border:1px solid #d6dee8;padding:6px 8px;font-size:13px;vertical-align:top"';
  const h2 = t => '<h3 style="color:' + NAVY + ';margin:18px 0 6px;font-size:15px">' + esc_(t) + '</h3>';
  const ul = xs => '<ul style="margin:0 0 0 18px;padding:0">' + xs.map(x => '<li style="margin:2px 0">' + esc_(x) + '</li>').join('') + '</ul>';
  let out = '<div style="font-family:\'Noto Sans Khmer\',Arial,sans-serif;color:#011e41;max-width:760px">';
  if (note) out += '<p style="white-space:pre-line">' + esc_(note) + '</p><hr style="border:0;border-top:1px solid #d6dee8">';
  langsOf_(d, lang).forEach(l => {
    const m = d.minutes[l], T = L[l];
    out += '<div style="background:' + NAVY + ';color:#fff;padding:12px 16px;border-radius:8px;margin-top:12px"><div style="font-size:12px;opacity:.8">' + esc_(T.minutes) +
      '</div><div style="font-size:18px;font-weight:700">' + esc_(m.title || '') + '</div><div style="font-size:12px;opacity:.85">' +
      esc_([m.meetingDate, m.startTime, m.location].filter(String).join(' · ')) + '</div></div>';
    if ((m.attendees || []).length) out += h2(T.who) + '<p style="margin:0">' + esc_(m.attendees.map(a => a.name + (a.role ? ' (' + a.role + ')' : '')).join(', ')) + '</p>';
    out += h2(T.summary) + '<p style="margin:0;white-space:pre-line">' + esc_(m.summary || T.none) + '</p>';
    out += h2(T.decisions) + ul((m.decisions || []).length ? m.decisions : [T.none]);
    out += h2(T.actions);
    out += (m.actions || []).length ? '<table style="border-collapse:collapse;width:100%"><tr><th ' + th + '>#</th><th ' + th + '>' + esc_(T.task) + '</th><th ' + th + '>' +
      esc_(T.owner) + '</th><th ' + th + '>' + esc_(T.due) + '</th></tr>' + m.actions.map((a, i) => '<tr><td ' + td + '>' + (i + 1) + '</td><td ' + td + '>' + esc_(a.task) +
      '</td><td ' + td + '>' + esc_(a.owner || 'TBC') + '</td><td ' + td + '>' + esc_(a.due || 'TBC') + '</td></tr>').join('') + '</table>' : ul([T.none]);
    if ((m.discussion || []).length) out += h2(T.discussion) + m.discussion.map(g => '<p style="margin:8px 0 2px;font-weight:700">' + esc_(g.topic) + '</p>' + ul(g.points || [])).join('');
    if ((m.followUp || []).length) out += h2(T.follow) + ul(m.followUp);
    if ((m.openPoints || []).length) out += h2(T.open) + ul(m.openPoints);
    if (m.nextMeeting) out += h2(T.next) + '<p style="margin:0">' + esc_(m.nextMeeting) + '</p>';
    if ((m.glossary || []).length) out += h2(T.gloss) + ul(m.glossary.map(g => g.term + ': ' + g.meaning));
  });
  out += '<p style="color:#546274;font-size:12px;margin-top:20px">' + esc_(L[lang === 'en' ? 'en' : 'km'].by) + ': ' + esc_(user.name || user.email) + ' · ' + esc_(d.id) + '</p></div>';
  return out;
}
