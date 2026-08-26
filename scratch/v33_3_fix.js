const fs = require("fs");
let ad = fs.readFileSync("03_Admin_Kitchen.gs", "utf8");
let n = 0;

// ── getLabelOrders: [LS] prefix on name (prepend for existing rows without it) ──
const a4 = '      name:  String(r.Customer_Name || ""),';
if (ad.includes(a4)) {
  const b4 = '      name:  (function (v) { v = String(v || "").trim(); return (v && v.indexOf("[LS]") !== 0 && String(r.Source || "").trim() === "LS") ? "[LS] " + v : v; })(),';
  ad = ad.split(a4).join(b4); // replace ALL occurrences (getLabelOrders + any other function with same pattern)
  n++; console.log("getLabelOrders/etc name [LS] ✓ (all occurrences)");
} else console.log("getLabelOrders name pattern MISS");

// ── getKitchenSummary: [LS] prefix ──
const ksIdx = ad.indexOf("function getKitchenSummary(date) {");
if (ksIdx !== -1) {
  const ksEnd = ad.indexOf("\nfunction ", ksIdx + 10);
  let ksBody = ad.slice(ksIdx, ksEnd);
  // The orders.push inside getKitchenSummary has: Customer_Name: String(r.Customer_Name || ""),
  const a5 = '      Customer_Name: String(r.Customer_Name || ""),';
  if (ksBody.includes(a5)) {
    const b5 = '      Customer_Name: (r._lsTab && !String(r.Customer_Name || "").trim().startsWith("[LS]")) ? "[LS] " + String(r.Customer_Name || "") : String(r.Customer_Name || ""),';
    ksBody = ksBody.replace(a5, b5);
    ad = ad.slice(0, ksIdx) + ksBody + ad.slice(ksEnd);
    n++; console.log("getKitchenSummary name [LS] ✓");
  } else console.log("getKitchenSummary Customer_Name MISS");
}

// ── getDriverOrders: [LS] prefix ──
const drIdx = ad.indexOf("function getDriverOrders(date) {");
if (drIdx !== -1) {
  const drEnd = ad.indexOf("\nfunction ", drIdx + 10);
  let drBody = ad.slice(drIdx, drEnd);
  const a5dr = 'name:          String(r.Customer_Name || ""),';
  if (drBody.includes(a5dr)) {
    const b5dr = 'name:          (String(r.Source || "").trim() === "LS" && !String(r.Customer_Name || "").trim().startsWith("[LS]")) ? "[LS] " + String(r.Customer_Name || "") : String(r.Customer_Name || ""),';
    drBody = drBody.replace(a5dr, b5dr);
    ad = ad.slice(0, drIdx) + drBody + ad.slice(drEnd);
    n++; console.log("getDriverOrders name [LS] ✓");
  } else console.log("getDriverOrders MISS");
}

// ── getOrderSummary: [LS] prefix ──
const osIdx = ad.indexOf("function getOrderSummary(date) {");
if (osIdx !== -1) {
  const osEnd = ad.indexOf("\nfunction ", osIdx + 10);
  let osBody = ad.slice(osIdx, osEnd);
  const a5os = 'name:      String(r.Customer_Name || ""),';
  if (osBody.includes(a5os)) {
    const b5os = 'name:      (r._lsTab && !String(r.Customer_Name || "").trim().startsWith("[LS]")) ? "[LS] " + String(r.Customer_Name || "") : String(r.Customer_Name || ""),';
    osBody = osBody.replace(a5os, b5os);
    ad = ad.slice(0, osIdx) + osBody + ad.slice(osEnd);
    n++; console.log("getOrderSummary name [LS] ✓");
  } else console.log("getOrderSummary MISS");
}

fs.writeFileSync("03_Admin_Kitchen.gs", ad);
console.log("03 done " + n);

