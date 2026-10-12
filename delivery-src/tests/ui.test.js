// UI test: Kim's split-DN example through the real screens (phone size), roles, warnings, offline, driver link.
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const assert = require('assert');
const BASE = 'http://localhost:8765';
const SHOTS = (process.env.SHOTS || __dirname + '/shots') + '/';
require('fs').mkdirSync(SHOTS, { recursive: true });
const results = [];
const pass = (name, extra) => { results.push('PASS ' + name + (extra ? ' (' + extra + ')' : '')); console.log('PASS', name, extra || ''); };
const api = async (action, payload, token) => (await fetch(BASE + '/api', { method: 'POST', body: JSON.stringify({ action, payload, token }) })).json();
const skew = ms => fetch(BASE + '/__skew?ms=' + ms);

(async () => {
  const browser = await chromium.launch();
  const phone = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, permissions: ['geolocation'], geolocation: { latitude: 11.55, longitude: 104.91 } };
  async function as(email, opts) {
    const ctx = await browser.newContext(Object.assign({}, phone, opts || {}));
    if (email) await ctx.addInitScript(tok => { if (!localStorage.getItem('fr_id_token')) localStorage.setItem('fr_id_token', tok); }, 'google:' + email);
    const page = await ctx.newPage(); (global.PAGES = global.PAGES || []).push(page);
    page.on('pageerror', e => { console.log('PAGE ERROR', e.message); results.push('FAIL page error ' + e.message); });
    return { ctx, page };
  }
  const recordBtn = page => page.locator('button.btn-primary', { hasText: /កត់ត្រា|Record/ }).last();

  // ---- Security: Gate In
  const g = await as('guard@test.kh');
  await g.page.goto(BASE + '/delivery/');
  await g.page.getByText('ជើងដឹកថ្ងៃនេះ').first().waitFor();
  await g.page.screenshot({ path: SHOTS + '01-ops-phone-km.png' });
  await g.page.goto(BASE + '/delivery/#/record');
  const evs = await g.page.locator('[role=radio]').allTextContents();
  assert.deepStrictEqual(evs.map(s => s.replace(/ជំហានបន្ទាប់|Next step/, '').trim()), ['១.ចូលថ្លឹង', '៧.ចេញពីកន្លែងថ្លឹង']);
  pass('Security sees only the steps Type Record allows', evs.join(', '));
  await g.page.locator('#plate').click();
  await g.page.getByPlaceholder(/ស្វែងរក/).fill('TEST-0001');
  await g.page.locator('[role=dialog] button', { hasText: 'TEST-0001' }).first().click();
  await g.page.screenshot({ path: SHOTS + '02-gatein-form.png' });
  await recordBtn(g.page).click();
  const t1 = (await g.page.getByTestId('new-trip-id').textContent()).trim();
  assert.match(t1, /^\d\d-\d\d-\d\d-\d{3}$/);
  await g.page.screenshot({ path: SHOTS + '03-gatein-done.png' });
  pass('Gate In creates a Trip ID on screen', t1);

  // duplicate Gate In a moment later
  await g.page.getByText('កត់ត្រាថ្មី').click();
  await g.page.locator('#plate').click();
  await g.page.getByPlaceholder(/ស្វែងរក/).fill('TEST-0001');
  await g.page.locator('[role=dialog] button', { hasText: 'TEST-0001' }).first().click();
  await recordBtn(g.page).click();
  await g.page.getByText(/ទើបតែកត់ត្រា/).waitFor();
  await g.page.screenshot({ path: SHOTS + '04-duplicate.png' });
  pass('Second Gate In for the same truck within 3 min is refused');

  // ---- Logistics: Arrival-Pickup with 2 DNs (one typed, one from plan)
  const l = await as('logi@test.kh');
  await l.page.goto(BASE + '/delivery/#/record?trip=' + t1 + '&code=2');
  await l.page.getByPlaceholder('វាយលេខ DN').fill('9000000001');
  await l.page.getByRole('button', { name: 'បន្ថែម', exact: true }).click();
  await l.page.getByText('ជ្រើសពី Delivery Plan').click();
  await l.page.locator('[role=dialog] button', { hasText: '9000000002' }).click();
  await l.page.screenshot({ path: SHOTS + '05-pickup-dns.png' });
  await recordBtn(l.page).click();
  await l.page.getByText('កត់ត្រាជំហានបន្ទាប់').waitFor();
  pass('Logistics adds DN-001 and DN-002 to trip 1 (typed + from plan)');
  // ---- next steps via API by the right roles
  const tok = e => 'google:' + e;
  for (const [who, code, extra] of [['logi@test.kh', 3], ['wh@test.kh', 4], ['wh@test.kh', 5], ['wh@test.kh', 6, { wh: 'PNP1', kg: 3000, websling: false }], ['guard@test.kh', 7]]) {
    const r = await api('record', Object.assign({ ref: 'x' + code + Math.random(), code, tripId: t1 }, extra || {}), tok(who));
    assert.ok(r.ok && !r.data.needConfirm, JSON.stringify(r));
  }
  // warehouse loading form renders
  const w = await as('wh@test.kh');
  await w.page.goto(BASE + '/delivery/#/record?trip=' + t1 + '&code=6');
  await w.page.locator('#wh').waitFor();
  await w.page.screenshot({ path: SHOTS + '06-loading-form.png' });
  const wEv = await w.page.locator('[role=radio]').allTextContents();
  assert.ok(!wEv.some(s => s.indexOf('ចូលថ្លឹង') >= 0));
  pass('Warehouse cannot see Gate In');

  // ---- Admin: trip detail with driver link
  const a = await as('admin@test.kh');
  await a.page.goto(BASE + '/delivery/#/trip/' + t1);
  await a.page.getByText('តំណសម្រាប់តៃកុង').waitFor();
  await a.page.getByRole('button', { name: '▦ QR' }).click();
  await a.page.locator('svg').first().waitFor();
  await a.page.screenshot({ path: SHOTS + '07-trip-detail-admin.png', fullPage: true });
  const detail = (await api('trip', { tripId: t1 }, tok('admin@test.kh'))).data;
  const link1 = BASE + '/delivery/?t=' + t1 + '&k=' + detail.driverLink;
  pass('Trip screen shows driver link + QR');

  // ---- Driver (no sign-in): DN-001 delivered on trip 1
  const d = await as(null);
  await d.page.goto(link1);
  await d.page.getByText('៩. បានប្រគល់ទំនិញ').click();
  await d.page.locator('label', { hasText: '9000000001' }).locator('input').check();
  // proof of delivery: receiver, finger signature, two photos
  await d.page.locator('#rcv').fill('Mr Receiver');
  await d.page.locator('canvas').scrollIntoViewIfNeeded();
  const box = await d.page.locator('canvas').boundingBox();
  await d.page.mouse.move(box.x + 20, box.y + 30); await d.page.mouse.down();
  await d.page.mouse.move(box.x + 120, box.y + 90, { steps: 8 }); await d.page.mouse.move(box.x + 220, box.y + 40, { steps: 8 }); await d.page.mouse.up();
  await d.page.getByText(/បានចុះហត្ថលេខា/).waitFor();
  const img = require('path').join(__dirname, '..', '..', 'web', 'icons', 'app-192.png');
  await d.page.locator('input[type=file][multiple]').setInputFiles([img, img]);
  await d.page.getByText('(2/5)').waitFor();
  await d.page.screenshot({ path: SHOTS + '08-driver-page.png', fullPage: true });
  await d.page.getByRole('button', { name: /✔/ }).click();
  await d.page.getByText(/បានកត់ត្រា/).first().waitFor();
  const pr = (await (await fetch(BASE + '/__sheet')).json()).proof;
  assert.strictEqual(pr.length, 2, 'one proof row');
  assert.strictEqual(pr[1][4], 'Mr Receiver');
  assert.ok(/^https:\/\/drive/.test(pr[1][5]), 'signature saved');
  assert.strictEqual(String(pr[1][6]).split('\n').length, 2);
  pass('Driver link records DN-001 Delivered with receiver, signature and 2 photos, without sign-in');
  // after Delivered: customer rating QR and the driver's site rating
  await d.page.getByText('ឲ្យអតិថិជនវាយតម្លៃ').waitFor();
  await d.page.getByText('> ១ ម៉ោង').click();
  await d.page.getByText('យឺតដោយសារអតិថិជន').click();
  await d.page.screenshot({ path: SHOTS + '08b-driver-after-delivered.png', fullPage: true });
  await d.page.getByRole('button', { name: 'ផ្ញើការវាយតម្លៃ' }).click();
  await d.page.getByText('វាយតម្លៃទីតាំងអតិថិជន').waitFor({ state: 'detached' });
  const sr = (await (await fetch(BASE + '/__sheet')).json()).srate;
  assert.strictEqual(sr.length, 2); assert.strictEqual(sr[1][6], 'long'); assert.strictEqual(sr[1][9], 'Yes');
  pass('Driver rates the customer site (long wait, customer delay)');
  // customer rating page: no sign-in
  const rt = (await api('trip', { tripId: t1 }, 'google:admin@test.kh')).data.rate['9000000001'];
  const c = await as(null);
  await c.page.goto(BASE + '/delivery/rate.html?d=9000000001&t=' + t1 + '&k=' + rt);
  await c.page.getByText('តើការដឹកជញ្ជូនយ៉ាងម៉េចដែរ?').waitFor();
  await c.page.locator('.stars[data-k=overall] button').nth(1).click();
  await c.page.locator('.stars[data-k=polite] button').nth(4).click();
  await c.page.locator('#comment').fill('Arrived late');
  await c.page.screenshot({ path: SHOTS + '08c-customer-rating.png', fullPage: true });
  await c.page.locator('#send').click();
  await c.page.getByText(/សូមអរគុណ/).waitFor();
  const cr = (await (await fetch(BASE + '/__sheet')).json()).crate;
  assert.strictEqual(cr.length, 2); assert.strictEqual(cr[1][5], 2); assert.strictEqual(cr[1][6], 5);
  await c.page.reload();
  await c.page.locator('#done').waitFor();
  const bad = await as(null);
  await bad.page.goto(BASE + '/delivery/rate.html?d=9000000001&t=' + t1 + '&k=wrongkey');
  await bad.page.getByText('តំណនេះមិនត្រឹមត្រូវ។').waitFor();
  pass('Customer rates the delivery from the QR link (no sign-in); rated once; a wrong key is refused');

  // ---- truck comes back: trip 2 (open previous trip warning)
  await skew(10 * 60000);
  await g.page.goto(BASE + '/delivery/#/record');
  await g.page.reload();
  await g.page.locator('#plate').click();
  await g.page.getByPlaceholder(/ស្វែងរក/).fill('TEST-0001');
  await g.page.locator('[role=dialog] button', { hasText: 'TEST-0001' }).first().click();
  await recordBtn(g.page).click();
  await g.page.getByText('សូមពិនិត្យ').waitFor();
  await g.page.screenshot({ path: SHOTS + '09-open-trip-warning.png' });
  await g.page.getByRole('button', { name: 'បាទ/ចាស កត់ត្រា' }).click();
  const t2 = (await g.page.getByTestId('new-trip-id').textContent()).trim();
  assert.notStrictEqual(t1, t2);
  const round2 = await g.page.getByText(/ជើងទី/).textContent();
  assert.match(round2, /2/);
  pass('Same truck returns: new Trip ID, round 2, after confirming the open-trip warning', t2);

  // DN-002 on trip 2: warning that it is still open on trip 1
  await l.page.goto(BASE + '/delivery/#/record?trip=' + t2 + '&code=2');
  await l.page.reload();
  await l.page.getByPlaceholder('វាយលេខ DN').fill('9000000002');
  await l.page.getByRole('button', { name: 'បន្ថែម', exact: true }).click();
  await recordBtn(l.page).click();
  await l.page.getByText(/នៅបើកលើជើងដឹក/).waitFor();
  await l.page.screenshot({ path: SHOTS + '10-dn-open-elsewhere.png' });
  await l.page.getByRole('button', { name: 'បាទ/ចាស កត់ត្រា' }).click();
  await l.page.getByText('កត់ត្រាជំហានបន្ទាប់').waitFor();
  pass('DN-002 added to trip 2 after the "open on another trip" warning');
  await skew(5 * 60000);
  for (const [who, code, extra] of [['logi@test.kh', 3], ['wh@test.kh', 4], ['wh@test.kh', 5], ['wh@test.kh', 6, { wh: 'PNP2' }], ['guard@test.kh', 7]]) {
    const r = await api('record', Object.assign({ ref: 'y' + code + Math.random(), code, tripId: t2 }, extra || {}), tok(who));
    assert.ok(r.ok && !r.data.needConfirm, JSON.stringify(r));
  }
  const detail2 = (await api('trip', { tripId: t2 }, tok('admin@test.kh'))).data;
  await d.page.goto(BASE + '/delivery/?t=' + t2 + '&k=' + detail2.driverLink);
  await d.page.getByText('៩. បានប្រគល់ទំនិញ').click();
  await d.page.getByRole('button', { name: /✔/ }).click();   // single open DN is pre-ticked
  await d.page.getByText(/បានកត់ត្រា|បានបញ្ចប់/).first().waitFor();
  pass('DN-002 delivered on trip 2 via the trip 2 driver link');

  // ---- check: DN-002 delivered on trip 2, not on trip 1; trip 1 completed
  await a.page.goto(BASE + '/delivery/#/trip/' + t1);
  await a.page.reload();
  await a.page.getByText('ប្រគល់តាមជើងផ្សេង').waitFor();
  await a.page.screenshot({ path: SHOTS + '11-trip1-after.png', fullPage: true });
  const tr1 = (await api('trip', { tripId: t1 }, tok('admin@test.kh'))).data;
  assert.strictEqual(tr1.dns.find(x => x.dn === '9000000002').leg, 'moved');
  assert.strictEqual(tr1.dns.find(x => x.dn === '9000000001').leg, 'delivered');
  assert.strictEqual(tr1.stage, 'completed');
  const sheet = await (await fetch(BASE + '/__sheet')).json();
  const head = sheet.log[0];
  const dl = sheet.log.filter(r => r[head.indexOf('ស្ថានភាពដឹកជញ្ជូន')] === '៩.បានប្រគល់ទំនិញ' && r[head.indexOf('លេខដឹកជញ្ជូន (DN#)')] === '9000000002');
  assert.strictEqual(dl.length, 1);
  assert.strictEqual(dl[0][head.indexOf('Trip ID')], t2);
  pass("Kim's example: DN-002 is Delivered only on trip 2; trip 1 shows it as delivered on another trip and is Completed");
  await a.page.goto(BASE + '/delivery/#/dn/9000000002');
  await a.page.getByText('ជើងដឹកដែលដឹក DN នេះ').waitFor();
  await a.page.screenshot({ path: SHOTS + '12-dn-detail.png', fullPage: true });
  pass('DN screen lists both trips for the split DN');

  // ---- complaints and customer delay on the DN screen (Logistics)
  await l.page.goto(BASE + '/delivery/#/dn/9000000001');
  await l.page.reload();
  await l.page.getByRole('button', { name: /បន្ថែម/ }).click();
  await l.page.getByRole('button', { name: 'អាកប្បកិរិយាតៃកុង' }).click();
  await l.page.getByPlaceholder('ពិពណ៌នាបណ្តឹង').fill('Driver did not help unload');
  await l.page.getByRole('button', { name: 'រក្សាទុក' }).click();
  await l.page.getByText(/C\d{6}-01/).waitFor();
  await l.page.getByRole('button', { name: 'បញ្ជាក់' }).click();
  await l.page.getByText('យឺតដោយអតិថិជន (បានបញ្ជាក់)').waitFor();
  await l.page.screenshot({ path: SHOTS + '12b-dn-complaint-ratings.png', fullPage: true });
  const sh4 = await (await fetch(BASE + '/__sheet')).json();
  assert.strictEqual(sh4.complaints.length, 2); assert.strictEqual(sh4.complaints[1][10], 'logi@test.kh');
  assert.strictEqual(sh4.srate[1][11], 'logi@test.kh');
  await l.page.goto(BASE + '/delivery/#/complaints');
  await l.page.getByText('Driver did not help unload').waitFor();
  pass('Complaint logged against the DN (3PL from the truck); customer delay confirmed by Logistics');
  // ---- dashboard (English only), loaded on demand
  await a.page.goto(BASE + '/delivery/#/more');
  await a.page.reload();
  await a.page.getByText('Dashboard').first().click();
  await a.page.getByText('3PL scorecard').waitFor();
  await a.page.getByText('Where trucks spend time inside the plant').waitFor();
  await a.page.screenshot({ path: SHOTS + '12c-dashboard.png', fullPage: true });
  const gMore = await g.page.goto(BASE + '/delivery/#/more').then(() => g.page.waitForTimeout(500)).then(() => g.page.getByText('Dashboard').count());
  assert.strictEqual(gMore, 0);
  pass('Dashboard (turnaround, OTIF, 3PL scorecard) opens for Admin; Security does not see it');

  // ---- time correction with audit
  await a.page.goto(BASE + '/delivery/#/trip/' + t2);
  await a.page.getByText('✎ កែម៉ោង').first().click();
  await a.page.locator('#cr').fill('Guard tapped late');
  await a.page.screenshot({ path: SHOTS + '13-correct-time.png' });
  await a.page.getByRole('button', { name: 'រក្សាទុក' }).click();
  await a.page.getByText(/Audit Log/).waitFor();
  const sheet2 = await (await fetch(BASE + '/__sheet')).json();
  assert.ok(sheet2.audit.length >= 2 && sheet2.audit[sheet2.audit.length - 1].indexOf('Guard tapped late') >= 0);
  pass('Supervisor/Admin time correction writes the Audit Log');
  const s = await as('sup@test.kh');
  await s.page.goto(BASE + '/delivery/#/trip/' + t2);
  await s.page.getByText('ប្រវត្តិជំហាន').waitFor();
  const gLink = await g.page.goto(BASE + '/delivery/#/trip/' + t2).then(() => g.page.getByText('✎ កែម៉ោង').count());
  assert.strictEqual(gLink, 0);
  pass('Security does not get the correct-time button');

  // ---- offline: saved on the phone, sent when back online
  await skew(5 * 60000);
  await g.page.goto(BASE + '/delivery/#/record');
  await g.page.reload();
  await g.page.locator('#plate').click();
  await g.page.getByPlaceholder(/ស្វែងរក/).fill('TEST-0002');
  await g.page.locator('[role=dialog] button', { hasText: 'TEST-0002' }).first().click();
  await g.ctx.setOffline(true);
  await recordBtn(g.page).click();
  await g.page.getByText('រក្សាទុកក្នុងទូរស័ព្ទ').waitFor();
  await g.page.locator('.bar button', { hasText: '⏳1' }).waitFor();
  await g.page.screenshot({ path: SHOTS + '14-offline-saved.png' });
  await g.ctx.setOffline(false);
  await g.page.evaluate(() => dispatchEvent(new Event('online')));
  await g.page.locator('.bar button', { hasText: '⏳' }).waitFor({ state: 'detached', timeout: 15000 });
  const sheet3 = await (await fetch(BASE + '/__sheet')).json();
  assert.ok(sheet3.trips.some(r => r[2] === 'TEST-0002'));
  pass('No signal: Gate In kept on the phone, sent automatically when back online');
  // ---- rented truck with its 3PL company; trucks inside show on the Summary
  await g.page.getByText('កត់ត្រាថ្មី').click();
  await g.page.locator('#plate').click();
  await g.page.getByPlaceholder(/ស្វែងរក/).fill('2B-7777');
  await g.page.getByRole('button', { name: /2B-7777/ }).click();
  await g.page.locator('#co').click();
  await g.page.getByPlaceholder(/ស្វែងរក/).fill('Fast Trans');
  await g.page.getByRole('button', { name: /Fast Trans/ }).click();
  await recordBtn(g.page).click();
  await g.page.getByTestId('new-trip-id').waitFor();
  const sheet5 = await (await fetch(BASE + '/__sheet')).json();
  assert.ok(sheet5.companies.some(r => r[0] === '2B-7777' && r[1] === 'Fast Trans'));
  await g.page.goto(BASE + '/delivery/#/');
  await g.page.getByText('រង់ចាំយូរជាងគេក្នុងរោងចក្រ').waitFor();
  await g.page.screenshot({ path: SHOTS + '14b-ops-waiting.png' });
  pass('Rented truck Gate In saves its 3PL company; trucks inside are listed on the Summary');

  // ---- other screens: history, DN search, more, quality, users; English; dark; desktop
  for (const [hash, file] of [['#/trips', '15-active.png'], ['#/trips/history', '16-history.png'], ['#/dn', '17-dn-search.png'], ['#/more', '18-more.png'], ['#/quality', '19-quality.png'], ['#/users', '20-users.png']]) {
    await a.page.goto(BASE + '/delivery/' + hash);
    await a.page.waitForTimeout(700);
    await a.page.screenshot({ path: SHOTS + file, fullPage: false });
  }
  await a.page.evaluate(() => localStorage.setItem('app_lang', 'en'));
  await a.page.goto(BASE + '/delivery/#/');
  await a.page.reload();
  await a.page.getByText('Trips today').first().waitFor();
  await a.page.screenshot({ path: SHOTS + '21-ops-en.png' });
  await a.page.evaluate(() => localStorage.setItem('fr_theme', 'dark'));
  await a.page.reload();
  await a.page.waitForTimeout(500);
  await a.page.screenshot({ path: SHOTS + '22-ops-dark.png' });
  pass('English switch and dark mode render');
  const desk = await as('admin@test.kh', { viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false, deviceScaleFactor: 1 });
  await desk.page.goto(BASE + '/delivery/');
  await desk.page.waitForTimeout(800);
  await desk.page.screenshot({ path: SHOTS + '23-ops-desktop.png' });
  await desk.page.goto(BASE + '/delivery/#/trip/' + t1);
  await desk.page.waitForTimeout(800);
  await desk.page.screenshot({ path: SHOTS + '24-trip-desktop.png' });
  // header must not overflow at 360px
  const small = await as('admin@test.kh', { viewport: { width: 360, height: 740 } });
  await small.page.goto(BASE + '/delivery/');
  await small.page.waitForTimeout(800);
  const over = await small.page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  assert.strictEqual(over, false);
  await small.page.screenshot({ path: SHOTS + '25-ops-360.png' });
  pass('No sideways scrolling at 360 px');
  await browser.close();
  require('fs').writeFileSync(SHOTS + 'ui-results.txt', results.join('\n') + '\n');
  console.log('ALL DONE', results.length);
})().catch(async e => { console.error('FAIL', e); try { for (const p of (global.PAGES || [])) await p.screenshot({ path: SHOTS + 'fail-' + Math.random().toString(36).slice(2,6) + '.png' }); } catch (x) {} require('fs').writeFileSync(SHOTS + 'ui-results.txt', results.join('\n') + '\nFAIL ' + e.message + '\n'); process.exit(1); });
