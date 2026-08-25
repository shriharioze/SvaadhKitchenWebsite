const fs = require("fs");
let c = fs.readFileSync("scratch/test_ls_e2e.js", "utf8");
const anchor = "var DEFAULT_ORDER_CAPS = ";
const idx = c.indexOf(anchor);
const lineEnd = c.indexOf("\n", idx);
const insert = '\nvar LS_DROP_COLUMNS = ["Maps_Link", "Landmark"];';
c = c.slice(0, lineEnd) + insert + c.slice(lineEnd);
fs.writeFileSync("scratch/test_ls_e2e.js", c);
console.log("LS_DROP_COLUMNS stub added");
