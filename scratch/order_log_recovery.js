// ── 1. Expand Order_Log to store FULL stash entry (for recovery) ──
let gw = fs.readFileSync("10_Hdfc_Gateway.gs", "utf8");
const NL = "\r\n";
// Update the Order_Log write to include the full stash JSON
const oldWrite = '      var cartJson = pending[orderId].bulk ? JSON.stringify(pending[orderId].bulk) : JSON.stringify(pending[orderId].orders || {});';
const newWrite = '      var fullStash = JSON.stringify(pending[orderId]);';
if (gw.includes(oldWrite)) { gw = gw.replace(oldWrite, newWrite); console.log("full stash stored ✓"); }
else console.log("MISS full stash");
// Also update headers to match (add Stash_JSON column, remove Cart_JSON)
const oldHeaders = '[["Timestamp", "Phone", "Name", "Gateway_Order_ID", "Cart_JSON", "Status"]]';
const newHeaders = '[["Timestamp", "Phone", "Name", "Gateway_Order_ID", "Stash_JSON", "Status"]]';
if (gw.includes(oldHeaders)) { gw = gw.replace(oldHeaders, newHeaders); console.log("headers updated ✓"); }
// Update the appendRow to use fullStash
const oldAppend = 'logWs.appendRow([getISTTimestamp(), pending[orderId].phone, pending[orderId].profile ? (pending[orderId].profile.name || "") : "", orderId, cartJson, "pending"]);';
const newAppend = 'logWs.appendRow([getISTTimestamp(), pending[orderId].phone, pending[orderId].profile ? (pending[orderId].profile.name || "") : "", orderId, fullStash, "pending"]);';
if (gw.includes(oldAppend)) { gw = gw.replace(oldAppend, newAppend); console.log("appendRow updated ✓"); }
fs.writeFileSync("10_Hdfc_Gateway.gs", gw);

