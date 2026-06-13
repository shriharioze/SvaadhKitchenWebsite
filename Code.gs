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

const CODE_VERSION   = 16.9; // 2026-06-13: HOTFIX — getOrCreateTab made NON-DESTRUCTIVE (no positional header rewrite, no column deletion). Old version corrupted SK_Orders during archive (wiped Order_Date/Submitted_At, orders stopped registering).
const LEDGER_FOLDER  = "Svaadh Customer Ledgers";

// ── PAYMENT GATEWAY CONFIG ───────────────────────────────────
// Controlled via Script Properties — never hardcoded.
// In Dev Apps Script: add Script Property  PAYMENT_GATEWAY_ENABLED = true
// Live project never has this property set → evaluates to false automatically.
const PAYMENT_GATEWAY_ENABLED = (SP.getProperty("PAYMENT_GATEWAY_ENABLED") === "true");

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
const HDFC_ENV              = SP.getProperty("HDFC_ENV")              || "test";
const HDFC_RETURN_URL       = SP.getProperty("HDFC_RETURN_URL")       || "";
const HDFC_ORDER_PAGE_URL   = SP.getProperty("HDFC_ORDER_PAGE_URL")   || "https://svaadhkitchen.in/order.html";
const HDFC_BASE_URL         = HDFC_ENV === "live"
  ? (SP.getProperty("HDFC_LIVE_URL") || "https://smartgateway.hdfcbank.com")
  : (SP.getProperty("HDFC_TEST_URL") || "https://smartgateway-uat.hdfcbank.com");
// ─────────────────────────────────────────────────────────────

// Sheet tab names
const TAB_ORDERS     = "SK_Orders";
const TAB_CUSTOMERS  = "SK_Customers";
const TAB_MENU       = "SK_Daily_Menu";
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
  "Review_Promo_Count", "Review_Reward_Claimed", "Standard_Order", "Billing_Cycle", "Fee_Exempt", "Delivery_Point", "On_Account"
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

