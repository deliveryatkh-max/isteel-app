import { useState } from 'react';
import { api, ApiError, flushOutbox, newRef, outbox, type OutItem } from '../api';
import { errText, L, t } from '../i18n';
import type { Warning } from '../types';
import { Alert, Modal, watermark } from './ui';

/**
 * Phone location for the LatLong column. Asked for as soon as a form opens (warmLocation), so pressing
 * Save never waits for the GPS; gives up after 4 s.
 */
let warm: { at: number; p: Promise<string> } | null = null;
export function warmLocation() {
  if (warm && Date.now() - warm.at < 60000) return warm.p;
  const p = new Promise<string>(res => {
    if (!navigator.geolocation) return res('');
    const timer = setTimeout(() => res(''), 4000);
    navigator.geolocation.getCurrentPosition(
      x => { clearTimeout(timer); res(x.coords.latitude.toFixed(6) + ',' + x.coords.longitude.toFixed(6)); },
      () => { clearTimeout(timer); res(''); },
      { enableHighAccuracy: true, timeout: 3800, maximumAge: 60000 },
    );
  });
  warm = { at: Date.now(), p };
  p.then(v => { if (!v && warm && warm.p === p) warm = null; });   // no fix: ask again next time
  return p;
}
export const getLatLong = warmLocation;

export type SendResult = { ok: true; data: any } | { ok: false; queued?: boolean };

/**
 * Sends one journey step. Warnings come back for the user to confirm (never confirmed for them);
 * with no signal the step is kept on the phone and sent later with the time it was really recorded.
 */
/** Every photo (not the signature) gets the Trip ID and the time it was taken, like the Fuel app. Before the Trip ID exists (Gate In with no signal) the plate is used. */
async function stamp(media: any, id: string, at: number) {
  const out = Object.assign({}, media);
  if (out.photo) out.photo = await watermark(out.photo, id, at);
  if (Array.isArray(out.photos)) out.photos = await Promise.all(out.photos.map((x: string) => watermark(x, id, at)));
  return out;
}
const stampId = (body: any) => String(body.tripId || body.t || body.plate || '');

/** Photos of a saved step: kept in the outbox (so a lost signal never loses them) and sent at once. */
async function sendMedia(action: 'record' | 'drvRecord', body: any, res: any, raw: any, label: string) {
  const drv = action === 'drvRecord';
  const media = await stamp(raw, String(res.tripId || stampId(body)), body.takenAt);
  const item: OutItem = {
    ref: newRef(), action: drv ? 'drvAttach' : 'attach', label: '📷 ' + label, at: Date.now(),
    payload: Object.assign({ tripId: res.tripId, code: body.code, keys: res.keys }, drv ? { t: body.t, k: body.k } : {}, media),
  };
  item.payload.ref = item.ref;
  if (outbox.add(item)) flushOutbox();
  else api(item.action, item.payload, { noAuth: drv }).catch(() => { /* phone full and no signal: the step is saved, its photos are not */ });
}

export function useSubmit(action: 'record' | 'drvRecord') {
  const [busy, setBusy] = useState(0);   // steps on their way (the form is free again at once)
  const sending = busy > 0;
  const [error, setError] = useState('');
  const [ask, setAsk] = useState<{ warnings: Warning[]; resolve: (ok: boolean) => void } | null>(null);

  async function send(payload: any, label: string): Promise<SendResult> {
    setBusy(n => n + 1); setError('');
    const body = Object.assign({ ref: newRef(), takenAt: Date.now(), confirm: [] as string[] }, payload);
    // Fast save: the step goes first without its photos (small, quick); the photos follow in the background.
    const media: any = {};
    ['photo', 'photos', 'signature'].forEach(k => { if (body[k] && (!Array.isArray(body[k]) || body[k].length)) media[k] = body[k]; });
    const hasMedia = Object.keys(media).length > 0;
    try {
      if (!body.latlong) body.latlong = await getLatLong();
      for (;;) {
        const light = hasMedia ? Object.assign({}, body, { photo: undefined, photos: undefined, signature: undefined, later: true }) : body;
        const res = await api(action, light, { noAuth: action === 'drvRecord' });
        if (res && res.needConfirm) {
          const yes = await new Promise<boolean>(resolve => setAsk({ warnings: res.needConfirm, resolve }));
          setAsk(null);
          if (!yes) return { ok: false };
          body.confirm = Array.from(new Set(body.confirm.concat(res.needConfirm.map((w: Warning) => w.code))));
          continue;
        }
        if (hasMedia && res && res.keys && res.keys.length) sendMedia(action, body, res, media, label).catch(() => { /* step saved; photos could not be prepared */ });
        return { ok: true, data: res };
      }
    } catch (e: any) {
      if (e instanceof ApiError && e.code === 'NET') {
        if (hasMedia) Object.assign(body, await stamp(media, stampId(body), body.takenAt).catch(() => ({})));
        outbox.add({ ref: body.ref, action, payload: body, label, at: Date.now() });
        return { ok: false, queued: true };
      }
      setError(errText(e.message));
      return { ok: false };
    } finally {
      setBusy(n => n - 1);
    }
  }

  const dialog = ask ? (
    <Modal title={t('សូមពិនិត្យ', 'Please check')} onClose={() => ask.resolve(false)}>
      {ask.warnings.map((w, i) => <Alert key={i} tone="warn">⚠️ {L({ kh: w.kh, en: w.en })}</Alert>)}
      <p className="text-[14.5px]">{t('តើអ្នកនៅតែចង់កត់ត្រាដែរឬទេ?', 'Do you still want to record it?')}</p>
      <div className="grid grid-cols-2 gap-2">
        <button type="button" className="btn" onClick={() => ask.resolve(false)}>{t('ទេ ត្រលប់', 'No, go back')}</button>
        <button type="button" className="btn-primary" onClick={() => ask.resolve(true)}>{t('បាទ/ចាស កត់ត្រា', 'Yes, record')}</button>
      </div>
    </Modal>
  ) : null;

  return { send, sending, error, setError, dialog };
}
