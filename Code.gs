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

const CODE_VERSION   = 15.5; // 2026-06-10: ADD autoMarkDeliveredDaily midnight trigger + resilient Start Delivery (optimistic unlock + offline queue)
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

    // Regular order submission
    return jsonRes(submitOrder(body));
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
  if (!ws) {
    ws = ss.insertSheet(name);
  }
  
  if (headers && headers.length > 0) {
    const lastCol = ws.getLastColumn();
    const currentHeaders = lastCol > 0 ? ws.getRange(1, 1, 1, lastCol).getValues()[0].map(h => String(h||"").trim()) : [];
    
    // Force header row synchronization by explicitly setting range if any mismatch
    headers.forEach((h, i) => {
      if (currentHeaders[i] !== h) {
        ws.getRange(1, i + 1).setValue(h)
          .setFontWeight("bold")
          .setBackground("#c0392b")
          .setFontColor("white");
        if (i === 0) ws.setFrozenRows(1);
        // Force certain columns to stay as Plain Text to preserve leading zeros
        if (h === "Phone" || h === "PIN") {
          ws.getRange(1, i + 1, ws.getMaxRows(), 1).setNumberFormat("@");
        }
      }
    });

    // CRITICAL: If headers were provided, ensure No Extra Columns exist beyond them
    // This prevents "Timestamp" duplicates if things drifted in legacy versions
    if (headers.length > 0 && ws.getLastColumn() > headers.length) {
      const extra = ws.getLastColumn() - headers.length;
      ws.deleteColumns(headers.length + 1, extra);
    }
  }
  return ws;
}

// ── CACHE HELPER ────────────────────────────────────────────
// Cross-execution cache using Apps Script CacheService.
// Falls back gracefully if value is too large (>100 KB) to store.
function _cachedData(key, ttlSeconds, fetchFn) {
  const cache = CacheService.getScriptCache();
  const hit = cache.get(key);
  if (hit !== null) {
    try { return JSON.parse(hit); } catch(e) {}
  }
  const data = fetchFn();
  try { cache.put(key, JSON.stringify(data), ttlSeconds); } catch(e) {
    // Value may exceed 100 KB limit — silent fallback to uncached
  }
  return data;
}

function _invalidateCache() {
  const keys = Array.from(arguments);
  if (!keys.length) return;
  try { CacheService.getScriptCache().removeAll(keys); } catch(e) {}
}

function getISTDate() {
  const now = new Date();
  // Cross-environment IST Date object
  return new Date(now.getTime() + (now.getTimezoneOffset() + 330) * 60000);
}

function getISTTimestamp() {
  return Utilities.formatDate(getISTDate(), "Asia/Kolkata", "yyyy-MM-dd HH:mm:ss");
}

function generateSubmissionID() {
  const ist = getISTDate();
  const dateStr = Utilities.formatDate(ist, "Asia/Kolkata", "yyyyMMdd");
  const rand = Math.floor(Math.random() * 9000) + 1000;
  return `SK-${dateStr}-${rand}`;
}

function headerIndex(ws) {
  // Returns {colName: 1-based-index} for the given sheet
  const headers = ws.getRange(1, 1, 1, ws.getLastColumn()).getValues()[0];
  const idx = {};
  headers.forEach((h, i) => { idx[h] = i + 1; });
  return idx;
}

function getAllRows(ws) {
  const last = ws.getLastRow();
  if (last < 2) return [];
  const data = ws.getRange(2, 1, last - 1, ws.getLastColumn()).getValues();
  const headers = ws.getRange(1, 1, 1, ws.getLastColumn()).getValues()[0];
  return data.map((row, ri) => {
    const obj = {_row: ri + 2};
    headers.forEach((h, i) => { obj[h] = row[i]; });
    return obj;
  });
}

function _get(obj, key) {
  if (!obj || !key) return undefined;
  if (obj[key] !== undefined) return obj[key];
  const nk = key.replace(/_/g, ' ').toLowerCase();
  for (let k in obj) {
    if (k.replace(/_/g, ' ').toLowerCase() === nk) return obj[k];
  }
  return undefined;
}

function _cleanNum(val) {
  if (typeof val === "number") return val;
  const s = String(val || "").replace(/[^\d.-]/g, '');
  const n = Number(s);
  return isNaN(n) ? 0 : n;
}

function getRecentRows(ws, maxRows) {
  const last = ws.getLastRow();
  if (last < 2) return [];
  const startRow = Math.max(2, last - maxRows + 1);
  const data = ws.getRange(startRow, 1, last - startRow + 1, ws.getLastColumn()).getValues();
  const headers = ws.getRange(1, 1, 1, ws.getLastColumn()).getValues()[0];
  return data.map((row, ri) => {
    const obj = {_row: ri + startRow};
    headers.forEach((h, i) => { obj[h] = row[i]; });
    return obj;
  });
}

// ── SCHEMA INIT ──────────────────────────────────────────────
function initSchema() {
  const ss = getSpreadsheet();
  getOrCreateTab(ss, TAB_ORDERS, ORDERS_HEADERS);
  getOrCreateTab(ss, TAB_CUSTOMERS, CUSTOMERS_HEADERS);
  getOrCreateTab(ss, TAB_MENU, [
    "Date","Breakfast_JSON","Lunch_Dry","Lunch_Curry","Dinner_Dry","Dinner_Curry",
    "Cutoff_Breakfast","Cutoff_Lunch","Cutoff_Dinner",
    "OOS_JSON","Orders_Closed","Stock_JSON"
  ]);
  getOrCreateTab(ss, TAB_BF_MASTER, ["ID","Name","Price","Active"]);
  getOrCreateTab(ss, TAB_SABJI,     ["ID","Name","Type","Active"]);
  getOrCreateTab(ss, TAB_WALLET, WALLET_HEADERS);
  return {success: true, message: "Schema initialised"};
}

/**
 * Normalizes phone numbers for reliable comparison across Google Sheets.
 * Handles scientific notation (e.g., 9.87E+9) and trailing decimals (.0).
 */
// Returns true if the order should be excluded from kitchen/prep counts.
// "Cancelled (Verify UPI)" = soft-cancel pending admin verification —
// the customer already requested cancellation, do NOT include in kitchen prep.
function _isOrderCancelled(paymentStatus) {
  const s = String(paymentStatus || "").toLowerCase();
  return s === "cancelled" || s.startsWith("cancelled");
}

// ── STOCK LIMIT HELPERS ─────────────────────────────────────
// Map admin-stock colKey to the name used in Items_JSON.
// Breakfast Curd is stored as "Breakfast Curd" (new rows) — old rows stored it
// as plain "Curd". countOrderedUnits handles both for backward compat.
function itemsJsonKey(colKey) { return colKey === "B_CURD" ? "Breakfast Curd" : colKey; }

// Count ordered units per meal/item for a given date, excluding cancelled orders.
function countOrderedUnits(ordersRows, dateStr) {
  const counts = { Breakfast: {}, Lunch: {}, Dinner: {} };
  ordersRows.forEach(row => {
    if (_isOrderCancelled(row.Payment_Status)) return;
    const d = row.Order_Date instanceof Date
      ? Utilities.formatDate(row.Order_Date, "Asia/Kolkata", "yyyy-MM-dd")
      : String(row.Order_Date || "").trim();
    if (d !== dateStr) return;
    const meal = String(row.Meal_Type || "");
    if (!counts[meal]) return;
    let items = {};
    try { items = JSON.parse(row.Items_JSON || "{}"); } catch(e) {}
    Object.entries(items).forEach(([name, qty]) => {
      // Backward compat: old Breakfast rows stored Curd as "Curd". Normalize to
      // "Breakfast Curd" so aggregates match the new canonical key.
      let k = name;
      if (meal === "Breakfast" && name === "Curd") k = "Breakfast Curd";
      counts[meal][k] = (counts[meal][k] || 0) + Number(qty || 0);
    });
  });
  return counts;
}

function _normalizePhone(phone) {
  let p = String(phone || "").trim();
  if (!p) return "";
  // Scientific notation (Sheets quirk: 9.87654321e+9)
  if (p.toUpperCase().includes("E+") && !isNaN(Number(p))) {
    p = String(Math.round(Number(p)));
  }
  // Trailing decimal from Sheets (9876543210.0)
  if (p.includes(".")) p = p.split(".")[0];
  // Strip everything that isn't a digit (removes +, spaces, dashes, parens, country-code prefixes)
  p = p.replace(/\D/g, "");
  // 12-digit with 91 country code → 10-digit
  if (p.length === 12 && p.startsWith("91")) p = p.substring(2);
  // 11-digit with leading zero → 10-digit
  if (p.length === 11 && p.startsWith("0")) p = p.substring(1);
  return p;
}

// ── GET CUSTOMER ─────────────────────────────────────────────
function getCustomer(phone) {
  if (!phone) return {found: false};
  const ss = getSpreadsheet();
  const ws = getOrCreateTab(ss, TAB_CUSTOMERS, CUSTOMERS_HEADERS);
  const rows = getAllRows(ws);
  const pStr = _normalizePhone(phone);
  const r = rows.find(x => _normalizePhone(x.Phone) === pStr);
  if (!r) return {found: false, hasPin: false, wallet_balance: 0};
  
  const hasPin = (String(r.PIN || "").trim() !== "");
  
  if (hasPin) {
    // Return early without profile details to secure them.
    return { found: true, hasPin: true };
  }
  
  return {
    found: true,
    hasPin: false,
    name:               r.Customer_Name || "",
    area:               r.Area || "",
    wing:               r.Wing || "",
    flat:               r.Flat || "",
    floor:              r.Floor || "",
    society:            r.Society || "",
    maps:               r.Maps_Link || "",
    landmark:           r.Landmark || "",
    payment_preference: r.Payment_Freq || "Daily Payment",
    meal_addresses:     r.Meal_Addresses || "",
    promoCount: (function(v){
      if (v === "" || v === null || v === undefined) return null;
      var num = Number(v);
      return isNaN(num) ? v : num;
    })(r.Review_Promo_Count),
    wallet_balance:     _calculateWalletBalance(phone),
    feeExempt:          (r.Fee_Exempt === "Yes" || r.Fee_Exempt === true),
    onAccount:          r.On_Account || "No",
    billingCycle:       r.Billing_Cycle || "Daily"
  };
}

// ── VERIFY LOGIN ─────────────────────────────────────────────
function verifyLogin(phone, pin) {
  if (!phone || !pin) return {success: false, error: "Missing Phone or PIN."};
  const ss = getSpreadsheet();
  const ws = getOrCreateTab(ss, TAB_CUSTOMERS, CUSTOMERS_HEADERS);
  const rows = getAllRows(ws);
  const pStr = _normalizePhone(phone);
  const r = rows.find(x => _normalizePhone(x.Phone) === pStr);
  
  if (!r) return {success: false, error: "Account not found."};
  if (String(r.PIN).trim() !== String(pin).trim()) return {success: false, error: "Incorrect PIN."};
  
  let pendingAmount = 0;
  const isOnAccount = String(_get(r, "On_Account") || "").trim().toLowerCase() === "yes";
  
  if (isOnAccount) {
    const wsOrders = getOrCreateTab(ss, TAB_ORDERS, ORDERS_HEADERS);
    const orderRows = getAllRows(wsOrders);
    for (const ord of orderRows) {
      if (_normalizePhone(_get(ord, "Phone")) === pStr) {
        const ps = String(_get(ord, "Payment_Status") || "").trim().toLowerCase();
        if (ps === "on account" || ps === "onaccount" || ps === "pending" || ps === "") {
          pendingAmount += _cleanNum(_get(ord, "Net_Total"));
        }
      }
    }
  }

  return {
    success: true,
    profile: {
      name:               r.Customer_Name || "",
      area:               r.Area || "",
      wing:               r.Wing || "",
      flat:               r.Flat || "",
      floor:              r.Floor || "",
      society:            r.Society || "",
      maps:               r.Maps_Link || "",
      landmark:           r.Landmark || "",
      payment_preference: r.Payment_Freq || "Daily Payment",
      meal_addresses:     r.Meal_Addresses || "",
      promoCount: (function(v){
        if (v === "" || v === null || v === undefined) return null;
        var num = Number(v);
        return isNaN(num) ? v : num;
      })(r.Review_Promo_Count),
      wallet_balance:     _calculateWalletBalance(phone),
      feeExempt:          (r.Fee_Exempt === "Yes" || r.Fee_Exempt === true),
      onAccount:          r.On_Account || "No",
      billingCycle:       r.Billing_Cycle || "Daily",
      pending_amount:     pendingAmount
    }
  };
}

// ── AUTO-SETTLE PENDING ORDERS ──────────────────────────────
function _autoSettlePendingOrders(phone) {
  const pStr = _normalizePhone(phone);
  
  const ss = getSpreadsheet();
  const profWs = getOrCreateTab(ss, TAB_CUSTOMERS, CUSTOMERS_HEADERS);
  const profRows = getAllRows(profWs);
  const profile = profRows.find(r => _normalizePhone(r.Phone) === pStr);
  
  // Rule 1: Only for On Account users
  if (!profile || (String(profile.On_Account).trim().toLowerCase() !== "yes")) {
    return { settled: 0, msg: "" };
  }

  const wsOrders = getOrCreateTab(ss, TAB_ORDERS, ORDERS_HEADERS);
  const rows = getAllRows(wsOrders);
  const hIdx = headerIndex(wsOrders);

  // Rule 2: Only target "on account" orders (ignore normal Pending/UPI)
  const pendingOrders = rows.filter(r => {
    if (_normalizePhone(_get(r, "Phone")) !== pStr) return false;
    const ps = String(_get(r, "Payment_Status") || "").trim().toLowerCase();
    if (ps !== "on account" && ps !== "onaccount") return false;
    return _cleanNum(_get(r, "Net_Total")) > 0;
  });

  if (pendingOrders.length === 0) return { settled: 0, msg: "" };

  pendingOrders.sort((a, b) => String(_get(a, "Order_Date")).localeCompare(String(_get(b, "Order_Date"))));

  let walletBalance = _calculateWalletBalance(phone);
  if (walletBalance <= 0) return { settled: 0, msg: "" };

  let totalSettled = 0;
  let ordersSettledCount = 0;
  let originalPendingAmount = pendingOrders.reduce((sum, o) => sum + _cleanNum(_get(o, "Net_Total")), 0);
  
  let currentWallet = walletBalance;

  for (let order of pendingOrders) {
    let amount = _cleanNum(_get(order, "Net_Total"));
    if (currentWallet >= amount) {
      wsOrders.getRange(order._row, hIdx["Payment_Status"]).setValue("Paid");
      _appendWalletTransaction(phone, _get(order, "Customer_Name") || "Customer", "Auto-deducted for On Account order " + (_get(order, "Submission_ID") || _get(order, "Order_Date")), amount, true, "AUTO-" + Date.now() + "-" + Math.floor(Math.random()*1000));
      currentWallet -= amount;
      totalSettled += amount;
      ordersSettledCount++;
    } else {
      break;
    }
  }

  if (ordersSettledCount > 0) {
    if (originalPendingAmount <= walletBalance) {
      return { 
        settled: totalSettled, 
        msg: `Wallet recharge used against the pending orders. Balance is now: Wallet ₹${currentWallet}` 
      };
    } else {
      // Wallet < Pending overall
      return { 
        settled: totalSettled, 
        msg: `Wallet recharge applied! Note: ₹${originalPendingAmount - totalSettled} is still pending on account.` 
      };
    }
  }

  // If we couldn't settle even one full order but they have wallet balance
  if (originalPendingAmount > 0 && walletBalance > 0 && walletBalance < originalPendingAmount) {
    return {
      settled: 0,
      msg: `Recharge added to wallet (₹${walletBalance}). You still have ₹${originalPendingAmount} pending on account.`
    };
  }

  return { settled: 0, msg: "" };
}

// ── WALLET HELPER ──────────────────────────────────────────
function _calculateWalletBalance(phone, preloadedRows) {
  if (!phone) return 0;
  const ss = getSpreadsheet();
  const ws = getOrCreateTab(ss, TAB_WALLET, WALLET_HEADERS);
  const rows = Array.isArray(preloadedRows) ? preloadedRows : getAllRows(ws);

  let balance = 0;
  const pStr = _normalizePhone(phone);

  rows.forEach(w => {
    const rPhone = _normalizePhone(w.Phone);
    if (rPhone !== pStr) return;

    // Only count verified transactions
    const rVer = String(w.Verified || "").trim().toUpperCase();
    if (rVer !== "TRUE" && rVer !== "YES" && rVer !== "VERIFIED") return;

    const rAmt = _cleanNum(_get(w, "Amount"));
    // Also check legacy columns where Txn_Type may have been stored in a "Balance" column
    const rType = String(_get(w, "Txn_Type") || _get(w, "Balance") || "").trim().toLowerCase();

    if (rType.includes("recharge") || rType.includes("refund") || rType.includes("credit")
        || rType.includes("carry forward") || rType.includes("carry-forward")) {
      balance += rAmt;
    } else if (rType.includes("order") || rType.includes("deduct") || rType.includes("payment")) {
      balance -= rAmt;
    }
  });

  return Math.round(balance * 100) / 100;
}

/**
 * Returns last 10 wallet transactions for a customer, newest first.
 * Each entry: { type, amount, direction, verified, reference, timestamp, balance_after }
 */
function getWalletTransactions(phone) {
  if (!phone) return { transactions: [] };
  const ss   = getSpreadsheet();
  const ws   = getOrCreateTab(ss, TAB_WALLET, WALLET_HEADERS);
  const rows = getAllRows(ws);
  const pStr = _normalizePhone(phone);

  // Filter to this customer's rows only, parse timestamps for sorting
  const mine = rows
    .filter(w => _normalizePhone(w.Phone) === pStr)
    .map(w => {
      const rType = String(w.Txn_Type || "").trim();
      const rAmt  = Number(w.Amount) || 0;
      const rVer  = String(w.Verified || "").trim().toUpperCase();
      const verified = (rVer === "TRUE" || rVer === "YES" || rVer === "VERIFIED");
      const typeLow  = rType.toLowerCase();
      const isCredit = typeLow.includes("recharge") || typeLow.includes("refund")
                    || typeLow.includes("credit") || typeLow.includes("carry forward")
                    || typeLow.includes("carry-forward");
      const rawTs  = w.Timestamp;
      const tsDate = rawTs instanceof Date ? rawTs : new Date(rawTs || 0);
      return {
        type:      rType || "Transaction",
        amount:    rAmt,
        direction: isCredit ? "credit" : "debit",
        verified,
        reference: String(w.Reference_ID || "").trim(),
        timestamp: rawTs instanceof Date
          ? Utilities.formatDate(rawTs, "Asia/Kolkata", "dd MMM yyyy, h:mm a")
          : String(rawTs || "").trim(),
        _ts: tsDate.getTime()
      };
    });

  // Sort newest first, take last 10
  mine.sort((a, b) => b._ts - a._ts);
  const top10 = mine.slice(0, 10).map(t => { delete t._ts; return t; });

  return { transactions: top10 };
}

