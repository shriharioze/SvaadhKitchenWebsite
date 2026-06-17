// ============================================================
// 14_IntentAmplify.gs
// Corporate meal channel ("IntentAmplify") — integrated module.
// ------------------------------------------------------------
// Lives inside the SAME Apps Script project as the consumer app
// (like kitchen/driver share Code.gs). Reads/writes ONLY the IA_*
// tabs on the SAME live spreadsheet, so it never touches consumer
// (SK_*) data or the HDFC-audited flow.
//
// Reuses existing globals from this project (do NOT redeclare):
//   SP, ADMIN_PIN, KITCHEN_PIN, getSpreadsheet(), _pinMatch(), jsonRes()
//
// Routing: ia_* actions are dispatched from doGet/doPost in 01_Router.gs.
// Employees use phone + their own 4-digit PIN (separate IA_Customers
// namespace). Admin actions use the main ADMIN_PIN; the kitchen prep
// view is unlocked by KITCHEN_PIN (or ADMIN_PIN) and exposes ONLY
// cooking quantities — never revenue, names, or order lists.
//
// Optional Script Properties:
//   IA_UPI_VPA   → UPI id shown to employees for manual payment
//   IA_UPI_NAME  → payee display name (defaults to "Svaadh Kitchen")
// ============================================================

const IA_UPI_VPA       = SP.getProperty("IA_UPI_VPA")  || "";
const IA_UPI_NAME      = SP.getProperty("IA_UPI_NAME") || "Svaadh Kitchen";
const IA_COMPANY_NAME  = "IntentAmplify";
const IA_FIXED_ADDRESS = "S4 Towers, Magarpatta";

const IA_TAB_CUSTOMERS = "IA_Customers";
const IA_TAB_ORDERS    = "IA_Orders";
const IA_TAB_MENU      = "IA_Daily_Menu";

const IA_CUSTOMERS_HEADERS = ["Phone", "Name", "PIN", "Created_At", "Last_Order_At", "Status"];
const IA_ORDERS_HEADERS = [
  "Submission_ID", "Timestamp", "Date", "Meal", "Phone", "Customer_Name",
  "Items_JSON", "Item_Summary", "Subtotal", "Payment_Status",
  "Payment_Ref", "Approved_By", "Approved_At", "Notes",
  "Delivery_Status", "EnRoute_At", "Delivered_At"
];
const IA_MENU_HEADERS = ["Date", "Meal", "Items_JSON", "Updated_By", "Updated_At"];

const IA_MEALS   = ["Lunch", "Dinner"];
const IA_CUTOFFS = { Lunch: { h: 11, m: 0 }, Dinner: { h: 17, m: 0 } };
const IA_TZ      = "Asia/Kolkata";

// Default items available every day (sabjis added per-day by admin Set Menu).
const IA_FIXED_ITEMS = [
  { name: "Chapati",             price: 9,  cat: "Roti" },
  { name: "Without Oil Chapati", price: 8,  cat: "Roti" },
  { name: "Phulka",              price: 7,  cat: "Roti" },
  { name: "Ghee Phulka",         price: 10, cat: "Roti" },
  { name: "Jowar Bhakri",        price: 20, cat: "Roti" },
  { name: "Bajra Bhakri",        price: 20, cat: "Roti" },
  { name: "Dry Sabji Mini (100ml)",  price: 22, cat: "Sabji" },
  { name: "Dry Sabji Full (250ml)",  price: 45, cat: "Sabji" },
  { name: "Curry Sabji Mini (100ml)",price: 22, cat: "Sabji" },
  { name: "Curry Sabji Full (250ml)",price: 45, cat: "Sabji" },
  { name: "Dal (200ml)",         price: 22, cat: "Dal"  },
  { name: "Rice (100g)",         price: 12, cat: "Rice" },
  { name: "Salad (40g)",         price: 7,  cat: "Extra"},
  { name: "Curd (50g)",          price: 12, cat: "Extra"}
];

// ── Utilities (IA-scoped; reuse project getSpreadsheet) ──────
function ia_getTab(name, headers) {
  const ss = getSpreadsheet();
  let ws = ss.getSheetByName(name);
  if (!ws) {
    ws = ss.insertSheet(name);
    ws.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight("bold");
    ws.setFrozenRows(1);
    if (name === IA_TAB_CUSTOMERS) ia_forceTextCols(ws); // keep PIN/phone leading zeros
  }
  return ws;
}

// Force the Phone (A) and PIN (C) columns to TEXT so Sheets never coerces
// "0001" → 1 (dropping leading zeros). Safe to call repeatedly.
function ia_forceTextCols(ws) {
  try {
    ws.getRange("A2:A").setNumberFormat("@");
    ws.getRange("C2:C").setNumberFormat("@");
  } catch (e) {}
}

function ia_rows(ws) {
  const data = ws.getDataRange().getValues();
  if (data.length < 2) return [];
  const headers = data[0];
  return data.slice(1).map(function (r, i) {
    const o = { _row: i + 2 };
    headers.forEach(function (h, c) { o[h] = r[c]; });
    return o;
  });
}

function ia_normPhone(p) {
  return String(p == null ? "" : p).replace(/\D/g, "").replace(/^91(?=\d{10}$)/, "");
}
function ia_now() { return new Date(); }
function ia_todayStr() { return Utilities.formatDate(ia_now(), IA_TZ, "yyyy-MM-dd"); }

// Normalize a sheet cell that may be a Date object OR a string into a
// canonical "yyyy-MM-dd" string. Sheets often coerces a written date string
// into a Date serial, so String(cell) would no longer equal "2026-05-29".
function ia_dateStr(v) {
  if (v instanceof Date) return Utilities.formatDate(v, IA_TZ, "yyyy-MM-dd");
  return String(v == null ? "" : v).trim().slice(0, 10);
}
function ia_genId() {
  return "IA" + Utilities.formatDate(ia_now(), IA_TZ, "yyMMddHHmmss") +
    Math.random().toString(36).slice(2, 6).toUpperCase();
}

// Permissions — reuse the project's main PINs.
function ia_isAdmin(pin) { return _pinMatch(pin, ADMIN_PIN) && String(pin || "") !== ""; }
function ia_canPrep(pin) {
  return (_pinMatch(pin, KITCHEN_PIN) || _pinMatch(pin, ADMIN_PIN)) && String(pin || "") !== "";
}

function ia_isOpen(dateStr, meal) {
  const today = ia_todayStr();
  if (dateStr < today) return false;
  // IA is a weekday corporate service — the calendar blocks Sat/Sun client-side;
  // enforce it server-side too so a stale tab / crafted POST can't book a weekend.
  const dow = new Date(dateStr + "T12:00:00").getDay(); // 0=Sun, 6=Sat
  if (dow === 0 || dow === 6) return false;
  if (dateStr > today) return true;
  const c = IA_CUTOFFS[meal];
  if (!c) return false;
  const now = ia_now();
  const hh = Number(Utilities.formatDate(now, IA_TZ, "HH"));
  const mm = Number(Utilities.formatDate(now, IA_TZ, "mm"));
  return (hh < c.h) || (hh === c.h && mm < c.m);
}

