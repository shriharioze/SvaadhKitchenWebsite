# Svaadh Kitchen — AI Assistant Brief (READ FIRST)

LIVE production system with REAL MONEY. Vegetarian cloud kitchen — main site serves Hadapsar, Pune; second storefront "Liviano-Serio" serves Ganga Serio, Kharadi; third corporate B2B storefront "IntentAmplify" (IA).
Google Apps Script backend (clasp) + GitHub Pages frontend (docs/, www.svaadhkitchen.in).

## Deploy workflow — git push alone does NOT deploy the backend
- Backend: `clasp push -f` (updates HEAD, validates syntax) → bump CODE_VERSION in 00_Config.gs with a changelog comment → `clasp push -f` AGAIN (the bump must be in the pushed code) → `clasp deploy -i AKfycbz-wwECc_mSh949babtRt8OAvFbnJJzH5X9JS_PsN-f-IMHeYkQMj54fwXRs6PevK0W -d "msg"` → verify: GET `<exec>?action=version`.
- ⚠️ **clasp deploy pins a VERSION SNAPSHOT.** Pushing after deploying does NOT change a live deployment — re-run `clasp deploy` after every emergency push (2026-08-24 incident: ~10 min outage).
- ⚠️ **NEVER leave scratch .js files at repo root** — clasp pushes them and GAS executes .js globally (`require()` crash = total outage). Keep scratch in `scratch/` (gitignored + claspignored).
- Frontend: bump APP_VERSION (and any visible version text/tags) in ANY modified HTML file (docs/order.html, docs/Liviano-Serio.html, docs/Admin/vault_admin.html, kitchen.html, driver.html, recovery.html, etc.) → git commit + push (GitHub Pages serves docs/ from main).
- ⚠️ **Version format: `vYYYY.MM.DD.xx`** (e.g. `v26.09.08.01`) — date-based, NOT semantic. `xx` = bump counter for that day (01, 02, 03…). Only bump pages actually modified in the round.
- 🤖 **CRITICAL DIRECTIVE FOR AI MODELS (Claude, Gemini, GPT):**
  Whenever you edit ANY file in this repository, you MUST bump the corresponding version identifiers BEFORE proposing or committing changes:
  1. **Frontend HTML edits (`docs/*.html`, `docs/Admin/*.html`):** Admin & customer portals employ silent cache-busting auto-refresh mechanisms. If you change frontend code without bumping version identifiers, clients stay trapped on stale cached versions! **ALL version references in the edited file must be bumped in lockstep:**
     - `docs/order.html`: `const APP_VERSION = "..."` + visible version text in footer.
     - `docs/Liviano-Serio.html`: `const APP_VERSION = "..."` + visible version text.
     - `docs/Admin/vault_admin.html`: `<meta name="app-version" content="...">` + `const ADMIN_VERSION = "..."`.
     - `docs/Admin/kitchen.html`: `<meta name="app-version" content="...">` + `const APP_VERSION = "..."` + `const KITCHEN_VERSION = "..."` (bump all three).
     - `docs/Admin/driver.html`: `<meta name="app-version" content="...">` tag (bump tag).
     - `docs/Admin/recovery.html`: `<meta name="app-version" content="...">` + `const RECOVERY_VERSION = "..."` + `<div class="ver-badge">` header badge (bump all three).
  2. **Backend Apps Script edits (`*.gs`):**
     - Increment `CODE_VERSION` in `00_Config.gs` (e.g. `35.45` → `35.46`) and add a bullet to the comment block above it.
     - Run `clasp push -f`
     - Run `clasp deploy -i AKfycbz-wwECc_mSh949babtRt8OAvFbnJJzH5X9JS_PsN-f-IMHeYkQMj54fwXRs6PevK0W -d "<description>"`
     - Verify live with `GET https://script.google.com/macros/s/AKfycbz-wwECc_mSh949babtRt8OAvFbnJJzH5X9JS_PsN-f-IMHeYkQMj54fwXRs6PevK0W/exec?action=version`.
- ALWAYS commit to git after deploying (live and git must never diverge).
- Deploys take ~10s+ to propagate — re-check `?action=version` before concluding a fix "didn't work". Each deploy resets GAS caches/instances → the site is SLOW for a few minutes after every deploy (cold starts). Avoid deploying during business hours; batch changes.

## File map — go straight to the right file, never explore the whole folder

