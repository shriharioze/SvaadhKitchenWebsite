const fs = require("fs");
let c = fs.readFileSync("04_Reports_Misc.gs", "utf8");
let n = 0;

// ── 1. Insert _archiveSliceDueDate + archiveDueOrders after archiveMonth ──
const anchor = "function _getOrCreateMonthlyWebhookArchiveSS(";
if (!c.includes(anchor)) { console.log("anchor MISS"); process.exit(1); }
const newFns = [
"// ════════════════════════════════════════════════════════════",
"// DUE-SLICE ARCHIVE POLICY (owner spec 2026-08-25)",
"//   • Days 1–10 of a month  → due for archive on the 18th",
"//   • Days 11–20            → due on the 28th",
"//   • Days 21–end           → due on the 8th of the NEXT month",
"//   • A row archives ONLY when it is terminal (Paid/Wallet Paid/Collected or",
"//     Cancelled/Refunded) AND its slice is due; Pending/On-Account rows stay",
"//     live until they settle, then archive on a later run into THEIR month's",
"//     existing file (append, never a new file).",
"//   • Designed for a DAILY late-evening trigger: runs before due-date are",
"//     no-ops, missed runs self-heal on the next day's run.",
"// ════════════════════════════════════════════════════════════",
"function _archiveSliceDueDate(orderDateISO) {",
"  var y = Number(orderDateISO.slice(0, 4)), m = Number(orderDateISO.slice(5, 7)), day = Number(orderDateISO.slice(8, 10));",
"  var mk = y + '-' + ('0' + m).slice(-2);",
"  if (day <= 10) return { due: mk + '-18', monthKey: mk };",
"  if (day <= 20) return { due: mk + '-28', monthKey: mk };",
"  var nm = m + 1, ny = y;",
"  if (nm > 12) { nm = 1; ny++; }",
"  return { due: ny + '-' + ('0' + nm).slice(-2) + '-08', monthKey: mk };",
"}",
"",
"function archiveDueOrders(dryRun, todayISO) {",
"  var lock = LockService.getScriptLock();",
"  try { lock.waitLock(30 * 60 * 1000); } catch (e) { return { success: false, error: 'Could not acquire script lock (system busy).' }; }",
"  try {",
"    var ss = getSpreadsheet();",
"    var fmtDate = function (v) {",
"      return v instanceof Date ? Utilities.formatDate(v, 'Asia/Kolkata', 'yyyy-MM-dd')",
"        : String(v || '').trim().slice(0, 10);",
"    };",
"    var today = String(todayISO || Utilities.formatDate(getISTDate(), 'Asia/Kolkata', 'yyyy-MM-dd')).slice(0, 10);",
"    var ws = getOrCreateTab(ss, TAB_ORDERS, ORDERS_HEADERS);",
"    var all = ws.getDataRange().getValues();",
"    var headers = all[0];",
"    var dateIdx = headers.indexOf('Order_Date');",
"    var stIdx = headers.indexOf('Payment_Status');",
"    var PAID = ['paid', 'wallet paid', 'collected'];",
"    var TERMINAL = ['cancelled', 'refunded'];",
"    var toArchive = [];",
"    var keep = [];",
"    var plan = {};",
"    for (var i = 1; i < all.length; i++) {",
"      var row = all[i];",
"      if (row.join('').trim() === '') continue;",
"      var dISO = fmtDate(row[dateIdx]);",
"      var st = String((stIdx !== -1 ? row[stIdx] : '') || '').trim().toLowerCase();",
"      var isTerminal = TERMINAL.some(function (t) { return st.indexOf(t) !== -1; });",
"      var isPaid = PAID.indexOf(st) !== -1;",
"      var archivable = (isPaid || isTerminal) && dISO;",
"      var dueInfo = archivable ? _archiveSliceDueDate(dISO) : null;",
"      if (archivable && dueInfo && today >= dueInfo.due) {",
"        toArchive.push(row);",
"        plan[dueInfo.monthKey] = (plan[dueInfo.monthKey] || 0) + 1;",
"      } else {",
"        keep.push(row);",
"      }",
"    }",
"    if (dryRun) return { success: true, dryRun: true, today: today, wouldArchive: toArchive.length, byMonth: plan,",
"      sids: toArchive.map(function (r) { return r[headers.indexOf('Submission_ID')]; }) };",
"    if (!toArchive.length) return { success: true, archived: 0, note: 'nothing due', today: today };",
"",
"    // Append per MONTH file (find-or-create — existing files are reused, never",
"    // duplicated), verifying each append BEFORE the live rebuild.",
"    var byMonth = {};",
"    toArchive.forEach(function (r) {",
"      var mk = fmtDate(r[dateIdx]).slice(0, 7);",
"      (byMonth[mk] = byMonth[mk] || []).push(r);",
"    });",
"    Object.keys(byMonth).forEach(function (mk) {",
"      var y = Number(mk.slice(0, 4)), m = Number(mk.slice(5, 7));",
"      var MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];",
"      var name = 'Svaadh Kitchen Archive — ' + MONTH_NAMES[m - 1] + ' ' + y;",
"      var aSS = _findOrCreateOrderArchiveSS(name);",
"      var aWs = aSS.getSheetByName('SK_Orders') || aSS.getSheets()[0];",
"      if (aWs.getLastRow() === 0) aWs.getRange(1, 1, 1, headers.length).setValues([headers]);",
"      var before = aWs.getLastRow();",
"      aWs.getRange(before + 1, 1, byMonth[mk].length, headers.length).setValues(byMonth[mk]);",
"      SpreadsheetApp.flush();",
"      if (aWs.getLastRow() - before !== byMonth[mk].length) throw new Error('Archive append verification failed for ' + name);",
"    });",
"",
"    // Single rebuild of the live sheet. Date-preserving write (see the 2026-08-25",
"    // archive incident: Dates must round-trip as Dates, never as strings).",
"    var allKeep = keep.filter(function (r) { return r.join('').trim() !== ''; });",
"    var lastRow = ws.getLastRow(), lastCol = ws.getLastColumn();",
"    var maxCol = Math.max(lastCol, headers.length);",
"    if (lastRow > 1) ws.getRange(2, 1, lastRow - 1, maxCol).clearContent();",
"    if (allKeep.length > 0) ws.getRange(2, 1, allKeep.length, headers.length).setValues(allKeep);",
"    var rowsNeeded = allKeep.length + 1;",
"    var totalRows = ws.getMaxRows();",
"    if (totalRows > rowsNeeded) ws.deleteRows(rowsNeeded + 1, totalRows - rowsNeeded);",
"    SpreadsheetApp.flush();",
"    var nowRows = ws.getLastRow() - 1;",
"    if (nowRows !== allKeep.length) return { success: false, error: 'Live rebuild verification failed', expected: allKeep.length, actual: nowRows };",
"",
"    try {",
"      var adminEmail = PropertiesService.getScriptProperties().getProperty('ADMIN_EMAIL');",
"      if (adminEmail) MailApp.sendEmail(adminEmail, '📦 Scheduled archive run (' + today + ')',",
"        'Archived ' + toArchive.length + ' row(s): ' + JSON.stringify(plan) + '. Live rows remaining: ' + nowRows);",
"    } catch (_) {}",
"    return { success: true, today: today, archived: toArchive.length, byMonth: plan, liveRemaining: nowRows };",
"  } finally {",
"    try { lock.releaseLock(); } catch (_) {}",
"  }",
"}",
"",
""].join("\n");
c = c.replace(anchor, newFns + anchor); n++;