// ── Auth (separate namespace, independent PIN) ───────────────
function ia_checkPhone(phone) {
  const p = ia_normPhone(phone);
  if (p.length !== 10) return { error: "Enter a valid 10-digit number." };
  const ws = ia_getTab(IA_TAB_CUSTOMERS, IA_CUSTOMERS_HEADERS);
  const row = ia_rows(ws).find(function (r) { return ia_normPhone(r.Phone) === p; });
  if (!row) return { exists: false };
  // PIN cleared by admin (the "forgot PIN" reset) → account exists but needs a
  // fresh PIN. Frontend uses pin_reset to route to the "set new PIN" screen.
  const pinReset = String(row.PIN || "").trim() === "";
  return { exists: true, name: row.Name || "", status: row.Status || "active", pin_reset: pinReset };
}

function ia_verifyLogin(phone, pin) {
  const p = ia_normPhone(phone);
  const ws = ia_getTab(IA_TAB_CUSTOMERS, IA_CUSTOMERS_HEADERS);
  const row = ia_rows(ws).find(function (r) { return ia_normPhone(r.Phone) === p; });
  if (!row) return { success: false, error: "Account not found." };
  if (String(row.PIN) !== String(pin)) return { success: false, error: "Incorrect PIN." };
  return { success: true, name: row.Name || "" };
}

function ia_register(body) {
  const p = ia_normPhone(body.phone);
  const pin = String(body.pin || "").trim();
  const name = String(body.name || "").trim();
  if (p.length !== 10) return { error: "Enter a valid 10-digit number." };
  if (!/^\d{4}$/.test(pin)) return { error: "PIN must be 4 digits." };
  if (!name) return { error: "Name is required." };

  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const ws = ia_getTab(IA_TAB_CUSTOMERS, IA_CUSTOMERS_HEADERS);
    const existing = ia_rows(ws).find(function (r) { return ia_normPhone(r.Phone) === p; });
    if (existing) {
      const existingPin = String(existing.PIN || "").trim();
      if (existingPin === "") {
        // PIN was reset/cleared by admin → set the new PIN on this existing row.
        ia_forceTextCols(ws);
        ws.getRange(existing._row, 3).setNumberFormat("@").setValue(pin);
        if (name) ws.getRange(existing._row, 2).setValue(name);
        return { success: true, name: name || existing.Name || "" };
      }
      if (existingPin !== pin) return { error: "Account exists. Enter your PIN to continue." };
      return { success: true, name: existing.Name || name };
    }
    ia_forceTextCols(ws);
    ws.appendRow([p, name, pin, ia_now(), "", "active"]);
    // Bulletproof: re-write phone + PIN cells as explicit text on the new row
    const r = ws.getLastRow();
    ws.getRange(r, 1).setNumberFormat("@").setValue(p);
    ws.getRange(r, 3).setNumberFormat("@").setValue(pin);
    return { success: true, name: name };
  } finally {
    lock.releaseLock();
  }
}

// ── Menu ─────────────────────────────────────────────────────
// Fixed (non-sabji) items, each tagged with its canonical kitchen column.
function ia_baseFixedItems() {
  return IA_FIXED_ITEMS
    .filter(function (it) { return it.cat !== "Sabji"; })
    .map(function (it) { return { name: it.name, price: it.price, cat: it.cat, col: ia_itemToCol(it.name) }; });
}

// Menu priority:
//   1. Admin override for this date+meal in IA_Daily_Menu (IA Set Menu), else
//   2. The MAIN consumer menu (SK_Daily_Menu) for this date — fixed items +
//      the day's actual Dry/Curry sabji (named), else
//   3. Generic fixed items as a last-resort fallback.
function ia_getMenu(dateStr, meal) {
  const ws = ia_getTab(IA_TAB_MENU, IA_MENU_HEADERS);
  const row = ia_rows(ws).find(function (r) {
    return ia_dateStr(r.Date) === dateStr && String(r.Meal) === meal;
  });
  if (row && row.Items_JSON) {
    try {
      const items = JSON.parse(row.Items_JSON);
      if (Array.isArray(items) && items.length) return { items: items, custom: true, source: "ia_override" };
    } catch (e) {}
  }

  // Build from the main daily menu for this date.
  try {
    const main = getMenu(dateStr); // consumer menu — has lunch/dinner dry & curry sabji names
    const items = ia_baseFixedItems();
    const dryName   = meal === "Lunch" ? main.lunch_dry   : main.dinner_dry;
    const curryName = meal === "Lunch" ? main.lunch_curry : main.dinner_curry;
    if (dryName) {
      items.push({ name: dryName + " (Dry · 100ml)", price: 22, cat: "Sabji", col: "Dry_Sabji_Mini" });
      items.push({ name: dryName + " (Dry · 250ml)", price: 45, cat: "Sabji", col: "Dry_Sabji_Full" });
    }
    if (curryName) {
      items.push({ name: curryName + " (Curry · 100ml)", price: 22, cat: "Sabji", col: "Curry_Sabji_Mini" });
      items.push({ name: curryName + " (Curry · 250ml)", price: 45, cat: "Sabji", col: "Curry_Sabji_Full" });
    }
    return { items: items, custom: false, source: "main_menu" };
  } catch (e) {
    return { items: IA_FIXED_ITEMS.slice(), custom: false, source: "fallback" };
  }
}

function ia_getMenuRange(dates, meals) {
  const out = {};
  (dates || []).forEach(function (d) {
    out[d] = {};
    (meals || IA_MEALS).forEach(function (m) { out[d][m] = ia_getMenu(d, m); });
  });
  return { menu: out, meals: IA_MEALS, address: IA_FIXED_ADDRESS };
}

function ia_setMenu(body) {
  if (!ia_isAdmin(body.pin)) return { error: "Unauthorized." };
  const dateStr = String(body.date || "").trim();
  const meal = String(body.meal || "").trim();
  if (!dateStr || IA_MEALS.indexOf(meal) === -1) return { error: "Invalid date or meal." };
  let items;
  try { items = JSON.parse(body.items_json || "[]"); } catch (e) { return { error: "Bad items payload." }; }
  if (!Array.isArray(items)) return { error: "Items must be a list." };

  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const ws = ia_getTab(IA_TAB_MENU, IA_MENU_HEADERS);
    const existing = ia_rows(ws).find(function (r) {
      return ia_dateStr(r.Date) === dateStr && String(r.Meal) === meal;
    });
    const payload = JSON.stringify(items);
    if (existing) {
      ws.getRange(existing._row, 3).setValue(payload);
      ws.getRange(existing._row, 4).setValue(body.admin || "admin");
      ws.getRange(existing._row, 5).setValue(ia_now());
    } else {
      ws.appendRow([dateStr, meal, payload, body.admin || "admin", ia_now()]);
    }
    return { success: true };
  } finally {
    lock.releaseLock();
  }
}

