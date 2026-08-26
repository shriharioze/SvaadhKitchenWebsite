// ════════════════════════════════════════════════════════════════
// HOTFIX: label double-count regression — Items_JSON and L/D columns
// are MIRRORS of the same cart. Use Items_JSON as PRIMARY; only fall
// back to columns when Items_JSON is missing/empty/malformed.
// ════════════════════════════════════════════════════════════════
const fs = require("fs");

// ── 1. backend _lblItemSummary (07_Labels_Auto.gs) ──
let c = fs.readFileSync("07_Labels_Auto.gs", "utf8");
const oldStart = c.indexOf("function _lblItemSummary(order, meal, lang) {");
const oldEnd = c.indexOf("}", c.indexOf("return names.map", oldStart)) + 1;
if (oldStart === -1 || oldEnd <= oldStart) { console.log("lbl MISS"); process.exit(1); }
const newLbl = [
"function _lblItemSummary(order, meal, lang) {",
"  // Items_JSON-ONLY when present (fix 2026-08-26 double-count regression).",
"  // Items_JSON and the named columns are MIRRORS of the same cart — using both",
"  // causes duplicates. Only fall back to BF slots / L/D columns / Curd when",
"  // Items_JSON is missing, empty, or malformed (legacy rows).",
"  var lbl = (lang === \"Devanagari\") ? LBL_MR : LBL_EN;",
"  var norm = function (n) {",
"    n = String(n || \"\").trim();",
"    if (n === \"Breakfast Curd\") n = \"Curd\";",
"    return n.replace(/\\s*\\[.*?\\]\\s*/g, \"\").replace(/\\s*\\(.*?\\)\\s*/g, \"\").trim();",
"  };",
"  var items = {};",
"  var names = [];",
"  var hasJson = false;",
"  if (order.Items_JSON) {",
"    try {",
"      var parsed = JSON.parse(order.Items_JSON);",
"      Object.keys(parsed).forEach(function (k) {",
"        var q = Number(parsed[k]) || 0;",
"        if (q <= 0) return;",
"        var n = norm(k === \"Breakfast Curd\" ? \"Curd\" : k);",
"        if (!n) return;",
"        if (items[n] === undefined) { items[n] = q; names.push(n); }",
"        hasJson = true;",
"      });",
"    } catch (e) {}",
"  }",
"  // Fallback ONLY when Items_JSON had nothing usable",
"  if (!hasJson) {",
"    for (var n = 1; n <= 4; n++) {",
"      var it = String(order[\"BF_Item_\" + n] || \"\").trim();",
"      var q = Number(order[\"BF_Qty_\" + n]) || 0;",
"      if (!it || q <= 0) continue;",
"      var nn = norm(it);",
"      if (items[nn] === undefined) { items[nn] = q; names.push(nn); }",
"    }",
"    LBL_LD_COLS.forEach(function (col) {",
"      var qc = Number(order[col]) || 0;",
"      if (qc <= 0) return;",
"      if (items[col] === undefined) { items[col] = qc; names.push(col); }",
"    });",
"    if (!items[\"Curd\"] && Number(order.Curd) > 0) { items[\"Curd\"] = Number(order.Curd); names.push(\"Curd\"); }",
"  }",
"  return names.map(function (name) {",
"    var a = lbl[name] || lbl[name.replace(/ /g, \"_\")] || name;",
"    return items[name] + \"x\" + a;",
"  }).join(\", \");",
"}"
].join("\n");
c = c.slice(0, oldStart) + newLbl + c.slice(oldEnd);
fs.writeFileSync("07_Labels_Auto.gs", c);
console.log("07 _lblItemSummary fixed");

