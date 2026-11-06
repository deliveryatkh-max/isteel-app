// Tests for Safety.gs with the Apps Script mock. Run: node apps-script-safety/tests/run.js
'use strict';
const path = require('path');
const assert = require('assert');
const { makeEnv } = require('./gas-sw');

const ROOT = path.join(__dirname, '..', '..');
let pass = 0;
const ok = (c, m) => { assert.ok(c, m); pass++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); pass++; };

const USERS = [
  ['Email', 'Name', 'Role', 'Active', 'សុវត្ថិភាព', 'Employee ID'],
  ['kim@x.com', 'Kim', 'admin', 'Yes', false, '100001'],
  ['walker@x.com', 'Dara', 'user', 'Yes', true, '100002'],
  ['owner@x.com', 'Vuthy', 'user', 'Yes', false, '100003'],
  ['hse@x.com', 'HSE', 'reviewer', 'Yes', true, '100004'],
  ['leader@x.com', 'Sokha', 'user', 'Yes', true, '100005'],
  ['nobody@x.com', 'Nobody', 'user', 'Yes', false, '100006'],
  ['off@x.com', 'Off', 'user', 'No', true, '100007'],
];
const PHOTO = 'data:image/jpeg;base64,' + Buffer.from('jpeg-photo').toString('base64');

const env = makeEnv({ file: path.join(ROOT, 'apps-script-safety/Safety.gs'), defaults: path.join(ROOT, 'web/safety/defaults.json'),
  users: USERS.map(r => r.slice()), props: { SESSION_SECRET: 's3cret', USERS_SHEET_ID: 'USERS', GOOGLE_CLIENT_ID: 'cid', TELEGRAM_BOT_TOKEN: 'bot' } });
env.g.setup();
eq(env.ss.getSheets().map(s => s.getName()), ['Walks', 'Actions', 'Answers', 'Areas', 'Checklists', 'SW Settings'], 'tabs (empty Sheet1 removed)');
ok(env.props.SW_FOLDER_ID, 'photo folder made');
eq(env.triggers.map(t => t.fn).sort(), ['dailyOverdue', 'weeklySummary'], 'morning and Monday triggers');
env.g.setup();
eq(env.triggers.length, 2, 'setup again does not double the triggers');
eq(env.ss.getSheetByName('Checklists').getLastRow(), 38, '37 starting questions');
eq(env.ss.getSheetByName('Areas').getLastRow(), 6, '5 starting areas');

const call = (who, action, payload) => env.post({ action, token: env.session(who), payload });
const must = r => { if (!r.ok) throw new Error(r.error); return r.data; };
const setTg = () => must(call('kim@x.com', 'saveSettings', { telegramChat: '-100123' }));

// access
ok(/^AUTH/.test(env.post({ action: 'boot', payload: {} }).error), 'no token');
ok(/^NOACCESS/.test(call('nobody@x.com', 'boot').error), 'not ticked');
ok(/^NOACCESS/.test(call('off@x.com', 'boot').error), 'switched off');
ok(/^NOACCESS/.test(call('owner@x.com', 'boot').error), 'owner without tick and no action yet');
let b = must(call('walker@x.com', 'boot'));
eq(b.lists.map(l => l.name + ':' + l.n), ['Safety walk:12', '5S audit:15', 'Forklift check:10'], 'three checklists');
ok(b.questions['Safety walk'][2].critical && !b.questions['Safety walk'][0].critical, 'critical flags');
ok(b.areas.find(a => a.area === 'Pipe yard A').late.indexOf('Safety walk') >= 0, 'never-walked weekly area is late');
ok(b.people.some(p => p.n === 'Vuthy' && p.id === '100003') && !b.people.some(p => p.n === 'Off'), 'owner list = active users with Employee ID');
must(call('kim@x.com', 'boot'));

