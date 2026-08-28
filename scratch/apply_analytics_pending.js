const fs = require('fs');

// 1. Update 04_Reports_Misc.gs
let code04 = fs.readFileSync('04_Reports_Misc.gs', 'utf8');

const target04 = `  var totalRev=0, totalPaid=0, totalDelivery=0, totalSmallFee=0;
  var custSet={}, dayMap={};
  var mealStats={Breakfast:{count:0,revenue:0},Lunch:{count:0,revenue:0},Dinner:{count:0,revenue:0}};
  var itemCounts={};
  rows.forEach(function(r) {
    var d=fmtDate(r.Order_Date), net=Number(r.Net_Total)||0;
    var delivery=Number(r.Delivery_Charge)||0;
    // NOTE: market surcharge is obsolete (removed at the PRICING_V2 go-live) — no longer
    // reported. The Inflation_Surcharge column is now only the loyalty-streak accrual and
    // is read solely by the loyalty engine, NOT summed here.
    // Small_Order_Fee: exact backfill using Option B (checks VIP, pickup, day threshold)
    var smallFee = calcSmallFee(r);
    var payStatus = String(r.Payment_Status || "").trim();
    totalRev+=net;
    totalDelivery+=delivery; totalSmallFee+=smallFee;
    if(payStatus==="Paid"||payStatus==="Wallet Paid"||payStatus==="Collected") totalPaid+=net;
    var ph=String(r.Phone||"").trim(); if(ph) custSet[ph]=true;
    var meal=String(r.Meal_Type||"");
    if(mealStats[meal]){mealStats[meal].count++;mealStats[meal].revenue+=net;}
    if(!dayMap[d]) dayMap[d]={orders:0,revenue:0,delivery:0,smallFee:0};
    dayMap[d].orders++; dayMap[d].revenue+=net;
    dayMap[d].delivery+=delivery; dayMap[d].smallFee+=smallFee;
    if(meal==="Breakfast"){
      for(var n=1;n<=4;n++){var bi=String(r["BF_Item_"+n]||"").trim(),bq=Number(r["BF_Qty_"+n])||0;if(bi&&bq>0)itemCounts[bi]=(itemCounts[bi]||0)+bq;}
      var cu=Number(r.Curd)||0; if(cu>0)itemCounts["Curd"]=(itemCounts["Curd"]||0)+cu;
    } else {
      LUNCH_COLS.forEach(function(col){var q=Number(r[col])||0;if(q>0){var dn=COL_DISP[col]||col;itemCounts[dn]=(itemCounts[dn]||0)+q;}});
    }
  });
  Object.keys(mealStats).forEach(function(m){mealStats[m].revenue=Math.round(mealStats[m].revenue);});
  return {
    rows: rows, dayMap: dayMap, custSet: custSet, mealStats: mealStats, itemCounts: itemCounts,
    totalRev: totalRev, totalPaid: totalPaid, totalDelivery: totalDelivery,
    totalSmallFee: totalSmallFee, archivedCount: archivedCount
  };`;

const replace04 = `  var totalRev=0, totalPaid=0, totalDelivery=0, totalSmallFee=0;
  var custSet={}, dayMap={};
  var mealStats={Breakfast:{count:0,revenue:0},Lunch:{count:0,revenue:0},Dinner:{count:0,revenue:0}};
  var itemCounts={};
  var pendingMap={};
  rows.forEach(function(r) {
    var d=fmtDate(r.Order_Date), net=Number(r.Net_Total)||0;
    var delivery=Number(r.Delivery_Charge)||0;
    // NOTE: market surcharge is obsolete (removed at the PRICING_V2 go-live) — no longer
    // reported. The Inflation_Surcharge column is now only the loyalty-streak accrual and
    // is read solely by the loyalty engine, NOT summed here.
    // Small_Order_Fee: exact backfill using Option B (checks VIP, pickup, day threshold)
    var smallFee = calcSmallFee(r);
    var payStatus = String(r.Payment_Status || "").trim();
    totalRev+=net;
    totalDelivery+=delivery; totalSmallFee+=smallFee;
    var isPaid = (payStatus==="Paid"||payStatus==="Wallet Paid"||payStatus==="Collected");
    if(isPaid) {
      totalPaid+=net;
    } else {
      var ph = String(r.Phone||"").trim();
      var cName = String(r.Customer_Name||"Customer").trim();
      var sid = String(r.Submission_ID || r.Order_ID || "").trim();
      var meal = String(r.Meal_Type||"").trim();
      var summaryText = "";
      try {
        if (typeof _buildSummary === "function") {
          summaryText = _buildSummary(r);
        }
      } catch(_) {}
      if (!summaryText || summaryText === "—") {
        if (meal === "Breakfast") {
          var bfItems = [];
          for (var n = 1; n <= 4; n++) {
            var bi = String(r["BF_Item_" + n] || "").trim(), bq = Number(r["BF_Qty_" + n]) || 0;
            if (bi && bq > 0) bfItems.push(bq + "×" + bi);
          }
          if (Number(r.Curd) > 0) bfItems.push(Number(r.Curd) + "×Curd");
          summaryText = bfItems.join(", ");
        }
      }
      if (!pendingMap[ph]) {
        pendingMap[ph] = {
          phone: ph,
          name: cName,
          totalPending: 0,
          orders: []
        };
      }
      pendingMap[ph].totalPending += net;
      pendingMap[ph].orders.push({
        sid: sid,
        date: d,
        meal: meal,
        amount: net,
        status: payStatus || "Pending",
        summary: summaryText,
        isLS: !!r._lsTab
      });
    }
    var ph=String(r.Phone||"").trim(); if(ph) custSet[ph]=true;
    var meal=String(r.Meal_Type||"");
    if(mealStats[meal]){mealStats[meal].count++;mealStats[meal].revenue+=net;}
    if(!dayMap[d]) dayMap[d]={orders:0,revenue:0,delivery:0,smallFee:0};
    dayMap[d].orders++; dayMap[d].revenue+=net;
    dayMap[d].delivery+=delivery; dayMap[d].smallFee+=smallFee;
    if(meal==="Breakfast"){
      for(var n=1;n<=4;n++){var bi=String(r["BF_Item_"+n]||"").trim(),bq=Number(r["BF_Qty_"+n])||0;if(bi&&bq>0)itemCounts[bi]=(itemCounts[bi]||0)+bq;}
      var cu=Number(r.Curd)||0; if(cu>0)itemCounts["Curd"]=(itemCounts["Curd"]||0)+cu;
    } else {
      LUNCH_COLS.forEach(function(col){var q=Number(r[col])||0;if(q>0){var dn=COL_DISP[col]||col;itemCounts[dn]=(itemCounts[dn]||0)+q;}});
    }
  });
  Object.keys(mealStats).forEach(function(m){mealStats[m].revenue=Math.round(mealStats[m].revenue);});
  var pendingCustomers = Object.keys(pendingMap).map(function(ph) {
    var c = pendingMap[ph];
    c.totalPending = Math.round(c.totalPending);
    c.orders.sort(function(a, b) { return b.date.localeCompare(a.date); });
    return c;
  }).sort(function(a, b) {
    return b.totalPending - a.totalPending;
  });
  return {
    rows: rows, dayMap: dayMap, custSet: custSet, mealStats: mealStats, itemCounts: itemCounts,
    totalRev: totalRev, totalPaid: totalPaid, totalDelivery: totalDelivery,
    totalSmallFee: totalSmallFee, archivedCount: archivedCount,
    pendingCustomers: pendingCustomers
  };`;

