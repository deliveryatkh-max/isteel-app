# Inbound app (ទទួលទំនិញ): setup

Goods receipt log for trucks arriving at the warehouse. At arrival the receiver picks a pending PO from the Incoming
Plan, ticks the items on the truck, types the Arrival Qty, the truck number and the 3PL DN number and takes 3 photos
(truck front with plate, full load, packing list); the start time is stamped. At the finish they type the Actual GR
Qty and Damaged Qty per item (damage type + up to 6 photos when damaged), truck owner and manpower; the end time,
time spent and productivity are worked out. Telegram posts each arriving truck and each receipt with damage or short qty.

| Part | Where | What it does |
|---|---|---|
| Web screens (`web/inbound/`) | `https://isteel-app.pages.dev/inbound/` (the ទទួលទំនិញ tile) | Today (trucks unloading), Log, Summary, arrival and finish forms |
| Apps Script (`Inbound.gs`, `appsscript.json`) | bound to a new Google Sheet **SSK-INBOUND-DATA** | Incoming Plan, GR Log, photos in Drive, Telegram, sign-in check |
| Fuel `apps-script/Code.gs` | the Fuel Apps Script | adds the ទទួលទំនិញ tile and tick box column in Users |

Until step 5 is done the app runs in **DEMO** mode (sample POs and receipts kept on the phone, nothing sent).

## One-time steps (Kim)

1. **Google Sheet.** In Drive (deliveryatkh@gmail.com) make a new Google Sheet named `SSK-INBOUND-DATA`.
   Extensions → Apps Script. Paste `Inbound.gs` from GitHub (replace everything in Code.gs), then
   Project Settings → tick *Show "appsscript.json"* and paste `appsscript.json`.
2. **Script properties** (Project Settings → Script Properties → Add):
   - `GOOGLE_CLIENT_ID`: the same Client ID as the other apps (it is in `web/config.js`).
   - `SESSION_SECRET`: copy it from the **Fuel app's** Apps Script properties (one sign-in for every app). Never paste it in a chat.
   - `USERS_SHEET_ID`: the id of the Fuel Refill Google Sheet (the long part of its address between `/d/` and `/edit`).
   - `TELEGRAM_BOT_TOKEN`: copy it from the Fuel app's Script properties (same bot). Optional, but needed for Telegram.
3. **Run `setup()` once** (choose `setup` → Run → allow). It adds the tabs **Incoming Plan**, **GR Log**, **Receipts**
   and **IB Settings**, and the Drive folder **Inbound Photos**.
4. **Incoming Plan.** Supervisors and admins (role reviewer or admin in Users) fill it from the app: Inbound → 📑 Incoming
   Plan → *Upload Excel packing list* (Kim's template, sheet PKL) or *Add a PO by hand*. Uploading a PO again replaces its
   lines; lines already received stay. A PO can be deleted only while no truck was received on it. Pasting rows straight
   into the **Incoming Plan** tab still works. A PO shows in *Receive goods* while some of its Kg is not yet received.
5. **IB Settings tab**: put the Telegram group id in `TELEGRAM_CHAT_ID` (the Fuel app's `TELEGRAM_CHAT_ID` works),
   check the 3PL company list.
6. **Deploy**: Deploy → New deployment → *Web app* → Execute as **Me** → Who has access **Anyone** → Deploy.
   Send the URL ending in `/exec` to Claude in the Inbound thread (Claude puts it in `web/inbound/config.js`).
7. **Home menu tile**: paste the new `apps-script/Code.gs` into the **Fuel** Apps Script and deploy a new version
   (Deploy → Manage deployments → ✎ → New version). The next time the home menu opens, a **ទទួលទំនិញ** tick box
   column appears in Users, **unticked**. Tick it for the warehouse staff who receive goods (admins always see it).

## PDF report and email

After a truck is finished, its receipt screen shows **📄 Generate Report (PDF)** (one A4 page: details, items, times,
truck and damage photos; saved as `<receipt id>.pdf` in the receipt's photo folder and made again only when the receipt
changes) and **✉️ Send Email** (tick lists from the **Email Lists** tab and/or type addresses; the PDF is attached).
Fill the **Email Lists** tab: *List* (name shown in the app), *Emails* (comma separated), *Active* (Yes/No). The first
time after this update, paste the new `Inbound.gs` + `appsscript.json`, deploy a **New version** and allow the new
permissions (Google Docs to make the PDF, send email as you). Gmail sends up to 100 emails a day from a free account.
A free Gmail always shows its address as the sender. To send from `noreply@<your domain>` instead, the sheet and script must be
owned by a Google Workspace account (paid): move them to that account, deploy from it, and set `EMAIL_NO_REPLY` to `Yes` in
**IB Settings** (add the row if it is missing).

### Report layout (Word template)

The PDF is filled from a Word template, like the Incident report. The standard one is `web/inbound/ib-template.docx`
(also in `apps-script-inbound/templates/`). Put the Drive link of a Word file, a Google Doc or a folder in **IB Settings →
PDF_TEMPLATE_LINK**; with a folder, the newest Word file / Doc in it is used, and an empty folder gets a copy of the
standard template. Edit it in Word, keep the `{{...}}` words, upload it again and the next report uses it (saved PDFs are
made again). The row holding `{{item.material}}` repeats once per item. Placeholders: `{{id}} {{date}} {{status}} {{po}}
{{inbound}} {{ref}} {{supplier}} {{eta}} {{dn3pl}} {{truck}} {{owner}} {{itemCount}} {{item.no}} {{item.material}}
{{item.poQty}} {{item.arrQty}} {{item.grQty}} {{item.dmgQty}} {{item.uom}} {{totPo}} {{totArr}} {{totGr}} {{totDmg}} {{uom}}
{{start}} {{end}} {{spent}} {{manpower}} {{productivity}} {{remark}} {{truckPhotos}} {{damagePhotos}} {{by}} {{finishedBy}}`.
Google can only print Google fonts, so the text is set in **PDF_FONT** (Kantumruy Pro; `-` keeps the template's fonts).
If the template fails, the built-in layout is used and the reason is written in **PDF_TEMPLATE_ERROR**.

## Sheet tabs

- **Incoming Plan**: the packing lists (one row per PO line). Kim keeps it filled.
- **GR Log**: one row per item per truck, the same columns as the GOODS RECEIPT LOG template plus Material, Arrival
  Qty, Damaged Qty, Damage Type, Received Less, 3PL DN and the photos folder link. Written by the app; don't edit by hand.
- **Receipts**: one row per truck (the app's own copy). Don't edit.
- **IB Settings**: Telegram chat, app address, 3PL companies, days of receipts the app loads.
- **Email Lists**: named email lists for the Send Email button.

## Who can do what

| Person | Can do |
|---|---|
| ទទួលទំនិញ ticked | record arrivals, finish any truck still unloading, edit their own finished receipts |
| Role **admin** in Users, or **reviewer** with ទទួលទំនិញ ticked | all of the above + edit any finished receipt |

## Limits

- Photos are shrunk on the phone to 1280 px before sending.
- Productivity = tonnes received ÷ hours ÷ manpower.
- Times are Phnom Penh time (Asia/Phnom_Penh).
