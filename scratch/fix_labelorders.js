const fs = require("fs");
let applied = 0;

// ── 1. getLabelOrders: type-agnostic fields + notes column fix ──
let c = fs.readFileSync("03_Admin_Kitchen.gs", "utf8");
const oldBlock = `    var obj = {
      name:  String(r.Customer_Name || ""),
      area:  String(r.Area || ""),
      notes: String(r.Special_Notes || ""),
      Curd:  Number(r.Curd) || 0,
      Items_JSON: String(r.Items_JSON || "")
    };
    if (meal === "Breakfast") {
      for (var n = 1; n <= 4; n++) {
        obj["BF_Item_"+n] = String(r["BF_Item_"+n] || "");
        obj["BF_Qty_"+n]  = Number(r["BF_Qty_"+n])  || 0;
      }
    } else {
      COLS.forEach(function(col) { obj[col] = Number(r[col]) || 0; });
    }
    return obj;`;
const newBlock = `    // Type-agnostic fields (fix 2026-08-25): include EVERYTHING for every row —
    // the summary builders render from Items_JSON first and use columns as
    // fallbacks, so owner-flipped Meal_Types (breakfast items under Lunch/Dinner)
    // and blank BF slots both render correctly.
    // Also fixed: notes read Special_Notes_Kitchen (Special_Notes was always empty).
    var obj = {
      name:  String(r.Customer_Name || ""),
      area:  String(r.Area || ""),
      notes: String(r.Special_Notes_Kitchen || r.Special_Notes || ""),
      Curd:  Number(r.Curd) || 0,
      Items_JSON: String(r.Items_JSON || "")
    };
    for (var n = 1; n <= 4; n++) {
      obj["BF_Item_"+n] = String(r["BF_Item_"+n] || "");
      obj["BF_Qty_"+n]  = Number(r["BF_Qty_"+n])  || 0;
    }
    COLS.forEach(function(col) { obj[col] = Number(r[col]) || 0; });
    return obj;`;
if (c.includes(oldBlock)) { c = c.replace(oldBlock, newBlock); applied++; }
else { console.log("getLabelOrders MISS"); const i = c.indexOf("Special_Notes ||"); console.log(c.slice(i - 300, i + 300)); }

fs.writeFileSync("03_Admin_Kitchen.gs", c);
console.log("applied " + applied);
