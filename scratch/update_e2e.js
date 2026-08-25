const fs = require("fs");
let c = fs.readFileSync("scratch/test_ls_e2e.js", "utf8");
let n = 0;
function rep(a, b) { if (c.includes(a)) { c = c.replace(a, b); n++; } else { console.log("MISS: " + a.slice(0, 80)); process.exitCode = 1; } }

rep('const lsFns = ["_lsStorefront", "_lsDeliveryFree", "_lsOrdersWs", "_lsOrderTabs", "_getAllOrdersBothTabs", "_getAllOrdersBothTabsIfPresent"]',
    'const lsFns = ["_lsStorefront", "_lsDeliveryFree", "_lsOrdersWs", "_lsOrderTabs", "_getAllOrdersBothTabs", "_getAllOrdersBothTabsIfPresent", "_customersTabFor", "_walletTabFor"]');
rep('var TAB_ORDERS = "SK_Orders", TAB_LS_ORDERS = "LS_Orders", TAB_MENU = "SK_Daily_Menu",',
    'var TAB_ORDERS = "SK_Orders", TAB_LS_ORDERS = "LS_Orders", TAB_LS_CUSTOMERS = "LS_Customers", TAB_LS_WALLET = "LS_Wallet", TAB_MENU = "SK_Daily_Menu",');

// ── Test 5: separate wallet — recharge goes into LS_Wallet, SK_Wallet untouched
rep('console.log("\\n[5] Shared wallet: recharge once, spend on LS, balance consistent");\nresetWorld();\n{\n  walWs.appendRow(["9999999999", "Test Customer", "Recharge", 1000, "TRUE", "R1", "t"]);',
    'console.log("\\n[5] Separate wallet: recharge in LS_Wallet, spend on LS, SK_Wallet untouched");\nresetWorld();\n{\n  const lsWal = ss.getSheetByName("LS_Wallet") || mkTab("LS_Wallet", ["Phone", "Customer_Name", "Txn_Type", "Amount", "Verified", "Reference_ID", "Timestamp"]);\n  lsWal.appendRow(["9999999999", "Test Customer", "Recharge", 1000, "TRUE", "R1", "t"]);');
rep('  const balRows = getRows(walWs);',
    '  const balRows = getRows(ss.getSheetByName("LS_Wallet"));\n  T("SK_Wallet has ZERO rows (separate books)", walWs.rows.length === 0);');

// ── Test 7: cross-page twin is now a VALID separate order (separate bases)
rep('  T("first (SK) ok", r1.success);\n  // Design: a ≤5-min-old identical order from the OTHER page is silently deduped\n  // onto the ORIGINAL row (same rule as browser retries) — never double-writes.\n  T("LS twin deduped onto original SK row (no 2nd write)", r2.success && r2.submissionId === r1.submissionId && r2.rows_written === 0, JSON.stringify(r2).slice(0, 180));\n  T("exactly ONE row total across BOTH tabs", skWs.rows.length === 1 && (ss.getSheetByName("LS_Orders") ? ss.getSheetByName("LS_Orders").rows.length : 0) === 0);',
    '  T("first (SK) ok", r1.success);\n  // SEPARATE BASES: the same phone on the other page is an independent account —\n  // the twin order is legitimate and writes to LS_Orders (no cross-page dedupe).\n  T("LS twin is a valid separate order", r2.success === true, JSON.stringify(r2).slice(0, 180));\n  T("one row in EACH tab (no cross-tab dedupe)", skWs.rows.length === 1 && ss.getSheetByName("LS_Orders").rows.length === 1);');

// ── Test 8: loyalty — seed ALL 5 days in LS_Orders (LS-only history)
rep('  days.forEach((iso, i) => {\n    const ws = i % 2 === 0 ? skWs : (ss.getSheetByName("LS_Orders") || mkTab("LS_Orders", ORDERS_HEADERS_ARR));',
    '  days.forEach((iso, i) => {\n    const ws = ss.getSheetByName("LS_Orders") || mkTab("LS_Orders", ORDERS_HEADERS_ARR);');

fs.writeFileSync("scratch/test_ls_e2e.js", c);
console.log("applied " + n + " edits");
