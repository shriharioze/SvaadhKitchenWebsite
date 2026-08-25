// ============================================================
// 11_Hdfc_Reconciler.gs
// Self-healing reconciliation for HDFC payments that charged
// successfully at the gateway but never wrote a row in SK_Orders
// (e.g. user closed the popup before the post-charge round-trip
// completed). A 5-minute time-based trigger sweeps the pending
// log, confirms each entry against the Status API / Webhook Log,
// and writes the SK_Orders row using the cached cart state.
// ============================================================
// Gated by PAYMENT_GATEWAY_ENABLED — safe to deploy on live.
// Sourced from SvaadhKitchenUAT v14.8.
// ============================================================

function setupReconcileTrigger() {
  // Remove any existing reconcile triggers first
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === "reconcilePendingOrders") ScriptApp.deleteTrigger(t);
  });
  // everyMinutes() only accepts 1, 5, 10, 15, or 30 — so the faster-recovery
  // options are 1 min (chosen) or 5 min; 2/3 are not valid Apps Script intervals.
  // The reconciler early-exits when nothing is pending, so idle 1-min runs are cheap.
  ScriptApp.newTrigger("reconcilePendingOrders")
    .timeBased()
    .everyMinutes(1)
    .create();
  return "Reconcile trigger set — runs every 1 minute.";
}

function reconcilePendingOrders() {
  if (!PAYMENT_GATEWAY_ENABLED) { Logger.log("reconcilePendingOrders: gateway disabled, skipping."); return; }

  // Webhook-independent fallback: settle any gateway refunds still "Processing"
  // by polling the Status API. Runs every 5 min on this same trigger, so a refund
  // reaches "Refunded" even if the HDFC REFUND_SUCCEEDED webhook never arrives.
  try { reconcilePendingRefunds(); } catch (e) { Logger.log("reconcilePendingRefunds error: " + e.message); }

  // Re-verify recently-written order rows every minute (PENDING_ORDER_ROWS backup,
  // 60-min window). GAS can drop an appendRow AFTER the in-execution verification
  // passed (3-Jul ₹104 loss) — previously the re-check only ran when the NEXT customer
  // placed an order, which could be too late. Cheap: exits instantly when the backup
  // store is empty.
  try { _verifyAndAlertMissedOrders(getSpreadsheet()); } catch (e) { Logger.log("missed-order re-verify error: " + e.message); }

  // IntentAmplify orders write to IA_Orders via ia_hdfc_verifyAndSubmit (not
  // submitOrder), so the SK sweep below doesn't cover them. Run the IA sweep on
  // this same 5-min trigger so a paid IA order self-heals even if every webhook
  // failed AND the customer closed the popup.
  try { reconcilePendingIAOrders(); } catch (e) { Logger.log("reconcilePendingIAOrders error: " + e.message); }

  const props   = PropertiesService.getScriptProperties();
  const raw     = props.getProperty("HDFC_PENDING_ORDERS") || "{}";
  var pending;
  try { pending = JSON.parse(raw); } catch (e) { Logger.log("reconcilePendingOrders: malformed JSON, aborting."); return; }

  const orderIds = Object.keys(pending);
  if (!orderIds.length) { Logger.log("reconcilePendingOrders: no pending entries, nothing to do."); return; }

  const now = Date.now();
  // Reachable-but-still-not-charged this long after checkout = abandoned cart. UPI
  // (the only method) charges within seconds, so a non-CHARGED status an hour later
  // means the customer never paid — stop re-polling it for the full 6h TTL.
  const ABANDON_MS = 60 * 60 * 1000;
  const summary = { checked: 0, skippedFresh: 0, skippedAlreadyDone: 0, skippedNotCharged: 0, reconciled: 0, errors: 0, prunedFailed: 0, prunedAbandoned: 0 };

  for (var i = 0; i < orderIds.length; i++) {
    const orderId = orderIds[i];
    const entry   = pending[orderId];
    const ageMs   = now - (entry.ts || 0);

    // Skip very-fresh entries — let the customer's browser finish first
    if (ageMs < 2 * 60 * 1000) { summary.skippedFresh++; continue; }
    summary.checked++;

    try {
      const result = _reconcileSingleEntry(orderId, entry);
      summary[result.outcome] = (summary[result.outcome] || 0) + 1;
      // If reconciled (or already done), remove from pending so we don't keep checking
      if (result.outcome === "reconciled" || result.outcome === "skippedAlreadyDone") {
        delete pending[orderId];
      } else if (result.outcome === "skippedNotCharged") {
        // ── Abandoned / failed cleanup ───────────────────────────────────────
        // Keeps a never-completed checkout from being re-polled every run for the
        // whole TTL (with a 1-min trigger + 6h TTL that's ~360 wasted Status-API
        // calls per abandoned cart). SAFE: we only act on a status HDFC actually
        // returned. A real UPI charge reports CHARGED within seconds; when the
        // Status API is UNREACHABLE the status is FETCH_ERROR/API_ERROR/UNKNOWN,
        // which we KEEP — a genuine charge during an outage is still recovered by
        // the webhook-log fallback and the 6h TTL. We never delete on a transient.
        const st = String(result.status || "").toUpperCase();
        const transient = (st === "FETCH_ERROR" || st === "API_ERROR" || st === "UNKNOWN" || st === "");
        if (HDFC_FAILURE_STATES.indexOf(st) !== -1) {
          delete pending[orderId];              // HDFC says failed/declined — no order is coming
          summary.prunedFailed++;
        } else if (!transient && ageMs > ABANDON_MS) {
          delete pending[orderId];              // reachable + uncharged long after checkout → abandoned
          summary.prunedAbandoned++;
        }
      }
    } catch (e) {
      summary.errors++;
      Logger.log("reconcilePendingOrders: error on " + orderId + " — " + e.message);
    }
  }

  // Persist any deletions
  try { props.setProperty("HDFC_PENDING_ORDERS", JSON.stringify(pending)); } catch(_) {}

  Logger.log("reconcilePendingOrders summary: " + JSON.stringify(summary));
  return summary;
}

