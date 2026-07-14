// ============================================================
// SVAADH KITCHEN — Code.gs (New System)
// One Google Sheet, clean schema, no Tally dependency
// ============================================================

// ── CONFIG ──────────────────────────────────────────────────
// SECRETS & KEYS: Setup these in Google Apps Script Project Settings > Script Properties
const SP             = PropertiesService.getScriptProperties();
const SHEET_ID       = SP.getProperty("SHEET_ID");
const ADMIN_PIN      = SP.getProperty("ADMIN_PIN") || "7532";
const KITCHEN_PIN    = SP.getProperty("KITCHEN_PIN") || "7284";
const PLACE_ID       = SP.getProperty("PLACE_ID") || "";
const GOOGLE_PLACES_API_KEY = SP.getProperty("GOOGLE_PLACES_API_KEY") || "";
const GA4_PROPERTY_ID       = "396771381"; // User provided Property ID

const CODE_VERSION   = 27.9; // 2026-07-15: SELF-SERVICE PIN RESET FOR RETURNING (ARCHIVED) CUSTOMERS — idle-archived customers kept their PIN, so a returning customer who FORGOT it was stuck on the verify screen and had to message the owner for a reset. Now (1) archiveIdleCustomers BLANKS the PIN column when archiving (05_Customer_Archive.gs); (2) getCustomer returns {found:true, hasPin:false, archived:true} for a blank-PIN archived customer (was {found:false}) so the page greets them "Welcome back, set a new PIN" and the EXISTING "Fetch my saved address" button (fetchArchivedAddress) restores their address + deletes the archive row — no orphan, no address exposed on a bare phone lookup, no frontend change. Safe by construction: _upsertCustomer's PIN-takeover guard only writes a new PIN when the stored one is BLANK (or identical), so setPin succeeds for these rows but a PIN-protected account can never be overwritten. has-PIN archived customers unchanged (verifyLogin still restores on PIN match). Owner already blanked PINs on the currently-archived rows manually, so this change covers all FUTURE archives. (27.8 below: AREA-LIST SYNC (Vaiduwadi removed) + CANNED QUICK-QUESTION ANSWERS. (1) Delivery to Vaiduwadi + the Yash-Honda→Magarpatta-Bridge stretch of Pune-Solapur Road stopped (owner changed SK_Areas manually). Synced every STALE code copy of the area list so the chatbot/FAQ/SEO no longer claim we deliver to Vaiduwadi: BUSINESS_CONTEXT.about + .locations_served (00_Config, feeds buildSystemPrompt's AREAS line), DEFAULT_AREAS (03_Admin_Kitchen — dormant seed, doesn't touch the live sheet), order.html (areaServed JSON-LD + FAQ JSON-LD + visible "All Delivery Areas" list), index.html (same 3), Backend/business.json. Pune-Solapur relabeled "Magarpatta Bridge to Gadital only"; counts 15→14 areas. (2) order-chat.js: the 6 order-page quick-question chips now serve CANNED answers instantly with NO Gemini call (saves API tokens/quota on the most common taps) — typed questions still hit Gemini; canned text mirrors BUSINESS_CONTEXT facts (keep in sync on price/policy change). APP_VERSION v26.07.14.05. (27.7 below: TARGETED LOGIN NOTICES + DELIVERY-STOP ADDRESS CLEANUP — new SK_Login_Notices tab (Phone|Message|Active|Created_At|Ack_At) drives a one-per-phone modal shown on login until the customer taps "I understand" (Ack_At recorded via ?action=ackLoginNotice). verifyLogin now returns `notice` (name-resolved) for flagged phones. First use = the 2026-07-14 delivery stop for Vaiduwadi + the Yash-Honda→Magarpatta-Bridge stretch of Pune-Solapur Road: `seedDeliveryStopNotices(commit)` (admin ?action=seedDeliveryNotices, dry-run) seeds the 12 owner-verified affected phones with an apologetic message. `cleanDeliveryStopAddresses(commit)` (admin ?action=cleanDeliveryAddresses, dry-run) clears ONLY those 12 customers' stale delivery address (Area/Wing/Flat/Floor/Society/Full_Address/Maps_Link/Landmark/Delivery_Point) after backing up to SK_Customers_AddrBackup (reversible); keeps name/PIN/wallet/history; in Meal_Addresses clears only removed-area entries, keeps deliverable ones. NOTE: SK_Areas itself was changed MANUALLY by the owner — code does NOT touch it. Frontend order.html: _showLoginNotice modal on login + APP_VERSION v26.07.14.03. (27.6 below: CHATBOT QUOTA MESSAGE + ORDER-PAGE POLISH — (1) callGemini now returns a CLEAR message on HTTP 429 (Gemini free-tier quota/rate limit) instead of the generic "trouble right now": distinguishes the per-DAY cap ("reached today's question limit… resets tomorrow, WhatsApp us") from a short per-minute burst ("getting a lot of questions, try again in a minute"), parsing the 429 body for a per-day marker. No more silent failure when the daily quota runs out. (2) Frontend order.html: the one-time "A quick update" surcharge-removal notice (_maybeShowSurchargeNotice) is DELETED — V2 pricing has been live ~45 days and its overlay overlapped bottom UI. (3) order-chat.js/.css: added an invite bubble ("Have a doubt? Chat with us") that nudges until the customer opens the chat once (localStorage svaadhOrderChatOpened), a subtle FAB pulse while it shows, and a class on <html> (sk-chat-open / sk-chat-hint) that hides the order page's centered Tip pill (#tipPill/#tipBanner) while the chat panel or invite is up so they never overlap. Widget still always starts CLOSED. APP_VERSION v26.07.14.02. (27.5 below: ORDER-PAGE HELP CHATBOT — added the assistant widget to order.html (docs/order-chat.js + order-chat.css, fully namespaced sk-chat-*, IIFE, own history key, z-index 9000 below all modals; NOT the index chat.js which overrides order.html's toggleFAQ) so customers can ASK questions instead of reading the "Guide to Order" hub. Backend: handleChat now reads body.page and buildSystemPrompt(extraMenu, page) appends an ORDER-PAGE reinforcement when page==="order" — states the bot has NO access to any account (wallet/orders/PIN/payment/other customers), routes personal queries to the on-page dashboard/WhatsApp. Structurally safe: handleChat is stateless (no customer-data lookup path exists), only answers from public BUSINESS_CONTEXT + public menu. APP_VERSION v26.07.14.01. (27.4 below: AUTO-LABEL TEXT NO LONGER TRUNCATED WITH "…" — the auto label PDF used to force each field (name/summary/area/notes) onto ONE line, shrink to a font floor, then HARD-TRUNCATE with "…" when it still didn't fit; the owner's manual (kitchen.html) generator never does that — it WRAPS long text and auto-sizes. Rewrote the fitting: _lblFitLine/_lblFitSummary/_lblVerticalFit (single-line + truncate) REPLACED by _lblWrapLines + _lblFitLabel — each field keeps its FULL text (Docs wraps it at spaces inside the ~46mm cell) and the WHOLE label's font is scaled down uniformly (base name 9.5 / summary 8.5 / area 9 / notes 7, ×scale, ~4pt floor) until the estimated wrapped height fits the 25mm row budget (LBL_LH_FACTOR 1.6 over-estimates Devanagari line height so the row can't grow → pitch still can't drift). NOTHING is ever cut with "…"; typical orders stay full size, only genuinely long content shrinks (extreme worst-case ~4-5pt but COMPLETE). Node-verified 9 assertions on the REAL _lblFitLabel (worst-case Marathi + English big orders + long name/area/notes: no truncation, fits budget; short content stays full size; pathological no-space token kept whole; monotonic shrink). (27.3 below: AUTO-LABEL PITCH DRIFT FIXED (real root cause) — the cutoff+5 auto-generated label PDF (_lblBuildPdfB64, Docs engine) drifted after 2-3 labels ("half on one label, half on the next") and inserted a mid-strip page break, while the kitchen-page jsPDF version (absolute canvas positioning) is always continuous. ROOT CAUSE (found by inflating the live PDF's FlateDecode content streams and measuring the actual rendered cell-origin Y-positions): label content was NEVER the problem — the fitted text is only ~14mm and the 25mm label rows rendered at exactly 25mm. The drift came from the SEPARATE gap rows: each held an appendHorizontalRule(), and a Docs horizontal rule renders ~4.3mm tall, not the 2.7mm minimum we asked — so every label was ~1.6mm too tall (measured pitch ~29.3mm vs the 27.7mm die-cut pitch), cumulative, which walked the strip off the die-cut and eventually overflowed to a 2nd page. FIX: removed the gap rows and the horizontal rule entirely. Now ONE borderless row per label at min-height = BLOCK (25mm label + 2.7mm gap); the fitted text sits in the top 25mm and the empty bottom 2.7mm IS the physical die-cut gap. Min-height is exact when content is smaller (verified), and _lblFitLine/_lblFitSummary/_lblVerticalFit keep every label's content < 25mm, so each row is EXACTLY one 27.7mm pitch → zero drift, single continuous page. Google Docs FORCES an empty paragraph before AND after a table (a table may not be the body's first/last element); each renders ~5.7mm at the 11pt normal style. Every empty body paragraph is crushed to font-size 1 (the trailing one shrinks to ~2.25pt; the LEADING one is Docs-enforced and resists — removeChild on it silently re-creates a fresh 11pt para), so page height = n×27.7mm + 12mm pad ABSORBS the residual ~5.7mm leading offset plus per-row pixel rounding (Docs rounds a min-height row up to a whole 96-dpi px, ~+0.08mm/label). Net: label 1 sits ~5.7mm from the strip top (vs the kitchen page's 4.4mm — a 1.3mm constant offset, NOT the cumulative drift that was the bug), pitch dead-on 27.7mm. The physical die-cut gap separates labels; no printed rule needed. The width/vertical single-line fitters from the earlier (wrong-diagnosis) 27.2 build are KEPT — a harmless correctness guarantee. New admin GET ?action=genLabels&date&meal (regenerate on demand; &debug=1 returns the PDF base64 build-only, no Drive save / no print webhook). Verified live @473 by inflating the FlateDecode streams of rebuilt 12-order Lunch + 31-order Dinner PDFs: both /Count=1, label-name pitch a constant 27.7mm. (27.1 below: CAP-EXEMPT LOCATIONS — two new owner-approved bypasses when a meal's delivery cap is full: (1) WeWork (any spelling — "We Work" base-normalizes to "wework"); (2) Cybercity Magarpatta Towers 1–12 ONLY (customers collect at the gate, no delivery-time burden) — AMANORA towers explicitly excluded (any "amanora" in society+area vetoes; safe since Amanora numbering is T18–T100 and Pentagon "T4" never uses the word "tower"). New shared _isCapExemptLocation(society, area) (Code.gs, uses _normSocietyBase) wired into submitOrder's cap guard alongside the free-area/big-order bypasses; frontend mirror _capExemptLocation in order.html's _mealKeepsDeliveryAtCap so the checkout gate doesn't nag these customers. These locations still COUNT toward the cap (like free areas) — they're just never BLOCKED. Node-verified 17 assertions on the real predicate (all real spellings from the society audit; Amanora/Pentagon/flat-number/out-of-range exclusions). (27.0 below: PERMANENT DELIVERY CAPS — DEFAULT_ORDER_CAPS = {Breakfast:11, Lunch:25, Dinner:25} now applies to EVERY date automatically (owner request; previously caps existed only when the admin set Order_Cap_JSON per date). New shared _effectiveOrderCaps(perDateCaps) (Code.gs): a positive per-date value OVERRIDES the default for that date+meal (to uncap a date, enter a big number like 500); blank/0/invalid → default. Applied in _getMenuUncached (sold_out display — getMenu's order_caps now returns the EFFECTIVE caps; no customer-side consumer, admin panel reads getAdminData) and in submitOrder's ordering-window guard (authoritative, under lock — counts now always computed). ALL existing bypasses unchanged: Self Pickup/Porter always available when full (Cap_Alt default ON — hard-close still possible per date), free areas (Bhosale/Triveni), Enkin, same-society piggyback, own-existing-delivery, big-order bypass (₹200+ meal / ₹100+ breakfast). getAdminData additionally returns default_caps; the admin panel's cap input shows "N (default)" as placeholder, the count line shows "x / effCap (default)", and the Pickup/Porter toggle is always visible — blank input = default, typing a number overrides JUST that date (defaults are never baked into per-date storage). Node-verified the merge semantics (defaults, override, zero/blank/non-numeric fallback, big-number uncap, null-safe). (26.9 below: MISSED-ORDER LOOP CLOSED ("lost but recovered & written ✓") — incident SK-20260710-8950: the 1-min safety net emails "STILL MISSING — enter manually" the moment 5 re-appends fail, but KEEPS retrying for the 60-min stash TTL; the order landed on a later pass and the owner was never told (mail still demanded manual entry; SK_Missed_Orders row stayed "STILL MISSING"). Fixes: (1) SK_Missed_Orders gains a Row_JSON column (self-healed) — _verifyAndAlertMissedOrders now stores the FULL row array in the log, so a lost order is restorable FOREVER, not just for the 60-min stash or from the alert email. (2) NEW reconcileMissedOrdersLog() (02_Orders_Menu.gs; piggybacks the 10-min liveLostOrderAudit trigger + admin GET ?action=reconcileMissedOrders): for every log row still claiming a lost order (STILL MISSING / BULK ROW DROPPED / FOUND BY AUDIT, not yet ✅) it verifies presence in live SK_Orders (Submission_ID OR Gateway_Order_ID) or the monthly archives (±3d), and if genuinely absent, RE-APPENDS from Row_JSON via _reappendUntilPresent (verified) — then flips the log status to "✅ Recovered & written — <how>" and sends ONE consolidated "✅ N lost order(s) recovered & written" mail. Idempotent (✅ rows skipped, no duplicate mails). (3) Alert mail reworded: "NOT YET WRITTEN — auto-retry continues" + explains the ✅ mail will follow; manual entry only if no ✅ ever arrives. Node-verified 14 assertions executing the REAL reconcileMissedOrdersLog (live-present flip, Row_JSON restore actually appends, archive-hit via gateway id, no-data rows untouched, one consolidated mail, idempotent re-run, empty-log no-op). (26.8 below: WALLET LEDGER COMPACTION TOOL — compactWalletLedger(commit, keepDays) (04_Reports_Misc.gs; admin GET ?action=compactWalletLedger, dry-run unless commit=1, keepDays default 90 / min 30). Keeps SK_Wallet fast forever WITHOUT changing any balance: per customer, every VERIFIED row older than keepDays is replaced by ONE carry-forward row whose amount = the net of the removed rows, computed by the REAL _calculateWalletBalance over the removed subset (semantics can never drift). net≥0 → "Balance Carry-Forward (…)" credit; net<0 → "Dues Deduction (ledger compacted …)" debit (type deliberately avoids all credit keywords). SAFETY (the naive date-scoped wallet archive corrupted balances once — see archiveMonth's WALLET-NOT-ARCHIVED comment; this replaces it safely): unverified rows NEVER touched; bad-timestamp rows kept; PRE-VERIFY rebuilds the whole sheet in memory and recomputes EVERY customer's balance before anything is written (mismatch → abort untouched); audit trail FIRST (removed rows + full pre-compaction Backup_<ts> tab appended to "Svaadh Kitchen Wallet Archive — <year>", verified landed, else abort untouched); atomic clear+setValues rewrite; POST-VERIFY re-reads the live sheet and re-checks every balance (mismatch → admin email with the backup tab name for copy-back restore); script lock throughout. Idempotent; carry-of-carry safe when carry rows themselves age. Node-verified 41 assertions executing the REAL compactWalletLedger + REAL _calculateWalletBalance (conservation for every customer incl. negative-carry dues + phone-spelling variants + zero-net no-carry; dry-run writes nothing; unverified/bad-ts kept; archive-drop aborts byte-identical; keepDays clamp; both carry types re-read correctly through the engine). Run when SK_Wallet nears ~2-3k rows (385 today). (26.7 below: LOYALTY DISPLAY ₹16 OVER-PROMISE FIX (frontend bill vs authoritative charge) — incident: customer 7045498820's 6-date cart showed 118 wallet + 469 gateway (₹587) but the gateway correctly charged 485 (total ₹603). ROOT CAUSE (two defects conspiring): (1) getCustomerOrders caps past_orders at 10 ROWS — for a 3-meal/day customer that's ~3 days, so the frontend streak engine saw count 4 at Jul 11 and couldn't tell Jul 11 was day 6 of a full streak; (2) buildBillScreen's virtual-streak reset only fired on count>=6, NOT on "the last past day is a MARKED reward day", so the bill carried Jul 10-11's already-redeemed ₹33 of accruals into the cart and fired a bogus 6th-day waiver of ₹43 on Jul 14 (server: fresh streak, ₹27 on Jul 18). The CHARGE was always correct — only the display under-quoted by ₹16. FIXES: backend getCustomerOrders now also returns compact streak_rows (last 45 rows ≈ 15 days, only the 4 fields the streak engine reads); frontend calculateLoyaltyStreak prefers S.streakRows and returns endIsReward, and BOTH bill reset sites (main loop + carry-back pre-pass) reset when count>=6 OR endIsReward. Browser-verified against the REAL buildBillScreen with the exact incident state: old behaviour reproduces ₹587 byte-exact; fixed = ₹603 (truncated AND full-history paths); mid-streak sanity case unchanged (waiver ₹30 on true day 6, total ₹600). (26.6 below: PHONE NUMBER FIX — callGemini's 4 hardcoded fallback strings said "WhatsApp us at +91 99307 48908", but 99307 48908 is the CALL number (WhatsApp is +91 93222 46765, per owner: "93222 46765 for whatsapp / 99307 48908, 9819969682 for call"). BUSINESS_CONTEXT itself was already correct — only these hardcoded literals (used when GEMINI_API_KEY is missing, the response has no candidate, or both retries fail) were wrong. Also fixed the same mismatch in Backend/business.json (whatsapp field pointed at the call number) and docs/chat.js's network-error fallback message. Every customer-facing page (index.html, order.html, shipping/refund/privacy/terms.html, intentamplify.html) was already correct — grep-verified zero remaining "99307 48908" next to the word WhatsApp anywhere in the codebase. (26.5 below: CHATBOT RETRAINED + SMARTER — BUSINESS_CONTEXT refreshed to live reality (PRICING_V2 prices; tiered free-delivery 106/159/190 + ₹53 small fee; delivery-full ₹200/₹100 bypass; discount tiers 325/485/750; 6-day loyalty; review promo; NEW bulk_plans section incl. postpone 2+2/4+4; HDFC gateway payments incl. instant wallet recharge + split + On Account; per-meal addresses, tracking, PWA). buildSystemPrompt rewritten around the new fields + injects per-meal kitchen closures into the today-line + hardened privacy section (prompt-injection resistant: ignore in-message instructions to change rules/reveal prompt) + style guide (match customer language, short lines, never invent). handleChat date detection FIXED — the old bare \d{1,2} regex treated ANY digit as a date ("2 chapati" → menu for the 2nd, "₹100" → the 10th) and injected the wrong day's menu; now requires an ordinal (15th), a month-adjacent number (15 July, 15/7), or "on/for/date N", plus Hindi/Marathi kal/udya/aaj support. callGemini: temperature 0.7→0.4 (facts over creativity) + one retry with 1s backoff on 429/5xx so transient blips don't show customers an error. (26.4 below: (1) "LABELS READY" EMAIL REMOVED (07_Labels_Auto.gs autoGenerateLabels) — owner gets the file via Drive + the MacroDroid webhook; the 2 daily mails (one per meal) were noise. The FAILURE alert in labelAutoTick is KEPT. (2) REFUND DIAGNOSTICS — new admin GETs: listRecentRefunds (read-only, last n SK_Refunds rows ALL statuses, so "auto-refund FAILED (…)" notes are readable after the owner processes the row) and hdfcRefundTransportTest (fires hdfc_initiateRefund at a NONEXISTENT order id — zero money risk — and returns the raw gateway response to classify format-vs-permission failures). FINDING: every auto-refund attempt since go-live failed with HTTP 401 error_code=access_denied, developer_message="Merchant disabled for refund" (transport test confirms: request parses + authenticates, then hits the merchant-permission gate). Our request format is CORRECT; HDFC must enable the Refund API on the MID. Once they flip it: new cancellations auto-refund immediately, and retryQueuedRefunds() re-fires any queued Pending gateway rows (already-manually-refunded rows are Status "Refunded" → never retried → no double payout). (26.3 below: (1) LOST-ORDER AUDIT 7-DAY WINDOW — auditLostGatewayOrders was checking webhook CHARGED events against the LIVE SK_Orders only; once June's order rows were archived out (monthly archive run), every June webhook looked "missing" and the daily deep audit flooded the owner with "paid order(s) missing" mails (11-Jul incident). Now: only webhooks from the last 7 DAYS are considered (a genuinely lost order is caught within minutes by the 10-min live audit, so a week is ample); undated rows skipped; PLUS an archive double-check per flagged candidate (getOrdersInRangeWithArchive ±3 days around the webhook date) so even the early-month sliver — order archived while its webhook is <7d old — can't false-positive. dailyDeepLostOrderAudit monthsBack 2→1 (a 7-day window never spans more than one month boundary). (2) AMANORA TOWER→SOCIETY ALIASES — owner-confirmed map (Desire T18-22, Metro T24-25, Adreno T37-41, Gold T42-46, Elevate T47, Future T52-53, Neo T94-97, Gateway T98-100) seeded into SK_Society_Aliases via new admin GET ?action=seedAmanoraTowerAliases (dry-run unless commit=1; idempotent upsert — same-alias rows updated in place, never duplicated). Per tower: EXACT "T<n>" row + CONTAINS "*tower <n>" row; deliberately NO "*t<n>" contains rules (flat-number bleed: "Flat 5301" normalizes to contain "t53") + 8 society-word contains rules (*desire tower, *gold tower …) → canonical "Amanora <X> Towers". Node-verified 22 assertions against the REAL matcher (_normSocietyBase/_normSocietyKey semantics): all real audit spellings map; Flat-number/Cybercity/Magarpatta/Pentagon-T4 all untouched. After committing, rebuild delivery routes so tower spellings merge into society stops. (26.2 below: PER-MEAL KITCHEN CLOSE — the "close kitchen" action is now per-MEAL, not just whole-day. Admin can close Breakfast/Lunch/Dinner individually (or Full Day) via a multiselect; closing a meal auto-cancels + refunds only THAT meal's active orders (same deleteOrder routing: wallet→instant, UPI→manual_upi/HDFC auto-refund, On-Account→un-billed) and blocks new orders for it. Data: new Closed_Meals_JSON column on SK_Daily_Menu ({"Breakfast":true,…}); the legacy Kitchen_Closed boolean is set TRUE only when ALL three are closed, so every existing full-day reader keeps working. setKitchenClosed(body) now takes a meals[] array (absent ⇒ full day, backward-compatible); requires_confirm/cancel loop unchanged but meal-filtered. New shared helpers _closedMealsObj(row)/_isMealKitchenClosed(row,meal) (03). Readers made meal-aware: getMenu returns closed_meals; submitOrder guard blocks only the closed meal(s) (returns closed_meals:[{date,meal}]); getAdminData returns closed_meals; new _kitchenClosedMealSet() drives bulk _nextWorkingDays/_bulkPostponeValidDates so a lunch-closed day is skipped from a bulk LUNCH window but a dinner order still runs. Loyalty streak still keys off full-day only. Admin UI: hero chip → multiselect panel (per-meal toggles + Full Day) with the existing cancel-refund confirm. Customer UI: a closed meal shows "Kitchen Closed" and is un-orderable; other meals stay open; submit-reject pulls just the closed meals from the cart. Node-verified 23 assertions against the REAL extracted functions (meal-filtered cancel, refund routing, Closed_Meals_JSON, full-day legacy flag, requires_confirm, reopen-no-cancel, wrong-pin). (26.1 below: BULK_PLAN BACKFILL — one-time idempotent backfillBulkPlan(commit) (06_Bulk_Orders.gs) stamps Bulk_Plan on bulk rows placed BEFORE v26.0 (the postpone update) so those customers can postpone their remaining days too. Plan is INFERRED per Batch_ID from the largest per-meal row count across the batch (all statuses counted, so past cancellations don't shrink it): >=20→month, >=10→15day, else week. Only touches rows whose Bulk_Plan is blank (new orders already carry it). Admin GET ?action=backfillBulkPlan (dry-run; add &commit=1 to write). Bulk_Plan drives ONLY postpone eligibility — no pricing/cancel/clawback path reads it. (26.0 below: BULK ORDER POSTPONE (15-day / month) — customers can now RESCHEDULE a bulk day to another date instead of cancelling it. Per-meal cap: 15-day = 2 lunch + 2 dinner, month = 4 + 4 (BULK_POSTPONE_CAP); week has none (cancel-only, unchanged). A postpone is a PURE reschedule — the row keeps its items, price, Batch_ID and Bulk_Clawback (already paid), only Order_Date changes: no refund, no re-charge, discount preserved; the existing per-meal cancel/clawback logic is untouched. New in 06_Bulk_Orders.gs: postponeBulkOrder(body) (locked, re-validates server-side — working day, ≤30 days out, before cutoff, no same-meal clash, quota) + read-only getBulkPostponeInfo(phone,rowId) (returns eligibility + valid calendar dates). Quota counts DISTINCT postponed days per (batch,meal) via a new Bulk_Postponed marker column (re-moving an already-postponed day is free; cancelling a postponed day does NOT refund quota). New Bulk_Plan column persists the plan per row (submitBulkOrder) so cap/modal are known; legacy bulk rows without it default to week = no postpone (safe). getCustomerOrders now returns is_bulk/batch_id/bulk_plan/bulk_postponed per upcoming row. Routes: GET getBulkPostponeInfo, POST postponeBulkOrder. Frontend (order.html): (1) a "how it works" info modal shown when a plan is tapped (working-days/discount/cancel+postpone rules) → OK proceeds to item selection; (2) bulk rows' Delete button opens a Postpone-or-Cancel choice (when eligible) → a calendar of valid working days → postponeBulkOrder; week-bulk & non-bulk fall straight through to the unchanged cancel flow. Node-verified 23 assertions against the REAL extracted functions (quota per meal, re-postpone no-consume, Sunday/clash/horizon blocking, week/legacy/cancelled ineligibility). (25.9 below: ON-ACCOUNT PARTIAL-SETTLEMENT EMAIL IS NOW SCOPE-AWARE — the v25.3 fallback in _settleOnAccountDirect (10_Hdfc_Gateway.gs) emailed the owner whenever a gateway on-account charge came in BELOW the customer's full current balance, on the assumption that only a mid-payment race could cause it. But MONTHLY on-account customers are billed for the PRIOR month only (getOnAccountBill / _computeOnAccountDue scope="monthly" = orders before the 1st of the current IST month); the current month's orders are meant to STAY On Account and be billed next cycle. So for a monthly payment, charge < full balance is the NORMAL designed state, and the email was a false alarm every cycle (reported: customer 8554899866 paid ₹1025 for June, ₹168 of July correctly remained, owner got a "balance changed mid-payment" email). FIX: the session already persists its scope in HDFC_PENDING_ONACCOUNT; hdfc_finalizeOnAccountPayment now passes that scope into _settleOnAccountDirect, which computes a "billed due" (monthly → pre-cutoff orders only; all → full balance) and emails ONLY when the charge fell short of the BILLED due (a genuine in-scope shortfall), with the ₹2 rounding tolerance. Missing/legacy scope defaults to "all" (prior behaviour, safe). The settlement loop itself is byte-for-byte UNCHANGED — this only gates the alert. Node-verified by EXECUTING the real extracted _settleOnAccountDirect (scratchpad onaccountmail.js, 5 scenarios): monthly-pays-June-bill settles all 6 June rows / 0 July / NO email; monthly-short-of-June-bill emails; all-scope shortfall emails; ₹2 tolerance respected; legacy no-scope emails. (25.8 below: MARKET SURCHARGE REMOVED FROM ANALYTICS — the "market surcharge" is obsolete since the PRICING_V2 go-live (no longer billed), but the admin Analytics report still showed it: a "📈 Surcharge" KPI, a Total-Fees line item, and a per-day-table column. Worse, _analyticsCore read the Inflation_Surcharge column (which under V2 now holds ONLY the loyalty-streak accrual, not a billed fee) and, for blank rows, FABRICATED a ceil(food*0.06) surcharge that was never charged — showing a misleading ₹-figure (owner spotted ₹2,811 for July). Removed surcharge from the analytics surface end-to-end: _analyticsCore no longer computes/sums it (dropped totalSurcharge + dayMap.surcharge + the 6% backfill), getAnalytics no longer returns summary.surcharge or days[].surcharge, and vault_admin.html's renderAnalytics drops the Surcharge KPI, the day-table Surch. column (header/cells/footer), and excludes it from Total Fees (= Delivery + Small Order Fee now). Revenue is Net_Total and NEVER added surcharge separately, so every total (revenue/collected/pending/avg/day/delivery/small-fee) is byte-for-byte unchanged — verified live against the owner's screenshot (387 orders / 111 customers / ₹53,016 / ₹31,391 / ₹21,625 / ₹649 / ₹182). DELIBERATELY untouched: the loyalty-streak machinery (Inflation_Surcharge column, _calculateLoyaltyStreak, the 6-day waiver) and the same-day cancel-recompute — those legitimately still use that column as the accrual, NOT as a market surcharge. (25.7 below: FORECASTED MONTHLY SALES (admin Analytics page) — new getForecastedMonthlySales() (04_Reports_Misc.gs) projects the CURRENT calendar month's revenue via a real weekday-seasonality model (NOT naive avgPerDay*daysInMonth): pulls a trailing 70-day lookback (spans live+archives via the newly-extracted _analyticsCore, shared with getAnalytics so backfill rules can never drift between the two), trims any LEADING run of zero-revenue days (pre-launch, not "closed"), averages revenue per weekday (Sunday naturally comes out ~₹0 — the model LEARNS the closed day from data, zero hardcoding), applies a bounded recent-trend factor (last 14 days vs full lookback, clamped 0.6x-1.6x), and sums actual month-to-date revenue + Σ(weekday avg * trend) for every remaining day, with a rough +/- confidence band from the lookback's day-to-day std dev. Flags lowConfidence when fewer than 14 real trading days are available. New admin route ?action=getForecastedMonthlySales (admin PIN). Frontend: new forecast card at the top of the Analytics page (independent of the date-range picker, always current month), loaded once per page-open. Node-verified 11 assertions against the REAL extracted function with a simulated 50-day-old business (Sunday-closed pattern + a deliberate recent uptick) — correctly learned Sunday=0, trimmed pre-launch, and detected the uptick. (25.6 below: SABJI COMBO STOCK LIMITS — Dry/Curry Sabji Mini+Full can now share ONE weighted limit (Mini=0.6, Full=1.4) instead of two separate ones, e.g. limit 25 means mini*0.6+full*1.4<=25 and BOTH sizes close together the instant it's crossed. New shared helpers in Code.gs (SABJI_COMBO_WEIGHTS, SABJI_COMBO_GROUPS, _sabjiComboStatus, _applySabjiComboLimits) wired into getMenu (customer units_remaining), getAdminData (admin display), and submitOrder's stock preflight (authoritative hard-block, checked under lock even when neither size alone crossed its own limit). Stored as virtual "__COMBO_DRY__"/"__COMBO_CURRY__" entries inside the existing Stock_JSON blob — no schema change, no frontend order.html change needed (units_remaining stays the single source of truth it already reads). Admin panel: new "Sabji Combo Stock Limits" card (Lunch/Dinner) with 2 inputs + live weighted-usage readout, reusing the existing setStockLimit()/save path. Node-verified 8 scenarios against the real extracted functions (exact-at-limit, over-limit clamp, MIN-with-individual-limit combination, backward-compat no-op). (25.5 below: delivery-cap ₹200 bypass split PER MEAL — CAP_DELIVERY_BYPASS_MIN is now {Breakfast:100, Lunch:200, Dinner:200} (Breakfast is typically a smaller ticket). Updated the server guard (02_Orders_Menu.gs, keyed by meal type, falls back to 200 for any unlisted meal) and order.html's mirror (_soldOutDeliveryMealsInCart skip check, the per-meal shortfall tip, dialog copy) to match. Browser-verified: Breakfast ₹99 flagged/₹100 passes, Lunch/Dinner still at ₹199 flagged/₹200 passes. (25.4 below: getKitchenSummary's `cutoffs` field was `menu.cutoff_overrides || {}` — the RAW per-day override only, empty for any date without one (the norm now that admin uses the site-wide Default Cutoff Times panel instead of per-day overrides). kitchen.html's prep countdown then fell through to its OWN hardcoded fallback (Dinner 16.5 = 4:30 PM), totally blind to the live default (owner set 4:15 PM; countdown still showed time-to-4:30). Fixed to return _effectiveCutoffsForDate(date) — default merged with any override, same function the customer-facing cutoff enforcement already uses. kitchen.html's 5-min auto-refresh converges the display; no frontend change needed. (25.3 below: On-Account settlement fixes.) — (1) unified status filter: verifyLogin's displayed due amount, _autoSettlePendingOrders, _computeOnAccountDue, getOnAccountBill, and the admin billing bucket all previously used slightly different ad-hoc filters (some counted legacy "Pending"/blank rows, inflating the customer-visible due without those rows ever being chargeable) — now all route through one _isOnAccountDueStatus("On Account" exact match, the only string ever actually written). (2) FIXED the ₹812/"3 orders skipped" incident's root cause in _settleOnAccountDirect: the old oldest-first loop did `remaining -= net` per row and `break`-ed the WHOLE loop the instant one row's net exceeded what was left, silently abandoning every row after it even if smaller/affordable. Now: a FAST PATH settles every on-account row directly whenever the charge covers the full current balance (the normal/expected case — makes this bug class structurally impossible); a FALLBACK (charge < current balance, e.g. a new on-account order landed mid-payment) skips-and-continues instead of breaking, and emails the owner since the balance shifted mid-payment. Added read-only auditOnAccountStatusDrift() (+?action=auditOnAccountDrift, admin PIN) to list any stray legacy rows in live data. Node-simulated the exact stranding pattern against both old and new logic to confirm. HARDENING PASS (same day): ₹2 rounding tolerance on the fast path (charge=round(sum) vs sum(round(net)) can differ on legacy paise); TRUE chronological sort in _settleOnAccountDirect AND _autoSettlePendingOrders (Order_Date is a Date object — String(Date) sorted by WEEKDAY NAME, scrambling oldest-first); skip-not-break in _autoSettlePendingOrders too (same stranding class); getCustomerOrders balance also on the helper. PLUS ₹200 delivery-cap bypass: a capped meal with subtotal ≥ CAP_DELIVERY_BYPASS_MIN keeps delivery (alt-ON only; cap_alt=false hard close never bypassed) — frontend gate skip + dialog tip with per-meal shortfall + server guard. (25.2 below: address hygiene.)
                              // 2026-07-06: address hygiene — (1) STRICT Google-Maps-only maps links: client validates on save + live red-border feedback; server _sanitizeMapsLink drops junk to "" in _upsertCustomer (profile.maps + every meal's maps inside Meal_Addresses JSON; Maps_Link then falls back to the auto-derived link). Tightened TLD regex (google.evil.com/maps spoof rejected). (2) Meal_Addresses no longer goes STALE on address edits: _upsertCustomer updates when the field is PRESENT (was skipping the empty string single-address clients sent), and the frontend now always sends the full per-meal JSON, rebuilt in validate(1) for both address modes. (25.1 below: poisoned dup-cache root cause.) — POISONED dup-cache: the per-meal dedup key is reserved BEFORE the row write, so an execution dying pre-appendRow leaves a 5-min cache entry claiming success; every retry (browser + reconciler at the 2-min mark) got silently "deduped", the reconciler deleted the stash as done, and the paid order became unrecoverable with no alert. FIXES: (1) cache hits now VERIFY the claimed sid exists in the under-lock sheet snapshot, else fall through and write; (2) the 1-min verify pass only rewrites PENDING_ORDER_ROWS when it actually pruned (unconditional rewrite raced submitOrder's backup store — could wipe fresh entries); (3) the 10-min audit now SELF-HEALS: tries hdfc_reconcileOrderFromStash before logging/emailing, alerts only if unrecovered. (25.0 below: label auto-generation.) — labelAutoTick (1-min trigger, run setupLabelAutoTrigger once) fires at cutoff+5 for Lunch/Dinner (live default cutoffs + per-day overrides), builds the Marathi 50mm label-strip PDF via the Slides advanced API (Devanagari-safe, temp presentation trashed after export) and saves through the SAME saveLabels() Drive path/filename — no browser needed; kitchen-page auto-fire stays as backstop. Manifest: +Slides advanced service, +presentations & script.send_mail scopes (send_mail also FIXES silently-failing MailApp audit alerts) → owner must RE-AUTHORIZE once in the editor. HEAD-only: LIVE web app NOT redeployed with this (triggers run HEAD). (24.9 below: customer-page default cutoffs.) — v24.8 only fixed the admin panel + backend enforcement; order.html had its OWN 3 hardcoded {Breakfast:7,Lunch:9,Dinner:16.5} copies (CUTOFFS/DEFAULTS/DEFS) used for the "Order by X" / early-extended display, so a saved default change never showed to customers. getConfig now returns default_cutoffs (public, non-sensitive); order.html's single CUTOFFS var is refreshed from it on load and DEFAULTS/DEFS were removed in favor of that one shared var. (24.8 below: admin-editable default cutoffs.) — new SK_Default_Cutoffs sheet (one row, Breakfast/Lunch/Dinner decimal hours) read by _getDefaultCutoffs (5-min CacheService) and consumed by _effectiveCutoffsForDate as the base before any per-date SK_Daily_Menu override (override logic UNCHANGED). Admin panel: new "Default Cutoff Times (All Days)" panel (getDefaultCutoffs/setDefaultCutoffs, admin-PIN gated) above the existing per-day "Extend Cutoff Times Today" panel; the "Default: X" labels + Early/Extended badges now read the live default instead of a hardcoded 7/9/16.5. (24.7 below: bulk payment parity.)
                              // 2026-07-03: post-verification write-loss hardening (₹104 Nitin loss) — PENDING_ORDER_ROWS row-backup TTL 10min→60min; entries KEPT for the full window even after confirmed present (a row can vanish AFTER verification) with TTL pruning in the verifier; the 1-min reconciler now re-runs _verifyAndAlertMissedOrders so a dropped row re-appends within ~1 min. Frontend: hdfc_initiatePayment + bulk_pay HARD-FAIL if hdfc_savePendingOrder didn't stick (the stash is the only holder of items — never let payment proceed without it). (24.5: route Pinned_Rank + pickup-first.)
