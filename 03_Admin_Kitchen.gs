// ============================================================
// 03_Admin_Kitchen.gs — admin data/menu CRUD, areas, refunds, kitchen, driver, labels, packaging
// Split from Code.gs (verbatim). Global config in 00_Config.gs (loads first).
// ============================================================

// ── ADMIN: GET ALL DATA ──────────────────────────────────────
function getAdminData() {
  return _cachedData("adminData_v1", 30, _getAdminDataUncached);
}

// Lightweight id→name map for the breakfast + sabji masters ONLY.
// submitOrder uses this to resolve item-id columns; it must NOT call the full
// getAdminData(), whose menuEntries pass scans every order row per menu date
// (O(orders × dates)) and took ~40s cold — the entire order-placement lag.
// Two small sheet reads, cached 5 min (masters change rarely).
function _getMastersMap() {
  return _cachedData("mastersMap_v1", 300, function() {
    const ss = getSpreadsheet();
    const map = {};
    getAllRows(getOrCreateTab(ss, TAB_BF_MASTER, [])).forEach(function(r) {
      if (r.ID !== "" && r.ID !== undefined) map[String(r.ID)] = String(r.Name || "");
    });
    getAllRows(getOrCreateTab(ss, TAB_SABJI, [])).forEach(function(r) {
      if (r.ID !== "" && r.ID !== undefined) map[String(r.ID)] = String(r.Name || "");
    });
    return map;
  });
}

function _getAdminDataUncached() {
  const ss = getSpreadsheet();

  const bfWs   = getOrCreateTab(ss, TAB_BF_MASTER, []);
  const sabjiWs= getOrCreateTab(ss, TAB_SABJI,     []);
  const menuWs = getOrCreateTab(ss, TAB_MENU,       []);

  const bfRows    = getAllRows(bfWs);
  const sabjiRows = getAllRows(sabjiWs);
  const menuRows  = getAllRows(menuWs);

  const ordersWsAdm = getOrCreateTab(ss, TAB_ORDERS, []);
  const allOrdersAdm = getAllRows(ordersWsAdm);

  // Build per-date ordered-unit counts AND delivery counts in ONE pass over
  // all orders (O(orders)). Calling count-per-date inside the loop scales
  // poorly (O(orders × dates)).
  const countsByDate = {};
  const mealOrderCounts = {};   // dd → {Breakfast,Lunch,Dinner} unique-customer delivery counts
  const seen = {};
  const sawEnkin = {};
  const sawIA = {};
  const vips = typeof _getVipPhonesCached === "function" ? _getVipPhonesCached() : {};
  const _isEnkin = function (nm) { return String(nm || "").toLowerCase().indexOf("enkin") !== -1; };
  const _isIA    = function (nm) { return String(nm || "").trim().toLowerCase().indexOf("[ia]") === 0; };

  const validMenuDates = {};
  menuRows.forEach(function(r) {
    const d = r.Date instanceof Date ? Utilities.formatDate(r.Date, "Asia/Kolkata", "yyyy-MM-dd") : String(r.Date).trim();
    if (d) validMenuDates[d] = true;
  });

  allOrdersAdm.forEach(function(row) {
    if (_isOrderCancelled(row.Payment_Status)) return;
    const dd = row.Order_Date instanceof Date
      ? Utilities.formatDate(row.Order_Date, "Asia/Kolkata", "yyyy-MM-dd")
      : String(row.Order_Date || "").trim();
    if (!dd || !validMenuDates[dd]) return;
    const meal = String(row.Meal_Type || "").trim();

    // --- Delivery Cap Counting ---
    if (!mealOrderCounts[dd]) {
      mealOrderCounts[dd] = { Breakfast: 0, Lunch: 0, Dinner: 0 };
      seen[dd] = { Breakfast: {}, Lunch: {}, Dinner: {} };
      sawEnkin[dd] = { Breakfast: false, Lunch: false, Dinner: false };
      sawIA[dd] = { Breakfast: false, Lunch: false, Dinner: false };
    }
    if (mealOrderCounts[dd][meal] !== undefined) {
      let isDelivery = true;
      const phoneTrim = String(row.Phone || "").trim();
      if (vips[phoneTrim]) {
        isDelivery = false; // VIPs count as 0 slots
      } else {
        const ar = String(row.Area || "").toLowerCase();
        if (ar.indexOf("pickup") !== -1 || ar === "porter") isDelivery = false;
        else {
          const soc = _normSocietyBase(row.Society || "");
          if (soc.indexOf("shreelaxmivihar") !== -1) isDelivery = false;
        }
      }
      
      if (isDelivery) {
        if (_isEnkin(row.Customer_Name)) { sawEnkin[dd][meal] = true; }
        else if (_isIA(row.Customer_Name)) { sawIA[dd][meal] = true; }
        else {
          const nameKey = String(row.Customer_Name || "").trim().toLowerCase();
          if (nameKey && !seen[dd][meal][nameKey]) {
            seen[dd][meal][nameKey] = true;
            mealOrderCounts[dd][meal]++;
          }
        }
      }
    }
    // -----------------------------

    if (!countsByDate[dd]) countsByDate[dd] = { Breakfast: {}, Lunch: {}, Dinner: {} };
    if (!countsByDate[dd][meal]) return;
    let items = {};
    try { items = JSON.parse(row.Items_JSON || "{}"); } catch (e) {}
    Object.entries(items).forEach(function(pair) {
      // Canonical (suffix-stripped) key — MUST match itemsJsonKey/countOrderedUnits,
      // else the admin stock panel shows "0 ordered" forever (the 30-Jun idli case).
      let k = _stripItemSuffix(pair[0]);
      if (meal === "Breakfast" && k === "Curd") k = "Breakfast Curd";
      countsByDate[dd][meal][k] = (countsByDate[dd][meal][k] || 0) + Number(pair[1] || 0);
    });
  });

  // Fold in IntentAmplify from its separate tab as 1 slot per meal per day
  try {
    if (typeof ia_rowsAsSK === "function") {
      ia_rowsAsSK().forEach(function (r) {
        if (_isOrderCancelled(r.Payment_Status)) return;
        const dd = r.Order_Date instanceof Date
          ? Utilities.formatDate(r.Order_Date, "Asia/Kolkata", "yyyy-MM-dd")
          : String(r.Order_Date || "").trim();
        if (!dd) return;
        const meal = String(r.Meal_Type || "").trim();
        if (sawIA[dd] && sawIA[dd][meal] !== undefined) sawIA[dd][meal] = true;
      });
    }
  } catch (e) {}

  Object.keys(mealOrderCounts).forEach(function(dd) {
    ["Breakfast", "Lunch", "Dinner"].forEach(function(m) {
      if (sawEnkin[dd][m]) mealOrderCounts[dd][m]++;
      if (sawIA[dd][m])    mealOrderCounts[dd][m]++;
    });
  });

  const breakfastMaster = bfRows.map(r => ({
    id: String(r.ID), name: String(r.Name), price: Number(r.Price),
    default_on: r.Active === true || String(r.Active).toUpperCase() === "TRUE"
  }));

  const sabjiMaster = sabjiRows.map(r => ({
    id: String(r.ID), name: String(r.Name), type: String(r.Type),
    active: String(r.Active).toLowerCase() !== "false"
  }));

  const menuEntries = menuRows.map(r => {
    const d = r.Date instanceof Date
      ? Utilities.formatDate(r.Date, "Asia/Kolkata", "yyyy-MM-dd")
      : String(r.Date).trim();
    const co = {};
    if (r.Cutoff_Breakfast) co.Breakfast = Number(r.Cutoff_Breakfast);
    if (r.Cutoff_Lunch)     co.Lunch     = Number(r.Cutoff_Lunch);
    if (r.Cutoff_Dinner)    co.Dinner    = Number(r.Cutoff_Dinner);
    let breakfast = [];
    try { if (r.Breakfast_JSON) breakfast = JSON.parse(r.Breakfast_JSON); } catch(e) {}
    let oosItems = { Breakfast: [], Lunch: [], Dinner: [] };
    try { if (r.OOS_JSON) oosItems = JSON.parse(r.OOS_JSON); } catch(e) {}
    let ordersClosed = {};
    try { if (r.Orders_Closed) ordersClosed = JSON.parse(r.Orders_Closed); } catch(e) {}
    let stockLimits = {};
    try { if (r.Stock_JSON) stockLimits = JSON.parse(r.Stock_JSON); } catch(e) {}
    let orderCaps = {};
    try { if (r.Order_Cap_JSON) orderCaps = JSON.parse(r.Order_Cap_JSON); } catch(e) {}
    let capAlt = {};
    try { if (r.Cap_Alt_JSON) capAlt = JSON.parse(r.Cap_Alt_JSON); } catch(e) {}
    const orderedCounts = countsByDate[d] || { Breakfast: {}, Lunch: {}, Dinner: {} };
    const unitsRemaining = {};
    ["Breakfast","Lunch","Dinner"].forEach(meal => {
      Object.entries(stockLimits[meal] || {}).forEach(([colKey, limit]) => {
        if (SABJI_COMBO_GROUPS[colKey]) return; // virtual combo entry — not a real item, handled below
        if (!unitsRemaining[meal]) unitsRemaining[meal] = {};
        unitsRemaining[meal][colKey] = Math.max(0, limit - (orderedCounts[meal][itemsJsonKey(colKey)] || 0));
      });
    });
    // Dry/Curry Sabji Mini+Full share a weighted pool when a combo limit is set.
    _applySabjiComboLimits(stockLimits, orderedCounts, unitsRemaining);
    const comboStock = { Lunch: _sabjiComboStatus(stockLimits, orderedCounts, "Lunch"),
                          Dinner: _sabjiComboStatus(stockLimits, orderedCounts, "Dinner") };
    const kitchenClosed = (r.Kitchen_Closed === true ||
      String(r.Kitchen_Closed || "").toLowerCase() === "true");
    const closedMeals = _closedMealsObj(r); // per-meal closure {Breakfast,Lunch,Dinner}
    return {
      date:             d,
      breakfast:        breakfast,
      lunch_dry:        r.Lunch_Dry    || "",
      lunch_curry:      r.Lunch_Curry  || "",
      dinner_dry:       r.Dinner_Dry   || "",
      dinner_curry:     r.Dinner_Curry || "",
      cutoff_overrides: co,
      oos_items:        oosItems,
      orders_closed:    ordersClosed,
      stock_limits:     stockLimits,
      units_remaining:  unitsRemaining,
      combo_stock:      comboStock,
      order_caps:       orderCaps,
      cap_alt:          capAlt,
      order_counts:     mealOrderCounts[d] || { Breakfast: 0, Lunch: 0, Dinner: 0 },
      kitchen_closed:   kitchenClosed,
      closed_meals:     closedMeals,
    };
  });

  // default_caps: the site-wide per-meal delivery caps (admin-editable via SK_Default_Caps,
  // falls back to the hardcoded DEFAULT_ORDER_CAPS in 00_Config if the sheet is empty).
  // menuEntries' order_caps stay PER-DATE-ONLY (what the admin typed) so saving a menu
  // never bakes the defaults into the date — the panel shows defaults as placeholders.
  return {breakfastMaster, sabjiMaster, menuEntries, default_caps: _getDefaultOrderCaps()};
}

