import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import { errText, t, useLang } from '../i18n';
import { Alert, Segmented, shrinkPhoto, toast } from './ui';
import { Field, Section } from './Form';

export const MAX_PHOTOS = 5;

/** Up to 5 photos (camera or gallery), shrunk on the phone so they send fast. */
export function MultiPhoto(p: { value: string[]; onChange: (v: string[]) => void; label?: string }) {
  useLang();
  const cam = useRef<HTMLInputElement>(null), gal = useRef<HTMLInputElement>(null);
  const add = async (files: FileList | null) => {
    if (!files) return;
    const room = MAX_PHOTOS - p.value.length;
    const out: string[] = [];
    for (const f of Array.from(files).slice(0, room)) out.push(await shrinkPhoto(f, 1024));
    p.onChange(p.value.concat(out));
  };
  return (
    <div>
      {p.label ? <span className="lbl">{p.label}</span> : null}
      <span className="block muted text-[12.5px] mb-1.5">{p.value.length}/{MAX_PHOTOS} {t('រូប', 'photos')}</span>
      {p.value.length ? (
        <div className="flex flex-wrap gap-2 mb-2">
          {p.value.map((src, i) => (
            <div key={i} className="relative">
              <img src={src} alt="" className="w-[68px] h-[68px] object-cover rounded-xl border border-line" />
              <button type="button" className="absolute -top-1.5 -right-1.5 w-6 h-6 rounded-full bg-bad text-white text-xs border-0 cursor-pointer" aria-label={t('លុប', 'Remove')}
                onClick={() => p.onChange(p.value.filter((_, j) => j !== i))}>✕</button>
            </div>
          ))}
        </div>
      ) : null}
      {p.value.length < MAX_PHOTOS ? (
        <div className="flex gap-2">
          <button type="button" className="btn btn-sm" onClick={() => cam.current?.click()}>📷 {t('ថតរូប', 'Take photo')}</button>
          <button type="button" className="btn btn-sm" onClick={() => gal.current?.click()}>🖼️ {t('ពីវិចិត្រសាល', 'From gallery')}</button>
        </div>
      ) : null}
      <input ref={cam} type="file" accept="image/*" capture="environment" hidden onChange={e => { add(e.target.files); e.target.value = ''; }} />
      <input ref={gal} type="file" accept="image/*" multiple hidden onChange={e => { add(e.target.files); e.target.value = ''; }} />
    </div>
  );
}

/** Customer signature with a finger. Sent as a small PNG; empty string = not signed. */
export function SignaturePad(p: { value: string; onChange: (v: string) => void; label?: boolean }) {
  useLang();
  const ref = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const inked = useRef(false);
  useEffect(() => {
    const c = ref.current!;
    const ctx = c.getContext('2d')!;
    ctx.lineWidth = 2.6; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#011e41';
    const pos = (e: PointerEvent) => { const r = c.getBoundingClientRect(); return [(e.clientX - r.left) * (c.width / r.width), (e.clientY - r.top) * (c.height / r.height)]; };
    const down = (e: PointerEvent) => { e.preventDefault(); try { c.setPointerCapture(e.pointerId); } catch { /* not supported */ } drawing.current = true; const [x, y] = pos(e); ctx.beginPath(); ctx.moveTo(x, y); };
    const move = (e: PointerEvent) => { if (!drawing.current) return; const [x, y] = pos(e); ctx.lineTo(x, y); ctx.stroke(); inked.current = true; };
    const up = () => { if (!drawing.current) return; drawing.current = false; if (inked.current) p.onChange(c.toDataURL('image/png')); };
    c.addEventListener('pointerdown', down); c.addEventListener('pointermove', move); c.addEventListener('pointerup', up); c.addEventListener('pointercancel', up);
    return () => { c.removeEventListener('pointerdown', down); c.removeEventListener('pointermove', move); c.removeEventListener('pointerup', up); c.removeEventListener('pointercancel', up); };
  }, []);
  const clear = () => { const c = ref.current!; c.getContext('2d')!.clearRect(0, 0, c.width, c.height); inked.current = false; p.onChange(''); };
  return (
    <div>
      {p.label !== false ? <span className="lbl">{t('ហត្ថលេខាអ្នកទទួល', 'Receiver signature')}</span> : null}
      <canvas ref={ref} width={600} height={200} className="w-full h-[150px] rounded-xl border-[1.5px] border-dashed border-line bg-white touch-none" aria-label={t('ចុះហត្ថលេខានៅទីនេះ', 'Sign here')} />
      <div className="flex justify-between items-center mt-1">
        <span className="muted text-[12.5px]">{p.value ? '✔ ' + t('បានចុះហត្ថលេខា', 'Signed') : t('ចុះហត្ថលេខាដោយម្រាមដៃ', 'Sign with a finger')}</span>
        <button type="button" className="btn btn-sm" onClick={clear}>↺ {t('លុប', 'Clear')}</button>
      </div>
    </div>
  );
}

