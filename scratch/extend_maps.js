const fs = require("fs");
let n = 0;

// New translations (Devanagari + transliterated codes) for items missing coverage
const NEW_MR = [
  '      "Ghee Sheera": "घी शिरा", "Sheera": "शिरा", "Aloo Paratha": "आलू पराठा", "Tikhi Puri": "तिखी पुरी", "Tikhi Pudi": "तिखी पुडी",',
  '      "Idli": "इडली", "Coconut Chutney": "खोबरेल चटणी", "Chutney": "चटणी", "Dadpe Pohe": "दापपे पोहे", "Masala Dosa": "मसाला डोसा",',
  '      "Upma": "उपमा", "Poha": "पोहे",'
].join("\n");
const NEW_EN = [
  '      "Ghee Sheera": "GS", "Sheera": "SH", "Aloo Paratha": "AP", "Tikhi Puri": "TPU", "Tikhi Pudi": "TPD",',
  '      "Idli": "ID", "Coconut Chutney": "CCT", "Chutney": "CCT", "Dadpe Pohe": "DP", "Masala Dosa": "MD",',
  '      "Upma": "UP", "Poha": "PO",'
].join("\n");

function extendMap(text, constName) {
  // insert before the closing "};" of the given const's object
  const start = text.indexOf("const " + constName + " = {");
  if (start === -1) return { text, ok: false };
  const close = text.indexOf("};", start);
  if (close === -1) return { text, ok: false };
  // strip trailing comma on the last entry line before };
  let before = text.slice(0, close);
  let after = text.slice(close);
  before = before.replace(/,\s*$/, "");       // trailing comma after last entry
  // re-add comma separation
  return { text: before + ",\n" + (constName.startsWith("LABEL") ? "      " : "  ") + "@@ENTRIES@@" + "\n" + (constName.startsWith("LABEL") ? "    " : "") + after, ok: true };
}

// ── kitchen.html: LABEL_EN + LABEL_MR ──
let k = fs.readFileSync("docs/Admin/kitchen.html", "utf8");
let r = extendMap(k, "LABEL_EN");
if (r.ok) { k = r.text.replace("@@ENTRIES@@", NEW_EN); n++; console.log("kitchen LABEL_EN extended"); } else console.log("LABEL_EN MISS");
r = extendMap(k, "LABEL_MR");
if (r.ok) { k = r.text.replace("@@ENTRIES@@", NEW_MR); n++; console.log("kitchen LABEL_MR extended"); } else console.log("LABEL_MR MISS");
fs.writeFileSync("docs/Admin/kitchen.html", k);

// ── 07_Labels_Auto.gs: LBL_EN + LBL_MR ──
let l = fs.readFileSync("07_Labels_Auto.gs", "utf8");
r = extendMap(l, "LBL_EN");
if (r.ok) { l = r.text.replace("@@ENTRIES@@", NEW_EN.replace(/      /g, "  ")); n++; console.log("07 LBL_EN extended"); } else console.log("LBL_EN MISS");
r = extendMap(l, "LBL_MR");
if (r.ok) { l = r.text.replace("@@ENTRIES@@", NEW_MR.replace(/      /g, "  ")); n++; console.log("07 LBL_MR extended"); } else console.log("LBL_MR MISS");
fs.writeFileSync("07_Labels_Auto.gs", l);

console.log("done " + n + "/4");
