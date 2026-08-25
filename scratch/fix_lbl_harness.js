const fs = require("fs");
let c = fs.readFileSync("scratch/test_labels_breakfast.js", "utf8");
const a = "var getOrCreateTab = function (ss, n) { return ss.getSheetByName(n); };";
const b = 'var TAB_ORDERS = "SK_Orders";\nvar getOrCreateTab = function (ss, n) { return ss.getSheetByName(n); };';
if (c.includes(a)) { c = c.replace(a, b); fs.writeFileSync("scratch/test_labels_breakfast.js", c); console.log("fixed"); }
else console.log("MISS");
