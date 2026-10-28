// Tests for Inbound.gs with the Apps Script mock. Run: node apps-script-inbound/tests/run.js
'use strict';
const path = require('path');
const assert = require('assert');
const { makeEnv } = require('./gas-ib');

const ROOT = path.join(__dirname, '..', '..');
let pass = 0;
const ok = (c, m) => { assert.ok(c, m); pass++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); pass++; };

const USERS = [
  ['Email', 'Name', 'Role', 'Active', 'ទទួលទំនិញ'],
  ['kim@x.com', 'Kim', 'admin', 'Yes', false],
  ['sok@x.com', 'Sokha', 'user', 'Yes', true],
  ['dara@x.com', 'Dara', 'user', 'Yes', true],
  ['nobody@x.com', 'Nobody', 'user', 'Yes', false],
];
const TRUCKS = [['CODE', 'ឈ្មោះតៃកុង'], ['3E-2588', 'A'], ['2A-2233', 'B']];
const PHOTO = 'data:image/jpeg;base64,' + Buffer.from('jpeg-photo').toString('base64');

const env = makeEnv({ file: path.join(ROOT, 'apps-script-inbound/Inbound.gs'), users: USERS.map(r => r.slice()), trucks: TRUCKS,
  props: { SESSION_SECRET: 's3cret', USERS_SHEET_ID: 'USERS', GOOGLE_CLIENT_ID: 'cid', TELEGRAM_BOT_TOKEN: 'bot' } });
env.g.setup();
eq(env.ss.getSheets().map(s => s.getName()), ['Incoming Plan', 'GR Log', 'Receipts', 'IB Settings', 'Email Lists'], 'tabs (empty Sheet1 removed)');
ok(env.props.IB_FOLDER_ID, 'photo folder made');

// Kim pastes the Incoming Packing List (dates and numbers as Sheets gives them)
const plan = env.ss.getSheetByName('Incoming Plan');
const eta = new Date(2026, 9, 18);
plan.rows.push([1, 1100000230, 'INTANU G300AZ30 BT 1200x0.260', 'KMH1', 1020, 32520, 32.52, 7, '', 1, 'PO5100012725', 'Test IN 1800048956', '1072003238-Lot1', eta, 'Regency']);
plan.rows.push([2, 1100000231, 'INTANU G300AZ30 BR 1200x0.220', 'KMH1', 1020, 23550, 23.55, 5, '', 1, 'PO5100012725', 'Test IN 1800048956', '1072003238-Lot1', eta, 'Regency']);
plan.rows.push([3, 1200000101, 'ZINC INGOT', 'KMH1', 1020, 25000, 25, 1000, '', 1, 'PO5100012751', 'IN 1', 'ZN-1', eta, 'Zinc Co']);
env.ss.getSheetByName('IB Settings').rows[1][1] = '-100123';   // TELEGRAM_CHAT_ID

const call = (who, action, payload) => env.post({ action, token: env.session(who), payload });
const must = r => { if (!r.ok) throw new Error(r.error); return r.data; };

// access
ok(/^NOACCESS/.test(call('nobody@x.com', 'boot', {}).error), 'unticked user refused');
ok(/^AUTH/.test(env.post({ action: 'boot', token: '', payload: {} }).error), 'no token refused');
let b = must(call('sok@x.com', 'boot', {}));
eq(b.plan.length, 3, 'plan lines');
eq(b.plan[0], { po: 'PO5100012725', material: '1100000230', desc: 'INTANU G300AZ30 BT 1200x0.260', kg: 32520, pcs: '7', inbound: 'Test IN 1800048956',
  ref: '1072003238-Lot1', eta: '2026-10-18', supplier: 'Regency', plant: 'KMH1', sloc: '1020' }, 'plan line read by heading');
eq(b.plates, ['2A-2233', '3E-2588'], 'plates from Driver & Truck');
eq(b.carriers, ['FOXS', 'Queen Legacy', 'Srong Sal', 'Chroek Kimheng'], '3PL list from settings');
ok(must(call('kim@x.com', 'boot', {})).user.admin, 'admin without tick');

