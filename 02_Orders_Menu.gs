// ============================================================
// 02_Orders_Menu.gs — customers, login, wallet, menu, submit/delete order
// Split from Code.gs (verbatim). Global config in 00_Config.gs (loads first).
// ============================================================

// ── ON-ACCOUNT: canonical status check (single source of truth) ─────────────
// The On-Account override in submitOrder writes EXACTLY "On Account" (verified
// against every write site — "onaccount" with no space is never actually
// written, it was defensive dead code). A 2026-07 audit found the customer-
// facing due amount (verifyLogin), the manual wallet-settle sweep
// (_autoSettlePendingOrders), the gateway due calc (_computeOnAccountDue), and
// the admin billing bucket (03_Admin_Kitchen.gs) each had their OWN ad-hoc
// filter — some also counted "Pending"/blank legacy rows, inflating what a
// customer saw as "due" without those rows ever being chargeable or settled.
// Every read site below now goes through this one function so they can never
// silently diverge again.
function _isOnAccountDueStatus(status) {
  return String(status || "").trim().toLowerCase() === "on account";
}

// Read-only diagnostic (run from the editor or ?action=auditOnAccountDrift with
// admin PIN) — lists every order belonging to an On_Account=Yes customer whose
// Payment_Status is neither "On Account" (correctly due) nor a settled/resolved
// state (Paid/Wallet Paid/Cancelled/Refunded). These are stray legacy rows the
// OLD verifyLogin filter used to silently fold into the customer's displayed
// due amount without them ever being chargeable via the gateway/manual
// on-account settlement — a real gap, closed 2026-07 by unifying every read
// site onto _isOnAccountDueStatus. Does NOT change anything; each flagged row
// needs a human judgment call (may be an unrelated unconfirmed manual-UPI order
// predating the On-Account flag, not necessarily an on-account bug).
function auditOnAccountStatusDrift() {
  const ss = getSpreadsheet();
  const custRows = getAllRows(getOrCreateTab(ss, TAB_CUSTOMERS, CUSTOMERS_HEADERS));
  const onAcctPhones = {};
  custRows.forEach(function (r) {
    if (String(r.On_Account || "").trim().toLowerCase() === "yes") {
      onAcctPhones[_normalizePhone(r.Phone)] = r.Customer_Name || "";
    }
  });
  const orderRows = getAllRows(getOrCreateTab(ss, TAB_ORDERS, ORDERS_HEADERS));
  const flagged = [];
  orderRows.forEach(function (r) {
    const p = _normalizePhone(r.Phone);
    if (!onAcctPhones[p]) return;
    const ps = String(r.Payment_Status || "").trim();
    const psl = ps.toLowerCase();
    if (psl === "on account") return;                  // correct — currently due
    if (psl.indexOf("paid") !== -1) return;             // Paid / Wallet Paid
    if (psl.indexOf("cancel") !== -1) return;
    if (psl.indexOf("refund") !== -1) return;
    const net = _cleanNum(r.Net_Total);
    if (net <= 0) return;
    flagged.push({
      phone: p, name: onAcctPhones[p], sid: r.Submission_ID,
      date: r.Order_Date instanceof Date ? Utilities.formatDate(r.Order_Date, "Asia/Kolkata", "yyyy-MM-dd") : String(r.Order_Date || ""),
      meal: r.Meal_Type, status: ps || "(blank)", net: net
    });
  });
  Logger.log("auditOnAccountStatusDrift: " + flagged.length + " stray row(s) found across " + Object.keys(onAcctPhones).length + " on-account customer(s)");
  Logger.log(JSON.stringify(flagged, null, 2));
  return { onAccountCustomers: Object.keys(onAcctPhones).length, count: flagged.length, rows: flagged };
}

// ── GET CUSTOMER ─────────────────────────────────────────────
function getCustomer(phone, storefront) {
  if (!phone) return {found: false};
  const ss = getSpreadsheet();
  const ws = (typeof _customersTabFor === "function") ? _customersTabFor(ss, storefront) : getOrCreateTab(ss, TAB_CUSTOMERS, CUSTOMERS_HEADERS);
  const rows = getAllRows(ws);
  const pStr = _normalizePhone(phone);
  const r = rows.find(x => _normalizePhone(x.Phone) === pStr);
  if (!r) {
    // Not in the live list — maybe an archived returning customer. Recognize them
    // (read-only, cold path) so the frontend shows "enter your PIN" instead of
    // forcing a fresh registration. The actual restore happens in verifyLogin once
    // the PIN is confirmed. Name is intentionally withheld (matches the hasPin path).
    // LS storefront: no SK archive integration — LS customers are a separate base.
    if (storefront !== "LS" && typeof _findArchivedCustomer === "function") {
      const arc = _findArchivedCustomer(pStr);
      // Recognize an archived returning customer either way:
      //  • has a PIN  → hasPin:true → "enter your PIN" (verifyLogin restores on match).
      //  • PIN cleared (idle-archive now blanks it, or admin-cleared) → hasPin:false →
      //    "Welcome back, set a new PIN" (self-service — no "reset my PIN" message).
      //    Their saved address returns on the address page via the existing "Fetch my
      //    saved address" button, which also deletes the archive row. Address/name are
      //    intentionally NOT returned here — same as the hasPin:true path, so a bare
      //    phone lookup never exposes anything sensitive.
      if (arc) return { found: true, hasPin: arc.pin !== "", archived: true };
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
    email:              r.Email || "",
    promoCount: (function(v){
      if (v === "" || v === null || v === undefined) return null;
      var num = Number(v);
      return isNaN(num) ? v : num;
    })(r.Review_Promo_Count),
    wallet_balance:     _calculateWalletBalance(phone, undefined, storefront),
    feeExempt:          (r.Fee_Exempt === "Yes" || r.Fee_Exempt === true),
    onAccount:          String(r.On_Account || "").trim().toLowerCase() === "yes" ? "Yes" : "No",
    billingCycle:       r.Billing_Cycle || "Daily"
  };
}

// ── VERIFY LOGIN ─────────────────────────────────────────────
function verifyLogin(phone, pin, storefront) {
  if (!phone || !pin) return {success: false, error: "Missing Phone or PIN."};
  const ss = getSpreadsheet();
  // SEPARATE BASES: LS customers authenticate against LS_Customers only.
  const ws = (typeof _customersTabFor === "function") ? _customersTabFor(ss, storefront) : getOrCreateTab(ss, TAB_CUSTOMERS, CUSTOMERS_HEADERS);
  const rows = getAllRows(ws);
  const pStr = _normalizePhone(phone);
  let r = rows.find(x => _normalizePhone(x.Phone) === pStr);

  if (!r) {
    // Archived returning customer (MAIN SITE only): verify against the archived
    // PIN and, if it matches, restore the FULL record into SK_Customers so they
    // log in normally — no PIN reset, address pre-filled. (Cold path only.)
    // LS storefront: separate base, no SK archive integration.
    if (storefront !== "LS" && typeof _findArchivedCustomer === "function") {
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
    // On-account dues live on the customer's OWN storefront tab.
    const orderRows = (typeof _lsOrdersWs === "function") ? getAllRows(_lsOrdersWs(ss, storefront)) : getAllRows(getOrCreateTab(ss, TAB_ORDERS, ORDERS_HEADERS));
    for (const ord of orderRows) {
      if (_normalizePhone(_get(ord, "Phone")) === pStr) {
        if (_isOnAccountDueStatus(_get(ord, "Payment_Status"))) {
          pendingAmount += _cleanNum(_get(ord, "Net_Total"));
        }
      }
    }
  }

  return {
    success: true,
    // Login notices are Hadapsar delivery-stop messages — not applicable to LS.
    notice: storefront === "LS" ? "" : _getLoginNotice(phone, r.Customer_Name), // "" unless this phone has an active, un-acked login notice
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
      email:              r.Email || "",   // for the Forgot-PIN OTP + blank-email nudge
      promoCount: (function(v){
        if (v === "" || v === null || v === undefined) return null;
        var num = Number(v);
        return isNaN(num) ? v : num;
      })(r.Review_Promo_Count),
      wallet_balance:     _calculateWalletBalance(phone, undefined, storefront),
      feeExempt:          (r.Fee_Exempt === "Yes" || r.Fee_Exempt === true),
      onAccount:          String(r.On_Account || "").trim().toLowerCase() === "yes" ? "Yes" : "No",
      billingCycle:       r.Billing_Cycle || "Daily",
      pending_amount:     pendingAmount
    }
  };
}

// ── FORGOT-PIN EMAIL OTP ─────────────────────────────────────────────────────
// Self-service PIN reset: a customer who forgot their PIN gets a 6-digit code
// e-mailed to the address ON FILE (collected while logged in / at signup — NEVER
// bound at reset time, so nobody can attach a fresh email to seize an account).
// Free via Apps Script MailApp (≈100 emails/day on a consumer Gmail — ample).
// Hardening: 6-digit code, 10-min expiry, ≤5 verify attempts, ≤3 sends/hour/phone
// (CacheService, auto-expiring). New PIN is set ONLY after a correct code.
var _OTP_TTL_SEC        = 600; // 10 minutes
var _OTP_MAX_VERIFY     = 5;   // wrong-code attempts before the code is burned
var _OTP_MAX_SENDS_PER_HR = 3; // OTP emails per phone per hour

function _sanitizeEmail(raw) {
  var e = String(raw == null ? "" : raw).trim().toLowerCase();
  if (!e || e.length > 254) return "";
  // Conservative single-address check (no spaces, one @, dotted TLD).
  if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/.test(e)) return "";
  return e;
}
function _maskEmail(email) {
  var e = String(email || ""); var at = e.indexOf("@");
  if (at < 1) return "your email";
  var name = e.slice(0, at);
  return (name.length <= 2 ? name.charAt(0) : name.slice(0, 2)) + "***" + e.slice(at);
}

// Find a customer's email in LIVE or ARCHIVE (Forgot-PIN cold path).
function _findCustomerEmailAnywhere(phone) {
  var ss = getSpreadsheet();
  var pStr = _normalizePhone(phone);
  var r = getAllRows(getOrCreateTab(ss, TAB_CUSTOMERS, CUSTOMERS_HEADERS))
            .find(function (x) { return _normalizePhone(x.Phone) === pStr; });
  if (r) return { found: true, source: "live", email: _sanitizeEmail(r.Email), name: r.Customer_Name || "" };
  if (typeof _findArchivedCustomer === "function") {
    var arc = _findArchivedCustomer(pStr);
    if (arc) return { found: true, source: "archive", email: _sanitizeEmail(arc.profile && arc.profile.email), name: arc.name || "" };
  }
  return { found: false };
}

// Set a new PIN AFTER OTP verification — bypasses _upsertCustomer's takeover guard
// (a valid code to the on-file email already proves ownership). Restores an archived
// customer into live first so they then log in normally.
function _setPinAfterOtp(phone, newPin) {
  var ss = getSpreadsheet();
  var pStr = _normalizePhone(phone);
  var ws = getOrCreateTab(ss, TAB_CUSTOMERS, CUSTOMERS_HEADERS);
  var find = function () { return getAllRows(ws).find(function (x) { return _normalizePhone(x.Phone) === pStr; }); };
  var r = find();
  if (!r && typeof _findArchivedCustomer === "function") {
    var arc = _findArchivedCustomer(pStr);
    if (arc) { _restoreArchivedCustomer(arc); r = find(); }
  }
  if (!r) return false;
  var hIdx = headerIndex(ws);
  ws.getRange(r._row, hIdx["PIN"]).setValue("'" + String(newPin).trim());
  SpreadsheetApp.flush();
  return true;
}

// STEP 1 — email a fresh OTP to the address on file. { ok, emailHint } or a reason.
function requestPinResetOtp(phone) {
  var pStr = _normalizePhone(phone);
  if (!pStr) return { ok: false, reason: "bad_phone" };
  var info = _findCustomerEmailAnywhere(pStr);
  if (!info.found) return { ok: false, reason: "not_found" };
  if (!info.email) return { ok: false, reason: "no_email" };

  var cache = CacheService.getScriptCache();
  var rlKey = "pinotp_rl_" + pStr;
  var sends = Number(cache.get(rlKey) || 0);
  if (sends >= _OTP_MAX_SENDS_PER_HR) return { ok: false, reason: "rate_limited" };

  var otp = String(Math.floor(100000 + Math.random() * 900000)); // 6 digits
  cache.put("pinotp_" + pStr, JSON.stringify({ otp: otp, email: info.email, attempts: 0, exp: Date.now() + _OTP_TTL_SEC * 1000 }), _OTP_TTL_SEC);
  cache.put(rlKey, String(sends + 1), 3600);

  var mins = Math.round(_OTP_TTL_SEC / 60);
  try {
    MailApp.sendEmail({
      to: info.email,
      name: "Svaadh Kitchen",
      subject: "Your Svaadh Kitchen PIN reset code: " + otp,
      body: "Hi" + (info.name ? " " + String(info.name).split(" ")[0] : "") + ",\n\n" +
            "Your Svaadh Kitchen PIN reset code is: " + otp + "\n\n" +
            "Enter it in the app to set a new 4-digit PIN. This code expires in " + mins + " minutes.\n\n" +
            "Didn't request this? You can safely ignore this email — your PIN stays unchanged.\n\n" +
            "— Team Svaadh Kitchen"
    });
  } catch (e) { return { ok: false, reason: "send_failed" }; }
  return { ok: true, emailHint: _maskEmail(info.email), expiresInMin: mins };
}