// ── 2. kitchen.html getBulkItemSummary (same fix) ──
let k = fs.readFileSync("docs/Admin/kitchen.html", "utf8");
const kStart = k.indexOf("function getBulkItemSummary(order, meal, lang) {");
const kEnd = k.indexOf("}", k.indexOf("return names.map", kStart)) + 1;
if (kStart === -1 || kEnd <= kStart) { console.log("kitchen MISS"); process.exit(1); }
const newK = [
"function getBulkItemSummary(order, meal, lang) {",
"      // Items_JSON-ONLY when present (fix 2026-08-26 double-count regression).",
"      // Mirrors backend _lblItemSummary — see comment there.",
"      const lbl = lang === \"Devanagari\" ? LABEL_MR : LABEL_EN;",
"      const norm = (n) => {",
"        n = String(n || \"\").trim();",
"        if (n === \"Breakfast Curd\") n = \"Curd\";",
"        return n.replace(/\\s*\\[.*?\\]\\s*/g, \"\").replace(/\\s*\\(.*?\\)\\s*/g, \"\").trim();",
"      };",
"      const items = {};",
"      const names = [];",
"      let hasJson = false;",
"      if (order.Items_JSON) {",
"        try {",
"          const parsed = JSON.parse(order.Items_JSON);",
"          Object.entries(parsed).forEach(([k, q]) => {",
"            const qty = Number(q) || 0;",
"            if (qty <= 0) return;",
"            const n = norm(k === \"Breakfast Curd\" ? \"Curd\" : k);",
"            if (!n) return;",
"            if (items[n] === undefined) { items[n] = qty; names.push(n); }",
"            hasJson = true;",
"          });",
"        } catch (e) {}",
"      }",
"      if (!hasJson) {",
"        for (let n = 1; n <= 4; n++) {",
"          const it = String(order[\"BF_Item_\" + n] || \"\").trim();",
"          const q = Number(order[\"BF_Qty_\" + n]) || 0;",
"          if (!it || q <= 0) continue;",
"          const nn = norm(it);",
"          if (items[nn] === undefined) { items[nn] = q; names.push(nn); }",
"        }",
"        LD_COLS.forEach(col => {",
"          const qc = Number(order[col]) || 0;",
"          if (qc <= 0) return;",
"          if (items[col] === undefined) { items[col] = qc; names.push(col); }",
"        });",
"        if (!items[\"Curd\"] && Number(order.Curd) > 0) { items[\"Curd\"] = Number(order.Curd); names.push(\"Curd\"); }",
"      }",
"      return names.map(name => {",
"        const a = lbl[name] || lbl[name.replace(/ /g, \"_\")] || name;",
"        return items[name] + \"x\" + a;",
"      }).join(\", \");",
"}"
].join("\n");
k = k.slice(0, kStart) + newK + k.slice(kEnd);
fs.writeFileSync("docs/Admin/kitchen.html", k);
console.log("kitchen getBulkItemSummary fixed");

// ── 3. getKitchenSummary Items_JSON merge — same fix ──
let a = fs.readFileSync("03_Admin_Kitchen.gs", "utf8");
// The merge block already has `already[]` dedup but the `already` population
// for L/D branch uses raw column names while Items_JSON norm produces spaced names.
// Fix: normalize both sides. The simplest correct fix: skip the merge entirely
// when the row already has items from the type-specific columns (which is always
// the case for well-formed rows). Only merge for rows with blank type columns.
const mergeAnchor = "Object.keys(ijRaw).forEach(function (kRaw) {";
const mergeFix = "        var hasColData = false;\n" +
  "        if (meal === \"Breakfast\") {\n" +
  "          for (var qn3 = 1; qn3 <= 4; qn3++) { if (String(r[\"BF_Item_\" + qn3] || \"\").trim() && (Number(r[\"BF_Qty_\" + qn3]) || 0) > 0) { hasColData = true; break; } }\n" +
  "          if (!hasColData && (Number(r.Curd) || 0) > 0) hasColData = true;\n" +
  "        } else {\n" +
  "          LUNCH_DINNER_COLS.forEach(function (cc) { if ((Number(r[cc]) || 0) > 0) hasColData = true; });\n" +
  "        }\n" +
  "        if (hasColData) return; // columns already captured — Items_JSON is a mirror, skip\n" +
  "        Object.keys(ijRaw).forEach(function (kRaw) {";
if (a.includes(mergeAnchor)) {
  a = a.replace(mergeAnchor, mergeFix);
  // Also need LUNCH_DINNER_COLS defined — check if it exists in getKitchenSummary scope
  if (!a.includes("var LUNCH_DINNER_COLS")) {
    // It's defined in getOrderSummary but not getKitchenSummary — add it
    const ksStart = a.indexOf("function getKitchenSummary(date) {");
    const insertPoint = a.indexOf("var dayRows", ksStart);
    a = a.slice(0, insertPoint) + "var LUNCH_DINNER_COLS = [\"Chapati\",\"Without_Oil_Chapati\",\"Phulka\",\"Ghee_Phulka\",\"Jowar_Bhakri\",\"Bajra_Bhakri\",\"Dry_Sabji_Mini\",\"Dry_Sabji_Full\",\"Curry_Sabji_Mini\",\"Curry_Sabji_Full\",\"Dal\",\"Dal_Fry\",\"Rice\",\"Salad\",\"Curd\"];\n  " + a.slice(insertPoint);
  }
  fs.writeFileSync("03_Admin_Kitchen.gs", a);
  console.log("getKitchenSummary merge fixed");
} else console.log("getKitchenSummary merge MISS");
