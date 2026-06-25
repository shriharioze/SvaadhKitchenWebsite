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
