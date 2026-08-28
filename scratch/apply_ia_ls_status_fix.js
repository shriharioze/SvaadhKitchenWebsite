const fs = require('fs');
const filePath = '04_Reports_Misc.gs';
let content = fs.readFileSync(filePath, 'utf8');

// 1. Update markOrdersStatus
const markOrdersTarget = `  var ss    = getSpreadsheet();
  var ws    = getOrCreateTab(ss, TAB_ORDERS, ORDERS_HEADERS);
  // Status ops must find orders from EITHER storefront. Each combined row
  // carries _ws so every write lands in the row's OWN tab.
  var rows  = _getAllOrdersBothTabsIfPresent(ss);
  var _wsOf = function (x) { return x._ws || ws; };
  var _hOf  = function (x) { return headerIndex(_wsOf(x)); };
  
  var matches = rows.filter(function(r) {
    var rSid = String(r.Submission_ID || r.Order_ID || "").trim();
    var rPhone = _normPhone(r.Phone);
    var rDate = _normDate(r.Order_Date);
    if (targetSid && rSid && targetSid === rSid) return true;
    return rDate === targetDate && rPhone === targetPhone && (!targetSid || !rSid || rSid === targetSid);
  });

  // Fallback: If not found in live sheets, check archived spreadsheets
  if (!matches.length && typeof _listArchiveFilesInRange === "function") {
    try {
      var archiveFiles = _listArchiveFilesInRange(targetDate, targetDate);
      if (archiveFiles.length > 0) {
        for (var af = 0; af < archiveFiles.length; af++) {
          var aMeta = archiveFiles[af];
          var aSS = SpreadsheetApp.openById(aMeta.file.getId());
          var aTabs = ["SK_Orders", "LS_Orders"];
          var aUpdated = 0;
          for (var ti = 0; ti < aTabs.length; ti++) {
            var aWs = aSS.getSheetByName(aTabs[ti]);
            if (!aWs) continue;
            var aRows = getAllRows(aWs);
            var aH = headerIndex(aWs);
            if (!aH["Payment_Status"]) continue;
            var aMatches = aRows.filter(function(r) {
              var rSid = String(r.Submission_ID || r.Order_ID || "").trim();
              var rPhone = _normPhone(r.Phone);
              var rDate = _normDate(r.Order_Date);
              if (targetSid && rSid && targetSid === rSid) return true;
              return rDate === targetDate && rPhone === targetPhone && (!targetSid || !rSid || rSid === targetSid);
            });
            if (aMatches.length > 0) {
              aMatches.forEach(function(r) {
                aWs.getRange(r._row, aH["Payment_Status"]).setValue(status);
                aUpdated++;
              });
            }
          }
          if (aUpdated > 0) {
            try { SpreadsheetApp.flush(); } catch(_) {}
            try { CacheService.getScriptCache().remove("arch_orders_" + aMeta.file.getId()); } catch(_) {}
            return {success: true, updatedRows: aUpdated, inArchive: true};
          }
        }
      }
    } catch(eArch) {
      Logger.log("markOrdersStatus archive search error: " + eArch.message);
    }
  }

  if (!matches.length) return {success: false, error: "No matching orders found"};`;