function _reconcileSingleEntry(orderId, entry) {
  // Per-order lock so we never race with the customer's own verification
  const lock = LockService.getScriptLock();
  try { lock.waitLock(15 * 1000); } catch (e) {
    return { outcome: "skippedFresh", reason: "lock-contention" };
  }

  try {
    // ── Wallet recharge? Route to recharge finalizer ────────────────────────
    // "SK" = main site, "LS" = Liviano-Serio recharge (credits LS_Wallet via the
    // pending entry's storefront).
    if (/^(SK|LS)\d{6}W/.test(orderId)) {
      const r = hdfc_finalizeWalletRecharge(orderId);
      if (r.success && !r.already_credited) return { outcome: "reconciled", kind: "recharge" };
      if (r.success && r.already_credited)  return { outcome: "skippedAlreadyDone", kind: "recharge" };
      return { outcome: "skippedNotCharged", kind: "recharge", reason: r.error || "not confirmed" };
    }

    // ── Regular / split order: check SK_Orders dedup first ───────────────────
    // SKIP this for bulk: submitBulkOrder is idempotent per (date,meal) and SELF-COMPLETES
    // a partially-written batch, so a bulk entry must reach it even when SOME rows already
    // exist (a blanket "any row exists → done" would strand a partial month batch forever).
    if (!entry.bulk) {
      const ss     = getSpreadsheet();
      // Gateway_Order_ID dedup must scan BOTH storefront tabs.
      let _already = false;
      [TAB_ORDERS, TAB_LS_ORDERS].forEach(function (_tabName) {
        if (_already) return;
        try {
          const ws     = getOrCreateTab(ss, _tabName, ORDERS_HEADERS);
          const data   = ws.getDataRange().getValues();
          const headers= data[0] || [];
          const gCol   = headers.indexOf("Gateway_Order_ID");
          if (gCol !== -1) {
            for (var r = 1; r < data.length; r++) {
              if (String(data[r][gCol] || "").trim() === orderId) {
                _already = true;
                break;
              }
            }
          }
        } catch (eTab) {}
      });
      // Preserve the original early-return shape (row number unknown across tabs).
      if (_already) return { outcome: "skippedAlreadyDone" };
    }

    // ── Ask HDFC: is this actually CHARGED? ─────────────────────────────────
    // Primary: Status API call. Fallback: SK_Webhook_Log (HDFC's own
    // server-to-server ORDER_SUCCEEDED event, equally authoritative).
    // The fallback fires when the Status API can't be reached due to
    // urlfetch quota exhaustion or transient errors — without it, a
    // quota-exhausted day would block ALL stuck-order recovery until
    // midnight PST.
    var statusCheck;
    try { statusCheck = hdfc_getOrderStatus(orderId); }
    catch (e) { statusCheck = { confirmed: false, status: "FETCH_ERROR", amount: 0 }; }

    if (!statusCheck.confirmed) {
      const transient = (statusCheck.status === "FETCH_ERROR" ||
                         statusCheck.status === "API_ERROR" ||
                         statusCheck.status === "UNKNOWN" ||
                         statusCheck.status === "NEW");
      if (transient) {
        // Pass the server-computed stash amount so the webhook-log fallback can trust
        // HDFC's signed event by amount-match when the Status API is genuinely down.
        const webhookProof = _checkWebhookLogForCharge(orderId, entry && entry.amount);
        if (webhookProof) {
          Logger.log("reconcile: " + orderId + " — Status API unavailable (" + statusCheck.status + "), but ORDER_SUCCEEDED webhook found in SK_Webhook_Log. Trusting webhook.");
          statusCheck = { confirmed: true, status: "CHARGED", amount: webhookProof.amount };
        }
      }
    }
    if (!statusCheck.confirmed) {
      return { outcome: "skippedNotCharged", status: statusCheck.status };
    }

    // ── Bulk batch: write via submitBulkOrder from the bulk stash ───────────
    // (The Gateway_Order_ID dedup above already short-circuits if rows exist;
    // submitBulkOrder is also idempotent on gateway_order_id as a backstop.)
    if (entry.bulk) {
      const _bulkIsSplit = String(entry.payment_choice || "") === "Split";
      const bulkResult = submitBulkOrder({
        plan:             entry.bulk.plan,
        phone:            entry.phone,
        profile:          entry.profile,
        // Storefront passthrough — LS bulk batches write to LS_Orders with the
        // same free-delivery rule the charge was computed under.
        storefront:       String(entry.storefront || "").trim().toUpperCase() === "LS" ? "LS" : "",
        lunch:            entry.bulk.lunch,
        dinner:           entry.bulk.dinner,
        lunchDates:       entry.bulk.lunchDates,   // frozen at checkout (matches the charge)
        dinnerDates:      entry.bulk.dinnerDates,
        payment_method:   _bulkIsSplit ? "Bulk (Split HDFC)" : "Bulk (Gateway)",
        payment_status:   "Paid",
        wallet_applied:   _bulkIsSplit ? Number(entry.wallet_applied || 0) : 0,
        gateway_order_id: orderId,   // shared id on every batch row (dedup + refunds)
        batch_id:         orderId    // one gateway charge == one batch
      });
      if (bulkResult && bulkResult.success) {
        Logger.log("reconcile: BULK order " + orderId + " written. result=" + JSON.stringify(bulkResult));
        return { outcome: "reconciled", subResult: bulkResult };
      }
      return { outcome: "errors", reason: "submitBulkOrder did not succeed: " + JSON.stringify(bulkResult) };
    }

    // ── Synthesize the submitOrder body from the pending entry ──────────────
    const body = _buildSubmitBodyFromPending(orderId, entry, statusCheck);
    if (!body || !body.orders || !body.orders.length) {
      return { outcome: "errors", reason: "empty orders in pending entry" };
    }

    // ── Submit ──────────────────────────────────────────────────────────────
    const subResult = submitOrder(body);
    if (subResult && (subResult.success || subResult.submission_id || subResult.submissionIds)) {
      Logger.log("reconcile: order " + orderId + " written to sheet. result=" + JSON.stringify(subResult));
      return { outcome: "reconciled", subResult: subResult };
    }
    return { outcome: "errors", reason: "submitOrder did not succeed: " + JSON.stringify(subResult) };
  } finally {
    try { lock.releaseLock(); } catch(_) {}
  }
}