// ── CONSTANT-TIME PIN COMPARISON ─────────────────────────────
// Prevents timing-oracle attacks where comparing a wrong-length PIN
// returns faster than a correct-length one, leaking PIN length.
// Pads both sides to 32 chars, XORs every character, checks all at once.
function _pinMatch(supplied, expected) {
  const a = String(supplied || "").padEnd(32, "\0");
  const b = String(expected  || "").padEnd(32, "\0");
  let diff = 0;
  for (let i = 0; i < 32; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  // Also require lengths match (padEnd would equalize lengths, so check originals)
  return diff === 0 && String(supplied).length === String(expected).length;
}

// ── ENTRY POINT ──────────────────────────────────────────────
function doGet(e) {
  const p = e.parameter;
  const action = p.parameter ? p.action : (e.parameter.action || ""); // Fix for inconsistent parameter access
  const pin = p.pin || "";

  // Auth tiers resolved FIRST so every route below can safely reference them
  const isAdmin = _pinMatch(pin, ADMIN_PIN) && pin !== "";
  const isStaff = (_pinMatch(pin, KITCHEN_PIN) || _pinMatch(pin, ADMIN_PIN)) && pin !== "";

  // ── HDFC Return URL via GET ────────────────────────────────────
  // HDFC sometimes redirects the customer's browser via GET (not POST).
  // Detect by presence of order_id + status params with no _action.
  // Redirect browser to the order page URL with all params forwarded.
  if (p.order_id && p.status && !p.action && !p._action) {
    const params = Object.keys(p)
      .map(function(k) { return encodeURIComponent(k) + "=" + encodeURIComponent(p[k]); })
      .join("&");
    const redirectUrl = HDFC_ORDER_PAGE_URL + "?" + params;
    return HtmlService.createHtmlOutput(
      '<!DOCTYPE html><html><head><meta http-equiv="refresh" content="0;url=' + redirectUrl + '"></head>' +
      '<body><script>window.location.replace(' + JSON.stringify(redirectUrl) + ');</script>' +
      '<p>Redirecting... <a href="' + redirectUrl + '">Click here if not redirected</a></p></body></html>'
    );
  }
  // ─────────────────────────────────────────────────────────────

  try {
    if (action === "version") return jsonRes({version: CODE_VERSION, status:"ok"});
    if (action === "health") {
      // Lightweight liveness probe — reads one cell to confirm sheet connectivity.
      // Does NOT load orders or menu. Safe to call frequently from monitors.
      try {
        const ss = getSpreadsheet();
        const sheetCount = ss.getNumSheets();
        return jsonRes({ status: "ok", version: CODE_VERSION, sheets: sheetCount, ts: new Date().toISOString() });
      } catch(hErr) {
        return jsonRes({ status: "error", error: hErr.message, ts: new Date().toISOString() });
      }
    }
    if (action === "getConfig") return jsonRes({
      gateway_enabled: PAYMENT_GATEWAY_ENABLED,
      gateway_env: HDFC_ENV
    });
    if (action === "getAreas") return jsonRes(getAreas());
    if (action === "verifyAdminPin") return jsonRes({success: isAdmin});
    if (action === "getCustomer") return jsonRes(getCustomer(p.phone));
    if (action === "verifyLogin") return jsonRes(verifyLogin(p.phone, p.pin));
    if (action === "setPin") {
      const profile = { phone: p.phone, pin: p.pin };
      _upsertCustomer(getSpreadsheet(), profile);
      return jsonRes({success:true});
    }
    if (action === "getWeeklyMenu") return jsonRes(getWeeklyMenu());
    if (action === "markOnAccount") {
      if (!isAdmin) return jsonRes({error:"STRICT ADMIN PIN REQUIRED"});
      return jsonRes(markOnAccount(p.phone, p.cycle, p.status));
    }
    if (action === "getOnAccountBill") return jsonRes(getOnAccountBill(p.phone));

    // KITCHEN & DRIVER ACCESS (Staff PIN ONLY)
    if (action === "getKitchenSummary") {
      if (!isStaff) return jsonRes({error:"STRICT STAFF PIN REQUIRED"});
      return jsonRes(getKitchenSummary(p.date));
    }
    if (action === "getDriverOrders") {
      if (!isStaff) return jsonRes({error:"STRICT STAFF PIN REQUIRED"});
      return jsonRes(getDriverOrders(p.date));
    }
    if (action === "getDeliveryRoute") {
      if (!isStaff) return jsonRes({error:"STRICT STAFF PIN REQUIRED"});
      return jsonRes(getDeliveryRoute());
    }
    if (action === "buildDeliveryRoute") {
      if (!isStaff) return jsonRes({error:"STRICT STAFF PIN REQUIRED"});
      return jsonRes(buildDeliveryRoute(p.days));
    }
    if (action === "createDeliverySheet") {
      if (!isStaff) return jsonRes({error:"STRICT STAFF PIN REQUIRED"});
      return jsonRes(createDeliverySheet(p.date, p.meal));
    }
    if (action === "getLabelOrders") {
      if (!isStaff) return jsonRes({error:"STRICT STAFF PIN REQUIRED"});
      return jsonRes(getLabelOrders(p.date, p.meal));
    }
    // ── LABEL GAP (shared across all kitchen devices) ──
    // Reads + writes a single global label-gap value so kitchen tablets,
    // phones, and admin laptops always use the same spacing. Frontend
    // localStorage stays only as a same-device fallback if the network
    // call fails.
    if (action === "getLabelGap") {
      // Public-ish — any staff can read.
      if (!isStaff) return jsonRes({error:"STRICT STAFF PIN REQUIRED"});
      const v = SP.getProperty("LABEL_GAP_MM");
      const num = (v !== null && !isNaN(Number(v))) ? Number(v) : 2.7;
      return jsonRes({gap_mm: num});
    }

    // FULL ADMIN ACCESS (Admin PIN ONLY)
    if (action === "getAdminData") {
      if (!isAdmin) return jsonRes({error:"STRICT ADMIN PIN REQUIRED"});
      return jsonRes(getAdminData());
    }
    if (action === "getUnpaidCustomers") {
      if (!isAdmin) return jsonRes({error:"STRICT ADMIN PIN REQUIRED"});
      return jsonRes(getUnpaidCustomers(p));
    }
    if (action === "getOrderSummary") {
      if (!isAdmin) return jsonRes({error:"STRICT ADMIN PIN REQUIRED"});
      return jsonRes(getOrderSummary(p.date));
    }
    if (action === "getUnpaidOrdersData") {
      if (!isAdmin) return jsonRes({error:"STRICT ADMIN PIN REQUIRED"});
      return jsonRes(getUnpaidOrdersData(p));
    }
    if (action === "getPackagingExpenses") {
      if (!isAdmin) return jsonRes({error:"STRICT ADMIN PIN REQUIRED"});
      if (p.from && p.to) return jsonRes(getPackagingExpensesRange(p.from, p.to));
      return jsonRes(getPackagingExpenses(p.date));
    }
    if (action === "getOrderHistory") {
      if (!isAdmin) return jsonRes({error:"STRICT ADMIN PIN REQUIRED"});
      return jsonRes(getOrderHistory(p));
    }
    if (action === "getCustomerList") {
      if (!isAdmin) return jsonRes({error:"STRICT ADMIN PIN REQUIRED"});
      return jsonRes(getCustomerList());
    }
    if (action === "getCustomerHistory") {
      if (!isAdmin) return jsonRes({error:"STRICT ADMIN PIN REQUIRED"});
      return jsonRes(getCustomerHistory(p.phone));
    }
    if (action === "getDatePayments") {
      if (!isAdmin) return jsonRes({error:"STRICT ADMIN PIN REQUIRED"});
      return jsonRes(getDatePayments(p.date));
    }
    if (action === "getAnalytics") {
      if (!isAdmin) return jsonRes({error:"STRICT ADMIN PIN REQUIRED"});
      return jsonRes(getAnalytics(p));
    }
    if (action === "getExpenses") {
      if (!isAdmin) return jsonRes({error:"STRICT ADMIN PIN REQUIRED"});
      return jsonRes(getExpenses(p));
    }
    if (action === "getExpenseAnalytics") {
      if (!isAdmin) return jsonRes({error:"STRICT ADMIN PIN REQUIRED"});
      return jsonRes(getExpenseAnalytics(p));
    }
    if (action === "getCustomExpenseCategories") {
      if (!isAdmin) return jsonRes({error:"STRICT ADMIN PIN REQUIRED"});
      return jsonRes({ success:true, categories: getCustomExpenseCategories() });
    }
    if (action === "getInventoryData") {
      if (!isAdmin) return jsonRes({error:"STRICT ADMIN PIN REQUIRED"});
      return jsonRes(getInventoryData(p));
    }
    if (action === "adminCreditWallet") {
      if (!isAdmin) return jsonRes({error:"STRICT ADMIN PIN REQUIRED"});
      return jsonRes(adminCreditWallet(body));
    }
    if (action === "getChurnReport") {
      if (!isAdmin) return jsonRes({error:"STRICT ADMIN PIN REQUIRED"});
      return jsonRes(getChurnReport(p.sinceDate));
    }
    if (action === "getPendingRefunds") {
      if (!isAdmin) return jsonRes({error:"STRICT ADMIN PIN REQUIRED"});
      return jsonRes(getPendingRefunds());
    }
    if (action === "getPendingRecharges") {
      if (!isAdmin) return jsonRes({error:"Invalid PIN"});
      return jsonRes(getPendingRecharges());
    }
    if (action === "getPendingUPIPayments") {
      if (!isAdmin) return jsonRes({error:"Invalid PIN"});
      return jsonRes(getPendingUPIPayments());
    }
    if (action === "getPendingCounts") {
      if (!isAdmin) return jsonRes({error:"Invalid PIN"});
      return jsonRes({
        refunds: getPendingRefunds().length,
        wallet: getPendingRecharges().length,
        payments: getPendingUPIPayments().length
      });
    }

    if (action === "syncGA4Data") {
      if (!isAdmin) return jsonRes({error:"STRICT ADMIN PIN REQUIRED"});
      return jsonRes({success: true, message: syncGA4Data()});
    }
    if (action === "setupAnalyticsTrigger") {
      if (!isAdmin) return jsonRes({error:"STRICT ADMIN PIN REQUIRED"});
      return jsonRes({success: true, message: setupAnalyticsTrigger()});
    }
    
    // Keep-alive ping — just wakes GAS, no sheet reads
    if (action === "ping") return jsonRes({ok: true, t: new Date().toISOString()});

    // Fallback menu / orders for customers (legacy)
    if (action === "getMenu") return jsonRes(getMenu(p.date));
    if (action === "getMenuBatch") return jsonRes(getMenuBatch(p.dates));
    if (action === "getBreakfastItemDates") return jsonRes(getBreakfastItemDates(p.items));
    if (action === "getKitchenClosedDates") return jsonRes(getKitchenClosedDates());
    if (action === "getWeeklyMenu") return jsonRes(getWeeklyMenu());
    if (action === "getCustomerOrders") return jsonRes(getCustomerOrders(p.phone));
    if (action === "getWalletValue") return jsonRes({wallet_balance: _calculateWalletBalance(p.phone)});
    if (action === "getWalletTransactions") return jsonRes(getWalletTransactions(p.phone));
    if (action === "getDayTotalsForDates") return jsonRes(getDayTotalsForDates(p.phone, p.dates));

    // ── IntentAmplify (corporate channel) — GET ────────────────
    if (action === "ia_config")          return jsonRes(ia_config());
    if (action === "ia_checkPhone")      return jsonRes(ia_checkPhone(p.phone));
    if (action === "ia_verifyLogin")     return jsonRes(ia_verifyLogin(p.phone, p.pin));
    if (action === "ia_getMenu")         return jsonRes(ia_getMenuRange((p.dates||"").split(",").filter(Boolean), IA_MEALS));
    if (action === "ia_myOrders")        return jsonRes(ia_myOrders(p.phone));
    if (action === "ia_adminOrders")     return jsonRes(ia_adminOrders(p));
    if (action === "ia_pendingApprovals")return jsonRes(ia_pendingApprovals(p));
    if (action === "ia_customers")       return jsonRes(ia_customers(p));
    if (action === "ia_analytics")       return jsonRes(ia_analytics(p));
    if (action === "ia_prep")            return jsonRes(ia_prep(p));
    if (action === "ia_getDriverOrders") return jsonRes(ia_getDriverOrders(p));
    if (action === "ia_getKitchenSummary") return jsonRes(ia_getKitchenSummary(p));
    if (action === "ia_getLabelOrders")    return jsonRes(ia_getLabelOrders(p));

    return jsonRes({error:"Unknown action or Access Denied"});
  } catch(err) {
    return jsonRes({error: err.message});
  }
}

function doPost(e) {
  try {
    // ── HDFC Return URL Handler ────────────────────────────────
    // Juspay POSTs payment result to our return URL (GitHub Pages can't accept POST → 405).
    // We use the Apps Script URL as the return URL instead.
    // When HDFC posts here with order_id + status (no _action), serve an HTML page
    // that immediately JS-redirects the browser to order.html with those params as GET params.
    const rawBody = e.postData ? e.postData.contents : "";
    let parsedForHdfc = {};
    try { parsedForHdfc = JSON.parse(rawBody); } catch(_) {}
    const isHdfcReturn = parsedForHdfc.order_id && parsedForHdfc.status && !parsedForHdfc._action;
    if (isHdfcReturn) {
      const params = Object.keys(parsedForHdfc)
        .map(k => encodeURIComponent(k) + "=" + encodeURIComponent(parsedForHdfc[k]))
        .join("&");
      const redirectUrl = HDFC_ORDER_PAGE_URL + "?" + params;
      return HtmlService.createHtmlOutput(
        `<!DOCTYPE html><html><head><meta http-equiv="refresh" content="0;url=${redirectUrl}"></head>` +
        `<body><script>window.location.replace(${JSON.stringify(redirectUrl)});</script>` +
        `<p>Redirecting... <a href="${redirectUrl}">Click here if not redirected</a></p></body></html>`
      );
    }
    // ── Also handle form-encoded POST (Juspay sends this for the failure path)
    // Includes the popup-close loop so AUTHORIZATION_FAILED closes the popup
    // automatically — matching the success-path behaviour. Without the close
    // attempts the customer had to manually close the failure popup.
    if (!parsedForHdfc.order_id && e.postData && e.postData.type === "application/x-www-form-urlencoded") {
      const formParams = e.parameter || {};
      if (formParams.order_id && formParams.status) {
        const params = Object.keys(formParams)
          .map(k => encodeURIComponent(k) + "=" + encodeURIComponent(formParams[k]))
          .join("&");
        const redirectUrl = HDFC_ORDER_PAGE_URL + "?" + params;
        const safeUrlJs = JSON.stringify(redirectUrl);
        return HtmlService.createHtmlOutput(
          `<!DOCTYPE html><html><head><meta http-equiv="refresh" content="3;url=${redirectUrl}"></head>` +
          `<body><p>Returning to Svaadh Kitchen…</p><script>(function(){` +
          `var URL=${safeUrlJs};` +
          `var n=0;function tryClose(){n++;try{window.close();}catch(_){}try{if(window.top&&window.top!==window){window.top.close();}}catch(_){}if(n<6)setTimeout(tryClose,300);}tryClose();` +
          `function go(){try{window.top.location.replace(URL);}catch(e){try{window.top.location.href=URL;}catch(_){window.location.href=URL;}}}` +
          `setTimeout(go,50);setTimeout(go,500);` +
          `})();</script>` +
          `<p><a href="${redirectUrl}">Click here if not redirected</a></p></body></html>`
        );
      }
    }
    // ── Normal API actions ─────────────────────────────────────
    const body = JSON.parse(rawBody);
    const action = body._action || "";
    const pin = body.pin || "";
    const isAdmin = _pinMatch(pin, ADMIN_PIN) && pin !== "";
    const isStaff = (_pinMatch(pin, KITCHEN_PIN) || _pinMatch(pin, ADMIN_PIN)) && pin !== "";

    // Customer self-service (phone-verified inside each function)
    if (action === "deleteOrder") return jsonRes(deleteOrder(body.phone, body.rowId, body.refundType, { isAdmin: isAdmin }));
    if (action === "previewCancellation") return jsonRes(_deleteOrderInternal(body.phone, body.rowId, body.refundType || "wallet", { dryRun: true }));
    if (action === "getCustomerOrders") return jsonRes(getCustomerOrders(body.phone));
    if (action === "verifyOrderPlaced") return jsonRes(verifyOrderPlaced(body));
    if (action === "updateProfile") {
      const profile = body.profile;
      if (!profile || !profile.phone) return jsonRes({error: "Phone required"});
      _upsertCustomer(getSpreadsheet(), profile);
      return jsonRes({success: true});
    }

    // Admin-only read: returns all customer profiles + wallet balances
    if (action === "getCustomerList") {
      if (!isAdmin) return jsonRes({error:"STRICT ADMIN PIN REQUIRED"});
      return jsonRes(getCustomerList());
    }
    
    // Delivery Actions (Staff PIN ONLY)
    if (action === "markDelivered") {
      if (!isStaff) return jsonRes({error:"STRICT STAFF PIN REQUIRED"});
      return jsonRes(markDelivered(body));
    }
    if (action === "batchMarkEnRoute") {
      if (!isStaff) return jsonRes({error:"STRICT STAFF PIN REQUIRED"});
      return jsonRes(batchMarkEnRoute(body));
    }
    if (action === "setStandardOrder") {
      if (!isAdmin) return jsonRes({error:"STRICT ADMIN PIN REQUIRED"});
      return jsonRes(setStandardOrder(body.phone, body.items, body.templateName, body.meal));
    }
    if (action === "removeStandardOrder") {
      if (!isAdmin) return jsonRes({error:"STRICT ADMIN PIN REQUIRED"});
      return jsonRes(removeStandardOrder(body.phone, body.templateName));
    }
    if (action === "placeBulkOrders") {
      if (!isAdmin) return jsonRes({error:"STRICT ADMIN PIN REQUIRED"});
      return jsonRes(placeBulkOrders(body));
    }
    if (action === "markEnRoute") {
       if (!isStaff) return jsonRes({error:"STRICT STAFF PIN REQUIRED"});
       return jsonRes(markEnRoute(body));
     }
     if (action === "markOrderPacked") {
       if (!isStaff) return jsonRes({error:"STRICT STAFF PIN REQUIRED"});
       return jsonRes(markOrderPacked(body));
     }

    // Admin-only write actions
    if (action === "adminCancelOrder") {
      if (!isAdmin) return jsonRes({success:false, error: "STRICT ADMIN PIN REQUIRED"});
      return jsonRes(adminCancelOrder(body));
    }
    if (action === "setKitchenClosed") {
      if (!isAdmin) return jsonRes({success:false, error: "STRICT ADMIN PIN REQUIRED"});
      return jsonRes(setKitchenClosed(body));
    }
    if (action === "markRefunded") {
      if (!isAdmin) return jsonRes({error:"STRICT ADMIN PIN REQUIRED"});
      return jsonRes(markRefunded(body.submissionId));
    }
    if (action === "toggleFeeExempt") {
      if (!isAdmin) return jsonRes({error:"STRICT ADMIN PIN REQUIRED"});
      return jsonRes(toggleFeeExempt(body.phone, body.status));
    }
    if (action === "approveWalletRecharge") {
      if (!isAdmin) return jsonRes({error:"STRICT ADMIN PIN REQUIRED"});
      return jsonRes(approveWalletRecharge(body));
    }
    if (action === "markReviewed") {
      if (!isAdmin) return jsonRes({error:"STRICT ADMIN PIN REQUIRED"});
      return jsonRes(markReviewed(body));
    }
    if (action === "deleteBreakfastItem") {
      if (!isAdmin) return jsonRes({error:"STRICT ADMIN PIN REQUIRED"});
      return jsonRes(deleteBreakfastItem(body.id));
    }
    if (action === "saveBreakfastItem") {
      if (!isAdmin) return jsonRes({error:"STRICT ADMIN PIN REQUIRED"});
      return jsonRes(saveBreakfastItem(body));
    }
    if (action === "deleteSabjiItem") {
      if (!isAdmin) return jsonRes({error:"STRICT ADMIN PIN REQUIRED"});
      return jsonRes(deleteSabjiItem(body.id));
    }
    if (action === "seedTestData") {
      if (!isAdmin) return jsonRes({error:"STRICT ADMIN PIN REQUIRED"});
      return jsonRes({success:true, message: seedTestData()});
    }
    if (action === "saveSabjiItem") {
      if (!isAdmin) return jsonRes({error:"STRICT ADMIN PIN REQUIRED"});
      return jsonRes(saveSabjiItem(body));
    }
    if (action === "saveLabels") {
      // Label PDF upload — allow kitchen PIN too, since the matching
      // getLabelOrders endpoint already accepts staff. Without this,
      // kitchen-PIN users could fetch the orders but got "permission
      // required" when actually saving the PDF.
      if (!isStaff) return jsonRes({error:"STRICT STAFF PIN REQUIRED"});
      return jsonRes(saveLabels(body));
    }
    if (action === "setLabelGap") {
      // Single global label-gap value, shared across every kitchen device.
      // Any staff can write (intentional — gap is a printer/paper-size
      // calibration, not a sensitive setting).
      if (!isStaff) return jsonRes({error:"STRICT STAFF PIN REQUIRED"});
      const v = Number(body.gap_mm);
      if (!isFinite(v) || v < 0 || v > 20) {
        return jsonRes({success: false, error: "Invalid gap value (must be 0–20 mm)"});
      }
      SP.setProperty("LABEL_GAP_MM", String(v));
      return jsonRes({success: true, gap_mm: v});
    }
    if (action === "markCustomersPaid") {
      if (!isAdmin) return jsonRes({error:"Invalid PIN"});
      return jsonRes(markCustomersPaid(body));
    }
    if (action === "markOrdersStatus") {
      if (!isAdmin) return jsonRes({error:"Invalid PIN"});
      return jsonRes(markOrdersStatus(body));
    }
    if (action === "markOnAccount") {
      if (!isAdmin) return jsonRes({error:"STRICT ADMIN PIN REQUIRED"});
      return jsonRes(markOnAccount(body.phone, body.cycle, body.status));
    }
    if (action === "verifyAdminPin") return jsonRes({success: isAdmin});
    if (action === "reconcileTransactions") {
      if (!isAdmin) return jsonRes({error:"STRICT ADMIN PIN REQUIRED"});
      return jsonRes(reconcileTransactions(body));
    }
    if (action === "markOrdersPaidBulk") {
      if (!isAdmin) return jsonRes({error:"STRICT ADMIN PIN REQUIRED"});
      return jsonRes(markOrdersPaidBulk(body));
    }
    if (action === "getBillingData") {
      if (!isAdmin) return jsonRes({error:"STRICT ADMIN PIN REQUIRED"});
      return jsonRes(getBillingData(body.cycle, body.filterValue));
    }
    if (action === "markBillingCollected") {
      if (!isAdmin) return jsonRes({error:"STRICT ADMIN PIN REQUIRED"});
      return jsonRes(markBillingCollected(body.submissionIds));
    }
    if (action === "getAttendanceData") {
      if (!isAdmin) return jsonRes({error:"STRICT ADMIN PIN REQUIRED"});
      return jsonRes(getAttendanceData(body.month, body.date));
    }
    if (action === "markAttendance") {
      if (!isAdmin) return jsonRes({error:"STRICT ADMIN PIN REQUIRED"});
      return jsonRes(markAttendance(body.name, body.date, body.status, body.reason));
    }
    if (action === "addIncentive") {
      if (!isAdmin) return jsonRes({error:"STRICT ADMIN PIN REQUIRED"});
      return jsonRes(addIncentive(body.name, body.date, body.amount, body.note));
    }
    if (action === "addDeduction") {
      if (!isAdmin) return jsonRes({error:"STRICT ADMIN PIN REQUIRED"});
      return jsonRes(addDeduction(body.name, body.date, body.amount, body.note));
    }
    if (action === "markSalaryCredited") {
      if (!isAdmin) return jsonRes({error:"STRICT ADMIN PIN REQUIRED"});
      return jsonRes(markSalaryCredited(body.name, body.period, body.amount));
    }
    if (action === "updateStaff") {
      if (!isAdmin) return jsonRes({error:"STRICT ADMIN PIN REQUIRED"});
      return jsonRes(updateStaff(body.name, body.fields));
    }
    if (action === "undoMarkPaid") {
      if (!isAdmin) return jsonRes({error:"STRICT ADMIN PIN REQUIRED"});
      return jsonRes(undoMarkPaid(body.submissionIds));
    }
    if (action === "saveArea") {
      if (!isAdmin) return jsonRes({error:"STRICT ADMIN PIN REQUIRED"});
      return jsonRes(saveArea(body));
    }
    if (action === "deleteArea") {
      if (!isAdmin) return jsonRes({error:"STRICT ADMIN PIN REQUIRED"});
      return jsonRes(deleteArea(body));
    }
    if (action === "markCustomersPaid") {
      if (!isAdmin) return jsonRes({error:"Invalid PIN"});
      return jsonRes(markCustomersPaid(body));
    }
    if (action === "markOrdersStatus") {
      if (!isAdmin) return jsonRes({error:"Invalid PIN"});
      return jsonRes(markOrdersStatus(body));
    }
    if (action === "getReviews") return jsonRes(getReviews());
    if (action === "chat") return jsonRes(handleChat(body));
    if (action === "submitWalletRecharge") return jsonRes(submitWalletRecharge(body));
    if (action === "markRefundRejected") {
      if (!isAdmin) return jsonRes({error:"STRICT ADMIN PIN REQUIRED"});
      return jsonRes(markRefundRejected(body.submissionId));
    }
    if (action === "rejectUPIPayment") {
      if (!isAdmin) return jsonRes({error:"STRICT ADMIN PIN REQUIRED"});
      return jsonRes(rejectUPIPayment(body));
    }
    if (action === "adminCreditWallet") {
      if (!isAdmin) return jsonRes({error:"STRICT ADMIN PIN REQUIRED"});
      return jsonRes(adminCreditWallet(body));
    }
    if (action === "adminResetPin") {
      if (!isAdmin) return jsonRes({error:"STRICT ADMIN PIN REQUIRED"});
      return jsonRes(adminResetPin(body));
    }
    if (action === "rejectWalletRecharge") {
      if (!isAdmin) return jsonRes({error:"STRICT ADMIN PIN REQUIRED"});
      return jsonRes(rejectWalletRecharge(body));
    }
    if (action === "batchProcessApprovals") {
      if (!isAdmin) return jsonRes({error:"STRICT ADMIN PIN REQUIRED"});
      return jsonRes(batchProcessApprovals(body));
    }
    if (action === "saveInventoryEntry") {
      if (!isAdmin) return jsonRes({error:"STRICT ADMIN PIN REQUIRED"});
      return jsonRes(saveInventoryEntry(body));
    }
    if (action === "deleteInventoryEntry") {
      if (!isAdmin) return jsonRes({error:"STRICT ADMIN PIN REQUIRED"});
      return jsonRes(deleteInventoryEntry(body));
    }
    if (action === "saveCustomExpenseCategory") {
      if (!isAdmin) return jsonRes({error:"STRICT ADMIN PIN REQUIRED"});
      return jsonRes(saveCustomExpenseCategory(body));
    }
    if (action === "deleteCustomExpenseCategory") {
      if (!isAdmin) return jsonRes({error:"STRICT ADMIN PIN REQUIRED"});
      return jsonRes(deleteCustomExpenseCategory(body));
    }
    if (action === "saveExpense") {
      if (!isAdmin) return jsonRes({error:"STRICT ADMIN PIN REQUIRED"});
      return jsonRes(saveExpense(body));
    }
    if (action === "deleteExpense") {
      if (!isAdmin) return jsonRes({error:"STRICT ADMIN PIN REQUIRED"});
      return jsonRes(deleteExpense(body));
    }
    if (action === "triggerManualArchive") {
      if (!isAdmin) return jsonRes({error:"STRICT ADMIN PIN REQUIRED"});
      return jsonRes(triggerManualArchive(body));
    }
    if (action === "setupQuarterlyArchiveTrigger") {
      if (!isAdmin) return jsonRes({error:"STRICT ADMIN PIN REQUIRED"});
      try { setupQuarterlyArchiveTrigger(); return jsonRes({success:true}); }
      catch(e) { return jsonRes({success:false, error:e.message}); }
    }
    if (action === "setupAutoDeliveredTrigger") {
      if (!isAdmin) return jsonRes({error:"STRICT ADMIN PIN REQUIRED"});
      try { return jsonRes({success:true, message: setupAutoDeliveredTrigger()}); }
      catch(e) { return jsonRes({success:false, error:e.message}); }
    }

    if (action === "setPin") {
      const profile = { phone: body.phone, pin: body.pin };
      _upsertCustomer(getSpreadsheet(), profile);
      return jsonRes({success:true});
    }

    if (action === "saveMenu") {
      if (!isAdmin) return jsonRes({error:"STRICT ADMIN PIN REQUIRED"});
      return jsonRes(saveMenu(body));
    }

    if (action === "upsertProfile") {
      // Capture PIN if provided during mid-flow profile upserts
      const profile = { ...body, pin: body.pin || "" };
      _upsertCustomer(getSpreadsheet(), profile);
      return jsonRes({success:true});
    }

    if (action === "submitManualOrder") {
      if (!isAdmin) return jsonRes({error:"STRICT ADMIN PIN REQUIRED"});
      return jsonRes(submitManualOrder(body));
    }

    // Client error logging (timeout / network failures reported by frontend)
    if (action === "logClientError") return jsonRes(logClientError(body));

    // ── HDFC PAYMENT GATEWAY ACTIONS ─────────────────────────
    // All gateway actions are gated by PAYMENT_GATEWAY_ENABLED.
    // The webhook action is the only one that uses its own auth (Basic Auth
    // from HDFC's server), not the customer or admin PIN.

    if (action === "hdfc_createSession") {
      if (!PAYMENT_GATEWAY_ENABLED) return jsonRes({error:"Payment gateway not enabled."});
      return jsonRes(hdfc_createSession(body));
    }
    if (action === "hdfc_savePendingOrder") return jsonRes(hdfc_savePendingOrder(body));
    if (action === "hdfc_getPendingOrder")  return jsonRes(hdfc_getPendingOrder(body));

    if (action === "hdfc_webhook") {
      // HDFC posts to this URL with Basic Auth — verify credentials first
      if (!PAYMENT_GATEWAY_ENABLED) return jsonRes({error:"Payment gateway not enabled."});
      return jsonRes(hdfc_handleWebhook(body, e));
    }

    // ── HDFC Webhook auto-detect ───────────────────────────────
    // HDFC's server-side webhook POST will NOT contain _action.
    // Detect by presence of event_name (Juspay webhook signature field).
    if (!action && (body.event_name || (body.content && body.content.order))) {
      console.log("HDFC Webhook auto-detected, event:", body.event_name);
      if (!PAYMENT_GATEWAY_ENABLED) return jsonRes({error:"Payment gateway not enabled."});
      return jsonRes(hdfc_handleWebhook(body, e));
    }

    if (action === "hdfc_verifyReturn") {
      // Called by order.html when customer lands back after payment
      if (!PAYMENT_GATEWAY_ENABLED) return jsonRes({error:"Payment gateway not enabled."});
      return jsonRes(hdfc_verifyReturnPayload(body));
    }
    // ─────────────────────────────────────────────────────────

    // ── IntentAmplify (corporate channel) — POST ───────────────
    if (action === "ia_register")    return jsonRes(ia_register(body));
    if (action === "ia_submitOrder") return jsonRes(ia_submitOrder(body));
    if (action === "ia_setMenu")     return jsonRes(ia_setMenu(body));
    if (action === "ia_approve")     return jsonRes(ia_approve(body));
    if (action === "ia_resetPin")    return jsonRes(ia_resetPin(body));
    if (action === "ia_markDelivered")    return jsonRes(ia_markDelivered(body));
    if (action === "ia_batchMarkEnRoute") return jsonRes(ia_batchMarkEnRoute(body));

    // Regular order submission — the ONLY POST with no _action. Anything else
    // (unknown/typo'd actions, malformed debug payloads) must NOT fall through
    // to submitOrder: that used to return {success:true, submissionId:""} for a
    // body with no orders — a phantom "success" with nothing written.
    if (action === "" && Array.isArray(body.orders) && body.orders.length) {
      return jsonRes(submitOrder(body));
    }
    return jsonRes({ error: "Unknown action" + (action ? ": '" + action + "'" : " (no orders payload)") });
  } catch(err) {
    return jsonRes({error: err.message});
  }
}

function jsonRes(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
// ── GOOGLE ANALYTICS 4 INTEGRATION ──────────────────────────
const GA4_HEADERS = ["Date", "Source", "Device", "Active_Users", "Sessions", "Page_Views", "Engagement_Rate", "Avg_Session_Duration", "Event_Count"];

/**
 * Fetches the last 30 days of traffic metrics from GA4 and stores them in the sheet.
 * Includes breakdown by Source and Device.
 * Requires "Google Analytics Data API" service to be enabled in Apps Script.
 */
function syncGA4Data() {
  const propertyId = GA4_PROPERTY_ID;
  if (!propertyId) return "Error: GA4_PROPERTY_ID not set.";

  const request = {
    dimensions: [
      { name: 'date' },
      { name: 'sessionSource' },
      { name: 'deviceCategory' }
    ],
    metrics: [
      { name: 'activeUsers' },
      { name: 'sessions' },
      { name: 'screenPageViews' },
      { name: 'engagementRate' },
      { name: 'averageSessionDuration' },
      { name: 'eventCount' }
    ],
    dateRanges: [{ startDate: '30daysAgo', endDate: 'today' }]
  };

  try {
    const response = AnalyticsData.Properties.runReport(request, 'properties/' + propertyId);
    if (!response.rows || response.rows.length === 0) return "No data found in GA4.";

    const ss = getSpreadsheet();
    const ws = getOrCreateTab(ss, TAB_GA4_METRICS, GA4_HEADERS);
    
    // Snapshot approach: overwrite the tab with the latest window
    if (ws.getLastRow() > 1) {
      ws.getRange(2, 1, ws.getLastRow() - 1, GA4_HEADERS.length).clearContent();
    }

    const rows = response.rows.map(row => {
      // Format YYYYMMDD to YYYY-MM-DD
      const rawDate = row.dimensionValues[0].value;
      const formattedDate = rawDate.substring(0,4) + "-" + rawDate.substring(4,6) + "-" + rawDate.substring(6,8);
      
      return [
        formattedDate,
        row.dimensionValues[1].value, // Source
        row.dimensionValues[2].value, // Device
        ...row.metricValues.map(mv => mv.value)
      ];
    });
    
    // Sort by date descending, then source
    rows.sort((a, b) => {
      if (a[0] !== b[0]) return b[0].localeCompare(a[0]);
      return a[1].localeCompare(b[1]);
    });

    if (rows.length > 0) {
      ws.getRange(2, 1, rows.length, GA4_HEADERS.length).setValues(rows);
    }
    
    return "Successfully synced " + rows.length + " data points (Date/Source/Device combinations).";
  } catch (e) {
    console.error("GA4 Sync Error:", e);
    return "Error: " + e.message;
  }
}

/**
 * Setup a daily trigger to sync GA4 data automatically at 1 AM.
 */
function setupAnalyticsTrigger() {
  // Remove existing triggers for this function to avoid duplicates
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(t => {
    if (t.getHandlerFunction() === 'syncGA4Data') ScriptApp.deleteTrigger(t);
  });
  
  // Create new daily trigger
  ScriptApp.newTrigger('syncGA4Data')
    .timeBased()
    .everyDays(1)
    .atHour(1)
    .create();
    
  return "Daily GA4 sync trigger set for 1:00 AM.";
}

// ── HELPERS ──────────────────────────────────────────────────
function getSpreadsheet() {
  return SpreadsheetApp.openById(SHEET_ID);
}

function getOrCreateTab(ss, name, headers) {
  let ws = ss.getSheetByName(name);
  const isNew = !ws;
  if (!ws) {
    ws = ss.insertSheet(name);
  }

  if (headers && headers.length > 0) {
    const lastCol = ws.getLastColumn();

    if (isNew || lastCol === 0) {
      // Brand-new / empty sheet → write the full header row once.
      ws.getRange(1, 1, 1, headers.length).setValues([headers]);
      ws.getRange(1, 1, 1, headers.length)
        .setFontWeight("bold").setBackground("#c0392b").setFontColor("white");
      ws.setFrozenRows(1);
      headers.forEach((h, i) => {
        if (h === "Phone" || h === "PIN") ws.getRange(1, i + 1, ws.getMaxRows(), 1).setNumberFormat("@");
      });
    } else {
      // ── EXISTING POPULATED SHEET — NON-DESTRUCTIVE ────────────────────────
      // NEVER rename/reposition existing headers, and NEVER delete columns.
      // The old code forced row 1 to equal `headers` BY POSITION and deleted
      // any extra columns — when a live sheet's real column order differed from
      // the constant (even by one), that relabelled columns onto the wrong data
      // and physically wiped real order data (Submitted_At / Order_Date) during
      // archive. We now only APPEND headers that are genuinely absent, as new
      // trailing columns. Anything else is left exactly as it is.
      const current = ws.getRange(1, 1, 1, lastCol).getValues()[0].map(h => String(h || "").trim());
      const have = {};
      current.forEach(h => { if (h) have[h] = true; });
      headers.forEach(h => {
        if (h && !have[h]) {
          const col = ws.getLastColumn() + 1;
          ws.getRange(1, col).setValue(h).setFontWeight("bold").setBackground("#c0392b").setFontColor("white");
          if (h === "Phone" || h === "PIN") ws.getRange(1, col, ws.getMaxRows(), 1).setNumberFormat("@");
          have[h] = true;
        }
      });
    }
  }
  return ws;
}

// ── KITCHEN SUMMARY ──────────────────────────────────────────
function getKitchenSummary(date) {
  var ss = getSpreadsheet();
  var ws = getOrCreateTab(ss, TAB_ORDERS, []);
  // Merge IntentAmplify orders (tagged [IA], S4 address) into the same prep view.
  var rows = getRecentRows(ws, 1500).concat(typeof ia_rowsAsSK === "function" ? ia_rowsAsSK() : []);

  var dayRows = rows.filter(function(r) {
    var d = r.Order_Date instanceof Date
      ? Utilities.formatDate(r.Order_Date, "Asia/Kolkata", "yyyy-MM-dd")
      : String(r.Order_Date).trim();
    return d === date;
  });

  var meals = {};
  var ROTI_COLS = ["Chapati","Without_Oil_Chapati","Phulka","Ghee_Phulka","Jowar_Bhakri","Bajra_Bhakri"];
  var ROTI_LIMITS = {
    "Chapati":6, "Without_Oil_Chapati":6,
    "Phulka":12, "Ghee_Phulka":12,
    "Jowar_Bhakri":2, "Bajra_Bhakri":2
  };
  var menu = getMenu(date);

  var orders = [];

  dayRows.forEach(function(r) {
    if (_isOrderCancelled(r.Payment_Status)) return; // exclude cancelled/verify-pending orders
    var meal = String(r.Meal_Type || "");
    if (!meal) return;
    if (!meals[meal]) meals[meal] = {count: 0};
    var m = meals[meal];
    m.count++;

    // For Labels Tab
    var summaryParts = [];
    if (meal === "Breakfast") {
      if (!m.items) m.items = {};
      var bfHasCurdSlot = false;
      for (var n = 1; n <= 4; n++) {
        var item = String(r["BF_Item_"+n] || "").trim();
        var qty  = Number(r["BF_Qty_"+n]) || 0;
        if (item && qty > 0) {
          m.items[item] = (m.items[item] || 0) + qty;
          summaryParts.push(qty + " " + item);
          if (item === "Curd") bfHasCurdSlot = true;
        }
      }
      // Dedupe: submitOrder writes Curd to BOTH BF_Item_N and Curd column.
      var curdBf = Number(r.Curd) || 0;
      if (curdBf > 0 && !bfHasCurdSlot) {
        m.items["Curd"] = (m.items["Curd"] || 0) + curdBf;
        summaryParts.push(curdBf + " Curd");
      }
    } else {
      if (!m.rotis) m.rotis = {};
      if (!m.rotiMatrix) {
        m.rotiMatrix = {};
        ROTI_COLS.forEach(function(c) { m.rotiMatrix[c] = {}; });
      }
      ROTI_COLS.forEach(function(c) {
        var q = Number(r[c]) || 0;
        if (q > 0) {
          m.rotis[c] = (m.rotis[c] || 0) + q;
          summaryParts.push(q + " " + c.replace(/_/g, " "));
          var packs = calculatePackets(q, ROTI_LIMITS[c]);
          packs.forEach(function(p) {
            m.rotiMatrix[c][p] = (m.rotiMatrix[c][p] || 0) + 1;
          });
        }
      });
      if (!m.sabji) {
        m.sabji = {
          dry_kg: 0, curry_kg: 0,
          dry_name: (meal === "Lunch" ? menu.lunch_dry : menu.dinner_dry) || "Sabji (Dry)",
          curry_name: (meal === "Lunch" ? menu.lunch_curry : menu.dinner_curry) || "Sabji (Curry)",
          dry_mini: 0, dry_full: 0, curry_mini: 0, curry_full: 0
        };
      }
      var dMini = Number(r.Dry_Sabji_Mini)||0;
      var dFull = Number(r.Dry_Sabji_Full)||0;
      var cMini = Number(r.Curry_Sabji_Mini)||0;
      var cFull = Number(r.Curry_Sabji_Full)||0;
      m.sabji.dry_mini  += dMini;
      m.sabji.dry_full  += dFull;
      m.sabji.curry_mini += cMini;
      m.sabji.curry_full += cFull;
      
      if (dMini > 0) summaryParts.push(dMini + " Mini Dry");
      if (dFull > 0) summaryParts.push(dFull + " Full Dry");
      if (cMini > 0) summaryParts.push(cMini + " Mini Curry");
      if (cFull > 0) summaryParts.push(cFull + " Full Curry");

      if (!m.other) m.other = {Dal:{kg:0, count:0}, Rice:{count:0}, Salad:{count:0}, Curd:{count:0}};
      if (!m.riceMatrix)  m.riceMatrix  = {};
      if (!m.saladMatrix) m.saladMatrix = {};
      if (!m.curdMatrix)  m.curdMatrix  = {};

      var dalQ = Number(r.Dal)   || 0;
      var riceQ = Number(r.Rice)  || 0;
      var saladQ = Number(r.Salad) || 0;
      var curdQ = Number(r.Curd)  || 0;
      
      m.other.Dal.kg      += dalQ * 1.33;
      m.other.Dal.count   += dalQ;
      m.other.Rice.count  += riceQ;
      m.other.Salad.count += saladQ;
      m.other.Curd.count  += curdQ;

      // Matrix calculations
      if (riceQ > 0) {
        var rPacks = calculatePackets(riceQ, 3); // RICE_LIMIT = 3
        rPacks.forEach(function(p) { m.riceMatrix[p] = (m.riceMatrix[p] || 0) + 1; });
      }
      if (saladQ > 0) {
        var sPacks = calculatePackets(saladQ, 4); // SALAD_LIMIT = 4
        sPacks.forEach(function(p) { m.saladMatrix[p] = (m.saladMatrix[p] || 0) + 1; });
      }
      if (curdQ > 0) {
        var cPacks = calculatePackets(curdQ, 2); // CURD_LIMIT = 2 (50g cups: 1 or 2 per packet)
        cPacks.forEach(function(p) { m.curdMatrix[p] = (m.curdMatrix[p] || 0) + 1; });
      }

      if (dalQ > 0) summaryParts.push(dalQ + " Dal");
      if (riceQ > 0) summaryParts.push(riceQ + " Rice");
      if (saladQ > 0) summaryParts.push(saladQ + " Salad");
      if (curdQ > 0) summaryParts.push(curdQ + " Curd");

      // Cross-meal: backend admin sometimes places breakfast items in a
      // Lunch/Dinner order (e.g. Poha/Upma) or writes Chapati via BF_Item
      // slots. Surface them under m.extras so the kitchen UI can show them.
      if (!m.extras) m.extras = {};
      for (var bn = 1; bn <= 4; bn++) {
        var bItem = String(r["BF_Item_"+bn] || "").trim();
        var bQty  = Number(r["BF_Qty_"+bn]) || 0;
        if (!bItem || bQty <= 0) continue;
        // If it matches a roti column name, fold into roti aggregation.
        if (ROTI_COLS.indexOf(bItem) >= 0 || ROTI_COLS.indexOf(bItem.replace(/ /g,"_")) >= 0) {
          var rotiCol = (ROTI_COLS.indexOf(bItem) >= 0) ? bItem : bItem.replace(/ /g,"_");
          m.rotis[rotiCol] = (m.rotis[rotiCol] || 0) + bQty;
          var packsX = calculatePackets(bQty, ROTI_LIMITS[rotiCol]);
          packsX.forEach(function(p) { m.rotiMatrix[rotiCol][p] = (m.rotiMatrix[rotiCol][p] || 0) + 1; });
          summaryParts.push(bQty + " " + rotiCol.replace(/_/g," "));
        } else if (bItem === "Curd") {
          m.other.Curd.count += bQty;
          var cPacksX = calculatePackets(bQty, 2);
          cPacksX.forEach(function(p) { m.curdMatrix[p] = (m.curdMatrix[p] || 0) + 1; });
          summaryParts.push(bQty + " Curd");
        } else {
          // True breakfast-style item placed in lunch/dinner — Poha, Upma, etc.
          m.extras[bItem] = (m.extras[bItem] || 0) + bQty;
          summaryParts.push(bQty + " " + bItem);
        }
      }
    }

    orders.push({
      Submission_ID: String(r.Submission_ID || ""),
      Customer_Name: String(r.Customer_Name || ""),
      Meal_Type: meal,
      summary: summaryParts.join(", "),
      items: {
        Chapati: Number(r.Chapati)||0, Without_Oil_Chapati: Number(r.Without_Oil_Chapati)||0,
        Phulka: Number(r.Phulka)||0, Ghee_Phulka: Number(r.Ghee_Phulka)||0,
        Jowar_Bhakri: Number(r.Jowar_Bhakri)||0, Bajra_Bhakri: Number(r.Bajra_Bhakri)||0,
        Dry_Sabji_Mini: Number(r.Dry_Sabji_Mini)||0, Dry_Sabji_Full: Number(r.Dry_Sabji_Full)||0,
        Curry_Sabji_Mini: Number(r.Curry_Sabji_Mini)||0, Curry_Sabji_Full: Number(r.Curry_Sabji_Full)||0,
        Dal: Number(r.Dal)||0, Rice: Number(r.Rice)||0, Salad: Number(r.Salad)||0, Curd: Number(r.Curd)||0,
        "Kanda Poha": Number(r["Kanda Poha"])||0, "Ghee Upma": Number(r["Ghee Upma"])||0,
        "Thalipeeth": Number(r["Thalipeeth"])||0, "Palak Paratha": Number(r["Palak Paratha"])||0,
        "Paneer Paratha": Number(r["Paneer Paratha"])||0, "Methi Thepla": Number(r["Methi Thepla"])||0,
        "Sabudana Khichdi": Number(r["Sabudana Khichdi"])||0
      },
      Special_Notes_Kitchen: String(r.Special_Notes_Kitchen || ""),
      Special_Notes_Delivery: String(r.Special_Notes_Delivery || ""),
      Delivery_Point: String(r.Delivery_Point || ""),
      marathiNotes: String(r.marathiNotes || ""),
      Packed: r.Packed === true || String(r.Packed).toLowerCase() === "true"
    });
  });

  ["Lunch","Dinner"].forEach(function(meal) {
    if (!meals[meal]) return;
    var m = meals[meal];
    if (m.other && m.other.Dal) m.other.Dal.kg = Math.round(m.other.Dal.kg * 100) / 100;
  });

  return {
    date: date,
    meals: meals,
    orders: orders,
    cutoffs: menu.cutoff_overrides || {}
  };
}

// ── DRIVER ORDERS ─────────────────────────────────────────────
function getDriverOrders(date) {
  var ss   = getSpreadsheet();
  var ws   = getOrCreateTab(ss, TAB_ORDERS, []);
  // Merge IntentAmplify orders (tagged [IA], S4 delivery) into the driver view.
  var rows = getRecentRows(ws, 1500).concat(typeof ia_rowsAsSK === "function" ? ia_rowsAsSK() : []);
  var meals = {Breakfast: [], Lunch: [], Dinner: []};

  // Load delivery status from SK_Deliveries tab (both EnRoute_At and Delivered_At)
  var delMap = {};
  var delWs  = ss.getSheetByName("SK_Deliveries");
  if (delWs) {
    getRecentRows(delWs, 1500).forEach(function(r) {
      var sid = String(r.Submission_ID || "").trim();
      if (sid) delMap[sid] = {
        deliveredAt: String(r.Delivered_At || ""),
        enRouteAt:   String(r.EnRoute_At   || "")
      };
    });
  }

  // Load customer meal preferences (Source of Truth)
  var custMap = {};
  var custWs = ss.getSheetByName(TAB_CUSTOMERS);
  if (custWs) {
    getAllRows(custWs).forEach(function(r) {
      var ph = _normalizePhone(r.Phone);
      if (ph) {
        custMap[ph] = {
          mealAddresses: r.Meal_Addresses || ""
        };
      }
    });
  }

  rows.forEach(function(r) {
    var d = r.Order_Date instanceof Date
      ? Utilities.formatDate(r.Order_Date, "Asia/Kolkata", "yyyy-MM-dd")
      : String(r.Order_Date).trim();
    if (d !== date) return;
    if (_isOrderCancelled(r.Payment_Status)) return;
    // var area = String(r.Area || "").trim();
    // if (area.toLowerCase().includes("pickup")) return;
    var area = String(r.Area || "").trim();
    var meal = String(r.Meal_Type || "");
    if (!meals[meal]) return;
    var sid = String(r.Submission_ID || "");
    var normP = _normalizePhone(r.Phone);
    meals[meal].push({
      submissionId:  sid,
      name:          String(r.Customer_Name || ""),
      phone:         String(r.Phone || ""),
      area:          area,
      society:       String(r.Society || ""),
      wing:          String(r.Wing || ""),
      flat:          String(r.Flat || ""),
      address:       String(r.Full_Address || ""),
      landmark:      String(r.Landmark || ""),
      deliveryPoint: String(r.Delivery_Point || ""),
      maps:          String(r.Maps_Link || ""),
      notes:         String(r.Special_Notes_Delivery || ""),
      deliveredAt:   (delMap[sid] && delMap[sid].deliveredAt) || "",
      enRouteAt:     (delMap[sid] && delMap[sid].enRouteAt)   || "",
      amount:        Number(r.Net_Total || r.Food_Subtotal || 0),
      paymentStatus: String(r.Payment_Status || ""),
      mealAddresses: custMap[normP] ? custMap[normP].mealAddresses : ""
    });
  });



  return {date: date, meals: meals};
}

// ════════════════════════════════════════════════════════════════════
// DELIVERY ROUTE LEARNING
// Learns the driver's preferred stop order from the sequence in which he
// marks orders delivered (SK_Deliveries.Delivered_At timestamps), grouped
// by Society/building, separately per meal. The driver page then sorts
// undelivered orders by this learned order so deliveries follow his route.
// ════════════════════════════════════════════════════════════════════

// Canonical grouping key for an order row: Society, falling back to Area.
function _routeSocietyKey(r) {
  var s = String((r && (r.Society !== undefined ? r.Society : r.society)) || "").trim();
  if (!s) s = String((r && (r.Area !== undefined ? r.Area : r.area)) || "").trim();
  return s.toLowerCase().replace(/\s+/g, " ");
}

// Each meal stores its learned route in its OWN tab, since the driver can take a
// different route for Breakfast vs Lunch vs Dinner.
var ROUTE_MEALS = ["Breakfast", "Lunch", "Dinner"];
function _routeTabName(meal) { return "SK_Delivery_Route_" + meal; }

// Trusted data window for route learning (by Order_Date, inclusive). Deliveries
// OUTSIDE this range are ignored — data before 5 Jun 2026 was unreliable and
// would corrupt the learned route. Update these two dates to shift the window.
var ROUTE_DATA_FROM = "2026-06-05";
var ROUTE_DATA_TO   = "2026-07-04";

// Rebuild the SK_Delivery_Route config from the last `days` (default 30) of
// delivered orders. Non-destructive to orders; only rewrites the route tab.
function buildDeliveryRoute(days) {
  try {
    days = Number(days) > 0 ? Number(days) : 30;
    var ss = getSpreadsheet();
    var ordersWs = getOrCreateTab(ss, TAB_ORDERS, ORDERS_HEADERS);
    var delWs    = getOrCreateTab(ss, "SK_Deliveries", ["Submission_ID", "Delivered_At", "EnRoute_At"]);

    // submissionId → deliveredAt (ms)
    var delMap = {};
    getAllRows(delWs).forEach(function (d) {
      var sid = String(d.Submission_ID || "").trim();
      var da  = d.Delivered_At;
      if (!sid || !da) return;
      var ms = (da instanceof Date) ? da.getTime() : new Date(da).getTime();
      if (!isNaN(ms)) delMap[sid] = ms;
    });

    var now = getISTDate();

    // meal → orderDate → [{ soc, t }]
    var byMealDay = {};
    getAllRows(ordersWs).forEach(function (r) {
      var sid = String(r.Submission_ID || "").trim();
      var t   = delMap[sid];
      if (!t) return; // must have been delivered (has a Delivered_At timestamp)
      if (_isOrderCancelled(r.Payment_Status)) return;
      var meal = String(r.Meal_Type || "").trim();
      if (!meal) return;
      var soc = _routeSocietyKey(r);
      if (!soc) return;
      var od = (r.Order_Date instanceof Date)
        ? Utilities.formatDate(r.Order_Date, "Asia/Kolkata", "yyyy-MM-dd")
        : String(r.Order_Date).trim();
      // Only learn from the trusted data window — ignore earlier (bad) data.
      if (od < ROUTE_DATA_FROM || od > ROUTE_DATA_TO) return;
      byMealDay[meal] = byMealDay[meal] || {};
      byMealDay[meal][od] = byMealDay[meal][od] || [];
      byMealDay[meal][od].push({ soc: soc, t: t });
    });

    // Per-meal rows: meal → [ [Society, Rank, Avg_Position, Samples], ... ]
    var byMealRows = {};
    Object.keys(byMealDay).forEach(function (meal) {
      var posAcc = {}; // soc → [normalized positions 0..1]
      var daysObj = byMealDay[meal];
      Object.keys(daysObj).forEach(function (od) {
        var list = daysObj[od].slice().sort(function (a, b) { return a.t - b.t; });
        var n = list.length;
        // First occurrence position per society that day (dedupe repeats).
        var seen = {};
        list.forEach(function (item, idx) {
          if (seen[item.soc] === undefined) seen[item.soc] = (n > 1) ? idx / (n - 1) : 0;
        });
        Object.keys(seen).forEach(function (soc) {
          (posAcc[soc] = posAcc[soc] || []).push(seen[soc]);
        });
      });
      var stats = Object.keys(posAcc).map(function (soc) {
        var arr = posAcc[soc].slice().sort(function (a, b) { return a - b; });
        var mid = Math.floor(arr.length / 2);
        var med = (arr.length % 2) ? arr[mid] : (arr[mid - 1] + arr[mid]) / 2;
        return { soc: soc, med: med, samples: arr.length };
      });
      // Earlier median position → earlier in route. Ties: more samples first.
      stats.sort(function (a, b) { return (a.med - b.med) || (b.samples - a.samples); });
      byMealRows[meal] = stats.map(function (s, i) {
        return [s.soc, i + 1, Math.round(s.med * 1000) / 1000, s.samples];
      });
    });

    // Write each meal to ITS OWN tab (SK_Delivery_Route_Breakfast/_Lunch/_Dinner).
    // One common rebuild, but stored & retrieved per meal type. Empty meals are
    // cleared too, so a meal with no recent deliveries shows a blank tab.
    var headers = ["Society", "Rank", "Avg_Position", "Samples", "Updated"];
    var stamp = Utilities.formatDate(now, "Asia/Kolkata", "yyyy-MM-dd HH:mm");
    var total = 0;
    var perMeal = {};
    ROUTE_MEALS.forEach(function (meal) {
      var ws = getOrCreateTab(ss, _routeTabName(meal), headers);
      if (ws.getLastRow() > 1) ws.getRange(2, 1, ws.getLastRow() - 1, headers.length).clearContent();
      var rows = byMealRows[meal] || [];
      var out = rows.map(function (row) { return row.concat([stamp]); });
      if (out.length) ws.getRange(2, 1, out.length, headers.length).setValues(out);
      total += out.length;
      perMeal[meal] = out.length;
    });

    return { success: true, from: ROUTE_DATA_FROM, to: ROUTE_DATA_TO, count: total, perMeal: perMeal, updated: stamp };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

// Returns the learned route as { meal: { societyKey: rank } } for the driver page,
// reading each meal from its own per-meal tab.
function getDeliveryRoute() {
  try {
    var ss = getSpreadsheet();
    var headers = ["Society", "Rank", "Avg_Position", "Samples", "Updated"];
    var map = {};
    var updated = "";
    ROUTE_MEALS.forEach(function (meal) {
      var ws = getOrCreateTab(ss, _routeTabName(meal), headers);
      map[meal] = {};
      getAllRows(ws).forEach(function (r) {
        var soc  = String(r.Society || "").trim().toLowerCase().replace(/\s+/g, " ");
        var rank = Number(r.Rank || 0);
        if (!soc || !rank) return;
        map[meal][soc] = rank;
        if (r.Updated) updated = String(r.Updated);
      });
    });
    return { success: true, route: map, updated: updated };
  } catch (e) {
    return { success: false, route: {}, error: String(e) };
  }
}

// ════════════════════════════════════════════════════════════════════
// STAFF ATTENDANCE & SALARY  (payroll module)
//  SK_Staff      : roster + pay config (auto-seeded). Paid_Leaves = number of
//                  free (non-deducted) leaves allowed per month before the
//                  per-day deduction kicks in.
//  SK_Attendance : EXCEPTIONS only — a row exists when a day is marked ABSENT,
//                  carries an INCENTIVE (+ bonus) or a DEDUCTION (− advance/
//                  fine), and/or a Note (leave reason / memo). No row = present.
//  SK_Salary_Log : records when a salary/wage was credited (clears the alert
//                  AND forms each staff's pay history).
//  Monthly: per-day = salary / days-in-month; non-Sunday leaves BEYOND the
//  Paid_Leaves allowance each deduct one per-day. Daily (Abhijeet): weekday/Sat
//  rates, Sun off, paid weekly.
// ════════════════════════════════════════════════════════════════════
var ATT_STAFF_TAB = "SK_Staff", ATT_REC_TAB = "SK_Attendance", ATT_SAL_TAB = "SK_Salary_Log";
var ATT_STAFF_HEADERS = ["Name","Type","Monthly_Salary","Pay_Day","Pay_Cycle","Weekday_Rate","Saturday_Rate","Sunday_Rate","Paid_Leaves","Active"];
var ATT_REC_HEADERS   = ["Date","Staff_Name","Status","Incentive","Deduction","Note","Updated"];
var ATT_SAL_HEADERS   = ["Staff_Name","Period","Amount","Credited_At"];

// Append any missing header columns to an existing tab (non-destructive migration
// so older SK_Staff / SK_Attendance tabs gain Paid_Leaves / Deduction).
function _attEnsureCols(ws, headers) {
  var lastCol = ws.getLastColumn();
  var existing = lastCol > 0 ? ws.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h).trim(); }) : [];
  var missing = headers.filter(function (h) { return existing.indexOf(h) === -1; });
  if (missing.length) ws.getRange(1, lastCol + 1, 1, missing.length).setValues([missing]);
}
function _attSeed(ss) {
  var ws = getOrCreateTab(ss, ATT_STAFF_TAB, ATT_STAFF_HEADERS);
  _attEnsureCols(ws, ATT_STAFF_HEADERS);
  if (ws.getLastRow() > 1) return ws;
  ws.getRange(2, 1, 6, ATT_STAFF_HEADERS.length).setValues([
    ["Rupa Tai","Monthly",24000,15,"Monthly","","","",0,"Yes"],
    ["Pooja Tai","Monthly",8000,18,"Monthly","","","",0,"Yes"],
    ["Meena Tai","Monthly",5000,5,"Monthly","","","",0,"Yes"],
    ["Anita Tai","Monthly",3000,1,"Monthly","","","",0,"Yes"],
    ["Manisha Tai","Monthly",2000,1,"Monthly","","","",0,"Yes"],
    ["Abhijeet Parekar","Daily",0,"","Weekly",700,600,0,0,"Yes"]
  ]);
  return ws;
}
function _attPad(n) { return (n < 10 ? "0" : "") + n; }
function _attDateStr(v) { return v instanceof Date ? Utilities.formatDate(v, "Asia/Kolkata", "yyyy-MM-dd") : String(v || "").trim(); }
function _attDow(ds) { return new Date(ds + "T12:00:00+05:30").getDay(); } // 0 Sun .. 6 Sat
function _attMonthShift(monthStr, delta) {
  var d = new Date(+monthStr.slice(0, 4), +monthStr.slice(5, 7) - 1 + delta, 1);
  return d.getFullYear() + "-" + _attPad(d.getMonth() + 1);
}

function getAttendanceData(month, selDate) {
  try {
    var ss = getSpreadsheet();
    var staffWs = _attSeed(ss);
    var recWs = getOrCreateTab(ss, ATT_REC_TAB, ATT_REC_HEADERS); _attEnsureCols(recWs, ATT_REC_HEADERS);
    var salWs = getOrCreateTab(ss, ATT_SAL_TAB, ATT_SAL_HEADERS);
    var staff = getAllRows(staffWs).filter(function (r) { return String(r.Name || "").trim() && String(r.Active || "Yes").toLowerCase() !== "no"; });
    var recs = getAllRows(recWs);
    var sals = getAllRows(salWs);

    var now = getISTDate();
    var today = Utilities.formatDate(now, "Asia/Kolkata", "yyyy-MM-dd");
    var curMonth = Utilities.formatDate(now, "Asia/Kolkata", "yyyy-MM");
    var rosterDate = (selDate && /^\d{4}-\d{2}-\d{2}$/.test(selDate)) ? selDate : today;
    if (selDate && /^\d{4}-\d{2}-\d{2}$/.test(selDate)) month = rosterDate.slice(0, 7);
    var y, m;
    if (month && /^\d{4}-\d{2}$/.test(month)) { y = +month.slice(0, 4); m = +month.slice(5, 7); }
    else { y = now.getFullYear(); m = now.getMonth() + 1; }
    var dim = new Date(y, m, 0).getDate();
    var monthStr = y + "-" + _attPad(m);
    var from = monthStr + "-01", to = monthStr + "-" + _attPad(dim);
    var endDay = (monthStr === curMonth) ? now.getDate() : dim;

    var byStaff = {};
    recs.forEach(function (r) {
      var ds = _attDateStr(r.Date); if (ds < from || ds > to) return;
      var nm = String(r.Staff_Name || "").trim();
      (byStaff[nm] = byStaff[nm] || []).push({ date: ds, status: String(r.Status || "").trim().toLowerCase(), incentive: Number(r.Incentive || 0), deduction: Number(r.Deduction || 0), note: String(r.Note || "") });
    });
    var absentAll = {}, incentiveAll = {}, leavesByStaffMonth = {};
    recs.forEach(function (r) {
      var ds = _attDateStr(r.Date), nm = String(r.Staff_Name || "").trim();
      var ab = String(r.Status || "").trim().toLowerCase() === "absent";
      if (ab) absentAll[nm + "|" + ds] = true;
      if (Number(r.Incentive || 0) > 0) incentiveAll[nm + "|" + ds] = Number(r.Incentive || 0);
      if (ab && ds && _attDow(ds) !== 0) {
        var ym = ds.slice(0, 7);
        leavesByStaffMonth[nm] = leavesByStaffMonth[nm] || {};
        leavesByStaffMonth[nm][ym] = (leavesByStaffMonth[nm][ym] || 0) + 1;
      }
    });
    var paid = {}, salByStaff = {};
    sals.forEach(function (s) {
      var nm = String(s.Staff_Name || "").trim();
      paid[nm + "|" + String(s.Period || "").trim()] = Number(s.Amount || 0);
      (salByStaff[nm] = salByStaff[nm] || []).push({ period: String(s.Period || "").trim(), amount: Number(s.Amount || 0), at: String(s.Credited_At || "") });
    });

    var dow = now.getDay();
    var monOff = (dow === 0 ? -6 : 1 - dow);
    var monD = new Date(now.getFullYear(), now.getMonth(), now.getDate() + monOff);
    var satStr = Utilities.formatDate(new Date(monD.getFullYear(), monD.getMonth(), monD.getDate() + 5), "Asia/Kolkata", "yyyy-MM-dd");
    var prevKeys = [_attMonthShift(monthStr, -1), _attMonthShift(monthStr, -2), _attMonthShift(monthStr, -3)];

    var alerts = [], totalPayroll = 0;
    var staffOut = staff.map(function (st) {
      var name = String(st.Name).trim();
      var type = String(st.Type || "Monthly").trim().toLowerCase();
      var mySal = Number(st.Monthly_Salary || 0);
      var payDay = Number(st.Pay_Day || 0);
      var paidLeaves = Number(st.Paid_Leaves || 0);
      var wk = Number(st.Weekday_Rate || 0), sat = Number(st.Saturday_Rate || 0), sun = Number(st.Sunday_Rate || 0);
      var myRecs = byStaff[name] || [];

      var selRec = null; myRecs.forEach(function (r) { if (r.date === rosterDate) selRec = r; });
      var presentSel = !(selRec && selRec.status === "absent");
      var selIncentive = selRec ? selRec.incentive : 0;
      var selDeduction = selRec ? selRec.deduction : 0;

      var incentiveTotal = 0, deductionTotal = 0, leaveDays = 0, leaveList = [], incentives = [], deductions = [];
      myRecs.forEach(function (r) {
        if (r.incentive > 0) { incentiveTotal += r.incentive; incentives.push({ date: r.date, amount: r.incentive, note: r.note }); }
        if (r.deduction > 0) { deductionTotal += r.deduction; deductions.push({ date: r.date, amount: r.deduction, note: r.note }); }
        if (r.status === "absent") {
          var sunday = _attDow(r.date) === 0;
          if (!sunday) leaveDays++;
          leaveList.push({ date: r.date, sunday: sunday, reason: r.note });
        }
      });
      leaveList.sort(function (a, b) { return a.date.localeCompare(b.date); });
      var freeLeft = paidLeaves;
      leaveList.forEach(function (lv) {
        if (lv.sunday) { lv.deductible = false; return; }
        if (freeLeft > 0) { lv.deductible = false; freeLeft--; } else { lv.deductible = true; }
      });
      var deductibleLeaves = Math.max(0, leaveDays - paidLeaves);
      var freeUsed = Math.min(leaveDays, paidLeaves);

      var workingDays = 0, leavesElapsed = 0;
      for (var wd = 1; wd <= endDay; wd++) {
        var wds = monthStr + "-" + _attPad(wd);
        if (_attDow(wds) === 0) continue;
        workingDays++;
        if (absentAll[name + "|" + wds]) leavesElapsed++;
      }
      var presentDays = Math.max(0, workingDays - leavesElapsed);

      var curLeaves = (leavesByStaffMonth[name] && leavesByStaffMonth[name][monthStr]) || 0;
      var prevVals = prevKeys.map(function (k) { return (leavesByStaffMonth[name] && leavesByStaffMonth[name][k]) || 0; });
      var avg3 = (prevVals[0] + prevVals[1] + prevVals[2]) / 3;

      var out = {
        name: name, type: type, monthly_salary: mySal, pay_day: payDay, pay_cycle: String(st.Pay_Cycle || "Monthly"),
        paid_leaves: paidLeaves, weekday_rate: wk, saturday_rate: sat, sunday_rate: sun,
        present_sel: presentSel, sel_incentive: selIncentive, sel_deduction: selDeduction,
        leave_list: leaveList, incentives: incentives, deductions: deductions,
        incentive_total: incentiveTotal, deduction_total: deductionTotal,
        leave_days: leaveDays, deductible_leaves: deductibleLeaves, free_used: freeUsed,
        working_days: workingDays, present_days: presentDays,
        trend: { current: curLeaves, prev: prevVals, prev_keys: prevKeys, avg3: Math.round(avg3 * 10) / 10, up: (curLeaves > avg3 + 0.0001 && curLeaves >= 2) },
        salary_history: (salByStaff[name] || []).slice(-6).reverse()
      };

      if (type === "daily") {
        var endDs = (monthStr === curMonth) ? today : to;
        var earned = 0;
        for (var dd = 1; dd <= dim; dd++) {
          var ds = monthStr + "-" + _attPad(dd); if (ds > endDs) break;
          var w = _attDow(ds); if (w === 0) continue;
          if (absentAll[name + "|" + ds]) continue;
          earned += (w === 6 ? sat : wk);
        }
        out.base_earned = earned; out.per_day = wk; out.deduction = 0;
        out.net_salary = earned + incentiveTotal - deductionTotal;
        var weekAmt = 0, weekInc = 0;
        for (var k = 0; k < 6; k++) {
          var dx = new Date(monD.getFullYear(), monD.getMonth(), monD.getDate() + k);
          var dsx = Utilities.formatDate(dx, "Asia/Kolkata", "yyyy-MM-dd");
          var wx = dx.getDay();
          if (wx !== 0 && !absentAll[name + "|" + dsx]) weekAmt += (wx === 6 ? sat : wk);
          if (incentiveAll[name + "|" + dsx]) weekInc += incentiveAll[name + "|" + dsx];
        }
        var weekPeriod = "W" + satStr;
        out.week_amount = weekAmt + weekInc; out.week_period = weekPeriod; out.week_credited = paid.hasOwnProperty(name + "|" + weekPeriod);
        if ((dow === 6 || dow === 0) && !out.week_credited) {
          alerts.push({ name: name, amount: weekAmt + weekInc, period: weekPeriod, label: "Weekly wage (week ending Sat " + satStr + ")", base: weekAmt, deduction: 0, incentive: weekInc, adj: 0, cycle: "Weekly" });
        }
      } else {
        var perDay = dim > 0 ? mySal / dim : 0;
        var leaveDeduction = Math.round(perDay * deductibleLeaves);
        out.per_day = Math.round(perDay * 100) / 100; out.deduction = leaveDeduction;
        out.net_salary = mySal - leaveDeduction + incentiveTotal - deductionTotal;
        var monthPeriod = "M" + monthStr;
        out.pay_period = monthPeriod; out.credited = paid.hasOwnProperty(name + "|" + monthPeriod);
        out.pay_due = (monthStr === curMonth) && (now.getDate() >= payDay) && !out.credited;
        if (out.pay_due) alerts.push({ name: name, amount: out.net_salary, period: monthPeriod, label: "Salary (pay day " + payDay + ")", base: mySal, deduction: leaveDeduction, incentive: incentiveTotal, adj: deductionTotal, cycle: "Monthly" });
      }
      totalPayroll += Number(out.net_salary || 0);
      return out;
    });

    return { success: true, month: monthStr, days_in_month: dim, today: today, roster_date: rosterDate, today_dow: dow, total_payroll: totalPayroll, staff: staffOut, alerts: alerts };
  } catch (e) { return { success: false, error: String(e) }; }
}

// Header-driven upsert so it's robust to column order / added columns.
function _attUpsert(ss, date, name, mutate) {
  var ws = getOrCreateTab(ss, ATT_REC_TAB, ATT_REC_HEADERS);
  _attEnsureCols(ws, ATT_REC_HEADERS);
  var hIdx = headerIndex(ws);
  var headerRow = ws.getRange(1, 1, 1, ws.getLastColumn()).getValues()[0].map(function (h) { return String(h).trim(); });
  var data = ws.getDataRange().getValues();
  var dCol = hIdx.Date - 1, nCol = hIdx.Staff_Name - 1;
  var rowNum = -1, cur = { Status: "", Incentive: "", Deduction: "", Note: "" };
  for (var i = 1; i < data.length; i++) {
    if (_attDateStr(data[i][dCol]) === date && String(data[i][nCol] || "").trim() === name) {
      rowNum = i + 1;
      cur.Status = String(data[i][hIdx.Status - 1] || "");
      cur.Incentive = data[i][hIdx.Incentive - 1];
      cur.Deduction = data[i][hIdx.Deduction - 1];
      cur.Note = String(data[i][hIdx.Note - 1] || "");
      break;
    }
  }
  mutate(cur);
  var stamp = Utilities.formatDate(getISTDate(), "Asia/Kolkata", "yyyy-MM-dd HH:mm");
  var vals = headerRow.map(function (h) {
    if (h === "Date") return date;
    if (h === "Staff_Name") return name;
    if (h === "Status") return cur.Status;
    if (h === "Incentive") return cur.Incentive;
    if (h === "Deduction") return cur.Deduction;
    if (h === "Note") return cur.Note;
    if (h === "Updated") return stamp;
    return "";
  });
  if (rowNum > 0) ws.getRange(rowNum, 1, 1, vals.length).setValues([vals]);
  else ws.appendRow(vals);
  return { success: true };
}

function markAttendance(name, date, status, reason) {
  if (!name || !date) return { success: false, error: "name and date required" };
  var absent = String(status || "").trim().toLowerCase() === "absent";
  return _attUpsert(getSpreadsheet(), date, String(name).trim(), function (o) {
    o.Status = absent ? "Absent" : "";
    if (absent && reason) o.Note = reason;
  });
}

function addIncentive(name, date, amount, note) {
  if (!name || !date) return { success: false, error: "name and date required" };
  var amt = Number(amount || 0);
  return _attUpsert(getSpreadsheet(), date, String(name).trim(), function (o) { o.Incentive = amt > 0 ? amt : ""; if (note) o.Note = note; });
}

// Ad-hoc deduction (salary advance taken, fine, breakage…) on a date.
function addDeduction(name, date, amount, note) {
  if (!name || !date) return { success: false, error: "name and date required" };
  var amt = Number(amount || 0);
  return _attUpsert(getSpreadsheet(), date, String(name).trim(), function (o) { o.Deduction = amt > 0 ? amt : ""; if (note) o.Note = note; });
}

function markSalaryCredited(name, period, amount) {
  if (!name || !period) return { success: false, error: "name and period required" };
  var ws = getOrCreateTab(getSpreadsheet(), ATT_SAL_TAB, ATT_SAL_HEADERS);
  ws.appendRow([String(name).trim(), String(period).trim(), Number(amount || 0), Utilities.formatDate(getISTDate(), "Asia/Kolkata", "yyyy-MM-dd HH:mm")]);
  // Force Period to plain text so values are never auto-converted to dates/numbers.
  try { ws.getRange(ws.getLastRow(), 2).setNumberFormat("@").setValue(String(period).trim()); } catch (e) {}
  return { success: true };
}

// Edit a staff member's pay config in SK_Staff (salary, pay day, daily rates,
// paid-leave allowance, active). Name and Type are NOT editable — attendance
// records are keyed by Name, so renaming would orphan them.
function updateStaff(name, fields) {
  if (!name) return { success: false, error: "name required" };
  var EDITABLE = { Monthly_Salary: 1, Pay_Day: 1, Weekday_Rate: 1, Saturday_Rate: 1, Sunday_Rate: 1, Paid_Leaves: 1, Active: 1 };
  var ss = getSpreadsheet();
  var ws = getOrCreateTab(ss, ATT_STAFF_TAB, ATT_STAFF_HEADERS);
  _attEnsureCols(ws, ATT_STAFF_HEADERS);
  var hIdx = headerIndex(ws);
  var data = ws.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0] || "").trim() === String(name).trim()) {
      Object.keys(fields || {}).forEach(function (k) {
        if (EDITABLE[k] && hIdx[k]) ws.getRange(i + 1, hIdx[k]).setValue(fields[k]);
      });
      return { success: true };
    }
  }
  return { success: false, error: "Staff not found: " + name };
}

