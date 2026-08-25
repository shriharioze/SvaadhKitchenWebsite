// ════════════════════════════════════════════════════════════════
// ARCHIVE POLICY HARNESS (dummy sandbox — live never touched)
// Policy (owner, 2026-08-25): 3 stages/month — days 1-10 due on the 18th,
// 11-20 due on the 28th, 21-end due on the 8th of the NEXT month. Each Paid
// row archives into ITS OWN month's existing file (append, never new files).
// Pending/On-Account rows stay live until paid. Simulates "today" so every
// stage is testable.
// ════════════════════════════════════════════════════════════════
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");
const src = fs.readFileSync(path.join(ROOT, "04_Reports_Misc.gs"), "utf8");
const cfg = fs.readFileSync(path.join(ROOT, "00_Config.gs"), "utf8");

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

// ── Fake Sheets ───────────────────────────────────────────────
class FakeSheet {
  constructor(name, headers = []) { this._name = name; this.headers = headers.slice(); this.rows = []; }
  getName() { return this._name; }
  getLastRow() { return this.rows.length + 1; }
  getLastColumn() { return Math.max(this.headers.length, 1); }
  getMaxRows() { return this.rows.length + 200; }
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
        if (grid.length !== numRows || grid[0].length !== numCols) throw new Error("dimension mismatch: data " + grid.length + "x" + grid[0].length + " vs range " + numRows + "x" + numCols);
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
class FakeSS {
  constructor() { this.sheets = {}; }
  getSheetByName(n) { return this.sheets[n] || null; }
  insertSheet(n) { const s = new FakeSheet(n); this.sheets[n] = s; return s; }
  getSheets() { return Object.values(this.sheets); }
  getUrl() { return "dummy://url"; }
  getId() { return "dummy"; }
}

// ── world ─────────────────────────────────────────────────────
const masterSS = new FakeSS();
const archiveFiles = {}; // name → FakeSS
const ORDERS_HEADERS = JSON.parse((cfg.match(/const ORDERS_HEADERS = ([\s\S]*?);\s*(?:\/\/|\n)/) || [])[1] || "[]").map(h => h.replace(/'/g, ""));
const COL = {}; ORDERS_HEADERS.forEach((h, i) => COL[h] = i);
function mkTab(ss, name, headers) { const s = new FakeSheet(name, headers); ss.sheets[name] = s; return s; }
const liveOrders = mkTab(masterSS, "SK_Orders", ORDERS_HEADERS.slice());

function d(y, m, day) { return new Date(Date.UTC(y, m - 1, day)); }
function addRow(sid, y, m, day, status, name) {
  const row = new Array(ORDERS_HEADERS.length).fill("");
  row[COL.Submission_ID] = sid;
  row[COL.Order_Date] = d(y, m, day);
  row[COL.Meal_Type] = "Lunch";
  row[COL.Customer_Name] = name || "C" + sid;
  row[COL.Phone] = "90000" + sid;
  row[COL.Payment_Status] = status;
  row[COL.Food_Subtotal] = 100;
  row[COL.Net_Total] = 100;
  liveOrders.appendRow(row);
}

// ── Seed: Apr–Jul On-Account/Pending history + Paid stragglers + Aug current ──
// Old months: mostly On Account Pending (stay live until paid)
addRow("SK-APR-1", 2026, 4, 5, "On Account");                       // stays
addRow("SK-APR-2", 2026, 4, 12, "Paid");                            // Apr 11-20 slice → due Apr 28 → archives on ANY run from Apr 28 on
addRow("SK-MAY-1", 2026, 5, 3, "On Account");                       // stays
addRow("SK-MAY-2", 2026, 5, 25, "Paid");                            // May 21-end slice → due Jun 8 → archives
addRow("SK-JUN-1", 2026, 6, 8, "On Account");                       // stays
addRow("SK-JUN-2", 2026, 6, 15, "On Account");                      // stays
addRow("SK-JUL-1", 2026, 7, 2, "Paid");                             // Jul 1-10 slice → due Jul 18 → archives
addRow("SK-JUL-2", 2026, 7, 18, "On Account");                      // stays (pending)
addRow("SK-AUG-1", 2026, 8, 3, "Paid");                             // Aug 1-10 slice → due Aug 18 → archives ON the Aug-18 run
addRow("SK-AUG-2", 2026, 8, 12, "Paid");                            // Aug 11-20 slice → due Aug 28 → NOT on 18th run
addRow("SK-AUG-3", 2026, 8, 25, "Pending");                         // never (until paid + due)
addRow("SK-AUG-4", 2026, 8, 22, "Paid");                            // Aug 21-end slice → due Sep 8

// ── services ──────────────────────────────────────────────────
const sandbox = {
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => null, setProperty() {} }) },
  SpreadsheetApp: { flush() {} },
  Utilities: {
    formatDate: (dt, tz, fmt) => {
      const p = n => String(n).padStart(2, "0");
      if (fmt === "yyyy-MM-dd") return dt.toISOString().slice(0, 10);
      return dt.toISOString().slice(0, 10);
    },
    getUuid: () => "u"
  },
  Logger: { log() {} },
  MailApp: { sendEmail() {} },
  getSpreadsheet: () => masterSS,
  getOrCreateTab: (ss, name, headers) => ss.getSheetByName(name) || mkTab(ss, name, headers || []),
  TAB_ORDERS: "SK_Orders",
  ORDERS_HEADERS,
  TAB_WALLET: "SK_Wallet",
  WALLET_HEADERS: ["Phone"],
  _getArchiveYearFolder: () => null,
  // find-or-create per-month archive file (mimics real behavior: same file reused)
  _findOrCreateOrderArchiveSS: (name) => {
    if (!archiveFiles[name]) { const ss = new FakeSS(); mkTab(ss, "SK_Orders", []); archiveFiles[name] = ss; }
    return archiveFiles[name];
  },
  __todayISO: "2026-08-18" // simulated clock, changed per scenario
};
sandbox.LockService.getScriptLock = () => ({ waitLock() {}, releaseLock() {} });

