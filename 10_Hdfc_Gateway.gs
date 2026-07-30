// ============================================================
// 10_Hdfc_Gateway.gs
// HDFC SmartGateway integration — session creation, webhook
// handling, Status API, HMAC, post-payment verification,
// authoritative server-side recompute (Burp tamper protection).
// ============================================================
// All functions here are gated by PAYMENT_GATEWAY_ENABLED.
// Sourced from SvaadhKitchenUAT v14.8 — includes:
//   - Bug-fix: verification no longer trusts client-sent status
//     (requires Status API confirmed=true OR HMAC-verified webhook).
//   - Server-authoritative pricing recompute that ignores any
//     client-side amount tampering.
//   - Webhook-log fallback when Status API is quota-exhausted.
// ============================================================

/**
 * Utility: Compute HMAC-SHA256 hex digest.
 * Used to verify HDFC return URL signatures.
 *
 * @param {string} message  String to sign
 * @param {string} secret   Response key from HDFC
 * @returns {string}        Lowercase hex string
 */
function hdfc_hmacSha256(message, secret) {
  const sig = Utilities.computeHmacSha256Signature(
    Utilities.newBlob(message).getBytes(),
    Utilities.newBlob(secret).getBytes()
  );
  return sig.map(function(b) { return ("0" + (b & 0xFF).toString(16)).slice(-2); }).join("");
}

/**
 * Compute HMAC-SHA256 of `message` with `secret` and return Base64-encoded
 * digest (NOT hex). Used by the canonical Juspay/SmartGateway signature
 * verification scheme.
 */
function hdfc_hmacSha256Base64(message, secret) {
  const sig = Utilities.computeHmacSha256Signature(
    Utilities.newBlob(message).getBytes(),
    Utilities.newBlob(secret).getBytes()
  );
  return Utilities.base64Encode(sig);
}

/**
 * PHP-style urlencode: encodeURIComponent + " " -> "+" and a few extras.
 * Juspay's signature contract uses this encoding when building the
 * key=value&key=value HMAC message string.
 */