/**
 * Creates a Google Sheet in Drive with delivery details for a given date + meal.
 * Returns the spreadsheet URL so the client can open it directly.
 */
function createDeliverySheet(date, meal) {
  var data = getDriverOrders(date);
  var orders = (data.meals && data.meals[meal]) || [];

  var mealLabel = meal;
  var dateParts = date.split("-"); // yyyy-mm-dd
  var displayDate = dateParts[2] + "/" + dateParts[1] + "/" + dateParts[0];
  var title = "Delivery — " + mealLabel + " " + displayDate;

  var ss   = SpreadsheetApp.create(title);
  var sheet = ss.getActiveSheet();
  sheet.setName(mealLabel);

  // Headers
  var headers = ["Name", "Phone", "Address", "Maps Link", "Landmark", "Delivery Point", "Notes"];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);

  // Style header row
  var headerRange = sheet.getRange(1, 1, 1, headers.length);
  headerRange.setBackground("#1E1240");
  headerRange.setFontColor("#ffffff");
  headerRange.setFontWeight("bold");
  headerRange.setFontSize(11);

  // Data rows
  if (orders.length > 0) {
    var rows = orders.map(function(o) {
      return [
        o.name        || "",
        o.phone       || "",
        o.address     || "",
        o.maps        || "",
        o.landmark    || "",
        o.deliveryPoint || "",
        o.notes       || ""
      ];
    });
    sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
  }

  // Auto-resize columns for readability
  headers.forEach(function(_, i) { sheet.autoResizeColumn(i + 1); });

  // Freeze header row
  sheet.setFrozenRows(1);

  // Make the sheet accessible to anyone with the link (view + comment)
  var file = DriveApp.getFileById(ss.getId());
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.EDIT);

  return { success: true, url: ss.getUrl(), title: title, count: orders.length };
}

// Shared coord extractor for Apps Script (mirrors client-side regex)
// Priority: !3d/!4d (actual pinned location) > place/@ (share URL center) >
// ?q= / ?destination= / ?ll= > @ (camera center — last resort, can be far off)


// ── ORDER SUMMARY ────────────────────────────────────────────
function getOrderSummary(date) {
  var ss = getSpreadsheet();
  var ws = getOrCreateTab(ss, TAB_ORDERS, []);
  // Live + archived orders for this date (archive opened only if the date is
  // in an archived month), plus IntentAmplify orders (tagged [IA]).
  var rows = getOrdersInRangeWithArchive(date, date)
               .concat(typeof ia_rowsAsSK === "function" ? ia_rowsAsSK() : []);

  var dayRows = rows.filter(function(r) {
    var d = r.Order_Date instanceof Date
      ? Utilities.formatDate(r.Order_Date, "Asia/Kolkata", "yyyy-MM-dd")
      : String(r.Order_Date).trim();
    return d === date && !_isOrderCancelled(r.Payment_Status);
  });

  var meals = {};
  var totals = {orders: 0, customers: 0, revenue: 0, paid: 0, pending: 0};
  var customerSet = {};
  var LUNCH_DINNER_COLS = [
    "Chapati","Without_Oil_Chapati","Phulka","Ghee_Phulka","Jowar_Bhakri","Bajra_Bhakri",
    "Dry_Sabji_Mini","Dry_Sabji_Full","Curry_Sabji_Mini","Curry_Sabji_Full",
    "Dal","Rice","Salad","Curd"
  ];

  dayRows.forEach(function(r) {
    var meal = String(r.Meal_Type || "");
    if (!meal) return;
    if (!meals[meal]) meals[meal] = {count:0, revenue:0, paid:0, pending:0, itemTotals:{}, customers:[]};
    var m = meals[meal];
    var net = Number(r.Net_Total) || 0;
    var payStatus = String(r.Payment_Status || "Pending");

    var items = {};
    if (meal === "Breakfast") {
      var bfHasCurdSlot = false;
      for (var n = 1; n <= 4; n++) {
        var item = String(r["BF_Item_"+n] || "").trim();
        var qty  = Number(r["BF_Qty_"+n]) || 0;
        if (item && qty > 0) {
          items[item] = (items[item] || 0) + qty;
          m.itemTotals[item] = (m.itemTotals[item] || 0) + qty;
          if (item === "Curd") bfHasCurdSlot = true;
        }
      }
      // Dedupe: submitOrder writes Curd to BOTH BF_Item_N and Curd column,
      // so only add r.Curd if no BF_Item slot already captured it.
      var curdBf = Number(r.Curd) || 0;
      if (curdBf > 0 && !bfHasCurdSlot) {
        items["Curd"] = (items["Curd"] || 0) + curdBf;
        m.itemTotals["Curd"] = (m.itemTotals["Curd"] || 0) + curdBf;
      }
      // Allow lunch-style items placed in a Breakfast order via backend
      // (admin edits). Surface them so they don't get silently dropped.
      LUNCH_DINNER_COLS.forEach(function(col) {
        if (col === "Curd") return; // already handled above
        var q = Number(r[col]) || 0;
        if (q > 0) { items[col] = (items[col]||0)+q; m.itemTotals[col] = (m.itemTotals[col]||0)+q; }
      });
    } else {
      LUNCH_DINNER_COLS.forEach(function(col) {
        var q = Number(r[col]) || 0;
        if (q > 0) { items[col] = (items[col]||0)+q; m.itemTotals[col] = (m.itemTotals[col]||0)+q; }
      });
      // Allow breakfast-style items placed in a Lunch/Dinner order via
      // backend (admin edits — e.g. Poha/Upma for lunch). Surface them so
      // the kitchen sees them.
      for (var nn = 1; nn <= 4; nn++) {
        var bItem = String(r["BF_Item_"+nn] || "").trim();
        var bQty  = Number(r["BF_Qty_"+nn]) || 0;
        if (bItem && bQty > 0) {
          items[bItem] = (items[bItem] || 0) + bQty;
          m.itemTotals[bItem] = (m.itemTotals[bItem] || 0) + bQty;
        }
      }
    }

    m.count++;
    m.revenue += net;
    if (payStatus === "Paid" || payStatus === "Wallet Paid" || payStatus === "Collected") m.paid += net; else m.pending += net;
    m.customers.push({
      id:        String(r.Submission_ID || ""),
      name:      String(r.Customer_Name || ""),
      phone:     String(r.Phone || ""),
      items:     items,
      area:      String(r.Area || ""),
      address:   String(r.Full_Address || r.Flat || ""),
      total:     net,
      payStatus: payStatus,
      notes:     String(r.Special_Notes_Kitchen || "")
    });

    totals.orders++;
    totals.revenue += net;
    if (payStatus === "Paid" || payStatus === "Wallet Paid" || payStatus === "Collected") totals.paid += net; else totals.pending += net;
    if (!customerSet[String(r.Phone)]) { customerSet[String(r.Phone)] = true; totals.customers++; }
  });

  return {date: date, meals: meals, totals: totals};
}

// ── LABEL ORDERS ──────────────────────────────────────────────
function getLabelOrders(date, meal) {
  var ss = getSpreadsheet();
  var ws = getOrCreateTab(ss, TAB_ORDERS, []);
  // Merge IntentAmplify orders so their labels print too (name prefixed [IA]).
  var rows = getAllRows(ws).concat(typeof ia_rowsAsSK === "function" ? ia_rowsAsSK() : []);
  var COLS = ["Chapati","Without_Oil_Chapati","Phulka","Ghee_Phulka","Jowar_Bhakri","Bajra_Bhakri",
              "Dry_Sabji_Mini","Dry_Sabji_Full","Curry_Sabji_Mini","Curry_Sabji_Full","Dal","Rice","Salad"];

  var orders = rows
    .filter(function(r) {
      var d = r.Order_Date instanceof Date
        ? Utilities.formatDate(r.Order_Date, "Asia/Kolkata", "yyyy-MM-dd")
        : String(r.Order_Date).trim();
      return d === date && String(r.Meal_Type) === meal && !_isOrderCancelled(r.Payment_Status);
    })
    .map(function(r) {
      var obj = {
        name:  String(r.Customer_Name || ""),
        area:  String(r.Area || ""),
        notes: String(r.Special_Notes || ""),
        Curd:  Number(r.Curd) || 0,
        Items_JSON: String(r.Items_JSON || "")
      };
      if (meal === "Breakfast") {
        for (var n = 1; n <= 4; n++) {
          obj["BF_Item_"+n] = String(r["BF_Item_"+n] || "");
          obj["BF_Qty_"+n]  = Number(r["BF_Qty_"+n])  || 0;
        }
      } else {
        COLS.forEach(function(col) { obj[col] = Number(r[col]) || 0; });
      }
      return obj;
    });

  return {orders: orders};
}

// ── PACKAGING EXPENSES ────────────────────────────────────────
// Edit unit costs below to match your actual supplier prices
var PKG_UNIT_COSTS = {
  "Breakfast Box":           2.36,
  "Delivery Bag":            1.00,
  "Label / Sticker":         0.2,
  "Bread Packet":            0.70,
  "Sabji Container (Mini)":  2.70,
  "Sabji Container (Full)":  4.0,
  "Dal Container":           4.00,
  "Rice Container":          2.00,
  "Salad Container":         0.700,
  "Curd Container":          1.70
};

function getPackagingExpenses(date) {
  // Live + archived orders for this date (archive opened only for archived months).
  var rows = getOrdersInRangeWithArchive(date, date);

  var dayRows = rows.filter(function(r) {
    var d = r.Order_Date instanceof Date
      ? Utilities.formatDate(r.Order_Date, "Asia/Kolkata", "yyyy-MM-dd")
      : String(r.Order_Date).trim();
    // Exclude cancelled — they consume no packaging (matches the range variant).
    return d === date && !_isOrderCancelled(r.Payment_Status);
  });

  if (dayRows.length === 0) return {date: date, orderCount: 0, meals: {}, items: [], total: 0};

  var counts = {};
  var mealCounts = {Breakfast:0, Lunch:0, Dinner:0};
  function add(key, qty) { if (qty > 0) counts[key] = (counts[key]||0) + qty; }

  dayRows.forEach(function(r) {
    var meal = String(r.Meal_Type || "");
    if (mealCounts[meal] !== undefined) mealCounts[meal]++;

    add("Label / Sticker", 1);
    if (meal === "Breakfast") {
      add("Breakfast Box", 1);
      add("Curd Container", Number(r.Curd) || 0);
    } else {
      add("Delivery Bag", 1);
      var breadCols = ["Chapati","Without_Oil_Chapati","Phulka","Ghee_Phulka","Jowar_Bhakri","Bajra_Bhakri"];
      var hasBread = breadCols.some(function(c) { return (Number(r[c])||0) > 0; });
      if (hasBread) add("Bread Packet", 1);
      add("Sabji Container (Mini)", (Number(r.Dry_Sabji_Mini)||0) + (Number(r.Curry_Sabji_Mini)||0));
      add("Sabji Container (Full)", (Number(r.Dry_Sabji_Full)||0) + (Number(r.Curry_Sabji_Full)||0));
      add("Dal Container",          Number(r.Dal)   || 0);
      add("Rice Container",         Number(r.Rice)  || 0);
      add("Salad Container",        Number(r.Salad) || 0);
      add("Curd Container",         Number(r.Curd)  || 0);
    }
  });

  var itemOrder = ["Breakfast Box","Delivery Bag","Label / Sticker","Bread Packet",
                   "Sabji Container (Mini)","Sabji Container (Full)",
                   "Dal Container","Rice Container","Salad Container","Curd Container"];
  var items = [];
  var total = 0;
  itemOrder.forEach(function(key) {
    var qty = counts[key] || 0;
    if (!qty) return;
    var unitCost = PKG_UNIT_COSTS[key] || 0;
    var t = qty * unitCost;
    items.push({name: key, qty: qty, unitCost: unitCost, total: t});
    total += t;
  });

  var mealsOut = {};
  Object.keys(mealCounts).forEach(function(m) { if (mealCounts[m] > 0) mealsOut[m] = mealCounts[m]; });

  return {date: date, orderCount: dayRows.length, meals: mealsOut, items: items, total: total};
}

// ── PACKAGING EXPENSES — RANGE ───────────────────────────────
function getPackagingExpensesRange(from, to) {
  // Live + archived orders for the range (archives opened only for archived months).
  var rows = getOrdersInRangeWithArchive(from, to);

  var rangeRows = rows.filter(function(r) {
    var d = r.Order_Date instanceof Date
      ? Utilities.formatDate(r.Order_Date, "Asia/Kolkata", "yyyy-MM-dd")
      : String(r.Order_Date).trim();
    return d >= from && d <= to && !_isOrderCancelled(r.Payment_Status);
  });

  // Group by date
  var byDate = {};
  rangeRows.forEach(function(r) {
    var d = r.Order_Date instanceof Date
      ? Utilities.formatDate(r.Order_Date, "Asia/Kolkata", "yyyy-MM-dd")
      : String(r.Order_Date).trim();
    if (!byDate[d]) byDate[d] = [];
    byDate[d].push(r);
  });

  var PKG_COSTS = PKG_UNIT_COSTS;
  var itemOrder = ["Breakfast Box","Delivery Bag","Label / Sticker","Bread Packet",
                   "Sabji Container (Mini)","Sabji Container (Full)",
                   "Dal Container","Rice Container","Salad Container","Curd Container"];

  function calcDay(dateStr, dayRows) {
    var counts = {}, mealCounts = {Breakfast:0, Lunch:0, Dinner:0};
    function add(key, qty) { if (qty > 0) counts[key] = (counts[key]||0) + qty; }
    dayRows.forEach(function(r) {
      var meal = String(r.Meal_Type || "");
      if (mealCounts[meal] !== undefined) mealCounts[meal]++;
      add("Label / Sticker", 1);
      if (meal === "Breakfast") {
        add("Breakfast Box", 1);
        add("Curd Container", Number(r.Curd) || 0);
      } else {
        add("Delivery Bag", 1);
        var breadCols = ["Chapati","Without_Oil_Chapati","Phulka","Ghee_Phulka","Jowar_Bhakri","Bajra_Bhakri"];
        if (breadCols.some(function(c){ return (Number(r[c])||0)>0; })) add("Bread Packet", 1);
        add("Sabji Container (Mini)", (Number(r.Dry_Sabji_Mini)||0)+(Number(r.Curry_Sabji_Mini)||0));
        add("Sabji Container (Full)", (Number(r.Dry_Sabji_Full)||0)+(Number(r.Curry_Sabji_Full)||0));
        add("Dal Container",  Number(r.Dal)||0);
        add("Rice Container", Number(r.Rice)||0);
        add("Salad Container",Number(r.Salad)||0);
        add("Curd Container", Number(r.Curd)||0);
      }
    });
    var items = [], total = 0;
    itemOrder.forEach(function(key) {
      var qty = counts[key]||0; if (!qty) return;
      var unitCost = PKG_COSTS[key]||0, t = qty*unitCost;
      items.push({name:key, qty:qty, unitCost:unitCost, total:t});
      total += t;
    });
    var mealsOut = {};
    Object.keys(mealCounts).forEach(function(m){ if(mealCounts[m]>0) mealsOut[m]=mealCounts[m]; });
    return {date:dateStr, orderCount:dayRows.length, meals:mealsOut, items:items, total:total};
  }

  // Build per-day results
  var days = Object.keys(byDate).sort().map(function(d){ return calcDay(d, byDate[d]); });

  // Aggregate totals
  var aggCounts = {}, aggMeals = {Breakfast:0,Lunch:0,Dinner:0}, aggTotal = 0, aggOrders = 0;
  days.forEach(function(day) {
    aggOrders += day.orderCount;
    aggTotal  += day.total;
    Object.keys(day.meals).forEach(function(m){ aggMeals[m]=(aggMeals[m]||0)+day.meals[m]; });
    day.items.forEach(function(it){ aggCounts[it.name]=(aggCounts[it.name]||0)+it.qty; });
  });
  var aggItems = [];
  itemOrder.forEach(function(key) {
    var qty = aggCounts[key]||0; if (!qty) return;
    var unitCost = PKG_COSTS[key]||0, t=qty*unitCost;
    aggItems.push({name:key, qty:qty, unitCost:unitCost, total:t});
  });

  return {
    from: from, to: to,
    orderCount: aggOrders,
    total: aggTotal,
    meals: aggMeals,
    items: aggItems,
    days: days
  };
}

// ── LABEL DRIVE SAVE ─────────────────────────────────────────
function saveLabels(body) {
  var date   = body.date;  // "2026-03-18"
  var meal   = body.meal;  // "Lunch"
  var pdfB64 = body.pdf;   // base64-encoded PDF bytes

  var parts      = date.split("-");
  var year       = parts[0];                                        // "2026"
  var monthNum   = parseInt(parts[1], 10);                          // 3
  var monthNames = ["January","February","March","April","May","June",
                    "July","August","September","October","November","December"];
  var monthName  = monthNames[monthNum - 1];                        // "March"
  var mealAbbrev = meal.toLowerCase().substring(0, 7);              // "breakfa" / "lunch" / "dinner"
  var langCode   = (body.lang === "Devanagari") ? "mar" : "eng";    // "eng" / "mar"
  var filename   = "labels_" + mealAbbrev + "_" + langCode + "_" + date + "_58x25.pdf";
  // e.g. "labels_breakfa_eng_2026-03-05_58x25.pdf"

  var folder = getOrCreateFolderPath([
    "Svaadh Kitchen", "Accounting", "Tally Form Daily Sheets",
    "Processed_Orders", "Labels", year, monthName
  ]);

  // Replace existing file to avoid duplicates
  var existing = folder.getFilesByName(filename);
  while (existing.hasNext()) existing.next().setTrashed(true);

  var pdfBlob = Utilities.newBlob(Utilities.base64Decode(pdfB64), "application/pdf", filename);
  var file = folder.createFile(pdfBlob);
  return {url: file.getUrl(), name: filename};
}

function getOrCreateFolderPath(pathParts) {
  var folder = DriveApp.getRootFolder();
  pathParts.forEach(function(name) {
    var iter = folder.getFoldersByName(name);
    folder = iter.hasNext() ? iter.next() : folder.createFolder(name);
  });
  return folder;
}

// ── CHATBOT ──────────────────────────────────────────────────

function handleChat(body) {
  const userMessage = String(body.message || "").trim();
  const history     = body.history || [];   // [{role:"user"|"model", text:"..."}]
  if (!userMessage) return {reply: "Please send a message."};

  let extraMenu = "";
  try {
    // Basic date detection (e.g., "tomorrow", "15th", "15-04", "April 15")
    const msgLower = userMessage.toLowerCase();
    let targetDate = new Date();
    let foundDate = false;

    if (msgLower.includes("tomorrow")) {
      targetDate.setDate(targetDate.getDate() + 1);
      foundDate = true;
    } else if (msgLower.includes("today")) {
      foundDate = true;
    } else {
      // Look for day numbers (1st, 2nd, 3rd, 4th... 31st) or simple digits
      const dayMatch = msgLower.match(/(\d{1,2})(st|nd|rd|th)?/);
      if (dayMatch) {
        const day = parseInt(dayMatch[1]);
        if (day >= 1 && day <= 31) {
          targetDate.setDate(day);
          // If the detected day is in the past, assume next month
          if (targetDate < new Date()) targetDate.setMonth(targetDate.getMonth() + 1);
          foundDate = true;
        }
      }
    }

    if (foundDate) {
      const dateStr = Utilities.formatDate(targetDate, "Asia/Kolkata", "yyyy-MM-dd");
      const m = getMenu(dateStr);
      const bf = (m.breakfast || []).map(function(x) { return x.name + " ₹" + x.price; }).join(", ");
      extraMenu = "\nMenu for " + dateStr + " (" + Utilities.formatDate(targetDate, "Asia/Kolkata", "EEEE") + "): "
        + (Utilities.formatDate(targetDate, "Asia/Kolkata", "EEEE") === "Sunday" ? "CLOSED (Sunday)" :
          "BF: " + (bf || "TBD") + " | L: " + (m.lunch_dry || "") + (m.lunch_curry ? " & " + m.lunch_curry : "") +
          " | D: " + (m.dinner_dry || "") + (m.dinner_curry ? " & " + m.dinner_curry : ""));
    }
  } catch (e) {
    console.error("Date menu fetch failed:", e);
  }

  return {reply: callGemini(buildSystemPrompt(extraMenu), history, userMessage)};
}

function buildSystemPrompt(extraMenu) {
  const B = BUSINESS_CONTEXT;
  const breads = B.menu.breads.map(function(i){ return i.name+"₹"+i.price; }).join(", ");
  const sabji  = B.menu.sabji.map(function(i){ return i.name+"₹"+i.price; }).join(", ");
  const basics = B.menu.basics.map(function(i){ return i.name+"₹"+i.price; }).join(", ");

  var todayLine = "";
  try {
    var now = new Date();
    var todayStr = Utilities.formatDate(now, "Asia/Kolkata", "yyyy-MM-dd");
    var dayName = Utilities.formatDate(now, "Asia/Kolkata", "EEEE");
    var m = getMenu(todayStr);
    var bf = (m.breakfast||[]).map(function(x){ return x.name+"₹"+x.price; }).join(", ");
    todayLine = "Today is "+dayName+", "+todayStr+". "
      +(dayName==="Sunday" ? "Kitchen is CLOSED today (Sunday).\n" :
        "BF:"+(bf||"TBD")
      +"|L:"+(m.lunch_dry||"")+(m.lunch_curry?" & "+m.lunch_curry:"")
      +"|D:"+(m.dinner_dry||"")+(m.dinner_curry?" & "+m.dinner_curry:"")
      +((!m.lunch_dry&&!m.dinner_dry)?" (sabji TBD—send to WA group)":"")+"\n");
  } catch(e) { todayLine = "Today's menu: check WhatsApp group.\n"; }

  const prompt = "You are a helpful assistant for Svaadh Kitchen, a vegetarian cloud kitchen in Hadapsar, Pune."
    +" Closed Sundays. Over 2.5 years of service (since Aug 2023). Cutoffs: BF<7AM, Lunch<9AM, Dinner<4:30PM."
    +" AREAS: " + B.locations_served.join(", ") + ".\n"
    +" DELIVERY POLICY: FREE for Bhosale Nagar, Triveni Nagar, and Self Pickup. Other areas ₹11/meal if subtotal < ₹100. "
    + B.delivery.outside_policy + "\n"
    +" PRIVACY & SECURITY: DO NOT disclose user phone numbers, PINs, transaction IDs, UPI details, or specific refund info. If a user asks about their payment or refund, tell them to check their 'Svaadh Wallet' or 'View/Edit existing orders' dashboard, or message us on WhatsApp at " + B.contact.whatsapp + ".\n"
    + todayLine + (extraMenu || "")
    +"\nMEAL MODEL: Make Your Own Meal (not a fixed thali). Customers pick items individually.\n"
    +"Lunch/Dinner — Breads:"+breads+" | Sabji:"+sabji+" | Basics:"+basics+"\n"
    +"Breakfast: daily rotating ₹35–₹70. "+B.menu.breakfast_note+"\n"
    +"Self pickup also available (no delivery charge).\n"
    +"Uses Pure Ghee & Groundnut refined oil. Pure Veg kitchen.\n"
    +"Discounts(auto): 5% off≥₹300/day, 7.5% off≥₹450/day.\n"
    +"Payment: Wallet (Prepaid) or UPI("+B.payment.upi_id+"), prepaid cycle (requires wallet balance).\n"
    +"Order: "+B.ordering.order_url+" — no login needed, phone=identity, can book multiple days.\n"
    +"WhatsApp: "+B.contact.whatsapp+" | WA group: "+B.contact.whatsapp_group+"\n"
    +"Reply in customer's language (English/Hindi/Marathi). Be brief & warm. Match the language they use."
    +" For orders, always send to order URL. Don't invent info. Direct unknowns to WhatsApp.";
  
  return prompt;
}

