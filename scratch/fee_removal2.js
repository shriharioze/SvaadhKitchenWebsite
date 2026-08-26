const fs = require("fs");
// submitOrder (02) small fee
let c = fs.readFileSync("02_Orders_Menu.gs", "utf8");
const a = 'let smallOrderFee = 0;\n      if (!isFeeExempt && !isDayFree && !isPickup && !isPorter && (mealType === "Lunch" || mealType === "Dinner") && sub > 0 && combinedMealSub < (PRICING_V2 ? 53 : 50)) {';
const b = 'let smallOrderFee = 0;\n      // LS storefront: NO fees at all (owner 2026-08-25 — free delivery AND no small-order fee)\n      if (!isFeeExempt && !isDayFree && !isPickup && !isPorter && !_lsDeliveryFree(_sf) && (mealType === "Lunch" || mealType === "Dinner") && sub > 0 && combinedMealSub < (PRICING_V2 ? 53 : 50)) {';
if (c.includes(a)) { c = c.replace(a, b); fs.writeFileSync("02_Orders_Menu.gs", c); console.log("submitOrder routed"); }
else console.log("MISS submitOrder");

// gateway (10) small fee
let g = fs.readFileSync("10_Hdfc_Gateway.gs", "utf8");
const ga = 'let smallOrderFee = 0;\n      if (!isFeeExempt && !isDayFree && !isPickup && !isPorter && (mealType === "Lunch" || mealType === "Dinner") && sub > 0 && combinedMealSub < (PRICING_V2 ? 53 : 50)) {';
const gb = 'let smallOrderFee = 0;\n      if (!isFeeExempt && !isDayFree && !isPickup && !isPorter && !_lsFreeDel && (mealType === "Lunch" || mealType === "Dinner") && sub > 0 && combinedMealSub < (PRICING_V2 ? 53 : 50)) {';
if (g.includes(ga)) { g = g.replace(ga, gb); fs.writeFileSync("10_Hdfc_Gateway.gs", g); console.log("authoritative routed"); }
else console.log("MISS authoritative");
