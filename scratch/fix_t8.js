const fs = require("fs");
let c = fs.readFileSync("scratch/test_ls_e2e.js", "utf8");
// seed the 5 streak days ending TODAY (not yesterday) and place the reward order for TOMORROW
const a = "  const days = [];\n  for (let off = 1; days.length < 5 && off < 15; off++) {";
const b = "  const days = [];\n  for (let off = 0; days.length < 5 && off < 15; off++) {";
if (c.includes(a)) { c = c.replace(a, b); } else console.log("seed MISS");
const a2 = '  const today = isoAdd(0);\n  const res = API.submitOrder({ profile: { ...PROFILE, society: "Soc" }, storefront: "LS",\n    orders: [{ date: today, meals:';
const b2 = '  const today = nextNonSunday(1); // future date — immune to tonight\u2019s real cutoffs\n  const res = API.submitOrder({ profile: { ...PROFILE, society: "Soc" }, storefront: "LS",\n    orders: [{ date: today, meals:';
if (c.includes(a2)) { c = c.replace(a2, b2); } else console.log("date MISS");
fs.writeFileSync("scratch/test_ls_e2e.js", c);
console.log("test 8 made date-robust");
