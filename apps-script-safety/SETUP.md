# Safety Walk & 5S app (សុវត្ថិភាព): setup

Safety walks, 5S audits and forklift checks on the phone. The walker picks an area and a checklist and answers
Yes / No / N/A. Every **No** becomes an action with a photo, an owner and a due date. A critical No goes to Telegram at
once. The owner marks the action Done with an after photo; the walker (or a reviewer / safety officer) closes it.

| Part | Where | What it does |
|---|---|---|
| Web screens (`web/safety/`) | `https://isteel-app.pages.dev/safety/` (the 🦺 tile) | walk, actions, scores, settings |
| Apps Script (`Safety.gs`, `appsscript.json`) | bound to a new Google Sheet **SSK-SAFETY-WALK** | saves walks, photos in Drive, PDF, Telegram, sign-in check |
| Fuel `apps-script/Code.gs` | the Fuel Apps Script | adds the tile and the **សុវត្ថិភាព** tick box column |
| `web/safety/defaults.json` | | the starting checklists (12 + 15 + 10 questions) and example areas, copied once by `setup()` |

Until step 4 is done the app runs in **DEMO** mode (sample walks kept on the phone, nothing sent).

## One-time steps (Kim)

1. **Google Sheet.** In Drive (deliveryatkh@gmail.com) make a new Google Sheet named `SSK-SAFETY-WALK`.
   Extensions → Apps Script. Paste `Safety.gs` from GitHub (replace everything in Code.gs), then
   Project Settings → tick *Show "appsscript.json"* and paste `appsscript.json`.
2. **Script properties** (Project Settings → Script Properties → Add):
   - `GOOGLE_CLIENT_ID`: the same Client ID as the other apps (it is in `web/config.js`).
   - `SESSION_SECRET`: copy it from the **Fuel app's** Apps Script properties (one sign-in for every app). Never paste it in a chat.
   - `USERS_SHEET_ID`: the id of the Fuel Refill Google Sheet (the long part of its address between `/d/` and `/edit`).
   - `TELEGRAM_BOT_TOKEN`: copy it from the Fuel app's Script properties (same bot). Optional, but needed for Telegram.
3. **Run `setup()` once** (choose `setup` → Run → allow). It adds the tabs **Walks**, **Actions**, **Answers**, **Areas**,
   **Checklists** and **SW Settings**, the Drive folder **Safety Walk Photos**, and two triggers: the overdue list every
   morning at 08:00 and the summary every Monday at 08:00.
4. **Deploy**: Deploy → New deployment → *Web app* → Execute as **Me** → Who has access **Anyone** → Deploy.
   Send the URL ending in `/exec` to Claude in the Safety Walk thread (Claude puts it in `web/safety/config.js`).
5. **Home menu tile**: paste the new `apps-script/Code.gs` into the **Fuel** Apps Script and deploy a new version.
   A **សុវត្ថិភាព** tick box column appears in Employee & Approver / Users, **not ticked** for anyone. Tick it for the
   walkers, area leaders and the safety officer (admins always see the app).
6. **Telegram**: make a group "ISI Safety", add the bot, and type the group's chat id in the app's ⚙️ Settings, then
   *Send a test*.
7. **In the app, ⚙️ Settings** (admins only): fix the **Areas** (site, area, area leader by name or Employee ID, and how
   often each checklist is due: Daily / Weekly / Monthly) and the **Checklists** (English, Khmer, Critical, Photo needed).
   The areas from setup are only examples.

## Who sees what

| Person | Sees | Can do |
|---|---|---|
| Anyone with សុវត្ថិភាព ticked | their own walks and the actions they raised or own | walk, mark their actions done |
| Area leader (Areas tab) | walks and actions of their area | mark actions done, change owner / due date |
| Action owner without the tick | only their own actions | mark them done with an after photo |
| Role **reviewer** (or a role with "safety") in Users | everything, Scores | close, reopen, change owner / due date |
| Role **admin** | everything | all of the above + Settings |

## How it works

- **Score** = Yes ÷ (Yes + No). N/A does not count.
- **A No** needs a photo (unless *Photo on No* = N for that question), who fixes it, and a due date: 7 days, or 24 hours
  for a critical question (change both in Settings).
- **Offline**: a finished walk is kept on the phone and sent in the background, so nobody waits and nothing is lost
  without signal. A walk in progress is kept on the phone too.
- **Late areas**: an area is late when its last check of a checklist is older than its frequency.
- **PDF** per walk with the ISI STEEL logo, answers, actions and photos (📄 PDF on a walk). Saved in the month folder.
- **Telegram**: critical No at once (with the photo); overdue actions and late areas every morning; the week's scores
  every Monday. Each can be switched off in Settings.
- **Safety Dashboard** in Dashboards opens the app's Scores screen.

## Limits

- Up to 3 photos per No, shrunk on the phone to 1280 px and stamped with the date and time.
- The phone shows the last 120 days of walks; the sheet keeps everything.
- Times are Phnom Penh time (Asia/Phnom_Penh).

## Tests

`node apps-script-safety/tests/run.js` (the script with an Apps Script mock).

After a change to `Safety.gs`: paste it, then Deploy → Manage deployments → ✎ → Version: *New version* → Deploy.
