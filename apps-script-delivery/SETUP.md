# Delivery Journey app: setup, deployment and troubleshooting

The app has two parts:

| Part | Where | What it does |
|---|---|---|
| Apps Script (`Logic.gs`, `Delivery.gs`, `appsscript.json`) | bound to the **SSK-DELIVERY-DATA** Google Sheet | the only thing that reads or writes the sheet; checks every request on the server |
| Web screens (`web/delivery/`, built from `delivery-src/`) | `https://isteel-app.pages.dev/delivery/` (the ដឹកជញ្ជូន tile) | phone/desktop screens; holds no secret |

No Google password, API key or secret is in the web files. The browser only sends the signed-in user's Google token
(or the iSteel session token) and the data being recorded; the script checks the user against **User Manager** on every call.

---

## 1. One-time steps (Kim)

1. **Convert the workbook to a Google Sheet.** In Drive open `SSK-DELIVERY-DATA.xlsx` → File → *Save as Google Sheets*.
   This makes a copy; the .xlsx stays as a backup. Nothing in the tabs is changed.
2. **Point AppSheet at the new Google Sheet** (AppSheet editor → Data → each table → *Source* → choose the new Google Sheet),
   so AppSheet and the new app write to the same rows while both are in use.
3. **Add the script.** In the new Google Sheet: Extensions → Apps Script. Create three files and paste the contents from GitHub:
   `Logic.gs`, `Delivery.gs`, and (Project Settings → *Show "appsscript.json"*) `appsscript.json`.
4. **Script properties** (Project Settings → Script Properties → Add):
   - `GOOGLE_CLIENT_ID` = the same Client ID as the Fuel app (it ends in `.apps.googleusercontent.com`; it is also in `web/config.js`).
   - `SESSION_SECRET` = copy the value of `SESSION_SECRET` from the **Fuel app's** Apps Script (Project Settings → Script Properties).
     With the same value, signing in once on the home menu also signs you in to Delivery. Never paste it in a chat or a file.
5. **Run `setup()` once** (choose `setup` in the function list → Run → allow the permissions). It:
   - adds two new tabs, **Trips** and **Audit Log**, after the existing tabs (no existing tab, column or row is touched);
   - creates the Drive folder **Delivery App Photos** and the `LINK_SECRET` used to sign driver links;
   - writes a short report in the log: missing Time Log headers or properties, if any.
6. **Deploy**: Deploy → New deployment → type *Web app* → Execute as **Me** → Who has access **Anyone** → Deploy.
   Copy the URL ending in `/exec` and send it to Claude in the Transport thread (Claude puts it in `delivery-src/public/config.js`
   and rebuilds, so a later build never wipes it). If you prefer to do it yourself, edit `web/delivery/config.js`
   **and** `delivery-src/public/config.js` with the same URL.
7. **Roles**: in **User Manager**, fill the **ROLE** column for each person: `Security`, `Logistics` (or the existing `LT`),
   `Warehouse`, `Driver`, `Supervisor`, `Admin`. Admins can also do this later from the app (More → Users and roles).
8. **Google sign-in origin**: in Google Cloud Console → Credentials → the OAuth Client → *Authorized JavaScript origins*
   must include `https://isteel-app.pages.dev` (already there if the Fuel app signs in from that address).

After a change to `Delivery.gs` or `Logic.gs`: paste the new file, then Deploy → *Manage deployments* → edit (✎) →
Version: *New version* → Deploy. The `/exec` URL stays the same.

## 2. Who can record what

Read live from the **Type Record** tab, column *Allowed Recorders* (so editing that tab changes the app at once):

| Role in User Manager | Steps |
|---|---|
| Security | ១.ចូលថ្លឹង, ៧.ចេញពីកន្លែងថ្លឹង |
| Logistics / LT | ២, ៣ |
| Warehouse | ៤, ៥, ៦ |
| Driver (signed in) or driver link (no sign-in) | ៧ (if allowed), ៨, ៩, x.លុបចោល, x.បរាជ័យ |
| Supervisor, Admin | every step, time corrections, data-quality check |
| Admin | Users and roles |

The *អ្នកកត់ត្រា* value written to Time Log is the matching Type Record group (e.g. `១.សន្តិសុខ`, `៤.ឡាន ISI`).

## 3. Building the web screens (developers)

```
cd delivery-src
npm install
npm run build        # writes web/delivery/ (Cloudflare Pages serves web/ as is)
```

Tests:

```
TZ=Asia/Phnom_Penh node --test apps-script-delivery/tests/      # 19 backend checks with a fake sheet
node delivery-src/tests/server.js &                              # fake sheet + real Delivery.gs on :8765
node delivery-src/tests/ui.test.js                               # 17 screen checks in Chromium (needs Playwright)
```

## 4. Troubleshooting

| What you see | Why | Fix |
|---|---|---|
| "The app is not connected… API_URL is empty" | `/exec` URL not in `delivery/config.js` | step 6 |
| "… is not in User Manager" | email missing from User Manager | add the row with a ROLE (or Admin → Users) |
| "Your role (…) cannot record …" | ROLE empty or not allowed in Type Record | set ROLE; check *Allowed Recorders* |
| Sign-in asked again in Delivery after signing in on home | `SESSION_SECRET` differs from the Fuel script's | copy the same value (step 4) and redeploy |
| "Run setup() once in Apps Script" | `setup()` not run in this script | step 5 |
| "Gate In for … was just recorded" | same truck within 3 minutes | it was already saved; open Active trips |
| ⏳ number in the header | steps saved without signal | they send by themselves; More → *Waiting to send* shows each one and any problem |
| "The sheet changed. Please reload" when correcting a time | rows moved since the screen loaded | Refresh, then correct again |
| Driver link says expired / finished | trip closed, or more than 4 days after Gate In | open the trip in the app and share the new link |
| Photos fail | Drive folder deleted | run `setup()` again (makes a new folder) |

All errors are also in Apps Script → *Executions* with the action name.
