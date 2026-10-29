// Tests for Minutes.gs (with the Apps Script mock) and the Cloudflare relay functions/mm/[action].js.
// Run: node apps-script-minutes/tests/run.js
'use strict';
const path = require('path');
const assert = require('assert');
const { makeEnv } = require('./gas-mm');

const ROOT = path.join(__dirname, '..', '..');
let pass = 0;
const ok = (c, m) => { assert.ok(c, m); pass++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); pass++; };

const USERS = [
  ['Email', 'Name', 'Role', 'Active', 'ប្រជុំ'],
  ['kim@x.com', 'Kim', 'admin', 'Yes', false],
  ['staff@x.com', 'Staff', 'user', 'Yes', true],
  ['nobody@x.com', 'Nobody', 'user', 'Yes', false],
  ['gone@x.com', 'Gone', 'user', 'No', true],
];

const MIN = {
  title: 'Weekly W&L', meetingDate: '2026-10-20', startTime: '09:00', duration: '45 min', location: 'WH room', chair: 'Kim',
  attendees: [{ name: 'Kim', role: 'Manager' }, { name: 'Dara', role: '' }], summary: 'Short summary.',
  discussion: [{ topic: '3PL', points: ['Late trucks'] }], decisions: ['Print DN before 7'],
  actions: [{ task: 'Train drivers', owner: 'Dara', due: '2026-10-30', priority: 'High' }, { task: 'Weekly report', owner: 'TBC', due: 'TBC', priority: 'Low' }],
  followUp: ['Review next week'], openPoints: [], nextMeeting: '', glossary: [{ term: 'DN', meaning: 'Delivery Note' }],
};

