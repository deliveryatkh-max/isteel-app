// Inbound (goods receipt) settings. Paste the Inbound Apps Script web app URL (ends with /exec) after deploying it (see apps-script-inbound/SETUP.md).
// While API_URL is empty the app runs in DEMO mode: sample receipts, nothing is saved to the Google Sheet.
window.IB_CONFIG = {
  API_URL: 'https://script.google.com/macros/s/AKfycbw1koBxjhGoLEAA-Ney3u7O-ExuTr8SEws7vThtWDVe3VjJth_JsfFlOl9mLSnrpUNPXQ/exec',
};
