/**
 * Who sees which menu (Kim, 13 Nov 2026, option C): admins untick menus per person in 👥 Users › Menus.
 * The server keeps a "hide" list per person ("Hidden Menus" in Employee & Approver, e.g. "fuel.report, scale.set"),
 * so a menu added later shows for everyone until it is unticked, and admins always see everything.
 * The home menu (and the Fuel app) save the list in localStorage; every app loads this file with its key:
 *   <script src="../menus.js" data-app="scale"></script>
 * It hides the menu buttons (nav.tabs [data-r] / [data-tab]) and sends a hidden route back to the first menu left.
 */
(function () {
  const KEY = 'isteel_menus_off';
  // One line per app menu: [key, Khmer, English]. Keys are the data-r / data-tab of each app's menu buttons.
  const ALL = {
    fuel: [['new', 'បញ្ចូលថ្មី', 'New'], ['mine', 'របស់ខ្ញុំ', 'My entries'], ['review', 'អ្នកត្រួតពិនិត្យ', 'Reviewer'], ['report', 'របាយការណ៍', 'Report']],
    scale: [['home', 'ថ្លឹង', 'Weigh'], ['list', 'ប័ណ្ណថ្លឹង', 'Tickets'], ['rep', 'របាយការណ៍', 'Report'], ['tat', 'រយៈពេល', 'Turnaround'], ['dnc', 'ពិនិត្យ DN', 'DN check'], ['set', 'ការកំណត់', 'Settings']],
    inbound: [['home', 'ថ្ងៃនេះ', 'Today'], ['log', 'កំណត់ត្រា', 'Log'], ['sum', 'សង្ខេប', 'Summary'], ['plan', 'ផែនការ', 'Plan']],
    dataentry: [['entry', 'បញ្ចូលទិន្នន័យ', 'Data Entry'], ['report', 'របាយការណ៍', 'Report'], ['settings', 'ការកំណត់', 'Settings']],
    overtime: [['new', 'ស្នើថ្មី', 'New request'], ['mine', 'សំណើរបស់ខ្ញុំ', 'My requests']],
    incident: [['home', 'របាយការណ៍', 'Reports'], ['sign', 'ត្រូវចុះហត្ថលេខា', 'To sign'], ['sum', 'សង្ខេប', 'Summary'], ['set', 'ការកំណត់', 'Settings']],
    safety: [['home', 'ត្រួតពិនិត្យ', 'Walk'], ['actions', 'សកម្មភាព', 'Actions'], ['scores', 'ពិន្ទុ', 'Scores'], ['set', 'ការកំណត់', 'Settings']],
    meeting: [['home', 'ប្រជុំ', 'Meetings'], ['tasks', 'កិច្ចការ', 'Tasks'], ['new', 'ផ្ទុកឡើង', 'Upload']],
    stockcount: [['home', 'ការរាប់ស្តុក', 'Stock Count']],
  };
  const get = () => { try { const v = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; } };
  const me = document.currentScript && document.currentScript.dataset.app;
  const route = h => String(h || '').replace(/^.*?#\/?/, '').split(/[/?]/)[0];
  let style = null;

  function apply() {
    if (!me) return;
    const off = get().filter(k => k.indexOf(me + '.') === 0).map(k => k.slice(me.length + 1));
    if (!style) { style = document.createElement('style'); style.id = 'menusOff'; document.head.appendChild(style); }
    // CSS, so the app's own show/hide of a menu (admin-only tabs) can never bring a hidden one back.
    style.textContent = off.map(k => `nav.tabs [data-r="${k}"],nav.tabs [data-tab="${k}"]`).join(',') + (off.length ? '{display:none!important}' : '');
    guard();
  }
  /** A hidden page in an app with #/ routes goes to the first menu still shown (or back to the home menu). */
  function guard() {
    if (!me) return;
    const links = Array.from(document.querySelectorAll('nav.tabs a[data-r]'));
    if (!links.length) return;
    const off = get(), isOff = a => off.indexOf(me + '.' + a.dataset.r) >= 0;
    const r = route(location.hash);
    const hit = links.find(a => isOff(a) && (route(a.getAttribute('href')) === r || (!r && a.dataset.r === 'home')));
    if (!hit) return;
    const ok = links.find(a => !isOff(a));
    if (ok) location.replace(ok.getAttribute('href')); else location.href = '../';
  }

  window.MENUS = {
    all: ALL,
    off: get,
    isOff: (app, k) => get().indexOf(app + '.' + k) >= 0,
    /** Saves the list from the server (home menu, Fuel config) and applies it at once. */
    set(list) {
      if (!Array.isArray(list)) return;
      try { localStorage.setItem(KEY, JSON.stringify(list)); } catch (e) { /* private window */ }
      apply();
    },
  };
  apply();
  window.addEventListener('hashchange', guard);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', guard); else guard();
})();
