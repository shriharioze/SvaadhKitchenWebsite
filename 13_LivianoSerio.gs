// ============================================================
// 13_LivianoSerio.gs
// Liviano-Serio storefront (LS) — second consumer storefront.
// ------------------------------------------------------------
// An exact replica of order.html (docs/Liviano-Serio.html) whose orders
// live in the LS_Orders tab of the SAME master spreadsheet, with an
// IDENTICAL column schema to SK_Orders. Customers + wallet + loyalty
// are SHARED with the main site (same phone = same balance/streak).
//
// Storefront rules (owner-approved 2026-08-24):
//   • Delivery caps: LS orders count 0 slots and are never blocked by
//     caps or item stock limits (one fixed drop location, unlimited).
//   • Delivery fee: FREE while LS_FREE_DELIVERY is true (00_Config.gs,
//     Script Property "LS_FREE_DELIVERY"="false" to revert later).
//   • Kitchen prep counts INCLUDE LS quantities; admin UI tags [LS].
//   • Gateway: same HDFC flow; gateway order ids prefixed "LS" so the
//     return redirect routes back to Liviano-Serio.html (IA pattern).
//
// Routing: submitOrder/submitBulkOrder/gateway bodies carry
// storefront:"LS". When absent, every code path behaves EXACTLY as
// before — zero impact on the live main-site flow.
// ============================================================

// Normalize a request's storefront marker → "LS" or "" (main site).
function _lsStorefront(body) {
  try {
    return String((body && body.storefront) || "").trim().toUpperCase() === "LS" ? "LS" : "";
  } catch (e) { return ""; }
}

// True when delivery is free for this storefront context.
function _lsDeliveryFree(storefront) {
  return storefront === "LS" && LS_FREE_DELIVERY;
}

// Columns SK_Orders carries that the LS storefront never collects (address
// form has no maps link / landmark). Excluded from LS_Orders at creation and
// removable from an existing tab via lsTrimSchema (dry-run default).
const LS_DROP_COLUMNS = ["Maps_Link", "Landmark"];

// The orders tab for a storefront. Lazily creates LS_Orders with the SAME
// header row as SK_Orders MINUS LS_DROP_COLUMNS (keeps headerIndex() honest
// for every writer — set() simply skips columns the tab doesn't have).
function _lsOrdersWs(ss, storefront) {
  if (storefront !== "LS") return getOrCreateTab(ss, TAB_ORDERS, ORDERS_HEADERS);
  let ws = ss.getSheetByName(TAB_LS_ORDERS);
  if (!ws) {
    const sk = getOrCreateTab(ss, TAB_ORDERS, ORDERS_HEADERS);
    const lastCol = sk.getLastColumn();
    const headers = lastCol > 0 ? sk.getRange(1, 1, 1, lastCol).getValues()[0] : ORDERS_HEADERS;
    const lsHeaders = headers.filter(function (h) { return LS_DROP_COLUMNS.indexOf(String(h).trim()) === -1; });
    ws = ss.insertSheet(TAB_LS_ORDERS);
    ws.getRange(1, 1, 1, lsHeaders.length).setValues([lsHeaders]).setFontWeight("bold");
    ws.setFrozenRows(1);
    console.log("Created " + TAB_LS_ORDERS + " tab with " + lsHeaders.length + " columns (SK schema minus LS-drop columns).");
  }
  return ws;
}

// Trim the drop-columns from an EXISTING LS_Orders tab. DRY-RUN DEFAULT:
// call with commit=true (or ?action=lsTrimSchema&pin=…&commit=1) to execute.
// Whole-COLUMN deletion keeps row alignment intact and per-tab headerIndex()
// re-derives on next read, so writers/readers adapt automatically.
function lsTrimSchema(commit) {
  const ss = getSpreadsheet();
  const ws = ss.getSheetByName(TAB_LS_ORDERS);
  if (!ws) return { success: true, note: TAB_LS_ORDERS + " does not exist yet — nothing to trim (it will be created without them)." };
  const headers = ws.getRange(1, 1, 1, ws.getLastColumn()).getValues()[0].map(String);
  const found = [];
  headers.forEach(function (h, i) {
    if (LS_DROP_COLUMNS.indexOf(h.trim()) !== -1) found.push({ col: i + 1, name: h });
  });
  if (!found.length) return { success: true, note: "Already trimmed.", columns: headers.length };
  if (commit !== true) {
    return { success: true, dryRun: true, wouldDelete: found, columnsNow: headers.length,
             note: "Dry run — pass commit=1 to delete these columns." };
  }
  // Delete right-to-left so indices stay valid
  found.sort(function (a, b) { return b.col - a.col; }).forEach(function (f) {
    ws.deleteColumn(f.col);
  });
  try { SpreadsheetApp.flush(); } catch (e) {}
  const remaining = ws.getLastColumn();
  console.log("lsTrimSchema: deleted " + found.length + " column(s); " + remaining + " remain.");
  return { success: true, deleted: found, columnsRemaining: remaining };
}

