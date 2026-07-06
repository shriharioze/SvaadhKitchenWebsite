// ============================================================
// 07_Labels_Auto.gs — SERVER-SIDE label auto-generation
// ============================================================
// Removes the owner's last manual dependency: "cutoff+5 → open kitchen page →
// generate labels → save to Drive". A 1-minute time trigger (run
// setupLabelAutoTrigger() ONCE from the editor) fires labelAutoTick():
// 5 minutes after each meal's cutoff (live site-wide defaults + per-day
// overrides, via _effectiveCutoffsForDate) it builds the SAME 50mm-wide
// label-strip PDF the kitchen page builds — Marathi (Devanagari) item codes,
// same 25mm blocks, same global gap, separator lines — and saves it through
// the SAME saveLabels() path: same Drive folder, same filename. The phone
// print flow is untouched; the PDF just appears in Drive with no human and
// no browser involved.
//
// The kitchen page's client-side auto-fire (kitchen.html scheduleAutoLabels)
// stays as a harmless backstop: same filename → the file is replaced, never
// duplicated.
//
// PDF engine: Google Slides advanced API (enabled in appsscript.json) — the
// only GAS-native renderer that handles Devanagari text with precise mm
// positioning, then exports to PDF. The temp presentation is trashed after
// export.
// ============================================================

var LBL_AUTO_MEALS     = ["Lunch", "Dinner"]; // Breakfast excluded per spec
var LBL_AUTO_DELAY_MIN = 5;                   // fire N minutes after cutoff
var LBL_AUTO_WINDOW_H  = 3;                   // don't fire if > 3h past cutoff (stale)
var LBL_AUTO_LANG      = "Devanagari";        // kitchen staff read Marathi
var LBL_AUTO_STATE_KEY = "LABELS_AUTO_STATE"; // Script Property: {"<date>_<meal>": {…}}

// ── Item code maps + column order (MUST mirror kitchen.html LABEL_MR/EN/LD_COLS) ──
var LBL_EN = {
  Chapati: "CH", Without_Oil_Chapati: "CH(O)", Phulka: "PH", Ghee_Phulka: "GPH",
  Jowar_Bhakri: "J", Bajra_Bhakri: "B",
  Dry_Sabji_Mini: "D100", Dry_Sabji_Full: "D250",
  Curry_Sabji_Mini: "C100", Curry_Sabji_Full: "C250",
  Dal: "DAL", Rice: "R", Salad: "S", Curd: "CU",
  "Kanda Poha": "KP", "Ghee Upma": "GU", "Thalipeeth": "TP",
  "Paneer Paratha": "PP", "Methi Thepla": "MT", "Sabudana Khichdi": "SK"
};
var LBL_MR = {
  Chapati: "च", Without_Oil_Chapati: "च बिनतेल", Phulka: "फु", Ghee_Phulka: "घी फु",
  Jowar_Bhakri: "जो", Bajra_Bhakri: "बाज",
  Dry_Sabji_Mini: "सु १००", Dry_Sabji_Full: "सु २५०",
  Curry_Sabji_Mini: "र १००", Curry_Sabji_Full: "र २५०",
  Dal: "दाल", Rice: "भात", Salad: "स", Curd: "दही",
  "Kanda Poha": "कांपो", "Ghee Upma": "घीऊ", "Thalipeeth": "था",
  "Paneer Paratha": "पनपरा", "Methi Thepla": "मेथी", "Sabudana Khichdi": "साबु"
};
var LBL_LD_COLS = ["Chapati", "Without_Oil_Chapati", "Phulka", "Ghee_Phulka", "Jowar_Bhakri", "Bajra_Bhakri",
  "Dry_Sabji_Mini", "Dry_Sabji_Full", "Curry_Sabji_Mini", "Curry_Sabji_Full", "Dal", "Rice", "Salad", "Curd"];

