const fs = require("fs");
let c = fs.readFileSync("scratch/test_archive_dummy.js", "utf8");
const anchor = "Order_Date cells still real Dates:";
const idx = c.indexOf(anchor);
const lineEnd = c.indexOf("\n", idx);
const add = [
  "",
  "// ── IDEMPOTENCY: re-run July → must archive nothing, touch nothing ──",
  "const res2 = archiveMonth(2026, 7);",
  "const live2 = liveOrders.rows.length;",
  "const arch2 = archiveSS.sheets[\"SK_Orders\"].rows.length;",
  "const datesOk = liveOrders.rows.every(r => r[COL.Order_Date] instanceof Date);",
  "console.log('RE-RUN July => success=' + res2.success + ' archivedThisRun=' + res2.ordersArchived + ' liveRows=' + live2 + ' archiveRows=' + arch2 + ' datesStillDates=' + datesOk);",
  "if (res2.ordersArchived !== 0 || live2 !== 3 || arch2 !== 2 || !datesOk) { console.log('IDEMPOTENCY FAIL'); process.exit(1); }",
  "console.log('IDEMPOTENCY OK');"
].join("\n");
c = c.slice(0, lineEnd) + add + c.slice(lineEnd);
fs.writeFileSync("scratch/test_archive_dummy.js", c);
console.log("added");
