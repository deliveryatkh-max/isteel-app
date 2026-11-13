/**
 * Truck Scale (ជញ្ជីងឡាន) — backend for isteel-app.pages.dev/scale/ (Kim, 6 Nov 2026).
 * Lives in the same Apps Script project as DataEntry.gs (bound to SSK-WEIGHT-SCALE-DATA), so it shares the /exec URL,
 * the sign-in and the helpers there. The web page reads the Keli XK3118K8 indicator itself (Web Serial) and sends here.
 *
 * One source for every master list (Kim, 6 Nov 2026):
 *   Trucks and truck companies        -> Fuel Refill sheet (USERS_SHEET_ID), tab "Truck": one row per plate with
 *                                        Truck Type, Vehicle Weight (kg), Max. Gross Weight (kg), Odometer Broken?, Photo, and Kim's other truck details.
 *   Drivers                           -> same sheet, tab "Driver & Truck": one row per driver, CODE = usual truck.
 *                                        Any driver can take any truck.
 *   Customers                         -> SSK-DELIVERY-DATA, tab "Customer" (Customer ID, Customer Name).
 *   Destinations                      -> this sheet, tab "Price List" (Destination column), shared with the Debit Note.
 *   Items                             -> this sheet, tab "Item List" (there was no item list before).
 * Tickets go to "Scale Tickets"; every change to a ticket or a master row goes to "Scale Log".
 */

const SC = { TK: 'Scale Tickets', ITEM: 'Item List', LOG: 'Scale Log' };
const SC_TK_COLS = ['Ticket No', 'Status', 'Truck No', 'Company', 'Customer', 'Item', 'Type', 'DN No', 'DN Count', 'Driver', 'Destination', 'Note',
  '1st Weight (kg)', '1st Time', '1st Source', '2nd Weight (kg)', '2nd Time', '2nd Source', 'Gross (kg)', 'Tare (kg)', 'Net (kg)',
  'Warnings', 'PDF', 'Operator', 'Created At', 'Updated By', 'Updated At', 'Client ID', 'Loading Place', 'Tarpaulin', 'Scale Again', 'DN Kg', 'DN Total (kg)', 'DN Variance (kg)', 'Photo 1st', 'Photo 2nd', 'Empty Truck',
  'Billing Status', 'Billing By', 'Billing At', 'Billing DN'];   // Debit Note check: Confirm = the truck company's bill is right (Kim, 13 Nov 2026)
const SC_ITEM_COLS = ['Item', 'Unit', 'Active'];
const SC_LOG_COLS = ['Time', 'User', 'Ticket / Row', 'Action', 'Field', 'Before', 'After', 'Reason'];
// Columns of the Fuel "Truck" tab (Kim, 11 Nov 2026): "Actual Vehicle Weight (kg)" is the empty truck as weighed on the
// scale (the app fills and updates it); "Inspected Vehicle Weight (kg)" is from the inspection certificate (typed by Kim).
// The older names are still read when the new ones are empty. Over weight = goods over Max. Gross − Inspected (12 Nov 2026).
const SC_DT_NEW = ['Truck Type', 'Actual Vehicle Weight (kg)', 'Max. Gross Weight (kg)'];
const SC_DT_OLD = ['', 'Vehicle Weight (kg)', 'Max Gross (kg)'];
const SC_DT_INSP = 'Inspected Vehicle Weight (kg)';
const SC_TRUCK_COLS = ['CODE', 'ក្រុមហ៊ុន'].concat(SC_DT_NEW, ['Odometer Broken?', 'Photo']);
// Shown in the truck info box on the weigh screen (Kim, 8 Nov 2026): [key, column]
const SC_TRUCK_INFO = [['loc', 'Vehicle Location'], ['mark', 'Mark'], ['vtype', 'Vehicle Type EN'], ['vtypeKh', 'Vehicle Type KH'],
  ['colour', 'Colour'], ['year', 'Year Made'], ['load', 'Max. Load (kg)'], ['len', 'Length (m)'], ['wid', 'Width (m)'], ['hei', 'Height (m)'],
  ['axles', 'Number of Axles'], ['insp', 'Inspection Date'], ['exp', 'Expiry Date'], ['r1', 'Loading Rule 1'], ['r2', 'Loading Rule 2'], ['r3', 'Loading Rule 3']];
const SC_DELIVERY_ID = '1vHhgWrdMLKkmo3qhlITTX2jOmWwgSDz0IjEguQ7cZ44';    // SSK-DELIVERY-DATA (Script property DELIVERY_SHEET_ID wins)
const SC_SETTINGS = [
  ['SCALE_TARE_PCT', '5', 'Warn when the empty weight differs from the truck\'s Actual (else Inspected) Vehicle Weight by more than this %'],
  ['SCALE_MIN_KG', '200', 'Weights below this are not taken (empty scale)'],
  ['SCALE_PREFIX', 'WB', 'Start of the ticket number, e.g. WB-261106-001'],
  ['SCALE_SIGN', 'Weigher, Driver, Security', 'Signature boxes on the ticket'],
  ['SCALE_COMPANY', 'ISI STEEL', 'Name printed on the ticket'],
  ['SCALE_TEMPLATE_LINK', '', 'Drive link to the ticket template: a Word file, a Google Doc or a folder (newest file used). Empty = built-in ticket.'],
  ['SCALE_DNC_USERS', '', 'Emails that can see the Debit Note check menu (comma separated). Admins always see it.'],
  ['SCALE_AGAIN_KG', '20', '"Scale again": a change up to this many kg counts as the same weight'],
  ['SCALE_TEMPLATE_A5_LINK', '', 'Drive link to the A5 ticket template (for PCs set to A5 paper). Empty = the A4 template shrunk to A5.'],
  ['SCALE_MANUAL_ALL', 'No', 'Yes = every weigher can type a weight by hand (with a reason). No = Admins only.'],
  ['SCALE_DN_VAR_KG', '120', 'DN kg check: allowed difference between the DN total and the scale net (kg)'],
  ['SCALE_REPORT_COLS', '', 'Report columns and their order (set by an Admin on the Report screen). Empty = default.'],
  ['SCALE_TABLE_COLS', '', 'Column layout of the other tables (set by an Admin on screen). Empty = default.'],
  ['SCALE_DEBIT_NOTE_LINK', 'https://drive.google.com/drive/folders/1mFZFVYJGyijsnhFVjTviDluICME9e9tn', 'Drive link to the Debit Note Excel template (Report › Debit Note), or a folder (newest file with "Debit" in its name). Kept in G:\\My Drive\\SSK-STEEL\\SSK-WEIGHT.'],
];
const SC_WEIGHT_SRC = ['Scale', 'Manual', 'Simulator'];

