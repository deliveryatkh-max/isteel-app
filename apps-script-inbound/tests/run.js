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
  ['Email', 'Name', 'Role', 'Active', 'ទទួលទំនិញ', 'Inbound Warehouse'],
  ['kim@x.com', 'Kim', 'admin', 'Yes', false, ''],
  ['sok@x.com', 'Sokha', 'user', 'Yes', true, ''],
  ['dara@x.com', 'Dara', 'user', 'Yes', true, 'WH BDM'],
  ['nobody@x.com', 'Nobody', 'user', 'Yes', false, ''],
  ['sai@x.com', 'Sai', 'reviewer', 'Yes', true, 'WH IB'],
];
const TRUCKS = [['CODE', 'ឈ្មោះតៃកុង'], ['3E-2588', 'A'], ['2A-2233', 'B']];
const PHOTO = 'data:image/jpeg;base64,' + Buffer.from('jpeg-photo').toString('base64');

const env = makeEnv({ file: path.join(ROOT, 'apps-script-inbound/Inbound.gs'), users: USERS.map(r => r.slice()), trucks: TRUCKS,
  props: { SESSION_SECRET: 's3cret', USERS_SHEET_ID: 'USERS', GOOGLE_CLIENT_ID: 'cid', TELEGRAM_BOT_TOKEN: 'bot' } });
env.g.setup();
eq(env.ss.getSheets().map(s => s.getName()), ['Incoming Plan', 'GR Log', 'Receipts', 'IB Settings', 'Email Lists', 'Warehouse List'], 'tabs (empty Sheet1 removed)');
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
  ref: '1072003238-Lot1', eta: '2026-10-18', supplier: 'Regency', plant: 'KMH1', sloc: '1020', site: '' }, 'plan line read by heading');
eq(b.plates, ['2A-2233', '3E-2588'], 'plates from Driver & Truck');
eq(b.carriers, ['FOXS', 'Queen Legacy', 'Srong Sal', 'Chroek Kimheng'], '3PL list from settings');
ok(must(call('kim@x.com', 'boot', {})).user.admin, 'admin without tick');

// arrival
const ARR = { po: 'PO5100012725', truck: '3e 2588', dn3pl: 'DN-778', ph: { front: PHOTO, load: PHOTO, doc: PHOTO },
  items: [{ material: '1100000230', arrQty: 20000 }, { material: '1100000231', arrQty: '23,550' }] };
ok(/Take the 3 photos/.test(call('sok@x.com', 'start', { receipt: Object.assign({}, ARR, { dn3pl: 'DN-' + Math.random(), ph: { front: PHOTO } }) }).error), 'photos required');
ok(/not on PO5100012725/.test(call('sok@x.com', 'start', { receipt: Object.assign({}, ARR, { dn3pl: 'DN-' + Math.random(), items: [{ material: '1200000101', arrQty: 5 }] }) }).error), 'item of another PO refused');
ok(/Arrival Qty/.test(call('sok@x.com', 'start', { receipt: Object.assign({}, ARR, { dn3pl: 'DN-' + Math.random(), items: [{ material: '1100000230', arrQty: '' }] }) }).error), 'arrival qty required');
ok(/3PL DN/.test(call('sok@x.com', 'start', { receipt: Object.assign({}, ARR, { dn3pl: 'DN-' + Math.random(), dn3pl: '' }) }).error), '3PL DN required');
// Warehouse List (Kim, 30 Oct 2026): once the tab has codes, the warehouse is required and must be on the list
const whTab = env.ss.getSheetByName('Warehouse List'); whTab.rows.push(['A1', 'Main'], ['I1', '']);
eq(must(call('sok@x.com', 'boot', {})).warehouses, [{ code: 'A1', desc: 'Main', site: '' }, { code: 'I1', desc: '', site: '' }], 'warehouses in boot');
ok(/Choose the entrance/.test(call('sok@x.com', 'start', { receipt: ARR }).error), 'entrance required');
ok(/Entrance Z9 is not in the Warehouse List/.test(call('sok@x.com', 'start', { receipt: Object.assign({}, ARR, { dn3pl: 'DN-' + Math.random(), warehouse: 'Z9' }) }).error), 'unknown warehouse refused');
ARR.warehouse = 'A1';
let r = must(call('sok@x.com', 'start', { receipt: ARR }));
eq(r.warehouse, 'A1', 'warehouse saved');
ok(/^IB-\d{6}-01$/.test(r.id), 'receipt id ' + r.id);
eq([r.status, r.truck, r.end, r.by, r.supplier, r.inbound], ['Unloading', '3E2588', '', 'Sokha', 'Regency', 'Test IN 1800048956']);
eq(r.items.map(i => [i.poQty, i.arrQty]), [[32520, 20000], [23550, 23550]], 'qty from plan + typed');
ok(PHOTOS_SAVED(r), 'photos saved as Drive ids');
function PHOTOS_SAVED(x) { return ['front', 'load', 'doc'].every(k => env.files[x.ph[k]] && env.files[x.ph[k]].name); }
eq(env.telegrams.length, 1, 'arrival posted');
ok(/Truck arrived 3E2588/.test(env.telegrams[0].payload.text), 'arrival text');
const r2 = must(call('dara@x.com', 'start', { receipt: Object.assign({}, ARR, { dn3pl: 'DN-' + Math.random(), dn3pl: 'DN-2', items: [{ material: '1100000230', arrQty: 12520 }] }) }));
ok(/-02$/.test(r2.id), 'second id');
const tg0 = env.telegrams.length, again = must(call('dara@x.com', 'start', { receipt: Object.assign({}, ARR, { dn3pl: 'DN-' + Math.random(), dn3pl: 'DN-2', items: [{ material: '1100000230', arrQty: 12520 }] }) }));
eq([again.id, env.telegrams.length], [r2.id, tg0], 'same truck + DN started twice: first record back, no second post');
const log = () => env.ss.getSheetByName('GR Log').rows.slice(1).filter(x => x && x[0]);
eq(log().length, 3, 'one log row per item');

