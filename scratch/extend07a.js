const fs = require("fs");
let l = fs.readFileSync("07_Labels_Auto.gs", "utf8");
const NEW_MR = [
  '  "Ghee Sheera": "घी शिरा", "Sheera": "शिरा", "Aloo Paratha": "आलू पराठा", "Tikhi Puri": "तिखी पुरी", "Tikhi Pudi": "तिखी पुडी",',
  '  "Idli": "इडली", "Coconut Chutney": "खोबरेल चटणी", "Chutney": "चटणी", "Dadpe Pohe": "दापपे पोहे", "Masala Dosa": "मसाला डोसा",',
  '  "Upma": "उपमा", "Poha": "पोहे",'
].join("\n");
const NEW_EN = [
  '  "Ghee Sheera": "GS", "Sheera": "SH", "Aloo Paratha": "AP", "Tikhi Puri": "TPU", "Tikhi Pudi": "TPD",',
  '  "Idli": "ID", "Coconut Chutney": "CCT", "Chutney": "CCT", "Dadpe Pohe": "DP", "Masala Dosa": "MD",',
  '  "Upma": "UP", "Poha": "PO",'
].join("\n");
let n = 0;
["LBL_EN", "LBL_MR"].forEach(name => {
  const start = l.indexOf("var " + name + " = {");
  if (start === -1) { console.log(name + " MISS (no var)"); return; }
  const close = l.indexOf("};", start);
  if (close === -1) { console.log(name + " MISS (no close)"); return; }
  let before = l.slice(0, close).replace(/,\s*$/, "");
  const after = l.slice(close);
  l = before + ",\n" + NEW_MR.replace("Tikhi Puri", name === "LBL_EN" ? "Tikhi Puri" : "Tikhi Puri") + "\n" + after;
  // swap EN/MR content properly:
  l = l.replace("@@PLACEHOLDER@@", "");
  n++;
  console.log(name + " extended (raw)");
});
// The above inserted NEW_MR for both — fix LBL_EN to NEW_EN content by targeted replace
fs.writeFileSync("07_Labels_Auto.gs", l);
console.log("phase1 done " + n);
