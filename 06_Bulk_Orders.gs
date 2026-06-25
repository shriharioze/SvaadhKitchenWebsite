// ============================================================
// 06_Bulk_Orders.gs
// Bulk meal ordering — order Lunch and/or Dinner across the next N working days
// in one go (Week = 6, 15-Day = 13, Month = 26 working days). Breakfast is excluded
// (rotating menu). Each meal-day is stored as its own SK_Orders row sharing a
// Batch_ID. Pricing reuses the normal per-day logic (delivery / small-order fee /
// combined-day free-delivery threshold + retroactive credit) PLUS a flat 5% bulk
// discount on each day's food; bulk days are EXCLUDED from the 6-day loyalty streak
// (no surcharge accrual, no 6th-day giveback). Decisions locked 2026-06-23.
// ============================================================

const TAB_BULK_BATCH_COL = "Batch_ID"; // self-healed column on SK_Orders
const BULK_DISCOUNT_RATE = 0.05;       // flat 5% on each day's food for bulk orders
// Working (non-Sunday, non-closed) days per plan.
const BULK_PLANS = { week: 6, "15day": 13, month: 26 };

// Next `count` working days for a meal: skips Sundays + admin-closed days, and
// includes TODAY only if that meal's cutoff hasn't passed yet. All date math is in
// Asia/Kolkata so it's correct regardless of the runtime timezone.
function _nextWorkingDays(meal, count) {
  const TZ = "Asia/Kolkata";
  const closed = (typeof _kitchenClosedSet === "function") ? _kitchenClosedSet() : {};
  const now = new Date();
  const todayISO = Utilities.formatDate(now, TZ, "yyyy-MM-dd");
  const nowHour = Number(Utilities.formatDate(now, TZ, "HH")) + Number(Utilities.formatDate(now, TZ, "mm")) / 60;

  const out = [];
  let cur = new Date(todayISO + "T12:00:00+05:30"); // anchor at noon IST today
  let safety = 0;
  while (out.length < count && safety < 120) {
    safety++;
    const iso = Utilities.formatDate(cur, TZ, "yyyy-MM-dd");
    const dayName = Utilities.formatDate(cur, TZ, "EEEE");
    let eligible = (dayName !== "Sunday") && !closed[iso];
    if (eligible && iso === todayISO) {
      const cutoff = (_effectiveCutoffsForDate(iso) || {})[meal];
      if (cutoff !== undefined && nowHour >= cutoff) eligible = false; // cutoff passed today
    }
    if (eligible) out.push(iso);
    cur = new Date(cur.getTime() + 24 * 60 * 60 * 1000); // +1 day (India has no DST)
  }
  return out;
}

// Public: the lunch + dinner working-day windows for a bulk plan. The two windows
// can start on DIFFERENT dates (e.g. at 10 AM the lunch cutoff has passed → lunch
// starts tomorrow, dinner still starts today). The frontend uses these to build the
// cart and to show the customer exactly which dates each meal covers.
function getBulkWindow(plan) {
  const key = String(plan || "").trim();
  const count = BULK_PLANS[key];
  if (!count) return { error: "Unknown bulk plan." };
  return {
    plan:   key,
    days:   count,
    lunch:  _nextWorkingDays("Lunch", count),
    dinner: _nextWorkingDays("Dinner", count)
  };
}

// ============================================================
// BULK PRICING CORE (bulk-orders branch — NOT on LIVE)
// ============================================================
// Prices a bulk batch like submitOrder/_computeAuthoritativeTotal price a normal day,
// PLUS a flat 5% bulk discount, with two deliberate differences:
//   • NO market-surcharge accrual and NO 6-day loyalty (bulk days are excluded from
//     the streak — they neither accrue nor trigger the 6th-day giveback).
//   • NO Google-review promo (bulk has its own discount model).
// Each day is priced ATOMICALLY (both meals known up front), so unlike submitOrder
// there is no incremental retroactive delivery/fee credit — the free-delivery
// threshold is evaluated on the day's full lunch+dinner food in one shot.
// Day discount = bulk 5% (always) + day-tier (stacks): ≥₹450 → +7.5%, ≥₹300 → +5%.