// finish
const FIN = { id: r.id, owner: '3PL', carrier: 'FOXS', manpower: 3, remark: 'ok',
  items: [{ material: '1100000230', grQty: 19800, dmgQty: 2, dmgType: 'rust', dmgUom: 'PCS', dmgPh: [PHOTO] }, { material: '1100000231', grQty: 23550, dmgQty: '' }] };
ok(/Manpower/.test(call('dara@x.com', 'finish', { receipt: Object.assign({}, FIN, { manpower: '' }) }).error), 'manpower required');
ok(/damage photo/.test(call('dara@x.com', 'finish', { receipt: Object.assign({}, FIN, { items: [{ material: '1100000230', grQty: 1, dmgQty: 1, dmgType: 'dent' }, { material: '1100000231', grQty: 1 }] }) }).error), 'damage photo required');
ok(/Actual GR Qty/.test(call('dara@x.com', 'finish', { receipt: Object.assign({}, FIN, { items: [{ material: '1100000230', grQty: '' }] }) }).error), 'GR qty required');
r = must(call('dara@x.com', 'finish', { receipt: Object.assign({}, FIN, { voice: 'data:audio/webm;codecs=opus;base64,' + Buffer.from('OggS-voice').toString('base64') }) }));
ok(r.voice && env.files[r.voice] && /\.webm$/.test(env.files[r.voice].name), 'voice note saved');
ok(/^data:audio\/webm;base64,/.test(must(call('dara@x.com', 'voice', { id: r.id })).url), 'voice note played back');
ok(log().find(x => x[0] === r.id)[31] === 'A1', 'warehouse in GR Log');
eq([r.status, r.owner, r.carrier, r.manpower, r.finishedBy], ['Done', '3PL', 'FOXS', 3, 'Dara']);
eq(r.items.map(i => [i.grQty, i.dmgQty, i.dmgType, i.dmgPh.length]), [[19800, 2, 'rust', 1], [23550, 0, '', 0]]);
ok(/^\d\d:\d\d$/.test(r.end), 'end time stamped');
eq(r.items.map(i => i.dmgUom), ['PCS', ''], 'damage UoM kept');
ok(log().find(x => x[0] === r.id && x[8] === '1100000230')[33] === 'PCS', 'damage UoM in GR Log');
ok(env.telegrams.some(t => /2 PCS/.test(t.payload.text)), 'damage UoM in Telegram');
const row = log().find(x => x[8] === '1100000230' && x[0] === r.id);
eq([row[1], row[13], row[14], row[15], row[16], row[24], row[25]], ['Done', '19800', '2', 'Rust', 'Yes', '3PL Truck', 'FOXS'], 'log row');
eq(log().length, 3, 'rows replaced, not added');
ok(env.telegrams.some(t => /Received less/.test(t.payload.text) && /Damaged/.test(t.payload.text)), 'short + damage posted');
{ const fin = env.telegrams.filter(t => /Finished 3E2588/.test(t.payload.text)).pop();
  ok(fin && fin.payload.reply_to_message_id === String(r.tg) && r.tg > 0, 'finish posted as a reply to the arrival post'); }
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
ok(/^data:image\/jpeg;base64,/.test(must(call('sok@x.com', 'photo', { id: keepId })).url), 'full photo');
ok(must(call('sok@x.com', 'photo', { id: 'nope' })).url === '', 'unknown photo gives empty url');

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
eq(must(call('sok@x.com', 'mailTo', { lists: ['Warehouse', 'Nope'] })).emails, ['wh1@x.com', 'wh2@x.com'], 'list addresses for the Outlook draft');
ok(Object.values(env.files).filter(f => f.name === r.id + '.pdf' && !f.trashed).length === 1, 'PDF reused, not made twice');
ok(m.to === 'wh1@x.com,wh2@x.com,boss@x.com' && m.attachments.length === 1 && /Goods receipt/.test(m.subject), 'email with PDF');
eq(must(call('sok@x.com', 'email', { id: r.id, extra: '"Sonal Heng" <Sonal.Heng@x.com>, Dara <d@x.com>;' })), { sent: 2 }, 'Outlook-style names pasted');

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
ok(td.parts[2] === ' ', 'barcode picture in place of {{barcode}}');
{ const png = Buffer.from(env.g.barcodePng_('IB-261028-02').getBytes().map(v => v & 255)); ok(png.slice(1, 4).toString() === 'PNG' && png.length > 1000, 'barcode PNG made'); }
must(call('sok@x.com', 'pdf', { id: r.id }));
ok(Object.keys(env.docs).length === nDocs + 1 && env.templateUploads === 1, 'same template: saved PDF reused');
seeded.updated = Date.now();
must(call('sok@x.com', 'pdf', { id: r.id }));
ok(Object.keys(env.docs).length === nDocs + 2 && env.templateUploads === 2, 'edited template: converted again and PDF remade');
set.rows[linkRow][1] = 'not a link';
must(call('sok@x.com', 'pdf', { id: r.id }));
ok(/not a Google Drive link/.test(set.rows.find(x => x && x[0] === 'PDF_TEMPLATE_ERROR')[1]), 'bad link: error noted, built-in layout used');

