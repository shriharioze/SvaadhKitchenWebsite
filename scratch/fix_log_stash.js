const fs = require("fs");
let gw = fs.readFileSync("10_Hdfc_Gateway.gs", "utf8");
let n = 0;

// 1. Store full stash instead of just cart
const a1 = "var cartJson = pending[orderId].bulk ? JSON.stringify(pending[orderId].bulk) : JSON.stringify(pending[orderId].orders || {});";
const b1 = "var fullStash = JSON.stringify(pending[orderId]);";
if (gw.includes(a1)) { gw = gw.replace(a1, b1); n++; console.log("full stash ✓"); } else console.log("MISS stash");

// 2. Header: Cart_JSON → Stash_JSON
const a2 = '"Cart_JSON"';
const b2 = '"Stash_JSON"';
if (gw.includes(a2)) { gw = gw.replace(a2, b2); n++; console.log("header ✓"); } else console.log("MISS header");

// 3. appendRow: cartJson → fullStash
const a3 = "cartJson, \"pending\"";
const b3 = "fullStash, \"pending\"";
if (gw.includes(a3)) { gw = gw.replace(a3, b3); n++; console.log("append ✓"); } else console.log("MISS append");

fs.writeFileSync("10_Hdfc_Gateway.gs", gw);
console.log("done " + n + "/3");
