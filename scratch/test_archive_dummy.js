// ════════════════════════════════════════════════════════════════
// ARCHIVE INCIDENT REPRODUCTION (dummy sandbox — live sheet NEVER touched)
// Runs the REAL archiveMonth() from 04_Reports_Misc.gs against an in-memory
// master sheet: July 2026 Paid rows + August 2026 live rows (Order_Date as
// REAL Date objects, exactly what Sheets getValues() returns).
// Goal: observe what the rebuild writes back into the live Order_Date column.
// ════════════════════════════════════════════════════════════════
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");
const src = fs.readFileSync(path.join(ROOT, "04_Reports_Misc.gs"), "utf8");
const codeGs = fs.readFileSync(path.join(ROOT, "Code.gs"), "utf8");
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

// ── Fake Sheets (mimic getValues/setValues semantics) ─────────
class FakeSheet {
  constructor(name, headers = []) {
    this._name = name; this.headers = headers.slice(); this.rows = [];
  }
  getName() { return this._name; }
  getLastRow() { return this.rows.length + 1; }
  getLastColumn() { return Math.max(this.headers.length, 1); }
  getMaxRows() { return Math.max(this.rows.length + 100, 100); }
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
        if (grid.length !== numRows || grid[0].length !== numCols) {
          throw new Error("The number of rows in the data does not match the number of rows in the range. The data has " + grid.length + " rows and " + grid[0].length + " columns. The range has " + numRows + " rows and " + numCols + " columns.");
        }
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
  getUrl() { return "https://dummy.sheet/url"; }
  getId() { return "dummy-id"; }
}

// ── world ─────────────────────────────────────────────────────
const masterSS = new FakeSS();
const archiveSS = new FakeSS();
const ORDERS_HEADERS = JSON.parse((cfg.match(/const ORDERS_HEADERS = ([\s\S]*?);\s*(?:\/\/|\n)/) || [])[1] || "[]").map(h => h.replace(/'/g, ""));
if (!ORDERS_HEADERS.length) throw new Error("ORDERS_HEADERS extraction failed");
const COL = {}; ORDERS_HEADERS.forEach((h, i) => COL[h] = i);

function mkTab(ss, name, headers) { const s = new FakeSheet(name, headers); ss.sheets[name] = s; return s; }
const liveOrders = mkTab(masterSS, "SK_Orders", ORDERS_HEADERS.slice());

function addRow(obj) {
  const row = new Array(ORDERS_HEADERS.length).fill("");
  Object.keys(obj).forEach(k => { if (COL[k] !== undefined) row[COL[k]] = obj[k]; });
  liveOrders.appendRow(row);
}

// July 2026: PAID rows (should archive) + one PENDING (should stay)
function d(y, m, day) { return new Date(Date.UTC(y, m - 1, day, 0, 0, 0)); }
addRow({ Submission_ID: "SK-JUL-1", Submitted_At: "2026-07-02 12:00:00", Order_Date: d(2026, 7, 2), Meal_Type: "Lunch", Customer_Name: "A", Phone: "9000000001", Payment_Status: "Paid", Food_Subtotal: 100, Net_Total: 100 });
addRow({ Submission_ID: "SK-JUL-2", Submitted_At: "2026-07-15 12:00:00", Order_Date: d(2026, 7, 15), Meal_Type: "Dinner", Customer_Name: "B", Phone: "9000000002", Payment_Status: "Paid", Food_Subtotal: 120, Net_Total: 120 });
addRow({ Submission_ID: "SK-JUL-3", Submitted_At: "2026-07-20 12:00:00", Order_Date: d(2026, 7, 20), Meal_Type: "Lunch", Customer_Name: "C", Phone: "9000000003", Payment_Status: "Pending", Food_Subtotal: 80, Net_Total: 80 });
// August 2026: current live data (should stay, DATES INTACT)
addRow({ Submission_ID: "SK-AUG-1", Submitted_At: "2026-08-05 12:00:00", Order_Date: d(2026, 8, 5), Meal_Type: "Lunch", Customer_Name: "D", Phone: "9000000004", Payment_Status: "Paid", Food_Subtotal: 90, Net_Total: 90 });
addRow({ Submission_ID: "SK-AUG-2", Submitted_At: "2026-08-20 12:00:00", Order_Date: d(2026, 8, 20), Meal_Type: "Dinner", Customer_Name: "E", Phone: "9000000005", Payment_Status: "Pending", Food_Subtotal: 110, Net_Total: 110 });

// ── services + stubs ──────────────────────────────────────────
globalThis.Sandbox = {
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  LockServiceGlobal: null,
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => null, setProperty() {} }) },
  SpreadsheetApp: { flush() {} },
  Utilities: {
    formatDate: (dt, tz, fmt) => {
      // support the formats archiveMonth uses
      const p = (n) => String(n).padStart(2, "0");
      if (fmt === "yyyy-MM-dd") return dt.toISOString().slice(0, 10);
      if (fmt === "yyyy-MM-dd HH:mm:ss") return dt.toISOString().slice(0, 10) + " " + dt.toISOString().slice(11, 19);
      return dt.toISOString();
    },
    getUuid: () => "uuid"
  },
  Logger: { log() {} },
  MailApp: { sendEmail() {} },
  getSpreadsheet: () => masterSS,
  getOrCreateTab: (ss, name, headers) => ss.getSheetByName(name) || (() => { const s = mkTab(ss, name, headers || []); return s; })(),
  TAB_ORDERS: "SK_Orders",
  ORDERS_HEADERS: ORDERS_HEADERS,
  _getArchiveYearFolder: () => null,
  _findOrCreateOrderArchiveSS: () => { if (!archiveSS.sheets["SK_Orders"]) mkTab(archiveSS, "SK_Orders", []); return archiveSS; },
  LockService2: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) }
};
const S = globalThis.Sandbox;
S.LockService = { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) };