// Arrival Qty: only reviewers / admins can change it after arrival
{ const ra = must(call('sok@x.com', 'start', { receipt: Object.assign({}, ARR, { dn3pl: 'DN-' + Math.random(), items: [{ material: '1100000231', arrQty: 1000 }] }) }));
  const it = [{ material: '1100000231', arrQty: 900, grQty: '' }];
  eq(must(call('sok@x.com', 'save', { receipt: { id: ra.id, items: it } })).items[0].arrQty, 1000, 'user cannot change Arrival Qty');
  eq(must(call('kim@x.com', 'save', { receipt: { id: ra.id, items: it } })).items[0].arrQty, 900, 'admin changes Arrival Qty'); }
// delete (Kim, 3 Nov 2026): admin only, only while unloading; copy kept in IB Deleted
{ const d = must(call('sok@x.com', 'start', { receipt: Object.assign({}, ARR, { dn3pl: 'DEL-1', items: [{ material: '1100000231', arrQty: 5 }] }) }));
  ok(/Only an admin/.test(call('sok@x.com', 'delete', { id: d.id }).error), 'non-admin cannot delete');
  ok(/still unloading/.test(call('kim@x.com', 'delete', { id: r.id }).error), 'finished record cannot be deleted');
  eq(must(call('kim@x.com', 'delete', { id: d.id, reason: 'double start' })), { deleted: d.id }, 'admin deletes');
  ok(!must(call('kim@x.com', 'boot', {})).receipts.some(x => x.id === d.id), 'gone from receipts');
  ok(!log().some(x => x[0] === d.id), 'gone from GR Log');
  const bin = env.ss.getSheetByName('IB Deleted').rows; ok(bin.some(x => x[3] === d.id && x[2] === 'double start' && x[1] === 'Kim'), 'copy in IB Deleted'); }