function hdfc_phpUrlEncode(s) {
  return encodeURIComponent(String(s == null ? "" : s))
    .replace(/%20/g, "+")
    .replace(/!/g, "%21")
    .replace(/\*/g, "%2A")
    .replace(/'/g, "%27")
    .replace(/\(/g, "%28")
    .replace(/\)/g, "%29")
    .replace(/~/g, "%7E");
}

/**
 * Canonical Juspay / HDFC SmartGateway return-URL signature verification
 * (post-vulnerability-fix format). Per HDFC's integration spec:
 *
 *   1. Take every return param except `signature`.
 *   2. Sort the param keys alphabetically.
 *   3. Build the message string as `k1=v1&k2=v2&...` where each value is
 *      PHP-urlencoded.
 *   4. HMAC-SHA256(message, RESPONSE_KEY) → base64 digest.
 *   5. Compare to the received `signature` param. HDFC URL-encodes the
 *      base64 in the redirect URL, so URLSearchParams.get() has already
 *      decoded it once — we compare the raw base64.
 *
 * Returns the matched format ("canonical" / "canonical-with-algo-excluded"
 * / "legacy" / "") so callers can log which path verified.
 *
 * @param {Object} params  All return-URL params (key→value, decoded once)
 * @param {string} key     HDFC_RESPONSE_KEY
 * @returns {string}       Name of the format that matched, or "" if none
 */
function hdfc_verifySignatureMultiFormat(params, key) {
  if (!params || !key) return "";
  const received = String(params.signature || "").trim();
  if (!received) return "";

  // Build canonical message (everything except `signature`)
  const buildMsg = function(excludeKeys) {
    const filtered = [];
    for (const k in params) {
      if (excludeKeys.indexOf(k) !== -1) continue;
      if (params[k] === undefined || params[k] === null) continue;
      filtered.push([k, String(params[k])]);
    }
    filtered.sort(function(a, b) { return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0; });
    return filtered.map(function(p) {
      return p[0] + "=" + hdfc_phpUrlEncode(p[1]);
    }).join("&");
  };

  // Some senders URL-encode the base64 sig in the redirect URL;
  // URLSearchParams.get() has already decoded it once, but if the sender
  // double-encoded we may also need to try the un-decoded form.
  const candidates = [received];
  try { candidates.push(decodeURIComponent(received)); } catch(_) {}

  // ── Format A: canonical, exclude only "signature" ─────────────
  // This is the spec-correct form HDFC's vulnerability-fixed gateway sends.
  const msgA = buildMsg(["signature"]);
  const sigA = hdfc_hmacSha256Base64(msgA, key);
  for (var i = 0; i < candidates.length; i++) {
    if (sigA === candidates[i]) return "canonical";
  }

  // ── Format B: canonical, exclude both "signature" and "signature_algorithm" ──
  // Some Juspay versions exclude both. Try as fallback.
  const msgB = buildMsg(["signature", "signature_algorithm"]);
  const sigB = hdfc_hmacSha256Base64(msgB, key);
  for (var j = 0; j < candidates.length; j++) {
    if (sigB === candidates[j]) return "canonical-no-algo";
  }

  // ── Format C: legacy hex `order_id|status` (pre-vulnerability-fix) ────
  const legacyMsg = String(params.order_id || "") + "|" + String(params.status || "");
  const sigLegacy = hdfc_hmacSha256(legacyMsg, key);  // hex
  for (var m = 0; m < candidates.length; m++) {
    if (sigLegacy.toLowerCase() === String(candidates[m]).toLowerCase()) return "legacy";
  }

  return "";
}

// ════════════════════════════════════════════════════════════════════════
// HDFC return-URL → GitHub Pages redirect HTML
// ════════════════════════════════════════════════════════════════════════
// Apps Script HtmlService output renders inside a sandboxed iframe at
// script.googleusercontent.com (parent at script.google.com). Cross-origin
// scripted navigation of window.top is silently BLOCKED in some browsers,
// leaving customers stuck on the redirect page. Form auto-submit with
// target="_top" navigates the outer browser tab reliably even when
// scripted location.href is blocked.
// (Defined ABOVE doGet/doPost so any paste covering the entry points
//  also includes this helper.)
function _hdfcReturnRedirectHtml(redirectUrl) {
  // Defensive defaults — never return blank, always navigate somewhere.
  const safeUrl = String(redirectUrl || "https://shriharioze.github.io/SvaadhKitchenUAT/order.html");
  const safeUrlAttr = safeUrl.replace(/"/g, "&quot;");
  const safeUrlJs   = JSON.stringify(safeUrl);

  // Apps Script HtmlService renders inside a sandboxed iframe with
  //   sandbox="allow-top-navigation-BY-USER-ACTIVATION"
  // which means automatic window.top.location / form-auto-submit / meta-refresh
  // are BLOCKED. The user MUST click/tap something to navigate the top frame.
  //
  // Strategy: make the ENTIRE viewport a giant click target. We still attempt
  // auto-navigation (in case the host browser is permissive), but rely on the
  // first user gesture (click/tap/keypress) to fire the navigation reliably.
  return '<!DOCTYPE html><html><head><title>Returning to Svaadh Kitchen…</title>' +
         '<meta name="viewport" content="width=device-width,initial-scale=1">' +
         '<meta http-equiv="refresh" content="3;url=' + safeUrlAttr + '">' +
         '<style>' +
         '  *{box-sizing:border-box;margin:0;padding:0;}' +
         '  html,body{height:100%;font-family:system-ui,-apple-system,Segoe UI,Arial,sans-serif;}' +
         '  body{background:#fef9f6;}' +
         '  a.full{position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;' +
         '    justify-content:center;text-decoration:none;color:inherit;cursor:pointer;' +
         '    background:linear-gradient(180deg,#fef9f6 0%,#ffe6dc 100%);}' +
         '  .ring{width:64px;height:64px;border-radius:50%;border:5px solid #f5cba7;' +
         '    border-top-color:#c0392b;animation:spin 1s linear infinite;margin-bottom:24px;}' +
         '  @keyframes spin{to{transform:rotate(360deg);}}' +
         '  .t1{font-size:1.4rem;font-weight:800;color:#c0392b;margin-bottom:6px;}' +
         '  .t2{font-size:0.95rem;color:#555;margin-bottom:32px;text-align:center;padding:0 20px;}' +
         '  .cta{display:inline-block;padding:18px 44px;background:#c0392b;color:#fff;' +
         '    border-radius:14px;font-weight:700;font-size:1.1rem;letter-spacing:0.3px;' +
         '    box-shadow:0 8px 24px rgba(192,57,43,0.35);}' +
         '  .hint{margin-top:16px;font-size:0.78rem;color:#888;}' +
         '</style></head>' +
         '<body>' +
         '<a class="full" href="' + safeUrlAttr + '" target="_top" id="goLink">' +
         '  <div class="ring"></div>' +
         '  <div class="t1">Payment Received ✓</div>' +
         '  <div class="t2" id="msg2">Returning to Svaadh Kitchen…</div>' +
         '  <div class="cta" id="cta">Continue →</div>' +
         '  <div class="hint" id="hint"></div>' +
         '</a>' +
         '<script>' +
         '  (function(){' +
         '    var URL=' + safeUrlJs + ';' +
         // window.close() is a no-op in tabs that were not opened by JS, so it\'s
         // SAFE to attempt unconditionally. If we\'re inside the popup we opened
         // from the order page, this closes it. If we\'re in a same-tab return,
         // it does nothing and we fall through to the redirect logic.
         // Try at multiple intervals because some browsers ignore close() before
         // the page is fully loaded or in cross-origin nested-iframe contexts.
         '    var closeAttempts = 0;' +
         '    function tryClose(){' +
         '      closeAttempts++;' +
         '      try{ window.close(); }catch(_){}' +
         '      try{ if(window.top && window.top!==window){ window.top.close(); } }catch(_){}' +
         '      if(closeAttempts < 6) setTimeout(tryClose, 300);' +
         '    }' +
         '    tryClose();' +
         // After close attempts, start the same-tab fallback path for users who
         // landed here directly (without a popup). The redirect to GitHub Pages
         // requires user activation in the iframe sandbox — we try anyway, and
         // also wire up the whole-screen tap-anywhere navigation as a safety net.
         '    function go(){try{window.top.location.replace(URL);}catch(e){try{window.top.location.href=URL;}catch(_){window.location.href=URL;}}}' +
         '    try{window.top.location.replace(URL);}catch(_){}' +
         '    setTimeout(go,50);' +
         '    setTimeout(go,500);' +
         '    function onFirstGesture(){' +
         '      try{document.getElementById("goLink").click();}catch(_){}' +
         '      go();' +
         '      ["click","touchstart","keydown","mousedown","pointerdown","scroll"].forEach(function(ev){' +
         '        document.removeEventListener(ev,onFirstGesture,true);' +
         '      });' +
         '    }' +
         '    ["click","touchstart","keydown","mousedown","pointerdown","scroll"].forEach(function(ev){' +
         '      document.addEventListener(ev,onFirstGesture,true);' +
         '    });' +
         '  })();' +
         '</script>' +
         '</body></html>';
}

/**
 * Searches SK_Webhook_Log for a verified ORDER_SUCCEEDED event for this
 * order_id. Returns { amount } if found and verified, null otherwise.
 *
 * Used as a fallback when the HDFC Status API can't be reached (urlfetch
 * quota exhausted, network error, etc). The webhook is HDFC's own
 * server-to-server notification — once we have it (and HMAC has passed,
 * which our handler already enforces before logging), we can trust it.
 *
 * Walks backwards from the most recent webhook entries since stuck orders
 * are usually recent.
 */
function _checkWebhookLogForCharge(orderId, expectedAmount) {
  try {
    const ss = getSpreadsheet();
    const ws = ss.getSheetByName(TAB_WEBHOOK_LOG);
    if (!ws) return null;
    const data = ws.getDataRange().getValues();
    if (data.length < 2) return null;
    const headers     = data[0] || [];
    const orderIdCol  = headers.indexOf("Order_ID");
    const eventCol    = headers.indexOf("Event_Name");
    const payloadCol  = headers.indexOf("Raw_Payload");
    if (orderIdCol === -1 || eventCol === -1 || payloadCol === -1) return null;

    // Walk newest → oldest (recent webhook events are at the bottom)
    for (let r = data.length - 1; r >= 1; r--) {
      if (String(data[r][orderIdCol] || "").trim() !== orderId) continue;
      if (String(data[r][eventCol]   || "").trim() !== "ORDER_SUCCEEDED") continue;
      try {
        const payload   = JSON.parse(data[r][payloadCol] || "{}");
        const order     = (payload.content && payload.content.order) || {};
        const txnDetail = order.txn_detail || {};
        const status    = String(txnDetail.status || order.status || "").trim().toUpperCase();
        const amount    = Number(txnDetail.txn_amount || order.amount || 0);
        if (status === "CHARGED" && amount > 0) {
          // Prefer a server-to-server Status API re-confirm — strongest proof and the
          // authoritative amount. The webhook alone isn't trusted blindly: our doPost is
          // reachable by anyone who knows the URL, so a logged "CHARGED" could be forged.
          var _sc = null;
          try { _sc = hdfc_getOrderStatus(orderId); } catch (_) { _sc = { status: "FETCH_ERROR" }; }
          if (_sc && _sc.confirmed) {
            return { amount: Number(_sc.amount || amount), source: "webhook_log+status", logRow: r + 1 };
          }
          // TRUE FALLBACK — the whole reason this function exists. When the Status API is
          // UNREACHABLE (urlfetch quota exhausted, throttled under a load burst, network
          // error) we must NOT lose a genuinely paid order just because we can't re-poll.
          // 29-Jun incident: 5 paid orders lost this exact way — HDFC's signed webhooks
          // were in the log, but the API was throttled so the old code returned null.
          // Trust HDFC's signed ORDER_SUCCEEDED webhook, but ONLY when its amount matches
          // the server-computed expected amount for this order (locked into the pending
          // stash at checkout — a forger can't know the exact cart total). If the API is
          // REACHABLE but says not-charged, still reject (contradicted/forged event). With
          // no expectedAmount to verify against, stay strict.
          var _apiUnreachable = (!_sc || ["FETCH_ERROR", "API_ERROR", "UNKNOWN", "NEW", ""]
            .indexOf(String(_sc.status || "").toUpperCase()) !== -1);
          var _exp = Number(expectedAmount || 0);
          if (_apiUnreachable && _exp > 0 && Math.round(amount) === Math.round(_exp)) {
            Logger.log("_checkWebhookLogForCharge: Status API unreachable (" + (_sc && _sc.status) +
              ") for " + orderId + " — trusting signed webhook; amount " + amount + " matches expected " + _exp + ".");
            return { amount: amount, source: "webhook_log_amount_match", logRow: r + 1 };
          }
          return null;
        }
      } catch (e) {
        // Bad JSON in this row, keep walking
      }
    }
  } catch (e) {
    Logger.log("_checkWebhookLogForCharge error: " + e.message);
  }
  return null;
}

/**
 * STEP 1 — Called by order.html when customer chooses to pay via gateway.
/**
 * SERVER-SIDE AUTHORITATIVE PRICING (HDFC UAT — Amount Tampering fix)
 *
 * Recomputes the order grand total entirely server-side from the saved cart,
 * using the SAME pricing rules that submitOrder() applies when writing to
 * SK_Orders. This is the single source of truth for the gateway charge.
 *
 * If you change pricing logic in submitOrder() (lines ~1239–1353),
 * MIRROR THE CHANGE HERE — both sites must stay in lock-step.
 *
 * Pricing factors covered:
 *   - Item subtotals (Σ qty × authoritative menu price)
 *   - Day-tier discount (5% ≥ ₹325, 7.5% ≥ ₹485, 10% ≥ ₹750, on combined day total)
 *   - Per-area free delivery (SK_Areas.free)
 *   - VIP customers / Fee_Exempt = Yes → no delivery, no small-order fee
 *   - Self-pickup → no delivery, no small-order fee
 *   - Day-cumulative threshold for free delivery (₹100 single-meal, ₹150 multi)
 *   - Small-order fee ₹10 on Lunch/Dinner < ₹50
 *   - Retroactive credit for previously-paid same-day delivery/small-fee
 *     when today crosses the day-free threshold
 *   - Inflation surcharge ceil(sub × 6%)
 *   - 6th-day loyalty waiver (waives current + refunds past 5 days' surcharges)
 *   - Review promo (10% off per meal, decrements promo count in-memory)
 *
 * @param {Object} savedOrders  S.orders snapshot { date: { Meal: { items: {colKey:qty}, area, ... } } }
 * @param {String} phone        Customer phone (used to fetch profile, day-totals, streak)
 * @returns {Number}            Authoritative grand total (rupees)
 */
function _computeAuthoritativeTotal(savedOrders, phone) {
  if (!savedOrders || typeof savedOrders !== "object") return 0;

  // ── Authoritative price lookup (mirror of frontend FIXED_MEAL_ITEMS) ──
  // OLD (v1) L/D prices — must mirror LIVE's frontend FIXED_MEAL_ITEMS (order.html
  // ~4960). When PRICING_V2 is on, priceOf() returns ceil(base × 1.06) — exactly the
  // new table the frontend's getPrice() derives — and the surcharge below is dropped.
  const LD_PRICE = {
    "Chapati": 9, "Without Oil Chapati": 8, "Phulka": 7, "Ghee Phulka": 10,
    "Jowar Bhakri": 20, "Bajra Bhakri": 20,
    "Dry Sabji Mini [100ml]": 22, "Dry Sabji Full [250ml]": 45,
    "Curry Sabji Mini [100ml]": 22, "Curry Sabji Full [250ml]": 45,
    "Dal [200ml]": 22, "Dal Fry [200ml]": 37, "Rice [100g]": 12, "Salad [40g]": 7, "Curd [50g]": 12
  };
  function priceOf(colKey, meal, menu) {
    if (meal === "Breakfast") {
      // Breakfast prices come from the menu sheet (updated to V2 there); only the
      // hardcoded B_CURD needs the bump (12 → 13) under V2.
      if (colKey === "B_CURD") return PRICING_V2 ? 13 : 12;
      const f = (menu && menu.breakfast || []).find(function(b){ return b.name === colKey; });
      return f ? Number(f.price) || 0 : 0;
    }
    const _base = Number(LD_PRICE[colKey] || 0);
    return PRICING_V2 ? Math.ceil(_base * 1.06) : _base;
  }

  const DELIVERY = 11; // MUST match the order page's DELIVERY_CHARGE so the gateway charge == cart total
  const ss = getSpreadsheet();
  const allAreas      = getAreas() || [];
  const freeAreaNames = allAreas.filter(function(a){return a.free;}).map(function(a){return a.name;});

  // ── Customer profile lookup (Fee_Exempt, Review_Promo_Count) ──────────
  const custWs   = getOrCreateTab(ss, TAB_CUSTOMERS, CUSTOMERS_HEADERS);
  const cRows    = getAllRows(custWs);
  const phoneStr = _normalizePhone(phone || "");
  const cRow     = cRows.find(function(r){ return _normalizePhone(r.Phone) === phoneStr; }) || null;
  const isFeeExempt = !!(cRow && (cRow.Fee_Exempt === "Yes" || cRow.Fee_Exempt === true));
  let promoCount = null;
  if (cRow) {
    const raw = cRow.Review_Promo_Count;
    if (raw !== "" && raw !== undefined && !isNaN(raw)) promoCount = Number(raw);
  }

  // ── Customer's address-history allowlist (anti-area-tamper) ──────────
  // To prevent attackers from tampering meal.area to a free-area name in
  // their request and getting fraudulent free delivery, server only honors
  // an area as "free" if it is one the customer has ACTUALLY ordered to
  // before, OR is their saved profile area, OR is "Self Pickup".
  // Unknown / new areas → treated as non-free (delivery applies).
  // First-time customers (no order history): profile area accepted.
  const orderHistRows = getAllRows(getOrCreateTab(ss, TAB_ORDERS, ORDERS_HEADERS));
  const customerKnownAreas = new Set();
  customerKnownAreas.add("Self Pickup");
  if (cRow && cRow.Area) customerKnownAreas.add(String(cRow.Area).trim());
  orderHistRows.forEach(function(r) {
    if (_normalizePhone(r.Phone) !== phoneStr) return;
    const a = String(r.Area || "").trim();
    if (a) customerKnownAreas.add(a);
  });
  // For brand-new customers (no row in SK_Customers AND no order history),
  // accept whatever area they specify (legitimate first order).
  const isBrandNewCustomer = (!cRow && customerKnownAreas.size === 1); // only "Self Pickup"

  // ── Existing same-day orders (for combined totals + retroactive credit) ──
  const dateList = Object.keys(savedOrders).sort();
  if (!dateList.length) return 0;
  const existingDayTotals = (getDayTotalsForDates(phoneStr, dateList.join(",")).dayTotals) || {};

  // ── Loyalty streak (for 6th-day waiver) ──────────────────────────────
  const initialStreakInfo  = _calculateLoyaltyStreak(phoneStr);
  let virtualStreakCount   = initialStreakInfo.streak || 0;
  let virtualPastSurcharge = initialStreakInfo.pastSurcharge || 0;

  // ── Streak overflow guard ─────────
  if (virtualStreakCount >= 6) {
    virtualStreakCount = 0;
    virtualPastSurcharge = 0;
  }

  // Streak gap guard (mirrors submitOrder + the cart) so the gateway-recomputed
  // amount equals the cart and never applies the 6th-day reward across a gap.
  let prevStreakDate = initialStreakInfo.end || null;
  const _closedSetGW = _kitchenClosedSet();
  const _orderedDaysGW = new Set(dateList);
  try {
    const _gwWs = getSpreadsheet().getSheetByName(TAB_ORDERS);
    if (_gwWs) getAllRows(_gwWs).forEach(function(r) {
      if (_normalizePhone(r.Phone) !== phoneStr) return;
      if (_isOrderCancelled(r.Payment_Status)) return;
      const dd = r.Order_Date instanceof Date
        ? Utilities.formatDate(r.Order_Date, "Asia/Kolkata", "yyyy-MM-dd")
        : String(r.Order_Date || "").trim().substring(0, 10);
      if (dd) _orderedDaysGW.add(dd);
    });
  } catch (e) {}
  const _gwStreakConsecutive = function(d1, d2) {
    if (!d1 || !d2) return false;
    const a = new Date(d1 + "T12:00:00"), b = new Date(d2 + "T12:00:00");
    const diff = Math.round((b - a) / 86400000);
    if (diff <= 0) return false;
    if (diff === 1) return true;
    let cur = new Date(a); cur.setDate(cur.getDate() + 1);
    while (cur < b) {
      const iso = Utilities.formatDate(cur, "Asia/Kolkata", "yyyy-MM-dd");
      if (cur.getDay() !== 0 && !_closedSetGW[iso] && !_orderedDaysGW.has(iso)) return false;
      cur.setDate(cur.getDate() + 1);
    }
    return true;
  };

  // ── Menu cache ──────────────────────────────────────────────────────
  const menuCache = {};
  function getMenuCached(d) {
    if (!menuCache[d]) menuCache[d] = getMenu(d);
    return menuCache[d];
  }

  let grand = 0;

  // Mirror submitOrder lines 1239–1353
  dateList.forEach(function(orderDate) {
    const day = savedOrders[orderDate] || {};
    const menu = getMenuCached(orderDate);
    const existingDateInfo = existingDayTotals[orderDate] || {};

    // Same-day add-on: a cart date equal to the last counted streak day is the
    // SAME day — never a gap, never a fresh 6th-day trigger (already counted).
    const isSameStreakDay = !!(prevStreakDate && prevStreakDate === orderDate);
    // Gap guard: a date not consecutive with the previous ordered day breaks the
    // streak — restart so the reward can't fire (and the charge stays = cart).
    if (prevStreakDate && !isSameStreakDay && !_gwStreakConsecutive(prevStreakDate, orderDate)) {
      virtualStreakCount = 0;
      virtualPastSurcharge = 0;
    }
    const is6thDay = !isSameStreakDay && (virtualStreakCount === 5);

    // Compute per-meal subtotals from authoritative prices first (replaces client-supplied subtotals)
    const mealSubs = {};   // { Breakfast: { sub, area }, ... }
    ["Breakfast","Lunch","Dinner"].forEach(function(meal) {
      const m = day[meal];
      if (!m || !m.items) return;
      let sub = 0;
      Object.entries(m.items).forEach(function(pair) {
        const colKey = pair[0];
        const qty    = Number(pair[1]) || 0;
        if (qty <= 0) return;
        sub += priceOf(colKey, meal, menu) * qty;
      });
      if (sub > 0) {
        mealSubs[meal] = { sub: sub, area: m.area || "" };
      }
    });

    // Day-level totals (this submission's day food, plus existing same-day orders)
    const submissionDayFoodTotal = Object.values(mealSubs).reduce(function(s, m){ return s + m.sub; }, 0);
    const prevDayFoodTotal       = Object.values(existingDateInfo).reduce(function(s, m){ return s + (Number(m.subtotal)||0); }, 0);
    const combinedDayTotal       = submissionDayFoodTotal + prevDayFoodTotal;

    // Dynamic free-delivery threshold: 1 meal that day → ₹100, else ₹150
    const mealsThisSubmission = Object.keys(mealSubs);
    const existingMeals       = Object.keys(existingDateInfo).filter(function(t){ return (Number(existingDateInfo[t].subtotal)||0) > 0; });
    const totalMealsCount     = Array.from(new Set(mealsThisSubmission.concat(existingMeals))).length;
    // Free-delivery threshold by delivery-meal count: 1 → ₹106, 2 → ₹159, 3 → ₹190.
    // MUST mirror the frontend (_freeTh) and submitOrder so the charge == the cart total.
    const dynamicFreeThreshold = totalMealsCount <= 1 ? (PRICING_V2 ? 106 : 100) : totalMealsCount === 2 ? (PRICING_V2 ? 159 : 150) : (PRICING_V2 ? 190 : 180);
    // VIP counts as a "free day" too — matches frontend + submitOrder, so a VIP
    // whose earlier same-day orders were charged fees gets them credited back.
    const isDayFree           = (combinedDayTotal >= dynamicFreeThreshold) || isFeeExempt;

    // Day-tier discount (5%/7.5%/10%) — pro-rated to this submission. MUST mirror the
    // frontend (DISC_T1/T2/T3) and submitOrder exactly so the charge == the cart total.
    let discRate = 0;
    if (combinedDayTotal >= 750)      discRate = 0.10;
    else if (combinedDayTotal >= 485) discRate = 0.075;
    else if (combinedDayTotal >= 325) discRate = 0.05;
    const totalDayDiscAmt   = Math.round(combinedDayTotal * discRate);
    const prevDayDiscAmt    = Object.values(existingDateInfo).reduce(function(s, m){ return s + (Number(m.discount_applied)||0); }, 0);
    const submissionDateDiscAmt = Math.max(0, totalDayDiscAmt - prevDayDiscAmt);

    // Accrual = SUM of per-meal floors — MUST match the frontend (_accF), submitOrder
    // (line ~1372), and _calculateLoyaltyStreak, all of which use floor(sub × 5%) in
    // V2. Using round here over-counted the 6th-day waiver by up to ₹1/meal vs the
    // cart the customer saw — the gateway must equal the frontend to the rupee.
    const submissionDaySurcharge = Object.keys(mealSubs).reduce(
      function(s, mt) { return s + (PRICING_V2 ? Math.floor((Number(mealSubs[mt].sub) || 0) * 0.05) : Math.ceil((Number(mealSubs[mt].sub) || 0) * 0.06)); }, 0);

    // Snapshot the accumulated past surcharge BEFORE the per-day streak-state update
    // below zeroes it on the 6th day. getDisc() runs LATER (in the per-meal loop), so
    // reading the live virtualPastSurcharge there would see it AFTER the reset (=0) and
    // waive only the current day — the bug that under-discounted the gateway charge vs
    // the cart. The frontend computes its waiver before resetting; this matches it.
    const _waiverPastSurcharge = virtualPastSurcharge;
    function getDisc(sub) {
      if (is6thDay) {
        // 6th-day loyalty waiver: refund all 6 days' accrued surcharge (mirrors submitOrder)
        const totalWaiver = _waiverPastSurcharge + submissionDaySurcharge;
        return submissionDayFoodTotal > 0 ? Math.round(totalWaiver * (sub / submissionDayFoodTotal)) : 0;
      }
      return submissionDayFoodTotal > 0 ? Math.round(submissionDateDiscAmt * (sub / submissionDayFoodTotal)) : 0;
    }

    // Update virtual streak for next iteration (accrue 5% of food)
    const currentDaySurcharge = submissionDaySurcharge;
    if (is6thDay) {
      virtualStreakCount   = 0;
      virtualPastSurcharge = 0;
    } else if (isSameStreakDay) {
      // Same day as the last counted streak day — no new streak day, but this
      // submission's accrual joins that day's total for a future 6th-day waiver.
      virtualPastSurcharge += currentDaySurcharge;
    } else {
      virtualStreakCount++;
      virtualPastSurcharge += currentDaySurcharge;
    }
    prevStreakDate = orderDate; // ordered day — track for the next gap check

    // Per-meal compute (mirror submitOrder's inner loop) — accumulate at DAY level
    let dayNet = 0;
    Object.keys(mealSubs).forEach(function(mealType) {
      const sub      = mealSubs[mealType].sub;
      const mealArea = mealSubs[mealType].area || "";
      const isPickup = mealArea.toLowerCase().indexOf("pickup") !== -1;
      // Porter = cap-overflow option: customer books & pays the courier, so (like
      // Self Pickup) our delivery + small-order fees are waived. Mirrors submitOrder.
      const isPorter = mealArea.toLowerCase() === "porter";

      // Strict area-trust gate: only honor "free area" exemption if the
      // customer has demonstrably used this area before (order history OR
      // profile area), OR is a brand-new customer placing their first order.
      // Otherwise treat as non-free → delivery charged. Logs tamper attempts.
      const areaIsTrusted = isBrandNewCustomer || customerKnownAreas.has(mealArea);
      const isFreeArea = areaIsTrusted && (freeAreaNames.indexOf(mealArea) !== -1);
      if (!areaIsTrusted && mealArea && !isPickup) {
        console.warn("⚠️ AREA NOT IN CUSTOMER HISTORY — orderId-area=" + mealArea
          + " phone=" + phoneStr + " — treating as non-free (delivery applies).");
      }

      const prevMealSub     = (existingDateInfo[mealType] || {}).subtotal || 0;
      const combinedMealSub = sub + prevMealSub;

      let delCharge = 0;
      if (!isFeeExempt && !isDayFree && !isPickup && !isPorter && !isFreeArea && sub > 0) {
        delCharge = DELIVERY;
      }

      let smallOrderFee = 0;
      if (!isFeeExempt && !isDayFree && !isPickup && !isPorter && (mealType === "Lunch" || mealType === "Dinner") && sub > 0 && combinedMealSub < (PRICING_V2 ? 53 : 50)) {
        smallOrderFee = 11;
      }

      // Retroactive credits if today crossed the day-free threshold.
      // v14.8 — also subtract meal_credit already given to earlier same-day
      // meals so each rupee of prior fee is refunded EXACTLY ONCE.
      // (Mirrors the submitOrder fix; this is the HDFC-side authoritative
      // recompute and must follow the same rule.)
      let dateDeliveryCredit         = 0;
      let dateSmallFeeCredit         = 0;
      let dateMealCreditAlreadyGiven = 0;
      if (isDayFree) {
        Object.keys(existingDateInfo).forEach(function(mt) {
          dateDeliveryCredit         += (Number(existingDateInfo[mt].delivery_charged)    || 0);
          dateSmallFeeCredit         += (Number(existingDateInfo[mt].small_fee_charged)   || 0);
          dateMealCreditAlreadyGiven += (Number(existingDateInfo[mt].meal_credit_applied) || 0);
        });
      }
      const totalPriorFees      = dateDeliveryCredit + dateSmallFeeCredit;
      const availableDateCredit = Math.max(0, totalPriorFees - dateMealCreditAlreadyGiven);
      const mealCredit = submissionDayFoodTotal > 0
        ? Math.round(availableDateCredit * (sub / submissionDayFoodTotal))
        : 0;

      const discAmt = getDisc(sub);
      // V1: charge ceil(sub×6%) surcharge (6th-day loyalty waiver refunds it).
      // V2: NO surcharge billed — floor(sub×5%) accrual tracked for the streak only,
      // given back on the 6th day. floor MUST match frontend/_accF + submitOrder.
      const inflationSurcharge = PRICING_V2 ? Math.floor(sub * 0.05) : Math.ceil(sub * 0.06);

      // Review promo (10% off per meal; decrement in-memory only)
      let reviewDiscount = 0;
      if (typeof promoCount === "number" && !isNaN(promoCount) && promoCount > 0 && sub > 0) {
        reviewDiscount = Math.round(sub * 0.10);
        promoCount--;
      }

      const netTotal = Math.round(sub + delCharge + smallOrderFee + (PRICING_V2 ? 0 : inflationSurcharge) - discAmt - mealCredit - reviewDiscount);
      dayNet += netTotal;
    });

    // Clamp at DAY level (not per meal) to mirror frontend behavior on 6th-day
    // streak waiver — surplus on one meal can offset another meal's net the
    // same way the frontend bill builder shows it.
    grand += Math.max(0, dayNet);
  });

  return Math.round(grand);
}

/**
 * Creates a payment session with HDFC SmartGateway (Juspay HyperCheckout).
 * Returns a payment_url to redirect the customer to.
 *
 * @param {Object} body  { phone, name, amount, order_id, description }
 * @returns {{ success, payment_url, session_id } | { error }}
 */
function hdfc_createSession(body) {
  if (!PAYMENT_GATEWAY_ENABLED) return { error: "Gateway not enabled." };

  const phone        = String(body.phone  || "").trim();
  const name         = String(body.name   || "Customer").trim();
  const orderId      = String(body.order_id    || "").trim();
  const description  = String(body.description || "Svaadh Kitchen Order").trim();

  if (!phone || !orderId) {
    return { error: "Missing required fields: phone, order_id." };
  }
  if (!HDFC_MERCHANT_ID || !HDFC_API_KEY) {
    return { error: "Gateway credentials not configured in Script Properties." };
  }

  // ────────────────────────────────────────────────────────────────────────
  // SECURITY (HDFC UAT — Parameter Manipulation / Request Amount Tampering):
  // Never trust the client-supplied `amount` parameter. An attacker can
  // intercept the POST between the browser and Apps Script via a proxy tool
  // (Burp Suite / mitmproxy) and edit the amount to a lower value before it
  // reaches the gateway. We recompute the authoritative amount server-side
  // from the saved cart using authoritative menu prices.
  //
  // Flow: order.html calls hdfc_savePendingOrder (cart snapshot) → THEN calls
  // hdfc_createSession. Here we look up that saved cart and recompute.
  // ────────────────────────────────────────────────────────────────────────
  const props = PropertiesService.getScriptProperties();
  let pendingEntry = null;
  try {
    const pendingRaw = props.getProperty("HDFC_PENDING_ORDERS") || "{}";
    pendingEntry = JSON.parse(pendingRaw)[orderId] || null;
  } catch (e) { /* fall through */ }

  if (!pendingEntry || (!pendingEntry.orders && !pendingEntry.bulk)) {
    return { error: "Pending order not found. Please retry checkout." };
  }

  // Bulk batch → bulk authoritative total (mirror of submitBulkOrder); otherwise the
  // regular per-day recompute. Either way the client `amount` is ignored.
  const authoritativeAmount = pendingEntry.bulk
    ? _bulkAuthoritativeTotal(pendingEntry.bulk, pendingEntry.phone || phone, pendingEntry.profile)
    : _computeAuthoritativeTotal(pendingEntry.orders, pendingEntry.phone || phone);
  const clientAmount        = Number(body.amount || 0);
  if (authoritativeAmount <= 0) {
    return { error: "Could not compute order total. Cart may be empty." };
  }

  // Single source of truth: server-computed authoritative total. body.amount is ignored
  // entirely (only logged for audit). This applies the SAME pricing rules submitOrder uses
  // when writing to SK_Orders, so the gateway charge always equals what gets recorded.
  if (Math.abs(authoritativeAmount - clientAmount) > 1) {
    console.warn("⚠️ AMOUNT MISMATCH on hdfc_createSession — orderId=" + orderId
      + " phone=" + phone + " client=" + clientAmount + " server=" + authoritativeAmount
      + " — using SERVER value. (Client value ignored.)");
  }

  // ── SPLIT-PAYMENT TAMPER GUARD ────────────────────────────────────────────
  // If the customer chose Split (Wallet + HDFC), the gateway should charge only
  // (total - walletPortion). Both values are derived SERVER-SIDE from sheets:
  //   walletPortion = MIN(SK_Wallet balance, authoritativeAmount)
  // Client-supplied wallet_hint is logged but NEVER trusted. This blocks the
  // attack where Burp sets wallet_hint=99999 to drop HDFC charge to ₹0.
  const paymentChoice  = String(body.payment_choice || pendingEntry.payment_choice || "Gateway");
  const clientWalletHt = Number(body.wallet_hint    || pendingEntry.wallet_hint    || 0);
  let   walletPortion  = 0;

  if (paymentChoice === "Split") {
    const phoneForBal  = pendingEntry.phone || phone;
    const trueBalance  = _calculateWalletBalance(phoneForBal);
    walletPortion      = Math.min(Math.max(0, trueBalance), authoritativeAmount);
    if (Math.abs(walletPortion - clientWalletHt) > 1) {
      console.warn("⚠️ WALLET HINT MISMATCH on hdfc_createSession — orderId=" + orderId
        + " phone=" + phoneForBal + " client_hint=" + clientWalletHt
        + " server_balance=" + trueBalance + " applied=" + walletPortion
        + " — using SERVER value. (Client hint ignored.)");
    }
  }

  // Final amount HDFC will actually charge.
  const hdfcChargeAmount = Math.max(0, authoritativeAmount - walletPortion);

  if (hdfcChargeAmount <= 0) {
    // Edge case: wallet covers the entire bill. Don't go to HDFC at all —
    // the client should use Wallet flow instead. Refuse gracefully.
    return { error: "Wallet balance covers the full bill. Please use Wallet payment instead of Split." };
  }

  // Persist the server-trusted amounts in the pending entry for audit / refunds.
  try {
    pendingEntry.amount         = authoritativeAmount;  // total bill
    pendingEntry.wallet_applied = walletPortion;        // server-validated wallet portion
    pendingEntry.hdfc_charged   = hdfcChargeAmount;     // what HDFC will charge
    pendingEntry.payment_choice = paymentChoice;
    const allPending = JSON.parse(props.getProperty("HDFC_PENDING_ORDERS") || "{}");
    allPending[orderId] = pendingEntry;
    props.setProperty("HDFC_PENDING_ORDERS", JSON.stringify(allPending));
  } catch (e) { /* non-fatal */ }

  // HDFC SmartGateway expects amount in RUPEES (empirically confirmed — UAT showed 100x
  // inflation when sending paisa, so SmartGateway/Juspay takes rupees directly, not paisa)
  const amountToSend = Math.round(hdfcChargeAmount);

  const payload = {
    order_id:               orderId,
    amount:                 amountToSend,
    currency:               "INR",
    customer_id:            phone,
    customer_phone:         phone,
    customer_email:         phone + "@svaadh.noemail",
    payment_page_client_id: HDFC_MERCHANT_ID,
    action:                 "paymentPage",
    // Append _popup=1 so the popup window (which lives on a different
    // origin than the opener tab when the customer's site is on a custom
    // domain) can identify itself via URL params rather than localStorage.
    // localStorage is per-origin and unusable when opener and popup are
    // on different origins; URL params survive HDFC's redirect chain.
    return_url:             HDFC_RETURN_URL + (HDFC_RETURN_URL.indexOf("?") === -1 ? "?_popup=1" : "&_popup=1"),
    description:            description,
    first_name:             name.split(" ")[0] || name,
    last_name:              name.split(" ").slice(1).join(" ") || "",
    udf1:                   phone,
    udf3:                   "svaadh_kitchen",
    // udf2 intentionally omitted — blocked by HDFC for tokenization compliance
    notification_url:       HDFC_RETURN_URL   // webhook URL per-session (fallback if dashboard not set)
  };

  // UPI-only: restrict the checkout to UPI so no card / net-banking MDR is
  // incurred (cards can't be surcharged per the HDFC agreement). Authoritative
  // control is the gateway dashboard; this is a per-session belt-and-suspenders.
  if (HDFC_UPI_ONLY) {
    // HDFC "payment locking" format (case-sensitive): allowDefaultOptions:false
    // hides every default method, then we re-enable ONLY UPI.
    payload.payment_filter = { allowDefaultOptions: false, options: [ { enable: true, paymentMethodType: "UPI" } ] };
  }

  // Juspay Basic Auth: base64(api_key + ":") — API key as username, empty password
  // Merchant ID goes in a separate x-merchantid header (NOT in the auth string)
  const authToken = Utilities.base64Encode(HDFC_API_KEY + ":");

  const options = {
    method:      "post",
    contentType: "application/json",
    headers: {
      "Authorization": "Basic " + authToken,
      "x-merchantid":  HDFC_MERCHANT_ID,
      "version":       "2023-01-01"
    },
    payload:            JSON.stringify(payload),
    muteHttpExceptions: true
  };

  try {
    const resp     = UrlFetchApp.fetch(HDFC_BASE_URL + "/session", options);
    const respCode = resp.getResponseCode();
    const respBody = JSON.parse(resp.getContentText());

    console.log("HDFC createSession [" + respCode + "]:", JSON.stringify(respBody));

    if (respCode !== 200 && respCode !== 201) {
      // Error details can be nested under error_info in Juspay responses
      const errMsg = (respBody.error_info && respBody.error_info.user_message)
        || respBody.user_message
        || respBody.error_message
        || respBody.error_info
        || "Unknown error";
      return { error: "HDFC session creation failed (HTTP " + respCode + "): " + errMsg };
    }

    const paymentUrl = (respBody.payment_links && respBody.payment_links.web)
      ? respBody.payment_links.web
      : null;

    if (!paymentUrl) {
      return { error: "HDFC returned no payment URL. Check credentials and merchant config." };
    }

    return {
      success:     true,
      payment_url: paymentUrl,
      session_id:  respBody.id || orderId,
      order_id:    orderId
    };

  } catch (err) {
    console.error("hdfc_createSession error:", err.message);
    return { error: "Network error creating payment session: " + err.message };
  }
}

/**
 * Internal: Calls HDFC Order Status API to confirm a payment server-side.
 * Must be called before writing "Paid" to the sheet — webhook alone is not
 * sufficient per HDFC security audit requirements.
 *
 * Endpoint: GET {HDFC_BASE_URL}/orders/{order_id}
 * Auth:     Basic base64(API_KEY + ":")
 *
 * @param {string} orderId  The gateway order ID (alphanumeric, ≤21 chars)
 * @returns {{ confirmed: boolean, status: string, txn_id: string }}
 */
function hdfc_getOrderStatus(orderId) {
  if (!HDFC_MERCHANT_ID || !HDFC_API_KEY) {
    console.warn("hdfc_getOrderStatus: credentials not configured.");
    return { confirmed: false, status: "UNKNOWN", txn_id: "" };
  }

  const authToken = Utilities.base64Encode(HDFC_API_KEY + ":");
  const options = {
    method:             "get",
    headers: {
      "Authorization": "Basic " + authToken,
      "x-merchantid":  HDFC_MERCHANT_ID,
      "version":        "2023-01-01"
    },
    muteHttpExceptions: true
  };

  try {
    const resp     = UrlFetchApp.fetch(HDFC_BASE_URL + "/orders/" + orderId, options);
    const respCode = resp.getResponseCode();
    const respBody = JSON.parse(resp.getContentText());

    console.log("hdfc_getOrderStatus [" + respCode + "] for " + orderId + ":", JSON.stringify(respBody));

    if (respCode !== 200) {
      console.warn("hdfc_getOrderStatus: non-200 response (" + respCode + ") for " + orderId);
      return { confirmed: false, status: "API_ERROR", txn_id: "" };
    }

    const status = String(respBody.status || "").toUpperCase();
    const txnId  = String((respBody.txn_detail && respBody.txn_detail.txn_id) || respBody.txn_id || "");
    // Extract the actual charged amount — used for post-payment tamper detection.
    const txnAmount = Number(
      (respBody.txn_detail && respBody.txn_detail.txn_amount) ||
      respBody.amount ||
      0
    );
    return {
      confirmed: (status === "CHARGED"),
      status:    status,
      txn_id:    txnId,
      amount:    txnAmount
    };
  } catch (err) {
    console.error("hdfc_getOrderStatus error:", err.message);
    return { confirmed: false, status: "FETCH_ERROR", txn_id: "", amount: 0 };
  }
}

/**
 * Initiates an AUTOMATIC refund against a gateway-charged order via the
 * HDFC SmartGateway / Juspay refund API — no manual action needed.
 *
 * Endpoint: POST {HDFC_BASE_URL}/orders/{order_id}/refunds
 * Auth:     Basic base64(API_KEY + ":") + x-merchantid header (same as the rest)
 * Body:     unique_request_id, amount   (application/x-www-form-urlencoded)
 *
 * Idempotent: Juspay rejects a duplicate unique_request_id, so re-running a
 * refund for the same order row can never pay twice — safe to retry.
 * Partial refunds are supported (amount may be < the original charge), and
 * several partial refunds can be raised against one order_id (each meal row
 * gets its own unique_request_id).
 *
 * @param {string} gatewayOrderId  The Gateway_Order_ID stored on the order row.
 * @param {number} amount          Amount to refund in ₹ (may be partial).
 * @param {string} uniqueRequestId Stable per-refund id (row-based) for idempotency.
 * @returns {{success:true,status:string,refund_id:string,raw:Object}|{error:string}}
 */
function hdfc_initiateRefund(gatewayOrderId, amount, uniqueRequestId, routingId) {
  if (!HDFC_MERCHANT_ID || !HDFC_API_KEY) {
    return { error: "Gateway credentials not configured." };
  }
  gatewayOrderId = String(gatewayOrderId || "").trim();
  if (!gatewayOrderId) return { error: "Missing gateway order id." };
  amount = Math.round(Number(amount) * 100) / 100;
  if (!(amount > 0)) return { error: "Refund amount must be greater than 0." };
  // unique_request_id: HDFC requires < 21 chars, alphanumeric, unique per refund
  // (idempotency key — a re-run for the same order row never double-refunds).
  uniqueRequestId = String(uniqueRequestId || ("RF" + Date.now()))
                      .replace(/[^A-Za-z0-9]/g, "").slice(0, 20);
  // x-routing-id: required header — customer/cart affinity id (default = order id).
  routingId = String(routingId || gatewayOrderId).replace(/[^A-Za-z0-9]/g, "").slice(0, 40);

  const authToken = Utilities.base64Encode(HDFC_API_KEY + ":");
  const payload   = "unique_request_id=" + encodeURIComponent(uniqueRequestId)
                  + "&amount="           + encodeURIComponent(amount.toFixed(2));
  const headers = {
    "Authorization": "Basic " + authToken,
    "x-merchantid":  HDFC_MERCHANT_ID,
    "x-routing-id":  routingId,
    "version":       "2023-01-01"
  };
  if (HDFC_RESELLER_ID) headers["x-resellerid"] = HDFC_RESELLER_ID;
  const options = {
    method:      "post",
    contentType: "application/x-www-form-urlencoded",
    headers:            headers,
    payload:            payload,
    muteHttpExceptions: true
  };

  try {
    const url  = HDFC_BASE_URL + "/orders/" + encodeURIComponent(gatewayOrderId) + "/refunds";
    const resp = UrlFetchApp.fetch(url, options);
    const code = resp.getResponseCode();
    const json = JSON.parse(resp.getContentText() || "{}");
    console.log("hdfc_initiateRefund [" + code + "] " + gatewayOrderId + " ₹" + amount
                + " req=" + uniqueRequestId + ":", JSON.stringify(json));

    // Idempotency: a duplicate.call error means this exact refund was already
    // accepted earlier — treat as success so a retry never queues a 2nd refund.
    const errCode = String((json.error_info && json.error_info.code) || json.error_code || json.code || "").toLowerCase();
    if ((code === 400 || code === 409) && errCode.indexOf("duplicate") !== -1) {
      console.log("hdfc_initiateRefund: duplicate.call — refund already exists, treating as success.");
      return { success: true, status: "PENDING", refund_id: uniqueRequestId, duplicate: true, raw: json };
    }

    if (code !== 200 && code !== 201) {
      const errMsg = (json.error_info && json.error_info.user_message)
        || json.error_message || json.error_info || ("HTTP " + code);
      return { error: "Refund API failed: " + errMsg, http: code, raw: json };
    }

    // Juspay returns the full order object; the refund we just raised is in refunds[].
    var refundStatus = "PENDING", refundId = uniqueRequestId;
    if (Array.isArray(json.refunds) && json.refunds.length) {
      var mine = json.refunds.filter(function(x){ return x.unique_request_id === uniqueRequestId; });
      var rf   = mine.length ? mine[mine.length - 1] : json.refunds[json.refunds.length - 1];
      refundStatus = String(rf.status || "PENDING").toUpperCase();
      refundId     = String(rf.id || rf.unique_request_id || uniqueRequestId);
    }
    return { success: true, status: refundStatus, refund_id: refundId, raw: json };
  } catch (err) {
    console.error("hdfc_initiateRefund error:", err.message);
    return { error: "Network error during refund: " + err.message };
  }
}

/**
 * Reads an order from the Status API and returns its refunds[] array (each with
 * status, unique_request_id, amount). Used by the refund reconciler to settle
 * "Processing" refunds WITHOUT depending on the REFUND_SUCCEEDED webhook.
 * @returns {{success:true,refunds:Array}|{error:string}}
 */
function hdfc_getOrderRefunds(gatewayOrderId) {
  if (!HDFC_MERCHANT_ID || !HDFC_API_KEY) return { error: "Gateway credentials not configured." };
  gatewayOrderId = String(gatewayOrderId || "").trim();
  if (!gatewayOrderId) return { error: "Missing gateway order id." };
  const authToken = Utilities.base64Encode(HDFC_API_KEY + ":");
  const headers = {
    "Authorization": "Basic " + authToken,
    "x-merchantid":  HDFC_MERCHANT_ID,
    "x-routing-id":  gatewayOrderId,
    "version":       "2023-01-01"
  };
  if (HDFC_RESELLER_ID) headers["x-resellerid"] = HDFC_RESELLER_ID;
  const options = { method: "get", headers: headers, muteHttpExceptions: true };
  try {
    const resp = UrlFetchApp.fetch(HDFC_BASE_URL + "/orders/" + encodeURIComponent(gatewayOrderId), options);
    if (resp.getResponseCode() !== 200) return { error: "HTTP " + resp.getResponseCode() };
    const json = JSON.parse(resp.getContentText() || "{}");
    return { success: true, refunds: Array.isArray(json.refunds) ? json.refunds : [] };
  } catch (e) {
    return { error: e.message };
  }
}

/**
 * Marks the matching row in the Refunds sheet as fully refunded once HDFC
 * confirms (REFUND_SUCCEEDED webhook). Best-effort: matches by gateway order_id
 * recorded in the Adjustment_Note. Never throws.
 */
function _hdfcMarkRefundSettled(gatewayOrderId, refundId) {
  try {
    gatewayOrderId = String(gatewayOrderId || "").trim();
    if (!gatewayOrderId) return;
    const ss = SpreadsheetApp.openById(SHEET_ID);
    const ws = ss.getSheetByName(TAB_REFUNDS);
    if (!ws) return;
    const data    = ws.getDataRange().getValues();
    const headers = data[0] || [];
    const cStatus = headers.indexOf("Status");
    const cNote   = headers.indexOf("Adjustment_Note");
    const cMode   = headers.indexOf("Refund_Mode");
    if (cStatus === -1 || cNote === -1) return;
    for (var i = 1; i < data.length; i++) {
      var note   = String(data[i][cNote] || "");
      var status = String(data[i][cStatus] || "").toLowerCase();
      var isGw   = cMode === -1 ? true : String(data[i][cMode] || "").toLowerCase() === "gateway";
      if (isGw && note.indexOf(gatewayOrderId) !== -1 && status !== "refunded") {
        ws.getRange(i + 1, cStatus + 1).setValue("Refunded");
        ws.getRange(i + 1, cNote   + 1).setValue(note + " | settled:" + (refundId || "") + " @ " + new Date());
        console.log("_hdfcMarkRefundSettled: row " + (i+1) + " marked Refunded for " + gatewayOrderId);
      }
    }
  } catch (e) {
    console.warn("_hdfcMarkRefundSettled error:", e.message);
  }
}

/**
 * STEP 3 — Called by order.html when customer lands back after payment.
 * Verifies the HMAC signature on return URL params.
 * Signature = HMAC_SHA256(order_id + "|" + status, HDFC_RESPONSE_KEY)
 *
 * @param {Object} body  { order_id, status, signature }
 * @returns {{ success, paid, order_id, status, message } | { error }}
 */
function hdfc_verifyReturnPayload(body) {
  if (!PAYMENT_GATEWAY_ENABLED) return { error: "Gateway not enabled." };

  const orderId   = String(body.order_id  || "").trim();
  const status    = String(body.status    || "").trim();
  const signature = String(body.signature || "").trim();

  if (!orderId || !status) {
    return { error: "Missing order_id or status in return payload." };
  }

  // ── Step 1: HMAC signature check (fast, no I/O) ─────────────
  // If signature is present and key is configured, verify it.
  // On mismatch: do NOT reject outright — fall back to Status API (Step 2).
  // Reason: HDFC UAT may not send a valid signature; Status API is authoritative.
  //
  // HDFC's POST-vulnerability-fix gateway uses the CANONICAL Juspay format
  // (sort all params except `signature`, PHP-urlencode values, HMAC-SHA256,
  // base64). The PRE-fix format used a legacy `order_id|status` hex HMAC.
  // We support both via hdfc_verifySignatureMultiFormat so the integration
  // works against either gateway version.
  var signatureOk = false;
  if (HDFC_RESPONSE_KEY && signature) {
    // body may include the full return-URL payload (status_id, signature_algorithm,
    // etc. — sent by the frontend after HDFC's vulnerability fix).
    // Build the param map the verifier needs.
    const sigParams = {};
    for (const k in body) {
      // Skip our own routing keys
      if (k === "_action" || k === "pin" || k === "sessionPin") continue;
      sigParams[k] = body[k];
    }
    // Ensure the three canonical keys are present (frontend always sends these)
    sigParams.order_id  = orderId;
    sigParams.status    = status;
    sigParams.signature = signature;

    const matchedFormat = hdfc_verifySignatureMultiFormat(sigParams, HDFC_RESPONSE_KEY);
    if (matchedFormat) {
      signatureOk = true;
      console.log("HDFC return: HMAC verified for " + orderId
        + " via format=" + matchedFormat
        + " (algo=" + (body.signature_algorithm || "n/a") + ")");
    } else {
      console.warn("HDFC return: HMAC mismatch for order " + orderId
        + " — tried canonical, canonical-no-algo, and legacy formats."
        + " params=" + JSON.stringify(Object.keys(sigParams))
        + " — falling back to Status API.");
    }
  } else {
    console.warn("HDFC return: No signature or key — falling back to Status API.");
  }

  // ── Step 2: Status API verification (authoritative) ──────────
  // Always call Status API — it gives us the real txn_id, confirmed status,
  // AND the actual charged amount (needed for post-payment tamper check).
  //
  // CRITICAL SECURITY FIX (UAT incident SK260513GDY384U1WM / SK260514G4BOVWUZ5V):
  // Previously this function trusted the client-sent `status` field
  // ("CHARGED" / "SUCCESS") if the Status API call failed (FETCH_ERROR,
  // urlfetch quota etc.). That allowed a payment that HDFC ACTUALLY
  // REJECTED to be marked Paid in our sheet, because the frontend
  // hardcodes "CHARGED" in the popup-closed poll path.
  //
  // The fix: NEVER trust client-sent status. statusConfirmed can ONLY
  // become true via:
  //   (a) HDFC Status API returning confirmed = true, OR
  //   (b) HMAC-verified ORDER_SUCCEEDED webhook in our SK_Webhook_Log,
  //       which only gets logged after our own HMAC check in
  //       hdfc_handleWebhook (so it's authoritative).
  // If neither, we refuse to mark paid.
  const statusCheck = hdfc_getOrderStatus(orderId);
  var statusConfirmed = false;
  var confirmedSource = "";

  // States where HDFC EXPLICITLY tells us the txn did NOT succeed.
  // When we see any of these, do NOT fall back to the webhook log —
  // even a previous attempt's ORDER_SUCCEEDED webhook is irrelevant
  // because THIS attempt was rejected by the bank.
  //
  // FIX (post-UAT v14.8): an earlier version of this function fell back
  // to the webhook log whenever statusCheck.confirmed was false. That
  // included the case where Status API DEFINITIVELY said "failed" —
  // letting a retried-and-failed transaction get marked Paid because
  // an older successful attempt under the same order_id was in our
  // SK_Webhook_Log. HDFC UAT reproduced this scenario by selecting
  // AUTHORIZATION_FAILED in the Juspay simulator after a prior success.
  const EXPLICIT_FAILURE_STATES = [
    "AUTHORIZATION_FAILED", "AUTHENTICATION_FAILED", "JUSPAY_DECLINED",
    "AUTO_REFUNDED", "VOIDED", "VOID_INITIATED", "DECLINED", "FAILED",
    "ERROR", "CANCELLED", "REFUNDED"
  ];
  const apiStatus = String(statusCheck.status || "").toUpperCase();
  const isExplicitFailure = EXPLICIT_FAILURE_STATES.indexOf(apiStatus) !== -1;

  if (statusCheck.confirmed) {
    statusConfirmed = true;
    confirmedSource = "status-api";
    console.log("HDFC return: Status API confirmed CHARGED for " + orderId + " amount=" + statusCheck.amount);
  } else if (isExplicitFailure) {
    // HDFC has explicitly told us the txn failed. Reject without checking
    // webhook log — an old success webhook from a prior attempt cannot
    // resurrect a failed retry.
    console.warn("HDFC return: Status API explicit failure for " + orderId
      + " — apiStatus='" + apiStatus + "' client_status='" + status + "'."
      + " Webhook-log fallback INTENTIONALLY SKIPPED.");
    return {
      error: "Payment was not successful at HDFC. Status: " + apiStatus,
      paid:  false,
      client_status_ignored: true,
      api_status: apiStatus,
      order_id:   orderId
    };
  } else {
    // Transient state (FETCH_ERROR, API_ERROR, UNKNOWN, PENDING_VBV,
    // NEW, AUTHORIZING, etc.) — Status API couldn't give us a final
    // verdict. NOW it's safe to fall back to the webhook log, because
    // a verified ORDER_SUCCEEDED webhook is server-to-server proof.
    var webhookProof = null;
    try { webhookProof = _checkWebhookLogForCharge(orderId); } catch(_) {}
    if (webhookProof) {
      statusConfirmed = true;
      confirmedSource = "webhook-log";
      statusCheck.amount    = webhookProof.amount;
      statusCheck.confirmed = true;
      console.log("HDFC return: Status API transient (" + apiStatus + "), ORDER_SUCCEEDED webhook found for " + orderId + " — trusting webhook.");
    } else {
      console.warn("HDFC return: Neither Status API nor webhook log confirm charge for " + orderId
        + ". client_status='" + status + "' (IGNORED). apiStatus='" + apiStatus + "'");
      return {
        error: "Payment could not be verified by HDFC. Status: " + apiStatus,
        paid:  false,
        client_status_ignored: true,
        api_status: apiStatus,
        order_id:   orderId
      };
    }
  }

  // ────────────────────────────────────────────────────────────────────────
  // SECURITY (HDFC UAT — Defense-in-depth post-payment amount check):
  // Even if hdfc_createSession was somehow bypassed (e.g., direct Juspay
  // dashboard, undeployed code, future bug), reject the order here if the
  // amount actually charged at the gateway is less than the authoritative
  // server-computed cart total. This guarantees no order is ever written
  // for an underpaid amount.
  // ────────────────────────────────────────────────────────────────────────
  if (statusConfirmed && statusCheck.amount > 0) {
    try {
      const props        = PropertiesService.getScriptProperties();
      const pendingRaw   = props.getProperty("HDFC_PENDING_ORDERS") || "{}";
      const pendingEntry = JSON.parse(pendingRaw)[orderId] || null;
      if (pendingEntry && pendingEntry.orders) {
        const fullTotal = _computeAuthoritativeTotal(pendingEntry.orders, pendingEntry.phone || "");
        const charged   = Number(statusCheck.amount || 0);

        // For Split (Wallet + HDFC) payments, HDFC only charges (total - walletApplied).
        // The authoritative wallet portion was server-validated against SK_Wallet at
        // hdfc_createSession time and stored in pendingEntry.wallet_applied. We use
        // that value here so the post-payment check matches what HDFC actually charged.
        const isSplit       = String(pendingEntry.payment_choice || "") === "Split";
        const walletApplied = isSplit ? Number(pendingEntry.wallet_applied || 0) : 0;
        const expected      = Math.max(0, fullTotal - walletApplied);

        // Reject if charged amount is below the expected gateway portion (₹1 rounding tolerance).
        if (expected > 0 && charged < expected - 1) {
          console.error("⚠️ POST-PAYMENT AMOUNT TAMPER DETECTED — orderId=" + orderId
            + " phone=" + (pendingEntry.phone || "")
            + " charged=" + charged + " expected=" + expected
            + " (fullTotal=" + fullTotal + " walletApplied=" + walletApplied + ")"
            + " — REJECTING order placement.");
          return {
            success: false,
            paid:    false,
            error:   "Payment amount mismatch detected (charged ₹" + charged
                   + " vs expected ₹" + expected + "). The order has NOT been placed. "
                   + "Please contact support — your payment will be refunded.",
            tamper_detected: true,
            charged_amount:  charged,
            expected_amount: expected
          };
        }
        console.log("Amount validation OK — orderId=" + orderId + " charged=" + charged
          + " expected=" + expected + " (fullTotal=" + fullTotal + " wallet=" + walletApplied + ")");
      } else {
        console.warn("hdfc_verifyReturnPayload: no pending entry for amount validation — orderId=" + orderId);
      }
    } catch (e) {
      console.error("Post-payment amount check failed:", e.message);
    }
  }

  const paid = statusConfirmed;

  // Cross-check with sheet (webhook should have already marked it paid)
  try {
    const ss   = getSpreadsheet();
    const ws   = getOrCreateTab(ss, TAB_ORDERS, []);
    const rows = getAllRows(ws);
    const orderRows = rows.filter(function(r) {
      return String(r.Submission_ID || "").trim() === orderId;
    });
    if (orderRows.length > 0) {
      const sheetStatus = String(orderRows[0].Payment_Status || "").toLowerCase();
      const alreadyPaid = sheetStatus === "paid" || sheetStatus === "collected";
      return {
        success:  true,
        paid:     paid || alreadyPaid,
        order_id: orderId,
        status:   status,
        message:  (paid || alreadyPaid) ? "Payment confirmed." : "Payment status: " + status
      };
    }
  } catch (err) {
    console.warn("hdfc_verifyReturnPayload sheet check error:", err.message);
  }

  return {
    success:  true,
    paid:     paid,
    order_id: orderId,
    status:   status,
    message:  paid ? "Payment confirmed." : "Payment status: " + status
  };
}

/**
 * Saves order payload before customer is redirected to HDFC checkout.
 * Called by order.html hdfc_initiatePayment() just before window.location.href redirect.
 *
 * @param {Object} body  { order_id, phone, amount, orders, selectedDates, profile, mealAddrs, isFirstTime }
 */
function hdfc_savePendingOrder(body) {
  if (!PAYMENT_GATEWAY_ENABLED) return { error: "Gateway not enabled." };

  const orderId = String(body.order_id || "").trim();
  if (!orderId) return { error: "order_id required." };

  try {
    const props    = PropertiesService.getScriptProperties();
    const raw      = props.getProperty("HDFC_PENDING_ORDERS") || "{}";
    const pending  = JSON.parse(raw);

    // Expire stale entries. TTL was 30 min, which lost paid orders: the
    // ORDER_SUCCEEDED webhook can arrive 20-30 min late and the reconciler may miss
    // its brief window, so the only copy of the order (with its items) got pruned
    // before anything wrote it. 6h gives the webhook + the 5-min reconciler a wide
    // window to recover, while still keeping the stash small (written/charged entries
    // are deleted as soon as they're reconciled).
    const now = Date.now();
    const HDFC_PENDING_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
    Object.keys(pending).forEach(function(k) {
      if (now - (pending[k].ts || 0) > HDFC_PENDING_TTL_MS) delete pending[k];
    });

    pending[orderId] = {
      ts:             now,
      phone:          body.phone         || "",
      amount:         body.amount        || 0,
      orders:         body.orders        || {},
      // Bulk batches stash { plan, lunch:{items}, dinner:{items} } here instead of
      // `orders`; createSession + the reconciler branch on this to use bulk pricing.
      bulk:           body.bulk          || null,
      selectedDates:  body.selectedDates || [],
      profile:        body.profile       || {},
      mealAddrs:      body.mealAddrs     || {},
      isFirstTime:    body.isFirstTime   || false,
      // Split-payment hints — server will RE-VALIDATE in hdfc_createSession
      // by reading the actual SK_Wallet balance. Stored here only for context.
      payment_choice: body.payment_choice || "Gateway",
      wallet_hint:    Number(body.wallet_hint || 0)
    };

    // Bulk: FREEZE the date windows now (checkout time) so the gateway charge and the
    // later storage write use identical dates even if a meal cutoff flips in between.
    if (pending[orderId].bulk && typeof getBulkWindow === "function") {
      try {
        const _bw = getBulkWindow(pending[orderId].bulk.plan);
        if (!_bw.error) {
          pending[orderId].bulk.lunchDates  = pending[orderId].bulk.lunch  ? _bw.lunch  : [];
          pending[orderId].bulk.dinnerDates = pending[orderId].bulk.dinner ? _bw.dinner : [];
        }
      } catch (_) { /* fall back to live windows at compute time */ }
    }

    // Size guard: a Script Property value is capped (~9KB). With the longer TTL an
    // unusual burst of abandoned (never-paid) checkouts could otherwise bloat the map
    // and make setProperty throw — which would break the stash for everyone. Keep the
    // newest entries (by ts); the current order is freshest so it's always retained.
    var _keys = Object.keys(pending);
    if (_keys.length > 80) {
      _keys.sort(function (a, b) { return (pending[b].ts || 0) - (pending[a].ts || 0); });
      _keys.slice(80).forEach(function (k) { delete pending[k]; });
    }

    props.setProperty("HDFC_PENDING_ORDERS", JSON.stringify(pending));
    console.log("hdfc_savePendingOrder: saved order " + orderId);
    return { success: true };

  } catch (err) {
    console.error("hdfc_savePendingOrder error:", err.message);
    return { error: err.message };
  }
}

/**
 * Retrieves and removes the saved pending order on return from HDFC.
 * Called by order.html hdfc_handleReturnParams() after verifying payment.
 *
 * @param {Object} body  { order_id }
 * @returns {{ success, phone, amount, orders, selectedDates, profile, mealAddrs, isFirstTime } | { error }}
 */
function hdfc_getPendingOrder(body) {
  if (!PAYMENT_GATEWAY_ENABLED) return { error: "Gateway not enabled." };

  const orderId = String(body.order_id || "").trim();
  if (!orderId) return { error: "order_id required." };

  try {
    const props   = PropertiesService.getScriptProperties();
    const raw     = props.getProperty("HDFC_PENDING_ORDERS") || "{}";
    const pending = JSON.parse(raw);

    const entry = pending[orderId];
    if (!entry) {
      console.warn("hdfc_getPendingOrder: no pending entry for " + orderId);
      return { error: "Pending order not found. It may have expired (>6 h)." };
    }

    // Keep the entry — let it expire naturally after the TTL.
    // Not deleting here so that if the page reloads or redirects twice,
    // the second call still finds the data.
    console.log("hdfc_getPendingOrder: retrieved order " + orderId);
    return { success: true, ...entry };

  } catch (err) {
    console.error("hdfc_getPendingOrder error:", err.message);
    return { error: err.message };
  }
}

/**
 * STEP 2 — Webhook handler.
 * HDFC POSTs here immediately after payment success or refund.
 * This is the authoritative payment confirmation — never rely on return URL alone.
 *
 * Auth: Basic Auth (HDFC_WEBHOOK_USERNAME:HDFC_WEBHOOK_PASSWORD)
 *
 * @param {Object} body  Parsed webhook JSON from HDFC
 * @param {Object} e     Raw Apps Script event (for header access)
 */
/**
 * STEP 2 — Webhook handler. LOG-FIRST PATTERN.
 *
 * HDFC expects a 200 response within 5 seconds. Heavy work (Status API call,
 * sheet reads, row updates) can take 5-8s — guaranteed timeout.
 *
 * Solution: this function does ONE thing only:
 *   1. Verify Basic Auth (in-memory, < 5ms)
 *   2. Write one row to SK_Webhook_Log (< 500ms)
 *   3. Return 200 OK to HDFC immediately
 *
 * The actual processing — Status API verification, marking order paid —
 * is handled by hdfc_processWebhookLog(), called by a 1-minute time trigger.
 * No time pressure there. No duplicates (PENDING → PROCESSED gate).
 *
 * @param {Object} body  Parsed webhook JSON from HDFC
 * @param {Object} e     Raw Apps Script event (for header access)
 */
function hdfc_handleWebhook(body, e) {
  if (!PAYMENT_GATEWAY_ENABLED) return { error: "Gateway not enabled." };

  // ── Auth check (fast — no I/O) ───────────────────────────────
  try {
    var authHeader = "";
    try { authHeader = e.parameter.Authorization || ""; } catch(_) {}
    if (HDFC_WEBHOOK_USERNAME && HDFC_WEBHOOK_PASSWORD) {
      var expectedAuth = "Basic " + Utilities.base64Encode(HDFC_WEBHOOK_USERNAME + ":" + HDFC_WEBHOOK_PASSWORD);
      if (authHeader && authHeader !== expectedAuth) {
        console.warn("HDFC Webhook: Invalid Basic Auth — possible spoofed request.");
        return { error: "Unauthorized" };
      }
    }
  } catch (authErr) {
    console.warn("HDFC Webhook auth check error:", authErr.message);
  }

  // ── Log-first: write one row, return immediately ─────────────
  // Do NOT call hdfc_markOrderPaid here — that involves an external Status API
  // call and sheet reads which will blow past HDFC's 5-second response window.
  try {
    const ss  = getSpreadsheet();
    const ws  = getOrCreateTab(ss, TAB_WEBHOOK_LOG, [
      "Received_At", "Event_Name", "Order_ID", "Raw_Payload", "Status", "Processed_At", "Result"
    ]);

    const eventName = String(body.event_name || "");
    const orderId   = String(
      (body.content && body.content.order && body.content.order.order_id) || ""
    );

    ws.appendRow([
      new Date(),          // Received_At
      eventName,           // Event_Name
      orderId,             // Order_ID
      JSON.stringify(body),// Raw_Payload — full webhook preserved
      "PENDING",           // Status
      "",                  // Processed_At (filled by processor)
      ""                   // Result       (filled by processor)
    ]);

    console.log("HDFC Webhook logged: event=" + eventName + " order=" + orderId);
  } catch (logErr) {
    // Even if logging fails, we must return 200 so HDFC doesn't retry endlessly.
    // The raw payload is in the GAS execution log regardless.
    console.error("HDFC Webhook log error:", logErr.message);
  }

  // Return 200 immediately — HDFC is satisfied. Processing happens async.
  return { success: true, received: true };
}

/**
 * HDFC Webhook Processor — called by a 1-minute time trigger.
 * Reads all PENDING rows from SK_Webhook_Log and processes each one.
 *
 * For ORDER_SUCCEEDED events:
 *   1. Calls Status API to independently confirm payment (security requirement)
 *   2. Marks the order Paid in SK_Orders
 *   3. Updates the log row to PROCESSED or FAILED
 *
 * Safe to run multiple times — duplicate protection is inside hdfc_markOrderPaid.
 * Set up the trigger once by running setupHdfcWebhookTrigger() from the editor.
 */
function hdfc_processWebhookLog() {
  if (!PAYMENT_GATEWAY_ENABLED) return;

  try {
    const ss  = getSpreadsheet();
    const ws  = getOrCreateTab(ss, TAB_WEBHOOK_LOG, [
      "Received_At", "Event_Name", "Order_ID", "Raw_Payload", "Status", "Processed_At", "Result"
    ]);

    const data = ws.getDataRange().getValues();
    if (data.length < 2) return; // no rows yet

    const headers        = data[0];
    const COL_EVENT      = headers.indexOf("Event_Name");
    const COL_PAYLOAD    = headers.indexOf("Raw_Payload");
    const COL_STATUS     = headers.indexOf("Status");
    const COL_PROC_AT    = headers.indexOf("Processed_At");
    const COL_RESULT     = headers.indexOf("Result");

    var processed = 0;

    for (var i = 1; i < data.length; i++) {
      const rowStatus = String(data[i][COL_STATUS] || "").trim();
      if (rowStatus !== "PENDING") continue; // skip already handled rows

      const eventName  = String(data[i][COL_EVENT]   || "");
      const rawPayload = String(data[i][COL_PAYLOAD]  || "{}");
      var   body;
      try { body = JSON.parse(rawPayload); } catch(_) { body = {}; }

      const content = body.content || {};
      const order   = content.order || {};
      var   result  = "";
      var   newStatus = "PROCESSED";

      if ((eventName === "ORDER_SUCCEEDED" || order.status === "CHARGED") && eventName.indexOf("REFUND") === -1) {
        // NB: a PARTIAL refund leaves order.status === "CHARGED", so we must exclude
        // any *REFUND* event here or it would re-mark-paid and skip refund handling.
        // Wallet-recharge orders use SK + YYMMDD + 'W' + 9 chars (vs 'G' for orders).
        // Route them to the recharge finalizer instead of hdfc_markOrderPaid.
        const oid = String(order.order_id || "").trim();
        if (oid && /^SK\d{6}W/.test(oid)) {
          const rechResult = hdfc_finalizeWalletRecharge(oid);
          result = JSON.stringify(rechResult);
          if (rechResult.error) newStatus = "FAILED";
        } else if (oid && /^SK\d{6}A/.test(oid)) {
          const oaResult = hdfc_finalizeOnAccountPayment(oid);
          result = JSON.stringify(oaResult);
          if (oaResult.error) newStatus = "FAILED";
        } else if (oid && /^IA\d+/.test(oid)) {
          const iaResult = ia_hdfc_verifyAndSubmit({ order_id: oid });
          result = JSON.stringify(iaResult);
          if (iaResult.error) newStatus = "FAILED";
        } else {
          const markResult = hdfc_markOrderPaid(order);
          result = JSON.stringify(markResult);
          if (markResult.error) newStatus = "FAILED";

          // FOOLPROOF WRITE — hdfc_markOrderPaid only FLIPS rows that already exist. A
          // gateway order the browser/reconciler hasn't written yet has no row to flip
          // (updated===0), so the webhook used to silently no-op and the order was lost
          // if the reconciler also missed its window. Now the webhook WRITES it itself,
          // straight from the stash, via the reconciler's proven single-entry path
          // (locked, dedups on Gateway_Order_ID, re-confirms CHARGED). This makes the
          // webhook a fully independent writer — a paid order lands even if the browser
          // closed early AND the 5-min reconciler trigger is lagging.
          if (oid && !markResult.error && (markResult.updated || 0) === 0
              && typeof hdfc_reconcileOrderFromStash === "function") {
            try {
              const autoWrite = hdfc_reconcileOrderFromStash(oid);
              result = JSON.stringify({ markPaid: markResult, autoWrite: autoWrite });
              if (autoWrite && autoWrite.outcome === "errors") newStatus = "FAILED";
            } catch (we) {
              result = JSON.stringify({ markPaid: markResult, autoWriteError: we.message });
              newStatus = "FAILED";
            }
          }
        }

      } else if (eventName.indexOf("REFUND") !== -1) {
        // Refund events — handle EVERY naming variant HDFC/Juspay may send:
        //   merchant refunds: REFUND_INITIATED / REFUND_SUCCEEDED / REFUND_FAILED
        //   (per HDFC docs)   ORDER_REFUNDED / ORDER_REFUND_FAILED / REFUND_MANUAL_REVIEW_NEEDED
        //   auto-refunds:     AUTO_REFUND_INITIATED / AUTO_REFUND_SUCCEEDED / AUTO_REFUND_FAILED
        // On success → flip the matching SK_Refunds row to "Refunded" via
        // _hdfcMarkRefundSettled (matches Refund_Mode=gateway + the order id in the note).
        var rOid   = String(order.order_id || "").trim();
        var rList  = Array.isArray(order.refunds) ? order.refunds : [];
        var rRefId = rList.length ? String(rList[rList.length - 1].id || rList[rList.length - 1].unique_request_id || "") : "";
        var ev     = eventName.toUpperCase();
        if (rOid && (ev.indexOf("SUCCEEDED") !== -1 || ev === "ORDER_REFUNDED")) {
          _hdfcMarkRefundSettled(rOid, rRefId);
          result = "Refund settled (" + eventName + ") for " + rOid + (rRefId ? " (" + rRefId + ")" : "");
        } else if (ev.indexOf("FAILED") !== -1) {
          result = "Refund FAILED (" + eventName + ") for " + rOid + " — admin should initiate a fresh refund.";
        } else {
          result = "Refund event acknowledged (" + eventName + ") for " + rOid;
        }

      } else if (eventName === "ORDER_FAILED" || HDFC_FAILURE_STATES.indexOf(String(order.status || "").toUpperCase()) !== -1) {
        // Payment failed / declined / auth failure (AUTHENTICATION_FAILED,
        // AUTHORIZATION_FAILED, JUSPAY_DECLINED, etc.) → mark the order Failed.
        // NEVER un-pays a confirmed order. Usually a no-op (failed payments don't
        // create an order row), but closes out any stray Pending row + records it.
        const oid = String(order.order_id || "").trim();
        if (oid && /^SK\d{6}W/.test(oid)) {
          result = "Wallet-recharge failure (" + (order.status || eventName) + ") — no order row.";
        } else if (oid && /^SK\d{6}A/.test(oid)) {
          result = "On-account settlement failure (" + (order.status || eventName) + ") — no settlement applied.";
        } else if (oid && /^IA\d+/.test(oid)) {
          result = "IntentAmplify failure (" + (order.status || eventName) + ") — no order row created.";
        } else {
          const failResult = hdfc_markOrderFailed(order);
          result = JSON.stringify(failResult);
          if (failResult.error) newStatus = "FAILED";
        }

      } else {
        result = "Unhandled event type: " + eventName;
      }

      // Update the log row
      ws.getRange(i + 1, COL_STATUS   + 1).setValue(newStatus);
      ws.getRange(i + 1, COL_PROC_AT  + 1).setValue(new Date());
      ws.getRange(i + 1, COL_RESULT   + 1).setValue(result);
      processed++;

      console.log("hdfc_processWebhookLog: row " + (i+1) + " → " + newStatus + " | " + result);
    }

    if (processed > 0) {
      console.log("hdfc_processWebhookLog: processed " + processed + " pending webhook(s).");
    }

  } catch (err) {
    console.error("hdfc_processWebhookLog error:", err.message);
  }
}

/**
 * Internal: Marks a Svaadh order row(s) as PAID in SK_Orders sheet.
 * Called by hdfc_handleWebhook on ORDER_SUCCEEDED.
 *
 * @param {Object} order  Order object from HDFC webhook content.order
 */
function hdfc_markOrderPaid(order) {
  const orderId = String(order.order_id || "").trim();
  let   txnId   = String(order.txn_id   || order.id || "").trim();  // reassigned below from Status API — must be let, not const
  const method  = String(order.payment_method_type || order.payment_method || "Gateway").trim();

  if (!orderId) return { error: "Webhook: missing order_id." };

  console.log("HDFC Webhook received for order: " + orderId + " via " + method);

  // ── Step 1: Verify payment via Status API (mandatory per HDFC security audit) ──
  // Never rely on the webhook payload alone. Confirm the order is truly CHARGED.
  const statusCheck = hdfc_getOrderStatus(orderId);
  if (!statusCheck.confirmed) {
    console.warn("hdfc_markOrderPaid: Status API returned '" + statusCheck.status + "' for " + orderId + ". Aborting mark-paid.");
    return { success: true, message: "Webhook received but Status API shows " + statusCheck.status + " — not marking paid." };
  }
  // Use txn_id from Status API if richer than what webhook provided
  if (statusCheck.txn_id && !txnId) txnId = statusCheck.txn_id;

  console.log("HDFC Status API confirmed CHARGED: " + orderId + " (TXN:" + txnId + ")");

  try {
    const ss      = getSpreadsheet();
    const ws      = getOrCreateTab(ss, TAB_ORDERS, []);
    const data    = ws.getDataRange().getValues();
    if (data.length < 2) return { error: "Orders sheet is empty." };

    const headers     = data[0];
    const COL_GATEWAY = headers.indexOf("Gateway_Order_ID");
    const COL_SID     = headers.indexOf("Submission_ID");
    const COL_PSTATUS = headers.indexOf("Payment_Status");
    const COL_PMETHOD = headers.indexOf("Payment_Method");
    const COL_NOTES   = headers.indexOf("Kitchen_Notes");

    if (COL_PSTATUS < 0) {
      return { error: "Webhook: required columns missing in SK_Orders." };
    }

    var updated = 0;
    for (var i = 1; i < data.length; i++) {
      let isMatch = false;
      if (COL_GATEWAY >= 0 && String(data[i][COL_GATEWAY] || "").trim() === orderId) {
        isMatch = true;
      } else if (COL_SID >= 0 && String(data[i][COL_SID] || "").trim() === orderId) {
        isMatch = true;
      }
      
      if (isMatch) {

        // ── Step 2: Duplicate check — skip if already marked Paid ──
        const currentStatus = String(data[i][COL_PSTATUS] || "").toLowerCase();
        if (currentStatus === "paid" || currentStatus === "collected") {
          console.log("hdfc_markOrderPaid: order " + orderId + " row " + (i+1) + " already Paid — skipping (duplicate webhook).");
          continue;
        }
        // ── NEVER resurrect a CANCELLED order ──────────────────────────────
        // A late/duplicate ORDER_SUCCEEDED webhook arriving AFTER the customer
        // cancelled must not flip the row back to "Paid" — the cancellation already
        // refunded them. Without this, cancelled orders reappeared as Paid →
        // kitchen would prep them and the customer is effectively double-charged.
        if (currentStatus.indexOf("cancel") !== -1 || (typeof _isOrderCancelled === "function" && _isOrderCancelled(data[i][COL_PSTATUS]))) {
          console.log("hdfc_markOrderPaid: order " + orderId + " row " + (i+1) + " is CANCELLED — skipping (won't re-mark Paid).");
          continue;
        }

        ws.getRange(i + 1, COL_PSTATUS + 1).setValue("Paid");
        if (COL_PMETHOD >= 0) {
          ws.getRange(i + 1, COL_PMETHOD + 1).setValue("Gateway (" + method + ")");
        }
        if (COL_NOTES >= 0 && txnId) {
          var existing = String(data[i][COL_NOTES] || "");
          var note = existing ? existing + " | TXN:" + txnId : "TXN:" + txnId;
          ws.getRange(i + 1, COL_NOTES + 1).setValue(note);
        }
        updated++;
      }
    }

    if (updated === 0) {
      console.warn("HDFC Webhook: order " + orderId + " not found in SK_Orders (or already Paid).");
      return { success: true, updated: 0, message: "Order " + orderId + " not found or already processed." };
    }

    return { success: true, updated: updated, message: "Order " + orderId + " marked paid (" + updated + " row(s))." };

  } catch (err) {
    console.error("hdfc_markOrderPaid error:", err.message);
    return { error: "Failed to update order: " + err.message };
  }
}

// HDFC/Juspay statuses that mean the transaction did NOT succeed.
var HDFC_FAILURE_STATES = [
  "AUTHORIZATION_FAILED", "AUTHENTICATION_FAILED", "JUSPAY_DECLINED",
  "DECLINED", "FAILED", "ERROR", "VOIDED", "VOID_INITIATED",
  "AUTO_REFUNDED", "CANCELLED"
];

/**
 * Internal: marks a Svaadh order row Failed when HDFC reports a failed/declined
 * payment via the webhook. Defensive — it will NEVER overwrite a Paid/Collected
 * row (so a late failure webhook from a retried attempt can't un-pay a confirmed
 * order). Most failed payments never create an order row at all (the order is
 * only written after hdfc_verifyReturn confirms CHARGED), so this is typically a
 * no-op that just records "no order placed".
 *
 * @param {Object} order  Order object from HDFC webhook content.order
 */
function hdfc_markOrderFailed(order) {
  const orderId = String(order.order_id || "").trim();
  const why     = String(order.status || "FAILED").toUpperCase();
  if (!orderId) return { error: "Webhook: missing order_id." };

  console.log("HDFC Webhook FAILURE for order " + orderId + " (status=" + why + ")");

  try {
    const ss   = getSpreadsheet();
    const ws   = getOrCreateTab(ss, TAB_ORDERS, []);
    const data = ws.getDataRange().getValues();
    if (data.length < 2) return { success: true, message: "No orders to update." };

    const headers     = data[0];
    const COL_GATEWAY = headers.indexOf("Gateway_Order_ID");
    const COL_SID     = headers.indexOf("Submission_ID");
    const COL_PSTATUS = headers.indexOf("Payment_Status");
    const COL_NOTES   = headers.indexOf("Kitchen_Notes");
    if (COL_PSTATUS < 0) return { error: "Webhook: required columns missing in SK_Orders." };

    var failed = 0, skippedPaid = 0;
    for (var i = 1; i < data.length; i++) {
      let isMatch = false;
      if (COL_GATEWAY >= 0 && String(data[i][COL_GATEWAY] || "").trim() === orderId) {
        isMatch = true;
      } else if (COL_SID >= 0 && String(data[i][COL_SID] || "").trim() === orderId) {
        isMatch = true;
      }

      if (isMatch) {
        const cur = String(data[i][COL_PSTATUS] || "").toLowerCase();
        // NEVER touch a confirmed-paid order (could be a later/duplicate attempt).
        if (cur === "paid" || cur === "collected" || cur === "wallet paid") { skippedPaid++; continue; }
        // NEVER un-cancel an order — a stray FAILED webhook must not overwrite a
        // "Cancelled …" status (same class of bug as the mark-paid resurrection).
        if (cur.indexOf("cancel") !== -1) continue;
        if (cur === "failed") continue; // already failed
        ws.getRange(i + 1, COL_PSTATUS + 1).setValue("Failed");
        if (COL_NOTES >= 0) {
          var existing = String(data[i][COL_NOTES] || "");
          var note = "Gateway " + why;
          ws.getRange(i + 1, COL_NOTES + 1).setValue(existing ? existing + " | " + note : note);
        }
        failed++;
      }
    }

    if (failed === 0) {
      return { success: true, message: skippedPaid
        ? "Order " + orderId + " already Paid — failure webhook ignored (later/duplicate attempt)."
        : "No unpaid order row for " + orderId + " — payment failed before any order was placed (nothing to mark)." };
    }
    return { success: true, message: "Order " + orderId + " marked Failed (" + failed + " row(s), " + why + ")." };

  } catch (err) {
    console.error("hdfc_markOrderFailed error:", err.message);
    return { error: "Failed to mark order failed: " + err.message };
  }
}

/**
 * Returns a human message if the gateway-charged amount is BELOW the
 * server-authoritative cart total (defense-in-depth post-payment amount check),
 * else null. Compares HDFC's actual charged amount against _computeAuthoritativeTotal
 * of the saved pending cart (minus the server-validated wallet portion for Split).
 */
function _hdfcAmountMismatch(gatewayOrderId, chargedAmount) {
  try {
    const charged = Number(chargedAmount || 0);
    if (charged <= 0) return null; // can't verify — don't block on missing data
    const props = PropertiesService.getScriptProperties();
    const pendingEntry = JSON.parse(props.getProperty("HDFC_PENDING_ORDERS") || "{}")[gatewayOrderId] || null;
    if (!pendingEntry || !pendingEntry.orders) return null; // no basis to compare
    const fullTotal     = _computeAuthoritativeTotal(pendingEntry.orders, pendingEntry.phone || "");
    const walletApplied = (String(pendingEntry.payment_choice || "") === "Split") ? Number(pendingEntry.wallet_applied || 0) : 0;
    const expected      = Math.max(0, fullTotal - walletApplied);
    if (expected > 0 && charged < expected - 1) {
      console.error("⚠️ submitOrder amount mismatch — order_id=" + gatewayOrderId
        + " charged=" + charged + " expected=" + expected);
      return "Payment amount mismatch (charged ₹" + charged + " vs expected ₹" + expected + ").";
    }
  } catch (e) { /* non-fatal — don't block on checker errors */ }
  return null;
}

/**
 * Server-authoritative confirmation of an HDFC order's pay status, for the
 * submitOrder write path. NEVER trusts client input.
 *   returns { status: "Paid" }                 — Status API CHARGED or verified webhook (+ amount OK)
 *   returns { status: "Failed", error }        — HDFC explicitly reports failure / amount mismatch
 *   returns { status: "Pending" }              — not yet confirmable (transient) — webhook/reconciler will confirm
 */
function _hdfcConfirmGatewayOrder(gatewayOrderId) {
  if (!gatewayOrderId) return { status: "Pending" };

  var sc;
  try { sc = hdfc_getOrderStatus(gatewayOrderId); }
  catch (e) { sc = { confirmed: false, status: "FETCH_ERROR", amount: 0 }; }
  const apiStatus = String(sc.status || "").toUpperCase();

  if (sc.confirmed) {
    const m = _hdfcAmountMismatch(gatewayOrderId, sc.amount);
    return m ? { status: "Failed", error: m } : { status: "Paid" };
  }
  if (HDFC_FAILURE_STATES.indexOf(apiStatus) !== -1) {
    return { status: "Failed", error: "HDFC reports the payment " + apiStatus + "." };
  }
  // Status API couldn't give a final verdict (transient) — a server-to-server
  // verified ORDER_SUCCEEDED webhook is also authoritative proof.
  var proof = null;
  try { proof = _checkWebhookLogForCharge(gatewayOrderId); } catch (_) {}
  if (proof) {
    const m2 = _hdfcAmountMismatch(gatewayOrderId, proof.amount);
    return m2 ? { status: "Failed", error: m2 } : { status: "Paid" };
  }
  // Nothing confirms it yet → write Pending, never Paid.
  return { status: "Pending" };
}


// ─────────────────────────────────────────────────────────────────────────────
// PENDING ORDER STORE
// Saves the full order payload server-side before the HDFC redirect.
// Retrieved on return — no sessionStorage/localStorage dependency.
// Stored in Script Properties as a JSON map, auto-expired after 6 hours.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Run this ONCE from the Apps Script editor to set up the 1-minute trigger
 * that calls hdfc_processWebhookLog() automatically.
 *
 * Menu: Run → setupHdfcWebhookTrigger
 * Only needed in the DEV project (same project that receives HDFC webhooks).
 */
function setupHdfcWebhookTrigger() {
  // Remove any existing trigger for this function first (avoid duplicates)
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === "hdfc_processWebhookLog") {
      ScriptApp.deleteTrigger(t);
    }
  });
  ScriptApp.newTrigger("hdfc_processWebhookLog")
    .timeBased()
    .everyMinutes(1)
    .create();
  console.log("✅ hdfc_processWebhookLog trigger created — runs every 1 minute.");
}