// ── GET MENU ─────────────────────────────────────────────────
function getMenu(dateStr) {
  // Cache per-date for 60 s. The hard stock-block in submitOrder (under LockService)
  // prevents actual over-orders even when menu data is slightly stale.
  return _cachedData("menu_v2_" + dateStr, 60, function() { return _getMenuUncached(dateStr); });
}

function getMenuBatch(datesStr) {
  const dates = String(datesStr || "").split(',').map(d => d.trim()).filter(Boolean);
  const result = {};
  dates.forEach(d => {
    // Rely on the existing cached helper so we don't duplicate logic
    result[d] = getMenu(d);
  });
  return result;
}

// For the REORDER flow: given a comma-separated list of breakfast item names,
// returns whether the calendar should be restricted and to which dates.
//  - Everyday items (master Active, e.g. Poha/Upma) impose NO restriction.
//  - Special items (e.g. Aloo Paratha) restrict to upcoming dates whose daily
//    Breakfast_JSON includes them (intersection if several specials).
// Returns { restrict: bool, dates: ["yyyy-MM-dd", ...] }.
function getBreakfastItemDates(itemsStr) {
  const items = String(itemsStr || "").split(',').map(s => s.trim()).filter(Boolean);
  if (!items.length) return { restrict: false, dates: [] };
  const _norm = function(n){ return String(n||"").toLowerCase().replace(/\[[^\]]*\]/g,"").replace(/\([^)]*\)/g,"").replace(/\s+/g," ").trim(); };
  const ss = getSpreadsheet();

  // Everyday (master-Active) breakfast item names — these are on EVERY day.
  const bfWs = getOrCreateTab(ss, TAB_BF_MASTER, []);
  const activeSet = new Set(getAllRows(bfWs).filter(function(x){ return String(x.Active).toLowerCase() !== "false"; }).map(function(x){ return _norm(x.Name); }));

  const specials = items.map(_norm).filter(function(n){ return n && !activeSet.has(n); });
  if (!specials.length) return { restrict: false, dates: [] }; // all everyday → no restriction

  const today = Utilities.formatDate(new Date(), "Asia/Kolkata", "yyyy-MM-dd");
  const menuWs = getOrCreateTab(ss, TAB_MENU, []);
  const datesByItem = {};
  specials.forEach(function(s){ datesByItem[s] = {}; });
  getAllRows(menuWs).forEach(function(r){
    const d = r.Date instanceof Date ? Utilities.formatDate(r.Date, "Asia/Kolkata", "yyyy-MM-dd") : String(r.Date||"").trim();
    if (!d || d < today || !r.Breakfast_JSON) return;
    let parsed; try { parsed = JSON.parse(r.Breakfast_JSON); } catch(e) { return; }
    if (!Array.isArray(parsed)) return;
    const namesOnDay = {};
    parsed.forEach(function(x){ namesOnDay[_norm(x && x.name)] = true; });
    specials.forEach(function(s){ if (namesOnDay[s]) datesByItem[s][d] = true; });
  });

  // allowed = intersection of every special item's date set
  let allowed = null;
  specials.forEach(function(s){
    const ks = Object.keys(datesByItem[s]);
    if (allowed === null) allowed = ks;
    else allowed = allowed.filter(function(x){ return datesByItem[s][x]; });
  });
  return { restrict: true, dates: (allowed || []).sort() };
}

function _getMenuUncached(dateStr) {
  const ss = getSpreadsheet();
  const ws = getOrCreateTab(ss, TAB_MENU, []);
  const rows = getAllRows(ws);
  const r = rows.find(x => {
    const d = x.Date instanceof Date
      ? Utilities.formatDate(x.Date, "Asia/Kolkata", "yyyy-MM-dd")
      : String(x.Date).trim();
    return d === dateStr;
  });

  // Admin can mark a specific (non-Sunday) day as Kitchen Closed via the
  // Daily Menu tab. When set, customer calendar greys out the day and any
  // submitOrder attempt for it is rejected server-side.
  const _kitchenClosed = !!(r && (r.Kitchen_Closed === true ||
    String(r.Kitchen_Closed || "").toLowerCase() === "true"));

  // Breakfast master items
  const bfWs = getOrCreateTab(ss, TAB_BF_MASTER, []);
  const bfRows = getAllRows(bfWs).filter(x => String(x.Active).toLowerCase() !== "false");
  
  const NAME_MAP = {
    "Kanda Poha": "Kanda Poha [175g]",
    "Ghee Upma": "Ghee Upma [200g]",
    "Sabudana Khichdi": "Sabudana Khichdi [200g]",
    "Tikhi Pudi": "5 x Tikhi Pudi with 100 ml coriander chutney",
    "Tikhi Puri": "5 x Tikhi Pudi with 100 ml coriander chutney",
    "Idli Chutney": "4 x Idli & 100ml Chutney",
    "Idli": "4 x Idli & 100ml Chutney",
    "4 x Idli & 100ml Chutney": "4 x Idli & 100ml Chutney",
    "Ghee Sheera": "Ghee Sheera [200g]"
  };

  const breakfast = bfRows.map(x => {
    const rawName = String(x.Name).trim();
    return {
      name: NAME_MAP[rawName] || rawName,
      price: Number(x.Price)
    };
  });

  // Determine if this date is a Sunday with no sabjis set.
  // Kitchen is closed on Sundays by default; admin can override by setting at least one sabji.
  const _dayName   = Utilities.formatDate(new Date(dateStr + "T12:00:00+05:30"), "Asia/Kolkata", "EEEE");
  const _isSunday  = _dayName === "Sunday";
  const _hasSabjis = r && (r.Lunch_Dry || r.Lunch_Curry || r.Dinner_Dry || r.Dinner_Curry);

  if (!r) {
    // No menu row at all — if Sunday, close everything; otherwise return open empty menu.
    return {
      breakfast, lunch_dry:"", lunch_curry:"", dinner_dry:"", dinner_curry:"",
      cutoff_overrides:{},
      oos_items: { Breakfast: [], Lunch: [], Dinner: [] },
      orders_closed: _isSunday ? { Breakfast: true, Lunch: true, Dinner: true } : {},
      stock_limits: {},
      units_remaining: {},
      sunday_closed: _isSunday
    };
  }

  // Menu row exists but it's a Sunday with no sabjis — still treat as closed.
  if (_isSunday && !_hasSabjis) {
    let ordersClosed2 = { Breakfast: true, Lunch: true, Dinner: true };
    return {
      breakfast, lunch_dry:"", lunch_curry:"", dinner_dry:"", dinner_curry:"",
      cutoff_overrides:{},
      oos_items: { Breakfast: [], Lunch: [], Dinner: [] },
      orders_closed: ordersClosed2,
      stock_limits: {},
      units_remaining: {},
      sunday_closed: true
    };
  }

  const co = {};
  if (r && r.Cutoff_Breakfast) co.Breakfast = Number(r.Cutoff_Breakfast);
  if (r && r.Cutoff_Lunch)     co.Lunch     = Number(r.Cutoff_Lunch);
  if (r && r.Cutoff_Dinner)    co.Dinner    = Number(r.Cutoff_Dinner);

  // MERGE LOGIC: Start with master active items, then merge daily overrides
  const masterActive = breakfast;
  let dailyBf = [];
  if (r && r.Breakfast_JSON) {
    try { 
      const parsed = JSON.parse(r.Breakfast_JSON); 
      dailyBf = parsed.map(d => ({
        ...d,
        name: d.name ? (NAME_MAP[d.name.trim()] || d.name) : ""
      }));
    } catch(e) {}
  }

  // Prioritize Daily selections (where specific prices or choices were made)
  // but ensure Master Active items are always present.
  const finalBreakfast = [...dailyBf];
  masterActive.forEach(m => {
    if (!finalBreakfast.some(d => d.name === m.name)) {
      finalBreakfast.push(m);
    }
  });

  let oosItems = { Breakfast: [], Lunch: [], Dinner: [] };
  try { if (r && r.OOS_JSON) oosItems = JSON.parse(r.OOS_JSON); } catch(e) {}

  let ordersClosed = {};
  try { if (r && r.Orders_Closed) ordersClosed = JSON.parse(r.Orders_Closed); } catch(e) {}

  let stockLimits = {};
  try { if (r && r.Stock_JSON) stockLimits = JSON.parse(r.Stock_JSON); } catch(e) {}

  const ordersWs2   = getOrCreateTab(ss, TAB_ORDERS, []);
  // OPTIMIZATION: Only read the last 500 rows to compute stock limit (covers today and yesterday).
  // This prevents scanning thousands of old orders just to check today's stock.
  const ordersRows2 = getRecentRows(ordersWs2, 500);
  const orderedCounts = countOrderedUnits(ordersRows2, dateStr);
  const unitsRemaining = {};
  ["Breakfast","Lunch","Dinner"].forEach(meal => {
    Object.entries(stockLimits[meal] || {}).forEach(([colKey, limit]) => {
      if (!unitsRemaining[meal]) unitsRemaining[meal] = {};
      unitsRemaining[meal][colKey] = Math.max(0, limit - (orderedCounts[meal][itemsJsonKey(colKey)] || 0));
    });
  });

  return {
    breakfast:    finalBreakfast,
    lunch_dry:    r ? (r.Lunch_Dry || "") : "",
    lunch_curry:  r ? (r.Lunch_Curry || "") : "",
    dinner_dry:   r ? (r.Dinner_Dry || "") : "",
    dinner_curry: r ? (r.Dinner_Curry || "") : "",
    cutoff_overrides: co,
    oos_items:    oosItems,
    orders_closed: ordersClosed,
    stock_limits: stockLimits,
    units_remaining: unitsRemaining,
    kitchen_closed: _kitchenClosed
  };
}

// ── KITCHEN CLOSURE: list of admin-closed (non-Sunday) dates ─────
// Lightweight endpoint used by the customer calendar to grey out
// closed days without having to fetch every date's full menu.
function getKitchenClosedDates() {
  return _cachedData("kitchen_closed_dates_v1", 60, function() {
    const ss   = getSpreadsheet();
    const ws   = getOrCreateTab(ss, TAB_MENU, []);
    const rows = getAllRows(ws);
    const today = getISTDate();
    // Include the recent past (40 days) too — the loyalty streak looks backward
    // and must skip admin days-off so they don't break a customer's streak.
    const cutoff = Utilities.formatDate(new Date(Date.now() - 40 * 86400000), "Asia/Kolkata", "yyyy-MM-dd");
    const closed = [];
    rows.forEach(function(r) {
      const isClosed = (r.Kitchen_Closed === true ||
        String(r.Kitchen_Closed || "").toLowerCase() === "true");
      if (!isClosed) return;
      const d = r.Date instanceof Date
        ? Utilities.formatDate(r.Date, "Asia/Kolkata", "yyyy-MM-dd")
        : String(r.Date).trim();
      if (!d || d < cutoff) return;            // recent past + future
      closed.push(d);
    });
    closed.sort();
    return { closedDates: closed };
  });
}

// ── GET WEEKLY MENU (next 7 days) ────────────────────────────
function getWeeklyMenu() {
  const ss = getSpreadsheet();
  const ws = getOrCreateTab(ss, TAB_MENU, []);
  const rows = getAllRows(ws);

  // Breakfast master items
  const bfWs = getOrCreateTab(ss, TAB_BF_MASTER, []);
  const bfRows = getAllRows(bfWs).filter(x => String(x.Active).toLowerCase() !== "false");
  const defaultBreakfast = bfRows.map(x => ({name: String(x.Name), price: Number(x.Price)}));

  // Build a map: dateStr → row for quick lookup
  const menuMap = {};
  rows.forEach(x => {
    const d = x.Date instanceof Date
      ? Utilities.formatDate(x.Date, "Asia/Kolkata", "yyyy-MM-dd")
      : String(x.Date).trim();
    menuMap[d] = x;
  });

  // Show all dates from today onwards that have a menu row set
  const today = getISTDate();
  const todayStr = Utilities.formatDate(today, "Asia/Kolkata", "yyyy-MM-dd");

  // Collect all future/today dates that have a menu row, sorted ascending
  const futureDates = Object.keys(menuMap)
    .filter(d => d >= todayStr)
    .sort();

  const days = [];
  futureDates.forEach(dateStr => {
    const d = new Date(dateStr + "T00:00:00+05:30");
    const dayName    = Utilities.formatDate(d, "Asia/Kolkata", "EEEE");
    const displayDate = Utilities.formatDate(d, "Asia/Kolkata", "dd MMM");

    const r = menuMap[dateStr];

    // Skip Sundays that have no sabjis set — kitchen is closed by default on Sundays.
    // A Sunday only appears in the weekly menu popup if the admin has explicitly
    // set at least one sabji (Lunch or Dinner), signalling the kitchen is open that day.
    const isSunday = dayName === "Sunday";
    const hasSabjis = r && (r.Lunch_Dry || r.Lunch_Curry || r.Dinner_Dry || r.Dinner_Curry);
    if (isSunday && !hasSabjis) return;

    let bfDaily = [];
    try {
      if (r && r.Breakfast_JSON) bfDaily = JSON.parse(r.Breakfast_JSON);
    } catch(e) {}

    // Merge Master + Daily
    const finalBf = [...bfDaily];
    defaultBreakfast.forEach(m => {
      if (!finalBf.some(x => x.name === m.name)) finalBf.push(m);
    });

    days.push({
      date: dateStr,
      dayName: dayName,
      displayDate: displayDate,
      breakfast: finalBf,
      lunch_dry:    r ? (r.Lunch_Dry    || "") : "",
      lunch_curry:  r ? (r.Lunch_Curry  || "") : "",
      dinner_dry:   r ? (r.Dinner_Dry   || "") : "",
      dinner_curry: r ? (r.Dinner_Curry || "") : "",
      menuSet: true  // only dates with a menu row are included
    });
  });

  return { success: true, days: days };
}

// ── WALLET LOGIC ───────────────────────────────────────────────
/**
 * Append a transaction to SK_Wallet.
 * @param {string} phone      Customer phone number
 * @param {string} name       Customer name
 * @param {string} txnType    e.g. "Order Deduction", "Recharge", "Order Cancellation Refund"
 * @param {number} amount     Absolute transaction amount (always positive)
 * @param {boolean} isVerified TRUE = immediately counted in balance, FALSE = pending admin approval
 * @param {string} [refId]    Reference ID: Submission_ID for orders/refunds, or a recharge txn ref
 */
function _appendWalletTransaction(phone, name, txnType, amount, isVerified, refId) {
  // Serialize wallet writes. Apps Script LockService is re-entrant within the
  // same execution, so this also works when the caller (e.g. submitOrder) is
  // already holding the script lock.
  const lock = LockService.getScriptLock();
  try { lock.waitLock(10000); }
  catch(e) { throw new Error("Wallet busy — please retry in a few seconds."); }
  try {
    const ss = getSpreadsheet();
    const ws = getOrCreateTab(ss, TAB_WALLET, WALLET_HEADERS);
    const hIdx = headerIndex(ws);

    const totalCols = ws.getLastColumn();
    const row = new Array(totalCols).fill("");
    const set = (col, val) => { if (hIdx[col]) row[hIdx[col] - 1] = val; };

    set("Phone",         _normalizePhone(phone));
    set("Customer_Name", name);
    set("Txn_Type",      txnType);
    set("Amount",        amount);
    set("Verified",      isVerified ? "TRUE" : "FALSE");
    set("Reference_ID",  refId || "");
    set("Timestamp",     getISTTimestamp());

    ws.appendRow(row);
    SpreadsheetApp.flush();
  } finally {
    try { lock.releaseLock(); } catch(e) {}
  }
}

// ── MISSED-ORDER SAFETY NET ───────────────────────────────────
/**
 * Called immediately after appendRow for each order row.
 * Saves the order payload to Script Properties as a backup.
 * A separate cleanup pass (called at the end of submitOrder after flush)
 * verifies the row landed in the sheet; if not, it emails admin.
 *
 * This closes the 0.5% gap where GAS buffered writes silently failed.
 */
function _missedOrderSafetyNet(ss, sid, row, phone) {
  try {
    const props  = PropertiesService.getScriptProperties();
    const raw    = props.getProperty("PENDING_ORDER_ROWS") || "{}";
    const store  = JSON.parse(raw);
    // Expire entries older than 10 minutes
    const now    = Date.now();
    Object.keys(store).forEach(k => { if (now - store[k].ts > 10 * 60 * 1000) delete store[k]; });
    store[sid]   = { ts: now, phone: String(phone || ""), row: row };
    props.setProperty("PENDING_ORDER_ROWS", JSON.stringify(store));
  } catch(e) {
    console.error("_missedOrderSafetyNet save failed:", e.message);
  }
}

function _verifyAndAlertMissedOrders(ss, submissionIds) {
  try {
    const props  = PropertiesService.getScriptProperties();
    const raw    = props.getProperty("PENDING_ORDER_ROWS") || "{}";
    const store  = JSON.parse(raw);
    if (!Object.keys(store).length) return;

    const ws     = getOrCreateTab(ss, TAB_ORDERS, ORDERS_HEADERS);
    const hIdx   = headerIndex(ws);
    const sidCol = hIdx["Submission_ID"];
    if (!sidCol) return;

    // Read all Submission_IDs from sheet (last 200 rows for speed)
    const lastRow  = ws.getLastRow();
    const startRow = Math.max(2, lastRow - 200);
    const count    = lastRow - startRow + 1;
    if (count <= 0) return;
    const sidValues = ws.getRange(startRow, sidCol, count, 1).getValues().flat().map(String);
    const inSheet   = new Set(sidValues);

    const missed = [];
    Object.entries(store).forEach(([sid, entry]) => {
      if (!inSheet.has(sid)) {
        console.error("MISSED ORDER DETECTED — " + sid + " not found in sheet after flush!");
        missed.push({ sid, phone: entry.phone, row: entry.row });
        // Emergency re-append
        try {
          ws.appendRow(entry.row);
          console.log("Emergency re-append succeeded for " + sid);
        } catch(e2) {
          console.error("Emergency re-append FAILED for " + sid + ": " + e2.message);
        }
      }
      delete store[sid]; // clear from queue regardless
    });

    props.setProperty("PENDING_ORDER_ROWS", JSON.stringify(store));

    if (missed.length > 0) {
      // Email admin alert
      try {
        const adminEmail = PropertiesService.getScriptProperties().getProperty("ADMIN_EMAIL");
        if (adminEmail) {
          const body = missed.map(m =>
            `SK Order ID: ${m.sid}\nPhone: ${m.phone}\nRow data: ${JSON.stringify(m.row)}`
          ).join("\n\n---\n\n");
          GmailApp.sendEmail(adminEmail, "⚠️ Svaadh: Missed Order Row Detected & Auto-Recovered", body);
        }
      } catch(e) { console.error("Alert email failed:", e.message); }
    }
  } catch(e) {
    console.error("_verifyAndAlertMissedOrders failed:", e.message);
  }
}

