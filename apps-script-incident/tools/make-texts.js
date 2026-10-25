// Lists every Khmer / English text of the Incident app for the Texts tab of the sheet.
// Run after changing the app's words: node apps-script-incident/tools/make-texts.js  (writes web/incident/texts.js)
'use strict';
const fs = require('fs');
const path = require('path');

const WEB = path.join(__dirname, '..', '..', 'web', 'incident');
const KM = /[ក-៿]/;
const Q = "'((?:[^'\\\\\\n]|\\\\.)*)'";
const unq = s => s.replace(/\\(.)/g, '$1');

function collect() {
  const out = [], seen = new Set();
  const add = (km, en, where) => {
    km = unq(km).trim(); en = unq(en).trim();
    if (!km || !en || !KM.test(km) || KM.test(en) || seen.has(en)) return;
    seen.add(en);
    out.push([en, where, km, en]);
  };
  const html = fs.readFileSync(path.join(WEB, 'index.html'), 'utf8');
  for (const m of html.matchAll(/data-km="([^"]*)" data-en="([^"]*)"/g)) add(m[1], m[2], 'header / tabs');
  const js = fs.readFileSync(path.join(WEB, 'ir.js'), 'utf8').split('// ---------------------------------------------------------------- demo')[0];
  const pair = new RegExp('(?:km:\\s*)?' + Q + ',\\s*(?:en:\\s*)?' + Q, 'g');
  let where = 'general';
  js.split('\n').forEach(line => {
    const h = line.match(/^\s*\/\/ -{10,} (.+)$/);
    if (h) { where = h[1].replace(/\s*\(.*\)$/, '').replace('words in both languages', 'choices'); return; }
    for (const m of line.matchAll(pair)) add(m[1], m[2], where);
  });
  return out;
}

function source(rows) {
  return '// Made by apps-script-incident/tools/make-texts.js: every text of the app as [key, screen, Khmer, English].\n' +
    '// The app adds missing rows to the Texts tab of the sheet; edits there change the words on every phone.\n' +
    'window.IR_TEXTS = [\n' + rows.map(r => '  ' + JSON.stringify(r) + ',').join('\n') + '\n];\n';
}

if (require.main === module) {
  const rows = collect();
  fs.writeFileSync(path.join(WEB, 'texts.js'), source(rows));
  console.log('texts.js: ' + rows.length + ' texts');
}
module.exports = { collect, source };
