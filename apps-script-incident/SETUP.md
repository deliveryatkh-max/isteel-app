# Incident Report app (គ្រោះថ្នាក់): setup

Road incidents and warehouse incidents by drivers, and near misses by employees. The reporter fills 5 short steps on
the phone and signs with a finger; the Warehouse Supervisor signs in the app (Telegram brings them there); the signed A4
PDF (Khmer + English headings, photos, both signatures) goes to Telegram and to the admin's email lists.

| Part | Where | What it does |
|---|---|---|
| Web screens (`web/incident/`) | `https://isteel-app.pages.dev/incident/` (the គ្រោះថ្នាក់ tile) | report, sign, send back, actions, PDF, email, summary, settings |
| Apps Script (`Incident.gs`, `appsscript.json`) | bound to a new Google Sheet **SSK-INCIDENT-REPORT** | saves reports, Drive folder per report, PDF, Telegram, email, sign-in check |
| Fuel `apps-script/Code.gs` | the Fuel Apps Script | adds the គ្រោះថ្នាក់ tile and tick box column in Users |

Until step 4 is done the app runs in **DEMO** mode (sample reports kept on the phone, nothing sent).

## One-time steps (Kim)

1. **Google Sheet.** In Drive (deliveryatkh@gmail.com) make a new Google Sheet named `SSK-INCIDENT-REPORT`.
   Extensions → Apps Script. Paste `Incident.gs` from GitHub (replace everything in Code.gs), then
   Project Settings → tick *Show "appsscript.json"* and paste `appsscript.json`.
2. **Script properties** (Project Settings → Script Properties → Add):
   - `GOOGLE_CLIENT_ID`: the same Client ID as the other apps (it is in `web/config.js`).
   - `SESSION_SECRET`: copy it from the **Fuel app's** Apps Script properties (one sign-in for every app). Never paste it in a chat.
   - `USERS_SHEET_ID`: the id of the Fuel Refill Google Sheet (the long part of its address between `/d/` and `/edit`).
   - `TELEGRAM_BOT_TOKEN`: copy it from the Fuel app's Script properties (same bot). Optional, but needed for Telegram.
   - Optional `DELIVERY_SHEET_ID`: the id of SSK-DELIVERY-DATA. Then picking a plate fills the Trip ID, DN and customer from that day's trip.
3. **Run `setup()` once** (choose `setup` → Run → allow). It adds the tabs **Incidents**, **Email Lists**, **Supervisors**,
   **Categories** and **IR Settings**, the Drive folder **Incident Reports**, and the key for the driver link.
4. **Deploy**: Deploy → New deployment → *Web app* → Execute as **Me** → Who has access **Anyone** → Deploy.
   Send the URL ending in `/exec` to Claude in the Incident Report thread (Claude puts it in `web/incident/config.js`).
5. **Home menu tile**: paste the new `apps-script/Code.gs` into the **Fuel** Apps Script and deploy a new version
   (Deploy → Manage deployments → ✎ → New version). The next time the home menu opens, a **គ្រោះថ្នាក់** tick box
   column appears in Users, **ticked for everyone** (anyone can report). Untick it for anyone who should not see the app.
6. **In the app, ⚙️ Settings** (admins only):
   - **Supervisors**: warehouse / branch, name, email, backup email. They sign the reports of their warehouse.
   - **Email lists**: e.g. W&L Management, HSE, Transport / 3PL. For each list choose *Button only*,
     *Auto after sign-off* (gets the PDF as soon as the supervisor signs) or *Auto, HIGH risk only*.
   - **Categories**: add, rename or switch off categories (English + Khmer), and which incident types offer them.
   - **Other**: Telegram chat ID (the Fuel app's `TELEGRAM_CHAT_ID` works) with a *Send a test* button, the report
     number prefix (default `IR` → `IR-2026-001`), and the **driver QR / link** for drivers and 3PL drivers who
     have no account. Print the QR for the gate. *New link* stops old QR codes.

## Who sees what

| Person | Sees | Can do |
|---|---|---|
| Anyone with គ្រោះថ្នាក់ ticked | their own reports | report, edit a report sent back to them, PDF, email a signed report |
| Warehouse Supervisor (Settings → Supervisors) | reports of their warehouse | sign, send back with a note, update actions, close the case |
| Role **reviewer** in Users (e.g. HSE) | every report, Summary | PDF, email |
| Role **admin** in Users | everything | all of the above + Settings |
| Driver link (no sign-in) | only the form | report with name and phone (one report a minute per phone) |

Near misses can be sent **anonymously**: the name is not shown in the app, PDF, Telegram or email and no signature is
needed. The sheet keeps the sender's email in *Reporter Email* so they can find their own report; admins can see it there.

## How a report moves

1. **Waiting supervisor**: the reporter signed and sent it. Telegram posts it with an *Open and sign* button.
2. **Returned**: the supervisor sent it back with a note; the reporter fixes it and signs again (same number).
3. **Signed**: the supervisor signed. The PDF is made and saved in the report's Drive folder, posted to Telegram and
   emailed to the *Auto* lists. **Send by email** in the app sends it to any list or address.
4. **Closed**: every action is Done (or the supervisor/admin closes it anyway).

Each report is one row in the **Incidents** tab (same columns as the Excel Incident Log) and one folder in
**Incident Reports** (report.json, photos, signatures, PDF).

## Limits

- Up to 6 photos per report, shrunk on the phone to 1280 px and stamped with the date and time.
- Gmail sends up to 100 emails a day from a free account.
- Times are Phnom Penh time (Asia/Phnom_Penh).

## Tests

`node apps-script-incident/tests/run.js` (the script with an Apps Script mock).

After a change to `Incident.gs`: paste it, then Deploy → Manage deployments → ✎ → Version: *New version* → Deploy.
