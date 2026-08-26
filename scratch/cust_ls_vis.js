const fs = require("fs");

// ── 1. getCustomerList: add ls flag + dual-wallet balance ──
let rp = fs.readFileSync("04_Reports_Misc.gs", "utf8");

// Add ls flag: check if the customer's most recent order is from LS
const oldMap = `      map[phone] = {
        phone:phone, 
        name:String(r.Customer_Name||"").trim(),
        area:String(r.Area||"").trim(), 
        payFreq:String(r.Payment_Freq||"").trim(),
        orderCount:0, 
        totalSpent:0, 
        pendingAmt:0, 
        lastDate:"",`;
const newMap = `      map[phone] = {
        phone:phone, 
        name:String(r.Customer_Name||"").trim(),
        area:String(r.Area||"").trim(), 
        payFreq:String(r.Payment_Freq||"").trim(),
        orderCount:0, 
        totalSpent:0, 
        pendingAmt:0, 
        lastDate:"",
        ls: String(r.Source||"").trim() === "LS" || !!r._lsTab,`;
if (rp.includes(oldMap)) { rp = rp.replace(oldMap, newMap); console.log("ls flag ✓"); }
else console.log("ls flag MISS");

// Dual-wallet: read both SK_Wallet + LS_Wallet
const oldWallet = `  var walletWs = getOrCreateTab(ss, TAB_WALLET, WALLET_HEADERS);
  var walletRows = getAllRows(walletWs);`;
const newWallet = `  var walletWs = getOrCreateTab(ss, TAB_WALLET, WALLET_HEADERS);
  var walletRows = getAllRows(walletWs);
  // LS_Wallet rows also included (separate bases — sum both for the customer list)
  try { var lsWw = ss.getSheetByName(TAB_LS_WALLET); if (lsWw) { walletRows = walletRows.concat(getAllRows(lsWw)); } } catch(e) {}`;
if (rp.includes(oldWallet)) { rp = rp.replace(oldWallet, newWallet); console.log("dual wallet ✓"); }
else console.log("dual wallet MISS");

// _calculateWalletBalance needs to read both — but it's called per-customer with walletRows
// Since we concatenated both wallets into walletRows, the balance will include both.
// This is practically correct (separate bases = customer in one wallet only).
// But we need to skip the storefront param since we're using preloaded rows.
// The existing call: _calculateWalletBalance(c.phone, walletRows) — no storefront → reads SK_Wallet by default
// But since we passed preloadedRows, it uses those ✓ (both wallets concatenated)

fs.writeFileSync("04_Reports_Misc.gs", rp);

// ── 2. vault_admin: [LS] badge on customer rows ──
let va = fs.readFileSync("docs/Admin/vault_admin.html", "utf8");
// Find the customer list rendering — look for where customer names appear in the Customers tab
const custRender = va.indexOf("renderCustomers");
if (custRender > -1) {
  // Look for the name rendering pattern in that section
  const section = va.slice(custRender, custRender + 3000);
  console.log("renderCustomers section (first 500):", section.slice(0, 500));
} else {
  // Search for getCustomerList response handling
  const gcIdx = va.indexOf("getCustomerList");
  if (gcIdx > -1) {
    const gcSection = va.slice(gcIdx, gcIdx + 2000);
    console.log("getCustomerList section (first 800):", gcSection.slice(0, 800));
  }
}
fs.writeFileSync("docs/Admin/vault_admin.html", va);

// ── syntax ──
fs.copyFileSync("04_Reports_Misc.gs", "scratch/syn_04.js");
