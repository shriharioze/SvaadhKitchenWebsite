// ============================================================
// 05_Customer_Archive.gs
// Keeps SK_Customers small + fast: stamps Last_Order_At on each order, archives
// customers idle > ~1 month into SK_Customers_Archive, and lets a returning
// customer pull their saved address back (the "fetch archived" button) so they
// don't have to re-type it. Order history in SK_Orders is NEVER touched — only
// the customer PROFILE row moves.
// ============================================================

const TAB_CUSTOMERS_ARCHIVE = "SK_Customers_Archive";
const CUSTOMER_IDLE_DAYS    = 30; // archive a customer idle this many days

// Ensure the Last_Order_At column exists on SK_Customers (self-heal — the column
// isn't in the legacy header). Returns its 1-based column index.
function _ensureLastOrderCol(ws) {
  const hIdx = headerIndex(ws);
  if (hIdx["Last_Order_At"]) return hIdx["Last_Order_At"];
  const col = ws.getLastColumn() + 1;
  ws.getRange(1, col).setValue("Last_Order_At");
  SpreadsheetApp.flush();
  return col;
}

// Stamp a customer's Last_Order_At = now. Called after an order is placed.
// Best-effort: never throws into the order flow.
function updateCustomerLastOrder(phone) {
  try {
    const ss = getSpreadsheet();
    const ws = getOrCreateTab(ss, TAB_CUSTOMERS, CUSTOMERS_HEADERS);
    const col = _ensureLastOrderCol(ws);
    const pStr = _normalizePhone(phone);
    const r = getAllRows(ws).find(function (x) { return _normalizePhone(x.Phone) === pStr; });
    if (r) ws.getRange(r._row, col).setValue(getISTTimestamp());
  } catch (e) { console.warn("updateCustomerLastOrder: " + e.message); }
}

// Most-recent activity ISO date for a customer row, taking the LATEST of
// Last_Order_At, the last order in SK_Orders, and Created_At — so a customer is
// only archived when EVERY signal says they've been idle past the cutoff.
function _customerLastActivityISO(row, hIdx, lastOrderByPhone) {
  const toISO = function (v) {
    if (!v) return "";
    if (v instanceof Date) return Utilities.formatDate(v, "Asia/Kolkata", "yyyy-MM-dd");
    return String(v).trim().slice(0, 10);
  };
  const phone = _normalizePhone(row[hIdx["Phone"]]);
  const cands = [
    hIdx["Last_Order_At"] !== undefined ? toISO(row[hIdx["Last_Order_At"]]) : "",
    lastOrderByPhone[phone] || "",
    hIdx["Created_At"] !== undefined ? toISO(row[hIdx["Created_At"]]) : ""
  ].filter(Boolean);
  if (!cands.length) return "";
  return cands.sort().pop(); // latest
}

