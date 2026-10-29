// Meeting Minutes AI relay (Cloudflare Pages Function, served at /mm/upload, /mm/generate and /mm/ping).
// Holds the AI key, so the key never reaches a phone. Only people the Minutes Apps Script let in can use it:
// every call carries a "ticket" the script signed with MM_SECRET (email + expiry), checked here before anything else.
//
// Two AI services work. Groq is free with no card (console.groq.com) and is used whenever GROQ_API_KEY is set:
// Whisper writes out the speech, Llama reads photos and writes the minutes. Gemini (Google) is the other way; Kim's
// Google account was refused by Gemini (403, 20 Oct 2026), so Groq was added on 21 Oct 2026.
//
// Cloudflare Pages > isteel-app > Settings > Variables and Secrets (type Secret, Production):
//   GROQ_API_KEY    key from console.groq.com > API Keys
//   GEMINI_API_KEY  key from Google AI Studio (aistudio.google.com > Get API key), used when there is no Groq key
//   MM_SECRET       the same value as MM_SECRET in the Minutes Apps Script (made by setup())
//   AI_PROVIDER     optional, groq or gemini, to choose when both keys are set (default groq)
//   GROQ_MODEL, GROQ_VISION_MODEL, GROQ_STT_MODEL, GEMINI_MODEL  optional model names; empty = picked by the relay

const BASE = 'https://generativelanguage.googleapis.com';
const MAX_UPLOAD = 95 * 1024 * 1024;   // Pages Functions take request bodies up to 100 MB
const GROQ = 'https://api.groq.com/openai/v1';
const GROQ_MAX_AUDIO = 25 * 1024 * 1024;   // Groq's free plan takes audio files up to 25 MB
const GROQ_STT = 'whisper-large-v3';       // the full model: better at Khmer than the turbo one
// Groq retires models often (Llama 4 Scout went in Oct 2026), so the relay asks Groq which models it has and takes
// the first of these that is there; if one fails as gone or too small for the meeting, the next one is tried.
const GROQ_TEXT = ['openai/gpt-oss-120b', 'moonshotai/kimi-k2-instruct-0905', 'moonshotai/kimi-k2-instruct', 'llama-3.3-70b-versatile',
  'qwen/qwen3-32b', 'openai/gpt-oss-20b', 'llama-3.1-8b-instant'];
const isVision = id => /llama-4|vision|-vl\b|scout|maverick|gemma-3|pixtral/i.test(id);

export const provider = env => {
  const want = String(env.AI_PROVIDER || '').toLowerCase();
  if (want === 'gemini' && env.GEMINI_API_KEY) return 'gemini';
  return env.GROQ_API_KEY ? 'groq' : env.GEMINI_API_KEY ? 'gemini' : '';
};

export async function onRequest({ request, env, params }) {
  const action = String(params.action || '');
  try {
    const ai = provider(env);
    if (action === 'ping') return json({ ok: true, ai: !!ai, provider: ai, ticket: !!env.MM_SECRET, photos: ai === 'gemini' || !!env.AI });
    if (request.method !== 'POST') return json({ ok: false, error: 'BAD: Use POST' }, 405);
    if (!ai || !env.MM_SECRET) return json({ ok: false, error: 'SETUP: GROQ_API_KEY (or GEMINI_API_KEY) or MM_SECRET is missing in Cloudflare.' }, 500);
    const who = await checkTicket(request.headers.get('X-MM-Ticket') || '', env.MM_SECRET);
    if (!who) return json({ ok: false, error: 'AUTH: Sign-in expired. Please open the app again.' }, 401);
    if (action === 'upload') return await (ai === 'groq' ? groqUpload : upload)(request, env);
    if (action === 'generate') return await (ai === 'groq' ? groqGenerate : generate)(request, env);
    return json({ ok: false, error: 'BAD: Unknown action' }, 404);
  } catch (e) {
    const code = e && e.status === 429 ? 'LIMIT' : e && e.status === 413 ? 'BIG' : 'AI';
    return json({ ok: false, error: code + ': ' + String(e && e.message || e).slice(0, 400) }, code === 'LIMIT' ? 429 : code === 'BIG' ? 413 : 502);
  }
}

