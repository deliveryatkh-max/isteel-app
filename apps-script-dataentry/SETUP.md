# Agent Data Entry (បញ្ចូលទិន្នន័យ): setup

Turns a weighing ticket (photo, scan, screenshot or PDF) into one Excel row. Kim's design, 31 Oct 2026:
**1 Upload** → **2 Review & Edit** → **3 Save Data to Table / Send to Google Sheet / Save to Local File / Send Excel to Email**.

| Part | Where | What it does |
|---|---|---|
| Web app (`web/dataentry/`) | `https://isteel-app.pages.dev/dataentry/` (the បញ្ចូលទិន្នន័យ tile) | Reads the ticket, review form, table, report, local Excel file |
| Reader (`web/dataentry/ticket-ocr.js` + `web/vendor/tesseract/`) | runs inside the browser | Free Tesseract text reading. No AI service, no API key, nothing to pay |
| Apps Script (`DataEntry.gs`, `appsscript.json`) | bound to a new Google Sheet **SSK-WEIGHT-SCALE-DATA** | Google Sheet rows, ticket pictures in Drive, email with the Excel file |
| Fuel `apps-script/Code.gs` | the Fuel Apps Script | adds the បញ្ចូលទិន្នន័យ tile and tick box column in Users |

Reading, the table, the report, Download Excel and **Save to Local File** work without the Apps Script.
Only **Send to Google Sheet** and **Send Excel to Email** wait for steps 1 to 5.

## What it reads

The 8 yellow fields of the ISI STEEL weighing ticket (ប័ណ្ណថ្លឹង): Date, Vehicle No, Ticket No, Gross, Tare, Net,
In Date/Time, Out Date/Time. Total Time = Out − In. The app checks that Gross − Tare = Net and that Out is after In.
It finds the printed English words on the ticket (WEIGHING TICKET, (Product), (Customer), (Date/Time), (Price),
(Amount), (Type, Operator) to know where each box is, so the ticket can be anywhere on the page and any size.
Clear scans and PDFs read best; blurred or tilted phone photos may need typing. Every value can be corrected before saving.

## Save to Local File (OneDrive folder)

Works in **Chrome or Edge on a computer**. The first time, the app asks for a folder: choose
`OneDrive - ISI GROUP\01. ISI STEEL-WH&LOG\00. Data Warehouse\Weight Scale Data` and allow **Edit files**.
The app remembers it (Settings shows the folder). Tickets go into `Weight_Scale_Data.xlsx` (name can be changed in
Settings), sheet **Weighing Tickets**; a ticket number already in the file replaces its row. If the file is open in
Excel, close it first. Other browsers download the Excel file instead.

## One-time steps (Kim) for Google Sheet and email

1. **Google Sheet.** In Drive (deliveryatkh@gmail.com) make a new Google Sheet named `SSK-WEIGHT-SCALE-DATA`.
   Extensions → Apps Script. Paste `DataEntry.gs` from GitHub (replace everything in Code.gs), then
   Project Settings → tick *Show "appsscript.json"* and paste `appsscript.json`.
2. **Script properties** (Project Settings → Script Properties → Add):
   - `GOOGLE_CLIENT_ID`: the same Client ID as the other apps (it is in `web/config.js`).
   - `SESSION_SECRET`: copy it from the **Fuel app's** Apps Script properties (one sign-in for every app). Never paste it in a chat.
   - `USERS_SHEET_ID`: the id of the Fuel Refill Google Sheet (`1lbQ7Ybq6o61tldUhf3ITxweqK3SotCOtr-kA7oa0VqU`).
3. **Run `setup()` once**, then **run `authorize()` once** (choose it → Run → allow; this is what asks for email permission).
   Setup adds the tabs **Weighing Tickets**, **DE Settings**, **Price List**, **GL Code**, **Cost Center** and **Debit Notes**, and the Drive folder **Weighing Ticket Images**.
4. **Deploy**: Deploy → New deployment → *Web app* → Execute as **Me** → Who has access **Anyone** → Deploy.
   Send the URL ending in `/exec` to Claude in the Data Entry Agent thread (Claude puts it in `web/dataentry/config.js`).
5. **Home menu tile**: paste the new `apps-script/Code.gs` into the **Fuel** Apps Script and deploy a new version
   (Deploy → Manage deployments → ✎ → New version). The next time the home menu opens, a **បញ្ចូលទិន្នន័យ** tick box
   column appears in Users, **unticked**. Tick it for the people who enter weighing tickets (admins always see it).

## Sheet tabs

- **Weighing Tickets**: Ticket No, Vehicle No, Company (looked up from the Fuel sheet "Driver & Truck": plate in column G, company in column E; an exact plate match wins, else the plate without dashes), Document Date, Gross, Tare, Net, In / Out Date/Time, Total Time (min and h:mm),
  Check (OK, or the Gross − Tare difference), Source File, Picture (Drive link), Entered By, Entered At, Updated.
- **DE Settings**: `EMAIL_TO` default email list, `EMAIL_SUBJECT`.
- **Price List**: 3PL Company, Destination, Charge Per (Charge per t / Charge per trip), Price, UoM. The Debit Note takes its prices from here.
- **GL Code** and **Cost Center**: Code, Description. They fill the GL and Cost Center dropdowns on the Debit Note.
- **Debit Notes**: one row per Debit Note downloaded. The No runs in sequence per destination and month
  (`KPC-MT-10-26-01`, `-02` …); the next number is the last one here + 1.

Saved tickets go to the Google Sheet by themselves (right after Save, and again every minute while unsent ones wait).
The 🔄 button in the header reloads the lists from the sheet.

Gmail sends up to 100 emails a day from a free account.