// ── ADMIN: SAVE MENU ─────────────────────────────────────────
function saveMenu(body) {
  const ss = getSpreadsheet();
  // Always pass full headers so schema self-heals if initSchema() was never run
  const ws = getOrCreateTab(ss, TAB_MENU, [
    "Date","Breakfast_JSON","Lunch_Dry","Lunch_Curry","Dinner_Dry","Dinner_Curry",
    "Cutoff_Breakfast","Cutoff_Lunch","Cutoff_Dinner",
    "OOS_JSON","Orders_Closed","Stock_JSON","Kitchen_Closed","Order_Cap_JSON","Cap_Alt_JSON"
  ]);
  const rows = getAllRows(ws);
  let hIdx = headerIndex(ws);

  // Self-heal: ensure Kitchen_Closed column exists for legacy sheets.
  if (!hIdx["Kitchen_Closed"]) {
    ws.getRange(1, ws.getLastColumn() + 1).setValue("Kitchen_Closed");
    SpreadsheetApp.flush();
    hIdx = headerIndex(ws);
  }
  // Self-heal: ensure Order_Cap_JSON column exists (per-meal max-order caps).
  if (!hIdx["Order_Cap_JSON"]) {
    ws.getRange(1, ws.getLastColumn() + 1).setValue("Order_Cap_JSON");
    SpreadsheetApp.flush();
    hIdx = headerIndex(ws);
  }
  // Self-heal: ensure Cap_Alt_JSON column exists (per-meal: offer Self Pickup /
  // Porter when delivery is full? default ON; false = hard sold-out).
  if (!hIdx["Cap_Alt_JSON"]) {
    ws.getRange(1, ws.getLastColumn() + 1).setValue("Cap_Alt_JSON");
    SpreadsheetApp.flush();
    hIdx = headerIndex(ws);
  }

  const dateStr     = body.date;
  const existing    = rows.find(r => {
    const d = r.Date instanceof Date
      ? Utilities.formatDate(r.Date, "Asia/Kolkata", "yyyy-MM-dd")
      : String(r.Date).trim();
    return d === dateStr;
  });

  // breakfast comes as array from admin, serialise to JSON string for storage
  const bfJson = body.breakfast
    ? JSON.stringify(body.breakfast)
    : (body.breakfastJson || "");

  // Preserve the existing Kitchen_Closed flag — regular menu saves
  // should never silently flip it. Use setKitchenClosed() to change it.
  const preservedKitchenClosed = existing
    ? (existing.Kitchen_Closed === true ||
       String(existing.Kitchen_Closed || "").toLowerCase() === "true")
    : false;

  const newRow = [
    dateStr,
    bfJson,
    body.lunch_dry        || body.lunchDry    || "",
    body.lunch_curry      || body.lunchCurry  || "",
    body.dinner_dry       || body.dinnerDry   || "",
    body.dinner_curry     || body.dinnerCurry || "",
    body.cutoff_breakfast || body.cutoffBf    || "",
    body.cutoff_lunch     || body.cutoffL     || "",
    body.cutoff_dinner    || body.cutoffD     || "",
    JSON.stringify(body.oos_items    || { Breakfast: [], Lunch: [], Dinner: [] }),
    JSON.stringify(body.orders_closed || {}),
    JSON.stringify(body.stock_limits || {}),
    preservedKitchenClosed ? "TRUE" : "",
    // Per-meal max-order caps, e.g. {"Breakfast":50,"Lunch":80}. Preserve any
    // existing caps if this save doesn't carry order_caps (don't silently reopen).
    (body.order_caps !== undefined)
      ? JSON.stringify(body.order_caps || {})
      : (existing && existing.Order_Cap_JSON ? String(existing.Order_Cap_JSON) : "{}"),
    // Per-meal "offer Self Pickup / Porter when delivery full" flags, e.g.
    // {"Breakfast":false}. Missing/true = offer alternatives (default). Preserve
    // if this save doesn't carry cap_alt.
    (body.cap_alt !== undefined)
      ? JSON.stringify(body.cap_alt || {})
      : (existing && existing.Cap_Alt_JSON ? String(existing.Cap_Alt_JSON) : "{}"),
  ];

  if (existing) {
    ws.getRange(existing._row, 1, 1, newRow.length).setValues([newRow]);
  } else {
    ws.appendRow(newRow);
  }
  // Bust per-date menu cache and the aggregated admin-data cache
  _invalidateCache("menu_v2_" + dateStr, "adminData_v1", "kitchen_closed_dates_v1");
  return {success: true, action: existing ? "updated" : "saved"};
}

// ── ADMIN: KITCHEN CLOSURE TOGGLE ─────────────────────────────
// Marks a single date as "Kitchen Closed" (or reopens it).
//
// Flow:
//   1. If isClosed === true AND there are active orders for that date
//      AND confirmCancelOrders !== true → returns
//      { requires_confirm: true, orderCount, totalAmount } so the admin
//      UI can show "X orders worth ₹Y — cancel + refund all and close?"
//   2. If confirmed (or no orders exist) → cancel + refund every active
//      order for that date (wallet payments refund instantly to wallet,
//      UPI payments go to manual_upi refund queue) and set Kitchen_Closed.
//   3. If isClosed === false → simply clear the flag (no order action).
const KITCHEN_MEALS = ["Breakfast", "Lunch", "Dinner"];

// Canonical: which meals are kitchen-closed for a SK_Daily_Menu row? Legacy full-day
// Kitchen_Closed=TRUE ⇒ all three closed; partial closures live in Closed_Meals_JSON
// ({"Breakfast":true,…}). Returns { Breakfast, Lunch, Dinner } booleans.
function _closedMealsObj(menuRow) {
  const full = !!(menuRow && (menuRow.Kitchen_Closed === true ||
    String(menuRow.Kitchen_Closed || "").toLowerCase() === "true"));
  const obj = { Breakfast: full, Lunch: full, Dinner: full };
  if (!full && menuRow && menuRow.Closed_Meals_JSON) {
    try {
      const cm = JSON.parse(menuRow.Closed_Meals_JSON);
      KITCHEN_MEALS.forEach(function (m) { if (cm && cm[m]) obj[m] = true; });
    } catch (e) {}
  }
  return obj;
}
function _isMealKitchenClosed(menuRow, meal) { return !!_closedMealsObj(menuRow)[meal]; }

function setKitchenClosed(body) {
  const pin = String(body && body.pin || "").trim();
  if (pin !== ADMIN_PIN) return { success: false, error: "STRICT ADMIN PIN REQUIRED" };

  const dateStr = String(body.date || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return { success: false, error: "Invalid date format (expected YYYY-MM-DD)" };
  }
  const isClosed = (body.isClosed === true || String(body.isClosed) === "true");
  const confirmCancelOrders = (body.confirmCancelOrders === true ||
                               String(body.confirmCancelOrders) === "true");

  // Which meals to act on? Absent/empty ⇒ FULL DAY (all three) — backward compatible
  // with the old whole-day toggle and the "Full Day" selection.
  let meals = Array.isArray(body.meals)
    ? body.meals.map(String).filter(function (m) { return KITCHEN_MEALS.indexOf(m) !== -1; })
    : [];
  if (!meals.length) meals = KITCHEN_MEALS.slice();
  const mealSel = {}; meals.forEach(function (m) { mealSel[m] = true; });

  const ss = getSpreadsheet();
  const menuWs = getOrCreateTab(ss, TAB_MENU, [
    "Date","Breakfast_JSON","Lunch_Dry","Lunch_Curry","Dinner_Dry","Dinner_Curry",
    "Cutoff_Breakfast","Cutoff_Lunch","Cutoff_Dinner",
    "OOS_JSON","Orders_Closed","Stock_JSON","Kitchen_Closed","Order_Cap_JSON","Cap_Alt_JSON","Closed_Meals_JSON"
  ]);
  let mIdx = headerIndex(menuWs);
  ["Kitchen_Closed", "Closed_Meals_JSON"].forEach(function (col) {
    if (!mIdx[col]) menuWs.getRange(1, menuWs.getLastColumn() + 1).setValue(col);
  });
  SpreadsheetApp.flush(); mIdx = headerIndex(menuWs);

  // Current per-meal closed state for this date.
  const _menuRowNow = getAllRows(menuWs).find(function (x) {
    const d = x.Date instanceof Date ? Utilities.formatDate(x.Date, "Asia/Kolkata", "yyyy-MM-dd") : String(x.Date || "").trim();
    return d === dateStr;
  });
  const curClosed = _closedMealsObj(_menuRowNow);

  // If closing AND not yet confirmed: count affected orders (of the SELECTED meals) + amount.
  if (isClosed) {
    const ordersWs = ss.getSheetByName(TAB_ORDERS);
    const oRows = ordersWs ? getAllRows(ordersWs) : [];
    const activeMatches = oRows.filter(function(r) {
      const od = r.Order_Date instanceof Date
        ? Utilities.formatDate(r.Order_Date, "Asia/Kolkata", "yyyy-MM-dd")
        : String(r.Order_Date || "").trim();
      if (od !== dateStr) return false;
      if (!mealSel[String(r.Meal_Type || "").trim()]) return false; // only the selected meals
      return !_isOrderCancelled(r.Payment_Status);
    });

    if (activeMatches.length && !confirmCancelOrders) {
      const total = activeMatches.reduce(function(s, r) {
        return s + (Number(r.Net_Total) || 0);
      }, 0);
      const customers = {};
      activeMatches.forEach(function(r) { customers[String(r.Phone || "")] = true; });
      return {
        success: false,
        requires_confirm: true,
        orderCount: activeMatches.length,
        customerCount: Object.keys(customers).length,
        totalAmount: total,
        date: dateStr,
        meals: meals,
        message: "There are " + activeMatches.length + " active " + meals.join("/") + " order(s) totaling ₹"
               + total + " across " + Object.keys(customers).length
               + " customer(s) for " + dateStr
               + ". Closing will cancel and refund all of them. Confirm?"
      };
    }

    // Auto-cancel + refund every active order for this date. deleteOrder
    // auto-detects "On Account" status from the row itself, so passing
    // rType="none" for those is safe — it routes to the On-Account branch
    // (row marked Cancelled, no payout, auto-excluded from monthly bills).
    let cancelled = 0;
    let refundedWallet = 0;
    let refundedUpi = 0;
    let onAccountAdjusted = 0;     // billed-later customers — nothing to pay back
    activeMatches.forEach(function(r) {
      const pStat = String(r.Payment_Status || "").toLowerCase();
      let rType = "none";
      let bucket = "other";
      if (pStat === "wallet paid") { rType = "wallet"; bucket = "wallet"; }
      else if (_isOnAccountDueStatus(pStat)) { rType = "none"; bucket = "on_account"; }
      else if (pStat === "paid") { rType = "manual_upi"; bucket = "upi"; }
      else if (pStat.indexOf("pending") !== -1) { rType = "none"; bucket = "other"; }  // unpaid — cancel only, no refund (don't inflate the UPI-refund summary total)

      try {
        const res = deleteOrder(String(r.Phone || ""), String(r.Submission_ID || ""),
                                rType, { isAdmin: true });
        if (res && res.success) {
          cancelled++;
          const amt = Number(r.Net_Total) || 0;
          if (bucket === "wallet")     refundedWallet    += amt;
          if (bucket === "upi")        refundedUpi       += amt;
          if (bucket === "on_account") onAccountAdjusted += amt;
        }
        SpreadsheetApp.flush();
      } catch(e) {
        console.error("setKitchenClosed: deleteOrder failed for " + r.Submission_ID + ": " + e.message);
      }
    });

    // Merge the selected meals into the closed set + persist.
    const newClosed = { Breakfast: curClosed.Breakfast, Lunch: curClosed.Lunch, Dinner: curClosed.Dinner };
    meals.forEach(function (m) { newClosed[m] = true; });
    _writeClosedMeals(menuWs, mIdx, dateStr, newClosed);
    _invalidateCache("menu_v2_" + dateStr, "kitchen_closed_dates_v1", "kitchen_closed_set_v1", "kitchen_closed_mealset_v1", "adminData_v1");

    const closedList = KITCHEN_MEALS.filter(function (m) { return newClosed[m]; });
    const isFullDay = closedList.length === 3;

    // Build a human-readable breakdown including On Account (was missing).
    var parts = [];
    if (refundedWallet > 0)    parts.push("₹" + refundedWallet + " refunded to wallets");
    if (refundedUpi > 0)       parts.push("₹" + refundedUpi + " queued for UPI refund");
    if (onAccountAdjusted > 0) parts.push("₹" + onAccountAdjusted + " removed from On-Account balances (no payout — just won't be billed)");
    var breakdown = parts.length ? (" — " + parts.join(", ") + ".") : ".";

    return {
      success: true,
      isClosed: true,
      closedMeals: closedList,
      fullDay: isFullDay,
      cancelled: cancelled,
      refundedWallet: refundedWallet,
      refundedUpi: refundedUpi,
      onAccountAdjusted: onAccountAdjusted,
      message: (isFullDay ? "Kitchen closed (full day)" : "Closed " + meals.join(", ")) + " for " + dateStr + ". "
             + cancelled + " order(s) cancelled" + breakdown
    };
  }

  // Re-opening the selected meals: remove them from the closed set. No order action
  // (already-cancelled orders stay cancelled — matches the previous whole-day behaviour).
  const newClosed = { Breakfast: curClosed.Breakfast, Lunch: curClosed.Lunch, Dinner: curClosed.Dinner };
  meals.forEach(function (m) { newClosed[m] = false; });
  _writeClosedMeals(menuWs, mIdx, dateStr, newClosed);
  _invalidateCache("menu_v2_" + dateStr, "kitchen_closed_dates_v1", "kitchen_closed_set_v1", "kitchen_closed_mealset_v1", "adminData_v1");
  const stillClosed = KITCHEN_MEALS.filter(function (m) { return newClosed[m]; });
  return {
    success: true, isClosed: false, closedMeals: stillClosed, fullDay: false,
    message: (stillClosed.length ? ("Re-opened " + meals.join(", ") + " — still closed: " + stillClosed.join(", "))
                                 : "Kitchen re-opened") + " for " + dateStr + "."
  };
}

// Persist per-meal closure. Closed_Meals_JSON holds the {meal:true} set; the legacy
// Kitchen_Closed boolean is set TRUE only when ALL three meals are closed, so every
// existing full-day reader keeps working. Creates the menu row if none exists.
function _writeClosedMeals(menuWs, mIdx, dateStr, closedObj) {
  const closedList = KITCHEN_MEALS.filter(function (m) { return closedObj[m]; });
  const jsonVal = closedList.length
    ? JSON.stringify(closedList.reduce(function (o, m) { o[m] = true; return o; }, {})) : "";
  const fullDay = closedList.length === 3;
  const kcCol = mIdx["Kitchen_Closed"], cmCol = mIdx["Closed_Meals_JSON"];
  const existing = getAllRows(menuWs).find(function(x) {
    const d = x.Date instanceof Date
      ? Utilities.formatDate(x.Date, "Asia/Kolkata", "yyyy-MM-dd")
      : String(x.Date || "").trim();
    return d === dateStr;
  });
  if (existing) {
    menuWs.getRange(existing._row, kcCol).setValue(fullDay ? "TRUE" : "");
    menuWs.getRange(existing._row, cmCol).setValue(jsonVal);
  } else {
    const newRow = new Array(menuWs.getLastColumn()).fill("");
    newRow[mIdx["Date"] - 1] = dateStr;
    newRow[kcCol - 1] = fullDay ? "TRUE" : "";
    newRow[cmCol - 1] = jsonVal;
    menuWs.appendRow(newRow);
  }
  SpreadsheetApp.flush();
}