/**
 * Write ONE paid gateway order from the pending stash, on demand.
 *
 * Called by the webhook (hdfc_processWebhookLog) the moment an ORDER_SUCCEEDED event
 * arrives for an order that has no row yet — so a paid order is recorded immediately,
 * independent of the customer's browser AND of the 5-min reconciler trigger. Reuses
 * the exact same proven path as the sweep (_reconcileSingleEntry: per-order lock,
 * Gateway_Order_ID dedup, CHARGED re-confirmation), so it's idempotent and safe to
 * race against the sweep or the browser. On success it removes the entry from the
 * stash so nothing re-processes it.
 *
 * @param {string} orderId  e.g. "SK260629G9128V8MTK"
 * @returns {{outcome:string, ...}}  same shape as _reconcileSingleEntry
 */
function hdfc_reconcileOrderFromStash(orderId) {
  if (!PAYMENT_GATEWAY_ENABLED) return { outcome: "skippedNotCharged", reason: "gateway disabled" };
  orderId = String(orderId || "").trim();
  if (!orderId) return { outcome: "errors", reason: "no order id" };

  const props = PropertiesService.getScriptProperties();
  var pending;
  try { pending = JSON.parse(props.getProperty("HDFC_PENDING_ORDERS") || "{}"); }
  catch (e) { return { outcome: "errors", reason: "malformed pending JSON" }; }

  const entry = pending[orderId];
  if (!entry) {
    // No stash entry — either already reconciled (row exists) or the stash expired.
    // _reconcileSingleEntry can't synthesise a body without items, so report and let
    // the caller's hdfc_markOrderPaid result stand.
    return { outcome: "skippedNotCharged", reason: "no stash entry (expired or already written)" };
  }

  const result = _reconcileSingleEntry(orderId, entry);

  // Drop the entry once it's written (or confirmed already-written) so neither this
  // path nor the 5-min sweep keeps re-checking it.
  if (result && (result.outcome === "reconciled" || result.outcome === "skippedAlreadyDone")) {
    try { delete pending[orderId]; props.setProperty("HDFC_PENDING_ORDERS", JSON.stringify(pending)); } catch (_) {}
  }
  Logger.log("hdfc_reconcileOrderFromStash(" + orderId + "): " + JSON.stringify(result));
  return result;
}

