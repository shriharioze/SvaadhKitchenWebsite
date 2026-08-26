const fs = require("fs");
let c = fs.readFileSync("scratch/test_ls_differential.js", "utf8");
const a = `    if (b.delivery !== 0) { ok = false; break; }
    if (a.smallFee !== b.smallFee) { ok = false; break; }
    if (a.baseFood !== b.baseFood) { ok = false; break; }`;
const b = `    if (b.delivery !== 0) { ok = false; break; }
    if (b.smallFee !== 0) { ok = false; break; }  // LS: no small-order fee either
    if (a.baseFood !== b.baseFood) { ok = false; break; }`;
if (c.includes(a)) { c = c.replace(a, b); fs.writeFileSync("scratch/test_ls_differential.js", c); console.log("test4 updated"); }
else console.log("MISS");