// ── ADMIN: BREAKFAST MASTER CRUD ─────────────────────────────
function saveBreakfastItem(body) {
  const ss = getSpreadsheet();
  const ws = getOrCreateTab(ss, TAB_BF_MASTER, []);
  const rows = getAllRows(ws);

  // Admin sends "default_on" (true/false); map to Active column
  const isActive = body.default_on !== false && body.default_on !== "false";

  if (body.id) {
    const r = rows.find(x => String(x.ID) === String(body.id));
    if (r) {
      const hIdx = headerIndex(ws);
      ws.getRange(r._row, hIdx["Name"]).setValue(body.name);
      ws.getRange(r._row, hIdx["Price"]).setValue(body.price);
      ws.getRange(r._row, hIdx["Active"]).setValue(isActive ? "true" : "false");
      _invalidateCache("adminData_v1");
      return {success: true};
    }
  }
  const newId = "BF-" + new Date().getTime();
  ws.appendRow([newId, body.name, body.price, isActive ? "true" : "false"]);
  _invalidateCache("adminData_v1");
  return {success: true, id: newId};
}

function deleteBreakfastItem(id) {
  const ss = getSpreadsheet();
  const ws = getOrCreateTab(ss, TAB_BF_MASTER, []);
  const rows = getAllRows(ws);
  const r = rows.find(x => String(x.ID) === String(id));
  if (!r) return {success: false, error: "Not found"};
  ws.deleteRow(r._row);
  _invalidateCache("adminData_v1");
  return {success: true};
}

// ── ADMIN: SABJI MASTER CRUD ──────────────────────────────────
function saveSabjiItem(body) {
  const ss = getSpreadsheet();
  const ws = getOrCreateTab(ss, TAB_SABJI, []);
  const rows = getAllRows(ws);

  if (body.id) {
    const r = rows.find(x => String(x.ID) === String(body.id));
    if (r) {
      const hIdx = headerIndex(ws);
      ws.getRange(r._row, hIdx["Name"]).setValue(body.name);
      ws.getRange(r._row, hIdx["Type"]).setValue(body.type);
      ws.getRange(r._row, hIdx["Active"]).setValue(body.active !== false ? "true" : "false");
      _invalidateCache("adminData_v1");
      return {success: true};
    }
  }
  const newId = "SB-" + new Date().getTime();
  ws.appendRow([newId, body.name, body.type || "Dry", "true"]);
  _invalidateCache("adminData_v1");
  return {success: true, id: newId};
}

function deleteSabjiItem(id) {
  const ss = getSpreadsheet();
  const ws = getOrCreateTab(ss, TAB_SABJI, []);
  const rows = getAllRows(ws);
  const r = rows.find(x => String(x.ID) === String(id));
  if (!r) return {success: false, error: "Not found"};
  ws.deleteRow(r._row);
  return {success: true};
}

// ── CUSTOMER LEDGER ──────────────────────────────────────────
function _getLedgerFolder(year) {
  const parentName = LEDGER_FOLDER;
  const yearStr    = String(year);
  const parents    = DriveApp.getFoldersByName(parentName);
  let parent;
  if (parents.hasNext()) { parent = parents.next(); }
  else { parent = DriveApp.createFolder(parentName); }

  const children = parent.getFoldersByName(yearStr);
  if (children.hasNext()) return children.next();
  return parent.createFolder(yearStr);
}

function _getOrCreateCustomerLedger(ss, phone, name, year) {
  // Check if ledger ID already stored
  const custWs  = getOrCreateTab(ss, TAB_CUSTOMERS, CUSTOMERS_HEADERS);
  const custRows = getAllRows(custWs);
  const cust = custRows.find(r => String(r.Phone).trim() === String(phone).trim());

  if (cust && cust.Ledger_Sheet_ID) {
    try {
      return SpreadsheetApp.openById(cust.Ledger_Sheet_ID);
    } catch(e) { /* file may have been deleted */ }
  }

  const folder  = _getLedgerFolder(year);
  const ledger  = SpreadsheetApp.create(`Svaadh — ${name} (${phone})`);
  DriveApp.getFileById(ledger.getId()).moveTo(folder);

  // Store ID in customers sheet
  if (cust) {
    const hIdx = headerIndex(custWs);
    if (hIdx["Ledger_Sheet_ID"]) {
      custWs.getRange(cust._row, hIdx["Ledger_Sheet_ID"]).setValue(ledger.getId());
    }
  }
  return ledger;
}

function _ensureMonthTab(ledgerSs, year, monthIdx) {
  const MONTHS = ["January","February","March","April","May","June",
                  "July","August","September","October","November","December"];
  const tabName = `${MONTHS[monthIdx]} ${year}`;
  let ws = ledgerSs.getSheetByName(tabName);
  if (ws) return ws;

  ws = ledgerSs.insertSheet(tabName);
  const headers = ["Submission_ID","Date","Meal","Items Ordered","Subtotal (₹)","Delivery (₹)","Discount (₹)","Net Total (₹)"];
  const periods = ["1–10","11–20","21–end"];

  let row = 1;
  periods.forEach(p => {
    ws.getRange(row, 1).setValue(`● Period ${p}`).setFontWeight("bold").setBackground("#f5f0eb");
    ws.getRange(row, 1, 1, headers.length).merge();
    row++;
    ws.getRange(row, 1, 1, headers.length).setValues([headers]).setFontWeight("bold").setBackground("#c0392b").setFontColor("white");
    row++;
    // 3 blank data rows (grow dynamically)
    row += 3;
    ws.getRange(row, 1).setValue("Period Total").setFontWeight("bold");
    ws.getRange(row, 7).setFormula(`=SUMIF(G${row-3}:G${row-1},"<>",G${row-3}:G${row-1})`);
    row += 2;
  });
  return ws;
}

function _updateLedger(ss, profile, orders) {
  const ist  = new Date(new Date().getTime() + 5.5 * 3600 * 1000);
  const year = ist.getFullYear();
  const monthIdx = ist.getMonth();

  const ledger = _getOrCreateCustomerLedger(ss, profile.phone, profile.name, year);
  const ws     = _ensureMonthTab(ledger, year, monthIdx);

  for (const order of orders) {
    for (const meal of order.meals) {
      const sid = meal._sid || order.submissionId || "";
      const summary = (meal.items || [])
        .filter(function(it){ return it.qty > 0; })
        .map(function(it){ return it.qty + "×" + it.colKey; })
        .join(", ") || "—";
      const delCharge = meal.deliveryCharge || 0;
      const discAmt   = meal.discountAmount  || 0;
      const netTotal  = meal.subtotal + delCharge - discAmt;
      ws.appendRow([sid, order.date, meal.type, summary, meal.subtotal, delCharge, discAmt, netTotal]);
    }
  }
}

// ── AREAS ────────────────────────────────────────────────────

const AREAS_HEADERS = ["Area_Name", "Area_Label", "Free_Delivery"];

const DEFAULT_AREAS = [
  ["Amanora",         "Amanora Town",                              "FALSE"],
  ["BG Shirke Road",  "BG Shirke Road",                            "FALSE"],
  ["Bhosale Nagar",   "Bhosale Nagar (Free Delivery)",             "TRUE"],
  ["DP Road",         "DP Road",                                   "FALSE"],
  ["Gadital",         "Gadital",                                   "FALSE"],
  ["Mandai",          "Hadapsar Mandai",                           "FALSE"],
  ["Kirtane Baug",    "Kirtane Baug",                              "FALSE"],
  ["Magarpatta",      "Magarpatta",                                "FALSE"],
  ["Malwadi",         "Malwadi",                                   "FALSE"],
  ["Pune-Solapur Road", "Pune-Solapur Road (Magarpatta Bridge to Gadital Only)", "FALSE"],
  ["SadeSatraNali",   "SadeSatraNali",                             "FALSE"],
  ["Triveni Nagar",   "Triveni Nagar (Free Delivery)",             "TRUE"],
  ["Tupe Patil Road", "Tupe Patil Road",                           "FALSE"],
  ["Vihar Chowk",     "Vihar Chowk",                               "FALSE"],
  ["Pickup",          "📦 Self Pickup (Waives all fees)",             "TRUE"]
];

function getAreas() {
  return _cachedData("areas_v1", 300, function() {
    const ss = getSpreadsheet();
    const ws = getOrCreateTab(ss, TAB_AREAS, AREAS_HEADERS);
    const rows = getAllRows(ws);
    // Seed defaults on first run
    if (rows.length === 0) {
      DEFAULT_AREAS.forEach(function(r) { ws.appendRow(r); });
      return DEFAULT_AREAS.map(function(r) { return {name:r[0], label:r[1], free:true}; });
    }
    return rows.map(function(r) {
      return {name: r.Area_Name, label: r.Area_Label, free: r.Free_Delivery === true || String(r.Free_Delivery).toUpperCase() === "TRUE"};
    });
  });
}

function saveArea(body) {
  const ss = getSpreadsheet();
  const ws = getOrCreateTab(ss, TAB_AREAS, AREAS_HEADERS);
  const data = ws.getDataRange().getValues();
  const headers = data[0];
  const nameIdx = headers.indexOf("Area_Name");
  const labelIdx = headers.indexOf("Area_Label");
  const freeIdx = headers.indexOf("Free_Delivery");
  // Update if exists
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][nameIdx]).toLowerCase() === String(body.name).toLowerCase()) {
      data[i][labelIdx] = body.label;
      data[i][freeIdx]  = body.free ? "TRUE" : "FALSE";
      ws.getDataRange().setValues(data);
      _invalidateCache("areas_v1");
      return {success: true};
    }
  }
  // Add new
  ws.appendRow([body.name, body.label, body.free ? "TRUE" : "FALSE"]);
  _invalidateCache("areas_v1");
  return {success: true};
}

function deleteArea(body) {
  const ss = getSpreadsheet();
  const ws = getOrCreateTab(ss, TAB_AREAS, AREAS_HEADERS);
  const data = ws.getDataRange().getValues();
  const nameIdx = data[0].indexOf("Area_Name");
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][nameIdx]) === String(body.name)) {
      ws.deleteRow(i + 1);
      _invalidateCache("areas_v1");
      return {success: true};
    }
  }
  return {success: false, error: "Area not found"};
}

// ── REFUND MANAGEMENT (ADMIN) ────────────────────────────────
function getPendingRefunds() {
  const ss = getSpreadsheet();
  const ws = getOrCreateTab(ss, TAB_REFUNDS, ["Submission_ID","Phone","Name","Amount","Meal","Date","Status","Timestamp","Adjustment_Note","Refund_Mode"]);
  const rows = getAllRows(ws);
  return rows.filter(r => ["Pending", "Verification Required"].includes(String(r.Status)));
}

// READ-ONLY diagnostic: the last `n` SK_Refunds rows regardless of status — lets us
// read the Adjustment_Note (e.g. "auto-refund FAILED (<api error>)") of rows the
// owner already processed, which getPendingRefunds filters out.
function listRecentRefunds(n) {
  const ss = getSpreadsheet();
  const ws = getOrCreateTab(ss, TAB_REFUNDS, ["Submission_ID","Phone","Name","Amount","Meal","Date","Status","Timestamp","Adjustment_Note","Refund_Mode"]);
  const rows = getAllRows(ws);
  const take = Math.max(1, Math.min(Number(n) || 30, 100));
  return { success: true, total: rows.length, rows: rows.slice(-take) };
}