// Update _analyticsCore
if (code04.includes(target04)) {
  code04 = code04.replace(target04, replace04);
} else if (code04.includes(target04.replace(/\n/g, '\r\n'))) {
  code04 = code04.replace(target04.replace(/\n/g, '\r\n'), replace04.replace(/\n/g, '\r\n'));
} else {
  console.error('Target not found in 04_Reports_Misc.gs _analyticsCore');
}

// Update getAnalytics return statement
const targetGetAnalytics = `  return {success:true,
    summary:{orders:rows.length,customers:Object.keys(custSet).length,revenue:Math.round(totalRev),
      paid:Math.round(totalPaid),pending:Math.round(totalRev-totalPaid),
      avgPerDay:days.length>0?Math.round(totalRev/days.length):0,
      delivery:Math.round(totalDelivery),smallFee:Math.round(totalSmallFee)},
    meals:mealStats,days:days,topItems:topItems,allItems:allItems,
    // Lets the admin UI show "Including X archived orders" so they know
    // the report pulled across archive files (which is slower than live-only).
    archived:{count: archivedCount, included: archivedCount > 0}};`;

const replaceGetAnalytics = `  return {success:true,
    summary:{orders:rows.length,customers:Object.keys(custSet).length,revenue:Math.round(totalRev),
      paid:Math.round(totalPaid),pending:Math.round(totalRev-totalPaid),
      avgPerDay:days.length>0?Math.round(totalRev/days.length):0,
      delivery:Math.round(totalDelivery),smallFee:Math.round(totalSmallFee)},
    meals:mealStats,days:days,topItems:topItems,allItems:allItems,
    pendingCustomers:core.pendingCustomers || [],
    // Lets the admin UI show "Including X archived orders" so they know
    // the report pulled across archive files (which is slower than live-only).
    archived:{count: archivedCount, included: archivedCount > 0}};`;

if (code04.includes(targetGetAnalytics)) {
  code04 = code04.replace(targetGetAnalytics, replaceGetAnalytics);
  fs.writeFileSync('04_Reports_Misc.gs', code04, 'utf8');
  console.log('04_Reports_Misc.gs updated OK');
} else if (code04.includes(targetGetAnalytics.replace(/\n/g, '\r\n'))) {
  code04 = code04.replace(targetGetAnalytics.replace(/\n/g, '\r\n'), replaceGetAnalytics.replace(/\n/g, '\r\n'));
  fs.writeFileSync('04_Reports_Misc.gs', code04, 'utf8');
  console.log('04_Reports_Misc.gs (CRLF) updated OK');
} else {
  console.error('Target not found in 04_Reports_Misc.gs getAnalytics');
}

// 2. Update 00_Config.gs
let config = fs.readFileSync('00_Config.gs', 'utf8');
config = config.replace(/const CODE_VERSION = [0-9.]+;[^\r\n]*/, 'const CODE_VERSION = 34.3; // ANALYTICS PENDING CUSTOMERS DRILLDOWN: getAnalytics returns pendingCustomers list with itemized unpaid orders for admin review and one-click mark-as-paid. // 34.2:');
fs.writeFileSync('00_Config.gs', config, 'utf8');
console.log('00_Config.gs updated OK');