/**
 * Transform the pending-entry shape (S.orders from the frontend) into
 * the body shape that submitOrder() expects.
 */
function _buildSubmitBodyFromPending(orderId, entry, statusCheck) {
  const profile = entry.profile || {};
  const ordersByDate = entry.orders || {};
  const selectedDates = entry.selectedDates || Object.keys(ordersByDate);

  const orders = [];
  selectedDates.forEach(function(date) {
    const dayOrders = ordersByDate[date];
    if (!dayOrders) return;
    const meals = [];
    ["Breakfast", "Lunch", "Dinner"].forEach(function(meal) {
      const m = dayOrders[meal];
      if (!m || (Number(m.subtotal) || 0) <= 0) return;
      const itemsArr = Object.keys(m.items || {})
        .filter(function(k) { return Number(m.items[k]) > 0; })
        .map(function(k) { return { colKey: k, qty: Number(m.items[k]) }; });
      if (!itemsArr.length) return;

      const area    = String(m.area || profile.area || "").trim();
      const isPickup = area.toLowerCase().indexOf("pickup") !== -1;

      const buildAddr = function() {
        if (isPickup) return _lsPickupLabel(String(entry.storefront || "").trim().toUpperCase() === "LS" ? "LS" : "");
        const parts = [];
        if (m.wing)    parts.push("Wing " + m.wing);
        if (m.flat)    parts.push("Flat " + m.flat);
        if (m.floor)   parts.push(m.floor + " Floor");
        if (m.society) parts.push(m.society);
        if (area)      parts.push(area);
        return parts.join(", ");
      };

      meals.push({
        type:           meal,
        items:          itemsArr,
        notesKitchen:   m.notesKitchen  || m.notes || "",
        notesDelivery:  m.notesDelivery || "",
        subtotal:       Number(m.subtotal) || 0,
        address:        buildAddr(),
        area:           isPickup ? "Self Pickup" : area,
        wing:           isPickup ? "" : (m.wing || ""),
        flat:           isPickup ? "" : (m.flat || ""),
        floor:          isPickup ? "" : (m.floor || ""),
        society:        isPickup ? "" : (m.society || ""),
        delivery_point: m.delivery_point || "",
        maps:           isPickup ? "" : (m.maps || ""),
        landmark:       isPickup ? "" : (m.landmark || "")
      });
    });
    if (meals.length) orders.push({ date: date, meals: meals });
  });

  // Match the structure hdfc_submitVerifiedOrder builds on the frontend
  const isSplit       = String(entry.payment_choice || "") === "Split";
  const walletApplied = isSplit ? Number(entry.wallet_applied || 0) : 0;

  return {
    profile: {
      name:               profile.name    || "Customer",
      phone:              entry.phone     || profile.phone || "",
      address:            (function() {
        const parts = [];
        if (profile.wing)    parts.push("Wing " + profile.wing);
        if (profile.flat)    parts.push("Flat " + profile.flat);
        if (profile.floor)   parts.push(profile.floor + " Floor");
        if (profile.society) parts.push(profile.society);
        if (profile.area)    parts.push(profile.area);
        return parts.join(", ");
      })(),
      wing:               profile.wing    || "",
      flat:               profile.flat    || "",
      floor:              profile.floor   || "",
      society:            profile.society || "",
      area:               profile.area    || "",
      maps:               profile.maps    || "",
      landmark:           profile.landmark|| "",
      meal_addresses:     JSON.stringify(entry.mealAddrs || {}),
      payment_preference: profile.payment_preference || "Daily Payment",
      isFirstTime:        !!entry.isFirstTime
    },
    orders:           orders,
    // Storefront passthrough — an LS checkout's self-healed rows must land in
    // LS_Orders exactly as the live finalize path would have written them.
    storefront:       String(entry.storefront || "").trim().toUpperCase() === "LS" ? "LS" : "",
    payment_method:   isSplit ? "Split (HDFC)" : "Gateway (HDFC)",
    payment_status:   "Paid",
    wallet_credit:    walletApplied,
    gateway_order_id: orderId,
    gateway_status:   statusCheck.status || "CHARGED",
    gateway_paid:     true,
    settle_all:       false,
    // Tag the source so logs make it clear this row came from the reconciler
    placed_via:       "reconciler"
  };
}