// ── SUBMIT ORDER ─────────────────────────────────────────────
function submitOrder(body) {
  // ── REQUEST-LEVEL IDEMPOTENCY ─────────────────────────────────────
  // Frontend retries (apiFetch on timeout) can re-deliver the SAME POST
  // body while the original request is still running on the server. The
  // per-meal duplicate guards below catch most cases, but had an edge
  // case where the cache.put for the last meal of each date hadn't
  // committed before the abort fired — leading to duplicated row writes
  // and duplicate wallet debits.
  //
  // Fix: client passes a unique request_id. The very FIRST thing we do
  // is check the cache for that id and replay the full response if seen.
  // The full response is also cached at the END so any subsequent retry
  // returns the same payload without re-running any work.
  const _reqId = String(body && body.request_id || "").trim();
  const _reqCache = CacheService.getScriptCache();
  if (_reqId) {
    try {
      const _cached = _reqCache.get("submitOrder_req_" + _reqId);
      if (_cached) {
        console.log("submitOrder idempotency replay for request_id=" + _reqId);
        try { return JSON.parse(_cached); } catch(_) { /* corrupt — fall through and re-run */ }
      }
    } catch(_) { /* cache unavailable — fall through */ }
  }

  // Serialize submitOrder calls to prevent stock-race + wallet-race between concurrent customers
  const lock = LockService.getScriptLock();
  try { lock.waitLock(10000); }
  catch(e) { return { error: "Server busy — please retry in a few seconds." }; }
  try {
    // Re-check the idempotency cache AFTER acquiring the lock. The
    // original request may still have been running when we first looked.
    if (_reqId) {
      try {
        const _cached2 = _reqCache.get("submitOrder_req_" + _reqId);
        if (_cached2) {
          console.log("submitOrder idempotency replay (post-lock) for request_id=" + _reqId);
          try { return JSON.parse(_cached2); } catch(_) {}
        }
      } catch(_) {}
    }
    const _result = _submitOrderInternal(body);
    // Cache the FULL response so any retry within 10 minutes replays it
    // verbatim — including error responses (duplicate_detected, stock_conflicts).
    if (_reqId) {
      try { _reqCache.put("submitOrder_req_" + _reqId, JSON.stringify(_result), 600); } catch(_) {}
    }
    return _result;
  } finally {
    try { lock.releaseLock(); } catch(e) {}
  }
}

function _submitOrderInternal(body) {
  const ss = getSpreadsheet();
  const ordersWs = getOrCreateTab(ss, TAB_ORDERS, ORDERS_HEADERS);
  const profile   = body.profile || {};
  const orders    = body.orders  || [];   // [{date, meals:[{type,items,notes,subtotal,area}]}]

  const submittedAt  = getISTTimestamp();
  let   payMethod    = body.payment_method  || "UPI";
  let   payStatus    = body.payment_status  || "Pending";
  const firstTime    = profile.isFirstTime ? "Yes" : "No";
  const payFreq      = profile.payment_preference || "Daily Payment";

  // Build the header→index map once
  const hIdx = headerIndex(ordersWs);

  // Fetch free areas dynamically (replaces hardcoded FREE_AREA = "Bhosale Nagar")
  const freeAreaNames = getAreas().filter(function(a){ return a.free; }).map(function(a){ return a.name; });
  const DELIVERY  = 11;

  const submissionIds = [];

  // ── ONE-SHOT ROW FETCHES ────────────────────────────────────
  // Fetch once, share everywhere. Previously these tabs were re-read 5+ times
  // per submitOrder (day totals, loyalty, duplicate check, stock check, wallet).
  const allOrderRows  = getAllRows(ordersWs);
  const walletWsRef   = getOrCreateTab(ss, TAB_WALLET, WALLET_HEADERS);
  const allWalletRows = getAllRows(walletWsRef);
  // Menu rows read once here — reused by stock check below (avoids duplicate sheet fetch)
  const menuWsOnce  = getOrCreateTab(ss, TAB_MENU, []);
  const menuRowsAll = getAllRows(menuWsOnce);

  // Fetch existing orders once for all dates in this submission to calculate combined-day fees/discounts
  const submissionDates = orders.map(o => o.date);
  const existingDayTotals = getDayTotalsForDates(profile.phone, submissionDates.join(','), allOrderRows).dayTotals || {};

  // Fetch current promo state
  const custWs = getOrCreateTab(ss, TAB_CUSTOMERS, CUSTOMERS_HEADERS);
  const cIdx   = headerIndex(custWs);
  const cRows  = getAllRows(custWs);
  const phoneStr = _normalizePhone(profile.phone);
  const cRowIdx = cRows.findIndex(r => _normalizePhone(r.Phone) === phoneStr);
  let promoCount = null;
  if (cRowIdx !== -1) {
    const rawVal = cRows[cRowIdx].Review_Promo_Count;
    promoCount = (rawVal === "" || rawVal === undefined) ? null : rawVal;
    if (promoCount !== null && !isNaN(promoCount)) promoCount = Number(promoCount);

    // ── On Account override (server-enforced) ──────────────────
    // If the customer is flagged On_Account in SK_Customers, every order
    // is automatically set to method "On Account" / status "On Account"
    // regardless of what the frontend sends.
    if (String(cRows[cRowIdx].On_Account || "").trim() === "Yes") {
      payMethod = "On Account";
      payStatus = "On Account";
    }
  }

  // Pre-fetch masters once for ID -> Name resolution in sheet columns
  const masterMap = {};
  try {
    const masters = getAdminData();
    (masters.breakfastMaster || []).forEach(m => masterMap[String(m.id)] = m.name);
    (masters.sabjiMaster || []).forEach(m => masterMap[String(m.id)] = m.name);
  } catch(e) { console.error("Master fetch failed in submitOrder", e); }

  // Strip weight/measure suffixes like [175g], [200g], [100ml], (2 pieces) etc.
  // so backend always stores the clean item name regardless of what frontend shows.
  const stripDisplaySuffix = (name) => {
    return String(name)
      .replace(/\s*\[.*?\]\s*/g, '')   // removes [175g], [200ml], [2 pcs] etc.
      .replace(/\s*\(.*?\)\s*/g, '')   // removes (2 pieces), (100ml) etc.
      .trim();
  };

  const resolveName = (k) => {
    let name;
    if (ITEM_COL_MAP[k]) name = ITEM_COL_MAP[k].replace(/_/g, ' ');
    else if (masterMap[k]) name = masterMap[k];
    else name = k.replace(/_/g, ' ');
    return stripDisplaySuffix(name);
  };

  // Sort orders by date to ensure virtual streak runs chronologically
  orders.sort((a,b) => a.date.localeCompare(b.date));
  const initialStreakInfo = _calculateLoyaltyStreak(profile.phone, allOrderRows);
  let virtualStreakCount = initialStreakInfo.streak;
  let virtualPastSurcharge = initialStreakInfo.pastSurcharge;

  // ════ KITCHEN CLOSURE PRE-FLIGHT ════
  // Reject the entire submission if ANY ordered date has been marked
  // Kitchen Closed via the admin Daily Menu toggle. Customer calendar
  // already greys these days out — this is the defensive server guard.
  //
  // EXCEPTION — payment_method === "Gateway (HDFC)": by the time we get
  // here the customer has already paid on the HDFC-hosted page. Rejecting
  // would leave the money taken without an order in our sheet. Accept
  // the order and log a warning so admin can cancel + refund manually.
  if (payMethod !== "Gateway (HDFC)") {
    const closedHits = [];
    for (const _o of orders) {
      const _menuForDate = menuRowsAll.find(function(mr) {
        const d = mr.Date instanceof Date
          ? Utilities.formatDate(mr.Date, "Asia/Kolkata", "yyyy-MM-dd")
          : String(mr.Date).trim();
        return d === _o.date;
      });
      const _closed = !!(_menuForDate && (_menuForDate.Kitchen_Closed === true ||
        String(_menuForDate.Kitchen_Closed || "").toLowerCase() === "true"));
      if (_closed) closedHits.push(_o.date);
    }
    if (closedHits.length) {
      return {
        success: false,
        kitchen_closed: true,
        closed_dates: closedHits,
        error: "Kitchen is closed on " + closedHits.join(", ")
             + ". Please remove that date from your cart and try again."
      };
    }
  } else {
    // Gateway path — log if a closed date sneaks through, so admin can
    // catch it manually. Order still gets written.
    for (const _o of orders) {
      const _menuForDate = menuRowsAll.find(function(mr) {
        const d = mr.Date instanceof Date
          ? Utilities.formatDate(mr.Date, "Asia/Kolkata", "yyyy-MM-dd")
          : String(mr.Date).trim();
        return d === _o.date;
      });
      const _closed = !!(_menuForDate && (_menuForDate.Kitchen_Closed === true ||
        String(_menuForDate.Kitchen_Closed || "").toLowerCase() === "true"));
      if (_closed) {
        console.warn("⚠️ Gateway-paid order accepted for KITCHEN-CLOSED date "
          + _o.date + " (phone " + profile.phone + ", gateway_order_id "
          + (body.gateway_order_id || "?") + "). Admin must manually cancel + refund this order.");
      }
    }
  }

  // ════ STOCK LIMIT PRE-FLIGHT ════
  // Hard-block submission if any requested item exceeds remaining stock.
  // Runs under LockService so concurrent submissions see each other's counts.
  {
    const menuRowsStk = menuRowsAll;   // reuse the already-fetched menu rows
    const stockConflicts = [];
    for (const dateOrder of orders) {
      const dateStrStk = dateOrder.date;
      const menuRowStk = menuRowsStk.find(mr => {
        const d = mr.Date instanceof Date
          ? Utilities.formatDate(mr.Date, "Asia/Kolkata", "yyyy-MM-dd")
          : String(mr.Date).trim();
        return d === dateStrStk;
      });
      let stockLimitsStk = {};
      try { if (menuRowStk && menuRowStk.Stock_JSON) stockLimitsStk = JSON.parse(menuRowStk.Stock_JSON); } catch(e) {}
      if (!Object.keys(stockLimitsStk).length) continue;

      const countedStk = countOrderedUnits(allOrderRows, dateStrStk);
      for (const mealStk of (dateOrder.meals || [])) {
        const mealLimits = stockLimitsStk[mealStk.type] || {};
        let mealItems = mealStk.items || [];
        if (typeof mealItems === "string") {
          try { mealItems = JSON.parse(mealItems); } catch(e) { mealItems = []; }
        }
        if (!Array.isArray(mealItems)) mealItems = [];
        for (const it of mealItems) {
          const colKeyStk = it.colKey;
          const qtyStk = Number(it.qty) || 0;
          if (qtyStk <= 0) continue;
          const limitStk = mealLimits[colKeyStk];
          if (limitStk === undefined) continue;
          const usedStk = countedStk[mealStk.type][itemsJsonKey(colKeyStk)] || 0;
          if (usedStk + qtyStk > limitStk) {
            stockConflicts.push({
              date: dateStrStk,
              meal: mealStk.type,
              colKey: colKeyStk,
              available: Math.max(0, limitStk - usedStk)
            });
          }
        }
      }
    }
    if (stockConflicts.length) {
      const first = stockConflicts[0];
      const nm = first.colKey === "B_CURD" ? "Curd (Breakfast)" : first.colKey;
      return {
        error: `Only ${first.available} of "${nm}" left for ${first.meal} on ${first.date}. Please reduce your quantity.`,
        stock_conflicts: stockConflicts
      };
    }
  }

  const _dupNowMs = Date.now();
  const _FIVE_MIN_MS = 5 * 60 * 1000;
  const _normPhone = _normalizePhone(profile.phone);
  let loyaltyExcessCredit = 0; // accumulates surplus when 6th-day discount exceeds the bill
  let grandNetTotal = 0;       // sum of all per-meal Net_Totals — returned so the UPI QR matches what's recorded
  // Normalize an items object to a stable JSON signature (sorted keys)
  const _itemsSig = (obj) => JSON.stringify(
    Object.keys(obj).sort().reduce((a, k) => { a[k] = obj[k]; return a; }, {})
  );
  // Normalize a date value that may be a Date object or a string
  const _normDate = (d) => {
    if (!d) return "";
    if (d instanceof Date) return Utilities.formatDate(d, "Asia/Kolkata", "yyyy-MM-dd");
    return String(d).trim().substring(0, 10);
  };

  // ── Streak gap guard (mirrors the frontend fix) ──────────────────────────
  // The projected streak must NOT carry across a real ordering gap. Build the
  // set of ALL the customer's ordered days (past rows + this submission) so an
  // in-between day that actually has an order — or a Sunday / admin-closed day —
  // is NOT treated as a gap (and a real gap correctly resets the streak).
  let prevStreakDate = initialStreakInfo.end || null;
  const _closedSetSO = _kitchenClosedSet();
  const _orderedDaysSO = new Set();
  (allOrderRows || []).forEach(function(r) {
    if (_isOrderCancelled(r.Payment_Status)) return;
    const dd = _normDate(r.Order_Date);
    if (dd) _orderedDaysSO.add(dd);
  });
  (orders || []).forEach(function(o) { if (o && o.date) _orderedDaysSO.add(_normDate(o.date)); });
  const _soStreakConsecutive = function(d1, d2) {
    if (!d1 || !d2) return false;
    const a = new Date(d1 + "T12:00:00"), b = new Date(d2 + "T12:00:00");
    const diff = Math.round((b - a) / 86400000);
    if (diff <= 0) return false;
    if (diff === 1) return true;
    let cur = new Date(a); cur.setDate(cur.getDate() + 1);
    while (cur < b) {
      const iso = Utilities.formatDate(cur, "Asia/Kolkata", "yyyy-MM-dd");
      if (cur.getDay() !== 0 && !_closedSetSO[iso] && !_orderedDaysSO.has(iso)) return false; // real gap
      cur.setDate(cur.getDate() + 1);
    }
    return true;
  };

  for (const order of orders) {
    const orderDate = order.date;
    // Gap guard: a date not consecutive with the previous ordered day breaks the
    // streak — restart so the 6th-day reward can't fire across a real gap.
    if (prevStreakDate && !_soStreakConsecutive(prevStreakDate, _normDate(orderDate))) {
      virtualStreakCount = 0;
      virtualPastSurcharge = 0;
    }
    const is6thDay = (virtualStreakCount === 5); // Hits 6 on this day
    const existingDateInfo = (existingDayTotals[orderDate] || {});

    // Calculate meal count for this date to determine dynamic free delivery threshold
    const mealsThisSubmission = order.meals.filter(m => (Number(m.subtotal) || 0) > 0).map(m => m.type);
    const existingMeals = Object.keys(existingDateInfo).filter(mType => (Number(existingDateInfo[mType].subtotal) || 0) > 0);
    const allMealsOnDate = Array.from(new Set([...mealsThisSubmission, ...existingMeals]));
    const totalMealsCount = allMealsOnDate.length;
    const dynamicFreeThreshold = totalMealsCount <= 1 ? 100 : 150;

    // Calculate total food subtotal for this specific submission's date
    const submissionDayFoodTotal = order.meals.reduce((s, m) => s + (Number(m.subtotal) || 0), 0);
    // Combine with already placed orders for this date
    const prevDayFoodTotal = Object.values(existingDateInfo).reduce((s, m) => s + (Number(m.subtotal) || 0), 0);
    const combinedDayTotal = submissionDayFoodTotal + prevDayFoodTotal;

    // Calculate day-level discount once across all meals for this date (including previous ones)
    let discRate = 0;
    if (combinedDayTotal >= 450) discRate = 0.075;
    else if (combinedDayTotal >= 300) discRate = 0.05;
    
    const totalDayDiscAmt = Math.round(combinedDayTotal * discRate);
    // Find how much discount was already applied to previous orders for this date
    const prevDayDiscAmt = Object.values(existingDateInfo).reduce((s, m) => s + (Number(m.discount_applied) || 0), 0);
    // The discount to apply to this ENTIRE submission for this date = entitled - already_applied
    const submissionDateDiscAmt = Math.max(0, totalDayDiscAmt - prevDayDiscAmt);

    // Pro-rate the submission-level discount across meals in this submission
    const getDisc = (sub) => {
      if (is6thDay) {
        // Loyalty Discount: Waive all 6 days of surcharge
        const currentSurcharge = Math.ceil(submissionDayFoodTotal * 0.06);
        const totalWaiver = virtualPastSurcharge + currentSurcharge;
        return submissionDayFoodTotal > 0 ? Math.round(totalWaiver * (sub / submissionDayFoodTotal)) : 0;
      }
      return submissionDayFoodTotal > 0 ? Math.round(submissionDateDiscAmt * (sub / submissionDayFoodTotal)) : 0;
    };

    // Update virtual streak state for NEXT loop iteration
    const currentDaySurcharge = Math.ceil(submissionDayFoodTotal * 0.06);
    if (is6thDay) {
      virtualStreakCount = 0;
      virtualPastSurcharge = 0;
    } else {
      virtualStreakCount++;
      virtualPastSurcharge += currentDaySurcharge;
    }
    prevStreakDate = _normDate(orderDate); // this date is now an ordered day — track for the next gap check

    for (const meal of order.meals) {
      const sid = generateSubmissionID();
      submissionIds.push(sid);
      meal._sid = sid; // carry sid for ledger
      
      const mealType = meal.type;
      const sub = Number(meal.subtotal) || 0;
      const mealArea = meal.area || profile.area || "";
      
      let items  = meal.items || [];   // [{colKey, qty}]
      // Safety fix: If items is a stringified JSON, parse it (prevents character-distortion crash)
      if (typeof items === "string") {
        try { items = JSON.parse(items); } catch(e) { items = []; }
      }
      if (!Array.isArray(items)) items = [];

      const nKitchen = meal.notesKitchen || "";
      const nDelivery = meal.notesDelivery || "";
      
      // Get combined totals for THIS specific meal type (prev + current)
      const prevMealSub = (existingDateInfo[mealType] || {}).subtotal || 0;
      const combinedMealSub = sub + prevMealSub;
      
      // Delivery & Fee logic (matches frontend)
      const isPickup  = (mealArea.toLowerCase().includes("pickup"));
      const isDayFree = (combinedDayTotal >= dynamicFreeThreshold);
      const isFreeArea = freeAreaNames.includes(mealArea);

      // VIP Fee Exemption
      const isFeeExempt = (cRowIdx !== -1 && (cRows[cRowIdx].Fee_Exempt === "Yes" || cRows[cRowIdx].Fee_Exempt === true));

      let delCharge = 0;
      if (!isFeeExempt && !isDayFree && !isPickup && !isFreeArea && sub > 0) {
        delCharge = DELIVERY;
      }

      let smallOrderFee = 0;
      if (!isFeeExempt && !isDayFree && !isPickup && (mealType === "Lunch" || mealType === "Dinner") && sub > 0 && combinedMealSub < 50) {
        smallOrderFee = 10;
      }

      // Calculation of credits for previously paid fees on the same day (Retroactive waiver)
      let dateDeliveryCredit = 0;
      let dateSmallFeeCredit = 0;
      if (isDayFree) {
        Object.keys(existingDateInfo).forEach(mType => {
          dateDeliveryCredit += (Number(existingDateInfo[mType].delivery_charged) || 0);
          dateSmallFeeCredit += (Number(existingDateInfo[mType].small_fee_charged) || 0);
        });
      }
      const totalDateCredit = dateDeliveryCredit + dateSmallFeeCredit;
      const mealCredit = submissionDayFoodTotal > 0 ? Math.round(totalDateCredit * (sub / submissionDayFoodTotal)) : 0;

      const discAmt = getDisc(sub);
      // On the 6th day, the surcharge IS charged (consistency), and the loyalty discount
      // (totalWaiver) includes all 6 days of surcharge so it covers it. Net effect:
      // the 6th-day surcharge charge and refund cancel each other; customer gets back days 1–5.
      const inflationSurcharge = Math.ceil(sub * 0.06);

      // Google Review Promo Logic (10% OFF per meal)
      let reviewDiscount = 0;
      const isNumeric = (typeof promoCount === "number" && !isNaN(promoCount));
      if (isNumeric && promoCount > 0 && sub > 0) {
        reviewDiscount = Math.round(sub * 0.10);
        promoCount--;
      }

      let netTotal = Math.round(sub + delCharge + smallOrderFee + inflationSurcharge - discAmt - mealCredit - reviewDiscount);
      // If the 6th-day loyalty discount exceeds this meal's bill, clamp to ₹0 and
      // accumulate the surplus — it gets credited to the customer's wallet after all rows are written.
      if (is6thDay && netTotal < 0) {
        loyaltyExcessCredit += Math.abs(netTotal);
        netTotal = 0;
      }
      meal._reviewDiscount = reviewDiscount; // carry for set() below


      // Build items JSON
      // Breakfast Curd gets a distinct key ("Breakfast Curd") so kitchen prep
      // and admin reports can tell it apart from Lunch/Dinner Curd.
      const itemsObj = {};
      items.forEach(({colKey, qty}) => {
        let canonical;
        if (colKey === "B_CURD") canonical = "Breakfast Curd";
        else canonical = resolveName(colKey);
        itemsObj[canonical] = qty;
      });

      // Address fields handling (Sanitized for Pickup)
      const wing    = isPickup ? "" : (meal.wing    || profile.wing    || "");
      const flat    = isPickup ? "" : (meal.flat    || profile.flat    || "");
      const floor   = isPickup ? "" : (meal.floor   || profile.floor   || "");
      const society = isPickup ? "" : (meal.society || profile.society || "");
      const area    = isPickup ? "Self Pickup" : mealArea;

      const fullAddr = isPickup
                        ? "Self Pickup (A 104, Shree laxmi vihar society)"
                        : [wing && `Wing ${wing}`, flat && `Flat ${flat}`, floor && `${floor} Floor`, society, area].filter(Boolean).join(", ");
      const mapsLink = isPickup ? "" : (meal.maps || profile.maps || "");
      const landmark = isPickup ? "" : (meal.landmark || profile.landmark || "");

      // Build row array aligned to ORDERS_HEADERS
      const row = new Array(ORDERS_HEADERS.length).fill("");
      const set = (colName, val) => {
        const idx = hIdx[colName];
        if (idx) row[idx - 1] = val;
      };

      set("Submission_ID",       sid);
      set("Submitted_At",        submittedAt);
      set("Order_Date",          orderDate);
      set("Meal_Type",           mealType);
      set("Customer_Name",       profile.name     || "");
      set("Phone",               _normalizePhone(profile.phone));
      set("Area",                area);
      set("Wing",                wing);
      set("Flat",                flat);
      set("Floor",               floor);
      set("Society",             society);
      set("Full_Address",        fullAddr);
      set("Maps_Link",           mapsLink);
      set("Landmark",            landmark);
      set("Delivery_Point",      _getDeliveryPointLabel(meal.delivery_point || profile.delivery_point));
      if (!hIdx["Small_Order_Fee"]) {
        ordersWs.getRange(1, ordersWs.getLastColumn() + 1).setValue("Small_Order_Fee");
        hIdx["Small_Order_Fee"] = ordersWs.getLastColumn();
      }
      if (!hIdx["Inflation_Surcharge"]) {
        ordersWs.getRange(1, ordersWs.getLastColumn() + 1).setValue("Inflation_Surcharge");
        hIdx["Inflation_Surcharge"] = ordersWs.getLastColumn();
      }
      if (!hIdx["Loyalty_Discount"]) {
        ordersWs.getRange(1, ordersWs.getLastColumn() + 1).setValue("Loyalty_Discount");
        hIdx["Loyalty_Discount"] = ordersWs.getLastColumn();
      }
      set("Items_JSON",          JSON.stringify(itemsObj));
      set("Special_Notes_Kitchen",  nKitchen);
      set("Special_Notes_Delivery", nDelivery);
      set("Food_Subtotal",       sub);
      set("Small_Order_Fee",     smallOrderFee);
      set("Inflation_Surcharge", inflationSurcharge);
      set("Loyalty_Discount",    is6thDay ? "Yes" : "No");
      set("Delivery_Charge",     delCharge);
      set("Discount_Amount",     discAmt);
      if (hIdx["Review_Discount"]) {
        set("Review_Discount",   meal._reviewDiscount || 0);
      }
      set("Net_Total",           netTotal);
      grandNetTotal += netTotal;   // authoritative running total — drives the post-place QR

      // ════ DUPLICATE CHECK — must run BEFORE wallet deduction ════
      // Three layers of protection (any one catching is enough):
      //
      //   1. CacheService (fast, in-memory, atomic across script invocations).
      //      Bulletproof against sheet-read staleness — if A wrote here in the
      //      last 5 min, B's cache.get(key) will see it instantly even if
      //      A's appendRow hasn't propagated to a fresh getAllRows yet.
      //   2. Fresh sheet re-read (catches anything cache evicted under load).
      //   3. The original allOrderRows snapshot (legacy, kept for safety).
      //
      // After the row is written, we cache.put(key) so future calls hit layer 1.
      const _incomingSig = _itemsSig(itemsObj);
      const _dupKey      = `dup_${_normPhone}_${_normDate(orderDate)}_${mealType}_${_incomingSig}`;
      const _cache       = CacheService.getScriptCache();

      // Layer 1: cache lookup
      const _cachedSid = _cache.get(_dupKey);
      if (_cachedSid) {
        submissionIds[submissionIds.length - 1] = _cachedSid;
        console.log("Duplicate caught by cache: " + _dupKey + " → " + _cachedSid);
        continue;
      }

      // Layer 2 + 3: reuse the upfront snapshot instead of re-reading the whole
      // sheet per meal. allOrderRows was read AFTER acquiring the global lock, so
      // it already includes every committed row from any prior order; the lock
      // blocks concurrent writers; and this execution's own earlier-meal rows
      // can't be duplicates of the current meal (each cart date+meal is unique).
      // Same-request retries are caught by the CacheService layer above. This
      // removes N expensive full-sheet reads per order (the main latency source).
      const _freshRows  = allOrderRows;
      const _nowMsFresh = Date.now();
      const _dupRow = _freshRows.find(r => {
        if (_normalizePhone(r.Phone) !== _normPhone) return false;
        if (_normDate(r.Order_Date) !== _normDate(orderDate)) return false;
        if (r.Meal_Type !== mealType) return false;
        const rMs = r.Submitted_At ? new Date(r.Submitted_At).getTime() : 0;
        if (!rMs || (_nowMsFresh - rMs) > _FIVE_MIN_MS) return false;
        try {
          const stored = typeof r.Items_JSON === "string" ? JSON.parse(r.Items_JSON) : (r.Items_JSON || {});
          return _itemsSig(stored) === _incomingSig;
        } catch(e) { return false; }
      });
      if (_dupRow) {
        submissionIds[submissionIds.length - 1] = _dupRow.Submission_ID || sid;
        // Backfill cache so subsequent calls hit layer 1 (faster + more reliable)
        try { _cache.put(_dupKey, _dupRow.Submission_ID || sid, 300); } catch(e) {}
        console.log("Duplicate order skipped (sheet check): " + _normPhone + " / " + orderDate + " / " + mealType);
        continue;
      }

      // ════ LAYER 4 — LONG-WINDOW DUPLICATE GUARD ════════════════════════
      // The three layers above silently dedupe legitimate retries inside a
      // 5-min window (network retries / double-clicks). They cannot catch
      // the case where an order somehow gets re-submitted FAR LATER —
      // e.g. a stale standard-order/auto-place path firing 40 min after
      // the customer's original checkout.
      //
      // Policy: any non-cancelled order for the SAME customer + date +
      // meal + items signature, with NO time window, is treated as a
      // duplicate. The submission is REJECTED unless the request body
      // carries confirm_duplicate=true (set by the frontend after the
      // customer explicitly accepts the duplicate-warning prompt).
      //
      // Case 1 (auto-replay): no confirm flag -> rejected.
      // Case 2 (manual re-place): customer sees prompt, clicks confirm,
      //                            frontend retries with the flag -> accepted.
      if (body.confirm_duplicate !== true) {
        const _historicalDup = _freshRows.find(r => {
          if (_normalizePhone(r.Phone) !== _normPhone) return false;
          if (_normDate(r.Order_Date) !== _normDate(orderDate)) return false;
          if (r.Meal_Type !== mealType) return false;
          if (_isOrderCancelled(r.Payment_Status)) return false;
          try {
            const stored = typeof r.Items_JSON === "string" ? JSON.parse(r.Items_JSON) : (r.Items_JSON || {});
            return _itemsSig(stored) === _incomingSig;
          } catch(e) { return false; }
        });
        if (_historicalDup) {
          console.warn("Duplicate order REJECTED (no confirm flag) — phone=" + _normPhone
            + " date=" + orderDate + " meal=" + mealType
            + " existingSid=" + _historicalDup.Submission_ID
            + " submittedAt=" + _historicalDup.Submitted_At);
          return {
            success: false,
            duplicate_detected: true,
            error: "A " + mealType + " order with the same items for " + orderDate
                 + " already exists (Order ID: " + _historicalDup.Submission_ID
                 + "). If you intentionally want to place another one, please confirm.",
            existing_submission_id: _historicalDup.Submission_ID,
            existing_order_date:    _normDate(_historicalDup.Order_Date),
            existing_meal_type:     _historicalDup.Meal_Type,
            existing_payment_status: _historicalDup.Payment_Status || "Pending",
            existing_submitted_at:  _historicalDup.Submitted_At ? String(_historicalDup.Submitted_At) : "",
            attempted_order_date:   orderDate,
            attempted_meal_type:    mealType
          };
        }
      } else {
        console.log("Duplicate order ALLOWED (confirm_duplicate=true) — phone=" + _normPhone
          + " date=" + orderDate + " meal=" + mealType);
      }

      // Reserve the cache key BEFORE the wallet deduction + row write so any
      // concurrent retry that arrives during this meal's processing hits layer 1.
      try { _cache.put(_dupKey, sid, 300); } catch(e) {}

      let pStat = payStatus;
      let walletCreditUsed = 0;
      // ════ WALLET DEDUCTION LOGIC ════
      if (payMethod === "Wallet") {
        let currentBalance = _calculateWalletBalance(profile.phone, allWalletRows);

        if (currentBalance >= netTotal) {
          _appendWalletTransaction(profile.phone || "", profile.name || "Customer", "Order Deduction", netTotal, true, sid);
          // Reflect the new debit in our in-memory wallet cache so subsequent
          // meals in the same submission see the updated balance.
          allWalletRows.push({ Phone: _normalizePhone(profile.phone), Txn_Type: "Order Deduction", Amount: netTotal, Verified: "TRUE" });
          pStat = "Wallet Paid";
          walletCreditUsed = netTotal;
        } else {
          pStat = "Pending"; // Wallet failed, fallback to pending
        }
      } else if (payMethod === "Split") {
        // Split: deduct wallet portion now, UPI portion remains pending
        const requestedCredit = Math.min(Number(body.wallet_credit) || 0, netTotal);
        if (requestedCredit > 0) {
          const currentBalance = _calculateWalletBalance(profile.phone, allWalletRows);
          if (currentBalance >= requestedCredit) {
            _appendWalletTransaction(profile.phone || "", profile.name || "Customer", "Order Deduction (Wallet Part)", requestedCredit, true, sid);
            allWalletRows.push({ Phone: _normalizePhone(profile.phone), Txn_Type: "Order Deduction", Amount: requestedCredit, Verified: "TRUE" });
            walletCreditUsed = requestedCredit;
            pStat = "Pending"; // UPI portion still outstanding
          } else {
            // Not enough wallet — fall back to full UPI
            payMethod = "UPI";
            pStat = "Pending";
          }
        }
      } else if (payMethod === "On Account") {
        pStat = "On Account";
      }

      // Self-heal Wallet_Credit column if it doesn't exist yet (no initSchema needed)
      if (walletCreditUsed > 0 && !hIdx["Wallet_Credit"]) {
        const newCol = ordersWs.getLastColumn() + 1;
        ordersWs.getRange(1, newCol).setValue("Wallet_Credit");
        SpreadsheetApp.flush();
        // Refresh hIdx so set() can find it
        Object.assign(hIdx, headerIndex(ordersWs));
      }

      set("Payment_Method",      payMethod);
      set("Payment_Status",      pStat);
      if (walletCreditUsed > 0) set("Wallet_Credit", walletCreditUsed);
      set("Payment_Freq",        payFreq);
      set("First_Time",          firstTime);
      set("Source",              "WebApp");

      // Fill individual item columns
      if (mealType === "Breakfast") {
        // Breakfast: dynamic items go to BF_Item_N/BF_Qty_N
        let bfSlot = 1;
        items.forEach(({colKey, qty}) => {
          if (bfSlot > 4) return;
          const displayName = (colKey === "B_CURD") ? "Curd" : resolveName(colKey);
          set(`BF_Item_${bfSlot}`, displayName);
          set(`BF_Qty_${bfSlot}`,  qty);
          bfSlot++;
        });
        // Curd goes to Curd column too
        const curdItem = items.find(x => x.colKey === "B_CURD");
        if (curdItem) set("Curd", curdItem.qty);
      } else {
        // Lunch/Dinner: map colKeys to named columns
        items.forEach(({colKey, qty}) => {
          const canonical = ITEM_COL_MAP[colKey] || colKey;
          // If canonical is still an ID, try masterMap
          const finalCol = (masterMap[canonical]) ? masterMap[canonical] : canonical;
          set(finalCol, qty);
        });
      }

      ordersWs.appendRow(row);
      _missedOrderSafetyNet(ss, sid, row, profile.phone);  // safety net — verify write succeeded
    }
  }

  // Force all buffered Sheets writes to disk before returning success
  SpreadsheetApp.flush();

  // Verify every row we just wrote actually landed; auto-recover + email if not
  _verifyAndAlertMissedOrders(ss, submissionIds);

  // Upsert customer record
  _upsertCustomer(ss, profile);

  // If user requested to settle ALL pending dues in this same transaction
  if (body.settle_all && payMethod === "Wallet") {
    _settlePendingInternal(ss, profile.phone, profile.name || "Customer");
  }

  if (payFreq === "Prepaid Wallet" || payFreq.includes("10 days") || payFreq.includes("Wallet")) {
    try { _updateLedger(ss, profile, orders); } catch(e) { /* non-fatal */ }
  }

  // Sync final promoCount back to customer sheet
  if (cRowIdx !== -1 && cIdx["Review_Promo_Count"]) {
    // Pro transition: 0 -> "Exhausted"
    let finalValue = promoCount;
    if (finalValue === 0) finalValue = "Exhausted";
    else if (finalValue === null) finalValue = "";
    
    const realRow = cRowIdx + 2;
    custWs.getRange(realRow, cIdx["Review_Promo_Count"]).setValue(finalValue);
  }

  // If 6th-day loyalty discount exceeded the bill, credit the excess to wallet (server-computed)
  if (loyaltyExcessCredit > 0) {
    try {
      _appendWalletTransaction(
        profile.phone || "", profile.name || "Customer",
        "Loyalty Streak Reward (Excess Credit)",
        loyaltyExcessCredit, true, submissionIds[0] || ""
      );
    } catch(e) { /* non-fatal */ }
  }

  // Invalidate menu cache for all ordered dates so units_remaining is fresh on next getMenu call.
  // (Cache had 60s TTL — without this, customers would see stale stock counts after placing an order.)
  if (submissionDates.length) {
    _invalidateCache(...submissionDates.map(d => "menu_v2_" + d));
  }

  return {success: true, submissionId: submissionIds[0] || "", wallet_bonus: loyaltyExcessCredit, grand_total: grandNetTotal};
}


