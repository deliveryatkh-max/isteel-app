// Pastes the repo's Apps Script code into each project and deploys a New version on the same /exec URL,
// so nobody has to copy Code.gs / Inbound.gs by hand after a merge (Kim, 3 Nov 2026).
// Usage: node .github/scripts/gas-deploy.js <before-sha|all> [folder]   (needs ~/.clasprc.json from `clasp login`)
// For each project: pull what is there now, lay the repo's top-level .gs files and appsscript.json over it
// (files only in the editor are kept), push, then `clasp deploy -i <deploymentId>`.
'use strict';
const fs = require('fs'), path = require('path'), os = require('os');
const { execSync } = require('child_process');
const root = path.resolve(__dirname, '..', '..');
const map = JSON.parse(fs.readFileSync(path.join(root, '.github', 'apps-script-map.json'), 'utf8'));
const [since = 'all', only = ''] = process.argv.slice(2);
const sha = (process.env.GITHUB_SHA || 'local').slice(0, 7);
const sh = (cmd, cwd) => execSync(cmd, { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString();

let changed = null;
if (since !== 'all' && !/^0+$/.test(since)) {
  try { changed = sh('git diff --name-only ' + since + ' HEAD', root).split('\n').filter(Boolean); } catch (e) { changed = null; }
}
const folders = Object.keys(map).filter(k => !k.startsWith('_'))
  .filter(k => !only || k === only)
  .filter(k => !changed || changed.some(f => f.startsWith(k + '/') && /\.(gs|json)$/.test(f) && !f.includes('/tests/')));

let failed = 0;
for (const dir of folders) {
  const m = map[dir];
  if (!m.scriptId || !m.deploymentId) { console.log('⏭  ' + dir + ': no scriptId yet, skipped'); continue; }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gas-'));
  try {
    fs.writeFileSync(path.join(tmp, '.clasp.json'), JSON.stringify({ scriptId: m.scriptId, rootDir: '.', fileExtension: 'gs' }));
    sh('clasp pull', tmp);
    const src = path.join(root, dir);
    fs.readdirSync(src).filter(f => /\.gs$/.test(f) || f === 'appsscript.json').forEach(f => fs.copyFileSync(path.join(src, f), path.join(tmp, f)));
    sh('clasp push --force', tmp);
    const out = sh('clasp deploy --deploymentId ' + m.deploymentId + ' --description "auto ' + sha + '"', tmp);
    console.log('✅ ' + dir + ' (' + m.name + '): ' + out.trim().split('\n').pop());
  } catch (e) {
    failed++;
    console.log('❌ ' + dir + ' (' + m.name + '): ' + String((e.stderr || '') + (e.stdout || '') || e.message).trim());
  }
}
if (!folders.length) console.log('No Apps Script folder changed.');
process.exit(failed ? 1 : 0);