// arrival
const ARR = { po: 'PO5100012725', truck: '3e 2588', dn3pl: 'DN-778', ph: { front: PHOTO, load: PHOTO, doc: PHOTO },
  items: [{ material: '1100000230', arrQty: 20000 }, { material: '1100000231', arrQty: '23,550' }] };
ok(/Take the 3 photos/.test(call('sok@x.com', 'start', { receipt: Object.assign({}, ARR, { ph: { front: PHOTO } }) }).error), 'photos required');
ok(/not on this PO/.test(call('sok@x.com', 'start', { receipt: Object.assign({}, ARR, { items: [{ material: '1200000101', arrQty: 5 }] }) }).error), 'item of another PO refused');
ok(/Arrival Qty/.test(call('sok@x.com', 'start', { receipt: Object.assign({}, ARR, { items: [{ material: '1100000230', arrQty: '' }] }) }).error), 'arrival qty required');
ok(/3PL DN/.test(call('sok@x.com', 'start', { receipt: Object.assign({}, ARR, { dn3pl: '' }) }).error), '3PL DN required');
let r = must(call('sok@x.com', 'start', { receipt: ARR }));
ok(/^IB-\d{6}-01$/.test(r.id), 'receipt id ' + r.id);
eq([r.status, r.truck, r.end, r.by, r.supplier, r.inbound], ['Unloading', '3E2588', '', 'Sokha', 'Regency', 'Test IN 1800048956']);
eq(r.items.map(i => [i.poQty, i.arrQty]), [[32520, 20000], [23550, 23550]], 'qty from plan + typed');
ok(PHOTOS_SAVED(r), 'photos saved as Drive ids');
function PHOTOS_SAVED(x) { return ['front', 'load', 'doc'].every(k => env.files[x.ph[k]] && env.files[x.ph[k]].name); }
eq(env.telegrams.length, 1, 'arrival posted');
ok(/Truck arrived 3E2588/.test(env.telegrams[0].payload.text), 'arrival text');
const r2 = must(call('dara@x.com', 'start', { receipt: Object.assign({}, ARR, { items: [{ material: '1100000230', arrQty: 12520 }] }) }));
ok(/-02$/.test(r2.id), 'second id');
const log = () => env.ss.getSheetByName('GR Log').rows.slice(1).filter(x => x && x[0]);
eq(log().length, 3, 'one log row per item');

// finish
const FIN = { id: r.id, owner: '3PL', carrier: 'FOXS', manpower: 3, remark: 'ok',
  items: [{ material: '1100000230', grQty: 19800, dmgQty: 2, dmgType: 'rust', dmgPh: [PHOTO] }, { material: '1100000231', grQty: 23550, dmgQty: '' }] };
ok(/Manpower/.test(call('dara@x.com', 'finish', { receipt: Object.assign({}, FIN, { manpower: '' }) }).error), 'manpower required');
ok(/damage photo/.test(call('dara@x.com', 'finish', { receipt: Object.assign({}, FIN, { items: [{ material: '1100000230', grQty: 1, dmgQty: 1, dmgType: 'dent' }, { material: '1100000231', grQty: 1 }] }) }).error), 'damage photo required');
ok(/Actual GR Qty/.test(call('dara@x.com', 'finish', { receipt: Object.assign({}, FIN, { items: [{ material: '1100000230', grQty: '' }] }) }).error), 'GR qty required');
r = must(call('dara@x.com', 'finish', { receipt: FIN }));
eq([r.status, r.owner, r.carrier, r.manpower, r.finishedBy], ['Done', '3PL', 'FOXS', 3, 'Dara']);
eq(r.items.map(i => [i.grQty, i.dmgQty, i.dmgType, i.dmgPh.length]), [[19800, 2, 'rust', 1], [23550, 0, '', 0]]);
ok(/^\d\d:\d\d$/.test(r.end), 'end time stamped');
const row = log().find(x => x[8] === '1100000230' && x[0] === r.id);
eq([row[1], row[13], row[14], row[15], row[16], row[24], row[25]], ['Done', '19800', '2', 'Rust', 'Yes', '3PL Truck', 'FOXS'], 'log row');
eq(log().length, 3, 'rows replaced, not added');
ok(env.telegrams.some(t => /Received less/.test(t.payload.text) && /Damaged/.test(t.payload.text)), 'short + damage posted');
ok(/already finished/.test(call('sok@x.com', 'finish', { receipt: FIN }).error), 'cannot finish twice');

