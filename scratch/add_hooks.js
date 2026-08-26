const fs = require("fs");
let rp = fs.readFileSync("04_Reports_Misc.gs", "utf8");
const oldLine = "  Logger.log(\"Scheduled archive result: \" + JSON.stringify(result));";
const newLine = "  Logger.log(\"Scheduled archive result: \" + JSON.stringify(result));\n  try { cleanupOrderLog(); } catch (_) {}\n  try { recoverFromOrderLog(); } catch (_) {}";
if (rp.includes(oldLine) && !rp.includes("cleanupOrderLog(); } catch (_)")) {
  rp = rp.replace(oldLine, newLine);
  fs.writeFileSync("04_Reports_Misc.gs", rp);
  console.log("hooks added ✓");
} else console.log("already hooked or MISS");
