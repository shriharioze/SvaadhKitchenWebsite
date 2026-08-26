const fs = require("fs");
let rp = fs.readFileSync("04_Reports_Misc.gs", "utf8");
let n = 0;

// CRLF-safe replacement helper
function rep(a, b) {
  const aa = a.replace(/\n/g, "\r\n");
  const bb = b.replace(/\n/g, "\r\n");
  if (rp.includes(aa)) { rp = rp.replace(aa, bb); n++; return true; }
  if (rp.includes(a)) { rp = rp.replace(a, b); n++; return true; }
  return false;
}

// 1. Add ls flag to customer map
rep(`        lastDate:"",`,
    `        lastDate:"",\n        ls: String(r.Source||"").trim() === "LS" || !!r._lsTab,`);

// 2. Dual-wallet
rep(`  var walletWs = getOrCreateTab(ss, TAB_WALLET, WALLET_HEADERS);
  var walletRows = getAllRows(walletWs);`,
    `  var walletWs = getOrCreateTab(ss, TAB_WALLET, WALLET_HEADERS);\n  var walletRows = getAllRows(walletWs);\n  try { var lsWw = ss.getSheetByName(TAB_LS_WALLET); if (lsWw) { walletRows = walletRows.concat(getAllRows(lsWw)); } } catch(e) {}`);

fs.writeFileSync("04_Reports_Misc.gs", rp);
console.log("done " + n + "/2");

// syntax
fs.copyFileSync("04_Reports_Misc.gs", "scratch/syn_04.js");