// ── UPSERT CUSTOMER ──────────────────────────────────────────
function _upsertCustomer(ss, profile) {
  // Ensure tab exists and headers are correct before doing anything
  const ws = getOrCreateTab(ss, TAB_CUSTOMERS, CUSTOMERS_HEADERS);
  SpreadsheetApp.flush(); // Lock in the headers before indexing

  const rows = getAllRows(ws);
  const pStr = _normalizePhone(profile.phone);
  const existing = rows.find(r => _normalizePhone(r.Phone) === pStr);
  
  const fullAddr = [
    profile.wing    && `Wing ${profile.wing}`,
    profile.flat    && `Flat ${profile.flat}`,
    profile.floor   && `${profile.floor} Floor`,
    profile.society, profile.area
  ].filter(Boolean).join(", ");

  if (existing) {
    const rowNum = existing._row;
    const hIdx = headerIndex(ws);
    const update = (col, val) => {
      // ONLY update if val is effectively provided (not undefined)
      if (hIdx[col] && val !== undefined) {
        ws.getRange(rowNum, hIdx[col]).setValue(val);
      }
    };
    if (profile.name !== undefined) update("Customer_Name", profile.name);
    if (profile.area !== undefined) update("Area",          profile.area);
    if (profile.wing !== undefined) update("Wing",          profile.wing);
    if (profile.flat !== undefined) update("Flat",          profile.flat);
    if (profile.floor !== undefined) update("Floor",         profile.floor);
    if (profile.society !== undefined) update("Society",       profile.society);
    if (profile.area !== undefined || profile.society !== undefined) update("Full_Address",  fullAddr);
    
    // Auto-derive Maps Link if missing
    let finalMaps = profile.maps || "";
    if (!finalMaps) {
      finalMaps = _deriveMapsLink(fullAddr, profile.society || "");
    }
    update("Maps_Link", finalMaps);

    if (profile.landmark !== undefined) update("Landmark",      profile.landmark || "");
    if (profile.delivery_point !== undefined) update("Delivery_Point", _getDeliveryPointLabel(profile.delivery_point));
    if (profile.payment_preference !== undefined) update("Payment_Freq",  profile.payment_preference);
    if (profile.pin) update("PIN", profile.pin);
    if (profile.meal_addresses) update("Meal_Addresses", profile.meal_addresses);
    if (profile.standardOrder !== undefined) update("Standard_Order", profile.standardOrder);
    if (profile.onAccount !== undefined) update("On_Account", profile.onAccount);
    if (profile.billingCycle !== undefined) update("Billing_Cycle", profile.billingCycle);
    
    SpreadsheetApp.flush(); // Ensure writes are committed
  } else {
    // For new records, construct a clean Row Array mapping directly to our schema
    const newRow = CUSTOMERS_HEADERS.map(h => {
      let val = "";
      switch(h) {
        case "Phone":           val = _normalizePhone(profile.phone); break;
        case "Customer_Name":   val = profile.name || ""; break;
        case "Area":            val = profile.area || ""; break;
        case "Wing":            val = profile.wing || ""; break;
        case "Flat":            val = profile.flat || ""; break;
        case "Floor":           val = profile.floor || ""; break;
        case "Society":         val = profile.society || ""; break;
        case "Full_Address":    val = fullAddr; break;
        case "Maps_Link":       val = profile.maps || _deriveMapsLink(fullAddr, profile.society || ""); break;
        case "Landmark":        val = profile.landmark || ""; break;
        case "Delivery_Point":  val = _getDeliveryPointLabel(profile.delivery_point); break;
        case "Payment_Freq":    val = profile.payment_preference || "Daily Payment"; break;
        case "Created_At":      val = getISTTimestamp(); break;
        case "PIN":             val = profile.pin || ""; break;
        case "Meal_Addresses":  val = profile.meal_addresses || ""; break;
        case "Standard_Order":  val = profile.standardOrder || ""; break;
        case "Billing_Cycle":   val = profile.billingCycle || "Daily"; break;
        case "On_Account":      val = profile.onAccount || "No"; break;
        case "Review_Promo_Count": val = ""; break;
        default:                val = "";
      }
      // Force leading zeros to be preserved for Phone and PIN by prepending '
      if (h === "Phone" || h === "PIN") return "'" + String(val).trim();
      return val;
    });
    
    // Safety check: Ensure we NEVER write to Row 1 (header row)
    const nextRow = Math.max(2, ws.getLastRow() + 1);
    ws.getRange(nextRow, 1, 1, newRow.length).setValues([newRow]);
  }
}