// STEP 2 — verify the code and set the new PIN. { ok } or a reason (+ attemptsLeft).
function verifyPinResetOtp(phone, otp, newPin, storefront) {
  var pStr = _normalizePhone(phone);
  var code = String(otp || "").trim();
  var pin  = String(newPin || "").trim();
  if (!/^\d{4}$/.test(pin)) return { ok: false, reason: "bad_pin" };
  var WEAK = ["0000","1111","2222","3333","4444","5555","6666","7777","8888","9999","1234","4321","9876","2580"];
  if (WEAK.indexOf(pin) !== -1) return { ok: false, reason: "weak_pin" };

  var cache = CacheService.getScriptCache();
  var key = "pinotp_" + pStr;
  var raw = cache.get(key);
  if (!raw) return { ok: false, reason: "expired" };
  var data; try { data = JSON.parse(raw); } catch (e) { cache.remove(key); return { ok: false, reason: "expired" }; }
  if (Date.now() > data.exp) { cache.remove(key); return { ok: false, reason: "expired" }; }
  if (data.attempts >= _OTP_MAX_VERIFY) { cache.remove(key); return { ok: false, reason: "too_many_attempts" }; }
  if (code !== data.otp) {
    data.attempts++;
    cache.put(key, JSON.stringify(data), _OTP_TTL_SEC);
    return { ok: false, reason: "bad_otp", attemptsLeft: Math.max(0, _OTP_MAX_VERIFY - data.attempts) };
  }

  var lock = LockService.getScriptLock();
  try { lock.waitLock(30000); } catch (e) { return { ok: false, reason: "busy" }; }
  try {
    if (!_setPinAfterOtp(pStr, pin, storefront)) return { ok: false, reason: "not_found" };
    cache.remove(key);
    cache.remove("pinotp_rl_" + pStr); // clear the rate-limit once they're through
    return { ok: true };
  } finally { lock.releaseLock(); }
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

  const rows = getAllRows(getOrCreateTab(ss, TAB_ORDERS, ORDERS_HEADERS));

  // Rule 2: Only target "on account" orders (ignore normal Pending/UPI)
  const pendingOrders = rows.filter(r => {
    if (_normalizePhone(_get(r, "Phone")) !== pStr) return false;
    if (!_isOnAccountDueStatus(_get(r, "Payment_Status"))) return false;
    return _cleanNum(_get(r, "Net_Total")) > 0;
  });

  if (pendingOrders.length === 0) return { settled: 0, msg: "" };

  // TRUE chronological sort — Order_Date is a Date object; String(Date) starts
  // with the weekday name, so the old compare scrambled "oldest-first".
  const _oaDsKey = (r) => {
    const d = _get(r, "Order_Date");
    return d instanceof Date ? Utilities.formatDate(d, "Asia/Kolkata", "yyyy-MM-dd") : String(d || "").trim();
  };
  pendingOrders.sort((a, b) => _oaDsKey(a).localeCompare(_oaDsKey(b)));

  let walletBalance = _calculateWalletBalance(phone);
  if (walletBalance <= 0) return { settled: 0, msg: "" };

  let totalSettled = 0;
  let ordersSettledCount = 0;
  let originalPendingAmount = pendingOrders.reduce((sum, o) => sum + _cleanNum(_get(o, "Net_Total")), 0);

  let currentWallet = walletBalance;

  for (let order of pendingOrders) {
    let amount = _cleanNum(_get(order, "Net_Total"));
    if (currentWallet >= amount) {
      const oWsS = order._ws || getOrCreateTab(ss, TAB_ORDERS, ORDERS_HEADERS);
      const oHIdxS = headerIndex(oWsS);
      oWsS.getRange(order._row, oHIdxS["Payment_Status"]).setValue("Paid");
      _appendWalletTransaction(phone, _get(order, "Customer_Name") || "Customer", "Auto-deducted for On Account order " + (_get(order, "Submission_ID") || _get(order, "Order_Date")), amount, true, "AUTO-" + Date.now() + "-" + Math.floor(Math.random()*1000));
      currentWallet -= amount;
      totalSettled += amount;
      ordersSettledCount++;
    }
    // No `break`: an older order larger than the remaining balance must not
    // strand smaller ones after it (same skip-not-break rule as the gateway
    // settle) — keep checking; whole-order settlement only, never partial.
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
function _calculateWalletBalance(phone, preloadedRows, storefront) {
  if (!phone) return 0;
  const ss = getSpreadsheet();
  const ws = (typeof _walletTabFor === "function") ? _walletTabFor(ss, storefront) : getOrCreateTab(ss, TAB_WALLET, WALLET_HEADERS);
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

// AMANORA TOWER → SOCIETY aliases (owner-confirmed 2026-07-11, derived from
// auditAmanoraTowers + owner's knowledge of the township). Writes SK_Society_Aliases
// rows so a society string carrying only a tower number groups under its real
// society (piggyback + route learning). Per tower: an EXACT "T<n>" row (bare
// "T53"-style entries) + a CONTAINS "*tower <n>" row ("Tower 53, 401, Amanora…").
// Deliberately NO "*t<n>" contains rules — flat numbers bleed ("Flat 5301" base-
// normalizes to "flat5301", which CONTAINS "t53"). Society-word contains rows
// ("*desire tower" …) catch every spelling that names the society. Idempotent:
// same-alias rows are updated in place, never duplicated. Dry-run unless commit.
const AMANORA_TOWER_SOCIETIES = {
  "Amanora Desire Towers":  [18, 19, 20, 21, 22],
  "Amanora Metro Towers":   [24, 25],
  "Amanora Adreno Towers":  [37, 38, 39, 40, 41],
  "Amanora Gold Towers":    [42, 43, 44, 45, 46],
  "Amanora Elevate Towers": [47],
  "Amanora Future Towers":  [52, 53],
  "Amanora Neo Towers":     [94, 95, 96, 97],
  "Amanora Gateway Towers": [98, 99, 100]
};
const AMANORA_SOCIETY_WORD_RULES = {
  "*desire tower":  "Amanora Desire Towers",
  "*metro tower":   "Amanora Metro Towers",
  "*adreno":        "Amanora Adreno Towers",
  "*gold tower":    "Amanora Gold Towers",
  "*elevate tower": "Amanora Elevate Towers",
  "*future tower":  "Amanora Future Towers",
  "*neo tower":     "Amanora Neo Towers",
  "*gateway tower": "Amanora Gateway Towers"
};
function seedAmanoraTowerAliases(commit) {
  const ss = getSpreadsheet();
  let ws = ss.getSheetByName("SK_Society_Aliases");
  if (!ws) {
    ws = ss.insertSheet("SK_Society_Aliases");
    ws.getRange(1, 1, 1, 2).setValues([["Alias", "Canonical"]]);
  }

  // Desired rows, in a deliberate order (specific tower needles before word rules).
  const rows = [];
  Object.keys(AMANORA_TOWER_SOCIETIES).forEach(function (canon) {
    AMANORA_TOWER_SOCIETIES[canon].forEach(function (n) {
      rows.push(["T" + n, canon]);            // exact: bare "T53" / "T-53" / "t 53"
      rows.push(["*tower " + n, canon]);      // contains: "Tower 53 …" anywhere
    });
  });
  Object.keys(AMANORA_SOCIETY_WORD_RULES).forEach(function (alias) {
    rows.push([alias, AMANORA_SOCIETY_WORD_RULES[alias]]);
  });

  // Existing rows keyed by (isContains + normalized alias) for idempotent upsert.
  const existing = {}; // key → { row: sheetRow, canonical }
  const last = ws.getLastRow();
  if (last > 1) {
    ws.getRange(2, 1, last - 1, 2).getValues().forEach(function (r, i) {
      const raw = String(r[0] == null ? "" : r[0]).trim();
      if (!raw) return;
      const isC = raw.charAt(0) === "*";
      const key = (isC ? "*" : "") + _normSocietyBase(isC ? raw.slice(1) : raw);
      existing[key] = { row: i + 2, canonical: String(r[1] == null ? "" : r[1]).trim() };
    });
  }

  let added = 0, updated = 0, unchanged = 0;
  const plan = [];
  rows.forEach(function (r) {
    const raw = r[0], canon = r[1];
    const isC = raw.charAt(0) === "*";
    const key = (isC ? "*" : "") + _normSocietyBase(isC ? raw.slice(1) : raw);
    const ex = existing[key];
    if (ex && ex.canonical === canon) { unchanged++; return; }
    if (ex) {
      updated++; plan.push("UPDATE '" + raw + "' → '" + canon + "' (was '" + ex.canonical + "')");
      if (commit) ws.getRange(ex.row, 2).setValue(canon);
    } else {
      added++; plan.push("ADD '" + raw + "' → '" + canon + "'");
      if (commit) { ws.appendRow([raw, canon]); existing[key] = { row: ws.getLastRow(), canonical: canon }; }
    }
  });
  if (commit) { SpreadsheetApp.flush(); try { CacheService.getScriptCache().remove("society_aliases_v2"); } catch (_) {} }
  return { success: true, committed: !!commit, added: added, updated: updated, unchanged: unchanged,
           note: "After committing, rebuild delivery routes (driver page refresh button) so tower spellings merge into their society stops.",
           plan: plan.slice(0, 80) };
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

  const groups = Object.keys(variants).map(function (key) {
    const names = Object.keys(variants[key]).map(function (nm) {
      return { name: nm, orders: variants[key][nm].orders, customers: variants[key][nm].customers };
    }).sort(function (a, b) { return (b.orders + b.customers) - (a.orders + a.customers); });
    const tot = names.reduce(function (s, x) { return s + x.orders + x.customers; }, 0);
    // Resolve through the REAL matcher (exact + contains rules). The old code did
    // `aliasMap[key]` on _societyAliasMap()'s {exact,contains} WRAPPER — always
    // undefined, so aliasedTo showed "" even for rows the alias sheet was mapping.
    const canon = _normSocietyKey(names.length ? names[0].name : key);
    return { key: key, aliasedTo: (canon && canon !== key) ? canon : "", totalUses: tot, spellings: names };
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
// array. One UNIQUE CUSTOMER NAME = one delivery slot. If the same customer has
// multiple order rows for the same meal (e.g. 2 Lunch orders), they still count
// as one delivery. Cancelled rows free their slot. VIPs (Fee_Exempt) count as 0.
// Shared by getMenu (display) and the submitOrder cap guard (authoritative).
function _countActiveMealOrders(rows, dateStr) {
  const c = { Breakfast: 0, Lunch: 0, Dinner: 0 };
  // Track unique customer names per meal — same person = same delivery stop.
  const seen = { Breakfast: {}, Lunch: {}, Dinner: {} };
  const vips = typeof _getVipPhonesCached === "function" ? _getVipPhonesCached() : {};
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
    // VIP exemption: VIPs don't count towards the delivery limit at all
    const phoneTrim = String(r.Phone || "").trim();
    if (vips[phoneTrim]) continue;
    // The cap is a DELIVERY limit — Self Pickup / Porter orders don't use a
    // delivery slot, so they neither count toward the cap nor get blocked by it.
    // Shree Laxmi Vihar society orders also don't consume a delivery slot (owner-
    // approved exemption 2026-07-31) — excluded from the count entirely.
    const ar = String(r.Area || "").toLowerCase();
    if (ar.indexOf("pickup") !== -1 || ar === "porter") continue;
    const soc = _normSocietyBase(r.Society || "");
    if (soc.indexOf("shreelaxmivihar") !== -1) continue;
    const mt = String(r.Meal_Type || "").trim();
    if (c[mt] === undefined) continue;
    if (_isEnkin(r.Customer_Name)) { sawEnkin[mt] = true; continue; }
    if (_isIA(r.Customer_Name))    { sawIA[mt]    = true; continue; }
    
    const nameKey = "name|" + String(r.Customer_Name || "").trim().toLowerCase();
    
    // Aggressively extract numeric part of Flat (so "601,P", "0601", "601 K" all become "601").
    // This ensures typos or trailing letters in the same building don't hog extra delivery slots.
    var fRaw = String(r.Flat || "").trim().toLowerCase();
    var fMatch = fRaw.match(/\d+/);
    var f = fMatch ? parseInt(fMatch[0], 10).toString() : fRaw.replace(/[^a-z0-9]/g, "");
    var w = String(r.Wing || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
    var sStr = typeof _normSocietyKey === "function" ? _normSocietyKey(r.Society) : _normSocietyBase(r.Society || "");
    var addrKey = "";
    if (f && sStr) addrKey = "addr|" + w + "|" + f + "|" + sStr;

    if (!seen[mt][nameKey] && (!addrKey || !seen[mt][addrKey])) {
      c[mt]++;
    }
    
    seen[mt][nameKey] = true;
    if (addrKey) seen[mt][addrKey] = true;
  }
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
  try {
    if (r && r.OOS_JSON) {
      oosItems = JSON.parse(r.OOS_JSON);
      if (oosItems.Breakfast) {
        oosItems.Breakfast = oosItems.Breakfast.map(name => NAME_MAP[name] || name);
      }
    }
  } catch(e) {}

  let ordersClosed = {};
  try { if (r && r.Orders_Closed) ordersClosed = JSON.parse(r.Orders_Closed); } catch(e) {}

  let stockLimits = {};
  try { if (r && r.Stock_JSON) stockLimits = JSON.parse(r.Stock_JSON); } catch(e) {}

  // Per-meal max-order caps. Site-wide defaults (admin-editable via SK_Default_Caps)
  // apply to EVERY date; a positive per-date Order_Cap_JSON value overrides.
  // When a meal's active delivery count reaches its cap it is SOLD OUT for delivery.
  let orderCaps = {};
  try { if (r && r.Order_Cap_JSON) orderCaps = JSON.parse(r.Order_Cap_JSON); } catch(e) {}
  orderCaps = _effectiveOrderCaps(orderCaps);
  // Per-meal flag: offer Self Pickup / Porter when delivery is full? Default ON
  // (missing/true). false = hard sold-out (no alternatives offered).
  let capAlt = {};
  try { if (r && r.Cap_Alt_JSON) capAlt = JSON.parse(r.Cap_Alt_JSON); } catch(e) {}

  const ordersWs2   = getOrCreateTab(ss, TAB_ORDERS, []);
  // OPTIMIZATION: Only read the last 500 rows to compute stock limit (covers today and yesterday).
  // This prevents scanning thousands of old orders just to check today's stock.
  // LS_Orders rows are included so Liviano-Serio consumption depletes the SAME
  // real stock shown to main-site customers.
  const ordersRows2 = getRecentRows(ordersWs2, 500).concat(ls_rowsAsSK());
  const orderedCounts = countOrderedUnits(ordersRows2, dateStr);
  const unitsRemaining = {};
  ["Breakfast","Lunch","Dinner"].forEach(meal => {
    Object.entries(stockLimits[meal] || {}).forEach(([colKey, limit]) => {
      if (SABJI_COMBO_GROUPS[colKey]) return; // virtual combo entry — not a real item, handled below
      if (!unitsRemaining[meal]) unitsRemaining[meal] = {};
      unitsRemaining[meal][colKey] = Math.max(0, limit - (orderedCounts[meal][itemsJsonKey(colKey)] || 0));
    });
  });
  // Dry/Curry Sabji Mini+Full share a weighted pool when a combo limit is set —
  // layer that on top of (or in place of) any individual per-size limit above.
  _applySabjiComboLimits(stockLimits, orderedCounts, unitsRemaining);

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
    combo_stock:  { Lunch: _sabjiComboStatus(stockLimits, orderedCounts, "Lunch"),
                    Dinner: _sabjiComboStatus(stockLimits, orderedCounts, "Dinner") },
    order_caps:    orderCaps,    // admin display: configured per-meal max
    cap_alt:       capAlt,       // admin display: per-meal "offer pickup/porter" flags
    order_counts:  orderCounts,  // admin display: active orders placed so far
    sold_out:      soldOut,      // customer display: meal hit its cap today
    kitchen_closed: _kitchenClosed,               // full-day close (all meals)
    closed_meals:   _closedMealsObj(r)            // per-meal close {Breakfast,Lunch,Dinner}
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
    const exempt = [];
    rows.forEach(function(r) {
      const isClosed = (r.Kitchen_Closed === true ||
        String(r.Kitchen_Closed || "").toLowerCase() === "true");
      // Also include dates with ANY per-meal closure. Admin closing even one
      // meal should never break a customer's loyalty streak.
      var hasPartial = false;
      if (!isClosed && r.Closed_Meals_JSON) {
        try {
          var cm = JSON.parse(r.Closed_Meals_JSON);
          hasPartial = !!(cm && (cm.Breakfast || cm.Lunch || cm.Dinner));
        } catch (e) {}
      }
      if (!isClosed && !hasPartial) return;
      const d = r.Date instanceof Date
        ? Utilities.formatDate(r.Date, "Asia/Kolkata", "yyyy-MM-dd")
        : String(r.Date).trim();
      if (!d || d < cutoff) return;            // recent past + future
      
      if (isClosed) closed.push(d); // Fully closed -> calendar blocked
      exempt.push(d);               // Fully or partially closed -> streak exempt
    });
    closed.sort();
    exempt.sort();
    return { closedDates: closed, exemptDates: exempt };
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
function _appendWalletTransaction(phone, name, txnType, amount, isVerified, refId, storefront) {
  // Serialize wallet writes. Apps Script LockService is re-entrant within the
  // same execution, so this also works when the caller (e.g. submitOrder) is
  // already holding the script lock. Storefront-routed: LS → LS_Wallet.
  const lock = LockService.getScriptLock();
  try { lock.waitLock(30000); }
  catch(e) { throw new Error("Wallet busy — please retry in a few seconds."); }
  try {
    const ss = getSpreadsheet();
    const ws = (typeof _walletTabFor === "function") ? _walletTabFor(ss, storefront) : getOrCreateTab(ss, TAB_WALLET, WALLET_HEADERS);
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
function _missedOrderSafetyNet(ss, sid, row, phone, tabName) {
  try {
    const props  = PropertiesService.getScriptProperties();
    const raw    = props.getProperty("PENDING_ORDER_ROWS") || "{}";
    const store  = JSON.parse(raw);
    // Expire entries older than 60 minutes. Was 10 — too short: the 3-Jul ₹104 loss
    // showed GAS can drop a row AFTER the in-execution verification passed, and the
    // 10-min backup had already expired by the time anything could re-append it.
    const now    = Date.now();
    Object.keys(store).forEach(k => { if (now - store[k].ts > 60 * 60 * 1000) delete store[k]; });
    // tabName: which orders tab this row belongs to (SK_Orders default — legacy
    // entries without a tab field are always SK). The verify pass re-appends into
    // THIS tab, so an LS order's backup can never land in the wrong sheet.
    store[sid]   = { ts: now, phone: String(phone || ""), row: row, tab: tabName || TAB_ORDERS };
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
  "Customer_Name", "Phone", "Amount", "Order_Date", "Meal", "Re_append_Attempts",
  "Row_JSON"  // FULL row array — so a lost order is restorable from the LOG forever,
              // not only from the 60-min PENDING_ORDER_ROWS stash or the alert email.
];

function _logMissedOrderRow(ss, rec) {
  try {
    const ws = getOrCreateTab(ss, TAB_MISSED_ORDERS, MISSED_ORDERS_HEADERS);
    // Self-heal: legacy tabs predate the Row_JSON column.
    const hdr = ws.getRange(1, 1, 1, ws.getLastColumn()).getValues()[0].map(String);
    if (hdr.indexOf("Row_JSON") === -1) ws.getRange(1, ws.getLastColumn() + 1).setValue("Row_JSON");
    ws.appendRow([
      new Date(), rec.status || "", rec.sid || "", rec.gatewayId || "",
      rec.name || "", rec.phone || "", rec.amount || "", rec.date || "", rec.meal || "",
      (rec.attempts == null ? "" : rec.attempts),
      rec.rowJson || ""
    ]);
    SpreadsheetApp.flush();
  } catch (e) {
    console.error("_logMissedOrderRow failed for " + (rec && rec.sid) + ": " + e.message);
  }
}

// ── MISSED-ORDER LOG RECONCILER — "lost but recovered & written ✓" ─────────────
// The 1-min safety net emails "STILL MISSING — enter manually" the moment 5
// re-appends fail, but it KEEPS retrying for the 60-min stash TTL — so an order
// often lands a few minutes later and the owner is never told (10-Jul incident:
// SK-20260710-8950 recovered on a later pass while the mail still demanded manual
// entry). This pass closes the loop: for every log row still claiming a lost order,
// it (a) verifies the order is now in SK_Orders / the archives → flips the status
// and emails "recovered & written ✓"; (b) if genuinely absent but Row_JSON was
// captured → re-appends it right here (verified) and emails the same. Runs from the
// 10-min lost-order audit trigger + on demand via ?action=reconcileMissedOrders.
function reconcileMissedOrdersLog(debug) {
  const ss = getSpreadsheet();
  const mWs = ss.getSheetByName(TAB_MISSED_ORDERS);
  if (!mWs || mWs.getLastRow() < 2) return { checked: 0, recovered: 0 };

  const data = mWs.getDataRange().getValues();
  const H = data[0].map(String);
  const cSt = H.indexOf("Status"), cSid = H.indexOf("Submission_ID"), cGw = H.indexOf("Gateway_Order_ID"),
        cDate = H.indexOf("Order_Date"), cJson = H.indexOf("Row_JSON"),
        cName = H.indexOf("Customer_Name"), cPh = H.indexOf("Phone"), cAmt = H.indexOf("Amount");
  if (cSt === -1) return { checked: 0, recovered: 0 };

  // Candidate rows: still claiming a lost/missing order (any variant), not yet ✅.
  // Capped per run — each run must finish WELL inside the ~6-min execution limit
  // (the first uncapped run timed out on the June backlog); the 10-min trigger
  // drains any remainder across subsequent runs.
  const PENDING_RE = /STILL MISSING|BULK ROW DROPPED|FOUND BY AUDIT/i;
  const MAX_PER_RUN = 30;
  let cand = [];
  for (let i = 1; i < data.length; i++) {
    const st = String(data[i][cSt] || "");
    if (PENDING_RE.test(st) && st.indexOf("✅") === -1 && st.indexOf("⚠️") === -1) cand.push(i);
  }
  if (!cand.length) return { checked: 0, recovered: 0 };
  const candTotal = cand.length;
  cand = cand.slice(0, MAX_PER_RUN);

  // Ids already present in LIVE order tabs (read just the 2 id columns — cheap).
  // Scans BOTH SK_Orders and LS_Orders so an LS row that already landed is never
  // "restored" again into the wrong (or right!) tab as a duplicate.
  const liveSids = new Set(), liveGws = new Set();
  [TAB_ORDERS, TAB_LS_ORDERS].forEach(function (_tabName) {
    try {
      const tWs = ss.getSheetByName(_tabName);
      if (!tWs || tWs.getLastRow() < 2) return;
      const tH = tWs.getRange(1, 1, 1, tWs.getLastColumn()).getValues()[0].map(String);
      const tSidCol = tH.indexOf("Submission_ID") + 1, tGwCol = tH.indexOf("Gateway_Order_ID") + 1;
      if (tSidCol) tWs.getRange(2, tSidCol, tWs.getLastRow() - 1, 1).getValues().forEach(v => { const s = String(v[0] || "").trim(); if (s) liveSids.add(s); });
      if (tGwCol)  tWs.getRange(2, tGwCol,  tWs.getLastRow() - 1, 1).getValues().forEach(v => { const s = String(v[0] || "").trim(); if (s) liveGws.add(s); });
    } catch (eTab) {}
  });
  const oWs = getOrCreateTab(ss, TAB_ORDERS, ORDERS_HEADERS);
  const _fmtD = v => v instanceof Date ? Utilities.formatDate(v, "Asia/Kolkata", "yyyy-MM-dd") : String(v || "").trim().slice(0, 10);
  const nowStamp = getISTTimestamp();

  // ONE archive read spanning every candidate's date (±3d) — the per-candidate
  // lookup re-read the whole live sheet + archive files each time and blew the
  // 6-min execution limit on a ~16-row backlog. Sets make each check O(1).
  const archSids = new Set(), archGws = new Set();
  {
    let minD = "", maxD = "";
    cand.forEach(i => {
      const d = _fmtD(data[i][cDate]);
      if (!d) return;
      if (!minD || d < minD) minD = d;
      if (!maxD || d > maxD) maxD = d;
    });
    if (minD && typeof getOrdersInRangeWithArchive === "function") {
      try {
        const from = Utilities.formatDate(new Date(new Date(minD + "T12:00:00").getTime() - 3 * 86400000), "Asia/Kolkata", "yyyy-MM-dd");
        const to   = Utilities.formatDate(new Date(new Date(maxD + "T12:00:00").getTime() + 3 * 86400000), "Asia/Kolkata", "yyyy-MM-dd");
        getOrdersInRangeWithArchive(from, to).forEach(r => {
          const s = String(r.Submission_ID || "").trim();     if (s) archSids.add(s);
          const g = String(r.Gateway_Order_ID || "").trim();  if (g) archGws.add(g);
        });
      } catch (e) {}
    }
  }

  // DEBUG mode: no writes, no mail — just show what the matcher sees.
  if (debug) {
    return {
      debug: true, pendingTotal: candTotal,
      liveSids: liveSids.size, liveGws: liveGws.size, archSids: archSids.size, archGws: archGws.size,
      sample: cand.slice(0, 10).map(i => ({
        row: i + 1, status: String(data[i][cSt] || "").slice(0, 50),
        sid: String(data[i][cSid] || ""), gw: String(data[i][cGw] || ""),
        date: _fmtD(data[i][cDate]),
        liveSidHit: liveSids.has(String(data[i][cSid] || "").trim()),
        liveGwHit: liveGws.has(String(data[i][cGw] || "").trim()),
        archSidHit: archSids.has(String(data[i][cSid] || "").trim()),
        archGwHit: archGws.has(String(data[i][cGw] || "").trim()),
        hasJson: cJson !== -1 && !!data[i][cJson]
      }))
    };
  }

  const recoveredLines = [];
  let checked = 0, recovered = 0;
  cand.forEach(i => {
    checked++;
    const sid = String(data[i][cSid] || "").trim();
    const gw  = String(data[i][cGw]  || "").trim();
    const who = (data[i][cName] || "") + " / " + (data[i][cPh] || "") + " / ₹" + (data[i][cAmt] || "?");
    let how = "";

    // (a) Already in the live sheet?
    if ((sid && liveSids.has(sid)) || (gw && liveGws.has(gw))) how = "verified present in SK_Orders";
    // (b) Or in a monthly archive (pre-scanned sets)?
    if (!how && ((sid && archSids.has(sid)) || (gw && archGws.has(gw)))) how = "verified present in archive";
    // (c) Genuinely absent — restore from the captured Row_JSON, verified.
    // Target tab routes by Submission_ID prefix: "LS-*" rows restore into
    // LS_Orders, everything else into SK_Orders.
    if (!how && cJson !== -1 && data[i][cJson] && sid) {
      try {
        const row = JSON.parse(String(data[i][cJson]));
        if (Array.isArray(row) && row.length && typeof _reappendUntilPresent === "function") {
          const _rIsLS  = (sid.slice(0, 3).toUpperCase() === "LS-");
          const _rWs    = _rIsLS ? getOrCreateTab(ss, TAB_LS_ORDERS, ORDERS_HEADERS) : oWs;
          const _rH     = _rWs.getRange(1, 1, 1, _rWs.getLastColumn()).getValues()[0].map(String);
          const _rSidCol = _rH.indexOf("Submission_ID") + 1;
          if (_rSidCol) {
            const okAttempt = _reappendUntilPresent(_rWs, _rSidCol, sid, row, 3);
            if (okAttempt) { how = "RESTORED from Row_JSON (append verified)"; liveSids.add(sid); }
          }
        }
      } catch (e) {}
    }

    if (how) {
      recovered++;
      mWs.getRange(i + 1, cSt + 1).setValue("✅ Recovered & written — " + how + " @ " + nowStamp);
      recoveredLines.push("✅ " + (sid || gw) + " — " + who + " (" + how + ")");
    } else {
      // TERMINAL: not in the sheet, not in the archives, and no Row_JSON to restore
      // from (or restore failed) — and the entry is old enough that every automatic
      // avenue (60-min stash retries, this reconciler) has long been exhausted.
      // Mark it so the log is honest and this row stops being rechecked forever.
      // (June-era rows: the known 29-Jun losses + gateway go-live test charges.)
      const det = data[i][0];
      const ageMs = (det instanceof Date) ? (Date.now() - det.getTime()) : NaN;
      const hasJson = cJson !== -1 && !!data[i][cJson];
      if (!hasJson && !isNaN(ageMs) && ageMs > 3 * 86400000) {
        mWs.getRange(i + 1, cSt + 1).setValue(
          "⚠️ Unrecoverable — not in sheet/archives, no Row_JSON captured (pre-v26.9 log). Manual judgment. [was: "
          + String(data[i][cSt] || "").slice(0, 60) + "] @ " + nowStamp);
      }
    }
  });
  if (recovered) {
    SpreadsheetApp.flush();
    try {
      const adminEmail = PropertiesService.getScriptProperties().getProperty("ADMIN_EMAIL");
      if (adminEmail) MailApp.sendEmail(adminEmail,
        "✅ Svaadh: " + recovered + " lost order(s) recovered & written",
        "Good news — these previously-alerted orders are safely in the sheet. No manual entry needed:\n\n"
        + recoveredLines.join("\n")
        + "\n\n(SK_Missed_Orders statuses updated. Only act manually if an order stays non-✅ across mails.)");
    } catch (e) {}
  }
  return { checked: checked, recovered: recovered, pendingTotal: candTotal,
           remaining: Math.max(0, candTotal - checked) };
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
  // WINDOW: only webhooks from the last 7 days. The existence check above reads the
  // LIVE SK_Orders only — once a month's ORDER rows are archived out (monthly archive
  // run), every older webhook would look "missing" and spam the admin (the 11-Jul
  // June flood). A genuinely lost order is caught within minutes by the 10-min live
  // audit, so a week of lookback is ample; anything older is history, not an alert.
  const AUDIT_WINDOW_MS = 7 * 24 * 3600 * 1000;
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
      if (!(rcv instanceof Date)) continue;                          // undated — can't age it, skip
      if ((now - rcv.getTime()) < 5 * 60 * 1000) continue;           // too fresh (still writing)
      if ((now - rcv.getTime()) > AUDIT_WINDOW_MS) continue;         // outside the 7-day window

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

  // (5) Report + log new findings — but first TRY TO SELF-HEAL each one: if the
  // pending stash still holds the order (items!), write it right now via the
  // reconciler instead of only alerting. Turns the audit from a smoke detector
  // into a sprinkler for every case where the stash survived.
  const missing = Object.keys(seen).map(function (k) { return seen[k]; });
  const newRows = [];
  missing.forEach(function (m) {
    if (alreadyLogged.has(m.oid)) return;
    // ARCHIVE double-check: the order may have already been moved to a monthly
    // archive file (live-sheet check above can't see it). Only runs for the rare
    // flagged candidate, scanning ±3 days around the webhook date — cheap.
    try {
      if (m.rcv instanceof Date && typeof getOrdersInRangeWithArchive === "function") {
        const _dFrom = Utilities.formatDate(new Date(m.rcv.getTime() - 3 * 86400000), "Asia/Kolkata", "yyyy-MM-dd");
        const _dTo   = Utilities.formatDate(new Date(m.rcv.getTime() + 3 * 86400000), "Asia/Kolkata", "yyyy-MM-dd");
        const _archHit = getOrdersInRangeWithArchive(_dFrom, _dTo).some(function (r) {
          return String(r.Gateway_Order_ID || "").trim() === m.oid;
        });
        if (_archHit) return; // it landed — just lives in an archive now, not lost
      }
    } catch (e) { console.warn("audit archive-check failed for " + m.oid + ": " + (e && e.message)); }
    let recovered = false;
    try {
      if (typeof hdfc_reconcileOrderFromStash === "function") {
        const rr = hdfc_reconcileOrderFromStash(m.oid);
        recovered = !!(rr && (rr.outcome === "reconciled" || rr.outcome === "skippedAlreadyDone"));
      }
    } catch (e) { console.warn("audit self-heal failed for " + m.oid + ": " + (e && e.message)); }
    _logMissedOrderRow(ss, {
      status: recovered ? "AUTO-RECOVERED BY AUDIT (was charged but missing)"
                        : "FOUND BY AUDIT — charged but not in SK_Orders",
      sid: "", gatewayId: m.oid, name: m.name, phone: m.phone, amount: m.amount,
      date: (m.rcv instanceof Date) ? Utilities.formatDate(m.rcv, "Asia/Kolkata", "yyyy-MM-dd") : "",
      meal: "", attempts: ""
    });
    if (!recovered) newRows.push(m); // only unrecovered ones need the alert email
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
  const res = auditLostGatewayOrders(0);
  // Close the loop on earlier "STILL MISSING" alerts: verify/restore + "✅ recovered
  // & written" mail (see reconcileMissedOrdersLog). Piggybacks this 10-min trigger.
  try { reconcileMissedOrdersLog(); } catch (e) { Logger.log("reconcileMissedOrdersLog: " + (e && e.message)); }
  // Auto-recover dropped charged orders from SK_Order_Log stash (10-60 min window)
  try { recoverFromOrderLog(); } catch (e) { Logger.log("recoverFromOrderLog: " + (e && e.message)); }
  return res;
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

// OPTIONAL deeper daily sweep — also scans last month's archive file, to catch
// anything that aged out of the live log before a 10-min run saw it. (The audit
// only alerts on webhooks from the last 7 days, so one month back always covers
// the window even right after a month flip.) Run setupDailyDeepAuditTrigger()
// once if you want the extra safety net.
function dailyDeepLostOrderAudit() {
  return auditLostGatewayOrders(1);
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

    // Multi-tab aware: each stash entry carries the orders tab it belongs to
    // (legacy entries default to SK_Orders). Build a per-tab recent-SID index
    // and verify/re-append against the entry's OWN tab.
    const _tabsNeeded = {};
    Object.entries(store).forEach(([sid, entry]) => {
      const t = entry.tab || TAB_ORDERS;
      if (!_tabsNeeded[t]) _tabsNeeded[t] = { ws: null, hIdx: null, sidCol: null, inSheet: new Set() };
    });
    Object.keys(_tabsNeeded).forEach(function (t) {
      try {
        const wsT   = ss.getSheetByName(t) || getOrCreateTab(ss, t === TAB_LS_ORDERS ? TAB_LS_ORDERS : TAB_ORDERS, ORDERS_HEADERS);
        const hIdxT = headerIndex(wsT);
        const sidColT = hIdxT["Submission_ID"];
        if (!sidColT) return;
        const lastRowT  = wsT.getLastRow();
        const startRowT = Math.max(2, lastRowT - 200);
        const countT    = lastRowT - startRowT + 1;
        if (countT > 0) {
          wsT.getRange(startRowT, sidColT, countT, 1).getValues().flat().map(String).forEach(function (s) { _tabsNeeded[t].inSheet.add(s); });
        }
        _tabsNeeded[t].ws = wsT; _tabsNeeded[t].hIdx = hIdxT; _tabsNeeded[t].sidCol = sidColT;
      } catch (eT) { console.error("_verifyAndAlertMissedOrders: tab init failed for " + t + ": " + eT.message); }
    });

    const missed = [];
    Object.entries(store).forEach(([sid, entry]) => {
      const _tb = _tabsNeeded[entry.tab || TAB_ORDERS];
      if (!_tb || !_tb.ws || !_tb.sidCol) return; // tab unavailable — skip this pass
      if (!_tb.inSheet.has(sid)) {
        console.error("MISSED ORDER DETECTED — " + sid + " not found in " + (entry.tab || TAB_ORDERS) + " after flush!");
        // Re-append AND verify it actually landed (retry under load). The old code
        // appended once and logged "succeeded" if appendRow didn't throw — but the
        // re-append was silently dropped too, so paid orders vanished with a success log
        // (29-Jun: 5 lost). _reappendUntilPresent re-reads to confirm and retries.
        // Pull the human-readable fields off the saved row (by header name, so dynamic
        // columns like Gateway_Order_ID are handled) for the audit tab.
        const _hf = function (nm) { const c = _tb.hIdx[nm]; return (c && entry.row[c - 1] != null) ? String(entry.row[c - 1]) : ""; };
        const _rec = {
          sid: sid, gatewayId: _hf("Gateway_Order_ID"), name: _hf("Customer_Name"),
          phone: entry.phone || _hf("Phone"), amount: _hf("Net_Total"),
          date: _hf("Order_Date"), meal: _hf("Meal_Type"),
          // Full row into the log — restorable forever (reconcileMissedOrdersLog),
          // not just for the 60-min stash TTL or from the alert email.
          rowJson: (function () { try { return JSON.stringify(entry.row); } catch (e) { return ""; } })()
        };

        const okAttempt = _reappendUntilPresent(_tb.ws, _tb.sidCol, sid, entry.row, 5);
        if (okAttempt) {
          console.log("Emergency re-append CONFIRMED for " + sid + " (attempt " + okAttempt + ")");
          missed.push({ sid: sid, phone: entry.phone, row: entry.row, recovered: true });
          _rec.status = "Auto-recovered"; _rec.attempts = okAttempt;
          _logMissedOrderRow(ss, _rec);
          // KEEP the entry — a row can vanish again even after a confirmed re-append
          // (3-Jul ₹104 loss). It stays re-checkable every minute until the 60-min TTL.
        } else {
          console.error("Emergency re-append STILL MISSING for " + sid + " after retries — kept in queue for the next pass.");
          missed.push({ sid: sid, phone: entry.phone, row: entry.row, recovered: false });
          _rec.status = "STILL MISSING — enter manually"; _rec.attempts = 5;
          _logMissedOrderRow(ss, _rec);
          // Kept in PENDING_ORDER_ROWS — the reconciler's 1-min pass retries it.
        }
      }
      // NOTE: present-and-fine entries are also KEPT (not deleted) for the full 60-min
      // TTL, so a post-verification drop still has a live backup to re-append from.
      // TTL pruning below keeps the store from growing.
    });

    // Prune expired entries here too — this function now also runs from the 1-min
    // reconciler, which must not depend on the next submitOrder call to prune.
    const _vNow = Date.now();
    let _storeChanged = false;
    Object.keys(store).forEach(k => {
      if (_vNow - (store[k].ts || 0) > 60 * 60 * 1000) { delete store[k]; _storeChanged = true; }
    });
    // Only rewrite the property when something was actually pruned. This function
    // runs UNLOCKED every minute from the reconciler; an unconditional rewrite
    // races read-modify-write against a concurrent submitOrder's
    // _missedOrderSafetyNet and can WIPE a just-stored backup (last-writer-wins).
    if (_storeChanged) props.setProperty("PENDING_ORDER_ROWS", JSON.stringify(store));

    if (missed.length > 0) {
      // Email admin alert. Use MailApp (scope auth/script.send_mail — usually already
      // granted) instead of GmailApp (broad Gmail scopes that weren't authorized, so the
      // 29-Jun alerts silently failed and you got no warning).
      try {
        const adminEmail = PropertiesService.getScriptProperties().getProperty("ADMIN_EMAIL");
        if (adminEmail) {
          const anyLost = missed.some(m => m.recovered === false);
          const subject = anyLost
            ? "🚨 Svaadh: order row dropped — auto-recovery in progress"
            : "✅ Svaadh: missed order row auto-recovered & written";
          const body = missed.map(m =>
            (m.recovered === false ? "[NOT YET WRITTEN — auto-retry continues] " : "[✅ recovered & written] ") +
            `SK Order ID: ${m.sid}\nPhone: ${m.phone}\nRow data: ${JSON.stringify(m.row)}`
          ).join("\n\n---\n\n")
          + (anyLost
              ? "\n\nNo action needed yet: retries continue every minute (60 min) and the 10-min log reconciler "
                + "restores from the saved Row_JSON after that. You'll get a '✅ recovered & written' mail on success. "
                + "Enter manually ONLY if no ✅ mail arrives and the SK_Missed_Orders row stays non-✅."
              : "");
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
  // Storefront routing: storefront:"LS" writes to LS_Orders; absent/anything
  // else = main site (SK_Orders), byte-identical legacy behaviour.
  const _sf       = _lsStorefront(body);
  const _isLS     = (_sf === "LS");
  const ordersWs  = _lsOrdersWs(ss, _sf);
  const profile   = body.profile || {};
  const orders    = body.orders  || [];   // [{date, meals:[{type,items,notes,subtotal,area}]}]

  const submittedAt  = getISTTimestamp();
  let   payMethod    = body.payment_method  || "UPI";
  let   payStatus    = body.payment_status  || "Pending";
  const firstTime    = profile.isFirstTime ? "Yes" : "No";
  const payFreq      = profile.payment_preference || "Daily Payment";

  // ── OVERDUE ACCOUNT CHECK ─────────────────────────────────────
  // If customer is On Account (Monthly) and it is >= 10th of the month
  // with an unpaid bill from the previous month(s), completely block
  // them from placing new orders until the bill is paid.
  if (String(profile.onAccount || "").toLowerCase() === "yes" &&
      String(profile.billingCycle || "").toLowerCase() === "monthly") {
    if (typeof getOnAccountBill === "function") {
      const billInfo = getOnAccountBill(profile.phone);
      if (billInfo && billInfo.due && billInfo.isOverdue) {
        return {
          error: "Your previous month's bill is overdue. Please settle your outstanding balance of ₹" + billInfo.total + " to continue placing orders.",
          isOverdue: true
        };
      }
    }
  }


  // Build the header→index map once
  const hIdx = headerIndex(ordersWs);

  // Fetch free areas dynamically (replaces hardcoded FREE_AREA = "Bhosale Nagar")
  const freeAreaNames = getAreas().filter(function(a){ return a.free; }).map(function(a){ return a.name; });
  const DELIVERY  = 11;

  const submissionIds = [];

  // ── ONE-SHOT ROW FETCHES ────────────────────────────────────
  // Fetch once, share everywhere. Previously these tabs were re-read 5+ times
  // per submitOrder (day totals, loyalty, duplicate check, stock check, wallet).
  // SEPARATE BASES (owner decision 2026-08-25): each storefront reads ONLY its
  // own orders tab — identity, loyalty, day-totals and dup-guards never cross
  // pages. LS orders consume 0 delivery slots, so cap counting on the SK path
  // is unaffected (LS path skips caps entirely below).
  const allOrderRows  = getAllRows(ordersWs);
  const walletWsRef   = _walletTabFor(ss, _sf);   // LS orders draw from LS_Wallet
  const allWalletRows = getAllRows(walletWsRef);
  // Menu rows read once here — reused by stock check below (avoids duplicate sheet fetch)
  const menuWsOnce  = getOrCreateTab(ss, TAB_MENU, []);
  const menuRowsAll = getAllRows(menuWsOnce);

  // Fetch existing orders once for all dates in this submission to calculate combined-day fees/discounts
  const submissionDates = orders.map(o => o.date);
  const existingDayTotals = getDayTotalsForDates(profile.phone, submissionDates.join(','), allOrderRows).dayTotals || {};

  // Fetch current promo state (routed customers tab — LS customers live in LS_Customers)
  const custWs = _customersTabFor(ss, _sf);
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
      .replace(/\s*\(.*?\)\s*/g, '')   // removes (2 pieces), [100ml] etc.
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

  // ── Streak overflow guard (mirrors frontend order.html ~7574) ─────────
  // _calculateLoyaltyStreak can return streak >= 6 if an earlier cycle's
  // 6th-day reward was never written to the sheet (e.g. customer booked a
  // future date before the current date — the gap detection at THAT time
  // reset the streak, so is6thDay never fired, but the backward walk NOW
  // sees all 6+ days consecutively). Without this reset virtualStreakCount
  // stays > 5 and the === 5 check never matches again — the customer
  // permanently loses their loyalty reward. Reset to 0 so a new cycle
  // starts cleanly.
  if (virtualStreakCount >= 6) {
    virtualStreakCount = 0;
    virtualPastSurcharge = 0;
  }

  // ════ KITCHEN CLOSURE PRE-FLIGHT ════
  // Reject the entire submission if ANY ordered date has been marked
  // Kitchen Closed via the admin Daily Menu toggle. Customer calendar
  // already greys these days out — this is the defensive server guard.
  //
  // EXCEPTION — payment_method === "Gateway (HDFC)": by the time we get
  // here the customer has already paid on the HDFC-hosted page. Rejecting
  // would leave the money taken without an order in our sheet. Accept
  // the order and log a warning so admin can cancel + refund manually.
  // Per-MEAL kitchen-closure guard. A day can be closed for a single meal
  // (Closed_Meals_JSON) or fully (legacy Kitchen_Closed); block only the closed meal(s).
  const _findMenuRow = function (dateISO) {
    return menuRowsAll.find(function(mr) {
      const d = mr.Date instanceof Date
        ? Utilities.formatDate(mr.Date, "Asia/Kolkata", "yyyy-MM-dd")
        : String(mr.Date).trim();
      return d === dateISO;
    });
  };
  if (payMethod !== "Gateway (HDFC)" && payMethod !== "Split (HDFC)") {
    const closedHits = []; // [{date, meal}]
    for (const _o of orders) {
      const _menuForDate = _findMenuRow(_o.date);
      for (const _m of (_o.meals || [])) {
        const _mt = String(_m.type || "");
        if (_isMealKitchenClosed(_menuForDate, _mt)) closedHits.push({ date: _o.date, meal: _mt });
      }
    }
    if (closedHits.length) {
      return {
        success: false,
        kitchen_closed: true,
        closed_meals: closedHits,
        error: "The kitchen is closed for " + closedHits.map(function (h) { return h.meal + " on " + h.date; }).join(", ")
             + ". Please remove those from your cart and try again."
      };
    }
  } else {
    // Gateway path — log if a closed meal sneaks through, so admin can
    // catch it manually. Order still gets written.
    for (const _o of orders) {
      const _menuForDate = _findMenuRow(_o.date);
      for (const _m of (_o.meals || [])) {
        if (_isMealKitchenClosed(_menuForDate, String(_m.type || ""))) {
          console.warn("⚠️ Gateway-paid order accepted for KITCHEN-CLOSED " + _m.type + " on "
            + _o.date + " (phone " + profile.phone + ", gateway_order_id "
            + (body.gateway_order_id || "?") + "). Admin must manually cancel + refund this order.");
        }
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
      // LS storefront: caps never apply (single drop location, unlimited orders)
      // and LS orders count 0 slots, so cap counting uses SK-only rows.
      let _orderCapW = {};
      try { if (_menuRowW && _menuRowW.Order_Cap_JSON) _orderCapW = JSON.parse(_menuRowW.Order_Cap_JSON); } catch(e) {}
      // Site-wide default caps (B 11 / L 25 / D 25) apply to every date; positive
      // per-date values override. Counts are now always computed (caps always exist).
      _orderCapW = _effectiveOrderCaps(_orderCapW);
      let _capAltW = {};   // per-meal: offer Self Pickup / Porter when full? default ON
      try { if (_menuRowW && _menuRowW.Cap_Alt_JSON) _capAltW = JSON.parse(_menuRowW.Cap_Alt_JSON); } catch(e) {}
      const _capCountsW   = _isLS ? null : _countActiveMealOrders(allOrderRows, _d);
      const _delIdxW = _isLS ? null : _activeDeliveryIndex(allOrderRows, _d);
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
            // Owner-approved exempt LOCATIONS (WeWork; Cybercity Magarpatta towers
            // 1–12 — customers collect at the gate) keep delivery even at the cap.
            const _locExemptW = _isCapExemptLocation(_m.society || profile.society, _m.area || profile.area);
            // Shree Laxmi Vihar society — doesn't count toward cap AND never blocked
            // (owner-approved 2026-07-31, synced with _countActiveMealOrders).
            const _slvSocW = _normSocietyBase(String(_m.society || profile.society || ""));
            const _isSLVW = _slvSocW.indexOf("shreelaxmivihar") !== -1;
            // Per-meal bypass CAPPED MEAL keeps delivery even at the cap (big orders
            // are worth the slot) — but only while alternatives are ON; a cap_alt=false
            // HARD close (kitchen out of capacity) is never bypassed. Uses the
            // client-sent meal subtotal: worst-case tamper wins a delivery SLOT, never
            // money — the bill itself is priced authoritatively later/by the gateway.
            const _bypassMinW = CAP_DELIVERY_BYPASS_MIN[_mt] || 200;
            const _bigMealW = _altOnW && (Number(_m.subtotal) || 0) >= _bypassMinW;
            if (!_isFreeAreaW && !_bigMealW && !_locExemptW && !_isSLVW) {
              const _idxMtW = _delIdxW && _delIdxW[_mt];
              const _socW = _normSocietyKey(_m.society || profile.society || "");
              const _socAlreadyW  = !!(_socW && _idxMtW && _idxMtW.soc[_socW]);
              // This same customer already has a delivery for this date+meal →
              // adding more is the same stop, let them through past the cap.
              const _phW = _normalizePhone(profile.phone || "");
              const _selfAlreadyW = !!(_phW && _idxMtW && _idxMtW.ph[_phW]);
              if (!_socAlreadyW && !_selfAlreadyW) {
                _wViolations.push(_altOnW
                  ? (_mt + " delivery is full for " + _d + " — orders of ₹" + _bypassMinW + "+ still get delivery; else please choose Self Pickup or Porter, or order for another day.")
                  : (_mt + " is sold out for " + _d + " — the daily order limit has been reached."));
                continue;
              }
            }
            // free area OR ₹200+ meal OR WeWork/Cybercity-tower OR same-building OR own existing delivery → allowed (falls through)
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
  // LS storefront: NEVER blocked by stock (unlimited orders from the single
  // drop location) — but LS consumption still counts via combined rows, so it
  // depletes real stock for main-site customers too.
  if (!_isLS) {
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
          if (SABJI_COMBO_GROUPS[colKeyStk]) continue; // virtual combo entry — not a real item
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
        // Combo-aware check: Dry/Curry Sabji Mini+Full share a WEIGHTED pool (see
        // _applySabjiComboLimits) — an item can look fine on its OWN limit yet this
        // order could still push the group's combined weighted usage over the cap.
        // Authoritative (under lock, full-sheet counted) — never relies on the
        // client's units_remaining alone.
        Object.keys(SABJI_COMBO_GROUPS).forEach(function (comboKey) {
          const grp = SABJI_COMBO_GROUPS[comboKey];
          const comboLimit = Number(mealLimits[comboKey]);
          if (!comboLimit || comboLimit <= 0) return;
          const miniUsed = countedStk[mealStk.type][_stripItemSuffix(grp.Mini)] || 0;
          const fullUsed = countedStk[mealStk.type][_stripItemSuffix(grp.Full)] || 0;
          const reqMini = Number((mealItems.find(function (x) { return x.colKey === grp.Mini; }) || {}).qty) || 0;
          const reqFull = Number((mealItems.find(function (x) { return x.colKey === grp.Full; }) || {}).qty) || 0;
          if (reqMini <= 0 && reqFull <= 0) return;
          const newWeighted = (miniUsed + reqMini) * SABJI_COMBO_WEIGHTS.Mini + (fullUsed + reqFull) * SABJI_COMBO_WEIGHTS.Full;
          if (newWeighted > comboLimit) {
            const budget = Math.max(0, comboLimit - (miniUsed * SABJI_COMBO_WEIGHTS.Mini + fullUsed * SABJI_COMBO_WEIGHTS.Full));
            stockConflicts.push({
              date: dateStrStk, meal: mealStk.type,
              colKey: grp.label + " (combined Mini+Full limit)",
              available: Math.floor(budget / Math.min(SABJI_COMBO_WEIGHTS.Mini, SABJI_COMBO_WEIGHTS.Full)) // informational
            });
          }
        });
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
  let isDebtRecovery = false;
  
  const serverBal = _calculateWalletBalance(profile.phone, allWalletRows);
  if (serverBal < 0 && payMethod !== "On Account") {
    splitWalletBudget = serverBal;
    isDebtRecovery = true;
  } else if (String(payMethod) === "Split") {
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
      const sid = generateSubmissionID(_isLS ? "LS" : undefined);
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
      if (!isFeeExempt && !isDayFree && !isPickup && !isPorter && !isFreeArea && !_lsDeliveryFree(_sf) && sub > 0) {
        delCharge = DELIVERY;
      }
      let smallOrderFee = 0;
      // LS storefront: NO fees at all (owner 2026-08-25 — free delivery AND no small-order fee)
      if (!isFeeExempt && !isDayFree && !isPickup && !isPorter && !_lsDeliveryFree(_sf) && (mealType === "Lunch" || mealType === "Dinner") && sub > 0 && combinedMealSub < (PRICING_V2 ? 53 : 50)) {
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
      const society = isPickup ? "" : (meal.society || profile.society || (_isLS ? LS_SOCIETY_NAME : ""));
      const area    = isPickup ? "Self Pickup" : (isPorter ? "Porter" : mealArea);

      const _custAddrLine = [wing && `Wing ${wing}`, flat && `Flat ${flat}`, floor && `${floor} Floor`, society].filter(Boolean).join(", ");
      const fullAddr = isPickup
                        ? _lsPickupLabel(_sf)
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
      set("Customer_Name",       _isLS ? "[LS] " + (profile.name || "") : (profile.name || ""));
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
      // Namespaced per storefront — the script-wide cache is shared, and a key
      // collision between tabs would false-dedupe a legitimate LS order (or vice versa).
      const _dupKey      = `dup_${_isLS ? "ls" : "sk"}_${_normPhone}_${_normDate(orderDate)}_${mealType}_${_incomingSig}`;
      const _cache       = CacheService.getScriptCache();

      // Layer 1: cache lookup — TRUST BUT VERIFY. The key is reserved BEFORE the
      // row write (below), so an execution that dies between the reservation and
      // its appendRow leaves a POISONED cache entry claiming a row that never
      // existed. Every retry (browser + reconciler) then got silently "deduped"
      // into a success, the reconciler deleted the stash as done, and the paid
      // order became unrecoverable with no alert (3-Jul ₹104 + 6-Jul ₹301 losses).
      // Fix: only honour the cache when the claimed sid is actually IN the sheet
      // (allOrderRows was snapshotted under the script lock, so any committed row
      // is in it). A poisoned hit falls through to layers 2/3 and gets written.
      const _cachedSid = _cache.get(_dupKey);
      if (_cachedSid) {
        const _sidReal = allOrderRows.some(function (r) {
          return String(r.Submission_ID || "").trim().toUpperCase() === String(_cachedSid).trim().toUpperCase();
        });
        if (_sidReal) {
          submissionIds[submissionIds.length - 1] = _cachedSid;
          // Skipped duplicate — back out this meal's in-memory mutations so the
          // retry doesn't burn a promo use or double-credit the wallet surplus.
          if (reviewDiscount > 0) promoCount++;
          if (mealSurplus > 0) loyaltyExcessCredit -= mealSurplus;
          console.log("Duplicate caught by cache: " + _dupKey + " → " + _cachedSid);
          continue;
        }
        console.warn("POISONED dup-cache entry for " + _dupKey + " (sid " + _cachedSid
          + " not in sheet — a previous execution died before its write). Proceeding to write.");
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
      if (isDebtRecovery && splitWalletBudget < 0) {
        // Collect the entire debt on this first meal
        walletCreditUsed = splitWalletBudget;
        _appendWalletTransaction(profile.phone || "", profile.name || "Customer", "Debt Recovery Recharge", Math.abs(splitWalletBudget), true, sid, _sf);
        allWalletRows.push({ Phone: _normalizePhone(profile.phone), Txn_Type: "Debt Recovery Recharge", Amount: Math.abs(splitWalletBudget), Verified: "TRUE" });
        splitWalletBudget = 0; // Collected, don't collect on subsequent meals
      } else if (payMethod === "Wallet") {
        let currentBalance = _calculateWalletBalance(profile.phone, allWalletRows);

        if (currentBalance >= netTotal) {
          _appendWalletTransaction(profile.phone || "", profile.name || "Customer", "Order Deduction", netTotal, true, sid, _sf);
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
            _appendWalletTransaction(profile.phone || "", profile.name || "Customer", _txnLabel, deduct, true, sid, _sf);
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
      set("Source",              _isLS ? "LS" : "WebApp");

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
      _missedOrderSafetyNet(ss, sid, row, profile.phone, ordersWs.getName());  // safety net — verify write succeeded
    }
  }

  // Force all buffered Sheets writes to disk before returning success
  SpreadsheetApp.flush();

  // Verify every row we just wrote actually landed; auto-recover + email if not
  _verifyAndAlertMissedOrders(ss, submissionIds);

  // Upsert customer record
  _upsertCustomer(ss, profile, _sf);
  // Stamp Last_Order_At so the idle-customer archiver (05_Customer_Archive.gs)
  // never archives someone who just ordered.
  if (typeof updateCustomerLastOrder === "function") updateCustomerLastOrder(profile.phone, _sf);

  // If user requested to settle ALL pending dues in this same transaction
  if (body.settle_all && payMethod === "Wallet") {
    _settlePendingInternal(ss, profile.phone, profile.name || "Customer");
  }

  if (payFreq === "Prepaid Wallet" || payFreq.includes("10 days") || payFreq.includes("Wallet")) {
    // try { _updateLedger(ss, profile, orders); } catch(e) { /* non-fatal */ } // Disabled to save Drive space
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
      loyaltyExcessCredit, true, submissionIds[0] || "", _sf
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
// STRICT Google-Maps-only sanitation (mirror of the frontend _isGoogleMapsLink).
// A non-Google-Maps value is dropped to "" — Maps_Link then falls back to the
// auto-derived link, so junk can never reach the driver page. Server-side so a
// bypassed/stale client can't store garbage either.
function _sanitizeMapsLink(v) {
  v = String(v || "").trim();
  if (!v) return "";
  return /^(https?:\/\/)?(www\.)?(maps\.app\.goo\.gl\/|goo\.gl\/maps\/|maps\.google\.(com|co\.[a-z]{2}|[a-z]{2})(\/|\?|$)|google\.(com|co\.[a-z]{2}|[a-z]{2})\/maps)/i.test(v) ? v : "";
}

function _upsertCustomer(ss, profile, storefront) {
  // Ensure tab exists and headers are correct before doing anything.
  // Storefront routing: LS customers live in LS_Customers (separate base).
  const ws = _customersTabFor(ss, storefront);
  SpreadsheetApp.flush(); // Lock in the headers before indexing

  // Sanitize maps links up front — the profile's own link and each per-meal one.
  if (profile.maps !== undefined) profile.maps = _sanitizeMapsLink(profile.maps);
  if (profile.meal_addresses) {
    try {
      const _ma = JSON.parse(profile.meal_addresses);
      ["Breakfast", "Lunch", "Dinner"].forEach(function (m) {
        if (_ma[m] && _ma[m].maps !== undefined) _ma[m].maps = _sanitizeMapsLink(_ma[m].maps);
      });
      profile.meal_addresses = JSON.stringify(_ma);
    } catch (e) { /* malformed JSON — leave as-is; nothing reads it blindly */ }
  }

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
    // GUARD: Self Pickup / Porter are TEMPORARY delivery overrides (cap-full flow) —
    // they must NOT overwrite the customer's real saved address. When the profile
    // arrives with one of these as the area, skip ALL address field updates so the
    // customer's original address stays intact for future orders.
    const _isNonDeliveryArea = /pickup|porter/i.test(String(profile.area || ""));
    if (!_isNonDeliveryArea) {
      if (profile.area !== undefined) update("Area",          profile.area);
      if (profile.wing !== undefined) update("Wing",          profile.wing);
      if (profile.flat !== undefined) update("Flat",          profile.flat);
      if (profile.floor !== undefined) update("Floor",         profile.floor);
      if (profile.society !== undefined) update("Society",       profile.society);
      if (profile.area !== undefined || profile.society !== undefined) update("Full_Address",  fullAddr);
    }
    if (!_isNonDeliveryArea) {
      // Auto-derive Maps Link if missing
      let finalMaps = profile.maps || "";
      if (!finalMaps) {
        finalMaps = _deriveMapsLink(fullAddr, profile.society || "");
      }
      update("Maps_Link", finalMaps);

      if (profile.landmark !== undefined) update("Landmark",      profile.landmark || "");
    }
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
        update("PIN", profile.pin !== undefined && profile.pin !== "" ? "'" + String(profile.pin).trim() : profile.pin);
      } else {
        console.warn("⚠️ PIN overwrite BLOCKED for " + pStr + " — existing PIN not replaced (takeover guard).");
      }
    }
    // Refresh whenever the field is PRESENT (was `if (profile.meal_addresses)`,
    // which skipped the empty string old single-address clients send — so an
    // address edit left the stored Meal_Addresses stale with the OLD address
    // forever). New clients always send the full JSON for both address modes.
    // GUARD: Skip when Self Pickup / Porter — the JSON would contain the temporary
    // non-delivery area for every meal, wiping the customer's real addresses.
    if (profile.meal_addresses !== undefined && !_isNonDeliveryArea) update("Meal_Addresses", profile.meal_addresses);
    if (profile.standardOrder !== undefined) update("Standard_Order", profile.standardOrder);
    if (profile.onAccount !== undefined) update("On_Account", profile.onAccount);
    if (profile.billingCycle !== undefined) update("Billing_Cycle", profile.billingCycle);
    // Email (for Forgot-PIN OTP). Only overwrite with a VALID address; a blank/invalid
    // value never wipes a stored email (guards against a client sending "" on a partial save).
    if (profile.email !== undefined) {
      const _em = _sanitizeEmail(profile.email);
      if (_em) update("Email", _em);
    }

    SpreadsheetApp.flush(); // Ensure writes are committed
  } else {
    // ── Auto-flag Enkin accounts ──────────────────────────────────
    // New users whose last name is "Enkin" (case-insensitive) are
    // automatically set to On Account, Fee Exempt, Monthly billing.
    const _nameParts = String(profile.name || "").trim().split(/\s+/);
    const _isEnkin = _nameParts.length > 0 && _nameParts[_nameParts.length - 1].toLowerCase() === "enkin";
    if (_isEnkin) {
      profile.onAccount = "Yes";
      profile.billingCycle = "Monthly";
      profile.payment_preference = "Monthly";
    }

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
        case "Fee_Exempt":      val = _isEnkin ? "Yes" : ""; break;
        case "Email":           val = _sanitizeEmail(profile.email); break;
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
function getDayTotalsForDates(phone, datesParam, preloadedRows, storefront) {
  if (!phone || !datesParam) return { dayTotals: {} };
  const dates = String(datesParam).split(',').map(d => d.trim()).filter(Boolean);
  const ss = getSpreadsheet();
  // SEPARATE BASES: default read is the storefront's OWN orders tab only.
  const ws = (typeof _lsOrdersWs === "function") ? _lsOrdersWs(ss, storefront) : getOrCreateTab(ss, TAB_ORDERS, ORDERS_HEADERS);
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
      // Include dates with FULL-DAY closure OR ANY per-meal closure.
      // When admin closes even one meal, that day should never break a
      // customer's loyalty streak — the customer didn't choose to skip.
      const isClosed = (r.Kitchen_Closed === true || String(r.Kitchen_Closed || "").toLowerCase() === "true");
      var hasPartial = false;
      if (!isClosed && r.Closed_Meals_JSON) {
        try {
          var cm = JSON.parse(r.Closed_Meals_JSON);
          hasPartial = !!(cm && (cm.Breakfast || cm.Lunch || cm.Dinner));
        } catch (e) {}
      }
      if (!isClosed && !hasPartial) return;
      const d = r.Date instanceof Date ? Utilities.formatDate(r.Date, "Asia/Kolkata", "yyyy-MM-dd") : String(r.Date).trim();
      if (d) out.push(d);
    });
    return { dates: out };
  });
  const set = {};
  (data.dates || []).forEach(function(d) { set[d] = true; });
  return set;
}

// Meal-aware version: { "yyyy-MM-dd": {Breakfast,Lunch,Dinner bools} } for every date
// with ANY meal closed (full-day ⇒ all three). Used by bulk windows so a lunch-closed
// day is skipped from a bulk LUNCH order but a dinner-only order still runs that day.
function _kitchenClosedMealSet() {
  const data = _cachedData("kitchen_closed_mealset_v1", 60, function() {
    const ss = getSpreadsheet();
    const ws = getOrCreateTab(ss, TAB_MENU, []);
    const map = {};
    getAllRows(ws).forEach(function(r) {
      const cm = _closedMealsObj(r);
      if (!cm.Breakfast && !cm.Lunch && !cm.Dinner) return;
      const d = r.Date instanceof Date ? Utilities.formatDate(r.Date, "Asia/Kolkata", "yyyy-MM-dd") : String(r.Date).trim();
      if (d) map[d] = cm;
    });
    return { map: map };
  });
  return data.map || {};
}

function _calculateLoyaltyStreak(phone, preloadedRows, storefront) {
  if (!phone) return { streak: 0, pastSurcharge: 0 };
  const ss = getSpreadsheet();
  // SEPARATE BASES: streak history comes from the storefront's OWN orders tab
  // only — an LS customer's cycle never mixes with main-site orders.
  const ws = (typeof _lsOrdersWs === "function") ? _lsOrdersWs(ss, storefront) : getOrCreateTab(ss, TAB_ORDERS, ORDERS_HEADERS);
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

    // Fix: We must NOT ignore future dates here. Doing so hides already-issued 
    // future rewards from the calculation and causes double-rewards when subsequent
    // bookings overlap those dates.
    
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
  
  let maxDate = todayISO;
  Object.keys(dailyTotals).forEach(k => {
    if (k > maxDate) maxDate = k;
  });

  let streakCount = 0;
  let accumulatedSurcharge = 0;
  let streakEndDate = null; // most-recent counted day = the streak's end (used for gap checks at submit time)

  const closedSet = _kitchenClosedSet(); // admin days-off — skipped like Sundays, never break the streak
  // Start walking backward from the LATEST date the customer has an order,
  // or TODAY (whichever is later). This ensures we don't miss future streaks.
  let d = new Date(maxDate + "T12:00:00"); 
  let gapAllowed = true;
  let safety = 0;
  while (safety < 40) {
    safety++;
    const iso = Utilities.formatDate(d, "Asia/Kolkata", "yyyy-MM-dd");
    if (dailyTotals[iso] !== undefined) {
      if (rewardDays.has(iso)) {
        // This day was a 6th-day reward day — it marks the END of the previous cycle.
        // Don't count it; the new cycle starts from the day after it.
        break;
      }
      streakCount++;
      if (!streakEndDate) streakEndDate = iso; // walking backward → first counted day is the most recent
      accumulatedSurcharge += dailyTotals[iso];
      gapAllowed = false; // Once we hit a solid order, any subsequent gap breaks the streak
    } else {
      if (d.getDay() === 0 || closedSet[iso]) { // Skip Sunday OR admin-closed day — don't break streak
        d.setDate(d.getDate() - 1);
        continue;
      }
      if (iso < todayISO) {
        break; // A gap on a past day ALWAYS breaks the streak
      } else if (!gapAllowed) {
        break; // A gap on today/future ALSO breaks if we already saw an order in the future
      }
    }
    d.setDate(d.getDate() - 1);
  }

  // If the very latest day in the cycle already received the reward, reset to 0.
  if (rewardDays.has(maxDate)) {
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
  // SEPARATE BASES: timeout recovery checks the storefront's OWN tab only.
  const rows = (typeof _lsOrdersWs === "function") ? getAllRows(_lsOrdersWs(ss, _lsStorefront(body))) : getAllRows(getOrCreateTab(ss, TAB_ORDERS, []));

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

function getCustomerOrders(phone, storefront) {
  if (!phone) return {orders:[], past_orders:[], wallet_balance: 0};
  const ss = getSpreadsheet();
  // SEPARATE BASES: a customer sees the orders of the storefront they're on.
  const rows = (typeof _lsOrdersWs === "function") ? getAllRows(_lsOrdersWs(ss, storefront)) : getAllRows(getOrCreateTab(ss, TAB_ORDERS, ORDERS_HEADERS));
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
      const _isBulkRow = String(r.Source || "").trim() === "Bulk" || !!String(r.Batch_ID || "").trim();
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
        // Bulk postpone support (Manage Orders): the frontend derives remaining quota
        // per (batch, meal) from these across the returned rows.
        is_bulk:            _isBulkRow,
        batch_id:           String(r.Batch_ID || "").trim(),
        bulk_plan:          _isBulkRow ? String(r.Bulk_Plan || "").trim() : "",
        bulk_postponed:     _isBulkRow ? !!String(r.Bulk_Postponed || "").trim() : false,
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

  // ── Compact streak history for the loyalty engine ─────────────
  // past_orders is capped at 10 ROWS for the UI, but a 3-meal/day customer's
  // 10 rows span barely 3 days — far too short for the 6-day streak math. The
  // 12-Jul incident: the frontend couldn't see that the last past day was day 6
  // of a full streak, carried its already-redeemed accruals into the next cart,
  // and over-promised the reward by ₹16 (display 587 vs authoritative 603).
  // These rows carry ONLY the four fields the streak engine reads, so 45 rows
  // (~15 days for a 3-meal customer) stay tiny on the wire.
  const streakRows = allFiltered
    .filter(r => fmtD(r) < today)
    .sort((a,b) => fmtD(b).localeCompare(fmtD(a))) // newest first
    .slice(0, 45)
    .map(r => ({
      date:                fmtD(r),
      inflation_surcharge: Number(r.Inflation_Surcharge) || 0,
      loyalty_discount:    String(r.Loyalty_Discount || "").trim().toLowerCase() === "yes",
      payment_status:      r.Payment_Status
    }));

  const onAccountBalance = allFiltered
    .filter(r => _isOnAccountDueStatus(r.Payment_Status))
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
    streak_rows: streakRows,
    wallet_balance: _calculateWalletBalance(phone, undefined, storefront),
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

// Site-wide default cutoff hours, editable without a redeploy via the admin panel
// (or directly in the SK_Default_Cutoffs sheet — one row, columns Breakfast/Lunch/
// Dinner, decimal hours e.g. 16.5 = 4:30 PM). Falls back to the original hardcoded
// defaults if the sheet is empty/missing. Cached 5 min since _effectiveCutoffsForDate
// runs on nearly every menu/order request. ALWAYS returns a fresh object — callers
// (like _effectiveCutoffsForDate below) mutate it with per-day overrides.
function _getDefaultCutoffs() {
  var FALLBACK = { Breakfast: 7, Lunch: 9, Dinner: 16.5 };
  try {
    var hit = CacheService.getScriptCache().get("default_cutoffs_v1");
    if (hit !== null) return JSON.parse(hit);
  } catch (e) {}
  var out = { Breakfast: FALLBACK.Breakfast, Lunch: FALLBACK.Lunch, Dinner: FALLBACK.Dinner };
  try {
    var ws = getOrCreateTab(getSpreadsheet(), TAB_DEFAULT_CUTOFFS, ["Breakfast", "Lunch", "Dinner"]);
    if (ws.getLastRow() >= 2) {
      var vals = ws.getRange(2, 1, 1, 3).getValues()[0];
      ["Breakfast", "Lunch", "Dinner"].forEach(function (k, i) {
        var n = Number(vals[i]);
        if (vals[i] !== "" && !isNaN(n)) out[k] = n;
      });
    }
  } catch (e) {}
  try { CacheService.getScriptCache().put("default_cutoffs_v1", JSON.stringify(out), 300); } catch (e) {}
  return out;
}

// Admin panel read (current site-wide defaults).
function getDefaultCutoffs() {
  return { success: true, defaults: _getDefaultCutoffs() };
}

// Admin panel write — updates the SK_Default_Cutoffs sheet (one row) and busts the
// cache so the new defaults apply immediately. Does NOT touch any per-day override in
// SK_Daily_Menu — those still win for their specific date, exactly as before.
function setDefaultCutoffs(body) {
  var b = Number(body && body.breakfast), l = Number(body && body.lunch), d = Number(body && body.dinner);
  if (isNaN(b) || isNaN(l) || isNaN(d)) return { success: false, error: "Invalid cutoff hour(s)." };
  var ws = getOrCreateTab(getSpreadsheet(), TAB_DEFAULT_CUTOFFS, ["Breakfast", "Lunch", "Dinner"]);
  if (ws.getLastRow() < 2) ws.appendRow([b, l, d]);
  else ws.getRange(2, 1, 1, 3).setValues([[b, l, d]]);
  try { CacheService.getScriptCache().remove("default_cutoffs_v1"); } catch (e) {}
  return { success: true, defaults: { Breakfast: b, Lunch: l, Dinner: d } };
}

// ── DEFAULT DELIVERY CAPS (admin-editable via SK_Default_Caps sheet) ──────
// Same pattern as _getDefaultCutoffs: single row, 3 columns, 5-min cache.
// Falls back to the hardcoded DEFAULT_ORDER_CAPS constant if the sheet is
// empty/missing. _effectiveOrderCaps (Code.gs) reads this instead of the
// constant directly so the admin can change caps without a redeploy.
function _getDefaultOrderCaps() {
  try {
    var hit = CacheService.getScriptCache().get("default_caps_v1");
    if (hit !== null) return JSON.parse(hit);
  } catch (e) {}
  var out = { Breakfast: DEFAULT_ORDER_CAPS.Breakfast, Lunch: DEFAULT_ORDER_CAPS.Lunch, Dinner: DEFAULT_ORDER_CAPS.Dinner };
  try {
    var ws = getOrCreateTab(getSpreadsheet(), TAB_DEFAULT_CAPS, ["Breakfast", "Lunch", "Dinner"]);
    if (ws.getLastRow() >= 2) {
      var vals = ws.getRange(2, 1, 1, 3).getValues()[0];
      ["Breakfast", "Lunch", "Dinner"].forEach(function (k, i) {
        var n = Number(vals[i]);
        if (vals[i] !== "" && !isNaN(n) && n > 0) out[k] = n;
      });
    }
  } catch (e) {}
  try { CacheService.getScriptCache().put("default_caps_v1", JSON.stringify(out), 300); } catch (e) {}
  return out;
}

// Admin panel read (current site-wide default delivery caps).
function getDefaultOrderCaps() {
  return { success: true, defaults: _getDefaultOrderCaps() };
}

// Admin panel write — updates the SK_Default_Caps sheet (one row) and busts the
// cache so the new defaults apply immediately. Does NOT touch any per-day
// Order_Cap_JSON override — those still win for their specific date.
function setDefaultOrderCaps(body) {
  var b = Number(body && body.breakfast), l = Number(body && body.lunch), d = Number(body && body.dinner);
  if (isNaN(b) || b < 0 || isNaN(l) || l < 0 || isNaN(d) || d < 0)
    return { success: false, error: "Invalid cap value(s)." };
  var ws = getOrCreateTab(getSpreadsheet(), TAB_DEFAULT_CAPS, ["Breakfast", "Lunch", "Dinner"]);
  if (ws.getLastRow() < 2) ws.appendRow([b, l, d]);
  else ws.getRange(2, 1, 1, 3).setValues([[b, l, d]]);
  try { CacheService.getScriptCache().remove("default_caps_v1"); } catch (e) {}
  return { success: true, defaults: { Breakfast: b, Lunch: l, Dinner: d } };
}

// Effective cancel/order cutoff HOURS (IST, since midnight) for a date —
// the admin's per-date override from SK_Daily_Menu if set, else the SITE-WIDE
// defaults (_getDefaultCutoffs — admin-editable, see above).
function _effectiveCutoffsForDate(date) {
  var cutoffs = _getDefaultCutoffs();
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
  // Cancellations must find orders from EITHER storefront (shared identity).
  // Each row carries _ws (its source sheet); ALL writes go through _wsOf/_hOf
  // so an LS row is updated in LS_Orders, never by SK row-index accident.
  // SEPARATE BASES note: cancellation must scan BOTH tabs (admin cancels from
  // vault_admin which serves both storefronts; customer cancels find their own).
  const rows = _getAllOrdersBothTabsIfPresent(ss);
  const _wsOf = (x) => x._ws || ws;
  const _hOf  = (x) => headerIndex(_wsOf(x));
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
      const hIdxR = _hOf(r);
      const statusColR = hIdxR["Payment_Status"] || hIdxR["Payment Status"];
      if (statusColR && !_isOrderCancelled(r.Payment_Status)) {
        _wsOf(r).getRange(r._row, statusColR).setValue("Cancelled \u2013 UPI Refund Pending");
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
      // Admin cancel (kitchen close) → NO bulk discount clawback. Full refund.
      bulkClawbackApplied = isAdminCall ? 0 : (Math.min(_totalBulk, _sumBefore + bulkFullPrice) - Math.min(_totalBulk, _sumBefore));
    }

    // Over-discount claw-back: only claw back discounts that were ACTUALLY applied
    // to remaining orders (read from their Discount_Amount column), not a theoretical
    // volume tier. submitOrder only applies loyalty (6th-day) discounts, not volume tiers.
    // ADMIN CANCEL: skip entirely — remaining orders keep their discounts untouched.
    let overDiscount = 0;
    if (!isAdminCall) {
      // Per-row column maps — sameDayRows may span both storefront tabs.
      const _colIn = (x, name) => { const h = _hOf(x); return h[name]; };

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
          if (overDiscount > 0 && !opts.dryRun) {
            sameDayRows.forEach(x => {
              const xSub      = Number(x.Food_Subtotal)       || 0;
              const xSurcharge= Number(x.Inflation_Surcharge) || 0;
              const xDelivery = Number(x.Delivery_Charge)     || 0;
              const xSmallFee = Number(x.Small_Order_Fee)     || 0;
              const xReviewD  = Number(x.Review_Discount)     || 0;
              const newNetTotal = xSub + xDelivery + xSmallFee + xSurcharge - xReviewD; // discount = 0
              const discIdx = _colIn(x, "Discount_Amount");
              const netIdx  = _colIn(x, "Net_Total");
              if (discIdx) _wsOf(x).getRange(x._row, discIdx).setValue(0);
              if (netIdx)  _wsOf(x).getRange(x._row, netIdx) .setValue(newNetTotal);
            });
          }
        }
      }
    }

    // Delivery & Fee eligibility for remaining same-day orders.
    // Mirrors submitOrder's DYNAMIC threshold (1 meal → ₹100, 2+ meals → ₹150):
    // the day WAS free under its old meal-count threshold but the REMAINING
    // orders no longer qualify under theirs → fees are owed.
    // ADMIN CANCEL: skip entirely — remaining orders keep free delivery / no small fee.
    // The customer should not suffer because admin closed the kitchen.
    let deliveryOwed = 0;
    let smallFeeOwed = 0;
    // Hoisted to function scope — buildRefundBreakdown() (below) interpolates
    // remThreshold in its customer-facing lines. It was previously const-scoped
    // inside this block, so ANY wallet/UPI cancellation that triggered the fee
    // clawback crashed mid-flow (refund txn written, order left un-cancelled).
    // Caught by the cross-tab cancel harness 2026-08-24; fix is scope-only —
    // no math changes.
    let remThreshold = 0;

    if (!isAdminCall) {
      const _mealsIn = (rowsArr) => new Set(
        rowsArr.filter(x => (Number(x.Food_Subtotal) || 0) > 0)
               .map(x => String(x.Meal_Type).trim())
      ).size;
      const oldThreshold = _mealsIn(sameDayRows.concat([r])) <= 1 ? 100 : 150;
      remThreshold = _mealsIn(sameDayRows) <= 1 ? 100 : 150;
      const freeAreaNames2 = getAreas().filter(a => a.free).map(a => a.name);
      const isNonFree = (area) => !freeAreaNames2.includes(area) && area !== "Self Pickup";

      if (!isBulk && oldDaySubtotal >= oldThreshold && remainingDaySubtotal < remThreshold) {
        // Day total drops below free-delivery threshold → remaining orders now owe fees.
        // We claw the amounts from THIS refund, AND update those rows in the sheet so that
        // if they are later cancelled themselves, the clawback doesn't fire a second time.
        sameDayRows.forEach(x => {
          const xArea = x.Area || "";
          const xSub  = Number(x.Food_Subtotal) || 0;
          let netDelta = 0;
          const xH = _hOf(x), xWs = _wsOf(x);
          // LS storefront rows: delivery is ALWAYS free and no small-order fee —
          // never claw fees back onto them (fix 2026-08-26).
          const xIsLS = !!x._lsTab;

          // 1. Delivery Clawback: order was in non-free area but charged ₹0 due to threshold
          if (!xIsLS && xSub > 0 && isNonFree(xArea) && (Number(x.Delivery_Charge) || 0) === 0) {
            deliveryOwed += 11;
            netDelta += 11;
            const delivIdx = xH["Delivery_Charge"];
            if (delivIdx && !opts.dryRun) xWs.getRange(x._row, delivIdx).setValue(11);
          }

          // 2. Small Order Fee Clawback: Lunch/Dinner sub < ₹53 was waived due to threshold
          const xMeal = String(x.Meal_Type).trim();
          if (!xIsLS && (xMeal === "Lunch" || xMeal === "Dinner") && xSub > 0 && xSub < (PRICING_V2 ? 53 : 50)
              && (Number(x.Small_Order_Fee) || 0) === 0) {
            smallFeeOwed += 11;
            netDelta += 11;
            const smallIdx = xH["Small_Order_Fee"];
            if (smallIdx && !opts.dryRun) xWs.getRange(x._row, smallIdx).setValue(11);
          }

          // Update Net_Total on remaining row to reflect newly owed fees (prevents double-clawback).
          // FIX (stale-read): RE-READ the stored Net_Total instead of trusting the
          // in-memory snapshot — the over-discount block above may have already
          // rewritten it (discount zeroed). Using the stale value silently dropped
          // the discount restore whenever BOTH clawbacks fired on the same row
          // (net stored 68 instead of 71 → a later cancel of that row under-refunds ₹3).
          const netIdx2 = xH["Net_Total"];
          if (netDelta > 0 && netIdx2 && !opts.dryRun) {
            const _curNet = Number(xWs.getRange(x._row, netIdx2).getValue()) || 0;
            xWs.getRange(x._row, netIdx2).setValue(_curNet + netDelta);
          }
        });
      }
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
          const pH = _hOf(payoffRow), pWs = _wsOf(payoffRow);
          const discColL = pH["Discount_Amount"];
          const netColL  = pH["Net_Total"];
          if (discColL && netColL) {
            pWs.getRange(payoffRow._row, discColL).setValue(0);
            pWs.getRange(payoffRow._row, netColL).setValue((Number(payoffRow.Net_Total) || 0) + loyaltyClawback);
          }
        }
      }
    }

    // Refund = Net_Total − adjustment
    // Net_Total already correctly encodes: food + delivery + fees + surcharge − discount − mealCredit − reviewDiscount
    // Bulk uses the commitment-discount clawback (fullPrice − bulk clawback); regular
    // orders use Net_Total − same-day/loyalty adjustments.
    const adjustment = (isBulk && !isAdminCall) ? bulkClawbackApplied : (overDiscount + deliveryOwed + smallFeeOwed + loyaltyClawback);
    const rawRefund  = (isBulk && !isAdminCall) ? bulkFullPrice : (Number(r.Net_Total) || 0);
    const netRefund = rawRefund - adjustment;           // may be negative
    const refundAmt = Math.max(0, netRefund);           // amount actually returned
    const cancellationCharge = Math.max(0, -netRefund); // deficit charged to wallet if order < clawback

    // ── HUMAN-READABLE REFUND BREAKDOWN ────────────────────────────────────
    function buildRefundBreakdown() {
      const lines = [];
      if (isBulk) {
        if (isAdminCall) {
          lines.push(`Full refund of ₹${refundAmt} (admin cancellation — your bulk plan discount on remaining days is preserved).`);
        } else if (bulkClawbackApplied > 0) {
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
        _appendWalletTransaction(phone, custName, "Order Cancellation Refund", refundAmt, true, String(rowId), r._lsTab ? "LS" : "");
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
        cancellationCharge, true, String(rowId), r._lsTab ? "LS" : "");
    }

    if (finalType === "wallet") {
      if (refundAmt > 0) {
        _appendWalletTransaction(phone, custName, "Order Cancellation Refund", refundAmt, true, String(rowId), r._lsTab ? "LS" : "");
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
    const _rWs = _wsOf(r);
    let hIdx = headerIndex(_rWs);
    
    // Robust header detection (support both underscores and spaces)
    const statusCol = hIdx["Payment_Status"] || hIdx["Payment Status"];
    
    if (!hIdx["Refund_Preference"]) {
      const col = _rWs.getLastColumn() + 1;
      _rWs.getRange(1, col).setValue("Refund_Preference")
        .setFontWeight("bold").setBackground("#c0392b").setFontColor("white");
      hIdx = headerIndex(_rWs);
    }
    const prefCol = hIdx["Refund_Preference"];
    
    if (statusCol && prefCol) {
      _rWs.getRange(r._row, statusCol).setValue("Cancelled (Verify UPI)");
      // Split orders: refund preference is always wallet (full amount back to wallet)
      const isSoftSplit = String(r.Payment_Method || "").trim().toLowerCase() === "split";
      _rWs.getRange(r._row, prefCol).setValue(isSoftSplit ? "wallet" : refundType);
      console.info(`SUCCESS: Soft-cancelled row ${r._row} with preference ${isSoftSplit ? "wallet (split)" : refundType}`);

      // For split orders: wallet portion is already deducted — refund it immediately.
      // UPI portion will be added to wallet once admin verifies.
      let softCancelMsg = "Cancellation request received! Admin will verify your payment and process the refund (1-2 days). ✅";
      if (isSoftSplit) {
        const walletCredit = Number(r.Wallet_Credit) || 0;
        const upiDue = Math.max(0, (Number(r.Net_Total) || 0) - walletCredit);
        if (walletCredit > 0) {
          _appendWalletTransaction(phone, r.Customer_Name || "Customer", "Order Cancellation Refund (Wallet Part)", walletCredit, true, String(rowId), r._lsTab ? "LS" : "");
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
    const _fWs = _wsOf(r);
    const hIdxFinal = headerIndex(_fWs);
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
      _fWs.getRange(r._row, statusColFinal).setValue(cancelRemark);
      console.info(`ORDER SOFT-CANCELLED: Row ${r._row} (${rowId}) marked as '${cancelRemark}'`);
    } else {
      console.error(`SOFT-CANCEL FAILED: Payment_Status column not found in header index.`);
    }
  }

  return {success: true, message: msg + "\n\n💡 Most refunds are processed on the same day. It might not show immediately in your payment app, but will appear in your bank statement — you may also receive an SMS confirmation."};
}





// ── FIX CUSTOMER PINS: scan SK_Customers + LS_Customers for PINs that were ──
// coerced to numbers by Google Sheets (e.g. "0001" → 1). Re-writes them as
// text with the original leading zeros restored. DRY-RUN by default.
// Known PIN lengths: 4 digits (standard). Pads with zeros to 4 digits.
function fixCustomerPins(commit) {
  var ss = getSpreadsheet();
  var results = { sk: { scanned: 0, fixed: 0 }, ls: { scanned: 0, fixed: 0 } };
  var tabs = [
    { ws: getOrCreateTab(ss, TAB_CUSTOMERS, CUSTOMERS_HEADERS), key: "sk" },
    { ws: (typeof _lsOrdersWs === "function" ? (ss.getSheetByName(TAB_LS_CUSTOMERS) || null) : null), key: "ls" }
  ];
  tabs.forEach(function (tab) {
    if (!tab.ws) return;
    var ws = tab.ws;
    var res = results[tab.key];
    // Force text format first so fixes stick
    try { ws.getRange("A2:A").setNumberFormat("@"); ws.getRange("N2:N").setNumberFormat("@"); } catch (e) {}
    var lastRow = ws.getLastRow();
    if (lastRow < 2) return;
    var pinCol = CUSTOMERS_HEADERS.indexOf("PIN") + 1; // column 14
    var pinValues = ws.getRange(2, pinCol, lastRow - 1, 1).getValues();
    for (var i = 0; i < pinValues.length; i++) {
      res.scanned++;
      var v = pinValues[i][0];
      if (v === "" || v === null || v === undefined) continue;
      // If it's a number (not string), it lost its leading zeros
      if (typeof v === "number") {
        var padded = ("0000" + Math.round(v)).slice(-4);
        if (commit === true || commit === "true") {
          ws.getRange(i + 2, pinCol).setNumberFormat("@").setValue("'" + padded);
        }
        res.fixed++;
        Logger.log("fixCustomerPins: row " + (i + 2) + " PIN " + v + " → '" + padded);
      } else if (typeof v === "string" && v.length < 4 && !isNaN(Number(v))) {
        // String but shorter than 4 — also coerced (e.g. "001" → "1" → stored as text "1")
        var padded2 = ("0000" + Number(v)).slice(-4);
        if (v !== padded2) {
          if (commit === true || commit === "true") {
            ws.getRange(i + 2, pinCol).setNumberFormat("@").setValue("'" + padded2);
          }
          res.fixed++;
        }
      }
    }
  });
  results.dryRun = !(commit === true || commit === "true");
  return results;
}


// ── STRIP [LS] PREFIX: remove [LS] from Customer_Name in LS_Orders ──
// One-time cleanup for rows created before the prefix was reverted.
function stripLSPrefix(commit) {
  var ss = getSpreadsheet();
  var ws = ss.getSheetByName(TAB_LS_ORDERS);
  if (!ws || ws.getLastRow() < 2) return { success: true, note: "LS_Orders empty or missing" };
  var data = ws.getDataRange().getValues();
  var headers = data[0];
  var nameIdx = headers.indexOf("Customer_Name");
  if (nameIdx === -1) return { success: false, error: "Customer_Name column not found" };
  var fixed = 0;
  for (var i = 1; i < data.length; i++) {
    var v = String(data[i][nameIdx] || "").trim();
    if (v.indexOf("[LS] ") === 0) {
      if (commit === true || commit === "true") {
        ws.getRange(i + 1, nameIdx + 1).setValue(v.slice(5));
      }
      fixed++;
    }
  }
  return { success: true, dryRun: !(commit === true || commit === "true"), stripped: fixed };
}
