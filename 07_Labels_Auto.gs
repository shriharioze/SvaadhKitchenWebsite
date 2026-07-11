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
// comes from a borderless table: one row per label (min height 25mm) and one
// thin gap row (min height = gap) holding the separator rule. The temp doc is
// trashed after export.
function _lblBuildPdfB64(orders, meal, lang, gapMm) {
  var MM = 2.834645669; // mm → pt
  var W = 50, LH = 25, GAP = (typeof gapMm === "number" && !isNaN(gapMm)) ? gapMm : 2.7;
  var BLOCK = LH + GAP;
  var n = orders.length;
  var totalH = n * BLOCK;
  var FONT = (lang === "Devanagari") ? "Noto Sans Devanagari" : "Arial";

  var doc = DocumentApp.create("tmp_labels_" + meal + "_" + Date.now());
  var docId = doc.getId();

  try {
    var body = doc.getBody();
    // Page = exactly the strip (+3mm safety so the last row can never spill
    // onto an auto-created second page — 3mm of extra feed once per run).
    body.setPageWidth(W * MM).setPageHeight((totalH + 3) * MM);
    body.setMarginTop(0).setMarginBottom(0).setMarginLeft(2 * MM).setMarginRight(2 * MM);

    // One borderless table drives the vertical pitch: rows alternate
    // label (minHeight 25mm) / gap (minHeight GAP, contains the separator).
    var cellsSeed = [];
    for (var i = 0; i < n; i++) {
      cellsSeed.push(["."]);            // label row placeholder
      if (i < n - 1) cellsSeed.push(["."]); // gap row placeholder
    }
    var table = body.appendTable(cellsSeed);
    table.setBorderWidth(0);

    var TINY = {};
    TINY[DocumentApp.Attribute.FONT_SIZE] = 1; // collapse placeholder line height

    var rIdx = 0;
    orders.forEach(function (order, idx) {
      var summary = _lblItemSummary(order, meal, lang);
      var lines = []; // { text, bold, size, color }
      lines.push({ text: "Name: " + (order.name || ""), bold: true,  size: 9.5, color: "#000000" });
      lines.push({ text: summary,                        bold: false, size: 8.5, color: "#222222" });
      if (order.area)  lines.push({ text: order.area,         bold: true,  size: 9, color: "#000000" });
      if (order.notes) lines.push({ text: "* " + order.notes, bold: false, size: 7, color: "#B86000" });

      // ── Label row ──
      var row = table.getRow(rIdx++);
      row.setMinimumHeight(LH * MM);
      var cell = row.getCell(0);
      cell.setPaddingTop(1 * MM).setPaddingBottom(0).setPaddingLeft(0).setPaddingRight(0);
      cell.clear(); // leaves one empty paragraph
      lines.forEach(function (l, li) {
        var p = (li === 0) ? cell.getChild(0).asParagraph() : cell.appendParagraph("");
        p.setText(l.text);
        p.setLineSpacing(1).setSpacingBefore(0).setSpacingAfter(0);
        var t = p.editAsText();
        t.setFontFamily(FONT).setFontSize(l.size).setBold(!!l.bold).setForegroundColor(l.color);
      });

      // ── Gap row with the separator rule (skipped after the last label) ──
      if (idx < n - 1) {
        var gRow = table.getRow(rIdx++);
        gRow.setMinimumHeight(GAP * MM);
        var gCell = gRow.getCell(0);
        gCell.setPaddingTop(0).setPaddingBottom(0).setPaddingLeft(0).setPaddingRight(0);
        gCell.clear();
        var gp = gCell.getChild(0).asParagraph();
        gp.setLineSpacing(1).setSpacingBefore(0).setSpacingAfter(0);
        gp.setAttributes(TINY);
        gp.appendHorizontalRule();
      }
    });

    // The doc starts with an empty paragraph before the table and Docs auto-adds
    // one after it — collapse both so they don't push the strip down/overflow.
    var first = body.getChild(0);
    if (first.getType() === DocumentApp.ElementType.PARAGRAPH && first.asParagraph().getText() === "") {
      // Can't remove the only structural siblings safely everywhere — shrink instead.
      first.asParagraph().setAttributes(TINY).setLineSpacing(1).setSpacingBefore(0).setSpacingAfter(0);
    }
    var last = body.getChild(body.getNumChildren() - 1);
    if (last.getType() === DocumentApp.ElementType.PARAGRAPH) {
      last.asParagraph().setAttributes(TINY).setLineSpacing(1).setSpacingBefore(0).setSpacingAfter(0);
    }

    doc.saveAndClose();
    var pdfBlob = DriveApp.getFileById(docId).getAs("application/pdf");
    return Utilities.base64Encode(pdfBlob.getBytes());
  } finally {
    // Always clean up the temp doc, even if the export failed.
    try { DriveApp.getFileById(docId).setTrashed(true); } catch (e) {}
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
