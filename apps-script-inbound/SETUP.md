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
4. **Incoming Plan.** Paste the rows of the Incoming Packing List (sheet PKL) under the headings of the **Incoming Plan**
   tab: No, Material, Description, Plant, SLOC, Kg, t, PCS, Remark, No. of Truck, PO Number, Inbound No., Ref. No, ETA,
   Supplier. Add new POs the same way whenever a packing list comes. A PO shows in the app while some of its Kg is not
   yet received.
5. **IB Settings tab**: put the Telegram group id in `TELEGRAM_CHAT_ID` (the Fuel app's `TELEGRAM_CHAT_ID` works),
   check the 3PL company list.
6. **Deploy**: Deploy → New deployment → *Web app* → Execute as **Me** → Who has access **Anyone** → Deploy.
   Send the URL ending in `/exec` to Claude in the Inbound thread (Claude puts it in `web/inbound/config.js`).
7. **Home menu tile**: paste the new `apps-script/Code.gs` into the **Fuel** Apps Script and deploy a new version
   (Deploy → Manage deployments → ✎ → New version). The next time the home menu opens, a **ទទួលទំនិញ** tick box
   column appears in Users, **unticked**. Tick it for the warehouse staff who receive goods (admins always see it).

## Sheet tabs

- **Incoming Plan**: the packing lists (one row per PO line). Kim keeps it filled.
- **GR Log**: one row per item per truck, the same columns as the GOODS RECEIPT LOG template plus Material, Arrival
  Qty, Damaged Qty, Damage Type, Received Less, 3PL DN and the photos folder link. Written by the app; don't edit by hand.
- **Receipts**: one row per truck (the app's own copy). Don't edit.
- **IB Settings**: Telegram chat, app address, 3PL companies, days of receipts the app loads.

## Who can do what

| Person | Can do |
|---|---|
| ទទួលទំនិញ ticked | record arrivals, finish any truck still unloading, edit their own finished receipts |
| Role **admin** in Users, or **reviewer** with ទទួលទំនិញ ticked | all of the above + edit any finished receipt |

## Limits

- Photos are shrunk on the phone to 1280 px before sending.
- Productivity = tonnes received ÷ hours ÷ manpower.
- Times are Phnom Penh time (Asia/Phnom_Penh).
