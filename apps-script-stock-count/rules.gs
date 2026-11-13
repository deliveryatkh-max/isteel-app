/**
 * Stock Count rules: pure functions, no Apps Script calls.
 * Used by Code.gs in Apps Script and by apps-script-stock-count/tests/run.js in Node.
 * web/stock-count/sc.js keeps a copy of countedPcs / statusOf / needsPhoto / comparable (same logic).
 */

// Counted pieces = bundles x pieces per bundle (bin master) + loose pieces.
function countedPcs(bundles, pcsPerBundle, pieces) {
  return (Number(bundles) || 0) * (Number(pcsPerBundle) || 1) + (Number(pieces) || 0);
}

// MATCH when the difference is within tolerance, otherwise SHORT (less than book) or OVER (more than book).
function statusOf(diff, tolerance) {
  if (Math.abs(diff) <= (Number(tolerance) || 0)) return 'MATCH';
  return diff < 0 ? 'SHORT' : 'OVER';
}

// A mismatch needs a photo of the bin before it is saved.
function needsPhoto(status) {
  return status === 'SHORT' || status === 'OVER';
}

// Bundle and Pcs are whole numbers, Kg can have decimals; blank = 0; at least one must be filled. Returns '' when valid.
function validateCount(c) {
  const n = v => (v === '' || v == null ? 0 : Number(v));
  const whole = v => isFinite(n(v)) && n(v) >= 0 && Math.floor(n(v)) === n(v);
  if (!whole(c.bundles) || !whole(c.pieces)) return 'Enter Bundle and Pcs as whole numbers (0 or blank is allowed).';
  if (!isFinite(n(c.kg)) || n(c.kg) < 0) return 'Enter Kg as a number.';
  if (c.bundles === '' && c.kg === '' && c.pieces === '') return 'Fill Bundle, Kg or Pcs for every line.';
  return '';
}

// Counted qty in the book unit: Kg when the line is kept in KG, otherwise bundles x pcs per bundle + pcs.
function countedQty(c, uom, pcsPerBundle) {
  const n = v => (v === '' || v == null ? 0 : Number(v)) || 0;
  if (/^(kg|kgs|ton|t)$/i.test(String(uom || '').trim())) return n(c.kg);
  return countedPcs(n(c.bundles), pcsPerBundle, n(c.pieces));
}

// A count can be compared with the book only when the box in the book unit is filled:
// Kg for a KG line, Bundle or Pcs for a line kept in pieces. Otherwise the count is only recorded.
function comparable(c, uom) {
  const has = v => !(v === '' || v == null);
  if (/^(kg|kgs|ton|t)$/i.test(String(uom || '').trim())) return has(c.kg);
  return has(c.bundles) || has(c.pieces);
}

// Stock out: qty must be more than 0 and no more than what is on hand. Returns '' when valid.
function outOk(out, onHand) {
  if (!(Number(out) > 0) || Math.floor(Number(out)) !== Number(out)) return 'Out Qty must be a whole number above 0.';
  if (Number(out) > Number(onHand)) return 'Out Qty is more than qty on hand.';
  return '';
}

// Accuracy of one bin = share of MATCH among its last `win` counts (null when never counted).
function accuracyPct(statuses, win) {
  const last = (statuses || []).slice(-(Number(win) || 10));
  if (!last.length) return null;
  return Math.round(100 * last.filter(s => s === 'MATCH').length / last.length);
}

// Today's list: active bins, least recently counted first (never counted = empty date = first).
function todayList(bins, n) {
  return bins.filter(b => b.active !== false)
    .slice()
    .sort((a, b) => (a.lastCount || '') < (b.lastCount || '') ? -1 : (a.lastCount || '') > (b.lastCount || '') ? 1 : 0)
    .slice(0, Number(n) || 20);
}

// Stock movement (In / Out / Transfer): qty is a number above 0; Out and Transfer cannot take more than the balance.
// Whole numbers only for lines kept in pieces. Returns '' when valid.
function moveOk(type, qty, balance, uom) {
  const q = Number(qty);
  if (!isFinite(q) || !(q > 0)) return 'Quantity must be above 0.';
  if (!/^(kg|kgs|ton|t)$/i.test(String(uom || '').trim()) && Math.floor(q) !== q) return 'Quantity must be a whole number.';
  if (type !== 'IN' && q > Number(balance)) return 'Quantity is more than the stock in this bin.';
  return '';
}

// New balance after a movement. IN adds; OUT and TRANSFER OUT subtract. Rounded to 3 decimals (kg).
function balanceAfter(type, qty, balance) {
  const b = Number(balance) || 0, q = Number(qty) || 0;
  return Math.round((type === 'IN' || type === 'TRANSFER IN' ? b + q : b - q) * 1000) / 1000;
}

// Transfer needs a destination bin that is not the source bin. Returns '' when valid.
function transferOk(fromBin, toBin) {
  const a = String(fromBin || '').trim().toUpperCase(), b = String(toBin || '').trim().toUpperCase();
  if (!b) return 'Scan or type the destination bin.';
  if (a === b) return 'Destination bin must be different from the source bin.';
  return '';
}
