const fs = require("fs");
const p = "10_Hdfc_Gateway.gs";
let lines = fs.readFileSync(p, "utf8").split("\n");
const idx = lines.findIndex(l => l.includes("Look up phone/name from pending entry"));
if (idx === -1) { console.log("anchor not found"); process.exit(1); }
lines[idx] = '    let phone = "", name = "Customer", _sfFinal = "";';
const helper = [
  '    function pendingEntryStorefront(oid2) {',
  '      try {',
  '        const pending2 = JSON.parse(PropertiesService.getScriptProperties().getProperty("HDFC_PENDING_RECHARGES") || "{}");',
  '        const e2 = pending2[oid2];',
  '        return (e2 && String(e2.storefront || "").toUpperCase() === "LS") ? "LS" : "";',
  '      } catch (_) { return ""; }',
  '    }'
];
lines.splice(idx + 1, 0, ...helper);
fs.writeFileSync(p, lines.join("\n"));
console.log("inserted at line " + (idx + 2));
