// ============================================================
// 02_Orders_Menu.gs — customers, login, wallet, menu, submit/delete order
// Split from Code.gs (verbatim). Global config in 00_Config.gs (loads first).
// ============================================================

// ── GET CUSTOMER ─────────────────────────────────────────────
function getCustomer(phone) {
  if (!phone) return {found: false};
  const ss = getSpreadsheet();
  const ws = getOrCreateTab(ss, TAB_CUSTOMERS, CUSTOMERS_HEADERS);
  const rows = getAllRows(ws);
  const pStr = _normalizePhone(phone);
  const r = rows.find(x => _normalizePhone(x.Phone) === pStr);
  if (!r) {
    // Not in the live list — maybe an archived returning customer. Recognize them
    // (read-only, cold path) so the frontend shows "enter your PIN" instead of
    // forcing a fresh registration. The actual restore happens in verifyLogin once
    // the PIN is confirmed. Name is intentionally withheld (matches the hasPin path).
    if (typeof _findArchivedCustomer === "function") {
      const arc = _findArchivedCustomer(pStr);
      if (arc && arc.pin !== "") return { found: true, hasPin: true, archived: true };
    }
    return {found: false, hasPin: false, wallet_balance: 0};
  }

  const hasPin = (String(r.PIN || "").trim() !== "");
  
  if (hasPin) {
    // Return early without profile details to secure them.
    return { found: true, hasPin: true };
  }
  
  return {
    found: true,
    hasPin: false,
    name:               r.Customer_Name || "",
    area:               r.Area || "",
    wing:               r.Wing || "",
    flat:               r.Flat || "",
    floor:              r.Floor || "",
    society:            r.Society || "",
    maps:               r.Maps_Link || "",
    landmark:           r.Landmark || "",
    payment_preference: r.Payment_Freq || "Daily Payment",
    meal_addresses:     r.Meal_Addresses || "",
    promoCount: (function(v){
      if (v === "" || v === null || v === undefined) return null;
      var num = Number(v);
      return isNaN(num) ? v : num;
    })(r.Review_Promo_Count),
    wallet_balance:     _calculateWalletBalance(phone),
    feeExempt:          (r.Fee_Exempt === "Yes" || r.Fee_Exempt === true),
    onAccount:          r.On_Account || "No",
    billingCycle:       r.Billing_Cycle || "Daily"
  };
}

// ── VERIFY LOGIN ─────────────────────────────────────────────
function verifyLogin(phone, pin) {
  if (!phone || !pin) return {success: false, error: "Missing Phone or PIN."};
  const ss = getSpreadsheet();
  const ws = getOrCreateTab(ss, TAB_CUSTOMERS, CUSTOMERS_HEADERS);
  const rows = getAllRows(ws);
  const pStr = _normalizePhone(phone);
  let r = rows.find(x => _normalizePhone(x.Phone) === pStr);

  if (!r) {
    // Archived returning customer: verify against the archived PIN and, if it
    // matches, restore the FULL record (PIN + address) into SK_Customers so they
    // log in normally — no PIN reset, address pre-filled. (Cold path only.)
    if (typeof _findArchivedCustomer === "function") {
      const arc = _findArchivedCustomer(pStr);
      if (arc && arc.pin !== "") {
        if (arc.pin !== String(pin).trim()) return { success: false, error: "Incorrect PIN." };
        _restoreArchivedCustomer(arc);
        r = getAllRows(getOrCreateTab(ss, TAB_CUSTOMERS, CUSTOMERS_HEADERS))
              .find(x => _normalizePhone(x.Phone) === pStr);
      }
    }
    if (!r) return {success: false, error: "Account not found."};
  }
  if (String(r.PIN).trim() !== String(pin).trim()) return {success: false, error: "Incorrect PIN."};
  
  let pendingAmount = 0;
  const isOnAccount = String(_get(r, "On_Account") || "").trim().toLowerCase() === "yes";
  
  if (isOnAccount) {
    const wsOrders = getOrCreateTab(ss, TAB_ORDERS, ORDERS_HEADERS);
    const orderRows = getAllRows(wsOrders);
    for (const ord of orderRows) {
      if (_normalizePhone(_get(ord, "Phone")) === pStr) {
        const ps = String(_get(ord, "Payment_Status") || "").trim().toLowerCase();
        if (ps === "on account" || ps === "onaccount" || ps === "pending" || ps === "") {
          pendingAmount += _cleanNum(_get(ord, "Net_Total"));
        }
      }
    }
  }

  return {
    success: true,
    profile: {
      name:               r.Customer_Name || "",
      area:               r.Area || "",
      wing:               r.Wing || "",
      flat:               r.Flat || "",
      floor:              r.Floor || "",
      society:            r.Society || "",
      maps:               r.Maps_Link || "",
      landmark:           r.Landmark || "",
      payment_preference: r.Payment_Freq || "Daily Payment",
      meal_addresses:     r.Meal_Addresses || "",
      promoCount: (function(v){
        if (v === "" || v === null || v === undefined) return null;
        var num = Number(v);
        return isNaN(num) ? v : num;
      })(r.Review_Promo_Count),
      wallet_balance:     _calculateWalletBalance(phone),
      feeExempt:          (r.Fee_Exempt === "Yes" || r.Fee_Exempt === true),
      onAccount:          r.On_Account || "No",
      billingCycle:       r.Billing_Cycle || "Daily",
      pending_amount:     pendingAmount
    }
  };
}

// ── AUTO-SETTLE PENDING ORDERS ──────────────────────────────
function _autoSettlePendingOrders(phone) {
  const pStr = _normalizePhone(phone);
  
  const ss = getSpreadsheet();
  const profWs = getOrCreateTab(ss, TAB_CUSTOMERS, CUSTOMERS_HEADERS);
  const profRows = getAllRows(profWs);
  const profile = profRows.find(r => _normalizePhone(r.Phone) === pStr);
  
  // Rule 1: Only for On Account users
  if (!profile || (String(profile.On_Account).trim().toLowerCase() !== "yes")) {
    return { settled: 0, msg: "" };
  }

  const wsOrders = getOrCreateTab(ss, TAB_ORDERS, ORDERS_HEADERS);
  const rows = getAllRows(wsOrders);
  const hIdx = headerIndex(wsOrders);

  // Rule 2: Only target "on account" orders (ignore normal Pending/UPI)
  const pendingOrders = rows.filter(r => {
    if (_normalizePhone(_get(r, "Phone")) !== pStr) return false;
    const ps = String(_get(r, "Payment_Status") || "").trim().toLowerCase();
    if (ps !== "on account" && ps !== "onaccount") return false;
    return _cleanNum(_get(r, "Net_Total")) > 0;
  });

  if (pendingOrders.length === 0) return { settled: 0, msg: "" };

  pendingOrders.sort((a, b) => String(_get(a, "Order_Date")).localeCompare(String(_get(b, "Order_Date"))));

  let walletBalance = _calculateWalletBalance(phone);
  if (walletBalance <= 0) return { settled: 0, msg: "" };

  let totalSettled = 0;
  let ordersSettledCount = 0;
  let originalPendingAmount = pendingOrders.reduce((sum, o) => sum + _cleanNum(_get(o, "Net_Total")), 0);
  
  let currentWallet = walletBalance;

  for (let order of pendingOrders) {
    let amount = _cleanNum(_get(order, "Net_Total"));
    if (currentWallet >= amount) {
      wsOrders.getRange(order._row, hIdx["Payment_Status"]).setValue("Paid");
      _appendWalletTransaction(phone, _get(order, "Customer_Name") || "Customer", "Auto-deducted for On Account order " + (_get(order, "Submission_ID") || _get(order, "Order_Date")), amount, true, "AUTO-" + Date.now() + "-" + Math.floor(Math.random()*1000));
      currentWallet -= amount;
      totalSettled += amount;
      ordersSettledCount++;
    } else {
      break;
    }
  }

  if (ordersSettledCount > 0) {
    if (originalPendingAmount <= walletBalance) {
      return { 
        settled: totalSettled, 
        msg: `Wallet recharge used against the pending orders. Balance is now: Wallet ₹${currentWallet}` 
      };
    } else {
      // Wallet < Pending overall
      return { 
        settled: totalSettled, 
        msg: `Wallet recharge applied! Note: ₹${originalPendingAmount - totalSettled} is still pending on account.` 
      };
    }
  }

  // If we couldn't settle even one full order but they have wallet balance
  if (originalPendingAmount > 0 && walletBalance > 0 && walletBalance < originalPendingAmount) {
    return {
      settled: 0,
      msg: `Recharge added to wallet (₹${walletBalance}). You still have ₹${originalPendingAmount} pending on account.`
    };
  }

  return { settled: 0, msg: "" };
}

// ── WALLET HELPER ──────────────────────────────────────────
function _calculateWalletBalance(phone, preloadedRows) {
  if (!phone) return 0;
  const ss = getSpreadsheet();
  const ws = getOrCreateTab(ss, TAB_WALLET, WALLET_HEADERS);
  const rows = Array.isArray(preloadedRows) ? preloadedRows : getAllRows(ws);

  let balance = 0;
  const pStr = _normalizePhone(phone);

  rows.forEach(w => {
    const rPhone = _normalizePhone(w.Phone);
    if (rPhone !== pStr) return;

    // Only count verified transactions
    const rVer = String(w.Verified || "").trim().toUpperCase();
    if (rVer !== "TRUE" && rVer !== "YES" && rVer !== "VERIFIED") return;

    const rAmt = _cleanNum(_get(w, "Amount"));
    // Also check legacy columns where Txn_Type may have been stored in a "Balance" column
    const rType = String(_get(w, "Txn_Type") || _get(w, "Balance") || "").trim().toLowerCase();

    if (rType.includes("recharge") || rType.includes("refund") || rType.includes("credit")
        || rType.includes("carry forward") || rType.includes("carry-forward")) {
      balance += rAmt;
    } else if (rType.includes("order") || rType.includes("deduct") || rType.includes("payment")) {
      balance -= rAmt;
    }
  });

  return Math.round(balance * 100) / 100;
}

/**
 * Returns last 10 wallet transactions for a customer, newest first.
 * Each entry: { type, amount, direction, verified, reference, timestamp, balance_after }
 */
function getWalletTransactions(phone) {
  if (!phone) return { transactions: [] };
  const ss   = getSpreadsheet();
  const ws   = getOrCreateTab(ss, TAB_WALLET, WALLET_HEADERS);
  const rows = getAllRows(ws);
  const pStr = _normalizePhone(phone);

  // Filter to this customer's rows only, parse timestamps for sorting
  const mine = rows
    .filter(w => _normalizePhone(w.Phone) === pStr)
    .map(w => {
      const rType = String(w.Txn_Type || "").trim();
      const rAmt  = Number(w.Amount) || 0;
      const rVer  = String(w.Verified || "").trim().toUpperCase();
      const verified = (rVer === "TRUE" || rVer === "YES" || rVer === "VERIFIED");
      const typeLow  = rType.toLowerCase();
      const isCredit = typeLow.includes("recharge") || typeLow.includes("refund")
                    || typeLow.includes("credit") || typeLow.includes("carry forward")
                    || typeLow.includes("carry-forward");
      const rawTs  = w.Timestamp;
      const tsDate = rawTs instanceof Date ? rawTs : new Date(rawTs || 0);
      return {
        type:      rType || "Transaction",
        amount:    rAmt,
        direction: isCredit ? "credit" : "debit",
        verified,
        reference: String(w.Reference_ID || "").trim(),
        timestamp: rawTs instanceof Date
          ? Utilities.formatDate(rawTs, "Asia/Kolkata", "dd MMM yyyy, h:mm a")
          : String(rawTs || "").trim(),
        _ts: tsDate.getTime()
      };
    });

  // Sort newest first, take last 10
  mine.sort((a, b) => b._ts - a._ts);
  const top10 = mine.slice(0, 10).map(t => { delete t._ts; return t; });

  return { transactions: top10 };
}

// ── GET MENU ─────────────────────────────────────────────────
// Base-normalize a society/building name (lowercase + drop all non-alphanumerics)
// so "Pentagon 1" / "pentagon-1" / "Pentagon1" all match.
function _normSocietyBase(s) {
  return String(s == null ? "" : s).toLowerCase().replace(/[^a-z0-9]/g, "");
}

// SOCIETY ALIAS MAP — admin-managed SK_Society_Aliases tab (Alias | Canonical).
// Two kinds of rows:
//   1. EXACT:    "Jasminium society" → "Jasminium"  (whole name is this spelling)
//   2. CONTAINS: "*gold tower"       → "Gold Tower" (name CONTAINS this anywhere —
//      catches "T43 2502 Gold Tower", "Amanora gold tower", any future flat/tower
//      prefix; Amanora-township style entries make enumeration impossible).
// Both sides are base-normalized, so spacing/case/punctuation never matter — only
// real word differences need rows. Exact rows win over contains rows; contains
// rows apply in sheet order (put more specific needles first). Cached 5 min
// (CacheService) + per-execution memo, so the hot per-row loops in
// _activeDeliveryIndex never re-read the sheet. Run setupSocietyAliasTab() once
// from the editor to create the tab.
var _socAliasMemo = null;
function _societyAliasMap() {
  if (_socAliasMemo) return _socAliasMemo;
  try {
    const hit = CacheService.getScriptCache().get("society_aliases_v2");
    if (hit !== null) { _socAliasMemo = JSON.parse(hit); return _socAliasMemo; }
  } catch (_) {}
  const exact = {};
  const contains = []; // [needle, canonical] in sheet order
  try {
    const ws = getSpreadsheet().getSheetByName("SK_Society_Aliases");
    if (ws && ws.getLastRow() > 1) {
      ws.getRange(2, 1, ws.getLastRow() - 1, 2).getValues().forEach(function (r) {
        const rawAlias = String(r[0] == null ? "" : r[0]).trim();
        const canon = _normSocietyBase(r[1]);
        if (!rawAlias || !canon) return;
        if (rawAlias.charAt(0) === "*") {
          const needle = _normSocietyBase(rawAlias.slice(1));
          if (needle) contains.push([needle, canon]);
        } else {
          const alias = _normSocietyBase(rawAlias);
          if (alias && alias !== canon) exact[alias] = canon;
        }
      });
    }
  } catch (_) {}
  _socAliasMemo = { exact: exact, contains: contains };
  try { CacheService.getScriptCache().put("society_aliases_v2", JSON.stringify(_socAliasMemo), 300); } catch (_) {}
  return _socAliasMemo;
}

// One-time (editor): create the alias tab with headers + example rows.
function setupSocietyAliasTab() {
  const ss = getSpreadsheet();
  let ws = ss.getSheetByName("SK_Society_Aliases");
  if (!ws) {
    ws = ss.insertSheet("SK_Society_Aliases");
    ws.getRange(1, 1, 1, 2).setValues([["Alias", "Canonical"]]);
    ws.getRange(2, 1, 2, 2).setValues([
      ["Jasminium society", "Jasminium"],   // exact: this whole spelling → canonical
      ["*gold tower", "Gold Tower"]         // contains: any name containing "gold tower"
    ]);
  }
  try { CacheService.getScriptCache().remove("society_aliases_v2"); } catch (_) {}
  return "SK_Society_Aliases ready. Exact rows: 'Alias → Canonical'. Contains rows: start the alias with * (e.g. '*gold tower' matches 'T43 2502 Gold Tower Amanora'). Changes go live within ~5 min.";
}

// Canonical matching key: base-normalize, then exact-alias, then contains-rules.
// "T43 2502 Gold Tower" → "t432502goldtower" → (contains '*gold tower') → "goldtower".
function _normSocietyKey(s) {
  const base = _normSocietyBase(s);
  if (!base) return "";
  const m = _societyAliasMap();
  if (m.exact && m.exact[base]) return m.exact[base];
  const rules = m.contains || [];
  for (var i = 0; i < rules.length; i++) {
    if (base.indexOf(rules[i][0]) !== -1) return rules[i][1];
  }
  return base;
}

// AUDIT (editor or ?action=listSocieties): every distinct society/building spelling
// seen in SK_Orders + SK_Customers, grouped by base-normalized key so variants that
// differ only in case/spacing/punctuation cluster together. Spelling variants that
// DON'T cluster (e.g. "Jasminium" vs "Jasminum") appear as separate groups — those
// are the ones needing an SK_Society_Aliases row. Sorted by usage.
function listDistinctSocieties() {
  const ss = getSpreadsheet();
  const variants = {}; // baseKey → { spelling → {orders, customers} }
  const bump = function (name, field) {
    const raw = String(name || "").trim().replace(/\s+/g, " ");
    if (!raw) return;
    const key = _normSocietyBase(raw);
    if (!key) return;
    if (!variants[key]) variants[key] = {};
    if (!variants[key][raw]) variants[key][raw] = { orders: 0, customers: 0 };
    variants[key][raw][field]++;
  };
  try { getAllRows(getOrCreateTab(ss, TAB_ORDERS, ORDERS_HEADERS)).forEach(function (r) {
    if (_isOrderCancelled(r.Payment_Status)) return;
    bump(r.Society, "orders");
  }); } catch (_) {}
  try { getAllRows(getOrCreateTab(ss, TAB_CUSTOMERS, CUSTOMERS_HEADERS)).forEach(function (r) {
    bump(r.Society, "customers");
  }); } catch (_) {}

  const aliasMap = _societyAliasMap();
  const groups = Object.keys(variants).map(function (key) {
    const names = Object.keys(variants[key]).map(function (nm) {
      return { name: nm, orders: variants[key][nm].orders, customers: variants[key][nm].customers };
    }).sort(function (a, b) { return (b.orders + b.customers) - (a.orders + a.customers); });
    const tot = names.reduce(function (s, x) { return s + x.orders + x.customers; }, 0);
    return { key: key, aliasedTo: aliasMap[key] || "", totalUses: tot, spellings: names };
  }).sort(function (a, b) { return b.totalUses - a.totalUses; });
  return { groups: groups, count: groups.length };
}
// For one date, per meal, the sets of normalized societies AND normalized phones
// we ALREADY have an active DELIVERY order for. Lets a customer through the
// delivery cap when (a) we're already delivering to their society, or (b) THEY
// already have a delivery order for that meal (adding more = the same stop).
function _activeDeliveryIndex(rows, dateStr) {
  const out = { Breakfast: { soc: {}, ph: {} }, Lunch: { soc: {}, ph: {} }, Dinner: { soc: {}, ph: {} } };
  for (var i = 0; i < rows.length; i++) {
    const r = rows[i];
    const d = r.Order_Date instanceof Date
      ? Utilities.formatDate(r.Order_Date, "Asia/Kolkata", "yyyy-MM-dd")
      : String(r.Order_Date || "").trim();
    if (d !== dateStr) continue;
    if (_isOrderCancelled(r.Payment_Status)) continue;
    const ar = String(r.Area || "").toLowerCase();
    if (ar.indexOf("pickup") !== -1 || ar === "porter") continue; // delivery only
    const mt = String(r.Meal_Type || "").trim();
    if (!out[mt]) continue;
    const soc = _normSocietyKey(r.Society);
    if (soc) out[mt].soc[soc] = true;
    const ph = _normalizePhone(r.Phone);
    if (ph) out[mt].ph[ph] = true;
  }
  return out;
}
// Customer-facing lookup: for each {date, meal, society} (+ body.phone), is there
// already an active delivery to that society OR an existing delivery by this same
// customer? The order page calls this when a delivery cap is reached — if
// reachable, the order proceeds as a normal delivery; otherwise it offers Self
// Pickup / Porter. submitOrder re-checks authoritatively.
function checkDeliveryReachable(body) {
  const items = (body && body.items) || [];
  if (!Array.isArray(items) || !items.length) return { results: [] };
  const phone = _normalizePhone((body && body.phone) || "");
  const ss = getSpreadsheet();
  const ws = getOrCreateTab(ss, TAB_ORDERS, []);
  const rows = getRecentRows(ws, 2000);
  const byDate = {};
  const results = items.map(function(it) {
    const date = String(it.date || "").trim();
    const meal = String(it.meal || "").trim();
    const soc  = _normSocietyKey(it.society || "");
    if (!byDate[date]) byDate[date] = _activeDeliveryIndex(rows, date);
    const idx = byDate[date][meal] || { soc: {}, ph: {} };
    const reachable = !!((soc && idx.soc[soc]) || (phone && idx.ph[phone]));
    return { date: date, meal: meal, reachable: reachable };
  });
  return { results: results };
}
// Count ACTIVE (non-cancelled) orders per meal type for one date, from a rows
// array. One order row = one order. Cancelled rows free their slot. Shared by
// getMenu (display) and the submitOrder cap guard (authoritative).
function _countActiveMealOrders(rows, dateStr) {
  const c = { Breakfast: 0, Lunch: 0, Dinner: 0 };
  // Bulk/internal channels collapse to ONE delivery slot each, no matter how many
  // orders they place: customers named "Enkin", and IntentAmplify ("[IA] …")
  // orders. They also BYPASS the cap when full (Enkin in submitOrder's guard; IA
  // via its own ia_submitOrder flow, which never checks the cap). Only relevant
  // once the cap is hit — until then everyone is counted 1:1 anyway.
  const sawEnkin = { Breakfast: false, Lunch: false, Dinner: false };
  const sawIA    = { Breakfast: false, Lunch: false, Dinner: false };
  // "Enkin" ANYWHERE in the name (per spec: "Enkin Kumar", "Enkin 2" etc. all belong
  // to the one Enkin batch-delivery group). Must match submitOrder's guard + order.html.
  const _isEnkin = function (nm) { return String(nm || "").toLowerCase().indexOf("enkin") !== -1; };
  const _isIA    = function (nm) { return String(nm || "").trim().toLowerCase().indexOf("[ia]") === 0; };
  for (var i = 0; i < rows.length; i++) {
    const r = rows[i];
    const d = r.Order_Date instanceof Date
      ? Utilities.formatDate(r.Order_Date, "Asia/Kolkata", "yyyy-MM-dd")
      : String(r.Order_Date || "").trim();
    if (d !== dateStr) continue;
    if (_isOrderCancelled(r.Payment_Status)) continue;
    // The cap is a DELIVERY limit — Self Pickup / Porter orders don't use a
    // delivery slot, so they neither count toward the cap nor get blocked by it.
    const ar = String(r.Area || "").toLowerCase();
    if (ar.indexOf("pickup") !== -1 || ar === "porter") continue;
    const mt = String(r.Meal_Type || "").trim();
    if (c[mt] === undefined) continue;
    if (_isEnkin(r.Customer_Name)) { sawEnkin[mt] = true; continue; } // counted once below
    if (_isIA(r.Customer_Name))    { sawIA[mt]    = true; continue; } // counted once below
    c[mt]++;
  }
  // IntentAmplify orders live in a separate IA_ tab (not in `rows`) — fold their
  // presence in as ONE slot per meal too (one corporate delivery, not n).
  try {
    if (typeof ia_rowsAsSK === "function") {
      ia_rowsAsSK().forEach(function (r) {
        const d = r.Order_Date instanceof Date
          ? Utilities.formatDate(r.Order_Date, "Asia/Kolkata", "yyyy-MM-dd")
          : String(r.Order_Date || "").trim();
        if (d !== dateStr) return;
        if (_isOrderCancelled(r.Payment_Status)) return;
        const mt = String(r.Meal_Type || "").trim();
        if (sawIA[mt] !== undefined) sawIA[mt] = true;
      });
    }
  } catch (e) {}
  ["Breakfast", "Lunch", "Dinner"].forEach(function (m) {
    if (sawEnkin[m]) c[m]++;
    if (sawIA[m])    c[m]++;
  });
  return c;
}
// Public rate card (no login). Breakfast prices come from the SK_Master_Breakfast
// sheet (the single source of truth); the frontend renders the meal items from its
// own FIXED_MEAL_ITEMS table (the exact values the cart charges), so it just needs
// pricing_v2 here. Lets new users see prices BEFORE registering.
function getRateCard() {
  const ss = getSpreadsheet();
  const bfWs = getOrCreateTab(ss, TAB_BF_MASTER, ["ID", "Name", "Price", "Active"]);
  // List ALL master breakfast items (active AND inactive/seasonal) so the public
  // rate card shows the full range — not just what's featured today.
  const breakfast = getAllRows(bfWs)
    .map(function (x) { return { name: String(x.Name).trim(), price: Number(x.Price) || 0 }; })
    .filter(function (x) { return x.name && x.price > 0; });
  return { breakfast: breakfast, pricing_v2: PRICING_V2 };
}