/**
 * ADMIN: Toggle On Account status for a customer
 */
function markOnAccount(phone, cycle, status) {
  const ss = getSpreadsheet();
  const phoneStr = _normalizePhone(phone);
  const profile = {
    phone: phoneStr,
    onAccount: status,
    billingCycle: cycle
  };
  _upsertCustomer(ss, profile);
  return { success: true, phone: phoneStr, status: status, cycle: cycle };
}

// ── GET CUSTOMER ORDERS ──────────────────────────────────────
// ── GET DAY TOTALS FOR DATES (used to compute combined-day fees) ─
// Returns existing meal subtotals per date for the given phone,
// excluding the current cart being built (which is not yet placed).
function getDayTotalsForDates(phone, datesParam, preloadedRows) {
  if (!phone || !datesParam) return { dayTotals: {} };
  const dates = String(datesParam).split(',').map(d => d.trim()).filter(Boolean);
  const ss = getSpreadsheet();
  const ws = getOrCreateTab(ss, TAB_ORDERS, ORDERS_HEADERS);
  // Allow caller to pass pre-fetched rows (submitOrder) so we don't re-hit the sheet.
  const rows = Array.isArray(preloadedRows) ? preloadedRows : getAllRows(ws);

  const result = {};
  dates.forEach(d => { result[d] = {}; });

  // Canonicalize target phone so +91/space/decimal/scientific variants all match.
  const targetPhone = _normalizePhone(phone);

  rows.filter(r => {
    // Always group by Order_Date column (never submission timestamp) — this is what
    // keeps bills for a single meal-day intact even if the customer hits "place order"
    // on either side of IST midnight.
    if (_normalizePhone(r.Phone) !== targetPhone) return false;
    if (_isOrderCancelled(r.Payment_Status)) return false;
    const rDate = r.Order_Date instanceof Date
      ? Utilities.formatDate(r.Order_Date, 'Asia/Kolkata', 'yyyy-MM-dd')
      : String(r.Order_Date).trim();
    return dates.includes(rDate);
  }).forEach(r => {
    const rDate = r.Order_Date instanceof Date
      ? Utilities.formatDate(r.Order_Date, 'Asia/Kolkata', 'yyyy-MM-dd')
      : String(r.Order_Date).trim();
    const meal = String(r.Meal_Type).trim();
    if (!result[rDate][meal]) result[rDate][meal] = { subtotal: 0, delivery_charged: 0, discount_applied: 0, small_fee_charged: 0, count: 0 };
    result[rDate][meal].subtotal       += Number(r.Food_Subtotal    || 0);
    result[rDate][meal].delivery_charged += Number(r.Delivery_Charge || 0);
    result[rDate][meal].discount_applied += Number(r.Discount_Amount || 0);
    result[rDate][meal].small_fee_charged += Number(r.Small_Order_Fee || 0);
    result[rDate][meal].count++;
  });

  return { dayTotals: result };
}

/**
 * Calculates current streak and accumulated surcharges for a customer.
 * Skips Sundays (kitchen closed).
 */
/**
 * Diagnostic — run from the Apps Script editor to see exactly what the
 * loyalty-streak calculator is seeing for a specific customer.
 *
 * Usage:
 *   In Code.gs editor, add at the bottom:
 *     function _runDiag() { diagnoseLoyaltyStreak("9930748908"); }
 *   Pick _runDiag from the function dropdown -> Run.
 *   Watch the Execution Log.
 *
 * Prints for each of the customer's recent past rows:
 *   date, meal, Food_Subtotal, Inflation_Surcharge stored, derived
 *   surcharge from food, Loyalty_Discount Y/N, Payment_Status.
 * Then summarises what _calculateLoyaltyStreak returns.
 */
function diagnoseLoyaltyStreak(phone) {
  if (!phone) { Logger.log("Pass a phone number"); return; }
  const ss = getSpreadsheet();
  const ws = getOrCreateTab(ss, TAB_ORDERS, ORDERS_HEADERS);
  const rows = getAllRows(ws);
  const phoneStr = _normalizePhone(phone);
  const todayISO = Utilities.formatDate(new Date(), "Asia/Kolkata", "yyyy-MM-dd");

  Logger.log("=== diagnoseLoyaltyStreak(" + phone + ") ===");
  Logger.log("Today (IST): " + todayISO);

  const mine = rows.filter(r => _normalizePhone(r.Phone) === phoneStr);
  Logger.log("Total rows for this customer: " + mine.length);

  // Sort by date descending so most recent appears first
  mine.sort((a, b) => {
    const da = a.Order_Date instanceof Date ? Utilities.formatDate(a.Order_Date,"Asia/Kolkata","yyyy-MM-dd") : String(a.Order_Date).trim();
    const db = b.Order_Date instanceof Date ? Utilities.formatDate(b.Order_Date,"Asia/Kolkata","yyyy-MM-dd") : String(b.Order_Date).trim();
    return db.localeCompare(da);
  });

  Logger.log("--- Last 15 rows (newest first) ---");
  mine.slice(0, 15).forEach((r, idx) => {
    const d = r.Order_Date instanceof Date ? Utilities.formatDate(r.Order_Date,"Asia/Kolkata","yyyy-MM-dd") : String(r.Order_Date).trim();
    const stored  = Number(r.Inflation_Surcharge);
    const derived = Math.ceil((Number(r.Food_Subtotal) || 0) * 0.06);
    Logger.log("[" + (idx+1) + "] " + d + " " + r.Meal_Type
      + "  food=" + r.Food_Subtotal
      + "  storedSurch=" + (isNaN(stored) ? "(empty)" : stored)
      + "  derivedSurch=" + derived
      + "  effective=" + Math.max((Number(r.Inflation_Surcharge)||0), derived)
      + "  Loyalty=" + (r.Loyalty_Discount || "-")
      + "  net=" + r.Net_Total
      + "  status=" + (r.Payment_Status || "-")
      + "  sid=" + (r.Submission_ID || "-")
    );
  });

  // Run the actual calculator and log its verdict
  const result = _calculateLoyaltyStreak(phone, rows);
  Logger.log("--- _calculateLoyaltyStreak verdict ---");
  Logger.log(JSON.stringify(result));
  Logger.log("Expected next-order behaviour: is6thDay would be " + (result.streak === 5 ? "TRUE" : "FALSE"));
  Logger.log("If is6thDay TRUE: loyalty waiver = pastSurcharge(" + result.pastSurcharge + ") + today's surcharge");
  Logger.log("=== end ===");
}

// Returns a map { "yyyy-MM-dd": true } of all admin-marked kitchen-closed
// dates (Kitchen_Closed flag in SK_Daily_Menu). Used by the loyalty streak so
// a day the OWNER closed never counts as the customer breaking their streak.
function _kitchenClosedSet() {
  const data = _cachedData("kitchen_closed_set_v1", 60, function() {
    const ss = getSpreadsheet();
    const ws = getOrCreateTab(ss, TAB_MENU, []);
    const out = [];
    getAllRows(ws).forEach(function(r) {
      const isClosed = (r.Kitchen_Closed === true || String(r.Kitchen_Closed || "").toLowerCase() === "true");
      if (!isClosed) return;
      const d = r.Date instanceof Date ? Utilities.formatDate(r.Date, "Asia/Kolkata", "yyyy-MM-dd") : String(r.Date).trim();
      if (d) out.push(d);
    });
    return { dates: out };
  });
  const set = {};
  (data.dates || []).forEach(function(d) { set[d] = true; });
  return set;
}

function _calculateLoyaltyStreak(phone, preloadedRows) {
  if (!phone) return { streak: 0, pastSurcharge: 0 };
  const ss = getSpreadsheet();
  const ws = getOrCreateTab(ss, TAB_ORDERS, ORDERS_HEADERS);
  const rows = Array.isArray(preloadedRows) ? preloadedRows : getAllRows(ws);
  const phoneStr = _normalizePhone(phone);
  const todayISO = Utilities.formatDate(new Date(), "Asia/Kolkata", "yyyy-MM-dd");

  const dailyTotals  = {}; // date → total surcharge that day
  const rewardDays   = new Set(); // dates where Loyalty_Discount = "Yes"

  rows.forEach(r => {
    if (_normalizePhone(r.Phone) !== phoneStr) return;
    // Cancelled rows (soft or hard) must NOT contribute to streak count —
    // otherwise a user could cancel days 3/4 and still hit day-6 reward.
    if (_isOrderCancelled(r.Payment_Status)) return;
    const stat = String(r.Payment_Status || "").toLowerCase();
    if (stat.includes("deleted")) return;

    const d = r.Order_Date instanceof Date ? Utilities.formatDate(r.Order_Date, "Asia/Kolkata", "yyyy-MM-dd") : String(r.Order_Date).trim();

    // For today's rows: only check if the loyalty reward was already given this morning
    // (so a separate lunch submission doesn't double-apply the day-6 discount)
    if (d === todayISO) {
      if (String(r.Loyalty_Discount || "").trim().toLowerCase() === "yes") {
        rewardDays.add(d); // today's breakfast already got the reward → block second meal
      }
      return; // Don't count today in the backward streak totals
    }
    if (d > todayISO) return; // future dates — ignore

    if (!dailyTotals[d]) dailyTotals[d] = 0;
    // Hardened surcharge derivation: take the MAX of the stored
    // Inflation_Surcharge column and the food-derived value. Protects
    // against legacy rows / manual admin entries where the
    // Inflation_Surcharge column was empty (= 0) but Food_Subtotal
    // shows a real cart — without this, even one such bad row in the
    // 5-day streak history collapses pastSurcharge to 0 and the
    // customer ends up paying full price on their day-6 reward.
    const storedSurch  = Number(r.Inflation_Surcharge) || 0;
    const derivedSurch = Math.ceil((Number(r.Food_Subtotal) || 0) * 0.06);
    dailyTotals[d] += Math.max(storedSurch, derivedSurch);

    // Track days where the 6-day loyalty reward was already given
    if (String(r.Loyalty_Discount || "").trim().toLowerCase() === "yes") {
      rewardDays.add(d);
    }
  });

  let streakCount = 0;
  let accumulatedSurcharge = 0;
  let streakEndDate = null; // most-recent counted day = the streak's end (used for gap checks at submit time)

  const closedSet = _kitchenClosedSet(); // admin days-off — skipped like Sundays, never break the streak
  let d = new Date(); d.setDate(d.getDate() - 1); // start from yesterday
  let safety = 0;
  while (safety < 40) {
    safety++;
    const iso = Utilities.formatDate(d, "Asia/Kolkata", "yyyy-MM-dd");
    if (d.getDay() === 0 || closedSet[iso]) { // Skip Sunday OR admin-closed day — don't break streak
      d.setDate(d.getDate() - 1);
      continue;
    }
    if (dailyTotals[iso] !== undefined) {
      if (rewardDays.has(iso)) {
        // This day was a 6th-day reward day — it marks the END of the previous cycle.
        // Don't count it; the new cycle starts from the day after it.
        break;
      }
      streakCount++;
      if (!streakEndDate) streakEndDate = iso; // walking backward → first counted day is the most recent
      accumulatedSurcharge += dailyTotals[iso];
    } else {
      break; // gap in ordering — streak broken
    }
    d.setDate(d.getDate() - 1);
  }

  // If today itself already received the loyalty reward (e.g. breakfast was submitted
  // first and marked Loyalty_Discount=Yes), treat it as a cycle already reset —
  // return streak=0 so any subsequent meal on the same day doesn't get a double reward.
  if (rewardDays.has(todayISO)) {
    return { streak: 0, pastSurcharge: 0, end: null };
  }

  // Anomaly logging — if the customer hit a full 5-day streak but the
  // accumulated surcharge came out unreasonably small (< streakCount,
  // meaning at least one past day contributed 0), log a warning so we
  // can audit the affected rows. The Math.max guard above protects the
  // common cases; this log surfaces any cases it can't fix.
  if (streakCount >= 5 && accumulatedSurcharge < streakCount) {
    console.warn("loyalty-streak anomaly — phone=" + phoneStr
      + " streak=" + streakCount
      + " accumulatedSurcharge=" + accumulatedSurcharge
      + " (suspiciously low — at least one past day contributed 0)."
      + " dailyTotals=" + JSON.stringify(dailyTotals));
  }

  return { streak: streakCount, pastSurcharge: accumulatedSurcharge, end: streakEndDate };
}

// ── VERIFY ORDER PLACED (timeout recovery) ───────────────────
// Called by the frontend after a network timeout to check if the order
// actually landed on the backend. Matches by phone + every date/meal combo
// in the cart, within a 10-minute recency window.
// Returns { found: true, submissionId } or { found: false }.
function verifyOrderPlaced(body) {
  const phone = _normalizePhone(String(body.phone || ""));
  if (!phone) return { found: false };

  // cart = [{date: "yyyy-MM-dd", meal: "Breakfast"|"Lunch"|"Dinner"}]
  // Derived from body.orders (same format as submitOrder)
  const orders = body.orders || [];
  const cartEntries = []; // [{date, meal}]
  for (const dateOrder of orders) {
    for (const meal of (dateOrder.meals || [])) {
      if ((Number(meal.subtotal) || 0) > 0) {
        cartEntries.push({ date: dateOrder.date, meal: meal.type });
      }
    }
  }
  if (!cartEntries.length) return { found: false };

  const ss  = getSpreadsheet();
  const ws  = getOrCreateTab(ss, TAB_ORDERS, []);
  const rows = getAllRows(ws);

  const nowMs     = Date.now();
  const TEN_MIN   = 10 * 60 * 1000;
  const normDate  = (d) => {
    if (!d) return "";
    if (d instanceof Date) return Utilities.formatDate(d, "Asia/Kolkata", "yyyy-MM-dd");
    return String(d).trim().substring(0, 10);
  };

  // Recent rows for this phone (last 10 min)
  const recent = rows.filter(r => {
    if (_normalizePhone(String(r.Phone || "")) !== phone) return false;
    const rMs = r.Submitted_At ? new Date(r.Submitted_At).getTime() : 0;
    return rMs > 0 && (nowMs - rMs) <= TEN_MIN;
  });

  if (!recent.length) return { found: false };

  // Every cart entry must have a matching recent row
  let firstId = null;
  for (const entry of cartEntries) {
    const match = recent.find(r =>
      normDate(r.Order_Date) === entry.date && r.Meal_Type === entry.meal
    );
    if (!match) return { found: false };
    if (!firstId) firstId = String(match.Submission_ID || "");
  }

  return firstId ? { found: true, submissionId: firstId } : { found: false };
}

function getCustomerOrders(phone) {
  if (!phone) return {orders:[], past_orders:[], wallet_balance: 0};
  const ss = getSpreadsheet();
  const ws = getOrCreateTab(ss, TAB_ORDERS, ORDERS_HEADERS);
  const rows = getAllRows(ws);
  const today = Utilities.formatDate(new Date(), "Asia/Kolkata", "yyyy-MM-dd");

  const fmtD = function(r) {
    return r.Order_Date instanceof Date
      ? Utilities.formatDate(r.Order_Date, "Asia/Kolkata", "yyyy-MM-dd")
      : String(r.Order_Date).trim();
  };

  const delWs = ss.getSheetByName("SK_Deliveries");
  const deliveryMap = {};
  if (delWs) {
    const delRows = getAllRows(delWs);
    delRows.forEach(d => {
      const sid = String(d.Submission_ID || "");
      if (sid) deliveryMap[sid] = {
        deliveredAt: d.Delivered_At || null,
        enRouteAt: d.EnRoute_At || null
      };
    });
  }

  const allFiltered = rows.filter(r => String(r.Phone).trim() === String(phone).trim());
  
  const upcoming = allFiltered
    .filter(r => fmtD(r) >= today)
    .sort((a,b) => fmtD(a).localeCompare(fmtD(b)))
    .map(r => {
      const delTracker = deliveryMap[String(r.Submission_ID)] || {};
      let itemsRaw = {};
      try { itemsRaw = JSON.parse(r.Items_JSON || "{}"); } catch(e) {}
      return {
        rowId:              r.Submission_ID,
        date:               fmtD(r),
        meal:               r.Meal_Type,
        summary:            _buildSummary(r),
        items_raw:          itemsRaw,
        total:              r.Net_Total,
        inflation_surcharge: Number(r.Inflation_Surcharge) || 0,
        loyalty_discount:   String(r.Loyalty_Discount || "").trim().toLowerCase() === "yes",
        payment_status:     r.Payment_Status,
        payment_method:     r.Payment_Method,
        wallet_credit:      Number(r.Wallet_Credit) || 0,
        deliveredAt:        delTracker.deliveredAt,
        enRouteAt:          delTracker.enRouteAt
      };
    });

  const past = allFiltered
    .filter(r => fmtD(r) < today)
    .sort((a,b) => fmtD(b).localeCompare(fmtD(a))) // newest first
    .slice(0, 10)
    .map(r => {
      const delTracker = deliveryMap[String(r.Submission_ID)] || {};
      // items_raw: structured {itemName: qty} for "Order Again" feature on frontend
      let itemsRaw = {};
      try { itemsRaw = JSON.parse(r.Items_JSON || "{}"); } catch(e) {}
      return {
        rowId:              r.Submission_ID,
        date:               fmtD(r),
        meal:               r.Meal_Type,
        summary:            _buildSummary(r),
        items_raw:          itemsRaw,
        total:              r.Net_Total,
        inflation_surcharge: Number(r.Inflation_Surcharge) || 0,
        loyalty_discount:   String(r.Loyalty_Discount || "").trim().toLowerCase() === "yes",
        payment_status:     r.Payment_Status,
        payment_method:     r.Payment_Method,
        wallet_credit:      Number(r.Wallet_Credit) || 0,
        deliveredAt:        delTracker.deliveredAt,
        enRouteAt:          delTracker.enRouteAt
      };
    });

  const onAccountBalance = allFiltered
    .filter(r => String(r.Payment_Status || "").toLowerCase() === "on account")
    .reduce((sum, r) => sum + (Number(r.Net_Total) || 0), 0);

  // ── Monthly spending summary ──────────────────────────────────
  // Compute current calendar month's total spend + order count.
  // Used by order.html to show "You spent ₹X in April across N orders".
  const nowIST = Utilities.formatDate(new Date(), "Asia/Kolkata", "yyyy-MM");
  let monthTotal = 0, monthCount = 0;
  allFiltered.forEach(r => {
    const d = fmtD(r);
    // Exclude cancelled orders from monthly spend summary
    if (d.startsWith(nowIST) && !_isOrderCancelled(r.Payment_Status)) {
      monthTotal += Number(r.Net_Total) || 0;
      monthCount++;
    }
  });
  const monthName = Utilities.formatDate(new Date(), "Asia/Kolkata", "MMMM");

  return {
    orders: upcoming,
    past_orders: past,
    wallet_balance: _calculateWalletBalance(phone),
    on_account_balance: onAccountBalance,
    // Today's effective (override-aware) cutoff hours so Manage Orders can
    // disable the Cancel button once a meal's cutoff has passed.
    today_cutoffs: _effectiveCutoffsForDate(today),
    month_summary: {
      month: monthName,
      total: monthTotal,
      count: monthCount
    }
  };
}

