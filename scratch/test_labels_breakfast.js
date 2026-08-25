// ════════════════════════════════════════════════════════════════
// KITCHEN LABELS + SUMMARY BUG REPRO (breakfast items)
//  B1: breakfast + Curd → label shows only "1xदही"
//  B2: Meal_Type changed Breakfast→Lunch in sheet → items vanish
// Runs the REAL getLabelOrders + _lblItemSummary (backend) and the kitchen
// page's getBulkItemSummary against an in-memory sheet.
// ════════════════════════════════════════════════════════════════
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");
const read = f => fs.readFileSync(path.join(ROOT, f), "utf8");

function extractFn(source, name) {
  const s = source.indexOf("function " + name + "(");
  if (s === -1) throw new Error("fn not found: " + name);
  let i = source.indexOf("{", s), d = 0, j = i;
  for (; j < source.length; j++) {
    if (source[j] === "{") d++;
    else if (source[j] === "}") { d--; if (d === 0) break; }
  }
  return source.slice(s, j + 1);
}

class FakeSheet {
  constructor(name, headers = []) { this._name = name; this.headers = headers.slice(); this.rows = []; }
  getName() { return this._name; }
  getLastRow() { return this.rows.length + 1; }
  getLastColumn() { return Math.max(this.headers.length, 1); }
  getMaxRows() { return this.rows.length + 100; }
  setFrozenRows() {}
  deleteRows(start, count) { this.rows.splice(start - 2, count); }
  getRange(row, col, numRows = 1, numCols = 1) {
    const sheet = this;
    return {
      getValues() {
        const out = [];
        for (let r = 0; r < numRows; r++) {
          const idx = row + r - 2;
          const src = idx < 0 ? sheet.headers : (sheet.rows[idx] || []);
          const line = [];
          for (let c = 0; c < numCols; c++) line.push(src[col + c - 1] ?? "");
          out.push(line);
        }
        return out;
      },
      getValue() { return this.getValues()[0][0]; },
      setValue(v) {
        for (let r = 0; r < numRows; r++) {
          const idx = row + r - 2;
          if (idx < 0) { sheet.headers[col - 1] = v; continue; }
          while (sheet.rows.length <= idx) sheet.rows.push([]);
          const rr = sheet.rows[idx];
          while (rr.length < col + numCols - 1) rr.push("");
          rr[col - 1] = v;
        }
        return this;
      },
      setValues(grid) {
        for (let r = 0; r < numRows; r++) {
          const idx = row + r - 2;
          if (idx < 0) { grid[r].forEach((v, cc) => { sheet.headers[cc] = v; }); continue; }
          while (sheet.rows.length <= idx) sheet.rows.push([]);
          const rr = sheet.rows[idx];
          grid[r].forEach((v, cc) => { while (rr.length <= cc) rr.push(""); rr[cc] = v; });
        }
        const api = { setFontWeight() { return api; }, setBackground() { return api; }, setFontColor() { return api; } };
        return api;
      },
      clearContent() {
        for (let r = 0; r < numRows; r++) {
          const idx = row + r - 2;
          if (idx < 0) continue;
          while (sheet.rows.length <= idx) sheet.rows.push([]);
          const rr = sheet.rows[idx];
          for (let c = 0; c < numCols; c++) { while (rr.length <= col + c - 1) rr.push(""); rr[col + c - 1] = ""; }
        }
        return this;
      }
    };
  }
  getDataRange() { return this.getRange(1, 1, Math.max(this.getLastRow(), 1), this.getLastColumn()); }
  appendRow(row) { this.rows.push(row.slice()); return this; }
}
class FakeSS { constructor() { this.sheets = {}; } getSheetByName(n) { return this.sheets[n] || null; } insertSheet(n) { const s = new FakeSheet(n); this.sheets[n] = s; return s; } getSheets() { return Object.values(this.sheets); } getUrl() { return "u"; } }