function getMenu(dateStr) {
  // Cache per-date for 60 s. The hard stock-block in submitOrder (under LockService)
  // prevents actual over-orders even when menu data is slightly stale.
  return _cachedData("menu_v2_" + dateStr, 60, function() { return _getMenuUncached(dateStr); });
}

function getMenuBatch(datesStr) {
  const dates = String(datesStr || "").split(',').map(d => d.trim()).filter(Boolean);
  const result = {};
  dates.forEach(d => {
    // Rely on the existing cached helper so we don't duplicate logic
    result[d] = getMenu(d);
  });
  return result;
}

// For the REORDER flow: given a comma-separated list of breakfast item names,
// returns whether the calendar should be restricted and to which dates.
//  - Everyday items (master Active, e.g. Poha/Upma) impose NO restriction.
//  - Special items (e.g. Aloo Paratha) restrict to upcoming dates whose daily
//    Breakfast_JSON includes them (intersection if several specials).
// Returns { restrict: bool, dates: ["yyyy-MM-dd", ...] }.
function getBreakfastItemDates(itemsStr) {
  const items = String(itemsStr || "").split(',').map(s => s.trim()).filter(Boolean);
  if (!items.length) return { restrict: false, dates: [] };
  const _norm = function(n){ return String(n||"").toLowerCase().replace(/\[[^\]]*\]/g,"").replace(/\([^)]*\)/g,"").replace(/\s+/g," ").trim(); };
  const ss = getSpreadsheet();

  // Everyday (master-Active) breakfast item names — these are on EVERY day.
  const bfWs = getOrCreateTab(ss, TAB_BF_MASTER, []);
  const activeSet = new Set(getAllRows(bfWs).filter(function(x){ return String(x.Active).toLowerCase() !== "false"; }).map(function(x){ return _norm(x.Name); }));

  const specials = items.map(_norm).filter(function(n){ return n && !activeSet.has(n); });
  if (!specials.length) return { restrict: false, dates: [] }; // all everyday → no restriction

  const today = Utilities.formatDate(new Date(), "Asia/Kolkata", "yyyy-MM-dd");
  const menuWs = getOrCreateTab(ss, TAB_MENU, []);
  const datesByItem = {};
  specials.forEach(function(s){ datesByItem[s] = {}; });
  getAllRows(menuWs).forEach(function(r){
    const d = r.Date instanceof Date ? Utilities.formatDate(r.Date, "Asia/Kolkata", "yyyy-MM-dd") : String(r.Date||"").trim();
    if (!d || d < today || !r.Breakfast_JSON) return;
    let parsed; try { parsed = JSON.parse(r.Breakfast_JSON); } catch(e) { return; }
    if (!Array.isArray(parsed)) return;
    const namesOnDay = {};
    parsed.forEach(function(x){ namesOnDay[_norm(x && x.name)] = true; });
    specials.forEach(function(s){ if (namesOnDay[s]) datesByItem[s][d] = true; });
  });

  // allowed = intersection of every special item's date set
  let allowed = null;
  specials.forEach(function(s){
    const ks = Object.keys(datesByItem[s]);
    if (allowed === null) allowed = ks;
    else allowed = allowed.filter(function(x){ return datesByItem[s][x]; });
  });
  return { restrict: true, dates: (allowed || []).sort() };
}

function _getMenuUncached(dateStr) {
  const ss = getSpreadsheet();
  const ws = getOrCreateTab(ss, TAB_MENU, []);
  const rows = getAllRows(ws);
  const r = rows.find(x => {
    const d = x.Date instanceof Date
      ? Utilities.formatDate(x.Date, "Asia/Kolkata", "yyyy-MM-dd")
      : String(x.Date).trim();
    return d === dateStr;
  });

  // Admin can mark a specific (non-Sunday) day as Kitchen Closed via the
  // Daily Menu tab. When set, customer calendar greys out the day and any
  // submitOrder attempt for it is rejected server-side.
  const _kitchenClosed = !!(r && (r.Kitchen_Closed === true ||
    String(r.Kitchen_Closed || "").toLowerCase() === "true"));

  // Breakfast master items
  const bfWs = getOrCreateTab(ss, TAB_BF_MASTER, []);
  const bfRows = getAllRows(bfWs).filter(x => String(x.Active).toLowerCase() !== "false");
  
  const NAME_MAP = {
    "Kanda Poha": "Kanda Poha [175g]",
    "Ghee Upma": "Ghee Upma [200g]",
    "Sabudana Khichdi": "Sabudana Khichdi [200g]",
    "Tikhi Pudi": "5 x Tikhi Pudi with 100 ml coriander chutney",
    "Tikhi Puri": "5 x Tikhi Pudi with 100 ml coriander chutney",
    "Idli Chutney": "4 x Idli & 100ml Chutney",
    "Idli": "4 x Idli & 100ml Chutney",
    "4 x Idli & 100ml Chutney": "4 x Idli & 100ml Chutney",
    "Ghee Sheera": "Ghee Sheera [200g]"
  };

  const breakfast = bfRows.map(x => {
    const rawName = String(x.Name).trim();
    return {
      name: NAME_MAP[rawName] || rawName,
      price: Number(x.Price)
    };
  });

  // Determine if this date is a Sunday with no sabjis set.
  // Kitchen is closed on Sundays by default; admin can override by setting at least one sabji.
  const _dayName   = Utilities.formatDate(new Date(dateStr + "T12:00:00+05:30"), "Asia/Kolkata", "EEEE");
  const _isSunday  = _dayName === "Sunday";
  const _hasSabjis = r && (r.Lunch_Dry || r.Lunch_Curry || r.Dinner_Dry || r.Dinner_Curry);

  if (!r) {
    // No menu row at all — if Sunday, close everything; otherwise return open empty menu.
    return {
      breakfast, lunch_dry:"", lunch_curry:"", dinner_dry:"", dinner_curry:"",
      cutoff_overrides:{},
      oos_items: { Breakfast: [], Lunch: [], Dinner: [] },
      orders_closed: _isSunday ? { Breakfast: true, Lunch: true, Dinner: true } : {},
      stock_limits: {},
      units_remaining: {},
      sunday_closed: _isSunday
    };
  }

  // Menu row exists but it's a Sunday with no sabjis — still treat as closed.
  if (_isSunday && !_hasSabjis) {
    let ordersClosed2 = { Breakfast: true, Lunch: true, Dinner: true };
    return {
      breakfast, lunch_dry:"", lunch_curry:"", dinner_dry:"", dinner_curry:"",
      cutoff_overrides:{},
      oos_items: { Breakfast: [], Lunch: [], Dinner: [] },
      orders_closed: ordersClosed2,
      stock_limits: {},
      units_remaining: {},
      sunday_closed: true
    };
  }

  const co = {};
  if (r && r.Cutoff_Breakfast) co.Breakfast = Number(r.Cutoff_Breakfast);
  if (r && r.Cutoff_Lunch)     co.Lunch     = Number(r.Cutoff_Lunch);
  if (r && r.Cutoff_Dinner)    co.Dinner    = Number(r.Cutoff_Dinner);

  // SINGLE SOURCE OF TRUTH for breakfast prices: the SK_Master_Breakfast sheet.
  // The daily menu (Breakfast_JSON) only decides WHICH items are available that day;
  // every price is pulled from the master by name — so updating a price in the master
  // updates it everywhere (menu, cart, and the gateway's authoritative recompute),
  // even for items featured in a day's JSON. Map built from ALL master rows (active
  // AND inactive — inactive = rotated specials like Aloo Paratha).
  const _masterPriceByName = {};
  getAllRows(bfWs).forEach(function (x) {
    const _nm = NAME_MAP[String(x.Name).trim()] || String(x.Name).trim();
    _masterPriceByName[_nm] = Number(x.Price) || 0;
  });

  // MERGE LOGIC: Start with master active items, then merge daily overrides
  const masterActive = breakfast;
  let dailyBf = [];
  if (r && r.Breakfast_JSON) {
    try {
      const parsed = JSON.parse(r.Breakfast_JSON);
      dailyBf = parsed.map(d => {
        const _nm = d.name ? (NAME_MAP[d.name.trim()] || d.name) : "";
        // Price ALWAYS from the master; fall back to the JSON's own price only if the
        // item isn't in the master at all (a genuine one-off not yet added there).
        const _mp = _masterPriceByName[_nm];
        return Object.assign({}, d, { name: _nm, price: (_mp !== undefined ? _mp : (Number(d.price) || 0)) });
      });
    } catch(e) {}
  }

  // Ensure Master Active items are always present (prices already from the master).
  const finalBreakfast = [...dailyBf];
  masterActive.forEach(m => {
    if (!finalBreakfast.some(d => d.name === m.name)) {
      finalBreakfast.push(m);
    }
  });

  let oosItems = { Breakfast: [], Lunch: [], Dinner: [] };
  try { if (r && r.OOS_JSON) oosItems = JSON.parse(r.OOS_JSON); } catch(e) {}

  let ordersClosed = {};
  try { if (r && r.Orders_Closed) ordersClosed = JSON.parse(r.Orders_Closed); } catch(e) {}

  let stockLimits = {};
  try { if (r && r.Stock_JSON) stockLimits = JSON.parse(r.Stock_JSON); } catch(e) {}

  // Per-meal max-order caps (e.g. {"Breakfast":50}). When a meal's active
  // (non-cancelled) order count reaches its cap it is SOLD OUT for the day.
  let orderCaps = {};
  try { if (r && r.Order_Cap_JSON) orderCaps = JSON.parse(r.Order_Cap_JSON); } catch(e) {}
  // Per-meal flag: offer Self Pickup / Porter when delivery is full? Default ON
  // (missing/true). false = hard sold-out (no alternatives offered).
  let capAlt = {};
  try { if (r && r.Cap_Alt_JSON) capAlt = JSON.parse(r.Cap_Alt_JSON); } catch(e) {}

  const ordersWs2   = getOrCreateTab(ss, TAB_ORDERS, []);
  // OPTIMIZATION: Only read the last 500 rows to compute stock limit (covers today and yesterday).
  // This prevents scanning thousands of old orders just to check today's stock.
  const ordersRows2 = getRecentRows(ordersWs2, 500);
  const orderedCounts = countOrderedUnits(ordersRows2, dateStr);
  const unitsRemaining = {};
  ["Breakfast","Lunch","Dinner"].forEach(meal => {
    Object.entries(stockLimits[meal] || {}).forEach(([colKey, limit]) => {
      if (!unitsRemaining[meal]) unitsRemaining[meal] = {};
      unitsRemaining[meal][colKey] = Math.max(0, limit - (orderedCounts[meal][itemsJsonKey(colKey)] || 0));
    });
  });

  // Cap evaluation — reuse the rows already read above (zero extra cost). The
  // cap is a DELIVERY limit: when reached we flag the meal sold_out so the order
  // page offers Self Pickup / Porter (which bypass the cap). We do NOT set
  // orders_closed — that path stays open. submitOrder is the authoritative guard:
  // it rejects DELIVERY orders past the cap (full-sheet count, under lock) while
  // letting Self Pickup / Porter through.
  const orderCounts = _countActiveMealOrders(ordersRows2, dateStr);
  const soldOut = {};
  ["Breakfast","Lunch","Dinner"].forEach(meal => {
    const cap = Number(orderCaps[meal] || 0);
    if (cap > 0 && (orderCounts[meal] || 0) >= cap) {
      soldOut[meal] = true;
      // Alternatives OFF → hard sold-out: close the meal entirely (no pickup/porter).
      if (capAlt[meal] === false) ordersClosed[meal] = true;
    }
  });

  return {
    breakfast:    finalBreakfast,
    lunch_dry:    r ? (r.Lunch_Dry || "") : "",
    lunch_curry:  r ? (r.Lunch_Curry || "") : "",
    dinner_dry:   r ? (r.Dinner_Dry || "") : "",
    dinner_curry: r ? (r.Dinner_Curry || "") : "",
    cutoff_overrides: co,
    oos_items:    oosItems,
    orders_closed: ordersClosed,
    stock_limits: stockLimits,
    units_remaining: unitsRemaining,
    order_caps:    orderCaps,    // admin display: configured per-meal max
    cap_alt:       capAlt,       // admin display: per-meal "offer pickup/porter" flags
    order_counts:  orderCounts,  // admin display: active orders placed so far
    sold_out:      soldOut,      // customer display: meal hit its cap today
    kitchen_closed: _kitchenClosed
  };
}

// ── KITCHEN CLOSURE: list of admin-closed (non-Sunday) dates ─────
// Lightweight endpoint used by the customer calendar to grey out
// closed days without having to fetch every date's full menu.
function getKitchenClosedDates() {
  return _cachedData("kitchen_closed_dates_v1", 60, function() {
    const ss   = getSpreadsheet();
    const ws   = getOrCreateTab(ss, TAB_MENU, []);
    const rows = getAllRows(ws);
    const today = getISTDate();
    // Include the recent past (40 days) too — the loyalty streak looks backward
    // and must skip admin days-off so they don't break a customer's streak.
    const cutoff = Utilities.formatDate(new Date(Date.now() - 40 * 86400000), "Asia/Kolkata", "yyyy-MM-dd");
    const closed = [];
    rows.forEach(function(r) {
      const isClosed = (r.Kitchen_Closed === true ||
        String(r.Kitchen_Closed || "").toLowerCase() === "true");
      if (!isClosed) return;
      const d = r.Date instanceof Date
        ? Utilities.formatDate(r.Date, "Asia/Kolkata", "yyyy-MM-dd")
        : String(r.Date).trim();
      if (!d || d < cutoff) return;            // recent past + future
      closed.push(d);
    });
    closed.sort();
    return { closedDates: closed };
  });
}

// ── GET WEEKLY MENU (next 7 days) ────────────────────────────
function getWeeklyMenu() {
  const ss = getSpreadsheet();
  const ws = getOrCreateTab(ss, TAB_MENU, []);
  const rows = getAllRows(ws);

  // Breakfast master items
  const bfWs = getOrCreateTab(ss, TAB_BF_MASTER, []);
  const bfRows = getAllRows(bfWs).filter(x => String(x.Active).toLowerCase() !== "false");
  const defaultBreakfast = bfRows.map(x => ({name: String(x.Name), price: Number(x.Price)}));

  // Build a map: dateStr → row for quick lookup
  const menuMap = {};
  rows.forEach(x => {
    const d = x.Date instanceof Date
      ? Utilities.formatDate(x.Date, "Asia/Kolkata", "yyyy-MM-dd")
      : String(x.Date).trim();
    menuMap[d] = x;
  });

  // Show all dates from today onwards that have a menu row set
  const today = getISTDate();
  const todayStr = Utilities.formatDate(today, "Asia/Kolkata", "yyyy-MM-dd");

  // Collect all future/today dates that have a menu row, sorted ascending
  const futureDates = Object.keys(menuMap)
    .filter(d => d >= todayStr)
    .sort();

  const days = [];
  futureDates.forEach(dateStr => {
    const d = new Date(dateStr + "T00:00:00+05:30");
    const dayName    = Utilities.formatDate(d, "Asia/Kolkata", "EEEE");
    const displayDate = Utilities.formatDate(d, "Asia/Kolkata", "dd MMM");

    const r = menuMap[dateStr];

    // Skip Sundays that have no sabjis set — kitchen is closed by default on Sundays.
    // A Sunday only appears in the weekly menu popup if the admin has explicitly
    // set at least one sabji (Lunch or Dinner), signalling the kitchen is open that day.
    const isSunday = dayName === "Sunday";
    const hasSabjis = r && (r.Lunch_Dry || r.Lunch_Curry || r.Dinner_Dry || r.Dinner_Curry);
    if (isSunday && !hasSabjis) return;

    let bfDaily = [];
    try {
      if (r && r.Breakfast_JSON) bfDaily = JSON.parse(r.Breakfast_JSON);
    } catch(e) {}

    // Merge Master + Daily
    const finalBf = [...bfDaily];
    defaultBreakfast.forEach(m => {
      if (!finalBf.some(x => x.name === m.name)) finalBf.push(m);
    });

    days.push({
      date: dateStr,
      dayName: dayName,
      displayDate: displayDate,
      breakfast: finalBf,
      lunch_dry:    r ? (r.Lunch_Dry    || "") : "",
      lunch_curry:  r ? (r.Lunch_Curry  || "") : "",
      dinner_dry:   r ? (r.Dinner_Dry   || "") : "",
      dinner_curry: r ? (r.Dinner_Curry || "") : "",
      menuSet: true  // only dates with a menu row are included
    });
  });

  return { success: true, days: days };
}

// ── WALLET LOGIC ───────────────────────────────────────────────
/**
 * Append a transaction to SK_Wallet.
 * @param {string} phone      Customer phone number
 * @param {string} name       Customer name
 * @param {string} txnType    e.g. "Order Deduction", "Recharge", "Order Cancellation Refund"
 * @param {number} amount     Absolute transaction amount (always positive)
 * @param {boolean} isVerified TRUE = immediately counted in balance, FALSE = pending admin approval
 * @param {string} [refId]    Reference ID: Submission_ID for orders/refunds, or a recharge txn ref
 */
function _appendWalletTransaction(phone, name, txnType, amount, isVerified, refId) {
  // Serialize wallet writes. Apps Script LockService is re-entrant within the
  // same execution, so this also works when the caller (e.g. submitOrder) is
  // already holding the script lock.
  const lock = LockService.getScriptLock();
  try { lock.waitLock(10000); }
  catch(e) { throw new Error("Wallet busy — please retry in a few seconds."); }
  try {
    const ss = getSpreadsheet();
    const ws = getOrCreateTab(ss, TAB_WALLET, WALLET_HEADERS);
    const hIdx = headerIndex(ws);

    const totalCols = ws.getLastColumn();
    const row = new Array(totalCols).fill("");
    const set = (col, val) => { if (hIdx[col]) row[hIdx[col] - 1] = val; };

    set("Phone",         _normalizePhone(phone));
    set("Customer_Name", name);
    set("Txn_Type",      txnType);
    set("Amount",        amount);
    set("Verified",      isVerified ? "TRUE" : "FALSE");
    set("Reference_ID",  refId || "");
    set("Timestamp",     getISTTimestamp());

    ws.appendRow(row);
    SpreadsheetApp.flush();
  } finally {
    try { lock.releaseLock(); } catch(e) {}
  }
}

// ── MISSED-ORDER SAFETY NET ───────────────────────────────────
/**
 * Called immediately after appendRow for each order row.
 * Saves the order payload to Script Properties as a backup.
 * A separate cleanup pass (called at the end of submitOrder after flush)
 * verifies the row landed in the sheet; if not, it emails admin.
 *
 * This closes the 0.5% gap where GAS buffered writes silently failed.
 */
function _missedOrderSafetyNet(ss, sid, row, phone) {
  try {
    const props  = PropertiesService.getScriptProperties();
    const raw    = props.getProperty("PENDING_ORDER_ROWS") || "{}";
    const store  = JSON.parse(raw);
    // Expire entries older than 10 minutes
    const now    = Date.now();
    Object.keys(store).forEach(k => { if (now - store[k].ts > 10 * 60 * 1000) delete store[k]; });
    store[sid]   = { ts: now, phone: String(phone || ""), row: row };
    props.setProperty("PENDING_ORDER_ROWS", JSON.stringify(store));
  } catch(e) {
    console.error("_missedOrderSafetyNet save failed:", e.message);
  }
}

// Re-append a dropped order row and CONFIRM it actually landed, retrying under load.
// Google silently drops appendRow writes when the sheet is hammered by concurrent
// executions (dinner-rush: ~30 simultaneous doGet/doPost + triggers). A single
// unverified re-append is not enough — it gets dropped too. This re-reads after each
// append to confirm persistence, and checks presence BEFORE each append so a row that
// did land (this loop, or a concurrent reconciler/webhook write) never gets duplicated.
// Returns the attempt number that confirmed it present, or 0 if still missing after all.
function _reappendUntilPresent(ws, sidCol, sid, row, maxAttempts) {
  maxAttempts = maxAttempts || 5;
  const _present = function () {
    try {
      const lastRow = ws.getLastRow();
      const start = Math.max(2, lastRow - 50);
      const n = lastRow - start + 1;
      if (n <= 0) return false;
      const sids = ws.getRange(start, sidCol, n, 1).getValues();
      for (let i = 0; i < sids.length; i++) if (String(sids[i][0]) === String(sid)) return true;
      return false;
    } catch (_) { return false; }
  };
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (_present()) return attempt;                 // already there → never duplicate
    try { ws.appendRow(row); } catch (_) {}         // swallow; the re-read is the source of truth
    try { SpreadsheetApp.flush(); } catch (_) {}
    if (_present()) return attempt;                 // confirmed landed
    try { Utilities.sleep(350 * attempt); } catch (_) {} // back off so the load can ease
  }
  return _present() ? maxAttempts : 0;
}