// Per-order item summary — direct port of kitchen.html getBulkItemSummary().
function _lblItemSummary(order, meal, lang) {
  var lbl = (lang === "Devanagari") ? LBL_MR : LBL_EN;
  var parts = [];
  if (meal === "Breakfast") {
    var bfMap = {};
    for (var n = 1; n <= 4; n++) {
      var it = String(order["BF_Item_" + n] || "").trim();
      var q = Number(order["BF_Qty_" + n]) || 0;
      if (it && q > 0) bfMap[it] = (bfMap[it] || 0) + q;
    }
    if (order.Items_JSON) {
      try {
        var parsed = JSON.parse(order.Items_JSON);
        Object.keys(parsed).forEach(function (k) {
          var qty = Number(parsed[k]) || 0;
          if (qty <= 0) return;
          var name = (k === "Breakfast Curd") ? "Curd" : k;
          if (!bfMap[name]) bfMap[name] = qty;
        });
      } catch (e) {}
    }
    if (!bfMap["Curd"] && Number(order.Curd) > 0) bfMap["Curd"] = Number(order.Curd);
    Object.keys(bfMap).forEach(function (name) {
      var a = lbl[name] || lbl[name.replace(/ /g, "_")] || name;
      parts.push(bfMap[name] + "x" + a);
    });
  } else {
    LBL_LD_COLS.forEach(function (col) {
      var q = Number(order[col]) || 0;
      if (q > 0) parts.push(q + "x" + (lbl[col] || col));
    });
  }
  return parts.join(", ");
}

// ── PDF builder: one long 50mm-wide strip, one 25mm block per label ─────────
// Layout mirrors the kitchen page's Devanagari canvas renderer (kitchen.html
// saveBulkLabelsToDrive): W=50, LH=25, gap=global LABEL_GAP_MM, separator line
// centred in each gap. Font sizes converted from the canvas mm values to pt
// (mm × 2.8346): name 3.4mm→9.5pt bold, summary 3.0mm→8.5pt, area 3.2mm→9pt
// bold, notes 2.4mm→7pt orange. Returns base64 PDF.
function _lblBuildPdfB64(orders, meal, lang, gapMm) {
  var MM = 2.834645669; // mm → pt
  var W = 50, LH = 25, GAP = (typeof gapMm === "number" && !isNaN(gapMm)) ? gapMm : 2.7;
  var BLOCK = LH + GAP;
  var n = orders.length;
  var totalH = n * BLOCK;
  var FONT = (lang === "Devanagari") ? "Noto Sans Devanagari" : "Arial";

  var pres = Slides.Presentations.create({
    title: "tmp_labels_" + meal + "_" + Date.now(),
    pageSize: {
      width:  { magnitude: W * MM,      unit: "PT" },
      height: { magnitude: totalH * MM, unit: "PT" }
    }
  });
  var presId = pres.presentationId;
  var pageId = pres.slides[0].objectId;

  try {
    var requests = [];

    // Clear the default title/subtitle placeholders off the first slide.
    (pres.slides[0].pageElements || []).forEach(function (el) {
      requests.push({ deleteObject: { objectId: el.objectId } });
    });

    orders.forEach(function (order, idx) {
      var BY = idx * BLOCK; // block top, mm
      var summary = _lblItemSummary(order, meal, lang);

      // Build the label's text as one box with per-line styles.
      var lines = [];   // { text, bold, sizePt, colorHex }
      lines.push({ text: "Name: " + (order.name || ""), bold: true,  size: 9.5, color: "000000" });
      lines.push({ text: summary,                        bold: false, size: 8.5, color: "222222" });
      if (order.area)  lines.push({ text: order.area,          bold: true,  size: 9,   color: "000000" });
      if (order.notes) lines.push({ text: "* " + order.notes,  bold: false, size: 7,   color: "B86000" });

      var boxId = "lblbox_" + idx;
      requests.push({
        createShape: {
          objectId: boxId,
          shapeType: "TEXT_BOX",
          elementProperties: {
            pageObjectId: pageId,
            size: {
              width:  { magnitude: (W - 4) * MM,  unit: "PT" },
              height: { magnitude: (LH - 2) * MM, unit: "PT" }
            },
            transform: { scaleX: 1, scaleY: 1, translateX: 2 * MM, translateY: (BY + 1) * MM, unit: "PT" }
          }
        }
      });

      var fullText = lines.map(function (l) { return l.text; }).join("\n");
      requests.push({ insertText: { objectId: boxId, insertionIndex: 0, text: fullText } });

      // Per-line character styling (ranges over the inserted text).
      var cursor = 0;
      lines.forEach(function (l, li) {
        var start = cursor, end = cursor + l.text.length;
        cursor = end + 1; // +1 for the \n
        if (end > start) {
          requests.push({
            updateTextStyle: {
              objectId: boxId,
              textRange: { type: "FIXED_RANGE", startIndex: start, endIndex: end },
              style: {
                bold: !!l.bold,
                fontFamily: FONT,
                fontSize: { magnitude: l.size, unit: "PT" },
                foregroundColor: { opaqueColor: { rgbColor: _lblHexRgb(l.color) } }
              },
              fields: "bold,fontFamily,fontSize,foregroundColor"
            }
          });
        }
      });
      // Tight paragraph spacing so 4 lines fit the 25mm block like the canvas did.
      requests.push({
        updateParagraphStyle: {
          objectId: boxId,
          textRange: { type: "ALL" },
          style: { lineSpacing: 100, spaceAbove: { magnitude: 0, unit: "PT" }, spaceBelow: { magnitude: 0, unit: "PT" } },
          fields: "lineSpacing,spaceAbove,spaceBelow"
        }
      });

      // Separator line centred in the gap after every block except the last.
      if (idx < n - 1) {
        var lineId = "lblsep_" + idx;
        requests.push({
          createLine: {
            objectId: lineId,
            category: "STRAIGHT",
            elementProperties: {
              pageObjectId: pageId,
              size: {
                width:  { magnitude: (W - 2) * MM, unit: "PT" },
                height: { magnitude: 0.5,          unit: "PT" }
              },
              transform: { scaleX: 1, scaleY: 1, translateX: 1 * MM, translateY: (BY + LH + GAP / 2) * MM, unit: "PT" }
            }
          }
        });
        requests.push({
          updateLineProperties: {
            objectId: lineId,
            lineProperties: {
              lineFill: { solidFill: { color: { rgbColor: { red: 0, green: 0, blue: 0 } } } },
              weight: { magnitude: 1, unit: "PT" }
            },
            fields: "lineFill,weight"
          }
        });
      }
    });

    // Slides batchUpdate caps at ~500 requests per call — chunk (a big dinner
    // run is ~6 requests/label × 60 labels ≈ 360, but stay safe).
    for (var i = 0; i < requests.length; i += 400) {
      Slides.Presentations.batchUpdate({ requests: requests.slice(i, i + 400) }, presId);
    }

    var pdfBlob = DriveApp.getFileById(presId).getAs("application/pdf");
    return Utilities.base64Encode(pdfBlob.getBytes());
  } finally {
    // Always clean up the temp presentation, even if the export failed.
    try { DriveApp.getFileById(presId).setTrashed(true); } catch (e) {}
  }
}

