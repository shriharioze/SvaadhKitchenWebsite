const fs = require("fs");
const p = "Code.gs";
let c = fs.readFileSync(p, "utf8");
const reps = [
  ['if (action === "getCustomer") return jsonRes(getCustomer(p.phone));',
   'if (action === "getCustomer") return jsonRes(getCustomer(p.phone, p.storefront === "LS" ? "LS" : ""));'],
  ['if (action === "verifyLogin") return jsonRes(verifyLogin(p.phone, p.pin));',
   'if (action === "verifyLogin") return jsonRes(verifyLogin(p.phone, p.pin, p.storefront === "LS" ? "LS" : ""));'],
  ['if (action === "getCustomerOrders") return jsonRes(getCustomerOrders(p.phone));',
   'if (action === "getCustomerOrders") return jsonRes(getCustomerOrders(p.phone, p.storefront === "LS" ? "LS" : ""));'],
  ['if (action === "getWalletTransactions") return jsonRes(getWalletTransactions(p.phone));',
   'if (action === "getWalletTransactions") return jsonRes(getWalletTransactions(p.phone, p.storefront === "LS" ? "LS" : ""));'],
  ['if (action === "getCustomerOrders") return jsonRes(getCustomerOrders(body.phone));',
   'if (action === "getCustomerOrders") return jsonRes(getCustomerOrders(body.phone, _lsStorefront(body)));'],
  ['if (action === "requestPinResetOtp") return jsonRes(requestPinResetOtp(body.phone));',
   'if (action === "requestPinResetOtp") return jsonRes(requestPinResetOtp(body.phone, _lsStorefront(body)));'],
  ['if (action === "verifyPinResetOtp") return jsonRes(verifyPinResetOtp(body.phone, body.otp, body.newPin));',
   'if (action === "verifyPinResetOtp") return jsonRes(verifyPinResetOtp(body.phone, body.otp, body.newPin, _lsStorefront(body)));'],
  ['  const profile = { phone: p.phone, pin: p.pin };\n  _upsertCustomer(getSpreadsheet(), profile);',
   '  const profile = { phone: p.phone, pin: p.pin };\n  _upsertCustomer(getSpreadsheet(), profile, p.storefront === "LS" ? "LS" : "");'],
  ['if (action === "setPin") {\n    const profile = { phone: body.phone, pin: body.pin };\n    _upsertCustomer(getSpreadsheet(), profile);',
   'if (action === "setPin") {\n    const profile = { phone: body.phone, pin: body.pin };\n    _upsertCustomer(getSpreadsheet(), profile, _lsStorefront(body));'],
  ['const profile = { ...body, pin: body.pin || "" };\n// SECURITY: admin-only fields',
   'const profile = { ...body, pin: body.pin || "", storefront: _lsStorefront(body) };\n// SECURITY: admin-only fields']
];
let applied = 0;
reps.forEach(([a, b]) => { if (c.includes(a)) { c = c.replace(a, b); applied++; } else console.log("MISS: " + a.slice(0, 80)); });
fs.writeFileSync(p, c);
console.log("applied " + applied + "/" + reps.length);