// photo stamp: the receipt no. is reserved before Start and used by it
{ const a = must(call('sok@x.com', 'reserve', {})).id, b = must(call('dara@x.com', 'reserve', {})).id;
  ok(/^IB-\d{6}-\d+$/.test(a) && a !== b, 'reserved ids differ ' + a + ' ' + b);
  const rb = must(call('dara@x.com', 'start', { receipt: Object.assign({}, ARR, { dn3pl: 'DN-' + Math.random(), id: b, items: [{ material: '1100000231', arrQty: 10 }] }) }));
  eq(rb.id, b, 'start uses the reserved id');
  const rx = must(call('sok@x.com', 'start', { receipt: Object.assign({}, ARR, { dn3pl: 'DN-' + Math.random(), id: b, items: [{ material: '1100000231', arrQty: 10 }] }) }));
  ok(rx.id !== b && rx.id !== a, 'used id not given twice: ' + rx.id);
  const ra = must(call('sok@x.com', 'start', { receipt: Object.assign({}, ARR, { dn3pl: 'DN-' + Math.random(), id: a, items: [{ material: '1100000231', arrQty: 10 }] }) }));
  eq(ra.id, a, 'older reservation still honoured'); }
// warehouses (Kim, 2 Nov 2026): Dara works at WH BDM only; Sokha (nothing ticked) and admins see every warehouse
{ const bd = must(call('dara@x.com', 'boot', {}));
  eq([bd.sites, bd.allSites], [['WH BDM'], false], 'Dara: WH BDM only');
  const bs = must(call('sok@x.com', 'boot', {}));
  eq([bs.sites.length, bs.allSites], [5, true], 'nothing ticked = every warehouse');
  eq([must(call('sai@x.com', 'boot', {})).sites, must(call('sai@x.com', 'boot', {})).allSites], [['WH IB'], false], 'reviewer with WH IB ticked: WH IB only');
  eq(must(call('kim@x.com', 'boot', {})).allSites, true, 'admin: every warehouse');
  const ib = must(call('kim@x.com', 'start', { receipt: Object.assign({}, ARR, { dn3pl: 'DN-' + Math.random(), site: 'WH IB', items: [{ material: '1100000231', arrQty: 5 }] }) }));
  eq(ib.site, 'WH IB', 'site saved');
  ok(!must(call('dara@x.com', 'boot', {})).receipts.some(r => r.id === ib.id), 'Dara does not see WH IB trucks');
  ok(must(call('sok@x.com', 'boot', {})).receipts.some(r => r.id === ib.id), 'Sokha sees them');
  ok(/^DENIED/.test(call('dara@x.com', 'save', { receipt: { id: ib.id, remark: 'x' } }).error), 'Dara cannot edit a WH IB truck');
  ok(/^DENIED/.test(call('dara@x.com', 'start', { receipt: Object.assign({}, ARR, { dn3pl: 'DN-' + Math.random(), site: 'WH IB' }) }).error), 'Dara cannot start at WH IB');
  const own = must(call('dara@x.com', 'start', { receipt: Object.assign({}, ARR, { dn3pl: 'DN-' + Math.random(), items: [{ material: '1100000231', arrQty: 5 }] }) }));
  eq(own.site, 'WH BDM', 'one warehouse: used without asking');
  ok(log().some(x => x[0] === own.id && x[34] === 'WH BDM'), 'warehouse in GR Log');
  eq(env.ss.getSheetByName('GR Log').rows[0][31], 'Entrance', 'A1/I1 column is now Entrance');
  // packing list with a Warehouse column; Dara only sees BDM POs
  must(call('kim@x.com', 'planSave', { lines: [{ po: '5100099001', material: 'M1', desc: 'x', kg: 1000, site: 'WH IB' }, { po: '5100099002', material: 'M2', desc: 'y', kg: 1000, site: 'WH BDM' }] }));
  const dp = must(call('dara@x.com', 'boot', {})).plan.map(x => x.po);
  ok(dp.indexOf('PO5100099002') >= 0 && dp.indexOf('PO5100099001') < 0, 'Dara sees only BDM POs');
  eq(must(call('kim@x.com', 'boot', {})).plan.find(x => x.po === 'PO5100099001').site, 'WH IB', 'Warehouse column written and read');
  must(call('sai@x.com', 'planSave', { lines: [{ po: '5100099003', material: 'M3', desc: 'z', kg: 500 }] }));
  eq(must(call('kim@x.com', 'boot', {})).plan.find(x => x.po === 'PO5100099003').site, 'WH IB', 'no Warehouse column: the uploader\'s warehouse'); }
