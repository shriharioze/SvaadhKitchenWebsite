const fs = require("fs");
let c = fs.readFileSync("scratch/test_ls_differential.js", "utf8");
const a = "    if (a.delivery === 11) expectedDiff += 11;   // only rows that CHARGED delivery in main mode";
const b = "    if (a.delivery === 11) expectedDiff += 11;   // delivery removed on LS\n    if (a.smallFee === 11) expectedDiff += 11;   // small-order fee also removed on LS";
if (c.includes(a)) { c = c.replace(a, b); fs.writeFileSync("scratch/test_ls_differential.js", c); console.log("expectedDiff updated"); }
else console.log("MISS");