async function backend() {
  const env = makeEnv({ file: path.join(ROOT, 'apps-script-minutes/Minutes.gs'), users: USERS.map(r => r.slice()),
    props: { SESSION_SECRET: 's3cret', USERS_SHEET_ID: 'USERS', GOOGLE_CLIENT_ID: 'cid' } });
  env.g.setup();
  ok(env.props.MM_SECRET && env.props.MM_SECRET.length >= 64, 'MM_SECRET made');
  ok(env.props.MM_FOLDER_ID, 'folder made');
  eq(env.ss.getSheets().map(s => s.getName()), ['Meetings', 'Actions'], 'tabs (empty Sheet1 removed)');

  const kim = env.session('kim@x.com'), staff = env.session('staff@x.com');
  let r = env.post({ action: 'boot', token: kim });
  ok(r.ok, 'boot ok ' + r.error);
  eq(r.data.user, { email: 'kim@x.com', name: 'Kim', admin: true });
  eq(r.data.recent, []);
  const { checkTicket } = await import(path.join(ROOT, 'functions/mm/[action].js'));
  eq(await checkTicket(r.data.ticket, env.props.MM_SECRET), 'kim@x.com', 'relay accepts the script ticket');
  eq(await checkTicket(r.data.ticket, 'other'), null, 'wrong secret refused');
  eq(await checkTicket(r.data.ticket.replace(/^./, 'x'), env.props.MM_SECRET), null, 'changed ticket refused');

  r = env.post({ action: 'boot', token: env.session('nobody@x.com') });
  ok(!r.ok && /^NOACCESS/.test(r.error), 'unticked user refused');
  r = env.post({ action: 'boot', token: env.session('gone@x.com') });
  ok(!r.ok && /^NOACCESS/.test(r.error), 'inactive user refused');
  r = env.post({ action: 'boot', token: 'junk' });
  ok(!r.ok && /^AUTH/.test(r.error), 'bad token refused');
  r = env.post({ action: 'boot', token: staff });
  ok(r.ok && !r.data.user.admin, 'ticked user in');

  // create, then fill with minutes
  r = env.post({ action: 'save', token: staff, payload: { meta: { title: 'Weekly W&L', date: '2026-10-20' }, lang: 'auto', outLang: 'both', status: 'Processing' } });
  ok(r.ok, 'save new ' + r.error);
  const id = r.data.id;
  ok(/^MM-\d{6}-001$/.test(id), 'id format ' + id);
  r = env.post({ action: 'save', token: staff, payload: { meta: { title: 'x' } } });
  ok(/-002$/.test(r.data.id), 'running number');
  const id2 = r.data.id;
  r = env.post({ action: 'attach', token: staff, payload: { id, name: 'board.jpg', mime: 'image/jpeg', b64: Buffer.from('img').toString('base64') } });
  ok(r.ok && r.data.fileId, 'attach');
  const both = { km: Object.assign({}, MIN, { title: 'ប្រជុំប្រចាំសប្តាហ៍' }), en: MIN };
  r = env.post({ action: 'save', token: staff, payload: { id, status: 'Done', minutes: both, transcript: '[00:00] Kim: hello', ocr: 'agenda' } });
  ok(r.ok, 'save minutes');
  const meet = env.ss.getSheetByName('Meetings');
  eq(meet.getLastRow(), 3, 'two meetings');
  const row = meet.rows[1];
  eq(row[0], id); eq(row[3], 'ប្រជុំប្រចាំសប្តាហ៍', 'row title from Khmer minutes (default language)');
  eq(row[10], 'Done'); eq(row[13], 2, 'open actions');
  eq(row[9], 'Kim, Dara', 'attendees');
  const acts = env.ss.getSheetByName('Actions');
  eq(acts.getLastRow(), 3, 'two action rows');
  eq(acts.rows[1].slice(0, 7), [id, '1', 'Train drivers', 'Dara', '2026-10-30', 'High', 'Open']);

  r = env.post({ action: 'get', token: kim, payload: { id } });
  ok(r.ok && r.data.transcript === '[00:00] Kim: hello' && r.data.minutes.en.title === 'Weekly W&L', 'get');
  eq(r.data.createdBy, 'staff@x.com');

  // tick a task done; saving the same minutes again keeps it done
  r = env.post({ action: 'taskSet', token: kim, payload: { id, no: '1', status: 'Done' } });
  ok(r.ok, 'taskSet');
  eq(acts.rows[1][6], 'Done');
  eq(meet.rows[1][13], '1', 'open count updated');
  r = env.post({ action: 'save', token: staff, payload: { id, minutes: both } });
  eq(acts.rows.filter(x => x[0] === id).map(x => x[6]), ['Done', 'Open'], 'status kept after re-save');
  r = env.post({ action: 'get', token: kim, payload: { id } });
  eq(r.data.minutes.en.actions[0].status, 'Done', 'get merges status');
  r = env.post({ action: 'tasks', token: kim });
  eq(r.data.length, 2, 'tasks list');
  r = env.post({ action: 'list', token: kim });
  eq(r.data.map(x => x.id), [id2, id], 'list newest first');

  // Word and email
  r = env.post({ action: 'word', token: kim, payload: { id, lang: 'both' } });
  ok(r.ok, 'word ' + r.error);
  eq(Buffer.from(r.data.b64, 'base64').toString(), 'PK-docx');
  ok(/\.docx$/.test(r.data.name) && r.data.docUrl, 'docx name and doc link');
  const doc = Object.values(env.docs).pop();
  const text = doc.parts.join('\n');
  ok(text.indexOf('កំណត់ហេតុប្រជុំ') >= 0 && text.indexOf('Meeting Minutes') >= 0, 'both languages in the doc');
  ok(text.indexOf('Train drivers | Dara | 2026-10-30') >= 0, 'action table');
  ok(text.indexOf('---') >= 0, 'page break between languages');
  eq(doc.parts[0], 'កំណត់ហេតុប្រជុំ', 'empty first paragraph removed');
  eq(meet.rows[1][14], r.data.docUrl, 'doc link on the row');

  r = env.post({ action: 'email', token: kim, payload: { id, to: 'a@x.com; b@x.com', cc: '', lang: 'en', note: 'Dear team' } });
  ok(r.ok, 'email ' + r.error);
  eq(r.data.sent, 2);
  const mail = env.mails.pop();
  eq(mail.to, 'a@x.com,b@x.com'); eq(mail.replyTo, 'kim@x.com');
  ok(/Meeting minutes: Weekly W&L \(2026-10-20\)/.test(mail.subject), 'subject ' + mail.subject);
  ok(mail.htmlBody.indexOf('Train drivers') > 0 && mail.htmlBody.indexOf('Dear team') > 0 && mail.htmlBody.indexOf('ប្រជុំប្រចាំសប្តាហ៍') < 0, 'English-only body');
  ok(mail.htmlBody.indexOf('<script') < 0, 'escaped');
  eq(mail.attachments.length, 1);
  r = env.post({ action: 'email', token: kim, payload: { id, to: 'not-an-email' } });
  ok(!r.ok && /not-an-email/.test(r.error), 'bad address refused');

  // delete: only creator or admin
  r = env.post({ action: 'delete', token: env.session('staff@x.com'), payload: { id: id2 } });
  ok(r.ok, 'creator deletes');
  const kimMade = env.post({ action: 'save', token: kim, payload: { meta: { title: 'k' } } }).data.id;
  r = env.post({ action: 'delete', token: staff, payload: { id: kimMade } });
  ok(!r.ok && /^DENIED/.test(r.error), 'others cannot delete');
  r = env.post({ action: 'delete', token: kim, payload: { id } });
  ok(r.ok, 'admin deletes');
  eq(acts.getLastRow(), 1, 'actions removed with the meeting');
  ok(env.errors.length === 0, 'no server errors: ' + env.errors.join('; '));
}