function scaleRoute_(action, p, user) {
  switch (action) {
    case 'scBoot': return scBoot_(user);
    case 'scSave': return withLock_(() => scSave_(p.ops, user));
    case 'scList': return scList_(p);
    case 'scMaster': return withLock_(() => scMaster_(p, user));
    case 'scSettings': return scSettings_(p, user);
    case 'scTicketPdf': return scTicketPdf_(p, user);
    case 'scTemplate': return scTemplate_(p);
    case 'scDnTemplate': return scDnTemplate_(p);
    case 'scDnNo': return withLock_(() => scDnNo_(p, user));
    case 'scTruckPhoto': return withLock_(() => scTruckPhoto_(p, user));
    case 'scBill': return withLock_(() => scBill_(p, user));
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
  scTruckSheet_();   // makes the Truck tab when missing
}

// ---------------------------------------------------------------- master lists (one source each)
function scFuel_() { return SpreadsheetApp.openById(prop_('USERS_SHEET_ID') || fail_('SETUP', 'USERS_SHEET_ID is missing.')); }
/**
 * The Fuel "Truck" tab: one row per plate (Kim, 8 Nov 2026). Made on first use from the old "Driver & Truck" rows
 * (first value per plate), so nothing is lost. Returns { sh, head }.
 */
function scTruckSheet_() {
  const ss = scFuel_();
  let sh = ss.getSheetByName('Truck');
  if (!sh) {
    sh = ss.insertSheet('Truck');
    sh.getRange(1, 1, 1, SC_TRUCK_COLS.length).setValues([SC_TRUCK_COLS]).setFontWeight('bold').setBackground('#011e41').setFontColor('#ffffff');
    sh.setFrozenRows(1);
    sh.getRange('A:A').setNumberFormat('@');
    const old = scOldTrucks_(ss);
    if (old.length) sh.getRange(2, 1, old.length, SC_TRUCK_COLS.length).setValues(old);
  }
  let head = sh.getRange(1, 1, 1, Math.max(1, sh.getLastColumn())).getDisplayValues()[0].map(h => String(h).trim());
  const missing = SC_TRUCK_COLS.filter(h => head.indexOf(h) < 0);
  if (missing.length) {
    sh.getRange(1, head.length + 1, 1, missing.length).setValues([missing]).setFontWeight('bold');
    head = head.concat(missing);
  }
  return { sh, head };
}
/** Rows for a new Truck tab from the old Driver & Truck tab: one per plate, first non-empty value of each column. */
function scOldTrucks_(ss) {
  const dt = ss.getSheetByName('Driver & Truck');
  if (!dt || dt.getLastRow() < 2) return [];
  const v = dt.getRange(1, 1, dt.getLastRow(), dt.getLastColumn()).getDisplayValues();
  const head = v[0].map(h => String(h).trim()), cols = SC_TRUCK_COLS.map(h => head.indexOf(h));
  const map = {}, out = [];
  v.slice(1).forEach(r => {
    const plate = cols[0] >= 0 ? String(r[cols[0]]).trim() : '';
    if (!plate) return;
    const k = scNorm_(plate);
    let row = map[k];
    if (!row) { row = map[k] = SC_TRUCK_COLS.map(() => ''); row[0] = plate; out.push(row); }
    cols.forEach((c, i) => { if (i && c >= 0 && row[i] === '' && String(r[c]).trim()) row[i] = String(r[c]).trim(); });
    if (cols[5] >= 0 && /^(y|yes|true|ខូច)$/i.test(String(r[cols[5]]).trim())) row[5] = 'Yes';
  });
  out.forEach(r => { if (!r[5]) r[5] = 'No'; });
  return out;
}
const scNorm_ = s => String(s || '').trim().toUpperCase().replace(/\s+/g, '');

/** One entry per plate from the Truck tab, with the drivers whose usual truck (CODE in Driver & Truck) it is. */
function scTrucks_() {
  const { sh, head } = scTruckSheet_();
  const c = n => head.indexOf(n);
  const cP = c('CODE'), cCo = c('ក្រុមហ៊ុន'), cT = c(SC_DT_NEW[0]), cPh = c('Photo');
  const n = sh.getLastRow() - 1;
  const v = n > 0 ? sh.getRange(2, 1, n, head.length).getDisplayValues() : [];
  const cell = (r, h) => { const i = c(h); return i >= 0 ? String(r[i]).trim() : ''; };
  const weight = (r, k) => { const a = num_(cell(r, SC_DT_NEW[k])); return a !== '' ? a : num_(cell(r, SC_DT_OLD[k])); };
  const map = {}, out = [];
  v.forEach(r => {
    const plate = String(r[cP]).trim();
    if (!plate || map[scNorm_(plate)]) return;
    const info = {};
    SC_TRUCK_INFO.forEach(f => { const x = cell(r, f[1]); if (x && x !== '-') info[f[0]] = x; });
    const t = map[scNorm_(plate)] = { plate: plate, company: cCo >= 0 ? String(r[cCo]).trim() : '', drivers: [],
      type: (cT >= 0 ? String(r[cT]).trim() : '') || info.vtype || '', empty: weight(r, 1), insp: num_(cell(r, SC_DT_INSP)), max: weight(r, 2),
      photo: cPh >= 0 ? String(r[cPh]).trim() : '', info: info };
    out.push(t);
  });
  // Drivers: each driver row names a usual truck in CODE. A plate only there (not yet in Truck) still shows.
  const dt = scFuel_().getSheetByName('Driver & Truck');
  if (dt && dt.getLastRow() > 1) {
    const dv = dt.getRange(1, 1, dt.getLastRow(), dt.getLastColumn()).getDisplayValues();
    const dh = dv[0].map(h => String(h).trim()), dP = dh.indexOf('CODE'), dD = dh.indexOf('ឈ្មោះតៃកុង'), dC = dh.indexOf('ក្រុមហ៊ុន');
    dv.slice(1).forEach(r => {
      const plate = dP >= 0 ? String(r[dP]).trim() : '', d = dD >= 0 ? String(r[dD]).trim() : '';
      if (!plate) return;
      let t = map[scNorm_(plate)];
      if (!t) { t = map[scNorm_(plate)] = { plate: plate, company: dC >= 0 ? String(r[dC]).trim() : '', drivers: [], type: '', empty: '', insp: '', max: '' }; out.push(t); }
      if (d && t.drivers.indexOf(d) < 0) t.drivers.push(d);
    });
  }
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
  // Every name in the Destination column, even rows with no 3PL company or price yet (Kim, 8 Nov 2026).
  const sh = sheet_(SH.PRICE, PRICE_COLS), out = [];
  if (sh.getLastRow() < 2) return out;
  sh.getRange(2, 2, sh.getLastRow() - 1, 1).getDisplayValues().forEach(r => { const v = String(r[0]).trim(); if (v && out.indexOf(v) < 0) out.push(v); });
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
  // Columns added later (Loading Place, 6 Nov 2026) get their header on the old sheet.
  if (sh.getMaxColumns() < SC_TK_COLS.length) sh.insertColumnsAfter(sh.getMaxColumns(), SC_TK_COLS.length - sh.getMaxColumns());
  if (sh.getRange(1, SC_TK_COLS.length).getValue() === '') sh.getRange(1, 28, 1, SC_TK_COLS.length - 27).setValues([SC_TK_COLS.slice(27)]).setFontWeight('bold').setBackground('#011e41').setFontColor('#ffffff');
  const n = sh.getLastRow() - 1;
  return { sh, rows: n > 0 ? sh.getRange(2, 1, n, SC_TK_COLS.length).getValues() : [] };
}
function scObj_(r) {
  const o = {};
  ['no', 'status', 'plate', 'company', 'customer', 'item', 'type', 'dn', 'dnCount', 'driver', 'dest', 'note',
    'w1', 't1', 's1', 'w2', 't2', 's2', 'gross', 'tare', 'net', 'warn', 'pdf', 'op', 'created', 'updBy', 'upd', 'cid', 'load', 'tarp', 'again', 'dnkgTxt', 'dnTot', 'dnVar', 'ph1', 'ph2', 'empty1', 'bill', 'billBy', 'billAt', 'billDn']
    .forEach((k, i) => { o[k] = r[i] instanceof Date ? scTime_(r[i]) : r[i]; });
  o.dns = String(o.dn || '').split(/[,\s]+/).filter(Boolean);
  o.again = scAgain_(o.again);
  o.dnkg = scDnKg_(o.dnkgTxt); delete o.dnkgTxt;
  delete o.dn; delete o.dnCount;
  return o;
}

/**
 * DN numbers already used (Kim, 9 Nov 2026): one DN can be on one ticket only. Map DN -> [first date yyyy-MM-dd, ticket no, client id].
 * Cancelled (Void) tickets don't count.
 */
function scDnIndex_(rows) {
  const out = {};
  rows.forEach(r => {
    if (!r[0] || r[1] === 'Void' || !r[7]) return;
    const d = [r[16], r[13], r[24]].find(x => x instanceof Date);
    const day = d ? fmt_(d, 'yyyy-MM-dd') : '';
    String(r[7]).split(/[,\s]+/).filter(Boolean).forEach(dn => { if (!out[dn]) out[dn] = [day, String(r[0]), String(r[27] || '')]; });
  });
  return out;
}

/**
 * "Scale again" (Kim, 9 Nov 2026): a truck parked overnight is weighed again before its 2nd weigh, as often as needed.
 * One cell, one line each: "yyyy-MM-dd HH:mm:ss | kg | change | by | source". Lines already saved are never lost.
 */
function scAgain_(v) {
  if (Array.isArray(v)) return v;
  return String(v || '').split('\n').map(l => l.split('|').map(x => x.trim())).filter(a => a.length >= 3 && a[0] && num_(a[1]) !== '')
    .map(a => ({ t: a[0].replace(' ', 'T'), kg: num_(a[1]), diff: num_(a[2]) === '' ? 0 : num_(a[2]), by: a[3] || '', src: a[4] || 'Scale' }));
}
/** DN kg (Kim, 10 Nov 2026): one cell "DN: kg, DN: kg" -> { DN: kg }. */
function scDnKg_(v) {
  const o = {};
  String(v || '').split(',').forEach(x => { const a = x.split(':'); if (a.length !== 2) return; const k = a[0].trim(), n = Number(String(a[1]).replace(/[^0-9.]/g, '')); if (k && n > 0) o[k] = n; });
  return o;
}
function scAgainText_(oldCell, list, user) {
  const have = scAgain_(oldCell), seen = {};
  have.forEach(c => { seen[String(c.t).slice(0, 19)] = 1; });
  (Array.isArray(list) ? list.slice(0, 50) : []).forEach(c => {
    const kgv = num_(c && c.kg), tt = String((c && c.t) || '').slice(0, 19);
    if (kgv === '' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(tt) || seen[tt]) return;
    const src = SC_WEIGHT_SRC.indexOf(c.src) >= 0 ? c.src : 'Scale';
    if (src === 'Manual' && !user.admin) return;   // typed weights stay Admin only
    seen[tt] = 1;
    have.push({ t: tt, kg: Math.round(kgv), diff: Math.round(num_(c.diff) || 0), by: clip_(c.by || user.name, 60), src: src });
  });
  have.sort((a, b) => String(a.t).localeCompare(String(b.t)));
  return have.map(c => [String(c.t).replace('T', ' '), c.kg, (c.diff > 0 ? '+' : '') + c.diff, c.by, c.src].join(' | ')).join('\n');
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
  const use = {};   // trips per truck, so the truck list shows the most used first (Kim, 12 Nov 2026)
  rows.forEach(r => { if (r[0] && r[2] && r[1] !== 'Void') { const k = String(r[2]).toUpperCase().replace(/[\s\-.]/g, ''); use[k] = (use[k] || 0) + 1; } });
  const dnc = scCanDnc_(user);
  return {
    dnUsed: scDnIndex_(rows),   // every DN already on a ticket, so the scale PC can stop a second use (Kim, 9 Nov 2026)
    user: { name: user.name, email: user.email, admin: user.admin, reviewer: user.reviewer, dnc: dnc },
    prices: dnc && typeof prices_ === 'function' ? prices_() : [],   // vendor prices: only for people who see the Debit Note check
    people: user.admin ? usersCached_().filter(u => u.okScale).map(u => ({ email: u.email, name: u.name, admin: u.admin })) : [],
    trucks: scTrucks_(), customers: scCustomers_(), items: scItems_(), dests: scDests_(),
    settings: scSettingsMap_(), tickets: tickets, lastTare: last, plateUse: use, sheetUrl: ss_().getUrl(), at: new Date().getTime(),
  };
}

/** Tickets between two dates (yyyy-MM-dd, by 1st weigh time) for the list, search and Excel. */
/**
 * Debit Note check › Confirm (Kim, 13 Nov 2026): the ticked tickets' billing from the truck company is correct.
 * Writes "Confirmed Billing" with who, when and the DN number in the Billing columns; Undo (on = '') is for Admins.
 */
function scBill_(p, user) {
  if (!scCanDnc_(user)) fail_('DENIED', 'Not allowed.', 'មិនមានសិទ្ធិ។');
  if (!p.on && !user.admin) fail_('DENIED', 'Admins only.', 'សម្រាប់ Admin ប៉ុណ្ណោះ។');
  const nos = (Array.isArray(p.nos) ? p.nos : []).map(String).filter(Boolean).slice(0, 1000);
  if (!nos.length) fail_('BAD', 'Tick the tickets first.', 'សូមធីកប័ណ្ណជាមុនសិន។');
  const { sh, rows } = scRows_(), c = SC_TK_COLS.indexOf('Billing Status') + 1, now = new Date(), want = {};
  nos.forEach(n => { want[n] = 1; });
  let n = 0;
  rows.forEach((r, i) => {
    if (!want[String(r[0])]) return;
    const v = p.on ? ['Confirmed Billing', user.name, now, clip_(p.dn, 60)] : ['', '', '', ''];
    sh.getRange(i + 2, c, 1, 4).setValues([v]);
    scLog_(user, r[0], p.on ? 'Confirm billing' : 'Undo billing', 'Billing Status', r[c - 1], v[0], clip_(p.dn, 60));
    n++;
  });
  return { n, by: user.name, at: scTime_(now) };
}

/** Debit Note check menu: Admins, plus the people an Admin ticked (DE Settings SCALE_DNC_USERS). */
function scCanDnc_(user) {
  if (user.admin) return true;
  return String(setting_('SCALE_DNC_USERS') || '').toLowerCase().split(/[\s,;]+/).indexOf(String(user.email || '').toLowerCase()) >= 0;
}

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
  // "All" (Kim, 10 Nov 2026): send the newest 5000 instead of an error
  if (out.length > 5000 && p.all) return { tickets: out.slice(-5000).reverse(), more: true };
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
  let dnIdx = null;
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
      // Everyone may type when an Admin set SCALE_MANUAL_ALL = Yes (Kim, 10 Nov 2026); a reason is still needed.
      const may = user.admin || String(setting_('SCALE_MANUAL_ALL') || '').toLowerCase() === 'yes';
      if (w(x[0]) !== '' && src(x[1]) === 'Manual' && !(may && reason)) {
        const before = old ? old[x[0] === 'w1' ? 12 : 15] : '';
        if (Number(before) !== w(x[0])) fail_('DENIED', may ? 'A typed weight needs a reason.' : 'Only an Admin can type a weight, with a reason.', may ? 'ទម្ងន់វាយដោយដៃ ត្រូវមានមូលហេតុ។' : 'មានតែ Admin ទេដែលអាចវាយទម្ងន់ ដោយមានមូលហេតុ។');
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
    // A DN already on another ticket can't be used again (Kim, 9 Nov 2026)
    if (status !== 'Void') {
      if (!dnIdx) dnIdx = scDnIndex_(rows);
      const had = old ? String(old[7] || '').split(/[,\s]+/) : [];
      uniq.forEach(d => {
        const u = dnIdx[d];
        if (u && u[2] !== cid && had.indexOf(d) < 0) fail_('DUP', 'DN ' + d + ' was used already since ' + u[0] + ' (ticket ' + u[1] + ').',
          'DN ' + d + ' បានប្រើរួចហើយ តាំងពី ' + u[0] + ' (ប័ណ្ណ ' + u[1] + ')។');
      });
    }
    const pdf = p.pdf ? scPdf_(p.pdf, no, plate) : (old ? old[22] : '');
    // The kg written on each DN, the DN total and the variance against the net (Kim, 10 Nov 2026)
    const dk = p.dnkg && typeof p.dnkg === 'object' ? p.dnkg : null;
    const dkText = dk ? uniq.filter(d => Number(dk[d]) > 0).map(d => d + ': ' + Math.round(Number(dk[d]))).join(', ') : (old ? String(old[31] || '') : '');
    const dkMap = scDnKg_(dkText), dkAll = uniq.length > 0 && uniq.every(d => dkMap[d] > 0);
    const dkTot = dkAll ? uniq.reduce((a, d) => a + dkMap[d], 0) : '', dkVar = dkAll && net !== '' ? net - dkTot : '';
    const vals = [no, status, plate, clip_(p.company, 80), clip_(p.customer, 120), clip_(p.item, 80), ['In', 'Out'].indexOf(p.type) >= 0 ? p.type : both ? (w1 > w2 ? 'In' : 'Out') : '',   // what the weigher ticked (load = Out, unload = In); weights only when nothing was ticked (Kim, 12 Nov 2026)
      uniq.join(', '), uniq.length,
      clip_(p.driver, 80), clip_(p.dest, 300), clip_(p.note, 300),
      w1, date_(p.t1), w1 === '' ? '' : src('s1') || 'Scale', w2, date_(p.t2), w2 === '' ? '' : src('s2') || 'Scale', gross, tare, net,
      clip_(p.warn, 300), pdf, old ? old[23] : (clip_(p.op, 80) || user.name), old ? old[24] : new Date(), user.name, new Date(), cid,
      p.load === undefined && old ? old[28] : clip_(p.load, 80),
      p.tarp === undefined && old ? old[29] : (['Yes', 'No'].indexOf(p.tarp) >= 0 ? p.tarp : ''),
      scAgainText_(old ? old[30] : '', p.again, user), dkText, dkTot, dkVar,
      p.ph1img ? scPhoto_(p.ph1img, no, plate, 1) || (old ? old[34] : '') : (old ? old[34] : ''), p.ph2img ? scPhoto_(p.ph2img, no, plate, 2) || (old ? old[35] : '') : (old ? old[35] : ''),
      p.empty1 === undefined && old ? old[36] : (['Yes', 'No'].indexOf(p.empty1) >= 0 ? p.empty1 : '')];   // Empty truck tick at the 1st weigh (Kim, 12 Nov 2026)
    let row;
    if (old) {
      row = idx + 2;
      const log = [];
      SC_TK_COLS.forEach((h, i) => {
        if ((i >= 22 && i < 28) || i >= 34) return;   // PDF, operator, times: not logged
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
    // A plate the Fuel list doesn't have yet is added there (one truck list); its first empty weight fills Actual Vehicle Weight.
    const t = known[scNorm_(plate)];
    if (!t) { scAddTruck_({ plate: plate, company: vals[3], empty: status === 'Done' ? tare : '' }, user); known[scNorm_(plate)] = { plate: plate, empty: tare }; }
    else if (status === 'Done' && t.empty === '' && tare !== '') { scSetTruck_({ plate: plate, empty: tare }, user, 'Auto from first weigh'); t.empty = tare; }
    // A new customer or item typed on the scale joins its one list too (Customer tab of SSK-DELIVERY-DATA, Item List).
    if (vals[4] && custs.indexOf(vals[4].toLowerCase()) < 0) { scMasterAdd_('customer', { id: '', name: vals[4] }, user); custs.push(vals[4].toLowerCase()); }
    if (vals[5] && items.indexOf(vals[5].toLowerCase()) < 0) { scMasterAdd_('item', { name: vals[5], unit: 'kg', active: 'Yes' }, user); items.push(vals[5].toLowerCase()); }
    out.push({ cid: cid, no: no, row: row, pdf: pdf, ph1: vals[34], ph2: vals[35] });
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
/** Webcam photo of the truck at the 1st (n = 1) or 2nd (n = 2) weigh (Kim, 10 Nov 2026): Drive folder "Scale Truck Photos". */
function scPhoto_(dataUrl, no, plate, n) {
  const m = String(dataUrl || '').match(/^data:image\/jpeg;base64,(.+)$/);
  if (!m) return '';
  const bytes = Utilities.base64Decode(m[1]);
  if (!bytes.length || bytes.length > MAX_IMG_BYTES) return '';
  const props = PropertiesService.getScriptProperties();
  let f = null, id = props.getProperty('SC_PHOTO_FOLDER_ID');
  if (id) { try { f = DriveApp.getFolderById(id); } catch (e) { f = null; } }
  if (!f) { f = DriveApp.createFolder('Scale Truck Photos'); props.setProperty('SC_PHOTO_FOLDER_ID', f.getId()); }
  const name = no + '_' + plate.replace(/[^A-Z0-9\-]/g, '') + '_' + (n === 1 ? '1st' : '2nd') + '.jpg';
  const old = f.getFilesByName(name);
  while (old.hasNext()) old.next().setTrashed(true);
  const file = f.createFile(Utilities.newBlob(bytes, 'image/jpeg', name));
  try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (e) {}   // so the app can show it
  return file.getUrl();
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

// ---------------------------------------------------------------- ticket PDF from Kim's Word template (Kim, 6 Nov 2026)
// DE Settings SCALE_TEMPLATE_LINK = a Drive link to a Word file, a Google Doc, or a folder (the newest one in it is used).
// The Word file keeps {{tags}} such as {{TicketNo}} and {{Net}}; a picture with alt text "QR" becomes the ticket's QR code.
// Only Drive is used (no Docs scope): the tags are filled inside the .docx, Google turns it into a Doc, the Doc is
// exported as PDF and thrown away. web/scale/scale-ticket-template.docx is the starting template.
const SC_DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const SC_GDOC = 'application/vnd.google-apps.document';
const scAuth_ = () => ({ Authorization: 'Bearer ' + ScriptApp.getOAuthToken() });

/** The Word template for the app to draw on the scale PC (keeps the template's own fonts, which Google can't print).
 *  Sends the file only when it changed since the app's copy (p.stamp). */
function scTemplate_(p) {
  const key = p && p.size === 'A5' && String(setting_('SCALE_TEMPLATE_A5_LINK') || '').trim() ? 'SCALE_TEMPLATE_A5_LINK' : 'SCALE_TEMPLATE_LINK';
  const link = String(setting_(key) || '').trim();
  if (!link) return { none: true };
  const f = scTemplateFile_(key);
  const stamp = f.getId() + '@' + f.getLastUpdated().getTime();
  if (p && p.stamp === stamp) return { same: true, stamp: stamp };
  return { stamp: stamp, name: f.getName(), size: key === 'SCALE_TEMPLATE_A5_LINK' ? 'A5' : 'A4', b64: Utilities.base64Encode(scDocxOf_(f)) };
}
// Debit Note Excel template (Kim, 12 Nov 2026): kept in Drive SSK-WEIGHT so Kim can change it; the app fills it.
const SC_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const SC_GSHEET = 'application/vnd.google-apps.spreadsheet';
function scDnTemplate_(p) {
  const def = SC_SETTINGS.filter(r => r[0] === 'SCALE_DEBIT_NOTE_LINK')[0][1];
  const link = String(setting_('SCALE_DEBIT_NOTE_LINK') || def).trim();
  const m = link.match(/\/d\/([-\w]{20,})|\/folders\/([-\w]{20,})|[?&]id=([-\w]{20,})|^([-\w]{20,})$/);
  if (!m) fail_('SETUP', 'SCALE_DEBIT_NOTE_LINK is not a Google Drive link.', 'SCALE_DEBIT_NOTE_LINK មិនមែនជា Link Google Drive ទេ។');
  let f = null;
  if (m[2]) {
    const it = DriveApp.getFolderById(m[2]).getFiles();
    while (it.hasNext()) {
      const x = it.next();
      if (x.isTrashed() || [SC_XLSX, SC_GSHEET].indexOf(x.getMimeType()) < 0 || !/debit/i.test(x.getName())) continue;
      if (!f || x.getLastUpdated() > f.getLastUpdated()) f = x;
    }
    if (!f) fail_('SETUP', 'No Debit Note Excel file in the folder.', 'គ្មានឯកសារ Excel Debit Note ក្នុង Folder។');
  } else f = DriveApp.getFileById(m[1] || m[3] || m[4]);
  const stamp = f.getId() + '@' + f.getLastUpdated().getTime();
  if (p && p.stamp === stamp) return { same: true, stamp: stamp };
  let bytes;
  if (f.getMimeType() === SC_GSHEET) {
    const r = UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files/' + f.getId() + '/export?mimeType=' + encodeURIComponent(SC_XLSX), { headers: scAuth_(), muteHttpExceptions: true });
    if (r.getResponseCode() !== 200) fail_('SERVER', 'Could not read the Debit Note template (' + r.getResponseCode() + ').');
    bytes = r.getBlob().getBytes();
  } else bytes = f.getBlob().getBytes();
  return { stamp: stamp, name: f.getName(), b64: Utilities.base64Encode(bytes) };
}

/** Next Debit Note number for the prefix (e.g. CK-2611 gives CK-2611-0001), logged in the "Debit Notes" tab with Data Entry's numbers. */
function scDnNo_(p, user) {
  const prefix = clip_(p.prefix, 30).toUpperCase().replace(/[^A-Z0-9-]/g, '');
  if (!/^[A-Z0-9]{1,8}-\d{4}$/.test(prefix)) fail_('BAD', 'Bad Debit Note prefix.');
  // the same tickets again (a reprint) get their first number back: key in column K "Tickets Key" (Kim, 12 Nov 2026)
  const sh = sheet_(SH.DN, DN_COLS), key = clip_(p.key, 60);
  if (sh.getRange(1, DN_COLS.length + 1).getDisplayValue() !== 'Tickets Key') sh.getRange(1, DN_COLS.length + 1).setValue('Tickets Key');
  if (key && sh.getLastRow() > 1) {
    const hit = sh.getRange(2, 1, sh.getLastRow() - 1, DN_COLS.length + 1).getDisplayValues().find(r => r[DN_COLS.length] === key);
    if (hit) return { no: hit[0], again: true };
  }
  const no = prefix + '-' + ('000' + ((dnSeq_()[prefix] || 0) + 1)).slice(-4);
  sh.appendRow([no, clip_(p.company), clip_(p.dest), new Date(), clip_(p.period), num_(p.trips), num_(p.qty), '', user.name, new Date(), key]);
  return { no: no };
}

/** The template file the link points at (a folder link gives its newest Word file or Google Doc). */
function scTemplateFile_(key) {
  key = key || 'SCALE_TEMPLATE_LINK';
  const link = String(setting_(key) || '').trim();
  const m = link.match(/\/d\/([-\w]{20,})|\/folders\/([-\w]{20,})|[?&]id=([-\w]{20,})|^([-\w]{20,})$/);
  if (!m) fail_('SETUP', key + ' is not a Google Drive link.', key + ' មិនមែនជា Link Google Drive ទេ។');
  if (!m[2]) return DriveApp.getFileById(m[1] || m[3] || m[4]);
  let f = null;
  const it = DriveApp.getFolderById(m[2]).getFiles();
  while (it.hasNext()) {
    const x = it.next();
    if (x.isTrashed() || [SC_DOCX, SC_GDOC].indexOf(x.getMimeType()) < 0) continue;
    if (!f || x.getLastUpdated() > f.getLastUpdated()) f = x;
  }
  if (!f) fail_('SETUP', 'No Word file or Google Doc in the template folder.', 'គ្មានឯកសារ Word ក្នុង Folder គំរូ។');
  return f;
}
function scDocxOf_(f) {
  if (f.getMimeType() !== SC_GDOC) return f.getBlob().getBytes();
  const r = UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files/' + f.getId() + '/export?mimeType=' + encodeURIComponent(SC_DOCX), { headers: scAuth_(), muteHttpExceptions: true });
  if (r.getResponseCode() !== 200) fail_('SERVER', 'Could not read the template (' + r.getResponseCode() + ').');
  return r.getBlob().getBytes();
}

/** The template as .docx bytes, or null when no link is set. */
function scTemplateDocx_() {
  const link = String(setting_('SCALE_TEMPLATE_LINK') || '').trim();
  if (!link) return null;
  const m = link.match(/\/d\/([-\w]{20,})|\/folders\/([-\w]{20,})|[?&]id=([-\w]{20,})|^([-\w]{20,})$/);
  if (!m) fail_('SETUP', 'SCALE_TEMPLATE_LINK is not a Google Drive link.', 'SCALE_TEMPLATE_LINK មិនមែនជា Link Google Drive ទេ។');
  let f = null;
  if (m[2]) {
    const it = DriveApp.getFolderById(m[2]).getFiles();
    while (it.hasNext()) {
      const x = it.next();
      if (x.isTrashed() || [SC_DOCX, SC_GDOC].indexOf(x.getMimeType()) < 0) continue;
      if (!f || x.getLastUpdated() > f.getLastUpdated()) f = x;
    }
    if (!f) fail_('SETUP', 'No Word file or Google Doc in the template folder.', 'គ្មានឯកសារ Word ក្នុង Folder គំរូ។');
  } else f = DriveApp.getFileById(m[1] || m[3] || m[4]);
  if (f.getMimeType() !== SC_GDOC) return f.getBlob().getBytes();
  const r = UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files/' + f.getId() + '/export?mimeType=' + encodeURIComponent(SC_DOCX), { headers: scAuth_(), muteHttpExceptions: true });
  if (r.getResponseCode() !== 200) fail_('SERVER', 'Could not read the template (' + r.getResponseCode() + ').');
  return r.getBlob().getBytes();
}

const scXml_ = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** Fills the {{tags}} (Word may split a tag over several runs) and swaps the "QR" picture. Returns .docx bytes. */
function scFillDocx_(bytes, vals, qrPng) {
  const files = Utilities.unzip(Utilities.newBlob(bytes, 'application/zip'));
  const byName = {};
  files.forEach(b => { byName[b.getName()] = b; });
  const T = '(?:<[^>]*>)*';
  const re = new RegExp('\\{' + T + '\\{((?:' + T + '[A-Za-z0-9_])+)' + T + '\\}' + T + '\\}', 'g');
  const text = v => scXml_(v == null ? '' : v).split('\n').join('</w:t><w:br/><w:t xml:space="preserve">');
  const out = [];
  let qrTarget = '';
  files.forEach(b => {
    const n = b.getName();
    if (!/^word\/(document|header\d*|footer\d*)\.xml$/.test(n)) { out.push(b); return; }
    let x = b.getDataAsString('UTF-8');
    x = x.replace(re, (all, k) => { const key = k.replace(/<[^>]*>/g, ''); return Object.prototype.hasOwnProperty.call(vals, key) ? text(vals[key]) : all; });
    x = x.replace(/<w:t>/g, '<w:t xml:space="preserve">');
    if (n === 'word/document.xml' && qrPng) {
      const at = x.search(/<wp:docPr\b[^>]*(?:descr|title|name)="QR"/i);
      if (at >= 0) {
        const emb = x.slice(at).match(/r:embed="([^"]+)"/);
        const rels = byName['word/_rels/document.xml.rels'];
        if (emb && rels) {
          const rx = rels.getDataAsString('UTF-8').match(new RegExp('<Relationship[^>]*Id="' + emb[1] + '"[^>]*>'));
          const tg = rx && rx[0].match(/Target="([^"]+)"/);
          if (tg) qrTarget = 'word/' + tg[1].replace(/^\.?\//, '').replace(/^word\//, '');
        }
      }
    }
    out.push(Utilities.newBlob(x, 'application/xml', n));
  });
  if (qrTarget) {
    const i = out.findIndex(b => b.getName() === qrTarget);
    const type = /\.jpe?g$/i.test(qrTarget) ? 'image/jpeg' : 'image/png';
    if (i >= 0 && type === 'image/png') out[i] = Utilities.newBlob(Utilities.base64Decode(qrPng), 'image/png', qrTarget);
  }
  return Utilities.zip(out, 'ticket.docx').getBytes();
}

/** Google turns the .docx into a Doc for a moment; the PDF of it comes back. */
function scDocxPdf_(docx, name) {
  const b = 'sctk' + Date.now();
  const meta = { name: name + ' (temp)', mimeType: SC_GDOC, parents: [scPdfFolder_().getId()] };
  const bytes = s => Utilities.newBlob(s).getBytes();
  const payload = bytes('--' + b + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' + JSON.stringify(meta) + '\r\n--' + b + '\r\nContent-Type: ' + SC_DOCX + '\r\n\r\n')
    .concat(docx, bytes('\r\n--' + b + '--'));
  const up = UrlFetchApp.fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', {
    method: 'post', contentType: 'multipart/related; boundary=' + b, payload: payload, headers: scAuth_(), muteHttpExceptions: true });
  if (up.getResponseCode() !== 200) fail_('SERVER', 'Template upload failed (' + up.getResponseCode() + '): ' + up.getContentText().slice(0, 150));
  const id = JSON.parse(up.getContentText()).id;
  try {
    const ex = UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files/' + id + '/export?mimeType=application/pdf', { headers: scAuth_(), muteHttpExceptions: true });
    if (ex.getResponseCode() !== 200) fail_('SERVER', 'PDF export failed (' + ex.getResponseCode() + ').');
    return ex.getBlob().setName(name + '.pdf').setContentType('application/pdf');
  } finally {
    try { DriveApp.getFileById(id).setTrashed(true); } catch (e) { /* already gone */ }
  }
}

/** Saved warnings are English ("a | b"); the ticket prints them in Khmer (Kim, 12 Nov 2026). Same words as scale-core.js warnKm. */
function scWarnKm_(en) {
  return String(en || '').split(' | ').map(function (t) {
    var m = t.match(/^Empty weight (.+) kg is (\d+)% (above|below) the truck list \((.+) kg\)$/);
    if (m) return 'ទម្ងន់ឡានទទេ ' + m[1] + ' kg ' + (m[3] === 'above' ? 'លើស' : 'ខ្វះ') + ' ' + m[2] + '% ពីបញ្ជីឡាន (' + m[4] + ' kg)';
    m = t.match(/^Overload: gross (.+) kg is over the limit (.+) kg \(\+(.+) kg\)$/);
    if (m) return 'ផ្ទុកលើសទម្ងន់: ' + m[1] + ' kg លើសកំណត់ ' + m[2] + ' kg (+' + m[3] + ' kg)';
    m = t.match(/^Overload: goods (.+) kg is over the allowed (.+) kg \(\+(.+) kg\)$/);
    if (m) return 'ផ្ទុកលើសទម្ងន់: ទំនិញ ' + m[1] + ' kg លើសកំណត់ ' + m[2] + ' kg (+' + m[3] + ' kg)';
    m = t.match(/^Heavier than the last scale-again weight by (.+) kg$/);
    if (m) return 'ធ្ងន់ជាងការថ្លឹងម្តងទៀតចុងក្រោយ ' + m[1] + ' kg';
    m = t.match(/^DN total (.+) kg differs from the scale net by (.+) kg \(allowed ±(.+) kg\)$/);
    if (m) return 'ទម្ងន់ DN សរុប ' + m[1] + ' kg ខុសពីទម្ងន់សុទ្ធ ' + m[2] + ' kg (អនុញ្ញាត ±' + m[3] + ' kg)';
    m = t.match(/^Net weight is (.+) kg$/);
    if (m) return 'ទម្ងន់សុទ្ធ ' + m[1] + ' kg';
    return t;
  }).join(' | ');
}

/** The words for each {{tag}}, from the ticket the app sends. */
function scTicketVals_(x) {
  const num = v => (v === '' || v == null || isNaN(v) ? '' : Number(v).toLocaleString('en-US', { maximumFractionDigits: 2 }));
  const s = v => String(v || '');
  const dmy = v => (s(v) ? s(v).slice(8, 10) + '/' + s(v).slice(5, 7) + '/' + s(v).slice(0, 4) : '');
  const when = v => (s(v) ? dmy(v) + ' ' + s(v).slice(11, 16) : '');
  const src = v => (v === 'Manual' ? 'TYPED BY HAND' : v === 'Simulator' ? 'TEST (simulator)' : '');
  const dns = Array.isArray(x.dns) ? x.dns : s(x.dns).split(/[,\s]+/).filter(Boolean);
  return {
    TicketNo: s(x.no), Date: dmy(x.t2 || x.t1), TruckNo: s(x.plate), Company: s(x.company), Item: s(x.item), Destination: s(x.dest), Tarp: x.tarp === 'Yes' ? 'គ្របតង់' : x.tarp === 'No' ? 'មិនគ្របតង់' : '', EmptyTruck: x.empty1 === 'Yes' ? 'ឡានទទេ' : '',
    DN: dns.join(', '), DNCount: String(dns.length), Note: s(x.note), Customer: s(x.customer), Driver: s(x.driver), Type: x.type === 'In' ? 'ទំលាក់ទំនិញ' : x.type === 'Out' ? 'ឡើងទំនិញ' : '',
    Weight1: num(x.w1), Time1: when(x.t1), Source1: src(x.s1), Weight2: num(x.w2), Time2: when(x.t2), Source2: src(x.s2),
    Gross: num(x.gross), Tare: num(x.tare), Net: num(x.net), Warning: x.warn ? 'ការព្រមាន: ' + scWarnKm_(s(x.warn)) : '',
    Operator: s(x.op), Status: x.status === 'Void' ? 'CANCELLED' : x.status === 'Open' ? 'NOT FINISHED' : '',
    Printed: fmt_(new Date(), 'dd/MM/yyyy HH:mm'), CompanyName: s(setting_('SCALE_COMPANY') || 'ISI STEEL'),
  };
}

/** PDF of one ticket from the Word template: saved in "Scale Tickets PDF", its link written on the ticket row. */
function scTicketPdf_(p, user) {
  const x = p.t || {};
  if (!x.no || !x.plate) fail_('BAD', 'Ticket missing.');
  const docx = scTemplateDocx_();
  if (!docx) return { none: true };
  const qr = String(p.qr || '').replace(/^data:image\/png;base64,/, '');
  const name = clip_(x.no, 40) + '_' + String(x.plate).toUpperCase().replace(/[^A-Z0-9\-]/g, '');
  const pdf = scDocxPdf_(scFillDocx_(docx, scTicketVals_(x), qr), name);
  const f = scPdfFolder_();
  const old = f.getFilesByName(name + '.pdf');
  while (old.hasNext()) old.next().setTrashed(true);
  const url = f.createFile(pdf).getUrl();
  if (x.cid) {
    const sh = sheet_(SC.TK, SC_TK_COLS);
    const n = sh.getLastRow() - 1;
    if (n > 0) {
      const ids = sh.getRange(2, 28, n, 1).getDisplayValues();
      for (let i = 0; i < n; i++) if (ids[i][0] === String(x.cid)) { sh.getRange(i + 2, 23).setValue(url); break; }
    }
  }
  return { url: url, pdf: Utilities.base64Encode(pdf.getBytes()) };
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
/** Admin adds or replaces a truck's photo (Kim, 8 Nov 2026): saved in Drive, link in the Truck tab's Photo column. */
function scTruckPhoto_(p, user) {
  if (!user.admin) fail_('DENIED', 'Admins only.', 'សម្រាប់ Admin ប៉ុណ្ណោះ។');
  const plate = String(p.plate || '').trim();
  const m = String(p.img || '').match(/^data:(image\/(?:jpeg|png));base64,(.+)$/);
  if (!plate || !m) fail_('BAD', 'Pick a photo.', 'សូមជ្រើសរូបថត។');
  const bytes = Utilities.base64Decode(m[2]);
  if (bytes.length > MAX_IMG_BYTES) fail_('BAD', 'Photo is too big.', 'រូបថតធំពេក។');
  const { sh, head } = scTruckSheet_();
  const cp = head.indexOf('CODE'), cph = head.indexOf('Photo');
  const n = sh.getLastRow() - 1;
  const plates = n > 0 ? sh.getRange(2, cp + 1, n, 1).getDisplayValues().map(r => scNorm_(r[0])) : [];
  const at = plates.indexOf(scNorm_(plate));
  if (at < 0) fail_('BAD', 'This truck is not in the Truck list.', 'ឡាននេះមិនទាន់មានក្នុងបញ្ជីឡាន។');
  const name = 'Truck_' + plate.replace(/[^0-9A-Za-z\-]/g, '') + (m[1] === 'image/png' ? '.png' : '.jpg');
  const f = folder_();
  const old = f.getFilesByName(name);
  while (old.hasNext()) old.next().setTrashed(true);
  const file = f.createFile(Utilities.newBlob(bytes, m[1], name));
  try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (e) {}   // so the app can show it
  const cellR = sh.getRange(at + 2, cph + 1), before = cellR.getDisplayValue();
  cellR.setValue(file.getUrl());
  scLog_(user, 'Truck ' + plate, 'Truck photo', 'Photo', before, file.getUrl(), '');
  return { trucks: scTrucks_() };
}
/** Sets company / type / empty / max on the plate's row of the Truck tab. */
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
    const v = clip_(p[def[0]], def[0] === 'SCALE_TABLE_COLS' ? 20000 : def[0] === 'SCALE_DNC_USERS' || def[0] === 'SCALE_REPORT_COLS' ? 3000 : 200);
    const i = keys.indexOf(def[0]);
    if (i >= 0) {
      const before = sh.getRange(i + 2, 2).getDisplayValue();
      if (before !== v) { sh.getRange(i + 2, 2).setValue(v); scLog_(user, 'Settings', 'Change setting', def[0], before, v, ''); }
    } else { sh.appendRow([def[0], v, def[2]]); keys.push(def[0]); }
  });
  return { settings: scSettingsMap_() };
}
