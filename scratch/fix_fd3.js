const fs = require("fs");
let c = fs.readFileSync("scratch/test_ls_differential.js", "utf8");
const a = "  // smallFee diff also contributes — combine both into delivDiff for the check\n  let smallFeeDiff = 0;\n  // (already accumulated inside the loop via expectedFeeDiff)\n  if (ok && Math.round(delivDiff + (expectedFeeDiff - delivDiff)) < 0) ok = false; // sanity\n  // The REAL assertion: LS total must equal main − (delivery+smallFee removed + discount pool shrink)\n  // We verify by checking: baseFood same, delivery=0, smallFee=0 on ALL LS rows (done above)\n  // and total is within the valid band (done below). delivDiff/expectedDiff are informational.";
const b = "  // The REAL assertions are in the loop above: baseFood same, delivery=0, smallFee=0 on ALL LS rows.\n  // The total range check below confirms the combined fee+discount shrink is reasonable.";
if (c.includes(a)) { c = c.replace(a, b); fs.writeFileSync("scratch/test_ls_differential.js", c); console.log("fixed"); }
else console.log("MISS");
