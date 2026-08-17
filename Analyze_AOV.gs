function runAOVAnalysis() {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var ordersWs = ss.getSheetByName("SK_Orders");
    var liveData = ordersWs.getDataRange().getValues();
    
    // Also try to get archive data
    var archiveId = PropertiesService.getScriptProperties().getProperty("ARCHIVE_SPREADSHEET_ID");
    var archiveData = [];
    if (archiveId) {
      try {
        var archiveSS = SpreadsheetApp.openById(archiveId);
        var archiveWs = archiveSS.getSheetByName("SK_Orders");
        if (archiveWs) {
          archiveData = archiveWs.getDataRange().getValues();
          if (archiveData.length > 1) {
            archiveData.shift(); // remove headers
          }
        }
      } catch (e) {
        Logger.log("Could not read archive: " + e.message);
      }
    }
    
    var headers = liveData[0];
    var data = liveData.slice(1).concat(archiveData);
    
    var dateIdx = headers.indexOf("Order_Date");
    var netIdx = headers.indexOf("Net_Total");
    var statusIdx = headers.indexOf("Payment_Status");
    var societyIdx = headers.indexOf("Society");
    
    var monthlyStats = {};
    
    for (var i = 0; i < data.length; i++) {
      var r = data[i];
      if (!r[dateIdx]) continue;
      
      var d = r[dateIdx];
      var dateStr = "";
      if (d instanceof Date) {
        if (isNaN(d.getTime())) continue;
        dateStr = Utilities.formatDate(d, "Asia/Kolkata", "yyyy-MM");
      } else {
        dateStr = String(d).slice(0, 7);
      }
      
      // Skip cancelled
      var status = String(r[statusIdx]).toLowerCase();
      if (status.indexOf("cancel") !== -1 || status.indexOf("fail") !== -1) continue;
      
      var net = Number(r[netIdx]) || 0;
      if (net <= 0) continue;
      
      var soc = String(r[societyIdx]).toLowerCase();
      var isBhosale = (soc.indexOf("bhosale") !== -1 || soc.indexOf("triveni") !== -1 || soc.indexOf("self") !== -1);
      
      if (!monthlyStats[dateStr]) {
        monthlyStats[dateStr] = {
          totalOrders: 0,
          totalRevenue: 0,
          premiumOrders: 0, // > 150
          smallOrders: 0, // < 100
          bhosaleOrders: 0,
          otherOrders: 0
        };
      }
      
      var m = monthlyStats[dateStr];
      m.totalOrders++;
      m.totalRevenue += net;
      if (net >= 150) m.premiumOrders++;
      if (net < 100) m.smallOrders++;
      
      if (isBhosale) m.bhosaleOrders++;
      else m.otherOrders++;
    }
    
    // Format output
    var results = [];
    for (var k in monthlyStats) {
      var m = monthlyStats[k];
      m.aov = m.totalOrders > 0 ? (m.totalRevenue / m.totalOrders).toFixed(2) : 0;
      m.smallOrderPct = m.totalOrders > 0 ? ((m.smallOrders / m.totalOrders) * 100).toFixed(1) + "%" : "0%";
      results.push({month: k, stats: m});
    }
    
    results.sort(function(a,b) { return a.month > b.month ? 1 : -1; });
    
    Logger.log(JSON.stringify(results, null, 2));
    
  } catch (err) {
    Logger.log("ERROR: " + err.message);
  }
}
