const fs = require("fs");
const p = "03_Admin_Kitchen.gs";
let lines = fs.readFileSync(p, "utf8").split("\n");
// merge block currently: idx 1076 ("// ── Items_JSON merge...") through idx 1125 ("} catch (eIJ)..."),
// followed by idx 1126 "}" (which closes the L/D else-branch).
// Move block AFTER that closing brace so it runs for BOTH branches.
const blockStart = 1076;
const catchIdx = 1125;
const closingIdx = 1126;
if (!lines[blockStart].includes("Items_JSON merge")) { console.log("anchor fail: " + lines[blockStart]); process.exit(1); }
if (!lines[catchIdx].includes("catch (eIJ)")) { console.log("catch fail: " + lines[catchIdx]); process.exit(1); }
const block = lines.splice(blockStart, catchIdx - blockStart + 1); // remove merge
// after removal, old idx 1126 ("}") is now at index blockStart
if (!lines[blockStart].trim().startsWith("}")) { console.log("expected closing brace at cut point, got: " + lines[blockStart]); process.exit(1); }
// find the following "orders.push({" (now at blockStart+1 after the brace line at blockStart, blank line at +1)
let opIdx = -1;
for (let i = blockStart; i < blockStart + 6; i++) { if (lines[i].trim() === "orders.push({") { opIdx = i; break; } }
if (opIdx === -1) { console.log("orders.push not found near cut"); process.exit(1); }
// insert merge block right before orders.push
lines.splice(opIdx, 0, ...block);
fs.writeFileSync(p, lines.join("\n"));
console.log("merge block relocated to run for BOTH branches (now before orders.push at line " + (opIdx + 1) + ")");