// incoming alert one day ahead (Kim, 2 Nov 2026)
{ const tx = env.g.incomingText_('2026-11-03', '2026-11-02');
  ok(tx && /Late, not yet received/.test(tx) && /PO5100012751/.test(tx), 'late POs listed: ' + (tx || '').slice(0, 60));
  must(call('kim@x.com', 'planSave', { lines: [{ po: '5100099100', material: 'M9', desc: 'x', kg: 80000, eta: '2026-11-03', supplier: 'NS', site: 'WH GVM' }] }));
  const t2 = env.g.incomingText_('2026-11-03', '2026-11-02');
  ok(/Incoming tomorrow 03-Nov-2026/.test(t2) && /WH GVM · PO5100099100 · NS · 80 t \(~2 🚛\)/.test(t2), 'tomorrow list: ' + t2.split('\n')[1]);
  eq(env.g.incomingText_('2030-01-02', '2020-01-01'), null, 'nothing due = no post'); }
// Warehouse List with Warehouse | Entrance | Description (Kim, 2 Nov 2026)
{ whTab.rows = [['Warehouse Code', 'Entrace Code', 'Warehouse Description'], ['WH IB', 'A1', 'Raw Materials'], ['WH IB', 'I1', 'Trading'], ['WH OB', '', 'Finished Goods Warehouse'], ['WH BDM', '', 'Finished Goods Warehouse']];
  const kb = must(call('kim@x.com', 'boot', {}));
  eq(kb.warehouses, [{ code: 'A1', desc: 'Raw Materials', site: 'WH IB' }, { code: 'I1', desc: 'Trading', site: 'WH IB' }], 'entrances with their warehouse');
  eq(kb.sites, ['WH IB', 'WH OB', 'WH BDM'], 'warehouses from the tab');
  ok(/Choose the entrance/.test(call('kim@x.com', 'start', { receipt: Object.assign({}, ARR, { dn3pl: 'DN-' + Math.random(), site: 'WH IB', warehouse: '' }) }).error), 'WH IB needs an entrance');
  const ob = must(call('kim@x.com', 'start', { receipt: Object.assign({}, ARR, { dn3pl: 'DN-' + Math.random(), site: 'WH OB', warehouse: '', items: [{ material: '1100000231', arrQty: 1 }] }) }));
  eq([ob.site, ob.warehouse], ['WH OB', ''], 'WH OB has no entrances: none asked');
  const bd = must(call('kim@x.com', 'start', { receipt: Object.assign({}, ARR, { dn3pl: 'DN-' + Math.random(), site: 'WH BDM', warehouse: 'A1', items: [{ material: '1100000231', arrQty: 1 }] }) }));
  eq(bd.warehouse, '', 'an IB entrance is not kept for WH BDM');
  const recs = env.ss.getSheetByName('Receipts').rows, k = recs.findIndex((r, i) => i && JSON.parse(r[5]).warehouse === 'A1');
  const old = JSON.parse(recs[k][5]); delete old.site; recs[k][5] = JSON.stringify(old);
  eq(must(call('kim@x.com', 'boot', {})).receipts.find(r => r.id === old.id).site, 'WH IB', 'old receipt: warehouse from its entrance'); }