// a walk with one normal No and one critical No
setTg();
const qs = b.questions['Safety walk'];
const answers = qs.map(q => ({ no: q.no, q: q.en, a: 'Yes' }));
answers[1] = { no: qs[1].no, q: qs[1].en, a: 'No', note: 'Pallets in walkway', photos: [PHOTO], owner: { n: 'Vuthy', id: '100003' }, due: '2030-01-10' };
answers[2] = { no: qs[2].no, q: qs[2].en, a: 'No', note: 'Stack too high', photos: [PHOTO, PHOTO], owner: { n: 'Sokha', e: 'leader@x.com' } };
answers[11] = { no: qs[11].no, q: qs[11].en, a: 'N/A' };
const walk = { clientId: 'c-1', site: 'KMH1', area: 'Pipe yard A', list: 'Safety walk', date: '2026-11-04', started: '09:00', answers };
const noPhoto = JSON.parse(JSON.stringify(walk)); noPhoto.clientId = 'c-x'; noPhoto.answers[1].photos = [];
ok(/^BAD.*photo/.test(call('walker@x.com', 'submit', noPhoto).error), 'No needs a photo');
const noOwner = JSON.parse(JSON.stringify(walk)); noOwner.clientId = 'c-y'; noOwner.answers[1].owner = {};
ok(/^BAD.*fix/.test(call('walker@x.com', 'submit', noOwner).error), 'No needs an owner');
const tgBefore = env.telegrams.length;
const r = must(call('walker@x.com', 'submit', walk));
ok(/^SW-\d{6}-01$/.test(r.id), 'walk number ' + r.id);
eq([r.yes, r.no, r.na, r.actions, r.critical, r.score], [9, 2, 1, 2, 1, 82], 'counts and score = Yes/(Yes+No)');
eq(env.telegrams.length - tgBefore, 1, 'critical No posted to Telegram at once');
eq(env.telegrams[env.telegrams.length - 1].method, 'sendPhoto', 'with the photo');
ok(/Stack too high/.test(env.telegrams[env.telegrams.length - 1].payload.caption), 'caption has the problem');
ok(/^<b>បញ្ហាធ្ងន់ធ្ងរ<\/b>\n📍 KMH1 · Pipe yard A · Safety walk SW-/.test(env.telegrams[env.telegrams.length - 1].payload.caption), 'caption layout');
ok(/\nសំនួរ៖ \S/.test(env.telegrams[env.telegrams.length - 1].payload.caption) && /អ្នកកែ៖👤 Sokha · due 20/.test(env.telegrams[env.telegrams.length - 1].payload.caption), 'caption lines in Khmer');
eq(env.g.noteKm_('ដាក់ខ្ពស់ពេក · Stack too high - row C'), 'ដាក់ខ្ពស់ពេក - row C', 'Khmer part of a picked problem');
eq(must(call('walker@x.com', 'submit', walk)).again, true, 'same clientId saved once (offline queue retry)');
eq(env.ss.getSheetByName('Walks').getLastRow(), 2, 'one walk row');
eq(env.ss.getSheetByName('Answers').getLastRow(), 13, '12 answer rows');
const actSheet = env.ss.getSheetByName('Actions');
eq(actSheet.getLastRow(), 3, 'two actions');
eq(actSheet.rows[1][12], 'owner@x.com', 'owner email found from Employee ID');
eq(actSheet.rows[1][14], '2030-01-10', 'due date kept');
ok(actSheet.rows[2][14] > '2026-11-04' && actSheet.rows[2][14] <= '2030', 'critical due filled');
eq(actSheet.rows[2][10].split(',').length, 2, 'two photos saved');

