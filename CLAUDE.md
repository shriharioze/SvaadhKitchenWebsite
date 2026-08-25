# Svaadh Kitchen — AI Assistant Brief (READ FIRST)

LIVE production system with REAL MONEY. Vegetarian cloud kitchen — main site serves Hadapsar, Pune; second storefront "Liviano-Serio" serves Ganga Serio, Kharadi.
Google Apps Script backend (clasp) + GitHub Pages frontend (docs/, www.svaadhkitchen.in).

## Deploy workflow — git push alone does NOT deploy the backend
- Backend: `clasp push -f` (updates HEAD, validates syntax) → bump CODE_VERSION in 00_Config.gs with a changelog comment → `clasp push -f` AGAIN (the bump must be in the pushed code) → `clasp deploy -i AKfycbz-wwECc_mSh949babtRt8OAvFbnJJzH5X9JS_PsN-f-IMHeYkQMj54fwXRs6PevK0W -d "msg"` → verify: GET `<exec>?action=version`.
- ⚠️ **clasp deploy pins a VERSION SNAPSHOT.** Pushing after deploying does NOT change a live deployment — re-run `clasp deploy` after every emergency push (2026-08-24 incident: ~10 min outage).
- ⚠️ **NEVER leave scratch .js files at repo root** — clasp pushes them and GAS executes .js globally (`require()` crash = total outage). Keep scratch in `scratch/` (gitignored + claspignored).
- Frontend: bump APP_VERSION (and any visible version text) in any modified HTML file (docs/order.html, docs/Liviano-Serio.html, docs/Admin/vault_admin.html, kitchen.html, driver.html, etc.) → git commit + push (GitHub Pages serves docs/ from main).
- ALWAYS commit to git after deploying (live and git must never diverge).
- Deploys take ~10s+ to propagate — re-check `?action=version` before concluding a fix "didn't work". Each deploy resets GAS caches/instances → the site is SLOW for a few minutes after every deploy (cold starts). Avoid deploying during business hours; batch changes.

## File map — go straight to the right file, never explore the whole folder