/**
 * DEV HELPER — Test gateway connectivity without a real payment.
 * Run this function directly from the Apps Script editor (Dev project only).
 * It will attempt to create a ₹1 session and log the result.
 */
function testHdfcConnection() {
  if (!PAYMENT_GATEWAY_ENABLED) {
    console.log("PAYMENT_GATEWAY_ENABLED is false. Enable it in Dev Script Properties first.");
    return;
  }
  const result = hdfc_createSession({
    phone:       "9999999999",
    name:        "Test Customer",
    amount:      1,
    order_id:    "SKTEST" + Date.now().toString(36).toUpperCase().slice(-9),  // alphanumeric ≤21
    description: "Svaadh Kitchen — Connection Test"
  });
  console.log("testHdfcConnection result:", JSON.stringify(result, null, 2));
}

/**
 * UAT smoke test for automatic refunds. Run from the Apps Script editor AFTER
 * completing a real test payment, passing that order's Gateway_Order_ID and the
 * amount (or a smaller partial amount). Verifies the refund API end-to-end
 * without going through a cancellation. Safe — UAT money only.
 *
 *   testHdfcRefund("SKG260607ABC123XYZ", 11);
 */
function testHdfcRefund(gatewayOrderId, amount) {
  if (!gatewayOrderId) { console.log("Pass a CHARGED UAT Gateway_Order_ID, e.g. testHdfcRefund('SKG...', 11)"); return; }
  const reqId  = ("RFT" + Date.now()).slice(0, 20); // HDFC: < 21 chars
  const result = hdfc_initiateRefund(gatewayOrderId, Number(amount) || 1, reqId);
  console.log("testHdfcRefund result:", JSON.stringify(result, null, 2));
}