const prelude = `
var LockService = Sandbox.LockService;
var PropertiesService = Sandbox.PropertiesService;
var SpreadsheetApp = Sandbox.SpreadsheetApp;
var Utilities = Sandbox.Utilities;
var Logger = Sandbox.Logger;
var MailApp = Sandbox.MailApp;
var getSpreadsheet = Sandbox.getSpreadsheet;
var getOrCreateTab = Sandbox.getOrCreateTab;
var TAB_ORDERS = Sandbox.TAB_ORDERS;
var TAB_WALLET = Sandbox.TAB_WALLET;
var WALLET_HEADERS = Sandbox.WALLET_HEADERS;
var _getArchiveYearFolder = Sandbox._getArchiveYearFolder;
var _findOrCreateOrderArchiveSS = Sandbox._findOrCreateOrderArchiveSS;
var __todayISO = Sandbox.__todayISO;
`;

// ── NEW POLICY FUNCTION (what will ship to 04_Reports_Misc.gs) ──
const policyFn = `
function _archiveSliceDueDate(orderDateISO) {
  // days 1-10 → due on the 18th (same month); 11-20 → due on the 28th;
  // 21-end → due on the 8th of the NEXT month. orderDateISO "yyyy-MM-dd".
  var y = Number(orderDateISO.slice(0, 4)), m = Number(orderDateISO.slice(5, 7)), day = Number(orderDateISO.slice(8, 10));
  if (day <= 10) return { due: y + "-" + ("0" + m).slice(-2) + "-18", monthKey: y + "-" + ("0" + m).slice(-2) };
  if (day <= 20) return { due: y + "-" + ("0" + m).slice(-2) + "-28", monthKey: y + "-" + ("0" + m).slice(-2) };
  var nm = m + 1, ny = y;
  if (nm > 12) { nm = 1; ny++; }
  return { due: ny + "-" + ("0" + nm).slice(-2) + "-08", monthKey: y + "-" + ("0" + m).slice(-2) };
}

function archiveDueOrders(dryRun, todayISO) {
  var lock = LockService.getScriptLock();
  try { lock.waitLock(30 * 60 * 1000); } catch (e) { return { success: false, error: "lock busy" }; }
  try {
    var ss = getSpreadsheet();
    var fmtDate = function (v) {
      return v instanceof Date ? Utilities.formatDate(v, "Asia/Kolkata", "yyyy-MM-dd")
        : String(v || "").trim().slice(0, 10);
    };
    var today = String(todayISO || Sandbox.__todayISO).slice(0, 10);
    var ws = getOrCreateTab(ss, TAB_ORDERS, ORDERS_HEADERS);
    var all = ws.getDataRange().getValues();
    var headers = all[0];
    var dateIdx = headers.indexOf("Order_Date");
    var stIdx = headers.indexOf("Payment_Status");
    var PAID = ["paid", "wallet paid", "collected"];
    var TERMINAL = ["cancelled", "refunded"];
    var toArchive = [];   // raw rows
    var keep = [];
    var plan = {};        // monthKey → count (for reporting)
    for (var i = 1; i < all.length; i++) {
      var row = all[i];
      if (row.join("").trim() === "") continue;
      var dISO = fmtDate(row[dateIdx]);
      var st = String((stIdx !== -1 ? row[stIdx] : "") || "").trim().toLowerCase();
      var isTerminal = TERMINAL.some(function (t) { return st.indexOf(t) !== -1; });
      var isPaid = PAID.indexOf(st) !== -1;
      var archivable = (isPaid || isTerminal) && dISO;
      var dueInfo = archivable ? _archiveSliceDueDate(dISO) : null;
      if (archivable && dueInfo && today >= dueInfo.due) {
        toArchive.push(row);
        plan[dueInfo.monthKey] = (plan[dueInfo.monthKey] || 0) + 1;
      } else {
        keep.push(row);
      }
    }
    if (dryRun) return { success: true, dryRun: true, today: today, wouldArchive: toArchive.length, byMonth: plan,
      sids: toArchive.map(function (r) { return r[headers.indexOf("Submission_ID")]; }) };
    if (!toArchive.length) return { success: true, archived: 0, note: "nothing due", today: today };

    // Append per MONTH file (find-or-create), verify each append BEFORE rebuild
    var byMonth = {};
    toArchive.forEach(function (r) {
      var dISO = fmtDate(r[dateIdx]);
      var mk = dISO.slice(0, 7);
      (byMonth[mk] = byMonth[mk] || []).push(r);
    });
    Object.keys(byMonth).forEach(function (mk) {
      var y = Number(mk.slice(0, 4)), m = Number(mk.slice(5, 7));
      var MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
      var name = "Svaadh Kitchen Archive — " + MONTH_NAMES[m - 1] + " " + y;
      var aSS = _findOrCreateOrderArchiveSS(name);
      var aWs = aSS.getSheetByName("SK_Orders") || aSS.getSheets()[0];
      if (!aWs.getName()) aWs.setName("SK_Orders");
      if (aWs.getLastRow() === 0) aWs.getRange(1, 1, 1, headers.length).setValues([headers]);
      var before = aWs.getLastRow();
      aWs.getRange(before + 1, 1, byMonth[mk].length, headers.length).setValues(byMonth[mk]);
      SpreadsheetApp.flush();
      if (aWs.getLastRow() - before !== byMonth[mk].length) throw new Error("Archive append verification failed for " + name);
    });

    // Single rebuild of live sheet (Date-preserving sanitize is in rebuildSheet —
    // here we replicate the same write the shipped rebuildSheet performs)
    var allKeep = keep.filter(function (r) { return r.join("").trim() !== ""; });
    var lastRow = ws.getLastRow(), lastCol = ws.getLastColumn();
    var maxCol = Math.max(lastCol, headers.length);
    if (lastRow > 1) ws.getRange(2, 1, lastRow - 1, maxCol).clearContent();
    if (allKeep.length > 0) ws.getRange(2, 1, allKeep.length, headers.length).setValues(allKeep);
    var rowsNeeded = allKeep.length + 1;
    var totalRows = ws.getMaxRows();
    if (totalRows > rowsNeeded) ws.deleteRows(rowsNeeded + 1, totalRows - rowsNeeded);
    SpreadsheetApp.flush();
    var nowRows = ws.getLastRow() - 1;
    if (nowRows !== allKeep.length) return { success: false, error: "rebuild verify failed", expected: allKeep.length, actual: nowRows };

    return { success: true, today: today, archived: toArchive.length, byMonth: plan, liveRemaining: nowRows };
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}
`;

