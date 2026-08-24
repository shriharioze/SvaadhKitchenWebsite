// Test: _missedOrderSafetyNet tab routing (lost-order protection for LS rows)
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");
const src = fs.readFileSync(path.join(ROOT, "02_Orders_Menu.gs"), "utf8");

function extractFn(name) {
  const s = src.indexOf("function " + name + "(");
  let i = src.indexOf("{", s), d = 0, j = i;
  for (; j < src.length; j++) {
    if (src[j] === "{") d++;
    else if (src[j] === "}") { d--; if (d === 0) break; }
  }
  return src.slice(s, j + 1);
}

// in-memory Script Properties
const store = {};
global.PropertiesService = { getScriptProperties: () => ({
  getProperty: k => store[k] ?? null,
  setProperty: (k, v) => { store[k] = String(v); }
})};
global.TAB_ORDERS = "SK_Orders";

eval(extractFn("_missedOrderSafetyNet"));

let pass = 0, fail = 0;
const T = (n, c) => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ FAIL: " + n); } };

_missedOrderSafetyNet({}, "SK-20260824-1111", ["r1"], "9999999999");                       // legacy-style call (no tab)
_missedOrderSafetyNet({}, "LS-20260824-2222", ["r2"], "8888888888", "LS_Orders");          // LS call

const parsed = JSON.parse(store["PENDING_ORDER_ROWS"]);
T("SK entry stored with default SK_Orders tab", parsed["SK-20260824-1111"].tab === "SK_Orders");
T("LS entry stored with LS_Orders tab", parsed["LS-20260824-2222"].tab === "LS_Orders");
T("row payloads intact", parsed["SK-20260824-1111"].row[0] === "r1" && parsed["LS-20260824-2222"].row[0] === "r2");

console.log("\nPASS: " + pass + "  FAIL: " + fail);
process.exit(fail ? 1 : 0);