// ── Orders ───────────────────────────────────────────────────
function ia_submitOrder(body) {
  const auth = ia_verifyLogin(body.phone, body.pin);
  if (!auth.success) return { error: auth.error || "Login required." };

  const phone = ia_normPhone(body.phone);
  const name = String(body.name || auth.name || "").trim();
  const orders = body.orders || {};
  const dates = Object.keys(orders).sort();
  if (!dates.length) return { error: "No items selected." };

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const ws = ia_getTab(IA_TAB_ORDERS, IA_ORDERS_HEADERS);
    const submissionId = ia_genId();
    const ts = ia_now();
    let grandTotal = 0;
    const rowsToWrite = [];
    const confirmLines = [];

    for (let di = 0; di < dates.length; di++) {
      const d = dates[di];
      const day = orders[d] || {};
      for (let mi = 0; mi < IA_MEALS.length; mi++) {
        const meal = IA_MEALS[mi];
        const sel = day[meal];
        if (!sel || !Object.keys(sel).length) continue;

        if (!ia_isOpen(d, meal)) {
          return { error: meal + " ordering for " + d + " has closed. Please adjust your cart." };
        }

        const menu = ia_getMenu(d, meal).items;
        const priceOf = {}, colOf = {};
        menu.forEach(function (it) { priceOf[it.name] = Number(it.price) || 0; colOf[it.name] = it.col || null; });

        let sub = 0;
        const lineItems = [];
        const summary = [];
        Object.keys(sel).forEach(function (itemName) {
          const qty = Number(sel[itemName]) || 0;
          if (qty <= 0) return;
          const price = priceOf[itemName];
          if (price === undefined) return;
          sub += price * qty;
          lineItems.push({ name: itemName, qty: qty, price: price, col: colOf[itemName] || ia_itemToCol(itemName) });
          summary.push(qty + "× " + itemName);
        });
        if (sub <= 0) continue;

        grandTotal += sub;
        rowsToWrite.push([
          submissionId, ts, d, meal, phone, name,
          JSON.stringify(lineItems), summary.join(", "), sub,
          "Pending", "", "", "", "",
          "Pending", "", ""
        ]);
        confirmLines.push(d + " " + meal + ": ₹" + sub);
      }
    }

    if (!rowsToWrite.length) return { error: "Nothing valid to order." };

    ws.getRange(ws.getLastRow() + 1, 1, rowsToWrite.length, IA_ORDERS_HEADERS.length)
      .setValues(rowsToWrite);

    try {
      const cws = ia_getTab(IA_TAB_CUSTOMERS, IA_CUSTOMERS_HEADERS);
      const crow = ia_rows(cws).find(function (r) { return ia_normPhone(r.Phone) === phone; });
      if (crow) cws.getRange(crow._row, 5).setValue(ts);
    } catch (e) {}

    return {
      success: true,
      submission_id: submissionId,
      total: grandTotal,
      lines: confirmLines,
      address: IA_FIXED_ADDRESS,
      upi: IA_UPI_VPA,
      upi_name: IA_UPI_NAME
    };
  } finally {
    lock.releaseLock();
  }
}

function ia_myOrders(phone) {
  const p = ia_normPhone(phone);
  const ws = ia_getTab(IA_TAB_ORDERS, IA_ORDERS_HEADERS);
  const mine = ia_rows(ws).filter(function (r) { return ia_normPhone(r.Phone) === p; });
  return { orders: mine.map(ia_orderView) };
}

function ia_orderView(r) {
  return {
    submission_id: r.Submission_ID,
    date: ia_dateStr(r.Date),
    meal: r.Meal,
    phone: ia_normPhone(r.Phone),
    name: r.Customer_Name,
    summary: r.Item_Summary,
    subtotal: Number(r.Subtotal) || 0,
    payment_status: r.Payment_Status,
    approved_by: r.Approved_By,
    notes: r.Notes
  };
}

// ── Admin (main ADMIN_PIN) ───────────────────────────────────
function ia_adminOrders(body) {
  if (!ia_isAdmin(body.pin)) return { error: "Unauthorized." };
  const from = body.from || "", to = body.to || "";
  const ws = ia_getTab(IA_TAB_ORDERS, IA_ORDERS_HEADERS);
  let rows = ia_rows(ws);
  if (from) rows = rows.filter(function (r) { return ia_dateStr(r.Date) >= from; });
  if (to)   rows = rows.filter(function (r) { return ia_dateStr(r.Date) <= to; });
  return { orders: rows.map(ia_orderView) };
}

function ia_pendingApprovals(body) {
  if (!ia_isAdmin(body.pin)) return { error: "Unauthorized." };
  const ws = ia_getTab(IA_TAB_ORDERS, IA_ORDERS_HEADERS);
  const pend = ia_rows(ws).filter(function (r) {
    return String(r.Payment_Status || "").toLowerCase() === "pending";
  });
  return { orders: pend.map(ia_orderView) };
}

function ia_approve(body) {
  if (!ia_isAdmin(body.pin)) return { error: "Unauthorized." };
  const id = String(body.submission_id || "").trim();
  const meal = body.meal ? String(body.meal) : null;
  const date = body.date ? String(body.date) : null;
  if (!id) return { error: "submission_id required." };

  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const ws = ia_getTab(IA_TAB_ORDERS, IA_ORDERS_HEADERS);
    let n = 0;
    ia_rows(ws).forEach(function (r) {
      if (String(r.Submission_ID) !== id) return;
      if (meal && String(r.Meal) !== meal) return;
      if (date && ia_dateStr(r.Date) !== date) return;
      ws.getRange(r._row, 10).setValue("Paid");
      ws.getRange(r._row, 11).setValue(body.ref || "");
      ws.getRange(r._row, 12).setValue(body.admin || "admin");
      ws.getRange(r._row, 13).setValue(ia_now());
      n++;
    });
    return { success: true, updated: n };
  } finally {
    lock.releaseLock();
  }
}

function ia_customers(body) {
  if (!ia_isAdmin(body.pin)) return { error: "Unauthorized." };
  const ws = ia_getTab(IA_TAB_CUSTOMERS, IA_CUSTOMERS_HEADERS);
  return {
    customers: ia_rows(ws).map(function (r) {
      return {
        phone: ia_normPhone(r.Phone),
        name: r.Name,
        created_at: r.Created_At ? Utilities.formatDate(new Date(r.Created_At), IA_TZ, "yyyy-MM-dd") : "",
        last_order: r.Last_Order_At ? Utilities.formatDate(new Date(r.Last_Order_At), IA_TZ, "yyyy-MM-dd") : "",
        status: r.Status || "active"
      };
    })
  };
}

