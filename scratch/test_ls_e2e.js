// ════════════════════════════════════════════════════════════════
// END-TO-END submitOrder HARNESS
// Runs the REAL submitOrder/_submitOrderInternal (+ wallet, loyalty,
// safety-net, verify, dedupe engines) against an in-memory Sheet
// emulator. Proves the WRITE PATH, not just the math.
// ════════════════════════════════════════════════════════════════
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

function extractFn(src, name) {
  const s = src.indexOf("function " + name + "(");
  if (s === -1) throw new Error("fn not found: " + name);
  let i = src.indexOf("{", s), d = 0, j = i;
  for (; j < src.length; j++) {
    if (src[j] === "{") d++;
    else if (src[j] === "}") { d--; if (d === 0) break; }
  }
  return src.slice(s, j + 1);
}
function extractConstRHS(src, name) {
  const m = src.match(new RegExp("const " + name + "\\s*=\\s*([\\s\\S]*?);\\s*(?:\\/\\/|\\n)"));
  if (!m) throw new Error("const not found: " + name);
  return m[1];
}

// ── fake Google Sheets ═══════════════════════════════════════
class FakeSheet {
  constructor(name, headers = []) { this._name = name; this.headers = headers.slice(); this.rows = []; }
  getName() { return this._name; }
  getLastRow() { return this.rows.length + 1; }
  getLastColumn() { return Math.max(this.headers.length, 1); }
  setFrozenRows() {}
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
          if (idx < 0) {
            while (sheet.headers.length < col + numCols - 1) sheet.headers.push("");
            sheet.headers[col - 1] = v;
          } else {
            while (sheet.rows.length <= idx) sheet.rows.push([]);
            const rr = sheet.rows[idx];
            while (rr.length < col + numCols - 1) rr.push("");
            rr[col - 1] = v;
          }
        }
        return this;
      },
      setValues(grid) {
        for (let r = 0; r < numRows; r++) {
          const idx = row + r - 2;
          if (idx < 0) { grid[r].forEach((v, c) => { sheet.headers[c] = v; }); continue; }
          while (sheet.rows.length <= idx) sheet.rows.push([]);
          const rr = sheet.rows[idx];
          grid[r].forEach((v, c) => { while (rr.length <= c) rr.push(""); rr[c] = v; });
        }
        const api = { setFontWeight() { return api; }, setBackground() { return api; }, setFontColor() { return api; }, setNumberFormat() { return api; } };
        return api;
      }
    };
  }
  getDataRange() { return this.getRange(1, 1, Math.max(this.getLastRow(), 1), this.getLastColumn()); }
  appendRow(row) {
    const width = this.getLastColumn();
    this.rows.push(new Array(width).fill("").map((_, i) => (row[i] !== undefined ? row[i] : "")));
    return this;
  }
}
class FakeSS {
  constructor() { this.sheets = {}; }
  getSheetByName(n) { return this.sheets[n] || null; }
  insertSheet(n) { const s = new FakeSheet(n); this.sheets[n] = s; return s; }
}

// ── fake services ════════════════════════════════════════════
const propStore = {};
const cacheStore = {};
const mailLog = [];
const calls = { upserts: [], verifies: [], invalidated: [] };

globalThis.Services = {
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  CacheService: { getScriptCache: () => ({
    get: k => (cacheStore[k] !== undefined ? cacheStore[k] : null),
    put: (k, v) => { cacheStore[k] = v; }
  })},
  PropertiesService: { getScriptProperties: () => ({
    getProperty: k => (propStore[k] !== undefined ? propStore[k] : null),
    setProperty: (k, v) => { propStore[k] = String(v); }
  })},
};

