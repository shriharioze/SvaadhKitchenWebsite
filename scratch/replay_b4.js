// REPLAY batch 4 — breakfast removal, GET/POST routing, fee removal, version
const fs = require("fs");
const p = "docs/Liviano-Serio.html";
let c = fs.readFileSync(p, "utf8");
let n = 0, miss = [];
function rep(a, b) { if (c.includes(a)) { c = c.split(a).join(b); n++; } else miss.push(a.slice(0, 70)); }

// ── breakfast removal: meal tabs ──
rep('      const MEALS = ["Breakfast", "Lunch", "Dinner"];',
    '      // LS storefront: no Breakfast — Lunch & Dinner only\n      const MEALS = (typeof STOREFRONT !== "undefined" && STOREFRONT === "LS")\n        ? ["Lunch", "Dinner"]\n        : ["Breakfast", "Lunch", "Dinner"];');

// ── breakfast removal: weekly menu card ──
rep(`      const _todayISO2 = new Date().toLocaleDateString("en-CA");
      $("wmBody").innerHTML = \`
    <div class="wm-day-title">\${d.date === _todayISO2 ? "Today's Menu (" + d.dayName + ")" : d.dayName + ", " + d.displayDate}</div>
    
    <div class="wm-meal-card">
      <div class="wm-meal-label bf">☀️ Breakfast Menu</div>
      <div class="wm-bf-list">\${bfChips}</div>
    </div>`,
    `      const _todayISO2 = new Date().toLocaleDateString("en-CA");
      // LS storefront: no Breakfast card in the weekly menu
      const _bfCardLS = (typeof STOREFRONT !== "undefined" && STOREFRONT === "LS") ? "" : \`
    <div class="wm-meal-card">
      <div class="wm-meal-label bf">☀️ Breakfast Menu</div>
      <div class="wm-bf-list">\${bfChips}</div>
    </div>\`;
      $("wmBody").innerHTML = \`
    <div class="wm-day-title">\${d.date === _todayISO2 ? "Today's Menu (" + d.dayName + ")" : d.dayName + ", " + d.displayDate}</div>
    
    \${_bfCardLS}`);

// ── fee removal: small-order fee (bill preview) ──
rep('if (!S.profile.feeExempt&&!_isFD&&!_isP&&(meal==="Lunch"||meal==="Dinner")&&_sub>0&&_cms<_smallFeeTh) _tsm+=11;',
    'if (!S.profile.feeExempt&&!_isFD&&!_isP&&!LS_FREE_DELIVERY&&(meal==="Lunch"||meal==="Dinner")&&_sub>0&&_cms<_smallFeeTh) _tsm+=11; // LS: no small fee');
// ── fee removal: small-order fee (checkout builder) ──
rep('if (!S.profile.feeExempt && !isDayFree && !isPickup && (mealType === "Lunch" || mealType === "Dinner") && sub > 0 && combinedMealSub < (PRICING_V2 ? 53 : 50)) {\n            const fee = 11;',
    'if (!S.profile.feeExempt && !isDayFree && !isPickup && !LS_FREE_DELIVERY && (mealType === "Lunch" || mealType === "Dinner") && sub > 0 && combinedMealSub < (PRICING_V2 ? 53 : 50)) {\n            const fee = 11; // LS: no small fee');

// ── free-delivery threshold banner removal (LS: always free) ──
const bannerProbe = c.indexOf("for Free Delivery");
let bannerInfo = "found@" + bannerProbe;

// ── GET routing: &storefront=LS ──
rep('action=getCustomerOrders&phone=${S.phone}&_t=${Date.now()}', 'action=getCustomerOrders&phone=${S.phone}&storefront=LS&_t=${Date.now()}');
rep('action=verifyLogin&phone=${S.phone}&pin=${enteredPin}', 'action=verifyLogin&phone=${S.phone}&pin=${enteredPin}&storefront=LS');
rep('action=setPin&phone=${S.phone}&pin=${enteredPin}', 'action=setPin&phone=${S.phone}&pin=${enteredPin}&storefront=LS');
rep('action=verifyLogin&phone=${S.phone}&pin=${_sp}', 'action=verifyLogin&phone=${S.phone}&pin=${_sp}&storefront=LS');
rep('action=getCustomer&phone=${S.phone}&_t=${Date.now()}', 'action=getCustomer&phone=${S.phone}&storefront=LS&_t=${Date.now()}');
rep('action=getCustomer&phone=${S.phone}`', 'action=getCustomer&phone=${S.phone}&storefront=LS`');
rep('action=verifyLogin&phone=${S.phone}&pin=${savedPin}', 'action=verifyLogin&phone=${S.phone}&pin=${savedPin}&storefront=LS');
rep('action=getWalletTransactions&phone=${encodeURIComponent(S.phone)}', 'action=getWalletTransactions&phone=${encodeURIComponent(S.phone)}&storefront=LS');
rep('action=getCustomerOrders&phone=${encodeURIComponent(S.phone)}&_t=${Date.now()}', 'action=getCustomerOrders&phone=${encodeURIComponent(S.phone)}&storefront=LS&_t=${Date.now()}');
rep('action=getCustomerOrders&phone=${encodeURIComponent(S.phone)}`', 'action=getCustomerOrders&phone=${encodeURIComponent(S.phone)}&storefront=LS`');
rep('action=getCustomerOrders&phone=${phone}&_t=${Date.now()}', 'action=getCustomerOrders&phone=${phone}&storefront=LS&_t=${Date.now()}');

// ── POST routing: raw fetch bodies ──
rep('_action: "upsertProfile"', '_action: "upsertProfile", storefront: STOREFRONT');
rep('{ _action: "upsertProfile", phone: phone, email: em', '{ _action: "upsertProfile", storefront: STOREFRONT, phone: phone, email: em');
rep('_action: "submitWalletRecharge",', '_action: "submitWalletRecharge",\n          storefront: STOREFRONT,');
rep('{ _action: "hdfc_finalizeWalletRecharge", order_id: pendingId }', '{ _action: "hdfc_finalizeWalletRecharge", storefront: STOREFRONT, order_id: pendingId }');
rep('{ _action: "hdfc_finalizeWalletRecharge", order_id: orderId }', '{ _action: "hdfc_finalizeWalletRecharge", storefront: STOREFRONT, order_id: orderId }');
rep('{ _action: "requestPinResetOtp", phone: phone }', '{ _action: "requestPinResetOtp", storefront: STOREFRONT, phone: phone }');
rep('{ _action: "verifyPinResetOtp", phone: phone, otp: otp, newPin: np }', '{ _action: "verifyPinResetOtp", storefront: STOREFRONT, phone: phone, otp: otp, newPin: np }');

// ── version ──
rep('const APP_VERSION = "v26.08.24.LS.01";', 'const APP_VERSION = "v26.08.24.LS.06";');

fs.writeFileSync(p, c);
console.log("batch4 applied " + n + ", missed " + miss.length);
console.log("banner probe:", bannerInfo);
miss.forEach(m => console.log("  MISS: " + m));