const LEDGER_FOLDER  = "Svaadh Customer Ledgers";

// ── PAYMENT GATEWAY CONFIG ───────────────────────────────────
// Controlled via Script Properties — never hardcoded.
// In Dev Apps Script: add Script Property  PAYMENT_GATEWAY_ENABLED = true
// Live project never has this property set → evaluates to false automatically.
const PAYMENT_GATEWAY_ENABLED = (SP.getProperty("PAYMENT_GATEWAY_ENABLED") === "true");

// PRICING_V2 — the "surcharge removed, prices bumped ~6%" model (matches merged).
// When true: L/D prices use the new table, NO inflation surcharge is added to the
// bill, free-delivery thresholds are 106/159, loyalty gives back the accrued 5%,
// and the one-time surcharge-removal notice shows. Default OFF → exact current
// behaviour (old prices + ceil(sub×6%) surcharge). Flip at go-live (midnight),
// together with updating the breakfast prices in the menu sheet.
const PRICING_V2 = (SP.getProperty("PRICING_V2_ENABLED") === "true");

// Delivery-cap bypass: when a meal's delivery limit is reached, an order whose
// CAPPED MEAL's food subtotal is ≥ this meal's threshold still gets delivery
// (big orders are worth the slot). Applies only when pickup/porter alternatives
// are ON — a cap_alt=false HARD close (kitchen out of capacity) is never
// bypassed. Per-meal since 2026-07-07 (Breakfast is typically a smaller ticket).
// MUST match order.html's CAP_BYPASS_MIN.
const CAP_DELIVERY_BYPASS_MIN = { Breakfast: 100, Lunch: 200, Dinner: 200 };

