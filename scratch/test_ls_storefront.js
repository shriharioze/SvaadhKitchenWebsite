// LS storefront — money-path harness (CLAUDE.md testing ritual):
// extract REAL function text from the .gs sources, eval under stubbed globals,
// assert realistic scenarios BEFORE anything deploys.
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");

function read(f) { return fs.readFileSync(path.join(ROOT, f), "utf8"); }

// ── extraction helpers ────────────────────────────────────────
function extractFn(src, name) {
  // function name(...) { ... } — brace-matched
  const start = src.indexOf("function " + name + "(");
  if (start === -1) throw new Error("fn not found: " + name);
  let i = src.indexOf("{", start), depth = 0, j = i;
  for (; j < src.length; j++) {
    if (src[j] === "{") depth++;
    else if (src[j] === "}") { depth--; if (depth === 0) break; }
  }
  return src.slice(start, j + 1);
}
function extractConstRHS(src, name) {
  const re = new RegExp("const " + name + "\\s*=\\s*([\\s\\S]*?);\\s*(?:\\/\\/|\\n)");
  const m = src.match(re);
  if (!m) throw new Error("const not found: " + name);
  return m[1];
}

const cfg   = read("00_Config.gs");
const lsMod = read("13_LivianoSerio.gs");
const gw    = read("10_Hdfc_Gateway.gs");
const bulk  = read("06_Bulk_Orders.gs");
const codeG = read("Code.gs");

// ── global stubs (bare consts — direct eval resolves these in this scope) ──
const console_ = console;
const PRICING_V2 = true;
const LS_FREE_DELIVERY = true;
const TAB_CUSTOMERS = "SK_Customers";
const CUSTOMERS_HEADERS = ["Phone"];
const TAB_ORDERS = "SK_Orders";
const ORDERS_HEADERS = ["Submission_ID"];
const BULK_DELIVERY = 11;
const BULK_LD_PRICE = eval("(" + extractConstRHS(bulk, "BULK_LD_PRICE") + ")");
const BULK_DISCOUNT_RATE = 0.05;
const Utilities = {
  formatDate: (d, tz, f) => {
    if (f === "yyyyMMdd") return d.toISOString().slice(0, 10).replace(/-/g, "");
    return d.toISOString().slice(0, 10);
  }
};
const getSpreadsheet = () => ({});
const getOrCreateTab = () => ({});
const getAllRows = () => [];
const getAreas = () => [{ name: "Some Area", free: false }];
const _normalizePhone = (p) => String(p || "").replace(/\D/g, "").slice(-10);
const _isOrderCancelled = () => false;
const getDayTotalsForDates = () => ({ dayTotals: {} });
const _calculateLoyaltyStreak = () => ({ streak: 0, pastSurcharge: 0, end: null });
const _kitchenClosedSet = () => ({});
const getMenu = () => ({ breakfast: [] });
const _getAllOrdersBothTabsIfPresent = () => [];

// extracted sources
const lsFns = [
  "_lsStorefront", "_lsDeliveryFree"
].map(n => extractFn(lsMod, n)).join("\n");
const gwFns = extractFn(gw, "_computeAuthoritativeTotal");
const bulkFns = [
  "_bulkItemPrice", "_bulkMealFood", "_bulkPriceFromWindows"
].map(n => extractFn(bulk, n)).join("\n");
const idFn = extractFn(codeG, "generateSubmissionID");

const boot = `
${extractConstRHS(cfg, "ORDERS_HEADERS") ? "" : ""}
`;
// ORDERS_HEADERS not needed by these fns; skip.

eval(lsFns); eval(gwFns); eval(bulkFns); eval(idFn);

let pass = 0, fail = 0;
function T(name, cond) {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ FAIL: " + name); }
}

// ── TEST GROUP A: storefront marker helpers ───────────────────
console.log("\nA. Storefront markers");
T("body without storefront → ''", _lsStorefront({}) === "");
T("body storefront:'LS' → 'LS'", _lsStorefront({ storefront: "LS" }) === "LS");
T("body storefront:'ls' lowercase → 'LS'", _lsStorefront({ storefront: "ls" }) === "LS");
T("body storefront:'SK' → ''", _lsStorefront({ storefront: "SK" }) === "");
T("delivery free only for LS", _lsDeliveryFree("LS") === true && _lsDeliveryFree("") === false);

