/**
 * Truck Scale (ជញ្ជីងឡាន) — backend for isteel-app.pages.dev/scale/ (Kim, 6 Nov 2026).
 * Lives in the same Apps Script project as DataEntry.gs (bound to SSK-WEIGHT-SCALE-DATA), so it shares the /exec URL,
 * the sign-in and the helpers there. The web page reads the Keli XK3118K8 indicator itself (Web Serial) and sends here.
 *
 * One source for every master list (Kim, 6 Nov 2026):
 *   Trucks, drivers, truck companies  -> Fuel Refill sheet, tab "Driver & Truck" (USERS_SHEET_ID). The scale adds
 *                                        3 columns there: Truck Type, Empty Weight (kg), Max Gross (kg).
 *   Customers                         -> SSK-DELIVERY-DATA, tab "Customer" (Customer ID, Customer Name).
 *   Destinations                      -> this sheet, tab "Price List" (Destination column), shared with the Debit Note.
 *   Items                             -> this sheet, tab "Item List" (there was no item list before).
 * Tickets go to "Scale Tickets"; every change to a ticket or a master row goes to "Scale Log".
 */

const SC = { TK: 'Scale Tickets', ITEM: 'Item List', LOG: 'Scale Log' };
const SC_TK_COLS = ['Ticket No', 'Status', 'Truck No', 'Company', 'Customer', 'Item', 'Type', 'DN No', 'DN Count', 'Driver', 'Destination', 'Note',
  '1st Weight (kg)', '1st Time', '1st Source', '2nd Weight (kg)', '2nd Time', '2nd Source', 'Gross (kg)', 'Tare (kg)', 'Net (kg)',
  'Warnings', 'PDF', 'Operator', 'Created At', 'Updated By', 'Updated At', 'Client ID'];
const SC_ITEM_COLS = ['Item', 'Unit', 'Active'];
const SC_LOG_COLS = ['Time', 'User', 'Ticket / Row', 'Action', 'Field', 'Before', 'After', 'Reason'];
const SC_DT_NEW = ['Truck Type', 'Empty Weight (kg)', 'Max Gross (kg)'];   // added to the Fuel "Driver & Truck" tab
const SC_DELIVERY_ID = '1vHhgWrdMLKkmo3qhlITTX2jOmWwgSDz0IjEguQ7cZ44';    // SSK-DELIVERY-DATA (Script property DELIVERY_SHEET_ID wins)
const SC_SETTINGS = [
  ['SCALE_TARE_PCT', '5', 'Warn when the empty weight differs from the truck\'s Empty Weight (kg) by more than this %'],
  ['SCALE_MIN_KG', '200', 'Weights below this are not taken (empty scale)'],
  ['SCALE_PREFIX', 'WB', 'Start of the ticket number, e.g. WB-261106-001'],
  ['SCALE_SIGN', 'Weigher, Driver, Security', 'Signature boxes on the ticket'],
  ['SCALE_COMPANY', 'ISI STEEL', 'Name printed on the ticket'],
];
const SC_WEIGHT_SRC = ['Scale', 'Manual', 'Simulator'];

function scaleRoute_(action, p, user) {
  switch (action) {
    case 'scBoot': return scBoot_(user);
    case 'scSave': return withLock_(() => scSave_(p.ops, user));
    case 'scList': return scList_(p);
    case 'scMaster': return withLock_(() => scMaster_(p, user));
    case 'scSettings': return scSettings_(p, user);
    default: fail_('BAD', 'Unknown action');
  }
}

/** Run once (setup() calls it): the tabs and settings rows. */
function scaleSetup_() {
  const tk = sheet_(SC.TK, SC_TK_COLS);
  tk.getRange('A2:L').setNumberFormat('@');
  tk.getRange('M2:M').setNumberFormat('#,##0'); tk.getRange('P2:P').setNumberFormat('#,##0'); tk.getRange('S2:U').setNumberFormat('#,##0');
  tk.getRange('N2:N').setNumberFormat('dd-mmm-yyyy hh:mm:ss'); tk.getRange('Q2:Q').setNumberFormat('dd-mmm-yyyy hh:mm:ss');
  sheet_(SC.ITEM, SC_ITEM_COLS, [['Steel pipe', 'kg', 'Yes'], ['Steel coil', 'kg', 'Yes'], ['Scrap', 'kg', 'Yes']]);
  sheet_(SC.LOG, SC_LOG_COLS);
  const set = sheet_(SH.SET, SET_COLS);
  const have = set.getLastRow() > 1 ? set.getRange(2, 1, set.getLastRow() - 1, 1).getDisplayValues().map(r => r[0]) : [];
  SC_SETTINGS.forEach(r => { if (have.indexOf(r[0]) < 0) set.appendRow(r); });
  scTruckSheet_();   // adds the 3 columns to Driver & Truck
}