### Backend (.gs at repo root — ONE global scope, 00_Config loads first)
- `00_Config.gs` — CODE_VERSION (changelog in its comment!), all constants: tab names (SK_*/LS_*), ORDERS_HEADERS (60-col canonical schema), ITEM_COL_MAP, DEFAULT_ORDER_CAPS/CUTOFFS, CAP_DELIVERY_BYPASS_MIN, menu cycle constants (MENU_BASE_START="2026-04-13", MENU_CYCLE_DAYS=154, MENU_CYCLE_START="2026-09-14"), LS constants (TAB_LS_ORDERS/LS_CUSTOMERS/LS_WALLET, LS_ORDER_PAGE_URL, LS_SOCIETY_NAME, LS_FREE_DELIVERY, LS_PICKUP_ADDRESS), HDFC config (Script Properties refs), BUSINESS_CONTEXT (main-site chatbot brain).
- `Code.gs` — doGet/doPost ROUTERS (every action; LS storefront passed via `p.storefront`/`_lsStorefront(body)` into identity/wallet actions), HDFC return-redirect routing (order_id prefix: IA→intentamplify, LS→Liviano-Serio.html, else order.html), shared utils: `getSpreadsheet`, `headerIndex`, `getAllRows`, `getRecentRows`, `generateSubmissionID(prefix)` ("SK-"/"LS-"), `getISTDate/Timestamp`, `_effectiveOrderCaps`, `_stripItemSuffix`, `itemsJsonKey`, `countOrderedUnits`, `_calculateWalletBalance(phone, preloadedRows, storefront)`, `_appendWalletTransaction(..., storefront)`.
- `02_Orders_Menu.gs` — THE ORDER ENGINE. `submitOrder`→`_submitOrderInternal` (lock, idempotency, cap/stock pre-flights, LS rules, pricing, wallet deduct, dedup layers, row write, `_missedOrderSafetyNet(..., tabName)`); menu cycle fallback (`getCycleSourceDate`, `_findMenuRowOrCycle` modulo-154); breakfast master price mapping (`_masterPriceByName` dynamically overrides daily JSON prices using live `SK_Master_Breakfast` rows); `getCustomer(phone, storefront)`, `verifyLogin(phone, pin, storefront)` (LS skips SK-archive + login notices), `_upsertCustomer(ss, profile, storefront)`, `getCustomerOrders(phone, storefront)`, `verifyOrderPlaced` (storefront-routed), `getDayTotalsForDates(..., storefront)`, `_calculateLoyaltyStreak(..., storefront)`, `getWalletTransactions(phone, storefront)`, `deleteOrder`→`_deleteOrderInternal` (per-row `_wsOf/_hOf` cross-tab writes, clawbacks with cell re-read fix), PIN-reset OTP trio (storefront-routed), `markOnAccount`, cutoff/cap helpers (`_effectiveCutoffsForDate`, `_getDefaultOrderCaps`), `_kitchenClosedSet/_isMealKitchenClosed`, society alias system (`_normSocietyKey`, Amanora Tower dictionary rules `seedAmanoraTowerAliases`).
- `03_Admin_Kitchen.gs` — `getAdminData`→`_getAdminDataUncached` (LS rows merged: prep counts INCLUDE, delivery-cap slots EXCLUDE), menu CRUD (`saveMenu`, `setKitchenClosed` per-meal: auto-reschedules bulk orders to next non-order working day, auto-cancels & refunds standard orders), menu cycle tools (`populateMenuCycle` for strict menu copying, `cleanCycleDefaults` defaults reset, `checkUpcomingMenuGaps` gap scanner), breakfast standardization tools (`standardizeBreakfastJson` combo expansion, `syncBreakfastMenuToMaster` atomic batch sync), `getKitchenSummary` (Items_JSON merge: owner-flipped Meal_Types + blank-BF-slot rows now count in prep; cross-meal BF-slot block guarded against column double-count) / `getDriverOrders` / `getLabelOrders` (type-agnostic fields — BF slots + L/D cols + Items_JSON on EVERY row; kitchen notes NOT printed on labels per owner; `.concat(ls_rowsAsSK())` IA-pattern), `markRefunded` (wallet credit routed by order's tab), `getOrderSummary` (rows carry `ls:true` → [LS] badge), areas CRUD, packaging, `saveLabels`.
- `04_Reports_Misc.gs` — chatbot (`handleChat`, BUSINESS_CONTEXT prompt), `markOrdersStatus` (cross-tab, per-row `_wsOf/_hOf`, cell re-read fix), `getOrderHistory` (ls flag), `getCustomerList/History` (main-site customers only), `_analyticsCore`/`getAnalytics`/forecast (via `getOrdersInRangeWithArchive` which includes LS; `getAnalytics` returns `pendingCustomers` list with itemized unpaid orders for admin review & bulk settlement), `archiveMonth` (manual whole-month tool; Date-preserving rebuild — see incident 2026-08-25), **`archiveDueOrders(dryRun)` + `_archiveSliceDueDate` = THE scheduled archiver** (due-slice policy: days 1-10→due 18th, 11-20→due 28th, 21-end→due next-month 8th; terminal rows only; Pending/On-Account stay live until settled then archive into THEIR month's existing file; daily ~22:30 IST trigger via `runScheduledArchive`/`setupMonthlyArchiveTrigger`/`stopMonthlyArchiveTrigger`; preview `?action=archiveDueDryRun&pin=…`; archives SK_Orders + LS_Orders + IA_Orders), `cleanupOrderLog` (daily 22:30 IST log cleanup), `recoverFromOrderLog` (auto-recovery in 10-min `liveLostOrderAudit` trigger), `getOrdersInRangeWithArchive` (unions LS live rows, tagged `_lsTab`), `markOrderPacked` (cross-tab), inventory CRUD, expense tracking/analytics, staff attendance/payroll drill-down.
- `05_Customer_Archive.gs` — `updateCustomerLastOrder(phone, storefront)`, `archiveIdleCustomers` (SK_Customers only), `_findArchivedCustomer/_restoreArchivedCustomer` (SK archives; LS never archived).
- `06_Bulk_Orders.gs` — bulk engine: `_bulkFeeCtx(phone, profile, storefront)` (ctx.lsFree), `_bulkPriceFromWindows` (LS free delivery), `_bulkComputeBatch`, `submitBulkOrder` (storefront-routed tab + wallet, LOCKED), `submitBulkDirect` (wallet/on-account), `hdfc_finalizeBulkOrder` (stash→routed write), `postponeBulkOrder`/`getBulkPostponeInfo` (cross-tab row lookup, `_isCustomerBulkPostponed` quota protection for admin-closure shifts), `backfillBulkPlan`.
- `07_Labels_Auto.gs` — auto label PDFs at cutoff+5 (Slides API, anti-drift). Reads via getLabelOrders (includes LS). `_lblItemSummary` renders Items_JSON-FIRST (source of truth regardless of Meal_Type) with BF-slot/L-D-col/Curd fallbacks — fixes blank-BF-slot breakfast labels + owner-flipped Meal_Types. LBL_MR/EN cover the full breakfast menu (Devanagari + transliterated codes).
- `10_Hdfc_Gateway.gs` — HDFC SmartGateway: `hdfc_createSession` (authoritative amount via `_computeAuthoritativeTotal(savedOrders, phone, storefront)` / `_bulkAuthoritativeTotal(..., storefront)`, split-wallet balance read routed), `hdfc_savePendingOrder` (stash carries `storefront`; captures cart into `SK_Order_Log`), `hdfc_markOrderPaid/markOrderFailed` (scan BOTH order tabs), `_hdfcAmountMismatch`, `hdfc_createWalletRechargeSession` (LS ids "LS…W", stash storefront) / `hdfc_finalizeWalletRecharge` (credits routed wallet), on-account session/settle.
- `11_Hdfc_Reconciler.gs` — self-healing: `_reconcileSingleEntry` (per-order lock; recharge regex `/^(SK|LS)\d{6}W/`; dedup scans both tabs; `_buildSubmitBodyFromPending` passes storefront through), `hdfc_reconcileOrderFromStash`, `reconcilePendingOrders` sweep (1-min trigger), `reconcilePendingIAOrders`, `retryQueuedRefunds`.
- `12_Payout_Reconciler.gs` — automated payout & bank settlement reconciliation (`reconcilePayout`).
- `13_LivianoSerio.gs` — **LS STOREFRONT MODULE** (read this first for LS work): `_lsStorefront(body)`, `_lsDeliveryFree(sf)`, `_lsOrdersWs(ss, sf)` (lazy LS_Orders, SK schema minus LS_DROP_COLUMNS=[Maps_Link, Landmark]), `_customersTabFor(ss, sf)` (lazy LS_Customers), `_walletTabFor(ss, sf)` (lazy LS_Wallet), `_lsPickupLabel(sf)`, `ls_rowsAsSK()`, `lsTrimSchema(commit)` (dry-run default; admin GET `?action=lsTrimSchema&pin=…&commit=1`). NOTE: `_getAllOrdersBothTabs*` helpers are LEGACY (pre-separate-bases) — identity reads are now own-tab only.
- `IntentAmplify.gs` — corporate channel (IA_*, [IA] name prefix, manual UPI default, corporate admin console).
- `Analyze_AOV.gs` — Average Order Value analysis script.

### Frontend (docs/ — GitHub Pages)
- `docs/order.html` — MAIN customer app (APP_VERSION marker; Hadapsar; B/L/D; gateway+wallet). DO NOT touch for LS changes.
- `docs/Liviano-Serio.html` — LS storefront clone. LS-specific: `STOREFRONT="LS"` injected into every POST by `apiPost`; LS-prefixed gateway ids; `_lsApplyAddressLocks`-era helpers `_lsSocietyForWing/_lsSyncSociety/_lsPinSocietyInputs` (area=Kharadi locked, wing dropdown A–G2, society auto Liviano/Serio); free-delivery UI; Breakfast removed; LS texts in guide/FAQ/JSON-LD; `&storefront=LS` on all GET identity/order/wallet calls.
- `docs/order-chat.js` — help-chat widget (shared). `IS_LS` gates chips/greeting; Gemini messages prefixed with LS_CONTEXT; main-page behavior unchanged.
- `docs/Admin/vault_admin.html` — master admin panel ([LS] badge via `c.ls`/`o.ls`; APP_VERSION marker; Analytics tab clickable Pending KPI card + pending customers & orders drilldown modal with individual and bulk "Mark as Paid"; inventory, expense tracking, staff payroll).
- `docs/Admin/recovery.html` — mobile-friendly order recovery tool (admin PIN protected, multi-stage JSON healing for Google Sheets doubled quotes, full line-item & bulk plan preview, Gateway_Order_ID replay guard, silent auto-refresh on version bump).
- `docs/Admin/kitchen.html` — ops surfaces (LS rows included server-side). 5-min auto-refresh without intrusive reload on tab switch. Label tab `getBulkItemSummary` mirrors backend `_lblItemSummary` (Items_JSON-first); LABEL_MR/EN extended (full breakfast menu, Devanagari + codes). Kitchen notes intentionally not on labels. Automatic silent version refresh.
- `docs/Admin/driver.html` — ops surface (LS rows included server-side; WhatsApp SVG + native SMS buttons).
- `docs/intentamplify.html` + `docs/Admin/ia_admin.html` — IA corporate channel storefront and admin.
- `docs/index.html` — SEO home (keep FAQ in sync with BUSINESS_CONTEXT when facts change).
- `docs/modals-svaadh.js` + `docs/modals-svaadh.css` — shared UI modal dialog system (`sAlert`, `sConfirm`, `sLoading`).

### Data tabs (master Google Sheet)
SK_Orders · SK_Customers · SK_Wallet · SK_Daily_Menu · SK_Areas · SK_Refunds · SK_Webhook_Log · SK_Missed_Orders · SK_Order_Log · SK_Default_Cutoffs/Caps · SK_Master_Breakfast/Sabjis · SK_Login_Notices · SK_Deliveries · IA_* · **LS_Orders** (SK schema minus Maps_Link/Landmark) · **LS_Customers** · **LS_Wallet** (all lazily created by 13_LivianoSerio.gs helpers).

## 4-Layer Order Safety Net & Self-Healing Architecture
1. **Layer 1 (Instant Return / Webhook)**: `hdfc_handleWebhook` / return URL JS redirect writes/updates the order immediately upon successful gateway payment.
2. **Layer 2 (1-Minute Active Reconciler)**: `reconcilePendingOrders` (1-min trigger via `setupReconcileTrigger`): polls HDFC order status for entries in `PENDING_ORDER_ROWS`, verifies charges, writes orders with per-order script locks, handles recharges `/^(SK|LS)\d{6}W/`.
3. **Layer 3 (10-Minute Deep Audit & Auto-Recovery)**: `liveLostOrderAudit` (10-min trigger via `setupLostOrderAuditTrigger`):
   - `auditLostGatewayOrders(0)`: Scans live webhooks against live orders.
   - `reconcileMissedOrdersLog()`: Closes loop on flagged missing orders.
   - `recoverFromOrderLog()`: Last-resort sweep of `SK_Order_Log` stash (10–60 min window) to auto-place charged orders and alert admin. Uses 3 confirmation sources: HDFC API, Webhook Log, and `SK_Missed_Orders` fallback.
4. **Layer 4 (Daily Scheduled Archiver & Log Cleanup at 22:30 IST)**: `runScheduledArchive` (daily ~22:30 IST trigger via `setupMonthlyArchiveTrigger`):
   - Executes `archiveDueOrders(false)` (due-slice archiving across `SK_Orders`, `LS_Orders`, `IA_Orders`).
   - Executes `cleanupOrderLog()` (deletes yesterday's and older `SK_Order_Log` stash rows).
   - Executes `archiveMissedOrders()` (keeps last 3 days of `SK_Missed_Orders`, moves older into year-wise `Archive_Missed_Orders_YYYY` tabs).

## SEPARATE BASES rule (owner decision 2026-08-25) — LS architecture
- LS is a fully independent customer base: same phone on both pages = TWO independent accounts (own PIN, profile, wallet, loyalty). NO cross-page dedupe, NO cross-page streak, NO shared wallet.
- Every identity/wallet/order read+write routes by `storefront` ("LS" | ""). Main-site behavior must stay byte-identical when absent.
- LS order rules: delivery caps NEVER apply & LS counts 0 slots; item stock never blocks LS (but LS consumption depletes shared stock display); **delivery FREE** (`LS_FREE_DELIVERY` Script Property, default ON — set "false" to restore ₹11 rules); small-order fee ₹11 (<₹53) still applies; society auto-set from wing (A–D=Liviano, E1–G2=Serio); area locked "Kharadi"; pickup handover "G2 804, Ganga Serio, Kharadi" (`_lsPickupLabel`); gateway ids prefixed "LS" (orders AND recharges); kitchen prep counts INCLUDE LS; admin shows [LS] badge.
- LS page: unlisted (noindex), Lunch & Dinner only, bulk plans enabled, HDFC gateway + LS_Wallet.

## Money rules — violating these has cost real money before
1. The gateway ALWAYS recomputes the authoritative total server-side (`_computeAuthoritativeTotal`, `_bulkAuthoritativeTotal`, `_computeOnAccountDue`). NEVER trust client-sent amounts. Reconcile gaps by over-collecting + refunding to wallet.
2. Charge == storage: what HDFC charges must equal the sum of written rows. Pricing rules are mirrored in N places (frontend cart, submitOrder, `_computeAuthoritativeTotal`, bulk engines) — change ALL together.
3. Loyalty 6-day streak engines must agree: frontend (order.html / LS page calculateLoyaltyStreak + bill), submitOrder, gateway recompute. Each storefront's streak reads ITS OWN orders tab only (separate bases). Partial-close rule: check for a valid order on a day BEFORE treating the day as closed/Sunday.
4. Discount tiers (5%≥325 / 7.5%≥485 / 10%≥750) hardcoded in 5 places — change all or charge≠cart.
5. Delivery: main site ₹11/meal, free at ₹106/159/190, free areas Bhosale Nagar+Triveni Nagar+pickup/porter. LS: always free. Cap bypass ≥₹200 (breakfast ₹100). **Cap Counting:** unique customer name OR exact identical address (wing+flat+society) per meal = 1 slot; **Magarpatta Cybercity Towers 1–12:** all orders at the same tower collapse to 1 slot via `towerKey = "mpt|N"` (regex `tower\s*(\d{1,2})` on Society+Wing+Flat+Area, Amanora excluded); VIPs (Fee_Exempt) = 0 slots; Enkin/IA collapse to 1; Shree Laxmi Vihar & Momstory Hospital (desk drop) = 0 slots; LS = 0 slots, never blocked.
6. Wallet: `_calculateWalletBalance` classifies Txn_Type KEYWORDS (credit keywords win first; never name a debit type with them). Wallet is NEVER archived; only safe shrink is `?action=compactWalletLedger` (dry-run default). LS wallet is LS_Wallet — route by storefront, refunds credit the ORDER's wallet.
7. On-account status: `_isOnAccountDueStatus` only. Kitchen-closed: `_closedMealsObj`/`_isMealKitchenClosed` (per-meal).
8. Stock keys: Items_JSON names are suffix-stripped; join via `itemsJsonKey`/`_stripItemSuffix`.
9. HDFC refund API: cancelled gateway orders auto-refund via `hdfc_initiateRefund` (when `refundAmt > 0`). If HDFC returns 401 "Merchant disabled for refund", orders queue as manual UPI refunds; run `retryQueuedRefunds()` once enabled. Test transport: `?action=hdfcRefundTransportTest`. **₹0 Refund Rule:** If bulk commitment clawback or same-day fee clawback absorbs the entire meal price, `refundAmt === 0`. Payment gateways reject ₹0 refunds, so `hdfc_initiateRefund` is skipped. Do NOT treat skipped ₹0 refunds as gateway failures, and never queue ₹0 rows as pending UPI refunds.
10. **SK_Orders/LS_Orders lock rule:** EVERY writer to an orders tab MUST hold `LockService.getScriptLock()` (try/finally). Unlocked writers get silent appendRow drops = missing orders. Locked writers: submitOrder(30s), submitBulkOrder(30s), submitBulkDirect(20s), deleteOrder(15s), markOrdersStatus(8s), _reconcileSingleEntry(15s), hdfc_markOrderPaid(10s), hdfc_markOrderFailed(10s), submitManualOrder(10s), archiveMonth(30m), _appendWalletTransaction(10s, re-entrant).
11. Bulk duplicate race: submitBulkOrder holds the lock across its whole write path (finalize + webhook reconcile can race).
12. Kitchen count roundoff: `_customKitchenRound` (≥0.35 rounds up).
13. Negative wallet → forced Debt Recovery Recharge on next order (both storefronts, own wallet).
14. Clawback writes must RE-READ stored Net_Total before adding deltas — the over-discount and fee-clawback blocks can both fire on the same row; stale in-memory values silently drop the discount restore (fixed 2026-08-25, was a live under-refund bug).
15. When editing any function, check its callers for NEW required params (storefront pattern) — node --check does NOT catch undefined-variable runtime throws.
16. **Items_JSON is the source of truth for kitchen/label rendering** — never gate item rendering by Meal_Type (owner flips types in-sheet). Sources are MIRRORS of one cart: first source wins per item, never sum across sources (double-count).
17. **Never stringify Dates when rewriting sheet rows** (archiver incident 2026-08-25: Date→string sanitize blanked the live Order_Date column). getValues→setValues round-trips Date objects safely — preserve them.

## Testing rituals (these produced the quality — keep them)
- Money/logic change in .gs: EXTRACT the real function text (brace-matched, mind CRLF) and eval in a Node script with stubbed globals (FakeSheet emulator pattern in scratch/test_ls_e2e.js) — assert realistic scenarios BEFORE deploying. eval'd `const` doesn't leak — extract RHS and assign.
- Harnesses (scratch/, gitignored): `test_ls_e2e.js` (43+ assertions, full submitOrder/deleteOrder path on fake sheets — THE gate before any deploy), `test_ls_differential.js` (2,000 assertions: new pricing engines vs `git show HEAD` old code + independent oracle), `test_ls_storefront.js`, `test_ls_safetynet.js`.
- Frontend change: drive the real page in a browser; verify APP_VERSION marker live.
- Admin data ops: dry-run-by-default endpoints (`&commit=1`), run dry-run live first.
- After every backend deploy: `?action=version` + `?action=health` + read-only smoke (getMenu/getConfig/getAreas/getRateCard/getBulkWindow).

## Admin GET diagnostics (append &pin=<ADMIN PIN — ask the owner, never commit it>)
`version` · `health` · `getPendingRefunds` · `listRecentRefunds&n=20` · `hdfcRefundTransportTest` · `auditOnAccountDrift` · `listSocieties` · `auditAmanoraTowers` · `backfillBulkPlan` · `seedAmanoraTowerAliases` · `compactWalletLedger` · `lsTrimSchema` (dry-run; `&commit=1` executes) · `getForecastedMonthlySales` · `getDefaultCutoffs` · `getDefaultOrderCaps` · `archiveRunNow` · `archiveDueDryRun` · `cleanupOrderLog` · `recoverFromOrderLog` · `setupMonthlyArchiveTrigger` · `setupLostOrderAuditTrigger` · `setupReconcileTrigger` · `setupKeepAliveTrigger` · `checkMenuGaps` · `populateMenuCycle&cycle=2` · `cleanCycleDefaults` · `syncBreakfastMenu` · `removeLabelAutoTrigger`
Base: `https://script.google.com/macros/s/AKfycbz-wwECc_mSh949babtRt8OAvFbnJJzH5X9JS_PsN-f-IMHeYkQMj54fwXRs6PevK0W/exec`

## Facts that get answered wrong from stale data
- PRICING_V2 LIVE: Chapati 10, WO-Chapati 9, Phulka 8, Ghee Phulka 11, Bhakri 22, Sabji Mini 24/Full 48, Dal 24, Dal Fry 40, Rice 13, Salad 8, Curd 13. No market surcharge (Inflation_Surcharge = loyalty accrual only).
- Cutoffs (verify live): B 7:00 / L 9:00 / D 16:30. Sundays closed. Caps: B 11 / L 24 / D 23.
- Bulk plans PUBLIC: Week 6d 5% / 15-Day 13d 7.5% / Month 26d 10%; postpone 2+2 / 4+4 within 30 days; cancel forfeits that meal's bulk discount.
- LS storefront: Ganga Serio Kharadi, wings A–G2 (A–D=Liviano, E1–G2=Serio), Lunch & Dinner only, free delivery, pickup at G2 804, unlisted page.
- Archive policy: due-slice (1-10→18th, 11-20→28th, 21-end→next-month 8th), terminal rows only (Paid/Cancelled/Refunded), Pending/On-Account stay live, per-month existing files appended, daily ~22:30 IST trigger, preview `archiveDueDryRun`.
- Contact: WhatsApp +91 93222 46765; calls 9930748908 / 9819969682. Keep BUSINESS_CONTEXT, Backend/business.json, index.html FAQ/JSON-LD, order.html FAQ/GUIDES in sync when facts change.

## Recent Changes (September 2026)
- **Breakfast Combo Expansion & Dynamic Master Price Synchronization (CODE_VERSION 35.67)**
  - **Obsolete Combo Expansion (`03_Admin_Kitchen.gs` & `02_Orders_Menu.gs`):**
    - `standardizeBreakfastJson(rawJson, masterPriceMap)` expands historical combo plates into individual item pieces:
      - `"Tikhi Puri"` / `"Tikhi Pudi"` / `"5 x Tikhi..."` → `"Coriander Chutney"` (₹15) + `"1 x Tikhi Puri"` (₹10).
      - `"4 x Idli and 100ml Chutney"` / `"Idli Chutney"` → `"Coconut Chutney"` (₹22) + `"1 x Idli"` (₹7).
    - Cleared obsolete combo entries out of `NAME_MAP` in `02_Orders_Menu.gs`.
  - **Single Source of Truth (`SK_Master_Breakfast`):**
    - `_masterPriceByName` in `02_Orders_Menu.gs` indexes both raw names (`Kanda Poha`) and mapped display names (`Kanda Poha [175g]`).
    - `_getMenuUncached` dynamically overrides daily menu JSON prices with live prices from `SK_Master_Breakfast`, ensuring the website menu, customer cart, and HDFC SmartGateway authoritative recompute always bill live master prices immediately when updated in the sheet.
  - **Batch Synchronizer (`syncBreakfastMenuToMaster`):**
    - Added `syncBreakfastMenuToMaster(dryRun, fromDateStr)` in `03_Admin_Kitchen.gs` with admin endpoints `syncBreakfastMenu` in `doGet` and `doPost`.
    - Executed batch sync on production across `SK_Daily_Menu` (from `2026-04-13` through `2027-02-13`), standardizing and updating prices across 128 sheet rows with zero pending drift.
  - **Future Cycle Integration:**
    - `populateMenuCycle` and runtime fallback `_findMenuRowOrCycle` automatically standardize combos and apply live `SK_Master_Breakfast` prices to all generated and virtual future cycle dates.
- **Strict Menu-Only Cycle Copying & Operational Defaults Purge (CODE_VERSION 35.66)**
  - **Pure Menu Replication in `populateMenuCycle` (`03_Admin_Kitchen.gs`):**
    - Cycle population now strictly copies ONLY the 5 menu columns (`Breakfast_JSON`, `Lunch_Dry`, `Lunch_Curry`, `Dinner_Dry`, `Dinner_Curry`).
    - All operational fields are strictly forced to site-wide defaults: `Cutoff_Breakfast`, `Cutoff_Lunch`, `Cutoff_Dinner` to `""`, and `Order_Cap_JSON`, `Cap_Alt_JSON`, `Orders_Closed`, `Stock_JSON` to `"{}"`.
  - **Batch Cleanup Tool (`cleanCycleDefaults`):**
    - Added `cleanCycleDefaults(dryRun)` in `03_Admin_Kitchen.gs` and admin endpoint `cleanCycleDefaults` in `doGet`/`doPost`.
    - Batch-purged old cutoff overrides and slot caps across 86 rows in Cycle 2 (`SK_Daily_Menu`), ensuring all future cycle dates inherit live site-wide default cutoffs and caps.
- **Endless 22-Week Menu Cycling & Modulo-154 Dynamic Fallback (CODE_VERSION 35.65)**
  - **Base Cycle Architecture (`00_Config.gs`):**
    - Defined `MENU_BASE_START = "2026-04-13"` (Monday, Day 0 of 22-week base cycle).
    - Defined `MENU_CYCLE_DAYS = 154` (22 weeks × 7 days; exact multiple of 7 guarantees 0 weekday drift across all future cycles).
    - Defined `MENU_CYCLE_START = "2026-09-14"` (Monday, start of Cycle 2).
  - **Mathematical Modulo-154 Fallback (`02_Orders_Menu.gs`):**
    - Added `getCycleSourceDate(targetDateStr)`: calculates source date in base cycle via `(target - 2026-04-13) % 154`. Verified across 1,000 future days with zero day-of-week drift.
    - Added `_findMenuRowOrCycle(menuRows, dateStr)`: returns physical row if present; if absent and $\ge$ `2026-09-14`, resolves virtual menu row with fresh operational fields (`Orders_Closed = {}`, `Stock_JSON = {}`, `Kitchen_Closed = false`).
    - Wired into `_getMenuUncached(dateStr)`, `submitOrder`, and order preflights.
  - **Base Cycle Gap Resolution for Saturday 2026-08-08:**
    - Repetition distance and ingredient clash analysis performed across 18 days surrounding 2026-08-08.
    - Patched dinner sabjis for `2026-08-08`: **Dry:** `French Beans` (4d before, 5d after), **Curry:** `Palak corn` (8d before, 5d after).
    - Added `patch20260808Menu` endpoint to execute the fix in `SK_Daily_Menu`.
  - **Cycle Populator & Gap Audit Tools (`03_Admin_Kitchen.gs` & `Code.gs`):**
    - `populateMenuCycle(cycleNum, dryRun)`: appends 132 working days (Mon–Sat) for any cycle into `SK_Daily_Menu`. Successfully populated Cycle 2 (`2026-09-14` to `2027-02-13`).
    - `checkUpcomingMenuGaps(daysAhead, startDateStr)`: scans upcoming working days for missing sabjis, missing breakfast items, or unintended closures. 154-day scan confirmed 0 gaps.
- **Stopped Auto-Generating Labels at T+5 for Lunch and Dinner (CODE_VERSION 35.64)**
  - **Server-side (07_Labels_Auto.gs & Code.gs):**
    - Set `LBL_AUTO_MEALS = []` and made `labelAutoTick()` exit immediately.
    - Added `removeLabelAutoTrigger()` helper and administrative route `action === "removeLabelAutoTrigger"` to delete the 1-minute clock trigger from Google Apps Script. Executed on production, reducing live triggers from 16 to 15.
  - **Kitchen View Client-side (docs/Admin/kitchen.html):**
    - Set `AUTO_LABEL_MEALS = []`.
    - Updated `scheduleAutoLabels()` and `autoFireLabel()` to clear any timers and immediately return without scheduling or firing automatic label generation.
    - Manual label generation remains 100% functional via the Kitchen "Labels" tab (staff can still select date/meal, click "⚡ Generate Labels", and click "💾 Save PDF to Drive").
- **Unmark Delivered Feature & Driver Page Address Standardization Parity (CODE_VERSION 35.63)**
  - **Unmark Delivered Feature (docs/Admin/driver.html & 04_Reports_Misc.gs):**
    - Added `unmarkDelivered(body)` endpoint in `04_Reports_Misc.gs` supporting single `submissionId` or batch `submissionIds` (for Enkin consolidated cards). Clears `Delivered_At` in `SK_Deliveries` while keeping `EnRoute_At` intact.
    - Added route `action === "unmarkDelivered"` in `Code.gs` with strict `isStaff` authentication.
    - Driver UI (`driver.html`): On each delivered order card, renders an undo action button: `<button class="btn-unmark">↩️ Marked by mistake? Tap to Unmark</button>`.
    - Safety Confirmation & UX: Prompts driver via `sConfirm`, optimistically updates UI (card state, badge, un-greying deliver button, progress counters, re-positioning above delivered cards).
    - Offline Robustness: If an order is unmarked, pending offline queue delivery entries in `localStorage` (`sk_driver_offline_queue`) are immediately purged so they won't re-deliver on reconnect. If the unmark network request fails, it queues `item.type === "unmark"` in the offline queue and `_flushOfflineQueue` retries it when back online.
    - Multi-Device Sync: `silentPoll` automatically detects remote unmarks and synchronizes card button states and counters.
    - Button Rename: Renamed legacy `↻ Restart Delivery` to `🔓 Activate Mark Delivered (${lockedCount})` so drivers immediately understand that tapping it activates any disabled `"Mark Delivered"` buttons without resetting completed deliveries.
  - **Driver Page Address Display Parity:**
    - Standardized addresses from `SK_Orders` (`Full_Address`) and `SK_Customers` (`Meal_Addresses`) now display with full parity on the driver delivery page (`docs/Admin/driver.html`).
    - When `mealAddresses` JSON is present, `renderCard` prefers `full_address` / `fullAddress` from the standardized record. When assembling from address parts, it avoids duplicate prefixes (`Wing Wing`, `Flat Flat`, `Flat Office`, `Floor Floor`) and suppresses redundant area badges when already part of the address line.
- **Delivery Area 'Mandai' Standardized to 'Hadapsar Mandai' (CODE_VERSION 35.62)**
  - **Database Migration:** Renamed area primary key in `SK_Areas` from `"Mandai"` to `"Hadapsar Mandai"`, and updated all occurrences across `SK_Customers` (`Area` column, `Full_Address`, and `Meal_Addresses` JSON blob), `SK_Customers_Archive`, and active orders in `SK_Orders` with automated backup sheet `SK_Customers_MandaiBackup_<ts>`.
  - **Area Dropdowns & Autocomplete:** Synced `DEFAULT_AREAS` in `03_Admin_Kitchen.gs`, `loadAreas()` in `docs/order.html` and `docs/Liviano-Serio.html` to display and submit `"Hadapsar Mandai"` for all future orders and customer profile updates.
  - **Backward-Compatible Profile Normalization:** Added auto-normalization in `_upsertCustomer` and `submitOrder` (`02_Orders_Menu.gs`) as well as frontend login profile loading to seamlessly convert any legacy `"Mandai"` inputs to `"Hadapsar Mandai"`.
  - **SEO & Information Surfaces:** Updated `BUSINESS_CONTEXT` (`00_Config.gs`), `Backend/business.json`, system prompt in `04_Reports_Misc.gs`, and FAQ/JSON-LD schemas in `docs/index.html`, `docs/order.html`, and `docs/Liviano-Serio.html`.
- **Daily On-Account Payment Reminders & 7-Day Overdue Hard-Block (CODE_VERSION 35.61)**
  - **Daily On-Account Parity:** Extended `getOnAccountBill` (`04_Reports_Misc.gs`) to support Daily On-Account customers (`Billing_Cycle === "Daily"` or default) alongside Monthly accounts.
  - **7-Day "Remind Me Later" Grace Period:**
    - If all unpaid on-account orders are within 7 days ($\le 7$ days from the oldest unpaid order date), a payment reminder modal is shown with a "Remind me later" button. Clicking it dismisses the prompt for that browser session, allowing orders to be placed freely.
  - **Mandatory Hard-Block (> 7 Days Overdue):**
    - If any unpaid order is older than 7 days ($> 7$ days, e.g., on Aug 28 an unpaid order from Aug 20 is 8 days old), `isOverdue` flips to `true`.
    - Modal becomes unskippable: "Remind me later" is disabled and replaced by *"Please clear pending dues to continue"* with friendly reminder copy. Backdrop clicking is blocked.
    - Full outstanding dues till date must be cleared before the customer can proceed.
  - **Authoritative Backend Guard:** Hardened `submitOrder` (`02_Orders_Menu.gs`) and `submitBulkOrder` (`06_Bulk_Orders.gs`) to verify `getOnAccountBill` for both monthly (>= 10th) and daily (> 7 days) on-account customers, rejecting order placement with a descriptive error if overdue.
  - **Settlement Parity:** HDFC Gateway one-tap payment automatically passes `scope: "all"` for daily accounts (and `"monthly"` for monthly accounts) in `docs/order.html` and `docs/Liviano-Serio.html`, settling all outstanding dues up to date.
- **22 Approved Address Groups Standardization & Automated Backup (CODE_VERSION 35.60)**
  - **Comprehensive Multi-Account & Duplicate Address Standardization:** Processed 22 owner-approved address duplicate clusters covering 54 customer profiles in `SK_Customers` and 18 active orders in `SK_Orders` to consolidate physical delivery locations into shared delivery slots (`slotType: "shared"`).
  - **Automated Backup Safeguard:** Added `standardizeApprovedAddressGroups(commit)` in `04_Reports_Misc.gs` which creates a timestamped backup sheet `SK_Customers_AddrBackup_<yyyyMMdd_HHmm>` before applying changes (`SK_Customers_AddrBackup_20260910_1051`).
  - **Covered Clusters (All 22 Groups):**
    - Commercial Offices: Marvel Fuego #2120 (6 profiles), Cosmopolis #803 (4 profiles), City Centre #302 (2 profiles), Konark Icon #505 (2 profiles), Cybercity Tower 11 (3 profiles), Gandharv Capital #201 (Venkatakrishnan dvk).
    - Residential Flats / Roommates / Families: Amanora Elevate T47 #1702 (2 profiles), Amanora Future T52 #4 (2 profiles), Amanora Gold T44 #1408 (2 profiles), Laburnum Park B-503 (3 profiles), Laburnum Park P-701 (3 profiles), Laburnum Park C-701 (2 profiles), Laburnum Park A-403 (2 profiles), Cosmos K-103 (4 profiles), Brick Castle A-602 (Virata Bhabal & Atul Raju - wing/flat swap resolved, 2 profiles), Kumar Paradise A1A-303 (2 profiles), Trillium C-404 (2 profiles), Imperial Heights B-204 (2 profiles), Heliconia 1 P-304 (2 profiles).
    - Duplicate Customer Profiles: Simil Aggarwal (Kumar Prospera A1-1602, 2 profiles), Manjush Tupe (Laxman Villa B-202, 2 profiles), Ranjita Patgar (Laburnum Park P-1002, 2 profiles).
  - **Meal_Addresses Sync:** Both top-level address fields (`Flat`, `Wing`, `Floor`, `Society`, `Area`, `Landmark`, `Full_Address`) and nested per-meal JSON addresses (`Meal_Addresses`) are synchronized across breakfast, lunch, and dinner.
  - **Typo Normalization Guard:** Reinforced `_normSocietyKey` (`02_Orders_Menu.gs`) with `base.indexOf("serenity") === -1` guard to guarantee Gandharv Capital normalization rules never collide with Gandharva Serenity in Handewadi.
- **Gandharv Capital Shared Slot Consolidation & Address Standardization (CODE_VERSION 35.59)**
  - **Shared Slot Grouping:** Consolidated customer profiles and active orders for Aniket Belhekar (`9730157106`), Nitupriya Ekorge (`8411824400`), and Supriya Ekorge (`8411827977`) at Office 201 Gandharv Capital (Bhosale Nagar) into a single shared delivery slot (Primary Slot #22, others `slotType: "shared"`, reducing stop consumption from 3 slots to 1 slot).
  - **Unified Address Profile:** `Flat: 201`, `Wing: ""` (cleared to avoid wing mismatch in single-building complexes), `Floor: 2`, `Society: Gandharv Capital`, `Area: Bhosale Nagar`, `Landmark: Opp Bhosale Garden`, `Full_Address: Office 201, 2nd Floor, Gandharv Capital, Opp Bhosale Garden, Bhosale Nagar`.
  - **Society Typo Normalization:** Added typo and spelling variation mappings in `_normSocietyKey` (`02_Orders_Menu.gs`) mapping `gandharv`, `gandharva`, `gamdharv`, and `gandharav` to `gandharvcapital`, and added canonical display name to `DISPLAY_TITLES`.
  - **Wing-Society Auto-Collapse Guard:** Synchronized in both `_countActiveMealOrders` (`02_Orders_Menu.gs`) and `_getAdminDataUncached` / `getOrderSummary` (`03_Admin_Kitchen.gs`): if a user enters the building or society name into the `Wing` input (e.g. `w === "gandharvcapital"`), `w` auto-normalizes to `""` so orders never split into separate delivery slots.
  - **Alias Seeding:** Seeded `SK_Society_Aliases` tab with `Gandharv Capital`, `*gandharv capital`, `*gandharva capital`, `*gamdharv capital`, `*gandharav`, `*ucon pt gandharva`.
- **Bulk Order Auto-Rescheduling on Kitchen Closure (CODE_VERSION 35.57)**
  - **Involuntary Kitchen Closure Reschedule:** When the admin closes a kitchen date/meal via `setKitchenClosed` (`03_Admin_Kitchen.gs`), active bulk orders (`Source === "Bulk"`, `Batch_ID`, or `Bulk_Plan`) are **no longer cancelled or refunded**.
  - **Next Available Non-Order Working Day:** Each affected bulk meal is automatically rescheduled to the customer's next available working day (`_findNextNonOrderWorkingDay`), strictly skipping Sundays, admin-closed dates for that meal, and dates where the customer already has an active order for that meal.
  - **Cascading Date Allocation:** If multiple bulk meals are affected for a customer (or on full-day closure), each cascades into consecutive open working days without date collisions.
  - **Quota Protection:** Administrative shifts are recorded in `Bulk_Postponed` as `"Kitchen Close: shifted from <date> to <nextDate> @ <ts>"`. Helpers `_isCustomerBulkPostponed` in `06_Bulk_Orders.gs` and `02_Orders_Menu.gs` ensure administrative shifts do NOT consume the customer's self-service postpone quota (`BULK_POSTPONE_CAP`).
  - **Standard Orders Handled Normally:** Regular single orders continue to be automatically cancelled and refunded (wallet, manual UPI queue, or On-Account adjustment).
  - **Admin UI Confirmation:** `docs/Admin/vault_admin.html` clearly displays the breakdown of standard orders (to cancel & refund) vs bulk orders (to reschedule).
- **Missed Orders 3-Day Retention & Direct Reconciler Auto-Recovery (CODE_VERSION 35.56)**
  - **3-Day Retention Window:** `archiveMissedOrders()` in `04_Reports_Misc.gs` retains the last 3 days in `SK_Missed_Orders` (shortened from 7 days), archiving older rows to `Archive_Missed_Orders_YYYY` with resilient multi-field date fallback parsing (`Detected_At`, `Order_Date`, `Timestamp`, regex extractor).
  - **Zero-Loss Flow for Confirmed Charges:** Checkout sessions that are confirmed paid but missing from `SK_Orders` are flagged and recovered directly from `SK_Order_Log` stash into `SK_Orders`. Unconfirmed/unpaid checkout sessions (`status: "NEW"`) are safely ignored.
- **Manual Emergency Missed Order Recovery Endpoint (CODE_VERSION 35.55)**
  - Added `placeMissedOrderManual` endpoint to manually place emergency missed orders into `SK_Orders` and `SK_Missed_Orders` from `SK_Order_Log` with full verification.
- **Area-Scoped Society Autocomplete Filtering (APP_VERSION v26.09.08.06)**
  - **Dynamic Area-Based Society Filtering:** Society suggestions are now dynamically scoped to the customer's selected Delivery Area:
    - `Amanora`: Restricts suggestions strictly to Amanora Towers (Future, Adreno, Gold, Metro, Desire, Gateway, Neo, Elevate, Sweet Water Villas, Trendy, Aspire) + `Vrindavan Heights` (removed invalid Citizen Towers).
    - `Magarpatta`: Restricts suggestions to Magarpatta residential societies (Jasminium, Cosmos, Laburnum Park, Heliconia 1/2, Sylvania, Trillium, Roystonea, Zinnia), Cybercity & Towers 1–12, Destination Centre, Kumar Prospera, and Marvel Fuego (City Centre & Mega Centre excluded).
    - `Kirtane Baug`: Konark Icon, Kumar Paradise.
    - `DP Road`: 47 East.
    - `Bhosale Nagar`: Amar Ornate.
    - Unselected / Other Areas: Falls back to full canonical search pool.
- **Cybercity Towers 1–12 Dropdown & Alias Support (CODE_VERSION 35.50 / APP_VERSION v26.09.08.04)**
  - **All 12 Cybercity Towers in Autocomplete:** Added `Cybercity Tower 1` through `Cybercity Tower 12` explicitly to `CANONICAL_SOCIETIES` in `docs/order.html`.
  - **Backend Tower Preservation:** Updated `_normSocietyKey` in `02_Orders_Menu.gs` to preserve the specific tower key (`cybercitytower1`..`cybercitytower12`) before falling into the generic `*cybercity` contains rule, and added all 12 tower display titles to `DISPLAY_TITLES`.
  - **Alias Seeder:** Added all 12 towers to `seedCanonicalSocietyAliases`.
- **Customer Address Standardization & Society Autocomplete (CODE_VERSION 35.49 / APP_VERSION v26.09.08.03)**
  - **Type 2+ Letters Society Autocomplete Dropdown:** Replaced native browser datalist (which aggressively popped open all 25 options on empty click with unstyled OS box) with a sleek custom autocomplete dropdown (`initSocietyAutocomplete` in `docs/order.html`). Requires users to type at least 2 characters before suggesting, highlights matching letters in bold brand orange (`#c2410c`), prioritizes prefix matches, and fully supports arrow key navigation, click/tap selection, and auto-closing on blur or click-outside.
  - **Auto-Canonicalization on Upsert:** `_upsertCustomer` automatically canonicalizes customer `profile.society` and `Meal_Addresses` JSON blob using `_getCanonicalSocietyDisplay`.
  - **Canonical Alias Seeder & Standardization Tool:** Added `seedCanonicalSocietyAliases(commit)` in `02_Orders_Menu.gs` to populate alias rules (including `Heliconia 1` vs `Heliconia 2` phase mapping and typo variants). Added `standardizeCustomerAddresses(commit)` in `04_Reports_Misc.gs` to extract embedded flat/wing/floor numbers from society, canonicalize names, update `Meal_Addresses`, and create automated backup tab `SK_Customers_AddrBackup_<ts>`.
- **Flat Normalization Parity Across Dashboard & Delivery Engine (CODE_VERSION 35.48)**
  - Synchronized aggressive numeric flat extraction in `_getAdminDataUncached` (`03_Admin_Kitchen.gs`) with `_countActiveMealOrders` (`02_Orders_Menu.gs`) so trailing wing letters in Flat (e.g. "601,P" -> 601) collapse identically in admin dashboard.
- **Society Typo Normalization + Magarpatta Tower Grouping (CODE_VERSION 35.47)**
  - **Typo-Resilient Society Aliases:** Added built-in fallback rules in `_normSocietyKey` (`02_Orders_Menu.gs`) for persistent customer misspellings: `labrunum`/`labranum`/`luburnum`/`lumburnum`/`labournam` → `laburnumpark`; exact `cosmo` → `cosmos`. These bypass the alias sheet's `*laburnum` contains rule which fails on character transpositions.
  - **Magarpatta Cybercity Tower 1–12 Grouping:** All orders at the same physical tower building now collapse to ONE delivery slot (driver delivers to one gate). Regex `/tower\s*(\d{1,2})(?!\d)/i` extracts tower number from combined Society+Wing+Flat+Area fields. Amanora township excluded (towers 18+). Applied in both `_countActiveMealOrders` (`02_Orders_Menu.gs`) and `_getAdminDataUncached` (`03_Admin_Kitchen.gs`). Key format: `mpt|N`.
- **Momstory Hospital Delivery Slot Exemption (CODE_VERSION 35.46 / APP_VERSION v26.09.08.01)**
  - **Zero Delivery Slot Consumption:** Orders for Sahyadri Momstory Hospital (`"momstory"` in address, flat, society, or landmark) are dropped at the basement desk of the adjacent building, requiring 0 delivery transit effort.
  - **Cap Exemption & Non-Blocking:** Synchronized across backend (`_countActiveMealOrders`, `_submitOrderInternal` cap guard in `02_Orders_Menu.gs`), admin dashboard stats (`_getAdminDataUncached` in `03_Admin_Kitchen.gs`), and customer frontend (`_mealKeepsDeliveryAtCap` in `docs/order.html` & `docs/Liviano-Serio.html`).
  - **Kitchen Prep Retained:** Items and food quantities continue to count normally toward kitchen prep totals, labels, and driver packaging.
- **Recovery Tool Hardening & Router Dispatch Support (CODE_VERSION 35.45)**
  - **Dual Action Detection (`_action` & `action`):** `doPost` in `Code.gs` now parses `body._action || body.action || ""` ensuring seamless routing for payloads using either naming convention.
  - **Explicit Payload Validation:** Replaced generic "Unknown action" fall-through with explicit error descriptions (e.g. *"No orders found in payload for submitOrder"*) and informative guidance if called via GET.
  - **Bulk Plan Recovery Support:** Added full support for recovering weekly, 15-day, and monthly bulk plans from `SK_Order_Log` stash rows (`stash.bulk`) via `submitBulkOrder`.
  - **Instant PIN Verification:** Switched admin gate on `recovery.html` to lightweight `verifyAdminPin` endpoint and attaches verified `pin` directly to recovery payloads.
- **Delivery Slot Status & Attribution on Admin Orders Tab (CODE_VERSION 35.51 / ADMIN_VERSION v26.09.08.08)**
  - **Authoritative Slot Attribution in `getOrderSummary`:** Enriched backend order summary with real-time delivery slot attribution matching `_countActiveMealOrders`: identifies whether each order takes a primary delivery slot (`slotType: "slot"`), piggybacks on an existing stop (`slotType: "shared"`), or is slot-exempt (`slotType: "exempt"`).
  - **Shared Slot Context:** Identifies exact sharing reasons (e.g. `Same Flat w/ Ankit Bansal`, `Cybercity Tower 11 w/ Nitin Jadhav`, `Same Customer`, `Enkin Batch`, `IA Corporate`).
  - **Exempt Reasons:** Identifies exact exemption reasons (`Self Pickup`, `Porter Courier`, `Momstory Desk Drop`, `Shree Laxmi Vihar Home Base`, `VIP Customer`, `Liviano-Serio`).
  - **Admin Orders Tab UI:** Displayed in `docs/Admin/vault_admin.html` with color-coded badges next to the Area chip (`🟢 Slot #N`, `🔄 Shared`, `⚪ Exempt`), delivery slot totals in meal headers (e.g., `🌅 Breakfast (9 delivery slots • 11 orders)`), and instant search filtering via search input.
- **Live Address Preview on Order Form (`docs/order.html` APP_VERSION v26.09.08.07)**
  - **Instant Real-Time Address Preview:** Renders an interactive live address preview card as customers type their address fields (Wing, Flat, Floor, Society, Area, Landmark, Handover instructions) in both single-address mode and per-meal mode.
  - **Natural Address Formatting:** Dropped explicit `"Wing"` and `"Flat"` labels so addresses format cleanly (e.g., `A 104, Jasminium, Magarpatta` or `3, KanchanJunga, Tupe Patil Road` or `Office 5, Cybercity Tower 12, Magarpatta`).
  - **Secondary Parameters Meta Chips:** Floor (e.g. `1st Floor`), Handover instructions (`Handover at Doorstep`), and Landmark are cleanly displayed in secondary badge chips.
  - **Reactive State Updates:** Automatically re-renders on every keystroke (`input`), dropdown change (`change`), society autocomplete suggestion selection, address mode toggle, and saved customer profile restore. Automatically hidden during Self Pickup.
- **Order Audit Hardening & Spam Prevention (CODE_VERSION 35.43 & 35.44)**
  - **36-Hour Operational Live Window:** `auditLostGatewayOrders` 10-minute live audit (`monthsBack === 0`) now checks only the last 36 hours of webhooks instead of 7 days, eliminating recurring false-positive alerts on older unrecoverable webhooks. The nightly deep audit (`monthsBack === 1`) retains the 7-day lookback.
  - **Fuzzy Header Matching & Deep Cell Scans:** Normalized header detection (`norm === "gatewayorderid" || norm === "gatewayid"`) across `ordHeader` and `missH`, plus fallback regex scanning (`/^(SK|LS)\d{6}[A-Za-z0-9]+/`) across `SK_Missed_Orders` and `Archive_Missed_Orders_YYYY` so logged/archived orders are never reported as missing.
  - **24-Hour CacheService Alert Deduplication:** Alert emails are throttled by `missed_alert_<OID>` cache key (86400s TTL), ensuring any single order ID sends at most one email alert per 24 hours even during edge-case sync delays.
  - **Authoritative Gateway Replay Guard:** Added pre-flight check in `_submitOrderInternal` (submitOrder) verifying `Gateway_Order_ID`. If active non-cancelled rows already exist for that gateway ID, returns `{ success: false, duplicate_detected: true }` and halts without writing duplicate rows.
- **Mobile-Friendly Order Recovery Tool (`docs/Admin/recovery.html`)**
  - Web UI for mobile browsers (www.svaadhkitchen.in/Admin/recovery.html) to recover missed orders from `SK_Order_Log` stash rows without Google Colab, Python, or a laptop.
  - Features: Admin PIN unlock, robust JSON healing (strips wrapping quotes, fixes `""` doubled quotes from Google Sheets exports, safely handles nested `meal_addresses`), full line-item preview, and double-run replay protection.
- **Dal Fry Admin Quick-Edit Pricing Parity (`docs/Admin/vault_admin.html` v26.09.07.01)**
  - Added Dal Fry to `GLOBAL_STAPLE_PRICES` (base ₹37, V2 = ₹40) and mapped `L_DAL_FRY`/`D_DAL_FRY` in `colKeyToDisplayName` to fix manual quick-edit fallback mispricing (was falling back to ₹24 as a generic mini sabji).
- **Society Pre-Approval Code System (MyGate / NoBrokerHood) (CODE_VERSION 35.41 / APP_VERSION v26.09.03.14)**
  - **Order-Bound Storage Architecture:** Added `MyGate_Code` as the **last column** in `SK_Orders` (`ORDERS_HEADERS` in `00_Config.gs`, index 60, col 61). Preserves 100% backward compatibility with existing sheet positions. PINs are strictly order-bound (not stored in `SK_Customers`) since gate approvals vary per order and validity dates.
  - **Batch Expansion:** `updateMyGateCode` in `02_Orders_Menu.gs` maps the PIN to all rows of the checkout session (matching by `Submission_ID`, `Gateway_Order_ID`, `Batch_ID`, or sibling rows submitted within 2 minutes for the same phone).
  - **Dynamic Time & Date Suggestions:** Pre-approval modal dynamically parses the checkout cart (`BK.cart` or `S.orders`/`S.date`) and recommends exact dates & meal intervals (e.g., *"Pre-approve From 4 Sept to 8 Sept (Breakfast, Lunch)"*).
  - **Conditional UI:** Automatically skipped if the customer did not enter a society name or ordered Self Pickup. Prominent skip button provided at the top for non-gated society residents.
  - **Driver Surface:** `docs/Admin/driver.html` via `getDriverOrders` in `03_Admin_Kitchen.gs` displays the order-specific `MyGate_Code` badge for delivery drivers.
  - **Fulfillment Detection Fix:** Fixed false-positive "Self Pickup" completion states caused by stale `S.profile.area` cache when ordering delivery in multi-address mode.
- **Stop Accepting Orders - Restricted Area Toggle (CODE_VERSION 35.22 / APP_VERSION v26.09.02.06)**
  - Added a new 3-way select dropdown in the admin dashboard under "Stop Accepting Orders".
  - States: "Open", "Closed Completely", and "Except Bhosale/Triveni".
  - When restricted, only customers with delivery addresses in Bhosale Nagar or Triveni Nagar (or who choose Self Pickup / Porter) are allowed to order. Everyone else sees the meal as "Not Accepting Orders".
  - Implemented client-side filtering in `docs/order.html` and authoritative backend validation in `02_Orders_Menu.gs` (`_ordersClosedW`).
- **Gateway Partial Refund Over-Allocation Guard (HDFC/Juspay):**
  - Clarified and verified cancellation refund constraints: HDFC/Juspay rejects refunds exceeding `total_charged - prior_refunds` with `400 Invalid request params`.
  - Same-day multi-meal cancellations across shared gateway payments must respect cumulative balance caps to avoid over-refunding beyond the transaction total.
- **Bug Fixes:**
  - Fixed live verification modal transition where an out-of-scope variable reference prevented the completion modal from rendering.
  - Removed restrictive validKeys filter in submitOrder that caused empty Items_JSON and blank item columns for Gateway (HDFC) breakfast/lunch/dinner orders (v35.21).
  - Hid Past Dues Recovery UI for On-Account customers since they do not pay upfront.
- **Features:**
  - **Friends & Family Discount (F&F):** Added a 20% discount on food subtotal for privileged customers, controlled via an admin toggle (toggleFnF). F&F customers bypass delivery caps and do not accrue 6th-day loyalty rewards.
  - **Billing:** Hard-blocked overdue On-Account monthly users after the 9th of the month.
  - **Reporting:** Added daily End-Of-Day email report summarizing new customers and daily metrics.

## Where the deep documentation lives
- `git log` — every commit message is a full incident/design writeup. Start any investigation with `git log --oneline -15`.
- CODE_VERSION comment in 00_Config.gs — reverse-chronological changelog of every backend release.

### Billing & On-Account
- **Monthly Dues:** Monthly On-Account users are hard-blocked from placing new orders if it is the 10th of the month (or later) and they have unpaid dues from previous month(s). UI shows an unskippable mandatory payment prompt.