/** Delivered: receiver name, signature and up to 5 photos, all required (used by Record and the driver page). */
export function ProofFields(p: { receiver: string; setReceiver: (v: string) => void; signature: string; setSignature: (v: string) => void; photos: string[]; setPhotos: (v: string[]) => void; miss?: Record<string, string> }) {
  useLang();
  const m = p.miss || {};
  return (
    <Section icon="✍️" title={t('ភស្តុតាងប្រគល់ទំនិញ', 'Proof of delivery')} color="#1e8a4c">
      <Field icon="🙋" label={t('ឈ្មោះអ្នកទទួល', 'Receiver name')} required htmlFor="rcv" error={m.receiver}>
        <input id="rcv" className={'in ' + (m.receiver ? '!border-bad' : '')} value={p.receiver} onChange={e => p.setReceiver(e.target.value)} placeholder={t('ឈ្មោះអ្នកទទួលទំនិញ', 'Who received the goods')} />
      </Field>
      <Field icon="✍️" label={t('ហត្ថលេខាអ្នកទទួល', 'Receiver signature')} required error={m.signature}>
        <SignaturePad value={p.signature} onChange={p.setSignature} label={false} />
      </Field>
      <Field icon="📷" label={t('រូបថតបុង និងទំនិញ (១–៥)', 'Delivery note and goods photos (1–5)')} required error={m.photos}>
        <MultiPhoto value={p.photos} onChange={p.setPhotos} />
      </Field>
    </Section>
  );
}

// ---------------------------------------------------------------- QR
export function Qr(p: { url: string; size?: number }) {
  const svg = useMemo(() => {
    if (!window.qrcode) return '';
    const q = window.qrcode(0, 'M'); q.addData(p.url); q.make();
    return q.createSvgTag({ cellSize: 5, margin: 2, scalable: true });
  }, [p.url]);
  return svg ? <div className="bg-white rounded-xl p-2 mx-auto" style={{ maxWidth: p.size || 220 }} dangerouslySetInnerHTML={{ __html: svg }} /> : <p className="muted text-sm break-all">{p.url}</p>;
}
async function shareUrl(title: string, url: string) {
  try {
    if (navigator.share) await navigator.share({ title, text: title, url });
    else { await navigator.clipboard.writeText(url); toast(t('បានចម្លងតំណ', 'Link copied')); }
  } catch { /* closed */ }
}

/** Customer rating link of one DN on one trip (no sign-in, no app). */
export const rateUrl = (dn: string, tripId: string, k: string) =>
  location.origin + location.pathname.replace(/[^/]*$/, '') + 'rate.html?d=' + encodeURIComponent(dn) + '&t=' + encodeURIComponent(tripId) + '&k=' + k;

/** "Ask the customer to rate": a QR to show on the phone, or a link to send. */
export function RateLinks(p: { tripId: string; links: Record<string, string>; open?: boolean }) {
  useLang();
  const dns = Object.keys(p.links);
  const [show, setShow] = useState(p.open ? dns[0] || '' : '');
  if (!dns.length) return null;
  return (
    <section className="card">
      <h2 className="text-[15px] font-bold mt-0 mb-1">⭐ {t('ឲ្យអតិថិជនវាយតម្លៃ', 'Customer rating')}</h2>
      <p className="muted text-[13px] mt-0">{t('អតិថិជនស្កេន QR ឬបើកតំណ ហើយផ្តល់ផ្កាយ (មិនចាំបាច់ចូលគណនី)។', 'The customer scans the QR or opens the link and gives stars (no sign-in).')}</p>
      {dns.map(dn => (
        <div key={dn} className="border-t border-line py-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <b>DN {dn}</b>
            <span className="flex gap-2">
              <button type="button" className="btn btn-sm" onClick={() => setShow(show === dn ? '' : dn)}>▦ QR</button>
              <button type="button" className="btn btn-sm" onClick={() => shareUrl(t('វាយតម្លៃការដឹកជញ្ជូន DN ', 'Rate delivery DN ') + dn, rateUrl(dn, p.tripId, p.links[dn]))}>🔗 {t('ផ្ញើតំណ', 'Send link')}</button>
            </span>
          </div>
          {show === dn ? <div className="mt-2"><Qr url={rateUrl(dn, p.tripId, p.links[dn])} /></div> : null}
        </div>
      ))}
    </section>
  );
}

