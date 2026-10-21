// Local copy of the whole app for browser tests: web/ files, /api = Minutes.gs (mock Google), /mm/* = the Cloudflare
// relay with a fake Gemini. Prints the sign-in token for kim@x.com. Run: node apps-script-minutes/tests/server.js 8790
'use strict';
const http = require('http'), fs = require('fs'), path = require('path');
const { makeEnv } = require('./gas-mm');

const ROOT = path.join(__dirname, '..', '..');
const PORT = +process.argv[2] || 8790;
const env = makeEnv({ file: path.join(ROOT, 'apps-script-minutes/Minutes.gs'),
  users: [['Email', 'Name', 'Role', 'Active', 'ប្រជុំ'], ['kim@x.com', 'Kim', 'admin', 'Yes', false]],
  props: { SESSION_SECRET: 's3cret', USERS_SHEET_ID: 'USERS', GOOGLE_CLIENT_ID: 'cid' } });
env.g.setup();
const gemini = { calls: [], uploads: 0 };

const MIN = lang => ({
  title: lang === 'en' ? 'Weekly W&L meeting' : 'ប្រជុំប្រចាំសប្តាហ៍', meetingDate: '2026-10-20', startTime: '09:00', duration: '45 min', location: 'WH room', chair: 'Kim',
  attendees: [{ name: 'Kim', role: 'W&L Manager' }, { name: 'Dara', role: 'Transport' }],
  summary: lang === 'en' ? 'The team agreed to print DNs before 7 am.' : 'ក្រុមការងារបានសម្រេច print DN មុនម៉ោង 7 ព្រឹក។',
  discussion: [{ topic: 'Gate 2', points: ['Trucks wait 2 hours'] }], decisions: ['Print DN before 7 am'],
  actions: [{ task: lang === 'en' ? 'Print DNs early' : 'Print DN មុនម៉ោង 7', owner: 'Logistics', due: '2026-10-26', priority: 'High' }, { task: 'Weekly gate report', owner: 'TBC', due: 'TBC', priority: 'Medium' }],
  followUp: ['Check next week'], openPoints: ['Branch rollout date?'], nextMeeting: 'Monday 9:00', glossary: [{ term: 'DN', meaning: 'Delivery Note' }],
});
const sse = (chunks, finish) => chunks.map((t, i) => 'data: ' + JSON.stringify({ candidates: [{ content: { parts: [{ text: t }] }, finishReason: i === chunks.length - 1 ? finish : undefined }] }) + '\r\n\r\n').join('');
// MM_AI=groq runs the free Groq way instead: Whisper for sound, Llama for photos and minutes.
const GROQ = process.env.MM_AI === 'groq';
const groqFake = async (url, o) => {
  gemini.calls.push({ url: String(url), body: typeof o.body === 'string' ? o.body : '' });
  await new Promise(r => setTimeout(r, 150));
  if (/audio\/transcriptions$/.test(url)) {
    gemini.uploads++;
    return new Response(JSON.stringify({ text: 'x', segments: [{ start: 0, end: 3, text: 'អរុណសួស្តី។' }, { start: 3, end: 6, text: 'Today we talk about Gate 2.' }, { start: 300, end: 304, text: 'Dara: យល់ព្រម។ OK, print DN before 7.' }] }));
  }
  const b = JSON.parse(o.body);
  const prompt = JSON.stringify(b.messages);
  const content = /Copy all the text/.test(prompt) ? '=== File 1 ===\nAgenda: Gate 2' : JSON.stringify(MIN(/in English/.test(prompt) ? 'en' : 'km'));
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }));
};
const realFetch = global.fetch;
global.fetch = async (url, o) => {
  o = o || {};
  if (GROQ && /api\.groq\.com/.test(String(url))) return groqFake(url, o);
  if (!/generativelanguage|up\.fake/.test(String(url))) return realFetch(url, o);
  gemini.calls.push({ url: String(url), body: typeof o.body === 'string' ? o.body : '' });
  if (/v1beta\/models\?/.test(url)) return new Response(JSON.stringify({ models: [{ name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] }] }));
  if (/upload\/v1beta\/files$/.test(url)) return new Response('{}', { headers: { 'x-goog-upload-url': 'https://up.fake/' + (++gemini.uploads) } });
  if (/up\.fake/.test(url)) { const n = String(url).split('/').pop(); return new Response(JSON.stringify({ file: { name: 'files/' + n, uri: 'https://g/files/' + n, mimeType: 'x', state: 'PROCESSING' } })); }
  if (/v1beta\/files\//.test(url)) { const n = String(url).split('/').pop(); return new Response(JSON.stringify({ name: 'files/' + n, uri: 'https://g/files/' + n, mimeType: 'x', state: 'ACTIVE' })); }
  if (/streamGenerateContent/.test(url)) {
    const b = JSON.parse(o.body);
    const prompt = b.contents[0].parts.map(p => p.text || '').join('');
    let body;
    if (/Transcribe this meeting/.test(prompt)) {
      // First answer stops at the length limit, so the app has to ask it to carry on.
      body = /Continue from exactly/.test(prompt) ? sse(['[05:00] Dara: យល់ព្រម។ OK, print DN before 7.'], 'STOP')
        : sse(['[00:00] Kim: អរុណសួស្តី។ ', 'Today we talk about Gate 2.'], 'MAX_TOKENS');
    } else if (/Copy all the text/.test(prompt)) body = sse(['=== File 1 ===\nAgenda: Gate 2'], 'STOP');
    else { const j = JSON.stringify(MIN(/in English/.test(prompt) ? 'en' : 'km')); body = sse([j.slice(0, 50), j.slice(50)], 'STOP'); }
    await new Promise(r => setTimeout(r, 150));
    return new Response(body, { headers: { 'Content-Type': 'text/event-stream' } });
  }
  throw new Error('unexpected ' + url);
};

