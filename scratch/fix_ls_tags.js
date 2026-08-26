const fs = require("fs");
let n = 0;

// ── 1. submitOrder: RE-ADD [LS] prefix ──
let c = fs.readFileSync("02_Orders_Menu.gs", "utf8");
const a1 = 'set("Customer_Name",       profile.name     || "");';
const b1 = 'set("Customer_Name",       _isLS ? "[LS] " + (profile.name     || "") : (profile.name     || ""));';
if (c.includes(a1)) { c = c.replace(a1, b1); n++; console.log("submitOrder [LS] re-added ✓"); }
else console.log("submitOrder MISS");
fs.writeFileSync("02_Orders_Menu.gs", c);

// ── 2. bulk: RE-ADD ──
let bk = fs.readFileSync("06_Bulk_Orders.gs", "utf8");
const a2 = 'set("Customer_Name", name);';
const b2 = 'set("Customer_Name", _sfBulk === "LS" ? "[LS] " + name : name);';
if (bk.includes(a2)) { bk = bk.replace(a2, b2); n++; console.log("bulk [LS] re-added ✓"); }
else console.log("bulk MISS");
fs.writeFileSync("06_Bulk_Orders.gs", bk);

// ── 3. reconciler: RE-ADD ──
let rc = fs.readFileSync("11_Hdfc_Reconciler.gs", "utf8");
const a3 = '      name:               profile.name    || "Customer",';
const b3 = '      name:               (String(entry.storefront || "").trim().toUpperCase() === "LS" ? "[LS] " : "") + (profile.name || "Customer"),';
if (rc.includes(a3)) { rc = rc.replace(a3, b3); n++; console.log("reconciler [LS] re-added ✓"); }
else console.log("reconciler MISS");
fs.writeFileSync("11_Hdfc_Reconciler.gs", rc);

// ── 4. getLabelOrders: RE-ADD read-time prepend for legacy rows ──
let ad = fs.readFileSync("03_Admin_Kitchen.gs", "utf8");
const a4 = '      name:  String(r.Customer_Name || ""),';
const b4 = '      name:  (String(r.Source || "").trim() === "LS" && !String(r.Customer_Name || "").trim().indexOf("[LS]") === 0) ? "[LS] " + String(r.Customer_Name || "") : String(r.Customer_Name || ""),';
// Simpler: prepend only if Source=LS AND name doesn't already start with [LS]
const b4v2 = '      name:  (String(r.Source || "").trim() === "LS" && String(r.Customer_Name || "").trim().indexOf("[LS]") !== 0) ? "[LS] " + String(r.Customer_Name || "") : String(r.Customer_Name || ""),';
if (ad.includes(a4)) { ad = ad.split(a4).join(b4v2); n++; console.log("getLabelOrders [LS] re-added ✓ (all occurrences)"); }
else console.log("getLabelOrders MISS");

// ── 5. getKitchenSummary: RE-ADD ──
const a5 = '      Customer_Name: String(r.Customer_Name || ""),';
// Only inside getKitchenSummary — use targeted replace
const ksIdx = ad.indexOf("function getKitchenSummary(date) {");
if (ksIdx !== -1) {
  const ksEnd = ad.indexOf("\nfunction ", ksIdx + 10);
  let ksBody = ad.slice(ksIdx, ksEnd);
  if (ksBody.includes(a5)) {
    const b5 = '      Customer_Name: (String(r.Source || "").trim() === "LS" && String(r.Customer_Name || "").trim().indexOf("[LS]") !== 0) ? "[LS] " + String(r.Customer_Name || "") : String(r.Customer_Name || ""),';
    ksBody = ksBody.replace(a5, b5);
    ad = ad.slice(0, ksIdx) + ksBody + ad.slice(ksEnd);
    n++; console.log("getKitchenSummary [LS] re-added ✓");
  } else console.log("getKitchenSummary MISS");
}

