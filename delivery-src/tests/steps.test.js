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
  const gin = await api('scaleGate', { kind: 'in', plate: PLATE, driver: 'X', ticket: 'UI1', kg: 8000 }, 'google:guard@test.kh');
  assert.ok(gin.ok && gin.data.tripId, JSON.stringify(gin));
  const trip = gin.data.tripId;

  // Warehouse: opens on the trucks inside
  const w = await as('wh@test.kh');
  await w.goto(BASE + '/delivery/');
  await w.getByText('Trucks inside').waitFor();
  assert.ok(!(await w.getByText('Driver', { exact: false }).filter({ hasText: '🚚 Driver' }).count()), 'warehouse has no driver switch');
  await w.getByRole('button', { name: new RegExp(PLATE) }).click();
  await w.getByText('2. Arrival at loading area').waitFor();
  await w.locator('#wh button, #wh [role=combobox]').first().click().catch(() => w.getByText('Choose the warehouse').click());
  await w.locator('[role=dialog] button', { hasText: 'PNP1' }).first().click();
  await save(w, w.getByRole('button', { name: /Record · Arrival/ }));
  await w.getByText('3. Start loading').waitFor({ timeout: 10000 });
  await w.screenshot({ path: SHOTS + 'steps-01-start-loading.png' });
  // Missing fields turn red
  await save(w, w.getByRole('button', { name: /Record · Start loading/ }));
  await w.getByText('Add at least one DN').waitFor();
  await w.getByPlaceholder('Type the DN').fill('9000000101'); await w.getByPlaceholder('Type the DN').press('Enter');
  await w.getByRole('button', { name: '9000000101 ✕' }).waitFor({ timeout: 10000 });
  await w.locator('#kg input').fill('1500');
  await w.locator('#photos input[type=file]').first().setInputFiles([IMG]);
  await save(w, w.getByRole('button', { name: /Record · Start loading/ }));
  await w.getByText('4. End loading').waitFor({ timeout: 10000 });
  await w.getByRole('button', { name: 'Yes', exact: true }).click();
  await save(w, w.getByRole('button', { name: /Record · End loading/ }));
  await w.getByText('Next warehouse').waitFor({ timeout: 10000 });
  await w.getByText('Next warehouse').click();
  await w.getByText('3. Start loading').waitFor();
  await w.getByText('Choose the warehouse').click();
  await w.locator('[role=dialog] button', { hasText: 'PNP2' }).first().click();
  await w.getByPlaceholder('Type the DN').fill('9000000102'); await w.getByPlaceholder('Type the DN').press('Enter');
  await w.getByRole('button', { name: '9000000102 ✕' }).waitFor({ timeout: 10000 });
  await w.locator('#kg input').fill('700');
  await w.locator('#photos input[type=file]').first().setInputFiles([IMG]);
  await save(w, w.getByRole('button', { name: /Record · Start loading/ }));
  await w.getByText('4. End loading').waitFor({ timeout: 10000 });
  await w.getByRole('button', { name: 'Yes', exact: true }).click();
  await save(w, w.getByRole('button', { name: /Record · End loading/ }));
  await w.screenshot({ path: SHOTS + 'steps-dbg.png' });
  await w.getByText('Picking done').click({ timeout: 8000 });
  await w.getByText('Waiting for Gate Out').waitFor();
  await w.getByRole('button', { name: /History/ }).click();
  await w.getByText('PNP2').first().waitFor();
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
  const card = d.locator('.card', { hasText: 'DN 9000000102' });
  await card.locator('input[type=file]').first().setInputFiles([IMG]);
  await save(d, card.getByRole('button', { name: /Record · Arrival/ }));
  await save(d, d.locator('.card', { hasText: 'DN 9000000102' }).getByRole('button', { name: /Record · Start unloading/ }));
  await save(d, d.locator('.card', { hasText: 'DN 9000000102' }).getByRole('button', { name: /Record · Finish unloading/ }));
  const c9 = d.locator('.card', { hasText: 'DN 9000000102' });
  await c9.getByText('DN signed by customer').waitFor({ timeout: 10000 });
  const files = c9.locator('input[type=file]');
  await files.nth(0).setInputFiles([IMG]);
  await c9.locator('input[type=file]').nth(2).setInputFiles([IMG]).catch(async () => { await files.nth(1).setInputFiles([IMG]); });
  await c9.locator('#rcv input').fill('Mr Test');
  const cv = c9.locator('canvas'); await cv.scrollIntoViewIfNeeded(); const bx = await cv.boundingBox();
  await d.mouse.move(bx.x + 20, bx.y + 30); await d.mouse.down(); await d.mouse.move(bx.x + 150, bx.y + 80, { steps: 8 }); await d.mouse.up();
  await d.screenshot({ path: SHOTS + 'steps-04-delivered.png', fullPage: true });
  await save(d, c9.getByRole('button', { name: /Record · Delivered/ }));
  await d.locator('.card', { hasText: 'DN 9000000102' }).getByText(/Delivered/).first().waitFor({ timeout: 10000 });
  await d.getByText(/rating|វាយតម្លៃ/i).first().waitFor({ timeout: 10000 });
  console.log('PASS driver steps 6-9 for one DN, rating shown');

  // Driver link (no sign-in): the other DN, with the new per-DN steps
  const td = await api('trip', { tripId: trip }, 'google:admin@test.kh');
  assert.ok(td.ok && td.data.driverLink, 'driver link');
  const lp = await as('nobody@test.kh');
  await lp.goto(BASE + '/delivery/?t=' + encodeURIComponent(trip) + '&k=' + td.data.driverLink);
  const lc = lp.locator('.card', { hasText: 'DN 9000000101' });
  await lc.getByText('6. Arrival at destination').waitFor({ timeout: 10000 });
  await lc.locator('input[type=file]').first().setInputFiles([IMG]);
  await save(lp, lc.getByRole('button', { name: /Record · Arrival/ }));
  await lp.locator('.card', { hasText: 'DN 9000000101' }).getByRole('button', { name: /Record · Start unloading/ }).waitFor({ timeout: 10000 });
  await lp.screenshot({ path: SHOTS + 'steps-05-driver-link.png', fullPage: true });
  console.log('PASS driver link uses the new steps');

  // A DN already on another trip is flagged when typed (Kim, 22 Nov 2026)
  const g2 = await api('scaleGate', { kind: 'in', plate: 'TEST-0001', driver: 'Y', ticket: 'UI2', kg: 7000 }, 'google:guard@test.kh');
  assert.ok(g2.ok && g2.data.tripId, JSON.stringify(g2));
  await api('record', { v2: true, code: 4, tripId: g2.data.tripId, wh: 'PNP1', ref: 'x1' }, 'google:wh@test.kh');
  await w.goto(BASE + '/delivery/#/steps/' + encodeURIComponent(g2.data.tripId));
  await w.getByText('3. Start loading').waitFor({ timeout: 10000 });
  await w.getByPlaceholder('Type the DN').fill('9000000101'); await w.getByPlaceholder('Type the DN').press('Enter');
  await w.getByText(/is already on trip .* Ask a Supervisor/).waitFor({ timeout: 10000 });
  assert.strictEqual(await w.getByRole('button', { name: '9000000101 ✕' }).count(), 0, 'used DN not added');
  await w.screenshot({ path: SHOTS + 'steps-06-dn-used.png' });
  console.log('PASS used DN flagged when typed');

  const s = await (await fetch(BASE + '/__sheet')).json();
  const rows = s.log.filter(r => r.includes(trip));
  console.log('rows for trip', rows.length);
  assert.ok(rows.length >= 10, 'rows written');
  if (errors.length) { console.log('PAGE ERRORS', errors); process.exitCode = 1; }
  await browser.close();
})().catch(e => { console.error('FAIL', e); process.exit(1); });
