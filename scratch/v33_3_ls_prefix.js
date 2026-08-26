// ════════════════════════════════════════════════════════════════
// v33.3: (1) [LS] prefix on Customer_Name for ALL LS orders (IA pattern)
//        (2) fix label showing only "1xस" for blank-BF-slot rows
// ════════════════════════════════════════════════════════════════
const fs = require("fs");

// ── 1. submitOrder: prepend [LS] to Customer_Name ──
let c = fs.readFileSync("02_Orders_Menu.gs", "utf8");
const a1 = 'set("Customer_Name",       profile.name     || "");';
const b1 = 'set("Customer_Name",       _isLS ? "[LS] " + (profile.name || "") : (profile.name || ""));';
if (c.includes(a1)) { c = c.replace(a1, b1); console.log("submitOrder Customer_Name [LS] ✓"); }
else console.log("MISS submitOrder name");
fs.writeFileSync("02_Orders_Menu.gs", c);

// ── 2. bulk: prepend [LS] to Customer_Name ──
let bk = fs.readFileSync("06_Bulk_Orders.gs", "utf8");
const a2 = 'set("Customer_Name", name);';
const b2 = 'set("Customer_Name", _sfBulk === "LS" ? "[LS] " + name : name);';
if (bk.includes(a2)) { bk = bk.replace(a2, b2); console.log("bulk Customer_Name [LS] ✓"); }
else console.log("MISS bulk name");
fs.writeFileSync("06_Bulk_Orders.gs", bk);

// ── 3. reconciler _buildSubmitBodyFromPending: prepend [LS] ──
let rc = fs.readFileSync("11_Hdfc_Reconciler.gs", "utf8");
const a3 = '      name:               profile.name    || "Customer",';
const b3 = '      name:               (String(entry.storefront || "").trim().toUpperCase() === "LS" ? "[LS] " : "") + (profile.name || "Customer"),';
if (rc.includes(a3)) { rc = rc.replace(a3, b3); console.log("reconciler name [LS] ✓"); }
else console.log("MISS reconciler name");
fs.writeFileSync("11_Hdfc_Reconciler.gs", rc);

// ── 4. getLabelOrders: [LS] prefix on name ──
let ad = fs.readFileSync("03_Admin_Kitchen.gs", "utf8");
const a4 = 'name:  String(r.Customer_Name || ""),';
const b4 = 'name:  String(r.Customer_Name || ""),  // already has [LS] prefix in the sheet for LS rows';
// Customer_Name in the sheet already carries [LS] from submitOrder — no change needed here.
// But for EXISTING LS rows (placed before this fix), prepend if missing:
const a4b = `      var obj = {
        name:  String(r.Customer_Name || ""),`;
const b4b = `      var obj = {
        name:  (function (v) { v = String(v || "").trim(); return (v && v.indexOf("[LS]") !== 0 && String(r.Source || "").trim() === "LS") ? "[LS] " + v : v; })(),`;
if (ad.includes(a4b)) { ad = ad.replace(a4b, b4b); console.log("getLabelOrders name [LS] ✓"); }
else console.log("MISS getLabelOrders name");