// ZERO-RISK transport diagnostic: fire a refund at a NONEXISTENT order id and return
// the gateway's raw response. No such order exists, so no money can ever move — but
// the error class tells us whether our request FORMAT is accepted:
//   - an "order not found / invalid order" error  → auth+headers+body format are FINE
//     (the gateway parsed our request and looked up the order);
//   - a content-type / missing-header / auth error → the request format is the problem.
function hdfc_refundTransportTest() {
  const fakeOid = "SKDIAG" + Date.now().toString(36).toUpperCase().slice(-8);
  const reqId   = ("RFDIAG" + Date.now()).slice(0, 20);
  const res = hdfc_initiateRefund(fakeOid, 1, reqId);
  return { success: true, sent_order_id: fakeOid, result: res };
}


// ============================================================
// Wallet recharge via HDFC SmartGateway
// ============================================================
// hdfc_createWalletRechargeSession creates a top-up session;
// hdfc_finalizeWalletRecharge credits the wallet using the
// HDFC Status API as the authoritative amount source (client
// tampering of the recharge amount has no effect).
// ============================================================

/**
 * Create an HDFC SmartGateway session for a wallet TOP-UP (not order payment).
 * Server-authoritative amount: validated against bounds, used as the source of truth.
 * Client-supplied amount is logged but is the same as request — bounds enforced here.
 *
 * On successful payment, hdfc_finalizeWalletRecharge() must be called (via webhook
 * OR the customer's return-flow) to credit the wallet. That function calls the HDFC
 * Status API to get the ACTUAL charged amount and credits exactly that amount —
 * tampering the client-submitted amount has no effect because we trust HDFC's API.
 */
