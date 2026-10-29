# iSteel daily backup: setup

Every night at about 1 AM an Excel copy of each app's Google Sheet is saved into **Drive > iSteel Backups > YYYY-MM-DD**.
The last 30 days are kept; older days go to the Drive trash. If a sheet can't be found or saved, you get an email.

Sheets backed up (by their name in Drive): Fuel_Refill_App_Data, SSK-DELIVERY-DATA, SSK_OT_DATA, SSK-INCIDENT-DATA,
SSK-INBOUND-DATA, SSK-MEETING-MINUTES. Add a new app's sheet to `SOURCES` at the top of `Backup.gs`.

The Excel copies hold the data only (no Apps Script, no triggers), so a backup never sends Telegram messages or emails.
Photos and PDFs already live as files in Drive folders, and deleted files stay 30 days in the Drive trash.

## One-time steps (Kim)

1. Signed in as **deliveryatkh@gmail.com**, open https://script.google.com and click **New project**. Name it `iSteel Backup`.
2. Paste `Backup.gs` from GitHub (replace everything in Code.gs). Project Settings → tick *Show "appsscript.json"*,
   open `appsscript.json` and paste the one from GitHub.
3. Choose **setup** at the top → **Run** → allow access. It makes the folder, sets the nightly timer and saves the first
   backup at once (about a minute).
4. Check Drive: **iSteel Backups > today's date** should hold 6 Excel files.

## Restore

Open the Excel file in Drive → **File → Save as Google Sheets**. Copy the tab or rows you need back into the live sheet.
Don't replace the whole live sheet: its Apps Script and web address stay with the live one.