// ---------------------------------------------------------------- master lists (one source each)
function scFuel_() { return SpreadsheetApp.openById(prop_('USERS_SHEET_ID') || fail_('SETUP', 'USERS_SHEET_ID is missing.')); }
/** The Fuel "Driver & Truck" tab with the scale's 3 columns added at the end when missing. Returns { sh, head }. */
function scTruckSheet_() {
  const sh = scFuel_().getSheetByName('Driver & Truck') || fail_('SETUP', 'The Fuel Refill sheet has no "Driver & Truck" tab.');
  let head = sh.getRange(1, 1, 1, sh.getLastColumn()).getDisplayValues()[0].map(h => String(h).trim());
  const missing = SC_DT_NEW.filter(h => head.indexOf(h) < 0);
  if (missing.length) {
    sh.getRange(1, head.length + 1, 1, missing.length).setValues([missing]).setFontWeight('bold');
    head = head.concat(missing);
  }
  return { sh, head };
}
const scNorm_ = s => String(s || '').trim().toUpperCase().replace(/\s+/g, '');

/** One entry per plate: company, drivers, type, empty and max weight (first non-empty value across that plate's rows). */
function scTrucks_() {
  const { sh, head } = scTruckSheet_();
  const c = n => head.indexOf(n);
  const cP = c('CODE'), cCo = c('ក្រុមហ៊ុន'), cD = c('ឈ្មោះតៃកុង'), cT = c(SC_DT_NEW[0]), cE = c(SC_DT_NEW[1]), cM = c(SC_DT_NEW[2]);
  if (cP < 0) fail_('SETUP', 'CODE column not found in Driver & Truck.');
  const n = sh.getLastRow() - 1;
  const v = n > 0 ? sh.getRange(2, 1, n, head.length).getDisplayValues() : [];
  const map = {}, out = [];
  v.forEach(r => {
    const plate = String(r[cP]).trim();
    if (!plate) return;
    const k = scNorm_(plate);
    let t = map[k];
    if (!t) { t = map[k] = { plate: plate, company: '', drivers: [], type: '', empty: '', max: '' }; out.push(t); }
    if (!t.company && cCo >= 0) t.company = String(r[cCo]).trim();
    const d = cD >= 0 ? String(r[cD]).trim() : '';
    if (d && t.drivers.indexOf(d) < 0) t.drivers.push(d);
    if (!t.type && cT >= 0) t.type = String(r[cT]).trim();
    if (t.empty === '' && cE >= 0) t.empty = num_(r[cE]);
    if (t.max === '' && cM >= 0) t.max = num_(r[cM]);
  });
  out.sort((a, b) => a.plate.localeCompare(b.plate));
  return out;
}

function scDelivery_() { return SpreadsheetApp.openById(prop_('DELIVERY_SHEET_ID') || SC_DELIVERY_ID); }
/** Customers from SSK-DELIVERY-DATA › Customer: [id, name]. */
function scCustomers_() {
  const sh = scDelivery_().getSheetByName('Customer');
  if (!sh || sh.getLastRow() < 2) return [];
  const head = sh.getRange(1, 1, 1, sh.getLastColumn()).getDisplayValues()[0].map(h => String(h).trim());
  const ci = head.indexOf('Customer ID'), cn = head.indexOf('Customer Name');
  if (cn < 0) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, head.length).getDisplayValues()
    .filter(r => String(r[cn]).trim()).map(r => [ci >= 0 ? String(r[ci]).trim() : '', String(r[cn]).trim()]);
}
function scItems_() {
  const sh = sheet_(SC.ITEM, SC_ITEM_COLS);
  if (sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, 3).getDisplayValues()
    .filter(r => String(r[0]).trim()).map(r => [String(r[0]).trim(), String(r[1]).trim(), String(r[2]).trim() || 'Yes']);
}
function scDests_() {
  const out = [];
  prices_().forEach(r => { if (r[1] && out.indexOf(r[1]) < 0) out.push(r[1]); });
  return out.sort();
}
function scSettingsMap_() {
  const o = {};
  SC_SETTINGS.forEach(r => { o[r[0]] = setting_(r[0]) || r[1]; });
  return o;
}