const markOrdersReplacement = `  var ss    = getSpreadsheet();
  var ws    = getOrCreateTab(ss, TAB_ORDERS, ORDERS_HEADERS);
  var _wsOf = function (x) { return x._ws || ws; };
  var _hOf  = function (x) { return headerIndex(_wsOf(x)); };
  
  // Status ops must find orders from ALL storefronts & corporate channels:
  // SK_Orders (main site), LS_Orders (Liviano-Serio), and IA_Orders (IntentAmplify).
  var rows = [];
  try {
    var skWs = getOrCreateTab(ss, TAB_ORDERS, ORDERS_HEADERS);
    getAllRows(skWs).forEach(function(r) { r._ws = skWs; r._tabName = "SK_Orders"; rows.push(r); });
  } catch(_) {}
  try {
    var lsWs = ss.getSheetByName(TAB_LS_ORDERS);
    if (lsWs) getAllRows(lsWs).forEach(function(r) { r._ws = lsWs; r._tabName = "LS_Orders"; rows.push(r); });
  } catch(_) {}
  try {
    var iaWs = ss.getSheetByName("IA_Orders");
    if (iaWs) {
      var iaRows = (typeof ia_rows === "function") ? ia_rows(iaWs) : getAllRows(iaWs);
      iaRows.forEach(function(r) {
        r._ws = iaWs;
        r._tabName = "IA_Orders";
        r.Order_Date = r.Date || r.Order_Date;
        r.Meal_Type = r.Meal || r.Meal_Type;
        rows.push(r);
      });
    }
  } catch(_) {}

  var matches = rows.filter(function(r) {
    var rSid = String(r.Submission_ID || r.Order_ID || "").trim();
    var rPhone = _normPhone(r.Phone);
    var rDate = _normDate(r.Order_Date || r.Date);
    if (targetSid && rSid && targetSid === rSid) return true;
    return rDate === targetDate && rPhone === targetPhone && (!targetSid || !rSid || rSid === targetSid);
  });

  // Fallback: If not found in live sheets, check archived spreadsheets (SK_Orders, LS_Orders, IA_Orders)
  if (!matches.length && typeof _listArchiveFilesInRange === "function") {
    try {
      var archiveFiles = _listArchiveFilesInRange(targetDate, targetDate);
      if (archiveFiles.length > 0) {
        for (var af = 0; af < archiveFiles.length; af++) {
          var aMeta = archiveFiles[af];
          var aSS = SpreadsheetApp.openById(aMeta.file.getId());
          var aTabs = ["SK_Orders", "LS_Orders", "IA_Orders"];
          var aUpdated = 0;
          for (var ti = 0; ti < aTabs.length; ti++) {
            var aWs = aSS.getSheetByName(aTabs[ti]);
            if (!aWs) continue;
            var aRows = (aTabs[ti] === "IA_Orders" && typeof ia_rows === "function") ? ia_rows(aWs) : getAllRows(aWs);
            var aH = headerIndex(aWs);
            if (!aH["Payment_Status"]) continue;
            var aMatches = aRows.filter(function(r) {
              var rSid = String(r.Submission_ID || r.Order_ID || "").trim();
              var rPhone = _normPhone(r.Phone);
              var rDate = _normDate(r.Order_Date || r.Date);
              if (targetSid && rSid && targetSid === rSid) return true;
              return rDate === targetDate && rPhone === targetPhone && (!targetSid || !rSid || rSid === targetSid);
            });
            if (aMatches.length > 0) {
              aMatches.forEach(function(r) {
                aWs.getRange(r._row, aH["Payment_Status"]).setValue(status);
                if (aTabs[ti] === "IA_Orders") {
                  if (aH["Approved_By"] && !r.Approved_By) aWs.getRange(r._row, aH["Approved_By"]).setValue("Admin");
                  if (aH["Approved_At"] && !r.Approved_At) aWs.getRange(r._row, aH["Approved_At"]).setValue(getISTDate());
                }
                aUpdated++;
              });
            }
          }
          if (aUpdated > 0) {
            try { SpreadsheetApp.flush(); } catch(_) {}
            try { CacheService.getScriptCache().remove("arch_orders_" + aMeta.file.getId()); } catch(_) {}
            return {success: true, updatedRows: aUpdated, inArchive: true};
          }
        }
      }
    } catch(eArch) {
      Logger.log("markOrdersStatus archive search error: " + eArch.message);
    }
  }

  if (!matches.length) return {success: false, error: "No matching orders found"};`;

// 2. Update standard status writing inside matches.forEach
const approvalTarget = `      // ── Standard Payment Approval or Rejection
      const rH = _hOf(r), rWs = _wsOf(r);
      rWs.getRange(r._row, rH["Payment_Status"]).setValue(status);`;

const approvalReplacement = `      // ── Standard Payment Approval or Rejection
      const rH = _hOf(r), rWs = _wsOf(r);
      if (rH["Payment_Status"]) {
        rWs.getRange(r._row, rH["Payment_Status"]).setValue(status);
      }
      if (r._tabName === "IA_Orders") {
        if (rH["Approved_By"] && !r.Approved_By) rWs.getRange(r._row, rH["Approved_By"]).setValue("Admin");
        if (rH["Approved_At"] && !r.Approved_At) rWs.getRange(r._row, rH["Approved_At"]).setValue(now);
      }`;