// Both order tabs — SK first (canonical), then LS.
function _lsOrderTabs(ss) {
  return [getOrCreateTab(ss, TAB_ORDERS, ORDERS_HEADERS), _lsOrdersWs(ss, "LS")];
}

// Combined rows from BOTH tabs. Each row carries:
//   _lsTab (bool) — true when the row came from LS_Orders (drives [LS] badges)
//   _ws            — its source sheet (cross-tab writes: delete/status/clawback)
//   _hIdx          — that sheet's header map (lazy, per-tab cached via props on ws object)
function _getAllOrdersBothTabs(ss) {
  const out = [];
  _lsOrderTabs(ss).forEach(function (ws) {
    const isLS = (ws.getName() === TAB_LS_ORDERS);
    getAllRows(ws).forEach(function (r) {
      r._lsTab = isLS;
      r._ws = ws;
      out.push(r);
    });
  });
  return out;
}

// Rows-only variant for hot paths that must NOT pay a double sheet read when
// LS_Orders doesn't exist yet (early weeks): reads SK always, LS only if the
// tab exists. Shape matches _getAllOrdersBothTabs (_lsTab/_ws attached).
function _getAllOrdersBothTabsIfPresent(ss) {
  const skWs = getOrCreateTab(ss, TAB_ORDERS, ORDERS_HEADERS);
  const out = [];
  getAllRows(skWs).forEach(function (r) { r._lsTab = false; r._ws = skWs; out.push(r); });
  try {
    const lsWs = ss.getSheetByName(TAB_LS_ORDERS);
    if (lsWs) {
      getAllRows(lsWs).forEach(function (r) { r._lsTab = true; r._ws = lsWs; out.push(r); });
    }
  } catch (e) { /* LS tab not created yet — fine */ }
  return out;
}

// ── Identity & wallet routing (separate books per storefront) ───────────────
// Owner decision 2026-08-25: LS runs a FULLY SEPARATE customer base + wallet.
// Same phone on both pages = two independent accounts. Every identity/wallet
// read+write routes by storefront; main-site paths (storefront "") are
// untouched and keep using SK_Customers / SK_Wallet.
function _customersTabFor(ss, storefront) {
  if (storefront === "LS") {
    const ws = ss.getSheetByName(TAB_LS_CUSTOMERS);
    if (ws) return ws;
    const sk = getOrCreateTab(ss, TAB_CUSTOMERS, CUSTOMERS_HEADERS);
    const created = ss.insertSheet(TAB_LS_CUSTOMERS);
    created.getRange(1, 1, 1, sk.getLastColumn()).setValues([sk.getRange(1, 1, 1, sk.getLastColumn()).getValues()[0]]).setFontWeight("bold");
    created.setFrozenRows(1);
    console.log("Created " + TAB_LS_CUSTOMERS + " tab (schema cloned from SK_Customers).");
    return created;
  }
  return getOrCreateTab(ss, TAB_CUSTOMERS, CUSTOMERS_HEADERS);
}

function _walletTabFor(ss, storefront) {
  if (storefront === "LS") {
    const ws = ss.getSheetByName(TAB_LS_WALLET);
    if (ws) return ws;
    const sk = getOrCreateTab(ss, TAB_WALLET, WALLET_HEADERS);
    const created = ss.insertSheet(TAB_LS_WALLET);
    created.getRange(1, 1, 1, WALLET_HEADERS.length).setValues([WALLET_HEADERS]).setFontWeight("bold");
    created.setFrozenRows(1);
    console.log("Created " + TAB_LS_WALLET + " tab (canonical wallet schema).");
    return created;
  }
  return getOrCreateTab(ss, TAB_WALLET, WALLET_HEADERS);
}

// Self-pickup label for order rows: LS storefront hands over at Ganga Serio,
// main site at the Hadapsar kitchen. Used by submitOrder / bulk / reconciler
// so Full_Address matches the storefront the order came from.
function _lsPickupLabel(storefront) {
  return (storefront === "LS")
    ? "Self Pickup (" + LS_PICKUP_ADDRESS + ")"
    : "Self Pickup (A 104, Shree laxmi vihar society, Hadapsar)";
}

// IA-style adapter: plain LS rows for concat() into kitchen/label/admin views
// that already merge ia_rowsAsSK(). Returns [] until the tab exists.
function ls_rowsAsSK() {
  try {
    const ss = getSpreadsheet();
    const lsWs = ss.getSheetByName(TAB_LS_ORDERS);
    return lsWs ? getAllRows(lsWs) : [];
  } catch (e) { return []; }
}