// Admin: clear a customer's PIN so they can set a fresh one on next login.
// The row is kept; only the PIN cell (column C) is emptied. ia_checkPhone then
// returns pin_reset:true and the app routes them to the "set new PIN" screen.
function ia_resetPin(body) {
  if (!ia_isAdmin(body.pin)) return { error: "Unauthorized." };
  const p = ia_normPhone(body.phone);
  if (p.length !== 10) return { error: "Enter a valid 10-digit number." };
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const ws = ia_getTab(IA_TAB_CUSTOMERS, IA_CUSTOMERS_HEADERS);
    const existing = ia_rows(ws).find(function (r) { return ia_normPhone(r.Phone) === p; });
    if (!existing) return { error: "Customer not found." };
    ia_forceTextCols(ws);
    ws.getRange(existing._row, 3).setNumberFormat("@").setValue(""); // PIN = column C
    return { success: true, name: existing.Name || "" };
  } finally {
    lock.releaseLock();
  }
}

function ia_analytics(body) {
  if (!ia_isAdmin(body.pin)) return { error: "Unauthorized." };
  const from = body.from || "", to = body.to || "";
  const ws = ia_getTab(IA_TAB_ORDERS, IA_ORDERS_HEADERS);
  let rows = ia_rows(ws);
  if (from) rows = rows.filter(function (r) { return ia_dateStr(r.Date) >= from; });
  if (to)   rows = rows.filter(function (r) { return ia_dateStr(r.Date) <= to; });

  let totalRevenue = 0, paidRevenue = 0, pendingRevenue = 0;
  const byMeal = { Lunch: 0, Dinner: 0 };
  const byDate = {}, itemCounts = {}, customers = {};

  rows.forEach(function (r) {
    const sub = Number(r.Subtotal) || 0;
    totalRevenue += sub;
    if (String(r.Payment_Status).toLowerCase() === "paid") paidRevenue += sub; else pendingRevenue += sub;
    if (byMeal[r.Meal] !== undefined) byMeal[r.Meal] += sub;
    byDate[ia_dateStr(r.Date)] = (byDate[ia_dateStr(r.Date)] || 0) + sub;
    customers[ia_normPhone(r.Phone)] = true;
    try {
      JSON.parse(r.Items_JSON || "[]").forEach(function (it) {
        itemCounts[it.name] = (itemCounts[it.name] || 0) + (Number(it.qty) || 0);
      });
    } catch (e) {}
  });

  const topItems = Object.keys(itemCounts)
    .map(function (k) { return { name: k, qty: itemCounts[k] }; })
    .sort(function (a, b) { return b.qty - a.qty; })
    .slice(0, 15);

  return {
    order_count: rows.length,
    unique_customers: Object.keys(customers).length,
    total_revenue: totalRevenue,
    paid_revenue: paidRevenue,
    pending_revenue: pendingRevenue,
    by_meal: byMeal,
    by_date: byDate,
    top_items: topItems
  };
}

// Kitchen prep: KITCHEN_PIN (or ADMIN_PIN). Returns cooking quantities
// + headcount ONLY — no revenue, names, or order detail.
function ia_prep(body) {
  if (!ia_canPrep(body.pin)) return { error: "Unauthorized." };
  const date = String(body.date || ia_todayStr());
  const meal = body.meal ? String(body.meal) : null;
  const ws = ia_getTab(IA_TAB_ORDERS, IA_ORDERS_HEADERS);
  const rows = ia_rows(ws).filter(function (r) {
    if (ia_dateStr(r.Date) !== date) return false;
    if (meal && String(r.Meal) !== meal) return false;
    return true;
  });
  const agg = {}, headcount = {};
  rows.forEach(function (r) {
    const m = r.Meal;
    if (!agg[m]) agg[m] = {};
    headcount[m] = (headcount[m] || 0) + 1;
    try {
      JSON.parse(r.Items_JSON || "[]").forEach(function (it) {
        agg[m][it.name] = (agg[m][it.name] || 0) + (Number(it.qty) || 0);
      });
    } catch (e) {}
  });
  return { date: date, prep: agg, headcount: headcount, address: IA_FIXED_ADDRESS };
}

// ── Driver (KITCHEN_PIN or ADMIN_PIN — same staff tier as kitchen) ──
// All IntentAmplify orders deliver to the single fixed address, so the
// driver view groups the day's orders by meal and tracks en-route /
// delivered status stored directly on the IA_Orders row.
function ia_colIndex(h) { return IA_ORDERS_HEADERS.indexOf(h) + 1; }

function ia_getDriverOrders(body) {
  if (!ia_canPrep(body.pin)) return { error: "Unauthorized." };
  const date = String(body.date || ia_todayStr());
  const ws = ia_getTab(IA_TAB_ORDERS, IA_ORDERS_HEADERS);
  const meals = { Lunch: [], Dinner: [] };
  ia_rows(ws).forEach(function (r) {
    if (ia_dateStr(r.Date) !== date) return;
    if (!meals[r.Meal]) return;
    meals[r.Meal].push({
      submissionId:   r.Submission_ID,
      name:           r.Customer_Name,
      phone:          ia_normPhone(r.Phone),
      summary:        r.Item_Summary,
      amount:         Number(r.Subtotal) || 0,
      paymentStatus:  r.Payment_Status,
      deliveryStatus: r.Delivery_Status || "Pending",
      enRouteAt:      r.EnRoute_At ? String(r.EnRoute_At) : "",
      deliveredAt:    r.Delivered_At ? String(r.Delivered_At) : ""
    });
  });
  return { date: date, meals: meals, address: IA_FIXED_ADDRESS };
}

function ia_markDelivered(body) {
  if (!ia_canPrep(body.pin)) return { error: "Unauthorized." };
  const id = String(body.submission_id || "").trim();
  const date = body.date ? String(body.date) : null;
  const meal = body.meal ? String(body.meal) : null;
  if (!id) return { error: "submission_id required." };
  const when = body.deliveredAt || Utilities.formatDate(ia_now(), IA_TZ, "yyyy-MM-dd HH:mm");

  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const ws = ia_getTab(IA_TAB_ORDERS, IA_ORDERS_HEADERS);
    let n = 0;
    ia_rows(ws).forEach(function (r) {
      if (String(r.Submission_ID) !== id) return;
      if (date && ia_dateStr(r.Date) !== date) return;
      if (meal && String(r.Meal) !== meal) return;
      ws.getRange(r._row, ia_colIndex("Delivery_Status")).setValue("Delivered");
      ws.getRange(r._row, ia_colIndex("Delivered_At")).setValue(when);
      n++;
    });
    return { success: true, updated: n, deliveredAt: when };
  } finally {
    lock.releaseLock();
  }
}