// ETA typed as text in the sheet (Kim, 2 Nov 2026: 31-Oct-2026)
{ plan.rows.push([9, 'M77', 'x', 'KMH1', 1020, 1000, 1, 1, '', 1, 'PO5100077777', '', '', '31-Oct-2026', 'YW'], [10, 'M78', 'y', 'KMH1', 1020, 1000, 1, 1, '', 1, 'PO5100077778', '', '', '02.11.2026', 'HS']);
  const pl = must(call('kim@x.com', 'boot', {})).plan;
  eq([pl.find(x => x.po === 'PO5100077777').eta, pl.find(x => x.po === 'PO5100077778').eta], ['2026-10-31', '2026-11-02'], 'text ETAs read as dates'); }
{ const pr = env.ss.getSheetByName('Incoming Plan').rows, h = pr[0].map(String), r = pr.find(x => x[h.indexOf('PO Number')] === 'PO5100099100');
  eq(r[h.indexOf('ETA')], '03-Nov-2026', 'ETA written as dd-mmm-yyyy'); }
// the Telegram group became a supergroup (Kim, 2 Nov 2026): new id saved, message sent again
{ const set = env.ss.getSheetByName('IB Settings').rows; set[1][1] = '-5351019426'; const n = env.telegrams.length;
  env.g.telegram_({ text: 'hi' });
  eq(String(set[1][1]), '-1004445393710', 'new supergroup id saved');
  eq(env.telegrams.slice(n).map(x => x.payload.chat_id), ['-5351019426', '-1004445393710'], 'sent again to the new id'); }
// Goods Receipt Report PDFs copied for Kim's OneDrive (Kim, 5 Nov 2026)
{ const g = env.g;
  eq(JSON.parse(JSON.stringify(g.grName_({ date: '2026-11-05', po: 'PO5100012725', id: 'IB-261105-03', supplier: 'A/B: Steel "Co" ' }))),
    { year: 'Goods Receipt Report 2026', month: 'GR 2026-11', path: 'Goods Receipt Report 2026\\GR 2026-11', name: 'GR 2026-11 PO5100012725 IB-261105-03 A-B- Steel -Co-.pdf' }, 'GR file name and folders');
  ok(env.triggers.some(t => t.spec.fn === 'grExport' && t.spec.after === 60000) && env.triggers.some(t => t.spec.fn === 'grExport' && t.spec.every === 1), 'finishing a truck queues a PDF copy (+ hourly run)');
  const nTrig = env.triggers.length;
  g.grQueue_();
  eq(env.triggers.length, nTrig, 'no second trigger while one is on its way');
  const recs = () => env.ss.getSheetByName('Receipts').rows.slice(1).filter(r => r && r[1] === 'Done');
  const nDone = recs().length;
  ok(nDone > 0, 'there are finished receipts');
  ok(/copied/.test(g.grExport()), 'grExport runs');
  const gr = env.ss.getSheetByName('GR Export').rows;
  eq(gr.length - 1, nDone, 'one copy per finished receipt');
  eq(JSON.stringify(env.triggers.filter(t => t.spec.fn === 'grExport').map(t => t.spec.every)), '[1]', 'used one-off trigger removed, hourly kept');
  const first = gr[1].slice(), file = env.files[first[3]], rec1 = JSON.parse(recs().find(r => r[0] === first[0])[5]);
  const month = env.folders[file.parent], year = env.folders[month.parent], top = env.folders[year.parent];
  eq([top.name, year.name, month.name], ['Goods Receipt Report', 'Goods Receipt Report ' + rec1.date.slice(0, 4), 'GR ' + rec1.date.slice(0, 7)], 'saved in Goods Receipt Report / year / GR YYYY-MM');
  eq(file.name, g.grName_(rec1).name, 'file named GR YYYY-MM PO GR-no supplier');
  ok(/^%PDF/.test(file.data.toString()), 'file is the PDF');
  ok(/0 PDF copied/.test(g.grExport()), 'nothing new: nothing copied');
  ok(g.grSame_('2026-11-01 8:49', '2026-11-01 08:49') && !g.grSame_('2026-11-01 08:49', '2026-11-01 08:50'), 'times compared even when Sheets drops the leading zero');
  // a finished receipt is edited: copied again, old copy trashed
  const rr = env.ss.getSheetByName('Receipts').rows, k = rr.findIndex(r => r && r[0] === first[0]);
  const o = JSON.parse(rr[k][5]); o.updated = '2099-01-01 08:00'; o.supplier = 'New Supplier'; rr[k][5] = JSON.stringify(o);
  ok(/^1 PDF copied/.test(g.grExport()), 'edited receipt copied again');
  const again = env.ss.getSheetByName('GR Export').rows.find(r => r[0] === first[0]);
  ok(file.trashed && again[3] !== first[3] && /New Supplier\.pdf$/.test(again[2]) && again[6] === first[1] + '\\' + first[2], 'old copy trashed, new name, old name to remove');
  // Kim's PC asks for the files
  const get = q => JSON.parse(g.doGet({ parameter: q }).s);
  ok(/DENIED/.test(get({ action: 'grSync', key: '' }).error), 'no key set: refused');
  const gk = g.grSyncKey(); ok(/^gr-[0-9a-f]{42}$/.test(gk) && g.grSyncKey() === gk, 'key made once, kept'); env.props.GR_SYNC_KEY = 'k-0123456789abcdefghij';
  ok(/DENIED/.test(get({ action: 'grSync', key: 'wrong-0123456789abcdefgh' }).error), 'wrong key refused');
  const s1 = get({ action: 'grSync', key: 'k-0123456789abcdefghij', since: '' }).data;
  ok(s1.files.length === Math.min(8, nDone) && s1.more === nDone > 8 && Buffer.from(s1.files[0].b64, 'base64').toString().startsWith('%PDF'), 'PC gets the PDFs, 8 at a time');
  const last = s1.files[s1.files.length - 1].exported, s2 = get({ action: 'grSync', key: 'k-0123456789abcdefghij', since: last }).data;
  ok(s2.files.every(f => f.exported > last) && s1.files.concat(s2.files).some(f => f.replaces) && s1.files.length + s2.files.length === nDone, 'next call: only newer files; the edited one carries the old name to remove');
  eq(get({}).app, 'Inbound', 'plain GET still answers'); }
