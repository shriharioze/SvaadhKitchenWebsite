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