// Effective cancel/order cutoff HOURS (IST, since midnight) for a date —
// the admin's per-date override from SK_Daily_Menu if set, else the defaults.
function _effectiveCutoffsForDate(date) {
  var cutoffs = { Breakfast: 7, Lunch: 9, Dinner: 16.5 };
  try {
    var ss = getSpreadsheet();
    var ws = getOrCreateTab(ss, TAB_MENU, []);
    var rows = getAllRows(ws);
    for (var i = 0; i < rows.length; i++) {
      var d = rows[i].Date instanceof Date
        ? Utilities.formatDate(rows[i].Date, "Asia/Kolkata", "yyyy-MM-dd")
        : String(rows[i].Date).trim();
      if (d === date) {
        if (rows[i].Cutoff_Breakfast) cutoffs.Breakfast = Number(rows[i].Cutoff_Breakfast);
        if (rows[i].Cutoff_Lunch)     cutoffs.Lunch     = Number(rows[i].Cutoff_Lunch);
        if (rows[i].Cutoff_Dinner)    cutoffs.Dinner    = Number(rows[i].Cutoff_Dinner);
        break;
      }
    }
  } catch (e) {}
  return cutoffs;
}

function _buildSummary(r) {
  try {
    const obj = JSON.parse(r.Items_JSON || "{}");
    return Object.entries(obj)
      .filter(([,q]) => q > 0)
      .map(([n,q]) => `${q}×${n}`)
      .join(", ") || "—";
  } catch(e) { return "—"; }
}

