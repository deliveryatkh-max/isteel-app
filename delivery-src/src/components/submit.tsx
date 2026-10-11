import { useState } from 'react';
import { api, ApiError, newRef, outbox } from '../api';
import { errText, L, t } from '../i18n';
import type { Warning } from '../types';
import { Alert, Modal } from './ui';

/** Phone location for the LatLong column. Never holds the user up: gives up after 4 s. */
export function getLatLong(): Promise<string> {
  return new Promise(res => {
    if (!navigator.geolocation) return res('');
    const timer = setTimeout(() => res(''), 4000);
    navigator.geolocation.getCurrentPosition(
      p => { clearTimeout(timer); res(p.coords.latitude.toFixed(6) + ',' + p.coords.longitude.toFixed(6)); },
      () => { clearTimeout(timer); res(''); },
      { enableHighAccuracy: true, timeout: 3800, maximumAge: 60000 },
    );
  });
}

export type SendResult = { ok: true; data: any } | { ok: false; queued?: boolean };

/**
 * Sends one journey step. Warnings come back for the user to confirm (never confirmed for them);
 * with no signal the step is kept on the phone and sent later with the time it was really recorded.
 */
export function useSubmit(action: 'record' | 'drvRecord') {
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [ask, setAsk] = useState<{ warnings: Warning[]; resolve: (ok: boolean) => void } | null>(null);

  async function send(payload: any, label: string): Promise<SendResult> {
    if (sending) return { ok: false };
    setSending(true); setError('');
    const body = Object.assign({ ref: newRef(), takenAt: Date.now(), confirm: [] as string[] }, payload);
    try {
      if (!body.latlong) body.latlong = await getLatLong();
      for (;;) {
        const res = await api(action, body, { noAuth: action === 'drvRecord' });
        if (res && res.needConfirm) {
          const yes = await new Promise<boolean>(resolve => setAsk({ warnings: res.needConfirm, resolve }));
          setAsk(null);
          if (!yes) return { ok: false };
          body.confirm = Array.from(new Set(body.confirm.concat(res.needConfirm.map((w: Warning) => w.code))));
          continue;
        }
        return { ok: true, data: res };
      }
    } catch (e: any) {
      if (e instanceof ApiError && e.code === 'NET') {
        outbox.add({ ref: body.ref, action, payload: body, label, at: Date.now() });
        return { ok: false, queued: true };
      }
      setError(errText(e.message));
      return { ok: false };
    } finally {
      setSending(false);
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
