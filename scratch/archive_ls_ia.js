// ════════════════════════════════════════════════════════════════
// ARCHIVE LS + IA orders into the SAME monthly archive file as
// separate sheets (SK_Orders + LS_Orders + IA_Orders per month file).
// ════════════════════════════════════════════════════════════════
const fs = require("fs");

// ── 1. Modify archiveDueOrders to also scan LS_Orders + IA_Orders ──
let c = fs.readFileSync("04_Reports_Misc.gs", "utf8");

// Add LS + IA scanning after the SK scan, and archive into separate sheets
const oldAppend = `    // Append per MONTH file (find-or-create — existing files are reused, never
    // duplicated), verifying each append BEFORE the live rebuild.
    var byMonth = {};
    toArchive.forEach(function (r) {
      var mk = fmtDate(r[dateIdx]).slice(0, 7);
      (byMonth[mk] = byMonth[mk] || []).push(r);
    });
    Object.keys(byMonth).forEach(function (mk) {
      var y = Number(mk.slice(0, 4)), m = Number(mk.slice(5, 7));
      var MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      var name = 'Svaadh Kitchen Archive — ' + MONTH_NAMES[m - 1] + ' ' + y;
      var aSS = _findOrCreateOrderArchiveSS(name);
      var aWs = aSS.getSheetByName('SK_Orders') || aSS.getSheets()[0];
      if (aWs.getLastRow() === 0) aWs.getRange(1, 1, 1, headers.length).setValues([headers]);
      var before = aWs.getLastRow();
      aWs.getRange(before + 1, 1, byMonth[mk].length, headers.length).setValues(byMonth[mk]);
      SpreadsheetApp.flush();
      if (aWs.getLastRow() - before !== byMonth[mk].length) throw new Error('Archive append verification failed for ' + name);
    });`;

const newAppend = `    // Append per MONTH file (find-or-create — existing files are reused, never
    // duplicated), verifying each append BEFORE the live rebuild.
    // Each archive file has 3 sheets: SK_Orders, LS_Orders, IA_Orders.
    var byMonth = {};
    toArchive.forEach(function (r) {
      var mk = fmtDate(r[dateIdx]).slice(0, 7);
      (byMonth[mk] = byMonth[mk] || []).push(r);
    });
    Object.keys(byMonth).forEach(function (mk) {
      var y = Number(mk.slice(0, 4)), m = Number(mk.slice(5, 7));
      var MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      var name = 'Svaadh Kitchen Archive — ' + MONTH_NAMES[m - 1] + ' ' + y;
      var aSS = _findOrCreateOrderArchiveSS(name);
      // SK_Orders sheet
      var aWs = aSS.getSheetByName('SK_Orders') || aSS.getSheets()[0];
      if (aWs.getName() !== 'SK_Orders') aWs.setName('SK_Orders');
      if (aWs.getLastRow() === 0) aWs.getRange(1, 1, 1, headers.length).setValues([headers]);
      var before = aWs.getLastRow();
      aWs.getRange(before + 1, 1, byMonth[mk].length, headers.length).setValues(byMonth[mk]);
      SpreadsheetApp.flush();
      if (aWs.getLastRow() - before !== byMonth[mk].length) throw new Error('Archive append verification failed for ' + name);
      // LS_Orders sheet (if any LS rows are in this month's archive batch)
      var lsRows = byMonth[mk].filter(function (r) { return r._lsTab; });
      if (lsRows.length) {
        var lsWs = aSS.getSheetByName('LS_Orders');
        if (!lsWs) { lsWs = aSS.insertSheet('LS_Orders'); lsWs.getRange(1, 1, 1, headers.length).setValues([headers]); }
        var lsBefore = lsWs.getLastRow();
        lsWs.getRange(lsBefore + 1, 1, lsRows.length, headers.length).setValues(lsRows);
        SpreadsheetApp.flush();
        if (lsWs.getLastRow() - lsBefore !== lsRows.length) throw new Error('LS archive append verification failed for ' + name);
        // Remove LS rows from the SK sheet's batch (they were double-written)
        // Actually: SK sheet gets ALL rows (including LS) for simplicity —
        // the owner can filter by Source column. This avoids index juggling.
      }
    });
    // IA orders: scan + archive separately into the same month files
    try {
      if (typeof ia_rowsAsSK === 'function') {
        var iaRows = ia_rowsAsSK();
        var iaByMonth = {};
        iaRows.forEach(function (r) {
          if (_isOrderCancelled(r.Payment_Status)) return;
          var st = String(r.Payment_Status || '').trim().toLowerCase();
          if (PAID_FOR_ARCHIVE.indexOf(st) === -1) return;
          var dISO = fmtDate(r.Order_Date);
          if (!dISO) return;
          var dueInfo = _archiveSliceDueDate(dISO);
          if (today >= dueInfo.due) {
            var mk = dISO.slice(0, 7);
            (iaByMonth[mk] = iaByMonth[mk] || []).push(r);
          }
        });
        Object.keys(iaByMonth).forEach(function (mk) {
          var y = Number(mk.slice(0, 4)), m = Number(mk.slice(5, 7));
          var MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
          var name = 'Svaadh Kitchen Archive — ' + MONTH_NAMES[m - 1] + ' ' + y;
          var aSS = _findOrCreateOrderArchiveSS(name);
          var IA_HEADERS = (typeof IA_ORDERS_HEADERS !== 'undefined') ? IA_ORDERS_HEADERS : null;
          if (!IA_HEADERS) return; // IA headers not available — skip
          var iaWs = aSS.getSheetByName('IA_Orders');
          if (!iaWs) { iaWs = aSS.insertSheet('IA_Orders'); iaWs.getRange(1, 1, 1, IA_HEADERS.length).setValues([IA_HEADERS]); }
          var iaBefore = iaWs.getLastRow();
          // Convert IA row objects to arrays matching IA_HEADERS
          var iaArrays = iaByMonth[mk].map(function (r) {
            return IA_HEADERS.map(function (h) { return r[h] !== undefined ? r[h] : ''; });
          });
          iaWs.getRange(iaBefore + 1, 1, iaArrays.length, IA_HEADERS.length).setValues(iaArrays);
          SpreadsheetApp.flush();
          if (iaWs.getLastRow() - iaBefore !== iaArrays.length) throw new Error('IA archive append verification failed for ' + name);
          plan[mk + ' (IA)'] = iaByMonth[mk].length;
        });
      }
    } catch (eIA) {
      Logger.log('IA archive: ' + eIA.message);
    }`;

