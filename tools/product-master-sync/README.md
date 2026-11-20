# Product Master sync (Stock Count)

Kim, 20 Nov 2026: the Stock Count app reads the Product Master from the Excel file in OneDrive
`00. Data Warehouse\Master Data (All)\Product Master\Product Master (in use)`, sheet **Product Master**,
so it no longer has to be typed into the Google Sheet.

- `sync-product-master.ps1` reads the newest `ISI Steel - Master Data - Product - *.xlsx` (a file with "Final" in its name wins) with Excel and posts it to the Stock Count Apps Script (`action: pmSync`). It only sends when the file changed. The result is written to `sync-log.txt`.
- The Apps Script replaces the **Product Master** tab. Kg/PC and UoM are not in the Excel yet, so the values already in the tab are kept for each material. A `Kg/PC` or `UoM` column in the Excel wins once it is added.
- `install.cmd` creates the hourly Windows task "iSteel Product Master Sync" and sends once at once.
- `sync-key.txt` (not in git) holds the key. The same value goes in the Apps Script **Script properties** as `PM_SYNC_KEY`.