function callGemini(systemPrompt, history, userMessage) {
  const apiKey = PropertiesService.getScriptProperties().getProperty("GEMINI_API_KEY");
  if (!apiKey) {
    return "I'm having trouble connecting right now. Please WhatsApp us at +91 99307 48908 for help!";
  }

  // Build contents array: last 6 history messages + current message (caps token usage)
  const contents = [];
  const recentHistory = (history || []).slice(-6);
  recentHistory.forEach(function(msg) {
    if (msg.role === "user" || msg.role === "model") {
      contents.push({role: msg.role, parts: [{text: String(msg.text || "")}]});
    }
  });
  contents.push({role: "user", parts: [{text: userMessage}]});

  const payload = {
    system_instruction: {parts: [{text: systemPrompt}]},
    contents: contents,
    generationConfig: {maxOutputTokens: 512, temperature: 0.7}
  };

  try {
    const url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=" + apiKey;
    const response = UrlFetchApp.fetch(url, {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
    const raw = response.getContentText();
    const data = JSON.parse(raw);
    if (data.candidates && data.candidates[0] && data.candidates[0].content) {
      return data.candidates[0].content.parts[0].text;
    }
    return "I'm not sure how to answer that. Please WhatsApp us at +91 99307 48908!";
  } catch(e) {
    return "I'm having trouble right now. Please call or WhatsApp us at +91 99307 48908.";
  }
}

// ── GET UNPAID CUSTOMERS (reconciliation) ────────────────────────────────────
function getUnpaidCustomers(p) {
  const dateFrom = p.dateFrom;
  const dateTo   = p.dateTo;
  if (!dateFrom || !dateTo) return {success:false, error:"dateFrom and dateTo required"};

  const ss   = getSpreadsheet();
  const ws   = getOrCreateTab(ss, TAB_ORDERS, ORDERS_HEADERS);
  const rows = getAllRows(ws);

  // Collect all unpaid orders in the range
  const relevant = rows.filter(r =>
    String(r.Order_Date) >= dateFrom &&
    String(r.Order_Date) <= dateTo   &&
    (r.Payment_Status === "Pending" ||
     r.Payment_Status === "on account" ||
     !r.Payment_Status)
  );

  // Group by customer phone → sum net totals
  const map = {};
  relevant.forEach(r => {
    const key = String(r.Phone || "").trim();
    if (!key) return;
    if (!map[key]) map[key] = {phone:key, name:String(r.Customer_Name||"").trim(), total:0, orderCount:0};
    map[key].total      += Number(r.Net_Total) || 0;
    map[key].orderCount += 1;
  });

  // Load wallet rows ONCE — avoids N API calls inside the map loop
  const walletWsUC = getOrCreateTab(ss, TAB_WALLET, WALLET_HEADERS);
  const walletRowsUC = getAllRows(walletWsUC);

  const customers = Object.values(map).map(c => {
    const wb = _calculateWalletBalance(c.phone, walletRowsUC);
    const net = Math.round(c.total - wb);
    return { ...c, total: net, walletBalance: Math.round(wb) };
  });
  const grandTotal = customers.reduce((s,c) => s + c.total, 0);
  return {success:true, customers, period:{from:dateFrom, to:dateTo}, grandTotal};
}

// ── MARK CUSTOMERS PAID (reconciliation) ─────────────────────────────────────
function markCustomersPaid(body) {
  const phones   = body.phones   || [];   // array of phone strings
  const dateFrom = body.dateFrom;
  const dateTo   = body.dateTo;
  if (!phones.length || !dateFrom || !dateTo)
    return {success:false, error:"phones, dateFrom, dateTo required"};

  const ss      = getSpreadsheet();
  const ws      = getOrCreateTab(ss, TAB_ORDERS, ORDERS_HEADERS);
  const headers = ws.getRange(1,1,1,ws.getLastColumn()).getValues()[0];
  const hIdx    = {};
  headers.forEach((h,i) => { hIdx[h] = i+1; });

  const rows    = getAllRows(ws);
  let   updated = 0;
  rows.forEach(r => {
    // Normalize Order_Date — Date-typed cells stringify to "Sat Jun 12 2026…"
    // which sorts AFTER every "yyyy-MM-dd" bound, silently excluding them.
    const od = r.Order_Date instanceof Date
      ? Utilities.formatDate(r.Order_Date, "Asia/Kolkata", "yyyy-MM-dd")
      : String(r.Order_Date || "").trim();
    if (phones.includes(String(r.Phone||"").trim()) &&
        od >= dateFrom &&
        od <= dateTo   &&
        (r.Payment_Status === "Pending" ||
         r.Payment_Status === "on account" ||
         !r.Payment_Status)) {
      ws.getRange(r._row, hIdx["Payment_Status"]).setValue("Paid");
      updated++;
    }
  });
  return {success:true, updatedRows:updated, customersMarked:phones.length};
}

// ── GET ORDER HISTORY (date range) ────────────────────────────────────────────
function getOrderHistory(p) {
  var dateFrom = p.dateFrom, dateTo = p.dateTo;
  if (!dateFrom || !dateTo) return {success:false, error:"dateFrom and dateTo required"};

  var ss   = getSpreadsheet();
  var ws   = getOrCreateTab(ss, TAB_ORDERS, ORDERS_HEADERS);
  // Live + archived orders for the range (archives opened only when the range
  // overlaps an archived month), plus IntentAmplify orders (tagged [IA]).
  var rows = getOrdersInRangeWithArchive(dateFrom, dateTo)
               .concat(typeof ia_rowsAsSK === "function" ? ia_rowsAsSK() : []);

  var fmtDate = function(v) {
    return v instanceof Date ? Utilities.formatDate(v,"Asia/Kolkata","yyyy-MM-dd") : String(v).trim();
  };

  var filtered = rows.filter(function(r) {
    var d = fmtDate(r.Order_Date);
    return d >= dateFrom && d <= dateTo && !_isOrderCancelled(r.Payment_Status);
  });

  var orders = filtered.map(function(r) {
    var items = {};
    try { if (r.Items_JSON) items = JSON.parse(r.Items_JSON); } catch(e) {}
    return {
      id:             r.Submission_ID,
      date:           fmtDate(r.Order_Date),
      meal:           r.Meal_Type,
      name:           r.Customer_Name,
      phone:          r.Phone,
      area:           r.Area || "",
      wing:           r.Wing || "",
      flat:           r.Flat || "",
      total:          Number(r.Net_Total) || 0,
      gross:          Number(r.Gross_Total) || 0,
      status:         r.Payment_Status || "Pending",
      payment_method: r.Payment_Method || "UPI",
      notes:          r.Special_Notes || "",
      items:          items,
      delivery:       Number(r.Delivery_Charge) || 0,
      discount:       Number(r.Loyalty_Discount) || 0
    };
  });

  var totalRev     = orders.reduce(function(s,o){return s+o.total;},0);
  var totalPaid    = orders.filter(function(o){
    return String(o.status)==="Paid" || String(o.status)==="Wallet Paid" || String(o.status)==="Collected";
  }).reduce(function(s,o){return s+o.total;},0);
  var uniqueCusts  = Object.keys(orders.reduce(function(m,o){m[o.phone]=1;return m;},{})).length;

  return {
    success: true,
    orders:  orders,
    summary: {
      orderCount:      orders.length,
      uniqueCustomers: uniqueCusts,
      totalRevenue:    Math.round(totalRev),
      totalPaid:       Math.round(totalPaid),
      totalPending:    Math.round(totalRev - totalPaid)
    }
  };
}

// ── GET CUSTOMER LIST ─────────────────────────────────────────────────────────
function getCustomerList() {
  var ss   = getSpreadsheet();
  var ordersWs = getOrCreateTab(ss, TAB_ORDERS, ORDERS_HEADERS);
  // Include archived orders so lifetime stats (order_count, total_spent)
  // don't reset every month after archiving. Live + archived merged.
  var today = Utilities.formatDate(new Date(), "Asia/Kolkata", "yyyy-MM-dd");
  var ordRows = getOrdersInRangeWithArchive("2024-01-01", today);

  var custWs = getOrCreateTab(ss, TAB_CUSTOMERS, CUSTOMERS_HEADERS);
  var custRows = getAllRows(custWs);
  var cMap = {};
  custRows.forEach(function(c) {
    var p = _normalizePhone(c.Phone);
    if (p) {
      cMap[p] = {
        count: Number(c.Review_Promo_Count) || 0,
        claimed: (String(c.Review_Reward_Claimed) === "TRUE" || String(c.Review_Reward_Claimed) === "true"),
        standardOrder: c.Standard_Order || "",
        feeExempt: (String(c.Fee_Exempt).trim() === "Yes") ? "Yes" : "No",
        onAccount: (String(c.On_Account).trim() === "Yes") ? "Yes" : "No",
        billingCycle: c.Billing_Cycle || "Daily",
        // Address profiles
        wing:    c.Wing || "",
        flat:    c.Flat || "",
        floor:   c.Floor || "",
        society: c.Society || "",
        maps:    c.Maps_Link || "",
        landmark: c.Landmark || "",
        delivery_point: c.Delivery_Point || ""
      };
    }
  });

  var fmtDate = function(v) {
    return v instanceof Date ? Utilities.formatDate(v,"Asia/Kolkata","yyyy-MM-dd") : String(v).trim();
  };

  var map = {};
  ordRows.forEach(function(r) {
    if (_isOrderCancelled(r.Payment_Status)) return;
    var phone = String(r.Phone||"").trim();
    if (!phone) return;
    var normP = _normalizePhone(phone);
    var d = fmtDate(r.Order_Date);
    if (!map[phone]) {
      map[phone] = {
        phone:phone, 
        name:String(r.Customer_Name||"").trim(),
        area:String(r.Area||"").trim(), 
        payFreq:String(r.Payment_Freq||"").trim(),
        orderCount:0, 
        totalSpent:0, 
        pendingAmt:0, 
        lastDate:"",
        promoCount: cMap[normP] ? cMap[normP].count : 0,
        reviewClaimed: cMap[normP] ? cMap[normP].claimed : false,
        standardOrder: cMap[normP] ? cMap[normP].standardOrder : "",
        Fee_Exempt:    cMap[normP] ? cMap[normP].feeExempt : "No",
        onAccount:     cMap[normP] ? cMap[normP].onAccount : "No",
        billingCycle:  cMap[normP] ? cMap[normP].billingCycle : "Daily",
        wing:    cMap[normP] ? cMap[normP].wing : "",
        flat:    cMap[normP] ? cMap[normP].flat : "",
        floor:   cMap[normP] ? cMap[normP].floor : "",
        society: cMap[normP] ? cMap[normP].society : "",
        maps:    cMap[normP] ? cMap[normP].maps : "",
        landmark: cMap[normP] ? cMap[normP].landmark : "",
        delivery_point: cMap[normP] ? cMap[normP].delivery_point : ""
      };
    }
    map[phone].orderCount++;
    map[phone].totalSpent += Number(r.Net_Total)||0;
    const ps = String(r.Payment_Status || "").trim();
    if (ps !== "Paid" && ps !== "Wallet Paid" && ps !== "Collected") map[phone].pendingAmt += Number(r.Net_Total)||0;
    if (d > map[phone].lastDate) {
      map[phone].lastDate = d;
      map[phone].name = String(r.Customer_Name||map[phone].name).trim();
    }
  });

  // Also include SK_Customers entries that have never placed an order (e.g. pre-registered VIPs)
  custRows.forEach(function(c) {
    var p = String(c.Phone || "").trim();
    if (!p) return;
    var normP = _normalizePhone(p);
    if (map[p]) return; // already in map from orders
    // Only surface pre-registered VIPs (Fee_Exempt = Yes) to keep the list clean
    if (String(c.Fee_Exempt).trim() !== "Yes") return;
    map[p] = {
      phone: p,
      name: String(c.Customer_Name || "").trim(),
      area: String(c.Area || "").trim(),
      payFreq: String(c.Payment_Freq || "").trim(),
      orderCount: 0,
      totalSpent: 0,
      pendingAmt: 0,
      lastDate: String(c.Created_At instanceof Date
        ? Utilities.formatDate(c.Created_At, "Asia/Kolkata", "yyyy-MM-dd")
        : (c.Created_At || "")).slice(0, 10),
      promoCount: 0,
      reviewClaimed: false,
      standardOrder: "",
      Fee_Exempt: "Yes",
      onAccount: String(c.On_Account).trim() === "Yes" ? "Yes" : "No",
      billingCycle: c.Billing_Cycle || "Daily"
    };
  });

  // Load wallet rows ONCE — avoids N API calls inside the map loop
  var walletWs = getOrCreateTab(ss, TAB_WALLET, WALLET_HEADERS);
  var walletRows = getAllRows(walletWs);

  var customers = Object.values(map)
    .map(function(c){
      const wb = _calculateWalletBalance(c.phone, walletRows);
      const net = Math.round(c.pendingAmt - wb);
      return Object.assign({}, c, {
        totalSpent: Math.round(c.totalSpent),
        pendingAmt: net,
        walletBalance: Math.round(wb)
      });
    })
    .sort(function(a,b){return b.lastDate.localeCompare(a.lastDate);});

  return {success:true, customers:customers};
}

function markReviewed(body) {
  var phone = body.phone;
  if (!phone) return {success:false, error:"phone required"};

  var ss   = getSpreadsheet();
  var ws   = getOrCreateTab(ss, TAB_CUSTOMERS, CUSTOMERS_HEADERS);
  var hIdx = headerIndex(ws);
  var rows = getAllRows(ws);
  var normP = _normalizePhone(phone);

  var r = rows.find(function(x) { return _normalizePhone(x.Phone) === normP; });
  if (!r) return {success:false, error:"Customer not found"};

  var col = hIdx["Review_Promo_Count"];
  if (!col) return {success:false, error:"Review_Promo_Count column missing"};

  var current = Number(r.Review_Promo_Count) || 0;
  ws.getRange(r._row, col).setValue(current + 3);

  // Mark as claimed
  var claimCol = hIdx["Review_Reward_Claimed"];
  if (claimCol) {
    ws.getRange(r._row, claimCol).setValue("TRUE");
  }

  return {success:true, newCount: current + 3};
}

// ── GET CUSTOMER HISTORY ──────────────────────────────────────────────────────
function getCustomerHistory(phone) {
  if (!phone) return {success:false, error:"phone required"};

  var ss   = getSpreadsheet();
  var ws   = getOrCreateTab(ss, TAB_ORDERS, ORDERS_HEADERS);
  var fmtDate = function(v) {
    return v instanceof Date ? Utilities.formatDate(v,"Asia/Kolkata","yyyy-MM-dd") : String(v).trim();
  };

  // Live + archived (all-time) so a customer's older orders survive archiving.
  var today = Utilities.formatDate(new Date(), "Asia/Kolkata", "yyyy-MM-dd");
  var rows = getOrdersInRangeWithArchive("2024-01-01", today)
               .filter(function(r){return String(r.Phone||"").trim()===phone;});

  var orders = rows.map(function(r) {
    return {
      id:       r.Submission_ID,
      date:     fmtDate(r.Order_Date),
      meal:     r.Meal_Type,
      area:     r.Area,
      total:    Number(r.Net_Total)||0,
      subtotal: Number(r.Food_Subtotal)||0,
      delivery: Number(r.Delivery_Charge)||0,
      discount: Number(r.Discount_Amount)||0,
      status:   r.Payment_Status||"Pending",
      items:    r.Items_JSON,
      notes:    r.Special_Notes||""
    };
  }).sort(function(a,b){return b.date.localeCompare(a.date);});

  var name       = rows.length ? String(rows[0].Customer_Name||"").trim() : "";
  var area       = rows.length ? String(rows[0].Area||"").trim() : "";
  var payFreq    = rows.length ? String(rows[0].Payment_Freq||"").trim() : "";
  var activeOrders = orders.filter(function(o){return !_isOrderCancelled(o.status);});
  var totalSpent = Math.round(activeOrders.reduce(function(s,o){return s+o.total;},0));
  var pending    = Math.round(activeOrders.filter(function(o){return String(o.status)!=="Paid" && String(o.status)!=="Wallet Paid";}).reduce(function(s,o){return s+o.total;},0));

  // Fetch Standard_Order from customer sheet
  var custWs = getOrCreateTab(ss, TAB_CUSTOMERS, CUSTOMERS_HEADERS);
  var cRows = getAllRows(custWs);
  var normP = _normalizePhone(phone);
  var standardOrder = "";
  var custMatch = cRows.find(function(c){ return _normalizePhone(c.Phone) === normP; });
  if (custMatch) standardOrder = custMatch.Standard_Order || "";

  var feeExempt = custMatch ? (String(custMatch.Fee_Exempt).trim() === "Yes" ? "Yes" : "No") : "No";
  var onAccount = custMatch ? (String(custMatch.On_Account).trim() === "Yes" ? "Yes" : "No") : "No";
  var billingCycle = custMatch ? (custMatch.Billing_Cycle || "Daily") : "Daily";

  return {
    success:true, phone:phone, name:name, area:area, payFreq:payFreq,
    orders:orders, totalSpent:totalSpent, pending:pending, orderCount:orders.length,
    standardOrder: standardOrder, Fee_Exempt: feeExempt, On_Account: onAccount, Billing_Cycle: billingCycle,
    // Add full address profile
    wing:    custMatch ? (custMatch.Wing || "") : "",
    flat:    custMatch ? (custMatch.Flat || "") : "",
    floor:   custMatch ? (custMatch.Floor || "") : "",
    society: custMatch ? (custMatch.Society || "") : "",
    maps:    custMatch ? (custMatch.Maps_Link || "") : "",
    landmark: custMatch ? (custMatch.Landmark || "") : "",
    delivery_point: custMatch ? (custMatch.Delivery_Point || "") : ""
  };
}

// ── GET DATE PAYMENTS ─────────────────────────────────────────────────────────
function getDatePayments(date) {
  if (!date) return {success:false, error:"date required"};

  var ss   = getSpreadsheet();
  var ws   = getOrCreateTab(ss, TAB_ORDERS, ORDERS_HEADERS);
  var fmtDate = function(v) {
    return v instanceof Date ? Utilities.formatDate(v,"Asia/Kolkata","yyyy-MM-dd") : String(v).trim();
  };

  // Live + archived for this date (archive opened only if the date is archived).
  var rows = getOrdersInRangeWithArchive(date, date)
               .filter(function(r){return fmtDate(r.Order_Date)===date && !_isOrderCancelled(r.Payment_Status);});

  var map = {};
  rows.forEach(function(r) {
    var phone = String(r.Phone||"").trim();
    if (!phone) return;
    if (!map[phone]) map[phone] = {phone:phone, name:String(r.Customer_Name||"").trim(),
      payFreq:String(r.Payment_Freq||"").trim(), meals:[], total:0, allPaid:true};
    map[phone].meals.push(r.Meal_Type);
    map[phone].total += Number(r.Net_Total)||0;
    if (!["Paid", "Wallet Paid", "Collected", "On Account"].includes(String(r.Payment_Status))) map[phone].allPaid = false;
  });

  var customers = Object.values(map).map(function(c) {
    return Object.assign({},c,{
      total:  Math.round(c.total),
      daily:  c.payFreq.toLowerCase().includes("daily"),
      status: c.allPaid ? "Paid" : "Pending"
    });
  }).sort(function(a,b){return a.name.localeCompare(b.name);});

  var grandTotal   = customers.reduce(function(s,c){return s+c.total;},0);
  var grandPaid    = customers.filter(function(c){return c.status==="Paid";}).reduce(function(s,c){return s+c.total;},0);

  return {success:true, date:date, customers:customers,
          grandTotal:grandTotal, grandPaid:grandPaid, grandPending:grandTotal-grandPaid};
}

// ── MARK ORDERS STATUS (by customer phone + date) ─────────────────────────────
function markOrdersStatus(body) {
  var date   = body.date;
  var phone  = body.phone;
  var sid    = body.sid; // Submission ID for precision
  var status = body.status || "Paid";
  if (!date || !phone) return {success:false, error:"date and phone required"};

  // Prevent race-condition double-processing (e.g. admin double-clicks Verify & Refund)
  const lock = LockService.getScriptLock();
  try { lock.waitLock(8000); } catch(e) { return {success:false, error:"Server busy — please retry"}; }
  try {

  var ss    = getSpreadsheet();
  var ws    = getOrCreateTab(ss, TAB_ORDERS, ORDERS_HEADERS);
  var hIdx  = headerIndex(ws);
  var rows  = getAllRows(ws);
  
  var matches = rows.filter(function(r) {
    const d = r.Order_Date instanceof Date ? Utilities.formatDate(r.Order_Date,"Asia/Kolkata","yyyy-MM-dd") : String(r.Order_Date).trim();
    return d === date && String(r.Phone||"").trim() === phone && (!sid || String(r.Submission_ID) === String(sid));
  });

  if (!matches.length) return {success: false, error: "No matching orders found"};

  var updated = 0;
  var now = getISTDate();
  
  // Sort descending by row index to allow safe deletion
  matches.sort((a,b) => b._row - a._row).forEach(function(r) {
    const currentStatus = String(r.Payment_Status || "").trim();
    if (currentStatus === "Cancelled (Verify UPI)" && status === "Paid") {
      // ── Process Refund Logic based on preference
      const pref = String(r.Refund_Preference || "upi").toLowerCase();
      const custName = r.Customer_Name || "Customer";

      // ── Recompute correct refund at verify time (same logic as hard-cancel) ──
      // Uses Net_Total as base so mealCredit baked into Net_Total is not over-refunded.
      const scOrderDate = r.Order_Date instanceof Date
        ? Utilities.formatDate(r.Order_Date, "Asia/Kolkata", "yyyy-MM-dd")
        : String(r.Order_Date).trim();
      const scSameDayRows = rows.filter(x => {
        const xd = x.Order_Date instanceof Date
          ? Utilities.formatDate(x.Order_Date, "Asia/Kolkata", "yyyy-MM-dd")
          : String(x.Order_Date).trim();
        const xStat = String(x.Payment_Status || "").toLowerCase();
        return String(x.Phone).trim() === String(phone).trim() &&
               xd === scOrderDate &&
               String(x.Submission_ID) !== String(r.Submission_ID) &&
               !xStat.includes("deleted") && !xStat.includes("cancelled");
      });
      const scRemaining = scSameDayRows.reduce((s, x) => s + (Number(x.Food_Subtotal) || 0), 0);
      const scOldTotal  = scRemaining + (Number(r.Food_Subtotal) || 0);
      const scDiscRate  = (sub) => sub >= 450 ? 0.075 : sub >= 300 ? 0.05 : 0;
      const scOldRate   = scDiscRate(scOldTotal);
      const scNewRate   = scDiscRate(scRemaining);

      // Discount over-clawback on remaining rows
      let scOverDiscount = 0;
      if (scOldRate > scNewRate) {
        scOverDiscount = scSameDayRows.reduce((s, x) => {
          const xSub = Number(x.Food_Subtotal) || 0;
          return s + Math.round(xSub * scOldRate) - Math.round(xSub * scNewRate);
        }, 0);
        if (scOverDiscount > 0) {
          const scHIdx   = headerIndex(ws);
          const scDiscCol = scHIdx["Discount_Amount"];
          const scNetCol  = scHIdx["Net_Total"];
          scSameDayRows.forEach(x => {
            const xSub      = Number(x.Food_Subtotal)      || 0;
            const xSurcharge= Number(x.Inflation_Surcharge)|| 0;
            const xDelivery = Number(x.Delivery_Charge)    || 0;
            const xSmallFee = Number(x.Small_Order_Fee)    || 0;
            const xReviewD  = Number(x.Review_Discount)    || 0;
            const newD   = Math.round(xSub * scNewRate);
            const newNet = xSub + xDelivery + xSmallFee + xSurcharge - newD - xReviewD;
            if (scDiscCol) ws.getRange(x._row, scDiscCol).setValue(newD);
            if (scNetCol)  ws.getRange(x._row, scNetCol) .setValue(newNet);
          });
        }
      }

      // Delivery/small-fee clawback + row updates
      let scDeliveryOwed = 0;
      let scSmallFeeOwed = 0;
      const scFreeAreas  = getAreas().filter(a => a.free).map(a => a.name);
      const scIsNonFree  = (area) => !scFreeAreas.includes(area) && area !== "Self Pickup";
      // Dynamic free-delivery threshold by remaining meal count (matches submitOrder
      // and _deleteOrderInternal): 1 meal → ₹100, 2+ → ₹150. Was a static ₹150.
      const _scMeals = (arr) => new Set(arr.filter(x => (Number(x.Food_Subtotal) || 0) > 0).map(x => String(x.Meal_Type).trim())).size;
      const scOldThr = _scMeals(scSameDayRows.concat([r])) <= 1 ? 100 : 150;
      const scRemThr = _scMeals(scSameDayRows) <= 1 ? 100 : 150;
      if (scOldTotal >= scOldThr && scRemaining < scRemThr) {
        const scHIdx2    = headerIndex(ws);
        const scDelCol   = scHIdx2["Delivery_Charge"];
        const scSmallCol = scHIdx2["Small_Order_Fee"];
        const scNetCol2  = scHIdx2["Net_Total"];
        scSameDayRows.forEach(x => {
          const xSub  = Number(x.Food_Subtotal) || 0;
          const xMeal = String(x.Meal_Type).trim();
          let scNetDelta = 0;
          // Delivery is ₹11 everywhere — refund deduction and stored charge must match.
          if (xSub > 0 && scIsNonFree(x.Area || "") && (Number(x.Delivery_Charge) || 0) === 0) {
            scDeliveryOwed += 11; scNetDelta += 11;
            if (scDelCol) ws.getRange(x._row, scDelCol).setValue(11);
          }
          if ((xMeal === "Lunch" || xMeal === "Dinner") && xSub > 0 && xSub < 50
              && (Number(x.Small_Order_Fee) || 0) === 0) {
            scSmallFeeOwed += 10; scNetDelta += 10;
            if (scSmallCol) ws.getRange(x._row, scSmallCol).setValue(10);
          }
          if (scNetDelta > 0 && scNetCol2) {
            ws.getRange(x._row, scNetCol2).setValue((Number(x.Net_Total) || 0) + scNetDelta);
          }
        });
      }

      const scAdj = scOverDiscount + scDeliveryOwed + scSmallFeeOwed;
      const amt   = Math.max(0, (Number(r.Net_Total) || 0) - scAdj);

      // ── Duplicate refund guard (shared for all paths below)
      const REF_HEADERS = ["Submission_ID","Phone","Name","Amount","Meal","Date","Status","Timestamp","Adjustment_Note","Refund_Mode"];
      const refWs = getOrCreateTab(ss, TAB_REFUNDS, REF_HEADERS);
      const existingRefunds = getAllRows(refWs);
      const alreadyExists = existingRefunds.some(rx => String(rx.Submission_ID) === String(r.Submission_ID));

      const isSplitOrder = String(r.Payment_Method || "").trim().toLowerCase() === "split";

      if (isSplitOrder) {
        // Split orders: entire refund always goes to Wallet — simple, no UPI queue.
        // Wallet portion was already deducted at order time, UPI portion was paid by customer.
        // Both come back to wallet in full.
        if (amt > 0) {
          _appendWalletTransaction(phone, custName, "Order Cancellation Refund", amt, true, String(r.Submission_ID));
        }
      } else if (pref === "wallet" && amt > 0) {
        _appendWalletTransaction(phone, custName, "Order Cancellation Refund", amt, true, String(r.Submission_ID));
      } else if (pref === "manual_upi" && amt > 0 && !alreadyExists) {
        refWs.appendRow([r.Submission_ID, phone, custName, amt, r.Meal_Type, date, "Pending", now, "Verified Soft Cancellation", "upi"]);
      }
      let finalCancelStatus = "Cancelled";
      if (isSplitOrder) {
        finalCancelStatus = "Cancelled \u2013 Refunded to Wallet";
      } else if (pref === "wallet") {
        finalCancelStatus = "Cancelled \u2013 Refunded to Wallet";
      } else if (pref === "manual_upi") {
        finalCancelStatus = "Cancelled \u2013 UPI Refund Pending";
      }
      ws.getRange(r._row, hIdx["Payment_Status"]).setValue(finalCancelStatus);
    } else {
      // ── Standard Payment Approval or Rejection
      ws.getRange(r._row, hIdx["Payment_Status"]).setValue(status);
    }
    updated++;
  });

  return {success:true, updatedRows:updated};
  } finally {
    lock.releaseLock();
  }
}

function rejectUPIPayment(body) {
  body.status = "Payment Rejected";
  return markOrdersStatus(body);
}

// ── DELETED OBSOLETE ADMIN CANCEL ORDER (Merged with main) ──
/**
 * Marks a specific order as 'Packed' in the SK_Orders sheet.
 * Called by the Kitchen Dashboard (kitchen.html) via APPS_SCRIPT_URL.
 */
function markOrderPacked(body) {
  var id = body.submissionId;
  if (!id) return {success:false, error: "submissionId required"};

  var ss    = getSpreadsheet();
  var ws    = getOrCreateTab(ss, TAB_ORDERS, ORDERS_HEADERS);
  var hIdx  = headerIndex(ws);
  var rows  = getAllRows(ws);
  
  if (hIdx.Packed === undefined) return {success:false, error: "Packed column not found"};

  var order = rows.find(function(r) {
    return String(r.Submission_ID) === String(id);
  });

  if (order) {
    ws.getRange(order._row, hIdx.Packed).setValue(true);
    return {success:true};
  }
  
  return {success:false, error: "Order not found"};
}

// ── ANALYTICS ─────────────────────────────────────────────────────────────────
function getAnalytics(p) {
  var dateFrom = p.dateFrom, dateTo = p.dateTo;
  if (!dateFrom || !dateTo) return {success:false, error:"dateFrom and dateTo required"};
  var ss  = getSpreadsheet();
  var fmtDate = function(v) {
    return v instanceof Date ? Utilities.formatDate(v,"Asia/Kolkata","yyyy-MM-dd") : String(v).trim();
  };
  // Pull from BOTH the live sheet and any archived monthly files that
  // overlap this date range. 10-min CacheService cache keeps repeat
  // queries fast.
  var combined = getOrdersInRangeWithArchive(dateFrom, dateTo);
  // Merge IntentAmplify orders in range into combined analytics revenue.
  try {
    if (typeof ia_rowsAsSK === "function") {
      var _iaInRange = ia_rowsAsSK().filter(function(r) {
        var d = fmtDate(r.Order_Date);
        return d >= dateFrom && d <= dateTo;
      });
      combined = combined.concat(_iaInRange);
    }
  } catch(_) {}
  var rows = combined.filter(function(r) {
    return !_isOrderCancelled(r.Payment_Status);
  });
  var liveCount = 0;
  try {
    var ws = getOrCreateTab(ss, TAB_ORDERS, ORDERS_HEADERS);
    liveCount = getAllRows(ws).filter(function(r) {
      var d = fmtDate(r.Order_Date);
      return d >= dateFrom && d <= dateTo;
    }).length;
  } catch(_) {}
  var archivedCount = combined.length - liveCount;

  // ── Option B: Exact Small Order Fee backfill ──────────────────────────────
  // Pre-pass 1: build VIP set from profiles (Fee_Exempt = Yes)
  var profWs   = getOrCreateTab(ss, TAB_CUSTOMERS, CUSTOMERS_HEADERS);
  var profRows = getAllRows(profWs);
  var vipSet   = {};
  profRows.forEach(function(pr) {
    if (pr.Fee_Exempt === "Yes" || pr.Fee_Exempt === true) {
      vipSet[String(pr.Phone||"").trim()] = true;
    }
  });

  // Pre-pass 2: for every phone+date combo, sum food subtotals & count distinct meals
  // This lets us know if the combined day total reached the free-delivery threshold,
  // which also waives the small order fee.
  var dayTotals = {}; // key = phone+"_"+date  →  { foodTotal, mealCount }
  rows.forEach(function(r) {
    var ph   = String(r.Phone||"").trim();
    var d    = fmtDate(r.Order_Date);
    var food = Number(r.Food_Subtotal)||0;
    var key  = ph + "_" + d;
    if (!dayTotals[key]) dayTotals[key] = { foodTotal:0, meals:{} };
    dayTotals[key].foodTotal += food;
    dayTotals[key].meals[String(r.Meal_Type||"")] = true;
  });

  // Helper: calculate small fee for a row using exact rules
  function calcSmallFee(r) {
    var stored = r.Small_Order_Fee;
    // If the column exists and has a numeric value, trust it
    if (stored !== undefined && stored !== null && stored !== "" && !isNaN(Number(stored))) {
      return Number(stored);
    }
    // Backfill for old rows
    var meal = String(r.Meal_Type||"");
    if (meal !== "Lunch" && meal !== "Dinner") return 0; // Breakfast: never charged
    var food = Number(r.Food_Subtotal)||0;
    if (food <= 0 || food >= 50) return 0;              // Only charged when sub < ₹50
    var area = String(r.Area||"").trim();
    if (area === "Self Pickup") return 0;                // Pickup: waived
    var ph  = String(r.Phone||"").trim();
    if (vipSet[ph]) return 0;                            // VIP: waived
    // Check if combined day food total crossed free-delivery threshold
    var d   = fmtDate(r.Order_Date);
    var key = ph + "_" + d;
    var dt  = dayTotals[key] || {foodTotal:0, meals:{}};
    var mealCount    = Object.keys(dt.meals).length;
    var threshold    = mealCount <= 1 ? 100 : 150;
    if (dt.foodTotal >= threshold) return 0;             // Day crossed threshold: waived
    return 10;
  }
  // ── End backfill helper ───────────────────────────────────────────────────
  var LUNCH_COLS = ["Chapati","Without_Oil_Chapati","Phulka","Ghee_Phulka","Jowar_Bhakri","Bajra_Bhakri",
    "Dry_Sabji_Mini","Dry_Sabji_Full","Curry_Sabji_Mini","Curry_Sabji_Full","Dal","Rice","Salad","Curd"];
  var COL_DISP = {"Chapati":"Chapati","Without_Oil_Chapati":"WO Chapati","Phulka":"Phulka","Ghee_Phulka":"Ghee Phulka",
    "Jowar_Bhakri":"Jowar Bhakri","Bajra_Bhakri":"Bajra Bhakri","Dry_Sabji_Mini":"Dry Sabji Mini",
    "Dry_Sabji_Full":"Dry Sabji Full","Curry_Sabji_Mini":"Curry Sabji Mini","Curry_Sabji_Full":"Curry Sabji Full",
    "Dal":"Dal","Rice":"Rice","Salad":"Salad","Curd":"Curd"};
  var totalRev=0, totalPaid=0, totalDelivery=0, totalSurcharge=0, totalSmallFee=0;
  var custSet={}, dayMap={};
  var mealStats={Breakfast:{count:0,revenue:0},Lunch:{count:0,revenue:0},Dinner:{count:0,revenue:0}};
  var itemCounts={};
  rows.forEach(function(r) {
    var d=fmtDate(r.Order_Date), net=Number(r.Net_Total)||0;
    var delivery=Number(r.Delivery_Charge)||0;
    var food=Number(r.Food_Subtotal)||0;
    // Backfill surcharge for old rows where Inflation_Surcharge column was blank
    var surchargeRaw=Number(r.Inflation_Surcharge);
    var surcharge = (!isNaN(surchargeRaw) && surchargeRaw > 0) ? surchargeRaw : (food > 0 ? Math.ceil(food*0.06) : 0);
    // Small_Order_Fee: exact backfill using Option B (checks VIP, pickup, day threshold)
    var smallFee = calcSmallFee(r);
    var payStatus = String(r.Payment_Status || "").trim();
    totalRev+=net;
    totalDelivery+=delivery; totalSurcharge+=surcharge; totalSmallFee+=smallFee;
    if(payStatus==="Paid"||payStatus==="Wallet Paid"||payStatus==="Collected") totalPaid+=net;
    var ph=String(r.Phone||"").trim(); if(ph) custSet[ph]=true;
    var meal=String(r.Meal_Type||"");
    if(mealStats[meal]){mealStats[meal].count++;mealStats[meal].revenue+=net;}
    if(!dayMap[d]) dayMap[d]={orders:0,revenue:0,delivery:0,surcharge:0,smallFee:0};
    dayMap[d].orders++; dayMap[d].revenue+=net;
    dayMap[d].delivery+=delivery; dayMap[d].surcharge+=surcharge; dayMap[d].smallFee+=smallFee;
    if(meal==="Breakfast"){
      for(var n=1;n<=4;n++){var bi=String(r["BF_Item_"+n]||"").trim(),bq=Number(r["BF_Qty_"+n])||0;if(bi&&bq>0)itemCounts[bi]=(itemCounts[bi]||0)+bq;}
      var cu=Number(r.Curd)||0; if(cu>0)itemCounts["Curd"]=(itemCounts["Curd"]||0)+cu;
    } else {
      LUNCH_COLS.forEach(function(col){var q=Number(r[col])||0;if(q>0){var dn=COL_DISP[col]||col;itemCounts[dn]=(itemCounts[dn]||0)+q;}});
    }
  });
  var days=Object.keys(dayMap).sort().map(function(d){
    return{date:d,orders:dayMap[d].orders,revenue:Math.round(dayMap[d].revenue),
           delivery:Math.round(dayMap[d].delivery),surcharge:Math.round(dayMap[d].surcharge),smallFee:Math.round(dayMap[d].smallFee)};
  });
  var allItems=Object.keys(itemCounts).map(function(k){return{name:k,count:Math.round(itemCounts[k])};}).sort(function(a,b){return b.count-a.count;});
  var topItems=allItems.slice(0,15);
  Object.keys(mealStats).forEach(function(m){mealStats[m].revenue=Math.round(mealStats[m].revenue);});
  return {success:true,
    summary:{orders:rows.length,customers:Object.keys(custSet).length,revenue:Math.round(totalRev),
      paid:Math.round(totalPaid),pending:Math.round(totalRev-totalPaid),
      avgPerDay:days.length>0?Math.round(totalRev/days.length):0,
      delivery:Math.round(totalDelivery),surcharge:Math.round(totalSurcharge),smallFee:Math.round(totalSmallFee)},
    meals:mealStats,days:days,topItems:topItems,allItems:allItems,
    // Lets the admin UI show "Including X archived orders" so they know
    // the report pulled across archive files (which is slower than live-only).
    archived:{count: archivedCount, included: archivedCount > 0}};
}

// ── ADMIN RESET CUSTOMER PIN ──────────────────────────────────────────────────
// Clears the PIN cell for a customer so they can set a new one on next login.
// The row is kept; getCustomer() then returns hasPin:false → the order flow
// shows the "set a new PIN" screen automatically.
function adminResetPin(body) {
  var phone = _normalizePhone(body.phone);
  if (!phone || phone.length < 10) return { success: false, error: "Valid phone required" };
  var ss = getSpreadsheet();
  var ws = getOrCreateTab(ss, TAB_CUSTOMERS, CUSTOMERS_HEADERS);
  if (ws.getLastRow() < 2) return { success: false, error: "Customer not found." };
  var headers = ws.getRange(1, 1, 1, ws.getLastColumn()).getValues()[0];
  var pinCol   = headers.indexOf("PIN") + 1;
  var phoneCol = headers.indexOf("Phone");
  if (!pinCol || phoneCol < 0) return { success: false, error: "Schema error: PIN/Phone column missing." };
  var data = ws.getRange(2, 1, ws.getLastRow() - 1, ws.getLastColumn()).getValues();
  for (var i = 0; i < data.length; i++) {
    if (_normalizePhone(data[i][phoneCol]) === phone) {
      ws.getRange(i + 2, pinCol).setValue("");
      return { success: true };
    }
  }
  return { success: false, error: "Customer not found." };
}

// ── ADMIN WALLET CREDIT ───────────────────────────────────────────────────────
function adminCreditWallet(body) {
  var phone  = String(body.phone || "").trim();
  var amount = Number(body.amount);
  if (!phone || phone.length < 10) return {success:false, error:"Valid phone required"};
  if (!amount || amount <= 0)      return {success:false, error:"Amount must be > 0"};

  // Look up customer name
  var ss      = getSpreadsheet();
  var profWs  = getOrCreateTab(ss, TAB_CUSTOMERS, CUSTOMERS_HEADERS);
  var profRows = getAllRows(profWs);
  var profile  = profRows.find(function(r){ return String(r.Phone||"").trim() === phone; });
  var name     = profile ? (String(profile.Customer_Name||"").trim() || "Customer") : "Customer";

  _appendWalletTransaction(phone, name, "Admin Credit", amount, true, "ADMIN-" + Date.now());
  const settleRes = _autoSettlePendingOrders(phone);
  var newBalance = _calculateWalletBalance(phone);
  
  let msg = `₹${amount} credited to ${phone}. New balance: ₹${Math.round(newBalance)}`;
  if (settleRes.msg) {
    msg = settleRes.msg;
  }
  
  return {success:true, newBalance: Math.round(newBalance), msg: msg};
}

// ── INVENTORY ─────────────────────────────────────────────────────────────────
// Tracks raw material purchases. Each new entry for the same item auto-calculates
// how long the previous batch lasted → builds consumption rate over time.
const TAB_INVENTORY      = "SK_Inventory";
const INVENTORY_HEADERS  = [
  "Entry_ID","Date","Item","Unit","Quantity","Price_Paid","Notes","Timestamp"
];

function saveInventoryEntry(body) {
  var ss   = getSpreadsheet();
  var ws   = getOrCreateTab(ss, TAB_INVENTORY, INVENTORY_HEADERS);
  var now  = new Date();
  var id   = "INV-" + Utilities.formatDate(now,"Asia/Kolkata","yyyyMMdd") + "-" + Math.floor(Math.random()*9000+1000);
  var hIdx = headerIndex(ws);
  var totalCols = Math.max(ws.getLastColumn(), INVENTORY_HEADERS.length);
  var row  = new Array(totalCols).fill("");
  var set  = function(col, val) { if (hIdx[col]) row[hIdx[col]-1] = val; };

  set("Entry_ID",   id);
  set("Date",       String(body.date || Utilities.formatDate(now,"Asia/Kolkata","yyyy-MM-dd")));
  set("Item",       String(body.item || "").trim());
  set("Unit",       String(body.unit || "kg"));
  set("Quantity",   Number(body.quantity) || 0);
  set("Price_Paid", Number(body.price)    || 0);
  set("Notes",      String(body.notes     || ""));
  set("Timestamp",  getISTTimestamp());

  ws.appendRow(row);
  return { success: true, id: id };
}

function getInventoryData(body) {
  var ss   = getSpreadsheet();
  var ws   = getOrCreateTab(ss, TAB_INVENTORY, INVENTORY_HEADERS);
  var rows = getAllRows(ws);

  // Sort ascending by date for correct duration calculation
  rows.sort(function(a,b){ return String(a.Date).localeCompare(String(b.Date)); });

  // Group by item
  var byItem = {};
  rows.forEach(function(r) {
    var item = String(r.Item || "").trim();
    if (!item) return;
    if (!byItem[item]) byItem[item] = [];
    byItem[item].push({
      id:       String(r.Entry_ID || ""),
      date:     String(r.Date     || ""),
      unit:     String(r.Unit     || "kg"),
      qty:      Number(r.Quantity) || 0,
      price:    Number(r.Price_Paid) || 0,
      notes:    String(r.Notes    || ""),
      timestamp:String(r.Timestamp || "")
    });
  });

  // For each item, calculate durations between entries + consumption stats
  var items = [];
  Object.keys(byItem).sort().forEach(function(item) {
    var entries = byItem[item];
    var totalDays = 0, totalQty = 0, durationCount = 0;

    // Annotate each entry with how long it lasted (days until next purchase)
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      e.lasted_days = null;
      e.daily_rate  = null;
      if (i < entries.length - 1) {
        var d1 = new Date(e.date);
        var d2 = new Date(entries[i+1].date);
        var days = Math.round((d2 - d1) / 86400000);
        if (days > 0) {
          e.lasted_days = days;
          e.daily_rate  = Math.round((e.qty / days) * 100) / 100;
          totalDays += days;
          totalQty  += e.qty;
          durationCount++;
        }
      }
    }

    var avgDays       = durationCount > 0 ? Math.round(totalDays / durationCount) : null;
    var avgDailyRate  = (avgDays && totalQty) ? Math.round((totalQty / durationCount / avgDays) * 100) / 100 : null;
    var lastEntry     = entries[entries.length - 1];

    // Predict next purchase date
    var nextBuyDate = null;
    if (avgDays && lastEntry.date) {
      var d = new Date(lastEntry.date);
      d.setDate(d.getDate() + avgDays);
      nextBuyDate = Utilities.formatDate(d, "Asia/Kolkata", "yyyy-MM-dd");
    }

    items.push({
      item:          item,
      unit:          lastEntry.unit,
      entries:       entries.reverse(), // newest first for display
      entry_count:   entries.length,
      avg_days:      avgDays,
      avg_daily_rate:avgDailyRate,
      last_purchased:lastEntry.date,
      last_qty:      lastEntry.qty,
      next_buy_est:  nextBuyDate
    });
  });

  return { success: true, items: items };
}

function deleteInventoryEntry(body) {
  var ss   = getSpreadsheet();
  var ws   = getOrCreateTab(ss, TAB_INVENTORY, INVENTORY_HEADERS);
  var hIdx = headerIndex(ws);
  var rows = ws.getDataRange().getValues();
  var idCol = (hIdx["Entry_ID"] || 1) - 1;
  for (var i = rows.length - 1; i >= 1; i--) {
    if (String(rows[i][idCol]).trim() === String(body.id || "").trim()) {
      ws.deleteRow(i + 1);
      return { success: true };
    }
  }
  return { success: false, error: "Entry not found" };
}

// ── EXPENSE CUSTOM CATEGORIES ─────────────────────────────────────────────────
// Stored in Script Properties as JSON so no extra sheet is needed.
function getCustomExpenseCategories() {
  try {
    var raw = PropertiesService.getScriptProperties().getProperty("CUSTOM_EXP_CATS");
    return raw ? JSON.parse(raw) : {};
  } catch(e) { return {}; }
}

function saveCustomExpenseCategory(body) {
  var category = String(body.category || "").trim();
  var item     = String(body.item     || "").trim();
  if (!category) return { success:false, error:"Category required" };
  var cats = getCustomExpenseCategories();
  if (!cats[category]) cats[category] = [];
  if (item && !cats[category].includes(item)) cats[category].push(item);
  PropertiesService.getScriptProperties().setProperty("CUSTOM_EXP_CATS", JSON.stringify(cats));
  return { success:true, categories: cats };
}

function deleteCustomExpenseCategory(body) {
  var category = String(body.category || "").trim();
  var item     = String(body.item     || "").trim();
  var cats = getCustomExpenseCategories();
  if (item && cats[category]) {
    cats[category] = cats[category].filter(function(i){ return i !== item; });
  } else {
    delete cats[category];
  }
  PropertiesService.getScriptProperties().setProperty("CUSTOM_EXP_CATS", JSON.stringify(cats));
  return { success:true, categories: cats };
}

// ── KITCHEN EXPENSES ──────────────────────────────────────────────────────────
const TAB_EXPENSES      = "SK_Expenses";
const EXPENSES_HEADERS  = [
  "Expense_ID","Date","Category","Item","Amount","Frequency",
  "Payment_Mode","Notes","Timestamp"
];

// Category → sub-items map (also used by frontend for dropdowns)
var EXPENSE_CATEGORIES = {
  "🥦 Raw Materials": [
    "Vegetables & Greens","Fruits","Dairy (Milk/Curd/Paneer/Butter)",
    "Oil & Ghee","Spices & Masala","Dry Groceries (Dal/Rice/Atta)","Other Raw Material"
  ],
  "📦 Packaging": [
    "Containers / Boxes","Bags & Covers","Labels & Stickers",
    "Tissue & Napkins","Other Packaging"
  ],
  "⛽ Fuel & Transport": [
    "Petrol / CNG","Vehicle Maintenance","Delivery Outsourcing","Other Transport"
  ],
  "👨‍🍳 Staff": [
    "Cook Salary","Helper Salary","Delivery Person Salary","Part-time Staff","Other Staff"
  ],
  "🔌 Utilities": [
    "LPG Cylinder","Electricity Bill","Water Bill","Internet / Phone","Other Utility"
  ],
  "🍳 Kitchen & Equipment": [
    "Equipment Purchase","Equipment Repair / Service","Utensils","Cleaning Supplies","Other Kitchen"
  ],
  "📣 Marketing": [
    "Printing / Pamphlets","Online Advertising","Branding / Design","Other Marketing"
  ],
  "🏦 Finance & Admin": [
    "Bank Charges","Platform / Software Fees","GST / Tax","Other Finance"
  ],
  "📝 Miscellaneous": ["Miscellaneous"]
};

function saveExpense(body) {
  var ss   = getSpreadsheet();
  var ws   = getOrCreateTab(ss, TAB_EXPENSES, EXPENSES_HEADERS);
  var hIdx = headerIndex(ws);
  var now  = new Date();
  var id   = "EXP-" + Utilities.formatDate(now, "Asia/Kolkata", "yyyyMMdd") + "-" + Math.floor(Math.random()*9000+1000);

  var totalCols = ws.getLastColumn();
  var row = new Array(totalCols).fill("");
  var set = function(col, val) { if (hIdx[col]) row[hIdx[col]-1] = val; };

  set("Expense_ID",   id);
  set("Date",         String(body.date || Utilities.formatDate(now,"Asia/Kolkata","yyyy-MM-dd")));
  set("Category",     String(body.category  || ""));
  set("Item",         String(body.item      || ""));
  set("Amount",       Number(body.amount)   || 0);
  set("Frequency",    String(body.frequency || "One-time"));
  set("Payment_Mode", String(body.payment_mode || "Cash"));
  set("Notes",        String(body.notes     || ""));
  set("Timestamp",    getISTTimestamp());

  ws.appendRow(row);
  return { success: true, id: id };
}

function deleteExpense(body) {
  var ss   = getSpreadsheet();
  var ws   = getOrCreateTab(ss, TAB_EXPENSES, EXPENSES_HEADERS);
  var hIdx = headerIndex(ws);
  var rows = ws.getDataRange().getValues();
  var idCol = (hIdx["Expense_ID"] || 1) - 1;
  for (var i = rows.length - 1; i >= 1; i--) {
    if (String(rows[i][idCol]).trim() === String(body.id || "").trim()) {
      ws.deleteRow(i + 1);
      return { success: true };
    }
  }
  return { success: false, error: "Expense not found" };
}

function getExpenses(body) {
  var ss   = getSpreadsheet();
  var ws   = getOrCreateTab(ss, TAB_EXPENSES, EXPENSES_HEADERS);
  var rows = getAllRows(ws);
  var from = String(body.from || "");
  var to   = String(body.to   || "");
  var filtered = rows.filter(function(r) {
    var d = String(r.Date || "").trim();
    if (from && d < from) return false;
    if (to   && d > to)   return false;
    return true;
  });
  // Sort newest first
  filtered.sort(function(a,b){ return String(b.Date).localeCompare(String(a.Date)); });
  return {
    success: true,
    expenses: filtered.map(function(r) {
      return {
        id:           r.Expense_ID,
        date:         r.Date,
        category:     r.Category,
        item:         r.Item,
        amount:       Number(r.Amount) || 0,
        frequency:    r.Frequency,
        payment_mode: r.Payment_Mode,
        notes:        r.Notes,
        timestamp:    r.Timestamp
      };
    }),
    categories: EXPENSE_CATEGORIES
  };
}

function getExpenseAnalytics(body) {
  var ss   = getSpreadsheet();
  var ws   = getOrCreateTab(ss, TAB_EXPENSES, EXPENSES_HEADERS);
  var rows = getAllRows(ws);
  var from = String(body.from || "");
  var to   = String(body.to   || "");

  var filtered = rows.filter(function(r) {
    var d = String(r.Date || "").trim();
    if (!d) return false;
    if (from && d < from) return false;
    if (to   && d > to)   return false;
    return true;
  });

  var total       = 0;
  var byCat       = {};   // category → total
  var byFreq      = {};   // frequency → total
  var byPayMode   = {};   // payment mode → total
  var byDay       = {};   // date → total
  var topItems    = {};   // item → total
  var monthlyFixed = 0;   // sum of Monthly-tagged expenses

  filtered.forEach(function(r) {
    var amt  = Number(r.Amount) || 0;
    var cat  = String(r.Category || "Other");
    var freq = String(r.Frequency || "One-time");
    var pm   = String(r.Payment_Mode || "Cash");
    var d    = String(r.Date || "").trim();
    var item = String(r.Item || "Other");

    total += amt;
    byCat[cat]     = (byCat[cat]     || 0) + amt;
    byFreq[freq]   = (byFreq[freq]   || 0) + amt;
    byPayMode[pm]  = (byPayMode[pm]  || 0) + amt;
    byDay[d]       = (byDay[d]       || 0) + amt;
    topItems[item] = (topItems[item] || 0) + amt;
    if (freq === "Monthly") monthlyFixed += amt;
  });

  var days = Object.keys(byDay).sort().map(function(d) {
    return { date: d, amount: Math.round(byDay[d]) };
  });

  var catArr = Object.keys(byCat).sort(function(a,b){ return byCat[b]-byCat[a]; }).map(function(c) {
    return { category: c, amount: Math.round(byCat[c]) };
  });

  var itemArr = Object.keys(topItems).sort(function(a,b){ return topItems[b]-topItems[a]; }).slice(0,10).map(function(i) {
    return { item: i, amount: Math.round(topItems[i]) };
  });

  return {
    success:      true,
    total:        Math.round(total),
    monthlyFixed: Math.round(monthlyFixed),
    count:        filtered.length,
    byCategory:   catArr,
    byFrequency:  byFreq,
    byPayMode:    byPayMode,
    byDay:        days,
    topItems:     itemArr,
    categories:   EXPENSE_CATEGORIES
  };
}

// ── CLIENT ERROR LOG ──────────────────────────────────────────────────────────
const TAB_ERROR_LOG     = "SK_Error_Log";
// Column layout: structured JSON fields extracted for easy Sheets filtering.
// "Extra_JSON" holds any additional fields the client sends beyond the core set.
const ERROR_LOG_HEADERS = [
  "Timestamp","Date","Phone","Version","Type","Action",
  "Attempt","Duration_ms","Message","URL","Extra_JSON"
];

function logClientError(body) {
  try {
    var ss  = getSpreadsheet();
    var ws  = getOrCreateTab(ss, TAB_ERROR_LOG, ERROR_LOG_HEADERS);
    var now = new Date();
    var dateStr = Utilities.formatDate(now, "Asia/Kolkata", "yyyy-MM-dd");

    // Extract known fields; stash everything else in Extra_JSON for debugging
    var known = ["phone","version","type","action","attempt","ms","msg","url"];
    var extra  = {};
    Object.keys(body).forEach(function(k) { if (known.indexOf(k) === -1) extra[k] = body[k]; });

    ws.appendRow([
      getISTTimestamp(),
      dateStr,
      String(body.phone    || "unknown"),
      String(body.version  || ""),
      String(body.type     || "error"),
      String(body.action   || "unknown"),
      Number(body.attempt  || 1),
      Number(body.ms       || 0),
      String(body.msg      || ""),
      String(body.url      || ""),
      Object.keys(extra).length ? JSON.stringify(extra) : ""
    ]);
    return { success: true };
  } catch(e) {
    return { success: false }; // never throw — this is logging only
  }
}

// ── KEEP-ALIVE ────────────────────────────────────────────────────────────────
// Keeps the GAS instance warm so customers never hit a cold-start timeout.
// Set up once: Apps Script editor → Triggers → Add Trigger:
//   Function: keepAlive | Event: Time-based | Type: Minutes timer | Every: 10 minutes
function keepAlive() {
  // Intentionally empty — just waking the instance is enough.
  // GAS logs will show "keepAlive" executions confirming it's running.
}

// Run this once from Apps Script editor to register the trigger automatically.
// After that it runs forever — no manual intervention needed.
function setupKeepAliveTrigger() {
  // Remove any existing keepAlive trigger first (avoid duplicates)
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === "keepAlive") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("keepAlive")
    .timeBased()
    .everyMinutes(10)
    .create();
  Logger.log("keepAlive trigger registered — fires every 10 minutes.");
}

