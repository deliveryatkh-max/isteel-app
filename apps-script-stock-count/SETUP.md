# Stock Count: one-time setup

Kim does these steps once. Nothing here is secret in chat: paste the values from the Fuel app's Script properties directly.

1. **Create the Google Sheet** named `SSK-STOCK-COUNT` (sheets.google.com, in the team Drive).
2. **Open Apps Script:** Extensions > Apps Script (inside that sheet).
3. **Paste the code:** replace the default code with `Code.gs`, add `rules.gs` (File > New > Script file, name it `rules`), and replace `appsscript.json` (Project Settings > show manifest). Save.
4. **Script properties** (Project Settings > Script properties):
   - `GOOGLE_CLIENT_ID`: the same Client ID as the other iSteel apps (`web/config.js`).
   - `SESSION_SECRET`: copy the Fuel app's value, so one sign-in works everywhere.
   - `USERS_SHEET_ID`: the same Fuel Refill sheet id as the Inbound app. Its Users tab is the one user list.
5. **Run `setup()`** from the editor (choose `setup`, press Run, allow the permissions). It creates the tabs, the Drive folder "Stock Count Photos", and the Settings values. Run `authorize()` too if asked for Drive permission.
6. **Fill the tabs:**
   - **Bin Master:** bin master data only. One row per bin: Bin, Warehouse, Active (Yes/No). The last two columns are filled by the app.
   - **Stock On Hand:** what is in each bin, from MB52: Bin, Material, Description, Batch, SLOC, UoM, Pcs per Bundle, Book Qty. One row per material + batch + SLOC in the bin. A count or Out updates Book Qty here right away.
   - **Users (Fuel Refill sheet):** tick ការរាប់ស្តុក for each counter. Nothing is added on a second list.
7. **Deploy:** Deploy > New deployment > Web app, Execute as: Me, Who has access: Anyone. Copy the URL that ends with `/exec`.
8. **Give the URL to Claude** (or paste it into `web/stock-count/config.js` as `API_URL`). Until then the app runs in demo mode and saves nothing.

Notes:
- Book Qty is not changed by a count. A count writes a row to **Counts** and the bin's last count date, last counted qty and last status to **Bin Master**. Adjust Book Qty when the stock card is corrected.
- After changing Code.gs or rules.gs, Deploy > Manage deployments > Edit > New version, so the `/exec` URL keeps working.
- Tests (for developers): `node apps-script-stock-count/tests/run.js`.