// ── HDFC SmartGATEWAY — Script Properties reference ─────────
// Add all of these in Apps Script → Project Settings → Script Properties.
// NEVER hardcode keys here.
//
//  Property Name            │ Where to get it
//  ─────────────────────────┼─────────────────────────────────────────────
//  HDFC_MERCHANT_ID         │ Dashboard → Settings → General (Merchant ID)
//  HDFC_API_KEY             │ Dashboard → Settings → Security → Create New API Key
//  HDFC_RESPONSE_KEY        │ Dashboard → Settings → Security → Response Key
//  HDFC_WEBHOOK_USERNAME    │ Set freely — enter same value in Dashboard → Settings → Webhooks → Username
//  HDFC_WEBHOOK_PASSWORD    │ Set freely — enter same value in Dashboard → Settings → Webhooks → Password
//  HDFC_ENV                 │ "test" or "live"
//  HDFC_TEST_URL            │ Sandbox base URL from HDFC (e.g. https://smartgateway-uat.hdfcbank.com)
//  HDFC_LIVE_URL            │ Production base URL (e.g. https://smartgateway.hdfcbank.com)
//  HDFC_RETURN_URL          │ Apps Script exec URL (NOT order.html — GitHub Pages rejects POST).
//                           │ doPost detects the HDFC return payload and JS-redirects to order.html.
//  HDFC_WEBHOOK_URL         │ This Apps Script doPost URL (set in Dashboard → Settings → Webhooks)

