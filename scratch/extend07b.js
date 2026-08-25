const fs = require("fs");
let l = fs.readFileSync("07_Labels_Auto.gs", "utf8");
const NEW_MR = '  "Ghee Sheera": "घी शिरा", "Sheera": "शिरा", "Aloo Paratha": "आलू पराठा", "Tikhi Puri": "तिखी पुरी", "Tikhi Pudi": "तिखी पुडी",\n  "Idli": "इडली", "Coconut Chutney": "खोबरेल चटणी", "Chutney": "चटणी", "Dadpe Pohe": "दापपे पोहे", "Masala Dosa": "मसाला डोसा",\n  "Upma": "उपमा", "Poha": "पोहे"';
const NEW_EN = '  "Ghee Sheera": "GS", "Sheera": "SH", "Aloo Paratha": "AP", "Tikhi Puri": "TPU", "Tikhi Pudi": "TPD",\n  "Idli": "ID", "Coconut Chutney": "CCT", "Chutney": "CCT", "Dadpe Pohe": "DP", "Masala Dosa": "MD",\n  "Upma": "UP", "Poha": "PO"';
let n = 0;
function extend(text, varName, entries) {
  const start = text.indexOf("var " + varName + " = {");
  if (start === -1) return { text, ok: false };
  const close = text.indexOf("};", start);
  if (close === -1) return { text, ok: false };
  let before = text.slice(0, close);
  before = before.replace(/,\s*$/, "");
  return { text: before + ",\n" + entries + "\n" + text.slice(close), ok: true };
}
let r = extend(l, "LBL_EN", NEW_EN);
if (r.ok) { l = r.text; n++; console.log("LBL_EN extended"); } else console.log("LBL_EN MISS");
r = extend(l, "LBL_MR", NEW_MR);
if (r.ok) { l = r.text; n++; console.log("LBL_MR extended"); } else console.log("LBL_MR MISS");
fs.writeFileSync("07_Labels_Auto.gs", l);
console.log("done " + n + "/2");
