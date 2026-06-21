// ============================================================
// 12_Payout_Reconciler.gs
// SETTLEMENT (merchant payout) reconciliation — peace-of-mind check that every
// order we marked "Paid" via the gateway actually shows up in HDFC's T+2 payout
// report, at the right amount, and vice-versa.
// ------------------------------------------------------------
// USAGE (paste-into-tab + run):
//   1. In the live spreadsheet, create/clear a tab named "Gateway_Payout_Report"
//      and paste the HDFC payout report INCLUDING its header row (the one that
//      starts "External MID  External TID ... Order ID ... Transaction Amount …").
//   2. Run reconcilePayout() from the Apps Script editor (Run ▸ reconcilePayout).
//   3. Read the "Payout_Reconciliation" tab it writes: a summary block on top,
//      then one row per finding. Anything not "✅ MATCHED" is flagged for review.
//
// MATCH KEY: HDFC's "Order ID" column embeds OUR order id, e.g.
//   "70556-SK260620GUCE9HIJIE-1"  →  we extract "SK260620GUCE9HIJIE".
// We match that exactly to SK_Orders.Gateway_Order_ID / IA_Orders.Submission_ID,
// then verify the amount (±1 rupee). Covers BOTH Svaadh and IntentAmplify.
// ============================================================

const PAYOUT_TAB_DEFAULT = "Gateway_Payout_Report";
const PAYOUT_RESULT_TAB  = "Payout_Reconciliation";