function _lblHexRgb(hex) {
  return {
    red:   parseInt(hex.substring(0, 2), 16) / 255,
    green: parseInt(hex.substring(2, 4), 16) / 255,
    blue:  parseInt(hex.substring(4, 6), 16) / 255
  };
}

// ── Generation for one date+meal: fetch orders → build PDF → saveLabels() ──
// Reuses the exact same Drive path/filename as the kitchen page, so the phone
// print flow (and any Phase-2 automation) sees one consistent file.
function autoGenerateLabels(date, meal) {
  var lo = getLabelOrders(date, meal);
  var orders = (lo && lo.orders) || [];
  if (!orders.length) return { success: true, note: "no orders — nothing to generate" };

  var gapRaw = SP.getProperty("LABEL_GAP_MM");
  var gap = (gapRaw !== null && !isNaN(Number(gapRaw))) ? Number(gapRaw) : 2.7;

  var b64 = _lblBuildPdfB64(orders, meal, LBL_AUTO_LANG, gap);
  var saved = saveLabels({ date: date, meal: meal, lang: LBL_AUTO_LANG, pdf: b64 });

  // Heads-up email with the Drive link — lets the owner (or staff) jump
  // straight to the file on remote days. Non-fatal if mail fails.
  try {
    var adminEmail = SP.getProperty("ADMIN_EMAIL");
    if (adminEmail && saved && saved.url) {
      MailApp.sendEmail(adminEmail,
        "🏷️ Svaadh: " + meal + " labels ready (" + orders.length + " labels, " + date + ")",
        "Auto-generated and saved to Drive:\n\n" + saved.name + "\n" + saved.url
        + "\n\nOpen on the kitchen phone → print. (Generated server-side at cutoff+"
        + LBL_AUTO_DELAY_MIN + " min — no browser was needed.)");
    }
  } catch (e) {}

  return { success: true, count: orders.length, name: saved && saved.name, url: saved && saved.url };
}

