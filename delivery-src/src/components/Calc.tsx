// 🧮 calculator for number boxes (Kim, 24 Nov 2026): same keys and rules as the Stock Count keypad.
// + − × ÷ with normal order (× ÷ before + −), a key click sound, and "Put in the box" writes the result.
import { useState } from 'react';
import { t } from '../i18n';
import { Modal } from './ui';

const OPS = '+−×÷';
const isOp = (c: string) => OPS.indexOf(c) >= 0;
const KEYS = ['7', '8', '9', '÷', '4', '5', '6', '×', '1', '2', '3', '−', '.', '0', '⌫', '+', 'C', '='];
const round3 = (n: number) => Math.round(n * 1000) / 1000;
const fmt = (v: string) => (v === '' ? '0' : Number(v).toLocaleString('en-US', { maximumFractionDigits: 3 }));

export function calcEval(e: string): string {
  const tk = String(e || '').split(/([+−×÷])/).filter(x => x !== '');
  while (tk.length && (isOp(tk[tk.length - 1]) || tk[tk.length - 1] === '.')) tk.pop();
  if (!tk.length) return '';
  const terms: number[] = [], sg = [1];
  let cur = Number(tk[0]);
  for (let i = 1; i < tk.length; i += 2) {
    const op = tk[i], n = Number(tk[i + 1]);
    if (op === '×') cur *= n; else if (op === '÷') cur = n ? cur / n : NaN;
    else { terms.push(cur); sg.push(op === '−' ? -1 : 1); cur = n; }
  }
  terms.push(cur);
  const r = terms.reduce((a, x, i) => a + sg[i] * x, 0);
  return isFinite(r) ? String(round3(r)) : '';
}

export function calcPress(e: string, key: string): string {
  const last = e.split(/[+−×÷]/).pop() || '', end = e.slice(-1);
  if (key === '⌫') return e.slice(0, -1);
  if (key === 'C') return '';
  if (key === '=') return calcEval(e);
  if (isOp(key)) return !e || end === '.' ? e : isOp(end) ? e.slice(0, -1) + key : e + key;
  if (key === '.') return last.indexOf('.') >= 0 ? e : e + (last ? '.' : '0.');
  if (last.replace('.', '').length >= 9) return e;
  return last === '0' ? e.slice(0, -1) + key : e + key;
}

let audio: AudioContext | null = null;
/** Short beep + tiny vibration on each key, like Stock Count. */
export function keyClick() {
  try {
    const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
    audio = audio || new AC();
    if (audio!.state === 'suspended') audio!.resume();
    const o = audio!.createOscillator(), g = audio!.createGain(), now = audio!.currentTime;
    o.type = 'square'; o.frequency.value = 1200;
    g.gain.setValueAtTime(0.08, now); g.gain.exponentialRampToValueAtTime(0.0001, now + 0.05);
    o.connect(g); g.connect(audio!.destination); o.start(now); o.stop(now + 0.06);
  } catch (e) { /* no sound on this phone */ }
  try { if (navigator.vibrate) navigator.vibrate(10); } catch (e) { /* none */ }
}

/** The 🧮 button beside a number box. */
export function CalcButton(p: { value: string; onChange: (v: string) => void; title: string; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [ex, setEx] = useState('');
  const result = calcEval(ex);
  const press = (k: string) => { keyClick(); setEx(e => calcPress(e, k)); };
  return (
    <>
      <button type="button" className="calcb" disabled={p.disabled} aria-label={t('ម៉ាស៊ីនគិតលេខ', 'Calculator')}
        onClick={() => { keyClick(); setEx(p.value && Number(p.value) ? String(Number(p.value)) : ''); setOpen(true); }}>🧮</button>
      {open ? (
        <Modal title={'🧮 ' + p.title} onClose={() => setOpen(false)}>
          <div className="calc-disp" data-calc>
            <small>{/[+−×÷]/.test(ex) ? ex.replace(/([+−×÷])/g, ' $1 ') : ' '}</small>
            <b>{fmt(result)}</b>
          </div>
          <div className="calc-keys">
            {KEYS.map(k => <button key={k} type="button" className={k === '=' ? 'eq' : isOp(k) ? 'op' : k === 'C' ? 'clr' : ''} onClick={() => press(k)}>{k}</button>)}
          </div>
          <button type="button" className="btn-primary w-full mt-3" disabled={result === ''} onClick={() => { keyClick(); p.onChange(result); setOpen(false); }}>
            ✓ {t('ដាក់ក្នុងប្រអប់', 'Put in the box')}
          </button>
        </Modal>
      ) : null}
    </>
  );
}