if (c.includes(oldAppend)) { c = c.replace(oldAppend, newAppend); console.log("archiveDueOrders LS+IA ✓"); }
else { console.log("MISS archiveDueOrders append block"); process.exit(1); }

fs.writeFileSync("04_Reports_Misc.gs", c);

// ── 2. Also scan LS_Orders for due rows in the main scan loop ──
// Currently archiveDueOrders only scans SK_Orders. Need to add LS rows.
let c2 = fs.readFileSync("04_Reports_Misc.gs", "utf8");
const oldScan = `    var ws = getOrCreateTab(ss, TAB_ORDERS, ORDERS_HEADERS);
    var all = ws.getDataRange().getValues();
    var headers = all[0];
    var dateIdx = headers.indexOf('Order_Date');
    var stIdx = headers.indexOf('Payment_Status');
    var PAID = ['paid', 'wallet paid', 'collected'];
    var TERMINAL = ['cancelled', 'refunded'];
    var toArchive = [];
    var keep = [];
    var plan = {};
    for (var i = 1; i < all.length; i++) {
      var row = all[i];
      if (row.join('').trim() === '') continue;
      var dISO = fmtDate(row[dateIdx]);
      var st = String((stIdx !== -1 ? row[stIdx] : '') || '').trim().toLowerCase();
      var isTerminal = TERMINAL.some(function (t) { return st.indexOf(t) !== -1; });
      var isPaid = PAID.indexOf(st) !== -1;
      var archivable = (isPaid || isTerminal) && dISO;
      var dueInfo = archivable ? _archiveSliceDueDate(dISO) : null;
      if (archivable && dueInfo && today >= dueInfo.due) {
        toArchive.push(row);
        plan[dueInfo.monthKey] = (plan[dueInfo.monthKey] || 0) + 1;
      } else {
        keep.push(row);
      }
    }`;

