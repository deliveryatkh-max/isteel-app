// Lists every Khmer / English text of the Incident app for the Texts tab of the sheet, in screen order:
// grouped by screen, step and card (sub-screen), with each list of choices under the field that uses it.
// Run after changing the app's words: node apps-script-incident/tools/make-texts.js  (writes web/incident/texts.js)
'use strict';
const fs = require('fs');
const path = require('path');

const WEB = path.join(__dirname, '..', '..', 'web', 'incident');
const KM = /[ក-៿]/;
const Q = "'((?:[^'\\\\\\n]|\\\\.)*)'";
const PAIR = new RegExp('(?:km:\\s*)?' + Q + ',\\s*(?:en:\\s*)?' + Q, 'g');
const unq = s => s.replace(/\\(.)/g, '$1');
const SCREENS = {
  'list screens': 'Reports list', 'the form': 'New report', 'signature pad': 'New report', 'one report': 'One report',
  summary: 'Summary', settings: 'Settings', start: 'Sign-in / messages', 'Apps Script': 'Sign-in / messages', state: 'Sign-in / messages',
};
const SET_TABS = { mail: 'បញ្ជីអ៊ីមែល', sup: 'ប្រធានឃ្លាំង', cat: 'ប្រភេទរង', more: 'ផ្សេងៗ' };

function collect() {
  const out = [], seen = new Set();
  const add = (km, en, screen, sub, step) => {
    km = unq(km).trim(); en = unq(en).trim();
    if (!km || !en || !KM.test(km) || KM.test(en) || seen.has(en)) return;
    seen.add(en);
    out.push([en, screen, sub || '', step || '', km, en]);
  };
  // Khmer / English pairs in a line; a non-Khmer first string (e.g. field('company', 'ក្រុមហ៊ុន', 'Company')) moves on one string
  const pairs = line => {
    const out = [], re = new RegExp(PAIR.source, 'g');
    let m;
    while ((m = re.exec(line))) {
      if (KM.test(m[1])) out.push({ at: m.index, km: m[1], en: m[2] });
      else re.lastIndex = m.index + m[0].indexOf(',');
    }
    return out;
  };

  const html = fs.readFileSync(path.join(WEB, 'index.html'), 'utf8');
  for (const m of html.matchAll(/data-km="([^"]*)" data-en="([^"]*)"/g)) add(m[1], m[2], 'Header / tabs');

  const js = fs.readFileSync(path.join(WEB, 'ir.js'), 'utf8').split('// ---------------------------------------------------------------- demo')[0];
  const lines = js.split('\n');
  // lists of choices (const NAME = [...] in "words in both languages"), placed where a screen uses them
  const LISTS = {}, order = [];
  let inWords = false, cur = '';
  lines.forEach(line => {
    const h = line.match(/^\s*\/\/ -{10,} (.+)$/);
    if (h) { inWords = h[1] === 'words in both languages'; cur = ''; return; }
    if (!inWords) return;
    const c = line.match(/^\s*const ([A-Z_]+) = /);
    if (c) { cur = c[1]; LISTS[cur] = []; order.push(cur); } else if (/^\s*const /.test(line)) cur = '';
    if (cur) LISTS[cur].push(...pairs(line));
  });
  const used = new Set();
  const USE = new RegExp('\\b(' + order.join('|') + ')\\b(?!\\[)', 'g');

  let section = '', screen = '', step = '', sub = '';
  lines.forEach(line => {
    const h = line.match(/^\s*\/\/ -{10,} (.+)$/);
    if (h) {
      section = h[1].replace(/\s*\(.*\)$/, '');
      screen = SCREENS[section] || '';
      step = section === 'signature pad' ? 'Step 5' : '';
      sub = section === 'signature pad' ? 'ហត្ថលេខា' : '';
      return;
    }
    if (!screen) return;
    if (section === 'the form') {
      const s = line.match(/\bs === (\d)\b/);
      if (s) { step = 'Step ' + s[1]; sub = ''; }
      if (/^\s*\} else \{\s*$/.test(line) && step === 'Step 4') { step = 'Step 5'; sub = ''; }
      if (/const nav = /.test(line)) { step = ''; sub = ''; }
    }
    const tab = line.match(/setTab === '(\w+)'/);
    if (section === 'settings' && tab && /if \(|else if/.test(line)) sub = SET_TABS[tab[1]] || sub;
    if (section === 'settings' && /^\s*\} else \{\s*$/.test(line) && sub === SET_TABS.cat) sub = SET_TABS.more;
    const ps = pairs(line);
    let lineStep = step;
    const n = line.match(/\bn === (\d) &&/);
    if (n && section === 'the form') lineStep = 'Step ' + n[1];
    const warn = !!(n && section === 'the form');
    const h2 = Math.max(line.indexOf('<h2>'), line.indexOf('sec(`'));
    if (h2 >= 0) { const first = ps.find(p => p.at > h2); if (first) sub = unq(first.km).trim(); }
    // a list used on this line goes under the label just before it (e.g. Shift: Day, Night)
    const uses = Array.from(line.matchAll(USE)).map(m => ({ at: m.index, list: m[1] })).filter(u => !used.has(u.list));
    let lineSub = warn ? 'សារព្រមាន' : sub;
    if (uses.length) { const label = ps.filter(p => p.at < uses[0].at).pop(); if (label && h2 < 0) lineSub = unq(label.km).trim(); }
    const items = ps.map(p => Object.assign({ kind: 'pair' }, p)).concat(uses.map(u => Object.assign({ kind: 'list' }, u))).sort((a, b) => a.at - b.at);
    items.forEach(it => {
      if (it.kind === 'pair') add(it.km, it.en, screen, h2 >= 0 && it.at > h2 ? sub : lineSub, lineStep);
      else if (!used.has(it.list)) { used.add(it.list); LISTS[it.list].forEach(p => add(p.km, p.en, screen, lineSub, lineStep)); }
    });
    if (/formhead/.test(line)) sub = '';
    if (section === 'list screens' && /` : `\s*$/.test(line)) sub = 'របាយការណ៍';
  });
  // lists no screen maps (e.g. report status) go last
  order.filter(l => !used.has(l)).forEach(l => LISTS[l].forEach(p => add(p.km, p.en, 'Reports list', l === 'STATUS' ? 'ស្ថានភាព' : '', '')));
  return out;
}

function source(rows) {
  return '// Made by apps-script-incident/tools/make-texts.js: every text of the app as [key, screen, sub-screen, step, Khmer, English].\n' +
    '// The app adds missing rows to the Texts tab of the sheet; edits there change the words on every phone.\n' +
    'window.IR_TEXTS = [\n' + rows.map(r => '  ' + JSON.stringify(r) + ',').join('\n') + '\n];\n';
}

if (require.main === module) {
  const rows = collect();
  fs.writeFileSync(path.join(WEB, 'texts.js'), source(rows));
  console.log('texts.js: ' + rows.length + ' texts');
}
module.exports = { collect, source };