function ia_batchMarkEnRoute(body) {
  if (!ia_canPrep(body.pin)) return { error: "Unauthorized." };
  const date = body.date ? String(body.date) : null;
  const meal = body.meal ? String(body.meal) : null;
  const ids = Array.isArray(body.submissionIds) ? body.submissionIds.map(String) : null;
  const when = body.enRouteAt || Utilities.formatDate(ia_now(), IA_TZ, "yyyy-MM-dd HH:mm");

  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const ws = ia_getTab(IA_TAB_ORDERS, IA_ORDERS_HEADERS);
    let n = 0;
    ia_rows(ws).forEach(function (r) {
      if (ids) { if (ids.indexOf(String(r.Submission_ID)) === -1) return; }
      else {
        if (date && ia_dateStr(r.Date) !== date) return;
        if (meal && String(r.Meal) !== meal) return;
        if (!date && !meal) return;
      }
      if (String(r.Delivery_Status) === "Delivered") return; // don't regress delivered
      ws.getRange(r._row, ia_colIndex("Delivery_Status")).setValue("EnRoute");
      ws.getRange(r._row, ia_colIndex("EnRoute_At")).setValue(when);
      n++;
    });
    return { success: true, updated: n, enRouteAt: when };
  } finally {
    lock.releaseLock();
  }
}

// ── Kitchen Summary + Labels (clone of consumer shapes, from IA_Orders) ──
// IntentAmplify stores items in Items_JSON; the cloned kitchen.html frontend
// expects the consumer column layout. This maps IA item names → those columns
// so the SAME frontend (units, recipe weights, Marathi, packing, labels) works.
function ia_itemToCol(name) {
  const map = {
    "Chapati": "Chapati", "Without Oil Chapati": "Without_Oil_Chapati",
    "Phulka": "Phulka", "Ghee Phulka": "Ghee_Phulka",
    "Jowar Bhakri": "Jowar_Bhakri", "Bajra Bhakri": "Bajra_Bhakri",
    "Dry Sabji Mini (100ml)": "Dry_Sabji_Mini", "Dry Sabji Full (250ml)": "Dry_Sabji_Full",
    "Curry Sabji Mini (100ml)": "Curry_Sabji_Mini", "Curry Sabji Full (250ml)": "Curry_Sabji_Full",
    "Dal (200ml)": "Dal", "Rice (100g)": "Rice", "Salad (40g)": "Salad", "Curd (50g)": "Curd"
  };
  return map[name] || null;
}
function ia_orderCols(itemsJson) {
  const col = {};
  try { JSON.parse(itemsJson || "[]").forEach(function (it) {
    // Prefer the canonical column stored on the line (named sabji from the main
    // menu carries it); fall back to mapping the name for legacy/generic items.
    let c = it.col || ia_itemToCol(it.name);
    if (!c && it.name) {
      if (it.name.indexOf("(Dry · 100ml)") > -1) c = "Dry_Sabji_Mini";
      else if (it.name.indexOf("(Dry · 250ml)") > -1) c = "Dry_Sabji_Full";
      else if (it.name.indexOf("(Curry · 100ml)") > -1) c = "Curry_Sabji_Mini";
      else if (it.name.indexOf("(Curry · 250ml)") > -1) c = "Curry_Sabji_Full";
    }
    if (c) col[c] = (col[c] || 0) + (Number(it.qty) || 0);
  }); } catch (e) {}
  return col;
}

// ── UNIFIED OPS: expose IA_Orders as SK_Orders-shaped rows ──────────
// Lets the consumer kitchen / driver / label / admin functions process
// IntentAmplify orders alongside regular orders with no per-function rewrite.
// Every IA order is tagged "[IA] " on the name, delivers to the fixed S4
// address, and has its items mapped into the consumer column layout so the
// existing prep/label/packing math just works. Returns plain row objects
// (same field names getRecentRows/getAllRows produce for SK_Orders).
function ia_rowsAsSK() {
  try {
    const ws = ia_getTab(IA_TAB_ORDERS, IA_ORDERS_HEADERS);
    return ia_rows(ws)
      // Defensive: keep cancelled/rejected IA orders out of the shared kitchen/
      // driver/packaging views. (No IA cancel path exists today, so this is a
      // no-op now, but it future-proofs if one is added — same rule the
      // consumer prep functions apply.)
      .filter(function (r) { return typeof _isOrderCancelled !== "function" || !_isOrderCancelled(r.Payment_Status); })
      .map(function (r) {
      const col = ia_orderCols(r.Items_JSON);
      // Items_JSON in SK style: { itemName: qty } (descriptive names are fine for labels)
      const itemsObj = {};
      try { JSON.parse(r.Items_JSON || "[]").forEach(function (it) {
        itemsObj[it.name] = (itemsObj[it.name] || 0) + (Number(it.qty) || 0);
      }); } catch (e) {}
      return {
        Submission_ID:  String(r.Submission_ID || ""),
        Submitted_At:   r.Timestamp ? String(r.Timestamp) : "",
        Order_Date:     ia_dateStr(r.Date),
        Meal_Type:      String(r.Meal || ""),
        Customer_Name:  "[IA] " + String(r.Customer_Name || ""),
        Phone:          String(r.Phone || ""),
        Area:           "S4 Towers, Magarpatta",
        Wing: "", Flat: "", Floor: "", Society: "S4 Towers, Magarpatta",
        Full_Address:   "S4 Towers, Magarpatta",
        Maps_Link:      "https://maps.app.goo.gl/wEndRh6jnkjL1GRC9",
        Landmark:       "IntentAmplify (corporate)",
        Delivery_Point: "Handover at Office Reception",
        Items_JSON:     JSON.stringify(itemsObj),
        // Item columns the consumer prep/label math reads:
        Chapati: col.Chapati || 0, Without_Oil_Chapati: col.Without_Oil_Chapati || 0,
        Phulka: col.Phulka || 0, Ghee_Phulka: col.Ghee_Phulka || 0,
        Jowar_Bhakri: col.Jowar_Bhakri || 0, Bajra_Bhakri: col.Bajra_Bhakri || 0,
        Dry_Sabji_Mini: col.Dry_Sabji_Mini || 0, Dry_Sabji_Full: col.Dry_Sabji_Full || 0,
        Curry_Sabji_Mini: col.Curry_Sabji_Mini || 0, Curry_Sabji_Full: col.Curry_Sabji_Full || 0,
        Dal: col.Dal || 0, Rice: col.Rice || 0, Salad: col.Salad || 0, Curd: col.Curd || 0,
        // Money — IA has no delivery/surcharge/discounts:
        Food_Subtotal:      Number(r.Subtotal) || 0,
        Net_Total:          Number(r.Subtotal) || 0,
        Delivery_Charge:    0, Small_Order_Fee: 0, Inflation_Surcharge: 0,
        Discount_Amount:    0, Review_Discount: 0, Loyalty_Discount: "No",
        Payment_Status:     String(r.Payment_Status || "Pending"),
        Special_Notes:        String(r.Notes || ""),
        Special_Notes_Kitchen:String(r.Notes || ""),
        Special_Notes_Delivery: "",
        marathiNotes: "",
        Packed: false,
        _isIA: true
      };
    });
  } catch (e) { return []; }
}