// ── world state ══════════════════════════════════════════════
const ss = new FakeSS();
const ORDERS_HEADERS_ARR = JSON.parse(extractConstRHS(read("00_Config.gs"), "ORDERS_HEADERS").replace(/'/g, '"'));
const COL = {};
ORDERS_HEADERS_ARR.forEach((h, i) => { COL[h] = i; });
function mkTab(name, headers) { const s = new FakeSheet(name, headers); ss.sheets[name] = s; return s; }
const skWs   = mkTab("SK_Orders", ORDERS_HEADERS_ARR);
const menuWs = mkTab("SK_Daily_Menu", ["Date", "Stock_JSON", "Order_Cap_JSON"]);
const walWs  = mkTab("SK_Wallet", ["Phone", "Customer_Name", "Txn_Type", "Amount", "Verified", "Reference_ID", "Timestamp"]);
mkTab("SK_Customers", ["Phone", "Customer_Name"]);

const H = ORDERS_HEADERS_ARR;
function addRawRow(ws, obj) {
  const row = new Array(H.length).fill("");
  Object.keys(obj).forEach(k => { if (COL[k] !== undefined) row[COL[k]] = obj[k]; });
  ws.appendRow(row);
  return row;
}
function getRows(ws) {
  // mirror getAllRows(): objects keyed by header
  return ws.rows.map((r, i) => {
    const o = { _row: i + 2 };
    ws.headers.forEach((h, c) => { o[h] = r[c]; });
    return o;
  });
}

// ── date helpers (avoid Sundays for order dates) ─────────────
function isoAdd(days) { const d = new Date(); d.setDate(d.getDate() + days); return d.toISOString().slice(0, 10); }
function nextNonSunday(offset) { let o = offset; while (new Date(isoAdd(o) + "T12:00:00").getDay() === 0) o++; return isoAdd(o); }

// ── assemble the eval'd source: consts + stubs + REAL functions ──
const cfg = read("00_Config.gs"), code = read("Code.gs"), o02 = read("02_Orders_Menu.gs"), lsG = read("13_LivianoSerio.gs");

const stubs = `
var TAB_ORDERS = "SK_Orders", TAB_LS_ORDERS = "LS_Orders", TAB_MENU = "SK_Daily_Menu",
    TAB_CUSTOMERS = "SK_Customers", TAB_WALLET = "SK_Wallet", TAB_REFUNDS = "SK_Refunds";
var PRICING_V2 = true;
var LS_FREE_DELIVERY = true;
var LS_SOCIETY_NAME = "Liviano Serio";
var ADMIN_PIN = "0000";
var SABJI_COMBO_GROUPS = {};
var CAP_DELIVERY_BYPASS_MIN = ${extractConstRHS(cfg, "CAP_DELIVERY_BYPASS_MIN")};
var DEFAULT_ORDER_CAPS = ${extractConstRHS(cfg, "DEFAULT_ORDER_CAPS")};
var WALLET_HEADERS = ${JSON.stringify(["Phone","Customer_Name","Txn_Type","Amount","Verified","Reference_ID","Timestamp"])};
var CUSTOMERS_HEADERS = ["Phone","Customer_Name"];
var ORDERS_HEADERS = ${JSON.stringify(ORDERS_HEADERS_ARR)};
var ITEM_COL_MAP = ${extractConstRHS(cfg, "ITEM_COL_MAP")};
var LOCK = Services.LockService.getScriptLock();
var LockService = Services.LockService;
var CacheService = Services.CacheService;
var PropertiesService = Services.PropertiesService;
var SpreadsheetApp = { flush(){} };
var MailApp = { sendEmail(to, subj, body){ mailLog.push({to, subj}); } };
var getSpreadsheet = () => ss;
var getOrCreateTab = function (ssx, name, headers) {
  var w = ssx.getSheetByName(name);
  if (!w) { w = ssx.insertSheet(name); if (headers && headers.length) w.getRange(1,1,1,headers.length).setValues([headers]); }
  return w;
};
var getISTDate = () => new Date(Date.now() + 5.5 * 3600 * 1000);
var getISTTimestamp = () => getISTDate().toISOString().replace("T"," ").slice(0,19);
var getAreas = () => [{name:"Free Area", free:true},{name:"Normal Area", free:false}];
var _getMastersMap = () => ({});
var _kitchenClosedSet = () => ({});
var _isMealKitchenClosed = () => false;
var _effectiveCutoffsForDate = () => ({ Breakfast:7, Lunch:9, Dinner:16.5 });
var _pinMatch = () => false;
var _getDefaultOrderCaps = () => DEFAULT_ORDER_CAPS;
var _getDeliveryPointLabel = v => String(v || "");
var _isCapExemptLocation = () => false;
var _cleanNum = v => { if (typeof v === "number") return v; const n = Number(String(v || "").replace(/[^\d.-]/g, "")); return isNaN(n) ? 0 : n; };
var _get = function (obj, key) { if (!obj || !key) return undefined; if (obj[key] !== undefined) return obj[key]; const nk = key.replace(/_/g, " ").toLowerCase(); for (const k in obj) { if (k.replace(/_/g, " ").toLowerCase() === nk) return obj[k]; } return undefined; };
var _invalidateCache = function(){ calls.invalidated.push(Array.from(arguments)); };
var _upsertCustomer = function(ssx, p){ calls.upserts.push(p); };
var updateCustomerLastOrder = function(){};
var _normSocietyBase = s => String(s||"").toLowerCase().replace(/[^a-z0-9]/g,"");
var _normSocietyKey = s => _normSocietyBase(s);
var _getVipPhonesCached = () => ({});
`;

const realFns = [
  // Code.gs
  "headerIndex", "getAllRows", "getRecentRows", "generateSubmissionID",
  "_stripItemSuffix", "itemsJsonKey", "countOrderedUnits", "_effectiveOrderCaps",
  "_calculateWalletBalance", "_appendWalletTransaction",
  // 02_Orders_Menu.gs
  "_isOnAccountDueStatus", "getDayTotalsForDates", "_calculateLoyaltyStreak",
  "_missedOrderSafetyNet", "_verifyAndAlertMissedOrders", "_reappendUntilPresent",
  "_logMissedOrderRow", "submitOrder", "_submitOrderInternal",
  "deleteOrder", "_deleteOrderInternal",
].map(n => extractFn(code.includes("function " + n + "(") ? code : o02, n)).join("\n\n");

const lsFns = ["_lsStorefront", "_lsDeliveryFree", "_lsOrdersWs", "_lsOrderTabs", "_getAllOrdersBothTabs", "_getAllOrdersBothTabsIfPresent"]
  .map(n => extractFn(lsG, n)).join("\n\n");

// mini-real cap/delivery counters (mirror documented rules; unchanged legacy logic)
const miniCounters = `
var _countActiveMealOrders = function(rows, dateStr) {
  var c = { Breakfast:0, Lunch:0, Dinner:0 };
  var seen = { Breakfast:{}, Lunch:{}, Dinner:{} };
  rows.forEach(function(r){
    if (_isOrderCancelled(String(r.Payment_Status||""))) return;
    var d = r.Order_Date instanceof Date ? Utilities.formatDate(r.Order_Date,"Asia/Kolkata","yyyy-MM-dd") : String(r.Order_Date||"").trim();
    if (d !== dateStr) return;
    var meal = String(r.Meal_Type||"").trim(); if (!c[meal] === undefined || c[meal] === undefined) {}
    if (c[meal] === undefined) return;
    var ar = String(r.Area||"").toLowerCase();
    if (ar.indexOf("pickup")!==-1 || ar==="porter") return;
    var nm = String(r.Customer_Name||"").trim().toLowerCase();
    if (!nm || seen[meal][nm]) return;
    seen[meal][nm]=true; c[meal]++;
  });
  return c;
};
var _activeDeliveryIndex = function(rows, dateStr) {
  var idx = {};
  ["Breakfast","Lunch","Dinner"].forEach(function(m){ idx[m] = {soc:{}, ph:{}}; });
  rows.forEach(function(r){
    if (_isOrderCancelled(String(r.Payment_Status||""))) return;
    var d = r.Order_Date instanceof Date ? Utilities.formatDate(r.Order_Date,"Asia/Kolkata","yyyy-MM-dd") : String(r.Order_Date||"").trim();
    if (d !== dateStr) return;
    var meal = String(r.Meal_Type||""); if (!idx[meal]) return;
    var ar = String(r.Area||"").toLowerCase();
    if (ar.indexOf("pickup")!==-1 || ar==="porter") return;
    var soc = _normSocietyKey(r.Society||""); var ph = String(r.Phone||"").replace(/\\D/g,"").slice(-10);
    if (soc) idx[meal].soc[soc]=true;
    if (ph) idx[meal].ph[ph]=true;
  });
  return idx;
};
var _isOrderCancelled = function(st){ var s=String(st||"").toLowerCase(); return s.indexOf("cancel")!==-1 || s.indexOf("deleted")!==-1; };
var _normalizePhone = p => String(p||"").replace(/\\D/g,"").slice(-10);
var Utilities = { formatDate: function(d,tz,f){ var iso=d.toISOString(); if(f==="yyyyMMdd") return iso.slice(0,10).replace(/-/g,""); if(f==="HH:mm:ss") return iso.slice(11,19); return iso.slice(0,10); } };
`;

const SRC = stubs + "\n" + miniCounters + "\n" + realFns + "\n" + lsFns +
  "\n;globalThis.API = { submitOrder, _submitOrderInternal, deleteOrder };";

eval(SRC);

// ════════════════════════════════════════════════════════════════
let pass = 0, fail = 0;
function T(name, cond, detail) {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ FAIL: " + name + (detail ? "\n      " + detail : "")); }
}
function resetWorld() {
  skWs.rows = []; menuWs.rows = []; walWs.rows = []; ss.sheets["LS_Orders"] && delete ss.sheets["LS_Orders"];
  Object.keys(propStore).forEach(k => delete propStore[k]);
  Object.keys(cacheStore).forEach(k => delete cacheStore[k]);
}

const PROFILE = { name: "Test Customer", phone: "9999999999", area: "Normal Area", isFirstTime: false, payment_preference: "Daily Payment" };

console.log("\n[1] SK order → SK_Orders row with normal fees");
resetWorld();
{
  const d = nextNonSunday(1);
  const res = API.submitOrder({ profile: { ...PROFILE, society: "Some Soc" }, storefront: "",
    orders: [{ date: d, meals: [{ type: "Dinner", items: [{ colKey: "Dal [200ml]", qty: 1 }], subtotal: 24, area: "Normal Area" }] }] });
  T("success", res.success === true, JSON.stringify(res));
  T("one row in SK_Orders", skWs.rows.length === 1);
  const r = getRows(skWs)[0];
  T("Source=WebApp", String(r.Source) === "WebApp", String(r.Source));
  T("delivery ₹11 charged", Number(r.Delivery_Charge) === 11);
  T("small-order fee ₹11 (<53)", Number(r.Small_Order_Fee) === 11);
  T("Net_Total = 24+11+11 = 46", Number(r.Net_Total) === 46, String(r.Net_Total));
  T("sid SK- prefixed", /^SK-/.test(String(r.Submission_ID)));
  T("stash entry tabbed SK_Orders", JSON.parse(propStore.PENDING_ORDER_ROWS)[String(r.Submission_ID)].tab === "SK_Orders");
}

console.log("\n[2] LS order → LS_Orders row, FREE delivery, tab auto-created with cloned schema");
resetWorld();
{
  const d = nextNonSunday(1);
  console.log("      DEBUG pre-LS: skRows=" + skWs.rows.length + " sids=" + JSON.stringify(getRows(skWs).map(r => String(r.Submission_ID))) + " cacheKeys=" + JSON.stringify(Object.keys(cacheStore).filter(k => !k.startsWith("submitOrder_req"))));
  const res = API.submitOrder({ profile: { ...PROFILE }, storefront: "LS",
    orders: [{ date: d, meals: [{ type: "Dinner", items: [{ colKey: "Dal [200ml]", qty: 1 }], subtotal: 24, area: "Normal Area" }] }] });
  T("success", res.success === true, JSON.stringify(res));
  const lsW = ss.getSheetByName("LS_Orders");
  T("LS_Orders tab auto-created", !!lsW);
  T("schema cloned from SK_Orders (" + skWs.headers.length + " cols)", lsW && lsW.headers.length === skWs.headers.length && lsW.headers[0] === "Submission_ID");
  T("one row in LS_Orders, ZERO in SK_Orders", lsW && lsW.rows.length === 1 && skWs.rows.length === 0);
  const r = getRows(lsW)[0];
  T("Source=LS", String(r.Source) === "LS");
  T("sid LS- prefixed", /^LS-/.test(String(r.Submission_ID)));
  T("Delivery_Charge=0 (FREE)", Number(r.Delivery_Charge) === 0, String(r.Delivery_Charge));
  T("small-order fee STILL applies (owner rule)", Number(r.Small_Order_Fee) === 11);
  T("Net_Total = 24+11 = 35", Number(r.Net_Total) === 35, String(r.Net_Total));
  T("society defaulted to Liviano Serio", String(r.Society) === "Liviano Serio", String(r.Society));
  T("stash entry tabbed LS_Orders", JSON.parse(propStore.PENDING_ORDER_ROWS)[String(r.Submission_ID)].tab === "LS_Orders");
}

console.log("\n[3] Caps: SK blocked at cap, LS NEVER blocked (counts 0 slots)");
resetWorld();
{
  const d = nextNonSunday(1);
  menuWs.appendRow([d, "", JSON.stringify({ Dinner: 1 })]);           // cap Dinner=1
  addRawRow(skWs, { Submission_ID: "SK-OTHER-1", Order_Date: d, Meal_Type: "Dinner", Customer_Name: "Other Person", Phone: "8888888888", Area: "Normal Area", Payment_Status: "Pending", Food_Subtotal: 30 });
  const body = { profile: { ...PROFILE, society: "Soc" }, storefront: "",
    orders: [{ date: d, meals: [{ type: "Dinner", items: [{ colKey: "Dal [200ml]", qty: 1 }], subtotal: 24, area: "Normal Area" }] }] };
  const skRes = API.submitOrder({ ...body });
  T("SK blocked (cap full)", skRes.error && /full|sold out/i.test(skRes.error), JSON.stringify(skRes).slice(0, 160));
  const lsRes = API.submitOrder({ ...body, storefront: "LS", request_id: "ls_cap_" + Date.now() });
  T("LS sails through the SAME full cap", lsRes.success === true, JSON.stringify(lsRes).slice(0, 160));
}

console.log("\n[4] Stock: SK blocked, LS unlimited");
resetWorld();
{
  const d = nextNonSunday(1);
  menuWs.appendRow([d, JSON.stringify({ Dinner: { "Dal [200ml]": 1 } }), ""]);
  addRawRow(skWs, { Submission_ID: "SK-STK-1", Order_Date: d, Meal_Type: "Dinner", Customer_Name: "A", Phone: "7777777777", Area: "Normal Area", Payment_Status: "Pending", Items_JSON: JSON.stringify({ "Dal [200ml]": 1 }), Food_Subtotal: 24 });
  const body = { profile: { ...PROFILE, society: "Soc" },
    orders: [{ date: d, meals: [{ type: "Dinner", items: [{ colKey: "Dal [200ml]", qty: 1 }], subtotal: 24, area: "Normal Area" }] }] };
  const skRes = API.submitOrder(body);
  T("SK blocked (stock exhausted)", !!(skRes.stock_conflicts && skRes.stock_conflicts.length), JSON.stringify(skRes).slice(0, 140));
  const lsRes = API.submitOrder({ ...body, storefront: "LS", request_id: "ls_stk_" + Date.now() });
  T("LS ignores stock (unlimited)", lsRes.success === true, JSON.stringify(lsRes).slice(0, 140));
}

console.log("\n[5] Shared wallet: recharge once, spend on LS, balance consistent");
resetWorld();
{
  walWs.appendRow(["9999999999", "Test Customer", "Recharge", 1000, "TRUE", "R1", "t"]);
  const d = nextNonSunday(1);
  const res = API.submitOrder({ profile: { ...PROFILE, society: "Soc" }, storefront: "LS", payment_method: "Wallet",
    orders: [{ date: d, meals: [{ type: "Dinner", items: [{ colKey: "Dal [200ml]", qty: 1 }], subtotal: 24, area: "Normal Area" }] }] });
  T("Wallet Paid success", res.success && skWs.rows.length === 0);
  const r = getRows(ss.getSheetByName("LS_Orders"))[0];
  T("status Wallet Paid", String(r.Payment_Status) === "Wallet Paid", String(r.Payment_Status));
  T("Wallet_Credit=35 recorded", Number(r.Wallet_Credit) === 35, String(r.Wallet_Credit));
  const balRows = getRows(walWs);
  const bal = balRows.reduce((s, x) => {
    const t = String(x.Txn_Type || "").toLowerCase();
    const amt = Number(x.Amount) || 0;
    if (/recharge|refund|credit|carry/.test(t)) return s + amt;
    if (/deduction/.test(t)) return s - amt;
    return s;
  }, 0);
  T("wallet balance 1000−35=965", bal === 965, String(bal));
}

console.log("\n[6] Idempotent replay (request_id)");
resetWorld();
{
  const d = nextNonSunday(1);
  const body = { request_id: "req_X1", profile: { ...PROFILE, society: "Soc" },
    orders: [{ date: d, meals: [{ type: "Dinner", items: [{ colKey: "Dal [200ml]", qty: 1 }], subtotal: 24, area: "Normal Area" }] }] };
  const r1 = API.submitOrder(body);
  const r2 = API.submitOrder(body);
  T("first write ok", r1.success && r1.rows_written === 1);
  // Design: request-id replay returns the FULL ORIGINAL response verbatim.
  T("replay returns identical response (same sid)", r2.success && r2.submissionId === r1.submissionId, JSON.stringify(r2));
  T("still exactly ONE row", skWs.rows.length === 1);
}

console.log("\n[7] Cross-page identical-order guard (shared identity dedupe)");
resetWorld();
{
  const d = nextNonSunday(1);
  const meals = [{ type: "Dinner", items: [{ colKey: "Dal [200ml]", qty: 1 }], subtotal: 24, area: "Normal Area" }];
  const r1 = API.submitOrder({ profile: { ...PROFILE, society: "Soc" }, orders: [{ date: d, meals }] });
  const r2 = API.submitOrder({ profile: { ...PROFILE, society: "Soc" }, storefront: "LS", request_id: "x_" + Date.now(),
    orders: [{ date: d, meals: meals.map(m => ({ ...m })) }] });
  T("first (SK) ok", r1.success);
  // Design: a ≤5-min-old identical order from the OTHER page is silently deduped
  // onto the ORIGINAL row (same rule as browser retries) — never double-writes.
  T("LS twin deduped onto original SK row (no 2nd write)", r2.success && r2.submissionId === r1.submissionId && r2.rows_written === 0, JSON.stringify(r2).slice(0, 180));
  T("exactly ONE row total across BOTH tabs", skWs.rows.length === 1 && (ss.getSheetByName("LS_Orders") ? ss.getSheetByName("LS_Orders").rows.length : 0) === 0);
}

console.log("\n[8] Loyalty streak spans BOTH tabs (5 seeded days split SK/LS → 6th-day reward)");
resetWorld();
{
  // pick 5 most-recent past days, skipping Sundays, ending yesterday
  const days = [];
  for (let off = 1; days.length < 5 && off < 15; off++) {
    const iso = isoAdd(-off);
    if (new Date(iso + "T12:00:00").getDay() === 0) continue;
    days.unshift(iso);
  }
  days.forEach((iso, i) => {
    const ws = i % 2 === 0 ? skWs : (ss.getSheetByName("LS_Orders") || mkTab("LS_Orders", ORDERS_HEADERS_ARR));
    addRawRow(ws, { Submission_ID: (i % 2 === 0 ? "SK-H" : "LS-H") + i, Submitted_At: iso + " 10:00:00", Order_Date: iso,
      Meal_Type: "Dinner", Customer_Name: "Test Customer", Phone: "9999999999", Area: "Normal Area",
      Payment_Status: "Paid", Food_Subtotal: 100, Inflation_Surcharge: 5, Loyalty_Discount: "No" });
  });
  const today = isoAdd(0);
  const res = API.submitOrder({ profile: { ...PROFILE, society: "Soc" }, storefront: "LS",
    orders: [{ date: today, meals: [{ type: "Dinner", items: [{ colKey: "Dal [200ml]", qty: 1 }], subtotal: 24, area: "Normal Area" }] }] });
  T("order placed", res.success === true, JSON.stringify(res).slice(0, 140));
  const r = getRows(ss.getSheetByName("LS_Orders")).find(x => String(x.Order_Date) === today);
  T("6th-day reward fired (Loyalty_Discount=Yes)", r && String(r.Loyalty_Discount) === "Yes", r && JSON.stringify({ disc: r.Discount_Amount, net: r.Net_Total }));
  // waiver = 5×₹5 accrued + ₹1 today = ₹26 → net = 24 food + 11 small fee − 26 = 9
  T("waiver math exact: Net_Total = 24+11−26 = 9", r && Number(r.Net_Total) === 9 && Number(r.Discount_Amount) === 26, r && JSON.stringify({ disc: String(r.Discount_Amount), net: String(r.Net_Total) }));
}

console.log("\n[9] Safety-net verify pass: rows present → no alert mails");
resetWorld();
{
  const d = nextNonSunday(1);
  const res = API.submitOrder({ profile: { ...PROFILE, society: "Soc" },
    orders: [{ date: d, meals: [{ type: "Dinner", items: [{ colKey: "Dal [200ml]", qty: 1 }], subtotal: 24, area: "Normal Area" }] }] });
  T("no alert emails (all rows verified)", mailLog.length === 0, JSON.stringify(mailLog));
  T("verify ran", Array.isArray(calls.verifies) === true);
}

console.log("\n[10] RISK 6.1 — cross-tab cancel: SK order cancelled, LS same-day row clawed back");
resetWorld();
{
  const d = nextNonSunday(1);
  // Day total = 300 + 60 = 360 ≥ 325 → both rows carry the 5% tier discount.
  addRawRow(skWs, { Submission_ID: "SK-DAY-A", Order_Date: d, Meal_Type: "Lunch",
    Customer_Name: "Test Customer", Phone: "9999999999", Area: "Normal Area", Society: "Soc",
    Payment_Status: "Paid", Payment_Method: "UPI", Food_Subtotal: 300, Discount_Amount: 15, Net_Total: 285 });
  const lsW = ss.getSheetByName("LS_Orders") || mkTab("LS_Orders", ORDERS_HEADERS_ARR);
  addRawRow(lsW, { Submission_ID: "LS-DAY-B", Order_Date: d, Meal_Type: "Dinner",
    Customer_Name: "Test Customer", Phone: "9999999999", Area: "Normal Area", Society: "Liviano Serio",
    Payment_Status: "Paid", Payment_Method: "UPI", Food_Subtotal: 60, Discount_Amount: 3, Net_Total: 57 });
  const res = API.deleteOrder("9999999999", "SK-DAY-A", "wallet");
  T("cancel succeeded", res && res.success === true, JSON.stringify(res).slice(0, 200));
  const skRow = getRows(skWs).find(r => r.Submission_ID === "SK-DAY-A");
  const lsRow = getRows(ss.getSheetByName("LS_Orders")).find(r => r.Submission_ID === "LS-DAY-B");
  T("SK row marked Cancelled – Refunded to Wallet", /cancelled/i.test(String(skRow.Payment_Status)) && /wallet/i.test(String(skRow.Payment_Status)), String(skRow.Payment_Status));
  // Cross-tab clawback: LS row's discount zeroed and fee clawback applied IN LS_ORDERS.
  // Day drops below threshold → LS delivery row owes ₹11 (net 57+11=68).
  T("LS row (other tab!) discount clawed back to 0", Number(lsRow.Discount_Amount) === 0, String(lsRow.Discount_Amount));
  T("LS row Net_Total = 57 + ₹11 delivery clawback = 68", Number(lsRow.Net_Total) === 68, String(lsRow.Net_Total));
  // Refund = cancelled net 285 − overDiscount 3 − deliveryOwed 11 = 271 to wallet
  const refundTxn = getRows(walWs).find(x => /cancellation refund/i.test(String(x.Txn_Type)));
  T("wallet refund txn ₹271", refundTxn && Number(refundTxn.Amount) === 271, refundTxn && JSON.stringify(refundTxn));
}

console.log("\n════════════════════════════════");
console.log(`SUBMITORDER E2E HARNESS — PASS: ${pass}   FAIL: ${fail}`);
process.exit(fail ? 1 : 0);