// edits after finishing: recorder or admin only; old photo ids kept, foreign ids dropped
ok(/^DENIED/.test(call('dara@x.com', 'save', { receipt: FIN }).error), 'other user cannot edit a done receipt');
const keepId = r.items[0].dmgPh[0];
r = must(call('kim@x.com', 'save', { receipt: Object.assign({}, FIN, { remark: 'checked', items: [{ material: '1100000230', grQty: 20000, dmgQty: 2, dmgType: 'rust', dmgPh: [keepId, 'fXYZ'] }, { material: '1100000231', grQty: 23550 }] }) }));
eq([r.remark, r.items[0].grQty, r.items[0].dmgPh], ['checked', 20000, [keepId]], 'admin edit, unknown photo id dropped');
ok(log().find(x => x[0] === r.id)[16] === '', 'no longer received less');

// photos: only files of the Inbound Photos folder
const th = must(call('sok@x.com', 'photos', { ids: [keepId, 'f1'] }));
ok(th[keepId] && /^data:image\/jpeg;base64,/.test(th[keepId]), 'thumbnail');
ok(!('f1' in th) || env.files.f1.parent !== 'root', 'files outside the folder are not read');

// boot: receipts come back; pending is worked out by the app
b = must(call('sok@x.com', 'boot', {}));
eq(b.receipts.map(x => x.id).sort(), [r.id, r2.id].sort(), 'receipts in boot');

// Incoming Plan from the app (Supervisor / Admin)
ok(/^DENIED/.test(call('sok@x.com', 'planSave', { lines: [{ po: 'PO1', material: 'M1', kg: 5 }] }).error), 'user cannot change the plan');
let pl = must(call('kim@x.com', 'planSave', { lines: [
  { po: '5100099999', material: '1300000001', desc: 'NEW A', kg: '40,000', pcs: 2, inbound: 'IN 9', ref: 'R9', eta: '2026-11-02', supplier: 'New Co' },
  { po: 'PO5100099999', material: '1300000002', desc: 'NEW B', kg: 1000 },
  { po: 'PO5100099999', material: '', kg: 5 }] }));
eq(pl.filter(x => x.po === 'PO5100099999').map(x => [x.material, x.kg, x.eta, x.supplier]), [['1300000001', 40000, '2026-11-02', 'New Co'], ['1300000002', 1000, '', '']], 'new PO added, PO prefix, bad row skipped');
eq(pl.length, 5, 'other POs kept');
// re-upload PO5100012725 without line 1100000231: received line stays, line 230 updated
pl = must(call('kim@x.com', 'planSave', { lines: [{ po: 'PO5100012725', material: '1100000230', desc: 'X', kg: 33000, supplier: 'Regency' }] }));
eq(pl.filter(x => x.po === 'PO5100012725').map(x => [x.material, x.kg]).sort(), [['1100000230', 33000], ['1100000231', 23550]], 'replace PO, keep received line');
ok(/cannot be deleted/.test(call('kim@x.com', 'planDel', { po: 'PO5100012725' }).error), 'PO with trucks cannot be deleted');
pl = must(call('kim@x.com', 'planDel', { po: 'PO5100099999' }));
eq(pl.map(x => x.po).sort(), ['PO5100012725', 'PO5100012725', 'PO5100012751'], 'PO deleted');
eq(env.ss.getSheetByName('Incoming Plan').rows.slice(1).filter(r => r && r.some(c => String(c).trim())).map(r => r[0]), ['1', '2', '3'], 'No. renumbered');

