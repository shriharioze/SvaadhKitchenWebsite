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
const BULK_DISCOUNT_RATE = 0.05;       // default bulk discount (used if a plan is unknown)
// Per-plan bulk discount on each day's food — bigger commitment, bigger discount.
const BULK_PLAN_RATES = { week: 0.05, "15day": 0.075, month: 0.10 };
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
// Day discount = bulk plan rate (always) + day-tier (stacks): ≥₹750 → +10%, ≥₹485 → +7.5%, ≥₹325 → +5%.

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
function _bulkPriceFromWindows(lunchItems, dinnerItems, lunchDates, dinnerDates, ctx, bulkRate) {
  ctx = ctx || {};
  const _rate = (typeof bulkRate === "number" && bulkRate > 0) ? bulkRate : BULK_DISCOUNT_RATE;
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

  // PASS 1 — build the day list + per-day fee/tier context, and accumulate the batch's
  // total bulk discount (per-day 5%/7.5%/10% of that day's food, rounded) PLUS each
  // meal's total food. The bulk discount is then split PER MEAL (below), not per day,
  // so lunch & dinner each carry a fair share — otherwise a per-day round-up (e.g. ₹1 on
  // a ₹16 day) always lands on the first meal and lunch hoards the whole discount while
  // dinner gets ₹0, which makes the per-meal cancellation clawback unfair.
  const dayList = [];
  let totalBulkPool = 0;
  const mealFoodTotal = {}, mealCount = {};
  Object.keys(dayMap).sort().forEach(function (date) {
    const flags = dayMap[date];
    const meals = [];
    if (flags.Lunch)  meals.push({ meal: "Lunch",  food: lunchFood,  items: lunchItems  });
    if (flags.Dinner) meals.push({ meal: "Dinner", food: dinnerFood, items: dinnerItems });
    const dayFood = meals.reduce(function (s, m) { return s + m.food; }, 0);
    if (dayFood <= 0) return;

    const freeThreshold = meals.length <= 1 ? (PRICING_V2 ? 106 : 100) : meals.length === 2 ? (PRICING_V2 ? 159 : 150) : (PRICING_V2 ? 190 : 180);
    const isDayFree = feeExempt || (dayFood >= freeThreshold);

    let tierRate = 0;
    if (dayFood >= 750) tierRate = 0.10;
    else if (dayFood >= 485) tierRate = 0.075;
    else if (dayFood >= 325) tierRate = 0.05;
    const dayTierDisc = Math.round(dayFood * tierRate);

    totalBulkPool += Math.round(dayFood * _rate); // plan rate: 5% / 7.5% / 10%
    meals.forEach(function (m) {
      mealFoodTotal[m.meal] = (mealFoodTotal[m.meal] || 0) + m.food;
      mealCount[m.meal] = (mealCount[m.meal] || 0) + 1;
    });
    dayList.push({ date: date, meals: meals, dayFood: dayFood, isDayFree: isDayFree, dayTierDisc: dayTierDisc });
  });

  // Split the batch's total bulk discount across meals PROPORTIONAL to each meal's food
  // (the last meal absorbs the rounding remainder). Equal lunch/dinner ⇒ an even split.
  const grandFood = Object.keys(mealFoodTotal).reduce(function (s, k) { return s + mealFoodTotal[k]; }, 0);
  const mealKeys = Object.keys(mealFoodTotal);
  const mealPool = {}; let poolAssigned = 0;
  mealKeys.forEach(function (mk, i) {
    if (i === mealKeys.length - 1) mealPool[mk] = totalBulkPool - poolAssigned;
    else { mealPool[mk] = grandFood > 0 ? Math.round(totalBulkPool * mealFoodTotal[mk] / grandFood) : 0; poolAssigned += mealPool[mk]; }
  });

  // PASS 2 — build rows. Each meal's pool is spread evenly across its days via a running
  // cumulative target (keeps per-row integers summing exactly to the meal pool). The
  // day-tier discount stays per-day, pro-rated across that day's meals.
  const rows = [];
  let total = 0, totalFood = 0, totalBulkDisc = 0, totalTierDisc = 0;
  const mealSeen = {}, mealBulkAssigned = {};
  dayList.forEach(function (day) {
    let tierAssigned = 0;
    day.meals.forEach(function (m, i) {
      const last = (i === day.meals.length - 1);

      mealSeen[m.meal] = (mealSeen[m.meal] || 0) + 1;
      const tgt = Math.round((mealPool[m.meal] || 0) * mealSeen[m.meal] / (mealCount[m.meal] || 1));
      const bulkShare = tgt - (mealBulkAssigned[m.meal] || 0);
      mealBulkAssigned[m.meal] = tgt;

      const tierShare = last ? (day.dayTierDisc - tierAssigned) : Math.round(day.dayTierDisc * (m.food / day.dayFood));
      tierAssigned += tierShare;

      const delivery = (day.isDayFree || freeArea || isPickup) ? 0 : BULK_DELIVERY;
      const smallFee = (day.isDayFree || isPickup) ? 0 : (m.food < smallTh ? 11 : 0);
      const discount = bulkShare + tierShare;
      const net = Math.max(0, Math.round(m.food - discount + delivery + smallFee));

      rows.push({
        date: day.date, meal: m.meal, food: m.food,
        bulkDisc: bulkShare, tierDisc: tierShare, discount: discount,
        delivery: delivery, smallFee: smallFee, net: net, items: m.items
      });
      total += net; totalFood += m.food; totalBulkDisc += bulkShare; totalTierDisc += tierShare;
    });
  });

  return { rows: rows, total: total, totalFood: totalFood, totalBulkDisc: totalBulkDisc, totalTierDisc: totalTierDisc };
}

