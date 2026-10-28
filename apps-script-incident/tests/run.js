// Tests for Incident.gs with the Apps Script mock. Run: node apps-script-incident/tests/run.js
'use strict';
const path = require('path');
const assert = require('assert');
const { makeEnv } = require('./gas-ir');

const ROOT = path.join(__dirname, '..', '..');
let pass = 0;
const ok = (c, m) => { assert.ok(c, m); pass++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); pass++; };

const USERS = [
  ['Email', 'Name', 'Role', 'Active', 'គ្រោះថ្នាក់'],
  ['kim@x.com', 'Kim', 'admin', 'Yes', false],
  ['sup@x.com', 'Pisey', 'user', 'Yes', true],
  ['driver@x.com', 'Vuthy', 'user', 'Yes', true],
  ['other@x.com', 'Other', 'user', 'Yes', true],
  ['hse@x.com', 'HSE', 'reviewer', 'Yes', true],
  ['nobody@x.com', 'Nobody', 'user', 'Yes', false],
];
const TRUCKS = [['CODE', 'ឈ្មោះតៃកុង', 'ក្រុមហ៊ុន'], ['3E-2588', '1.ជា វុទ្ធី', 'ISI'], ['3A-2102', '2.សុខ ដារា', '']];
const SIG = 'data:image/png;base64,' + Buffer.from('png-signature').toString('base64');
const PHOTO = 'data:image/jpeg;base64,' + Buffer.from('jpeg-photo').toString('base64');
const FORM = {
  type: 'road', category: 'Collision with vehicle', date: '2026-10-24', time: '14:20', location: 'NR5 km 82', warehouse: 'SSK Warehouse',
  plate: '3e 2588', driver: 'ជា វុទ្ធី', story: 'Motorbike cut in.', severity: 3, likelihood: 5, cause: 'People (behaviour, training)',
  people: [{ name: 'Rider', injured: true, injury: 'cut' }, { name: '' }], whys: ['too close', '', '', '', ''], immediate: 'First aid',
  actions: [{ what: 'Refresher training', owner: 'Transport', due: '2026-11-08' }, { what: '' }], reporterName: 'Vuthy', reporterPhone: '012',
  signature: SIG, photos: [PHOTO, PHOTO], supervisor: 'sup@x.com', insurance: 'Yes',
  voice: 'data:audio/webm;codecs=opus;base64,' + Buffer.from('voice-note').toString('base64'),
};

const env = makeEnv({ file: path.join(ROOT, 'apps-script-incident/Incident.gs'), users: USERS.map(r => r.slice()), trucks: TRUCKS,
  props: { SESSION_SECRET: 's3cret', USERS_SHEET_ID: 'USERS', GOOGLE_CLIENT_ID: 'cid', TELEGRAM_BOT_TOKEN: 'bot' } });
env.g.setup();
eq(env.ss.getSheets().map(s => s.getName()), ['Incidents', 'Email Lists', 'Supervisors', 'Categories', 'IR Settings', 'Texts'], 'tabs (empty Sheet1 removed)');
ok(env.props.IR_FOLDER_ID && env.props.IR_PUBLIC_KEY, 'folder and public key made');
const call = (who, action, payload) => env.post({ action, token: env.session(who), payload });
const must = r => { if (!r.ok) throw new Error(r.error); return r.data; };

// admin sets supervisors, lists, telegram
let s = must(call('kim@x.com', 'settings', {}));
eq(s.categories.length, 14, '14 default categories');
eq(s.categories[0].icon, '🚗', 'category icon');
s = must(call('kim@x.com', 'saveSettings', {
  supervisors: [{ warehouse: 'SSK Warehouse', name: 'Pisey', email: 'SUP@x.com', backup: '' }],
  lists: [{ name: 'Management', emails: 'm1@x.com, m2@x.com', when: 'auto' }, { name: 'HSE', emails: ['h@x.com'], when: 'high' }, { name: '3PL', emails: ['p@x.com'], when: 'button' }],
  telegramChat: '-100123',
}));
eq(s.supervisors[0].email, 'sup@x.com', 'emails lower-cased');
eq(s.lists.map(l => l.when), ['auto', 'high', 'button']);
ok(!call('kim@x.com', 'saveSettings', { lists: [{ name: 'Bad', emails: 'nope' }] }).ok, 'bad email refused');
ok(!call('sup@x.com', 'settings', {}).ok, 'settings admin only');

