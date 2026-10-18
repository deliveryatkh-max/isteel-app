// Meeting Minutes AI relay (Cloudflare Pages Function, served at /mm/upload, /mm/generate and /mm/ping).
// Holds the Gemini API key, so the key never reaches a phone. Only people the Minutes Apps Script let in can use it:
// every call carries a "ticket" the script signed with MM_SECRET (email + expiry), checked here before anything else.
//
// Cloudflare Pages > isteel-app > Settings > Variables and Secrets (type Secret):
//   GEMINI_API_KEY  key from Google AI Studio (aistudio.google.com > Get API key)
//   MM_SECRET       the same value as MM_SECRET in the Minutes Apps Script (made by setup())
//   GEMINI_MODEL    optional, e.g. gemini-2.5-flash; empty = the newest stable "flash" model the key can use

const BASE = 'https://generativelanguage.googleapis.com';
const MAX_UPLOAD = 95 * 1024 * 1024;   // Pages Functions take request bodies up to 100 MB

export async function onRequest({ request, env, params }) {
  const action = String(params.action || '');
  try {
    if (action === 'ping') return json({ ok: true, ai: !!env.GEMINI_API_KEY, ticket: !!env.MM_SECRET });
    if (request.method !== 'POST') return json({ ok: false, error: 'BAD: Use POST' }, 405);
    if (!env.GEMINI_API_KEY || !env.MM_SECRET) return json({ ok: false, error: 'SETUP: GEMINI_API_KEY or MM_SECRET is missing in Cloudflare.' }, 500);
    const who = await checkTicket(request.headers.get('X-MM-Ticket') || '', env.MM_SECRET);
    if (!who) return json({ ok: false, error: 'AUTH: Sign-in expired. Please open the app again.' }, 401);
    if (action === 'upload') return await upload(request, env);
    if (action === 'generate') return await generate(request, env);
    return json({ ok: false, error: 'BAD: Unknown action' }, 404);
  } catch (e) {
    return json({ ok: false, error: 'AI: ' + String(e && e.message || e).slice(0, 400) }, 502);
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
