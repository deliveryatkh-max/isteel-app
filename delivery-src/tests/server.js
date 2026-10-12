// Local test server: serves web/ and runs the real Delivery.gs + Logic.gs behind /api with the GAS mock and the TEST fixture.
const http = require('http'), fs = require('fs'), path = require('path');
const REPO = require('path').join(__dirname, '..', '..');
const { makeEnv } = require(REPO + '/apps-script-delivery/tests/gas-mock');
const { fixture } = require(REPO + '/apps-script-delivery/tests/fixture');
const PORT = Number(process.env.PORT || 8765);
const env = makeEnv(fixture(), { now: Date.now() });
let skew = 0;
env.run('setup()');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };
http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/api' && req.method === 'POST') {
    let b = ''; req.on('data', c => (b += c)); req.on('end', () => {
      env.setNow(Date.now() + skew);
      // The test moves the server clock forward; the phone's clock moves with it.
      if (skew) { try { const j = JSON.parse(b); if (j.payload && j.payload.takenAt) { j.payload.takenAt += skew; b = JSON.stringify(j); } } catch (e) {} }
      const out = env.ctx.doPost({ postData: { contents: b } });
      const delay = Number(process.env.DELAY || 150);
      setTimeout(() => { res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }); res.end(out.text); }, delay);
    });
    return;
  }
  if (u.pathname === '/__skew') { skew += Number(u.searchParams.get('ms')); res.end(String(skew)); return; }
  if (u.pathname === '/__sheet') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ log: env.ss.getSheetByName('Time Log').rows, trips: env.ss.getSheetByName('Trips').rows, audit: env.ss.getSheetByName('Audit Log').rows,
    proof: env.ss.getSheetByName('Delivery Proof').rows, crate: env.ss.getSheetByName('Customer Ratings').rows, srate: env.ss.getSheetByName('Site Ratings').rows,
    complaints: env.ss.getSheetByName('Complaints').rows, companies: env.ss.getSheetByName('Truck Companies').rows })); return; }
  if (u.pathname === '/delivery/config.js') { res.writeHead(200, { 'Content-Type': 'text/javascript' }); res.end("window.DELIVERY_CONFIG = { API_URL: 'http://localhost:" + PORT + "/api' };"); return; }
  if (u.pathname === '/sw.js') { res.writeHead(404); res.end(); return; }
  let p = path.join(REPO, 'web', decodeURIComponent(u.pathname));
  if (p.endsWith('/')) p += 'index.html';
  fs.readFile(p, (e, d) => { if (e) { res.writeHead(404); res.end('nf'); return; } res.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream' }); res.end(d); });
}).listen(PORT, () => console.log('up ' + PORT));