/**
 * IntentAmplify equivalent of reconcilePendingOrders.
 *
 * IA orders are written to IA_Orders by ia_hdfc_verifyAndSubmit (not submitOrder),
 * so the main SK sweep doesn't cover them. ia_hdfc_createSession stashes every IA
 * session into the IA_PENDING_ORDERS Script Property (order_id → {ts, phone, name,
 * orders, expected_amount, …}). This sweeps that store: for any session older than
 * 2 min, it replays ia_hdfc_verifyAndSubmit, which independently confirms CHARGED
 * with HDFC (Status API + webhook-log fallback), enforces the anti-tamper amount
 * check, and writes the rows — idempotently (skips if a webhook/poll already wrote
 * them). Net effect: a paid IA order self-heals within ~5 min even if EVERY webhook
 * failed and the customer closed the popup immediately after paying.
 *
 * Entries are dropped once reconciled, on amount-tamper (surfaced in the log, never
 * retried), or after 30 min (abandoned/unpaid) to keep the property bounded. The
 * webhook processor remains a parallel safety net for logged-but-expired sessions.
 * Called every 5 min from reconcilePendingOrders(). Never throws to the caller.
 */
function reconcilePendingIAOrders() {
  if (!PAYMENT_GATEWAY_ENABLED) return;
  if (typeof ia_hdfc_verifyAndSubmit !== "function") return;
  // Primary (v21.1+): flip sheet-durable "Pending Payment" rows once HDFC confirms.
  try { _reconcileIAPendingPaymentRows(); } catch (e) { Logger.log("_reconcileIAPendingPaymentRows error: " + e.message); }
  // Transitional: drain any pre-refactor IA_PENDING_ORDERS entries (no sheet row yet).
  _reconcileIALegacyPendingProp();
}

/**
 * Sheet-scan reconciler (durable model): find gateway "Pending Payment" rows in
 * IA_Orders and, for any order older than 2 min, confirm with HDFC and flip it to
 * Paid (via ia_hdfc_verifyAndSubmit). Rows still unpaid after 45 min with no charge
 * are marked "Payment Failed" so they drop out of the customer + prep views. Nothing
 * can be lost here — the order data is already safely written to the sheet.
 */
