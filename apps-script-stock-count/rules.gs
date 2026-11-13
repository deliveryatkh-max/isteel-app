/**
 * Stock Count rules: pure functions, no Apps Script calls.
 * Used by Code.gs in Apps Script and by apps-script-stock-count/tests/run.js in Node.
 * web/stock-count/sc.js keeps a copy of countedPcs / statusOf / needsPhoto (same logic).
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

// Bundles and pieces must be whole numbers, 0 allowed. Returns '' when valid, otherwise the message.
function validateCount(c) {
  const whole = v => v !== '' && v != null && isFinite(Number(v)) && Number(v) >= 0 && Math.floor(Number(v)) === Number(v);
  if (!whole(c.bundles) || !whole(c.pieces)) return 'Enter bundles and pieces as whole numbers (0 is allowed).';
  return '';
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