// ── 2. Replace runScheduledArchive body ──
const oldRun = c.indexOf("function runScheduledArchive() {");
const oldRunEnd = c.indexOf("}", c.indexOf("Logger.log(\"Failed to send archive email: \" + e.message);")) + 1;
if (oldRun === -1 || oldRunEnd <= oldRun) { console.log("runScheduledArchive anchors MISS"); process.exit(1); }
const newRun = [
"function runScheduledArchive() {",
"  // DUE-SLICE POLICY (owner 2026-08-25): daily late-evening trigger; archives",
"  // every terminal row whose 10-day slice is due (18th / 28th / next-month 8th)",
"  // into its own month's archive file. Runs before due-date are no-ops; missed",
"  // runs self-heal. Previous behavior (archive whole previous month on the 10th)",
"  // replaced; archiveMonth() remains available as a manual tool.",
"  var result = archiveDueOrders(false);",
"  Logger.log(\"Scheduled archive result: \" + JSON.stringify(result));",
"  try {",
"    var sp = PropertiesService.getScriptProperties();",
"    var adminEmail = sp.getProperty(\"ADMIN_EMAIL\");",
"    if (adminEmail && result && result.success && result.archived > 0) {",
"      MailApp.sendEmail(adminEmail, \"📦 Scheduled archive run\", JSON.stringify(result, null, 2));",
"    }",
"  } catch (e) { Logger.log(\"Failed to send archive email: \" + e.message); }",
"}"
].join("\n");
c = c.slice(0, oldRun) + newRun + c.slice(oldRunEnd); n++;

// ── 3. Trigger: daily late evening (22:30 IST ≈ 17:00 UTC) ──
const trigA = "  // Fire on the 10th of every month at 21:00 UTC = 02:30 IST (safe off-peak window)\n  ScriptApp.newTrigger(\"runScheduledArchive\")\n    .timeBased()\n    .onMonthDay(10)\n    .atHour(21)\n    .create();";
const trigB = "  // DAILY late-evening window (17:00 UTC ≈ 22:30–23:30 IST). Runs before any\n  // slice's due date are no-ops, so a daily cadence is safe and self-healing.\n  ScriptApp.newTrigger(\"runScheduledArchive\")\n    .timeBased()\n    .everyDays(1)\n    .atHour(17)\n    .create();";
if (c.includes(trigA)) { c = c.replace(trigA, trigB); n++; } else console.log("trigger MISS");
const msgA = "  return \"Monthly archive trigger set (removed \" + removed + \" old trigger\" + (removed === 1 ? \"\" : \"s\")\n    + \") — fires on the 10th of every month at ~2 AM IST, running at HEAD (always your latest saved code). \"\n    + \"Check Triggers → this trigger should now show 'Head' instead of a pinned version number.\";";
const msgB = "  return \"Archive trigger set (removed \" + removed + \" old trigger\" + (removed === 1 ? \"\" : \"s\")\n    + \") — now fires DAILY ~22:30 IST (late evening). Due-slice policy: rows archive on the 18th / 28th / next-month 8th as they become due; earlier runs are no-ops. Running at HEAD (latest code).\";";
if (c.includes(msgA)) { c = c.replace(msgA, msgB); n++; } else console.log("trigger msg MISS");

fs.writeFileSync("04_Reports_Misc.gs", c);
console.log("applied " + n + "/4 edits");
