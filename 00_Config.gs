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

const CODE_VERSION   = 25.9; // 2026-07-08: ON-ACCOUNT PARTIAL-SETTLEMENT EMAIL IS NOW SCOPE-AWARE — the v25.3 fallback in _settleOnAccountDirect (10_Hdfc_Gateway.gs) emailed the owner whenever a gateway on-account charge came in BELOW the customer's full current balance, on the assumption that only a mid-payment race could cause it. But MONTHLY on-account customers are billed for the PRIOR month only (getOnAccountBill / _computeOnAccountDue scope="monthly" = orders before the 1st of the current IST month); the current month's orders are meant to STAY On Account and be billed next cycle. So for a monthly payment, charge < full balance is the NORMAL designed state, and the email was a false alarm every cycle (reported: customer 8554899866 paid ₹1025 for June, ₹168 of July correctly remained, owner got a "balance changed mid-payment" email). FIX: the session already persists its scope in HDFC_PENDING_ONACCOUNT; hdfc_finalizeOnAccountPayment now passes that scope into _settleOnAccountDirect, which computes a "billed due" (monthly → pre-cutoff orders only; all → full balance) and emails ONLY when the charge fell short of the BILLED due (a genuine in-scope shortfall), with the ₹2 rounding tolerance. Missing/legacy scope defaults to "all" (prior behaviour, safe). The settlement loop itself is byte-for-byte UNCHANGED — this only gates the alert. Node-verified by EXECUTING the real extracted _settleOnAccountDirect (scratchpad onaccountmail.js, 5 scenarios): monthly-pays-June-bill settles all 6 June rows / 0 July / NO email; monthly-short-of-June-bill emails; all-scope shortfall emails; ₹2 tolerance respected; legacy no-scope emails. (25.8 below: MARKET SURCHARGE REMOVED FROM ANALYTICS — the "market surcharge" is obsolete since the PRICING_V2 go-live (no longer billed), but the admin Analytics report still showed it: a "📈 Surcharge" KPI, a Total-Fees line item, and a per-day-table column. Worse, _analyticsCore read the Inflation_Surcharge column (which under V2 now holds ONLY the loyalty-streak accrual, not a billed fee) and, for blank rows, FABRICATED a ceil(food*0.06) surcharge that was never charged — showing a misleading ₹-figure (owner spotted ₹2,811 for July). Removed surcharge from the analytics surface end-to-end: _analyticsCore no longer computes/sums it (dropped totalSurcharge + dayMap.surcharge + the 6% backfill), getAnalytics no longer returns summary.surcharge or days[].surcharge, and vault_admin.html's renderAnalytics drops the Surcharge KPI, the day-table Surch. column (header/cells/footer), and excludes it from Total Fees (= Delivery + Small Order Fee now). Revenue is Net_Total and NEVER added surcharge separately, so every total (revenue/collected/pending/avg/day/delivery/small-fee) is byte-for-byte unchanged — verified live against the owner's screenshot (387 orders / 111 customers / ₹53,016 / ₹31,391 / ₹21,625 / ₹649 / ₹182). DELIBERATELY untouched: the loyalty-streak machinery (Inflation_Surcharge column, _calculateLoyaltyStreak, the 6-day waiver) and the same-day cancel-recompute — those legitimately still use that column as the accrual, NOT as a market surcharge. (25.7 below: FORECASTED MONTHLY SALES (admin Analytics page) — new getForecastedMonthlySales() (04_Reports_Misc.gs) projects the CURRENT calendar month's revenue via a real weekday-seasonality model (NOT naive avgPerDay*daysInMonth): pulls a trailing 70-day lookback (spans live+archives via the newly-extracted _analyticsCore, shared with getAnalytics so backfill rules can never drift between the two), trims any LEADING run of zero-revenue days (pre-launch, not "closed"), averages revenue per weekday (Sunday naturally comes out ~₹0 — the model LEARNS the closed day from data, zero hardcoding), applies a bounded recent-trend factor (last 14 days vs full lookback, clamped 0.6x-1.6x), and sums actual month-to-date revenue + Σ(weekday avg * trend) for every remaining day, with a rough +/- confidence band from the lookback's day-to-day std dev. Flags lowConfidence when fewer than 14 real trading days are available. New admin route ?action=getForecastedMonthlySales (admin PIN). Frontend: new forecast card at the top of the Analytics page (independent of the date-range picker, always current month), loaded once per page-open. Node-verified 11 assertions against the REAL extracted function with a simulated 50-day-old business (Sunday-closed pattern + a deliberate recent uptick) — correctly learned Sunday=0, trimmed pre-launch, and detected the uptick. (25.6 below: SABJI COMBO STOCK LIMITS — Dry/Curry Sabji Mini+Full can now share ONE weighted limit (Mini=0.6, Full=1.4) instead of two separate ones, e.g. limit 25 means mini*0.6+full*1.4<=25 and BOTH sizes close together the instant it's crossed. New shared helpers in Code.gs (SABJI_COMBO_WEIGHTS, SABJI_COMBO_GROUPS, _sabjiComboStatus, _applySabjiComboLimits) wired into getMenu (customer units_remaining), getAdminData (admin display), and submitOrder's stock preflight (authoritative hard-block, checked under lock even when neither size alone crossed its own limit). Stored as virtual "__COMBO_DRY__"/"__COMBO_CURRY__" entries inside the existing Stock_JSON blob — no schema change, no frontend order.html change needed (units_remaining stays the single source of truth it already reads). Admin panel: new "Sabji Combo Stock Limits" card (Lunch/Dinner) with 2 inputs + live weighted-usage readout, reusing the existing setStockLimit()/save path. Node-verified 8 scenarios against the real extracted functions (exact-at-limit, over-limit clamp, MIN-with-individual-limit combination, backward-compat no-op). (25.5 below: delivery-cap ₹200 bypass split PER MEAL — CAP_DELIVERY_BYPASS_MIN is now {Breakfast:100, Lunch:200, Dinner:200} (Breakfast is typically a smaller ticket). Updated the server guard (02_Orders_Menu.gs, keyed by meal type, falls back to 200 for any unlisted meal) and order.html's mirror (_soldOutDeliveryMealsInCart skip check, the per-meal shortfall tip, dialog copy) to match. Browser-verified: Breakfast ₹99 flagged/₹100 passes, Lunch/Dinner still at ₹199 flagged/₹200 passes. (25.4 below: getKitchenSummary's `cutoffs` field was `menu.cutoff_overrides || {}` — the RAW per-day override only, empty for any date without one (the norm now that admin uses the site-wide Default Cutoff Times panel instead of per-day overrides). kitchen.html's prep countdown then fell through to its OWN hardcoded fallback (Dinner 16.5 = 4:30 PM), totally blind to the live default (owner set 4:15 PM; countdown still showed time-to-4:30). Fixed to return _effectiveCutoffsForDate(date) — default merged with any override, same function the customer-facing cutoff enforcement already uses. kitchen.html's 5-min auto-refresh converges the display; no frontend change needed. (25.3 below: On-Account settlement fixes.) — (1) unified status filter: verifyLogin's displayed due amount, _autoSettlePendingOrders, _computeOnAccountDue, getOnAccountBill, and the admin billing bucket all previously used slightly different ad-hoc filters (some counted legacy "Pending"/blank rows, inflating the customer-visible due without those rows ever being chargeable) — now all route through one _isOnAccountDueStatus("On Account" exact match, the only string ever actually written). (2) FIXED the ₹812/"3 orders skipped" incident's root cause in _settleOnAccountDirect: the old oldest-first loop did `remaining -= net` per row and `break`-ed the WHOLE loop the instant one row's net exceeded what was left, silently abandoning every row after it even if smaller/affordable. Now: a FAST PATH settles every on-account row directly whenever the charge covers the full current balance (the normal/expected case — makes this bug class structurally impossible); a FALLBACK (charge < current balance, e.g. a new on-account order landed mid-payment) skips-and-continues instead of breaking, and emails the owner since the balance shifted mid-payment. Added read-only auditOnAccountStatusDrift() (+?action=auditOnAccountDrift, admin PIN) to list any stray legacy rows in live data. Node-simulated the exact stranding pattern against both old and new logic to confirm. HARDENING PASS (same day): ₹2 rounding tolerance on the fast path (charge=round(sum) vs sum(round(net)) can differ on legacy paise); TRUE chronological sort in _settleOnAccountDirect AND _autoSettlePendingOrders (Order_Date is a Date object — String(Date) sorted by WEEKDAY NAME, scrambling oldest-first); skip-not-break in _autoSettlePendingOrders too (same stranding class); getCustomerOrders balance also on the helper. PLUS ₹200 delivery-cap bypass: a capped meal with subtotal ≥ CAP_DELIVERY_BYPASS_MIN keeps delivery (alt-ON only; cap_alt=false hard close never bypassed) — frontend gate skip + dialog tip with per-meal shortfall + server guard. (25.2 below: address hygiene.)
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
const TAB_WALLET     = "SK_Wallet"; // Holds prepaid balances
const TAB_REFUNDS    = "SK_Refunds";      // Manual refund requests
const TAB_WEBHOOK_LOG = "SK_Webhook_Log"; // HDFC webhook log-first buffer
const TAB_GA4_METRICS = "SK_Analytics_Data"; // Google Analytics Storage