const BULK_DELIVERY = 11; // MUST equal submitOrder/_computeAuthoritativeTotal DELIVERY
// L/D base prices — MUST mirror _computeAuthoritativeTotal's LD_PRICE (10_Hdfc_Gateway.gs).
// Breakfast is excluded from bulk, so no menu-sheet lookup is ever needed.
const BULK_LD_PRICE = {
  "Chapati": 9, "Without Oil Chapati": 8, "Phulka": 7, "Ghee Phulka": 10,
  "Jowar Bhakri": 20, "Bajra Bhakri": 20,
  "Dry Sabji Mini (100ml)": 22, "Dry Sabji Full (250ml)": 45,
  "Curry Sabji Mini (100ml)": 22, "Curry Sabji Full (250ml)": 45,
  "Dal (200ml)": 22, "Rice (100g)": 12, "Salad (40g)": 7, "Curd (50g)": 12
};

// Authoritative per-item price (Lunch/Dinner). V2 = ceil(base × 1.06), else base.
function _bulkItemPrice(colKey) {
  const base = Number(BULK_LD_PRICE[colKey] || 0);
  return PRICING_V2 ? Math.ceil(base * 1.06) : base;
}
// Sum a meal's chosen items → authoritative food subtotal.
function _bulkMealFood(items) {
  if (!Array.isArray(items)) return 0;
  return items.reduce(function (s, it) {
    return s + _bulkItemPrice(it.colKey) * (Number(it.qty) || 0);
  }, 0);
}

// PURE pricing: given chosen items + the (server-authoritative) date windows, price
// every meal-day. ctx: { isFreeArea, isFeeExempt, isPickup } for the delivery point.
// Returns { rows:[{date, meal, food, bulkDisc, tierDisc, discount, delivery, smallFee,
// net, items}], total, totalFood, totalBulkDisc, totalTierDisc }.
function _bulkPriceFromWindows(lunchItems, dinnerItems, lunchDates, dinnerDates, ctx) {
  ctx = ctx || {};
  const lunchFood  = _bulkMealFood(lunchItems);
  const dinnerFood = _bulkMealFood(dinnerItems);
  const hasLunch  = lunchFood  > 0 && Array.isArray(lunchDates)  && lunchDates.length  > 0;
  const hasDinner = dinnerFood > 0 && Array.isArray(dinnerDates) && dinnerDates.length > 0;

  const dayMap = {}; // date -> { Lunch:bool, Dinner:bool }
  if (hasLunch)  lunchDates.forEach(function (d) { (dayMap[d] = dayMap[d] || {}).Lunch  = true; });
  if (hasDinner) dinnerDates.forEach(function (d) { (dayMap[d] = dayMap[d] || {}).Dinner = true; });

  const freeArea  = !!ctx.isFreeArea;
  const feeExempt = !!ctx.isFeeExempt;
  const isPickup  = !!ctx.isPickup;
  const smallTh   = PRICING_V2 ? 53 : 50;

  const rows = [];
  let total = 0, totalFood = 0, totalBulkDisc = 0, totalTierDisc = 0;

  Object.keys(dayMap).sort().forEach(function (date) {
    const flags = dayMap[date];
    const meals = [];
    if (flags.Lunch)  meals.push({ meal: "Lunch",  food: lunchFood,  items: lunchItems  });
    if (flags.Dinner) meals.push({ meal: "Dinner", food: dinnerFood, items: dinnerItems });
    const dayFood = meals.reduce(function (s, m) { return s + m.food; }, 0);
    if (dayFood <= 0) return;

    const freeThreshold = meals.length <= 1 ? (PRICING_V2 ? 106 : 100) : (PRICING_V2 ? 159 : 150);
    const isDayFree = feeExempt || (dayFood >= freeThreshold);

    let tierRate = 0;
    if (dayFood >= 450) tierRate = 0.075;
    else if (dayFood >= 300) tierRate = 0.05;
    const dayBulkDisc = Math.round(dayFood * BULK_DISCOUNT_RATE); // flat 5%
    const dayTierDisc = Math.round(dayFood * tierRate);

    let bulkAssigned = 0, tierAssigned = 0;
    meals.forEach(function (m, i) {
      const last = (i === meals.length - 1);
      // Pro-rate the day-level discounts across the day's meals; the LAST meal absorbs
      // the rounding remainder so the per-day discount totals stay exact.
      const bulkShare = last ? (dayBulkDisc - bulkAssigned) : Math.round(dayBulkDisc * (m.food / dayFood));
      const tierShare = last ? (dayTierDisc - tierAssigned) : Math.round(dayTierDisc * (m.food / dayFood));
      bulkAssigned += bulkShare; tierAssigned += tierShare;

      const delivery = (isDayFree || freeArea || isPickup) ? 0 : BULK_DELIVERY;
      const smallFee = (isDayFree || isPickup) ? 0 : (m.food < smallTh ? 10 : 0);
      const discount = bulkShare + tierShare;
      const net = Math.max(0, Math.round(m.food - discount + delivery + smallFee));

      rows.push({
        date: date, meal: m.meal, food: m.food,
        bulkDisc: bulkShare, tierDisc: tierShare, discount: discount,
        delivery: delivery, smallFee: smallFee, net: net, items: m.items
      });
      total += net; totalFood += m.food; totalBulkDisc += bulkShare; totalTierDisc += tierShare;
    });
  });

  return { rows: rows, total: total, totalFood: totalFood, totalBulkDisc: totalBulkDisc, totalTierDisc: totalTierDisc };
}