function hdfc_createWalletRechargeSession(body) {
  if (!PAYMENT_GATEWAY_ENABLED) return { error: "Gateway not enabled." };

  const phone = _normalizePhone(body.phone || "");
  let   amount = Number(body.amount);

  // ── Server-side bounds validation (mirrors submitWalletRecharge) ─────────
  if (!phone || phone.length !== 10)              return { error: "Invalid phone" };
  if (isNaN(amount) || !Number.isFinite(amount))  return { error: "Invalid amount" };
  amount = Math.round(amount);
  if (amount < 100)   return { error: "Minimum recharge is ₹100" };
  if (amount > 50000) return { error: "Maximum recharge per request is ₹50,000" };

  // Customer name from sheet
  let name = String(body.name || "Customer").trim();
  try {
    const cRow = _findCustomerRow(getSpreadsheet(), phone);
    if (cRow && cRow.Customer_Name) name = String(cRow.Customer_Name).trim();
  } catch(_) {}

  // Generate non-sequential gateway order ID, distinguished by 'W' (wallet topup).
  const now      = new Date();
  const datePart = String(now.getFullYear()).slice(-2)
                 + String(now.getMonth()+1).padStart(2,"0")
                 + String(now.getDate()).padStart(2,"0");
  const rand     = Utilities.getUuid().replace(/-/g,"").toUpperCase().slice(0,9);
  const orderId  = "SK" + datePart + "W" + rand;

  // Persist a recharge-pending entry so the return/webhook flow can credit later
  try {
    const props = PropertiesService.getScriptProperties();
    const raw   = props.getProperty("HDFC_PENDING_RECHARGES") || "{}";
    const pending = JSON.parse(raw);
    // Expire entries older than 30 minutes
    const nowMs = Date.now();
    Object.keys(pending).forEach(function(k) {
      if (nowMs - (pending[k].ts || 0) > 30*60*1000) delete pending[k];
    });
    pending[orderId] = { ts: nowMs, phone: phone, name: name, amount: amount };
    props.setProperty("HDFC_PENDING_RECHARGES", JSON.stringify(pending));
  } catch(e) { /* non-fatal */ }

  const payload = {
    order_id:               orderId,
    amount:                 amount,
    currency:               "INR",
    customer_id:            phone,
    customer_phone:         phone,
    customer_email:         phone + "@svaadh.noemail",
    payment_page_client_id: HDFC_MERCHANT_ID,
    action:                 "paymentPage",
    // Append _popup=1 so the popup window (which lives on a different
    // origin than the opener tab when the customer's site is on a custom
    // domain) can identify itself via URL params rather than localStorage.
    // localStorage is per-origin and unusable when opener and popup are
    // on different origins; URL params survive HDFC's redirect chain.
    return_url:             HDFC_RETURN_URL + (HDFC_RETURN_URL.indexOf("?") === -1 ? "?_popup=1" : "&_popup=1"),
    description:            "Svaadh Kitchen — Wallet Recharge ₹" + amount,
    first_name:             name.split(" ")[0] || name,
    last_name:              name.split(" ").slice(1).join(" ") || "",
    udf1:                   phone,
    udf3:                   "svaadh_kitchen_recharge",
    notification_url:       HDFC_RETURN_URL
  };

  // UPI-only (same policy as order payments) — no card / net-banking MDR.
  if (HDFC_UPI_ONLY) {
    // HDFC "payment locking" format (case-sensitive): allowDefaultOptions:false
    // hides every default method, then we re-enable ONLY UPI.
    payload.payment_filter = { allowDefaultOptions: false, options: [ { enable: true, paymentMethodType: "UPI" } ] };
  }

  try {
    const authToken = Utilities.base64Encode(HDFC_API_KEY + ":");
    const apiUrl = HDFC_BASE_URL + "/session";
    const resp = UrlFetchApp.fetch(apiUrl, {
      method: "post",
      contentType: "application/json",
      headers: { "Authorization": "Basic " + authToken, "x-merchantid": HDFC_MERCHANT_ID },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
    const respBody = JSON.parse(resp.getContentText());
    if (!respBody.payment_links || !respBody.payment_links.web) {
      console.error("hdfc_createWalletRechargeSession: no payment URL", respBody);
      return { error: "HDFC returned no payment URL." };
    }
    return { success: true, payment_url: respBody.payment_links.web, order_id: orderId, amount: amount };
  } catch(err) {
    console.error("hdfc_createWalletRechargeSession error:", err.message);
    return { error: err.message };
  }
}


/**
 * Finalise a wallet recharge after gateway payment. Called by:
 *   (a) The webhook (hdfc_handleWebhook) when ORDER_SUCCEEDED for a *_W_* order
 *   (b) The customer return-flow on order.html via _action=hdfc_verifyRecharge
 *
 * Crucially: we ALWAYS call HDFC Status API and credit the ACTUAL charged amount.
 * If the customer tampered request amount, HDFC charged the gateway-validated amount;
 * Status API returns that real amount; we credit exactly that. Untamperable.
 */
function hdfc_finalizeWalletRecharge(orderId) {
  const oid = String(orderId || "").trim();
  if (!oid) return { error: "order_id required" };
  if (oid.indexOf("W") === -1) return { error: "Not a wallet-recharge order" };

  // ── Race-condition lock ─────────────────────────────────────────────────
  // Webhook + customer-return can call this simultaneously. Without a lock,
  // both can pass the idempotency check before either writes, producing
  // duplicate credits. Hold an exclusive script lock for the duration.
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(15000);
  } catch (e) {
    console.warn("hdfc_finalizeWalletRecharge: could not acquire lock for " + oid + " — assuming concurrent finalize, treating as already-credited.");
    return { success: true, already_credited: true, message: "Concurrent finalize in progress" };
  }

  try {
    // Idempotency: check if already credited (column is "Reference_ID", not "Ref_Code")
    const wsAll = getOrCreateTab(getSpreadsheet(), TAB_WALLET, WALLET_HEADERS).getDataRange().getValues();
    const headerRow = wsAll[0] || [];
    const refCol = headerRow.indexOf("Reference_ID");
    if (refCol !== -1) {
      for (let i = 1; i < wsAll.length; i++) {
        if (String(wsAll[i][refCol] || "").trim() === oid) {
          console.log("hdfc_finalizeWalletRecharge: " + oid + " already credited — skipping.");
          return { success: true, already_credited: true, message: "Already credited" };
        }
      }
    }

    // Mandatory Status API check — single source of truth for charged amount
    const statusCheck = hdfc_getOrderStatus(oid);
    if (!statusCheck.confirmed) {
      return { error: "Payment not confirmed by gateway. Status: " + statusCheck.status };
    }
    const chargedAmount = Math.round(Number(statusCheck.amount || 0));
    if (chargedAmount <= 0) {
      return { error: "Gateway reports zero charged amount." };
    }

    // Look up phone/name from pending entry
    let phone = "", name = "Customer";
    try {
      const pending = JSON.parse(PropertiesService.getScriptProperties().getProperty("HDFC_PENDING_RECHARGES") || "{}");
      const entry = pending[oid];
      if (entry) { phone = entry.phone || ""; name = entry.name || "Customer"; }
    } catch(_) {}
    if (!phone) {
      return { error: "Could not identify customer for recharge " + oid };
    }

    // Credit exactly the gateway-confirmed amount. Verified=true (gateway is trusted).
    _appendWalletTransaction(phone, name, "Recharge (HDFC Gateway)", chargedAmount, true, oid);
    SpreadsheetApp.flush(); // ensure write is committed before lock release
    console.log("hdfc_finalizeWalletRecharge: credited ₹" + chargedAmount + " to " + phone + " (order " + oid + ")");

    return { success: true, amount_credited: chargedAmount, phone: phone };
  } finally {
    try { lock.releaseLock(); } catch(_) {}
  }
}


// ═══════════════════════════════════════════════════════════════════════════
// ON-ACCOUNT SETTLEMENT VIA HDFC GATEWAY
// Lets a monthly On-Account customer clear their dues through the gateway.
// DIRECT settlement: the gateway-confirmed amount marks the customer's oldest
// "on account" order rows "Paid" — no wallet round-trip (unlike the manual
// recharge → _autoSettlePendingOrders path). All gated by PAYMENT_GATEWAY_ENABLED.
// Order-id marker: SK + YYMMDD + 'A' + 9 chars  ('A' = on-Account).
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Authoritative on-account due (rupees) for a customer — computed from the
 * sheet, never from a client-supplied amount.
 *   scope "monthly" → only orders dated before the 1st of the current IST month
 *                     (matches getOnAccountBill — the finalized monthly bill).
 *   scope "all"     → every still-"on account" order up to now (pending-till-present).
 * @returns {{amount:Number, count:Number}}
 */
function _computeOnAccountDue(phone, scope) {
  const phoneStr = _normalizePhone(phone);
  if (!phoneStr) return { amount: 0, count: 0 };
  const ws   = getOrCreateTab(getSpreadsheet(), TAB_ORDERS, ORDERS_HEADERS);
  const rows = getAllRows(ws);

  let cutoff = null;
  if (String(scope).toLowerCase() === "monthly") {
    const now = getISTDate();
    cutoff = Utilities.formatDate(new Date(now.getFullYear(), now.getMonth(), 1), "Asia/Kolkata", "yyyy-MM-dd");
  }

  let amount = 0, count = 0;
  rows.forEach(function (r) {
    if (_normalizePhone(r.Phone) !== phoneStr) return;
    if (!_isOnAccountDueStatus(r.Payment_Status)) return;
    const ds = r.Order_Date instanceof Date
      ? Utilities.formatDate(r.Order_Date, "Asia/Kolkata", "yyyy-MM-dd")
      : String(r.Order_Date || "").trim();
    if (cutoff && (!ds || ds >= cutoff)) return; // monthly: only pre-cutoff orders
    const net = Number(r.Net_Total || 0);
    if (net > 0) { amount += net; count++; }
  });
  return { amount: Math.round(amount), count: count };
}

/**
 * Create an HDFC gateway session to settle a customer's On-Account dues.
 * Amount is ALWAYS recomputed server-side (anti-tamper); body.amount is ignored.
 */
function hdfc_createOnAccountSession(body) {
  if (!PAYMENT_GATEWAY_ENABLED) return { error: "Gateway not enabled." };

  const phone = _normalizePhone(body.phone || "");
  if (!phone || phone.length !== 10) return { error: "Invalid phone" };
  const scope = (String(body.scope || "all").toLowerCase() === "monthly") ? "monthly" : "all";

  const due = _computeOnAccountDue(phone, scope);
  const amount = due.amount;
  if (amount <= 0)      return { error: "No pending on-account dues to settle." };
  if (amount > 100000)  return { error: "Amount too large — please contact support." };

  let name = String(body.name || "Customer").trim();
  try {
    const cRow = _findCustomerRow(getSpreadsheet(), phone);
    if (cRow && cRow.Customer_Name) name = String(cRow.Customer_Name).trim();
  } catch(_) {}

  const now      = new Date();
  const datePart = String(now.getFullYear()).slice(-2)
                 + String(now.getMonth()+1).padStart(2,"0")
                 + String(now.getDate()).padStart(2,"0");
  const rand     = Utilities.getUuid().replace(/-/g,"").toUpperCase().slice(0,9);
  const orderId  = "SK" + datePart + "A" + rand;

  // Persist a pending entry so the return/webhook flow can settle later.
  try {
    const props   = PropertiesService.getScriptProperties();
    const pending = JSON.parse(props.getProperty("HDFC_PENDING_ONACCOUNT") || "{}");
    const nowMs   = Date.now();
    Object.keys(pending).forEach(function (k) {
      if (nowMs - (pending[k].ts || 0) > 30*60*1000) delete pending[k];
    });
    pending[orderId] = { ts: nowMs, phone: phone, name: name, amount: amount, scope: scope };
    props.setProperty("HDFC_PENDING_ONACCOUNT", JSON.stringify(pending));
  } catch(e) { /* non-fatal */ }

  const payload = {
    order_id:               orderId,
    amount:                 amount,
    currency:               "INR",
    customer_id:            phone,
    customer_phone:         phone,
    customer_email:         phone + "@svaadh.noemail",
    payment_page_client_id: HDFC_MERCHANT_ID,
    action:                 "paymentPage",
    return_url:             HDFC_RETURN_URL + (HDFC_RETURN_URL.indexOf("?") === -1 ? "?_popup=1" : "&_popup=1"),
    description:            "Svaadh Kitchen — On-Account Settlement ₹" + amount,
    first_name:             name.split(" ")[0] || name,
    last_name:              name.split(" ").slice(1).join(" ") || "",
    udf1:                   phone,
    udf3:                   "svaadh_kitchen_onaccount",
    notification_url:       HDFC_RETURN_URL
  };
  if (HDFC_UPI_ONLY) {
    payload.payment_filter = { allowDefaultOptions: false, options: [ { enable: true, paymentMethodType: "UPI" } ] };
  }

  try {
    const authToken = Utilities.base64Encode(HDFC_API_KEY + ":");
    const resp = UrlFetchApp.fetch(HDFC_BASE_URL + "/session", {
      method: "post",
      contentType: "application/json",
      headers: { "Authorization": "Basic " + authToken, "x-merchantid": HDFC_MERCHANT_ID },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
    const respBody = JSON.parse(resp.getContentText());
    if (!respBody.payment_links || !respBody.payment_links.web) {
      console.error("hdfc_createOnAccountSession: no payment URL", respBody);
      return { error: "HDFC returned no payment URL." };
    }
    return { success: true, payment_url: respBody.payment_links.web, order_id: orderId, amount: amount };
  } catch(err) {
    console.error("hdfc_createOnAccountSession error:", err.message);
    return { error: err.message };
  }
}

/**
 * Finalise an on-account settlement after gateway payment. Confirms via Status
 * API (single source of truth for the charged amount), then DIRECTLY marks the
 * customer's oldest "on account" order rows "Paid" up to that amount.
 * Idempotent (Script-Property log) + locked against webhook/return races.
 */
function hdfc_finalizeOnAccountPayment(orderId) {
  const oid = String(orderId || "").trim();
  if (!oid) return { error: "order_id required" };
  if (!/^SK\d{6}A/.test(oid)) return { error: "Not an on-account settlement order" };

  const lock = LockService.getScriptLock();
  try { lock.waitLock(15000); }
  catch (e) { return { success: true, already_settled: true, message: "Concurrent finalize in progress" }; }

  try {
    const props = PropertiesService.getScriptProperties();

    // Idempotency — log of already-settled on-account gateway orders.
    let settledLog = {};
    try { settledLog = JSON.parse(props.getProperty("HDFC_ONACCOUNT_SETTLED") || "{}"); } catch(_) {}
    if (settledLog[oid]) {
      return { success: true, already_settled: true, amount_settled: settledLog[oid].amount || 0 };
    }

    // Mandatory Status API check — never trust the return params for the amount.
    const statusCheck = hdfc_getOrderStatus(oid);
    if (!statusCheck.confirmed) {
      return { error: "Payment not confirmed by gateway. Status: " + statusCheck.status };
    }
    const chargedAmount = Math.round(Number(statusCheck.amount || 0));
    if (chargedAmount <= 0) return { error: "Gateway reports zero charged amount." };

    // Identify the customer from the pending entry.
    let phone = "", name = "Customer", scope = "all";
    try {
      const pending = JSON.parse(props.getProperty("HDFC_PENDING_ONACCOUNT") || "{}");
      const entry = pending[oid];
      if (entry) { phone = entry.phone || ""; name = entry.name || "Customer"; scope = entry.scope || "all"; }
    } catch(_) {}
    if (!phone) return { error: "Could not identify customer for settlement " + oid };

    // scope ("monthly" vs "all") decides whether a below-full-balance charge is an
    // expected monthly remainder or a genuine mid-payment shortfall worth emailing.
    const result = _settleOnAccountDirect(phone, chargedAmount, oid, scope);
    SpreadsheetApp.flush(); // commit row writes before releasing the lock

    settledLog[oid] = { phone: phone, amount: result.settled, count: result.count, rows: result.rows, ts: Date.now() };
    props.setProperty("HDFC_ONACCOUNT_SETTLED", JSON.stringify(settledLog));

    console.log("hdfc_finalizeOnAccountPayment: settled ₹" + result.settled + " across " + result.count
      + " order(s) for " + phone + " (" + oid + "); charged ₹" + chargedAmount);
    return { success: true, amount_settled: result.settled, orders_settled: result.count, charged: chargedAmount };
  } finally {
    try { lock.releaseLock(); } catch(_) {}
  }
}

/**
 * Mark a customer's "on account" order rows "Paid", funded by the gateway-
 * confirmed `amount`. NO wallet transaction (this is a direct gateway charge).
 *
 * 2026-07 incident: a customer paid ₹812 (their full displayed on-account due)
 * but 3 orders were left stranded, still showing On Account. Root cause: the
 * old logic walked orders oldest-first and did `remaining -= net` per row,
 * `break`-ing the ENTIRE loop the moment one row's net exceeded what was left
 * — so if an earlier-dated order happened to be larger than the remaining
 * balance at that point (rounding drift or ordering), every order AFTER it
 * was abandoned even if smaller and easily affordable, with zero indication
 * to the customer or admin. Fixed via two changes:
 *   1. FAST PATH — since `amount` is normally computed moments earlier as the
 *      exact current total of every "on account" row for this phone
 *      (_computeOnAccountDue), the common case is amount >= totalDue. When
 *      true, settle EVERY on-account row directly — no partial-fill loop,
 *      so this entire bug class cannot occur in the expected case.
 *   2. FALLBACK (amount < totalDue — e.g. a new on-account order landed in
 *      the gap between session-create and finalize) — walk oldest-first but
 *      never `break`; skip an order that doesn't fit and keep checking
 *      smaller ones after it, so a single oversized order can never strand
 *      the rest. Emails the owner since this path means the charge no longer
 *      covers the customer's full current balance and deserves a look.
 * Returns { settled, count, rows }.
 */
function _settleOnAccountDirect(phone, amount, gatewayOrderId, scope) {
  const phoneStr  = _normalizePhone(phone);
  const ws        = getOrCreateTab(getSpreadsheet(), TAB_ORDERS, ORDERS_HEADERS);
  const rows      = getAllRows(ws);
  const hIdx      = headerIndex(ws);
  const statusCol = hIdx["Payment_Status"];

  const pending = rows.filter(function (r) {
    if (_normalizePhone(_get(r, "Phone")) !== phoneStr) return false;
    if (!_isOnAccountDueStatus(_get(r, "Payment_Status"))) return false;
    return _cleanNum(_get(r, "Net_Total")) > 0;
  });
  // TRUE chronological sort. Order_Date is a Date OBJECT from the sheet —
  // String(Date) starts with the weekday name, so the old localeCompare sorted
  // "Fri < Mon < Thu…", scrambling "oldest-first" (a contributor to the ₹812
  // incident: with the old `break`, a scrambled order could settle a NEW
  // mid-payment order and strand rows that were part of the paid bill).
  const _dsKey = function (r) {
    const d = _get(r, "Order_Date");
    return d instanceof Date ? Utilities.formatDate(d, "Asia/Kolkata", "yyyy-MM-dd") : String(d || "").trim();
  };
  pending.sort(function (a, b) { return _dsKey(a).localeCompare(_dsKey(b)); });

  const target   = Math.round(Number(amount) || 0);
  const totalDue = pending.reduce(function (s, r) { return s + Math.round(_cleanNum(_get(r, "Net_Total"))); }, 0);

  // ₹2 tolerance: `target` is round(sum of floats) while totalDue is
  // sum(round(each net)) — legacy paise values can differ by a rupee or two.
  // A customer who paid the full computed bill must NEVER have a row stranded
  // over rounding noise.
  if (target >= totalDue - 2) {
    // FAST PATH — charge covers the entire current on-account balance. Settle
    // everything; nothing can be silently skipped.
    let settled = 0, count = 0;
    const settledRows = [];
    pending.forEach(function (r) {
      const net = Math.round(_cleanNum(_get(r, "Net_Total")));
      ws.getRange(r._row, statusCol).setValue("Paid");
      settled += net; count++;
      settledRows.push(String(_get(r, "Submission_ID") || _get(r, "Order_Date")));
    });
    Logger.log("_settleOnAccountDirect: FULL settlement for " + phoneStr + " — " + count
      + " order(s), ₹" + settled + " (charged ₹" + target + ", due was ₹" + totalDue + ", gateway " + gatewayOrderId + ")");
    return { settled: settled, count: count, rows: settledRows };
  }

  // FALLBACK — charge is less than the current full balance. Settle as many
  // orders as it covers, oldest-first, but SKIP (never break on) one that
  // doesn't fit so a single large order can't strand smaller ones after it.
  let remaining = target, settled = 0, count = 0;
  const settledRows = [];
  for (let i = 0; i < pending.length; i++) {
    const net = Math.round(_cleanNum(_get(pending[i], "Net_Total")));
    if (remaining >= net) {
      ws.getRange(pending[i]._row, statusCol).setValue("Paid");
      remaining -= net; settled += net; count++;
      settledRows.push(String(_get(pending[i], "Submission_ID") || _get(pending[i], "Order_Date")));
    }
  }

  // "Billed due" = what the customer was actually QUOTED to pay for THIS session,
  // which is NOT always the full balance. A MONTHLY bill (scope "monthly") covers
  // only orders before the 1st of the current IST month — the current month's
  // orders are meant to stay On Account and be billed next cycle (mirrors
  // _computeOnAccountDue's monthly cutoff). So for a monthly payment a charge
  // below the full balance is the NORMAL, expected state, NOT a mid-payment race,
  // and must not alarm the owner. Only alert when the charge fell short of the
  // BILLED due: an "all"-scope shortfall, or a monthly charge that didn't even
  // cover the prior-month bill (a genuine in-scope order landing mid-payment).
  let billDue = totalDue;
  if (String(scope || "all").toLowerCase() === "monthly") {
    const nowIST  = getISTDate();
    const cutoffM = Utilities.formatDate(new Date(nowIST.getFullYear(), nowIST.getMonth(), 1), "Asia/Kolkata", "yyyy-MM-dd");
    billDue = pending.reduce(function (s, r) {
      return (_dsKey(r) < cutoffM) ? s + Math.round(_cleanNum(_get(r, "Net_Total"))) : s;
    }, 0);
  }
  const coveredBill = target >= billDue - 2; // same ₹2 rounding tolerance as the fast path

  Logger.log("_settleOnAccountDirect: PARTIAL settlement for " + phoneStr + " — " + count
    + " order(s), ₹" + settled + " (charged ₹" + target + ", full due ₹" + totalDue
    + ", billed due ₹" + billDue + ", scope " + (scope || "all") + ", coveredBill " + coveredBill
    + ", gateway " + gatewayOrderId + ")");

  // Expected monthly remainders (coveredBill === true) settle silently — no email.
  if (!coveredBill) {
    try {
      const adminEmail = SP.getProperty("ADMIN_EMAIL");
      if (adminEmail) {
        MailApp.sendEmail(adminEmail, "⚠️ Svaadh: On-Account settlement didn't cover the billed dues",
          "Customer " + phoneStr + " was charged ₹" + target + " for on-account dues, but the amount billed"
          + " for this payment was ₹" + billDue + " (likely a new in-scope on-account order landed between"
          + " payment start and confirmation). Settled ₹" + settled + " across " + count + " order(s); the"
          + " remainder is still On Account. Gateway order: " + gatewayOrderId + ". Please review — nothing was"
          + " silently lost, this is just a heads-up that the billed balance changed mid-payment.");
      }
    } catch (e) {}
  }
  return { settled: settled, count: count, rows: settledRows };
}