// ── TEST GROUP B: submission ID prefixing ─────────────────────
console.log("\nB. Submission IDs");
global.getISTDate = () => new Date("2026-08-24T10:00:00Z");
eval(extractFn(codeG, "getISTDate").replace("function getISTDate", "function __noopIST") ); // real one exists in Code.gs already stubbed via global
const sidSK = generateSubmissionID();
const sidLS = generateSubmissionID("LS");
T("default id keeps SK- prefix", /^SK-\d{8}-\d{4}$/.test(sidSK));
T("LS id gets LS- prefix", /^LS-\d{8}-\d{4}$/.test(sidLS));

// ── TEST GROUP C: gateway authoritative total (charge == cart) ──
console.log("\nC. _computeAuthoritativeTotal — LS free delivery parity");
// Cart: 1 day, Lunch only. V2 prices: Chapati=ceil(9×1.06)=10, Dal=ceil(22×1.06)=24
// food = 2×10 + 24 = 44 → day total 44 < 53 → small-order fee ₹11 ALSO applies (both
// storefronts — only DELIVERY is free on LS per owner rule).
const cart = { "2026-08-25": { Lunch: { items: { "Chapati": 2, "Dal [200ml]": 1 }, area: "Some Area" } } };
const totalMain = _computeAuthoritativeTotal(cart, "9999999999", "");
const totalLS   = _computeAuthoritativeTotal(cart, "9999999999", "LS");
console.log("    main-site total=" + totalMain + "  LS total=" + totalLS);
T("main site: food 44 + delivery 11 + small fee 11 = 66", totalMain === 66);
T("LS: food 44 + small fee 11, NO delivery = 55", totalLS === 55);
T("difference is exactly the ₹11 delivery", totalMain - totalLS === 11);

// Multi-day: 3 separate dates × Dal-only dinner (24/day)
const cart3 = {};
["2026-08-25","2026-08-26","2026-08-27"].forEach(d => {
  cart3[d] = { Dinner: { items: { "Dal [200ml]": 1 }, area: "Some Area" } };
});
const t3main = _computeAuthoritativeTotal(cart3, "9999999999", "");
const t3ls   = _computeAuthoritativeTotal(cart3, "9999999999", "LS");
console.log("    3-day main=" + t3main + "  LS=" + t3ls);
T("3 single-meal days main: 72 food + 33 delivery + 33 small fee", t3main === 138);
T("3 single-meal days LS:   72 food + 0 delivery + 33 small fee", t3ls === 105);

// Small-order fee still applies on LS (only DELIVERY is free per owner)
// Dal-only day 24 < 53 → small fee 11 on both
T("small-order fee NOT waived on LS (matches owner rule)", t3ls === t3main - 33);

// ── TEST GROUP D: bulk pricing engine ─────────────────────────
console.log("\nD. _bulkPriceFromWindows — LS free delivery");
const lunchItems = [{ colKey: "Chapati", qty: 2 }, { colKey: "Dal [200ml]", qty: 1 }];
const weekDates = ["2026-08-25","2026-08-26","2026-08-27","2026-08-28","2026-08-29","2026-08-31"]; // 6 days (week plan skips Sunday)
const qMain = _bulkPriceFromWindows(lunchItems, null, weekDates, [], { isFreeArea: false, isFeeExempt: false, isPickup: false }, 0.05);
const qLS   = _bulkPriceFromWindows(lunchItems, null, weekDates, [], { isFreeArea: false, isFeeExempt: false, isPickup: false, lsFree: true }, 0.05);
const delivSum = (q) => q.rows.reduce((s, r) => s + r.delivery, 0);
console.log("    bulk main total=" + qMain.total + " (delivery " + delivSum(qMain) + ")  LS total=" + qLS.total + " (delivery " + delivSum(qLS) + ")");
T("bulk main-site rows carry ₹11 delivery/day", delivSum(qMain) === 6 * 11);
T("bulk LS rows carry ₹0 delivery", delivSum(qLS) === 0);
T("bulk LS total == main total − 66", qLS.total === qMain.total - 66);
T("bulk food identical between storefronts", Math.abs((qMain.totalFood - 66) - (qLS.totalFood)) === 0);

// ── RESULT ────────────────────────────────────────────────────
console.log("\n════════════════════════════════");
console.log("PASS: " + pass + "   FAIL: " + fail);
process.exit(fail ? 1 : 0);