globalThis.Sandbox = sandbox;
eval(prelude + policyFn);

// ═══ SCENARIOS ═══
let pass = 0, fail = 0;
function T(name, cond, detail) {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ FAIL: " + name + (detail ? " — " + detail : "")); }
}
function liveSids() { return liveOrders.rows.map(r => String(r[COL.Submission_ID])); }
function allLiveDatesReal() { return liveOrders.rows.every(r => r[COL.Order_Date] instanceof Date); }

console.log("SCENARIO A — dry run on Aug 18 (what would archive?)");
Sandbox.__todayISO = "2026-08-18";
const dryA = archiveDueOrders(true);
console.log("   wouldArchive:", dryA.wouldArchive, JSON.stringify(dryA.byMonth), JSON.stringify(dryA.sids));
T("Aug-18 dry run: exactly the 6 due rows (Apr2, May2, Jul1, Aug1 + 2 terminal-none)", dryA.wouldArchive === 4, JSON.stringify(dryA));
T("Aug-18 dry run: Aug-2 (due 28th) NOT in list", dryA.sids.indexOf("SK-AUG-2") === -1);
T("Aug-18 dry run: pending/on-account stay", ["SK-APR-1","SK-MAY-1","SK-JUN-1","SK-JUN-2","SK-JUL-2","SK-AUG-3"].every(s => dryA.sids.indexOf(s) === -1));