function markRefunded(submissionId, forceWallet = false) {
  // Serialize so a double-click / concurrent batch can't process the same
  // refund row twice (which would credit the wallet again).
  const lock = LockService.getScriptLock();
  try { lock.waitLock(8000); } catch(e) { return {success: false, error: "Server busy — please retry"}; }
  try {
  const ss = getSpreadsheet();
  const ws = getOrCreateTab(ss, TAB_REFUNDS, []);
  const data = ws.getDataRange().getValues();
  const h = data[0];
  const idIdx = h.indexOf("Submission_ID");
  const statusIdx = h.indexOf("Status");
  const phoneIdx = h.indexOf("Phone");
  const nameIdx = h.indexOf("Name");
  const amtIdx = h.indexOf("Amount");
  const modeIdx = h.indexOf("Refund_Mode");

  if (idIdx === -1 || statusIdx === -1) return {success: false, error: "Sheet layout error"};

  const now = Utilities.formatDate(new Date(), "Asia/Kolkata", "yyyy-MM-dd HH:mm");
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][idIdx]) === String(submissionId)) {
      const row = data[i];
      // Idempotency guard: if this refund was already settled, do NOT credit
      // again. (Matched by submission id only, so without this a re-fire would
      // re-run the wallet credit.)
      const curStatus = String(row[statusIdx] || "").trim().toLowerCase();
      if (curStatus.indexOf("refunded") === 0 || curStatus.indexOf("rejected") === 0) {
        return {success: true, alreadyProcessed: true};
      }
      
      let mode = modeIdx !== -1 ? String(row[modeIdx]).toLowerCase() : "upi";
      if (forceWallet) {
        mode = "wallet";
        if (modeIdx !== -1) {
          ws.getRange(i + 1, modeIdx + 1).setValue("Wallet");
        }
      }
      
      const phone = phoneIdx !== -1 ? String(row[phoneIdx]) : "";
      const name = nameIdx !== -1 ? String(row[nameIdx]) : "Customer";
      const amt = amtIdx !== -1 ? Number(row[amtIdx]) : 0;

      // Logic: If user chose Wallet refund (or we forced it), perform the ledger entry now
      if (mode === "wallet" && phone && amt > 0) {
        _appendWalletTransaction(phone, name, "Order Cancellation Refund", amt, true, String(submissionId));
      }

      // Mark the refund row as done
      ws.getRange(i + 1, statusIdx + 1).setValue("Refunded (" + now + ")");

      // ── Update the source order row remark to reflect completed refund ──
      // This closes the audit loop: the SK_Orders row was previously marked
      // "Cancelled – UPI Refund Pending" (or similar); now update it.
      try {
        const ordersWs = ss.getSheetByName(TAB_ORDERS);
        if (ordersWs) {
          const ordersData = ordersWs.getDataRange().getValues();
          const oHeaders = ordersData[0];
          const oIdIdx = oHeaders.indexOf("Submission_ID");
          const oStatusIdx = oHeaders.indexOf("Payment_Status");
          if (oIdIdx !== -1 && oStatusIdx !== -1) {
            for (var j = 1; j < ordersData.length; j++) {
              if (String(ordersData[j][oIdIdx]) === String(submissionId)) {
                const finalRemark = mode === "wallet"
                  ? "Cancelled \u2013 Refunded to Wallet (" + now + ")"
                  : "Cancelled \u2013 Refunded via UPI (" + now + ")";
                ordersWs.getRange(j + 1, oStatusIdx + 1).setValue(finalRemark);
                break;
              }
            }
          }
        }
      } catch(e) { /* non-fatal — refund row already updated */ }

      return {success: true};
    }
  }
  return {success: false, error: "Refund request not found"};
  } finally {
    lock.releaseLock();
  }
}

function markRefundRejected(submissionId) {
  const ss = getSpreadsheet();
  const ws = getOrCreateTab(ss, TAB_REFUNDS, []);
  const data = ws.getDataRange().getValues();
  const h = data[0];
  const idIdx = h.indexOf("Submission_ID");
  const statusIdx = h.indexOf("Status");

  if (idIdx === -1 || statusIdx === -1) return {success: false, error: "Sheet layout error"};

  const now = Utilities.formatDate(new Date(), "Asia/Kolkata", "yyyy-MM-dd HH:mm");
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][idIdx]) === String(submissionId)) {
      ws.getRange(i + 1, statusIdx + 1).setValue("Rejected (" + now + ")");
      return {success: true};
    }
  }
  return {success: false, error: "Refund request not found"};
}

// ── ROTI PACKING UTILITY ──────────────────────────────────────
function calculatePackets(total, max) {
  if (total <= 0) return [];
  if (total <= max) return [total];
  var numPacks = Math.ceil(total / max);
  var baseSize = Math.floor(total / numPacks);
  var remainder = total % numPacks;
  var packs = [];
  for (var i = 0; i < numPacks; i++) {
    packs.push(i < remainder ? baseSize + 1 : baseSize);
  }
  return packs;
}

// ── KITCHEN SUMMARY ──────────────────────────────────────────
function getKitchenSummary(date) {
  var ss = getSpreadsheet();
  var ws = getOrCreateTab(ss, TAB_ORDERS, []);
  // Merge IntentAmplify orders (tagged [IA], S4 address) into the same prep view.
  var rows = getRecentRows(ws, 1500).concat(typeof ia_rowsAsSK === "function" ? ia_rowsAsSK() : []);

  var dayRows = rows.filter(function(r) {
    var d = r.Order_Date instanceof Date
      ? Utilities.formatDate(r.Order_Date, "Asia/Kolkata", "yyyy-MM-dd")
      : String(r.Order_Date).trim();
    return d === date;
  });

  var meals = {};
  var ROTI_COLS = ["Chapati","Without_Oil_Chapati","Phulka","Ghee_Phulka","Jowar_Bhakri","Bajra_Bhakri"];
  var ROTI_LIMITS = {
    "Chapati":6, "Without_Oil_Chapati":6,
    "Phulka":12, "Ghee_Phulka":12,
    "Jowar_Bhakri":2, "Bajra_Bhakri":2
  };
  var menu = getMenu(date);

  var orders = [];

  dayRows.forEach(function(r) {
    if (_isOrderCancelled(r.Payment_Status)) return; // exclude cancelled/verify-pending orders
    var meal = String(r.Meal_Type || "");
    if (!meal) return;
    if (!meals[meal]) meals[meal] = {count: 0};
    var m = meals[meal];
    m.count++;

    // For Labels Tab
    var summaryParts = [];
    if (meal === "Breakfast") {
      if (!m.items) m.items = {};
      var bfHasCurdSlot = false;
      for (var n = 1; n <= 4; n++) {
        var item = String(r["BF_Item_"+n] || "").trim();
        var qty  = Number(r["BF_Qty_"+n]) || 0;
        if (item && qty > 0) {
          m.items[item] = (m.items[item] || 0) + qty;
          summaryParts.push(qty + " " + item);
          if (item === "Curd") bfHasCurdSlot = true;
        }
      }
      // Dedupe: submitOrder writes Curd to BOTH BF_Item_N and Curd column.
      var curdBf = Number(r.Curd) || 0;
      if (curdBf > 0 && !bfHasCurdSlot) {
        m.items["Curd"] = (m.items["Curd"] || 0) + curdBf;
        summaryParts.push(curdBf + " Curd");
      }
    } else {
      if (!m.rotis) m.rotis = {};
      if (!m.rotiMatrix) {
        m.rotiMatrix = {};
        ROTI_COLS.forEach(function(c) { m.rotiMatrix[c] = {}; });
      }
      ROTI_COLS.forEach(function(c) {
        var q = Number(r[c]) || 0;
        if (q > 0) {
          m.rotis[c] = (m.rotis[c] || 0) + q;
          summaryParts.push(q + " " + c.replace(/_/g, " "));
          var packs = calculatePackets(q, ROTI_LIMITS[c]);
          packs.forEach(function(p) {
            m.rotiMatrix[c][p] = (m.rotiMatrix[c][p] || 0) + 1;
          });
        }
      });
      if (!m.sabji) {
        m.sabji = {
          dry_kg: 0, curry_kg: 0,
          dry_name: (meal === "Lunch" ? menu.lunch_dry : menu.dinner_dry) || "Sabji (Dry)",
          curry_name: (meal === "Lunch" ? menu.lunch_curry : menu.dinner_curry) || "Sabji (Curry)",
          dry_mini: 0, dry_full: 0, curry_mini: 0, curry_full: 0
        };
      }
      var dMini = Number(r.Dry_Sabji_Mini)||0;
      var dFull = Number(r.Dry_Sabji_Full)||0;
      var cMini = Number(r.Curry_Sabji_Mini)||0;
      var cFull = Number(r.Curry_Sabji_Full)||0;
      m.sabji.dry_mini  += dMini;
      m.sabji.dry_full  += dFull;
      m.sabji.curry_mini += cMini;
      m.sabji.curry_full += cFull;
      
      if (dMini > 0) summaryParts.push(dMini + " Mini Dry");
      if (dFull > 0) summaryParts.push(dFull + " Full Dry");
      if (cMini > 0) summaryParts.push(cMini + " Mini Curry");
      if (cFull > 0) summaryParts.push(cFull + " Full Curry");

      if (!m.other) m.other = {Dal:{kg:0, count:0}, Dal_Fry:{kg:0, count:0}, Rice:{count:0}, Salad:{count:0}, Curd:{count:0}};
      if (!m.riceMatrix)  m.riceMatrix  = {};
      if (!m.saladMatrix) m.saladMatrix = {};
      if (!m.curdMatrix)  m.curdMatrix  = {};

      var dalQ = Number(r.Dal)   || 0;
      var dalFryQ = Number(r.Dal_Fry) || 0;
      var riceQ = Number(r.Rice)  || 0;
      var saladQ = Number(r.Salad) || 0;
      var curdQ = Number(r.Curd)  || 0;
      
      m.other.Dal.kg      += dalQ * 1.33;
      m.other.Dal.count   += dalQ;
      m.other.Dal_Fry.kg      += dalFryQ * 1.33;
      m.other.Dal_Fry.count   += dalFryQ;
      m.other.Rice.count  += riceQ;
      m.other.Salad.count += saladQ;
      m.other.Curd.count  += curdQ;

      // Matrix calculations
      if (riceQ > 0) {
        var rPacks = calculatePackets(riceQ, 3); // RICE_LIMIT = 3
        rPacks.forEach(function(p) { m.riceMatrix[p] = (m.riceMatrix[p] || 0) + 1; });
      }
      if (saladQ > 0) {
        var sPacks = calculatePackets(saladQ, 4); // SALAD_LIMIT = 4
        sPacks.forEach(function(p) { m.saladMatrix[p] = (m.saladMatrix[p] || 0) + 1; });
      }
      if (curdQ > 0) {
        var cPacks = calculatePackets(curdQ, 2); // CURD_LIMIT = 2 (50g cups: 1 or 2 per packet)
        cPacks.forEach(function(p) { m.curdMatrix[p] = (m.curdMatrix[p] || 0) + 1; });
      }

      if (dalQ > 0) summaryParts.push(dalQ + " Dal");
      if (dalFryQ > 0) summaryParts.push(dalFryQ + " Dal Fry");
      if (riceQ > 0) summaryParts.push(riceQ + " Rice");
      if (saladQ > 0) summaryParts.push(saladQ + " Salad");
      if (curdQ > 0) summaryParts.push(curdQ + " Curd");

      // Cross-meal: backend admin sometimes places breakfast items in a
      // Lunch/Dinner order (e.g. Poha/Upma) or writes Chapati via BF_Item
      // slots. Surface them under m.extras so the kitchen UI can show them.
      if (!m.extras) m.extras = {};
      for (var bn = 1; bn <= 4; bn++) {
        var bItem = String(r["BF_Item_"+bn] || "").trim();
        var bQty  = Number(r["BF_Qty_"+bn]) || 0;
        if (!bItem || bQty <= 0) continue;
        // If it matches a roti column name, fold into roti aggregation.
        if (ROTI_COLS.indexOf(bItem) >= 0 || ROTI_COLS.indexOf(bItem.replace(/ /g,"_")) >= 0) {
          var rotiCol = (ROTI_COLS.indexOf(bItem) >= 0) ? bItem : bItem.replace(/ /g,"_");
          m.rotis[rotiCol] = (m.rotis[rotiCol] || 0) + bQty;
          var packsX = calculatePackets(bQty, ROTI_LIMITS[rotiCol]);
          packsX.forEach(function(p) { m.rotiMatrix[rotiCol][p] = (m.rotiMatrix[rotiCol][p] || 0) + 1; });
          summaryParts.push(bQty + " " + rotiCol.replace(/_/g," "));
        } else if (bItem === "Curd") {
          m.other.Curd.count += bQty;
          var cPacksX = calculatePackets(bQty, 2);
          cPacksX.forEach(function(p) { m.curdMatrix[p] = (m.curdMatrix[p] || 0) + 1; });
          summaryParts.push(bQty + " Curd");
        } else {
          // True breakfast-style item placed in lunch/dinner — Poha, Upma, etc.
          m.extras[bItem] = (m.extras[bItem] || 0) + bQty;
          summaryParts.push(bQty + " " + bItem);
        }
      }
    }

    orders.push({
      Submission_ID: String(r.Submission_ID || ""),
      Customer_Name: String(r.Customer_Name || ""),
      Meal_Type: meal,
      summary: summaryParts.join(", "),
      items: {
        Chapati: Number(r.Chapati)||0, Without_Oil_Chapati: Number(r.Without_Oil_Chapati)||0,
        Phulka: Number(r.Phulka)||0, Ghee_Phulka: Number(r.Ghee_Phulka)||0,
        Jowar_Bhakri: Number(r.Jowar_Bhakri)||0, Bajra_Bhakri: Number(r.Bajra_Bhakri)||0,
        Dry_Sabji_Mini: Number(r.Dry_Sabji_Mini)||0, Dry_Sabji_Full: Number(r.Dry_Sabji_Full)||0,
        Curry_Sabji_Mini: Number(r.Curry_Sabji_Mini)||0, Curry_Sabji_Full: Number(r.Curry_Sabji_Full)||0,
        Dal: Number(r.Dal)||0, Dal_Fry: Number(r.Dal_Fry)||0, Rice: Number(r.Rice)||0, Salad: Number(r.Salad)||0, Curd: Number(r.Curd)||0,
        "Kanda Poha": Number(r["Kanda Poha"])||0, "Ghee Upma": Number(r["Ghee Upma"])||0,
        "Thalipeeth": Number(r["Thalipeeth"])||0, "Palak Paratha": Number(r["Palak Paratha"])||0,
        "Paneer Paratha": Number(r["Paneer Paratha"])||0, "Methi Thepla": Number(r["Methi Thepla"])||0,
        "Sabudana Khichdi": Number(r["Sabudana Khichdi"])||0
      },
      Special_Notes_Kitchen: String(r.Special_Notes_Kitchen || ""),
      Special_Notes_Delivery: String(r.Special_Notes_Delivery || ""),
      Delivery_Point: String(r.Delivery_Point || ""),
      marathiNotes: String(r.marathiNotes || ""),
      Packed: r.Packed === true || String(r.Packed).toLowerCase() === "true"
    });
  });

function _customKitchenRound(val) {
  if (val == null || isNaN(val)) return 0;
  var intPart = Math.floor(val);
  var decPart = val - intPart;
  return (decPart >= 0.35 - 1e-9) ? intPart + 1 : intPart;
}

  ["Lunch","Dinner"].forEach(function(meal) {
    if (!meals[meal]) return;
    var m = meals[meal];
    if (m.other && m.other.Dal) m.other.Dal.kg = _customKitchenRound(m.other.Dal.kg);
    if (m.other && m.other.Dal_Fry) m.other.Dal_Fry.kg = _customKitchenRound(m.other.Dal_Fry.kg);
  });

  return {
    date: date,
    meals: meals,
    orders: orders,
    // EFFECTIVE cutoffs (site-wide default merged with any per-day override) —
    // was `menu.cutoff_overrides || {}`, i.e. ONLY the per-day override. Once an
    // admin uses the site-wide "Default Cutoff Times" panel instead of setting a
    // per-day override, cutoff_overrides is legitimately empty for most dates,
    // so kitchen.html's prep countdown fell through to ITS OWN hardcoded
    // fallback (Dinner 16.5 = 4:30 PM) — completely blind to the live default
    // (2026-07-07: admin set 4:15 PM, kitchen countdown still showed 4:30 PM).
    cutoffs: _effectiveCutoffsForDate(date)
  };
}