// ---------------------------------------------------------------- tickets
const scTime_ = v => (v instanceof Date ? fmt_(v, "yyyy-MM-dd'T'HH:mm:ss") : String(v || ''));
function scRows_() {
  const sh = sheet_(SC.TK, SC_TK_COLS);
  const n = sh.getLastRow() - 1;
  return { sh, rows: n > 0 ? sh.getRange(2, 1, n, SC_TK_COLS.length).getValues() : [] };
}
function scObj_(r) {
  const o = {};
  ['no', 'status', 'plate', 'company', 'customer', 'item', 'type', 'dn', 'dnCount', 'driver', 'dest', 'note',
    'w1', 't1', 's1', 'w2', 't2', 's2', 'gross', 'tare', 'net', 'warn', 'pdf', 'op', 'created', 'updBy', 'upd', 'cid']
    .forEach((k, i) => { o[k] = r[i] instanceof Date ? scTime_(r[i]) : r[i]; });
  o.dns = String(o.dn || '').split(/[,\s]+/).filter(Boolean);
  delete o.dn; delete o.dnCount;
  return o;
}

function scBoot_(user) {
  const { rows } = scRows_();
  const since = new Date(Date.now() - 3 * 86400000);
  // Every open ticket (truck still on site) and the last 3 days, newest first, at most 400.
  const tickets = [];
  for (let i = rows.length - 1; i >= 0 && tickets.length < 400; i--) {
    const r = rows[i];
    if (!r[0]) continue;
    const created = r[24] instanceof Date ? r[24] : null;
    if (r[1] === 'Open' || (created && created >= since)) tickets.push(scObj_(r));
  }
  const last = {};   // last empty weight seen per plate (from finished tickets), for the warning hint
  rows.forEach(r => { if (r[1] === 'Done' && r[2] && r[19] !== '') last[scNorm_(r[2])] = Number(r[19]); });
  return {
    user: { name: user.name, email: user.email, admin: user.admin, reviewer: user.reviewer },
    trucks: scTrucks_(), customers: scCustomers_(), items: scItems_(), dests: scDests_(),
    settings: scSettingsMap_(), tickets: tickets, lastTare: last, sheetUrl: ss_().getUrl(), at: new Date().getTime(),
  };
}

/** Tickets between two dates (yyyy-MM-dd, by 1st weigh time) for the list, search and Excel. */
function scList_(p) {
  const from = date_(p.from), to = date_(p.to);
  if (!from || !to) fail_('BAD', 'Pick the dates.');
  to.setHours(23, 59, 59);
  const { rows } = scRows_();
  const out = [];
  rows.forEach(r => {
    const d = r[13] instanceof Date ? r[13] : (r[24] instanceof Date ? r[24] : null);
    if (r[0] && d && d >= from && d <= to) out.push(scObj_(r));
  });
  if (out.length > 5000) fail_('BAD', 'Too many tickets. Pick fewer days.', 'ប័ណ្ណច្រើនពេក។ សូមរើសថ្ងៃតិចជាងនេះ។');
  return { tickets: out.reverse() };
}

function scLog_(user, key, action, field, before, after, reason) {
  sheet_(SC.LOG, SC_LOG_COLS).appendRow([new Date(), user.name, key, action, field || '', before == null ? '' : String(before), after == null ? '' : String(after), reason || '']);
}

/**
 * Saves tickets made on the scale PC (sent again and again until they arrive, so each op is matched by Client ID).
 * op = { cid, no, status, plate, company, customer, item, type, dns[], driver, dest, note, w1, t1, s1, w2, t2, s2, warn, reason, pdf }
 */