function reconcilePayout(payoutTabName) {
  const ss = getSpreadsheet();
  const tabName = payoutTabName || PAYOUT_TAB_DEFAULT;
  const pw = ss.getSheetByName(tabName);
  if (!pw) return _pr_fail("No tab named '" + tabName + "'. Create it and paste the HDFC payout report (with its header row).");
  const data = pw.getDataRange().getValues();
  if (data.length < 2) return _pr_fail("'" + tabName + "' has no data rows.");

  // ── Locate the columns we need by header name (HDFC's exact labels) ──
  const H = data[0].map(function (h) { return String(h || "").trim().toLowerCase(); });
  const col = function (name) { return H.indexOf(String(name).toLowerCase()); };
  const ci = {
    orderId:  col("Order ID"),
    amount:   col("Transaction Amount"),
    net:      col("Net Amount"),
    settle:   col("Settlement Date"),
    txnDate:  col("Transaction Req Date"),
    crdr:     col("CR / DR"),
    transType:col("Trans Type"),
    rrn:      col("Txn ref no. (RRN)"),
    upiTxn:   col("UPI Trxn ID"),
    addl1:    col("Additional Field 1"),
    payerVpa: col("Payer VPA")
  };
  if (ci.orderId === -1 || ci.amount === -1) {
    return _pr_fail("Could not find the 'Order ID' and 'Transaction Amount' columns in '" + tabName + "'. Paste the report with its original header row.");
  }

  // ── Parse the payout lines; split credits (payments) vs debits (refunds) ──
  const credits = [], debits = [];
  let minDate = "9999-99-99", maxDate = "0000-00-00";
  for (let i = 1; i < data.length; i++) {
    const r = data[i];
    const rawOid = String(r[ci.orderId] || "").trim();
    if (!rawOid) continue;
    const oid    = _pr_extractOrderId(rawOid);
    const amount = Number(r[ci.amount]) || 0;
    const txnISO = _pr_parseDate(ci.txnDate !== -1 ? r[ci.txnDate] : (ci.settle !== -1 ? r[ci.settle] : ""));
    if (txnISO) { if (txnISO < minDate) minDate = txnISO; if (txnISO > maxDate) maxDate = txnISO; }
    const phone  = _pr_phone(ci.addl1 !== -1 ? r[ci.addl1] : "", ci.payerVpa !== -1 ? r[ci.payerVpa] : "");
    const crdr   = String(ci.crdr !== -1 ? r[ci.crdr] : "").trim().toUpperCase();
    const tType  = String(ci.transType !== -1 ? r[ci.transType] : "").trim().toUpperCase();
    const entry  = {
      rawOid: rawOid, oid: oid, amount: amount, txnISO: txnISO,
      settleISO: _pr_parseDate(ci.settle !== -1 ? r[ci.settle] : ""),
      phone: phone, rrn: String(ci.rrn !== -1 ? r[ci.rrn] : "").trim(),
      upiTxn: String(ci.upiTxn !== -1 ? r[ci.upiTxn] : "").trim()
    };
    const isDebit = crdr === "DR" || tType === "DEBIT" || amount < 0;
    if (isDebit) debits.push(entry); else credits.push(entry);
  }

  // ── Build OUR side: gateway-paid orders keyed by gateway order id ──
  // SK (Svaadh) — read live + archive across the payout's date range so an older
  // report whose orders were archived still reconciles. IA read from IA_Orders.
  const ours = {}; // OID → { channel, amount, phone, date, statuses:[] }
  const addOurs = function (oid, channel, amt, phone, date, status) {
    if (!oid) return;
    if (!ours[oid]) ours[oid] = { channel: channel, amount: 0, phone: phone, date: date, statuses: [] };
    ours[oid].amount += amt;
    ours[oid].statuses.push(status);
    if (phone && !ours[oid].phone) ours[oid].phone = phone;
  };

  // pad the range a little so T+0 orders that settle T+2 are still considered
  const fromD = (minDate === "9999-99-99") ? "2000-01-01" : _pr_addDays(minDate, -3);
  const toD   = (maxDate === "0000-00-00") ? "2999-12-31" : _pr_addDays(maxDate,  3);

  let skRows = [];
  try {
    skRows = (typeof getOrdersInRangeWithArchive === "function")
      ? getOrdersInRangeWithArchive(fromD, toD)
      : getAllRows(getOrCreateTab(ss, TAB_ORDERS, ORDERS_HEADERS));
  } catch (e) { skRows = getAllRows(getOrCreateTab(ss, TAB_ORDERS, ORDERS_HEADERS)); }

  skRows.forEach(function (r) {
    const gwId = String(r.Gateway_Order_ID || "").trim().toUpperCase();
    if (!gwId) return;
    const method = String(r.Payment_Method || "");
    if (method.indexOf("Gateway") === -1 && method.indexOf("HDFC") === -1) return; // gateway-paid only
    const pstat = String(r.Payment_Status || "");
    if (typeof _isOrderCancelled === "function" && _isOrderCancelled(pstat) && pstat.toLowerCase().indexOf("refund") === -1) {
      // a cancelled-but-not-refunded row never carried a settlement — skip it
      return;
    }
    const d = (r.Order_Date instanceof Date)
      ? Utilities.formatDate(r.Order_Date, "Asia/Kolkata", "yyyy-MM-dd")
      : String(r.Order_Date || "").trim().slice(0, 10);
    addOurs(gwId, "Svaadh", Number(r.Net_Total) || 0, String(r.Phone || ""), d, pstat);
  });

  // IA gateway-paid orders
  try {
    const iaWs = getOrCreateTab(ss, IA_TAB_ORDERS, IA_ORDERS_HEADERS);
    getAllRows(iaWs).forEach(function (r) {
      if (String(r.Approved_By || "").indexOf("Gateway") === -1) return; // gateway-paid IA only
      if (String(r.Payment_Status || "").toLowerCase() !== "paid") return;
      const oid = String(r.Submission_ID || "").trim().toUpperCase();
      const d = (r.Date instanceof Date)
        ? Utilities.formatDate(r.Date, "Asia/Kolkata", "yyyy-MM-dd")
        : String(r.Date || "").trim().slice(0, 10);
      addOurs(oid, "IntentAmplify", Number(r.Subtotal) || 0, String(r.Phone || ""), d, "Paid");
    });
  } catch (e) { /* IA tab may not exist — ignore */ }

  // ── Match payout CREDITS → our orders ──
  const results = [];
  const seenOids = {};
  let nMatched = 0, nAmt = 0, nNoOrder = 0;
  credits.forEach(function (c) {
    seenOids[c.oid] = true;
    const o = ours[c.oid];
    if (!o) {
      nNoOrder++;
      results.push(["⚠️ NO ORDER FOUND", "?", c.oid || "(unparsed)", c.rawOid, c.settleISO, c.txnISO,
        c.amount, "", "", c.phone, "", c.rrn || c.upiTxn,
        "Payout credit has no matching Paid gateway order in our records. Check archive / investigate."]);
    } else if (Math.abs((Number(o.amount) || 0) - c.amount) > 1) {
      nAmt++;
      results.push(["❌ AMOUNT MISMATCH", o.channel, c.oid, c.rawOid, c.settleISO, c.txnISO,
        c.amount, o.amount, (c.amount - o.amount), c.phone, o.phone, c.rrn || c.upiTxn,
        "Settled amount differs from what we charged."]);
    } else {
      nMatched++;
      results.push(["✅ MATCHED", o.channel, c.oid, c.rawOid, c.settleISO, c.txnISO,
        c.amount, o.amount, (c.amount - o.amount), c.phone, o.phone, c.rrn || c.upiTxn, ""]);
    }
  });

  // ── Reverse check: our Paid gateway orders in range with NO payout credit ──
  // (the important one — money we think we received but didn't settle). Scoped to
  // the report's own date window so we never false-flag orders too recent (T+2)
  // or outside the report period.
  let nUnsettled = 0;
  Object.keys(ours).forEach(function (oid) {
    if (seenOids[oid]) return;
    const o = ours[oid];
    if (o.date && (o.date < minDate || o.date > maxDate)) return; // outside the report window
    nUnsettled++;
    results.push(["🚨 UNSETTLED (no payout)", o.channel, oid, "", "", o.date,
      "", o.amount, "", "", o.phone, "",
      "We marked this Paid via gateway but it is NOT in this payout report. Verify the money was received."]);
  });

  // ── Debits / refunds: list for visibility (matched to an order id if possible) ──
  debits.forEach(function (d) {
    const o = ours[d.oid];
    results.push(["↩️ DEBIT / REFUND", o ? o.channel : "?", d.oid || "(unparsed)", d.rawOid, d.settleISO, d.txnISO,
      d.amount, o ? o.amount : "", "", d.phone, o ? o.phone : "", d.rrn || d.upiTxn,
      "Debit/refund line — reconcile against SK_Refunds separately."]);
  });

  // ── Write the result tab ──
  const out = ss.getSheetByName(PAYOUT_RESULT_TAB) || ss.insertSheet(PAYOUT_RESULT_TAB);
  out.clear();
  const summary = [
    ["PAYOUT RECONCILIATION — " + Utilities.formatDate(new Date(), "Asia/Kolkata", "yyyy-MM-dd HH:mm")],
    ["Report window (txn dates)", minDate + "  →  " + maxDate],
    ["Payout credit lines", credits.length],
    ["  ✅ Matched", nMatched],
    ["  ❌ Amount mismatch", nAmt],
    ["  ⚠️ No order found", nNoOrder],
    ["🚨 Our Paid orders UNSETTLED (no payout)", nUnsettled],
    ["↩️ Debit/refund lines", debits.length],
    [(nAmt + nNoOrder + nUnsettled === 0) ? "RESULT: 100% MATCH ✅" : "RESULT: DISCREPANCIES FOUND — see flagged rows below ⬇"],
    [""]
  ];
  out.getRange(1, 1, summary.length, 1).setValues(summary.map(function (r) { return [r[0]]; }));
  summary.forEach(function (r, i) { if (r.length > 1) out.getRange(i + 1, 2).setValue(r[1]); });

  const header = ["Status", "Channel", "Order ID (ours)", "Payout Order ID", "Settle Date", "Txn Date",
                  "Payout ₹", "Our ₹", "Diff", "Payout Phone", "Our Phone", "UPI Txn / RRN", "Notes"];
  const startRow = summary.length + 1;
  out.getRange(startRow, 1, 1, header.length).setValues([header]);
  out.getRange(startRow, 1, 1, header.length).setFontWeight("bold");
  if (results.length) {
    // sort: flagged first, matched last
    const rank = { "🚨 UNSETTLED (no payout)": 0, "❌ AMOUNT MISMATCH": 1, "⚠️ NO ORDER FOUND": 2, "↩️ DEBIT / REFUND": 3, "✅ MATCHED": 4 };
    results.sort(function (a, b) { return (rank[a[0]] || 9) - (rank[b[0]] || 9); });
    out.getRange(startRow + 1, 1, results.length, header.length).setValues(results);
  }
  out.setFrozenRows(startRow);
  SpreadsheetApp.flush();

  const msg = "Payout reconciliation done. " + credits.length + " credits: " + nMatched + " matched, "
    + nAmt + " amount-mismatch, " + nNoOrder + " no-order, " + nUnsettled + " UNSETTLED. See '" + PAYOUT_RESULT_TAB + "'.";
  Logger.log(msg);
  return { success: true, matched: nMatched, amountMismatch: nAmt, noOrder: nNoOrder, unsettled: nUnsettled, debits: debits.length, window: [minDate, maxDate], message: msg };
}

