const fs = require("fs");
const p = "03_Admin_Kitchen.gs";
let lines = fs.readFileSync(p, "utf8").split("\n");
// locate dynamically
let ms = -1, me = -1, op = -1;
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes("Items_JSON merge (fix 2026-08-25)") && ms === -1) ms = i;
  if (lines[i].includes("catch (eIJ)")) me = i;
  if (ms !== -1 && me !== -1 && lines[i].trim() === "orders.push({") { op = i; break; }
}
if (ms === -1 || me === -1 || op === -1) { console.log("anchors missing", ms, me, op); process.exit(1); }
// block = ms .. me (inclusive). The line AFTER me (me+1) is the "}" that closes the L/D else-branch — keep it.
if (!lines[me + 1] || lines[me + 1].trim() !== "}") { console.log("expected } after catch, got: " + lines[me + 1]); process.exit(1); }
const block = lines.splice(ms, me - ms + 1); // pull merge out (leaves the else's closing "}" in place)
// after removal, find orders.push again
let op2 = -1;
for (let i = ms; i < lines.length; i++) { if (lines[i].trim() === "orders.push({") { op2 = i; break; } }
if (op2 === -1) { console.log("orders.push lost"); process.exit(1); }
lines.splice(op2, 0, ...block);
fs.writeFileSync(p, lines.join("\n"));
console.log("merge relocated: now between the if/else close and orders.push (line " + (op2 + 1) + ")");