// ── 2. Add recovery function to 04_Reports_Misc.gs ──
let rp = fs.readFileSync("04_Reports_Misc.gs", "utf8");
const recoveryFn = `

// ── ORDER LOG RECOVERY: last-resort recovery for dropped orders ──
// Scans SK_Order_Log for "pending" entries where the gateway_order_id is NOT
// in SK_Orders (order was dropped). If the payment was CHARGED, reconstructs
// the order from the stored stash JSON, writes it, and emails admin.
// Runs after the main reconciler (every ~2 min). Entries 10-60 min old only —
// younger entries get time for the normal flow; older ones hit the 24h cleanup.
function recoverFromOrderLog() {
  try {
    var ss = getSpreadsheet();
    var logWs = ss.getSheetByName("SK_Order_Log");
    if (!logWs || logWs.getLastRow() < 2) return;
    var logData = logWs.getDataRange().getValues();
    var logHeaders = logData[0];
    var colTs = logHeaders.indexOf("Timestamp");
    var colPhone = logHeaders.indexOf("Phone");
    var colGwId = logHeaders.indexOf("Gateway_Order_ID");
    var colStash = logHeaders.indexOf("Stash_JSON");
    var colStatus = logHeaders.indexOf("Status");
    if (colGwId === -1 || colStash === -1 || colStatus === -1) return;

    // Check both order tabs for existing gateway_order_ids
    var existingGwIds = {};
    [TAB_ORDERS, TAB_LS_ORDERS].forEach(function (tn) {
      var ws = ss.getSheetByName(tn);
      if (!ws || ws.getLastRow() < 2) return;
      var dh = ws.getRange(1, 1, 1, ws.getLastColumn()).getValues()[0].map(String);
      var gwCol = dh.indexOf("Gateway_Order_ID");
      if (gwCol === -1) return;
      ws.getRange(2, gwCol + 1, ws.getLastRow() - 1, 1).getValues().forEach(function (v) {
        var gid = String(v[0] || "").trim();
        if (gid) existingGwIds[gid] = true;
      });
    });

    var now = Date.now();
    var recovered = 0, abandoned = 0;
    var recoveredDetails = [];

    for (var i = 1; i < logData.length; i++) {
      var status = String(logData[i][colStatus] || "").trim();
      if (status !== "pending") continue; // already processed
      var gwId = String(logData[i][colGwId] || "").trim();
      if (!gwId) continue;

      // Already written to SK_Orders or LS_Orders? → mark as written
      if (existingGwIds[gwId]) {
        logWs.getRange(i + 1, colStatus + 1).setValue("written");
        continue;
      }

      // Age check: only recover 10-60 min old entries
      var ts = logData[i][colTs];
      var tsMs = (ts instanceof Date) ? ts.getTime() : new Date(ts).getTime();
      if (isNaN(tsMs)) continue;
      var ageMin = (now - tsMs) / 60000;
      if (ageMin < 10) continue; // too fresh — normal flow may still write it
      if (ageMin > 60) {
        // Too old — mark abandoned (never paid or reconciler already gave up)
        logWs.getRange(i + 1, colStatus + 1).setValue("abandoned");
        abandoned++;
        continue;
      }

      // Parse the stash JSON
      var stashJson = String(logData[i][colStash] || "");
      if (!stashJson) continue;
      var entry;
      try { entry = JSON.parse(stashJson); } catch (e) { continue; }
      if (!entry || (!entry.orders && !entry.bulk)) continue;

      // Check if payment was actually charged
      var charged = false;
      try {
        var statusCheck = hdfc_getOrderStatus(gwId);
        charged = statusCheck.confirmed;
      } catch (e) {}
      if (!charged) {
        // Also check webhook log
        try { charged = !!_checkWebhookLogForCharge(gwId, entry.amount); } catch (e) {}
      }
      if (!charged) continue; // not paid — skip (will become abandoned after 60 min)

      // ── RECOVER: reconstruct and write the order ──
      var result;
      if (entry.bulk) {
        var isSplit = String(entry.payment_choice || "") === "Split";
        result = submitBulkOrder({
          plan: entry.bulk.plan,
          phone: entry.phone,
          profile: entry.profile,
          storefront: String(entry.storefront || "").trim().toUpperCase() === "LS" ? "LS" : "",
          lunch: entry.bulk.lunch,
          dinner: entry.bulk.dinner,
          lunchDates: entry.bulk.lunchDates,
          dinnerDates: entry.bulk.dinnerDates,
          payment_method: isSplit ? "Bulk (Split HDFC)" : "Bulk (Gateway)",
          payment_status: "Paid",
          wallet_applied: isSplit ? Number(entry.wallet_applied || 0) : 0,
          gateway_order_id: gwId,
          batch_id: gwId
        });
      } else {
        var body = _buildSubmitBodyFromPending(gwId, entry, { status: "CHARGED", confirmed: true });
        if (body && body.orders && body.orders.length) {
          result = submitOrder(body);
        }
      }

      if (result && result.success) {
        logWs.getRange(i + 1, colStatus + 1).setValue("recovered");
        recovered++;
        recoveredDetails.push(gwId + " (" + (entry.phone || "?") + ")");
        Logger.log("recoverFromOrderLog: RECOVERED " + gwId + " from log");
      } else {
        Logger.log("recoverFromOrderLog: failed to recover " + gwId + ": " + JSON.stringify(result));
      }
    }

    // Email admin if anything was recovered
    if (recovered > 0) {
      try {
        var adminEmail = PropertiesService.getScriptProperties().getProperty("ADMIN_EMAIL");
        if (adminEmail) {
          MailApp.sendEmail(adminEmail,
            "✅ Order Log Recovery: " + recovered + " dropped order(s) recovered",
            "The following orders were dropped but automatically recovered from the Order Log:\\n\\n" +
            recoveredDetails.join("\\n") +
            "\\n\\nPlease verify in the admin panel.");
        }
      } catch (e) {}
    }
  } catch (e) {
    Logger.log("recoverFromOrderLog error: " + e.message);
  }
}
`;
// Insert after cleanupOrderLog
const cleanupAnchor = "function archiveDueOrders(";
if (rp.includes(cleanupAnchor)) {
  rp = rp.replace(cleanupAnchor, recoveryFn + "\n" + cleanupAnchor);
  console.log("recoverFromOrderLog function ✓");
} else console.log("MISS recovery anchor");

// Hook into runScheduledArchive (after cleanup)
const oldHook = "  try { cleanupOrderLog(); } catch (_) {}";
const newHook = "  try { cleanupOrderLog(); } catch (_) {}\n  try { recoverFromOrderLog(); } catch (_) {}";
if (rp.includes(oldHook)) { rp = rp.replace(oldHook, newHook); console.log("recovery hooked to daily trigger ✓"); }
else console.log("MISS recovery hook");

fs.writeFileSync("04_Reports_Misc.gs", rp);

// ── syntax ──
fs.copyFileSync("10_Hdfc_Gateway.gs", "scratch/syn_10.js");
fs.copyFileSync("04_Reports_Misc.gs", "scratch/syn_04.js");
console.log("done");
