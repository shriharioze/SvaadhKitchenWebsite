const fs = require("fs");
// 1. markOrdersStatus wallet refunds → r._lsTab
let c = fs.readFileSync("04_Reports_Misc.gs", "utf8");
const a = '_appendWalletTransaction(phone, custName, "Order Cancellation Refund", amt, true, String(r.Submission_ID));';
const b = '_appendWalletTransaction(phone, custName, "Order Cancellation Refund", amt, true, String(r.Submission_ID), r._lsTab ? "LS" : "");';
let n = 0;
while (c.includes(a)) { c = c.replace(a, b); n++; }
fs.writeFileSync("04_Reports_Misc.gs", c);
console.log("markOrdersStatus wallet refunds routed: " + n);

// 2. 02_Orders_Menu.gs — remaining combined reads → SK-only
let d = fs.readFileSync("02_Orders_Menu.gs", "utf8");
const reps = [
  ["const orderRows = _getAllOrdersBothTabsIfPresent(ss); // on-account drift check spans both storefronts",
   "const orderRows = getAllRows(getOrCreateTab(ss, TAB_ORDERS, ORDERS_HEADERS));"],
  ["const rows = _getAllOrdersBothTabsIfPresent(ss);",
   "const rows = getAllRows(getOrCreateTab(ss, TAB_ORDERS, ORDERS_HEADERS));"]
];
reps.forEach(([x, y]) => { while (d.includes(x)) { d = d.replace(x, y); } });
fs.writeFileSync("02_Orders_Menu.gs", d);
console.log("02 combined reads reverted");
