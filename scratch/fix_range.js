const fs = require("fs");
let c = fs.readFileSync("scratch/test_ls_differential.js", "utf8");
const a = "  if (ok && (ls.total > main.total || ls.total < main.total - 11 * main.rows.length)) ok = false;";
const b = "  if (ok && (ls.total > main.total || ls.total < main.total - 22 * main.rows.length)) ok = false; // delivery + smallFee both removed";
if (c.includes(a)) { c = c.replace(a, b); fs.writeFileSync("scratch/test_ls_differential.js", c); console.log("range widened"); }
else console.log("MISS");