// one truck, two POs (Kim, 11 Nov 2026)
{ const M = Object.assign({}, ARR, { po: '', pos: ['PO5100012725', 'PO5100012751'], dn3pl: 'DN-MULTI', truck: '2A-2233',
    items: [{ po: 'PO5100012751', material: '1200000101', arrQty: 5000 }, { po: 'PO5100012725', material: '1100000230', arrQty: 100 }] });
  ok(/PO9 is not in the Incoming Plan/.test(call('sok@x.com', 'start', { receipt: Object.assign({}, M, { pos: ['PO9'] }) }).error), 'unknown PO refused');
  const m = must(call('sok@x.com', 'start', { receipt: M }));
  eq([m.po, m.pos, m.supplier, m.items.map(i => i.po)], ['PO5100012725, PO5100012751', ['PO5100012725', 'PO5100012751'], 'Regency, Zinc Co', ['PO5100012725', 'PO5100012751']], 'two POs on one receipt, items in PO order');
  const f = must(call('sok@x.com', 'finish', { receipt: { id: m.id, owner: 'ISI', manpower: 3, items: [{ po: 'PO5100012725', material: '1100000230', grQty: 100 }, { po: 'PO5100012751', material: '1200000101', grQty: 4900 }] } }));
  eq(f.items.map(i => i.grQty), [100, 4900], 'GR matched by PO + material');
  const lg = env.ss.getSheetByName('GR Log').rows.filter(r => r[0] === m.id);
  eq(lg.map(r => r[2]), ['PO5100012725', 'PO5100012751'], 'log rows keep each item\'s PO');
  ok(/cannot be deleted/.test(call('kim@x.com', 'planDel', { po: 'PO5100012751' }).error), 'second PO counts as received'); }
// PO typed without "PO" in the plan sheet (Kim, 12 Nov 2026)
{ plan.rows.push([4, 1300000001, 'COIL X', 'KMH1', 1020, 9000, 9, 1, '', 1, 5100077777, 'IN 7', 'X-1', eta, 'X Co']);
  const x = must(call('sok@x.com', 'start', { receipt: Object.assign({}, ARR, { po: 'PO5100077777', pos: ['PO5100077777'], dn3pl: 'DN-NUM', truck: '3E-2588', items: [{ po: 'PO5100077777', material: '1300000001', arrQty: 9000 }] }) }));
  eq([x.po, x.items[0].po], ['PO5100077777', 'PO5100077777'], 'plan PO without the PO prefix still found'); }
console.log('Inbound.gs: ' + pass + ' checks passed');
