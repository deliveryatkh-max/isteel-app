// Browser test of the whole flow with a fake microphone: record, add a photo, create minutes, edit, tick a task,
// email, Word. Needs Playwright. Run: node apps-script-minutes/tests/e2e.js [screenshot folder]
'use strict';
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const assert = require('assert');
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { ({ chromium } = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright')); }

const PORT = 8790, BASE = 'http://localhost:' + PORT;
const OUT = process.argv[2] || '';
const GROQ = process.env.MM_AI === 'groq';   // MM_AI=groq node e2e.js tests the free Groq way
const ROOT = path.join(__dirname, '..', '..');

(async () => {
  const srv = spawn(process.execPath, [path.join(__dirname, 'server.js'), String(PORT)]);
  const token = await new Promise((res, rej) => { srv.stdout.on('data', d => { const m = String(d).match(/TOKEN (\S+)/); if (m) res(m[1]); }); srv.stderr.on('data', d => process.stderr.write(d)); setTimeout(() => rej(new Error('server did not start')), 8000); });
  const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const errors = [];
  const shot = async (page, name) => { if (OUT) await page.screenshot({ path: path.join(OUT, name + '.png'), fullPage: false }); };
  try {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, permissions: ['microphone'], acceptDownloads: true });
    await ctx.addInitScript(tk => { if (!sessionStorage.getItem('init')) { localStorage.setItem('fr_id_token', tk); sessionStorage.setItem('init', '1'); } }, token);
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(String(e)));
    page.on('console', m => { if (m.type() === 'error' && !/favicon|fonts\.g/.test(m.text())) errors.push(m.text()); });
    await page.goto(BASE + '/minutes/');
    await page.waitForSelector('.start.rec');
    await page.waitForFunction(() => /មិនទាន់មានការប្រជុំ/.test(document.querySelector('#list').textContent));
    await shot(page, '1-home');

    // record 3 seconds from the fake microphone
    await page.click('.start.rec');
    await page.waitForSelector('.recording');
    await page.waitForTimeout(3200);
    await shot(page, '2-recording');
    await page.click('#recStop');
    await page.waitForSelector('.fileitem audio');
    const recName = await page.textContent('.fileitem .fn b');
    assert.ok(/^recording-.*\.(webm|ogg|m4a)$/.test(recName), 'recording file ' + recName);

    // a photo of the whiteboard
    await page.setInputFiles('#pickDocs', path.join(ROOT, 'web/icons/app-180.png'));
    await page.waitForSelector('.thumb img');
    await page.fill('#fTitle', 'Weekly W&L');
    await page.fill('#fWho', 'Kim, Dara');
    await page.click('#outChips [data-o="both"]');
    await shot(page, '3-new-filled');
    await page.click('#go');
    await page.waitForSelector('.steps');
    await shot(page, '4-processing');
    await page.waitForFunction(() => /^#\/m\//.test(location.hash), null, { timeout: 30000 });
    await page.waitForSelector('#eTitle');
    assert.strictEqual(await page.inputValue('#eTitle'), 'ប្រជុំប្រចាំសប្តាហ៍');
    await shot(page, '5-review-km');

    // the transcript carried on after the length limit
    await page.click('#paneSeg [data-v="src"]');
    const tr = await page.inputValue('#eTranscript');
    assert.ok(/Today we talk about Gate 2/.test(tr) && /\[05:00\] Dara/.test(tr), 'transcript joined: ' + tr);
    if (GROQ) assert.ok(/^\[00:00\] អរុណសួស្តី។ Today we talk/.test(tr), 'Whisper pieces joined into timed lines: ' + tr);
    await page.click('#paneSeg [data-v="minutes"]');

    // edit the summary in English; it saves by itself
    await page.click('#langSeg [data-v="en"]');
    await page.fill('#eSummary', 'Edited summary.');
    await page.waitForFunction(() => /Saved|បានរក្សាទុក/.test(document.querySelector('#saved').textContent), null, { timeout: 8000 });
    const id = decodeURIComponent((await page.evaluate(() => location.hash)).slice(4));
    let st = await (await fetch(BASE + '/_test')).json();
    const row = st.meetings.find(r => r[0] === id);
    assert.ok(row && row[10] === 'Done', 'meeting saved as Done');
    if (GROQ) {
      assert.strictEqual(st.gemini.uploads, 1, 'only the recording is sent; the photo goes inside the question');
      const ocr = st.gemini.calls.find(c => /Copy all the text/.test(c.body));
      assert.ok(ocr && /data:image\/jpeg;base64,/.test(ocr.body), 'photo sent inside the question');
    } else {
      assert.ok(st.gemini.calls.some(c => /Continue from exactly/.test(c.body)), 'asked the AI to continue');
      assert.ok(st.gemini.calls.filter(c => /up\.fake/.test(c.url)).length === 2, 'two files uploaded');
    }

    // email
    await page.click('#xEmail');
    await page.fill('#mTo', 'team@x.com');
    await shot(page, '6-email');
    await page.click('#mSend');
    await page.waitForSelector('.modal', { state: 'detached' });
    st = await (await fetch(BASE + '/_test')).json();
    assert.strictEqual(st.mails.length, 1);
    assert.ok(st.mails[0].htmlBody.indexOf('Edited summary.') > 0, 'email has the edited summary');

    // Word
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#xWord')]);
    assert.ok(/\.docx$/.test(dl.suggestedFilename()), 'docx ' + dl.suggestedFilename());

    // tasks
    await page.click('.tab[data-r="tasks"]');
    await page.waitForSelector('.tick input');
    await shot(page, '7-tasks');
    await page.locator('.tick input').first().check();
    await page.waitForTimeout(800);
    st = await (await fetch(BASE + '/_test')).json();
    assert.ok(st.actions.some(r => r[0] === id && r[6] === 'Done'), 'task ticked done');

    // home list shows it; English switch
    await page.click('.tab[data-r="home"]');
    await page.waitForSelector('a.item');
    await page.click('#langBtn');
    await page.waitForFunction(() => /All meetings/.test(document.body.textContent));
    await shot(page, '8-home-en');

    // desktop review: transcript left, minutes right
    const desk = await browser.newContext({ viewport: { width: 1440, height: 900 }, storageState: await ctx.storageState() });
    const dp = await desk.newPage();
    dp.on('pageerror', e => errors.push(String(e)));
    await dp.goto(BASE + '/minutes/#/m/' + encodeURIComponent(id));
    await dp.waitForSelector('.split .left #eTranscript');
    await dp.waitForSelector('.split .right #eTitle');
    await shot(dp, '9-desktop');
    assert.deepStrictEqual(errors, [], 'no page errors');
    console.log('e2e passed');
  } finally {
    await browser.close();
    srv.kill();
  }
})().catch(e => { console.error(e); process.exit(1); });
