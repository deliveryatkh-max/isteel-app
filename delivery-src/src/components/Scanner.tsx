import { useEffect, useRef, useState } from 'react';
import { t, useLang } from '../i18n';

/** Short beep and buzz when a barcode is read. */
export function beep() {
  try { if (navigator.vibrate) navigator.vibrate(80); } catch { /* not allowed */ }
  try {
    const A = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!A) return;
    const ctx = new A(), o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.value = 1900; g.gain.value = 0.15;
    o.connect(g); g.connect(ctx.destination); o.start(); o.stop(ctx.currentTime + 0.12);
    o.onended = () => ctx.close();
  } catch { /* no sound */ }
}

/**
 * Camera that reads the barcode printed on the Delivery Note.
 * Uses the phone's own barcode reader when it has one (Android Chrome), otherwise ZXing (loaded only when needed).
 */
export function ScanView(p: { onCode: (code: string) => void; tall?: boolean; full?: boolean }) {
  useLang();
  const video = useRef<HTMLVideoElement>(null);
  const [err, setErr] = useState('');
  const torchRef = useRef<((on: boolean) => Promise<void>) | null>(null);
  const [torch, setTorch] = useState<boolean | null>(null);   // null = this phone has no torch control
  useEffect(() => {
    let stop = false;
    let stream: MediaStream | null = null;
    let controls: { stop: () => void; switchTorch?: (on: boolean) => Promise<void> } | null = null;
    const done = (code: string) => {
      if (stop) return;
      stop = true;
      beep();
      p.onCode(code.trim());
    };
    const findTorch = (track?: MediaStreamTrack) => {
      try {
        const caps: any = track && track.getCapabilities ? track.getCapabilities() : {};
        if (track && caps.torch) { torchRef.current = on => track.applyConstraints({ advanced: [{ torch: on } as any] }); setTorch(false); }
      } catch { /* no torch */ }
    };
    (async () => {
      try {
        const BD = (window as any).BarcodeDetector;
        if (BD) {
          stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
          if (stop || !video.current) { stream.getTracks().forEach(tr => tr.stop()); return; }
          video.current.srcObject = stream;
          await video.current.play();
          findTorch(stream.getVideoTracks()[0]);
          const det = new BD({ formats: ['code_128', 'code_39', 'ean_13', 'ean_8', 'itf', 'qr_code', 'upc_a', 'codabar'] });
          const tick = async () => {
            if (stop || !video.current) return;
            try {
              const found = await det.detect(video.current);
              if (found && found[0] && found[0].rawValue) return done(found[0].rawValue);
            } catch { /* frame not ready */ }
            setTimeout(tick, 150);
          };
          tick();
        } else {
          const { BrowserMultiFormatReader } = await import('@zxing/browser');
          const reader = new BrowserMultiFormatReader();
          controls = await reader.decodeFromConstraints({ video: { facingMode: 'environment' } }, video.current!, res => { if (res) done(res.getText()); });
          if (stop) { controls.stop(); return; }
          if (controls.switchTorch) { torchRef.current = controls.switchTorch; setTorch(false); }
        }
      } catch {
        setErr(t('មិនអាចបើកកាមេរ៉ាបានទេ។ សូមអនុញ្ញាតកាមេរ៉ា ឬវាយលេខ DN។', 'Could not open the camera. Allow camera access or type the DN.'));
      }
    })();
    return () => {
      stop = true;
      if (controls) controls.stop();
      if (stream) stream.getTracks().forEach(tr => tr.stop());
    };
  }, []);
  const flip = async () => { if (!torchRef.current || torch === null) return; try { await torchRef.current(!torch); setTorch(!torch); } catch { setTorch(null); } };
  return (
    <div className={p.full ? 'h-full flex flex-col' : ''}>
      {err ? <p className="text-bad font-semibold">{err}</p> : null}
      <div className={'relative overflow-hidden bg-black ' + (p.full ? 'flex-1 min-h-0' : 'rounded-2xl ' + (p.tall ? 'h-[58vh] max-h-[520px]' : 'aspect-[4/3]'))}>
        <video ref={video} className="w-full h-full object-cover" muted playsInline />
        <div className={'absolute border-[3px] border-white rounded-xl ' + (p.full ? 'inset-x-[4%] top-[25%] bottom-[25%]' : 'inset-x-[5%] top-[22%] bottom-[22%]')} style={{ boxShadow: '0 0 0 9999px rgba(0,0,0,.35)' }} />
        <div className="absolute inset-x-[7%] top-1/2 h-0.5 bg-red-500 shadow-[0_0_8px_#ef4444]" />
        <div className="absolute top-2.5 inset-x-0 text-center text-white text-[14px] font-semibold drop-shadow">📷 {t('តម្រង់ទៅបាកូដ DN', 'Point at the DN barcode')}</div>
        {torch !== null ? (
          <button type="button" onClick={flip} className="absolute bottom-3 right-3 rounded-xl px-3 py-2 text-white text-[14px] border-0 cursor-pointer" style={{ background: torch ? '#f2a900' : 'rgba(255,255,255,.18)' }}>🔦 {t('ពិល', 'Torch')}</button>
        ) : null}
      </div>
    </div>
  );
}

/** Pop-up scanner (adding DNs on the Arrival-Pickup DN form). */
export function Scanner(p: { onCode: (code: string) => void; onClose: () => void }) {
  useLang();
  return (
    // Full screen (Kim, 27 Nov 2026): the camera fills the phone, with a big box for the barcode.
    <div role="dialog" aria-modal="true" aria-label={t('ស្កេនបាកូដ DN', 'Scan DN barcode')} className="fixed inset-0 z-50 bg-black text-white flex flex-col">
      <div className="flex items-center justify-between gap-2 px-4 py-3" style={{ paddingTop: 'max(12px, env(safe-area-inset-top))' }}>
        <h2 className="m-0 text-[18px] font-bold">{t('ស្កេនបាកូដ DN', 'Scan DN barcode')}</h2>
        <button type="button" className="rounded-xl border-0 px-4 py-2 text-[18px] text-white cursor-pointer" style={{ background: 'rgba(255,255,255,.18)' }} onClick={p.onClose} aria-label={t('បិទ', 'Close')}>✕</button>
      </div>
      <div className="flex-1 min-h-0"><ScanView onCode={p.onCode} full /></div>
      <p className="m-0 text-center text-[14px] px-4 py-3 opacity-85" style={{ paddingBottom: 'max(12px, env(safe-area-inset-bottom))' }}>{t('ដាក់បាកូដលើ Delivery Note ឲ្យនៅក្នុងប្រអប់។', 'Hold the Delivery Note barcode inside the box.')}</p>
    </div>
  );
}