const prelude = `
var LockService = { getScriptLock: function(){ return { waitLock: function(){}, releaseLock: function(){} }; } };
var PropertiesService = Sandbox.PropertiesService;
var SpreadsheetApp = Sandbox.SpreadsheetApp;
var Utilities = Sandbox.Utilities;
var Logger = Sandbox.Logger;
var MailApp = Sandbox.MailApp;
var getSpreadsheet = Sandbox.getSpreadsheet;
var getOrCreateTab = Sandbox.getOrCreateTab;
var TAB_ORDERS = Sandbox.TAB_ORDERS;

var _getArchiveYearFolder = Sandbox._getArchiveYearFolder;
var _findOrCreateOrderArchiveSS = Sandbox._findOrCreateOrderArchiveSS;
`;

const archiveFn = extractFn(src, "archiveMonth");
eval(prelude + archiveFn);

// ═══ RUN: archive July 2026 ═══
console.log("── BEFORE ──");
console.log("live rows:", liveOrders.rows.length, "(3 July + 2 August)");

const result = archiveMonth(2026, 7);
console.log("\n── archiveMonth(2026, 7) result ──");
console.log(JSON.stringify(result, (k, v) => v, 2).slice(0, 600));

const archSheet = archiveSS.sheets["SK_Orders"];
console.log("\n── archive file rows:", archSheet ? archSheet.rows.length : 0, "──");
if (archSheet) archSheet.rows.forEach(r => console.log("  archived:", r[COL.Submission_ID], "| Order_Date cell:", JSON.stringify(r[COL.Order_Date]), "| type:", typeof r[COL.Order_Date], r[COL.Order_Date] instanceof Date ? "(Date)" : ""));

console.log("\n── LIVE SHEET AFTER REBUILD ──");
console.log("live rows:", liveOrders.rows.length);
let dateCorrupted = 0, dateBlank = 0;
liveOrders.rows.forEach(r => {
  const v = r[COL.Order_Date];
  const isDate = v instanceof Date;
  if (!isDate && v === "") dateBlank++;
  if (!isDate && v !== "") dateCorrupted++;
  console.log("  ", r[COL.Submission_ID], "| Order_Date cell:", JSON.stringify(v), "| type:", typeof v, isDate ? "(Date ✓)" : (v === "" ? "(BLANK!)" : "(STRING — type corrupted)"));
});

console.log("\n══════════ DIAGNOSIS ══════════");
console.log("August rows kept:", liveOrders.rows.filter(r => String(r[COL.Submission_ID]).includes("AUG")).length, "(expected 2)");
console.log("July Pending kept:", liveOrders.rows.filter(r => String(r[COL.Submission_ID]) === "SK-JUL-3").length, "(expected 1)");
console.log("Order_Date cells written as STRINGS (type corruption):", dateCorrupted);
console.log("Order_Date cells BLANK:", dateBlank);
console.log("Order_Date cells still real Dates:", liveOrders.rows.length - dateCorrupted - dateBlank);
// ── IDEMPOTENCY: re-run July → must archive nothing, touch nothing ──
const res2 = archiveMonth(2026, 7);
const live2 = liveOrders.rows.length;
const arch2 = archiveSS.sheets["SK_Orders"].rows.length;
const datesOk = liveOrders.rows.every(r => r[COL.Order_Date] instanceof Date);
console.log('RE-RUN July => success=' + res2.success + ' archivedThisRun=' + res2.ordersArchived + ' liveRows=' + live2 + ' archiveRows=' + arch2 + ' datesStillDates=' + datesOk);
if (res2.ordersArchived !== 0 || live2 !== 3 || arch2 !== 2 || !datesOk) { console.log('IDEMPOTENCY FAIL'); process.exit(1); }
console.log('IDEMPOTENCY OK');
