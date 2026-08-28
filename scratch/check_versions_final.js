const fs = require("fs");
const files = [
  "docs/order.html",
  "docs/Liviano-Serio.html",
  "docs/Admin/kitchen.html",
  "docs/Admin/vault_admin.html",
  "docs/Admin/driver.html"
];
files.forEach(f => {
  const c = fs.readFileSync(f, "utf8");
  const m = c.match(/APP_VERSION = "([^"]+)"/);
  if (!m) {
    const m2 = c.match(/app-version" content="([^"]+)"/);
    if (m2) console.log(f + " => " + m2[1]);
    else console.log(f + " => NOT FOUND");
  } else {
    console.log(f + " => " + m[1]);
  }
});
const cfg = fs.readFileSync("00_Config.gs", "utf8");
const cm = cfg.match(/CODE_VERSION = ([\d.]+)/);
console.log("Backend CODE_VERSION:", cm ? cm[1] : "?");