// Durable audit log of every dropped-write detection, in its own low-contention tab.
// Email can be missed; this tab can't. Open SK_Missed_Orders and cross-check each row
// against SK_Orders: "Auto-recovered" rows SHOULD be in SK_Orders, "STILL MISSING" rows
// need manual entry.
const TAB_MISSED_ORDERS    = "SK_Missed_Orders";
const MISSED_ORDERS_HEADERS = [
  "Detected_At", "Status", "Submission_ID", "Gateway_Order_ID",
  "Customer_Name", "Phone", "Amount", "Order_Date", "Meal", "Re_append_Attempts"
];

function _logMissedOrderRow(ss, rec) {
  try {
    const ws = getOrCreateTab(ss, TAB_MISSED_ORDERS, MISSED_ORDERS_HEADERS);
    ws.appendRow([
      new Date(), rec.status || "", rec.sid || "", rec.gatewayId || "",
      rec.name || "", rec.phone || "", rec.amount || "", rec.date || "", rec.meal || "",
      (rec.attempts == null ? "" : rec.attempts)
    ]);
    SpreadsheetApp.flush();
  } catch (e) {
    console.error("_logMissedOrderRow failed for " + (rec && rec.sid) + ": " + e.message);
  }
}

// ONE-TIME: run this once from the Apps Script editor to seed the SK_Missed_Orders tab
// with the 5 orders lost in the 29-Jun rush, so you have them in one place to cross-check
// / re-enter. Safe to re-run (it just appends; dedupe by eye). Items were not recoverable.
function backfillMissed29Jun() {
  const ss = getSpreadsheet();
  const lost = [
    { gatewayId: "SK260629G9128V8MTK", name: "Shrikar Deshmukh", phone: "9561177999", amount: 77 },
    { gatewayId: "SK260629GG7VNG9EYR", name: "Shankar Dorge",    phone: "9822675531", amount: 171 },
    { gatewayId: "SK260629G7D0VVIM59", name: "Omkar Bura",       phone: "9920401403", amount: 165 },
    { gatewayId: "SK260629G322YG68HX", name: "Anamika Gupta",    phone: "9884015722", amount: 82 },
    { gatewayId: "SK260629GKCTGNNDSE", name: "Pranshu Pandey",   phone: "9755510348", amount: 173 }
  ];
  lost.forEach(function (o) {
    _logMissedOrderRow(ss, {
      status: "LOST 29-Jun (paid, items unrecoverable — enter manually)",
      sid: "", gatewayId: o.gatewayId, name: o.name, phone: o.phone,
      amount: o.amount, date: "2026-06-29", meal: "", attempts: ""
    });
  });
  return "Seeded " + lost.length + " lost orders into " + TAB_MISSED_ORDERS;
}

// Open (WITHOUT creating) a monthly webhook-archive spreadsheet, or null if none.
// Mirrors _getOrCreateMonthlyWebhookArchiveSS's naming but never creates an empty file.
function _findMonthlyWebhookArchiveSS(year, month) {
  var MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  var name = "Svaadh Kitchen Webhook Archive — " + MONTH_NAMES[month - 1] + " " + year;
  try {
    var folder = (typeof _getArchiveYearFolder === "function") ? _getArchiveYearFolder(year) : null;
    if (folder) { var it = folder.getFilesByName(name); if (it.hasNext()) return SpreadsheetApp.openById(it.next().getId()); }
    var it2 = DriveApp.getFilesByName(name); if (it2.hasNext()) return SpreadsheetApp.openById(it2.next().getId());
  } catch (e) {}
  return null;
}

// AUDIT: did a paid gateway order ever fail to land before? Run from the editor.
// Cross-references HDFC's own CHARGED record (SK_Webhook_Log — LIVE plus the monthly
// archive files, since the live log only keeps today's rows) against SK_Orders'
// Gateway_Order_ID column. Any CHARGED gateway order with NO row in SK_Orders = a
// lost/never-recorded order. Logs each new finding to SK_Missed_Orders (idempotent —
// skips ones already logged) and returns a summary you can read in the execution log.
// monthsBack (default 4) = how many prior monthly archive files to also scan; the
// gateway went live mid-June so 4 covers all history. Excludes wallet (…W…),
// on-account (…A…) and IntentAmplify (IA…) ids.
function auditLostGatewayOrders(monthsBack) {
  const ss = getSpreadsheet();
  monthsBack = (typeof monthsBack === "number" && monthsBack >= 0) ? monthsBack : 4;

  // (1) Gateway_Order_IDs that DID land in SK_Orders — read ONLY that one column (not the
  // whole ~55-col sheet) so this is cheap enough to run every 10 minutes.
  const ordWs      = getOrCreateTab(ss, TAB_ORDERS, ORDERS_HEADERS);
  const ordLastRow = ordWs.getLastRow();
  const ordHeader  = ordWs.getRange(1, 1, 1, ordWs.getLastColumn()).getValues()[0] || [];
  const gCol       = ordHeader.indexOf("Gateway_Order_ID");
  const inOrders   = new Set();
  if (gCol !== -1 && ordLastRow > 1) {
    const gVals = ordWs.getRange(2, gCol + 1, ordLastRow - 1, 1).getValues();
    for (let i = 0; i < gVals.length; i++) {
      const v = String(gVals[i][0] || "").trim();
      if (v) inOrders.add(v);
    }
  }

  // (1b) phone → registered name, from SK_Customers (the webhook payload doesn't always
  // carry the name, but the phone does, so look it up — far more reliable).
  const nameByPhone = {};
  try {
    const custWs   = getOrCreateTab(ss, TAB_CUSTOMERS, CUSTOMERS_HEADERS);
    const custData = custWs.getDataRange().getValues();
    const cH = custData[0] || [];
    const cP = cH.indexOf("Phone"), cN = cH.indexOf("Customer_Name");
    if (cP !== -1 && cN !== -1) for (let r = 1; r < custData.length; r++) {
      const ph = _normalizePhone(custData[r][cP]);
      if (ph) nameByPhone[ph] = String(custData[r][cN] || "").trim();
    }
  } catch (_) {}

  // (2) Already-logged in SK_Missed_Orders (so re-runs don't duplicate)
  const missWs   = getOrCreateTab(ss, TAB_MISSED_ORDERS, MISSED_ORDERS_HEADERS);
  const missData = missWs.getDataRange().getValues();
  const missGCol = (missData[0] || []).indexOf("Gateway_Order_ID");
  const alreadyLogged = new Set();
  if (missGCol !== -1) for (let r = 1; r < missData.length; r++) {
    const v = String(missData[r][missGCol] || "").trim();
    if (v) alreadyLogged.add(v);
  }

  // (3) Gather webhook data sources: LIVE log + each recent month's archive file.
  const sources = [];
  const liveWh = ss.getSheetByName(TAB_WEBHOOK_LOG);
  if (liveWh && liveWh.getLastRow() > 1) sources.push({ label: TAB_WEBHOOK_LOG + " (live)", data: liveWh.getDataRange().getValues() });
  const d = new Date();
  for (let mb = 0; mb <= monthsBack; mb++) {
    const dt = new Date(d.getFullYear(), d.getMonth() - mb, 1);
    const arSS = _findMonthlyWebhookArchiveSS(dt.getFullYear(), dt.getMonth() + 1);
    if (!arSS) continue;
    const sh = arSS.getSheetByName("SK_Webhook_Log");
    if (sh && sh.getLastRow() > 1) sources.push({ label: arSS.getName(), data: sh.getDataRange().getValues() });
  }

  // (4) Scan every source for CHARGED gateway orders missing from SK_Orders.
  const now  = Date.now();
  const seen = {}; // order_id -> details (dedupe multiple webhooks / sources per order)
  let totalRows = 0;
  sources.forEach(function (src) {
    const data    = src.data;
    const headers = data[0] || [];
    const evCol  = headers.indexOf("Event_Name");
    const oidCol = headers.indexOf("Order_ID");
    const payCol = headers.indexOf("Raw_Payload");
    const rcvCol = headers.indexOf("Received_At");
    if (oidCol === -1 || evCol === -1) return;
    totalRows += data.length - 1;
    for (let r = 1; r < data.length; r++) {
      if (String(data[r][evCol] || "").trim() !== "ORDER_SUCCEEDED") continue;
      const oid = String(data[r][oidCol] || "").trim();
      if (!/^SK\d{6}G/.test(oid)) continue;   // regular + bulk gateway ids only
      if (inOrders.has(oid)) continue;        // it landed — fine
      if (seen[oid]) continue;                // already captured from another row/source
      const rcv = data[r][rcvCol];
      if (rcv instanceof Date && (now - rcv.getTime()) < 5 * 60 * 1000) continue; // too fresh

      let amount = 0, name = "", phone = "", status = "";
      try {
        const p = JSON.parse(data[r][payCol] || "{}");
        const o = (p.content && p.content.order) || {};
        status = String((o.txn_detail && o.txn_detail.status) || o.status || "").toUpperCase();
        amount = Number((o.txn_detail && o.txn_detail.txn_amount) || o.amount || 0);
        phone  = String(o.customer_phone || o.udf1 || "");
        let sdk = o.payment_page_sdk_payload;
        if (typeof sdk === "string") { try { sdk = JSON.parse(sdk); } catch (_) { sdk = {}; } }
        sdk = sdk || {};
        name = ((sdk.firstName || "") + " " + (sdk.lastName || "")).trim();
      } catch (_) {}
      if (status && status !== "CHARGED") continue; // only genuinely charged
      const _regName = nameByPhone[_normalizePhone(phone)]; // prefer the registered name
      if (_regName) name = _regName;
      seen[oid] = { oid: oid, amount: amount, name: name, phone: phone, rcv: rcv, source: src.label };
    }
  });

  // (5) Report + log new findings
  const missing = Object.keys(seen).map(function (k) { return seen[k]; });
  const newRows = [];
  missing.forEach(function (m) {
    if (alreadyLogged.has(m.oid)) return;
    _logMissedOrderRow(ss, {
      status: "FOUND BY AUDIT — charged but not in SK_Orders",
      sid: "", gatewayId: m.oid, name: m.name, phone: m.phone, amount: m.amount,
      date: (m.rcv instanceof Date) ? Utilities.formatDate(m.rcv, "Asia/Kolkata", "yyyy-MM-dd") : "",
      meal: "", attempts: ""
    });
    newRows.push(m);
  });
  const newlyLogged = newRows.length;

  // Notify on NEW findings (in addition to the SK_Missed_Orders tab). MailApp scope is
  // narrow + usually granted; if not, this is caught and the tab still has everything.
  if (newlyLogged > 0) {
    try {
      const adminEmail = PropertiesService.getScriptProperties().getProperty("ADMIN_EMAIL");
      if (adminEmail) {
        const body = newlyLogged + " charged gateway order(s) are NOT in SK_Orders "
          + "(logged to the SK_Missed_Orders tab — enter manually):\n\n"
          + newRows.map(function (m) {
              return "• " + m.oid + " — " + (m.name || "?") + " / " + m.phone + " / ₹" + m.amount
                + " / " + (m.rcv instanceof Date ? Utilities.formatDate(m.rcv, "Asia/Kolkata", "yyyy-MM-dd") : "");
            }).join("\n");
        MailApp.sendEmail(adminEmail, "🚨 Svaadh: " + newlyLogged + " paid order(s) missing from SK_Orders", body);
      }
    } catch (e) { console.error("auditLostGatewayOrders email failed: " + e.message); }
  }

  const summary = {
    sourcesScanned: sources.map(function (s) { return s.label; }),
    webhookRowsScanned: totalRows,
    ordersInSheet: inOrders.size,
    chargedButMissing: missing.length,
    newlyLoggedToTab: newlyLogged,
    details: missing.map(function (m) { return m.oid + " — " + m.name + " / " + m.phone + " / ₹" + m.amount + " [" + m.source + "]"; })
  };
  Logger.log("auditLostGatewayOrders: " + JSON.stringify(summary, null, 2));
  return summary;
}

// AUTOMATIC live audit (trigger target — every 10 min). Scans ONLY the live webhook log
// (monthsBack=0 = today's orders, where fresh losses show up), and reads just the one
// SK_Orders column it needs, so it's fast and cheap to run frequently. Logs any new
// charged-but-missing order to SK_Missed_Orders + emails the admin.
function liveLostOrderAudit() {
  return auditLostGatewayOrders(0);
}

// Run ONCE from the editor to schedule the audit EVERY 10 MINUTES for near-live alerts.
// Idempotent. (everyMinutes() only allows 1/5/10/15/30.) Clears any prior audit trigger.
function setupLostOrderAuditTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    var h = t.getHandlerFunction();
    if (h === "liveLostOrderAudit" || h === "dailyLostOrderAudit") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("liveLostOrderAudit").timeBased().everyMinutes(10).create();
  return "Lost-order audit scheduled every 10 minutes.";
}

// OPTIONAL deeper daily sweep — also scans the last 2 months' archive files, to catch
// anything that aged out of the live log before a 10-min run saw it. Run
// setupDailyDeepAuditTrigger() once if you want the extra safety net.
function dailyDeepLostOrderAudit() {
  return auditLostGatewayOrders(2);
}
function setupDailyDeepAuditTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === "dailyDeepLostOrderAudit") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("dailyDeepLostOrderAudit")
    .timeBased().atHour(23).nearMinute(30).everyDays(1).inTimezone("Asia/Kolkata").create();
  return "Daily deep lost-order audit scheduled ~11:30 PM IST.";
}

// Backfill the Customer_Name column for existing SK_Missed_Orders rows that were logged
// before the name lookup existed (looks each up by Phone in SK_Customers). Run once.
function fillMissedOrderNames() {
  const ss = getSpreadsheet();
  const ws = ss.getSheetByName(TAB_MISSED_ORDERS);
  if (!ws) return "No " + TAB_MISSED_ORDERS + " tab.";
  const data = ws.getDataRange().getValues();
  const H = data[0] || [];
  const nameCol = H.indexOf("Customer_Name"), phoneCol = H.indexOf("Phone");
  if (nameCol === -1 || phoneCol === -1) return "Missing Customer_Name/Phone columns.";

  const nameByPhone = {};
  try {
    const custWs = getOrCreateTab(ss, TAB_CUSTOMERS, CUSTOMERS_HEADERS);
    const cData = custWs.getDataRange().getValues();
    const cH = cData[0] || [];
    const cP = cH.indexOf("Phone"), cN = cH.indexOf("Customer_Name");
    if (cP !== -1 && cN !== -1) for (let r = 1; r < cData.length; r++) {
      const ph = _normalizePhone(cData[r][cP]);
      if (ph) nameByPhone[ph] = String(cData[r][cN] || "").trim();
    }
  } catch (_) {}

  let filled = 0;
  for (let r = 1; r < data.length; r++) {
    if (String(data[r][nameCol] || "").trim()) continue;     // already has a name
    const nm = nameByPhone[_normalizePhone(data[r][phoneCol])];
    if (nm) { ws.getRange(r + 1, nameCol + 1).setValue(nm); filled++; }
  }
  SpreadsheetApp.flush();
  return "Filled " + filled + " name(s) in " + TAB_MISSED_ORDERS + ".";
}

function _verifyAndAlertMissedOrders(ss, submissionIds) {
  try {
    const props  = PropertiesService.getScriptProperties();
    const raw    = props.getProperty("PENDING_ORDER_ROWS") || "{}";
    const store  = JSON.parse(raw);
    if (!Object.keys(store).length) return;

    const ws     = getOrCreateTab(ss, TAB_ORDERS, ORDERS_HEADERS);
    const hIdx   = headerIndex(ws);
    const sidCol = hIdx["Submission_ID"];
    if (!sidCol) return;

    // Read all Submission_IDs from sheet (last 200 rows for speed)
    const lastRow  = ws.getLastRow();
    const startRow = Math.max(2, lastRow - 200);
    const count    = lastRow - startRow + 1;
    if (count <= 0) return;
    const sidValues = ws.getRange(startRow, sidCol, count, 1).getValues().flat().map(String);
    const inSheet   = new Set(sidValues);

    const missed = [];
    Object.entries(store).forEach(([sid, entry]) => {
      if (!inSheet.has(sid)) {
        console.error("MISSED ORDER DETECTED — " + sid + " not found in sheet after flush!");
        // Re-append AND verify it actually landed (retry under load). The old code
        // appended once and logged "succeeded" if appendRow didn't throw — but the
        // re-append was silently dropped too, so paid orders vanished with a success log
        // (29-Jun: 5 lost). _reappendUntilPresent re-reads to confirm and retries.
        // Pull the human-readable fields off the saved row (by header name, so dynamic
        // columns like Gateway_Order_ID are handled) for the audit tab.
        const _hf = function (nm) { const c = hIdx[nm]; return (c && entry.row[c - 1] != null) ? String(entry.row[c - 1]) : ""; };
        const _rec = {
          sid: sid, gatewayId: _hf("Gateway_Order_ID"), name: _hf("Customer_Name"),
          phone: entry.phone || _hf("Phone"), amount: _hf("Net_Total"),
          date: _hf("Order_Date"), meal: _hf("Meal_Type")
        };

        const okAttempt = _reappendUntilPresent(ws, sidCol, sid, entry.row, 5);
        if (okAttempt) {
          console.log("Emergency re-append CONFIRMED for " + sid + " (attempt " + okAttempt + ")");
          missed.push({ sid: sid, phone: entry.phone, row: entry.row, recovered: true });
          _rec.status = "Auto-recovered"; _rec.attempts = okAttempt;
          _logMissedOrderRow(ss, _rec);
          delete store[sid]; // safely landed → clear from queue
        } else {
          console.error("Emergency re-append STILL MISSING for " + sid + " after retries — kept in queue for the next pass.");
          missed.push({ sid: sid, phone: entry.phone, row: entry.row, recovered: false });
          _rec.status = "STILL MISSING — enter manually"; _rec.attempts = 5;
          _logMissedOrderRow(ss, _rec);
          // Do NOT delete — leave it in PENDING_ORDER_ROWS so the next submitOrder's
          // safety-net pass gets another shot before the 10-min TTL drops it.
        }
      } else {
        delete store[sid]; // landed on the first write → clear from queue
      }
    });

    props.setProperty("PENDING_ORDER_ROWS", JSON.stringify(store));

    if (missed.length > 0) {
      // Email admin alert. Use MailApp (scope auth/script.send_mail — usually already
      // granted) instead of GmailApp (broad Gmail scopes that weren't authorized, so the
      // 29-Jun alerts silently failed and you got no warning).
      try {
        const adminEmail = PropertiesService.getScriptProperties().getProperty("ADMIN_EMAIL");
        if (adminEmail) {
          const anyLost = missed.some(m => m.recovered === false);
          const subject = anyLost
            ? "🚨 Svaadh: ORDER ROW LOST — manual entry needed"
            : "⚠️ Svaadh: missed order row auto-recovered";
          const body = missed.map(m =>
            (m.recovered === false ? "[STILL MISSING — enter manually] " : "[auto-recovered] ") +
            `SK Order ID: ${m.sid}\nPhone: ${m.phone}\nRow data: ${JSON.stringify(m.row)}`
          ).join("\n\n---\n\n");
          MailApp.sendEmail(adminEmail, subject, body);
        }
      } catch(e) { console.error("Alert email failed:", e.message); }
    }
  } catch(e) {
    console.error("_verifyAndAlertMissedOrders failed:", e.message);
  }
}

// ── SUBMIT ORDER ─────────────────────────────────────────────
function submitOrder(body) {
  // ── REQUEST-LEVEL IDEMPOTENCY ─────────────────────────────────────
  // Frontend retries (apiFetch on timeout) can re-deliver the SAME POST
  // body while the original request is still running on the server. The
  // per-meal duplicate guards below catch most cases, but had an edge
  // case where the cache.put for the last meal of each date hadn't
  // committed before the abort fired — leading to duplicated row writes
  // and duplicate wallet debits.
  //
  // Fix: client passes a unique request_id. The very FIRST thing we do
  // is check the cache for that id and replay the full response if seen.
  // The full response is also cached at the END so any subsequent retry
  // returns the same payload without re-running any work.
  const _reqId = String(body && body.request_id || "").trim();
  const _reqCache = CacheService.getScriptCache();
  if (_reqId) {
    try {
      const _cached = _reqCache.get("submitOrder_req_" + _reqId);
      if (_cached) {
        console.log("submitOrder idempotency replay for request_id=" + _reqId);
        try { return JSON.parse(_cached); } catch(_) { /* corrupt — fall through and re-run */ }
      }
    } catch(_) { /* cache unavailable — fall through */ }
  }

  // Serialize submitOrder calls to prevent stock-race + wallet-race between concurrent customers
  const lock = LockService.getScriptLock();
  try { lock.waitLock(10000); }
  catch(e) { return { error: "Server busy — please retry in a few seconds." }; }
  try {
    // Re-check the idempotency cache AFTER acquiring the lock. The
    // original request may still have been running when we first looked.
    if (_reqId) {
      try {
        const _cached2 = _reqCache.get("submitOrder_req_" + _reqId);
        if (_cached2) {
          console.log("submitOrder idempotency replay (post-lock) for request_id=" + _reqId);
          try { return JSON.parse(_cached2); } catch(_) {}
        }
      } catch(_) {}
    }
    const _result = _submitOrderInternal(body);
    // Cache the FULL response so any retry within 10 minutes replays it
    // verbatim — including error responses (duplicate_detected, stock_conflicts).
    if (_reqId) {
      try { _reqCache.put("submitOrder_req_" + _reqId, JSON.stringify(_result), 600); } catch(_) {}
    }
    return _result;
  } finally {
    try { lock.releaseLock(); } catch(e) {}
  }
}