function scSave_(ops, user) {
  if (!Array.isArray(ops) || !ops.length) fail_('BAD', 'Nothing to save.');
  if (ops.length > 20) fail_('BAD', 'Too many tickets at once.');
  const { sh, rows } = scRows_();
  const byCid = {}, byNo = {};
  rows.forEach((r, i) => { if (r[27]) byCid[r[27]] = i; if (r[0]) byNo[String(r[0])] = i; });
  const trucks = scTrucks_();
  const known = {};
  trucks.forEach(t => { known[scNorm_(t.plate)] = t; });
  const custs = scCustomers_().map(c => c[1].toLowerCase()), items = scItems_().map(i => i[0].toLowerCase());
  const out = [];
  ops.forEach(p => {
    const cid = clip_(p.cid, 40);
    if (!cid) fail_('BAD', 'Missing client id.');
    const idx = byCid[cid];
    const old = idx != null ? rows[idx] : null;
    const plate = clip_(p.plate, 20).toUpperCase();
    if (!plate) fail_('BAD', 'Truck No is required.', 'ត្រូវការលេខឡាន។');
    const status = ['Open', 'Done', 'Void'].indexOf(p.status) >= 0 ? p.status : 'Open';
    const reason = clip_(p.reason, 200);
    // Weights: only from the scale. A typed weight needs an Admin and a reason (Kim, 6 Nov 2026).
    const w = k => { const v = num_(p[k]); return v === '' ? '' : Math.round(v); };
    const src = k => (SC_WEIGHT_SRC.indexOf(p[k]) >= 0 ? p[k] : '');
    [['w1', 's1'], ['w2', 's2']].forEach(x => {
      if (w(x[0]) !== '' && src(x[1]) === 'Manual' && !(user.admin && reason)) {
        const before = old ? old[x[0] === 'w1' ? 12 : 15] : '';
        if (Number(before) !== w(x[0])) fail_('DENIED', 'Only an Admin can type a weight, with a reason.', 'មានតែ Admin ទេដែលអាចវាយទម្ងន់ ដោយមានមូលហេតុ។');
      }
    });
    if (old) {
      // A finished ticket can be changed by a Reviewer or Admin only; Void needs an Admin.
      if (old[1] !== 'Open' && !(user.admin || user.reviewer)) fail_('DENIED', 'Ticket ' + old[0] + ' is finished. Only a Reviewer or Admin can change it.',
        'ប័ណ្ណ ' + old[0] + ' បានបញ្ចប់ហើយ។ មានតែ Reviewer ឬ Admin ទេដែលអាចកែបាន។');
      if (status === 'Void' && old[1] !== 'Void' && !(user.admin && reason)) fail_('DENIED', 'Only an Admin can cancel a ticket, with a reason.', 'មានតែ Admin ទេដែលអាចលុបប័ណ្ណ ដោយមានមូលហេតុ។');
      const changeW = (i, k) => w(k) !== '' && old[i] !== '' && Number(old[i]) !== w(k);
      if ((changeW(12, 'w1') || changeW(15, 'w2')) && !(user.admin && reason)) fail_('DENIED', 'A weight already saved can only be changed by an Admin, with a reason.',
        'ទម្ងន់ដែលបានរក្សាទុក អាចកែបានតែដោយ Admin ដោយមានមូលហេតុ។');
    }
    let no = clip_(p.no, 40).replace(/[^0-9A-Za-z\-]/g, '');
    if (old) no = String(old[0]);
    else {
      if (!no) no = (setting_('SCALE_PREFIX') || 'WB') + '-' + fmt_(new Date(), 'yyMMdd-HHmmss');
      let k = 2, base = no;
      while (byNo[no] != null) no = base + '-' + (k++);
    }
    const w1 = w('w1'), w2 = w('w2');
    const both = w1 !== '' && w2 !== '';
    const gross = both ? Math.max(w1, w2) : '', tare = both ? Math.min(w1, w2) : '', net = both ? gross - tare : '';
    const dns = (Array.isArray(p.dns) ? p.dns : String(p.dns || '').split(/[,\s]+/)).map(s => clip_(s, 30).replace(/[^0-9A-Za-z\-\/]/g, '')).filter(Boolean);
    const uniq = dns.filter((d, i) => dns.indexOf(d) === i).slice(0, 30);
    const pdf = p.pdf ? scPdf_(p.pdf, no, plate) : (old ? old[22] : '');
    const vals = [no, status, plate, clip_(p.company, 80), clip_(p.customer, 120), clip_(p.item, 80), clip_(p.type, 20), uniq.join(', '), uniq.length,
      clip_(p.driver, 80), clip_(p.dest, 80), clip_(p.note, 300),
      w1, date_(p.t1), w1 === '' ? '' : src('s1') || 'Scale', w2, date_(p.t2), w2 === '' ? '' : src('s2') || 'Scale', gross, tare, net,
      clip_(p.warn, 300), pdf, old ? old[23] : (clip_(p.op, 80) || user.name), old ? old[24] : new Date(), user.name, new Date(), cid];
    let row;
    if (old) {
      row = idx + 2;
      const log = [];
      SC_TK_COLS.forEach((h, i) => {
        if (i >= 22) return;   // PDF, operator, times: not logged
        const a = old[i] instanceof Date ? fmt_(old[i], 'yyyy-MM-dd HH:mm:ss') : String(old[i]);
        const b = vals[i] instanceof Date ? fmt_(vals[i], 'yyyy-MM-dd HH:mm:ss') : String(vals[i]);
        if (a !== b) log.push([h, a, b]);
      });
      if (log.length) log.forEach(x => scLog_(user, no, status === 'Void' && old[1] !== 'Void' ? 'Cancel' : 'Change', x[0], x[1], x[2], reason));
      sh.getRange(row, 1, 1, vals.length).setValues([vals]);
      rows[idx] = vals;
    } else {
      sh.appendRow(vals);
      row = sh.getLastRow();
      rows.push(vals); byCid[cid] = rows.length - 1; byNo[no] = rows.length - 1;
      scLog_(user, no, 'New', '', '', status + ' ' + plate + (w1 !== '' ? ' 1st ' + w1 : ''), reason);
      if ([vals[14], vals[17]].indexOf('Manual') >= 0) scLog_(user, no, 'Manual weight', '', '', w1 + ' / ' + w2, reason);
    }
    sh.getRange(row, 1, 1, 12).setNumberFormat('@').setValues([vals.slice(0, 12)]);   // plate and DN stay text
    // A plate the Fuel list doesn't have yet is added there (one truck list); its first empty weight fills Empty Weight.
    const t = known[scNorm_(plate)];
    if (!t) { scAddTruck_({ plate: plate, company: vals[3], empty: status === 'Done' ? tare : '' }, user); known[scNorm_(plate)] = { plate: plate, empty: tare }; }
    else if (status === 'Done' && t.empty === '' && tare !== '') { scSetTruck_({ plate: plate, empty: tare }, user, 'Auto from first weigh'); t.empty = tare; }
    // A new customer or item typed on the scale joins its one list too (Customer tab of SSK-DELIVERY-DATA, Item List).
    if (vals[4] && custs.indexOf(vals[4].toLowerCase()) < 0) { scMasterAdd_('customer', { id: '', name: vals[4] }, user); custs.push(vals[4].toLowerCase()); }
    if (vals[5] && items.indexOf(vals[5].toLowerCase()) < 0) { scMasterAdd_('item', { name: vals[5], unit: 'kg', active: 'Yes' }, user); items.push(vals[5].toLowerCase()); }
    out.push({ cid: cid, no: no, row: row, pdf: pdf });
  });
  return { saved: out };
}