function _reconcileIAPendingPaymentRows() {
  if (typeof ia_rows !== "function") return;
  const ss = getSpreadsheet();
  const ws = ss.getSheetByName(IA_TAB_ORDERS);
  if (!ws || ws.getLastRow() < 2) return;

  const groups = {}; // orderId -> [rowObjs]
  ia_rows(ws).forEach(function (r) {
    if (String(r.Payment_Status || "").toLowerCase() !== "pending payment") return;
    const oid = String(r.Submission_ID || "").trim();
    if (oid) (groups[oid] = groups[oid] || []).push(r);
  });
  const oids = Object.keys(groups);
  if (!oids.length) return;

  const now = Date.now();
  let checked = 0, flipped = 0, failed = 0;
  oids.forEach(function (oid) {
    const grp   = groups[oid];
    const tsVal = grp[0].Timestamp;
    const ageMs = now - (tsVal ? new Date(tsVal).getTime() : now);
    if (ageMs < 2 * 60 * 1000) return; // let the customer's own browser finish first
    checked++;

    let sc; try { sc = hdfc_getOrderStatus(oid); } catch (e) { sc = { confirmed: false, status: "FETCH_ERROR" }; }
    let confirmed = sc.confirmed;
    if (!confirmed) {
      const st = String(sc.status || "").toUpperCase();
      if ((st === "FETCH_ERROR" || st === "API_ERROR" || st === "UNKNOWN" || st === "NEW")
          && typeof _checkWebhookLogForCharge === "function" && _checkWebhookLogForCharge(oid)) {
        confirmed = true;
      }
    }

    if (confirmed) {
      // Centralised flip (re-checks + anti-tamper + Pending Payment -> Paid). Idempotent.
      try { const res = ia_hdfc_verifyAndSubmit({ order_id: oid }); if (res && res.success) flipped++; }
      catch (e) { Logger.log("_reconcileIAPendingPaymentRows: flip error on " + oid + " — " + e.message); }
    } else if (ageMs > 45 * 60 * 1000) {
      // Abandoned / failed payment — remove from customer + prep views.
      grp.forEach(function (r) { try { ws.getRange(r._row, 10).setValue("Payment Failed"); } catch (_) {} });
      failed++;
    }
  });
  if (checked) Logger.log("_reconcileIAPendingPaymentRows: checked " + checked + ", flipped " + flipped + ", failed " + failed);
}

/**
 * Transitional sweep of the old IA_PENDING_ORDERS Script Property — covers orders
 * created BEFORE the sheet-durable refactor (which have a property entry but no row
 * yet). ia_hdfc_verifyAndSubmit's legacy fallback writes them. Naturally empties out
 * within ~30 min post-deploy, then becomes a no-op.
 */
function _reconcileIALegacyPendingProp() {
  const props = PropertiesService.getScriptProperties();
  let pending;
  try { pending = JSON.parse(props.getProperty("IA_PENDING_ORDERS") || "{}"); }
  catch (e) { Logger.log("reconcilePendingIAOrders: malformed IA_PENDING_ORDERS, aborting."); return; }

  const orderIds = Object.keys(pending);
  if (!orderIds.length) return;

  const now = Date.now();
  const toDelete = []; // orderIds to remove from the store AFTER the verify pass
  const summary = { checked: 0, skippedFresh: 0, reconciled: 0, expired: 0, notCharged: 0, tamper: 0, errors: 0 };

  for (let i = 0; i < orderIds.length; i++) {
    const orderId = orderIds[i];
    const entry   = pending[orderId];
    const ageMs   = now - ((entry && entry.ts) || 0);

    // Abandoned/unpaid (or already handled long ago) — drop without burning a
    // Status-API call. The webhook processor still covers any logged webhook.
    if (ageMs > 30 * 60 * 1000) { toDelete.push(orderId); summary.expired++; continue; }

    // Let the customer's own browser poll finish first.
    if (ageMs < 2 * 60 * 1000) { summary.skippedFresh++; continue; }
    summary.checked++;

    // NB: ia_hdfc_verifyAndSubmit takes the script lock internally for its sheet
    // write, so we must NOT hold a lock across this call (would self-deadlock).
    let res;
    try { res = ia_hdfc_verifyAndSubmit({ order_id: orderId, status: "CHARGED" }); }
    catch (e) { summary.errors++; Logger.log("reconcilePendingIAOrders: error on " + orderId + " — " + e.message); continue; }

    if (res && res.success) {
      // Rows written, or idempotent skip because a webhook/poll beat us. Done.
      summary.reconciled++; toDelete.push(orderId);
    } else if (res && res.expired) {
      // Session no longer in the store (already cleaned elsewhere) — stop tracking.
      summary.expired++; toDelete.push(orderId);
    } else if (res && res.tamper_detected) {
      // Amount mismatch — never auto-retry a tamper; surface it and stop tracking.
      summary.tamper++; toDelete.push(orderId);
      Logger.log("reconcilePendingIAOrders: ⚠️ TAMPER on " + orderId + " — " + JSON.stringify(res));
    } else {
      // Not charged yet / transient — leave in place and retry next sweep.
      summary.notCharged++;
    }
  }

  // Remove processed entries under a SHORT lock, re-reading the property first so
  // we never clobber a fresh session that ia_hdfc_createSession added while we were
  // verifying (the same lost-update race we fixed in createSession). Only the
  // specific processed ids are deleted — concurrent additions are preserved.
  if (toDelete.length) {
    const lock = LockService.getScriptLock();
    try { lock.waitLock(20000); }
    catch (e) { Logger.log("reconcilePendingIAOrders: lock busy, will retry next sweep."); return summary; }
    try {
      let cur;
      try { cur = JSON.parse(props.getProperty("IA_PENDING_ORDERS") || "{}"); } catch (_) { cur = {}; }
      toDelete.forEach(function (id) { delete cur[id]; });
      props.setProperty("IA_PENDING_ORDERS", JSON.stringify(cur));
    } finally { try { lock.releaseLock(); } catch (_) {} }
  }

  if (summary.checked || summary.expired) Logger.log("reconcilePendingIAOrders summary: " + JSON.stringify(summary));
  return summary;
}