function _submitOrderInternal(body) {
  const ss = getSpreadsheet();
  const ordersWs = getOrCreateTab(ss, TAB_ORDERS, ORDERS_HEADERS);
  const profile   = body.profile || {};
  const orders    = body.orders  || [];   // [{date, meals:[{type,items,notes,subtotal,area}]}]

  const submittedAt  = getISTTimestamp();
  let   payMethod    = body.payment_method  || "UPI";
  let   payStatus    = body.payment_status  || "Pending";
  const firstTime    = profile.isFirstTime ? "Yes" : "No";
  const payFreq      = profile.payment_preference || "Daily Payment";

  // Build the header→index map once
  const hIdx = headerIndex(ordersWs);

  // Fetch free areas dynamically (replaces hardcoded FREE_AREA = "Bhosale Nagar")
  const freeAreaNames = getAreas().filter(function(a){ return a.free; }).map(function(a){ return a.name; });
  const DELIVERY  = 11;

  const submissionIds = [];

  // ── ONE-SHOT ROW FETCHES ────────────────────────────────────
  // Fetch once, share everywhere. Previously these tabs were re-read 5+ times
  // per submitOrder (day totals, loyalty, duplicate check, stock check, wallet).
  const allOrderRows  = getAllRows(ordersWs);
  const walletWsRef   = getOrCreateTab(ss, TAB_WALLET, WALLET_HEADERS);
  const allWalletRows = getAllRows(walletWsRef);
  // Menu rows read once here — reused by stock check below (avoids duplicate sheet fetch)
  const menuWsOnce  = getOrCreateTab(ss, TAB_MENU, []);
  const menuRowsAll = getAllRows(menuWsOnce);

  // Fetch existing orders once for all dates in this submission to calculate combined-day fees/discounts
  const submissionDates = orders.map(o => o.date);
  const existingDayTotals = getDayTotalsForDates(profile.phone, submissionDates.join(','), allOrderRows).dayTotals || {};

  // Fetch current promo state
  const custWs = getOrCreateTab(ss, TAB_CUSTOMERS, CUSTOMERS_HEADERS);
  const cIdx   = headerIndex(custWs);
  const cRows  = getAllRows(custWs);
  const phoneStr = _normalizePhone(profile.phone);
  const cRowIdx = cRows.findIndex(r => _normalizePhone(r.Phone) === phoneStr);
  let promoCount = null;
  if (cRowIdx !== -1) {
    const rawVal = cRows[cRowIdx].Review_Promo_Count;
    promoCount = (rawVal === "" || rawVal === undefined) ? null : rawVal;
    if (promoCount !== null && !isNaN(promoCount)) promoCount = Number(promoCount);

    // ── On Account override (server-enforced) ──────────────────
    // If the customer is flagged On_Account in SK_Customers, every order
    // is automatically set to method "On Account" / status "On Account"
    // regardless of what the frontend sends.
    if (String(cRows[cRowIdx].On_Account || "").trim() === "Yes") {
      payMethod = "On Account";
      payStatus = "On Account";
    }
  }

  // Masters for ID -> Name resolution in sheet columns. Lightweight masters-only
  // lookup (NOT getAdminData — that scans every order per menu date, ~40s cold,
  // and was the entire place-order lag). Cached 5 min.
  let masterMap = {};
  try { masterMap = _getMastersMap(); } catch(e) { console.error("Master fetch failed in submitOrder", e); }

  // Strip weight/measure suffixes like [175g], [200g], [100ml], (2 pieces) etc.
  // so backend always stores the clean item name regardless of what frontend shows.
  const stripDisplaySuffix = (name) => {
    return String(name)
      .replace(/\s*\[.*?\]\s*/g, '')   // removes [175g], [200ml], [2 pcs] etc.
      .replace(/\s*\(.*?\)\s*/g, '')   // removes (2 pieces), (100ml) etc.
      .trim();
  };

  const resolveName = (k) => {
    let name;
    if (ITEM_COL_MAP[k]) name = ITEM_COL_MAP[k].replace(/_/g, ' ');
    else if (masterMap[k]) name = masterMap[k];
    else name = k.replace(/_/g, ' ');
    return stripDisplaySuffix(name);
  };

  // Sort orders by date to ensure virtual streak runs chronologically
  orders.sort((a,b) => a.date.localeCompare(b.date));
  const initialStreakInfo = _calculateLoyaltyStreak(profile.phone, allOrderRows);
  let virtualStreakCount = initialStreakInfo.streak;
  let virtualPastSurcharge = initialStreakInfo.pastSurcharge;

  // ════ KITCHEN CLOSURE PRE-FLIGHT ════
  // Reject the entire submission if ANY ordered date has been marked
  // Kitchen Closed via the admin Daily Menu toggle. Customer calendar
  // already greys these days out — this is the defensive server guard.
  //
  // EXCEPTION — payment_method === "Gateway (HDFC)": by the time we get
  // here the customer has already paid on the HDFC-hosted page. Rejecting
  // would leave the money taken without an order in our sheet. Accept
  // the order and log a warning so admin can cancel + refund manually.
  if (payMethod !== "Gateway (HDFC)" && payMethod !== "Split (HDFC)") {
    const closedHits = [];
    for (const _o of orders) {
      const _menuForDate = menuRowsAll.find(function(mr) {
        const d = mr.Date instanceof Date
          ? Utilities.formatDate(mr.Date, "Asia/Kolkata", "yyyy-MM-dd")
          : String(mr.Date).trim();
        return d === _o.date;
      });
      const _closed = !!(_menuForDate && (_menuForDate.Kitchen_Closed === true ||
        String(_menuForDate.Kitchen_Closed || "").toLowerCase() === "true"));
      if (_closed) closedHits.push(_o.date);
    }
    if (closedHits.length) {
      return {
        success: false,
        kitchen_closed: true,
        closed_dates: closedHits,
        error: "Kitchen is closed on " + closedHits.join(", ")
             + ". Please remove that date from your cart and try again."
      };
    }
  } else {
    // Gateway path — log if a closed date sneaks through, so admin can
    // catch it manually. Order still gets written.
    for (const _o of orders) {
      const _menuForDate = menuRowsAll.find(function(mr) {
        const d = mr.Date instanceof Date
          ? Utilities.formatDate(mr.Date, "Asia/Kolkata", "yyyy-MM-dd")
          : String(mr.Date).trim();
        return d === _o.date;
      });
      const _closed = !!(_menuForDate && (_menuForDate.Kitchen_Closed === true ||
        String(_menuForDate.Kitchen_Closed || "").toLowerCase() === "true"));
      if (_closed) {
        console.warn("⚠️ Gateway-paid order accepted for KITCHEN-CLOSED date "
          + _o.date + " (phone " + profile.phone + ", gateway_order_id "
          + (body.gateway_order_id || "?") + "). Admin must manually cancel + refund this order.");
      }
    }
  }

  // ════ ORDERING-WINDOW PRE-FLIGHT ════
  // Server-side guard for what the calendar/meal screen enforce client-side:
  // no past dates, no Sundays, no past-cutoff meals for today, no admin-closed
  // meals. Without this, a stale tab (left open across a cutoff) or a crafted
  // POST could place orders the kitchen can't fulfil — the cancel path has
  // always had a cutoff guard; the place path now matches it.
  // Gateway exception (mirrors the kitchen-closure guard above): the customer
  // already paid on the HDFC page — accept the order and warn so admin can
  // manually cancel + refund instead of orphaning the money.
  {
    const _wToday = Utilities.formatDate(new Date(), "Asia/Kolkata", "yyyy-MM-dd");
    const _wNow   = getISTDate();
    const _wHour  = _wNow.getHours() + _wNow.getMinutes() / 60;
    const _wViolations = [];
    for (const _o of orders) {
      const _d = String(_o.date || "").trim();
      if (!_d) continue;
      if (_d < _wToday) { _wViolations.push("Orders for past dates (" + _d + ") cannot be placed."); continue; }
      if (new Date(_d + "T12:00:00").getDay() === 0) {
        _wViolations.push("The kitchen is closed on Sundays (" + _d + ").");
        continue;
      }
      const _menuRowW = menuRowsAll.find(function(mr) {
        const md = mr.Date instanceof Date
          ? Utilities.formatDate(mr.Date, "Asia/Kolkata", "yyyy-MM-dd")
          : String(mr.Date).trim();
        return md === _d;
      });
      let _ordersClosedW = {};
      try { if (_menuRowW && _menuRowW.Orders_Closed) _ordersClosedW = JSON.parse(_menuRowW.Orders_Closed); } catch(e) {}
      // Per-meal max-order cap. Count active (non-cancelled) orders for this date
      // from the FULL sheet — authoritative, and exact because submitOrder runs
      // under LockService (concurrent orders can't both slip past the cap).
      let _orderCapW = {};
      try { if (_menuRowW && _menuRowW.Order_Cap_JSON) _orderCapW = JSON.parse(_menuRowW.Order_Cap_JSON); } catch(e) {}
      let _capAltW = {};   // per-meal: offer Self Pickup / Porter when full? default ON
      try { if (_menuRowW && _menuRowW.Cap_Alt_JSON) _capAltW = JSON.parse(_menuRowW.Cap_Alt_JSON); } catch(e) {}
      const _capCountsW   = Object.keys(_orderCapW).length ? _countActiveMealOrders(allOrderRows, _d) : null;
      const _delIdxW = Object.keys(_orderCapW).length ? _activeDeliveryIndex(allOrderRows, _d) : null;
      const _effCutW = (_d === _wToday) ? _effectiveCutoffsForDate(_d) : null;
      for (const _m of (_o.meals || [])) {
        const _mt = String(_m.type || "");
        if (_ordersClosedW[_mt]) { _wViolations.push(_mt + " orders are closed for " + _d + "."); continue; }
        const _capW = _capCountsW ? Number(_orderCapW[_mt] || 0) : 0;
        const _capExceededW = _capW > 0 && _capCountsW && (_capCountsW[_mt] || 0) >= _capW;
        if (_capExceededW) {
          // Enkin (bulk/internal customer) bypasses the delivery cap entirely —
          // always allowed even when the meal is full. Contains-match ("Enkin Kumar",
          // "Enkin 2" …) — must stay in sync with _countActiveMealOrders + order.html.
          const _isEnkinOrderW = String(profile.name || "").toLowerCase().indexOf("enkin") !== -1;
          if (!_isEnkinOrderW) {
          // Cap is a DELIVERY limit. Self Pickup / Porter bypass it ONLY when the
          // admin left alternatives ON for this meal (default). If turned OFF, the
          // meal is a hard sold-out — block delivery AND pickup/porter.
          const _mAreaW = String(_m.area || profile.area || "").toLowerCase();
          const _mIsDeliveryW = (_mAreaW.indexOf("pickup") === -1 && _mAreaW !== "porter");
          const _altOnW = (_capAltW[_mt] !== false);
          if (_mIsDeliveryW) {
            // Free-delivery areas (Bhosale Nagar / Triveni Nagar) are home turf:
            // they COUNT toward the cap but are never BLOCKED by it (allowed till
            // cutoff). Otherwise allow a "piggyback" when we already have an active
            // delivery to this customer's society for this date+meal (SAME stop, no
            // new delivery burden).
            const _isFreeAreaW = freeAreaNames.indexOf(_m.area || profile.area || "") !== -1;
            if (!_isFreeAreaW) {
              const _idxMtW = _delIdxW && _delIdxW[_mt];
              const _socW = _normSocietyKey(_m.society || profile.society || "");
              const _socAlreadyW  = !!(_socW && _idxMtW && _idxMtW.soc[_socW]);
              // This same customer already has a delivery for this date+meal →
              // adding more is the same stop, let them through past the cap.
              const _phW = _normalizePhone(profile.phone || "");
              const _selfAlreadyW = !!(_phW && _idxMtW && _idxMtW.ph[_phW]);
              if (!_socAlreadyW && !_selfAlreadyW) {
                _wViolations.push(_altOnW
                  ? (_mt + " delivery is full for " + _d + " — please choose Self Pickup or Porter, or order for another day.")
                  : (_mt + " is sold out for " + _d + " — the daily order limit has been reached."));
                continue;
              }
            }
            // free area OR same-building OR own existing delivery → allowed (falls through)
          } else if (!_altOnW) {
            _wViolations.push(_mt + " is sold out for " + _d + " — the daily order limit has been reached."); continue;
          }
          // pickup/porter + alternatives ON → allowed (falls through)
          } // end if (!_isEnkinOrderW) — Enkin always falls through (cap bypassed)
        }
        if (_effCutW && _effCutW[_mt] !== undefined && _wHour >= _effCutW[_mt]) {
          _wViolations.push("The " + _mt + " cutoff for today (" + _d + ") has already passed.");
        }
      }
    }
    if (_wViolations.length) {
      // Admin bypass: submissions carrying the verified ADMIN_PIN (e.g. the
      // vault's Place Bulk Orders tool) may legitimately order late/closed.
      const _isAdminSubmit = String(body.pin || "") !== "" && _pinMatch(String(body.pin || ""), ADMIN_PIN);
      if (_isAdminSubmit) {
        console.log("Ordering-window violation(s) bypassed by ADMIN submission: " + _wViolations.join(" | "));
      } else if (payMethod !== "Gateway (HDFC)" && payMethod !== "Split (HDFC)") {
        return { error: _wViolations[0], window_violations: _wViolations };
      } else {
        console.warn("⚠️ Gateway-paid order accepted despite ordering-window violation(s): "
          + _wViolations.join(" | ") + " (phone " + profile.phone + "). Admin must review.");
      }
    }
  }

  // ════ STOCK LIMIT PRE-FLIGHT ════
  // Hard-block submission if any requested item exceeds remaining stock.
  // Runs under LockService so concurrent submissions see each other's counts.
  {
    const menuRowsStk = menuRowsAll;   // reuse the already-fetched menu rows
    const stockConflicts = [];
    for (const dateOrder of orders) {
      const dateStrStk = dateOrder.date;
      const menuRowStk = menuRowsStk.find(mr => {
        const d = mr.Date instanceof Date
          ? Utilities.formatDate(mr.Date, "Asia/Kolkata", "yyyy-MM-dd")
          : String(mr.Date).trim();
        return d === dateStrStk;
      });
      let stockLimitsStk = {};
      try { if (menuRowStk && menuRowStk.Stock_JSON) stockLimitsStk = JSON.parse(menuRowStk.Stock_JSON); } catch(e) {}
      if (!Object.keys(stockLimitsStk).length) continue;

      const countedStk = countOrderedUnits(allOrderRows, dateStrStk);
      for (const mealStk of (dateOrder.meals || [])) {
        const mealLimits = stockLimitsStk[mealStk.type] || {};
        let mealItems = mealStk.items || [];
        if (typeof mealItems === "string") {
          try { mealItems = JSON.parse(mealItems); } catch(e) { mealItems = []; }
        }
        if (!Array.isArray(mealItems)) mealItems = [];
        for (const it of mealItems) {
          const colKeyStk = it.colKey;
          const qtyStk = Number(it.qty) || 0;
          if (qtyStk <= 0) continue;
          const limitStk = mealLimits[colKeyStk];
          if (limitStk === undefined) continue;
          const usedStk = countedStk[mealStk.type][itemsJsonKey(colKeyStk)] || 0;
          if (usedStk + qtyStk > limitStk) {
            stockConflicts.push({
              date: dateStrStk,
              meal: mealStk.type,
              colKey: colKeyStk,
              available: Math.max(0, limitStk - usedStk)
            });
          }
        }
      }
    }
    if (stockConflicts.length) {
      const first = stockConflicts[0];
      const nm = first.colKey === "B_CURD" ? "Curd (Breakfast)" : first.colKey;
      // Gateway exception: the customer has ALREADY PAID on the HDFC page by
      // the time this runs — rejecting would take the money without an order.
      // Accept and warn so admin can adjust stock or cancel + refund manually.
      if (payMethod !== "Gateway (HDFC)" && payMethod !== "Split (HDFC)") {
        return {
          error: `Only ${first.available} of "${nm}" left for ${first.meal} on ${first.date}. Please reduce your quantity.`,
          stock_conflicts: stockConflicts
        };
      }
      console.warn("⚠️ Gateway-paid order accepted despite STOCK conflict(s): "
        + stockConflicts.map(c => c.meal + "/" + c.colKey + " on " + c.date + " (only " + c.available + " left)").join(" | ")
        + " (phone " + profile.phone + "). Admin must review.");
    }
  }

  const _dupNowMs = Date.now();
  const _FIVE_MIN_MS = 5 * 60 * 1000;
  const _normPhone = _normalizePhone(profile.phone);
  let loyaltyExcessCredit = 0; // accumulates surplus when 6th-day discount exceeds the bill
  let grandNetTotal = 0;       // sum of all per-meal Net_Totals — returned so the UPI QR matches what's recorded
  let newRowsWritten = 0;      // rows actually appended this call — 0 means everything was a dedupe replay
  // SPLIT: one cart-level wallet budget.
  // "Split" (manual UPI): frontend sends body.wallet_credit as the intended wallet portion.
  // "Split (HDFC)": read server-authoritative wallet_applied from the HDFC pending entry
  //   (stored by hdfc_createSession from the real SK_Wallet balance — client value NEVER trusted).
  //   Falls back to body.wallet_credit only for reconciler submissions (server-computed,
  //   used when the pending entry has expired after >30 min TTL).
  let splitWalletBudget = 0;
  if (String(payMethod) === "Split") {
    splitWalletBudget = Math.max(0, Number(body.wallet_credit) || 0);
  } else if (String(payMethod) === "Split (HDFC)") {
    try {
      const _spe = JSON.parse(
        PropertiesService.getScriptProperties().getProperty("HDFC_PENDING_ORDERS") || "{}"
      )[String(body.gateway_order_id || "")] || null;
      if (_spe && Number(_spe.wallet_applied) > 0) {
        splitWalletBudget = Number(_spe.wallet_applied); // server-validated at hdfc_createSession time
        console.log("Split (HDFC): wallet_applied=" + splitWalletBudget + " for " + body.gateway_order_id);
      } else if (body.placed_via === "reconciler" && Number(body.wallet_credit) > 0) {
        // Pending entry expired (>30 min) — reconciler's server-computed value is safe to trust
        splitWalletBudget = Math.max(0, Number(body.wallet_credit));
        console.log("Split (HDFC) reconciler fallback: wallet_credit=" + splitWalletBudget);
      }
    } catch (_spe_err) {
      if (body.placed_via === "reconciler") splitWalletBudget = Math.max(0, Number(body.wallet_credit) || 0);
    }
  }
  // Normalize an items object to a stable JSON signature (sorted keys)
  const _itemsSig = (obj) => JSON.stringify(
    Object.keys(obj).sort().reduce((a, k) => { a[k] = obj[k]; return a; }, {})
  );
  // Normalize a date value that may be a Date object or a string
  const _normDate = (d) => {
    if (!d) return "";
    if (d instanceof Date) return Utilities.formatDate(d, "Asia/Kolkata", "yyyy-MM-dd");
    return String(d).trim().substring(0, 10);
  };

  // ════ LAYER 4 PRE-FLIGHT — LONG-WINDOW DUPLICATE GUARD ═══════════════════
  // Scan EVERY meal of this submission for a historical duplicate BEFORE any
  // row is written. (Doing this mid-loop used to reject the submission AFTER
  // earlier meals' rows were already appended — a half-placed order the
  // customer believed had failed.) Recent rows (≤5 min) are excluded here:
  // those are legitimate retries, silently deduped by layers 1–3 in the loop.
  if (body.confirm_duplicate !== true) {
    for (const _o of orders) {
      let _mealsPF = _o.meals || [];
      for (const _m of _mealsPF) {
        let _itemsPF = _m.items || [];
        if (typeof _itemsPF === "string") { try { _itemsPF = JSON.parse(_itemsPF); } catch(e) { _itemsPF = []; } }
        if (!Array.isArray(_itemsPF)) _itemsPF = [];
        const _objPF = {};
        // Build EXACTLY like the main loop's itemsObj (no qty filtering) so the
        // signature matches what rows store and what layers 1–3 compare.
        _itemsPF.forEach(it => {
          if (!it) return;
          _objPF[it.colKey === "B_CURD" ? "Breakfast Curd" : resolveName(it.colKey)] = it.qty;
        });
        const _sigPF = _itemsSig(_objPF);
        const _hist = allOrderRows.find(r => {
          if (_normalizePhone(r.Phone) !== _normPhone) return false;
          if (_normDate(r.Order_Date) !== _normDate(_o.date)) return false;
          if (r.Meal_Type !== _m.type) return false;
          if (_isOrderCancelled(r.Payment_Status)) return false;
          const rMs = r.Submitted_At ? new Date(r.Submitted_At).getTime() : 0;
          if (rMs && (_dupNowMs - rMs) <= _FIVE_MIN_MS) return false; // recent retry → layers 1–3 dedupe it
          try {
            const stored = typeof r.Items_JSON === "string" ? JSON.parse(r.Items_JSON) : (r.Items_JSON || {});
            return _itemsSig(stored) === _sigPF;
          } catch(e) { return false; }
        });
        if (_hist) {
          console.warn("Duplicate order REJECTED (pre-flight, no confirm flag) — phone=" + _normPhone
            + " date=" + _o.date + " meal=" + _m.type + " existingSid=" + _hist.Submission_ID);
          return {
            success: false,
            duplicate_detected: true,
            error: "A " + _m.type + " order with the same items for " + _o.date
                 + " already exists (Order ID: " + _hist.Submission_ID
                 + "). If you intentionally want to place another one, please confirm.",
            existing_submission_id: _hist.Submission_ID,
            existing_order_date:    _normDate(_hist.Order_Date),
            existing_meal_type:     _hist.Meal_Type,
            existing_payment_status: _hist.Payment_Status || "Pending",
            existing_submitted_at:  _hist.Submitted_At ? String(_hist.Submitted_At) : "",
            attempted_order_date:   _o.date,
            attempted_meal_type:    _m.type
          };
        }
      }
    }
  } else {
    console.log("Duplicate order ALLOWED (confirm_duplicate=true) — phone=" + _normPhone);
  }

  // ── Streak gap guard (mirrors the frontend fix) ──────────────────────────
  // The projected streak must NOT carry across a real ordering gap. Build the
  // set of ALL the customer's ordered days (past rows + this submission) so an
  // in-between day that actually has an order — or a Sunday / admin-closed day —
  // is NOT treated as a gap (and a real gap correctly resets the streak).
  let prevStreakDate = initialStreakInfo.end || null;
  const _closedSetSO = _kitchenClosedSet();
  const _orderedDaysSO = new Set();
  (allOrderRows || []).forEach(function(r) {
    if (_isOrderCancelled(r.Payment_Status)) return;
    const dd = _normDate(r.Order_Date);
    if (dd) _orderedDaysSO.add(dd);
  });
  (orders || []).forEach(function(o) { if (o && o.date) _orderedDaysSO.add(_normDate(o.date)); });
  const _soStreakConsecutive = function(d1, d2) {
    if (!d1 || !d2) return false;
    const a = new Date(d1 + "T12:00:00"), b = new Date(d2 + "T12:00:00");
    const diff = Math.round((b - a) / 86400000);
    if (diff <= 0) return false;
    if (diff === 1) return true;
    let cur = new Date(a); cur.setDate(cur.getDate() + 1);
    while (cur < b) {
      const iso = Utilities.formatDate(cur, "Asia/Kolkata", "yyyy-MM-dd");
      if (cur.getDay() !== 0 && !_closedSetSO[iso] && !_orderedDaysSO.has(iso)) return false; // real gap
      cur.setDate(cur.getDate() + 1);
    }
    return true;
  };

  for (const order of orders) {
    const orderDate = order.date;
    // Same-day add-on: a cart date equal to the last counted streak day (e.g.
    // adding lunch when today's breakfast is already in the streak) is the SAME
    // day — never a gap, never a fresh 6th-day trigger (the day was already
    // counted; an earlier reward today is handled by rewardDays → streak 0).
    const isSameStreakDay = !!(prevStreakDate && prevStreakDate === _normDate(orderDate));
    // Gap guard: a date not consecutive with the previous ordered day breaks the
    // streak — restart so the 6th-day reward can't fire across a real gap.
    if (prevStreakDate && !isSameStreakDay && !_soStreakConsecutive(prevStreakDate, _normDate(orderDate))) {
      virtualStreakCount = 0;
      virtualPastSurcharge = 0;
    }
    const is6thDay = !isSameStreakDay && (virtualStreakCount === 5); // Hits 6 on this day
    const existingDateInfo = (existingDayTotals[orderDate] || {});

    // Calculate meal count for this date to determine dynamic free delivery threshold
    const mealsThisSubmission = order.meals.filter(m => (Number(m.subtotal) || 0) > 0).map(m => m.type);
    const existingMeals = Object.keys(existingDateInfo).filter(mType => (Number(existingDateInfo[mType].subtotal) || 0) > 0);
    const allMealsOnDate = Array.from(new Set([...mealsThisSubmission, ...existingMeals]));
    const totalMealsCount = allMealsOnDate.length;
    // Free-delivery threshold by delivery-meal count: 1 → ₹106, 2 → ₹159, 3 → ₹190.
    // MUST mirror the frontend (_freeTh) and the gateway recompute exactly.
    const dynamicFreeThreshold = totalMealsCount <= 1 ? (PRICING_V2 ? 106 : 100) : totalMealsCount === 2 ? (PRICING_V2 ? 159 : 150) : (PRICING_V2 ? 190 : 180);

    // Calculate total food subtotal for this specific submission's date
    const submissionDayFoodTotal = order.meals.reduce((s, m) => s + (Number(m.subtotal) || 0), 0);
    // Combine with already placed orders for this date
    const prevDayFoodTotal = Object.values(existingDateInfo).reduce((s, m) => s + (Number(m.subtotal) || 0), 0);
    const combinedDayTotal = submissionDayFoodTotal + prevDayFoodTotal;

    // Calculate day-level discount once across all meals for this date (including previous ones)
    // Tiers on the day's combined FOOD total: ≥₹750 → 10%, ≥₹485 → 7.5%, ≥₹325 → 5%.
    // MUST mirror the frontend (DISC_T1/T2/T3) and the gateway recompute exactly.
    let discRate = 0;
    if (combinedDayTotal >= 750) discRate = 0.10;
    else if (combinedDayTotal >= 485) discRate = 0.075;
    else if (combinedDayTotal >= 325) discRate = 0.05;
    
    const totalDayDiscAmt = Math.round(combinedDayTotal * discRate);
    // Find how much discount was already applied to previous orders for this date
    const prevDayDiscAmt = Object.values(existingDateInfo).reduce((s, m) => s + (Number(m.discount_applied) || 0), 0);
    // The discount to apply to this ENTIRE submission for this date = entitled - already_applied
    const submissionDateDiscAmt = Math.max(0, totalDayDiscAmt - prevDayDiscAmt);

    // Surcharge accrual = SUM of per-meal ceils — exactly what the customer is
    // CHARGED (each meal row stores ceil(sub × 6%)). Using a single per-day
    // ceil here undercounted the waiver by ₹1–2 on multi-meal days vs what was
    // actually paid (and vs _calculateLoyaltyStreak, which sums per-row values).
    // V2: accrual is 5% (floor), tracked for the streak but NOT billed. V1: 6% (ceil), billed.
    const submissionDaySurcharge = order.meals.reduce(
      (s, m) => s + (PRICING_V2 ? Math.floor((Number(m.subtotal) || 0) * 0.05) : Math.ceil((Number(m.subtotal) || 0) * 0.06)), 0);

    // Pro-rate the submission-level discount across meals in this submission
    // Snapshot the accumulated past surcharge BEFORE the streak-state update below
    // zeroes it on the 6th day. getDisc() is called LATER (in the per-meal loop), so
    // reading the live virtualPastSurcharge there would see it post-reset (=0) and
    // waive only the current day — the bug that under-stored the 6th-day discount and
    // mismatched the cart. The frontend computes its waiver before resetting; match it.
    const _waiverPastSurcharge = virtualPastSurcharge;
    const getDisc = (sub) => {
      if (is6thDay) {
        // Loyalty Discount: Waive all 6 days of surcharge
        const totalWaiver = _waiverPastSurcharge + submissionDaySurcharge;
        return submissionDayFoodTotal > 0 ? Math.round(totalWaiver * (sub / submissionDayFoodTotal)) : 0;
      }
      return submissionDayFoodTotal > 0 ? Math.round(submissionDateDiscAmt * (sub / submissionDayFoodTotal)) : 0;
    };

    // Update virtual streak state for NEXT loop iteration
    const currentDaySurcharge = submissionDaySurcharge;
    if (is6thDay) {
      virtualStreakCount = 0;
      virtualPastSurcharge = 0;
    } else if (isSameStreakDay) {
      // Same day as the last counted streak day — no new streak day, but this
      // submission's surcharge joins that day's total for a future 6th-day waiver.
      virtualPastSurcharge += currentDaySurcharge;
    } else {
      virtualStreakCount++;
      virtualPastSurcharge += currentDaySurcharge;
    }
    prevStreakDate = _normDate(orderDate); // this date is now an ordered day — track for the next gap check

    for (const meal of order.meals) {
      const sid = generateSubmissionID();
      submissionIds.push(sid);
      meal._sid = sid; // carry sid for ledger
      
      const mealType = meal.type;
      const sub = Number(meal.subtotal) || 0;
      const mealArea = meal.area || profile.area || "";
      
      let items  = meal.items || [];   // [{colKey, qty}]
      // Safety fix: If items is a stringified JSON, parse it (prevents character-distortion crash)
      if (typeof items === "string") {
        try { items = JSON.parse(items); } catch(e) { items = []; }
      }
      if (!Array.isArray(items)) items = [];

      const nKitchen = meal.notesKitchen || "";
      const nDelivery = meal.notesDelivery || "";
      
      // Get combined totals for THIS specific meal type (prev + current)
      const prevMealSub = (existingDateInfo[mealType] || {}).subtotal || 0;
      const combinedMealSub = sub + prevMealSub;
      
      // Delivery & Fee logic (matches frontend)
      const isPickup  = (mealArea.toLowerCase().includes("pickup"));
      // Porter = cap-overflow option: we hand the food to a courier the CUSTOMER
      // books & pays. We don't deliver, so (like Self Pickup) our delivery + small
      // -order fees are waived.
      const isPorter  = (mealArea.toLowerCase() === "porter");
      const isFreeArea = freeAreaNames.includes(mealArea);

      // VIP Fee Exemption
      const isFeeExempt = (cRowIdx !== -1 && (cRows[cRowIdx].Fee_Exempt === "Yes" || cRows[cRowIdx].Fee_Exempt === true));

      // VIP counts as a "free day" too — matches the frontend, so a VIP whose
      // earlier same-day orders were charged fees gets them credited back below.
      const isDayFree = (combinedDayTotal >= dynamicFreeThreshold) || isFeeExempt;

      let delCharge = 0;
      if (!isFeeExempt && !isDayFree && !isPickup && !isPorter && !isFreeArea && sub > 0) {
        delCharge = DELIVERY;
      }

      let smallOrderFee = 0;
      if (!isFeeExempt && !isDayFree && !isPickup && !isPorter && (mealType === "Lunch" || mealType === "Dinner") && sub > 0 && combinedMealSub < (PRICING_V2 ? 53 : 50)) {
        smallOrderFee = 11;
      }

      // Calculation of credits for previously paid fees on the same day (Retroactive waiver)
      let dateDeliveryCredit = 0;
      let dateSmallFeeCredit = 0;
      if (isDayFree) {
        Object.keys(existingDateInfo).forEach(mType => {
          dateDeliveryCredit += (Number(existingDateInfo[mType].delivery_charged) || 0);
          dateSmallFeeCredit += (Number(existingDateInfo[mType].small_fee_charged) || 0);
        });
      }
      const totalDateCredit = dateDeliveryCredit + dateSmallFeeCredit;
      const mealCredit = submissionDayFoodTotal > 0 ? Math.round(totalDateCredit * (sub / submissionDayFoodTotal)) : 0;

      const discAmt = getDisc(sub);
      // V1: surcharge ceil(sub×6%) IS charged; the 6th-day loyalty waiver covers it
      // (net: get back days 1–5). V2: NO surcharge in the bill — inflationSurcharge is a
      // round(sub×5%) ACCRUAL stored only for the streak, and given back on the 6th day.
      const inflationSurcharge = PRICING_V2 ? Math.floor(sub * 0.05) : Math.ceil(sub * 0.06);

      // Google Review Promo Logic (10% OFF per meal)
      let reviewDiscount = 0;
      const isNumeric = (typeof promoCount === "number" && !isNaN(promoCount));
      if (isNumeric && promoCount > 0 && sub > 0) {
        reviewDiscount = Math.round(sub * 0.10);
        promoCount--;
      }

      let netTotal = Math.round(sub + delCharge + smallOrderFee + (PRICING_V2 ? 0 : inflationSurcharge) - discAmt - mealCredit - reviewDiscount);
      // A bill can never be negative. Clamp to ₹0 and credit the surplus to the
      // wallet after all rows are written. Covers BOTH the 6th-day waiver
      // exceeding the day's bill AND retroactive discount/fee credits exceeding
      // a small top-up order (e.g. ₹10 add-on that pushes the day over a
      // discount tier, earning back more than the add-on costs).
      // mealSurplus is tracked per meal so a duplicate-skip can back it out.
      let mealSurplus = 0;
      if (netTotal < 0) {
        mealSurplus = Math.abs(netTotal);
        loyaltyExcessCredit += mealSurplus;
        netTotal = 0;
      }
      meal._reviewDiscount = reviewDiscount; // carry for set() below


      // Build items JSON
      // Breakfast Curd gets a distinct key ("Breakfast Curd") so kitchen prep
      // and admin reports can tell it apart from Lunch/Dinner Curd.
      const itemsObj = {};
      items.forEach(({colKey, qty}) => {
        let canonical;
        if (colKey === "B_CURD") canonical = "Breakfast Curd";
        else canonical = resolveName(colKey);
        itemsObj[canonical] = qty;
      });

      // Address fields handling. Self Pickup clears the address (customer comes to
      // us). Porter KEEPS the customer address (the courier they book delivers to
      // them) but is tagged area="Porter" so backend/kitchen know it isn't our
      // delivery and the cap doesn't count it.
      const wing    = isPickup ? "" : (meal.wing    || profile.wing    || "");
      const flat    = isPickup ? "" : (meal.flat    || profile.flat    || "");
      const floor   = isPickup ? "" : (meal.floor   || profile.floor   || "");
      const society = isPickup ? "" : (meal.society || profile.society || "");
      const area    = isPickup ? "Self Pickup" : (isPorter ? "Porter" : mealArea);

      const _custAddrLine = [wing && `Wing ${wing}`, flat && `Flat ${flat}`, floor && `${floor} Floor`, society].filter(Boolean).join(", ");
      const fullAddr = isPickup
                        ? "Self Pickup (A 104, Shree laxmi vihar society, Hadapsar)"
                        : isPorter
                        ? ("Porter (customer-booked courier) → " + (_custAddrLine || "address not provided"))
                        : [_custAddrLine, area].filter(Boolean).join(", ");
      const mapsLink = isPickup ? "" : (meal.maps || profile.maps || "");
      const landmark = isPickup ? "" : (meal.landmark || profile.landmark || "");

      // Build row array aligned to ORDERS_HEADERS
      const row = new Array(ORDERS_HEADERS.length).fill("");
      const set = (colName, val) => {
        const idx = hIdx[colName];
        if (idx) row[idx - 1] = val;
      };

      set("Submission_ID",       sid);
      set("Submitted_At",        submittedAt);
      set("Order_Date",          orderDate);
      set("Meal_Type",           mealType);
      set("Customer_Name",       profile.name     || "");
      set("Phone",               _normalizePhone(profile.phone));
      set("Area",                area);
      set("Wing",                wing);
      set("Flat",                flat);
      set("Floor",               floor);
      set("Society",             society);
      set("Full_Address",        fullAddr);
      set("Maps_Link",           mapsLink);
      set("Landmark",            landmark);
      set("Delivery_Point",      _getDeliveryPointLabel(meal.delivery_point || profile.delivery_point));
      if (!hIdx["Small_Order_Fee"]) {
        ordersWs.getRange(1, ordersWs.getLastColumn() + 1).setValue("Small_Order_Fee");
        hIdx["Small_Order_Fee"] = ordersWs.getLastColumn();
      }
      if (!hIdx["Inflation_Surcharge"]) {
        ordersWs.getRange(1, ordersWs.getLastColumn() + 1).setValue("Inflation_Surcharge");
        hIdx["Inflation_Surcharge"] = ordersWs.getLastColumn();
      }
      if (!hIdx["Loyalty_Discount"]) {
        ordersWs.getRange(1, ordersWs.getLastColumn() + 1).setValue("Loyalty_Discount");
        hIdx["Loyalty_Discount"] = ordersWs.getLastColumn();
      }
      // Gateway_Order_ID — the HDFC payment id this row was paid under. One gateway
      // payment can cover several meals (B+L+D in one go), so EVERY meal row of that
      // order carries the SAME id → cancelling one meal does a PARTIAL refund of just
      // that meal's amount against the shared payment. Required by the auto-refund +
      // reconciler. Self-heal the column if the sheet predates it.
      if (!hIdx["Gateway_Order_ID"]) {
        ordersWs.getRange(1, ordersWs.getLastColumn() + 1).setValue("Gateway_Order_ID");
        hIdx["Gateway_Order_ID"] = ordersWs.getLastColumn();
      }
      set("Items_JSON",          JSON.stringify(itemsObj));
      set("Special_Notes_Kitchen",  nKitchen);
      set("Special_Notes_Delivery", nDelivery);
      set("Food_Subtotal",       sub);
      set("Small_Order_Fee",     smallOrderFee);
      set("Inflation_Surcharge", inflationSurcharge);
      set("Loyalty_Discount",    is6thDay ? "Yes" : "No");
      set("Gateway_Order_ID",    String(body.gateway_order_id || "")); // same id on each meal row of a gateway payment
      set("Delivery_Charge",     delCharge);
      set("Discount_Amount",     discAmt);
      if (hIdx["Review_Discount"]) {
        set("Review_Discount",   meal._reviewDiscount || 0);
      }
      set("Net_Total",           netTotal);
      grandNetTotal += netTotal;   // authoritative running total — drives the post-place QR

      // ════ DUPLICATE CHECK — must run BEFORE wallet deduction ════
      // Three layers of protection (any one catching is enough):
      //
      //   1. CacheService (fast, in-memory, atomic across script invocations).
      //      Bulletproof against sheet-read staleness — if A wrote here in the
      //      last 5 min, B's cache.get(key) will see it instantly even if
      //      A's appendRow hasn't propagated to a fresh getAllRows yet.
      //   2. Fresh sheet re-read (catches anything cache evicted under load).
      //   3. The original allOrderRows snapshot (legacy, kept for safety).
      //
      // After the row is written, we cache.put(key) so future calls hit layer 1.
      const _incomingSig = _itemsSig(itemsObj);
      const _dupKey      = `dup_${_normPhone}_${_normDate(orderDate)}_${mealType}_${_incomingSig}`;
      const _cache       = CacheService.getScriptCache();

      // Layer 1: cache lookup
      const _cachedSid = _cache.get(_dupKey);
      if (_cachedSid) {
        submissionIds[submissionIds.length - 1] = _cachedSid;
        // Skipped duplicate — back out this meal's in-memory mutations so the
        // retry doesn't burn a promo use or double-credit the wallet surplus.
        if (reviewDiscount > 0) promoCount++;
        if (mealSurplus > 0) loyaltyExcessCredit -= mealSurplus;
        console.log("Duplicate caught by cache: " + _dupKey + " → " + _cachedSid);
        continue;
      }

      // Layer 2 + 3: reuse the upfront snapshot instead of re-reading the whole
      // sheet per meal. allOrderRows was read AFTER acquiring the global lock, so
      // it already includes every committed row from any prior order; the lock
      // blocks concurrent writers; and this execution's own earlier-meal rows
      // can't be duplicates of the current meal (each cart date+meal is unique).
      // Same-request retries are caught by the CacheService layer above. This
      // removes N expensive full-sheet reads per order (the main latency source).
      const _freshRows  = allOrderRows;
      const _nowMsFresh = Date.now();
      const _dupRow = _freshRows.find(r => {
        if (_normalizePhone(r.Phone) !== _normPhone) return false;
        if (_normDate(r.Order_Date) !== _normDate(orderDate)) return false;
        if (r.Meal_Type !== mealType) return false;
        const rMs = r.Submitted_At ? new Date(r.Submitted_At).getTime() : 0;
        if (!rMs || (_nowMsFresh - rMs) > _FIVE_MIN_MS) return false;
        try {
          const stored = typeof r.Items_JSON === "string" ? JSON.parse(r.Items_JSON) : (r.Items_JSON || {});
          return _itemsSig(stored) === _incomingSig;
        } catch(e) { return false; }
      });
      if (_dupRow) {
        submissionIds[submissionIds.length - 1] = _dupRow.Submission_ID || sid;
        // Backfill cache so subsequent calls hit layer 1 (faster + more reliable)
        try { _cache.put(_dupKey, _dupRow.Submission_ID || sid, 300); } catch(e) {}
        // Skipped duplicate — back out this meal's in-memory mutations so the
        // retry doesn't burn a promo use or double-credit the wallet surplus.
        if (reviewDiscount > 0) promoCount++;
        if (mealSurplus > 0) loyaltyExcessCredit -= mealSurplus;
        console.log("Duplicate order skipped (sheet check): " + _normPhone + " / " + orderDate + " / " + mealType);
        continue;
      }

      // LAYER 4 (long-window duplicate guard) moved to a PRE-FLIGHT scan before
      // this loop — rejecting mid-loop left earlier meals' rows already written
      // while the customer saw an error (half-placed submission).

      // Reserve the cache key BEFORE the wallet deduction + row write so any
      // concurrent retry that arrives during this meal's processing hits layer 1.
      try { _cache.put(_dupKey, sid, 300); } catch(e) {}

      let pStat = payStatus;
      let walletCreditUsed = 0;
      // ════ WALLET DEDUCTION LOGIC ════
      if (payMethod === "Wallet") {
        let currentBalance = _calculateWalletBalance(profile.phone, allWalletRows);

        if (currentBalance >= netTotal) {
          _appendWalletTransaction(profile.phone || "", profile.name || "Customer", "Order Deduction", netTotal, true, sid);
          // Reflect the new debit in our in-memory wallet cache so subsequent
          // meals in the same submission see the updated balance.
          allWalletRows.push({ Phone: _normalizePhone(profile.phone), Txn_Type: "Order Deduction", Amount: netTotal, Verified: "TRUE" });
          pStat = "Wallet Paid";
          walletCreditUsed = netTotal;
        } else {
          pStat = "Pending"; // Wallet failed, fallback to pending
        }
      } else if (payMethod === "Split" || payMethod === "Split (HDFC)") {
        // Split: spend this meal's slice from the SUBMISSION wallet budget, capped by the
        // live balance. Never mutate payMethod — a later meal with no budget left is
        // simply recorded with Wallet_Credit 0.
        // "Split"        → manual UPI still outstanding → pStat = "Pending"
        // "Split (HDFC)" → HDFC portion already captured → pStat stays "Paid" (from body.payment_status)
        const requestedCredit = Math.min(splitWalletBudget, netTotal);
        if (requestedCredit > 0) {
          const currentBalance = _calculateWalletBalance(profile.phone, allWalletRows);
          const deduct = Math.min(requestedCredit, currentBalance);
          if (deduct > 0) {
            const _txnLabel = payMethod === "Split (HDFC)"
              ? "Order Deduction (Wallet Part — Gateway Split)"
              : "Order Deduction (Wallet Part)";
            _appendWalletTransaction(profile.phone || "", profile.name || "Customer", _txnLabel, deduct, true, sid);
            allWalletRows.push({ Phone: _normalizePhone(profile.phone), Txn_Type: "Order Deduction", Amount: deduct, Verified: "TRUE" });
            walletCreditUsed = deduct;
            splitWalletBudget -= deduct;
          }
        }
        if (payMethod === "Split") pStat = "Pending"; // manual UPI portion still outstanding
        // Split (HDFC): pStat stays as initialized from body.payment_status = "Paid"
      } else if (payMethod === "On Account") {
        pStat = "On Account";
      }

      // Self-heal Wallet_Credit column if it doesn't exist yet (no initSchema needed)
      if (walletCreditUsed > 0 && !hIdx["Wallet_Credit"]) {
        const newCol = ordersWs.getLastColumn() + 1;
        ordersWs.getRange(1, newCol).setValue("Wallet_Credit");
        SpreadsheetApp.flush();
        // Refresh hIdx so set() can find it
        Object.assign(hIdx, headerIndex(ordersWs));
      }

      set("Payment_Method",      payMethod);
      set("Payment_Status",      pStat);
      if (walletCreditUsed > 0) set("Wallet_Credit", walletCreditUsed);
      set("Payment_Freq",        payFreq);
      set("First_Time",          firstTime);
      set("Source",              "WebApp");

      // Fill individual item columns
      if (mealType === "Breakfast") {
        // Breakfast: dynamic items go to BF_Item_N/BF_Qty_N
        let bfSlot = 1;
        items.forEach(({colKey, qty}) => {
          if (bfSlot > 4) return;
          const displayName = (colKey === "B_CURD") ? "Curd" : resolveName(colKey);
          set(`BF_Item_${bfSlot}`, displayName);
          set(`BF_Qty_${bfSlot}`,  qty);
          bfSlot++;
        });
        // Curd goes to Curd column too
        const curdItem = items.find(x => x.colKey === "B_CURD");
        if (curdItem) set("Curd", curdItem.qty);
      } else {
        // Lunch/Dinner: map colKeys to named columns
        items.forEach(({colKey, qty}) => {
          const canonical = ITEM_COL_MAP[colKey] || colKey;
          // If canonical is still an ID, try masterMap
          const finalCol = (masterMap[canonical]) ? masterMap[canonical] : canonical;
          set(finalCol, qty);
        });
      }

      ordersWs.appendRow(row);
      newRowsWritten++;
      _missedOrderSafetyNet(ss, sid, row, profile.phone);  // safety net — verify write succeeded
    }
  }

  // Force all buffered Sheets writes to disk before returning success
  SpreadsheetApp.flush();

  // Verify every row we just wrote actually landed; auto-recover + email if not
  _verifyAndAlertMissedOrders(ss, submissionIds);

  // Upsert customer record
  _upsertCustomer(ss, profile);
  // Stamp Last_Order_At so the idle-customer archiver (05_Customer_Archive.gs)
  // never archives someone who just ordered.
  if (typeof updateCustomerLastOrder === "function") updateCustomerLastOrder(profile.phone);

  // If user requested to settle ALL pending dues in this same transaction
  if (body.settle_all && payMethod === "Wallet") {
    _settlePendingInternal(ss, profile.phone, profile.name || "Customer");
  }

  if (payFreq === "Prepaid Wallet" || payFreq.includes("10 days") || payFreq.includes("Wallet")) {
    try { _updateLedger(ss, profile, orders); } catch(e) { /* non-fatal */ }
  }

  // Sync final promoCount back to customer sheet
  if (cRowIdx !== -1 && cIdx["Review_Promo_Count"]) {
    // Pro transition: 0 -> "Exhausted"
    let finalValue = promoCount;
    if (finalValue === 0) finalValue = "Exhausted";
    else if (finalValue === null) finalValue = "";
    
    const realRow = cRowIdx + 2;
    custWs.getRange(realRow, cIdx["Review_Promo_Count"]).setValue(finalValue);
  }

  // If any meal's bill went below ₹0 (6th-day waiver overflow or retroactive
  // credits exceeding a small top-up), credit the surplus to wallet (server-computed)
  if (loyaltyExcessCredit > 0) {
    try {
      _appendWalletTransaction(
        profile.phone || "", profile.name || "Customer",
        "Bill Surplus Credit (discount/credit exceeded order value)",
        loyaltyExcessCredit, true, submissionIds[0] || ""
      );
    } catch(e) { /* non-fatal */ }
  }

  // Invalidate menu cache for all ordered dates so units_remaining is fresh on next getMenu call.
  // (Cache had 60s TTL — without this, customers would see stale stock counts after placing an order.)
  if (submissionDates.length) {
    _invalidateCache(...submissionDates.map(d => "menu_v2_" + d));
  }

  // HARD GUARD: never return an "empty success". If no meal was even processed
  // (empty/missing orders payload), that is an ERROR — the old behaviour
  // returned {success:true, submissionId:"", grand_total:0}, showing the
  // customer a success screen while NOTHING was written to the sheet.
  if (!submissionIds.length) {
    console.error("submitOrder received no valid order items — phone=" + phoneStr
      + " ordersLen=" + (orders ? orders.length : "n/a"));
    return { error: "No order items were received. Please refresh the page and try placing your order again." };
  }

  return {
    success: true,
    submissionId: submissionIds[0] || "",
    wallet_bonus: loyaltyExcessCredit,
    grand_total: grandNetTotal,
    rows_written: newRowsWritten,          // diagnosability: 0 = pure dedupe replay
    replayed: newRowsWritten === 0         // true → this exact order already existed (retry/double-tap)
  };
}