function ia_getKitchenSummary(p) {
  if (!ia_canPrep(p.pin)) return { error: "Unauthorized." };
  const date = ia_dateStr(p.date) || ia_todayStr();
  const ws = ia_getTab(IA_TAB_ORDERS, IA_ORDERS_HEADERS);
  const ROTI_COLS = ["Chapati","Without_Oil_Chapati","Phulka","Ghee_Phulka","Jowar_Bhakri","Bajra_Bhakri"];
  const ROTI_LIMITS = { "Chapati":6,"Without_Oil_Chapati":6,"Phulka":12,"Ghee_Phulka":12,"Jowar_Bhakri":2,"Bajra_Bhakri":2 };
  const meals = {}; const orders = [];
  // Pull the day's sabji names from the main menu so prep shows the real dish
  // (and the frontend recipe-weight cards light up).
  let mainMenu = {}; try { mainMenu = getMenu(date) || {}; } catch (e) {}

  ia_rows(ws).forEach(function (r) {
    if (ia_dateStr(r.Date) !== date) return;
    const meal = String(r.Meal || ""); if (IA_MEALS.indexOf(meal) === -1) return;
    if (!meals[meal]) meals[meal] = { count: 0 };
    const m = meals[meal]; m.count++;
    if (!m.rotis) m.rotis = {};
    if (!m.rotiMatrix) { m.rotiMatrix = {}; ROTI_COLS.forEach(function (c) { m.rotiMatrix[c] = {}; }); }
    if (!m.sabji) m.sabji = { dry_kg:0, curry_kg:0,
      dry_name:   (meal === "Lunch" ? mainMenu.lunch_dry   : mainMenu.dinner_dry)   || "Sabji (Dry)",
      curry_name: (meal === "Lunch" ? mainMenu.lunch_curry : mainMenu.dinner_curry) || "Sabji (Curry)",
      dry_mini:0, dry_full:0, curry_mini:0, curry_full:0 };
    if (!m.other) m.other = { Dal:{kg:0,count:0}, Rice:{count:0}, Salad:{count:0}, Curd:{count:0} };
    if (!m.riceMatrix) m.riceMatrix = {}; if (!m.saladMatrix) m.saladMatrix = {}; if (!m.curdMatrix) m.curdMatrix = {};

    const col = ia_orderCols(r.Items_JSON);
    const parts = [];
    ROTI_COLS.forEach(function (c) {
      const q = col[c] || 0;
      if (q > 0) { m.rotis[c] = (m.rotis[c] || 0) + q; parts.push(q + " " + c.replace(/_/g, " "));
        calculatePackets(q, ROTI_LIMITS[c]).forEach(function (pk) { m.rotiMatrix[c][pk] = (m.rotiMatrix[c][pk] || 0) + 1; }); }
    });
    const dMini=col.Dry_Sabji_Mini||0, dFull=col.Dry_Sabji_Full||0, cMini=col.Curry_Sabji_Mini||0, cFull=col.Curry_Sabji_Full||0;
    m.sabji.dry_mini+=dMini; m.sabji.dry_full+=dFull; m.sabji.curry_mini+=cMini; m.sabji.curry_full+=cFull;
    if(dMini)parts.push(dMini+" Mini Dry"); if(dFull)parts.push(dFull+" Full Dry"); if(cMini)parts.push(cMini+" Mini Curry"); if(cFull)parts.push(cFull+" Full Curry");
    const dalQ=col.Dal||0, riceQ=col.Rice||0, saladQ=col.Salad||0, curdQ=col.Curd||0;
    m.other.Dal.kg+=dalQ*1.33; m.other.Dal.count+=dalQ; m.other.Rice.count+=riceQ; m.other.Salad.count+=saladQ; m.other.Curd.count+=curdQ;
    if(riceQ>0) calculatePackets(riceQ,3).forEach(function(pk){ m.riceMatrix[pk]=(m.riceMatrix[pk]||0)+1; });
    if(saladQ>0) calculatePackets(saladQ,4).forEach(function(pk){ m.saladMatrix[pk]=(m.saladMatrix[pk]||0)+1; });
    if(curdQ>0) calculatePackets(curdQ,2).forEach(function(pk){ m.curdMatrix[pk]=(m.curdMatrix[pk]||0)+1; });
    if(dalQ)parts.push(dalQ+" Dal"); if(riceQ)parts.push(riceQ+" Rice"); if(saladQ)parts.push(saladQ+" Salad"); if(curdQ)parts.push(curdQ+" Curd");

    orders.push({
      Submission_ID: String(r.Submission_ID||""), Customer_Name: String(r.Customer_Name||""), Meal_Type: meal,
      summary: parts.join(", "),
      items: { Chapati:col.Chapati||0, Without_Oil_Chapati:col.Without_Oil_Chapati||0, Phulka:col.Phulka||0, Ghee_Phulka:col.Ghee_Phulka||0,
        Jowar_Bhakri:col.Jowar_Bhakri||0, Bajra_Bhakri:col.Bajra_Bhakri||0, Dry_Sabji_Mini:dMini, Dry_Sabji_Full:dFull,
        Curry_Sabji_Mini:cMini, Curry_Sabji_Full:cFull, Dal:dalQ, Rice:riceQ, Salad:saladQ, Curd:curdQ },
      Special_Notes_Kitchen: String(r.Notes||""), Special_Notes_Delivery: "", Delivery_Point: "", marathiNotes: "", Packed: false
    });
  });
  ["Lunch","Dinner"].forEach(function(meal){ if(meals[meal]&&meals[meal].other&&meals[meal].other.Dal) meals[meal].other.Dal.kg=Math.round(meals[meal].other.Dal.kg*100)/100; });
  return { date: date, meals: meals, orders: orders, cutoffs: {} };
}