/**
 * Webhook-independent settlement of automatic gateway refunds. Sweeps SK_Refunds
 * for rows still "Processing" (mode = gateway) and polls the Status API for that
 * order's refunds[]. Matches the row's refund by its unique_request_id
 * (RF + Submission_ID) and:
 *   - SUCCESS  → flip the row to "Refunded"
 *   - FAILURE  → flip to "Refund Failed" (so it's visible, not silently stuck)
 *   - anything else → leave as Processing and retry next sweep.
 * Called every 5 min from reconcilePendingOrders(). Never throws.
 */
function reconcilePendingRefunds() {
  const ss = getSpreadsheet();
  const refWs = ss.getSheetByName(TAB_REFUNDS);
  if (!refWs || refWs.getLastRow() < 2) return;

  const data = refWs.getDataRange().getValues();
  const H = data[0];
  const cSid    = H.indexOf("Submission_ID");
  const cStatus = H.indexOf("Status");
  const cMode   = H.indexOf("Refund_Mode");
  const cNote   = H.indexOf("Adjustment_Note");
  if (cSid === -1 || cStatus === -1) return;

  // Submission_ID → Gateway_Order_ID map from SK_Orders.
  const gwMap = {};
  const ordWs = ss.getSheetByName(TAB_ORDERS);
  if (ordWs && ordWs.getLastRow() > 1) {
    const od = ordWs.getDataRange().getValues();
    const oH = od[0];
    const oSid = oH.indexOf("Submission_ID");
    const oGw  = oH.indexOf("Gateway_Order_ID");
    if (oSid !== -1 && oGw !== -1) {
      for (var k = 1; k < od.length; k++) {
        var s = String(od[k][oSid] || "").trim();
        if (s) gwMap[s] = String(od[k][oGw] || "").trim();
      }
    }
  }

  var settled = 0, failed = 0;
  for (var i = 1; i < data.length; i++) {
    var status = String(data[i][cStatus] || "").trim().toLowerCase();
    var mode   = cMode === -1 ? "" : String(data[i][cMode] || "").trim().toLowerCase();
    if (status !== "processing" || mode !== "gateway") continue;

    var sid = String(data[i][cSid] || "").trim();
    var gOrderId = gwMap[sid] || "";
    if (!gOrderId) continue;

    var res = hdfc_getOrderRefunds(gOrderId);
    if (!res || !res.success) continue;

    // Match THIS row's refund by the unique_request_id we sent (RF + Submission_ID).
    var reqId = ("RF" + sid).replace(/[^A-Za-z0-9]/g, "").slice(0, 20);
    var mine  = res.refunds.filter(function(r){ return String(r.unique_request_id || "") === reqId; });
    var rf    = mine.length ? mine[mine.length - 1] : null;
    if (!rf) continue;

    var st = String(rf.status || "").toUpperCase();
    if (st.indexOf("SUCCESS") !== -1 || st === "REFUNDED") {
      var nowStr = Utilities.formatDate(new Date(), "Asia/Kolkata", "yyyy-MM-dd HH:mm");
      refWs.getRange(i + 1, cStatus + 1).setValue("Refunded at " + nowStr);
      if (cNote !== -1) refWs.getRange(i + 1, cNote + 1).setValue(String(data[i][cNote] || "") + " | settled via reconciler @ " + new Date());
      settled++;
    } else if (st.indexOf("FAIL") !== -1) {
      refWs.getRange(i + 1, cStatus + 1).setValue("Refund Failed");
      if (cNote !== -1) refWs.getRange(i + 1, cNote + 1).setValue(String(data[i][cNote] || "") + " | gateway reported " + st + " @ " + new Date());
      failed++;
    }
    // else still pending at the gateway — leave Processing, retry next sweep.
  }
  if (settled || failed) Logger.log("reconcilePendingRefunds: settled " + settled + ", failed " + failed + ".");
}

