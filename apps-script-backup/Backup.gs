/**
 * iSteel daily backup (security check, 29 Oct 2026).
 *
 * A stand-alone Apps Script in the deliveryatkh@gmail.com Drive (not inside any sheet). Every night it saves an
 * Excel copy of each app's Google Sheet into Drive > iSteel Backups > YYYY-MM-DD and deletes days older than KEEP_DAYS.
 * Excel copies hold the data only (no Apps Script, no triggers), so they never run anything and can't send Telegram.
 * If a sheet can't be found or saved, an email goes to the account that runs the script.
 *
 * Run once from the editor: setup()  (allow access when Google asks). It makes the folder, sets the nightly
 * trigger and takes the first backup at once. Restore: open the Excel copy in Drive > File > Save as Google Sheets,
 * then copy the tab you need back into the live sheet.
 */

// The sheets to back up, by their exact name in Drive. Add a new app's sheet here.
const SOURCES = [
  'Fuel_Refill_App_Data',   // Fuel, Users list for every app, ads
  'SSK-DELIVERY-DATA',      // Delivery Journey
  'SSK_OT_DATA',            // Overtime
  'SSK-INCIDENT-DATA',      // Incident Report
  'SSK-INBOUND-DATA',       // Inbound
  'SSK-MEETING-MINUTES',    // Meeting Minutes
];
const BACKUP_FOLDER = 'iSteel Backups';
const KEEP_DAYS = 30;
const RUN_HOUR = 1;   // about 1 AM Phnom Penh time

function setup() {
  folder_();
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'backupAll')
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('backupAll').timeBased().everyDays(1).atHour(RUN_HOUR).create();
  backupAll();
}

function backupAll() {
  const tz = Session.getScriptTimeZone() || 'Asia/Phnom_Penh';
  const day = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  const root = folder_();
  const it = root.getFoldersByName(day);
  const dayFolder = it.hasNext() ? it.next() : root.createFolder(day);
  const problems = [], saved = [];

  SOURCES.forEach(name => {
    const files = findSheets_(name, root.getId());
    if (!files.length) { problems.push(name + ': not found in Drive (renamed or deleted?)'); return; }
    files.forEach((f, i) => {
      try {
        const blob = exportXlsx_(f.getId());
        const label = files.length > 1 ? name + ' (' + (i + 1) + ')' : name;
        old_(dayFolder, label + '.xlsx').forEach(x => x.setTrashed(true));   // run twice in a day: keep the newest
        dayFolder.createFile(blob.setName(label + '.xlsx'));
        saved.push(label);
      } catch (e) {
        problems.push(name + ': ' + String(e && e.message || e).slice(0, 200));
      }
    });
  });

  cleanOld_(root, tz);
  console.log('Saved: ' + saved.join(', ') + (problems.length ? '\nProblems:\n' + problems.join('\n') : ''));
  if (problems.length) {
    MailApp.sendEmail(Session.getEffectiveUser().getEmail(), 'iSteel backup ' + day + ': ' + problems.length + ' problem(s)',
      'The nightly backup saved ' + saved.length + ' sheet(s) into Drive > ' + BACKUP_FOLDER + ' > ' + day + '.\n\n' +
      'Problems:\n- ' + problems.join('\n- ') + '\n\nFix the name in SOURCES at the top of the Backup script if a sheet was renamed.');
  }
  return { saved, problems };
}

function folder_() {
  const it = DriveApp.getRootFolder().getFoldersByName(BACKUP_FOLDER);
  return it.hasNext() ? it.next() : DriveApp.getRootFolder().createFolder(BACKUP_FOLDER);
}

// Google Sheets with exactly this name, owned by this account, not in the trash and not inside the backup folder.
function findSheets_(name, backupId) {
  const q = "title = '" + name.replace(/['\\]/g, '\\$&') + "' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false and 'me' in owners";
  const out = [], it = DriveApp.searchFiles(q);
  while (it.hasNext()) {
    const f = it.next();
    const parents = f.getParents();
    let inBackup = false;
    while (parents.hasNext()) if (parents.next().getId() === backupId) inBackup = true;
    if (!inBackup) out.push(f);
  }
  return out;
}

function exportXlsx_(id) {
  const res = UrlFetchApp.fetch('https://docs.google.com/spreadsheets/d/' + id + '/export?format=xlsx', {
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true,
  });
  if (res.getResponseCode() !== 200) throw new Error('export failed (' + res.getResponseCode() + ')');
  return res.getBlob();
}

function old_(folder, name) {
  const out = [], it = folder.getFilesByName(name);
  while (it.hasNext()) out.push(it.next());
  return out;
}

// Day folders (named YYYY-MM-DD) older than KEEP_DAYS go to the Drive trash, where Google keeps them 30 more days.
function cleanOld_(root, tz) {
  const cut = Utilities.formatDate(new Date(Date.now() - KEEP_DAYS * 86400000), tz, 'yyyy-MM-dd');
  const it = root.getFolders();
  while (it.hasNext()) {
    const f = it.next(), n = f.getName();
    if (/^\d{4}-\d{2}-\d{2}$/.test(n) && n < cut) f.setTrashed(true);
  }
}
