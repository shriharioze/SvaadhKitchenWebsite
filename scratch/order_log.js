// ════════════════════════════════════════════════════════════════
// ORDER LOG: lightweight audit trail capturing the cart the moment
// "Pay Now" is clicked. Zero impact on money flow — fire-and-forget
// write, never read by any downstream system, cleaned after 24h.
// ════════════════════════════════════════════════════════════════
const fs = require("fs");

// ── 1. Add write to hdfc_savePendingOrder ──
let gw = fs.readFileSync("10_Hdfc_Gateway.gs", "utf8");
// Find the point AFTER the stash is saved (after props.setProperty for HDFC_PENDING_ORDERS)
const anchor1 = '    props.setProperty("HDFC_PENDING_ORDERS", JSON.stringify(pending));\n    console.log("hdfc_savePendingOrder: saved order " + orderId);\n    return { success: true };';
const new1 = `    props.setProperty("HDFC_PENDING_ORDERS", JSON.stringify(pending));
    console.log("hdfc_savePendingOrder: saved order " + orderId);
    // ── ORDER LOG: fire-and-forget audit trail (zero impact on payment flow) ──
    try {
      var logWs = getSpreadsheet().getSheetByName("SK_Order_Log");
      if (!logWs) {
        logWs = getSpreadsheet().insertSheet("SK_Order_Log");
        logWs.getRange(1, 1, 1, 6).setValues([["Timestamp", "Phone", "Name", "Gateway_Order_ID", "Cart_JSON", "Status"]]).setFontWeight("bold");
        logWs.setFrozenRows(1);
      }
      var cartJson = pending[orderId].bulk ? JSON.stringify(pending[orderId].bulk) : JSON.stringify(pending[orderId].orders || {});
      logWs.appendRow([getISTTimestamp(), pending[orderId].phone, pending[orderId].profile ? (pending[orderId].profile.name || "") : "", orderId, cartJson, "pending"]);
    } catch (_logErr) { /* fire-and-forget — never block payment */ }
    return { success: true };`;
if (gw.includes(anchor1)) { gw = gw.replace(anchor1, new1); console.log("Order_Log write in hdfc_savePendingOrder ✓"); }
else { console.log("MISS hdfc_savePendingOrder anchor"); process.exit(1); }
fs.writeFileSync("10_Hdfc_Gateway.gs", gw);

// ── 2. Add cleanup function to 04_Reports_Misc.gs ──
let rp = fs.readFileSync("04_Reports_Misc.gs", "utf8");
const cleanupFn = `

// ── ORDER LOG CLEANUP: delete entries older than 24 hours ──
// The log is purely for the "in-between" window (click → reconciler). After 24h:
//   • If the order made it to SK_Orders → it's safe there, log is redundant
//   • If it didn't → it was never paid, no action needed
// Runs from the daily archive trigger. Fire-and-forget.
function cleanupOrderLog() {
  try {
    var ss = getSpreadsheet();
    var ws = ss.getSheetByName("SK_Order_Log");
    if (!ws || ws.getLastRow() < 2) return;
    var cutoff = Date.now() - 24 * 60 * 60 * 1000; // 24h ago
    var data = ws.getDataRange().getValues();
    var rowsToDelete = [];
    for (var i = data.length - 1; i >= 1; i--) { // bottom-up for safe deletion
      var ts = data[i][0]; // Timestamp column
      var tsMs = (ts instanceof Date) ? ts.getTime() : new Date(ts).getTime();
      if (!isNaN(tsMs) && tsMs < cutoff) rowsToDelete.push(i + 1);
    }
    rowsToDelete.forEach(function (row) { ws.deleteRow(row); });
    if (rowsToDelete.length) SpreadsheetApp.flush();
    Logger.log("cleanupOrderLog: deleted " + rowsToDelete.length + " entries older than 24h");
  } catch (e) { Logger.log("cleanupOrderLog error: " + e.message); }
}
`;
const cleanupAnchor = "function archiveDueOrders(";
if (rp.includes(cleanupAnchor)) {
  rp = rp.replace(cleanupAnchor, cleanupFn + "\n" + cleanupAnchor);
  console.log("cleanupOrderLog function ✓");
} else console.log("MISS cleanup anchor");

// Hook cleanup into runScheduledArchive (already runs daily)
const oldRun = "  var result = archiveDueOrders(false);";
const newRun = "  var result = archiveDueOrders(false);\n  try { cleanupOrderLog(); } catch (_) {}";
if (rp.includes(oldRun)) { rp = rp.replace(oldRun, newRun); console.log("cleanup hooked to daily trigger ✓"); }
else console.log("MISS daily trigger hook");

fs.writeFileSync("04_Reports_Misc.gs", rp);

// ── syntax ──
fs.copyFileSync("10_Hdfc_Gateway.gs", "scratch/syn_10.js");
fs.copyFileSync("04_Reports_Misc.gs", "scratch/syn_04.js");
console.log("done");
