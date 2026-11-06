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
**Google's reader** (action `ocr`): each ticket picture is also read by Google Drive OCR (free, uses the script's Drive access; the temporary Doc is deleted at once). When both readers give the same values and the checks pass, the ticket is saved without stopping at step 2 (Settings › ⚡ Save by itself).
The 🔄 button in the header reloads the lists from the sheet.

Gmail sends up to 100 emails a day from a free account.

## Truck Scale (ជញ្ជីងឡាន) — `Scale.gs`, same project (6 Nov 2026)

The scale page (isteel-app.pages.dev/scale/) uses this same Apps Script and the same `/exec` URL.

1. In this Apps Script project: **+ (Add a file) → Script**, name it `Scale`, paste `Scale.gs`. Paste the new `DataEntry.gs` too.
2. **Run `setup()` once** (adds the tabs below, the scale rows in DE Settings, and the 3 truck columns in the Fuel sheet).
3. **Deploy → Manage deployments → ✎ → New version** (the URL stays the same).
4. Paste the new `apps-script/Code.gs` into the **Fuel** Apps Script and deploy a new version: a **ជញ្ជីង** tick box column
   appears in Users. Tick it for the scale operators (admins always have it).
5. On the scale PC: close the old "S3 Smart Weight" program, open the app in **Chrome or Edge**, ⚙ Settings › Scale connection ›
   **Connect scale** and pick the USB serial port. The app remembers the port.

One source for every list (Kim, 6 Nov 2026):
- **Trucks, drivers, truck companies**: Fuel Refill sheet › **Driver & Truck**. The scale adds the columns **Truck Type**,
  **Empty Weight (kg)** and **Max Gross (kg)** at the end. A new plate typed on the scale is added there; an empty
  Empty Weight fills itself from the truck's first finished weigh.
- **Customers**: SSK-DELIVERY-DATA › **Customer** (shared with the Delivery app). Script property `DELIVERY_SHEET_ID` overrides the id.
- **Destinations**: the Destination column of **Price List** in this sheet.
- **Items**: **Item List** in this sheet (Item, Unit, Active).

Tabs added here: **Scale Tickets** (one row per truck: 1st and 2nd weight, gross, tare, net, DN numbers, warnings, PDF link),
**Item List**, **Scale Log** (every new ticket, change, cancel, typed weight and master change, with who, before, after and reason).
DE Settings rows: `SCALE_TARE_PCT` (warning %, default 5), `SCALE_MIN_KG`, `SCALE_PREFIX`, `SCALE_SIGN`, `SCALE_COMPANY`.
Ticket PDFs go to the Drive folder **Scale Tickets PDF**.

### Ticket template in Word (6 Nov 2026)

1. Download the template from https://isteel-app.pages.dev/scale/scale-ticket-template.docx (Settings › Warnings & ticket has the same link).
2. Change it in Word however you like. Keep the `{{...}}` words: each one is swapped for the ticket's value. They are
   `{{TicketNo}} {{Date}} {{TruckNo}} {{Company}} {{Item}} {{Destination}} {{DN}} {{DNCount}} {{Note}} {{Weight1}} {{Time1}} {{Source1}}
   {{Weight2}} {{Time2}} {{Source2}} {{Gross}} {{Tare}} {{Net}} {{Warning}} {{Operator}} {{Status}} {{Printed}} {{CompanyName}} {{Customer}} {{Driver}} {{Type}}`.
   The QR picture must keep its alt text **QR** (right-click › View Alt Text) and stay a PNG.
   Use Google fonts (the template uses Kantumruy Pro); Google can't print other fonts. Avoid text boxes in the footer.
3. Put the file in Google Drive (Word or Google Doc), copy its link, and paste it in the scale app: ⚙ Settings › Warnings & ticket ›
   **Ticket template (Word)**, then Save. Press **Test the template (PDF)** to check it. A folder link also works: the newest file in it is used.
4. From then on, Print and PDF use your template (it needs internet; offline, the standard ticket prints). Edit the Drive file
   any time: the next ticket uses the new version. Clear the link to go back to the standard ticket.