// ── DRIVER ORDERS ─────────────────────────────────────────────
function getDriverOrders(date) {
  var ss   = getSpreadsheet();
  var ws   = getOrCreateTab(ss, TAB_ORDERS, []);
  // Merge IntentAmplify orders (tagged [IA], S4 delivery) into the driver view.
  var rows = getRecentRows(ws, 1500).concat(typeof ia_rowsAsSK === "function" ? ia_rowsAsSK() : []);
  var meals = {Breakfast: [], Lunch: [], Dinner: []};

  // Load delivery status from SK_Deliveries tab (both EnRoute_At and Delivered_At)
  var delMap = {};
  var delWs  = ss.getSheetByName("SK_Deliveries");
  if (delWs) {
    getRecentRows(delWs, 1500).forEach(function(r) {
      var sid = String(r.Submission_ID || "").trim();
      if (sid) delMap[sid] = {
        deliveredAt: String(r.Delivered_At || ""),
        enRouteAt:   String(r.EnRoute_At   || "")
      };
    });
  }

  // Load customer meal preferences (Source of Truth)
  var custMap = {};
  var custWs = ss.getSheetByName(TAB_CUSTOMERS);
  if (custWs) {
    getAllRows(custWs).forEach(function(r) {
      var ph = _normalizePhone(r.Phone);
      if (ph) {
        custMap[ph] = {
          mealAddresses: r.Meal_Addresses || ""
        };
      }
    });
  }

  rows.forEach(function(r) {
    var d = r.Order_Date instanceof Date
      ? Utilities.formatDate(r.Order_Date, "Asia/Kolkata", "yyyy-MM-dd")
      : String(r.Order_Date).trim();
    if (d !== date) return;
    if (_isOrderCancelled(r.Payment_Status)) return;
    // var area = String(r.Area || "").trim();
    // if (area.toLowerCase().includes("pickup")) return;
    var area = String(r.Area || "").trim();
    var meal = String(r.Meal_Type || "");
    if (!meals[meal]) return;
    var sid = String(r.Submission_ID || "");
    var normP = _normalizePhone(r.Phone);
    meals[meal].push({
      submissionId:  sid,
      name:          String(r.Customer_Name || ""),
      phone:         String(r.Phone || ""),
      area:          area,
      society:       String(r.Society || ""),
      wing:          String(r.Wing || ""),
      flat:          String(r.Flat || ""),
      address:       String(r.Full_Address || ""),
      landmark:      String(r.Landmark || ""),
      deliveryPoint: String(r.Delivery_Point || ""),
      maps:          String(r.Maps_Link || ""),
      notes:         String(r.Special_Notes_Delivery || ""),
      deliveredAt:   (delMap[sid] && delMap[sid].deliveredAt) || "",
      enRouteAt:     (delMap[sid] && delMap[sid].enRouteAt)   || "",
      amount:        Number(r.Net_Total || r.Food_Subtotal || 0),
      paymentStatus: String(r.Payment_Status || ""),
      mealAddresses: custMap[normP] ? custMap[normP].mealAddresses : ""
    });
  });



  return {date: date, meals: meals};
}

// ════════════════════════════════════════════════════════════════════
// DELIVERY ROUTE LEARNING
// Learns the driver's preferred stop order from the sequence in which he
// marks orders delivered (SK_Deliveries.Delivered_At timestamps), grouped
// by Society/building, separately per meal. The driver page then sorts
// undelivered orders by this learned order so deliveries follow his route.
// ════════════════════════════════════════════════════════════════════

// Canonical grouping key for an order row: Society, falling back to Area — via
// _normSocietyKey (base-normalize + SK_Society_Aliases exact/contains rules), so
// "Jasminium society" / "F1-201, jasminium…" / "T43 2502 Gold Tower" all learn
// into ONE route stop instead of splitting the samples across spellings.
function _routeSocietyKey(r) {
  var s = String((r && (r.Society !== undefined ? r.Society : r.society)) || "").trim();
  if (!s) s = String((r && (r.Area !== undefined ? r.Area : r.area)) || "").trim();
  return _normSocietyKey(s);
}

// Raw display spelling for an order row (for the human-readable Society column).
function _routeRawName(r) {
  var s = String((r && (r.Society !== undefined ? r.Society : r.society)) || "").trim();
  if (!s) s = String((r && (r.Area !== undefined ? r.Area : r.area)) || "").trim();
  return s.replace(/\s+/g, " ");
}

// Each meal stores its learned route in its OWN tab, since the driver can take a
// different route for Breakfast vs Lunch vs Dinner.
var ROUTE_MEALS = ["Breakfast", "Lunch", "Dinner"];
function _routeTabName(meal) { return "SK_Delivery_Route_" + meal; }

// Trusted data window for route learning (by Order_Date, inclusive). Deliveries
// OUTSIDE this range are ignored — data before 5 Jun 2026 was unreliable and
// would corrupt the learned route. Update these two dates to shift the window.
var ROUTE_DATA_FROM = "2026-06-05";
// Open-ended upper bound — the old cap ("2026-07-04") would have silently FROZEN
// route learning after that date. FROM still excludes the unreliable pre-Jun-5 data.
var ROUTE_DATA_TO   = "2099-12-31";

