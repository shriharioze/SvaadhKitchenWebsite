const fs = require("fs");
let c = fs.readFileSync("CLAUDE.md", "utf8");
let n = 0;

// 03 line update
const a03 = "- `03_Admin_Kitchen.gs` — `getAdminData`→`_getAdminDataUncached` (LS rows merged: prep counts INCLUDE, delivery-cap slots EXCLUDE), menu CRUD (`saveMenu`, `setKitchenClosed` per-meal), `getKitchenSummary`/`getDriverOrders`/`getLabelOrders` (`.concat(ls_rowsAsSK())` IA-pattern), `markRefunded` (wallet credit routed by order's tab), `getOrderSummary` (rows carry `ls:true` → [LS] badge), areas CRUD, packaging, `saveLabels`.";
const b03 = "- `03_Admin_Kitchen.gs` — `getAdminData`→`_getAdminDataUncached` (LS rows merged: prep counts INCLUDE, delivery-cap slots EXCLUDE), menu CRUD (`saveMenu`, `setKitchenClosed` per-meal), `getKitchenSummary` (Items_JSON merge: owner-flipped Meal_Types + blank-BF-slot rows now count in prep; cross-meal BF-slot block guarded against column double-count) / `getDriverOrders` / `getLabelOrders` (type-agnostic fields — BF slots + L/D cols + Items_JSON on EVERY row; kitchen notes NOT printed on labels per owner; `.concat(ls_rowsAsSK())` IA-pattern), `markRefunded` (wallet credit routed by order's tab), `getOrderSummary` (rows carry `ls:true` → [LS] badge), areas CRUD, packaging, `saveLabels`.";
if (c.includes(a03)) { c = c.replace(a03, b03); n++; } else console.log("03 MISS");

// 04 line update
const a04 = "- `04_Reports_Misc.gs` — chatbot (`handleChat`, BUSINESS_CONTEXT prompt), `markOrdersStatus` (cross-tab, per-row `_wsOf/_hOf`, cell re-read fix), `getOrderHistory` (ls flag), `getCustomerList/History` (main-site customers only), `_analyticsCore`/`getAnalytics`/forecast (via `getOrdersInRangeWithArchive` which includes LS), `archiveMonth` (SK_Orders only — LS_Orders intentionally NOT archived yet), `getOrdersInRangeWithArchive` (unions LS live rows, tagged `_lsTab`), `markOrderPacked` (cross-tab).";
const b04 = "- `04_Reports_Misc.gs` — chatbot (`handleChat`, BUSINESS_CONTEXT prompt), `markOrdersStatus` (cross-tab, per-row `_wsOf/_hOf`, cell re-read fix), `getOrderHistory` (ls flag), `getCustomerList/History` (main-site customers only), `_analyticsCore`/`getAnalytics`/forecast (via `getOrdersInRangeWithArchive` which includes LS), `archiveMonth` (manual whole-month tool; Date-preserving rebuild — see incident 2026-08-25), **`archiveDueOrders(dryRun)` + `_archiveSliceDueDate` = THE scheduled archiver** (due-slice policy: days 1-10→due 18th, 11-20→due 28th, 21-end→due next-month 8th; terminal rows only; Pending/On-Account stay live until settled then archive into THEIR month's existing file; daily ~22:30 IST trigger via `runScheduledArchive`/`setupMonthlyArchiveTrigger`/`stopMonthlyArchiveTrigger`; preview `?action=archiveDueDryRun&pin=…`; LS_Orders intentionally NOT archived yet), `getOrdersInRangeWithArchive` (unions LS live rows, tagged `_lsTab`), `markOrderPacked` (cross-tab).";
if (c.includes(a04)) { c = c.replace(a04, b04); n++; } else console.log("04 MISS");

// 07 line update
const a07 = "- `07_Labels_Auto.gs` — auto label PDFs at cutoff+5 (Slides API, anti-drift). Reads via getLabelOrders (includes LS).";
const b07 = "- `07_Labels_Auto.gs` — auto label PDFs at cutoff+5 (Slides API, anti-drift). Reads via getLabelOrders (includes LS). `_lblItemSummary` renders Items_JSON-FIRST (source of truth regardless of Meal_Type) with BF-slot/L-D-col/Curd fallbacks — fixes blank-BF-slot breakfast labels + owner-flipped Meal_Types. LBL_MR/EN cover the full breakfast menu (Devanagari + transliterated codes).";
if (c.includes(a07)) { c = c.replace(a07, b07); n++; } else console.log("07 MISS");

// kitchen.html frontend line
const aK = "- `docs/Admin/kitchen.html`, `docs/Admin/driver.html` — ops surfaces (LS rows included server-side).";
const bK = "- `docs/Admin/kitchen.html` — ops surfaces (LS rows included server-side). Label tab `getBulkItemSummary` mirrors backend `_lblItemSummary` (Items_JSON-first); LABEL_MR/EN extended (full breakfast menu, Devanagari + codes). Kitchen notes intentionally not on labels.\n- `docs/Admin/driver.html` — ops surface (LS rows included server-side).";
if (c.includes(aK)) { c = c.replace(aK, bK); n++; } else console.log("kitchen MISS");

// money rule 17
const aR = "15. When editing any function, check its callers for NEW required params (storefront pattern) — node --check does NOT catch undefined-variable runtime throws.";
const bR = aR + "\n16. **Items_JSON is the source of truth for kitchen/label rendering** — never gate item rendering by Meal_Type (owner flips types in-sheet). Sources are MIRRORS of one cart: first source wins per item, never sum across sources (double-count).\n17. **Never stringify Dates when rewriting sheet rows** (archiver incident 2026-08-25: Date→string sanitize blanked the live Order_Date column). getValues→setValues round-trips Date objects safely — preserve them.";
if (c.includes(aR)) { c = c.replace(aR, bR); n++; } else console.log("rule MISS");

// facts section: archive policy
const aF = "- LS storefront: Ganga Serio Kharadi, wings A–G2 (A–D=Liviano, E1–G2=Serio), Lunch & Dinner only, free delivery, pickup at G2 804, unlisted page.";
const bF = aF + "\n- Archive policy: due-slice (1-10→18th, 11-20→28th, 21-end→next-month 8th), terminal rows only (Paid/Cancelled/Refunded), Pending/On-Account stay live, per-month existing files appended, daily ~22:30 IST trigger, preview `archiveDueDryRun`.";
if (c.includes(aF)) { c = c.replace(aF, bF); n++; } else console.log("facts MISS");

fs.writeFileSync("CLAUDE.md", c);
console.log("CLAUDE.md updated " + n + "/6");