// ── DELETE ORDER (with Refund Logic) ─────────────────────────
function deleteOrder(phone, rowId, refundType, opts) {
  // ─── CONCURRENCY GUARD ─────────────────────────────────────────────
  // Prevents parallel deletes (double-clicks, retries) from both finding
  // the same row, both appending refunds, and both calling deleteRow on
  // shifted indices. Without this, the second call deleted the wrong row.
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(15000);
  } catch (e) {
    return { success: false, error: "System busy. Please try again in a moment." };
  }
  try {
    return _deleteOrderInternal(phone, rowId, refundType, opts);
  } catch (e) {
    // Top-level safety net so transient Drive/Sheets errors don't surface
    // as raw "Service error: Drive" to the user. Logged for diagnosis.
    console.error(`deleteOrder failed for rowId=${rowId} phone=${phone}: ${e && e.message}\n${e && e.stack}`);
    return {
      success: false,
      error: "Could not cancel right now (a Google service blip). Please try again in a few seconds."
    };
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

function _deleteOrderInternal(phone, rowId, refundType, opts) {
  opts = opts || {};
  const isAdminCall = !!opts.isAdmin;
  const ss = getSpreadsheet();
  const ws = getOrCreateTab(ss, TAB_ORDERS, ORDERS_HEADERS);
  const rows = getAllRows(ws);
  const now = getISTDate();
  let msg = "Order deleted successfully";
  const today = Utilities.formatDate(now, "Asia/Kolkata", "yyyy-MM-dd");
  const hourIST = now.getHours() + now.getMinutes() / 60;
  const CUTOFFS = { Breakfast: 7, Lunch: 9, Dinner: 16.5 };

  // ── Ownership guard ──────────────────────────────────────────
  // Customers: must pass BOTH the exact Submission_ID and the matching phone.
  // Admin: can delete by Submission_ID alone (phone not required).
  // Submission_ID is compared as a full exact string (case-insensitive) to
  // prevent the old "digits-only" collision bug where SK-20250101-XYZ and
  // SK-20250101-ABC both reduced to "20250101".
  const targetId = String(rowId || "").trim().toUpperCase();
  if (!targetId) {
    return { success: false, error: "Missing order identifier." };
  }
  const normTargetPhone = _normalizePhone(phone);

  const r = rows.find(x => {
    const sheetId = String(x.Submission_ID || "").trim().toUpperCase();
    if (sheetId !== targetId) return false;
    if (isAdminCall) return true; // Admin bypass — PIN already verified
    // Customer must also match phone
    return _normalizePhone(x.Phone) === normTargetPhone;
  });
  if (!r) {
    console.error(`CANCELLATION FAILED: Submission ID "${rowId}" not found or phone mismatch for ${phone} (admin=${isAdminCall}).`);
    return {success: false, error: "Order record not found or you do not have permission to cancel it."};
  }
  // ── ALREADY CANCELLED GUARD ────────────────────────────────────────
  // Row is kept forever now. Prevent double-cancellation attempts.
  if (_isOrderCancelled(r.Payment_Status)) {
    return { success: false, error: "This order has already been cancelled." };
  }
  const orderDateStr = r.Order_Date instanceof Date
    ? Utilities.formatDate(r.Order_Date, "Asia/Kolkata", "yyyy-MM-dd")
    : String(r.Order_Date).trim();
  if (orderDateStr < today) return {success: false, error: "Cannot delete past orders"};

  // Block deletion if cutoff has passed for today's orders
  // Normalize meal type — strip whitespace + title-case — to avoid silent skip when value is " breakfast" or "BREAKFAST"
  const mealNorm = String(r.Meal_Type || "").trim().toLowerCase();
  const mealKey  = mealNorm.charAt(0).toUpperCase() + mealNorm.slice(1);
  if (orderDateStr === today) {
    // Use the latest (override-aware) cutoff for this date, not a stale default.
    const effCutoffs = _effectiveCutoffsForDate(orderDateStr);
    const cutoffHour = effCutoffs[mealKey];
    if (cutoffHour !== undefined && hourIST >= cutoffHour) {
      return {success: false, error: `Cutoff for ${mealKey} has already passed`};
    }
  }

  // ─── IDEMPOTENCY / RECOVERY GUARD ─────────────────────────────────
  // If a pending refund already exists for this Submission_ID, DON'T add
  // another, but DO finish the cancellation by deleting the order row.
  // (Previous attempt may have written the refund then failed before delete.)
  let existingPendingRefund = null;
  try {
    const refundsWs = ss.getSheetByName(TAB_REFUNDS);
    if (refundsWs && refundsWs.getLastRow() > 1) {
      const refRows = getAllRows(refundsWs);
      existingPendingRefund = refRows.find(rf => {
        const rfId = String(rf.Submission_ID || "").trim().toUpperCase();
        const rfStat = String(rf.Status || "").trim().toLowerCase();
        return rfId === targetId && rfStat === "pending";
      }) || null;
    }
  } catch (e) { /* non-fatal */ }

  if (existingPendingRefund) {
    // Recovery path: refund row already exists, just ensure order row is marked cancelled.
    try {
      const hIdxR = headerIndex(ws);
      const statusColR = hIdxR["Payment_Status"] || hIdxR["Payment Status"];
      if (statusColR && !_isOrderCancelled(r.Payment_Status)) {
        ws.getRange(r._row, statusColR).setValue("Cancelled \u2013 UPI Refund Pending");
      }
    } catch (e) { /* non-fatal */ }
    return {
      success: true,
      message: "Cancellation completed. Your refund was already in the queue and will be processed within 1-2 days."
    };
  }

  // GRACEFUL REFUND HANDLING with eligibility recalculation (Cases 1/2/3)
  const pStatStr = String(r.Payment_Status).toLowerCase();
  const isOnAccountOrder = pStatStr === "on account";
  let finalType = refundType; // Declare here so it is accessible at the end of the function for the soft-cancel remark.

  if (pStatStr === "paid" || pStatStr === "wallet paid" || isOnAccountOrder) {
    const custName = r.Customer_Name || "Customer";
    const ordersWs2 = ws; // same sheet
    const hIdx = headerIndex(ws); // needed for updating remaining rows
    const deleteDate = orderDateStr;
    const deleteMeal = String(r.Meal_Type).trim();

    // Get all orders for this phone+date (excluding the one being deleted)
    const sameDayRows = rows.filter(x =>
      String(x.Phone).trim() === String(phone).trim() &&
      (() => {
        const xd = x.Order_Date instanceof Date
          ? Utilities.formatDate(x.Order_Date, 'Asia/Kolkata', 'yyyy-MM-dd')
          : String(x.Order_Date).trim();
        return xd === deleteDate && String(x.Submission_ID) !== String(rowId);
      })()
    );

    // Calc remaining day subtotal (food only) after deletion
    const remainingDaySubtotal = sameDayRows.reduce((s, x) => s + (Number(x.Food_Subtotal) || 0), 0);
    // Calc old day subtotal (including deleted row)
    const oldDaySubtotal = remainingDaySubtotal + (Number(r.Food_Subtotal) || 0);

    // Over-discount claw-back: only claw back discounts that were ACTUALLY applied
    // to remaining orders (read from their Discount_Amount column), not a theoretical
    // volume tier. submitOrder only applies loyalty (6th-day) discounts, not volume tiers.
    let overDiscount = 0;
    {
      const discColIdx = hIdx["Discount_Amount"];
      const netColIdx  = hIdx["Net_Total"];

      // Sum of discounts actually applied to remaining rows
      const totalActualDiscount = sameDayRows.reduce((s, x) => s + (Number(x.Discount_Amount) || 0), 0);

      if (totalActualDiscount > 0) {
        // Re-compute what discount the remaining orders SHOULD get after deletion.
        // We use their total food subtotal and compare to what was actually given.
        // For now: if the deleted order was the "trigger" for the day's loyalty discount,
        // the remaining orders should have 0 discount (they didn't earn it alone).
        // Claw back = (actual given) − (what they deserve now).
        // Conservative: only claw back if none of the remaining rows have Loyalty_Discount=Yes.
        const remainingHasLoyalty = sameDayRows.some(x =>
          String(x.Loyalty_Discount || "").trim().toLowerCase() === "yes"
        );

        if (!remainingHasLoyalty) {
          // No loyalty day in remaining rows — the deleted row was the discount trigger.
          // Claw back all discounts from remaining rows.
          overDiscount = totalActualDiscount;

          // Update remaining rows: zero out their Discount_Amount and restore Net_Total
          if (overDiscount > 0 && discColIdx && netColIdx) {
            sameDayRows.forEach(x => {
              const xSub      = Number(x.Food_Subtotal)       || 0;
              const xSurcharge= Number(x.Inflation_Surcharge) || 0;
              const xDelivery = Number(x.Delivery_Charge)     || 0;
              const xSmallFee = Number(x.Small_Order_Fee)     || 0;
              const xReviewD  = Number(x.Review_Discount)     || 0;
              const newNetTotal = xSub + xDelivery + xSmallFee + xSurcharge - xReviewD; // discount = 0
              ws.getRange(x._row, discColIdx).setValue(0);
              ws.getRange(x._row, netColIdx) .setValue(newNetTotal);
            });
          }
        }
      }
    }

    // Delivery & Fee eligibility for remaining same-day orders
    // If combined day total drops below 150 after deletion → those remaining orders
    // should have been charged fees → customer saved them unjustly.
    const FREE_THR_D = 150;
    const freeAreaNames2 = getAreas().filter(a => a.free).map(a => a.name);
    const isNonFree = (area) => !freeAreaNames2.includes(area) && area !== "Self Pickup";

    let deliveryOwed = 0;
    let smallFeeOwed = 0;

    if (oldDaySubtotal >= FREE_THR_D && remainingDaySubtotal < FREE_THR_D) {
      // Day total drops below free-delivery threshold → remaining orders now owe fees.
      // We claw the amounts from THIS refund, AND update those rows in the sheet so that
      // if they are later cancelled themselves, the clawback doesn't fire a second time.
      const delivColIdx   = hIdx["Delivery_Charge"];
      const smallFeeColIdx = hIdx["Small_Order_Fee"];
      const netColIdx2    = hIdx["Net_Total"];

      sameDayRows.forEach(x => {
        const xArea = x.Area || "";
        const xSub  = Number(x.Food_Subtotal) || 0;
        let netDelta = 0;

        // 1. Delivery Clawback: order was in non-free area but charged ₹0 due to threshold
        if (xSub > 0 && isNonFree(xArea) && (Number(x.Delivery_Charge) || 0) === 0) {
          deliveryOwed += 11;
          netDelta += 10;
          if (delivColIdx) ws.getRange(x._row, delivColIdx).setValue(10);
        }

        // 2. Small Order Fee Clawback: Lunch/Dinner sub < ₹50 was waived due to threshold
        const xMeal = String(x.Meal_Type).trim();
        if ((xMeal === "Lunch" || xMeal === "Dinner") && xSub > 0 && xSub < 50
            && (Number(x.Small_Order_Fee) || 0) === 0) {
          smallFeeOwed += 10;
          netDelta += 10;
          if (smallFeeColIdx) ws.getRange(x._row, smallFeeColIdx).setValue(10);
        }

        // Update Net_Total on remaining row to reflect newly owed fees (prevents double-clawback)
        if (netDelta > 0 && netColIdx2) {
          ws.getRange(x._row, netColIdx2).setValue((Number(x.Net_Total) || 0) + netDelta);
        }
      });
    }

    // Loyalty Clawback Logic
    // If deleting an order breaks a streak that received a reward on a later date.
    // Admin cancellations are EXEMPT — streak is not penalised when kitchen cancels.
    let loyaltyClawback = 0;
    let loyaltyClawbackNote = "";
    const phoneStr = _normalizePhone(phone);

    if (!isAdminCall) {
      // Scan for a later streak-reward order that this cancellation would invalidate.
      const laterPayoffs = rows.filter(x => {
        if (String(x.Submission_ID) === String(rowId)) return false;
        if (_normalizePhone(x.Phone) !== phoneStr) return false;
        const xStat = String(x.Payment_Status || "").toLowerCase();
        if (xStat.includes("cancelled") || xStat.includes("deleted")) return false;
        if (String(x.Loyalty_Discount || "").trim().toLowerCase() !== "yes") return false;
        const xDate = x.Order_Date instanceof Date
          ? Utilities.formatDate(x.Order_Date, "Asia/Kolkata", "yyyy-MM-dd")
          : String(x.Order_Date).trim();
        return xDate >= orderDateStr; // payoff on or after the cancelled order's date
      });

      if (laterPayoffs.length > 0) {
        loyaltyClawback = Number(laterPayoffs[0].Discount_Amount) || 0;
        loyaltyClawbackNote = `Loyalty reward of ₹${loyaltyClawback} was applied on ${
          (() => { const d = laterPayoffs[0].Order_Date; return d instanceof Date ? Utilities.formatDate(d,"Asia/Kolkata","dd MMM") : String(d); })()
        } — cancelling this order breaks your streak, so that reward is reversed.`;
      }
    }

    // Refund = Net_Total − adjustment
    // Net_Total already correctly encodes: food + delivery + fees + surcharge − discount − mealCredit − reviewDiscount
    const adjustment = overDiscount + deliveryOwed + smallFeeOwed + loyaltyClawback;
    const rawRefund = Number(r.Net_Total) || 0;
    const netRefund = rawRefund - adjustment;           // may be negative
    const refundAmt = Math.max(0, netRefund);           // amount actually returned
    const cancellationCharge = Math.max(0, -netRefund); // deficit charged to wallet if order < clawback

    // ── HUMAN-READABLE REFUND BREAKDOWN ────────────────────────────────────
    function buildRefundBreakdown() {
      const lines = [];
      if (adjustment === 0) {
        lines.push(`Full refund of ₹${refundAmt}.`);
        return lines.join("\n");
      }
      lines.push(`Order total: ₹${rawRefund}`);
      lines.push(`Deductions (₹${adjustment} total):`);
      if (overDiscount > 0) {
        lines.push(`  • -₹${overDiscount} — discount reversal: a loyalty discount applied to your other order(s) on this day is reversed since it was earned as part of this streak order.`);
      }
      if (deliveryOwed > 0) {
        const numOrders = deliveryOwed / 11;
        lines.push(`  • -₹${deliveryOwed} — delivery fee: your remaining ${numOrders > 1 ? numOrders + " orders" : "order"} had free delivery because day total was ₹150+. It now drops below ₹150, so ₹11 delivery applies.`);
      }
      if (smallFeeOwed > 0) {
        lines.push(`  • -₹${smallFeeOwed} — small cart fee: a remaining order under ₹50 had its ₹10 small cart fee waived (day total was ₹150+). Now that drops below ₹150, the fee applies.`);
      }
      if (loyaltyClawback > 0) {
        lines.push(`  • -₹${loyaltyClawback} — loyalty reward reversal: ${loyaltyClawbackNote}`);
      }
      if (cancellationCharge > 0) {
        lines.push(`Refund: ₹${rawRefund} − ₹${adjustment} = -₹${cancellationCharge}`);
        lines.push(`Since the deduction (₹${adjustment}) exceeds your order amount (₹${rawRefund}), ₹${cancellationCharge} has been charged to your Svaadh Wallet. This will be deducted from your next order.`);
      } else {
        lines.push(`Refund: ₹${rawRefund} − ₹${adjustment} = ₹${refundAmt}`);
      }
      return lines.join("\n");
    }

    // ── DRY RUN: return breakdown without making any changes ─────────────────
    if (opts.dryRun) {
      return {
        success:            true,
        dryRun:             true,
        refundAmt:          refundAmt,
        adjustment:         adjustment,
        cancellationCharge: cancellationCharge,
        breakdownText:      buildRefundBreakdown()
      };
    }

    // Multi-Payment Logic: If any OTHER order for this meal/date is Wallet Paid,
    // force this refund to Wallet too (to keep the day's bookkeeping simple).
    const hasAnyOtherWalletPaid = sameDayRows.some(x => {
      const typeMatch = String(x.Meal_Type).trim() === deleteMeal;
      const statusMatch = String(x.Payment_Status).toLowerCase() === "wallet paid";
      return typeMatch && statusMatch;
    });

    finalType = refundType;
    let msgSuffix = "";

    // Auto-detect wallet refund if current was wallet paid, overriding passed type
    const currentWasWallet = (pStatStr === "wallet paid");
    const currentWasSplit  = (String(r.Payment_Method || "").trim().toLowerCase() === "split");
    if (isOnAccountOrder) {
      // On Account: no cash was collected — mark row as cancelled.
      // Remaining rows already updated above (discount/delivery recalculation).
      // On-account balance auto-corrects since it's derived from live sheet rows.
      msg = "Order removed from your On Account balance.";
      finalType = "__on_account_handled__"; // skip all refund payout logic
    } else if (currentWasWallet) {
      finalType = "wallet";
    } else if (currentWasSplit) {
      // Split orders: entire refund always goes to Wallet — wallet + UPI portions both back to wallet.
      if (refundAmt > 0) {
        _appendWalletTransaction(phone, custName, "Order Cancellation Refund", refundAmt, true, String(rowId));
      }
      msg = buildRefundBreakdown() + `\n\n₹${refundAmt} refunded to your Wallet.`;
      finalType = "__split_handled__"; // skip normal logic below
    } else if (hasAnyOtherWalletPaid && refundType === "manual_upi") {
      finalType = "wallet";
      msgSuffix = "\n(Consolidated to Wallet since other items in this meal were Wallet Paid.)";
    }

    // If cancellation charge > 0 (loyalty clawback exceeded the order value):
    // debit the deficit from the wallet — it'll show as a negative balance
    // that gets collected on the customer's next order.
    if (cancellationCharge > 0) {
      _appendWalletTransaction(phone, custName,
        `Cancellation Charge (streak reward reversal — ₹${loyaltyClawback} reward was applied to an order because of this order. Cancelling it breaks your streak, so ₹${cancellationCharge} is recovered here.)`,
        -cancellationCharge, true, String(rowId));
    }

    if (finalType === "wallet") {
      if (refundAmt > 0) {
        _appendWalletTransaction(phone, custName, "Order Cancellation Refund", refundAmt, true, String(rowId));
      }
      const walletLine = cancellationCharge > 0
        ? `₹0 refunded — ₹${cancellationCharge} charged to your Wallet (will be collected on your next order).`
        : `₹${refundAmt} refunded to your Wallet.${msgSuffix}`;
      msg = buildRefundBreakdown() + `\n\n` + walletLine;
    }
    else if (finalType === "manual_upi") {
      const REF_HEADERS = ["Submission_ID","Phone","Name","Amount","Meal","Date","Status","Timestamp","Adjustment_Note","Refund_Mode"];
      const refWs = getOrCreateTab(ss, TAB_REFUNDS, REF_HEADERS);
      const note = adjustment > 0
        ? `Adjusted -₹${adjustment} (overDiscount:${overDiscount}, deliveryOwed:${deliveryOwed}, smallFeeOwed:${smallFeeOwed}, loyaltyClawback:${loyaltyClawback})`
        : "";
      refWs.appendRow([rowId, phone, custName, refundAmt, r.Meal_Type, orderDateStr, "Pending", now, note, "upi"]);
      const upiLine = cancellationCharge > 0
        ? `₹0 refunded via UPI — ₹${cancellationCharge} charged to your Wallet (will be collected on your next order).`
        : `₹${refundAmt} refund request raised — we'll process it within 1-2 days.`;
      msg = buildRefundBreakdown() + `\n\n` + upiLine;
    }
  } 
  // ── SOFT CANCELLATION FOR UPI / SPLIT ──────────────────────────────────────
  // "Pending" means customer has ALREADY paid (UPI screenshot sent) but admin hasn't verified yet.
  // For Split orders, "Pending" = wallet was deducted AND UPI payment was sent — must soft-cancel just like UPI.
  // Admin will verify and then "Verify & Refund" triggers the split refund logic in markOrdersStatus.
  if (String(r.Payment_Status || "").toLowerCase().includes("pending") && (refundType === "wallet" || refundType === "manual_upi")) {
    let hIdx = headerIndex(ws);
    
    // Robust header detection (support both underscores and spaces)
    const statusCol = hIdx["Payment_Status"] || hIdx["Payment Status"];
    
    if (!hIdx["Refund_Preference"]) {
      const col = ws.getLastColumn() + 1;
      ws.getRange(1, col).setValue("Refund_Preference")
        .setFontWeight("bold").setBackground("#c0392b").setFontColor("white");
      hIdx = headerIndex(ws);
    }
    const prefCol = hIdx["Refund_Preference"];
    
    if (statusCol && prefCol) {
      ws.getRange(r._row, statusCol).setValue("Cancelled (Verify UPI)");
      // Split orders: refund preference is always wallet (full amount back to wallet)
      const isSoftSplit = String(r.Payment_Method || "").trim().toLowerCase() === "split";
      ws.getRange(r._row, prefCol).setValue(isSoftSplit ? "wallet" : refundType);
      console.info(`SUCCESS: Soft-cancelled row ${r._row} with preference ${isSoftSplit ? "wallet (split)" : refundType}`);

      // For split orders: wallet portion is already deducted — refund it immediately.
      // UPI portion will be added to wallet once admin verifies.
      let softCancelMsg = "Cancellation request received! Admin will verify your payment and process the refund (1-2 days). ✅";
      if (isSoftSplit) {
        const walletCredit = Number(r.Wallet_Credit) || 0;
        const upiDue = Math.max(0, (Number(r.Net_Total) || 0) - walletCredit);
        if (walletCredit > 0) {
          _appendWalletTransaction(phone, r.Customer_Name || "Customer", "Order Cancellation Refund (Wallet Part)", walletCredit, true, String(rowId));
        }
        softCancelMsg = upiDue > 0
          ? `₹${walletCredit} has been refunded to your Wallet instantly. ` +
            `Once Admin verifies your ₹${upiDue} UPI payment, it will also be added to your Wallet (1-2 days). ✅`
          : `₹${walletCredit} has been refunded to your Wallet. ✅`;
      }
      return { success: true, message: softCancelMsg };
    } else {
      console.error(`FAILED: Missing columns for soft-cancel. StatusCol:${statusCol}, PrefCol:${prefCol}`);
    }
  }

  // ─── SOFT-CANCEL THE ROW (mark status, never delete) ─────────────────
  // Orders are kept forever for audit trail. The Payment_Status remark
  // ensures the row is excluded from all prep/delivery counts via _isOrderCancelled().
  {
    const hIdxFinal = headerIndex(ws);
    const statusColFinal = hIdxFinal["Payment_Status"] || hIdxFinal["Payment Status"];
    if (statusColFinal) {
      let cancelRemark;
      if (finalType === "wallet" || finalType === "__split_handled__") {
        cancelRemark = "Cancelled \u2013 Refunded to Wallet";
      } else if (finalType === "manual_upi") {
        cancelRemark = "Cancelled \u2013 UPI Refund Pending";
      } else if (finalType === "__on_account_handled__") {
        cancelRemark = "Cancelled \u2013 On Account";
      } else {
        // Fallback for unknown type (e.g. zero-refund edge cases)
        cancelRemark = "Cancelled";
      }
      ws.getRange(r._row, statusColFinal).setValue(cancelRemark);
      console.info(`ORDER SOFT-CANCELLED: Row ${r._row} (${rowId}) marked as '${cancelRemark}'`);
    } else {
      console.error(`SOFT-CANCEL FAILED: Payment_Status column not found in header index.`);
    }
  }

  return {success: true, message: msg};
}



// ── ADMIN: GET ALL DATA ──────────────────────────────────────
function getAdminData() {
  return _cachedData("adminData_v1", 30, _getAdminDataUncached);
}

function _getAdminDataUncached() {
  const ss = getSpreadsheet();

  const bfWs   = getOrCreateTab(ss, TAB_BF_MASTER, []);
  const sabjiWs= getOrCreateTab(ss, TAB_SABJI,     []);
  const menuWs = getOrCreateTab(ss, TAB_MENU,       []);

  const bfRows    = getAllRows(bfWs);
  const sabjiRows = getAllRows(sabjiWs);
  const menuRows  = getAllRows(menuWs);

  const ordersWsAdm = getOrCreateTab(ss, TAB_ORDERS, []);
  const allOrdersAdm = getAllRows(ordersWsAdm);

  const breakfastMaster = bfRows.map(r => ({
    id: String(r.ID), name: String(r.Name), price: Number(r.Price),
    default_on: r.Active === true || String(r.Active).toUpperCase() === "TRUE"
  }));

  const sabjiMaster = sabjiRows.map(r => ({
    id: String(r.ID), name: String(r.Name), type: String(r.Type),
    active: String(r.Active).toLowerCase() !== "false"
  }));

  const menuEntries = menuRows.map(r => {
    const d = r.Date instanceof Date
      ? Utilities.formatDate(r.Date, "Asia/Kolkata", "yyyy-MM-dd")
      : String(r.Date).trim();
    const co = {};
    if (r.Cutoff_Breakfast) co.Breakfast = Number(r.Cutoff_Breakfast);
    if (r.Cutoff_Lunch)     co.Lunch     = Number(r.Cutoff_Lunch);
    if (r.Cutoff_Dinner)    co.Dinner    = Number(r.Cutoff_Dinner);
    let breakfast = [];
    try { if (r.Breakfast_JSON) breakfast = JSON.parse(r.Breakfast_JSON); } catch(e) {}
    let oosItems = { Breakfast: [], Lunch: [], Dinner: [] };
    try { if (r.OOS_JSON) oosItems = JSON.parse(r.OOS_JSON); } catch(e) {}
    let ordersClosed = {};
    try { if (r.Orders_Closed) ordersClosed = JSON.parse(r.Orders_Closed); } catch(e) {}
    let stockLimits = {};
    try { if (r.Stock_JSON) stockLimits = JSON.parse(r.Stock_JSON); } catch(e) {}
    const orderedCounts = countOrderedUnits(allOrdersAdm, d);
    const unitsRemaining = {};
    ["Breakfast","Lunch","Dinner"].forEach(meal => {
      Object.entries(stockLimits[meal] || {}).forEach(([colKey, limit]) => {
        if (!unitsRemaining[meal]) unitsRemaining[meal] = {};
        unitsRemaining[meal][colKey] = Math.max(0, limit - (orderedCounts[meal][itemsJsonKey(colKey)] || 0));
      });
    });
    const kitchenClosed = (r.Kitchen_Closed === true ||
      String(r.Kitchen_Closed || "").toLowerCase() === "true");
    return {
      date:             d,
      breakfast:        breakfast,
      lunch_dry:        r.Lunch_Dry    || "",
      lunch_curry:      r.Lunch_Curry  || "",
      dinner_dry:       r.Dinner_Dry   || "",
      dinner_curry:     r.Dinner_Curry || "",
      cutoff_overrides: co,
      oos_items:        oosItems,
      orders_closed:    ordersClosed,
      stock_limits:     stockLimits,
      units_remaining:  unitsRemaining,
      kitchen_closed:   kitchenClosed,
    };
  });

  return {breakfastMaster, sabjiMaster, menuEntries};
}

// ── ADMIN: SAVE MENU ─────────────────────────────────────────
function saveMenu(body) {
  const ss = getSpreadsheet();
  // Always pass full headers so schema self-heals if initSchema() was never run
  const ws = getOrCreateTab(ss, TAB_MENU, [
    "Date","Breakfast_JSON","Lunch_Dry","Lunch_Curry","Dinner_Dry","Dinner_Curry",
    "Cutoff_Breakfast","Cutoff_Lunch","Cutoff_Dinner",
    "OOS_JSON","Orders_Closed","Stock_JSON","Kitchen_Closed"
  ]);
  const rows = getAllRows(ws);
  let hIdx = headerIndex(ws);

  // Self-heal: ensure Kitchen_Closed column exists for legacy sheets.
  if (!hIdx["Kitchen_Closed"]) {
    ws.getRange(1, ws.getLastColumn() + 1).setValue("Kitchen_Closed");
    SpreadsheetApp.flush();
    hIdx = headerIndex(ws);
  }

  const dateStr     = body.date;
  const existing    = rows.find(r => {
    const d = r.Date instanceof Date
      ? Utilities.formatDate(r.Date, "Asia/Kolkata", "yyyy-MM-dd")
      : String(r.Date).trim();
    return d === dateStr;
  });

  // breakfast comes as array from admin, serialise to JSON string for storage
  const bfJson = body.breakfast
    ? JSON.stringify(body.breakfast)
    : (body.breakfastJson || "");

  // Preserve the existing Kitchen_Closed flag — regular menu saves
  // should never silently flip it. Use setKitchenClosed() to change it.
  const preservedKitchenClosed = existing
    ? (existing.Kitchen_Closed === true ||
       String(existing.Kitchen_Closed || "").toLowerCase() === "true")
    : false;

  const newRow = [
    dateStr,
    bfJson,
    body.lunch_dry        || body.lunchDry    || "",
    body.lunch_curry      || body.lunchCurry  || "",
    body.dinner_dry       || body.dinnerDry   || "",
    body.dinner_curry     || body.dinnerCurry || "",
    body.cutoff_breakfast || body.cutoffBf    || "",
    body.cutoff_lunch     || body.cutoffL     || "",
    body.cutoff_dinner    || body.cutoffD     || "",
    JSON.stringify(body.oos_items    || { Breakfast: [], Lunch: [], Dinner: [] }),
    JSON.stringify(body.orders_closed || {}),
    JSON.stringify(body.stock_limits || {}),
    preservedKitchenClosed ? "TRUE" : "",
  ];

  if (existing) {
    ws.getRange(existing._row, 1, 1, newRow.length).setValues([newRow]);
  } else {
    ws.appendRow(newRow);
  }
  // Bust per-date menu cache and the aggregated admin-data cache
  _invalidateCache("menu_v2_" + dateStr, "adminData_v1", "kitchen_closed_dates_v1");
  return {success: true, action: existing ? "updated" : "saved"};
}

// ── ADMIN: KITCHEN CLOSURE TOGGLE ─────────────────────────────
// Marks a single date as "Kitchen Closed" (or reopens it).
//
// Flow:
//   1. If isClosed === true AND there are active orders for that date
//      AND confirmCancelOrders !== true → returns
//      { requires_confirm: true, orderCount, totalAmount } so the admin
//      UI can show "X orders worth ₹Y — cancel + refund all and close?"
//   2. If confirmed (or no orders exist) → cancel + refund every active
//      order for that date (wallet payments refund instantly to wallet,
//      UPI payments go to manual_upi refund queue) and set Kitchen_Closed.
//   3. If isClosed === false → simply clear the flag (no order action).
function setKitchenClosed(body) {
  const pin = String(body && body.pin || "").trim();
  if (pin !== ADMIN_PIN) return { success: false, error: "STRICT ADMIN PIN REQUIRED" };

  const dateStr = String(body.date || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return { success: false, error: "Invalid date format (expected YYYY-MM-DD)" };
  }
  const isClosed = (body.isClosed === true || String(body.isClosed) === "true");
  const confirmCancelOrders = (body.confirmCancelOrders === true ||
                               String(body.confirmCancelOrders) === "true");

  const ss = getSpreadsheet();
  const menuWs = getOrCreateTab(ss, TAB_MENU, [
    "Date","Breakfast_JSON","Lunch_Dry","Lunch_Curry","Dinner_Dry","Dinner_Curry",
    "Cutoff_Breakfast","Cutoff_Lunch","Cutoff_Dinner",
    "OOS_JSON","Orders_Closed","Stock_JSON","Kitchen_Closed"
  ]);
  let mIdx = headerIndex(menuWs);
  if (!mIdx["Kitchen_Closed"]) {
    menuWs.getRange(1, menuWs.getLastColumn() + 1).setValue("Kitchen_Closed");
    SpreadsheetApp.flush();
    mIdx = headerIndex(menuWs);
  }

  // If closing AND not yet confirmed: count affected orders + amount.
  if (isClosed) {
    const ordersWs = ss.getSheetByName(TAB_ORDERS);
    const oRows = ordersWs ? getAllRows(ordersWs) : [];
    const activeMatches = oRows.filter(function(r) {
      const od = r.Order_Date instanceof Date
        ? Utilities.formatDate(r.Order_Date, "Asia/Kolkata", "yyyy-MM-dd")
        : String(r.Order_Date || "").trim();
      if (od !== dateStr) return false;
      return !_isOrderCancelled(r.Payment_Status);
    });

    if (activeMatches.length && !confirmCancelOrders) {
      const total = activeMatches.reduce(function(s, r) {
        return s + (Number(r.Net_Total) || 0);
      }, 0);
      const customers = {};
      activeMatches.forEach(function(r) { customers[String(r.Phone || "")] = true; });
      return {
        success: false,
        requires_confirm: true,
        orderCount: activeMatches.length,
        customerCount: Object.keys(customers).length,
        totalAmount: total,
        date: dateStr,
        message: "There are " + activeMatches.length + " active order(s) totaling ₹"
               + total + " across " + Object.keys(customers).length
               + " customer(s) for " + dateStr
               + ". Closing this day will cancel and refund all of them. Confirm?"
      };
    }

    // Auto-cancel + refund every active order for this date. deleteOrder
    // auto-detects "On Account" status from the row itself, so passing
    // rType="none" for those is safe — it routes to the On-Account branch
    // (row marked Cancelled, no payout, auto-excluded from monthly bills).
    let cancelled = 0;
    let refundedWallet = 0;
    let refundedUpi = 0;
    let onAccountAdjusted = 0;     // billed-later customers — nothing to pay back
    activeMatches.forEach(function(r) {
      const pStat = String(r.Payment_Status || "").toLowerCase();
      let rType = "none";
      let bucket = "other";
      if (pStat === "wallet paid") { rType = "wallet"; bucket = "wallet"; }
      else if (pStat === "on account" || pStat === "onaccount") { rType = "none"; bucket = "on_account"; }
      else if (pStat === "paid" || pStat.indexOf("pending") !== -1) { rType = "manual_upi"; bucket = "upi"; }

      try {
        const res = deleteOrder(String(r.Phone || ""), String(r.Submission_ID || ""),
                                rType, { isAdmin: true });
        if (res && res.success) {
          cancelled++;
          const amt = Number(r.Net_Total) || 0;
          if (bucket === "wallet")     refundedWallet    += amt;
          if (bucket === "upi")        refundedUpi       += amt;
          if (bucket === "on_account") onAccountAdjusted += amt;
        }
        SpreadsheetApp.flush();
      } catch(e) {
        console.error("setKitchenClosed: deleteOrder failed for " + r.Submission_ID + ": " + e.message);
      }
    });

    // Write Kitchen_Closed = TRUE on the menu row (create row if needed).
    _writeKitchenClosedFlag(menuWs, mIdx, dateStr, true);
    _invalidateCache("menu_v2_" + dateStr, "kitchen_closed_dates_v1", "adminData_v1");

    // Build a human-readable breakdown including On Account (was missing).
    var parts = [];
    if (refundedWallet > 0)    parts.push("₹" + refundedWallet + " refunded to wallets");
    if (refundedUpi > 0)       parts.push("₹" + refundedUpi + " queued for UPI refund");
    if (onAccountAdjusted > 0) parts.push("₹" + onAccountAdjusted + " removed from On-Account balances (no payout — just won't be billed)");
    var breakdown = parts.length ? (" — " + parts.join(", ") + ".") : ".";

    return {
      success: true,
      isClosed: true,
      cancelled: cancelled,
      refundedWallet: refundedWallet,
      refundedUpi: refundedUpi,
      onAccountAdjusted: onAccountAdjusted,
      message: "Kitchen closed for " + dateStr + ". " + cancelled
             + " order(s) cancelled" + breakdown
    };
  }

  // Re-opening: just clear the flag, no order action.
  _writeKitchenClosedFlag(menuWs, mIdx, dateStr, false);
  _invalidateCache("menu_v2_" + dateStr, "kitchen_closed_dates_v1", "adminData_v1");
  return { success: true, isClosed: false, message: "Kitchen re-opened for " + dateStr + "." };
}

function _writeKitchenClosedFlag(menuWs, mIdx, dateStr, isClosed) {
  const rows = getAllRows(menuWs);
  const existing = rows.find(function(x) {
    const d = x.Date instanceof Date
      ? Utilities.formatDate(x.Date, "Asia/Kolkata", "yyyy-MM-dd")
      : String(x.Date || "").trim();
    return d === dateStr;
  });
  const colIdx = mIdx["Kitchen_Closed"];
  if (existing) {
    menuWs.getRange(existing._row, colIdx).setValue(isClosed ? "TRUE" : "");
  } else {
    // Create a minimal menu row just to hold the flag.
    const newRow = new Array(menuWs.getLastColumn()).fill("");
    newRow[mIdx["Date"] - 1] = dateStr;
    newRow[colIdx - 1] = isClosed ? "TRUE" : "";
    menuWs.appendRow(newRow);
  }
  SpreadsheetApp.flush();
}

// ── ADMIN: BREAKFAST MASTER CRUD ─────────────────────────────
function saveBreakfastItem(body) {
  const ss = getSpreadsheet();
  const ws = getOrCreateTab(ss, TAB_BF_MASTER, []);
  const rows = getAllRows(ws);

  // Admin sends "default_on" (true/false); map to Active column
  const isActive = body.default_on !== false && body.default_on !== "false";

  if (body.id) {
    const r = rows.find(x => String(x.ID) === String(body.id));
    if (r) {
      const hIdx = headerIndex(ws);
      ws.getRange(r._row, hIdx["Name"]).setValue(body.name);
      ws.getRange(r._row, hIdx["Price"]).setValue(body.price);
      ws.getRange(r._row, hIdx["Active"]).setValue(isActive ? "true" : "false");
      _invalidateCache("adminData_v1");
      return {success: true};
    }
  }
  const newId = "BF-" + new Date().getTime();
  ws.appendRow([newId, body.name, body.price, isActive ? "true" : "false"]);
  _invalidateCache("adminData_v1");
  return {success: true, id: newId};
}

function deleteBreakfastItem(id) {
  const ss = getSpreadsheet();
  const ws = getOrCreateTab(ss, TAB_BF_MASTER, []);
  const rows = getAllRows(ws);
  const r = rows.find(x => String(x.ID) === String(id));
  if (!r) return {success: false, error: "Not found"};
  ws.deleteRow(r._row);
  _invalidateCache("adminData_v1");
  return {success: true};
}

// ── ADMIN: SABJI MASTER CRUD ──────────────────────────────────
function saveSabjiItem(body) {
  const ss = getSpreadsheet();
  const ws = getOrCreateTab(ss, TAB_SABJI, []);
  const rows = getAllRows(ws);

  if (body.id) {
    const r = rows.find(x => String(x.ID) === String(body.id));
    if (r) {
      const hIdx = headerIndex(ws);
      ws.getRange(r._row, hIdx["Name"]).setValue(body.name);
      ws.getRange(r._row, hIdx["Type"]).setValue(body.type);
      ws.getRange(r._row, hIdx["Active"]).setValue(body.active !== false ? "true" : "false");
      _invalidateCache("adminData_v1");
      return {success: true};
    }
  }
  const newId = "SB-" + new Date().getTime();
  ws.appendRow([newId, body.name, body.type || "Dry", "true"]);
  _invalidateCache("adminData_v1");
  return {success: true, id: newId};
}

function deleteSabjiItem(id) {
  const ss = getSpreadsheet();
  const ws = getOrCreateTab(ss, TAB_SABJI, []);
  const rows = getAllRows(ws);
  const r = rows.find(x => String(x.ID) === String(id));
  if (!r) return {success: false, error: "Not found"};
  ws.deleteRow(r._row);
  return {success: true};
}

// ── CUSTOMER LEDGER ──────────────────────────────────────────
function _getLedgerFolder(year) {
  const parentName = LEDGER_FOLDER;
  const yearStr    = String(year);
  const parents    = DriveApp.getFoldersByName(parentName);
  let parent;
  if (parents.hasNext()) { parent = parents.next(); }
  else { parent = DriveApp.createFolder(parentName); }

  const children = parent.getFoldersByName(yearStr);
  if (children.hasNext()) return children.next();
  return parent.createFolder(yearStr);
}

function _getOrCreateCustomerLedger(ss, phone, name, year) {
  // Check if ledger ID already stored
  const custWs  = getOrCreateTab(ss, TAB_CUSTOMERS, CUSTOMERS_HEADERS);
  const custRows = getAllRows(custWs);
  const cust = custRows.find(r => String(r.Phone).trim() === String(phone).trim());

  if (cust && cust.Ledger_Sheet_ID) {
    try {
      return SpreadsheetApp.openById(cust.Ledger_Sheet_ID);
    } catch(e) { /* file may have been deleted */ }
  }

  const folder  = _getLedgerFolder(year);
  const ledger  = SpreadsheetApp.create(`Svaadh — ${name} (${phone})`);
  DriveApp.getFileById(ledger.getId()).moveTo(folder);

  // Store ID in customers sheet
  if (cust) {
    const hIdx = headerIndex(custWs);
    if (hIdx["Ledger_Sheet_ID"]) {
      custWs.getRange(cust._row, hIdx["Ledger_Sheet_ID"]).setValue(ledger.getId());
    }
  }
  return ledger;
}

function _ensureMonthTab(ledgerSs, year, monthIdx) {
  const MONTHS = ["January","February","March","April","May","June",
                  "July","August","September","October","November","December"];
  const tabName = `${MONTHS[monthIdx]} ${year}`;
  let ws = ledgerSs.getSheetByName(tabName);
  if (ws) return ws;

  ws = ledgerSs.insertSheet(tabName);
  const headers = ["Submission_ID","Date","Meal","Items Ordered","Subtotal (₹)","Delivery (₹)","Discount (₹)","Net Total (₹)"];
  const periods = ["1–10","11–20","21–end"];

  let row = 1;
  periods.forEach(p => {
    ws.getRange(row, 1).setValue(`● Period ${p}`).setFontWeight("bold").setBackground("#f5f0eb");
    ws.getRange(row, 1, 1, headers.length).merge();
    row++;
    ws.getRange(row, 1, 1, headers.length).setValues([headers]).setFontWeight("bold").setBackground("#c0392b").setFontColor("white");
    row++;
    // 3 blank data rows (grow dynamically)
    row += 3;
    ws.getRange(row, 1).setValue("Period Total").setFontWeight("bold");
    ws.getRange(row, 7).setFormula(`=SUMIF(G${row-3}:G${row-1},"<>",G${row-3}:G${row-1})`);
    row += 2;
  });
  return ws;
}

function _updateLedger(ss, profile, orders) {
  const ist  = new Date(new Date().getTime() + 5.5 * 3600 * 1000);
  const year = ist.getFullYear();
  const monthIdx = ist.getMonth();

  const ledger = _getOrCreateCustomerLedger(ss, profile.phone, profile.name, year);
  const ws     = _ensureMonthTab(ledger, year, monthIdx);

  for (const order of orders) {
    for (const meal of order.meals) {
      const sid = meal._sid || order.submissionId || "";
      const summary = (meal.items || [])
        .filter(function(it){ return it.qty > 0; })
        .map(function(it){ return it.qty + "×" + it.colKey; })
        .join(", ") || "—";
      const delCharge = meal.deliveryCharge || 0;
      const discAmt   = meal.discountAmount  || 0;
      const netTotal  = meal.subtotal + delCharge - discAmt;
      ws.appendRow([sid, order.date, meal.type, summary, meal.subtotal, delCharge, discAmt, netTotal]);
    }
  }
}

// ── AREAS ────────────────────────────────────────────────────

const AREAS_HEADERS = ["Area_Name", "Area_Label", "Free_Delivery"];

const DEFAULT_AREAS = [
  ["Amanora",         "Amanora Town",                              "FALSE"],
  ["BG Shirke Road",  "BG Shirke Road",                            "FALSE"],
  ["Bhosale Nagar",   "Bhosale Nagar (Free Delivery)",             "TRUE"],
  ["DP Road",         "DP Road",                                   "FALSE"],
  ["Gadital",         "Gadital",                                   "FALSE"],
  ["Mandai",          "Hadapsar Mandai",                           "FALSE"],
  ["Kirtane Baug",    "Kirtane Baug",                              "FALSE"],
  ["Magarpatta",      "Magarpatta",                                "FALSE"],
  ["Malwadi",         "Malwadi",                                   "FALSE"],
  ["Pune-Solapur Road", "Pune-Solapur Road (Till Gadital Only)",   "FALSE"],
  ["SadeSatraNali",   "SadeSatraNali",                             "FALSE"],
  ["Triveni Nagar",   "Triveni Nagar (Free Delivery)",             "TRUE"],
  ["Tupe Patil Road", "Tupe Patil Road",                           "FALSE"],
  ["Vaiduwadi",       "Vaiduwadi (Till Yash Honda Only)",          "FALSE"],
  ["Vihar Chowk",     "Vihar Chowk",                               "FALSE"],
  ["Pickup",          "📦 Self Pickup (Waives all fees)",             "TRUE"]
];

function getAreas() {
  return _cachedData("areas_v1", 300, function() {
    const ss = getSpreadsheet();
    const ws = getOrCreateTab(ss, TAB_AREAS, AREAS_HEADERS);
    const rows = getAllRows(ws);
    // Seed defaults on first run
    if (rows.length === 0) {
      DEFAULT_AREAS.forEach(function(r) { ws.appendRow(r); });
      return DEFAULT_AREAS.map(function(r) { return {name:r[0], label:r[1], free:true}; });
    }
    return rows.map(function(r) {
      return {name: r.Area_Name, label: r.Area_Label, free: r.Free_Delivery === true || String(r.Free_Delivery).toUpperCase() === "TRUE"};
    });
  });
}

function saveArea(body) {
  const ss = getSpreadsheet();
  const ws = getOrCreateTab(ss, TAB_AREAS, AREAS_HEADERS);
  const data = ws.getDataRange().getValues();
  const headers = data[0];
  const nameIdx = headers.indexOf("Area_Name");
  const labelIdx = headers.indexOf("Area_Label");
  const freeIdx = headers.indexOf("Free_Delivery");
  // Update if exists
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][nameIdx]).toLowerCase() === String(body.name).toLowerCase()) {
      data[i][labelIdx] = body.label;
      data[i][freeIdx]  = body.free ? "TRUE" : "FALSE";
      ws.getDataRange().setValues(data);
      _invalidateCache("areas_v1");
      return {success: true};
    }
  }
  // Add new
  ws.appendRow([body.name, body.label, body.free ? "TRUE" : "FALSE"]);
  _invalidateCache("areas_v1");
  return {success: true};
}