// Rebuild the SK_Delivery_Route config from the last `days` (default 30) of
// delivered orders. Non-destructive to orders; only rewrites the route tab.
function buildDeliveryRoute(days) {
  try {
    days = Number(days) > 0 ? Number(days) : 30;
    var ss = getSpreadsheet();
    var ordersWs = getOrCreateTab(ss, TAB_ORDERS, ORDERS_HEADERS);
    var delWs    = getOrCreateTab(ss, "SK_Deliveries", ["Submission_ID", "Delivered_At", "EnRoute_At"]);

    // submissionId → deliveredAt (ms)
    var delMap = {};
    getAllRows(delWs).forEach(function (d) {
      var sid = String(d.Submission_ID || "").trim();
      var da  = d.Delivered_At;
      if (!sid || !da) return;
      var ms = (da instanceof Date) ? da.getTime() : new Date(da).getTime();
      if (!isNaN(ms)) delMap[sid] = ms;
    });

    var now = getISTDate();

    // meal → orderDate → [{ soc, t }]
    var byMealDay = {};
    // canonical key → { rawSpelling → count } — for the human-readable Society column
    // (the canonical key itself is squashed, e.g. "goldtower").
    var prettyAcc = {};
    getAllRows(ordersWs).forEach(function (r) {
      var sid = String(r.Submission_ID || "").trim();
      var t   = delMap[sid];
      if (!t) return; // must have been delivered (has a Delivered_At timestamp)
      if (_isOrderCancelled(r.Payment_Status)) return;
      var meal = String(r.Meal_Type || "").trim();
      if (!meal) return;
      var soc = _routeSocietyKey(r);
      if (!soc) return;
      var od = (r.Order_Date instanceof Date)
        ? Utilities.formatDate(r.Order_Date, "Asia/Kolkata", "yyyy-MM-dd")
        : String(r.Order_Date).trim();
      // Only learn from the trusted data window — ignore earlier (bad) data.
      if (od < ROUTE_DATA_FROM || od > ROUTE_DATA_TO) return;
      var raw = _routeRawName(r);
      if (raw) { (prettyAcc[soc] = prettyAcc[soc] || {})[raw] = (prettyAcc[soc][raw] || 0) + 1; }
      byMealDay[meal] = byMealDay[meal] || {};
      byMealDay[meal][od] = byMealDay[meal][od] || [];
      byMealDay[meal][od].push({ soc: soc, t: t });
    });

    // Most-used raw spelling per canonical key → readable Society column.
    var prettyOf = function (soc) {
      var m = prettyAcc[soc] || {};
      var best = "", n = -1;
      Object.keys(m).forEach(function (raw) { if (m[raw] > n) { best = raw; n = m[raw]; } });
      return best || soc;
    };

    // Per-meal rows: meal → [ [Society, Rank, Avg_Position, Samples], ... ]
    var byMealRows = {};
    Object.keys(byMealDay).forEach(function (meal) {
      var posAcc = {}; // soc → [normalized positions 0..1]
      var daysObj = byMealDay[meal];
      Object.keys(daysObj).forEach(function (od) {
        var list = daysObj[od].slice().sort(function (a, b) { return a.t - b.t; });
        var n = list.length;
        // First occurrence position per society that day (dedupe repeats).
        var seen = {};
        list.forEach(function (item, idx) {
          if (seen[item.soc] === undefined) seen[item.soc] = (n > 1) ? idx / (n - 1) : 0;
        });
        Object.keys(seen).forEach(function (soc) {
          (posAcc[soc] = posAcc[soc] || []).push(seen[soc]);
        });
      });
      var stats = Object.keys(posAcc).map(function (soc) {
        var arr = posAcc[soc].slice().sort(function (a, b) { return a - b; });
        var mid = Math.floor(arr.length / 2);
        var med = (arr.length % 2) ? arr[mid] : (arr[mid - 1] + arr[mid]) / 2;
        return { soc: soc, med: med, samples: arr.length };
      });
      // Earlier median position → earlier in route. Ties: more samples first.
      stats.sort(function (a, b) { return (a.med - b.med) || (b.samples - a.samples); });
      byMealRows[meal] = stats.map(function (s, i) {
        // Society = readable most-used spelling; Key = canonical matching key.
        return [prettyOf(s.soc), i + 1, Math.round(s.med * 1000) / 1000, s.samples, s.soc];
      });
    });

    // Write each meal to ITS OWN tab (SK_Delivery_Route_Breakfast/_Lunch/_Dinner).
    // One common rebuild, but stored & retrieved per meal type. Empty meals are
    // cleared too, so a meal with no recent deliveries shows a blank tab.
    var headers = ["Society", "Rank", "Avg_Position", "Samples", "Updated", "Key", "Pinned_Rank"];
    var stamp = Utilities.formatDate(now, "Asia/Kolkata", "yyyy-MM-dd HH:mm");
    var total = 0;
    var perMeal = {};
    ROUTE_MEALS.forEach(function (meal) {
      var ws = getOrCreateTab(ss, _routeTabName(meal), headers);
      // Self-heal: pre-existing tabs may lack the Key / Pinned_Rank headers.
      if (String(ws.getRange(1, 6).getValue() || "") !== "Key") ws.getRange(1, 6).setValue("Key");
      if (String(ws.getRange(1, 7).getValue() || "") !== "Pinned_Rank") ws.getRange(1, 7).setValue("Pinned_Rank");
      // PRESERVE admin pins across rebuilds — Pinned_Rank is the admin's manual
      // correction ("this society is actually stop #2") and always wins over the
      // learned rank. Keyed canonically so pins survive spelling merges too.
      var pinnedByKey = {};
      getAllRows(ws).forEach(function (r) {
        var pv = Number(r.Pinned_Rank);
        if (!pv || pv <= 0) return;
        var k = _normSocietyKey(String(r.Key || r.Society || ""));
        if (k && pinnedByKey[k] === undefined) pinnedByKey[k] = pv;
      });
      if (ws.getLastRow() > 1) ws.getRange(2, 1, ws.getLastRow() - 1, Math.max(ws.getLastColumn(), headers.length)).clearContent();
      var rows = byMealRows[meal] || [];
      var out = rows.map(function (row) {
        var pin = pinnedByKey[row[4]];
        return [row[0], row[1], row[2], row[3], stamp, row[4], (pin !== undefined ? pin : "")];
      });
      if (out.length) ws.getRange(2, 1, out.length, headers.length).setValues(out);
      total += out.length;
      perMeal[meal] = out.length;
    });

    return { success: true, from: ROUTE_DATA_FROM, to: ROUTE_DATA_TO, count: total, perMeal: perMeal, updated: stamp };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

// Returns the learned route as { meal: { canonicalKey: rank } } for the driver page,
// reading each meal from its own per-meal tab. Keys are CANONICAL (_normSocietyKey);
// old-format rows (no Key column) canonicalize through the Society column, so aliases
// apply even before the first rebuild. Also returns the alias rules so the driver page
// can compute the SAME canonical key client-side for each order.
function getDeliveryRoute() {
  try {
    var ss = getSpreadsheet();
    var headers = ["Society", "Rank", "Avg_Position", "Samples", "Updated", "Key", "Pinned_Rank"];
    var map = {};
    var updated = "";
    ROUTE_MEALS.forEach(function (meal) {
      var ws = getOrCreateTab(ss, _routeTabName(meal), headers);
      map[meal] = {};
      getAllRows(ws).forEach(function (r) {
        var soc    = _normSocietyKey(String(r.Key || r.Society || ""));
        // Admin's Pinned_Rank (manual correction) always beats the learned Rank.
        // Decimals allowed — pin 2.5 to slot a society between stops 2 and 3.
        var pinned = Number(r.Pinned_Rank || 0);
        var rank   = (pinned > 0) ? pinned : Number(r.Rank || 0);
        if (!soc || !rank) return;
        // Variants of one society may collapse to the same canonical key on old-format
        // tabs — keep the EARLIEST (best) rank until a rebuild merges them properly.
        if (map[meal][soc] === undefined || rank < map[meal][soc]) map[meal][soc] = rank;
        if (r.Updated) updated = String(r.Updated);
      });
    });
    var rules = _societyAliasMap();
    return { success: true, route: map, updated: updated,
             alias_rules: { exact: rules.exact || {}, contains: rules.contains || [] } };
  } catch (e) {
    return { success: false, route: {}, error: String(e) };
  }
}

// ════════════════════════════════════════════════════════════════════
// STAFF ATTENDANCE & SALARY  (payroll module)
//  SK_Staff      : roster + pay config (auto-seeded). Paid_Leaves = number of
//                  free (non-deducted) leaves allowed per month before the
//                  per-day deduction kicks in.
//  SK_Attendance : EXCEPTIONS only — a row exists when a day is marked ABSENT,
//                  carries an INCENTIVE (+ bonus) or a DEDUCTION (− advance/
//                  fine), and/or a Note (leave reason / memo). No row = present.
//  SK_Salary_Log : records when a salary/wage was credited (clears the alert
//                  AND forms each staff's pay history).
//  Monthly: per-day = salary / days-in-month; non-Sunday leaves BEYOND the
//  Paid_Leaves allowance each deduct one per-day. Daily (Abhijeet): weekday/Sat
//  rates, Sun off, paid weekly.
// ════════════════════════════════════════════════════════════════════
var ATT_STAFF_TAB = "SK_Staff", ATT_REC_TAB = "SK_Attendance", ATT_SAL_TAB = "SK_Salary_Log";
var ATT_STAFF_HEADERS = ["Name","Type","Monthly_Salary","Pay_Day","Pay_Cycle","Weekday_Rate","Saturday_Rate","Sunday_Rate","Paid_Leaves","Active"];
var ATT_REC_HEADERS   = ["Date","Staff_Name","Status","Incentive","Deduction","Note","Updated"];
var ATT_SAL_HEADERS   = ["Staff_Name","Period","Amount","Credited_At"];

// Append any missing header columns to an existing tab (non-destructive migration
// so older SK_Staff / SK_Attendance tabs gain Paid_Leaves / Deduction).
function _attEnsureCols(ws, headers) {
  var lastCol = ws.getLastColumn();
  var existing = lastCol > 0 ? ws.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h).trim(); }) : [];
  var missing = headers.filter(function (h) { return existing.indexOf(h) === -1; });
  if (missing.length) ws.getRange(1, lastCol + 1, 1, missing.length).setValues([missing]);
}
function _attSeed(ss) {
  var ws = getOrCreateTab(ss, ATT_STAFF_TAB, ATT_STAFF_HEADERS);
  _attEnsureCols(ws, ATT_STAFF_HEADERS);
  if (ws.getLastRow() > 1) return ws;
  ws.getRange(2, 1, 6, ATT_STAFF_HEADERS.length).setValues([
    ["Rupa Tai","Monthly",24000,15,"Monthly","","","",0,"Yes"],
    ["Pooja Tai","Monthly",8000,18,"Monthly","","","",0,"Yes"],
    ["Meena Tai","Monthly",5000,5,"Monthly","","","",0,"Yes"],
    ["Anita Tai","Monthly",3000,1,"Monthly","","","",0,"Yes"],
    ["Manisha Tai","Monthly",2000,1,"Monthly","","","",0,"Yes"],
    ["Abhijeet Parekar","Daily",0,"","Weekly",700,600,0,0,"Yes"]
  ]);
  return ws;
}
function _attPad(n) { return (n < 10 ? "0" : "") + n; }
function _attDateStr(v) { return v instanceof Date ? Utilities.formatDate(v, "Asia/Kolkata", "yyyy-MM-dd") : String(v || "").trim(); }
function _attDow(ds) { return new Date(ds + "T12:00:00+05:30").getDay(); } // 0 Sun .. 6 Sat
function _attMonthShift(monthStr, delta) {
  var d = new Date(+monthStr.slice(0, 4), +monthStr.slice(5, 7) - 1 + delta, 1);
  return d.getFullYear() + "-" + _attPad(d.getMonth() + 1);
}

function getAttendanceData(month, selDate) {
  try {
    var ss = getSpreadsheet();
    var staffWs = _attSeed(ss);
    var recWs = getOrCreateTab(ss, ATT_REC_TAB, ATT_REC_HEADERS); _attEnsureCols(recWs, ATT_REC_HEADERS);
    var salWs = getOrCreateTab(ss, ATT_SAL_TAB, ATT_SAL_HEADERS);
    var staff = getAllRows(staffWs).filter(function (r) { return String(r.Name || "").trim() && String(r.Active || "Yes").toLowerCase() !== "no"; });
    var recs = getAllRows(recWs);
    var sals = getAllRows(salWs);

    var now = getISTDate();
    var today = Utilities.formatDate(now, "Asia/Kolkata", "yyyy-MM-dd");
    var curMonth = Utilities.formatDate(now, "Asia/Kolkata", "yyyy-MM");
    var rosterDate = (selDate && /^\d{4}-\d{2}-\d{2}$/.test(selDate)) ? selDate : today;
    if (selDate && /^\d{4}-\d{2}-\d{2}$/.test(selDate)) month = rosterDate.slice(0, 7);
    var y, m;
    if (month && /^\d{4}-\d{2}$/.test(month)) { y = +month.slice(0, 4); m = +month.slice(5, 7); }
    else { y = now.getFullYear(); m = now.getMonth() + 1; }
    var dim = new Date(y, m, 0).getDate();
    var monthStr = y + "-" + _attPad(m);
    var from = monthStr + "-01", to = monthStr + "-" + _attPad(dim);
    var endDay = (monthStr === curMonth) ? now.getDate() : dim;

    var byStaff = {};
    recs.forEach(function (r) {
      var ds = _attDateStr(r.Date); if (ds < from || ds > to) return;
      var nm = String(r.Staff_Name || "").trim();
      (byStaff[nm] = byStaff[nm] || []).push({ date: ds, status: String(r.Status || "").trim().toLowerCase(), incentive: Number(r.Incentive || 0), deduction: Number(r.Deduction || 0), note: String(r.Note || "") });
    });
    var absentAll = {}, incentiveAll = {}, leavesByStaffMonth = {};
    recs.forEach(function (r) {
      var ds = _attDateStr(r.Date), nm = String(r.Staff_Name || "").trim();
      var ab = String(r.Status || "").trim().toLowerCase() === "absent";
      if (ab) absentAll[nm + "|" + ds] = true;
      if (Number(r.Incentive || 0) > 0) incentiveAll[nm + "|" + ds] = Number(r.Incentive || 0);
      if (ab && ds && _attDow(ds) !== 0) {
        var ym = ds.slice(0, 7);
        leavesByStaffMonth[nm] = leavesByStaffMonth[nm] || {};
        leavesByStaffMonth[nm][ym] = (leavesByStaffMonth[nm][ym] || 0) + 1;
      }
    });
    var paid = {}, salByStaff = {};
    sals.forEach(function (s) {
      var nm = String(s.Staff_Name || "").trim();
      paid[nm + "|" + String(s.Period || "").trim()] = Number(s.Amount || 0);
      (salByStaff[nm] = salByStaff[nm] || []).push({ period: String(s.Period || "").trim(), amount: Number(s.Amount || 0), at: String(s.Credited_At || "") });
    });

    var dow = now.getDay();
    var monOff = (dow === 0 ? -6 : 1 - dow);
    var monD = new Date(now.getFullYear(), now.getMonth(), now.getDate() + monOff);
    var satStr = Utilities.formatDate(new Date(monD.getFullYear(), monD.getMonth(), monD.getDate() + 5), "Asia/Kolkata", "yyyy-MM-dd");
    var prevKeys = [_attMonthShift(monthStr, -1), _attMonthShift(monthStr, -2), _attMonthShift(monthStr, -3)];

    var alerts = [], totalPayroll = 0;
    var staffOut = staff.map(function (st) {
      var name = String(st.Name).trim();
      var type = String(st.Type || "Monthly").trim().toLowerCase();
      var mySal = Number(st.Monthly_Salary || 0);
      var payDay = Number(st.Pay_Day || 0);
      var paidLeaves = Number(st.Paid_Leaves || 0);
      var wk = Number(st.Weekday_Rate || 0), sat = Number(st.Saturday_Rate || 0), sun = Number(st.Sunday_Rate || 0);
      var myRecs = byStaff[name] || [];

      var selRec = null; myRecs.forEach(function (r) { if (r.date === rosterDate) selRec = r; });
      var presentSel = !(selRec && selRec.status === "absent");
      var selIncentive = selRec ? selRec.incentive : 0;
      var selDeduction = selRec ? selRec.deduction : 0;

      var incentiveTotal = 0, deductionTotal = 0, leaveDays = 0, leaveList = [], incentives = [], deductions = [];
      myRecs.forEach(function (r) {
        if (r.incentive > 0) { incentiveTotal += r.incentive; incentives.push({ date: r.date, amount: r.incentive, note: r.note }); }
        if (r.deduction > 0) { deductionTotal += r.deduction; deductions.push({ date: r.date, amount: r.deduction, note: r.note }); }
        if (r.status === "absent") {
          var sunday = _attDow(r.date) === 0;
          if (!sunday) leaveDays++;
          leaveList.push({ date: r.date, sunday: sunday, reason: r.note });
        }
      });
      leaveList.sort(function (a, b) { return a.date.localeCompare(b.date); });
      var freeLeft = paidLeaves;
      leaveList.forEach(function (lv) {
        if (lv.sunday) { lv.deductible = false; return; }
        if (freeLeft > 0) { lv.deductible = false; freeLeft--; } else { lv.deductible = true; }
      });
      var deductibleLeaves = Math.max(0, leaveDays - paidLeaves);
      var freeUsed = Math.min(leaveDays, paidLeaves);

      var workingDays = 0, leavesElapsed = 0;
      for (var wd = 1; wd <= endDay; wd++) {
        var wds = monthStr + "-" + _attPad(wd);
        if (_attDow(wds) === 0) continue;
        workingDays++;
        if (absentAll[name + "|" + wds]) leavesElapsed++;
      }
      var presentDays = Math.max(0, workingDays - leavesElapsed);

      var curLeaves = (leavesByStaffMonth[name] && leavesByStaffMonth[name][monthStr]) || 0;
      var prevVals = prevKeys.map(function (k) { return (leavesByStaffMonth[name] && leavesByStaffMonth[name][k]) || 0; });
      var avg3 = (prevVals[0] + prevVals[1] + prevVals[2]) / 3;

      var out = {
        name: name, type: type, monthly_salary: mySal, pay_day: payDay, pay_cycle: String(st.Pay_Cycle || "Monthly"),
        paid_leaves: paidLeaves, weekday_rate: wk, saturday_rate: sat, sunday_rate: sun,
        present_sel: presentSel, sel_incentive: selIncentive, sel_deduction: selDeduction,
        leave_list: leaveList, incentives: incentives, deductions: deductions,
        incentive_total: incentiveTotal, deduction_total: deductionTotal,
        leave_days: leaveDays, deductible_leaves: deductibleLeaves, free_used: freeUsed,
        working_days: workingDays, present_days: presentDays,
        trend: { current: curLeaves, prev: prevVals, prev_keys: prevKeys, avg3: Math.round(avg3 * 10) / 10, up: (curLeaves > avg3 + 0.0001 && curLeaves >= 2) },
        salary_history: (salByStaff[name] || []).slice(-6).reverse()
      };

      if (type === "daily") {
        var endDs = (monthStr === curMonth) ? today : to;
        var earned = 0;
        for (var dd = 1; dd <= dim; dd++) {
          var ds = monthStr + "-" + _attPad(dd); if (ds > endDs) break;
          var w = _attDow(ds); if (w === 0) continue;
          if (absentAll[name + "|" + ds]) continue;
          earned += (w === 6 ? sat : wk);
        }
        out.base_earned = earned; out.per_day = wk; out.deduction = 0;
        out.net_salary = earned + incentiveTotal - deductionTotal;
        var weekAmt = 0, weekInc = 0;
        for (var k = 0; k < 6; k++) {
          var dx = new Date(monD.getFullYear(), monD.getMonth(), monD.getDate() + k);
          var dsx = Utilities.formatDate(dx, "Asia/Kolkata", "yyyy-MM-dd");
          var wx = dx.getDay();
          if (wx !== 0 && !absentAll[name + "|" + dsx]) weekAmt += (wx === 6 ? sat : wk);
          if (incentiveAll[name + "|" + dsx]) weekInc += incentiveAll[name + "|" + dsx];
        }
        var weekPeriod = "W" + satStr;
        out.week_amount = weekAmt + weekInc; out.week_period = weekPeriod; out.week_credited = paid.hasOwnProperty(name + "|" + weekPeriod);
        if ((dow === 6 || dow === 0) && !out.week_credited) {
          alerts.push({ name: name, amount: weekAmt + weekInc, period: weekPeriod, label: "Weekly wage (week ending Sat " + satStr + ")", base: weekAmt, deduction: 0, incentive: weekInc, adj: 0, cycle: "Weekly" });
        }
      } else {
        var perDay = dim > 0 ? mySal / dim : 0;
        var leaveDeduction = Math.round(perDay * deductibleLeaves);
        out.per_day = Math.round(perDay * 100) / 100; out.deduction = leaveDeduction;
        out.net_salary = mySal - leaveDeduction + incentiveTotal - deductionTotal;
        var monthPeriod = "M" + monthStr;
        out.pay_period = monthPeriod; out.credited = paid.hasOwnProperty(name + "|" + monthPeriod);
        out.pay_due = (monthStr === curMonth) && (now.getDate() >= payDay) && !out.credited;
        if (out.pay_due) alerts.push({ name: name, amount: out.net_salary, period: monthPeriod, label: "Salary (pay day " + payDay + ")", base: mySal, deduction: leaveDeduction, incentive: incentiveTotal, adj: deductionTotal, cycle: "Monthly" });
      }
      totalPayroll += Number(out.net_salary || 0);
      return out;
    });

    return { success: true, month: monthStr, days_in_month: dim, today: today, roster_date: rosterDate, today_dow: dow, total_payroll: totalPayroll, staff: staffOut, alerts: alerts };
  } catch (e) { return { success: false, error: String(e) }; }
}