// ── QUARTERLY ARCHIVE ─────────────────────────────────────────────────────────
/*
  Archives SK_Orders and SK_Wallet for a given month into a new Google
  Spreadsheet, writes Balance Carry Forward snapshots so wallet balances are
  preserved, then deletes the archived rows from the main sheet.

  Runs on the 10th of every month — archives the previous calendar month.
  e.g. May 10 → archives April data.
*/
function archiveMonth(year, month) {
  if (!year || !month || month < 1 || month > 12)
    return {success:false, error:"Invalid year/month"};

  var MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  var pad = function(n) { return n < 10 ? "0"+n : String(n); };
  // Last day of month: day 0 of next month
  var lastDay = new Date(year, month, 0).getDate();
  var qr = {
    from:  year + "-" + pad(month) + "-01",
    to:    year + "-" + pad(month) + "-" + pad(lastDay),
    label: MONTH_NAMES[month - 1] + " " + year
  };

  // Single global lock for the whole archive operation. Without this, a
  // simultaneous order submission could write to SK_Orders between our
  // read and our rebuild, causing data loss.
  var lock = LockService.getScriptLock();
  try { lock.waitLock(30 * 60 * 1000); } catch (e) {
    return {success:false, error:"Could not acquire script lock (system busy). Try again in a minute."};
  }

  try {
    var ss = getSpreadsheet();
    var fmtDate = function(v) {
      return v instanceof Date
        ? Utilities.formatDate(v, "Asia/Kolkata", "yyyy-MM-dd")
        : String(v || "").trim().slice(0, 10);
    };

    // ── STEP 1: Create archive spreadsheet IN THE RIGHT YEAR FOLDER ─────────
    var archiveName = "Svaadh Kitchen Archive — " + qr.label;
    var archiveSS   = SpreadsheetApp.create(archiveName);
    var archiveFile = DriveApp.getFileById(archiveSS.getId());

    // Move to: Drive > WebBased Ordering > Archive > <year>/
    var yearFolder  = _getArchiveYearFolder(year);
    if (yearFolder) {
      try {
        var parents = archiveFile.getParents();
        while (parents.hasNext()) {
          var parent = parents.next();
          if (parent.getId() !== yearFolder.getId()) parent.removeFile(archiveFile);
        }
        yearFolder.addFile(archiveFile);
      } catch (e) {
        Logger.log("archiveMonth: could not move file to year folder: " + e.message);
      }
    }

    var log = [];

    // ── STEP 2: Read live SK_Orders into memory ─────────────────────────────
    var ordersWs      = getOrCreateTab(ss, TAB_ORDERS, ORDERS_HEADERS);
    var allOrderData  = ordersWs.getDataRange().getValues();
    var oHeaders      = allOrderData[0];
    var oDateIdx      = oHeaders.indexOf("Order_Date");

    // Partition into archive vs keep
    var toArchiveOrders = [];
    var keepOrders      = [];
    for (var i = 1; i < allOrderData.length; i++) {
      var d = fmtDate(allOrderData[i][oDateIdx]);
      if (d >= qr.from && d <= qr.to) {
        toArchiveOrders.push(allOrderData[i]);
      } else {
        keepOrders.push(allOrderData[i]);
      }
    }

    // ── STEP 3: Write SK_Orders to archive (verify) ─────────────────────────
    if (toArchiveOrders.length > 0) {
      var archiveOrderSheet = archiveSS.getActiveSheet();
      archiveOrderSheet.setName("SK_Orders");
      archiveOrderSheet.getRange(1, 1, 1, oHeaders.length).setValues([oHeaders]);
      archiveOrderSheet.getRange(2, 1, toArchiveOrders.length, oHeaders.length)
                       .setValues(toArchiveOrders);
      SpreadsheetApp.flush();
      var oWritten = archiveOrderSheet.getLastRow() - 1;
      if (oWritten !== toArchiveOrders.length) {
        return {success:false, error:"Order archive verification failed. Expected "
          + toArchiveOrders.length + ", got " + oWritten + ". Nothing deleted from live sheet."};
      }
      log.push(toArchiveOrders.length + " orders archived ✓");
    } else {
      log.push("No orders found for this month.");
    }

    // ── STEPS 4–6: WALLET IS INTENTIONALLY *NOT* ARCHIVED ───────────────────
    // The wallet is a cumulative ledger — every credit/debit must stay in the
    // master forever, or _calculateWalletBalance() breaks. Archiving an old
    // recharge (e.g. ₹2000 on 30 Mar) while keeping later debits (April)
    // produced a NEGATIVE balance. A "carry-forward" snapshot is fragile and
    // already corrupted balances once, so we keep the wallet whole instead.
    // SK_Wallet is tiny + low-volume, so this costs nothing in sheet size.
    // These vars stay empty so STEP 5/7 wallet blocks below are skipped.
    var toArchiveWallet = [];
    var carryFwdRows    = [];
    var snapshotCount   = 0;
    log.push("Wallet NOT archived — full ledger kept in master for balance integrity ✓");

    // ── WALLET BACKUP (non-destructive snapshot) ────────────────────────────
    // Write a FULL copy of the current SK_Wallet into this monthly archive file
    // as a safety net for cross-checking / recovery. Nothing is deleted from the
    // live wallet — this is purely a backup snapshot of the whole ledger.
    try {
      var walletWsSnap   = getOrCreateTab(ss, TAB_WALLET, WALLET_HEADERS);
      var walletSnapData = walletWsSnap.getDataRange().getValues();
      if (walletSnapData.length > 0) {
        var snapSheet = archiveSS.insertSheet("SK_Wallet_Snapshot");
        snapSheet.getRange(1, 1, walletSnapData.length, walletSnapData[0].length).setValues(walletSnapData);
        SpreadsheetApp.flush();
        log.push((walletSnapData.length - 1) + " wallet rows backed up (snapshot, not deleted) ✓");
      }
    } catch (snapErr) {
      log.push("Wallet snapshot skipped: " + snapErr.message);
    }

    // ── STEP 7: REBUILD live sheets atomically ──────────────────────────────
    // Critical fix for the "half-deleted" bug: clear data range and re-write
    // only kept rows in one operation instead of N deleteRow() calls.
    function rebuildSheet(ws, headers, keepRows, appendRows) {
      var allKeep = keepRows.concat(appendRows || []);
      var lastRow = ws.getLastRow();
      var lastCol = ws.getLastColumn();
      if (lastRow > 1) {
        ws.getRange(2, 1, lastRow - 1, Math.max(lastCol, headers.length)).clearContent();
      }
      if (allKeep.length > 0) {
        ws.getRange(2, 1, allKeep.length, headers.length).setValues(allKeep);
      }
      SpreadsheetApp.flush();
      var nowRows = ws.getLastRow() - 1;
      return nowRows === allKeep.length
        ? {success:true, written: nowRows}
        : {success:false, expected: allKeep.length, actual: nowRows};
    }

    if (toArchiveOrders.length > 0) {
      var oRebuild = rebuildSheet(ordersWs, oHeaders, keepOrders);
      if (!oRebuild.success) {
        return {success:false,
          error:"Order rebuild verification failed. Expected " + oRebuild.expected
                + ", got " + oRebuild.actual + ". Archive file IS created — please verify manually before retrying.",
          archiveUrl: archiveSS.getUrl()};
      }
      log.push(toArchiveOrders.length + " order rows removed from live sheet ✓");
    }

    // (Wallet rebuild removed — wallet is never archived; see STEPS 4–6 above.)

    return {
      success:        true,
      archiveName:    archiveName,
      archiveUrl:     archiveSS.getUrl(),
      archiveFolder:  yearFolder ? yearFolder.getName() : "(My Drive)",
      ordersArchived: toArchiveOrders.length,
      walletArchived: toArchiveWallet.length,
      snapshots:      snapshotCount,
      log:            log
    };
  } finally {
    try { lock.releaseLock(); } catch(_) {}
  }
}

/**
 * Returns (creating if needed) the Drive folder for a given year:
 *   My Drive > WebBased Ordering > Archive > <year>
 * Returns null if the parent "Web Based Ordering" folder cannot be located.
 *
 * The parent-folder ID can be set via Script Property ARCHIVE_PARENT_FOLDER_ID
 * to bypass the name-based lookup (faster and more reliable across accounts).
 */
function _getArchiveYearFolder(year) {
  var yearStr = String(year);
  try {
    var archiveFolder = null;
    var props = PropertiesService.getScriptProperties();
    var configuredId = props.getProperty("ARCHIVE_PARENT_FOLDER_ID");
    if (configuredId) {
      try { archiveFolder = DriveApp.getFolderById(configuredId); } catch(_) {}
    }

    if (!archiveFolder) {
      var rootFolders = DriveApp.getFoldersByName("WebBased Ordering");
      var webOrdering = null;
      if (rootFolders.hasNext()) webOrdering = rootFolders.next();
      if (!webOrdering) {
        Logger.log("_getArchiveYearFolder: 'WebBased Ordering' folder not found. Archive will stay in My Drive root.");
        return null;
      }
      var archiveFolders = webOrdering.getFoldersByName("Archive");
      archiveFolder = archiveFolders.hasNext() ? archiveFolders.next() : webOrdering.createFolder("Archive");
      try { props.setProperty("ARCHIVE_PARENT_FOLDER_ID", archiveFolder.getId()); } catch(_) {}
    }

    var yearFolders = archiveFolder.getFoldersByName(yearStr);
    if (yearFolders.hasNext()) return yearFolders.next();
    return archiveFolder.createFolder(yearStr);
  } catch (e) {
    Logger.log("_getArchiveYearFolder error: " + e.message);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ARCHIVE LOOKUP — for analytics across archived data
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Lists all archive spreadsheet files whose MONTH overlaps the given date range.
 * Filename pattern: "Svaadh Kitchen Archive — <MMM> <YYYY>" (e.g. "...— Apr 2026")
 */
function _listArchiveFilesInRange(dateFrom, dateTo) {
  var out = [];
  try {
    var props = PropertiesService.getScriptProperties();
    var configuredId = props.getProperty("ARCHIVE_PARENT_FOLDER_ID");
    var archiveFolder = null;
    if (configuredId) {
      try { archiveFolder = DriveApp.getFolderById(configuredId); } catch(_) {}
    }
    if (!archiveFolder) {
      var rootFolders = DriveApp.getFoldersByName("WebBased Ordering");
      if (!rootFolders.hasNext()) return out;
      var webOrdering = rootFolders.next();
      var archiveFolders = webOrdering.getFoldersByName("Archive");
      if (!archiveFolders.hasNext()) return out;
      archiveFolder = archiveFolders.next();
    }

    var MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    var monthIdx = function(m) { return MONTH_NAMES.indexOf(m); };
    var pad = function(n) { return n < 10 ? "0"+n : String(n); };

    // Pattern: "Svaadh Kitchen Archive — <Mon> <Year>"
    var fileNameRe = /Archive\s+—?\s*([A-Z][a-z]{2})\s+(\d{4})/;

    var processFile = function(file) {
      var name = file.getName();
      var m = name.match(fileNameRe);
      if (!m) return;
      var mIdx = monthIdx(m[1]);
      if (mIdx < 0) return;
      var yr = parseInt(m[2], 10);
      var lastDay = new Date(yr, mIdx + 1, 0).getDate();
      var rFrom = yr + "-" + pad(mIdx + 1) + "-01";
      var rTo   = yr + "-" + pad(mIdx + 1) + "-" + pad(lastDay);
      if (rTo < dateFrom || rFrom > dateTo) return;
      out.push({ file: file, year: yr, month: mIdx + 1, from: rFrom, to: rTo });
    };

    var yearFolders = archiveFolder.getFolders();
    while (yearFolders.hasNext()) {
      var yearFolder = yearFolders.next();
      var files = yearFolder.getFilesByType(MimeType.GOOGLE_SHEETS);
      while (files.hasNext()) processFile(files.next());
    }
    var looseFiles = archiveFolder.getFilesByType(MimeType.GOOGLE_SHEETS);
    while (looseFiles.hasNext()) processFile(looseFiles.next());

    out.sort(function(a, b) {
      if (a.year !== b.year) return a.year - b.year;
      return a.month - b.month;
    });
  } catch (e) {
    Logger.log("_listArchiveFilesInRange error: " + e.message);
  }
  return out;
}

/**
 * Reads SK_Orders rows from all archived files matching the date range.
 * Returns plain row objects (same shape as getAllRows() — keys = headers).
 * 10-min CacheService cache per file to avoid re-reading on every UI click.
 */
function _readArchivedOrdersInRange(dateFrom, dateTo) {
  var archives = _listArchiveFilesInRange(dateFrom, dateTo);
  if (!archives.length) return [];

  var cache = CacheService.getScriptCache();
  var fmtDate = function(v) {
    return v instanceof Date
      ? Utilities.formatDate(v, "Asia/Kolkata", "yyyy-MM-dd")
      : String(v || "").trim().slice(0, 10);
  };

  var allRows = [];
  archives.forEach(function(meta) {
    var cacheKey = "arch_orders_" + meta.file.getId();
    var cached;
    try { cached = cache.get(cacheKey); } catch(_) {}
    var rows;
    if (cached) {
      try { rows = JSON.parse(cached); } catch(_) { rows = null; }
    }
    if (!rows) {
      try {
        var aSS = SpreadsheetApp.openById(meta.file.getId());
        var sheet = aSS.getSheetByName("SK_Orders");
        if (!sheet) return;
        var data = sheet.getDataRange().getValues();
        if (data.length < 2) return;
        var headers = data[0];
        rows = [];
        for (var r = 1; r < data.length; r++) {
          var obj = {};
          for (var c = 0; c < headers.length; c++) obj[headers[c]] = data[r][c];
          rows.push(obj);
        }
        try {
          var serialised = JSON.stringify(rows);
          if (serialised.length <= 95 * 1024) cache.put(cacheKey, serialised, 600);
        } catch(_) {}
      } catch (e) {
        Logger.log("_readArchivedOrdersInRange: could not read " + meta.file.getName() + ": " + e.message);
        return;
      }
    }
    rows.forEach(function(row) {
      var d = fmtDate(row.Order_Date);
      if (d >= dateFrom && d <= dateTo) allRows.push(row);
    });
  });

  return allRows;
}

/**
 * Combined order rows for a date range — live SK_Orders + matching archives.
 */
function getOrdersInRangeWithArchive(dateFrom, dateTo) {
  var ss = getSpreadsheet();
  var ws = getOrCreateTab(ss, TAB_ORDERS, ORDERS_HEADERS);
  var fmtDate = function(v) {
    return v instanceof Date
      ? Utilities.formatDate(v, "Asia/Kolkata", "yyyy-MM-dd")
      : String(v || "").trim().slice(0, 10);
  };
  var liveRows = getAllRows(ws).filter(function(r) {
    var d = fmtDate(r.Order_Date);
    return d >= dateFrom && d <= dateTo;
  });
  var archivedRows = _readArchivedOrdersInRange(dateFrom, dateTo);
  var seen = {};
  var combined = [];
  archivedRows.concat(liveRows).forEach(function(r) {
    var id = String(r.Submission_ID || "").trim();
    if (id && seen[id]) return;
    if (id) seen[id] = true;
    combined.push(r);
  });
  return combined;
}

// Called by admin UI — wraps archiveMonth with PIN check (handled by router)
function triggerManualArchive(body) {
  var year  = parseInt(body.year);
  var month = parseInt(body.month);
  if (!year || !month) return {success:false, error:"year and month required"};
  return archiveMonth(year, month);
}

// ── Time-based trigger: auto-archive previous month on the 10th ──────────
// Run setupMonthlyArchiveTrigger() once from Apps Script editor to register.
// Also registered from admin UI via the setupQuarterlyArchiveTrigger action name (kept for compat).
function setupMonthlyArchiveTrigger() {
  // Remove any existing trigger for runScheduledArchive
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === "runScheduledArchive") ScriptApp.deleteTrigger(t);
  });
  // Fire on the 10th of every month at 21:00 UTC = 02:30 IST (safe off-peak window)
  ScriptApp.newTrigger("runScheduledArchive")
    .timeBased()
    .onMonthDay(10)
    .atHour(21)
    .create();
  return "Monthly archive trigger set — fires on the 10th of every month at ~2 AM IST.";
}

