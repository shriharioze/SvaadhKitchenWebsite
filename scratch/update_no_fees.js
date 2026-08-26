const fs = require("fs");
let c = fs.readFileSync("scratch/test_ls_e2e.js", "utf8");
let n = 0;
function rep(a, b) { if (c.includes(a)) { c = c.replace(a, b); n++; } else console.log("MISS: " + a.slice(0, 60)); }

// Test 2: LS order — NO small fee, NO delivery → Net = 24
rep('  T("small-order fee STILL applies (owner rule)", Number(r.Small_Order_Fee) === 11);\n  T("Net_Total = 24+11 = 35", Number(r.Net_Total) === 35, String(r.Net_Total));',
    '  T("NO small-order fee on LS (owner rule 2026-08-26)", Number(r.Small_Order_Fee) === 0, String(r.Small_Order_Fee));\n  T("Net_Total = 24 (food only, zero fees)", Number(r.Net_Total) === 24, String(r.Net_Total));');

// Test 5: wallet math 1000−24=976, credit 24
rep('  T("Wallet_Credit=35 recorded", Number(r.Wallet_Credit) === 35, String(r.Wallet_Credit));',
    '  T("Wallet_Credit=24 recorded", Number(r.Wallet_Credit) === 24, String(r.Wallet_Credit));');
rep('  T("wallet balance 1000−35=965", bal === 965, String(bal));',
    '  T("wallet balance 1000−24=976", bal === 976, String(bal));');

// Test 8: waiver math — 24 food, NO small fee, waiver 26 → clamped 0, surplus 2 credited
rep('  // waiver = 5×₹5 accrued + ₹1 today = ₹26 → net = 24 food + 11 small fee − 26 = 9\n  T("waiver math exact: Net_Total = 24+11−26 = 9", r && Number(r.Net_Total) === 9 && Number(r.Discount_Amount) === 26, r && JSON.stringify({ disc: String(r.Discount_Amount), net: String(r.Net_Total) }));',
    '  // waiver = 5×₹5 accrued + ₹1 today = ₹26 → net clamped at 0, surplus ₹2 to wallet\n  T("waiver math: Net clamped to 0, discount 26", r && Number(r.Net_Total) === 0 && Number(r.Discount_Amount) === 26, r && JSON.stringify({ disc: String(r.Discount_Amount), net: String(r.Net_Total) }));');

fs.writeFileSync("scratch/test_ls_e2e.js", c);
console.log("e2e updated " + n);

// differential fuzz oracle: LS mode also zeroes small-order fee
let d = fs.readFileSync("scratch/test_ls_differential.js", "utf8");
const oa = "      const small = (!isDayFree && !isPickup && !isPorter && sub > 0 && sub < 53) ? 11 : 0;";
const ob = "      const small = (!lsMode && !isDayFree && !isPickup && !isPorter && sub > 0 && sub < 53) ? 11 : 0;";
if (d.includes(oa)) { d = d.replace(oa, ob); fs.writeFileSync("scratch/test_ls_differential.js", d); console.log("oracle updated (LS small fee = 0)"); }
else console.log("oracle MISS");