// Fetches the server-authoritative windows for `plan` and prices the batch. The client
// never supplies dates (anti-tamper). Returns the _bulkPriceFromWindows shape plus
// { plan, lunch, dinner }, or { error }.
function _bulkComputeBatch(plan, lunchItems, dinnerItems, ctx) {
  const win = getBulkWindow(plan);
  if (win.error) return { error: win.error };
  const lunchFood  = _bulkMealFood(lunchItems);
  const dinnerFood = _bulkMealFood(dinnerItems);
  if (lunchFood <= 0 && dinnerFood <= 0) return { error: "Select at least one meal's items." };
  const lunchDates  = lunchFood  > 0 ? win.lunch  : [];
  const dinnerDates = dinnerFood > 0 ? win.dinner : [];
  const priced = _bulkPriceFromWindows(lunchItems, dinnerItems, lunchDates, dinnerDates, ctx);
  priced.plan   = win.plan;
  priced.lunch  = lunchFood  > 0 ? { food: lunchFood,  dates: lunchDates  } : null;
  priced.dinner = dinnerFood > 0 ? { food: dinnerFood, dates: dinnerDates } : null;
  return priced;
}

// ── Item name → canonical (for Items_JSON), mirroring submitOrder's resolveName ──
// (L/D only — bulk has no breakfast, so no master-map branch is needed.)
function _bulkResolveName(colKey) {
  const col = ITEM_COL_MAP[colKey];
  const name = col ? col.replace(/_/g, " ") : String(colKey);
  return name.replace(/\s*\[.*?\]\s*/g, "").replace(/\s*\(.*?\)\s*/g, "").trim();
}

