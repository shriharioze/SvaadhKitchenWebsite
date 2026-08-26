const fs = require("fs");
let rp = fs.readFileSync("04_Reports_Misc.gs", "utf8");
// check if the hook is already there
console.log("has cleanupOrderLog hook:", rp.includes("cleanupOrderLog()"));
console.log("has recoverFromOrderLog hook:", rp.includes("recoverFromOrderLog()"));
// find the runScheduledArchive function
const i = rp.indexOf("function runScheduledArchive");
if (i > -1) console.log(rp.slice(i, i + 600));