function scPdfFolder_() {
  const props = PropertiesService.getScriptProperties();
  let id = props.getProperty('SC_PDF_FOLDER_ID');
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) { /* deleted: make again */ } }
  const f = DriveApp.createFolder('Scale Tickets PDF');
  props.setProperty('SC_PDF_FOLDER_ID', f.getId());
  return f;
}
function scPdf_(b64, no, plate) {
  const bytes = Utilities.base64Decode(String(b64).replace(/^data:application\/pdf;base64,/, ''));
  if (!bytes.length || bytes.length > 4 * 1024 * 1024) return '';
  const name = no + '_' + plate.replace(/[^A-Z0-9\-]/g, '') + '.pdf';
  const f = scPdfFolder_();
  const old = f.getFilesByName(name);
  while (old.hasNext()) old.next().setTrashed(true);
  return f.createFile(Utilities.newBlob(bytes, 'application/pdf', name)).getUrl();
}

// ---------------------------------------------------------------- master edits (Admin)
function scAddTruck_(t, user) {
  const { sh, head } = scTruckSheet_();
  const row = head.map(() => '');
  const put = (h, v) => { const i = head.indexOf(h); if (i >= 0) row[i] = v; };
  put('CODE', t.plate); put('ក្រុមហ៊ុន', t.company || ''); put(SC_DT_NEW[0], t.type || ''); put(SC_DT_NEW[1], t.empty === '' || t.empty == null ? '' : t.empty);
  put(SC_DT_NEW[2], t.max === '' || t.max == null ? '' : t.max); put('Odometer Broken?', head.indexOf('Odometer Broken?') >= 0 ? 'No' : '');
  sh.appendRow(row);
  const r = sh.getLastRow(), cp = head.indexOf('CODE') + 1;
  sh.getRange(r, cp).setNumberFormat('@').setValue(t.plate);
  scLog_(user, 'Truck ' + t.plate, 'New truck', '', '', JSON.stringify(t), '');
}
/** Sets company / type / empty / max on every Driver & Truck row of that plate (one plate can have several drivers). */
function scSetTruck_(t, user, reason) {
  const { sh, head } = scTruckSheet_();
  const cp = head.indexOf('CODE');
  const n = sh.getLastRow() - 1;
  const plates = n > 0 ? sh.getRange(2, cp + 1, n, 1).getDisplayValues().map(r => scNorm_(r[0])) : [];
  const k = scNorm_(t.plate);
  const rowsAt = [];
  plates.forEach((p, i) => { if (p === k) rowsAt.push(i + 2); });
  if (!rowsAt.length) return false;
  const fields = [['company', 'ក្រុមហ៊ុន'], ['type', SC_DT_NEW[0]], ['empty', SC_DT_NEW[1]], ['max', SC_DT_NEW[2]]];
  fields.forEach(f => {
    if (t[f[0]] === undefined) return;
    const c = head.indexOf(f[1]);
    if (c < 0) return;
    const v = f[0] === 'empty' || f[0] === 'max' ? num_(t[f[0]]) : clip_(t[f[0]], 80);
    rowsAt.forEach(r => {
      const cell = sh.getRange(r, c + 1);
      const before = cell.getDisplayValue();
      if (String(before) === String(v)) return;
      cell.setValue(v);
      scLog_(user, 'Truck ' + t.plate, 'Change truck', f[1], before, v, reason || '');
    });
  });
  return true;
}