// ============================================================
// BULK STORAGE — submitBulkOrder (bulk-orders branch — NOT on LIVE)
// ============================================================
// Prices the batch (server-authoritative) and writes one SK_Orders row per meal-day:
//   - shared Batch_ID, own Submission_ID
//   - Items_JSON + per-item columns (kitchen/driver/labels render like a normal order)
//   - Inflation_Surcharge=0, Loyalty_Discount="No" (bulk is outside the streak)
//   - Bulk_Clawback = the row's bulk-discount amount (the clawback-able portion that
//     cancellation will recover — wired up in the cancellation step later)
//   - Source="Bulk"
// body: { plan, phone, profile:{name,area,wing,flat,floor,society,maps,landmark},
//         lunch:{items:[{colKey,qty}]}|null, dinner:{items:...}|null,
//         payment_method, payment_status, gateway_order_id, batch_id?, notesKitchen?,
//         dryRun? }  — dryRun:true computes + returns the rows WITHOUT writing.
function submitBulkOrder(body) {
  body = body || {};
  const plan = String(body.plan || "").trim();
  if (!BULK_PLANS[plan]) return { success: false, error: "Unknown bulk plan." };

  const phone = _normalizePhone(body.phone || (body.profile && body.profile.phone) || "");
  if (!phone) return { success: false, error: "Missing phone." };

  const lunchItems  = (body.lunch  && Array.isArray(body.lunch.items)  && body.lunch.items.length)  ? body.lunch.items  : null;
  const dinnerItems = (body.dinner && Array.isArray(body.dinner.items) && body.dinner.items.length) ? body.dinner.items : null;
  if (_bulkMealFood(lunchItems) <= 0 && _bulkMealFood(dinnerItems) <= 0) {
    return { success: false, error: "Select at least one meal's items." };
  }

  // Customer + fee context (mirrors _computeAuthoritativeTotal)
  const ss     = getSpreadsheet();
  const custWs = getOrCreateTab(ss, TAB_CUSTOMERS, CUSTOMERS_HEADERS);
  const cRow   = getAllRows(custWs).find(function (r) { return _normalizePhone(r.Phone) === phone; }) || null;
  const profile = body.profile || {};
  const name = String(profile.name || (cRow && cRow.Customer_Name) || "Customer").trim();
  const area = String(profile.area || (cRow && cRow.Area) || "").trim();
  const freeAreaNames = (getAreas() || []).filter(function (a) { return a.free; }).map(function (a) { return a.name; });
  const isPickup = area.toLowerCase().indexOf("pickup") !== -1;
  const ctx = {
    isFreeArea:  freeAreaNames.indexOf(area) !== -1,
    isFeeExempt: !!(cRow && (cRow.Fee_Exempt === "Yes" || cRow.Fee_Exempt === true)),
    isPickup:    isPickup
  };

  // Price
  const priced = _bulkComputeBatch(plan, lunchItems, dinnerItems, ctx);
  if (priced.error)        return { success: false, error: priced.error };
  if (!priced.rows.length) return { success: false, error: "No valid bulk days to place (cutoffs may have passed)." };

  // Dry run: return the breakdown WITHOUT writing anything.
  if (body.dryRun) {
    return { success: true, dryRun: true, plan: priced.plan, total: priced.total,
             count: priced.rows.length, totalBulkDisc: priced.totalBulkDisc,
             totalTierDisc: priced.totalTierDisc, lunch: priced.lunch, dinner: priced.dinner,
             rows: priced.rows.map(function (r) { return { date: r.date, meal: r.meal, food: r.food, discount: r.discount, bulkDisc: r.bulkDisc, tierDisc: r.tierDisc, delivery: r.delivery, smallFee: r.smallFee, net: r.net }; }) };
  }

  // Write rows
  const ordersWs = getOrCreateTab(ss, TAB_ORDERS, ORDERS_HEADERS);
  const hIdx = headerIndex(ordersWs);
  ["Small_Order_Fee", "Inflation_Surcharge", "Loyalty_Discount", "Gateway_Order_ID", "Batch_ID", "Bulk_Clawback"].forEach(function (col) {
    if (!hIdx[col]) { ordersWs.getRange(1, ordersWs.getLastColumn() + 1).setValue(col); hIdx[col] = ordersWs.getLastColumn(); }
  });

  const batchId = String(body.batch_id || ("BULK-" + Utilities.formatDate(new Date(), "Asia/Kolkata", "yyyyMMdd-HHmmss") + "-" + (Math.floor(Math.random() * 9000) + 1000)));
  const paymentMethod = String(body.payment_method || "Bulk (Gateway)");
  const paymentStatus = String(body.payment_status || "Paid");
  const gatewayOrderId = String(body.gateway_order_id || "");
  const submittedAt = getISTTimestamp();
  const bulkNote = String(body.notesKitchen || "Bulk order - sabji of the day (chef's choice)");

  const wing    = isPickup ? "" : String(profile.wing    || (cRow && cRow.Wing)    || "");
  const flat    = isPickup ? "" : String(profile.flat    || (cRow && cRow.Flat)    || "");
  const floor   = isPickup ? "" : String(profile.floor   || (cRow && cRow.Floor)   || "");
  const society = isPickup ? "" : String(profile.society || (cRow && cRow.Society) || "");
  const mapsLink = isPickup ? "" : String(profile.maps || (cRow && cRow.Maps_Link) || "");
  const landmark = isPickup ? "" : String(profile.landmark || (cRow && cRow.Landmark) || "");
  const _custAddrLine = [wing && ("Wing " + wing), flat && ("Flat " + flat), floor && (floor + " Floor"), society].filter(Boolean).join(", ");
  const fullAddr = isPickup ? "Self Pickup (A 104, Shree laxmi vihar society, Hadapsar)" : [_custAddrLine, area].filter(Boolean).join(", ");

  const written = [];
  priced.rows.forEach(function (r) {
    const sid = generateSubmissionID();
    const itemsObj = {};
    r.items.forEach(function (it) { itemsObj[_bulkResolveName(it.colKey)] = it.qty; });

    const row = new Array(ordersWs.getLastColumn()).fill("");
    const set = function (c, v) { const i = hIdx[c]; if (i) row[i - 1] = v; };

    set("Submission_ID", sid);
    set("Submitted_At", submittedAt);
    set("Order_Date", r.date);
    set("Meal_Type", r.meal);
    set("Customer_Name", name);
    set("Phone", phone);
    set("Area", isPickup ? "Self Pickup" : area);
    set("Wing", wing); set("Flat", flat); set("Floor", floor); set("Society", society);
    set("Full_Address", fullAddr); set("Maps_Link", mapsLink); set("Landmark", landmark);
    set("Items_JSON", JSON.stringify(itemsObj));
    r.items.forEach(function (it) { const col = ITEM_COL_MAP[it.colKey]; if (col && hIdx[col]) set(col, it.qty); });
    set("Special_Notes_Kitchen", bulkNote);
    set("Food_Subtotal", r.food);
    set("Small_Order_Fee", r.smallFee);
    set("Delivery_Charge", r.delivery);
    set("Discount_Amount", r.discount);
    set("Net_Total", r.net);
    set("Inflation_Surcharge", 0);
    set("Loyalty_Discount", "No");
    set("Payment_Method", paymentMethod);
    set("Payment_Status", paymentStatus);
    set("Source", "Bulk");
    set("Gateway_Order_ID", gatewayOrderId);
    set("Batch_ID", batchId);
    set("Bulk_Clawback", r.bulkDisc); // per-row bulk discount = the clawback-able amount
    ordersWs.appendRow(row);
    written.push({ sid: sid, date: r.date, meal: r.meal, net: r.net });
  });

  if (typeof updateCustomerLastOrder === "function") { try { updateCustomerLastOrder(phone); } catch (_) {} }

  return { success: true, batch_id: batchId, total: priced.total, count: written.length,
           rows: written, lunch: priced.lunch, dinner: priced.dinner };
}