// 3. Update _readArchivedOrdersInRange to read SK, LS, and IA tabs from archive files
const readArchTarget = `    if (!rows) {
      try {
        var aSS = SpreadsheetApp.openById(meta.file.getId());
        var sheet = aSS.getSheetByName("SK_Orders");
        if (!sheet) return;
        var data = sheet.getDataRange().getValues();
        if (data.length < 2) return;
        var headers = data[0];
        rows = [];
        for (var r = 1; r < data.length; r++) {
          var obj = {};
          for (var c = 0; c < headers.length; c++) obj[headers[c]] = data[r][c];
          rows.push(obj);
        }
        try {
          var serialised = JSON.stringify(rows);
          if (serialised.length <= 95 * 1024) cache.put(cacheKey, serialised, 600);
        } catch(_) {}
      } catch (e) {
        Logger.log("_readArchivedOrdersInRange: could not read " + meta.file.getName() + ": " + e.message);
        return;
      }
    }`;

const readArchReplacement = `    if (!rows) {
      try {
        var aSS = SpreadsheetApp.openById(meta.file.getId());
        rows = [];
        // 1. SK_Orders
        var skSheet = aSS.getSheetByName("SK_Orders") || aSS.getSheets()[0];
        if (skSheet) {
          var skData = skSheet.getDataRange().getValues();
          if (skData.length >= 2) {
            var skHeaders = skData[0];
            for (var skr = 1; skr < skData.length; skr++) {
              var skObj = {};
              for (var skc = 0; skc < skHeaders.length; skc++) skObj[skHeaders[skc]] = skData[skr][skc];
              rows.push(skObj);
            }
          }
        }
        // 2. LS_Orders
        var lsSheet = aSS.getSheetByName("LS_Orders");
        if (lsSheet) {
          var lsData = lsSheet.getDataRange().getValues();
          if (lsData.length >= 2) {
            var lsHeaders = lsData[0];
            for (var lsr = 1; lsr < lsData.length; lsr++) {
              var lsObj = { _lsTab: true };
              for (var lsc = 0; lsc < lsHeaders.length; lsc++) lsObj[lsHeaders[lsc]] = lsData[lsr][lsc];
              rows.push(lsObj);
            }
          }
        }
        // 3. IA_Orders
        var iaSheet = aSS.getSheetByName("IA_Orders");
        if (iaSheet) {
          var iaData = iaSheet.getDataRange().getValues();
          if (iaData.length >= 2) {
            var iaHeaders = iaData[0];
            for (var iar = 1; iar < iaData.length; iar++) {
              var iaObj = { _iaTab: true };
              for (var iac = 0; iac < iaHeaders.length; iac++) iaObj[iaHeaders[iac]] = iaData[iar][iac];
              iaObj.Order_Date = iaObj.Date || iaObj.Order_Date;
              iaObj.Meal_Type = iaObj.Meal || iaObj.Meal_Type;
              iaObj.Net_Total = Number(iaObj.Subtotal) || Number(iaObj.Net_Total) || 0;
              iaObj.Food_Subtotal = Number(iaObj.Subtotal) || Number(iaObj.Food_Subtotal) || 0;
              if (iaObj.Customer_Name && !String(iaObj.Customer_Name).startsWith("[IA]")) {
                iaObj.Customer_Name = "[IA] " + iaObj.Customer_Name;
              }
              rows.push(iaObj);
            }
          }
        }
        try {
          var serialised = JSON.stringify(rows);
          if (serialised.length <= 95 * 1024) cache.put(cacheKey, serialised, 600);
        } catch(_) {}
      } catch (e) {
        Logger.log("_readArchivedOrdersInRange: could not read " + meta.file.getName() + ": " + e.message);
        return;
      }
    }`;

let normContent = content.replace(/\r\n/g, '\n');
let normMarkTarget = markOrdersTarget.replace(/\r\n/g, '\n');
let normApprovalTarget = approvalTarget.replace(/\r\n/g, '\n');
let normReadArchTarget = readArchTarget.replace(/\r\n/g, '\n');

if (!normContent.includes(normMarkTarget)) {
  console.error('markOrdersTarget not found');
  process.exit(1);
}
normContent = normContent.replace(normMarkTarget, markOrdersReplacement.replace(/\r\n/g, '\n'));

if (!normContent.includes(normApprovalTarget)) {
  console.error('approvalTarget not found');
  process.exit(1);
}
normContent = normContent.replace(normApprovalTarget, approvalReplacement.replace(/\r\n/g, '\n'));

if (!normContent.includes(normReadArchTarget)) {
  console.error('readArchTarget not found');
  process.exit(1);
}
normContent = normContent.replace(normReadArchTarget, readArchReplacement.replace(/\r\n/g, '\n'));

fs.writeFileSync(filePath, normContent, 'utf8');
console.log('Successfully updated 04_Reports_Misc.gs for IA & LS order settlement and archive support');