function ia_getLabelOrders(p) {
  if (!ia_canPrep(p.pin)) return { error: "Unauthorized." };
  const date = ia_dateStr(p.date) || ia_todayStr();
  const meal = String(p.meal || "");
  const ws = ia_getTab(IA_TAB_ORDERS, IA_ORDERS_HEADERS);
  const COLS = ["Chapati","Without_Oil_Chapati","Phulka","Ghee_Phulka","Jowar_Bhakri","Bajra_Bhakri",
                "Dry_Sabji_Mini","Dry_Sabji_Full","Curry_Sabji_Mini","Curry_Sabji_Full","Dal","Rice","Salad"];
  const orders = ia_rows(ws)
    .filter(function (r) { return ia_dateStr(r.Date) === date && String(r.Meal) === meal; })
    .map(function (r) {
      const col = ia_orderCols(r.Items_JSON);
      const obj = { name: String(r.Customer_Name||""), area: IA_FIXED_ADDRESS, notes: String(r.Notes||""),
        Curd: col.Curd || 0, Items_JSON: String(r.Items_JSON || "") };
      COLS.forEach(function (c) { obj[c] = col[c] || 0; });
      return obj;
    });
  return { orders: orders };
}

function ia_config() {
  return {
    company: IA_COMPANY_NAME,
    address: IA_FIXED_ADDRESS,
    meals: IA_MEALS,
    cutoffs: IA_CUTOFFS,
    upi: IA_UPI_VPA,
    upi_name: IA_UPI_NAME,
    version: "26.06.17.11"
  };
}

// One-time: run from the editor to create the IA_ tabs.
function ia_setup() {
  const cust = ia_getTab(IA_TAB_CUSTOMERS, IA_CUSTOMERS_HEADERS);
  ia_forceTextCols(cust); // apply text format to existing tab too
  ia_getTab(IA_TAB_ORDERS, IA_ORDERS_HEADERS);
  ia_getTab(IA_TAB_MENU, IA_MENU_HEADERS);
  Logger.log("IntentAmplify IA_ tabs ready (PIN/phone columns set to text).");
}

// ============================================================
// HDFC GATEWAY INTEGRATION FOR INTENTAMPLIFY
// ============================================================

/**
 * Creates an HDFC payment session for an IntentAmplify order.
 * Called by intentamplify.html just before redirecting to the gateway.
 *
 * Anti-tamper: amount is computed SERVER-SIDE from authoritative IA menu
 * prices. The client never sends an amount — the body only contains the
 * cart (orders), which the server re-prices here.
 *
 * @param {Object} body { phone, pin, name, orders }
 * @returns {{ success, payment_url, order_id } | { error }}
 */
function ia_hdfc_createSession(body) {
  if (!PAYMENT_GATEWAY_ENABLED) return { error: "Gateway not enabled." };
  if (!HDFC_MERCHANT_ID || !HDFC_API_KEY) return { error: "Gateway credentials not configured." };

  // 1. Auth
  const auth = ia_verifyLogin(body.phone, body.pin);
  if (!auth.success) return { error: auth.error || "Login required." };

  const phone = ia_normPhone(body.phone);
  const name  = String(auth.name || body.name || "Customer").trim();
  const orders = body.orders || {};
  const dates  = Object.keys(orders).sort();
  if (!dates.length) return { error: "No items selected." };

  // 2. Compute authoritative IA total server-side (never trust client amount)
  let grandTotal = 0;
  let hasItems   = false;
  for (const d of dates) {
    const day = orders[d] || {};
    for (const meal of IA_MEALS) {
      const sel = day[meal];
      if (!sel || !Object.keys(sel).length) continue;
      if (!ia_isOpen(d, meal)) continue;
      const menu = ia_getMenu(d, meal).items;
      const priceOf = {};
      menu.forEach(function(it) { priceOf[it.name] = Number(it.price) || 0; });
      Object.keys(sel).forEach(function(itemName) {
        const qty   = Number(sel[itemName]) || 0;
        const price = priceOf[itemName];
        if (qty > 0 && price !== undefined) { grandTotal += price * qty; hasItems = true; }
      });
    }
  }
  if (!hasItems || grandTotal <= 0) return { error: "Nothing valid to order." };

  // 3. Generate gateway order ID (max 21 chars, alphanumeric, unique)
  //    Format: IA + YYMMDDHHMMSS + 5-char random = 19 chars
  const pad  = function(n) { return String(n).padStart(2, "0"); };
  const now  = new Date();
  const ts   = String(now.getFullYear()).slice(2) + pad(now.getMonth() + 1) + pad(now.getDate())
             + pad(now.getHours()) + pad(now.getMinutes()) + pad(now.getSeconds());
  const rand = Utilities.getUuid().replace(/-/g, "").slice(0, 5).toUpperCase();
  const orderId = "IA" + ts + rand; // e.g. IA260617103245ABCDE

  // 4. Store session in IA_PENDING_ORDERS (separate from HDFC_PENDING_ORDERS)
  //    so the main Svaadh flow is never affected.
  try {
    const props     = PropertiesService.getScriptProperties();
    const iaPending = JSON.parse(props.getProperty("IA_PENDING_ORDERS") || "{}");
    const nowMs     = Date.now();
    // Expire entries older than 30 min to keep property size under control
    Object.keys(iaPending).forEach(function(k) {
      if (nowMs - (iaPending[k].ts || 0) > 30 * 60 * 1000) delete iaPending[k];
    });
    iaPending[orderId] = {
      ts:              nowMs,
      phone:           phone,
      pin:             body.pin,
      name:            name,
      orders:          orders,
      expected_amount: grandTotal,
      source:          "ia"
    };
    props.setProperty("IA_PENDING_ORDERS", JSON.stringify(iaPending));
  } catch (e) {
    return { error: "Could not save session: " + e.message };
  }

  // 5. Call HDFC SmartGateway /session endpoint directly
  //    (replicates hdfc_createSession payload but uses IA-specific total + description)
  const authToken = Utilities.base64Encode(HDFC_API_KEY + ":");
  const payload = {
    order_id:               orderId,
    amount:                 Math.round(grandTotal), // SmartGateway takes rupees, NOT paise
    currency:               "INR",
    customer_id:            phone,
    customer_phone:         phone,
    customer_email:         phone + "@svaadh.noemail",
    payment_page_client_id: HDFC_MERCHANT_ID,
    action:                 "paymentPage",
    return_url:             HDFC_RETURN_URL + (HDFC_RETURN_URL.indexOf("?") === -1 ? "?_popup=1" : "&_popup=1"),
    description:            "IntentAmplify Meal",
    first_name:             name.split(" ")[0] || name,
    last_name:              name.split(" ").slice(1).join(" ") || "",
    udf1:                   phone,
    udf3:                   "intentamplify",
    notification_url:       HDFC_RETURN_URL
  };
  if (HDFC_UPI_ONLY) {
    payload.payment_filter = {
      allowDefaultOptions: false,
      options: [{ enable: true, paymentMethodType: "UPI" }]
    };
  }

  try {
    const resp     = UrlFetchApp.fetch(HDFC_BASE_URL + "/session", {
      method:             "post",
      contentType:        "application/json",
      headers: {
        "Authorization": "Basic " + authToken,
        "x-merchantid":  HDFC_MERCHANT_ID,
        "version":       "2023-01-01"
      },
      payload:            JSON.stringify(payload),
      muteHttpExceptions: true
    });
    const respCode = resp.getResponseCode();
    const respBody = JSON.parse(resp.getContentText());
    console.log("ia_hdfc_createSession [" + respCode + "] orderId=" + orderId, JSON.stringify(respBody));

    if (respCode !== 200 && respCode !== 201) {
      const errMsg = (respBody.error_info && respBody.error_info.user_message)
        || respBody.user_message || respBody.error_message || ("HTTP " + respCode);
      return { error: "HDFC session creation failed: " + errMsg };
    }

    const paymentUrl = (respBody.payment_links && respBody.payment_links.web)
      ? respBody.payment_links.web : null;
    if (!paymentUrl) return { error: "HDFC returned no payment URL. Check merchant config." };

    return { success: true, payment_url: paymentUrl, order_id: orderId };

  } catch (err) {
    console.error("ia_hdfc_createSession network error:", err.message);
    return { error: "Network error creating payment session: " + err.message };
  }
}

