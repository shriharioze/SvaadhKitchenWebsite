const fs = require("fs");
// 1. submitOrder small fee skip for LS
let c = fs.readFileSync("02_Orders_Menu.gs", "utf8");
const a = 'if (!isFeeExempt && !isDayFree && !isPickup && !isPorter && (mealType === "Lunch" || mealType === "Dinner") && sub > 0 && combinedMealSub < (PRICING_V2 ? 53 : 50)) {';
const b = 'if (!isFeeExempt && !isDayFree && !isPickup && !isPorter && !_lsDeliveryFree(_sf) && (mealType === "Lunch" || mealType === "Dinner") && sub > 0 && combinedMealSub < (PRICING_V2 ? 53 : 50)) {';
// only the one inside _submitOrderInternal (has `let smallOrderFee = 0;` right before)
const idx = c.indexOf("let smallOrderFee = 0;\n      " + a);
if (idx !== -1) {
  c = c.slice(0, idx) + "let smallOrderFee = 0;\n      // LS storefront: NO fees at all (owner 2026-08-25 — free delivery AND no small-order fee)\n      " + b + c.slice(idx + ("let smallOrderFee = 0;\n      " + a).length);
  fs.writeFileSync("02_Orders_Menu.gs", c);
  console.log("submitOrder smallFee routed");
} else console.log("MISS submitOrder");

// 2. gateway authoritative small fee
let g = fs.readFileSync("10_Hdfc_Gateway.gs", "utf8");
const ga = "let smallOrderFee = 0;\n      " + a;
const gb = "let smallOrderFee = 0;\n      " + a.replace("(mealType", "!_lsFreeDel && (mealType");
if (g.includes(ga)) {
  g = g.replace(ga, gb.replace("_lsDeliveryFree(_sf)", "_lsFreeDel"));
  fs.writeFileSync("10_Hdfc_Gateway.gs", g);
  console.log("authoritative smallFee routed");
} else console.log("MISS authoritative");

// 3. bulk small fee
let bk = fs.readFileSync("06_Bulk_Orders.gs", "utf8");
const ba = "const smallFee = (isDayFree || isPickup) ? 0 : (m.food < smallTh ? 11 : 0);";
const bb = "const smallFee = (lsFree || isDayFree || isPickup) ? 0 : (m.food < smallTh ? 11 : 0);";
if (bk.includes(ba)) { bk = bk.replace(ba, bb); fs.writeFileSync("06_Bulk_Orders.gs", bk); console.log("bulk smallFee routed"); }
else console.log("MISS bulk");
