// UI test: Kim's 9-step flow (20 Nov 2026). Scale Gate In → warehouse steps 2-4 (two warehouses) → Scale Gate Out → driver scans a DN, steps 6-9.
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const assert = require('assert');
const BASE = 'http://localhost:8765';
const SHOTS = (process.env.SHOTS || __dirname + '/shots') + '/';
require('fs').mkdirSync(SHOTS, { recursive: true });
const IMG = require('path').join(__dirname, '..', '..', 'web', 'icons', 'app-192.png');
const api = async (action, payload, token) => (await fetch(BASE + '/api', { method: 'POST', body: JSON.stringify({ action, payload, token }) })).json();
const errors = [];

(async () => {
  const browser = await chromium.launch();
  const phone = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, permissions: ['geolocation'], geolocation: { latitude: 11.55, longitude: 104.91 } };
  async function as(email) {
    const ctx = await browser.newContext(phone);
    await ctx.addInitScript(tok => { localStorage.setItem('fr_id_token', tok); localStorage.setItem('app_lang', 'en'); }, 'google:' + email);
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(e.message));
    return page;
  }
  const PLATE = 'TEST-0002';
  // Tap a Record button and say yes to any warning (DN not in plan …).
  async function save(page, btn) {
    await btn.click();
    const yes = page.getByRole('button', { name: 'Yes, record' });
    try { await yes.waitFor({ timeout: 2500 }); await yes.click(); } catch (e) { /* no warning */ }
  }
  const gin = await api('scaleGate', { kind: 'in', plate: PLATE, driver: '07.Driver A', ticket: 'UI1', kg: 8000 }, 'google:guard@test.kh');
  assert.ok(gin.ok && gin.data.tripId, JSON.stringify(gin));
  const trip = gin.data.tripId;

  // Warehouse: opens on the trucks inside
  const w = await as('wh@test.kh');
  await w.goto(BASE + '/delivery/');
  await w.getByText('Trucks inside').waitFor();
  assert.ok(!(await w.getByText('Driver', { exact: false }).filter({ hasText: '🚚 Driver' }).count()), 'warehouse has no driver switch');
  await w.getByRole('button', { name: new RegExp(PLATE) }).click();
  await w.getByText('2. Which warehouse are you loading at? Please choose').first().waitFor();
  await w.locator('#wh button, #wh [role=combobox]').first().click().catch(() => w.getByText('Choose the warehouse').click());
  await w.locator('[role=dialog] button', { hasText: 'PNP1' }).first().click();
  await save(w, w.getByRole('button', { name: /Record · Arrival/ }));
  await w.getByText('3. Which DN are you starting to load?').first().waitFor({ timeout: 10000 });
  await w.screenshot({ path: SHOTS + 'steps-01-start-loading.png' });
  // Missing fields turn red
  await save(w, w.getByRole('button', { name: /Record · Start loading/ }));
  await w.getByText('Add at least one DN').waitFor();
  await w.getByPlaceholder('Type the DN').fill('9000000101'); await w.getByPlaceholder('Type the DN').press('Enter');
  await w.getByRole('button', { name: '9000000101 ✕' }).waitFor({ timeout: 10000 });
  // Kim (23 Nov 2026): a DN not in the Delivery Plan needs its customer, red until chosen
  await w.getByText('Customer of DN 9000000101').waitFor();
  assert.ok(await w.locator('#cust_9000000101 .need').count(), 'customer box red');
  await save(w, w.getByRole('button', { name: /Record · Start loading/ }));
  await w.getByText('Choose the customer').first().waitFor();
  await w.locator('#cust_9000000101').getByText('Choose the customer').first().click();
  await w.locator('[role=dialog] button', { hasText: 'TEST Customer A' }).first().click();
  await w.screenshot({ path: SHOTS + 'steps-01b-customer.png' });
  await save(w, w.getByRole('button', { name: /Record · Start loading/ }));
  await w.getByText('4. Goods weight, photos and webbing slings').first().waitFor({ timeout: 10000 });
  // Kim (24 Nov 2026): 🧮 on number boxes, + − × ÷ like Stock Count: 1000 + 250 × 2 = 1500
  await w.locator('#kg').getByRole('button', { name: 'Calculator' }).click();
  for (const k of ['1', '0', '0', '0', '+', '2', '5', '0', '×', '2']) await w.locator('.calc-keys button', { hasText: new RegExp('^' + k.replace('+', '\\+') + '$') }).click();
  assert.strictEqual((await w.locator('[data-calc] b').textContent()).trim(), '1,500', 'calculator result');
  await w.screenshot({ path: SHOTS + 'steps-01c-calc.png' });
  await w.getByRole('button', { name: /Put in the box/ }).click();
  assert.strictEqual(await w.locator('#kg input').first().inputValue(), '1500', 'calculator fills the box');
  await w.locator('#photos input[type=file]').first().setInputFiles([IMG]);
  await w.getByRole('button', { name: 'Yes', exact: true }).click();
  await save(w, w.getByRole('button', { name: /Record · End loading/ }));
  await w.getByText('Next warehouse').waitFor({ timeout: 10000 });
  await w.getByText('Next warehouse').click();
  await w.getByText('3. Next warehouse to start loading').first().waitFor();
  await w.getByText('Choose the warehouse').click();
  await w.locator('[role=dialog] button', { hasText: 'PNP2' }).first().click();
  await w.getByPlaceholder('Type the DN').fill('9000000102'); await w.getByPlaceholder('Type the DN').press('Enter');
  await w.getByRole('button', { name: '9000000102 ✕' }).waitFor({ timeout: 10000 });
  await w.locator('#cust_9000000102').getByText('Choose the customer').first().click();
  await w.locator('[role=dialog] button', { hasText: 'TEST Customer B' }).first().click();
  await save(w, w.getByRole('button', { name: /Record · Start loading/ }));
  await w.getByText('4. Goods weight, photos and webbing slings').first().waitFor({ timeout: 10000 });
  await w.locator('#kg input').fill('700');
  await w.locator('#photos input[type=file]').first().setInputFiles([IMG]);
  await w.getByRole('button', { name: 'Yes', exact: true }).click();
  await save(w, w.getByRole('button', { name: /Record · End loading/ }));
  await w.screenshot({ path: SHOTS + 'steps-dbg.png' });
  await w.getByText('Picking done').click({ timeout: 8000 });
  await w.getByText('Waiting for Gate Out').waitFor();
  // Kim's W picks (23 Nov 2026): the warehouse sees only its step, no History / Cancel / links
  assert.strictEqual(await w.getByRole('button', { name: /History|Cancel trip/ }).count(), 0, 'warehouse: no history or cancel');
  const tdw = await api('trip', { tripId: trip }, 'google:admin@test.kh');
  assert.ok(tdw.data.rows.some(r => r.wh === 'PNP2'), 'second warehouse recorded');
  await w.screenshot({ path: SHOTS + 'steps-02-warehouse-done.png' });
  console.log('PASS warehouse steps 2-4 twice');

  const gout = await api('scaleGate', { kind: 'out', plate: PLATE, ticket: 'UI1', net: 2200, dns: ['9000000101', '9000000102'] }, 'google:guard@test.kh');
  assert.ok(gout.ok && gout.data.tripId === trip, JSON.stringify(gout));

  // Driver: no Trips tab; scans (types) a DN and sees only that truck
  const d = await as('drv@test.kh');
  await d.goto(BASE + '/delivery/');
  await d.getByText('Scan a DN to open your truck').waitFor();
  assert.strictEqual(await d.getByRole('button', { name: /^.*Trips$/ }).count(), 0, 'driver has no Trips tab');
  await d.goto(BASE + '/delivery/#/trips');
  await d.getByText('Scan a DN to open your truck').waitFor();
  await d.getByPlaceholder('or type the DN').fill('9000000102');
  await d.getByRole('button', { name: 'Open' }).click();
  await d.getByText('6. Arrival at destination').first().waitFor({ timeout: 10000 });
  await d.screenshot({ path: SHOTS + 'steps-03-driver.png' });
  const card = d.locator('[data-stop="9000000102"]');
  await card.locator('input[type=file]').first().setInputFiles([IMG]);
  await save(d, card.getByRole('button', { name: /Arrival at destination \(/ }));
  await save(d, d.locator('[data-stop="9000000102"]').getByRole('button', { name: /Start unloading \(/ }));
  await save(d, d.locator('[data-stop="9000000102"]').getByRole('button', { name: /Finish unloading \(/ }));
  const c9 = d.locator('[data-stop="9000000102"]');
  await c9.getByText('DN signed by customer').waitFor({ timeout: 10000 });
  const files = c9.locator('input[type=file]');
  await files.nth(0).setInputFiles([IMG]);
  await c9.locator('input[type=file]').nth(2).setInputFiles([IMG]).catch(async () => { await files.nth(1).setInputFiles([IMG]); });
  await c9.locator('#rcv input').fill('Mr Test');
  await c9.getByRole('button', { name: /Unlock/ }).click();
  const cv = c9.locator('canvas'); await cv.scrollIntoViewIfNeeded(); const bx = await cv.boundingBox();
  await d.mouse.move(bx.x + 20, bx.y + 30); await d.mouse.down(); await d.mouse.move(bx.x + 150, bx.y + 80, { steps: 8 }); await d.mouse.up();
  await d.screenshot({ path: SHOTS + 'steps-04-delivered.png', fullPage: true });
  await save(d, c9.getByRole('button', { name: /Delivered \(/ }));
  await d.locator('[data-stop="9000000102"]').getByText(/Delivered/).first().waitFor({ timeout: 10000 });
  await d.getByText(/rating|វាយតម្លៃ/i).first().waitFor({ timeout: 10000 });
  // Kim (24 Nov 2026): the driver survey stays (after refreshes and a reload) until it is sent
  await d.waitForTimeout(3000);
  await d.getByText('Rate the customer site').waitFor({ timeout: 5000 });
  await d.reload();
  await d.getByText('Rate the customer site').waitFor({ timeout: 10000 });
  // Kim picked survey option A: face buttons, all 3 answers before Send
  assert.ok(await d.getByRole('button', { name: /Send rating/ }).isDisabled(), 'send waits for 3 answers');
  await d.getByRole('radio', { name: /< 30 min/ }).click();
  await d.getByRole('radio', { name: /^.?.?\s*Yes$/ }).first().click().catch(() => d.locator('.faces').nth(1).locator('.face').first().click());
  await d.locator('.faces').nth(2).locator('.face').first().click();
  await d.screenshot({ path: SHOTS + 'steps-04b-survey.png', fullPage: true });
  await d.getByRole('button', { name: /Send rating/ }).click();
  await d.getByText('Rate the customer site').waitFor({ state: 'detached', timeout: 10000 });
  console.log('PASS driver steps 6-9 for one DN, rating shown');

  // Driver link (no sign-in): the other DN, with the new per-DN steps
  const td = await api('trip', { tripId: trip }, 'google:admin@test.kh');
  assert.ok(td.ok && td.data.driverLink, 'driver link');
  const lp = await as('nobody@test.kh');
  await lp.goto(BASE + '/delivery/?t=' + encodeURIComponent(trip) + '&k=' + td.data.driverLink);
  // Kim (23 Nov 2026): no DN scanned yet = scan card only, no other customer's DN shown
  await lp.getByText('Scan a DN at this customer').waitFor({ timeout: 10000 });
  assert.strictEqual(await lp.locator('[data-stop]').count(), 0, 'no stops before a DN scan');
  await lp.getByPlaceholder('or type the DN').fill('9999999999'); await lp.getByPlaceholder('or type the DN').press('Enter');
  await lp.getByText(/is not on this truck/).waitFor({ timeout: 10000 });
  await lp.getByPlaceholder('or type the DN').fill('9000000101'); await lp.getByPlaceholder('or type the DN').press('Enter');
  const lc = lp.locator('[data-stop="9000000101"]');
  await lc.getByText('6. Arrival at destination').waitFor({ timeout: 10000 });
  assert.strictEqual(await lp.locator('[data-stop]').count(), 1, 'only the scanned customer');
  assert.strictEqual(await lp.getByText('9000000102').count(), 0, 'no other DN on screen');
  await lc.locator('input[type=file]').first().setInputFiles([IMG]);
  await save(lp, lc.getByRole('button', { name: /Arrival at destination \(/ }));
  await lp.locator('[data-stop="9000000101"]').getByRole('button', { name: /Start unloading \(/ }).waitFor({ timeout: 10000 });
  // Kim (24 Nov 2026): the scanned DN stays chosen after a reload (no re-scan for the next step)
  await lp.reload();
  await lp.locator('[data-stop="9000000101"]').getByRole('button', { name: /Start unloading \(/ }).waitFor({ timeout: 10000 });
  await lp.screenshot({ path: SHOTS + 'steps-05-driver-link.png', fullPage: true });
  console.log('PASS driver link uses the new steps');

  // Customer live tracking (Kim, 22 Nov 2026): driver GPS -> customer map page
  const g1 = await api('drvGps', { t: trip, k: td.data.driverLink, ll: '11.56,104.91', acc: 10 });
  assert.ok(g1.ok, JSON.stringify(g1));
  const td2 = await api('trip', { tripId: trip }, 'google:admin@test.kh');
  const tk = td2.data.track['9000000101'];
  assert.ok(tk, 'track link');
  const cp = await as('nobody@test.kh');
  // The sandbox cannot reach cdnjs / OpenStreetMap: serve Leaflet from a local copy when LEAFLET_DIR is set.
  if (process.env.LEAFLET_DIR) await cp.route(/cdnjs\.cloudflare\.com\/ajax\/libs\/leaflet\/1\.9\.4\/leaflet\.min\.(js|css)/, r => r.fulfill({ path: process.env.LEAFLET_DIR + '/leaflet.' + (r.request().url().endsWith('js') ? 'js' : 'css') }));
  const ss = await api('setSite', { custId: '6100000001', latlong: '11.55,104.89', custName: 'TEST Customer A' }, 'google:admin@test.kh');
  assert.ok(ss.ok, JSON.stringify(ss));
  // Free OSRM road route (Kim, 24 Nov 2026): the sandbox has no internet, so a fake route answers.
  let osrm = 0;
  await cp.route(/router\.project-osrm\.org/, r => { osrm++; r.fulfill({ contentType: 'application/json', body: JSON.stringify({ routes: [{ distance: 5200, duration: 600, geometry: { coordinates: [[104.91, 11.56], [104.90, 11.555], [104.89, 11.55]] } }] }) }); });
  await cp.goto(BASE + '/delivery/track.html?d=9000000101&t=' + encodeURIComponent(trip) + '&k=' + tk);
  await cp.getByText(/Your steel is on the way|កំពុងធ្វើដំណើរ/).waitFor({ timeout: 10000 });
  await cp.locator('#gmap[href*="11.56,104.91"]').waitFor({ state: 'attached', timeout: 10000 });
  await cp.getByText('Driver A').first().waitFor({ timeout: 10000 });
  assert.strictEqual(await cp.getByText(/ kg/).count(), 0, 'no kg');
  if (process.env.LEAFLET_DIR) await cp.locator('.leaflet-marker-icon').first().waitFor({ timeout: 10000 });
  await cp.waitForTimeout(1500);
  await cp.waitForFunction(() => /^\d\d:\d\d$/.test(document.getElementById('eta').textContent), null, { timeout: 10000 });
  assert.ok(osrm >= 1, 'road route asked');
  assert.ok(/maps\/dir\/\?api=1&origin=11\.56,104\.91&destination=11\.55,104\.89/.test(await cp.locator('#gmap').getAttribute('href')), 'directions link');
  await cp.screenshot({ path: SHOTS + 'steps-07-track.png', fullPage: true });
  console.log('PASS customer live map');
  // Kim's O1 B (23 Nov 2026): the trip page = clean view; links behind a button
  const ad = await as('admin@test.kh');
  await ad.goto(BASE + '/delivery/#/trip/' + encodeURIComponent(trip));
  // Kim's O1 B (23 Nov 2026): stops card, 9-step bar, links behind a button
  // Kim (24 Nov 2026): while the driver part shows a stop card, the stops list is hidden (no duplicate)
  await ad.locator('[data-stops], [data-stop]').first().waitFor({ timeout: 10000 });
  assert.ok(/9000000101/.test(await ad.locator('[data-stops], [data-stop]').first().textContent()), 'DNs in the stops or stop card');
  await ad.getByRole('button', { name: /Driver \/ customer links/ }).click();
  await ad.locator('[data-qr="driver"] svg').waitFor({ timeout: 10000 });
  await ad.getByText(/Live tracking link|តំណតាមដាន/).waitFor({ timeout: 10000 });
  assert.strictEqual(await ad.getByText('DNs on this trip').count(), 0, 'no DN box');
  await ad.screenshot({ path: SHOTS + 'steps-08-header-qr.png', fullPage: true });
  console.log('PASS header DNs and driver QR');
  // Kim (24 Nov 2026): Customer join links page (office only)
  await ad.goto(BASE + '/delivery/#/more');
  await ad.getByText('Customer join links').click();
  await ad.getByRole('button', { name: /^.*All \d+$/ }).click();
  await ad.locator('[data-cust="6100000001"]').waitFor({ timeout: 10000 });
  await ad.screenshot({ path: SHOTS + 'steps-10-join-links.png', fullPage: true });
  console.log('PASS customer join links page');

  // A DN already on another trip is flagged when typed (Kim, 22 Nov 2026)
  const g2 = await api('scaleGate', { kind: 'in', plate: 'TEST-0001', driver: 'Y', ticket: 'UI2', kg: 7000 }, 'google:guard@test.kh');
  assert.ok(g2.ok && g2.data.tripId, JSON.stringify(g2));
  await api('record', { v2: true, code: 4, tripId: g2.data.tripId, wh: 'PNP1', ref: 'x1' }, 'google:wh@test.kh');
  await w.goto(BASE + '/delivery/#/steps/' + encodeURIComponent(g2.data.tripId));
  await w.getByText('3. Which DN are you starting to load?').first().waitFor({ timeout: 10000 });
  await w.getByPlaceholder('Type the DN').fill('9000000101'); await w.getByPlaceholder('Type the DN').press('Enter');
  await w.getByText(/is already on trip/).waitFor({ timeout: 10000 });
  // Kim (23 Nov 2026): several pickups per DN allowed, alert only: the DN is still added
  assert.strictEqual(await w.getByRole('button', { name: '9000000101 ✕' }).count(), 1, 'used DN still added');
  await w.screenshot({ path: SHOTS + 'steps-06-dn-used.png' });
  console.log('PASS used DN warned and still added');

  // Kim (23 Nov 2026): 2 DNs to one customer = one stop, recorded once
  const g3 = await api('scaleGate', { kind: 'in', plate: '3B-7777', driver: '07.Driver A', company: 'TEST 3PL', ticket: 'UI3', kg: 6000 }, 'google:guard@test.kh');
  assert.ok(g3.ok && g3.data.tripId, JSON.stringify(g3));
  const t3 = g3.data.tripId, C = ['DN_DUPLICATE', 'DN_NOT_IN_PLAN', 'PLAN_OTHER_TRUCK'];
  for (const [code, extra] of [[4, {}], [5, { dns: [{ dn: '9300000001', custId: '6100000001', custName: 'TEST Customer A' }, { dn: '9300000002', custId: '6100000001', custName: 'TEST Customer A' }] }], [6, { kg: 900, websling: false }]]) {
    const r = await api('record', Object.assign({ v2: true, code, tripId: t3, wh: 'PNP1', ref: 's' + code, confirm: C }, extra), 'google:wh@test.kh');
    assert.ok(r.ok, code + ' ' + JSON.stringify(r));
  }
  const go3 = await api('scaleGate', { kind: 'out', plate: '3B-7777', ticket: 'UI3', net: 900, dns: ['9300000001', '9300000002'] }, 'google:guard@test.kh');
  assert.ok(go3.ok, JSON.stringify(go3));
  await d.goto(BASE + '/delivery/#/steps/' + encodeURIComponent(t3) + '?dn=9300000002');
  const stop = d.locator('[data-stop="9300000001,9300000002"]');
  await stop.waitFor({ timeout: 10000 });
  assert.strictEqual(await d.locator('[data-stop]').count(), 1, 'one stop shown');
  await stop.locator('input[type=file]').first().setInputFiles([IMG]);
  await d.screenshot({ path: SHOTS + 'steps-09-stop.png', fullPage: true });
  await save(d, stop.getByRole('button', { name: /Arrival at destination \(2 DN\)/ }));
  await d.locator('[data-stop="9300000001,9300000002"]').getByRole('button', { name: /Start unloading \(2 DN\)/ }).waitFor({ timeout: 10000 });
  const td3 = await api('trip', { tripId: t3 }, 'google:admin@test.kh');
  assert.deepStrictEqual(td3.data.dns.map(x => x.leg), ['at_customer', 'at_customer'], JSON.stringify(td3.data.dns));
  console.log('PASS one stop for 2 DNs to the same customer');

  const s = await (await fetch(BASE + '/__sheet')).json();
  const rows = s.log.filter(r => r.includes(trip));
  console.log('rows for trip', rows.length);
  assert.ok(rows.length >= 10, 'rows written');
  if (errors.length) { console.log('PAGE ERRORS', errors); process.exitCode = 1; }
  await browser.close();
})().catch(e => { console.error('FAIL', e); process.exit(1); });
