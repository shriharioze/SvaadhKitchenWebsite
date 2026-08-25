const fs = require("fs");
const p = "10_Hdfc_Gateway.gs";
let lines = fs.readFileSync(p, "utf8").split("\n");
const dupIdx = 2142; // 0-based → line 2143
if (lines[dupIdx] && lines[dupIdx].includes('let phone = ""')) {
  lines.splice(dupIdx, 1);
  fs.writeFileSync(p, lines.join("\n"));
  console.log("removed duplicate declaration");
} else {
  console.log("unexpected content at 2143: " + (lines[dupIdx] || "").trim());
}
