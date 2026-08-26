const fs = require("fs");
let n = 0;

// ── 1. Add manual archive run endpoint ──
let cg = fs.readFileSync("Code.gs", "utf8");
const anchor = 'if (action === "archiveDueDryRun")';
if (!cg.includes("archiveRunNow")) {
  const ep = '    if (action === "archiveRunNow") { if (!isAdmin) return jsonRes({ error: "STRICT ADMIN PIN REQUIRED" }); return jsonRes(archiveDueOrders(false)); } // manual archive run — archives all due rows now\n';
  cg = cg.replace(anchor, ep + anchor);
  fs.writeFileSync("Code.gs", cg);
  n++; console.log("archiveRunNow endpoint ✓");
} else console.log("archiveRunNow already exists");

// ── 2. Admin Customers tab: show LS_Customers alongside SK_Customers ──
// getCustomerList in 04_Reports_Misc.gs reads SK_Customers only.
// Add LS_Customers rows with an ls flag.
let rp = fs.readFileSync("04_Reports_Misc.gs", "utf8");
const clIdx = rp.indexOf("function getCustomerList() {");
if (clIdx !== -1) {
  const clEnd = rp.indexOf("\nfunction ", clIdx + 10);
  let clBody = rp.slice(clIdx, clEnd);
  // Find the line that reads SK_Customers and append LS_Customers rows
  const oldRead = "var ordersWs = getOrCreateTab(ss, TAB_CUSTOMERS, CUSTOMERS_HEADERS);";
  const newRead = "var ordersWs = getOrCreateTab(ss, TAB_CUSTOMERS, CUSTOMERS_HEADERS);\n  // LS customers appended with ls flag\n  try { var lsCustWs = ss.getSheetByName(TAB_LS_CUSTOMERS); if (lsCustWs) { var lsCustRows = getAllRows(lsCustWs); lsCustRows.forEach(function(r) { r._lsCust = true; }); ordersWs = null; var allCust = getAllRows(getOrCreateTab(ss, TAB_CUSTOMERS, CUSTOMERS_HEADERS)).concat(lsCustRows); var combinedWs = { rows: allCust, headers: Object.keys(allCust[0] || {}) }; } } catch(eLS) {}";
  if (clBody.includes(oldRead)) {
    // Actually, simpler approach: just concat the rows after the existing read
    // Let me check what getCustomerList actually does...
    console.log("getCustomerList found — checking structure...");
    console.log(clBody.slice(0, 600));
  }
}

// Simpler approach for getCustomerList: just append LS customer rows to the result
const oldList = "var ordersWs = getOrCreateTab(ss, TAB_CUSTOMERS, CUSTOMERS_HEADERS);";
if (rp.includes(oldList)) {
  // Find where the customers are mapped/returned and add LS rows
  // Actually the cleanest: read both tabs and concat before processing
  const oldBlock = "var ordersWs = getOrCreateTab(ss, TAB_CUSTOMERS, CUSTOMERS_HEADERS);";
  const newBlock = "var ordersWs = getOrCreateTab(ss, TAB_CUSTOMERS, CUSTOMERS_HEADERS);\n  // LS_Customers appended (tagged _lsCust for [LS] badge)\n  var lsCustRows = [];\n  try { var lsCW = ss.getSheetByName(TAB_LS_CUSTOMERS); if (lsCW) { lsCustRows = getAllRows(lsCW); lsCustRows.forEach(function(r) { r._lsCust = true; }); } } catch(e) {}";
  rp = rp.replace(oldBlock, newBlock);
  // Now find where rows are read from ordersWs and concat lsCustRows
  const oldRows = "var rows = getAllRows(ordersWs);";
  const newRows = "var rows = getAllRows(ordersWs).concat(lsCustRows);";
  if (rp.includes(oldRows)) {
    rp = rp.replace(oldRows, newRows);
    n++; console.log("getCustomerList LS rows ✓");
  } else console.log("getCustomerList rows MISS");
} else console.log("getCustomerList MISS");
fs.writeFileSync("04_Reports_Misc.gs", rp);

// ── 3. vault_admin Customers tab: [LS] badge on LS customers ──
let va = fs.readFileSync("docs/Admin/vault_admin.html", "utf8");
// Find where customer names render in the Customers tab and add [LS] badge
// The customer list rendering likely uses a pattern like ${c.name} or ${r.name}
// Let me check what field names are used
console.log("checking vault_admin customer rendering...");
const custProbes = ["customer_name", "Customer_Name", "cname", "custName"];
custProbes.forEach(pr => {
  let i = va.indexOf(pr);
  if (i > -1) console.log("  found '" + pr + "' @ " + i);
});
// Look for the customers tab rendering
const custTab = va.indexOf("renderCustomers");
if (custTab > -1) console.log("  renderCustomers found @ " + custTab);
const customerList = va.indexOf("getCustomerList");
if (customerList > -1) console.log("  getCustomerList found @ " + customerList);

fs.writeFileSync("docs/Admin/vault_admin.html", va);

console.log("done " + n);