// ── TEST HELPERS (run from the Apps Script editor; remove before any LIVE wiring) ──
function _bulkTestBody(extra) {
  return Object.assign({
    plan: "week",
    phone: "9999900001",
    profile: { name: "ZZ_TEST_BULK", area: "Bhosale Nagar" }, // free-delivery area
    dinner: { items: [{ colKey: "Phulka", qty: 4 }, { colKey: "Dry Sabji Full (250ml)", qty: 1 }, { colKey: "Dal (200ml)", qty: 1 }, { colKey: "Salad (40g)", qty: 1 }] },
    lunch:  { items: [{ colKey: "Phulka", qty: 3 }, { colKey: "Curd (50g)", qty: 1 }] }
  }, extra || {});
}
// 1) Dry-run pricing — NO writes. Run this first; read the Execution Log.
function testBulkQuote() {
  const out = submitBulkOrder(_bulkTestBody({ dryRun: true }));
  Logger.log(JSON.stringify(out, null, 2));
  return out;
}
// 2) Real placement — WRITES rows to SK_Orders (future dates). Note the batch_id it logs.
function testBulkPlace() {
  const out = submitBulkOrder(_bulkTestBody({ payment_method: "TEST Bulk", payment_status: "Paid" }));
  Logger.log("PLACED: " + JSON.stringify(out, null, 2));
  Logger.log("verify on the kitchen page for those dates, then run: cleanupTestBulk('" + out.batch_id + "')");
  return out;
}
// 3) Cleanup — delete test rows. With a batch_id: delete that batch. With NO arg
//    (clicking Run in the editor passes nothing): delete every row written by
//    testBulkPlace (Customer_Name "ZZ_TEST_BULK"). Never touches real orders.
function cleanupTestBulk(batchId) {
  const ws   = getOrCreateTab(getSpreadsheet(), TAB_ORDERS, ORDERS_HEADERS);
  const hIdx = headerIndex(ws);
  const bCol = hIdx["Batch_ID"], nCol = hIdx["Customer_Name"];
  const data = ws.getDataRange().getValues();
  const byBatch = !!batchId;
  let deleted = 0;
  for (let i = data.length - 1; i >= 1; i--) {
    const match = byBatch
      ? (bCol && String(data[i][bCol - 1] || "").trim() === String(batchId).trim())
      : (nCol && String(data[i][nCol - 1] || "").trim() === "ZZ_TEST_BULK");
    if (match) { ws.deleteRow(i + 1); deleted++; }
  }
  Logger.log("Deleted " + deleted + " row(s) " + (byBatch ? ("for batch " + batchId) : "for ZZ_TEST_BULK test orders"));
  return deleted;
}
