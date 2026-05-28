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
  return { exists: true, name: row.Name || "", status: row.Status || "active" };
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
      if (String(existing.PIN) !== pin) return { error: "Account exists. Enter your PIN to continue." };
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
function ia_getMenu(dateStr, meal) {
  const ws = ia_getTab(IA_TAB_MENU, IA_MENU_HEADERS);
  const row = ia_rows(ws).find(function (r) {
    return String(r.Date) === dateStr && String(r.Meal) === meal;
  });
  if (row && row.Items_JSON) {
    try {
      const items = JSON.parse(row.Items_JSON);
      if (Array.isArray(items) && items.length) return { items: items, custom: true };
    } catch (e) {}
  }
  return { items: IA_FIXED_ITEMS.slice(), custom: false };
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
      return String(r.Date) === dateStr && String(r.Meal) === meal;
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
        const priceOf = {};
        menu.forEach(function (it) { priceOf[it.name] = Number(it.price) || 0; });

        let sub = 0;
        const lineItems = [];
        const summary = [];
        Object.keys(sel).forEach(function (itemName) {
          const qty = Number(sel[itemName]) || 0;
          if (qty <= 0) return;
          const price = priceOf[itemName];
          if (price === undefined) return;
          sub += price * qty;
          lineItems.push({ name: itemName, qty: qty, price: price });
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
    date: String(r.Date),
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
  if (from) rows = rows.filter(function (r) { return String(r.Date) >= from; });
  if (to)   rows = rows.filter(function (r) { return String(r.Date) <= to; });
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
      if (date && String(r.Date) !== date) return;
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

function ia_analytics(body) {
  if (!ia_isAdmin(body.pin)) return { error: "Unauthorized." };
  const from = body.from || "", to = body.to || "";
  const ws = ia_getTab(IA_TAB_ORDERS, IA_ORDERS_HEADERS);
  let rows = ia_rows(ws);
  if (from) rows = rows.filter(function (r) { return String(r.Date) >= from; });
  if (to)   rows = rows.filter(function (r) { return String(r.Date) <= to; });

  let totalRevenue = 0, paidRevenue = 0, pendingRevenue = 0;
  const byMeal = { Lunch: 0, Dinner: 0 };
  const byDate = {}, itemCounts = {}, customers = {};

  rows.forEach(function (r) {
    const sub = Number(r.Subtotal) || 0;
    totalRevenue += sub;
    if (String(r.Payment_Status).toLowerCase() === "paid") paidRevenue += sub; else pendingRevenue += sub;
    if (byMeal[r.Meal] !== undefined) byMeal[r.Meal] += sub;
    byDate[r.Date] = (byDate[r.Date] || 0) + sub;
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
    if (String(r.Date) !== date) return false;
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
    if (String(r.Date) !== date) return;
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
      if (date && String(r.Date) !== date) return;
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
        if (date && String(r.Date) !== date) return;
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

function ia_config() {
  return {
    company: IA_COMPANY_NAME,
    address: IA_FIXED_ADDRESS,
    meals: IA_MEALS,
    cutoffs: IA_CUTOFFS,
    upi: IA_UPI_VPA,
    upi_name: IA_UPI_NAME
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