// ── 04_Reports_Misc.gs: getOrderHistory ──
let rp = fs.readFileSync("04_Reports_Misc.gs", "utf8");
const a6 = '      name:           r.Customer_Name,';
if (rp.includes(a6)) {
  const b6 = '      name:           (r._lsTab && !String(r.Customer_Name || "").trim().startsWith("[LS]")) ? "[LS] " + String(r.Customer_Name || "") : String(r.Customer_Name || ""),';
  rp = rp.replace(a6, b6);
  fs.writeFileSync("04_Reports_Misc.gs", rp);
  console.log("getOrderHistory name [LS] ✓");
} else console.log("getOrderHistory MISS");

// ── syntax checks ──
["03_Admin_Kitchen.gs", "04_Reports_Misc.gs"].forEach(f => {
  fs.copyFileSync(f, "scratch/syn_" + f.replace(".gs", ".js"));
});

// ── version bumps ──
// kitchen.html
let kh = fs.readFileSync("docs/Admin/kitchen.html", "utf8");
const kvm = kh.match(/KITCHEN_VERSION = "([^"]+)"/) || kh.match(/APP_VERSION = "([^"]+)"/);
if (kvm) {
  const oldV = kvm[1];
  const parts = oldV.split(".");
  parts[parts.length - 1] = String(Number(parts[parts.length - 1]) + 1).padStart(2, "0");
  const newV = parts.join(".");
  kh = kh.replace(oldV, newV);
  fs.writeFileSync("docs/Admin/kitchen.html", kh);
  console.log("kitchen.html version: " + oldV + " → " + newV);
} else console.log("kitchen version MISS");

// vault_admin.html
let va = fs.readFileSync("docs/Admin/vault_admin.html", "utf8");
const vam = va.match(/APP_VERSION = "([^"]+)"/);
if (vam) {
  const oldV = vam[1];
  const parts = oldV.split(".");
  parts[parts.length - 1] = String(Number(parts[parts.length - 1]) + 1).padStart(2, "0");
  const newV = parts.join(".");
  va = va.replace('const APP_VERSION = "' + oldV + '"', 'const APP_VERSION = "' + newV + '"');
  fs.writeFileSync("docs/Admin/vault_admin.html", va);
  console.log("vault_admin version: " + oldV + " → " + newV);
} else console.log("vault_admin version MISS");

// driver.html
let dr = fs.readFileSync("docs/Admin/driver.html", "utf8");
const drm = dr.match(/APP_VERSION = "([^"]+)"/) || dr.match(/app-version.*?v([\d.]+)/);
if (drm) {
  const oldV = drm[1] || drm[0];
  console.log("driver.html current version marker:", oldV);
  // bump
  const parts = oldV.replace("v","").split(".");
  parts[parts.length - 1] = String(Number(parts[parts.length - 1]) + 1).padStart(2, "0");
  const newV = "v" + parts.join(".");
  dr = dr.replace(oldV, newV);
  fs.writeFileSync("docs/Admin/driver.html", dr);
  console.log("driver.html version → " + newV);
} else console.log("driver version MISS");

// LS page
let ls = fs.readFileSync("docs/Liviano-Serio.html", "utf8");
const lsm = ls.match(/APP_VERSION = "([^"]+)"/);
if (lsm) {
  const oldV = lsm[1];
  const numPart = oldV.replace("v", ""); // e.g. "26.08.24.LS.05"
  const lsParts = numPart.split(".");
  lsParts[lsParts.length - 1] = String(Number(lsParts[lsParts.length - 1]) + 1).padStart(2, "0");
  const newV = "v" + lsParts.join(".");
  ls = ls.replace('const APP_VERSION = "' + oldV + '"', 'const APP_VERSION = "' + newV + '"');
  fs.writeFileSync("docs/Liviano-Serio.html", ls);
  console.log("LS page version: " + oldV + " → " + newV);
} else console.log("LS version MISS");

// syntax
["03_Admin_Kitchen.gs", "04_Reports_Misc.gs"].forEach(f => {
  const { execSync } = require("child_process");
  try { execSync("node --check scratch/syn_" + f.replace(".gs", ".js")); console.log(f + " OK"); }
  catch (e) { console.log(f + " FAIL: " + e.stderr.slice(0, 200)); }
});