const newScan = `    var ws = getOrCreateTab(ss, TAB_ORDERS, ORDERS_HEADERS);
    var all = ws.getDataRange().getValues();
    var headers = all[0];
    var dateIdx = headers.indexOf('Order_Date');
    var stIdx = headers.indexOf('Payment_Status');
    var PAID = ['paid', 'wallet paid', 'collected'];
    var TERMINAL = ['cancelled', 'refunded'];
    var toArchive = [];
    var keep = [];
    var keepSK = [];  // SK-only rows for the rebuild (LS rows are rebuilt separately)
    var plan = {};
    var lsAll = [];   // LS live rows (for the LS rebuild)
    var lsToArchive = [];
    var lsKeep = [];
    // Scan SK_Orders
    for (var i = 1; i < all.length; i++) {
      var row = all[i];
      if (row.join('').trim() === '') continue;
      var dISO = fmtDate(row[dateIdx]);
      var st = String((stIdx !== -1 ? row[stIdx] : '') || '').trim().toLowerCase();
      var isTerminal = TERMINAL.some(function (t) { return st.indexOf(t) !== -1; });
      var isPaid = PAID.indexOf(st) !== -1;
      var archivable = (isPaid || isTerminal) && dISO;
      var dueInfo = archivable ? _archiveSliceDueDate(dISO) : null;
      if (archivable && dueInfo && today >= dueInfo.due) {
        toArchive.push(row);
        plan[dueInfo.monthKey] = (plan[dueInfo.monthKey] || 0) + 1;
      } else {
        keep.push(row);
        keepSK.push(row);
      }
    }
    // Scan LS_Orders (if tab exists)
    try {
      var lsWsLive = ss.getSheetByName(TAB_LS_ORDERS);
      if (lsWsLive && lsWsLive.getLastRow() > 1) {
        var lsData = lsWsLive.getDataRange().getValues();
        var lsHeaders = lsData[0];
        var lsDateIdx = lsHeaders.indexOf('Order_Date');
        var lsStIdx = lsHeaders.indexOf('Payment_Status');
        for (var li = 1; li < lsData.length; li++) {
          var lsRow = lsData[li];
          if (lsRow.join('').trim() === '') continue;
          var lsD = fmtDate(lsRow[lsDateIdx]);
          var lsSt = String((lsStIdx !== -1 ? lsRow[lsStIdx] : '') || '').trim().toLowerCase();
          var lsTerminal = TERMINAL.some(function (t) { return lsSt.indexOf(t) !== -1; });
          var lsPaid = PAID.indexOf(lsSt) !== -1;
          var lsArch = (lsPaid || lsTerminal) && lsD;
          var lsDue = lsArch ? _archiveSliceDueDate(lsD) : null;
          if (lsArch && lsDue && today >= lsDue.due) {
            toArchive.push(lsRow);
            lsToArchive.push(lsRow);
            plan[lsDue.monthKey + ' (LS)'] = (plan[lsDue.monthKey + ' (LS)'] || 0) + 1;
          } else {
            lsKeep.push(lsRow);
          }
          lsAll.push(lsRow);
        }
      }
    } catch (eLS) { /* LS tab absent */ }`;

if (c2.includes(oldScan)) { c2 = c2.replace(oldScan, newScan); console.log("scan LS rows ✓"); }
else { console.log("MISS scan block"); process.exit(1); }

// Update the rebuild to use keepSK (SK only) + rebuild LS separately
const oldRebuild = `    // Single rebuild of the live sheet. Date-preserving write (see the 2026-08-25
    // archive incident: Dates must round-trip as Dates, never as strings).
    var allKeep = keep.filter(function (r) { return r.join('').trim() !== ''; });
    var lastRow = ws.getLastRow(), lastCol = ws.getLastColumn();
    var maxCol = Math.max(lastCol, headers.length);
    if (lastRow > 1) ws.getRange(2, 1, lastRow - 1, maxCol).clearContent();
    if (allKeep.length > 0) ws.getRange(2, 1, allKeep.length, headers.length).setValues(allKeep);
    var rowsNeeded = allKeep.length + 1;
    var totalRows = ws.getMaxRows();
    if (totalRows > rowsNeeded) ws.deleteRows(rowsNeeded + 1, totalRows - rowsNeeded);
    SpreadsheetApp.flush();
    var nowRows = ws.getLastRow() - 1;
    if (nowRows !== allKeep.length) return { success: false, error: 'Live rebuild verification failed', expected: allKeep.length, actual: nowRows };`;

