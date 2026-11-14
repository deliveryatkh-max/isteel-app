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
- A count writes one row per SKU line to **Counts** (columns: Count ID, Type, Date, Time, Bin, SKU, Description, Batch No, Sloc, On Hand, OH UoM, Counted Qty Bundle, Counted Qty Kg, Counted Qty Pcs, Remark, Counted By). Rows are matched to columns by header name, so columns can be moved. Optional extra columns the app fills when present: Out Qty, Counted Qty, Diff, Status, Photo, Note. Each count also adds up in **Stock On Hand** for its Bin + Material: Counted Qty Bundle, Counted Qty Kg, Counted Qty Pcs, Total Counted Qty Kg (= Kg total) and Difference (= Total Counted Qty Kg - Book Qty). Book Qty comes from MB52 and is not changed by a count; an Out reduces it. Clear the three Counted cells of a row to start a new count round.
- After changing Code.gs or rules.gs, Deploy > Manage deployments > Edit > New version, so the `/exec` URL keeps working.
- Tests (for developers): `node apps-script-stock-count/tests/run.js`.


## Product Master (14 Nov 2026)

Tab **Product Master**: Material, Description, Pipe Size, Pcs per Bundle, Kg per Pc, Source. Paste `ProductMaster.gs` as one more
script file; the first time the app opens with an empty tab it copies the 426 pipe materials into it. After that edit the tab.
A count in bundles or pieces is turned into kg: Total Counted Qty Kg = Kg + (Bundle x Pcs per Bundle + Pcs) x Kg per Pc.
Difference is in the book unit (kg for KG lines, pieces for the rest). Pcs per Bundle typed in Stock On Hand wins over the master.

## Digital stock card (13 Nov 2026)

- New tab **Stock Ledger** (made by the app on first use): Txn ID, Date, Time, Type, Bin, Material, Description, Batch, SLOC, UoM, In, Out, Balance, Reference, Other Bin, Transfer ID, Remark, User, Request ID. One row per posted movement. The app never edits or deletes a row; a mistake is corrected with a new movement.
- **Book Qty** in Stock On Hand is the running balance of each line. Stock IN adds, Stock OUT subtracts, Transfer moves it to the other bin (a new line is added there when the bin does not hold that material and batch yet).
- Every movement is posted by the server under the script lock, one at a time, so two phones issuing from the same bin end with the right balance. Each form carries a request id: a double tap or a re-send from the offline queue is answered, not posted again.
- Rules (rules.gs `moveOk`, `transferOk`): quantity above 0; whole numbers for lines kept in pieces; Out and Transfer cannot take more than the balance; Stock IN and OUT need a reference document; Transfer needs a different, active destination bin.
- Stock IN of a material the sheet has never seen is allowed for admins only (description and unit required). A known material can be received into any active bin.
- A count does not change the balance. Counts add up in Stock On Hand (Counted columns and Difference) for review.
- Tests: `node apps-script-stock-count/tests/run.js` (rules) and `node apps-script-stock-count/tests/flow.js` (movements against an in-memory sheet).
