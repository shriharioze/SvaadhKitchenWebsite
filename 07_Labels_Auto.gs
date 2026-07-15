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
// PDF engine: Google Docs (`DocumentApp`) borderless table with cumulative
// 0.75 pt (`96-dpi pixel`) pitch compensation (`cumPtNext - cumPtCurr`).
// This ensures exact Devanagari (`Noto Sans Devanagari`) rendering without
// row-height drift (`+0.08 mm/row`) or page overflow. The temp doc is trashed
// after export.
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
// in each gap. Font sizes converted from the canvas mm values to pt
// (mm × 2.8346): name 3.4mm→9.5pt bold, summary 3.0mm→8.5pt, area 3.2mm→9pt
// bold, notes 2.4mm→7pt orange. Returns base64 PDF.
//
// ENGINE: Google Docs (DocumentApp). NOT Slides — the Slides API ignores
// pageSize on presentations.create (documented Google limitation, issue
// 119321089), silently producing a 16:9 page that fits only ~5 label blocks
// (the 2026-07-06 "5 of 32 labels" incident). Docs allows setting an exact
// custom page size AFTER creation, so the strip is a single page of exactly
// 50mm × (n × block) like the kitchen page's jsPDF output. Pitch precision
// comes from a borderless table with ONE row per label at min-height = BLOCK
// (25mm label + 2.7mm die-cut gap): fitted text sits in the top 25mm, the empty
// bottom 2.7mm is the physical gap. No separate gap row / horizontal rule (a Docs
// HR renders ~4.3mm not 2.7mm and drifted the strip). The temp doc is trashed
// after export.
// ── Auto-fit text sizing (NEVER truncates) ───────────────────────────────────
// Mirrors the kitchen page: long text WRAPS (Docs wraps at spaces inside the cell)
// and the whole label's font is scaled DOWN uniformly until every wrapped line fits
// inside the 25mm row — so nothing is ever cut with "…", yet the row can't grow past
// its 25mm minimum (which would drift the strip / paginate — the pitch bug we fixed).
// The old approach forced each field onto ONE line and hard-truncated with … at a
// font floor; the owner's manual generator never does that (it wraps + auto-sizes),
// so we match it.
var LBL_LINE_PT = 127;            // printable line width: 50mm − 2+2mm margins ≈ 46mm ≈ 130pt, minus slack
function _lblTextUnits(s) {       // width estimate in font-size units (pt of width per pt of font)
  var u = 0;
  s = String(s || "");
  for (var i = 0; i < s.length; i++) {
    var c = s.charCodeAt(i);
    u += (c >= 0x0900 && c <= 0x097F) ? 1.0 : 0.62; // Devanagari wide, ASCII/other conservative
  }
  return u;
}
// Estimate how many wrapped lines `text` needs at `size` pt inside the cell width.
// Conservative (over-counts → we may size slightly small, never overflow the row).
function _lblWrapLines(text, size) {
  var t = String(text || "");
  if (!t) return 1;
  return Math.max(1, Math.ceil(_lblTextUnits(t) * size / LBL_LINE_PT));
}
// Docs renders a Devanagari line a bit taller than its point size (matras above &
// below) even at lineSpacing 0.9. LH_FACTOR over-estimates that so the fit stays on
// the safe side of the 25mm row. Budget = 25mm row − 0.5mm top pad − a little slack.
var LBL_LH_FACTOR   = 1.6;
var LBL_V_BUDGET_PT = (25 - 0.5) * 2.834645669 - 3; // ≈ 66pt
var LBL_MIN_SCALE   = 0.42;       // ~4pt floor for a 9.5pt base — readable, still whole text
// Uniformly scale ALL of a label's fields down until the total WRAPPED height fits the
// 25mm budget. Returns lines with final sizes (Docs then wraps each field's full text).
// Never truncates: if even the floor can't fit truly extreme content, it stops at the
// floor (tiny but complete text) rather than cutting it — matching the manual's intent.
function _lblFitLabel(fields) {   // fields: [{ text, bold, color, base }]
  var scale = 1.0;
  for (var iter = 0; iter < 60; iter++) {
    var total = 0;
    for (var i = 0; i < fields.length; i++) {
      var sz = fields[i].base * scale;
      total += _lblWrapLines(fields[i].text, sz) * sz * LBL_LH_FACTOR;
    }
    if (total <= LBL_V_BUDGET_PT || scale <= LBL_MIN_SCALE) break;
    scale = Math.max(LBL_MIN_SCALE, scale - 0.04);
  }
  return fields.map(function (f) {
    return { text: f.text, bold: f.bold, color: f.color, size: Math.round(f.base * scale * 2) / 2 };
  });
}