// Prices the batch. Dates come from `frozen` ({lunchDates,dinnerDates}) when supplied
// — the gateway freezes the windows at checkout so the CHARGE and the later STORAGE
// write use identical dates even if a meal cutoff flips in between. Without `frozen`
// it fetches the live windows (getBulkWindow). Returns the _bulkPriceFromWindows shape
// plus { plan, lunch, dinner }, or { error }.
function _bulkComputeBatch(plan, lunchItems, dinnerItems, ctx, frozen) {
  const lunchFood  = _bulkMealFood(lunchItems);
  const dinnerFood = _bulkMealFood(dinnerItems);
  if (lunchFood <= 0 && dinnerFood <= 0) return { error: "Select at least one meal's items." };

  let planName = plan, winLunch, winDinner;
  const useFrozen = frozen && (Array.isArray(frozen.lunchDates) || Array.isArray(frozen.dinnerDates));
  if (useFrozen) {
    winLunch  = frozen.lunchDates  || [];
    winDinner = frozen.dinnerDates || [];
  } else {
    const win = getBulkWindow(plan);
    if (win.error) return { error: win.error };
    planName = win.plan; winLunch = win.lunch; winDinner = win.dinner;
  }
  const lunchDates  = lunchFood  > 0 ? winLunch  : [];
  const dinnerDates = dinnerFood > 0 ? winDinner : [];
  const rate = BULK_PLAN_RATES[planName] || BULK_DISCOUNT_RATE; // week 5% / 15day 7.5% / month 10%
  const priced = _bulkPriceFromWindows(lunchItems, dinnerItems, lunchDates, dinnerDates, ctx, rate);
  priced.plan     = planName;
  priced.bulkRate = rate; // surfaced to the frontend review ("Bulk discount (X%)")
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

// Shared fee context for a bulk order — the customer's area allowlist drives free
// delivery / fee exemption / pickup. Used by BOTH submitBulkOrder (storage) and
// _bulkAuthoritativeTotal (gateway charge) so the two can never diverge.
function _bulkFeeCtx(phone, profile) {
  profile = profile || {};
  const cRow = getAllRows(getOrCreateTab(getSpreadsheet(), TAB_CUSTOMERS, CUSTOMERS_HEADERS))
                 .find(function (r) { return _normalizePhone(r.Phone) === _normalizePhone(phone); }) || null;
  const area = String(profile.area || (cRow && cRow.Area) || "").trim();
  const freeAreaNames = (getAreas() || []).filter(function (a) { return a.free; }).map(function (a) { return a.name; });
  return {
    cRow: cRow,
    name: String(profile.name || (cRow && cRow.Customer_Name) || "Customer").trim(),
    area: area,
    ctx: {
      isFreeArea:  freeAreaNames.indexOf(area) !== -1,
      isFeeExempt: !!(cRow && (cRow.Fee_Exempt === "Yes" || cRow.Fee_Exempt === true)),
      isPickup:    area.toLowerCase().indexOf("pickup") !== -1
    }
  };
}

// Gateway authoritative total for a bulk batch — the bulk analogue of
// _computeAuthoritativeTotal. hdfc_createSession charges THIS, so it must use the
// exact same pricing + fee context submitBulkOrder writes. bulkEntry: { plan,
// lunch:{items}, dinner:{items} }. Returns the rupee total (0 on any error).
function _bulkAuthoritativeTotal(bulkEntry, phone, profile) {
  if (!bulkEntry) return 0;
  const fc = _bulkFeeCtx(phone, profile);
  const priced = _bulkComputeBatch(bulkEntry.plan,
    bulkEntry.lunch  && bulkEntry.lunch.items,
    bulkEntry.dinner && bulkEntry.dinner.items, fc.ctx,
    { lunchDates: bulkEntry.lunchDates, dinnerDates: bulkEntry.dinnerDates });
  return priced.error ? 0 : priced.total;
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

  // Customer + fee context — SHARED with the gateway (_bulkAuthoritativeTotal) so the
  // HDFC charge always equals what gets written here.
  const profile = body.profile || {};
  const fc   = _bulkFeeCtx(phone, profile);
  const cRow = fc.cRow, name = fc.name, area = fc.area, ctx = fc.ctx;
  const isPickup = ctx.isPickup;
  const ss = getSpreadsheet();

  // Price — honour frozen dates (gateway passes the windows captured at checkout) so
  // storage matches the charge exactly; falls back to live windows otherwise.
  const priced = _bulkComputeBatch(plan, lunchItems, dinnerItems, ctx,
    { lunchDates: body.lunchDates, dinnerDates: body.dinnerDates });
  if (priced.error)        return { success: false, error: priced.error };
  if (!priced.rows.length) return { success: false, error: "No valid bulk days to place (cutoffs may have passed)." };

  // (Idempotency is handled per-(date,meal) in the write loop below, so a retry / the
  // reconciler COMPLETES a partial batch instead of short-circuiting on the first row.)

  // Dry run: return the breakdown WITHOUT writing anything.
  if (body.dryRun) {
    return { success: true, dryRun: true, plan: priced.plan, total: priced.total, bulkRate: priced.bulkRate,
             count: priced.rows.length, totalFood: priced.totalFood, totalBulkDisc: priced.totalBulkDisc,
             totalTierDisc: priced.totalTierDisc, lunch: priced.lunch, dinner: priced.dinner,
             rows: priced.rows.map(function (r) { return { date: r.date, meal: r.meal, food: r.food, discount: r.discount, bulkDisc: r.bulkDisc, tierDisc: r.tierDisc, delivery: r.delivery, smallFee: r.smallFee, net: r.net }; }) };
  }

  // Write rows
  const ordersWs = getOrCreateTab(ss, TAB_ORDERS, ORDERS_HEADERS);
  const hIdx = headerIndex(ordersWs);
  ["Small_Order_Fee", "Inflation_Surcharge", "Loyalty_Discount", "Gateway_Order_ID", "Batch_ID", "Bulk_Clawback", "Wallet_Credit"].forEach(function (col) {
    if (!hIdx[col]) { ordersWs.getRange(1, ordersWs.getLastColumn() + 1).setValue(col); hIdx[col] = ordersWs.getLastColumn(); }
  });

  const batchId = String(body.batch_id || ("BULK-" + Utilities.formatDate(new Date(), "Asia/Kolkata", "yyyyMMdd-HHmmss") + "-" + (Math.floor(Math.random() * 9000) + 1000)));
  const paymentMethod = String(body.payment_method || "Bulk (Gateway)");
  const paymentStatus = String(body.payment_status || "Paid");
  const gatewayOrderId = String(body.gateway_order_id || "");

  // ── Wallet / Split per-row deduction (mirrors submitOrder's per-meal logic) ──
  //   "Wallet"            → deduct each row's net from SK_Wallet (balance re-checked
  //                         live) → row becomes "Wallet Paid", carries Wallet_Credit.
  //   "Bulk (Split HDFC)" → spend a SERVER-AUTHORITATIVE budget (wallet_applied,
  //                         validated in hdfc_createSession) across rows; the gateway
  //                         captured the remainder → rows stay "Paid" + Wallet_Credit.
  //   "On Account"        → rows are "On Account" (wallet applied later by
  //                         _autoSettlePendingOrders). No wallet touched here.
  // Idempotent: a retry skips already-written (date|meal) rows below, so no re-debit.
  const _isWalletPay = (paymentMethod === "Wallet");
  const _isSplitPay  = (paymentMethod === "Bulk (Split HDFC)" || paymentMethod === "Split (HDFC)");
  const _walletRows  = (_isWalletPay || _isSplitPay) ? getAllRows(getOrCreateTab(ss, TAB_WALLET, WALLET_HEADERS)) : null;
  let   _splitBudget = _isSplitPay ? Math.max(0, Number(body.wallet_applied || 0)) : 0;
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

  // IDEMPOTENT: which (date|meal) rows already exist for this gateway id? A retry (finalize
  // re-fire / reconciler) must COMPLETE a partially-written batch, never double-write it.
  const _fmtD = function (v) { return v instanceof Date ? Utilities.formatDate(v, "Asia/Kolkata", "yyyy-MM-dd") : String(v || "").trim().slice(0, 10); };
  const existingKeys = {};
  if (gatewayOrderId) {
    const _gCol = hIdx["Gateway_Order_ID"], _dCol = hIdx["Order_Date"], _mCol = hIdx["Meal_Type"], _wcCol = hIdx["Wallet_Credit"];
    if (_gCol && _dCol && _mCol) {
      const _data = ordersWs.getDataRange().getValues();
      let _alreadyWalletCredited = 0;
      for (let _i = 1; _i < _data.length; _i++) {
        if (String(_data[_i][_gCol - 1] || "").trim() === gatewayOrderId) {
          existingKeys[_fmtD(_data[_i][_dCol - 1]) + "|" + String(_data[_i][_mCol - 1] || "").trim()] = true;
          if (_wcCol) _alreadyWalletCredited += Number(_data[_i][_wcCol - 1]) || 0;
        }
      }
      // Split partial-retry safety: earlier rows of THIS batch already consumed part of
      // the wallet_applied budget. Reduce the remaining budget by what they took so a
      // completing retry can never re-spend it (would over-debit the wallet).
      if (_isSplitPay && _alreadyWalletCredited > 0) _splitBudget = Math.max(0, _splitBudget - _alreadyWalletCredited);
    }
  }

  const written  = []; // rows appended THIS call
  const toVerify = []; // { sid, row } — confirm each actually landed
  priced.rows.forEach(function (r) {
    if (existingKeys[_fmtD(r.date) + "|" + r.meal]) return; // already written — skip (idempotent)
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

    // Per-row wallet deduction / status (see the block above submitBulkOrder's loop).
    let _rowStatus = paymentStatus, _rowWalletCredit = 0;
    if (_isWalletPay) {
      const _bal = _calculateWalletBalance(phone, _walletRows);
      if (_bal >= r.net) {
        _appendWalletTransaction(phone, name, "Bulk Order Deduction", r.net, true, sid);
        _walletRows.push({ Phone: _normalizePhone(phone), Txn_Type: "Order Deduction", Amount: r.net, Verified: "TRUE" });
        _rowStatus = "Wallet Paid"; _rowWalletCredit = r.net;
      } else {
        _rowStatus = "Pending"; // insufficient (should never happen — submitBulkDirect pre-checks the full total)
      }
    } else if (_isSplitPay) {
      const _want = Math.min(_splitBudget, r.net);
      if (_want > 0) {
        const _bal = _calculateWalletBalance(phone, _walletRows);
        const _deduct = Math.min(_want, _bal);
        if (_deduct > 0) {
          _appendWalletTransaction(phone, name, "Bulk Order Deduction (Wallet Part — Gateway Split)", _deduct, true, sid);
          _walletRows.push({ Phone: _normalizePhone(phone), Txn_Type: "Order Deduction", Amount: _deduct, Verified: "TRUE" });
          _rowWalletCredit = _deduct; _splitBudget -= _deduct;
        }
      }
      _rowStatus = "Paid"; // gateway captured the remainder
    }

    set("Payment_Method", paymentMethod);
    set("Payment_Status", _rowStatus);
    if (_rowWalletCredit > 0) set("Wallet_Credit", _rowWalletCredit);
    set("Source", "Bulk");
    set("Gateway_Order_ID", gatewayOrderId);
    set("Batch_ID", batchId);
    set("Bulk_Clawback", r.bulkDisc); // per-row bulk discount = the clawback-able amount
    ordersWs.appendRow(row);
    toVerify.push({ sid: sid, row: row });
    written.push({ sid: sid, date: r.date, meal: r.meal, net: r.net });
  });

  // ── VERIFY every appended row actually landed; re-append any GAS silently dropped ──
  // (Same failure the missed-order safety net catches for regular orders: appendRow can be
  // dropped under load. For a MONTH batch that's up to ~52 rows in one call.)
  SpreadsheetApp.flush();
  const _sidCol = hIdx["Submission_ID"];
  const stillMissing = [];
  if (toVerify.length && _sidCol) {
    const _lastRow = ordersWs.getLastRow();
    const _from = Math.max(2, _lastRow - Math.max(300, toVerify.length * 4));
    const _present = {};
    if (_lastRow >= _from) {
      ordersWs.getRange(_from, _sidCol, _lastRow - _from + 1, 1).getValues().forEach(function (x) { _present[String(x[0])] = true; });
    }
    toVerify.forEach(function (w) {
      if (_present[String(w.sid)]) return; // landed on the first append
      const okAttempt = (typeof _reappendUntilPresent === "function") ? _reappendUntilPresent(ordersWs, _sidCol, w.sid, w.row, 5) : 1;
      if (!okAttempt) stillMissing.push(w);
    });
  }

  if (stillMissing.length) {
    // Couldn't persist some rows even after retries → DO NOT report success. The frontend
    // keeps its "confirming…" retry loop (or shows the safe "will appear shortly" message)
    // and the next finalize/reconciler call completes the batch (idempotent). Audit-log each.
    try {
      stillMissing.forEach(function (w) {
        const wr = written.filter(function (x) { return x.sid === w.sid; })[0] || {};
        if (typeof _logMissedOrderRow === "function") _logMissedOrderRow(ss, {
          status: "BULK ROW DROPPED — retry pending", sid: w.sid, gatewayId: gatewayOrderId,
          name: name, phone: phone, amount: wr.net || "", date: wr.date || "", meal: wr.meal || "", attempts: 5
        });
      });
    } catch (_) {}
    return { success: false, partial: true, error: "Some bulk rows did not persist (" + stillMissing.length + " of " + priced.rows.length + "). Retry will complete it.",
             batch_id: batchId, rows_written: written.length - stillMissing.length, expected: priced.rows.length };
  }

  if (typeof updateCustomerLastOrder === "function") { try { updateCustomerLastOrder(phone); } catch (_) {} }

  // Success = every priced row is now present (skipped-existing + newly-verified).
  return { success: true, batch_id: batchId, total: priced.total,
           count: Object.keys(existingKeys).length + written.length, rows_written: written.length,
           already: written.length === 0, rows: written, lunch: priced.lunch, dinner: priced.dinner };
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
// 1b) Gateway parity — confirms the HDFC charge (_bulkAuthoritativeTotal, what
//     hdfc_createSession sends) equals submitBulkOrder's stored total. NO writes.
function testBulkGatewayMatch() {
  const b = _bulkTestBody({});
  const charge = _bulkAuthoritativeTotal({ plan: b.plan, lunch: b.lunch, dinner: b.dinner }, b.phone, b.profile);
  const stored = submitBulkOrder(_bulkTestBody({ dryRun: true })).total;
  Logger.log("gateway charge = " + charge + " | stored total = " + stored + " | match: " + (charge === stored));
  return { charge: charge, stored: stored, match: charge === stored };
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
  // Also purge any SK_Refunds rows raised by testBulkCancelSequence for the test phone.
  try {
    const rWs = getSpreadsheet().getSheetByName(TAB_REFUNDS);
    if (rWs && rWs.getLastRow() > 1) {
      const rData = rWs.getDataRange().getValues();
      const pIdx = rData[0].indexOf("Phone");
      if (pIdx !== -1) {
        for (let i = rData.length - 1; i >= 1; i--) {
          if (_normalizePhone(rData[i][pIdx]) === "9999900001") { rWs.deleteRow(i + 1); }
        }
      }
    }
  } catch (_) {}
  Logger.log("Deleted " + deleted + " row(s) " + (byBatch ? ("for batch " + batchId) : "for ZZ_TEST_BULK test orders"));
  return deleted;
}
// 4) Cancellation sequence — places a batch, cancels every meal-day in order, and
//    checks the refunds sum to EXACTLY what was paid (the ₹570 conservation rule).
//    The first cancel shows the full bulk-discount clawback; the rest refund full
//    price. Uses isAdmin to bypass cutoff/ownership. Self-cleans at the end.
function testBulkCancelSequence() {
  const placed = submitBulkOrder(_bulkTestBody({ payment_method: "Bulk (Gateway)", payment_status: "Paid" }));
  if (!placed.success) { Logger.log("place failed: " + JSON.stringify(placed)); return placed; }
  const ws = getOrCreateTab(getSpreadsheet(), TAB_ORDERS, ORDERS_HEADERS);
  const rows = getAllRows(ws).filter(function (r) { return String(r.Batch_ID || "").trim() === placed.batch_id; });
  const paid = rows.reduce(function (s, r) { return s + (Number(r.Net_Total) || 0); }, 0);
  let totalRefund = 0; const log = [];
  rows.forEach(function (r) {
    const dry = deleteOrder("9999900001", r.Submission_ID, "manual_upi", { isAdmin: true, dryRun: true });
    const amt = (dry && dry.refundAmt) || 0;
    totalRefund += amt;
    log.push(String(r.Order_Date).slice(0, 10) + " " + r.Meal_Type + ": refund Rs." + amt + "  [" + (dry.breakdownText || "").split("\n")[0] + "]");
    deleteOrder("9999900001", r.Submission_ID, "manual_upi", { isAdmin: true }); // real cancel
  });
  Logger.log("paid Rs." + paid + " | total refunded Rs." + totalRefund + " | match: " + (paid === totalRefund));
  Logger.log(log.join("\n"));
  cleanupTestBulk(placed.batch_id);
  Logger.log("(test batch + refund rows cleaned up)");
  return { paid: paid, totalRefund: totalRefund, match: paid === totalRefund };
}

// Direct (NON-gateway) bulk placement — On Account and full-Wallet payments, which
// need no HDFC popup (mirrors the regular flow: On-Account users are billed later;
// a full wallet just debits SK_Wallet). body: { plan, phone, profile, lunch, dinner,
// mode:"OnAccount"|"Wallet", use_wallet?:bool, request_id }.
//   • Server recomputes the authoritative total (client amount is never trusted).
//   • Wallet mode HARD-CHECKS the live balance covers the FULL total before writing a
//     single row (so we never leave a half-paid batch); rows become "Wallet Paid".
//   • On Account writes rows "On Account"; if use_wallet, _autoSettlePendingOrders then
//     applies any existing wallet balance whole-order (the same routine the regular
//     flow uses on wallet top-up), so an on-account customer's wallet is spent first.
//   • Idempotent on request_id (CacheService, 5 min) so a retry/double-tap can't
//     double-write or double-debit. Freezes the date windows like the gateway path.
function submitBulkDirect(body) {
  body = body || {};
  const phone = _normalizePhone(body.phone || (body.profile && body.profile.phone) || "");
  if (!phone) return { success: false, error: "Missing phone." };
  const mode = String(body.mode || "").trim();
  if (mode !== "OnAccount" && mode !== "Wallet") return { success: false, error: "Unknown bulk payment mode." };

  const _cache = CacheService.getScriptCache();
  const _reqId = String(body.request_id || "");
  if (_reqId) { const hit = _cache.get("bulkdirect_" + _reqId); if (hit) { try { return JSON.parse(hit); } catch (_) {} } }

  // Serialize wallet reads/writes (submitBulkOrder isn't self-locked; the regular flow
  // locks all of submitOrder). Prevents a concurrent order double-spending the wallet.
  const _lock = LockService.getScriptLock();
  try { _lock.waitLock(20000); } catch (_) { return { success: false, error: "Server busy — please try again." }; }
  try {
    // Re-check the idempotency cache now that we hold the lock (a racing twin may have
    // just written + cached the response).
    if (_reqId) { const hit2 = _cache.get("bulkdirect_" + _reqId); if (hit2) { try { return JSON.parse(hit2); } catch (_) {} } }
    return _submitBulkDirectLocked(body, phone, mode, _cache, _reqId);
  } finally {
    try { _lock.releaseLock(); } catch (_) {}
  }
}

function _submitBulkDirectLocked(body, phone, mode, _cache, _reqId) {
  // Server-authoritative pricing + FROZEN windows (identical basis to the gateway path).
  const fc = _bulkFeeCtx(phone, body.profile || {});
  const q = _bulkComputeBatch(String(body.plan || ""),
    body.lunch && body.lunch.items, body.dinner && body.dinner.items, fc.ctx, null);
  if (q.error) return { success: false, error: q.error };
  const total = q.total;
  const frozen = { lunchDates: q.lunch ? q.lunch.dates : [], dinnerDates: q.dinner ? q.dinner.dates : [] };

  let out;
  if (mode === "Wallet") {
    const bal = _calculateWalletBalance(phone);
    if (bal < total) return { success: false, error: "Insufficient wallet balance for the full bulk total.", wallet_balance: bal, total: total };
    out = submitBulkOrder(Object.assign({}, body, {
      payment_method: "Wallet", payment_status: "Wallet Paid",
      lunchDates: frozen.lunchDates, dinnerDates: frozen.dinnerDates
    }));
  } else { // OnAccount
    out = submitBulkOrder(Object.assign({}, body, {
      payment_method: "On Account", payment_status: "On Account",
      lunchDates: frozen.lunchDates, dinnerDates: frozen.dinnerDates
    }));
    if (out && out.success && body.use_wallet) {
      try { const s = _autoSettlePendingOrders(phone); if (s && s.msg) out.settle_msg = s.msg; } catch (_) {}
    }
  }
  if (out) { out.total = total; out.mode = mode; }
  if (_reqId && out && out.success) { try { _cache.put("bulkdirect_" + _reqId, JSON.stringify(out), 300); } catch (_) {} }
  return out;
}

// Frontend-triggered finalize for a bulk gateway order — mirrors the order page's
// post-payment submit so the batch is written INSTANTLY (not on the ~2-min reconciler
// sweep). Reads the FROZEN bulk stash, verifies the charge (Status API, webhook-log
// fallback), and writes via submitBulkOrder (idempotent on gateway_order_id). The
// reconciler stays as the backstop if the browser never calls this (e.g. closed tab).
function hdfc_finalizeBulkOrder(body) {
  if (!PAYMENT_GATEWAY_ENABLED) return { success: false, error: "Gateway not enabled." };
  const orderId = String((body && body.order_id) || "").trim();
  if (!orderId) return { success: false, error: "order_id required." };

  const props = PropertiesService.getScriptProperties();
  let entry = null;
  try { entry = JSON.parse(props.getProperty("HDFC_PENDING_ORDERS") || "{}")[orderId] || null; } catch (e) {}

  // Fully written already? ONLY if rows exist AND the stash is gone — the stash is deleted
  // just below on a COMPLETE write, so "rows exist + no stash" == done. If rows exist but
  // the stash is still here, the batch is PARTIAL: fall through so submitBulkOrder (which is
  // idempotent + self-completing + verified) writes the missing rows before we call it done.
  const ws = getOrCreateTab(getSpreadsheet(), TAB_ORDERS, ORDERS_HEADERS);
  const gCol = headerIndex(ws)["Gateway_Order_ID"];
  if (gCol && !entry) {
    const data = ws.getDataRange().getValues();
    let n = 0;
    for (let i = 1; i < data.length; i++) if (String(data[i][gCol - 1] || "").trim() === orderId) n++;
    if (n > 0) return { success: true, already: true, batch_id: orderId, count: n };
  }

  if (!entry || !entry.bulk) return { success: false, error: "No pending bulk order for " + orderId };

  // Verify the charge before writing (never trust the browser alone).
  let sc; try { sc = hdfc_getOrderStatus(orderId); } catch (e) { sc = { confirmed: false }; }
  if (!sc.confirmed && typeof _checkWebhookLogForCharge === "function" && _checkWebhookLogForCharge(orderId)) sc = { confirmed: true };
  if (!sc.confirmed) return { success: false, pending: true, message: "Payment not yet confirmed — will retry." };

  // Split (Wallet + HDFC): the gateway only charged (total − wallet_applied). Pass the
  // server-validated wallet_applied so submitBulkOrder debits the wallet portion too.
  const _isSplit = String(entry.payment_choice || "") === "Split";
  const res = submitBulkOrder({
    plan: entry.bulk.plan, phone: entry.phone, profile: entry.profile,
    lunch: entry.bulk.lunch, dinner: entry.bulk.dinner,
    lunchDates: entry.bulk.lunchDates, dinnerDates: entry.bulk.dinnerDates,
    payment_method: _isSplit ? "Bulk (Split HDFC)" : "Bulk (Gateway)", payment_status: "Paid",
    wallet_applied: _isSplit ? Number(entry.wallet_applied || 0) : 0,
    gateway_order_id: orderId, batch_id: orderId
  });
  if (res && res.success) {
    try { const all = JSON.parse(props.getProperty("HDFC_PENDING_ORDERS") || "{}"); delete all[orderId]; props.setProperty("HDFC_PENDING_ORDERS", JSON.stringify(all)); } catch (e) {}
    return { success: true, batch_id: orderId, count: res.count || 0, already: !!res.already };
  }
  return { success: false, error: (res && res.error) || "Could not place the bulk order." };
}
