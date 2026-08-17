# Svaadh Kitchen — AI Assistant Brief (READ FIRST)

LIVE production system with REAL MONEY. Vegetarian cloud kitchen, Hadapsar Pune.
Google Apps Script backend (clasp) + GitHub Pages frontend (docs/, www.svaadhkitchen.in).

## File map — go straight to the right file, never explore the whole folder
- `00_Config.gs` — constants, CODE_VERSION (changelog in its comment!), BUSINESS_CONTEXT (the chatbot's brain — NOT Backend/business.json)
- `Code.gs` — doGet/doPost routing, stock-limit helpers, shared utils (_cachedData, getISTDate)
- `02_Orders_Menu.gs` — getMenu, submitOrder (authoritative order write), wallet (_calculateWalletBalance), loyalty streak, society aliases, cutoffs, lost-order audit
- `03_Admin_Kitchen.gs` — getAdminData, menu CRUD, setKitchenClosed (per-meal), refunds queue, driver/labels/packaging
- `04_Reports_Misc.gs` — chatbot (handleChat/buildSystemPrompt/callGemini), analytics (_analyticsCore), forecast, archiver, compactWalletLedger, getOrdersInRangeWithArchive
- `06_Bulk_Orders.gs` — bulk plans (week/15day/month), postpone, pricing parity, submitBulkOrder (locked write)
- `07_Labels_Auto.gs` — auto label PDFs at cutoff+5 (Google Slides API absolute coordinate positioning, exact 27.7mm pitch + dividing lines to prevent thermal printer drift)
- `10_Hdfc_Gateway.gs` — HDFC SmartGateway: sessions, webhooks, refunds, on-account settlement
- `11/12_*.gs` — order + payout reconcilers (self-healing)
- `docs/order.html` — THE customer app (APP_VERSION marker); `docs/Admin/vault_admin.html` — admin panel; `docs/index.html` — SEO home; `docs/chat.js` — chat widget
- All .gs files share ONE global scope (00_Config loads first).

## Deploy workflow — git push alone does NOT deploy the backend
- Backend: `clasp push -f` (updates HEAD, validates syntax) → bump CODE_VERSION in 00_Config.gs with a changelog comment → `clasp deploy -i AKfycbz-wwECc_mSh949babtRt8OAvFbnJJzH5X9JS_PsN-f-IMHeYkQMj54fwXRs6PevK0W -d "msg"` → verify: GET `<exec>?action=version`.
- Frontend: bump APP_VERSION (and any visible version text) in any modified HTML file (docs/order.html, docs/intentamplify.html, docs/Admin/vault_admin.html, kitchen.html, driver.html, etc.) to trigger auto-reload for clients → git commit + push (GitHub Pages serves docs/ from main).
- ALWAYS commit to git after deploying (live and git must never diverge).
- Deploys take ~10s to propagate — re-check `?action=version` before concluding a fix "didn't work".

## Money rules — violating these has cost real money before
1. The gateway ALWAYS recomputes the authoritative total server-side (`_computeAuthoritativeTotal`, `_bulkAuthoritativeTotal`, `_computeOnAccountDue`). NEVER trust or subtract client-sent amounts from a charge. Reconcile gaps by over-collecting + refunding to wallet.
2. Charge == storage: what HDFC charges must equal the sum of written rows.
3. Loyalty 6-day streak is computed in THREE engines that must agree: frontend (order.html calculateLoyaltyStreak + bill), submitOrder, gateway. The frontend's history INPUT (streak_rows, 45 rows) is part of the contract — never feed it truncated history. **Partial-close bug (fixed 2026-08-13):** the backend must check for a valid order on a day BEFORE checking if the day is closed/Sunday. If the customer ordered an open meal on a partially-closed day, that day counts toward their streak. The old code skipped the entire day on any closure, silently reducing the streak count and robbing customers of their 6th-day discount.
4. Discount tiers (5%≥325 / 7.5%≥485 / 10%≥750) are HARDCODED in 5 places (order.html, submitOrder, gateway, bulk, reports) — change all or charge≠cart.
5. Delivery: ₹11/meal; free at day-food ₹106 (1 meal) / ₹159 (2) / ₹190 (3); small fee ₹11 if L/D meal <₹53; free areas Bhosale Nagar + Triveni Nagar + pickup/porter. Cap bypass: meal ≥₹200 (breakfast ₹100) still delivered when slots full.
6. Wallet: `_calculateWalletBalance` classifies by Txn_Type KEYWORDS — credit keywords (recharge/refund/credit/carry) win first; never name a debit type with them. Wallet is NEVER archived by archiveMonth; the ONLY safe shrink is `?action=compactWalletLedger` (dry-run default, commit=1; full backup tab auto-created).
7. On-account status check: use `_isOnAccountDueStatus` only. Kitchen-closed check: use `_closedMealsObj`/`_isMealKitchenClosed` (per-meal), not raw Kitchen_Closed.
8. Stock keys: Items_JSON names are suffix-stripped; always join via `itemsJsonKey`/`_stripItemSuffix`.
9. HDFC refund API returns 401 "Merchant disabled for refund" until HDFC enables the MID — cancelled gateway orders queue as manual refunds; run `retryQueuedRefunds()` (editor) once enabled. Test transport anytime: `?action=hdfcRefundTransportTest`.
10. **SK_Orders lock rule:** EVERY function that writes to SK_Orders (appendRow OR setValue) MUST hold `LockService.getScriptLock()` with try/finally release. Unlocked writers cause Google Sheets' internal buffer to silently drop concurrent `appendRow` calls — the root cause of "missing order" incidents. Currently locked writers: `submitOrder` (10s), `submitBulkOrder` (30s), `submitBulkDirect` (20s), `deleteOrder` (15s), `markOrdersStatus` (8s), `_reconcileSingleEntry` (15s), `hdfc_markOrderPaid` (10s), `hdfc_markOrderFailed` (10s), `submitManualOrder` (10s), `archiveMonth` (30m). If you add a new SK_Orders writer, wrap it in a lock or orders WILL go missing.
11. **Bulk duplicate race condition (fixed 2026-08-17):** `submitBulkOrder` now holds a script lock around its entire write path. Without it, the browser's `hdfc_finalizeBulkOrder` and the webhook's `hdfc_reconcileOrderFromStash` could both fire within the same second, both read zero existing rows, and both write the full batch — creating exact duplicates (e.g. 52 unique meals → 80 rows). The existing idempotency check (`existingKeys`) only works when the second caller can SEE the first caller's rows, which requires the lock.
12. **Kitchen count roundoff rule:** ALL kitchen summary counts and kg portions (Dal, Dal Fry, etc.) use `_customKitchenRound` (decimal $\ge 0.35$ rounds up $+1$, $\le 0.34$ rounds down $+0$). e.g., Varan `11.97` $\rightarrow$ `12`, Dal Fry `7.98` $\rightarrow$ `8`.
13. **Negative Wallet Balances:** If a user's wallet has a negative balance (e.g. manual admin deduction), the system automatically forces them to pay it off on their next order (standard or bulk) by inflating the checkout/gateway total and logging a `Debt Recovery Recharge` to reset the wallet to 0.

## Testing rituals (these produced the quality — keep them)
- Money/logic change in .gs: EXTRACT the real function text (regex, mind CRLF `\r?\n`) and eval it in a Node script with stubbed globals; assert realistic scenarios BEFORE deploying. Note: eval'd `const` doesn't leak — extract the RHS and assign to global.
- Frontend change: drive the real page in a browser/preview (call the actual functions, read the DOM), not just eyeball the code.
- Admin data ops: build dry-run-by-default endpoints (`&commit=1` to execute) and run the dry-run live first.
- After every backend deploy: one read-only live smoke call proving the change.

## Admin GET diagnostics (append &pin=<ADMIN PIN — ask the owner, never commit it>)
`version` · `getPendingRefunds` · `listRecentRefunds&n=20` · `hdfcRefundTransportTest` · `auditOnAccountDrift` · `listSocieties` · `auditAmanoraTowers` · `backfillBulkPlan` · `seedAmanoraTowerAliases` · `compactWalletLedger` · `getForecastedMonthlySales` · `getDefaultCutoffs` · `getDefaultOrderCaps`
Base: `https://script.google.com/macros/s/AKfycbz-wwECc_mSh949babtRt8OAvFbnJJzH5X9JS_PsN-f-IMHeYkQMj54fwXRs6PevK0W/exec`

## Facts that get answered wrong from stale data
- PRICING_V2 is LIVE: Chapati 10, WO-Chapati 9, Phulka 8, Ghee Phulka 11, Bhakri 22, Sabji Mini 24/Full 48, Dal 24, Rice 13, Salad 8, Curd 13. No market surcharge (Inflation_Surcharge column = loyalty accrual only).
- Cutoffs (admin-editable defaults, verify live): B 7:00 / L 9:00 / D 16:30. Sundays closed. Delivery Caps (admin-editable defaults via SK_Default_Caps): B 11 / L 24 / D 23.
- Bulk plans PUBLIC: Week 6d 5% / 15-Day 13d 7.5% / Month 26d 10%; postpone 2+2 / 4+4 within 30 days; cancel forfeits that meal's bulk discount.
- Contact: WhatsApp +91 93222 46765; calls 9930748908 / 9819969682. Keep BUSINESS_CONTEXT, Backend/business.json, index.html FAQ/JSON-LD, order.html FAQ/GUIDES in sync when facts change.

## Where the deep documentation lives
- `git log` — every commit message is a full incident/design writeup. Start any investigation with `git log --oneline -15`.
- CODE_VERSION comment in 00_Config.gs — reverse-chronological changelog of every backend release.
- Claude Code auto-memory (if available) has per-feature deep dives; this file is the distilled core.