// Header-driven upsert so it's robust to column order / added columns.
function _attUpsert(ss, date, name, mutate) {
  var ws = getOrCreateTab(ss, ATT_REC_TAB, ATT_REC_HEADERS);
  _attEnsureCols(ws, ATT_REC_HEADERS);
  var hIdx = headerIndex(ws);
  var headerRow = ws.getRange(1, 1, 1, ws.getLastColumn()).getValues()[0].map(function (h) { return String(h).trim(); });
  var data = ws.getDataRange().getValues();
  var dCol = hIdx.Date - 1, nCol = hIdx.Staff_Name - 1;
  var rowNum = -1, cur = { Status: "", Incentive: "", Deduction: "", Note: "" };
  for (var i = 1; i < data.length; i++) {
    if (_attDateStr(data[i][dCol]) === date && String(data[i][nCol] || "").trim() === name) {
      rowNum = i + 1;
      cur.Status = String(data[i][hIdx.Status - 1] || "");
      cur.Incentive = data[i][hIdx.Incentive - 1];
      cur.Deduction = data[i][hIdx.Deduction - 1];
      cur.Note = String(data[i][hIdx.Note - 1] || "");
      break;
    }
  }
  mutate(cur);
  var stamp = Utilities.formatDate(getISTDate(), "Asia/Kolkata", "yyyy-MM-dd HH:mm");
  var vals = headerRow.map(function (h) {
    if (h === "Date") return date;
    if (h === "Staff_Name") return name;
    if (h === "Status") return cur.Status;
    if (h === "Incentive") return cur.Incentive;
    if (h === "Deduction") return cur.Deduction;
    if (h === "Note") return cur.Note;
    if (h === "Updated") return stamp;
    return "";
  });
  if (rowNum > 0) ws.getRange(rowNum, 1, 1, vals.length).setValues([vals]);
  else ws.appendRow(vals);
  return { success: true };
}

function markAttendance(name, date, status, reason) {
  if (!name || !date) return { success: false, error: "name and date required" };
  var absent = String(status || "").trim().toLowerCase() === "absent";
  return _attUpsert(getSpreadsheet(), date, String(name).trim(), function (o) {
    o.Status = absent ? "Absent" : "";
    if (absent && reason) o.Note = reason;
  });
}

function addIncentive(name, date, amount, note) {
  if (!name || !date) return { success: false, error: "name and date required" };
  var amt = Number(amount || 0);
  return _attUpsert(getSpreadsheet(), date, String(name).trim(), function (o) { o.Incentive = amt > 0 ? amt : ""; if (note) o.Note = note; });
}

// Ad-hoc deduction (salary advance taken, fine, breakage…) on a date.
function addDeduction(name, date, amount, note) {
  if (!name || !date) return { success: false, error: "name and date required" };
  var amt = Number(amount || 0);
  return _attUpsert(getSpreadsheet(), date, String(name).trim(), function (o) { o.Deduction = amt > 0 ? amt : ""; if (note) o.Note = note; });
}

function markSalaryCredited(name, period, amount) {
  if (!name || !period) return { success: false, error: "name and period required" };
  var ws = getOrCreateTab(getSpreadsheet(), ATT_SAL_TAB, ATT_SAL_HEADERS);
  ws.appendRow([String(name).trim(), String(period).trim(), Number(amount || 0), Utilities.formatDate(getISTDate(), "Asia/Kolkata", "yyyy-MM-dd HH:mm")]);
  // Force Period to plain text so values are never auto-converted to dates/numbers.
  try { ws.getRange(ws.getLastRow(), 2).setNumberFormat("@").setValue(String(period).trim()); } catch (e) {}
  return { success: true };
}

// Edit a staff member's pay config in SK_Staff (salary, pay day, daily rates,
// paid-leave allowance, active). Name and Type are NOT editable — attendance
// records are keyed by Name, so renaming would orphan them.
function updateStaff(name, fields) {
  if (!name) return { success: false, error: "name required" };
  var EDITABLE = { Monthly_Salary: 1, Pay_Day: 1, Weekday_Rate: 1, Saturday_Rate: 1, Sunday_Rate: 1, Paid_Leaves: 1, Active: 1 };
  var ss = getSpreadsheet();
  var ws = getOrCreateTab(ss, ATT_STAFF_TAB, ATT_STAFF_HEADERS);
  _attEnsureCols(ws, ATT_STAFF_HEADERS);
  var hIdx = headerIndex(ws);
  var data = ws.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0] || "").trim() === String(name).trim()) {
      Object.keys(fields || {}).forEach(function (k) {
        if (EDITABLE[k] && hIdx[k]) ws.getRange(i + 1, hIdx[k]).setValue(fields[k]);
      });
      return { success: true };
    }
  }
  return { success: false, error: "Staff not found: " + name };
}

/**
 * Creates a Google Sheet in Drive with delivery details for a given date + meal.
 * Returns the spreadsheet URL so the client can open it directly.
 */
function createDeliverySheet(date, meal) {
  var data = getDriverOrders(date);
  var orders = (data.meals && data.meals[meal]) || [];

  var mealLabel = meal;
  var dateParts = date.split("-"); // yyyy-mm-dd
  var displayDate = dateParts[2] + "/" + dateParts[1] + "/" + dateParts[0];
  var title = "Delivery — " + mealLabel + " " + displayDate;

  var ss   = SpreadsheetApp.create(title);
  var sheet = ss.getActiveSheet();
  sheet.setName(mealLabel);

  // Headers
  var headers = ["Name", "Phone", "Address", "Maps Link", "Landmark", "Delivery Point", "Notes"];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);

  // Style header row
  var headerRange = sheet.getRange(1, 1, 1, headers.length);
  headerRange.setBackground("#1E1240");
  headerRange.setFontColor("#ffffff");
  headerRange.setFontWeight("bold");
  headerRange.setFontSize(11);

  // Data rows
  if (orders.length > 0) {
    var rows = orders.map(function(o) {
      return [
        o.name        || "",
        o.phone       || "",
        o.address     || "",
        o.maps        || "",
        o.landmark    || "",
        o.deliveryPoint || "",
        o.notes       || ""
      ];
    });
    sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
  }

  // Auto-resize columns for readability
  headers.forEach(function(_, i) { sheet.autoResizeColumn(i + 1); });

  // Freeze header row
  sheet.setFrozenRows(1);

  // Make the sheet accessible to anyone with the link (view + comment)
  var file = DriveApp.getFileById(ss.getId());
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.EDIT);

  return { success: true, url: ss.getUrl(), title: title, count: orders.length };
}

// Shared coord extractor for Apps Script (mirrors client-side regex)
// Priority: !3d/!4d (actual pinned location) > place/@ (share URL center) >
// ?q= / ?destination= / ?ll= > @ (camera center — last resort, can be far off)


// ── ORDER SUMMARY ────────────────────────────────────────────
function getOrderSummary(date) {
  var ss = getSpreadsheet();
  var ws = getOrCreateTab(ss, TAB_ORDERS, []);
  // Live + archived orders for this date (archive opened only if the date is
  // in an archived month), plus IntentAmplify orders (tagged [IA]).
  var rows = getOrdersInRangeWithArchive(date, date)
               .concat(typeof ia_rowsAsSK === "function" ? ia_rowsAsSK() : []);

  var dayRows = rows.filter(function(r) {
    var d = r.Order_Date instanceof Date
      ? Utilities.formatDate(r.Order_Date, "Asia/Kolkata", "yyyy-MM-dd")
      : String(r.Order_Date).trim();
    return d === date && !_isOrderCancelled(r.Payment_Status);
  });

  var meals = {};
  var totals = {orders: 0, customers: 0, revenue: 0, paid: 0, pending: 0};
  var customerSet = {};
  var LUNCH_DINNER_COLS = [
    "Chapati","Without_Oil_Chapati","Phulka","Ghee_Phulka","Jowar_Bhakri","Bajra_Bhakri",
    "Dry_Sabji_Mini","Dry_Sabji_Full","Curry_Sabji_Mini","Curry_Sabji_Full",
    "Dal","Dal_Fry","Rice","Salad","Curd"
  ];

  dayRows.forEach(function(r) {
    var meal = String(r.Meal_Type || "");
    if (!meal) return;
    if (!meals[meal]) meals[meal] = {count:0, revenue:0, paid:0, pending:0, itemTotals:{}, customers:[]};
    var m = meals[meal];
    var net = Number(r.Net_Total) || 0;
    var payStatus = String(r.Payment_Status || "Pending");

    var items = {};
    if (meal === "Breakfast") {
      var bfHasCurdSlot = false;
      for (var n = 1; n <= 4; n++) {
        var item = String(r["BF_Item_"+n] || "").trim();
        var qty  = Number(r["BF_Qty_"+n]) || 0;
        if (item && qty > 0) {
          items[item] = (items[item] || 0) + qty;
          m.itemTotals[item] = (m.itemTotals[item] || 0) + qty;
          if (item === "Curd") bfHasCurdSlot = true;
        }
      }
      // Dedupe: submitOrder writes Curd to BOTH BF_Item_N and Curd column,
      // so only add r.Curd if no BF_Item slot already captured it.
      var curdBf = Number(r.Curd) || 0;
      if (curdBf > 0 && !bfHasCurdSlot) {
        items["Curd"] = (items["Curd"] || 0) + curdBf;
        m.itemTotals["Curd"] = (m.itemTotals["Curd"] || 0) + curdBf;
      }
      // Allow lunch-style items placed in a Breakfast order via backend
      // (admin edits). Surface them so they don't get silently dropped.
      LUNCH_DINNER_COLS.forEach(function(col) {
        if (col === "Curd") return; // already handled above
        var q = Number(r[col]) || 0;
        if (q > 0) { items[col] = (items[col]||0)+q; m.itemTotals[col] = (m.itemTotals[col]||0)+q; }
      });
    } else {
      LUNCH_DINNER_COLS.forEach(function(col) {
        var q = Number(r[col]) || 0;
        if (q > 0) { items[col] = (items[col]||0)+q; m.itemTotals[col] = (m.itemTotals[col]||0)+q; }
      });
      // Allow breakfast-style items placed in a Lunch/Dinner order via
      // backend (admin edits — e.g. Poha/Upma for lunch). Surface them so
      // the kitchen sees them.
      for (var nn = 1; nn <= 4; nn++) {
        var bItem = String(r["BF_Item_"+nn] || "").trim();
        var bQty  = Number(r["BF_Qty_"+nn]) || 0;
        if (bItem && bQty > 0) {
          items[bItem] = (items[bItem] || 0) + bQty;
          m.itemTotals[bItem] = (m.itemTotals[bItem] || 0) + bQty;
        }
      }
    }

    m.count++;
    m.revenue += net;
    if (payStatus === "Paid" || payStatus === "Wallet Paid" || payStatus === "Collected") m.paid += net; else m.pending += net;
    m.customers.push({
      id:        String(r.Submission_ID || ""),
      name:      String(r.Customer_Name || ""),
      phone:     String(r.Phone || ""),
      items:     items,
      area:      String(r.Area || ""),
      address:   String(r.Full_Address || r.Flat || ""),
      total:     net,
      payStatus: payStatus,
      notes:     String(r.Special_Notes_Kitchen || "")
    });

    totals.orders++;
    totals.revenue += net;
    if (payStatus === "Paid" || payStatus === "Wallet Paid" || payStatus === "Collected") totals.paid += net; else totals.pending += net;
    if (!customerSet[String(r.Phone)]) { customerSet[String(r.Phone)] = true; totals.customers++; }
  });

  return {date: date, meals: meals, totals: totals};
}