/** Adds one customer or item from a ticket (any operator), without the Admin check of scMaster_. */
function scMasterAdd_(kind, row, user) {
  try { scMaster_({ kind: kind, rows: [row] }, Object.assign({}, user, { admin: true })); }
  catch (e) { console.warn('Could not add ' + kind + ': ' + e.message); }
}

/** p = { kind: 'truck' | 'customer' | 'item', rows: [...] } — adds new rows, updates matching ones, never deletes. */
function scMaster_(p, user) {
  if (!user.admin) fail_('DENIED', 'Admins only.', 'សម្រាប់ Admin ប៉ុណ្ណោះ។');
  const rows = Array.isArray(p.rows) ? p.rows.slice(0, 1000) : [];
  if (!rows.length) fail_('BAD', 'Nothing to save.');
  let added = 0, changed = 0;
  if (p.kind === 'truck') {
    const have = {};
    scTrucks_().forEach(t => { have[scNorm_(t.plate)] = t; });
    rows.forEach(r => {
      const plate = clip_(r.plate, 20).toUpperCase();
      if (!plate) return;
      const t = { plate: plate };
      ['company', 'type', 'empty', 'max'].forEach(k => { if (r[k] !== undefined && r[k] !== null && String(r[k]).trim() !== '') t[k] = r[k]; });
      if (have[scNorm_(plate)]) { if (scSetTruck_(t, user, p.reason || 'Settings')) changed++; }
      else { scAddTruck_(t, user); have[scNorm_(plate)] = t; added++; }
    });
  } else if (p.kind === 'customer') {
    const sh = scDelivery_().getSheetByName('Customer') || fail_('SETUP', 'SSK-DELIVERY-DATA has no "Customer" tab.');
    const head = sh.getRange(1, 1, 1, sh.getLastColumn()).getDisplayValues()[0].map(h => String(h).trim());
    const ci = head.indexOf('Customer ID'), cn = head.indexOf('Customer Name'), cno = head.indexOf('No');
    const n = sh.getLastRow() - 1;
    const v = n > 0 ? sh.getRange(2, 1, n, head.length).getDisplayValues() : [];
    rows.forEach(r => {
      const id = clip_(r.id, 30), name = clip_(r.name, 120);
      if (!name) return;
      let at = id ? v.findIndex(x => String(x[ci]).trim() === id) : -1;
      if (at < 0) at = v.findIndex(x => String(x[cn]).trim().toLowerCase() === name.toLowerCase());
      if (at >= 0) {
        if (String(v[at][cn]).trim() !== name) { sh.getRange(at + 2, cn + 1).setValue(name); scLog_(user, 'Customer ' + (id || name), 'Change customer', 'Customer Name', v[at][cn], name, ''); v[at][cn] = name; changed++; }
        if (id && ci >= 0 && !String(v[at][ci]).trim()) { sh.getRange(at + 2, ci + 1).setNumberFormat('@').setValue(id); v[at][ci] = id; changed++; }
      } else {
        const row = head.map(() => '');
        if (cno >= 0) row[cno] = v.length + 1;
        if (ci >= 0) row[ci] = id;
        row[cn] = name;
        sh.appendRow(row);
        if (ci >= 0) sh.getRange(sh.getLastRow(), ci + 1).setNumberFormat('@').setValue(id);
        v.push(row); added++;
        scLog_(user, 'Customer ' + (id || name), 'New customer', '', '', name, '');
      }
    });
  } else if (p.kind === 'item') {
    const sh = sheet_(SC.ITEM, SC_ITEM_COLS);
    const n = sh.getLastRow() - 1;
    const v = n > 0 ? sh.getRange(2, 1, n, 3).getDisplayValues() : [];
    rows.forEach(r => {
      const name = clip_(r.name, 80);
      if (!name) return;
      const vals = [name, clip_(r.unit, 20) || 'kg', r.active === false || /^(no|n|false)$/i.test(String(r.active)) ? 'No' : 'Yes'];
      const at = v.findIndex(x => String(x[0]).trim().toLowerCase() === name.toLowerCase());
      if (at >= 0) {
        if (v[at].join('|') !== vals.join('|')) { sh.getRange(at + 2, 1, 1, 3).setValues([vals]); scLog_(user, 'Item ' + name, 'Change item', '', v[at].join(' / '), vals.join(' / '), ''); v[at] = vals; changed++; }
      } else { sh.appendRow(vals); v.push(vals); added++; scLog_(user, 'Item ' + name, 'New item', '', '', vals.join(' / '), ''); }
    });
  } else fail_('BAD', 'Unknown list.');
  CacheService.getScriptCache().remove('de_trucks');
  return { added: added, changed: changed, trucks: scTrucks_(), customers: scCustomers_(), items: scItems_() };
}

/** Admin: the SCALE_* rows of DE Settings. */
function scSettings_(p, user) {
  if (!user.admin) fail_('DENIED', 'Admins only.', 'សម្រាប់ Admin ប៉ុណ្ណោះ។');
  const sh = sheet_(SH.SET, SET_COLS);
  const n = sh.getLastRow() - 1;
  const keys = n > 0 ? sh.getRange(2, 1, n, 1).getDisplayValues().map(r => String(r[0]).trim()) : [];
  SC_SETTINGS.forEach(def => {
    if (p[def[0]] === undefined) return;
    const v = clip_(p[def[0]], 200);
    const i = keys.indexOf(def[0]);
    if (i >= 0) {
      const before = sh.getRange(i + 2, 2).getDisplayValue();
      if (before !== v) { sh.getRange(i + 2, 2).setValue(v); scLog_(user, 'Settings', 'Change setting', def[0], before, v, ''); }
    } else { sh.appendRow([def[0], v, def[2]]); keys.push(def[0]); }
  });
  return { settings: scSettingsMap_() };
}