const newRebuild = `    // Single rebuild of the live SK sheet. Date-preserving write.
    var allKeep = keep.filter(function (r) { return r.join('').trim() !== ''; });
    var lastRow = ws.getLastRow(), lastCol = ws.getLastColumn();
    var maxCol = Math.max(lastCol, headers.length);
    if (lastRow > 1) ws.getRange(2, 1, lastRow - 1, maxCol).clearContent();
    if (allKeep.length > 0) ws.getRange(2, 1, allKeep.length, headers.length).setValues(allKeep);
    var rowsNeeded = allKeep.length + 1;
    var totalRows = ws.getMaxRows();
    if (totalRows > rowsNeeded) ws.deleteRows(rowsNeeded + 1, totalRows - rowsNeeded);
    SpreadsheetApp.flush();
    var nowRows = ws.getLastRow() - 1;
    if (nowRows !== allKeep.length) return { success: false, error: 'SK rebuild verification failed', expected: allKeep.length, actual: nowRows };
    // Rebuild live LS sheet (remove archived LS rows)
    if (lsToArchive.length > 0) {
      var lsWsLive2 = ss.getSheetByName(TAB_LS_ORDERS);
      if (lsWsLive2) {
        var lsKeepArr = lsKeep.filter(function (r) { return r.join('').trim() !== ''; });
        var lsLastRow = lsWsLive2.getLastRow(), lsLastCol = lsWsLive2.getLastColumn();
        var lsMaxCol = Math.max(lsLastCol, headers.length);
        if (lsLastRow > 1) lsWsLive2.getRange(2, 1, lsLastRow - 1, lsMaxCol).clearContent();
        if (lsKeepArr.length > 0) lsWsLive2.getRange(2, 1, lsKeepArr.length, headers.length).setValues(lsKeepArr);
        var lsRowsNeeded = lsKeepArr.length + 1;
        var lsTotalRows = lsWsLive2.getMaxRows();
        if (lsTotalRows > lsRowsNeeded) lsWsLive2.deleteRows(lsRowsNeeded + 1, lsTotalRows - lsRowsNeeded);
        SpreadsheetApp.flush();
      }
    }`;

if (c2.includes(oldRebuild)) { c2 = c2.replace(oldRebuild, newRebuild); console.log("rebuild LS ✓"); }
else { console.log("MISS rebuild block"); process.exit(1); }

// Fix the archive append: SK gets only non-LS rows, LS gets only LS rows
const oldByMonth = `    var byMonth = {};
    toArchive.forEach(function (r) {
      var mk = fmtDate(r[dateIdx]).slice(0, 7);
      (byMonth[mk] = byMonth[mk] || []).push(r);
    });`;
const newByMonth = `    var byMonth = {};    // SK rows per month
    var byMonthLS = {};  // LS rows per month
    toArchive.forEach(function (r) {
      var mk = fmtDate(r[dateIdx]).slice(0, 7);
      var isLS = lsToArchive.some(function (lr) { return lr === r; });
      if (isLS) { (byMonthLS[mk] = byMonthLS[mk] || []).push(r); }
      else { (byMonth[mk] = byMonth[mk] || []).push(r); }
    });`;

if (c2.includes(oldByMonth)) { c2 = c2.replace(oldByMonth, newByMonth); console.log("byMonth split ✓"); }
else { console.log("MISS byMonth split"); process.exit(1); }

// Update the archive append to write LS rows to LS_Orders sheet
const oldAppend2 = `      // LS_Orders sheet (if any LS rows are in this month's archive batch)
      var lsRows = byMonth[mk].filter(function (r) { return r._lsTab; });
      if (lsRows.length) {
        var lsWs = aSS.getSheetByName('LS_Orders');
        if (!lsWs) { lsWs = aSS.insertSheet('LS_Orders'); lsWs.getRange(1, 1, 1, headers.length).setValues([headers]); }
        var lsBefore = lsWs.getLastRow();
        lsWs.getRange(lsBefore + 1, 1, lsRows.length, headers.length).setValues(lsRows);
        SpreadsheetApp.flush();
        if (lsWs.getLastRow() - lsBefore !== lsRows.length) throw new Error('LS archive append verification failed for ' + name);
        // Remove LS rows from the SK sheet's batch (they were double-written)
        // Actually: SK sheet gets ALL rows (including LS) for simplicity —
        // the owner can filter by Source column. This avoids index juggling.
      }`;
const newAppend2 = `      // LS_Orders sheet (append LS rows to their own sheet in the archive file)
      var lsRowsForMonth = byMonthLS[mk] || [];
      if (lsRowsForMonth.length) {
        var lsWsA = aSS.getSheetByName('LS_Orders');
        if (!lsWsA) { lsWsA = aSS.insertSheet('LS_Orders'); lsWsA.getRange(1, 1, 1, headers.length).setValues([headers]); }
        var lsB = lsWsA.getLastRow();
        lsWsA.getRange(lsB + 1, 1, lsRowsForMonth.length, headers.length).setValues(lsRowsForMonth);
        SpreadsheetApp.flush();
        if (lsWsA.getLastRow() - lsB !== lsRowsForMonth.length) throw new Error('LS archive append verification failed for ' + name);
      }`;

if (c2.includes(oldAppend2)) { c2 = c2.replace(oldAppend2, newAppend2); console.log("archive append LS sheet ✓"); }
else { console.log("MISS archive append LS sheet"); process.exit(1); }

fs.writeFileSync("04_Reports_Misc.gs", c2);
console.log("04_Reports_Misc.gs saved");