// ── 6. getDriverOrders: RE-ADD ──
const drIdx = ad.indexOf("function getDriverOrders(date) {");
if (drIdx !== -1) {
  const drEnd = ad.indexOf("\nfunction ", drIdx + 10);
  let drBody = ad.slice(drIdx, drEnd);
  const a6 = 'name:          String(r.Customer_Name || ""),';
  if (drBody.includes(a6)) {
    const b6 = 'name:          (String(r.Source || "").trim() === "LS" && String(r.Customer_Name || "").trim().indexOf("[LS]") !== 0) ? "[LS] " + String(r.Customer_Name || "") : String(r.Customer_Name || ""),';
    drBody = drBody.replace(a6, b6);
    ad = ad.slice(0, drIdx) + drBody + ad.slice(drEnd);
    n++; console.log("getDriverOrders [LS] re-added ✓");
  } else console.log("getDriverOrders MISS");
}

// ── 7. getOrderSummary: RE-ADD ──
const osIdx = ad.indexOf("function getOrderSummary(date) {");
if (osIdx !== -1) {
  const osEnd = ad.indexOf("\nfunction ", osIdx + 10);
  let osBody = ad.slice(osIdx, osEnd);
  const a7 = 'name:      String(r.Customer_Name || ""),';
  if (osBody.includes(a7)) {
    const b7 = 'name:      (String(r.Source || "").trim() === "LS" && String(r.Customer_Name || "").trim().indexOf("[LS]") !== 0) ? "[LS] " + String(r.Customer_Name || "") : String(r.Customer_Name || ""),';
    osBody = osBody.replace(a7, b7);
    ad = ad.slice(0, osIdx) + osBody + ad.slice(osEnd);
    n++; console.log("getOrderSummary [LS] re-added ✓");
  } else console.log("getOrderSummary MISS");
}
fs.writeFileSync("03_Admin_Kitchen.gs", ad);

// ── 8. getOrderHistory: RE-ADD ──
let rp = fs.readFileSync("04_Reports_Misc.gs", "utf8");
const a8 = '      name:           r.Customer_Name,';
const b8 = '      name:           (String(r.Source || "").trim() === "LS" && String(r.Customer_Name || "").trim().indexOf("[LS]") !== 0) ? "[LS] " + String(r.Customer_Name || "") : String(r.Customer_Name || ""),';
if (rp.includes(a8)) { rp = rp.replace(a8, b8); n++; console.log("getOrderHistory [LS] re-added ✓"); }
else console.log("getOrderHistory MISS");
fs.writeFileSync("04_Reports_Misc.gs", rp);

// ── 9. vault_admin.html: REMOVE the [LS] badge (name already carries it) ──
let va = fs.readFileSync("docs/Admin/vault_admin.html", "utf8");
// Order summary table badge
const badge1 = /\$\{c\.ls \? ' <span style="display:inline-block;margin-left:4px[^"]*"\>\[LS\]<\/span>' : ''\}/;
if (badge1.test(va)) {
  va = va.replace(/\$\{c\.ls \? ' <span style="display:inline-block;margin-left:4px[^}]*\[LS\]<\/span>' : ''\}/, "");
  n++; console.log("vault_admin order summary badge removed ✓");
} else console.log("vault_admin order badge MISS (may use different pattern)");
// Order history table badge
const badge2 = /\$\{o\.ls \? ' <span style="display:inline-block;padding:2px 7px[^}]*\[LS\]<\/span>' : ''\}/g;
let b2count = 0;
va = va.replace(badge2, function () { b2count++; return ""; });
if (b2count > 0) { n++; console.log("vault_admin history badges removed ✓ (" + b2count + ")"); }
else console.log("vault_admin history badge MISS (may use different pattern)");
fs.writeFileSync("docs/Admin/vault_admin.html", va);

// ── syntax checks ──
["02_Orders_Menu.gs", "03_Admin_Kitchen.gs", "04_Reports_Misc.gs", "06_Bulk_Orders.gs", "11_Hdfc_Reconciler.gs"].forEach(f => {
  fs.copyFileSync(f, "scratch/syn_" + f.replace(".gs", ".js"));
});
console.log("done " + n);
