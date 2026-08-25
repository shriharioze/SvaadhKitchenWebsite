const fs = require("fs");
let c = fs.readFileSync("docs/Liviano-Serio.html", "utf8");
let n = 0;
function rep(a, b) { if (c.includes(a)) { c = c.replace(a, b); n++; } else console.log("MISS: " + a.slice(0, 70)); }

rep('_action: "submitWalletRecharge",', '_action: "submitWalletRecharge",\n          storefront: STOREFRONT,');
rep('{ _action: "hdfc_finalizeWalletRecharge", order_id: pendingId }', '{ _action: "hdfc_finalizeWalletRecharge", storefront: STOREFRONT, order_id: pendingId }');
rep('{ _action: "hdfc_finalizeWalletRecharge", order_id: orderId }', '{ _action: "hdfc_finalizeWalletRecharge", storefront: STOREFRONT, order_id: orderId }');
rep('{ _action: "requestPinResetOtp", phone: phone }', '{ _action: "requestPinResetOtp", storefront: STOREFRONT, phone: phone }');
rep('{ _action: "verifyPinResetOtp", phone: phone, otp: otp, newPin: np }', '{ _action: "verifyPinResetOtp", storefront: STOREFRONT, phone: phone, otp: otp, newPin: np }');

fs.writeFileSync("docs/Liviano-Serio.html", c);
console.log("applied " + n + "/5");
