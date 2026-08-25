const fs = require("fs");
let applied = 0;

// ── 1. backend _lblItemSummary (07_Labels_Auto.gs) ──────────────
let c = fs.readFileSync("07_Labels_Auto.gs", "utf8");
const oldStart = c.indexOf("function _lblItemSummary(order, meal, lang) {");
const oldEnd = c.indexOf("}", c.indexOf("return parts.join(\", \");", oldStart)) + 1;
if (oldStart === -1 || oldEnd <= oldStart) { console.log("lbl MISS"); process.exit(1); }
const newLbl = [
"function _lblItemSummary(order, meal, lang) {",
"  // Items_JSON-FIRST summary (fix 2026-08-25): Items_JSON is written from the",
"  // actual cart regardless of Meal_Type, so it is the source of truth.",
"  // Fixes: (1) breakfast+Curd labels dropping items when BF slots are blank;",
"  // (2) owner-flipped Meal_Type (Breakfast items under Lunch/Dinner) rendering",
"  // empty. BF slots / L/D columns / Curd column remain as fallbacks for legacy",
"  // rows. Sources are MIRRORS of one cart — first source wins per item, never summed.",
"  var lbl = (lang === \"Devanagari\") ? LBL_MR : LBL_EN;",
"  var norm = function (n) {",
"    n = String(n || \"\").trim();",
"    if (n === \"Breakfast Curd\") n = \"Curd\";",
"    return n.replace(/\\s*\\[.*?\\]\\s*/g, \"\").replace(/\\s*\\(.*?\\)\\s*/g, \"\").trim();",
"  };",
"  var items = {};",
"  var names = [];",
"  var add = function (rawName, qty) {",
"    if (!rawName || !(qty > 0)) return;",
"    var n = norm(rawName);",
"    if (!n) return;",
"    if (items[n] === undefined) { items[n] = qty; names.push(n); }",
"  };",
"  if (order.Items_JSON) {",
"    try {",
"      var parsed = JSON.parse(order.Items_JSON);",
"      Object.keys(parsed).forEach(function (k) { add(k === \"Breakfast Curd\" ? \"Curd\" : k, Number(parsed[k]) || 0); });",
"    } catch (e) {}",
"  }",
"  for (var n = 1; n <= 4; n++) add(order[\"BF_Item_\" + n], Number(order[\"BF_Qty_\" + n]) || 0);",
"  LBL_LD_COLS.forEach(function (col) { add(col, Number(order[col]) || 0); });",
"  add(\"Curd\", Number(order.Curd) || 0);",
"  return names.map(function (name) {",
"    var a = lbl[name] || lbl[name.replace(/ /g, \"_\")] || name;",
"    return items[name] + \"x\" + a;",
"  }).join(\", \");",
"}"
].join("\n");
c = c.slice(0, oldStart) + newLbl + c.slice(oldEnd);
fs.writeFileSync("07_Labels_Auto.gs", c);
applied++;

// ── 2. kitchen.html getBulkItemSummary (same rewrite) ───────────
let k = fs.readFileSync("docs/Admin/kitchen.html", "utf8");
const kStart = k.indexOf("function getBulkItemSummary(order, meal, lang) {");
const kEnd = k.indexOf("}", k.indexOf("return parts.join(\", \");", kStart)) + 1;
if (kStart === -1 || kEnd <= kStart) { console.log("kitchen MISS"); process.exit(1); }
const newK = [
"function getBulkItemSummary(order, meal, lang) {",
"      // Items_JSON-FIRST summary — mirrors backend _lblItemSummary (fix 2026-08-25).",
"      const lbl = lang === \"Devanagari\" ? LABEL_MR : LABEL_EN;",
"      const norm = (n) => {",
"        n = String(n || \"\").trim();",
"        if (n === \"Breakfast Curd\") n = \"Curd\";",
"        return n.replace(/\\s*\\[.*?\\]\\s*/g, \"\").replace(/\\s*\\(.*?\\)\\s*/g, \"\").trim();",
"      };",
"      const items = {};",
"      const names = [];",
"      const add = (rawName, qty) => {",
"        if (!rawName || !(qty > 0)) return;",
"        const n = norm(rawName);",
"        if (!n) return;",
"        if (items[n] === undefined) { items[n] = qty; names.push(n); }",
"      };",
"      if (order.Items_JSON) {",
"        try {",
"          const parsed = JSON.parse(order.Items_JSON);",
"          Object.entries(parsed).forEach(([k, q]) => add(k === \"Breakfast Curd\" ? \"Curd\" : k, Number(q) || 0));",
"        } catch (e) {}",
"      }",
"      for (let n = 1; n <= 4; n++) add(order[\"BF_Item_\" + n], Number(order[\"BF_Qty_\" + n]) || 0);",
"      LD_COLS.forEach(col => add(col, Number(order[col]) || 0));",
"      add(\"Curd\", Number(order.Curd) || 0);",
"      return names.map(name => {",
"        const a = lbl[name] || lbl[name.replace(/ /g, \"_\")] || name;",
"        return items[name] + \"x\" + a;",
"      }).join(\", \");",
"}"
].join("\n");
k = k.slice(0, kStart) + newK + k.slice(kEnd);
fs.writeFileSync("docs/Admin/kitchen.html", k);
applied++;

console.log("applied " + applied + "/2");