/**
 * Called by intentamplify.html after HDFC redirects back.
 * Verifies payment with HDFC Status API (never trusts client status),
 * cross-checks charged amount, then writes order rows as Paid.
 *
 * @param {Object} body { order_id, status, signature, ... } — full HDFC return params
 * @returns {{ success, submission_id, total } | { error }}
 */
function ia_hdfc_verifyAndSubmit(body) {
  const orderId = String(body.order_id || "").trim();
  if (!orderId) return { error: "Missing order_id." };

  // 1. Read IA pending session
  const props     = PropertiesService.getScriptProperties();
  const iaPending = JSON.parse(props.getProperty("IA_PENDING_ORDERS") || "{}");
  const entry     = iaPending[orderId];
  if (!entry) return { error: "Session expired or not found. Please contact support.", expired: true };

  // 2. Verify with HDFC Status API — NEVER trust the client-supplied status string.
  //    Same policy as the main Svaadh flow (hdfc_verifyReturnPayload).
  const statusCheck = hdfc_getOrderStatus(orderId);
  if (!statusCheck.confirmed) {
    const apiStatus = String(statusCheck.status || "").toUpperCase();
    console.warn("ia_hdfc_verifyAndSubmit: not confirmed — orderId=" + orderId + " apiStatus=" + apiStatus);
    return {
      error: "Payment could not be verified by HDFC. Status: " + apiStatus,
      paid:  false,
      api_status: apiStatus
    };
  }

  // 3. Anti-tamper: charged amount must match what we told HDFC to charge.
  //    ₹1 rounding tolerance accounts for SmartGateway rounding edge cases.
  const charged  = Number(statusCheck.amount || 0);
  const expected = Number(entry.expected_amount || 0);
  if (expected > 0 && charged < expected - 1) {
    console.error("⚠️ IA AMOUNT TAMPER — orderId=" + orderId
      + " charged=" + charged + " expected=" + expected);
    return {
      error:           "Payment amount mismatch (charged ₹" + charged
                     + " vs expected ₹" + expected + "). Order NOT placed. Contact support.",
      tamper_detected: true,
      charged_amount:  charged,
      expected_amount: expected
    };
  }

  // 4. Write order rows (with concurrency lock)
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const ws = ia_getTab(IA_TAB_ORDERS, IA_ORDERS_HEADERS);

    // Idempotency: if rows already exist for this orderId (e.g. webhook beat us), skip re-write.
    const existingRows = ia_rows(ws).filter(function(r) {
      return String(r.Submission_ID || "") === orderId;
    });
    if (existingRows.length) {
      console.log("ia_hdfc_verifyAndSubmit: rows already exist for " + orderId + " — skipping re-write (idempotent).");
      return { success: true, submission_id: orderId, total: entry.expected_amount };
    }

    const ts          = ia_now();
    const orders      = entry.orders || {};
    const dates       = Object.keys(orders).sort();
    const rowsToWrite = [];

    for (const d of dates) {
      const day = orders[d] || {};
      for (const meal of IA_MEALS) {
        const sel = day[meal];
        if (!sel || !Object.keys(sel).length) continue;
        // Allow slightly-past-cutoff orders through here since payment is confirmed.
        // If the meal was truly closed at session-creation time ia_hdfc_createSession
        // already excluded it from the total.
        const menu    = ia_getMenu(d, meal).items;
        const priceOf = {};
        const colOf   = {};
        menu.forEach(function(it) { 
          priceOf[it.name] = Number(it.price) || 0; 
          colOf[it.name] = it.col;
        });

        let sub = 0;
        const lineItems = [], summary = [];
        Object.keys(sel).forEach(function(itemName) {
          const qty   = Number(sel[itemName]) || 0;
          const price = priceOf[itemName];
          if (qty <= 0 || price === undefined) return;
          sub += price * qty;
          const li = { name: itemName, qty: qty, price: price };
          if (colOf[itemName]) li.col = colOf[itemName];
          lineItems.push(li);
          summary.push(qty + "\u00d7 " + itemName);
        });
        if (sub <= 0) continue;

        rowsToWrite.push([
          orderId,              // Submission_ID  (= gateway order_id for IA)
          ts,                   // Timestamp
          d,                    // Date
          meal,                 // Meal
          entry.phone,          // Phone
          entry.name,           // Customer_Name
          JSON.stringify(lineItems), // Items_JSON
          summary.join(", "),   // Item_Summary
          sub,                  // Subtotal
          "Paid",               // Payment_Status — confirmed by HDFC gateway
          orderId,              // Payment_Ref — gateway order ID as reference
          "Gateway (HDFC)",     // Approved_By
          ts,                   // Approved_At
          "",                   // Notes
          "Pending",            // Delivery_Status
          "",                   // EnRoute_At
          ""                    // Delivered_At
        ]);
      }
    }

    if (!rowsToWrite.length) return { error: "Nothing valid to write — all meals may be closed." };

    ws.getRange(ws.getLastRow() + 1, 1, rowsToWrite.length, IA_ORDERS_HEADERS.length)
      .setValues(rowsToWrite);

    // Update Last_Order_At on the customer record
    try {
      const cws  = ia_getTab(IA_TAB_CUSTOMERS, IA_CUSTOMERS_HEADERS);
      const crow = ia_rows(cws).find(function(r) {
        return ia_normPhone(r.Phone) === ia_normPhone(entry.phone);
      });
      if (crow) cws.getRange(crow._row, 5).setValue(ts);
    } catch (e) { /* non-fatal */ }

    console.log("ia_hdfc_verifyAndSubmit: wrote " + rowsToWrite.length + " rows for " + orderId);
    return { success: true, submission_id: orderId, total: entry.expected_amount };

  } finally {
    lock.releaseLock();
  }
}