// ── 1-minute trigger tick ───────────────────────────────────────────────────
// Fires each meal once per day at cutoff+5 (honours the admin-editable default
// cutoffs AND any per-day override). Claim-first state in a Script Property
// prevents double-fires; failures clear the claim so the next tick retries
// (max 3 attempts). Skips entirely if more than LBL_AUTO_WINDOW_H past cutoff
// (e.g. the trigger was installed late in the day — stale labels help nobody).
function labelAutoTick() {
  var TZ = "Asia/Kolkata";
  var now = new Date();
  var today = Utilities.formatDate(now, TZ, "yyyy-MM-dd");
  var nowH = Number(Utilities.formatDate(now, TZ, "HH")) + Number(Utilities.formatDate(now, TZ, "mm")) / 60;

  var props = PropertiesService.getScriptProperties();
  var state = {};
  try { state = JSON.parse(props.getProperty(LBL_AUTO_STATE_KEY) || "{}"); } catch (e) {}

  // Prune entries older than 3 days so the property stays tiny.
  Object.keys(state).forEach(function (k) {
    if (k.slice(0, 10) < Utilities.formatDate(new Date(now.getTime() - 3 * 864e5), TZ, "yyyy-MM-dd")) delete state[k];
  });

  var cutoffs = _effectiveCutoffsForDate(today);

  LBL_AUTO_MEALS.forEach(function (meal) {
    var key = today + "_" + meal;
    var st = state[key];
    if (st && (st.done || (st.attempts || 0) >= 3)) return; // finished or given up

    var fireAt = (Number(cutoffs[meal]) || 0) + LBL_AUTO_DELAY_MIN / 60;
    if (nowH < fireAt) return;
    if (nowH > fireAt + LBL_AUTO_WINDOW_H) {
      state[key] = { done: true, skipped: "past window" };
      return;
    }

    // Claim BEFORE generating so an overlapping tick can't double-run.
    state[key] = { attempts: ((st && st.attempts) || 0) + 1, startedAt: Date.now() };
    props.setProperty(LBL_AUTO_STATE_KEY, JSON.stringify(state));

    try {
      var res = autoGenerateLabels(today, meal);
      state[key].done = true;
      state[key].result = res && (res.name || res.note || "ok");
      Logger.log("[labelAutoTick] " + meal + " " + today + ": " + JSON.stringify(res));
    } catch (e) {
      // Leave attempts count in place — next tick retries (max 3), then alerts.
      state[key].error = String(e && e.message || e);
      Logger.log("[labelAutoTick] " + meal + " FAILED: " + state[key].error);
      if (state[key].attempts >= 3) {
        state[key].done = true;
        try {
          var adminEmail = SP.getProperty("ADMIN_EMAIL");
          if (adminEmail) MailApp.sendEmail(adminEmail,
            "⚠️ Svaadh: " + meal + " label auto-generation FAILED",
            "3 attempts failed for " + today + " " + meal + ".\nLast error: " + state[key].error
            + "\n\nPlease generate manually from the kitchen page (the old flow still works).");
        } catch (e2) {}
      }
    }
  });

  props.setProperty(LBL_AUTO_STATE_KEY, JSON.stringify(state));
}

// ── One-time setup (run from the editor) ────────────────────────────────────
function setupLabelAutoTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === "labelAutoTick") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("labelAutoTick").timeBased().everyMinutes(1).create();
  return "labelAutoTick trigger installed (every 1 min). Labels auto-generate at cutoff+"
    + LBL_AUTO_DELAY_MIN + " min for " + LBL_AUTO_MEALS.join(" + ") + ".";
}

// ── Editor test helper: generate for a specific date/meal RIGHT NOW ─────────
// Writes the real file to the real Drive folder (same name → replaces), so
// compare it against a kitchen-page-generated PDF before trusting the trigger.
function testAutoLabels() {
  var today = Utilities.formatDate(new Date(), "Asia/Kolkata", "yyyy-MM-dd");
  var out = autoGenerateLabels(today, "Lunch");
  Logger.log(JSON.stringify(out, null, 2));
  return out;
}