const cfg = read("00_Config.gs");
const ORDERS_HEADERS = JSON.parse((cfg.match(/const ORDERS_HEADERS = ([\s\S]*?);\s*(?:\/\/|\n)/) || [])[1] || "[]").map(h => h.replace(/'/g, ""));
const COL = {}; ORDERS_HEADERS.forEach((h, i) => COL[h] = i);
const ss = new FakeSS();
const ws = new FakeSheet("SK_Orders", ORDERS_HEADERS.slice()); ss.sheets["SK_Orders"] = ws;
function addRow(obj) { const row = new Array(ORDERS_HEADERS.length).fill(""); Object.keys(obj).forEach(k => { if (COL[k] !== undefined) row[COL[k]] = obj[k]; }); ws.appendRow(row); }

// Nitin's actual breakfast order (as submitOrder writes it):
addRow({
  Submission_ID: "SK-BF-1", Order_Date: "2026-08-25", Meal_Type: "Breakfast",
  Customer_Name: "Nitin Jadhav", Phone: "9923976881", Area: "Kharadi",
  Items_JSON: JSON.stringify({ "Kanda Poha": 1, "Ghee Upma": 1, "Breakfast Curd": 1 }),
  "BF_Item_1": "Kanda Poha", "BF_Qty_1": 1,
  "BF_Item_2": "Ghee Upma", "BF_Qty_2": 1,
  "BF_Item_3": "Curd", "BF_Qty_3": 1,
  "Curd": 1,
  Payment_Status: "Paid", Food_Subtotal: 73, Net_Total: 73
});
// B2: breakfast items but Meal_Type flipped to Lunch by owner in the sheet
addRow({
  Submission_ID: "SK-BF-2", Order_Date: "2026-08-25", Meal_Type: "Lunch",
  Customer_Name: "Nitin Jadhav", Phone: "9923976881", Area: "Kharadi",
  Items_JSON: JSON.stringify({ "Thalipeeth": 2, "Breakfast Curd": 1 }),
  "BF_Item_1": "Thalipeeth", "BF_Qty_1": 2,
  "BF_Item_2": "Curd", "BF_Qty_2": 1,
  "Curd": 1,
  Payment_Status: "Paid", Food_Subtotal: 57, Net_Total: 57
});

// ── services + real backend functions ─────────────────────────
globalThis.__ss = ss;
const prelude = `
var getSpreadsheet = function () { return globalThis.__ss; };
var TAB_ORDERS = "SK_Orders";
var getOrCreateTab = function (ss, n) { return ss.getSheetByName(n); };
var getAllRows = function (ws) {
  return ws.rows.map(function (r, i) {
    var o = { _row: i + 2 };
    ws.headers.forEach(function (h, c) { o[h] = r[c]; });
    return o;
  });
};
var _isOrderCancelled = function (st) { var s = String(st || "").toLowerCase(); return s.indexOf("cancel") !== -1 || s.indexOf("deleted") !== -1; };
var ia_rowsAsSK = function () { return []; };
var ls_rowsAsSK = function () { return []; };
`;
const labelOrdersFn = extractFn(read("03_Admin_Kitchen.gs"), "getLabelOrders");
const lblSummaryFn = extractFn(read("07_Labels_Auto.gs"), "_lblItemSummary");
const lblConsts = `
var LBL_EN = { "Kanda Poha": "KP", "Ghee Upma": "GU" };
var LBL_MR = { Chapati: "च", Dal: "दाल", Rice: "भात", Curd: "दही", "Kanda Poha": "कांपो", "Ghee Upma": "घीऊ", "Thalipeeth": "था", "Sabudana Khichdi": "साबु" };
var LBL_LD_COLS = ["Chapati","Dal","Rice","Curd"];
`;
eval(prelude + lblConsts + labelOrdersFn + lblSummaryFn);

// kitchen.html getBulkItemSummary (frontend, verbatim)
const kHtml = read("docs/Admin/kitchen.html");
const kitchenSummaryFn = extractFn(kHtml, "getBulkItemSummary");
const kitchenConsts = `
var LD_COLS = ["Chapati","Dal","Rice","Curd"];
var LABEL_MR = { Curd: "दही", "Kanda Poha": "कांपो", "Ghee Upma": "घीऊ", "Thalipeeth": "था" };
var LABEL_EN = {};
`;
eval(kitchenConsts + kitchenSummaryFn);

console.log("═══ B1: breakfast row WITH Curd — label data + summaries ═══");
const labelData = getLabelOrders("2026-08-25", "Breakfast");
const o = labelData.orders[0];
console.log("getLabelOrders breakfast obj:");
console.log("   BF slots:", JSON.stringify([1,2,3,4].map(n => o["BF_Item_"+n] + "×" + o["BF_Qty_"+n])));
console.log("   Items_JSON:", o.Items_JSON);
console.log("   Curd col:", o.Curd);
console.log("kitchen getBulkItemSummary:", JSON.stringify(getBulkItemSummary(o, "Breakfast", "Devanagari")));
console.log("backend _lblItemSummary:  ", JSON.stringify(_lblItemSummary(o, "Breakfast", "Devanagari")));

console.log("\n═══ B2: same items, Meal_Type flipped to Lunch ═══");
const labelDataL = getLabelOrders("2026-08-25", "Lunch");
const o2 = labelDataL.orders.find(x => x.name === "Nitin Jadhav");
console.log("getLabelOrders LUNCH obj for the breakfast-items row:");
console.log("   L/D cols:", JSON.stringify({ Chapati: o2.Chapati, Dal: o2.Dal, Rice: o2.Rice, Curd: o2.Curd }));
console.log("   Items_JSON:", o2.Items_JSON);
console.log("kitchen getBulkItemSummary:", JSON.stringify(getBulkItemSummary(o2, "Lunch", "Devanagari")));
console.log("backend _lblItemSummary:  ", JSON.stringify(_lblItemSummary(o2, "Lunch", "Devanagari")));


// ── B1-fail variant: breakfast row with BLANK BF slots, good Items_JSON ──
addRow({
  Submission_ID: "SK-BF-3", Order_Date: "2026-08-25", Meal_Type: "Breakfast",
  Customer_Name: "Blank Slots", Phone: "9000000000", Area: "Kharadi",
  Items_JSON: JSON.stringify({ "Kanda Poha": 1, "Ghee Upma": 1, "Breakfast Curd": 1 }),
  "Curd": 1,
  Payment_Status: "Paid", Food_Subtotal: 73, Net_Total: 73
});
const labelData3 = getLabelOrders("2026-08-25", "Breakfast");
const o3 = labelData3.orders.find(x => x.name === "Blank Slots");
const s3k = getBulkItemSummary(o3, "Breakfast", "Devanagari");
const s3b = _lblItemSummary(o3, "Breakfast", "Devanagari");
console.log("\n=== B1-variant: BLANK BF slots + good Items_JSON ===");
console.log("kitchen:", JSON.stringify(s3k), " backend:", JSON.stringify(s3b));
const ok3 = s3k.indexOf("कांपो") !== -1 && s3k.indexOf("घीऊ") !== -1 && s3k.indexOf("दही") !== -1
         && s3b.indexOf("कांपो") !== -1 && s3b.indexOf("घीऊ") !== -1 && s3b.indexOf("दही") !== -1;
console.log(ok3 ? "B1-VARIANT FIXED (all 3 items render)" : "B1-VARIANT STILL BROKEN");

// ── Kitchen SUMMARY prep counts (getKitchenSummary) ──
const ksFn = extractFn(read("03_Admin_Kitchen.gs"), "getKitchenSummary");
const packetsFn = extractFn(read("03_Admin_Kitchen.gs"), "calculatePackets");
const ksPrelude = [
  'var Utilities = { formatDate: function (d) { return d instanceof Date ? d.toISOString().slice(0,10) : String(d); } };',
  'var getMenu = function () { return { lunch_dry: "Dal Kanda", lunch_curry: "Mix Veg", dinner_dry: "Sev Tomato", dinner_curry: "Palak Corn" }; };',
  'var getRecentRows = function (ws, n) { return getAllRows(ws); };',
  'var _effectiveCutoffsForDate = function () { return { Breakfast: 7, Lunch: 9, Dinner: 16.5 }; };',
  'var _getVipPhonesCached = function () { return {}; };'
].join("\n");
eval(ksPrelude + "\n" + packetsFn + "\n" + ksFn);
const ks = getKitchenSummary("2026-08-25");
const bfMeal = ks.meals["Breakfast"] || {};
const ldMeal = ks.meals["Lunch"] || {};
console.log("\n=== KITCHEN SUMMARY prep counts ===");
console.log("Breakfast items:", JSON.stringify(bfMeal.items));
console.log("Breakfast order summaries:", JSON.stringify((ks.orders || []).filter(o => o.Meal_Type === "Breakfast").map(o => o.summary)));
console.log("Lunch extras:", JSON.stringify(ldMeal.extras));
console.log("Lunch order summaries:", JSON.stringify((ks.orders || []).filter(o => o.Meal_Type === "Lunch").map(o => o.summary)));
const bfOk = bfMeal.items && bfMeal.items["Kanda Poha"] === 2 && bfMeal.items["Ghee Upma"] === 2 && bfMeal.items["Curd"] === 2;
const ldOk = ldMeal.extras && ldMeal.extras["Thalipeeth"] === 2;
console.log("Breakfast counts (Poha 2, Upma 2, Curd 2):", bfOk ? "PASS" : "FAIL");
console.log("Lunch Thalipeeth x2 in prep counts:", ldOk ? "PASS" : "FAIL");
