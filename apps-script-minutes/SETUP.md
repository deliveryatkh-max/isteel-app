# Meeting Minutes app (ប្រជុំ): setup

The app has three parts:

| Part | Where | What it does |
|---|---|---|
| Web screens (`web/minutes/`) | `https://isteel-app.pages.dev/minutes/` (the ប្រជុំ tile) | record, upload, review, edit, email, Word |
| Apps Script (`Minutes.gs`, `appsscript.json`) | bound to a new Google Sheet **SSK-MEETING-MINUTES** | saves meetings and action items, Drive folder, Google Doc / Word, email, sign-in check |
| AI relay (`functions/mm/[action].js`) | Cloudflare Pages Function at `/mm/upload` and `/mm/generate` | holds the Gemini key; turns speech and photos into text and writes the minutes |

Until step 5 is done the app runs in **DEMO** mode (sample data, nothing saved).

## Why Gemini

Claude cannot listen to audio, and Khmer speech-to-text is weak in most services. Google Gemini reads Khmer and
English audio (mixed in one sentence too), photos, handwriting and PDFs with one key, and it is cheap. The relay
picks the newest stable "flash" model by itself. Rough cost on the paid plan: about US$0.20 to 0.50 per hour of
meeting (estimate). The free plan works for trying it out, but Google may use free-plan data to improve its
products, so turn on billing before real company meetings.

## One-time steps (Kim)

1. **Google Sheet.** In Drive (deliveryatkh@gmail.com) make a new Google Sheet named `SSK-MEETING-MINUTES`.
   Extensions → Apps Script. Paste `Minutes.gs` from GitHub (replace everything in Code.gs), then
   Project Settings → tick *Show "appsscript.json"* and paste `appsscript.json`.
2. **Script properties** (Project Settings → Script Properties → Add):
   - `GOOGLE_CLIENT_ID`: the same Client ID as the other apps (it is in `web/config.js`).
   - `SESSION_SECRET`: copy it from the **Fuel app's** Apps Script properties (one sign-in for every app). Never paste it in a chat.
   - `USERS_SHEET_ID`: the id of the Fuel Refill Google Sheet (the long part of its address between `/d/` and `/edit`).
   - Optional `MM_TEMPLATE_DOC_ID`: a Google Doc with the company letterhead (logo, header, footer). Every Word file starts from a copy of it.
3. **Run `setup()` once** (choose `setup` → Run → allow). It adds the **Meetings** and **Actions** tabs, the Drive
   folder **Meeting Minutes**, and a new `MM_SECRET` in Script properties.
4. **Deploy**: Deploy → New deployment → *Web app* → Execute as **Me** → Who has access **Anyone** → Deploy.
   Send the URL ending in `/exec` to Claude in the Meeting Minute Assistant thread (Claude puts it in `web/minutes/config.js`).
5. **Gemini key**: open https://aistudio.google.com/apikey with deliveryatkh@gmail.com → *Create API key*. Keep it secret.
6. **Cloudflare**: dash.cloudflare.com → Workers & Pages → **isteel-app** → Settings → Variables and Secrets → Add,
   type **Secret**, for Production:
   - `GEMINI_API_KEY` = the key from step 5
   - `MM_SECRET` = the value `setup()` made in Script properties (step 3)
   Then Deployments → the latest one → ⋯ → *Retry deployment* (secrets only reach the site on the next deployment).
   Check: `https://isteel-app.pages.dev/mm/ping` shows `{"ok":true,"ai":true,"ticket":true}`.
7. **Home menu tile**: paste the new `apps-script/Code.gs` into the **Fuel** Apps Script and deploy a new version
   (Deploy → Manage deployments → ✎ → New version). A **ប្រជុំ** tick box column appears in Users. Admins see the
   tile at once; tick ប្រជុំ for anyone else who should use it.

## How it works

1. A person records (phone or computer microphone; on a computer also a Zoom/Teams/Meet tab "with audio"), or
   picks audio/video files, and adds photos or PDFs. Every 10 seconds of a recording is kept on the phone, so a
   closed tab does not lose the meeting; the home screen offers to continue it.
2. **Create minutes**: the meeting row is saved (status Processing), the files go to Gemini through the relay
   (kept by Google for 48 hours only), the speech is written out word for word (long meetings are done in
   several parts by themselves), photos and PDFs are read, and the minutes are written in Khmer, English or both
   (both at the same time). Photos and PDFs are also kept in the meeting's Drive folder; recordings stay on the phone
   (the ⬇️ button saves one as a file).
3. The minutes open in an editor (phone: Minutes / Source text tabs; computer: transcript on the left, minutes on the right).
   Changes save by themselves. "Rewrite the minutes from this text" runs the AI again after the transcript is fixed.
4. **Email** sends a formatted email with the Word file attached, from the deploying account, with replies going to
   the sender. **Word** makes a Google Doc in the meeting folder and downloads it as .docx. **Copy** gives plain text for Telegram.
5. **Tasks** lists every open action item from every meeting; ticking one marks it Done in the Actions tab.

Everyone with ប្រជុំ ticked sees all meetings. Only the person who made a meeting, or an admin, can delete it
(its Drive folder goes to the bin for 30 days).

## Limits

- Files up to 95 MB each. For a long video, export the audio only (Zoom saves an .m4a next to the video).
- Gmail sends up to 100 emails a day from a free account.
- Apps Script and Gemini both work in Phnom Penh time (Asia/Phnom_Penh).

## Tests

`node apps-script-minutes/tests/run.js` (script + relay) and `node apps-script-minutes/tests/e2e.js` (full flow in a
browser with a fake microphone and a fake Gemini; needs Playwright).

After a change to `Minutes.gs`: paste it, then Deploy → Manage deployments → ✎ → Version: *New version* → Deploy.