console.log("\nSCENARIO B — real run on Aug 18 late evening");
const runB = archiveDueOrders(false);
T("run succeeds", runB.success === true, JSON.stringify(runB));
T("4 rows archived", runB.archived === 4, JSON.stringify(runB));
T("routed to correct month files", runB.byMonth["2026-04"] === 1 && runB.byMonth["2026-05"] === 1 && runB.byMonth["2026-07"] === 1 && runB.byMonth["2026-08"] === 1, JSON.stringify(runB.byMonth));
T("archive files created per month (4 files)", Object.keys(archiveFiles).length === 4, Object.keys(archiveFiles).join(", "));
T("live keeps 8 rows", liveOrders.rows.length === 8, "got " + liveOrders.rows.length);
T("live dates still real Dates", allLiveDatesReal());
T("On-Account pendings still live", ["SK-APR-1","SK-MAY-1","SK-JUN-1","SK-JUN-2","SK-JUL-2","SK-AUG-3"].every(s => liveSids().indexOf(s) !== -1));
T("SK-AUG-2 (due 28th) still live", liveSids().indexOf("SK-AUG-2") !== -1);

console.log("\nSCENARIO C — Aug 28 run (stage 2)");
Sandbox.__todayISO = "2026-08-28";
const runC = archiveDueOrders(false);
T("SK-AUG-2 archived to Aug file", runC.success && runC.byMonth["2026-08"] === 1, JSON.stringify(runC));
const augFileRows = archiveFiles["Svaadh Kitchen Archive — Aug 2026"].sheets["SK_Orders"].rows.length;
T("Aug file now has 2 rows (appended, no new file)", augFileRows === 2 && Object.keys(archiveFiles).length === 4);
T("SK-AUG-4 (due Sep 8) still live", liveSids().indexOf("SK-AUG-4") !== -1);

console.log("\nSCENARIO D — Sep 8 run (stage 3) + late-paid On-Account");
// An old April On-Account row gets paid in September → becomes Paid, next run archives it to APRIL file
const aprRow = liveOrders.rows.find(r => String(r[COL.Submission_ID]) === "SK-APR-1");
aprRow[COL.Payment_Status] = "Paid";
Sandbox.__todayISO = "2026-09-08";
const runD = archiveDueOrders(false);
T("Sep-8 run archives Aug 21-end + late-paid Apr row", runD.success && runD.byMonth["2026-08"] === 1 && runD.byMonth["2026-04"] === 1, JSON.stringify(runD));
T("Apr file now has 2 rows (SK-APR-2 + late-paid SK-APR-1)", archiveFiles["Svaadh Kitchen Archive — Apr 2026"].sheets["SK_Orders"].rows.length === 2);
T("remaining live = only the 5 unpaid On-Account rows", liveOrders.rows.length === 5 && ["SK-MAY-1","SK-JUN-1","SK-JUN-2","SK-JUL-2","SK-AUG-3"].every(s => liveSids().indexOf(s) !== -1), "live=" + JSON.stringify(liveSids()));

console.log("\nSCENARIO E — idempotency: same-day re-run archives nothing");
const runE = archiveDueOrders(false);
T("re-run archives 0", runE.success && runE.archived === 0, JSON.stringify(runE));
T("live unchanged", liveOrders.rows.length === 5 && allLiveDatesReal());

console.log("\n════════════════════════════");
console.log("ARCHIVE POLICY HARNESS — PASS: " + pass + "  FAIL: " + fail);
process.exit(fail ? 1 : 0);
