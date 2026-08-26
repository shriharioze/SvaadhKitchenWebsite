const fs = require("fs");
// CRLF-safe replacements
function repFile(p, pairs) {
  let c = fs.readFileSync(p, "utf8");
  let done = 0;
  pairs.forEach(([a, b]) => {
    const aa = a.replace(/\n/g, "\r\n"), bb = b.replace(/\n/g, "\r\n");
    if (c.includes(aa)) { c = c.replace(aa, bb); done++; }
    else if (c.includes(a)) { c = c.replace(a, b); done++; }
    else console.log(p + " MISS: " + a.slice(0, 60));
  });
  fs.writeFileSync(p, c);
  console.log(p + " done " + done);
}

repFile("02_Orders_Menu.gs", [
  ['let smallOrderFee = 0;\n      if (!isFeeExempt && !isDayFree && !isPickup && !isPorter && (mealType === "Lunch" || mealType === "Dinner") && sub > 0 && combinedMealSub < (PRICING_V2 ? 53 : 50)) {',
   'let smallOrderFee = 0;\n      // LS storefront: NO fees at all (owner 2026-08-25 — free delivery AND no small-order fee)\n      if (!isFeeExempt && !isDayFree && !isPickup && !isPorter && !_lsDeliveryFree(_sf) && (mealType === "Lunch" || mealType === "Dinner") && sub > 0 && combinedMealSub < (PRICING_V2 ? 53 : 50)) {']
]);
repFile("10_Hdfc_Gateway.gs", [
  ['let smallOrderFee = 0;\n      if (!isFeeExempt && !isDayFree && !isPickup && !isPorter && (mealType === "Lunch" || mealType === "Dinner") && sub > 0 && combinedMealSub < (PRICING_V2 ? 53 : 50)) {',
   'let smallOrderFee = 0;\n      if (!isFeeExempt && !isDayFree && !isPickup && !isPorter && !_lsFreeDel && (mealType === "Lunch" || mealType === "Dinner") && sub > 0 && combinedMealSub < (PRICING_V2 ? 53 : 50)) {']
]);