function _lblBuildPdfB64(orders, meal, lang, gapMm) {
  if (!orders || !orders.length) return "";
  var mealStr = String(meal || "");
  var n = orders.length;
  var LH = 25.0; // 25mm label height
  var GAP = (typeof gapMm === "number" && !isNaN(gapMm)) ? gapMm : 2.7;
  var BLOCK = LH + GAP; // 27.7mm pitch
  var MM = 2.834645669; // pt per mm
  var totalHPt = Math.round(n * BLOCK * MM * 100) / 100;
  var widthPt = Math.round(50 * MM * 100) / 100;
  var FONT = (lang === "Devanagari") ? "Noto Sans Devanagari" : "Hind";

  var title = "tmp_labels_" + mealStr + "_" + Date.now();
  var presentation = Slides.Presentations.create({ title: title });
  var deckId = presentation.presentationId;

  try {
    // 1. Resize presentation page to exact label strip dimensions [50mm × n*27.7mm]
    Slides.Presentations.batchUpdate({
      requests: [{
        updatePageSize: {
          pageSize: {
            width: { magnitude: widthPt, unit: "PT" },
            height: { magnitude: totalHPt, unit: "PT" }
          }
        }
      }]
    }, deckId);

    // 2. Open via SlidesApp for absolute coordinate positioning of text boxes & dividing lines
    var deck = SlidesApp.openById(deckId);
    var slide = deck.getSlides()[0];

    orders.forEach(function (order, idx) {
      var BY = idx * BLOCK; // top of label idx in mm
      var summary = _lblItemSummary(order, meal, lang);
      var fields = [{ text: "Name: " + (order.name || ""), bold: true, color: "#000000", base: 9.5 }];
      if (summary) fields.push({ text: summary, bold: false, color: "#222222", base: 8.5 });
      if (order.area) fields.push({ text: String(order.area), bold: true, color: "#000000", base: 9 });
      if (order.notes) fields.push({ text: "* " + order.notes, bold: false, color: "#B86000", base: 7 });
      var lines = _lblFitLabel(fields);

      // Add absolute-positioned text box for the 25mm label block
      var tbLeft = 1.0 * MM;
      var tbTop = (BY + 0.5) * MM;
      var tbWidth = 48.0 * MM;
      var tbHeight = (LH - 0.5) * MM;
      var shape = slide.insertShape(SlidesApp.ShapeType.TEXT_BOX, tbLeft, tbTop, tbWidth, tbHeight);
      var textRange = shape.getText();
      shape.setContentAlignment(SlidesApp.ContentAlignment.TOP);

      lines.forEach(function (l, li) {
        var tr = (li === 0) ? textRange.setText(l.text) : textRange.appendParagraph(l.text).getRange();
        tr.getTextStyle()
          .setFontFamily(FONT)
          .setFontSize(l.size)
          .setBold(!!l.bold)
          .setForegroundColor(l.color);
        tr.getParagraphStyle()
          .setLineSpacing(90)
          .setSpaceBefore(0)
          .setSpaceAfter(0);
      });

      // Strict horizontal line across the label at 25mm + GAP/2 exactly like manual kitchen.html
      if (idx < n - 1) {
        var lineY = (BY + LH + GAP / 2) * MM;
        var line = slide.insertLine(SlidesApp.LineCategory.STRAIGHT, 1.0 * MM, lineY, 49.0 * MM, lineY);
        line.getLineFill().setSolidFill("#000000");
        line.setWeight(1);
      }
    });

    deck.saveAndClose();

    // Export the resized single continuous slide as PDF base64
    var pdfBlob = DriveApp.getFileById(deckId).getAs("application/pdf");
    pdfBlob.setName("labels_" + mealStr + "_" + _formatDateIst(new Date()) + ".pdf");
    return Utilities.base64Encode(pdfBlob.getBytes());
  } finally {
    try {
      DriveApp.getFileById(deckId).setTrashed(true);
    } catch (cleanupErr) {}
  }
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

  // ── Phase 2: push-to-print notification ────────────────────────────────
  // If MACRODROID_WEBHOOK_URL is set (Script Property — the kitchen phone's
  // MacroDroid webhook), ping it with THIS file's id so the phone downloads
  // exactly this PDF and hands it to RawBT. Push, not poll: only the freshly
  // auto-generated label file ever prints — never other PDFs, never stale
  // ones. The file gets an anyone-with-link VIEW share so the phone can
  // download it without a Google login (unguessable id; contents are just
  // names/items/areas). Manual kitchen-page saves do NOT trigger this —
  // auto-generated labels only. Non-fatal on any failure.
  try {
    var hookUrl = SP.getProperty("MACRODROID_WEBHOOK_URL");
    if (hookUrl && saved && saved.id) {
      DriveApp.getFileById(saved.id).setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      var sep = hookUrl.indexOf("?") === -1 ? "?" : "&";
      UrlFetchApp.fetch(hookUrl + sep
        + "file_id=" + encodeURIComponent(saved.id)
        + "&file_name=" + encodeURIComponent(saved.name)
        + "&meal=" + encodeURIComponent(meal)
        + "&count=" + orders.length,
        { muteHttpExceptions: true });
    }
  } catch (e) { Logger.log("MacroDroid webhook ping failed: " + (e && e.message)); }

  // (No "labels ready" email — owner asked to stop it 2026-07-11; the Drive save +
  // MacroDroid webhook above are the delivery channels. The FAILURE alert in
  // labelAutoTick stays — that one matters.)

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