// access
ok(/^NOACCESS/.test(call('nobody@x.com', 'boot', {}).error), 'unticked user refused');
let b = must(call('driver@x.com', 'boot', {}));
eq(b.plates, ['3A-2102', '3E-2588'], 'plates from Driver & Truck');
eq(b.lists.map(l => l.name), ['Management', 'HSE', '3PL']);
eq(b.supervisors.length, 1);
eq(b.categories.find(c => c.en === 'Fire').icon, '🔥', 'icons in boot');

// submit
ok(/sign/.test(call('driver@x.com', 'submit', Object.assign({}, FORM, { signature: '' })).error), 'signature needed');
ok(/story|happened/i.test(call('driver@x.com', 'submit', Object.assign({}, FORM, { story: '', voice: '' })).error), 'story or voice needed');
const r1 = must(call('driver@x.com', 'submit', FORM));
eq(must(call('driver@x.com', 'get', { id: r1.id })).insurance, 'Yes', 'insurance kept');
eq(r1.id, 'IR-' + new Date().getFullYear() + '-001', 'report number');
eq(env.telegrams.length, 1, 'telegram on submit');
ok(/New incident/.test(env.telegrams[0].payload.text) && /Open and sign/.test(env.telegrams[0].payload.reply_markup), 'telegram text and button');
let row = env.ss.getSheetByName('Incidents').rows[1];
const H = env.ss.getSheetByName('Incidents').rows[0];
const col = n => row[H.indexOf(n)];
eq(col('Truck Plate'), '3E2588', 'plate cleaned');
eq(col('Risk Score'), '15'); eq(col('Risk Level'), 'HIGH'); eq(col('Injured'), '1'); eq(col('Open Actions'), '1');
eq(col('Status'), 'Waiting supervisor');

// visibility
eq(must(call('other@x.com', 'list', {})).length, 0, 'others do not see it');
eq(must(call('hse@x.com', 'list', {})).length, 1, 'reviewer sees all');
const supList = must(call('sup@x.com', 'list', {}));
ok(supList[0].toSign, 'supervisor has it to sign');
ok(/^DENIED/.test(call('other@x.com', 'get', { id: r1.id }).error), 'other cannot open');
let d = must(call('driver@x.com', 'get', { id: r1.id }));
eq(d.photos.length, 2); eq(d.photoThumbs.length, 2, 'photos come back');
ok(d.voice && /^data:audio\/webm;base64,/.test(d.voiceData), 'voice note saved and comes back');
ok(!d.can.sign && !d.can.edit, 'reporter cannot sign');
ok(/^DENIED/.test(call('driver@x.com', 'sign', { id: r1.id, signature: SIG }).error), 'reporter cannot sign');

// send back, edit, send again
ok(/change/.test(call('sup@x.com', 'sendBack', { id: r1.id, note: '' }).error), 'note needed');
must(call('sup@x.com', 'sendBack', { id: r1.id, note: 'Add the DN' }));
d = must(call('driver@x.com', 'get', { id: r1.id }));
ok(d.can.edit && d.status === 'Returned', 'returned to reporter');
must(call('driver@x.com', 'submit', Object.assign({}, FORM, { id: r1.id, dn: '8100452231', photos: [], keepPhotos: [d.photos[0]], voice: '' })));
d = must(call('sup@x.com', 'get', { id: r1.id }));
eq(d.dn, '8100452231'); eq(d.photos.length, 1, 'kept one photo'); ok(d.can.sign, 'waiting again');
ok(!d.voice, 'voice dropped when not kept');
eq(env.ss.getSheetByName('Incidents').rows.length, 2, 'still one row');

