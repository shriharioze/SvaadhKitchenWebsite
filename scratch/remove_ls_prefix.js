const fs = require("fs");
let n = 0;

// ── 1. submitOrder: REMOVE [LS] prefix ──
let c = fs.readFileSync("02_Orders_Menu.gs", "utf8");
const a1 = 'set("Customer_Name",       _isLS ? "[LS] " + (profile.name || "") : (profile.name || ""));';
const b1 = 'set("Customer_Name",       profile.name     || "");';
if (c.includes(a1)) { c = c.replace(a1, b1); n++; console.log("submitOrder reverted ✓"); }
else console.log("submitOrder MISS");

// ── 2. bulk: REMOVE ──
let bk = fs.readFileSync("06_Bulk_Orders.gs", "utf8");
const a2 = 'set("Customer_Name", _sfBulk === "LS" ? "[LS] " + name : name);';
const b2 = 'set("Customer_Name", name);';
if (bk.includes(a2)) { bk = bk.replace(a2, b2); n++; console.log("bulk reverted ✓"); }
else console.log("bulk MISS");
fs.writeFileSync("06_Bulk_Orders.gs", bk);

// ── 3. reconciler: REMOVE ──
let rc = fs.readFileSync("11_Hdfc_Reconciler.gs", "utf8");
const a3 = '      name:               (String(entry.storefront || "").trim().toUpperCase() === "LS" ? "[LS] " : "") + (profile.name || "Customer"),';
const b3 = '      name:               profile.name    || "Customer",';
if (rc.includes(a3)) { rc = rc.replace(a3, b3); n++; console.log("reconciler reverted ✓"); }
else console.log("reconciler MISS");
fs.writeFileSync("11_Hdfc_Reconciler.gs", rc);

// ── 4. getLabelOrders: REMOVE read-time prepend ──
let ad = fs.readFileSync("03_Admin_Kitchen.gs", "utf8");
const a4 = '      name:  (function (v) { v = String(v || "").trim(); return (v && v.indexOf("[LS]") !== 0 && String(r.Source || "").trim() === "LS") ? "[LS] " + v : v; })(),';
const b4 = '      name:  String(r.Customer_Name || ""),';
if (ad.includes(a4)) { ad = ad.split(a4).join(b4); n++; console.log("getLabelOrders reverted ✓"); }
else console.log("getLabelOrders MISS");

// ── 5. getKitchenSummary: REMOVE ──
const a5 = '      Customer_Name: (r._lsTab && !String(r.Customer_Name || "").trim().startsWith("[LS]")) ? "[LS] " + String(r.Customer_Name || "") : String(r.Customer_Name || ""),';
const b5 = '      Customer_Name: String(r.Customer_Name || ""),';
if (ad.includes(a5)) { ad = ad.replace(a5, b5); n++; console.log("getKitchenSummary reverted ✓"); }
else console.log("getKitchenSummary MISS");

// ── 6. getDriverOrders: REMOVE ──
const a6 = 'name:          (String(r.Source || "").trim() === "LS" && !String(r.Customer_Name || "").trim().startsWith("[LS]")) ? "[LS] " + String(r.Customer_Name || "") : String(r.Customer_Name || ""),';
const b6 = 'name:          String(r.Customer_Name || ""),';
if (ad.includes(a6)) { ad = ad.replace(a6, b6); n++; console.log("getDriverOrders reverted ✓"); }
else console.log("getDriverOrders MISS");

// ── 7. getOrderSummary: REMOVE ──
const a7 = 'name:      (r._lsTab && !String(r.Customer_Name || "").trim().startsWith("[LS]")) ? "[LS] " + String(r.Customer_Name || "") : String(r.Customer_Name || ""),';
const b7 = 'name:      String(r.Customer_Name || ""),';
if (ad.includes(a7)) { ad = ad.replace(a7, b7); n++; console.log("getOrderSummary reverted ✓"); }
else console.log("getOrderSummary MISS");

fs.writeFileSync("03_Admin_Kitchen.gs", ad);

// ── 8. getOrderHistory: REMOVE ──
let rp = fs.readFileSync("04_Reports_Misc.gs", "utf8");
const a8 = '      name:           (r._lsTab && !String(r.Customer_Name || "").trim().startsWith("[LS]")) ? "[LS] " + String(r.Customer_Name || "") : String(r.Customer_Name || ""),';
const b8 = '      name:           r.Customer_Name,';
if (rp.includes(a8)) { rp = rp.replace(a8, b8); n++; console.log("getOrderHistory reverted ✓"); }
else console.log("getOrderHistory MISS");
fs.writeFileSync("04_Reports_Misc.gs", rp);

// ── 9. Add admin endpoint to strip [LS] from existing sheet data ──
let cg = fs.readFileSync("Code.gs", "utf8");
const diagAnchor = 'if (action === "fixCustomerPins")';
const stripEndpoint = '    if (action === "stripLSPrefix") { if (!isAdmin) return jsonRes({ error: "STRICT ADMIN PIN REQUIRED" }); return jsonRes(stripLSPrefix(p.commit === "1")); } // remove [LS] prefix from Customer_Name in LS_Orders (dry-run unless commit=1)\n';
if (cg.includes(diagAnchor) && !cg.includes("stripLSPrefix")) {
  cg = cg.replace(diagAnchor, stripEndpoint + diagAnchor);
  fs.writeFileSync("Code.gs", cg);
  n++; console.log("stripLSPrefix endpoint ✓");
}

// Add the strip function to 02_Orders_Menu.gs
let om = fs.readFileSync("02_Orders_Menu.gs", "utf8");
if (!om.includes("function stripLSPrefix")) {
  const stripFn = `

// ── STRIP [LS] PREFIX: remove [LS] from Customer_Name in LS_Orders ──
// One-time cleanup for rows created before the prefix was reverted.
function stripLSPrefix(commit) {
  var ss = getSpreadsheet();
  var ws = ss.getSheetByName(TAB_LS_ORDERS);
  if (!ws || ws.getLastRow() < 2) return { success: true, note: "LS_Orders empty or missing" };
  var data = ws.getDataRange().getValues();
  var headers = data[0];
  var nameIdx = headers.indexOf("Customer_Name");
  if (nameIdx === -1) return { success: false, error: "Customer_Name column not found" };
  var fixed = 0;
  for (var i = 1; i < data.length; i++) {
    var v = String(data[i][nameIdx] || "").trim();
    if (v.indexOf("[LS] ") === 0) {
      if (commit === true || commit === "true") {
        ws.getRange(i + 1, nameIdx + 1).setValue(v.slice(5));
      }
      fixed++;
    }
  }
  return { success: true, dryRun: !(commit === true || commit === "true"), stripped: fixed };
}
`;
  om += stripFn;
  fs.writeFileSync("02_Orders_Menu.gs", om);
  n++; console.log("stripLSPrefix function ✓");
}

// ── syntax checks ──
["02_Orders_Menu.gs", "03_Admin_Kitchen.gs", "04_Reports_Misc.gs", "06_Bulk_Orders.gs", "11_Hdfc_Reconciler.gs", "Code.gs"].forEach(f => {
  fs.copyFileSync(f, "scratch/syn_" + f.replace(".gs", ".js"));
});
console.log("done " + n);