// ── LABEL ORDERS ──────────────────────────────────────────────
function getLabelOrders(date, meal) {
  var ss = getSpreadsheet();
  var ws = getOrCreateTab(ss, TAB_ORDERS, []);
  // Merge IntentAmplify orders so their labels print too (name prefixed [IA]).
  var rows = getAllRows(ws).concat(typeof ia_rowsAsSK === "function" ? ia_rowsAsSK() : []);
  var COLS = ["Chapati","Without_Oil_Chapati","Phulka","Ghee_Phulka","Jowar_Bhakri","Bajra_Bhakri",
              "Dry_Sabji_Mini","Dry_Sabji_Full","Curry_Sabji_Mini","Curry_Sabji_Full","Dal","Dal_Fry","Rice","Salad"];

  var orders = rows
    .filter(function(r) {
      var d = r.Order_Date instanceof Date
        ? Utilities.formatDate(r.Order_Date, "Asia/Kolkata", "yyyy-MM-dd")
        : String(r.Order_Date).trim();
      return d === date && String(r.Meal_Type) === meal && !_isOrderCancelled(r.Payment_Status);
    })
    .map(function(r) {
      var obj = {
        name:  String(r.Customer_Name || ""),
        area:  String(r.Area || ""),
        notes: String(r.Special_Notes || ""),
        Curd:  Number(r.Curd) || 0,
        Items_JSON: String(r.Items_JSON || "")
      };
      if (meal === "Breakfast") {
        for (var n = 1; n <= 4; n++) {
          obj["BF_Item_"+n] = String(r["BF_Item_"+n] || "");
          obj["BF_Qty_"+n]  = Number(r["BF_Qty_"+n])  || 0;
        }
      } else {
        COLS.forEach(function(col) { obj[col] = Number(r[col]) || 0; });
      }
      return obj;
    });

  return {orders: orders};
}

// ── PACKAGING EXPENSES ────────────────────────────────────────
// Edit unit costs below to match your actual supplier prices
var PKG_UNIT_COSTS = {
  "Breakfast Box":           2.36,
  "Delivery Bag":            1.00,
  "Label / Sticker":         0.2,
  "Bread Packet":            0.70,
  "Sabji Container (Mini)":  2.70,
  "Sabji Container (Full)":  4.0,
  "Dal Container":           4.00,
  "Rice Container":          2.00,
  "Salad Container":         0.700,
  "Curd Container":          1.70
};

function getPackagingExpenses(date) {
  // Live + archived orders for this date (archive opened only for archived months).
  var rows = getOrdersInRangeWithArchive(date, date);

  var dayRows = rows.filter(function(r) {
    var d = r.Order_Date instanceof Date
      ? Utilities.formatDate(r.Order_Date, "Asia/Kolkata", "yyyy-MM-dd")
      : String(r.Order_Date).trim();
    // Exclude cancelled — they consume no packaging (matches the range variant).
    return d === date && !_isOrderCancelled(r.Payment_Status);
  });

  if (dayRows.length === 0) return {date: date, orderCount: 0, meals: {}, items: [], total: 0};

  var counts = {};
  var mealCounts = {Breakfast:0, Lunch:0, Dinner:0};
  function add(key, qty) { if (qty > 0) counts[key] = (counts[key]||0) + qty; }

  dayRows.forEach(function(r) {
    var meal = String(r.Meal_Type || "");
    if (mealCounts[meal] !== undefined) mealCounts[meal]++;

    add("Label / Sticker", 1);
    if (meal === "Breakfast") {
      add("Breakfast Box", 1);
      add("Curd Container", Number(r.Curd) || 0);
    } else {
      add("Delivery Bag", 1);
      var breadCols = ["Chapati","Without_Oil_Chapati","Phulka","Ghee_Phulka","Jowar_Bhakri","Bajra_Bhakri"];
      var hasBread = breadCols.some(function(c) { return (Number(r[c])||0) > 0; });
      if (hasBread) add("Bread Packet", 1);
      add("Sabji Container (Mini)", (Number(r.Dry_Sabji_Mini)||0) + (Number(r.Curry_Sabji_Mini)||0));
      add("Sabji Container (Full)", (Number(r.Dry_Sabji_Full)||0) + (Number(r.Curry_Sabji_Full)||0));
      add("Dal Container",          Number(r.Dal)   || 0);
      add("Dal Container",          Number(r.Dal_Fry) || 0);
      add("Rice Container",         Number(r.Rice)  || 0);
      add("Salad Container",        Number(r.Salad) || 0);
      add("Curd Container",         Number(r.Curd)  || 0);
    }
  });

  var itemOrder = ["Breakfast Box","Delivery Bag","Label / Sticker","Bread Packet",
                   "Sabji Container (Mini)","Sabji Container (Full)",
                   "Dal Container","Rice Container","Salad Container","Curd Container"];
  var items = [];
  var total = 0;
  itemOrder.forEach(function(key) {
    var qty = counts[key] || 0;
    if (!qty) return;
    var unitCost = PKG_UNIT_COSTS[key] || 0;
    var t = qty * unitCost;
    items.push({name: key, qty: qty, unitCost: unitCost, total: t});
    total += t;
  });

  var mealsOut = {};
  Object.keys(mealCounts).forEach(function(m) { if (mealCounts[m] > 0) mealsOut[m] = mealCounts[m]; });

  return {date: date, orderCount: dayRows.length, meals: mealsOut, items: items, total: total};
}

// ── PACKAGING EXPENSES — RANGE ───────────────────────────────
function getPackagingExpensesRange(from, to) {
  // Live + archived orders for the range (archives opened only for archived months).
  var rows = getOrdersInRangeWithArchive(from, to);

  var rangeRows = rows.filter(function(r) {
    var d = r.Order_Date instanceof Date
      ? Utilities.formatDate(r.Order_Date, "Asia/Kolkata", "yyyy-MM-dd")
      : String(r.Order_Date).trim();
    return d >= from && d <= to && !_isOrderCancelled(r.Payment_Status);
  });

  // Group by date
  var byDate = {};
  rangeRows.forEach(function(r) {
    var d = r.Order_Date instanceof Date
      ? Utilities.formatDate(r.Order_Date, "Asia/Kolkata", "yyyy-MM-dd")
      : String(r.Order_Date).trim();
    if (!byDate[d]) byDate[d] = [];
    byDate[d].push(r);
  });

  var PKG_COSTS = PKG_UNIT_COSTS;
  var itemOrder = ["Breakfast Box","Delivery Bag","Label / Sticker","Bread Packet",
                   "Sabji Container (Mini)","Sabji Container (Full)",
                   "Dal Container","Rice Container","Salad Container","Curd Container"];

  function calcDay(dateStr, dayRows) {
    var counts = {}, mealCounts = {Breakfast:0, Lunch:0, Dinner:0};
    function add(key, qty) { if (qty > 0) counts[key] = (counts[key]||0) + qty; }
    dayRows.forEach(function(r) {
      var meal = String(r.Meal_Type || "");
      if (mealCounts[meal] !== undefined) mealCounts[meal]++;
      add("Label / Sticker", 1);
      if (meal === "Breakfast") {
        add("Breakfast Box", 1);
        add("Curd Container", Number(r.Curd) || 0);
      } else {
        add("Delivery Bag", 1);
        var breadCols = ["Chapati","Without_Oil_Chapati","Phulka","Ghee_Phulka","Jowar_Bhakri","Bajra_Bhakri"];
        if (breadCols.some(function(c){ return (Number(r[c])||0)>0; })) add("Bread Packet", 1);
        add("Sabji Container (Mini)", (Number(r.Dry_Sabji_Mini)||0)+(Number(r.Curry_Sabji_Mini)||0));
        add("Sabji Container (Full)", (Number(r.Dry_Sabji_Full)||0)+(Number(r.Curry_Sabji_Full)||0));
        add("Dal Container",  Number(r.Dal)||0);
        add("Rice Container", Number(r.Rice)||0);
        add("Salad Container",Number(r.Salad)||0);
        add("Curd Container", Number(r.Curd)||0);
      }
    });
    var items = [], total = 0;
    itemOrder.forEach(function(key) {
      var qty = counts[key]||0; if (!qty) return;
      var unitCost = PKG_COSTS[key]||0, t = qty*unitCost;
      items.push({name:key, qty:qty, unitCost:unitCost, total:t});
      total += t;
    });
    var mealsOut = {};
    Object.keys(mealCounts).forEach(function(m){ if(mealCounts[m]>0) mealsOut[m]=mealCounts[m]; });
    return {date:dateStr, orderCount:dayRows.length, meals:mealsOut, items:items, total:total};
  }

  // Build per-day results
  var days = Object.keys(byDate).sort().map(function(d){ return calcDay(d, byDate[d]); });

  // Aggregate totals
  var aggCounts = {}, aggMeals = {Breakfast:0,Lunch:0,Dinner:0}, aggTotal = 0, aggOrders = 0;
  days.forEach(function(day) {
    aggOrders += day.orderCount;
    aggTotal  += day.total;
    Object.keys(day.meals).forEach(function(m){ aggMeals[m]=(aggMeals[m]||0)+day.meals[m]; });
    day.items.forEach(function(it){ aggCounts[it.name]=(aggCounts[it.name]||0)+it.qty; });
  });
  var aggItems = [];
  itemOrder.forEach(function(key) {
    var qty = aggCounts[key]||0; if (!qty) return;
    var unitCost = PKG_COSTS[key]||0, t=qty*unitCost;
    aggItems.push({name:key, qty:qty, unitCost:unitCost, total:t});
  });

  return {
    from: from, to: to,
    orderCount: aggOrders,
    total: aggTotal,
    meals: aggMeals,
    items: aggItems,
    days: days
  };
}

// ── LABEL DRIVE SAVE ─────────────────────────────────────────
function saveLabels(body) {
  var date   = body.date;  // "2026-03-18"
  var meal   = body.meal;  // "Lunch"
  var pdfB64 = body.pdf;   // base64-encoded PDF bytes

  var parts      = date.split("-");
  var year       = parts[0];                                        // "2026"
  var monthNum   = parseInt(parts[1], 10);                          // 3
  var monthNames = ["January","February","March","April","May","June",
                    "July","August","September","October","November","December"];
  var monthName  = monthNames[monthNum - 1];                        // "March"
  var mealAbbrev = meal.toLowerCase().substring(0, 7);              // "breakfa" / "lunch" / "dinner"
  var langCode   = (body.lang === "Devanagari") ? "mar" : "eng";    // "eng" / "mar"
  var filename   = "labels_" + mealAbbrev + "_" + langCode + "_" + date + "_58x25.pdf";
  // e.g. "labels_breakfa_eng_2026-03-05_58x25.pdf"

  var folder = getOrCreateFolderPath([
    "Svaadh Kitchen", "Accounting", "Tally Form Daily Sheets",
    "Processed_Orders", "Labels", year, monthName
  ]);

  // Replace existing file to avoid duplicates
  var existing = folder.getFilesByName(filename);
  while (existing.hasNext()) existing.next().setTrashed(true);

  var pdfBlob = Utilities.newBlob(Utilities.base64Decode(pdfB64), "application/pdf", filename);
  var file = folder.createFile(pdfBlob);
  return {url: file.getUrl(), name: filename, id: file.getId()};
}

function getOrCreateFolderPath(pathParts) {
  var folder = DriveApp.getRootFolder();
  pathParts.forEach(function(name) {
    var iter = folder.getFoldersByName(name);
    folder = iter.hasNext() ? iter.next() : folder.createFolder(name);
  });
  return folder;
}

