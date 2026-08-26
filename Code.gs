// ============================================================
// Code.gs — SVAADH KITCHEN core (router, orders, menu, kitchen, etc.)
// Global config/constants live in 00_Config.gs (loads first).
// ============================================================


// ── CONSTANT-TIME PIN COMPARISON ─────────────────────────────
// Prevents timing-oracle attacks where comparing a wrong-length PIN
// returns faster than a correct-length one, leaking PIN length.
// Pads both sides to 32 chars, XORs every character, checks all at once.
function _pinMatch(supplied, expected) {
  const a = String(supplied || "").padEnd(32, "\0");
  const b = String(expected  || "").padEnd(32, "\0");
  let diff = 0;
  for (let i = 0; i < 32; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  // Also require lengths match (padEnd would equalize lengths, so check originals)
  return diff === 0 && String(supplied).length === String(expected).length;
}

// ── ENTRY POINT ──────────────────────────────────────────────
function doGet(e) {
  const p = e.parameter;
  const action = p.parameter ? p.action : (e.parameter.action || ""); // Fix for inconsistent parameter access
  const pin = p.pin || "";

  // Auth tiers resolved FIRST so every route below can safely reference them
  const isAdmin = _pinMatch(pin, ADMIN_PIN) && pin !== "";
  const isStaff = (_pinMatch(pin, KITCHEN_PIN) || _pinMatch(pin, ADMIN_PIN)) && pin !== "";

  // ── HDFC Return URL via GET ────────────────────────────────────
  // HDFC sometimes redirects the customer's browser via GET (not POST).
  // Detect by presence of order_id + status params with no _action.
  // Redirect browser to the correct order page with all params forwarded.
  // IA orders (order_id starts with "IA") → intentamplify.html
  // LS orders (order_id starts with "LS") → Liviano-Serio.html (storefront clone)
  // Svaadh orders → order.html
  if (p.order_id && p.status && !p.action && !p._action) {
    const params = Object.keys(p)
      .map(function(k) { return encodeURIComponent(k) + "=" + encodeURIComponent(p[k]); })
      .join("&");
    const _oidPrefix = String(p.order_id).slice(0, 2).toUpperCase();
    const targetPage = _oidPrefix === "IA" ? IA_ORDER_PAGE_URL
                     : _oidPrefix === "LS" ? LS_ORDER_PAGE_URL
                     : HDFC_ORDER_PAGE_URL;
    const redirectUrl = targetPage + "?" + params;
    // Sandbox-aware full-viewport click target — auto-navigation is blocked
    // inside the Apps Script HtmlService iframe in many browsers. (10_Hdfc_Gateway)
    return HtmlService.createHtmlOutput(_hdfcReturnRedirectHtml(redirectUrl));
  }
  // ─────────────────────────────────────────────────────────────

  try {
    if (action === "testPerf") {
      const s = Date.now();
      _getAdminDataUncached();
      return jsonRes({ms: Date.now() - s});
    }

    if (action === "testError") {
      try { return jsonRes(_getAdminDataUncached()); } catch (e) { return jsonRes({error: e.message, stack: e.stack}); }
    }
    if (action === "testKitchen") {
      try { return jsonRes(getKitchenSummary(p.date || "2026-08-19")); } catch (e) { return jsonRes({error: e.message, stack: e.stack}); }
    }
    if (action === "version") return jsonRes({version: CODE_VERSION, status:"ok"});
    if (action === "health") {
      // Lightweight liveness probe — reads one cell to confirm sheet connectivity.
      // Does NOT load orders or menu. Safe to call frequently from monitors.
      try {
        const ss = getSpreadsheet();
        const sheetCount = ss.getNumSheets();
        return jsonRes({ status: "ok", version: CODE_VERSION, sheets: sheetCount, ts: new Date().toISOString() });
      } catch(hErr) {
        return jsonRes({ status: "error", error: hErr.message, ts: new Date().toISOString() });
      }
    }
    if (action === "getConfig") return jsonRes({
      gateway_enabled: PAYMENT_GATEWAY_ENABLED,
      gateway_env: HDFC_ENV,
      pricing_v2: PRICING_V2,
      // Site-wide default cutoffs (admin-editable via SK_Default_Cutoffs) — public,
      // not sensitive, and the order page needs it to show the right "Order by X"
      // time / early-extended labels without the customer having any admin PIN.
      default_cutoffs: _getDefaultCutoffs()
    });
    if (action === "getAreas") return jsonRes(getAreas());
    if (action === "getDefaultCutoffs") {
      if (!isAdmin) return jsonRes({error:"STRICT ADMIN PIN REQUIRED"});
      return jsonRes(getDefaultCutoffs());
    }
    if (action === "getDefaultOrderCaps") {
      if (!isAdmin) return jsonRes({error:"STRICT ADMIN PIN REQUIRED"});
      return jsonRes(getDefaultOrderCaps());
    }
    if (action === "getRateCard") return jsonRes(getRateCard()); // public — no login needed
    if (action === "getBulkWindow") return jsonRes(getBulkWindow(p.plan)); // bulk order date windows
    if (action === "getBulkPostponeInfo") return jsonRes(getBulkPostponeInfo(p.phone, p.rowId)); // read-only: postpone eligibility + valid dates for one bulk row
    if (action === "backfillBulkPlan") { if (!isAdmin) return jsonRes({ error: "STRICT ADMIN PIN REQUIRED" }); return jsonRes(backfillBulkPlan(p.commit === "1")); } // one-time: stamp Bulk_Plan on pre-v26 bulk rows (dry-run unless commit=1)
    if (action === "compactWalletLedger") { if (!isAdmin) return jsonRes({ error: "STRICT ADMIN PIN REQUIRED" }); return jsonRes(compactWalletLedger(p.commit === "1", p.keepDays)); } // wallet ledger compaction: dry-run unless commit=1; keepDays default 90 (min 30)
    if (action === "lsTrimSchema") { if (!isAdmin) return jsonRes({ error: "STRICT ADMIN PIN REQUIRED" }); return jsonRes(lsTrimSchema(p.commit === "1")); } // LS_Orders schema trim (drops Maps_Link/Landmark): dry-run unless commit=1
            if (action === "stripLSPrefix") { if (!isAdmin) return jsonRes({ error: "STRICT ADMIN PIN REQUIRED" }); return jsonRes(stripLSPrefix(p.commit === "1")); } // remove [LS] prefix from Customer_Name in LS_Orders (dry-run unless commit=1)
if (action === "fixCustomerPins") { if (!isAdmin) return jsonRes({ error: "STRICT ADMIN PIN REQUIRED" }); return jsonRes(fixCustomerPins(p.commit === "1")); } // scan + fix PINs that lost leading zeros (dry-run unless commit=1)
    if (action === "archiveRunNow") { if (!isAdmin) return jsonRes({ error: "STRICT ADMIN PIN REQUIRED" }); return jsonRes(archiveDueOrders(false)); } // manual archive run — archives all due rows now
    if (action === "archiveDueDryRun") { if (!isAdmin) return jsonRes({ error: "STRICT ADMIN PIN REQUIRED" }); return jsonRes(archiveDueOrders(true, p.today || "")); } // due-slice archive preview: shows exactly which rows the next run would archive (no writes)
    if (action === "cleanupOrderLog") { if (!isAdmin) return jsonRes({ error: "STRICT ADMIN PIN REQUIRED" }); return jsonRes(cleanupOrderLog()); } // manual cleanup of SK_Order_Log: deletes yesterday and older entries
    if (action === "recoverFromOrderLog") { if (!isAdmin) return jsonRes({ error: "STRICT ADMIN PIN REQUIRED" }); return jsonRes(recoverFromOrderLog()); } // manual run of SK_Order_Log recovery sweep
    if (action === "setupMonthlyArchiveTrigger" || action === "setupArchiveTrigger") { if (!isAdmin) return jsonRes({ error: "STRICT ADMIN PIN REQUIRED" }); return jsonRes({ success: true, message: setupMonthlyArchiveTrigger() }); }
    if (action === "setupLostOrderAuditTrigger") { if (!isAdmin) return jsonRes({ error: "STRICT ADMIN PIN REQUIRED" }); return jsonRes({ success: true, message: setupLostOrderAuditTrigger() }); } // installs daily 22:30 IST trigger for archive + cleanup
    if (action === "genLabels") { // regenerate a date+meal's label PDF on demand (same engine as the cutoff+5 auto-run)
      if (!isAdmin) return jsonRes({ error: "STRICT ADMIN PIN REQUIRED" });
      if (p.debug === "1") { // build-only: return the PDF base64 for inspection — no Drive save, no print webhook
        const _lo = getLabelOrders(String(p.date || ""), String(p.meal || ""));
        const _ord = (_lo && _lo.orders) || [];
        if (!_ord.length) return jsonRes({ success: true, count: 0, note: "no orders" });
        const _gapRaw = SP.getProperty("LABEL_GAP_MM");
        const _gap = (_gapRaw !== null && !isNaN(Number(_gapRaw))) ? Number(_gapRaw) : 2.7;
        return jsonRes({ success: true, count: _ord.length, gap: _gap, b64: _lblBuildPdfB64(_ord, String(p.meal || ""), LBL_AUTO_LANG, _gap) });
      }
      return jsonRes(autoGenerateLabels(String(p.date || ""), String(p.meal || "")));
    }
    if (action === "reconcileMissedOrders") { if (!isAdmin) return jsonRes({ error: "STRICT ADMIN PIN REQUIRED" }); return jsonRes(reconcileMissedOrdersLog(p.debug === "1")); } // verify/restore STILL-MISSING log entries + "recovered & written" mail (debug=1: read-only diagnosis)
    if (action === "auditAmanoraTowers") { if (!isAdmin) return jsonRes({ error: "STRICT ADMIN PIN REQUIRED" }); return jsonRes(auditAmanoraTowers()); } // read-only: Amanora tower# → society co-occurrence from customers+orders+archives
    if (action === "seedAmanoraTowerAliases") { if (!isAdmin) return jsonRes({ error: "STRICT ADMIN PIN REQUIRED" }); return jsonRes(seedAmanoraTowerAliases(p.commit === "1")); } // owner-confirmed tower→society alias rows (dry-run unless commit=1)
    if (action === "bulkQuote") { // dry-run bulk pricing (no writes) — params: plan, phone, area, lunch/dinner (JSON array of {colKey,qty}), storefront ("LS" = Liviano-Serio pricing)
      const _pj = function (s) { try { return s ? JSON.parse(s) : null; } catch (e) { return null; } };
      const _wrap = function (arr) { return (Array.isArray(arr) && arr.length) ? { items: arr } : null; }; // submitBulkOrder expects {items:[…]}
      return jsonRes(submitBulkOrder({ dryRun: true, plan: p.plan, phone: p.phone,
        storefront: String(p.storefront || "").trim().toUpperCase() === "LS" ? "LS" : "",
        profile: { area: p.area || "" },
        lunch:  _wrap(_pj(p.lunch)),
        dinner: _wrap(_pj(p.dinner)) }));
    }
    if (action === "verifyAdminPin") return jsonRes({success: isAdmin});
    if (action === "getCustomer") return jsonRes(getCustomer(p.phone, p.storefront === "LS" ? "LS" : ""));
    if (action === "fetchArchivedAddress") return jsonRes(fetchArchivedAddress(p.phone)); // returning customer restore
    if (action === "verifyLogin") return jsonRes(verifyLogin(p.phone, p.pin, p.storefront === "LS" ? "LS" : ""));
    if (action === "ackLoginNotice") return jsonRes(acknowledgeLoginNotice(p.phone)); // customer taps "I understand" on a login notice
    if (action === "seedDeliveryNotices") { if (!isAdmin) return jsonRes({ error: "STRICT ADMIN PIN REQUIRED" }); return jsonRes(seedDeliveryStopNotices(p.commit === "1")); } // seed the 12 delivery-stop login notices (dry-run unless commit=1)
    if (action === "cleanDeliveryAddresses") { if (!isAdmin) return jsonRes({ error: "STRICT ADMIN PIN REQUIRED" }); return jsonRes(cleanDeliveryStopAddresses(p.commit === "1")); } // clear the 12 affected customers' stale addresses, backed up (dry-run unless commit=1)
    if (action === "setPin") {
      const profile = { phone: p.phone, pin: p.pin };
  _upsertCustomer(getSpreadsheet(), profile, p.storefront === 'LS' ? 'LS' : '');
      return jsonRes({success:true});
    }
    if (action === "getWeeklyMenu") return jsonRes(getWeeklyMenu());
    if (action === "markOnAccount") {
      if (!isAdmin) return jsonRes({error:"STRICT ADMIN PIN REQUIRED"});
      return jsonRes(markOnAccount(p.phone, p.cycle, p.status));
    }
    if (action === "getOnAccountBill") return jsonRes(getOnAccountBill(p.phone));

    // KITCHEN & DRIVER ACCESS (Staff PIN ONLY)
    if (action === "getKitchenSummary") {
      if (!isStaff) return jsonRes({error:"STRICT STAFF PIN REQUIRED"});
      return jsonRes(getKitchenSummary(p.date));
    }
    if (action === "getDriverOrders") {
      if (!isStaff) return jsonRes({error:"STRICT STAFF PIN REQUIRED"});
      return jsonRes(getDriverOrders(p.date));
    }
    if (action === "getDeliveryRoute") {
      if (!isStaff) return jsonRes({error:"STRICT STAFF PIN REQUIRED"});
      return jsonRes(getDeliveryRoute());
    }
    if (action === "buildDeliveryRoute") {
      if (!isStaff) return jsonRes({error:"STRICT STAFF PIN REQUIRED"});
      return jsonRes(buildDeliveryRoute(p.days));
    }
    if (action === "createDeliverySheet") {
      if (!isStaff) return jsonRes({error:"STRICT STAFF PIN REQUIRED"});
      return jsonRes(createDeliverySheet(p.date, p.meal));
    }
    if (action === "getLabelOrders") {
      if (!isStaff) return jsonRes({error:"STRICT STAFF PIN REQUIRED"});
      return jsonRes(getLabelOrders(p.date, p.meal));
    }
    // ── LABEL GAP (shared across all kitchen devices) ──
    // Reads + writes a single global label-gap value so kitchen tablets,
    // phones, and admin laptops always use the same spacing. Frontend
    // localStorage stays only as a same-device fallback if the network
    // call fails.
    if (action === "getLabelGap") {
      // Public-ish — any staff can read.
      if (!isStaff) return jsonRes({error:"STRICT STAFF PIN REQUIRED"});
      const v = SP.getProperty("LABEL_GAP_MM");
      const num = (v !== null && !isNaN(Number(v))) ? Number(v) : 2.7;
      return jsonRes({gap_mm: num});
    }

    if (action === "auditOnAccountDrift") {
      if (!isAdmin) return jsonRes({error:"STRICT ADMIN PIN REQUIRED"});
      return jsonRes(auditOnAccountStatusDrift());
    }

    // FULL ADMIN ACCESS (Admin PIN ONLY)
    if (action === "getAdminData") {
      if (!isAdmin) return jsonRes({error:"STRICT ADMIN PIN REQUIRED"});
      return jsonRes(getAdminData());
    }
    if (action === "getUnpaidCustomers") {
      if (!isAdmin) return jsonRes({error:"STRICT ADMIN PIN REQUIRED"});
      return jsonRes(getUnpaidCustomers(p));
    }
    if (action === "getOrderSummary") {
      if (!isAdmin) return jsonRes({error:"STRICT ADMIN PIN REQUIRED"});
      return jsonRes(getOrderSummary(p.date));
    }
    if (action === "getUnpaidOrdersData") {
      if (!isAdmin) return jsonRes({error:"STRICT ADMIN PIN REQUIRED"});
      return jsonRes(getUnpaidOrdersData(p));
    }
    if (action === "getPackagingExpenses") {
      if (!isAdmin) return jsonRes({error:"STRICT ADMIN PIN REQUIRED"});
      if (p.from && p.to) return jsonRes(getPackagingExpensesRange(p.from, p.to));
      return jsonRes(getPackagingExpenses(p.date));
    }
    if (action === "getOrderHistory") {
      if (!isAdmin) return jsonRes({error:"STRICT ADMIN PIN REQUIRED"});
      return jsonRes(getOrderHistory(p));
    }
    if (action === "getCustomerList") {
      if (!isAdmin) return jsonRes({error:"STRICT ADMIN PIN REQUIRED"});
      return jsonRes(getCustomerList());
    }
    if (action === "getCustomerHistory") {
      if (!isAdmin) return jsonRes({error:"STRICT ADMIN PIN REQUIRED"});
      return jsonRes(getCustomerHistory(p.phone));
    }
    if (action === "getDatePayments") {
      if (!isAdmin) return jsonRes({error:"STRICT ADMIN PIN REQUIRED"});
      return jsonRes(getDatePayments(p.date));
    }
    if (action === "getAnalytics") {
      if (!isAdmin) return jsonRes({error:"STRICT ADMIN PIN REQUIRED"});
      return jsonRes(getAnalytics(p));
    }
    if (action === "getForecastedMonthlySales") {
      if (!isAdmin) return jsonRes({error:"STRICT ADMIN PIN REQUIRED"});
      return jsonRes(getForecastedMonthlySales());
    }
    if (action === "getExpenses") {
      if (!isAdmin) return jsonRes({error:"STRICT ADMIN PIN REQUIRED"});
      return jsonRes(getExpenses(p));
    }
    if (action === "getExpenseAnalytics") {
      if (!isAdmin) return jsonRes({error:"STRICT ADMIN PIN REQUIRED"});
      return jsonRes(getExpenseAnalytics(p));
    }
    if (action === "getCustomExpenseCategories") {
      if (!isAdmin) return jsonRes({error:"STRICT ADMIN PIN REQUIRED"});
      return jsonRes({ success:true, categories: getCustomExpenseCategories() });
    }
    if (action === "getInventoryData") {
      if (!isAdmin) return jsonRes({error:"STRICT ADMIN PIN REQUIRED"});
      return jsonRes(getInventoryData(p));
    }
    if (action === "adminCreditWallet") {
      if (!isAdmin) return jsonRes({error:"STRICT ADMIN PIN REQUIRED"});
      return jsonRes(adminCreditWallet(body));
    }
    if (action === "getChurnReport") {
      if (!isAdmin) return jsonRes({error:"STRICT ADMIN PIN REQUIRED"});
      return jsonRes(getChurnReport(p.sinceDate));
    }
    if (action === "listRecentRefunds") {
      if (!isAdmin) return jsonRes({error:"STRICT ADMIN PIN REQUIRED"});
      return jsonRes(listRecentRefunds(p.n)); // read-only diagnostic: last n refund rows, ALL statuses
    }
    if (action === "hdfcRefundTransportTest") {
      if (!isAdmin) return jsonRes({error:"STRICT ADMIN PIN REQUIRED"});
      return jsonRes(hdfc_refundTransportTest()); // zero-risk: refund a nonexistent order id, return raw error
    }
    if (action === "getPendingRefunds") {
      if (!isAdmin) return jsonRes({error:"STRICT ADMIN PIN REQUIRED"});
      return jsonRes(getPendingRefunds());
    }
    if (action === "getPendingRecharges") {
      if (!isAdmin) return jsonRes({error:"Invalid PIN"});
      return jsonRes(getPendingRecharges());
    }
    if (action === "getPendingUPIPayments") {
      if (!isAdmin) return jsonRes({error:"Invalid PIN"});
      return jsonRes(getPendingUPIPayments());
    }
    if (action === "getPendingCounts") {
      if (!isAdmin) return jsonRes({error:"Invalid PIN"});
      return jsonRes({
        refunds: getPendingRefunds().length,
        wallet: getPendingRecharges().length,
        payments: getPendingUPIPayments().length
      });
    }

    if (action === "syncGA4Data") {
      if (!isAdmin) return jsonRes({error:"STRICT ADMIN PIN REQUIRED"});
      return jsonRes({success: true, message: syncGA4Data()});
    }
    if (action === "setupAnalyticsTrigger") {
      if (!isAdmin) return jsonRes({error:"STRICT ADMIN PIN REQUIRED"});
      return jsonRes({success: true, message: setupAnalyticsTrigger()});
    }
    
    // Keep-alive ping — just wakes GAS, no sheet reads
    if (action === "ping") return jsonRes({ok: true, t: new Date().toISOString()});

    // Fallback menu / orders for customers (legacy)
    if (action === "getMenu") return jsonRes(getMenu(p.date));
    if (action === "getMenuBatch") return jsonRes(getMenuBatch(p.dates));
    if (action === "getBreakfastItemDates") return jsonRes(getBreakfastItemDates(p.items));
    if (action === "getKitchenClosedDates") return jsonRes(getKitchenClosedDates());
    if (action === "getWeeklyMenu") return jsonRes(getWeeklyMenu());
    if (action === "getCustomerOrders") return jsonRes(getCustomerOrders(p.phone, p.storefront === "LS" ? "LS" : ""));
    if (action === "getWalletValue") return jsonRes({wallet_balance: _calculateWalletBalance(p.phone)});
    if (action === "getWalletTransactions") return jsonRes(getWalletTransactions(p.phone, p.storefront === "LS" ? "LS" : ""));
    if (action === "getDayTotalsForDates") return jsonRes(getDayTotalsForDates(p.phone, p.dates));
    if (action === "listSocieties") return jsonRes(listDistinctSocieties()); // admin audit: distinct society spellings (for SK_Society_Aliases)

    // ── IntentAmplify (corporate channel) — GET ────────────────
    if (action === "ia_config")          return jsonRes(ia_config());
    if (action === "ia_checkPhone")      return jsonRes(ia_checkPhone(p.phone));
    if (action === "ia_verifyLogin")     return jsonRes(ia_verifyLogin(p.phone, p.pin));
    if (action === "ia_getMenu")         return jsonRes(ia_getMenuRange((p.dates||"").split(",").filter(Boolean), IA_MEALS));
    if (action === "ia_myOrders")        return jsonRes(ia_myOrders(p.phone));
    if (action === "ia_adminOrders")     return jsonRes(ia_adminOrders(p));
    if (action === "ia_pendingApprovals")return jsonRes(ia_pendingApprovals(p));
    if (action === "ia_customers")       return jsonRes(ia_customers(p));
    if (action === "ia_analytics")       return jsonRes(ia_analytics(p));
    if (action === "ia_prep")            return jsonRes(ia_prep(p));
    if (action === "ia_getDriverOrders") return jsonRes(ia_getDriverOrders(p));
    if (action === "ia_getKitchenSummary") return jsonRes(ia_getKitchenSummary(p));
    if (action === "ia_getLabelOrders")    return jsonRes(ia_getLabelOrders(p));
    if (action === "ia_gatewayEnabled")    return jsonRes({ gateway_enabled: PAYMENT_GATEWAY_ENABLED, gateway_env: HDFC_ENV });

    return jsonRes({error:"Unknown action or Access Denied"});
  } catch(err) {
    return jsonRes({error: err.message});
  }
}

function doPost(e) {
  try {
    // ── HDFC Return URL Handler ────────────────────────────────
    // Juspay POSTs payment result to our return URL (GitHub Pages can't accept POST → 405).
    // We use the Apps Script URL as the return URL instead.
    // When HDFC posts here with order_id + status (no _action), serve an HTML page
    // that immediately JS-redirects the browser to order.html with those params as GET params.
    const rawBody = e.postData ? e.postData.contents : "";
    let parsedForHdfc = {};
    try { parsedForHdfc = JSON.parse(rawBody); } catch(_) {}
    const isHdfcReturn = parsedForHdfc.order_id && parsedForHdfc.status && !parsedForHdfc._action;
    if (isHdfcReturn) {
      const params = Object.keys(parsedForHdfc)
        .map(k => encodeURIComponent(k) + "=" + encodeURIComponent(parsedForHdfc[k]))
        .join("&");
      // IA orders (order_id starts with "IA") → intentamplify.html
      // LS orders (order_id starts with "LS") → Liviano-Serio.html; Svaadh → order.html
      const _pfx1 = String(parsedForHdfc.order_id).slice(0, 2).toUpperCase();
      const targetPage = _pfx1 === "IA" ? IA_ORDER_PAGE_URL : _pfx1 === "LS" ? LS_ORDER_PAGE_URL : HDFC_ORDER_PAGE_URL;
      const redirectUrl = targetPage + "?" + params;
      return HtmlService.createHtmlOutput(_hdfcReturnRedirectHtml(redirectUrl));
    }
    // ── Also handle form-encoded POST (Juspay sends this for the failure path)
    // Includes the popup-close loop so AUTHORIZATION_FAILED closes the popup
    // automatically — matching the success-path behaviour. Without the close
    // attempts the customer had to manually close the failure popup.
    if (!parsedForHdfc.order_id && e.postData && e.postData.type === "application/x-www-form-urlencoded") {
      const formParams = e.parameter || {};
      if (formParams.order_id && formParams.status) {
        const params = Object.keys(formParams)
          .map(k => encodeURIComponent(k) + "=" + encodeURIComponent(formParams[k]))
          .join("&");
        const _pfx2 = String(formParams.order_id).slice(0, 2).toUpperCase();
        const targetPage = _pfx2 === "IA" ? IA_ORDER_PAGE_URL : _pfx2 === "LS" ? LS_ORDER_PAGE_URL : HDFC_ORDER_PAGE_URL;
        const redirectUrl = targetPage + "?" + params;
        return HtmlService.createHtmlOutput(_hdfcReturnRedirectHtml(redirectUrl));
      }
    }
    // ── Normal API actions ─────────────────────────────────────
    const body = JSON.parse(rawBody);
    const action = body._action || "";
    const pin = body.pin || "";
    const isAdmin = _pinMatch(pin, ADMIN_PIN) && pin !== "";
    const isStaff = (_pinMatch(pin, KITCHEN_PIN) || _pinMatch(pin, ADMIN_PIN)) && pin !== "";

    // Customer self-service (phone-verified inside each function)
    if (action === "deleteOrder") return jsonRes(deleteOrder(body.phone, body.rowId, body.refundType, { isAdmin: isAdmin }));
    if (action === "postponeBulkOrder") return jsonRes(postponeBulkOrder(body)); // reschedule a bulk day (15-day/month); phone-verified + capped inside
    if (action === "previewCancellation") return jsonRes(_deleteOrderInternal(body.phone, body.rowId, body.refundType || "wallet", { dryRun: true }));
    if (action === "getCustomerOrders") return jsonRes(getCustomerOrders(body.phone, _lsStorefront(body)));
    if (action === "fetchArchivedAddress") return jsonRes(fetchArchivedAddress(body.phone));
    if (action === "requestPinResetOtp") return jsonRes(requestPinResetOtp(body.phone, _lsStorefront(body))); // Forgot PIN: email a 6-digit OTP to the on-file address
    if (action === "verifyPinResetOtp") return jsonRes(verifyPinResetOtp(body.phone, body.otp, body.newPin, _lsStorefront(body))); // Forgot PIN: verify OTP + set the new PIN (POST — newPin never in a URL)
    if (action === "checkDeliveryReachable") return jsonRes(checkDeliveryReachable(body));
    if (action === "verifyOrderPlaced") return jsonRes(verifyOrderPlaced(body));
    if (action === "updateProfile") {
      const profile = body.profile;
      if (!profile || !profile.phone) return jsonRes({error: "Phone required"});
      // SECURITY: these are admin-only fields (set via the gated markOnAccount /
      // toggleFeeExempt). Strip them from the unauthenticated customer upsert so
      // nobody can self-promote a phone to pay-later On-Account by knowing it.
      delete profile.onAccount; delete profile.billingCycle;
  _upsertCustomer(getSpreadsheet(), profile, _lsStorefront(body));
      return jsonRes({success: true});
    }

    // Admin-only read: returns all customer profiles + wallet balances
    if (action === "getCustomerList") {
      if (!isAdmin) return jsonRes({error:"STRICT ADMIN PIN REQUIRED"});
      return jsonRes(getCustomerList());
    }
    
    // Delivery Actions (Staff PIN ONLY)
    if (action === "markDelivered") {
      if (!isStaff) return jsonRes({error:"STRICT STAFF PIN REQUIRED"});
      return jsonRes(markDelivered(body));
    }
    if (action === "batchMarkEnRoute") {
      if (!isStaff) return jsonRes({error:"STRICT STAFF PIN REQUIRED"});
      return jsonRes(batchMarkEnRoute(body));
    }
    if (action === "batchMarkDelivered") {
      if (!isStaff) return jsonRes({error:"STRICT STAFF PIN REQUIRED"});
      return jsonRes(batchMarkDelivered(body));
    }
    if (action === "setStandardOrder") {
      if (!isAdmin) return jsonRes({error:"STRICT ADMIN PIN REQUIRED"});
      return jsonRes(setStandardOrder(body.phone, body.items, body.templateName, body.meal));
    }
    if (action === "removeStandardOrder") {
      if (!isAdmin) return jsonRes({error:"STRICT ADMIN PIN REQUIRED"});
      return jsonRes(removeStandardOrder(body.phone, body.templateName));
    }
    if (action === "placeBulkOrders") {
      if (!isAdmin) return jsonRes({error:"STRICT ADMIN PIN REQUIRED"});
      return jsonRes(placeBulkOrders(body));
    }
    if (action === "markEnRoute") {
       if (!isStaff) return jsonRes({error:"STRICT STAFF PIN REQUIRED"});
       return jsonRes(markEnRoute(body));
     }
     if (action === "markOrderPacked") {
       if (!isStaff) return jsonRes({error:"STRICT STAFF PIN REQUIRED"});
       return jsonRes(markOrderPacked(body));
     }

    // Admin-only write actions
    if (action === "adminCancelOrder") {
      if (!isAdmin) return jsonRes({success:false, error: "STRICT ADMIN PIN REQUIRED"});
      return jsonRes(adminCancelOrder(body));
    }
    if (action === "setKitchenClosed") {
      if (!isAdmin) return jsonRes({success:false, error: "STRICT ADMIN PIN REQUIRED"});
      return jsonRes(setKitchenClosed(body));
    }
    if (action === "markRefunded") {
      if (!isAdmin) return jsonRes({error:"STRICT ADMIN PIN REQUIRED"});
      return jsonRes(markRefunded(body.submissionId, body.forceWallet));
    }
    if (action === "toggleFeeExempt") {
      if (!isAdmin) return jsonRes({error:"STRICT ADMIN PIN REQUIRED"});
      return jsonRes(toggleFeeExempt(body.phone, body.status));
    }
    if (action === "approveWalletRecharge") {
      if (!isAdmin) return jsonRes({error:"STRICT ADMIN PIN REQUIRED"});
      return jsonRes(approveWalletRecharge(body));
    }
    if (action === "markReviewed") {
      if (!isAdmin) return jsonRes({error:"STRICT ADMIN PIN REQUIRED"});
      return jsonRes(markReviewed(body));
    }
    if (action === "deleteBreakfastItem") {
      if (!isAdmin) return jsonRes({error:"STRICT ADMIN PIN REQUIRED"});
      return jsonRes(deleteBreakfastItem(body.id));
    }
    if (action === "saveBreakfastItem") {
      if (!isAdmin) return jsonRes({error:"STRICT ADMIN PIN REQUIRED"});
      return jsonRes(saveBreakfastItem(body));
    }
    if (action === "deleteSabjiItem") {
      if (!isAdmin) return jsonRes({error:"STRICT ADMIN PIN REQUIRED"});
      return jsonRes(deleteSabjiItem(body.id));
    }
    if (action === "seedTestData") {
      if (!isAdmin) return jsonRes({error:"STRICT ADMIN PIN REQUIRED"});
      return jsonRes({success:true, message: seedTestData()});
    }
    if (action === "saveSabjiItem") {
      if (!isAdmin) return jsonRes({error:"STRICT ADMIN PIN REQUIRED"});
      return jsonRes(saveSabjiItem(body));
    }
    if (action === "saveLabels") {
      // Label PDF upload — allow kitchen PIN too, since the matching
      // getLabelOrders endpoint already accepts staff. Without this,
      // kitchen-PIN users could fetch the orders but got "permission
      // required" when actually saving the PDF.
      if (!isStaff) return jsonRes({error:"STRICT STAFF PIN REQUIRED"});
      return jsonRes(saveLabels(body));
    }
    if (action === "setLabelGap") {
      // Single global label-gap value, shared across every kitchen device.
      // Any staff can write (intentional — gap is a printer/paper-size
      // calibration, not a sensitive setting).
      if (!isStaff) return jsonRes({error:"STRICT STAFF PIN REQUIRED"});
      const v = Number(body.gap_mm);
      if (!isFinite(v) || v < 0 || v > 20) {
        return jsonRes({success: false, error: "Invalid gap value (must be 0–20 mm)"});
      }
      SP.setProperty("LABEL_GAP_MM", String(v));
      return jsonRes({success: true, gap_mm: v});
    }
    if (action === "markCustomersPaid") {
      if (!isAdmin) return jsonRes({error:"Invalid PIN"});
      return jsonRes(markCustomersPaid(body));
    }
    if (action === "markOrdersStatus") {
      if (!isAdmin) return jsonRes({error:"Invalid PIN"});
      return jsonRes(markOrdersStatus(body));
    }
    if (action === "markOnAccount") {
      if (!isAdmin) return jsonRes({error:"STRICT ADMIN PIN REQUIRED"});
      return jsonRes(markOnAccount(body.phone, body.cycle, body.status));
    }
    if (action === "verifyAdminPin") return jsonRes({success: isAdmin});
    if (action === "reconcileTransactions") {
      if (!isAdmin) return jsonRes({error:"STRICT ADMIN PIN REQUIRED"});
      return jsonRes(reconcileTransactions(body));
    }
    if (action === "markOrdersPaidBulk") {
      if (!isAdmin) return jsonRes({error:"STRICT ADMIN PIN REQUIRED"});
      return jsonRes(markOrdersPaidBulk(body));
    }
    if (action === "getBillingData") {
      if (!isAdmin) return jsonRes({error:"STRICT ADMIN PIN REQUIRED"});
      return jsonRes(getBillingData(body.cycle, body.filterValue));
    }
    if (action === "markBillingCollected") {
      if (!isAdmin) return jsonRes({error:"STRICT ADMIN PIN REQUIRED"});
      return jsonRes(markBillingCollected(body.submissionIds));
    }
    if (action === "getAttendanceData") {
      if (!isAdmin) return jsonRes({error:"STRICT ADMIN PIN REQUIRED"});
      return jsonRes(getAttendanceData(body.month, body.date));
    }
    if (action === "markAttendance") {
      if (!isAdmin) return jsonRes({error:"STRICT ADMIN PIN REQUIRED"});
      return jsonRes(markAttendance(body.name, body.date, body.status, body.reason));
    }
    if (action === "addIncentive") {
      if (!isAdmin) return jsonRes({error:"STRICT ADMIN PIN REQUIRED"});
      return jsonRes(addIncentive(body.name, body.date, body.amount, body.note));
    }
    if (action === "addDeduction") {
      if (!isAdmin) return jsonRes({error:"STRICT ADMIN PIN REQUIRED"});
      return jsonRes(addDeduction(body.name, body.date, body.amount, body.note));
    }
    if (action === "markSalaryCredited") {
      if (!isAdmin) return jsonRes({error:"STRICT ADMIN PIN REQUIRED"});
      return jsonRes(markSalaryCredited(body.name, body.period, body.amount));
    }
    if (action === "updateStaff") {
      if (!isAdmin) return jsonRes({error:"STRICT ADMIN PIN REQUIRED"});
      return jsonRes(updateStaff(body.name, body.fields));
    }
    if (action === "undoMarkPaid") {
      if (!isAdmin) return jsonRes({error:"STRICT ADMIN PIN REQUIRED"});
      return jsonRes(undoMarkPaid(body.submissionIds));
    }
    if (action === "saveArea") {
      if (!isAdmin) return jsonRes({error:"STRICT ADMIN PIN REQUIRED"});
      return jsonRes(saveArea(body));
    }
    if (action === "deleteArea") {
      if (!isAdmin) return jsonRes({error:"STRICT ADMIN PIN REQUIRED"});
      return jsonRes(deleteArea(body));
    }
    if (action === "markCustomersPaid") {
      if (!isAdmin) return jsonRes({error:"Invalid PIN"});
      return jsonRes(markCustomersPaid(body));
    }
    if (action === "markOrdersStatus") {
      if (!isAdmin) return jsonRes({error:"Invalid PIN"});
      return jsonRes(markOrdersStatus(body));
    }
    if (action === "getReviews") return jsonRes(getReviews());
    if (action === "chat") return jsonRes(handleChat(body));
    if (action === "submitWalletRecharge") return jsonRes(submitWalletRecharge(body));
    if (action === "markRefundRejected") {
      if (!isAdmin) return jsonRes({error:"STRICT ADMIN PIN REQUIRED"});
      return jsonRes(markRefundRejected(body.submissionId));
    }
    if (action === "rejectUPIPayment") {
      if (!isAdmin) return jsonRes({error:"STRICT ADMIN PIN REQUIRED"});
      return jsonRes(rejectUPIPayment(body));
    }
    if (action === "adminCreditWallet") {
      if (!isAdmin) return jsonRes({error:"STRICT ADMIN PIN REQUIRED"});
      return jsonRes(adminCreditWallet(body));
    }
    if (action === "adminResetPin") {
      if (!isAdmin) return jsonRes({error:"STRICT ADMIN PIN REQUIRED"});
      return jsonRes(adminResetPin(body));
    }
    if (action === "rejectWalletRecharge") {
      if (!isAdmin) return jsonRes({error:"STRICT ADMIN PIN REQUIRED"});
      return jsonRes(rejectWalletRecharge(body));
    }
    if (action === "batchProcessApprovals") {
      if (!isAdmin) return jsonRes({error:"STRICT ADMIN PIN REQUIRED"});
      return jsonRes(batchProcessApprovals(body));
    }
    if (action === "saveInventoryEntry") {
      if (!isAdmin) return jsonRes({error:"STRICT ADMIN PIN REQUIRED"});
      return jsonRes(saveInventoryEntry(body));
    }
    if (action === "deleteInventoryEntry") {
      if (!isAdmin) return jsonRes({error:"STRICT ADMIN PIN REQUIRED"});
      return jsonRes(deleteInventoryEntry(body));
    }
    if (action === "saveCustomExpenseCategory") {
      if (!isAdmin) return jsonRes({error:"STRICT ADMIN PIN REQUIRED"});
      return jsonRes(saveCustomExpenseCategory(body));
    }
    if (action === "deleteCustomExpenseCategory") {
      if (!isAdmin) return jsonRes({error:"STRICT ADMIN PIN REQUIRED"});
      return jsonRes(deleteCustomExpenseCategory(body));
    }
    if (action === "saveExpense") {
      if (!isAdmin) return jsonRes({error:"STRICT ADMIN PIN REQUIRED"});
      return jsonRes(saveExpense(body));
    }
    if (action === "deleteExpense") {
      if (!isAdmin) return jsonRes({error:"STRICT ADMIN PIN REQUIRED"});
      return jsonRes(deleteExpense(body));
    }
    if (action === "triggerManualArchive") {
      if (!isAdmin) return jsonRes({error:"STRICT ADMIN PIN REQUIRED"});
      return jsonRes(triggerManualArchive(body));
    }
    if (action === "setupQuarterlyArchiveTrigger") {
      if (!isAdmin) return jsonRes({error:"STRICT ADMIN PIN REQUIRED"});
      try { setupQuarterlyArchiveTrigger(); return jsonRes({success:true}); }
      catch(e) { return jsonRes({success:false, error:String(e)}); }
    }
    if (action === "stopMonthlyArchiveTrigger") {
      if (!isAdmin) return jsonRes({error:"STRICT ADMIN PIN REQUIRED"});
      try { var msg = stopMonthlyArchiveTrigger(); return jsonRes({success:true, message:msg}); }
      catch(e) { return jsonRes({success:false, error:String(e)}); }
    }
    if (action === "setupAutoDeliveredTrigger") {
      if (!isAdmin) return jsonRes({error:"STRICT ADMIN PIN REQUIRED"});
      try { return jsonRes({success:true, message: setupAutoDeliveredTrigger()}); }
      catch(e) { return jsonRes({success:false, error:e.message}); }
    }

    if (action === "setPin") {
      const profile = { phone: body.phone, pin: body.pin };
  _upsertCustomer(getSpreadsheet(), profile, _lsStorefront(body));
      return jsonRes({success:true});
    }

    if (action === "saveMenu") {
      if (!isAdmin) return jsonRes({error:"STRICT ADMIN PIN REQUIRED"});
      return jsonRes(saveMenu(body));
    }

    if (action === "setDefaultCutoffs") {
      if (!isAdmin) return jsonRes({error:"STRICT ADMIN PIN REQUIRED"});
      return jsonRes(setDefaultCutoffs(body));
    }

    if (action === "setDefaultOrderCaps") {
      if (!isAdmin) return jsonRes({error:"STRICT ADMIN PIN REQUIRED"});
      return jsonRes(setDefaultOrderCaps(body));
    }

    if (action === "upsertProfile") {
      // Capture PIN if provided during mid-flow profile upserts
      const profile = { ...body, pin: body.pin || "" };
      // SECURITY: admin-only fields — strip from this unauthenticated route so a
      // phone alone can't self-promote to pay-later On-Account (set via gated markOnAccount).
      delete profile.onAccount; delete profile.billingCycle;
  _upsertCustomer(getSpreadsheet(), profile, _lsStorefront(body));
      return jsonRes({success:true});
    }

    if (action === "submitManualOrder") {
      if (!isAdmin) return jsonRes({error:"STRICT ADMIN PIN REQUIRED"});
      return jsonRes(submitManualOrder(body));
    }

    // Client error logging (timeout / network failures reported by frontend)
    if (action === "logClientError") return jsonRes(logClientError(body));

    // ── HDFC PAYMENT GATEWAY ACTIONS ─────────────────────────
    // All gateway actions are gated by PAYMENT_GATEWAY_ENABLED.
    // The webhook action is the only one that uses its own auth (Basic Auth
    // from HDFC's server), not the customer or admin PIN.

    if (action === "hdfc_createSession") {
      if (!PAYMENT_GATEWAY_ENABLED) return jsonRes({error:"Payment gateway not enabled."});
      return jsonRes(hdfc_createSession(body));
    }
    if (action === "hdfc_savePendingOrder") return jsonRes(hdfc_savePendingOrder(body));
    if (action === "hdfc_getPendingOrder")  return jsonRes(hdfc_getPendingOrder(body));

    // Wallet top-up via HDFC SmartGateway (separate from order payment).
    if (action === "hdfc_createWalletRechargeSession") {
      if (!PAYMENT_GATEWAY_ENABLED) return jsonRes({error:"Payment gateway not enabled."});
      return jsonRes(hdfc_createWalletRechargeSession(body));
    }
    if (action === "hdfc_finalizeWalletRecharge") {
      if (!PAYMENT_GATEWAY_ENABLED) return jsonRes({error:"Payment gateway not enabled."});
      return jsonRes(hdfc_finalizeWalletRecharge(body.order_id));
    }

    // On-Account settlement via HDFC SmartGateway (direct order settlement).
    if (action === "hdfc_createOnAccountSession") {
      if (!PAYMENT_GATEWAY_ENABLED) return jsonRes({error:"Payment gateway not enabled."});
      return jsonRes(hdfc_createOnAccountSession(body));
    }
    if (action === "hdfc_finalizeOnAccountPayment") {
      if (!PAYMENT_GATEWAY_ENABLED) return jsonRes({error:"Payment gateway not enabled."});
      return jsonRes(hdfc_finalizeOnAccountPayment(body.order_id));
    }

    if (action === "hdfc_webhook") {
      // HDFC posts to this URL with Basic Auth — verify credentials first
      if (!PAYMENT_GATEWAY_ENABLED) return jsonRes({error:"Payment gateway not enabled."});
      return jsonRes(hdfc_handleWebhook(body, e));
    }

    // ── HDFC Webhook auto-detect ───────────────────────────────
    // HDFC's server-side webhook POST will NOT contain _action.
    // Detect by presence of event_name (Juspay webhook signature field).
    if (!action && (body.event_name || (body.content && body.content.order))) {
      console.log("HDFC Webhook auto-detected, event:", body.event_name);
      if (!PAYMENT_GATEWAY_ENABLED) return jsonRes({error:"Payment gateway not enabled."});
      return jsonRes(hdfc_handleWebhook(body, e));
    }

    if (action === "hdfc_verifyReturn") {
      // Called by order.html when customer lands back after payment
      if (!PAYMENT_GATEWAY_ENABLED) return jsonRes({error:"Payment gateway not enabled."});
      return jsonRes(hdfc_verifyReturnPayload(body));
    }
    if (action === "hdfc_checkPaymentStatus") {
      // Polling endpoint — order.html calls this every 2s while the customer
      // is paying in the popup. Returns {status, confirmed, amount} so the
      // opener tab can complete the order the moment HDFC confirms CHARGED,
      // even if the popup is still stuck on script.google.com cross-origin.
      if (!PAYMENT_GATEWAY_ENABLED) return jsonRes({error:"Payment gateway not enabled."});
      const oid = String(body.order_id || "").trim();
      if (!oid) return jsonRes({error:"Missing order_id"});
      const sc = hdfc_getOrderStatus(oid);
      return jsonRes({ status: sc.status, confirmed: sc.confirmed, amount: sc.amount || 0 });
    }
    // ─────────────────────────────────────────────────────────

    // ── IntentAmplify (corporate channel) — POST ───────────────
    if (action === "ia_register")    return jsonRes(ia_register(body));
    if (action === "ia_submitOrder") return jsonRes(ia_submitOrder(body));
    if (action === "ia_setMenu")     return jsonRes(ia_setMenu(body));
    if (action === "ia_approve")     return jsonRes(ia_approve(body));
    if (action === "ia_resetPin")    return jsonRes(ia_resetPin(body));
    if (action === "ia_markDelivered")        return jsonRes(ia_markDelivered(body));
    if (action === "ia_batchMarkEnRoute")     return jsonRes(ia_batchMarkEnRoute(body));
    if (action === "ia_hdfc_createSession")   return jsonRes(ia_hdfc_createSession(body));
    if (action === "ia_hdfc_verifyAndSubmit") return jsonRes(ia_hdfc_verifyAndSubmit(body));
    if (action === "ia_cancelOrder")          return jsonRes(ia_customerCancelOrder(body));

    // Admin "place from favorite" / bulk-favorite placement (vault_admin.html)
    // posts _action:"processOrder" with the same {profile, orders:[{date,meals}]}
    // payload as a regular submission. Route it (and the explicit "submitOrder"
    // name) to submitOrder. Same orders[]-present guard as the no-action path so
    // a malformed payload can't produce the old phantom "success".
    if ((action === "processOrder" || action === "submitOrder")
        && Array.isArray(body.orders) && body.orders.length) {
      return jsonRes(submitOrder(body));
    }

    // Bulk weekly / 15-day / month order (bulk-orders branch — not yet on LIVE).
    if (action === "submitBulkOrder") return jsonRes(submitBulkOrder(body));
    if (action === "submitBulkDirect") return jsonRes(submitBulkDirect(body)); // On-Account / full-Wallet bulk — no gateway
    if (action === "hdfc_finalizeBulkOrder") return jsonRes(hdfc_finalizeBulkOrder(body)); // instant post-payment write from the frozen stash

    // Regular order submission — the ONLY POST with no _action. Anything else
    // (unknown/typo'd actions, malformed debug payloads) must NOT fall through
    // to submitOrder: that used to return {success:true, submissionId:""} for a
    // body with no orders — a phantom "success" with nothing written.
    if (action === "" && Array.isArray(body.orders) && body.orders.length) {
      return jsonRes(submitOrder(body));
    }
    return jsonRes({ error: "Unknown action" + (action ? ": '" + action + "'" : " (no orders payload)") });
  } catch(err) {
    return jsonRes({error: err.message});
  }
}

function jsonRes(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
// ── GOOGLE ANALYTICS 4 INTEGRATION ──────────────────────────
const GA4_HEADERS = ["Date", "Source", "Device", "Active_Users", "Sessions", "Page_Views", "Engagement_Rate", "Avg_Session_Duration", "Event_Count"];

/**
 * Fetches the last 30 days of traffic metrics from GA4 and stores them in the sheet.
 * Includes breakdown by Source and Device.
 * Requires "Google Analytics Data API" service to be enabled in Apps Script.
 */
function syncGA4Data() {
  const propertyId = GA4_PROPERTY_ID;
  if (!propertyId) return "Error: GA4_PROPERTY_ID not set.";

  const request = {
    dimensions: [
      { name: 'date' },
      { name: 'sessionSource' },
      { name: 'deviceCategory' }
    ],
    metrics: [
      { name: 'activeUsers' },
      { name: 'sessions' },
      { name: 'screenPageViews' },
      { name: 'engagementRate' },
      { name: 'averageSessionDuration' },
      { name: 'eventCount' }
    ],
    dateRanges: [{ startDate: '30daysAgo', endDate: 'today' }]
  };

  try {
    const response = AnalyticsData.Properties.runReport(request, 'properties/' + propertyId);
    if (!response.rows || response.rows.length === 0) return "No data found in GA4.";

    const ss = getSpreadsheet();
    const ws = getOrCreateTab(ss, TAB_GA4_METRICS, GA4_HEADERS);
    
    // Snapshot approach: overwrite the tab with the latest window
    if (ws.getLastRow() > 1) {
      ws.getRange(2, 1, ws.getLastRow() - 1, GA4_HEADERS.length).clearContent();
    }

    const rows = response.rows.map(row => {
      // Format YYYYMMDD to YYYY-MM-DD
      const rawDate = row.dimensionValues[0].value;
      const formattedDate = rawDate.substring(0,4) + "-" + rawDate.substring(4,6) + "-" + rawDate.substring(6,8);
      
      return [
        formattedDate,
        row.dimensionValues[1].value, // Source
        row.dimensionValues[2].value, // Device
        ...row.metricValues.map(mv => mv.value)
      ];
    });
    
    // Sort by date descending, then source
    rows.sort((a, b) => {
      if (a[0] !== b[0]) return b[0].localeCompare(a[0]);
      return a[1].localeCompare(b[1]);
    });

    if (rows.length > 0) {
      ws.getRange(2, 1, rows.length, GA4_HEADERS.length).setValues(rows);
    }
    
    return "Successfully synced " + rows.length + " data points (Date/Source/Device combinations).";
  } catch (e) {
    console.error("GA4 Sync Error:", e);
    return "Error: " + e.message;
  }
}

/**
 * Setup a daily trigger to sync GA4 data automatically at 1 AM.
 */
function setupAnalyticsTrigger() {
  // Remove existing triggers for this function to avoid duplicates
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(t => {
    if (t.getHandlerFunction() === 'syncGA4Data') ScriptApp.deleteTrigger(t);
  });
  
  // Create new daily trigger
  ScriptApp.newTrigger('syncGA4Data')
    .timeBased()
    .everyDays(1)
    .atHour(1)
    .create();
    
  return "Daily GA4 sync trigger set for 1:00 AM.";
}

// ── HELPERS ──────────────────────────────────────────────────
function getSpreadsheet() {
  return SpreadsheetApp.openById(SHEET_ID);
}

function getOrCreateTab(ss, name, headers) {
  let ws = ss.getSheetByName(name);
  if (!ws) {
    ws = ss.insertSheet(name);
  }
  
  if (headers && headers.length > 0) {
    const lastCol = ws.getLastColumn();
    const currentHeaders = lastCol > 0 ? ws.getRange(1, 1, 1, lastCol).getValues()[0].map(h => String(h||"").trim()) : [];
    
    // Force header row synchronization by explicitly setting range if any mismatch
    headers.forEach((h, i) => {
      if (currentHeaders[i] !== h) {
        ws.getRange(1, i + 1).setValue(h)
          .setFontWeight("bold")
          .setBackground("#c0392b")
          .setFontColor("white");
        if (i === 0) ws.setFrozenRows(1);
        // Force certain columns to stay as Plain Text to preserve leading zeros
        if (h === "Phone" || h === "PIN") {
          ws.getRange(1, i + 1, ws.getMaxRows(), 1).setNumberFormat("@");
        }
      }
    });

    // COLUMN DELETION REMOVED (2026-06-13). The header sync above (label-only,
    // never moves data) is kept — the app reads rows BY HEADER NAME, so a
    // drifted header row must be repaired or e.g. PIN reads blank and existing
    // customers are wrongly asked to set a new PIN. But the old code ALSO
    // deleted any columns beyond headers.length — that was the data-loss
    // footgun: when SK_Orders briefly had an extra column it physically erased
    // real order data (Order_Date / Submitted_At) during archive. Extra columns
    // are now left alone, never deleted.
  }
  return ws;
}

// ── CACHE HELPER ────────────────────────────────────────────
// Cross-execution cache using Apps Script CacheService.
// Falls back gracefully if value is too large (>100 KB) to store.
function _cachedData(key, ttlSeconds, fetchFn) {
  const cache = CacheService.getScriptCache();
  const hit = cache.get(key);
  if (hit !== null) {
    try { return JSON.parse(hit); } catch(e) {}
  }
  const data = fetchFn();
  try { cache.put(key, JSON.stringify(data), ttlSeconds); } catch(e) {
    // Value may exceed 100 KB limit — silent fallback to uncached
  }
  return data;
}

function _invalidateCache() {
  const keys = Array.from(arguments);
  if (!keys.length) return;
  try { CacheService.getScriptCache().removeAll(keys); } catch(e) {}
}

function _getVipPhonesCached() {
  return _cachedData("vip_phones_v1", 300, function() {
    const ss = getSpreadsheet();
    const ws = getOrCreateTab(ss, TAB_CUSTOMERS, []);
    const rows = getAllRows(ws);
    const vips = {};
    rows.forEach(function(r) {
      if (String(r.Fee_Exempt || "").toLowerCase() === "yes" || r.Fee_Exempt === true) {
        if (r.Phone) vips[String(r.Phone).trim()] = true;
      }
    });
    return vips;
  });
}

// Locations that may keep ordering DELIVERY even when the per-meal cap is full
// (owner-approved 2026-07-13). They still COUNT toward the cap (like free areas) —
// they're just never BLOCKED by it:
//   • WeWork (any spelling — "WeWork", "We Work", "Wework Magarpatta"…)
//   • Cybercity Magarpatta Towers 1–12 — customers come down to collect at the
//     gate, so a full delivery roster isn't slowed. AMANORA towers are EXCLUDED
//     (their numbering is T18–T100, and Pentagon "T4" never uses the word "tower",
//     so `tower 1..12 AND not amanora` is unambiguous in our data).
// Mirrored in order.html `_capExemptLocation` — keep the two in sync.
function _isCapExemptLocation(society, area) {
  const s = _normSocietyBase(String(society || "") + " " + String(area || ""));
  if (!s) return false;
  if (s.indexOf("amanora") !== -1) return false;           // never Amanora towers
  if (s.indexOf("wework") !== -1) return true;             // "we work" normalizes to "wework"
  if (s.indexOf("cybercity") !== -1) return true;          // Cybercity = towers 1–12 only
  const m = s.match(/tower0*([0-9]{1,3})/);                // "Magarpatta tower 11", "Tower 12"
  return !!(m && Number(m[1]) >= 1 && Number(m[1]) <= 12);
}

// Effective per-meal delivery caps for one date: the admin-editable site-wide
// defaults from SK_Default_Caps (_getDefaultOrderCaps), overridden per meal by
// any positive per-date Order_Cap_JSON value the admin set.
// (Blank/0/invalid per-date values fall back to the default — matching the admin
// panel, which deletes the key when the input is blank or 0.)
function _effectiveOrderCaps(perDateCaps) {
  const defaults = _getDefaultOrderCaps();
  const out = {};
  ["Breakfast", "Lunch", "Dinner"].forEach(function (m) {
    const v = Number(perDateCaps && perDateCaps[m]);
    out[m] = (!isNaN(v) && v > 0) ? v : (defaults[m] || 0);
  });
  return out;
}

function getISTDate() {
  const now = new Date();
  // Cross-environment IST Date object
  return new Date(now.getTime() + (now.getTimezoneOffset() + 330) * 60000);
}

function getISTTimestamp() {
  return Utilities.formatDate(getISTDate(), "Asia/Kolkata", "yyyy-MM-dd HH:mm:ss");
}

function generateSubmissionID(prefix) {
  const ist = getISTDate();
  const dateStr = Utilities.formatDate(ist, "Asia/Kolkata", "yyyyMMdd");
  const rand = Math.floor(Math.random() * 9000) + 1000;
  // prefix "LS" → Liviano-Serio storefront rows ("LS-YYYYMMDD-XXXX"); default SK.
  return `${prefix ? String(prefix).toUpperCase() : "SK"}-${dateStr}-${rand}`;
}

function headerIndex(ws) {
  // Returns {colName: 1-based-index} for the given sheet
  const headers = ws.getRange(1, 1, 1, ws.getLastColumn()).getValues()[0];
  const idx = {};
  headers.forEach((h, i) => { idx[h] = i + 1; });
  return idx;
}

function getAllRows(ws) {
  const last = ws.getLastRow();
  if (last < 2) return [];
  const data = ws.getRange(2, 1, last - 1, ws.getLastColumn()).getValues();
  const headers = ws.getRange(1, 1, 1, ws.getLastColumn()).getValues()[0];
  return data.map((row, ri) => {
    const obj = {_row: ri + 2};
    headers.forEach((h, i) => { obj[h] = row[i]; });
    return obj;
  });
}

function _get(obj, key) {
  if (!obj || !key) return undefined;
  if (obj[key] !== undefined) return obj[key];
  const nk = key.replace(/_/g, ' ').toLowerCase();
  for (let k in obj) {
    if (k.replace(/_/g, ' ').toLowerCase() === nk) return obj[k];
  }
  return undefined;
}

function _cleanNum(val) {
  if (typeof val === "number") return val;
  const s = String(val || "").replace(/[^\d.-]/g, '');
  const n = Number(s);
  return isNaN(n) ? 0 : n;
}

function getRecentRows(ws, maxRows) {
  const last = ws.getLastRow();
  if (last < 2) return [];
  const startRow = Math.max(2, last - maxRows + 1);
  const data = ws.getRange(startRow, 1, last - startRow + 1, ws.getLastColumn()).getValues();
  const headers = ws.getRange(1, 1, 1, ws.getLastColumn()).getValues()[0];
  return data.map((row, ri) => {
    const obj = {_row: ri + startRow};
    headers.forEach((h, i) => { obj[h] = row[i]; });
    return obj;
  });
}

// ── SCHEMA INIT ──────────────────────────────────────────────
function initSchema() {
  const ss = getSpreadsheet();
  getOrCreateTab(ss, TAB_ORDERS, ORDERS_HEADERS);
  getOrCreateTab(ss, TAB_CUSTOMERS, CUSTOMERS_HEADERS);
  getOrCreateTab(ss, TAB_MENU, [
    "Date","Breakfast_JSON","Lunch_Dry","Lunch_Curry","Dinner_Dry","Dinner_Curry",
    "Cutoff_Breakfast","Cutoff_Lunch","Cutoff_Dinner",
    "OOS_JSON","Orders_Closed","Stock_JSON","Kitchen_Closed","Order_Cap_JSON","Cap_Alt_JSON"
  ]);
  getOrCreateTab(ss, TAB_BF_MASTER, ["ID","Name","Price","Active"]);
  getOrCreateTab(ss, TAB_SABJI,     ["ID","Name","Type","Active"]);
  getOrCreateTab(ss, TAB_WALLET, WALLET_HEADERS);
  return {success: true, message: "Schema initialised"};
}

/**
 * Normalizes phone numbers for reliable comparison across Google Sheets.
 * Handles scientific notation (e.g., 9.87E+9) and trailing decimals (.0).
 */
// Returns true if the order should be excluded from kitchen/prep counts.
// "Cancelled (Verify UPI)" = soft-cancel pending admin verification —
// the customer already requested cancellation, do NOT include in kitchen prep.
function _isOrderCancelled(paymentStatus) {
  const s = String(paymentStatus || "").toLowerCase();
  return s === "cancelled" || s.startsWith("cancelled");
}

// ── STOCK LIMIT HELPERS ─────────────────────────────────────
// Canonical item key: strip weight/measure display suffixes like "[200g]",
// "[100ml]", "(2 pcs)". submitOrder writes Items_JSON with STRIPPED names
// (via its stripDisplaySuffix), while stock limits are keyed by the FULL
// display/master name ("Dry Sabji Mini [100ml]", "Sabudana Khichdi [200g]").
// Without stripping on BOTH sides the count lookup never matched → every item
// showed "0 ordered", units_remaining never decremented, auto-sold-out never
// fired, and the submit-time stock block never saw cumulative usage.
function _stripItemSuffix(name) {
  return String(name)
    .replace(/\s*\[.*?\]\s*/g, '')
    .replace(/\s*\(.*?\)\s*/g, '')
    .trim();
}

// Map admin-stock colKey to the canonical name used in Items_JSON.
// Breakfast Curd is stored as "Breakfast Curd" (new rows) — old rows stored it
// as plain "Curd". countOrderedUnits handles both for backward compat.
function itemsJsonKey(colKey) {
  return colKey === "B_CURD" ? "Breakfast Curd" : _stripItemSuffix(colKey);
}

// Count ordered units per meal/item for a given date, excluding cancelled orders.
// Keys are CANONICAL (suffix-stripped) so lookups via itemsJsonKey always join.
function countOrderedUnits(ordersRows, dateStr) {
  const counts = { Breakfast: {}, Lunch: {}, Dinner: {} };
  ordersRows.forEach(row => {
    if (_isOrderCancelled(row.Payment_Status)) return;
    const d = row.Order_Date instanceof Date
      ? Utilities.formatDate(row.Order_Date, "Asia/Kolkata", "yyyy-MM-dd")
      : String(row.Order_Date || "").trim();
    if (d !== dateStr) return;
    const meal = String(row.Meal_Type || "");
    if (!counts[meal]) return;
    let items = {};
    try { items = JSON.parse(row.Items_JSON || "{}"); } catch(e) {}
    Object.entries(items).forEach(([name, qty]) => {
      // Backward compat: old Breakfast rows stored Curd as "Curd". Normalize to
      // "Breakfast Curd" so aggregates match the new canonical key.
      let k = _stripItemSuffix(name);
      if (meal === "Breakfast" && k === "Curd") k = "Breakfast Curd";
      counts[meal][k] = (counts[meal][k] || 0) + Number(qty || 0);
    });
  });
  return counts;
}

// ── SABJI "COMBO" STOCK LIMITS (2026-07-08) ──────────────────────────────────
// A sabji type's Mini + Full sizes share ONE weighted pool instead of two
// separate limits — e.g. limit 25 means
//   miniCount*0.6 + fullCount*1.4  <=  25
// and the MOMENT that's crossed, BOTH sizes close together (a customer can't
// keep ordering Mini once the combined "batch" is used up, even if Mini's own
// raw count looks fine). Stored as a virtual entry inside the SAME Stock_JSON
// blob (no schema change) — admin sets ONE number per sabji type per meal via
// the special colKeys below, alongside (or instead of) any individual Mini/Full
// limits. Only Lunch/Dinner carry sabjis.
const SABJI_COMBO_WEIGHTS = { Mini: 0.6, Full: 1.4 };
const SABJI_COMBO_GROUPS = {
  "__COMBO_DRY__":   { Mini: "Dry Sabji Mini [100ml]",   Full: "Dry Sabji Full [250ml]",   label: "Dry Sabji" },
  "__COMBO_CURRY__": { Mini: "Curry Sabji Mini [100ml]", Full: "Curry Sabji Full [250ml]", label: "Curry Sabji" }
};

// Computes the current weighted-usage status for one meal's combo groups.
// Returns { Dry: {...}|null, Curry: {...}|null } — null when no combo limit is
// set for that group/meal (pure backward compat: individual per-item limits,
// if any, are untouched). orderedCounts must be countOrderedUnits()'s per-meal
// map (canonical/suffix-stripped keys).
function _sabjiComboStatus(stockLimits, orderedCounts, meal) {
  const mealLimits = (stockLimits && stockLimits[meal]) || {};
  const mealCounts = (orderedCounts && orderedCounts[meal]) || {};
  const out = {};
  Object.keys(SABJI_COMBO_GROUPS).forEach(function (comboKey) {
    const grp = SABJI_COMBO_GROUPS[comboKey];
    const outKey = grp.label.split(" ")[0]; // "Dry" | "Curry"
    const limit = Number(mealLimits[comboKey]);
    if (!limit || limit <= 0) { out[outKey] = null; return; }
    const miniUsed = mealCounts[_stripItemSuffix(grp.Mini)] || 0;
    const fullUsed = mealCounts[_stripItemSuffix(grp.Full)] || 0;
    const weightedUsed = miniUsed * SABJI_COMBO_WEIGHTS.Mini + fullUsed * SABJI_COMBO_WEIGHTS.Full;
    const budget = Math.max(0, limit - weightedUsed);
    out[outKey] = {
      limit: limit,
      miniUsed: miniUsed, fullUsed: fullUsed,
      weightedUsed: Math.round(weightedUsed * 100) / 100,
      remainingBudget: Math.round(budget * 100) / 100,
      // How many MORE of just this size could still be added, standalone —
      // an "OR" cap: up to this many Mini OR up to the Full figure, or a mix.
      miniRemaining: Math.floor(budget / SABJI_COMBO_WEIGHTS.Mini),
      fullRemaining: Math.floor(budget / SABJI_COMBO_WEIGHTS.Full)
    };
  });
  return out;
}

// Layers combo-derived caps onto an already-computed per-item unitsRemaining
// map for Lunch+Dinner, MUTATING it in place. Takes the MINIMUM with any
// individual per-item limit already present, so the two systems combine
// safely — an admin who (unusually) sets both an individual Mini limit AND a
// combo limit gets whichever is more restrictive, never a regression.
function _applySabjiComboLimits(stockLimits, orderedCounts, unitsRemaining) {
  ["Lunch", "Dinner"].forEach(function (meal) {
    const status = _sabjiComboStatus(stockLimits, orderedCounts, meal);
    Object.keys(SABJI_COMBO_GROUPS).forEach(function (comboKey) {
      const grp = SABJI_COMBO_GROUPS[comboKey];
      const outKey = grp.label.split(" ")[0];
      const st = status[outKey];
      if (!st) return; // no combo limit set for this group/meal
      if (!unitsRemaining[meal]) unitsRemaining[meal] = {};
      const curMini = unitsRemaining[meal][grp.Mini];
      const curFull = unitsRemaining[meal][grp.Full];
      unitsRemaining[meal][grp.Mini] = (curMini !== undefined) ? Math.min(curMini, st.miniRemaining) : st.miniRemaining;
      unitsRemaining[meal][grp.Full] = (curFull !== undefined) ? Math.min(curFull, st.fullRemaining) : st.fullRemaining;
    });
  });
}

function _normalizePhone(phone) {
  let p = String(phone || "").trim();
  if (!p) return "";
  // Scientific notation (Sheets quirk: 9.87654321e+9)
  if (p.toUpperCase().includes("E+") && !isNaN(Number(p))) {
    p = String(Math.round(Number(p)));
  }
  // Trailing decimal from Sheets (9876543210.0)
  if (p.includes(".")) p = p.split(".")[0];
  // Strip everything that isn't a digit (removes +, spaces, dashes, parens, country-code prefixes)
  p = p.replace(/\D/g, "");
  // 12-digit with 91 country code → 10-digit
  if (p.length === 12 && p.startsWith("91")) p = p.substring(2);
  // 11-digit with leading zero → 10-digit
  if (p.length === 11 && p.startsWith("0")) p = p.substring(1);
  return p;
}

