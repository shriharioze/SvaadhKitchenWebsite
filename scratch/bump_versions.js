const fs = require("fs");
const NEW_VER = "v26.08.26.01"; // today's date 2026-08-26, first bump of the day
let n = 0;

// kitchen.html — has TWO version markers (APP_VERSION + KITCHEN_VERSION)
let k = fs.readFileSync("docs/Admin/kitchen.html", "utf8");
// Replace all old version strings with the new one
k = k.replace(/APP_VERSION = "v[\d.]+"/g, 'APP_VERSION = "' + NEW_VER + '"');
k = k.replace(/KITCHEN_VERSION = "v[\d.]+"/g, 'KITCHEN_VERSION = "' + NEW_VER + '"');
// Also any meta app-version tags
k = k.replace(/app-version" content="v[\d.]+"/g, 'app-version" content="' + NEW_VER + '"');
fs.writeFileSync("docs/Admin/kitchen.html", k);
console.log("kitchen.html → " + NEW_VER); n++;

// vault_admin.html
let va = fs.readFileSync("docs/Admin/vault_admin.html", "utf8");
va = va.replace(/APP_VERSION = "v[\d.]+"/g, 'APP_VERSION = "' + NEW_VER + '"');
va = va.replace(/app-version" content="v[\d.]+"/g, 'app-version" content="' + NEW_VER + '"');
fs.writeFileSync("docs/Admin/vault_admin.html", va);
console.log("vault_admin.html → " + NEW_VER); n++;

// driver.html — fix double-v bug + normalize
let dr = fs.readFileSync("docs/Admin/driver.html", "utf8");
dr = dr.replace(/APP_VERSION = "v[\d.]+"/g, 'APP_VERSION = "' + NEW_VER + '"');
dr = dr.replace(/APP_VERSION = "vv[\d.]+"/g, 'APP_VERSION = "' + NEW_VER + '"');
dr = dr.replace(/app-version" content="vv[\d.]+"/g, 'app-version" content="' + NEW_VER + '"');
dr = dr.replace(/app-version" content="v[\d.]+"/g, 'app-version" content="' + NEW_VER + '"');
fs.writeFileSync("docs/Admin/driver.html", dr);
console.log("driver.html → " + NEW_VER); n++;

// Liviano-Serio.html
let ls = fs.readFileSync("docs/Liviano-Serio.html", "utf8");
ls = ls.replace(/APP_VERSION = "v[\d.]+"/g, 'APP_VERSION = "' + NEW_VER + '"');
ls = ls.replace(/APP_VERSION = "v[\d.]+\.[A-Z]+\.[\d]+"/g, 'APP_VERSION = "' + NEW_VER + '"');
ls = ls.replace(/app-version" content="v[\d.]+"/g, 'app-version" content="' + NEW_VER + '"');
fs.writeFileSync("docs/Liviano-Serio.html", ls);
console.log("Liviano-Serio.html → " + NEW_VER); n++;

// order.html — NOT modified in this round, leave as-is
console.log("order.html — NOT bumped (not modified in this round)");

// verify
for (const f of ["docs/Admin/kitchen.html", "docs/Admin/vault_admin.html", "docs/Admin/driver.html", "docs/Liviano-Serio.html"]) {
  const c = fs.readFileSync(f, "utf8");
  const m = c.match(/APP_VERSION = "([^"]+)"/);
  console.log("  verify " + f + " => " + (m ? m[1] : "?"));
}
console.log("done " + n + "/4");
