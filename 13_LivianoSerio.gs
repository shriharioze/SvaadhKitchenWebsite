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

// The orders tab for a storefront. Lazily creates LS_Orders with the SAME
// header row as SK_Orders (cloned at creation time so dynamic columns that
// were self-healed onto SK_Orders over time are present from day one —
// keeps headerIndex() consistent across both tabs for cross-tab logic).
function _lsOrdersWs(ss, storefront) {
  if (storefront !== "LS") return getOrCreateTab(ss, TAB_ORDERS, ORDERS_HEADERS);
  let ws = ss.getSheetByName(TAB_LS_ORDERS);
  if (!ws) {
    const sk = getOrCreateTab(ss, TAB_ORDERS, ORDERS_HEADERS);
    const lastCol = sk.getLastColumn();
    const headers = lastCol > 0 ? sk.getRange(1, 1, 1, lastCol).getValues()[0] : ORDERS_HEADERS;
    ws = ss.insertSheet(TAB_LS_ORDERS);
    ws.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight("bold");
    ws.setFrozenRows(1);
    console.log("Created " + TAB_LS_ORDERS + " tab with " + headers.length + " columns (schema cloned from SK_Orders).");
  }
  return ws;
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

// IA-style adapter: plain LS rows for concat() into kitchen/label/admin views
// that already merge ia_rowsAsSK(). Returns [] until the tab exists.
function ls_rowsAsSK() {
  try {
    const ss = getSpreadsheet();
    const lsWs = ss.getSheetByName(TAB_LS_ORDERS);
    return lsWs ? getAllRows(lsWs) : [];
  } catch (e) { return []; }
}