// ── UPSERT CUSTOMER ──────────────────────────────────────────
function _upsertCustomer(ss, profile) {
  // Ensure tab exists and headers are correct before doing anything
  const ws = getOrCreateTab(ss, TAB_CUSTOMERS, CUSTOMERS_HEADERS);
  SpreadsheetApp.flush(); // Lock in the headers before indexing

  const rows = getAllRows(ws);
  const pStr = _normalizePhone(profile.phone);
  const existing = rows.find(r => _normalizePhone(r.Phone) === pStr);
  
  const fullAddr = [
    profile.wing    && `Wing ${profile.wing}`,
    profile.flat    && `Flat ${profile.flat}`,
    profile.floor   && `${profile.floor} Floor`,
    profile.society, profile.area
  ].filter(Boolean).join(", ");

  if (existing) {
    const rowNum = existing._row;
    const hIdx = headerIndex(ws);
    const update = (col, val) => {
      // ONLY update if val is effectively provided (not undefined)
      if (hIdx[col] && val !== undefined) {
        ws.getRange(rowNum, hIdx[col]).setValue(val);
      }
    };
    if (profile.name !== undefined) update("Customer_Name", profile.name);
    if (profile.area !== undefined) update("Area",          profile.area);
    if (profile.wing !== undefined) update("Wing",          profile.wing);
    if (profile.flat !== undefined) update("Flat",          profile.flat);
    if (profile.floor !== undefined) update("Floor",         profile.floor);
    if (profile.society !== undefined) update("Society",       profile.society);
    if (profile.area !== undefined || profile.society !== undefined) update("Full_Address",  fullAddr);
    
    // Auto-derive Maps Link if missing
    let finalMaps = profile.maps || "";
    if (!finalMaps) {
      finalMaps = _deriveMapsLink(fullAddr, profile.society || "");
    }
    update("Maps_Link", finalMaps);

    if (profile.landmark !== undefined) update("Landmark",      profile.landmark || "");
    if (profile.delivery_point !== undefined) update("Delivery_Point", _getDeliveryPointLabel(profile.delivery_point));
    if (profile.payment_preference !== undefined) update("Payment_Freq",  profile.payment_preference);
    // SECURITY: never CHANGE an existing non-blank PIN via upsert. Only write
    // the PIN when the stored one is blank (new account / admin-cleared reset)
    // or identical (mid-flow re-save). Without this, setPin/upsertProfile let
    // anyone who knows a phone number overwrite the PIN and seize the account
    // (and its wallet). A real "change PIN knowing the old one" flow doesn't
    // exist in this app, so nothing legitimate is blocked.
    if (profile.pin) {
      const _storedPin = String(existing.PIN || "").trim();
      if (_storedPin === "" || _storedPin === String(profile.pin).trim()) {
        update("PIN", profile.pin);
      } else {
        console.warn("⚠️ PIN overwrite BLOCKED for " + pStr + " — existing PIN not replaced (takeover guard).");
      }
    }
    if (profile.meal_addresses) update("Meal_Addresses", profile.meal_addresses);
    if (profile.standardOrder !== undefined) update("Standard_Order", profile.standardOrder);
    if (profile.onAccount !== undefined) update("On_Account", profile.onAccount);
    if (profile.billingCycle !== undefined) update("Billing_Cycle", profile.billingCycle);
    
    SpreadsheetApp.flush(); // Ensure writes are committed
  } else {
    // For new records, construct a clean Row Array mapping directly to our schema
    const newRow = CUSTOMERS_HEADERS.map(h => {
      let val = "";
      switch(h) {
        case "Phone":           val = _normalizePhone(profile.phone); break;
        case "Customer_Name":   val = profile.name || ""; break;
        case "Area":            val = profile.area || ""; break;
        case "Wing":            val = profile.wing || ""; break;
        case "Flat":            val = profile.flat || ""; break;
        case "Floor":           val = profile.floor || ""; break;
        case "Society":         val = profile.society || ""; break;
        case "Full_Address":    val = fullAddr; break;
        case "Maps_Link":       val = profile.maps || _deriveMapsLink(fullAddr, profile.society || ""); break;
        case "Landmark":        val = profile.landmark || ""; break;
        case "Delivery_Point":  val = _getDeliveryPointLabel(profile.delivery_point); break;
        case "Payment_Freq":    val = profile.payment_preference || "Daily Payment"; break;
        case "Created_At":      val = getISTTimestamp(); break;
        case "PIN":             val = profile.pin || ""; break;
        case "Meal_Addresses":  val = profile.meal_addresses || ""; break;
        case "Standard_Order":  val = profile.standardOrder || ""; break;
        case "Billing_Cycle":   val = profile.billingCycle || "Daily"; break;
        case "On_Account":      val = profile.onAccount || "No"; break;
        case "Review_Promo_Count": val = ""; break;
        default:                val = "";
      }
      // Force leading zeros to be preserved for Phone and PIN by prepending '
      if (h === "Phone" || h === "PIN") return "'" + String(val).trim();
      return val;
    });
    
    // Safety check: Ensure we NEVER write to Row 1 (header row)
    const nextRow = Math.max(2, ws.getLastRow() + 1);
    ws.getRange(nextRow, 1, 1, newRow.length).setValues([newRow]);
  }
}