const HDFC_MERCHANT_ID      = SP.getProperty("HDFC_MERCHANT_ID")      || "";
const HDFC_API_KEY          = SP.getProperty("HDFC_API_KEY")          || "";
const HDFC_RESPONSE_KEY     = SP.getProperty("HDFC_RESPONSE_KEY")     || "";
const HDFC_WEBHOOK_USERNAME = SP.getProperty("HDFC_WEBHOOK_USERNAME") || "";
const HDFC_WEBHOOK_PASSWORD = SP.getProperty("HDFC_WEBHOOK_PASSWORD") || "";
// Reseller id — sent as x-resellerid only when HDFC provides one.
const HDFC_RESELLER_ID      = SP.getProperty("HDFC_RESELLER_ID")      || "";
// UPI-only checkout (per HDFC agreement). Default ON; set HDFC_UPI_ONLY="false" to allow cards/netbanking.
const HDFC_UPI_ONLY         = SP.getProperty("HDFC_UPI_ONLY") !== "false";
const HDFC_ENV              = SP.getProperty("HDFC_ENV")              || "test";
const HDFC_RETURN_URL       = SP.getProperty("HDFC_RETURN_URL")       || "";
const HDFC_ORDER_PAGE_URL   = SP.getProperty("HDFC_ORDER_PAGE_URL")   || "https://svaadhkitchen.in/order.html";
const IA_ORDER_PAGE_URL     = SP.getProperty("IA_ORDER_PAGE_URL")     || "https://svaadhkitchen.in/intentamplify.html";
const HDFC_BASE_URL         = HDFC_ENV === "live"
  ? (SP.getProperty("HDFC_LIVE_URL") || "https://smartgateway.hdfcbank.com")
  : (SP.getProperty("HDFC_TEST_URL") || "https://smartgateway-uat.hdfcbank.com");