const relayEnv = GROQ ? { GROQ_API_KEY: 'GKEY', MM_SECRET: env.props.MM_SECRET } : { GEMINI_API_KEY: 'KEY', MM_SECRET: env.props.MM_SECRET };
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/json' };

(async () => {
  const relay = await import(path.join(ROOT, 'functions/mm/[action].js'));
  http.createServer((req, res) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', async () => {
      const body = Buffer.concat(chunks);
      const url = req.url.split('?')[0];
      if (req.method === 'POST' && url === '/api') {
        const out = env.g.doPost({ postData: { contents: body.toString('utf8') } }).s;
        res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(out); return;
      }
      if (url === '/_test') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ gemini, mails: env.mails, actions: env.ss.getSheetByName('Actions').rows, meetings: env.ss.getSheetByName('Meetings').rows })); return; }
      if (url.startsWith('/mm/')) {
        const r = await relay.onRequest({ request: new Request('http://x' + req.url, { method: req.method, headers: req.headers, body: req.method === 'POST' ? body : undefined }), env: relayEnv, params: { action: url.slice(4) } });
        const h = {}; r.headers.forEach((v, k) => { h[k] = v; });
        res.writeHead(r.status, h);
        const reader = r.body.getReader();
        for (;;) { const x = await reader.read(); if (x.done) break; res.write(Buffer.from(x.value)); }
        res.end(); return;
      }
      if (url === '/minutes/config.js') { res.writeHead(200, { 'Content-Type': 'text/javascript' }); res.end("window.MM_CONFIG={API_URL:'/api'};"); return; }
      let p = decodeURIComponent(url); if (p.endsWith('/')) p += 'index.html';
      const f = path.join(ROOT, 'web', p);
      fs.readFile(f, (e, d) => { if (e) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' }); res.end(d); });
    });
  }).listen(PORT, () => console.log('TOKEN ' + env.session('kim@x.com')));
})();