/**
 * ADMIN: Toggle On Account status for a customer
 */
function markOnAccount(phone, cycle, status) {
  const ss = getSpreadsheet();
  const phoneStr = _normalizePhone(phone);
  const profile = {
    phone: phoneStr,
    onAccount: status,
    billingCycle: cycle
  };
  _upsertCustomer(ss, profile);
  return { success: true, phone: phoneStr, status: status, cycle: cycle };
}

// ── GET CUSTOMER ORDERS ──────────────────────────────────────
// ── GET DAY TOTALS FOR DATES (used to compute combined-day fees) ─
// Returns existing meal subtotals per date for the given phone,
// excluding the current cart being built (which is not yet placed).
function getDayTotalsForDates(phone, datesParam, preloadedRows) {
  if (!phone || !datesParam) return { dayTotals: {} };
  const dates = String(datesParam).split(',').map(d => d.trim()).filter(Boolean);
  const ss = getSpreadsheet();
  const ws = getOrCreateTab(ss, TAB_ORDERS, ORDERS_HEADERS);
  // Allow caller to pass pre-fetched rows (submitOrder) so we don't re-hit the sheet.
  const rows = Array.isArray(preloadedRows) ? preloadedRows : getAllRows(ws);

  const result = {};
  dates.forEach(d => { result[d] = {}; });

  // Canonicalize target phone so +91/space/decimal/scientific variants all match.
  const targetPhone = _normalizePhone(phone);

  rows.filter(r => {
    // Always group by Order_Date column (never submission timestamp) — this is what
    // keeps bills for a single meal-day intact even if the customer hits "place order"
    // on either side of IST midnight.
    if (_normalizePhone(r.Phone) !== targetPhone) return false;
    if (_isOrderCancelled(r.Payment_Status)) return false;
    const rDate = r.Order_Date instanceof Date
      ? Utilities.formatDate(r.Order_Date, 'Asia/Kolkata', 'yyyy-MM-dd')
      : String(r.Order_Date).trim();
    return dates.includes(rDate);
  }).forEach(r => {
    const rDate = r.Order_Date instanceof Date
      ? Utilities.formatDate(r.Order_Date, 'Asia/Kolkata', 'yyyy-MM-dd')
      : String(r.Order_Date).trim();
    const meal = String(r.Meal_Type).trim();
    if (!result[rDate][meal]) result[rDate][meal] = { subtotal: 0, delivery_charged: 0, discount_applied: 0, small_fee_charged: 0, count: 0 };
    result[rDate][meal].subtotal       += Number(r.Food_Subtotal    || 0);
    result[rDate][meal].delivery_charged += Number(r.Delivery_Charge || 0);
    result[rDate][meal].discount_applied += Number(r.Discount_Amount || 0);
    result[rDate][meal].small_fee_charged += Number(r.Small_Order_Fee || 0);
    result[rDate][meal].count++;
  });

  return { dayTotals: result };
}

/**
 * Calculates current streak and accumulated surcharges for a customer.
 * Skips Sundays (kitchen closed).
 */
/**
 * Diagnostic — run from the Apps Script editor to see exactly what the
 * loyalty-streak calculator is seeing for a specific customer.
 *
 * Usage:
 *   In Code.gs editor, add at the bottom:
 *     function _runDiag() { diagnoseLoyaltyStreak("9930748908"); }
 *   Pick _runDiag from the function dropdown -> Run.
 *   Watch the Execution Log.
 *
 * Prints for each of the customer's recent past rows:
 *   date, meal, Food_Subtotal, Inflation_Surcharge stored, derived
 *   surcharge from food, Loyalty_Discount Y/N, Payment_Status.
 * Then summarises what _calculateLoyaltyStreak returns.
 */
function diagnoseLoyaltyStreak(phone) {
  if (!phone) { Logger.log("Pass a phone number"); return; }
  const ss = getSpreadsheet();
  const ws = getOrCreateTab(ss, TAB_ORDERS, ORDERS_HEADERS);
  const rows = getAllRows(ws);
  const phoneStr = _normalizePhone(phone);
  const todayISO = Utilities.formatDate(new Date(), "Asia/Kolkata", "yyyy-MM-dd");

  Logger.log("=== diagnoseLoyaltyStreak(" + phone + ") ===");
  Logger.log("Today (IST): " + todayISO);

  const mine = rows.filter(r => _normalizePhone(r.Phone) === phoneStr);
  Logger.log("Total rows for this customer: " + mine.length);

  // Sort by date descending so most recent appears first
  mine.sort((a, b) => {
    const da = a.Order_Date instanceof Date ? Utilities.formatDate(a.Order_Date,"Asia/Kolkata","yyyy-MM-dd") : String(a.Order_Date).trim();
    const db = b.Order_Date instanceof Date ? Utilities.formatDate(b.Order_Date,"Asia/Kolkata","yyyy-MM-dd") : String(b.Order_Date).trim();
    return db.localeCompare(da);
  });

  Logger.log("--- Last 15 rows (newest first) ---");
  mine.slice(0, 15).forEach((r, idx) => {
    const d = r.Order_Date instanceof Date ? Utilities.formatDate(r.Order_Date,"Asia/Kolkata","yyyy-MM-dd") : String(r.Order_Date).trim();
    const stored  = Number(r.Inflation_Surcharge);
    const derived = Math.floor((Number(r.Food_Subtotal) || 0) * 0.05);
    Logger.log("[" + (idx+1) + "] " + d + " " + r.Meal_Type
      + "  food=" + r.Food_Subtotal
      + "  storedSurch=" + (isNaN(stored) ? "(empty)" : stored)
      + "  derivedSurch=" + derived
      + "  effective=" + Math.max((Number(r.Inflation_Surcharge)||0), derived)
      + "  Loyalty=" + (r.Loyalty_Discount || "-")
      + "  net=" + r.Net_Total
      + "  status=" + (r.Payment_Status || "-")
      + "  sid=" + (r.Submission_ID || "-")
    );
  });

  // Run the actual calculator and log its verdict
  const result = _calculateLoyaltyStreak(phone, rows);
  Logger.log("--- _calculateLoyaltyStreak verdict ---");
  Logger.log(JSON.stringify(result));
  Logger.log("Expected next-order behaviour: is6thDay would be " + (result.streak === 5 ? "TRUE" : "FALSE"));
  Logger.log("If is6thDay TRUE: loyalty waiver = pastSurcharge(" + result.pastSurcharge + ") + today's surcharge");
  Logger.log("=== end ===");
}

/**
 * ONE-TIME MIGRATION: normalise every order's Inflation_Surcharge to the V2
 * accrual floor(Food_Subtotal × 5%). Old (v1) rows stored ceil(×6%); this rewrites
 * them so the loyalty accrual is consistent everywhere — the sheet, the frontend
 * (which sums the stored values), and the backend engine (which now derives 5%).
 *
 * SAFE: only touches the Inflation_Surcharge column. It does NOT re-charge anything
 * or change any Net_Total — only the per-row accrual used for the 6-day reward.
 * Idempotent (re-running leaves already-5% rows untouched).
 *
 * Run from the Apps Script editor:
 *   normalizeSurchargeTo5pct(true)    // PREVIEW — logs what would change, writes nothing
 *   normalizeSurchargeTo5pct(false)   // APPLY
 */
function normalizeSurchargeTo5pct(dryRun) {
  if (dryRun === undefined) dryRun = true;
  const ss = getSpreadsheet();
  const ws = getOrCreateTab(ss, TAB_ORDERS, ORDERS_HEADERS);
  const data = ws.getDataRange().getValues();
  if (data.length < 2) { Logger.log("No order rows."); return { changed: 0, same: 0, applied: false }; }

  const H = data[0];
  const cFood  = H.indexOf("Food_Subtotal");
  const cSurch = H.indexOf("Inflation_Surcharge");
  if (cFood === -1 || cSurch === -1) { Logger.log("Food_Subtotal / Inflation_Surcharge column not found."); return; }

  let changed = 0, same = 0;
  const updates = []; // [rowNumber, newValue]
  for (let i = 1; i < data.length; i++) {
    const food = Number(data[i][cFood]) || 0;
    if (food <= 0) continue;
    const cur  = Number(data[i][cSurch]) || 0;
    const want = Math.floor(food * 0.05);
    if (cur !== want) { changed++; updates.push([i + 1, want]); } else same++;
  }

  Logger.log("normalizeSurchargeTo5pct(dryRun=" + dryRun + "): " + changed + " rows to change, " + same + " already 5%.");
  if (dryRun) {
    updates.slice(0, 12).forEach(u => Logger.log("  row " + u[0] + "  →  " + u[1]));
    Logger.log("PREVIEW only — nothing written. Run normalizeSurchargeTo5pct(false) to apply.");
    return { changed: changed, same: same, applied: false };
  }
  updates.forEach(u => ws.getRange(u[0], cSurch + 1).setValue(u[1]));
  SpreadsheetApp.flush();
  Logger.log("APPLIED: " + changed + " rows rewritten to floor(food×5%).");
  return { changed: changed, same: same, applied: true };
}

// Returns a map { "yyyy-MM-dd": true } of all admin-marked kitchen-closed
// dates (Kitchen_Closed flag in SK_Daily_Menu). Used by the loyalty streak so
// a day the OWNER closed never counts as the customer breaking their streak.
function _kitchenClosedSet() {
  const data = _cachedData("kitchen_closed_set_v1", 60, function() {
    const ss = getSpreadsheet();
    const ws = getOrCreateTab(ss, TAB_MENU, []);
    const out = [];
    getAllRows(ws).forEach(function(r) {
      const isClosed = (r.Kitchen_Closed === true || String(r.Kitchen_Closed || "").toLowerCase() === "true");
      if (!isClosed) return;
      const d = r.Date instanceof Date ? Utilities.formatDate(r.Date, "Asia/Kolkata", "yyyy-MM-dd") : String(r.Date).trim();
      if (d) out.push(d);
    });
    return { dates: out };
  });
  const set = {};
  (data.dates || []).forEach(function(d) { set[d] = true; });
  return set;
}