// ─────────────────────────────────────────────────────────────

// Sheet tab names
const TAB_ORDERS     = "SK_Orders";
const TAB_CUSTOMERS  = "SK_Customers";
const TAB_MENU       = "SK_Daily_Menu";
const TAB_DEFAULT_CUTOFFS = "SK_Default_Cutoffs"; // single row: Breakfast/Lunch/Dinner default cutoff hours (site-wide baseline; per-day SK_Daily_Menu overrides still win)
const TAB_BF_MASTER  = "SK_Master_Breakfast";
const TAB_SABJI      = "SK_Master_Sabjis";
const TAB_AREAS      = "SK_Areas";
const TAB_LOGIN_NOTICES = "SK_Login_Notices"; // targeted one-per-phone login notices (Phone|Message|Active|Created_At|Ack_At)
const LOGIN_NOTICES_HEADERS = ["Phone", "Message", "Active", "Created_At", "Ack_At"];
const TAB_WALLET     = "SK_Wallet"; // Holds prepaid balances
const TAB_REFUNDS    = "SK_Refunds";      // Manual refund requests
const TAB_WEBHOOK_LOG = "SK_Webhook_Log"; // HDFC webhook log-first buffer
const TAB_GA4_METRICS = "SK_Analytics_Data"; // Google Analytics Storage