// ---------------------------------------------------------------- driver / 3PL rates the customer site
type Wait = '' | 'short' | 'mid' | 'long';
export function SiteRateForm(p: { dns: string[]; send: (body: any) => Promise<any>; onDone: () => void }) {
  useLang();
  const [wait, setWait] = useState<Wait>('');
  const [help, setHelp] = useState<'' | 'yes' | 'some' | 'no'>('');
  const [access, setAccess] = useState<'' | 'easy' | 'hard' | 'blocked'>('');
  const [custDelay, setCustDelay] = useState(false);
  const [remark, setRemark] = useState('');
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);
  if (!p.dns.length) return null;
  const save = async () => {
    if (!wait && !help && !access) return setErr(t('សូមជ្រើសយ៉ាងហោចណាស់មួយ។', 'Choose at least one answer.'));
    setSaving(true); setErr('');
    try { await p.send({ dns: p.dns, wait, help, access, custDelay, remark: remark.trim() }); toast('✅ ' + t('អរគុណ', 'Thank you')); p.onDone(); }
    catch (e: any) { setErr(errText(e.message)); }
    finally { setSaving(false); }
  };
  return (
    <section className="card grid gap-3">
      <h2 className="text-[15px] font-bold m-0">🏗️ {t('វាយតម្លៃទីតាំងអតិថិជន', 'Rate the customer site')} <span className="muted font-normal text-[13px]">· {p.dns.join(', ')}</span></h2>
      <div><span className="lbl">{t('រង់ចាំទំលាក់', 'Waiting to unload')}</span>
        <Segmented value={wait} onChange={setWait} options={[{ v: 'short', km: '< ៣០ នាទី', en: '< 30 min' }, { v: 'mid', km: '៣០–៦០ នាទី', en: '30–60 min' }, { v: 'long', km: '> ១ ម៉ោង', en: '> 1 hour' }]} /></div>
      <div><span className="lbl">{t('អតិថិជនជួយទំលាក់?', 'Customer helped unload?')}</span>
        <Segmented value={help} onChange={setHelp} options={[{ v: 'yes', km: 'បាទ/ចាស', en: 'Yes' }, { v: 'some', km: 'បន្តិចបន្តួច', en: 'A little' }, { v: 'no', km: 'ទេ', en: 'No' }]} /></div>
      <div><span className="lbl">{t('ផ្លូវចូល', 'Site access')}</span>
        <Segmented value={access} onChange={setAccess} options={[{ v: 'easy', km: 'ងាយ', en: 'Easy' }, { v: 'hard', km: 'ពិបាក', en: 'Hard' }, { v: 'blocked', km: 'បិទ', en: 'Blocked' }]} /></div>
      <label className="flex items-center gap-2 text-[14.5px]"><input type="checkbox" className="w-5 h-5" checked={custDelay} onChange={e => setCustDelay(e.target.checked)} />{t('យឺតដោយសារអតិថិជន', 'Delay caused by the customer')}</label>
      <textarea className="in min-h-[56px]" value={remark} onChange={e => setRemark(e.target.value)} placeholder={t('កំណត់សំគាល់ (មិនចាំបាច់)', 'Remark (optional)')} aria-label={t('កំណត់សំគាល់', 'Remark')} />
      {err ? <Alert tone="bad">{err}</Alert> : null}
      <button type="button" className="btn-primary" disabled={saving} onClick={save}>{saving ? t('កំពុងរក្សាទុក…', 'Saving…') : t('ផ្ញើការវាយតម្លៃ', 'Send rating')}</button>
    </section>
  );
}

/** Signed-in Site rating (Record done screen): goes through the normal sign-in. */
export const siteRateSigned = (tripId: string) => (body: any) => api('siteRate', Object.assign({ tripId }, body));
