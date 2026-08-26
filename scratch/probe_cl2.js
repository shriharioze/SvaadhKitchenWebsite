const fs = require("fs");
const c = fs.readFileSync("04_Reports_Misc.gs", "utf8");
const s = c.indexOf("function getCustomerList() {");
const e = c.indexOf("\nfunction ", s + 10);
fs.writeFileSync("scratch/probe_cl_full.txt", c.slice(s, e), "utf8");
console.log("ok, length: " + (e - s));
