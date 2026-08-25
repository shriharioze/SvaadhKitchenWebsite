const fs = require("fs");
let c = fs.readFileSync("scratch/test_labels_breakfast.js", "utf8");
const anchor = 'console.log("backend _lblItemSummary:  ", JSON.stringify(_lblItemSummary(o2, "Lunch", "Devanagari")));';
const add = anchor + `

// ── B1-fail variant: breakfast row with BLANK BF slots, good Items_JSON ──
addRow({
  Submission_ID: "SK-BF-3", Order_Date: "2026-08-25", Meal_Type: "Breakfast",
  Customer_Name: "Blank Slots", Phone: "9000000000", Area: "Kharadi",
  Items_JSON: JSON.stringify({ "Kanda Poha": 1, "Ghee Upma": 1, "Breakfast Curd": 1 }),
  "Curd": 1,
  Payment_Status: "Paid", Food_Subtotal: 73, Net_Total: 73
});
const labelData3 = getLabelOrders("2026-08-25", "Breakfast");
const o3 = labelData3.orders.find(x => x.name === "Blank Slots");
const s3k = getBulkItemSummary(o3, "Breakfast", "Devanagari");
const s3b = _lblItemSummary(o3, "Breakfast", "Devanagari");
console.log("\\n═══ B1-variant: BLANK BF slots + good Items_JSON ═══");
console.log("kitchen:", JSON.stringify(s3k), "\\nbackend: ", JSON.stringify(s3b));
const ok3 = s3k.indexOf("कांपो") !== -1 && s3k.indexOf("घीऊ") !== -1 && s3k.indexOf("दही") !== -1
         && s3b.indexOf("कांपो") !== -1 && s3b.indexOf("घीऊ") !== -1 && s3b.indexOf("दही") !== -1;
console.log(ok3 ? "B1-VARIANT FIXED ✓ (all 3 items render)" : "B1-VARIANT STILL BROKEN ✗");

// ── Kitchen SUMMARY prep counts (getKitchenSummary) ──
const ksFn = ${'`'}${'$'}{extractFn(read("03_Admin_Kitchen.gs"), "getKitchenSummary")}${'`'};
const packetsFn = extractFn(read("03_Admin_Kitchen.gs"), "calculatePackets");
const getRecentRowsFn = extractFn(read("Code.gs"), "getRecentRows");
const ksPrelude = [
  'var getMenu = function () { return { lunch_dry: "Dal Kanda", lunch_curry: "Mix Veg", dinner_dry: "Sev Tomato", dinner_curry: "Palak Corn" }; };',
  'var Utilities = { formatDate: (d) => (d instanceof Date ? d.toISOString().slice(0,10) : String(d)) };',
  'var getRecentRows = function (ws, n) { return getAllRows(ws); };'
].join("\\n");
eval(ksPrelude + "\\n" + packetsFn + "\\n" + ksFn);
const ks = getKitchenSummary("2026-08-25");
const bfMeal = ks.meals["Breakfast"] || {};
const ldMeal = ks.meals["Lunch"] || {};
console.log("\\n═══ KITCHEN SUMMARY prep counts ═══");
console.log("Breakfast items:", JSON.stringify(bfMeal.items));
console.log("Breakfast per-order summaries:", JSON.stringify((ks.orders || []).filter(o => o.Meal_Type === "Breakfast").map(o => o.summary)));
console.log("Lunch extras:", JSON.stringify(ldMeal.extras));
console.log("Lunch per-order summaries:", JSON.stringify((ks.orders || []).filter(o => o.Meal_Type === "Lunch").map(o => o.summary)));
const bfOk = bfMeal.items && bfMeal.items["Kanda Poha"] === 2 && bfMeal.items["Ghee Upma"] === 2 && bfMeal.items["Curd"] === 3;
const ldOk = ldMeal.extras && ldMeal.extras["Thalipeeth"] === 2;
console.log("Breakfast counts (Poha 2, Upma 2, Curd 3):", bfOk ? "PASS ✓" : "FAIL ✗");
console.log("Lunch Thalipeeth×2 in prep counts:", ldOk ? "PASS ✓" : "FAIL ✗";
`;
// splice: replace trailing console of B2 section end — append before EOF
c = c + "\n" + "";
// simpler: write the additional code as a separate tail appended to file
const tail = `
// ── B1-fail variant: breakfast row with BLANK BF slots, good Items_JSON ──
addRow({
  Submission_ID: "SK-BF-3", Order_Date: "2026-08-25", Meal_Type: "Breakfast",
  Customer_Name: "Blank Slots", Phone: "9000000000", Area: "Kharadi",
  Items_JSON: JSON.stringify({ "Kanda Poha": 1, "Ghee Upma": 1, "Breakfast Curd": 1 }),
  "Curd": 1,
  Payment_Status: "Paid", Food_Subtotal: 73, Net_Total: 73
});
const labelData3 = getLabelOrders("2026-08-25", "Breakfast");
const o3 = labelData3.orders.find(x => x.name === "Blank Slots");
const s3k = getBulkItemSummary(o3, "Breakfast", "Devanagari");
const s3b = _lblItemSummary(o3, "Breakfast", "Devanagari");
console.log("\\n=== B1-variant: BLANK BF slots + good Items_JSON ===");
console.log("kitchen:", JSON.stringify(s3k), " backend:", JSON.stringify(s3b));
const ok3 = s3k.indexOf("कांपो") !== -1 && s3k.indexOf("घीऊ") !== -1 && s3k.indexOf("दही") !== -1
         && s3b.indexOf("कांपो") !== -1 && s3b.indexOf("घीऊ") !== -1 && s3b.indexOf("दही") !== -1;
console.log(ok3 ? "B1-VARIANT FIXED (all 3 items render)" : "B1-VARIANT STILL BROKEN");

// ── Kitchen SUMMARY prep counts (getKitchenSummary) ──
const ksFn = extractFn(read("03_Admin_Kitchen.gs"), "getKitchenSummary");
const packetsFn = extractFn(read("03_Admin_Kitchen.gs"), "calculatePackets");
const ksPrelude = [
  'var Utilities = { formatDate: function (d) { return d instanceof Date ? d.toISOString().slice(0,10) : String(d); } };',
  'var getMenu = function () { return { lunch_dry: "Dal Kanda", lunch_curry: "Mix Veg", dinner_dry: "Sev Tomato", dinner_curry: "Palak Corn" }; };'
].join("\\n");
eval(ksPrelude + "\\n" + packetsFn + "\\n" + ksFn);
const ks = getKitchenSummary("2026-08-25");
const bfMeal = ks.meals["Breakfast"] || {};
const ldMeal = ks.meals["Lunch"] || {};
console.log("\\n=== KITCHEN SUMMARY prep counts ===");
console.log("Breakfast items:", JSON.stringify(bfMeal.items));
console.log("Breakfast order summaries:", JSON.stringify((ks.orders || []).filter(o => o.Meal_Type === "Breakfast").map(o => o.summary)));
console.log("Lunch extras:", JSON.stringify(ldMeal.extras));
console.log("Lunch order summaries:", JSON.stringify((ks.orders || []).filter(o => o.Meal_Type === "Lunch").map(o => o.summary)));
const bfOk = bfMeal.items && bfMeal.items["Kanda Poha"] === 2 && bfMeal.items["Ghee Upma"] === 2 && bfMeal.items["Curd"] === 3;
const ldOk = ldMeal.extras && ldMeal.extras["Thalipeeth"] === 2;
console.log("Breakfast counts (Poha 2, Upma 2, Curd 3):", bfOk ? "PASS" : "FAIL");
console.log("Lunch Thalipeeth x2 in prep counts:", ldOk ? "PASS" : "FAIL");
`;
fs.writeFileSync("scratch/test_labels_breakfast.js", c + tail);
console.log("harness extended");