### Backend (.gs at repo root — ONE global scope, 00_Config loads first)
- `00_Config.gs` — CODE_VERSION (changelog in its comment!), all constants: tab names (SK_*/LS_*), ORDERS_HEADERS (60-col canonical schema), ITEM_COL_MAP, DEFAULT_ORDER_CAPS/CUTOFFS, CAP_DELIVERY_BYPASS_MIN, LS constants (TAB_LS_ORDERS/LS_CUSTOMERS/LS_WALLET, LS_ORDER_PAGE_URL, LS_SOCIETY_NAME, LS_FREE_DELIVERY, LS_PICKUP_ADDRESS), HDFC config (Script Properties refs), BUSINESS_CONTEXT (main-site chatbot brain).
- `Code.gs` — doGet/doPost ROUTERS (every action; LS storefront passed via `p.storefront`/`_lsStorefront(body)` into identity/wallet actions), HDFC return-redirect routing (order_id prefix: IA→intentamplify, LS→Liviano-Serio.html, else order.html), shared utils: `getSpreadsheet`, `headerIndex`, `getAllRows`, `getRecentRows`, `generateSubmissionID(prefix)` ("SK-"/"LS-"), `getISTDate/Timestamp`, `_effectiveOrderCaps`, `_stripItemSuffix`, `itemsJsonKey`, `countOrderedUnits`, `_calculateWalletBalance(phone, preloadedRows, storefront)`, `_appendWalletTransaction(..., storefront)`.
- `02_Orders_Menu.gs` — THE ORDER ENGINE. `submitOrder`→`_submitOrderInternal` (lock, idempotency, cap/stock pre-flights, LS rules, pricing, wallet deduct, dedup layers, row write, `_missedOrderSafetyNet(..., tabName)`); `getCustomer(phone, storefront)`, `verifyLogin(phone, pin, storefront)` (LS skips SK-archive + login notices), `_upsertCustomer(ss, profile, storefront)`, `getCustomerOrders(phone, storefront)`, `verifyOrderPlaced` (storefront-routed), `getDayTotalsForDates(..., storefront)`, `_calculateLoyaltyStreak(..., storefront)`, `getWalletTransactions(phone, storefront)`, `deleteOrder`→`_deleteOrderInternal` (per-row `_wsOf/_hOf` cross-tab writes, clawbacks with cell re-read fix), PIN-reset OTP trio (storefront-routed), `markOnAccount`, cutoff/cap helpers (`_effectiveCutoffsForDate`, `_getDefaultOrderCaps`), `_kitchenClosedSet/_isMealKitchenClosed`.
- `03_Admin_Kitchen.gs` — `getAdminData`→`_getAdminDataUncached` (LS rows merged: prep counts INCLUDE, delivery-cap slots EXCLUDE), menu CRUD (`saveMenu`, `setKitchenClosed` per-meal), `getKitchenSummary` (Items_JSON merge: owner-flipped Meal_Types + blank-BF-slot rows now count in prep; cross-meal BF-slot block guarded against column double-count) / `getDriverOrders` / `getLabelOrders` (type-agnostic fields — BF slots + L/D cols + Items_JSON on EVERY row; kitchen notes NOT printed on labels per owner; `.concat(ls_rowsAsSK())` IA-pattern), `markRefunded` (wallet credit routed by order's tab), `getOrderSummary` (rows carry `ls:true` → [LS] badge), areas CRUD, packaging, `saveLabels`.
- `04_Reports_Misc.gs` — chatbot (`handleChat`, BUSINESS_CONTEXT prompt), `markOrdersStatus` (cross-tab, per-row `_wsOf/_hOf`, cell re-read fix), `getOrderHistory` (ls flag), `getCustomerList/History` (main-site customers only), `_analyticsCore`/`getAnalytics`/forecast (via `getOrdersInRangeWithArchive` which includes LS), `archiveMonth` (manual whole-month tool; Date-preserving rebuild — see incident 2026-08-25), **`archiveDueOrders(dryRun)` + `_archiveSliceDueDate` = THE scheduled archiver** (due-slice policy: days 1-10→due 18th, 11-20→due 28th, 21-end→due next-month 8th; terminal rows only; Pending/On-Account stay live until settled then archive into THEIR month's existing file; daily ~22:30 IST trigger via `runScheduledArchive`/`setupMonthlyArchiveTrigger`/`stopMonthlyArchiveTrigger`; preview `?action=archiveDueDryRun&pin=…`; LS_Orders intentionally NOT archived yet), `getOrdersInRangeWithArchive` (unions LS live rows, tagged `_lsTab`), `markOrderPacked` (cross-tab).
- `05_Customer_Archive.gs` — `updateCustomerLastOrder(phone, storefront)`, `archiveIdleCustomers` (SK_Customers only), `_findArchivedCustomer/_restoreArchivedCustomer` (SK archives; LS never archived).
- `06_Bulk_Orders.gs` — bulk engine: `_bulkFeeCtx(phone, profile, storefront)` (ctx.lsFree), `_bulkPriceFromWindows` (LS free delivery), `_bulkComputeBatch`, `submitBulkOrder` (storefront-routed tab + wallet, LOCKED), `submitBulkDirect` (wallet/on-account), `hdfc_finalizeBulkOrder` (stash→routed write), `postponeBulkOrder`/`getBulkPostponeInfo` (cross-tab row lookup).
- `07_Labels_Auto.gs` — auto label PDFs at cutoff+5 (Slides API, anti-drift). Reads via getLabelOrders (includes LS). `_lblItemSummary` renders Items_JSON-FIRST (source of truth regardless of Meal_Type) with BF-slot/L-D-col/Curd fallbacks — fixes blank-BF-slot breakfast labels + owner-flipped Meal_Types. LBL_MR/EN cover the full breakfast menu (Devanagari + transliterated codes).
- `10_Hdfc_Gateway.gs` — HDFC SmartGateway: `hdfc_createSession` (authoritative amount via `_computeAuthoritativeTotal(savedOrders, phone, storefront)` / `_bulkAuthoritativeTotal(..., storefront)`, split-wallet balance read routed), `hdfc_savePendingOrder` (stash carries `storefront`), `hdfc_markOrderPaid/markOrderFailed` (scan BOTH order tabs), `_hdfcAmountMismatch`, `hdfc_createWalletRechargeSession` (LS ids "LS…W", stash storefront) / `hdfc_finalizeWalletRecharge` (credits routed wallet), on-account session/settle.
- `11_Hdfc_Reconciler.gs` — self-healing: `_reconcileSingleEntry` (per-order lock; recharge regex `/^(SK|LS)\d{6}W/`; dedup scans both tabs; `_buildSubmitBodyFromPending` passes storefront through), `hdfc_reconcileOrderFromStash`, `reconcilePendingOrders` sweep.
- `12_Payout_Reconciler.gs` — payout reconciliation.
- `13_LivianoSerio.gs` — **LS STOREFRONT MODULE** (read this first for LS work): `_lsStorefront(body)`, `_lsDeliveryFree(sf)`, `_lsOrdersWs(ss, sf)` (lazy LS_Orders, SK schema minus LS_DROP_COLUMNS=[Maps_Link, Landmark]), `_customersTabFor(ss, sf)` (lazy LS_Customers), `_walletTabFor(ss, sf)` (lazy LS_Wallet), `_lsPickupLabel(sf)`, `ls_rowsAsSK()`, `lsTrimSchema(commit)` (dry-run default; admin GET `?action=lsTrimSchema&pin=…&commit=1`). NOTE: `_getAllOrdersBothTabs*` helpers are LEGACY (pre-separate-bases) — identity reads are now own-tab only.
- `IntentAmplify.gs` — corporate channel (IA_*, [IA] name prefix, manual UPI default) — separate pattern; do not confuse with LS.

### Frontend (docs/ — GitHub Pages)
- `docs/order.html` — MAIN customer app (APP_VERSION marker; Hadapsar; B/L/D; gateway+wallet). DO NOT touch for LS changes.
- `docs/Liviano-Serio.html` — LS storefront clone. LS-specific: `STOREFRONT="LS"` injected into every POST by `apiPost`; LS-prefixed gateway ids; `_lsApplyAddressLocks`-era helpers `_lsSocietyForWing/_lsSyncSociety/_lsPinSocietyInputs` (area=Kharadi locked, wing dropdown A–G2, society auto Liviano/Serio); free-delivery UI; Breakfast removed; LS texts in guide/FAQ/JSON-LD; `&storefront=LS` on all GET identity/order/wallet calls.
- `docs/order-chat.js` — help-chat widget (shared). `IS_LS` gates chips/greeting; Gemini messages prefixed with LS_CONTEXT; main-page behavior unchanged.
- `docs/Admin/vault_admin.html` — admin panel ([LS] badge via `c.ls`/`o.ls`; APP_VERSION marker).
- `docs/Admin/kitchen.html` — ops surfaces (LS rows included server-side). Label tab `getBulkItemSummary` mirrors backend `_lblItemSummary` (Items_JSON-first); LABEL_MR/EN extended (full breakfast menu, Devanagari + codes). Kitchen notes intentionally not on labels.
- `docs/Admin/driver.html` — ops surface (LS rows included server-side).
- `docs/intentamplify.html` + `docs/Admin/ia_admin.html` — IA corporate channel.
- `docs/index.html` — SEO home (keep FAQ in sync with BUSINESS_CONTEXT when facts change).

### Data tabs (master Google Sheet)
SK_Orders · SK_Customers · SK_Wallet · SK_Daily_Menu · SK_Areas · SK_Refunds · SK_Webhook_Log · SK_Missed_Orders · SK_Default_Cutoffs/Caps · SK_Master_Breakfast/Sabjis · SK_Login_Notices · SK_Deliveries · IA_* · **LS_Orders** (SK schema minus Maps_Link/Landmark) · **LS_Customers** · **LS_Wallet** (all lazily created by 13_LivianoSerio.gs helpers).

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
5. Delivery: main site ₹11/meal, free at ₹106/159/190, free areas Bhosale Nagar+Triveni Nagar+pickup/porter. LS: always free. Cap bypass ≥₹200 (breakfast ₹100). **Cap Counting:** unique customer name per meal; VIPs (Fee_Exempt) = 0 slots; Enkin/IA collapse to 1; LS = 0 slots, never blocked.
6. Wallet: `_calculateWalletBalance` classifies Txn_Type KEYWORDS (credit keywords win first; never name a debit type with them). Wallet is NEVER archived; only safe shrink is `?action=compactWalletLedger` (dry-run default). LS wallet is LS_Wallet — route by storefront, refunds credit the ORDER's wallet.
7. On-account status: `_isOnAccountDueStatus` only. Kitchen-closed: `_closedMealsObj`/`_isMealKitchenClosed` (per-meal).
8. Stock keys: Items_JSON names are suffix-stripped; join via `itemsJsonKey`/`_stripItemSuffix`.
9. HDFC refund API returns 401 "Merchant disabled for refund" until HDFC enables the MID — cancelled gateway orders queue as manual refunds; run `retryQueuedRefunds()` once enabled. Test transport: `?action=hdfcRefundTransportTest`.
10. **SK_Orders/LS_Orders lock rule:** EVERY writer to an orders tab MUST hold `LockService.getScriptLock()` (try/finally). Unlocked writers get silent appendRow drops = missing orders. Locked writers: submitOrder(10s), submitBulkOrder(30s), submitBulkDirect(20s), deleteOrder(15s), markOrdersStatus(8s), _reconcileSingleEntry(15s), hdfc_markOrderPaid(10s), hdfc_markOrderFailed(10s), submitManualOrder(10s), archiveMonth(30m), _appendWalletTransaction(10s, re-entrant).
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
`version` · `health` · `getPendingRefunds` · `listRecentRefunds&n=20` · `hdfcRefundTransportTest` · `auditOnAccountDrift` · `listSocieties` · `auditAmanoraTowers` · `backfillBulkPlan` · `seedAmanoraTowerAliases` · `compactWalletLedger` · `lsTrimSchema` (dry-run; `&commit=1` executes) · `getForecastedMonthlySales` · `getDefaultCutoffs` · `getDefaultOrderCaps`
Base: `https://script.google.com/macros/s/AKfycbz-wwECc_mSh949babtRt8OAvFbnJJzH5X9JS_PsN-f-IMHeYkQMj54fwXRs6PevK0W/exec`

## Facts that get answered wrong from stale data
- PRICING_V2 LIVE: Chapati 10, WO-Chapati 9, Phulka 8, Ghee Phulka 11, Bhakri 22, Sabji Mini 24/Full 48, Dal 24, Dal Fry 40, Rice 13, Salad 8, Curd 13. No market surcharge (Inflation_Surcharge = loyalty accrual only).
- Cutoffs (verify live): B 7:00 / L 9:00 / D 16:30. Sundays closed. Caps: B 11 / L 24 / D 23.
- Bulk plans PUBLIC: Week 6d 5% / 15-Day 13d 7.5% / Month 26d 10%; postpone 2+2 / 4+4 within 30 days; cancel forfeits that meal's bulk discount.
- LS storefront: Ganga Serio Kharadi, wings A–G2 (A–D=Liviano, E1–G2=Serio), Lunch & Dinner only, free delivery, pickup at G2 804, unlisted page.
- Archive policy: due-slice (1-10→18th, 11-20→28th, 21-end→next-month 8th), terminal rows only (Paid/Cancelled/Refunded), Pending/On-Account stay live, per-month existing files appended, daily ~22:30 IST trigger, preview `archiveDueDryRun`.
- Contact: WhatsApp +91 93222 46765; calls 9930748908 / 9819969682. Keep BUSINESS_CONTEXT, Backend/business.json, index.html FAQ/JSON-LD, order.html FAQ/GUIDES in sync when facts change.

## Where the deep documentation lives
- `git log` — every commit message is a full incident/design writeup. Start any investigation with `git log --oneline -15`.
- CODE_VERSION comment in 00_Config.gs — reverse-chronological changelog of every backend release.