// the owner can now open the app (owner of an open action), and sees only their action
b = must(call('owner@x.com', 'boot'));
ok(b.user.ownerOnly, 'owner-only access');
eq(b.actions.map(a => a.id), [r.id + '-1'], 'owner sees their action');
eq(b.walks.length, 0, 'owner does not see the walk list');
const a1 = b.actions[0];
ok(a1.can.done && !a1.can.close, 'owner can mark done, not close');
ok(/^NOACCESS/.test(call('owner@x.com', 'walk', { id: r.id }).error), 'owner cannot open the walk');
ok(must(call('owner@x.com', 'photo', { id: a1.photos[0] })).data.indexOf('data:image/jpeg;base64,') === 0, 'owner loads the photo');
ok(/^NOACCESS/.test(call('nobody@x.com', 'photo', { id: a1.photos[0] }).error), 'others cannot');
ok(/^BAD.*photo/.test(call('owner@x.com', 'actionDone', { id: a1.id, note: 'moved' }).error), 'done needs an after photo');
let v = must(call('owner@x.com', 'actionDone', { id: a1.id, note: 'moved', photos: [PHOTO] }));
eq([v.status, v.doneBy, v.after.length], ['Done', 'Vuthy', 1], 'marked done');
ok(/^NOACCESS/.test(call('owner@x.com', 'actionClose', { id: a1.id }).error), 'owner cannot close');
v = must(call('walker@x.com', 'actionClose', { id: a1.id }));
eq([v.status, v.closedBy], ['Closed', 'Dara'], 'walker closes');
v = must(call('hse@x.com', 'actionReopen', { id: a1.id, note: 'came back' }));
eq(v.status, 'Open', 'reviewer reopens');
ok(/reopened: came back/.test(actSheet.rows[1][24]), 'history kept');

// the area leader sees the walk of their area once the admin sets them as leader
let s = must(call('kim@x.com', 'settings'));
eq(s.areas.length, 5, 'settings areas');
s.areas[0].leader = '100005';
s = must(call('kim@x.com', 'saveSettings', { areas: s.areas }));
eq(env.ss.getSheetByName('Areas').rows[1][3], 'leader@x.com', 'leader email found from Employee ID');
b = must(call('leader@x.com', 'boot'));
eq(b.walks.map(w => w.id), [r.id], 'leader sees the walk of their area');
ok(b.areas.find(a => a.area === 'Pipe yard A').late.indexOf('Safety walk') < 0, 'area no longer late after the walk');
ok(b.actions.find(a => a.id === r.id + '-2').can.done, 'leader can mark done');
const w = must(call('leader@x.com', 'walk', { id: r.id }));
eq([w.answers.length, w.actionList.length, w.answers[1].a], [12, 2, 'No'], 'walk detail');
v = must(call('hse@x.com', 'actionEdit', { id: r.id + '-2', owner: { n: 'Dara' }, due: '2026-11-01' }));
eq([v.owner, v.ownerEmail, v.due], ['Dara', 'walker@x.com', '2026-11-01'], 'owner and due changed');
ok(/^NOACCESS/.test(call('owner@x.com', 'actionEdit', { id: r.id + '-1', due: '2026-12-01' }).error), 'owner cannot change the due date');

// PDF
const pdf = must(call('walker@x.com', 'pdf', { id: r.id }));
const txt = Buffer.from(pdf.data, 'base64').toString();
ok(/Pallets in walkway|Walkways/.test(txt) && /SAFETY WALK REPORT/.test(txt), 'PDF has the answers');
ok(env.docs[Object.keys(env.docs).pop()].images >= 1, 'PDF has the logo / photos');

// typed new area is added for the admin
must(call('walker@x.com', 'submit', { clientId: 'c-2', site: 'GVM', area: 'New dock', list: '5S audit', answers: [{ no: '1', a: 'Yes' }] }));
ok(env.ss.getSheetByName('Areas').rows.some(x => x && x[1] === 'New dock'), 'new area added to the Areas tab');

// morning overdue list and Monday summary
const n0 = env.telegrams.length;
env.g.dailyOverdue();
eq(env.telegrams.length, n0 + 1, 'overdue posted');
ok(/past due/.test(env.telegrams[n0].payload.text) && /Dara/.test(env.telegrams[n0].payload.text), 'overdue lists the late action and owner');
must(call('kim@x.com', 'saveSettings', { daily: false }));
env.g.dailyOverdue();
eq(env.telegrams.length, n0 + 1, 'daily list can be switched off');
env.g.weeklySummary();
ok(/Safety week/.test(env.telegrams[env.telegrams.length - 1].payload.text), 'weekly summary');