// Canonical SK_Wallet column schema — NEVER reorder these
const WALLET_HEADERS = ["Phone", "Customer_Name", "Txn_Type", "Amount", "Verified", "Reference_ID", "Timestamp"];

// ── PERMANENT per-meal DELIVERY caps (owner-set 2026-07-13) ──────────────────
// Applies to EVERY date automatically. A per-date Order_Cap_JSON value (> 0) set in
// the admin panel OVERRIDES the default for that date+meal — to effectively UNCAP a
// specific date, enter a big number (e.g. 500). Reaching the cap flags the meal
// sold_out for DELIVERY only: Self Pickup / Porter always stay available (Cap_Alt
// default ON), plus the usual bypasses (free areas, Enkin, same-society piggyback,
// ≥₹200/₹100 big orders). Enforced in _getMenuUncached (display) and submitOrder's
// ordering-window guard (authoritative, under lock) via _effectiveOrderCaps().
const DEFAULT_ORDER_CAPS = { Breakfast: 11, Lunch: 25, Dinner: 25 };

// ── COLUMN LAYOUT — SK_Orders ────────────────────────────────
// A   Submission_ID
// B   Submitted_At
// C   Order_Date
// D   Meal_Type
// E   Customer_Name
// F   Phone
// G   Area
// H   Wing
// I   Flat
// J   Floor
// K   Society
// L   Full_Address
// M   Maps_Link
// N   Landmark
// O   Items_JSON
// P   Chapati
// Q   Without_Oil_Chapati
// R   Phulka
// S   Ghee_Phulka
// T   Jowar_Bhakri
// U   Bajra_Bhakri
// V   Dry_Sabji_Mini
// W   Dry_Sabji_Full
// X   Curry_Sabji_Mini
// Y   Curry_Sabji_Full
// Z   Dal
// AA  Rice
// AB  Salad
// AC  Curd
// AD  BF_Item_1
// AE  BF_Qty_1
// AF  BF_Item_2
// AG  BF_Qty_2
// AH  BF_Item_3
// AI  BF_Qty_3
// AJ  BF_Item_4
// AK  BF_Qty_4
// AL  Special_Notes
// AM  Food_Subtotal
// AN  Delivery_Charge
// AO  Discount_Amount
// AP  Net_Total
// AQ  Payment_Method
// AR  Payment_Status
// AS  Payment_Freq
// AT  First_Time
// AU  Source

