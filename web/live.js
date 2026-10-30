// Background refresh shared by the iSteel apps (Kim, 30 Oct 2026): screens pick up new data on their own,
// without the user pressing Refresh, and never while the user is typing.
// Usage: LIVE.start({ run: () => promise, every: 60000, busy: () => bool })
//        LIVE.keep(() => redraw())   redraws without jumping the page back to the top
// A check runs only when the page is on screen, online, and someone touched the phone in the last
// 15 minutes, so an idle phone left open does not use up the Apps Script quota.
(function () {
  'use strict';
  const IDLE_MS = 15 * 60 * 1000;
  let lastUse = Date.now();
  ['pointerdown', 'keydown', 'scroll', 'touchstart', 'wheel'].forEach(ev =>
    window.addEventListener(ev, () => { lastUse = Date.now(); }, { passive: true, capture: true }));

  const TYPING = /^(text|search|email|tel|number|url|password|date|time|datetime-local|month|week)$/;
  /** True while the user is in a text box, or has typed or ticked something on screen that is not saved yet. */
  function typing() {
    const a = document.activeElement;
    if (a && (a.isContentEditable || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT' || (a.tagName === 'INPUT' && TYPING.test(a.type)))) return true;
    if (document.querySelector('dialog[open], .arq-bg, [data-live-hold]')) return true;
    const els = document.querySelectorAll('input, textarea, select');
    for (let i = 0; i < els.length; i++) {
      const el = els[i];
      // list search boxes keep their text in the app and are drawn again with it
      if (el.hasAttribute('data-live-ok') || el.disabled || /^(hidden|file|search)$/.test(el.type)) continue;
      if (el.tagName === 'SELECT') {
        if (el.multiple || !el.options.length) continue;
        let d = 0;
        for (let k = 0; k < el.options.length; k++) if (el.options[k].defaultSelected) { d = k; break; }
        if (el.selectedIndex !== d) return true;
      }
      else if (el.type === 'checkbox' || el.type === 'radio') { if (el.checked !== el.defaultChecked) return true; }
      else if (el.value !== el.defaultValue) return true;
    }
    return false;
  }

  /** Runs a redraw (which may return a promise) and puts the page (and a scrolling <main>) back where the user was. */
  function keep(fn) {
    const y = window.scrollY, m = document.querySelector('main'), my = m ? m.scrollTop : 0;
    const put = () => {
      if (window.scrollY !== y) window.scrollTo(0, y);
      const m2 = document.querySelector('main');
      if (m2 && m2.scrollTop !== my) m2.scrollTop = my;
    };
    const out = fn();
    put();
    if (out && typeof out.then === 'function') return out.then(v => { put(); return v; });
    return out;
  }

  function start(o) {
    const every = o.every || 60000;
    let last = Date.now(), wait = every, running = false;
    const ready = () => document.visibilityState === 'visible' && navigator.onLine !== false && !running
      && !typing() && !(o.busy && o.busy());
    async function tick(force) {
      if (!ready()) return;
      if (!force && (Date.now() - last < wait || Date.now() - lastUse > IDLE_MS)) return;
      running = true; last = Date.now();
      try { await o.run(); wait = every; }
      catch (e) { wait = Math.min(wait * 2, 5 * 60 * 1000); }   // server trouble: check less often
      finally { running = false; }
    }
    setInterval(() => tick(false), 5000);
    // Back on screen (or back online) after a while away: check at once.
    const back = () => { if (document.visibilityState === 'visible' && Date.now() - last > 20000) { lastUse = Date.now(); tick(true); } };
    document.addEventListener('visibilitychange', back);
    window.addEventListener('online', back);
    return { now: () => tick(true) };
  }

  window.LIVE = { start, keep, typing };
})();
