const fs = require("fs");
let n = 0;

// ── 0. relocate the getKitchenSummary Items_JSON merge (if still pending) ──
let c03 = fs.readFileSync("03_Admin_Kitchen.gs", "utf8");
const lines = c03.split("\n");
const msIdx = lines.findIndex(l => l.includes("Items_JSON merge (fix 2026-08-25)"));
const pushIdx = lines.findIndex(l => l.trim() === "orders.push({");
const catchIdx = lines.findIndex(l => l.includes("catch (eIJ)"));
if (msIdx !== -1 && pushIdx !== -1 && catchIdx !== -1 && pushIdx < msIdx) {
  // merge currently sits AFTER orders.push → wrong place? verify order:
  console.log("merge at " + (msIdx + 1) + ", orders.push at " + (pushIdx + 1) + " — checking placement");
}
// If merge is before orders.push → correct already. If after → move.
if (msIdx !== -1 && pushIdx !== -1 && msIdx > pushIdx) {
  const catchLine = lines.findIndex(l => l.includes("catch (eIJ)"));
  const block = lines.splice(msIdx, catchLine - msIdx + 1);
  // remove the orphan closing brace that belonged to the else-branch
  if (lines[msIdx] && lines[msIdx].trim() === "}") lines.splice(msIdx, 1);
  let op = lines.findIndex(l => l.trim() === "orders.push({");
  lines.splice(op, 0, ...block);
  fs.writeFileSync("03_Admin_Kitchen.gs", lines.join("\n"));
  console.log("merge relocated before orders.push");
  c03 = fs.readFileSync("03_Admin_Kitchen.gs", "utf8");
} else {
  console.log("merge placement OK (before orders.push) or already moved");
}

// ── 1. getLabelOrders: notes NOT printed on labels (owner request) ──
let a = fs.readFileSync("03_Admin_Kitchen.gs", "utf8");
const notesA = 'notes: String(r.Special_Notes_Kitchen || r.Special_Notes || ""),';
const notesB = 'notes: "", // kitchen notes intentionally NOT printed on labels (owner 2026-08-25)';
if (a.includes(notesA)) { a = a.replace(notesA, notesB); fs.writeFileSync("03_Admin_Kitchen.gs", a); n++; console.log("notes reverted to blank"); }
else console.log("notes already blank / not found");

// ── 2. Harvest Devanagari from kitchen.html MR map → extend label maps ──
const k = fs.readFileSync("docs/Admin/kitchen.html", "utf8");
const mrStart = k.indexOf("const MR = {");
const mrEnd = k.indexOf("};", mrStart);
const mrBody = k.slice(mrStart, mrEnd);
// pull exact values for keys we need (avoid retyping Devanagari)
function mrValue(key) {
  const re = new RegExp('"' + key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + '"\\s*:\\s*"([^"]+)"');
  const m = mrBody.match(re);
  return m ? m[1] : null;
}
const wants = [
  ["Ghee Sheera", "GS", "शिरा fallback"],
  ["Aloo Paratha", "AP", null],
  ["Tikhi Puri", "TPU", null],
  ["Idli", "ID", null],
  ["Chutney", "CCT", null],
  ["Dadpe Pohe", "DP", null]
];
let mrAdd = [], enAdd = [];
wants.forEach(([key, code]) => {
  const dev = mrValue(key);
  if (dev) mrAdd.push('      "' + key + '": "' + dev + '"');
  enAdd.push('      "' + key + '": "' + code + '"');
});
// Idli has no standalone MR key (only the 4x combo) — derive from the combo string
if (!mrValue("Idli")) {
  const combo = mrValue("4 x Idli & 100ml Chutney") || "";
  const idliWord = combo.split(" ")[1] || ""; // "इडली"
  if (idliWord) mrAdd.push('      "Idli": "' + idliWord + '"');
}
console.log("harvested MR:", mrAdd.join(" | "));

// kitchen.html LABEL_MR += missing
let kNew = k;
const kMrAnchor = '      "Paneer Paratha": "पनीर पराठा", "Methi Thepla": "मेथी", "Sabudana Khichdi": "साबु",\n    };';
if (kNew.includes(kMrAnchor)) {
  kNew = kNew.replace(kMrAnchor, '      "Paneer Paratha": "पनीर पराठा", "Methi Thepla": "मेथी", "Sabudana Khichdi": "साबु",\n' + mrAdd.join(",\n") + '\n    };');
  n++; console.log("kitchen LABEL_MR extended");
} else console.log("kitchen LABEL_MR anchor MISS");
const kEnAnchor = '      "Paneer Paratha": "PP", "Methi Thepla": "MT", "Sabudana Khichdi": "SK",\n    };';
if (kNew.includes(kEnAnchor)) {
  kNew = kNew.replace(kEnAnchor, '      "Paneer Paratha": "PP", "Methi Thepla": "MT", "Sabudana Khichdi": "SK",\n' + enAdd.join(",\n") + '\n    };');
  n++; console.log("kitchen LABEL_EN extended");
} else console.log("kitchen LABEL_EN anchor MISS");
fs.writeFileSync("docs/Admin/kitchen.html", kNew);

// 07_Labels_Auto.gs LBL_MR / LBL_EN += same
let l = fs.readFileSync("07_Labels_Auto.gs", "utf8");
const lEnAnchor = '  "Paneer Paratha": "PP", "Methi Thepla": "MT", "Sabudana Khichdi": "SK"\n};';
if (l.includes(lEnAnchor)) {
  l = l.replace(lEnAnchor, '  "Paneer Paratha": "PP", "Methi Thepla": "MT", "Sabudana Khichdi": "SK",\n' + enAdd.map(s => s.trim()).join(",\n  ") + "\n};");
  n++; console.log("07 LBL_EN extended");
} else console.log("07 LBL_EN anchor MISS");
const lMrAnchor = '  "Paneer Paratha": "पनीर पराठा", "Methi Thepla": "मेथी", "Sabudana Khichdi": "साबु"\n};';
if (l.includes(lMrAnchor)) {
  l = l.replace(lMrAnchor, '  "Paneer Paratha": "पनीर पराठा", "Methi Thepla": "मेथी", "Sabudana Khichdi": "साबु",\n' + mrAdd.map(s => s.trim()).join(",\n  ") + "\n};");
  n++; console.log("07 LBL_MR extended");
} else console.log("07 LBL_MR anchor MISS");
fs.writeFileSync("07_Labels_Auto.gs", l);

console.log("done " + n);