// Archive customers idle > CUSTOMER_IDLE_DAYS. dryRun=true → just report counts.
// Verify-before-delete: append to the archive and confirm the write BEFORE
// rebuilding SK_Customers with the kept rows (mirrors archiveOldWebhooks).
function archiveIdleCustomers(dryRun) {
  const lock = LockService.getScriptLock();
  try { lock.waitLock(10 * 60 * 1000); }
  catch (e) { return { success: false, error: "System busy — could not acquire lock." }; }
  try {
    const ss = getSpreadsheet();
    const ws = getOrCreateTab(ss, TAB_CUSTOMERS, CUSTOMERS_HEADERS);
    _ensureLastOrderCol(ws);
    const data = ws.getDataRange().getValues();
    if (data.length < 2) return { success: true, archived: 0, kept: 0, note: "No customers." };

    const headers = data[0];
    const hIdx = {}; headers.forEach(function (h, i) { hIdx[h] = i; });
    const phoneCol = hIdx["Phone"], pinCol = hIdx["PIN"], onAcctCol = hIdx["On_Account"];

    // Last order date per phone from SK_Orders (authoritative idle signal).
    const lastOrderByPhone = {};
    getAllRows(getOrCreateTab(ss, TAB_ORDERS, ORDERS_HEADERS)).forEach(function (o) {
      const p = _normalizePhone(o.Phone);
      const d = o.Order_Date instanceof Date
        ? Utilities.formatDate(o.Order_Date, "Asia/Kolkata", "yyyy-MM-dd")
        : String(o.Order_Date || "").trim().slice(0, 10);
      if (p && d && (!lastOrderByPhone[p] || d > lastOrderByPhone[p])) lastOrderByPhone[p] = d;
    });

    const cutoffISO = Utilities.formatDate(
      new Date(Date.now() - CUSTOMER_IDLE_DAYS * 24 * 60 * 60 * 1000), "Asia/Kolkata", "yyyy-MM-dd");

    // Preserve leading zeros on Phone/PIN through the read→write round-trip.
    const fix = function (row) {
      const r = row.slice();
      if (phoneCol !== undefined && r[phoneCol] !== "" && r[phoneCol] != null) r[phoneCol] = "'" + String(r[phoneCol]).replace(/^'/, "");
      if (pinCol   !== undefined && r[pinCol]   !== "" && r[pinCol]   != null) r[pinCol]   = "'" + String(r[pinCol]).replace(/^'/, "");
      return r;
    };

    const keep = [], toArchive = [];
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      // Never archive On-Account (active business / billed monthly) customers.
      if (String(row[onAcctCol] || "").trim().toLowerCase() === "yes") { keep.push(row); continue; }
      const lastISO = _customerLastActivityISO(row, hIdx, lastOrderByPhone);
      // No date signal at all → keep (safety; never archive on missing data).
      if (lastISO && lastISO < cutoffISO) toArchive.push(row); else keep.push(row);
    }

    if (!toArchive.length) return { success: true, archived: 0, kept: keep.length, note: "Nothing idle past " + CUSTOMER_IDLE_DAYS + " days." };
    if (dryRun) return { success: true, wouldArchive: toArchive.length, kept: keep.length, dryRun: true };

    // 1) Append to archive (same headers + Archived_At), VERIFY, then delete live.
    const arWs = getOrCreateTab(ss, TAB_CUSTOMERS_ARCHIVE, headers.concat(["Archived_At"]));
    const arHeaders = arWs.getRange(1, 1, 1, arWs.getLastColumn()).getValues()[0];
    if (String(arHeaders[arHeaders.length - 1] || "") !== "Archived_At") {
      arWs.getRange(1, arWs.getLastColumn() + 1).setValue("Archived_At");
    }
    const stamp = getISTTimestamp();
    const archiveRows = toArchive.map(function (r) { return fix(r).concat([stamp]); });
    const before = arWs.getLastRow();
    arWs.getRange(before + 1, 1, archiveRows.length, archiveRows[0].length).setValues(archiveRows);
    SpreadsheetApp.flush();
    if ((arWs.getLastRow() - before) !== archiveRows.length) {
      return { success: false, error: "Archive write verification failed — nothing deleted from SK_Customers." };
    }

    // 2) Rebuild SK_Customers with kept rows only (archive is safely written).
    const lastRow = ws.getLastRow(), lastCol = ws.getLastColumn();
    if (lastRow > 1) ws.getRange(2, 1, lastRow - 1, lastCol).clearContent();
    if (keep.length) {
      const keepFixed = keep.map(fix);
      ws.getRange(2, 1, keepFixed.length, headers.length).setValues(keepFixed);
    }
    SpreadsheetApp.flush();
    if ((ws.getLastRow() - 1) !== keep.length) {
      return { success: false, error: "SK_Customers rebuild mismatch — archive IS written; verify before re-running." };
    }

    Logger.log("archiveIdleCustomers: archived " + toArchive.length + ", kept " + keep.length);
    return { success: true, archived: toArchive.length, kept: keep.length };
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}

// Returning-customer "fetch my saved address". Looks the phone up in the archive;
// if found, restores the profile (address etc.) back into SK_Customers — KEEPING
// the customer's current PIN (set during this re-login) — removes the archive row,
// and returns the address so the frontend can pre-fill it. { found:false } otherwise.
function fetchArchivedAddress(phone) {
  const pStr = _normalizePhone(phone || "");
  if (!pStr) return { found: false };
  const lock = LockService.getScriptLock();
  try { lock.waitLock(20000); } catch (e) { return { found: false, error: "busy" }; }
  try {
    const ss = getSpreadsheet();
    const arWs = ss.getSheetByName(TAB_CUSTOMERS_ARCHIVE);
    if (!arWs || arWs.getLastRow() < 2) return { found: false };
    const data = arWs.getDataRange().getValues();
    const headers = data[0];
    const hIdx = {}; headers.forEach(function (h, i) { hIdx[h] = i; });
    let foundRowNum = -1, row = null;
    for (let i = 1; i < data.length; i++) {
      if (_normalizePhone(data[i][hIdx["Phone"]]) === pStr) { foundRowNum = i + 1; row = data[i]; break; }
    }
    if (foundRowNum === -1) return { found: false };

    const g = function (col) { return hIdx[col] !== undefined ? (row[hIdx[col]] || "") : ""; };
    const profile = {
      phone:              pStr,
      name:               g("Customer_Name"),
      area:               g("Area"),
      wing:               g("Wing"),
      flat:               g("Flat"),
      floor:              g("Floor"),
      society:            g("Society"),
      maps:               g("Maps_Link"),
      landmark:           g("Landmark"),
      meal_addresses:     g("Meal_Addresses"),
      delivery_point:     g("Delivery_Point"),
      payment_preference: g("Payment_Freq"),
      billingCycle:       g("Billing_Cycle"),
      onAccount:          g("On_Account")
      // PIN intentionally omitted — keep the customer's current PIN.
    };
    _upsertCustomer(ss, profile);   // restore into SK_Customers (create/update)
    arWs.deleteRow(foundRowNum);    // remove from archive

    return {
      found:              true,
      name:               profile.name,
      area:               profile.area,
      wing:               profile.wing,
      flat:               profile.flat,
      floor:              profile.floor,
      society:            profile.society,
      maps:               profile.maps,
      landmark:           profile.landmark,
      meal_addresses:     profile.meal_addresses,
      delivery_point:     profile.delivery_point,
      payment_preference: profile.payment_preference
    };
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}

// READ-ONLY: find a customer in the archive by phone. Returns { rowNum, pin,
// name, profile } or null. Only ever called on a SK_Customers MISS (cold path),
// so active customers never scan the archive.
function _findArchivedCustomer(phone) {
  const pStr = _normalizePhone(phone || "");
  if (!pStr) return null;
  const ss = getSpreadsheet();
  const arWs = ss.getSheetByName(TAB_CUSTOMERS_ARCHIVE);
  if (!arWs || arWs.getLastRow() < 2) return null;
  const data = arWs.getDataRange().getValues();
  const headers = data[0];
  const hIdx = {}; headers.forEach(function (h, i) { hIdx[h] = i; });
  for (let i = 1; i < data.length; i++) {
    if (_normalizePhone(data[i][hIdx["Phone"]]) !== pStr) continue;
    const row = data[i];
    const g = function (c) { return hIdx[c] !== undefined ? (row[hIdx[c]] || "") : ""; };
    const pin = String(g("PIN") || "").replace(/^'/, "").trim();
    return {
      rowNum: i + 1,
      pin: pin,
      name: g("Customer_Name"),
      profile: {
        phone: pStr, name: g("Customer_Name"), area: g("Area"), wing: g("Wing"),
        flat: g("Flat"), floor: g("Floor"), society: g("Society"), maps: g("Maps_Link"),
        landmark: g("Landmark"), meal_addresses: g("Meal_Addresses"), delivery_point: g("Delivery_Point"),
        payment_preference: g("Payment_Freq"), billingCycle: g("Billing_Cycle"), onAccount: g("On_Account"),
        pin: pin   // restore the OLD PIN → no reset for the returning customer
      }
    };
  }
  return null;
}

// Restore a full archived record (incl. PIN + address) into SK_Customers and
// remove the archive row. Called by verifyLogin AFTER the PIN is verified, so a
// returning customer is silently un-archived and logs in with NO reset.
function _restoreArchivedCustomer(arc) {
  if (!arc) return;
  const ss = getSpreadsheet();
  _upsertCustomer(ss, arc.profile);
  try {
    const arWs = ss.getSheetByName(TAB_CUSTOMERS_ARCHIVE);
    if (arWs) arWs.deleteRow(arc.rowNum);
  } catch (e) { console.warn("_restoreArchivedCustomer: " + e.message); }
}

// Run ONCE from the editor — weekly Monday ~3 AM idle-customer archiving.
function setupCustomerArchiveTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === "archiveIdleCustomers") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("archiveIdleCustomers")
    .timeBased().everyWeeks(1).onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(3).create();
  Logger.log("✅ archiveIdleCustomers weekly trigger created — Mondays ~3 AM.");
  return { success: true };
}