async function relay() {
  const mod = await import(path.join(ROOT, 'functions/mm/[action].js'));
  eq(mod.cleanMime('audio/webm;codecs=opus'), 'audio/webm');
  eq(mod.cleanMime('audio/mp4'), 'audio/m4a');
  ok(/Continue from exactly after/.test(mod.buildPrompt({ kind: 'transcribe', tail: 'abc' })), 'continuation prompt');
  ok(/in English/.test(mod.buildPrompt({ kind: 'minutes', outLang: 'en', transcript: 'x' })), 'English minutes prompt');
  ok(/in Khmer/.test(mod.buildPrompt({ kind: 'minutes', outLang: 'km', transcript: 'x' })), 'Khmer minutes prompt');

  const crypto = require('crypto');
  const secret = 'abc123';
  const body = Buffer.from(JSON.stringify({ e: 'kim@x.com', x: Math.floor(Date.now() / 1000) + 600 })).toString('base64url');
  const tk = body + '.' + crypto.createHmac('sha256', secret).update(body).digest('base64url');
  const env = { GEMINI_API_KEY: 'KEY', MM_SECRET: secret };
  const calls = [];
  const real = global.fetch;
  global.fetch = async (url, o) => {
    o = o || {};
    calls.push({ url, o });
    const h = o.headers || {};
    if (/\/v1beta\/models\?/.test(url)) return new Response(JSON.stringify({ models: [
      { name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] },
      { name: 'models/gemini-3.8-flash', supportedGenerationMethods: ['generateContent'] },
      { name: 'models/gemini-9-flash-preview', supportedGenerationMethods: ['generateContent'] },
      { name: 'models/gemini-3.8-pro', supportedGenerationMethods: ['generateContent'] }] }));
    if (/upload\/v1beta\/files$/.test(url)) { assert.strictEqual(h['x-goog-api-key'], 'KEY'); return new Response('{}', { headers: { 'x-goog-upload-url': 'https://up.example/u1' } }); }
    if (url === 'https://up.example/u1') return new Response(JSON.stringify({ file: { name: 'files/u1', uri: 'https://g/files/u1', mimeType: 'audio/webm', state: 'ACTIVE' } }));
    if (/streamGenerateContent/.test(url)) {
      const sse = 'data: ' + JSON.stringify({ candidates: [{ content: { parts: [{ text: 'hello ' }] } }] }) + '\r\n\r\n' +
        'data: ' + JSON.stringify({ candidates: [{ content: { parts: [{ text: 'world' }] }, finishReason: 'STOP' }] }) + '\r\n\r\n';
      return new Response(sse, { headers: { 'Content-Type': 'text/event-stream' } });
    }
    throw new Error('unexpected ' + url);
  };
  try {
    const req = (action, init) => mod.onRequest({ request: new Request('https://isteel-app.pages.dev/mm/' + action, init), env, params: { action } });
    let res = await req('ping', { method: 'GET' });
    eq(await res.json(), { ok: true, ai: true, provider: 'gemini', ticket: true, photos: true });
    res = await req('generate', { method: 'POST', body: '{}' });
    eq(res.status, 401, 'no ticket');
    res = await req('upload', { method: 'POST', headers: { 'X-MM-Ticket': tk, 'Content-Type': 'audio/webm;codecs=opus', 'X-File-Name': encodeURIComponent('ការថត.webm') }, body: Buffer.from('audio') });
    const up = await res.json();
    ok(up.ok && up.data.uri === 'https://g/files/u1', 'upload ' + JSON.stringify(up));
    const start = calls.find(c => /upload\/v1beta\/files$/.test(c.url));
    eq(start.o.headers['X-Goog-Upload-Header-Content-Type'], 'audio/webm');
    eq(JSON.parse(start.o.body).file.display_name, 'ការថត.webm');
    res = await req('upload', { method: 'POST', headers: { 'X-MM-Ticket': tk, 'Content-Type': 'application/x-msdownload' }, body: Buffer.from('MZ') });
    eq(res.status, 415, 'odd file types refused');
    res = await req('generate', { method: 'POST', headers: { 'X-MM-Ticket': tk, 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'minutes', outLang: 'en', files: [{ uri: 'https://g/files/u1', mimeType: 'audio/webm' }], transcript: 'x' }) });
    eq(res.headers.get('X-MM-Model'), 'gemini-3.8-flash', 'newest stable flash picked');
    ok(/hello/.test(await res.text()), 'stream passed through');
    const g = JSON.parse(calls.find(c => /streamGenerateContent/.test(c.url)).o.body);
    eq(g.contents[0].parts[0], { file_data: { file_uri: 'https://g/files/u1', mime_type: 'audio/webm' } });
    eq(g.generationConfig.responseMimeType, 'application/json');
    ok(!g.generationConfig.thinkingConfig, 'no 2.5-only setting on newer models');
  } finally { global.fetch = real; }
}