function _calculateLoyaltyStreak(phone, preloadedRows) {
  if (!phone) return { streak: 0, pastSurcharge: 0 };
  const ss = getSpreadsheet();
  const ws = getOrCreateTab(ss, TAB_ORDERS, ORDERS_HEADERS);
  const rows = Array.isArray(preloadedRows) ? preloadedRows : getAllRows(ws);
  const phoneStr = _normalizePhone(phone);
  const todayISO = Utilities.formatDate(new Date(), "Asia/Kolkata", "yyyy-MM-dd");

  const dailyTotals  = {}; // date → total surcharge that day
  const rewardDays   = new Set(); // dates where Loyalty_Discount = "Yes"

  rows.forEach(r => {
    if (_normalizePhone(r.Phone) !== phoneStr) return;
    // Cancelled rows (soft or hard) must NOT contribute to streak count —
    // otherwise a user could cancel days 3/4 and still hit day-6 reward.
    if (_isOrderCancelled(r.Payment_Status)) return;
    const stat = String(r.Payment_Status || "").toLowerCase();
    if (stat.includes("deleted")) return;

    const d = r.Order_Date instanceof Date ? Utilities.formatDate(r.Order_Date, "Asia/Kolkata", "yyyy-MM-dd") : String(r.Order_Date).trim();

    // TODAY counts: an order already placed today is a real streak day. The
    // frontend bill builder counts it, so the backend must too — otherwise a
    // customer whose 5th day is today gets the 6th-day reward on the customer
    // bill (frontend) but not in the sheet (backend disagreement: row stored
    // with no discount and Loyalty_Discount="No"). Double-grant on a second
    // same-day submission is prevented by the rewardDays.has(today) check and
    // the same-day guard in submitOrder's projection loop.
    if (d > todayISO) return; // future dates — ignore

    if (!dailyTotals[d]) dailyTotals[d] = 0;
    // Hardened surcharge derivation: take the MAX of the stored
    // Inflation_Surcharge column and the food-derived value. Protects
    // against legacy rows / manual admin entries where the
    // Inflation_Surcharge column was empty (= 0) but Food_Subtotal
    // shows a real cart — without this, even one such bad row in the
    // 5-day streak history collapses pastSurcharge to 0 and the
    // customer ends up paying full price on their day-6 reward.
    const storedSurch  = Number(r.Inflation_Surcharge) || 0;
    // V2: accrual is floor(food × 5%) — MUST match submitOrder's stored accrual
    // (Math.floor, per d07e046). MAX with stored still protects legacy blank rows.
    // Run normalizeSurchargeTo5pct() once to rewrite old 6% stored values so MAX
    // never picks the higher legacy number.
    const derivedSurch = Math.floor((Number(r.Food_Subtotal) || 0) * 0.05);
    dailyTotals[d] += Math.max(storedSurch, derivedSurch);

    // Track days where the 6-day loyalty reward was already given
    if (String(r.Loyalty_Discount || "").trim().toLowerCase() === "yes") {
      rewardDays.add(d);
    }
  });

  let streakCount = 0;
  let accumulatedSurcharge = 0;
  let streakEndDate = null; // most-recent counted day = the streak's end (used for gap checks at submit time)

  const closedSet = _kitchenClosedSet(); // admin days-off — skipped like Sundays, never break the streak
  let d = new Date(); // start from TODAY — an already-placed order today is a streak day
  let walkingToday = true;
  let safety = 0;
  while (safety < 40) {
    safety++;
    const iso = Utilities.formatDate(d, "Asia/Kolkata", "yyyy-MM-dd");
    if (d.getDay() === 0 || closedSet[iso]) { // Skip Sunday OR admin-closed day — don't break streak
      d.setDate(d.getDate() - 1);
      walkingToday = false;
      continue;
    }
    if (dailyTotals[iso] !== undefined) {
      if (rewardDays.has(iso)) {
        // This day was a 6th-day reward day — it marks the END of the previous cycle.
        // Don't count it; the new cycle starts from the day after it.
        break;
      }
      streakCount++;
      if (!streakEndDate) streakEndDate = iso; // walking backward → first counted day is the most recent
      accumulatedSurcharge += dailyTotals[iso];
    } else if (!walkingToday) {
      break; // gap in ordering on a PAST day — streak broken ("no order yet today" is not a gap)
    }
    walkingToday = false;
    d.setDate(d.getDate() - 1);
  }

  // If today itself already received the loyalty reward (e.g. breakfast was submitted
  // first and marked Loyalty_Discount=Yes), treat it as a cycle already reset —
  // return streak=0 so any subsequent meal on the same day doesn't get a double reward.
  if (rewardDays.has(todayISO)) {
    return { streak: 0, pastSurcharge: 0, end: null };
  }

  // Anomaly logging — if the customer hit a full 5-day streak but the
  // accumulated surcharge came out unreasonably small (< streakCount,
  // meaning at least one past day contributed 0), log a warning so we
  // can audit the affected rows. The Math.max guard above protects the
  // common cases; this log surfaces any cases it can't fix.
  if (streakCount >= 5 && accumulatedSurcharge < streakCount) {
    console.warn("loyalty-streak anomaly — phone=" + phoneStr
      + " streak=" + streakCount
      + " accumulatedSurcharge=" + accumulatedSurcharge
      + " (suspiciously low — at least one past day contributed 0)."
      + " dailyTotals=" + JSON.stringify(dailyTotals));
  }

  return { streak: streakCount, pastSurcharge: accumulatedSurcharge, end: streakEndDate };
}

// ── VERIFY ORDER PLACED (timeout recovery) ───────────────────
// Called by the frontend after a network timeout to check if the order
// actually landed on the backend. Matches by phone + every date/meal combo
// in the cart, within a 10-minute recency window.
// Returns { found: true, submissionId } or { found: false }.
function verifyOrderPlaced(body) {
  const phone = _normalizePhone(String(body.phone || ""));
  if (!phone) return { found: false };

  // cart = [{date: "yyyy-MM-dd", meal: "Breakfast"|"Lunch"|"Dinner"}]
  // Derived from body.orders (same format as submitOrder)
  const orders = body.orders || [];
  const cartEntries = []; // [{date, meal}]
  for (const dateOrder of orders) {
    for (const meal of (dateOrder.meals || [])) {
      if ((Number(meal.subtotal) || 0) > 0) {
        cartEntries.push({ date: dateOrder.date, meal: meal.type });
      }
    }
  }
  if (!cartEntries.length) return { found: false };

  const ss  = getSpreadsheet();
  const ws  = getOrCreateTab(ss, TAB_ORDERS, []);
  const rows = getAllRows(ws);

  const nowMs     = Date.now();
  const TEN_MIN   = 10 * 60 * 1000;
  const normDate  = (d) => {
    if (!d) return "";
    if (d instanceof Date) return Utilities.formatDate(d, "Asia/Kolkata", "yyyy-MM-dd");
    return String(d).trim().substring(0, 10);
  };

  // Recent rows for this phone (last 10 min)
  const recent = rows.filter(r => {
    if (_normalizePhone(String(r.Phone || "")) !== phone) return false;
    const rMs = r.Submitted_At ? new Date(r.Submitted_At).getTime() : 0;
    return rMs > 0 && (nowMs - rMs) <= TEN_MIN;
  });

  if (!recent.length) return { found: false };

  // Every cart entry must have a matching recent row
  let firstId = null;
  for (const entry of cartEntries) {
    const match = recent.find(r =>
      normDate(r.Order_Date) === entry.date && r.Meal_Type === entry.meal
    );
    if (!match) return { found: false };
    if (!firstId) firstId = String(match.Submission_ID || "");
  }

  return firstId ? { found: true, submissionId: firstId } : { found: false };
}

function getCustomerOrders(phone) {
  if (!phone) return {orders:[], past_orders:[], wallet_balance: 0};
  const ss = getSpreadsheet();
  const ws = getOrCreateTab(ss, TAB_ORDERS, ORDERS_HEADERS);
  const rows = getAllRows(ws);
  const today = Utilities.formatDate(new Date(), "Asia/Kolkata", "yyyy-MM-dd");

  const fmtD = function(r) {
    return r.Order_Date instanceof Date
      ? Utilities.formatDate(r.Order_Date, "Asia/Kolkata", "yyyy-MM-dd")
      : String(r.Order_Date).trim();
  };

  const delWs = ss.getSheetByName("SK_Deliveries");
  const deliveryMap = {};
  if (delWs) {
    const delRows = getAllRows(delWs);
    delRows.forEach(d => {
      const sid = String(d.Submission_ID || "");
      if (sid) deliveryMap[sid] = {
        deliveredAt: d.Delivered_At || null,
        enRouteAt: d.EnRoute_At || null
      };
    });
  }

  const allFiltered = rows.filter(r => String(r.Phone).trim() === String(phone).trim());
  
  const upcoming = allFiltered
    .filter(r => fmtD(r) >= today)
    .sort((a,b) => fmtD(a).localeCompare(fmtD(b)))
    .map(r => {
      const delTracker = deliveryMap[String(r.Submission_ID)] || {};
      let itemsRaw = {};
      try { itemsRaw = JSON.parse(r.Items_JSON || "{}"); } catch(e) {}
      return {
        rowId:              r.Submission_ID,
        date:               fmtD(r),
        meal:               r.Meal_Type,
        summary:            _buildSummary(r),
        items_raw:          itemsRaw,
        total:              r.Net_Total,
        inflation_surcharge: Number(r.Inflation_Surcharge) || 0,
        loyalty_discount:   String(r.Loyalty_Discount || "").trim().toLowerCase() === "yes",
        payment_status:     r.Payment_Status,
        payment_method:     r.Payment_Method,
        wallet_credit:      Number(r.Wallet_Credit) || 0,
        deliveredAt:        delTracker.deliveredAt,
        enRouteAt:          delTracker.enRouteAt
      };
    });

  const past = allFiltered
    .filter(r => fmtD(r) < today)
    .sort((a,b) => fmtD(b).localeCompare(fmtD(a))) // newest first
    .slice(0, 10)
    .map(r => {
      const delTracker = deliveryMap[String(r.Submission_ID)] || {};
      // items_raw: structured {itemName: qty} for "Order Again" feature on frontend
      let itemsRaw = {};
      try { itemsRaw = JSON.parse(r.Items_JSON || "{}"); } catch(e) {}
      return {
        rowId:              r.Submission_ID,
        date:               fmtD(r),
        meal:               r.Meal_Type,
        summary:            _buildSummary(r),
        items_raw:          itemsRaw,
        total:              r.Net_Total,
        inflation_surcharge: Number(r.Inflation_Surcharge) || 0,
        loyalty_discount:   String(r.Loyalty_Discount || "").trim().toLowerCase() === "yes",
        payment_status:     r.Payment_Status,
        payment_method:     r.Payment_Method,
        wallet_credit:      Number(r.Wallet_Credit) || 0,
        deliveredAt:        delTracker.deliveredAt,
        enRouteAt:          delTracker.enRouteAt
      };
    });

  const onAccountBalance = allFiltered
    .filter(r => String(r.Payment_Status || "").toLowerCase() === "on account")
    .reduce((sum, r) => sum + (Number(r.Net_Total) || 0), 0);

  // ── Monthly spending summary ──────────────────────────────────
  // Compute current calendar month's total spend + order count.
  // Used by order.html to show "You spent ₹X in April across N orders".
  const nowIST = Utilities.formatDate(new Date(), "Asia/Kolkata", "yyyy-MM");
  let monthTotal = 0, monthCount = 0;
  allFiltered.forEach(r => {
    const d = fmtD(r);
    // Exclude cancelled orders from monthly spend summary
    if (d.startsWith(nowIST) && !_isOrderCancelled(r.Payment_Status)) {
      monthTotal += Number(r.Net_Total) || 0;
      monthCount++;
    }
  });
  const monthName = Utilities.formatDate(new Date(), "Asia/Kolkata", "MMMM");

  return {
    orders: upcoming,
    past_orders: past,
    wallet_balance: _calculateWalletBalance(phone),
    on_account_balance: onAccountBalance,
    // Today's effective (override-aware) cutoff hours so Manage Orders can
    // disable the Cancel button once a meal's cutoff has passed.
    today_cutoffs: _effectiveCutoffsForDate(today),
    month_summary: {
      month: monthName,
      total: monthTotal,
      count: monthCount
    }
  };
}

// Effective cancel/order cutoff HOURS (IST, since midnight) for a date —
// the admin's per-date override from SK_Daily_Menu if set, else the defaults.
function _effectiveCutoffsForDate(date) {
  var cutoffs = { Breakfast: 7, Lunch: 9, Dinner: 16.5 };
  try {
    var ss = getSpreadsheet();
    var ws = getOrCreateTab(ss, TAB_MENU, []);
    var rows = getAllRows(ws);
    for (var i = 0; i < rows.length; i++) {
      var d = rows[i].Date instanceof Date
        ? Utilities.formatDate(rows[i].Date, "Asia/Kolkata", "yyyy-MM-dd")
        : String(rows[i].Date).trim();
      if (d === date) {
        if (rows[i].Cutoff_Breakfast) cutoffs.Breakfast = Number(rows[i].Cutoff_Breakfast);
        if (rows[i].Cutoff_Lunch)     cutoffs.Lunch     = Number(rows[i].Cutoff_Lunch);
        if (rows[i].Cutoff_Dinner)    cutoffs.Dinner    = Number(rows[i].Cutoff_Dinner);
        break;
      }
    }
  } catch (e) {}
  return cutoffs;
}

function _buildSummary(r) {
  try {
    const obj = JSON.parse(r.Items_JSON || "{}");
    return Object.entries(obj)
      .filter(([,q]) => q > 0)
      .map(([n,q]) => `${q}×${n}`)
      .join(", ") || "—";
  } catch(e) { return "—"; }
}