// PDF report and email
ok(/finished/.test(call('sok@x.com', 'pdf', { id: r2.id }).error), 'no PDF while unloading');
const pd = must(call('sok@x.com', 'pdf', { id: r.id }));
ok(pd.name === r.id + '.pdf' && pd.b64.length > 0, 'PDF made');
const mail = env.ss.getSheetByName('Email Lists'); ok(mail, 'Email Lists tab');
mail.rows[1][1] = 'wh1@x.com, wh2@x.com; bad';
eq(must(call('sok@x.com', 'boot', {})).lists, [{ name: 'Warehouse', count: 2 }], 'lists with emails only');
ok(/Check these/.test(call('sok@x.com', 'email', { id: r.id, extra: 'nope' }).error), 'bad email refused');
ok(/Tick a list/.test(call('sok@x.com', 'email', { id: r.id }).error), 'nobody to send to');
eq(must(call('sok@x.com', 'email', { id: r.id, lists: ['Warehouse'], extra: 'boss@x.com wh1@x.com', note: 'hi' })), { sent: 3 }, 'sent once per person');
const m = env.mails[env.mails.length - 1];
ok(Object.values(env.files).filter(f => f.name === r.id + '.pdf' && !f.trashed).length === 1, 'PDF reused, not made twice');
ok(m.to === 'wh1@x.com,wh2@x.com,boss@x.com' && m.attachments.length === 1 && /Goods receipt/.test(m.subject), 'email with PDF');

// Word template from a Drive folder: an empty folder gets the standard template, each item gets its own table row
const set = env.ss.getSheetByName('IB Settings');
env.folders.dKimInboundTemplates0001 = { id: 'dKimInboundTemplates0001', name: 'Inbound Report Template', parent: 'root', trashed: false };
const tf = env.g.DriveApp.getFolderById('dKimInboundTemplates0001');
const linkRow = set.rows.findIndex(x => x && x[0] === 'PDF_TEMPLATE_LINK');
ok(linkRow > 0, 'PDF_TEMPLATE_LINK setting');
set.rows[linkRow][1] = 'https://drive.google.com/drive/folders/' + tf.getId();
const nDocs = Object.keys(env.docs).length;
must(call('sok@x.com', 'pdf', { id: r.id }));
const seeded = Object.values(env.files).find(f => f.parent === tf.getId());
ok(seeded && /\.docx$/.test(seeded.name), 'empty folder gets the standard Word template');
const td = Object.values(env.docs).pop();
ok(Object.keys(env.docs).length === nDocs + 1 && td.tpl && env.templateUploads === 1, 'PDF filled from the Word template');
const txt = td.parts.join('\n');
ok(txt.indexOf('{{') < 0 && txt.indexOf(r.id) >= 0 && txt.indexOf(r.po) >= 0, 'placeholders filled');
eq(td.parts.filter(x => x === '1' || x === '2').length >= 1, true, 'item rows numbered');
ok(td.font === 'Kantumruy Pro', 'PDF font set');
must(call('sok@x.com', 'pdf', { id: r.id }));
ok(Object.keys(env.docs).length === nDocs + 1 && env.templateUploads === 1, 'same template: saved PDF reused');
seeded.updated = Date.now();
must(call('sok@x.com', 'pdf', { id: r.id }));
ok(Object.keys(env.docs).length === nDocs + 2 && env.templateUploads === 2, 'edited template: converted again and PDF remade');
set.rows[linkRow][1] = 'not a link';
must(call('sok@x.com', 'pdf', { id: r.id }));
ok(/not a Google Drive link/.test(set.rows.find(x => x && x[0] === 'PDF_TEMPLATE_ERROR')[1]), 'bad link: error noted, built-in layout used');

console.log('Inbound.gs: ' + pass + ' checks passed');