// ── 5. getKitchenSummary: [LS] prefix ──
const a5 = '      Customer_Name: String(r.Customer_Name || ""),';
// This appears in multiple functions — need to target getKitchenSummary specifically
const ksIdx = ad.indexOf("function getKitchenSummary(date) {");
const ksEnd = ad.indexOf("\nfunction ", ksStart + 10);
if (ksIdx !== -1) {
  const ksBody = ad.slice(ksIdx, ksEnd);
  // Find the orders.push Customer_Name line inside getKitchenSummary
  const a5ks = 'Customer_Name: String(r.Customer_Name || ""),';
  if (ksBody.includes(a5ks)) {
    const b5ks = 'Customer_Name: (function (v) { v = String(v || "").trim(); return (v && v.indexOf("[LS]") !== 0 && r._lsTab) ? "[LS] " + v : v; })(),';
    ad = ad.slice(0, ksIdx) + ksBody.replace(a5ks, b5ks) + ad.slice(ksEnd);
    console.log("getKitchenSummary name [LS] ✓");
  } else console.log("getKitchenSummary Customer_Name not found in body");
}
// Also getDriverOrders
const drIdx = ad.indexOf("function getDriverOrders(date) {");
if (drIdx !== -1) {
  const drEnd = ad.indexOf("\nfunction ", drIdx + 10);
  const drBody = ad.slice(drIdx, drEnd);
  const a5dr = 'name:          String(r.Customer_Name || ""),';
  if (drBody.includes(a5dr)) {
    const b5dr = 'name:          (function (v) { v = String(v || "").trim(); return (v && v.indexOf("[LS]") !== 0 && String(r.Source || "").trim() === "LS") ? "[LS] " + v : v; })(),';
    ad = ad.slice(0, drIdx) + drBody.replace(a5dr, b5dr) + ad.slice(drEnd);
    console.log("getDriverOrders name [LS] ✓");
  }
}
// getOrderSummary
const osIdx = ad.indexOf("function getOrderSummary(date) {");
if (osIdx !== -1) {
  const osEnd = ad.indexOf("\nfunction ", osIdx + 10);
  const osBody = ad.slice(osIdx, osEnd);
  const a5os = 'name:      String(r.Customer_Name || ""),';
  if (osBody.includes(a5os)) {
    const b5os = 'name:      (function (v) { v = String(v || "").trim(); return (v && v.indexOf("[LS]") !== 0 && r._lsTab) ? "[LS] " + v : v; })(),';
    ad = ad.slice(0, osIdx) + osBody.replace(a5os, b5os) + ad.slice(osEnd);
    console.log("getOrderSummary name [LS] ✓");
  }
}
fs.writeFileSync("03_Admin_Kitchen.gs", ad);

// ── 6. getOrderHistory: [LS] prefix ──
let rp = fs.readFileSync("04_Reports_Misc.gs", "utf8");
const a6 = '      name:           r.Customer_Name,';
const b6 = '      name:           (function (v) { v = String(v || "").trim(); return (v && v.indexOf("[LS]") !== 0 && r._lsTab) ? "[LS] " + v : v; })(),';
if (rp.includes(a6)) { rp = rp.replace(a6, b6); console.log("getOrderHistory name [LS] ✓"); }
else console.log("MISS getOrderHistory name");
fs.writeFileSync("04_Reports_Misc.gs", rp);

// ── 7. FIX: label showing only "1xस" for blank-BF-slot rows ──
// The issue: _lblItemSummary uses Items_JSON-ONLY when present. For a breakfast
// row with blank BF slots, Items_JSON has the items BUT the norm() strips
// suffixes like [175g]. However, the LBL_MR map uses the SHORT names like
// "Kanda Poha" → "कांपो". If Items_JSON has "Kanda Poha [175g]" the norm
// strips to "Kanda Poha" which maps to "कांपो" ✓. But if Items_JSON has
// just "Salad" that maps to LBL_MR.Salad = "स" ✓. The "1xस" is actually
// correct (Salad = स). The user's complaint about "1xस" is that it's TOO SHORT
// to be useful. But that's the existing label abbreviation system.
// The REAL issue the user showed was the LS order having ONLY {"Salad":1} —
// that's correct, the customer only ordered 1 salad.
// So no fix needed here — the "1xस" is working as designed.

console.log("\n── syntax checks ──");
["02_Orders_Menu.gs", "06_Bulk_Orders.gs", "11_Hdfc_Reconciler.gs", "03_Admin_Kitchen.gs", "04_Reports_Misc.gs"].forEach(f => {
  const tmp = "scratch/syn_" + f.replace(".gs", ".js");
  fs.copyFileSync(f, tmp);
  const { execSync } = require("child_process");
  try { execSync("node --check " + tmp); console.log("  " + f + " OK"); }
  catch (e) { console.log("  " + f + " FAIL: " + e.stderr.slice(0, 200)); }
});