const CUSTOMERS_HEADERS = [
  "Phone","Customer_Name","Area","Wing","Flat","Floor","Society","Full_Address",
  "Maps_Link","Landmark","Payment_Freq","Created_At","Ledger_Sheet_ID","PIN","Meal_Addresses",
  "Review_Promo_Count", "Review_Reward_Claimed", "Standard_Order", "Billing_Cycle", "Fee_Exempt", "Delivery_Point", "On_Account", "Last_Order_At"
];

const ORDERS_HEADERS = [
  "Submission_ID","Submitted_At","Order_Date","Meal_Type",
  "Customer_Name","Phone","Area","Wing","Flat","Floor","Society","Full_Address","Maps_Link","Landmark",
  "Items_JSON",
  "Chapati","Without_Oil_Chapati","Phulka","Ghee_Phulka","Jowar_Bhakri","Bajra_Bhakri",
  "Dry_Sabji_Mini","Dry_Sabji_Full","Curry_Sabji_Mini","Curry_Sabji_Full",
  "Dal","Rice","Salad","Curd",
  "BF_Item_1","BF_Qty_1","BF_Item_2","BF_Qty_2","BF_Item_3","BF_Qty_3","BF_Item_4","BF_Qty_4",
  "Special_Notes_Kitchen","Special_Notes_Delivery",
  "Food_Subtotal","Delivery_Charge","Discount_Amount","Review_Discount","Net_Total",
  "Payment_Method","Payment_Status","Payment_Freq","First_Time","Source","Refund_Preference", "Packed", "Delivery_Point",
  "Inflation_Surcharge", "Loyalty_Discount", "Wallet_Credit"
];

const ITEM_COL_MAP = {
  // Canonical Names (Universal Standard)
  "Chapati": "Chapati",
  "Without Oil Chapati": "Without_Oil_Chapati",
  "Phulka": "Phulka",
  "Ghee Phulka": "Ghee_Phulka",
  "Jowar Bhakri": "Jowar_Bhakri",
  "Bajra Bhakri": "Bajra_Bhakri",
  "Dry Sabji Mini (100ml)": "Dry_Sabji_Mini",
  "Dry Sabji Full (250ml)": "Dry_Sabji_Full",
  "Curry Sabji Mini (100ml)": "Curry_Sabji_Mini",
  "Curry Sabji Full (250ml)": "Curry_Sabji_Full",
  "Dal (200ml)": "Dal",
  "Rice (100g)": "Rice",
  "Salad (40g)": "Salad",
  "Curd (50g)": "Curd",

  // Legacy/Simple variants (for backward compatibility)
  "Dry Sabji Mini": "Dry_Sabji_Mini",
  "Dry Sabji Full": "Dry_Sabji_Full",
  "Curry Sabji Mini": "Curry_Sabji_Mini",
  "Curry Sabji Full": "Curry_Sabji_Full",
  "Dal": "Dal",
  "Rice": "Rice",
  "Salad": "Salad",
  "Curd": "Curd",

  // Underscored variants
  "Without_Oil_Chapati":"Without_Oil_Chapati",
  "Ghee_Phulka":"Ghee_Phulka",
  "Jowar_Bhakri":"Jowar_Bhakri",
  "Bajra_Bhakri":"Bajra_Bhakri",
  "Dry_Sabji_Mini":"Dry_Sabji_Mini",
  "Dry_Sabji_Full":"Dry_Sabji_Full",
  "Curry_Sabji_Mini":"Curry_Sabji_Mini",
  "Curry_Sabji_Full":"Curry_Sabji_Full",

  // Legacy colKey aliases from order.html
  "L_CHAPATI":"Chapati","L_WO_CHAPATI":"Without_Oil_Chapati","L_PHULKA":"Phulka","L_GHEE_PHULKA":"Ghee_Phulka",
  "L_JOWAR":"Jowar_Bhakri","L_BAJRA":"Bajra_Bhakri",
  "L_DRY_MINI":"Dry_Sabji_Mini","L_DRY_FULL":"Dry_Sabji_Full",
  "L_CURRY_MINI":"Curry_Sabji_Mini","L_CURRY_FULL":"Curry_Sabji_Full",
  "L_DAL":"Dal","L_RICE":"Rice","L_SALAD":"Salad","L_CURD":"Curd",
  "D_CHAPATI":"Chapati","D_WO_CHAPATI":"Without_Oil_Chapati","D_PHULKA":"Phulka","D_GHEE_PHULKA":"Ghee_Phulka",
  "D_JOWAR":"Jowar_Bhakri","D_BAJRA":"Bajra_Bhakri",
  "D_DRY_MINI":"Dry_Sabji_Mini","D_DRY_FULL":"Dry_Sabji_Full",
  "D_CURRY_MINI":"Curry_Sabji_Mini","D_CURRY_FULL":"Curry_Sabji_Full",
  "D_DAL":"Dal","D_RICE":"Rice","D_SALAD":"Salad","D_CURD":"Curd",
  "B_CURD":"Curd"
};

