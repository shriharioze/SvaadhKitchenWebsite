const fs = require("fs");
let c = fs.readFileSync("10_Hdfc_Gateway.gs", "utf8");
let applied = 0, missed = [];
function rep(a, b) { if (c.includes(a)) { c = c.replace(a, b); applied++; } else missed.push(a.slice(0, 70)); }

// 1. createWalletRechargeSession: storefront + LS-prefixed id + stash storefront
rep("  let name = String(body.name || \"Customer\").trim();\n  try {\n    const cRow = _findCustomerRow(getSpreadsheet(), phone);",
    "  const _sfW = _lsStorefront(body);\n  let name = String(body.name || \"Customer\").trim();\n  try {\n    const cRow = _findCustomerRow(getSpreadsheet(), phone, _sfW);");
rep("  const orderId  = \"SK\" + datePart + \"W\" + rand;",
    "  const orderId  = (_sfW === \"LS\" ? \"LS\" : \"SK\") + datePart + \"W\" + rand;");
rep("    pending[orderId] = { ts: nowMs, phone: phone, name: name, amount: amount };",
    "    pending[orderId] = { ts: nowMs, phone: phone, name: name, amount: amount, storefront: _sfW };");

// 2. finalize: idempotency check + credit routed by entry storefront
rep("    const wsAll = getOrCreateTab(getSpreadsheet(), TAB_WALLET, WALLET_HEADERS).getDataRange().getValues();",
    "    const wsAll = _walletTabFor(getSpreadsheet(), pendingEntryStorefront(oid)).getDataRange().getValues();");
rep("    // Look up phone/name from pending entry\n    let phone = \"\", name = \"Customer\";",
    "    // Look up phone/name from pending entry\n    let phone = \"\", name = \"Customer\", _sfFinal = \"\";\n    function pendingEntryStorefront(oid2) {\n      try {\n        const pending2 = JSON.parse(PropertiesService.getScriptProperties().getProperty(\"HDFC_PENDING_RECHARGES\") || \"{}\");\n        const e2 = pending2[oid2];\n        return (e2 && String(e2.storefront || \"\").toUpperCase() === \"LS\") ? \"LS\" : \"\";\n      } catch (_) { return \"\"; }\n    }");
rep("      if (entry) { phone = entry.phone || \"\"; name = entry.name || \"Customer\"; }",
    "      if (entry) { phone = entry.phone || \"\"; name = entry.name || \"Customer\"; _sfFinal = (String(entry.storefront || \"\").toUpperCase() === \"LS\") ? \"LS\" : \"\"; }");
rep("    _appendWalletTransaction(phone, name, \"Recharge (HDFC Gateway)\", chargedAmount, true, oid);",
    "    _appendWalletTransaction(phone, name, \"Recharge (HDFC Gateway)\", chargedAmount, true, oid, _sfFinal);");

fs.writeFileSync("10_Hdfc_Gateway.gs", c);
console.log("applied " + applied + ", missed " + missed.length);
missed.forEach(m => console.log("MISS: " + m));
