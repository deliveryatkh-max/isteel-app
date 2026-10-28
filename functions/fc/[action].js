// Fuel app AI relay on Cloudflare's free Workers AI (Pages Function, served at /fc/read, /fc/transcribe and /fc/ping).
// Used by the Fuel Apps Script when Kim's Google account could not use Gemini (19 Oct 2026):
//   /fc/read        reads the number on one odometer, hour meter or fuel pump photo, and says if it is the wrong photo
//   /fc/transcribe  turns a short Khmer voice note into text
// Only the Fuel Apps Script calls it, with the shared password in the X-FC-Key header.
//
// Cloudflare Pages > isteel-app > Settings:
//   Bindings > Add > Workers AI, variable name AI
//   Variables and Secrets > FC_SECRET (Secret) = the password the Apps Script function fcSetup() shows
//   FC_MODEL (optional) = a Workers AI vision model to try first, e.g. @cf/meta/llama-4-scout-17b-16e-instruct

const VISION_MODELS = [
  '@cf/meta/llama-4-scout-17b-16e-instruct',
  '@cf/google/gemma-3-12b-it',
  '@cf/meta/llama-3.2-11b-vision-instruct',
];
const WHISPER = '@cf/openai/whisper-large-v3-turbo';
let lastGood = '';   // the model that answered last time is tried first (kept while this Cloudflare worker stays warm)

export async function onRequest({ request, env, params }) {
  const action = String(params.action || '');
  try {
    if (action === 'ping') return json({ ok: true, ai: !!env.AI, secret: !!env.FC_SECRET });
    if (request.method !== 'POST') return json({ ok: false, error: 'BAD: Use POST' }, 405);
    if (!env.AI || !env.FC_SECRET) return json({ ok: false, error: 'SETUP: the Workers AI binding (AI) or FC_SECRET is missing in Cloudflare.' }, 500);
    if ((request.headers.get('X-FC-Key') || '') !== env.FC_SECRET) return json({ ok: false, error: 'AUTH: wrong FC_SECRET' }, 401);
    const body = await request.json();
    if (action === 'read') return json(await readPhoto(env, body));
    if (action === 'transcribe') return json(await transcribe(env, body));
    return json({ ok: false, error: 'BAD: Unknown action' }, 404);
  } catch (e) {
    return json({ ok: false, error: 'AI: ' + String(e && e.message || e).slice(0, 400) }, 502);
  }
}

const json = (o, status) => new Response(JSON.stringify(o), { status: status || 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

const WHAT = {
  km: ['a vehicle odometer', 'the total distance in whole km (ignore the trip meter and the last tenths digit)'],
  hour: ['a machine hour meter', 'the hours, with the decimal if shown'],
  litres: ['a fuel pump or fuel meter display', 'the litres of this refill from the main display (often marked LITRE or L); ignore the small running TOTAL counter, the price and any money amount'],
};

export function readPrompt(kind) {
  const [thing, value] = WHAT[kind] || WHAT.km;
  return 'This photo should show ' + thing + ', taken at a fuel refill at a steel company in Cambodia. ' +
    'A dark blue strip at the bottom with an ID and a date is a watermark: ignore it. ' +
    'First decide if the photo really shows ' + thing + '. A fuel pump instead of an odometer, an odometer instead of a pump, ' +
    'a person, a truck, paper, a phone screen or anything else is the wrong photo. ' +
    'If it is right, read ' + value + '. On rolling number wheels a digit between two numbers counts as the lower one. ' +
    'Never guess: use null when the number is blurred, cut off or hidden. ' +
    'Answer with JSON only, no other text: {"right": true or false, "value": number or null, "note": "short reason when value is null"}';
}

/** Pulls the first {...} out of a model answer and reads it. */
export function parseAnswer(text) {
  const m = String(text || '').match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const o = JSON.parse(m[0]);
    const num = v => (v === null || v === undefined || v === '' || isNaN(Number(String(v).replace(/,/g, '')))) ? null : Number(String(v).replace(/,/g, ''));
    const right = o.right === false || o.right === 'false' ? false : o.right === true || o.right === 'true' ? true : null;
    return { right, value: right === false ? null : num(o.value), note: String(o.note || '').slice(0, 300) };
  } catch (e) { return null; }
}

const textOf = r => typeof r === 'string' ? r : r && (typeof r.response === 'string' ? r.response : r.response ? JSON.stringify(r.response)
  : r.choices && r.choices[0] && r.choices[0].message ? r.choices[0].message.content : '');

async function readPhoto(env, p) {
  const kind = WHAT[p.kind] ? p.kind : 'km';
  const image = String(p.image || '');
  if (!/^data:image\/(jpeg|png);base64,/.test(image)) return { ok: false, error: 'BAD: image must be a data URL' };
  const prompt = readPrompt(kind);
  const models = [env.FC_MODEL, lastGood].concat(VISION_MODELS).filter((m, i, a) => m && a.indexOf(m) === i);
  const tried = [];
  for (const model of models) {
    try {
      const out = await runVision(env, model, prompt, image);
      const got = parseAnswer(textOf(out));
      if (got) { lastGood = model; return { ok: true, model, right: got.right, value: got.value, note: got.note }; }
      tried.push(model + ': no JSON in answer: ' + String(textOf(out)).slice(0, 120));
    } catch (e) {
      tried.push(model + ': ' + String(e && e.message || e).slice(0, 160));
    }
  }
  return { ok: false, error: 'AI: no model could read the photo. ' + tried.join(' | ') };
}

/** Vision models on Workers AI take the photo either inside the message (image_url) or as a separate image field. */
async function runVision(env, model, prompt, dataUrl) {
  const asMessage = { messages: [{ role: 'user', content: [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: dataUrl } }] }], max_tokens: 200, temperature: 0 };
  if (model.indexOf('llama-3.2-11b-vision') < 0) return env.AI.run(model, asMessage);
  const bytes = Uint8Array.from(atob(dataUrl.split(',')[1]), c => c.charCodeAt(0));
  const asField = { messages: [{ role: 'user', content: prompt }], image: Array.from(bytes), max_tokens: 200, temperature: 0 };
  try { return await env.AI.run(model, asField); }
  catch (e) {
    // Meta's licence for this model has to be accepted once per account by sending "agree".
    if (!/agree/i.test(String(e && e.message || e))) throw e;
    await env.AI.run(model, { prompt: 'agree' });
    return env.AI.run(model, asField);
  }
}

async function transcribe(env, p) {
  const m = /^data:audio\/[\w.+-]+(?:;[^,]*)?;base64,(.+)$/.exec(String(p.audio || ''));
  if (!m) return { ok: false, error: 'BAD: audio must be a data URL' };
  const out = await env.AI.run(WHISPER, { audio: m[1], language: 'km', task: 'transcribe', vad_filter: true,
    initial_prompt: 'កំណត់ចំណាំអំពីការចាក់សាំងឡាន។' });
  return { ok: true, model: WHISPER, text: String(out && out.text || '').trim().slice(0, 1000) };
}