// Keep old name working (admin UI may still call this action)
function setupQuarterlyArchiveTrigger() {
  return setupMonthlyArchiveTrigger();
}

function runScheduledArchive() {
  // Archive the previous calendar month.
  // e.g. trigger fires May 10 → archive April (month 4, year this year)
  var now   = new Date();
  var year  = now.getFullYear();
  var month = now.getMonth() + 1; // 1–12, current month

  // Previous month
  var archiveMonth_ = month - 1;
  var archiveYear   = year;
  if (archiveMonth_ === 0) { archiveMonth_ = 12; archiveYear = year - 1; }

  var result = archiveMonth(archiveYear, archiveMonth_);
  Logger.log("Monthly archive result: " + JSON.stringify(result));
}

// ── CHURN REPORT ──────────────────────────────────────────────────────────────
function getChurnReport(sinceDate) {
  if (!sinceDate) return {success:false, error:"sinceDate required"};
  var fmtDate = function(v) {
    return v instanceof Date ? Utilities.formatDate(v,"Asia/Kolkata","yyyy-MM-dd") : String(v).trim();
  };
  // To detect churn we need every customer's MOST RECENT order — so we must
  // scan all archives too, not just the live sheet. Otherwise customers whose
  // last order was in an archived month would always appear "churned".
  var today = Utilities.formatDate(new Date(), "Asia/Kolkata", "yyyy-MM-dd");
  var earliest = "2024-01-01"; // conservative — covers everything ever archived
  var allRows = getOrdersInRangeWithArchive(earliest, today);

  var map = {};
  allRows.forEach(function(r) {
    if (_isOrderCancelled(r.Payment_Status)) return;
    var phone = String(r.Phone||"").trim();
    if (!phone) return;
    var d = fmtDate(r.Order_Date);
    if (!map[phone]) map[phone] = {
      phone:phone,
      name:String(r.Customer_Name||"").trim(),
      area:String(r.Area||"").trim(),
      lastDate:"",
      orderCount:0
    };
    map[phone].orderCount++;
    if (d > map[phone].lastDate) {
      map[phone].lastDate = d;
      map[phone].name = String(r.Customer_Name||map[phone].name).trim();
    }
  });
  var churned = Object.values(map).filter(function(c) { return c.lastDate < sinceDate; })
                                  .sort(function(a,b) { return b.lastDate.localeCompare(a.lastDate); });
  return {success:true, sinceDate:sinceDate, customers:churned, count:churned.length, archive_inclusive:true};
}


// ── LIVE TRACKER LOGIC: En Route & Delivered ──────────────────────────────────
function batchMarkEnRoute(body) {
  var sids      = body.submissionIds;
  var enRouteAt = body.enRouteAt;
  if (!sids || !sids.length) return {success:false, error:"submissionIds required"};

  var ss   = getSpreadsheet();
  var ws   = getOrCreateTab(ss, "SK_Deliveries", ["Submission_ID","Delivered_At","EnRoute_At"]);
  var data = ws.getDataRange().getValues();
  var headers = data[0];
  var erIdx   = headers.indexOf("EnRoute_At");
  var sidIdx  = headers.indexOf("Submission_ID");

  if (erIdx === -1) {
    ws.getRange(1, headers.length + 1).setValue("EnRoute_At");
    erIdx = headers.length;
  }

  // Create lookup for existing rows
  var sidToRowMap = {};
  for (var i = 1; i < data.length; i++) {
    sidToRowMap[String(data[i][sidIdx])] = i + 1;
  }

  sids.forEach(function(sid) {
    var row = sidToRowMap[String(sid)];
    if (row) {
      ws.getRange(row, erIdx + 1).setValue(enRouteAt);
    } else {
      // Append if not found (though usually we expect them to be found if already rendered)
      ws.appendRow([sid, "", enRouteAt]);
    }
  });

  return {success:true};
}

function markEnRoute(body) {
  var sid         = body.submissionId;
  var enRouteAt   = body.enRouteAt;
  if (!sid) return {success:false, error:"submissionId required"};

  var ss  = getSpreadsheet();
  var ws  = getOrCreateTab(ss, "SK_Deliveries", ["Submission_ID","Delivered_At","EnRoute_At"]);
  var rows = getAllRows(ws);
  
  // Ensure "EnRoute_At" header exists
  var headers = ws.getRange(1, 1, 1, ws.getLastColumn()).getValues()[0];
  if (headers.indexOf("EnRoute_At") === -1) {
    ws.getRange(1, headers.length + 1).setValue("EnRoute_At");
  }
  var hIdx = headerIndex(ws);

  var existing = null;
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].Submission_ID) === String(sid)) { existing = rows[i]; break; }
  }
  if (existing) {
    ws.getRange(existing._row, hIdx["EnRoute_At"]).setValue(enRouteAt);
  } else {
    // Note: Append Row pushes based on sheet width. Best to be safe using indices.
    var newRowArr = [];
    newRowArr[hIdx["Submission_ID"] - 1] = sid;
    newRowArr[hIdx["Delivered_At"] - 1] = "";
    newRowArr[hIdx["EnRoute_At"] - 1] = enRouteAt;
    ws.appendRow(newRowArr);
  }
  return {success:true, submissionId:sid, enRouteAt:enRouteAt};
}

// ── WALLET TOPUP LOGIC ────────────────────────────────────────────────────────
function submitWalletRecharge(body) {
  var phone  = String(body.phone || "").trim();
  var name   = String(body.name || "").trim();
  var amount = Number(body.amount);
  if (!phone || isNaN(amount) || amount <= 0) return {success:false, error:"Invalid amount or phone"};
  // Sanity cap — keeps the pending-recharge list clean (admin still verifies
  // every entry before it touches the balance; this just blocks absurd values).
  if (amount > 50000) return {success:false, error:"Recharge amount too large. Please contact us for amounts above ₹50,000."};

  // Unverified entry requiring admin to flip to TRUE
  const rechargeRef = "RCH-" + Utilities.formatDate(getISTDate(), "Asia/Kolkata", "yyyyMMdd-HHmmss") + "-" + phone.slice(-4);
  _appendWalletTransaction(phone, name, "Recharge", amount, false, rechargeRef);
  
  return {success:true};
}

/**
 * ADMIN: Fetch unverified wallet recharges
 */
function getPendingRecharges() {
  const ss = getSpreadsheet();
  const ws = getOrCreateTab(ss, TAB_WALLET, WALLET_HEADERS);
  const rawRows = getAllRows(ws);
  const pending = [];

  rawRows.forEach(w => {
    const rPhone = String(w.Phone || "").trim();
    const rName  = String(w.Customer_Name || "").trim();
    const rType  = String(w.Txn_Type || w.Balance || "").trim().toLowerCase();
    const rAmt   = Number(w.Amount) || 0;
    const rVer   = String(w.Verified || "").trim().toUpperCase();
    const rRef   = String(w.Reference_ID || "").trim();
    let   rTs    = w.Timestamp || "";
    if (rTs instanceof Date) rTs = Utilities.formatDate(rTs, "Asia/Kolkata", "yyyy-MM-dd HH:mm:ss");
    else rTs = String(rTs).trim();

    if ((rVer === "FALSE" || !rVer) && rType.includes("recharge")) {
      pending.push({ 
        Phone: rPhone, 
        Customer_Name: rName, 
        Amount: rAmt, 
        Timestamp: rTs, 
        Reference_ID: rRef, 
        _row: w._row 
      });
    }
  });
  return pending;
}

/**
 * ADMIN: Approve a wallet recharge
 */
function approveWalletRecharge(body) {
  const phone = String(body.phone || "").trim();
  const ts    = String(body.timestamp || "").trim();
  if (!phone || !ts) return {success:false, error:"Missing phone or timestamp"};

  const ss   = getSpreadsheet();
  const ws   = getOrCreateTab(ss, TAB_WALLET, WALLET_HEADERS);
  const hIdx = headerIndex(ws);

  const vCol = hIdx["Verified"];
  const pCol = hIdx["Phone"];
  const tCol = hIdx["Timestamp"];
  if (!vCol || !pCol || !tCol) return {success:false, error:"Wallet sheet missing required columns"};

  const rows = ws.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    const rPhone = String(rows[i][pCol-1] || "").trim();
    let   rTs    = rows[i][tCol-1];
    
    // Normalize timestamp for comparison
    if (rTs instanceof Date) {
      rTs = Utilities.formatDate(rTs, "Asia/Kolkata", "yyyy-MM-dd HH:mm:ss");
    } else {
      rTs = String(rTs || "").trim();
    }
    
    const rVer = String(rows[i][vCol-1] || "").toUpperCase();

    // Check match
    if (rPhone === phone && rTs === ts) {
      if (rVer === "TRUE") return {success:true, msg:"Already verified"};
      ws.getRange(i+1, vCol).setValue("TRUE");
      const settleRes = _autoSettlePendingOrders(phone);
      return {success:true, msg: settleRes.msg || "Wallet Activated ✅"};
    }
  }
  
  Logger.log(`Activation Failed: No match for Phone: ${phone}, TS: ${ts}. Rows scanned: ${rows.length - 1}`);
  return {success:false, error:"Recharge request not found or already verified"};
}

function rejectWalletRecharge(body) {
  const phone = String(body.phone || "").trim();
  const ts    = String(body.timestamp || "").trim();
  if (!phone || !ts) return {success:false, error:"Missing phone or timestamp"};

  const ss   = getSpreadsheet();
  const ws   = getOrCreateTab(ss, TAB_WALLET, WALLET_HEADERS);
  const hIdx = headerIndex(ws);

  const vCol = hIdx["Verified"];
  const pCol = hIdx["Phone"];
  const tCol = hIdx["Timestamp"];
  if (!vCol || !pCol || !tCol) return {success:false, error:"Wallet sheet missing required columns"};

  const rows = ws.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    const rPhone = String(rows[i][pCol-1] || "").trim();
    let   rTs    = rows[i][tCol-1];
    
    // Normalize timestamp for comparison
    if (rTs instanceof Date) {
      rTs = Utilities.formatDate(rTs, "Asia/Kolkata", "yyyy-MM-dd HH:mm:ss");
    } else {
      rTs = String(rTs || "").trim();
    }
    
    // Check match
    if (rPhone === phone && rTs === ts) {
      ws.getRange(i+1, vCol).setValue("REJECTED");
      return {success:true};
    }
  }
  
  return {success:false, error:"Recharge request not found"};
}

/**
 * Batch process multiple approvals/rejections
 * body: { tab: 'refunds'|'payments'|'wallet', action: 'approve'|'reject', items: [...] }
 */
function batchProcessApprovals(body) {
  const { tab, action, items } = body;
  if (!tab || !action || !items || !items.length) return {success:false, error: "Invalid batch request"};
  
  const results = [];
  items.forEach(item => {
    let res;
    if (tab === 'refunds') {
      res = (action === 'approve') ? markRefunded(item.submissionId) : markRefundRejected(item.submissionId);
    } else if (tab === 'payments') {
      const payload = { ...item, status: (action === 'approve' ? 'Paid' : 'Payment Rejected') };
      res = markOrdersStatus(payload);
    } else if (tab === 'wallet') {
      res = (action === 'approve') ? approveWalletRecharge(item) : rejectWalletRecharge(item);
    }
    results.push(res);
  });
  
  const successCount = results.filter(r => r.success).length;
  return { success: true, total: items.length, successCount };
}

/**
 * Recompute the loyalty waiver for a given order using the EXACT same
 * algorithm the order page (frontend) uses to display the customer's
 * bill. This guarantees the admin approval tab matches what the
 * customer saw and paid — no drift between layers, no client-trust
 * tampering surface (server-side computation only).
 *
 * Mirror of docs/order.html's calculateLoyaltyStreak() + bill-builder
 * loyalty branch:
 *   - Past surcharges = sum of stored Inflation_Surcharge (NO derived
 *     fallback) for rows strictly before this order's date.
 *   - Forward-pass streak counter with isConsecutive (Sunday-skip).
 *   - streakInfo[dStr].surcharge snapshots the running sum BEFORE
 *     adding dStr's own surcharge (matches frontend's bookkeeping).
 *   - On 6th day: waiver = streakInfo[lastPastDate].surcharge
 *                        + Math.ceil(orderFood * 0.06)
 *     i.e. exactly what virtualPastSurcharge + currentDaySurcharge
 *     evaluates to on the customer's order page.
 *
 * Returns the waiver amount if this order qualifies as the 6th day
 * of an unbroken streak, otherwise 0.
 */
function _recomputeLoyaltyWaiverForRow(orderRow, allRows) {
  if (!orderRow) return 0;
  const phoneStr = _normalizePhone(orderRow.Phone);
  if (!phoneStr) return 0;

  const orderDate = orderRow.Order_Date instanceof Date
    ? Utilities.formatDate(orderRow.Order_Date, "Asia/Kolkata", "yyyy-MM-dd")
    : String(orderRow.Order_Date || "").trim();
  if (!orderDate) return 0;

  // ── Build dailyTotals from past rows (strictly BEFORE this order). ─
  // Stored Inflation_Surcharge only — mirrors frontend's
  //   dailyTotals[dStr] += Number(r.inflation_surcharge) || 0;
  const dailyTotals = {};
  const rewardDays  = new Set();
  allRows.forEach(r => {
    if (_normalizePhone(r.Phone) !== phoneStr) return;
    if (_isOrderCancelled(r.Payment_Status)) return;
    const d = r.Order_Date instanceof Date
      ? Utilities.formatDate(r.Order_Date, "Asia/Kolkata", "yyyy-MM-dd")
      : String(r.Order_Date || "").trim();
    if (!d || d >= orderDate) return;
    if (!dailyTotals[d]) dailyTotals[d] = 0;
    dailyTotals[d] += Number(r.Inflation_Surcharge) || 0;
    if (String(r.Loyalty_Discount || "").trim().toLowerCase() === "yes") rewardDays.add(d);
  });

  const sortedDates = Object.keys(dailyTotals).sort();
  if (sortedDates.length === 0) return 0;

  // ── Forward-pass with isConsecutive (Sunday-skip). ─────────────────
  // Mirrors the frontend block at order.html line ~8259-8289:
  //   const isConsecutive = (d1, d2) => {
  //     let date1 = new Date(d1 + "T12:00:00"), ...;
  //     let diff = (date2 - date1) / 86400000;
  //     return (diff === 1) || (diff === 2 && date1.getDay() === 6);
  //   };
  const isConsecutive = function(d1, d2) {
    const date1 = new Date(d1 + "T12:00:00");
    const date2 = new Date(d2 + "T12:00:00");
    const diff  = (date2 - date1) / 86400000;
    return (diff === 1) || (diff === 2 && date1.getDay() === 6);
  };

  // streakInfo[dStr].surcharge is the sum of surcharges BEFORE adding
  // dStr's own — matches frontend's bookkeeping exactly.
  const streakInfo = {};
  let streakCount     = 0;
  let streakSurcharge = 0;
  let lastDate        = null;

  sortedDates.forEach(dStr => {
    if (lastDate && isConsecutive(lastDate, dStr)) {
      if (rewardDays.has(lastDate)) {
        streakCount = 1; streakSurcharge = 0;
      } else {
        streakCount++;
      }
    } else {
      streakCount = 1; streakSurcharge = 0;
    }
    streakInfo[dStr] = { count: streakCount, surcharge: streakSurcharge };
    streakSurcharge += (dailyTotals[dStr] || 0);
    lastDate = dStr;
  });

  // ── Determine virtualPastSurcharge AS THE FRONTEND WOULD SEE IT. ────
  // The frontend's S.loyaltyInfo for this customer (no cartDates passed)
  // returns streakInfo[winnerDate] where winnerDate = last past date.
  // So virtualPastSurcharge = streakInfo[lastPastDate].surcharge.
  // virtualStreakCount     = streakInfo[lastPastDate].count.
  //
  // The bill builder then checks (count === 5) for is6thDay. If we
  // want THIS order to qualify, the lastPastDate must be:
  //   (a) consecutive to orderDate (or 2 days off with Saturday→Monday),
  //   (b) NOT itself a reward day,
  //   (c) streakInfo[lastPastDate].count === 5.
  if (!lastDate) return 0;
  if (!isConsecutive(lastDate, orderDate)) return 0;
  if (rewardDays.has(lastDate)) return 0;

  const virtualStreakCount   = streakInfo[lastDate].count;
  const virtualPastSurcharge = streakInfo[lastDate].surcharge;
  if (virtualStreakCount !== 5) return 0;

  // ── Compute the waiver exactly as the bill builder does on day 6. ──
  const currentDaySurcharge = Math.ceil((Number(orderRow.Food_Subtotal) || 0) * 0.06);
  return virtualPastSurcharge + currentDaySurcharge;
}

/**
 * ADMIN: Fetch all orders with "Pending" status (usually UPI)
 */
function getPendingUPIPayments() {
  const ss = getSpreadsheet();
  const ws = getOrCreateTab(ss, TAB_ORDERS, ORDERS_HEADERS);
  const rows = getAllRows(ws);
  // Return Payment_Status == "Pending" OR "Cancelled (Verify UPI)"
  return rows.filter(r => {
    const s = String(r.Payment_Status).trim();
    const m = String(r.Payment_Method || "").trim();
    return s === "Pending" || s === "Cancelled (Verify UPI)" || s === "Pending Approval"
      || (m === "Split" && s === "Pending"); // Split orders awaiting UPI portion
  })
             .map(r => {
               const walletCredit = Number(r.Wallet_Credit) || 0;
               const isSplit = String(r.Payment_Method || "").trim() === "Split";
               const storedLoyaltyDiscount = Number(r.Discount_Amount) || 0;
               const isLoyalty             = String(r.Loyalty_Discount || "").trim().toLowerCase() === "yes";

               // Show EXACTLY what was stored / charged — never recompute the
               // loyalty waiver per meal. The 6-day reward is a single per-DAY
               // value (the accumulated prior-day surcharges); recomputing it for
               // each meal made all of a day's meals display the FULL day reward,
               // so a 3-meal day looked like the reward was given 3×. The stored
               // Net_Total + Discount_Amount already encode the correct, single
               // application (overflow goes to wallet at submit time), so trust them.
               const displayAmount    = isSplit ? Math.max(0, (Number(r.Net_Total) || 0) - walletCredit) : (Number(r.Net_Total) || 0);
               const displayLoyalty   = isLoyalty ? storedLoyaltyDiscount : 0;
               const loyaltyCorrected = false;
               const loyaltyStoredVal = storedLoyaltyDiscount;

               return {
                 id: r.Submission_ID,
                 date: r.Order_Date instanceof Date ? Utilities.formatDate(r.Order_Date, "Asia/Kolkata", "yyyy-MM-dd") : r.Order_Date,
                 customer: r.Customer_Name,
                 phone: r.Phone,
                 amount: displayAmount,
                 full_amount: r.Net_Total,
                 wallet_credit: walletCredit,
                 meal: r.Meal_Type,
                 timestamp: r.Submitted_At,
                 status: r.Payment_Status,
                 payment_method: String(r.Payment_Method || ""),
                 refund_preference: r.Refund_Preference || "",
                 loyalty_discount: displayLoyalty,
                 is_loyalty:       isLoyalty,
                 // Audit metadata so the admin UI can optionally flag
                 // rows whose stored Discount_Amount got bumped here.
                 loyalty_corrected:    loyaltyCorrected,
                 loyalty_stored_value: loyaltyStoredVal,
                 loyalty_stored_net:   Number(r.Net_Total) || 0
               };
             });
}

// ── MARK DELIVERED ────────────────────────────────────────────────────────────
function markDelivered(body) {
  var sid         = body.submissionId;
  var deliveredAt = body.deliveredAt;
  if (!sid) return {success:false, error:"submissionId required"};

  var ss  = getSpreadsheet();
  // Ensure we define the tab properly
  var ws  = getOrCreateTab(ss, "SK_Deliveries", ["Submission_ID","Delivered_At","EnRoute_At"]);
  
  var headers = ws.getRange(1, 1, 1, ws.getLastColumn()).getValues()[0];
  if (headers.indexOf("EnRoute_At") === -1) {
    ws.getRange(1, headers.length + 1).setValue("EnRoute_At");
  }
  
  var rows = getAllRows(ws);
  var hIdx = headerIndex(ws);

  var existing = null;
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].Submission_ID) === sid) { existing = rows[i]; break; }
  }
  if (existing) {
    ws.getRange(existing._row, hIdx["Delivered_At"]).setValue(deliveredAt);
  } else {
    var newRowArr = [];
    newRowArr[hIdx["Submission_ID"] - 1] = sid;
    newRowArr[hIdx["Delivered_At"] - 1] = deliveredAt;
    newRowArr[hIdx["EnRoute_At"] - 1] = "";
    ws.appendRow(newRowArr);
  }
  return {success:true, submissionId:sid, deliveredAt:deliveredAt};
}

// ── AUTO-MARK DELIVERED (daily 00:00 IST safety net) ─────────────────────────
// If the driver forgets to tap "Mark Delivered", any order dated BEFORE today
// is auto-marked delivered at the start of the next day. Deliveries are keyed
// by Submission_ID and one submission can span several dates, so a submission
// is only auto-marked once ALL its (non-cancelled) orders are in the past —
// otherwise we'd pre-mark tomorrow's delivery as done.
function autoMarkDeliveredDaily() {
  var ss    = getSpreadsheet();
  var today = Utilities.formatDate(new Date(), "Asia/Kolkata", "yyyy-MM-dd");
  var ws    = getOrCreateTab(ss, TAB_ORDERS, []);
  var rows  = getRecentRows(ws, 1500).concat(typeof ia_rowsAsSK === "function" ? ia_rowsAsSK() : []);

  var bySid = {}; // sid → { past: has orders before today, current: has orders today/future }
  rows.forEach(function(r) {
    var sid = String(r.Submission_ID || "").trim();
    if (!sid) return;
    if (_isOrderCancelled(r.Payment_Status)) return;
    var d = r.Order_Date instanceof Date
      ? Utilities.formatDate(r.Order_Date, "Asia/Kolkata", "yyyy-MM-dd")
      : String(r.Order_Date || "").trim();
    if (!d) return;
    if (!bySid[sid]) bySid[sid] = { past: false, current: false };
    if (d < today) bySid[sid].past = true; else bySid[sid].current = true;
  });

  var delWs   = getOrCreateTab(ss, "SK_Deliveries", ["Submission_ID","Delivered_At","EnRoute_At"]);
  var hIdx    = headerIndex(delWs);
  var delMap  = {};
  getAllRows(delWs).forEach(function(r) {
    var s = String(r.Submission_ID || "").trim();
    if (s) delMap[s] = r;
  });

  var stamp  = new Date().toISOString();
  var marked = 0;
  Object.keys(bySid).forEach(function(sid) {
    var s = bySid[sid];
    if (!s.past || s.current) return; // nothing past-due, or still has today/future orders
    var existing = delMap[sid];
    if (existing && String(existing.Delivered_At || "").trim() !== "") return; // already delivered
    if (existing) {
      delWs.getRange(existing._row, hIdx["Delivered_At"]).setValue(stamp);
    } else {
      var arr = [];
      arr[hIdx["Submission_ID"] - 1] = sid;
      arr[hIdx["Delivered_At"] - 1]  = stamp;
      arr[hIdx["EnRoute_At"] - 1]    = "";
      delWs.appendRow(arr);
    }
    marked++;
  });
  Logger.log("autoMarkDeliveredDaily: auto-marked " + marked + " submission(s) delivered.");
  return { success: true, marked: marked };
}

// Run once (Apps Script editor or admin action) to register the daily trigger.
// Script timezone is Asia/Kolkata, so atHour(0) fires between 00:00–01:00 IST.
function setupAutoDeliveredTrigger() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === "autoMarkDeliveredDaily") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("autoMarkDeliveredDaily")
    .timeBased()
    .everyDays(1)
    .atHour(0)
    .create();
  return "Auto-delivered trigger set — runs daily shortly after midnight IST.";
}

// ═══════════════════════════════════════════════════════
// LIVE GOOGLE REVIEWS
// ═══════════════════════════════════════════════════════
function getReviews() {
  if (!GOOGLE_PLACES_API_KEY) {
    return { error: true, message: "Missing GOOGLE_PLACES_API_KEY. Please configure in Code.gs." };
  }
  
  try {
    var url = "https://maps.googleapis.com/maps/api/place/details/json?place_id=" + PLACE_ID + "&fields=url,rating,user_ratings_total,reviews&key=" + GOOGLE_PLACES_API_KEY;
    var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    var json = JSON.parse(res.getContentText());
    
    if (json.status !== "OK") {
      return { error: true, message: json.error_message || json.status };
    }
    
    var place = json.result;
    var liveReviews = [];
    
    if (place.reviews) {
      liveReviews = place.reviews.map(function(r) {
        return {
          name: r.author_name,
          rating: r.rating,
          date: r.relative_time_description, 
          text: r.text || ""
        };
      });
    }
    
    // Sort reviews randomly so they don't look repetitive
    liveReviews.sort(function() { return 0.5 - Math.random() });
    
    return {
      success: true,
      rating: place.rating || 5.0,
      total: place.user_ratings_total || 85,
      reviewUrl: place.url || 'https://g.page/r/CasEH8gGAhzLEBM/review',
      reviews: liveReviews
    };
  } catch(e) {
    return { error: true, message: e.message };
  }
}
// Audit Fix #13: Helper to cancel order from Admin Dashboard
function adminCancelOrder(body) {
  const pin = String(body.pin || "").trim();
  if (pin !== ADMIN_PIN) return {success:false, error:"STRICT ADMIN PIN REQUIRED"};
  
  const phone = String(body.phone || "").trim();
  const dateStr = String(body.date || "").trim();
  const meal = String(body.meal || "").trim();

  const ss = getSpreadsheet();
  const ws = ss.getSheetByName(TAB_ORDERS);
  const rows = getAllRows(ws);

  // Find ALL matching orders for this guest/meal/date
  const matches = rows.filter(r => {
    const rPhone = String(r.Phone || "").trim();
    const rMeal = String(r.Meal_Type || "").trim();
    const orderDate = r.Order_Date instanceof Date
      ? Utilities.formatDate(r.Order_Date, 'Asia/Kolkata', 'yyyy-MM-dd')
      : String(r.Order_Date).trim();
    const status = String(r.Payment_Status || "").toLowerCase();
    
    return rPhone === phone && rMeal === meal && orderDate === dateStr && status !== 'deleted' && !status.startsWith('cancelled');
  });

  if (!matches.length) return {success:false, error: "No matching orders found"};

  // 1. Determine Global Batch Refund Type
  // If ANY order in the batch is wallet-paid, or any OTHER order in the sheet for this guest/meal is wallet-paid
  let anyWallet = matches.some(m => String(m.Payment_Status).toLowerCase() === "wallet paid");
  if (!anyWallet) {
    // Also check if any order REMAINS that is wallet paid (should have been covered by filter but check rows list)
    anyWallet = rows.some(r => 
      String(r.Phone).trim() === phone && 
      String(r.Meal_Type).trim() === meal &&
      Utilities.formatDate(r.Order_Date, 'Asia/Kolkata', 'yyyy-MM-dd') === dateStr &&
      String(r.Payment_Status).toLowerCase() === "wallet paid"
    );
  }

  // 2. Process each match one by one
  let totalRefund = 0;
  let batchMsg = "";
  let refundedToWallet = false;

  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    const pStat = String(m.Payment_Status).toLowerCase();
    
    // Decide refundType for this specific row in the batch context
    let rType = "none";
    if (pStat === "wallet paid") rType = "wallet";
    else if (pStat === "paid" || pStat.includes("pending")) {
      rType = anyWallet ? "wallet" : "manual_upi";
    }

    const result = deleteOrder(phone, m.Submission_ID, rType);
    if (result.success) {
      if (typeof result.message === "string" && result.message.includes("Wallet")) refundedToWallet = true;
    }
    // Force spreadsheet synchronization to avoid row-index/cache mismatch in the next iteration
    SpreadsheetApp.flush();
  }

  const noun = matches.length === 1 ? "order" : "orders";
  const mode = refundedToWallet ? "Wallet" : "Approvals";
  return {
    success: true, 
    message: `${matches.length} ${meal} ${noun} cancelled successfully (Refunded to ${mode})`
  };
}

// ── TEST DATA GENERATOR ──────────────────────────────────────
/**
 * ADMIN: Grant Review Promo (Manual)
 */
// NOTE: markReviewed lives earlier in this file (the +3-stacking version that
// also sets Review_Reward_Claimed). A second definition here used to OVERWRITE
// the count to 3 — wiping any unused balance — and, being the later definition,
// silently shadowed the correct one. Removed.

/**
 * Run this function once from the Apps Script editor to populate
 * dummy orders for Today and Tomorrow for testing prints/labels.
 */
function seedTestData() {
  try {
    Logger.log("Starting seedTestData...");
    const ss = getSpreadsheet();
    if (!ss) throw new Error("Could not open spreadsheet. Check SHEET_ID in Script Properties.");
    
    const ws = ss.getSheetByName(TAB_ORDERS);
    if (!ws) throw new Error("Sheet tab '" + TAB_ORDERS + "' not found.");

    const today = new Date();
    const tomorrow = new Date();
    tomorrow.setDate(today.getDate() + 1);

    const getDayStr = (d) => Utilities.formatDate(d, 'Asia/Kolkata', 'yyyy-MM-dd');
    const tStr = getDayStr(today);
    const mStr = getDayStr(tomorrow);

    Logger.log("Generating data for " + tStr + " and " + mStr);

    const testData = [
      { date: tStr, meal: "Breakfast", name: "Rahul Deshpande", area: "Magarpatta", society: "Pentagon 1", wing: "B", flat: "402", items: {"Kanda Poha": 2}, total: 70, notes: "Less spicy please" },
      { date: tStr, meal: "Breakfast", name: "Anjali Singh", area: "Amanora", society: "Tower 13", wing: "C", flat: "1805", items: {"Ghee Upma": 1, "Thalipeeth": 1}, total: 90, notes: "Extra chutney" },
      { date: tStr, meal: "Lunch", name: "Amit Kulkarni", area: "Bhosale Nagar", society: "Laxmi Vihar", wing: "A", flat: "104", items: {"Chapati": 3, "Dry_Sabji_Mini": 1, "Dal": 1}, total: 71, notes: "Deliver at gate" },
      { date: tStr, meal: "Lunch", name: "Sneha Patil", area: "Magarpatta", society: "Cosmos", wing: "E", flat: "P-5", items: {"Phulka": 2, "Curry_Sabji_Full": 1, "Rice": 1}, total: 77, notes: "" },
      { date: tStr, meal: "Dinner", name: "Mayur Joshi", area: "DP Road", society: "Riverview", wing: "F", flat: "901", items: {"Jowar_Bhakri": 2, "Curry_Sabji_Mini": 1}, total: 62, notes: "Ring bell and leave" },
      { date: mStr, meal: "Breakfast", name: "Priya Rao", area: "Magarpatta", society: "Pentagon 3", wing: "A", flat: "610", items: {"Sabudana Khichdi": 1}, total: 40, notes: "" },
      { date: mStr, meal: "Lunch", name: "Vikram Shah", area: "Amanora", society: "Adreno", wing: "1", flat: "1502", items: {"Ghee_Phulka": 4, "Dry_Sabji_Full": 1, "Salad": 1}, total: 100, notes: "Call on arrival" },
      { date: mStr, meal: "Dinner", name: "Svaadh Test", area: "Bhosale Nagar", society: "Self Pickup", wing: "-", flat: "-", items: {"Chapati": 2, "Dry_Sabji_Mini": 1, "Dal": 1}, total: 62, notes: "I will pick up" }
    ];

    testData.forEach((d, idx) => {
      Logger.log("Processing row " + (idx + 1) + ": " + d.name);
      const row = new Array(ORDERS_HEADERS.length).fill(""); 
      
      row[0] = "TEST-" + Math.floor(Math.random() * 100000); 
      row[1] = new Date(); 
      row[2] = d.date; 
      row[3] = d.meal; 
      row[4] = d.name; 
      row[5] = "9999999999"; 
      row[6] = d.area; 
      row[7] = d.wing; 
      row[8] = d.flat; 
      row[9] = "1"; 
      row[10] = d.society; 
      row[11] = d.wing + "-" + d.flat + ", " + d.society; 
      row[14] = JSON.stringify(d.items); 
      
      Object.keys(d.items).forEach(itemName => {
         const colIdx = ORDERS_HEADERS.indexOf(itemName); 
         if (colIdx >= 0) row[colIdx] = d.items[itemName];
         else {
           const colKey = itemName.replace(/ /g,"_");
           const altIdx = ORDERS_HEADERS.indexOf(colKey);
           if (altIdx >= 0) row[altIdx] = d.items[itemName];
         }
      });

      if (d.meal === "Breakfast") {
        let bIdx = 0;
        for (const [key, val] of Object.entries(d.items)) {
           if (bIdx === 0) { row[29] = key; row[30] = val; }
           if (bIdx === 1) { row[31] = key; row[32] = val; }
           if (bIdx === 2) { row[33] = key; row[34] = val; }
           if (bIdx === 3) { row[35] = key; row[36] = val; }
           bIdx++;
        }
      }

      const fieldMap = {
        "Special_Notes_Kitchen": d.notes,
        "Food_Subtotal": d.total,
        "Net_Total": d.total,
        "Payment_Method": "UPI",
        "Payment_Status": "Paid",
        "Payment_Freq": "Daily Payment"
      };

      Object.keys(fieldMap).forEach(key => {
        const i = ORDERS_HEADERS.indexOf(key);
        if (i >= 0) row[i] = fieldMap[key];
      });

      ws.appendRow(row);
    });

    Logger.log("Seed successful.");
    return "Success: 8 test orders added to sheet.";
  } catch(err) {
    Logger.log("ERROR in seedTestData: " + err.message);
    return "Error: " + err.message;
  }
}

