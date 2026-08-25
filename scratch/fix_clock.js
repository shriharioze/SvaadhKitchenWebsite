const fs = require("fs");
let c = fs.readFileSync("scratch/test_archive_policy.js", "utf8");
const a = "var today = String(todayISO || __todayISO).slice(0, 10);";
const b = "var today = String(todayISO || Sandbox.__todayISO).slice(0, 10);";
if (c.includes(a)) { c = c.replace(a, b); fs.writeFileSync("scratch/test_archive_policy.js", c); console.log("clock read made dynamic"); }
else console.log("MISS");
