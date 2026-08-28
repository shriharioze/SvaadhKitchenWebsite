const fs = require('fs');
const filePath = '04_Reports_Misc.gs';
let content = fs.readFileSync(filePath, 'utf8');

const target = `  var matches = rows.filter(function(r) {
    const d = r.Order_Date instanceof Date ? Utilities.formatDate(r.Order_Date,"Asia/Kolkata","yyyy-MM-dd") : String(r.Order_Date).trim();
    return d === date && String(r.Phone||"").trim() === phone && (!sid || String(r.Submission_ID) === String(sid));
  });

  if (!matches.length) return {success: false, error: "No matching orders found"};`;

const replacement = `  var matches = rows.filter(function(r) {
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

// Normalize newlines for matching
const normContent = content.replace(/\r\n/g, '\n');
const normTarget = target.replace(/\r\n/g, '\n');

if (!normContent.includes(normTarget)) {
  console.log('Target not found in content');
  process.exit(1);
}

const updated = normContent.replace(normTarget, replacement.replace(/\r\n/g, '\n'));
fs.writeFileSync(filePath, updated, 'utf8');
console.log('Successfully updated markOrdersStatus in 04_Reports_Misc.gs');