function setStandardOrder(phone, itemsJSON, templateName, meal) {
  var ss = getSpreadsheet();
  var custWs = getOrCreateTab(ss, TAB_CUSTOMERS, CUSTOMERS_HEADERS);
  var rows = getAllRows(custWs);
  var normP = _normalizePhone(phone);
  var cust = rows.find(function(c){ return _normalizePhone(c.Phone) === normP; });
  
  var currentStr = (cust && cust.Standard_Order) ? cust.Standard_Order : "[]";
  var list = [];
  try { list = JSON.parse(currentStr); if(!Array.isArray(list)) list=[]; } catch(e){ list=[]; }
  
  // Ensure items is an object, not a string, before saving
  var finalItems = itemsJSON;
  if (typeof itemsJSON === "string") {
    try { finalItems = JSON.parse(itemsJSON); } catch(e) { finalItems = itemsJSON; }
  }
  
  // Remove existing with same name if any
  list = list.filter(function(x){ return x.name !== templateName; });
  list.push({ 
    name: templateName, 
    meal: meal || "Other",
    items: finalItems, 
    createdAt: new Date().toISOString() 
  });
  
  _upsertCustomer(ss, { phone: phone, standardOrder: JSON.stringify(list) });
  return { success: true };
}

function removeStandardOrder(phone, templateName) {
  var ss = getSpreadsheet();
  var custWs = getOrCreateTab(ss, TAB_CUSTOMERS, CUSTOMERS_HEADERS);
  var rows = getAllRows(custWs);
  var normP = _normalizePhone(phone);
  var cust = rows.find(function(c){ return _normalizePhone(c.Phone) === normP; });
  
  if (!cust || !cust.Standard_Order) return { success: true };
  
  var list = [];
  try { list = JSON.parse(cust.Standard_Order); if(!Array.isArray(list)) list=[]; } catch(e){ list=[]; }
  list = list.filter(function(x){ return x.name !== templateName; });
  
  _upsertCustomer(ss, { phone: phone, standardOrder: JSON.stringify(list) });
  return { success: true };
}

function placeBulkOrders(body) {
  const pin = String(body.pin || "").trim();
  if (pin !== ADMIN_PIN) return {success:false, error:"STRICT ADMIN PIN REQUIRED"};
  
  const phone = body.phone;
  const name = body.name;
  const templates = body.templates; 
  const dates = body.dates;     
  
  let count = 0;
  dates.forEach(function(date) {
    templates.forEach(function(tpl) {
      const orderBody = {
        phone: phone,
        name: name,
        date: date,
        meal: tpl.meal,
        items: tpl.items,
        payment_method: "Wallet",
        payment_freq: "Prepaid Wallet",
        source: "Admin Bulk",
        pin: pin   // verified admin pin — lets the ordering-window guard allow late/closed-day placement
      };
      const res = submitOrder(orderBody);
      if (res.success) count++;
    });
  });
  return {success:true, count: count};
}

// ═══════════════════════════════════════════════════════
// SENIOR BILLING — On Account Orders
// ═══════════════════════════════════════════════════════

function getBillingData(cycle, filterValue) {
  const ss = getSpreadsheet();
  const ordersWs  = getOrCreateTab(ss, TAB_ORDERS, ORDERS_HEADERS);
  const custWs    = getOrCreateTab(ss, TAB_CUSTOMERS, CUSTOMERS_HEADERS);
  let   allOrders = getAllRows(ordersWs);
  const allCusts  = getAllRows(custWs);

  // Build customer map: phone → { billing_cycle, address, name }
  const custMap = {};
  allCusts.forEach(c => {
    const phone = String(c.Phone || '').trim();
    if (phone) custMap[phone] = {
      billing_cycle: String(c.Billing_Cycle || '').trim(),
      name:    c.Customer_Name || '',
      area:    c.Area || '',
      society: c.Society || '',
      wing:    c.Wing || '',
      flat:    c.Flat || '',
      floor:   c.Floor || ''
    };
  });

  // Compute date range based on cycle and filter (IST context)
  const now = getISTDate();
  let fromStr = '';
  let toStr   = '';

  // Helper to parse "YYYY-MM-DD" string reliably
  const parseYMD = (s) => {
    if (!s) return null;
    const p = s.split('-');
    return new Date(parseInt(p[0]), parseInt(p[1]) - 1, parseInt(p[2]));
  };

  if (cycle === 'Daily') {
    // Daily mode: show ALL pending On Account orders (no date restriction).
    // fromStr/toStr left blank — filtering below is skipped for Daily.
    fromStr = '';
    toStr   = '';
  } else if (cycle === 'Monthly') {
    const mIdx = (filterValue !== undefined && filterValue !== '') ? parseInt(filterValue) : now.getMonth();
    const first = new Date(now.getFullYear(), mIdx, 1);
    const last  = new Date(now.getFullYear(), mIdx + 1, 0);
    fromStr = Utilities.formatDate(first, 'Asia/Kolkata', 'yyyy-MM-dd');
    toStr   = Utilities.formatDate(last, 'Asia/Kolkata', 'yyyy-MM-dd');
  } else {
    // Weekly billing retired — any non-Daily/Monthly falls back to "today".
    fromStr = Utilities.formatDate(now, 'Asia/Kolkata', 'yyyy-MM-dd');
    toStr   = fromStr;
  }

  // For Monthly, the selected month may already be archived — merge in archived
  // orders for that range so the Billing tab still shows it. (Daily = current
  // pending collection, stays live-only.)
  if (cycle === 'Monthly' && fromStr && toStr) {
    const seenIds = {};
    allOrders.forEach(r => { const id = String(r.Submission_ID || '').trim(); if (id) seenIds[id] = true; });
    _readArchivedOrdersInRange(fromStr, toStr).forEach(r => {
      const id = String(r.Submission_ID || '').trim();
      if (!id || !seenIds[id]) allOrders.push(r);
    });
  }

  // Filter On Account orders within cycle date range
  // For Daily: no date restriction — return ALL pending On Account orders.
  const onAccountOrders = allOrders.filter(r => {
    const status = String(r.Payment_Status || '').trim().toLowerCase();
    if (status !== 'on account') return false;
    if (cycle === 'Daily') return true; // all dates
    const dVal = r.Order_Date;
    const ds = dVal instanceof Date ? Utilities.formatDate(dVal, 'Asia/Kolkata', 'yyyy-MM-dd') : String(dVal).trim();
    return ds >= fromStr && ds <= toStr;
  });

  // Group by customer phone
  const grouped = {};
  onAccountOrders.forEach(r => {
    const phone = String(r.Phone || '').trim();
    const cust  = custMap[phone] || {};
    // Only include customers whose billing_cycle matches requested cycle
    if ((cust.billing_cycle || '').toLowerCase() !== cycle.toLowerCase()) return;

    if (!grouped[phone]) {
      grouped[phone] = {
        phone,
        name:    r.Customer_Name || cust.name || '',
        area:    r.Area || cust.area || '',
        society: r.Society || cust.society || '',
        wing:    r.Wing || cust.wing || '',
        flat:    r.Flat || cust.flat || '',
        floor:   r.Floor || cust.floor || '',
        billing_cycle: cust.billing_cycle || cycle,
        from: fromStr,
        to:   toStr,
        orders: [],
        total: 0
      };
    }

    const oDate = r.Order_Date;
    const ds    = oDate instanceof Date ? Utilities.formatDate(oDate, 'Asia/Kolkata', 'yyyy-MM-dd') : String(oDate).trim();

    grouped[phone].orders.push({
      sid:   String(r.Submission_ID || ''),
      date:  ds,
      meal:  String(r.Meal_Type || ''),
      items: String(r.Items_JSON || '{}'),
      net:   Number(r.Net_Total || 0),
      // Include for Daily flat-list display
      customer_name:  r.Customer_Name || cust.name || '',
      customer_phone: phone
    });
    grouped[phone].total += Number(r.Net_Total || 0);
  });

  // Default sorting: Total Amount Descending, then Name
  const customers = Object.values(grouped).sort((a,b) => {
    if (b.total !== a.total) return b.total - a.total;
    return a.name.localeCompare(b.name);
  });

  // For Daily: also build a flat, date-sorted list of all orders across all customers.
  // The frontend uses this to render the new flat-list view.
  let flat_orders = null;
  if (cycle === 'Daily') {
    flat_orders = [];
    customers.forEach(c => {
      c.orders.forEach(o => {
        flat_orders.push({
          sid:            o.sid,
          date:           o.date,
          meal:           o.meal,
          items:          o.items,
          net:            o.net,
          customer_name:  c.name,
          customer_phone: c.phone,
          area:           c.area,
          billing_cycle:  c.billing_cycle
        });
      });
    });
    // Sort by date ascending, then meal order (Breakfast→Lunch→Dinner)
    const mealOrder = { Breakfast: 0, Lunch: 1, Dinner: 2 };
    flat_orders.sort((a, b) => {
      const dateCmp = a.date.localeCompare(b.date);
      if (dateCmp !== 0) return dateCmp;
      return (mealOrder[a.meal] ?? 9) - (mealOrder[b.meal] ?? 9);
    });
  }

  return { success: true, cycle, from: fromStr, to: toStr, customers, flat_orders };
}

// ── ON-ACCOUNT MONTHLY BILL (customer-facing) ────────────────────────
// Returns the previous-month (plus any older carry-forward) UNPAID
// On Account balance for a MONTHLY billing customer, so the order page
// can surface a skippable "settle your bill" modal from the 1st onward.
// Daily customers are handled by the admin from the backend → not surfaced.
// Weekly is retired, so only "monthly" qualifies here.
// "Paid" is implicit: when admin uses Mark Collected, those orders flip
// out of "On Account" status and stop counting → the bill disappears.
function getOnAccountBill(phone) {
  try {
    const phoneStr = _normalizePhone(phone);
    if (!phoneStr) return { due: false };

    const ss = getSpreadsheet();

    // Resolve customer profile
    const custWs = getOrCreateTab(ss, TAB_CUSTOMERS, CUSTOMERS_HEADERS);
    const custs  = getAllRows(custWs);
    let prof = null;
    for (let i = 0; i < custs.length; i++) {
      if (_normalizePhone(custs[i].Phone) === phoneStr) { prof = custs[i]; break; }
    }
    if (!prof) return { due: false };

    const isOnAccount = String(prof.On_Account || "").trim().toLowerCase() === "yes";
    const cycle       = String(prof.Billing_Cycle || "Daily").trim().toLowerCase();
    if (!isOnAccount || cycle !== "monthly") return { due: false };

    // Cutoff = first day of the current IST month. Anything strictly BEFORE
    // this date that is still "On Account" is what the customer owes. This
    // naturally surfaces last month's bill on the 1st and also catches any
    // older carry-forward the admin hasn't collected yet.
    const now    = getISTDate();
    const cutoff = Utilities.formatDate(new Date(now.getFullYear(), now.getMonth(), 1), 'Asia/Kolkata', 'yyyy-MM-dd');

    const ordersWs = getOrCreateTab(ss, TAB_ORDERS, ORDERS_HEADERS);
    const rows     = getAllRows(ordersWs);

    const orders = [];
    let total = 0;
    let earliest = null;
    rows.forEach(function (r) {
      if (_normalizePhone(r.Phone) !== phoneStr) return;
      if (String(r.Payment_Status || "").trim().toLowerCase() !== "on account") return;
      const ds = r.Order_Date instanceof Date
        ? Utilities.formatDate(r.Order_Date, 'Asia/Kolkata', 'yyyy-MM-dd')
        : String(r.Order_Date).trim();
      if (!ds || ds >= cutoff) return; // current month is not billed yet
      const net = Number(r.Net_Total || 0);
      total += net;
      if (!earliest || ds < earliest) earliest = ds;
      orders.push({
        date:  ds,
        meal:  String(r.Meal_Type || ""),
        items: String(r.Items_JSON || "{}"),
        net:   net
      });
    });

    if (orders.length === 0 || total <= 0) return { due: false };

    orders.sort(function (a, b) { return a.date.localeCompare(b.date); });

    const prevMonth   = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const periodLabel = Utilities.formatDate(prevMonth, 'Asia/Kolkata', 'MMMM yyyy');
    const lastDayPrev = Utilities.formatDate(new Date(now.getFullYear(), now.getMonth(), 0), 'Asia/Kolkata', 'yyyy-MM-dd');

    return {
      due:         true,
      phone:       phoneStr,
      name:        prof.Customer_Name || "",
      total:       Math.round(total * 100) / 100,
      periodLabel: periodLabel,
      fromDate:    earliest,
      toDate:      lastDayPrev,
      orders:      orders
    };
  } catch (e) {
    return { due: false, error: String(e) };
  }
}

function markBillingCollected(submissionIds) {
  if (!submissionIds || !submissionIds.length) return { success: false, error: 'No submission IDs provided' };
  const ss = getSpreadsheet();
  const ws = getOrCreateTab(ss, TAB_ORDERS, ORDERS_HEADERS);
  const hIdx = headerIndex(ws);
  const rows = getAllRows(ws);
  const statusCol = hIdx['Payment_Status'];
  if (!statusCol) return { success: false, error: 'Payment_Status column not found' };

  let count = 0;
  // Compare IDs exactly (trimmed) — do NOT strip non-digits; manual order IDs
  // contain mixed alphanumeric characters and digit-stripping causes false matches.
  const idSet = new Set(submissionIds.map(id => String(id).trim()));

  rows.forEach(r => {
    const cleanId = String(r.Submission_ID || '').trim();
    if (idSet.has(cleanId)) {
      ws.getRange(r._row, statusCol).setValue('Paid'); // Changed from 'Collected' to 'Paid' for uniformity
      count++;
    }
  });
  SpreadsheetApp.flush();
  return { success: true, count };
}

/**
 * Undo markBillingCollected: set orders back to "Pending" by submission ID array.
 * Used by the 8-second undo toast in billing tab.
 */
function undoMarkPaid(submissionIds) {
  if (!submissionIds || !submissionIds.length) return { success: false, error: 'No IDs' };
  const ss  = getSpreadsheet();
  const ws  = getOrCreateTab(ss, TAB_ORDERS, ORDERS_HEADERS);
  const hIdx = headerIndex(ws);
  const rows = getAllRows(ws);
  const statusCol = hIdx['Payment_Status'];
  if (!statusCol) return { success: false, error: 'Column missing' };
  const idSet = new Set(submissionIds.map(id => String(id).trim()));
  let count = 0;
  rows.forEach(r => {
    if (idSet.has(String(r.Submission_ID || '').trim())) {
      ws.getRange(r._row, statusCol).setValue('Pending');
      count++;
    }
  });
  SpreadsheetApp.flush();
  return { success: true, count };
}

/**
 * VIP / Fee Exempt Logic
 */
function toggleFeeExempt(phone, status) {
  const ss = getSpreadsheet();
  const custWs = getOrCreateTab(ss, TAB_CUSTOMERS, CUSTOMERS_HEADERS);
  const rows = getAllRows(custWs);
  const hIdx = headerIndex(custWs);
  const phoneStr = _normalizePhone(phone);
  const idx = rows.findIndex(r => _normalizePhone(r.Phone) === phoneStr);
  
  const val = (status === true || String(status).toLowerCase() === "yes") ? "Yes" : "No";
  
  if (idx !== -1) {
    custWs.getRange(idx + 2, hIdx["Fee_Exempt"]).setValue(val);
  } else {
    // Number not found - create a FUTURE whitelist entry (Predetermine)
    if (!phone || phone.length < 10) return { success: false, error: "Invalid phone number" };
    const row = new Array(CUSTOMERS_HEADERS.length).fill("");
    row[hIdx["Phone"] - 1] = phone;
    row[hIdx["Fee_Exempt"] - 1] = val;
    row[hIdx["Created_At"] - 1] = getISTTimestamp();
    row[hIdx["Customer_Name"] - 1] = "";
    custWs.appendRow(row);
  }
  return { success: true, status: val };
}

function _getDeliveryPointLabel(key) {
  if (!key) return "Handover at Doorstep";
  const map = {
    door: "Handover at Doorstep / Office Door",
    bell_keep: "Keep outside & Ring bell",
    lobby_handoff: "Handover at Lobby / Reception",
    lobby_keep: "Keep at Lobby / Reception",
    gate_handoff: "Handover at Security Gate",
    gate_keep: "Keep at security cabin",
    comedown: "Customer will come down",
    other: "Other (see instructions)"
  };
  return map[key] || key;
}
/**
 * Derives a Google Maps link based on partial address or society name matching.
 * @param {string} addr - The full address string
 * @param {string} society - The society name field
 * @returns {string} - The found maps link or empty string
 */
function _deriveMapsLink(addr, society) {
  const dict = {
    "Laburnum Park": "https://maps.app.goo.gl/nEApFaLe5x4PzuHd8",
    "Magarpatta City": "https://maps.app.goo.gl/wEndRh6jnkjL1GRC9",
    "Amanora Mall": "https://maps.app.goo.gl/Wd2FxrytcABk9Xty6",
    "Pentagon 1": "https://maps.app.goo.gl/BQKFrtdmLv9sK8tF8",
    "IZiel": "https://maps.app.goo.gl/BQKFrtdmLv9sK8tF8",
    "Shree Lakshmi Vihar": "https://maps.app.goo.gl/LWr5zhbiXHN9sh1F8",
    "Desire Tower": "https://maps.app.goo.gl/P9KE1RtznuruMrJk8",
    "Amanora Tower 18": "https://maps.app.goo.gl/P9KE1RtznuruMrJk8",
    "Amanora Tower 21": "https://maps.app.goo.gl/P9KE1RtznuruMrJk8",
    "Amanora Tower 22": "https://maps.app.goo.gl/P9KE1RtznuruMrJk8",
    "Greenville": "https://maps.app.goo.gl/FvpENaW8aFzXTj916",
    "Cosmos": "https://maps.app.goo.gl/bYu8gnb1ZVQgAwse9",
    "Prime Wing Cosmos": "https://maps.app.goo.gl/eUHhhV9oS1MPQutq8",
    "Zinnia": "https://maps.app.goo.gl/iWcMqnXCDRkesdnT7",
    "Trillium": "https://maps.app.goo.gl/cnYLtqjxaqDtexzKA",
    "Sudarshan Heritage": "https://maps.app.goo.gl/QJAAaugYVcD18eg4A",
    "Daffodils": "https://maps.app.goo.gl/vxXz2LuxFCZPcvTZ8",
    "Amanora Gold Tower": "https://maps.app.goo.gl/PgXAJ8nz7xKjnUZ7A",
    "Gateway Tower": "https://maps.app.goo.gl/YCh4dHET1ZsrLZqv6",
    "T100 Gateway Towers": "https://maps.app.goo.gl/YCh4dHET1ZsrLZqv6",
    "Wework Futura": "https://maps.app.goo.gl/u8JaNJYbpHPXBxdp9",
    "Jasminium": "https://maps.app.goo.gl/HiGZSmvbb3SFnTKP6",
    "Jasminium Society": "https://maps.app.goo.gl/pMXdyNSMu3kEMuec6",
    "Vascon Ela": "https://maps.app.goo.gl/MXhnTLvycEENcrNA7",
    "Marvel Fuego": "https://maps.app.goo.gl/izc9t6cXWWYiciyv8",
    "Heliconia": "https://maps.app.goo.gl/tFu79S7KHv6L48XG8",
    "Kumar Paradise": "https://maps.app.goo.gl/utQB7yFo4jMgVKAv6",
    "Vrindavan Heights": "https://maps.app.goo.gl/qcS8v4dVtbx1rBg46",
    "Sai Tower": "https://maps.app.goo.gl/dWigWD2KHXsE5YrT7",
    "Future Towers": "https://maps.app.goo.gl/pvhvaMsWS8n3x5Cq8",
    "Annexe Society": "https://maps.app.goo.gl/uAuA67dHxgLyfVX29",
    "Imperial Heights": "https://maps.app.goo.gl/Dt9HZVgBzB7iNdhu9",
    "Tulja Tower": "https://maps.app.goo.gl/VeUw6EciJckATaZU6",
    "Torana Kamdhenu": "https://maps.app.goo.gl/9PMRz86iGNjv8UZEA",
    "Cybercity": "https://maps.app.goo.gl/5ASLF1yDeoKH7Wq86",
    "Cyber City": "https://maps.app.goo.gl/5ASLF1yDeoKH7Wq86",
    "Samarth Shrushti": "https://maps.app.goo.gl/1eLo6vz3mTWu1BXB8",
    "Grevillea": "https://maps.app.goo.gl/ppTArZ12auPnRR5E8",
    "Orient Garden": "https://maps.app.goo.gl/vFrsEoijMPVV7a3U7",
    "Bhosale Nagar": "https://maps.app.goo.gl/5MzXtAZmtZvD9D9o6",
    "Amar Ornate": "https://maps.app.goo.gl/mtFcV35i5gpPz4BG7",
    "DSK Sunderban": "https://maps.app.goo.gl/xu4fiGtFLbgp3Kxs9",
    "Aruna Girls PG": "https://maps.app.goo.gl/FUxKBQ6iQKt64ji36",
    "Aruna PG": "https://maps.app.goo.gl/FUxKBQ6iQKt64ji36",
    "Mams Bungalow": "https://maps.app.goo.gl/gX94MR52LDXzbq7h8",
    "Gardenia": "https://maps.app.goo.gl/tVsv9NZvBzxqg1aU6",
    "Palazzo": "https://maps.app.goo.gl/fd1Na7Lenjh1AwiH6",
    "Kumar Picasso": "https://maps.app.goo.gl/WpDwFWDGJVSRx9r88",
    "Roystonea": "https://maps.app.goo.gl/6xfQ2VNEc4CMnRgD7",
    "Pankaj Avenue": "https://maps.app.goo.gl/HzLBbS8L5o8zkHgx8",
    "Unika": "https://maps.app.goo.gl/CvgQwPzkTRUT5dHz6",
    "Amanora Ascent": "https://maps.app.goo.gl/xgMEJAbrEbD2PpJ69",
    "Vanshree": "https://maps.app.goo.gl/cW1gjcsVkStwudfZ7",
    "Aspire Towers": "https://maps.app.goo.gl/dZ7V6SVs7SX63BhG8",
    "Naren Bliss": "https://maps.app.goo.gl/RJbXCqWcZSZTieBS7",
    "Solitaire": "https://maps.app.goo.gl/RsrdFp6gYQNbWzzq7",
    "Sylvania": "https://maps.app.goo.gl/j5UhPibRVDxhkdRY7",
    "Erica": "https://maps.app.goo.gl/yTpThD413d3q2FL38",
    "Om Balaji Darshan": "https://maps.app.goo.gl/KLDrXo2DZcUUkJzV9",
    "Adreno Towers": "https://maps.app.goo.gl/725jneTokL1ahFsF9",
    "Neo Towers": "https://maps.app.goo.gl/sJy9YiqFcEEDMgWz9",
    "Leisure Town": "https://maps.app.goo.gl/gvVkgfZtLfhpRk1W8",
    "Sundar Sankul": "https://share.google/aOAcluoLyIMzc3I1L",
    "Kumar Purab": "https://maps.app.goo.gl/FGez7Rv63NzNRLeaA",
    "Marvel Azure": "https://maps.app.goo.gl/YaeQHEbg8D4HAALDA",
    "Hrishikesh housing": "https://maps.app.goo.gl/PsyUKTGt4Rj9qPsVA"
  };

  const str = (addr + " " + society).toLowerCase();
  for (let key in dict) {
    if (str.includes(key.toLowerCase())) {
      return dict[key];
    }
  }
  return "";
}

// ── SUBMIT MANUAL ORDER (Admin Feature) ────────────────────
function submitManualOrder(body) {
  const ss        = getSpreadsheet();
  const ordersWs  = getOrCreateTab(ss, TAB_ORDERS, ORDERS_HEADERS);
  const custWs    = getOrCreateTab(ss, TAB_CUSTOMERS, CUSTOMERS_HEADERS);

  const phone     = String(body.phone    || "").trim();
  const name      = String(body.name     || "").trim();
  const amount    = Number(body.amount)  || 0;
  const date      = body.date || Utilities.formatDate(new Date(), "Asia/Kolkata", "yyyy-MM-dd");
  const mealType  = body.mealType  || "Other";
  const payMethod = body.paymentMethod || body.payMethod || "UPI";  // "UPI" | "On Account" | "Cash"
  const billingCycle = body.billingCycle || "Daily"; // only used when creating/updating for On Account

  if (!phone || amount <= 0) throw new Error("Invalid phone or amount");

  // ── 1. Look up existing customer ───────────────────────────
  const custRows = getAllRows(custWs);
  const pStr     = _normalizePhone(phone);
  const existing = custRows.find(r => _normalizePhone(r.Phone) === pStr);

  // ── 2. Update / create customer record ─────────────────────
  if (existing) {
    // Always safe to update name if provided, nothing else unless On Account
    const custHIdx = headerIndex(custWs);
    const updCell  = (col, val) => { if (custHIdx[col]) custWs.getRange(existing._row, custHIdx[col]).setValue(val); };

    if (name) updCell("Customer_Name", name);

    if (payMethod === "On Account") {
      // Mark On Account = Yes
      updCell("On_Account", "Yes");
      // Only change billing cycle if the existing one is NOT Monthly (never downgrade)
      const existingCycle = String(existing.Billing_Cycle || "").trim();
      if (existingCycle !== "Monthly") {
        updCell("Billing_Cycle", billingCycle);
      }
    }
    // For UPI/Cash: do NOT touch On_Account, Billing_Cycle, or any other field
    SpreadsheetApp.flush();

  } else {
    // New customer — create a minimal record; leave address/area/etc blank
    // so they can self-register later and fill in details naturally.
    const newCustProfile = {
      phone:    phone,
      name:     name || "",
      // Address fields intentionally omitted (blank)
    };
    if (payMethod === "On Account") {
      newCustProfile.onAccount    = "Yes";
      newCustProfile.billingCycle = billingCycle;
    }
    // For UPI/Cash: On_Account defaults to "No", Billing_Cycle to "Daily" (schema defaults)
    _upsertCustomer(ss, newCustProfile);
  }

  // ── 3. Pull customer address for order row (if they exist) ─
  const custRecord = existing || (() => {
    // Re-fetch after insert so we get the row
    const freshRows = getAllRows(custWs);
    return freshRows.find(r => _normalizePhone(r.Phone) === pStr);
  })();
  const custAddress = custRecord
    ? [custRecord.Wing && `Wing ${custRecord.Wing}`, custRecord.Flat && `Flat ${custRecord.Flat}`,
       custRecord.Floor && `${custRecord.Floor} Floor`, custRecord.Society, custRecord.Area]
       .filter(Boolean).join(", ")
    : "";
  const custArea    = custRecord ? (custRecord.Area    || "") : "";
  const custSociety = custRecord ? (custRecord.Society || "") : "";
  const custMaps    = custRecord ? (custRecord.Maps_Link || "") : "";

  // ── 4. Determine Payment_Method + Payment_Status for order row
  let orderPayMethod, orderPayStatus;
  if (payMethod === "On Account") {
    orderPayMethod = "On Account";
    orderPayStatus = "On Account";
  } else if (payMethod === "Cash") {
    orderPayMethod = "Cash";
    orderPayStatus = "Paid";
  } else {
    // UPI (default)
    orderPayMethod = "UPI";
    orderPayStatus = "Pending";
  }

  // ── 5. Append order row ────────────────────────────────────
  const hIdx = headerIndex(ordersWs);
  const row  = new Array(ORDERS_HEADERS.length).fill("");
  const set  = (colName, val) => { const i = hIdx[colName]; if (i) row[i - 1] = val; };

  // Generate a unique ID: SK-YYYYMMDD-M-XXXX (M = manual, easy to identify)
  const _midDate = Utilities.formatDate(getISTDate(), "Asia/Kolkata", "yyyyMMdd");
  const _midRand = Math.floor(Math.random() * 9000) + 1000;
  const sid = `SK-${_midDate}-M-${_midRand}`;

  set("Submission_ID",  sid);
  set("Submitted_At",   getISTTimestamp());
  set("Order_Date",     date);
  set("Meal_Type",      mealType);
  set("Customer_Name",  name || (custRecord && custRecord.Customer_Name) || "");
  set("Phone",          _normalizePhone(phone));
  set("Food_Subtotal",  amount);
  set("Net_Total",      amount);
  set("Payment_Method", orderPayMethod);
  set("Payment_Status", orderPayStatus);
  set("Address",        custAddress);
  set("Area",           custArea);
  set("Society",        custSociety);
  set("Maps_Link",      custMaps);
  set("Source",         "Admin Manual Entry");

  ordersWs.appendRow(row);
  return { success: true, sid: sid };
}

// ╔══════════════════════════════════════════════════════════════════╗
// ║          HDFC SMARTGATEWAY INTEGRATION                          ║
// ║  All functions below are gated by PAYMENT_GATEWAY_ENABLED.      ║
// ║  Nothing here runs unless that flag is true.                    ║
// ║                                                                  ║
// ║  HOW IT WORKS (end-to-end):                                     ║
// ║  1. Customer picks UPI/Card/NetBanking on order.html            ║
// ║  2. order.html calls hdfc_createSession → gets payment_url      ║
// ║  3. Customer is redirected to HDFC HyperCheckout page           ║
// ║  4. HDFC fires webhook → hdfc_handleWebhook marks order paid    ║
// ║  5. HDFC redirects customer back → order.html verifies via      ║
// ║     hdfc_verifyReturnPayload (HMAC check)                       ║
// ║                                                                  ║
// ║  KEYS NEEDED (set in Script Properties):                        ║
// ║  HDFC_MERCHANT_ID, HDFC_API_KEY, HDFC_RESPONSE_KEY,            ║
// ║  HDFC_WEBHOOK_USERNAME, HDFC_WEBHOOK_PASSWORD,                  ║
// ║  HDFC_RETURN_URL, HDFC_ENV, HDFC_TEST_URL, HDFC_LIVE_URL        ║
// ╚══════════════════════════════════════════════════════════════════╝

/**
 * STEP 1 — Called by order.html when customer chooses to pay via gateway.
 * Creates a payment session with HDFC SmartGateway (Juspay HyperCheckout).
 * Returns a payment_url to redirect the customer to.
 *
 * @param {Object} body  { phone, name, amount, order_id, description }
 * @returns {{ success, payment_url, session_id } | { error }}
 */
function hdfc_createSession(body) {
  if (!PAYMENT_GATEWAY_ENABLED) return { error: "Gateway not enabled." };

  const phone        = String(body.phone  || "").trim();
  const name         = String(body.name   || "Customer").trim();
  const amountRupees = Number(body.amount || 0);
  const orderId      = String(body.order_id    || "").trim();
  const description  = String(body.description || "Svaadh Kitchen Order").trim();

  if (!phone || !orderId || amountRupees <= 0) {
    return { error: "Missing required fields: phone, order_id, amount." };
  }
  if (!HDFC_MERCHANT_ID || !HDFC_API_KEY) {
    return { error: "Gateway credentials not configured in Script Properties." };
  }

  // HDFC SmartGateway expects amount in RUPEES (empirically confirmed — UAT showed 100x
  // inflation when sending paisa, so SmartGateway/Juspay takes rupees directly, not paisa)
  const amountToSend = Math.round(amountRupees);

  const payload = {
    order_id:               orderId,
    amount:                 amountToSend,
    currency:               "INR",
    customer_id:            phone,
    customer_phone:         phone,
    customer_email:         phone + "@svaadh.noemail",
    payment_page_client_id: HDFC_MERCHANT_ID,
    action:                 "paymentPage",
    return_url:             HDFC_RETURN_URL,
    description:            description,
    first_name:             name.split(" ")[0] || name,
    last_name:              name.split(" ").slice(1).join(" ") || "",
    udf1:                   phone,
    udf3:                   "svaadh_kitchen",
    // udf2 intentionally omitted — blocked by HDFC for tokenization compliance
    notification_url:       HDFC_RETURN_URL   // webhook URL per-session (fallback if dashboard not set)
  };

  // Juspay Basic Auth: base64(api_key + ":") — API key as username, empty password
  // Merchant ID goes in a separate x-merchantid header (NOT in the auth string)
  const authToken = Utilities.base64Encode(HDFC_API_KEY + ":");

  const options = {
    method:      "post",
    contentType: "application/json",
    headers: {
      "Authorization": "Basic " + authToken,
      "x-merchantid":  HDFC_MERCHANT_ID,
      "version":       "2023-01-01"
    },
    payload:            JSON.stringify(payload),
    muteHttpExceptions: true
  };

  try {
    const resp     = UrlFetchApp.fetch(HDFC_BASE_URL + "/session", options);
    const respCode = resp.getResponseCode();
    const respBody = JSON.parse(resp.getContentText());

    console.log("HDFC createSession [" + respCode + "]:", JSON.stringify(respBody));

    if (respCode !== 200 && respCode !== 201) {
      // Error details can be nested under error_info in Juspay responses
      const errMsg = (respBody.error_info && respBody.error_info.user_message)
        || respBody.user_message
        || respBody.error_message
        || respBody.error_info
        || "Unknown error";
      return { error: "HDFC session creation failed (HTTP " + respCode + "): " + errMsg };
    }

    const paymentUrl = (respBody.payment_links && respBody.payment_links.web)
      ? respBody.payment_links.web
      : null;

    if (!paymentUrl) {
      return { error: "HDFC returned no payment URL. Check credentials and merchant config." };
    }

    return {
      success:     true,
      payment_url: paymentUrl,
      session_id:  respBody.id || orderId,
      order_id:    orderId
    };

  } catch (err) {
    console.error("hdfc_createSession error:", err.message);
    return { error: "Network error creating payment session: " + err.message };
  }
}


/**
 * STEP 2 — Webhook handler.
 * HDFC POSTs here immediately after payment success or refund.
 * This is the authoritative payment confirmation — never rely on return URL alone.
 *
 * Auth: Basic Auth (HDFC_WEBHOOK_USERNAME:HDFC_WEBHOOK_PASSWORD)
 *
 * @param {Object} body  Parsed webhook JSON from HDFC
 * @param {Object} e     Raw Apps Script event (for header access)
 */