// Extract our order id (SK…/IA…) from HDFC's wrapped "Order ID" value, e.g.
// "70556-SK260620GUCE9HIJIE-1" → "SK260620GUCE9HIJIE". Returns "" if none.
function _pr_extractOrderId(raw) {
  const m = String(raw || "").toUpperCase().match(/(SK|IA)\d{6}[A-Z0-9]+/);
  return m ? m[0] : "";
}

// "20-JUN-2026 01:01:45" → "2026-06-20". Also tolerates a Date cell or yyyy-MM-dd.
function _pr_parseDate(v) {
  if (v instanceof Date) return Utilities.formatDate(v, "Asia/Kolkata", "yyyy-MM-dd");
  const s = String(v || "").trim();
  if (!s) return "";
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return m[1] + "-" + m[2] + "-" + m[3];
  m = s.match(/^(\d{1,2})[-\/]([A-Za-z]{3})[-\/](\d{4})/);
  if (m) {
    const mon = { JAN: "01", FEB: "02", MAR: "03", APR: "04", MAY: "05", JUN: "06",
                  JUL: "07", AUG: "08", SEP: "09", OCT: "10", NOV: "11", DEC: "12" }[m[2].toUpperCase()];
    if (mon) return m[3] + "-" + mon + "-" + String(m[1]).padStart(2, "0");
  }
  return "";
}

function _pr_addDays(iso, days) {
  const d = new Date(iso + "T12:00:00");
  d.setDate(d.getDate() + days);
  return Utilities.formatDate(d, "Asia/Kolkata", "yyyy-MM-dd");
}

// Pull a 10-digit phone from "Additional Field 1" (often the phone) or the
// Payer VPA (e.g. "7276206238.wallet@phonepe").
function _pr_phone(addl1, payerVpa) {
  let m = String(addl1 || "").match(/\d{10}/); if (m) return m[0];
  m = String(payerVpa || "").match(/\d{10}/); if (m) return m[0];
  return "";
}

function _pr_fail(msg) { Logger.log("reconcilePayout: " + msg); return { success: false, error: msg }; }