// ── BUSINESS CONTEXT (for chatbot) ──────────────────────────
const BUSINESS_CONTEXT = {
  name: "Svaadh Kitchen",
  type: "Cloud Kitchen",
  tagline: "Wholesome homemade vegetarian meals, straight from our kitchen to your plate.",
  about: "Svaadh Kitchen is a home-based vegetarian cloud kitchen in Hadapsar, Pune, serving fresh and wholesome homemade meals since August 2023 (over 2.5 years). We specialize in homemade vegetarian food, offering breakfast, lunch, and dinner with a changing daily sabji menu. We deliver exclusively to 14 areas in Hadapsar: Bhosale Nagar, Magarpatta, Amanora, DP Road, Triveni Nagar, Malwadi, SadeSatraNali, Kirtane Baug, Tupe Patil Road, BG Shirke Road, Pune-Solapur Road (Magarpatta Bridge to Gadital only), Vihar Chowk, Mandai, and Gadital. Delivery is FREE for Bhosale Nagar and Triveni Nagar. All other areas have a nominal ₹11 fee if the order is below ₹100. Self Pickup is always free. (We no longer deliver to Vaiduwadi or the Yash Honda–Magarpatta Bridge stretch of Pune-Solapur Road.)",
  vision: "To make homemade vegetarian meals easily accessible and affordable for everyone, while maintaining taste, quality, and consistency.",
  locations_served: [
    "Bhosale Nagar", "Magarpatta", "Amanora", "DP Road", "Triveni Nagar", 
    "Malwadi", "SadeSatraNali", "Kirtane Baug", "Tupe Patil Road", "BG Shirke Road",
    "Pune-Solapur Road (Magarpatta Bridge to Gadital Only)", "Vihar Chowk", "Mandai (Hadapsar Mandai)", "Gadital"
  ],
  order_cutoffs: { breakfast: "before 7:00 AM", lunch: "before 9:00 AM", dinner: "before 4:30 PM", closed_on: "Sunday" },
  delivery: {
    free_areas: ["Bhosale Nagar", "Triveni Nagar", "Self Pickup"],
    charge: "₹11 per meal. Delivery becomes FREE when the day's food total reaches ₹106 (1 meal that day), ₹159 (2 meals) or ₹190 (3 meals). Always free for Bhosale Nagar, Triveni Nagar and Self Pickup. A small ₹11 cart fee applies to a Lunch/Dinner meal under ₹53.",
    delivery_full: "On high-demand days a meal's delivery slots can fill up. Orders of ₹200+ for that meal (₹100+ for breakfast) still get home delivery; otherwise choose free Self Pickup or Porter (customer books the courier, pays courier directly, we add no fee).",
    outside_policy: "We only deliver in the listed Hadapsar areas. We DO NOT deliver to areas like Kothrud, Baner, Viman Nagar, etc."
  },
  menu: {
    note: "Today's sabji (dry and curry) changes daily — shown in the order form. Breakfast items also rotate daily.",
    breads: [
      {name:"Chapati", price:10, unit:"per piece"},
      {name:"Without Oil Chapati", price:9, unit:"per piece"},
      {name:"Phulka", price:8, unit:"per piece"},
      {name:"Ghee Phulka", price:11, unit:"per piece"},
      {name:"Jowar Bhakri", price:22, unit:"per piece"},
      {name:"Bajra Bhakri", price:22, unit:"per piece"}
    ],
    sabji: [
      {name:"Dry Sabji Mini (100ml)", price:24},
      {name:"Dry Sabji Full (250ml)", price:48},
      {name:"Curry Sabji Mini (100ml)", price:24},
      {name:"Curry Sabji Full (250ml)", price:48}
    ],
    basics: [
      {name:"Dal (200ml)", price:24},
      {name:"Rice (100g)", price:13},
      {name:"Salad (40g)", price:8},
      {name:"Curd (50g)", price:13}
    ],
    breakfast: "Rotating daily (₹35–₹70) — Kanda Poha, Ghee Upma, Sabudana Khichdi, Tikhi Pudi, Idli-Chutney, Aloo/Paneer Paratha, Thalipeeth, Ghee Sheera and more. Exact items & prices for today are shown in the order form.",
    breakfast_note: "Curd 50g (₹13) is available as an add-on for breakfast — not included by default. Pure Ghee is used to make breakfast items."
  },
  bulk_plans: {
    summary: "Bulk meal plans (⚡ card on the order page): Week = 6 working days with 5% off, 15-Day = 13 working days with 7.5% off, Month = 26 working days with 10% off every day's food. Lunch and/or Dinner; the sabji each day is the chef's special. Sundays & kitchen holidays are skipped automatically. Daily discount tiers stack on top.",
    postpone: "15-Day plan: postpone up to 2 lunch + 2 dinner days to another date (within 30 days) free of charge. Month plan: up to 4 + 4. Same items, same price, discount kept.",
    cancel: "Any individual day can be cancelled before its cutoff; cancelling forfeits that meal's bulk discount, rest is refunded."
  },
  discounts: {
    tier1: "5% off when the day's food total is ₹325 or more",
    tier2: "7.5% off when the day's food total is ₹485 or more",
    tier3: "10% off when the day's food total is ₹750 or more",
    loyalty: "Order 6 days in a row (Sundays/kitchen-closed days don't break the streak) and get a loyalty reward on day 6 — 5% of each streak day's food given back.",
    review_promo: "5-star Google review earns 10% off the next order.",
    note: "Discounts are applied automatically per day's total when placing an order."
  },
  payment: {
    options: ["UPI/Cards via secure HDFC payment gateway (instant confirmation)", "Svaadh Wallet (prepaid, instant recharge via gateway)", "Wallet + gateway split", "On Account (approved regulars, monthly settlement)"],
    gateway: "Payments go through the HDFC SmartGateway — pay by UPI or card, the order confirms automatically. No screenshots or manual verification.",
    wallet: "Svaadh Wallet enables 1-tap ordering. Recharge instantly (min ₹100) via the gateway on the order page. Cancellations refund instantly to the wallet.",
    upi_id: "9819969682@hdfc"
  },
  ordering: {
    order_url: "https://www.svaadhkitchen.in/order.html",
    process: "Open the order form → enter phone number → fill address → pick dates → choose meals → review bill → pay via gateway (UPI/card), Wallet, or On Account.",
    advance: "Select multiple dates on the calendar to order for the full week in one go — or use a Bulk plan (Week/15-Day/Month) for automatic daily meals with a discount.",
    per_meal_address: "Each meal can go to a different address — breakfast at home, lunch at office, dinner back home.",
    edit_cancel: "Use 'View/Edit existing orders' to cancel before the cutoff (editing = cancel and re-place). Bulk 15-Day/Month days can be POSTPONED to another date instead of cancelling.",
    tracking: "Once the driver marks an order dispatched, an 'Out for Delivery' badge shows in the Manage Orders dashboard.",
    pwa: "The website installs as a mobile app (PWA) — tap 'Install App' on the home or order page.",
    no_login: "No login needed — phone number is your identity. Details are saved automatically."
  },
  contact: {
    phone_primary: "9930748908",
    phone_alt: "9819969682",
    whatsapp: "+91 93222 46765",
    whatsapp_link: "https://wa.me/919322246765",
    whatsapp_group: "https://chat.whatsapp.com/EpLv7mtYipm61ScKjbOiuk",
    email: "svaadh.kitchen@gmail.com",
    google_page: "https://share.google/UnZM2xcLOF2QVO9cj"
  }
};
