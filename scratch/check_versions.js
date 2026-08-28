const fs = require("fs");
["docs/order.html", "docs/Liviano-Serio.html"].forEach(f => {
  const c = fs.readFileSync(f, "utf8");
  const m = c.match(/APP_VERSION = "([^"]+)"/);
  console.log(f + " -> " + (m ? m[1] : "NOT FOUND"));
});