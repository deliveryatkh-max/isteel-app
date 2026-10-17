import React, { useEffect, useRef, useState } from 'react';
import { L, t, useLang } from '../i18n';
import type { EventDef } from '../types';

/** Emoji and colour of each journey step: Security navy, Logistics blue, Warehouse amber, Delivery green, Cancel/Fail red. */
export const STEP_LOOK: Record<number, { icon: string; color: string }> = {
  1: { icon: '🚦', color: '#0b76a0' }, 2: { icon: '📋', color: '#6d4bd1' }, 3: { icon: '📤', color: '#6d4bd1' },
  4: { icon: '🏭', color: '#c77700' }, 5: { icon: '🏗️', color: '#c77700' }, 6: { icon: '✅', color: '#c77700' },
  7: { icon: '🚪', color: '#0b76a0' }, 8: { icon: '📍', color: '#1e8a4c' }, 9: { icon: '📦', color: '#1e8a4c' },
  10: { icon: '🚫', color: '#c0392b' }, 11: { icon: '⚠️', color: '#c0392b' },
};
const look = (code: number) => STEP_LOOK[code] || { icon: '•', color: '#0b76a0' };

/** Step chooser as a dropdown: the chosen step big and coloured, the list opens under it. */
export function StepSelect(p: { events: EventDef[]; value: number; onChange: (code: number) => void; suggested?: number }) {
  useLang();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const off = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', off);
    return () => document.removeEventListener('mousedown', off);
  }, [open]);
  const cur = p.events.find(e => e.code === p.value);
  const lk = look(p.value);
  return (
    <div ref={box} className="relative">
      <button type="button" id="step" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-3 rounded-2xl border-2 px-3 py-2.5 text-left cursor-pointer bg-card"
        style={{ borderColor: lk.color, boxShadow: '0 0 0 3px ' + lk.color + '22' }}>
        <span className="w-11 h-11 rounded-xl flex items-center justify-center text-[24px] flex-none" style={{ background: lk.color + '22' }}>{lk.icon}</span>
        <span className="flex-1 min-w-0">
          <b className="block text-[17px] leading-snug" style={{ color: lk.color }}>{cur ? L(cur) : t('ជ្រើសជំហាន', 'Choose the step')}</b>
          <small className="muted">{t('ចុចដើម្បីប្តូរជំហាន', 'Tap to change the step')}</small>
        </span>
        <span className={'text-[20px] muted transition-transform ' + (open ? 'rotate-180' : '')}>▾</span>
      </button>
      {open ? (
        <ul role="listbox" className="absolute z-30 left-0 right-0 mt-1.5 bg-card border border-line rounded-2xl p-1.5 m-0 list-none shadow-xl max-h-[60vh] overflow-auto">
          {p.events.map(e => {
            const l = look(e.code), on = e.code === p.value;
            return (
              <li key={e.code} role="option" aria-selected={on}>
                <button type="button" onClick={() => { p.onChange(e.code); setOpen(false); }}
                  className={'w-full flex items-center gap-3 rounded-xl px-2.5 py-2 text-left border-0 cursor-pointer ' + (on ? 'font-bold' : 'bg-transparent')}
                  style={on ? { background: l.color + '1f' } : undefined}>
                  <span className="w-9 h-9 rounded-lg flex items-center justify-center text-[19px] flex-none" style={{ background: l.color + '1a' }}>{l.icon}</span>
                  <span className="flex-1 text-[15px]" style={{ color: on ? l.color : undefined }}>{L(e)}</span>
                  {p.suggested === e.code && !on ? <span className="text-[11.5px] font-bold rounded-full px-2 py-0.5 bg-oksoft text-ok whitespace-nowrap">{t('ជំហានបន្ទាប់', 'Next step')}</span> : null}
                  {on ? <span style={{ color: l.color }}>✔</span> : null}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

/** A form section: coloured icon, bold title. */
export function Section(p: { icon: string; title: string; color?: string; children: React.ReactNode }) {
  const c = p.color || '#0b76a0';
  return (
    // No overflow-hidden: the step list drops out of the card (it was cut off and looked like nothing opened, 17 Oct 2026).
    <section className="card !p-0">
      <div className="flex items-center gap-2.5 px-4 py-2.5 border-b border-line rounded-t-2xl" style={{ background: c + '14' }}>
        <span className="w-8 h-8 rounded-lg flex items-center justify-center text-[17px]" style={{ background: c + '26' }}>{p.icon}</span>
        <b className="text-[15.5px]" style={{ color: c }}>{p.title}</b>
      </div>
      <div className="p-4 grid gap-4">{p.children}</div>
    </section>
  );
}

/** One field: emoji + bold label, red * when required, red outline and message when missing. */
export function Field(p: { icon: string; label: string; required?: boolean; optional?: boolean; error?: string; htmlFor?: string; children: React.ReactNode; id?: string }) {
  useLang();
  return (
    <div id={p.id} className={'rounded-xl transition-shadow ' + (p.error ? 'ring-2 ring-bad ring-offset-4 ring-offset-[var(--card)]' : '')} data-missing={p.error ? '1' : undefined}>
      <label className="flex items-center gap-1.5 font-bold text-[14.5px] mb-1.5" htmlFor={p.htmlFor}>
        <span className="text-[16px]">{p.icon}</span>{p.label}
        {p.required ? <span className="text-bad text-[16px] leading-none">*</span> : null}
        {p.optional ? <span className="muted font-normal text-[12.5px]">({t('មិនចាំបាច់', 'optional')})</span> : null}
      </label>
      {p.children}
      {p.error ? <div className="text-bad text-[13px] font-semibold mt-1">⚠️ {p.error}</div> : null}
    </div>
  );
}

/** Scrolls to the first field marked missing. */
export function scrollToMissing() {
  requestAnimationFrame(() => { const el = document.querySelector('[data-missing="1"]'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' }); });
}