// sign -> PDF, telegram document, auto emails (Management auto + HSE because HIGH)
const sg = must(call('sup@x.com', 'sign', { id: r1.id, signature: SIG, comment: 'OK' }));
eq(sg.status, 'Signed');
eq(sg.emailed, 3, 'auto lists emailed (2 + HIGH 1)');
eq(env.mails.length, 1);
ok(env.mails[0].attachments[0].getName() === r1.id + '.pdf', 'PDF attached');
ok(/HIGH RISK/.test(env.mails[0].subject), 'subject says high risk');
const tgDoc = env.telegrams.find(x => x.method === 'sendDocument');
ok(tgDoc && /signed/.test(tgDoc.payload.caption), 'PDF to Telegram');
const pdfDoc = Object.values(env.docs).pop();
const text = pdfDoc.parts.join('\n');
ok(/INCIDENT & NEAR MISS REPORT/.test(text) && /ប្រភេទហេតុការណ៍/.test(text) && /Refresher training/.test(text) && /Immediate action/.test(text), 'PDF has sections in both languages');
ok(pdfDoc.images >= 3, 'PDF has photo + 2 signatures');
ok(Object.values(env.files).filter(f => f.name === r1.id + '.pdf' && !f.trashed).length === 1, 'one PDF kept');
ok(Object.values(env.files).filter(f => /document/.test(f.mime)).every(f => f.trashed), 'temp Doc trashed');
row = env.ss.getSheetByName('Incidents').rows[1];
eq(col('Supervisor'), 'Pisey'); ok(col('PDF Link'), 'PDF link in sheet');
ok(pdfDoc.tpl, 'PDF filled from the Word template');
eq(pdfDoc.font, 'Kantumruy Pro', 'PDF font set to a Google font');
ok(!/\{\{/.test(text), 'no placeholders left: ' + (text.match(/\{\{[^}]*\}\}/g) || []).join(' '));
ok(/8100452231/.test(text) && /Pisey/.test(text), 'values filled');
const tplFile = Object.values(env.files).find(f => f.tpl && f.name === 'Incident Report Template');
ok(tplFile && !tplFile.trashed && env.templateUploads === 1, 'template loaded once and kept');

// pdf for the app
const pdf = must(call('driver@x.com', 'pdf', { id: r1.id }));
ok(Buffer.from(pdf.b64, 'base64').toString().startsWith('%PDF'), 'pdf bytes');
// a PDF saved by the old layout (no version) is made again from the template
{ const x = env.g.load_(r1.id); x.pdf.v = undefined; env.g.store_(x); }
const nDocs = Object.keys(env.docs).length;
must(call('driver@x.com', 'pdf', { id: r1.id }));
ok(Object.keys(env.docs).length === nDocs + 1 && Object.values(env.docs).pop().tpl, 'old-layout PDF remade from the template');
ok(/^2\|/.test(env.g.load_(r1.id).pdf.v), 'new PDF stamped');
must(call('driver@x.com', 'pdf', { id: r1.id }));
eq(Object.keys(env.docs).length, nDocs + 1, 'same template: saved PDF reused');

// template from Kim's Drive link: a Google Doc is used as it is, and an edit shows in the next PDF
const GDOC = 'application/vnd.google-apps.document', DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const remade = () => { const n = Object.keys(env.docs).length; must(call('driver@x.com', 'pdf', { id: r1.id })); return Object.keys(env.docs).length > n; };
env.files.gdocKimTemplate000000001 = { id: 'gdocKimTemplate000000001', name: 'Kim template', data: Buffer.from(''), mime: GDOC, parent: 'root', trashed: false, tpl: true, updated: 1000 };
env.g.setSetting_('PDF_TEMPLATE_LINK', 'https://docs.google.com/document/d/gdocKimTemplate000000001/edit?usp=sharing');
let up = env.templateUploads;
ok(remade(), 'new template link: PDF remade');
ok(!remade(), 'unchanged: PDF reused');
env.files.gdocKimTemplate000000001.updated = 2000;
ok(remade(), 'Doc edited: PDF remade');
eq(env.templateUploads, up, 'Google Doc used without converting');
// a Word file is converted again only when it changes
env.files.docxKimTemplate000000001 = { id: 'docxKimTemplate000000001', name: 'Kim.docx', data: Buffer.from('PK'), mime: DOCX, parent: 'root', trashed: false, updated: 1000 };
env.g.setSetting_('PDF_TEMPLATE_LINK', 'https://drive.google.com/file/d/docxKimTemplate000000001/view');
ok(remade() && env.templateUploads === up + 1, 'Word link converted');
ok(!remade() && env.templateUploads === up + 1, 'Word unchanged: no new conversion');
env.files.docxKimTemplate000000001.updated = 3000;
ok(remade() && env.templateUploads === up + 2, 'Word replaced: converted again');
// a folder link uses the newest template in it
env.folders.dKimTemplates0000000001 = { id: 'dKimTemplates0000000001', name: 'Templates', parent: 'root', trashed: false };
env.files.gdocNewest00000000000001 = { id: 'gdocNewest00000000000001', name: 'v3', data: Buffer.from(''), mime: GDOC, parent: 'dKimTemplates0000000001', trashed: false, tpl: true, updated: 9000 };
env.files.docxOlder000000000000001 = { id: 'docxOlder000000000000001', name: 'v2.docx', data: Buffer.from('PK'), mime: DOCX, parent: 'dKimTemplates0000000001', trashed: false, updated: 5000 };
env.g.setSetting_('PDF_TEMPLATE_LINK', 'https://drive.google.com/drive/folders/dKimTemplates0000000001');
ok(remade() && /^2\|gdocNewest/.test(env.g.load_(r1.id).pdf.v), 'folder: newest template used');
env.g.setSetting_('PDF_TEMPLATE_LINK', '');
// template gone and the Word file can't be fetched: built-in layout instead
Object.values(env.files).filter(f => f.name === r1.id + '.pdf').forEach(f => { f.trashed = true; });
tplFile.trashed = true; env.noTemplate = true;
ok(must(call('driver@x.com', 'pdf', { id: r1.id })).b64, 'pdf without the template');
ok(!Object.values(env.docs).pop().tpl && /Template PDF failed/.test(env.errors.pop()), 'fell back to the built-in layout');
env.noTemplate = false;

// email button
ok(/list|email/i.test(call('driver@x.com', 'email', { id: r1.id, lists: [] }).error), 'needs a list');
eq(must(call('driver@x.com', 'email', { id: r1.id, lists: ['3PL'], extra: 'x@y.com' })).sent, 2);
eq(env.mails[1].to, 'p@x.com,x@y.com');

// actions and close
ok(/^DENIED/.test(call('driver@x.com', 'actions', { id: r1.id, actions: [] }).error), 'reporter cannot change actions');
ok(/^OPEN/.test(call('sup@x.com', 'close', { id: r1.id }).error), 'open actions block closing');
ok(/^DENIED/.test(call('sup@x.com', 'actions', { id: r1.id, actions: [] }).error), 'supervisor cannot change actions');
d = must(call('hse@x.com', 'actions', { id: r1.id, actions: [{ what: 'Refresher training', owner: 'Transport', due: '2026-11-08', status: 'Done' }] }));
ok(d.actions[0].done, 'done date set');
d = must(call('sup@x.com', 'close', { id: r1.id }));
eq(d.status, 'Closed');
row = env.ss.getSheetByName('Incidents').rows[1];
eq(col('Open Actions'), '0'); ok(col('Closed At'));

// anonymous near miss, public link
const r2 = must(call('other@x.com', 'submit', { type: 'near', category: 'Forklift / crane', date: '2026-10-25', story: 'Close call', anonymous: true, supervisor: 'sup@x.com' }));
d = must(call('sup@x.com', 'get', { id: r2.id }));
eq(d.reporter.name, 'Anonymous'); ok(!d.reporter.sig, 'no signature needed');
ok(/^NOACCESS/.test(env.post({ action: 'publicSubmit', payload: Object.assign({}, FORM, { key: 'wrong' }) }).error), 'wrong key refused');
const pub = env.post({ action: 'publicBoot', payload: { key: env.props.IR_PUBLIC_KEY } });
ok(pub.ok && pub.data.plates.length === 2 && !pub.data.reports, 'public boot has lists, no reports');
const r3 = env.post({ action: 'publicSubmit', payload: Object.assign({}, FORM, { key: env.props.IR_PUBLIC_KEY, reporterName: '3PL driver', reporterPhone: '099 111' }) });
ok(r3.ok, 'public submit ' + r3.error);
ok(/^BUSY/.test(env.post({ action: 'publicSubmit', payload: Object.assign({}, FORM, { key: env.props.IR_PUBLIC_KEY, reporterName: 'x', reporterPhone: '099111' }) }).error), 'one per minute per phone');
ok(/driver link/.test(call('sup@x.com', 'sendBack', { id: r3.data.id, note: 'x' }).error), 'link report cannot be sent back');
eq(must(call('hse@x.com', 'list', {})).map(x => x.id).length, 3);
must(call('kim@x.com', 'saveSettings', { publicOn: false }));
ok(/^NOACCESS/.test(env.post({ action: 'publicBoot', payload: { key: env.props.IR_PUBLIC_KEY } }).error), 'public link can be turned off');
must(call('kim@x.com', 'saveSettings', { prefix: 'SSK-IR' }));
eq(must(call('other@x.com', 'submit', Object.assign({}, FORM, { photos: [] }))).id, 'SSKIR-' + new Date().getFullYear() + '-004', 'prefix setting');

// Texts tab: an admin's phone adds the app's words; edits there come back in boot
const fs = require('fs');
const mk = require('../tools/make-texts');
const TEXTS = mk.collect();
eq(fs.readFileSync(path.join(ROOT, 'web/incident/texts.js'), 'utf8'), mk.source(TEXTS), 'texts.js up to date (node apps-script-incident/tools/make-texts.js)');
ok(TEXTS.length > 200 && TEXTS.some(r => r[0] === 'Send by email' || r[0] === 'New report'), 'texts collected');
ok(/^DENIED/.test(call('sup@x.com', 'syncTexts', { rows: TEXTS }).error), 'only admins add texts');
eq(must(call('kim@x.com', 'syncTexts', { rows: TEXTS.concat([TEXTS[0]]) })).added, TEXTS.length, 'texts added once');
eq(must(call('kim@x.com', 'syncTexts', { rows: TEXTS })).added, 0, 'no duplicates');
const tx = env.ss.getSheetByName('Texts');
const nr = tx.rows.findIndex(r => r[0] === 'New report');
tx.rows[nr][4] = 'របាយការណ៍ថ្មី!'; tx.rows[nr][5] = 'Report an incident';
eq(tx.rows[0], ['Key (do not change)', 'Screen', 'Sub-screen', 'Step', 'Khmer', 'English'], 'texts headings');
eq(tx.rows[nr].slice(1, 4), TEXTS.find(r => r[0] === 'New report').slice(1, 4), 'screen, sub-screen, step written');
b = must(call('driver@x.com', 'boot', {}));
eq(b.texts['New report'], ['របាយការណ៍ថ្មី!', 'Report an incident'], 'edited text in boot');

ok(!env.errors.length, 'no server errors: ' + env.errors.join('; '));
console.log('incident tests passed: ' + pass);