// checklists edited by the admin
s = must(call('kim@x.com', 'settings'));
s.questions = s.questions.filter(q => q.list !== 'Forklift check').concat([{ list: 'Forklift check', en: 'Only one question', km: '', critical: true }]);
must(call('kim@x.com', 'saveSettings', { questions: s.questions }));
b = must(call('walker@x.com', 'boot'));
eq(b.questions['Forklift check'].map(q => q.no + ':' + q.en), ['1:Only one question'], 'checklist rewritten and renumbered');
ok(/^NOACCESS/.test(call('walker@x.com', 'settings').error), 'settings admin only');
must(call('kim@x.com', 'testTelegram'));

// What is wrong? problems per question
b = must(call('walker@x.com', 'boot'));
ok(b.questions['Safety walk'][1].problems.length >= 3 && b.questions['Safety walk'][1].problems[0][1], 'problems sent with each question (English, Khmer)');
s = must(call('kim@x.com', 'settings'));
const qi = s.questions.findIndex(q => q.list === 'Safety walk' && String(q.no) === '2');
ok(typeof s.questions[qi].problems === 'string' && / \/ /.test(s.questions[qi].problems), 'settings show problems as text');
s.questions[qi].problems = 'Boxes on the walkway / ប្រអប់នៅលើផ្លូវដើរ\nLine faded';
must(call('kim@x.com', 'saveSettings', { questions: s.questions }));
b = must(call('walker@x.com', 'boot'));
eq(b.questions['Safety walk'][1].problems, [['Boxes on the walkway', 'ប្រអប់នៅលើផ្លូវដើរ'], ['Line faded', 'Line faded']], 'admin edits the problems');

// spot check: only the problems seen, no score
const sp = must(call('hse@x.com', 'submit', { clientId: 'c-spot', site: 'KMH1', area: 'Coil shed', list: 'Spot check', answers: [
  { no: 'SW3', q: 'Bundles are stacked below the max height and are stable', km: 'x', critical: true, a: 'No', note: 'Stack too high', photos: [PHOTO], owner: { n: 'Dara' } },
  { no: '5S1', q: 'Sort: no unneeded items', a: 'No', note: 'Rubbish', photos: [PHOTO], owner: { n: 'Vuthy', id: '100003' } }] }));
eq([sp.no, sp.actions, sp.critical, sp.score], [2, 2, 1, ''], 'spot check saved with 2 actions and no score');
ok(/^BAD.*photo/.test(call('hse@x.com', 'submit', { clientId: 'c-spot2', site: 'KMH1', area: 'Coil shed', list: 'Spot check', answers: [{ no: 'SW1', q: 'x', a: 'No', owner: { n: 'Dara' } }] }).error), 'spot check needs a photo');
const spw = must(call('hse@x.com', 'walk', { id: sp.id }));
eq([spw.score, spw.list, spw.answers[0].q], [null, 'Spot check', 'Bundles are stacked below the max height and are stable'], 'spot check detail');
must(call('hse@x.com', 'pdf', { id: sp.id }));

// weekly summary: best areas
const yday = new Date(Date.now() + 7 * 3600e3 - 86400e3).toISOString().slice(0, 10);
must(call('walker@x.com', 'submit', { clientId: 'c-wk', site: 'KMH1', area: 'Coil shed', list: '5S audit', date: yday, answers: [{ no: '1', a: 'Yes' }, { no: '2', a: 'Yes' }] }));
env.g.weeklySummary();
const wk = env.telegrams[env.telegrams.length - 1].payload.text;
ok(/Best areas/.test(wk) && /🥇 KMH1 · Coil shed: 100%/.test(wk), 'weekly summary names the best area');
ok(/1 spot checks|checks done/.test(wk), 'weekly counts');
ok(/Most checks · ត្រួតពិនិត្យច្រើន: Dara \d+/.test(wk) && /Average score by area/.test(wk), 'weekly names who checked most');

eq(env.errors, [], 'no server errors');
console.log('Safety tests passed: ' + pass);
