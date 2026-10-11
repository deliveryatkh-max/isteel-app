import { useEffect, useRef, useState } from 'react';
import { t, useLang } from '../i18n';
import { Modal } from './ui';

/**
 * Reads the barcode printed on the Delivery Note with the phone camera.
 * Uses the phone's own barcode reader when it has one (Android Chrome), otherwise ZXing (loaded only when needed).
 */
export function Scanner(p: { onCode: (code: string) => void; onClose: () => void }) {
  useLang();
  const video = useRef<HTMLVideoElement>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    let stop = false;
    let stream: MediaStream | null = null;
    let controls: { stop: () => void } | null = null;
    const done = (code: string) => {
      if (stop) return;
      stop = true;
      if (navigator.vibrate) navigator.vibrate(60);
      p.onCode(code.trim());
    };
    (async () => {
      try {
        const BD = (window as any).BarcodeDetector;
        if (BD) {
          stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
          if (!video.current) return;
          video.current.srcObject = stream;
          await video.current.play();
          const det = new BD({ formats: ['code_128', 'code_39', 'ean_13', 'ean_8', 'itf', 'qr_code', 'upc_a', 'codabar'] });
          const tick = async () => {
            if (stop || !video.current) return;
            try {
              const found = await det.detect(video.current);
              if (found && found[0] && found[0].rawValue) return done(found[0].rawValue);
            } catch { /* frame not ready */ }
            setTimeout(tick, 180);
          };
          tick();
        } else {
          const { BrowserMultiFormatReader } = await import('@zxing/browser');
          const reader = new BrowserMultiFormatReader();
          controls = await reader.decodeFromConstraints({ video: { facingMode: 'environment' } }, video.current!, res => { if (res) done(res.getText()); });
        }
      } catch (e: any) {
        setErr(t('មិនអាចបើកកាមេរ៉ាបានទេ។ សូមអនុញ្ញាតកាមេរ៉ា ឬវាយលេខ DN។', 'Could not open the camera. Allow camera access or type the DN.'));
      }
    })();
    return () => {
      stop = true;
      if (controls) controls.stop();
      if (stream) stream.getTracks().forEach(tr => tr.stop());
    };
  }, []);
  return (
    <Modal title={t('ស្កេនបាកូដ DN', 'Scan DN barcode')} onClose={p.onClose}>
      {err ? <p className="text-bad font-semibold">{err}</p> : null}
      <div className="relative rounded-xl overflow-hidden bg-black aspect-[4/3]">
        <video ref={video} className="w-full h-full object-cover" muted playsInline />
        <div className="absolute inset-x-6 top-1/2 h-0.5 bg-red-500/80" />
      </div>
      <p className="muted text-sm mt-2">{t('ដាក់បាកូដលើ Delivery Note ឲ្យនៅក្នុងប្រអប់។', 'Hold the Delivery Note barcode inside the box.')}</p>
    </Modal>
  );
}
