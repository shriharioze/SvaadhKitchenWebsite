function debugIAOrder() {
  var rows = typeof ia_rowsAsSK === "function" ? ia_rowsAsSK() : [];
  var target = rows.filter(function(r) { return r.Submission_ID === "IA2606191652000730A"; });
  if (target.length === 0) {
    console.log("Order not found");
    return;
  }
  var r = target[0];
  console.log("Raw Items JSON:", r.Items_JSON);
  console.log("Dry_Sabji_Mini:", r.Dry_Sabji_Mini);
  console.log("Curry_Sabji_Mini:", r.Curry_Sabji_Mini);
  
  // also simulate getting it via getKitchenReport
  var kr = getKitchenReport("2026-06-19");
  var m = kr.meals && kr.meals.Dinner;
  if (m) {
    var cust = m.customers.find(function(c) { return c.id === "IA2606191652000730A"; });
    if (cust) {
      console.log("Kitchen Report items:", JSON.stringify(cust.items));
    } else {
      console.log("Not found in Kitchen Report customers");
    }
  } else {
    console.log("Dinner meal not found in KR");
  }
}
