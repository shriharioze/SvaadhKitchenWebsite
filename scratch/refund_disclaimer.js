const fs = require("fs");
const DISCLAIMER = "\n\n💡 Most refunds are processed on the same day. It might not show immediately in your payment app, but will appear in your bank statement — you may also receive an SMS confirmation.";
let n = 0;

// ── 1. Backend: append disclaimer to _deleteOrderInternal's return msg ──
// This covers ALL pages that use the backend cancellation message
let om = fs.readFileSync("02_Orders_Menu.gs", "utf8");
const oldRet = "return {success: true, message: msg};";
const newRet = "return {success: true, message: msg + \"" + DISCLAIMER.replace(/"/g, "\\\"").replace(/\n/g, "\\n") + "\"};";
// Find the one inside _deleteOrderInternal (not other functions)
const diIdx = om.indexOf("function _deleteOrderInternal");
if (diIdx !== -1) {
  const diEnd = om.indexOf("\nfunction ", diIdx + 10);
  let diBody = om.slice(diIdx, diEnd);
  if (diBody.includes(oldRet)) {
    diBody = diBody.replace(oldRet, newRet);
    om = om.slice(0, diIdx) + diBody + om.slice(diEnd);
    n++; console.log("backend _deleteOrderInternal disclaimer ✓");
  } else console.log("backend return MISS");
}
fs.writeFileSync("02_Orders_Menu.gs", om);

// ── 2. Frontend: add disclaimer to the main sAlert cancellation confirmations ──
// order.html + Liviano-Serio.html share the same code patterns
["docs/order.html", "docs/Liviano-Serio.html"].forEach(p => {
  let c = fs.readFileSync(p, "utf8");
  let pn = 0;

  // Pattern 1: "Cancellation successful! Refund added to your Svaadh Wallet."
  const p1a = '"Cancellation successful! Refund added to your Svaadh Wallet."';
  const p1b = '"Cancellation successful! Refund added to your Svaadh Wallet.<br><br><small>💡 Most refunds are processed on the same day. It might not show immediately in your payment app, but will appear in your bank statement — you may also receive an SMS confirmation.</small>"';
  if (c.includes(p1a)) { c = c.split(p1a).join(p1b); pn++; }

  // Pattern 2: "Cancellation successful! Refund request submitted"
  const p2a = 'serverMsg || "Cancellation successful! Refund request submitted';
  if (c.includes(p2a)) {
    // This uses serverMsg which already has the disclaimer from backend — skip
  }

  // Pattern 3: soft-cancel "Cancellation request received!"
  const p3a = '"Cancellation request received! Admin will verify your payment and process the refund (1-2 days). ✅"';
  const p3b = '"Cancellation request received! Admin will verify your payment and process the refund (1-2 days). ✅<br><br><small>💡 Most refunds are processed on the same day. It might not show immediately in your payment app, but will appear in your bank statement.</small>"';
  if (c.includes(p3a)) { c = c.split(p3a).join(p3b); pn++; }

  if (pn > 0) {
    fs.writeFileSync(p, c);
    n += pn;
    console.log(p + " disclaimer added ✓ (" + pn + " spots)");
  } else console.log(p + " no matching spots");
});

console.log("done " + n);