/**
 * ONE-SHOT ADMIN HELPER — run manually from the Apps Script editor AFTER HDFC
 * enables refund access. Re-attempts every gateway refund that previously failed
 * (SK_Refunds rows with Status "Pending" and an "auto-refund FAILED" note). On
 * success the row flips to Processing/gateway and the 5-min reconciler then
 * settles it to Refunded — so the manual queue clears itself with no per-order work.
 * @returns {string} summary
 */
function retryQueuedRefunds() {
  const ss = getSpreadsheet();
  const refWs = ss.getSheetByName(TAB_REFUNDS);
  if (!refWs || refWs.getLastRow() < 2) return "No refunds to retry.";

  const data = refWs.getDataRange().getValues();
  const H = data[0];
  const cSid = H.indexOf("Submission_ID"), cAmt = H.indexOf("Amount"), cPhone = H.indexOf("Phone");
  const cStatus = H.indexOf("Status"), cNote = H.indexOf("Adjustment_Note"), cMode = H.indexOf("Refund_Mode");
  if (cSid === -1 || cStatus === -1 || cAmt === -1) return "Refunds sheet missing columns.";

  // Submission_ID → Gateway_Order_ID
  const gwMap = {};
  const ordWs = ss.getSheetByName(TAB_ORDERS);
  if (ordWs && ordWs.getLastRow() > 1) {
    const od = ordWs.getDataRange().getValues();
    const oH = od[0], oSid = oH.indexOf("Submission_ID"), oGw = oH.indexOf("Gateway_Order_ID");
    if (oSid !== -1 && oGw !== -1) for (var k = 1; k < od.length; k++) {
      var s = String(od[k][oSid] || "").trim(); if (s) gwMap[s] = String(od[k][oGw] || "").trim();
    }
  }

  var retried = 0, ok = 0;
  for (var i = 1; i < data.length; i++) {
    var status = String(data[i][cStatus] || "").trim().toLowerCase();
    var note   = String(data[i][cNote] || "");
    var mode   = cMode !== -1 ? String(data[i][cMode] || "").trim().toLowerCase() : "";
    // Retry every un-processed ("Pending") refund for a GATEWAY-paid order — whether
    // it's the newer "auto-refund FAILED" tag or an older plain fallback row. The
    // gateway-order-id presence check below skips genuinely-manual (non-gateway) refunds,
    // and we skip rows already in the gateway pipeline (Mode "gateway" / Processing).
    if (status !== "pending" || mode === "gateway") continue;

    var sid = String(data[i][cSid] || "").trim();
    var gOrderId = gwMap[sid] || "";
    var amt = Number(data[i][cAmt]) || 0;
    var phone = String(data[i][cPhone] || "");
    if (!gOrderId || !(amt > 0)) continue;   // no gateway id ⇒ genuinely manual refund — skip

    retried++;
    var reqId = ("RF" + sid).replace(/[^A-Za-z0-9]/g, "").slice(0, 20);
    var rf = hdfc_initiateRefund(gOrderId, amt, reqId, phone);
    if (rf && rf.success) {
      ok++;
      var nowStr = Utilities.formatDate(new Date(), "Asia/Kolkata", "yyyy-MM-dd HH:mm");
      var st = (rf.status === "SUCCESS" || rf.status === "REFUNDED") ? ("Refunded at " + nowStr) : "Processing";
      refWs.getRange(i + 1, cStatus + 1).setValue(st);
      if (cMode !== -1) refWs.getRange(i + 1, cMode + 1).setValue("gateway");
      if (cNote !== -1) refWs.getRange(i + 1, cNote + 1).setValue(note + " | RETRIED ok: " + (rf.refund_id || reqId) + " (" + rf.status + ")");
    } else if (cNote !== -1) {
      refWs.getRange(i + 1, cNote + 1).setValue(note + " | retry failed: " + ((rf && rf.error) || "unknown"));
    }
  }
  const summary = "retryQueuedRefunds: retried " + retried + ", succeeded " + ok + ".";
  Logger.log(summary);
  return summary;
}