function deleteArea(body) {
  const ss = getSpreadsheet();
  const ws = getOrCreateTab(ss, TAB_AREAS, AREAS_HEADERS);
  const data = ws.getDataRange().getValues();
  const nameIdx = data[0].indexOf("Area_Name");
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][nameIdx]) === String(body.name)) {
      ws.deleteRow(i + 1);
      _invalidateCache("areas_v1");
      return {success: true};
    }
  }
  return {success: false, error: "Area not found"};
}

// ── REFUND MANAGEMENT (ADMIN) ────────────────────────────────
function getPendingRefunds() {
  const ss = getSpreadsheet();
  const ws = getOrCreateTab(ss, TAB_REFUNDS, ["Submission_ID","Phone","Name","Amount","Meal","Date","Status","Timestamp","Adjustment_Note","Refund_Mode"]);
  const rows = getAllRows(ws);
  return rows.filter(r => ["Pending", "Verification Required"].includes(String(r.Status)));
}

function markRefunded(submissionId) {
  const ss = getSpreadsheet();
  const ws = getOrCreateTab(ss, TAB_REFUNDS, []);
  const data = ws.getDataRange().getValues();
  const h = data[0];
  const idIdx = h.indexOf("Submission_ID");
  const statusIdx = h.indexOf("Status");
  const phoneIdx = h.indexOf("Phone");
  const nameIdx = h.indexOf("Name");
  const amtIdx = h.indexOf("Amount");
  const modeIdx = h.indexOf("Refund_Mode");

  if (idIdx === -1 || statusIdx === -1) return {success: false, error: "Sheet layout error"};

  const now = Utilities.formatDate(new Date(), "Asia/Kolkata", "yyyy-MM-dd HH:mm");
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][idIdx]) === String(submissionId)) {
      const row = data[i];
      const mode = modeIdx !== -1 ? String(row[modeIdx]).toLowerCase() : "upi";
      const phone = phoneIdx !== -1 ? String(row[phoneIdx]) : "";
      const name = nameIdx !== -1 ? String(row[nameIdx]) : "Customer";
      const amt = amtIdx !== -1 ? Number(row[amtIdx]) : 0;

      // Logic: If user chose Wallet refund, perform the ledger entry now
      if (mode === "wallet" && phone && amt > 0) {
        _appendWalletTransaction(phone, name, "Order Cancellation Refund", amt, true, String(submissionId));
      }

      // Mark the refund row as done
      ws.getRange(i + 1, statusIdx + 1).setValue("Refunded (" + now + ")");

      // ── Update the source order row remark to reflect completed refund ──
      // This closes the audit loop: the SK_Orders row was previously marked
      // "Cancelled – UPI Refund Pending" (or similar); now update it.
      try {
        const ordersWs = ss.getSheetByName(TAB_ORDERS);
        if (ordersWs) {
          const ordersData = ordersWs.getDataRange().getValues();
          const oHeaders = ordersData[0];
          const oIdIdx = oHeaders.indexOf("Submission_ID");
          const oStatusIdx = oHeaders.indexOf("Payment_Status");
          if (oIdIdx !== -1 && oStatusIdx !== -1) {
            for (var j = 1; j < ordersData.length; j++) {
              if (String(ordersData[j][oIdIdx]) === String(submissionId)) {
                const finalRemark = mode === "wallet"
                  ? "Cancelled \u2013 Refunded to Wallet (" + now + ")"
                  : "Cancelled \u2013 Refunded via UPI (" + now + ")";
                ordersWs.getRange(j + 1, oStatusIdx + 1).setValue(finalRemark);
                break;
              }
            }
          }
        }
      } catch(e) { /* non-fatal — refund row already updated */ }

      return {success: true};
    }
  }
  return {success: false, error: "Refund request not found"};
}

function markRefundRejected(submissionId) {
  const ss = getSpreadsheet();
  const ws = getOrCreateTab(ss, TAB_REFUNDS, []);
  const data = ws.getDataRange().getValues();
  const h = data[0];
  const idIdx = h.indexOf("Submission_ID");
  const statusIdx = h.indexOf("Status");

  if (idIdx === -1 || statusIdx === -1) return {success: false, error: "Sheet layout error"};

  const now = Utilities.formatDate(new Date(), "Asia/Kolkata", "yyyy-MM-dd HH:mm");
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][idIdx]) === String(submissionId)) {
      ws.getRange(i + 1, statusIdx + 1).setValue("Rejected (" + now + ")");
      return {success: true};
    }
  }
  return {success: false, error: "Refund request not found"};
}

// ── ROTI PACKING UTILITY ──────────────────────────────────────
function calculatePackets(total, max) {
  if (total <= 0) return [];
  if (total <= max) return [total];
  var numPacks = Math.ceil(total / max);
  var baseSize = Math.floor(total / numPacks);
  var remainder = total % numPacks;
  var packs = [];
  for (var i = 0; i < numPacks; i++) {
    packs.push(i < remainder ? baseSize + 1 : baseSize);
  }
  return packs;
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
    return d === date;
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
    if (phones.includes(String(r.Phone||"").trim()) &&
        String(r.Order_Date) >= dateFrom &&
        String(r.Order_Date) <= dateTo   &&
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
      const scFreeThr    = 150;
      if (scOldTotal >= scFreeThr && scRemaining < scFreeThr) {
        const scHIdx2    = headerIndex(ws);
        const scDelCol   = scHIdx2["Delivery_Charge"];
        const scSmallCol = scHIdx2["Small_Order_Fee"];
        const scNetCol2  = scHIdx2["Net_Total"];
        scSameDayRows.forEach(x => {
          const xSub  = Number(x.Food_Subtotal) || 0;
          const xMeal = String(x.Meal_Type).trim();
          let scNetDelta = 0;
          if (xSub > 0 && scIsNonFree(x.Area || "") && (Number(x.Delivery_Charge) || 0) === 0) {
            scDeliveryOwed += 10; scNetDelta += 10;
            if (scDelCol) ws.getRange(x._row, scDelCol).setValue(10);
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
function markReviewed(body) {
  const ss = getSpreadsheet();
  const ws = getOrCreateTab(ss, TAB_CUSTOMERS, CUSTOMERS_HEADERS);
  const rows = getAllRows(ws);
  const phone = _normalizePhone(body.phone);
  
  const hIdx = headerIndex(ws);
  if (!hIdx["Review_Promo_Count"]) return {success: false, error: "Review column not initialized. Please refresh sheet."};
  
  const rowIdx = rows.findIndex(x => _normalizePhone(x.Phone) === phone);
  if (rowIdx === -1) return {success: false, message: "Customer not found."};
  
  // Set Review_Promo_Count to 3
  const realRow = rowIdx + 2;
  ws.getRange(realRow, hIdx["Review_Promo_Count"]).setValue(3);
  
  return {success: true, message: "10% Discount (3x) gifted successfully!"};
}

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
        source: "Admin Bulk"
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
        // Advance prevDate forward by 1+ days, skipping Sundays, to see if we land on dateStr
        const prev = new Date(prevDate + "T00:00:00+05:30");
        let nxt = new Date(prev); nxt.setDate(nxt.getDate() + 1);
        while (nxt.getDay() === 0) nxt.setDate(nxt.getDate() + 1); // skip Sundays
        const nxtISO = Utilities.formatDate(nxt, "Asia/Kolkata", "yyyy-MM-dd");
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