const json = (o, status) => new Response(JSON.stringify(o), { status: status || 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

// ---------- ticket: base64url(JSON {e, x}) + "." + base64url(HMAC-SHA256(MM_SECRET)) ----------
const b64url = bytes => btoa(String.fromCharCode.apply(null, new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export async function checkTicket(ticket, secret) {
  const parts = String(ticket).split('.');
  if (parts.length !== 2 || !secret) return null;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = b64url(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(parts[0])));
  if (sig !== parts[1]) return null;
  try {
    const body = JSON.parse(atob(parts[0].replace(/-/g, '+').replace(/_/g, '/')));
    return body && body.x * 1000 > Date.now() ? String(body.e || '') : null;
  } catch (e) { return null; }
}

// ---------- model: the newest stable gemini-N-flash this key can use, kept for an hour ----------
let picked = { name: '', at: 0 };
async function model(env) {
  if (env.GEMINI_MODEL) return env.GEMINI_MODEL;
  if (picked.name && Date.now() - picked.at < 3600e3) return picked.name;
  let best = 'gemini-2.5-flash', bestV = 0;
  try {
    const r = await fetch(BASE + '/v1beta/models?pageSize=1000', { headers: { 'x-goog-api-key': env.GEMINI_API_KEY } });
    const d = await r.json();
    (d.models || []).forEach(m => {
      const n = String(m.name || '').replace(/^models\//, '');
      const v = (n.match(/^gemini-(\d+(?:\.\d+)?)-flash$/) || [])[1];
      if (v && (m.supportedGenerationMethods || []).indexOf('generateContent') >= 0 && +v > bestV) { best = n; bestV = +v; }
    });
  } catch (e) { /* keep the fallback */ }
  picked = { name: best, at: Date.now() };
  return best;
}

// ---------- upload one file to the Gemini Files API (kept there 48 hours) ----------
const MIME_FIX = { 'audio/mp4': 'audio/m4a', 'audio/x-m4a': 'audio/m4a', 'audio/mp3': 'audio/mpeg', 'audio/x-wav': 'audio/wav', 'audio/wave': 'audio/wav' };
export function cleanMime(m) {
  const base = String(m || '').split(';')[0].trim().toLowerCase() || 'application/octet-stream';
  return MIME_FIX[base] || base;
}

async function upload(request, env) {
  const mime = cleanMime(request.headers.get('Content-Type'));
  if (!/^(audio|video|image)\/|^application\/pdf$|^text\/plain$/.test(mime)) return json({ ok: false, error: 'TYPE: This file type cannot be read.' }, 415);
  const name = decodeURIComponent(request.headers.get('X-File-Name') || 'meeting-file').slice(0, 200);
  const buf = await request.arrayBuffer();
  if (!buf.byteLength) return json({ ok: false, error: 'BAD: Empty file' }, 400);
  if (buf.byteLength > MAX_UPLOAD) return json({ ok: false, error: 'BIG: File is over 95 MB.' }, 413);
  const start = await fetch(BASE + '/upload/v1beta/files', {
    method: 'POST',
    headers: {
      'x-goog-api-key': env.GEMINI_API_KEY, 'Content-Type': 'application/json',
      'X-Goog-Upload-Protocol': 'resumable', 'X-Goog-Upload-Command': 'start',
      'X-Goog-Upload-Header-Content-Length': String(buf.byteLength), 'X-Goog-Upload-Header-Content-Type': mime,
    },
    body: JSON.stringify({ file: { display_name: name } }),
  });
  const url = start.headers.get('x-goog-upload-url');
  if (!url) throw new Error('Upload could not start (' + start.status + '): ' + (await start.text()).slice(0, 200));
  const up = await fetch(url, {
    method: 'POST',
    headers: { 'X-Goog-Upload-Offset': '0', 'X-Goog-Upload-Command': 'upload, finalize' },
    body: buf,
  });
  const d = await up.json().catch(() => ({}));
  let f = d.file;
  if (!f || !f.uri) throw new Error('Upload failed (' + up.status + ')');
  // Audio and video are processed by Google before use: wait until ACTIVE (up to about 2 minutes).
  for (let i = 0; f.state === 'PROCESSING' && i < 60; i++) {
    await new Promise(r => setTimeout(r, 2000));
    const g = await fetch(BASE + '/v1beta/' + f.name, { headers: { 'x-goog-api-key': env.GEMINI_API_KEY } });
    f = await g.json();
  }
  if (f.state === 'FAILED') throw new Error('Google could not read this file.');
  return json({ ok: true, data: { uri: f.uri, mimeType: f.mimeType || mime, name: f.name, state: f.state || 'ACTIVE', size: buf.byteLength } });
}

// ---------- generate: transcript, text from photos, or the minutes. Streams Gemini's answer back (SSE). ----------
const LANG_NAME = { km: 'Khmer', en: 'English', auto: 'Khmer and English (often mixed in one sentence)' };

export function buildPrompt(p) {
  const meta = p.meta || {};
  const ctx = 'This is a meeting at ISI Steel (SSK Steel), Warehouse & Logistics department, Phnom Penh, Cambodia. ' +
    'People talk about steel products, SAP (orders SO, deliveries DN, goods issue, MB51 stock reports), trucks and plate numbers, ' +
    '3PL transport companies, drivers, fuel, overtime, warehouse staff and safety.';
  if (p.kind === 'transcribe') {
    const lang = LANG_NAME[p.lang] || LANG_NAME.auto;
    let s = ctx + '\n\nTranscribe this meeting recording word for word. Spoken language: ' + lang + '.\n' +
      '- Write Khmer words in Khmer script and English words in English, exactly as spoken. Do not translate.\n' +
      '- Start every new speaker turn on its own line as: [mm:ss] Speaker name: text. Use a name when people say it; otherwise Speaker 1, Speaker 2.\n' +
      '- Keep numbers, dates, SAP numbers, plate numbers and product names exactly.\n' +
      '- Write [unclear] for words you cannot hear. Skip long silences. Do not summarise.\n' +
      '- Output only the transcript.';
    if (meta.attendees) s += '\nPeople in the meeting (for names): ' + String(meta.attendees).slice(0, 1000);
    if (p.tail) s += '\n\nThe transcript is already written up to this point:\n"""\n' + String(p.tail).slice(-2000) +
      '\n"""\nContinue from exactly after that point to the end of the recording. Do not repeat what is already written.';
    return s;
  }
  if (p.kind === 'ocr') {
    return ctx + '\n\nCopy all the text from these files (meeting notes, whiteboard photos, agendas, reports). ' +
      'Keep Khmer in Khmer script. Start each file with a line "=== File N ===". Write tables as rows with " | " between cells. ' +
      'Write [unclear] for words you cannot read. If a photo has no text, describe in one line what it shows. Output only the text.';
  }
  // minutes
  const out = p.outLang === 'en' ? 'English' : 'Khmer (keep English technical words, names and SAP codes as they are)';
  return ctx + '\n\nWrite the official meeting minutes in ' + out + ' from the material below.\n' +
    'Rules:\n' +
    '- Use only what is in the material. Never invent people, numbers, dates or decisions.\n' +
    '- Action items: one clear task each, starting with a verb. Owner = the person who agreed to do it; due = YYYY-MM-DD. ' +
    'If the owner or date was not said, write "TBC". Work out dates like "next Friday" from the meeting date.\n' +
    '- Decisions: only things the meeting agreed. Open points: questions left without an answer.\n' +
    '- Glossary: explain every acronym or steel/SAP/logistics term used (e.g. SO, DN, 3PL, OTIF, GI, MB51, HRC, CRC) in one short line each, for a reader new to the steel industry.\n' +
    '- Summary: 3 to 6 sentences a manager can read in 30 seconds.\n' +
    '- Empty lists are fine. Fill meeting date, time and place only if known.\n\n' +
    'Meeting details typed by the note taker:\n' + JSON.stringify({
      title: meta.title || '', date: meta.date || '', time: meta.time || '', location: meta.location || '',
      attendees: meta.attendees || '', agenda: meta.agenda || '', today: p.today || '',
    }) + '\n\n' +
    (p.transcript ? 'TRANSCRIPT:\n"""\n' + String(p.transcript) + '\n"""\n\n' : '') +
    (p.ocr ? 'TEXT FROM PHOTOS AND DOCUMENTS:\n"""\n' + String(p.ocr) + '\n"""\n\n' : '') +
    (p.notes ? 'NOTES TYPED BY THE NOTE TAKER:\n"""\n' + String(p.notes) + '\n"""\n' : '');
}

const S = { type: 'STRING' };
const LIST = { type: 'ARRAY', items: S };
export const MINUTES_SCHEMA = {
  type: 'OBJECT',
  properties: {
    title: S, meetingDate: S, startTime: S, duration: S, location: S, chair: S,
    attendees: { type: 'ARRAY', items: { type: 'OBJECT', properties: { name: S, role: S }, required: ['name'] } },
    summary: S,
    discussion: { type: 'ARRAY', items: { type: 'OBJECT', properties: { topic: S, points: LIST }, required: ['topic', 'points'] } },
    decisions: LIST,
    actions: { type: 'ARRAY', items: { type: 'OBJECT', properties: { task: S, owner: S, due: S, priority: { type: 'STRING', enum: ['High', 'Medium', 'Low'] } }, required: ['task', 'owner', 'due'] } },
    followUp: LIST, openPoints: LIST, nextMeeting: S,
    glossary: { type: 'ARRAY', items: { type: 'OBJECT', properties: { term: S, meaning: S }, required: ['term', 'meaning'] } },
  },
  required: ['title', 'summary', 'discussion', 'decisions', 'actions', 'followUp', 'openPoints', 'glossary'],
};

async function generate(request, env) {
  const p = await request.json();
  if (['transcribe', 'ocr', 'minutes'].indexOf(p.kind) < 0) return json({ ok: false, error: 'BAD: kind' }, 400);
  if (p.kind === 'minutes' && nothingToWrite(p)) return json({ ok: false, error: EMPTY }, 422);
  const name = await model(env);
  const parts = [];
  (p.files || []).slice(0, 30).forEach(f => { if (f && f.uri) parts.push({ file_data: { file_uri: String(f.uri), mime_type: String(f.mimeType || '') } }); });
  parts.push({ text: buildPrompt(p) });
  const gen = { temperature: p.kind === 'minutes' ? 0.3 : 0, maxOutputTokens: 65536 };
  if (p.kind === 'minutes') { gen.responseMimeType = 'application/json'; gen.responseSchema = MINUTES_SCHEMA; }
  if (/^gemini-2\.5-flash/.test(name)) gen.thinkingConfig = { thinkingBudget: 0 };   // faster; 2.5 accepts 0
  const r = await fetch(BASE + '/v1beta/models/' + name + ':streamGenerateContent?alt=sse', {
    method: 'POST',
    headers: { 'x-goog-api-key': env.GEMINI_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig: gen }),
  });
  if (!r.ok) {
    const t = await r.text();
    let msg = t.slice(0, 300);
    try { msg = JSON.parse(t).error.message; } catch (e) { /* keep text */ }
    return json({ ok: false, error: (r.status === 429 ? 'LIMIT: ' : 'AI: ') + msg }, r.status === 429 ? 429 : 502);
  }
  return new Response(r.body, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', 'X-MM-Model': name } });
}

// ---------- Groq (free): Whisper for speech, Llama for photos and minutes ----------
// The answers go back in the same "data: {candidates…}" form Gemini streams, so the app reads both the same way.
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function groqFetch(env, path, init) {
  for (let i = 0; ; i++) {
    const r = await fetch(GROQ + path, Object.assign({}, init, { headers: Object.assign({ Authorization: 'Bearer ' + env.GROQ_API_KEY }, init.headers || {}) }));
    if (r.ok) return r;
    // The free plan allows so many words per minute; when two answers run at once, wait for the minute to pass (twice at most).
    if (r.status === 429 && i < 2) { await sleep(Math.min(20, parseFloat(r.headers.get('retry-after')) || 6) * 1000); continue; }
    const t = await r.text();
    let msg = t.slice(0, 300);
    try { msg = JSON.parse(t).error.message; } catch (e) { /* keep text */ }
    throw Object.assign(new Error(msg), { status: r.status });
  }
}

const AUDIO_EXT = { 'audio/webm': 'webm', 'video/webm': 'webm', 'audio/ogg': 'ogg', 'audio/m4a': 'm4a', 'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/flac': 'flac', 'video/mp4': 'mp4', 'audio/aac': 'm4a' };
const clock = s => { s = Math.max(0, Math.floor(s)); const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, x = s % 60; return (h ? h + ':' : '') + String(m).padStart(2, '0') + ':' + String(x).padStart(2, '0'); };

/** Whisper's pieces joined into lines of up to about 30 seconds, each starting with [mm:ss]. Whisper does not tell speakers apart.
 *  Pieces Whisper marks as probably not speech, or that only repeat the hint it was given, are dropped (it makes those up on silence). */
export function whisperText(d, hint) {
  const echo = String(hint || '').toLowerCase();
  const segs = ((d && d.segments) || []).filter(g => !(g.no_speech_prob > 0.8) && !(echo && echo.indexOf(String(g.text || '').trim().toLowerCase()) >= 0));
  if (d && d.segments && d.segments.length && !segs.length) return '';
  if (!segs.length) return String((d && d.text) || '').trim();
  const lines = [];
  let cur = null;
  segs.forEach(g => {
    const txt = String(g.text || '').trim();
    if (!txt) return;
    if (!cur || g.start - cur.start > 30 || g.start - cur.end > 2) { cur = { start: g.start, end: g.end, text: [] }; lines.push(cur); }
    cur.text.push(txt); cur.end = g.end;
  });
  return lines.map(l => '[' + clock(l.start) + '] ' + l.text.join(' ')).join('\n');
}

async function groqUpload(request, env) {
  const mime = cleanMime(request.headers.get('Content-Type'));
  if (!/^(audio|video)\//.test(mime)) return json({ ok: false, error: 'TYPE: Only sound files go here; photos are read inside the app.' }, 415);
  const buf = await request.arrayBuffer();
  if (!buf.byteLength) return json({ ok: false, error: 'BAD: Empty file' }, 400);
  if (buf.byteLength > GROQ_MAX_AUDIO) return json({ ok: false, error: 'BIG: The free AI takes sound files up to 25 MB (about 1 hour 45 minutes of a phone recording). Record shorter parts, or save the audio as a smaller file. || AI ឥតគិតថ្លៃ ទទួលឯកសារសំឡេងត្រឹម 25 MB (ប្រហែល 1 ម៉ោង 45 នាទី នៃការថតលើទូរស័ព្ទ)។ សូមថតជាផ្នែកខ្លីៗ ឬរក្សាទុកសំឡេងជាឯកសារតូចជាងនេះ។' }, 413);
  let name = decodeURIComponent(request.headers.get('X-File-Name') || 'meeting').replace(/[^\w.-]+/g, '_').slice(-80);
  if (!/\.(webm|ogg|m4a|mp3|mp4|mpeg|mpga|wav|flac|opus)$/i.test(name)) name += '.' + (AUDIO_EXT[mime] || 'webm');
  const form = new FormData();
  form.append('file', new Blob([buf], { type: mime }), name);
  form.append('model', env.GROQ_STT_MODEL || GROQ_STT);
  form.append('response_format', 'verbose_json');
  form.append('temperature', '0');
  const lang = request.headers.get('X-MM-Lang');
  if (lang === 'km' || lang === 'en') form.append('language', lang);
  // The names of the people help Whisper spell them. (A list of company words was tried: on a quiet recording Whisper wrote it back as speech.)
  const hint = decodeURIComponent(request.headers.get('X-MM-Hint') || '').slice(0, 150).trim();
  if (hint) form.append('prompt', hint);
  const r = await groqFetch(env, '/audio/transcriptions', { method: 'POST', body: form });
  const text = whisperText(await r.json(), hint);
  if (!text) return json({ ok: false, error: 'NOSPEECH: No speech was heard in this recording. Check the microphone and record again. || មិនឮសំឡេងនិយាយក្នុងការថតនេះទេ។ សូមពិនិត្យមីក្រូហ្វូន ហើយថតម្តងទៀត។' }, 422);
  return json({ ok: true, data: { provider: 'groq', text, mimeType: mime, size: buf.byteLength } });
}

const sseOf = (text, model) => new Response('data: ' + JSON.stringify({ candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }] }) + '\r\n\r\n',
  { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', 'X-MM-Model': model } });

const MINUTES_SHAPE = '{"title":"","meetingDate":"YYYY-MM-DD","startTime":"","duration":"","location":"","chair":"",' +
  '"attendees":[{"name":"","role":""}],"summary":"","discussion":[{"topic":"","points":[""]}],"decisions":[""],' +
  '"actions":[{"task":"","owner":"","due":"YYYY-MM-DD or TBC","priority":"High, Medium or Low"}],' +
  '"followUp":[""],"openPoints":[""],"nextMeeting":"","glossary":[{"term":"","meaning":""}]}';

let groqIds = { list: null, at: 0 };
export const __resetGroq = () => { groqIds = { list: null, at: 0 }; };   // tests only
async function groqModels(env) {
  if (groqIds.list && Date.now() - groqIds.at < 3600e3) return groqIds.list;
  try {
    const d = await (await groqFetch(env, '/models', { method: 'GET' })).json();
    groqIds = { list: (d.data || []).filter(m => m && m.id && m.active !== false).map(m => String(m.id)), at: Date.now() };
  } catch (e) { return []; }
  return groqIds.list;
}
/** Models to try, best first: the one set in Cloudflare, then the known good ones Groq still has (all of them if the list is unknown). */
export function groqCandidates(ids, kind, env) {
  const set = kind === 'vision' ? env.GROQ_VISION_MODEL : env.GROQ_MODEL;
  const known = kind === 'vision' ? (ids || []).filter(isVision) : GROQ_TEXT.filter(m => !ids || !ids.length || ids.indexOf(m) >= 0);
  return [set].concat(known).filter((m, i, a) => m && a.indexOf(m) === i);
}
const MOVE_ON = /does not exist|not found|decommission|deprecat|not supported|do not have access|json_validate_failed|failed to generate json/i;

async function groqChat(env, messages, extra, kind) {
  const list = groqCandidates(await groqModels(env), kind, env);
  if (!list.length) throw Object.assign(new Error('Groq has no model that can read photos right now.'), { status: 404 });
  let last;
  for (const model of list) {
    const body = Object.assign({ model, messages, temperature: 0, max_completion_tokens: 8192 }, extra || {});
    if (/gpt-oss/.test(model)) body.reasoning_effort = 'low';      // thinks less, answers sooner
    if (/qwen3/.test(model)) body.reasoning_effort = 'none';
    try {
      const d = await (await groqFetch(env, '/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();
      return { text: String((((d.choices || [])[0] || {}).message || {}).content || ''), model };
    } catch (e) {
      last = e;
      if (!(e.status === 404 || e.status === 413 || (e.status === 400 && MOVE_ON.test(e.message)))) throw e;
    }
  }
  throw last;
}

// Cloudflare Workers AI (free, the "AI" binding the Fuel app's /fc/ relay also uses) reads photos when Groq cannot.
const WORKERS_VISION = ['@cf/meta/llama-4-scout-17b-16e-instruct', '@cf/mistralai/mistral-small-3.1-24b-instruct', '@cf/google/gemma-3-12b-it'];
async function workersRead(env, prompt, dataUrl) {
  if (!env.AI) return { error: 'no photo reader is set up (Cloudflare Workers AI binding "AI")' };
  const tried = [];
  for (const model of WORKERS_VISION) {
    try {
      const out = await env.AI.run(model, { messages: [{ role: 'user', content: [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: dataUrl } }] }], max_tokens: 4096, temperature: 0 });
      const text = String((out && (out.response || (((out.choices || [])[0] || {}).message || {}).content)) || '').trim();
      if (text) return { text, model };
      tried.push(model.split('/').pop() + ': empty answer');
    } catch (e) { tried.push(model.split('/').pop() + ': ' + String(e && e.message || e).slice(0, 80)); }
  }
  return { error: tried.join(' | ') };
}

/** True when there is nothing to write minutes from: no speech, no text read from photos, no typed notes. */
export function nothingToWrite(p) {
  const ocr = String(p.ocr || '').replace(/\[[^\]]*not read[^\]]*\]/g, '').trim();
  return !String(p.transcript || '').trim() && !ocr && !String(p.notes || '').trim();
}
const EMPTY = 'EMPTY: Nothing could be read from the recording or photos, so there is nothing to write minutes from. Add a clearer photo, or paste the text into the box "Agenda or your own notes". || មិនអាចអានអ្វីបានពីការថត ឬរូបភាពទេ ដូច្នេះគ្មានអ្វីសរសេរកំណត់ហេតុបានទេ។ សូមបន្ថែមរូបភាពច្បាស់ជាងនេះ ឬបិទភ្ជាប់អត្ថបទក្នុងប្រអប់ «របៀបវារៈ ឬកំណត់ចំណាំ»។';

async function groqGenerate(request, env) {
  const p = await request.json();
  if (['transcribe', 'ocr', 'minutes'].indexOf(p.kind) < 0) return json({ ok: false, error: 'BAD: kind' }, 400);
  if (p.kind === 'minutes' && nothingToWrite(p)) return json({ ok: false, error: EMPTY }, 422);
  const files = (p.files || []).slice(0, 30).filter(Boolean);
  // The speech was already written out when the file was sent (Whisper), so it only comes back here.
  if (p.kind === 'transcribe') return sseOf(files.map(f => String(f.text || '')).join('\n\n').trim(), env.GROQ_STT_MODEL || GROQ_STT);
  if (p.kind === 'ocr') {
    const imgs = files.filter(f => /^data:image\/(jpeg|png|webp);base64,/.test(String(f.inline || '')));
    const out = [];
    let model = '';
    for (let i = 0; i < imgs.length; i += 5) {   // Groq takes up to 5 photos in one question
      const batch = imgs.slice(i, i + 5);
      const content = [{ type: 'text', text: buildPrompt(p) + '\nThe first photo here is File ' + (i + 1) + '.' }]
        .concat(batch.map(f => ({ type: 'image_url', image_url: { url: f.inline } })));
      let r;
      try { r = await groqChat(env, [{ role: 'user', content }], null, 'vision'); } catch (e) {
        if (e.status !== 404 && !(e.status === 400 && MOVE_ON.test(e.message))) throw e;
        // Groq has no photo model now (Oct 2026): Cloudflare's own free Workers AI reads them, one at a time.
        for (let j = 0; j < batch.length; j++) {
          const w = await workersRead(env, buildPrompt(p) + '\nThis photo is File ' + (i + j + 1) + '.', batch[j].inline);
          out.push(w.text || '[photo ' + (i + j + 1) + ' not read: ' + w.error + ']');
          if (w.model) model = w.model;
        }
        continue;
      }
      out.push(r.text.trim()); model = r.model;
    }
    files.filter(f => f.plain).forEach(f => out.push('=== ' + String(f.name || 'Text') + ' ===\n' + String(f.plain).slice(0, 20000)));
    files.filter(f => f.skipped).forEach(f => out.push('[' + String(f.skipped) + ': not read]'));
    return sseOf(out.join('\n\n'), model);
  }
  const r = await groqChat(env, [
    { role: 'system', content: 'Answer with one JSON object only, in exactly this shape: ' + MINUTES_SHAPE },
    { role: 'user', content: buildPrompt(p) },
  ], { temperature: 0.3, response_format: { type: 'json_object' } }, 'text');
  return sseOf(r.text, r.model);
}