// ── DELETE ORDER (with Refund Logic) ─────────────────────────
function deleteOrder(phone, rowId, refundType, opts) {
  // ─── CONCURRENCY GUARD ─────────────────────────────────────────────
  // Prevents parallel deletes (double-clicks, retries) from both finding
  // the same row, both appending refunds, and both calling deleteRow on
  // shifted indices. Without this, the second call deleted the wrong row.
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(15000);
  } catch (e) {
    return { success: false, error: "System busy. Please try again in a moment." };
  }
  try {
    return _deleteOrderInternal(phone, rowId, refundType, opts);
  } catch (e) {
    // Top-level safety net so transient Drive/Sheets errors don't surface
    // as raw "Service error: Drive" to the user. Logged for diagnosis.
    console.error(`deleteOrder failed for rowId=${rowId} phone=${phone}: ${e && e.message}\n${e && e.stack}`);
    return {
      success: false,
      error: "Could not cancel right now (a Google service blip). Please try again in a few seconds."
    };
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

function _deleteOrderInternal(phone, rowId, refundType, opts) {
  opts = opts || {};
  const isAdminCall = !!opts.isAdmin;
  const ss = getSpreadsheet();
  const ws = getOrCreateTab(ss, TAB_ORDERS, ORDERS_HEADERS);
  const rows = getAllRows(ws);
  const now = getISTDate();
  let msg = "Order deleted successfully";
  const today = Utilities.formatDate(now, "Asia/Kolkata", "yyyy-MM-dd");
  const hourIST = now.getHours() + now.getMinutes() / 60;
  const CUTOFFS = { Breakfast: 7, Lunch: 9, Dinner: 16.5 };

  // ── Ownership guard ──────────────────────────────────────────
  // Customers: must pass BOTH the exact Submission_ID and the matching phone.
  // Admin: can delete by Submission_ID alone (phone not required).
  // Submission_ID is compared as a full exact string (case-insensitive) to
  // prevent the old "digits-only" collision bug where SK-20250101-XYZ and
  // SK-20250101-ABC both reduced to "20250101".
  const targetId = String(rowId || "").trim().toUpperCase();
  if (!targetId) {
    return { success: false, error: "Missing order identifier." };
  }
  const normTargetPhone = _normalizePhone(phone);

  const r = rows.find(x => {
    const sheetId = String(x.Submission_ID || "").trim().toUpperCase();
    if (sheetId !== targetId) return false;
    if (isAdminCall) return true; // Admin bypass — PIN already verified
    // Customer must also match phone
    return _normalizePhone(x.Phone) === normTargetPhone;
  });
  if (!r) {
    console.error(`CANCELLATION FAILED: Submission ID "${rowId}" not found or phone mismatch for ${phone} (admin=${isAdminCall}).`);
    return {success: false, error: "Order record not found or you do not have permission to cancel it."};
  }
  // ── ALREADY CANCELLED GUARD ────────────────────────────────────────
  // Row is kept forever now. Prevent double-cancellation attempts.
  if (_isOrderCancelled(r.Payment_Status)) {
    return { success: false, error: "This order has already been cancelled." };
  }
  const orderDateStr = r.Order_Date instanceof Date
    ? Utilities.formatDate(r.Order_Date, "Asia/Kolkata", "yyyy-MM-dd")
    : String(r.Order_Date).trim();
  if (orderDateStr < today) return {success: false, error: "Cannot delete past orders"};

  // Block deletion if cutoff has passed for today's orders
  // Normalize meal type — strip whitespace + title-case — to avoid silent skip when value is " breakfast" or "BREAKFAST"
  const mealNorm = String(r.Meal_Type || "").trim().toLowerCase();
  const mealKey  = mealNorm.charAt(0).toUpperCase() + mealNorm.slice(1);
  if (orderDateStr === today) {
    // Use the latest (override-aware) cutoff for this date, not a stale default.
    const effCutoffs = _effectiveCutoffsForDate(orderDateStr);
    const cutoffHour = effCutoffs[mealKey];
    if (cutoffHour !== undefined && hourIST >= cutoffHour) {
      return {success: false, error: `Cutoff for ${mealKey} has already passed`};
    }
  }

  // ─── IDEMPOTENCY / RECOVERY GUARD ─────────────────────────────────
  // If a pending refund already exists for this Submission_ID, DON'T add
  // another, but DO finish the cancellation by deleting the order row.
  // (Previous attempt may have written the refund then failed before delete.)
  let existingPendingRefund = null;
  try {
    const refundsWs = ss.getSheetByName(TAB_REFUNDS);
    if (refundsWs && refundsWs.getLastRow() > 1) {
      const refRows = getAllRows(refundsWs);
      existingPendingRefund = refRows.find(rf => {
        const rfId = String(rf.Submission_ID || "").trim().toUpperCase();
        const rfStat = String(rf.Status || "").trim().toLowerCase();
        return rfId === targetId && rfStat === "pending";
      }) || null;
    }
  } catch (e) { /* non-fatal */ }

  if (existingPendingRefund) {
    // Recovery path: refund row already exists, just ensure order row is marked cancelled.
    try {
      const hIdxR = headerIndex(ws);
      const statusColR = hIdxR["Payment_Status"] || hIdxR["Payment Status"];
      if (statusColR && !_isOrderCancelled(r.Payment_Status)) {
        ws.getRange(r._row, statusColR).setValue("Cancelled \u2013 UPI Refund Pending");
      }
    } catch (e) { /* non-fatal */ }
    return {
      success: true,
      message: "Cancellation completed. Your refund was already in the queue and will be processed within 1-2 days."
    };
  }

  // ── RESTORE REVIEW-PROMO USE ───────────────────────────────────────────
  // If this order consumed a 10% review-promo meal, give the use back —
  // cancelling shouldn't permanently burn the reward. ("Exhausted"/blank
  // counts read as 0, so restoring from an empty state yields 1.)
  if (!opts.dryRun && (Number(r.Review_Discount) || 0) > 0) {
    try {
      const custWsP = getOrCreateTab(ss, TAB_CUSTOMERS, CUSTOMERS_HEADERS);
      const cIdxP   = headerIndex(custWsP);
      if (cIdxP["Review_Promo_Count"]) {
        const ownPhone = _normalizePhone(r.Phone);
        const cP = getAllRows(custWsP).find(x => _normalizePhone(x.Phone) === ownPhone);
        if (cP) {
          const curRaw = cP.Review_Promo_Count;
          const cur = (curRaw === "" || curRaw === null || curRaw === undefined || isNaN(curRaw)) ? 0 : Number(curRaw);
          custWsP.getRange(cP._row, cIdxP["Review_Promo_Count"]).setValue(cur + 1);
        }
      }
    } catch(e) { /* non-fatal */ }
  }

  // GRACEFUL REFUND HANDLING with eligibility recalculation (Cases 1/2/3)
  const pStatStr = String(r.Payment_Status).toLowerCase();
  const isOnAccountOrder = pStatStr === "on account";
  let finalType = refundType; // Declare here so it is accessible at the end of the function for the soft-cancel remark.

  if (pStatStr === "paid" || pStatStr === "wallet paid" || isOnAccountOrder) {
    const custName = r.Customer_Name || "Customer";
    const ordersWs2 = ws; // same sheet
    const hIdx = headerIndex(ws); // needed for updating remaining rows
    const deleteDate = orderDateStr;
    const deleteMeal = String(r.Meal_Type).trim();

    // Get all ACTIVE orders for this phone+date (excluding the one being deleted
    // and any already-cancelled rows — those must not inflate day totals).
    const sameDayRows = rows.filter(x =>
      String(x.Phone).trim() === String(phone).trim() &&
      !_isOrderCancelled(x.Payment_Status) &&
      (() => {
        const xd = x.Order_Date instanceof Date
          ? Utilities.formatDate(x.Order_Date, 'Asia/Kolkata', 'yyyy-MM-dd')
          : String(x.Order_Date).trim();
        return xd === deleteDate && String(x.Submission_ID) !== String(rowId);
      })()
    );

    // Calc remaining day subtotal (food only) after deletion
    const remainingDaySubtotal = sameDayRows.reduce((s, x) => s + (Number(x.Food_Subtotal) || 0), 0);
    // Calc old day subtotal (including deleted row)
    const oldDaySubtotal = remainingDaySubtotal + (Number(r.Food_Subtotal) || 0);

    // ── BULK cancellation (commitment-discount clawback, PER MEAL) ──────────
    // A bulk row's 5% bulk discount is a commitment, scoped PER MEAL TYPE: lunch and
    // dinner are independent week-commitments. Cancelling a LUNCH day breaks only the
    // lunch streak, so it forfeits the whole LUNCH bulk discount (on the first lunch
    // cancellation) and leaves dinner's discount intact — and vice versa. Per row:
    // fullPrice = Net_Total + Bulk_Clawback (bulk removed, day-tier + fees KEPT). The
    // clawback is applied greedily against THAT MEAL's pool, so an odd first day carries
    // the remainder to the next cancel of the same meal. Cancelling all of one meal
    // refunds exactly what was paid for it; the other meal is unaffected.
    // Bulk skips ALL the same-day / loyalty adjustment blocks below (gated on !isBulk).
    const isBulk = !!(String(r.Source || "").trim() === "Bulk" || String(r.Batch_ID || "").trim());
    let bulkFullPrice = 0, bulkClawbackApplied = 0;
    if (isBulk) {
      const _rBatch = String(r.Batch_ID || "").trim();
      const _rMeal  = String(r.Meal_Type || "").trim(); // pool is per meal type, not whole batch
      const _fp = (x) => (Number(x.Net_Total) || 0) + (Number(x.Bulk_Clawback) || 0);
      const _poolRows = rows.filter(x => _rBatch && String(x.Batch_ID || "").trim() === _rBatch && String(x.Meal_Type || "").trim() === _rMeal);
      const _totalBulk = _poolRows.reduce((s, x) => s + (Number(x.Bulk_Clawback) || 0), 0);
      const _sumBefore = _poolRows
        .filter(x => String(x.Submission_ID) !== String(rowId) && _isOrderCancelled(x.Payment_Status))
        .reduce((s, x) => s + _fp(x), 0);
      bulkFullPrice = _fp(r);
      bulkClawbackApplied = Math.min(_totalBulk, _sumBefore + bulkFullPrice) - Math.min(_totalBulk, _sumBefore);
    }

    // Over-discount claw-back: only claw back discounts that were ACTUALLY applied
    // to remaining orders (read from their Discount_Amount column), not a theoretical
    // volume tier. submitOrder only applies loyalty (6th-day) discounts, not volume tiers.
    let overDiscount = 0;
    {
      const discColIdx = hIdx["Discount_Amount"];
      const netColIdx  = hIdx["Net_Total"];

      // Sum of discounts actually applied to remaining rows
      const totalActualDiscount = sameDayRows.reduce((s, x) => s + (Number(x.Discount_Amount) || 0), 0);

      if (!isBulk && totalActualDiscount > 0) {
        // Re-compute what discount the remaining orders SHOULD get after deletion.
        // We use their total food subtotal and compare to what was actually given.
        // For now: if the deleted order was the "trigger" for the day's loyalty discount,
        // the remaining orders should have 0 discount (they didn't earn it alone).
        // Claw back = (actual given) − (what they deserve now).
        // Conservative: only claw back if none of the remaining rows have Loyalty_Discount=Yes.
        const remainingHasLoyalty = sameDayRows.some(x =>
          String(x.Loyalty_Discount || "").trim().toLowerCase() === "yes"
        );

        if (!remainingHasLoyalty) {
          // No loyalty day in remaining rows — the deleted row was the discount trigger.
          // Claw back all discounts from remaining rows.
          overDiscount = totalActualDiscount;

          // Update remaining rows: zero out their Discount_Amount and restore Net_Total
          // (sheet writes only on a REAL cancellation — the dry-run preview must not mutate)
          if (overDiscount > 0 && discColIdx && netColIdx && !opts.dryRun) {
            sameDayRows.forEach(x => {
              const xSub      = Number(x.Food_Subtotal)       || 0;
              const xSurcharge= Number(x.Inflation_Surcharge) || 0;
              const xDelivery = Number(x.Delivery_Charge)     || 0;
              const xSmallFee = Number(x.Small_Order_Fee)     || 0;
              const xReviewD  = Number(x.Review_Discount)     || 0;
              const newNetTotal = xSub + xDelivery + xSmallFee + xSurcharge - xReviewD; // discount = 0
              ws.getRange(x._row, discColIdx).setValue(0);
              ws.getRange(x._row, netColIdx) .setValue(newNetTotal);
            });
          }
        }
      }
    }

    // Delivery & Fee eligibility for remaining same-day orders.
    // Mirrors submitOrder's DYNAMIC threshold (1 meal → ₹100, 2+ meals → ₹150):
    // the day WAS free under its old meal-count threshold but the REMAINING
    // orders no longer qualify under theirs → fees are owed.
    const _mealsIn = (rowsArr) => new Set(
      rowsArr.filter(x => (Number(x.Food_Subtotal) || 0) > 0)
             .map(x => String(x.Meal_Type).trim())
    ).size;
    const oldThreshold = _mealsIn(sameDayRows.concat([r])) <= 1 ? 100 : 150;
    const remThreshold = _mealsIn(sameDayRows) <= 1 ? 100 : 150;
    const freeAreaNames2 = getAreas().filter(a => a.free).map(a => a.name);
    const isNonFree = (area) => !freeAreaNames2.includes(area) && area !== "Self Pickup";

    let deliveryOwed = 0;
    let smallFeeOwed = 0;

    if (!isBulk && oldDaySubtotal >= oldThreshold && remainingDaySubtotal < remThreshold) {
      // Day total drops below free-delivery threshold → remaining orders now owe fees.
      // We claw the amounts from THIS refund, AND update those rows in the sheet so that
      // if they are later cancelled themselves, the clawback doesn't fire a second time.
      const delivColIdx   = hIdx["Delivery_Charge"];
      const smallFeeColIdx = hIdx["Small_Order_Fee"];
      const netColIdx2    = hIdx["Net_Total"];

      sameDayRows.forEach(x => {
        const xArea = x.Area || "";
        const xSub  = Number(x.Food_Subtotal) || 0;
        let netDelta = 0;

        // 1. Delivery Clawback: order was in non-free area but charged ₹0 due to threshold
        // Delivery is ₹11 everywhere — refund deduction, row Delivery_Charge and
        // Net_Total bump must all use the same figure (was 11/10/10: ₹1 hole).
        if (xSub > 0 && isNonFree(xArea) && (Number(x.Delivery_Charge) || 0) === 0) {
          deliveryOwed += 11;
          netDelta += 11;
          if (delivColIdx && !opts.dryRun) ws.getRange(x._row, delivColIdx).setValue(11);
        }

        // 2. Small Order Fee Clawback: Lunch/Dinner sub < ₹53 was waived due to threshold
        const xMeal = String(x.Meal_Type).trim();
        if ((xMeal === "Lunch" || xMeal === "Dinner") && xSub > 0 && xSub < (PRICING_V2 ? 53 : 50)
            && (Number(x.Small_Order_Fee) || 0) === 0) {
          smallFeeOwed += 11;
          netDelta += 11;
          if (smallFeeColIdx && !opts.dryRun) ws.getRange(x._row, smallFeeColIdx).setValue(11);
        }

        // Update Net_Total on remaining row to reflect newly owed fees (prevents double-clawback)
        // (sheet writes only on a REAL cancellation — the dry-run preview must not mutate)
        if (netDelta > 0 && netColIdx2 && !opts.dryRun) {
          ws.getRange(x._row, netColIdx2).setValue((Number(x.Net_Total) || 0) + netDelta);
        }
      });
    }

    // Loyalty Clawback Logic
    // If deleting an order breaks a streak that received a reward on a later date.
    // Admin cancellations are EXEMPT — streak is not penalised when kitchen cancels.
    let loyaltyClawback = 0;
    let loyaltyClawbackNote = "";
    const phoneStr = _normalizePhone(phone);

    if (!isAdminCall && !isBulk) {
      // Scan for a later streak-reward order that this cancellation would invalidate.
      const laterPayoffs = rows.filter(x => {
        if (String(x.Submission_ID) === String(rowId)) return false;
        if (_normalizePhone(x.Phone) !== phoneStr) return false;
        const xStat = String(x.Payment_Status || "").toLowerCase();
        if (xStat.includes("cancelled") || xStat.includes("deleted")) return false;
        if (String(x.Loyalty_Discount || "").trim().toLowerCase() !== "yes") return false;
        const xDate = x.Order_Date instanceof Date
          ? Utilities.formatDate(x.Order_Date, "Asia/Kolkata", "yyyy-MM-dd")
          : String(x.Order_Date).trim();
        return xDate >= orderDateStr; // payoff on or after the cancelled order's date
      });

      if (laterPayoffs.length > 0) {
        loyaltyClawback = Number(laterPayoffs[0].Discount_Amount) || 0;
        loyaltyClawbackNote = `Loyalty reward of ₹${loyaltyClawback} was applied on ${
          (() => { const d = laterPayoffs[0].Order_Date; return d instanceof Date ? Utilities.formatDate(d,"Asia/Kolkata","dd MMM") : String(d); })()
        } — cancelling this order breaks your streak, so that reward is reversed.`;

        // On a REAL cancellation, mark the reward as RECOVERED on the payoff row:
        // zero its Discount_Amount and add the amount back to its Net_Total. This
        // prevents (a) cancelling a second streak day clawing the same reward
        // again, and (b) a later cancellation of the payoff row itself refunding
        // its discounted Net even though the reward was already recovered here.
        // Loyalty_Discount stays "Yes" — the streak cycle was still consumed.
        if (!opts.dryRun && loyaltyClawback > 0) {
          const payoffRow = laterPayoffs[0];
          const discColL = hIdx["Discount_Amount"];
          const netColL  = hIdx["Net_Total"];
          if (discColL && netColL) {
            ws.getRange(payoffRow._row, discColL).setValue(0);
            ws.getRange(payoffRow._row, netColL).setValue((Number(payoffRow.Net_Total) || 0) + loyaltyClawback);
          }
        }
      }
    }

    // Refund = Net_Total − adjustment
    // Net_Total already correctly encodes: food + delivery + fees + surcharge − discount − mealCredit − reviewDiscount
    // Bulk uses the commitment-discount clawback (fullPrice − bulk clawback); regular
    // orders use Net_Total − same-day/loyalty adjustments.
    const adjustment = isBulk ? bulkClawbackApplied : (overDiscount + deliveryOwed + smallFeeOwed + loyaltyClawback);
    const rawRefund  = isBulk ? bulkFullPrice : (Number(r.Net_Total) || 0);
    const netRefund = rawRefund - adjustment;           // may be negative
    const refundAmt = Math.max(0, netRefund);           // amount actually returned
    const cancellationCharge = Math.max(0, -netRefund); // deficit charged to wallet if order < clawback

    // ── HUMAN-READABLE REFUND BREAKDOWN ────────────────────────────────────
    function buildRefundBreakdown() {
      const lines = [];
      if (isBulk) {
        if (bulkClawbackApplied > 0) {
          lines.push(`This was a bulk order — the bulk discount on this meal is deducted from your refund.`);
          lines.push(`Full price ₹${bulkFullPrice} − ₹${bulkClawbackApplied} bulk discount = ₹${refundAmt} refund.`);
        } else {
          lines.push(`Full refund of ₹${refundAmt} (the bulk discount was already recovered on an earlier cancellation in this order).`);
        }
        return lines.join("\n");
      }
      if (adjustment === 0) {
        lines.push(`Full refund of ₹${refundAmt}.`);
        return lines.join("\n");
      }
      lines.push(`Order total: ₹${rawRefund}`);
      lines.push(`Deductions (₹${adjustment} total):`);
      if (overDiscount > 0) {
        lines.push(`  • -₹${overDiscount} — discount reversal: a loyalty discount applied to your other order(s) on this day is reversed since it was earned as part of this streak order.`);
      }
      if (deliveryOwed > 0) {
        const numOrders = deliveryOwed / 11;
        lines.push(`  • -₹${deliveryOwed} — delivery fee: your remaining ${numOrders > 1 ? numOrders + " orders" : "order"} had free delivery because the day total met the free-delivery threshold. It now drops below ₹${remThreshold}, so ₹11 delivery applies.`);
      }
      if (smallFeeOwed > 0) {
        lines.push(`  • -₹${smallFeeOwed} — small cart fee: a remaining order under ₹53 had its ₹11 small cart fee waived (day total met the threshold). Now that drops below ₹${remThreshold}, the fee applies.`);
      }
      if (loyaltyClawback > 0) {
        lines.push(`  • -₹${loyaltyClawback} — loyalty reward reversal: ${loyaltyClawbackNote}`);
      }
      if (cancellationCharge > 0) {
        lines.push(`Refund: ₹${rawRefund} − ₹${adjustment} = -₹${cancellationCharge}`);
        lines.push(`Since the deduction (₹${adjustment}) exceeds your order amount (₹${rawRefund}), ₹${cancellationCharge} has been charged to your Svaadh Wallet. This will be deducted from your next order.`);
      } else {
        lines.push(`Refund: ₹${rawRefund} − ₹${adjustment} = ₹${refundAmt}`);
      }
      return lines.join("\n");
    }

    // ── DRY RUN: return breakdown without making any changes ─────────────────
    if (opts.dryRun) {
      return {
        success:            true,
        dryRun:             true,
        refundAmt:          refundAmt,
        adjustment:         adjustment,
        cancellationCharge: cancellationCharge,
        breakdownText:      buildRefundBreakdown()
      };
    }

    // Multi-Payment Logic: If any OTHER order for this meal/date is Wallet Paid,
    // force this refund to Wallet too (to keep the day's bookkeeping simple).
    const hasAnyOtherWalletPaid = sameDayRows.some(x => {
      const typeMatch = String(x.Meal_Type).trim() === deleteMeal;
      const statusMatch = String(x.Payment_Status).toLowerCase() === "wallet paid";
      return typeMatch && statusMatch;
    });

    finalType = refundType;
    let msgSuffix = "";

    // Auto-detect wallet refund if current was wallet paid, overriding passed type
    const currentWasWallet = (pStatStr === "wallet paid");
    const currentWasSplit  = (String(r.Payment_Method || "").trim().toLowerCase() === "split");
    if (isOnAccountOrder) {
      // On Account: no cash was collected — mark row as cancelled.
      // Remaining rows already updated above (discount/delivery recalculation).
      // On-account balance auto-corrects since it's derived from live sheet rows.
      msg = "Order removed from your On Account balance.";
      finalType = "__on_account_handled__"; // skip all refund payout logic
    } else if (currentWasWallet) {
      finalType = "wallet";
    } else if (currentWasSplit) {
      // Split orders: entire refund always goes to Wallet — wallet + UPI portions both back to wallet.
      if (refundAmt > 0) {
        _appendWalletTransaction(phone, custName, "Order Cancellation Refund", refundAmt, true, String(rowId));
      }
      msg = buildRefundBreakdown() + `\n\n₹${refundAmt} refunded to your Wallet.`;
      finalType = "__split_handled__"; // skip normal logic below
    } else if (hasAnyOtherWalletPaid && refundType === "manual_upi") {
      finalType = "wallet";
      msgSuffix = "\n(Consolidated to Wallet since other items in this meal were Wallet Paid.)";
    }

    // If cancellation charge > 0 (loyalty clawback exceeded the order value):
    // debit the deficit from the wallet — it'll show as a negative balance
    // that gets collected on the customer's next order.
    if (cancellationCharge > 0) {
      // Store a POSITIVE magnitude — the sign comes from classification, like
      // every other wallet txn. Type is anchored as "Order ... Charge" so the
      // balance calc treats it as a DEBIT (was stored negative AND classified
      // debit → balance -= (−x) = balance += x, i.e. the charge CREDITED the
      // customer instead of recovering the deficit).
      _appendWalletTransaction(phone, custName,
        `Order Cancellation Charge (streak reward reversal — the ₹${loyaltyClawback} reward earned via this order is reversed since cancelling it breaks your streak, so ₹${cancellationCharge} is recovered here.)`,
        cancellationCharge, true, String(rowId));
    }

    if (finalType === "wallet") {
      if (refundAmt > 0) {
        _appendWalletTransaction(phone, custName, "Order Cancellation Refund", refundAmt, true, String(rowId));
      }
      const walletLine = cancellationCharge > 0
        ? `₹0 refunded — ₹${cancellationCharge} charged to your Wallet (will be collected on your next order).`
        : `₹${refundAmt} refunded to your Wallet.${msgSuffix}`;
      msg = buildRefundBreakdown() + `\n\n` + walletLine;
    }
    else if (finalType === "manual_upi") {
      const REF_HEADERS = ["Submission_ID","Phone","Name","Amount","Meal","Date","Status","Timestamp","Adjustment_Note","Refund_Mode"];
      const refWs = getOrCreateTab(ss, TAB_REFUNDS, REF_HEADERS);
      const note = adjustment > 0
        ? (isBulk
            ? `Bulk discount clawback -₹${adjustment} (batch ${String(r.Batch_ID || "").trim()})`
            : `Adjusted -₹${adjustment} (overDiscount:${overDiscount}, deliveryOwed:${deliveryOwed}, smallFeeOwed:${smallFeeOwed}, loyaltyClawback:${loyaltyClawback})`)
        : "";

      // Gateway-paid order → fire the HDFC auto-refund (money back to the original
      // payment method). On ANY error, fall back to the manual UPI queue so a refund
      // is never lost. The REFUND_SUCCEEDED webhook later flips the row to "Refunded"
      // via _hdfcMarkRefundSettled (matches Refund_Mode="gateway" + the gateway order
      // id in the note). hdfc_initiateRefund's unique_request_id makes it idempotent.
      const _gwOrderId = String(r.Gateway_Order_ID || "").trim();
      // Match ANY gateway method — the webhook rewrites "Gateway (HDFC)" to the actual
      // instrument used, e.g. "Gateway (UPI)" / "Gateway (Card)". An exact "Gateway
      // (HDFC)" check would miss those and wrongly fall back to a manual refund.
      // Match any gateway-processed payment: methods starting with "Gateway" (e.g. "Gateway (HDFC)",
      // "Gateway (UPI)", "Gateway (Card)" — rewritten by hdfc_markOrderPaid) OR "Split (HDFC)"
      // (wallet + HDFC gateway split). Both carry a Gateway_Order_ID and qualify for auto-refund.
      const _isGatewayPaid = !!_gwOrderId && (
        String(r.Payment_Method || "").trim().indexOf("Gateway") !== -1 ||  // "Gateway (HDFC/UPI/Card)" AND "Bulk (Gateway)"
        String(r.Payment_Method || "").trim() === "Split (HDFC)"
      );
      let _autoRefundOk = false, _autoRefundErr = "";
      if (_isGatewayPaid && refundAmt > 0 && typeof hdfc_initiateRefund === "function") {
        try {
          // unique_request_id MUST be "RF" + Submission_ID — that's exactly what
          // reconcilePendingRefunds reconstructs to match this row against the
          // gateway's refunds block (the Order-Status polling backstop). It's also
          // stable per row → idempotent (a re-cancel hits HDFC's duplicate guard).
          const _reqId = ("RF" + rowId).replace(/[^A-Za-z0-9]/g, "").slice(0, 20);
          const _rf = hdfc_initiateRefund(_gwOrderId, refundAmt, _reqId);
          if (_rf && _rf.success) {
            _autoRefundOk = true;
            // Status "Processing" (NOT "Pending") so reconcilePendingRefunds picks it
            // up; the ORDER_REFUNDED webhook also flips it to "Refunded" in real time.
            refWs.appendRow([rowId, phone, custName, refundAmt, r.Meal_Type, orderDateStr, "Processing", now,
              (note ? note + " | " : "") + "Auto-refund HDFC " + _gwOrderId + " req=" + _reqId, "gateway"]);
          } else {
            _autoRefundErr = (_rf && _rf.error) || "unknown";
            console.warn("Auto-refund failed (" + _gwOrderId + "): " + _autoRefundErr + " — queuing manual UPI.");
          }
        } catch (e) {
          _autoRefundErr = e.message;
          console.warn("Auto-refund exception (" + _gwOrderId + "): " + e.message + " — queuing manual UPI.");
        }
      }
      if (!_autoRefundOk) {
        // A gateway-paid order that couldn't auto-refund (e.g. HDFC refund access not yet
        // enabled) is tagged "auto-refund FAILED" + its gateway id, so retryQueuedRefunds()
        // can re-attempt it in bulk once HDFC enables refunds. Genuinely-manual (non-gateway)
        // refunds keep the plain note.
        const _fbNote = _isGatewayPaid
          ? ((note ? note + " | " : "") + "auto-refund FAILED (" + (_autoRefundErr || "no gateway refund access") + ") HDFC " + _gwOrderId)
          : note;
        refWs.appendRow([rowId, phone, custName, refundAmt, r.Meal_Type, orderDateStr, "Pending", now, _fbNote, "upi"]);
      }

      const upiLine = cancellationCharge > 0
        ? `₹0 refunded via UPI — ₹${cancellationCharge} charged to your Wallet (will be collected on your next order).`
        : (_autoRefundOk
            ? `₹${refundAmt} refund has been initiated to your original payment method — it usually arrives within 3-5 working days.`
            : `₹${refundAmt} refund request raised — we'll process it within 1-2 days.`);
      msg = buildRefundBreakdown() + `\n\n` + upiLine;
    }
  } 
  // ── SOFT CANCELLATION FOR UPI / SPLIT ──────────────────────────────────────
  // "Pending" means customer has ALREADY paid (UPI screenshot sent) but admin hasn't verified yet.
  // For Split orders, "Pending" = wallet was deducted AND UPI payment was sent — must soft-cancel just like UPI.
  // Admin will verify and then "Verify & Refund" triggers the split refund logic in markOrdersStatus.
  if (String(r.Payment_Status || "").toLowerCase().includes("pending") && (refundType === "wallet" || refundType === "manual_upi")) {
    let hIdx = headerIndex(ws);
    
    // Robust header detection (support both underscores and spaces)
    const statusCol = hIdx["Payment_Status"] || hIdx["Payment Status"];
    
    if (!hIdx["Refund_Preference"]) {
      const col = ws.getLastColumn() + 1;
      ws.getRange(1, col).setValue("Refund_Preference")
        .setFontWeight("bold").setBackground("#c0392b").setFontColor("white");
      hIdx = headerIndex(ws);
    }
    const prefCol = hIdx["Refund_Preference"];
    
    if (statusCol && prefCol) {
      ws.getRange(r._row, statusCol).setValue("Cancelled (Verify UPI)");
      // Split orders: refund preference is always wallet (full amount back to wallet)
      const isSoftSplit = String(r.Payment_Method || "").trim().toLowerCase() === "split";
      ws.getRange(r._row, prefCol).setValue(isSoftSplit ? "wallet" : refundType);
      console.info(`SUCCESS: Soft-cancelled row ${r._row} with preference ${isSoftSplit ? "wallet (split)" : refundType}`);

      // For split orders: wallet portion is already deducted — refund it immediately.
      // UPI portion will be added to wallet once admin verifies.
      let softCancelMsg = "Cancellation request received! Admin will verify your payment and process the refund (1-2 days). ✅";
      if (isSoftSplit) {
        const walletCredit = Number(r.Wallet_Credit) || 0;
        const upiDue = Math.max(0, (Number(r.Net_Total) || 0) - walletCredit);
        if (walletCredit > 0) {
          _appendWalletTransaction(phone, r.Customer_Name || "Customer", "Order Cancellation Refund (Wallet Part)", walletCredit, true, String(rowId));
        }
        softCancelMsg = upiDue > 0
          ? `₹${walletCredit} has been refunded to your Wallet instantly. ` +
            `Once Admin verifies your ₹${upiDue} UPI payment, it will also be added to your Wallet (1-2 days). ✅`
          : `₹${walletCredit} has been refunded to your Wallet. ✅`;
      }
      return { success: true, message: softCancelMsg };
    } else {
      console.error(`FAILED: Missing columns for soft-cancel. StatusCol:${statusCol}, PrefCol:${prefCol}`);
    }
  }

  // ─── SOFT-CANCEL THE ROW (mark status, never delete) ─────────────────
  // Orders are kept forever for audit trail. The Payment_Status remark
  // ensures the row is excluded from all prep/delivery counts via _isOrderCancelled().
  {
    const hIdxFinal = headerIndex(ws);
    const statusColFinal = hIdxFinal["Payment_Status"] || hIdxFinal["Payment Status"];
    if (statusColFinal) {
      let cancelRemark;
      if (finalType === "wallet" || finalType === "__split_handled__") {
        cancelRemark = "Cancelled \u2013 Refunded to Wallet";
      } else if (finalType === "manual_upi") {
        cancelRemark = "Cancelled \u2013 UPI Refund Pending";
      } else if (finalType === "__on_account_handled__") {
        cancelRemark = "Cancelled \u2013 On Account";
      } else {
        // Fallback for unknown type (e.g. zero-refund edge cases)
        cancelRemark = "Cancelled";
      }
      ws.getRange(r._row, statusColFinal).setValue(cancelRemark);
      console.info(`ORDER SOFT-CANCELLED: Row ${r._row} (${rowId}) marked as '${cancelRemark}'`);
    } else {
      console.error(`SOFT-CANCEL FAILED: Payment_Status column not found in header index.`);
    }
  }

  return {success: true, message: msg};
}