async function groqRelay() {
  const mod = await import(path.join(ROOT, 'functions/mm/[action].js'));
  eq(mod.provider({ GROQ_API_KEY: 'g', GEMINI_API_KEY: 'k' }), 'groq', 'Groq first when both keys are set');
  eq(mod.provider({ GROQ_API_KEY: 'g', GEMINI_API_KEY: 'k', AI_PROVIDER: 'gemini' }), 'gemini');
  eq(mod.provider({}), '');
  eq(mod.whisperText({ segments: [{ start: 0, end: 4, text: ' Hello ' }, { start: 4, end: 9, text: 'team.' }, { start: 40, end: 42, text: 'Next.' }, { start: 3725, end: 3727, text: 'Bye.' }] }),
    '[00:00] Hello team.\n[00:40] Next.\n[1:02:05] Bye.', 'Whisper pieces joined into timed lines');
  eq(mod.whisperText({ segments: [{ start: 0, end: 3, text: 'Kim, Dara' }, { start: 3, end: 5, text: 'Thank you.', no_speech_prob: 0.95 }] }, 'Kim, Dara'), '', 'echoed hint and silence dropped');
  const E = {};
  eq(mod.groqCandidates(['llama-3.3-70b-versatile', 'openai/gpt-oss-120b', 'whisper-large-v3'], 'text', E), ['openai/gpt-oss-120b', 'llama-3.3-70b-versatile'], 'only models Groq still has');
  eq(mod.groqCandidates([], 'text', { GROQ_MODEL: 'x/y' })[0], 'x/y', 'model set in Cloudflare first');
  eq(mod.groqCandidates(['llama-3.3-70b-versatile', 'meta-llama/llama-4-maverick-17b-128e-instruct'], 'vision', E), ['meta-llama/llama-4-maverick-17b-128e-instruct']);

  const crypto = require('crypto');
  const secret = 'abc123';
  const body = Buffer.from(JSON.stringify({ e: 'kim@x.com', x: Math.floor(Date.now() / 1000) + 600 })).toString('base64url');
  const tk = body + '.' + crypto.createHmac('sha256', secret).update(body).digest('base64url');
  const env = { GROQ_API_KEY: 'GKEY', MM_SECRET: secret };
  const calls = [];
  let limited = 1, models = ['openai/gpt-oss-120b', 'llama-3.3-70b-versatile', 'whisper-large-v3'];
  const real = global.fetch;
  global.fetch = async (url, o) => {
    calls.push({ url, o });
    assert.strictEqual(o.headers.Authorization, 'Bearer GKEY');
    if (/\/models$/.test(url)) return new Response(JSON.stringify({ data: models.map(id => ({ id, active: true })) }));
    if (/audio\/transcriptions$/.test(url)) return new Response(JSON.stringify({ text: 'hi', segments: [{ start: 0, end: 2, text: 'សួស្តី' }] }));
    if (/chat\/completions$/.test(url)) {
      const b = JSON.parse(o.body);
      if (b.model === 'openai/gpt-oss-120b' && limited === -5) return new Response(JSON.stringify({ error: { message: 'The model `openai/gpt-oss-120b` does not exist or you do not have access to it.' } }), { status: 404 });
      if (limited-- > 0) return new Response('{"error":{"message":"rate"}}', { status: 429, headers: { 'retry-after': '0.01' } });
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"title":"T"}' } }] }));
    }
    throw new Error('unexpected ' + url);
  };
  try {
    const req = (action, init) => mod.onRequest({ request: new Request('https://isteel-app.pages.dev/mm/' + action, init), env, params: { action } });
    let res = await req('ping', { method: 'GET' });
    eq(await res.json(), { ok: true, ai: true, provider: 'groq', ticket: true, photos: false });
    const H = { 'X-MM-Ticket': tk };
    res = await req('upload', { method: 'POST', headers: Object.assign({ 'Content-Type': 'audio/webm;codecs=opus', 'X-File-Name': encodeURIComponent('ការថត'), 'X-MM-Lang': 'km', 'X-MM-Hint': encodeURIComponent('សុខ, Dara') }, H), body: Buffer.from('audio') });
    const up = await res.json();
    eq(up.data.text, '[00:00] សួស្តី', 'speech written out on upload');
    const form = calls[0].o.body;
    eq(form.get('model'), 'whisper-large-v3');
    eq(form.get('language'), 'km');
    ok(/សុខ, Dara/.test(form.get('prompt')), 'names hint passed');
    ok(/\.webm$/.test(form.get('file').name), 'file name gets a sound extension: ' + form.get('file').name);
    res = await req('upload', { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/pdf' }, H), body: Buffer.from('%PDF') });
    eq(res.status, 415, 'PDF not sent to the free AI');
    res = await req('upload', { method: 'POST', headers: Object.assign({ 'Content-Type': 'audio/mpeg' }, H), body: Buffer.alloc(26 * 1024 * 1024) });
    eq(res.status, 413, 'over 25 MB refused');
    ok(/25 MB/.test((await res.json()).error));
    const gen = async p => (await req('generate', { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, H), body: JSON.stringify(p) })).text();
    const one = s => JSON.parse(s.replace(/^data: /, '')).candidates[0].content.parts[0].text;
    eq(one(await gen({ kind: 'transcribe', files: [up.data] })), '[00:00] សួស្តី', 'transcript comes back in the Gemini stream shape');
    const n = calls.length;
    eq(one(await gen({ kind: 'minutes', outLang: 'en', transcript: 'x' })), '{"title":"T"}', 'minutes after a rate-limit wait');
    eq(calls.length - n, 3, 'model list, then tried again once after 429');
    const mb = JSON.parse(calls[calls.length - 1].o.body);
    eq(mb.model, 'openai/gpt-oss-120b');
    eq(mb.reasoning_effort, 'low');
    eq(mb.response_format, { type: 'json_object' });
    ok(/"actions"/.test(mb.messages[0].content), 'minutes shape given');
    limited = -5;
    const k = calls.length;
    eq(one(await gen({ kind: 'minutes', outLang: 'km', transcript: 'x' })), '{"title":"T"}', 'a retired model is skipped');
    eq(calls.slice(k).map(c => JSON.parse(c.o.body).model), ['openai/gpt-oss-120b', 'llama-3.3-70b-versatile']);
    limited = 0;
    const img = 'data:image/jpeg;base64,AAAA';
    const files = [1, 2, 3, 4, 5, 6].map(() => ({ inline: img })).concat([{ skipped: 'plan.pdf' }, { plain: 'typed note', name: 'n.txt' }]);
    let ocr = one(await gen({ kind: 'ocr', files }));
    ok(/photo 6 not read: no photo reader/.test(ocr) && /typed note/.test(ocr), 'no photo model anywhere: minutes still go on: ' + ocr);
    // Groq has no photo model, Cloudflare Workers AI reads them one by one (first model fails, the next answers)
    const aiCalls = [];
    env.AI = { run: async (model, inp) => { aiCalls.push({ model, inp }); if (/llama-4-scout/.test(model)) throw new Error('capacity'); return { response: 'MOM text ' + aiCalls.length }; } };
    ocr = one(await gen({ kind: 'ocr', files: [{ inline: img }, { inline: img }] }));
    eq(aiCalls.map(c => c.model.split('/').pop()), ['llama-4-scout-17b-16e-instruct', 'mistral-small-3.1-24b-instruct', 'llama-4-scout-17b-16e-instruct', 'mistral-small-3.1-24b-instruct']);
    ok(/MOM text 2/.test(ocr) && /MOM text 4/.test(ocr) && /File 2\./.test(aiCalls[2].inp.messages[0].content[0].text), 'Workers AI read both photos: ' + ocr);
    eq(aiCalls[1].inp.messages[0].content[1].image_url.url, img);
    delete env.AI;
    // nothing read at all: a clear message instead of empty minutes
    ok(mod.nothingToWrite({ transcript: '', ocr: '[photo 1 not read: x]\n\n[1 photo(s) not read: y]', notes: ' ' }), 'only not-read notes = nothing');
    ok(!mod.nothingToWrite({ ocr: 'Defects: friction' }), 'real text is something');
    const er = await req('generate', { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, H), body: JSON.stringify({ kind: 'minutes', ocr: '[photo 1 not read: x]' }) });
    eq(er.status, 422);
    ok(/^EMPTY: Nothing could be read/.test((await er.json()).error), 'empty material refused');
    models.push('meta-llama/llama-4-maverick-17b-128e-instruct');
    mod.__resetGroq && mod.__resetGroq();
    const m = calls.length;
    ocr = one(await gen({ kind: 'ocr', files }));
    eq(calls.length - m, 3, 'model list, then six photos asked in two groups of up to five');
    eq(JSON.parse(calls[calls.length - 1].o.body).model, 'meta-llama/llama-4-maverick-17b-128e-instruct');
    ok(/File 6/.test(JSON.parse(calls[calls.length - 1].o.body).messages[0].content[0].text), 'second group numbered from File 6');
    ok(/typed note/.test(ocr) && /plan\.pdf: not read/.test(ocr), 'text file kept and PDF named: ' + ocr);
  } finally { global.fetch = real; }
}

(async () => {
  await backend();
  await relay();
  await groqRelay();
  console.log('All ' + pass + ' checks passed');
})().catch(e => { console.error(e); process.exit(1); });