/**
 * STEP 2 — Webhook handler. LOG-FIRST PATTERN.
 *
 * HDFC expects a 200 response within 5 seconds. Heavy work (Status API call,
 * sheet reads, row updates) can take 5-8s — guaranteed timeout.
 *
 * Solution: this function does ONE thing only:
 *   1. Verify Basic Auth (in-memory, < 5ms)
 *   2. Write one row to SK_Webhook_Log (< 500ms)
 *   3. Return 200 OK to HDFC immediately
 *
 * The actual processing — Status API verification, marking order paid —
 * is handled by hdfc_processWebhookLog(), called by a 1-minute time trigger.
 * No time pressure there. No duplicates (PENDING → PROCESSED gate).
 *
 * @param {Object} body  Parsed webhook JSON from HDFC
 * @param {Object} e     Raw Apps Script event (for header access)
 */
function hdfc_handleWebhook(body, e) {
  if (!PAYMENT_GATEWAY_ENABLED) return { error: "Gateway not enabled." };

  // ── Auth check (fast — no I/O) ───────────────────────────────
  try {
    var authHeader = "";
    try { authHeader = e.parameter.Authorization || ""; } catch(_) {}
    if (HDFC_WEBHOOK_USERNAME && HDFC_WEBHOOK_PASSWORD) {
      var expectedAuth = "Basic " + Utilities.base64Encode(HDFC_WEBHOOK_USERNAME + ":" + HDFC_WEBHOOK_PASSWORD);
      if (authHeader && authHeader !== expectedAuth) {
        console.warn("HDFC Webhook: Invalid Basic Auth — possible spoofed request.");
        return { error: "Unauthorized" };
      }
    }
  } catch (authErr) {
    console.warn("HDFC Webhook auth check error:", authErr.message);
  }

  // ── Log-first: write one row, return immediately ─────────────
  // Do NOT call hdfc_markOrderPaid here — that involves an external Status API
  // call and sheet reads which will blow past HDFC's 5-second response window.
  try {
    const ss  = getSpreadsheet();
    const ws  = getOrCreateTab(ss, TAB_WEBHOOK_LOG, [
      "Received_At", "Event_Name", "Order_ID", "Raw_Payload", "Status", "Processed_At", "Result"
    ]);

    const eventName = String(body.event_name || "");
    const orderId   = String(
      (body.content && body.content.order && body.content.order.order_id) || ""
    );

    ws.appendRow([
      new Date(),          // Received_At
      eventName,           // Event_Name
      orderId,             // Order_ID
      JSON.stringify(body),// Raw_Payload — full webhook preserved
      "PENDING",           // Status
      "",                  // Processed_At (filled by processor)
      ""                   // Result       (filled by processor)
    ]);

    console.log("HDFC Webhook logged: event=" + eventName + " order=" + orderId);
  } catch (logErr) {
    // Even if logging fails, we must return 200 so HDFC doesn't retry endlessly.
    // The raw payload is in the GAS execution log regardless.
    console.error("HDFC Webhook log error:", logErr.message);
  }

  // Return 200 immediately — HDFC is satisfied. Processing happens async.
  return { success: true, received: true };
}


/**
 * HDFC Webhook Processor — called by a 1-minute time trigger.
 * Reads all PENDING rows from SK_Webhook_Log and processes each one.
 *
 * For ORDER_SUCCEEDED events:
 *   1. Calls Status API to independently confirm payment (security requirement)
 *   2. Marks the order Paid in SK_Orders
 *   3. Updates the log row to PROCESSED or FAILED
 *
 * Safe to run multiple times — duplicate protection is inside hdfc_markOrderPaid.
 * Set up the trigger once by running setupHdfcWebhookTrigger() from the editor.
 */
function hdfc_processWebhookLog() {
  if (!PAYMENT_GATEWAY_ENABLED) return;

  try {
    const ss  = getSpreadsheet();
    const ws  = getOrCreateTab(ss, TAB_WEBHOOK_LOG, [
      "Received_At", "Event_Name", "Order_ID", "Raw_Payload", "Status", "Processed_At", "Result"
    ]);

    const data = ws.getDataRange().getValues();
    if (data.length < 2) return; // no rows yet

    const headers        = data[0];
    const COL_EVENT      = headers.indexOf("Event_Name");
    const COL_PAYLOAD    = headers.indexOf("Raw_Payload");
    const COL_STATUS     = headers.indexOf("Status");
    const COL_PROC_AT    = headers.indexOf("Processed_At");
    const COL_RESULT     = headers.indexOf("Result");

    var processed = 0;

    for (var i = 1; i < data.length; i++) {
      const rowStatus = String(data[i][COL_STATUS] || "").trim();
      if (rowStatus !== "PENDING") continue; // skip already handled rows

      const eventName  = String(data[i][COL_EVENT]   || "");
      const rawPayload = String(data[i][COL_PAYLOAD]  || "{}");
      var   body;
      try { body = JSON.parse(rawPayload); } catch(_) { body = {}; }

      const content = body.content || {};
      const order   = content.order || {};
      var   result  = "";
      var   newStatus = "PROCESSED";

      if (eventName === "ORDER_SUCCEEDED" || order.status === "CHARGED") {
        const markResult = hdfc_markOrderPaid(order);
        result = JSON.stringify(markResult);
        if (markResult.error) newStatus = "FAILED";

      } else if (eventName === "REFUND_INITIATED" || eventName === "REFUND_SUCCEEDED") {
        // Placeholder — refund logic goes here when needed
        result = "Refund event acknowledged.";

      } else {
        result = "Unhandled event type: " + eventName;
      }

      // Update the log row
      ws.getRange(i + 1, COL_STATUS   + 1).setValue(newStatus);
      ws.getRange(i + 1, COL_PROC_AT  + 1).setValue(new Date());
      ws.getRange(i + 1, COL_RESULT   + 1).setValue(result);
      processed++;

      console.log("hdfc_processWebhookLog: row " + (i+1) + " → " + newStatus + " | " + result);
    }

    if (processed > 0) {
      console.log("hdfc_processWebhookLog: processed " + processed + " pending webhook(s).");
    }

  } catch (err) {
    console.error("hdfc_processWebhookLog error:", err.message);
  }
}


/**
 * Run this ONCE from the Apps Script editor to set up the 1-minute trigger
 * that calls hdfc_processWebhookLog() automatically.
 *
 * Menu: Run → setupHdfcWebhookTrigger
 * Only needed in the DEV project (same project that receives HDFC webhooks).
 */
function setupHdfcWebhookTrigger() {
  // Remove any existing trigger for this function first (avoid duplicates)
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === "hdfc_processWebhookLog") {
      ScriptApp.deleteTrigger(t);
    }
  });
  ScriptApp.newTrigger("hdfc_processWebhookLog")
    .timeBased()
    .everyMinutes(1)
    .create();
  console.log("✅ hdfc_processWebhookLog trigger created — runs every 1 minute.");
}


/**
 * STEP 3 — Called by order.html when customer lands back after payment.
 * Verifies the HMAC signature on return URL params.
 * Signature = HMAC_SHA256(order_id + "|" + status, HDFC_RESPONSE_KEY)
 *
 * @param {Object} body  { order_id, status, signature }
 * @returns {{ success, paid, order_id, status, message } | { error }}
 */
function hdfc_verifyReturnPayload(body) {
  if (!PAYMENT_GATEWAY_ENABLED) return { error: "Gateway not enabled." };

  const orderId   = String(body.order_id  || "").trim();
  const status    = String(body.status    || "").trim();
  const signature = String(body.signature || "").trim();

  if (!orderId || !status) {
    return { error: "Missing order_id or status in return payload." };
  }

  // ── Step 1: HMAC signature check (fast, no I/O) ─────────────
  // Tries canonical Juspay (sorted-all-params + base64) first, falls back
  // to the legacy `order_id|status` hex HMAC for backward compatibility.
  // On any mismatch fall through to Status API (authoritative).
  var signatureOk = false;
  if (HDFC_RESPONSE_KEY && signature) {
    const sigParams = {};
    for (const k in body) {
      if (k === "_action" || k === "pin" || k === "sessionPin") continue;
      sigParams[k] = body[k];
    }
    sigParams.order_id  = orderId;
    sigParams.status    = status;
    sigParams.signature = signature;

    const matchedFormat = hdfc_verifySignatureMultiFormat(sigParams, HDFC_RESPONSE_KEY);
    if (matchedFormat) {
      signatureOk = true;
      console.log("HDFC return: HMAC verified for " + orderId
        + " via format=" + matchedFormat
        + " (algo=" + (body.signature_algorithm || "n/a") + ")");
    } else {
      console.warn("HDFC return: HMAC mismatch for order " + orderId
        + " — tried canonical, canonical-no-algo, and legacy formats."
        + " params=" + JSON.stringify(Object.keys(sigParams))
        + " — falling back to Status API.");
    }
  } else {
    console.warn("HDFC return: No signature or key — falling back to Status API.");
  }

  // ── Step 2: Status API verification (authoritative) ──────────
  // Always call if signature check didn't pass. Even if it did pass,
  // Status API gives us the real txn_id and confirmed status.
  var statusConfirmed = (status === "CHARGED" || status === "SUCCESS");
  if (!signatureOk) {
    const statusCheck = hdfc_getOrderStatus(orderId);
    if (statusCheck.confirmed) {
      statusConfirmed = true;
      console.log("HDFC return: Status API confirmed CHARGED for " + orderId);
    } else {
      console.warn("HDFC return: Status API returned '" + statusCheck.status + "' for " + orderId);
      // Only reject if BOTH signature AND Status API fail
      if (!statusConfirmed) {
        return { error: "Payment could not be verified. Status: " + statusCheck.status, paid: false };
      }
    }
  }

  const paid = statusConfirmed;

  // Cross-check with sheet (webhook should have already marked it paid)
  try {
    const ss   = getSpreadsheet();
    const ws   = getOrCreateTab(ss, TAB_ORDERS, []);
    const rows = getAllRows(ws);
    const orderRows = rows.filter(function(r) {
      return String(r.Submission_ID || "").trim() === orderId;
    });
    if (orderRows.length > 0) {
      const sheetStatus = String(orderRows[0].Payment_Status || "").toLowerCase();
      const alreadyPaid = sheetStatus === "paid" || sheetStatus === "collected";
      return {
        success:  true,
        paid:     paid || alreadyPaid,
        order_id: orderId,
        status:   status,
        message:  (paid || alreadyPaid) ? "Payment confirmed." : "Payment status: " + status
      };
    }
  } catch (err) {
    console.warn("hdfc_verifyReturnPayload sheet check error:", err.message);
  }

  return {
    success:  true,
    paid:     paid,
    order_id: orderId,
    status:   status,
    message:  paid ? "Payment confirmed." : "Payment status: " + status
  };
}


/**
 * Internal: Calls HDFC Order Status API to confirm a payment server-side.
 * Must be called before writing "Paid" to the sheet — webhook alone is not
 * sufficient per HDFC security audit requirements.
 *
 * Endpoint: GET {HDFC_BASE_URL}/orders/{order_id}
 * Auth:     Basic base64(API_KEY + ":")
 *
 * @param {string} orderId  The gateway order ID (alphanumeric, ≤21 chars)
 * @returns {{ confirmed: boolean, status: string, txn_id: string }}
 */
function hdfc_getOrderStatus(orderId) {
  if (!HDFC_MERCHANT_ID || !HDFC_API_KEY) {
    console.warn("hdfc_getOrderStatus: credentials not configured.");
    return { confirmed: false, status: "UNKNOWN", txn_id: "" };
  }

  const authToken = Utilities.base64Encode(HDFC_API_KEY + ":");
  const options = {
    method:             "get",
    headers: {
      "Authorization": "Basic " + authToken,
      "x-merchantid":  HDFC_MERCHANT_ID,
      "version":        "2023-01-01"
    },
    muteHttpExceptions: true
  };

  try {
    const resp     = UrlFetchApp.fetch(HDFC_BASE_URL + "/orders/" + orderId, options);
    const respCode = resp.getResponseCode();
    const respBody = JSON.parse(resp.getContentText());

    console.log("hdfc_getOrderStatus [" + respCode + "] for " + orderId + ":", JSON.stringify(respBody));

    if (respCode !== 200) {
      console.warn("hdfc_getOrderStatus: non-200 response (" + respCode + ") for " + orderId);
      return { confirmed: false, status: "API_ERROR", txn_id: "" };
    }

    const status = String(respBody.status || "").toUpperCase();
    const txnId  = String((respBody.txn_detail && respBody.txn_detail.txn_id) || respBody.txn_id || "");
    return {
      confirmed: (status === "CHARGED"),
      status:    status,
      txn_id:    txnId
    };
  } catch (err) {
    console.error("hdfc_getOrderStatus error:", err.message);
    return { confirmed: false, status: "FETCH_ERROR", txn_id: "" };
  }
}


/**
 * Internal: Marks a Svaadh order row(s) as PAID in SK_Orders sheet.
 * Called by hdfc_handleWebhook on ORDER_SUCCEEDED.
 *
 * @param {Object} order  Order object from HDFC webhook content.order
 */
function hdfc_markOrderPaid(order) {
  const orderId = String(order.order_id || "").trim();
  const txnId   = String(order.txn_id   || order.id || "").trim();
  const method  = String(order.payment_method_type || order.payment_method || "Gateway").trim();

  if (!orderId) return { error: "Webhook: missing order_id." };

  console.log("HDFC Webhook received for order: " + orderId + " via " + method);

  // ── Step 1: Verify payment via Status API (mandatory per HDFC security audit) ──
  // Never rely on the webhook payload alone. Confirm the order is truly CHARGED.
  const statusCheck = hdfc_getOrderStatus(orderId);
  if (!statusCheck.confirmed) {
    console.warn("hdfc_markOrderPaid: Status API returned '" + statusCheck.status + "' for " + orderId + ". Aborting mark-paid.");
    return { success: true, message: "Webhook received but Status API shows " + statusCheck.status + " — not marking paid." };
  }
  // Use txn_id from Status API if richer than what webhook provided
  if (statusCheck.txn_id && !txnId) txnId = statusCheck.txn_id;

  console.log("HDFC Status API confirmed CHARGED: " + orderId + " (TXN:" + txnId + ")");

  try {
    const ss      = getSpreadsheet();
    const ws      = getOrCreateTab(ss, TAB_ORDERS, []);
    const data    = ws.getDataRange().getValues();
    if (data.length < 2) return { error: "Orders sheet is empty." };

    const headers     = data[0];
    const COL_SID     = headers.indexOf("Submission_ID");
    const COL_PSTATUS = headers.indexOf("Payment_Status");
    const COL_PMETHOD = headers.indexOf("Payment_Method");
    const COL_NOTES   = headers.indexOf("Kitchen_Notes");

    if (COL_SID < 0 || COL_PSTATUS < 0) {
      return { error: "Webhook: required columns missing in SK_Orders." };
    }

    var updated = 0;
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][COL_SID] || "").trim() === orderId) {

        // ── Step 2: Duplicate check — skip if already marked Paid ──
        const currentStatus = String(data[i][COL_PSTATUS] || "").toLowerCase();
        if (currentStatus === "paid" || currentStatus === "collected") {
          console.log("hdfc_markOrderPaid: order " + orderId + " row " + (i+1) + " already Paid — skipping (duplicate webhook).");
          continue;
        }

        ws.getRange(i + 1, COL_PSTATUS + 1).setValue("Paid");
        if (COL_PMETHOD >= 0) {
          ws.getRange(i + 1, COL_PMETHOD + 1).setValue("Gateway (" + method + ")");
        }
        if (COL_NOTES >= 0 && txnId) {
          var existing = String(data[i][COL_NOTES] || "");
          var note = existing ? existing + " | TXN:" + txnId : "TXN:" + txnId;
          ws.getRange(i + 1, COL_NOTES + 1).setValue(note);
        }
        updated++;
      }
    }

    if (updated === 0) {
      console.warn("HDFC Webhook: order " + orderId + " not found in SK_Orders (or already Paid).");
      return { success: true, message: "Order " + orderId + " not found or already processed." };
    }

    return { success: true, message: "Order " + orderId + " marked paid (" + updated + " row(s))." };

  } catch (err) {
    console.error("hdfc_markOrderPaid error:", err.message);
    return { error: "Failed to update order: " + err.message };
  }
}


// ─────────────────────────────────────────────────────────────────────────────
// PENDING ORDER STORE
// Saves the full order payload server-side before the HDFC redirect.
// Retrieved on return — no sessionStorage/localStorage dependency.
// Stored in Script Properties as a JSON map, auto-expired after 30 minutes.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Saves order payload before customer is redirected to HDFC checkout.
 * Called by order.html hdfc_initiatePayment() just before window.location.href redirect.
 *
 * @param {Object} body  { order_id, phone, amount, orders, selectedDates, profile, mealAddrs, isFirstTime }
 */
function hdfc_savePendingOrder(body) {
  if (!PAYMENT_GATEWAY_ENABLED) return { error: "Gateway not enabled." };

  const orderId = String(body.order_id || "").trim();
  if (!orderId) return { error: "order_id required." };

  try {
    const props    = PropertiesService.getScriptProperties();
    const raw      = props.getProperty("HDFC_PENDING_ORDERS") || "{}";
    const pending  = JSON.parse(raw);

    // Expire entries older than 30 minutes to keep size under control
    const now = Date.now();
    Object.keys(pending).forEach(function(k) {
      if (now - (pending[k].ts || 0) > 30 * 60 * 1000) delete pending[k];
    });

    pending[orderId] = {
      ts:            now,
      phone:         body.phone         || "",
      amount:        body.amount        || 0,
      orders:        body.orders        || {},
      selectedDates: body.selectedDates || [],
      profile:       body.profile       || {},
      mealAddrs:     body.mealAddrs     || {},
      isFirstTime:   body.isFirstTime   || false
    };

    props.setProperty("HDFC_PENDING_ORDERS", JSON.stringify(pending));
    console.log("hdfc_savePendingOrder: saved order " + orderId);
    return { success: true };

  } catch (err) {
    console.error("hdfc_savePendingOrder error:", err.message);
    return { error: err.message };
  }
}


/**
 * Retrieves and removes the saved pending order on return from HDFC.
 * Called by order.html hdfc_handleReturnParams() after verifying payment.
 *
 * @param {Object} body  { order_id }
 * @returns {{ success, phone, amount, orders, selectedDates, profile, mealAddrs, isFirstTime } | { error }}
 */
function hdfc_getPendingOrder(body) {
  if (!PAYMENT_GATEWAY_ENABLED) return { error: "Gateway not enabled." };

  const orderId = String(body.order_id || "").trim();
  if (!orderId) return { error: "order_id required." };

  try {
    const props   = PropertiesService.getScriptProperties();
    const raw     = props.getProperty("HDFC_PENDING_ORDERS") || "{}";
    const pending = JSON.parse(raw);

    const entry = pending[orderId];
    if (!entry) {
      console.warn("hdfc_getPendingOrder: no pending entry for " + orderId);
      return { error: "Pending order not found. It may have expired (>30 min)." };
    }

    // Keep the entry — let it expire naturally after 30 minutes.
    // Not deleting here so that if the page reloads or redirects twice,
    // the second call still finds the data.
    console.log("hdfc_getPendingOrder: retrieved order " + orderId);
    return { success: true, ...entry };

  } catch (err) {
    console.error("hdfc_getPendingOrder error:", err.message);
    return { error: err.message };
  }
}


/**
 * Utility: Compute HMAC-SHA256 hex digest.
 * Used to verify HDFC return URL signatures.
 *
 * @param {string} message  String to sign
 * @param {string} secret   Response key from HDFC
 * @returns {string}        Lowercase hex string
 */
function hdfc_hmacSha256(message, secret) {
  const sig = Utilities.computeHmacSha256Signature(
    Utilities.newBlob(message).getBytes(),
    Utilities.newBlob(secret).getBytes()
  );
  return sig.map(function(b) { return ("0" + (b & 0xFF).toString(16)).slice(-2); }).join("");
}

/**
 * HMAC-SHA256 → Base64 (used by canonical Juspay signature verification).
 */
function hdfc_hmacSha256Base64(message, secret) {
  const sig = Utilities.computeHmacSha256Signature(
    Utilities.newBlob(message).getBytes(),
    Utilities.newBlob(secret).getBytes()
  );
  return Utilities.base64Encode(sig);
}

/**
 * PHP-style urlencode (space → "+", plus a few extras Juspay's signature
 * contract requires when building the key=value HMAC payload).
 */
function hdfc_phpUrlEncode(s) {
  return encodeURIComponent(String(s == null ? "" : s))
    .replace(/%20/g, "+")
    .replace(/!/g, "%21")
    .replace(/\*/g, "%2A")
    .replace(/'/g, "%27")
    .replace(/\(/g, "%28")
    .replace(/\)/g, "%29")
    .replace(/~/g, "%7E");
}

/**
 * Canonical Juspay / HDFC SmartGateway return-URL signature verification
 * (post-vulnerability-fix format). Tries the new canonical format first,
 * then a variant that excludes signature_algorithm, then the legacy
 * order_id|status hex HMAC for backward compatibility.
 *
 * Returns the matched format name, or "" on mismatch.
 */
function hdfc_verifySignatureMultiFormat(params, key) {
  if (!params || !key) return "";
  const received = String(params.signature || "").trim();
  if (!received) return "";

  const buildMsg = function(excludeKeys) {
    const filtered = [];
    for (const k in params) {
      if (excludeKeys.indexOf(k) !== -1) continue;
      if (params[k] === undefined || params[k] === null) continue;
      filtered.push([k, String(params[k])]);
    }
    filtered.sort(function(a, b) { return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0; });
    return filtered.map(function(p) {
      return p[0] + "=" + hdfc_phpUrlEncode(p[1]);
    }).join("&");
  };

  const candidates = [received];
  try { candidates.push(decodeURIComponent(received)); } catch(_) {}

  const msgA = buildMsg(["signature"]);
  const sigA = hdfc_hmacSha256Base64(msgA, key);
  for (var i = 0; i < candidates.length; i++) {
    if (sigA === candidates[i]) return "canonical";
  }

  const msgB = buildMsg(["signature", "signature_algorithm"]);
  const sigB = hdfc_hmacSha256Base64(msgB, key);
  for (var j = 0; j < candidates.length; j++) {
    if (sigB === candidates[j]) return "canonical-no-algo";
  }

  const legacyMsg = String(params.order_id || "") + "|" + String(params.status || "");
  const sigLegacy = hdfc_hmacSha256(legacyMsg, key);
  for (var m = 0; m < candidates.length; m++) {
    if (sigLegacy.toLowerCase() === String(candidates[m]).toLowerCase()) return "legacy";
  }

  return "";
}


/**
 * DEV HELPER — Test gateway connectivity without a real payment.
 * Run this function directly from the Apps Script editor (Dev project only).
 * It will attempt to create a ₹1 session and log the result.
 */
function testHdfcConnection() {
  if (!PAYMENT_GATEWAY_ENABLED) {
    console.log("PAYMENT_GATEWAY_ENABLED is false. Enable it in Dev Script Properties first.");
    return;
  }
  const result = hdfc_createSession({
    phone:       "9999999999",
    name:        "Test Customer",
    amount:      1,
    order_id:    "SKTEST" + Date.now().toString(36).toUpperCase().slice(-9),  // alphanumeric ≤21
    description: "Svaadh Kitchen — Connection Test"
  });
  console.log("testHdfcConnection result:", JSON.stringify(result, null, 2));
}


// ============================================================
// ONE-TIME REPAIR: Fix Loyalty_Discount markers in SK_Orders
// ============================================================
/**
 * Run once from Apps Script editor to back-fill correct Loyalty_Discount
 * values for all customers. Safe to run multiple times (idempotent).
 *
 * What it does:
 *  1. Replays every customer's order history chronologically (same logic
 *     as submitOrder's virtual streak).
 *  2. Identifies which rows SHOULD have Loyalty_Discount = "Yes" based
 *     on the 6-consecutive-day rule.
 *  3. Writes "Yes" / "No" into the sheet only where the current value
 *     differs, so it doesn't thrash unchanged rows.
 *
 * Run from Editor: open Apps Script → select fixLoyaltyDiscountMarkers → Run
 */
function fixLoyaltyDiscountMarkers() {
  const ss  = getSpreadsheet();
  const ws  = getOrCreateTab(ss, TAB_ORDERS, ORDERS_HEADERS);
  const data = ws.getDataRange().getValues();
  if (data.length < 2) { console.log("No data rows."); return; }

  const headers = data[0];
  const colIdx  = {};
  headers.forEach((h, i) => { colIdx[String(h).trim()] = i; });

  const COL_PHONE   = colIdx["Phone"];
  const COL_DATE    = colIdx["Order_Date"];
  const COL_STATUS  = colIdx["Payment_Status"];
  const COL_SUBTOT  = colIdx["Food_Subtotal"];
  const COL_LOYDISC = colIdx["Loyalty_Discount"];
  const COL_DISCAMT = colIdx["Discount_Amount"];

  if (COL_LOYDISC === undefined) {
    console.error("Loyalty_Discount column not found. Run initSchema() first.");
    return;
  }

  // ── 1. Group rows by phone ──────────────────────────────────
  const byPhone = {}; // phone → [{ rowIndex(1-based), date, subtotal, status, discAmt, current }]
  for (let i = 1; i < data.length; i++) {
    const row    = data[i];
    const phone  = _normalizePhone(String(row[COL_PHONE] || "").trim());
    if (!phone) continue;
    const stat   = String(row[COL_STATUS] || "").toLowerCase();
    const rawDate = row[COL_DATE];
    const dateStr = rawDate instanceof Date
      ? Utilities.formatDate(rawDate, "Asia/Kolkata", "yyyy-MM-dd")
      : String(rawDate || "").trim();
    if (!dateStr) continue;

    if (!byPhone[phone]) byPhone[phone] = [];
    byPhone[phone].push({
      rowIndex: i + 1,          // 1-based sheet row
      date:     dateStr,
      subtotal: Number(row[COL_SUBTOT] || 0),
      discAmt:  Number(row[COL_DISCAMT] || 0),
      status:   stat,
      current:  String(row[COL_LOYDISC] || "").trim()
    });
  }

  // ── 2. For each customer, replay streak forward in time ─────
  const writes = []; // { rowIndex, value }
  let changed = 0, unchanged = 0;

  // Admin-marked kitchen-closed days (past dates included) — skipped like
  // Sundays so an owner day-off never counts as the customer breaking a streak.
  const closedSet = _kitchenClosedSet();

  Object.entries(byPhone).forEach(([phone, rows]) => {
    // Sort chronologically, then by rowIndex (multiple meals same day)
    rows.sort((a, b) => a.date.localeCompare(b.date) || a.rowIndex - b.rowIndex);

    // Aggregate per day: group rows by date, pick only active orders
    const activeDayMap = {}; // date → [rows]
    rows.forEach(r => {
      const cancelled = r.status.includes("cancelled") || r.status.includes("deleted");
      if (cancelled) return;
      if (!activeDayMap[r.date]) activeDayMap[r.date] = [];
      activeDayMap[r.date].push(r);
    });

    // Get sorted unique active days
    const activeDates = Object.keys(activeDayMap).sort();

    let streakCount = 0; // consecutive active days going forward
    let prevDate    = null;

    activeDates.forEach(dateStr => {
      const d = new Date(dateStr + "T00:00:00+05:30");
      const dow = d.getDay(); // 0=Sun

      // Check continuity: is this date the "next expected" day after prevDate?
      let isContinuous = false;
      if (!prevDate) {
        isContinuous = true; // first ever day always starts streak
      } else {
        // Advance prevDate forward by 1+ days, skipping Sundays AND admin-closed
        // days, to see if we land on dateStr
        const prev = new Date(prevDate + "T00:00:00+05:30");
        let nxt = new Date(prev); nxt.setDate(nxt.getDate() + 1);
        let nxtISO = Utilities.formatDate(nxt, "Asia/Kolkata", "yyyy-MM-dd");
        while (nxt.getDay() === 0 || closedSet[nxtISO]) { // skip Sundays + kitchen-closed days
          nxt.setDate(nxt.getDate() + 1);
          nxtISO = Utilities.formatDate(nxt, "Asia/Kolkata", "yyyy-MM-dd");
        }
        isContinuous = (nxtISO === dateStr);
      }

      if (!isContinuous) {
        // Gap — reset streak
        streakCount = 0;
      }

      const is6thDay = (streakCount === 5); // 0-indexed: 0=1st, 5=6th

      // Mark all rows for this date
      activeDayMap[dateStr].forEach(r => {
        const expected = is6thDay ? "Yes" : "No";
        writes.push({ rowIndex: r.rowIndex, value: expected });
        if (r.current !== expected) changed++;
        else unchanged++;
      });

      if (is6thDay) {
        streakCount = 0; // reset after reward day
      } else {
        streakCount++;
      }

      prevDate = dateStr;
    });

    // Also mark cancelled rows on 6th-day dates as "No" (they didn't get reward)
    rows.forEach(r => {
      const cancelled = r.status.includes("cancelled") || r.status.includes("deleted");
      if (!cancelled) return;
      // Already handled above for active rows; just ensure cancelled don't have "Yes" erroneously
      if (r.current === "Yes") {
        writes.push({ rowIndex: r.rowIndex, value: "No" });
        changed++;
      }
    });
  });

  // ── 3. Batch-write all changes ──────────────────────────────
  writes.forEach(w => {
    ws.getRange(w.rowIndex, COL_LOYDISC + 1).setValue(w.value);
  });

  console.log(`fixLoyaltyDiscountMarkers complete.`);
  console.log(`  Rows updated : ${changed}`);
  console.log(`  Rows already correct: ${unchanged}`);
  console.log(`  Total writes : ${writes.length}`);
}

/**
 * RECONCILIATION SYSTEM
 */

function getUnpaidOrdersData(p) {
  const dateFrom = p.dateFrom;
  const dateTo = p.dateTo;
  if (!dateFrom || !dateTo) return {success:false, error:"dateFrom and dateTo required"};

  const ss = getSpreadsheet();
  const ws = getOrCreateTab(ss, TAB_ORDERS, ORDERS_HEADERS);
  const rows = getAllRows(ws);

  const relevant = rows.filter(r => {
    const d = r.Order_Date instanceof Date ? Utilities.formatDate(r.Order_Date,"Asia/Kolkata","yyyy-MM-dd") : String(r.Order_Date).trim();
    return d >= dateFrom && d <= dateTo &&
    (r.Payment_Status === "Pending" || r.Payment_Status === "on account" || !r.Payment_Status);
  });

  const orders = relevant.map(r => ({
    id: r.Submission_ID,
    date: r.Order_Date instanceof Date ? Utilities.formatDate(r.Order_Date,"Asia/Kolkata","yyyy-MM-dd") : String(r.Order_Date).trim(),
    phone: r.Phone,
    name: r.Customer_Name,
    total: Math.round(Number(r.Net_Total) || 0),
    status: r.Payment_Status || "Pending",
    meal: r.Meal_Type
  }));

  return {success:true, orders};
}

function reconcileTransactions(body) {
  const transactions = body.transactions; // [{date, description, amount}]
  const dateFrom = body.dateFrom;
  const dateTo = body.dateTo;
  
  const unpaid = getUnpaidOrdersData({dateFrom, dateTo}).orders;
  
  // Group unpaid orders by customer
  const groupedByPhone = {};
  unpaid.forEach(o => {
    const key = String(o.phone || "").trim();
    if (!key) return;
    if (!groupedByPhone[key]) groupedByPhone[key] = { name: o.name, orders: [] };
    groupedByPhone[key].orders.push(o);
  });

  const results = transactions.map(tx => {
    const txAmount = Math.round(Number(tx.amount) || 0);
    const txDesc = String(tx.description || "").toLowerCase();
    
    let bestMatch = { status: "No Match", reason: "No matching name found", matchedOrders: [] };
    
    for (const phone in groupedByPhone) {
      const data = groupedByPhone[phone];
      const nameParts = data.name.toLowerCase().replace(/[^a-z ]/g, "").split(" ").filter(x => x.length > 2);
      const cleanDesc = txDesc.replace(/[^a-z]/g, "");
      
      // Smart matching: Check if all significant parts of the customer name exist in the narration string
      const nameMatch = nameParts.length > 0 && nameParts.every(part => cleanDesc.includes(part));
      
      if (nameMatch) {
        const orders = data.orders;
        const totalPending = Math.round(orders.reduce((s, o) => s + o.total, 0));
        
        if (totalPending === txAmount) {
          bestMatch = {
            status: "Match",
            matchType: "Full Pending",
            phone: phone,
            name: data.name,
            matchedOrders: orders,
            total: totalPending
          };
          break;
        }
        
        // Try single order match
        const singleMatch = orders.find(o => Math.round(o.total) === txAmount);
        if (singleMatch) {
          bestMatch = {
            status: "Match",
            matchType: "Single Order",
            phone: phone,
            name: data.name,
            matchedOrders: [singleMatch],
            total: singleMatch.total
          };
          break;
        }

        // Try grouped by date match (e.g. B+L+D for same day)
        const byDate = {};
        orders.forEach(o => {
          if (!byDate[o.date]) byDate[o.date] = 0;
          byDate[o.date] += o.total;
        });
        
        let dateMatched = false;
        for (const date in byDate) {
          if (Math.round(byDate[date]) === txAmount) {
            bestMatch = {
              status: "Match",
              matchType: "Daily Total",
              phone: phone,
              name: data.name,
              matchedOrders: orders.filter(o => o.date === date),
              total: Math.round(byDate[date])
            };
            dateMatched = true;
            break;
          }
        }
        if (dateMatched) break;
        
        // If name matches but amount doesn't
        bestMatch = {
          status: "Partial",
          reason: "Name matches, amount mismatch (Tx: " + txAmount + ", Pending: " + totalPending + ")",
          phone: phone,
          name: data.name,
          matchedOrders: []
        };
      }
    }
    
    return {
      transaction: tx,
      ...bestMatch
    };
  });
  
  return {success:true, results};
}

function markOrdersPaidBulk(body) {
  const sids = body.submissionIds;
  if (!sids || !sids.length) return {success:false, error:"submissionIds required"};
  
  const ss = getSpreadsheet();
  const ws = getOrCreateTab(ss, TAB_ORDERS, ORDERS_HEADERS);
  const headers = ws.getRange(1,1,1,ws.getLastColumn()).getValues()[0];
  const hIdx = {};
  headers.forEach((h,i) => { hIdx[h] = i+1; });
  
  const rows = getAllRows(ws);
  let updated = 0;
  
  rows.forEach(r => {
    if (sids.includes(String(r.Submission_ID)) && 
        (r.Payment_Status === "Pending" || r.Payment_Status === "on account" || !r.Payment_Status)) {
      ws.getRange(r._row, hIdx["Payment_Status"]).setValue("Paid");
      updated++;
    }
  });
  
  return {success:true, updated};
}
