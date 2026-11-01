// Agent Data Entry settings. Paste the Apps Script web app URL (ends with /exec) after deploying it
// (see apps-script-dataentry/SETUP.md). While API_URL is empty, reading tickets, the table, the local Excel file
// and Excel download all work; only "Send to Google Sheet" and "Send Excel to Email" wait for it.
window.DE_CONFIG = {
  API_URL: 'https://script.google.com/macros/s/AKfycbzVmO1XAaihD0IXK2TomUiqMTsTf3PoQlxUPun_3lVhykv3ZxtkxB8u0z4vQaHJ-RYWGg/exec',
};
