import { useEffect, useRef, useState } from 'react';
import { t, useLang } from '../i18n';
import { Modal } from './ui';

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
export function ScanView(p: { onCode: (code: string) => void; tall?: boolean }) {
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
    <div>
      {err ? <p className="text-bad font-semibold">{err}</p> : null}
      <div className={'relative rounded-2xl overflow-hidden bg-black ' + (p.tall ? 'h-[58vh] max-h-[520px]' : 'aspect-[4/3]')}>
        <video ref={video} className="w-full h-full object-cover" muted playsInline />
        <div className="absolute inset-x-[9%] top-[32%] bottom-[32%] border-[2.5px] border-white rounded-xl" style={{ boxShadow: '0 0 0 999px rgba(0,0,0,.35)' }} />
        <div className="absolute inset-x-[12%] top-1/2 h-0.5 bg-red-500 shadow-[0_0_8px_#ef4444]" />
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
    <Modal title={t('ស្កេនបាកូដ DN', 'Scan DN barcode')} onClose={p.onClose}>
      <ScanView onCode={p.onCode} />
      <p className="muted text-sm mt-2">{t('ដាក់បាកូដលើ Delivery Note ឲ្យនៅក្នុងប្រអប់។', 'Hold the Delivery Note barcode inside the box.')}</p>
    </Modal>
  );
}