// Canonical SK_Wallet column schema — NEVER reorder these
const WALLET_HEADERS = ["Phone", "Customer_Name", "Txn_Type", "Amount", "Verified", "Reference_ID", "Timestamp"];

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
  about: "Svaadh Kitchen is a home-based vegetarian cloud kitchen in Hadapsar, Pune, serving fresh and wholesome homemade meals since August 2023 (over 2.5 years). We specialize in homemade vegetarian food, offering breakfast, lunch, and dinner with a changing daily sabji menu. We deliver exclusively to 15 areas in Hadapsar: Bhosale Nagar, Magarpatta, Amanora, DP Road, Triveni Nagar, Malwadi, SadeSatraNali, Kirtane Baug, Tupe Patil Road, BG Shirke Road, Vaiduwadi (till Yash Honda), Pune-Solapur Road (till Gadital), Vihar Chowk, Mandai, and Gadital. Delivery is FREE for Bhosale Nagar and Triveni Nagar. All other areas have a nominal ₹11 fee if the order is below ₹100. Self Pickup is always free.",
  vision: "To make homemade vegetarian meals easily accessible and affordable for everyone, while maintaining taste, quality, and consistency.",
  locations_served: [
    "Bhosale Nagar", "Magarpatta", "Amanora", "DP Road", "Triveni Nagar", 
    "Malwadi", "SadeSatraNali", "Kirtane Baug", "Tupe Patil Road", "BG Shirke Road", 
    "Vaiduwadi (Till Yash Honda Only)", "Pune-Solapur Road (Till Gadital Only)", "Vihar Chowk", "Mandai (Hadapsar Mandai)", "Gadital"
  ],
  order_cutoffs: { breakfast: "before 7:00 AM", lunch: "before 9:00 AM", dinner: "before 4:30 PM", closed_on: "Sunday" },
  delivery: {
    free_areas: ["Bhosale Nagar", "Triveni Nagar", "Self Pickup"],
    charge: "₹11 per meal for other listed areas if subtotal is below ₹100. Free for Bhosale Nagar, Triveni Nagar and Self Pickup always.",
    outside_policy: "We only deliver in the listed Hadapsar areas. We DO NOT deliver to areas like Kothrud, Baner, Viman Nagar, etc."
  },
  menu: {
    note: "Today's sabji (dry and curry) changes daily — shown in the order form. Breakfast items also rotate daily.",
    breads: [
      {name:"Chapati", price:9, unit:"per piece"},
      {name:"Without Oil Chapati", price:8, unit:"per piece"},
      {name:"Phulka", price:7, unit:"per piece"},
      {name:"Ghee Phulka", price:10, unit:"per piece"},
      {name:"Jowar Bhakri", price:20, unit:"per piece"},
      {name:"Bajra Bhakri", price:20, unit:"per piece"}
    ],
    sabji: [
      {name:"Dry Sabji Mini (100ml)", price:22},
      {name:"Dry Sabji Full (250ml)", price:45},
      {name:"Curry Sabji Mini (100ml)", price:22},
      {name:"Curry Sabji Full (250ml)", price:45}
    ],
    basics: [
      {name:"Dal (200ml)", price:22},
      {name:"Rice (100g)", price:12},
      {name:"Salad (40g)", price:6},
      {name:"Curd (50g)", price:12}
    ],
    breakfast: "Rotating daily (₹35–₹70). Items include Kanda Poha [175g] ₹35, Ghee Upma [200g] ₹40, Sabudana Khichdi [200g] ₹40, 5 x Tikhi Pudi with 100 ml coriander chutney ₹45, 4 x Idli & 100ml Chutney ₹45, Aloo Paratha ₹50, Thalipeeth ₹50, Ghee Sheera [200g] ₹50, Paneer Paratha ₹70. Curd 50g available extra ₹12. Check the order form for today's options.",
    breakfast_note: "Curd 50g (₹12) is available as an add-on for breakfast — not included by default. Pure Ghee is used to make breakfast items."
  },
  discounts: {
    tier1: "5% off when the day total is ₹300 or more",
    tier2: "7.5% off when the day total is ₹450 or more",
    note: "Discounts are applied automatically per day's total when placing an order."
  },
  payment: {
    options: ["Svaadh Wallet (Prepaid)", "UPI", "Prepaid Wallet Billing"],
    upi_id: "9819969682@hdfc",
    prepaid_wallet: "Prepaid Wallet Billing operates as a prepaid wallet. Customers must maintain a top-up balance, and orders are deducted immediately."
  },
  ordering: {
    order_url: "https://www.svaadhkitchen.in/order.html",
    process: "Open the order form → enter phone number → fill address → pick dates → choose meals → review bill → pay via Wallet or UPI.",
    advance: "Select multiple dates on the calendar to order for the full week in one go.",
    edit_cancel: "Use 'View/Edit existing orders' on the order form home screen to edit or cancel before the cutoff.",
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
